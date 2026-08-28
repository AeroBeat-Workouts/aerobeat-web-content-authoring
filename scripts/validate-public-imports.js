// @ts-check

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} path
 * @returns {string[]}
 */
function collectJavaScriptFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules") {
      files.push(...collectJavaScriptFiles(fullPath));
    } else if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];
for (const root of ["src", ".testbed"]) {
  for (const file of collectJavaScriptFiles(root)) {
    const source = readFileSync(file, "utf8");
    if (/(?:from|import)\s*\(?\s*["'][^"']*aerobeat-web-[^"']*\/src\//u.test(source)) {
      failures.push(`${file}: imports a sibling repository source path`);
    }
    if (/(?:from|import)\s*\(?\s*["']@aerobeat\/web-[^"']*\/internal/u.test(source)) {
      failures.push(`${file}: imports another package internal surface`);
    }
    if (/[@/]aerobeat[-/]vendor[-/]beatsaver/u.test(source)) {
      failures.push(`${file}: provider-specific BeatSaver implementation does not belong in content authoring`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Public import-boundary scaffold check passed.");
