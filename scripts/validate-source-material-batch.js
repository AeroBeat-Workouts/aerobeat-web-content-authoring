// @ts-check

import assert from "node:assert/strict";
import {
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
  { characteristic: "Lightshow", difficulty: "Expert", path: "Lightshow.dat" },
  difficulty("Easy", "Easy.dat"),
  { characteristic: "OneSaber", difficulty: "Normal", path: "OneSaber.dat" },
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
  { characteristic: "Standard", difficulty: "UnsupportedAfterSelection", path: "Ignored.dat" },
  difficulty("Expert", "Expert.dat")
]);
const single = await prepareSourceMaterial(singleFixture.source, { difficulty: "hard", cacheSourceEntries: true });
assert.deepEqual(single.difficultyBytes, chartBytes.Hard);
assert.deepEqual(single.audio[0].bytes, audioBytes);
assert.deepEqual(single.sourceCache.map((entry) => entry.path), ["info.dat", "hard.dat"]);
assert.deepEqual(single.requestManifest.selectedDifficulty, {
  difficulty: "Hard",
  path: "hard.dat",
  contentHash: single.requestManifest.selectedDifficulty.contentHash
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

const mixedOnly = makeSource([
  { characteristic: "Lightshow", difficulty: "Expert", path: "Lightshow.dat" },
  { characteristic: "OneSaber", difficulty: "Hard", path: "OneSaber.dat" }
]);
await assert.rejects(
  () => prepareAllStandardSourceMaterials(mixedOnly.source, {}),
  hasCode("difficulty_unavailable")
);
assert.equal(mixedOnly.readCounts.size, 0);

// Catalyst contains only Standard gameplay, so mixed v4 exclusion remains locked by a synthetic source.
const mixedV4 = makeSource([
  { characteristic: "Lightshow", difficulty: "ExpertPlus", path: "Lightshow.dat" },
  { characteristic: "OneSaber", difficulty: "Hard", path: "OneSaber.dat" },
  difficulty("Expert", "Expert.dat")
], 4);
const mixedV4Batch = await prepareAllStandardSourceMaterials(mixedV4.source, {});
assert.deepEqual(mixedV4Batch.materials.map((material) => material.requestManifest.selectedDifficulty.difficulty), ["Expert"]);
assert.equal(mixedV4Batch.materials[0].requestManifest.sourceFormatMajor, 4);
assert.equal(mixedV4.readCounts.has("Lightshow.dat"), false);
assert.equal(mixedV4.readCounts.has("OneSaber.dat"), false);

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
function difficulty(name, path) { return { characteristic: "Standard", difficulty: name, path }; }

/** @param {Record<string, unknown>[]} difficulties @param {number} [sourceFormatMajor] */
function makeSource(difficulties, sourceFormatMajor = 3) {
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
      sourceFormatMajor,
      infoPath: "Info.dat",
      songName: "Batch Fixture",
      songAuthorName: "Fixture Artist",
      levelAuthorName: "Fixture Mapper",
      bpm: 120,
      audioPath: "Song.ogg",
      difficulties
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
