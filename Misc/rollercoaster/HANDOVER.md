# Rollercoaster Builder — handover

A handover so a fresh Claude Code session (on any machine) can pick up this sim
where the last one left off. Same idea as the root `TODO.md`, scoped to this sim.

## How to use this file

1. Read **Settled decisions** first. Those came from the teacher directly and are
   not derivable from the code. Don't re-litigate them.
2. Read **Architecture** before touching `iso.js` — the rotation design is load-bearing.
3. Pick the next `[ ]` phase, build it, tick it, and append a one-line note on what shipped.
4. If you discover a convention worth recording, add it under **Conventions**.

Don't tick anything you didn't actually build.

---

## What this is

An RCT1/2-flavoured rollercoaster builder and simulator for Stage 1 physics.
Students build a coaster, run a train on it, and analyse the kinetic and
gravitational potential energy of the train as it goes round.

The teacher's framing, worth keeping in mind: PhET have similar things but they
feel "either too serious or too cartoony". The target is **video gamey**. RCT is
the reference, not a textbook diagram.

---

## Settled decisions

These were chosen explicitly by the teacher. Treat them as fixed.

| Question | Decision |
|---|---|
| Build interface | **Isometric pseudo-3D.** Side-on 2D, freehand curve drawing and spline control points were all considered and rejected. |
| Track space | **Full RCT grid — track turns in plan as well as climbing.** The easier plane-locked option was explicitly turned down. |
| Physics fidelity | **Frictionless by default, friction as a toggle** with a slider. Ideal case keeps KE + GPE exactly constant for the conservation lesson. |
| Analysis outputs | **All four**: live stacked KE/GPE/total bars, energy-vs-distance graph, numeric readout at the train, RCT-style ride-stats report. |
| Menu placement | **`miscellaneous.html` → new "Energy" topic card.** |
| Failure modes | **Valley / roll-back only.** The train stalls and rolls back. Loop failure and excess-speed crashes are *reported as warnings*, never acted out — no derailment. |
| Game loop | **Sandbox first.** Scenarios/challenges only if the sandbox works well. |
| Train controls | **All four**: car count / mass, lift-hill speed, drag-to-place start position, brake pieces. |
| Circuit rules | **Both** closed circuits *and* out-and-back shuttle tracks with a launch. |
| Art style | **Chunky RCT1-flavoured, drawn procedurally on canvas.** Not true pixel art (asset burden), not clean flat vector (not game-like enough). Teacher has seen and approved it. |
| Construction UI | **RCT's model, not a flat palette.** Orthogonal Direction / Slope / Roll rows, a preview, and an explicit *Build this*. Slope buttons choose the slope you want to be **travelling at**, and the transition piece is inserted for you. Icons are vector, drawn at the true geometry (turn arcs use the real radii; slope arrows the real 27° and 56°). |
| Banking | **One angle, 45°, turns only.** The lesson is the comparison with a flat turn, not realism. |
| Scale | **1 tile = 4 m square, 1 height step = 1 m.** Confirmed after being offered a 2 m step. Gives a 40 m lift hill at 40 steps and a realistic ~100 km/h top speed. |
| Page layout | **Full-bleed canvas.** The standard two-column PhysVys sim shell was explicitly rejected here: "the other PhysVys sims were a bit of a mislead there". Minimalist UI — view controls across the top, graph/table as toggleable overlay windows, grid and ride canvas taking most of the page. |

---

## Architecture

Five files, plain `<script>` tags — **no ES modules**, so the page works from
`file://` as well as over a server. Everything hangs off a `window.RC` namespace.

```
index.html   markup: canvas, top bar, status bar, floating windows
test.html    self-test — OPEN IT IN A BROWSER after touching geometry or physics
style.css    full-bleed game chrome (NOT the standard PhysVys sim stylesheet)
iso.js       isometric projection, camera, ground + sky + compass rendering
track.js     piece catalogue, build head, arc-length path, collision, A* finisher
physics.js   train simulation, energy accounting, g-forces, the car frame
prefabs.js   ready-built coasters; the page loads one so it can be tested at once
render.js    depth-sorted draw list: rails, sleepers, supports, train, head, ghost
energy.js    energy bars, energy-against-distance graph, ride report
icons.js     inline SVG for the construction window
ui.js        generic floating-window system
build.js     construction window: direction/slope/roll selection, placement, undo
script.js    canvas sizing, camera interaction, render loop, wiring
```

