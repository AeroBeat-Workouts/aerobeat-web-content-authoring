# Malformed obstacle-container diagnosis

## Exact Observed Failure

Direct reproduction at clean pushed baseline `5da1ed92d39f6bf51e8bb0a7f53c0d818c9dab50` passed object-valued present obstacle containers to `parseBeatMapDifficulty`. Exact output was:

```text
v2 0
v3 0
v4 0
```

No exception was thrown. Each malformed source became a normalized summary with zero obstacles.

## Expected Behavior

A present non-array v2 `_obstacles`, v3 `obstacles`, or v4 `obstacles` container must fail closed with a stable bounded error code before conversion and persistence. A genuinely absent optional obstacle array must continue to normalize to an empty array where that format permits absence. Existing strict obstacle entry, index, range, duration, conflict, type, and rotation failures and valid v2/v3/v4 geometry must remain unchanged.

## Execution Path

1. The service prepares source bytes and sends them to the inline or module Worker.
2. `src/worker-protocol.js` calls `parseBeatMapDifficulty(bytes, format)` before conversion.
3. `src/beatmap.js` dispatches to `normalizeV2`, `normalizeV3`, or `normalizeV4`.
4. Each normalizer routes its obstacle container through `array(value)`.
5. `array(value)` returns `[]` for every non-array value.
6. Conversion therefore emits an obstacle-free playable package, and the service can validate and persist it.

## Most Likely Root Cause

`array()` intentionally provides permissive handling for several legacy optional note/arc families, but obstacle safety geometry now requires strict normalization. Reusing that permissive helper at the three obstacle-container call sites erases the distinction between an absent optional container and a present malformed container.

Evidence: `src/beatmap.js` uses `array(map._obstacles ?? map.obstacles)`, `array(map.obstacles)`, and `array(map.obstacles)` at the v2/v3/v4 obstacle paths, while `array()` is exactly `Array.isArray(value) ? value : []`.

## Alternative Hypotheses

1. **JSON parsing loses the malformed value.** Contradicted: object-valued fields survive `JSON.parse`; the failure occurs afterward.
2. **Worker/service error translation suppresses a parser error.** Contradicted: direct parser calls reproduce the zero-obstacle result before worker/service handling.
3. **Obstacle entry normalization is permissive.** Contradicted for this bug: strict entry validation is never reached because the object container maps to an empty array.

## Why Previous Fixes Failed

The source-faithful obstacle implementation added strict validation for each obstacle record, v4 metadata index, geometry bounds, duration, conflict, type, and rotation. Its malformed matrix tests only array-contained entries. No previous fix asserted the container shape before mapping, so object-valued containers bypassed all new entry validators.

## Unknowns

No root-cause unknown remains. Regression scope still needs verification through direct parsing, memory service persistence, real module Worker + IndexedDB browser service, and the complete project gates.

## Minimal Reproduction

```js
parseBeatMapDifficulty(JSON.stringify({ _obstacles: {} }), "v2").obstacles.length;
parseBeatMapDifficulty(JSON.stringify({ obstacles: {} }), "v3").obstacles.length;
parseBeatMapDifficulty(JSON.stringify({ obstacles: {}, obstaclesData: [] }), "v4").obstacles.length;
```

All three return `0` at the baseline. Omitting the corresponding optional obstacle field also returns `0` and is valid.

## Proposed Verification

Add a direct matrix asserting the exact bounded code for present non-array containers and zero obstacles for absent containers. Drive equivalent malformed v2/v3/v4 source bundles through memory and browser IndexedDB services, asserting rejection plus zero package/collection records. Retain exact real `3c9d` oracle and valid synthetic v2/v3/v4 geometry assertions, then run all authoring gates.

## Recommended Fix

Introduce an obstacle-specific optional-array helper that returns `[]` only when the format field is absent and throws `AuthoringParseError("obstacle_container_invalid", ...)` when it is present but not an array. Use it only at v2/v3/v4 obstacle-container call sites so other parser compatibility behavior and all strict entry validation remain unchanged. Preserve the v2 legacy fallback field only when `_obstacles` is absent; a present malformed `_obstacles` must never fall through.

## Debugging Record

```text
Problem: Present malformed obstacle containers author obstacle-free playable content.
Observed symptom: Direct v2/v3/v4 parser calls each returned obstacle count 0.
Root cause: Obstacle call sites reuse permissive array(), which maps every non-array to [].
Evidence: Exact baseline reproduction and the three normalize call sites in src/beatmap.js.
Failed approaches: Strict entry/index/geometry validation did not cover container shape.
Corrective action: Add obstacle-specific absent-versus-malformed array narrowing with one bounded code.
Verification test: Direct plus memory service plus browser Worker/IndexedDB rejection and zero-commit matrices; retain valid 3c9d/v2/v3/v4 gates.
Related files/components: src/beatmap.js, scripts/validate-flow-obstacles.js, scripts/validate-authoring-service.js, .testbed/demo/main.js, scripts/validate-browser-authoring.js.
Remaining uncertainty: None in root cause; full-gate results pending.
```
