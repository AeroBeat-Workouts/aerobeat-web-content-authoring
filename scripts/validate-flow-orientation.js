// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { convertDifficulty, parseBeatMapDifficulty } from "../src/index.js";

const options = {
  difficulty: /** @type {const} */ ("Easy"),
  songToken: "flow-orientation",
  songName: "Flow Orientation",
  bpm: 120,
  sourceProvider: "synthetic",
  sourceId: "flow-orientation",
  sourceVersionHash: "0".repeat(40),
  sourceDifficultyPath: "Easy.dat",
  sourceBeatmapVersion: "v3"
};

for (const format of /** @type {const} */ (["v2", "v3", "v4"])) {
  const summary = parseBeatMapDifficulty(JSON.stringify(orientationBeatmap(format)), format);
  assert.deepEqual(summary.colorNotes.map((note) => note.cell), [0, 4, 8], `${format} normalization must retain bottom-left source cells`);
  assert.deepEqual(summary.colorNotes.map((note) => note.y), [0, 1, 2], `${format} normalization must retain source y`);
  const converted = await convertDifficulty(summary, { ...options, songToken: `flow-orientation-${format}`, sourceBeatmapVersion: format });
  const flow = /** @type {{beats:Record<string,unknown>[]}} */ (converted.charts.find((chart) => chart.mode === "flow"));
  assert.deepEqual(flow.beats.filter((beat) => beat.type === "note").map((beat) => beat.placement), [8, 4, 0], `${format} note y=0/1/2 must emit bottom/middle/top`);
  assert.deepEqual(flow.beats.filter((beat) => beat.type === "bomb").map((beat) => beat.placement), [9, 5, 1], `${format} bomb y=0/1/2 must emit bottom/middle/top`);
  const expectedObstacleCells = format === "v2" ? [[2, 6, 10], [2]] : [[10], [6], [2]];
  assert.deepEqual(flow.beats.filter((beat) => beat.type === "obstacle").map((beat) => beat.cells), expectedObstacleCells, `${format} obstacle coverage must emit its supported source rows exactly once`);
  const arc = flow.beats.find((beat) => beat.type === "arc");
  assert.deepEqual([arc?.startPlacement, arc?.endPlacement], [8, 0], `${format} arc head/tail must emit canonical cells exactly once`);
  assert.equal(typeof arc?.startNoteRef, "string", `${format} canonical arc placement must preserve raw-source note linking`);
  assert.equal(typeof arc?.endNoteRef, "string", `${format} canonical arc placement must preserve raw-source note linking`);
  const burst = flow.beats.find((beat) => beat.type === "burst");
  if (format === "v2") assert.equal(burst, undefined, "v2 has no native burst/chain record");
  else assert.deepEqual([burst?.placement, burst?.tailPlacement], [8, 0], `${format} burst/chain head/tail must emit canonical cells exactly once`);
}

const guardSummary = {
  colorNotes: [
    { start: 1, x: 0, y: 0, cell: 0, hand: "left", direction: 8, sourceIndex: 0 },
    { start: 1, x: 3, y: 0, cell: 3, hand: "right", direction: 8, sourceIndex: 1 }
  ],
  bombNotes: [], obstacles: [], sliders: [], burstSliders: []
};
const guardConversion = await convertDifficulty(guardSummary, { ...options, songToken: "boxing-orientation-regression" });
for (const chart of /** @type {{mode:string,beats:Record<string,unknown>[]}[]} */ (guardConversion.charts).filter((entry) => entry.mode === "boxing")) {
  const guard = /** @type {{guardTarget:{sourcePair:number[]}}} */ (chart.beats.find((beat) => beat.type === "guard"));
  assert.deepEqual(guard.guardTarget.sourcePair, [8, 11], "Boxing must retain its existing single bottom-left to top-left transform");
}

