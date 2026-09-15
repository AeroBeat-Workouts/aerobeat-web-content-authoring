// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseBeatMapDifficulty, convertDifficulty, deriveBeatSaberSpawnTiming, semanticParityHash, validateAuthoredPackage } from "../src/index.js";

// t7sv — The committed 3C9D Standard Hard legacy v2.0.0 beatmap contains only
// `_type:1` END markers in its `_obstacles` array (no legitimate `_type:0` START
// entries). Under the classic BeatSaber pairing contract these are all orphaned
// terminators and must be skipped at parse time. After the t7sv fix the parser
// therefore emits zero obstacles for this fixture, not the six type-1 walls the
// pre-fix parser used to produce. The raw file bytes remain pinned so that a
// future drift in the vendored fixture is caught immediately.
const raw = await readFile(new URL("../fixtures/flow-obstacle-3c9d-hard-v1.dat", import.meta.url));
const oracle = JSON.parse(await readFile(new URL("../fixtures/obstacle-normalization-3c9d-hard-golden-v2.json", import.meta.url), "utf8"));
assert.equal(raw.byteLength, 89_424, "3c9d Hard fixture byte length must remain stable");
assert.equal(createHash("sha256").update(raw).digest("hex"), oracle.source.sha256, "3c9d Hard fixture hash must match pinned source sha256");
const rawDocument = JSON.parse(raw.toString("utf8"));
assert.ok(Array.isArray(rawDocument._obstacles) && rawDocument._obstacles.length > 0, "3c9d Hard fixture must retain a non-empty _obstacles container");
for (const entry of rawDocument._obstacles) assert.equal(entry._type, 1, "3c9d Hard fixture contains only _type:1 (END-marker) obstacles");
const summary = parseBeatMapDifficulty(raw, "v2");
assert.equal(summary.obstacles.length, 0, "all-END-marker legacy v2 map must normalize to zero obstacles after t7sv END-skip");
const converted = await convertDifficulty(summary, { difficulty:"Hard", songToken:"3c9d", songName:"3c9d offline fixture", bpm:150,noteJumpMovementSpeed:oracle.source.njs,noteJumpStartBeatOffset:oracle.source.offset,spawnTiming:deriveBeatSaberSpawnTiming(150,oracle.source.njs,oracle.source.offset), sourceProvider:"beatsaver", sourceId:"3c9d", sourceVersionHash:oracle.source.versionHash, sourceInfoFormat:"v2",sourceInfoVersion:"2.0.0",sourceInfoHash:`sha256:${"0".repeat(64)}`,sourceDifficultyPath:"Hard.dat",sourceBeatmapFormat:"v2", sourceBeatmapVersion:"2.0.0", sourceDifficultyHash:`sha256:${oracle.source.sha256}`,notePalette:null });
const packageRecord = /** @type {Record<string, unknown>} */ (converted.package);
assert.deepEqual([packageRecord.schemaId,packageRecord.schemaVersion,packageRecord.packageVersion],["aerobeat.song-package.v6",6,"6.0.0"]);
assert.equal(/** @type {Record<string, unknown>} */ (packageRecord.source).obstacleContract,"normalized_obstacle_v2");
const flow=/** @type {Record<string, unknown>[]} */(packageRecord.charts).find((chart)=>chart.mode==="flow");
assert.deepEqual([flow.schemaId,flow.schemaVersion,flow.rulesetId],["aerobeat.chart.flow.v5",5,"flow_colliders_v1"]);
assert.deepEqual(flow.rulesetVariants,["flow_colliders_v1"]);
assert.equal(/** @type {Record<string, unknown>[]} */(flow.beats).filter((beat)=>beat.type==="obstacle").length, 0, "Flow chart must contain zero obstacles because every source obstacle was an END marker");
assert.equal((await validateAuthoredPackage(converted.package)).valid,true);
const boxingCharts=packageRecord.charts.filter((chart)=>chart.mode==="boxing");assert.equal(boxingCharts.length,1);
for(const chart of boxingCharts){assert.equal(/** @type {Record<string,unknown>[]} */(chart.beats).some((beat)=>String(beat.type??"").startsWith("weave_") || String(beat.type??"")==="squat"), false, "Boxing charts must contain no weave/squat beats because there are no source obstacles");}

