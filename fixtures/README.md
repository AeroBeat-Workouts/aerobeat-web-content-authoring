# Fixtures

This folder holds deterministic, provider-neutral browser content-authoring fixtures.

`boxing-prototype-golden-v1.json` locks sanitized cross-language semantic parity. `task11-source-matrix-v1.json` is wholly synthetic Beat Saber v2/v3/v4 Standard Hard input covering Flow, the four frozen Boxing variants, both hands and punch families, paired/crossed guards, bomb, obstacle, arc, v3/v4 burst, and every supported requested modifier. Its `fixtureHash` is `prefixedSha256(canonicalJson(fixture without fixtureHash))` and therefore excludes only its own hash field.

Fixtures contain no provider response, ZIP archive, cover, audio, or community map bytes. Real `4858` and `3D44B` archives remain local `.testbed` inputs selected by documented environment overrides or fallback paths.
