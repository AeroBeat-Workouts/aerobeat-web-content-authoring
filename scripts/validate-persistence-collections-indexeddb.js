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
const historical=historicalV3Record("song-v3");await adapter.put(historical);const historicalExport=await adapter.getForExport("song-v3");assert.deepEqual(historicalExport?.assets[0].bytes,bytes);assert.equal((await adapter.list()).find((entry)=>entry.key==="song-v3")?.packageHash,historical.packageHash);await assert.rejects(()=>adapter.get("song-v3"),hasCode("spawn_timing_reimport_required"));const current=standaloneRecord("song-v6","Hard");await adapter.put(current);assert.equal((await adapter.get("song-v6"))?.package.schemaId,"aerobeat.song-package.v6");assert.deepEqual((await adapter.getForExport("song-v3"))?.assets[0].bytes,historicalExport?.assets[0].bytes);assert.equal(await adapter.delete("song-v3"),true);assert.equal((await adapter.get("song-v6"))?.package.schemaVersion,6);assert.equal(await adapter.delete("song-v6"),true);const malformedV4=standaloneRecord("malformed-v4","Hard");malformedV4.package.notePalette={hostile:true};await adapter.put(malformedV4);await assert.rejects(()=>adapter.get("malformed-v4"),hasCode("storage_record_invalid"),"fake IndexedDB malformed v4 palette must be invalid rather than stale");assert.deepEqual((await adapter.getForExport("malformed-v4"))?.package.notePalette,{hostile:true});assert.equal(await adapter.delete("malformed-v4"),true);

const predecessor=historicalV5Record("song-v5");await adapter.put(predecessor);assert.equal((await adapter.getForExport("song-v5"))?.package.schemaVersion,5);await assert.rejects(()=>adapter.get("song-v5"),hasCode("flow_colliders_reimport_required"),"v5 bytes remain exportable but cannot be silently promoted");assert.equal(await adapter.delete("song-v5"),true);

await assert.rejects(()=>adapter.put(legacyRecord("unknown")),hasCode("storage_record_invalid"),"new IndexedDB writes with an unknown package generation must be rejected rather than labeled stale");
const forged=legacyRecord("forged");forged.package.source.obstacleContract="normalized_obstacle_v2";await assert.rejects(()=>adapter.put(forged),hasCode("storage_record_invalid"),"a hostile current source stamp must not make an unknown IndexedDB generation historical");
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
assert.equal(migratedRaw.packages.length, 2, "DB4→8 migration must retain every legacy package row");
const exactMigrated = migratedRaw.packages.find((row) => row.key === "inverted-flow");
assert.deepEqual(exactMigrated.package, legacyPackage, "DB4→8 migration must not rewrite legacy package bytes/data");
assert.equal(exactMigrated.packageHash, legacyPackageHash, "DB4→8 migration must not rewrite legacy package hash");
assert.ok(migratedRaw.packages.every((row) => row.flowCellOrientation === "aerobeat_top_left_v1"), "v4 migration must mark every legacy package stale internally");
assert.equal(migratedRaw.collections[0].flowCellOrientation, "aerobeat_top_left_v1", "DB4→8 migration must retain corrected orientation truth");
assert.ok(migratedRaw.packages.every((row) => row.obstacleContract === "prior_obstacle_contract"), "DB8 migration must label legacy package obstacle contracts without rewriting package bytes/hashes");
assert.equal(migratedRaw.collections[0].obstacleContract, "prior_obstacle_contract", "DB8 migration must label the legacy collection obstacle contract");
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
assert.equal((await migrated.get("inverted-flow"))?.package.schemaId, "aerobeat.song-package.v6", "current package put with the stable package key must replace stale state");
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
assert.equal((await migrated.estimate()).schemaVersion, 8);
migrated.destroy();
await deleteDatabase(staleName);

