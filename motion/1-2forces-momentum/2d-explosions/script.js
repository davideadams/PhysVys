/* ═══════════════════════════════════════════════════════════════
   2D Explosions  —  script.js
   Initial momentum = 0.  Fragments fly outward.
   For N fragments, momenta form a closed polygon (triangle for N=3).
═══════════════════════════════════════════════════════════════ */

const CW = 960, CH = 560;

const COLORS = ['#2563eb', '#dc2626', '#d97706'];

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Preset scenarios ────────────────────────────────────────── */
// Angles and speeds are chosen so momenta sum to zero.
// For 3 equal masses at 120°: equilateral momentum triangle.
// For 2 fragments: always opposite directions (180°), scale speeds by mass ratio.
// For 3 unequal masses: angles/speeds chosen so ΣpᵢVECTOR = 0.

const PRESETS = [
  {
    label: '2 fragments — equal mass',
    note: 'Two equal fragments fly apart in opposite directions. Momentum vectors are equal and opposite (degenerate triangle — a straight line).',
    numFragments: 2,
    fragments: [
      { mass: 1, angle:   0, speed: 200 },
      { mass: 1, angle: 180, speed: 200 },
    ],
  },
  {
    label: '2 fragments — unequal mass (1:2)',
    note: 'The lighter fragment moves twice as fast. The momentum vectors are equal and opposite — still a straight line, but the arrows have different lengths.',
    numFragments: 2,
    fragments: [
      { mass: 1, angle:   0, speed: 300 },
      { mass: 2, angle: 180, speed: 150 },  // 1×300 = 2×150 ✓
    ],
  },
  {
    label: '3 fragments — equal mass (equilateral)',
    note: 'Three equal fragments at 120° apart. Each momentum vector has the same magnitude — the triangle is equilateral.',
    numFragments: 3,
    fragments: [
      { mass: 1, angle:   90, speed: 200 },
      { mass: 1, angle:  210, speed: 200 },
      { mass: 1, angle:  330, speed: 200 },
    ],
  },
  {
    label: '3 fragments — unequal mass',
    note: 'Unequal masses. Fragment C is whatever direction and speed makes the momenta sum to zero — the triangle is scalene.',
    numFragments: 3,
    fragments: [
      { mass: 1, angle:   0, speed: 200 },
      { mass: 2, angle: 150, speed: 200 },
      { mass: 3, angle:   0, speed: 0 },   // last fragment is always derived
    ],
  },
];

/* ── Derive fragment momentum from angle + speed ─────────────── */
function resolveFragment(frag) {
  const rad = frag.angle * Math.PI / 180;
  frag.px = frag.mass * frag.speed * Math.cos(rad);
  frag.py = -frag.mass * frag.speed * Math.sin(rad);  // canvas y-flip
  frag.vx = frag.px / frag.mass;
  frag.vy = frag.py / frag.mass;
}

/* ── Derive the last fragment from momentum conservation ─────── */
function recomputeDerivedFragment(presetIdx) {
  const frags = PRESETS[presetIdx].fragments;
  const n     = frags.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n - 1; i++) { sx += frags[i].px; sy += frags[i].py; }
  const last = frags[n - 1];
  last.px    = -sx;
  last.py    = -sy;
  last.vx    = last.px / last.mass;
  last.vy    = last.py / last.mass;
  last.speed = Math.hypot(last.vx, last.vy);
  last.angle = Math.atan2(-last.vy, last.vx) * 180 / Math.PI;
}

PRESETS.forEach((p, idx) => {
  for (let i = 0; i < p.fragments.length - 1; i++) resolveFragment(p.fragments[i]);
  recomputeDerivedFragment(idx);
});

/* ── Simulation state ────────────────────────────────────────── */
let cfg = {
  presetIdx:      0,
  strobeInterval: 0.40,
  mode:           'animation',  // 'animation' | 'strobe'
  vectorMode:     'none',
  showTriangle:   false,
  showLabels:     false,
};

let particles     = [];
let snapshots     = [];
let simTime       = 0;
let running       = true;
let exploded      = false;
let explodeTime   = 0.8;   // seconds before explosion
let lastTs        = null;
let lastStrobe    = -99;

function radius(mass) { return Math.max(12, 14 * Math.sqrt(mass)); }

