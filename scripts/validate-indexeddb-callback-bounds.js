// @ts-check

import assert from "node:assert/strict";
import { IDBObjectStore, IDBTransaction, indexedDB } from "fake-indexeddb";
import { createIndexedDbPersistenceAdapter } from "../src/index.js";

const hash = `sha256:${"3".repeat(64)}`;
const assetBytes = new Uint8Array([3, 1, 4, 1, 5]);
const operations = ["list", "get", "getForExport", "listCollections", "getCollection", "put", "putCollection", "delete", "deleteCollection", "deleteIfToken"];

for (const operation of operations) {
  const name = `callback-valid-${operation}-${Date.now()}-${Math.random()}`;
  await seed(name, "valid");
  const adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name });
  const outcome = await settledOnce(invoke(adapter, operation), 1000);
  assert.equal(outcome.status, "fulfilled", `valid ${operation} must succeed`);
  adapter.destroy();
  await remove(name);
}

const hostileCases = [
  ["package", "list"], ["package", "get"], ["package", "getForExport"], ["package", "listCollections"],
  ["package", "put"], ["package", "putCollection"], ["package", "delete"], ["package", "deleteCollection"], ["package", "deleteIfToken"],
  ["collection", "listCollections"], ["collection", "getCollection"], ["collection", "delete"], ["collection", "deleteCollection"], ["collection", "deleteIfToken"],
  ["asset", "get"], ["asset", "getForExport"]
];
for (const [hostileKind, operation] of hostileCases) {
  const name = `callback-hostile-${hostileKind}-${operation}-${Date.now()}-${Math.random()}`;
  await seed(name, hostileKind);
  const before = await inspect(name);
  const adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name });
  const expectedMessage = hostileKind === "package" ? "Stored package record shape is invalid" : hostileKind === "collection" ? "Stored collection shape is invalid" : "Stored shared asset shape is invalid";
  const outcome = await settledOnce(invoke(adapter, operation, hostileKind === "package" && (operation === "get" || operation === "getForExport") ? "hostile" : "target"), 1000);
  assert.equal(outcome.status, "rejected", `${hostileKind}/${operation} must reject`);
  assert.equal(outcome.error?.name, "AeroAuthoringStorageError");
  assert.equal(outcome.error?.code, "storage_record_invalid");
  assert.equal(outcome.error?.message, expectedMessage);
  const after = await inspect(name);
  assert.deepEqual(after, before, `${hostileKind}/${operation} must atomically roll back without package, collection, or asset loss`);
  adapter.destroy();
  await remove(name);
}

for (const operation of ["delete", "deleteIfToken"]) {
  const name = `callback-hostile-target-${operation}-${Date.now()}-${Math.random()}`;
  await seed(name, "target-package");
  const adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name });
  const outcome = await settledOnce(invoke(adapter, operation, "hostile"), 1000);
  assert.deepEqual(outcome, { status: "fulfilled", value: true }, `${operation} must retain key/token deletion semantics for a hostile target row without decoding it`);
  const after = await inspect(name);
  assert.equal(after.packages.some((row) => row.key === "hostile"), false);
  assert.equal(after.collections.length, 0);
  assert.equal(after.assets.length, 0);
  adapter.destroy();
  await remove(name);
}

await fakeAbortRace("decoder-first");
await fakeAbortRace("cancellation-first");
await fakeAbortRace("pre-aborted");
await fakeAbortRace("post-completion");

console.log(`IndexedDB callback bounding validation passed (${operations.length} valid operations, ${hostileCases.length + 2} hostile operations, decoder/cancellation first-cause races, exact errors, one settlement/effective abort, bounded time, listener cleanup, and atomic rollback).`);

