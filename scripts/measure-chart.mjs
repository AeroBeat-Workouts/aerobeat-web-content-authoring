// Measure obstacle + note counts for a chart, so the obstacle rules' cost is a
// reported number rather than an assumption. Usage: node scripts/measure-chart.mjs <dat>
import { readFileSync } from "node:fs";
import { parseBeatMapDifficulty } from "../src/beatmap.js";
import { convertDifficulty, deriveBeatSaberSpawnTiming } from "../src/index.js";

const path = process.argv[2];
if (!path) { console.error("usage: node scripts/measure-chart.mjs <ExpertStandard.dat>"); process.exit(2); }
const infoPath = path.replace(/ExpertStandard\.dat$/i, "info.dat");
const info = JSON.parse(readFileSync(infoPath, "utf8"));
const bpm = Number(info._beatsPerMinute ?? info._bpm);
const diff = JSON.parse(readFileSync(path, "utf8"));
const parsed = JSON.parse(JSON.stringify(parseBeatMapDifficulty(JSON.stringify(diff), "v2")));
const H = `sha256:${"0".repeat(64)}`;
const result = await convertDifficulty(parsed, {
  difficulty: "Expert", songToken: "m", songName: "m", bpm,
  noteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 0, spawnTiming: deriveBeatSaberSpawnTiming(bpm, 10, 0),
  sourceProvider: "beatsaver", sourceId: "measure", sourceVersionHash: "v",
  sourceInfoFormat: "v2", sourceInfoVersion: "2.0.0", sourceInfoHash: H,
  sourceDifficultyPath: "ExpertStandard.dat", sourceBeatmapFormat: "v2", sourceBeatmapVersion: "2.0.0",
  sourceDifficultyHash: H, notePalette: null, modifiers: ["any_punch"]
});
const boxing = result.charts.find((chart) => chart.mode === "boxing");
const obstacles = boxing.beats.filter((beat) => beat.type === "squat" || beat.type === "weave_left" || beat.type === "weave_right");
const punches = boxing.beats.filter((beat) => beat.type !== "guard" && beat.type !== "squat" && beat.type !== "weave_left" && beat.type !== "weave_right");
const kinds = {};
for (const obstacle of obstacles) kinds[obstacle.type] = (kinds[obstacle.type] ?? 0) + 1;
console.log(JSON.stringify({
  sourceNotes: parsed.colorNotes.length,
  sourceObstacleEntries: parsed.obstacles.length,
  authoredObstacles: obstacles.length,
  authoredKinds: kinds,
  authoredPunches: punches.length,
  authoredGuards: boxing.beats.filter((beat) => beat.type === "guard").length
}));