/* ── Build fragments ─────────────────────────────────────────── */
function buildParticles() {
  const preset = PRESETS[cfg.presetIdx];
  const cx = CW / 2, cy = CH / 2;

  exploded = false;

  // Pre-explosion: single stationary object
  particles = [{
    id:    -1,
    mass:  preset.fragments.reduce((s, f) => s + f.mass, 0),
    x:     cx, y: cy,
    vx:    0,  vy: 0,
    r:     radius(preset.fragments.reduce((s, f) => s + f.mass, 0)),
    color: '#55708d',
    label: '?',
    alive: true,
    isSource: true,
  }];
}

function doExplosion() {
  const preset = PRESETS[cfg.presetIdx];
  const cx = CW / 2, cy = CH / 2;

  // Replace source with fragments
  particles = preset.fragments.map((f, i) => ({
    id:    i,
    mass:  f.mass,
    x:     cx, y: cy,
    vx:    f.vx, vy: f.vy,
    r:     radius(f.mass),
    color: COLORS[i],
    label: ['A', 'B', 'C'][i],
    alive: true,
    isSource: false,
  }));
  exploded = true;
}

/* ── Advance ─────────────────────────────────────────────────── */
function advance(dt) {
  simTime += dt;

  if (!exploded && simTime >= explodeTime) {
    doExplosion();
    lastStrobe = simTime;  // start strobe interval from explosion, not from t=0
  }

  if (exploded) {
    particles.forEach(p => {
      if (!p.alive) return;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Remove particles that have fully left the canvas
      if (p.x + p.r < 0 || p.x - p.r > CW || p.y + p.r < 0 || p.y - p.r > CH) {
        p.alive = false;
      }
    });
  }

  // Strobe capture
  if (simTime - lastStrobe >= cfg.strobeInterval) {
    snapshots.push({ t: simTime, ps: particles.filter(p => p.alive).map(p => ({ ...p })) });
    lastStrobe = simTime;
  }
}

/* ── Drawing helpers ─────────────────────────────────────────── */
function arrowHead(x2, y2, ux, uy, hs) {
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hs * (ux - 0.38 * uy), y2 - hs * (uy + 0.38 * ux));
  ctx.lineTo(x2 - hs * (ux + 0.38 * uy), y2 - hs * (uy - 0.38 * ux));
  ctx.closePath();
  ctx.fill();
}

function arrow(x1, y1, x2, y2, col, width = 2.5) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len;
  const hs = Math.min(13, len * 0.35);
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  arrowHead(x2, y2, ux, uy, hs);
  ctx.restore();
}

function lbl(text, x, y, opts = {}) {
  ctx.save();
  ctx.font         = opts.font  || '700 12px "Trebuchet MS", sans-serif';
  ctx.fillStyle    = opts.color || '#15304d';
  ctx.textAlign    = opts.align || 'center';
  ctx.textBaseline = opts.base  || 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ── Draw one particle ───────────────────────────────────────── */
function drawParticle(p, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 8;
  ctx.fillStyle   = p.color;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.stroke();

  ctx.fillStyle    = 'white';
  ctx.font         = `700 ${Math.max(11, p.r * 0.7)}px "Trebuchet MS",sans-serif`;
  ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.label, p.x, p.y);

  if (cfg.showLabels && !p.isSource) {
    ctx.fillStyle = p.color;
    ctx.font = '700 11px "Trebuchet MS",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`m=${p.mass}`, p.x, p.y + p.r + 4);
  }
  ctx.restore();
}

