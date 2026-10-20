// @ts-check
import assert from "node:assert/strict";
import { convertDifficulty, deriveBeatSaberSpawnTiming, validateAuthoredPackage } from "../src/index.js";

const hash = `sha256:${"0".repeat(64)}`;
const options = { difficulty: /** @type {const} */ ("Hard"), songToken: "hand-gap", songName: "Hand Gap", bpm: 120, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 1), sourceProvider: "synthetic", sourceId: "hand-gap", sourceVersionHash: "0".repeat(40), sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: hash, sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"), sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: hash, notePalette: null };
const source = { colorNotes: [
  { start: 1, cell: 5, hand: "left", direction: 8, sourceIndex: 0 },
  { start: 1.8, cell: 6, hand: "right", direction: 8, sourceIndex: 1 },
  { start: 2.6, cell: 5, hand: "left", direction: 8, sourceIndex: 2 },
  { start: 3.4, cell: 6, hand: "right", direction: 8, sourceIndex: 3 },
  { start: 4.2, cell: 5, hand: "left", direction: 8, sourceIndex: 4 },
  { start: 5, cell: 6, hand: "right", direction: 8, sourceIndex: 5 }
], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
const baseline = await convertDifficulty(source, options);
const zero = await convertDifficulty(source, { ...options, converterSettings: { sameHandPunchMinGapMs: 0 } });
assert.equal(zero.packageHash, baseline.packageHash, "explicit zero retains current package identity");
assert.deepEqual(zero.package, baseline.package, "zero retains complete current chart and trace");
const tuned = await convertDifficulty(source, { ...options, converterSettings: { sameHandPunchMinGapMs: 1000 } });
assert.equal((await validateAuthoredPackage(tuned.package)).valid, true);
const boxing = /** @type {Record<string,unknown>} */ (tuned.charts.find((chart) => chart.mode === "boxing"));
const punches = /** @type {Record<string,unknown>[]} */ (boxing.beats).filter((beat) => /^straight_|^hook_|^uppercut_/u.test(String(beat.type)));
const ms = (beat) => Number(beat.start) * 60000 / options.bpm;
for (const hand of ["left", "right"]) {
  const emitted = punches.filter((beat) => String(beat.type).endsWith(`_${hand}`));
  assert.ok(emitted.length >= 2, `${hand} retains punches`);
  for (let i = 1; i < emitted.length; i += 1) assert.ok(ms(emitted[i]) - ms(emitted[i - 1]) >= 1000 - 0.0001, `${hand} punches meet actual song milliseconds`);
}
const events = /** @type {Record<string,unknown>[]} */ (tuned.traces[0].events);
assert.ok(events.some((event) => event.reason === "same_hand_punch_min_gap" && event.action === "drop"), "dropped same-hand source is traced");
const baselineBoxing = /** @type {Record<string,unknown>} */ (baseline.charts.find((chart) => chart.mode === "boxing"));
const baselinePunches = /** @type {Record<string,unknown>[]} */ (baselineBoxing.beats).filter((beat) => /^straight_|^hook_|^uppercut_/u.test(String(beat.type)));
for (const beat of baselinePunches) {
  if (punches.some((entry) => entry.eventId === beat.eventId)) continue;
  const hand = String(beat.type).split("_").at(-1);
  assert.ok(punches.some((prior) => String(prior.type).endsWith(`_${hand}`) && ms(beat) - ms(prior) >= 0 && ms(beat) - ms(prior) < 1000), `removed ${hand} punch must follow the same hand inside its gap`);
  assert.ok(punches.some((opposite) => String(opposite.type).endsWith(hand === "left" ? "_right" : "_left") && Math.abs(ms(beat) - ms(opposite)) < 1000), "opposite-hand punch remains available inside the removed punch's interval");
}
assert.deepEqual(tuned.charts.find((chart) => chart.mode === "flow"), baseline.charts.find((chart) => chart.mode === "flow"), "Flow chart remains unchanged");
// Global 360-ms optimization previously picked left at 1300 ms, dropped it for
// its 800-ms same-hand gap, and incorrectly excluded left at 1650 ms (1150-ms left gap).
const conflict = { ...source, colorNotes: [[1, "left", 5], [1.8, "right", 6], [2.6, "left", 5], [3, "right", 6], [3.3, "left", 5], [4, "right", 6]].map(([start, hand, cell], sourceIndex) => ({ start, hand, cell, direction: 8, sourceIndex })) };
const conflictBaseline = await convertDifficulty(conflict, options);
const conflictZero = await convertDifficulty(conflict, { ...options, converterSettings: { sameHandPunchMinGapMs: 0 } });
assert.equal(conflictZero.packageHash, conflictBaseline.packageHash, "conflicting sequence at zero retains exact package identity");
const resolved = await convertDifficulty(conflict, { ...options, converterSettings: { sameHandPunchMinGapMs: 1000 } });
const conflictBeats = /** @type {Record<string,unknown>[]} */ (resolved.charts.find((chart) => chart.mode === "boxing")?.beats ?? []);
const conflictEmits = /** @type {Record<string,unknown>[]} */ (resolved.traces[0].events).filter((event) => event.action === "emit" && event.kind === "punch");
const conflictDrops = /** @type {Record<string,unknown>[]} */ (resolved.traces[0].events).filter((event) => event.action === "drop");
assert.deepEqual(conflictEmits.map((event) => event.sourceEventIds), [["note-000"], ["note-001"], ["note-004"]], "later feasible left must fill hole left by the globally selected but same-hand-infeasible left");
assert.equal(conflictDrops.find((event) => /** @type {string[]} */ (event.sourceEventIds).includes("note-002"))?.reason, "spacing_optimizer_rejected", "global conflict takes precedence when both constraints block a punch");
assert.equal(conflictDrops.find((event) => /** @type {string[]} */ (event.sourceEventIds).includes("note-003"))?.reason, "spacing_optimizer_rejected", "global conflict takes precedence over overlapping same-hand gap");
assert.ok(conflictBeats.some((beat) => /** @type {string[]} */ (beat.sourceEventIds ?? []).includes("note-004") && beat.type === "straight_left"));
assert.deepEqual(resolved.charts.find((chart) => chart.mode === "flow"), conflictBaseline.charts.find((chart) => chart.mode === "flow"));
// Independently identified eight-event sequence: the legacy global winner set
// post-filtered away an addable 1280-ms left punch between right-hand pulses.
const pulseTimes = [[500, "right", 6], [1090, "right", 6], [1280, "left", 5], [1470, "right", 6], [1820, "right", 6], [2170, "right", 6], [2840, "right", 6], [3750, "left", 5]];
const pulses = { ...source, colorNotes: pulseTimes.map(([timeMs, hand, cell], sourceIndex) => ({ start: Number(timeMs) * options.bpm / 60000, hand, cell, direction: 8, sourceIndex })) };
const pulseBaseline = await convertDifficulty(pulses, options);
const pulseZero = await convertDifficulty(pulses, { ...options, converterSettings: { sameHandPunchMinGapMs: 0 } });
assert.equal(pulseZero.packageHash, pulseBaseline.packageHash, "eight-event conflicting timeline keeps exact zero package identity");
const pulseTuned = await convertDifficulty(pulses, { ...options, converterSettings: { sameHandPunchMinGapMs: 1000 } });
const pulseBoxing = /** @type {Record<string,unknown>[]} */ (pulseTuned.charts.find((chart) => chart.mode === "boxing")?.beats ?? []);
const pulsePunches = pulseBoxing.filter((beat) => /^straight_|^hook_|^uppercut_/u.test(String(beat.type)));
assert.ok(pulsePunches.some((beat) => /** @type {string[]} */ (beat.sourceEventIds ?? []).includes("note-002") && beat.type === "straight_left" && Math.abs(ms(beat) - 1280) < 0.0001), "feasible 1280-ms opposite-hand punch must be emitted");
for (const hand of ["left", "right"]) {
  const handTimes = pulsePunches.filter((beat) => String(beat.type).endsWith(`_${hand}`)).map(ms);
  for (let index = 1; index < handTimes.length; index += 1) assert.ok(handTimes[index] - handTimes[index - 1] >= 999.9999);
}
assert.deepEqual(pulseTuned.charts.find((chart) => chart.mode === "flow"), pulseBaseline.charts.find((chart) => chart.mode === "flow"));
console.log("Same-hand gap, zero identity, two global optimizer conflicts, opposite hand, trace, and Flow validation passed.");
