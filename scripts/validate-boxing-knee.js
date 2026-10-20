// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, validateAuthoredPackage } from "../src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Hard"), songToken: "knee", songName: "Knee", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1), sourceProvider: "synthetic", sourceId: "knee", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: hash, sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: hash, notePalette: null };
const source = { colorNotes: Array.from({ length: 16 }, (_, index) => ([{ start: index * 2 + 1, hand: "left", cell: 5, direction: 8, sourceIndex: index * 2 }, { start: index * 2 + 1, hand: "right", cell: 6, direction: 8, sourceIndex: index * 2 + 1 }])).flat(), bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
/** @param {number} chance @param {number} [guardChance] */
const convert = (chance, guardChance = 0) => convertDifficulty(source, { ...options, converterSettings: { kneeStrikeChancePercent: chance, repeatedGuardReplaceChancePercent: guardChance, sameHandPunchMinGapMs: 1000 } });
/** @typedef {{mode:string, chartId:string, prototype:{rulesetId:string}, beats:{type:string,eventId:string,sourceEventIds:string[],spatialTarget:{targetCell:number,acceptedSubcells:number[]}}[]}} TestChart */
/** @param {Awaited<ReturnType<typeof convert>>} result */
const variants = (result) => /** @type {TestChart[]} */ (/** @type {unknown} */ (result.package.charts)).filter((chart) => chart.mode === "boxing");
/** @param {Awaited<ReturnType<typeof convert>>} result */
const trace = (result) => /** @type {{boxing:{chartId:string,events:{eventId:string,kind:string,sourceEventIds:string[]}[]}[]}} */ (/** @type {unknown} */ (result.package.conversionTrace));
/** @param {Awaited<ReturnType<typeof convert>>} result */
const flow = (result) => /** @type {TestChart[]} */ (/** @type {unknown} */ (result.package.charts)).find((chart) => chart.mode === "flow");
/** @param {Awaited<ReturnType<typeof convert>>} result */
const sets = (result) => /** @type {unknown[]} */ (/** @type {unknown} */ (result.package.sets));
const zero = await convert(0);
const hundred = await convert(100);
const middle = await convert(50);
for (const result of [zero, hundred, middle]) {
  const validation = await validateAuthoredPackage(result.package);
  assert.deepEqual(validation.issues, [], "dual chart package validates");
  assert.equal(variants(result).length, 2);
  assert.equal(trace(result).boxing.length, 2);
  assert.notEqual(variants(result)[0].chartId, variants(result)[1].chartId);
  assert.equal(variants(result)[0].prototype.rulesetId, "boxing_collider_v1");
  assert.equal(variants(result)[1].prototype.rulesetId, "boxing_collider_knee_v1");
  assert.equal(sets(result).length, 3);
  assert.deepEqual(trace(result).boxing.map((trace) => trace.chartId), variants(result).map((chart) => chart.chartId));
  assert.equal(variants(result)[0].beats.filter((beat) => beat.type === "guard").length, 16);
  assert.equal(variants(result)[0].beats.some((beat) => String(beat.type).startsWith("knee_")), false);
  assert.deepEqual(flow(result), flow(zero), "Flow independent of knee chance");
}
assert.deepEqual(variants(zero)[0], variants(hundred)[0], "no-knee chart does not depend on knee chance");
const kneeBeats = (result) => variants(result)[1].beats.filter((beat) => String(beat.type).startsWith("knee_"));
assert.equal(kneeBeats(zero).length, 0);
assert.equal(kneeBeats(hundred).length, 16);
assert.equal(variants(hundred)[1].beats.filter((beat) => beat.type === "guard").length, 0);
assert.ok(kneeBeats(middle).length > 0 && kneeBeats(middle).length < 16);
assert.equal((await convert(50)).packageHash, middle.packageHash, "intermediate seed is stable");
for (const [index, beat] of kneeBeats(hundred).entries()) {
  const hand = index % 2 === 0 ? "left" : "right";
  assert.equal(beat.type, `knee_${hand}`);
  assert.equal(beat.spatialTarget.targetCell, hand === "left" ? 9 : 10);
  assert.equal(beat.sourceEventIds.length, 2, "one knee per source pair");
  assert.ok(beat.spatialTarget.acceptedSubcells.length > 0);
  const event = trace(hundred).boxing[1].events.find((item) => item.eventId === beat.eventId);
  assert.equal(event?.kind, "knee");
  assert.deepEqual(event?.sourceEventIds, beat.sourceEventIds);
}
const afterB = await convert(100, 100);
assert.equal(kneeBeats(afterB).length, 1, "B replaces later guards first, leaving only the initial guard eligible for knee");
assert.equal(variants(afterB)[0].beats.filter((beat) => beat.type === "guard").length, 1);
assert.equal(variants(afterB)[1].beats.filter((beat) => beat.type === "guard").length, 0);
assert.equal(variants(afterB)[1].beats.filter((beat) => /^(straight|hook|uppercut)_/.test(String(beat.type))).length, variants(afterB)[0].beats.filter((beat) => /^(straight|hook|uppercut)_/.test(String(beat.type))).length);
console.log("Knee/no-knee variants validate; 0/50/100 seeded guards, alternation, lineage, B ordering and Flow passed.");
