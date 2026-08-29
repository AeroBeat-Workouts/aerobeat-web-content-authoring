// @ts-check

import { canonicalJson, isPlainRecord, prefixedSha256, sha256Hex } from "./canonical.js";

const magic = new TextEncoder().encode("AEROPKG1");
const maximumMetadataBytes = 16 * 1024 * 1024;
const maximumAssetBytes = 128 * 1024 * 1024;
const maximumTotalAssetBytes = 512 * 1024 * 1024;
const maximumAssets = 2048;

/**
 * Deterministically export one validated record.
 *
 * @param {{package: Record<string, unknown>, packageHash: string, assets: readonly {path: string, bytes: Uint8Array}[]}} record
 */
export async function exportAuthoredPackage(record) {
  if (!hasExactKeys(record,["package","packageHash","assets"])) throw exportError("export_record_invalid", "Authored package record is invalid");
  const packageValue=dataValue(record,"package");const packageHash=dataValue(record,"packageHash");const assetValues=denseArray(dataValue(record,"assets"),maximumAssets,"export_assets_exceeded");
  if(!isPlainRecord(packageValue)||!validHash(packageHash))throw exportError("export_record_invalid","Authored package record is invalid");
  let canonicalPackage;try{canonicalPackage=canonicalJson(packageValue);}catch(cause){throw exportError("export_record_invalid",diagnostic("Authored package must contain plain canonical data",cause));}
  const computedPackageHash = await prefixedSha256(canonicalPackage);
  if (computedPackageHash !== packageHash) throw exportError("export_package_hash_mismatch", "Authored package hash does not match package data");
  const seen = new Set(); const assets = [];
  for (const value of assetValues) {
    if (!hasExactKeys(value,["path","bytes"])) throw exportError("export_asset_invalid", "Authored package asset is invalid");
    const rawPath=dataValue(value,"path");const rawBytes=dataValue(value,"bytes");
    if(typeof rawPath!=="string"||!(rawBytes instanceof Uint8Array))throw exportError("export_asset_invalid","Authored package asset is invalid");
    const path = normalizePath(rawPath);
    if (seen.has(path)) throw exportError("export_asset_duplicate", "Authored package asset paths collide after normalization");
    seen.add(path);
    if (rawBytes.byteLength > maximumAssetBytes) throw exportError("export_asset_too_large", "Authored package asset exceeds the byte limit");
    assets.push({ path, bytes: Uint8Array.from(rawBytes) });
  }
  assets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let offset = 0; const table = [];
  for (const asset of assets) {
    if (!Number.isSafeInteger(offset + asset.bytes.byteLength) || offset + asset.bytes.byteLength > maximumTotalAssetBytes) throw exportError("export_size_exceeded", "Authored package assets exceed the total byte limit");
    table.push({ path: asset.path, offset, byteLength: asset.bytes.byteLength, sha256: await sha256Hex(asset.bytes) }); offset += asset.bytes.byteLength;
  }
  const metadata = new TextEncoder().encode(canonicalJson({ schema: "aerobeat/authored_package_export", version: 1, packageHash, package: packageValue, assets: table }));
  if (metadata.byteLength <= 0 || metadata.byteLength > maximumMetadataBytes) throw exportError("export_metadata_too_large", "Authored package metadata exceeds the byte limit");
  const total = magic.byteLength + 4 + metadata.byteLength + offset;
  if (!Number.isSafeInteger(total) || total > maximumMetadataBytes + maximumTotalAssetBytes + 12) throw exportError("export_size_exceeded", "Authored package export exceeds the byte limit");
  const output = new Uint8Array(total);
  output.set(magic, 0); new DataView(output.buffer).setUint32(magic.byteLength, metadata.byteLength, true); output.set(metadata, magic.byteLength + 4);
  let cursor = magic.byteLength + 4 + metadata.byteLength;
  for (const asset of assets) { output.set(asset.bytes, cursor); cursor += asset.bytes.byteLength; }
  const packageIdValue=dataValue(packageValue,"packageId");const packageId = safeFileToken(typeof packageIdValue==="string"?packageIdValue:"aerobeat-package");
  return Object.freeze({ fileName: `${packageId}.aeropkg`, mediaType: "application/vnd.aerobeat.package", byteLength: output.byteLength, bytes: output });
}

/**
 * Fully inspect framing, metadata, offsets and asset hashes without returning bytes.
 *
 * @param {Uint8Array} bytes
 */
