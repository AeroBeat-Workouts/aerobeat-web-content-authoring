// @ts-check

import assert from "node:assert/strict";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize } from "node:path";
import { chromium } from "playwright";

const root = normalize(new URL("..", import.meta.url).pathname);
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end("<!doctype html><title>IDB callback bounds</title>"); return; }
  const path = normalize(join(root, pathname.slice(1)));
  if (!path.startsWith(root) || !statSafe(path)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/src/canonical.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-hash"', 'from "/node_modules/@aerobeat/web-hash/src/index.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared hash import was not found"); return; }
    response.end(rewritten); return;
  }
  if (pathname === "/src/persistence.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-contracts/obstacle-contracts"', 'from "/node_modules/@aerobeat/web-contracts/src/obstacle-contracts.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared contract import was not found"); return; }
    response.end(rewritten); return;
  }
  createReadStream(path).pipe(response);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(undefined)); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("callback-bound server did not bind");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
/** @type {string[]} */ const noise = [];
page.on("console", (message) => { if (message.type() === "warning" || message.type() === "error") noise.push(`${message.type()}:${message.text()}`); });
page.on("pageerror", (error) => noise.push(`pageerror:${error.message}`));
await page.addInitScript(() => addEventListener("unhandledrejection", (event) => console.error(`unhandledrejection:${event.reason instanceof Error ? event.reason.message : String(event.reason)}`)));
try {
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  const result = await page.evaluate(async () => {
    // @ts-expect-error Browser-served absolute module path is intentionally unavailable to Node's checker.
    const { createIndexedDbPersistenceAdapter } = await import("/src/persistence.js");
    const hash = `sha256:${"3".repeat(64)}`, assetBytes = new Uint8Array([3, 1, 4, 1, 5]);
    const operations = ["list", "get", "getForExport", "listCollections", "getCollection", "put", "putCollection", "delete", "deleteCollection", "deleteIfToken"];
    const hostileCases = [
      ["package", "list"], ["package", "get"], ["package", "getForExport"], ["package", "listCollections"], ["package", "put"], ["package", "putCollection"], ["package", "delete"], ["package", "deleteCollection"], ["package", "deleteIfToken"],
      ["collection", "listCollections"], ["collection", "getCollection"], ["collection", "delete"], ["collection", "deleteCollection"], ["collection", "deleteIfToken"], ["asset", "get"], ["asset", "getForExport"]
    ];
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const packageValue = (key) => ({ schemaId: "aerobeat.song-package.v3", schemaVersion: 3, packageVersion: "3.0.0", packageId: `package-${key}`, songName: "Song", source: { difficulty: "Hard", obstacleContract: "normalized_obstacle_v2" }, charts: [{ schemaId: "aerobeat.chart.flow.v3", schemaVersion: 3, mode: "flow", rulesetId: "flow_grid_v2", beats: [{ start: 1, end: 2, type: "obstacle", sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_1", x: 1, y: 2, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 1, y: 0, width: 1, height: 3 }, gridMask: [1, 5, 9] }] }] });
    const record = (key, writeToken) => ({ key, package: packageValue(key), packageHash: `sha256:${"a".repeat(64)}`, assets: [], sourceCache: [], createdAtMs: 1, schemaVersion: 7, writeToken, assetRefs: [{ path: "media/audio/song.ogg", contentHash: hash }], flowCellOrientation: "aerobeat_top_left_v1", obstacleContract: "normalized_obstacle_v2" });
    const collection = (key, writeToken) => ({ collectionId: "collection", songName: "Song", sourceProvider: "synthetic", sourceId: "song", sourceVersionHash: "version", converterProfileId: "profile", converterProfileHash: "profile-hash", modifierIds: [], packageKeys: [key], packages: [{ packageKey: key, packageId: `package-${key}`, difficultyId: "Hard", difficultyLabel: "Hard" }], createdAtMs: 1, schemaVersion: 7, writeToken, flowCellOrientation: "aerobeat_top_left_v1", obstacleContract: "normalized_obstacle_v2" });
    const batch = (key, token) => ({ collection: collection(key, token), packages: [record(key, token)], assets: [{ contentHash: hash, bytes: assetBytes }] });
    const seed = (name, hostileKind) => new Promise((resolve, reject) => { const request = indexedDB.open(name, 7); request.onupgradeneeded = () => { const database = request.result, packages = database.createObjectStore("packages", { keyPath: "key" }), assets = database.createObjectStore("assets", { keyPath: "contentHash" }), collections = database.createObjectStore("collections", { keyPath: "collectionId" }); database.createObjectStore("meta", { keyPath: "key" }); const target = record("target", "target-token"), targetCollection = collection("target", "target-token"), asset = { contentHash: hash, bytes: assetBytes, byteLength: assetBytes.byteLength }; if (hostileKind === "package") { packages.put(target); packages.put({ ...record("hostile", "hostile-token"), unknownField: true }); } else if (hostileKind === "target-package") packages.put({ ...record("hostile", "hostile-token"), unknownField: true }); else packages.put(target); if (hostileKind === "collection") collections.put({ ...targetCollection, unknownField: true }); else if (hostileKind === "target-package") collections.put(collection("hostile", "hostile-token")); else collections.put(targetCollection); assets.put(hostileKind === "asset" ? { ...asset, unknownField: true } : asset); }; request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(undefined); }; });
    const inspect = (name) => new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result, tx = database.transaction(["packages", "assets", "collections"], "readonly"), packages = tx.objectStore("packages").getAll(), assets = tx.objectStore("assets").getAll(), collections = tx.objectStore("collections").getAll(); tx.onerror = () => reject(tx.error); tx.oncomplete = () => { resolve(JSON.stringify({ packages: packages.result, assets: assets.result, collections: collections.result })); database.close(); }; }; });
    const remove = (name) => new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(undefined); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("database delete blocked")); });
    const invoke = (adapter, operation, target = "target") => { if (operation === "list") return adapter.list(); if (operation === "get") return adapter.get(target); if (operation === "getForExport") return adapter.getForExport(target); if (operation === "listCollections") return adapter.listCollections(); if (operation === "getCollection") return adapter.getCollection("collection"); if (operation === "put") return adapter.put(record("replacement", "replacement-token")); if (operation === "putCollection") return adapter.putCollection(batch("replacement", "replacement-token")); if (operation === "delete") return adapter.delete(target); if (operation === "deleteCollection") return adapter.deleteCollection("collection"); if (operation === "deleteIfToken") return adapter.deleteIfToken(target, target === "hostile" ? "hostile-token" : "target-token"); throw new Error(`unknown ${operation}`); };
    const settledOnce = async (promise) => { let settlements = 0; promise.then(() => { settlements += 1; }, () => { settlements += 1; }); const outcome = await Promise.race([promise.then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", name: error?.name, code: error?.code, message: error?.message })), new Promise((_, reject) => setTimeout(() => reject(new Error("operation exceeded 2000 ms")), 2000))]); await Promise.resolve(); expect(settlements === 1, "operation did not settle exactly once"); return outcome; };
    for (const operation of operations) { const name = `browser-valid-${operation}-${crypto.randomUUID()}`; await seed(name, "valid"); const adapter = createIndexedDbPersistenceAdapter({ databaseName: name }); const outcome = await settledOnce(invoke(adapter, operation)); expect(outcome.status === "fulfilled", `valid ${operation} failed`); adapter.destroy(); await remove(name); }
    for (const [hostileKind, operation] of hostileCases) { const name = `browser-hostile-${hostileKind}-${operation}-${crypto.randomUUID()}`; await seed(name, hostileKind); const before = await inspect(name); const adapter = createIndexedDbPersistenceAdapter({ databaseName: name }); const target = hostileKind === "package" && (operation === "get" || operation === "getForExport") ? "hostile" : "target"; const outcome = await settledOnce(invoke(adapter, operation, target)); const message = hostileKind === "package" ? "Stored package record shape is invalid" : hostileKind === "collection" ? "Stored collection shape is invalid" : "Stored shared asset shape is invalid"; expect(outcome.status === "rejected" && outcome.name === "AeroAuthoringStorageError" && outcome.code === "storage_record_invalid" && outcome.message === message, `${hostileKind}/${operation} lost original bounded error: ${JSON.stringify(outcome)}`); expect(await inspect(name) === before, `${hostileKind}/${operation} was not atomic`); adapter.destroy(); await remove(name); }
    for (const operation of ["delete", "deleteIfToken"]) { const name = `browser-target-${operation}-${crypto.randomUUID()}`; await seed(name, "target-package"); const adapter = createIndexedDbPersistenceAdapter({ databaseName: name }); const outcome = await settledOnce(invoke(adapter, operation, "hostile")); expect(outcome.status === "fulfilled" && outcome.value === true, `${operation} lost hostile target key/token semantics`); const after = await inspect(name); expect(after === JSON.stringify({ packages: [], assets: [], collections: [] }), `${operation} did not clean hostile target atomically`); adapter.destroy(); await remove(name); }
    return { validOperations: operations.length, hostileOperations: hostileCases.length + 2, schemaVersion: 7 };
  });
  assert.deepEqual(result, { validOperations: 10, hostileOperations: 18, schemaVersion: 7 });
  assert.deepEqual(noise, [], "real Chromium callback matrix must emit zero pageerror, unhandledrejection, warning, or error noise");
  console.log(JSON.stringify({ currentDb7CallbackBounds: "PASS", ...result, settlements: "exactly-once", timeoutMs: 2000, rollback: "package+collection+asset" }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** @param {string} path */
function statSafe(path) { try { return statSync(path).isFile(); } catch { return false; } }
