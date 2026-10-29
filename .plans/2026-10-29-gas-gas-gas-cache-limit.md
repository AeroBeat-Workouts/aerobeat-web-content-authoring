# GAS GAS GAS cache-entry limit fix

Status: cache-limit implementation and source validation complete; cache-only scope confirmed. Browser/release results are maintained in the assembly release coordination plan.
Owner: Pico. Bead: aerobeat-web-assembly-ruoi (claimed in assembly ledger).
Goal: goal-8d6f4121-8b41-47b3-b2b4-14f6be0e557c; round cap Maximum safe integer.
Release coordination: ../aerobeat-web-assembly/.plans/2026-10-28-r150-spline-reprojection.md.
Target corrective release: 0.0.151 after source fix and verification. No new build before fixing this bug.

## Scope confirmed after reproduction

Derrick explicitly chose the cache-only corrective release after the independent custom-wall rejection was found. Deferred discussion/support is **aerobeat-web-assembly-igiw**. Do not implement Noodle/custom-wall compatibility or silently omit walls in this slice. Do not claim GAS GAS GAS fully imports. Browser acceptance uses a valid map with an equivalently large, whitespace-padded difficulty to isolate the fixed byte boundary and exercise cached reimport; the exact GAS GAS GAS archive must pass cache preparation and still report the independent unsupported-wall error.

## Decision and next acceptance check

Raise only the default per-cache-entry byte bound from 2 MiB to 8 MiB. The real map's required Expert difficulty is 3,874,764 bytes (~3.70 MiB), so it fits with headroom. Keep the existing 64 MiB difficulty, 128 MiB audio, 192 MiB selected-source and vendor archive bounds unchanged. Verify the real source prepares with caching enabled, then import and cached reimport it through the affected browser flow.

## Diagnostic report (before product changes)

### Exact observed failure

Derrick reports `cache entry exceeds the byte limit` when importing `[[Wall Show + Chroma]] GAS GAS GAS | Manuel`. The same error is reproduced with the production vendor inspector and `prepareAllStandardSourceMaterials(source,{cacheSourceEntries:true})`: code `source_entry_too_large`. With caching disabled, the same source prepares successfully.

### Expected behavior

This legitimate map should import and keep the exact source difficulty bytes for reimport, while oversized sources remain finitely bounded.

### Execution path

BeatSaver map b514 -> archive hash 95e11f39b2898a38e3b5e61d2156ef5f5835f40f -> inspectBeatSaverArchive -> assembly conversion with cacheSourceEntries true -> authoring prepareSourceMaterialSet -> required selected difficulty copied into sourceCache -> src/source-material.js line 156 rejects bytes above limits.cacheEntryBytes.

### Root cause and evidence

The default cache entry bound is 2,097,152 bytes even though the difficulty admission bound is 67,108,864 bytes. ExpertStandard.dat is 3,874,764 bytes. It passes difficulty admission but fails the later mandatory cache check. Archive is 3,092,989 bytes; other entries: info.dat 1,187 bytes, cover.jpg 14,378, song.egg 2,329,262. Audio is stored separately and is not this rejection.

### Alternatives and earlier fixes

Archive download/expansion or worker conversion is not the source of this error: the inspector succeeds and the rejection occurs during preparation before worker conversion. No cache-limit fix has been attempted for this map. Earlier obstacle-cap and spline fixes address different limits/paths and are not changed here.

### Minimal reproduction and proposed verification

Download b514's archive; inspect it; prepare with cacheSourceEntries true to reproduce. Same preparation with caching false succeeds. With the fix, default preparation must retain the full Expert bytes. Add generated size-boundary tests for the real entry size, exact 8 MiB acceptance, 8 MiB + 1 rejection and an explicit smaller override. Then verify real browser import and cached reimport, normal unit gates, and the signed corrective build before public cutover.

### Unknowns

The cache fix and generated boundaries pass. Full production conversion now reaches a second, independent rejection: `obstacle_type_unsupported` / `v2 obstacle type must be 0 or 1` at src/beatmap.js:142. Exact map metadata declares Noodle Extensions required, Chroma suggested. It contains 403 notes, 1,462 lighting events and 13,898 custom obstacles; the first has _type 5007, _lineIndex 3788, _width 1005 and custom _position/_scale. These are custom wall-show encodings, not standard v2 type 0/1 walls. No custom-wall compatibility or omission was implemented. User decision is needed before expanding beyond the approved cache-limit fix or publishing a release that still cannot fully import this specific map. Browser import/reimport acceptance is not claimed.

### Debugging record

Problem: valid wall-show map cannot import with source caching.
Observed symptom: source_entry_too_large / cache entry exceeds the byte limit.
Root cause: 3,874,764-byte required difficulty exceeds 2 MiB cache entry default.
Evidence: exact archive sizes and production prepare repro; no-cache control passes.
Failed approaches: none for this report.
Corrective action: raise finite cache entry default to 8 MiB; keep unrelated bounds.
Verification test: normal source-material batch regression plus real-map browser import/reimport.
Related files/components: src/source-material.js; scripts/validate-source-material-batch.js; assembly importer.
Remaining uncertainty: complete conversion and physical storage environment until browser check.

## Tasks

1. Complete: read README/status, claim bead, locate exact map and reproduce cache failure.
2. Complete: default cache entry bound raised to 8 MiB; real reported size, exact bound, bound+1, smaller override and independent difficulty-bound regressions pass. README documents the separate custom-wall limitation.
3. Source checks complete: npm run check, npm run test:unit and npm run test:security pass. This also repaired pre-existing displaced SourceBundle guard JSDoc, unknown-error narrowing in the local reimport test, and an invalid new-arrow factory in the security test. No production behavior beyond the byte default changed. Normal npm test:real remains outside this slice because its absent local archive fixtures were a known existing gap. Browser acceptance follows the user-approved valid large-entry fixture approach described above and is recorded by assembly.
4. Handed to assembly: commit/push, repin this dependency, build verified signed 0.0.151 and publish with 0.0.150 rollback. No custom-wall compatibility changes permitted in this slice.
5. Source README/plan complete. Assembly owns final docs, bead closure and pushed-state verification; protect unrelated ledger/screenshots.

No new UI or design work. Keep existing release and source/storage validation gates; no new proof/security/provenance layer is needed. This plan records the observed limit adjustment, not a broad cache redesign.
