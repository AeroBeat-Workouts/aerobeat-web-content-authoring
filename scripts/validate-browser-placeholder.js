// @ts-check

import { readFileSync } from "node:fs";
import { createAeroWebContentAuthoringServiceDescriptor } from "../src/index.js";

const config = readFileSync(".testbed/playwright.config.js", "utf8");
const descriptor = createAeroWebContentAuthoringServiceDescriptor();
const failures = [];

if (!config.includes("testDir")) failures.push("Playwright test directory is not declared");
if (descriptor.capabilities.conversionWorker) failures.push("browser scaffold must not claim a Worker implementation");
if (descriptor.capabilities.localPersistence) failures.push("browser scaffold must not claim IndexedDB persistence");
if (descriptor.capabilities.packageExport) failures.push("browser scaffold must not claim package export");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Browser content-authoring placeholder check passed.");
