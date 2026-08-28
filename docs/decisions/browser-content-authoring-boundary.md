# Browser Content Authoring Boundary

**Status:** Accepted scaffold boundary

`@aerobeat/web-content-authoring` consumes provider-neutral inspected source material and produces validated canonical AeroBeat packages. It does not call BeatSaver, parse provider DTOs, render product UI, play audio, score gameplay, or select runtime content.

The implementation will isolate deterministic conversion behind a structured-clone-safe Worker protocol. Persistence and export occur only after canonical validation succeeds. Cancellation must not leave partial durable packages. IndexedDB schemas, migrations, quota behavior, source-cache retention, artifact hashes, recipes, rulesets, and provenance are explicit public diagnostics rather than hidden implementation state.

`aerobeat-content-core` remains the canonical authored-content authority. The Godot authoring implementation is a parity reference, not a browser runtime dependency. Cross-language golden fixtures will compare semantic outputs without importing sibling internals.