const v5Name=`collections-v5-raw-0039-${Date.now()}-${Math.random()}`;
const historicalPackage={...legacyRecord("historical"),assets:[{path:"cover.bin",bytes:new Uint8Array([8,6,7])}],sourceCache:[{path:"Info.dat",bytes:new Uint8Array([5,3,0,9])}],assetRefs:[{path:"media/audio/song.ogg",contentHash:hash}],createdAtMs:1700000000123,schemaVersion:5,writeToken:"raw-0.0.39-token",flowCellOrientation:"aerobeat_top_left_v1",flowObstacleContract:"source_geometry_v1"};
const historicalCollection={...batch("historical-collection",[record("historical","Hard",hash)],hash,bytes).collection,packageKeys:["historical"],packages:[{packageKey:"historical",packageId:"package-historical",difficultyId:"Hard",difficultyLabel:"Hard"}],createdAtMs:1700000000456,schemaVersion:5,writeToken:"raw-0.0.39-collection-token",flowCellOrientation:"aerobeat_top_left_v1",flowObstacleContract:"source_geometry_v1"};
await seedDatabase(v5Name,5,[historicalPackage],[{contentHash:hash,bytes,byteLength:bytes.byteLength}],[historicalCollection]);
const v5Adapter=createIndexedDbPersistenceAdapter({indexedDB,databaseName:v5Name});
assert.equal((await v5Adapter.list()).length,1,"true raw-0.0.39 DB5 package must remain listed");
assert.equal((await v5Adapter.listCollections()).length,1,"true raw-0.0.39 DB5 collection must remain listed");
await assert.rejects(()=>v5Adapter.get("historical"),hasCode("flow_obstacle_reimport_required"));
const v5Export=await v5Adapter.getForExport("historical");
assert.deepEqual(v5Export?.assets.map((entry)=>[entry.path,[...entry.bytes]]),[["cover.bin",[8,6,7]],["media/audio/song.ogg",[...bytes]]]);
assert.deepEqual(v5Export?.sourceCache[0].bytes,new Uint8Array([5,3,0,9]));
const v5Raw=await inspectDatabase(v5Name);
assert.equal(v5Raw.version,8);assert.equal(v5Raw.packages[0].flowObstacleContract,undefined);assert.equal(v5Raw.packages[0].obstacleContract,"prior_obstacle_contract");
assert.equal(v5Raw.collections[0].flowObstacleContract,undefined);assert.equal(v5Raw.collections[0].obstacleContract,"prior_obstacle_contract");
for(const key of ["key","packageHash","createdAtMs","writeToken","flowCellOrientation"])assert.deepEqual(v5Raw.packages[0][key],historicalPackage[key],`DB5 package ${key} must be preserved exactly`);
assert.deepEqual(v5Raw.packages[0].package,historicalPackage.package);assert.deepEqual(v5Raw.packages[0].assets,historicalPackage.assets);assert.deepEqual(v5Raw.packages[0].sourceCache,historicalPackage.sourceCache);assert.deepEqual(v5Raw.packages[0].assetRefs,historicalPackage.assetRefs);assert.deepEqual(v5Raw.assets[0].bytes,bytes);
assert.equal(await v5Adapter.deleteCollection("historical-collection"),true);assert.equal((await v5Adapter.list()).length,0);v5Adapter.destroy();await deleteDatabase(v5Name);

const v6Name=`collections-v6-poisoned-${Date.now()}-${Math.random()}`;
const poisonedPackage={...historicalPackage,key:"poisoned",package:{...historicalPackage.package,packageId:"package-poisoned"},schemaVersion:6,obstacleContract:"prior_obstacle_contract"};
const poisonedCollection={...historicalCollection,collectionId:"poisoned-collection",packageKeys:["poisoned"],packages:[{packageKey:"poisoned",packageId:"package-poisoned",difficultyId:"Hard",difficultyLabel:"Hard"}],schemaVersion:6,obstacleContract:"prior_obstacle_contract"};
const cleanPackage={...record("clean","Easy",hash),schemaVersion:6,flowCellOrientation:"aerobeat_top_left_v1",obstacleContract:"normalized_obstacle_v2"};
await seedDatabase(v6Name,6,[poisonedPackage,cleanPackage],[{contentHash:hash,bytes,byteLength:bytes.byteLength}],[poisonedCollection]);
const v6Adapter=createIndexedDbPersistenceAdapter({indexedDB,databaseName:v6Name});
assert.equal((await v6Adapter.list()).length,2);assert.equal((await v6Adapter.listCollections()).length,2,"poisoned collection plus package-only clean row must remain manageable");
await assert.rejects(()=>v6Adapter.get("poisoned"),hasCode("flow_obstacle_reimport_required"));assert.equal((await v6Adapter.get("clean"))?.obstacleContract,"normalized_obstacle_v2");
const v6Raw=await inspectDatabase(v6Name);const repaired=v6Raw.packages.find((row)=>row.key==="poisoned"),clean=v6Raw.packages.find((row)=>row.key==="clean");
assert.equal(repaired.flowObstacleContract,undefined);assert.equal(repaired.obstacleContract,"prior_obstacle_contract");assert.equal(clean.flowObstacleContract,undefined);assert.equal(clean.obstacleContract,"normalized_obstacle_v2");assert.deepEqual(v6Raw.assets[0].bytes,bytes);
await v6Adapter.put({...record("poisoned","Hard",hash),assets:[{path:"audio.ogg",bytes:new Uint8Array([4,4])}],assetRefs:[]});
assert.equal((await v6Adapter.get("poisoned"))?.obstacleContract,"normalized_obstacle_v2","stable-key reimport must replace repaired stale package");
assert.equal(await v6Adapter.delete("poisoned"),true);assert.equal(await v6Adapter.delete("clean"),true);v6Adapter.destroy();await deleteDatabase(v6Name);

