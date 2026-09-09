// @ts-check

import { canonicalJson } from "./canonical.js";

/** Successor identities. V5 packages deliberately do not contain this binding. */
export const authoredPackageSchemaId = "aerobeat.song-package.v6";
export const authoredPackageSchemaVersion = 6;
export const authoredPackageVersion = "6.0.0";
export const flowChartSchemaId = "aerobeat.chart.flow.v5";
export const flowChartSchemaVersion = 5;
export const flowGridRulesetId = "flow_grid_v2";
export const flowCollidersRulesetId = "flow_colliders_v1";
export const flowRulesetVariants = Object.freeze([flowGridRulesetId, flowCollidersRulesetId]);

/**
 * The single hash-bound Flow identity. Beats and palette remain authored once; variants select
 * scoring semantics over those exact bytes and may never be inferred from package generation.
 *
 * @param {unknown} beats
 * @param {unknown} notePalette
 */
export function flowContentIdentity(beats, notePalette) {
  return { beats, rulesetId: flowGridRulesetId, rulesetVariants: [...flowRulesetVariants], notePalette };
}

/** @param {unknown} value */
export function hasExactFlowRulesetVariants(value) {
  try { return canonicalJson(value) === canonicalJson(flowRulesetVariants); } catch { return false; }
}
