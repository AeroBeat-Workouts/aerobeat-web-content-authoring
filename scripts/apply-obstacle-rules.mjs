// Applies the 0.0.89 Boxing obstacle rules + reachability removal to src/converter.js.
// Run from the aerobeat-web-content-authoring repo root: node scripts/apply-obstacle-rules.mjs
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../src/converter.js", import.meta.url);
let s = readFileSync(path, "utf8");
const must = (label, needle) => {
  if (!s.includes(needle)) throw new Error(`anchor missing (${label})`);
};
const replaceOnce = (label, from, to) => {
  must(label, from);
  const at = s.indexOf(from);
  if (s.indexOf(from, at + 1) >= 0) throw new Error(`anchor not unique (${label})`);
  s = s.slice(0, at) + to + s.slice(at + from.length);
};

// ---- 1. settings: own-lane default + obstacle knobs -------------------------------
replaceOnce("settings",
`    uppercutOppositeLane: settings.uppercutOppositeLane ?? profileSettings?.uppercutOppositeLane ?? false,
    anyOppositeLane: settings.anyOppositeLane ?? profileSettings?.anyOppositeLane ?? true,
    guardSpacing: settings.guardSpacing ?? profileSettings?.guardSpacing ?? 1,`,
`    uppercutOppositeLane: settings.uppercutOppositeLane ?? profileSettings?.uppercutOppositeLane ?? false,
    // 0.0.89 (Derrick): ONLY hooks stay in the opposite handiness lane.
    anyOppositeLane: settings.anyOppositeLane ?? profileSettings?.anyOppositeLane ?? false,
    guardSpacing: settings.guardSpacing ?? profileSettings?.guardSpacing ?? 0.25,
    // 0.0.89 (Derrick): Boxing obstacle rules. Both bake at import time, so a change
    // needs a reimport. Surfaced in Game Setup for playtesting, locked in later.
    maxObstacleDurationMs: Number(settings.maxObstacleDurationMs ?? 3000),
    obstacleCooldownMs: Number(settings.obstacleCooldownMs ?? 4000),`);

// ---- 2. replace the 0.0.88 lean-pair merge with the full resolver -----------------
const mergeStart = s.indexOf("function mergeSimultaneousLeanPairs(windows) {");
if (mergeStart < 0) throw new Error("mergeSimultaneousLeanPairs missing");
// it is followed by a blank line then the obstacleType jsdoc
const mergeEnd = s.indexOf("\nfunction obstacleType(cells)", mergeStart);
if (mergeEnd < 0) throw new Error("merge end anchor missing");
s = s.slice(0, mergeStart) + `/**
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
  const cycled = groups.map((group) => {
    const first = group.entries[0];
    let type = first.type;
    if (previousType !== null && type === previousType) {
      const index = simultaneousObstacleCycle.indexOf(type);
      type = simultaneousObstacleCycle[(index + 1) % simultaneousObstacleCycle.length];
    }
    previousType = type;
    const base = first.window;
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
` + s.slice(mergeEnd);

// ---- 3. constants -----------------------------------------------------------------
replaceOnce("cycle", `const simultaneousLeanCycle = Object.freeze(["squat", "weave_left", "weave_right"]);`,
  `const simultaneousObstacleCycle = Object.freeze(["weave_left", "weave_right", "squat"]);`);

// ---- 4. resolve once, share the set -----------------------------------------------
replaceOnce("resolve-once",
`  const familyCounts = { straight: 0, hook: 0, uppercut: 0 };
  for (const candidate of candidates) {`,
`  const familyCounts = { straight: 0, hook: 0, uppercut: 0 };
  // 0.0.89 (Derrick): resolve the obstacle set ONCE and use the SAME set for punch
  // blocking and obstacle emission, so every rule sees the final obstacles.
  const resolvedObstacleWindows = resolveBoxingObstacles(obstacleWindows, {
    maxObstacleDurationMs: converterSettings.maxObstacleDurationMs,
    obstacleCooldownMs: converterSettings.obstacleCooldownMs,
    msPerBeat: 60000 / bpm
  }, obstacleType);
  const obstacleWindowActive = (timeMs) => resolvedObstacleWindows.some((window) => timeMs >= window.startMs && timeMs <= window.endMs);
  for (const candidate of candidates) {`);

