// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, parseBeatMapDifficulty, validateAuthoredPackage } from "../src/index.js";
import { buildFlowIntervalOracle } from "../src/converter.js";

const options = {
  difficulty: /** @type {const} */ ("Expert"), songToken: "flow-positive-intervals", songName: "Flow interval oracle",
  bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0,
  spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 0), sourceProvider: "synthetic",
  sourceId: "flow-positive-intervals", sourceVersionHash: "0".repeat(40),
  sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0",
  sourceInfoHash: `sha256:${"0".repeat(64)}`, sourceDifficultyPath: "Expert.dat",
  sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0",
  sourceDifficultyHash: `sha256:${"0".repeat(64)}`, notePalette: null
};

// Source parser and Boxing conversion correctly reject nonpositive obstacles before
// Flow conversion. Feed the Flow builder a normalized-summary-shaped hostile input
// to lock the Flow emitter independently without weakening that stricter boundary.
const parsed = parseBeatMapDifficulty(JSON.stringify({ version: "3.3.0", obstacles: [
  { b: 1, d: 0.5, x: 0, y: 0, w: 1, h: 1 },
  { b: 2, d: 1, x: 1, y: 0, w: 1, h: 1 }
], sliders: [
  { b: 3, tb: 3, x: 0, y: 0, tx: 1, ty: 0, c: 0, d: 8 },
  { b: 4, tb: 3.5, x: 1, y: 0, tx: 2, ty: 0, c: 0, d: 8 },
  { b: 5, tb: 5.5, x: 2, y: 0, tx: 3, ty: 0, c: 0, d: 8 }
], burstSliders: [
  { b: 6, tb: 6, x: 0, y: 0, tx: 1, ty: 0, c: 0, d: 8, sc: 2 },
  { b: 7, tb: 7.5, x: 0, y: 0, tx: 1, ty: 0, c: 0, d: 8, sc: 2 }
] }), "v3");
const invalidObstacle = { ...parsed.obstacles[0], start: 1, duration: 0 };
const negativeObstacle = { ...parsed.obstacles[0], start: 1.5, duration: -0.25 };
const roundoffObstacle = { ...parsed.obstacles[0], start: 1e16, duration: 0.25 };
const summary = { ...parsed, obstacles: [invalidObstacle, negativeObstacle, roundoffObstacle, ...parsed.obstacles] };

// convertDifficulty runs Boxing before Flow, and rejects invalid obstacle windows.
// The test-only Flow builder export exercises the same path used by conversion.
const { chart, trace } = buildFlowIntervalOracle(summary, "Expert", "flow-positive-intervals");
const intervals = /** @type {Record<string,unknown>[]} */ (chart.beats).filter((beat) => ["obstacle", "arc", "burst"].includes(String(beat.type)));
assert.deepEqual(intervals.map((beat) => [beat.type, beat.start, beat.end]), [
  ["obstacle", 1, 1.5], ["obstacle", 2, 3], ["arc", 5, 5.5], ["burst", 7, 7.5]
]);
assert.ok(intervals.every((beat) => Number(beat.end) > Number(beat.start)), "every emitted Flow interval must have positive duration");
assert.deepEqual(trace.events.filter((event) => ["obstacle", "slider", "burstSlider"].includes(String(event.sourceFamily))).map((event) => event.sourceFamily), ["obstacle", "obstacle", "slider", "burstSlider"], "dropped intervals must not acquire emit traces");

const valid = await convertDifficulty(parsed, options);
assert.equal((await validateAuthoredPackage(valid.package)).valid, true, "positive-duration intervals must still produce a valid package");
const flow = /** @type {Record<string,unknown>} */ (valid.charts.find((entry) => entry.mode === "flow"));
assert.deepEqual(/** @type {Record<string,unknown>[]} */ (flow.beats).filter((beat) => ["obstacle", "arc", "burst"].includes(String(beat.type))).map((beat) => [beat.type, beat.start, beat.end]), [
  ["obstacle", 1, 1.5], ["obstacle", 2, 3], ["arc", 5, 5.5], ["burst", 7, 7.5]
]);
console.log("Flow obstacle/arc/burst nonpositive drop and positive retention oracle passed.");
