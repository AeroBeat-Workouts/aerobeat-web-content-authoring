// @ts-check

import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { canonicalJson, createAeroWebContentAuthoringService, createIndexedDbPersistenceAdapter, prefixedSha256 } from "../src/index.js";

const name = `collections-v3-${Date.now()}-${Math.random()}`;
const hash = `sha256:${"3".repeat(64)}`;
const bytes = new Uint8Array([3, 1, 4, 1, 5]);
let adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name });
await adapter.putCollection(batch("one", [record("easy", "Easy", hash), record("expert", "Expert", hash)], hash, bytes));
assert.equal((await adapter.listCollections()).length, 1);
assert.deepEqual((await adapter.get("expert"))?.assets[0].bytes, bytes);
adapter.destroy();

adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name });
assert.deepEqual((await adapter.get("easy"))?.assets[0].bytes, bytes, "shared assets must resolve after reopen");
assert.equal((await adapter.getCollection("one"))?.packageKeys.length, 2);
await adapter.putCollection(batch("two", [record("hard", "Hard", hash)], hash, bytes));
assert.equal(await adapter.deleteCollection("one"), true);
assert.deepEqual((await adapter.get("hard"))?.assets[0].bytes, bytes, "shared asset must survive first collection delete");
assert.equal(await adapter.deleteCollection("two"), true);
assert.equal(await adapter.get("hard"), null);

await adapter.put(legacyRecord("old"));
await assert.rejects(()=>adapter.get("old"),hasCode("flow_obstacle_reimport_required"),"legacy public IndexedDB put must remain management-only");
assert.equal((await adapter.getForExport("old"))?.obstacleContract,"prior_obstacle_contract");
const forged=legacyRecord("forged");forged.package.source.obstacleContract="normalized_obstacle_v2";await adapter.put(forged);await assert.rejects(()=>adapter.get("forged"),hasCode("flow_obstacle_reimport_required"),"a source stamp without a Flow v2 geometry chart must not upgrade IndexedDB content");assert.equal(await adapter.delete("forged"),true);
const legacy = await adapter.listCollections();
assert.equal(legacy.length, 1);
assert.equal(legacy[0].collectionId, "legacy:old");
assert.equal(await adapter.deleteCollection("legacy:old"), true);
assert.equal((await adapter.list()).length, 0);

const controller = new AbortController();
controller.abort();
await assert.rejects(() => adapter.putCollection(batch("cancelled", [record("cancelled", "Hard", hash)], hash, bytes), { signal: controller.signal }), hasCode("operation_aborted"));
assert.equal((await adapter.listCollections()).length, 0);
assert.equal((await adapter.list()).length, 0);

const invalid = batch("invalid", [record("invalid", "Hard", hash)], hash, bytes);
invalid.packages[0].assetRefs[0].contentHash = `sha256:${"4".repeat(64)}`;
await assert.rejects(() => adapter.putCollection(invalid), hasCode("storage_record_invalid"));
assert.equal((await adapter.listCollections()).length, 0);
assert.equal((await adapter.list()).length, 0);
adapter.destroy();
await deleteDatabase(name);