/* ── Draw source flash ───────────────────────────────────────── */
function drawExplosionFlash(cx, cy, t) {
  // t goes 0→1 during the flash
  const r = 40 * t;
  ctx.save();
  ctx.globalAlpha = 0.6 * (1 - t);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, '#fffbe0');
  g.addColorStop(1, 'rgba(255,200,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

/* ── Draw vectors for particle ───────────────────────────────── */
const VEC_SCALE_V = 0.28;
const VEC_SCALE_P = 0.20;

function drawVector(p, alpha = 1) {
  if (cfg.vectorMode === 'none' || p.isSource) return;
  const isV = cfg.vectorMode === 'velocity';
  const qx = isV ? p.vx * VEC_SCALE_V : p.mass * p.vx * VEC_SCALE_P;
  const qy = isV ? p.vy * VEC_SCALE_V : p.mass * p.vy * VEC_SCALE_P;
  if (Math.hypot(qx, qy) < 3) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  arrow(p.x, p.y, p.x + qx, p.y + qy, p.color, 2.5);
  if (cfg.showLabels) {
    const mag = isV
      ? `v=${Math.hypot(p.vx, p.vy).toFixed(0)}`
      : `p=${(p.mass * Math.hypot(p.vx, p.vy)).toFixed(0)}`;
    lbl(mag, p.x + qx + 14, p.y + qy, { color: p.color, font: '700 11px "Trebuchet MS",sans-serif', align: 'left' });
  }
  ctx.restore();
}

/* ── Draw strobe ─────────────────────────────────────────────── */
function drawStrobe() {
  const N = snapshots.length;
  if (N === 0) return;

  // Draw trajectory paths between consecutive positions for each particle id
  const ids = new Set(snapshots.flatMap(s => s.ps.map(p => p.id)));
  ids.forEach(id => {
    const pts = snapshots.map(s => s.ps.find(p => p.id === id)).filter(Boolean);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = pts[0].color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // Draw ghost images — show all snapshots, oldest slightly more transparent
  snapshots.forEach((snap, si) => {
    const alpha = 0.40 + 0.50 * (si / Math.max(1, N - 1));
    snap.ps.forEach(p => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      // Centre dot for measurement
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = p.color;
      // Direction-of-motion arrow
      if (!p.isSource) {
        const spd = Math.hypot(p.vx, p.vy);
        if (spd > 1) {
          const ux = p.vx / spd, uy = p.vy / spd;
          const ALEN = 28;
          arrow(p.x + ux * p.r, p.y + uy * p.r,
                p.x + ux * (p.r + ALEN), p.y + uy * (p.r + ALEN),
                p.color, 1.5);
          ctx.globalAlpha = alpha; // arrow() restores state, re-assert alpha
        }
      }
      if (cfg.vectorMode !== 'none' && !p.isSource) drawVector(p, alpha * 0.8);
      ctx.restore();
    });
  });

  // Current positions
  particles.forEach(p => { drawParticle(p); drawVector(p); });
}

/* ── Momentum triangle ───────────────────────────────────────── */
function drawMomentumTriangle() {
  if (!exploded) return;

  const preset = PRESETS[cfg.presetIdx];
  const frags  = preset.fragments;

  const PW = 220, PH = 210;
  const px0 = CW - PW - 14, py0 = 14;

  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(21,48,77,0.14)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(px0, py0, PW, PH, 12);
  ctx.fill(); ctx.stroke();

  lbl('Momentum triangle', px0 + PW / 2, py0 + 14, { font: '700 12px "Trebuchet MS",sans-serif', color: '#15304d' });
  lbl('(sums to zero)', px0 + PW / 2, py0 + 28, { font: '12px "Trebuchet MS",sans-serif', color: '#55708d' });

  // Scale to fit in panel
  const maxP = Math.max(...frags.map(f => Math.hypot(f.px, f.py)), 1);
  const sc   = ((Math.min(PW, PH) - 50) * 0.5) / maxP;

  // Draw vectors tip-to-tail (they close because sum = 0)
  // Start at centroid of panel
  const ox = px0 + PW / 2, oy = py0 + PH / 2 + 14;
  let cx = ox, cy = oy;
  frags.forEach((f, i) => {
    const ex = cx + f.px * sc, ey = cy + f.py * sc;
    arrow(cx, cy, ex, ey, COLORS[i], 2);
    if (cfg.showLabels) {
      lbl(`p${['A','B','C'][i]}`, (cx + ex) / 2 + 10, (cy + ey) / 2, { color: COLORS[i], font: '700 10px "Trebuchet MS",sans-serif', align: 'left' });
    }
    cx = ex; cy = ey;
  });

  // The triangle closes: last point should return to ox, oy.
  // Draw a tiny dot to confirm closure.
  ctx.save();
  ctx.fillStyle = 'rgba(21,48,77,0.4)';
  ctx.beginPath(); ctx.arc(ox, oy, 4, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();

  // Check if equilateral (all sides equal within 3%)
  const sides = frags.map(f => Math.hypot(f.px, f.py));
  const avgSide = sides.reduce((a, b) => a + b, 0) / sides.length;
  const isEquilateral = sides.every(s => Math.abs(s - avgSide) / avgSide < 0.04);
  if (isEquilateral && frags.length === 3) {
    lbl('equilateral', px0 + PW / 2, py0 + PH - 12, { color: '#0d9488', font: '700 11px "Trebuchet MS",sans-serif' });
  }

  ctx.restore();
}

/* ── Main draw ───────────────────────────────────────────────── */
function draw() {
  ctx.fillStyle = '#f0f4ff';
  ctx.fillRect(0, 0, CW, CH);

  // Grid
  ctx.save();
  ctx.strokeStyle = 'rgba(21,48,77,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x <= CW; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
  for (let y = 0; y <= CH; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }
  ctx.restore();

  // Explosion flash
  if (exploded && simTime - explodeTime < 0.35) {
    drawExplosionFlash(CW / 2, CH / 2, (simTime - explodeTime) / 0.35);
  }

  if (cfg.mode === 'strobe') {
    drawStrobe();
  } else {
    particles.forEach(p => { drawVector(p); drawParticle(p); });
  }

  if (cfg.showTriangle) drawMomentumTriangle();

  // Mode badge
  const modeText = cfg.mode === 'strobe' ? 'Strobe mode' : 'Animation mode';
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(21,48,77,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(14, 14, 130, 30, 8); ctx.fill(); ctx.stroke();
  lbl(modeText, 79, 29, { color: '#55708d', font: '700 12px "Trebuchet MS",sans-serif' });
  ctx.restore();
}

/* ── Animation loop ──────────────────────────────────────────── */
function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.04);
  lastTs = ts;

  if (running && cfg.mode === 'animation') advance(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ── Reset ───────────────────────────────────────────────────── */
function reset() {
  buildParticles();
  snapshots  = [];
  simTime    = 0;
  lastStrobe = -99;
  lastTs     = null;
  exploded   = false;
  running    = true;
}

/* ── Pre-generate strobe ─────────────────────────────────────── */
function generateStrobe() {
  reset();
  running = false;
  const dt = 0.001;
  for (let i = 0; i < 12000; i++) {
    advance(dt);
    // Stop once all fragments have left the canvas
    if (exploded && particles.every(p => !p.alive)) break;
  }
  running = false;
}

/* ── Auto-calculate strobe interval ──────────────────────────── */
// Returns the largest interval that still gives ≥3 images for every fragment.
function calcAutoStrobeInterval() {
  const frags = PRESETS[cfg.presetIdx].fragments;
  const cx = CW / 2, cy = CH / 2;
  let minExit = Infinity;
  frags.forEach(f => {
    const r  = radius(f.mass);
    const ax = Math.abs(f.vx), ay = Math.abs(f.vy);
    const tx = ax > 0.5 ? (cx - r) / ax : Infinity;
    const ty = ay > 0.5 ? (cy - r) / ay : Infinity;
    const te = Math.min(tx, ty);
    if (isFinite(te) && te < minExit) minExit = te;
  });
  if (!isFinite(minExit) || minExit <= 0) return 0.30;
  // Divide by 4 so the 3rd image is comfortably inside the canvas
  const raw = minExit / 4;
  // Round to nearest 0.05, clamp to slider range [0.10, 1.00]
  return Math.round(Math.min(1.0, Math.max(0.10, raw)) / 0.05) * 0.05;
}

function applyAutoStrobeInterval() {
  cfg.strobeInterval = calcAutoStrobeInterval();
  const sl = document.getElementById('slider-strobe');
  const vl = document.getElementById('val-strobe');
  if (sl) sl.value = cfg.strobeInterval;
  if (vl) vl.textContent = cfg.strobeInterval.toFixed(2);
}

/* ── Apply preset ────────────────────────────────────────────── */
function applyPreset() {
  const p = PRESETS[cfg.presetIdx];

  // Sync particle controls
  p.fragments.forEach((f, i) => {
    const massEl  = document.getElementById(`mass-${i}`);
    const speedEl = document.getElementById(`speed-${i}`);
    const angleEl = document.getElementById(`angle-${i}`);
    if (massEl)  { massEl.value  = f.mass;              document.getElementById(`val-mass-${i}`).textContent  = f.mass; }
    if (speedEl) { speedEl.value = Math.round(f.speed); document.getElementById(`val-speed-${i}`).textContent = Math.round(f.speed); }
    if (angleEl) { angleEl.value = Math.round(f.angle); document.getElementById(`val-angle-${i}`).textContent = Math.round(f.angle) + '°'; }
  });

  showFragmentControls(p.numFragments);
  markDerivedFragment(p.numFragments);
  document.getElementById('note-card').textContent = p.note;

  applyAutoStrobeInterval();
  if (cfg.mode === 'strobe') generateStrobe(); else reset();

  // Rebuild triangle editor if modal is currently open
  if (!document.getElementById('tri-modal').hidden) {
    buildTriVertices(p.fragments);
    drawTriangleEditor();
  }
}

function showFragmentControls(n) {
  [0, 1, 2].forEach(i => {
    const el = document.getElementById(`group-f${i}`);
    if (el) el.style.display = i < n ? '' : 'none';
  });
}

/* Disable speed/angle on the last fragment and tag it "(derived)". */
function markDerivedFragment(n) {
  const labels = ['Fragment A', 'Fragment B', 'Fragment C'];
  [0, 1, 2].forEach(i => {
    const group = document.getElementById(`group-f${i}`);
    if (!group) return;
    const labelEl = group.querySelector('.particle-label');
    const isDerived = i === n - 1;
    if (labelEl) labelEl.textContent = labels[i] + (isDerived ? ' (derived)' : '');
    const sp = document.getElementById(`speed-${i}`);
    const an = document.getElementById(`angle-${i}`);
    if (sp) sp.disabled = isDerived;
    if (an) an.disabled = isDerived;
    group.classList.toggle('derived-frag', isDerived);
  });
}

/* ── Recompute derived fragment after slider change ──────────── */
function recomputePreset(presetIdx) {
  const preset = PRESETS[presetIdx];
  // Re-derive velocities from angle/speed
  preset.fragments.forEach(resolveFragment);
}

/* ── Wire up preset selector ─────────────────────────────────── */
document.querySelectorAll('#seg-preset .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.presetIdx = parseInt(btn.dataset.val);
    document.querySelectorAll('#seg-preset .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyPreset();
  });
});

/* ── Wire up mode ────────────────────────────────────────────── */
document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cfg.mode = btn.dataset.val;
    document.querySelectorAll('#seg-mode .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (cfg.mode === 'strobe') generateStrobe(); else reset();
  });
});

