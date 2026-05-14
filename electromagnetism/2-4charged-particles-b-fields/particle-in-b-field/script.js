/* ═══════════════════════════════════════════════════════════════
   Charged particle in a uniform B field — 2D canvas sim.

   Physics:
     B is perpendicular to the page (⊙ out / ⊗ in).
     F = qv × B is always perpendicular to v, so |v| is constant
     and motion is circular, with
       r = m v / |q| B,    T = 2π m / |q| B,    |F| = |q| v B.

   Coordinate convention (canvas, y increases DOWNWARD):
     For B "into the page" (⊗) we treat B = +ẑ in canvas frame, giving
     a = (qB/m) (vy, −vx).   That puts a positive charge moving +x in
     B(into page) curving upward (canvas −y) — the standard textbook
     direction.  "Out of the page" flips this with a sign on B.
═══════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const SPEED_SCALE = 50;        // px/sec per abstract speed unit
const FORCE_SCALE = 12;        // visual length scaling for the F arrow
const PX_PER_M    = 2500;      // canvas pixels per real metre  (=> 25 px/cm)

// Largest radius that still fits comfortably inside the canvas.
const MAX_R = Math.min(W, H) / 2 - 30;
const MAX_R_M = MAX_R / PX_PER_M;   // same limit in metres for real-units mode

const FIELD_BOUNDARY_X = 240;  // x at which the B field begins, 'left' mode

const COLOUR_POS = '#dc2626';
const COLOUR_NEG = '#2563eb';
const COLOUR_FIELD = 'rgba(37, 99, 235, 0.75)';
const COLOUR_TRAIL = 'rgba(15, 118, 110, 0.7)';
const COLOUR_VEL   = '#0f766e';
const COLOUR_FORCE = '#15803d';

// Real-particle presets used in 'real' units mode.
// `timeScale` slows the cyclotron motion so default settings produce on-screen
// |v| and |F| arrow lengths close to the abstract default (≈ 36 px and 72 px)
// and a period of roughly 1.5–2.5 s — i.e. so the real mode doesn't feel
// noticeably slower than the abstract one.  Heavier particles need a larger
// scale because their natural ω is much smaller than the electron's.
const PARTICLES = {
  electron: { m: 9.10938e-31, q: -1.602e-19, label: 'e⁻',  vDefault: 5,  BDefault: 2,    vMax: 15, BMax: 30,   timeScale: 1.2e-8 },
  proton:   { m: 1.67262e-27, q: +1.602e-19, label: 'p⁺',  vDefault: 2,  BDefault: 600,  vMax: 5,  BMax: 3000, timeScale: 4.5e-8 },
  alpha:    { m: 6.6447e-27,  q: +3.204e-19, label: 'α',   vDefault: 2,  BDefault: 2000, vMax: 5,  BMax: 5000, timeScale: 3.5e-8 },
};
// For each preset, B is in millitesla and v is in Mm/s (×10⁶ m/s).

const state = {
  unitsMode: 'abstract',    // 'abstract' or 'real'
  qSign:    -1,
  m:        1.0,
  v:        4.0,
  B:        3.0,
  particle: 'electron',     // for 'real' mode
  vReal:    5,              // Mm/s
  BReal:    2,              // mT
  fieldDir: 'out',          // 'out' (⊙) or 'in' (⊗)
  startMode: 'centre',      // 'centre' or 'left'
  playing: false,           // false until the user clicks Start
  showField:   true,
  showTrail:   true,
  showVectors: true,
};

let particle = null;
let trail = [];
const TRAIL_MAX = 250;

function fieldSign() { return state.fieldDir === 'in' ? +1 : -1; }

// Sign of the charge for visual rendering (colour, ± glyph).  In abstract
// mode the user picks it directly; in real mode it's fixed by the particle.
function currentQSign() {
  if (state.unitsMode === 'real') return Math.sign(PARTICLES[state.particle].q);
  return state.qSign;
}

// In 'real' mode the simulation is slowed by the particle's own `timeScale`
// so motion is visible.  Both ω and v are scaled by the same factor so
// r = v/ω stays at the correct geometric value.
function omega() {
  if (state.unitsMode === 'real') {
    const p = PARTICLES[state.particle];
    const B_T = state.BReal * 1e-3;
    return Math.sign(p.q) * fieldSign() * Math.abs(p.q) * B_T / p.m * p.timeScale;
  }
  return state.qSign * fieldSign() * state.B / state.m;
}
function speedPx() {
  if (state.unitsMode === 'real') {
    const p = PARTICLES[state.particle];
    return state.vReal * 1e6 * PX_PER_M * p.timeScale;
  }
  return state.v * SPEED_SCALE;
}
function radiusPx() {
  const w = Math.abs(omega());
  return w === 0 ? Infinity : speedPx() / w;
}
// Real (un-scaled) angular frequency for readouts.
function omegaPhys() {
  if (state.unitsMode === 'real') {
    const p = PARTICLES[state.particle];
    const B_T = state.BReal * 1e-3;
    return Math.sign(p.q) * fieldSign() * Math.abs(p.q) * B_T / p.m;
  }
  return state.qSign * fieldSign() * state.B / state.m;
}
function periodPhys() {
  const w = Math.abs(omegaPhys());
  return w === 0 ? Infinity : (2 * Math.PI) / w;
}
function forceMag() {
  if (state.unitsMode === 'real') {
    const p = PARTICLES[state.particle];
    return Math.abs(p.q) * (state.vReal * 1e6) * (state.BReal * 1e-3);
  }
  return Math.abs(state.qSign) * state.v * state.B;
}

function inField(x) {
  return state.startMode === 'centre' || x >= FIELD_BOUNDARY_X;
}

function resetParticle() {
  if (state.startMode === 'centre') {
    // Pre-place the particle so its circular path is centred on the canvas.
    // Sign of ω picks which side of the centre the start point sits on, so
    // the centripetal force at t=0 points TOWARD the canvas centre.
    const r = radiusPx();
    const offset = omega() > 0 ? +r : -r;
    particle = { x: W / 2, y: H / 2 + offset, vx: speedPx(), vy: 0 };
  } else {
    particle = { x: 25, y: H / 2, vx: speedPx(), vy: 0 };
  }
  trail = [];
}

/* ── Animation step ─────────────────────────────────────────── */
function step(dt) {
  if (!particle || !state.playing) return;

  // Substep at the field boundary so each fragment is integrated under the
  // right physics (straight line vs. rotation).  Otherwise a frame that
  // straddles x = FIELD_BOUNDARY_X picks up a phase error and the exit
  // direction drifts off antiparallel.
  let remaining = dt;
  let safety = 6;
  while (remaining > 1e-9 && safety-- > 0) {
    let dtThis = remaining;

    if (state.startMode === 'left' && Math.abs(particle.vx) > 1e-9) {
      // Linear-approximation time-to-cross is exact in the field-free zone
      // and a tiny error inside the field at typical dt (the chord is
      // ≪ r over a 60 fps step).
      const dtCross = (FIELD_BOUNDARY_X - particle.x) / particle.vx;
      if (dtCross > 1e-9 && dtCross < dtThis) dtThis = dtCross;
    }

    if (inField(particle.x)) {
      const w = omega();
      if (Math.abs(w) < 1e-9) {
        particle.x += particle.vx * dtThis;
        particle.y += particle.vy * dtThis;
      } else {
        // Exact circular-arc integration (integrates dvx/dt = ω·vy,
        // dvy/dt = −ω·vx in closed form):
        //   v(t) = R(ωt) · v(0)
        //   Δx = (vx sin θ + vy (1 − cos θ)) / ω
        //   Δy = (vy sin θ − vx (1 − cos θ)) / ω
        const θ = w * dtThis;
        const c = Math.cos(θ);
        const s = Math.sin(θ);
        const newVx = particle.vx * c + particle.vy * s;
        const newVy = -particle.vx * s + particle.vy * c;
        particle.x += (particle.vx * s + particle.vy * (1 - c)) / w;
        particle.y += (particle.vy * s - particle.vx * (1 - c)) / w;
        particle.vx = newVx;
        particle.vy = newVy;
      }
    } else {
      // Field-free zone: pure straight line.
      particle.x += particle.vx * dtThis;
      particle.y += particle.vy * dtThis;
    }

    remaining -= dtThis;
  }

  trail.push({ x: particle.x, y: particle.y });
  if (trail.length > TRAIL_MAX) trail.shift();

  // Auto-reset only matters for 'left' mode; in 'centre' mode the orbit is
  // closed and the particle naturally returns each period.
  if (state.startMode === 'left') {
    const margin = 80;
    if (
      particle.x < -margin || particle.x > W + margin ||
      particle.y < -margin || particle.y > H + margin
    ) {
      resetParticle();
    }
  }
}

