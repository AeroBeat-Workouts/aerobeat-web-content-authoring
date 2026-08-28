// @ts-check

import { deepFreeze, isPlainRecord } from "./canonical.js";

/** @typedef {{manifest: Record<string, unknown>, listEntryPaths: () => readonly string[], readEntry: (path: string) => Uint8Array}} SourceBundle */

/**
 * Adapt the vendor bundle closure into a structured-clone-safe Worker request plus
 * child-local assets. Only selected entry copies are read.
 *
 * @param {unknown} acquired
 * @param {{difficulty: string, sourceProvider?: string, sourceId?: string, sourceVersionHash?: string, cacheSourceEntries?: boolean}} options
 */
export function prepareSourceMaterial(acquired, options) {
  if (!isPlainRecord(acquired)) throw sourceError("source_invalid", "Source acquisition result must be a plain record");
  const source = isPlainRecord(acquired.source) ? acquired.source : acquired;
  if (!isSourceBundle(source)) throw sourceError("source_bundle_invalid", "Source must expose manifest, listEntryPaths and readEntry");
  const manifest = source.manifest;
  const difficulties = Array.isArray(manifest.difficulties) ? manifest.difficulties : [];
  const wanted = normalizeDifficulty(options.difficulty);
  const selected = difficulties.find((entry) => isPlainRecord(entry) && entry.characteristic === "Standard" && normalizeDifficulty(String(entry.difficulty ?? "")) === wanted);
  if (!selected || typeof selected.path !== "string" || !selected.path) throw sourceError("difficulty_unavailable", `Standard ${wanted} is not available in this source`);
  const listed = source.listEntryPaths();
  if (!Array.isArray(listed) || !listed.every((entry) => typeof entry === "string")) throw sourceError("source_paths_invalid", "Source entry list is invalid");
  const difficultyBytes = source.readEntry(selected.path);
  if (!(difficultyBytes instanceof Uint8Array)) throw sourceError("source_entry_invalid", "Difficulty entry must be a Uint8Array copy");
  const audioPath = typeof manifest.audioPath === "string" ? manifest.audioPath : "";
  const audioBytes = audioPath ? source.readEntry(audioPath) : new Uint8Array();
  const cache = [];
  if (options.cacheSourceEntries) {
    for (const path of [String(manifest.infoPath ?? ""), selected.path].filter(Boolean)) cache.push({ path, bytes: Uint8Array.from(source.readEntry(path)) });
  }
  const sourceProvider = options.sourceProvider ?? (typeof acquired.providerId === "string" ? acquired.providerId : "local");
  const map = isPlainRecord(acquired.map) ? acquired.map : {};
  const version = isPlainRecord(acquired.version) ? acquired.version : {};
  const sourceId = options.sourceId ?? String(map.mapId ?? manifest.songName ?? "local-import");
  const sourceVersionHash = options.sourceVersionHash ?? String(version.hash ?? acquired.sourceHash ?? "local-unverified");
  const requestManifest = deepFreeze({
    schemaId: "aerobeat.authoring-source.v1",
    sourceFormatMajor: Number(manifest.sourceFormatMajor),
    infoPath: String(manifest.infoPath ?? ""),
    songName: String(manifest.songName ?? "Imported Song"),
    songAuthorName: String(manifest.songAuthorName ?? ""),
    levelAuthorName: String(manifest.levelAuthorName ?? ""),
    bpm: positive(Number(manifest.bpm), 120),
    audioPath,
    selectedDifficulty: { difficulty: wanted, path: selected.path },
    sourceProvider,
    sourceId,
    sourceVersionHash
  });
  return deepFreeze({ requestManifest, difficultyBytes: Uint8Array.from(difficultyBytes), audio: audioPath ? [{ path: audioPath, bytes: Uint8Array.from(audioBytes) }] : [], sourceCache: cache });
}

/** @param {unknown} value @returns {value is SourceBundle} */
function isSourceBundle(value) { return isPlainRecord(value) && isPlainRecord(value.manifest) && typeof value.listEntryPaths === "function" && typeof value.readEntry === "function"; }
/** @param {string} value */
function normalizeDifficulty(value) { const compact=value.toLowerCase().replace(/[^a-z]/gu,""); const names={easy:"Easy",normal:"Normal",hard:"Hard",expert:"Expert",expertplus:"ExpertPlus"}; const result=names[/** @type {keyof typeof names} */(compact)]; if(!result)throw sourceError("difficulty_invalid","Difficulty must be Easy, Normal, Hard, Expert or ExpertPlus"); return result; }
/** @param {number} value @param {number} fallback */
function positive(value,fallback){return Number.isFinite(value)&&value>0?value:fallback;}
/** @param {string} code @param {string} message */
function sourceError(code,message){const error=new Error(message);error.name="AeroAuthoringSourceError";Object.assign(error,{code});return error;}
