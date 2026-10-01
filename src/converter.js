// @ts-check

import { deriveObstacleGridMask, isObstacleGameplayGeometry, maximumObstaclesPerChart } from "@aerobeat/web-contracts/obstacle-contracts";
import { isAuthoredObstacleSourceGeometry } from "./obstacle-source-geometry.js";
import { canonicalJson, cloneData, deepFreeze, prefixedSha256 } from "./canonical.js";
import { normalizeConverterProfile } from "./converter-profile.js";
import { createAuthoredNotePalette, flowPaletteReference, verifySourceNotePalette } from "./note-palette.js";
import { verifyBeatSaberSpawnTiming } from "./spawn-timing.js";
import { authoredPackageSchemaId, authoredPackageSchemaVersion, authoredPackageVersion, flowChartSchemaId, flowChartSchemaVersion, flowCollidersRulesetId, flowContentIdentity, flowRulesetVariants } from "./flow-contract.js";
import {
  boxingPrototypeContractId,
  cutFamilyRecipeId,
  freshnessMs,
  guardPairs,
  punchMinSpacingMs,
  reachSubcellsPerBeat,
  recipeDefinitions,
  recipeVersion,
  rowFamilyRecipeId,
  rulesetDefinitions,
  rulesetVersion,
  straightQualificationMs,
  supportedModifiers,
  timingWindowMs
} from "./definitions.js";

// z7nw — New imports emit exactly one Boxing variant: the collider ruleset
// (the sole newly-created Boxing option per the 2026-09-11 design doc §5/§6).
// It carries no conversion recipe identity; legacy stored Lanes/Grid matrices remain readable.
const colliderRulesetId = "boxing_collider_v1";

/** @typedef {"Easy" | "Normal" | "Hard" | "Expert" | "ExpertPlus"} Difficulty */
/** @typedef {Record<string, unknown>} DataRecord */

/**
 * Convert one normalized difficulty into Flow plus four Boxing charts.
 *
 * @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} sourceSummary
 * @param {{difficulty: Difficulty, songToken: string, songName: string, bpm: number, noteJumpMovementSpeed: number, noteJumpStartBeatOffset: number, spawnTiming: unknown, sourceProvider: string, sourceId: string, sourceVersionHash: string, sourceInfoFormat: "v2"|"v4", sourceInfoVersion: string|null, sourceInfoHash: string, sourceDifficultyPath: string, sourceBeatmapFormat: "v2"|"v3"|"v4", sourceBeatmapVersion: string|null, sourceDifficultyHash: string, notePalette: unknown, audioPath?: string, audioContentHash?: string, modifiers?: readonly string[], presentationSuggestion?: Readonly<Record<string, unknown>>, converterProfile?: Readonly<Record<string, unknown>>, converterSettings?: Readonly<Record<string, unknown>>}} options
 * @param {(progress: number, phase: string) => void} [onProgress]
 * @returns {Promise<Readonly<{package: DataRecord, packageHash: string, sourceHash: string, charts: DataRecord[], traces: DataRecord[], flowTrace: DataRecord}>>}
 */
export async function convertDifficulty(sourceSummary, options, onProgress = () => undefined) {
  if(!Number.isFinite(options.bpm)||options.bpm<=0)throw new Error("spawn_timing_bpm_invalid");
  const bpm = options.bpm;
  const difficulty = normalizeDifficulty(options.difficulty);
  const songToken = sanitizeToken(options.songToken || options.sourceId || "imported");
  const modifiers = normalizeModifiers(options.modifiers ?? []);
  const converterProfile = options.converterProfile ? await normalizeConverterProfile(options.converterProfile) : null;
  const sourceHash = await prefixedSha256(canonicalJson(sourceSummary));
  const sourceDifficultyHash = options.sourceDifficultyHash;
  const spawnTiming = verifyBeatSaberSpawnTiming(options.spawnTiming);
  if (spawnTiming.bpm !== bpm || spawnTiming.noteJumpMovementSpeed !== options.noteJumpMovementSpeed || spawnTiming.noteJumpStartBeatOffset !== options.noteJumpStartBeatOffset) throw new Error("spawn_timing_mismatch");
  const verifiedSourcePalette = verifySourceNotePalette(options.notePalette, { infoFormat: options.sourceInfoFormat, infoHash: options.sourceInfoHash, difficultyHash: sourceDifficultyHash });
  const notePalette = await createAuthoredNotePalette(verifiedSourcePalette);
  const charts = [];
  const traces = [];
  // z7nw — the collider variant is single-variant and reach mapping happens at render/judge
  // time, so its authored rows come from the row-family "Balanced Height" generation
  // (balance_generated_rows, the first frozen recipe definition). The cut-family call was dropped.
  const boxing = await reprocessBoxingChart(sourceSummary, options);
  const chart = boxing.chart;
  charts.push(chart);
  traces.push(boxing.trace);

  onProgress(0.45, "converting");
  const flow = await convertFlowChart(sourceSummary, difficulty, songToken, notePalette);
  Object.assign(flow.trace, { sourceHash, sourceInfoFormat: options.sourceInfoFormat, sourceInfoVersion: options.sourceInfoVersion, sourceInfoHash: options.sourceInfoHash, sourceDifficultyPath: options.sourceDifficultyPath, sourceBeatmapFormat: options.sourceBeatmapFormat, sourceBeatmapVersion: options.sourceBeatmapVersion, sourceDifficultyHash, spawnTiming: cloneData(spawnTiming) });
  charts.push(flow.chart);
  const packageId = `ab-songpkg-${songToken}-${sanitizeToken(options.sourceVersionHash).slice(0, 12)}-${difficulty.toLowerCase()}`;
  const songId = `ab-song-${songToken}`;
  const sets = charts.map((chart) => ({ schemaId: "aerobeat.set.v1", schemaVersion: 1, recordVersion: 1, setId: `ab-set-${String(chart.chartId).replace(/^ab-chart-/u, "")}`, setName: `${titleize(songToken)} ${difficulty} ${titleize(String(chart.mode))}`, songId, chartId: chart.chartId }));
  const durationSec = estimateDuration(charts, bpm);
  const packageRecord = {
    schemaId: authoredPackageSchemaId,
    schemaVersion: authoredPackageSchemaVersion,
    packageVersion: authoredPackageVersion,
    packageId,
    songId,
    songName: options.songName || titleize(songToken),
    source: {
      provider: options.sourceProvider,
      sourceId: options.sourceId,
      sourceVersionHash: options.sourceVersionHash,
      difficulty,
      sourceInfoFormat: options.sourceInfoFormat,
      sourceInfoVersion: options.sourceInfoVersion,
      sourceInfoHash: options.sourceInfoHash,
      sourceDifficultyPath: options.sourceDifficultyPath,
      sourceBeatmapFormat: options.sourceBeatmapFormat,
      sourceBeatmapVersion: options.sourceBeatmapVersion,
      sourceDifficultyHash,
      sourceHash,
      spawnTiming: cloneData(spawnTiming),
      obstacleContract: "normalized_obstacle_v2",
      ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {})
    },
    notePalette,
    song: {
      schemaId: "aerobeat.song.v1",
      schemaVersion: 1,
      recordVersion: 1,
      songId,
      songName: options.songName || titleize(songToken),
      durationSec,
      ...(options.audioPath && options.audioContentHash ? { audio: { filePath: options.audioPath, contentHash: options.audioContentHash } } : {}),
      timing: { anchorMs: 0, tempoSegments: [{ startBeat: 0, bpm }], stopSegments: [], timeSignatureSegments: [{ startBeat: 0, numerator: 4, denominator: 4 }] }
    },
    charts,
    sets,
    recipeDefinitions: cloneData(recipeDefinitions),
    rulesetDefinitions: cloneData(rulesetDefinitions),
    conversionTrace: { notePalette: flowPaletteReference(notePalette), spawnTiming: cloneData(spawnTiming), boxing: traces, flow: [flow.trace], ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}) },
    presentationSuggestion: options.presentationSuggestion ? cloneData(options.presentationSuggestion) : null
  };
  const packageHash = await prefixedSha256(canonicalJson(packageRecord));
  onProgress(0.8, "validating");
  return deepFreeze({ package: packageRecord, packageHash, sourceHash, charts, traces, flowTrace: flow.trace });
}

