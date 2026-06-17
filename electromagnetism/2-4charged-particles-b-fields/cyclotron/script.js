/* ═══════════════════════════════════════════════════════════════
   Cyclotron capstone game.

   Two D-shaped dees with a thin gap between them, a uniform B field
   perpendicular to the page in each dee, and an alternating E field
   across the gap.  Resonance condition: oscillator frequency f equals
   the cyclotron frequency  f_c = qB / 2π m.   On match, the particle
   gains energy on every gap crossing and spirals outward to the dee
   rim; off match, it drifts out of phase and stops growing.

   Two modes:
     'demo' — f auto-locked to f_c, so the spiral always works.
     'game' — player tunes f via slider; in-phase streak is tracked.
═══════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const CY = H / 2;

const PX_PER_M  = 2500;            // canvas pixels per real metre
const GAP_HALF  = 10;              // px (gap is 20 px wide; the speed-up across
                                   //     it is clearly visible, and the slider
                                   //     ranges below keep cumulative phase drift
                                   //     under ~30° at escape so the spiral closes)
const DEE_R     = Math.min(W, H) / 2 - 30;   // 250 px-ish

// Real-particle presets.  `timeScale` slows the cyclotron so motion
// is visible — heavier particles need a larger scale than electrons.
const PARTICLES = {
  proton: { m: 1.67262e-27, q: +1.602e-19, label: 'p⁺', timeScale: 3.0e-8 },
  alpha:  { m: 6.6447e-27,  q: +3.204e-19, label: 'α',  timeScale: 6.0e-8 },
};

const COLOUR_FIELD   = 'rgba(37, 99, 235, 0.6)';
const COLOUR_DEE     = 'rgba(180, 200, 230, 0.32)';
const COLOUR_DEE_BD  = 'rgba(21, 48, 77, 0.55)';
const COLOUR_TRAIL   = 'rgba(15, 118, 110, 0.65)';
const COLOUR_PARTICLE_POS = '#dc2626';
const COLOUR_GAP_POS = '#10b981';
const COLOUR_GAP_NEG = '#dc2626';

const state = {
  mode:     'demo',          // 'demo' or 'game'
  particle: 'proton',
  B:        0.5,             // tesla
  V:        15,              // gap voltage in kV
  ctrl:     'V',             // 'V' = set voltage, 'N' = set turn count (derives V)
  N:        8,               // target turn count when ctrl === 'N'
  fGameMHz: 10.0,            // user's oscillator frequency in MHz (game mode)
  fieldDir: 'in',            // 'in' (⊗) or 'out' (⊙)
  playing:  false,           // start paused; user clicks Start
  completed: false,          // becomes true when the particle reaches the dee rim
  // Demo auto-sync: in demo mode the gap E field is a square wave whose sign
  // flips precisely when the particle crosses from gap into a dee, so every
  // gap traversal accelerates regardless of finite traversal time.  This is
  // the synchrocyclotron trick — pedagogically equivalent to "f locked to
  // f_c" but immune to phase drift from the wide visible gap.
  gapSign:  +1,
  // Game tracking
  maxKE:    0,               // joules
  streak:   0,
  prevSign: 0,               // sign of last gap-crossing direction
};

let particle = null;
let trail = [];
const TRAIL_MAX = 1500;
let simT = 0;                // seconds of canvas time elapsed since reset

/* ── Physics helpers ────────────────────────────────────────── */
function fieldSign() { return state.fieldDir === 'in' ? +1 : -1; }
function partInfo()  { return PARTICLES[state.particle]; }

// True cyclotron frequency in Hz (no time scaling).
function fcHz() {
  const p = partInfo();
  return Math.abs(p.q) * state.B / (2 * Math.PI * p.m);
}

// Active oscillator frequency in Hz.  Demo mode locks to f_c; game uses slider.
function oscHz() {
  return state.mode === 'demo' ? fcHz() : state.fGameMHz * 1e6;
}

// Canvas-frame angular velocity inside a dee (signed).
function omegaCanvas() {
  const p = partInfo();
  return Math.sign(p.q) * fieldSign() * Math.abs(p.q) * state.B / p.m * p.timeScale;
}

