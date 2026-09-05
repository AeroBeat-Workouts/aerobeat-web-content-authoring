// @ts-check

import { deriveObstacleGridMask, isObstacleGameplayGeometry, isObstacleSourceGeometry, maximumObstaclesPerChart } from "@aerobeat/web-contracts/obstacle-contracts";
import { canonicalJson, cloneData, deepFreeze, prefixedSha256 } from "./canonical.js";
import { normalizeConverterProfile } from "./converter-profile.js";
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
  semanticTrackRulesetId,
  spatialGridRulesetId,
  straightQualificationMs,
  supportedModifiers,
  timingWindowMs
} from "./definitions.js";

/** @typedef {"Easy" | "Normal" | "Hard" | "Expert" | "ExpertPlus"} Difficulty */
/** @typedef {Record<string, unknown>} DataRecord */

/**
 * Convert one normalized difficulty into Flow plus four Boxing charts.
 *
 * @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} sourceSummary
 * @param {{difficulty: Difficulty, songToken: string, songName: string, bpm: number, sourceProvider: string, sourceId: string, sourceVersionHash: string, sourceDifficultyPath: string, sourceBeatmapVersion: string, sourceDifficultyHash?: string, audioPath?: string, audioContentHash?: string, modifiers?: readonly string[], presentationSuggestion?: Readonly<Record<string, unknown>>, converterProfile?: Readonly<Record<string, unknown>>}} options
 * @param {(progress: number, phase: string) => void} [onProgress]
 * @returns {Promise<Readonly<{package: DataRecord, packageHash: string, sourceHash: string, charts: DataRecord[], traces: DataRecord[], flowTrace: DataRecord}>>}
 */
export async function convertDifficulty(sourceSummary, options, onProgress = () => undefined) {
  const bpm = positive(options.bpm, 120);
  const difficulty = normalizeDifficulty(options.difficulty);
  const songToken = sanitizeToken(options.songToken || options.sourceId || "imported");
  const modifiers = normalizeModifiers(options.modifiers ?? []);
  const converterProfile = options.converterProfile ? await normalizeConverterProfile(options.converterProfile) : null;
  const converterSettings = converterProfile ? { .../** @type {{guardRelocationRadius:number,reachAllowanceSubcells:number}} */ (converterProfile.settings), profileApplied: true } : { guardRelocationRadius: 0, reachAllowanceSubcells: 0, profileApplied: false };
  const sourceHash = await prefixedSha256(canonicalJson(sourceSummary));
  const sourceDifficultyHash = options.sourceDifficultyHash ?? await prefixedSha256(canonicalJson(sourceSummary));
  const charts = [];
  const traces = [];
  let matrixIndex = 0;
  for (const recipe of recipeDefinitions) {
    const generated = await generateEvents(sourceSummary, difficulty, bpm, recipe, modifiers, converterSettings);
    for (const rulesetId of [semanticTrackRulesetId, spatialGridRulesetId]) {
      const chart = await chartFor(generated, difficulty, songToken, recipe, rulesetId, sourceHash, modifiers, options.presentationSuggestion, converterProfile);
      charts.push(chart);
      traces.push({
        chartId: chart.chartId,
        difficulty,
        bpm,
        recipeId: recipe.recipeId,
        rulesetId,
        sourceHash,
        contentHash: chart.prototype.contentHash,
        sourceDifficultyPath: options.sourceDifficultyPath,
        sourceBeatmapVersion: options.sourceBeatmapVersion,
        sourceDifficultyHash,
        ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}),
        optimizer: cloneData(generated.optimizer),
        events: cloneData(generated.trace)
      });
      matrixIndex += 1;
      onProgress(0.15 + matrixIndex * 0.15, "converting");
    }
  }
  const flow = convertFlowChart(sourceSummary, difficulty, songToken);
  Object.assign(flow.trace, { sourceHash, sourceDifficultyPath: options.sourceDifficultyPath, sourceBeatmapVersion: options.sourceBeatmapVersion, sourceDifficultyHash });
  charts.push(flow.chart);
  const packageId = `ab-songpkg-${songToken}-${sanitizeToken(options.sourceVersionHash).slice(0, 12)}-${difficulty.toLowerCase()}`;
  const songId = `ab-song-${songToken}`;
  const sets = charts.map((chart) => ({ schemaId: "aerobeat.set.v1", schemaVersion: 1, recordVersion: 1, setId: `ab-set-${String(chart.chartId).replace(/^ab-chart-/u, "")}`, setName: `${titleize(songToken)} ${difficulty} ${titleize(String(chart.mode))}`, songId, chartId: chart.chartId }));
  const durationSec = estimateDuration(charts, bpm);
  const packageRecord = {
    schemaId: "aerobeat.song-package.v3",
    schemaVersion: 3,
    packageVersion: "3.0.0",
    packageId,
    songId,
    songName: options.songName || titleize(songToken),
    source: {
      provider: options.sourceProvider,
      sourceId: options.sourceId,
      sourceVersionHash: options.sourceVersionHash,
      difficulty,
      sourceDifficultyPath: options.sourceDifficultyPath,
      sourceBeatmapVersion: options.sourceBeatmapVersion,
      sourceDifficultyHash,
      sourceHash,
      obstacleContract: "normalized_obstacle_v2",
      ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {})
    },
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
    conversionTrace: { boxing: traces, flow: [flow.trace], ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}) },
    presentationSuggestion: options.presentationSuggestion ? cloneData(options.presentationSuggestion) : null
  };
  const packageHash = await prefixedSha256(canonicalJson(packageRecord));
  onProgress(0.8, "validating");
  return deepFreeze({ package: packageRecord, packageHash, sourceHash, charts, traces, flowTrace: flow.trace });
}

