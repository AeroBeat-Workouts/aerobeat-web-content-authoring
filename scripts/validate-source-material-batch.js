// @ts-check

import assert from "node:assert/strict";
import {
  deriveBeatSaberSpawnTiming,
  prepareAllStandardSourceMaterials,
  prepareSourceMaterial,
  standardDifficultyOrder
} from "../src/index.js";

const encoder = new TextEncoder();
const chartBytes = Object.freeze({
  Easy: encoder.encode('{"version":"3.3.0","difficulty":"Easy"}'),
  Normal: encoder.encode('{"version":"3.3.0","difficulty":"Normal"}'),
  Hard: encoder.encode('{"version":"3.3.0","difficulty":"Hard"}'),
  Expert: encoder.encode('{"version":"3.3.0","difficulty":"Expert"}'),
  ExpertPlus: encoder.encode('{"version":"3.3.0","difficulty":"ExpertPlus"}')
});
const infoBytes = encoder.encode('{"version":"3.3.0"}');
const audioBytes = new Uint8Array([4, 8, 15, 16, 23, 42]);

assert.deepEqual(standardDifficultyOrder, ["Easy", "Normal", "Hard", "Expert", "ExpertPlus"]);

const fixture = makeSource([
  difficulty("ExpertPlus", "ExpertPlus.dat"),
  difficulty("Hard", "Hard.dat"),
  difficulty("Easy", "Easy.dat"),
  difficulty("Expert", "Expert.dat"),
  difficulty("Normal", "Normal.dat")
]);
const batch = await prepareAllStandardSourceMaterials(fixture.source, { cacheSourceEntries: true });
assert.deepEqual(batch.materials.map((material) => material.requestManifest.selectedDifficulty.difficulty), standardDifficultyOrder);
assert.deepEqual(batch.materials.map((material) => material.requestManifest.selectedDifficulty.path), ["easy.dat", "normal.dat", "hard.dat", "expert.dat", "expertplus.dat"]);
assert.deepEqual(batch.materials.map((material) => material.difficultyBytes), standardDifficultyOrder.map((name) => chartBytes[name]));
assert.equal(fixture.readCounts.get("Song.ogg"), 1, "batch audio must be read exactly once");
assert.equal(fixture.readCounts.get("Info.dat"), 1, "only the required info cache entry may be read additionally");
for (const name of standardDifficultyOrder) assert.equal(fixture.readCounts.get(`${name}.dat`), 1, `${name} chart must be read once and reused for cache`);
assert.equal(fixture.readCounts.has("Lightshow.dat"), false);
assert.equal(fixture.readCounts.has("OneSaber.dat"), false);
assert.equal(batch.materials.every((material) => material.audio === batch.audio), true, "materials must share one prepared audio asset array");
assert.equal(batch.materials.every((material) => material.sourceCache === batch.sourceCache), true, "materials must share one required-entry cache");
assert.deepEqual(batch.sourceCache.map((entry) => entry.path), ["info.dat", "easy.dat", "normal.dat", "hard.dat", "expert.dat", "expertplus.dat"]);
assert.equal(batch.materials.some((material) => "archive" in material || "blob" in material || "provider" in material), false);

// The existing single-difficulty API retains its exact selected-byte/request shape and
// does not start validating unrelated Standard entries after the selected entry.
const singleFixture = makeSource([
  difficulty("Hard", "Hard.dat"),
  difficulty("Expert", "Expert.dat")
]);
const single = await prepareSourceMaterial(singleFixture.source, { difficulty: "hard", cacheSourceEntries: true });
assert.deepEqual(single.difficultyBytes, chartBytes.Hard);
assert.deepEqual(single.audio[0].bytes, audioBytes);
assert.deepEqual(single.sourceCache.map((entry) => entry.path), ["info.dat", "hard.dat"]);
assert.deepEqual(single.requestManifest.selectedDifficulty, {
  difficulty: "Hard",
  path: "hard.dat",
  beatMapFormat:"v3",
  beatMapVersion:"3.3.0",
  contentHash: single.requestManifest.selectedDifficulty.contentHash,
  notePalette:null,
  noteJumpMovementSpeed:10,
  noteJumpStartBeatOffset:0,
  spawnTiming:deriveBeatSaberSpawnTiming(120,10,0)
});
assert.equal(singleFixture.readCounts.get("Hard.dat"), 1);
assert.equal(singleFixture.readCounts.get("Song.ogg"), 1);
assert.equal(singleFixture.readCounts.has("Expert.dat"), false);
assert.equal(singleFixture.readCounts.has("Ignored.dat"), false);

const duplicate = makeSource([
  difficulty("ExpertPlus", "ExpertPlus.dat"),
  difficulty("expert-plus", "ExpertAlias.dat")
]);
await assert.rejects(
  () => prepareAllStandardSourceMaterials(duplicate.source, {}),
  hasCode("difficulty_duplicate")
);
assert.equal(duplicate.readCounts.size, 0, "duplicate identity must reject before any source bytes are read");

