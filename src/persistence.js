// @ts-check

import { canonicalJson, cloneData, deepFreeze, isPlainRecord } from "./canonical.js";

export const authoringDatabaseName = "aerobeat-web-content-authoring";
export const authoringDatabaseVersion = 3;
export const authoringPersistenceNamespace = "aerobeat.authored-packages.v2";

/** @typedef {{key: string, package: Record<string, unknown>, packageHash: string, assets: readonly {path: string, bytes: Uint8Array}[], sourceCache: readonly {path: string, bytes: Uint8Array}[], createdAtMs: number, schemaVersion: number, writeToken: string, assetRefs?: readonly {path: string, contentHash: string}[]}} StoredPackageRecord */
/** @typedef {{contentHash: string, bytes: Uint8Array, byteLength: number}} SharedAssetRecord */
/** @typedef {{collectionId: string, songName: string, sourceProvider: string, sourceId: string, sourceVersionHash: string, converterProfileId: string, converterProfileHash: string, modifierIds: readonly string[], packageKeys: readonly string[], packages: readonly {packageKey: string, packageId: string, difficultyId: string, difficultyLabel: string}[], createdAtMs: number, schemaVersion: number, writeToken: string}} StoredCollectionRecord */

/**
 * Deterministic in-memory persistence adapter for tests/unsupported browsers.
 *
 * @param {{quotaBytes?: number}} [options]
 */