/* ── Vector radio ────────────────────────────────────────────── */
document.querySelectorAll('input[name="vector-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    cfg.vectorMode = radio.value;
    if (cfg.mode === 'strobe') generateStrobe();
  });
});

/* ── Toggle buttons ──────────────────────────────────────────── */
document.getElementById('btn-triangle').addEventListener('click', () => {
  cfg.showTriangle = !cfg.showTriangle;
  document.getElementById('btn-triangle').classList.toggle('active', cfg.showTriangle);
});
document.getElementById('btn-labels').addEventListener('click', () => {
  cfg.showLabels = !cfg.showLabels;
  document.getElementById('btn-labels').classList.toggle('active', cfg.showLabels);
});

/* ── Strobe interval ─────────────────────────────────────────── */
document.getElementById('slider-strobe').addEventListener('input', function () {
  cfg.strobeInterval = parseFloat(this.value);
  document.getElementById('val-strobe').textContent = cfg.strobeInterval.toFixed(2);
  if (cfg.mode === 'strobe') generateStrobe();
});

/* ── Fragment sliders ────────────────────────────────────────── */
// Rule: fragments 0..n-2 are freely specified; the last fragment is derived
// from momentum conservation. Its mass slider stays active (rescales its
// velocity), but speed/angle are read-only displays.
[0, 1, 2].forEach(i => {
  const massEl  = document.getElementById(`mass-${i}`);
  const speedEl = document.getElementById(`speed-${i}`);
  const angleEl = document.getElementById(`angle-${i}`);

  function onChange() {
    const preset = PRESETS[cfg.presetIdx];
    const n      = preset.numFragments;
    const f      = preset.fragments[i];
    const isDerived = i === n - 1;

    if (massEl)  f.mass  = parseInt(massEl.value);
    if (!isDerived) {
      if (speedEl) f.speed = parseInt(speedEl.value);
      if (angleEl) f.angle = parseInt(angleEl.value);
      resolveFragment(f);
    }
    recomputeDerivedFragment(cfg.presetIdx);

    // Refresh display values for every fragment (derived one changes when others move)
    preset.fragments.forEach((ff, j) => {
      const vm = document.getElementById(`val-mass-${j}`);
      const vs = document.getElementById(`val-speed-${j}`);
      const va = document.getElementById(`val-angle-${j}`);
      if (vm) vm.textContent = ff.mass;
      if (vs) vs.textContent = Math.round(ff.speed);
      if (va) va.textContent = Math.round(ff.angle) + '°';
    });

    applyAutoStrobeInterval();
    if (cfg.mode === 'strobe') generateStrobe(); else reset();

    // Keep the triangle editor in sync if it happens to be open
    if (!document.getElementById('tri-modal').hidden) {
      buildTriVertices(preset.fragments);
      drawTriangleEditor();
    }
  }

  if (massEl)  massEl.addEventListener('input',  onChange);
  if (speedEl) speedEl.addEventListener('input', onChange);
  if (angleEl) angleEl.addEventListener('input', onChange);
});

