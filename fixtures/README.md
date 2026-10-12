# Fixtures

This folder holds deterministic, provider-neutral browser content-authoring fixtures.

`boxing-prototype-golden-v1.json` locks historical sanitized cross-language semantic parity; it is not a new same-side-guard golden. `task11-source-matrix-v1.json` preserves historical synthetic v2/v3/v4 source and the retired modifier set/hash unchanged. `task11-source-matrix-v2.json` is the independent next-version input with the retired modifier removed; its source notes still include a reversed-hand guard pair to test that newly authored targets never cross. Each `fixtureHash` is `prefixedSha256(canonicalJson(fixture without fixtureHash))`. Neither a new input hash nor a changed browser package/semantic hash may be labeled an updated Godot proof.

`flow-orientation-3c9d-easy-v1.json` contains only sanitized scalar evidence from BeatSaver `3C9D`, version `5662f64a12c76a3dd11a5f6ee22611608cd06760`, Standard Easy. It records the first twelve note coordinates and canonical top-left AeroBeat cells, including beat `21` source `(x=3,y=0)` → cell `11`.

`flow-obstacle-3c9d-hard-v1.dat` pins the exact offline raw Standard Hard difficulty bytes for provider version `5662f64a12c76a3dd11a5f6ee22611608cd06760`; its independent JSON oracle hard-codes byte/hash, BPM, source beat interval, millisecond interval, continuous geometry, bounded mask, and renderer dimensions. No ZIP, cover, audio, or provider response is committed. `spawn-timing-3c9d-standard-v1.json` records the exact selected-difficulty BPM/NJS/+1 offset oracle for all five Standard difficulties and locks HJD, reaction time, and diagnostic jump distance. Real `4858` and `3D44B` archives remain local `.testbed` inputs selected by documented environment overrides or fallback paths.
