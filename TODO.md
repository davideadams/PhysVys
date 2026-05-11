# Remaining Sims — Topic 3 (Light & Atoms)

A handover so a fresh Claude Code session can pick up where the last one left off.

## How to use this file

1. Read the **Conventions** section.
2. Skim the existing sims most similar to the one you're building.
3. Pick a `[ ]` item, build it, link from `index.html`.
4. Change `[ ]` → `[x]` for that item and append a one-line note describing what shipped.
5. If you discover a new convention worth recording, add it under **Conventions**.

Don't tick anything you didn't actually build. Don't add scope creep without checking with the user.

## Conventions

### Folder layout
`<topic>/<subtopic-folder>/<sim-name>/{index.html, style.css, script.js}`. Three files per sim, no shared assets — copy `double-slit/style.css` (or a closer sibling) as the starting point.

### Visual shell
Hero with `← Back to Main Menu` link → two-column `.layout` (controls left, canvas right). Canvas usually 960×600 with `aspect-ratio: 8 / 5` (two-source uses 3:2). Top-down 2D canvas; source on the left, anything blocking in the middle, screen on the right.

### Stylesheet vocabulary (already defined)
`.panel`, `.controls`, `.control-group`, `.seg-control.cols-{2,3}`, `.seg-btn`, `.slider-row + .slider-val + .slider-unit`, `.vec-btn` (with `.active`), `.play-btn` (with `.playing`), `.explain-card + .readout-hd + .readout-row`, `.canvas-wrap`, `.scene-note`.

### State and animation
Single `state` object. Default `state.playing = false` (paused on first load *and* on mode switch — the teacher wants to set the scene before pressing play). Play button starts as `▶ Play`, flips to `■ Pause` with `.playing` class.

### Rendering patterns
- Per-pixel scalar fields render into a lower-resolution backing canvas (`BW≈320–380`, `BH = BW * H/W`), `putImageData`, then `drawImage` scaled to the visible canvas with `imageSmoothingEnabled = true`.
- Causal fade for propagating waves: each contribution multiplied by `clamp((reach - r) / λ, 0, 1)` so wavefronts emerge cleanly rather than popping in at non-zero phase.
- For screen strips that render at finite row resolution, use an *odd* row count so one row's midpoint hits `CENTER_Y`, and 4× supersample per row to catch narrow peaks.
- **Discrete-count visualisation for "amount" quantities.** When a quantity drops by a fraction (intensity through filters, photon count surviving an interaction, etc.), N countable elements (rays, dots, particles) where some get absorbed/removed reads far more clearly than a brightness gradient. Trim symmetrically from the outside in to keep the cluster centred. Example: polarisation draws 12 horizontal rays, halved at the first filter and rounded by `cos²Δθ` at each subsequent filter.
- **Continuous physics, discrete visual.** When the canvas uses a discretised approximation, keep side-panel readouts (`I/I₀`, transmission factors, etc.) computed from the exact continuous formula. The visual is the teaching aid; the readouts are the source of truth. Don't lie in the numbers to match the picture.
- **Single-particle polar accumulator** (electron-diffraction). When the apparatus is a flat detector with a radially-symmetric arrival distribution, sample landing positions as `categorical over rings → Gaussian radial offset → uniform azimuth`. Store `{x, y, t0}`, fade by age over ~15–20 s, cap the array (~3500) and shift the oldest off. Cheaper and more flexible than a full 2D imageData rebuild every frame, and reads as "one electron at a time" exactly the way the duality lesson needs.
- **Cached radial intensity field** (electron-diffraction continuous mode). When the same field is needed at full and faded alpha (continuous mode vs wave-field overlay in single mode), build it once into a small backing canvas keyed on `(V, target, lightMode)`, then `drawImage` scaled. Invalidate the cache key on the inputs that change the field, not on every frame.
- **Perspective ellipses** for objects whose face needs to be seen but whose physical orientation is perpendicular to the viewing line (polariser discs, optical filters, mirrors at near-grazing angle). Foreshorten the on-axis radius (`rx ≈ 0.4 ry`), draw the face content (axes, hatching, labels) projected through the same scale so a 0° axis stays vertical and a 90° axis lies across the foreshortened extent. Hit-testing uses the ellipse equation; drag-to-rotate must *undo* the foreshortening before `atan2` so the visible rim maps to the correct face angle.

### Reusable helpers (already in some sims, copy as needed)
- `slitEnv(dy, r)` — single-slit Fraunhofer envelope `sinc(πa·dy/λr)` (diffraction-grating, double-slit).
- `gratingIntensity(yRel, λ)` — far-field N-slit intensity (diffraction-grating).
- `wavelengthToRGB(λmm)` — Bruton's piecewise visible-spectrum colour map, sim mm 1.0–1.8 maps to 380–780 nm (diffraction-grating).

### Notation (SACE Stage 2)
- Path difference is **`p`**, not `Δr`. Display its magnitude.
- For double slit / grating: `d sin θ = mλ` (constructive), `d sin θ = (m+½)λ` (destructive).
- Order index `m`, not `n`.
- Work function is **`W`**, not `φ`. Photoelectric equation: `E_max = hf − W`.

