// @ts-check

import assert from "node:assert/strict";
import { canonicalJson, convertDifficulty, deriveBeatSaberSpawnTiming, normalizeConverterProfile, sha256Hex, validateAuthoredPackage } from "../src/index.js";
import { executeWorkerConversion } from "../src/worker-protocol.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Hard"), songToken: "opposite-lane", songName: "Opposite Lane", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1), sourceProvider: "synthetic", sourceId: "opposite-lane", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: hash, sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: hash, notePalette: null };
// Bottom-left cells: top row produces uppercuts, middle row produces straight/any beats.
const summary = { colorNotes: [{ start: 2, cell: 9, hand: "left", direction: 0, sourceIndex: 0 }, { start: 4, cell: 6, hand: "right", direction: 8, sourceIndex: 1 }], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };

/** @param {Record<string, unknown>} settings */
async function profileFor(settings) {
  const body = { schema: "aerobeat/prototype_profile", version: 1, profileId: "aero.converter.opposite-lane-oracle", profileVersion: "1.0.0", class: "converter_regeneration", settings: { guardRelocationRadius: 8, reachAllowanceSubcells: 8, ...settings } };
  return normalizeConverterProfile({ ...body, label: "Opposite lane oracle", experimental: true, contentHash: await sha256Hex(canonicalJson(body)) });
}
/** @param {Awaited<ReturnType<typeof convertDifficulty>>} result @param {string} type */
function targetCell(result, type) {
  const chart = result.charts.find((entry) => entry.mode === "boxing");
  assert.ok(chart);
  const beat = /** @type {{spatialTarget:{targetCell:number}}} */ (/** @type {unknown} */ ((/** @type {Record<string, unknown>[]} */ (chart.beats)).find((entry) => entry.type === type)));
  assert.ok(beat, `${type} must emit`);
  return beat.spatialTarget.targetCell;
}
const defaultResult = await convertDifficulty(summary, { ...options, modifiers: ["any_punch"] });
assert.equal(targetCell(defaultResult, "uppercut_left") % 4, 1, "uppercut defaults to its own lane");
assert.equal(targetCell(defaultResult, "straight_right") % 4, 1, "any beat defaults to opposite lane");
assert.equal((await validateAuthoredPackage(defaultResult.package)).valid, true);

const profile = await profileFor({ uppercutOppositeLane: true, anyOppositeLane: false, guardSpacing: 2 });
assert.equal(profile.settings.uppercutOppositeLane, true);
assert.equal(profile.settings.anyOppositeLane, false);
const overridden = await convertDifficulty(summary, { ...options, modifiers: ["any_punch"], converterProfile: profile });
assert.equal(targetCell(overridden, "uppercut_left") % 4, 2, "profile overrides uppercut lane");
assert.equal(targetCell(overridden, "straight_right") % 4, 2, "profile overrides any-beat lane");
assert.equal((await validateAuthoredPackage(overridden.package)).valid, true);

for (const invalid of [{ uppercutOppositeLane: "false" }, { anyOppositeLane: 1 }, { guardSpacing: 3 }, { unknownSetting: true }]) {
  await assert.rejects(() => profileFor(invalid), /** @type {(error:unknown)=>boolean} */ ((error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "converter_profile_settings_invalid")));
}

// Exercise the independent Worker request strict-shape guard with the override profile.
const difficulty = { version: "3.3.0", colorNotes: [{ b: 2, x: 1, y: 2, c: 0, d: 0 }, { b: 4, x: 2, y: 1, c: 1, d: 8 }], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
const difficultyBytes = new TextEncoder().encode(JSON.stringify(difficulty));
const difficultyHash = `sha256:${await sha256Hex(difficultyBytes)}`;
const manifest = { schemaId: "aerobeat.authoring-source.v2", infoFormat: "v2", infoVersion: "2.1.0", infoPath: "Info.dat", infoHash: hash, bpm: 120, songName: options.songName, songAuthorName: "", levelAuthorName: "", audioPath: "", audioContentHash: "", sourceProvider: options.sourceProvider, sourceId: options.sourceId, sourceVersionHash: options.sourceVersionHash, selectedDifficulty: { difficulty: options.difficulty, path: options.sourceDifficultyPath, beatMapFormat: options.sourceBeatmapFormat, beatMapVersion: options.sourceBeatmapVersion, contentHash: difficultyHash, notePalette: null, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: options.spawnTiming } };
const workerOptions = { ...options, sourceDifficultyHash: difficultyHash, audioPath: "", audioContentHash: "", modifiers: ["any_punch"], converterProfile: profile };
const request = { schema: "aerobeat/authoring_worker_request", version: 2, kind: "convert", jobId: "opposite-lane-oracle", difficultyBytes, manifest, options: workerOptions };
const workerResult = await executeWorkerConversion(request);
assert.equal(workerResult.schema, "aerobeat/authoring_worker_result");
assert.equal(workerResult.packageHash.length, 71);
console.log("B3.2 opposite-lane defaults, profile overrides, and worker profile guard passed");