/** Regenerate only the selected difficulty's Boxing chart and trace from normalized source. */
export async function reprocessBoxingChart(sourceSummary, options) {
  const difficulty = normalizeDifficulty(options.difficulty);
  const bpm = options.bpm;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("spawn_timing_bpm_invalid");
  const spawnTiming = verifyBeatSaberSpawnTiming(options.spawnTiming);
  if (spawnTiming.bpm !== bpm || spawnTiming.noteJumpMovementSpeed !== options.noteJumpMovementSpeed || spawnTiming.noteJumpStartBeatOffset !== options.noteJumpStartBeatOffset) throw new Error("spawn_timing_mismatch");
  const converterProfile = options.converterProfile ? await normalizeConverterProfile(options.converterProfile) : null;
  const profileSettings = converterProfile ? /** @type {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing?:number,uppercutOppositeLane?:boolean,anyOppositeLane?:boolean}} */ (converterProfile.settings) : null;
  const settings = /** @type {{guardSpacing?:number,uppercutOppositeLane?:boolean,anyOppositeLane?:boolean,maxObstacleDurationMs?:number,obstacleCooldownMs?:number}} */ (options.converterSettings ?? {});
  const converterSettings = /** @type {{uppercutOppositeLane:boolean,anyOppositeLane:boolean,guardSpacing:number,maxObstacleDurationMs:number,obstacleCooldownMs:number,guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} */ ({
    uppercutOppositeLane: settings.uppercutOppositeLane ?? profileSettings?.uppercutOppositeLane ?? false,
    // 0.0.89 (Derrick): ONLY hooks stay in the opposite handiness lane.
    anyOppositeLane: settings.anyOppositeLane ?? profileSettings?.anyOppositeLane ?? false,
    guardSpacing: settings.guardSpacing ?? profileSettings?.guardSpacing ?? 0.25,
    // 0.0.89 (Derrick): Boxing obstacle rules. Both bake at import time, so a change
    // needs a reimport. Surfaced in Game Setup for playtesting, locked in later.
    maxObstacleDurationMs: Number(settings.maxObstacleDurationMs ?? 3000),
    obstacleCooldownMs: Number(settings.obstacleCooldownMs ?? 4000),
    guardRelocationRadius: profileSettings?.guardRelocationRadius ?? 0,
    reachAllowanceSubcells: profileSettings?.reachAllowanceSubcells ?? 0,
    profileApplied: converterProfile !== null
  });
  const sourceHash = await prefixedSha256(canonicalJson(sourceSummary));
  const rowRecipe = /** @type {DataRecord} */ (recipeDefinitions.find((recipe) => String(recipe.recipeId) === rowFamilyRecipeId) ?? recipeDefinitions[0]);
  const modifiers = normalizeModifiers(options.modifiers ?? []);
  const generated = await generateEvents(sourceSummary, difficulty, bpm, rowRecipe, modifiers, converterSettings);
  const chart = await colliderChartFor(generated, rowRecipe, difficulty, sanitizeToken(options.songToken || options.sourceId || "imported"), sourceHash, modifiers, options.presentationSuggestion, converterProfile);
  const trace = {
    chartId: chart.chartId, difficulty, bpm, rulesetId: colliderRulesetId, sourceHash,
    contentHash: chart.prototype.contentHash,
    sourceInfoFormat: options.sourceInfoFormat, sourceInfoVersion: options.sourceInfoVersion,
    sourceInfoHash: options.sourceInfoHash, sourceDifficultyPath: options.sourceDifficultyPath,
    sourceBeatmapFormat: options.sourceBeatmapFormat, sourceBeatmapVersion: options.sourceBeatmapVersion,
    sourceDifficultyHash: options.sourceDifficultyHash, spawnTiming: cloneData(spawnTiming),
    ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}),
    optimizer: cloneData(generated.optimizer), events: cloneData(generated.trace)
  };
  return deepFreeze({ chart, trace, sourceHash });
}

/** @param {DataRecord} generated @param {DataRecord} recipe @param {Difficulty} difficulty @param {string} songToken @param {string} sourceHash @param {readonly string[]} modifiers @param {Readonly<Record<string, unknown>> | undefined} suggestion @param {Readonly<Record<string, unknown>> | null} converterProfile */
async function colliderChartFor(generated, recipe, difficulty, songToken, sourceHash, modifiers, suggestion, converterProfile) {
  const beats = cloneData(generated.beats);
  // Provenance only: recipeHash identifies which generation produced the authored rows.
  // The single collider variant carries no conversion-recipe identity, so recipeId is absent from the prototype and its content hash.
  const recipeHash = await prefixedSha256(canonicalJson(recipe));
  const rulesetHash = await prefixedSha256(canonicalJson({ contractId: boxingPrototypeContractId, rulesetId: colliderRulesetId, version: rulesetVersion }));
  const contentHash = await prefixedSha256(canonicalJson({ beats, sourceHash, rulesetId: colliderRulesetId, ...(converterProfile ? { converterProfile } : {}) }));
  const allModifiers = [...modifiers];
  for (const beat of /** @type {DataRecord[]} */ (beats)) {
    if (typeof beat.modifier === "string" && !allModifiers.includes(beat.modifier)) allModifiers.push(beat.modifier);
  }
  allModifiers.sort();
  const chart = {
    schemaId: "aerobeat.chart.boxing.v1", schemaVersion: 1, recordVersion: 1,
    chartId: `ab-chart-${songToken}-boxing-collider-${difficulty.toLowerCase()}`,
    chartName: `${titleize(songToken)} ${difficulty} Boxing - Collider`,
    mode: "boxing", difficulty,
    prototype: { contractId: boxingPrototypeContractId, recipeVersion, rulesetId: colliderRulesetId, rulesetVersion, sourceHash, recipeHash, rulesetHash, contentHash, modifiers: allModifiers, ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}), regenerationRequiredFor: ["punchMinSpacingMs", "reachSubcellsPerBeat", "familyBalance", "guardRelocation"] },
    beats
  };
  if (suggestion) Object.assign(chart, { presentationSuggestion: cloneData(suggestion) });
  return chart;
}

