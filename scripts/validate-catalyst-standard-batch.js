// @ts-check

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import {
  computeBeatSaverMapHash,
  createAeroBeatSaverVendorService,
  inspectBeatSaverArchive
} from "@aerobeat/web-vendor-beatsaver";
import {
  createAeroWebContentAuthoringService,
  createMemoryPersistenceAdapter,
  validateAuthoredPackage
} from "../src/index.js";

const mapId = "1AE3A";
const versionHash = "1348bac90dd94d7299bda388bd101a2b967e28b3";
const acquired = await acquireCatalyst();
assert.equal(acquired.sourceHash, versionHash);
assert.equal(await computeBeatSaverMapHash(acquired.source), versionHash);
const manifest = /** @type {{audioPath:string,difficulties:readonly Readonly<{characteristic:string,difficulty:string,path:string}>[]}} */ (acquired.source.manifest);
assert.deepEqual(manifest.difficulties.map((entry) => [entry.characteristic, entry.difficulty]), [["Standard", "Expert"], ["Standard", "ExpertPlus"]]);
assert.ok(manifest.difficulties.every((entry) => entry.characteristic === "Standard"), "nonstandard characteristics must not become playable source materials");

const base = createMemoryPersistenceAdapter({ quotaBytes: 1024 * 1024 * 1024 });
let collectionWrites = 0;
let sharedAssetRows = 0;
let capturedPackageRows = 0;
const persistence = Object.freeze({
  ...base,
  async putCollection(batch, options) {
    collectionWrites += 1;
    assert.ok(batch && typeof batch === "object" && "assets" in batch && "packages" in batch);
    const value = /** @type {{assets:{contentHash:string,bytes:Uint8Array}[],packages:{assets:unknown[],assetRefs:{path:string,contentHash:string}[]}[]}} */ (batch);
    sharedAssetRows = value.assets.length;
    capturedPackageRows = value.packages.length;
    assert.equal(value.assets.length, 1);
    assert.equal(value.packages.length, 2);
    assert.ok(value.packages.every((row) => row.assets.length === 0 && row.assetRefs.length === 1));
    assert.ok(value.packages.every((row) => row.assetRefs[0].contentHash === value.assets[0].contentHash));
    assert.ok(value.packages.every((row) => row.assetRefs[0].path === manifest.audioPath.replaceAll("\\", "/").normalize("NFC").toLowerCase()));
    return base.putCollection(batch, options);
  }
});
const snapshots = [];
const service = createAeroWebContentAuthoringService({ persistence, now: () => 1 });
service.subscribe((snapshot) => snapshots.push(snapshot));
const result = await service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: versionHash, source: acquired.source }, { sourceProvider: "beatsaver", sourceId: mapId, sourceVersionHash: versionHash, includeAudio: true });
assert.equal(collectionWrites, 1);
assert.equal(sharedAssetRows, 1);
assert.equal(capturedPackageRows, 2);
assert.deepEqual(result.packages.map((entry) => entry.difficultyId), ["Expert", "ExpertPlus"]);
assert.equal(result.collection.packages.length, 2);
assert.equal((await service.listCollections()).length, 1);
assert.equal((await service.getCollection(result.collection.collectionId))?.packages.length, 2);
assertPublicCollection(result.collection);
for (const collection of await service.listCollections()) assertPublicCollection(collection);
assertNoMedia(result);
assertNoMedia(snapshots);
let chartCount = 0;
for (const entry of result.packages) {
  const loaded = await service.loadPackage(entry.handle);
  assert.equal((await validateAuthoredPackage(loaded.package)).valid, true);
  const charts = /** @type {{charts:unknown[]}} */ (loaded.package).charts;
  assert.equal(charts.length, 5);
  chartCount += charts.length;
  assert.ok((await service.readAsset(entry.handle, manifest.audioPath)).byteLength > 0);
}
assert.equal(chartCount, 10);
assert.equal(await service.deleteCollection(result.collection.collectionId), true);
assert.equal((await service.listPackages()).length, 0);
service.destroy();
console.log(`Catalyst ${mapId}/${versionHash}: Standard Expert + ExpertPlus -> 2 v1 packages / 10 charts / 1 atomic collection / 1 shared audio; archive and media remained process-local.`);

async function acquireCatalyst() {
  const saved = await resolveSavedFixture();
  if (saved) {
    const source = await inspectBeatSaverArchive(new Uint8Array(await readFile(saved)));
    return { source, sourceHash: await computeBeatSaverMapHash(source) };
  }
  const vendor = createAeroBeatSaverVendorService();
  const map = await vendor.getMapById(mapId);
  assert.ok(map.versions.some((version) => version.hash === versionHash), "BeatSaver no longer exposes the exact Catalyst version");
  return vendor.acquireVersion(map, versionHash);
}

async function resolveSavedFixture() {
  const candidates = [
    process.env.AEROBEAT_BEATSAVER_1AE3A_ZIP,
    `/home/derrick/.dsh/projects/aerobeat/aerobeat-web-vendor-beatsaver/.testbed/.artifacts/1ae3a/${versionHash}/1ae3a-${versionHash.slice(0, 12)}.zip`
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try { await access(candidate, constants.R_OK); return candidate; } catch { /* use the next local candidate or live acquisition */ }
  }
  return null;
}

/** @param {Readonly<Record<string, unknown>>} collection */
function assertPublicCollection(collection) {
  for (const forbidden of ["sourceVersionHash", "converterProfileHash", "packageHash", "writeToken", "assets", "assetRefs", "bytes", "provenance"]) assert.equal(forbidden in collection, false, `public collection leaked ${forbidden}`);
  assertNoMedia(collection);
}

/** @param {unknown} value @param {Set<object>} [seen] */
function assertNoMedia(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  assert.equal(value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob, false, "public value leaked binary/media");
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) continue;
    if (typeof descriptor.value === "string") assert.equal(/^(blob:|data:|https?:\/\/)/iu.test(descriptor.value), false, "public value leaked a media URL");
    assertNoMedia(descriptor.value, seen);
  }
}
