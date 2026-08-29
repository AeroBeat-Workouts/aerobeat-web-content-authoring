// @ts-check

import { canonicalJson, isPlainRecord, prefixedSha256 } from "./canonical.js";
import { normalizeConverterProfile } from "./converter-profile.js";
import { boxingPrototypeContractId, cutFamilyRecipeId, recipeDefinitions, recipeVersion, rowFamilyRecipeId, rulesetDefinitions, rulesetVersion, semanticTrackRulesetId, spatialGridRulesetId, supportedModifiers, timingWindowMs, freshnessMs } from "./definitions.js";

/**
 * Validate the canonical browser-authored package before persistence/export.
 *
 * @param {unknown} packageValue
 * @returns {Promise<Readonly<{valid: boolean, issues: readonly Readonly<{code: string, path: string, message: string}>[], packageHash: string | null}>>}
 */
export async function validateAuthoredPackage(packageValue) {
  const issues = [];
  const issue = (code, path, message) => issues.push(Object.freeze({ code, path, message }));
  if (!isPlainRecord(packageValue)) {
    issue("package_invalid", "", "Package must be a plain record");
    return Object.freeze({ valid: false, issues: Object.freeze(issues), packageHash: null });
  }
  let canonicalPackage;
  try { canonicalPackage=canonicalJson(packageValue); if(new TextEncoder().encode(canonicalPackage).byteLength>64*1024*1024)throw new TypeError("Package exceeds the validation size limit"); }
  catch(cause){issue("package_serialization_invalid","",cause instanceof Error?cause.message:"Package cannot be serialized");return Object.freeze({valid:false,issues:Object.freeze(issues),packageHash:null});}
  if (packageValue.schemaId !== "aerobeat.song-package.v1" || packageValue.schemaVersion !== 1) issue("package_schema_invalid", "schemaId", "Package schema must be aerobeat.song-package.v1 version 1");
  if (!nonEmpty(packageValue.packageId) || !nonEmpty(packageValue.songId)) issue("package_identity_invalid", "packageId", "Package and song identities are required");
  try {
    if (canonicalJson(packageValue.recipeDefinitions) !== canonicalJson(recipeDefinitions)) issue("recipe_definitions_invalid", "recipeDefinitions", "Recipe definitions must exactly match the frozen authoring contract");
    if (canonicalJson(packageValue.rulesetDefinitions) !== canonicalJson(rulesetDefinitions)) issue("ruleset_definitions_invalid", "rulesetDefinitions", "Ruleset definitions must exactly match the frozen authoring contract");
  } catch { issue("definitions_invalid", "recipeDefinitions", "Definitions must be canonical plain data"); }
  const sourceProfile=isPlainRecord(packageValue.source)?packageValue.source.converterProfile:undefined;const traceProfile=isPlainRecord(packageValue.conversionTrace)?packageValue.conversionTrace.converterProfile:undefined;
  /** @type {Readonly<Record<string,unknown>> | null} */ let converterProfile=null;
  if(sourceProfile!==undefined||traceProfile!==undefined){try{converterProfile=await normalizeConverterProfile(sourceProfile);if(canonicalJson(traceProfile)!==canonicalJson(converterProfile))issue("converter_profile_trace_mismatch","conversionTrace.converterProfile","Conversion trace profile must exactly match package source provenance");}catch(cause){issue("converter_profile_invalid","source.converterProfile",cause instanceof Error?cause.message:"Converter profile is invalid");}}
  const charts = Array.isArray(packageValue.charts) ? packageValue.charts : [];
  if (charts.length !== 5) issue("chart_count_invalid", "charts", "One difficulty must contain Flow plus four Boxing charts");
  const chartIds = new Set(); const matrix = new Set(); let flowCount = 0;
  for (let index = 0; index < charts.length; index += 1) {
    const chart = charts[index]; const path = `charts[${index}]`;
    if (!isPlainRecord(chart)) { issue("chart_invalid", path, "Chart must be a plain record"); continue; }
    const chartId = String(chart.chartId ?? "");
    if (!chartId || chartIds.has(chartId)) issue("chart_identity_invalid", `${path}.chartId`, "Chart IDs must be non-empty and unique");
    chartIds.add(chartId);
    if (!Array.isArray(chart.beats)) { issue("chart_beats_invalid", `${path}.beats`, "Chart beats must be an array"); continue; }
    if (chart.mode === "flow") { flowCount += 1; for (let beatIndex = 0; beatIndex < chart.beats.length; beatIndex += 1) validateFlowBeat(chart.beats[beatIndex], `${path}.beats[${beatIndex}]`, issue); continue; }
    if (chart.mode !== "boxing" || !isPlainRecord(chart.prototype)) { issue("boxing_chart_invalid", path, "Boxing chart prototype metadata is required"); continue; }
    const prototype = chart.prototype;
    if (prototype.contractId !== boxingPrototypeContractId) issue("prototype_contract_invalid", `${path}.prototype.contractId`, "Prototype contract mismatch");
    if (![rowFamilyRecipeId, cutFamilyRecipeId].includes(String(prototype.recipeId))) issue("prototype_recipe_invalid", `${path}.prototype.recipeId`, "Unknown recipe");
    if (![semanticTrackRulesetId, spatialGridRulesetId].includes(String(prototype.rulesetId))) issue("prototype_ruleset_invalid", `${path}.prototype.rulesetId`, "Unknown ruleset");
    if (prototype.recipeVersion !== recipeVersion || prototype.rulesetVersion !== rulesetVersion) issue("prototype_version_invalid", `${path}.prototype`, "Prototype recipe/ruleset versions must match frozen definitions");
    matrix.add(`${String(prototype.recipeId)}|${String(prototype.rulesetId)}`);
    for (const hashName of ["sourceHash", "recipeHash", "rulesetHash", "contentHash"]) if (!validHash(prototype[hashName])) issue("prototype_hash_invalid", `${path}.prototype.${hashName}`, "Hash must be sha256 plus 64 lowercase hexadecimal digits");
    if(converterProfile){try{if(canonicalJson(prototype.converterProfile)!==canonicalJson(converterProfile))issue("converter_profile_chart_mismatch",`${path}.prototype.converterProfile`,"Chart converter profile must exactly match package provenance");const expectedContentHash=await prefixedSha256(canonicalJson({beats:chart.beats,recipeId:prototype.recipeId,rulesetId:prototype.rulesetId,sourceHash:prototype.sourceHash,converterProfile}));if(prototype.contentHash!==expectedContentHash)issue("converter_profile_content_hash_mismatch",`${path}.prototype.contentHash`,"Chart content hash must bind converter profile identity and generated beats");}catch{issue("converter_profile_chart_mismatch",`${path}.prototype.converterProfile`,"Chart converter profile is invalid");}}else if(prototype.converterProfile!==undefined)issue("converter_profile_unbound",`${path}.prototype.converterProfile`,"Chart converter profile requires package source provenance");
    const modifiers = Array.isArray(prototype.modifiers) ? prototype.modifiers.map(String) : [];
    const normalizedModifiers = [...new Set(modifiers)].sort();
    const emittedModifiers = [...new Set(chart.beats.filter(isPlainRecord).map((beat) => beat.modifier).filter((value) => typeof value === "string"))];
    if (!Array.isArray(prototype.modifiers) || modifiers.some((modifier) => !supportedModifiers.includes(modifier)) || canonicalJson(modifiers) !== canonicalJson(normalizedModifiers) || emittedModifiers.some((modifier) => !modifiers.includes(modifier))) issue("prototype_modifiers_invalid", `${path}.prototype.modifiers`, "Prototype modifiers must be sorted unique recognized union including emitted modifiers");
    for (let beatIndex = 0; beatIndex < chart.beats.length; beatIndex += 1) validateBeat(chart.beats[beatIndex], `${path}.beats[${beatIndex}]`, issue);
  }
  if (flowCount !== 1 || matrix.size !== 4) issue("prototype_matrix_invalid", "charts", "Charts must contain one Flow and all four recipe/ruleset combinations");
  const sets = Array.isArray(packageValue.sets) ? packageValue.sets : [];
  if (sets.length !== charts.length || new Set(sets.filter(isPlainRecord).map((set) => set.setId)).size !== charts.length || sets.some((set) => !isPlainRecord(set) || !chartIds.has(String(set.chartId)) || set.songId !== packageValue.songId)) issue("set_identity_invalid", "sets", "Every chart requires a unique correctly-linked set");
  let packageHash = null;
  try { packageHash = await prefixedSha256(canonicalPackage); } catch (cause) { issue("package_serialization_invalid", "", cause instanceof Error ? cause.message : "Package cannot be serialized"); }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues), packageHash });
}