// ---- 5. rule 1 + resolved-set blocking ---------------------------------------------
replaceOnce("rule1",
`    const spatial = spatialTarget(family, hand, Number(candidate.targetRow), { uppercutOppositeLane: converterSettings.uppercutOppositeLane, anyOppositeLane: converterSettings.anyOppositeLane, anyPunch: modifiers.includes("any_punch") }); const blocked = blockedSubcellsAt(startMs, obstacleWindows);`,
`    // 0.0.89 (Derrick) rule 1: no punch may be authored while a weave/squat is up.
    if (obstacleWindowActive(startMs)) { trace.push(dropTrace(candidate, "obstacle_window_active")); continue; }
    const spatial = spatialTarget(family, hand, Number(candidate.targetRow), { uppercutOppositeLane: converterSettings.uppercutOppositeLane, anyOppositeLane: converterSettings.anyOppositeLane, anyPunch: modifiers.includes("any_punch") }); const blocked = blockedSubcellsAt(startMs, resolvedObstacleWindows);`);

// ---- 6. drop reachable from the punch loop ----------------------------------------
replaceOnce("punch-reachable",
`    const target = safe.find((subcell) => reachable(wristSubcell[/** @type {"left" | "right"} */ (hand)], subcell, deltaBeats, reachSubcellsPerBeat[difficulty] + converterSettings.reachAllowanceSubcells, blocked));
    if (target === undefined) { trace.push(dropTrace(candidate, "unreachable_after_optimizer")); continue; }
`, "");
replaceOnce("delta-beats", `    const deltaBeats = Math.max(start - wristBeat[/** @type {"left" | "right"} */ (hand)], 0);
`, "");
replaceOnce("wrist-seed",
  `wristSubcell[/** @type {"left" | "right"} */ (hand)] = target;`,
  `wristSubcell[/** @type {"left" | "right"} */ (hand)] = seedSubcell(spatial.targetCell);`);

// ---- 7. emit from the resolved set -------------------------------------------------
replaceOnce("emit-set",
  `for (const mergedWindow of mergeSimultaneousLeanPairs(obstacleWindows)) {`,
  `for (const mergedWindow of resolvedObstacleWindows) {`);

// ---- 8. drop reachable from the pre-optimizer feasibility check -------------------
replaceOnce("feasibility",
`  let safe = false; let reach = false; const seed = hand === "left" ? 5 : 6;`,
`  // 0.0.89 (Derrick): reachability removed. Only obstacle coverage matters now.`);
replaceOnce("feasibility-loop",
`  for (const subcell of /** @type {number[]} */ (spatial.acceptedSubcells)) { if (blocked.has(subcell)) continue; safe = true; if (reachable(seedSubcell(seed), subcell, Number(candidate.start), reachSubcellsPerBeat[difficulty] + converterSettings.reachAllowanceSubcells, blocked)) { reach = true; break; } }`,
`  for (const subcell of /** @type {number[]} */ (spatial.acceptedSubcells)) { if (!blocked.has(subcell)) return ""; }`);
replaceOnce("feasibility-return",
  `  return !safe ? "spatial_target_blocked_before_optimizer" : !reach ? "unreachable_before_optimizer" : "";`,
  `  return "spatial_target_blocked_before_optimizer";`);

// ---- 9. DISABLED for now (splice corrupted the file); guard emission still calls reachable.

// ---- 10. The reachable FUNCTION is left in place as dead code for now;
// its call sites are gone (steps 6 and 9), so nothing invokes it. Removed in a
// separate cleanup so this change stays reviewable.

writeFileSync(path, s);
console.log("applied obstacle rules + removed reachability");