/* ── Drawing ────────────────────────────────────────────────── */
function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.06)';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

function drawFieldGlyphs() {
  if (!state.showField) return;
  const into = state.fieldDir === 'in';
  const spacing = 80;
  const r = 11;
  // In 'left' mode the field only exists right of the boundary line.
  const xMin = state.startMode === 'left' ? FIELD_BOUNDARY_X + spacing / 2 : spacing / 2;
  ctx.save();
  ctx.strokeStyle = COLOUR_FIELD;
  ctx.fillStyle   = COLOUR_FIELD;
  ctx.lineWidth = 1.6;
  for (let x = xMin; x < W; x += spacing) {
    for (let y = spacing / 2; y < H; y += spacing) {
      // Soft white halo so the glyphs remain readable over the trail
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = COLOUR_FIELD;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      if (into) {
        // ×
        ctx.beginPath();
        ctx.moveTo(x - r * 0.55, y - r * 0.55);
        ctx.lineTo(x + r * 0.55, y + r * 0.55);
        ctx.moveTo(x + r * 0.55, y - r * 0.55);
        ctx.lineTo(x - r * 0.55, y + r * 0.55);
        ctx.stroke();
      } else {
        // •
        ctx.fillStyle = COLOUR_FIELD;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.28, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawTrail() {
  if (!state.showTrail || trail.length < 2) return;
  ctx.save();
  ctx.strokeStyle = COLOUR_TRAIL;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawArrow(x, y, dx, dy, colour, width = 2.5, headSize = 9) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const ux = dx / len, uy = dy / len;
  const tipX = x + dx, tipY = y + dy;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle   = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX - ux * headSize * 0.7, tipY - uy * headSize * 0.7);
  ctx.stroke();
  // Arrowhead
  const ang = Math.atan2(uy, ux);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headSize * Math.cos(ang - 0.5), tipY - headSize * Math.sin(ang - 0.5));
  ctx.lineTo(tipX - headSize * Math.cos(ang + 0.5), tipY - headSize * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawVectors() {
  if (!state.showVectors || !particle) return;

  // Velocity arrow — always shown, always tangent to the path.
  drawArrow(particle.x, particle.y, particle.vx * 0.18, particle.vy * 0.18, COLOUR_VEL, 2.5, 10);

  // Force F = qv × B is only non-zero where the field exists.  In the
  // field-free zone of 'left' mode the particle moves in a straight line
  // and feels no force, so don't draw the arrow there.
  if (inField(particle.x)) {
    // a = (ω·vy, −ω·vx) in canvas frame — perpendicular to v, pointing toward
    // the orbit centre.  Direction is the only thing that matters visually;
    // the magnitude is scaled to a comfortable display size.
    const w = omega();
    const ax = w * particle.vy;
    const ay = -w * particle.vx;
    drawArrow(particle.x, particle.y, ax * FORCE_SCALE * 0.01, ay * FORCE_SCALE * 0.01, COLOUR_FORCE, 2.5, 10);
  }
}

function drawParticle() {
  if (!particle) return;
  const qs = currentQSign();
  ctx.save();
  // Glow
  ctx.fillStyle = qs > 0 ? 'rgba(220, 38, 38, 0.18)' : 'rgba(37, 99, 235, 0.18)';
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 16, 0, 2 * Math.PI);
  ctx.fill();
  // Body
  ctx.fillStyle = qs > 0 ? COLOUR_POS : COLOUR_NEG;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 9, 0, 2 * Math.PI);
  ctx.fill();
  // Sign
  ctx.fillStyle = 'white';
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(qs > 0 ? '+' : '−', particle.x, particle.y + 1);
  ctx.restore();
}

function drawFieldBoundary() {
  if (state.startMode !== 'left') return;
  ctx.save();
  // Subtle dashed line marking where the field begins.
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(FIELD_BOUNDARY_X, 0);
  ctx.lineTo(FIELD_BOUNDARY_X, H);
  ctx.stroke();
  // Label the field boundary.
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(29, 78, 216, 0.7)';
  ctx.font = 'italic 600 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('B field region →', FIELD_BOUNDARY_X + 6, 8);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawGrid();
  drawFieldGlyphs();
  drawFieldBoundary();
  drawTrail();
  drawParticle();
  drawVectors();
}

/* ── Readouts ──────────────────────────────────────────────── */
function fmtLength(m) {
  if (m < 1e-6)  return (m * 1e9).toFixed(1) + ' nm';
  if (m < 1e-3)  return (m * 1e6).toFixed(2) + ' µm';
  if (m < 1)     return (m * 1e3).toFixed(2) + ' mm';
  return m.toFixed(3) + ' m';
}
function fmtTime(s) {
  if (s < 1e-9)  return (s * 1e12).toFixed(2) + ' ps';
  if (s < 1e-6)  return (s * 1e9).toFixed(2) + ' ns';
  if (s < 1e-3)  return (s * 1e6).toFixed(2) + ' µs';
  if (s < 1)     return (s * 1e3).toFixed(2) + ' ms';
  return s.toFixed(2) + ' s';
}
function fmtForce(F) {
  if (F < 1e-15) return (F * 1e18).toFixed(2) + ' aN';
  if (F < 1e-12) return (F * 1e15).toFixed(2) + ' fN';
  if (F < 1e-9)  return (F * 1e12).toFixed(2) + ' pN';
  if (F < 1e-6)  return (F * 1e9).toFixed(2) + ' nN';
  return F.toFixed(3) + ' N';
}

function updateReadouts() {
  const rEl = document.getElementById('rd-radius');
  const TEl = document.getElementById('rd-period');
  const FEl = document.getElementById('rd-force');
  if (state.unitsMode === 'real') {
    const r_m = radiusPx() / PX_PER_M;
    rEl.textContent = Number.isFinite(r_m) ? fmtLength(r_m) : '—';
    TEl.textContent = Number.isFinite(periodPhys()) ? fmtTime(periodPhys()) : '—';
    FEl.textContent = fmtForce(forceMag());
  } else {
    rEl.textContent = Number.isFinite(radiusPx())
      ? (radiusPx() / SPEED_SCALE).toFixed(2) + ' units'
      : '—';
    TEl.textContent = Number.isFinite(periodPhys())
      ? periodPhys().toFixed(2) + ' s'
      : '—';
    FEl.textContent = forceMag().toFixed(2) + ' units';
  }
}

/* ── Time loop ─────────────────────────────────────────────── */
let lastT = -1;
function tick(t) {
  try {
    if (lastT < 0) lastT = t;
    const dt = Math.max(0, Math.min(0.05, (t - lastT) / 1000));
    lastT = t;
    step(dt);
    draw();
  } catch (e) {
    console.error('tick error:', e);
  }
  requestAnimationFrame(tick);
}

/* ── UI wiring ─────────────────────────────────────────────── */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('#seg-mode .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.startMode = btn.dataset.val;
    setActive('#seg-mode', btn);
    resetParticle();
  });
});
document.querySelectorAll('#seg-charge .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.qSign = btn.dataset.val === 'pos' ? +1 : -1;
    setActive('#seg-charge', btn);
    resetParticle();
    updateReadouts();
  });
});
document.querySelectorAll('#seg-field .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.fieldDir = btn.dataset.val;
    setActive('#seg-field', btn);
    resetParticle();
    updateReadouts();
  });
});

