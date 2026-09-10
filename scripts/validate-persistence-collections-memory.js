// @ts-check

import assert from "node:assert/strict";
import { authoringDatabaseVersion, createMemoryPersistenceAdapter } from "../src/index.js";

const hash = `sha256:${"1".repeat(64)}`;
const secondHash = `sha256:${"2".repeat(64)}`;
const audio = new Uint8Array([1, 2, 3, 4]);

const adapter = createMemoryPersistenceAdapter({ quotaBytes: 1024 * 1024 });
await adapter.putCollection(batch("collection-a", [record("easy", "Easy", hash), record("expert", "Expert", hash)], hash, audio));
const listed = await adapter.listCollections();
assert.equal(listed.length, 1);
assert.equal(listed[0].collectionId, "collection-a");
assert.deepEqual(listed[0].packages.map((entry) => entry.difficultyLabel), ["Easy", "Expert"]);
assert.equal("sourceVersionHash" in listed[0], false);
assert.equal("packageHash" in listed[0].packages[0], false);
assert.deepEqual((await adapter.get("easy"))?.assets[0].bytes, audio);
assert.equal((await adapter.get("easy"))?.flowCellOrientation, "aerobeat_top_left_v1", "memory writes must be marked current internally");
assert.equal((await adapter.get("easy"))?.obstacleContract, "normalized_obstacle_v2", "proven Flow v2 geometry writes must be marked current internally");
assert.deepEqual((await adapter.get("expert"))?.assets[0].bytes, audio);

await adapter.putCollection(batch("collection-b", [record("hard", "Hard", hash)], hash, audio));
assert.equal(await adapter.deleteCollection("collection-a"), true);
assert.deepEqual((await adapter.get("hard"))?.assets[0].bytes, audio, "shared audio must survive while referenced");
assert.equal(await adapter.deleteCollection("collection-b"), true);
assert.equal(await adapter.get("hard"), null);

const legacy = createMemoryPersistenceAdapter();
await assert.rejects(()=>legacy.put(legacyRecord("unknown")),hasCode("storage_record_invalid"),"new writes with an unknown package generation must not be mislabeled as obstacle- or palette-stale");
const forged=legacyRecord("forged");forged.package.source.obstacleContract="normalized_obstacle_v2";await assert.rejects(()=>legacy.put(forged),hasCode("storage_record_invalid"),"a hostile current source stamp must not make an unknown generation historical");
const malformed={...legacyRecord("malformed"),package:sourceGeometryPackage("malformed","Hard")};malformed.package.charts[0].beats[0].gridMask=[1];await legacy.put(malformed);await assert.rejects(()=>legacy.get("malformed"),hasCode("flow_obstacle_reimport_required"),"invalid geometry/mask truth in the current package generation must fail closed");assert.equal((await legacy.getForExport("malformed"))?.obstacleContract,"prior_obstacle_contract");assert.equal(await legacy.delete("malformed"),true);
assert.equal((await legacy.list()).length, 0);

const history=createMemoryPersistenceAdapter();const historical=historicalV3Record("song-v3");await history.put(historical);const historicalBytes=(await history.getForExport("song-v3"))?.assets[0].bytes;assert.deepEqual(historicalBytes,audio);assert.equal((await history.list())[0].packageHash,historical.packageHash);await assert.rejects(()=>history.get("song-v3"),hasCode("spawn_timing_reimport_required"));const current=standaloneRecord("song-v6","Hard");await history.put(current);assert.equal((await history.get("song-v6"))?.package.schemaId,"aerobeat.song-package.v6","same-source reimport must create a current package without rewriting historical bytes");assert.equal((await history.list()).length,2);assert.deepEqual((await history.getForExport("song-v3"))?.assets[0].bytes,historicalBytes);assert.equal(await history.delete("song-v3"),true);assert.equal((await history.get("song-v6"))?.package.schemaVersion,6);const malformedV4=standaloneRecord("malformed-v4","Hard");malformedV4.package.notePalette={hostile:true};await history.put(malformedV4);await assert.rejects(()=>history.get("malformed-v4"),hasCode("storage_record_invalid"),"malformed v4 palette structure must be invalid rather than historical");assert.deepEqual((await history.getForExport("malformed-v4"))?.package.notePalette,{hostile:true},"management export must preserve malformed stored bytes for recovery");const mismatchedV4=standaloneRecord("mismatched-v4","Hard");mismatchedV4.package.notePalette={schema:"aerobeat/authored_note_palette",version:1,left:"#2693FF",right:"#39C96B",colorSpace:"srgb",alpha:1,paletteHash:`sha256:${"a".repeat(64)}`,provenance:{kind:"difficulty_custom_data",infoFormat:"v2",infoHash:`sha256:${"b".repeat(64)}`,difficultyHash:`sha256:${"c".repeat(64)}`,fieldSet:"v2_custom",schemeIndex:null}};await history.put(mismatchedV4);await assert.rejects(()=>history.get("mismatched-v4"),hasCode("storage_record_invalid"),"v4 package palette and null Flow reference mismatch must be invalid rather than stale");

