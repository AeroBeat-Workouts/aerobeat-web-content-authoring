// @ts-check

import { canonicalJson, cloneData, deepFreeze, isPlainRecord } from "./canonical.js";

export const authoringDatabaseName = "aerobeat-web-content-authoring";
export const authoringDatabaseVersion = 2;
export const authoringPersistenceNamespace = "aerobeat.authored-packages.v2";

/** @typedef {{key: string, package: Record<string, unknown>, packageHash: string, assets: readonly {path: string, bytes: Uint8Array}[], sourceCache: readonly {path: string, bytes: Uint8Array}[], createdAtMs: number, schemaVersion: number, writeToken: string}} StoredPackageRecord */

/**
 * Deterministic in-memory persistence adapter for tests/unsupported browsers.
 *
 * @param {{quotaBytes?: number}} [options]
 */
export function createMemoryPersistenceAdapter(options = {}) {
  const records = new Map();
  const quotaBytes = options.quotaBytes ?? 512 * 1024 * 1024;
  let destroyed = false;
  return Object.freeze({
    kind: "memory",
    schemaVersion: authoringDatabaseVersion,
    /** @param {StoredPackageRecord} record */
    async put(record) { assertOpen(); const copy = copyRecord(record); const projected = usage(records) - (records.has(record.key) ? recordSize(records.get(record.key)) : 0) + recordSize(copy); if (projected > quotaBytes) throw storageError("quota_exceeded", "Authored package exceeds local quota"); records.set(record.key, copy); },
    /** @param {string} key */
    async get(key) { assertOpen(); const value = records.get(key); return value ? copyRecord(value) : null; },
    async list() { assertOpen(); return [...records.values()].sort((a, b) => a.key.localeCompare(b.key)).map(summaryFor); },
    /** @param {string} key */
    async delete(key) { assertOpen(); return records.delete(key); },
    /** @param {string} key @param {string} writeToken */
    async deleteIfToken(key, writeToken) { assertOpen(); const current = records.get(key); if (!current || current.writeToken !== writeToken) return false; return records.delete(key); },
    async estimate() { assertOpen(); return deepFreeze({ usageBytes: usage(records), quotaBytes, availableBytes: Math.max(quotaBytes - usage(records), 0), persistent: false, schemaVersion: authoringDatabaseVersion }); },
    async migrate() { assertOpen(); return deepFreeze({ fromVersion: authoringDatabaseVersion, toVersion: authoringDatabaseVersion, migratedRecords: 0 }); },
    destroy() { destroyed = true; records.clear(); },
    assertOpen
  });
  function assertOpen() { if (destroyed) throw storageError("storage_destroyed", "Persistence adapter is destroyed"); }
}

/**
 * Browser IndexedDB persistence with schema migration and quota diagnostics.
 *
 * @param {{indexedDB?: IDBFactory, databaseName?: string, storageManager?: Pick<StorageManager, "estimate">}} [options]
 */
