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
assert.equal((await adapter.get("easy"))?.flowObstacleContract, "source_geometry_v1", "proven Flow v2 geometry writes must be marked current internally");
assert.deepEqual((await adapter.get("expert"))?.assets[0].bytes, audio);

await adapter.putCollection(batch("collection-b", [record("hard", "Hard", hash)], hash, audio));
assert.equal(await adapter.deleteCollection("collection-a"), true);
assert.deepEqual((await adapter.get("hard"))?.assets[0].bytes, audio, "shared audio must survive while referenced");
assert.equal(await adapter.deleteCollection("collection-b"), true);
assert.equal(await adapter.get("hard"), null);

const legacy = createMemoryPersistenceAdapter();
await legacy.put(legacyRecord("old"));
const legacyList = await legacy.listCollections();
assert.equal(legacyList.length, 1);
assert.equal(legacyList[0].collectionId, "legacy:old");
assert.equal((await legacy.getCollection("legacy:old"))?.packageKeys[0], "old");
await assert.rejects(()=>legacy.get("old"),hasCode("flow_obstacle_reimport_required"),"legacy public put must remain management-only");
const forged=legacyRecord("forged");forged.package.source.flowObstacleContract="source_geometry_v1";await legacy.put(forged);await assert.rejects(()=>legacy.get("forged"),hasCode("flow_obstacle_reimport_required"),"a source stamp without a Flow v2 geometry chart must not upgrade legacy content");
assert.equal((await legacy.getForExport("forged"))?.flowObstacleContract,"bounded_mask_v1");
assert.equal(await legacy.delete("forged"),true);
const malformed={...legacyRecord("malformed"),package:sourceGeometryPackage("malformed","Hard")};malformed.package.charts[0].beats[0].gridMask=[1,5,9];await legacy.put(malformed);await assert.rejects(()=>legacy.get("malformed"),hasCode("flow_obstacle_reimport_required"),"invalid geometry/mask truth must not receive current provenance");assert.equal((await legacy.getForExport("malformed"))?.flowObstacleContract,"bounded_mask_v1");assert.equal(await legacy.delete("malformed"),true);
assert.equal(await legacy.deleteCollection("legacy:old"), true);
assert.equal((await legacy.list()).length, 0);

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

assert.equal(authoringDatabaseVersion, 5);
console.log("Memory collection persistence validation passed.");

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
function sourceGeometryPackage(key,difficulty){return {schemaId:"aerobeat.song-package.v2",schemaVersion:2,packageVersion:"2.0.0",packageId:`package-${key}`,songName:"Song",source:{difficulty,flowObstacleContract:"source_geometry_v1"},charts:[{schemaId:"aerobeat.chart.flow.v2",schemaVersion:2,mode:"flow",rulesetId:"flow_grid_v2",beats:[{start:1,end:2,type:"obstacle",geometry:{schema:"aerobeat/flow_obstacle_geometry",version:1,coordinateSpace:"beatsaber_lane_layer",x:1,y:2,width:1,height:3},gridMask:[1]}]}]};}
/** @param {string} key */
function legacyRecord(key) {
  return { key, package: { packageId: `package-${key}`, songName: "Legacy", source: { difficulty: "Hard" } }, packageHash: `sha256:${"b".repeat(64)}`, assets: [{ path: "audio.ogg", bytes: new Uint8Array([9]) }], sourceCache: [], createdAtMs: 1, schemaVersion: 2, writeToken: "legacy" };
}

/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
