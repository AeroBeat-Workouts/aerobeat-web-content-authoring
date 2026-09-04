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

The browser locks the canonical contract, recipes, rulesets, event IDs, lineage, target grids, timing, reach, spacing optimizer, guard relocation, obstacle checkpoints, modifiers, and conversion traces. Every SHA-256 identity in the main Window and conversion Worker routes through the shared `@aerobeat/web-hash` owner in production `auto` mode, preserving native WebCrypto where available and deterministic bundled fallback elsewhere. Normalized Beat Saber `x`, `y`, and `cell` values deliberately remain bottom-left source coordinates. Flow emission converts every note, bomb, arc head/tail, burst/chain head/tail, and obstacle-covered cell exactly once into AeroBeat's top-left row-major cells; Boxing continues to use its existing explicit top-left helpers and is not flipped twice. JavaScript loses Godot's integer-versus-float Variant distinction, so ordinary sorted JavaScript JSON cannot truthfully reproduce every Godot SHA-256. The package therefore:

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
- `convertAndPersist(source, options)` / `convertAllStandardAndPersist(source, options)`
- `cancel(jobId?)`
- `getSnapshot()` / `subscribe(listener)`
- `listPackages()` / `loadPackage(handle)` / `deletePackage(handle)`
- `listCollections()` / `getCollection(collectionId)` / `deleteCollection(collectionId)`
- `readAsset(handle, path)`
- `estimateStorage()` / `migrateStorage()`
- `exportPackage(handle)`
- `getCapabilities()` / `destroy()`

A new conversion aborts the previous job. Cancellation, replacement and destruction suppress stale completion. Durable writes happen only after Worker conversion and package validation; an abort observed after a write removes that record.

`convertAllStandardAndPersist` prepares one verified archive/audio source, converts canonical Standard difficulties sequentially, independently validates each unchanged one-difficulty v1 package, and then performs one collection transaction. The returned bounded collection/package handles contain no media bytes. Shared audio is stored once by content hash and resolved into self-contained `readAsset` and `AEROPKG1` export operations. Worker, validation, cancellation, and quota failure before transaction completion expose no partial collection.

Public snapshots and persistence handles conform to the finalized web contracts and contain no ZIP, difficulty, audio, `Blob`, `File`, provider object, or browser capability values. Request metadata is narrowed before the first snapshot. Raw source/audio copies remain inside source, Worker-transfer, persistence, and explicit `readAsset`/export boundaries.

Source adaptation accepts only bounded own data: ordinary dense path/difficulty arrays, normalized unique paths, bounded selected bytes and text, and optional lowercase SHA-256 expectations. When an expected difficulty or audio hash is supplied, mismatch fails closed before conversion or persistence; no coercion/accessor hooks execute.

## Worker Protocol

The protocol is version 1 and uses an exact, bounded, job-bound structured-clone-safe message shape containing plain data plus one selected `Uint8Array`. Manifest/options identities and verified hashes must agree. It does not require `SharedArrayBuffer`. A real disposable module Worker adapter and deterministic inline fallback are provided. Browser Worker transfer detaches its private request copy rather than the vendor source closure; cancellation, replacement, destruction, malformed messages, and mismatched job IDs settle exactly once.

## Persistence and Export

IndexedDB database `aerobeat-web-content-authoring` is schema version 4 with `packages`, `assets`, `collections`, and `meta` stores. Opening a version 1–3 database atomically preserves every package, collection, inline asset, shared asset, and optional local-ZIP source-cache byte while marking legacy package/collection rows internally as stale Flow orientation. Stale entries remain listable with the unchanged exact public summary keys, exportable for recovery, and deletable, but package load and asset/play reads fail with bounded storage code `flow_orientation_reimport_required`; they cannot masquerade as corrected output. Every new memory or IndexedDB write is marked with the corrected top-left orientation internally. Reimport through `put` or `putCollection` replaces the same stable package/collection keys with current rows, after which normal loading succeeds, and scan-based garbage collection retains shared assets while any surviving package references them. The `aerobeat.authored-packages.v2` handle namespace remains unchanged, so assembly may retain stale entries for management but must surface the reimport requirement rather than silently selecting them. Both adapters provide atomic `putCollection`, `listCollections`, `getCollection`, and `deleteCollection` operations; quota/cancellation fail before commit, and optional source-cache entries remain package-local and disabled unless requested.

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
- v2/v3/v4 bottom-left source normalization and exactly-once top-left Flow emission for notes, bombs, arcs, v3/v4 bursts/chains, and supported obstacle coverage;
- exact sanitized `3C9D` Standard Easy orientation evidence, including beat `21` `(x=3,y=0)` → canonical cell `11`;
- sanitized Godot semantic golden parity and deterministic reruns;
- Worker cancellation and no-partial-persistence behavior;
- memory and IndexedDB list/load/delete/quota paths;
- deterministic package export;
- Chromium secure-localhost and genuine non-loopback Tailscale-style HTTP Window + module Worker hashing, conversion, IndexedDB persistence/reload, deterministic export, exact native/fallback identity parity, and zero warning/error console policy;
- content-hashed synthetic Task 11 v2/v3/v4 source-matrix conversion through the public service, including exact chart IDs, lineage, modifier unions and stable semantic hashes;
- real uncommitted BeatSaver fixtures `4858` Standard Expert and `3D44B` Standard Hard with copied audio hash/path, persistence reload, deterministic `AEROPKG1` inspection and atomic deletion;
- optional exact Catalyst proof (`npm run test:catalyst`) for BeatSaver `1AE3A` version `1348bac90dd94d7299bda388bd101a2b967e28b3`: Standard Expert and ExpertPlus become two unchanged v1 packages, ten charts, one atomic collection and one shared audio asset while public collection state remains media-free.

Real archives and audio are local test inputs and are never committed. Override their locations with `AEROBEAT_BEATSAVER_4858_ZIP`, `AEROBEAT_BEATSAVER_3D44B_ZIP`, or `AEROBEAT_BEATSAVER_1AE3A_ZIP`. The normal real-map test checks established local vendor `.testbed` paths and fails with the explicit `missing-local-fixture` code only when no supported readable path exists. The optional Catalyst proof uses its local fixture when present and otherwise performs transient live acquisition without writing the archive.

Optional converter profiles use exact `aerobeat/prototype_profile` v1 records in class `converter_regeneration`. The profile hash covers schema/version/profile ID/profile version/class plus bounded integer `guardRelocationRadius` and `reachAllowanceSubcells` settings. `guardRelocationRadius` is the maximum 8×6-subgrid Manhattan displacement permitted independently from each hand's source guard cell center to its generated guard cell center; the existing deterministic guard-pair tie-break remains unchanged. `reachAllowanceSubcells` is added to the fixed difficulty reach-subcells-per-beat rate, never multiplied. Both values are bounded 0..8. The main thread verifies the profile before dispatch, the Worker independently verifies the same source record, and regenerated packages bind it into source provenance, top conversion trace, every Boxing chart, every Boxing trace, package hash, and semantic identity. Flow traces never carry Boxing converter-profile fields; validation rejects profile fields that silently appear there. Before persistence the main thread recomputes the full semantic projection and independently compares every provenance location to the requested normalized profile. `aero.converter.canonical` and `aero.converter.prototype-reach` remain experimental; selecting one outside conversion never rewrites existing content, so applied truth requires package provenance carrying the selected profile hash. Omitting a profile is backward compatibility only: it bypasses the relocation-radius gate entirely and preserves the legacy unrestricted guard search rather than using a numeric sentinel.
