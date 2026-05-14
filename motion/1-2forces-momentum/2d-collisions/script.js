/* ═══════════════════════════════════════════════════════════════
   2D Collisions  —  script.js
═══════════════════════════════════════════════════════════════ */

const CW = 960, CH = 560;

/* ── Colours ─────────────────────────────────────────────────── */
const COLORS = ['#2563eb', '#dc2626', '#d97706'];
const COLORS_LIGHT = ['rgba(37,99,235,0.18)', 'rgba(220,38,38,0.18)', 'rgba(217,119,6,0.18)'];

/* ── Canvas ──────────────────────────────────────────────────── */
const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Preset scenarios ────────────────────────────────────────── */
// Each preset guarantees a clean momentum-vector triangle.
// "impact" is the y-offset of particle B from A's line of travel.
// For equal masses elastic: final velocities are always perpendicular → right-angle triangle.
// For equilateral: use mass ratio 1:3 with impact = sqrt(3)/2 * (rA+rB).

const PRESETS = [
  {
    label: 'Equal masses — glancing (elastic)',
    type: 'elastic',
    note: 'Equal-mass elastic: the two final velocities are always perpendicular. The momentum triangle is right-angled.',
    particles: [
      { mass: 1, x: 130, y: 280, speed: 210, angle: 0 },
      { mass: 1, x: 680, y: 260, speed: 0,   angle: 0 },  // offset 20 < rA+rB=28 → glancing
    ],
  },
  {
    label: 'Unequal masses 1:2 — glancing (elastic)',
    type: 'elastic',
    note: 'Heavier target: the lighter particle bounces back; the heavier one recoils gently. The momentum triangle is obtuse.',
    particles: [
      { mass: 1, x: 130, y: 280, speed: 210, angle: 0 },
      { mass: 2, x: 680, y: 262, speed: 0,   angle: 0 },  // offset 18
    ],
  },
  {
    label: 'Right-angle approach — perfectly inelastic',
    type: 'inelastic',
    note: 'A moves right, B moves up. They merge. The before-momenta are perpendicular → right-angle momentum triangle.',
    particles: [
      { mass: 2, x: 130, y: 300, speed: 150, angle:   0 },
      { mass: 2, x: 460, y: 560, speed: 150, angle: -90 },  // moving upward
    ],
  },
  {
    label: 'Three particles — sequential elastic',
    type: 'elastic',
    note: 'A hits stationary B; B then hits stationary C. Equal masses: momentum transfers completely each time.',
    particles: [
      { mass: 1, x: 100, y: 280, speed: 210, angle: 0 },
      { mass: 1, x: 460, y: 280, speed: 0,   angle: 0 },
      { mass: 1, x: 760, y: 280, speed: 0,   angle: 0 },
    ],
  },
  {
    label: 'Equal masses — both moving (elastic)',
    type: 'elastic',
    note: 'Both particles are moving. Momentum and kinetic energy are conserved. Use the momentum editor to explore all valid final states.',
    particles: [
      { mass: 1, x: 100, y: 280, speed: 180, angle:    0 },
      { mass: 1, x: 780, y: 100, speed: 180, angle: -150 },
    ],
  },
];

// Deep copy of original particle params — used for "Reset" in editors
const PRESETS_DEFAULTS = PRESETS.map(p => ({
  particles: p.particles.map(pp => ({ mass: pp.mass, speed: pp.speed, angle: pp.angle })),
}));

/* ── Simulation state ────────────────────────────────────────── */
let cfg = {
  presetIdx:      0,
  type:           'elastic',
  massA:          1,
  massB:          1,
  speedA:         210,
  impactOffset:   28,
  strobeInterval: 0.45,
  mode:           'animation',  // 'animation' | 'strobe'
  vectorMode:     'none',        // 'none' | 'velocity' | 'momentum'
  showTriangle:   false,
  showLabels:     false,
};

let particles    = [];    // live particles
let snapshots    = [];    // strobe history: [{t, ps:[{x,y,vx,vy,mass,r,color}]}]
let simTime      = 0;
let running      = true;
let lastTs       = null;
let collisions   = [];    // record: {t, idx0, idx1, before: [...], after: [...]}
let mergedParticle = null; // for inelastic collision result
const SPEED_SCALE = 1;   // simulation speed multiplier

/* ── Particle radius ─────────────────────────────────────────── */
function radius(mass) { return Math.max(12, 14 * Math.sqrt(mass)); }

/* ── Build particles from preset + cfg overrides ─────────────── */
function buildParticles() {
  const preset = PRESETS[cfg.presetIdx];
  particles = preset.particles.map((p, i) => ({
    id:     i,
    mass:   p.mass,
    x:      p.x,
    y:      p.y,
    vx:     p.speed * Math.cos(p.angle * Math.PI / 180),
    vy:     p.speed * Math.sin(p.angle * Math.PI / 180) * -1, // canvas y-flip
    r:      radius(p.mass),
    color:  COLORS[i],
    alive:   true,
    entered: false,  // true once the particle has been inside the canvas
    label:   ['A', 'B', 'C'][i],
  }));
}

/* ── Physics helpers ─────────────────────────────────────────── */
function dot(ax, ay, bx, by) { return ax * bx + ay * by; }

function resolveElastic(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return;
  const nx = dx / dist, ny = dy / dist;

  // Relative velocity along normal
  const relVn = dot(a.vx - b.vx, a.vy - b.vy, nx, ny);
  if (relVn <= 0) return;  // already separating

  const J = (2 * a.mass * b.mass * relVn) / (a.mass + b.mass);
  a.vx -= J / a.mass * nx;
  a.vy -= J / a.mass * ny;
  b.vx += J / b.mass * nx;
  b.vy += J / b.mass * ny;

  // Separate overlapping particles
  const overlap = (a.r + b.r) - dist;
  if (overlap > 0) {
    const sep = overlap / 2;
    a.x -= sep * nx; a.y -= sep * ny;
    b.x += sep * nx; b.y += sep * ny;
  }
}

function resolveInelastic(a, b) {
  // Record before
  const before = particles.filter(p => p.alive).map(p => ({ ...p }));

  const totalMass = a.mass + b.mass;
  a.vx = (a.mass * a.vx + b.mass * b.vx) / totalMass;
  a.vy = (a.mass * a.vy + b.mass * b.vy) / totalMass;
  a.mass = totalMass;
  a.r    = radius(totalMass);
  b.alive = false;

  collisions.push({ t: simTime, before, after: particles.filter(p => p.alive).map(p => ({ ...p })) });
}

function checkCollisions() {
  const alive = particles.filter(p => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist <= a.r + b.r) {
        if (firstCollisionTime === null) {
          firstCollisionTime = simTime;
          lastStrobeCapture  = simTime - cfg.strobeInterval; // next capture = right at collision
        }
        const before = particles.filter(p => p.alive).map(p => ({ ...p }));
        if (cfg.type === 'elastic') {
          resolveElastic(a, b);
        } else {
          resolveInelastic(a, b);
        }
        if (cfg.type === 'elastic') {
          collisions.push({ t: simTime, before, after: particles.filter(p => p.alive).map(p => ({ ...p })) });
        }
      }
    }
  }
}

/* ── Advance simulation ──────────────────────────────────────── */
let lastStrobeCapture  = -99;
let firstCollisionTime = null;

