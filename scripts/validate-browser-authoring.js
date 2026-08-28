// @ts-check

import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = normalize(new URL("..", import.meta.url).pathname);
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const relative = pathname === "/" ? ".testbed/demo/index.html" : pathname.slice(1);
  const path = normalize(join(root, relative));
  if (!path.startsWith(root) || !statSafe(path)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", contentType(path));
  response.setHeader("Cache-Control", "no-store");
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Browser test server did not bind");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`); });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
try {
  await page.goto(`http://127.0.0.1:${address.port}/.testbed/demo/index.html`, { waitUntil: "networkidle" });
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
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Chromium module Worker, IndexedDB, export, deletion and no-console-noise validation passed.");

/** @param {string} path */
function statSafe(path) { try { return statSync(path).isFile(); } catch { return false; } }
/** @param {string} path */
function contentType(path) { const extension = extname(path); return extension === ".html" ? "text/html; charset=utf-8" : extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".json" ? "application/json; charset=utf-8" : "application/octet-stream"; }
