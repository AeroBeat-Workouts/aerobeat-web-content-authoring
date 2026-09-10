// @ts-check

import { canonicalJson } from "./canonical.js";

/** Successor identities. V5 packages deliberately do not contain this binding. */
export const authoredPackageSchemaId = "aerobeat.song-package.v6";
export const authoredPackageSchemaVersion = 6;
export const authoredPackageVersion = "6.0.0";
export const flowChartSchemaId = "aerobeat.chart.flow.v5";
export const flowChartSchemaVersion = 5;
export const flowCollidersRulesetId = "flow_colliders_v1";
/** The retired Flow Grid ruleset ID, accepted only in historical stored bytes. */
export const flowGridRulesetId = "flow_grid_v2";
/** Sole Flow ruleset variant: the Flow (colliders) ruleset. */
export const flowRulesetVariants = Object.freeze([flowCollidersRulesetId]);

/**
 * The single hash-bound Flow identity. Beats and palette remain authored once; the Flow
 * (colliders) ruleset is the sole variant and may never be inferred from package generation.
 *
 * @param {unknown} beats
 * @param {unknown} notePalette
 */
export function flowContentIdentity(beats, notePalette) {
  return { beats, rulesetId: flowCollidersRulesetId, rulesetVariants: [...flowRulesetVariants], notePalette };
}

/**
 * Accept the current single Flow (colliders) variant and, for historical reads only,
 * the legacy two-variant Flow Grid bind that pre-reimport stored v6 packages retain.
 *
 * @param {unknown} value
 */
export function hasExactFlowRulesetVariants(value) {
  if (!Array.isArray(value)) return false;
  try {
    return canonicalJson(value) === canonicalJson(flowRulesetVariants) ||
      canonicalJson(value) === canonicalJson([flowGridRulesetId, flowCollidersRulesetId]);
  } catch { return false; }
}
