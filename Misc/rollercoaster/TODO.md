# Geometry refactor: honest track at a workable scale

Status: **Phases 1 and 2 done. Phases 3 to 6 not started.** The numbers below are
calculated but only cross-checked by hand — the sim is its own test rig, so
expect to verify rather than trust. Phase 1 needed three corrections that the
arithmetic had not predicted; they are recorded under it as a warning about how
much the rest will too.

## Why

Three of the four problems below are honesty problems that exist today, not
improvements. The catalogue lets a student build track that breaks the limits
the report judges them against, at speeds the same catalogue makes reachable.

At 20 m/s, which the default preset comfortably exceeds:

| piece | tightest radius | rider feels | limit |
| --- | --- | --- | --- |
| `flat-to-gentle-up` (valley) | 8.0 m | 6.1 g | 5.0 `vertHigh` |
| `flat-to-gentle-down` (crest) | 8.0 m | −4.10 g | −1.5 `airtimeHard` |
| `gentle-to-steep-*` | 5.6 m | −6.29 g | −1.5 `airtimeHard` |
| `turn-*-tight` | 6 m | 6.8 g lateral | 1.5 `latHigh` |
| `turn-*-wide` | 10 m | 4.1 g lateral | 1.5 `latHigh` |

The mildest transition in the catalogue breaks two limits. The widest corner
breaks the lateral limit by nearly 3x. Nothing available lets a student who
*wants* to comply actually do so.

Separately, acceleration is discontinuous at every piece joint, so jerk is
infinite there and a jerk plot is not possible. That is the least important of
the four and largely falls out of fixing the others.

## The invariant that must not break

Everything here depends on one contract:

> A piece's exit node is a whole number of tiles along, and a quarter turn's
> exit is `E + T*(u + v)` with `T` a half-integer number of tiles.

That is what makes circuits close and what the auto-close A* searches over. The
whole refactor is arranged so **radius becomes an output and `T` stays the grid
parameter**. If a change would make `T` non-half-integer, it is the wrong
change.

Consequences worth knowing before starting:

- `RC.exitNode` needs **no changes at all**, for any phase.
- `RC.pieceTiles` derives footprints by sampling the centreline, so collision
  and footprints recompute themselves.
- `TW`/`TH` in `iso.js` are pixels per tile, independent of `TILE_M`. **The park
  draws identically at any scale.** Only labels and physics change.
- The save format replays piece ids through current geometry by design. That
  means the rescale is save-safe and the transition work is not — see
  "Breakages".

---

## Phase 1 — `TILE_M` 4 -> 6 — **DONE**

One constant, the largest single gain, and it breaks nothing.

| | at 4 m | at 6 m |
| --- | --- | --- |
| `GENTLE` (2 levels/tile) | 26.6 deg | **18.4 deg** |
| `STEEP` (6 levels/tile) | 56.3 deg | **45.0 deg** |
| park | 160 m | 240 m |
| turn radii | 6 / 10 m | 9 / 15 m |
| `flat <-> gentle` radius | 8.0 m | **18.0 m** |
| `gentle <-> steep` radius | 5.6 m | 10.5 m |

Vertical curvature goes as `1/TILE_M^2`, so the tile ratio of 1.5 squares to
**2.25x on every transition radius, for free**. Both new grade angles are more
realistic than the old ones; 45 deg is a classic drop angle.

Grades stay at 2 and 6 levels per tile. `dH` is in levels and `L` is in tiles,
so **no piece changes its height or its footprint** — the node graph is
identical. Saved tracks load and close exactly as before; they are simply 50%
longer in metres and shallower in angle. Presets still close.

This alone takes the mildest transition from −4.10 g to −1.27 g, inside
`airtimeHard`. It does not fix `gentle <-> steep` (−2.88 g) or lateral.

### Three things the arithmetic did not predict

All three surfaced as test failures, not as reasoning. Expect the same of the
later phases.