export function createIndexedDbPersistenceAdapter(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw storageError("indexeddb_unavailable", "IndexedDB is unavailable");
  const databaseName = options.databaseName ?? authoringDatabaseName;
  let closed = false;
  /** @type {Promise<IDBDatabase> | null} */
  let databasePromise = null;
  const open = () => {
    if (closed) return Promise.reject(storageError("storage_destroyed", "Persistence adapter is destroyed"));
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = factory.open(databaseName, authoringDatabaseVersion);
      request.onupgradeneeded = (event) => {
        const database = request.result;
        if (!database.objectStoreNames.contains("packages")) database.createObjectStore("packages", { keyPath: "key" });
        if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "key" });
        if (request.transaction) {
          request.transaction.objectStore("meta").put({ key: "schema", version: authoringDatabaseVersion });
          if (event.oldVersion > 0 && event.oldVersion < 2) {
            const cursorRequest = request.transaction.objectStore("packages").openCursor();
            cursorRequest.onsuccess = () => { const cursor = cursorRequest.result; if (!cursor) return; const value = cursor.value; cursor.update({ ...value, sourceCache: Array.isArray(value.sourceCache) ? value.sourceCache : [], writeToken: typeof value.writeToken === "string" ? value.writeToken : "", schemaVersion: authoringDatabaseVersion }); cursor.continue(); };
          }
        }
      };
      request.onerror = () => reject(storageError("indexeddb_open_failed", request.error?.message ?? "IndexedDB could not open"));
      request.onblocked = () => reject(storageError("indexeddb_blocked", "IndexedDB migration is blocked by another page"));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
    return databasePromise;
  };
  return Object.freeze({
    kind: "indexeddb",
    schemaVersion: authoringDatabaseVersion,
    /** @param {StoredPackageRecord} record */
    async put(record) { await transaction(await open(), "packages", "readwrite", (store) => store.put(copyRecord(record))); },
    /** @param {string} key */
    async get(key) { const value = await transaction(await open(), "packages", "readonly", (store) => store.get(key)); return value ? copyRecord(/** @type {StoredPackageRecord} */ (value)) : null; },
    async list() { const values = await transaction(await open(), "packages", "readonly", (store) => store.getAll()); return /** @type {StoredPackageRecord[]} */ (values).map(summaryFor).sort((a, b) => a.key.localeCompare(b.key)); },
    /** @param {string} key */
    async delete(key) { return deleteExisting(await open(), key); },
    /** @param {string} key @param {string} writeToken */
    async deleteIfToken(key, writeToken) { return conditionalDelete(await open(), key, writeToken); },
    async estimate() { const estimate = await (options.storageManager ?? globalThis.navigator?.storage)?.estimate?.() ?? {}; return deepFreeze({ usageBytes: finite(estimate.usage), quotaBytes: finite(estimate.quota), availableBytes: Math.max(finite(estimate.quota) - finite(estimate.usage), 0), persistent: true, schemaVersion: authoringDatabaseVersion }); },
    async migrate() { await open(); return deepFreeze({ fromVersion: authoringDatabaseVersion, toVersion: authoringDatabaseVersion, migratedRecords: 0 }); },
    destroy() { closed = true; databasePromise?.then((database) => database.close()).catch(() => undefined); databasePromise = null; }
  });
}

/** @param {IDBDatabase} database @param {string} key */
function deleteExisting(database,key){return new Promise((resolve,reject)=>{const tx=database.transaction("packages","readwrite"),store=tx.objectStore("packages"),request=store.getKey(key);let deleted=false;request.onsuccess=()=>{if(request.result!==undefined){store.delete(key);deleted=true;}};request.onerror=()=>reject(idbStorageError(request.error,"indexeddb_request_failed","IndexedDB delete lookup failed"));tx.oncomplete=()=>resolve(deleted);tx.onerror=()=>reject(idbStorageError(tx.error,"indexeddb_transaction_failed","IndexedDB delete transaction failed"));tx.onabort=()=>reject(idbStorageError(tx.error,"indexeddb_transaction_aborted","IndexedDB delete transaction aborted"));});}
/** @param {IDBDatabase} database @param {string} key @param {string} writeToken */
function conditionalDelete(database, key, writeToken) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction("packages", "readwrite"); const store = tx.objectStore("packages"); const request = store.get(key); let deleted = false;
    request.onsuccess = () => { const value = request.result; if (value && value.writeToken === writeToken) { store.delete(key); deleted = true; } };
    request.onerror = () => reject(idbStorageError(request.error,"indexeddb_request_failed","IndexedDB request failed"));
    tx.oncomplete = () => resolve(deleted); tx.onerror = () => reject(idbStorageError(tx.error,"indexeddb_transaction_failed","IndexedDB transaction failed")); tx.onabort = () => reject(idbStorageError(tx.error,"indexeddb_transaction_aborted","IndexedDB transaction aborted"));
  });
}

/** @param {IDBDatabase} database @param {string} storeName @param {IDBTransactionMode} mode @param {(store: IDBObjectStore) => IDBRequest | void} operation */
function transaction(database, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode); const request = operation(tx.objectStore(storeName)); let result;
    if (request) { request.onsuccess = () => { result = request.result; }; request.onerror = () => reject(idbStorageError(request.error,"indexeddb_request_failed","IndexedDB request failed")); }
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(idbStorageError(tx.error,"indexeddb_transaction_failed","IndexedDB transaction failed")); tx.onabort = () => reject(idbStorageError(tx.error,"indexeddb_transaction_aborted","IndexedDB transaction aborted"));
  });
}

