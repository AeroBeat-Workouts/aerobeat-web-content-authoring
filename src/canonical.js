// @ts-check

/**
 * Deterministically serialize JSON-compatible data with lexically sorted object keys.
 * Undefined, functions, symbols, accessors, cycles and non-finite numbers are rejected.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return serialize(value, new Set());
}

/**
 * @param {unknown} value
 * @param {Set<object>} seen
 * @returns {string}
 */
function serialize(value, seen) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON rejects non-finite numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("Canonical JSON accepts ordinary arrays only");
    if (seen.has(value)) throw new TypeError("Canonical JSON rejects cycles");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string" || (key !== "length" && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)))) throw new TypeError("Canonical JSON rejects extended arrays");
    seen.add(value);
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value === undefined) throw new TypeError("Canonical JSON rejects sparse arrays, accessors and undefined values");
      parts.push(serialize(descriptor.value, seen));
    }
    seen.delete(value);
    return `[${parts.join(",")}]`;
  }
  if (!isPlainRecord(value)) {
    throw new TypeError("Canonical JSON accepts plain data records only");
  }
  if (seen.has(value)) throw new TypeError("Canonical JSON rejects cycles");
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new TypeError("Canonical JSON rejects symbol keys");
  }
  const stringKeys = /** @type {string[]} */ (keys);
  stringKeys.sort();
  const parts = [];
  for (const key of stringKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value === undefined) {
      throw new TypeError("Canonical JSON rejects accessors and undefined values");
    }
    parts.push(`${JSON.stringify(key)}:${serialize(descriptor.value, seen)}`);
  }
  seen.delete(value);
  return `{${parts.join(",")}}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {string | Uint8Array} value
 * @returns {Promise<string>}
 */
export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 is unavailable in this browser context");
  const digest = await subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string | Uint8Array} value
 * @returns {Promise<string>}
 */
export async function prefixedSha256(value) {
  return `sha256:${await sha256Hex(value)}`;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function cloneData(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
  }
  return value;
}
