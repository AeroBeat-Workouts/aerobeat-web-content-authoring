// @ts-nocheck

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, createAeroWebContentAuthoringService, inspectAuthoredPackageExport, prefixedSha256, validateAuthoredPackage } from "../src/index.js";
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
const runtime=createAeroContentRuntime({persistenceResolver:authoring});await runtime.loadPersistenceHandle(authored.handle);const snapshot=runtime.getSnapshot(),spawnSymbol=Symbol.for("aerobeat.web-content.internal-spawn-timing"),runtimeTiming=runtime[spawnSymbol](snapshot.generation);assert.deepEqual([runtimeTiming?.halfJumpDurationBeats,runtimeTiming?.reactionTimeMs,runtimeTiming?.jumpDistanceMeters],[5,2000,40],"current sibling integration must accept exact v6 and preserve authored timing");runtime.destroy();

const historicalOracle=JSON.parse(await readFile(new URL("../fixtures/historical-content-runtime-v5-oracle.json",import.meta.url),"utf8")),fixtureHash=historicalOracle.fixtureHash;delete historicalOracle.fixtureHash;assert.equal(await prefixedSha256(canonicalJson(historicalOracle)),fixtureHash,"historical consumer oracle must remain hash-pinned and independent of sibling edits");
assert.doesNotThrow(()=>validateHistoricalPackageTuple(historicalOracle.acceptedPackage,historicalOracle));
assert.throws(()=>validateHistoricalPackageTuple(authored.package,historicalOracle),(error)=>error?.code===historicalOracle.rejectedSuccessor.errorCode,"pinned v5-only consumer must reject v6 regardless of current sibling support");
const simulatedFutureConsumer={accepts:(_package)=>true};assert.equal(simulatedFutureConsumer.accepts(authored.package),true);assert.equal(simulatedFutureConsumer.accepts({...authored.package,schemaId:"aerobeat.song-package.v7",schemaVersion:7,packageVersion:"7.0.0"}),true);assert.throws(()=>validateHistoricalPackageTuple(authored.package,historicalOracle),(error)=>error?.code==="package_schema_invalid","advancing a current consumer must not mutate historical fail-closed evidence");
authoring.destroy();
console.log(`Synthetic ZIP → Worker → v6 hash/persist/export/current-runtime integration passed; immutable historical-v5 oracle ${fixtureHash} rejected v6 fail-closed.`);

function validateHistoricalPackageTuple(packageValue,oracle){const expected=oracle.acceptedPackage;if(packageValue.schemaId===expected.schemaId&&packageValue.schemaVersion===expected.schemaVersion&&packageValue.packageVersion===expected.packageVersion)return;const error=new Error("Historical content consumer does not support this package generation");Object.assign(error,{code:oracle.rejectedSuccessor.errorCode});throw error;}
