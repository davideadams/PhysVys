/* ═══════════════════════════════════════════════════════════════
   Eddy Currents & Magnetic Braking.

   Two modes:
     1. Guillotine — a conducting plate falls vertically through a horizontal
        band of magnetic field (the gap of a magnet). A second, free-falling
        ghost plate is shown beside it for comparison. The user can swap the
        right plate for a slotted version, in which the eddy-current loops
        are broken up and braking is much weaker.

     2. Metal detector — an airport walk-through gate, rendered in 3D with
        Three.js. Two pillars house transmit and receive coils; a person
        walks along the corridor between them. When metal in their hand
        enters the oscillating drive field, eddy currents are induced in
        it (Faraday); their reaction field opposes the change (Lenz) and
        is what the receive coil reads as a signal.

   Coordinate convention (scene is a 2-D side view):
     X to the right, Y down (canvas-style). Lengths in metres, scene-to-pixel
     scale is fixed each resize so the same ~70 cm of world height fits.

   Guillotine physics:
     The pole face presents a horizontal band of B = Bz (out of page) of
     vertical extent h_B. Only the part of the plate inside this band has
     flux through it: Φ(y) = B · w · overlap(y), where w is plate width.
       During entry  (top inside, bottom inside band):  dΦ/dt = +B w v
       Fully inside  (both edges inside band):          dΦ/dt = 0
       During exit   (top inside, bottom out)        :  dΦ/dt = -B w v
     EMF ε = dΦ/dt drives an eddy current i = ε / R around a loop on the
     plate face. The half of the loop that lies inside the field carries a
     current of length w through B, giving a Laplace force F = B i w opposing
     v. Combining: F_brake = (B² w² / R) · v · entryExitMask.
     R is bundled into a single tunable C_BRAKE so the demo lands at a
     visually-readable terminal velocity for the canonical settings.
═══════════════════════════════════════════════════════════════ */

const G = 9.81;
const SCENE_H_M = 0.70;          // world height shown in the canvas (m)

const state = {
  mode: 'guillotine',
  // Guillotine
  B: 1.20,
  material: 'al',                // 'cu' | 'al' | 'brass' | 'plastic'
  slotted: false,
  slowMo: false,
  showEddies: true,
  showFbrake: true,
  showFieldArrows: false,
  running: false,
  // Plates: y = top edge, in metres from scene top.
  freePlate:   { y: 0.05, v: 0 },
  brakedPlate: { y: 0.05, v: 0 },
  plateW: 0.10,                  // metres
  plateH: 0.16,
  // Magnet field band, vertical span [yTop, yBot] in metres.
  fieldTop: 0.34,
  fieldBot: 0.46,
  // Eddy-current visualisation phase.
  eddyPhase: 0,
  // Time-series of speeds.
  vBuf: [],                      // [{t, vF, vB}]
  tNow: 0,
  // Detector (airport walk-through gate)
  freq: 100,                     // real drive frequency in Hz
  target: 'keys',                // 'keys' | 'coin' | 'nothing'
  audioOn: false,
  personX: 0.08,                 // normalised canvas x (0..1) — left of gate
  walking: false,
  walkDir: +1,
  detectorPhase: 0,
  emfBuf: [],
  indBBuf: [],                   // signed induced-B history (∝ −dB_drive/dt)
  showIndBTrace: false,
  signal: 0,                     // smoothed signal level
};

/* Conductivity relative to copper. Real values ≈ Cu 5.96e7, Al 3.5e7,
   brass 1.5e7, plastic ~0 S/m. */
const MATERIAL_SIGMA = { cu: 1.00, al: 0.59, brass: 0.25, plastic: 0.0 };

const C_BRAKE = 22;              // bundles 1/R and plate geometry — tuned so
                                 // canonical Al at B = 1.2 T gives a clear,
                                 // visually-readable braking effect.
const M_PLATE = 0.04;            // kg
const TIME_WINDOW = 4.0;         // seconds, for graphs

/* ═══════════════════════════════════════════════════════════════
   Canvas + sizing
═══════════════════════════════════════════════════════════════ */
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let cssW = 0, cssH = 0, scale = 1; // scale: pixels per metre

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = rect.width;  cssH = rect.height;
  if (cssW < 2 || cssH < 2) return;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = cssH / SCENE_H_M;
}
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);

/* world (metres) → pixels.  Scene horizontally centred at cssW/2; world x = 0
   sits at the centre of the canvas. */
const xPx = xM => cssW / 2 + xM * scale;
const yPx = yM => yM * scale;

/* ═══════════════════════════════════════════════════════════════
   Guillotine physics
═══════════════════════════════════════════════════════════════ */
function plateOverlapsField(p) {
  const top = p.y;
  const bot = p.y + state.plateH;
  return Math.max(0, Math.min(bot, state.fieldBot) - Math.max(top, state.fieldTop));
}
function plateEdgeInBand(p) {
  // 1 if exactly one edge (top or bottom) lies inside the field band — i.e.
  // the plate is entering or exiting. 0 otherwise. We use a soft window so
  // the transition isn't a step.
  const top = p.y, bot = p.y + state.plateH;
  const fT = state.fieldTop, fB = state.fieldBot;
  const topIn = (top > fT && top < fB) ? 1 : 0;
  const botIn = (bot > fT && bot < fB) ? 1 : 0;
  return topIn ^ botIn;
}
function brakingMaskSigned(p) {
  // +1 entering (Φ increasing), −1 exiting, 0 otherwise.
  const top = p.y, bot = p.y + state.plateH;
  const fT = state.fieldTop, fB = state.fieldBot;
  const topIn = top > fT && top < fB;
  const botIn = bot > fT && bot < fB;
  if (botIn && !topIn) return +1;   // bottom edge inside, plate entering
  if (topIn && !botIn) return -1;   // top edge inside, plate exiting
  return 0;
}

function stepGuillotine(dt) {
  // Free-fall plate: dv/dt = g.
  if (state.running) {
    state.freePlate.v += G * dt;
    state.freePlate.y += state.freePlate.v * dt;
  }

  // Braked plate: dv/dt = g − k·v during entry/exit, just g otherwise.
  if (state.running) {
    const m = plateEdgeInBand(state.brakedPlate);
    const slotFactor = state.slotted ? 0.10 : 1.0;
    const sigma = MATERIAL_SIGMA[state.material] || 0;
    const k = C_BRAKE * state.B * state.B * sigma * slotFactor *
              state.plateW * state.plateW * m / M_PLATE;
    // Semi-implicit Euler on the linear drag term keeps it stable for any k.
    state.brakedPlate.v = (state.brakedPlate.v + G * dt) / (1 + k * dt);
    state.brakedPlate.y += state.brakedPlate.v * dt;
  }

  // Stop at the floor.
  const floor = SCENE_H_M - state.plateH - 0.02;
  for (const p of [state.freePlate, state.brakedPlate]) {
    if (p.y > floor) { p.y = floor; p.v = 0; }
  }
}

