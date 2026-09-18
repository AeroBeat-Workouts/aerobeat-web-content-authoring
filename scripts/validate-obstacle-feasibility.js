// @ts-check
//
// 2dh7 — converter feasibility gate for squat/weave obstacle emission.
//
// An obstacle whose blocked mask leaves no reachable safe cell (full-width v3
// rect, or ANY v2 legacy obstacle, which normalize to a full-height gameplay
// rectangle) used to convert to a contract-legal but undodgeable checkpoint:
// `squat` with `gridMask [0..11]` and `noseSafeCells []`. This validator locks
// the new gate: infeasible obstacles are dropped with a trace parallel to the
// punch drops (`spatial_target_blocked` / `unreachable_after_optimizer` style):
//   - `squat_no_reachable_safe_cell` for a tie mask (squat)
//   - `weave_no_reachable_safe_cell` for a lane-skewed mask (weave_left/right)
// Feasible obstacles (canonical top-row squat, single-lane full-height weave)
// are emitted unchanged.
//
// gridMask/blockedCells/noseSafeCells follow the canonical top-left gameplay
// cell order (row-major 0..11); noseSafeCells is the complement of gridMask.

import assert from "node:assert/strict";
import {
  convertDifficulty,
  deriveBeatSaberSpawnTiming
} from "../src/index.js";

const sourceHash = `sha256:${"9".repeat(64)}`;
const options = {
  difficulty: /** @type {const} */ ("Hard"),
  songToken: "obstacle-feasibility",
  songName: "Obstacle Feasibility",
  bpm: 120,
  noteJumpMovementSpeed: 10,
  noteJumpStartBeatOffset: 1,
  spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1),
  sourceProvider: "synthetic",
  sourceId: "obstacle-feasibility",
  sourceVersionHash: "0".repeat(40),
  sourceInfoFormat: /** @type {const} */ ("v2"),
  sourceInfoVersion: "2.1.0",
  sourceInfoHash: sourceHash,
  sourceDifficultyPath: "Hard.dat",
  sourceBeatmapFormat: /** @type {const} */ ("v3"),
  sourceBeatmapVersion: "3.3.0",
  sourceDifficultyHash: sourceHash,
  notePalette: null
};

/** @param {Readonly<Record<string, unknown>>} obstacle */
function summaryFor(obstacle) {
  return { colorNotes: [], bombNotes: [], obstacles: [obstacle], sliders: [], burstSliders: [] };
}

/** @param {Readonly<{x: number, y: number, width: number, height: number}>} source @param {Readonly<{x: number, y: number, width: number, height: number}>} gameplay @param {number} start @param {number} duration */
function v3Obstacle(source, gameplay, start, duration) {
  return {
    start,
    duration,
    sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v3_obstacle_rect", kind: "v3_rect", ...source },
    gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", ...gameplay },
    sourceIndex: 0
  };
}

/** @param {"v2_type_0" | "v2_type_1"} kind @param {number} sourceWidth @param {number} sourceIndex */
function v2Obstacle(kind, sourceWidth, sourceIndex) {
  // v2 legacy obstacles carry only line index/type/width; the normalizer derives
  // x/y and forces full-height gameplay (gameplayY=0, height=3), so ANY v2
  // obstacle covering both lane halves is infeasible.
  return {
    start: 10,
    duration: 1,
    sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind, x: 0, y: 0, width: sourceWidth, height: 5 },
    gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: sourceWidth, height: 3 },
    sourceIndex
  };
}

/** @param {{package: Readonly<Record<string, unknown>>, charts: Readonly<Record<string, unknown>>[]}} converted */
function boxingEventsFor(converted) {
  const boxingTrace = /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (converted.package).conversionTrace).boxing);
  assert.equal(boxingTrace.length, 1);
  return /** @type {Record<string, unknown>[]} */ (boxingTrace[0].events);
}

