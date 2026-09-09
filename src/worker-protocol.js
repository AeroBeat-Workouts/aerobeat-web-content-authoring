// @ts-check

import { canonicalJson, cloneData, deepFreeze, isPlainRecord, prefixedSha256 } from "./canonical.js";
import { normalizeConverterProfile } from "./converter-profile.js";
import { parseBeatMapDifficulty } from "./beatmap.js";
import { supportedModifiers } from "./definitions.js";
import { convertDifficulty } from "./converter.js";
import { semanticParityHash } from "./parity.js";
import { validateAuthoredPackage } from "./validator.js";
import { verifySourceNotePalette } from "./note-palette.js";
import { verifyBeatSaberSpawnTiming } from "./spawn-timing.js";

export const authoringWorkerProtocolVersion = 2;

/** @typedef {Parameters<typeof convertDifficulty>[1]} WorkerConversionOptions */
/** @typedef {"v2" | "v3" | "v4"} BeatMapFormat */

/**
 * Execute one strictly narrowed structured-clone-safe conversion request.
 *
 * @param {unknown} request
 * @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime]
 */
export async function executeWorkerConversion(request, runtime = {}) {
  const normalized = narrowRequest(request);
  if (normalized.options.converterProfile) normalized.options.converterProfile = await normalizeConverterProfile(normalized.options.converterProfile);
  checkAbort(runtime.signal);
  safeProgress(runtime.onProgress, 0.05, "parsing");
  const sourceSummary = parseBeatMapDifficulty(normalized.difficultyBytes, normalized.format);
  const exactDifficultyHash = await prefixedSha256(normalized.difficultyBytes);
  if (normalized.options.sourceDifficultyHash && normalized.options.sourceDifficultyHash !== exactDifficultyHash) throw workerError("difficulty_hash_mismatch", "Worker difficulty bytes do not match the verified source hash");
  normalized.options.sourceDifficultyHash = exactDifficultyHash;
  checkAbort(runtime.signal);
  const converted = await convertDifficulty(sourceSummary, normalized.options, (progress, phase) => { checkAbort(runtime.signal); safeProgress(runtime.onProgress, progress, phase); });
  checkAbort(runtime.signal);
  const validation = await validateAuthoredPackage(converted.package);
  if (!validation.valid) throw workerError("package_validation_failed", validation.issues.map((entry) => entry.code).join(", "));
  safeProgress(runtime.onProgress, 0.9, "validating");
  const parityHash = await semanticParityHash(converted.package);
  return deepFreeze({ schema: "aerobeat/authoring_worker_result", version: 2, jobId: normalized.jobId, package: cloneData(converted.package), packageHash: validation.packageHash, sourceHash: converted.sourceHash, semanticParityHash: parityHash, traces: cloneData(converted.traces) });
}

export function createInlineAuthoringWorkerAdapter() {
  let destroyed = false;
  return Object.freeze({
    kind: "inline",
    /** @param {unknown} request @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime] */
    async convert(request, runtime = {}) { if (destroyed) throw workerError("worker_destroyed", "Worker adapter is destroyed"); await Promise.resolve(); if (destroyed) throw workerError("worker_destroyed", "Worker adapter is destroyed"); return executeWorkerConversion(request, runtime); },
    destroy() { destroyed = true; }
  });
}

/**
 * Browser module Worker adapter. Every request owns a disposable Worker.
 *
 * @param {{workerFactory?: () => Worker}} [options]
 */
