// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalJson,
  createAeroWebContentAuthoringService,
  createMemoryPersistenceAdapter,
  prefixedSha256,
  semanticParityHash,
  validateAuthoredPackage
} from "../src/index.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/task11-source-matrix-v1.json", import.meta.url), "utf8"));
const { fixtureHash, ...fixtureBody } = fixture;
assert.equal(fixture.schema, "aerobeat/task11_source_matrix");
assert.equal(fixture.version, 1);
assert.equal(fixture.fixtureId, "task11-source-matrix-v1");
assert.match(fixtureHash, /^sha256:[0-9a-f]{64}$/u);
assert.equal(await prefixedSha256(canonicalJson(fixtureBody)), fixtureHash, "fixture hash must exclude only fixtureHash");
assert.deepEqual(fixture.requestedModifierSets, [[], ["crossed_guard"], ["cross_body"], ["any_punch"], ["no_squats"], ["no_weaves"], ["any_punch", "cross_body", "crossed_guard", "no_squats", "no_weaves"]]);

const encoder = new TextEncoder();
const audioBytes = Uint8Array.from([65, 69, 82, 79, 66, 69, 65, 84, 11]);
const audioHash = await prefixedSha256(audioBytes);
const results = {};
for (const format of ["v2", "v3", "v4"]) {
  const formatFixture = fixture.formats[format];
  const difficultyBytes = encoder.encode(JSON.stringify(formatFixture.beatmap));
  const difficultyHash = await prefixedSha256(difficultyBytes);
  const expectedIds = [
    `ab-chart-task-11-${format}-boxing-hard-semantic-track-row-family`,
    `ab-chart-task-11-${format}-boxing-hard-spatial-grid-row-family`,
    `ab-chart-task-11-${format}-boxing-hard-semantic-track-cut-family`,
    `ab-chart-task-11-${format}-boxing-hard-spatial-grid-cut-family`,
    `ab-chart-task-11-${format}-flow-hard`
  ];
  const semanticHashes = [];
  for (const modifierSet of fixture.requestedModifierSets) {
    const source = sourceBundle(format, formatFixture.sourceBeatmapVersion, difficultyBytes, audioBytes);
    const persistence = createMemoryPersistenceAdapter({ quotaBytes: 64 * 1024 * 1024 });
    const service = createAeroWebContentAuthoringService({ persistence, now: () => 11 });
    const sourceId = `task11-matrix-${format}`;
    const sourceVersionHash = `task11-${format}-synthetic-v1`;
    const authored = await service.convertAndPersist({ providerId: "synthetic", sourceHash: sourceVersionHash, source }, {
      difficulty: fixture.difficulty,
      sourceProvider: "synthetic",
      sourceId,
      sourceVersionHash,
      expectedAudioContentHash: audioHash,
      expectedDifficultyContentHashes: { "Hard.dat": difficultyHash },
      modifiers: modifierSet,
      includeAudio: true
    });
    assert.equal((await validateAuthoredPackage(authored.package)).valid, true);
    const packageRecord = /** @type {{source: Record<string, unknown>, charts: {chartId:string,mode:string,prototype?:Record<string,unknown>,beats:Record<string,unknown>[]}[], conversionTrace:Record<string,unknown>}} */ (authored.package);
    assert.equal(packageRecord.charts.length, 5);
    assert.deepEqual(packageRecord.charts.map((chart) => chart.chartId), expectedIds);
    assert.equal(packageRecord.charts.filter((chart) => chart.mode === "boxing").length, 4);
    assert.equal(packageRecord.charts.filter((chart) => chart.mode === "flow").length, 1);
    assert.equal(packageRecord.source.sourceId, sourceId);
    assert.equal(packageRecord.source.sourceVersionHash, sourceVersionHash);
    const flow = packageRecord.charts.find((chart) => chart.mode === "flow");
    const flowTypes = new Set(flow?.beats.map((beat) => beat.type));
    for (const type of ["note", "bomb", "obstacle", "arc"]) assert.equal(flowTypes.has(type), true, `${format} Flow must retain ${type}`);
    assert.equal(flowTypes.has("burst"), format !== "v2", `${format} burst support must be truthful`);
    for (const chart of packageRecord.charts.filter((entry) => entry.mode === "boxing")) {
      const prototype = /** @type {Record<string, unknown>} */ (chart.prototype);
      assert.match(String(prototype.contentHash), /^sha256:[0-9a-f]{64}$/u);
      assert.match(String(prototype.recipeHash), /^sha256:[0-9a-f]{64}$/u);
      assert.match(String(prototype.rulesetHash), /^sha256:[0-9a-f]{64}$/u);
      const emitted = chart.beats.flatMap((beat) => typeof beat.modifier === "string" ? [beat.modifier] : []);
      const expectedModifiers = [...new Set([...modifierSet, ...emitted])].sort(compareCodePoints);
      assert.deepEqual(prototype.modifiers, expectedModifiers, "chart identity is requested + emitted modifier union");
      assertUniqueLineage(chart.beats);
      const types = new Set(chart.beats.map((beat) => beat.type));
      for (const type of ["straight_left", "straight_right", "hook_left", "hook_right", "uppercut_left", "uppercut_right", "guard"]) assert.equal(types.has(type), true, `${format} must cover ${type}`);
      if (!modifierSet.includes("no_squats") && !modifierSet.includes("no_weaves")) assert.ok([...types].some((type) => String(type).startsWith("weave_") || type === "squat"));
    }
    const parity = await semanticParityHash(authored.package);
    semanticHashes.push(parity);
    const loaded = await service.loadPackage(authored.handle);
    assert.deepEqual(loaded.package, authored.package);
    assert.deepEqual(await service.readAsset(authored.handle, "song.ogg"), audioBytes);
    assert.equal(await service.deletePackage(authored.handle), true);
    assert.equal((await service.listPackages()).length, 0);
    service.destroy();
  }
  const rerunSource = sourceBundle(format, formatFixture.sourceBeatmapVersion, difficultyBytes, audioBytes);
  const rerun = createAeroWebContentAuthoringService({ persistence: createMemoryPersistenceAdapter({ quotaBytes: 64 * 1024 * 1024 }), now: () => 11 });
  const repeated = await rerun.convertAndPersist({ providerId: "synthetic", sourceHash: `task11-${format}-synthetic-v1`, source: rerunSource }, { difficulty: fixture.difficulty, sourceProvider: "synthetic", sourceId: `task11-matrix-${format}`, sourceVersionHash: `task11-${format}-synthetic-v1`, expectedAudioContentHash: audioHash, expectedDifficultyContentHashes: { "Hard.dat": difficultyHash }, modifiers: fixture.requestedModifierSets[0], includeAudio: true });
  assert.equal(await semanticParityHash(repeated.package), semanticHashes[0], `${format} semantic hash must be stable`);
  rerun.destroy();
  results[format] = { baseSemanticHash: semanticHashes[0], modifierSemanticHashes: semanticHashes };
}

