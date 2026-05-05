'use strict';

/* ─────────────────────────────── Constants ─────────────────────────── */
const PPM        = 2000;        // canvas pixels per physical metre
const E_CHARGE   = 1.6e-19;    // C
const M_ELECTRON = 9.109e-31;  // kg
const M_PROTON   = 1.673e-27;  // kg
const PLATE_T    = 12;         // plate visual thickness, px

/* ─────────────────────────────── Formatting ────────────────────────── */
const SUPER = {'-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
function sup(n) { return String(n).split('').map(c => SUPER[c] ?? c).join(''); }

function fmtSci(val, unit, dp = 2) {
  if (!Number.isFinite(val) || val === 0) return `0 ${unit}`;
  const neg = val < 0;
  const abs = Math.abs(val);
  let exp = Math.floor(Math.log10(abs));
  let man = abs / Math.pow(10, exp);
  if (man >= 9.995) { man = 1; exp += 1; }
  return `${neg ? '−' : ''}${man.toFixed(dp)} × 10${sup(exp)} ${unit}`;
}

function fmtEV(joules) {
  const ev = joules / E_CHARGE;
  if (ev < 1e3) return `${ev.toFixed(1)} eV`;
  if (ev < 1e6) return `${(ev / 1e3).toFixed(2)} keV`;
  return `${(ev / 1e6).toFixed(3)} MeV`;
}

function fmtDist(metres) {
  if (metres < 0.001) return `${(metres * 1000).toFixed(2)} mm`;
  if (metres < 0.10)  return `${(metres * 100).toFixed(2)} cm`;
  return `${metres.toFixed(3)} m`;
}

/* ─────────────────────────────── Canvas ────────────────────────────── */
const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');

function W() { return canvas.width  / (window.devicePixelRatio || 1); }
function H() { return canvas.height / (window.devicePixelRatio || 1); }

// Layout fractions
const PLATE_L = 0.17;
const PLATE_R = 0.83;

function plLeft()    { return W() * PLATE_L; }
function plRight()   { return W() * PLATE_R; }
function midY()      { return H() / 2; }
function halfGapPx() { return (state.d * PPM) / 2; }
function topPlY()    { return midY() - halfGapPx(); }
function botPlY()    { return midY() + halfGapPx(); }
function plateLenM() { return (plRight() - plLeft()) / PPM; }

function resizeCanvas() {
  const wrap = canvas.parentElement;
  const dpr  = window.devicePixelRatio || 1;
  const cw   = wrap.clientWidth - 2 * 13;
  const ch   = Math.round(cw * 7 / 12);
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width  = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

/* ─────────────────────────────── State ─────────────────────────────── */
const state = {
  mode:            'deflection',
  particle:        'electron',
  customSign:      +1,
  customMantissa:  9.11,   // 1.00 – 9.99
  customExp:       -31,    // integer −31 to −25
  customQMantissa: 1.60,   // 1.00 – 9.99
  customQExp:      -19,    // integer −20 to −15
  V:               0,      // Volts
  d:               0.10,   // metres
  v0f:             5,      // × 10⁷ m/s
  showField:       false,
  showForce:       false,
  showUndeflected: false,
};

function v0() { return state.v0f * 1e7; }

function customMass()   { return state.customMantissa  * Math.pow(10, state.customExp);  }
function customCharge() { return state.customQMantissa * Math.pow(10, state.customQExp); }

function getParticle() {
  switch (state.particle) {
    case 'electron': return { q: -E_CHARGE, m: M_ELECTRON };
    case 'proton':   return { q: +E_CHARGE, m: M_PROTON };
    default:         return { q: state.customSign * customCharge(), m: customMass() };
  }
}

/* ─────────────────────────────── Physics ───────────────────────────── */
function calcPhysics() {
  const { V, d } = state;
  const { q, m } = getParticle();
  const V0 = v0();

  const Efield  = V / d;                // V m⁻¹
  const F       = Math.abs(q) * Efield; // N
  const a       = F / m;                // m s⁻²
  const L       = plateLenM();          // m (plate length)
  const halfD   = d / 2;

  // Field points top → bottom (+y canvas direction).
  // Negative charge deflects upward (−y); positive charge deflects downward (+y).
  const qDir = q < 0 ? -1 : +1;

  // Time to cross plates horizontally; ∞ when v₀ = 0 (particle never exits horizontally).
  const tCross = V0 > 0 ? L / V0 : Infinity;
  const yCross = 0.5 * a * tCross * tCross; // m (deflection if no collision)

  // Particle hits a plate iff it would deflect ≥ halfD before exiting.
  // With a = 0 it never deflects, so it can't hit. With v₀ = 0 and a > 0 it
  // falls straight down and hits at x = 0.
  const hitsPlate = a > 0 && yCross >= halfD;
  const tHit      = hitsPlate ? Math.sqrt(2 * halfD / a) : tCross;
  const yExit     = hitsPlate ? halfD : (Number.isFinite(yCross) ? yCross : 0);
  const xRange    = hitsPlate ? V0 * tHit : null; // m from left edge of plates

  // Energy: work done by field = force × displacement in field direction
  const KE_entry = 0.5 * m * V0 * V0;
  const W        = F * yExit;           // always positive (field accelerates particle)
  const KE_exit  = KE_entry + W;

  return { Efield, F, a, L, tCross, yCross, qDir, hitsPlate, tHit, yExit, xRange, q, KE_entry, KE_exit };
}

/* ───────────────────────── Acceleration physics ────────────────────── */

// In acceleration mode the plates are horizontal (same layout as Deflection).
// The particle enters at the top plate, travels downward through the gap,
// and exits at the bottom plate — always arranged to accelerate downward.
function accelMidX() { return W() / 2; }

function calcAccelPhysics() {
  const { V, d } = state;
  const { q, m } = getParticle();
  const V0 = v0();

  const Efield = V / d;
  const F      = Math.abs(q) * Efield;
  const a      = F / m;

  // Particle traverses full gap d → v² = v₀² + 2ad
  const v_exit = Math.sqrt(V0 * V0 + 2 * a * d);
  // Time to cross: v = v₀ + at  →  t = (v_exit − v₀) / a
  // Guard a = 0 (no field) and V0 = 0 (particle starts at rest, no field → never moves).
  let tCross;
  if (a > 0)      tCross = (v_exit - V0) / a;
  else if (V0 > 0) tCross = d / V0;
  else            tCross = Infinity;

  // KE gained = |q|V  (particle traverses the full potential difference)
  const KE_entry = 0.5 * m * V0 * V0;
  const KE_exit  = 0.5 * m * v_exit * v_exit;

  return { Efield, F, a, d, V0, v_exit, tCross, KE_entry, KE_exit, q };
}

/* ─────────────────────────────── Drawing ───────────────────────────── */

function drawGrid() {
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.06)';
  ctx.lineWidth = 1;
  const w = W(), h = H();
  for (let x = 0; x <= w; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawPlates() {
  const x1 = plLeft(), x2 = plRight();
  const ty  = topPlY(), by = botPlY();
  const PT  = PLATE_T;

  // Subtle field region fill
  ctx.fillStyle = 'rgba(220, 235, 255, 0.32)';
  ctx.fillRect(x1, ty, x2 - x1, by - ty);

  // Top plate — positive (red)
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT * 0.35); // highlight

  // Bottom plate — negative (blue)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT * 0.35); // highlight

  // ± labels on left
  ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText('+', x1 - 10, ty - PT / 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText('−', x1 - 10, by + PT / 2);

  // Voltage labels on right
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText(state.V > 0 ? `+${state.V} V` : '0 V', x2 + 10, ty - PT / 2);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillText('0 V', x2 + 10, by + PT / 2);
}

function drawTrajectory() {
  const ph = calcPhysics();
  const { a, qDir, hitsPlate, tHit, yExit } = ph;
  const V0 = v0();
  const L  = plateLenM();
  const pl = plLeft(), pr = plRight();
  const my = midY();

  // tEnd is finite only if the particle actually moves out of view.
  // With V0 = 0 and a = 0 nothing happens; with V0 = 0 and a > 0 it falls
  // straight down (tEnd = tHit, exitXpx = pl).
  const tEnd    = hitsPlate ? tHit : (V0 > 0 ? L / V0 : 0);
  const exitXpx = pl + V0 * tEnd * PPM;
  const exitYpx = my + qDir * yExit * PPM;

  ctx.setLineDash([]);

  // ── 1. Entry path ──
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(pl, my);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ── 2. Parabolic path inside plates ──
  const STEPS = 300;
  ctx.beginPath();
  ctx.moveTo(pl, my);
  for (let i = 1; i <= STEPS; i++) {
    const t   = (i / STEPS) * tEnd;
    const xPx = pl + V0 * t * PPM;
    const yPx = my + qDir * 0.5 * a * t * t * PPM;
    ctx.lineTo(xPx, yPx);
  }
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ── 3. Exit path — straight line (only if particle cleared the plates) ──
  if (!hitsPlate && V0 > 0) {
    const vy    = a * (L / V0);           // vertical speed at exit, m/s
    const slope = qDir * vy / V0;         // dy/dx (dimensionless)
    ctx.beginPath();
    ctx.moveTo(pr, exitYpx);
    ctx.lineTo(W(), exitYpx + slope * (W() - pr));
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // ── 3½. Equal-time stroboscopic ticks along the path ──
  // Ticks are equally spaced in time, so closely-packed = slow, spread-out = fast.
  {
    const N    = 12;
    const HALF = 7;   // half-length of each tick mark in px
    ctx.strokeStyle = 'rgba(15,118,110,0.55)';
    ctx.lineWidth   = 1.8;
    for (let i = 0; i <= N; i++) {
      const t   = (i / N) * tEnd;
      const xPx = pl + V0 * t * PPM;
      const yPx = my + qDir * 0.5 * a * t * t * PPM;
      // Unit vector along path at this moment; perpendicular tick is rotated 90°
      const vx  = V0;
      const vy  = qDir * a * t;
      const mag = Math.hypot(vx, vy) || 1;
      const px  = -vy / mag;   // perpendicular x component
      const py  =  vx / mag;   // perpendicular y component
      ctx.beginPath();
      ctx.moveTo(xPx - HALF * px, yPx - HALF * py);
      ctx.lineTo(xPx + HALF * px, yPx + HALF * py);
      ctx.stroke();
    }
  }

  // ── 4. Particle marker at entry (left edge of plates) ──
  const { q } = getParticle();
  const pCol  = q < 0 ? '#2563eb' : '#dc2626';
  const pDark = q < 0 ? '#1d4ed8' : '#b91c1c';
  const pSign = q < 0 ? '−' : '+';

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.20)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  const grd = ctx.createRadialGradient(pl - 3, my - 3, 1, pl, my, 10);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, pCol);
  grd.addColorStop(1, pDark);
  ctx.beginPath();
  ctx.arc(pl, my, 10, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle    = 'white';
  ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pSign, pl, my + 1);

  // ── 5. Impact marker if particle hits a plate ──
  if (hitsPlate) {
    ctx.beginPath();
    ctx.arc(exitXpx, exitYpx, 5, 0, Math.PI * 2);
    ctx.fillStyle   = '#dc2626';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.fillStyle    = '#dc2626';
    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = qDir > 0 ? 'top' : 'bottom';
    ctx.fillText('hits plate', exitXpx, exitYpx + qDir * 10);
  }
}

function drawAccelPlates() {
  // Horizontal plates — identical layout to Deflection mode.
  // Polarity is set so the particle always accelerates downward:
  //   q > 0  →  top plate is +  (E downward, force on + charge is downward)
  //   q < 0  →  bottom plate is + (E upward, force on − charge is downward)
  const x1 = plLeft(), x2 = plRight();
  const ty  = topPlY(), by  = botPlY();
  const PT  = PLATE_T;
  const { q } = getParticle();
  const topIsPos = q > 0;

  // Field region fill
  ctx.fillStyle = 'rgba(220, 235, 255, 0.32)';
  ctx.fillRect(x1, ty, x2 - x1, by - ty);

  // Top plate
  ctx.fillStyle = topIsPos ? '#dc2626' : '#2563eb';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, ty - PT, x2 - x1 + 8, PT * 0.35);

  // Bottom plate
  ctx.fillStyle = topIsPos ? '#2563eb' : '#dc2626';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x1 - 4, by, x2 - x1 + 8, PT * 0.35);

  // Polarity signs (left side)
  ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = topIsPos ? '#b91c1c' : '#1d4ed8';
  ctx.fillText(topIsPos ? '+' : '−', x1 - 10, ty - PT / 2);
  ctx.fillStyle = topIsPos ? '#1d4ed8' : '#b91c1c';
  ctx.fillText(topIsPos ? '−' : '+', x1 - 10, by + PT / 2);

  // Voltage labels (right side)
  const vStr = state.V > 0 ? `+${state.V} V` : '0 V';
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = topIsPos ? '#b91c1c' : '#1d4ed8';
  ctx.fillText(topIsPos ? vStr : '0 V', x2 + 10, ty - PT / 2);
  ctx.fillStyle = topIsPos ? '#1d4ed8' : '#b91c1c';
  ctx.fillText(topIsPos ? '0 V' : vStr, x2 + 10, by + PT / 2);
}