export function createBrowserAuthoringWorkerAdapter(options = {}) {
  const workerFactory = options.workerFactory ?? (() => new Worker(new URL("./conversion-worker.js", import.meta.url), { type: "module", name: "aerobeat-content-authoring" }));
  /** @type {Set<() => void>} */
  const cancelActive = new Set(); let destroyed = false;
  return Object.freeze({
    kind: "worker",
    /** @param {unknown} request @param {{signal?: AbortSignal, onProgress?: (progress: number, phase: string) => void}} [runtime] */
    convert(request, runtime = {}) {
      if (destroyed) return Promise.reject(workerError("worker_destroyed", "Worker adapter is destroyed"));
      let expectedJobId = "";
      try { expectedJobId = narrowRequest(request).jobId; } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        let worker;
        try { worker = workerFactory(); } catch (cause) { reject(workerError("worker_failed", diagnostic("Worker creation failed", cause))); return; }
        let settled = false;
        const finish = (action, value) => { if (settled) return; settled = true; runtime.signal?.removeEventListener("abort", abort); cancelActive.delete(cancel); worker.terminate(); action(value); };
        const abort = () => finish(reject, workerError("operation_aborted", "Conversion was cancelled"));
        const cancel = () => finish(reject, workerError("worker_destroyed", "Worker adapter is destroyed"));
        cancelActive.add(cancel);
        runtime.signal?.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event) => {
          const message = narrowWorkerMessage(event.data, expectedJobId);
          if (!message) { finish(reject, workerError("worker_protocol_invalid", "Worker returned an invalid or mismatched message")); return; }
          if (message.kind === "progress") safeProgress(runtime.onProgress, Number(message.progress), String(message.phase));
          else if (message.kind === "result") finish(resolve, message.result);
          else finish(reject, workerError(String(message.code), String(message.message)));
        };
        worker.onerror = (event) => finish(reject, workerError("worker_failed", event.message || "Worker conversion failed"));
        let clone;
        try { clone = cloneData(request); } catch (cause) { finish(reject, workerError("worker_request_invalid", diagnostic("Worker request could not be cloned", cause))); return; }
        const bytes = isPlainRecord(clone) && clone.difficultyBytes instanceof Uint8Array ? clone.difficultyBytes : null;
        try { worker.postMessage(clone, bytes ? [bytes.buffer] : []); } catch (cause) { finish(reject, workerError("worker_failed", diagnostic("Worker request could not be posted", cause))); return; }
        if (runtime.signal?.aborted) abort();
      });
    },
    destroy() { if (destroyed) return; destroyed = true; for (const cancel of [...cancelActive]) cancel(); cancelActive.clear(); }
  });
}

