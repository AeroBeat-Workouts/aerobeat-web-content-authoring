# aerobeat-web-content-authoring

Provider-neutral browser content conversion, local authoring persistence, and package export foundations for AeroBeat Web.

## Responsibility

This package owns the browser boundary that will coordinate conversion of already-inspected, normalized source material into canonical AeroBeat song packages. Future implementation belongs behind an abortable Worker protocol and will own deterministic recipe execution, progress and cancellation, package validation handoff, conversion provenance, local IndexedDB persistence, and browser package export.

This scaffold establishes only the package and contract foundation. It does not yet convert content, start Workers, open IndexedDB, or export archives.

## Ownership Boundaries

- `aerobeat-content-core` remains the canonical owner of durable AeroBeat song-package and chart semantics.
- `aerobeat-tool-content-authoring` remains the Godot/offline authoring implementation and parity reference.
- `aerobeat-web-vendor-beatsaver` will acquire and inspect BeatSaver or local ZIP sources and emit normalized source-material manifests/entries.
- This package consumes provider-neutral normalized source material. It must not call BeatSaver APIs, depend on provider DTOs, choose product playlists, or own archive acquisition policy.
- `aerobeat-web-content` will load validated generated packages for runtime use. It does not perform conversion.
- `aerobeat-web-gameplay` owns playback-session interpretation and scoring.
- `aerobeat-web-ui` owns visible authoring/progress/storage/export controls.
- `aerobeat-web-assembly` composes services and product policy.

## Future Worker Boundary

Conversion must run outside the UI thread through a versioned, structured-clone-safe protocol. Requests will identify normalized source material, immutable recipe/ruleset versions, and requested outputs. Responses will expose progress, diagnostics, deterministic artifact metadata, and terminal success/cancellation/failure without leaking provider-native objects.

Workers must not access the DOM, product UI, camera, audio playback, or runtime gameplay services. Cancellation must not leave partially persisted packages.

## Future Persistence and Export Boundary

IndexedDB will store validated generated packages, migrations, optional source-cache entries, and quota diagnostics. Browser export will produce deterministic package artifacts only after canonical validation succeeds. Storage policy, schema versions, migration behavior, source-cache retention, hashes, and provenance must remain explicit and testable.

No IndexedDB database, Worker, converter, or export implementation exists in this scaffold.

## Public API Surface

`src/index.js` currently exports only:

- the package marker;
- the service ID and contract version;
- a truthful frozen scaffold descriptor showing which future capabilities are not implemented.

Task 4C will replace the scaffold-only capability state with the real service while preserving the public ownership boundary.

## Development Shape

```text
/
  src/
  scripts/
  fixtures/
  assets/
  docs/decisions/
  .testbed/
```

Fixtures are deterministic contract inputs, not playable song packages or copied provider archives. `.testbed/node_modules` and installed/generated artifacts are local state and must not be committed.

## Validation

Run before handoff:

```bash
npm run check
npm test
npm run test:browser
```

The scaffold checks strict JSDoc/no-escape posture, public import boundaries, component-only scene posture, Playwright console-noise policy, the package export descriptor, and deterministic placeholder fixture/browser surfaces.

## Documentation Handoff

Keep implementation decisions in `docs/decisions/`. Public contributor or product documentation belongs in `aerobeat-web-docs` after the browser authoring contract is accepted.
