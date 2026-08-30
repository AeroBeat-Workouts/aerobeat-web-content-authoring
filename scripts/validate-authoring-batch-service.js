// @ts-check

import assert from "node:assert/strict";
import {
  createAeroWebContentAuthoringService,
  createInlineAuthoringWorkerAdapter,
  createMemoryPersistenceAdapter,
  inspectAuthoredPackageExport
} from "../src/index.js";

const acquired = { providerId: "synthetic", sourceHash: "batch-v1", source: sourceBundle() };
const basePersistence = createMemoryPersistenceAdapter({ quotaBytes: 64 * 1024 * 1024 });
let putCollectionCalls = 0;
const persistence = Object.freeze({ ...basePersistence, async putCollection(batch, options) { putCollectionCalls += 1; return basePersistence.putCollection(batch, options); } });
const inline = createInlineAuthoringWorkerAdapter();
let activeWorkers = 0; let maximumWorkers = 0; let conversions = 0;
const worker = {
  kind: "inline",
  async convert(request, runtime) { conversions += 1; activeWorkers += 1; maximumWorkers = Math.max(maximumWorkers, activeWorkers); try { return await inline.convert(request, runtime); } finally { activeWorkers -= 1; } },
  destroy() { inline.destroy(); }
};
let time = 100;
const service = createAeroWebContentAuthoringService({ persistence, worker, now: () => ++time });
const snapshots = [];
service.subscribe((snapshot) => snapshots.push(snapshot));
const result = await service.convertAllStandardAndPersist(acquired, { sourceProvider: "synthetic", sourceId: "batch-map", sourceVersionHash: "batch-v1", includeAudio: true, cacheSourceEntries: true });
assert.equal(conversions, 2);
assert.equal(maximumWorkers, 1, "batch conversion must remain sequential");
assert.equal(putCollectionCalls, 1, "validated packages must commit through one collection transaction");
assert.deepEqual(result.packages.map((entry) => entry.difficultyId), ["Hard", "Expert"]);
assert.equal(result.defaultPackage.difficultyId, "Hard");
assert.equal("sourceVersionHash" in result.collection, false);
assert.equal("packageHash" in result.packages[0], false);
assert.equal(containsBinary(result), false);
assert.equal((await service.listPackages()).length, 2);
assert.equal((await service.listCollections()).length, 1);
const publicCollection = await service.getCollection(result.collection.collectionId);
assert.equal(publicCollection?.packages.length, 2);
assert.equal("sourceVersionHash" in /** @type {object} */ (publicCollection), false);
assert.equal("converterProfileHash" in /** @type {object} */ (publicCollection), false);
assert.equal("writeToken" in /** @type {object} */ (publicCollection), false);
for (const entry of result.packages) {
  const loaded = await service.loadPackage(entry.handle);
  assert.equal((/** @type {{charts: unknown[]}} */ (loaded.package)).charts.length, 5);
  assert.deepEqual(await service.readAsset(entry.handle, "song.ogg"), new Uint8Array([1, 2, 3, 4]));
  const exported = await service.exportPackage(entry.handle);
  const inspected = await inspectAuthoredPackageExport(exported.bytes);
  assert.equal(inspected.packageId, entry.packageId);
  assert.equal(inspected.assets.length, 1);
}
assert.equal(snapshots.some((snapshot) => containsBinary(snapshot)), false);

const singlePersistence = createMemoryPersistenceAdapter();
const single = createAeroWebContentAuthoringService({ persistence: singlePersistence });
const expert = await single.convertAndPersist(acquired, { difficulty: "Expert", sourceProvider: "synthetic", sourceId: "batch-map", sourceVersionHash: "batch-v1", includeAudio: true, cacheSourceEntries: true });
const batchExpert = result.packages.find((entry) => entry.difficultyId === "Expert");
assert.deepEqual(batchExpert?.handle.packageHash, expert.handle.packageHash, "batching must not alter one-difficulty package hashes");
single.destroy();

assert.equal(await service.deleteCollection(result.collection.collectionId), true);
assert.equal((await service.listPackages()).length, 0);
assert.equal((await service.listCollections()).length, 0);
service.destroy();

