// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalConverterProfile,
  canonicalJson,
  convertDifficulty,
  createAeroWebContentAuthoringService,
  createInlineAuthoringWorkerAdapter,
  createMemoryPersistenceAdapter,
  normalizeConverterProfile,
  prefixedSha256,
  prototypeReachConverterProfile,
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
const profiles = [];
for (const value of fixture.converterProfiles) profiles.push(await normalizeConverterProfile(value));
assert.deepEqual(profiles, [canonicalConverterProfile, prototypeReachConverterProfile]);

const encoder = new TextEncoder();
const audioBytes = Uint8Array.from([65, 69, 82, 79, 66, 69, 65, 84, 11]);
const audioHash = await prefixedSha256(audioBytes);
const results = {};
for (const format of ["v2", "v3", "v4"]) {
  const formatFixture = fixture.formats[format];
  assert.match(formatFixture.sourceVersionHash, /^[0-9a-f]{40}$/u, "synthetic source version identity must retain BeatSaver SHA-1 shape");
  const difficultyBytes = encoder.encode(JSON.stringify(formatFixture.beatmap));
  const difficultyHash = await prefixedSha256(difficultyBytes);
  const expectedIds = [
    `ab-chart-task-11-${format}-boxing-hard-semantic-track-row-family`,
    `ab-chart-task-11-${format}-boxing-hard-spatial-grid-row-family`,
    `ab-chart-task-11-${format}-boxing-hard-semantic-track-cut-family`,
    `ab-chart-task-11-${format}-boxing-hard-spatial-grid-cut-family`,
    `ab-chart-task-11-${format}-flow-hard`
  ];
  const profileResults = {};
  let canonicalPackage = null;
  for (const converterProfile of profiles) {
    const semanticHashes = [];
    const packageHashes = [];
    for (const modifierSet of fixture.requestedModifierSets) {
      const source = sourceBundle(format, formatFixture.sourceBeatmapVersion, difficultyBytes, audioBytes);
      const persistence = createMemoryPersistenceAdapter({ quotaBytes: 64 * 1024 * 1024 });
      const service = createAeroWebContentAuthoringService({ persistence, now: () => 11 });
      const sourceId = `task11-matrix-${format}`;
      const sourceVersionHash = formatFixture.sourceVersionHash;
      const authored = await service.convertAndPersist({ providerId: "synthetic", sourceHash: sourceVersionHash, source }, {
        difficulty: fixture.difficulty,
        sourceProvider: "synthetic",
        sourceId,
        sourceVersionHash,
        expectedAudioContentHash: audioHash,
        expectedDifficultyContentHashes: { "Hard.dat": difficultyHash },
        modifiers: modifierSet,
        converterProfile,
        includeAudio: true
      });
      const validation = await validateAuthoredPackage(authored.package);
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
      const packageRecord = /** @type {{source: Record<string, unknown>, charts: {chartId:string,mode:string,prototype?:Record<string,unknown>,beats:Record<string,unknown>[]}[], conversionTrace:Record<string,unknown>}} */ (authored.package);
      assert.equal(packageRecord.charts.length, 5);
      assert.deepEqual(packageRecord.charts.map((chart) => chart.chartId), expectedIds);
      assert.equal(packageRecord.charts.filter((chart) => chart.mode === "boxing").length, 4);
      assert.equal(packageRecord.charts.filter((chart) => chart.mode === "flow").length, 1);
      assert.equal(packageRecord.source.sourceId, sourceId);
      assert.equal(packageRecord.source.sourceVersionHash, sourceVersionHash);
      assert.deepEqual(packageRecord.source.converterProfile, converterProfile);
      assert.deepEqual(packageRecord.conversionTrace.converterProfile, converterProfile);
      const boxingTrace = /** @type {Record<string,unknown>[]} */ (packageRecord.conversionTrace.boxing);
      assert.equal(boxingTrace.every((trace) => canonicalJson(trace.converterProfile) === canonicalJson(converterProfile)), true);
      const flow = packageRecord.charts.find((chart) => chart.mode === "flow");
      const flowTypes = new Set(flow?.beats.map((beat) => beat.type));
      for (const type of ["note", "bomb", "obstacle", "arc"]) assert.equal(flowTypes.has(type), true, `${format} Flow must retain ${type}`);
      assert.equal(flowTypes.has("burst"), format !== "v2", `${format} burst support must be truthful`);
      for (const chart of packageRecord.charts.filter((entry) => entry.mode === "boxing")) {
        const prototype = /** @type {Record<string, unknown>} */ (chart.prototype);
        assert.deepEqual(prototype.converterProfile, converterProfile);
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
      packageHashes.push(authored.handle.packageHash.value);
      if (converterProfile.profileId === canonicalConverterProfile.profileId && modifierSet.length === 0) canonicalPackage = structuredClone(authored.package);
      if (converterProfile.profileId === prototypeReachConverterProfile.profileId && modifierSet.length === 0) {
        assert.notEqual(parity, profileResults[canonicalConverterProfile.profileId].semanticHashes[0], "converter profile hash/settings must participate in semantic identity");
        assert.notEqual(authored.handle.packageHash.value, profileResults[canonicalConverterProfile.profileId].packageHashes[0], "converter profile hash/settings must participate in package identity");
        const preserved=/** @type {{source:{converterProfile:{contentHash:string}}}|null} */(canonicalPackage);assert.equal(preserved?.source.converterProfile.contentHash, canonicalConverterProfile.contentHash, "profile selection alone must not rewrite existing package provenance");
      }
      const loaded = await service.loadPackage(authored.handle);
      assert.deepEqual(loaded.package, authored.package);
      assert.deepEqual(await service.readAsset(authored.handle, "song.ogg"), audioBytes);
      assert.equal(await service.deletePackage(authored.handle), true);
      assert.equal((await service.listPackages()).length, 0);
      service.destroy();
    }
    assert.deepEqual(semanticHashes, formatFixture.expectedSemanticHashes[converterProfile.profileId], `${format} ${converterProfile.profileId} semantic hashes must match stored fixture truth`);
    profileResults[converterProfile.profileId] = { semanticHashes, packageHashes };
  }
  results[format] = profileResults;
}

await assertMaterialProfileDifference();
await assertMalformedProfiles();
await assertWorkerProfileHashMismatch();
await assertFinalWorkerProfileBinding();
await assertStaleProfileResponse();
console.log(`Task 11 source matrix ${fixtureHash} passed: ${JSON.stringify(results)}`);

async function assertMalformedProfiles() {
  await assert.rejects(()=>normalizeConverterProfile({...prototypeReachConverterProfile,contentHash:"0".repeat(64)}),coded("converter_profile_hash_mismatch"));
  await assert.rejects(()=>normalizeConverterProfile({...prototypeReachConverterProfile,class:"live_visual"}),coded("converter_profile_invalid"));
  await assert.rejects(()=>normalizeConverterProfile({...prototypeReachConverterProfile,settings:{guardRelocationRadius:9,reachAllowanceSubcells:1}}),coded("converter_profile_settings_invalid"));
  await assert.rejects(()=>normalizeConverterProfile({...prototypeReachConverterProfile,settings:{...prototypeReachConverterProfile.settings,unexpected:1}}),coded("converter_profile_settings_invalid"));
}

async function assertWorkerProfileHashMismatch() {
  const formatFixture=fixture.formats.v3;const difficultyBytes=encoder.encode(JSON.stringify(formatFixture.beatmap));const difficultyHash=await prefixedSha256(difficultyBytes);const honest=createInlineAuthoringWorkerAdapter();
  const worker={kind:"inline",async convert(request,runtime={}){const changed=structuredClone(request);changed.options.converterProfile.contentHash="0".repeat(64);return honest.convert(changed,runtime);},destroy(){honest.destroy();}};
  const persistence=createMemoryPersistenceAdapter({quotaBytes:64*1024*1024});const service=createAeroWebContentAuthoringService({worker,persistence,now:()=>11});const source=sourceBundle("v3",formatFixture.sourceBeatmapVersion,difficultyBytes,audioBytes);
  await assert.rejects(()=>service.convertAndPersist({providerId:"synthetic",sourceHash:formatFixture.sourceVersionHash,source},{difficulty:fixture.difficulty,sourceProvider:"synthetic",sourceId:"task11-matrix-v3",sourceVersionHash:formatFixture.sourceVersionHash,expectedAudioContentHash:audioHash,expectedDifficultyContentHashes:{"Hard.dat":difficultyHash},converterProfile:prototypeReachConverterProfile,includeAudio:true}),coded("converter_profile_hash_mismatch"));
  assert.equal((await service.listPackages()).length,0,"Worker profile hash mismatch must not persist");service.destroy();
}

async function assertFinalWorkerProfileBinding() {
  const formatFixture=fixture.formats.v3;const difficultyBytes=encoder.encode(JSON.stringify(formatFixture.beatmap));const difficultyHash=await prefixedSha256(difficultyBytes);const honest=createInlineAuthoringWorkerAdapter();
  const worker={kind:"inline",async convert(request,runtime={}){const changed=structuredClone(request);changed.options.converterProfile=structuredClone(canonicalConverterProfile);return honest.convert(changed,runtime);},destroy(){honest.destroy();}};
  const persistence=createMemoryPersistenceAdapter({quotaBytes:64*1024*1024});const service=createAeroWebContentAuthoringService({worker,persistence,now:()=>11});const source=sourceBundle("v3",formatFixture.sourceBeatmapVersion,difficultyBytes,audioBytes);
  await assert.rejects(()=>service.convertAndPersist({providerId:"synthetic",sourceHash:formatFixture.sourceVersionHash,source},{difficulty:fixture.difficulty,sourceProvider:"synthetic",sourceId:"task11-matrix-v3",sourceVersionHash:formatFixture.sourceVersionHash,expectedAudioContentHash:audioHash,expectedDifficultyContentHashes:{"Hard.dat":difficultyHash},converterProfile:prototypeReachConverterProfile,includeAudio:true}),(error)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="worker_result_invalid"));
  assert.equal((await service.listPackages()).length,0,"profile-mismatched Worker result must not persist");service.destroy();
}