/** @param {DataRecord} generated @param {Difficulty} difficulty @param {string} songToken @param {DataRecord} recipe @param {string} rulesetId @param {string} sourceHash @param {readonly string[]} modifiers @param {Readonly<Record<string, unknown>> | undefined} suggestion @param {Readonly<Record<string, unknown>> | null} converterProfile */
async function chartFor(generated, difficulty, songToken, recipe, rulesetId, sourceHash, modifiers, suggestion, converterProfile) {
  const recipeId = String(recipe.recipeId);
  const recipeShort = recipeId === rowFamilyRecipeId ? "row-family" : "cut-family";
  const rulesetShort = rulesetId === semanticTrackRulesetId ? "semantic-track" : "spatial-grid";
  const beats = cloneData(generated.beats);
  const recipeHash = await prefixedSha256(canonicalJson(recipe));
  const ruleset = rulesetDefinitions.find((candidate) => candidate.rulesetId === rulesetId) ?? rulesetDefinitions[0];
  const rulesetHash = await prefixedSha256(canonicalJson(ruleset));
  const contentHash = await prefixedSha256(canonicalJson({ beats, recipeId, rulesetId, sourceHash, ...(converterProfile ? { converterProfile } : {}) }));
  const allModifiers = [...modifiers];
  for (const beat of /** @type {DataRecord[]} */ (beats)) {
    if (typeof beat.modifier === "string" && !allModifiers.includes(beat.modifier)) allModifiers.push(beat.modifier);
  }
  allModifiers.sort();
  const chart = {
    schemaId: "aerobeat.chart.boxing.v1", schemaVersion: 1, recordVersion: 1,
    chartId: `ab-chart-${songToken}-boxing-${difficulty.toLowerCase()}-${rulesetShort}-${recipeShort}`,
    chartName: `${titleize(songToken)} ${difficulty} Boxing - ${titleize(rulesetShort)} / ${titleize(recipeShort)}`,
    mode: "boxing", difficulty,
    prototype: { contractId: boxingPrototypeContractId, recipeId, recipeVersion, rulesetId, rulesetVersion, sourceHash, recipeHash, rulesetHash, contentHash, modifiers: allModifiers, ...(converterProfile ? { converterProfile: cloneData(converterProfile) } : {}), regenerationRequiredFor: ["punchMinSpacingMs", "reachSubcellsPerBeat", "familyBalance", "guardRelocation"] },
    beats
  };
  if (suggestion) Object.assign(chart, { presentationSuggestion: cloneData(suggestion) });
  return chart;
}

