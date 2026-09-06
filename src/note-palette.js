// @ts-check

import { isAuthoredNotePalette, isSourceNotePalette } from "@aerobeat/web-contracts/note-palette-contracts";
import { canonicalJson, cloneData, prefixedSha256 } from "./canonical.js";

/** @typedef {import("@aerobeat/web-contracts/note-palette-contracts").AeroSourceNotePalette} AeroSourceNotePalette */
/** @typedef {import("@aerobeat/web-contracts/note-palette-contracts").AeroAuthoredNotePalette} AeroAuthoredNotePalette */

/**
 * Independently narrow one vendor-provided palette and bind it to hashes computed
 * from the exact Info.dat and selected difficulty bytes.
 *
 * @param {unknown} value
 * @param {{infoFormat:"v2"|"v4",infoHash:string,difficultyHash:string}} binding
 * @returns {AeroSourceNotePalette | null}
 */
export function verifySourceNotePalette(value, binding) {
  if (value === null) return null;
  if (!isSourceNotePalette(value)) throw paletteError("source_palette_invalid", "Source note palette shape is invalid");
  const copy = /** @type {AeroSourceNotePalette} */ (cloneData(value));
  if (!isSourceNotePalette(copy)) throw paletteError("source_palette_invalid", "Source note palette is not clone-stable plain data");
  if (copy.provenance.infoFormat !== binding.infoFormat || copy.provenance.infoHash !== binding.infoHash || copy.provenance.difficultyHash !== binding.difficultyHash) {
    throw paletteError("source_palette_provenance_mismatch", "Source note palette provenance does not match the exact selected source bytes");
  }
  return copy;
}

/** @param {AeroSourceNotePalette | null} sourcePalette @returns {Promise<AeroAuthoredNotePalette | null>} */
export async function createAuthoredNotePalette(sourcePalette) {
  if (sourcePalette === null) return null;
  const base = {
    schema: /** @type {const} */ ("aerobeat/authored_note_palette"),
    version: /** @type {const} */ (1),
    left: sourcePalette.left,
    right: sourcePalette.right,
    colorSpace: /** @type {const} */ ("srgb"),
    alpha: /** @type {const} */ (1),
    provenance: cloneData(sourcePalette.provenance)
  };
  const paletteHash = await prefixedSha256(canonicalJson(base));
  const result = /** @type {AeroAuthoredNotePalette} */ ({ ...base, paletteHash });
  if (!isAuthoredNotePalette(result)) throw paletteError("authored_palette_invalid", "Authored note palette shape is invalid");
  return result;
}

/** @param {unknown} value @returns {Promise<boolean>} */
export async function verifyAuthoredNotePalette(value) {
  if (value === null) return true;
  if (!isAuthoredNotePalette(value)) return false;
  const base = {
    schema: value.schema,
    version: value.version,
    left: value.left,
    right: value.right,
    colorSpace: value.colorSpace,
    alpha: value.alpha,
    provenance: value.provenance
  };
  return value.paletteHash === await prefixedSha256(canonicalJson(base));
}

/** @param {AeroAuthoredNotePalette | null} value */
export function flowPaletteReference(value) {
  return value === null ? null : { source: "package", paletteHash: value.paletteHash };
}

/** @param {string} code @param {string} message */
function paletteError(code, message) {
  const error = new Error(message);
  error.name = "AeroAuthoringPaletteError";
  Object.assign(error, { code });
  return error;
}
