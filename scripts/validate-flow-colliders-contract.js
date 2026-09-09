// @ts-check

import assert from "node:assert/strict";
import {
  canonicalJson,
  convertDifficulty,
  createMemoryPersistenceAdapter,
  deriveBeatSaberSpawnTiming,
  exportAuthoredPackage,
  flowCollidersRulesetId,
  flowGridRulesetId,
  flowRulesetVariants,
  inspectAuthoredPackageExport,
  prefixedSha256,
  semanticParityHash,
  validateAuthoredPackage
} from "../src/index.js";

const sourceHash=`sha256:${"7".repeat(64)}`;
const sourceSummary={
  colorNotes:[{start:1,cell:0,hand:"left",direction:1,angleOffset:0,sourceIndex:0}],
  bombNotes:[{start:2,cell:7,sourceIndex:0}],
  obstacles:[{start:3,duration:1,sourceIndex:0,sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v3_obstacle_rect",kind:"v3_rect",x:1,y:0,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3}}],
  sliders:[],burstSliders:[]
};
const options={difficulty:/** @type {const} */("Hard"),songToken:"flow-colliders-contract",songName:"Flow Colliders Contract",bpm:120,noteJumpMovementSpeed:10,noteJumpStartBeatOffset:1,spawnTiming:deriveBeatSaberSpawnTiming(120,10,1),sourceProvider:"synthetic",sourceId:"flow-colliders-contract",sourceVersionHash:"successor-v1",sourceInfoFormat:/** @type {const} */("v2"),sourceInfoVersion:"2.1.0",sourceInfoHash:sourceHash,sourceDifficultyPath:"Hard.dat",sourceBeatmapFormat:/** @type {const} */("v3"),sourceBeatmapVersion:"3.3.0",sourceDifficultyHash:sourceHash,notePalette:null};
const converted=await convertDifficulty(sourceSummary,options);
const packageValue=/** @type {Record<string,unknown>} */(converted.package);
const flow=/** @type {Record<string,unknown>} */(/** @type {Record<string,unknown>[]} */(packageValue.charts).find((chart)=>chart.mode==="flow"));
const trace=/** @type {Record<string,unknown>} */(/** @type {Record<string,unknown>[]} */(/** @type {Record<string,unknown>} */(packageValue.conversionTrace).flow)[0]);
assert.deepEqual(flowRulesetVariants,[flowGridRulesetId,flowCollidersRulesetId]);
assert.deepEqual(flow.rulesetVariants,flowRulesetVariants);
assert.deepEqual(trace.rulesetVariants,flowRulesetVariants);
assert.equal(trace.rulesetId,flowGridRulesetId);
assert.equal(trace.contentHash,flow.contentHash);
assert.deepEqual(/** @type {Record<string,unknown>[]} */(flow.beats).map((beat)=>beat.type),["note","bomb","obstacle"],"successor must retain exact authored note/bomb/wall records once");
assert.equal(Object.hasOwn(flow,"variants"),false,"successor must not duplicate mutable beat truth per variant");
assert.equal((await validateAuthoredPackage(packageValue)).valid,true);

const originalHash=converted.packageHash,originalParity=await semanticParityHash(packageValue);
for(const variants of [undefined,[flowGridRulesetId],[flowCollidersRulesetId],[flowCollidersRulesetId,flowGridRulesetId],[flowGridRulesetId,flowCollidersRulesetId,flowCollidersRulesetId]]){
  const tampered=structuredClone(packageValue),tamperedCharts=/** @type {Record<string,unknown>[]} */(tampered.charts),tamperedFlow=/** @type {Record<string,unknown>} */(tamperedCharts.find((chart)=>chart.mode==="flow")),tamperedTrace=/** @type {Record<string,unknown>} */(/** @type {Record<string,unknown>[]} */(/** @type {Record<string,unknown>} */(tampered.conversionTrace).flow)[0]);
  if(variants===undefined){delete tamperedFlow.rulesetVariants;delete tamperedTrace.rulesetVariants;}else{tamperedFlow.rulesetVariants=variants;tamperedTrace.rulesetVariants=variants;}
  tamperedFlow.contentHash=await prefixedSha256(canonicalJson({beats:tamperedFlow.beats,rulesetId:tamperedFlow.rulesetId,...(variants===undefined?{}:{rulesetVariants:variants}),notePalette:tamperedFlow.notePalette}));tamperedTrace.contentHash=tamperedFlow.contentHash;
  const validation=await validateAuthoredPackage(tampered);
  assert.equal(validation.valid,false,"missing, partial, reordered or duplicated successor rulesets must fail closed even after attacker rehash");
  assert.ok(validation.issues.some((issue)=>issue.code==="flow_chart_schema_invalid"||issue.code==="flow_trace_invalid"));
}

const v5=structuredClone(packageValue),v5Charts=/** @type {Record<string,unknown>[]} */(v5.charts),v5Flow=/** @type {Record<string,unknown>} */(v5Charts.find((chart)=>chart.mode==="flow")),v5Trace=/** @type {Record<string,unknown>} */(/** @type {Record<string,unknown>[]} */(/** @type {Record<string,unknown>} */(v5.conversionTrace).flow)[0]);
v5.schemaId="aerobeat.song-package.v5";v5.schemaVersion=5;v5.packageVersion="5.0.0";v5Flow.schemaId="aerobeat.chart.flow.v4";v5Flow.schemaVersion=4;delete v5Flow.rulesetVariants;delete v5Trace.rulesetVariants;
v5Flow.contentHash=await prefixedSha256(canonicalJson({beats:v5Flow.beats,rulesetId:v5Flow.rulesetId,notePalette:v5Flow.notePalette}));v5Trace.contentHash=v5Flow.contentHash;
const v5Validation=await validateAuthoredPackage(v5);assert.ok(v5Validation.issues.some((issue)=>issue.code==="flow_colliders_reimport_required"),"a v5 package must require source reimport rather than promotion");
const persistence=createMemoryPersistenceAdapter();await persistence.put({key:"v5",package:v5,packageHash:await prefixedSha256(canonicalJson(v5)),assets:[],sourceCache:[],createdAtMs:1,schemaVersion:7,writeToken:"v5"});assert.equal((await persistence.getForExport("v5"))?.package.schemaVersion,5);await assert.rejects(()=>persistence.get("v5"),(error)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="flow_colliders_reimport_required"));persistence.destroy();

assert.notEqual(originalHash,await prefixedSha256(canonicalJson(v5)),"successor package identity must differ from its v5 predecessor projection");
assert.notEqual(originalParity,await semanticParityHash(v5),"semantic parity identity must bind the successor rulesets");
const exported=await exportAuthoredPackage({package:packageValue,packageHash:originalHash,assets:[]}),inspected=await inspectAuthoredPackageExport(exported.bytes);assert.equal(inspected.packageHash,originalHash);assert.equal(inspected.packageId,packageValue.packageId);
const forbiddenKeys=new Set(["colliderRadius","colliderCenter","trajectory","segmentEndpoint","distance","velocityVector","confidence","calibrationId","frameId","contactEpisode"]);deepScanKeys(packageValue,(key)=>assert.equal(forbiddenKeys.has(key),false,`private collision evidence ${key} must not enter package/export truth`));
console.log(`Flow Colliders successor contract passed: package ${originalHash}, Flow ${flow.contentHash}, semantic ${originalParity}.`);

/** @param {unknown} value @param {(key:string)=>void} visit */
function deepScanKeys(value,visit){if(!value||typeof value!=="object")return;for(const key of Reflect.ownKeys(value)){if(typeof key!=="string")continue;visit(key);const descriptor=Object.getOwnPropertyDescriptor(value,key);if(descriptor&&"value" in descriptor)deepScanKeys(descriptor.value,visit);}}
