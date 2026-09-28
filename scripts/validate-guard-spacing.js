// @ts-check

import assert from "node:assert/strict";
import { canonicalJson, convertDifficulty, deriveBeatSaberSpawnTiming, normalizeConverterProfile, sha256Hex, validateAuthoredPackage } from "../src/index.js";

const sourceHash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Hard"), songToken: "guard-spacing", songName: "Guard Spacing", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1), sourceProvider: "synthetic", sourceId: "guard-spacing", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: sourceHash, sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: sourceHash, notePalette: null };
const summary = { colorNotes: [{ start: 2, cell: 8, hand: "left", direction: 8, sourceIndex: 0 }, { start: 2, cell: 11, hand: "right", direction: 8, sourceIndex: 1 }], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };

/** @param {number} spacing */
async function profileFor(spacing) {
  const body = { schema: "aerobeat/prototype_profile", version: 1, profileId: `aero.converter.guard-spacing-${spacing}`, profileVersion: "1.0.0", class: "converter_regeneration", settings: { guardRelocationRadius: 8, reachAllowanceSubcells: 8, guardSpacing: spacing } };
  return normalizeConverterProfile({ ...body, label: `Guard spacing ${spacing}`, experimental: true, contentHash: await sha256Hex(canonicalJson(body)) });
}

for (const spacing of [0, 1, 2]) {
  const profile = await profileFor(spacing);
  const result = await convertDifficulty(summary, { ...options, converterProfile: profile });
  const chart = result.charts.find((entry) => entry.mode === "boxing");
  assert.ok(chart, "Boxing chart must be emitted");
  const guard = /** @type {{guardTarget:{leftCell:number,rightCell:number,spacing:number}}} */ (/** @type {unknown} */ ((/** @type {Record<string, unknown>[]} */ (chart.beats)).find((entry) => entry.type === "guard")));
  assert.ok(guard, `spacing ${spacing} must emit a guard`);
  assert.equal(guard.guardTarget.spacing, spacing);
  assert.notEqual(guard.guardTarget.leftCell, guard.guardTarget.rightCell, "hands must occupy distinct cells");
  assert.ok([guard.guardTarget.leftCell, guard.guardTarget.rightCell].every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 11));
  assert.deepEqual([guard.guardTarget.leftCell, guard.guardTarget.rightCell], spacing === 0 ? [5, 6] : spacing === 1 ? [1, 2] : [0, 3]);
  assert.equal((await validateAuthoredPackage(result.package)).valid, true, `spacing ${spacing} package must validate`);
  const rerun = await convertDifficulty(summary, { ...options, converterProfile: profile });
  assert.equal(result.packageHash, rerun.packageHash, `spacing ${spacing} must be deterministic`);
}
for (const invalid of [-1, 3, 0.5, "1", null]) {
  const body = { schema: "aerobeat/prototype_profile", version: 1, profileId: "aero.converter.guard-spacing-invalid", profileVersion: "1.0.0", class: "converter_regeneration", settings: { guardRelocationRadius: 8, reachAllowanceSubcells: 8, guardSpacing: invalid } };
  await assert.rejects(() => normalizeConverterProfile({ ...body, label: "Invalid guard spacing", experimental: true, contentHash: "0".repeat(64) }), /** @type {(error:unknown)=>boolean} */ ((error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "converter_profile_settings_invalid")));
}
console.log("Guard spacing 0/1/2 converter oracle passed");