// Real KE of the particle, given its on-canvas velocity.
function kineticJ() {
  const p = partInfo();
  const v_real = velRealMag();
  return 0.5 * p.m * v_real * v_real;
}
function velRealMag() {
  if (!particle) return 0;
  const v_canvas = Math.hypot(particle.vx, particle.vy);
  // v_canvas = v_real · PX_PER_M · timeScale  ⇒  v_real = v_canvas / (PX_PER_M · timeScale)
  return v_canvas / (PX_PER_M * partInfo().timeScale);
}
function radiusM() {
  // r = m v / |q B|
  const p = partInfo();
  return p.m * velRealMag() / (Math.abs(p.q) * state.B);
}

/* Zone classification */
function inGap(x)     { return x > CX - GAP_HALF && x < CX + GAP_HALF; }
function inLeftDee(x) { return x <= CX - GAP_HALF; }

/* Gap E field (V/m) at canvas time t, in +x direction.
   • Demo: square wave whose sign is `state.gapSign`, flipped on each gap exit
     so every traversal sees a constant accelerating field (auto-synced).
   • Game: cosine oscillator at the user's chosen frequency — the player sees
     the spiral break down whenever they mistune away from f_c. */
function gapEx(tCanvas) {
  const V_volts = state.V * 1e3;                              // kV → V
  const Emax    = V_volts / (2 * GAP_HALF / PX_PER_M);        // V/m
  if (state.mode === 'demo') return state.gapSign * Emax;
  const fCanvas = oscHz() * partInfo().timeScale;
  return Emax * Math.cos(2 * Math.PI * fCanvas * tCanvas);
}

/* When the user is in 'set N' mode, the voltage is derived: pick V so that
   N gap crossings bring the particle to exactly the rim radius, giving
   N·qV = (qBR_rim)²/(2m) and r_N = R_rim exactly (no overshoot). */
function deriveVFromN() {
  const p = partInfo();
  const R_rim_m = (DEE_R - 6) / PX_PER_M;
  const KE = Math.pow(Math.abs(p.q) * state.B * R_rim_m, 2) / (2 * p.m);
  const V_volts = KE / (Math.abs(p.q) * state.N);
  state.V = V_volts / 1000;          // kV
}

/* ── Reset / launch ─────────────────────────────────────────── */
/* Choose the launch y so the spiral exits the rim at the dee's horizontal
   equator (y = CY), making the extraction point V-invariant: changing V
   alters the number of turns but not where the beam emerges.  Each
   semicircle k has radius r_k = √k · r₁ and centre on the gap edge; N is
   the first k with r_N > R_rim.  The escape arc (centred at (dee_cx, y_c_N),
   radius r_N) intersects the rim circle (centred at (dee_cx, CY), radius
   R_rim) where 2h·(y − CY) = h² − r_N² + R_rim², so setting y_exit = CY
   gives h² = r_N² − R_rim².  Pick sign of h opposite to sgnTerm_N so the
   arc entry stays inside the dee.  Then y_start = y_c_N + S_{N−1} + S_N. */
function predictYStart() {
  const p = partInfo();
  if (!p || !Number.isFinite(p.q) || p.q === 0) return CY;
  const dKE   = Math.abs(p.q) * state.V * 1e3;     // J gained per gap crossing
  const R_rim = DEE_R - 6;
  let S_prev = 0, S = 0, sgnTerm = +1;
  for (let k = 1; k <= 200000; k++) {
    const v = Math.sqrt(2 * k * dKE / p.m);
    const r = (p.m * v / (Math.abs(p.q) * state.B)) * PX_PER_M;
    S_prev = S;
    S += sgnTerm * r;
    if (r > R_rim) {
      const h = -sgnTerm * Math.sqrt(r * r - R_rim * R_rim);
      return CY + h + S_prev + S;
    }
    sgnTerm = -sgnTerm;
  }
  return CY;
}

