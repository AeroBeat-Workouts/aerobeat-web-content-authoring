// @ts-check

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { computeBeatSaverMapHash, inspectBeatSaverArchive } from "@aerobeat/web-vendor-beatsaver";
import {
  createAeroWebContentAuthoringService,
  createMemoryPersistenceAdapter,
  inspectAuthoredPackageExport,
  prefixedSha256,
  sha256Hex,
  validateAuthoredPackage
} from "../src/index.js";

const cases = [
  {
    mapId: "4858",
    versionHash: "431ffaa53a1e45ffab6c81a895e456f6aad1e038",
    difficulty: "Expert",
    environment: "AEROBEAT_BEATSAVER_4858_ZIP",
    paths: [
      "/home/derrick/.dsh/projects/aerobeat/aerobeat-vendor-beatsaver/.testbed/.artifacts/4858/431ffaa53a1e45ffab6c81a895e456f6aad1e038/4858-431ffaa53a1e.zip",
      "/home/derrick/.dsh/projects/aerobeat/aerobeat-web-vendor-beatsaver/.testbed/.artifacts/4858/431ffaa53a1e45ffab6c81a895e456f6aad1e038/4858-431ffaa53a1e.zip"
    ]
  },
  {
    mapId: "3D44B",
    versionHash: "2549825187cfdf7fb2352e33a614ff3ea6d3317d",
    difficulty: "Hard",
    environment: "AEROBEAT_BEATSAVER_3D44B_ZIP",
    paths: [
      "/home/derrick/.dsh/projects/aerobeat/aerobeat-vendor-beatsaver/.testbed/.artifacts/3d44b/2549825187cfdf7fb2352e33a614ff3ea6d3317d/3d44b-2549825187cf.zip",
      "/home/derrick/.dsh/projects/aerobeat/aerobeat-web-vendor-beatsaver/.testbed/.artifacts/3d44b/2549825187cfdf7fb2352e33a614ff3ea6d3317d/3d44b-2549825187cf.zip"
    ]
  }
];

for (const fixture of cases) {
  const archivePath = await resolveFixturePath(fixture);
  const source = await inspectBeatSaverArchive(new Uint8Array(await readFile(archivePath)));
  assert.equal(await computeBeatSaverMapHash(source), fixture.versionHash);
  const manifest = /** @type {{audioPath:string,difficulties:readonly Readonly<{characteristic:string,difficulty:string,path:string}>[]}} */ (source.manifest);
  assert.equal(typeof manifest.audioPath, "string");
  assert.ok(manifest.audioPath.length > 0, `${fixture.mapId} must declare audio`);
  const selected = manifest.difficulties.find((entry) => entry.characteristic === "Standard" && entry.difficulty.toLowerCase().replace(/[^a-z]/gu, "") === fixture.difficulty.toLowerCase().replace(/[^a-z]/gu, ""));
  assert.ok(selected, `${fixture.mapId} Standard ${fixture.difficulty} must exist`);
  const expectedAudioBytes = source.readEntry(manifest.audioPath);
  const expectedDifficultyBytes = source.readEntry(selected.path);
  const expectedAudioContentHash = await prefixedSha256(expectedAudioBytes);
  const expectedDifficultyContentHash = await prefixedSha256(expectedDifficultyBytes);
  const persistence = createMemoryPersistenceAdapter({ quotaBytes: 1024 * 1024 * 1024 });
  const firstService = createAeroWebContentAuthoringService({ persistence, now: () => 1 });
  const request = {
    difficulty: fixture.difficulty,
    sourceId: fixture.mapId,
    sourceVersionHash: fixture.versionHash,
    includeAudio: true,
    expectedAudioContentHash,
    expectedDifficultyContentHashes: { [selected.path]: expectedDifficultyContentHash }
  };
  const first = await firstService.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, request);
  const firstPackage = /** @type {{charts: {mode: string, beats: unknown[]}[],song:{audio:{filePath:string,contentHash:string}}}} */ (first.package);
  assert.equal(firstPackage.charts.length, 5);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "boxing").length, 4);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "flow").length, 1);
  assert.equal((await validateAuthoredPackage(first.package)).valid, true);
  assert.ok(firstPackage.charts.some((chart) => chart.beats.length > 0));
  assert.equal(firstPackage.song.audio.filePath.toLowerCase(), manifest.audioPath.replaceAll("\\", "/").normalize("NFC").toLowerCase());
  assert.equal(firstPackage.song.audio.contentHash, expectedAudioContentHash);
  const firstHash = first.handle.packageHash.value;
  firstService.destroy();

  const reloadedService = createAeroWebContentAuthoringService({ persistence, now: () => 2 });
  const reloaded = await reloadedService.loadPackage(first.handle);
  assert.deepEqual(reloaded.package, first.package, `${fixture.mapId} package must survive service reload`);
  const copiedAudio = await reloadedService.readAsset(first.handle, manifest.audioPath);
  assert.deepEqual(copiedAudio, expectedAudioBytes, `${fixture.mapId} readAsset must return the copied audio bytes`);
  assert.equal(await prefixedSha256(copiedAudio), expectedAudioContentHash);
  const firstExport = await reloadedService.exportPackage(first.handle);
  const inspected = await inspectAuthoredPackageExport(firstExport.bytes);
  assert.equal(inspected.packageHash, `sha256:${firstHash}`);
  assert.equal(inspected.assets.length, 1);
  assert.equal(inspected.assets[0].path, manifest.audioPath.replaceAll("\\", "/").normalize("NFC").toLowerCase());
  assert.equal(inspected.assets[0].sha256, await sha256Hex(expectedAudioBytes));
  const secondExport = await reloadedService.exportPackage(first.handle);
  assert.deepEqual(secondExport.bytes, firstExport.bytes, `${fixture.mapId} AEROPKG1 export must be deterministic`);
  assert.equal(await reloadedService.deletePackage(first.handle), true);
  await assert.rejects(() => reloadedService.loadPackage(first.handle), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "package_not_found"), `${fixture.mapId} delete must be atomic and durable`);
  assert.equal((await reloadedService.listPackages()).length, 0);

  const second = await reloadedService.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, request);
  assert.equal(second.handle.packageHash.value, firstHash, `${fixture.mapId} conversion must be deterministic`);
  assert.equal(await reloadedService.deletePackage(second.handle), true);
  assert.equal((await reloadedService.listPackages()).length, 0);
  reloadedService.destroy();
  console.log(`${fixture.mapId} ${fixture.difficulty}: package ${firstHash}, audio ${expectedAudioContentHash}, export ${await prefixedSha256(firstExport.bytes)}`);
}

console.log("Real BeatSaver 4858 and 3D44B audio-backed persistence/export validation passed; archives and media remain local and uncommitted.");

/** @param {{mapId:string,environment:string,paths:string[]}} fixture */
async function resolveFixturePath(fixture) {
  const candidates = [process.env[fixture.environment], ...fixture.paths].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try { await access(candidate, constants.R_OK); return candidate; } catch { /* try the next explicitly supported local path */ }
  }
  const error = new Error(`missing-local-fixture: ${fixture.mapId}; set ${fixture.environment} or install an uncommitted archive in an expected .testbed artifact path`);
  Object.assign(error, { code: "missing-local-fixture" });
  throw error;
}