/* ── Play/pause and reset ────────────────────────────────────── */
document.getElementById('btn-play').addEventListener('click', () => {
  running = !running;
  document.getElementById('btn-play').textContent = running ? 'Pause' : 'Play';
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (cfg.mode === 'strobe') generateStrobe(); else reset();
  document.getElementById('btn-play').textContent = 'Pause';
});

/* ═══════════════════════════════════════════════════════════════
   MOMENTUM TRIANGLE EDITOR
═══════════════════════════════════════════════════════════════ */

const triCanvas = document.getElementById('tri-canvas');
const triCtx    = triCanvas.getContext('2d');
const TCW = 460, TCH = 460;
const TOX = TCW / 2, TOY = TCH / 2;
const TRI_VR = 13;   // vertex handle radius px

let triScale    = 1;
let triVertices = [];   // [{x,y}] canvas-px coords, length = numFragments - 1
let triDragIdx  = -1;

/* ── Open / close ─────────────────────────────────────────── */
function openTriModal() {
  buildTriVertices(PRESETS[cfg.presetIdx].fragments);
  setSliderLock(true);
  document.getElementById('btn-tri-edit').classList.add('active');
  document.getElementById('tri-modal').hidden = false;
  drawTriangleEditor();
}

function closeTriModal() {
  document.getElementById('tri-modal').hidden = true;
  document.getElementById('btn-tri-edit').classList.remove('active');
  setSliderLock(false);
}