function drawAccelTrajectory() {
  const ph = calcAccelPhysics();
  const { V0, v_exit, a, tCross, q } = ph;
  const x  = accelMidX();
  const ty = topPlY();
  const by = botPlY();

  ctx.setLineDash([]);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth   = 2.5;

  // ── 1. Entry path (above top plate) ──
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, ty);
  ctx.stroke();

  // ── 2. Path through field ──
  ctx.beginPath();
  ctx.moveTo(x, ty);
  ctx.lineTo(x, by);
  ctx.stroke();

  // ── 3. Exit path (below bottom plate) ──
  ctx.beginPath();
  ctx.moveTo(x, by);
  ctx.lineTo(x, H());
  ctx.stroke();

  // ── 3½. Equal-time stroboscopic ticks inside the field ──
  // Skip when the particle never moves (V₀ = 0 and a = 0).
  if (Number.isFinite(tCross) && tCross > 0) {
    const N    = 12;
    const HALF = 9;   // half-width of each horizontal tick in px
    ctx.strokeStyle = 'rgba(15,118,110,0.55)';
    ctx.lineWidth   = 1.8;
    for (let i = 0; i <= N; i++) {
      const t   = (i / N) * tCross;
      const yPx = ty + (V0 * t + 0.5 * a * t * t) * PPM;
      ctx.beginPath();
      ctx.moveTo(x - HALF, yPx);
      ctx.lineTo(x + HALF, yPx);
      ctx.stroke();
    }
  }

  // ── 4. Particle marker at top-plate entry ──
  const pCol  = q < 0 ? '#2563eb' : '#dc2626';
  const pDark = q < 0 ? '#1d4ed8' : '#b91c1c';
  const pSign = q < 0 ? '−' : '+';

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.20)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  const grd = ctx.createRadialGradient(x - 3, ty - 3, 1, x, ty, 10);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, pCol);
  grd.addColorStop(1, pDark);
  ctx.beginPath();
  ctx.arc(x, ty, 10, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle    = 'white';
  ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pSign, x, ty + 1);

  // ── 5. Speed annotations (right of path) ──
  function fmtSpeed(v) {
    return `${(v / 1e7).toFixed(1)} × 10${sup(7)} m s⁻¹`;
  }
  ctx.font      = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  // v₀ label sits above the top plate
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = 'rgba(21,48,77,0.55)';
  ctx.fillText(`v₀ = ${fmtSpeed(V0)}`, x + 16, ty - PLATE_T - 4);
  // v label sits below the bottom plate
  ctx.textBaseline = 'top';
  ctx.fillStyle    = '#0f766e';
  ctx.fillText(`v = ${fmtSpeed(v_exit)}`, x + 16, by + PLATE_T + 4);
}

