# Wall-heavy human-made maps must import

Status: live in 0.0.148 on the public playtest link; Derrick's phone check is the remaining field test.

## Symptom

Derrick downloaded a human-made BeatSaver map ("On My Knees - Rüfüs Du Sol", map `54441`,
version `992b0f37…`) to try on his phone and the import failed with
`flow_obstacle_limit_exceeded`.

## Diagnosis

- The import converts every Standard difficulty of a song atomically into one collection, so a
  single difficulty over the limit fails the whole song.
- The map's ExpertPlus difficulty holds 3,619 raw v3 obstacle entries. 2,528 of them are
  **zero-width art placeholders** (`w: 0`, positive duration and height) that the parser drops
  because they enclose no volume. That leaves **1,091 real walls**.
- Hard has 302 walls and Expert 450; both were already under the cap.
- `maximumObstaclesPerChart` was 512 (contracts, introduced in the 0.0.52 wave-0 stage), so
  1,091 walls were rejected. The cap is enforced in the converter, the package validator and the
  content runtime, so it is a product-wide bound rather than an import-only guard.

## Change

- `maximumObstaclesPerChart` 512 → 4,096 in `aerobeat-web-contracts`, with the measurement and
  the reasoning recorded at the constant. The bound still rejects pathological content; it now
  leaves roughly 4x headroom over a real wall-heavy human map.
- The bound stays linear and windowed in cost: conversion, validation and package JSON scale with
  the count, while runtime judging and rendering only touch walls inside the active time window.
- `aerobeat-web-content/scripts/validate-content-runtime.js` now builds its rejection case from the
  constant instead of a literal 513, so it tracks the contract.
- `aerobeat-web-content-authoring/scripts/validate-flow-obstacles.js` gains a wall-heavy
  regression: 1,200 walls plus 800 zero-width placeholders must parse to exactly 1,200 walls,
  reach the Flow chart, and produce a valid authored package.

## Evidence

Real archive through the production path (vendor archive inspection, then the atomic
multi-difficulty authoring service, memory persistence, inline worker, no converter overrides):

```
IMPORT OK {"songName":"On My Knees","perDifficulty":[
  {"difficulty":"Expert","obstacles":450,"notes":487},
  {"difficulty":"ExpertPlus","obstacles":1091,"notes":3105},
  {"difficulty":"Hard","obstacles":302,"notes":2756}]}
```

4.1 s for three difficulties in Node. Before the change the same run failed at the ExpertPlus
difficulty with `flow_obstacle_limit_exceeded`. Per-difficulty conversion cost and package size
from the converter alone: Hard 425 ms / 762 KB, Expert 125 ms / 461 KB, ExpertPlus 395 ms /
1.06 MB of chart JSON.

## Non-goals

- No wall merging, filtering or budgeted dropping. Every normalized wall stays a real hazard; an
  art-heavy map will play as wall-heavy, which is the mapper's design and what Beat Saber itself
  does with those walls.
- No judging, renderer or ruleset change, and no new Game Setup control.

## Risks

- Larger charts cost more memory and validation time; the cap keeps that bounded at 4,096 walls.
- Packages authored under the old cap remain valid: the bound is only compared against the count.

## Delivered

1. Committed: contracts `43ec0a4`, content `4721207`, content-authoring `3d082d7`, assembly `d5e7fbb`
   with pins `d46c5ce` and docs `4f877e1`.
2. Full assembly `npm test` green at 0.0.148.
3. Signed snapshot `.tmp/boxing-r148-d46c5ce` (build stamp `FRIEND-GAME-CPU-0.0.148-af1ed6e62bf54e636428ed73`)
   imports `54441` in Chromium through the shipped bundle: one collection, three difficulties
   persisted (Hard 302 walls, Expert 450, ExpertPlus 1,091), about 10 s, no page errors.
4. Public cutover done: systemd user unit `aerobeat-r148` on loopback 4211, Funnel repointed from
   4210. Public Chromium reports 0.0.148 directly and in a true cross-origin iframe, and the same
   import succeeds over the public URL. Rollback: stop `aerobeat-r148`, point the Funnel at 4210.

## Remaining

- Derrick re-imports the song on his phone. Note that an earlier failed import left no collection, so
  the song simply needs importing again; no local cleanup is required.

## Accepted limits

- ExpertPlus on this map is wall-heavy by design: 1,091 walls. It will play hard, which is the
  mapper's choice rather than a conversion fault.
- The `test:real` fixture lane in this repo still needs uncommitted local archives (3D44B); that gap
  predates this change and `test:unit` plus the real-archive run above cover the converter.

## Parked thread

Local ZIP reimport (Derrick chose "reimport from the stored copy") is not started.

Why it is affordable with no new storage: import already persists the source material it needs.
`StoredPackageRecord.sourceCache` holds the cached `Info.dat` and difficulty bytes (import runs with
`cacheSourceEntries: true`) and `assets` holds the decoded audio, and
`prepareSourceMaterial(acquired, { manifest, listEntryPaths, readEntry })` accepts exactly that
bundle. So a local song can be re-converted from what is already on disk, with no second copy of the
archive.

What still has to change: local imports are written as `sourceProvider: "beatsaver"` with
`sourceId: "local"`, so today's Reimport tries a BeatSaver lookup and fails, and
`reusableCollectionIds` wrongly offers those songs. The work is to label local imports honestly, add
an authoring-service rebuild-from-cache path, route local reimport through it without a file prompt,
and let local collections use `replaceCollectionId` (the batch replacement gate currently demands an
exact BeatSaver source).