/* ── Build vertices from fragment momenta ─────────────────── */
function buildTriVertices(frags) {
  // Compute scale: largest distance from origin among all cumulative vertices
  let maxR = 0;
  let cx = 0, cy = 0;
  frags.forEach(f => { maxR = Math.max(maxR, Math.hypot(f.px, f.py)); });
  cx = 0; cy = 0;
  frags.slice(0, -1).forEach(f => {
    cx += f.px; cy += f.py;
    maxR = Math.max(maxR, Math.hypot(cx, cy));
  });
  if (maxR < 1) maxR = 200;
  triScale = (Math.min(TCW, TCH) * 0.38) / maxR;

  // Cumulative tip-to-tail positions → canvas coords
  triVertices = [];
  cx = 0; cy = 0;
  frags.slice(0, -1).forEach(f => {
    cx += f.px; cy += f.py;
    triVertices.push({ x: TOX + cx * triScale, y: TOY + cy * triScale });
  });
}

/* ── Slider lock/unlock ───────────────────────────────────── */
function setSliderLock(locked) {
  ['speed-0','speed-1','speed-2','angle-0','angle-1','angle-2',
   'mass-0','mass-1','mass-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  [0, 1, 2].forEach(i => {
    const g = document.getElementById(`group-f${i}`);
    if (g) g.classList.toggle('tri-locked', locked);
  });
}

