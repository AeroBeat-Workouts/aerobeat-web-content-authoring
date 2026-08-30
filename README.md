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

It adapts one explicit Standard difficulty, or prepares every exact Standard difficulty in canonical Easy → Normal → Hard → Expert → ExpertPlus order, using only required entry copies and one shared audio read/hash. Worker conversion remains one difficulty per request and emits one Flow chart plus the four frozen Boxing prototype combinations:

- Semantic Track · Row Family
- Spatial Grid · Row Family
- Semantic Track · Cut Family
- Spatial Grid · Cut Family

The package does not call BeatSaver APIs, inspect ZIP structures, depend on provider DTOs, choose playlists, render UI, play media, score gameplay, or select a production Boxing winner.

## Canonical and Cross-Language Boundaries

`aerobeat-content-core` remains the durable authored-content authority. Godot authoring commit `59c93de` and content-core commit `476da22` are the final audited algorithm/contract references; browser authoring is an independent implementation.

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

- `prepareSourceMaterial(source, options)` / `prepareAllStandardSourceMaterials(source, options)`
- `convertAndPersist(source, options)`
- `cancel(jobId?)`
- `getSnapshot()` / `subscribe(listener)`
- `listPackages()` / `loadPackage(handle)` / `deletePackage(handle)`
- `readAsset(handle, path)`
- `estimateStorage()` / `migrateStorage()`
- `exportPackage(handle)`
- `getCapabilities()` / `destroy()`

A new conversion aborts the previous job. Cancellation, replacement and destruction suppress stale completion. Durable writes happen only after Worker conversion and package validation; an abort observed after a write removes that record.

Public snapshots and persistence handles conform to the finalized web contracts and contain no ZIP, difficulty, audio, `Blob`, `File`, provider object, or browser capability values. Request metadata is narrowed before the first snapshot. Raw source/audio copies remain inside source, Worker-transfer, persistence, and explicit `readAsset`/export boundaries.

Source adaptation accepts only bounded own data: ordinary dense path/difficulty arrays, normalized unique paths, bounded selected bytes and text, and optional lowercase SHA-256 expectations. When an expected difficulty or audio hash is supplied, mismatch fails closed before conversion or persistence; no coercion/accessor hooks execute.

## Worker Protocol

The protocol is version 1 and uses an exact, bounded, job-bound structured-clone-safe message shape containing plain data plus one selected `Uint8Array`. Manifest/options identities and verified hashes must agree. It does not require `SharedArrayBuffer`. A real disposable module Worker adapter and deterministic inline fallback are provided. Browser Worker transfer detaches its private request copy rather than the vendor source closure; cancellation, replacement, destruction, malformed messages, and mismatched job IDs settle exactly once.

## Persistence and Export

IndexedDB database `aerobeat-web-content-authoring` is schema version 3 with additive `packages`, `assets`, `collections`, and `meta` stores plus legacy record migration. Existing inline package records and the `aerobeat.authored-packages.v2` handle namespace remain compatible. Both adapters provide atomic `putCollection`, `listCollections`, `getCollection`, and `deleteCollection` operations: packages may reference content-addressed shared assets, reads resolve self-contained package assets, ungrouped legacy packages appear as deterministic singleton collections, quota/cancellation fail before commit, and scan-based garbage collection retains assets while any package references them. Optional source-cache entries remain package-local and disabled unless requested.

Exports use deterministic `AEROPKG1` framing: magic, bounded canonical metadata length, canonical package/asset table JSON, then normalized unique assets in code-point lexicographic path order. Inspection requires contiguous bounded offsets, exact total length, verified package/asset SHA-256 hashes, and no trailing bytes. Export contains no creation timestamp. IndexedDB deletion and stale-job cleanup use single read/write transactions with write-token protection; quota errors fail with `quota_exceeded`.

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
- content-hashed synthetic Task 11 v2/v3/v4 source-matrix conversion through the public service, including exact chart IDs, lineage, modifier unions and stable semantic hashes;
- real uncommitted BeatSaver fixtures `4858` Standard Expert and `3D44B` Standard Hard with copied audio hash/path, persistence reload, deterministic `AEROPKG1` inspection and atomic deletion.

Real archives and audio are local test inputs and are never committed. Override their locations with `AEROBEAT_BEATSAVER_4858_ZIP` and `AEROBEAT_BEATSAVER_3D44B_ZIP`; otherwise the test checks the established local vendor `.testbed` paths and fails with the explicit `missing-local-fixture` code only when no supported readable path exists.

Optional converter profiles use exact `aerobeat/prototype_profile` v1 records in class `converter_regeneration`. The profile hash covers schema/version/profile ID/profile version/class plus bounded integer `guardRelocationRadius` and `reachAllowanceSubcells` settings. `guardRelocationRadius` is the maximum 8×6-subgrid Manhattan displacement permitted independently from each hand's source guard cell center to its generated guard cell center; the existing deterministic guard-pair tie-break remains unchanged. `reachAllowanceSubcells` is added to the fixed difficulty reach-subcells-per-beat rate, never multiplied. Both values are bounded 0..8. The main thread verifies the profile before dispatch, the Worker independently verifies the same source record, and regenerated packages bind it into source provenance, top conversion trace, every Boxing chart, every Boxing trace, package hash, and semantic identity. Flow traces never carry Boxing converter-profile fields; validation rejects profile fields that silently appear there. Before persistence the main thread recomputes the full semantic projection and independently compares every provenance location to the requested normalized profile. `aero.converter.canonical` and `aero.converter.prototype-reach` remain experimental; selecting one outside conversion never rewrites existing content, so applied truth requires package provenance carrying the selected profile hash. Omitting a profile is backward compatibility only: it bypasses the relocation-radius gate entirely and preserves the legacy unrestricted guard search rather than using a numeric sentinel.
