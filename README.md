# aerobeat-web-content-authoring

Provider-neutral browser conversion, local authoring persistence, and deterministic package export for AeroBeat Web.

## Responsibility

`@aerobeat/web-content-authoring` consumes a safe source bundle with exactly this capability boundary:

```js
{
  manifest,
  listEntryPaths(),
  readEntry(path)
}
```

It selects one explicit Standard difficulty, adapts only selected entry copies into a structured-clone-safe Worker request, normalizes Beat Saber v2/v3/v4 data, and emits one Flow chart plus the four frozen Boxing prototype combinations:

- Semantic Track · Row Family
- Spatial Grid · Row Family
- Semantic Track · Cut Family
- Spatial Grid · Cut Family

The package does not call BeatSaver APIs, inspect ZIP structures, depend on provider DTOs, choose playlists, render UI, play media, score gameplay, or select a production Boxing winner.

## Canonical and Cross-Language Boundaries

`aerobeat-content-core` remains the durable authored-content authority. Godot authoring commit `3954782` is the algorithm/parity reference; browser authoring is an independent implementation.

The browser locks the canonical contract, recipes, rulesets, event IDs, lineage, target grids, timing, reach, spacing optimizer, guard relocation, obstacle checkpoints, modifiers, and conversion traces. JavaScript loses Godot's integer-versus-float Variant distinction, so ordinary sorted JavaScript JSON cannot truthfully reproduce every Godot SHA-256. The package therefore:

- preserves and validates browser-local deterministic package/source/content hashes;
- never labels those hashes as Godot hashes;
- locks event types, event IDs, ordering, lineage and targets against the sanitized Godot golden;
- exports a documented `semanticParityHash` over a language-neutral projection.

`fixtures/boxing-prototype-golden-v1.json` records both the authoritative Godot hashes and the separate browser semantic parity hash.

## Service

```js
import { createAeroWebContentAuthoringService } from "@aerobeat/web-content-authoring";

const service = createAeroWebContentAuthoringService({
  useBrowserWorker: true,
  useIndexedDb: true
});

const authored = await service.convertAndPersist(acquiredSource, {
  difficulty: "Expert",
  sourceId: "4858",
  sourceVersionHash: "431ffaa53a1e45ffab6c81a895e456f6aad1e038",
  includeAudio: true,
  cacheSourceEntries: false,
  signal
});
```

Public operations:

- `convertAndPersist(source, options)`
- `cancel(jobId?)`
- `getSnapshot()` / `subscribe(listener)`
- `listPackages()` / `loadPackage(handle)` / `deletePackage(handle)`
- `readAsset(handle, path)`
- `estimateStorage()` / `migrateStorage()`
- `exportPackage(handle)`
- `getCapabilities()` / `destroy()`

A new conversion aborts the previous job. Cancellation, replacement and destruction suppress stale completion. Durable writes happen only after Worker conversion and package validation; an abort observed after a write removes that record.

Public snapshots and persistence handles conform to the finalized web contracts and contain no ZIP, difficulty, or audio bytes. Raw source/audio copies remain inside source, Worker-transfer, persistence, and explicit `readAsset`/export boundaries.

## Worker Protocol

The protocol is version 1 and uses structured-clone-safe plain data plus `Uint8Array`. It does not require `SharedArrayBuffer`. A real disposable module Worker adapter and deterministic inline fallback are provided. Browser Worker transfer detaches its private request copy rather than the vendor source closure.

## Persistence and Export

IndexedDB database `aerobeat-web-content-authoring` is schema version 2 with `packages` and `meta` stores plus v1 record migration. The memory adapter provides identical list/load/delete/quota behavior for tests and unsupported contexts. Optional source-cache entries are disabled unless requested.

Exports use deterministic `AEROPKG1` framing: magic, canonical metadata length, canonical package/asset table JSON, then assets in lexicographic path order. The asset table records offsets, lengths and SHA-256 hashes. Export contains no creation timestamp.

## Validation

```bash
npm run check
npm run test:unit
npm run test:real
npm run test:browser
```

Coverage includes:

- strict JavaScript ESM/JSDoc and public import boundaries;
- v2/v3/v4 normalization and Flow preservation;
- sanitized Godot semantic golden parity and deterministic reruns;
- Worker cancellation and no-partial-persistence behavior;
- memory and IndexedDB list/load/delete/quota paths;
- deterministic package export;
- Chromium module Worker + IndexedDB + zero warning/error console policy;
- real uncommitted BeatSaver fixtures `4858` Standard Expert and `3D44B` Standard Hard.

Real archives and audio are local test inputs and are never committed.