/** @param {"decoder-first"|"cancellation-first"|"pre-aborted"|"post-completion"} mode */
async function fakeAbortRace(mode) {
  const name = `callback-race-${mode}-${Date.now()}-${Math.random()}`;
  await seed(name, mode === "decoder-first" ? "package" : "valid");
  const before = await inspect(name), adapter = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: name }), controller = new AbortController();
  await adapter.migrate();
  const originalAbort = IDBTransaction.prototype.abort, originalGetAll = IDBObjectStore.prototype.getAll;
  let abortCalls = 0, cancellationTriggered = false;
  IDBTransaction.prototype.abort = function () {
    abortCalls += 1;
    const result = originalAbort.call(this);
    if (mode === "decoder-first" && abortCalls === 1) {
      controller.abort();
      controller.signal.dispatchEvent(new Event("abort"));
    }
    return result;
  };
  IDBObjectStore.prototype.getAll = function (...arguments_) {
    const request = originalGetAll.apply(this, arguments_);
    if (mode === "cancellation-first" && !cancellationTriggered && this.name === "packages") {
      cancellationTriggered = true;
      controller.abort();
      controller.signal.dispatchEvent(new Event("abort"));
    }
    return request;
  };
  try {
    if (mode === "pre-aborted") controller.abort();
    const pending = adapter.putCollection(batch("replacement", "replacement-token"), { signal: controller.signal });
    const outcome = await settledOnce(pending, 1000);
    if (mode === "post-completion") {
      assert.equal(outcome.status, "fulfilled");
      const committed = await inspect(name);
      const callsBeforeLateSignal = abortCalls;
      controller.abort(); controller.signal.dispatchEvent(new Event("abort"));
      assert.equal(abortCalls, callsBeforeLateSignal, "completion must remove the abort listener before later signals");
      assert.deepEqual(await inspect(name), committed, "post-completion cancellation must not change committed data");
    } else {
      assert.equal(outcome.status, "rejected");
      assert.equal(outcome.error?.name, "AeroAuthoringStorageError");
      assert.equal(outcome.error?.code, mode === "decoder-first" ? "storage_record_invalid" : "operation_aborted");
      assert.equal(outcome.error?.message, mode === "decoder-first" ? "Stored package record shape is invalid" : "Persistence operation was cancelled");
      assert.equal(abortCalls, mode === "pre-aborted" ? 0 : 1, `${mode} must initiate exactly one effective transaction abort`);
      const callsBeforeLateSignal = abortCalls;
      controller.signal.dispatchEvent(new Event("abort"));
      assert.equal(abortCalls, callsBeforeLateSignal, `${mode} terminal cleanup must remove the abort listener`);
      assert.deepEqual(await inspect(name), before, `${mode} must atomically roll back package, collection, and shared-asset writes`);
    }
  } finally {
    IDBTransaction.prototype.abort = originalAbort;
    IDBObjectStore.prototype.getAll = originalGetAll;
    adapter.destroy(); await remove(name);
  }
}

/** @param {ReturnType<typeof createIndexedDbPersistenceAdapter>} adapter @param {string} operation @param {string} [target] */
function invoke(adapter, operation, target = "target") {
  if (operation === "list") return adapter.list();
  if (operation === "get") return adapter.get(target);
  if (operation === "getForExport") return adapter.getForExport(target);
  if (operation === "listCollections") return adapter.listCollections();
  if (operation === "getCollection") return adapter.getCollection("collection");
  if (operation === "put") return adapter.put(/** @type {never} */ (record("replacement", "replacement-token")));
  if (operation === "putCollection") return adapter.putCollection(batch("replacement", "replacement-token"));
  if (operation === "delete") return adapter.delete(target);
  if (operation === "deleteCollection") return adapter.deleteCollection("collection");
  if (operation === "deleteIfToken") return adapter.deleteIfToken(target, target === "hostile" ? "hostile-token" : "target-token");
  throw new Error(`Unknown operation ${operation}`);
}

/** @param {Promise<unknown>} promise @param {number} timeoutMs */
async function settledOnce(promise, timeoutMs) {
  let settlements = 0;
  promise.then(() => { settlements += 1; }, () => { settlements += 1; });
  const outcome = await Promise.race([
    promise.then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", error })),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`operation exceeded ${timeoutMs} ms`)), timeoutMs))
  ]);
  await Promise.resolve();
  assert.equal(settlements, 1, "public operation must settle exactly once");
  return outcome;
}

