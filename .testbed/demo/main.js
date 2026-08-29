// @ts-check

import { createAeroWebContentAuthoringService, inspectAuthoredPackageExport } from "../../src/index.js";

const status = document.querySelector("#status");

/** @param {string} value */
function show(value) { if (status) status.textContent = value; }

const harnessWindow = /** @type {Window & typeof globalThis & {runAuthoringHarness: () => Promise<Record<string, unknown>>}} */ (/** @type {unknown} */ (window));

harnessWindow.runAuthoringHarness = async () => {
  const databaseName = `aerobeat-authoring-browser-${Date.now()}`;
  const service = createAeroWebContentAuthoringService({ useBrowserWorker: true, useIndexedDb: true });
  const source = syntheticSource();
  const snapshots = [];
  service.subscribe((snapshot) => { snapshots.push(snapshot.state); show(`${snapshot.state} ${Math.round(snapshot.progress * 100)}%`); });
  const authored = await service.convertAndPersist({ providerId: "synthetic", sourceHash: "browser-v1", source }, { difficulty: "Hard", sourceId: databaseName, sourceVersionHash: "browser-v1", includeAudio: true });
  const list = await service.listPackages();
  const loaded = await service.loadPackage(authored.handle);
  const audio = await service.readAsset(authored.handle, "song.ogg");
  const exported = await service.exportPackage(authored.handle);
  const inspected = await inspectAuthoredPackageExport(exported.bytes);
  await service.deletePackage(authored.handle);
  const remaining = await service.listPackages();
  const snapshot = service.getSnapshot();
  service.destroy();
  const authoredPackage = /** @type {{charts: unknown[]}} */ (authored.package);
  const loadedPackage = /** @type {{packageId: string}} */ (loaded.package);
  return { chartCount: authoredPackage.charts.length, listCount: list.length, loadedPackageId: loadedPackage.packageId, audioBytes: [...audio], exportPackageId: inspected.packageId, exportAssetCount: inspected.assets.length, remaining: remaining.length, states: snapshots, snapshotHasRawBytes: containsByteArray(snapshot) };
};

/** @param {unknown} value */
function containsByteArray(value) { if (value instanceof Uint8Array || value instanceof ArrayBuffer) return true; if (Array.isArray(value)) return value.some(containsByteArray); if (value && typeof value === "object") return Object.values(value).some(containsByteArray); return false; }

function syntheticSource() {
  const path = "Hard.dat";
  const map = { version: "3.3.0", colorNotes: [{ b: 1, x: 0, y: 2, c: 0, d: 1 }, { b: 2, x: 1, y: 1, c: 1, d: 0 }, { b: 3, x: 2, y: 0, c: 0, d: 2 }], bombNotes: [], obstacles: [{ b: 4, d: 1, x: 0, y: 0, w: 1, h: 3 }], sliders: [], burstSliders: [] };
  const entries = new Map([["info.dat", new TextEncoder().encode("{}")], [path.toLowerCase(), new TextEncoder().encode(JSON.stringify(map))], ["song.ogg", new Uint8Array([4, 3, 2, 1])]]);
  return Object.freeze({
    manifest: Object.freeze({ schemaId: "aerobeat.beatsaver-source-manifest.v1", sourceFormatMajor: 3, infoPath: "Info.dat", songName: "Browser Synthetic", songAuthorName: "AeroBeat", levelAuthorName: "AeroBeat", audioPath: "song.ogg", bpm: 120, difficulties: Object.freeze([{ characteristic: "Standard", difficulty: "Hard", path }]), entries: Object.freeze([]) }),
    listEntryPaths() { return Object.freeze(["Info.dat", path, "song.ogg"]); },
    readEntry(entryPath) { const value = entries.get(entryPath.toLowerCase()); if (!value) throw new Error("missing"); return Uint8Array.from(value); }
  });
}

show("ready");