/* ─────────────────────────────── Overlay helpers ───────────────────── */

// Generic arrow from (x1,y1) to (x2,y2). Caller sets strokeStyle/fillStyle/lineWidth.
function drawArrow(x1, y1, x2, y2, headLen = 8, headWidth = 4) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * ux + headWidth * uy, y2 - headLen * uy - headWidth * ux);
  ctx.lineTo(x2 - headLen * ux - headWidth * uy, y2 - headLen * uy + headWidth * ux);
  ctx.closePath();
  ctx.fill();
}

/* ─────────────────────── Overlay: E field arrows ───────────────────── */

function drawFieldArrows() {
  const ARROW = 20;
  ctx.strokeStyle = 'rgba(37,99,235,0.50)';
  ctx.fillStyle   = 'rgba(37,99,235,0.50)';
  ctx.lineWidth   = 1.5;

  if (state.mode === 'deflection') {
    const x1 = plLeft(), x2 = plRight();
    const ty = topPlY(), by = botPlY();
    const gapPx = by - ty;
    if (gapPx < 30) return;

    const COLS = 7, ROWS = 4;
    for (let c = 0; c < COLS; c++) {
      const x = x1 + (x2 - x1) * (c + 0.5) / COLS;
      for (let r = 0; r < ROWS; r++) {
        const y = ty + gapPx * (r + 0.5) / ROWS;
        // E always points downward: + plate (top) → − plate (bottom)
        drawArrow(x, y - ARROW / 2, x, y + ARROW / 2);
      }
    }
    // "E" legend inside field region
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(37,99,235,0.70)';
    ctx.fillText('E', x2 - 6, ty + 5);

  } else {
    // Acceleration mode — horizontal plates, vertical field (same region as Deflection).
    // E points downward for q > 0 (top plate +), upward for q < 0 (bottom plate +).
    const x1 = plLeft(), x2 = plRight();
    const ty = topPlY(), by = botPlY();
    const gapPx = by - ty;
    if (gapPx < 30) return;

    const { q } = getParticle();
    const fieldDown = q > 0;
    const COLS = 7, ROWS = 4;

    for (let c = 0; c < COLS; c++) {
      const x = x1 + (x2 - x1) * (c + 0.5) / COLS;
      for (let r = 0; r < ROWS; r++) {
        const y = ty + gapPx * (r + 0.5) / ROWS;
        if (fieldDown) {
          drawArrow(x, y - ARROW / 2, x, y + ARROW / 2);
        } else {
          drawArrow(x, y + ARROW / 2, x, y - ARROW / 2);
        }
      }
    }
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = 'rgba(37,99,235,0.70)';
    ctx.fillText('E', x2 - 6, ty + 5);
  }
}