const evidence = JSON.parse(await readFile(new URL("../fixtures/flow-orientation-3c9d-easy-v1.json", import.meta.url), "utf8"));
assert.equal(evidence.schema, "aerobeat/flow_orientation_evidence");
assert.equal(evidence.source.mapId, "3C9D");
assert.equal(evidence.source.versionHash, "5662f64a12c76a3dd11a5f6ee22611608cd06760");
assert.equal(evidence.source.characteristic, "Standard");
assert.equal(evidence.source.difficulty, "Easy");
const evidenceSummary = {
  colorNotes: evidence.notes.map((note) => ({ sourceIndex: note.sourceIndex, start: note.beat, x: note.x, y: note.y, cell: note.cell, hand: note.hand, direction: note.direction, angleOffset: 0, hasAngleOffset: false })),
  bombNotes: [], obstacles: [], sliders: [], burstSliders: []
};
const evidenceConversion = await convertDifficulty(evidenceSummary, {
  ...options,
  songToken: "3c9d",
  sourceId: evidence.source.mapId,
  sourceVersionHash: evidence.source.versionHash,
  sourceDifficultyPath: evidence.source.difficultyPath
});
const evidenceFlow = /** @type {{beats:Record<string,unknown>[]}} */ (evidenceConversion.charts.find((chart) => chart.mode === "flow"));
const actualPlacements = evidenceFlow.beats.map((beat) => beat.placement);
assert.deepEqual(actualPlacements, evidence.notes.map((note) => note.canonicalCell), "sanitized 3C9D first Easy notes must match canonical source-view row orientation");
assert.equal(evidenceFlow.beats.find((beat) => beat.start === 21)?.placement, 11, "3C9D Easy beat 21 x=3,y=0 must emit cell 11");
assert.notEqual(evidenceFlow.beats.find((beat) => beat.start === 21)?.placement, 3, "3C9D Easy beat 21 must not retain the raw bottom-origin cell");

console.log("Flow orientation validation passed for v2/v3/v4 notes, bombs, arcs, bursts/chains, obstacles, Boxing non-regression, and sanitized 3C9D Standard Easy evidence.");

/** @param {"v2"|"v3"|"v4"} format */
function orientationBeatmap(format) {
  if (format === "v2") return {
    _version: "2.6.0",
    _notes: [
      { _time: 1, _lineIndex: 0, _lineLayer: 0, _type: 0, _cutDirection: 1 },
      { _time: 2, _lineIndex: 0, _lineLayer: 1, _type: 0, _cutDirection: 1 },
      { _time: 3, _lineIndex: 0, _lineLayer: 2, _type: 0, _cutDirection: 1 },
      { _time: 4, _lineIndex: 1, _lineLayer: 0, _type: 3, _cutDirection: 8 },
      { _time: 5, _lineIndex: 1, _lineLayer: 1, _type: 3, _cutDirection: 8 },
      { _time: 6, _lineIndex: 1, _lineLayer: 2, _type: 3, _cutDirection: 8 }
    ],
    _obstacles: [
      { _time: 7, _duration: 1, _lineIndex: 2, _type: 0, _width: 1 },
      { _time: 8, _duration: 1, _lineIndex: 2, _type: 1, _width: 1 }
    ],
    _sliders: [{ _headTime: 1, _tailTime: 3, _headLineIndex: 0, _headLineLayer: 0, _tailLineIndex: 0, _tailLineLayer: 2, _colorType: 0, _headCutDirection: 1, _tailCutDirection: 1 }]
  };
  if (format === "v3") return {
    version: "3.3.0",
    colorNotes: [0, 1, 2].map((y, index) => ({ b: index + 1, x: 0, y, c: 0, d: 1 })),
    bombNotes: [0, 1, 2].map((y, index) => ({ b: index + 4, x: 1, y })),
    obstacles: [0, 1, 2].map((y, index) => ({ b: index + 7, d: 1, x: 2, y, w: 1, h: 1 })),
    sliders: [{ b: 1, tb: 3, x: 0, y: 0, tx: 0, ty: 2, c: 0, d: 1, tc: 1 }],
    burstSliders: [{ b: 1, tb: 3, x: 0, y: 0, tx: 0, ty: 2, c: 0, d: 1, sc: 3 }]
  };
  return {
    version: "4.0.0",
    colorNotesData: [0, 1, 2].map((y) => ({ x: 0, y, c: 0, d: 1 })),
    colorNotes: [0, 1, 2].map((_, index) => ({ b: index + 1, i: index })),
    bombNotesData: [0, 1, 2].map((y) => ({ x: 1, y })),
    bombNotes: [0, 1, 2].map((_, index) => ({ b: index + 4, i: index })),
    obstaclesData: [0, 1, 2].map((y) => ({ d: 1, x: 2, y, w: 1, h: 1 })),
    obstacles: [0, 1, 2].map((_, index) => ({ b: index + 7, i: index })),
    arcsData: [{ m: 1, tm: 1, a: 0 }],
    arcs: [{ hb: 1, tb: 3, hi: 0, ti: 2, ai: 0 }],
    chainsData: [{ tx: 0, ty: 2, c: 3 }],
    chains: [{ hb: 1, tb: 3, i: 0, ci: 0 }]
  };
}
