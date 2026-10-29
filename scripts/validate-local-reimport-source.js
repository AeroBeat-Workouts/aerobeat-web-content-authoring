// @ts-check

// 0.0.149 (Derrick): a song imported from a local ZIP must be reimportable from the source
// material cached at import time, with no archive and no extra storage. This proves the
// authoring half: the stored source can be read back byte-exact, a `local` provider may
// replace its own collection in place, and any collection without a usable cache says so
// instead of pretending to be reimportable.
import assert from "node:assert/strict";
import { createAeroWebContentAuthoringService, createInlineAuthoringWorkerAdapter, createMemoryPersistenceAdapter } from "../src/index.js";

const encoder = new TextEncoder();
const difficultyBytes = encoder.encode(JSON.stringify({ version: "3.3.0", colorNotes: [], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const infoBytes = encoder.encode(JSON.stringify({ _version: "2.1.0", _songName: "Cached Song", _songFilename: "song.ogg" }));
const audioBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

/** @param {string} songName */
function sourceBundle(songName) {
  const entries = new Map([["info.dat", infoBytes], ["hard.dat", difficultyBytes], ["expert.dat", difficultyBytes], ["song.ogg", audioBytes]]);
  return Object.freeze({
    manifest: Object.freeze({
      schemaId: "aerobeat.beatsaver-source-manifest.v2", infoFormatMajor: 2, infoFormat: "v2", infoVersion: "2.1.0",
      infoPath: "Info.dat", hashInputPaths: Object.freeze(["Hard.dat", "Expert.dat"]),
      songName, songSubName: "", songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat",
      audioPath: "song.ogg", coverPath: "", bpm: 120, previewStartSeconds: 0, previewDurationSeconds: 0,
      difficulties: Object.freeze([
        { characteristic: "Standard", difficulty: "Expert", difficultyRank: 7, path: "Expert.dat", beatMapFormatMajor: 3, beatMapFormat: "v3", beatMapVersion: "3.3.0", notePalette: null, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0 },
        { characteristic: "Standard", difficulty: "Hard", difficultyRank: 5, path: "Hard.dat", beatMapFormatMajor: 3, beatMapFormat: "v3", beatMapVersion: "3.3.0", notePalette: null, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0 }
      ]),
      entries: Object.freeze([]), archiveBytes: 0, expandedBytes: 0
    }),
    listEntryPaths() { return Object.freeze(["Info.dat", "Hard.dat", "Expert.dat", "song.ogg"]); },
    readEntry(/** @type {string} */ path) { const value = entries.get(path.toLowerCase()); if (!value) throw new Error("missing entry"); return Uint8Array.from(value); }
  });
}

let time = 0;
const service = createAeroWebContentAuthoringService({
  persistence: createMemoryPersistenceAdapter({ quotaBytes: 64 * 1024 * 1024 }),
  worker: createInlineAuthoringWorkerAdapter(),
  now: () => ++time
});
try {
  const localSourceId = "local:0123456789abcdef0123456789abcdef01234567";
  const versionHash = "a".repeat(40);
  const first = await service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: versionHash, source: sourceBundle("Cached Song") }, {
    sourceProvider: "local", sourceId: localSourceId, sourceVersionHash: versionHash,
    includeAudio: true, cacheSourceEntries: true
  });
  const collectionId = first.collection.collectionId;
  assert.equal(first.packages.length, 2, "both Standard difficulties must import");

  // The provenance recorded for a local ZIP is honest and reimportable.
  const recorded = await service.getCollectionReimportSource(collectionId);
  assert.deepEqual([recorded?.sourceProvider, recorded?.sourceId, recorded?.sourceVersionHash], ["local", localSourceId, versionHash], "a local import must record local provenance, not a BeatSaver claim");
  const stored = await service.getCollectionStoredSource(collectionId);
  assert.ok(stored, "a local import must expose its cached source");
  assert.deepEqual(stored.entries.map((entry) => entry.path.toLowerCase()).sort(), ["expert.dat", "hard.dat", "info.dat"], "the cache must hold Info.dat and every Standard difficulty");
  assert.deepEqual(stored.audio, { path: "song.ogg", bytes: audioBytes }, "the cache must expose the stored audio for the same bytes");
  const infoEntry = stored.entries.find((entry) => entry.path.toLowerCase() === "info.dat");
  assert.deepEqual(infoEntry?.bytes, infoBytes, "cached source bytes must be byte-exact");
  assert.deepEqual([stored.sourceProvider, stored.sourceId, stored.sourceVersionHash], ["local", localSourceId, versionHash], "the stored source must carry the recorded provider identity");

  // Replacing a local collection in place is allowed and keeps the collection id.
  const replaced = await service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: versionHash, source: sourceBundle("Cached Song") }, {
    sourceProvider: "local", sourceId: localSourceId, sourceVersionHash: versionHash,
    includeAudio: true, cacheSourceEntries: true, replaceCollectionId: collectionId
  });
  assert.equal(replaced.collection.collectionId, collectionId, "local reimport must replace the same collection");
  const collections = await service.listCollections();
  assert.equal(collections.length, 1, "local reimport must not leave a duplicate collection");
  assert.equal((await service.getCollectionStoredSource(collectionId))?.entries.length, 3, "the replaced collection must still expose its cached source");

  // A collection without cached source material is not reimportable and must say so by null.
  const uncached = await service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: "b".repeat(40), source: sourceBundle("No Cache") }, {
    sourceProvider: "local", sourceId: "local:" + "b".repeat(40), sourceVersionHash: "b".repeat(40), includeAudio: true
  });
  assert.equal(await service.getCollectionStoredSource(uncached.collection.collectionId), null, "an import without cached source must not claim a stored source");
  assert.equal(await service.getCollectionStoredSource("collection:missing"), null, "an unknown collection has no stored source");

  // Replacement still requires an exact source identity, and provider labels stay bounded.
  const replacement = { sourceProvider: "local", sourceId: localSourceId, sourceVersionHash: versionHash, includeAudio: true, replaceCollectionId: collectionId };
  await assert.rejects(() => service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: versionHash, source: sourceBundle("Cached Song") }, { ...replacement, sourceVersionHash: "" }), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "request_invalid"), "replacement without a version hash must fail");
  await assert.rejects(() => service.convertAllStandardAndPersist({ providerId: "beatsaver", sourceHash: versionHash, source: sourceBundle("Cached Song") }, { ...replacement, sourceProvider: "unknown" }), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "request_invalid"), "an unknown provider may not replace a collection");
  console.log("Local stored-source reimport: honest provenance, byte-exact cache, in-place replacement, and no false reimport claims.");
} finally {
  service.destroy();
}