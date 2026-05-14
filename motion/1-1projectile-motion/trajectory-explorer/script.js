'use strict';

/* ── Canvas setup ────────────────────────────────────────── */
const canvas  = document.getElementById('sim-canvas');
const ctx     = canvas.getContext('2d');
const CW      = 960;
const BASE_CH = 560;
let   CH      = BASE_CH;

/* ── Physics constants ───────────────────────────────────── */
const G = 9.8;   // m/s²

/* ── Ground / sky layout ─────────────────────────────────── */
// Ground occupies the bottom GROUND_PX pixels of the canvas.
// Everything above is sky.
const GROUND_PX = 60;                   // visual ground strip height (px)
const SKY_PX    = BASE_CH - GROUND_PX; // 500px of sky — fixed regardless of CH

/* ── Config ──────────────────────────────────────────────── */
const cfg = {
  mode:       'single',
  speed:      25,      // m/s
  angle:      45,      // degrees
  vecState:   'hide',  // 'hide' | 'show' | 'dot'  (single: hide/show only; strobe: all three)
  showStats:  false,
  sweepCount: 5,
};

/* ── Dynamic viewport scaling ────────────────────────────── */
// scale  : canvas pixels per metre
// origin : canvas {x, y} corresponding to (0, 0) in world coords
//          x = ball start; y = ground level
let scale  = 1;
let origin = { x: 0, y: 0 };

function computeScale(speed, angle) {
  // Compute the furthest extent of the trajectory in world metres.
  // Add 12% padding on each side.
  const angleRad = angle * Math.PI / 180;
  const vx = speed * Math.cos(angleRad);
  const vy = speed * Math.sin(angleRad);
  const T  = 2 * vy / G;                        // total flight time
  const R  = vx * T;                             // range (m)
  const H  = (vy * vy) / (2 * G);               // max height (m)

  const PAD = 0.12;
  const worldW = R  * (1 + PAD * 2);
  const worldH = H  * (1 + PAD * 2);

  // Choose scale so world fits inside the sky area and canvas width
  const sx = (CW  * (1 - PAD * 2)) / Math.max(worldW, 0.1);
  const sy = (SKY_PX * (1 - PAD))  / Math.max(worldH, 0.1);
  scale = Math.min(sx, sy);

  // Origin: cannon is placed 12% in from the left, at the ground line
  origin.x = CW * PAD;
  origin.y = SKY_PX;   // canvas y of ground (sky/ground boundary)
}

// World → canvas coordinate transform
function wx(x) { return origin.x + x * scale; }
function wy(y) { return origin.y - y * scale; }   // y-axis flipped

/* ── Trajectory maths ────────────────────────────────────── */
function trajectoryParams(speed, angleDeg) {
  const a  = angleDeg * Math.PI / 180;
  const vx = speed * Math.cos(a);
  const vy = speed * Math.sin(a);
  const T  = 2 * vy / G;
  const R  = vx * T;
  const H  = (vy * vy) / (2 * G);
  const tApex = vy / G;
  return { vx, vy, T, R, H, tApex };
}

// World position at time t
function posAt(vx, vy, t) {
  return {
    x: vx * t,
    y: vy * t - 0.5 * G * t * t,
  };
}

// Velocity components at time t
function velAt(vx, vy, t) {
  return { vx, vy: vy - G * t };
}

/* ── Golf ball ───────────────────────────────────────────── */
const BALL_R = 8;   // canvas px radius

function drawGolfBall(cx, cy) {
  ctx.save();
  // White body with subtle shading
  const g = ctx.createRadialGradient(cx - BALL_R * 0.3, cy - BALL_R * 0.35, BALL_R * 0.05,
                                     cx, cy, BALL_R);
  g.addColorStop(0,   '#ffffff');
  g.addColorStop(0.6, '#e8e8e8');
  g.addColorStop(1,   '#c8c8c8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_R, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // Dimples — small dots arranged in a rough pattern
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  const dimples = [
    [-3, -2], [2, -3], [-1, 2], [3, 1], [0, -1],
  ];
  dimples.forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 1.1, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.restore();
}

/* ── Background ──────────────────────────────────────────── */
function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, SKY_PX);
  sky.addColorStop(0, '#4aa8e0');
  sky.addColorStop(1, '#a8d8f0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, SKY_PX);
}

