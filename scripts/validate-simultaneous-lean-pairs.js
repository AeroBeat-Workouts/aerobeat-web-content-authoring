// @ts-check
// 0.0.88 (Derrick): simultaneous left+right leans become ONE obstacle, cycling
// squat -> weave_left -> weave_right so a song does not feel repetitive.
//
// Verified against the real report: map 952e 'Larger Than Life' Expert authored
// six weave_left + six weave_right obstacles. The simultaneous both-sides pair
// produced two full-height walls with only the middle columns free — the
// "full screen, unavoidable" boxing obstacle. After the rule that pair is a squat
// (top row only) and the worst instant drops from 6 blocked cells to 4.
import assert from "node:assert/strict";
import { canonicalJson, convertDifficulty, deriveBeatSaberSpawnTiming, sha256Hex } from "../src/index.js";
import { normalizeConverterProfile } from "../src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Expert"), songToken: "lean-pair", songName: "Lean Pair", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 0), sourceProvider: "synthetic", sourceId: "lean-pair", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.0.0", sourceInfoHash: hash, sourceDifficultyPath: "ExpertStandard.dat", sourceBeatmapFormat: /** @type {const} */ ("v2"), sourceBeatmapVersion: "2.0.0", sourceDifficultyHash: hash, notePalette: null };

/** Three simultaneous both-sides moments: one left wall + one right wall each. */
const summary = { colorNotes: [], bombNotes: [], sliders: [], burstSliders: [], obstacles: [
  { start: 1, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 0, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 1, height: 3 } },
  { start: 1, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 3, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 3, y: 0, width: 1, height: 3 } },
  { start: 5, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 0, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 1, height: 3 } },
  { start: 5, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 3, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 3, y: 0, width: 1, height: 3 } },
  { start: 9, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 0, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 1, height: 3 } },
  { start: 9, duration: 2, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_0", x: 3, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 3, y: 0, width: 1, height: 3 } }
] };

const result = await convertDifficulty(summary, { ...options, modifiers: ["any_punch"] });
const boxing = result.charts.find((chart) => chart.mode === "boxing");
assert.ok(boxing, "boxing chart must author");
const obstacles = /** @type {ReadonlyArray<Record<string, unknown>>} */ (boxing.beats).filter((beat) => beat.type === "squat" || beat.type === "weave_left" || beat.type === "weave_right");
const types = obstacles.map((beat) => String(beat.type));

// Three both-sides moments collapse to three obstacles, cycling in occurrence order.
assert.deepEqual(types, ["squat", "weave_left", "weave_right"], `both-sides pairs cycle squat -> weave_left -> weave_right, got ${JSON.stringify(types)}`);

// A squat must NOT block the whole grid: it blocks only the top row so the player
// can duck under it. Uniting both walls' cells would re-create the undodgeable case.
const squat = obstacles[0];
assert.deepEqual(squat.blockedCells, [0, 1, 2, 3], "merged squat blocks only the top row");

// No instant may place obstacles on both outer columns at once any more.
const perInstant = new Map();
for (const beat of obstacles) {
  const key = String(beat.start);
  perInstant.set(key, [...(perInstant.get(key) ?? []), .../** @type {number[]} */ (beat.blockedCells)]);
}
for (const [start, cells] of perInstant) {
  const set = new Set(cells);
  const left = [...set].filter((cell) => cell % 4 <= 1);
  const right = [...set].filter((cell) => cell % 4 >= 2);
  const fullHeightOnBothSides = left.length >= 3 && right.length >= 3;
  assert.equal(fullHeightOnBothSides, false, `instant ${start} must not carry full-height walls on both sides`);
}

// Determinism: re-converting the same source is byte-identical.
const again = await convertDifficulty(summary, { ...options, modifiers: ["any_punch"] });
assert.equal(result.packageHash, again.packageHash, "lean-pair merging must be deterministic");

console.log("Simultaneous both-sides leans merge into one cycling obstacle (squat/weave_left/weave_right).");