/* ── Derive momenta from vertex positions and apply ────────── */
function applyTriVertices() {
  const preset = PRESETS[cfg.presetIdx];
  const frags  = preset.fragments;
  const n      = frags.length;

  // Canvas vertices → momentum-space points (tip-to-tail chain)
  const pts = [
    { mx: 0, my: 0 },
    ...triVertices.map(v => ({ mx: (v.x - TOX) / triScale, my: (v.y - TOY) / triScale })),
    { mx: 0, my: 0 },
  ];

  for (let i = 0; i < n; i++) {
    const f  = frags[i];
    f.px     = pts[i + 1].mx - pts[i].mx;
    f.py     = pts[i + 1].my - pts[i].my;
    f.vx     = f.px / f.mass;
    f.vy     = f.py / f.mass;
    f.speed  = Math.hypot(f.vx, f.vy);
    f.angle  = Math.atan2(-f.vy, f.vx) * 180 / Math.PI;
  }

  // Sync slider display values (sliders are disabled but still show info)
  frags.forEach((f, i) => {
    const sVal = document.getElementById(`val-speed-${i}`);
    const aVal = document.getElementById(`val-angle-${i}`);
    const sIn  = document.getElementById(`speed-${i}`);
    const aIn  = document.getElementById(`angle-${i}`);
    if (sVal) sVal.textContent = Math.round(f.speed);
    if (aVal) aVal.textContent = Math.round(f.angle) + '°';
    if (sIn)  sIn.value = Math.min(400, Math.max(0, Math.round(f.speed)));
    if (aIn)  aIn.value = Math.round(f.angle);
  });

  applyAutoStrobeInterval();
  if (cfg.mode === 'strobe') generateStrobe(); else reset();
}

/* ── Draw the triangle editor canvas ──────────────────────── */
function drawTriangleEditor() {
  const frags = PRESETS[cfg.presetIdx].fragments;

  triCtx.clearRect(0, 0, TCW, TCH);

  // Background
  triCtx.fillStyle = '#f0f4ff';
  triCtx.fillRect(0, 0, TCW, TCH);

  // Grid
  triCtx.save();
  triCtx.strokeStyle = 'rgba(21,48,77,0.05)';
  triCtx.lineWidth = 1;
  for (let x = 0; x <= TCW; x += 46) { triCtx.beginPath(); triCtx.moveTo(x, 0); triCtx.lineTo(x, TCH); triCtx.stroke(); }
  for (let y = 0; y <= TCH; y += 46) { triCtx.beginPath(); triCtx.moveTo(0, y); triCtx.lineTo(TCW, y); triCtx.stroke(); }
  triCtx.restore();

  // Axes through origin
  triCtx.save();
  triCtx.strokeStyle = 'rgba(21,48,77,0.15)';
  triCtx.lineWidth = 1;
  triCtx.setLineDash([4, 4]);
  triCtx.beginPath(); triCtx.moveTo(TOX, 0); triCtx.lineTo(TOX, TCH); triCtx.stroke();
  triCtx.beginPath(); triCtx.moveTo(0, TOY); triCtx.lineTo(TCW, TOY); triCtx.stroke();
  triCtx.setLineDash([]);
  triCtx.restore();

  // Full chain: O → V0 → V1 → ... → O
  const pts = [{ x: TOX, y: TOY }, ...triVertices, { x: TOX, y: TOY }];

  // Momentum arrows with labels
  frags.forEach((f, i) => {
    const from = pts[i], to = pts[i + 1];
    triArrow(from.x, from.y, to.x, to.y, COLORS[i], 3);

    // Label at midpoint, offset perpendicularly
    const mx   = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const segL = Math.hypot(to.x - from.x, to.y - from.y);
    const nx   = segL > 0.1 ? -(to.y - from.y) / segL : 0;
    const ny   = segL > 0.1 ?  (to.x - from.x) / segL : 0;
    const pmag = Math.hypot(f.px, f.py);
    const isLastDerived = i === frags.length - 1 && frags.length > 2;
    triCtx.save();
    triCtx.font = `${isLastDerived ? 'italic ' : ''}bold 12px "Trebuchet MS",sans-serif`;
    triCtx.fillStyle = COLORS[i];
    triCtx.textAlign = 'center';
    triCtx.textBaseline = 'middle';
    const tag = isLastDerived ? `p${['A','B','C'][i]} = ${Math.round(pmag)} (derived)` : `p${['A','B','C'][i]} = ${Math.round(pmag)}`;
    triCtx.fillText(tag, mx + nx * 22, my + ny * 22);
    triCtx.restore();
  });

  // Draggable vertex handles
  triVertices.forEach((v, i) => {
    triCtx.save();
    triCtx.shadowColor = 'rgba(0,0,0,0.2)'; triCtx.shadowBlur = 8;
    triCtx.fillStyle   = COLORS[i];
    triCtx.strokeStyle = 'white'; triCtx.lineWidth = 2.5;
    triCtx.beginPath(); triCtx.arc(v.x, v.y, TRI_VR, 0, 2 * Math.PI);
    triCtx.fill(); triCtx.shadowBlur = 0; triCtx.stroke();
    triCtx.fillStyle = 'white';
    triCtx.font = 'bold 9px "Trebuchet MS",sans-serif';
    triCtx.textAlign = 'center'; triCtx.textBaseline = 'middle';
    triCtx.fillText(['A','B','C'][i], v.x, v.y);
    triCtx.restore();
  });

  // Origin marker
  triCtx.save();
  triCtx.fillStyle = '#15304d';
  triCtx.beginPath(); triCtx.arc(TOX, TOY, 7, 0, 2 * Math.PI); triCtx.fill();
  triCtx.fillStyle = 'white';
  triCtx.font = 'bold 9px "Trebuchet MS",sans-serif';
  triCtx.textAlign = 'center'; triCtx.textBaseline = 'middle';
  triCtx.fillText('O', TOX, TOY);
  triCtx.restore();
}