function advance(dt) {
  const alive = particles.filter(p => p.alive);
  alive.forEach(p => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const onCanvas = p.x + p.r > 0 && p.x - p.r < CW && p.y + p.r > 0 && p.y - p.r < CH;
    if (!p.entered && onCanvas) p.entered = true;
    if (p.entered && !onCanvas) p.alive = false;
  });
  checkCollisions();

  // Strobe capture
  if (simTime - lastStrobeCapture >= cfg.strobeInterval) {
    snapshots.push({ t: simTime, ps: particles.filter(p => p.alive).map(p => ({ ...p })) });
    lastStrobeCapture = simTime;
  }
  simTime += dt;
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

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur  = 8;

  // Body
  ctx.fillStyle   = p.color;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 2.5;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  // Label
  ctx.fillStyle    = 'white';
  ctx.font         = `700 ${Math.max(11, p.r * 0.7)}px "Trebuchet MS", sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.label, p.x, p.y);

  // Mass label
  if (cfg.showLabels) {
    ctx.fillStyle = p.color;
    ctx.font = '700 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`m=${p.mass}`, p.x, p.y + p.r + 4);
  }

  ctx.restore();
}

/* ── Draw vectors for a particle ─────────────────────────────── */
const VEC_SCALE_V = 0.30;   // px per (px/s) of velocity display
const VEC_SCALE_P = 0.22;   // px per unit momentum display

function drawVector(p, alpha = 1) {
  if (cfg.vectorMode === 'none') return;
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
    lbl(mag, p.x + qx + 14, p.y + qy, { color: p.color, font: '700 11px "Trebuchet MS", sans-serif', align: 'left' });
  }
  ctx.restore();
}

/* ── Draw strobe mode ────────────────────────────────────────── */
function drawStrobe() {
  if (snapshots.length === 0) return;

  // Show 3 pre-collision frames plus all post-collision snapshots
  const cutoff = firstCollisionTime !== null
    ? firstCollisionTime - 3 * cfg.strobeInterval - 0.001
    : -Infinity;
  const visible = snapshots.filter(s => s.t >= cutoff);
  const N = visible.length;
  if (N === 0) return;

  // Trajectory paths between consecutive ghost positions per particle
  const ids = new Set(visible.flatMap(s => s.ps.map(p => p.id)));
  ids.forEach(id => {
    const pts = visible.map(s => s.ps.find(p => p.id === id)).filter(Boolean);
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = pts[0].color;
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // Ghost images: older = more transparent
  visible.forEach((snap, si) => {
    const alpha = 0.40 + 0.50 * (si / Math.max(1, N - 1));
    snap.ps.forEach(p => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = p.color;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      // Centre dot for measurement
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = p.color;
      // Direction-of-motion arrow
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 1) {
        const ux = p.vx / spd, uy = p.vy / spd;
        const ALEN = 28;
        arrow(p.x + ux * p.r, p.y + uy * p.r,
              p.x + ux * (p.r + ALEN), p.y + uy * (p.r + ALEN),
              p.color, 1.5);
        ctx.globalAlpha = alpha; // arrow() restores state, re-assert alpha
      }
      if (cfg.vectorMode !== 'none') drawVector(p, alpha * 0.85);
      ctx.restore();
    });
  });
}

/* ── Draw momentum triangle ──────────────────────────────────── */
// Draws the closed momentum-addition triangle in the top-right corner.
// "before" = array of {mass, vx, vy, color} snapshots before first collision.
// "after"  = array of the same after collision.

function drawMomentumTriangle(beforePs, afterPs) {
  if (!beforePs || !afterPs) return;

  // Panel dimensions
  const PW = 230, PH = 200;
  const px0 = CW - PW - 14, py0 = 14;

  // Background panel
  ctx.save();
  ctx.fillStyle   = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(21,48,77,0.14)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.roundRect(px0, py0, PW, PH, 12);
  ctx.fill(); ctx.stroke();

  // Title
  lbl('Momentum triangle', px0 + PW / 2, py0 + 14, { font: '700 12px "Trebuchet MS",sans-serif', color: '#15304d' });

  // Before total momentum
  const pBefX = beforePs.reduce((s, p) => s + p.mass * p.vx, 0);
  const pBefY = beforePs.reduce((s, p) => s + p.mass * p.vy, 0);

  // After momenta
  const afters = afterPs.map(p => ({ mass: p.mass, px: p.mass * p.vx, py: p.mass * p.vy, color: p.color, label: p.label }));

  // Find scale to fit in panel
  const allVecs = [...afters.map(a => ({ x: a.px, y: a.py })), { x: pBefX, y: pBefY }];
  const maxLen = Math.max(...allVecs.map(v => Math.hypot(v.x, v.y)), 1);
  const maxDim = Math.min(PW - 40, PH - 40);
  const sc = (maxDim * 0.55) / maxLen;

  // Origin for triangle drawing (left-centre of panel)
  const ox = px0 + 38, oy = py0 + PH / 2 + 8;

  // Draw each after-momentum vector tip-to-tail
  let cx = ox, cy = oy;
  afters.forEach(a => {
    const ex = cx + a.px * sc, ey = cy + a.py * sc;
    arrow(cx, cy, ex, ey, a.color, 2);
    if (cfg.showLabels) lbl(`p${a.label}`, ex + 9, ey, { color: a.color, font: '700 10px "Trebuchet MS",sans-serif', align: 'left' });
    cx = ex; cy = ey;
  });

  // Draw before-momentum vector from origin to close the triangle
  arrow(ox, oy, ox + pBefX * sc, oy + pBefY * sc, '#55708d', 2);
  if (cfg.showLabels) lbl('p total (before)', ox + pBefX * sc / 2, oy + pBefY * sc - 12, { color: '#55708d', font: '700 10px "Trebuchet MS",sans-serif' });

  // Mark right-angle if it's close enough (within 5° of 90°)
  if (afters.length === 2) {
    const a0 = afters[0], a1 = afters[1];
    const dotP = a0.px * a1.px + a0.py * a1.py;
    const mag0 = Math.hypot(a0.px, a0.py), mag1 = Math.hypot(a1.px, a1.py);
    if (mag0 > 0.01 && mag1 > 0.01 && Math.abs(dotP / (mag0 * mag1)) < 0.09) {
      // Draw right-angle box at the junction
      const jx = ox + a0.px * sc, jy = oy + a0.py * sc;
      const u0x = a0.px / mag0, u0y = a0.py / mag0;
      const u1x = a1.px / mag1, u1y = a1.py / mag1;
      const s = 8;
      ctx.save();
      ctx.strokeStyle = '#55708d'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(jx + u0x * s, jy + u0y * s);
      ctx.lineTo(jx + u0x * s + u1x * s, jy + u0y * s + u1y * s);
      ctx.lineTo(jx + u1x * s, jy + u1y * s);
      ctx.stroke();
      ctx.restore();
      lbl('90°', jx + (u0x + u1x) * 22, jy + (u0y + u1y) * 22, { color: '#55708d', font: '11px "Trebuchet MS",sans-serif' });
    }
  }

  ctx.restore();
}

/* ── Main draw ───────────────────────────────────────────────── */
function draw() {
  // Background
  ctx.fillStyle = '#f0f4ff';
  ctx.fillRect(0, 0, CW, CH);

  // Subtle grid
  ctx.save();
  ctx.strokeStyle = 'rgba(21,48,77,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= CW; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
  for (let y = 0; y <= CH; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }
  ctx.restore();

  if (cfg.mode === 'strobe') {
    drawStrobe();
  } else {
    // Animation mode
    const alive = particles.filter(p => p.alive);
    alive.forEach(p => {
      drawVector(p);
      drawParticle(p);
    });
  }

  // Momentum triangle overlay
  if (cfg.showTriangle && collisions.length > 0) {
    const col = collisions[0];
    drawMomentumTriangle(col.before, col.after);
  } else if (cfg.showTriangle && collisions.length === 0) {
    // Pre-collision: show "before" triangle (just particle A's momentum as total)
    const alive = particles.filter(p => p.alive);
    drawMomentumTriangle(alive, alive);
  }

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
  const raw_dt = Math.min((ts - lastTs) / 1000, 0.04);
  lastTs = ts;

  if (running && cfg.mode === 'animation') {
    advance(raw_dt * SPEED_SCALE);
  }
  draw();
  requestAnimationFrame(loop);
}

/* ── Reset ───────────────────────────────────────────────────── */
function reset() {
  buildParticles();
  snapshots      = [];
  collisions     = [];
  simTime            = 0;
  lastStrobeCapture  = -99;
  firstCollisionTime = null;
  lastTs             = null;
  running            = true;
}

/* ── Pre-generate strobe snapshots (strobe mode only) ────────── */
function generateStrobe() {
  reset();
  running = false;
  const dt = 0.001;
  for (let i = 0; i < 12000; i++) {
    advance(dt);
    if (particles.every(p => !p.alive)) break;
  }
  running = false;
}

/* ── Auto-calculate strobe interval ──────────────────────────── */
// Returns the largest interval that still gives ≥3 ghost images per particle.
function calcAutoStrobeInterval() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const maxSpeed = Math.max(...ps.map(p => p.speed), 1);
  const r = Math.round(6 + 4 * (ps[0].mass - 1)); // approx radius
  // After collision particles fly from ~centre; estimate time to reach canvas edge
  const halfDim = Math.min(CW, CH) / 2 - r;
  const exitTime = halfDim / maxSpeed;
  const raw = exitTime / 4;
  return Math.round(Math.min(1.0, Math.max(0.10, raw)) / 0.05) * 0.05;
}

function applyAutoStrobeInterval() {
  cfg.strobeInterval = calcAutoStrobeInterval();
  const sl = document.getElementById('slider-strobe');
  const vl = document.getElementById('val-strobe');
  if (sl) sl.value = cfg.strobeInterval;
  if (vl) vl.value = cfg.strobeInterval.toFixed(2);
}

/* ── UI helpers ──────────────────────────────────────────────── */
function seg(groupId, key) {
  document.querySelectorAll(`#${groupId} .seg-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      cfg[key] = btn.dataset.val;
      document.querySelectorAll(`#${groupId} .seg-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      handleCfgChange(key);
    });
  });
}

function handleCfgChange(key) {
  if (key === 'mode') {
    if (cfg.mode === 'strobe') { applyAutoStrobeInterval(); generateStrobe(); }
    else reset();
  } else if (key === 'presetIdx') {
    applyPreset();
  } else if (key === 'type') {
    reset();
  }
  updateToggleUI();
  updateNoteCard();
  updateWarnBanner();
}

/* ═══════════════════════════════════════════════════════════════
   COLLISION MOMENTUM TRIANGLE EDITOR
   Active only for presets 0 and 1 (elastic, stationary B).
═══════════════════════════════════════════════════════════════ */

const collTriCanvas = document.getElementById('coll-tri-canvas');
const collTriCtx    = collTriCanvas.getContext('2d');
const CTOW = 460, CTOH = 460;
const CTOX = 115, CTOY = 280; // origin O on tri-canvas

let collTriOpen  = false;
let collTriScale = 1;
let collTriPx = 0, collTriPy = 0; // P = tip of pAi on tri-canvas
let collTriJx = 0, collTriJy = 0; // J = tip of pAf on tri-canvas
let collTriDrag = null;            // null | 'P' | 'J'

/* ── Coordinate helpers ──────────────────────────────────────── */
// physics (x right, y up) → tri-canvas (x right, y down)
function physToTri(px, py) {
  return { x: CTOX + px * collTriScale, y: CTOY - py * collTriScale };
}
function triToPhys(tx, ty) {
  return { x: (tx - CTOX) / collTriScale, y: -(ty - CTOY) / collTriScale };
}

/* ── Elastic circle ──────────────────────────────────────────── */
// For elastic collision with stationary B:
// valid pAf positions form a circle: center = mA/(mA+mB)*pAi, radius = mB/(mA+mB)*|pAi|
function getElasticCircle(pAix, pAiy, mA, mB) {
  const f = mA / (mA + mB), g = mB / (mA + mB);
  return { cx: f * pAix, cy: f * pAiy, r: g * Math.hypot(pAix, pAiy) };
}

/* ── Clamp point to circle ───────────────────────────────────── */
function clampToCircle(jx, jy, cx, cy, r) {
  const dx = jx - cx, dy = jy - cy;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return { x: cx + r, y: cy };
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
}

/* ── Magnetic snap points (physics space) ────────────────────── */
function getSnapPoints(pAix, pAiy, mA, mB) {
  const snaps = [];
  const { cx, cy, r } = getElasticCircle(pAix, pAiy, mA, mB);
  const mag = Math.hypot(pAix, pAiy);
  if (mag < 0.001) return snaps;
  const ux = pAix / mag, uy = pAiy / mag;
  const perpx = -uy, perpy = ux; // 90° counter-clockwise unit

  // 1. Head-on: J = ((mA-mB)/(mA+mB)) * pAi
  const f = (mA - mB) / (mA + mB);
  snaps.push({ x: f * pAix, y: f * pAiy, label: 'head-on' });

  // 2. Right-angle at J (pAf ⊥ pBf) — only possible for equal masses: J = C ± R*perp
  if (mA === mB) {
    snaps.push({ x: cx + r * perpx, y: cy + r * perpy, label: '90°J↑' });
    snaps.push({ x: cx - r * perpx, y: cy - r * perpy, label: '90°J↓' });
  }

  // 3. Right-angle at O (pAf ⊥ pAi) — requires mB >= mA: t² = R² - |C|²
  if (mB >= mA) {
    const cMag2 = cx * cx + cy * cy;
    const t2 = r * r - cMag2;
    if (t2 >= 0) {
      const t = Math.sqrt(t2);
      snaps.push({ x: t * perpx, y: t * perpy, label: '90°O↑' });
      snaps.push({ x: -t * perpx, y: -t * perpy, label: '90°O↓' });
    }
  }

  // 4. Isoceles: |pAf| = |pBf| (J on perpendicular bisector of OP).
  //    True equilateral (all sides equal) would also require |pAf| = |pAi|, but
  //    the only such point on the elastic circle is J = P (no collision) — so
  //    isoceles is the closest achievable symmetric case.
  //    J = midpoint(OP) ± sqrt(3/4 − mA/(mA+mB)) * mag * perp
  //    Achievable when mA < 3*mB. For equal masses this coincides with snap #2.
  if (mA !== mB) {
    const iso2 = mag * mag * (0.75 - mA / (mA + mB));
    if (iso2 > 0) {
      const iso = Math.sqrt(iso2);
      const Mx = mag / 2 * ux, My = mag / 2 * uy;
      snaps.push({ x: Mx + iso * perpx, y: My + iso * perpy, label: 'iso↑' });
      snaps.push({ x: Mx - iso * perpx, y: My - iso * perpy, label: 'iso↓' });
    }
  }

  return snaps;
}

/* ── Build vertices from preset ──────────────────────────────── */
function buildCollTriVertices() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;
  const speedA = ps[0].speed, angleA_rad = ps[0].angle * Math.PI / 180;
  const pAix = mA * speedA * Math.cos(angleA_rad);
  const pAiy = mA * speedA * Math.sin(angleA_rad);
  const pMag = Math.hypot(pAix, pAiy);

  collTriScale = pMag > 0.001
    ? Math.min(200 / pMag, (CTOW - CTOX - 25) / Math.max(Math.abs(pAix), 1),
               (CTOY - 25) / Math.max(Math.abs(pAiy) + Math.abs(pMag * mB / (mA + mB)), 1))
    : 1;

  const P = physToTri(pAix, pAiy);
  collTriPx = P.x; collTriPy = P.y;

  // Default J: head-on for unequal masses; 45° glancing for equal masses
  let J_phys;
  if (mA === mB) {
    // Top of elastic circle: right-angle at J (classic equal-mass result)
    const { cx, cy, r } = getElasticCircle(pAix, pAiy, mA, mB);
    const mag = Math.hypot(pAix, pAiy);
    const perpx = -pAiy / mag, perpy = pAix / mag;
    J_phys = { x: cx + r * perpx, y: cy + r * perpy };
  } else {
    const f = (mA - mB) / (mA + mB);
    J_phys = { x: f * pAix, y: f * pAiy };
  }
  const J = physToTri(J_phys.x, J_phys.y);
  collTriJx = J.x; collTriJy = J.y;
}

/* ── Apply vertices → update preset + reset sim ─────────────── */
function applyCollTriVertices() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;

  const pAi = triToPhys(collTriPx, collTriPy); // O→P
  const pAf = triToPhys(collTriJx, collTriJy); // O→J
  const pBf = { x: pAi.x - pAf.x, y: pAi.y - pAf.y }; // J→P

  // Update A speed + angle (rounded — must match what buildParticles will use)
  const pAiMag = Math.hypot(pAi.x, pAi.y);
  if (pAiMag > 0.001) {
    ps[0].speed = Math.max(1, Math.round(pAiMag / mA));
    ps[0].angle = Math.round(Math.atan2(pAi.y, pAi.x) * 180 / Math.PI);
  }

  // B at canvas center, stationary
  const Bx = 480, By = 280;
  ps[1].x = Bx; ps[1].y = By; ps[1].speed = 0; ps[1].angle = 0;

  // Compute A starting position from collision geometry
  const pBfMag = Math.hypot(pBf.x, pBf.y);
  const rA = radius(mA), rB = radius(mB), rSum = rA + rB;
  if (pBfMag > 0.001 && pAiMag > 0.001) {
    // Collision normal: direction of pBf in canvas coords (flip y)
    const nCx = pBf.x / pBfMag;
    const nCy = -pBf.y / pBfMag;
    // A centre at moment of collision
    const Ax_coll = Bx - rSum * nCx;
    const Ay_coll = By - rSum * nCy;

    // Travel direction from the ROUNDED angle (exactly what buildParticles uses)
    const angleRad = ps[0].angle * Math.PI / 180;
    const vDirCx = Math.cos(angleRad);
    const vDirCy = -Math.sin(angleRad); // canvas y-flip

    // Back up from A_coll along -v̂ until we exit a canvas edge.
    // This guarantees A starts just off-canvas regardless of angle.
    const ts = [];
    if (vDirCx >  0.001) ts.push((Ax_coll + rA)        / vDirCx);
    else if (vDirCx < -0.001) ts.push((CW + rA - Ax_coll) / (-vDirCx));
    if (vDirCy >  0.001) ts.push((Ay_coll + rA)        / vDirCy);
    else if (vDirCy < -0.001) ts.push((CH + rA - Ay_coll) / (-vDirCy));
    const t = ts.length > 0 ? Math.min(...ts) : 800;

    ps[0].x = Ax_coll - t * vDirCx;
    ps[0].y = Ay_coll - t * vDirCy;
  }

  syncCollSliders();
  if (cfg.mode === 'strobe') generateStrobe(); else reset();
  updateWarnBanner();
}

/* ── Sync sidebar sliders from preset ───────────────────────── */
function syncCollSliders() {
  const ps = PRESETS[cfg.presetIdx].particles;
  [0, 1].forEach(i => {
    const massEl  = document.getElementById(`mass-${i}`);
    const speedEl = document.getElementById(`speed-${i}`);
    const angleEl = document.getElementById(`angle-${i}`);
    if (massEl)  { massEl.value  = ps[i].mass;  document.getElementById(`val-mass-${i}`).value  = ps[i].mass; }
    if (speedEl) { speedEl.value = ps[i].speed; document.getElementById(`val-speed-${i}`).value = ps[i].speed; }
    if (angleEl) { angleEl.value = ps[i].angle; document.getElementById(`val-angle-${i}`).value = ps[i].angle; }
  });
}

/* ── Draw triangle editor ────────────────────────────────────── */
function drawCollTriangle() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;
  const tc = collTriCtx;

  tc.clearRect(0, 0, CTOW, CTOH);
  tc.fillStyle = 'rgba(240,244,255,0.98)';
  tc.fillRect(0, 0, CTOW, CTOH);

  // Grid dots
  tc.save();
  tc.fillStyle = 'rgba(21,48,77,0.06)';
  for (let x = 20; x < CTOW; x += 40) {
    for (let y = 20; y < CTOH; y += 40) {
      tc.beginPath(); tc.arc(x, y, 1.5, 0, 2 * Math.PI); tc.fill();
    }
  }
  tc.restore();

  const pAi = triToPhys(collTriPx, collTriPy);
  const pAf = triToPhys(collTriJx, collTriJy);
  const pBf = { x: pAi.x - pAf.x, y: pAi.y - pAf.y };

  // Elastic circle
  const { cx: ec_px, cy: ec_py, r: er_phys } = getElasticCircle(pAi.x, pAi.y, mA, mB);
  const ec = physToTri(ec_px, ec_py);
  const er = er_phys * collTriScale;
  tc.save();
  tc.strokeStyle = 'rgba(124,58,237,0.30)';
  tc.lineWidth = 1.5;
  tc.setLineDash([5, 4]);
  tc.beginPath(); tc.arc(ec.x, ec.y, er, 0, 2 * Math.PI); tc.stroke();
  tc.setLineDash([]);
  // Circle label
  tc.fillStyle = 'rgba(124,58,237,0.55)';
  tc.font = '600 10px "Trebuchet MS",sans-serif';
  tc.textAlign = 'center'; tc.textBaseline = 'bottom';
  tc.fillText('elastic circle', ec.x, ec.y - er - 4);
  tc.restore();

  // Snap point dots
  const snaps = getSnapPoints(pAi.x, pAi.y, mA, mB);
  tc.save();
  tc.fillStyle = 'rgba(124,58,237,0.35)';
  snaps.forEach(s => {
    const sc = physToTri(s.x, s.y);
    tc.beginPath(); tc.arc(sc.x, sc.y, 4, 0, 2 * Math.PI); tc.fill();
  });
  tc.restore();

  // Arrows: pAi (O→P), pAf (O→J), pBf (J→P)
  ctxArrow(tc, CTOX, CTOY, collTriPx, collTriPy, '#8b9db5', 2);
  ctxArrow(tc, CTOX, CTOY, collTriJx, collTriJy, '#2563eb', 2.5);
  ctxArrow(tc, collTriJx, collTriJy, collTriPx, collTriPy, '#dc2626', 2.5);

  // Labels
  tc.save();
  tc.font = '700 10px "Trebuchet MS",sans-serif';
  tc.textBaseline = 'middle';
  // pAi midpoint
  const aiMx = (CTOX + collTriPx) / 2, aiMy = (CTOY + collTriPy) / 2;
  tc.fillStyle = '#8b9db5'; tc.textAlign = 'center';
  tc.fillText('p\u2090 initial', aiMx, aiMy - 11);
  // pAf midpoint
  const afMx = (CTOX + collTriJx) / 2, afMy = (CTOY + collTriJy) / 2;
  tc.fillStyle = '#2563eb'; tc.textAlign = 'center';
  tc.fillText('p\u2090 final', afMx, afMy + 11);
  // pBf midpoint
  const bfMx = (collTriJx + collTriPx) / 2, bfMy = (collTriJy + collTriPy) / 2;
  tc.fillStyle = '#dc2626'; tc.textAlign = 'left';
  tc.fillText('p\u2099 final', bfMx + 8, bfMy);
  tc.restore();

  // Right-angle markers
  const magAf = Math.hypot(pAf.x, pAf.y), magBf = Math.hypot(pBf.x, pBf.y);
  const magAi = Math.hypot(pAi.x, pAi.y);
  // At J: pAf ⊥ pBf
  if (magAf > 0.01 && magBf > 0.01 &&
      Math.abs((pAf.x * pBf.x + pAf.y * pBf.y) / (magAf * magBf)) < 0.05) {
    drawRightAngleMark(tc, collTriJx, collTriJy,
      CTOX - collTriJx, CTOY - collTriJy, collTriPx - collTriJx, collTriPy - collTriJy, 9, '#55708d');
  }
  // At O: pAf ⊥ pAi
  if (magAi > 0.01 && magAf > 0.01 &&
      Math.abs((pAi.x * pAf.x + pAi.y * pAf.y) / (magAi * magAf)) < 0.05) {
    drawRightAngleMark(tc, CTOX, CTOY,
      collTriPx - CTOX, collTriPy - CTOY, collTriJx - CTOX, collTriJy - CTOY, 9, '#55708d');
  }

  // Origin O label
  tc.save();
  tc.fillStyle = '#55708d'; tc.font = '700 12px "Trebuchet MS",sans-serif';
  tc.textAlign = 'right'; tc.textBaseline = 'top';
  tc.fillText('O', CTOX - 7, CTOY + 4);
  tc.restore();

  // Draggable vertices
  drawCtxVertex(tc, CTOX, CTOY, '#55708d', '');
  drawCtxVertex(tc, collTriPx, collTriPy, '#475569', 'P');
  drawCtxVertex(tc, collTriJx, collTriJy, '#7c3aed', 'J');
}

function drawRightAngleMark(tc, vx, vy, d1x, d1y, d2x, d2y, s, col) {
  const d1m = Math.hypot(d1x, d1y), d2m = Math.hypot(d2x, d2y);
  if (d1m < 0.001 || d2m < 0.001) return;
  const u1x = d1x / d1m * s, u1y = d1y / d1m * s;
  const u2x = d2x / d2m * s, u2y = d2y / d2m * s;
  tc.save();
  tc.strokeStyle = col; tc.lineWidth = 1.5;
  tc.beginPath();
  tc.moveTo(vx + u1x, vy + u1y);
  tc.lineTo(vx + u1x + u2x, vy + u1y + u2y);
  tc.lineTo(vx + u2x, vy + u2y);
  tc.stroke();
  tc.restore();
}

function drawCtxVertex(tc, x, y, col, label) {
  tc.save();
  tc.fillStyle = col; tc.strokeStyle = 'white'; tc.lineWidth = 2;
  tc.shadowColor = 'rgba(0,0,0,0.2)'; tc.shadowBlur = 6;
  tc.beginPath(); tc.arc(x, y, 9, 0, 2 * Math.PI); tc.fill(); tc.stroke();
  tc.shadowBlur = 0;
  if (label) {
    tc.fillStyle = 'white';
    tc.font = '700 10px "Trebuchet MS",sans-serif';
    tc.textAlign = 'center'; tc.textBaseline = 'middle';
    tc.fillText(label, x, y);
  }
  tc.restore();
}

function ctxArrow(tc, x1, y1, x2, y2, col, w) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 4) return;
  const ux = dx / len, uy = dy / len, hs = Math.min(12, len * 0.3);
  tc.save();
  tc.strokeStyle = col; tc.fillStyle = col; tc.lineWidth = w; tc.lineCap = 'round';
  tc.beginPath(); tc.moveTo(x1, y1); tc.lineTo(x2, y2); tc.stroke();
  tc.beginPath();
  tc.moveTo(x2, y2);
  tc.lineTo(x2 - hs * (ux - 0.38 * uy), y2 - hs * (uy + 0.38 * ux));
  tc.lineTo(x2 - hs * (ux + 0.38 * uy), y2 - hs * (uy - 0.38 * ux));
  tc.closePath(); tc.fill();
  tc.restore();
}

/* ── Open / close modal ──────────────────────────────────────── */
function openCollTriModal() {
  if (cfg.presetIdx === 3) return; // 3-particle chain: no editor
  if (cfg.presetIdx === 2 || cfg.presetIdx === 4) {
    openCollTri2Modal();
    return;
  }
  // Presets 0 & 1: elastic, stationary B
  collTriOpen = true;
  document.getElementById('coll-tri-modal').hidden = false;
  document.getElementById('btn-coll-tri-edit').classList.add('active');
  setCollSliderLock(true);
  buildCollTriVertices();
  applyCollTriVertices();
  drawCollTriangle();
}

function closeCollTriModal() {
  collTriOpen = false;
  document.getElementById('coll-tri-modal').hidden = true;
  document.getElementById('btn-coll-tri-edit').classList.remove('active');
  setCollSliderLock(false);
}

function closeCollTri2Modal() {
  collTri2Open = false;
  document.getElementById('coll-tri2-modal').hidden = true;
  document.getElementById('btn-coll-tri-edit').classList.remove('active');
  setCollSliderLock(false);
}

let collTri2Open = false;

/* ═══════════════════════════════════════════════════════════════
   INELASTIC TRIANGLE EDITOR  (Preset 2)
   Triangle: O (fixed) → A (p_Ai) → Q (p_total = p_Ai + p_Bi)
   Sides: O→A = p_Ai (blue), A→Q = p_Bi (red), O→Q = p_merged (grey)
═══════════════════════════════════════════════════════════════ */

const tri2Canvas = document.getElementById('coll-tri2-canvas');
const tri2Ctx    = tri2Canvas.getContext('2d');
const T2W = 460, T2H = 460;
const T2OX = 120, T2OY = 270;   // O position on tri2 canvas

let tri2Scale = 1;
let tri2Ax = 0, tri2Ay = 0;     // A vertex (tip of p_Ai) in tri2-canvas coords
let tri2Qx = 0, tri2Qy = 0;     // Q vertex (tip of p_total)  in tri2-canvas coords
let tri2Drag = null;             // null | 'A' | 'Q'

/* ── Coordinate helpers ──────────────────────────────────────── */
function phys2ToTri(px, py) {
  return { x: T2OX + px * tri2Scale, y: T2OY - py * tri2Scale };
}
function tri2ToPhys(tx, ty) {
  return { x: (tx - T2OX) / tri2Scale, y: -(ty - T2OY) / tri2Scale };
}

/* ── Build vertices from preset ──────────────────────────────── */
function buildTri2Vertices() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;
  const aR = ps[0].angle * Math.PI / 180, bR = ps[1].angle * Math.PI / 180;
  const pAi = { x: mA * ps[0].speed * Math.cos(aR), y: mA * ps[0].speed * Math.sin(aR) };
  const pBi = { x: mB * ps[1].speed * Math.cos(bR), y: mB * ps[1].speed * Math.sin(bR) };
  const pQ  = { x: pAi.x + pBi.x, y: pAi.y + pBi.y };

  const maxMag = Math.max(Math.hypot(pAi.x, pAi.y), Math.hypot(pBi.x, pBi.y),
                          Math.hypot(pQ.x, pQ.y), 1);
  tri2Scale = Math.min(160 / maxMag, (T2W - T2OX - 20) / maxMag, (T2OY - 20) / maxMag);

  const A = phys2ToTri(pAi.x, pAi.y);
  const Q = phys2ToTri(pQ.x,  pQ.y);
  tri2Ax = A.x; tri2Ay = A.y;
  tri2Qx = Q.x; tri2Qy = Q.y;
}

/* ── Apply vertices → preset + reset sim ────────────────────── */
function applyTri2Vertices() {
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;

  const pAi = tri2ToPhys(tri2Ax, tri2Ay);
  const pQ  = tri2ToPhys(tri2Qx, tri2Qy);
  const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };

  const pAiMag = Math.hypot(pAi.x, pAi.y);
  const pBiMag = Math.hypot(pBi.x, pBi.y);

  if (pAiMag > 0.001) {
    ps[0].speed = Math.max(1, Math.round(pAiMag / mA));
    ps[0].angle = Math.round(Math.atan2(pAi.y, pAi.x) * 180 / Math.PI);
  }
  if (pBiMag > 0.001) {
    ps[1].speed = Math.max(1, Math.round(pBiMag / mB));
    ps[1].angle = Math.round(Math.atan2(pBi.y, pBi.x) * 180 / Math.PI);
  }

  positionTri2Particles(ps, pAi, pBi);
  syncCollSliders();
  if (cfg.mode === 'strobe') generateStrobe(); else reset();
  updateTri2Warning(ps);
}

/* ── Position particles via relative-velocity ray trace ──────── */
// nHint: optional pre-computed canvas-space contact normal (from J in quad editor)
function positionTri2Particles(ps, pAi, pBi, nHint = null) {
  const mA = ps[0].mass, mB = ps[1].mass;
  const rA = radius(mA), rB = radius(mB), rSum = rA + rB;

  // Canvas velocity directions (y-flipped from physics)
  const angleARad = ps[0].angle * Math.PI / 180;
  const angleBRad = ps[1].angle * Math.PI / 180;
  const vAcx = Math.cos(angleARad), vAcy = -Math.sin(angleARad);
  const vBcx = Math.cos(angleBRad), vBcy = -Math.sin(angleBRad);

  // Relative velocity of A w.r.t. B — use as collision normal
  const vRelx = ps[0].speed * vAcx - ps[1].speed * vBcx;
  const vRely = ps[0].speed * vAcy - ps[1].speed * vBcy;
  const vRelMag = Math.hypot(vRelx, vRely);

  let nCx, nCy;
  if (nHint) {
    nCx = nHint.x; nCy = nHint.y;  // desired scattering angle from J
  } else if (vRelMag > 0.5) {
    nCx = vRelx / vRelMag; nCy = vRely / vRelMag;
  } else {
    nCx = -vAcy; nCy = vAcx; // fallback: perp to A's velocity
  }

  // Collision positions (canvas centre)
  const Cx = 480, Cy = 280;
  const Ax_c = Cx - rA * nCx, Ay_c = Cy - rA * nCy;
  const Bx_c = Cx + rB * nCx, By_c = Cy + rB * nCy;

  // Pixels each particle must travel to reach its collision position from the canvas edge
  function edgeDist(px, py, dvx, dvy, r) {
    const ts = [];
    if (dvx >  0.001) ts.push((px + r) / dvx);
    else if (dvx < -0.001) ts.push((CW + r - px) / (-dvx));
    if (dvy >  0.001) ts.push((py + r) / dvy);
    else if (dvy < -0.001) ts.push((CH + r - py) / (-dvy));
    return ts.length > 0 ? Math.min(...ts) : 800;
  }

  const distA = edgeDist(Ax_c, Ay_c, vAcx, vAcy, rA);
  const distB = edgeDist(Bx_c, By_c, vBcx, vBcy, rB);

  // Shared collision time: at least MIN_TRAVEL px for each particle,
  // and at least as long as the faster-arriving particle's edge time so that
  // one particle always starts at/beyond its canvas edge.
  const MIN_TRAVEL = 80; // px — minimum visible travel before collision
  const T_A_edge = distA / ps[0].speed;
  const T_B_edge = distB / ps[1].speed;
  const T = Math.max(
    MIN_TRAVEL / Math.min(ps[0].speed, ps[1].speed),
    Math.min(T_A_edge, T_B_edge)
  );

  // Position each particle T seconds before the collision.
  // If T > T_X_edge the particle starts off-canvas; the entered flag handles that.
  ps[0].x = Ax_c - T * ps[0].speed * vAcx; ps[0].y = Ay_c - T * ps[0].speed * vAcy;
  ps[1].x = Bx_c - T * ps[1].speed * vBcx; ps[1].y = By_c - T * ps[1].speed * vBcy;
}

/* ── Warning: nearly-identical velocities ────────────────────── */
function updateTri2Warning(ps) {
  const el = document.getElementById('warn-no-collision');
  if (!el) return;
  const aR = ps[0].angle * Math.PI / 180, bR = ps[1].angle * Math.PI / 180;
  const vAcx = ps[0].speed * Math.cos(aR), vAcy = -ps[0].speed * Math.sin(aR);
  const vBcx = ps[1].speed * Math.cos(bR), vBcy = -ps[1].speed * Math.sin(bR);
  const vRelMag = Math.hypot(vAcx - vBcx, vAcy - vBcy);
  // Warn only when relative velocity is negligible (particles moving identically)
  el.hidden = vRelMag > 1;
}

/* ── Snap helpers (physics space) ───────────────────────────── */
// Equilateral apex of triangle with base from O=(0,0) to (bx, by)
function tri2EquilSnaps(bx, by) {
  return [
    { x: bx / 2 - Math.sqrt(3) * by / 2, y: by / 2 + Math.sqrt(3) * bx / 2 },
    { x: bx / 2 + Math.sqrt(3) * by / 2, y: by / 2 - Math.sqrt(3) * bx / 2 },
  ];
}

/* ── Draw triangle ───────────────────────────────────────────── */
function drawTri2() {
  const tc = tri2Ctx;
  tc.clearRect(0, 0, T2W, T2H);
  tc.fillStyle = 'rgba(240,244,255,0.98)';
  tc.fillRect(0, 0, T2W, T2H);

  // Grid dots
  tc.save(); tc.fillStyle = 'rgba(21,48,77,0.06)';
  for (let x = 20; x < T2W; x += 40)
    for (let y = 20; y < T2H; y += 40)
      { tc.beginPath(); tc.arc(x, y, 1.5, 0, 2 * Math.PI); tc.fill(); }
  tc.restore();

  // Show snap targets as faint dots
  const pAi = tri2ToPhys(tri2Ax, tri2Ay);
  const pQ  = tri2ToPhys(tri2Qx, tri2Qy);
  tc.save(); tc.fillStyle = 'rgba(124,58,237,0.25)';
  [...tri2EquilSnaps(pQ.x, pQ.y), ...tri2EquilSnaps(pAi.x, pAi.y)].forEach(s => {
    const c = phys2ToTri(s.x, s.y);
    tc.beginPath(); tc.arc(c.x, c.y, 4, 0, 2 * Math.PI); tc.fill();
  });
  tc.restore();

  // Arrows
  ctxArrow(tc, T2OX, T2OY, tri2Ax, tri2Ay, '#2563eb', 2.5);       // p_Ai
  ctxArrow(tc, tri2Ax, tri2Ay, tri2Qx, tri2Qy, '#dc2626', 2.5);   // p_Bi
  ctxArrow(tc, T2OX, T2OY, tri2Qx, tri2Qy, '#8b9db5', 2);         // p_merged

  // Right-angle marker at A if pAi ⊥ pBi
  const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };
  const mAi = Math.hypot(pAi.x, pAi.y), mBi = Math.hypot(pBi.x, pBi.y);
  if (mAi > 0.01 && mBi > 0.01 &&
      Math.abs((pAi.x * pBi.x + pAi.y * pBi.y) / (mAi * mBi)) < 0.05) {
    drawRightAngleMark(tc, tri2Ax, tri2Ay,
      T2OX - tri2Ax, T2OY - tri2Ay, tri2Qx - tri2Ax, tri2Qy - tri2Ay, 9, '#55708d');
  }

  // Labels
  tc.save(); tc.font = '700 10px "Trebuchet MS",sans-serif'; tc.textBaseline = 'middle';
  tc.fillStyle = '#2563eb'; tc.textAlign = 'center';
  tc.fillText('p\u2090 initial', (T2OX + tri2Ax) / 2, (T2OY + tri2Ay) / 2 - 11);
  tc.fillStyle = '#dc2626'; tc.textAlign = 'left';
  tc.fillText('p\u2099 initial', (tri2Ax + tri2Qx) / 2 + 8, (tri2Ay + tri2Qy) / 2);
  tc.fillStyle = '#8b9db5'; tc.textAlign = 'center';
  tc.fillText('p merged', (T2OX + tri2Qx) / 2, (T2OY + tri2Qy) / 2 + 11);
  tc.restore();

  // Origin label
  tc.save(); tc.fillStyle = '#55708d';
  tc.font = '700 12px "Trebuchet MS",sans-serif';
  tc.textAlign = 'right'; tc.textBaseline = 'top';
  tc.fillText('O', T2OX - 7, T2OY + 4);
  tc.restore();

  // Vertices
  drawCtxVertex(tc, T2OX, T2OY, '#55708d', '');
  drawCtxVertex(tc, tri2Ax, tri2Ay, '#2563eb', 'A');
  drawCtxVertex(tc, tri2Qx, tri2Qy, '#475569', 'Q');
}

/* ── Open / close ─────────────────────────────────────────────── */
function openCollTri2Modal() {
  if (cfg.presetIdx !== 2 && cfg.presetIdx !== 4) return;

  collTri2Open = true;
  document.getElementById('coll-tri2-modal').hidden = false;
  document.getElementById('btn-coll-tri-edit').classList.add('active');
  setCollSliderLock(true);

  if (cfg.presetIdx === 4) {
    document.getElementById('coll-tri2-modal-title').textContent = 'Elastic Momentum Editor';
    document.getElementById('coll-tri2-hint').innerHTML =
      'Drag <strong>P</strong> (p\u2090 initial) or <strong>Q</strong> (total momentum) to set initial momenta. ' +
      'Drag <strong>J</strong> (p\u2090 final) along the elastic circle to choose the final state. ' +
      'Total momentum is always conserved.';
    if (!q4Built) { buildQuad4Vertices(); q4Built = true; }
    applyQuad4Vertices();
    drawQuad4();
  } else {
    document.getElementById('coll-tri2-modal-title').textContent = 'Inelastic Triangle Editor';
    document.getElementById('coll-tri2-hint').innerHTML =
      'Drag <strong>A</strong> to set p\u2090 initial. Drag <strong>Q</strong> to set the total momentum ' +
      '(p\u2099 initial = Q \u2212 A). Snaps to right-angle (\u22a5) and equilateral configurations.';
    buildTri2Vertices();
    applyTri2Vertices();
    drawTri2();
  }
}

document.getElementById('coll-tri2-modal-reset').addEventListener('click', () => {
  // Restore original preset defaults then rebuild
  const defs = PRESETS_DEFAULTS[cfg.presetIdx].particles;
  const ps   = PRESETS[cfg.presetIdx].particles;
  defs.forEach((d, i) => { ps[i].speed = d.speed; ps[i].angle = d.angle; ps[i].mass = d.mass; });
  if (cfg.presetIdx === 4) {
    q4Built = true; // we're explicitly building right now
    buildQuad4Vertices(); applyQuad4Vertices(); drawQuad4();
  } else {
    buildTri2Vertices(); applyTri2Vertices(); drawTri2();
  }
});

/* ── Drag handlers ───────────────────────────────────────────── */
const TRI2_SNAP_PX = 14;

function tri2Down(e) {
  if (cfg.presetIdx === 4) { quad4Down(e); return; }
  const rect = tri2Canvas.getBoundingClientRect();
  const sx = T2W / rect.width, sy = T2H / rect.height;
  const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
  if (Math.hypot(mx - tri2Ax, my - tri2Ay) < 16)      tri2Drag = 'A';
  else if (Math.hypot(mx - tri2Qx, my - tri2Qy) < 16) tri2Drag = 'Q';
}

function tri2Move(e) {
  if (cfg.presetIdx === 4) { quad4Move(e); return; }
  if (!tri2Drag) return;
  e.preventDefault();
  const rect = tri2Canvas.getBoundingClientRect();
  const sx = T2W / rect.width, sy = T2H / rect.height;
  const mx = Math.max(10, Math.min(T2W - 10, (e.clientX - rect.left) * sx));
  const my = Math.max(10, Math.min(T2H - 10, (e.clientY - rect.top) * sy));
  const mPhys = tri2ToPhys(mx, my);
  const snapThresh = TRI2_SNAP_PX / tri2Scale;

  if (tri2Drag === 'A') {
    const Qphys = tri2ToPhys(tri2Qx, tri2Qy);
    const Qmag  = Math.hypot(Qphys.x, Qphys.y);
    let best = null, bestD = snapThresh;

    // Equilateral snaps for A given Q
    tri2EquilSnaps(Qphys.x, Qphys.y).forEach(s => {
      const d = Math.hypot(mPhys.x - s.x, mPhys.y - s.y);
      if (d < bestD) { bestD = d; best = s; }
    });

    // Right-angle snap: Thales circle (center Q/2, radius |Q|/2)
    if (Qmag > 0.001) {
      const tcx = Qphys.x / 2, tcy = Qphys.y / 2, tr = Qmag / 2;
      const dToC = Math.hypot(mPhys.x - tcx, mPhys.y - tcy);
      if (dToC > 0.001 && Math.abs(dToC - tr) < snapThresh) {
        const s = { x: tcx + (mPhys.x - tcx) / dToC * tr,
                    y: tcy + (mPhys.y - tcy) / dToC * tr };
        const d = Math.hypot(mPhys.x - s.x, mPhys.y - s.y);
        if (!best || d < bestD) { best = s; }
      }
    }

    const f = best || mPhys;
    const t = phys2ToTri(f.x, f.y);
    tri2Ax = t.x; tri2Ay = t.y;

  } else { // Q
    const Aphys = tri2ToPhys(tri2Ax, tri2Ay);
    const Amag  = Math.hypot(Aphys.x, Aphys.y);
    let best = null, bestD = snapThresh;

    // Equilateral snaps for Q given A
    tri2EquilSnaps(Aphys.x, Aphys.y).forEach(s => {
      const d = Math.hypot(mPhys.x - s.x, mPhys.y - s.y);
      if (d < bestD) { bestD = d; best = s; }
    });

    // Right-angle snap: project Q onto line through A perp to OA
    if (Amag > 0.001) {
      const uAx = Aphys.x / Amag, uAy = Aphys.y / Amag; // unit along OA
      const perpDist = Math.abs((mPhys.x - Aphys.x) * uAx + (mPhys.y - Aphys.y) * uAy);
      if (perpDist < snapThresh) {
        const perpx = -uAy, perpy = uAx;
        const t = (mPhys.x - Aphys.x) * perpx + (mPhys.y - Aphys.y) * perpy;
        const s = { x: Aphys.x + t * perpx, y: Aphys.y + t * perpy };
        if (!best || perpDist < bestD) { best = s; bestD = perpDist; }
      }
    }

    const f = best || mPhys;
    const t = phys2ToTri(f.x, f.y);
    tri2Qx = t.x; tri2Qy = t.y;
  }

  drawTri2();
  applyTri2Vertices();
}

function tri2Up() { if (cfg.presetIdx === 4) quad4Up(); else tri2Drag = null; }

tri2Canvas.addEventListener('mousedown',  tri2Down);
tri2Canvas.addEventListener('mousemove',  tri2Move);
tri2Canvas.addEventListener('mouseup',    tri2Up);
tri2Canvas.addEventListener('mouseleave', tri2Up);
tri2Canvas.addEventListener('touchstart', e => tri2Down(e.touches[0]), { passive: true });
tri2Canvas.addEventListener('touchmove',  e => tri2Move(e.touches[0]), { passive: false });
tri2Canvas.addEventListener('touchend',   tri2Up);

/* ═══════════════════════════════════════════════════════════════
   ELASTIC QUADRILATERAL EDITOR  (Preset 4)
   Quadrilateral vertices (physics space):
     O = (0,0) fixed
     P = tip of p_Ai  (draggable)
     Q = tip of p_total = p_Ai + p_Bi  (draggable)
     J = tip of p_Af  (draggable, constrained to elastic circle)
   Sides: O→P = p_Ai (blue solid), P→Q = p_Bi (red solid),
          O→J = p_Af (blue dashed), J→Q = p_Bf (red dashed),
          O→Q = p_total (grey diagonal)
   Elastic circle: center = mA/(mA+mB)·p_total, radius = |p_Ai − center|
═══════════════════════════════════════════════════════════════ */

const Q4OX = 200, Q4OY = 200;   // canvas origin for preset 4

let q4Scale = 1;
let q4Px = 0, q4Py = 0;         // P vertex (p_Ai tip)
let q4Qx = 0, q4Qy = 0;         // Q vertex (p_total tip)
let q4Jx = 0, q4Jy = 0;         // J vertex (p_Af tip)
let q4Drag  = null;              // null | 'P' | 'Q' | 'J'
let q4Built = false;             // true once buildQuad4Vertices has run for this preset selection

function phys4ToTri(px, py) {
  return { x: Q4OX + px * q4Scale, y: Q4OY - py * q4Scale };
}
function tri4ToPhys(tx, ty) {
  return { x: (tx - Q4OX) / q4Scale, y: -(ty - Q4OY) / q4Scale };
}

/* ── General elastic circle (works for any initial velocities) ── */
function getElasticCircleGeneral(pAix, pAiy, pBix, pBiy, mA, mB) {
  const f  = mA / (mA + mB);
  const cx = f * (pAix + pBix), cy = f * (pAiy + pBiy);
  return { cx, cy, r: Math.hypot(pAix - cx, pAiy - cy) };
}

/* ── Build vertices from preset 4 defaults ───────────────────── */
function buildQuad4Vertices() {
  const ps = PRESETS[4].particles;
  const mA = ps[0].mass, mB = ps[1].mass;
  const aR = ps[0].angle * Math.PI / 180, bR = ps[1].angle * Math.PI / 180;
  const pAi = { x: mA * ps[0].speed * Math.cos(aR), y: mA * ps[0].speed * Math.sin(aR) };
  const pBi = { x: mB * ps[1].speed * Math.cos(bR), y: mB * ps[1].speed * Math.sin(bR) };
  const pQ  = { x: pAi.x + pBi.x, y: pAi.y + pBi.y };

  // Default J: head-on in CoM frame (particles exchange momenta for equal masses)
  const { cx, cy, r: ec_r } = getElasticCircleGeneral(pAi.x, pAi.y, pBi.x, pBi.y, mA, mB);
  const J_phys = { x: 2 * cx - pAi.x, y: 2 * cy - pAi.y };

  // Scale to fit vertices AND elastic circle in each canvas direction
  const allPts = [pAi, pQ, J_phys,
    { x: cx + ec_r, y: cy }, { x: cx - ec_r, y: cy },
    { x: cx, y: cy + ec_r }, { x: cx, y: cy - ec_r }];
  const maxRight = Math.max(1, ...allPts.map(v => v.x));
  const maxLeft  = Math.max(1, ...allPts.map(v => -v.x));
  const maxUp    = Math.max(1, ...allPts.map(v => v.y));
  const maxDown  = Math.max(1, ...allPts.map(v => -v.y));
  const margin = 30;
  q4Scale = Math.min(
    (T2W - Q4OX - margin) / maxRight,
    (Q4OX - margin)       / maxLeft,
    (Q4OY - margin)       / maxUp,
    (T2H - Q4OY - margin) / maxDown
  );

  const P = phys4ToTri(pAi.x,    pAi.y);
  const Qc = phys4ToTri(pQ.x,     pQ.y);
  const J  = phys4ToTri(J_phys.x, J_phys.y);
  q4Px = P.x;  q4Py = P.y;
  q4Qx = Qc.x; q4Qy = Qc.y;
  q4Jx = J.x;  q4Jy = J.y;
}

/* ── Apply vertices → preset + reset sim ────────────────────── */
function applyQuad4Vertices() {
  const ps = PRESETS[4].particles;
  const mA = ps[0].mass, mB = ps[1].mass;

  const pAi = tri4ToPhys(q4Px, q4Py);
  const pQ  = tri4ToPhys(q4Qx, q4Qy);
  const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };

  const pAiMag = Math.hypot(pAi.x, pAi.y);
  const pBiMag = Math.hypot(pBi.x, pBi.y);
  if (pAiMag > 0.001) {
    ps[0].speed = Math.max(1, Math.round(pAiMag / mA));
    ps[0].angle = Math.round(Math.atan2(pAi.y, pAi.x) * 180 / Math.PI);
  }
  if (pBiMag > 0.001) {
    ps[1].speed = Math.max(1, Math.round(pBiMag / mB));
    ps[1].angle = Math.round(Math.atan2(pBi.y, pBi.x) * 180 / Math.PI);
  }

  // Derive contact normal from J (= p_Af in physics space).
  // From elastic collision formula: n̂ ∝ p_Ai − p_Af (physics space),
  // then y-flipped to canvas space.
  const pAf = tri4ToPhys(q4Jx, q4Jy);
  const dnx = pAi.x - pAf.x, dny = pAi.y - pAf.y;
  const dnMag = Math.hypot(dnx, dny);
  const nHint = dnMag > 0.5
    ? { x: dnx / dnMag, y: -dny / dnMag }  // y-flip physics → canvas
    : null;

  positionTri2Particles(ps, pAi, pBi, nHint);
  syncCollSliders();
  if (cfg.mode === 'strobe') generateStrobe(); else reset();
  updateTri2Warning(ps);
}

/* ── Draw quadrilateral ──────────────────────────────────────── */
function drawQuad4() {
  const tc = tri2Ctx;
  tc.clearRect(0, 0, T2W, T2H);
  tc.fillStyle = 'rgba(240,244,255,0.98)';
  tc.fillRect(0, 0, T2W, T2H);

  // Grid dots
  tc.save(); tc.fillStyle = 'rgba(21,48,77,0.06)';
  for (let x = 20; x < T2W; x += 40)
    for (let y = 20; y < T2H; y += 40)
      { tc.beginPath(); tc.arc(x, y, 1.5, 0, 2 * Math.PI); tc.fill(); }
  tc.restore();

  const pAi = tri4ToPhys(q4Px, q4Py);
  const pAf = tri4ToPhys(q4Jx, q4Jy);
  const pQ  = tri4ToPhys(q4Qx, q4Qy);
  const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };
  const pBf = { x: pQ.x - pAf.x, y: pQ.y - pAf.y };
  const mA = PRESETS[4].particles[0].mass, mB = PRESETS[4].particles[1].mass;

  // Elastic circle (dashed, faint purple)
  const { cx: ec_px, cy: ec_py, r: er_phys } =
    getElasticCircleGeneral(pAi.x, pAi.y, pBi.x, pBi.y, mA, mB);
  const ec = phys4ToTri(ec_px, ec_py);
  const er = er_phys * q4Scale;
  tc.save();
  tc.strokeStyle = 'rgba(124,58,237,0.25)'; tc.lineWidth = 1.5;
  tc.setLineDash([5, 4]);
  tc.beginPath(); tc.arc(ec.x, ec.y, er, 0, 2 * Math.PI); tc.stroke();
  tc.setLineDash([]);
  tc.fillStyle = 'rgba(124,58,237,0.45)';
  tc.font = '600 10px "Trebuchet MS",sans-serif';
  tc.textAlign = 'center'; tc.textBaseline = 'bottom';
  tc.fillText('elastic circle (J constrained)', ec.x, ec.y - er - 4);
  tc.restore();

  // Head-on snap dot (purple)
  tc.save(); tc.fillStyle = 'rgba(124,58,237,0.40)';
  const snapHO = phys4ToTri(2 * ec_px - pAi.x, 2 * ec_py - pAi.y);
  tc.beginPath(); tc.arc(snapHO.x, snapHO.y, 4, 0, 2 * Math.PI); tc.fill();
  tc.restore();

  // Diagonal O→Q (total momentum, grey background line)
  ctxArrow(tc, Q4OX, Q4OY, q4Qx, q4Qy, '#8b9db5', 1.5);

  // Initial momenta: O→P (blue solid), P→Q (red solid)
  ctxArrow(tc, Q4OX, Q4OY, q4Px, q4Py, '#2563eb', 2.5);
  ctxArrow(tc, q4Px,  q4Py,  q4Qx, q4Qy, '#dc2626', 2.5);

  // Final momenta: O→J (blue dashed), J→Q (red dashed)
  tc.save();
  tc.setLineDash([6, 3]);
  ctxArrow(tc, Q4OX, Q4OY, q4Jx, q4Jy, '#2563eb', 2);
  ctxArrow(tc, q4Jx, q4Jy, q4Qx, q4Qy, '#dc2626', 2);
  tc.setLineDash([]);
  tc.restore();

  // Right-angle marker at J if p_Af ⊥ p_Bf
  const mAf = Math.hypot(pAf.x, pAf.y), mBf = Math.hypot(pBf.x, pBf.y);
  if (mAf > 0.01 && mBf > 0.01 &&
      Math.abs((pAf.x * pBf.x + pAf.y * pBf.y) / (mAf * mBf)) < 0.05) {
    drawRightAngleMark(tc, q4Jx, q4Jy,
      Q4OX - q4Jx, Q4OY - q4Jy, q4Qx - q4Jx, q4Qy - q4Jy, 9, '#55708d');
  }

  // Labels
  tc.save(); tc.font = '700 10px "Trebuchet MS",sans-serif'; tc.textBaseline = 'middle';
  tc.fillStyle = '#2563eb'; tc.textAlign = 'center';
  tc.fillText('p\u2090 init',  (Q4OX + q4Px) / 2, (Q4OY + q4Py) / 2 - 11);
  tc.fillStyle = '#dc2626'; tc.textAlign = 'left';
  tc.fillText('p\u2099 init', (q4Px + q4Qx) / 2 + 8, (q4Py + q4Qy) / 2);
  tc.fillStyle = '#2563eb'; tc.textAlign = 'center';
  tc.fillText('p\u2090 final', (Q4OX + q4Jx) / 2, (Q4OY + q4Jy) / 2 + 11);
  tc.fillStyle = '#dc2626'; tc.textAlign = 'left';
  tc.fillText('p\u2099 final', (q4Jx + q4Qx) / 2 + 8, (q4Jy + q4Qy) / 2);
  tc.restore();

  // Origin label
  tc.save(); tc.fillStyle = '#55708d';
  tc.font = '700 12px "Trebuchet MS",sans-serif';
  tc.textAlign = 'right'; tc.textBaseline = 'top';
  tc.fillText('O', Q4OX - 7, Q4OY + 4);
  tc.restore();

  // Vertices: O (fixed), P (blue), Q (grey), J (purple)
  drawCtxVertex(tc, Q4OX, Q4OY, '#55708d', '');
  drawCtxVertex(tc, q4Px, q4Py, '#2563eb', 'P');
  drawCtxVertex(tc, q4Qx, q4Qy, '#475569', 'Q');
  drawCtxVertex(tc, q4Jx, q4Jy, '#7c3aed', 'J');
}

/* ── Drag handlers for preset 4 ──────────────────────────────── */
const Q4_SNAP_PX = 15;

function quad4Down(e) {
  const rect = tri2Canvas.getBoundingClientRect();
  const sx = T2W / rect.width, sy = T2H / rect.height;
  const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
  if      (Math.hypot(mx - q4Px, my - q4Py) < 16) q4Drag = 'P';
  else if (Math.hypot(mx - q4Qx, my - q4Qy) < 16) q4Drag = 'Q';
  else if (Math.hypot(mx - q4Jx, my - q4Jy) < 16) q4Drag = 'J';
}

function quad4Move(e) {
  if (!q4Drag) return;
  e.preventDefault();
  const rect = tri2Canvas.getBoundingClientRect();
  const sx = T2W / rect.width, sy = T2H / rect.height;
  const mx = Math.max(10, Math.min(T2W - 10, (e.clientX - rect.left) * sx));
  const my = Math.max(10, Math.min(T2H - 10, (e.clientY - rect.top) * sy));
  const mPhys = tri4ToPhys(mx, my);
  const ps = PRESETS[4].particles;
  const mA = ps[0].mass, mB = ps[1].mass;

  if (q4Drag === 'P' || q4Drag === 'Q') {
    // Update dragged vertex; re-clamp J to the new elastic circle
    if (q4Drag === 'P') { q4Px = mx; q4Py = my; }
    else                { q4Qx = mx; q4Qy = my; }
    const pAi = tri4ToPhys(q4Px, q4Py);
    const pQ  = tri4ToPhys(q4Qx, q4Qy);
    const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };
    const pAf = tri4ToPhys(q4Jx, q4Jy);
    const { cx, cy, r } = getElasticCircleGeneral(pAi.x, pAi.y, pBi.x, pBi.y, mA, mB);
    if (r > 0.001) {
      const clamped = clampToCircle(pAf.x, pAf.y, cx, cy, r);
      const J = phys4ToTri(clamped.x, clamped.y);
      q4Jx = J.x; q4Jy = J.y;
    }

  } else { // J — constrained to elastic circle, head-on snap
    const pAi = tri4ToPhys(q4Px, q4Py);
    const pQ  = tri4ToPhys(q4Qx, q4Qy);
    const pBi = { x: pQ.x - pAi.x, y: pQ.y - pAi.y };
    const { cx, cy, r } = getElasticCircleGeneral(pAi.x, pAi.y, pBi.x, pBi.y, mA, mB);
    if (r < 0.001) return;
    const clamped = clampToCircle(mPhys.x, mPhys.y, cx, cy, r);
    // Head-on snap: J = 2*center − pAi
    const snapThresh = Q4_SNAP_PX / q4Scale;
    const headOn = { x: 2 * cx - pAi.x, y: 2 * cy - pAi.y };
    // Snap to head-on; block P (J=pAi means zero scattering — degenerate)
    const nearHeadOn = Math.hypot(clamped.x - headOn.x, clamped.y - headOn.y) < snapThresh;
    const nearP      = Math.hypot(clamped.x - pAi.x,   clamped.y - pAi.y)   < snapThresh;
    if (nearP) return; // don't allow J to reach P
    const final = nearHeadOn ? headOn : clamped;
    const J = phys4ToTri(final.x, final.y);
    q4Jx = J.x; q4Jy = J.y;
  }

  drawQuad4();
  applyQuad4Vertices();
}

function quad4Up() { q4Drag = null; }

/* ──────────────────────────────────────────────────────────────── */

function setCollSliderLock(locked) {
  document.querySelectorAll('.particle-group').forEach(g => g.classList.toggle('tri-locked', locked));
  const strobeGroup = document.getElementById('slider-strobe')?.closest('.control-group');
  if (strobeGroup) strobeGroup.classList.toggle('tri-locked', locked);
}

/* ── Drag handlers ───────────────────────────────────────────── */
const SNAP_PX = 15; // magnetic snap distance in tri-canvas px

function collTriDown(e) {
  const rect = collTriCanvas.getBoundingClientRect();
  const sx = CTOW / rect.width, sy = CTOH / rect.height;
  const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
  if (Math.hypot(mx - collTriPx, my - collTriPy) < 16) collTriDrag = 'P';
  else if (Math.hypot(mx - collTriJx, my - collTriJy) < 16) collTriDrag = 'J';
}

function collTriMove(e) {
  if (!collTriDrag) return;
  e.preventDefault();
  const rect = collTriCanvas.getBoundingClientRect();
  const sx = CTOW / rect.width, sy = CTOH / rect.height;
  let mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;

  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;

  if (collTriDrag === 'P') {
    mx = Math.max(CTOX + 25, Math.min(CTOW - 10, mx));
    my = Math.max(10, Math.min(CTOH - 10, my));
    collTriPx = mx; collTriPy = my;
    // Re-clamp J to new elastic circle
    const pAi = triToPhys(collTriPx, collTriPy);
    const { cx, cy, r } = getElasticCircle(pAi.x, pAi.y, mA, mB);
    const pAf = triToPhys(collTriJx, collTriJy);
    const clamped = clampToCircle(pAf.x, pAf.y, cx, cy, r);
    const J = physToTri(clamped.x, clamped.y);
    collTriJx = J.x; collTriJy = J.y;
  } else {
    // J constrained to elastic circle with magnetic snaps
    const pAi = triToPhys(collTriPx, collTriPy);
    const { cx, cy, r } = getElasticCircle(pAi.x, pAi.y, mA, mB);
    const mPhys = triToPhys(mx, my);
    const clamped = clampToCircle(mPhys.x, mPhys.y, cx, cy, r);
    // Check snaps
    const snaps = getSnapPoints(pAi.x, pAi.y, mA, mB);
    const snapThreshPhys = SNAP_PX / collTriScale;
    let best = null, bestD = snapThreshPhys;
    snaps.forEach(s => {
      const d = Math.hypot(clamped.x - s.x, clamped.y - s.y);
      if (d < bestD) { bestD = d; best = s; }
    });
    const final = best || clamped;
    const J = physToTri(final.x, final.y);
    collTriJx = J.x; collTriJy = J.y;
  }

  drawCollTriangle();
  applyCollTriVertices();
}

function collTriUp() { collTriDrag = null; }

collTriCanvas.addEventListener('mousedown', collTriDown);
collTriCanvas.addEventListener('mousemove', collTriMove);
collTriCanvas.addEventListener('mouseup',   collTriUp);
collTriCanvas.addEventListener('mouseleave', collTriUp);
collTriCanvas.addEventListener('touchstart', e => collTriDown(e.touches[0]), { passive: true });
collTriCanvas.addEventListener('touchmove',  e => collTriMove(e.touches[0]), { passive: false });
collTriCanvas.addEventListener('touchend',   collTriUp);

/* ── Wire up modal open/close buttons ────────────────────────── */
document.getElementById('btn-coll-tri-edit').addEventListener('click', () => {
  if (collTri2Open) closeCollTri2Modal();
  else if (collTriOpen) closeCollTriModal();
  else openCollTriModal();
});
document.getElementById('coll-tri-modal-close').addEventListener('click', closeCollTriModal);
document.getElementById('coll-tri-modal-backdrop').addEventListener('click', closeCollTriModal);
document.getElementById('coll-tri2-modal-close').addEventListener('click', closeCollTri2Modal);
document.getElementById('coll-tri2-modal-backdrop').addEventListener('click', closeCollTri2Modal);

/* ── Warning banner ──────────────────────────────────────────── */
function checkWillCollide() {
  if (cfg.presetIdx > 1) return true;
  const ps = PRESETS[cfg.presetIdx].particles;
  const a = ps[0], b = ps[1];
  if (b.speed !== 0) return true;
  const rSum = radius(a.mass) + radius(b.mass);
  const vx = a.speed * Math.cos(a.angle * Math.PI / 180);
  const vy = a.speed * Math.sin(a.angle * Math.PI / 180) * -1;
  const vMag = Math.hypot(vx, vy);
  if (vMag < 0.001) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  const perpDist = Math.abs(dx * vy - dy * vx) / vMag;
  if (perpDist > rSum) return false;
  const tClosest = (dx * vx + dy * vy) / (vMag * vMag);
  return tClosest > 0;
}

function updateWarnBanner() {
  const el = document.getElementById('warn-no-collision');
  if (!el) return;
  const anyEditorOpen = collTriOpen || collTri2Open;
  const needsCheck = cfg.presetIdx === 0 || cfg.presetIdx === 1 || cfg.presetIdx === 4;
  el.hidden = anyEditorOpen || !needsCheck || checkWillCollide();
}

document.getElementById('warn-close-btn').addEventListener('click', () => {
  document.getElementById('warn-no-collision').hidden = true;
});

/* ── Ensure particles are positioned for a centre collision ──── */
// Called before every reset/generateStrobe for presets that use positionTri2Particles,
// so the starting positions are always consistent with the collision geometry.
function positionPresetParticles() {
  if (cfg.presetIdx !== 2 && cfg.presetIdx !== 4) return;
  const ps = PRESETS[cfg.presetIdx].particles;
  const mA = ps[0].mass, mB = ps[1].mass;
  const aR = ps[0].angle * Math.PI / 180, bR = ps[1].angle * Math.PI / 180;
  const pAi = { x: mA * ps[0].speed * Math.cos(aR), y: mA * ps[0].speed * Math.sin(aR) };
  const pBi = { x: mB * ps[1].speed * Math.cos(bR), y: mB * ps[1].speed * Math.sin(bR) };
  positionTri2Particles(ps, pAi, pBi);
}

/* ── Apply preset to controls ────────────────────────────────── */
function applyPreset() {
  const p = PRESETS[cfg.presetIdx];
  cfg.type = p.type;

  // Sync type segmented control
  document.querySelectorAll('#seg-type .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === cfg.type);
  });

  // Sync particle controls
  p.particles.forEach((pp, i) => {
    const massEl  = document.getElementById(`mass-${i}`);
    const speedEl = document.getElementById(`speed-${i}`);
    const angleEl = document.getElementById(`angle-${i}`);
    if (massEl)  { massEl.value  = pp.mass;  document.getElementById(`val-mass-${i}`).value  = pp.mass; }
    if (speedEl) { speedEl.value = pp.speed; document.getElementById(`val-speed-${i}`).value = pp.speed; }
    if (angleEl) { angleEl.value = pp.angle; document.getElementById(`val-angle-${i}`).value = pp.angle; }
  });

  showParticleControls(p.particles.length);

  // Triangle / quadrilateral editor: close wrong modal; rebuild if open
  if (collTriOpen && (cfg.presetIdx === 2 || cfg.presetIdx === 3 || cfg.presetIdx === 4)) {
    closeCollTriModal();
  } else if (collTriOpen) {
    buildCollTriVertices();
    applyCollTriVertices();
    drawCollTriangle();
  } else if (collTri2Open && (cfg.presetIdx < 2 || cfg.presetIdx === 3)) {
    closeCollTri2Modal();
  } else if (collTri2Open) {
    openCollTri2Modal(); // rebuild for new preset
  } else {
    q4Built = false; // next openCollTri2Modal will rebuild from fresh preset params
    positionPresetParticles();
    applyAutoStrobeInterval();
    if (cfg.mode === 'strobe') generateStrobe();
    else reset();
  }

  // Update edit-button label: "triangle" for presets 0-3, "quadrilateral" for preset 4
  const editBtn = document.getElementById('btn-coll-tri-edit');
  if (editBtn) {
    const shape = cfg.presetIdx === 4 ? 'quadrilateral' : 'triangle';
    editBtn.innerHTML =
      `<span class="vec-dot" style="background:#7c3aed"></span>Edit momentum ${shape}`;
  }

  updateNoteCard();
  updateWarnBanner();
}

function showParticleControls(n) {
  [0, 1, 2].forEach(i => {
    const el = document.getElementById(`group-p${i}`);
    if (el) el.style.display = i < n ? '' : 'none';
  });
}

function updateNoteCard() {
  const el = document.getElementById('note-card');
  el.textContent = PRESETS[cfg.presetIdx].note;
}

function updateToggleUI() {
  document.querySelectorAll('.vec-btn[data-key]').forEach(btn => {
    btn.classList.toggle('active', show[btn.dataset.key]);
  });
  document.getElementById('btn-triangle').classList.toggle('active', cfg.showTriangle);
  document.getElementById('btn-labels').classList.toggle('active', cfg.showLabels);
  document.getElementById('btn-coll-tri-edit').classList.toggle('active', collTriOpen || collTri2Open);
}

/* ── show object (mirrors cfg for sidebar buttons) ───────────── */
const show = { triangle: false, labels: false };

/* ── Wire up sliders ─────────────────────────────────────────── */
function wireSlider(id, valId, key, transform, resetAfter) {
  const el = document.getElementById(id);
  const numEl = document.getElementById(valId);
  if (!el) return;
  const fmt = v => typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v;
  el.addEventListener('input', () => {
    const v = transform(parseFloat(el.value));
    cfg[key] = v;
    if (numEl) numEl.value = fmt(v);
    if (resetAfter) {
      if (cfg.mode === 'strobe') generateStrobe();
      else reset();
    }
  });
  if (numEl) numEl.addEventListener('change', () => {
    const raw = parseFloat(numEl.value);
    if (isNaN(raw)) { numEl.value = fmt(cfg[key]); return; }
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const v = transform(Math.max(min, Math.min(max, raw)));
    cfg[key] = v;
    el.value = v;
    numEl.value = fmt(v);
    if (resetAfter) {
      if (cfg.mode === 'strobe') generateStrobe();
      else reset();
    }
  });
}

/* ── Wire up particle sliders ────────────────────────────────── */
function wireParticleSliders() {
  [0, 1, 2].forEach(i => {
    const massEl  = document.getElementById(`mass-${i}`);
    const speedEl = document.getElementById(`speed-${i}`);
    const angleEl = document.getElementById(`angle-${i}`);
    const massNum  = document.getElementById(`val-mass-${i}`);
    const speedNum = document.getElementById(`val-speed-${i}`);
    const angleNum = document.getElementById(`val-angle-${i}`);

    const applyMass = v => {
      PRESETS[cfg.presetIdx].particles[i].mass = v;
      if (massEl)  massEl.value = v;
      if (massNum) massNum.value = v;
      positionPresetParticles();
      applyAutoStrobeInterval();
      if (cfg.mode === 'strobe') generateStrobe(); else reset();
    };
    const applySpeed = v => {
      PRESETS[cfg.presetIdx].particles[i].speed = v;
      if (speedEl)  speedEl.value = v;
      if (speedNum) speedNum.value = v;
      positionPresetParticles();
      applyAutoStrobeInterval();
      if (cfg.mode === 'strobe') generateStrobe(); else reset();
    };
    const applyAngle = v => {
      PRESETS[cfg.presetIdx].particles[i].angle = v;
      if (angleEl)  angleEl.value = v;
      if (angleNum) angleNum.value = v;
      positionPresetParticles();
      if (cfg.mode === 'strobe') generateStrobe(); else reset();
    };
    const clamp = (el, raw) => {
      const min = parseFloat(el.min), max = parseFloat(el.max);
      return Math.max(min, Math.min(max, raw));
    };

    if (massEl) massEl.addEventListener('input', () => applyMass(parseInt(massEl.value)));
    if (massNum) massNum.addEventListener('change', () => {
      const r = parseFloat(massNum.value);
      if (isNaN(r)) { massNum.value = PRESETS[cfg.presetIdx].particles[i].mass; return; }
      applyMass(Math.round(clamp(massEl, r)));
    });
    if (speedEl) speedEl.addEventListener('input', () => applySpeed(parseInt(speedEl.value)));
    if (speedNum) speedNum.addEventListener('change', () => {
      const r = parseFloat(speedNum.value);
      if (isNaN(r)) { speedNum.value = PRESETS[cfg.presetIdx].particles[i].speed; return; }
      applySpeed(Math.round(clamp(speedEl, r)));
    });
    if (angleEl) angleEl.addEventListener('input', () => applyAngle(parseInt(angleEl.value)));
    if (angleNum) angleNum.addEventListener('change', () => {
      const r = parseFloat(angleNum.value);
      if (isNaN(r)) { angleNum.value = PRESETS[cfg.presetIdx].particles[i].angle; return; }
      applyAngle(Math.round(clamp(angleEl, r)));
    });
  });
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
seg('seg-mode', 'mode');

/* ── Wire up collision type ──────────────────────────────────── */
seg('seg-type', 'type');

/* ── Wire up vector radio ────────────────────────────────────── */
document.querySelectorAll('input[name="vector-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    cfg.vectorMode = radio.value;
    if (cfg.mode === 'strobe') generateStrobe();
  });
});

/* ── Wire up toggle buttons ──────────────────────────────────── */
document.getElementById('btn-triangle').addEventListener('click', () => {
  cfg.showTriangle = !cfg.showTriangle;
  document.getElementById('btn-triangle').classList.toggle('active', cfg.showTriangle);
});
document.getElementById('btn-labels').addEventListener('click', () => {
  cfg.showLabels = !cfg.showLabels;
  document.getElementById('btn-labels').classList.toggle('active', cfg.showLabels);
});

/* ── Strobe interval slider ──────────────────────────────────── */
wireSlider('slider-strobe', 'val-strobe', 'strobeInterval', v => v, true);

/* ── Play/pause and reset buttons ────────────────────────────── */
document.getElementById('btn-play').addEventListener('click', () => {
  running = !running;
  document.getElementById('btn-play').textContent = running ? 'Pause' : 'Play';
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (cfg.mode === 'strobe') generateStrobe();
  else reset();
  document.getElementById('btn-play').textContent = 'Pause';
});

/* ── Particle sliders ────────────────────────────────────────── */
wireParticleSliders();

/* ── Init ───────────────────────────────────────────────────── */
applyPreset();
updateWarnBanner();
requestAnimationFrame(loop);
