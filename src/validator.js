// @ts-check

import { canonicalJson, isPlainRecord, prefixedSha256 } from "./canonical.js";
import { boxingPrototypeContractId, cutFamilyRecipeId, rowFamilyRecipeId, semanticTrackRulesetId, spatialGridRulesetId, supportedModifiers } from "./definitions.js";

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
  if (packageValue.schemaId !== "aerobeat.song-package.v1" || packageValue.schemaVersion !== 1) issue("package_schema_invalid", "schemaId", "Package schema must be aerobeat.song-package.v1 version 1");
  if (!nonEmpty(packageValue.packageId) || !nonEmpty(packageValue.songId)) issue("package_identity_invalid", "packageId", "Package and song identities are required");
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
    if (chart.mode === "flow") { flowCount += 1; continue; }
    if (chart.mode !== "boxing" || !isPlainRecord(chart.prototype)) { issue("boxing_chart_invalid", path, "Boxing chart prototype metadata is required"); continue; }
    const prototype = chart.prototype;
    if (prototype.contractId !== boxingPrototypeContractId) issue("prototype_contract_invalid", `${path}.prototype.contractId`, "Prototype contract mismatch");
    if (![rowFamilyRecipeId, cutFamilyRecipeId].includes(String(prototype.recipeId))) issue("prototype_recipe_invalid", `${path}.prototype.recipeId`, "Unknown recipe");
    if (![semanticTrackRulesetId, spatialGridRulesetId].includes(String(prototype.rulesetId))) issue("prototype_ruleset_invalid", `${path}.prototype.rulesetId`, "Unknown ruleset");
    matrix.add(`${String(prototype.recipeId)}|${String(prototype.rulesetId)}`);
    for (const hashName of ["sourceHash", "recipeHash", "rulesetHash", "contentHash"]) if (!validHash(prototype[hashName])) issue("prototype_hash_invalid", `${path}.prototype.${hashName}`, "Hash must be sha256 plus 64 lowercase hexadecimal digits");
    if (!Array.isArray(prototype.modifiers) || prototype.modifiers.some((modifier) => !supportedModifiers.includes(String(modifier)))) issue("prototype_modifiers_invalid", `${path}.prototype.modifiers`, "Prototype modifiers must be recognized");
    for (let beatIndex = 0; beatIndex < chart.beats.length; beatIndex += 1) validateBeat(chart.beats[beatIndex], `${path}.beats[${beatIndex}]`, issue);
  }
  if (flowCount !== 1 || matrix.size !== 4) issue("prototype_matrix_invalid", "charts", "Charts must contain one Flow and all four recipe/ruleset combinations");
  const sets = Array.isArray(packageValue.sets) ? packageValue.sets : [];
  if (sets.length !== charts.length || new Set(sets.filter(isPlainRecord).map((set) => set.setId)).size !== charts.length) issue("set_identity_invalid", "sets", "Every chart requires a unique set");
  let packageHash = null;
  try { packageHash = await prefixedSha256(canonicalJson(packageValue)); } catch (cause) { issue("package_serialization_invalid", "", cause instanceof Error ? cause.message : "Package cannot be serialized"); }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues), packageHash });
}

/** @param {unknown} beat @param {string} path @param {(code: string, path: string, message: string) => void} issue */
function validateBeat(beat, path, issue) {
  if (!isPlainRecord(beat)) { issue("beat_invalid", path, "Beat must be a plain record"); return; }
  if (!Number.isFinite(beat.start) || Number(beat.start) < 0 || !nonEmpty(beat.type)) issue("beat_shape_invalid", path, "Beat start/type are invalid");
  if (!nonEmpty(beat.eventId) || !Array.isArray(beat.sourceEventIds) || beat.sourceEventIds.some((entry) => !nonEmpty(entry))) issue("beat_lineage_invalid", path, "Boxing beat event/source IDs are required");
  if (String(beat.type) === "guard") {
    if (!isPlainRecord(beat.guardTarget) || !integerRange(beat.guardTarget.leftCell, 0, 11) || !integerRange(beat.guardTarget.rightCell, 0, 11)) issue("guard_target_invalid", `${path}.guardTarget`, "Guard cells must use athlete 0..11 IDs");
    if (!isPlainRecord(beat.checkpoint) || beat.checkpoint.kind !== "instantaneous") issue("guard_checkpoint_invalid", `${path}.checkpoint`, "Guard checkpoint must be instantaneous");
  }
  if (/^(straight|hook|uppercut)_/u.test(String(beat.type))) {
    if (!isPlainRecord(beat.spatialTarget) || !integerRange(beat.spatialTarget.targetCell, 0, 11) || !Array.isArray(beat.spatialTarget.acceptedSubcells) || beat.spatialTarget.acceptedSubcells.some((entry) => !integerRange(entry, 0, 47))) issue("spatial_target_invalid", `${path}.spatialTarget`, "Punch spatial target must use athlete grid/subgrid IDs");
  }
  if (/^(squat|weave_)/u.test(String(beat.type))) {
    if (!Array.isArray(beat.blockedCells) || beat.blockedCells.some((entry) => !integerRange(entry, 0, 11))) issue("blocked_cells_invalid", `${path}.blockedCells`, "Obstacle cells must use athlete 0..11 IDs");
    if (!isPlainRecord(beat.checkpoint) || !Array.isArray(beat.checkpoint.noseSafeCells)) issue("obstacle_checkpoint_invalid", `${path}.checkpoint`, "Avoidance checkpoint requires nose safe cells");
  }
}
/** @param {unknown} value */
function nonEmpty(value) { return typeof value === "string" && value.trim().length > 0; }
/** @param {unknown} value */
function validHash(value) { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
/** @param {unknown} value @param {number} minimum @param {number} maximum */
function integerRange(value, minimum, maximum) { return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum; }