function drawGround() {
  const gnd = ctx.createLinearGradient(0, SKY_PX, 0, CH);
  gnd.addColorStop(0,   '#5a9e3a');
  gnd.addColorStop(0.3, '#4a8a2e');
  gnd.addColorStop(1,   '#3a6e22');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, SKY_PX, CW, CH - SKY_PX);   // fills to bottom of canvas

  // Grass edge highlight
  ctx.strokeStyle = '#6abb44';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(0, SKY_PX);
  ctx.lineTo(CW, SKY_PX);
  ctx.stroke();
}

function drawBackground() {
  drawSky();
  drawGround();
}

/* ── Arrow / label helpers ───────────────────────────────── */
function arrow(x1, y1, x2, y2, col, lw = 2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len, uy = dy / len;
  const headLen = Math.min(10, len * 0.4);
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - ux * headLen * 0.7, y2 - uy * headLen * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * headLen - uy * headLen * 0.4, y2 - uy * headLen + ux * headLen * 0.4);
  ctx.lineTo(x2 - ux * headLen + uy * headLen * 0.4, y2 - uy * headLen - ux * headLen * 0.4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function canvasLabel(x, y, text, col, align = 'left', baseline = 'middle', sz = 13) {
  ctx.save();
  ctx.fillStyle    = col;
  ctx.font         = `bold ${sz}px "Trebuchet MS", sans-serif`;
  ctx.textAlign    = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ── Mode text ───────────────────────────────────────────── */
const MODE_TEXT = {
  single: {
    intro:   'A projectile moves freely under gravity. Its horizontal velocity stays constant while its vertical velocity changes at a steady rate — the two components are completely independent.',
    explain: 'Horizontal: no force acts, so <em>v</em><sub>h</sub> is constant. Vertical: gravity acts downward, so <em>v</em><sub>v</sub> decreases, reaches zero at the apex, then increases downward. Range is maximised at 45° — and complementary angles (e.g. 30° and 60°) give the same range.',
  },
  sweep: {
    intro:   'Firing at different angles with the same launch speed reveals how angle affects range and height. Complementary angles — pairs that add to 90° — always give the same horizontal range.',
    explain: 'Range R\u202f=\u202fv²sin(2θ)/g. Because sin(2θ)\u202f=\u202fsin(180°\u202f−\u202f2θ), complementary angles θ and (90°\u202f−\u202fθ) give identical ranges. Maximum range occurs at 45° where sin(90°)\u202f=\u202f1.',
  },
  strobe: {
    intro:   'A stroboscopic view freezes the projectile at equal time intervals. The equal horizontal spacing shows constant v\u2095; the changing vertical spacing reveals the effect of gravity.',
    explain: 'Equal time gaps mean equal horizontal distances — confirming constant v<sub>h</sub>. Vertical gaps increase going down and decrease going up, directly showing gravitational acceleration. The apex is always the middle image.',
  },
};

/* ── DOM refs ────────────────────────────────────────────── */
const fireBtn        = document.getElementById('btn-fire');
const sliderSpeed    = document.getElementById('slider-speed');
const sliderAngle    = document.getElementById('slider-angle');
const numSpeed       = document.getElementById('num-speed');
const numAngle       = document.getElementById('num-angle');
const sliderSweep    = document.getElementById('slider-sweep');
const sweepCountLbl  = document.getElementById('sweep-count-label');
const scrubberEl     = document.getElementById('scrubber');
const scrubberTime   = document.getElementById('scrubber-time');

/* ── Control sync helpers ────────────────────────────────── */
function inFlight() { return launched && !flightDone; }

function syncSpeed(v) {
  cfg.speed = Math.max(5, Math.min(50, +v));
  sliderSpeed.value = cfg.speed;
  numSpeed.value    = cfg.speed;
  if (inFlight()) return;   // don't disturb scale or redraw mid-flight
  computeScale(cfg.speed, cfg.angle);
  onParamsChanged();
}

function syncAngle(v) {
  cfg.angle = Math.max(0, Math.min(90, +v));
  sliderAngle.value = cfg.angle;
  numAngle.value    = cfg.angle;
  if (inFlight()) return;
  computeScale(cfg.speed, cfg.angle);
  onParamsChanged();
}

sliderSpeed.addEventListener('input', () => syncSpeed(sliderSpeed.value));
numSpeed.addEventListener('change',   () => syncSpeed(numSpeed.value));
sliderAngle.addEventListener('input', () => syncAngle(sliderAngle.value));
numAngle.addEventListener('change',   () => syncAngle(numAngle.value));

function syncSweep(raw) {
  let v = parseFloat(raw);
  if (isNaN(v)) { sweepCountLbl.value = cfg.sweepCount; return; }
  v = Math.max(3, Math.min(11, Math.round(v)));
  if (v % 2 === 0) v = Math.min(11, v + 1);
  cfg.sweepCount = v;
  sliderSweep.value = v;
  sweepCountLbl.value = v;
  onParamsChanged();
}
sliderSweep.addEventListener('input', () => syncSweep(sliderSweep.value));
sweepCountLbl.addEventListener('change', () => syncSweep(sweepCountLbl.value));

/* ── Simulation state ────────────────────────────────────── */
let animId    = null;   // rAF handle
let launched  = false;  // true once Fire has been pressed this session
let flightT   = 0;      // current animation time (s)
let flightDone= false;  // true once ball has landed

// Precomputed full trace (canvas points) for current launch params
let fullTrace  = [];    // [{cx, cy}] across full flight at fixed time steps
let launchCX   = 0;    // canvas x of muzzle at fire time
let launchCY   = 0;    // canvas y of muzzle at fire time
const TRACE_STEPS = 300;

// Stroboscopic state
let strobePositions   = [];       // [{cx, cy, vxNow, vyNow}] — 11 equal-time snapshots
let strobeClickedDots = new Set(); // indices of dots with vectors shown in 'dot' mode

// Convert world coords to canvas using the muzzle as the drawing origin
function bx(worldX) { return launchCX + worldX * scale; }
function by(worldY) { return launchCY - worldY * scale; }

function buildFullTrace(vx, vy, T) {
  fullTrace = [];
  for (let i = 0; i <= TRACE_STEPS; i++) {
    const t = (i / TRACE_STEPS) * T;
    const p = posAt(vx, vy, t);
    fullTrace.push({ cx: bx(p.x), cy: by(p.y) });
  }
}

function resetSim() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  if (CH !== BASE_CH) { CH = BASE_CH; canvas.height = CH; }
  launched   = false;
  flightT    = 0;
  flightDone = false;
  fullTrace         = [];
  sweepTrajectories = [];
  hoveredTraj       = null;
  strobePositions   = [];
  strobeClickedDots.clear();
  scrubberEl.value          = 0;
  scrubberEl.disabled       = true;
  scrubberTime.textContent  = '0.00';
  computeScale(cfg.speed, cfg.angle);
  drawStatic();
}

/* ── setMode ─────────────────────────────────────────────── */
function setMode(mode) {
  cfg.mode = mode;
  document.querySelectorAll('#seg-mode .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.val === mode));

  const t = MODE_TEXT[mode];
  document.getElementById('hero-intro').textContent  = t.intro;
  document.getElementById('explain-body').innerHTML  = t.explain;

  // Show/hide mode-specific controls
  document.getElementById('sweep-controls').classList.toggle('hidden',  mode !== 'sweep');
  document.getElementById('vector-controls').classList.toggle('hidden', mode !== 'single');
  document.getElementById('strobe-hint').classList.toggle('hidden',     mode !== 'strobe');
  document.getElementById('stats-controls').classList.toggle('hidden',  mode !== 'single');
  document.getElementById('scrubber-row').classList.toggle('hidden',    mode !== 'single');

  // Reset vec state whenever mode changes
  cfg.vecState = 'hide';
  document.querySelectorAll('#seg-vectors .seg-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.val === 'hide'));

  resetSim();
}

/* ── onParamsChanged — redraw static preview ─────────────── */
function onParamsChanged() {
  if (cfg.mode === 'sweep' && sweepTrajectories.length > 0) {
    buildSweep();
    drawSweep();
  } else if (!launched || flightDone) {
    resetSim();
  }
}

/* ── Static draw (pre-fire) ──────────────────────────────── */
function drawStatic() {
  drawSky();
  drawGround();
  drawGolfBall(origin.x, origin.y - BALL_R);
  drawVelocityArrow();
}

/* ── Ball ────────────────────────────────────────────────── */
function drawBall(cx, cy) {
  drawGolfBall(cx, cy);
}

/* ── Landing marker ──────────────────────────────────────── */
function drawLandingMarker(cx) {
  const y = origin.y;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,80,80,0.85)';
  ctx.lineWidth   = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y - 18);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle    = 'rgba(255,80,80,0.9)';
  ctx.font         = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('R', cx, y - 20);
  ctx.restore();
}

/* ── Component velocity vectors ──────────────────────────── */
const COMP_SCALE = 5;   // canvas px per m/s for in-flight vectors

function drawComponentVectors(cx, cy, vxNow, vyNow) {
  const hLen = vxNow * COMP_SCALE;
  const vLen = vyNow * COMP_SCALE;   // positive = upward in world → negative canvas y

  // v_h — horizontal, always rightward
  if (Math.abs(hLen) > 2) {
    arrow(cx, cy, cx + hLen, cy, '#1d4ed8', 2);
    canvasLabel(cx + hLen + 5, cy, 'vₕ', '#1d4ed8', 'left', 'middle', 11);
  }

  // v_v — vertical
  if (Math.abs(vLen) > 2) {
    arrow(cx, cy, cx, cy - vLen, '#f472b6', 2);
    const lblY = vLen > 0 ? cy - vLen - 6 : cy - vLen + 14;
    canvasLabel(cx + 5, lblY, 'vᵥ', '#f472b6', 'left', 'middle', 11);
  }
}

/* ── Stats panel ─────────────────────────────────────────── */
function drawStats(R, H, T) {
  const lines = [
    `Range:       ${R.toFixed(1)} m`,
    `Max height:  ${H.toFixed(1)} m`,
    `Flight time: ${T.toFixed(2)} s`,
  ];
  const PX = 14, PY = 14;
  const LH = 20, PAD = 10;
  const W = 190, H_BOX = lines.length * LH + PAD * 2;
  const bx = CW - W - PX, by = PY;

  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.82)';
  ctx.strokeStyle = 'rgba(21,48,77,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, W, H_BOX, 10);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle    = '#15304d';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + PAD, by + PAD + i * LH));
  ctx.restore();
}

