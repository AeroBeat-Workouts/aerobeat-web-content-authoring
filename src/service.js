// @ts-check

import { canonicalJson, cloneData, deepFreeze, isPlainRecord, prefixedSha256 } from "./canonical.js";
import { normalizeConverterProfile } from "./converter-profile.js";
import { supportedModifiers } from "./definitions.js";
import { exportAuthoredPackage } from "./export.js";
import { authoringPersistenceNamespace, createIndexedDbPersistenceAdapter, createMemoryPersistenceAdapter } from "./persistence.js";
import { semanticParityHash } from "./parity.js";
import { prepareAllStandardSourceMaterials, prepareSourceMaterial } from "./source-material.js";
import { createBrowserAuthoringWorkerAdapter, createInlineAuthoringWorkerAdapter } from "./worker-protocol.js";
import { validateAuthoredPackage } from "./validator.js";

/** @typedef {ReturnType<typeof createMemoryPersistenceAdapter> | ReturnType<typeof createIndexedDbPersistenceAdapter>} PersistenceAdapter */
/** @typedef {{kind: string, convert: (request: unknown, runtime?: {signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}) => Promise<unknown>, destroy: () => void}} WorkerAdapter */
/** @typedef {{difficulty:string,modifiers:string[],sourceProvider?:string,sourceId?:string,sourceVersionHash?:string,expectedAudioContentHash?:string,expectedDifficultyContentHashes?:Record<string,string>,presentationSuggestion?:Record<string,unknown>,converterProfile?:Record<string,unknown>,limits?:Record<string,number>,cacheSourceEntries?:boolean,includeAudio?:boolean,signal?:AbortSignal}} NormalizedRequestOptions */

/**
 * Create one reconnectable browser content-authoring service instance.
 *
 * @param {{worker?: WorkerAdapter, persistence?: PersistenceAdapter, useBrowserWorker?: boolean, useIndexedDb?: boolean, now?: () => number, onListenerError?: (error: unknown) => void}} [options]
 */