### URL params
`?mode=…` is honoured by `double-slit/script.js` so the same page can be linked from multiple subtopics with different defaults. Worth replicating when a sim has a "default mode" worth jumping to.

### Toggles seen in the wild
- **Actual distances** vs sim mm (diffraction-grating). Conversion factors picked so defaults map to a believable school-lab grating: sim-mm × `580/1.4 nm` for slit-scale quantities (λ, d, a, p), sim-mm × `1/130 m` for L and on-screen positions. Toggle just re-formats readouts; physics stays in sim units.
- **Light mode (for projection)** (diffraction-grating). Pale cream background, dark blue / dark red wave field, dark amber screen bands. White light always uses dark backdrop regardless. Useful for any sim that will be projected.
- **Mechanism overlay (progressive disclosure)** (polarisation E-field arrows). Default view shows the macroscopic phenomenon — what students see in the lab — and an opt-in toggle overlays the underlying mechanism. Reach for this when the mechanism is conceptually heavier than the phenomenon; learners can switch it on once the phenomenon is familiar. When the overlay is on, dim the macroscopic layer so the overlay carries the visual.
- **Snap-to-N° for angle sliders** (polarisation, default on at 15°). Applies to both sliders and any canvas drag-to-rotate. Toggling snap *on* re-snaps the current value so the visible state matches the rule. Useful any time pedagogically interesting angles cluster on round multiples (0/30/45/60/90, …).
- **Add/remove (`+ / −`) for variable-count elements** (polarisation filters). When a sim's punchline depends on a configuration the student should *discover*, hide its existence until they add it — don't pre-place disabled slots. Cache the angle/state of removed elements so re-adding restores them. If positions matter (e.g., insertion point is the punchline), bake the positional rule into the add order, but label by add-order so the action history stays visible to the student.

