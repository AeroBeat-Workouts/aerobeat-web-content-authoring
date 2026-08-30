// @ts-check

import { deepFreeze, isPlainRecord, prefixedSha256 } from "./canonical.js";

/** @typedef {{manifest: Record<string, unknown>, listEntryPaths: () => readonly string[], readEntry: (path: string) => Uint8Array}} SourceBundle */

/** @type {Readonly<Record<string, number>>} */
const defaultLimits = Object.freeze({ difficultyBytes: 64 * 1024 * 1024, audioBytes: 128 * 1024 * 1024, selectedBytes: 192 * 1024 * 1024, cacheEntryBytes: 2 * 1024 * 1024, entryCount: 4096, pathChars: 1024 });
const maximumDifficulties = 100;
const maximumIdentityChars = 512;

/** Canonical Standard difficulty order shared by batch authoring and product presentation. */
export const standardDifficultyOrder = Object.freeze(["Easy", "Normal", "Hard", "Expert", "ExpertPlus"]);

/**
 * Adapt one selected Standard difficulty into a Worker-safe request plus child-local assets.
 * @param {unknown} acquired
 * @param {{difficulty: string, sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, cacheSourceEntries?: boolean, expectedAudioContentHash?: string, expectedDifficultyContentHashes?: Readonly<Record<string, string>>, limits?: Partial<typeof defaultLimits>, signal?: AbortSignal}} options
 */
export async function prepareSourceMaterial(acquired, options) {
  const batch = await prepareSourceMaterialSet(acquired, options, false);
  return batch.materials[0];
}

/**
 * Adapt every exact Standard difficulty in canonical order. Audio is read and hashed once.
 * @param {unknown} acquired
 * @param {{sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, cacheSourceEntries?: boolean, expectedAudioContentHash?: string, expectedDifficultyContentHashes?: Readonly<Record<string, string>>, limits?: Partial<typeof defaultLimits>, signal?: AbortSignal}} options
 */
export async function prepareAllStandardSourceMaterials(acquired, options) {
  return prepareSourceMaterialSet(acquired, options, true);
}

