// @ts-check

import { cloneData, deepFreeze } from "./canonical.js";

export const authoringDatabaseName = "aerobeat-web-content-authoring";
export const authoringDatabaseVersion = 2;
export const authoringPersistenceNamespace = "aerobeat.authored-packages.v2";

/** @typedef {{key: string, package: Record<string, unknown>, packageHash: string, assets: readonly {path: string, bytes: Uint8Array}[], sourceCache: readonly {path: string, bytes: Uint8Array}[], createdAtMs: number, schemaVersion: number}} StoredPackageRecord */

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
            cursorRequest.onsuccess = () => { const cursor = cursorRequest.result; if (!cursor) return; const value = cursor.value; cursor.update({ ...value, sourceCache: Array.isArray(value.sourceCache) ? value.sourceCache : [], schemaVersion: authoringDatabaseVersion }); cursor.continue(); };
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
    async delete(key) { const existing = await transaction(await open(), "packages", "readonly", (store) => store.getKey(key)); if (existing === undefined) return false; await transaction(await open(), "packages", "readwrite", (store) => store.delete(key)); return true; },
    async estimate() { const estimate = await (options.storageManager ?? globalThis.navigator?.storage)?.estimate?.() ?? {}; return deepFreeze({ usageBytes: finite(estimate.usage), quotaBytes: finite(estimate.quota), availableBytes: Math.max(finite(estimate.quota) - finite(estimate.usage), 0), persistent: true, schemaVersion: authoringDatabaseVersion }); },
    async migrate() { await open(); return deepFreeze({ fromVersion: authoringDatabaseVersion, toVersion: authoringDatabaseVersion, migratedRecords: 0 }); },
    destroy() { closed = true; databasePromise?.then((database) => database.close()).catch(() => undefined); databasePromise = null; }
  });
}

/** @param {IDBDatabase} database @param {string} storeName @param {IDBTransactionMode} mode @param {(store: IDBObjectStore) => IDBRequest | void} operation */
function transaction(database, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode); const request = operation(tx.objectStore(storeName)); let result;
    if (request) { request.onsuccess = () => { result = request.result; }; request.onerror = () => reject(storageError("indexeddb_request_failed", request.error?.message ?? "IndexedDB request failed")); }
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(storageError("indexeddb_transaction_failed", tx.error?.message ?? "IndexedDB transaction failed")); tx.onabort = () => reject(storageError("indexeddb_transaction_aborted", tx.error?.message ?? "IndexedDB transaction aborted"));
  });
}

/** @param {StoredPackageRecord} record */
function copyRecord(record) { return { key: record.key, package: /** @type {Record<string, unknown>} */ (cloneData(record.package)), packageHash: record.packageHash, assets: record.assets.map((asset) => ({ path: asset.path, bytes: Uint8Array.from(asset.bytes) })), sourceCache: record.sourceCache.map((asset) => ({ path: asset.path, bytes: Uint8Array.from(asset.bytes) })), createdAtMs: record.createdAtMs, schemaVersion: authoringDatabaseVersion }; }
/** @param {StoredPackageRecord} record */
function summaryFor(record) { return deepFreeze({ key: record.key, packageId: String(record.package.packageId ?? ""), packageHash: record.packageHash, songName: String(record.package.songName ?? ""), difficulty: String(/** @type {Record<string, unknown>} */ (record.package.source ?? {}).difficulty ?? ""), createdAtMs: record.createdAtMs, assetCount: record.assets.length, sourceCacheCount: record.sourceCache.length }); }
/** @param {Map<string, StoredPackageRecord>} records */
function usage(records) { let total = 0; for (const record of records.values()) total += recordSize(record); return total; }
/** @param {StoredPackageRecord | undefined} record */
function recordSize(record) { if (!record) return 0; return new TextEncoder().encode(JSON.stringify(record.package)).byteLength + record.assets.reduce((total, entry) => total + entry.bytes.byteLength, 0) + record.sourceCache.reduce((total, entry) => total + entry.bytes.byteLength, 0); }
/** @param {unknown} value */
function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
/** @param {string} code @param {string} message */
function storageError(code, message) { const error = new Error(message); error.name = "AeroAuthoringStorageError"; Object.assign(error, { code }); return error; }
