// @ts-check
import assert from "node:assert/strict";
import { buildFlowIntervalOracle, swapCrossedFlowNotes } from "../src/converter.js";
import { convertDifficulty, deriveBeatSaberSpawnTiming, canonicalJson, prefixedSha256 } from "../src/index.js";

/** @param {number} placement @param {"left"|"right"} hand @param {number} start @param {number} sourceIndex @param {number} direction */
const note = (placement, hand, start, sourceIndex, direction = 8) => ({ cell: (2 - Math.floor(placement / 4)) * 4 + placement % 4, hand, start, sourceIndex, direction });
/** @param {ReturnType<typeof note>[]} notes */
function convert(notes) {
  const result = buildFlowIntervalOracle({ colorNotes: notes, bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }, "Easy", "x-corner");
  return { chart: { beats: /** @type {{hand:string,placement:number,start:number,direction?:number,requiresDirection:boolean}[]} */ (/** @type {unknown} */ (result.chart.beats)) }, trace: { events: /** @type {{result:{beat:{hand:string,placement:number,direction?:number},noteRef:string}}[]} */ (/** @type {unknown} */ (result.trace.events)) } };
}
for (const [leftCell, rightCell] of [[0, 3], [4, 7], [8, 11]]) {
  const source = [note(rightCell, "left", 1, 0, 2), note(leftCell, "right", 1, 1)];
  const { chart, trace } = convert(source);
  const beats = chart.beats;
  assert.deepEqual(beats.map(({ hand, placement }) => [hand, placement]), [["left", leftCell], ["right", rightCell]], `crossed ${leftCell}/${rightCell} swapped without moving notes`);
  assert.deepEqual(beats.map(({ start, direction, requiresDirection }) => [start, direction, requiresDirection]), [[1, undefined, false], [1, 2, true]], "timing and direction stay on their notes");
  assert.deepEqual(trace.events.map((event) => event.result.beat.hand), ["right", "left"], "trace emitted beats match the swapped chart");
  const snapshot = structuredClone(chart.beats);
  swapCrossedFlowNotes(chart.beats);
  assert.deepEqual(chart.beats, snapshot, "second pass is idempotent");
}
const correct = convert([note(8, "left", 1, 0), note(11, "right", 1, 1)]);
assert.deepEqual(correct.chart.beats.map((beat) => [beat.hand, beat.placement]), [["left", 8], ["right", 11]], "correct orientation remains unchanged");
const separate = convert([note(11, "left", 1, 0), note(8, "right", 1.001, 1)]);
assert.deepEqual(separate.chart.beats.map((beat) => [beat.hand, beat.placement]), [["left", 11], ["right", 8]], "distinct beat starts do not count as simultaneous");
const extra = convert([note(11, "left", 1, 0), note(8, "right", 1, 1), note(5, "left", 1, 2)]);
assert.deepEqual(extra.chart.beats.map((beat) => [beat.hand, beat.placement]), [["left", 5], ["left", 8], ["right", 11]], "third note is untouched");
const duplicate = convert([note(11, "left", 1, 0), note(11, "left", 1, 1), note(8, "right", 1, 2)]);
assert.deepEqual(duplicate.trace.events.map((event) => event.result.beat.hand), ["right", "left", "left"], "duplicate exterior notes swap only the selected trace pair");
const direct = [{ start: 1, type: "note", hand: "left", placement: 11 }, { start: 1, type: "note", hand: "right", placement: 8 }];
swapCrossedFlowNotes(direct);
assert.deepEqual(direct.map((beat) => beat.hand), ["right", "left"], "direct detector swaps without trace events");
// Four Cartesian center pairs, including both cross-row combinations. Assert each
// note's non-hand fields and raw source lineage remain on that note.
for (const leftCell of [2, 10]) for (const rightCell of [1, 9]) {
  const source = [note(leftCell, "left", 1, 0, 8), note(rightCell, "right", 1, 1, 2)];
  const { chart, trace } = convert(source);
  assert.deepEqual(chart.beats.map(({ hand, placement }) => [hand, placement]), [["left", rightCell], ["right", leftCell]], `center pair L${leftCell}/R${rightCell}`);
  assert.deepEqual(chart.beats.map(({ start, direction, requiresDirection }) => [start, direction, requiresDirection]), [[1, 2, true], [1, undefined, false]], "arrow/any and timing stay with their original note");
  assert.deepEqual(trace.events.map((event) => event.result.beat.hand), ["right", "left"], "emitted trace reflects center hand swap");
  assert.deepEqual(trace.events.map((event) => event.result.beat.placement), [leftCell, rightCell], "trace placements remain attached to source notes");
  assert.deepEqual(trace.events.map((event) => event.result.beat.direction), [undefined, 2], "trace direction and any remain attached to source notes");
  assert.deepEqual(trace.events.map((event) => event.result.noteRef), [`flow-note-000-left-${source[0].cell}-1.000`, `flow-note-001-right-${source[1].cell}-1.000`], "original source lineage is not reassigned with hand swaps");
  const before = structuredClone(chart.beats);
  swapCrossedFlowNotes(chart.beats);
  assert.deepEqual(chart.beats, before, "center second pass is idempotent");
}
for (const [leftCell, rightCell] of [[1, 2], [9, 10]]) {
  const { chart } = convert([note(leftCell, "left", 1, 0), note(rightCell, "right", 1, 1)]);
  assert.deepEqual(chart.beats.map(({ hand, placement }) => [hand, placement]), [["left", leftCell], ["right", rightCell]], "already same-side center notes remain unchanged");
}
const centerOffset = convert([note(2, "left", 1, 0), note(1, "right", 1.001, 1)]);
assert.deepEqual(centerOffset.chart.beats.map(({ hand, placement }) => [hand, placement]), [["left", 2], ["right", 1]], "center notes at distinct exact starts do not swap");
const centerDuplicate = convert([note(2, "left", 1, 0), note(2, "left", 1, 1), note(1, "right", 1, 2)]);
assert.deepEqual(centerDuplicate.trace.events.map((event) => event.result.beat.hand), ["right", "left", "left"], "duplicate center notes swap only the first source-order match");
const centerChord = convert([note(2, "left", 1, 0), note(10, "left", 1, 1), note(1, "right", 1, 2), note(9, "right", 1, 3), note(11, "left", 1, 4), note(8, "right", 1, 5), note(5, "left", 1, 6)]);
assert.deepEqual(centerChord.trace.events.map((event) => event.result.beat.hand), ["right", "right", "left", "left", "right", "left", "left"], "stable multi-note center and corner pairs coexist without touching the extra note");
const mixedOrder = convert([note(2, "left", 1, 0), note(11, "left", 1, 1), note(8, "right", 1, 2), note(9, "right", 1, 3)]);
assert.deepEqual(mixedOrder.trace.events.map((event) => event.result.beat.hand), ["right", "right", "left", "left"], "interleaved center and exterior families each retain their partner");

