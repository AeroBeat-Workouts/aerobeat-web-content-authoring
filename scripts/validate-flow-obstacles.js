// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseBeatMapDifficulty, convertDifficulty, validateAuthoredPackage } from "../src/index.js";

const raw = await readFile(new URL("../fixtures/flow-obstacle-3c9d-hard-v1.dat", import.meta.url));
const oracle = JSON.parse(await readFile(new URL("../fixtures/flow-obstacle-3c9d-hard-golden-v1.json", import.meta.url), "utf8"));
assert.equal(raw.byteLength, 89_424);
assert.equal(createHash("sha256").update(raw).digest("hex"), "4db5b3393a389c7bcaba6d7a02aec57c10801bcfd74de91523b8e9cdad859b55");
assert.equal(oracle.source.versionHash, "5662f64a12c76a3dd11a5f6ee22611608cd06760");
assert.equal(oracle.source.bpm, 150);
const sourceDocument = JSON.parse(raw.toString("utf8"));
const rawObstacle = sourceDocument._obstacles.find((entry) => entry._time === 92.5999984741211);
assert.deepEqual(rawObstacle, oracle.rawObstacle, "oracle must bind the exact raw source record independently");

const summary = parseBeatMapDifficulty(raw, "v2");
const normalized = summary.obstacles.find((entry) => entry.start === oracle.expected.startBeat);
assert.deepEqual(normalized, { start: 92.5999984741211, duration: 0.0625, x: 1, y: 2, width: 1, height: 3, sourceIndex: 2 });
const converted = await convertDifficulty(summary, {
  difficulty: "Hard",
  songToken: "3c9d",
  songName: "3c9d offline fixture",
  bpm: 150,
  sourceProvider: "beatsaver",
  sourceId: "3c9d",
  sourceVersionHash: "5662f64a12c76a3dd11a5f6ee22611608cd06760",
  sourceDifficultyPath: "Hard.dat",
  sourceBeatmapVersion: "2.0.0",
  sourceDifficultyHash: `sha256:${oracle.source.sha256}`
});
const packageRecord = /** @type {Record<string, unknown>} */ (converted.package);
assert.equal(packageRecord.schemaId, "aerobeat.song-package.v2");
assert.equal(packageRecord.schemaVersion, 2);
assert.equal(packageRecord.packageVersion, "2.0.0");
assert.equal(/** @type {Record<string, unknown>} */ (packageRecord.source).flowObstacleContract, "source_geometry_v1");
const flow = /** @type {Record<string, unknown>[]} */ (packageRecord.charts).find((chart) => chart.mode === "flow");
assert.ok(flow);
assert.equal(flow.schemaId, "aerobeat.chart.flow.v2");
assert.equal(flow.rulesetId, "flow_grid_v2");
const obstacle = /** @type {Record<string, unknown>[]} */ (flow.beats).find((beat) => beat.type === "obstacle" && beat.start === oracle.expected.startBeat);
assert.ok(obstacle);
assert.deepEqual(obstacle, {
  start: oracle.expected.startBeat,
  end: oracle.expected.endBeat,
  type: "obstacle",
  geometry: oracle.expected.geometry,
  gridMask: oracle.expected.gridMask
});
assert.equal(Object.hasOwn(obstacle, "cells"), false);
assert.equal((obstacle.end - obstacle.start) * 60_000 / 150, 25);
assert.deepEqual(obstacle.gridMask, [1]);
assert.notDeepEqual(obstacle.gridMask, [1, 5, 9]);
const validation = await validateAuthoredPackage(converted.package);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
const mismatched = /** @type {Record<string, unknown>} */ (structuredClone(converted.package));
const mismatchedFlow = /** @type {Record<string, unknown>[]} */ (mismatched.charts).find((chart) => chart.mode === "flow");
assert.ok(mismatchedFlow);
const mismatchedObstacle = /** @type {Record<string, unknown>[]} */ (mismatchedFlow.beats).find((beat) => beat.type === "obstacle");
assert.ok(mismatchedObstacle);
mismatchedObstacle.gridMask = [1, 5, 9];
assert.equal((await validateAuthoredPackage(mismatched)).valid, false);

for (const [format, document] of [
  ["v2", { _obstacles: [{ _time: 1, _lineIndex: 1, _type: 0, _duration: 1, _width: 1 }] }],
  ["v3", { obstacles: [{ b: 1, d: 1, x: 1, y: 0, w: 1, h: 5 }] }],
  ["v4", { obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 1, y: 0, w: 1, h: 5 }] }]
]) {
  const parsed = parseBeatMapDifficulty(JSON.stringify(document), /** @type {"v2"|"v3"|"v4"} */ (format));
  assert.deepEqual(parsed.obstacles[0], { start: 1, duration: 1, x: 1, y: 0, width: 1, height: 5, sourceIndex: 0 });
}
for (const [format, field] of [
  ["v2", "_obstacles"],
  ["v3", "obstacles"],
  ["v4", "obstacles"]
]) {
  const absent = parseBeatMapDifficulty("{}", /** @type {"v2"|"v3"|"v4"} */ (format));
  assert.deepEqual(absent.obstacles, [], `${format} must support an absent optional obstacle array`);
  for (const malformed of [{}, null, "invalid", 0]) {
    const document = { [field]: malformed, ...(format === "v4" ? { obstaclesData: [] } : {}) };
    assert.throws(() => parseBeatMapDifficulty(JSON.stringify(document), /** @type {"v2"|"v3"|"v4"} */ (format)), (error) => error instanceof Error && /** @type {Error & {code?: string}} */ (error).code === "obstacle_container_invalid", `${format} present non-array obstacle container must reject with a stable bounded code`);
  }
}
assert.throws(() => parseBeatMapDifficulty(JSON.stringify({ _obstacles: null, obstacles: [] }), "v2"), (error) => error instanceof Error && /** @type {Error & {code?: string}} */ (error).code === "obstacle_container_invalid", "present malformed v2 _obstacles must not fall through to its legacy fallback");

for (const [format, document, code] of [
  ["v2", { _obstacles: [{ _time: 1, _lineIndex: 1, _type: 2, _duration: 1, _width: 1 }] }, "obstacle_type_unsupported"],
  ["v2", { _obstacles: [{ _time: 1, _lineIndex: 1, _type: 0, _duration: 0, _width: 1 }] }, "obstacle_duration_invalid"],
  ["v3", { obstacles: [{ b: 1, d: 1, x: 3, y: 0, w: 2, h: 5 }] }, "obstacle_geometry_invalid"],
  ["v4", { obstacles: [{ b: 1, i: 1 }], obstaclesData: [{ d: 1, x: 1, y: 0, w: 1, h: 5 }] }, "obstacle_index_invalid"],
  ["v4", { obstacles: [{ b: 1, i: 0, x: 1 }], obstaclesData: [{ d: 1, x: 1, y: 0, w: 1, h: 5 }] }, "obstacle_geometry_conflict"],
  ["v4", { obstacles: [{ b: 1, i: 0, r: 15 }], obstaclesData: [{ d: 1, x: 1, y: 0, w: 1, h: 5 }] }, "obstacle_rotation_unsupported"]
]) assert.throws(() => parseBeatMapDifficulty(JSON.stringify(document), /** @type {"v2"|"v3"|"v4"} */ (format)), (error) => error instanceof Error && /** @type {Error & {code?: string}} */ (error).code === code);

console.log("Source-faithful Flow obstacle normalization and offline 3c9d oracle passed.");