/* ── Constraint helpers (keep r ≤ MAX_R for both modes) ────── */
// Abstract: r_px = SPEED_SCALE · m · v / (|q| · B)  ≤  MAX_R
//           => m · v / B  ≤  MAX_R / SPEED_SCALE  = K_ABS
const K_ABS = MAX_R / SPEED_SCALE;
function clampAbstractM(req) { return Math.min(req, K_ABS * state.B / state.v); }
function clampAbstractV(req) { return Math.min(req, K_ABS * state.B / state.m); }
function clampAbstractB(req) { return Math.max(req, state.m * state.v / K_ABS); }
// Real: r_m = m · v_mps / (|q| · B_T) ≤ MAX_R_M
function clampRealV(req) {
  const p = PARTICLES[state.particle];
  const B_T = state.BReal * 1e-3;
  const vMaxMps = Math.abs(p.q) * B_T * MAX_R_M / p.m;
  const vMaxMm  = vMaxMps / 1e6;
  return Math.min(req, vMaxMm);
}
function clampRealB(req) {
  const p = PARTICLES[state.particle];
  const v_mps = state.vReal * 1e6;
  const BMinT = p.m * v_mps / (Math.abs(p.q) * MAX_R_M);
  const BMinMt = BMinT * 1e3;
  return Math.max(req, BMinMt);
}