/* ─────────────────────── Overlay: force arrow ──────────────────────── */

function drawForceArrow() {
  if (state.V === 0) return;
  const PARTICLE_R = 10;
  const MIN_LEN    = 22, MAX_LEN = 70;
  const Efield     = state.V / state.d;
  const maxE       = 5000 / 0.02;          // 250 kV m⁻¹ (slider maximum)
  const arrowLen   = MIN_LEN + Math.min(1, Efield / maxE) * (MAX_LEN - MIN_LEN);

  ctx.strokeStyle = '#d97706';
  ctx.fillStyle   = '#d97706';
  ctx.lineWidth   = 2.5;

  if (state.mode === 'deflection') {
    const ph   = calcPhysics();
    const dir  = ph.qDir;          // −1 = upward on canvas, +1 = downward
    const x    = plLeft();
    const y0   = midY() + dir * PARTICLE_R;
    const y1   = y0 + dir * arrowLen;
    drawArrow(x, y0, x, y1);

    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = dir > 0 ? 'top' : 'bottom';
    ctx.fillStyle    = '#92400e';
    ctx.fillText('F', x, y1 + dir * 4);

  } else {
    // Acceleration: force always downward (polarity arranged to accelerate particle downward)
    const x  = accelMidX();
    const y0 = topPlY() + PARTICLE_R;
    const y1 = y0 + arrowLen;
    drawArrow(x, y0, x, y1);

    ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#92400e';
    ctx.fillText('F', x + 4, y1 + 2);
  }
}

