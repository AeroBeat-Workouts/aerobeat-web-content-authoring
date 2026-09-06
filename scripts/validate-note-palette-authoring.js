// @ts-nocheck

import assert from "node:assert/strict";
import { canonicalJson, createAeroWebContentAuthoringService, createMemoryPersistenceAdapter, executeWorkerConversion, prefixedSha256, semanticParityHash, validateAuthoredPackage } from "../src/index.js";

const encoder=new TextEncoder();
const infoBytes=encoder.encode('{"_version":"2.1.0"}');
const difficultyBytes=encoder.encode(JSON.stringify({version:"3.3.0",colorNotes:[{b:1,x:0,y:0,c:0,d:8},{b:2,x:3,y:2,c:1,d:1}],bombNotes:[],obstacles:[],sliders:[],burstSliders:[]}));
const audioBytes=new Uint8Array([7,11,13]);
const infoHash=await prefixedSha256(infoBytes),difficultyHash=await prefixedSha256(difficultyBytes);
const sourcePalette={schema:"aerobeat/source_note_palette",version:1,left:"#FF7E14",right:"#0080FF",colorSpace:"srgb",alpha:1,provenance:{kind:"difficulty_custom_data",infoFormat:"v2",infoHash,difficultyHash,fieldSet:"v2_custom",schemeIndex:null}};
let captured;
const worker={kind:"inline",async convert(request,runtime){captured=structuredClone(request);return executeWorkerConversion(request,runtime);},destroy(){}};
const persistence=createMemoryPersistenceAdapter();
const service=createAeroWebContentAuthoringService({worker,persistence,now:()=>17});
const authored=await service.convertAndPersist(sourceBundle(sourcePalette),{difficulty:"Hard",sourceProvider:"synthetic",sourceId:"palette",sourceVersionHash:"1".repeat(40),cacheSourceEntries:true});
assert.deepEqual(authored.package.notePalette,{schema:"aerobeat/authored_note_palette",version:1,left:"#FF7E14",right:"#0080FF",colorSpace:"srgb",alpha:1,paletteHash:authored.package.notePalette.paletteHash,provenance:sourcePalette.provenance});
assert.match(authored.package.notePalette.paletteHash,/^sha256:[0-9a-f]{64}$/u);
const flow=authored.package.charts.find((chart)=>chart.mode==="flow"),boxing=authored.package.charts.filter((chart)=>chart.mode==="boxing");
assert.deepEqual(flow.notePalette,{source:"package",paletteHash:authored.package.notePalette.paletteHash});
assert.equal(flow.contentHash,authored.package.conversionTrace.flow[0].contentHash);
assert.deepEqual(authored.package.conversionTrace.notePalette,flow.notePalette);
assert.equal(flow.beats.some((beat)=>Object.hasOwn(beat,"notePalette")||Object.hasOwn(beat,"paletteHash")||Object.hasOwn(beat,"appearanceColor")),false);
assert.equal(boxing.some((chart)=>Object.hasOwn(chart,"notePalette")||chart.beats.some((beat)=>Object.hasOwn(beat,"notePalette")||Object.hasOwn(beat,"paletteHash")||Object.hasOwn(beat,"appearanceColor"))),false);assert.equal(authored.package.conversionTrace.boxing.some((trace)=>Object.hasOwn(trace,"notePalette")||Object.hasOwn(trace,"paletteHash")),false);
assert.equal((await validateAuthoredPackage(authored.package)).valid,true);
for(const field of ["flow","boxing"]){const missingTrace=structuredClone(authored.package);missingTrace.conversionTrace[field]=[];assert.equal((await validateAuthoredPackage(missingTrace)).valid,false,`missing ${field} traces must invalidate package integrity`);}
const paletteBeat=structuredClone(authored.package),paletteFlow=paletteBeat.charts.find((chart)=>chart.mode==="flow");paletteFlow.beats[0].notePalette={source:"package",paletteHash:authored.package.notePalette.paletteHash};paletteFlow.contentHash=await prefixedSha256(canonicalJson({beats:paletteFlow.beats,rulesetId:paletteFlow.rulesetId,notePalette:paletteFlow.notePalette}));paletteBeat.conversionTrace.flow[0].contentHash=paletteFlow.contentHash;assert.equal((await validateAuthoredPackage(paletteBeat)).valid,false,"palette data must be forbidden from every Flow beat even when hashes are recomputed");

const fallback=createAeroWebContentAuthoringService({persistence:createMemoryPersistenceAdapter(),now:()=>17});
const fallbackAuthored=await fallback.convertAndPersist(sourceBundle(null),{difficulty:"Hard",sourceProvider:"synthetic",sourceId:"palette",sourceVersionHash:"1".repeat(40)});
assert.equal(fallbackAuthored.package.notePalette,null);assert.equal(fallbackAuthored.package.charts.find((chart)=>chart.mode==="flow").notePalette,null);
assert.deepEqual(boxing.map((chart)=>[chart.prototype.contentHash,chart.beats]),fallbackAuthored.package.charts.filter((chart)=>chart.mode==="boxing").map((chart)=>[chart.prototype.contentHash,chart.beats]),"palette must be absent from Boxing semantic/scoring identities");
assert.notEqual(flow.contentHash,fallbackAuthored.package.charts.find((chart)=>chart.mode==="flow").contentHash);
assert.notEqual(await semanticParityHash(authored.package),await semanticParityHash(fallbackAuthored.package));