const staleName = `collections-v4-stale-${Date.now()}-${Math.random()}`;
const legacyPackage = { packageId: "package-inverted-flow", songName: "Legacy ZIP Song", source: { difficulty: "Easy" }, legacyPayload: "retained" };
const legacyPackageHash = await prefixedSha256(canonicalJson(legacyPackage));
await createVersionFourStaleDatabase(staleName, legacyPackage, legacyPackageHash);
const migrated = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: staleName });
const stalePackages = await migrated.list();
assert.equal(stalePackages.length, 2, "v4 migration must retain legacy package records");
const migratedRaw = await inspectVersionFourDatabase(staleName);
assert.equal(migratedRaw.packages.length, 2, "DB4→6 migration must retain every legacy package row");
const exactMigrated = migratedRaw.packages.find((row) => row.key === "inverted-flow");
assert.deepEqual(exactMigrated.package, legacyPackage, "DB4→6 migration must not rewrite legacy package bytes/data");
assert.equal(exactMigrated.packageHash, legacyPackageHash, "DB4→6 migration must not rewrite legacy package hash");
assert.ok(migratedRaw.packages.every((row) => row.flowCellOrientation === "aerobeat_top_left_v1"), "v4 migration must mark every legacy package stale internally");
assert.equal(migratedRaw.collections[0].flowCellOrientation, "aerobeat_top_left_v1", "DB4→6 migration must retain corrected orientation truth");
assert.ok(migratedRaw.packages.every((row) => row.obstacleContract === "prior_obstacle_contract"), "DB6 migration must label legacy package obstacle contracts without rewriting package bytes/hashes");
assert.equal(migratedRaw.collections[0].obstacleContract, "prior_obstacle_contract", "DB6 migration must label the legacy collection obstacle contract");
assert.equal(migratedRaw.assets.length, 1, "v4 migration must retain shared asset rows");
assert.deepEqual(migratedRaw.assets[0].bytes, bytes, "v4 migration must retain shared asset bytes exactly");
assert.deepEqual(Object.keys(stalePackages[0]), ["key", "packageId", "packageHash", "songName", "difficulty", "createdAtMs", "assetCount", "sourceCacheCount"], "public package summary keys must remain exact");
const staleCollections = await migrated.listCollections();
assert.equal(staleCollections.length, 2, "v4 migration must retain the authored collection and ungrouped management entry");
assert.deepEqual(Object.keys(staleCollections.find((item) => item.collectionId === "inverted-collection") ?? {}), ["collectionId", "songName", "createdAtMs", "packages"], "public collection summary keys must remain exact");
await assert.rejects(() => migrated.get("inverted-flow"), hasCode("flow_obstacle_reimport_required"));
const retained = await migrated.getForExport("inverted-flow");
assert.deepEqual(retained?.sourceCache[0].bytes, new Uint8Array([6, 2, 6]), "local-ZIP source cache bytes must survive migration");
assert.deepEqual(retained?.assets.map((asset) => [...asset.bytes]), [[7, 7], [...bytes]], "inline and shared downloaded assets must survive migration");
assert.equal((await migrated.getCollection("inverted-collection"))?.packageKeys[0], "inverted-flow", "legacy collection membership must remain manageable");
const service = createAeroWebContentAuthoringService({ persistence: migrated });
const legacyExport = await service.exportPackage("inverted-flow");
assert.ok(legacyExport.byteLength > 0, "stale package export must remain available for recovery");
await assert.rejects(() => service.loadPackage("inverted-flow"), hasCode("flow_obstacle_reimport_required"));
await assert.rejects(() => service.readAsset("inverted-flow", "media/audio/song.ogg"), hasCode("flow_obstacle_reimport_required"), "stale media/play reads must fail with the authoritative orientation error");
service.destroy();
assert.equal(await migrated.delete("stale-delete"), true, "stale ungrouped records must remain deletable");

const correctedPackage=sourceGeometryPackage("inverted-flow","Easy");
await migrated.put({ ...legacyRecord("inverted-flow"), package: correctedPackage, packageHash: legacyPackageHash });
assert.equal((await migrated.get("inverted-flow"))?.package.schemaId, "aerobeat.song-package.v3", "proven Flow v2 put with the stable package key must replace stale state");
const replacementHash = `sha256:${"4".repeat(64)}`;
const replacementBytes = new Uint8Array([4, 2]);
await migrated.putCollection(batch("inverted-collection", [record("inverted-flow", "Easy", replacementHash)], replacementHash, replacementBytes));
assert.deepEqual((await migrated.get("inverted-flow"))?.assets[0].bytes, replacementBytes, "corrected putCollection with stable keys must load successfully");
assert.equal((await migrated.getCollection("inverted-collection"))?.flowCellOrientation, "aerobeat_top_left_v1", "replacement collection must be marked current internally");
const raw = await inspectVersionFourDatabase(staleName);
assert.equal(raw.packages.length, 1);
assert.equal(raw.packages[0].flowCellOrientation, "aerobeat_top_left_v1");
assert.equal(raw.collections[0].flowCellOrientation, "aerobeat_top_left_v1");
assert.equal(raw.packages[0].obstacleContract, "normalized_obstacle_v2");
assert.equal(raw.collections[0].obstacleContract, "normalized_obstacle_v2");
assert.equal(raw.assets.length, 1, "replacement GC must retain only the currently referenced asset");
assert.deepEqual(raw.assets[0].bytes, replacementBytes);
assert.equal(await migrated.deleteCollection("inverted-collection"), true);
assert.equal((await inspectVersionFourDatabase(staleName)).assets.length, 0, "final deletion must safely collect replacement assets");
assert.equal((await migrated.estimate()).schemaVersion, 6);
migrated.destroy();
await deleteDatabase(staleName);
console.log("IndexedDB collection persistence and non-destructive DB4→6 Flow obstacle-contract migration validation passed.");