export function createMemoryPersistenceAdapter(options = {}) {
  const records = new Map();
  const sharedAssets = new Map();
  const collections = new Map();
  const quotaBytes = options.quotaBytes ?? 512 * 1024 * 1024;
  let destroyed = false;
  return Object.freeze({
    kind: "memory",
    schemaVersion: authoringDatabaseVersion,
    /** @param {StoredPackageRecord} record */
    async put(record) { assertOpen(); const copy = copyRecord(record); const staged = new Map(records); staged.set(copy.key, copy); assertQuota(staged, sharedAssets, collections); records.set(copy.key, copy); },
    /** @param {string} key */
    async get(key) { assertOpen(); const value = records.get(key); return value ? resolveRecordAssets(value, sharedAssets) : null; },
    async list() { assertOpen(); return [...records.values()].sort((a, b) => a.key.localeCompare(b.key)).map(summaryFor); },
    /** @param {unknown} batch @param {{signal?: AbortSignal}} [batchOptions] */
    async putCollection(batch, batchOptions = {}) {
      assertOpen(); assertNotAborted(batchOptions.signal); const copy = copyCollectionBatch(batch);
      const stagedRecords = new Map(records), stagedAssets = new Map(sharedAssets), stagedCollections = new Map(collections);
      for (const asset of copy.assets) stagedAssets.set(asset.contentHash, asset);
      for (const record of copy.packages) stagedRecords.set(record.key, record);
      stagedCollections.set(copy.collection.collectionId, copy.collection);
      assertNotAborted(batchOptions.signal); assertQuota(stagedRecords, stagedAssets, stagedCollections);
      replaceMap(records, stagedRecords); replaceMap(sharedAssets, stagedAssets); replaceMap(collections, stagedCollections);
      return collectionSummary(copy.collection);
    },
    async listCollections() { assertOpen(); return collectionSummaries(records, collections); },
    /** @param {string} collectionId */
    async getCollection(collectionId) { assertOpen(); const stored = collections.get(collectionId); if (stored) return copyCollection(stored); return legacyCollectionForId(records, collectionId); },
    /** @param {string} collectionId */
    async deleteCollection(collectionId) {
      assertOpen(); const stored = collections.get(collectionId);
      if (!stored) { const legacy = legacyCollectionForId(records, collectionId); if (!legacy) return false; records.delete(legacy.packageKeys[0]); collectUnusedAssets(records, sharedAssets); return true; }
      for (const key of stored.packageKeys) records.delete(key);
      collections.delete(collectionId); collectUnusedAssets(records, sharedAssets); return true;
    },
    /** @param {string} key */
    async delete(key) { assertOpen(); const deleted = records.delete(key); if (deleted) { removePackageFromCollections(collections, key); collectUnusedAssets(records, sharedAssets); } return deleted; },
    /** @param {string} key @param {string} writeToken */
    async deleteIfToken(key, writeToken) { assertOpen(); const current = records.get(key); if (!current || current.writeToken !== writeToken) return false; records.delete(key); removePackageFromCollections(collections, key); collectUnusedAssets(records, sharedAssets); return true; },
    async estimate() { assertOpen(); const usageBytes = totalUsage(records, sharedAssets, collections); return deepFreeze({ usageBytes, quotaBytes, availableBytes: Math.max(quotaBytes - usageBytes, 0), persistent: false, schemaVersion: authoringDatabaseVersion }); },
    async migrate() { assertOpen(); return deepFreeze({ fromVersion: authoringDatabaseVersion, toVersion: authoringDatabaseVersion, migratedRecords: 0 }); },
    destroy() { destroyed = true; records.clear(); sharedAssets.clear(); collections.clear(); },
    assertOpen
  });
  function assertOpen() { if (destroyed) throw storageError("storage_destroyed", "Persistence adapter is destroyed"); }
  function assertQuota(nextRecords, nextAssets, nextCollections) { if (totalUsage(nextRecords, nextAssets, nextCollections) > quotaBytes) throw storageError("quota_exceeded", "Authored collection exceeds local quota"); }
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
        if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets", { keyPath: "contentHash" });
        if (!database.objectStoreNames.contains("collections")) database.createObjectStore("collections", { keyPath: "collectionId" });
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
function copyRecord(record) { const legacyKeys=["key","package","packageHash","assets","sourceCache","createdAtMs","schemaVersion","writeToken"],v3Keys=[...legacyKeys,"assetRefs"];if(!exactRecord(record,legacyKeys)&&!exactRecord(record,v3Keys))throw storageError("storage_record_invalid","Stored package record shape is invalid");const key=valueFor(record,"key"),packageValue=valueFor(record,"package"),packageHash=valueFor(record,"packageHash"),createdAtMs=valueFor(record,"createdAtMs"),writeToken=valueFor(record,"writeToken");if(typeof key!=="string"||!key||key.length>1024||!isPlainRecord(packageValue)||typeof packageHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(packageHash)||!Number.isSafeInteger(createdAtMs)||Number(createdAtMs)<0||typeof writeToken!=="string"||writeToken.length>128)throw storageError("storage_record_invalid","Stored package record values are invalid");let encoded;try{encoded=canonicalJson(packageValue);}catch{throw storageError("storage_record_invalid","Stored package must contain canonical plain data");}if(new TextEncoder().encode(encoded).byteLength>64*1024*1024)throw storageError("storage_record_invalid","Stored package exceeds the size limit");const result={ key, package: /** @type {Record<string, unknown>} */ (cloneData(packageValue)), packageHash, assets: copyAssets(valueFor(record,"assets")), sourceCache: copyAssets(valueFor(record,"sourceCache")), createdAtMs, schemaVersion: authoringDatabaseVersion, writeToken };const refs=valueFor(record,"assetRefs");return refs===undefined?result:{...result,assetRefs:copyAssetRefs(refs)}; }
/** @param {StoredPackageRecord} record */
function summaryFor(record) { const packageId=valueFor(record.package,"packageId"),songName=valueFor(record.package,"songName"),source=valueFor(record.package,"source"),difficulty=isPlainRecord(source)?valueFor(source,"difficulty"):"";return deepFreeze({ key: record.key, packageId: typeof packageId==="string"?packageId:"", packageHash: record.packageHash, songName: typeof songName==="string"?songName:"", difficulty: typeof difficulty==="string"?difficulty:"", createdAtMs: record.createdAtMs, assetCount: record.assets.length, sourceCacheCount: record.sourceCache.length }); }
/** @param {Map<string, StoredPackageRecord>} records */
function usage(records) { let total = 0; for (const record of records.values()) total += recordSize(record); return total; }
/** @param {StoredPackageRecord | undefined} record */
function recordSize(record) { if (!record) return 0; return new TextEncoder().encode(canonicalJson(record.package)).byteLength + record.assets.reduce((total, entry) => total + entry.bytes.byteLength, 0) + record.sourceCache.reduce((total, entry) => total + entry.bytes.byteLength, 0); }
/** @param {unknown} value @param {readonly string[]} keys */
function exactRecord(value,keys){if(!isPlainRecord(value)||Reflect.ownKeys(value).length!==keys.length)return false;return keys.every((key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor&&descriptor.enumerable&&descriptor.value!==undefined;});}
/** @param {unknown} value @param {string} key */
function valueFor(value,key){if(!isPlainRecord(value))return undefined;const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&"value" in descriptor?descriptor.value:undefined;}
/** @param {unknown} value */
function copyAssets(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>2048||Reflect.ownKeys(value).some((key)=>typeof key!=="string"||(key!=="length"&&(!/^(0|[1-9][0-9]*)$/u.test(key)||Number(key)>=value.length))))throw storageError("storage_record_invalid","Stored asset array is invalid");const result=[];let total=0;for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||(!exactRecord(descriptor.value,["path","bytes"])&&!exactRecord(descriptor.value,["path","bytes","contentHash"])))throw storageError("storage_record_invalid","Stored asset entry is invalid");const path=valueFor(descriptor.value,"path"),bytes=valueFor(descriptor.value,"bytes"),contentHash=valueFor(descriptor.value,"contentHash");if(typeof path!=="string"||!path||path.length>1024||!(bytes instanceof Uint8Array)||bytes.byteLength>128*1024*1024||(contentHash!==undefined&&(typeof contentHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(contentHash))))throw storageError("storage_record_invalid","Stored asset values are invalid");total+=bytes.byteLength;if(!Number.isSafeInteger(total)||total>512*1024*1024)throw storageError("storage_record_invalid","Stored assets exceed the size limit");result.push({path,bytes:Uint8Array.from(bytes)});}return result;}
/** @param {unknown} value */
function copyAssetRefs(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>2048)throw storageError("storage_record_invalid","Stored asset references are invalid");const result=[];const paths=new Set();for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!exactRecord(descriptor.value,["path","contentHash"]))throw storageError("storage_record_invalid","Stored asset reference is invalid");const path=valueFor(descriptor.value,"path"),contentHash=valueFor(descriptor.value,"contentHash");if(typeof path!=="string"||!path||path.length>1024||paths.has(path)||typeof contentHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(contentHash))throw storageError("storage_record_invalid","Stored asset reference values are invalid");paths.add(path);result.push({path,contentHash});}return result;}
/** @param {unknown} value */
function copySharedAssets(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>64)throw storageError("storage_record_invalid","Shared assets are invalid");const result=[];const hashes=new Set();for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||!exactRecord(descriptor.value,["contentHash","bytes"]))throw storageError("storage_record_invalid","Shared asset entry is invalid");const contentHash=valueFor(descriptor.value,"contentHash"),bytes=valueFor(descriptor.value,"bytes");if(typeof contentHash!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(contentHash)||hashes.has(contentHash)||!(bytes instanceof Uint8Array)||bytes.byteLength>128*1024*1024)throw storageError("storage_record_invalid","Shared asset values are invalid");hashes.add(contentHash);result.push({contentHash,bytes:Uint8Array.from(bytes),byteLength:bytes.byteLength});}return result;}
/** @param {unknown} value */
function copyCollection(value){const keys=["collectionId","songName","sourceProvider","sourceId","sourceVersionHash","converterProfileId","converterProfileHash","modifierIds","packageKeys","packages","createdAtMs","schemaVersion","writeToken"];if(!exactRecord(value,keys))throw storageError("storage_record_invalid","Stored collection shape is invalid");const stringKeys=keys.slice(0,7);const strings=Object.fromEntries(stringKeys.map((key)=>[key,valueFor(value,key)]));if(stringKeys.some((key)=>typeof strings[key]!=="string"||!strings[key]||strings[key].length>1024)||!Number.isSafeInteger(valueFor(value,"createdAtMs"))||Number(valueFor(value,"createdAtMs"))<0||typeof valueFor(value,"writeToken")!=="string"||String(valueFor(value,"writeToken")).length>128)throw storageError("storage_record_invalid","Stored collection values are invalid");const modifierIds=copyStringArray(valueFor(value,"modifierIds"),64),packageKeys=copyStringArray(valueFor(value,"packageKeys"),8);if(packageKeys.length===0||new Set(packageKeys).size!==packageKeys.length)throw storageError("storage_record_invalid","Stored collection package keys are invalid");const entries=valueFor(value,"packages");if(!Array.isArray(entries)||entries.length!==packageKeys.length||Object.getPrototypeOf(entries)!==Array.prototype)throw storageError("storage_record_invalid","Stored collection packages are invalid");const packages=[];const difficultyIds=new Set();for(let index=0;index<entries.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(entries,String(index));if(!descriptor||!("value" in descriptor)||!exactRecord(descriptor.value,["packageKey","packageId","difficultyId","difficultyLabel"]))throw storageError("storage_record_invalid","Stored collection package entry is invalid");const entry={packageKey:valueFor(descriptor.value,"packageKey"),packageId:valueFor(descriptor.value,"packageId"),difficultyId:valueFor(descriptor.value,"difficultyId"),difficultyLabel:valueFor(descriptor.value,"difficultyLabel")};if(Object.values(entry).some((item)=>typeof item!=="string"||!item||item.length>1024)||entry.packageKey!==packageKeys[index]||difficultyIds.has(entry.difficultyId))throw storageError("storage_record_invalid","Stored collection package values are invalid");difficultyIds.add(entry.difficultyId);packages.push(entry);}return /** @type {StoredCollectionRecord} */ (/** @type {unknown} */ ({...strings,modifierIds,packageKeys,packages,createdAtMs:valueFor(value,"createdAtMs"),schemaVersion:authoringDatabaseVersion,writeToken:valueFor(value,"writeToken")}));}
/** @param {unknown} value @param {number} maximum */
function copyStringArray(value,maximum){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum)throw storageError("storage_record_invalid","Stored string array is invalid");const result=[];for(let index=0;index<value.length;index+=1){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!("value" in descriptor)||typeof descriptor.value!=="string"||!descriptor.value||descriptor.value.length>1024)throw storageError("storage_record_invalid","Stored string array value is invalid");result.push(descriptor.value);}return result;}
/** @param {unknown} batch */
function copyCollectionBatch(batch){if(!exactRecord(batch,["collection","packages","assets"]))throw storageError("storage_record_invalid","Collection batch shape is invalid");const collection=copyCollection(valueFor(batch,"collection")),assets=copySharedAssets(valueFor(batch,"assets")),packageValue=valueFor(batch,"packages");if(!Array.isArray(packageValue)||Object.getPrototypeOf(packageValue)!==Array.prototype||packageValue.length!==collection.packageKeys.length)throw storageError("storage_record_invalid","Collection batch packages are invalid");const packages=packageValue.map((record)=>copyRecord(record));const hashes=new Set(assets.map((asset)=>asset.contentHash));for(let index=0;index<packages.length;index+=1){if(packages[index].key!==collection.packageKeys[index]||!packages[index].assetRefs?.length||packages[index].assetRefs.some((ref)=>!hashes.has(ref.contentHash)))throw storageError("storage_record_invalid","Collection batch references are invalid");}return {collection,packages,assets};}
/** @param {AbortSignal | undefined} signal */
function assertNotAborted(signal){if(signal?.aborted)throw storageError("operation_aborted","Persistence operation was cancelled");}
/** @param {StoredPackageRecord} record @param {Map<string, SharedAssetRecord>} assets */
function resolveRecordAssets(record,assets){const copy=copyRecord(record);if(!copy.assetRefs?.length)return copy;const resolved=[...copy.assets];const paths=new Set(resolved.map((entry)=>entry.path));for(const ref of copy.assetRefs){const asset=assets.get(ref.contentHash);if(!asset||paths.has(ref.path))throw storageError("storage_record_invalid","Stored shared asset is unavailable");paths.add(ref.path);resolved.push({path:ref.path,bytes:Uint8Array.from(asset.bytes)});}return {...copy,assets:resolved};}
/** @param {StoredCollectionRecord} collection */
function collectionSummary(collection){return deepFreeze({collectionId:collection.collectionId,songName:collection.songName,createdAtMs:collection.createdAtMs,packages:collection.packages.map((entry)=>({packageKey:entry.packageKey,packageId:entry.packageId,difficultyId:entry.difficultyId,difficultyLabel:entry.difficultyLabel}))});}
/** @param {Map<string, StoredPackageRecord>} records @param {Map<string, StoredCollectionRecord>} collections */
function collectionSummaries(records,collections){const result=[...collections.values()].map(collectionSummary);const referenced=new Set([...collections.values()].flatMap((collection)=>collection.packageKeys));for(const [key,record] of records){if(!referenced.has(key))result.push(collectionSummary(legacyCollection(record)));}return result.sort((a,b)=>a.collectionId.localeCompare(b.collectionId));}
/** @param {StoredPackageRecord} record */
function legacyCollection(record){const summary=summaryFor(record),id=`legacy:${record.key}`;return {collectionId:id,songName:summary.songName||"Downloaded song",sourceProvider:"legacy",sourceId:record.key,sourceVersionHash:"legacy",converterProfileId:"legacy",converterProfileHash:"legacy",modifierIds:[],packageKeys:[record.key],packages:[{packageKey:record.key,packageId:summary.packageId||record.key,difficultyId:summary.difficulty||"default",difficultyLabel:summary.difficulty||"Default"}],createdAtMs:record.createdAtMs,schemaVersion:authoringDatabaseVersion,writeToken:record.writeToken};}
/** @param {Map<string, StoredPackageRecord>} records @param {string} collectionId */
function legacyCollectionForId(records,collectionId){if(!collectionId.startsWith("legacy:"))return null;const record=records.get(collectionId.slice(7));return record?copyCollection(legacyCollection(record)):null;}
/** @param {Map<string, unknown>} target @param {Map<string, unknown>} source */
function replaceMap(target,source){target.clear();for(const [key,value] of source)target.set(key,value);}
/** @param {Map<string, StoredPackageRecord>} records @param {Map<string, SharedAssetRecord>} assets @param {Map<string, StoredCollectionRecord>} collections */
function totalUsage(records,assets,collections){let total=usage(records);for(const asset of assets.values())total+=asset.bytes.byteLength;for(const collection of collections.values())total+=new TextEncoder().encode(canonicalJson(collection)).byteLength;return total;}
/** @param {Map<string, StoredPackageRecord>} records @param {Map<string, SharedAssetRecord>} assets */
function collectUnusedAssets(records,assets){const used=new Set();for(const record of records.values())for(const ref of record.assetRefs??[])used.add(ref.contentHash);for(const hash of assets.keys())if(!used.has(hash))assets.delete(hash);}
/** @param {Map<string, StoredCollectionRecord>} collections @param {string} key */
function removePackageFromCollections(collections,key){for(const [id,collection] of [...collections]){const index=collection.packageKeys.indexOf(key);if(index<0)continue;if(collection.packageKeys.length===1){collections.delete(id);continue;}collections.set(id,{...collection,packageKeys:collection.packageKeys.filter((item)=>item!==key),packages:collection.packages.filter((entry)=>entry.packageKey!==key)});}}
/** @param {unknown} value */
function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
/** @param {DOMException | null} error @param {string} fallbackCode @param {string} fallbackMessage */
function idbStorageError(error,fallbackCode,fallbackMessage){return storageError(error?.name==="QuotaExceededError"?"quota_exceeded":fallbackCode,error?.message||fallbackMessage);}
/** @param {string} code @param {string} message */
function storageError(code, message) { const error = new Error(message); error.name = "AeroAuthoringStorageError"; Object.assign(error, { code }); return error; }