// t7sv note on the `v2_type_1` shape: the contracts obstacle contract still accepts
// `v2_type_1` as a valid source geometry kind for historical package bytes, but
// fresh parsing no longer emits one because END markers are skipped entirely at
// parse time (see the synthetic legacy fixture further below). Therefore the old
// `["v2", {_type:1,...}]` pin is removed; the `v2_type_1` pair in the contracts
// matrix remains valid evidence for stored-but-not-reimported packages.
const fixtures=[
  // t7sv: legacy v2 _width uses classic BeatSaber cell semantics where `_width:2`
  // means ONE cell and `_width:4` means TWO cells (the parser remaps 2→1 and 4→2).
  ["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:0,_duration:1,_width:2}]},{kind:"v2_type_0",coordinateSpace:"beatsaber_v2_legacy_obstacle",source:[1,0,1,5],gameplay:[1,0,1,3]}],
  ["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:0,_duration:1,_width:4}]},{kind:"v2_type_0",coordinateSpace:"beatsaber_v2_legacy_obstacle",source:[1,0,2,5],gameplay:[1,0,2,3]}],
  ["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:0,_duration:1,_width:1}]},{kind:"v2_type_0",coordinateSpace:"beatsaber_v2_legacy_obstacle",source:[1,0,1,5],gameplay:[1,0,1,3]}],
  ["v3",{obstacles:[{b:1,d:1,x:0,y:1,w:2,h:2}]},{kind:"v3_rect",coordinateSpace:"beatsaber_v3_obstacle_rect",source:[0,1,2,2],gameplay:[0,0,2,2]}],
  ["v4",{obstacles:[{b:1,i:0}],obstaclesData:[{d:1,x:2,y:0,w:1,h:2}]},{kind:"v4_rect",coordinateSpace:"beatsaber_v4_obstacle_rect",source:[2,0,1,2],gameplay:[2,1,1,2]}]
];
for(const [format,document,expected] of fixtures){const entry=parseBeatMapDifficulty(JSON.stringify(document),/** @type {"v2"|"v3"|"v4"} */(format)).obstacles[0];assert.equal(entry.sourceGeometry.kind,expected.kind);assert.equal(entry.sourceGeometry.coordinateSpace,expected.coordinateSpace);assert.deepEqual([entry.sourceGeometry.x,entry.sourceGeometry.y,entry.sourceGeometry.width,entry.sourceGeometry.height],expected.source);assert.deepEqual([entry.gameplayGeometry.x,entry.gameplayGeometry.y,entry.gameplayGeometry.width,entry.gameplayGeometry.height],expected.gameplay);}

// jci7 — Beat Saber v4 makes the entry-level metadata index `i` and the metadata x/y
// fields OPTIONAL WITH DEFAULT 0. Absent fields default to 0; present-but-invalid
// values must still reject. A field that is absent in both entry and metadata falls
// back to the default 0 path.
{
  const allAbsent = parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1 }], obstaclesData: [{ d: 1, w: 1, h: 1 }] }), "v4").obstacles;
  assert.equal(allAbsent.length, 1, "v4 obstacle with i/x/y all absent must normalize via default 0");
  const a0 = allAbsent[0];
  assert.deepEqual([a0.sourceGeometry.x, a0.sourceGeometry.y, a0.sourceGeometry.width, a0.sourceGeometry.height], [0, 0, 1, 1]);

  const noIndexOnly = parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1 }], obstaclesData: [{ d: 1, x: 2, y: 1, w: 1, h: 1 }] }), "v4").obstacles;
  assert.deepEqual([noIndexOnly[0].sourceGeometry.x, noIndexOnly[0].sourceGeometry.y, noIndexOnly[0].sourceGeometry.width, noIndexOnly[0].sourceGeometry.height], [2, 1, 1, 1], "absent i defaults to index 0; explicit metadata x/y win over default 0");

  const noXOnly = parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, y: 1, w: 1, h: 1 }] }), "v4").obstacles;
  assert.deepEqual([noXOnly[0].sourceGeometry.x, noXOnly[0].sourceGeometry.y, noXOnly[0].sourceGeometry.width, noXOnly[0].sourceGeometry.height], [0, 1, 1, 1], "absent metadata x defaults to 0");

  const noYOnly = parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 2, w: 1, h: 1 }] }), "v4").obstacles;
  assert.deepEqual([noYOnly[0].sourceGeometry.x, noYOnly[0].sourceGeometry.y, noYOnly[0].sourceGeometry.width, noYOnly[0].sourceGeometry.height], [2, 0, 1, 1], "absent metadata y defaults to 0");

  for (const invalid of [
    { obstacles: [{ b: 1, i: -1 }], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 1 }], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 1.5 }], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 0.5, y: 0, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 0, y: -1, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 4, y: 0, w: 1, h: 1 }] },
    { obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 6 }] }
  ]) {
    assert.throws(() => parseBeatMapDifficulty(JSON.stringify(invalid), "v4"), error => /AuthoringParseError/u.test(String(error?.name ?? "")), `present-but-invalid v4 ${JSON.stringify(invalid)} must reject`);
  }
  assert.throws(() => parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1, i: "bad" }], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 1 }] }), "v4"), error => error?.code === "obstacle_index_invalid", "non-numeric v4 i must reject with index code");
  assert.throws(() => parseBeatMapDifficulty(JSON.stringify({ obstacles: [{ b: 1, i: 0 }], obstaclesData: [{ d: 1, x: "bad", y: 0, w: 1, h: 1 }] }), "v4"), error => error?.code === "obstacle_geometry_invalid", "non-numeric v4 metadata x must reject with geometry code");
}