/** @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} sourceSummary @param {Difficulty} difficulty @param {number} bpm @param {DataRecord} recipe @param {readonly string[]} modifiers @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing:number,profileApplied:boolean,uppercutOppositeLane?:boolean,anyOppositeLane?:boolean}} converterSettings */
async function generateEvents(sourceSummary, difficulty, bpm, recipe, modifiers, converterSettings) {
  const trace = [];
  const obstacleWindows = obstaclesFor(sourceSummary.obstacles ?? [], bpm);
  const groups = noteGroups(sourceSummary.colorNotes ?? []);
  const candidates = [];
  const rowCounts = [0, 0, 0];
  for (const [start, rawGroup] of groups) {
    const group = collapseSameHand(rawGroup);
    const sourceEventIds = sourceIds(rawGroup, "note");
    const retainedIds = sourceIds(group, "note");
    for (const sourceId of sourceEventIds) if (!retainedIds.includes(sourceId)) trace.push({ sourceEventIds: [sourceId], start, action: "drop", reason: "same_hand_simultaneous_stable_tiebreak" });
    if (hasBothHands(group)) { candidates.push({ kind: "guard", start, notes: group, sourceEventIds, stableId: sourceEventIds.join("+") }); continue; }
    if (!group.length) continue;
    const note = group[0]; const family = familyFor(note, String(recipe.recipeId)); const targetRow = targetRowFor(note, family, String(recipe.recipeId), rowCounts);
    rowCounts[targetRow] += 1;
    candidates.push({ kind: "punch", start, note, family, targetRow, sourceEventIds, stableId: sourceEventIds.join("+") });
  }
  candidates.sort(candidateOrder);
  const optimizer = selectSpacingOptimizedPunches(candidates, bpm, obstacleWindows, difficulty, converterSettings);
  const beats = [];
  let lastPunchMs = -1e9; let previousHand = "";
  const wristSubcell = { left: seedSubcell(5), right: seedSubcell(6) }; const wristBeat = { left: 0, right: 0 };
  const familyCounts = { straight: 0, hook: 0, uppercut: 0 };
  // 0.0.89 (Derrick): resolve the obstacle set ONCE and use the SAME set for punch
  // blocking and obstacle emission, so every rule sees the final obstacles.
  const resolvedObstacleWindows = resolveBoxingObstacles(obstacleWindows, {
    maxObstacleDurationMs: Number(converterSettings["maxObstacleDurationMs"] ?? 3000),
    obstacleCooldownMs: Number(converterSettings["obstacleCooldownMs"] ?? 4000),
    msPerBeat: 60000 / bpm
  }, obstacleType);
  const obstacleWindowActive = (timeMs) => resolvedObstacleWindows.some((window) => timeMs >= window.startMs && timeMs <= window.endMs);
  for (const candidate of candidates) {
    const start = Number(candidate.start); const startMs = beatToMs(start, bpm);
    if (candidate.kind === "guard") {
      const emitted = await emitGuard(candidate, wristSubcell, wristBeat, difficulty, String(recipe.recipeId), converterSettings);
      trace.push(emitted.trace);
      if (emitted.ok && emitted.beat) {
        beats.push(emitted.beat); const target = emitted.beat.guardTarget;
        wristSubcell.left = seedSubcell(Number(target.leftCell)); wristSubcell.right = seedSubcell(Number(target.rightCell)); wristBeat.left = start; wristBeat.right = start;
      }
      continue;
    }
    if (!optimizer.selected.has(String(candidate.stableId))) { trace.push(dropTrace(candidate, optimizer.infeasible.get(String(candidate.stableId)) ?? "spacing_optimizer_rejected", { priorityOrder: optimizerPriority })); continue; }
    const note = /** @type {DataRecord} */ (candidate.note); const hand = String(note.hand); const family = String(candidate.family);
    // 0.0.89 (Derrick) rule 1: no punch may be authored while a weave/squat is up.
    if (obstacleWindowActive(startMs)) { trace.push(dropTrace(candidate, "obstacle_window_active")); continue; }
    const spatial = spatialTarget(family, hand, Number(candidate.targetRow), { uppercutOppositeLane: converterSettings.uppercutOppositeLane, anyOppositeLane: converterSettings.anyOppositeLane, anyPunch: modifiers.includes("any_punch") }); const blocked = blockedSubcellsAt(startMs, resolvedObstacleWindows);
    const safe = /** @type {number[]} */ (spatial.acceptedSubcells).filter((subcell) => !blocked.has(subcell));
    if (!safe.length) { trace.push(dropTrace(candidate, "spatial_target_blocked")); continue; }
    spatial.acceptedSubcells = safe;
    if (startMs - lastPunchMs < punchMinSpacingMs) { trace.push(dropTrace(candidate, "punch_min_spacing", { previousHand, spacingMs: startMs - lastPunchMs })); continue; }
    const type = `${family}_${hand}`; const generatedEventId = await eventId(String(recipe.recipeId), String(candidate.stableId), type);
    const beat = { start, type, eventId: generatedEventId, sourceEventIds: cloneData(candidate.sourceEventIds), spatialTarget: spatial, timingWindowMs, evidenceFreshnessMs: freshnessMs };
    if (modifiers.includes("any_punch")) Object.assign(beat, { modifier: "any_punch" }); else if (modifiers.includes("cross_body")) Object.assign(beat, { modifier: "cross_body" });
    beats.push(beat); lastPunchMs = startMs; previousHand = hand; familyCounts[/** @type {"straight" | "hook" | "uppercut"} */ (family)] += 1; wristSubcell[/** @type {"left" | "right"} */ (hand)] = seedSubcell(spatial.targetCell); wristBeat[/** @type {"left" | "right"} */ (hand)] = start;
    trace.push({ sourceEventIds: beat.sourceEventIds, eventId: generatedEventId, start, action: "emit", kind: "punch", family, hand, sourceDirection: Number(note.direction ?? 8), generatedDirection: spatial.entryDirection ?? "semantic_straight", target: cloneData(spatial) });
  }
  for (const mergedWindow of resolvedObstacleWindows) {
    const window = /** @type {ObstacleWindow & {forcedType?:string}} */ (/** @type {unknown} */ (mergedWindow));
    const blockedCells = [...window.blockedCells]; const type = window.forcedType ?? obstacleType(blockedCells); const sourceId = `obstacle-${String(window.sourceIndex).padStart(3, "0")}`;
    if ((type === "squat" && modifiers.includes("no_squats")) || (type.startsWith("weave_") && modifiers.includes("no_weaves"))) { trace.push({ sourceEventIds: [sourceId], start: window.startBeat, action: "drop", reason: "disabled_by_modifier", type }); continue; }
    const safeCells = Array.from({ length: 12 }, (_, index) => index).filter((cell) => !blockedCells.includes(cell));
    // 2dh7 — feasibility gate: an obstacle with no reachable safe cell is undodgeable.
    // Drop it with a trace parallel to the punch drops (spatial_target_blocked /
    // unreachable_after_optimizer) instead of emitting an infeasible checkpoint.
    if (!safeCells.length) { trace.push({ sourceEventIds: [sourceId], start: window.startBeat, end: window.endBeat, action: "drop", reason: type === "squat" ? "squat_no_reachable_safe_cell" : "weave_no_reachable_safe_cell", type, gridMask: [...window.gridMask], blockedCells, noseSafeCells: [] }); continue; }
    const emitted = { start: window.startBeat, end: window.endBeat, type, eventId: await eventId(String(recipe.recipeId), sourceId, type), sourceEventIds: [sourceId], sourceGeometry: cloneData(window.sourceGeometry), gameplayGeometry: cloneData(window.gameplayGeometry), gridMask: [...window.gridMask], checkpoint: { kind: "instantaneous", freshnessMs, timingWindowMs, noseSafeCells: safeCells }, blockedCells };
    beats.push(emitted); trace.push({ sourceEventIds: [sourceId], start: window.startBeat, end: window.endBeat, action: "emit", kind: "obstacle_checkpoint", type, sourceGeometry: cloneData(window.sourceGeometry), gameplayGeometry: cloneData(window.gameplayGeometry), gridMask: [...window.gridMask], blockedCells, noseSafeCells: safeCells });
  }
  beats.sort((left, right) => Number(left.start) - Number(right.start) || String(left.eventId).localeCompare(String(right.eventId)));
  return { beats, trace, familyCounts, optimizer: { priorityOrder: optimizerPriority, punchMinSpacingMs, ...(converterSettings.profileApplied ? { guardRelocationRadius: converterSettings.guardRelocationRadius, reachAllowanceSubcells: converterSettings.reachAllowanceSubcells } : {}), selectedStableIds: [...optimizer.selected.keys()] } };
}