const hostileName=`collections-v6-hostile-${Date.now()}-${Math.random()}`;
const validBefore={...cleanPackage,key:"valid-before",package:{...cleanPackage.package,packageId:"package-valid-before"}};
const hostile={...poisonedPackage,key:"hostile",package:{...poisonedPackage.package,packageId:"package-hostile"},unknownHostileField:true};
await seedDatabase(hostileName,6,[validBefore,hostile],[{contentHash:hash,bytes,byteLength:bytes.byteLength}],[]);
const hostileAdapter=createIndexedDbPersistenceAdapter({indexedDB,databaseName:hostileName});
await assert.rejects(()=>hostileAdapter.list(),hasCode("storage_migration_invalid"),"unknown DB6 shape must fail with one bounded migration error");hostileAdapter.destroy();
const hostileRaw=await inspectDatabase(hostileName);assert.equal(hostileRaw.version,6,"hostile migration must abort the complete versionchange transaction");assert.equal(hostileRaw.packages.find((row)=>row.key==="valid-before").schemaVersion,6);assert.equal(hostileRaw.packages.find((row)=>row.key==="hostile").unknownHostileField,true);await deleteDatabase(hostileName);

console.log("Fake IndexedDB DB8 collection/shared-asset, non-destructive DB4/DB5/DB6 migration, and v3 palette-history preservation/list/export/delete/reimport validation passed.");

