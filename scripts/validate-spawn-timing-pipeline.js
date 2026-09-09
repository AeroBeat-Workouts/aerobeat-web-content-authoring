// @ts-nocheck

import assert from "node:assert/strict";
import { createAeroWebContentAuthoringService, inspectAuthoredPackageExport, validateAuthoredPackage } from "../src/index.js";
const {createSyntheticBeatSaverZip}=await import(String(new URL("../../aerobeat-web-vendor-beatsaver/scripts/fixture-helpers.js",import.meta.url)));
const {inspectBeatSaverArchive}=await import(String(new URL("../../aerobeat-web-vendor-beatsaver/src/index.js",import.meta.url)));
const {createAeroContentRuntime}=await import(String(new URL("../../aerobeat-web-content/src/index.js",import.meta.url)));

const archive=createSyntheticBeatSaverZip(2,{mutateInfo(info){const sets=/** @type {Record<string,unknown>[]} */(info._difficultyBeatmapSets),maps=/** @type {Record<string,unknown>[]} */(sets[0]._difficultyBeatmaps),difficulty=maps[0];info._beatsPerMinute=150;difficulty._noteJumpMovementSpeed=10;difficulty._noteJumpStartBeatOffset=1;}});
const source=await inspectBeatSaverArchive(archive);
assert.deepEqual([source.manifest.bpm,source.manifest.difficulties[0]?.noteJumpMovementSpeed,source.manifest.difficulties[0]?.noteJumpStartBeatOffset],[150,10,1]);
const authoring=createAeroWebContentAuthoringService({now:()=>1});
const authored=await authoring.convertAndPersist({source},{difficulty:"Expert",sourceProvider:"synthetic",sourceId:"spawn-pipeline",sourceVersionHash:"fixture-v1",includeAudio:true});
assert.deepEqual([authored.package.schemaId,authored.package.schemaVersion,authored.package.packageVersion],["aerobeat.song-package.v6",6,"6.0.0"]);
assert.deepEqual([authored.package.source.spawnTiming.halfJumpDurationBeats,authored.package.source.spawnTiming.reactionTimeMs,authored.package.source.spawnTiming.jumpDistanceMeters],[5,2000,40]);
const validation=await validateAuthoredPackage(authored.package);assert.equal(validation.valid,true);assert.equal(authored.handle.packageHash.value,validation.packageHash?.slice(7));
const reloaded=await authoring.loadPackage(authored.handle);assert.deepEqual(reloaded.package,authored.package);
const exported=await authoring.exportPackage(authored.handle);const inspected=await inspectAuthoredPackageExport(exported.bytes);assert.equal(inspected.packageHash,`sha256:${authored.handle.packageHash.value}`);
const runtime=createAeroContentRuntime({persistenceResolver:authoring});await assert.rejects(()=>runtime.loadPersistenceHandle(authored.handle),(error)=>error?.code==="package_schema_invalid","historical content runtime must fail closed on the successor package instead of silently promoting it");runtime.destroy();authoring.destroy();
console.log("Synthetic ZIP → manifest → Worker → v6 package hash → persist/reload/export passed; historical content runtime rejected the successor schema fail-closed.");