const legacyDifficultyShape=makeSource([difficulty("Hard","Hard.dat")]);legacyDifficultyShape.source.manifest.difficulties=[{characteristic:"Lightshow",difficulty:"Expert",path:"Lightshow.dat"}];
await assert.rejects(()=>prepareAllStandardSourceMaterials(legacyDifficultyShape.source,{}),hasCode("source_manifest_invalid"));
assert.equal(legacyDifficultyShape.readCounts.size,0,"legacy pre-v2 difficulty shapes must reject before source reads");
const oldV1Fixture=makeSource([difficulty("Hard","Hard.dat")]);oldV1Fixture.source.manifest=/** @type {never} */({schemaId:"aerobeat.beatsaver-source-manifest.v1",sourceFormatMajor:3,infoPath:"Info.dat",songName:"Legacy",songAuthorName:"",levelAuthorName:"",audioPath:"Song.ogg",bpm:120,difficulties:[{characteristic:"Standard",difficulty:"Hard",path:"Hard.dat"}],entries:[]});await assert.rejects(()=>prepareAllStandardSourceMaterials(oldV1Fixture.source,{}),hasCode("source_manifest_invalid"));assert.equal(oldV1Fixture.readCounts.size,0,"explicit old-v1 source fixture must remain bounded rejection-only coverage");

for(const [field,value,code] of /** @type {readonly (readonly [string,number,string])[]} */ ([["bpm",0,"spawn_timing_bpm_invalid"],["noteJumpMovementSpeed",0,"spawn_timing_njs_invalid"],["noteJumpStartBeatOffset",Number.NaN,"source_manifest_invalid"]])){const invalid=makeSource([difficulty("Hard","Hard.dat")]);if(field==="bpm")invalid.source.manifest.bpm=value;else invalid.source.manifest.difficulties[0][field]=value;await assert.rejects(()=>prepareAllStandardSourceMaterials(invalid.source,{}),hasCode(code));}

const bounded = makeSource([difficulty("Hard", "Hard.dat"), difficulty("Expert", "Expert.dat")]);
await assert.rejects(
  () => prepareAllStandardSourceMaterials(bounded.source, { limits: { selectedBytes: chartBytes.Hard.byteLength + chartBytes.Expert.byteLength + audioBytes.byteLength - 1 } }),
  hasCode("source_selected_bytes_exceeded")
);

const cancelled = makeSource([difficulty("Hard", "Hard.dat")]);
const controller = new AbortController();
controller.abort();
await assert.rejects(
  () => prepareAllStandardSourceMaterials(cancelled.source, { signal: controller.signal }),
  hasCode("operation_aborted")
);
assert.equal(cancelled.listCalls(), 0, "pre-cancelled preparation must not enumerate or read source entries");
assert.equal(cancelled.readCounts.size, 0);

console.log("all-Standard source material validation passed");

/** @param {string} name @param {string} path */
function difficulty(name, path) { return { characteristic: "Standard", difficulty: name,difficultyRank:{Easy:1,Normal:3,Hard:5,Expert:7,ExpertPlus:9}[name]??5, path,beatMapFormatMajor:3, beatMapFormat:"v3", beatMapVersion:"3.3.0", notePalette:null,noteJumpMovementSpeed:10,noteJumpStartBeatOffset:0 }; }

/** @param {Record<string, unknown>[]} difficulties @param {number} [beatMapMajor] */
function makeSource(difficulties, beatMapMajor = 3) {
  const entries = new Map([
    ["Info.dat", infoBytes],
    ["Song.ogg", audioBytes],
    ["Easy.dat", chartBytes.Easy],
    ["Normal.dat", chartBytes.Normal],
    ["Hard.dat", chartBytes.Hard],
    ["Expert.dat", chartBytes.Expert],
    ["ExpertPlus.dat", chartBytes.ExpertPlus],
    ["ExpertAlias.dat", chartBytes.ExpertPlus],
    ["Ignored.dat", encoder.encode("ignored")],
    ["Lightshow.dat", encoder.encode("lightshow")],
    ["OneSaber.dat", encoder.encode("one-saber")]
  ]);
  const readCounts = new Map();
  let lists = 0;
  const source = {
    manifest: {
      schemaId:"aerobeat.beatsaver-source-manifest.v2",
      infoFormatMajor:beatMapMajor===4?4:2,
      infoFormat:beatMapMajor===4?"v4":"v2",
      infoVersion:beatMapMajor===4?"4.0.0":"2.1.0",
      infoPath: "Info.dat",hashInputPaths:difficulties.map((entry)=>String(entry.path)),
      songName: "Batch Fixture",songSubName:"",
      songAuthorName: "Fixture Artist",
      levelAuthorName: "Fixture Mapper",
      bpm: 120,
      audioPath: "Song.ogg",coverPath:"",previewStartSeconds:0,previewDurationSeconds:0,
      difficulties:difficulties.map((entry)=>entry.characteristic==="Standard"&&beatMapMajor===4?{...entry,beatMapFormatMajor:4,beatMapFormat:"v4",beatMapVersion:"4.0.0"}:entry),entries:[],archiveBytes:0,expandedBytes:0
    },
    listEntryPaths() { lists += 1; return [...entries.keys()]; },
    readEntry(path) {
      readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
      const bytes = entries.get(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return bytes;
    }
  };
  return { source, readCounts, listCalls: () => lists };
}

/** @param {string} code */
function hasCode(code) { return (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
