// @ts-check

import { isPlainRecord } from "./canonical.js";

/** @typedef {"v2" | "v3" | "v4"} BeatMapFormat */

/**
 * Parse and narrow one Beat Saber Standard difficulty document.
 *
 * @param {Uint8Array | string} input
 * @param {BeatMapFormat} format
 * @returns {Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>}
 */
export function parseBeatMapDifficulty(input, format) {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new AuthoringParseError("difficulty_json_invalid", `Difficulty JSON could not be parsed${diagnostic(cause)}`);
  }
  if (!isPlainRecord(parsed)) throw new AuthoringParseError("difficulty_shape_invalid", "Difficulty root must be a plain record");
  if (format === "v4") return freezeSummary(normalizeV4(parsed));
  if (format === "v2") return freezeSummary(normalizeV2(parsed));
  return freezeSummary(normalizeV3(parsed));
}

/** @param {Record<string, unknown>} map */
function normalizeV2(map) {
  const notes = array(map._notes ?? map.notes);
  const colorNotes = [];
  const bombNotes = [];
  let colorIndex = 0;
  for (const entry of notes) {
    if (!isPlainRecord(entry)) continue;
    const type = integer(entry._type ?? entry.type, -1);
    const x = integer(entry._lineIndex ?? entry.lineIndex, 0);
    const y = integer(entry._lineLayer ?? entry.lineLayer, 0);
    if (type === 0 || type === 1) {
      colorNotes.push(noteRecord(colorIndex++, number(entry._time ?? entry.b, 0), x, y, type, integer(entry._cutDirection ?? entry.cutDirection, 8), 0, false));
    } else if (type === 3) {
      bombNotes.push({ start: number(entry._time ?? entry.b, 0), x, y, cell: cellFromXY(x, y) });
    }
  }
  const obstacles = array(map._obstacles ?? map.obstacles).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const legacyType = integer(entry._type ?? entry.type, 0);
    return [{
      start: number(entry._time ?? entry.b, 0),
      duration: number(entry._duration ?? entry.d, 0),
      x: integer(entry._lineIndex ?? entry.x, 0),
      y: legacyType === 1 ? 2 : 0,
      width: Math.max(integer(entry._width ?? entry.w, 1), 1),
      height: legacyType === 1 ? 1 : 3
    }];
  });
  const sliders = array(map._sliders ?? map.sliders).flatMap((entry) => isPlainRecord(entry) ? [{
    start: number(entry._headTime ?? entry.b, 0),
    end: number(entry._tailTime ?? entry.tb ?? entry._headTime ?? entry.b, 0),
    cell: cellFromXY(integer(entry._headLineIndex ?? entry.x, 0), integer(entry._headLineLayer ?? entry.y, 0)),
    tailCell: cellFromXY(integer(entry._tailLineIndex ?? entry.tx, 0), integer(entry._tailLineLayer ?? entry.ty, 0)),
    hand: handFromColor(integer(entry._colorType ?? entry.c, 0)),
    direction: integer(entry._headCutDirection ?? entry.d, 8),
    tailDirection: integer(entry._tailCutDirection ?? entry.tc ?? entry._headCutDirection ?? entry.d, 8),
    headCurveMultiplier: number(entry._headControlPointLengthMultiplier ?? entry.mu, 1),
    tailCurveMultiplier: number(entry._tailControlPointLengthMultiplier ?? entry.tmu, 1),
    midAnchorMode: integer(entry._sliderMidAnchorMode ?? entry.m, 0)
  }] : []);
  return { colorNotes, bombNotes, obstacles, sliders, burstSliders: [] };
}

