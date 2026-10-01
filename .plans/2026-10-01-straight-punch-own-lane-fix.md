# Straight punches own lane — approved fix, exact mechanism

Derrick approved this on 2026-10-01 ("straight punch solution makes sense, agreed").
Not yet implemented.

## What was actually wrong with my first explanation

I first blamed the lane change. That was wrong, and Derrick corrected it.
Evidence (content-authoring `src/converter.js`, `spatialTarget`):

```
before 0.0.83:  let targetRow = clamp(row,0,2);
after  0.0.83:  let targetRow = family === "straight" ? 0 : clamp(row,0,2);
```

Before commit `ab6013a` ("Place straight punches high and guards low"), straights
kept their AUTHORED row, so a straight and an uppercut in the same lane sat in
different rows and never competed for a cell. Derrick's memory was correct.

The row-0 forcing — his own 0.0.83 request, so straights cannot be "bonked" from
guard — is what makes them compete with same-hand uppercuts once both use the
own lane. The lane change alone is not the cause.

## Why a straight is currently dropped

In `src/converter.js` (~line 218-221):

```js
const spatial = spatialTarget(family, hand, Number(candidate.targetRow), {...});
const safe = spatial.acceptedSubcells.filter((subcell) => !blocked.has(subcell));
if (!safe.length) { trace.push(dropTrace(candidate, "spatial_target_blocked")); continue; }
```

`acceptedSubcells(cell, family, hand)` only ever emits subcells for **the two
sub-rows of the target row** (plus, for straights, a neighbouring COLUMN in
those same rows). It never spans another row. So when a same-hand uppercut has
already taken row 0 / the hand's own column, an own-lane straight's entire
accepted set is blocked and the note is DROPPED rather than relocated.

Measured on the frozen golden: with `anyOppositeLane:false` the chart loses
`straight_left`. With the crossing still on, the same note survives because it
lands in the free column — which is why crossing appears to "work".

## The fix (needs careful ordering, do not rush)

Uppercuts already resolve to row 0 **or** 1 (`targetRow = Math.min(targetRow, 1)`)
and only collide when their source row is 0. Preferred approach:

1. Let an uppercut's accepted subcells ALSO include the paired row (0 <-> 1) for
   the same column, so it can relocate vertically instead of being dropped.
2. Order that fallback so row 1 is preferred and row 0 is the fallback, matching
   "straights stay high on row 0, uppercuts get out of the way".
3. Straights must remain pinned to row 0 — that anti-bonk requirement is the
   reason for the change and must not regress.

Ordering matters: candidates are processed in emission order, so whichever note is
placed first blocks the other. Protect the straight: ensure a same-hand uppercut
cannot claim the straight's row-0 cell before the straight is placed.

Do NOT simply restore crossing — that is the behaviour Derrick explicitly removed.

## Acceptance

`scripts/validate-opposite-lane-defaults.js` currently ASSERTS the crossed
straight-punch default as correct (`straight_right % 4 === 1`, the opposite lane
for a right hand). That expectation is itself wrong and must be corrected to the
own-lane default, with a case proving straights and uppercuts of the same hand
coexist (no drop) on a chart where they compete. Wire into `npm test` and prove
the test fails against the pre-fix code.