# Flow Colliders successor-package contract

**Amendment (2026-09-10):** Round-4 flow successor (`aerobeat-web-assembly-8tz4`) deleted the Flow Grid ruleset: new imports bind the sole `flow_colliders_v1` variant under the same exact ID, and pre-rename two-variant v6 packages become reimport-required for playback.

## Decision

New imports produce only `aerobeat.song-package.v6` / `6.0.0`. Its sole Flow chart is `aerobeat.chart.flow.v5` and authors one `beats` array with this exact identity:

```json
{
  "rulesetId": "flow_colliders_v1",
  "rulesetVariants": ["flow_colliders_v1"]
}
```

`rulesetId` is the sole Flow ruleset (the canonical ID of the visible `Flow` mode). `rulesetVariants` is a closed single-element list. It does not contain derived gameplay settings or collision geometry. A consumer selects scoring semantics by an explicitly present identity; it must not infer ruleset support from package age, chart mode, beats, bombs, walls, presentation, or runtime capability. Historical bytes carrying the retired `flow_grid_v2` bind remain readable for historical reads only and require reimport before playback.

## Identity

Flow `contentHash` is SHA-256 over canonical JSON of exactly:

```js
{ beats, rulesetId, rulesetVariants, notePalette }
```

The same pair and Flow content hash are copied into the Flow conversion trace. Package SHA-256, Worker result integrity, `AEROPKG1` metadata, persistence handles, and semantic parity thereby bind the successor identity. Notes, bombs, walls, arcs/bursts, palette, timing, source hashes, lineage, normalized obstacles, sets, and Boxing charts remain authored exactly once and retain their existing meanings.

## Migration and fail-closed behavior

- Package v1–v4 handling is unchanged and retains its existing earlier reimport errors.
- Valid v5 packages remain historical predecessors for consumers that explicitly support that generation.
- DB8 preserves v5 and legacy two-variant v6 package bytes and package hashes. Management list/export/delete remains available for both.
- DB8 load and asset/play reads reject an otherwise loadable v5 row with `flow_colliders_reimport_required`.
- Legacy two-variant (pre-rename) v6 rows are rejected on load with exact `flow_grid_reimport_required`; reimport regenerates them with the single colliders variant.
- Reimport from source creates current v6 bytes. No migration appends or removes `rulesetVariants`, rewrites a chart/hash, or promotes stored v5 or legacy v6 bytes.
- V6 validation requires the exact single variant in both chart and trace and accepts the historical two-variant bind for readability only. Missing, partial, reordered, duplicated, unknown, or accessor-backed identities fail closed even if an attacker recomputes content/package/parity hashes.
- Historical consumers reject v6 as an unsupported package schema. New consumers must reject v5 and may route it only through an explicit historical path.

## Privacy

The package declares only bounded ruleset identities. It contains no landmark samples, collider centers/radii, trajectories, segment endpoints, distances, velocities, confidence, calibration/frame/source IDs, or contact episodes. Collision profiles and measured evidence remain runtime-private and do not participate in authored package bytes.
