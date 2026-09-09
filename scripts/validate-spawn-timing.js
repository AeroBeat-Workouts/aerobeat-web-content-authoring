// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveBeatSaberSpawnTiming, parseBeatMapDifficulty, verifyBeatSaberSpawnTiming } from "../src/index.js";

const fixture=JSON.parse(await readFile(new URL("../fixtures/spawn-timing-3c9d-standard-v1.json",import.meta.url),"utf8"));
assert.deepEqual([fixture.schema,fixture.version,fixture.source.bpm],["aerobeat/spawn_timing_fixture",1,150]);
for(const row of fixture.difficulties){const actual=deriveBeatSaberSpawnTiming(fixture.source.bpm,row.njs,row.offset);assert.deepEqual({difficulty:row.difficulty,njs:actual.noteJumpMovementSpeed,offset:actual.noteJumpStartBeatOffset,halfJumpDurationBeats:actual.halfJumpDurationBeats},{difficulty:row.difficulty,njs:row.njs,offset:row.offset,halfJumpDurationBeats:row.halfJumpDurationBeats});assert.ok(Math.abs(actual.reactionTimeMs-row.reactionTimeMs)<1e-9);assert.ok(Math.abs(actual.jumpDistanceMeters-row.jumpDistanceMeters)<1e-9);assert.deepEqual(verifyBeatSaberSpawnTiming(actual),actual);}
const threshold=deriveBeatSaberSpawnTiming(60,4.49975,0);assert.deepEqual([threshold.halfJumpDurationBeats,threshold.reactionTimeMs,threshold.jumpDistanceMeters],[4,4000,35.998]);
const aboveThreshold=deriveBeatSaberSpawnTiming(60,4.5,0);assert.deepEqual([aboveThreshold.halfJumpDurationBeats,aboveThreshold.reactionTimeMs,aboveThreshold.jumpDistanceMeters],[2,2000,18]);
const preOffsetMinimum=deriveBeatSaberSpawnTiming(60,100,0);assert.equal(preOffsetMinimum.halfJumpDurationBeats,1);
const negativeClamp=deriveBeatSaberSpawnTiming(120,10,-100);assert.deepEqual([negativeClamp.halfJumpDurationBeats,negativeClamp.reactionTimeMs,negativeClamp.jumpDistanceMeters],[.25,125,2.5]);
for(const values of [[0,10,0],[120,0,0],[120,10,Number.NaN]])assert.throws(()=>deriveBeatSaberSpawnTiming(values[0],values[1],values[2]),/must be/u);
for(const mutate of [(value)=>{delete value.noteJumpStartBeatOffset;},(value)=>{value.extra=true;},(value)=>{value.reactionTimeMs+=1;},(value)=>{value.maxHalfJumpDistance=18;}]){const value=structuredClone(deriveBeatSaberSpawnTiming(150,10,1));mutate(value);assert.throws(()=>verifyBeatSaberSpawnTiming(value));}
const relativeNjsV41={version:"4.1.0",colorNotes:[],colorNotesData:[],bombNotes:[],bombNotesData:[],obstacles:[],obstaclesData:[],arcs:[],chains:[],njsEvents:[{b:1,i:0}],njsEventData:[{p:1}]};
assert.throws(()=>parseBeatMapDifficulty(JSON.stringify(relativeNjsV41),"v4"),(error)=>error instanceof Error&&"code" in error&&error.code==="relative_njs_events_unsupported");
console.log("Spawn timing exact fixtures, threshold, clamp, schema, invalid-data, and v4.1 rejection validation passed.");
