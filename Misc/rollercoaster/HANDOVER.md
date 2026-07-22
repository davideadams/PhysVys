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
| Art style | **Chunky RCT1-flavoured, drawn procedurally on canvas.** Not true pixel art (asset burden), not clean flat vector (not game-like enough). Teacher has seen and approved the current ground rendering. |
| Scale | **1 tile = 4 m square, 1 height step = 1 m.** Confirmed after being offered a 2 m step. Gives a 40 m lift hill at 40 steps and a realistic ~100 km/h top speed. |
| Page layout | **Full-bleed canvas.** The standard two-column PhysVys sim shell was explicitly rejected here: "the other PhysVys sims were a bit of a mislead there". Minimalist UI — view controls across the top, graph/table as toggleable overlay windows, grid and ride canvas taking most of the page. |

---

## Architecture

Five files, plain `<script>` tags — **no ES modules**, so the page works from
`file://` as well as over a server. Everything hangs off a `window.RC` namespace.

```
index.html   markup: canvas, top bar, status bar, floating windows
style.css    full-bleed game chrome (NOT the standard PhysVys sim stylesheet)
iso.js       isometric projection, camera, ground + sky + compass rendering
ui.js        generic floating-window system
script.js    canvas sizing, camera interaction, render loop, wiring
```

This is a deliberate deviation from the repo's "three files per sim" convention,
agreed with the teacher up front because of the size of this build. Later phases
should add `track.js`, `physics.js` and `render.js` rather than growing
`script.js` without bound.

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

Constants in `iso.js`: `GRID = 20` tiles, `TW = 64`, `TH = 32`, `LEVEL_PX = 10`,
`SLAB = 20` (px thickness of the dirt sides), `TILE_M = 4`, `LEVEL_M = 1`.

Camera (`RC.camera`) is `{ zoom, panX, panY, rot }`. Pan is in screen px, applied
after the zoom scale. Zoom is snapped to 0.02 steps so a continuous wheel gesture
doesn't thrash the ground cache.

### Depth sorting

`RC.depth(i, j, k, rot)` returns `(a + b) * 100 + k` — larger is nearer the
viewer, drawn later. Phase 3 needs this to interleave ground, support struts,
track segments and the train in one painter's-algorithm sweep.

### Ground cache

The ground never changes, so it renders once into an offscreen canvas keyed on
`(rot, scale)` and is blitted thereafter; panning is free.

The cache covers the **whole map**, so its memory cost grows as `scale²`. It is
built at `min(zoom * dpr, CACHE_SCALE_MAX)` with `CACHE_SCALE_MAX = 2.5` —
uncapped, a dpr-2 display at max zoom would have allocated ~84 MB. The blit
converts with `k = zoom / cacheScale`. Consequence: mild softening above that
scale. If crispness at high zoom matters more than the cache, the clean
replacement is per-frame viewport-culled tile drawing, which is bounded by screen
size rather than map size.

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

---

## Build phases

- [x] **Phase 1 — Isometric world, camera, ground.** 20×20 slab, four-way rotation,
      cursor-pinned zoom, drag pan, hover tile pick, compass, sky with drifting
      clouds, dirt-sided slab, deterministic grass tufts. Teacher has approved the
      look.
- [x] **Layout rework.** Full-bleed canvas, floating window chrome, `ui.js`. Done
      out of phase order at the teacher's request after seeing phase 1.
- [ ] **Phase 2 — Track piece model and build head.** `track.js`. A piece is
      `{ turn: -90|0|+90, dHeight, entrySlope, exitSlope, footprint, centreline(t), length }`.
      Build head carries `{tile, direction, height, slope}`; the palette greys out
      any piece whose `entrySlope` doesn't match the head's current slope, exactly
      like RCT. Click to extend, backspace to remove the last piece. Piece set:
      flat · flat↔gentle · gentle · gentle↔steep · steep · quarter turns (1- and
      2-tile radius, flat and sloped) · station · brake run · chain lift (a *flag*
      on a piece, not a separate piece) · launch (shuttle) · vertical loop (prefab,
      multi-tile footprint). Circuit validity walks the piece chain: closed if the
      head returns to the station entry with matching direction and height;
      shuttle if it dead-ends and a launch exists.