/** @param {unknown} beat @param {string} path @param {(code: string, path: string, message: string) => void} issue */
function validateBeat(beat, path, issue) {
  if (!isPlainRecord(beat)) { issue("beat_invalid", path, "Beat must be a plain record"); return; }
  if (!Number.isFinite(beat.start) || Number(beat.start) < 0 || !nonEmpty(beat.type)) issue("beat_shape_invalid", path, "Beat start/type are invalid");
  if (!nonEmpty(beat.eventId) || !Array.isArray(beat.sourceEventIds) || beat.sourceEventIds.some((entry) => !nonEmpty(entry))) issue("beat_lineage_invalid", path, "Boxing beat event/source IDs are required");
  if (String(beat.type) === "guard") {
    if (beat.timingWindowMs !== timingWindowMs || beat.evidenceFreshnessMs !== freshnessMs) issue("beat_timing_invalid", path, "Guard timing/freshness must match the frozen contract");
    if (!isPlainRecord(beat.guardTarget) || !integerRange(beat.guardTarget.leftCell, 0, 11) || !integerRange(beat.guardTarget.rightCell, 0, 11)) issue("guard_target_invalid", `${path}.guardTarget`, "Guard cells must use athlete 0..11 IDs");
    if (!isPlainRecord(beat.checkpoint) || beat.checkpoint.kind !== "instantaneous" || beat.checkpoint.timingWindowMs !== timingWindowMs || beat.checkpoint.freshnessMs !== freshnessMs) issue("guard_checkpoint_invalid", `${path}.checkpoint`, "Guard checkpoint must use frozen instantaneous timing");
  }
  if (/^(straight|hook|uppercut)_/u.test(String(beat.type))) {
    if (beat.timingWindowMs !== timingWindowMs || beat.evidenceFreshnessMs !== freshnessMs) issue("beat_timing_invalid", path, "Punch timing/freshness must match the frozen contract");
    if (!isPlainRecord(beat.spatialTarget) || !integerRange(beat.spatialTarget.targetCell, 0, 11) || !Array.isArray(beat.spatialTarget.acceptedSubcells) || beat.spatialTarget.acceptedSubcells.some((entry) => !integerRange(entry, 0, 47))) issue("spatial_target_invalid", `${path}.spatialTarget`, "Punch spatial target must use athlete grid/subgrid IDs");
  }
  if (/^(squat|weave_)/u.test(String(beat.type))) {
    if (!Array.isArray(beat.blockedCells) || beat.blockedCells.some((entry) => !integerRange(entry, 0, 11))) issue("blocked_cells_invalid", `${path}.blockedCells`, "Obstacle cells must use athlete 0..11 IDs");
    if (!isPlainRecord(beat.checkpoint) || beat.checkpoint.kind !== "instantaneous" || beat.checkpoint.timingWindowMs !== timingWindowMs || beat.checkpoint.freshnessMs !== freshnessMs || !Array.isArray(beat.checkpoint.noseSafeCells)) issue("obstacle_checkpoint_invalid", `${path}.checkpoint`, "Avoidance checkpoint requires frozen timing and nose safe cells");
  }
}
/** @param {unknown} beat @param {string} path @param {(code: string, path: string, message: string) => void} issue */
function validateFlowBeat(beat,path,issue){
  if(!isPlainRecord(beat)||!Number.isFinite(beat.start)||Number(beat.start)<0||!["note","bomb","obstacle","arc","burst"].includes(String(beat.type))){issue("flow_beat_invalid",path,"Flow beat shape/type is invalid");return;}
  if(["note","bomb"].includes(String(beat.type))&&!integerRange(beat.placement,0,11))issue("flow_placement_invalid",`${path}.placement`,"Flow placement must be 0..11");
  if(String(beat.type)==="obstacle"&&(!Number.isFinite(beat.end)||!Array.isArray(beat.cells)||beat.cells.length===0||beat.cells.some((cell)=>!integerRange(cell,0,11))))issue("flow_obstacle_invalid",path,"Flow obstacle is invalid");
  if(String(beat.type)==="arc"&&(!Number.isFinite(beat.end)||!integerRange(beat.startPlacement,0,11)||!integerRange(beat.endPlacement,0,11)||!Number.isInteger(beat.startDirection)||!Number.isInteger(beat.endDirection)))issue("flow_arc_invalid",path,"Flow arc is invalid");
  if(String(beat.type)==="burst"&&(!Number.isFinite(beat.end)||!integerRange(beat.placement,0,11)||!integerRange(beat.tailPlacement,0,11)||!Number.isInteger(beat.checkpointCount)||Number(beat.checkpointCount)<1))issue("flow_burst_invalid",path,"Flow burst is invalid");
}
/** @param {unknown} value */
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
/** @param {unknown} value */
function validHash(value) { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
/** @param {unknown} value @param {number} minimum @param {number} maximum */
function integerRange(value, minimum, maximum) { return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum; }