const options = {
  difficulty: /** @type {const} */ ("Easy"), songToken: "center-identity", songName: "Center Identity", bpm: 120,
  noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0, spawnTiming: deriveBeatSaberSpawnTiming(120, 10, 0),
  sourceProvider: "synthetic", sourceId: "center-identity", sourceVersionHash: "0".repeat(40),
  sourceInfoFormat: /** @type {const} */ ("v2"), sourceInfoVersion: "2.1.0", sourceInfoHash: `sha256:${"0".repeat(64)}`,
  sourceDifficultyPath: "Easy.dat", sourceBeatmapFormat: /** @type {const} */ ("v3"),
  sourceBeatmapVersion: "3.3.0", sourceDifficultyHash: `sha256:${"0".repeat(64)}`, notePalette: null
};
const summary = { colorNotes: [note(2, "left", 1, 0), note(1, "right", 1, 1, 3)], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
const converted = await convertDifficulty(summary, options);
const repeated = await convertDifficulty(summary, options);
const flow = converted.charts.find((chart) => chart.mode === "flow");
assert.ok(flow, "full conversion emits a Flow chart");
assert.deepEqual(/** @type {{hand:string,placement:number}[]} */ (/** @type {unknown} */ (flow.beats)).map((beat) => [beat.hand, beat.placement]), [["left", 1], ["right", 2]], "full conversion has corrected center hands");
const flowTrace = converted.flowTrace;
assert.deepEqual(repeated, converted, "reprocessing the same source yields identical chart/package identities and traces");
assert.match(String(flow.contentHash), /^sha256:[0-9a-f]{64}$/u, "Flow content is hash bound");
assert.equal(flow.contentHash, await prefixedSha256(canonicalJson({ beats: flow.beats, rulesetId: flow.rulesetId, rulesetVariants: flow.rulesetVariants, notePalette: flow.notePalette })), "Flow content hash binds converted beat hands");
assert.ok(flowTrace, "conversion trace is retained by the package");
assert.deepEqual(/** @type {{result:{beat:{hand:string,placement:number}}}[]} */ (/** @type {unknown} */ (flowTrace.events)).map((event) => [event.result.beat.hand, event.result.beat.placement]), [["right", 2], ["left", 1]], "full conversion trace keeps source note placement and swapped hand");
assert.match(converted.packageHash, /^sha256:[0-9a-f]{64}$/u, "signed package identity is present");
assert.equal(converted.packageHash, await prefixedSha256(canonicalJson(converted.package)), "package hash binds final converted chart and trace");
console.log("Flow exterior and center hand swaps passed, including full conversion identity and deterministic chords.");
