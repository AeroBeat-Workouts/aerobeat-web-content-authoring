// @ts-check

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} path
 * @returns {string[]}
 */
function collectVisibleFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules") {
      files.push(...collectVisibleFiles(fullPath));
    } else if (entry.endsWith(".html") || entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];
for (const root of ["src/screens", ".testbed/scenes"]) {
  for (const file of collectVisibleFiles(root)) {
    const source = readFileSync(file, "utf8");
    if (/<(?:button|input|select|textarea)\b/u.test(source)) {
      failures.push(`${file}: visible controls must be named aero-* Web Components`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Component-only scaffold check passed.");
