// @ts-check

import { canonicalJson, cloneData, deepFreeze, isPlainRecord } from "./canonical.js";

export const beatSaberSpawnTimingConstants = Object.freeze({
  schema: "aerobeat/beatsaber_spawn_timing",
  version: 1,
  algorithm: "beatsaber_core_hjd_v1",
  maxHalfJumpDistance: 17.999,
  startHalfJumpDurationBeats: 4,
  minimumHalfJumpDurationBeats: 0.25
});

const exactKeys = Object.freeze([
  "schema", "version", "algorithm", "bpm", "noteJumpMovementSpeed", "noteJumpStartBeatOffset",
  "maxHalfJumpDistance", "startHalfJumpDurationBeats", "minimumHalfJumpDurationBeats",
  "halfJumpDurationBeats", "reactionTimeMs", "jumpDistanceMeters"
]);

/**
 * Derive the pinned Beat Saber half-jump timing in the exact documented order.
 * @param {number} bpm
 * @param {number} noteJumpMovementSpeed
 * @param {number} noteJumpStartBeatOffset
 */
export function deriveBeatSaberSpawnTiming(bpm, noteJumpMovementSpeed, noteJumpStartBeatOffset) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw spawnError("spawn_timing_bpm_invalid", "Spawn timing BPM must be finite and positive");
  if (!Number.isFinite(noteJumpMovementSpeed) || noteJumpMovementSpeed <= 0) throw spawnError("spawn_timing_njs_invalid", "Spawn timing NJS must be finite and positive");
  if (!Number.isFinite(noteJumpStartBeatOffset)) throw spawnError("spawn_timing_offset_invalid", "Spawn timing offset must be finite");
  const secondsPerBeat = 60 / bpm;
  let halfJumpDurationBeats = Number(beatSaberSpawnTimingConstants.startHalfJumpDurationBeats);
  while (noteJumpMovementSpeed * secondsPerBeat * halfJumpDurationBeats > beatSaberSpawnTimingConstants.maxHalfJumpDistance) halfJumpDurationBeats /= 2;
  if (halfJumpDurationBeats < 1) halfJumpDurationBeats = 1;
  halfJumpDurationBeats += noteJumpStartBeatOffset;
  if (halfJumpDurationBeats < beatSaberSpawnTimingConstants.minimumHalfJumpDurationBeats) halfJumpDurationBeats = beatSaberSpawnTimingConstants.minimumHalfJumpDurationBeats;
  const reactionTimeMs = secondsPerBeat * halfJumpDurationBeats * 1000;
  const jumpDistanceMeters = noteJumpMovementSpeed * (reactionTimeMs / 1000) * 2;
  return deepFreeze({
    ...beatSaberSpawnTimingConstants,
    bpm,
    noteJumpMovementSpeed,
    noteJumpStartBeatOffset,
    halfJumpDurationBeats,
    reactionTimeMs,
    jumpDistanceMeters
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, unknown>>} */
export function verifyBeatSaberSpawnTiming(value) {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== exactKeys.length || !exactKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && descriptor.enumerable);
  })) throw spawnError("spawn_timing_invalid", "Spawn timing must contain the exact v1 fields");
  const record = /** @type {Record<string, unknown>} */ (value);
  const expected = deriveBeatSaberSpawnTiming(Number(record.bpm), Number(record.noteJumpMovementSpeed), Number(record.noteJumpStartBeatOffset));
  if (canonicalJson(record) !== canonicalJson(expected)) throw spawnError("spawn_timing_mismatch", "Spawn timing raw and derived values do not match the pinned algorithm");
  return /** @type {Readonly<Record<string, unknown>>} */ (deepFreeze(cloneData(expected)));
}

/** @param {string} code @param {string} message */
function spawnError(code, message) { const error = new Error(message); error.name = "AeroBeatSpawnTimingError"; Object.assign(error, { code }); return error; }