/** @param {unknown} acquired @param {Record<string, unknown>} options @param {boolean} all */
async function prepareSourceMaterialSet(acquired, options, all) {
  if (!isPlainRecord(acquired) || !isPlainRecord(options)) throw sourceError("source_invalid", "Source acquisition and options must be plain records");
  const nestedSource = dataProperty(acquired, "source");
  const source = isPlainRecord(nestedSource) ? nestedSource : acquired;
  if (!isSourceBundle(source)) throw sourceError("source_bundle_invalid", "Source must expose manifest, listEntryPaths and readEntry as data properties");
  const manifest = /** @type {Record<string, unknown>} */ (dataProperty(source, "manifest"));
  const limits = normalizeLimits(dataProperty(options, "limits"));
  const signalValue = dataProperty(options, "signal");
  const signal = signalValue instanceof AbortSignal ? signalValue : undefined;
  if (signalValue !== undefined && !signal) throw sourceError("source_options_invalid", "signal must be an AbortSignal");
  checkAbort(signal);
  const advertised = arrayData(dataProperty(manifest, "difficulties"), maximumDifficulties, "source_manifest_invalid");
  /** @type {{difficulty: string, path: string}[]} */
  let selected;
  if (all) {
    const byDifficulty = new Map();
    for (const entry of advertised) {
      if (!isPlainRecord(entry) || dataProperty(entry, "characteristic") !== "Standard") continue;
      const candidate = dataProperty(entry, "difficulty");
      if (typeof candidate !== "string" || candidate.length > 64) throw sourceError("difficulty_invalid", "Standard difficulty must be a bounded supported string");
      const difficulty = normalizeDifficulty(candidate);
      if (byDifficulty.has(difficulty)) throw sourceError("difficulty_duplicate", `Standard ${difficulty} is advertised more than once`);
      byDifficulty.set(difficulty, entry);
    }
    selected = standardDifficultyOrder.filter((difficulty) => byDifficulty.has(difficulty)).map((difficulty) => {
      const entry = /** @type {Record<string, unknown>} */ (byDifficulty.get(difficulty));
      const pathValue = dataProperty(entry, "path");
      if (typeof pathValue !== "string" || !pathValue) throw sourceError("difficulty_unavailable", `Standard ${difficulty} has no source path`);
      return { difficulty, path: normalizePath(pathValue, limits.pathChars) };
    });
  } else {
    const difficultyValue = dataProperty(options, "difficulty");
    if (typeof difficultyValue !== "string" || difficultyValue.length > 64) throw sourceError("difficulty_invalid", "Difficulty must be a bounded string");
    const wanted = normalizeDifficulty(difficultyValue);
    selected = [];
    for (const entry of advertised) {
      if (!isPlainRecord(entry) || dataProperty(entry, "characteristic") !== "Standard") continue;
      const candidate = dataProperty(entry, "difficulty");
      if (typeof candidate === "string" && candidate.length <= 64 && normalizeDifficulty(candidate) === wanted) {
        const pathValue = dataProperty(entry, "path");
        if (typeof pathValue !== "string" || !pathValue) break;
        selected = [{ difficulty: wanted, path: normalizePath(pathValue, limits.pathChars) }];
        break;
      }
    }
  }
  if (!selected.length) throw sourceError("difficulty_unavailable", all ? "No supported Standard difficulty is available in this source" : "Selected Standard difficulty is not available in this source");
  const listEntryPaths = /** @type {() => readonly string[]} */ (dataProperty(source, "listEntryPaths"));
  const readEntry = /** @type {(path: string) => Uint8Array} */ (dataProperty(source, "readEntry"));
  let listedValue;
  try { listedValue = listEntryPaths.call(source); } catch (cause) { throw sourceError("source_paths_failed", diagnostic("Source entry listing failed", cause)); }
  const listed = arrayData(listedValue, limits.entryCount, "source_paths_invalid");
  const listedByNormalized = new Map();
  for (const original of listed) {
    if (typeof original !== "string") throw sourceError("source_paths_invalid", "Source entry paths must be strings");
    const normalized = normalizePath(original, limits.pathChars);
    if (listedByNormalized.has(normalized)) throw sourceError("source_paths_duplicate", "Source entry paths collide after case and Unicode normalization");
    listedByNormalized.set(normalized, original);
  }

  const prepared = [];
  let selectedByteCount = 0;
  for (const item of selected) {
    checkAbort(signal);
    const original = listedByNormalized.get(item.path);
    if (!original) throw sourceError("source_entry_missing", `Standard ${item.difficulty} is absent from the advertised source entries`);
    const bytes = readBounded(readEntry, source, original, limits.difficultyBytes, "difficulty");
    selectedByteCount += bytes.byteLength;
    if (!Number.isSafeInteger(selectedByteCount) || selectedByteCount > limits.selectedBytes) throw sourceError("source_selected_bytes_exceeded", "Selected source data exceeds the authoring byte limit");
    const expected = expectedPathHash(dataProperty(options, "expectedDifficultyContentHashes"), item.path, limits.pathChars);
    const contentHash = await verifyExpectedHash(bytes, expected, "difficulty_hash_mismatch");
    checkAbort(signal);
    prepared.push({ ...item, bytes, contentHash });
  }

  const audioPathValue = dataProperty(manifest, "audioPath");
  const audioPath = typeof audioPathValue === "string" && audioPathValue ? normalizePath(audioPathValue, limits.pathChars) : "";
  const audioOriginal = audioPath ? listedByNormalized.get(audioPath) : undefined;
  if (audioPath && !audioOriginal) throw sourceError("source_entry_missing", "Audio is absent from the advertised source entries");
  checkAbort(signal);
  const audioBytes = audioOriginal ? readBounded(readEntry, source, audioOriginal, limits.audioBytes, "audio") : new Uint8Array();
  if (!Number.isSafeInteger(selectedByteCount + audioBytes.byteLength) || selectedByteCount + audioBytes.byteLength > limits.selectedBytes) throw sourceError("source_selected_bytes_exceeded", "Selected source data exceeds the authoring byte limit");
  const expectedAudio = optionalExpectedHash(dataProperty(options, "expectedAudioContentHash"), "expectedAudioContentHash");
  if (expectedAudio && !audioBytes.byteLength) throw sourceError("audio_hash_mismatch", "Expected audio is absent from the selected source");
  const audioContentHash = audioBytes.byteLength ? await verifyExpectedHash(audioBytes, expectedAudio, "audio_hash_mismatch") : "";
  checkAbort(signal);

  const cache = [];
  if (dataProperty(options, "cacheSourceEntries") === true) {
    const infoPathValue = dataProperty(manifest, "infoPath");
    const infoPath = typeof infoPathValue === "string" && infoPathValue ? normalizePath(infoPathValue, limits.pathChars) : "";
    const requiredCachePaths = [...new Set([infoPath, ...prepared.map((item) => item.path)].filter(Boolean))];
    for (const path of requiredCachePaths) {
      checkAbort(signal);
      const original = listedByNormalized.get(path);
      if (!original) throw sourceError("source_entry_missing", "Requested cache entry is absent");
      const preparedEntry = prepared.find((item) => item.path === path);
      const cachedBytes = preparedEntry ? Uint8Array.from(preparedEntry.bytes) : readBounded(readEntry, source, original, limits.cacheEntryBytes, "cache");
      if (cachedBytes.byteLength > limits.cacheEntryBytes) throw sourceError("source_entry_too_large", "cache entry exceeds the byte limit");
      cache.push({ path, bytes: cachedBytes });
    }
  }

  const sourceProviderOption = optionalIdentity(dataProperty(options, "sourceProvider"), "sourceProvider");
  const providerId = boundedDataString(dataProperty(acquired, "providerId"));
  const sourceProvider = sourceProviderOption || providerId || "local";
  const mapValue = dataProperty(acquired, "map"); const map = isPlainRecord(mapValue) ? mapValue : {};
  const versionValue = dataProperty(acquired, "version"); const version = isPlainRecord(versionValue) ? versionValue : {};
  const sourceIdOption = optionalIdentity(dataProperty(options, "sourceId"), "sourceId");
  const sourceVersionOption = optionalIdentity(dataProperty(options, "sourceVersionHash"), "sourceVersionHash");
  const sourceId = sourceIdOption || boundedDataString(dataProperty(map, "mapId")) || boundedDataString(dataProperty(manifest, "songName")) || "local-import";
  const sourceVersionHash = sourceVersionOption || boundedDataString(dataProperty(version, "hash")) || boundedDataString(dataProperty(acquired, "sourceHash")) || "local-unverified";
  const major = dataProperty(manifest, "sourceFormatMajor");
  if (!Number.isInteger(major) || ![2, 3, 4].includes(Number(major))) throw sourceError("source_format_unsupported", "Only Beat Saber v2, v3 and v4 are supported");
  const bpmValue = dataProperty(manifest, "bpm");
  const common = {
    schemaId: "aerobeat.authoring-source.v1", sourceFormatMajor: major,
    infoPath: boundedDataString(dataProperty(manifest, "infoPath"), limits.pathChars),
    songName: boundedDataString(dataProperty(manifest, "songName")) || "Imported Song",
    songAuthorName: boundedDataString(dataProperty(manifest, "songAuthorName")), levelAuthorName: boundedDataString(dataProperty(manifest, "levelAuthorName")),
    bpm: typeof bpmValue === "number" ? positive(bpmValue, 120) : 120, audioPath, audioContentHash, sourceProvider, sourceId, sourceVersionHash
  };
  const audio = audioPath ? [{ path: audioPath, bytes: Uint8Array.from(audioBytes), contentHash: audioContentHash }] : [];
  const materials = prepared.map((item) => deepFreeze({ requestManifest: deepFreeze({ ...common, selectedDifficulty: { difficulty: item.difficulty, path: item.path, contentHash: item.contentHash } }), difficultyBytes: Uint8Array.from(item.bytes), audio, sourceCache: cache }));
  return deepFreeze({ materials, audio, sourceCache: cache, sourceProvider, sourceId, sourceVersionHash, songName: common.songName, audioPath, audioContentHash });
}

