// @ts-check

import { isObstacleSourceGeometry } from "@aerobeat/web-contracts/obstacle-contracts";
import { isPlainRecord } from "./canonical.js";

/**
 * Authoring accepts exact original Beat Saber obstacle evidence even when a
 * mapper places decorative walls outside the playable lanes. The shared
 * contract's in-grid guard remains unchanged for historical in-grid records;
 * this local extension validates the original unbounded integer rectangle.
 * @param {unknown} value
 * @returns {value is import("@aerobeat/web-contracts/obstacle-contracts").AeroObstacleSourceGeometry}
 */
export function isAuthoredObstacleSourceGeometry(value) {
  if (isObstacleSourceGeometry(value)) return true;
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== 8 ||
      !["schema", "version", "coordinateSpace", "kind", "x", "y", "width", "height"].every((key) => Object.hasOwn(value, key))) return false;
  if (value.schema !== "aerobeat/obstacle_source_geometry" || value.version !== 1) return false;
  if (![
    "beatsaber_v2_legacy_obstacle|v2_type_0",
    "beatsaber_v2_legacy_obstacle|v2_type_1",
    "beatsaber_v3_obstacle_rect|v3_rect",
    "beatsaber_v4_obstacle_rect|v4_rect"
  ].includes(`${value.coordinateSpace}|${value.kind}`)) return false;
  return [value.x, value.y, value.width, value.height].every(Number.isSafeInteger) &&
    Number(value.width) > 0 && Number(value.height) > 0 &&
    Number.isSafeInteger(Number(value.x) + Number(value.width)) &&
    Number.isSafeInteger(Number(value.y) + Number(value.height));
}