/** @param {unknown} request @returns {{jobId: string, difficultyBytes: Uint8Array, format: BeatMapFormat, options: WorkerConversionOptions}} */
function narrowRequest(request) {
  if (!hasExactDataKeys(request, ["schema", "version", "kind", "jobId", "manifest", "difficultyBytes", "options"])) throw workerError("worker_request_invalid", "Worker request shape is invalid");
  const record = /** @type {Record<string, unknown>} */ (request);
  if (record.schema !== "aerobeat/authoring_worker_request" || record.version !== 2 || record.kind !== "convert" || !boundedString(record.jobId, 128) || !record.jobId || !(record.difficultyBytes instanceof Uint8Array) || record.difficultyBytes.byteLength > 64 * 1024 * 1024) throw workerError("worker_request_invalid", "Worker request shape is invalid");
  if (!hasExactDataKeys(record.manifest, ["schemaId", "infoFormat", "infoVersion", "infoPath", "infoHash", "songName", "songAuthorName", "levelAuthorName", "bpm", "audioPath", "audioContentHash", "selectedDifficulty", "sourceProvider", "sourceId", "sourceVersionHash"])) throw workerError("worker_request_invalid", "Worker manifest shape is invalid");
  const manifest = /** @type {Record<string, unknown>} */ (record.manifest);
  if (manifest.schemaId !== "aerobeat.authoring-source.v2" || typeof manifest.infoFormat!=="string"||!["v2","v4"].includes(manifest.infoFormat) || (manifest.infoVersion!==null&&!semanticVersion(manifest.infoVersion)) || !validHash(manifest.infoHash) || typeof manifest.bpm !== "number" || !Number.isFinite(manifest.bpm) || manifest.bpm <= 0) throw workerError("worker_request_invalid", "Worker manifest values are invalid");
  for (const field of ["infoPath","songName","songAuthorName","levelAuthorName","audioPath","sourceProvider","sourceId","sourceVersionHash"]) if (typeof manifest[field] !== "string" || String(manifest[field]).length > 1024) throw workerError("worker_request_invalid", "Worker manifest text is invalid");
  if (!optionalHash(manifest.audioContentHash)) throw workerError("worker_request_invalid", "Worker manifest audio hash is invalid");
  if (!hasExactDataKeys(manifest.selectedDifficulty, ["difficulty", "path", "beatMapFormat", "beatMapVersion", "contentHash", "notePalette", "noteJumpMovementSpeed", "noteJumpStartBeatOffset", "spawnTiming"])) throw workerError("worker_request_invalid", "Worker selected difficulty shape is invalid");
  const selected = /** @type {Record<string, unknown>} */ (manifest.selectedDifficulty);
  if (!boundedString(selected.difficulty,64) || !selected.difficulty || !boundedString(selected.path,1024) || !selected.path || typeof selected.beatMapFormat!=="string"||!["v2","v3","v4"].includes(selected.beatMapFormat) || (selected.beatMapVersion!==null&&!semanticVersion(selected.beatMapVersion)) || !validHash(selected.contentHash) || (manifest.infoFormat==="v2"&&selected.beatMapFormat==="v4") || (manifest.infoFormat==="v4"&&selected.beatMapFormat!=="v4")) throw workerError("worker_request_invalid", "Worker selected difficulty values are invalid");
  let selectedPalette; try { selectedPalette=verifySourceNotePalette(selected.notePalette,{infoFormat:/** @type {"v2"|"v4"} */(manifest.infoFormat),infoHash:/** @type {string} */(manifest.infoHash),difficultyHash:/** @type {string} */(selected.contentHash)}); } catch { throw workerError("worker_request_invalid","Worker source palette provenance is invalid"); }
  let selectedSpawnTiming; try { selectedSpawnTiming=verifyBeatSaberSpawnTiming(selected.spawnTiming); } catch { throw workerError("worker_request_invalid","Worker source spawn timing is invalid"); }
  if(selectedSpawnTiming.bpm!==manifest.bpm||selectedSpawnTiming.noteJumpMovementSpeed!==selected.noteJumpMovementSpeed||selectedSpawnTiming.noteJumpStartBeatOffset!==selected.noteJumpStartBeatOffset)throw workerError("worker_request_invalid","Worker source spawn timing does not match selected difficulty");
  const requiredOptions = ["difficulty", "songToken", "songName", "bpm", "noteJumpMovementSpeed", "noteJumpStartBeatOffset", "spawnTiming", "sourceProvider", "sourceId", "sourceVersionHash", "sourceInfoFormat", "sourceInfoVersion", "sourceInfoHash", "sourceDifficultyPath", "sourceBeatmapFormat", "sourceBeatmapVersion", "sourceDifficultyHash", "notePalette", "audioPath", "audioContentHash", "modifiers"];
  if (!hasOnlyDataKeys(record.options, requiredOptions, ["presentationSuggestion","converterProfile"]) || !requiredOptions.every((key) => Object.hasOwn(/** @type {object} */ (record.options), key))) throw workerError("worker_request_invalid", "Worker conversion options are invalid");
  const conversionOptions = /** @type {Record<string, unknown>} */ (record.options);
  for (const field of ["difficulty","songToken","songName","sourceProvider","sourceId","sourceVersionHash","sourceInfoFormat","sourceInfoHash","sourceDifficultyPath","sourceBeatmapFormat","audioPath"]) if (!boundedString(conversionOptions[field],1024)) throw workerError("worker_request_invalid", "Worker conversion text is invalid");
  if (conversionOptions.sourceInfoVersion!==null&&!semanticVersion(conversionOptions.sourceInfoVersion) || conversionOptions.sourceBeatmapVersion!==null&&!semanticVersion(conversionOptions.sourceBeatmapVersion) || typeof conversionOptions.bpm !== "number" || !Number.isFinite(conversionOptions.bpm) || conversionOptions.bpm <= 0 || typeof conversionOptions.noteJumpMovementSpeed!=="number"||!Number.isFinite(conversionOptions.noteJumpMovementSpeed)||conversionOptions.noteJumpMovementSpeed<=0||typeof conversionOptions.noteJumpStartBeatOffset!=="number"||!Number.isFinite(conversionOptions.noteJumpStartBeatOffset)||!validHash(conversionOptions.sourceInfoHash) || !validHash(conversionOptions.sourceDifficultyHash) || !optionalHash(conversionOptions.audioContentHash)) throw workerError("worker_request_invalid", "Worker conversion values are invalid");
  let optionSpawnTiming; try { optionSpawnTiming=verifyBeatSaberSpawnTiming(conversionOptions.spawnTiming); } catch { throw workerError("worker_request_invalid","Worker option spawn timing is invalid"); }
  const modifiers = denseStringArray(conversionOptions.modifiers, supportedModifiers.length);
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((value) => !supportedModifiers.includes(value))) throw workerError("worker_request_invalid", "Worker modifiers are invalid");
  const audioMatches=(conversionOptions.audioPath===manifest.audioPath&&conversionOptions.audioContentHash===manifest.audioContentHash)||(conversionOptions.audioPath===""&&conversionOptions.audioContentHash==="");
  let optionPalette; try { optionPalette=verifySourceNotePalette(conversionOptions.notePalette,{infoFormat:/** @type {"v2"|"v4"} */(manifest.infoFormat),infoHash:/** @type {string} */(manifest.infoHash),difficultyHash:/** @type {string} */(selected.contentHash)}); } catch { throw workerError("worker_request_invalid","Worker option palette provenance is invalid"); }
  if (conversionOptions.difficulty !== selected.difficulty || conversionOptions.sourceInfoFormat!==manifest.infoFormat || conversionOptions.sourceInfoVersion!==manifest.infoVersion || conversionOptions.sourceInfoHash!==manifest.infoHash || conversionOptions.sourceDifficultyPath !== selected.path || conversionOptions.sourceBeatmapFormat!==selected.beatMapFormat || conversionOptions.sourceBeatmapVersion!==selected.beatMapVersion || conversionOptions.sourceDifficultyHash !== selected.contentHash || canonicalJson(optionPalette)!==canonicalJson(selectedPalette) || canonicalJson(optionSpawnTiming)!==canonicalJson(selectedSpawnTiming) || conversionOptions.noteJumpMovementSpeed!==selected.noteJumpMovementSpeed || conversionOptions.noteJumpStartBeatOffset!==selected.noteJumpStartBeatOffset || conversionOptions.bpm !== manifest.bpm || conversionOptions.sourceProvider !== manifest.sourceProvider || conversionOptions.sourceId !== manifest.sourceId || conversionOptions.sourceVersionHash !== manifest.sourceVersionHash || !audioMatches) throw workerError("worker_request_invalid", "Worker options do not match the inspected manifest");
  if (Object.hasOwn(conversionOptions, "presentationSuggestion")) { if (!isPlainRecord(conversionOptions.presentationSuggestion)) throw workerError("worker_request_invalid", "Worker presentation suggestion is invalid"); let encoded; try { encoded=canonicalJson(conversionOptions.presentationSuggestion); } catch { throw workerError("worker_request_invalid", "Worker presentation suggestion must contain plain data"); } if(new TextEncoder().encode(encoded).byteLength>64*1024)throw workerError("worker_request_invalid","Worker presentation suggestion exceeds the size limit"); }
  if (Object.hasOwn(conversionOptions, "converterProfile") && !converterProfileShape(conversionOptions.converterProfile)) throw workerError("worker_request_invalid", "Worker converter profile shape is invalid");
  const format = /** @type {BeatMapFormat} */ (selected.beatMapFormat);
  return { jobId: /** @type {string} */ (record.jobId), difficultyBytes: Uint8Array.from(record.difficultyBytes), format, options: /** @type {WorkerConversionOptions} */ (cloneData(conversionOptions)) };
}