/* ── Arrow helper for tri-canvas ──────────────────────────── */
function triArrow(x1, y1, x2, y2, col, width) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len;
  const hs = Math.min(16, len * 0.3);
  triCtx.save();
  triCtx.strokeStyle = col; triCtx.fillStyle = col;
  triCtx.lineWidth = width; triCtx.lineCap = 'round';
  triCtx.beginPath(); triCtx.moveTo(x1, y1); triCtx.lineTo(x2, y2); triCtx.stroke();
  triCtx.beginPath();
  triCtx.moveTo(x2, y2);
  triCtx.lineTo(x2 - hs * (ux - 0.38 * uy), y2 - hs * (uy + 0.38 * ux));
  triCtx.lineTo(x2 - hs * (ux + 0.38 * uy), y2 - hs * (uy - 0.38 * ux));
  triCtx.closePath(); triCtx.fill();
  triCtx.restore();
}

/* ── Mouse / touch interaction ────────────────────────────── */
function triGetPos(e) {
  const r  = triCanvas.getBoundingClientRect();
  const sx = TCW / r.width, sy = TCH / r.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
}

triCanvas.addEventListener('mousedown', e => {
  const p = triGetPos(e);
  triDragIdx = triVertices.findIndex(v => Math.hypot(p.x - v.x, p.y - v.y) < TRI_VR + 8);
});
triCanvas.addEventListener('mousemove', e => {
  if (triDragIdx < 0) return;
  const p = triGetPos(e);
  triVertices[triDragIdx] = {
    x: Math.max(TRI_VR, Math.min(TCW - TRI_VR, p.x)),
    y: Math.max(TRI_VR, Math.min(TCH - TRI_VR, p.y)),
  };
  applyTriVertices();
  drawTriangleEditor();
});
triCanvas.addEventListener('mouseup',    () => { triDragIdx = -1; });
triCanvas.addEventListener('mouseleave', () => { triDragIdx = -1; });

triCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const p = triGetPos(e);
  triDragIdx = triVertices.findIndex(v => Math.hypot(p.x - v.x, p.y - v.y) < TRI_VR + 14);
}, { passive: false });
triCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (triDragIdx < 0) return;
  const p = triGetPos(e);
  triVertices[triDragIdx] = {
    x: Math.max(TRI_VR, Math.min(TCW - TRI_VR, p.x)),
    y: Math.max(TRI_VR, Math.min(TCH - TRI_VR, p.y)),
  };
  applyTriVertices();
  drawTriangleEditor();
}, { passive: false });
triCanvas.addEventListener('touchend', () => { triDragIdx = -1; });

/* ── Wire modal buttons ───────────────────────────────────── */
document.getElementById('btn-tri-edit').addEventListener('click', () => {
  document.getElementById('tri-modal').hidden ? openTriModal() : closeTriModal();
});
document.getElementById('tri-modal-close').addEventListener('click', closeTriModal);
document.getElementById('tri-modal-backdrop').addEventListener('click', closeTriModal);

/* ── Init ───────────────────────────────────────────────────── */
applyPreset();
requestAnimationFrame(loop);
