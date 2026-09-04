// @ts-check

import assert from "node:assert/strict";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = normalize(new URL("..", import.meta.url).pathname);
const workerProbe = `import { sha256Hex } from "/node_modules/@aerobeat/web-hash/src/index.js";
self.onmessage = async (event) => {
  const expectedSecure = event.data;
  const subtleType = typeof globalThis.crypto?.subtle;
  if (isSecureContext !== expectedSecure) throw new Error("Worker secure-context precondition failed");
  if ((expectedSecure && subtleType !== "object") || (!expectedSecure && subtleType !== "undefined")) throw new Error("Worker WebCrypto precondition failed before conversion");
  let native = null; let nativeError = "";
  try { native = await sha256Hex("authoring-context-probe", { backend: "native" }); } catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
  self.postMessage({ isSecureContext, subtleType, auto: await sha256Hex("authoring-context-probe"), fallback: await sha256Hex("authoring-context-probe", { backend: "fallback" }), native, nativeError });
};`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/hash-context-worker.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(workerProbe);
    return;
  }
  const relative = pathname === "/" ? ".testbed/demo/index.html" : pathname.slice(1);
  const path = normalize(join(root, relative));
  if (!path.startsWith(root) || !statSafe(path)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", contentType(path));
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/src/canonical.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-hash"', 'from "/node_modules/@aerobeat/web-hash/src/index.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared hash import was not found"); return; }
    response.end(rewritten);
    return;
  }
  if (pathname === "/src/converter.js" || pathname === "/src/validator.js") {
    const source = readFileSync(path, "utf8");
    const rewritten = source.replace('from "@aerobeat/web-contracts/flow-obstacle-contracts"', 'from "/node_modules/@aerobeat/web-contracts/src/flow-obstacle-contracts.js"');
    if (rewritten === source) { response.writeHead(500).end("Declared Flow obstacle contract import was not found"); return; }
    response.end(rewritten);
    return;
  }
  createReadStream(path).pipe(response);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "0.0.0.0", () => resolve(undefined)); });
const address = server.address();
if (!address || typeof address === "string") throw new Error("Browser test server did not bind");
const addresses = Object.values(networkInterfaces()).flat().filter(Boolean)
  .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("127."));
const preferred = addresses.find((entry) => entry.address.startsWith("100.")) ?? addresses[0];
assert.ok(preferred, "a genuine non-loopback IPv4 interface is required");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const externalRequests = [];
page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`); });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("request", (request) => {
  const hostname = new URL(request.url()).hostname;
  if (hostname !== "localhost" && hostname !== preferred.address) externalRequests.push(request.url());
});
try {
  const run = async (url, expectedSecure) => {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(response?.ok(), true);
    const precondition = await page.evaluate(async (secure) => {
      if (isSecureContext !== secure) throw new Error("Window secure-context precondition failed");
      const subtleType = typeof globalThis.crypto?.subtle;
      if ((secure && subtleType !== "object") || (!secure && subtleType !== "undefined")) throw new Error("Window WebCrypto precondition failed before authoring");
      const hashes = await import("@aerobeat/web-hash");
      let native = null; let nativeError = "";
      try { native = await hashes.sha256Hex("authoring-context-probe", { backend: "native" }); } catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
      const worker = await new Promise((resolve, reject) => {
        const instance = new Worker("/hash-context-worker.js", { type: "module" });
        instance.onerror = (event) => { instance.terminate(); reject(new Error(event.message)); };
        instance.onmessage = (event) => { instance.terminate(); resolve(event.data); };
        instance.postMessage(secure);
      });
      return { isSecureContext, subtleType, auto: await hashes.sha256Hex("authoring-context-probe"), fallback: await hashes.sha256Hex("authoring-context-probe", { backend: "fallback" }), native, nativeError, worker };
    }, expectedSecure);
    assert.equal(precondition.isSecureContext, expectedSecure);
    assert.equal(precondition.subtleType, expectedSecure ? "object" : "undefined");
    assert.equal(precondition.auto, precondition.fallback);
    assert.equal(precondition.worker.isSecureContext, expectedSecure);
    assert.equal(precondition.worker.subtleType, expectedSecure ? "object" : "undefined");
    assert.equal(precondition.worker.auto, precondition.worker.fallback);
    if (expectedSecure) {
      assert.equal(precondition.native, precondition.fallback);
      assert.equal(precondition.worker.native, precondition.worker.fallback);
    } else {
      assert.equal(precondition.native, null);
      assert.match(precondition.nativeError, /unavailable/u);
      assert.equal(precondition.worker.native, null);
      assert.match(precondition.worker.nativeError, /unavailable/u);
    }
    const result = await page.evaluate(() => globalThis.runAuthoringHarness());
    assert.equal(result.chartCount, 5);
    assert.equal(result.listCount, 1);
    assert.deepEqual(result.audioBytes, [4, 3, 2, 1]);
    assert.equal(result.loadedPackageId, result.exportPackageId);
    assert.equal(result.exportAssetCount, 1);
    assert.equal(result.remaining, 0);
    assert.equal(result.snapshotHasRawBytes, false);
    assert.ok(result.states.includes("converting"));
    assert.ok(result.states.includes("persisting"));
    assert.match(result.packageHash, /^sha256:[0-9a-f]{64}$/u);
    assert.match(result.audioSha256, /^[0-9a-f]{64}$/u);
    return { precondition, result };
  };

  const secure = await run(`http://localhost:${address.port}/.testbed/demo/index.html`, true);
  const insecure = await run(`http://${preferred.address}:${address.port}/.testbed/demo/index.html`, false);
  assert.equal(insecure.result.packageHash, secure.result.packageHash, "Window + conversion Worker package identity must match secure native output");
  assert.equal(insecure.result.audioSha256, secure.result.audioSha256, "persisted/exported audio identity must match secure native output");
  assert.equal(insecure.result.loadedPackageId, secure.result.loadedPackageId);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ secureOrigin: `http://localhost:${address.port}`, insecureOrigin: `http://${preferred.address}:${address.port}`, windowHashing: "PASS", moduleWorkerHashing: "PASS", conversionPersistence: "PASS", packageHash: secure.result.packageHash }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

/** @param {string} path @returns {boolean} */
function statSafe(path) { try { return statSync(path).isFile(); } catch { return false; } }
/** @param {string} path @returns {string} */
function contentType(path) { const extension = extname(path); return extension === ".html" ? "text/html; charset=utf-8" : extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream"; }
