# Wall-heavy human-made maps must import

Status: implemented in source, pending release (0.0.148) and Derrick's phone check.

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

## Remaining

1. Commit contracts, content and content-authoring; bump the assembly to 0.0.148 and pin it.
2. Build the signed snapshot and import this map in Chromium through the shipped bundle.
3. Cut the public link over so Derrick can play it on his phone.

## Parked thread

Local ZIP reimport (Derrick chose "reimport from the stored copy") is not started. The blocker to
record for that work: local imports are written as `sourceProvider: "beatsaver"` with
`sourceId: "local"`, so today's Reimport looks the song up on BeatSaver and fails; the authoring
persistence record also keeps no archive to replay, so "stored copy" needs the imported bytes (or
an equivalent) persisted at import time. Derrick has not yet approved the extra storage that would
cost, and I had told him it needed none — correct that before implementing.