/** @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} sourceSummary @param {Difficulty} difficulty @param {number} bpm @param {DataRecord} recipe @param {readonly string[]} modifiers @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} converterSettings */
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
  for (const candidate of candidates) {
    const start = Number(candidate.start); const startMs = beatToMs(start, bpm);
    if (candidate.kind === "guard") {
      const emitted = await emitGuard(candidate, obstacleWindows, wristSubcell, wristBeat, difficulty, bpm, String(recipe.recipeId), converterSettings);
      trace.push(emitted.trace);
      if (emitted.ok && emitted.beat) {
        beats.push(emitted.beat); const target = emitted.beat.guardTarget;
        wristSubcell.left = seedSubcell(Number(target.leftCell)); wristSubcell.right = seedSubcell(Number(target.rightCell)); wristBeat.left = start; wristBeat.right = start;
      }
      continue;
    }
    if (!optimizer.selected.has(String(candidate.stableId))) { trace.push(dropTrace(candidate, optimizer.infeasible.get(String(candidate.stableId)) ?? "spacing_optimizer_rejected", { priorityOrder: optimizerPriority })); continue; }
    const note = /** @type {DataRecord} */ (candidate.note); const hand = String(note.hand); const family = String(candidate.family);
    const spatial = spatialTarget(family, hand, Number(candidate.targetRow)); const blocked = blockedSubcellsAt(startMs, obstacleWindows);
    const safe = /** @type {number[]} */ (spatial.acceptedSubcells).filter((subcell) => !blocked.has(subcell));
    if (!safe.length) { trace.push(dropTrace(candidate, "spatial_target_blocked")); continue; }
    spatial.acceptedSubcells = safe;
    const deltaBeats = Math.max(start - wristBeat[/** @type {"left" | "right"} */ (hand)], 0);
    const target = safe.find((subcell) => reachable(wristSubcell[/** @type {"left" | "right"} */ (hand)], subcell, deltaBeats, reachSubcellsPerBeat[difficulty] + converterSettings.reachAllowanceSubcells, blocked));
    if (target === undefined) { trace.push(dropTrace(candidate, "unreachable_after_optimizer")); continue; }
    if (startMs - lastPunchMs < punchMinSpacingMs) { trace.push(dropTrace(candidate, "punch_min_spacing", { previousHand, spacingMs: startMs - lastPunchMs })); continue; }
    const type = `${family}_${hand}`; const generatedEventId = await eventId(String(recipe.recipeId), String(candidate.stableId), type);
    const beat = { start, type, eventId: generatedEventId, sourceEventIds: cloneData(candidate.sourceEventIds), spatialTarget: spatial, timingWindowMs, evidenceFreshnessMs: freshnessMs };
    if (modifiers.includes("any_punch")) Object.assign(beat, { modifier: "any_punch" }); else if (modifiers.includes("cross_body")) Object.assign(beat, { modifier: "cross_body" });
    beats.push(beat); lastPunchMs = startMs; previousHand = hand; familyCounts[/** @type {"straight" | "hook" | "uppercut"} */ (family)] += 1; wristSubcell[/** @type {"left" | "right"} */ (hand)] = target; wristBeat[/** @type {"left" | "right"} */ (hand)] = start;
    trace.push({ sourceEventIds: beat.sourceEventIds, eventId: generatedEventId, start, action: "emit", kind: "punch", family, hand, sourceDirection: Number(note.direction ?? 8), generatedDirection: spatial.entryDirection ?? "semantic_straight", target: cloneData(spatial) });
  }
  for (const window of obstacleWindows) {
    const blockedCells = [...window.blockedCells]; const type = obstacleType(blockedCells); const sourceId = `obstacle-${String(window.sourceIndex).padStart(3, "0")}`;
    if ((type === "squat" && modifiers.includes("no_squats")) || (type.startsWith("weave_") && modifiers.includes("no_weaves"))) { trace.push({ sourceEventIds: [sourceId], start: window.startBeat, action: "drop", reason: "disabled_by_modifier", type }); continue; }
    const safeCells = Array.from({ length: 12 }, (_, index) => index).filter((cell) => !blockedCells.includes(cell));
    const emitted = { start: window.startBeat, type, eventId: await eventId(String(recipe.recipeId), sourceId, type), sourceEventIds: [sourceId], checkpoint: { kind: "instantaneous", freshnessMs, timingWindowMs, noseSafeCells: safeCells }, blockedCells };
    beats.push(emitted); trace.push({ sourceEventIds: [sourceId], start: window.startBeat, action: "emit", kind: "obstacle_checkpoint", type, blockedCells, noseSafeCells: safeCells });
  }
  beats.sort((left, right) => Number(left.start) - Number(right.start) || String(left.eventId).localeCompare(String(right.eventId)));
  return { beats, trace, familyCounts, optimizer: { priorityOrder: optimizerPriority, punchMinSpacingMs, ...(converterSettings.profileApplied ? { guardRelocationRadius: converterSettings.guardRelocationRadius, reachAllowanceSubcells: converterSettings.reachAllowanceSubcells } : {}), selectedStableIds: [...optimizer.selected.keys()] } };
}