const predecessor=historicalV5Record("song-v5");predecessor.package.charts[0].rulesetId="flow_grid_v2";await history.put(predecessor);assert.equal((await history.list()).some((entry)=>entry.key==="song-v5"),true);assert.equal((await history.getForExport("song-v5"))?.package.schemaVersion,5);await assert.rejects(()=>history.get("song-v5"),hasCode("flow_colliders_reimport_required"),"v5 bytes remain manageable but cannot be silently promoted to Flow Colliders");history.destroy();

const cancelled = createMemoryPersistenceAdapter();
const controller = new AbortController();
controller.abort();
await assert.rejects(() => cancelled.putCollection(batch("cancelled", [record("cancelled", "Hard", hash)], hash, audio), { signal: controller.signal }), hasCode("operation_aborted"));
assert.equal((await cancelled.listCollections()).length, 0);
assert.equal((await cancelled.list()).length, 0);

const quota = createMemoryPersistenceAdapter({ quotaBytes: 8 });
await assert.rejects(() => quota.putCollection(batch("quota", [record("quota", "Hard", secondHash)], secondHash, new Uint8Array(32))), hasCode("quota_exceeded"));
assert.equal((await quota.listCollections()).length, 0);
assert.equal((await quota.list()).length, 0);

let getterCalls = 0;
const hostile = batch("hostile", [record("hostile", "Hard", hash)], hash, audio);
Object.defineProperty(hostile, "collection", { enumerable: true, get() { getterCalls += 1; return {}; } });
await assert.rejects(() => adapter.putCollection(/** @type {never} */ (hostile)), hasCode("storage_record_invalid"));
assert.equal(getterCalls, 0);

assert.equal(authoringDatabaseVersion, 8);
console.log("Memory DB8 collection/shared-asset and v3 palette-history preservation/list/export/delete/reimport validation passed.");

/** @param {string} collectionId @param {ReturnType<typeof record>[]} records @param {string} contentHash @param {Uint8Array} bytes */
function batch(collectionId, records, contentHash, bytes) {
  const difficulties = records.map((item) => {
    const source = /** @type {Record<string, unknown>} */ (item.package.source);
    return { packageKey: item.key, packageId: /** @type {string} */ (item.package.packageId), difficultyId: /** @type {string} */ (source.difficulty), difficultyLabel: /** @type {string} */ (source.difficulty) };
  });
  return {
    collection: {
      collectionId,
      songName: "Song",
      sourceProvider: "synthetic",
      sourceId: "song",
      sourceVersionHash: "version",
      converterProfileId: "profile",
      converterProfileHash: "profile-hash",
      modifierIds: [],
      packageKeys: records.map((item) => item.key),
      packages: difficulties,
      createdAtMs: 1,
      schemaVersion: 3,
      writeToken: "batch"
    },
    packages: records,
    assets: [{ contentHash, bytes }]
  };
}

/** @param {string} key @param {string} difficulty @param {string} contentHash */
function record(key, difficulty, contentHash) {
  return {
    key,
    package: sourceGeometryPackage(key, difficulty),
    packageHash: `sha256:${"a".repeat(64)}`,
    assets: [],
    sourceCache: [],
    createdAtMs: 1,
    schemaVersion: 3,
    writeToken: "batch",
    assetRefs: [{ path: "media/audio/song.ogg", contentHash }]
  };
}

/** @param {string} key @param {string} difficulty */
function sourceGeometryPackage(key,difficulty){return {schemaId:"aerobeat.song-package.v6",schemaVersion:6,packageVersion:"6.0.0",packageId:`package-${key}`,songName:"Song",source:{difficulty,spawnTiming:{schema:"aerobeat/beatsaber_spawn_timing",version:1},obstacleContract:"normalized_obstacle_v2"},notePalette:null,charts:[{schemaId:"aerobeat.chart.flow.v5",schemaVersion:5,mode:"flow",rulesetId:"flow_colliders_v1",rulesetVariants:["flow_colliders_v1"],notePalette:null,beats:[{start:1,end:2,type:"obstacle",sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]}]}]};}
function standaloneRecord(key,difficulty){const value=record(key,difficulty,hash);delete value.assetRefs;value.assets=[{path:"media/audio/song.ogg",bytes:Uint8Array.from(audio)}];return value;}
function historicalV3Record(key){const value=standaloneRecord(key,"Hard");value.package.schemaId="aerobeat.song-package.v3";value.package.schemaVersion=3;value.package.packageVersion="3.0.0";delete value.package.notePalette;value.package.charts[0].schemaId="aerobeat.chart.flow.v3";value.package.charts[0].schemaVersion=3;delete value.package.charts[0].rulesetVariants;delete value.package.charts[0].notePalette;value.schemaVersion=3;return value;}
function historicalV5Record(key){const value=standaloneRecord(key,"Hard");value.package.schemaId="aerobeat.song-package.v5";value.package.schemaVersion=5;value.package.packageVersion="5.0.0";value.package.charts[0].schemaId="aerobeat.chart.flow.v4";value.package.charts[0].schemaVersion=4;delete value.package.charts[0].rulesetVariants;value.schemaVersion=7;return value;}
/** @param {string} key */
function legacyRecord(key) {
  return { key, package: { packageId: `package-${key}`, songName: "Legacy", source: { difficulty: "Hard" } }, packageHash: `sha256:${"b".repeat(64)}`, assets: [{ path: "audio.ogg", bytes: new Uint8Array([9]) }], sourceCache: [], createdAtMs: 1, schemaVersion: 2, writeToken: "legacy" };
}

/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