function emfBraked() {
  const sgn = brakingMaskSigned(state.brakedPlate);
  return sgn * state.B * state.plateW * state.brakedPlate.v;
}
function fBrake() {
  const m = plateEdgeInBand(state.brakedPlate);
  const slot = state.slotted ? 0.10 : 1.0;
  const sigma = MATERIAL_SIGMA[state.material] || 0;
  return C_BRAKE * state.B * state.B * sigma * slot *
         state.plateW * state.plateW * m * state.brakedPlate.v;
}

/* ═══════════════════════════════════════════════════════════════
   Guillotine drawing
═══════════════════════════════════════════════════════════════ */
function drawGuillotine() {
  ctx.clearRect(0, 0, cssW, cssH);

  // Floor strip.
  ctx.fillStyle = 'rgba(21,48,77,0.08)';
  ctx.fillRect(0, yPx(SCENE_H_M - 0.015), cssW, yPx(0.015));

  // Two columns: left for free-fall, right for braked plate.
  const colDX = 0.18;   // horizontal separation of the two columns (m)
  const leftX  = -colDX;
  const rightX = +colDX;

  // Right column: magnet pole behind plate.
  drawMagnet(rightX);

  // Optional B-field arrows out of page (dots).
  if (state.showFieldArrows) drawFieldDots(rightX);

  // Plates.
  drawPlate(leftX,  state.freePlate,   { ghost: true,  label: 'free fall' });
  drawPlate(rightX, state.brakedPlate, { ghost: false, label: 'braked'    });

  // Eddy currents on the right plate (none if the plate is an insulator).
  const conductive = (MATERIAL_SIGMA[state.material] || 0) > 0;
  if (state.showEddies && conductive) drawEddies(rightX, state.brakedPlate);

  // Force arrows on the right plate.
  if (state.showFbrake && conductive) drawForceArrows(rightX, state.brakedPlate);

  // Column labels at the top.
  ctx.fillStyle = '#55708d';
  ctx.font = '600 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('No magnet',   xPx(leftX),  18);
  ctx.fillText('Magnet on',   xPx(rightX), 18);
}

function drawMagnet(cx) {
  // A simple "pole face" rectangle behind the path of the plate. It extends
  // beyond the plate's width on both sides, and its vertical extent IS the
  // field band.
  const w = state.plateW * 1.8;
  const x = xPx(cx) - w * scale / 2;
  const y = yPx(state.fieldTop);
  const h = yPx(state.fieldBot - state.fieldTop);

  // Body.
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(245,158,11,0.55)');
  grad.addColorStop(1, 'rgba(245,158,11,0.32)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w * scale, h);

  // Border.
  ctx.strokeStyle = 'rgba(180,83,9,0.7)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w * scale, h);

  // "N" / "S" stamps so the pole reads as a magnet.
  ctx.fillStyle = '#7c2d12';
  ctx.font = '700 14px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', x + 14, y + h / 2);
  ctx.fillText('S', x + w * scale - 14, y + h / 2);
}