assert.ok(captured);const workerPaletteTamper=structuredClone(captured);workerPaletteTamper.manifest.selectedDifficulty.notePalette.provenance.infoHash=`sha256:${"f".repeat(64)}`;
await assert.rejects(()=>executeWorkerConversion(workerPaletteTamper),hasCode("worker_request_invalid"));
const workerOptionTamper=structuredClone(captured);workerOptionTamper.options.notePalette=null;
await assert.rejects(()=>executeWorkerConversion(workerOptionTamper),hasCode("worker_request_invalid"));
const paletteSubstitutionWorker={kind:"inline",async convert(request,runtime){const result=structuredClone(await executeWorkerConversion(request,runtime)),pkg=result.package,flowChart=pkg.charts.find((chart)=>chart.mode==="flow");pkg.notePalette=null;pkg.conversionTrace.notePalette=null;flowChart.notePalette=null;flowChart.contentHash=await prefixedSha256(canonicalJson({beats:flowChart.beats,rulesetId:flowChart.rulesetId,notePalette:null}));pkg.conversionTrace.flow[0].notePalette=null;pkg.conversionTrace.flow[0].contentHash=flowChart.contentHash;result.packageHash=await prefixedSha256(canonicalJson(pkg));result.semanticParityHash=await semanticParityHash(pkg);return result;},destroy(){}};const substitutionService=createAeroWebContentAuthoringService({worker:paletteSubstitutionWorker});await assert.rejects(()=>substitutionService.convertAndPersist(sourceBundle(sourcePalette),{difficulty:"Hard",sourceId:"palette"}),hasCode("worker_result_invalid"));substitutionService.destroy();
const sourceTamper=structuredClone(sourcePalette);sourceTamper.provenance.difficultyHash=`sha256:${"e".repeat(64)}`;
await assert.rejects(()=>createAeroWebContentAuthoringService().convertAndPersist(sourceBundle(sourceTamper),{difficulty:"Hard"}),hasCode("source_palette_provenance_mismatch"));
let getterCalls=0;const hostilePalette={...sourcePalette};Object.defineProperty(hostilePalette,"left",{enumerable:true,get(){getterCalls+=1;return"#FFFFFF";}});
await assert.rejects(()=>createAeroWebContentAuthoringService().convertAndPersist(sourceBundle(hostilePalette),{difficulty:"Hard"}),hasCode("source_palette_invalid"));assert.equal(getterCalls,0);
let formatCoercions=0;const hostileFormat={toString(){formatCoercions+=1;return"v3";}};await assert.rejects(()=>createAeroWebContentAuthoringService().convertAndPersist(sourceBundle(null,hostileFormat),{difficulty:"Hard"}),hasCode("source_manifest_invalid"));assert.equal(formatCoercions,0,"source format validation must not execute coercion hooks");
await assert.rejects(()=>createAeroWebContentAuthoringService().convertAndPersist(sourceBundle(null),{difficulty:"Hard",limits:{cacheEntryBytes:infoBytes.byteLength-1}}),hasCode("source_entry_too_large"));
const exported=await service.exportPackage(authored.handle);assert.equal(exported.bytes.some((value)=>value!==0),true);assert.equal((await service.listPackages()).length,1);
service.destroy();fallback.destroy();
console.log(`Note palette authoring v2/v4 validation passed: palette ${authored.package.notePalette.paletteHash}, Flow ${flow.contentHash}, semantic ${await semanticParityHash(authored.package)}.`);

/** @param {unknown} notePalette @param {unknown} [beatMapFormat] */
function sourceBundle(notePalette,beatMapFormat="v3"){const entries=new Map([["info.dat",infoBytes],["hard.dat",difficultyBytes],["song.ogg",audioBytes]]);return Object.freeze({manifest:Object.freeze({schemaId:"aerobeat.beatsaver-source-manifest.v2",infoFormatMajor:2,infoFormat:"v2",infoVersion:"2.1.0",infoPath:"Info.dat",hashInputPaths:Object.freeze(["Hard.dat"]),songName:"Palette",songSubName:"",songAuthorName:"AeroBeat",levelAuthorName:"AeroBeat",audioPath:"song.ogg",coverPath:"",bpm:120,previewStartSeconds:0,previewDurationSeconds:0,difficulties:Object.freeze([{characteristic:"Standard",difficulty:"Hard",difficultyRank:5,path:"Hard.dat",beatMapFormatMajor:3,beatMapFormat,beatMapVersion:"3.3.0",notePalette,noteJumpMovementSpeed:10,noteJumpStartBeatOffset:0}]),entries:Object.freeze([]),archiveBytes:0,expandedBytes:0}),listEntryPaths(){return Object.freeze(["Info.dat","Hard.dat","song.ogg"]);},readEntry(path){const bytes=entries.get(path.toLowerCase());if(!bytes)throw new Error("missing entry");return Uint8Array.from(bytes);}});}
/** @param {string} code */
function hasCode(code){return(error)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code===code);}