/* ── Sliders (with constraint clamping) ────────────────────── */
function wireSlider(id, valId, clamp, store, digits = 1, unitFn = null) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  function apply(v) {
    const clamped = clamp(v);
    if (clamped !== v) { v = clamped; }
    el.value = v;
    vl.value = v.toFixed(digits);
    if (unitFn) unitFn(v);
    store(v);
    resetParticle();
    updateReadouts();
  }
  el.addEventListener('input', () => {
    apply(parseFloat(el.value));
  });
  vl.addEventListener('change', () => {
    let typed = parseFloat(vl.value);
    if (isNaN(typed)) { vl.value = parseFloat(el.value).toFixed(digits); return; }
    // For val-B-real: when current unit is T, the user typed a value in T → convert to mT.
    if (id === 'slider-B-real') {
      const unitEl = document.getElementById('unit-B-real');
      if (unitEl && unitEl.textContent === 'T') typed *= 1000;
    }
    const min = parseFloat(el.min), max = parseFloat(el.max);
    typed = Math.max(min, Math.min(max, typed));
    apply(typed);
  });
}
wireSlider('slider-m', 'val-m', clampAbstractM, (v) => { state.m = v; }, 1);
wireSlider('slider-v', 'val-v', clampAbstractV, (v) => { state.v = v; }, 1);
wireSlider('slider-B', 'val-B', clampAbstractB, (v) => { state.B = v; }, 1);

