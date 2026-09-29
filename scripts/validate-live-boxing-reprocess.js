// @ts-check
import assert from "node:assert/strict";
import { createAeroWebContentAuthoringService } from "../src/index.js";

const mapBytes = new TextEncoder().encode(JSON.stringify({ version: "3.3.0", colorNotes: [
  { b: 2, x: 1, y: 2, c: 0, d: 0 }, { b: 4, x: 2, y: 1, c: 1, d: 8 }
], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const entries = new Map([["info.dat", new TextEncoder().encode("{}")], ["hard.dat", mapBytes], ["song.ogg", new Uint8Array([1, 2, 3, 4])]]);
let reads = 0;
const source = {
  manifest: { schemaId: "aerobeat.beatsaver-source-manifest.v2", infoFormatMajor: 2, infoFormat: "v2", infoVersion: "2.1.0", infoPath: "Info.dat", hashInputPaths: ["Hard.dat"], songName: "Reprocess", songSubName: "", songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat", audioPath: "song.ogg", coverPath: "", bpm: 120, previewStartSeconds: 0, previewDurationSeconds: 0, difficulties: [{ characteristic: "Standard", difficulty: "Hard", difficultyRank: 5, path: "Hard.dat", beatMapFormatMajor: 3, beatMapFormat: "v3", beatMapVersion: "3.3.0", notePalette: null, noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0 }], entries: [], archiveBytes: 0, expandedBytes: 0 },
  listEntryPaths() { reads++; return ["Info.dat", "Hard.dat", "song.ogg"]; },
  readEntry(path) { reads++; return Uint8Array.from(entries.get(path.toLowerCase())); }
};
const service = createAeroWebContentAuthoringService();
const imported = await service.convertAndPersist({ source }, { difficulty: "Hard", sourceId: "reprocess", sourceVersionHash: "abc", modifiers: ["any_punch"], includeAudio: true, cacheSourceEntries: true, converterSettings: { uppercutOppositeLane: false, anyOppositeLane: true } });
/** @param {Record<string,unknown>} pkg */
const chart = (pkg) => /** @type {{beats:{type:string,spatialTarget:{targetCell:number}}[]}} */ (/** @type {unknown} */ (/** @type {{charts:{mode:string}[]}} */ (pkg).charts.find((item) => item.mode === "boxing")));
/** @param {Record<string,unknown>} pkg @param {string} type */
const cell = (pkg, type) => chart(pkg).beats.find((beat) => beat.type === type).spatialTarget.targetCell;
const initialReads = reads;
const moved = await service.reprocessBoxing(imported.handle, { uppercutOppositeLane: true, anyOppositeLane: false });
assert.equal(reads, initialReads, "reprocess must not revisit source or network");
assert.equal(cell(imported.package, "uppercut_left") % 4, 1);
assert.equal(cell(moved.package, "uppercut_left") % 4, 2);
assert.equal(cell(imported.package, "straight_right") % 4, 1);
assert.equal(cell(moved.package, "straight_right") % 4, 2);
assert.deepEqual(/** @type {{charts:{mode:string}[]}} */ (/** @type {unknown} */ (imported.package)).charts.find((item) => item.mode === "flow"), /** @type {{charts:{mode:string}[]}} */ (/** @type {unknown} */ (moved.package)).charts.find((item) => item.mode === "flow"));
assert.deepEqual(imported.package.song, /** @type {{song:unknown}} */ (/** @type {unknown} */ (moved.package)).song);
const repeated = await service.reprocessBoxing(imported.handle, { uppercutOppositeLane: true, anyOppositeLane: false });
assert.equal(moved.packageHash, repeated.packageHash, "same inputs must produce the same package hash");
const restored = await service.reprocessBoxing(imported.handle, { uppercutOppositeLane: false, anyOppositeLane: true });
assert.equal(imported.handle.packageHash.value, restored.packageHash.slice(7), "flipping back must recover the original package");
assert.deepEqual((await service.loadPackage(imported.handle)).package, imported.package, "reprocess must not alter persistent collection entries");
const uncached = await service.convertAndPersist({ source }, { difficulty: "Hard", sourceId: "reprocess-uncached", sourceVersionHash: "abc", includeAudio: true });
await assert.rejects(() => service.reprocessBoxing(uncached.handle, { uppercutOppositeLane: true }), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "source_cache_unavailable"));
service.destroy();
console.log("Cached current-difficulty Boxing reprocess preserves Flow, audio, and persistent collection; both lanes and idempotence verified.");
