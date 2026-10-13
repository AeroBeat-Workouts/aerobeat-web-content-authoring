# Flow center hand swaps

Status: owner implementation verified and ready for parent integration; assembly Bead `aerobeat-web-assembly-26m3` remains in progress for parent closure. Parent assembly plan: `../aerobeat-web-assembly/.plans/2026-10-13-flow-center-swaps-three-tier-feedback.md`.

## Decision and next check

Only exactly simultaneous Flow left notes at cell 2 or 10 paired with right notes at cell 1 or 9 exchange hands; keep note cells, directions, any status and source/trace references. Retain the existing exterior-corner swaps and all correctly assigned or offset notes. Next acceptance: run the ordinary `validate-flow-x-corner.js` unit script against unchanged production to observe a bug-specific RED, then update only converter behavior and restore GREEN.

## Tasks and boundaries

1. Add positive/negative center, corner, chord, duplicate, direction/any and trace assertions to the normal unit script; add a real-browser conversion check in the existing browser script. Do not change fixtures or package gates.
2. Change only the owner Flow converter and verify deterministic chart, trace and package identities using the normal conversion pipeline.
3. Run `npm run check`, `npm run test:unit`, `npm run test:browser` and `npm test` when practical; record missing local vendor ZIPs without changing the gate.
4. Update owner README and this plan, review the diff, commit and push only owner sources/tests/docs on `main`; parent handles assembly source pins, previews, QA, audit and Bead closure.

## Initial diagnosis

Current Flow conversion calls `swapCrossedFlowNotes` before sorting and before hashing. The function groups note beats by exact numeric start and pairs exterior left-column-3/right-column-0 notes in source order; it copies hand swaps into the emitted trace beat. It has no center-cross candidates. Therefore a simultaneous L2/R1 or L10/R9 pair is emitted with crossed hands, while direction, timing and any status remain separate note data. A center-pair assertion against the existing function distinguishes this missing candidate rule from hashing or orientation errors. No earlier fix attempt exists; no known failing existing gate was treated as evidence of this bug. Direct conversion and browser Worker paths should both traverse this shared converter. Preserve exact-start and stable pairing, and avoid reprocessing already corrected pairs. No UI visual state is implemented in this owner; assembly owns Play visual assertions.

## Results

- Fix-only RED: with assertions added and converter unchanged, `node scripts/validate-flow-x-corner.js` failed at `center pair L2/R1`: actual `[['left',2],['right',1]]`, expected swapped `[['right',2],['left',1]]`. After changing only converter behavior, the unchanged center-pair assertion passed. Chart sorting orders the corrected note at cell 1 before cell 2; tests account for final canonical order while source-order trace retains original lineage. Restored GREEN on focused unit, `npm run check`, and `npm run test:browser` (secure localhost and non-loopback HTTP paths).
- Full `npm run test:unit` and `npm test` stop at `scripts/validate-collection-reimport-source.js` with `missing-local-fixture: /tmp/aerobeat-54510-f5c04797fe0831741adec66ce5386971153919d4.zip`; all preceding unit checks, including this regression, passed. `npm run test:security` passed. Separate `npm run test:real` converted local 4858 but stopped at `missing-local-fixture: 3D44B` (`AEROBEAT_BEATSAVER_3D44B_ZIP`). No fixture, gate or ZIP was changed.
- Browser assertion inventory: two cross-row center states and exact-offset negative have assertions in existing `npm run test:browser`; four Cartesian pairs, exterior corners, same-side, duplicate/chord, arrows/any, trace and hash identity run in normal `npm run test:unit` before the unrelated missing-archive stop. This is a conversion-only change; visual Play grading, image assertions and private build remain parent-owned.
- Owner README updated; only converter, two existing test scripts, this plan and README are intended. Parent closes assembly Bead after independent QA/integration.
