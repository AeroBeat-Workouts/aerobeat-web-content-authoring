// @ts-check

import { canonicalJson, sha256Hex } from "./canonical.js";

const magic = new TextEncoder().encode("AEROPKG1");

/**
 * Deterministically export one validated record. The format is:
 * 8-byte ASCII magic, uint32 little-endian metadata length, canonical UTF-8 metadata,
 * then asset bytes in lexicographic path order. Metadata records offsets and hashes.
 *
 * @param {{package: Record<string, unknown>, packageHash: string, assets: readonly {path: string, bytes: Uint8Array}[]}} record
 */
export async function exportAuthoredPackage(record) {
  const assets = [...record.assets].sort((a, b) => a.path.localeCompare(b.path));
  let offset = 0;
  const table = [];
  for (const asset of assets) {
    table.push({ path: asset.path, offset, byteLength: asset.bytes.byteLength, sha256: await sha256Hex(asset.bytes) });
    offset += asset.bytes.byteLength;
  }
  const metadata = new TextEncoder().encode(canonicalJson({ schema: "aerobeat/authored_package_export", version: 1, packageHash: record.packageHash, package: record.package, assets: table }));
  const output = new Uint8Array(magic.byteLength + 4 + metadata.byteLength + offset);
  output.set(magic, 0); new DataView(output.buffer).setUint32(magic.byteLength, metadata.byteLength, true); output.set(metadata, magic.byteLength + 4);
  let cursor = magic.byteLength + 4 + metadata.byteLength;
  for (const asset of assets) { output.set(asset.bytes, cursor); cursor += asset.bytes.byteLength; }
  return Object.freeze({ fileName: `${String(record.package.packageId ?? "aerobeat-package")}.aeropkg`, mediaType: "application/vnd.aerobeat.package", byteLength: output.byteLength, bytes: output });
}

/**
 * Read and validate deterministic export metadata without exposing asset bytes.
 *
 * @param {Uint8Array} bytes
 */
export function inspectAuthoredPackageExport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 || !magic.every((entry, index) => bytes[index] === entry)) throw new Error("Authored package export magic is invalid");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (length <= 0 || 12 + length > bytes.byteLength) throw new Error("Authored package export metadata length is invalid");
  const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(12, 12 + length)));
  return Object.freeze({ schema: metadata.schema, version: metadata.version, packageHash: metadata.packageHash, packageId: metadata.package?.packageId ?? "", assets: Object.freeze((metadata.assets ?? []).map((entry) => Object.freeze({ ...entry }))) });
}
