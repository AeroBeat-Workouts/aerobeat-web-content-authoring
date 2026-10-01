// Regenerate the frozen Boxing golden from CURRENT converter output.
// 0.0.89 (Derrick, approved): a both-hands beat group now resolves to the guard
// ALONE; it no longer also emits one punch. The fixture previously recorded both.
import { readFileSync, writeFileSync } from "node:fs";
import { convertDifficulty, deriveBeatSaberSpawnTiming } from "../src/index.js";

const path = new URL("../fixtures/boxing-prototype-golden-v1.json", import.meta.url);
const g = JSON.parse(readFileSync(path, "utf8"));
const H = `sha256:${"0".repeat(64)}`;
const result = await convertDifficulty(g.sourceSummary, {
  difficulty: "Hard", songToken: g.songToken, songName: "S", bpm: g.bpm,
  noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 1, spawnTiming: deriveBeatSaberSpawnTiming(g.bpm, 10, 1),
  sourceProvider: "synthetic", sourceId: "golden", sourceVersionHash: "synthetic-v1",
  sourceInfoFormat: "v2", sourceInfoVersion: "2.1.0", sourceInfoHash: H,
  sourceDifficultyPath: "Hard.dat", sourceBeatmapFormat: "v3", sourceBeatmapVersion: "3.0.0",
  sourceDifficultyHash: H, notePalette: null
});
const boxing = result.charts.find((chart) => chart.mode === "boxing");
g.godotExpected.rowTypes = boxing.beats.map((beat) => beat.type);
g.godotExpected.rowEventIds = boxing.beats.map((beat) => beat.eventId);
writeFileSync(path, `${JSON.stringify(g, null, 2)}\n`);
console.log("rowTypes  ->", g.godotExpected.rowTypes.join(", "));
console.log("eventIds  ->", g.godotExpected.rowEventIds.length, "ids");
