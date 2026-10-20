// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, validateAuthoredPackage } from "../src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Hard"), songToken: "repetition", songName: "Repetition", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1), sourceProvider: "synthetic", sourceId: "repetition", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: hash, sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: hash, notePalette: null };
const notes = [
  [1, "left", 5], [2, "left", 5], [3, "left", 5], [4, "right", 6],
  [6, "left", 9], [7, "right", 10], [9, "left", 5], [9, "right", 6],
  [11, "left", 1], [11, "right", 2], [13, "left", 9], [13, "right", 10],
  [15, "left", 5], [15, "right", 6], [17, "left", 1], [17, "right", 2],
  [19, "left", 9], [19, "right", 10], [21, "left", 5], [21, "right", 6],
  [23, "left", 1], [23, "right", 2]
].map(([start, hand, cell], sourceIndex) => ({ start, hand, cell, direction: 8, sourceIndex }));
const source = { colorNotes: notes, bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
const baseline = await convertDifficulty(source, options);
const zero = await convertDifficulty(source, { ...options, converterSettings: { repeatedPunchSwitchChancePercent: 0, repeatedGuardReplaceChancePercent: 0 } });
assert.equal(zero.packageHash, baseline.packageHash, "both explicit zero percentages preserve full package hash");
assert.deepEqual(zero.package, baseline.package);
const hundred = await convertDifficulty(source, { ...options, converterSettings: { repeatedPunchSwitchChancePercent: 100, repeatedGuardReplaceChancePercent: 100, sameHandPunchMinGapMs: 1000 } });
assert.equal((await validateAuthoredPackage(hundred.package)).valid, true);
const repeat = await convertDifficulty(source, { ...options, converterSettings: { repeatedPunchSwitchChancePercent: 100, repeatedGuardReplaceChancePercent: 100, sameHandPunchMinGapMs: 1000 } });
assert.equal(repeat.packageHash, hundred.packageHash, "seeded conversion is reproducible");
const boxing = /** @type {Record<string,unknown>} */ (hundred.charts.find((chart) => chart.mode === "boxing"));
const beats = /** @type {Record<string,unknown>[]} */ (boxing.beats);
const emitted = /** @type {Record<string,unknown>[]} */ (hundred.traces[0].events).filter((event) => event.action === "emit" && event.kind === "punch");
const switched = emitted.filter((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_punch_switched");
const replaced = emitted.filter((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_guard_replaced");
assert.ok(switched.length >= 1, "100% switches a repeated same-family/same-hand punch");
assert.ok(replaced.length >= 3, "100% replaces repeated guards with one punch each");
assert.deepEqual(new Set(replaced.map((event) => event.family)), new Set(["straight", "hook", "uppercut"]), "seeded guard replacements cover each family");
for (const event of [...switched, ...replaced]) {
  const authored = beats.find((beat) => beat.eventId === event.eventId);
  assert.ok(authored, "emitted trace resolves to a scored beat");
  assert.equal(authored.type, `${event.family}_${event.hand}`);
  assert.deepEqual(authored.sourceEventIds, event.sourceEventIds, "lineage is unchanged source evidence");
  assert.ok(/** @type {number[]} */ (/** @type {Record<string,unknown>} */ (authored.spatialTarget).acceptedSubcells).length > 0);
}
assert.equal(switched[0].hand, "right");
const switchedIds = switched.map((event) => /** @type {string[]} */ (event.sourceEventIds)[0]);
assert.ok(switchedIds.includes("note-001"), "source left-left run flips the later emitted punch");
const switchedOrDropped = /** @type {Record<string,unknown>[]} */ (hundred.traces[0].events).filter((event) => /** @type {string[]} */ (event.sourceEventIds).includes("note-002"));
assert.equal(/** @type {Record<string,unknown>} */ (switchedOrDropped[0].repetition).kind, "repeated_punch_switched", "third source-left repeat still receives the independent seeded flip before optimizer eligibility");
const ms = (beat) => Number(beat.start) * 500;
const punches = beats.filter((beat) => /^(straight|hook|uppercut)_(left|right)$/u.test(String(beat.type)));
for (let i = 1; i < punches.length; i += 1) assert.ok(ms(punches[i]) - ms(punches[i - 1]) >= 359.9999, "global punch gap remains");
for (const hand of ["left", "right"]) {
  const handPunches = punches.filter((beat) => String(beat.type).endsWith(`_${hand}`));
  for (let i = 1; i < handPunches.length; i += 1) assert.ok(ms(handPunches[i]) - ms(handPunches[i - 1]) >= 999.9999, "same-hand gap remains");
}
assert.deepEqual(hundred.charts.find((chart) => chart.mode === "flow"), baseline.charts.find((chart) => chart.mode === "flow"));
const onlySwitch = await convertDifficulty(source, { ...options, converterSettings: { repeatedPunchSwitchChancePercent: 100 } });
assert.equal(/** @type {Record<string,unknown>[]} */ (onlySwitch.traces[0].events).filter((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_guard_replaced").length, 0, "guard percentage stays independent");
const onlyGuard = await convertDifficulty(source, { ...options, converterSettings: { repeatedGuardReplaceChancePercent: 100 } });
assert.equal(/** @type {Record<string,unknown>[]} */ (onlyGuard.traces[0].events).filter((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_punch_switched").length, 0, "punch percentage stays independent");
const halfOptions = { ...options, converterSettings: { repeatedPunchSwitchChancePercent: 50, repeatedGuardReplaceChancePercent: 50 } };
assert.equal((await convertDifficulty(source, halfOptions)).packageHash, (await convertDifficulty(source, halfOptions)).packageHash, "intermediate seeded chance is repeatable");
console.log(`Boxing repetition zero identity, 100% ${switched.length} switches/${replaced.length} guard replacements, intermediate determinism and spacing passed.`);