// jci7 regression fixture shaped like the HUNTR/X "Golden" chart pattern that
// failed import with `Required finite obstacle field i is invalid`: a v4 document
// whose obstacle entries omit `i` and whose obstaclesData omits x/y.
{
  // Pre-fix, the HUNTR/X "Golden" chart hit `Required finite obstacle field i is
  // invalid` at import time because `requiredInteger` rejected the absent index.
  // Post-fix, an absent `i` defaults to 0 and the obstacle imports. This block
  // exercises both the pre-fix failure shape (with explicit metadata so the
  // conflict check is not masked by a bad index) AND the minimal spec-compliant
  // shape where every optional field is absent.
  const huntrXInvalid = {
    version: "4.0.0",
    colorNotes: [{ b: 1, x: 1, y: 0, c: 0, d: 8 }],
    bombNotes: [],
    obstacles: [{ b: 2, d: 1, w: 1, h: 1 }],
    obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 1 }],
    sliders: [],
    burstSliders: []
  };
  assert.throws(
    () => parseBeatMapDifficulty(JSON.stringify(huntrXInvalid), "v4"),
    (error) => error?.code === "obstacle_geometry_conflict",
    "v4 entry carrying d/w/h at entry level still trips obstacle_geometry_conflict even when all optional fields are present"
  );

  const huntrXValid = {
    version: "4.0.0",
    colorNotes: [{ b: 1, x: 1, y: 0, c: 0, d: 8 }],
    obstacles: [{ b: 2 }],
    obstaclesData: [{ d: 1, w: 1, h: 1 }]
  };
  const huntrXParsed = parseBeatMapDifficulty(JSON.stringify(huntrXValid), "v4");
  assert.equal(huntrXParsed.obstacles.length, 1, "HUNTR/X-pattern v4 with absent i and absent metadata x/y must import");
  assert.deepEqual(
    [huntrXParsed.obstacles[0].sourceGeometry.x, huntrXParsed.obstacles[0].sourceGeometry.y, huntrXParsed.obstacles[0].sourceGeometry.width, huntrXParsed.obstacles[0].sourceGeometry.height],
    [0, 0, 1, 1]
  );
}