/* ── Trace drawing ───────────────────────────────────────── */
function drawTraceTo(stepIndex) {
  if (fullTrace.length < 2 || stepIndex < 1) return;
  const end = Math.min(stepIndex, fullTrace.length - 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,220,50,0.75)';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(fullTrace[0].cx, fullTrace[0].cy);
  for (let i = 1; i <= end; i++) {
    ctx.lineTo(fullTrace[i].cx, fullTrace[i].cy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFullTraceFaint() {
  if (fullTrace.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,220,50,0.22)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(fullTrace[0].cx, fullTrace[0].cy);
  for (let i = 1; i < fullTrace.length; i++) {
    ctx.lineTo(fullTrace[i].cx, fullTrace[i].cy);
  }
  ctx.stroke();
  ctx.restore();
}

/* ── Single launch draw ──────────────────────────────────── */
function drawSingleAt(t, params) {
  const { vx, vy, T, R, H } = params;
  const pos = posAt(vx, vy, t);
  const vel = velAt(vx, vy, t);
  const traceIdx = Math.round((t / T) * TRACE_STEPS);

  drawSky();
  drawGround();
  drawFullTraceFaint();
  drawTraceTo(traceIdx);
  if (cfg.vecState !== 'hide') drawComponentVectors(bx(pos.x), by(pos.y), vel.vx, vel.vy);
  drawBall(bx(pos.x), by(pos.y));
  if (flightDone) {
    drawLandingMarker(bx(R));
    if (cfg.showStats) drawStats(R, H, T);
  }
}

/* ── Fire — single launch ────────────────────────────────── */
function fireSingle() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  launched   = true;
  flightDone = false;
  flightT    = 0;
  scrubberEl.disabled = true;
  scrubberEl.value    = 0;

  computeScale(cfg.speed, cfg.angle);
  launchCX = origin.x;
  launchCY = origin.y - BALL_R;
  const params = trajectoryParams(cfg.speed, cfg.angle);
  buildFullTrace(params.vx, params.vy, params.T);

  let lastTs = null;
  function step(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    flightT += dt;
    if (flightT >= params.T) {
      flightT    = params.T;
      flightDone = true;
    }

    scrubberEl.value         = Math.round((flightT / params.T) * 1000);
    scrubberTime.textContent = flightT.toFixed(2);

    drawSingleAt(flightT, params);

    if (!flightDone) {
      animId = requestAnimationFrame(step);
    } else {
      animId = null;
      scrubberEl.disabled = false;
    }
  }
  animId = requestAnimationFrame(step);
}

/* ── Stroboscopic launch ─────────────────────────────────── */
function fireStrobe() {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  computeScale(cfg.speed, cfg.angle);

  // Extend canvas below ground to fit the downward vᵥ arrow on the final dot
  const vyLanding = cfg.speed * Math.sin(cfg.angle * Math.PI / 180);
  const extraBottom = Math.ceil(vyLanding * COMP_SCALE) + 20;
  CH = BASE_CH + extraBottom;
  canvas.height = CH;

  launchCX = origin.x;
  launchCY = origin.y - BALL_R;
  const params = trajectoryParams(cfg.speed, cfg.angle);
  buildFullTrace(params.vx, params.vy, params.T);

  strobePositions = [];
  strobeClickedDots.clear();
  const DT = params.T / 10;
  for (let i = 0; i <= 10; i++) {
    const t   = i * DT;
    const pos = posAt(params.vx, params.vy, t);
    const vel = velAt(params.vx, params.vy, t);
    strobePositions.push({ cx: bx(pos.x), cy: by(pos.y), vxNow: vel.vx, vyNow: vel.vy });
  }

  launched   = true;
  flightDone = true;
  drawStrobe();
}

function drawStrobe() {
  drawSky();
  drawGround();
  drawFullTraceFaint();

  // Vectors drawn first so balls sit on top
  strobePositions.forEach((pt, i) => {
    if (strobeClickedDots.has(i)) drawComponentVectors(pt.cx, pt.cy, pt.vxNow, pt.vyNow);
  });

  // Balls on top
  strobePositions.forEach(pt => drawGolfBall(pt.cx, pt.cy));
}

function handleStrobeDotClick(e) {
  if (strobePositions.length === 0) return;
  const { mx, my } = canvasCoords(e);
  let changed = false;
  strobePositions.forEach((pt, i) => {
    if (Math.hypot(mx - pt.cx, my - pt.cy) <= BALL_R + 8) {
      if (strobeClickedDots.has(i)) strobeClickedDots.delete(i);
      else strobeClickedDots.add(i);
      changed = true;
    }
  });
  if (changed) drawStrobe();
}

/* ── Velocity arrow on canvas ───────────────────────────── */
const VEC_SCALE = 4;   // canvas px per m/s for the preview arrow

function drawVelocityArrow() {
  const a   = cfg.angle * Math.PI / 180;
  const len = cfg.speed * VEC_SCALE;
  const x1  = origin.x;
  const y1  = origin.y;
  const x2  = x1 + Math.cos(a) * len;
  const y2  = y1 - Math.sin(a) * len;
  arrow(x1, y1, x2, y2, 'rgba(255,220,50,0.9)', 2.5);
  canvasLabel(x2 + 6, y2, `${cfg.speed} m/s`, 'rgba(255,220,50,0.95)', 'left', 'middle', 12);
}

/* ── Angle sweep ─────────────────────────────────────────── */
// Colours for complementary pairs, ordered outward from 45°
const SWEEP_PAIR_COLS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#06b6d4'];
const SWEEP_45_COL   = '#f59e0b';

let sweepTrajectories = [];   // [{angle, col, points, params}]
let hoveredTraj       = null;

function getSweepAngles() {
  const n    = cfg.sweepCount;
  const half = (n - 1) / 2;
  const step = half > 0 ? 45 / half : 0;   // spans 0°–90° symmetrically around 45°
  return Array.from({ length: n }, (_, i) => i * step);
}

function computeScaleSweep() {
  const PAD = 0.10;
  let maxR = 0, maxH = 0;
  getSweepAngles().forEach(a => {
    const { R, H } = trajectoryParams(cfg.speed, a);
    maxR = Math.max(maxR, R);
    maxH = Math.max(maxH, H);
  });
  const sx = (CW  * (1 - PAD * 2)) / Math.max(maxR, 0.1);
  const sy = (SKY_PX * (1 - PAD))  / Math.max(maxH, 0.1);
  scale    = Math.min(sx, sy);
  origin.x = CW * PAD;
  origin.y = SKY_PX;
}

function buildSweep() {
  computeScaleSweep();
  sweepTrajectories = [];
  const angles = getSweepAngles();
  const mid    = Math.floor(angles.length / 2);   // index of 45°
  angles.forEach((angle, i) => {
    const pairIdx = Math.abs(i - mid) - 1;         // 0-based distance from 45°
    const col     = i === mid
      ? SWEEP_45_COL
      : SWEEP_PAIR_COLS[pairIdx % SWEEP_PAIR_COLS.length];
    const params  = trajectoryParams(cfg.speed, angle);
    const pts     = [];
    for (let j = 0; j <= 200; j++) {
      const t = (j / 200) * params.T;
      const p = posAt(params.vx, params.vy, t);
      pts.push({ cx: wx(p.x), cy: wy(p.y) });
    }
    sweepTrajectories.push({ angle, col, points: pts, params });
  });
}

function drawSweepTrajectory(traj, hovered) {
  const pts = traj.points;
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = traj.col;
  ctx.lineWidth   = hovered ? 3 : 1.8;
  ctx.globalAlpha = hovered ? 1 : 0.7;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].cx, pts[0].cy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
  ctx.stroke();
  ctx.restore();
}

function drawSweepStats(traj) {
  const { angle, col, params: { R, H, T } } = traj;
  const lines = [
    `Angle:       ${angle.toFixed(1)}°`,
    `Range:       ${R.toFixed(1)} m`,
    `Max height:  ${H.toFixed(1)} m`,
    `Flight time: ${T.toFixed(2)} s`,
  ];
  const PX = 14, PY = 14, LH = 20, PAD = 10;
  const W = 190, HB = lines.length * LH + PAD * 2;
  const bx = CW - W - PX, by = PY;
  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = col;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, W, HB, 10);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle    = '#15304d';
  ctx.font         = '12px "Trebuchet MS", sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + PAD, by + PAD + i * LH));
  ctx.restore();
}