/** @param {unknown} value @returns {value is SourceBundle} */
function isSourceBundle(value) { return isPlainRecord(value) && isPlainRecord(dataProperty(value, "manifest")) && typeof dataProperty(value, "listEntryPaths") === "function" && typeof dataProperty(value, "readEntry") === "function"; }
/** @param {Record<string, unknown>} record @param {string} key */
function dataProperty(record, key) { const descriptor = Object.getOwnPropertyDescriptor(record, key); if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined; return descriptor.value; }
/** @param {string} value */
function normalizeDifficulty(value) { const compact=value.toLowerCase().replace(/[^a-z]/gu,""); const names={easy:"Easy",normal:"Normal",hard:"Hard",expert:"Expert",expertplus:"ExpertPlus"}; const result=names[/** @type {keyof typeof names} */(compact)]; if(!result)throw sourceError("difficulty_invalid","Difficulty must be Easy, Normal, Hard, Expert or ExpertPlus"); return result; }
/** @param {string} value @param {number} maximumChars */
function normalizePath(value, maximumChars) { if (!value || value.length > maximumChars || /^[\\/]|^[a-z]:/iu.test(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw sourceError("source_path_invalid", "Source path is unsafe or exceeds the character limit"); const parts=value.replaceAll("\\","/").normalize("NFC").split("/"); if(parts.some((part)=>!part||part==="."||part===".."))throw sourceError("source_path_invalid","Source path is unsafe"); return parts.join("/").toLowerCase(); }
/** @param {(path:string)=>Uint8Array} reader @param {SourceBundle} source @param {string} path @param {number} maximum @param {string} kind */
function readBounded(reader, source, path, maximum, kind) { let bytes; try { bytes=reader.call(source,path); } catch(cause){throw sourceError("source_entry_read_failed",diagnostic(`${kind} entry read failed`,cause));} if(!(bytes instanceof Uint8Array))throw sourceError("source_entry_invalid",`${kind} entry must be a Uint8Array copy`); if(bytes.byteLength>maximum)throw sourceError("source_entry_too_large",`${kind} entry exceeds the byte limit`); return Uint8Array.from(bytes); }
/** @param {unknown} value */
function normalizeLimits(value){if(value!==undefined&&!isPlainRecord(value))throw sourceError("source_limits_invalid","Source limits must be a plain record");const override=isPlainRecord(value)?value:{};const allowed=new Set(Object.keys(defaultLimits));for(const key of Reflect.ownKeys(override)){if(typeof key!=="string"||!allowed.has(key)||dataProperty(override,key)===undefined)throw sourceError("source_limits_invalid","Source limits contain an unknown or non-data field");}const result={...defaultLimits};for(const key of Object.keys(result)){const candidate=dataProperty(override,key);if(candidate!==undefined){if(!Number.isSafeInteger(candidate)||Number(candidate)<=0)throw sourceError("source_limits_invalid",`Source limit ${key} must be a positive safe integer`);result[key]=Number(candidate);}}return Object.freeze(result);}
/** @param {unknown} value @param {string} field */
function optionalExpectedHash(value,field){if(value===undefined||value===null)return"";if(typeof value!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(value))throw sourceError("source_hash_invalid",`${field} must be lowercase sha256`);return value;}
/** @param {unknown} value @param {string} selectedPath @param {number} maximumPathChars */
function expectedPathHash(value,selectedPath,maximumPathChars){if(value===undefined||value===null)return"";if(!isPlainRecord(value))throw sourceError("source_hash_invalid","expectedDifficultyContentHashes must be a plain record");const keys=Reflect.ownKeys(value);if(keys.length>maximumDifficulties)throw sourceError("source_hash_invalid","Difficulty hash map exceeds the entry limit");let expected="";const seen=new Set();for(const key of keys){if(typeof key!=="string")throw sourceError("source_hash_invalid","Difficulty hash paths must be strings");const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!("value" in descriptor)||!descriptor.enumerable)throw sourceError("source_hash_invalid","Difficulty hash map must contain data properties only");const normalized=normalizePath(key,maximumPathChars);if(seen.has(normalized))throw sourceError("source_hash_invalid","Difficulty hash paths collide after normalization");seen.add(normalized);const hash=optionalExpectedHash(descriptor.value,"expectedDifficultyContentHashes");if(normalized===selectedPath)expected=hash;}return expected;}
/** @param {unknown} value @param {number} maximum @param {string} code @returns {unknown[]} */
function arrayData(value,maximum,code){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum)throw sourceError(code,"Source array is invalid or exceeds its entry limit");const keys=Reflect.ownKeys(value);if(keys.some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw sourceError(code,"Source array contains unsupported fields");const result=[];for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||descriptor.value===undefined)throw sourceError(code,"Source array must contain dense data properties");result.push(descriptor.value);}return result;}
/** @param {unknown} value @param {number} [maximum] */
function boundedDataString(value,maximum=maximumIdentityChars){if(value===undefined||value===null)return"";if(typeof value!=="string"||value.length>maximum)throw sourceError("source_manifest_invalid","Source text field must be a bounded string");return value;}
/** @param {unknown} value @param {string} field */
function optionalIdentity(value,field){if(value===undefined||value===null||value==="")return"";if(typeof value!=="string"||value.length>maximumIdentityChars)throw sourceError("source_options_invalid",`${field} must be a bounded string`);return value;}
/** @param {Uint8Array} bytes @param {string} expected @param {string} mismatchCode */
async function verifyExpectedHash(bytes,expected,mismatchCode){const actual=await prefixedSha256(bytes);if(expected&&actual!==expected)throw sourceError(mismatchCode,`Expected ${expected} but received ${actual}`);return actual;}
/** @param {AbortSignal | undefined} signal */
function checkAbort(signal){if(signal?.aborted)throw sourceError("operation_aborted","Source preparation was cancelled");}
/** @param {number} value @param {number} fallback */
function positive(value,fallback){return Number.isFinite(value)&&value>0?value:fallback;}
/** @param {string} message @param {unknown} cause */
function diagnostic(message,cause){if(cause&&typeof cause==="object"){const descriptor=Object.getOwnPropertyDescriptor(cause,"message");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string"&&descriptor.value)return`${message}: ${descriptor.value.slice(0,4096)}`;}return message;}
/** @param {string} code @param {string} message */
function sourceError(code,message){const error=new Error(message);error.name="AeroAuthoringSourceError";Object.assign(error,{code});return error;}