console.log(`Task 11 source matrix ${fixtureHash} passed: ${JSON.stringify(results)}`);

/** @param {string} format @param {string} version @param {Uint8Array} difficultyBytes @param {Uint8Array} audio */
function sourceBundle(format, version, difficultyBytes, audio) {
  const major = Number(format.slice(1));
  const entries = new Map([["Hard.dat", Uint8Array.from(difficultyBytes)], ["song.ogg", Uint8Array.from(audio)]]);
  return Object.freeze({
    manifest: Object.freeze({ schemaId: "aerobeat.beatsaver-source.v1", sourceFormatMajor: major, infoPath: "Info.dat", songName: `Task 11 ${format}`, songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat", bpm: 120, audioPath: "song.ogg", sourceBeatmapVersion: version, difficulties: Object.freeze([Object.freeze({ characteristic: "Standard", difficulty: "Hard", path: "Hard.dat" })]) }),
    listEntryPaths() { return Object.freeze(["Hard.dat", "song.ogg"]); },
    readEntry(path) { const bytes = entries.get(path); if (!bytes) throw new Error("missing synthetic entry"); return Uint8Array.from(bytes); }
  });
}

/** @param {Record<string, unknown>[]} beats */
function assertUniqueLineage(beats) {
  const eventIds = new Set();
  const sourceOwners = new Map();
  for (const beat of beats) {
    assert.equal(typeof beat.eventId, "string");
    assert.equal(eventIds.has(beat.eventId), false, "event IDs must be unique");
    eventIds.add(beat.eventId);
    assert.ok(Array.isArray(beat.sourceEventIds) && beat.sourceEventIds.length > 0);
    for (const sourceEventId of beat.sourceEventIds) {
      assert.equal(typeof sourceEventId, "string");
      const owner = sourceOwners.get(sourceEventId);
      assert.ok(owner === undefined || owner === beat.eventId, "source lineage cannot be ambiguously owned");
      sourceOwners.set(sourceEventId, beat.eventId);
    }
  }
}

/** @param {string} left @param {string} right */
function compareCodePoints(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