/** @param {unknown} value */
function converterProfileShape(value){if(!hasExactDataKeys(value,["schema","version","profileId","profileVersion","class","label","experimental","settings","contentHash"]))return false;const profile=/** @type {Record<string,unknown>} */(value);if(profile.schema!=="aerobeat/prototype_profile"||profile.version!==1||profile.class!=="converter_regeneration"||profile.experimental!==true||!boundedString(profile.profileId,128)||!profile.profileId||!boundedString(profile.profileVersion,64)||!profile.profileVersion||!boundedString(profile.label,256)||!profile.label||typeof profile.contentHash!=="string"||!(/^[0-9a-f]{64}$/u).test(profile.contentHash))return false;if(!hasExactDataKeys(profile.settings,["guardRelocationRadius","reachAllowanceSubcells"]))return false;const settings=/** @type {Record<string,unknown>} */(profile.settings);return Number.isInteger(settings.guardRelocationRadius)&&Number(settings.guardRelocationRadius)>=0&&Number(settings.guardRelocationRadius)<=8&&Number.isInteger(settings.reachAllowanceSubcells)&&Number(settings.reachAllowanceSubcells)>=0&&Number(settings.reachAllowanceSubcells)<=8;}

/** @param {unknown} value @param {string} expectedJobId */
function narrowWorkerMessage(value, expectedJobId) {
  if (!isPlainRecord(value) || value.schema !== "aerobeat/authoring_worker_message" || value.version !== 2 || value.jobId !== expectedJobId || !["progress", "result", "error"].includes(String(value.kind))) return null;
  if (value.kind === "progress") return hasExactDataKeys(value, ["schema", "version", "kind", "jobId", "progress", "phase"]) && Number.isFinite(value.progress) && Number(value.progress)>=0 && Number(value.progress)<=1 && boundedString(value.phase,128) ? value : null;
  if (value.kind === "result") { if(!hasExactDataKeys(value, ["schema", "version", "kind", "jobId", "result"])||!hasExactDataKeys(value.result,["schema","version","jobId","package","packageHash","sourceHash","semanticParityHash","traces"]))return null;const result=/** @type {Record<string,unknown>} */(value.result);if(result.schema!=="aerobeat/authoring_worker_result"||result.version!==2||result.jobId!==expectedJobId||!isPlainRecord(result.package)||!validHash(result.packageHash)||!validHash(result.sourceHash)||!validHash(result.semanticParityHash))return null;try{const encoded=canonicalJson(result);if(new TextEncoder().encode(encoded).byteLength>64*1024*1024)return null;}catch{return null;}return value; }
  return hasExactDataKeys(value, ["schema", "version", "kind", "jobId", "code", "message"]) && boundedString(value.code,128) && boundedString(value.message,4096) ? value : null;
}