function drawSweep() {
  drawSky();
  drawGround();
  sweepTrajectories.forEach(t => drawSweepTrajectory(t, t === hoveredTraj));
  if (hoveredTraj) drawSweepStats(hoveredTraj);
}

// Convert a mouse event to canvas coordinates
function canvasCoords(e) {
  const rect  = canvas.getBoundingClientRect();
  return {
    mx: (e.clientX - rect.left)  * (CW / rect.width),
    my: (e.clientY  - rect.top)  * (CH / rect.height),
  };
}

// Distance from point (mx,my) to a polyline — returns min dist²
function distSqToPolyline(mx, my, pts) {
  let minD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].cx,   ay = pts[i].cy;
    const bx = pts[i+1].cx, by = pts[i+1].cy;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx*dx + dy*dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((mx-ax)*dx + (my-ay)*dy) / lenSq)) : 0;
    const px = ax + t*dx - mx, py = ay + t*dy - my;
    minD = Math.min(minD, px*px + py*py);
  }
  return minD;
}

/* ── Canvas drag to set angle + speed ───────────────────── */
let dragging = false;

canvas.addEventListener('mousedown', e => {
  if (cfg.mode === 'strobe' && launched) {
    handleStrobeDotClick(e);
    return;
  }
  dragging = true;
  handleCanvasDrag(e);
});
canvas.addEventListener('mousemove', e => {
  if (dragging) { handleCanvasDrag(e); return; }
  if (cfg.mode === 'sweep' && sweepTrajectories.length > 0) {
    const { mx, my } = canvasCoords(e);
    const THRESH_SQ  = 12 * 12;   // 12px snap radius
    let best = null, bestD = Infinity;
    sweepTrajectories.forEach(t => {
      const d = distSqToPolyline(mx, my, t.points);
      if (d < bestD) { bestD = d; best = t; }
    });
    const prev = hoveredTraj;
    hoveredTraj = bestD < THRESH_SQ ? best : null;
    if (hoveredTraj !== prev) drawSweep();
  }
});
canvas.addEventListener('mouseup',   () => { dragging = false; });
canvas.addEventListener('mouseleave',() => { dragging = false; });