**Friction scales with track length, and the presets live on that margin.**
Rolling resistance is a force times a distance, so a track 1.5x longer in metres
loses 1.5x more — and the shallower grades raise `cos(pitch)`, which takes a
little more again. `first-drop` had about 314 kJ of lift against roughly 320 kJ
of losses and died 2.5 m short of the station.

Fixed by scaling `mu` 0.02 -> **0.013**, now `RC.DEFAULT_MU`. Defensible because
`mu` is the only *undestimated* parameter in the loss model — `kDrag` comes from
`half*rho*Cd*A/m` and was left alone — and 0.013 is nearer real steel-on-steel
(0.005 to 0.01) than 0.02 was. **Anything that lengthens the track again will
need this looked at again**, which includes phase 3.

**The loop stopped being a teardrop.** Its shape reaches about 7.2 m forward on
its own and `loopDrift` smears whatever the footprint asks for beyond that
across the bottom. Four tiles of 6 m asked for 16.9 m instead of the 8.9 m it
was tuned for, stretching the bottom until the top was no longer the tightest
part of the curve. Fixed by `LOOP_LEN` 4 -> **3** (asks for 10.8 m). Phase 6
should still do the `LOOP_R` -> 10 m retune, which fixes it at the source.

That immediately exposed the `loopMaxRForFootprint` unit bug listed under phase
6: `2 * L` capped in-situ loops at 6 m, below the default 7. **Now fixed** —
both directions convert through `TILE_M`, which gives identical numbers at 4 m
tiles, so it was a true bug rather than a re-tune.

**The slope icons are scale drawings and had to be redrawn.** They were
hand-plotted SVG at 27 and 56 degrees. Now 1-in-3 and 1-in-1 with recomputed
arrowheads. `icons.js` says so at the top; anything that moves `TILE_M` again
must redo them.

### Tests: what needed changing and why

Nothing needed *weakening*. Five literals became derived quantities, which is
the pattern to follow in later phases:

- Release points given in metres now use `tiles(n)`, because a literal that used
  to land past a transition can land *on* one at a different scale.
- The "train too slow at the top of a loop" test is tuned to a drop, not a
  place, and now uses `releaseAtHeight(10.2)`. Its old `resetSim(6)` would have
  released the train 0.9 m higher and it would have held the loop — a failure
  that looks exactly like a physics regression.
- `sin(theta)` computed from a literal `4 * 4 + 2 * 2` now comes from `TILE_M`
  and `RC.SLOPE.GENTLE`.
- "Clearly sloped" was `|f.z| > 0.4`; the gentle grade is 0.316 now. Both that
  and its paired tilt threshold come off `gentleSin()` / `gentleCos()`.
- The loop footprint assertion reads `def.L` rather than `4`.

## Phase 2 — curvature and transition-step readout — **DONE**

Built so that phases 3 onward are measured rather than asserted. Nothing about
the track changed; this phase only made the track's shape legible.

### What it added

**`RC.splitCurv`** resolves a curvature vector into the two planes a builder
thinks in — vertical (crests and valleys, signed: + is a valley) and horizontal
(turning, signed to match `def.turn`). Both axes come from the WORLD, not the car
frame, so banking a turn does not move the geometry it reports and a loop's
curvature-seeded "up" does not call every part of a loop a valley. Every path
point carries `kVert` / `kLat`; `pathAt` interpolates them; the overhang
computes them too, so a car out over the edge reads back in the same units.

**`RC.jointSteps()`** — the step at every joint, via `curvInside`, which samples
only WITHIN a piece. That is the crux: the path's own three-point curvature at a
joint straddles both sides and averages away the very step being measured.
Closed circuits get the joint where the last piece meets the first, recorded at
the far end of the path so it is crossed before the lap counter wraps `s`.

**`RC.trackGeometry()`** — tightest crest, valley and turn radius, each with the
arc position that owns it, plus the speed the shape stays inside the limits to.
That last one is solved rather than searched: every limit in `G_LIMITS` is a
bound on `v^2`, because the centripetal term is the only speed-dependent part of
what a rider feels. Each axis reads `A + B*v^2` with `A` what the rider feels
standing still there and `B` from the curvature, so