/** @param {string} key @param {string} writeToken */
function record(key, writeToken) {
  return { key, package: packageValue(key), packageHash: `sha256:${"a".repeat(64)}`, assets: [], sourceCache: [], createdAtMs: 1, schemaVersion: 8, writeToken, assetRefs: [{ path: "media/audio/song.ogg", contentHash: hash }], flowCellOrientation: "aerobeat_top_left_v1", obstacleContract: "normalized_obstacle_v2" };
}
/** @param {string} key */
function packageValue(key) {
  return { schemaId: "aerobeat.song-package.v6", schemaVersion: 6, packageVersion: "6.0.0", packageId: `package-${key}`, songName: "Song", source: { difficulty: "Hard", spawnTiming: { schema: "aerobeat/beatsaber_spawn_timing", version: 1 }, obstacleContract: "normalized_obstacle_v2" },notePalette:null, charts: [{ schemaId: "aerobeat.chart.flow.v5", schemaVersion: 5, mode: "flow", rulesetId: "flow_colliders_v1", rulesetVariants: ["flow_colliders_v1"],notePalette:null, beats: [{ start: 1, end: 2, type: "obstacle", sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_1", x: 1, y: 2, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 1, y: 0, width: 1, height: 3 }, gridMask: [1, 5, 9] }] }] };
}
/** @param {string} key @param {string} writeToken */
function collection(key, writeToken) {
  return { collectionId: "collection", songName: "Song", sourceProvider: "synthetic", sourceId: "song", sourceVersionHash: "version", converterProfileId: "profile", converterProfileHash: "profile-hash", modifierIds: [], packageKeys: [key], packages: [{ packageKey: key, packageId: `package-${key}`, difficultyId: "Hard", difficultyLabel: "Hard" }], createdAtMs: 1, schemaVersion: 8, writeToken, flowCellOrientation: "aerobeat_top_left_v1", obstacleContract: "normalized_obstacle_v2" };
}
/** @param {string} key @param {string} writeToken */
function batch(key, writeToken) { return { collection: collection(key, writeToken), packages: [record(key, writeToken)], assets: [{ contentHash: hash, bytes: assetBytes }] }; }

/** @param {string} name @param {string} hostileKind */
function seed(name, hostileKind) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 8);
    request.onupgradeneeded = () => {
      const database = request.result;
      const packages = database.createObjectStore("packages", { keyPath: "key" });
      const assets = database.createObjectStore("assets", { keyPath: "contentHash" });
      const collections = database.createObjectStore("collections", { keyPath: "collectionId" });
      database.createObjectStore("meta", { keyPath: "key" });
      const target = record("target", "target-token");
      const targetCollection = collection("target", "target-token");
      const sharedAsset = { contentHash: hash, bytes: assetBytes, byteLength: assetBytes.byteLength };
      if (hostileKind === "package") { packages.put(target); packages.put({ ...record("hostile", "hostile-token"), unknownField: true }); }
      else if (hostileKind === "target-package") packages.put({ ...record("hostile", "hostile-token"), unknownField: true });
      else packages.put(target);
      if (hostileKind === "collection") collections.put({ ...targetCollection, unknownField: true });
      else if (hostileKind !== "target-package") collections.put(targetCollection);
      else collections.put(collection("hostile", "hostile-token"));
      assets.put(hostileKind === "asset" ? { ...sharedAsset, unknownField: true } : sharedAsset);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(undefined); };
  });
}

/** @param {string} name @returns {Promise<{packages:any[],assets:any[],collections:any[]}>} */
function inspect(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(["packages", "assets", "collections"], "readonly");
      const packages = tx.objectStore("packages").getAll(); const assets = tx.objectStore("assets").getAll(); const collections = tx.objectStore("collections").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { resolve({ packages: packages.result, assets: assets.result, collections: collections.result }); database.close(); };
    };
  });
}
/** @param {string} name */
function remove(name) { return new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(undefined); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("database delete blocked")); }); }