/** @param {Record<string, unknown>} map */
function normalizeV3(map) {
  const colorNotes = array(map.colorNotes).flatMap((entry, sourceIndex) => {
    if (!isPlainRecord(entry)) return [];
    const x = integer(entry.x, 0); const y = integer(entry.y, 0); const color = integer(entry.c, 0);
    return [noteRecord(sourceIndex, number(entry.b, 0), x, y, color, integer(entry.d, 8), number(entry.a, 0), Object.hasOwn(entry, "a"))];
  });
  const bombNotes = array(map.bombNotes).flatMap((entry) => isPlainRecord(entry) ? [{ start: number(entry.b, 0), x: integer(entry.x, 0), y: integer(entry.y, 0), cell: cellFromXY(integer(entry.x, 0), integer(entry.y, 0)) }] : []);
  const obstacles = array(map.obstacles).flatMap((entry) => isPlainRecord(entry) ? [{ start: number(entry.b, 0), duration: number(entry.d, 0), x: integer(entry.x, 0), y: integer(entry.y, 0), width: integer(entry.w, 1), height: integer(entry.h, 1) }] : []);
  const sliders = array(map.sliders).flatMap((entry) => isPlainRecord(entry) ? [{ start: number(entry.b, 0), end: number(entry.tb ?? entry.b, 0), cell: cellFromXY(integer(entry.x, 0), integer(entry.y, 0)), tailCell: cellFromXY(integer(entry.tx, 0), integer(entry.ty, 0)), hand: handFromColor(integer(entry.c, 0)), direction: integer(entry.d, 8), tailDirection: integer(entry.tc ?? entry.d, 8), headCurveMultiplier: number(entry.mu, 1), tailCurveMultiplier: number(entry.tmu, 1), midAnchorMode: integer(entry.m, 0) }] : []);
  const burstSliders = array(map.burstSliders).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const result = { start: number(entry.b, 0), end: number(entry.tb ?? entry.b, 0), cell: cellFromXY(integer(entry.x, 0), integer(entry.y, 0)), tailCell: cellFromXY(integer(entry.tx, 0), integer(entry.ty, 0)), hand: handFromColor(integer(entry.c, 0)), direction: integer(entry.d, 8), sliceCount: Math.max(integer(entry.sc, 1), 1) };
    if (Object.hasOwn(entry, "s")) Object.assign(result, { spacingBias: number(entry.s, 0) });
    return [result];
  });
  return { colorNotes, bombNotes, obstacles, sliders, burstSliders };
}

/** @param {Record<string, unknown>} map */
function normalizeV4(map) {
  const noteData = records(map.colorNotesData);
  const colorNotes = array(map.colorNotes).flatMap((entry, sourceIndex) => {
    if (!isPlainRecord(entry)) return [];
    const metadata = metadataAt(noteData, integer(entry.i, -1));
    const x = intField(entry, metadata, "x", 0); const y = intField(entry, metadata, "y", 0); const color = intField(entry, metadata, "c", 0);
    return [noteRecord(sourceIndex, number(entry.b, 0), x, y, color, intField(entry, metadata, "d", 8), floatField(entry, metadata, "a", 0), Object.hasOwn(entry, "a") || Object.hasOwn(metadata, "a"))];
  });
  const bombData = records(map.bombNotesData);
  const bombNotes = array(map.bombNotes).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const metadata = metadataAt(bombData, integer(entry.i, -1)); const x = intField(entry, metadata, "x", 0); const y = intField(entry, metadata, "y", 0);
    return [{ start: number(entry.b, 0), x, y, cell: cellFromXY(x, y) }];
  });
  const obstacleData = records(map.obstaclesData);
  const obstacles = array(map.obstacles).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const metadata = metadataAt(obstacleData, integer(entry.i, -1));
    return [{ start: number(entry.b, 0), duration: floatField(entry, metadata, "d", 0), x: intField(entry, metadata, "x", 0), y: intField(entry, metadata, "y", 0), width: intField(entry, metadata, "w", 1), height: intField(entry, metadata, "h", 1) }];
  });
  const arcData = records(map.arcsData);
  const sliders = array(map.arcs).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const head = metadataAt(noteData, integer(entry.hi, -1)); const tail = metadataAt(noteData, integer(entry.ti, -1)); const metadata = metadataAt(arcData, integer(entry.ai, -1));
    return [{ start: number(entry.hb, 0), end: number(entry.tb ?? entry.hb, 0), cell: cellFromXY(intField(head, {}, "x", 0), intField(head, {}, "y", 0)), tailCell: cellFromXY(intField(tail, {}, "x", 0), intField(tail, {}, "y", 0)), hand: handFromColor(intField(head, {}, "c", 0)), direction: intField(head, {}, "d", 8), tailDirection: intField(tail, {}, "d", 8), headCurveMultiplier: floatField(metadata, {}, "m", 1), tailCurveMultiplier: floatField(metadata, {}, "tm", 1), midAnchorMode: intField(metadata, {}, "a", 0) }];
  });
  const chainData = records(map.chainsData);
  const burstSliders = array(map.chains).flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const head = metadataAt(noteData, integer(entry.i, -1)); const metadata = metadataAt(chainData, integer(entry.ci, -1));
    const result = { start: number(entry.hb, 0), end: number(entry.tb ?? entry.hb, 0), cell: cellFromXY(intField(head, {}, "x", 0), intField(head, {}, "y", 0)), tailCell: cellFromXY(intField(metadata, {}, "tx", 0), intField(metadata, {}, "ty", 0)), hand: handFromColor(intField(head, {}, "c", 0)), direction: intField(head, {}, "d", 8), sliceCount: Math.max(intField(metadata, {}, "c", 1), 1) };
    if (Object.hasOwn(metadata, "s")) Object.assign(result, { spacingBias: number(metadata.s, 0) });
    return [result];
  });
  return { colorNotes, bombNotes, obstacles, sliders, burstSliders };
}

