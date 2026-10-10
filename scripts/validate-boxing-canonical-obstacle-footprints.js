// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, parseBeatMapDifficulty, validateAuthoredPackage } from "../src/index.js";
import { deriveObstacleGridMask } from "@aerobeat/web-contracts/obstacle-contracts";

const hash = `sha256:${"0".repeat(64)}`;
const options = {
  difficulty: /** @type {const} */ ("Expert"), songToken: "obstacle-footprints", songName: "Obstacle Footprints", bpm: 120,
  noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 0),
  sourceProvider: "beatsaver", sourceId: "synthetic-footprints", sourceVersionHash: "0".repeat(40),
  sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.0.0", sourceInfoHash: hash,
  sourceDifficultyPath: "ExpertStandard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"),
  sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: hash, notePalette: null
};
const rect = (x, y, width, height) => ({ schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x, y, width, height });
const original = [
  { b: 2, d: 2, x: 0, y: 2, w: 4, h: 1 }, // squat, intentionally unlike the canonical wall
  { b: 12, d: 2, x: 2, y: 1, w: 1, h: 1 }, // one-column weave left
  { b: 22, d: 2, x: 0, y: 0, w: 1, h: 2 } // one-column weave right
];
const source = parseBeatMapDifficulty(JSON.stringify({ version: "3.3.0", obstacles: original }), "v3");
const result = await convertDifficulty(source, options);
assert.equal((await validateAuthoredPackage(result.package)).valid, true);
const flow = result.charts.find((chart) => chart.mode === "flow");
const boxing = result.charts.find((chart) => chart.mode === "boxing");
assert.ok(flow && boxing);
const sourceObstacles = source.obstacles;
const flowObstacles = /** @type {ReadonlyArray<Record<string, unknown>>} */ (flow.beats).filter((beat) => beat.type === "obstacle");
const obstacles = /** @type {ReadonlyArray<Record<string, unknown>>} */ (boxing.beats).filter((beat) => ["squat", "weave_left", "weave_right"].includes(String(beat.type)));
assert.equal(obstacles.length, 3, "all three spaced singletons survive");
assert.deepEqual(obstacles.map((beat) => [beat.start, beat.end, beat.type]), [[2, 4, "squat"], [12, 14, "weave_left"], [22, 24, "weave_right"]]);
assert.deepEqual(obstacles.map((beat) => beat.gameplayGeometry), [rect(0, -3, 4, 4.5), rect(2, 0, 2, 3), rect(0, 0, 2, 3)]);
const masks = [[0, 1, 2, 3], [2, 3, 6, 7, 10, 11], [0, 1, 4, 5, 8, 9]];
for (let index = 0; index < obstacles.length; index += 1) {
  const beat = obstacles[index];
  const parsed = sourceObstacles[index];
  assert.deepEqual(beat.sourceGeometry, parsed.sourceGeometry, `source ${index} stays exact BeatSaver v3 provenance`);
  assert.deepEqual(/** @type {Record<string, unknown>} */ (flowObstacles[index]).sourceGeometry, parsed.sourceGeometry, "Flow source unchanged");
  assert.deepEqual(/** @type {Record<string, unknown>} */ (flowObstacles[index]).gameplayGeometry, parsed.gameplayGeometry, "Flow gameplay geometry unchanged");
  assert.deepEqual(beat.gridMask, deriveObstacleGridMask(/** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (beat.gameplayGeometry)));
  assert.deepEqual(beat.gridMask, masks[index]);
  assert.deepEqual(beat.blockedCells, masks[index]);
  assert.deepEqual(/** @type {{noseSafeCells:number[]}} */ (beat.checkpoint).noseSafeCells, Array.from({ length: 12 }, (_, cell) => cell).filter((cell) => !masks[index].includes(cell)));
  assert.deepEqual(/** @type {Record<string, unknown>} */ (flowObstacles[index]).gridMask, deriveObstacleGridMask(/** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (parsed.gameplayGeometry)));
}

// Consecutive same-source types still advance through the original cycle;
// dropped obstacles retain the pre-existing 4-second cooldown policy.
const cycling = await convertDifficulty(parseBeatMapDifficulty(JSON.stringify({ version: "3.3.0", obstacles: [
  { ...original[1], b: 2 }, { ...original[1], b: 12 }, { ...original[1], b: 22 }
] }), "v3"), options);
const cycled = /** @type {ReadonlyArray<Record<string, unknown>>} */ (cycling.charts.find((chart) => chart.mode === "boxing")?.beats ?? []).filter((beat) => ["squat", "weave_left", "weave_right"].includes(String(beat.type)));
assert.deepEqual(cycled.map((beat) => beat.type), ["weave_left", "weave_right", "weave_left"]);
assert.deepEqual(cycled.map((beat) => beat.gameplayGeometry), [rect(2, 0, 2, 3), rect(0, 0, 2, 3), rect(2, 0, 2, 3)]);
const cooldown = await convertDifficulty(parseBeatMapDifficulty(JSON.stringify({ version: "3.3.0", obstacles: [
  { ...original[0], b: 2 }, { ...original[1], b: 11.99 }, { ...original[2], b: 12 }
] }), "v3"), options);
const surviving = /** @type {ReadonlyArray<Record<string, unknown>>} */ (cooldown.charts.find((chart) => chart.mode === "boxing")?.beats ?? []).filter((beat) => ["squat", "weave_left", "weave_right"].includes(String(beat.type)));
assert.deepEqual(surviving.map((beat) => beat.start), [2, 12], "second wall at 11.99 beats drops; 12 beats meets the four-second cooldown from end beat 4");

const legacy = parseBeatMapDifficulty(JSON.stringify({ _version: "2.0.0", _obstacles: [{ _time: 2, _duration: 2, _lineIndex: 1, _type: 0, _width: 1 }] }), "v2");
const legacyResult = await convertDifficulty(legacy, { ...options, sourceBeatmapFormat: /** @type {const} */ ("v2"), sourceBeatmapVersion: "2.0.0" });
const legacyObstacle = /** @type {ReadonlyArray<Record<string, unknown>>} */ (legacyResult.charts.find((chart) => chart.mode === "boxing")?.beats ?? []).find((beat) => String(beat.type).startsWith("weave_"));
assert.ok(legacyObstacle);
assert.deepEqual(legacyObstacle.sourceGeometry, legacy.obstacles[0].sourceGeometry, "v2 source kind and coordinates survive canonical Boxing geometry");
assert.equal(/** @type {Record<string, unknown>} */ (legacyObstacle.sourceGeometry).kind, "v2_type_0");
assert.deepEqual(legacyObstacle.gameplayGeometry, rect(0, 0, 2, 3));
assert.equal((await validateAuthoredPackage(legacyResult.package)).valid, true);
console.log("Boxing fresh v3/v2 source provenance, canonical footprints, masks, checkpoints, cooldown, and cycling passed.");