/* ─────────────────────── Overlay: undeflected path ─────────────────── */

function drawUndeflectedPath() {
  // Only shown in Deflection mode — the parabolic vs straight comparison is the point.
  if (state.mode !== 'deflection') return;
  const my = midY();

  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.25)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(W(), my);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font         = '11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = 'rgba(21, 48, 77, 0.38)';
  ctx.fillText('no field', plLeft() - 6, my - 3);
}

/* ─────────────────────────────── Draw ──────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, W(), H());
  drawGrid();
  if (state.mode === 'deflection') {
    drawPlates();
    if (state.showField)       drawFieldArrows();
    if (state.showUndeflected) drawUndeflectedPath();
    drawTrajectory();
  } else {
    drawAccelPlates();
    if (state.showField) drawFieldArrows();
    drawAccelTrajectory();
  }
  if (state.showForce) drawForceArrow();
  updateReadouts();
}

/* ─────────────────────────────── Readouts ──────────────────────────── */
function updateReadouts() {
  let Efield, F, a, KE_entry, KE_exit;

  if (state.mode === 'deflection') {
    const ph = calcPhysics();
    ({ Efield, F, a, KE_entry, KE_exit } = ph);
    const el = document.getElementById('readout-y');
    if (ph.hitsPlate) {
      el.textContent = 'Hits plate';
      el.style.color = '#dc2626';
    } else if (Number.isFinite(ph.yCross)) {
      el.textContent = fmtDist(ph.yCross);
      el.style.color = '';
    } else {
      el.textContent = '—';
      el.style.color = '';
    }
    const elR = document.getElementById('readout-range');
    if (ph.hitsPlate) {
      elR.textContent = fmtDist(ph.xRange);
      elR.style.color = '#dc2626';
    } else {
      elR.textContent = 'Clears plates';
      elR.style.color = '';
    }
  } else {
    const ph = calcAccelPhysics();
    ({ Efield, F, a, KE_entry, KE_exit } = ph);
    document.getElementById('readout-v-exit').textContent = fmtSci(ph.v_exit, 'm s⁻¹');
  }

  document.getElementById('readout-e').textContent = fmtSci(Efield, 'V m⁻¹');
  document.getElementById('readout-f').textContent = fmtSci(F, 'N');
  document.getElementById('readout-a').textContent = fmtSci(a, 'm s⁻²');

  document.getElementById('readout-ke-entry-j').textContent  = fmtSci(KE_entry, 'J');
  document.getElementById('readout-ke-entry-ev').textContent = fmtEV(KE_entry);
  document.getElementById('readout-ke-exit-j').textContent   = fmtSci(KE_exit, 'J');
  document.getElementById('readout-ke-exit-ev').textContent  = fmtEV(KE_exit);
}

