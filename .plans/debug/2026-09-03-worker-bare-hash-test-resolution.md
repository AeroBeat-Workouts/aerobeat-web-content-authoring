# Worker bare hash test resolution

## Exact Observed Failure

`npm run test:browser` failed in `scripts/validate-browser-authoring.js` while awaiting the pre-conversion module Worker probe:

```text
page.evaluate: Error
    at instance.onerror (... <anonymous>:10:70)
    at run (.../scripts/validate-browser-authoring.js:58:37)
```

The Worker emitted an error before posting its context/hash result. Window imports and static checks had already passed.

## Expected Behavior

The package-level browser harness must execute the shared hash dependency in a real module Worker, assert secure-context/WebCrypto shape, and then run the real conversion Worker and persistence flow on localhost and genuine non-loopback HTTP.

## Execution Path

`validate-browser-authoring.js` serves unbundled source → page creates `/hash-context-worker.js` as a module Worker → probe uses bare import `@aerobeat/web-hash` → browser Worker module resolution runs without the document import map → probe fails before `onmessage` installs/posts. The real unbundled conversion Worker would follow `conversion-worker.js` → `worker-protocol.js`/converter modules → `canonical.js` → the same bare dependency import.

## Most Likely Root Cause

Confirmed test-harness resolution gap: document import maps do not apply to Worker module graphs. Production package source correctly uses its declared bare runtime dependency and consuming bundlers resolve it, but this package's source-level HTTP harness does not bundle or rewrite dependencies for Workers.

Evidence: the only new production bare import is `src/canonical.js:3`; the probe itself also uses the same bare import; failure occurs at Worker startup before any hash/conversion callback; main-window static imports pass through the document import map.

## Alternative Hypotheses

1. Shared hash is not Worker-safe — unlikely; its own genuine module-Worker secure/insecure suite passes.
2. Worker lacks SHA-256 fallback — contradicted because the Worker never reaches `onmessage`.
3. HTTP insecure-context restriction prevents Workers — contradicted by the shared package's non-loopback Worker suite and by failure occurring first on localhost.

## Why Previous Fixes Failed

No prior repair was attempted. Adding a document import map solved Window resolution only; assuming it also covered Worker graphs was incorrect.

## Unknowns

The terse Playwright Worker error does not expose Chromium's full module-resolution text. A focused server rewrite and successful Worker startup will distinguish resolution from unrelated runtime failures.

## Minimal Reproduction

Serve an HTML document with an import map for `@aerobeat/web-hash`, then create a module Worker whose source uses that bare specifier. The Window can import it; the Worker fails startup. An absolute `/node_modules/@aerobeat/web-hash/src/index.js` Worker import should pass.

## Proposed Verification

Use an absolute served URL in the dedicated probe and make the source-level test server rewrite only `src/canonical.js`'s declared bare import to that exact local dependency URL. Then require both probe and real conversion Worker to complete on secure localhost and non-loopback insecure HTTP, with identical package/audio identities.

## Recommended Fix

Keep production source and package dependency unchanged. Repair only the unbundled package test server's module resolution: serve `canonical.js` with an exact import-specifier rewrite to the local installed dependency, and use the same absolute URL in the probe. This models the dependency resolution a consuming bundler provides without creating a production relative `node_modules` path.

Potential regressions: an overbroad rewrite could mask undeclared imports. Restrict it to the one exact declared import and retain static public-import/package checks.

## Debugging Record

```text
Problem: Unbundled package browser harness cannot resolve shared hash in module Workers.
Observed symptom: Worker onerror rejects page.evaluate before context/hash result.
Root cause: Document import maps do not apply to Worker module graphs; Worker sees bare @aerobeat/web-hash.
Evidence: Window import passes, Worker startup fails, canonical.js and probe are the only bare hash imports, shared package Worker suite passes.
Failed approaches: Document import map alone; it covers Window modules only.
Corrective action: Test-only exact source rewrite/absolute probe URL to served installed dependency.
Verification test: Secure localhost and genuine non-loopback HTTP probe + real conversion Worker/persistence return identical hashes.
Related files/components: scripts/validate-browser-authoring.js, src/canonical.js, src/worker-protocol.js.
Remaining uncertainty: None for the package harness; focused resolution passed both origins.
```

## Result

The test-only exact rewrite and absolute probe import were applied. `npm run check && npm run test:browser` passed on secure localhost and genuine non-loopback `100.113.165.57` HTTP. Both Window and module Worker preconditions were asserted before authoring; real conversion Worker + IndexedDB persistence/export completed with exact package hash `sha256:6ff9dee557a063692872b14ec5785d23156556a67ae827106f2fbdbe7d72ab85` on both origins.
