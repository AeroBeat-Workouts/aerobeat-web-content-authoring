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
    expectedRejection: "obstacle_duration_invalid",
    expectedInfo:{format:"v2",version:"2.0.0",hash:"sha256:278548f453c0249a42a2c0bb3c3f5e1c726eedb63012aa931d9f90d22ef728a2"},expectedBeatmap:{format:"v2",version:"2.0.0",hash:"sha256:7a14673fcba05362c6a64f72a484d6057c8a67fe2bc1fc4b29198bd18b173c8e"},expectedPalette:null,
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
    expectedInfo:{format:"v2",version:"2.1.0",hash:"sha256:23cab9f0e6c2711bc7549ea14c28d7a55d0aef50d46d3f4fa6e3deaaa597cdb0"},expectedBeatmap:{format:"v3",version:"3.3.0",hash:"sha256:7dace72e6fc51a62016399937c5a54581d6208e7104a3cbf2fa8c7e15cd24812"},expectedPalette:{left:"#FF7E14",right:"#0080FF",kind:"difficulty_custom_data",fieldSet:"v2_custom",schemeIndex:null},
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
  const manifest = /** @type {{infoFormat:string,infoVersion:string|null,infoPath:string,audioPath:string,difficulties:readonly Readonly<{characteristic:string,difficulty:string,path:string,beatMapFormat:string,beatMapVersion:string|null,notePalette:Record<string,unknown>|null}>[]}} */ (source.manifest);
  assert.equal(typeof manifest.audioPath, "string");
  assert.ok(manifest.audioPath.length > 0, `${fixture.mapId} must declare audio`);
  const selected = manifest.difficulties.find((entry) => entry.characteristic === "Standard" && entry.difficulty.toLowerCase().replace(/[^a-z]/gu, "") === fixture.difficulty.toLowerCase().replace(/[^a-z]/gu, ""));
  assert.ok(selected, `${fixture.mapId} Standard ${fixture.difficulty} must exist`);
  assert.deepEqual([manifest.infoFormat,manifest.infoVersion,await prefixedSha256(source.readEntry(manifest.infoPath))],[fixture.expectedInfo.format,fixture.expectedInfo.version,fixture.expectedInfo.hash],`${fixture.mapId} must preserve exact Info family/version/hash independently`);
  assert.deepEqual([selected.beatMapFormat,selected.beatMapVersion,await prefixedSha256(source.readEntry(selected.path))],[fixture.expectedBeatmap.format,fixture.expectedBeatmap.version,fixture.expectedBeatmap.hash],`${fixture.mapId} must preserve exact beatmap family/version/hash independently`);
  if(fixture.expectedPalette===null)assert.equal(selected.notePalette,null,`${fixture.mapId} invalid source pair must remain explicit fallback null`);else{assert.ok(selected.notePalette);const provenance=/** @type {Record<string,unknown>} */(selected.notePalette.provenance);assert.deepEqual({left:selected.notePalette.left,right:selected.notePalette.right,kind:provenance.kind,fieldSet:provenance.fieldSet,schemeIndex:provenance.schemeIndex},fixture.expectedPalette);assert.equal(provenance.infoHash,fixture.expectedInfo.hash);assert.equal(provenance.difficultyHash,fixture.expectedBeatmap.hash);}
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
  if (fixture.expectedRejection) {
    await assert.rejects(() => firstService.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, request), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === fixture.expectedRejection));
    assert.equal((await firstService.listPackages()).length, 0, `${fixture.mapId} malformed obstacle rejection must be atomic`);
    firstService.destroy();
    console.log(`${fixture.mapId} ${fixture.difficulty}: atomically rejected ${fixture.expectedRejection}`);
    continue;
  }
  const first = await firstService.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, request);
  const firstPackage = /** @type {{notePalette:Record<string,unknown>|null,charts: {mode: string, beats: unknown[]}[],song:{audio:{filePath:string,contentHash:string}}}} */ (first.package);
  assert.equal(firstPackage.charts.length, 5);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "boxing").length, 4);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "flow").length, 1);
  assert.equal((await validateAuthoredPackage(first.package)).valid, true);
  assert.deepEqual(firstPackage.notePalette===null?null:{left:firstPackage.notePalette.left,right:firstPackage.notePalette.right,kind:(/** @type {Record<string,unknown>} */(firstPackage.notePalette.provenance)).kind,fieldSet:(/** @type {Record<string,unknown>} */(firstPackage.notePalette.provenance)).fieldSet,schemeIndex:(/** @type {Record<string,unknown>} */(firstPackage.notePalette.provenance)).schemeIndex},fixture.expectedPalette);
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

console.log("Real BeatSaver 4858 invalid-palette/malformed-obstacle fallback and 3D44B exact v2-Info/v3-beatmap custom-palette conversion validation passed; archives and media remain local and uncommitted.");

/** @param {{mapId:string,environment:string,paths:string[],expectedRejection?:string}} fixture */
async function resolveFixturePath(fixture) {
  const candidates = [process.env[fixture.environment], ...fixture.paths].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try { await access(candidate, constants.R_OK); return candidate; } catch { /* try the next explicitly supported local path */ }
  }
  const error = new Error(`missing-local-fixture: ${fixture.mapId}; set ${fixture.environment} or install an uncommitted archive in an expected .testbed artifact path`);
  Object.assign(error, { code: "missing-local-fixture" });
  throw error;
}