/* ─────────────────────────────── Slider displays ───────────────────── */
function updateVoltageDisplay() {
  const v = state.V;
  document.getElementById('voltage-display').textContent =
    v === 0    ? '0 V (no field)' :
    v >= 1000  ? `${(v / 1000).toFixed(1)} kV` :
                 `${v} V`;
}

function updateSeparationDisplay() {
  document.getElementById('separation-display').textContent =
    `${(state.d * 100).toFixed(0)} cm`;
}

function updateSpeedDisplay() {
  document.getElementById('speed-display').textContent =
    `${state.v0f.toFixed(1)} × 10${sup(7)} m s⁻¹`;
}

/* ─────────────────────────────── Controls wiring ───────────────────── */

document.getElementById('voltage-slider').addEventListener('input', e => {
  state.V = parseInt(e.target.value, 10);
  updateVoltageDisplay();
  draw();
});

document.getElementById('separation-slider').addEventListener('input', e => {
  state.d = parseInt(e.target.value, 10) / 100;
  updateSeparationDisplay();
  draw();
});

document.getElementById('speed-slider').addEventListener('input', e => {
  state.v0f = parseFloat(e.target.value);
  updateSpeedDisplay();
  draw();
});

document.getElementById('particle-select').addEventListener('change', e => {
  state.particle = e.target.value;
  document.getElementById('custom-charge-group')
    .classList.toggle('is-hidden', state.particle !== 'custom');
  draw();
});

