// @ts-check

import { cloneData, deepFreeze, isPlainRecord } from "./canonical.js";
import { exportAuthoredPackage } from "./export.js";
import { authoringPersistenceNamespace, createIndexedDbPersistenceAdapter, createMemoryPersistenceAdapter } from "./persistence.js";
import { prepareSourceMaterial } from "./source-material.js";
import { createBrowserAuthoringWorkerAdapter, createInlineAuthoringWorkerAdapter } from "./worker-protocol.js";

/** @typedef {ReturnType<typeof createMemoryPersistenceAdapter> | ReturnType<typeof createIndexedDbPersistenceAdapter>} PersistenceAdapter */
/** @typedef {{kind: string, convert: (request: unknown, runtime?: {signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}) => Promise<unknown>, destroy: () => void}} WorkerAdapter */

/**
 * Create one reconnectable browser content-authoring service instance.
 *
 * @param {{worker?: WorkerAdapter, persistence?: PersistenceAdapter, useBrowserWorker?: boolean, useIndexedDb?: boolean, now?: () => number, onListenerError?: (error: unknown) => void}} [options]
 */
export function createAeroWebContentAuthoringService(options = {}) {
  const worker = options.worker ?? (options.useBrowserWorker && typeof Worker !== "undefined" ? createBrowserAuthoringWorkerAdapter() : createInlineAuthoringWorkerAdapter());
  const persistence = options.persistence ?? (options.useIndexedDb && globalThis.indexedDB ? createIndexedDbPersistenceAdapter() : createMemoryPersistenceAdapter());
  const now = options.now ?? (() => Date.now());
  const listeners = new Set();
  let destroyed = false; let sequence = 0;
  /** @type {{jobId: string, generation: number, abort: AbortController} | null} */
  let active = null;
  let snapshot = makeSnapshot("idle-0", "queued", 0, null, null, null, null, null, null);

  const service = {
    /**
     * Convert, validate and atomically persist one selected source difficulty.
     *
     * @param {unknown} acquired Provider-neutral vendor acquisition/source bundle.
     * @param {{difficulty: string, sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, modifiers?: readonly string[], presentationSuggestion?: Readonly<Record<string, unknown>>, cacheSourceEntries?: boolean, includeAudio?: boolean, signal?: AbortSignal}} requestOptions
     */
    async convertAndPersist(acquired, requestOptions) {
      assertOpen();
      active?.abort.abort();
      const generation = ++sequence; const jobId = `authoring-${generation}`; const abort = new AbortController(); active = { jobId, generation, abort };
      const externalAbort = () => abort.abort(); requestOptions.signal?.addEventListener("abort", externalAbort, { once: true });
      let persistedKey = "";
      try {
        publish(makeSnapshot(jobId, "inspecting", 0.04, requestOptions.sourceId ?? null, requestOptions.sourceVersionHash ?? null, requestOptions.difficulty, null, null, null));
        const material = prepareSourceMaterial(acquired, requestOptions);
        checkCurrent(generation, abort.signal);
        const manifest = material.requestManifest;
        const workerRequest = {
          schema: "aerobeat/authoring_worker_request", version: 1, kind: "convert", jobId,
          manifest: cloneData(manifest), difficultyBytes: Uint8Array.from(material.difficultyBytes),
          options: {
            difficulty: manifest.selectedDifficulty.difficulty,
            songToken: slug(String(manifest.songName || manifest.sourceId)), songName: manifest.songName, bpm: manifest.bpm,
            sourceProvider: manifest.sourceProvider, sourceId: manifest.sourceId, sourceVersionHash: manifest.sourceVersionHash,
            sourceDifficultyPath: manifest.selectedDifficulty.path, sourceBeatmapVersion: `v${manifest.sourceFormatMajor}`,
            modifiers: [...(requestOptions.modifiers ?? [])], presentationSuggestion: requestOptions.presentationSuggestion ? cloneData(requestOptions.presentationSuggestion) : undefined
          }
        };
        publish(makeSnapshot(jobId, "converting", 0.1, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null));
        const result = await worker.convert(workerRequest, { signal: abort.signal, onProgress(progress, phase) { if (!isCurrent(generation)) return; const state = phase === "validating" ? "validating" : "converting"; publish(makeSnapshot(jobId, state, bounded(progress), String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null)); } });
        checkCurrent(generation, abort.signal);
        if (!isPlainRecord(result) || !isPlainRecord(result.package) || typeof result.packageHash !== "string") throw authoringError("worker_result_invalid", "Worker did not return a validated package");
        publish(makeSnapshot(jobId, "persisting", 0.94, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null));
        const packageRecord = /** @type {Record<string, unknown>} */ (result.package); const packageId = String(packageRecord.packageId); persistedKey = `${packageId}@${result.packageHash.slice(7, 19)}`;
        const assets = requestOptions.includeAudio === false ? [] : material.audio;
        await persistence.put({ key: persistedKey, package: /** @type {Record<string, unknown>} */ (cloneData(packageRecord)), packageHash: result.packageHash, assets, sourceCache: material.sourceCache, createdAtMs: now(), schemaVersion: persistence.schemaVersion });
        checkCurrent(generation, abort.signal);
        const handle = persistenceHandle(persistence.kind, persistedKey, packageId, result.packageHash);
        const completed = makeSnapshot(jobId, "complete", 1, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, handle);
        publish(completed); active = null;
        return deepFreeze({ job: completed, handle, package: /** @type {Record<string, unknown>} */ (cloneData(packageRecord)), semanticParityHash: String(result.semanticParityHash), sourceHash: String(result.sourceHash) });
      } catch (cause) {
        if (persistedKey) await persistence.delete(persistedKey).catch(() => false);
        const cancelled = abort.signal.aborted || errorCode(cause) === "operation_aborted" || !isCurrent(generation);
        const failed = makeSnapshot(jobId, cancelled ? "cancelled" : "failed", cancelled ? snapshot.progress : 1, snapshot.sourceId, snapshot.sourceVersionHash, requestOptions.difficulty, cancelled ? "operation_aborted" : errorCode(cause), cancelled ? "Conversion was cancelled" : errorMessage(cause), null);
        if (isCurrent(generation)) { publish(failed); active = null; }
        throw cause;
      } finally { requestOptions.signal?.removeEventListener("abort", externalAbort); }
    },
    /** @param {string} [jobId] */
    cancel(jobId) { if (active && (!jobId || active.jobId === jobId)) { active.abort.abort(); return true; } return false; },
    getSnapshot() { return snapshot; },
    /** @param {(snapshot: ReturnType<typeof makeSnapshot>) => void} listener */
    subscribe(listener) { assertOpen(); listeners.add(listener); notify(listener); return () => listeners.delete(listener); },
    async listPackages() { assertOpen(); return deepFreeze(await persistence.list()); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async loadPackage(handle) { assertOpen(); const record = await requireRecord(handle); return deepFreeze({ handle: persistenceHandle(persistence.kind, record.key, String(record.package.packageId), record.packageHash), package: /** @type {Record<string, unknown>} */ (cloneData(record.package)), assetPaths: Object.freeze(record.assets.map((entry) => entry.path)) }); },
    /** @param {Readonly<Record<string, unknown>> | string} handle @param {string} path */
    async readAsset(handle, path) { assertOpen(); const record = await requireRecord(handle); const asset = record.assets.find((entry) => entry.path.toLowerCase() === path.toLowerCase()); if (!asset) throw authoringError("asset_not_found", "Authored package asset was not found"); return Uint8Array.from(asset.bytes); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async deletePackage(handle) { assertOpen(); return persistence.delete(keyFor(handle)); },
    async estimateStorage() { assertOpen(); return persistence.estimate(); },
    async migrateStorage() { assertOpen(); return persistence.migrate(); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async exportPackage(handle) { assertOpen(); const record = await requireRecord(handle); const exported = await exportAuthoredPackage(record); return deepFreeze({ fileName: exported.fileName, mediaType: exported.mediaType, byteLength: exported.byteLength, bytes: Uint8Array.from(exported.bytes) }); },
    getCapabilities() { return deepFreeze({ providerNeutralSourceInput: true, conversionWorker: worker.kind === "worker", inlineWorkerFallback: worker.kind === "inline", cancellation: true, localPersistence: true, indexedDb: persistence.kind === "indexeddb", packageExport: true, sharedArrayBufferRequired: false, sourceCacheOptional: true }); },
    destroy() { if (destroyed) return; destroyed = true; active?.abort.abort(); active = null; worker.destroy(); persistence.destroy(); listeners.clear(); snapshot = makeSnapshot(`destroyed-${sequence}`, "cancelled", snapshot.progress, snapshot.sourceId, snapshot.sourceVersionHash, snapshot.difficultyId, "service_destroyed", "Authoring service is destroyed", null); }
  };
  return Object.freeze(service);

  /** @param {number} generation */
  function isCurrent(generation) { return !destroyed && active?.generation === generation; }
  /** @param {number} generation @param {AbortSignal} signal */
  function checkCurrent(generation, signal) { if (signal.aborted || !isCurrent(generation)) throw authoringError("operation_aborted", "Conversion was cancelled"); }
  /** @param {ReturnType<typeof makeSnapshot>} next */
  function publish(next) { snapshot = next; for (const listener of [...listeners]) notify(listener); }
  /** @param {(snapshot: ReturnType<typeof makeSnapshot>) => void} listener */
  function notify(listener) { try { listener(snapshot); } catch (error) { try { options.onListenerError?.(error); } catch { /* diagnostics cannot break authoring */ } } }
  function assertOpen() { if (destroyed) throw authoringError("service_destroyed", "Authoring service is destroyed"); }
  /** @param {Readonly<Record<string, unknown>> | string} handle */
  async function requireRecord(handle) { const key = keyFor(handle); const record = await persistence.get(key); if (!record) throw authoringError("package_not_found", "Authored package was not found"); return record; }
}

/** @param {string} jobId @param {"queued" | "acquiring" | "inspecting" | "converting" | "validating" | "persisting" | "complete" | "cancelled" | "failed"} state @param {number} progress @param {string | null} sourceId @param {string | null} sourceVersionHash @param {string | null} difficultyId @param {string | null} errorCodeValue @param {string | null} errorMessageValue @param {Readonly<Record<string, unknown>> | null} result */
function makeSnapshot(jobId,state,progress,sourceId,sourceVersionHash,difficultyId,errorCodeValue,errorMessageValue,result){return deepFreeze({schema:"aerobeat/content_import_job_snapshot",version:1,jobId,state,progress:bounded(progress),sourceId,sourceVersionHash,difficultyId,errorCode:errorCodeValue,errorMessage:errorMessageValue,result});}
/** @param {string} storage @param {string} key @param {string} packageId @param {string} packageHash */
function persistenceHandle(storage,key,packageId,packageHash){const [algorithm,value]=packageHash.split(":");return deepFreeze({schema:"aerobeat/persistence_handle",version:1,storage:storage==="indexeddb"?"indexeddb":"memory",namespace:authoringPersistenceNamespace,key,packageId,packageHash:{schema:"aerobeat/content_hash",version:1,algorithm,value}});}
/** @param {Readonly<Record<string, unknown>> | string} handle */
function keyFor(handle){if(typeof handle==="string"&&handle)return handle;if(isPlainRecord(handle)&&typeof handle.key==="string"&&handle.key)return handle.key;throw authoringError("handle_invalid","Persistence handle is invalid");}
/** @param {number} value */
function bounded(value){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
/** @param {string} value */
function slug(value){return value.toLowerCase().replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"")||"imported";}
/** @param {unknown} cause */
function errorCode(cause){return cause&&typeof cause==="object"&&"code" in cause&&typeof cause.code==="string"?cause.code:"authoring_failed";}
/** @param {unknown} cause */
function errorMessage(cause){return cause instanceof Error?cause.message:"Content authoring failed";}
/** @param {string} code @param {string} message */
function authoringError(code,message){const error=new Error(message);error.name="AeroContentAuthoringError";Object.assign(error,{code});return error;}