wireSlider('slider-v-real', 'val-v-real', clampRealV, (v) => { state.vReal = v; }, 1);
wireSlider('slider-B-real', 'val-B-real', clampRealB, (v) => { state.BReal = v; }, 1, (v) => {
  // Switch displayed unit to T once we exceed 999 mT.
  document.getElementById('unit-B-real').textContent = v >= 1000 ? 'T' : 'mT';
  // When showing T, scale value display.
  if (v >= 1000) {
    document.getElementById('val-B-real').value = (v / 1000).toFixed(2);
  }
});

/* ── Units mode and particle-preset selectors ──────────────── */
function applyParticle(name) {
  state.particle = name;
  const p = PARTICLES[name];
  // Reset slider ranges and defaults to suit this particle.
  const sv = document.getElementById('slider-v-real');
  const sb = document.getElementById('slider-B-real');
  sv.max = p.vMax; sv.value = p.vDefault; state.vReal = p.vDefault;
  sb.max = p.BMax; sb.value = p.BDefault; state.BReal = p.BDefault;
  const valV = document.getElementById('val-v-real');
  const valB = document.getElementById('val-B-real');
  valV.max = p.vMax;
  valB.max = p.BMax;
  valV.value = p.vDefault.toFixed(1);
  valB.value = p.BDefault >= 1000
    ? (p.BDefault / 1000).toFixed(2)
    : p.BDefault.toFixed(1);
  document.getElementById('unit-B-real').textContent = p.BDefault >= 1000 ? 'T' : 'mT';
}
document.querySelectorAll('#seg-particle .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyParticle(btn.dataset.val);
    setActive('#seg-particle', btn);
    resetParticle();
    updateReadouts();
  });
});

document.querySelectorAll('#seg-units .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.unitsMode = btn.dataset.val;
    setActive('#seg-units', btn);
    document.getElementById('abstract-controls').classList.toggle('is-hidden', state.unitsMode !== 'abstract');
    document.getElementById('real-controls').classList.toggle('is-hidden', state.unitsMode !== 'real');
    resetParticle();
    updateReadouts();
  });
});

function toggleBtn(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
  });
}
toggleBtn('btn-field-glyphs', 'showField');
toggleBtn('btn-trail',        'showTrail');
toggleBtn('btn-vectors',      'showVectors');

/* ── Start / Pause / Reset ─────────────────────────────────── */
const playBtn = document.getElementById('btn-play');
function setPlaying(p) {
  state.playing = p;
  playBtn.textContent = p ? 'Pause' : 'Start';
  playBtn.classList.toggle('active', p);
}
playBtn.addEventListener('click', () => setPlaying(!state.playing));
document.getElementById('btn-reset').addEventListener('click', () => {
  setPlaying(false);
  resetParticle();
});

/* ── Boot ──────────────────────────────────────────────────── */
resetParticle();
updateReadouts();
requestAnimationFrame(tick);
