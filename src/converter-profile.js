// @ts-check

import { canonicalJson, deepFreeze, isPlainRecord, sha256Hex } from "./canonical.js";

export const converterProfileClass = "converter_regeneration";
export const canonicalConverterProfile = deepFreeze({ schema: "aerobeat/prototype_profile", version: 1, profileId: "aero.converter.canonical", profileVersion: "1.0.0", class: converterProfileClass, label: "Canonical Converter (Experimental)", experimental: true, settings: { guardRelocationRadius: 1, reachAllowanceSubcells: 0, guardSpacing: 1, uppercutOppositeLane: false, anyOppositeLane: true }, contentHash: "30428615e19b695e31b2b7ce931f692d541bfb5daf73c46c5db77ee9c76b4895" });
export const prototypeReachConverterProfile = deepFreeze({ schema: "aerobeat/prototype_profile", version: 1, profileId: "aero.converter.prototype-reach", profileVersion: "1.0.0", class: converterProfileClass, label: "Prototype Reach Converter (Experimental)", experimental: true, settings: { guardRelocationRadius: 2, reachAllowanceSubcells: 1, guardSpacing: 1, uppercutOppositeLane: false, anyOppositeLane: true }, contentHash: "152e8d9a5c208605dcd36521d4befbc8c7868cdaac66ed4d552025feb560c56c" });

/**
 * Normalize and cryptographically verify one exact experimental converter profile.
 * The label is display-only; identity hashes exact schema/version/id/version/class/settings.
 *
 * @param {unknown} value
 */
export async function normalizeConverterProfile(value) {
  if (!exactKeys(value, ["schema", "version", "profileId", "profileVersion", "class", "label", "experimental", "settings", "contentHash"])) throw profileError("converter_profile_invalid", "Converter profile must contain the exact bounded profile fields");
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.schema !== "aerobeat/prototype_profile" || record.version !== 1 || record.class !== converterProfileClass || record.experimental !== true) throw profileError("converter_profile_invalid", "Converter profile schema, version, class and experimental truth are required");
  const profileId = boundedString(record.profileId, "profileId", 128);
  const profileVersion = boundedString(record.profileVersion, "profileVersion", 64);
  const label = boundedString(record.label, "label", 256);
  if (!onlySettingsKeys(record.settings, ["guardRelocationRadius", "reachAllowanceSubcells"], ["guardSpacing", "uppercutOppositeLane", "anyOppositeLane"])) throw profileError("converter_profile_settings_invalid", "Converter profile settings must contain only supported fields");
  const sourceSettings = /** @type {Record<string, unknown>} */ (record.settings);
  const settings = deepFreeze({ guardRelocationRadius: boundedInteger(sourceSettings.guardRelocationRadius, "guardRelocationRadius", 0, 8), reachAllowanceSubcells: boundedInteger(sourceSettings.reachAllowanceSubcells, "reachAllowanceSubcells", 0, 8), ...(Object.hasOwn(sourceSettings, "guardSpacing") ? { guardSpacing: boundedInteger(sourceSettings.guardSpacing, "guardSpacing", 0, 2) } : {}), ...(Object.hasOwn(sourceSettings, "uppercutOppositeLane") ? { uppercutOppositeLane: boundedBoolean(sourceSettings.uppercutOppositeLane, "uppercutOppositeLane") } : {}), ...(Object.hasOwn(sourceSettings, "anyOppositeLane") ? { anyOppositeLane: boundedBoolean(sourceSettings.anyOppositeLane, "anyOppositeLane") } : {}) });
  const hashBody = deepFreeze({ schema: "aerobeat/prototype_profile", version: 1, profileId, profileVersion, class: converterProfileClass, settings });
  const contentHash = await sha256Hex(canonicalJson(hashBody));
  if (record.contentHash !== contentHash) throw profileError("converter_profile_hash_mismatch", "Converter profile content hash does not match its canonical identity and settings");
  return deepFreeze({ ...hashBody, label, experimental: true, contentHash });
}

/** @param {unknown} value @param {readonly string[]} keys */
function exactKeys(value, keys) {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every((key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor && descriptor.enumerable && descriptor.value !== undefined; });
}
/** @param {unknown} value @param {readonly string[]} required @param {readonly string[]} optional */
function onlySettingsKeys(value, required, optional) {
  if (!isPlainRecord(value) || required.some((key) => !Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return Reflect.ownKeys(value).every((key) => { if (typeof key !== "string" || !allowed.has(key)) return false; const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor && descriptor.enumerable && descriptor.value !== undefined; });
}
/** @param {unknown} value @param {string} field */
function boundedBoolean(value, field) { if (typeof value !== "boolean") throw profileError("converter_profile_settings_invalid", `${field} must be a boolean`); return value; }
/** @param {unknown} value @param {string} field @param {number} maximum */
function boundedString(value, field, maximum) { if (typeof value !== "string" || !value || value.length > maximum) throw profileError("converter_profile_invalid", `${field} must be a bounded non-empty string`); return value; }
/** @param {unknown} value @param {string} field @param {number} minimum @param {number} maximum */
function boundedInteger(value, field, minimum, maximum) { if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw profileError("converter_profile_settings_invalid", `${field} must be an integer from ${minimum} through ${maximum}`); return Number(value); }
/** @param {string} code @param {string} message */
function profileError(code, message) { const error = new Error(message); error.name = "AeroConverterProfileError"; Object.assign(error, { code }); return error; }