const optimizerPriority = ["retained_punches", "hand_alternation", "family_balance", "source_order", "stable_event_id"];

/** @param {DataRecord[]} candidates @param {number} bpm @param {ObstacleWindow[]} obstacles @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing:number,profileApplied:boolean}} converterSettings */
function selectSpacingOptimizedPunches(candidates, bpm, obstacles, difficulty, converterSettings) {
  const punches = []; const infeasible = new Map();
  const guardTimesMs = candidates.filter((candidate) => candidate.kind === "guard").map((candidate) => beatToMs(Number(candidate.start), bpm));
  for (const candidate of candidates) { if (candidate.kind !== "punch") continue; const punchMs = beatToMs(Number(candidate.start), bpm); const reserved = guardTimesMs.some((guardMs) => Math.abs(punchMs - guardMs) <= timingWindowMs + 0.0001); const reason = reserved ? "guard_window_reserved_before_optimizer" : staticInfeasibility(candidate, bpm, obstacles, difficulty, converterSettings); if (reason) infeasible.set(String(candidate.stableId), reason); else punches.push(candidate); }
  punches.sort(candidateOrder); const best = [[]];
  for (let index = 0; index < punches.length; index += 1) {
    const candidate = punches[index]; let compatible = -1; const candidateMs = beatToMs(Number(candidate.start), bpm);
    for (let prior = index - 1; prior >= 0; prior -= 1) if (candidateMs - beatToMs(Number(punches[prior].start), bpm) >= punchMinSpacingMs) { compatible = prior; break; }
    const take = [...best[compatible + 1], candidate]; const skip = [...best[index]]; best.push(sequenceBetter(take, skip) ? take : skip);
  }
  return { selected: new Map(best.at(-1).map((candidate) => [String(candidate.stableId), true])), infeasible };
}

/** @param {DataRecord} candidate @param {number} bpm @param {ObstacleWindow[]} obstacles @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing:number,profileApplied:boolean,uppercutOppositeLane?:boolean,anyOppositeLane?:boolean}} converterSettings */
function staticInfeasibility(candidate, bpm, obstacles, difficulty, converterSettings) {
  const note = /** @type {DataRecord} */ (candidate.note); const hand = String(note.hand); const spatial = spatialTarget(String(candidate.family), hand, Number(candidate.targetRow), { uppercutOppositeLane: converterSettings.uppercutOppositeLane ?? false, anyOppositeLane: converterSettings.anyOppositeLane ?? true, anyPunch: false }); const blocked = blockedSubcellsAt(beatToMs(Number(candidate.start), bpm), obstacles);
  // 0.0.89 (Derrick): reachability removed. Only obstacle coverage matters now.
  for (const subcell of /** @type {number[]} */ (spatial.acceptedSubcells)) { if (!blocked.has(subcell)) return ""; }
  return "spatial_target_blocked_before_optimizer";
}

/** @param {DataRecord[]} left @param {DataRecord[]} right */
function sequenceBetter(left, right) {
  if (left.length !== right.length) return left.length > right.length;
  const alternations = (sequence) => sequence.slice(1).reduce((count, candidate, index) => count + (String(/** @type {DataRecord} */ (candidate.note).hand) !== String(/** @type {DataRecord} */ (sequence[index].note).hand) ? 1 : 0), 0);
  const imbalance = (sequence) => { const counts = { straight: 0, hook: 0, uppercut: 0 }; for (const candidate of sequence) counts[/** @type {"straight" | "hook" | "uppercut"} */ (String(candidate.family))] += 1; return Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)); };
  if (alternations(left) !== alternations(right)) return alternations(left) > alternations(right);
  if (imbalance(left) !== imbalance(right)) return imbalance(left) < imbalance(right);
  for (let index = 0; index < left.length; index += 1) { if (Number(left[index].start) !== Number(right[index].start)) return Number(left[index].start) < Number(right[index].start); if (String(left[index].stableId) !== String(right[index].stableId)) return String(left[index].stableId) < String(right[index].stableId); }
  return false;
}