function resetParticle() {
  const p = partInfo();
  // Start at rest at the gap edge on the side OPPOSITE to where the initial
  // E-field force will push the particle, so the first half-step traverses
  // the full gap and gives a clean acceleration.  With gapSign = +1 the field
  // points in +x, so force on a positive charge is in +x → start on the left
  // edge of the gap.  y comes from predictYStart() which back-solves the
  // launch height so the spiral exits the rim at y = CY (independent of V).
  const sgn = Math.sign(p.q) || +1;
  particle = {
    // Sit at the gap edge against the like-charged dee so the very first
    // traversal covers the entire 2·GAP_HALF and gains exactly qV.  The
    // 1e-6 offset keeps `inGap` strictly true at boot (avoids the boundary
    // corner case) while losing negligibly less than qV worth of acceleration.
    x:  CX - sgn * (GAP_HALF - 1e-6),
    y:  predictYStart(),
    vx: 0,
    vy: 0,
  };
  trail = [];
  simT = 0;
  state.gapSign = +1;
  state.maxKE = 0;
  state.streak = 0;
  state.prevSign = 0;
  state.completed = false;
}

/* ── Animation step ─────────────────────────────────────────── */
// Smallest positive t at which constant-acceleration motion x(t) = x0 + vx*t
// + 1/2 a t² reaches X_target.  Returns +Infinity if unreachable.
function gapTimeToReach(p, a, X_target) {
  const D = X_target - p.x;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(p.vx) < 1e-9) return Infinity;
    const t = D / p.vx;
    return t > 1e-9 ? t : Infinity;
  }
  const disc = p.vx * p.vx + 2 * a * D;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t1 = (-p.vx + sq) / a;
  const t2 = (-p.vx - sq) / a;
  let best = Infinity;
  if (t1 > 1e-9 && t1 < best) best = t1;
  if (t2 > 1e-9 && t2 < best) best = t2;
  return best;
}

// Smallest positive t at which a particle in circular motion (centre derived
// from current state and ω) reaches x = X_target.  Solves circle-vs-vertical
// using the α(t) = α₀ − ω·t parameterisation matched to step()'s rotation.
function deeTimeToReach(p, w, X_target) {
  if (Math.abs(w) < 1e-9) return Infinity;
  const v = Math.hypot(p.vx, p.vy);
  if (v < 1e-9) return Infinity;
  const r  = v / Math.abs(w);
  const cx = p.x + p.vy / w;
  const cy = p.y - p.vx / w;
  const dxN = (X_target - cx) / r;
  if (dxN > 1 || dxN < -1) return Infinity;
  const aA = Math.acos(dxN);
  const aB = -aA;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const TAU = 2 * Math.PI;
  const sgn = Math.sign(w);
  function dt(at) {
    let da = sgn > 0 ? (a0 - at) : (at - a0);
    da = ((da % TAU) + TAU) % TAU;
    if (da < 1e-9) da += TAU;
    return da / Math.abs(w);
  }
  return Math.min(dt(aA), dt(aB));
}