/** @param {string} collectionId @param {ReturnType<typeof record>[]} records @param {string} contentHash @param {Uint8Array} assetBytes */
function batch(collectionId, records, contentHash, assetBytes) { return { collection: { collectionId, songName: "Song", sourceProvider: "synthetic", sourceId: "song", sourceVersionHash: "version", converterProfileId: "profile", converterProfileHash: "profile-hash", modifierIds: [], packageKeys: records.map((item) => item.key), packages: records.map((item) => ({ packageKey: item.key, packageId: /** @type {string} */ (item.package.packageId), difficultyId: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty), difficultyLabel: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty) })), createdAtMs: 1, schemaVersion: 3, writeToken: "batch" }, packages: records, assets: [{ contentHash, bytes: assetBytes }] }; }
/** @param {string} key @param {string} difficulty @param {string} contentHash */
function record(key, difficulty, contentHash) { return { key, package: sourceGeometryPackage(key,difficulty), packageHash: `sha256:${"a".repeat(64)}`, assets: [], sourceCache: [], createdAtMs: 1, schemaVersion: 3, writeToken: "batch", assetRefs: [{ path: "media/audio/song.ogg", contentHash }] }; }
/** @param {string} key @param {string} difficulty */
function sourceGeometryPackage(key,difficulty){return {schemaId:"aerobeat.song-package.v3",schemaVersion:3,packageVersion:"3.0.0",packageId:`package-${key}`,songName:"Song",source:{difficulty,obstacleContract:"normalized_obstacle_v2"},charts:[{schemaId:"aerobeat.chart.flow.v3",schemaVersion:3,mode:"flow",rulesetId:"flow_grid_v2",beats:[{start:1,end:2,type:"obstacle",sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]}]}]};}
/** @param {string} key */
function legacyRecord(key) { return { key, package: { packageId: `package-${key}`, songName: "Legacy", source: { difficulty: "Hard" } }, packageHash: `sha256:${"b".repeat(64)}`, assets: [{ path: "audio.ogg", bytes: new Uint8Array([9]) }], sourceCache: [], createdAtMs: 1, schemaVersion: 2, writeToken: "legacy" }; }
/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
/** @param {string} databaseName @param {Record<string, unknown>} packageValue @param {string} packageHash */
function createVersionFourStaleDatabase(databaseName, packageValue, packageHash) { return new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 4); request.onupgradeneeded = () => { const database = request.result; const packages = database.createObjectStore("packages", { keyPath: "key" }); const assets = database.createObjectStore("assets", { keyPath: "contentHash" }); const collections = database.createObjectStore("collections", { keyPath: "collectionId" }); database.createObjectStore("meta", { keyPath: "key" }); packages.put({ ...record("inverted-flow", "Easy", hash), flowCellOrientation: "aerobeat_top_left_v1", package: packageValue, packageHash, assets: [{ path: "cover.bin", bytes: new Uint8Array([7, 7]) }], sourceCache: [{ path: "info.dat", bytes: new Uint8Array([6, 2, 6]) }] }); packages.put({ ...legacyRecord("stale-delete"), flowCellOrientation: "aerobeat_top_left_v1" }); assets.put({ contentHash: hash, bytes, byteLength: bytes.byteLength }); collections.put({ ...batch("inverted-collection", [record("inverted-flow", "Easy", hash)], hash, bytes).collection, flowCellOrientation: "aerobeat_top_left_v1" }); }; request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(undefined); }; }); }
/** @param {string} databaseName */
function inspectVersionFourDatabase(databaseName) { return new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 6); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result; const transaction = database.transaction(["packages", "assets", "collections"], "readonly"); const packageRequest = transaction.objectStore("packages").getAll(); const assetRequest = transaction.objectStore("assets").getAll(); const collectionRequest = transaction.objectStore("collections").getAll(); transaction.onerror = () => reject(transaction.error); transaction.oncomplete = () => { const result = { packages: packageRequest.result, assets: assetRequest.result, collections: collectionRequest.result }; database.close(); resolve(result); }; }; }); }
/** @param {string} databaseName */
function deleteDatabase(databaseName) { return new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(undefined); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("database delete blocked")); }); }