Load order matters and is set by the script tags in `index.html`:
`iso → track → physics → prefabs → render → ui → icons → energy → build → script`.
`track.js` needs `RC.inBounds`/`RC.TILE_M` from `iso.js`; `render.js` needs
`RC.carFrame` from `physics.js`; `script.js` needs `RC.ghostDef` from `build.js`.

This is a deliberate deviation from the repo's "three files per sim" convention,
agreed with the teacher up front because of the size of this build.

### The rotation design (load-bearing — read before editing `iso.js`)

The world is stored in **fixed `(i, j)` tile coordinates plus height `k`**. The
camera's rotation is applied by *swizzling* `(i, j)` into view coordinates
`(a, b)` at projection time only.

This means **the track model and the physics never know the camera rotated.** A
track piece stores the direction it was built in, full stop. Do not add rotation
handling to the track or physics layers — if you find yourself wanting to, you've
misunderstood this and should re-read `RC.rot` / `RC.unrot`.

- `RC.rot(i, j, rot)` — continuous coords. Uses `N - i` (not `N - 1 - i`) because
  tile `i` spans `[i, i+1]` and its mirror spans `[N-i-1, N-i]`.
- `RC.rotTile(i, j, rot)` — integer tile indices. Uses `N - 1 - i`.
- These two agree: the corners of tile `(i,j)` under `rot` span exactly
  `[ra, ra+1] × [rb, rb+1]` where `[ra, rb] = rotTile(i, j, rot)`. Verified by hand
  for all four rotations; if you change one, re-check the other.
- `RC.unrot` inverts `RC.rot`. `RC.screenToWorld` inverts `RC.toScreen` at `k = 0`.

### Projection

2:1 isometric. World-pixel space has its origin at the centre of the ground slab:

```
x = (a - b) * TW / 2
y = (a + b - GRID) * TH / 2 - k * LEVEL_PX
```

Constants in `iso.js`: `GRID = 40` tiles (a 160 m square park), `TW = 64`,
`TH = 32`, `LEVEL_PX = 10`, `SLAB = 20` (px thickness of the dirt sides),
`TILE_M = 4`, `LEVEL_M = 1`.

Camera (`RC.camera`) is `{ zoom, panX, panY, rot }`. Pan is in screen px, applied
after the zoom scale. Zoom is snapped to 0.02 steps so a continuous wheel gesture
doesn't thrash the ground cache.

### Depth sorting

`RC.depth(i, j, k, rot)` returns `(a + b) * 100 + k` — larger is nearer the
viewer, drawn later. Phase 3 needs this to interleave ground, support struts,
track segments and the train in one painter's-algorithm sweep.

### Ground rendering

Only the tiles actually on screen are drawn, batched into a handful of `Path2D`s
— two checker fills, two strokes, one tuft fill, two slab faces — so the cost is
about 4 draw calls no matter how many tiles are visible.

This replaced an offscreen whole-map cache. The cache was fine at 20×20, but its
memory grows as `(GRID * scale)²`, and doubling the park to 40×40 would have
wanted **~333 MB** at maximum zoom on a dpr-2 display. Viewport culling is bounded
by screen size rather than park size, stays crisp at every zoom, and removes the
cache-invalidation problem. Don't reintroduce a full-map cache.

Helpers that exist for this: `RC.viewToScreen` (project already-rotated view
coordinates straight to screen, avoiding four `rot` calls per tile) and
`RC.unrotTile` (view tile index back to world tile index, for the checker parity
and the tuft hash).

### Window system (`ui.js`)

Generic and already finished. To add a window in a later phase you need **markup
only**:

```html
<section class="window" id="win-energy" hidden style="left:24px; top:76px; width:320px;">
  <div class="window-hd"><span>Energy</span><button class="window-x" aria-label="Close">×</button></div>
  <div class="window-body">…</div>
</section>
```

plus a top-bar button with `data-window="win-energy"`. `RC.initWindows()` wires
dragging, clamping into view, click-to-raise, the close button, the active state
on the toggle, and Escape-closes-topmost. No per-window JavaScript.

`.readout-row` is already defined in `style.css` for the energy/report windows.