function step(dt) {
  if (!particle || !state.playing) return;

  // Substep so each fragment runs the correct physics and ends exactly at a
  // gap-↔-dee boundary.  Boundary prediction in the dees uses the *circular*
  // path — a linear extrapolation can sweep straight through the gap region
  // without applying the E-field, double-counting crossings and inflating
  // the final energy.
  let remaining = dt;
  let safety = 64;
  while (remaining > 1e-9 && safety-- > 0) {
    let dtThis = remaining;
    const wasInGap = inGap(particle.x);

    if (wasInGap) {
      // Gap: constant-E linear acceleration in x.  Find time to reach either
      // gap edge using the exact quadratic (so we don't overshoot when the
      // particle is accelerating across the gap).
      const E = gapEx(simT);
      const p = partInfo();
      const accel = (p.q * E / p.m) * PX_PER_M * p.timeScale * p.timeScale;
      for (const target of [CX - GAP_HALF, CX + GAP_HALF]) {
        const t = gapTimeToReach(particle, accel, target);
        if (t < dtThis) dtThis = t;
      }
      const vx0 = particle.vx;
      particle.vx += accel * dtThis;
      particle.x  += vx0 * dtThis + 0.5 * accel * dtThis * dtThis;
      particle.y  += particle.vy * dtThis;
    } else {
      // Dee: closed-form circular motion.  Predict gap-edge crossings along
      // the actual circle, not a tangent line.
      const w = omegaCanvas();
      if (Math.abs(w) > 1e-9) {
        for (const target of [CX - GAP_HALF, CX + GAP_HALF]) {
          const t = deeTimeToReach(particle, w, target);
          if (t < dtThis) dtThis = t;
        }
      }
      if (Math.abs(w) < 1e-9) {
        particle.x += particle.vx * dtThis;
        particle.y += particle.vy * dtThis;
      } else {
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
    }

    simT += dtThis;
    remaining -= dtThis;

    // Nudge the particle a hair past any gap edge it landed exactly on, so
    // the next substep's `inGap` test cleanly reflects which physics zone it
    // actually entered.
    const NUDGE = 1e-4;
    if (Math.abs(particle.x - (CX + GAP_HALF)) < 1e-6) particle.x += (particle.vx < 0 ? -NUDGE : +NUDGE);
    if (Math.abs(particle.x - (CX - GAP_HALF)) < 1e-6) particle.x += (particle.vx < 0 ? -NUDGE : +NUDGE);

    // Flip the demo's auto-synced gap field the instant the particle leaves
    // the gap, so the next traversal sees the opposite sign — giving the
    // canonical "straight gap segment + bigger semicircle" repeating pattern.
    if (wasInGap && !inGap(particle.x)) {
      state.gapSign = -state.gapSign;
    }
  }

  // Track game progress: detect successful crossings.  When particle traverses
  // the gap, its KE either grows (success) or shrinks (out of phase).
  const ke = kineticJ();
  if (ke > state.maxKE * 1.001) {
    // KE is increasing.  Treat as a successful crossing only when the
    // particle just LEFT the gap (so we count once per traversal).
    state.maxKE = ke;
  }

  // Trail
  trail.push({ x: particle.x, y: particle.y });
  if (trail.length > TRAIL_MAX) trail.shift();

  // Stop when the particle reaches the dee rim or runs off-canvas.  Use the
  // distance from the nearest dee centre (each dee is offset by GAP_HALF), so
  // the rim test matches the actual dee geometry rather than a circle around
  // the canvas centre.
  const dee_cx = particle.x < CX ? CX - GAP_HALF : CX + GAP_HALF;
  const rFromDee = Math.hypot(particle.x - dee_cx, particle.y - CY);
  if (rFromDee > DEE_R - 6 || particle.x < 5 || particle.x > W - 5 || particle.y < 5 || particle.y > H - 5) {
    state.completed = true;
    state.playing = false;
    updatePlayBtn();
  }
}

/* ── Drawing ────────────────────────────────────────────────── */
function drawDees() {
  ctx.save();
  ctx.fillStyle = COLOUR_DEE;
  ctx.strokeStyle = COLOUR_DEE_BD;
  ctx.lineWidth = 2;

  // Both dees use the same start/end angles (north → south); anticlockwise
  // chooses which half of the circle is traced.
  // Left dee: north → WEST → south  (CCW visually = decreasing angle = anticlockwise true)
  ctx.beginPath();
  ctx.arc(CX - GAP_HALF, CY, DEE_R, -Math.PI / 2, Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right dee: north → EAST → south  (CW visually = increasing angle = anticlockwise false)
  ctx.beginPath();
  ctx.arc(CX + GAP_HALF, CY, DEE_R, -Math.PI / 2, Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawFieldGlyphs() {
  const into = state.fieldDir === 'in';
  const spacing = 80;
  const r = 11;

  // Symmetric column placement around CX so the same gap margin appears on
  // both sides (avoids the visual asymmetry of an offset grid putting one
  // column right next to the gap and the other 70 px away).
  const xs = [];
  for (let k = 0; k < 12; k++) {
    const dx = (2 * k + 1) * spacing / 2;
    if (CX - dx > 0) xs.push(CX - dx);
    if (CX + dx < W) xs.push(CX + dx);
  }
  const ys = [];
  for (let y = spacing / 2; y < H; y += spacing) ys.push(y);

  ctx.save();
  ctx.lineWidth = 1.5;
  for (const x of xs) {
    for (const y of ys) {
      // Skip if outside the corresponding dee's circle (also filters out
      // points that would land in the small gap region).
      const dxC = x - (x < CX ? CX - GAP_HALF : CX + GAP_HALF);
      const dyC = y - CY;
      if (dxC * dxC + dyC * dyC > (DEE_R - 6) * (DEE_R - 6)) continue;

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = COLOUR_FIELD;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      if (into) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.55, y - r * 0.55);
        ctx.lineTo(x + r * 0.55, y + r * 0.55);
        ctx.moveTo(x + r * 0.55, y - r * 0.55);
        ctx.lineTo(x - r * 0.55, y + r * 0.55);
        ctx.stroke();
      } else {
        ctx.fillStyle = COLOUR_FIELD;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.28, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawGapVoltage() {
  const E = gapEx(simT);
  const E_max = (state.V * 1e3) / (2 * GAP_HALF / PX_PER_M);
  const norm = E_max > 0 ? E / E_max : 0;
  const sign = norm >= 0 ? +1 : -1;

  ctx.save();
  // Gap fill — colour intensity follows |norm|, hue from sign.
  const alpha = 0.18 + 0.32 * Math.min(1, Math.abs(norm));
  ctx.fillStyle = sign > 0
    ? `rgba(16, 185, 129, ${alpha.toFixed(3)})`
    : `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
  ctx.fillRect(CX - GAP_HALF, CY - DEE_R, 2 * GAP_HALF, 2 * DEE_R);

  // Direction arrow (E field) at top of gap
  const arrowY = CY - DEE_R + 30;
  const arrowMag = Math.min(1, Math.abs(norm));
  if (arrowMag > 0.05) {
    const arrowLen = 60 * arrowMag * sign;
    ctx.strokeStyle = sign > 0 ? COLOUR_GAP_POS : COLOUR_GAP_NEG;
    ctx.fillStyle   = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CX - arrowLen / 2, arrowY);
    ctx.lineTo(CX + arrowLen / 2 - 6 * sign, arrowY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX + arrowLen / 2, arrowY);
    ctx.lineTo(CX + arrowLen / 2 - 10 * sign, arrowY - 6);
    ctx.lineTo(CX + arrowLen / 2 - 10 * sign, arrowY + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawTrail() {
  if (trail.length < 2) return;
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

function drawParticle() {
  if (!particle) return;
  const p = partInfo();
  const sign = Math.sign(p.q);
  ctx.save();
  ctx.fillStyle = sign > 0 ? 'rgba(220, 38, 38, 0.18)' : 'rgba(37, 99, 235, 0.18)';
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 14, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = sign > 0 ? COLOUR_PARTICLE_POS : '#2563eb';
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign > 0 ? '+' : '−', particle.x, particle.y + 1);
  ctx.restore();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.05)';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawGrid();
  drawDees();
  drawFieldGlyphs();
  drawGapVoltage();
  drawTrail();
  drawParticle();
}

/* ── Readouts ──────────────────────────────────────────────── */
function fmtFreqHz(f) {
  if (f >= 1e9) return (f / 1e9).toFixed(2) + ' GHz';
  if (f >= 1e6) return (f / 1e6).toFixed(2) + ' MHz';
  if (f >= 1e3) return (f / 1e3).toFixed(2) + ' kHz';
  return f.toFixed(0) + ' Hz';
}
function fmtEnergyJ(E) {
  const eV = E / 1.602e-19;
  if (eV < 1)    return (eV * 1e3).toFixed(2) + ' meV';
  if (eV < 1e3)  return eV.toFixed(2) + ' eV';
  if (eV < 1e6)  return (eV / 1e3).toFixed(2) + ' keV';
  return (eV / 1e6).toFixed(2) + ' MeV';
}
function fmtLength(m) {
  if (m < 1e-3) return (m * 1e3).toFixed(2) + ' mm';
  if (m < 1)    return (m * 100).toFixed(2) + ' cm';
  return m.toFixed(2) + ' m';
}

function updateReadouts() {
  document.getElementById('rd-fc').textContent = fmtFreqHz(fcHz());

  const detune = (oscHz() - fcHz()) / fcHz();
  const detEl = document.getElementById('rd-detune');
  if (state.mode === 'demo') {
    detEl.textContent = 'locked (demo)';
  } else {
    const pct = (detune * 100);
    detEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + ' %';
  }

  const keEl = document.getElementById('rd-ke');
  if (!particle) {
    keEl.textContent = '—';
  } else if (state.completed) {
    keEl.textContent = 'Final: ' + fmtEnergyJ(state.maxKE);
  } else {
    keEl.textContent = fmtEnergyJ(state.maxKE);
  }
  document.getElementById('rd-r').textContent  = particle ? fmtLength(radiusM()) : '—';
  document.getElementById('rd-streak').textContent = state.mode === 'game' ? state.streak.toFixed(0) : '—';
  const vDer = document.getElementById('rd-V-derived');
  if (vDer) vDer.textContent = state.V.toFixed(2) + ' kV';
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
    if (frameCount++ % 6 === 0) updateReadouts();
  } catch (e) {
    console.error('tick error:', e);
  }
  requestAnimationFrame(tick);
}
let frameCount = 0;

/* ── UI wiring ─────────────────────────────────────────────── */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

function updatePlayBtn() {
  const btn = document.getElementById('btn-play');
  if (state.completed)      btn.textContent = 'Restart';
  else if (state.playing)   btn.textContent = 'Pause';
  else                      btn.textContent = 'Start';
  btn.classList.toggle('active', state.playing);
}

function applyMode(mode) {
  state.mode = mode;
  document.getElementById('game-only').classList.toggle('is-hidden', mode !== 'game');
  document.getElementById('rd-detune-card').classList.toggle('is-hidden', mode !== 'game');
  document.getElementById('rd-streak-card').classList.toggle('is-hidden', mode !== 'game');
  resetParticle();
  state.playing = false;
  updatePlayBtn();
  updateReadouts();
}

document.querySelectorAll('#seg-mode .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyMode(btn.dataset.val);
    setActive('#seg-mode', btn);
  });
});
document.querySelectorAll('#seg-particle .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.particle = btn.dataset.val;
    setActive('#seg-particle', btn);
    if (state.ctrl === 'N') { deriveVFromN(); syncVSlider(); }
    resetParticle();
    state.playing = false;
    updatePlayBtn();
    updateReadouts();
  });
});

function syncVSlider() {
  const el = document.getElementById('slider-V');
  const vl = document.getElementById('val-V');
  el.value = state.V;
  vl.value = state.V.toFixed(2);
}

function applyCtrl(mode) {
  state.ctrl = mode;
  document.getElementById('ctrl-V').classList.toggle('is-hidden', mode !== 'V');
  document.getElementById('ctrl-N').classList.toggle('is-hidden', mode !== 'N');
  if (mode === 'N') { deriveVFromN(); syncVSlider(); }
  resetParticle();
  state.playing = false;
  updatePlayBtn();
  updateReadouts();
}

document.querySelectorAll('#seg-ctrl .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyCtrl(btn.dataset.val);
    setActive('#seg-ctrl', btn);
  });
});
document.querySelectorAll('#seg-field .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.fieldDir = btn.dataset.val;
    setActive('#seg-field', btn);
    resetParticle();
    state.playing = false;
    updatePlayBtn();
    updateReadouts();
  });
});

function wireSlider(id, valId, store, digits = 1) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  function apply(v) {
    store(v);
    resetParticle();
    state.playing = false;
    updatePlayBtn();
    updateReadouts();
  }
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.value = v.toFixed(digits);
    apply(v);
  });
  vl.addEventListener('change', () => {
    let v = parseFloat(vl.value);
    if (isNaN(v)) { vl.value = parseFloat(el.value).toFixed(digits); return; }
    const min = parseFloat(el.min), max = parseFloat(el.max);
    if (v < min) v = min;
    if (v > max) v = max;
    el.value = v;
    v = parseFloat(el.value);
    vl.value = v.toFixed(digits);
    apply(v);
  });
}
wireSlider('slider-B', 'val-B', (v) => {
  state.B = v;
  if (state.ctrl === 'N') { deriveVFromN(); syncVSlider(); }
}, 2);
wireSlider('slider-V', 'val-V', (v) => { state.V = v; }, 0);
wireSlider('slider-N', 'val-N', (v) => { state.N = v; deriveVFromN(); syncVSlider(); }, 0);
wireSlider('slider-f', 'val-f', (v) => { state.fGameMHz = v; }, 1);

document.getElementById('btn-play').addEventListener('click', () => {
  if (state.completed) {
    // After a run finishes, the same button restarts: clear state and play.
    resetParticle();
    state.playing = true;
  } else {
    state.playing = !state.playing;
  }
  updatePlayBtn();
  updateReadouts();
});
document.getElementById('btn-reset').addEventListener('click', () => {
  resetParticle();
  state.playing = false;
  updatePlayBtn();
  updateReadouts();
});

/* ── Boot ──────────────────────────────────────────────────── */
applyMode('demo');     // also calls resetParticle and starts playing
updatePlayBtn();
requestAnimationFrame(tick);
