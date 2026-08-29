# Browser Content Authoring Boundary

**Status:** Accepted and implemented

`@aerobeat/web-content-authoring` consumes provider-neutral inspected source material and produces validated AeroBeat packages. Its only source capability is `{manifest, listEntryPaths(), readEntry(path)}`. It does not call BeatSaver, parse provider DTOs, render product UI, play audio, score gameplay, or select runtime content.

Conversion runs behind a versioned, exact, bounded, job-bound, structured-clone-safe, abortable Worker protocol without a `SharedArrayBuffer` requirement. Only a private copy of the selected difficulty bytes and narrowed plain manifest/options cross into the Worker. ZIP closures and raw media do not enter public snapshots or iframe messages; request metadata is narrowed before the first observable snapshot.

The implementation normalizes compatible v2/v3/v4 Standard maps, preserves Flow source-grid semantics, and generates the four frozen Boxing prototype variants. Recipe/ruleset selection remains explicit metadata. Semantic and Spatial rulesets intentionally share generated beats at this prototype stage; Task 4C does not choose or promote a production winner.

Persistence and export occur only after validation. A new job, cancellation, or service destruction invalidates older generations; stale completions cannot update snapshots or remain durably persisted. IndexedDB schema/migration, memory fallback, optional source cache, quota estimates, deterministic export, hashes, recipes, rulesets, and provenance are explicit and testable.

`aerobeat-content-core` remains the canonical authored-content authority. Final content-core `476da22` and Godot authoring `59c93de` are the audited parity references, not browser dependencies. JavaScript number values cannot preserve Godot Variant integer/float identity, so browser canonical JSON hashes are deterministic but are not claimed as Godot hashes. Cross-language tests lock semantic outputs (event identity/order/lineage/targets/checkpoints) and publish a distinct deterministic semantic parity hash.