/** @param {StoredPackageRecord} record */
function copyRecord(record) { if(!exactRecord(record,["key","package","packageHash","assets","sourceCache","createdAtMs","schemaVersion","writeToken"]))throw storageError("storage_record_invalid","Stored package record shape is invalid");const key=valueFor(record,"key"),packageValue=valueFor(record,"package"),packageHash=valueFor(record,"packageHash"),createdAtMs=valueFor(record,"createdAtMs"),writeToken=valueFor(record,"writeToken");if(typeof key!=="string"||!key||key.length>1024||!isPlainRecord(packageValue)||typeof packageHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(packageHash)||!Number.isSafeInteger(createdAtMs)||Number(createdAtMs)<0||typeof writeToken!=="string"||writeToken.length>128)throw storageError("storage_record_invalid","Stored package record values are invalid");let encoded;try{encoded=canonicalJson(packageValue);}catch{throw storageError("storage_record_invalid","Stored package must contain canonical plain data");}if(new TextEncoder().encode(encoded).byteLength>64*1024*1024)throw storageError("storage_record_invalid","Stored package exceeds the size limit");return { key, package: /** @type {Record<string, unknown>} */ (cloneData(packageValue)), packageHash, assets: copyAssets(valueFor(record,"assets")), sourceCache: copyAssets(valueFor(record,"sourceCache")), createdAtMs, schemaVersion: authoringDatabaseVersion, writeToken }; }
/** @param {StoredPackageRecord} record */
function summaryFor(record) { const packageId=valueFor(record.package,"packageId"),songName=valueFor(record.package,"songName"),source=valueFor(record.package,"source"),difficulty=isPlainRecord(source)?valueFor(source,"difficulty"):"";return deepFreeze({ key: record.key, packageId: typeof packageId==="string"?packageId:"", packageHash: record.packageHash, songName: typeof songName==="string"?songName:"", difficulty: typeof difficulty==="string"?difficulty:"", createdAtMs: record.createdAtMs, assetCount: record.assets.length, sourceCacheCount: record.sourceCache.length }); }
/** @param {Map<string, StoredPackageRecord>} records */
function usage(records) { let total = 0; for (const record of records.values()) total += recordSize(record); return total; }
/** @param {StoredPackageRecord | undefined} record */
function recordSize(record) { if (!record) return 0; return new TextEncoder().encode(canonicalJson(record.package)).byteLength + record.assets.reduce((total, entry) => total + entry.bytes.byteLength, 0) + record.sourceCache.reduce((total, entry) => total + entry.bytes.byteLength, 0); }
/** @param {unknown} value @param {readonly string[]} keys */
function exactRecord(value,keys){if(!isPlainRecord(value)||Reflect.ownKeys(value).length!==keys.length)return false;return keys.every((key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor&&descriptor.enumerable&&descriptor.value!==undefined;});}
/** @param {Record<string,unknown>} value @param {string} key */
function valueFor(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor?descriptor.value:undefined;}
/** @param {unknown} value */
function copyAssets(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>2048||Reflect.ownKeys(value).some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw storageError("storage_record_invalid","Stored asset array is invalid");const result=[];let total=0;for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||(!exactRecord(descriptor.value,["path","bytes"])&&!exactRecord(descriptor.value,["path","bytes","contentHash"])))throw storageError("storage_record_invalid","Stored asset entry is invalid");const path=valueFor(descriptor.value,"path"),bytes=valueFor(descriptor.value,"bytes"),contentHash=valueFor(descriptor.value,"contentHash");if(typeof path!=="string"||!path||path.length>1024||!(bytes instanceof Uint8Array)||bytes.byteLength>128*1024*1024||(contentHash!==undefined&&(typeof contentHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(contentHash))))throw storageError("storage_record_invalid","Stored asset values are invalid");total+=bytes.byteLength;if(!Number.isSafeInteger(total)||total>512*1024*1024)throw storageError("storage_record_invalid","Stored assets exceed the size limit");result.push({path,bytes:Uint8Array.from(bytes)});}return result;}
/** @param {unknown} value */
function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
/** @param {DOMException | null} error @param {string} fallbackCode @param {string} fallbackMessage */
function idbStorageError(error,fallbackCode,fallbackMessage){return storageError(error?.name==="QuotaExceededError"?"quota_exceeded":fallbackCode,error?.message||fallbackMessage);}
/** @param {string} code @param {string} message */
function storageError(code, message) { const error = new Error(message); error.name = "AeroAuthoringStorageError"; Object.assign(error, { code }); return error; }
