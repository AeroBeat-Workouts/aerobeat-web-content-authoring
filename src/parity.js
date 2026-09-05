// @ts-check

import { canonicalJson, isPlainRecord, prefixedSha256 } from "./canonical.js";

/**
 * Cross-language semantic projection. Language-specific canonical hashes are excluded;
 * definitions, timing, lineage, ordering, targets, checkpoints, modifiers and traces are not.
 *
 * @param {unknown} packageValue
 */
export function semanticParityProjection(packageValue) {
  if (!isPlainRecord(packageValue)) throw new TypeError("Package is required for semantic parity");
  canonicalJson(packageValue);
  if (!Array.isArray(packageValue.charts)) throw new TypeError("Package charts are required for semantic parity");
  return {
    packageSchema: packageValue.schemaId,
    packageSchemaVersion: packageValue.schemaVersion,
    packageVersion: packageValue.packageVersion,
    packageId: packageValue.packageId,
    songId: packageValue.songId,
    source: isPlainRecord(packageValue.source) ? pick(packageValue.source, ["provider", "sourceId", "sourceVersionHash", "difficulty", "sourceDifficultyPath", "sourceBeatmapVersion", "sourceDifficultyHash", "obstacleContract", "converterProfile"]) : null,
    song: isPlainRecord(packageValue.song) ? pick(packageValue.song,["schemaId","schemaVersion","recordVersion","songId","songName","durationSec","audio","timing"]) : null,
    sets: Array.isArray(packageValue.sets) ? packageValue.sets.map((set)=>isPlainRecord(set)?pick(set,["schemaId","schemaVersion","recordVersion","setId","setName","songId","chartId"]):null) : [],
    recipeDefinitions: Array.isArray(packageValue.recipeDefinitions) ? packageValue.recipeDefinitions.map(projectDefinition) : [],
    rulesetDefinitions: Array.isArray(packageValue.rulesetDefinitions) ? packageValue.rulesetDefinitions.map(projectDefinition) : [],
    presentationSuggestion: Object.hasOwn(packageValue,"presentationSuggestion")?packageValue.presentationSuggestion:null,
    charts: packageValue.charts.map((chart) => {
      if (!isPlainRecord(chart)) return null;
      const prototype = isPlainRecord(chart.prototype) ? chart.prototype : null;
      return {
        schemaId: chart.schemaId, schemaVersion: chart.schemaVersion, recordVersion: chart.recordVersion, chartId: chart.chartId, chartName: chart.chartName, mode: chart.mode, difficulty: chart.difficulty, ...(Object.hasOwn(chart,"rulesetId")?{rulesetId:chart.rulesetId}:{}),
        prototype: prototype ? pick(prototype, ["contractId", "recipeId", "recipeVersion", "rulesetId", "rulesetVersion", "modifiers", "converterProfile", "regenerationRequiredFor"]) : null,
        presentationSuggestion: Object.hasOwn(chart, "presentationSuggestion") ? chart.presentationSuggestion : null,
        beats: Array.isArray(chart.beats) ? chart.beats.map(projectBeat) : []
      };
    }),
    traces: projectTraces(packageValue.conversionTrace)
  };
}

/** @param {unknown} value */
function projectDefinition(value){if(!isPlainRecord(value))return null;const result={};for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||/hash/iu.test(key))continue;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(descriptor&&"value" in descriptor&&descriptor.enumerable)result[key]=descriptor.value;}return result;}
/** @param {unknown} value */
function projectTraces(value){if(!isPlainRecord(value))return null;const boxing=Array.isArray(value.boxing)?value.boxing.map((trace)=>isPlainRecord(trace)?{...pick(trace,["chartId","difficulty","bpm","recipeId","rulesetId","sourceDifficultyPath","sourceBeatmapVersion","converterProfile"]),optimizer:trace.optimizer,events:trace.events}:null):[];const flow=Array.isArray(value.flow)?value.flow:null;return{boxing,flow,...(value.converterProfile?{converterProfile:value.converterProfile}:{})};}
/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
function pick(value,keys){const result={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(descriptor&&"value" in descriptor&&descriptor.enumerable)result[key]=descriptor.value;}return result;}
/** @param {unknown} beat */
function projectBeat(beat) {
  if (!isPlainRecord(beat)) return null;
  return pick(beat, ["start", "end", "type", "eventId", "sourceEventIds", "hand", "placement", "direction", "angleOffset", "requiresDirection", "sourceGeometry", "gameplayGeometry", "gridMask", "startPlacement", "endPlacement", "startDirection", "endDirection", "tailPlacement", "checkpointCount", "modifier", "spatialTarget", "guardTarget", "checkpoint", "blockedCells"]);
}
/** @param {unknown} packageValue */
export async function semanticParityHash(packageValue) { return prefixedSha256(canonicalJson(semanticParityProjection(packageValue))); }
