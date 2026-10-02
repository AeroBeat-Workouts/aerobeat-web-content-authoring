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

// This test loads the public package at runtime; a static import makes authoring's
// JS typecheck traverse unrelated sibling content/contracts sources and their existing errors.
const runtimePackageName = ["@aerobeat", "web-content"].join("/");
const { validateRuntimePackage } = await import(runtimePackageName);

const cases = [
  // t7sv parity update: BeatSaver 4858 (Standard Expert, legacy v2.0.0) carries
  // `_type:1` END-marker obstacles whose `_duration` values include negatives
  // (`-0.25`). Pre-t7sv, the parser reached `requiredFinite(_duration)` and
  // rejected with `obstacle_duration_invalid`. Post-t7sv, every `_type:1` entry
  // is skipped at parse time BEFORE any field-level validation, so those invalid
  // terminators no longer reach the parser's strict helpers. The remaining 18
  // legitimate `_type:0` START entries normalize successfully, the package
  // converts, and the chart persists atomically. This is the intended new
  // behavior for a legacy chart whose ONLY obstacle defect is a malformed
  // terminator that must be ignored.
  {
    mapId: "4858",
    versionHash: "431ffaa53a1e45ffab6c81a895e456f6aad1e038",
    difficulty: "Expert",
    environment: "AEROBEAT_BEATSAVER_4858_ZIP",
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
  },
  ...["Hard", "Expert", "ExpertPlus"].map((difficulty) => ({
    mapId: "9a0c",
    versionHash: "0e8ef3006db854c67f04fe72322bccea410f69ee",
    archiveSha256: "e81907d57da62456772471c5274699872db8f7b3dd9ef9160b36c055e6396fcc",
    difficulty,
    environment: "AEROBEAT_BEATSAVER_9A0C_ZIP",
    expectedInfo: { format: "v2", version: "2.0.0", hash: "sha256:0ec1697aa4de9808fd41d3dd662c8e9f08fb2c11051e512b1d5483e20bee95e7" },
    expectedBeatmap: { format: "v2", version: "2.0.0", hash: `sha256:${({
      Hard: "833eabdddcc98367e30a98aac8ce9c81ac5897175949c7b9318074ebbd0e1f32",
      Expert: "8fa3159fdf4c49a9d69f870dfc7f2c9ba7cfb023ad8213c30f4437f87900e0be",
      ExpertPlus: "3f69796c3a160b9cb2ddc8d65a1e77618e5ade904de359bc998efcd2c448c939"
    })[difficulty]}` },
    expectedPalette: null,
    paths: ["/tmp/aerobeat-falloutboy-0e8ef3006db854c67f04fe72322bccea410f69ee.zip"]
  })),
  ...["Expert", "ExpertPlus"].map((difficulty) => ({
    mapId: "52cac",
    versionHash: "a453207b5c24a7e865ac2b9141f842de7b8275de",
    archiveSha256: "f21019d07fe674d5b906e5f3ac644dacd94dbf41b77435d27f350682890709fe",
    difficulty,
    environment: "AEROBEAT_BEATSAVER_52CAC_ZIP",
    expectedInfo: { format: "v2", version: "2.1.0", hash: "sha256:f57452397f665a52b019fb481f14198d54867516bf7563d44e30f65cbdd902e7" },
    expectedBeatmap: { format: "v3", version: "3.3.0", hash: difficulty === "Expert"
      ? "sha256:1ce5317c3f736cfb93d1486ef5027b84703582148a74385655d2be0e2b7926bc"
      : "sha256:2b78a6f05a9aeeda60e8376c0032bdc2394ac8bd57c0b3558ec95fee4e78894b" },
    expectedPalette: null,
    paths: ["/tmp/aerobeat-skillet-a453207b5c24a7e865ac2b9141f842de7b8275de.zip"]
  })),
  ...["Expert", "ExpertPlus"].map((difficulty) => ({
    mapId: "54510",
    versionHash: "f5c04797fe0831741adec66ce5386971153919d4",
    difficulty,
    environment: "AEROBEAT_BEATSAVER_54510_ZIP",
    expectedInfo: { format: "v2", version: "2.1.0", hash: "sha256:60b7def029cd3729840d605635fae866c473d4d3f5fe94179c180c8ecedb0979" },
    expectedBeatmap: {
      format: "v3", version: "3.3.0",
      hash: difficulty === "Expert"
        ? "sha256:5f2b8f1b5a13f4c5e6a9d465722ba779265120f5d4ae3975d7c9f4ed2421ea4a"
        : "sha256:bc3bb93bf7752e9b966b143f62479fc92d674050b68ca16b4c2a918f3641a1dd"
    },
    expectedPalette: { left: "#FF7B00", right: "#0082FF", kind: "difficulty_custom_data", fieldSet: "v2_custom", schemeIndex: null },
    paths: ["/tmp/aerobeat-54510-f5c04797fe0831741adec66ce5386971153919d4.zip"]
  }))
];

