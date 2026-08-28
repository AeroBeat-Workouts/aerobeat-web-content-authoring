// @ts-check

import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

const linkPath = resolve(".testbed/node_modules/@aerobeat/web-content-authoring");
const targetPath = resolve(".");

mkdirSync(dirname(linkPath), { recursive: true });
rmSync(linkPath, { force: true, recursive: true });
symlinkSync(targetPath, linkPath, "dir");

console.log(`Linked ${linkPath} -> ${targetPath}`);