- [ ] **Phase 3 — Track rendering with depth sorting.** `render.js`. Sample piece
      centrelines into an arc-length table, draw chunky rails + sleepers + support
      struts, sort against ground and train by `RC.depth`.
- [ ] **Phase 4 — Physics and train.** `physics.js`. Bead on a wire along arc
      length `s`, semi-implicit Euler with substeps. See **Physics design** below.
- [ ] **Phase 5 — Energy analysis.** Stacked KE/GPE/thermal bars with the total
      line drawn at `initial + motor input`; energy-vs-distance plot; live
      `h / v / KE / GPE / total` at the train; ride-stats report on circuit
      completion (max speed, max height, max g, ride time, warnings). All as
      floating windows.
- [ ] **Phase 6 — Train config, friction, loop.** Car count/mass, lift speed,
      drag-to-place start, brake pieces, friction/drag toggle + sliders, vertical
      loop prefab.
- [ ] **Phase 7 — Prefabs, polish, menu link.** Ship with a working demo coaster
      loaded and paused (see Conventions). Scenery. Add the "Energy" topic card to
      `miscellaneous.html`.

---

## Physics design (decided, not yet built)

- All pieces sample down to one arc-length table `s → (x, y, z, curvature)`.
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
- Loops: evaluate `N = m(v²/r + g·cosθ)` per frame. `N < 0` raises a **warning**
  only. Per the settled decisions, the train never derails.
- Energy datum is ground level. Keep the readouts computed from the exact
  quantities, not from anything the renderer approximates.

---

## Conventions

Repo-wide conventions from the root `TODO.md` that apply here:

- **No emojis anywhere.** UI glyphs like `▶ ■ ⟲ ⟳ ← −` are fine; pictographic
  emojis are not. This is a hard rule.
- **Defaults must give a sensible result on first load** — a teacher opening the
  link should see something useful without touching anything. For this sim that
  means shipping a prefab coaster, loaded and paused, in phase 7.
- **Don't spoonfeed the punchline.** Intro copy, menu description and any scene
  note set up the phenomenon and the controls, never the result the sim exists to
  reveal.
- **Slider + editable textbox** is the standard control pattern: every
  `<input type="range">` showing a number is paired with an
  `<input type="number" class="num-input">`, two-way bound and clamped. Note the
  full-bleed stylesheet here does not yet define `.num-input` — copy it from
  `Misc/moire-effect/style.css` when phase 6 adds sliders.
- Sim-local conventions: no ES modules; everything on `window.RC`; the standard
  PhysVys two-column shell does **not** apply to this sim.

---

## State of verification — read this

**Nothing in this sim has been run in a browser yet.** The machine it was built on
had no working Chrome extension and no Node install, so:

- The projection algebra was verified **by hand**: `rot`/`unrot` round trips,
  `rotTile`/`rot` corner agreement, and `screenToWorld` inverting `toScreen`, for
  all four rotations. That part is trustworthy.
- The DOM, CSS, event wiring and window system have **never been observed
  working**. Treat phase 1 as "written and reasoned about", not "tested".

**First thing a new session should do is open `index.html` in a browser and check
it actually renders and pans**, before building anything on top of it. Two known
bug classes were already caught by inspection alone (a missing devicePixelRatio in
the ground cache, and the unbounded cache allocation), which is a fair warning
that more may be lurking.

Git note: the repo normalises LF→CRLF on checkout, so `git` prints line-ending
warnings on every add. They're harmless.

---

## When this sim is done

Move this file to `HANDOVER-done.md` or delete it, and add the sim's entry to the
"Energy" topic card in `miscellaneous.html`.
