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

The browser locks the canonical contract, recipes, rulesets, event IDs, lineage, target grids, timing, reach, spacing optimizer, guard relocation, obstacle checkpoints, modifiers, and conversion traces. Every SHA-256 identity in the main Window and conversion Worker routes through the shared `@aerobeat/web-hash` owner in production `auto` mode, preserving native WebCrypto where available and deterministic bundled fallback elsewhere. Normalized Beat Saber note `x`, `y`, and `cell` values deliberately remain bottom-left source coordinates. Obstacle normalization is separately versioned and mode-neutral: exact provider evidence remains in `sourceGeometry`, while `gameplayGeometry` is explicit downward `aerobeat_top_left_grid` render/collision authority and `gridMask` is derived from it. Every generated Boxing `squat`/`weave_*` retains the exact source `end`, both geometries, and the derived mask; `blockedCells` must equal that mask and the instantaneous checkpoint safe cells must equal its exact complement. Those fields participate in traces, semantic parity, chart/package hashes, feasibility, reach, guard relocation, and modifier regeneration identity. V2 type 0/type 1 and v3/v4 rectangles use separate fixture-locked conversions; coordinate spaces are never silently reused. Notes, bombs, arc head/tail, and burst/chain head/tail still convert exactly once into AeroBeat top-left cells; Boxing continues to use its existing explicit top-left helpers and is not flipped twice. JavaScript loses Godot's integer-versus-float Variant distinction, so ordinary sorted JavaScript JSON cannot truthfully reproduce every Godot SHA-256. The package therefore:

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

`convertAllStandardAndPersist` prepares one verified archive/audio source, converts canonical Standard difficulties sequentially, independently validates each one-difficulty `aerobeat.song-package.v5` package, and then performs one collection transaction. The returned bounded collection/package handles contain no media bytes. Shared audio is stored once by content hash and resolved into self-contained `readAsset` and `AEROPKG1` export operations. Worker, validation, cancellation, and quota failure before transaction completion expose no partial collection.

Public snapshots and persistence handles conform to the finalized web contracts and contain no ZIP, difficulty, audio, `Blob`, `File`, provider object, or browser capability values. Request metadata is narrowed before the first snapshot. Raw source/audio copies remain inside source, Worker-transfer, persistence, and explicit `readAsset`/export boundaries.

Source adaptation accepts only the exact finalized `aerobeat.beatsaver-source-manifest.v2` own-data shape, including independent Info fields and complete Standard difficulty rank/format/version/palette/movement fields, plus bounded dense path/difficulty arrays, normalized unique paths, bounded selected bytes and text, and optional lowercase SHA-256 expectations. When an expected difficulty or audio hash is supplied, mismatch fails closed before conversion or persistence; no coercion/accessor hooks execute.

Current output is package schema `aerobeat.song-package.v5`, schema version `5`, package version `5.0.0`, with immutable hash-bound `source.spawnTiming`. The exact selected-difficulty Info.dat BPM/NJS/offset are carried through the strict source manifest and Worker request, then authoring recomputes HJD/reaction time/diagnostic jump distance with pinned `beatsaber_core_hjd_v1` constants and operation order; every trace and package hash binds the same exact record. Versions 1–4 require stable `spawn_timing_reimport_required` rather than inferred defaults. The package retains one Flow `aerobeat.chart.flow.v4` schema version `4`. Package `notePalette` is either a hash-authenticated authored song pair with private source provenance or `null`. Flow carries only a package palette reference/hash and a content hash over its ruleset, beats, and palette reference. Palette identity is bound into package integrity, Flow trace, top conversion trace, and semantic parity, but remains absent from every beat, every Boxing chart/trace identity, and scoring semantics. Downstream runtime may privately apply the one package-effective pair to left/right Boxing punch rendering; authoring does not embed palette fields in Boxing charts, traces, or events.

## Worker Protocol

The request, message, and nested result protocol is version 2 and uses exact, bounded, job-bound structured-clone-safe shapes containing plain data plus one selected `Uint8Array`. Its `aerobeat.authoring-source.v2` manifest preserves independent Info format/version/path/hash and selected beatmap format/version/path/hash fields, with an explicit difficulty `notePalette` of song authority or `null`; there is no `sourceFormatMajor` alias. Main and Worker independently revalidate the palette shape and exact Info/difficulty hash provenance, and manifest/options identities must agree. It does not require `SharedArrayBuffer`. A real disposable module Worker adapter and deterministic inline fallback are provided. Browser Worker transfer detaches its private request copy rather than the vendor source closure; cancellation, replacement, destruction, malformed messages, and mismatched job IDs settle exactly once.

## Persistence and Export