for (const fixture of cases) {
  const archivePath = await resolveFixturePath(fixture);
  const archiveBytes = new Uint8Array(await readFile(archivePath));
  if ("archiveSha256" in fixture) assert.equal(await sha256Hex(archiveBytes), fixture.archiveSha256, `${fixture.mapId} archive bytes must match pinned SHA-256`);
  const source = await inspectBeatSaverArchive(archiveBytes);
  assert.equal(await computeBeatSaverMapHash(source), fixture.versionHash);
  const manifest = /** @type {{infoFormat:string,infoVersion:string|null,infoPath:string,audioPath:string,difficulties:readonly Readonly<{characteristic:string,difficulty:string,path:string,beatMapFormat:string,beatMapVersion:string|null,notePalette:Record<string,unknown>|null}>[]}} */ (source.manifest);
  assert.equal(typeof manifest.audioPath, "string");
  assert.ok(manifest.audioPath.length > 0, `${fixture.mapId} must declare audio`);
  const selected = manifest.difficulties.find((entry) => entry.characteristic === "Standard" && entry.difficulty.toLowerCase().replace(/[^a-z]/gu, "") === fixture.difficulty.toLowerCase().replace(/[^a-z]/gu, ""));
  assert.ok(selected, `${fixture.mapId} Standard ${fixture.difficulty} must exist`);
  assert.deepEqual([manifest.infoFormat,manifest.infoVersion,await prefixedSha256(source.readEntry(manifest.infoPath))],[fixture.expectedInfo.format,fixture.expectedInfo.version,fixture.expectedInfo.hash],`${fixture.mapId} must preserve exact Info family/version/hash independently`);
  assert.deepEqual([selected.beatMapFormat,selected.beatMapVersion,await prefixedSha256(source.readEntry(selected.path))],[fixture.expectedBeatmap.format,fixture.expectedBeatmap.version,fixture.expectedBeatmap.hash],`${fixture.mapId} must preserve exact beatmap family/version/hash independently`);
  if (fixture.mapId === "9a0c") {
    const raw = JSON.parse(new TextDecoder().decode(source.readEntry(selected.path)));
    assert.deepEqual(raw._obstacles[0], { _time: 6, _lineIndex: 0, _type: 0, _duration: -2.5, _width: 1 });
    assert.equal(raw._obstacles.filter((wall) => wall._type === 0 && Number.isFinite(wall._duration) && wall._duration <= 0).length, 39, `${fixture.difficulty} raw finite nonpositive START count`);
  }
  if (fixture.mapId === "52cac") {
    const raw = JSON.parse(new TextDecoder().decode(source.readEntry(selected.path)));
    const walls = raw.obstacles;
    assert.equal(walls.length, fixture.difficulty === "Expert" ? 184 : 186);
    assert.deepEqual(walls[3], fixture.difficulty === "Expert"
      ? { b: 39, d: 0.5, w: 1, h: 5 }
      : { b: 39, x: 3, y: 0, d: 0.5, w: 1, h: 5 });
    assert.equal(walls.filter((wall) => !Object.hasOwn(wall, "x")).length, fixture.difficulty === "Expert" ? 60 : 0);
    assert.equal(walls.filter((wall) => !Object.hasOwn(wall, "y")).length, fixture.difficulty === "Expert" ? 152 : 0);
  }
  if (fixture.mapId === "54510") {
    const raw = JSON.parse(new TextDecoder().decode(source.readEntry(selected.path)));
    assert.deepEqual(raw.obstacles[437], { b: 148.906, x: -2, y: 2, d: 0.125, w: 3, h: 1 }, `${fixture.difficulty} raw off-grid obstacle 437 must remain hash-pinned`);
  }
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
  const first = await firstService.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, request);
  const firstPackage = /** @type {{notePalette:Record<string,unknown>|null,charts: {mode: string, beats: unknown[]}[],song:{audio:{filePath:string,contentHash:string}}}} */ (first.package);
  // z7nw — new imports emit Flow + the sole collider Boxing chart.
  assert.equal(firstPackage.charts.length, 2);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "boxing").length, 1);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "flow").length, 1);
  const validation = await validateAuthoredPackage(first.package);
  assert.equal(validation.valid, true, `${fixture.mapId} ${fixture.difficulty} package validation: ${JSON.stringify(validation.issues)}`);
  await assert.doesNotReject(
    () => validateRuntimePackage(first.package, { declaredPackageHash: first.handle.packageHash }),
    `${fixture.mapId} Standard ${fixture.difficulty} must pass current runtime package validation`
  );
  if (fixture.mapId === "9a0c") {
    const raw = JSON.parse(new TextDecoder().decode(source.readEntry(selected.path)));
    const positive = raw._obstacles.map((wall, index) => ({ wall, index })).filter(({ wall }) => wall._type === 0 && wall._duration > 0);
    const flow = firstPackage.charts.find((chart) => chart.mode === "flow");
    assert.ok(flow);
    const obstacles = flow.beats.filter((beat) => beat && typeof beat === "object" && /** @type {{type?:string}} */ (beat).type === "obstacle");
    assert.equal(obstacles.length, positive.length, `${fixture.difficulty}: omit all 39 nonpositive START entries, preserve ${positive.length} playable walls`);
    assert.deepEqual(obstacles.map((beat) => /** @type {{start:number,end:number}} */ (beat).start), positive.map(({ wall }) => wall._time), `${fixture.difficulty}: surviving positive wall starts must be preserved`);
    assert.deepEqual(obstacles.map((beat) => /** @type {{start:number,end:number}} */ (beat).end), positive.map(({ wall }) => wall._time + wall._duration), `${fixture.difficulty}: surviving positive wall ends must be preserved`);
    assert.ok(obstacles.every((beat) => /** @type {{end:number,start:number}} */ (beat).end > /** @type {{end:number,start:number}} */ (beat).start));
  }
  if (fixture.mapId === "52cac") {
    const flow = firstPackage.charts.find((chart) => chart.mode === "flow");
    assert.ok(flow);
    // Flow's public beat omits sourceIndex; identify the pinned source index 3
    // through its exact interval and rectangle (the raw index is asserted above).
    const matches = flow.beats.filter((beat) => {
      if (!beat || typeof beat !== "object") return false;
      const wall = /** @type {{type?:string,start?:number,end?:number,sourceGeometry?:Record<string,unknown>}} */ (beat);
      return wall.type === "obstacle" && wall.start === 39 && wall.end === 39.5 &&
        wall.sourceGeometry?.x === (fixture.difficulty === "Expert" ? 0 : 3) &&
        wall.sourceGeometry?.y === 0 && wall.sourceGeometry?.width === 1 && wall.sourceGeometry?.height === 5;
    });
    assert.equal(matches.length, 1, `${fixture.difficulty} source obstacle 3 must emit one Flow obstacle`);
    const wall = /** @type {{sourceGeometry:Record<string,unknown>,gameplayGeometry:Record<string,unknown>,gridMask:number[],start:number,end:number}} */ (matches[0]);
    assert.deepEqual([wall.start, wall.end, wall.sourceGeometry.x, wall.sourceGeometry.y, wall.sourceGeometry.width, wall.sourceGeometry.height], [39, 39.5, fixture.difficulty === "Expert" ? 0 : 3, 0, 1, 5]);
    assert.deepEqual([wall.gameplayGeometry.x, wall.gameplayGeometry.y, wall.gameplayGeometry.width, wall.gameplayGeometry.height], [fixture.difficulty === "Expert" ? 0 : 3, 0, 1, 3]);
    assert.deepEqual(wall.gridMask, fixture.difficulty === "Expert" ? [0, 4, 8] : [3, 7, 11]);
  }
  if (fixture.mapId === "54510") {
    const flow = firstPackage.charts.find((chart) => chart.mode === "flow");
    assert.ok(flow);
    const obstacles = flow.beats.filter((beat) => beat && typeof beat === "object" && /** @type {{type?:string}} */ (beat).type === "obstacle");
    const clipped = obstacles.filter((beat) => {
      const obstacle = /** @type {{start:number, end:number, sourceGeometry:Record<string,unknown>}} */ (beat);
      return obstacle.start === 148.906 && obstacle.end === 149.031 &&
        obstacle.sourceGeometry.x === -2 && obstacle.sourceGeometry.y === 2 &&
        obstacle.sourceGeometry.width === 3 && obstacle.sourceGeometry.height === 1;
    });
    assert.equal(clipped.length, 1, `${fixture.difficulty} raw obstacle 437 must yield exactly one Flow obstacle`);
    assert.deepEqual(/** @type {{gameplayGeometry:unknown,gridMask:unknown}} */ (clipped[0]).gameplayGeometry,
      { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 1, height: 1 });
    assert.deepEqual(/** @type {{gridMask:unknown}} */ (clipped[0]).gridMask, [0]);
  }
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

console.log("Real BeatSaver 4858, 3D44B, 9a0c Hard/Expert/ExpertPlus, 52cac Expert/ExpertPlus, and 54510 Expert/ExpertPlus conversion validation passed; archives and media remain local and uncommitted.");

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