/** @param {number} sourceIndex @param {number} start @param {number} x @param {number} y @param {number} color @param {number} direction @param {number} angleOffset @param {boolean} hasAngleOffset */
function noteRecord(sourceIndex, start, x, y, color, direction, angleOffset, hasAngleOffset) { return { sourceIndex, start, x, y, cell: cellFromXY(x, y), color, hand: handFromColor(color), direction, angleOffset, hasAngleOffset }; }
/** @param {number} x @param {number} y */
function cellFromXY(x, y) { return clampInt(y, 0, 2) * 4 + clampInt(x, 0, 3); }
/** @param {number} color */
function handFromColor(color) { return color === 0 ? "left" : "right"; }
/** @param {unknown} value */
function array(value) { return Array.isArray(value) ? value : []; }
/** @param {unknown} value */
function records(value) { return array(value).filter(isPlainRecord); }
/** @param {Record<string, unknown>[]} recordsValue @param {number} index */
function metadataAt(recordsValue, index) { return index < 0 || index >= recordsValue.length ? {} : recordsValue[index]; }
/** @param {Record<string, unknown>} primary @param {Record<string, unknown>} fallback @param {string} key @param {number} defaultValue */
function intField(primary, fallback, key, defaultValue) { return integer(Object.hasOwn(primary, key) ? primary[key] : fallback[key], defaultValue); }
/** @param {Record<string, unknown>} primary @param {Record<string, unknown>} fallback @param {string} key @param {number} defaultValue */
function floatField(primary, fallback, key, defaultValue) { return number(Object.hasOwn(primary, key) ? primary[key] : fallback[key], defaultValue); }
/** @param {unknown} value @param {number} fallback */
function number(value, fallback) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
/** @param {unknown} value @param {number} fallback */
function integer(value, fallback) { return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback; }
/** @param {number} value @param {number} minimum @param {number} maximum */
function clampInt(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, Math.trunc(value))); }
/** @param {Record<string, readonly Readonly<Record<string, unknown>>[]>} summary */
function freezeSummary(summary) { for (const values of Object.values(summary)) { for (const value of values) Object.freeze(value); Object.freeze(values); } return Object.freeze(summary); }
/** @param {unknown} cause */
function diagnostic(cause) { return cause instanceof Error && cause.message ? `: ${cause.message}` : ""; }

export class AuthoringParseError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.name = "AuthoringParseError"; this.code = code; }
}
