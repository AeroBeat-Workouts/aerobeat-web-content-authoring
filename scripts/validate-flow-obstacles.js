// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseBeatMapDifficulty, convertDifficulty, validateAuthoredPackage } from "../src/index.js";

const raw = await readFile(new URL("../fixtures/flow-obstacle-3c9d-hard-v1.dat", import.meta.url));
const oracle = JSON.parse(await readFile(new URL("../fixtures/obstacle-normalization-3c9d-hard-golden-v2.json", import.meta.url), "utf8"));
assert.equal(raw.byteLength, 89_424);
assert.equal(createHash("sha256").update(raw).digest("hex"), oracle.source.sha256);
const rawObstacle = JSON.parse(raw.toString("utf8"))._obstacles.find((entry) => entry._time === oracle.expected.startBeat);
assert.deepEqual(rawObstacle, oracle.rawObstacle);
const summary = parseBeatMapDifficulty(raw, "v2");
const normalized = summary.obstacles.find((entry) => entry.start === oracle.expected.startBeat);
assert.deepEqual(normalized, { start: oracle.expected.startBeat, duration: oracle.expected.durationBeat, sourceGeometry: oracle.expected.sourceGeometry, gameplayGeometry: oracle.expected.gameplayGeometry, sourceIndex: 2 });
const converted = await convertDifficulty(summary, { difficulty:"Hard", songToken:"3c9d", songName:"3c9d offline fixture", bpm:150, sourceProvider:"beatsaver", sourceId:"3c9d", sourceVersionHash:oracle.source.versionHash, sourceDifficultyPath:"Hard.dat", sourceBeatmapVersion:"2.0.0", sourceDifficultyHash:`sha256:${oracle.source.sha256}` });
const packageRecord = /** @type {Record<string, unknown>} */ (converted.package);
assert.deepEqual([packageRecord.schemaId,packageRecord.schemaVersion,packageRecord.packageVersion],["aerobeat.song-package.v3",3,"3.0.0"]);
assert.equal(/** @type {Record<string, unknown>} */ (packageRecord.source).obstacleContract,"normalized_obstacle_v2");
const flow=/** @type {Record<string, unknown>[]} */(packageRecord.charts).find((chart)=>chart.mode==="flow");
assert.deepEqual([flow.schemaId,flow.schemaVersion,flow.rulesetId],["aerobeat.chart.flow.v3",3,"flow_grid_v2"]);
const obstacle=/** @type {Record<string, unknown>[]} */(flow.beats).find((beat)=>beat.type==="obstacle"&&beat.start===oracle.expected.startBeat);
assert.deepEqual(obstacle,{start:oracle.expected.startBeat,end:oracle.expected.endBeat,type:"obstacle",sourceGeometry:oracle.expected.sourceGeometry,gameplayGeometry:oracle.expected.gameplayGeometry,gridMask:[1,5,9]});
assert.equal((Number(obstacle.end)-Number(obstacle.start))*60_000/150,25);
assert.equal((await validateAuthoredPackage(converted.package)).valid,true);
for(const [field,value] of [["gridMask",[1]],["gameplayGeometry",oracle.expected.sourceGeometry],["sourceGeometry",oracle.expected.gameplayGeometry]]){const bad=structuredClone(converted.package);const badFlow=bad.charts.find((chart)=>chart.mode==="flow");badFlow.beats.find((beat)=>beat.type==="obstacle")[field]=value;assert.equal((await validateAuthoredPackage(bad)).valid,false);}

const fixtures=[
  ["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:0,_duration:1,_width:2}]},{kind:"v2_type_0",coordinateSpace:"beatsaber_v2_legacy_obstacle",source:[1,0,2,5],gameplay:[1,0,2,3]}],
  ["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:1,_duration:1,_width:1}]},{kind:"v2_type_1",coordinateSpace:"beatsaber_v2_legacy_obstacle",source:[1,2,1,3],gameplay:[1,0,1,3]}],
  ["v3",{obstacles:[{b:1,d:1,x:0,y:1,w:2,h:2}]},{kind:"v3_rect",coordinateSpace:"beatsaber_v3_obstacle_rect",source:[0,1,2,2],gameplay:[0,0,2,2]}],
  ["v4",{obstacles:[{b:1,i:0}],obstaclesData:[{d:1,x:2,y:0,w:1,h:2}]},{kind:"v4_rect",coordinateSpace:"beatsaber_v4_obstacle_rect",source:[2,0,1,2],gameplay:[2,1,1,2]}]
];
for(const [format,document,expected] of fixtures){const entry=parseBeatMapDifficulty(JSON.stringify(document),/** @type {"v2"|"v3"|"v4"} */(format)).obstacles[0];assert.equal(entry.sourceGeometry.kind,expected.kind);assert.equal(entry.sourceGeometry.coordinateSpace,expected.coordinateSpace);assert.deepEqual([entry.sourceGeometry.x,entry.sourceGeometry.y,entry.sourceGeometry.width,entry.sourceGeometry.height],expected.source);assert.deepEqual([entry.gameplayGeometry.x,entry.gameplayGeometry.y,entry.gameplayGeometry.width,entry.gameplayGeometry.height],expected.gameplay);}
for(const [format,field] of [["v2","_obstacles"],["v3","obstacles"],["v4","obstacles"]])for(const malformed of [{},null,"invalid",0])assert.throws(()=>parseBeatMapDifficulty(JSON.stringify({[field]:malformed,...(format==="v4"?{obstaclesData:[]}:{})}),/** @type {"v2"|"v3"|"v4"} */(format)),error=>error?.code==="obstacle_container_invalid");
for(const [format,document,code] of [["v2",{_obstacles:[{_time:1,_lineIndex:1,_type:2,_duration:1,_width:1}]},"obstacle_type_unsupported"],["v3",{obstacles:[{b:1,d:1,x:3,y:0,w:2,h:5}]},"obstacle_geometry_invalid"],["v4",{obstacles:[{b:1,i:0,x:1}],obstaclesData:[{d:1,x:1,y:0,w:1,h:5}]},"obstacle_geometry_conflict"],["v4",{obstacles:[{b:1,i:0,r:15}],obstaclesData:[{d:1,x:1,y:0,w:1,h:5}]},"obstacle_rotation_unsupported"]])assert.throws(()=>parseBeatMapDifficulty(JSON.stringify(document),/** @type {"v2"|"v3"|"v4"} */(format)),error=>error?.code===code);
console.log("Versioned source-to-canonical obstacle normalization and exact 3c9d oracle passed.");