/** @param {string} collectionId @param {ReturnType<typeof record>[]} records @param {string} contentHash @param {Uint8Array} assetBytes */
function batch(collectionId, records, contentHash, assetBytes) { return { collection: { collectionId, songName: "Song", sourceProvider: "synthetic", sourceId: "song", sourceVersionHash: "version", converterProfileId: "profile", converterProfileHash: "profile-hash", modifierIds: [], packageKeys: records.map((item) => item.key), packages: records.map((item) => ({ packageKey: item.key, packageId: /** @type {string} */ (item.package.packageId), difficultyId: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty), difficultyLabel: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty) })), createdAtMs: 1, schemaVersion: 3, writeToken: "batch" }, packages: records, assets: [{ contentHash, bytes: assetBytes }] }; }
/** @param {string} key @param {string} difficulty @param {string} contentHash */
function record(key, difficulty, contentHash) { return { key, package: sourceGeometryPackage(key,difficulty), packageHash: `sha256:${"a".repeat(64)}`, assets: [], sourceCache: [], createdAtMs: 1, schemaVersion: 3, writeToken: "batch", assetRefs: [{ path: "media/audio/song.ogg", contentHash }] }; }
/** @param {string} key @param {string} difficulty */
function sourceGeometryPackage(key,difficulty){return {schemaId:"aerobeat.song-package.v6",schemaVersion:6,packageVersion:"6.0.0",packageId:`package-${key}`,songName:"Song",source:{difficulty,spawnTiming:{schema:"aerobeat/beatsaber_spawn_timing",version:1},obstacleContract:"normalized_obstacle_v2"},notePalette:null,charts:[{schemaId:"aerobeat.chart.flow.v5",schemaVersion:5,mode:"flow",rulesetId:"flow_grid_v2",rulesetVariants:["flow_grid_v2","flow_colliders_v1"],notePalette:null,beats:[{start:1,end:2,type:"obstacle",sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]}]}]};}
function standaloneRecord(key,difficulty){const value=record(key,difficulty,hash);delete value.assetRefs;value.assets=[{path:"media/audio/song.ogg",bytes:Uint8Array.from(bytes)}];return value;}
function historicalV3Record(key){const value=standaloneRecord(key,"Hard");value.package.schemaId="aerobeat.song-package.v3";value.package.schemaVersion=3;value.package.packageVersion="3.0.0";delete value.package.notePalette;value.package.charts[0].schemaId="aerobeat.chart.flow.v3";value.package.charts[0].schemaVersion=3;delete value.package.charts[0].rulesetVariants;delete value.package.charts[0].notePalette;value.schemaVersion=3;return value;}
function historicalV5Record(key){const value=standaloneRecord(key,"Hard");value.package.schemaId="aerobeat.song-package.v5";value.package.schemaVersion=5;value.package.packageVersion="5.0.0";value.package.charts[0].schemaId="aerobeat.chart.flow.v4";value.package.charts[0].schemaVersion=4;delete value.package.charts[0].rulesetVariants;value.schemaVersion=7;return value;}
/** @param {string} key */
function legacyRecord(key) { return { key, package: { packageId: `package-${key}`, songName: "Legacy", source: { difficulty: "Hard" } }, packageHash: `sha256:${"b".repeat(64)}`, assets: [{ path: "audio.ogg", bytes: new Uint8Array([9]) }], sourceCache: [], createdAtMs: 1, schemaVersion: 2, writeToken: "legacy" }; }
/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
/** @param {string} databaseName @param {Record<string, unknown>} packageValue @param {string} packageHash */
function createVersionFourStaleDatabase(databaseName, packageValue, packageHash) { return new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 4); request.onupgradeneeded = () => { const database = request.result; const packages = database.createObjectStore("packages", { keyPath: "key" }); const assets = database.createObjectStore("assets", { keyPath: "contentHash" }); const collections = database.createObjectStore("collections", { keyPath: "collectionId" }); database.createObjectStore("meta", { keyPath: "key" }); packages.put({ ...record("inverted-flow", "Easy", hash), flowCellOrientation: "aerobeat_top_left_v1", package: packageValue, packageHash, assets: [{ path: "cover.bin", bytes: new Uint8Array([7, 7]) }], sourceCache: [{ path: "info.dat", bytes: new Uint8Array([6, 2, 6]) }] }); packages.put({ ...legacyRecord("stale-delete"), flowCellOrientation: "aerobeat_top_left_v1" }); assets.put({ contentHash: hash, bytes, byteLength: bytes.byteLength }); collections.put({ ...batch("inverted-collection", [record("inverted-flow", "Easy", hash)], hash, bytes).collection, flowCellOrientation: "aerobeat_top_left_v1" }); }; request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(undefined); }; }); }
/** @param {string} databaseName */
function inspectVersionFourDatabase(databaseName) { return inspectDatabase(databaseName).then(({packages,assets,collections})=>({packages,assets,collections})); }
/** @param {string} databaseName @param {number} version @param {Record<string,unknown>[]} packages @param {Record<string,unknown>[]} assets @param {Record<string,unknown>[]} collections */
function seedDatabase(databaseName,version,packages,assets,collections){return new Promise((resolve,reject)=>{const request=indexedDB.open(databaseName,version);request.onupgradeneeded=()=>{const database=request.result;const packageStore=database.createObjectStore("packages",{keyPath:"key"}),assetStore=database.createObjectStore("assets",{keyPath:"contentHash"}),collectionStore=database.createObjectStore("collections",{keyPath:"collectionId"});database.createObjectStore("meta",{keyPath:"key"});for(const row of packages)packageStore.put(row);for(const row of assets)assetStore.put(row);for(const row of collections)collectionStore.put(row);};request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve(undefined);};});}
/** @param {string} databaseName @returns {Promise<{version:number,packages:any[],assets:any[],collections:any[]}>} */
function inspectDatabase(databaseName){return new Promise((resolve,reject)=>{const request=indexedDB.open(databaseName);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const database=request.result,transaction=database.transaction(["packages","assets","collections"],"readonly"),packageRequest=transaction.objectStore("packages").getAll(),assetRequest=transaction.objectStore("assets").getAll(),collectionRequest=transaction.objectStore("collections").getAll();transaction.onerror=()=>reject(transaction.error);transaction.oncomplete=()=>{resolve({version:database.version,packages:packageRequest.result,assets:assetRequest.result,collections:collectionRequest.result});database.close();};};});}
/** @param {string} databaseName */
function deleteDatabase(databaseName) { return new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(undefined); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("database delete blocked")); }); }
