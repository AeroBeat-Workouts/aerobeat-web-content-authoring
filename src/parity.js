// @ts-check

import { canonicalJson, isPlainRecord, prefixedSha256 } from "./canonical.js";

/**
 * Cross-language semantic projection. It deliberately excludes language-specific
 * canonical JSON hashes while preserving identities, lineage, event ordering,
 * targets, checkpoints and Flow semantics.
 *
 * @param {unknown} packageValue
 */
export function semanticParityProjection(packageValue) {
  if (!isPlainRecord(packageValue) || !Array.isArray(packageValue.charts)) throw new TypeError("Package charts are required for semantic parity");
  return {
    packageSchema: packageValue.schemaId,
    source: isPlainRecord(packageValue.source) ? { provider: packageValue.source.provider, sourceId: packageValue.source.sourceId, sourceVersionHash: packageValue.source.sourceVersionHash, difficulty: packageValue.source.difficulty } : null,
    charts: packageValue.charts.map((chart) => {
      if (!isPlainRecord(chart)) return null;
      return {
        chartId: chart.chartId,
        mode: chart.mode,
        difficulty: chart.difficulty,
        recipeId: isPlainRecord(chart.prototype) ? chart.prototype.recipeId : null,
        rulesetId: isPlainRecord(chart.prototype) ? chart.prototype.rulesetId : null,
        modifiers: isPlainRecord(chart.prototype) ? chart.prototype.modifiers : [],
        beats: Array.isArray(chart.beats) ? chart.beats.map(projectBeat) : []
      };
    })
  };
}

/** @param {unknown} beat */
function projectBeat(beat) {
  if (!isPlainRecord(beat)) return null;
  const projected = {};
  for (const key of ["start", "end", "type", "eventId", "sourceEventIds", "hand", "placement", "direction", "angleOffset", "requiresDirection", "cells", "startPlacement", "endPlacement", "startDirection", "endDirection", "tailPlacement", "checkpointCount", "modifier", "spatialTarget", "guardTarget", "checkpoint", "blockedCells"]) {
    if (Object.hasOwn(beat, key)) projected[key] = beat[key];
  }
  return projected;
}

/** @param {unknown} packageValue */
export async function semanticParityHash(packageValue) {
  return prefixedSha256(canonicalJson(semanticParityProjection(packageValue)));
}
