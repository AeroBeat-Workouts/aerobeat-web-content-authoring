# Fixtures

This folder holds deterministic, provider-neutral browser content-authoring fixtures.

`boxing-prototype-golden-v1.json` locks sanitized cross-language semantic parity. `task11-source-matrix-v1.json` is wholly synthetic Beat Saber v2/v3/v4 Standard Hard input covering Flow, the four frozen Boxing variants, both hands and punch families, paired/crossed guards, bomb, obstacle, arc, v3/v4 burst, and every supported requested modifier. Its `fixtureHash` is `prefixedSha256(canonicalJson(fixture without fixtureHash))` and therefore excludes only its own hash field.

`flow-orientation-3c9d-easy-v1.json` contains only sanitized scalar evidence from BeatSaver `3C9D`, version `5662f64a12c76a3dd11a5f6ee22611608cd06760`, Standard Easy. It records the first twelve note coordinates and canonical top-left AeroBeat cells, including beat `21` source `(x=3,y=0)` → cell `11`.

`flow-obstacle-3c9d-hard-v1.dat` pins the exact offline raw Standard Hard difficulty bytes for provider version `5662f64a12c76a3dd11a5f6ee22611608cd06760`; its independent JSON oracle hard-codes byte/hash, BPM, source beat interval, millisecond interval, continuous geometry, bounded mask, and renderer dimensions. No ZIP, cover, audio, or provider response is committed. Real `4858` and `3D44B` archives remain local `.testbed` inputs selected by documented environment overrides or fallback paths.
