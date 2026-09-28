// @ts-check
import assert from "node:assert/strict";
import { buildFlowIntervalOracle, swapCrossedFlowNotes } from "../src/converter.js";

/** @param {number} placement @param {"left"|"right"} hand @param {number} start @param {number} sourceIndex @param {number} direction */
const note = (placement, hand, start, sourceIndex, direction = 8) => ({ cell: (2 - Math.floor(placement / 4)) * 4 + placement % 4, hand, start, sourceIndex, direction });
/** @param {ReturnType<typeof note>[]} notes */
function convert(notes) {
  const result = buildFlowIntervalOracle({ colorNotes: notes, bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }, "Easy", "x-corner");
  return { chart: { beats: /** @type {{hand:string,placement:number,start:number,direction?:number,requiresDirection:boolean}[]} */ (/** @type {unknown} */ (result.chart.beats)) }, trace: { events: /** @type {{result:{beat:{hand:string}}}[]} */ (/** @type {unknown} */ (result.trace.events)) } };
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
console.log("Flow X-corner handiness swap passed for all three rows, correct orientation, timing, extra notes, and idempotence.");
