// @ts-check

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { computeBeatSaverMapHash, inspectBeatSaverArchive } from "@aerobeat/web-vendor-beatsaver";
import { createAeroWebContentAuthoringService, createMemoryPersistenceAdapter, validateAuthoredPackage } from "../src/index.js";

const cases = [
  { mapId: "4858", versionHash: "431ffaa53a1e45ffab6c81a895e456f6aad1e038", difficulty: "Expert", path: "/home/derrick/.dsh/projects/aerobeat/aerobeat-vendor-beatsaver/.testbed/.artifacts/4858/431ffaa53a1e45ffab6c81a895e456f6aad1e038/4858-431ffaa53a1e.zip" },
  { mapId: "3D44B", versionHash: "2549825187cfdf7fb2352e33a614ff3ea6d3317d", difficulty: "Hard", path: "/home/derrick/.dsh/projects/aerobeat/aerobeat-vendor-beatsaver/.testbed/.artifacts/3d44b/2549825187cfdf7fb2352e33a614ff3ea6d3317d/3d44b-2549825187cf.zip" }
];

for (const fixture of cases) {
  await access(fixture.path, constants.R_OK);
  const source = await inspectBeatSaverArchive(new Uint8Array(await readFile(fixture.path)));
  assert.equal(await computeBeatSaverMapHash(source), fixture.versionHash);
  const persistence = createMemoryPersistenceAdapter({ quotaBytes: 1024 * 1024 * 1024 });
  const service = createAeroWebContentAuthoringService({ persistence, now: () => 1 });
  const first = await service.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, { difficulty: fixture.difficulty, sourceId: fixture.mapId, sourceVersionHash: fixture.versionHash, includeAudio: false });
  const firstPackage = /** @type {{charts: {mode: string, beats: unknown[]}[]}} */ (first.package);
  assert.equal(firstPackage.charts.length, 5);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "boxing").length, 4);
  assert.equal(firstPackage.charts.filter((chart) => chart.mode === "flow").length, 1);
  assert.equal((await validateAuthoredPackage(first.package)).valid, true);
  assert.ok(firstPackage.charts.some((chart) => chart.beats.length > 0));
  const hash = first.handle.packageHash.value;
  await service.deletePackage(first.handle);
  const second = await service.convertAndPersist({ providerId: "beatsaver", sourceHash: fixture.versionHash, source }, { difficulty: fixture.difficulty, sourceId: fixture.mapId, sourceVersionHash: fixture.versionHash, includeAudio: false });
  assert.equal(second.handle.packageHash.value, hash, `${fixture.mapId} conversion must be deterministic`);
  service.destroy();
  console.log(`${fixture.mapId} ${fixture.difficulty}: ${(/** @type {{charts: unknown[]}} */ (second.package)).charts.length} charts, deterministic ${hash.slice(0, 12)}`);
}

console.log("Real BeatSaver 4858 and 3D44B provider-neutral conversion validation passed; archives remain uncommitted.");