const optimizerPriority = ["retained_punches", "hand_alternation", "family_balance", "source_order", "stable_event_id"];

/** @param {DataRecord[]} candidates @param {number} bpm @param {ObstacleWindow[]} obstacles @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} converterSettings */
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

/** @param {DataRecord} candidate @param {number} bpm @param {ObstacleWindow[]} obstacles @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} converterSettings */
function staticInfeasibility(candidate, bpm, obstacles, difficulty, converterSettings) {
  const note = /** @type {DataRecord} */ (candidate.note); const hand = String(note.hand); const spatial = spatialTarget(String(candidate.family), hand, Number(candidate.targetRow)); const blocked = blockedSubcellsAt(beatToMs(Number(candidate.start), bpm), obstacles);
  let safe = false; let reach = false; const seed = hand === "left" ? 5 : 6;
  for (const subcell of /** @type {number[]} */ (spatial.acceptedSubcells)) { if (blocked.has(subcell)) continue; safe = true; if (reachable(seedSubcell(seed), subcell, Number(candidate.start), reachSubcellsPerBeat[difficulty] + converterSettings.reachAllowanceSubcells, blocked)) { reach = true; break; } }
  return !safe ? "spatial_target_blocked_before_optimizer" : !reach ? "unreachable_before_optimizer" : "";
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

/** @typedef {{startBeat:number,endBeat:number,startMs:number,endMs:number,blockedCells:number[],sourceIndex:number}} ObstacleWindow */
/** @param {readonly Readonly<Record<string, unknown>>[]} obstacles @param {number} bpm @returns {ObstacleWindow[]} */
function obstaclesFor(obstacles, bpm) {
  if (obstacles.length > maximumObstaclesPerChart) throw new Error("flow_obstacle_limit_exceeded");
  return obstacles.map((entry, index) => {
    const start = Number(entry.start);
    const duration = Number(entry.duration);
    const endBeat = start + duration;
    const resolvedEndMs = beatToMs(endBeat, bpm);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(endBeat) || resolvedEndMs > 86_400_000) throw new Error("flow_obstacle_interval_invalid");
    return { startBeat: start, endBeat, startMs: beatToMs(start, bpm) - timingWindowMs, endMs: resolvedEndMs + timingWindowMs, blockedCells: [...gridMaskForObstacle(entry)], sourceIndex: Number(entry.sourceIndex ?? index) };
  });
}
/** @param {Readonly<Record<string, unknown>>} obstacle */
function normalizedGeometryForObstacle(obstacle) {
  const sourceGeometry = obstacle.sourceGeometry;
  const gameplayGeometry = obstacle.gameplayGeometry;
  if (!isObstacleSourceGeometry(sourceGeometry) || !isObstacleGameplayGeometry(gameplayGeometry)) throw new Error("obstacle_geometry_invalid");
  return { sourceGeometry: cloneData(sourceGeometry), gameplayGeometry: cloneData(gameplayGeometry) };
}
/** @param {Readonly<Record<string, unknown>>} obstacle */
function gridMaskForObstacle(obstacle) {
  const { gameplayGeometry } = normalizedGeometryForObstacle(obstacle);
  return deriveObstacleGridMask(/** @type {import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleGameplayGeometry} */ (gameplayGeometry));
}
/** @param {number} timeMs @param {ObstacleWindow[]} windows */
function blockedSubcellsAt(timeMs, windows) { const blocked = new Set(); for (const window of windows) if (timeMs >= window.startMs && timeMs <= window.endMs) for (const cell of window.blockedCells) for (const subcell of acceptedSubcells(cell, "cell", "left")) blocked.add(subcell); return blocked; }
/** @param {number[]} cells */
function obstacleType(cells) { let left = 0; let right = 0; for (const cell of cells) cell % 4 <= 1 ? left += 1 : right += 1; return left > right ? "weave_right" : right > left ? "weave_left" : "squat"; }