const hostilePersistence = createMemoryPersistenceAdapter();
const hostileService = createAeroWebContentAuthoringService({ persistence: hostilePersistence });
let optionGetterCalls = 0;
const hostileOptions = { sourceId: "hostile", sourceVersionHash: "v1" };
Object.defineProperty(hostileOptions, "modifiers", { enumerable: true, get() { optionGetterCalls += 1; return []; } });
await assert.rejects(() => hostileService.convertAllStandardAndPersist(acquired, /** @type {never} */ (hostileOptions)), hasCode("request_invalid"));
assert.equal(optionGetterCalls, 0, "batch request accessors must not execute");
assert.equal((await hostileService.listCollections()).length, 0);
hostileService.destroy();

const failurePersistence = createMemoryPersistenceAdapter();
const failureInline = createInlineAuthoringWorkerAdapter();
let failureCalls = 0;
const failureWorker = { kind: "inline", async convert(request, runtime) { failureCalls += 1; if (failureCalls === 2) throw codedError("synthetic_failure"); return failureInline.convert(request, runtime); }, destroy() { failureInline.destroy(); } };
const failureService = createAeroWebContentAuthoringService({ persistence: failurePersistence, worker: failureWorker });
await assert.rejects(() => failureService.convertAllStandardAndPersist(acquired, { sourceId: "failure", sourceVersionHash: "v1" }), hasCode("synthetic_failure"));
assert.equal((await failureService.listPackages()).length, 0);
assert.equal((await failureService.listCollections()).length, 0);
failureService.destroy();

const deferred = createDeferred();
const cancelPersistence = createMemoryPersistenceAdapter();
const cancelWorker = { kind: "worker", async convert(_request, runtime = {}) { await deferred.promise; if (runtime.signal?.aborted) throw codedError("operation_aborted"); throw codedError("unexpected_completion"); }, destroy() { deferred.resolve(); } };
const cancelService = createAeroWebContentAuthoringService({ persistence: cancelPersistence, worker: cancelWorker });
const pending = cancelService.convertAllStandardAndPersist(acquired, { sourceId: "cancel", sourceVersionHash: "v1" });
assert.equal(cancelService.cancel(), true);
deferred.resolve();
await assert.rejects(pending, hasCode("operation_aborted"));
assert.equal((await cancelService.listPackages()).length, 0);
assert.equal((await cancelService.listCollections()).length, 0);
cancelService.destroy();

console.log("Atomic all-Standard authoring service validation passed.");

function sourceBundle() {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: "3.3.0", colorNotes: [], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
  const entries = new Map([["info.dat", new TextEncoder().encode("{}")], ["hard.dat", bytes], ["expert.dat", bytes], ["song.ogg", new Uint8Array([1, 2, 3, 4])]]);
  return Object.freeze({
    manifest: Object.freeze({ schemaId: "aerobeat.beatsaver-source-manifest.v1", sourceFormatMajor: 3, infoPath: "Info.dat", songName: "Batch Song", songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat", audioPath: "song.ogg", bpm: 120, difficulties: Object.freeze([{ characteristic: "Standard", difficulty: "Expert", path: "Expert.dat" }, { characteristic: "Lightshow", difficulty: "ExpertPlus", path: "Lights.dat" }, { characteristic: "Standard", difficulty: "Hard", path: "Hard.dat" }]), entries: Object.freeze([]) }),
    listEntryPaths() { return Object.freeze(["Info.dat", "Hard.dat", "Expert.dat", "song.ogg"]); },
    readEntry(path) { const value = entries.get(path.toLowerCase()); if (!value) throw new Error("missing entry"); return Uint8Array.from(value); }
  });
}

function createDeferred() { let resolve = () => undefined; const promise = new Promise((done) => { resolve = () => done(undefined); }); return { promise, resolve }; }
/** @param {string} code */
function codedError(code) { const error = new Error(code); Object.assign(error, { code }); return error; }
/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
/** @param {unknown} value @param {Set<object>} [seen] */
function containsBinary(value, seen = new Set()) { if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true; if (!value || typeof value !== "object" || seen.has(value)) return false; seen.add(value); for (const key of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (descriptor && "value" in descriptor && containsBinary(descriptor.value, seen)) return true; } return false; }