async function assertStaleProfileResponse() {
  const formatFixture=fixture.formats.v3;const difficultyBytes=encoder.encode(JSON.stringify(formatFixture.beatmap));const difficultyHash=await prefixedSha256(difficultyBytes);const honest=createInlineAuthoringWorkerAdapter();const arrivals=[deferred(),deferred()];const pending=[];
  const worker={kind:"inline",convert(request){const index=pending.length;return new Promise((resolve,reject)=>{pending.push({request:structuredClone(request),resolve,reject});arrivals[index].resolve();});},destroy(){honest.destroy();}};
  const persistence=createMemoryPersistenceAdapter({quotaBytes:64*1024*1024});const service=createAeroWebContentAuthoringService({worker,persistence,now:()=>11});const options={difficulty:fixture.difficulty,sourceProvider:"synthetic",sourceId:"task11-matrix-v3",sourceVersionHash:formatFixture.sourceVersionHash,expectedAudioContentHash:audioHash,expectedDifficultyContentHashes:{"Hard.dat":difficultyHash},includeAudio:true};
  const first=service.convertAndPersist({providerId:"synthetic",sourceHash:formatFixture.sourceVersionHash,source:sourceBundle("v3",formatFixture.sourceBeatmapVersion,difficultyBytes,audioBytes)},{...options,converterProfile:canonicalConverterProfile});const firstRejected=assert.rejects(first,coded("operation_aborted"));await arrivals[0].promise;
  const second=service.convertAndPersist({providerId:"synthetic",sourceHash:formatFixture.sourceVersionHash,source:sourceBundle("v3",formatFixture.sourceBeatmapVersion,difficultyBytes,audioBytes)},{...options,converterProfile:prototypeReachConverterProfile});await arrivals[1].promise;
  pending[1].resolve(await honest.convert(pending[1].request));const completed=await second;
  pending[0].resolve(await honest.convert(pending[0].request));await firstRejected;
  const records=await service.listPackages();assert.equal(records.length,1,"stale profile response must never persist");const loaded=await service.loadPackage(completed.handle);assert.equal((/** @type {{source:{converterProfile:{contentHash:string}}}} */(loaded.package)).source.converterProfile.contentHash,prototypeReachConverterProfile.contentHash,"newest regenerated profile provenance must win");service.destroy();
}

