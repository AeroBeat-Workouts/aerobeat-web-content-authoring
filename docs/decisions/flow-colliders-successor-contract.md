# Flow Colliders successor-package contract

## Decision

New imports produce only `aerobeat.song-package.v6` / `6.0.0`. Its sole Flow chart is `aerobeat.chart.flow.v5` and authors one `beats` array with this exact identity:

```json
{
  "rulesetId": "flow_grid_v2",
  "rulesetVariants": ["flow_grid_v2", "flow_colliders_v1"]
}
```

`rulesetId` preserves Flow Grid as the stable default and historical fallback. `rulesetVariants` is a closed, ordered pair. It does not contain derived gameplay settings or collision geometry. A consumer selects scoring semantics by an explicitly present identity; it must not infer Colliders support from package age, chart mode, beats, bombs, walls, presentation, or runtime capability.

## Identity

Flow `contentHash` is SHA-256 over canonical JSON of exactly:

```js
{ beats, rulesetId, rulesetVariants, notePalette }
```

The same pair and Flow content hash are copied into the Flow conversion trace. Package SHA-256, Worker result integrity, `AEROPKG1` metadata, persistence handles, and semantic parity thereby bind the successor identity. Notes, bombs, walls, arcs/bursts, palette, timing, source hashes, lineage, normalized obstacles, sets, and Boxing charts remain authored exactly once and retain their existing meanings.

## Migration and fail-closed behavior

- Package v1–v4 handling is unchanged and retains its existing earlier reimport errors.
- Valid v5 packages remain historical Flow Grid packages for consumers that explicitly support that generation.
- DB8 preserves v5 package bytes and package hashes. Management list/export/delete remains available.
- DB8 load and asset/play reads reject an otherwise loadable v5 row with `flow_colliders_reimport_required`.
- Reimport from source creates v6 bytes. No migration appends `rulesetVariants`, rewrites a chart/hash, or promotes stored v5 bytes.
- V6 validation requires the exact ordered pair in both chart and trace. Missing, partial, reordered, duplicated, unknown, or accessor-backed identities fail closed even if an attacker recomputes content/package/parity hashes.
- Historical consumers reject v6 as an unsupported package schema. New consumers must reject v5 for Flow Colliders and may route it only through an explicit historical Flow Grid path.

## Privacy

The package declares only bounded ruleset identities. It contains no landmark samples, collider centers/radii, trajectories, segment endpoints, distances, velocities, confidence, calibration/frame/source IDs, or contact episodes. Collision profiles and measured evidence remain runtime-private and do not participate in authored package bytes.