/** @param {DataRecord} candidate @param {ObstacleWindow[]} obstacles @param {{left:number,right:number}} wristSubcell @param {{left:number,right:number}} wristBeat @param {Difficulty} difficulty @param {number} bpm @param {string} recipeIdValue @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} converterSettings */
async function emitGuard(candidate, obstacles, wristSubcell, wristBeat, difficulty, bpm, recipeIdValue, converterSettings) {
  const notes = /** @type {DataRecord[]} */ (candidate.notes); const left = noteForHand(notes, "left"); const right = noteForHand(notes, "right"); const crossed = Number(left.cell) % 4 > Number(right.cell) % 4; const sourcePair = [topLeftCell(Number(left.cell)), topLeftCell(Number(right.cell))]; const start = Number(candidate.start); const blocked = blockedSubcellsAt(beatToMs(start, bpm), obstacles); const pair = chooseGuardPair(sourcePair, crossed, blocked, start, wristSubcell, wristBeat, difficulty, converterSettings);
  if (!pair.length) return { ok: false, trace: dropTrace(candidate, "guard_no_legal_pair") };
  const leftCell = crossed ? pair[1] : pair[0]; const rightCell = crossed ? pair[0] : pair[1]; const sourceEventIds = cloneData(candidate.sourceEventIds); const id = await eventId(recipeIdValue, String(candidate.stableId), "guard");
  const beat = { start, type: "guard", eventId: id, sourceEventIds, guardTarget: { leftCell, rightCell, crossed, sourcePair }, checkpoint: { kind: "instantaneous", freshnessMs, timingWindowMs }, timingWindowMs, evidenceFreshnessMs: freshnessMs };
  if (crossed) Object.assign(beat, { modifier: "crossed_guard" });
  return { ok: true, beat, trace: { sourceEventIds, eventId: id, start, action: "emit", kind: "guard", sourcePair, generatedPair: pair, crossed } };
}

