# Boxing obstacle rules + removal of reachability (0.0.89)

Derrick specified the full model on 2026-10-01. This replaces subcell reachability
with four explicit, readable rules.

## Decisions (confirmed by Derrick)

- Reduced beat count is an ACCEPTED trade-off.
- Boxing has no authored intent to preserve: it adapts the BeatSaber/Flow API to
  boxing, so changing obstacle types is not overriding a mapper's choice.
- **Drop `reachable` entirely.** With notes unable to appear during an obstacle,
  the swing-path check is unnecessary. If playtesting shows athletes need time to
  return to position after a wall, a post-obstacle recovery window can be added
  later — deliberately NOT in this pass.
- **Only ONE obstacle at a time.** A squat + weave-left, or weave-left +
  weave-right, can never co-exist. The system resolves this.

## The four rules

1. **Obstacle windows block punches.** No punch may be authored while a weave or
   squat is active. (This replaces the invisible path-crossing check with
   something the player can see.)
2. **Clamp obstacle duration** to a configurable maximum, default **3 seconds**.
   Exposed in the Game Setup menu for playtesting; takes effect on **reimport**.
   Lock it in and hide the control once the value is chosen.
3. **4 second cooldown.** An obstacle may not start until 4s after the previous
   obstacle ENDS. Obstacles inside the cooldown are DROPPED, not shifted (shifting
   would desync from the music).
4. **Type cycling for variety.** If consecutive obstacles are the same type,
   advance to the next in the cycle weave-left -> weave-right -> squat.

## Pipeline order (agreed)

Order matters because rules interact. Apply in this sequence:

1. Clamp obstacle duration to the configured maximum.
2. Resolve simultaneous obstacles down to ONE (merge same-instant pairs).
3. Cycle types so consecutive same-type obstacles advance.
4. Enforce the 4s cooldown, dropping obstacles that start too soon.
5. Delete punches whose subcells fall inside a SURVIVING obstacle window — last,
   so it operates on the final obstacle set.

Step 2 before 3/4 is deliberate: cycling a type and then failing the cooldown is a
different obstacle set than applying the cooldown first.

## Implementation notes

- `reachable` lives at `aerobeat-web-content-authoring/src/converter.js` (~line 385).
  Remove the call in the punch loop along with the `unreachable_after_optimizer`
  drop path. Keep the SEPARATE target-vs-obstacle filter
  (`acceptedSubcells.filter(not blocked)`), which is what prevents a punch from
  being authored inside a wall.
- The existing `mergeSimultaneousLeanPairs` work (shipped in 0.0.88) is the seed of
  rule 2 — generalize it rather than adding a parallel path.
- The 3s clamp becomes a converter setting surfaced through the Game Setup drawer,
  threaded the same way `guardSpacing` is, and baked at import time.

## Acceptance

- `scripts/validate-simultaneous-lean-pairs.js` (existing) must still pass and
  should be generalized to cover all same-instant pairs, not just lean pairs.
- New focused test: a chart with two simultaneous obstacles yields exactly one.
- New focused test: obstacles are clamped to the configured maximum.
- New focused test: the cooldown drops a too-soon obstacle.
- New focused test: three same-type obstacles in a row cycle through all three types.
- New focused test: `reachable` is gone — a punch that could not be reached in
  time is STILL emitted.
- Re-measure note counts before/after on the real Backstreet Boys map (952e,
  already fetched to /tmp/ltl) and on a normal chart, and REPORT the loss rather
  than shipping it silently.
- Every test wired into `test:unit` and proven to fail without the change.