// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isContentImportJobSnapshot } from "@aerobeat/web-contracts/beatsaver-contracts";
import { isPersistenceHandle } from "@aerobeat/web-contracts/content-contracts";
import {
  convertDifficulty,
  createAeroWebContentAuthoringService,
  createMemoryPersistenceAdapter,
  inspectAuthoredPackageExport,
  parseBeatMapDifficulty,
  semanticParityHash,
  validateAuthoredPackage
} from "../src/index.js";

const golden = JSON.parse(await readFile(new URL("../fixtures/boxing-prototype-golden-v1.json", import.meta.url), "utf8"));
/** @type {Parameters<typeof convertDifficulty>[1]} */
const options = { difficulty: "Hard", songToken: golden.songToken, songName: "Sanitized Golden", bpm: golden.bpm, sourceProvider: "synthetic", sourceId: "golden", sourceVersionHash: "synthetic-v1", sourceDifficultyPath: "Hard.dat", sourceBeatmapVersion: "3.0.0" };
const first = await convertDifficulty(golden.sourceSummary, options);
const second = await convertDifficulty(golden.sourceSummary, options);
assert.deepEqual(first.package, second.package, "double conversion must be byte-semantically deterministic");
const boxing = /** @type {{prototype: Record<string, unknown>, beats: Record<string, unknown>[]}[]} */ (first.charts.filter((chart) => chart.mode === "boxing"));
assert.equal(boxing.length, 4);
const row = boxing.find((chart) => chart.prototype.recipeId === "row_family_balanced_height_v1" && chart.prototype.rulesetId === "boxing_semantic_track_v1");
const cut = boxing.find((chart) => chart.prototype.recipeId === "cut_family_source_height_v1" && chart.prototype.rulesetId === "boxing_semantic_track_v1");
assert.deepEqual(row.beats.map((beat) => beat.type), golden.godotExpected.rowTypes);
assert.deepEqual(cut.beats.map((beat) => beat.type), golden.godotExpected.cutTypes);
assert.deepEqual(row.beats.map((beat) => beat.eventId), golden.godotExpected.rowEventIds);
assert.equal(await semanticParityHash(first.package), golden.webSemanticParityHash);
assert.notEqual(first.sourceHash, golden.godotExpected.sourceHash, "language-specific numeric JSON hash must not be presented as Godot hash parity");
assert.equal((await validateAuthoredPackage(first.package)).valid, true);
const guardReservationSummary = { colorNotes: [{ start: 1, cell: 5, hand: "left", direction: 8, sourceIndex: 0 }, { start: 1, cell: 6, hand: "right", direction: 8, sourceIndex: 1 }, { start: 1.2, cell: 5, hand: "left", direction: 8, sourceIndex: 2 }], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
const guardReservation = await convertDifficulty(guardReservationSummary, { ...options, songToken: "guard-reservation" });
assert.ok(guardReservation.traces.every((trace) => (/** @type {{events: Record<string, unknown>[]}} */ (trace)).events.some((entry) => entry.reason === "guard_window_reserved_before_optimizer")));

for (const format of /** @type {const} */ (["v2", "v3", "v4"])) {
  const fixture = syntheticDifficulty(format);
  const summary = parseBeatMapDifficulty(new TextEncoder().encode(JSON.stringify(fixture)), format);
  assert.equal(summary.colorNotes.length, 7, `${format} must normalize all notes`);
  assert.equal(summary.obstacles.length, 1, `${format} must normalize its obstacle`);
}

const source = syntheticSourceBundle("v3");
let time = 1000;
const persistence = createMemoryPersistenceAdapter({ quotaBytes: 32 * 1024 * 1024 });
const service = createAeroWebContentAuthoringService({ persistence, now: () => ++time });
const snapshots = [];
service.subscribe((snapshot) => { snapshots.push(snapshot); });
const authored = await service.convertAndPersist({ providerId: "synthetic", sourceHash: "synthetic-v1", source }, { difficulty: "Hard", sourceId: "synthetic-map", sourceVersionHash: "synthetic-v1", includeAudio: true, cacheSourceEntries: true });
assert.equal(isContentImportJobSnapshot(authored.job), true);
assert.equal(isPersistenceHandle(authored.handle), true);
assert.equal((/** @type {{charts: unknown[]}} */ (authored.package)).charts.length, 5);
assert.equal((await service.listPackages()).length, 1);
const loaded = await service.loadPackage(authored.handle);
assert.deepEqual(loaded.package, authored.package);
assert.deepEqual(await service.readAsset(authored.handle, "song.ogg"), new Uint8Array([1, 2, 3, 4]));
const exported = await service.exportPackage(authored.handle);
const inspected = inspectAuthoredPackageExport(exported.bytes);
assert.equal(inspected.packageId, authored.handle.packageId);
assert.equal(inspected.assets.length, 1);
assert.equal(await service.deletePackage(authored.handle), true);
assert.equal((await service.listPackages()).length, 0);
assert.ok(snapshots.some((snapshot) => snapshot.state === "converting"));
assert.ok(snapshots.some((snapshot) => snapshot.state === "persisting"));
service.destroy();

const deferred = createDeferred();
const slowWorker = {
  kind: "worker",
  async convert(_request, runtime = {}) { await deferred.promise; if (runtime.signal?.aborted) throw codedError("operation_aborted"); return first; },
  destroy() { deferred.resolve(); }
};
const cancellation = createAeroWebContentAuthoringService({ worker: slowWorker, persistence: createMemoryPersistenceAdapter() });
const pending = cancellation.convertAndPersist({ source }, { difficulty: "Hard", sourceId: "cancel", sourceVersionHash: "v1", includeAudio: false });
assert.equal(cancellation.cancel(), true);
deferred.resolve();
await assert.rejects(pending);
assert.equal((await cancellation.listPackages()).length, 0, "cancelled work must never persist a partial package");
cancellation.destroy();

console.log("Deterministic Worker conversion, Godot semantic parity, persistence, export and cancellation validation passed.");

/** @param {"v2" | "v3" | "v4"} format */
function syntheticDifficulty(format) {
  const notes = golden.sourceSummary.colorNotes;
  if (format === "v2") return { _version: "2.6.0", _notes: notes.map((note) => ({ _time: note.start, _lineIndex: note.cell % 4, _lineLayer: Math.floor(note.cell / 4), _type: note.hand === "left" ? 0 : 1, _cutDirection: note.direction })), _obstacles: [{ _time: 6, _duration: 1, _lineIndex: 0, _type: 0, _width: 1 }] };
  if (format === "v3") return { version: "3.3.0", colorNotes: notes.map((note) => ({ b: note.start, x: note.cell % 4, y: Math.floor(note.cell / 4), c: note.hand === "left" ? 0 : 1, d: note.direction })), bombNotes: [], obstacles: [{ b: 6, d: 1, x: 0, y: 0, w: 1, h: 3 }], sliders: [], burstSliders: [] };
  return { version: "4.0.0", colorNotesData: notes.map((note) => ({ x: note.cell % 4, y: Math.floor(note.cell / 4), c: note.hand === "left" ? 0 : 1, d: note.direction })), colorNotes: notes.map((note, i) => ({ b: note.start, i })), bombNotesData: [], bombNotes: [], obstaclesData: [{ d: 1, x: 0, y: 0, w: 1, h: 3 }], obstacles: [{ b: 6, i: 0 }], arcsData: [], arcs: [], chainsData: [], chains: [] };
}

/** @param {"v2" | "v3" | "v4"} format */
function syntheticSourceBundle(format) {
  const path = "Hard.dat"; const info = new TextEncoder().encode("{}"); const map = new TextEncoder().encode(JSON.stringify(syntheticDifficulty(format))); const audio = new Uint8Array([1, 2, 3, 4]); const entries = new Map([["info.dat", info], [path.toLowerCase(), map], ["song.ogg", audio]]);
  return Object.freeze({
    manifest: Object.freeze({ schemaId: "aerobeat.beatsaver-source-manifest.v1", sourceFormatMajor: Number(format.slice(1)), infoPath: "Info.dat", songName: "Synthetic Golden", songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat", audioPath: "song.ogg", bpm: 120, difficulties: Object.freeze([{ characteristic: "Standard", difficulty: "Hard", path }]), entries: Object.freeze([]) }),
    listEntryPaths() { return Object.freeze(["Info.dat", path, "song.ogg"]); },
    readEntry(entryPath) { const bytes = entries.get(entryPath.toLowerCase()); if (!bytes) throw new Error("missing entry"); return Uint8Array.from(bytes); }
  });
}

function createDeferred() { let resolve = () => undefined; const promise = new Promise((done) => { resolve = () => done(undefined); }); return { promise, resolve }; }
/** @param {string} code */
function codedError(code) { const error = new Error(code); Object.assign(error, { code }); return error; }