/** @param {number[]} sourcePair @param {boolean} crossed @param {Set<number>} blocked @param {number} start @param {{left:number,right:number}} wristSubcell @param {{left:number,right:number}} wristBeat @param {Difficulty} difficulty @param {{guardRelocationRadius:number,reachAllowanceSubcells:number,profileApplied:boolean}} converterSettings */
function chooseGuardPair(sourcePair, crossed, blocked, start, wristSubcell, wristBeat, difficulty, converterSettings) { const sourceSorted = [...sourcePair].sort((a,b)=>a-b); const candidates = []; for (const pair of guardPairs) { const generatedLeftCell=crossed?pair[1]:pair[0],generatedRightCell=crossed?pair[0]:pair[1];if(converterSettings.profileApplied&&Math.max(subcellManhattan(seedSubcell(sourcePair[0]),seedSubcell(generatedLeftCell)),subcellManhattan(seedSubcell(sourcePair[1]),seedSubcell(generatedRightCell)))>converterSettings.guardRelocationRadius)continue;const subcells = [seedSubcell(pair[0]), seedSubcell(pair[1])]; if (blocked.has(subcells[0]) || blocked.has(subcells[1])) continue; const leftTarget = crossed ? subcells[1] : subcells[0]; const rightTarget = crossed ? subcells[0] : subcells[1]; const rate = reachSubcellsPerBeat[difficulty]+converterSettings.reachAllowanceSubcells; if (!reachable(wristSubcell.left, leftTarget, Math.max(start-wristBeat.left,0), rate, blocked) || !reachable(wristSubcell.right, rightTarget, Math.max(start-wristBeat.right,0), rate, blocked)) continue; const sourceRow = Math.floor(sourceSorted[0]/4) === Math.floor(sourceSorted[1]/4) ? Math.floor(sourceSorted[0]/4) : 1; const pairRow = Math.floor(pair[0]/4); const sourceMid=(sourceSorted[0]+sourceSorted[1])/2; const pairMid=(pair[0]+pair[1])/2; candidates.push({pair:[...pair],row:Math.abs(pairRow-sourceRow),mid:Math.abs(pairMid-sourceMid),center:Math.abs(pairMid-5.5),id:pair[0]}); } candidates.sort((a,b)=>a.row-b.row||a.mid-b.mid||a.center-b.center||a.id-b.id); return candidates[0]?.pair ?? []; }

/** @param {string} family @param {string} hand @param {number} row */
function spatialTarget(family, hand, row) { let column = hand === "left" ? 1 : 2; let targetRow = clamp(row,0,2); let direction=""; let sourceCell=-1; if (family === "hook") { column=hand==="left"?2:1; direction=hand==="left"?"right":"left"; sourceCell=targetRow*4+(hand==="left"?1:2); } else if (family === "uppercut") { targetRow=Math.min(targetRow,1); direction="up"; sourceCell=(targetRow+1)*4+column; } const targetCell=targetRow*4+column; const result={targetCell,acceptedSubcells:acceptedSubcells(targetCell,family,hand),sourceCell}; if(direction) Object.assign(result,{entryDirection:direction}); if(family==="straight") Object.assign(result,{qualificationMs:straightQualificationMs,semanticQualification:"straight"}); return result; }
/** @param {number} cell @param {string} family @param {string} hand */
function acceptedSubcells(cell,family,hand){const row=Math.floor(cell/4),column=cell%4,result=[];for(const subRow of [row*2,row*2+1]){result.push(subRow*8+column*2,subRow*8+column*2+1);if(family==="straight"){const margin=hand==="left"?column*2+2:column*2-1;if(margin>=0&&margin<8)result.push(subRow*8+margin);}}return result.sort((a,b)=>a-b);}
/** @param {number} start @param {number} target @param {number} deltaBeats @param {number} rate @param {Set<number>} blocked */
function reachable(start,target,deltaBeats,rate,blocked){if(target<0||target>=48||blocked.has(target))return false;const distances=Array(48).fill(Infinity),visited=new Set();distances[clamp(start,0,47)]=0;for(let step=0;step<48;step+=1){let current=-1,currentDistance=Infinity;for(let candidate=0;candidate<48;candidate+=1)if(!visited.has(candidate)&&distances[candidate]<currentDistance){current=candidate;currentDistance=distances[candidate];}if(current<0||current===target)break;visited.add(current);const x=current%8,y=Math.floor(current/8);for(let dy=-1;dy<=1;dy+=1)for(let dx=-1;dx<=1;dx+=1){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||nx>=8||ny<0||ny>=6)continue;const next=ny*8+nx;if(blocked.has(next))continue;distances[next]=Math.min(distances[next],currentDistance+(dx&&dy?Math.SQRT2:1));}}return distances[target]<=Math.max(deltaBeats*rate,0)+0.0001;}