document.getElementById('charge-sign-pos').addEventListener('click', () => {
  state.customSign = +1;
  document.getElementById('charge-sign-pos').classList.add('active');
  document.getElementById('charge-sign-neg').classList.remove('active');
  document.getElementById('charge-sign-pos').setAttribute('aria-pressed', 'true');
  document.getElementById('charge-sign-neg').setAttribute('aria-pressed', 'false');
  draw();
});

function bindSciInput(id, { min, max, integer }, get, apply) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const raw = el.value.trim();
    const n   = integer ? parseInt(raw, 10) : parseFloat(raw);
    const ok  = Number.isFinite(n) && n >= min && n <= max;
    el.classList.toggle('invalid', !ok);
    if (ok) {
      apply(n);
      draw();
    }
  });
  el.addEventListener('blur', () => {
    // Snap back to last valid value if the field is empty/invalid.
    const raw = el.value.trim();
    const n   = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      el.value = integer ? String(get()) : get().toFixed(2);
      el.classList.remove('invalid');
    }
  });
}

bindSciInput('mass-mantissa', { min: 1, max: 9.99, integer: false },
  () => state.customMantissa, v => { state.customMantissa = v; });
bindSciInput('mass-exponent', { min: -31, max: -25, integer: true },
  () => state.customExp, v => { state.customExp = v; });
bindSciInput('charge-mantissa', { min: 1, max: 9.99, integer: false },
  () => state.customQMantissa, v => { state.customQMantissa = v; });
bindSciInput('charge-exponent', { min: -20, max: -15, integer: true },
  () => state.customQExp, v => { state.customQExp = v; });

document.getElementById('charge-sign-neg').addEventListener('click', () => {
  state.customSign = -1;
  document.getElementById('charge-sign-neg').classList.add('active');
  document.getElementById('charge-sign-pos').classList.remove('active');
  document.getElementById('charge-sign-neg').setAttribute('aria-pressed', 'true');
  document.getElementById('charge-sign-pos').setAttribute('aria-pressed', 'false');
  draw();
});

document.getElementById('btn-mode-deflection').addEventListener('click', () => {
  state.mode = 'deflection';
  document.getElementById('btn-mode-deflection').classList.add('active');
  document.getElementById('btn-mode-acceleration').classList.remove('active');
  document.getElementById('btn-mode-deflection').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-mode-acceleration').setAttribute('aria-pressed', 'false');
  document.getElementById('readout-deflection-card').classList.remove('is-hidden');
  document.getElementById('readout-range-card').classList.remove('is-hidden');
  document.getElementById('readout-exit-speed-card').classList.add('is-hidden');
  draw();
});

document.getElementById('btn-mode-acceleration').addEventListener('click', () => {
  state.mode = 'acceleration';
  document.getElementById('btn-mode-acceleration').classList.add('active');
  document.getElementById('btn-mode-deflection').classList.remove('active');
  document.getElementById('btn-mode-acceleration').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-mode-deflection').setAttribute('aria-pressed', 'false');
  document.getElementById('readout-exit-speed-card').classList.remove('is-hidden');
  document.getElementById('readout-deflection-card').classList.add('is-hidden');
  document.getElementById('readout-range-card').classList.add('is-hidden');
  draw();
});

/* ─────────────────────────────── Overlay toggles ───────────────────── */

function applyToggle(stateKey, btnId) {
  state[stateKey] = !state[stateKey];
  const btn = document.getElementById(btnId);
  btn.classList.toggle('active', state[stateKey]);
  btn.setAttribute('aria-pressed', String(state[stateKey]));
  draw();
}

document.getElementById('btn-show-field').addEventListener('click',
  () => applyToggle('showField', 'btn-show-field'));
document.getElementById('btn-show-force').addEventListener('click',
  () => applyToggle('showForce', 'btn-show-force'));
document.getElementById('btn-show-undeflected').addEventListener('click',
  () => applyToggle('showUndeflected', 'btn-show-undeflected'));

/* ─────────────────────────────── Init ──────────────────────────────── */
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  updateVoltageDisplay();
  updateSeparationDisplay();
  updateSpeedDisplay();
});
