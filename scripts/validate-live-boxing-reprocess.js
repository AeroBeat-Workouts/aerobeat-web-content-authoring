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
const repeatedSourceBytes = new TextEncoder().encode(JSON.stringify({ version: "3.3.0", colorNotes: [
  { b: 1, x: 1, y: 1, c: 0, d: 8 }, { b: 2, x: 1, y: 1, c: 0, d: 8 },
  { b: 4, x: 1, y: 1, c: 0, d: 8 }, { b: 4, x: 2, y: 1, c: 1, d: 8 },
  { b: 6, x: 1, y: 1, c: 0, d: 8 }, { b: 6, x: 2, y: 1, c: 1, d: 8 }
], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const repeatedSource = { ...source, readEntry(path) { return path.toLowerCase() === "hard.dat" ? Uint8Array.from(repeatedSourceBytes) : Uint8Array.from(entries.get(path.toLowerCase())); } };
const B = { repeatedPunchSwitchChancePercent: 100, repeatedGuardReplaceChancePercent: 100 };
const bImported = await service.convertAndPersist({ source: repeatedSource }, { difficulty: "Hard", sourceId: "reprocess-b", sourceVersionHash: "abc", includeAudio: true, cacheSourceEntries: true, converterSettings: B });
const bOptimizer = /** @type {{conversionTrace:{boxing:{optimizer:Record<string,unknown>}[]}}} */ (/** @type {unknown} */ (bImported.package)).conversionTrace.boxing[0].optimizer;
assert.equal(bOptimizer.repeatedPunchSwitchChancePercent, 100);
assert.equal(bOptimizer.repeatedGuardReplaceChancePercent, 100);
const selectedWithoutChanceKeys = await service.reprocessBoxing(bImported.handle, { guardSpacing: 0.25, uppercutOppositeLane: false, anyOppositeLane: false });
assert.deepEqual(chart(selectedWithoutChanceKeys.package).beats, chart(bImported.package).beats, "selecting a B-reimported song must retain persisted repeated patterns");
assert.deepEqual(/** @type {{conversionTrace:{boxing:{optimizer:Record<string,unknown>}[]}}} */ (/** @type {unknown} */ (selectedWithoutChanceKeys.package)).conversionTrace.boxing[0].optimizer, bOptimizer);
assert.deepEqual(/** @type {{charts:{mode:string}[]}} */ (/** @type {unknown} */ (selectedWithoutChanceKeys.package)).charts.find((item) => item.mode === "flow"), /** @type {{charts:{mode:string}[]}} */ (/** @type {unknown} */ (bImported.package)).charts.find((item) => item.mode === "flow"));
assert.deepEqual((await service.loadPackage(bImported.handle)).package, bImported.package, "selection preview must not mutate stored B chart");
const bTraceEvents = /** @type {{conversionTrace:{boxing:{events:Record<string,unknown>[]}[]}}} */ (/** @type {unknown} */ (selectedWithoutChanceKeys.package)).conversionTrace.boxing[0].events;
assert.ok(bTraceEvents.some((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_punch_switched" && event.action === "emit"));
assert.ok(bTraceEvents.some((event) => /** @type {Record<string,unknown> | undefined} */ (event.repetition)?.kind === "repeated_guard_replaced" && event.action === "emit"));
const explicitlyOff = await service.reprocessBoxing(bImported.handle, { guardSpacing: 0.25, uppercutOppositeLane: false, anyOppositeLane: false, repeatedPunchSwitchChancePercent: 0, repeatedGuardReplaceChancePercent: 0 });
const offOptimizer = /** @type {{conversionTrace:{boxing:{optimizer:Record<string,unknown>}[]}}} */ (/** @type {unknown} */ (explicitlyOff.package)).conversionTrace.boxing[0].optimizer;
assert.equal(Object.hasOwn(offOptimizer, "repeatedPunchSwitchChancePercent"), false, "explicit zero overrides persisted punch chance");
assert.equal(Object.hasOwn(offOptimizer, "repeatedGuardReplaceChancePercent"), false, "explicit zero overrides persisted guard chance");
assert.notDeepEqual(chart(explicitlyOff.package).beats, chart(bImported.package).beats, "intentional reset produces old pattern");
const partialOff = await service.reprocessBoxing(bImported.handle, { repeatedPunchSwitchChancePercent: 0, guardSpacing: 0.25, uppercutOppositeLane: false, anyOppositeLane: false });
const partialOptimizer = /** @type {{conversionTrace:{boxing:{optimizer:Record<string,unknown>}[]}}} */ (/** @type {unknown} */ (partialOff.package)).conversionTrace.boxing[0].optimizer;
assert.equal(Object.hasOwn(partialOptimizer, "repeatedPunchSwitchChancePercent"), false);
assert.equal(partialOptimizer.repeatedGuardReplaceChancePercent, 100, "unspecified guard probability remains authored when punch probability explicitly zero");
assert.deepEqual((await service.loadPackage(bImported.handle)).package, bImported.package, "even explicit preview overrides do not modify persistence");
const kneeSourceBytes = new TextEncoder().encode(JSON.stringify({ version: "3.3.0", colorNotes: Array.from({ length: 8 }, (_, index) => [{ b: index * 2 + 1, x: 1, y: 1, c: 0, d: 8 }, { b: index * 2 + 1, x: 2, y: 1, c: 1, d: 8 }]).flat(), bombNotes: [], obstacles: [], sliders: [], burstSliders: [] }));
const kneeSource = { ...source, readEntry(path) { return path.toLowerCase() === "hard.dat" ? Uint8Array.from(kneeSourceBytes) : Uint8Array.from(entries.get(path.toLowerCase())); } };
const kneeImported = await service.convertAndPersist({ source: kneeSource }, { difficulty: "Hard", sourceId: "reprocess-knee", sourceVersionHash: "abc", includeAudio: true, cacheSourceEntries: true, converterSettings: { kneeStrikeChancePercent: 100 } });
const kneeCharts = (pkg) => /** @type {{charts:{mode:string,beats:{type:string}[]}[],conversionTrace:{boxing:{optimizer:Record<string,unknown>}[]}}} */ (/** @type {unknown} */ (pkg));
const kneeSelected = await service.reprocessBoxing(kneeImported.handle, { guardSpacing: 0.25 });
assert.equal(kneeSelected.packageHash, `sha256:${kneeImported.handle.packageHash.value}`, "omitting knee chance on cached preview retains both persisted variants");
assert.equal(kneeCharts(kneeSelected.package).conversionTrace.boxing[1].optimizer.kneeStrikeChancePercent, 100);
assert.equal(kneeCharts(kneeSelected.package).charts[1].beats.filter((beat) => beat.type.startsWith("knee_")).length, 8);
const kneeOff = await service.reprocessBoxing(kneeImported.handle, { guardSpacing: 0.25, kneeStrikeChancePercent: 0 });
assert.equal(Object.hasOwn(kneeCharts(kneeOff.package).conversionTrace.boxing[1].optimizer, "kneeStrikeChancePercent"), false);
assert.equal(kneeCharts(kneeOff.package).charts[1].beats.filter((beat) => beat.type.startsWith("knee_")).length, 0);
assert.deepEqual(kneeCharts(kneeOff.package).charts[0].beats, kneeCharts(kneeImported.package).charts[0].beats, "explicit zero only alters knee variant");
assert.deepEqual((await service.loadPackage(kneeImported.handle)).package, kneeImported.package, "cached previews never alter stored knee choice");
const uncached = await service.convertAndPersist({ source }, { difficulty: "Hard", sourceId: "reprocess-uncached", sourceVersionHash: "abc", includeAudio: true });
await assert.rejects(() => service.reprocessBoxing(uncached.handle, { uppercutOppositeLane: true }), (error) => Boolean(error && typeof error === "object" && "code" in error && error.code === "source_cache_unavailable"));
service.destroy();
console.log("Cached current-difficulty Boxing reprocess preserves Flow, audio, and persistent collection; both lanes and idempotence verified.");