async function assertMaterialProfileDifference() {
  const summary = { colorNotes: [{ start: 0.6, cell: 1, hand: "left", direction: 2, sourceIndex: 0 }], bombNotes: [], obstacles: [], sliders: [], burstSliders: [] };
  const base = { difficulty: /** @type {const} */ ("Hard"), songToken: "profile-materiality", songName: "Profile Materiality", bpm: 120, sourceProvider: "synthetic", sourceId: "profile-materiality", sourceVersionHash: "0".repeat(40), sourceDifficultyPath: "Hard.dat", sourceBeatmapVersion: "v3" };
  const canonical = await convertDifficulty(summary, { ...base, converterProfile: canonicalConverterProfile });
  const reach = await convertDifficulty(summary, { ...base, converterProfile: prototypeReachConverterProfile });
  const canonicalPunches = canonical.charts.filter((chart) => chart.mode === "boxing").reduce((count, chart) => count + (/** @type {Record<string,unknown>[]} */ (chart.beats)).filter((beat) => String(beat.type).startsWith("hook_")).length, 0);
  const reachPunches = reach.charts.filter((chart) => chart.mode === "boxing").reduce((count, chart) => count + (/** @type {Record<string,unknown>[]} */ (chart.beats)).filter((beat) => String(beat.type).startsWith("hook_")).length, 0);
  assert.equal(canonicalPunches, 2);
  assert.equal(reachPunches, 4, "reachAllowanceSubcells must materially change regenerated output");
}

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

/** @param {string} code */
function coded(code){return(error)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code===code);}
function deferred(){let resolve=()=>undefined;const promise=new Promise((done)=>{resolve=()=>done(undefined);});return{promise,resolve};}
/** @param {string} left @param {string} right */
function compareCodePoints(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