/** @typedef {{startBeat:number,endBeat:number,startMs:number,endMs:number,sourceGeometry:import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleSourceGeometry,gameplayGeometry:import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry,gridMask:number[],blockedCells:number[],sourceIndex:number}} ObstacleWindow */
/** @param {readonly Readonly<Record<string, unknown>>[]} obstacles @param {number} bpm @returns {ObstacleWindow[]} */
function obstaclesFor(obstacles, bpm) {
  if (obstacles.length > maximumObstaclesPerChart) throw new Error("flow_obstacle_limit_exceeded");
  return obstacles.map((entry, index) => {
    const start = Number(entry.start);
    const duration = Number(entry.duration);
    const endBeat = start + duration;
    const resolvedEndMs = beatToMs(endBeat, bpm);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(endBeat) || resolvedEndMs > 86_400_000) throw new Error("flow_obstacle_interval_invalid");
    const geometry = normalizedGeometryForObstacle(entry);
    const gridMask = deriveObstacleGridMask(geometry.gameplayGeometry);
    return { startBeat: start, endBeat, startMs: beatToMs(start, bpm) - timingWindowMs, endMs: resolvedEndMs + timingWindowMs, sourceGeometry: geometry.sourceGeometry, gameplayGeometry: geometry.gameplayGeometry, gridMask: [...gridMask], blockedCells: [...gridMask], sourceIndex: Number(entry.sourceIndex ?? index) };
  });
}
/** @param {Readonly<Record<string, unknown>>} obstacle @returns {{sourceGeometry:import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleSourceGeometry,gameplayGeometry:import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry}} */
function normalizedGeometryForObstacle(obstacle) {
  const sourceGeometry = obstacle.sourceGeometry;
  const gameplayGeometry = obstacle.gameplayGeometry;
  if (!isAuthoredObstacleSourceGeometry(sourceGeometry) || !isObstacleGameplayGeometry(gameplayGeometry)) throw new Error("obstacle_geometry_invalid");
  return { sourceGeometry: /** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleSourceGeometry} */ (cloneData(sourceGeometry)), gameplayGeometry: /** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (cloneData(gameplayGeometry)) };
}
/** @param {Readonly<Record<string, unknown>>} obstacle */
function gridMaskForObstacle(obstacle) {
  const { gameplayGeometry } = normalizedGeometryForObstacle(obstacle);
  return deriveObstacleGridMask(/** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (gameplayGeometry));
}
/** @param {number} timeMs @param {ObstacleWindow[]} windows */
function blockedSubcellsAt(timeMs, windows) { const blocked = new Set(); for (const window of windows) if (timeMs >= window.startMs && timeMs <= window.endMs) for (const cell of window.blockedCells) for (const subcell of acceptedSubcells(cell, "cell", "left")) blocked.add(subcell); return blocked; }
/** @param {number[]} cells */

/**
 * 0.0.88 (Derrick): a map that puts leans on BOTH sides at the same instant leaves
 * the player no safe lane — the two full-height walls together cover the whole
 * grid, which is the unavoidable "full screen" boxing obstacle. Those
 * simultaneous left+right pairs are therefore merged into ONE obstacle.
 *
 * To stop that being repetitive, the replacement cycles
 * squat -> weave_left -> weave_right -> squat ... in occurrence order within the
 * song, so consecutive both-sides moments differ.
 *
 * The merged obstacle does NOT union the two walls' blocked cells: that would
 * re-block the entire grid and reintroduce the undodgeable case. A squat blocks
 * only the top row (duck under it); a weave keeps its own side's cells.
 */
// Rule 4 same-type advance order (Derrick): weave-left -> weave-right -> squat.
const simultaneousObstacleCycle = Object.freeze(["weave_left", "weave_right", "squat"]);
// A both-sides MERGE starts at a squat (duck under it) and then varies.
const mergedObstacleCycle = Object.freeze(["squat", "weave_left", "weave_right"]);
const topRowCells = Object.freeze([0, 1, 2, 3]);
/** @param {ReadonlyArray<ObstacleWindow>} windows @returns {DataRecord[]} */
/**
 * 0.0.89 (Derrick): the four Boxing obstacle rules in a FIXED order, because they
 * interact. Only ONE obstacle may exist at a time.
 *   1. clamp duration to the configured maximum
 *   2. collapse obstacles starting together into ONE (never squat + a weave)
 *   3. advance consecutive same-type obstacles through the variety cycle
 *   4. drop obstacles starting sooner than the cooldown after the previous ENDS
 *      (dropped, never shifted - shifting desyncs from the music)
 * The caller deletes punches inside surviving windows, last, on the final set.
 */
function resolveBoxingObstacles(windows, settings, classify) {
  const msPerBeat = Math.max(settings.msPerBeat, 0.0001);
  const maxBeats = Math.max(settings.maxObstacleDurationMs, 0) / msPerBeat;
  const cooldownBeats = Math.max(settings.obstacleCooldownMs, 0) / msPerBeat;

  // (1) Clamp duration.
  const clamped = windows.map((window) => ({ ...window, endBeat: Math.min(window.endBeat, window.startBeat + maxBeats) }));

  // (2) One obstacle at a time.
  const groups = [];
  for (const window of [...clamped].sort((a, b) => a.startBeat - b.startBeat || a.sourceIndex - b.sourceIndex)) {
    const type = classify([...window.blockedCells]);
    const existing = groups.find((group) => group.startBeat === window.startBeat);
    if (existing) existing.entries.push({ window, type });
    else groups.push({ startBeat: window.startBeat, entries: [{ window, type }] });
  }

  // (3) Variety cycle.
  let previousType = null;
  let occurrence = 0;
  const cycled = groups.map((group) => {
    const first = group.entries[0];
    const base = first.window;
    let type = first.type;
    if (group.entries.length > 1) {
      // A both-sides merge takes the NEXT CYCLE SLOT outright (occurrence 0 is a
      // squat), rather than keeping whichever side happened to be authored first.
      type = mergedObstacleCycle[occurrence % mergedObstacleCycle.length];
      occurrence += 1;
    } else if (previousType !== null && type === previousType) {
      const index = simultaneousObstacleCycle.indexOf(type);
      type = simultaneousObstacleCycle[(index + 1) % simultaneousObstacleCycle.length];
    }
    previousType = type;
    if (group.entries.length === 1 && type === first.type) return base;
    const left = group.entries.find((entry) => entry.type === "weave_left");
    const right = group.entries.find((entry) => entry.type === "weave_right");
    const kept = type === "weave_left" && left ? left.window : type === "weave_right" && right ? right.window : base;
    const blockedCells = type === "squat" ? [...topRowCells] : [...kept.blockedCells].sort((a, b) => a - b);
    const gameplayGeometry = type === "squat"
      ? { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 4, height: 1 }
      : kept.gameplayGeometry;
    return { ...kept, gameplayGeometry, blockedCells, gridMask: blockedCells, forcedType: type };
  });

  // (4) Cooldown.
  const kept = [];
  let previousEnd = null;
  for (const window of [...cycled].sort((a, b) => a.startBeat - b.startBeat)) {
    if (previousEnd !== null && window.startBeat < previousEnd + cooldownBeats) continue;
    kept.push(window);
    previousEnd = window.endBeat;
  }
  return kept;
}

function obstacleType(cells) { let left = 0; let right = 0; for (const cell of cells) cell % 4 <= 1 ? left += 1 : right += 1; return left > right ? "weave_right" : right > left ? "weave_left" : "squat"; }

/** @param {DataRecord} candidate @param {{left:number,right:number}} wristSubcell @param {{left:number,right:number}} wristBeat @param {Difficulty} difficulty @param {string} recipeIdValue @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing:number,profileApplied:boolean}} converterSettings */
async function emitGuard(candidate, wristSubcell, wristBeat, difficulty, recipeIdValue, converterSettings) {
  const notes = /** @type {DataRecord[]} */ (candidate.notes); const left = noteForHand(notes, "left"); const right = noteForHand(notes, "right"); const crossed = Number(left.cell) % 4 > Number(right.cell) % 4; const sourcePair = [topLeftCell(Number(left.cell)), topLeftCell(Number(right.cell))]; const start = Number(candidate.start); const pair = chooseGuardPair(sourcePair, crossed, start, wristSubcell, wristBeat, difficulty, converterSettings);
  if (!pair.length) return { ok: false, trace: dropTrace(candidate, "guard_no_legal_pair") };
  const leftCell = crossed ? pair[1] : pair[0]; const rightCell = crossed ? pair[0] : pair[1]; const sourceEventIds = cloneData(candidate.sourceEventIds); const id = await eventId(recipeIdValue, String(candidate.stableId), "guard");
  const beat = { start, type: "guard", eventId: id, sourceEventIds, guardTarget: { leftCell, rightCell, crossed, sourcePair, spacing: converterSettings.guardSpacing }, checkpoint: { kind: "instantaneous", freshnessMs, timingWindowMs }, timingWindowMs, evidenceFreshnessMs: freshnessMs };
  if (crossed) Object.assign(beat, { modifier: "crossed_guard" });
  return { ok: true, beat, trace: { sourceEventIds, eventId: id, start, action: "emit", kind: "guard", sourcePair, generatedPair: pair, crossed } };
}

/** @param {number[]} sourcePair @param {boolean} crossed @param {number} start @param {{left:number,right:number}} wristSubcell @param {{left:number,right:number}} wristBeat @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,guardSpacing:number,profileApplied:boolean}} converterSettings */
function chooseGuardPair(sourcePair, crossed, start, wristSubcell, wristBeat, difficulty, converterSettings) { const sourceSorted = [...sourcePair].sort((a,b)=>a-b); const candidates = []; const spacing = converterSettings.guardSpacing; for (const rowPair of guardPairs) { const row=2,leftColumn=Math.round(1.5-spacing*0.75),rightColumn=Math.round(1.5+spacing*0.75);const pair=[row*4+leftColumn,row*4+rightColumn];if(leftColumn<0||rightColumn>3)continue;const generatedLeftCell=crossed?pair[1]:pair[0],generatedRightCell=crossed?pair[0]:pair[1];if(converterSettings.profileApplied&&Math.max(subcellManhattan(seedSubcell(sourcePair[0]),seedSubcell(generatedLeftCell)),subcellManhattan(seedSubcell(sourcePair[1]),seedSubcell(generatedRightCell)))>converterSettings.guardRelocationRadius)continue;const subcells = [seedSubcell(pair[0]), seedSubcell(pair[1])]; const leftTarget = crossed ? subcells[1] : subcells[0]; const rightTarget = crossed ? subcells[0] : subcells[1]; const rate = reachSubcellsPerBeat[difficulty]+converterSettings.reachAllowanceSubcells; /* 0.0.89 (Derrick): reachability removed; guards always emit. */ const sourceRow = Math.floor(sourceSorted[0]/4) === Math.floor(sourceSorted[1]/4) ? Math.floor(sourceSorted[0]/4) : 1; const pairRow = Math.floor(pair[0]/4); const sourceMid=(sourceSorted[0]+sourceSorted[1])/2; const pairMid=(pair[0]+pair[1])/2; candidates.push({pair:[...pair],row:Math.abs(pairRow-sourceRow),mid:Math.abs(pairMid-sourceMid),center:Math.abs(pairMid-5.5),id:pair[0]}); } candidates.sort((a,b)=>a.row-b.row||a.mid-b.mid||a.center-b.center||a.id-b.id); return candidates[0]?.pair ?? []; }

/** @param {string} family @param {string} hand @param {number} row */
function spatialTarget(family, hand, row, settings = { uppercutOppositeLane: true, anyOppositeLane: true, anyPunch: false }) { let column = hand === "left" ? 1 : 2; let targetRow = family === "straight" ? 0 : clamp(row,0,2); let direction=""; let sourceCell=-1; if (family === "hook") { column=hand==="left"?2:1; direction=hand==="left"?"right":"left"; sourceCell=targetRow*4+(hand==="left"?1:2); } else if (family === "uppercut") { targetRow=Math.min(targetRow,1); direction="up"; if (settings.uppercutOppositeLane) column=hand==="left"?2:1; sourceCell=(targetRow+1)*4+column; } else if (family === "straight" && settings.anyOppositeLane) { column=hand==="left"?2:1; } const targetCell=targetRow*4+column; const result={targetCell,acceptedSubcells:acceptedSubcells(targetCell,family,hand),sourceCell}; if(direction) Object.assign(result,{entryDirection:direction}); if(family==="straight") Object.assign(result,{qualificationMs:straightQualificationMs,semanticQualification:"straight"}); return result; }
/** @param {number} cell @param {string} family @param {string} hand */
function acceptedSubcells(cell,family,hand){const row=Math.floor(cell/4),column=cell%4,result=[];for(const subRow of [row*2,row*2+1]){result.push(subRow*8+column*2,subRow*8+column*2+1);if(family==="straight"){const margin=hand==="left"?column*2+2:column*2-1;if(margin>=0&&margin<8)result.push(subRow*8+margin);}}return result.sort((a,b)=>a-b);}
/** @param {number} start @param {number} target @param {number} deltaBeats @param {number} rate @param {Set<number>} blocked */

/** @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} summary @param {Difficulty} difficulty @param {string} songToken */
export function buildFlowIntervalOracle(summary,difficulty,songToken){const beats=[];const events=[];const lookup=buildFlowNoteLookup(summary.colorNotes??[]);for(const note of summary.colorNotes??[]){const emitted=emitFlowNote(note);beats.push(emitted);events.push({start:Number(note.start??0),sourceFamily:"note",result:{action:"emit",beat:cloneData(emitted),noteRef:flowNoteRef(note)},note:cloneData(note)});}for(const bomb of summary.bombNotes??[]){const emitted={start:Number(bomb.start??0),type:"bomb",placement:topLeftCell(Number(bomb.cell??0))};beats.push(emitted);events.push({start:emitted.start,sourceFamily:"bomb",result:{action:"emit",beat:cloneData(emitted)},bomb:cloneData(bomb)});}for(const obstacle of summary.obstacles??[]){const start=Number(obstacle.start??0);const end=start+Number(obstacle.duration??0);if(!(end>start))continue;const emitted={start,end,type:"obstacle",...normalizedGeometryForObstacle(obstacle),gridMask:gridMaskForObstacle(obstacle)};beats.push(emitted);events.push({start:emitted.start,sourceFamily:"obstacle",result:{action:"emit",beat:cloneData(emitted)},obstacle:cloneData(obstacle)});}for(const slider of summary.sliders??[]){const start=Number(slider.start??0);const end=Number(slider.end??slider.start??0);if(!(end>start))continue;const emitted=emitFlowArc(slider,lookup);beats.push(emitted);events.push({start,sourceFamily:"slider",result:{action:"emit",beat:cloneData(emitted)},slider:cloneData(slider)});}for(const burst of summary.burstSliders??[]){const burstStart=Number(burst.start??0);const burstEnd=Number(burst.end??burst.start??0);if(!(burstEnd>burstStart))continue;/* B1.6: drop genuinely zero/negative-length bursts — they fail the flow-interval positive-duration gate ("start at center") */const emitted={start:burstStart,end:burstEnd,type:"burst",hand:String(burst.hand??"left"),placement:topLeftCell(Number(burst.cell??0)),direction:Number(burst.direction??8),tailPlacement:topLeftCell(Number(burst.tailCell??burst.cell??0)),checkpointCount:Math.max(Number(burst.sliceCount??1),1)};if(Object.hasOwn(burst,"spacingBias"))Object.assign(emitted,{spacingBias:Number(burst.spacingBias)});beats.push(emitted);events.push({start:emitted.start,sourceFamily:"burstSlider",result:{action:"emit",beat:cloneData(emitted)},source:cloneData(burst)});}swapCrossedFlowNotes(beats,events);const order={note:0,bomb:1,obstacle:2,arc:3,burst:4};beats.sort((a,b)=>Number(a.start)-Number(b.start)||(order[/** @type {keyof typeof order} */(a.type)]??99)-(order[/** @type {keyof typeof order} */(b.type)]??99)||JSON.stringify(a).localeCompare(JSON.stringify(b)));return{chart:{schemaId:"aerobeat.chart.flow.v4",schemaVersion:4,recordVersion:2,rulesetId:flowCollidersRulesetId,chartId:`ab-chart-${songToken}-flow-${difficulty.toLowerCase()}`,chartName:`${titleize(songToken)} ${difficulty} Flow`,mode:"flow",difficulty,beats},trace:{difficulty,obstacleContract:"normalized_obstacle_v2",events}};}
/**
 * Flip only simultaneous crossed exterior Flow notes, before chart and trace identities are frozen.
 * Exact start equality is the Flow same-beat timing window; adjacent beats stay independent.
 * @param {DataRecord[]} beats
 * @param {DataRecord[]} events
 */
export function swapCrossedFlowNotes(beats, events = []) {
  /** @type {Map<number, DataRecord[]>} */ const byStart = new Map();
  for (const beat of beats) {
    if (beat.type !== "note") continue;
    const start = Number(beat.start);
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(beat);
  }
  // Note trace events are emitted in note order and retain a separate snapshot.
  const noteEvents = events.filter((event) => event.sourceFamily === "note");
  const noteBeats = beats.filter((beat) => beat.type === "note");
  const traceFor = new Map(noteBeats.map((beat, index) => {
    const result = /** @type {DataRecord | undefined} */ (noteEvents[index]?.result);
    return [beat, result?.beat];
  }));
  for (const group of byStart.values()) {
    const leftOnRight = group.filter((beat) => beat.hand === "left" && [3, 7, 11].includes(Number(beat.placement)));
    const rightOnLeft = group.filter((beat) => beat.hand === "right" && [0, 4, 8].includes(Number(beat.placement)));
    const count = Math.min(leftOnRight.length, rightOnLeft.length);
    for (let index = 0; index < count; index += 1) {
      const left = leftOnRight[index];
      const right = rightOnLeft[index];
      // Same-cell collision (degenerate): do NOT throw — skip the swap so the
      // song stays playable. The notes keep their original hands (the X remains
      // unreachable, but the chart is valid). This is the heuristic fallback.
      if (left.placement === right.placement) continue;
      left.hand = "right";
      right.hand = "left";
      const leftTrace = /** @type {DataRecord | undefined} */ (traceFor.get(left));
      const rightTrace = /** @type {DataRecord | undefined} */ (traceFor.get(right));
      if (leftTrace) leftTrace.hand = "right";
      if (rightTrace) rightTrace.hand = "left";
    }
  }
}
/** @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} summary @param {Difficulty} difficulty @param {string} songToken @param {import("@aerobeat/web-contracts/note-palette-contracts").AeroAuthoredNotePalette|null} notePalette */
async function convertFlowChart(summary,difficulty,songToken,notePalette){
  const base=buildFlowIntervalOracle(summary,difficulty,songToken);
  const palette=flowPaletteReference(notePalette);
  const chart=/** @type {DataRecord} */({...base.chart,schemaId:flowChartSchemaId,schemaVersion:flowChartSchemaVersion,rulesetId:flowCollidersRulesetId,rulesetVariants:[...flowRulesetVariants],notePalette:palette});
  chart.contentHash=await prefixedSha256(canonicalJson(flowContentIdentity(chart.beats,palette)));
  const trace={...base.trace,rulesetId:flowCollidersRulesetId,rulesetVariants:[...flowRulesetVariants],notePalette:palette,contentHash:chart.contentHash};
  return {chart,trace};
}
/** @param {Readonly<Record<string, unknown>>} note */
function emitFlowNote(note){const direction=Number(note.direction??8);const beat={start:Number(note.start??0),type:"note",hand:String(note.hand??"left"),placement:topLeftCell(Number(note.cell??0)),requiresDirection:direction!==8,angleOffset:Number(note.angleOffset??0)};if(direction!==8)Object.assign(beat,{direction});return beat;}
/** @param {Readonly<Record<string, unknown>>} slider @param {Map<string,string>} lookup */
function emitFlowArc(slider,lookup){const sourceStartPlacement=Number(slider.cell??0),sourceEndPlacement=Number(slider.tailCell??slider.cell??0);const arc={start:Number(slider.start??0),end:Number(slider.end??slider.start??0),type:"arc",hand:String(slider.hand??"left"),startPlacement:topLeftCell(sourceStartPlacement),endPlacement:topLeftCell(sourceEndPlacement),startDirection:Number(slider.direction??8),endDirection:Number(slider.tailDirection??slider.direction??8),headCurveMultiplier:Number(slider.headCurveMultiplier??1),tailCurveMultiplier:Number(slider.tailCurveMultiplier??1),midAnchorMode:Number(slider.midAnchorMode??0)};const start=lookup.get(flowNoteKey(arc.start,arc.hand,sourceStartPlacement));const end=lookup.get(flowNoteKey(arc.end,arc.hand,sourceEndPlacement));if(start)Object.assign(arc,{startNoteRef:start});if(end)Object.assign(arc,{endNoteRef:end});return arc;}
/** @param {readonly Readonly<Record<string, unknown>>[]} notes */
function buildFlowNoteLookup(notes){const result=new Map();for(const note of notes){const key=flowNoteKey(Number(note.start??0),String(note.hand??"left"),Number(note.cell??0));if(!result.has(key))result.set(key,flowNoteRef(note));}return result;}
/** @param {number} start @param {string} hand @param {number} cell */
function flowNoteKey(start,hand,cell){return `${hand}|${start.toFixed(3)}|${cell}`;}
/** @param {Readonly<Record<string, unknown>>} note */
function flowNoteRef(note){return `flow-note-${String(Number(note.sourceIndex??0)).padStart(3,"0")}-${String(note.hand??"left")}-${Number(note.cell??0)}-${Number(note.start??0).toFixed(3)}`;}

/** @param {readonly Readonly<Record<string, unknown>>[]} notes @returns {[number, DataRecord[]][]} */
function noteGroups(notes){/** @type {Map<number, DataRecord[]>} */ const result=new Map();for(const value of notes){const start=Math.round(Number(value.start??0)*1000)/1000;if(!result.has(start))result.set(start,[]);result.get(start).push(cloneData(value));}return [...result.entries()].sort((a,b)=>a[0]-b[0]);}
/** @param {DataRecord[]} notes @returns {DataRecord[]} */
function collapseSameHand(notes){/** @type {DataRecord[]} */ const result=[];for(const hand of ["left","right"]){const entries=notes.filter((note)=>String(note.hand)===hand).sort((a,b)=>Number(a.cell)-Number(b.cell)||Number(a.sourceIndex)-Number(b.sourceIndex));if(entries[0])result.push(/** @type {DataRecord} */ (cloneData(entries[0])));}return result;}
/** @param {DataRecord[]} notes @param {string} prefix */
function sourceIds(notes,prefix){return notes.map((note)=>`${prefix}-${String(Number(note.sourceIndex??0)).padStart(3,"0")}`).sort();}
/** @param {DataRecord[]} notes */
function hasBothHands(notes){return notes.some((note)=>note.hand==="left")&&notes.some((note)=>note.hand==="right");}
/** @param {DataRecord[]} notes @param {string} hand */
function noteForHand(notes,hand){return notes.find((note)=>note.hand===hand)??{};}
/** @param {DataRecord} note @param {string} recipeIdValue */
function familyFor(note,recipeIdValue){if(recipeIdValue===rowFamilyRecipeId){const row=topLeftRow(Number(note.cell));return row===0?"uppercut":row===1?"straight":"hook";}const direction=Number(note.direction??8);return direction===0?"uppercut":direction===2||direction===3?"hook":"straight";}
/** @param {DataRecord} note @param {string} family @param {string} recipeIdValue @param {number[]} counts */
function targetRowFor(note,family,recipeIdValue,counts){const source=topLeftRow(Number(note.cell));if(recipeIdValue===cutFamilyRecipeId)return family==="uppercut"&&source===2?1:source;const allowed=family==="uppercut"?[0,1]:[0,1,2];return allowed.sort((a,b)=>counts[a]-counts[b]||a-b)[0];}
/** @param {DataRecord} left @param {DataRecord} right */
function candidateOrder(left,right){return Number(left.start)-Number(right.start)||String(left.stableId).localeCompare(String(right.stableId));}
/** @param {DataRecord} candidate @param {string} reason @param {DataRecord} [extra] */
function dropTrace(candidate,reason,extra={}){return{sourceEventIds:cloneData(candidate.sourceEventIds),start:Number(candidate.start),action:"drop",reason,...extra};}
/** @param {string} recipeIdValue @param {string} sourceId @param {string} kind */
async function eventId(recipeIdValue,sourceId,kind){const digest=await prefixedSha256(`${recipeIdValue}|${sourceId}|${kind}`);return`boxing-${kind.replaceAll("_","-")}-${digest.slice(7,19)}`;}
/** @param {number} cell */
function topLeftRow(cell){return 2-clamp(Math.floor(cell/4),0,2);}
/** @param {number} cell */
function topLeftCell(cell){return topLeftRow(cell)*4+clamp(cell%4,0,3);}
/** @param {number} cell */
function seedSubcell(cell){const row=clamp(Math.floor(cell/4),0,2),column=clamp(cell%4,0,3);return(row*2+1)*8+column*2+1;}
/** @param {number} left @param {number} right */
function subcellManhattan(left,right){return Math.abs(Math.floor(left/8)-Math.floor(right/8))+Math.abs(left%8-right%8);}
/** @param {number} beat @param {number} bpm */
function beatToMs(beat,bpm){return beat*60000/Math.max(bpm,1);}
/** @param {number} value @param {number} minimum @param {number} maximum */
function clamp(value,minimum,maximum){return Math.max(minimum,Math.min(maximum,Math.trunc(value)));}
/** @param {unknown} value @returns {Difficulty} */
function normalizeDifficulty(value){const compact=String(value).toLowerCase().replace(/[^a-z]/gu,"");/** @type {Record<string, Difficulty>} */ const names={easy:"Easy",normal:"Normal",hard:"Hard",expert:"Expert",expertplus:"ExpertPlus"};const result=names[compact];if(!result)throw new Error("Unsupported difficulty");return result;}
/** @param {readonly string[]} values */
function normalizeModifiers(values){const result=[...new Set(values.filter((value)=>supportedModifiers.includes(value)))];result.sort();return result;}
/** @param {string} value */
function sanitizeToken(value){return value.toLowerCase().replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"")||"imported";}
/** @param {string} value */
function titleize(value){return value.replaceAll("_","-").split("-").filter(Boolean).map((word)=>word[0]?.toUpperCase()+word.slice(1)).join(" ");}
/** @param {DataRecord[]} charts @param {number} bpm */
function estimateDuration(charts,bpm){let maxBeat=0;for(const chart of charts)for(const beat of /** @type {DataRecord[]} */(chart.beats??[]))maxBeat=Math.max(maxBeat,Number(beat.end??beat.start??0));return Math.ceil(maxBeat*60/Math.max(bpm,1));}
