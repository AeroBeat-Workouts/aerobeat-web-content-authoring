# T8: X-corner handiness swap

Status: complete
Bead: aerobeat-web-content-authoring-rkh
Scope: content-authoring only; no push or version bump.

## Goal
At Flow authoring time, correct simultaneous crossed exterior notes by flipping only their hands. Preserve placements, starts, directions, source evidence, and unrelated notes.

## Tasks
1. Inspect Flow emission and timing/trace contracts. Complete: `buildFlowIntervalOracle` emits notes before chart hash/persistence; Flow notes use `placement`, `hand`, `start`.
2. Add deterministic idempotent X-pair hand swap after emission and before chart/trace snapshot. Complete: chart and emitted trace note hands match; source evidence remains unchanged.
3. Add focused three-row, non-X, extra-note, and timing regression test. Complete: includes duplicate exterior and direct-detector cases.
4. Run syntax and `npm test`, inspect diff, close Bead, commit only scoped changes. Complete: JS syntax, JSON parse, focused cases, strict types, and full `npm test` pass.

## Decisions
Use exact numeric `start` equality for simultaneous Flow beats; there is no Flow note `timingWindowMs` field, and nearby distinct beats must not be conflated. Exterior columns are canonical left `{0,4,8}` and right `{3,7,11}`. A corrected pair no longer matches the detector on subsequent passes. If a same-cell collision is observed, fail explicitly.

## Results
`node --check` passed for both changed JavaScript files; package.json parsed as JSON (`node --check` does not accept JSON). Focused X-corner test and full `npm test` passed. No changes to Boxing, geometry, timings, note type, or source note metadata. Risk: Flow chart/trace/package hashes change when crossed source pairs occur (required authored-content change); arc/burst hand identity remains source-authored and is not transformed by this note-only rule. No push by request.
