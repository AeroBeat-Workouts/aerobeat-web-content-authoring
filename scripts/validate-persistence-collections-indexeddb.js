// @ts-check

import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { createIndexedDbPersistenceAdapter } from "../src/index.js";

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

const staleName = `collections-v3-stale-${Date.now()}-${Math.random()}`;
await createVersionThreeStaleDatabase(staleName);
const migrated = createIndexedDbPersistenceAdapter({ indexedDB, databaseName: staleName });
assert.equal((await migrated.list()).length, 0, "v4 migration must invalidate packages authored with the inverted Flow converter");
assert.equal((await migrated.listCollections()).length, 0, "v4 migration must invalidate stale downloaded collections");
assert.equal((await migrated.estimate()).schemaVersion, 4);
migrated.destroy();
await deleteDatabase(staleName);
console.log("IndexedDB collection persistence and v3 stale Flow package invalidation validation passed.");

/** @param {string} collectionId @param {ReturnType<typeof record>[]} records @param {string} contentHash @param {Uint8Array} assetBytes */
function batch(collectionId, records, contentHash, assetBytes) { return { collection: { collectionId, songName: "Song", sourceProvider: "synthetic", sourceId: "song", sourceVersionHash: "version", converterProfileId: "profile", converterProfileHash: "profile-hash", modifierIds: [], packageKeys: records.map((item) => item.key), packages: records.map((item) => ({ packageKey: item.key, packageId: /** @type {string} */ (item.package.packageId), difficultyId: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty), difficultyLabel: /** @type {string} */ (/** @type {Record<string,unknown>} */ (item.package.source).difficulty) })), createdAtMs: 1, schemaVersion: 3, writeToken: "batch" }, packages: records, assets: [{ contentHash, bytes: assetBytes }] }; }
/** @param {string} key @param {string} difficulty @param {string} contentHash */
function record(key, difficulty, contentHash) { return { key, package: { packageId: `package-${key}`, songName: "Song", source: { difficulty } }, packageHash: `sha256:${"a".repeat(64)}`, assets: [], sourceCache: [], createdAtMs: 1, schemaVersion: 3, writeToken: "batch", assetRefs: [{ path: "media/audio/song.ogg", contentHash }] }; }
/** @param {string} key */
function legacyRecord(key) { return { key, package: { packageId: `package-${key}`, songName: "Legacy", source: { difficulty: "Hard" } }, packageHash: `sha256:${"b".repeat(64)}`, assets: [{ path: "audio.ogg", bytes: new Uint8Array([9]) }], sourceCache: [], createdAtMs: 1, schemaVersion: 2, writeToken: "legacy" }; }
/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
/** @param {string} databaseName */
function createVersionThreeStaleDatabase(databaseName) { return new Promise((resolve, reject) => { const request = indexedDB.open(databaseName, 3); request.onupgradeneeded = () => { const database = request.result; const packages = database.createObjectStore("packages", { keyPath: "key" }); const assets = database.createObjectStore("assets", { keyPath: "contentHash" }); const collections = database.createObjectStore("collections", { keyPath: "collectionId" }); database.createObjectStore("meta", { keyPath: "key" }); packages.put(legacyRecord("inverted-flow")); assets.put({ contentHash: hash, bytes, byteLength: bytes.byteLength }); collections.put(batch("inverted-collection", [record("inverted-flow", "Easy", hash)], hash, bytes).collection); }; request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(undefined); }; }); }
/** @param {string} databaseName */
function deleteDatabase(databaseName) { return new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(databaseName); request.onsuccess = () => resolve(undefined); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("database delete blocked")); }); }