export function createAeroWebContentAuthoringService(options = {}) {
  const ownsWorker = options.worker === undefined;
  const ownsPersistence = options.persistence === undefined;
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
     * @param {{difficulty: string, sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, expectedAudioContentHash?: string, expectedDifficultyContentHashes?: Readonly<Record<string, string>>, modifiers?: readonly string[], presentationSuggestion?: Readonly<Record<string, unknown>>, converterProfile?: Readonly<Record<string, unknown>>, cacheSourceEntries?: boolean, includeAudio?: boolean, limits?: Readonly<Record<string, number>>, signal?: AbortSignal}} requestOptions
     */
    async convertAndPersist(acquired, requestOptions) {
      assertOpen();
      const normalizedOptions = normalizeRequestOptions(requestOptions);
      const converterProfile = normalizedOptions.converterProfile ? await normalizeConverterProfile(normalizedOptions.converterProfile) : null;
      assertOpen();
      active?.abort.abort();
      const generation = ++sequence; const jobId = `authoring-${generation}`; const abort = new AbortController(); active = { jobId, generation, abort };
      const externalAbort = () => abort.abort(); normalizedOptions.signal?.addEventListener("abort", externalAbort, { once: true });
      let persistedKey = "";
      try {
        publish(makeSnapshot(jobId, "inspecting", 0.04, normalizedOptions.sourceId ?? null, normalizedOptions.sourceVersionHash ?? null, normalizedOptions.difficulty, null, null, null));
        const material = await prepareSourceMaterial(acquired, normalizedOptions);
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
            sourceDifficultyHash: manifest.selectedDifficulty.contentHash, audioPath: normalizedOptions.includeAudio === false ? "" : manifest.audioPath, audioContentHash: normalizedOptions.includeAudio === false ? "" : manifest.audioContentHash,
            modifiers: [...normalizedOptions.modifiers],
            ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}),
            ...(normalizedOptions.presentationSuggestion ? { presentationSuggestion: cloneData(normalizedOptions.presentationSuggestion) } : {})
          }
        };
        publish(makeSnapshot(jobId, "converting", 0.1, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null));
        const result = await worker.convert(workerRequest, { signal: abort.signal, onProgress(progress, phase) { if (!isCurrent(generation)) return; const state = phase === "validating" ? "validating" : "converting"; publish(makeSnapshot(jobId, state, bounded(progress), String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null)); } });
        checkCurrent(generation, abort.signal);
        if (!isPlainRecord(result)) throw authoringError("worker_result_invalid", "Worker did not return a validated package");
        const resultPackage=dataProperty(result,"package");const resultPackageHash=dataProperty(result,"packageHash");const resultParityHash=dataProperty(result,"semanticParityHash");const resultSourceHash=dataProperty(result,"sourceHash");
        if(!isPlainRecord(resultPackage)||typeof resultPackageHash!=="string"||typeof resultParityHash!=="string"||typeof resultSourceHash!=="string")throw authoringError("worker_result_invalid","Worker did not return a validated package");
        const trustedValidation = await validateAuthoredPackage(resultPackage);
        if (!trustedValidation.valid || trustedValidation.packageHash !== resultPackageHash || !await workerResultMatchesManifest(resultPackage,manifest,normalizedOptions.includeAudio!==false,converterProfile,resultParityHash,resultSourceHash)) throw authoringError("worker_result_invalid", "Worker package failed main-thread validation, source/profile/projection binding or hash verification");
        checkCurrent(generation, abort.signal);
        publish(makeSnapshot(jobId, "persisting", 0.94, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, null));
        const packageRecord = resultPackage; const packageIdValue=dataProperty(packageRecord,"packageId");if(typeof packageIdValue!=="string")throw authoringError("worker_result_invalid","Worker package identity is invalid");const packageId=packageIdValue; persistedKey = `${packageId}@${resultPackageHash.slice(7, 19)}`;
        const assets = normalizedOptions.includeAudio === false ? [] : material.audio;
        await persistence.put({ key: persistedKey, package: /** @type {Record<string, unknown>} */ (cloneData(packageRecord)), packageHash: resultPackageHash, assets, sourceCache: material.sourceCache, createdAtMs: now(), schemaVersion: persistence.schemaVersion, writeToken: jobId });
        checkCurrent(generation, abort.signal);
        const handle = persistenceHandle(persistence.kind, persistedKey, packageId, resultPackageHash);
        const completed = makeSnapshot(jobId, "complete", 1, String(manifest.sourceId), String(manifest.sourceVersionHash), String(manifest.selectedDifficulty.difficulty), null, null, handle);
        publish(completed); active = null;
        return deepFreeze({ job: completed, handle, package: /** @type {Record<string, unknown>} */ (cloneData(packageRecord)), semanticParityHash: resultParityHash, sourceHash: resultSourceHash });
      } catch (cause) {
        if (persistedKey) await persistence.deleteIfToken(persistedKey, jobId).catch(() => false);
        const cancelled = abort.signal.aborted || errorCode(cause) === "operation_aborted" || !isCurrent(generation);
        const failed = makeSnapshot(jobId, cancelled ? "cancelled" : "failed", cancelled ? snapshot.progress : 1, snapshot.sourceId, snapshot.sourceVersionHash, normalizedOptions.difficulty, cancelled ? "operation_aborted" : errorCode(cause), cancelled ? "Conversion was cancelled" : errorMessage(cause), null);
        if (isCurrent(generation)) { publish(failed); active = null; }
        throw cause;
      } finally { normalizedOptions.signal?.removeEventListener("abort", externalAbort); }
    },
    /**
     * Convert every exact Standard difficulty sequentially and atomically persist one collection.
     * @param {unknown} acquired
     * @param {{sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, expectedAudioContentHash?: string, expectedDifficultyContentHashes?: Readonly<Record<string, string>>, modifiers?: readonly string[], presentationSuggestion?: Readonly<Record<string, unknown>>, converterProfile?: Readonly<Record<string, unknown>>, cacheSourceEntries?: boolean, includeAudio?: boolean, limits?: Readonly<Record<string, number>>, signal?: AbortSignal}} requestOptions
     */
    async convertAllStandardAndPersist(acquired, requestOptions) {
      assertOpen();
      const normalizedOptions = normalizeBatchRequestOptions(requestOptions);
      if (normalizedOptions.includeAudio === false) throw authoringError("request_invalid", "Batch conversion requires shared audio");
      const converterProfile = normalizedOptions.converterProfile ? await normalizeConverterProfile(normalizedOptions.converterProfile) : null;
      assertOpen(); active?.abort.abort();
      const generation = ++sequence; const jobId = `authoring-${generation}`; const abort = new AbortController(); active = { jobId, generation, abort };
      const externalAbort = () => abort.abort(); normalizedOptions.signal?.addEventListener("abort", externalAbort, { once: true });
      let persistedCollectionId = "";
      try {
        publish(makeSnapshot(jobId, "inspecting", 0.04, normalizedOptions.sourceId ?? null, normalizedOptions.sourceVersionHash ?? null, null, null, null, null));
        const prepared = await prepareAllStandardSourceMaterials(acquired, normalizedOptions);
        checkCurrent(generation, abort.signal);
        if (!prepared.audioPath || !prepared.audioContentHash || prepared.audio.length !== 1) throw authoringError("audio_required", "Batch conversion requires one verified audio asset");
        const packageRows = []; const resultRows = []; const packageHashes = [];
        for (let index = 0; index < prepared.materials.length; index += 1) {
          checkCurrent(generation, abort.signal);
          const material = prepared.materials[index]; const manifest = material.requestManifest; const difficulty = String(manifest.selectedDifficulty.difficulty);
          const workerRequest = {
            schema: "aerobeat/authoring_worker_request", version: 1, kind: "convert", jobId: `${jobId}-${index + 1}`,
            manifest: cloneData(manifest), difficultyBytes: Uint8Array.from(material.difficultyBytes),
            options: {
              difficulty, songToken: slug(String(manifest.songName || manifest.sourceId)), songName: manifest.songName, bpm: manifest.bpm,
              sourceProvider: manifest.sourceProvider, sourceId: manifest.sourceId, sourceVersionHash: manifest.sourceVersionHash,
              sourceDifficultyPath: manifest.selectedDifficulty.path, sourceBeatmapVersion: `v${manifest.sourceFormatMajor}`,
              sourceDifficultyHash: manifest.selectedDifficulty.contentHash, audioPath: manifest.audioPath, audioContentHash: manifest.audioContentHash,
              modifiers: [...normalizedOptions.modifiers],
              ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}),
              ...(normalizedOptions.presentationSuggestion ? { presentationSuggestion: cloneData(normalizedOptions.presentationSuggestion) } : {})
            }
          };
          publish(makeSnapshot(jobId, "converting", 0.1 + index / prepared.materials.length * 0.8, prepared.sourceId, prepared.sourceVersionHash, difficulty, null, null, null));
          const result = await worker.convert(workerRequest, { signal: abort.signal, onProgress(progress, phase) { if (!isCurrent(generation)) return; publish(makeSnapshot(jobId, phase === "validating" ? "validating" : "converting", 0.1 + (index + bounded(progress)) / prepared.materials.length * 0.8, prepared.sourceId, prepared.sourceVersionHash, difficulty, null, null, null)); } });
          checkCurrent(generation, abort.signal);
          if (!isPlainRecord(result)) throw authoringError("worker_result_invalid", "Worker did not return a validated package");
          const resultPackage = dataProperty(result, "package"), resultPackageHash = dataProperty(result, "packageHash"), resultParityHash = dataProperty(result, "semanticParityHash"), resultSourceHash = dataProperty(result, "sourceHash");
          if (!isPlainRecord(resultPackage) || typeof resultPackageHash !== "string" || typeof resultParityHash !== "string" || typeof resultSourceHash !== "string") throw authoringError("worker_result_invalid", "Worker did not return a validated package");
          const trustedValidation = await validateAuthoredPackage(resultPackage);
          if (!trustedValidation.valid || trustedValidation.packageHash !== resultPackageHash || !await workerResultMatchesManifest(resultPackage, manifest, true, converterProfile, resultParityHash, resultSourceHash)) throw authoringError("worker_result_invalid", "Worker batch package failed validation or source/profile binding");
          const packageIdValue = dataProperty(resultPackage, "packageId"); if (typeof packageIdValue !== "string") throw authoringError("worker_result_invalid", "Worker package identity is invalid");
          const key = `${packageIdValue}@${resultPackageHash.slice(7, 19)}`;
          packageRows.push({ key, package: cloneData(resultPackage), packageHash: resultPackageHash, assets: [], sourceCache: material.sourceCache, createdAtMs: now(), schemaVersion: persistence.schemaVersion, writeToken: jobId, assetRefs: [{ path: prepared.audioPath, contentHash: prepared.audioContentHash }] });
          packageHashes.push(resultPackageHash);
          resultRows.push({ difficultyId: difficulty, difficultyLabel: difficulty, packageId: packageIdValue, handle: persistenceHandle(persistence.kind, key, packageIdValue, resultPackageHash) });
        }
        checkCurrent(generation, abort.signal);
        const profileId = converterProfile ? String(converterProfile.profileId) : "aero.converter.legacy";
        const profileHash = converterProfile ? String(converterProfile.contentHash) : "unprofiled";
        const collectionIdentity = { sourceProvider: prepared.sourceProvider, sourceId: prepared.sourceId, sourceVersionHash: prepared.sourceVersionHash, converterProfileId: profileId, converterProfileHash: profileHash, modifierIds: [...normalizedOptions.modifiers], packageHashes };
        persistedCollectionId = `collection:${(await prefixedSha256(canonicalJson(collectionIdentity))).slice(7)}`;
        const collectionRecord = { collectionId: persistedCollectionId, songName: prepared.songName, sourceProvider: prepared.sourceProvider, sourceId: prepared.sourceId, sourceVersionHash: prepared.sourceVersionHash, converterProfileId: profileId, converterProfileHash: profileHash, modifierIds: [...normalizedOptions.modifiers], packageKeys: packageRows.map((row) => row.key), packages: resultRows.map((row, index) => ({ packageKey: packageRows[index].key, packageId: row.packageId, difficultyId: row.difficultyId, difficultyLabel: row.difficultyLabel })), createdAtMs: now(), schemaVersion: persistence.schemaVersion, writeToken: jobId };
        publish(makeSnapshot(jobId, "persisting", 0.94, prepared.sourceId, prepared.sourceVersionHash, null, null, null, null));
        const collection = await persistence.putCollection({ collection: collectionRecord, packages: packageRows, assets: [{ contentHash: prepared.audioContentHash, bytes: prepared.audio[0].bytes }] }, { signal: abort.signal });
        checkCurrent(generation, abort.signal);
        const packages = resultRows.map((row) => deepFreeze(row)); const defaultPackage = packages[0];
        const completed = makeSnapshot(jobId, "complete", 1, prepared.sourceId, prepared.sourceVersionHash, null, null, null, defaultPackage.handle);
        publish(completed); active = null;
        return deepFreeze({ collection, packages, defaultPackage });
      } catch (cause) {
        if (persistedCollectionId) { const stored = await persistence.getCollection(persistedCollectionId).catch(() => null); if (stored?.writeToken === jobId) await persistence.deleteCollection(persistedCollectionId).catch(() => false); }
        const cancelled = abort.signal.aborted || errorCode(cause) === "operation_aborted" || !isCurrent(generation);
        const failed = makeSnapshot(jobId, cancelled ? "cancelled" : "failed", cancelled ? snapshot.progress : 1, snapshot.sourceId, snapshot.sourceVersionHash, null, cancelled ? "operation_aborted" : errorCode(cause), cancelled ? "Conversion was cancelled" : errorMessage(cause), null);
        if (isCurrent(generation)) { publish(failed); active = null; }
        throw cause;
      } finally { normalizedOptions.signal?.removeEventListener("abort", externalAbort); }
    },
    /** @param {string} [jobId] */
    cancel(jobId) { if (active && (!jobId || active.jobId === jobId)) { active.abort.abort(); return true; } return false; },
    getSnapshot() { return snapshot; },
    /** @param {(snapshot: ReturnType<typeof makeSnapshot>) => void} listener */
    subscribe(listener) { assertOpen(); if (typeof listener !== "function") throw authoringError("listener_invalid", "Listener must be a function"); listeners.add(listener); notify(listener); return () => listeners.delete(listener); },
    async listPackages() { assertOpen(); return deepFreeze(await persistence.list()); },
    async listCollections() { assertOpen(); return deepFreeze(await persistence.listCollections()); },
    /** @param {string} collectionId */
    async getCollection(collectionId) { assertOpen(); const id = collectionKey(collectionId); const collections = await persistence.listCollections(); assertOpen(); return collections.find((collection) => collection.collectionId === id) ?? null; },
    /** @param {string} collectionId */
    async deleteCollection(collectionId) { assertOpen(); return persistence.deleteCollection(collectionKey(collectionId)); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async loadPackage(handle) { assertOpen(); const record = await requireRecord(handle); return deepFreeze({ handle: persistenceHandle(persistence.kind, record.key, String(record.package.packageId), record.packageHash), package: /** @type {Record<string, unknown>} */ (cloneData(record.package)), assetPaths: Object.freeze(record.assets.map((entry) => entry.path)) }); },
    /** @param {Readonly<Record<string, unknown>> | string} handle @param {string} path */
    async readAsset(handle, path) { assertOpen(); if(typeof path!=="string"||!path||path.length>1024)throw authoringError("asset_path_invalid","Asset path must be a bounded string");const record = await requireRecord(handle); const normalized=path.normalize("NFC").replaceAll("\\","/").toLowerCase();const asset = record.assets.find((entry) => entry.path === normalized); if (!asset) throw authoringError("asset_not_found", "Authored package asset was not found"); return Uint8Array.from(asset.bytes); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async deletePackage(handle) { assertOpen(); return persistence.delete(keyFor(handle)); },
    async estimateStorage() { assertOpen(); return persistence.estimate(); },
    async migrateStorage() { assertOpen(); return persistence.migrate(); },
    /** @param {Readonly<Record<string, unknown>> | string} handle */
    async exportPackage(handle) { assertOpen(); const key=keyFor(handle);const record=await persistence.getForExport(key);assertOpen();if(!record)throw authoringError("package_not_found","Authored package was not found");const exported = await exportAuthoredPackage({package:record.package,packageHash:record.packageHash,assets:record.assets}); return deepFreeze({ fileName: exported.fileName, mediaType: exported.mediaType, byteLength: exported.byteLength, bytes: Uint8Array.from(exported.bytes) }); },
    getCapabilities() { return deepFreeze({ providerNeutralSourceInput: true, conversionWorker: worker.kind === "worker", inlineWorkerFallback: worker.kind === "inline", cancellation: true, localPersistence: true, indexedDb: persistence.kind === "indexeddb", packageExport: true, sharedArrayBufferRequired: false, sourceCacheOptional: true }); },
    destroy() { if (destroyed) return; destroyed = true; active?.abort.abort(); active = null; if (ownsWorker) worker.destroy(); if (ownsPersistence) persistence.destroy(); listeners.clear(); snapshot = makeSnapshot(`destroyed-${sequence}`, "cancelled", snapshot.progress, snapshot.sourceId, snapshot.sourceVersionHash, snapshot.difficultyId, "service_destroyed", "Authoring service is destroyed", null); }
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
  async function requireRecord(handle) { const key = keyFor(handle); const record = await persistence.get(key); assertOpen(); if (!record) throw authoringError("package_not_found", "Authored package was not found"); return record; }
}

/** @param {string} jobId @param {"queued" | "acquiring" | "inspecting" | "converting" | "validating" | "persisting" | "complete" | "cancelled" | "failed"} state @param {number} progress @param {string | null} sourceId @param {string | null} sourceVersionHash @param {string | null} difficultyId @param {string | null} errorCodeValue @param {string | null} errorMessageValue @param {Readonly<Record<string, unknown>> | null} result */
function makeSnapshot(jobId,state,progress,sourceId,sourceVersionHash,difficultyId,errorCodeValue,errorMessageValue,result){return deepFreeze({schema:"aerobeat/content_import_job_snapshot",version:1,jobId,state,progress:bounded(progress),sourceId,sourceVersionHash,difficultyId,errorCode:errorCodeValue,errorMessage:errorMessageValue,result});}
/** @param {string} storage @param {string} key @param {string} packageId @param {string} packageHash */
function persistenceHandle(storage,key,packageId,packageHash){const [algorithm,value]=packageHash.split(":");return deepFreeze({schema:"aerobeat/persistence_handle",version:1,storage:storage==="indexeddb"?"indexeddb":"memory",namespace:authoringPersistenceNamespace,key,packageId,packageHash:{schema:"aerobeat/content_hash",version:1,algorithm,value}});}
/** @param {Readonly<Record<string, unknown>> | string} handle */
function keyFor(handle){if(typeof handle==="string"&&handle.length<=1024&&handle)return handle;if(isPlainRecord(handle)){const key=dataProperty(handle,"key");if(typeof key==="string"&&key&&key.length<=1024)return key;}throw authoringError("handle_invalid","Persistence handle is invalid");}
/** @param {unknown} value */
function collectionKey(value){if(typeof value!=="string"||!value||value.length>1024)throw authoringError("collection_invalid","Collection identity must be a bounded string");return value;}
/** @param {number} value */
function bounded(value){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
/** @param {string} value */
function slug(value){return value.toLowerCase().replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"")||"imported";}
/** @param {unknown} cause */
function errorCode(cause){if(cause&&typeof cause==="object"){const descriptor=Object.getOwnPropertyDescriptor(cause,"code");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string"&&descriptor.value.length<=128)return descriptor.value;}return"authoring_failed";}
/** @param {unknown} cause */
function errorMessage(cause){if(cause&&typeof cause==="object"){const descriptor=Object.getOwnPropertyDescriptor(cause,"message");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string"&&descriptor.value.length<=4096)return descriptor.value;}return"Content authoring failed";}
/** @param {Record<string,unknown>} packageValue @param {Record<string,unknown>} manifest @param {boolean} includeAudio @param {Readonly<Record<string,unknown>> | null} converterProfile @param {string} workerParityHash @param {string} workerSourceHash */
async function workerResultMatchesManifest(packageValue,manifest,includeAudio,converterProfile,workerParityHash,workerSourceHash){const source=dataProperty(packageValue,"source"),selected=dataProperty(manifest,"selectedDifficulty"),song=dataProperty(packageValue,"song");if(!isPlainRecord(source)||!isPlainRecord(selected)||!isPlainRecord(song))return false;if(dataProperty(source,"provider")!==dataProperty(manifest,"sourceProvider")||dataProperty(source,"sourceId")!==dataProperty(manifest,"sourceId")||dataProperty(source,"sourceVersionHash")!==dataProperty(manifest,"sourceVersionHash")||dataProperty(source,"difficulty")!==dataProperty(selected,"difficulty")||dataProperty(source,"sourceDifficultyPath")!==dataProperty(selected,"path")||dataProperty(source,"sourceHash")!==workerSourceHash)return false;const charts=dataProperty(packageValue,"charts");if(!Array.isArray(charts)||charts.some((chart)=>!isPlainRecord(chart)||dataProperty(chart,"difficulty")!==dataProperty(selected,"difficulty")))return false;const conversionTrace=dataProperty(packageValue,"conversionTrace"),boxing=isPlainRecord(conversionTrace)?dataProperty(conversionTrace,"boxing"):null,flow=isPlainRecord(conversionTrace)?dataProperty(conversionTrace,"flow"):null;if(!Array.isArray(boxing)||boxing.length!==4||boxing.some((trace)=>!isPlainRecord(trace)||dataProperty(trace,"sourceDifficultyPath")!==dataProperty(selected,"path")||dataProperty(trace,"sourceDifficultyHash")!==dataProperty(selected,"contentHash")||dataProperty(trace,"sourceBeatmapVersion")!==`v${String(dataProperty(manifest,"sourceFormatMajor"))}`||dataProperty(trace,"sourceHash")!==workerSourceHash)||!Array.isArray(flow)||flow.some((trace)=>!isPlainRecord(trace)||dataProperty(trace,"converterProfile")!==undefined))return false;const expectedProfile=converterProfile?canonicalJson(converterProfile):null;const sourceProfile=dataProperty(source,"converterProfile"),traceProfile=isPlainRecord(conversionTrace)?dataProperty(conversionTrace,"converterProfile"):undefined;try{if(converterProfile){if(canonicalJson(sourceProfile)!==expectedProfile||canonicalJson(traceProfile)!==expectedProfile||boxing.some((trace)=>canonicalJson(dataProperty(trace,"converterProfile"))!==expectedProfile)||charts.some((chart)=>dataProperty(chart,"mode")==="boxing"&&(!isPlainRecord(dataProperty(chart,"prototype"))||canonicalJson(dataProperty(/** @type {Record<string,unknown>} */(dataProperty(chart,"prototype")),"converterProfile"))!==expectedProfile)))return false;}else if(sourceProfile!==undefined||traceProfile!==undefined||boxing.some((trace)=>dataProperty(trace,"converterProfile")!==undefined)||charts.some((chart)=>isPlainRecord(dataProperty(chart,"prototype"))&&dataProperty(/** @type {Record<string,unknown>} */(dataProperty(chart,"prototype")),"converterProfile")!==undefined))return false;if(await semanticParityHash(packageValue)!==workerParityHash)return false;}catch{return false;}const audio=dataProperty(song,"audio"),audioPath=dataProperty(manifest,"audioPath"),audioHash=dataProperty(manifest,"audioContentHash");if(includeAudio&&typeof audioPath==="string"&&audioPath&&typeof audioHash==="string"&&audioHash){return isPlainRecord(audio)&&dataProperty(audio,"filePath")===audioPath&&dataProperty(audio,"contentHash")===audioHash;}return audio===undefined;}
/** @param {unknown} value @returns {Readonly<NormalizedRequestOptions>} */
function normalizeRequestOptions(value){
  if(!isPlainRecord(value))throw authoringError("request_invalid","Authoring options must be a plain record");
  const allowed=new Set(["difficulty","sourceProvider","sourceId","sourceVersionHash","expectedAudioContentHash","expectedDifficultyContentHashes","modifiers","presentationSuggestion","converterProfile","cacheSourceEntries","includeAudio","limits","signal"]);
  for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||!allowed.has(key)){throw authoringError("request_invalid","Authoring options contain an unknown field");}const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||descriptor.value===undefined)throw authoringError("request_invalid","Authoring options must contain enumerable data properties");}
  const difficulty=dataProperty(value,"difficulty");if(typeof difficulty!=="string"||!difficulty||difficulty.length>64)throw authoringError("request_invalid","Difficulty must be a bounded string");
  /** @type {NormalizedRequestOptions} */
  const result={difficulty,modifiers:[]};
  for(const field of ["sourceProvider","sourceId","sourceVersionHash","expectedAudioContentHash"]){const entry=dataProperty(value,field);if(entry!==undefined){if(typeof entry!=="string"||entry.length>512)throw authoringError("request_invalid",`${field} must be a bounded string`);Object.assign(result,{[field]:entry});}}
  for(const field of ["cacheSourceEntries","includeAudio"]){const entry=dataProperty(value,field);if(entry!==undefined){if(typeof entry!=="boolean")throw authoringError("request_invalid",`${field} must be a boolean`);Object.assign(result,{[field]:entry});}}
  const modifiers=arrayStrings(dataProperty(value,"modifiers")??[],supportedModifiers.length,"modifiers");for(const modifier of modifiers){if(!supportedModifiers.includes(modifier))throw authoringError("request_invalid",`Unsupported modifier ${modifier}`);}result.modifiers=[...new Set(modifiers)].sort();
  for(const field of ["expectedDifficultyContentHashes","limits","presentationSuggestion","converterProfile"]){const entry=dataProperty(value,field);if(entry!==undefined){if(!isPlainRecord(entry))throw authoringError("request_invalid",`${field} must be a plain record`);let encoded;try{encoded=canonicalJson(entry);}catch{throw authoringError("request_invalid",`${field} must contain plain data only`);}if(new TextEncoder().encode(encoded).byteLength>64*1024)throw authoringError("request_invalid",`${field} exceeds the size limit`);Object.assign(result,{[field]:cloneData(entry)});}}
  const signal=dataProperty(value,"signal");if(signal!==undefined){if(typeof AbortSignal==="undefined"||!(signal instanceof AbortSignal))throw authoringError("request_invalid","signal must be an AbortSignal");Object.assign(result,{signal});}
  return Object.freeze(result);
}
/** @param {unknown} value @returns {Readonly<NormalizedRequestOptions>} */
function normalizeBatchRequestOptions(value){
  if(!isPlainRecord(value))throw authoringError("request_invalid","Batch authoring options must be a plain record");
  const allowed=new Set(["sourceProvider","sourceId","sourceVersionHash","expectedAudioContentHash","expectedDifficultyContentHashes","modifiers","presentationSuggestion","converterProfile","cacheSourceEntries","includeAudio","limits","signal"]);
  /** @type {Record<string, unknown>} */ const narrowed={difficulty:"Easy"};
  for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||!allowed.has(key))throw authoringError("request_invalid","Batch authoring options contain an unknown field");const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||descriptor.value===undefined)throw authoringError("request_invalid","Batch authoring options must contain enumerable data properties");narrowed[key]=descriptor.value;}
  return normalizeRequestOptions(narrowed);
}
/** @param {Record<string, unknown>} record @param {string} key */
function dataProperty(record,key){const descriptor=Object.getOwnPropertyDescriptor(record,key);return descriptor&&"value" in descriptor&&descriptor.enumerable?descriptor.value:undefined;}
/** @param {unknown} value @param {number} maximum @param {string} field */
function arrayStrings(value,maximum,field){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum)throw authoringError("request_invalid",`${field} must be a bounded ordinary array`);const keys=Reflect.ownKeys(value);if(keys.some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw authoringError("request_invalid",`${field} contains unsupported fields`);const result=[];for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||typeof descriptor.value!=="string")throw authoringError("request_invalid",`${field} must contain string data properties`);result.push(descriptor.value);}return result;}
/** @param {string} code @param {string} message */
function authoringError(code,message){const error=new Error(message);error.name="AeroContentAuthoringError";Object.assign(error,{code});return error;}
