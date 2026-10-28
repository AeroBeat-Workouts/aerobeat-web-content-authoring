# Local ZIP reimport from cache, and honest worker crash reporting

Status: shipped in 0.0.149 (content-authoring `f4e8c7a`).

## Why

Two reports from Derrick in 0.0.148:

1. Reimport did nothing for songs imported from a ZIP file, because those songs recorded the
   `beatsaver` provider with a `local` source id and there is no BeatSaver map to download for them.
2. A "Numb" import failed with the text `Worker conversion failed`, which says nothing about what
   went wrong and whether it is worth retrying.

## Local ZIP reimport

- A local import now records `local` provenance with a stable `local:<archiveSha1>` source id.
- `getCollectionStoredSource(collectionId)` reads back the cached `Info.dat`, difficulty bytes and
  audio for a collection, or `null` when the import happened before source caching existed.
- A `local` provider may replace its own collection in place; replacement still requires an exact
  source id and version hash.
- A full Standard import also caches any remaining source-hash input that fits the cache entry bound
  (2 MB), which Beat Saber v4 needs to reproduce its map hash. A single-difficulty conversion keeps
  caching only its own difficulty.

## Worker crash reporting

`worker-protocol.js` now owns one set of helpers (`readFailureText`, `workerFailureCode`,
`workerFailureMessage`, `workerCrashMessage`) used by both the adapter and the worker thread:

- a worker crash reports the failure site instead of the constant `Worker conversion failed`;
- a `DOMException` keeps its own message, which lives on the prototype and used to be dropped;
- a hostile `message` getter cannot throw through the reporting path;
- a crashed worker is retried once with a fresh worker, and a second crash or an aborted run fails
  with the real reason.

## Verification

- `npm run test:unit`, including `scripts/validate-local-reimport-source.js` (provenance, byte-exact
  cache, in-place replacement, no false reimport claims) and the 0.0.149 crash/retry block in
  `scripts/validate-security-audit.js`.
- End to end in the shipped 0.0.149 bundle: a local ZIP song reimports from cache with no file
  prompt and no BeatSaver request, keeping its collection, id and difficulties.