export async function inspectAuthoredPackageExport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 || bytes.byteLength > maximumMetadataBytes + maximumTotalAssetBytes + 12 || !magic.every((entry, index) => bytes[index] === entry)) throw exportError("export_magic_invalid", "Authored package export magic is invalid");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (length <= 0 || length > maximumMetadataBytes || 12 + length > bytes.byteLength) throw exportError("export_metadata_invalid", "Authored package export metadata length is invalid");
  let metadata;
  try { metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(12, 12 + length))); } catch (cause) { throw exportError("export_metadata_invalid", diagnostic("Authored package export metadata is invalid", cause)); }
  if (!hasExactKeys(metadata, ["schema", "version", "packageHash", "package", "assets"]) || metadata.schema !== "aerobeat/authored_package_export" || metadata.version !== 1 || !validHash(metadata.packageHash) || !isPlainRecord(metadata.package) || !Array.isArray(metadata.assets) || metadata.assets.length > maximumAssets) throw exportError("export_metadata_invalid", "Authored package export metadata shape is invalid");
  if (await prefixedSha256(canonicalJson(metadata.package)) !== metadata.packageHash) throw exportError("export_package_hash_mismatch", "Authored package export package hash is invalid");
  const dataStart = 12 + length; const dataLength = bytes.byteLength - dataStart; let expectedOffset = 0; const seen = new Set(); const summaries = [];
  for (const value of metadata.assets) {
    if (!hasExactKeys(value, ["path", "offset", "byteLength", "sha256"]) || typeof value.path !== "string" || !Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.byteLength) || value.offset !== expectedOffset || value.byteLength < 0 || value.byteLength > maximumAssetBytes || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256)) throw exportError("export_asset_table_invalid", "Authored package asset table is invalid");
    const path = normalizePath(value.path); if (seen.has(path)) throw exportError("export_asset_duplicate", "Authored package asset table contains duplicate paths"); seen.add(path);
    const end = value.offset + value.byteLength; if (!Number.isSafeInteger(end) || end > dataLength || end > maximumTotalAssetBytes) throw exportError("export_asset_table_invalid", "Authored package asset range is invalid");
    const digest = await sha256Hex(bytes.subarray(dataStart + value.offset, dataStart + end)); if (digest !== value.sha256) throw exportError("export_asset_hash_mismatch", "Authored package asset hash is invalid");
    summaries.push(Object.freeze({ path, offset: value.offset, byteLength: value.byteLength, sha256: value.sha256 })); expectedOffset = end;
  }
  if (expectedOffset !== dataLength) throw exportError("export_asset_table_invalid", "Authored package export contains unreferenced trailing bytes");
  return Object.freeze({ schema: metadata.schema, version: metadata.version, packageHash: metadata.packageHash, packageId: typeof metadata.package.packageId==="string"?metadata.package.packageId:"", assets: Object.freeze(summaries) });
}

/** @param {unknown} value @param {readonly string[]} keys */
function hasExactKeys(value,keys){if(!isPlainRecord(value)||Reflect.ownKeys(value).length!==keys.length)return false;return keys.every((key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor&&descriptor.enumerable;});}
/** @param {Record<string, unknown>} value @param {string} key */
function dataValue(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor?descriptor.value:undefined;}
/** @param {unknown} value @param {number} maximum @param {string} code */
function denseArray(value,maximum,code){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum)throw exportError(code,"Authored package array is invalid or exceeds its entry limit");const keys=Reflect.ownKeys(value);if(keys.some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw exportError(code,"Authored package array contains unsupported fields");const result=[];for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||descriptor.value===undefined)throw exportError(code,"Authored package array must contain dense data properties");result.push(descriptor.value);}return result;}
/** @param {string} value */
function normalizePath(value){if(/^[\\/]|^[a-z]:/iu.test(value)||/[\u0000-\u001f\u007f-\u009f]/u.test(value))throw exportError("export_path_invalid","Authored asset path is unsafe");const parts=value.replaceAll("\\","/").normalize("NFC").split("/");if(parts.some((part)=>!part||part==="."||part===".."))throw exportError("export_path_invalid","Authored asset path is unsafe");return parts.join("/").toLowerCase();}
/** @param {unknown} value */
function validHash(value){return typeof value==="string"&&/^sha256:[0-9a-f]{64}$/u.test(value);}
/** @param {string} value */
function safeFileToken(value){return value.normalize("NFC").replace(/[^a-zA-Z0-9._-]+/gu,"-").replace(/^[-.]+|[-.]+$/gu,"")||"aerobeat-package";}
/** @param {string} message @param {unknown} cause */
function diagnostic(message,cause){if(cause&&typeof cause==="object"){const descriptor=Object.getOwnPropertyDescriptor(cause,"message");if(descriptor&&"value" in descriptor&&typeof descriptor.value==="string"&&descriptor.value)return`${message}: ${descriptor.value.slice(0,4096)}`;}return message;}
/** @param {string} code @param {string} message */
function exportError(code,message){const error=new Error(message);error.name="AeroAuthoringExportError";Object.assign(error,{code});return error;}