canvas.addEventListener('touchstart', e => { dragging = true;  handleCanvasDrag(e.touches[0]); }, { passive: true });
canvas.addEventListener('touchmove',  e => { if (dragging) handleCanvasDrag(e.touches[0]); },     { passive: true });
canvas.addEventListener('touchend',   () => { dragging = false; });

function handleCanvasDrag(e) {
  if (cfg.mode === 'sweep') return;
  if (cfg.mode === 'strobe' && launched) return;   // strobe already fired
  const { mx, my } = canvasCoords(e);

  // Angle = direction from ball start (muzzle) to pointer
  const dx = mx - origin.x;
  const dy = origin.y - my;   // flip y
  if (dx < 5) return;         // ignore if pointer is left of launch point
  const newAngle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  const newSpeed = Math.round(Math.hypot(dx, dy) / VEC_SCALE);
  syncAngle(Math.max(0, Math.min(90, newAngle)));
  syncSpeed(Math.max(5, Math.min(50, newSpeed)));
}

/* ── Mode selector ───────────────────────────────────────── */
document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.val === cfg.mode) return;
    setMode(btn.dataset.val);
  });
});

/* ── Fire button ─────────────────────────────────────────── */
fireBtn.addEventListener('click', () => {
  if (cfg.mode === 'single') fireSingle();
  if (cfg.mode === 'sweep')  { buildSweep(); drawSweep(); }
  if (cfg.mode === 'strobe') fireStrobe();
});

