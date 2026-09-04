// @ts-check

import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import {
  canonicalJson,
  convertDifficulty,
  createAeroWebContentAuthoringService,
  createBrowserAuthoringWorkerAdapter,
  createIndexedDbPersistenceAdapter,
  createMemoryPersistenceAdapter,
  executeWorkerConversion,
  exportAuthoredPackage,
  inspectAuthoredPackageExport,
  prefixedSha256,
  prepareAllStandardSourceMaterials,
  prepareSourceMaterial,
  validateAuthoredPackage
} from "../src/index.js";

const encoder = new TextEncoder();
class FakeWorker { constructor(){this.onmessage=null;this.onerror=null;this.terminated=false;} postMessage(){} terminate(){this.terminated=true;} emit(data){this.onmessage?.({data});} }
const empty = { colorNotes: [], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
/** @type {Parameters<typeof convertDifficulty>[1]} */
const conversionOptions = { difficulty: "Hard", songToken: "audit", songName: "Audit", bpm: 120, sourceProvider: "synthetic", sourceId: "audit", sourceVersionHash: "v1", sourceDifficultyPath: "hard.dat", sourceBeatmapVersion: "v3" };

// Final Godot safety fixes: no zero-time reach allowance and full inclusive guard reservations.
const unreachable = await convertDifficulty({ ...empty, colorNotes: [{ start: 0, cell: 0, hand: "left", direction: 2, sourceIndex: 0 }] }, conversionOptions);
assert.ok(unreachable.traces.every((trace) => traceEvents(trace).some((event) => event.reason === "unreachable_before_optimizer")), "zero-time punch must not receive a free subcell");
const guardWindow = await convertDifficulty({ ...empty, colorNotes: [
  { start: 1, cell: 5, hand: "left", direction: 8, sourceIndex: 0 }, { start: 1, cell: 6, hand: "right", direction: 8, sourceIndex: 1 },
  { start: 1.36, cell: 5, hand: "left", direction: 8, sourceIndex: 2 }, { start: 1.361, cell: 6, hand: "right", direction: 8, sourceIndex: 3 }
] }, conversionOptions);
assert.ok(guardWindow.traces.every((trace) => traceEvents(trace).some((event) => eventHasSource(event,"note-002") && event.reason === "guard_window_reserved_before_optimizer")), "exact +180ms guard boundary must reserve punches");
assert.ok(guardWindow.traces.every((trace) => !traceEvents(trace).some((event) => eventHasSource(event,"note-003") && event.reason === "guard_window_reserved_before_optimizer")), "outside guard boundary must not be mislabeled reserved");

const crossed = await convertDifficulty({ ...empty, colorNotes: [{ start: 2, cell: 6, hand: "left", direction: 8, sourceIndex: 0 }, { start: 2, cell: 5, hand: "right", direction: 8, sourceIndex: 1 }] }, { ...conversionOptions, modifiers: ["no_squats", "no_squats"] });
for (const chart of crossed.charts.filter((chart) => chart.mode === "boxing")) assert.deepEqual((/** @type {Record<string, unknown>} */ (chart.prototype)).modifiers, ["crossed_guard", "no_squats"]);
const tamperedModifiers = structuredClone(crossed.package); tamperedModifiers.charts[0].prototype.modifiers = ["no_squats"];
assert.equal((await validateAuthoredPackage(tamperedModifiers)).valid, false, "validator must reject a modifier projection hiding emitted crossed_guard");
let chartGetterCalls=0;const accessorPackage=structuredClone(crossed.package);Object.defineProperty(accessorPackage.charts,"0",{enumerable:true,get(){chartGetterCalls+=1;return crossed.package.charts[0];}});assert.equal((await validateAuthoredPackage(accessorPackage)).valid,false);assert.equal(chartGetterCalls,0,"package array accessors must not execute");

// Source capability: normalized uniqueness, strict own data properties, bounds, copies and external integrity.
const bytes = encoder.encode(JSON.stringify({ version: "3.3.0", colorNotes: [], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const audio = new Uint8Array([1, 2, 3]);
const difficultyHash = await prefixedSha256(bytes); const audioHash = await prefixedSha256(audio);
const source = sourceBundle(bytes, audio);
const material = await prepareSourceMaterial(source, { difficulty: "Hard", expectedDifficultyContentHashes: { "HARD.DAT": difficultyHash }, expectedAudioContentHash: audioHash });
bytes[0] ^= 255; audio[0] ^= 255;
assert.notEqual(material.difficultyBytes[0], bytes[0], "selected bytes must be copied out of source capability");
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"), new Uint8Array([1])), { difficulty: "Hard", expectedDifficultyContentHashes: { "hard.dat": difficultyHash } }), hasCode("difficulty_hash_mismatch"));
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"), new Uint8Array([1])), { difficulty: "Hard", expectedAudioContentHash: audioHash }), hasCode("audio_hash_mismatch"));
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"), new Uint8Array([1])), { difficulty: "Hard", expectedAudioContentHash: "" }), hasCode("source_hash_invalid"));
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"), new Uint8Array(), ["Hard.dat", "hard.DAT", "song.ogg"]), { difficulty: "Hard" }), hasCode("source_paths_duplicate"));
await assert.rejects(() => prepareSourceMaterial(sourceBundle(new Uint8Array(8), new Uint8Array(), undefined), { difficulty: "Hard", limits: { difficultyBytes: 4 } }), hasCode("source_entry_too_large"));
let accessorCalls = 0; const accessorSource = {}; Object.defineProperty(accessorSource, "manifest", { enumerable: true, get() { accessorCalls += 1; return {}; } });
await assert.rejects(() => prepareSourceMaterial(accessorSource, { difficulty: "Hard" }), hasCode("source_bundle_invalid")); assert.equal(accessorCalls, 0);
await assert.rejects(() => prepareSourceMaterial(Object.create({ manifest: {} }), { difficulty: "Hard" }), hasCode("source_invalid"));
let pathGetterCalls=0;const getterPaths=["Info.dat","Hard.dat","song.ogg"];Object.defineProperty(getterPaths,"1",{enumerable:true,get(){pathGetterCalls+=1;return"Hard.dat";}});
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"),new Uint8Array(),getterPaths),{difficulty:"Hard"}),hasCode("source_paths_invalid"));assert.equal(pathGetterCalls,0,"path array accessors must not execute");
await assert.rejects(() => prepareSourceMaterial(sourceBundle(encoder.encode("{}"),new Uint8Array()),/** @type {never} */({difficulty:"Hard",limits:{entryCount:2}})),hasCode("source_paths_invalid"));
let coercionCalls=0;await assert.rejects(() => prepareSourceMaterial(source,/** @type {never} */({difficulty:{toString(){coercionCalls+=1;return"Hard";}}})),hasCode("difficulty_invalid"));assert.equal(coercionCalls,0,"option coercion hooks must not execute");
let difficultyGetterCalls=0;const maliciousDifficulty={};Object.defineProperty(maliciousDifficulty,"characteristic",{enumerable:true,get(){difficultyGetterCalls+=1;return"Standard";}});const secureBatchSource={...source,manifest:{...source.manifest,difficulties:[maliciousDifficulty,...source.manifest.difficulties]}};const secureBatch=await prepareAllStandardSourceMaterials(secureBatchSource,{});assert.equal(secureBatch.materials.length,1);assert.equal(difficultyGetterCalls,0,"batch manifest accessors must not execute");
const snapshotService=createAeroWebContentAuthoringService();await assert.rejects(()=>snapshotService.convertAndPersist(source,/** @type {never} */({difficulty:"Hard",sourceId:new Uint8Array([1])})),hasCode("request_invalid"));assert.equal(snapshotService.getSnapshot().state,"queued");assert.equal(JSON.stringify(snapshotService.getSnapshot()).includes("Uint8Array"),false);snapshotService.destroy();
const maliciousWorker={kind:"inline",async convert(workerValue,runtime){const result=/** @type {{package:Record<string,unknown>,packageHash:string}} */(structuredClone(await executeWorkerConversion(workerValue,runtime)));const resultSource=/** @type {Record<string,unknown>} */(result.package.source);resultSource.sourceId="substituted";result.packageHash=await prefixedSha256(canonicalJson(result.package));return result;},destroy(){}};const boundSource=sourceBundle(encoder.encode(JSON.stringify({version:"3.3.0",colorNotes:[],bombNotes:[],obstacles:[],sliders:[],burstSliders:[]})),new Uint8Array([1,2,3]));const boundService=createAeroWebContentAuthoringService({worker:maliciousWorker});await assert.rejects(()=>boundService.convertAndPersist(boundSource,{difficulty:"Hard",sourceId:"audit",sourceVersionHash:"v1",sourceProvider:"local",includeAudio:true}),hasCode("worker_result_invalid"));assert.equal((await boundService.listPackages()).length,0,"source-substituted Worker results must not persist");boundService.destroy();
const replacementService=createAeroWebContentAuthoringService();const replaced=replacementService.convertAndPersist(boundSource,{difficulty:"Hard",sourceId:"old",sourceVersionHash:"v1",includeAudio:false});const replacedAssertion=assert.rejects(()=>replaced,hasCode("operation_aborted"));const replacement=await replacementService.convertAndPersist(boundSource,{difficulty:"Hard",sourceId:"new",sourceVersionHash:"v1",includeAudio:false});await replacedAssertion;const replacementSource=/** @type {Record<string,unknown>} */(replacement.package.source);assert.equal(replacementSource.sourceId,"new");assert.equal((await replacementService.listPackages()).length,1,"replacement must leave only current durable output");replacementService.destroy();

// Worker exactness, message/job binding, observer isolation and destroy settlement.
const requestBytes = encoder.encode(JSON.stringify({ version: "3.3.0", colorNotes: [], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const request = await workerRequest(requestBytes);
await assert.rejects(() => executeWorkerConversion({ ...request, unknown: true }), hasCode("worker_request_invalid"));
let modifierGetterCalls=0;const accessorModifiers=[];Object.defineProperty(accessorModifiers,"0",{enumerable:true,get(){modifierGetterCalls+=1;return"no_squats";}});Object.defineProperty(accessorModifiers,"length",{value:1});
await assert.rejects(()=>executeWorkerConversion({...request,options:{...request.options,modifiers:accessorModifiers}}),hasCode("worker_request_invalid"));assert.equal(modifierGetterCalls,0,"Worker option accessors must not execute");
await executeWorkerConversion(request, { onProgress() { throw new Error("listener"); } });
const fakeOne = new FakeWorker(); const adapterOne = createBrowserAuthoringWorkerAdapter({ workerFactory: () => /** @type {Worker} */ (/** @type {unknown} */ (fakeOne)) });
const badMessage = adapterOne.convert(request); fakeOne.emit({ schema: "aerobeat/authoring_worker_message", version: 1, kind: "result", jobId: "wrong", result: {} });
await assert.rejects(() => badMessage, hasCode("worker_protocol_invalid"));
const fakeTwo = new FakeWorker(); const adapterTwo = createBrowserAuthoringWorkerAdapter({ workerFactory: () => /** @type {Worker} */ (/** @type {unknown} */ (fakeTwo)) });
const destroyedJob = adapterTwo.convert(request); adapterTwo.destroy(); await assert.rejects(() => destroyedJob, hasCode("worker_destroyed")); assert.equal(fakeTwo.terminated, true);
const fakeThree = new FakeWorker(); const adapterThree = createBrowserAuthoringWorkerAdapter({ workerFactory: () => /** @type {Worker} */ (/** @type {unknown} */ (fakeThree)) });
const controller = new AbortController(); const cancelledJob = adapterThree.convert(request, { signal: controller.signal }); controller.abort(); await assert.rejects(() => cancelledJob, hasCode("operation_aborted"));

// Persistence: quota, shared ownership, migration and failed structured-clone write is atomic.
const quota = createMemoryPersistenceAdapter({ quotaBytes: 4 });
await assert.rejects(() => quota.put(stored("large", crossed.package, "sha256:" + "0".repeat(64), [{ path: "a", bytes: new Uint8Array(8) }])), hasCode("quota_exceeded"));
const shared = createMemoryPersistenceAdapter(); const firstService = createAeroWebContentAuthoringService({ persistence: shared }); const secondService = createAeroWebContentAuthoringService({ persistence: shared }); firstService.destroy(); assert.equal((await secondService.listPackages()).length, 0); secondService.destroy();
const oldName = `audit-migration-${Date.now()}`; await createVersionOne(oldName);
const migrated = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: oldName }); await assert.rejects(() => migrated.get("old"), hasCode("flow_obstacle_reimport_required"), "legacy packages must be retained but blocked from loading because source obstacle geometry is unavailable"); assert.equal((await migrated.list()).length, 1); migrated.destroy();
const atomicName = `audit-atomic-${Date.now()}`; const atomic = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: atomicName });
const invalidRecord = stored("bad", crossed.package, "sha256:" + "0".repeat(64), []); invalidRecord.package.bad = () => undefined;
await assert.rejects(() => atomic.put(invalidRecord)); assert.equal(await atomic.get("bad"), null, "failed IDB clone must not partially write"); atomic.destroy();
let recordGetterCalls=0;const accessorRecord=stored("getter",crossed.package,"sha256:"+"0".repeat(64),[]);Object.defineProperty(accessorRecord,"package",{enumerable:true,get(){recordGetterCalls+=1;return crossed.package;}});const guardedMemory=createMemoryPersistenceAdapter();await assert.rejects(()=>guardedMemory.put(/** @type {never} */(accessorRecord)),hasCode("storage_record_invalid"));assert.equal(recordGetterCalls,0,"persistence record accessors must not execute");guardedMemory.destroy();

// Export: package integrity, normalized unique paths, contiguous ranges, hashes, trailing data.
const valid = await validateAuthoredPackage(crossed.package); assert.equal(valid.valid, true);
const exportRecord = { package: crossed.package, packageHash: valid.packageHash, assets: [{ path: "media/audio/song.ogg", bytes: new Uint8Array([9, 8, 7]) }] };
const exported = await exportAuthoredPackage(exportRecord); const inspected = await inspectAuthoredPackageExport(exported.bytes); assert.equal(inspected.assets.length, 1);
const ordered=await inspectAuthoredPackageExport((await exportAuthoredPackage({...exportRecord,assets:[{path:"z.bin",bytes:new Uint8Array()},{path:"A.bin",bytes:new Uint8Array()}]})).bytes);assert.deepEqual(ordered.assets.map((entry)=>entry.path),["a.bin","z.bin"],"export asset order must be code-point deterministic");
await assert.rejects(() => exportAuthoredPackage({ ...exportRecord, packageHash: "sha256:" + "0".repeat(64) }), hasCode("export_package_hash_mismatch"));
let exportGetterCalls=0;const accessorExport={packageHash:valid.packageHash,assets:[]};Object.defineProperty(accessorExport,"package",{enumerable:true,get(){exportGetterCalls+=1;return crossed.package;}});await assert.rejects(()=>exportAuthoredPackage(/** @type {never} */(accessorExport)),hasCode("export_record_invalid"));assert.equal(exportGetterCalls,0,"export record accessors must not execute");
await assert.rejects(() => exportAuthoredPackage({ ...exportRecord, assets: [{ path: "A/B", bytes: new Uint8Array() }, { path: "a\\b", bytes: new Uint8Array() }] }), hasCode("export_asset_duplicate"));
const corrupted = Uint8Array.from(exported.bytes); corrupted[corrupted.length - 1] ^= 255; await assert.rejects(() => inspectAuthoredPackageExport(corrupted), hasCode("export_asset_hash_mismatch"));
const trailing = new Uint8Array(exported.bytes.length + 1); trailing.set(exported.bytes); await assert.rejects(() => inspectAuthoredPackageExport(trailing), hasCode("export_asset_table_invalid"));
assert.equal(new TextDecoder().decode(exported.bytes).includes("createdAt"), false, "deterministic export must contain no timestamp");

console.log("Parity/security adversarial validation passed.");

/** @param {Uint8Array} difficulty @param {Uint8Array} audioBytes @param {string[]} [listedOverride] */
function sourceBundle(difficulty, audioBytes, listedOverride) { const entries = new Map([["hard.dat", difficulty], ["song.ogg", audioBytes], ["info.dat", encoder.encode("{}")]]); return Object.freeze({ manifest: Object.freeze({ sourceFormatMajor: 3, infoPath: "Info.dat", songName: "Audit", bpm: 120, audioPath: "song.ogg", difficulties: Object.freeze([{ characteristic: "Standard", difficulty: "Hard", path: "Hard.dat" }]) }), listEntryPaths() { return listedOverride ?? ["Info.dat", "Hard.dat", "song.ogg"]; }, readEntry(path) { const value=entries.get(path.toLowerCase()); if(!value)throw new Error("missing"); return value; } }); }
/** @param {Uint8Array} difficultyBytes */
async function workerRequest(difficultyBytes){const hash=await prefixedSha256(difficultyBytes);return{schema:"aerobeat/authoring_worker_request",version:1,kind:"convert",jobId:"audit-job",manifest:{schemaId:"aerobeat.authoring-source.v1",sourceFormatMajor:3,infoPath:"info.dat",songName:"Audit",songAuthorName:"",levelAuthorName:"",bpm:120,audioPath:"",audioContentHash:"",selectedDifficulty:{difficulty:"Hard",path:"hard.dat",contentHash:hash},sourceProvider:"synthetic",sourceId:"audit",sourceVersionHash:"v1"},difficultyBytes,options:{...conversionOptions,sourceDifficultyHash:hash,audioPath:"",audioContentHash:"",modifiers:[]}};}
/** @param {Record<string, unknown>} event @param {string} sourceId */
function eventHasSource(event,sourceId){return Array.isArray(event.sourceEventIds)&&event.sourceEventIds.includes(sourceId);}
/** @param {Record<string, unknown>} trace */
function traceEvents(trace){return /** @type {Record<string, unknown>[]} */ (trace.events);}
/** @param {string} code */
function hasCode(code){return(error)=>Boolean(error&&typeof error==="object"&&error.code===code);}
/** @param {string} key @param {Record<string, unknown>} packageValue @param {string} packageHash @param {{path:string,bytes:Uint8Array}[]} assets */
function stored(key,packageValue,packageHash,assets){return{key,package:structuredClone(packageValue),packageHash,assets,sourceCache:[],createdAtMs:1,schemaVersion:2,writeToken:"audit"};}
/** @param {string} name */
function createVersionOne(name){return new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{request.result.createObjectStore("packages",{keyPath:"key"}).put({key:"old",package:{packageId:"old"},packageHash:"sha256:"+"0".repeat(64),assets:[],createdAtMs:1,schemaVersion:1});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve(undefined);};});}