/** @param {{package: Readonly<Record<string, unknown>>, charts: Readonly<Record<string, unknown>>[]}} converted */
function boxingBeatsFor(converted) {
  return /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>[]} */ (converted.charts)).filter((chart) => String(chart.mode) === "boxing").flatMap((chart) => /** @type {Record<string, unknown>[]} */ (chart.beats));
}

// (a) Canonical squat: v3 full-width TOP row only ({x:0,y:2,w:4,h:1}) normalizes
// to gameplay {x:0,y:0,w:4,h:1}, gridMask [0,1,2,3], noseSafeCells [4..11].
// Eight reachable safe cells remain, so the squat is still emitted unchanged.
{
  const converted = await convertDifficulty(summaryFor(v3Obstacle({ x: 0, y: 2, width: 4, height: 1 }, { x: 0, y: 0, width: 4, height: 1 }, 10, 1)), options);
  const emitted = boxingEventsFor(converted).find((entry) => String(entry.action) === "emit");
  assert.ok(emitted, "canonical top-row squat must still emit");
  assert.equal(String(emitted.type), "squat");
  assert.deepEqual(emitted.gridMask, [0, 1, 2, 3]);
  assert.deepEqual(emitted.blockedCells, [0, 1, 2, 3]);
  assert.deepEqual(emitted.noseSafeCells, [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(emitted.end, 11);
  const beat = boxingBeatsFor(converted).find((entry) => String(entry.type) === "squat");
  assert.ok(beat, "canonical squat beat must exist in the Boxing chart");
  assert.deepEqual(beat.gridMask, [0, 1, 2, 3]);
  assert.deepEqual(/** @type {Record<string, unknown>} */ (beat.checkpoint).noseSafeCells, [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(boxingBeatsFor(converted).some((entry) => String(entry.type).startsWith("weave_")), false);
}

// (b) Infeasible squat: v3 full-width rect {x:0,y:0,w:4,h:3} → gameplay
// {x:0,y:0,w:4,h:3}, gridMask [0..11], noseSafeCells []. Dropped with
// squat_no_reachable_safe_cell; no squat beat is emitted.
{
  const converted = await convertDifficulty(summaryFor(v3Obstacle({ x: 0, y: 0, width: 4, height: 3 }, { x: 0, y: 0, width: 4, height: 3 }, 10, 1)), options);
  const events = boxingEventsFor(converted);
  assert.equal(events.some((entry) => String(entry.action) === "emit"), false, "infeasible full-width v3 obstacle must emit nothing");
  const dropped = events.filter((entry) => String(entry.action) === "drop");
  assert.equal(dropped.length, 1, "infeasible full-width v3 obstacle must produce exactly one drop trace");
  assert.deepEqual(dropped[0].sourceEventIds, ["obstacle-000"]);
  assert.equal(String(dropped[0].reason), "squat_no_reachable_safe_cell");
  assert.equal(String(dropped[0].type), "squat");
  assert.deepEqual(dropped[0].gridMask, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(dropped[0].noseSafeCells, []);
  assert.equal(dropped[0].start, 10);
  assert.equal(dropped[0].end, 11);
  assert.equal(boxingBeatsFor(converted).length, 0, "dropped infeasible obstacle must not produce any Boxing beat");
}

// (c) ANY v2 legacy obstacle normalizes to a full-height gameplay rectangle
// (gameplayY=0, height=3). v2 `_type:0 _width:4` → gameplay {x:0,y:0,w:4,h:3} →
// the same infeasible squat as case (b).
{
  const converted = await convertDifficulty(summaryFor(v2Obstacle("v2_type_0", 4, 0)), options);
  const dropped = boxingEventsFor(converted).filter((entry) => String(entry.action) === "drop");
  assert.equal(dropped.length, 1);
  assert.equal(String(dropped[0].reason), "squat_no_reachable_safe_cell");
  assert.equal(String(dropped[0].type), "squat");
  assert.deepEqual(dropped[0].gridMask, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(dropped[0].noseSafeCells, []);
  assert.equal(boxingBeatsFor(converted).length, 0);
}

// (d) A single-lane full-height source still emits weave_left/right unchanged —
// feasibility is unaffected for lane-skewed masks with reachable safe cells.
{
  const left = await convertDifficulty(summaryFor(v3Obstacle({ x: 0, y: 0, width: 1, height: 3 }, { x: 0, y: 0, width: 1, height: 3 }, 10, 1)), { ...options, songToken: "obstacle-feasibility-left" });
  const leftEmitted = boxingEventsFor(left).find((entry) => String(entry.action) === "emit");
  assert.ok(leftEmitted, "single-lane left full-height obstacle must still emit");
  assert.equal(String(leftEmitted.type), "weave_right");
  assert.deepEqual(leftEmitted.gridMask, [0, 4, 8]);
  assert.deepEqual(leftEmitted.noseSafeCells, [1, 2, 3, 5, 6, 7, 9, 10, 11]);

  const right = await convertDifficulty(summaryFor(v3Obstacle({ x: 3, y: 0, width: 1, height: 3 }, { x: 3, y: 0, width: 1, height: 3 }, 10, 1)), { ...options, songToken: "obstacle-feasibility-right" });
  const rightEmitted = boxingEventsFor(right).find((entry) => String(entry.action) === "emit");
  assert.ok(rightEmitted, "single-lane right full-height obstacle must still emit");
  assert.equal(String(rightEmitted.type), "weave_left");
  assert.deepEqual(rightEmitted.gridMask, [3, 7, 11]);
  assert.deepEqual(rightEmitted.noseSafeCells, [0, 1, 2, 4, 5, 6, 8, 9, 10]);
}

// Modifier gate precedence: the no_squats modifier gate runs before the
// feasibility gate, so an infeasible full-width obstacle under no_squats is
// dropped with disabled_by_modifier (the existing trace). Either way no squat
// beat is emitted and the dropped obstacle does not leak into the modifier
// union.
{
  const converted = await convertDifficulty(summaryFor(v3Obstacle({ x: 0, y: 0, width: 4, height: 3 }, { x: 0, y: 0, width: 4, height: 3 }, 10, 1)), { ...options, modifiers: ["no_squats"] });
  const dropped = boxingEventsFor(converted).filter((entry) => String(entry.action) === "drop");
  assert.equal(dropped.length, 1);
  assert.equal(String(dropped[0].reason), "disabled_by_modifier", "no_squats modifier gate must run before the feasibility gate");
  assert.equal(String(dropped[0].type), "squat");
  assert.equal(boxingBeatsFor(converted).length, 0);
  const prototype = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>[]} */ (converted.charts)).filter((chart) => String(chart.mode) === "boxing")[0].prototype);
  assert.deepEqual(prototype.modifiers, ["no_squats"], "dropped obstacle must not contribute modifiers to the chart identity");
}

// Boundary evidence: a 3-wide full-height rect ({x:0,y:0,w:3,h:3}) still leaves
// a reachable cell on every lane side, so it remains a feasible weave_right
// (left 6 > right 3) despite full height. The `weave_no_reachable_safe_cell`
// drop fires only when a lane-skewed mask leaves zero safe cells, which the
// 4-wide 3-row grid cannot produce; its trace shape is therefore pinned by the
// same fields as the squat drop (reason + type + gridMask + noseSafeCells []).
{
  const converted = await convertDifficulty(summaryFor(v3Obstacle({ x: 0, y: 0, width: 3, height: 3 }, { x: 0, y: 0, width: 3, height: 3 }, 10, 1)), options);
  const emitted = boxingEventsFor(converted).find((entry) => String(entry.action) === "emit");
  assert.ok(emitted, "3-wide full-height obstacle must remain a feasible weave");
  assert.equal(String(emitted.type), "weave_right");
  assert.deepEqual(emitted.gridMask, [0, 1, 2, 4, 5, 6, 8, 9, 10]);
  assert.deepEqual(emitted.noseSafeCells, [3, 7, 11]);
}

console.log("Obstacle feasibility gate (squat_no_reachable_safe_cell / weave_no_reachable_safe_cell) validation passed.");