for(const [format,field] of [["v2","_obstacles"],["v3","obstacles"],["v4","obstacles"]])for(const malformed of [{},null,"invalid",0])assert.throws(()=>parseBeatMapDifficulty(JSON.stringify({[field]:malformed,...(format==="v4"?{obstaclesData:[]}:{})}),/** @type {"v2"|"v3"|"v4"} */(format)),error=>error?.code==="obstacle_container_invalid");
for(const [format,document,code] of [["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:2,_duration:1,_width:1}]},"obstacle_type_unsupported"],["v3",{obstacles:[{b:1,d:1,x:3,y:0,w:2,h:5}]},"obstacle_geometry_invalid"],["v4",{obstacles:[{b:1,i:0,x:1}],obstaclesData:[{d:1,x:1,y:0,w:1,h:5}]},"obstacle_geometry_conflict"],["v4",{obstacles:[{b:1,i:0,r:15}],obstaclesData:[{d:1,x:1,y:0,w:1,h:5}]},"obstacle_rotation_unsupported"]])assert.throws(()=>parseBeatMapDifficulty(JSON.stringify(document),/** @type {"v2"|"v3"|"v4"} */(format)),error=>error?.code===code);

// t7sv — Legacy v2 END-marker skip + provenance from BeatSaver map 561f
// (Backstreet Boys - Incomplete, Normal, legacy v2.0.0, version hash
// 793560ce306bc4769f1433fe2836286bfb80c6aa, re-fetchable from
// https://r2cdn.beatsaver.com/793560ce306bc4769f1433fe2836286bfb80c6aa.zip).
// That real-world chart has 8 orphaned `_type:1` END entries (5 with
// `_width:4`); the old parser turned them into five whole-grid walls. The
// synthetic fixture below exercises exactly those cases without committing any
// third-party bytes: one legitimate start, one orphaned END with `_width:4`,
// and one paired START+END. Orphaned ENDs produce no obstacle; paired ENDs are
// ignored (only the start's duration is authoritative); a width-4 start keeps
// its full-height wall.
{
  const syntheticLegacy = {
    _version: "2.0.0",
    _notes: [
      { _time: 1, _lineIndex: 1, _lineLayer: 0, _type: 0, _cutDirection: 8 },
      { _time: 1, _lineIndex: 2, _lineLayer: 0, _type: 1, _cutDirection: 8 }
    ],
    _obstacles: [
      // Legitimate START at beat 4, width 4 (classic two-cell span). This is
      // the only interval we expect.
      { _time: 4, _duration: 2, _lineIndex: 1, _type: 0, _width: 4 },
      // Paired END at beat 6 (same lineIndex, matching terminator) — ignored.
      { _time: 6, _duration: 0, _lineIndex: 1, _type: 1, _width: 4 },
      // Orphaned END at beat 10, lineIndex 2, width 4 (561f pattern). No
      // preceding START on this line; the fix must not emit an obstacle.
      { _time: 10, _duration: 0.0625, _lineIndex: 2, _type: 1, _width: 4 },
      // Another orphaned END at beat 12, lineIndex 3, width 1.
      { _time: 12, _duration: 0.0625, _lineIndex: 3, _type: 1, _width: 1 }
    ]
  };
  const parsed = parseBeatMapDifficulty(JSON.stringify(syntheticLegacy), "v2");
  assert.equal(parsed.obstacles.length, 1, "legacy v2 orphaned/paired END markers must be skipped; only the START produces an obstacle");
  const sole = parsed.obstacles[0];
  assert.equal(sole.start, 4, "sole surviving obstacle must be the legitimate START");
  assert.equal(sole.duration, 2, "start's own _duration is authoritative even when a paired END exists");
  assert.equal(sole.sourceGeometry.kind, "v2_type_0");
  // Classic remap: _width:4 → two cells wide; full-height mapping unchanged.
  assert.deepEqual([sole.sourceGeometry.x, sole.sourceGeometry.y, sole.sourceGeometry.width, sole.sourceGeometry.height], [1, 0, 2, 5]);
  assert.deepEqual([sole.gameplayGeometry.x, sole.gameplayGeometry.y, sole.gameplayGeometry.width, sole.gameplayGeometry.height], [1, 0, 2, 3]);
  assert.equal(sole.sourceIndex, 0, "sourceIndex retains original array position even after END skips");
}
console.log("Versioned source-to-canonical obstacle normalization and exact 3c9d oracle passed.");