### The car frame — where a lot of correctness lives

`RC.carFrame(p)` returns an orthonormal `{f, r, u}` triad: forward along the
track's **full 3D tangent**, right horizontal (before banking), up perpendicular
to the track surface. `RC.frameAtPoint(pts, idx)` is the same thing for a point
in the path array, which is what the renderer uses.

Three separate things read it, which is why it's worth guarding:

- **Car rendering** — cars pitch with the slope and roll with the bank because
  their box is built on these axes.
- **Track rendering** — rails, sleepers and chain dogs are offset along `r` and
  `u`, so banked track rolls. Support bents meet the track on those axes but
  drop **vertically**; supports don't lean.
- **G-forces** — the specific force is projected onto the triad. This is why
  banking needed no changes to the force maths at all.

It is computed in **metres**, not in mixed tile/level coordinates. A tile is 4 m
across and a level is 1 m tall, so computing the tangent in raw coordinates would
flatten every pitch angle by a factor of four — cars would tilt, just visibly too
little, which reads as a styling choice rather than a bug.

Sign convention, verified by test: a right turn from heading `+i` curves towards
`+j`, so `+j` is the rider's right and `r` must come out as `(0,1,0)` when `f` is
`(1,0,0)`. Getting this backwards labels every lateral g reading with the wrong
side and nothing else in the sim notices, because the car box is symmetric.

### Energy accounting

The invariant the whole sim exists to teach, asserted by several tests:

```
KE + PE + thermal  ==  E0 + motor work
```

Gravity needs no bookkeeping — it just trades PE for KE. Everything else must
bank its energy explicitly:

- friction and brakes → `eThermal`
- chain lift and launch → `eMotor` (the kinetic energy they restore)
- **stopping the train dead** → `eThermal`. Hitting the end of an open track, or
  berthing at the station, would otherwise silently delete kinetic energy at
  exactly the moment a student is checking conservation.

If a display and the physics ever disagree, the physics is right.

---

## Build phases

- [x] **Phase 1 — Isometric world, camera, ground.** 40×40 slab, four-way rotation,
      cursor-pinned zoom, drag pan, hover tile pick, compass, sky with drifting
      clouds, dirt-sided slab, deterministic grass tufts. Teacher has approved the
      look.
- [x] **Layout rework.** Full-bleed canvas, floating window chrome, `ui.js`. Done
      out of phase order at the teacher's request after seeing phase 1.
- [x] **Phase 2 — Track piece model and build head.** `track.js` + `build.js`.
      Nodes are `{i, j, dir, k, g}`; pieces declare `gIn`/`gOut` and are offered
      only when `gIn` matches the head, which produces the RCT greyed-out palette
      with no special-casing. Slopes are levels per tile — `GENTLE = 2` (27°),
      `STEEP = 6` (56°) — chosen **even** so that every height change
      `L*(gIn+gOut)/2` is an integer and the track stays grid-snapped. Quarter
      turns use **half-integer radii** (1.5 and 2.5 tiles) because that is the only
      way the arc's exit lands on a tile edge midpoint. Shipped: flat, gentle,
      steep, all four transitions each way, four quarter turns, station, brake,
      launch, chain-lift flag, undo, clear, circuit/shuttle status.
- [x] **Phase 3 — Track rendering.** Chunky rails over a spine, sleepers coloured
      by piece type, chain dogs on lift hills, station platforms, support bents
      with zig-zag cross-bracing. Spaced evenly in **metres** off the arc-length
      path rather than per piece, which otherwise bunches them on turns.
      Piece-vs-piece collision landed here too: track may cross itself but not run
      through itself, needing 3 levels of clearance. Only piece *interiors*
      (t 0.2–0.8) are tested and the piece at the head is skipped — without both,
      ordinary S-bends and U-turns get refused.
- [x] **Phase 4 — Physics and train.** `physics.js`. Bead on a wire along the
      arc-length table, fixed 1/240 s substeps, semi-implicit Euler. See
      **Physics design** below — it is all built as described.
- [x] **Phase 5 — Energy analysis.** `energy.js`. Bars for KE/PE/heat plus a
      stacked total, with a dashed line at *supplied*; energy-against-distance
      graph; ride report. The bar scale is held for a whole run and only grows —
      rescaling per frame would make both bars appear to change as energy moves
      between them, which is the exact misreading the display exists to prevent.