/** @param {unknown} value @param {readonly string[]} required */
function hasExactDataKeys(value, required) { return hasOnlyDataKeys(value, required, []) && isPlainRecord(value) && Reflect.ownKeys(value).length === required.length; }
/** @param {unknown} value @param {readonly string[]} required @param {readonly string[]} optional */
function hasOnlyDataKeys(value, required, optional) { if (!isPlainRecord(value)) return false; const allowed=new Set([...required,...optional]); for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||!allowed.has(key))return false;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||descriptor.value===undefined)return false;}return true; }
/** @param {unknown} value @param {number} maximum */
function boundedString(value,maximum){return typeof value==="string"&&value.length<=maximum;}
/** @param {unknown} value */
function semanticVersion(value){return typeof value==="string"&&/^\d+\.\d+\.\d+$/u.test(value);}
/** @param {unknown} value */
function validHash(value){return typeof value==="string"&&/^sha256:[0-9a-f]{64}$/u.test(value);}
/** @param {unknown} value */
function optionalHash(value){return value===""||validHash(value);}
/** @param {unknown} value @param {number} maximum */
function denseStringArray(value,maximum){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum)throw workerError("worker_request_invalid","Worker array is invalid");const keys=Reflect.ownKeys(value);if(keys.some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw workerError("worker_request_invalid","Worker array contains unsupported fields");const result=[];for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||typeof descriptor.value!=="string")throw workerError("worker_request_invalid","Worker array must contain string data properties");result.push(descriptor.value);}return result;}
/** @param {AbortSignal | undefined} signal */
function checkAbort(signal) { if (signal?.aborted) throw workerError("operation_aborted", "Conversion was cancelled"); }
/** @param {((progress:number,phase:string)=>void) | undefined} listener @param {number} progress @param {string} phase */
function safeProgress(listener, progress, phase) { try { listener?.(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)), phase); } catch { /* observers cannot break conversion */ } }
/** @param {string} message @param {unknown} cause */
function diagnostic(message,cause){if(cause&&typeof cause==="object"){const descriptor=Object.getOwnPropertyDescriptor(cause,"message");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string"&&descriptor.value)return`${message}: ${descriptor.value.slice(0,4096)}`;}return message;}
/** @param {string} code @param {string} message */
function workerError(code, message) { const error = new Error(message); error.name = "AeroAuthoringWorkerError"; Object.assign(error, { code }); return error; }