/* ── Scrubber ────────────────────────────────────────────── */
scrubberEl.addEventListener('input', () => {
  if (!flightDone || fullTrace.length === 0) return;
  const params = trajectoryParams(cfg.speed, cfg.angle);
  flightT = (scrubberEl.value / 1000) * params.T;
  scrubberTime.textContent = flightT.toFixed(2);
  drawSingleAt(flightT, params);
});

/* ── Vector + stats toggles ──────────────────────────────── */
document.querySelectorAll('#seg-vectors .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.vecState = btn.dataset.val;
    document.querySelectorAll('#seg-vectors .seg-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    if (flightDone && cfg.mode === 'single') {
      drawSingleAt(flightT, trajectoryParams(cfg.speed, cfg.angle));
    } else if (!launched) drawStatic();
  });
});

document.querySelectorAll('#seg-stats .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.showStats = btn.dataset.val === 'show';
    document.querySelectorAll('#seg-stats .seg-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    if (flightDone && cfg.mode === 'single') {
      drawSingleAt(flightT, trajectoryParams(cfg.speed, cfg.angle));
    } else if (!launched) drawStatic();
  });
});

/* ── Reset button ────────────────────────────────────────── */
document.getElementById('btn-reset').addEventListener('click', () => resetSim());

/* ── Boot ────────────────────────────────────────────────── */
computeScale(cfg.speed, cfg.angle);
drawStatic();
requestAnimationFrame(() => {});   // warm up rAF