function drawFieldDots(cx) {
  const w = state.plateW * 1.8;
  const x0 = xPx(cx) - w * scale / 2;
  const x1 = xPx(cx) + w * scale / 2;
  const y0 = yPx(state.fieldTop);
  const y1 = yPx(state.fieldBot);
  ctx.fillStyle = 'rgba(99,102,241,0.85)';
  const step = 16;
  for (let yy = y0 + 10; yy < y1; yy += step) {
    for (let xx = x0 + 10; xx < x1; xx += step) {
      ctx.beginPath();
      ctx.arc(xx, yy, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(99,102,241,0.35)';
      ctx.lineWidth = 1;
      ctx.arc(xx, yy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawPlate(cx, p, opts) {
  const x = xPx(cx) - state.plateW * scale / 2;
  const y = yPx(p.y);
  const w = state.plateW * scale;
  const h = state.plateH * scale;

  // Plate body — light aluminium look.
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  if (opts.ghost) {
    grad.addColorStop(0, 'rgba(160,170,185,0.55)');
    grad.addColorStop(1, 'rgba(120,130,145,0.55)');
  } else {
    grad.addColorStop(0, 'rgba(220,224,232,0.95)');
    grad.addColorStop(0.5, 'rgba(248,250,255,0.95)');
    grad.addColorStop(1, 'rgba(196,202,212,0.95)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Border.
  ctx.strokeStyle = opts.ghost ? 'rgba(80,95,115,0.55)' : '#475569';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x, y, w, h);

  // Slots on the right plate when slotted.
  if (!opts.ghost && state.slotted && state.mode === 'guillotine') {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    const N = 4;
    for (let i = 1; i < N; i++) {
      const sx = x + (w * i) / N;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h * 0.78);
      ctx.stroke();
    }
  }
}

function drawEddies(cx, p) {
  // Eddies live on the plate's visible face and circulate around the boundary
  // between the in-field and out-of-field regions of the plate. Sign of the
  // current follows Lenz: entering → opposes increasing flux → clockwise as
  // seen by the viewer (since B is out of page, induced B is into page,
  // right-hand rule → CW current).
  const sgn = brakingMaskSigned(p);
  if (sgn === 0) return;

  const cxPx = xPx(cx);
  const x0 = cxPx - state.plateW * scale / 2;
  const w  = state.plateW * scale;
  const yTopP = yPx(p.y);
  const yBotP = yPx(p.y + state.plateH);
  // The horizontal "boundary line" inside the plate where flux changes.
  // For entry it's the field's top edge; for exit it's the field's bottom.
  const boundaryY = sgn > 0 ? yPx(state.fieldTop) : yPx(state.fieldBot);
  // Loop: from top of plate down to the boundary, full width.
  const loopTop = sgn > 0 ? yTopP : boundaryY;
  const loopBot = sgn > 0 ? boundaryY : yBotP;
  if (loopBot - loopTop < 6) return;

  // Slotted plates: draw N small loops side-by-side, each in its strip.
  const stripCount = state.slotted ? 4 : 1;
  const stripW = w / stripCount;

  // Drawing helpers.
  const intensity = Math.min(1, Math.abs(p.v) * 0.8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(245,158,11,${0.45 + 0.5 * intensity})`;
  ctx.fillStyle   = `rgba(245,158,11,${0.55 + 0.45 * intensity})`;

  for (let s = 0; s < stripCount; s++) {
    const sx0 = x0 + s * stripW + 6;
    const sx1 = x0 + (s + 1) * stripW - 6;
    if (sx1 - sx0 < 6) continue;

    // Rounded rectangle loop.
    const r = Math.min(8, (sx1 - sx0) / 2.5, (loopBot - loopTop) / 2.5);
    ctx.beginPath();
    roundRect(ctx, sx0, loopTop + 2, sx1 - sx0, loopBot - loopTop - 4, r);
    ctx.stroke();

    // Direction arrowheads — three around the loop, animated phase.
    // Lenz: entering (sgn=+1) → CW; exiting → CCW.
    const dir = sgn > 0 ? +1 : -1;
    drawArrowOnLoop(sx0, loopTop + 2, sx1 - sx0, loopBot - loopTop - 4, r,
                    dir, intensity);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawArrowOnLoop(x, y, w, h, r, dir, intensity) {
  // Walk a parametric perimeter. We just place arrows at four sample fractions
  // around the rectangle (top, right, bottom, left mid-points) — direction is
  // tangent to the perimeter, sign chosen by `dir`.
  const samples = [
    { px: x + w / 2, py: y,         tx: dir, ty: 0 },          // top, →
    { px: x + w,     py: y + h / 2, tx: 0,   ty: dir },         // right, ↓
    { px: x + w / 2, py: y + h,     tx: -dir, ty: 0 },          // bottom, ←
    { px: x,         py: y + h / 2, tx: 0,   ty: -dir },        // left, ↑
  ];
  // Animate by shifting which arrows are bright via state.eddyPhase.
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const lit = ((Math.floor(state.eddyPhase + i * 0.25) % 4) + 4) % 4;
    const a = lit === 0 ? 1.0 : 0.55;
    drawArrowHead(ctx, s.px, s.py, s.tx, s.ty, 7, a * (0.7 + 0.3 * intensity));
  }
}
function drawArrowHead(c, x, y, tx, ty, size, alpha) {
  const ang = Math.atan2(ty, tx);
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = `rgba(245,158,11,${alpha})`;
  c.beginPath();
  c.moveTo(size, 0);
  c.lineTo(-size * 0.6, size * 0.55);
  c.lineTo(-size * 0.6, -size * 0.55);
  c.closePath();
  c.fill();
  c.restore();
}

function drawForceArrows(cx, p) {
  const f = fBrake();
  if (Math.abs(f) < 1e-3) return;
  const cxPx = xPx(cx);
  const x = cxPx + state.plateW * scale / 2 + 8;
  const y = yPx(p.y + state.plateH / 2);
  const len = Math.min(80, 220 * Math.abs(f));
  // Brake force opposes velocity; plate falls down (+y), so brake points up.
  ctx.strokeStyle = '#15803d';
  ctx.fillStyle   = '#15803d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - len);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - len);
  ctx.lineTo(x - 5, y - len + 8);
  ctx.lineTo(x + 5, y - len + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#15803d';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('F_brake', x + 6, y - len / 2);
}

/* ═══════════════════════════════════════════════════════════════
   Metal detector mode — airport walk-through gate.

   Two pillars flank the walkway. The left pillar houses the transmit coil,
   running a drive current I_d = I0 · sin(2π f t), so the field across the
   gap is B_d(t) = B0 · sin(2π f t) pointing horizontally between pillars.

   When a person carrying metal walks through, the metal piece sees a
   coupled flux Φ_m(t) = κ(x) · B_d(t) · A_m, where κ(x) is the geometric
   coupling factor (peaks when the person is centred between the pillars).

     Faraday:  ε_m = -dΦ_m/dt  = -κ A_m B0 ω cos(ωt)
     Lenz:     the eddy current the EMF drives circulates so its own B
               field opposes the *change* in the driving field — when B_d
               is growing the induced B points the other way; when B_d
               is shrinking the induced B aids B_d. The swirl direction
               reverses every half-cycle.
     Receive:  the receive coil picks up the reaction flux from the eddy
               currents — proportional to κ² (coupling once in, once back
               out) and to the metal's conductivity-area product A_m.

   We feed this into the signal envelope and the EMF trace.
═══════════════════════════════════════════════════════════════ */
const TARGET_FACTOR = { keys: 1.20, coin: 0.55, nothing: 0.0 };

/* Real walk-through gates run at ~100 Hz–several kHz; at those speeds the
   field arrows would just blur. We slow the animation down by a fixed
   factor so the cycle reads visually. The signal physics is unchanged —
   only the on-screen oscillation rate. */
const FREQ_DISPLAY_SCALE = 50;   // 100 Hz drive → 2 Hz on screen

function stepDetector(dt) {
  state.detectorPhase += 2 * Math.PI * (state.freq / FREQ_DISPLAY_SCALE) * dt;

  // Auto-walk: traverse the walkway at constant speed, bouncing at the ends.
  if (state.walking) {
    const speed = 0.18;          // walkway-fractions per second
    state.personX += state.walkDir * speed * dt;
    if (state.personX > 0.95) { state.personX = 0.95; state.walkDir = -1; }
    if (state.personX < 0.05) { state.personX = 0.05; state.walkDir = +1; }
  }

  // Coupling κ: Gaussian centred at the gate (personX = 0.5). σ tuned so the
  // signal is meaningfully on for roughly the middle third of the walkway.
  const dx = state.personX - 0.5;
  const sigma = 0.13;
  const kappa = Math.exp(-(dx * dx) / (sigma * sigma));

  const drive    = Math.sin(state.detectorPhase);
  const dDrive   = Math.cos(state.detectorPhase);          // ∝ dB/dt
  const matFactor = TARGET_FACTOR[state.target] || 0;
  const reflected = kappa * kappa * matFactor;
  const emf      = 0.4 * drive + reflected * dDrive;

  // Smoothed signal envelope.
  state.signal = state.signal * 0.92 + reflected * 0.08;

  state.emfBuf.push({ t: state.tNow, v: emf });
  // B_ind is the reaction field from eddy currents in the metal. Its sign is
  // opposite dB/dt (Lenz), and it scales with κ²·material — i.e., the same
  // coupling as the reflected EMF component, so it goes to zero with no
  // metal or far from the gate.
  const indBSigned = -reflected * dDrive;
  state.indBBuf.push({ t: state.tNow, v: indBSigned });
  const cutoff = state.tNow - TIME_WINDOW - 0.2;
  while (state.emfBuf.length  && state.emfBuf[0].t  < cutoff) state.emfBuf.shift();
  while (state.indBBuf.length && state.indBBuf[0].t < cutoff) state.indBBuf.shift();

  if (state.audioOn && audioCtx) {
    audioGain.gain.setTargetAtTime(
      Math.min(0.25, state.signal * 0.6), audioCtx.currentTime, 0.05);
    audioOsc.frequency.setTargetAtTime(
      300 + state.signal * 800, audioCtx.currentTime, 0.05);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene for the airport gate.

   Coordinate convention (metres):
     X = across the walkway (between the two pillars). The drive B field
         points along ±X.
     Y = up.
     Z = along the walkway (the person's direction of travel).

   The scene is built once at startup. Each frame, renderDetector3D() syncs
   transforms / visibility / scaling from `state` and `state.detectorPhase`
   and renders. The inset overlay (top-right corner) is still drawn in 2D
   into its own canvas — it's a redundant close-up, not a second 3D view.
═══════════════════════════════════════════════════════════════ */
const threeRoot = document.getElementById('three-root');
const tScene  = new THREE.Scene();
tScene.background = new THREE.Color(0xeef6ff);

const tCamera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
const tCamTarget = new THREE.Vector3(0, 1.0, 0);
const tCamState  = { radius: 6.0, yaw: 0.55, pitch: 0.22 };

const tRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
tRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
threeRoot.appendChild(tRenderer.domElement);

tScene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.7));
const tDirLight = new THREE.DirectionalLight(0xffffff, 1.0);
tDirLight.position.set(2, 4, 3);
tScene.add(tDirLight);

const PILLAR_W = 0.36, PILLAR_H = 2.20, PILLAR_D = 0.50;
const GATE_HALF = 0.65;          // distance from walkway centreline to pillar
const WALK_RANGE = 2.5;          // ±metres the person walks along Z

// Floor + walkway strip --------------------------------------------------
{
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 12),
    new THREE.MeshStandardMaterial({ color: 0xd0dae8, roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  tScene.add(floor);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(GATE_HALF * 2 - 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0xb5c4d8, roughness: 0.9 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.001;
  tScene.add(strip);

  const grid = new THREE.GridHelper(10, 20, 0xa6bbd1, 0xc7d4e4);
  grid.position.y = 0.002;
  tScene.add(grid);
}

// Pillars ----------------------------------------------------------------
function buildPillar(side, accentHex) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(PILLAR_W, PILLAR_H, PILLAR_D),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55 }),
  );
  body.position.y = PILLAR_H / 2;
  group.add(body);

  // Coil rings on the inner face (ring axis along ±X so flux emerges
  // horizontally toward the walkway).
  const ringMat = new THREE.MeshStandardMaterial({
    color: accentHex, metalness: 0.3, roughness: 0.45,
    emissive: accentHex, emissiveIntensity: 0.05,
  });
  const innerX = -side * (PILLAR_W / 2 + 0.005);   // small offset just inside
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.012, 8, 32),
      ringMat,
    );
    ring.position.set(innerX, 0.55 + i * 0.32, 0);
    ring.rotation.y = Math.PI / 2;       // axis = X
    group.add(ring);
  }
  group.position.x = side * GATE_HALF;
  return group;
}
const pillarL = buildPillar(-1, 0x0d9488);   // transmit (teal)
const pillarR = buildPillar(+1, 0xc2410c);   // receive (orange)
tScene.add(pillarL);
tScene.add(pillarR);

/* Per-camera visibility. Three.js renders an object only when
   (object.layers.mask & camera.layers.mask) !== 0. Default is layer 0 for
   everything. We move "main-only" props (pillars, lamp) to layer 1, then
   enable layer 1 on the main camera and leave the inset camera on layer 0
   alone — so the inset camera frames just the metal/effects/person/floor
   without the gate hardware blocking the view. */
const LAYER_MAIN_ONLY = 1;
function setLayerRecursive(obj, layer) {
  obj.layers.set(layer);
  obj.traverse(child => child.layers.set(layer));
}
setLayerRecursive(pillarL, LAYER_MAIN_ONLY);
setLayerRecursive(pillarR, LAYER_MAIN_ONLY);

// Drive field arrows across the gap --------------------------------------
const fieldArrows = [];
const fieldArrowsGroup = new THREE.Group();
{
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6366f1 });
  const ARROW_LEN = 2 * GATE_HALF - 0.32;
  const SHAFT_R   = 0.012;
  const HEAD_LEN  = 0.10, HEAD_R = 0.04;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, ARROW_LEN, 8),
        arrowMat,
      );
      shaft.rotation.z = Math.PI / 2;     // along X
      g.add(shaft);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(HEAD_R, HEAD_LEN, 14),
        arrowMat,
      );
      head.rotation.z = -Math.PI / 2;     // tip at +X
      head.position.x = ARROW_LEN / 2 + HEAD_LEN / 2;
      g.add(head);
      g.position.set(0, 0.65 + r * 0.45, -0.35 + c * 0.35);
      fieldArrowsGroup.add(g);
      fieldArrows.push(g);
    }
  }
}
tScene.add(fieldArrowsGroup);

// Person -----------------------------------------------------------------
const personGroup = new THREE.Group();
{
  const skinMat  = new THREE.MeshStandardMaterial({ color: 0xfbcfa2, roughness: 0.7 });
  const torsoMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
  const legsMat  = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), skinMat);
  head.position.y = 1.70;
  personGroup.add(head);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.85, 18), torsoMat);
  torso.position.y = 1.10;
  personGroup.add(torso);

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.65, 12), legsMat);
  legs.position.y = 0.33;
  personGroup.add(legs);

  // Right arm angled down-and-out so the metal item sits at the bottom end.
  // Cylinder default axis is +Y; rotation.z = -2.54 rad sends the +Y end to
  // direction (sin(2.54), cos(2.54), 0) ≈ (0.565, −0.825, 0). Combined with
  // the centre below, that puts the arm's lower end around (0.37, 1.01) —
  // right where the coin/key disc lives.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.50, 10), torsoMat);
  arm.position.set(0.23, 1.22, 0.05);
  arm.rotation.z = -2.54;
  personGroup.add(arm);
  // No hand sphere — the metal disc plays that role and was previously
  // hidden inside it.
}
tScene.add(personGroup);

// Metal item + induced effects -------------------------------------------
// metalGroup holds: the model (rebuildable), the eddy ring + arrows, and
// the induced-B arrow. Effects are added once and kept; only the model is
// torn down/rebuilt when the user changes target.
const metalGroup        = new THREE.Group();
const metalModelGroup   = new THREE.Group();
const metalEffectsGroup = new THREE.Group();
metalGroup.add(metalModelGroup);
metalGroup.add(metalEffectsGroup);
tScene.add(metalGroup);

let currentMetalKind = null;
function buildMetalItem3D(kind) {
  metalModelGroup.clear();
  if (kind === 'coin') {
    // A clearly disc-shaped coin: thin cylinder, decent radius, normal along
    // X so flux through the face matches the drive B direction.
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24, metalness: 0.75, roughness: 0.32,
    });
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.010, 36), coinMat,
    );
    coin.rotation.z = Math.PI / 2;       // disc axis along X (matches B)
    metalModelGroup.add(coin);
  } else if (kind === 'keys') {
    // Key ring as a flat washer (RingGeometry), normal along X to match the
    // B-field axis. Two blade keys hang off it.
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x71717a, metalness: 0.7, roughness: 0.4,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.075, 36), ringMat,
    );
    ring.rotation.y = Math.PI / 2;       // ring lies in YZ plane, normal = X
    metalModelGroup.add(ring);

    const keyMat = new THREE.MeshStandardMaterial({
      color: 0xa1a1aa, metalness: 0.6, roughness: 0.45,
    });
    const k1 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.025, 0.11), keyMat);
    k1.position.set(0, 0, 0.10);
    metalModelGroup.add(k1);
    const k2 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.020, 0.085), keyMat);
    k2.position.set(0, -0.025, 0.085);
    k2.rotation.x = 0.12;
    metalModelGroup.add(k2);
  }
  currentMetalKind = kind;
}
buildMetalItem3D('keys');

// Eddy ring (sits in the YZ plane: axis = X = direction of B).
const eddyMat = new THREE.MeshStandardMaterial({
  color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.45, roughness: 0.4,
});
const EDDY_R = 0.13;
const eddyRing = new THREE.Mesh(new THREE.TorusGeometry(EDDY_R, 0.006, 10, 36), eddyMat);
eddyRing.rotation.y = Math.PI / 2;     // axis = X
metalEffectsGroup.add(eddyRing);

// Two pre-built sets of arrowheads orbiting the ring — one CW, one CCW
// (when viewed looking along +X). Toggle visibility based on sign(dB/dt).
const N_EDDY_ARROWS = 6;
function buildEddyArrowSet(dirSign) {
  const g = new THREE.Group();
  const arrowGeo = new THREE.ConeGeometry(0.018, 0.05, 12);
  for (let i = 0; i < N_EDDY_ARROWS; i++) {
    const theta = (i / N_EDDY_ARROWS) * Math.PI * 2;
    const cone = new THREE.Mesh(arrowGeo, eddyMat);
    cone.position.set(0, EDDY_R * Math.cos(theta), EDDY_R * Math.sin(theta));
    const tangent = new THREE.Vector3(
      0, -Math.sin(theta), Math.cos(theta),
    ).multiplyScalar(dirSign);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    g.add(cone);
  }
  return g;
}
const eddyForward = buildEddyArrowSet(+1);
const eddyReverse = buildEddyArrowSet(-1);
metalEffectsGroup.add(eddyForward);
metalEffectsGroup.add(eddyReverse);

// Induced-B arrow at the centre of the ring, pointing along ±X.
const indBMat = new THREE.MeshStandardMaterial({ color: 0x15803d });
const indBShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.18, 10), indBMat,
);
indBShaft.rotation.z = Math.PI / 2;    // shaft along X
indBShaft.position.x = 0.09;
const indBHead = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 14), indBMat);
indBHead.rotation.z = -Math.PI / 2;
indBHead.position.x = 0.22;
const indBGroup = new THREE.Group();
indBGroup.add(indBShaft);
indBGroup.add(indBHead);
metalEffectsGroup.add(indBGroup);

// Signal lamp on top of the receive pillar -------------------------------
const lampMat = new THREE.MeshStandardMaterial({
  color: 0xdc2626, emissive: 0xdc2626, emissiveIntensity: 0.2,
});
const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 14), lampMat);
lamp.position.set(GATE_HALF, PILLAR_H + 0.12, 0);
tScene.add(lamp);
setLayerRecursive(lamp, LAYER_MAIN_ONLY);

// Camera helpers ---------------------------------------------------------
// Main camera renders layer 0 (default, shared) AND layer 1 (main-only).
// The inset camera is left on layer 0 only.
tCamera.layers.enable(LAYER_MAIN_ONLY);

function updateThreeCamera() {
  const r = tCamState.radius;
  const p = tCamState.pitch;
  const y = tCamState.yaw;
  tCamera.position.set(
    tCamTarget.x + r * Math.cos(p) * Math.sin(y),
    tCamTarget.y + r * Math.sin(p),
    tCamTarget.z + r * Math.cos(p) * Math.cos(y),
  );
  tCamera.up.set(0, 1, 0);
  tCamera.lookAt(tCamTarget);
}
updateThreeCamera();

// Hit-testing for the person (click-and-drag along Z).
const tRaycaster = new THREE.Raycaster();
const tNdc = new THREE.Vector2();
const personDragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
const personHit = new THREE.Vector3();

function tNdcFromEvent(e) {
  const rect = tRenderer.domElement.getBoundingClientRect();
  tNdc.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  tNdc.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}
function hitsPerson(e) {
  tNdcFromEvent(e);
  tRaycaster.setFromCamera(tNdc, tCamera);
  return tRaycaster.intersectObject(personGroup, true).length > 0;
}
function personZFromPointer(e) {
  tNdcFromEvent(e);
  tRaycaster.setFromCamera(tNdc, tCamera);
  if (!tRaycaster.ray.intersectPlane(personDragPlane, personHit)) return null;
  return Math.max(-WALK_RANGE, Math.min(WALK_RANGE, personHit.z));
}

// Per-frame sync + render ------------------------------------------------
function renderDetector3D() {
  // Resize.
  const w = threeRoot.clientWidth, h = threeRoot.clientHeight;
  if (w >= 2 && h >= 2) {
    tCamera.aspect = w / h;
    tCamera.updateProjectionMatrix();
    tRenderer.setSize(w, h, false);
  }

  // Phases / drive.
  const drive  = Math.sin(state.detectorPhase);          // ∝ B
  const dDrive = Math.cos(state.detectorPhase);          // ∝ dB/dt

  // Person Z from state.personX (0..1) — straight linear remap.
  const personZ = (state.personX - 0.5) * 2 * WALK_RANGE;
  personGroup.position.set(0, 0, personZ);

  // Metal item rides at the hand position. Hand is at (0.36, 1.02, 0.05) in
  // person-local coordinates; we mirror that onto the world.
  metalGroup.position.set(0.36, 1.02, personZ + 0.05);
  if (state.target !== currentMetalKind && state.target !== 'nothing') {
    buildMetalItem3D(state.target);
  }
  metalGroup.visible = state.target !== 'nothing';

  // Drive field arrows: scale.x = drive (signed). 0 → invisible, ±1 → full.
  const mag = Math.abs(drive);
  fieldArrowsGroup.visible = mag > 0.04;
  for (const a of fieldArrows) a.scale.set(drive, 1, 1);

  // Eddy direction: induced B opposes dB/dt → CW vs CCW around +X.
  const showEddy = state.signal > 0.02;
  metalEffectsGroup.visible = showEddy && state.target !== 'nothing';
  if (showEddy) {
    eddyForward.visible = dDrive < 0;
    eddyReverse.visible = dDrive >= 0;

    // Induced-B arrow length tracks |dB/dt|; flip direction with sign.
    const indMag = Math.min(1, Math.abs(dDrive));
    indBGroup.visible = indMag > 0.02;
    indBGroup.scale.x = dDrive >= 0 ? -indMag : +indMag;
  }

  // Lamp emissive pulses with signal envelope.
  const lvl = Math.min(1, state.signal / 0.8);
  lampMat.emissiveIntensity = 0.2 + 1.4 * lvl;

  tRenderer.render(tScene, tCamera);

  // 3D inset (close-up of the metal + eddy + induced-B), same scene.
  renderInset3D();
}

/* ── 3D inset (second WebGL renderer sharing tScene) ────────────────
   Frames the metal item up close from a fixed offset so the world-X axis
   (= drive B = induced B axis) reads as a clear horizontal direction in
   the inset view. The camera follows the metal each frame. */
const insetPanel  = document.getElementById('inset-panel');
const insetCanvas = document.getElementById('inset-canvas');
const tInsetRenderer = new THREE.WebGLRenderer({
  canvas: insetCanvas, antialias: true, alpha: true,
});
tInsetRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
tInsetRenderer.setClearColor(0xffffff, 0);
const tInsetCamera = new THREE.PerspectiveCamera(28, 1, 0.01, 5);

function renderInset3D() {
  const w = insetCanvas.clientWidth, h = insetCanvas.clientHeight;
  if (w >= 2 && h >= 2) {
    tInsetCamera.aspect = w / h;
    tInsetCamera.updateProjectionMatrix();
    tInsetRenderer.setSize(w, h, false);
  }
  // Fixed offset from the metal item: a 3/4 view from forward-and-above
  // that shows the world X axis clearly across the screen, with the eddy
  // ring's plane (YZ) tilted enough to read as a circle, not a line.
  const m = metalGroup.position;
  tInsetCamera.position.set(m.x + 0.45, m.y + 0.20, m.z + 0.55);
  tInsetCamera.up.set(0, 1, 0);
  tInsetCamera.lookAt(m.x, m.y, m.z);
  tInsetRenderer.render(tScene, tInsetCamera);
}

/* ═══════════════════════════════════════════════════════════════
   Drag handling
═══════════════════════════════════════════════════════════════ */
const drag = { kind: null, plate: null, offset: 0 };

// Guillotine drag (2D canvas) ------------------------------------------
canvas.addEventListener('pointerdown', e => {
  if (state.mode !== 'guillotine') return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  const plates = [
    { p: state.freePlate,   cx: -0.18 },
    { p: state.brakedPlate, cx: +0.18 },
  ];
  for (const { p, cx } of plates) {
    const x = xPx(cx) - state.plateW * scale / 2;
    const y = yPx(p.y);
    const w = state.plateW * scale;
    const h = state.plateH * scale;
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      drag.kind = 'plate';
      drag.plate = p;
      drag.offset = py - y;
      canvas.setPointerCapture(e.pointerId);
      state.running = false;
      const btn = document.getElementById('btn-drop');
      btn.classList.remove('playing');
      btn.textContent = '▶ Drop';
      return;
    }
  }
});
canvas.addEventListener('pointermove', e => {
  if (drag.kind !== 'plate' || !drag.plate) return;
  const rect = canvas.getBoundingClientRect();
  const py = e.clientY - rect.top;
  const newY = (py - drag.offset) / scale;
  drag.plate.y = Math.max(0, Math.min(SCENE_H_M - state.plateH - 0.02, newY));
  drag.plate.v = 0;
});
function endCanvasDrag(e) {
  if (drag.kind === 'plate') {
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    drag.kind = null; drag.plate = null;
  }
}
canvas.addEventListener('pointerup', endCanvasDrag);
canvas.addEventListener('pointerleave', endCanvasDrag);

// Detector drag (three.js scene): drag person along the walkway, or orbit
// the camera if the click misses. Wheel zooms the camera radius.
const orbit = { lx: 0, ly: 0 };
threeRoot.style.cursor = 'grab';
threeRoot.addEventListener('pointerdown', e => {
  if (state.mode !== 'detector') return;
  if (hitsPerson(e)) {
    drag.kind = 'person3d';
    state.walking = false;
    document.getElementById('btn-walk').classList.remove('playing');
    const z = personZFromPointer(e);
    if (z !== null) state.personX = 0.5 + z / (2 * WALK_RANGE);
    threeRoot.style.cursor = 'ew-resize';
  } else {
    drag.kind = 'orbit';
    orbit.lx = e.clientX; orbit.ly = e.clientY;
    threeRoot.style.cursor = 'grabbing';
  }
  threeRoot.setPointerCapture(e.pointerId);
});
threeRoot.addEventListener('pointermove', e => {
  if (drag.kind === 'person3d') {
    const z = personZFromPointer(e);
    if (z !== null) state.personX = 0.5 + z / (2 * WALK_RANGE);
  } else if (drag.kind === 'orbit') {
    const dx = e.clientX - orbit.lx;
    const dy = e.clientY - orbit.ly;
    orbit.lx = e.clientX; orbit.ly = e.clientY;
    tCamState.yaw -= dx * 0.008;
    const LIM = Math.PI / 2 - 0.05;
    tCamState.pitch = Math.max(-LIM, Math.min(LIM, tCamState.pitch - dy * 0.006));
    updateThreeCamera();
  }
});
function endThreeDrag(e) {
  if (drag.kind === 'person3d' || drag.kind === 'orbit') {
    if (e && e.pointerId !== undefined && threeRoot.hasPointerCapture(e.pointerId)) {
      threeRoot.releasePointerCapture(e.pointerId);
    }
    drag.kind = null;
    threeRoot.style.cursor = 'grab';
  }
}
threeRoot.addEventListener('pointerup', endThreeDrag);
threeRoot.addEventListener('pointerleave', endThreeDrag);
threeRoot.addEventListener('wheel', e => {
  if (state.mode !== 'detector') return;
  e.preventDefault();
  tCamState.radius = Math.max(2.0, Math.min(15, tCamState.radius + e.deltaY * 0.005));
  updateThreeCamera();
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   Side widgets: v(t) graph & detector graph
═══════════════════════════════════════════════════════════════ */
const vCanvas = document.getElementById('v-graph');
const vCtx    = vCanvas.getContext('2d');
const emfCanvas = document.getElementById('emf-graph');
const emfCtx    = emfCanvas.getContext('2d');
const meterCanvas = document.getElementById('meter');
const meterCtx    = meterCanvas.getContext('2d');

function drawVGraph() {
  const W = vCanvas.width, H = vCanvas.height;
  vCtx.clearRect(0, 0, W, H);
  const padL = 30, padR = 8, padT = 8, padB = 16;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  vCtx.fillStyle = 'rgba(255,255,255,0.6)';
  vCtx.fillRect(padL, padT, plotW, plotH);

  let vMax = 0.5;
  for (const p of state.vBuf) {
    if (p.vF > vMax) vMax = p.vF;
    if (p.vB > vMax) vMax = p.vB;
  }
  vMax *= 1.15;

  // Grid + zero.
  vCtx.strokeStyle = 'rgba(21,48,77,0.18)';
  vCtx.lineWidth = 1;
  vCtx.beginPath();
  vCtx.moveTo(padL, padT + plotH); vCtx.lineTo(padL + plotW, padT + plotH);
  vCtx.stroke();

  vCtx.fillStyle = '#55708d';
  vCtx.font = '9px "Trebuchet MS", sans-serif';
  vCtx.textAlign = 'right';
  vCtx.textBaseline = 'middle';
  vCtx.fillText(vMax.toFixed(1), padL - 3, padT);
  vCtx.fillText('0',             padL - 3, padT + plotH);
  vCtx.textAlign = 'center'; vCtx.textBaseline = 'top';
  vCtx.fillText('−' + TIME_WINDOW.toFixed(0) + ' s', padL, padT + plotH + 2);
  vCtx.fillText('now', padL + plotW, padT + plotH + 2);

  function trace(key, color) {
    if (state.vBuf.length < 2) return;
    vCtx.strokeStyle = color;
    vCtx.lineWidth = 1.8;
    vCtx.beginPath();
    let first = true;
    for (const p of state.vBuf) {
      const tFrac = (p.t - (state.tNow - TIME_WINDOW)) / TIME_WINDOW;
      if (tFrac < 0 || tFrac > 1) continue;
      const x = padL + plotW * tFrac;
      const y = padT + plotH * (1 - p[key] / vMax);
      if (first) { vCtx.moveTo(x, y); first = false; } else vCtx.lineTo(x, y);
    }
    vCtx.stroke();
  }
  trace('vF', '#9ca3af');
  trace('vB', '#dc2626');
}

function drawEmfGraph() {
  const W = emfCanvas.width, H = emfCanvas.height;
  emfCtx.clearRect(0, 0, W, H);
  const padL = 8, padR = 8, padT = 6, padB = 6;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  emfCtx.fillStyle = 'rgba(255,255,255,0.6)';
  emfCtx.fillRect(padL, padT, plotW, plotH);
  emfCtx.strokeStyle = 'rgba(21,48,77,0.18)';
  emfCtx.lineWidth = 1;
  emfCtx.beginPath();
  emfCtx.moveTo(padL, padT + plotH / 2);
  emfCtx.lineTo(padL + plotW, padT + plotH / 2);
  emfCtx.stroke();

  // Both traces share the same y-scale so the phase relationship reads
  // correctly. ε is sin-dominated with amplitude ≈ 0.4 + reflected; B_ind
  // is ∝ −cos with amplitude = reflected. The 0.4 fixed drive pickup means
  // ε is always larger than B_ind, so this scale shows both clearly.
  const yScale = plotH / 2.4;
  const yMid   = padT + plotH / 2;

  function plotTrace(buf, color, width) {
    if (buf.length < 2) return;
    emfCtx.strokeStyle = color;
    emfCtx.lineWidth = width;
    emfCtx.beginPath();
    let first = true;
    for (const p of buf) {
      const tFrac = (p.t - (state.tNow - TIME_WINDOW)) / TIME_WINDOW;
      if (tFrac < 0 || tFrac > 1) continue;
      const x = padL + plotW * tFrac;
      const y = yMid - p.v * yScale;
      if (first) { emfCtx.moveTo(x, y); first = false; } else emfCtx.lineTo(x, y);
    }
    emfCtx.stroke();
  }

  // B_ind drawn first so the EMF (red) sits on top — easier to read.
  if (state.showIndBTrace) plotTrace(state.indBBuf, '#15803d', 1.4);
  plotTrace(state.emfBuf, '#dc2626', 1.6);

  // In-graph legend when both traces are showing.
  if (state.showIndBTrace) {
    emfCtx.font = '700 10px "Trebuchet MS", sans-serif';
    emfCtx.textBaseline = 'top';
    emfCtx.textAlign = 'left';
    emfCtx.fillStyle = '#dc2626';
    emfCtx.fillText('ε',     padL + 6, padT + 4);
    emfCtx.fillStyle = '#15803d';
    emfCtx.fillText('B_ind', padL + 24, padT + 4);
  }
}

function drawMeter() {
  const W = meterCanvas.width, H = meterCanvas.height;
  meterCtx.clearRect(0, 0, W, H);
  const pad = 8;
  meterCtx.fillStyle = 'rgba(21,48,77,0.07)';
  meterCtx.fillRect(pad, pad, W - 2 * pad, H - 2 * pad);
  const lvl = Math.min(1, state.signal / 1.0);
  const grad = meterCtx.createLinearGradient(pad, 0, W - pad, 0);
  grad.addColorStop(0,   '#10b981');
  grad.addColorStop(0.6, '#f59e0b');
  grad.addColorStop(1,   '#dc2626');
  meterCtx.fillStyle = grad;
  meterCtx.fillRect(pad, pad, (W - 2 * pad) * lvl, H - 2 * pad);
  meterCtx.fillStyle = '#15304d';
  meterCtx.font = '700 12px "Trebuchet MS", sans-serif';
  meterCtx.textAlign = 'right';
  meterCtx.textBaseline = 'middle';
  meterCtx.fillText((lvl * 100).toFixed(0) + ' %', W - pad - 6, H / 2);
}

/* ═══════════════════════════════════════════════════════════════
   Readouts
═══════════════════════════════════════════════════════════════ */
function fmtV(v) { return v.toFixed(2) + ' m/s'; }
function fmtEmf(e) {
  const a = Math.abs(e);
  if (a < 1e-3) return (e * 1e6).toFixed(1) + ' µV';
  if (a < 1)    return (e * 1e3).toFixed(2) + ' mV';
  return e.toFixed(2) + ' V';
}
function fmtN(f) {
  const a = Math.abs(f);
  if (a < 1e-3) return (f * 1e3).toFixed(1) + ' mN';
  return f.toFixed(2) + ' N';
}
function updateReadouts() {
  if (state.mode !== 'guillotine') return;
  document.getElementById('rd-vf').textContent  = fmtV(state.freePlate.v);
  document.getElementById('rd-vb').textContent  = fmtV(state.brakedPlate.v);
  document.getElementById('rd-emf').textContent = fmtEmf(emfBraked());
  document.getElementById('rd-fb').textContent  = fmtN(fBrake());
}

/* ═══════════════════════════════════════════════════════════════
   UI wiring
═══════════════════════════════════════════════════════════════ */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function updateSceneVisibility() {
  const det = state.mode === 'detector';
  canvas.hidden     = det;       // 2D guillotine canvas
  threeRoot.hidden  = !det;      // 3D main view
  insetPanel.hidden = !det;      // 3D inset panel
}

document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.val;
    setActive('#seg-mode', btn);
    document.querySelectorAll('.mode-block').forEach(blk => {
      blk.hidden = blk.dataset.mode !== state.mode;
    });
    document.getElementById('scene-note').innerHTML =
      state.mode === 'guillotine'
        ? 'Press <strong>▶ Drop</strong> · drag a plate to reposition'
        : 'Drag the <strong>person</strong> through the gate · drag empty space to orbit · scroll to zoom';
    updateSceneVisibility();
    resetGuillotine();
    state.emfBuf.length = 0;
    state.vBuf.length = 0;
  });
});

document.querySelectorAll('#seg-slot .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.slotted = btn.dataset.val === 'slotted';
    setActive('#seg-slot', btn);
  });
});

document.querySelectorAll('#seg-target .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.target = btn.dataset.val;
    setActive('#seg-target', btn);
  });
});

function wireSlider(id, valId, onChange, digits = 2) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  function fmt(v) { return digits === 0 ? Math.round(v).toString() : v.toFixed(digits); }
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.value = fmt(v);
    onChange(v);
  });
  vl.addEventListener('change', () => {
    let v = parseFloat(vl.value);
    if (isNaN(v)) { vl.value = fmt(parseFloat(el.value)); return; }
    const min = parseFloat(el.min), max = parseFloat(el.max);
    v = Math.max(min, Math.min(max, v));
    el.value = v;
    v = parseFloat(el.value);
    vl.value = fmt(v);
    onChange(v);
  });
}
wireSlider('slider-B',    'val-B',    v => { state.B = v; }, 2);
wireSlider('slider-freq', 'val-freq', v => { state.freq = v; }, 0);

document.querySelectorAll('#seg-material .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.material = btn.dataset.val;
    setActive('#seg-material', btn);
  });
});

function wireToggle(id, prop) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[prop] = !state[prop];
    btn.classList.toggle('active', state[prop]);
  });
}
wireToggle('btn-eddies',      'showEddies');
wireToggle('btn-fbrake',      'showFbrake');
wireToggle('btn-fieldarrows', 'showFieldArrows');
wireToggle('btn-show-indB',   'showIndBTrace');

function resetGuillotine() {
  state.running = false;
  state.freePlate.y = 0.05;   state.freePlate.v = 0;
  state.brakedPlate.y = 0.05; state.brakedPlate.v = 0;
  state.tNow = 0; state.vBuf.length = 0;
  const btn = document.getElementById('btn-drop');
  btn.classList.remove('playing');
  btn.textContent = '▶ Drop';
}

document.getElementById('btn-drop').addEventListener('click', () => {
  // If both plates are at the floor, restart from the top first.
  const floor = SCENE_H_M - state.plateH - 0.02 - 0.001;
  if (state.freePlate.y >= floor && state.brakedPlate.y >= floor) {
    state.freePlate.y = 0.05;   state.freePlate.v = 0;
    state.brakedPlate.y = 0.05; state.brakedPlate.v = 0;
    state.tNow = 0; state.vBuf.length = 0;
  }
  state.running = !state.running;
  const btn = document.getElementById('btn-drop');
  btn.classList.toggle('playing', state.running);
  btn.textContent = state.running ? '■ Pause' : '▶ Drop';
});
document.getElementById('btn-reset').addEventListener('click', resetGuillotine);

document.getElementById('btn-walk').addEventListener('click', () => {
  state.walking = !state.walking;
  const btn = document.getElementById('btn-walk');
  btn.classList.toggle('playing', state.walking);
});
document.getElementById('btn-slowmo').addEventListener('click', () => {
  state.slowMo = !state.slowMo;
  const btn = document.getElementById('btn-slowmo');
  btn.classList.toggle('playing', state.slowMo);
});

/* ── Audio (detector mode) ────────────────────────────────── */
let audioCtx = null, audioOsc = null, audioGain = null;
document.getElementById('btn-audio').addEventListener('click', () => {
  state.audioOn = !state.audioOn;
  const btn = document.getElementById('btn-audio');
  btn.textContent = state.audioOn ? 'Sound on' : 'Sound off';
  btn.classList.toggle('playing', state.audioOn);
  if (state.audioOn && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioOsc = audioCtx.createOscillator();
    audioGain = audioCtx.createGain();
    audioOsc.type = 'sine';
    audioOsc.frequency.value = 400;
    audioGain.gain.value = 0;
    audioOsc.connect(audioGain).connect(audioCtx.destination);
    audioOsc.start();
  } else if (!state.audioOn && audioGain) {
    audioGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  }
});

/* ═══════════════════════════════════════════════════════════════
   Render loop
═══════════════════════════════════════════════════════════════ */
let lastT = performance.now();
function loop(tMs) {
  const dt = Math.min(0.05, Math.max(0.001, (tMs - lastT) / 1000));
  lastT = tMs;
  state.tNow += dt;
  state.eddyPhase += dt * 8;       // ~8 Hz arrow chase

  if (state.mode === 'guillotine') {
    // Slow-mo scales physics dt only; the wall-clock and arrow-chase keep
    // running at full speed so direction stays readable.
    stepGuillotine(state.slowMo ? dt * 0.1 : dt);
    state.vBuf.push({ t: state.tNow, vF: state.freePlate.v, vB: state.brakedPlate.v });
    const cutoff = state.tNow - TIME_WINDOW - 0.2;
    while (state.vBuf.length && state.vBuf[0].t < cutoff) state.vBuf.shift();
    drawGuillotine();
    drawVGraph();
    updateReadouts();
  } else {
    stepDetector(dt);
    renderDetector3D();
    drawEmfGraph();
    drawMeter();
  }

  requestAnimationFrame(loop);
}

resize();
updateSceneVisibility();
requestAnimationFrame(loop);
