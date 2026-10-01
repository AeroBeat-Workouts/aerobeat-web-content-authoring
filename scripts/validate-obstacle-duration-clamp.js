// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, validateAuthoredPackage } from "../src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = {
  difficulty: /** @type {const} */ ("Expert"), songToken: "obstacle-clamp", songName: "Obstacle Clamp", bpm: 120,
  noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 0),
  sourceProvider: "synthetic", sourceId: "obstacle-clamp", sourceVersionHash: "0".repeat(40),
  sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.0.0", sourceInfoHash: hash,
  sourceDifficultyPath: "ExpertStandard.dat", sourceBeatmapFormat: /** @type {const} */ ("v2"),
  sourceBeatmapVersion: "2.0.0", sourceDifficultyHash: hash, notePalette: null,
  converterSettings: { maxObstacleDurationMs: 3000, obstacleCooldownMs: 4000 }
};
const geometry = { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 2, width: 4, height: 1 };
const sourceGeometry = { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 0, y: 2, width: 4, height: 1 };
const summary = {
  colorNotes: [
    { start: 7, cell: 1, hand: "left", direction: 8, sourceIndex: 0 },
    { start: 8.5, cell: 1, hand: "left", direction: 8, sourceIndex: 1 },
    { start: 12.5, cell: 2, hand: "right", direction: 8, sourceIndex: 2 }
  ],
  bombNotes: [], sliders: [], burstSliders: [],
  obstacles: [{ start: 2, duration: 10, sourceGeometry, gameplayGeometry: geometry }]
};
const result = await convertDifficulty(summary, options);
const boxing = result.charts.find((chart) => chart.mode === "boxing");
assert.ok(boxing);
const beats = /** @type {ReadonlyArray<Record<string, unknown>>} */ (boxing.beats);
const obstacles = beats.filter((beat) => /^(squat|weave_)/u.test(String(beat.type)));
assert.equal(obstacles.length, 1);
assert.equal(obstacles[0].start, 2);
assert.equal(obstacles[0].end, 8, "three seconds at 120 BPM is six beats");
const punchStarts = beats.filter((beat) => /^(straight|hook|uppercut)_/u.test(String(beat.type))).map((beat) => beat.start);
assert.ok(!punchStarts.includes(7), "punch inside the clamped obstacle must be blocked");
assert.ok(punchStarts.includes(8.5), "punch after the clamped end and timing edge must survive");
assert.ok(punchStarts.includes(12.5), "punch after the original obstacle end must survive");
assert.equal((await validateAuthoredPackage(result.package)).valid, true);

// Keep the edge candidate isolated so punch spacing cannot reject it first.
const edge = await convertDifficulty({ ...summary, colorNotes: [
  { start: 8.25, cell: 2, hand: "right", direction: 8, sourceIndex: 0 }
] }, options);
const edgeBoxing = edge.charts.find((chart) => chart.mode === "boxing");
assert.ok(edgeBoxing);
assert.ok(!/** @type {ReadonlyArray<Record<string, unknown>>} */ (edgeBoxing.beats).some((beat) => /^(straight|hook|uppercut)_/u.test(String(beat.type))), "punch inside the 180ms timing edge must be blocked");
console.log("Boxing obstacle clamp uses the emitted end plus timing edge for punch blocking.");