- [x] **Vertical and lateral g** (added after phase 5, at the teacher's request).
      Proper decomposition onto the car frame, live in the Energy window and
      summarised in the report, with a plain-English verdict.
- [x] **Banked turns at 45°** (added after phase 5). Turns can be flat or banked,
      chosen from the Roll row. See **Banking** below for why it was cheap.
- [x] **Menu link and prefab.** "Energy" topic card in `miscellaneous.html`;
      `prefabs.js` loads *First Drop* on startup so the page is testable
      immediately.
- [x] **Phase 6 — Train config, friction, loops.** The Train window (`controls.js`)
      exposes cars, release point (a slider along the track, not a drag), friction
      on/off with `mu`/`kDrag` sliders, and lift/brake/launch speeds. Vertical
      loops landed here too (left/right, RCT footprint). Speeds shown in m/s.
- [x] **Height labels, m/s units, acceleration graph + turn overlay, copyable test
      failures.** Added after phase 6 at the teacher's request.
- [ ] **Phase 7 — Polish.** Scenery, more prefabs, and whatever the classroom
      turns up. The default prefab (*First Drop*) is deliberately spirited — it hits
      ~1.7 g lateral and −1.6 g airtime; the teacher is happy with that, but a
      gentler variant (lower lift, drops and hills scaled to match, keeping the
      five-exchange shape) is a standing option if a tamer default is wanted.

### Deliberately not built

- **Sloped turns.** Turns are level-only, which is why the palette greys them out
  on a gradient — you can't spiral. Adding them re-opens the piece catalogue in
  the way banking was designed to avoid. The energy lesson works without them.
- **Scenarios/challenges.** Sandbox first was the agreed order; only worth doing
  once the sandbox has been used in class.

---

## Banking

One angle, 45°, on turns only. The teacher's framing: *"a banked curve at a given
speed is usually more tolerable than a flat curve"* — the thing RCT teaches by
feel. The report and the About text both point at the comparison.

What kept it cheap: **bank returns to level wherever a banked run ends**, so it
never becomes part of the node state, no transition pieces are needed, and the
catalogue doesn't multiply — it's a per-piece flag exactly like the chain lift.
The RCT-faithful alternative (bank as a fourth node dimension with explicit
transitions) roughly triples the piece count for a difference students would not
see.

The bank ramp is **neighbour-aware** (`bankProfile(t, rampIn, rampOut)` in
`track.js`, fed from `trackPath`). A lone banked turn ramps in and out within
itself. But a run of banked turns in the *same direction* — two quarter turns
making a 180°, say — holds full bank across the joints between them; the ramp at
an end is suppressed when the neighbour on that side is a same-direction banked
turn. An S-bend (opposite directions) still rolls through level at the joint,
because it must. Getting this wrong (the original per-piece version) made a 180°
flatten out in the middle and roll back up, which is jarring — there are tests
for both cases now.

The g-force maths needed **no changes at all**, because banking is a roll of the
car frame and the forces were already a projection onto that frame.

Numbers worth knowing: on a 6 m turn at 10 m/s, flat gives 1.70 g sideways;
banked gives 0.49 g sideways and 1.91 g vertical. The *total* force is unchanged —
banking redirects it, it does not reduce it, and a test asserts that. At the ideal
speed `v = √(rg)` lateral cancels entirely and vertical is exactly `1/cos 45°`,
which is the banked-curve relationship from
`motion/1-3circular-gravitation/banked-curves/` arrived at by building.

---

## Physics design (all built as described)

- All pieces sample down to one arc-length table (`RC.trackPath()`), cached
  against `RC.version` which every edit bumps. Each point carries `s` in metres,
  `dzds` (the sine of the pitch), the **curvature vector** `kx/ky/kz` and `bank`.
  Curvature is a vector, not a magnitude: the direction is what distinguishes a
  rider pressed into their seat from one thrown sideways.
- `dv/dt = -g·⟨dz/ds⟩ - friction`.
- **The train is not a point mass.** Model `N` cars spread along `s` sharing one
  `v`; the tangential force uses the **mean slope across the cars** and GPE uses
  the **mean height**. This is why a long train crests a hill differently from a
  short one, and it makes the car-count control physically honest rather than
  decorative.
- Chain lift clamps `v` up to lift speed and books the work done as **motor energy
  input** — this is the only thing adding energy to the ride, and the bars should
  make that visible.
- Brakes decelerate to a target speed; that energy goes to the **thermal** bar.
- **Never clamp `v` at zero.** Valleying and roll-back then fall out of the
  integration for free, with no special-casing. Detect sustained oscillation and
  report "the train valleys here".
- Negative vertical g raises a **warning** only. Per the settled decisions, the
  train never derails.
- Energy datum is ground level. Keep the readouts computed from the exact
  quantities, not from anything the renderer approximates.
- Completing a lap is a **flag, not the end of the run**. The train carries on,
  the station brakes it at 5 m/s², and the ride ends when it reaches the berth it
  started from. Below a crawl the station's drive tyres are treated as seeing it
  home, or a train that brakes early would stall short and hang the run.

---

## Conventions

Repo-wide conventions from the root `TODO.md` that apply here:

- **No emojis anywhere.** UI glyphs like `▶ ■ ⟲ ⟳ ← −` are fine; pictographic
  emojis are not. This is a hard rule.
- **Defaults must give a sensible result on first load** — a teacher opening the
  link should see something useful without touching anything. Done: `prefabs.js`
  loads *First Drop*, paused, on startup. If you change the piece catalogue or the
  turn geometry, the prefab tests will tell you if it stops closing.
- **Don't spoonfeed the punchline.** Intro copy, menu description and any scene
  note set up the phenomenon and the controls, never the result the sim exists to
  reveal.
- **Slider + editable textbox** is the standard control pattern: every
  `<input type="range">` showing a number is paired with an
  `<input type="number" class="num-input">`, two-way bound and clamped. Note the
  full-bleed stylesheet here does **not** define `.num-input` — copy it from
  `Misc/moire-effect/style.css` when phase 6 adds the friction and train sliders.
- Sim-local conventions: no ES modules; everything on `window.RC`; the standard
  PhysVys two-column shell does **not** apply to this sim.

---

## State of verification — read this

**The build machine has no JS runtime and no browser automation.** The assistant
cannot run anything; only the teacher can, by opening `test.html` in a browser.

**As of the last run, all 75 checks in `test.html` pass.** The suite covers the
projection round-trips, the piece-geometry invariant (a declared exit node must
sit exactly where the drawn centreline ends, or track looks joined while the
physics path has gaps), collision, the A* finisher, energy conservation,
g-forces, banking, loops, the graph overlay, the train controls and the prefabs.

### The lesson that cost a dozen failures

For several phases the assistant *reasoned* that new tests passed and reported
them green without the teacher running them. When the suite was finally run in
full it showed **12 failures at once** — 11 of them faults in the tests
(released-at-rest-on-flat trains that never moved, a trace that truncated at the
sample cap, closed-circuit assumptions, tolerances too tight for a full lap),
and only one a real code bug (`pieceSpans` leaving a gap at every piece joint).

So: **a test is not passing until the teacher has run it and said so.** After any
change with a number in it, add or update a check in `test.html`, then ask the
teacher to run it and paste the result. The copyable failure panel at the top of
the page exists for exactly that hand-off. Do not tick a task or call something
verified on the strength of reasoning alone.

### Bugs the tests and hand-tracing caught that the running sim would not have

Worth reading as a list of what to stay suspicious of:

- **`carFrame`'s right vector pointed left**, so every lateral g was labelled with
  the wrong side — invisible, because the car box is symmetric.
- **Energy silently deleted** when a train stopped dead at a track end.
- Cars built from a horizontal tangent, so they never pitched on slopes.
- The orientation frame could not invert, so a train stayed upright through a
  loop (fixed by parallel-transporting it — see **The car frame** above).
- Rails painting over the cars, because each segment sorted independently.
- Ground cache unbounded — would have wanted ~333 MB at 40×40, max zoom, dpr 2.
- Ground cache built without devicePixelRatio (blurry on HiDPI only).

Git note: the repo normalises LF→CRLF on checkout, so `git` prints line-ending
warnings on every add. They're harmless.

---

## When this sim is done

Move this file to `HANDOVER-done.md` or delete it, and add the sim's entry to the
"Energy" topic card in `miscellaneous.html`.
