// @ts-check

import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { readFile } from "node:fs/promises";
import { computeBeatSaverMapHash, inspectBeatSaverArchive } from "@aerobeat/web-vendor-beatsaver";
import { createAeroWebContentAuthoringService, createIndexedDbPersistenceAdapter, createMemoryPersistenceAdapter } from "../src/index.js";

const versionHash = "f5c04797fe0831741adec66ce5386971153919d4";
const fixture = "/tmp/aerobeat-54510-f5c04797fe0831741adec66ce5386971153919d4.zip";
let source;
try { source = await inspectBeatSaverArchive(new Uint8Array(await readFile(fixture))); }
catch (error) { throw new Error(`missing-local-fixture: ${fixture}`, { cause: error }); }
assert.equal(await computeBeatSaverMapHash(source), versionHash, "real BeatSaver source must match pinned map hash");
const acquired = { providerId: "beatsaver", sourceHash: versionHash, source };
const identity = { sourceProvider: "beatsaver", sourceId: "54510", sourceVersionHash: versionHash };

for (const kind of ["memory", "indexeddb"]) {
  const databaseName = `reimport-source-${Date.now()}-${Math.random()}`;
  const persistence = kind === "memory"
    ? createMemoryPersistenceAdapter({ quotaBytes: 512 * 1024 * 1024 })
    : createIndexedDbPersistenceAdapter({ indexedDB, databaseName });
  const service = createAeroWebContentAuthoringService({ persistence });
  try {
    const result = await service.convertAllStandardAndPersist(acquired, identity);
    const id = result.collection.collectionId;
    const expected = { collectionId: id, ...identity };
    assert.ok(result.packages.length >= 2, "real BeatSaver import must persist multiple Standard difficulties");
    assert.deepEqual(Object.keys(result.collection), ["collectionId", "songName", "createdAtMs", "packages"]);
    const summaries = await service.listCollections();
    assert.deepEqual(summaries, [result.collection], "collection listing must retain its public summary");
    assert.deepEqual(await service.getCollection(id), result.collection, "individual public lookup must remain a summary");
    const provenance = await service.getCollectionReimportSource(id);
    assert.deepEqual(provenance, expected, "private source accessor must copy exactly four stored fields");
    assert.deepEqual(Object.keys(/** @type {object} */ (provenance)), ["collectionId", "sourceProvider", "sourceId", "sourceVersionHash"]);
    assert.ok(Object.isFrozen(provenance));
    assert.notEqual(provenance, await persistence.getCollection(id), "accessor must not expose the persistence record");
    assert.equal(await service.getCollectionReimportSource("missing"), null);
    for (const invalid of ["", 42, "x".repeat(1025)]) {
      await assert.rejects(() => service.getCollectionReimportSource(/** @type {never} */ (invalid)), hasCode("collection_invalid"));
    }
    assert.equal(await service.deleteCollection(id), true);
    assert.equal(await service.getCollectionReimportSource(id), null);

    // A package-only record appears as a legacy collection and is not a BeatSaver reimport target.
    const standalone = await service.convertAndPersist(acquired, { difficulty: "Expert", ...identity });
    const legacyId = `legacy:${standalone.handle.key}`;
    assert.ok((await service.listCollections()).some((row) => row.collectionId === legacyId));
    assert.deepEqual(await service.getCollectionReimportSource(legacyId), {
      collectionId: legacyId, sourceProvider: "legacy", sourceId: standalone.handle.key, sourceVersionHash: "legacy"
    });
    assert.equal(await service.deletePackage(standalone.handle), true);

    // A local collection returns its stored local provenance, without inventing a BeatSaver ID.
    const local = await service.convertAllStandardAndPersist(acquired, { ...identity, sourceProvider: "local", sourceId: "local-only" });
    assert.deepEqual(await service.getCollectionReimportSource(local.collection.collectionId), {
      collectionId: local.collection.collectionId, sourceProvider: "local", sourceId: "local-only", sourceVersionHash: versionHash
    });
    assert.deepEqual(Object.keys(/** @type {object} */ (await service.getCollection(local.collection.collectionId))), ["collectionId", "songName", "createdAtMs", "packages"]);
    assert.equal(await service.deleteCollection(local.collection.collectionId), true);
    service.destroy();
    await assert.rejects(() => service.getCollectionReimportSource(id), hasCode("service_destroyed"));
  } finally {
    service.destroy();
    persistence.destroy();
    if (kind === "indexeddb") await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB test cleanup blocked"));
    });
  }
}
console.log("Real hash-pinned BeatSaver collection reimport source passes memory/IndexedDB; public, local, and legacy boundaries verified.");

/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