IndexedDB database `aerobeat-web-content-authoring` is schema version 7 with `packages`, `assets`, `collections`, and `meta` stores. Opening a version 1–6 database atomically preserves every package byte/hash, collection, inline asset, shared asset, and optional local-ZIP source-cache byte while labeling historical pre-normalized rows `prior_obstacle_contract`. The exact raw-0.0.39 DB5 `flowObstacleContract` package/collection field and the dual-key DB6 rows produced by the faulty DB5→DB6 migration are validated, translated to the sole current `obstacleContract` field, and stripped of the obsolete key in the versionchange transaction; unknown shapes abort the complete upgrade with a bounded storage error. Stale entries remain listable with unchanged exact public summary keys, exportable for recovery, and deletable; no migration rewrites package bytes or hashes. Existing orientation and obstacle failures retain precedence, while an otherwise current-obstacle v3 package fails normal package load and asset/play reads with exact code `note_palette_reimport_required`. Same-source reimport creates a current v5 package without rewriting the historical v3 bytes/hash. Every new memory or IndexedDB write is marked `normalized_obstacle_v2` plus corrected top-left orientation internally. Reimport through `put` or `putCollection` replaces the same stable package/collection keys with current rows, after which normal loading succeeds, and scan-based garbage collection retains shared assets while any surviving package references them. The `aerobeat.authored-packages.v2` handle namespace remains unchanged, so assembly may retain stale entries for management but must surface the reimport requirement rather than silently selecting them. Both adapters provide atomic `putCollection`, `listCollections`, `getCollection`, and `deleteCollection` operations; quota/cancellation fail before commit, and optional source-cache entries remain package-local and disabled unless requested.

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
- strict v2 type-0/type-1, v3 inline, and v4 indexed obstacle normalization, including stable rejection of present non-array obstacle containers; exact continuous geometry plus derived-mask truth; and exactly-once top-left Flow emission for notes, bombs, arcs, and v3/v4 bursts/chains;
- exact sanitized `3C9D` Standard Easy orientation evidence, including beat `21` `(x=3,y=0)` → canonical cell `11`;
- sanitized Godot semantic golden parity and deterministic reruns;
- Worker cancellation, no-partial-persistence behavior, and exact inline/real-Chromium rejection of every mixed v1/v2 envelope/manifest/message/result seam plus stale `sourceFormatMajor`;
- memory, fake IndexedDB, and real Chromium DB7 preservation/list/export/delete/reimport/shared-asset paths, including exact `spawn_timing_reimport_required` behavior for v1–v4;
- deterministic package export;
- Chromium secure-localhost and genuine non-loopback Tailscale-style HTTP Window + module Worker hashing, conversion, IndexedDB persistence/reload, deterministic export, exact native/fallback identity parity, and zero warning/error console policy;
- content-hashed synthetic Task 11 v2/v3/v4 source-matrix conversion through the public service, including exact chart IDs, lineage, modifier unions and stable semantic hashes;
- cached uncommitted BeatSaver `4858` Standard Expert proving invalid HDR palette → explicit fallback `null` before atomic malformed-obstacle rejection, and `3D44B` Standard Hard proving exact Info v2.1/beatmap v3.3 separation plus `#FF7E14/#0080FF` custom palette through deterministic package/export; optional transient `53F26` remains available only when a local/live vendor fixture is safely supplied; plus the committed exact raw `3c9d` Standard Hard source/hash oracle;
- optional exact Catalyst proof (`npm run test:catalyst`) for BeatSaver `1AE3A` version `1348bac90dd94d7299bda388bd101a2b967e28b3`: Standard Expert and ExpertPlus become two unchanged v1 packages, ten charts, one atomic collection and one shared audio asset while public collection state remains media-free.

Real archives and audio are local test inputs and are never committed. Override their locations with `AEROBEAT_BEATSAVER_4858_ZIP`, `AEROBEAT_BEATSAVER_3D44B_ZIP`, or `AEROBEAT_BEATSAVER_1AE3A_ZIP`. The normal real-map test checks established local vendor `.testbed` paths and fails with the explicit `missing-local-fixture` code only when no supported readable path exists. The optional Catalyst proof uses its local fixture when present and otherwise performs transient live acquisition without writing the archive.

Optional converter profiles use exact `aerobeat/prototype_profile` v1 records in class `converter_regeneration`. The profile hash covers schema/version/profile ID/profile version/class plus bounded integer `guardRelocationRadius` and `reachAllowanceSubcells` settings. `guardRelocationRadius` is the maximum 8×6-subgrid Manhattan displacement permitted independently from each hand's source guard cell center to its generated guard cell center; the existing deterministic guard-pair tie-break remains unchanged. `reachAllowanceSubcells` is added to the fixed difficulty reach-subcells-per-beat rate, never multiplied. Both values are bounded 0..8. The main thread verifies the profile before dispatch, the Worker independently verifies the same source record, and regenerated packages bind it into source provenance, top conversion trace, every Boxing chart, every Boxing trace, package hash, and semantic identity. Flow traces never carry Boxing converter-profile fields; validation rejects profile fields that silently appear there. Before persistence the main thread recomputes the full semantic projection and independently compares every provenance location to the requested normalized profile. `aero.converter.canonical` and `aero.converter.prototype-reach` remain experimental; selecting one outside conversion never rewrites existing content, so applied truth requires package provenance carrying the selected profile hash. Omitting a profile is backward compatibility only: it bypasses the relocation-radius gate entirely and preserves the legacy unrestricted guard search rather than using a numeric sentinel.