```
B > 0:  v^2 <= (limit_max - A) / B        B < 0:  v^2 <= (limit_min - A) / B
```

and the smallest bound over the whole track is the answer. A negative bound
means the limit is broken standing still, which only a loop manages — there it
is a MINIMUM speed and belongs to the ride warnings, not here.

**`RC.worstJolts()`** — `physics.js` records, per joint, the worst `dk*v^2/g` the
front car took crossing it.

**Report**: a "Shape" section (radii, each named by feature, and "Within the
limits to X m/s (sideways) on Turn 1"), a "Jolts" list of the worst three, and a
warning when the run beat the speed its own shape allows. Suppressed entirely on
track with no curvature anywhere. The accel graph's hover readout now says what
the track is doing; the CSV gained two curvature columns (curvature, not radius —
straight track has no radius and a column of `Infinity` is no use to a
spreadsheet).

### Deliberately not done

**No jerk threshold was invented.** The open question below still stands: no
trustworthy coaster comfort figure was found. So the jolt readout is a
measurement with a plain-English note, not a pass/fail. The one warning added is
the honest-speed comparison, which cites limits that *are* published.

### Two things worth knowing before phase 3

**A transition's curvature is not `z''`.** It is `z'' / (1 + z'^2)^1.5`, and the
difference is not small: `gentle <-> steep` has `z''` of 1/9 per metre but a real
radius of **10.5 m**, because it enters at a grade of 1 in 3. That is why the
table above says 10.5 and not 9. Any phase-3 arithmetic that works in `z''` and
quotes the answer as a radius will be wrong by up to 17% on the steep pieces, and
wrong in the flattering direction.

**The worst jolt on a corner can be at its EXIT.** Found as a test failure. A
turn's entry step is bigger (the curvature swings from the transition's vertical
bend straight into the turn's lateral one), but the train is still accelerating
when its front car enters: the rear cars are ten metres back and still on the
descent, and the mean slope over the cars is what drives it. By the exit the
whole train is level and moving faster, and `v^2` more than makes up the smaller
step. Any reasoning about which joint on a feature is worst has to carry the
train's length, not just its geometry.

### Tests

Twelve new checks in a **Curvature** group, placed after Path. The expected
figures are derived from `TILE_M`, `LEVEL_M` and the grades rather than written
down — including a `transCurv()` helper that spells out the quadratic profile's
curvature in full, which is exactly the expression phase 3 has to change.

One is a deliberate tripwire: *"a bigger grade change over the same length bends
harder"*. Every transition is one tile long today, so `gentle <-> steep` comes
out tighter. Phase 3 sets length FROM grade change precisely so they all land on
the same curvature — at which point that check should be **rewritten as an
equality, not deleted**, because "every transition is equally tight" is the
property the new palette is meant to have.

## Phase 3 — quintic profile AND longer transitions, together

These are **one change, not two.** The quintic costs peak curvature; the extra
length pays for it. Shipping the quintic alone is a regression.

### The quintic

`heightFrac` in `track.js` is a quadratic, so a transition's curvature is a
non-zero constant that **steps** at both joints. Replace with a quintic Hermite
matching value, slope *and* curvature at both ends: six conditions, six
coefficients, exactly solvable. For `flat -> gentle` normalised, `f(u) = 2u^3 - u^4`.

**Cost is exactly 1.5x, and it is forced.** The curvature profile must integrate
to the same total slope change either way; going from a constant to a parabola
that starts and ends at zero raises the peak to 1.5x the mean. Verified for both
the monotonic and the symmetric-crest cases.

The rescale does not absorb this. `flat <-> gentle`, tightest radius, crest at
20 m/s:

| profile | tiles | scale | R | crest g |
| --- | --- | --- | --- | --- |
| quadratic | 1 | 4 m (today) | 8.0 m | −4.10 |
| quadratic | 1 | 6 m | 18.0 m | −1.27 |
| **quintic** | **1** | **6 m** | **12.0 m** | **−2.40** |
| quintic | 2 | 6 m | 24.0 m | −0.70 |
| quadratic | 2 | 6 m | 36.0 m | −0.13 |

Row three is why the two halves of this phase cannot be separated. Row five is
worth knowing too: at equal length a quadratic gives a *bigger* radius. **The
quintic's entire value is smooth onset and finite vertical jerk, not peak g.**

What it buys is not a jerk graph — turns remain a curvature step until phase 4.
It is that the existing Acceleration plot stops lying: vertical g currently
steps 0 to 4.5 g in one sample at every transition boundary, and those square
edges are artefacts of the profile, not features of any ride.

### The lengths

Set transition length by the grade change it does:

> **One tile per level of `Δg`.**

Every transition then lands on the same curvature, which is what makes the
palette predictable — convex and concave are identical, as they should be for an
intuitive builder.

| piece | Δg | tiles | Δh (levels) | R | crest g @ 20 m/s |
| --- | --- | --- | --- | --- | --- |
| flat <-> gentle | 2 | 2 | ±2 | 24 m | −0.70 |
| gentle crest / valley | 4 | 4 | 0 | 24 m | −0.70 |
| gentle <-> steep | 4 | 4 | ±16 | 28 m | −0.55 |
| flat <-> steep | 6 | 6 | ±18 | 24 m | −0.70 |

Note `flat <-> steep` is now **purely a one-click convenience**: chaining
`flat->gentle` (2 tiles, 2 levels) and `gentle->steep` (4 tiles, 16 levels)
gives the same 6 tiles, same 18 levels and the same worst radius. Low priority.

**Do not offer steep crests or valleys.** `Δg` = 12 would need 12 tiles (72 m).

Every transition is usable to about 22 m/s before crest airtime passes −1.1 g.
Crests bind long before valleys: airtime hits −1.1 g at `v^2/Rg = 2.1` while a
valley only reaches 5 g at 4.0.

### Notes

- `slope is continuous across a piece` keeps passing. New test: `h''(0) == h''(1) == 0`.
- `turnHeightFrac` (the cubic absorbing `dH` rounding on sloped turns) should get
  the same treatment for consistency. Low urgency — its curvature is small.
- **UI:** `STRAIGHTS` is keyed `gIn + '>' + gOut` and `resolve()` looks up
  `head.g + '>' + sel.slope`. A `0>6` piece means selecting *steep* from flat
  silently becomes one press committing 6 tiles and 18 m of climb. Put the cost
  in the label — "Flat -> steep, 6 tiles, +18 m" — which would help the whole
  palette.
- Tests needing revision: `slope pairs resolve to exactly one piece each`,
  `every slope can be reached from level in single steps`, `holding a slope
  selection walks up through the transitions`.

## Phase 4 — spiral-eased turns

Quarter turns become **spiral–arc–spiral**: curvature ramps linearly 0 to 1/R,
holds, ramps back to 0. Still symmetric, still exactly 90 deg, so the exit is
still `E + T*(u + v)` and `exitNode` does not change.

With `θs` the deflection each spiral does:

```
R / T = 1 / (1 + θs + θs^2/6 - θs^3/30)
```

Cross-checked against direct Fresnel integration at `θs = π/4`: formula 0.5342,
numerical 0.5348. Agreement to 0.1%.

**Use `θs` = 0.2 rad** — a quarter of the turn eased, three quarters still
constant radius. More easement lowers jerk but raises peak lateral g, and
lateral is the binding constraint.

At 6 m tiles, `R = 0.829 T`:

| T (tiles) | T | R | spiral | lateral @ 20 m/s | jerk @ 20 m/s | honest to |
| --- | --- | --- | --- | --- | --- | --- |
| 1.5 | 9 m | 7.5 m | 3.0 m | 5.5 g | 37 g/s | 10.5 m/s |
| 2.5 | 15 m | 12.4 m | 5.0 m | 3.3 g | 13 g/s | 13.5 m/s |
| 3.5 | 21 m | 17.4 m | 7.0 m | 2.3 g | 6.7 g/s | 16.0 m/s |
| 4.5 | 27 m | 22.4 m | 9.0 m | 1.8 g | 4.1 g/s | 18.1 m/s |
| 5.5 | 33 m | 27.4 m | 10.9 m | 1.49 g | 2.7 g/s | 20.1 m/s |

Easing costs about one size class: an unspiralled arc at 4.5 tiles gives 27 m,
where eased you need 5.5 tiles for the same radius. That is the whole price.

### Falls out well

- **Banking becomes physical.** Set bank proportional to `κ(s)` and the train
  rolls into the curve *through the spiral*, which is the engineering reason
  spirals exist. It starts and ends at zero automatically, so `banked pieces
  still start and finish level` stops being a rule and becomes a consequence.
- `pieceLength` stays analytic: `R * (π/2 + 2*θs)`.

### How to build it

Clothoids have no closed form, but **there is only one shape** — `θs` is a
single global constant. Precompute a normalised unit table once at module load
(64 points of `x/T`, `y/T`, `θ`, `κ*T`); `centreline` interpolates and scales by
`T`, mirrored per direction. Keeps `centreline` O(1), which matters because it is
called in tight loops.

## Phase 5 — 180 degree turns, created automatically

Two eased quarters in the same direction both start and end at `κ = 0`, so the
train briefly goes **straight** between them. A 180 deg bend reads as a subtle S
and a four-quarter helix pulses 0 to 2.3 g four times, which rides worse than
today.

**The fix is also a UX win, and it improves the geometry.** When the user places
a second banked curve in the same direction, replace *both* pieces with the two
halves of a single 180 deg turn — easements only at the outer ends, constant
radius throughout the middle. The user never chooses "90 or 180"; it just works,
the way flat track does. They find out when they place the second piece.

Why it is geometrically better, not just smoother: a 180 deg turn whose parallel
tangents are `2T` apart has

```
R = T / (1 + θs^2/6)     ->   R = 0.993 T at θs = 0.2
```

against `0.829 T` for two eased quarters. **A 20% larger radius in the same
footprint**, because it is not wasting two spirals ramping to zero in the
middle. At `T` = 4.5 tiles: 26.8 m instead of 22.4 m, so 1.52 g instead of
1.8 g, and no pulse.

**Why the swap is safe:** the pair of halves must have the same entry and exit
nodes as the two quarters they replace, and they do — quarter 1 ends at
`E + T(u+v)` heading `v`, the pair ends at `E + 2T*v` heading `-u`, identical
either way. So the substitution is invisible to the node model, the collision
checker and the auto-closer.

Details to get right:

- The halves are **not** free-standing pieces. Half A ends at `κ = 1/R`, half B
  starts there. A lone half is curvature-broken, so `applyTrackData` should
  reject or repair an unpaired one.
- Undo must restore the quarter, not leave half a 180.
- Three in a row: leave the third as a quarter. Four in a row is a full helix,
  which is 5.6 g at any radius, and the warning system should catch that rather
  than the geometry enabling it.
- `RC.features()` already merges consecutive same-job pieces, so the report will
  say "Turn 1" for the pair without changes.

## Phase 6 — loop easements

The teardrop is already a clothoid in shape, but `r(0) = A + B = R`, so
curvature **steps** off the straight before it. It needs its own entry and exit
easements, or a redefinition with `r -> infinity` at `φ = 0`.

Also retune while in there:

- `LOOP_R` default 7 m -> **10 m**: 13.5 m tall, bottom load 5.1 g instead of
  6.8 g at 20 m/s.
- `LOOP_LEN` 4 tiles -> **2** (may need 3 once easements are added). At 6 m tiles
  a 4-tile footprint is 24 m for a 7 m loop, so `loopDrift` would have to smear
  16.9 m of forward travel instead of today's 8.9 m and the shape distorts.
- ~~Latent unit bug in `loopMaxRForFootprint`~~ — **fixed during phase 1**, it
  bit as soon as `LOOP_LEN` moved.

Loop geometry tests will need updating: `a loop advances four tiles and one to
the side`, and the resize family.

---

## `MAX_H`

Set it from the catalogue rather than independently. With phases 1 to 5 done the
worst piece is usable to about 22 m/s, which is a drop of `v^2/2g`:

> **`MAX_H` = 24** (was 60)

Today the worst piece is honest to 10.7 m/s — a 6 m drop — in a park that
permits 60 m. That gap is the whole problem in one line.

## Breakages

**Phase 1 breaks nothing.** Saves load, circuits close, presets close.

**Phase 3 is the only breaking phase.** Piece lengths change (`L` 1 -> 2 and
beyond), so saved tracks advance further than they did, stop closing, and some
run off the park. `applyTrackData` rejects them on the bounds check — graceful,
but the work is gone. Bump `FORMAT` from 1 to 2 so they fail with "saved by a
different version" rather than something confusing.

**Migration alert** (asked for explicitly). Add `RC.staleSaves()` to
`storage.js`, reading the autosave and every named save and returning which
carry an older `v`. On startup, if anything comes back, show a **dismissible
in-page banner** naming them — not `window.alert`, which on a shared classroom
login fires for every student every lesson. Remember dismissal in localStorage.
Offer a "remove them" button so the student consents rather than having work
deleted under them.

Related and worth fixing **independently of all this**: `script.js` restores the
autosave and on failure only does `console.warn`, so a student whose working
track is unreadable today gets a blank park and no explanation.

**Presets** need rebuilding at phase 3, not phase 1: lengths change, drops get
tamer, friction losses grow with track length. The prefab-completion tests catch
outright failures; feel is a judgement call.

**Hardcoded prose** — six places say the tile is 4 m: `track.js` comment,
`task-loop.html` footer, the About panel in `index.html`, `export.js` footer, and
two in `HANDOVER.md`. Fix at phase 1. The status-bar readout builds itself from
`RC.TILE_M` and is already correct.

**The task sheet.** `task-loop.html` asks for the smallest lift hill that clears
a loop. That answer changes at phase 1 and again at phase 3, so any results
students have recorded stop matching.

## Open questions

- Is 11 g/s of jerk through a quintic transition acceptable? **No trustworthy
  coaster comfort threshold was found.** Rail figures of 0.3 to 0.6 m/s^3 are for
  trains at cruise and are irrelevant. Treat "finite and continuous" as the win,
  not any particular number.
- Given that a quadratic beats a quintic on peak g at equal length, is smooth
  onset worth 1.5x on every transition? Phase 2's readout should answer this
  before phase 3 commits to it.
- Do the wide turns want sloped variants? A 4.5-tile steep turn would drop
  `round(4.5 * π/2 * 6)` = 42 levels in one quarter, most of `MAX_H`. The
  sloped-turn matrix should not stay 4 shapes x 4 grades; big radii want flat and
  gentle only.
- Does a 270 deg turn need the phase 5 treatment too, or is leaving the third
  quarter alone good enough?

## Suggested order

Phases 1 and 2 are **done**, both with no breakage: phase 1 was a strict
improvement, phase 2 changed no geometry at all. **Phase 3 is next**, is the
breaking change, and wants its two halves shipped together — and note it
lengthens the track again, so `DEFAULT_MU` and the preset energy budgets need
rechecking with it. Phases 4 to 6 are the real work and want the whole suite
green before starting.

Phase 2's readout is now the tool for the rest of it. Before committing to the
quintic, load each preset and read the Shape section: it gives the speed the
current catalogue is honest to and the speed the ride actually reaches, which is
the gap the whole refactor exists to close, measured rather than argued.

Suite is at **166 checks**, all passing, as of the end of phase 2.