### Apparatus / given parameters
- **Spec card for instrument constants** (electron-diffraction). When some quantities are *given* (screen distance, screen size, calibration d-spacings) rather than chosen, show them in a dashed-border `.spec-card` panel at the bottom of the controls column — visually distinct from the live sliders so students read them as "the lab gave you these" rather than "another thing to fiddle with". For mystery samples, suppress the per-sample given values (that's the puzzle); for the calibration sample, include them.

### Other
- **No emojis anywhere.** UI glyphs like `▶ ■ ⟲ ← ±` are fine; pictographic emojis are not.
- Defaults should give a visually sensible result on first load (so a teacher who hits the link sees something useful without sliding anything).
- **Don't spoonfeed the punchline.** The intro paragraph, menu description, and scene-note should set up the *phenomenon* and the *controls*, never describe the surprising result the sim is built around (the three-polariser revival, the photoelectric threshold, the Rutherford back-scatter, etc.). Students should stumble on those themselves; if a teacher reads the copy aloud they shouldn't accidentally pre-empt the lesson. Same rule for the in-canvas defaults — set up the apparatus, not the result.
- **Defaults that need a small action to become interesting.** When a sim has a multi-element configuration where the relationship between elements is the lesson (filter angles, slit spacings, plate voltages), give every newly-added element the same/identity setting so the student's first rotation/adjustment is what produces the change. Don't pre-arrange the elements into an "already interesting" state.
- Sliders should clear any accumulated state that depends on geometry (e.g. histograms in double-slit bullets/electrons).
- Skill: when a sim has two physically distinct regimes, present a `Mode` segmented control. When particles are involved, default `rate` should be appropriate per mode (bullets ~100/s, electrons ~10/s so the pattern builds visibly).

## TODO

### 3.1 Wave Behaviour of Light

- [x] **Two-Source Interference** — `quantum/3-1wave-behaviour-of-light/two-source-interference/`
- [x] **Double Slit** — `quantum/3-1wave-behaviour-of-light/double-slit/`
- [x] **Diffraction Grating** — `quantum/3-1wave-behaviour-of-light/diffraction-grating/`
- [x] **Polarisation** — `quantum/3-1wave-behaviour-of-light/polarisation/`. Side-on beam through 1–3 rotatable linear polarisers; filters are added/removed with `+ / −` buttons (2nd → right slot, 3rd → middle slot). Discs drawn in perspective (foreshortened ellipse, face toward source) with transmission axis + hatching; drag-to-rotate, slider, snap-to-15° toggle. Default visual: 12 horizontal rays from the source, halved at the first filter and rounded by `cos²Δθ` thereafter — discrete count makes the intensity drop legible. Optional E-field arrow overlay reveals polarisation direction (unpolarised = many fixed-angle arrows, polarised = single arrow along axis); when on, the rays fade to a ghost. Side-panel readouts use exact continuous `cos²Δθ`.

### 3.2 Wave-Particle Duality

- [x] **Double Slit (electrons mode)** — links to `?mode=electrons` of the 3.1 sim.
- [x] **Photoelectric Effect (idealised)** — `quantum/3-2wave-particle-duality/photoelectric-effect/`. Simulated apparatus only. Lamp has an on/off switch, λ slider (200–700 nm), intensity slider; sim runs continuously while the light is on (no play/pause/speed controls — this is an instrument, not an animation). Cathode metal chosen from a dropdown (Cs, Na, Ca, Mg, Zn, Cu). Battery polarity flips automatically with the V slider, which steps in 0.1 V from −3 to +3 V — polarity is unlabelled, students work out which sign retards from the physics. Show-toggles: photons, electrons, max-KE-only vs uniform [0, E_max] distribution, KE bars. Dropdown includes "Unknown" — work function fixed to Ca's value (2.87 eV) so the teacher can verify; students must measure to identify. All cathodes drawn in the same neutral grey so colour can't tell. No derived readouts anywhere: students read only `λ`, `V`, and `I` off the apparatus, compute `f = c/λ` and find `V_s` themselves (quantised to 0.1 V by the slider step). Current computed analytically (saturation in accelerating regime, linear ramp in retarding regime for the uniform distribution, sharp cutoff for max-KE-only). Realistic variant (ammeter noise, λ discretisation, dark current, contact-potential offset) to ship as a separate page.
- [x] **Electron Diffraction** — `quantum/3-2wave-particle-duality/electron-diffraction/`. G. P. Thomson style: thin polycrystalline target, end-on phosphor screen. V slider 500–5000 V steps of 100; rate slider for beam current. Target dropdown: Graphite (calibration, d-spacings shown), Unknown A (Al: 0.234, 0.143 nm), Unknown B (Si: 0.314, 0.192 nm). Single-electron mode flashes dots one at a time, fading over ~18 s, cap ~3500; Continuous mode renders the radially-symmetric intensity field. Toggles: faint wave-field overlay (only meaningful in single mode), labelled ring overlay, mm radial scale, projection light mode. λ = 1.2264 / √V nm; ring radius r = L·λ/d with L = 14 cm, screen radius 5 cm. No derived readouts — student sees V and the screen, measures r off the scale, computes λ themselves. Photon Momentum / Radiation Pressure and de Broglie Wavelength were dropped from the topic — ED is the duality capstone and exercises `λ = h/p` as a working tool rather than a separate calculator.

### 3.3 Structure of the Atom

- [x] **X-Ray Tube** — `quantum/3-3atomic-structure/x-ray-tube/`
- [ ] **Rutherford Scattering** — Fire alpha particles at a foil; toggle Thomson "plum pudding" vs nuclear model and watch back-scattering only appear in the latter. Vary `Z`, energy, impact parameter. Particle-flight visualisation similar to bullets mode in double-slit.
- [ ] **Bohr Model & Energy Levels** — Hydrogen atom diagram with levels `n = 1…∞`. Click a transition, see the photon emitted with the right colour and `λ`. Lyman/Balmer/Paschen series highlighted. Reuse `wavelengthToRGB` for photon colour.
- [ ] **Hydrogen Spectrum / Spectroscope** — Emission and absorption modes on a single grating-spectroscope view. Switch between H, He, Na, unknown; match lines to identify the unknown. Could share code with diffraction-grating (white-light mode with sparse spectrum).
- [ ] **Standing Waves on a Bohr Orbit** — de Broglie's electron-as-standing-wave around the nucleus. Drag `n`; watch the wave fit (or not) around the orbit. Bridges 3.2 and 3.3.
- [ ] **Franck–Hertz Experiment** — Accelerate electrons through mercury vapour, sweep `V`, watch current dip at each ~4.9 V interval. Schematic plus live `I(V)` plot.

### 3.4 Standard Model

User flagged that 3.4 sims are harder to make genuinely interactive. Probably ship three rather than five; prioritise these:

- [ ] **Decay Checker** — Propose a decay (e.g. `n → p + e⁻ + ν̄_e`, or a deliberately broken one); sim checks charge, baryon number, lepton number, energy. Green tick or red cross with the rule that fails. Drag-and-drop UI for building decays.
- [ ] **Hadron Builder** — Drag quarks (u, d, s, plus antis) into a bag; sim computes total charge and baryon number, tells you whether you've made a real meson/baryon (π⁺, K⁻, proton, Λ, …) or something forbidden.
- [ ] **Cloud Chamber ID** — Tracks curve in a `B` field; student measures radius and direction to deduce charge sign and (with given `p`) mass. Reuses the maths from 2.4. Feature pair-production "vee"s and beta-decay kinks.

Lower priority (consider only if the above land well):

- [ ] **Particle Zoo Explorer** — Clickable Standard Model chart. Filter by generation, by force-it-feels. Reference, not really interactive.
- [ ] **Feynman Diagram Builder** — Snap vertices for QED/weak processes. Reads off the interaction and mediating boson. Hard to design well; check with user before committing.

## When you're done with this file

Once all top-level items are ticked, Topic 3 is shipped. Move this file aside (rename to `TODO-topic3-done.md` or similar) and start a new one for the next topic.