/** @param {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>} summary @param {Difficulty} difficulty @param {string} songToken */
function convertFlowChart(summary,difficulty,songToken){const beats=[];const events=[];const lookup=buildFlowNoteLookup(summary.colorNotes??[]);for(const note of summary.colorNotes??[]){const emitted=emitFlowNote(note);beats.push(emitted);events.push({start:Number(note.start??0),sourceFamily:"note",result:{action:"emit",beat:cloneData(emitted),noteRef:flowNoteRef(note)},note:cloneData(note)});}for(const bomb of summary.bombNotes??[]){const emitted={start:Number(bomb.start??0),type:"bomb",placement:topLeftCell(Number(bomb.cell??0))};beats.push(emitted);events.push({start:emitted.start,sourceFamily:"bomb",result:{action:"emit",beat:cloneData(emitted)},bomb:cloneData(bomb)});}for(const obstacle of summary.obstacles??[]){const emitted={start:Number(obstacle.start??0),end:Number(obstacle.start??0)+Number(obstacle.duration??0),type:"obstacle",...normalizedGeometryForObstacle(obstacle),gridMask:gridMaskForObstacle(obstacle)};beats.push(emitted);events.push({start:emitted.start,sourceFamily:"obstacle",result:{action:"emit",beat:cloneData(emitted)},obstacle:cloneData(obstacle)});}for(const slider of summary.sliders??[]){const emitted=emitFlowArc(slider,lookup);beats.push(emitted);events.push({start:Number(slider.start??0),sourceFamily:"slider",result:{action:"emit",beat:cloneData(emitted)},slider:cloneData(slider)});}for(const burst of summary.burstSliders??[]){const emitted={start:Number(burst.start??0),end:Number(burst.end??burst.start??0),type:"burst",hand:String(burst.hand??"left"),placement:topLeftCell(Number(burst.cell??0)),direction:Number(burst.direction??8),tailPlacement:topLeftCell(Number(burst.tailCell??burst.cell??0)),checkpointCount:Math.max(Number(burst.sliceCount??1),1)};if(Object.hasOwn(burst,"spacingBias"))Object.assign(emitted,{spacingBias:Number(burst.spacingBias)});beats.push(emitted);events.push({start:emitted.start,sourceFamily:"burstSlider",result:{action:"emit",beat:cloneData(emitted)},source:cloneData(burst)});}const order={note:0,bomb:1,obstacle:2,arc:3,burst:4};beats.sort((a,b)=>Number(a.start)-Number(b.start)||(order[/** @type {keyof typeof order} */(a.type)]??99)-(order[/** @type {keyof typeof order} */(b.type)]??99)||JSON.stringify(a).localeCompare(JSON.stringify(b)));return{chart:{schemaId:"aerobeat.chart.flow.v3",schemaVersion:3,recordVersion:2,rulesetId:"flow_grid_v2",chartId:`ab-chart-${songToken}-flow-${difficulty.toLowerCase()}`,chartName:`${titleize(songToken)} ${difficulty} Flow`,mode:"flow",difficulty,beats},trace:{difficulty,obstacleContract:"normalized_obstacle_v2",events}};}
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
/** @param {number} value @param {number} fallback */
function positive(value,fallback){return Number.isFinite(value)&&value>0?value:fallback;}
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
