/* ═══════════════════════════════════════════════════════════════════
   Hollow Conductors — two modes sharing one canvas.
   Mode A: cavity shielding (uniform external field + mobile surface charges).
   Mode B: sharp points — bendable wire whose apex field rises with curvature.
   Both modes run off a single requestAnimationFrame loop.
   ═══════════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('simulation-canvas');
const ctx    = canvas.getContext('2d');

// Logical coord system: use the canvas' intrinsic width/height (960×560) as
// the drawing space. CSS stretches it to fit. We install a DPR transform so
// strokes look crisp on retina.
const CW = canvas.width;
const CH = canvas.height;
function fitToDPR() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = CW * dpr;
  canvas.height = CH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitToDPR();
window.addEventListener('resize', fitToDPR);

// Origin used by both modes — middle of canvas.
const OX = CW / 2;
const OY = CH / 2;

// ──────────── Palette (mirrors the CSS custom properties) ────────────
const COLOR = {
  ink:         '#15304d',
  muted:       '#55708d',
  conductor:   '#5b6b7d',
  conductorEdge:'#2e3d50',
  cavity:      '#eef6ff',
  positive:    '#dc2626',
  negative:    '#2563eb',
  field:       'rgba(21, 48, 77, 0.55)',
  arrow:       '#15304d',
  air:         'rgba(80, 95, 115, 0.55)',
};

// ════════════════════════════════════════════════════════════════════
// ─────────────────────────── MODE A — CAVITY ───────────────────────
// ════════════════════════════════════════════════════════════════════

/* Thin circular (i.e. cylindrical in 2D) conducting shell. Switching to
   a circle buys us the exact analytical solution — no heuristic charge
   superposition, no leaky E inside. The cavity radius is only a hair
   smaller than the outer radius ("thin walls"); since E = 0 everywhere
   inside a conductor in equilibrium, the two regions are
   indistinguishable field-wise.                                        */
const CAVITY_CENTER = { x: OX, y: OY };
const R_CONDUCTOR = 210;
const WALL_THICK  = 12;
const R_CAVITY    = R_CONDUCTOR - WALL_THICK;

function outerR(_theta) { return R_CONDUCTOR; }
function innerR(_theta) { return R_CAVITY; }

function outerPoint(theta) {
  return {
    x: CAVITY_CENTER.x + R_CONDUCTOR * Math.cos(theta),
    y: CAVITY_CENTER.y + R_CONDUCTOR * Math.sin(theta),
  };
}
function outerTangent(theta) {
  // Unit tangent in the direction of increasing θ (CCW).
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}
function outerNormal(theta) {
  // Outward unit normal on a circle is just the radial direction.
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

function classifyPoint(x, y) {
  // 'outside' | 'wall' | 'cavity'
  const dx = x - CAVITY_CENTER.x;
  const dy = y - CAVITY_CENTER.y;
  const d  = Math.hypot(dx, dy);
  if (d > R_CONDUCTOR) return 'outside';
  if (d < R_CAVITY)    return 'cavity';
  return 'wall';
}

// ──────────── Mobile surface charges ────────────
// Each charge is tied to the outer boundary by its parameter θ. The
// physics is heuristic but behaves naturally: tangential drag from the
// external field + pairwise repulsion + damping.
// In a real metal the + ions are pinned in the lattice and only electrons
// drift. We model that literally: `ions` is a fixed static array; `charges`
// holds the mobile electrons (all sign = −1). When an electron slides away
// from its home ion, that ion becomes visible on the surface — the
// "positively charged side" is really the side where electrons have left.
const N_SITES = 32;
const ions = [];
function initIons() {
  ions.length = 0;
  for (let i = 0; i < N_SITES; i++) {
    ions.push({ theta: (i / N_SITES) * Math.PI * 2 });
  }
}
initIons();

let charges = [];
function initCharges() {
  charges = [];
  // One electron per ion site, starting co-located (neutral surface).
  for (let i = 0; i < N_SITES; i++) {
    charges.push({
      theta: (i / N_SITES) * Math.PI * 2,
      vel:   0,
      sign:  -1,
    });
  }
}
initCharges();

// External field state (Mode A).
const cavityField = {
  mag:   0.6,   // fraction of "full strength"
  angle: 0,     // radians
};

// Induced "effective E" that the conductor has settled into. This lags
// the external field with a first-order relaxation so the field plot
// evolves alongside the electron animation instead of snapping instantly.
//   inducedE = cavityField at equilibrium → full dipole, E=0 inside
//   inducedE = 0            → no shielding, lines pass straight through
// Linearity means partial inducedE gives partial shielding, with a
// residual (E_ext − inducedE) inside the conductor during the transient.
const inducedE = { x: 0, y: 0 };
const INDUCED_GAMMA = 9.0;   // 1/s; matched to the electron DAMP_RATE

function updateInducedE(dt) {
  const ex = Math.cos(cavityField.angle) * cavityField.mag;
  const ey = Math.sin(cavityField.angle) * cavityField.mag;
  const f  = 1 - Math.exp(-INDUCED_GAMMA * dt);
  inducedE.x += (ex - inducedE.x) * f;
  inducedE.y += (ey - inducedE.y) * f;
}

function updateCharges(dt) {
  // Heuristic dynamics tuned for visual feel:
  //   - Gentle tangential drag from the external field.
  //   - Softened pairwise repulsion (bounded at close range so charges
  //     can't impulse each other across the curve in a single frame).
  //   - Exponential time-based damping so the system is overdamped and
  //     behaves the same regardless of framerate.
  //   - Velocity cap as a safety net against any numerical blow-up.
  const FIELD_FORCE = 12.0;
  const REPULSION   = 0.10;
  const REP_EPS     = 0.015;  // soft-core: 1/(ad² + eps) instead of 1/ad²
  const REP_RANGE   = 1.0;
  const DAMP_RATE   = 9;      // per-sec damping γ; ~critical for the field k
  const VEL_CAP     = 4.0;    // rad/sec

  const Ex = Math.cos(cavityField.angle) * cavityField.mag;
  const Ey = Math.sin(cavityField.angle) * cavityField.mag;

  const dampFactor = Math.exp(-DAMP_RATE * dt);

  for (let i = 0; i < charges.length; i++) {
    const c = charges[i];
    const tng = outerTangent(c.theta);
    const fTan = c.sign * (tng.x * Ex + tng.y * Ey) * FIELD_FORCE;

    let rep = 0;
    for (let j = 0; j < charges.length; j++) {
      if (i === j) continue;
      let dth = charges[i].theta - charges[j].theta;
      while (dth >  Math.PI) dth -= 2 * Math.PI;
      while (dth < -Math.PI) dth += 2 * Math.PI;
      const ad = Math.abs(dth);
      if (ad < REP_RANGE) {
        rep += Math.sign(dth) * REPULSION / (ad * ad + REP_EPS);
      }
    }

    c.vel = (c.vel + (fTan + rep) * dt) * dampFactor;
    if (c.vel >  VEL_CAP) c.vel =  VEL_CAP;
    if (c.vel < -VEL_CAP) c.vel = -VEL_CAP;
    c.theta += c.vel * dt;
    if (c.theta >= Math.PI * 2) c.theta -= Math.PI * 2;
    if (c.theta <  0)           c.theta += Math.PI * 2;
  }
}

// ──────────── Total field (analytical, with transient) ────────────
// Full analytical result for a circular conductor of radius R in uniform
// external field E₀:
//   r > R:  E = E₀ + (R²/r²) · [2(E₀·r̂)r̂ − E₀]
//   r ≤ R:  E = 0
// We replace E₀ in the dipole term with the animating `inducedE` vector:
//   r > R:  E = E_ext + (R²/r²) · [2(inducedE·r̂)r̂ − inducedE]
//   r ≤ R:  E = E_ext − inducedE
// When inducedE has caught up (inducedE = E_ext) this reduces to the
// exact answer; when inducedE = 0 there is no dipole and field passes
// through unbent with E_ext everywhere. The inside expression comes from
// linearity: a fractional surface charge produces the same fraction of
// the final dipole field, so E_inside = (1 − α) E_ext where α is the
// animated alignment.
//
// Electrons on the surface are driven by updateCharges (force-based) and
// serve as the visible "witness" of the redistribution. They don't feed
// back into computeField — instead, inducedE (a smooth scalar proxy) is
// the single source of truth that both the field plot and, eventually,
// the electron settling share a time constant with.

function chargeDrawPosition(theta) {
  const p = outerPoint(theta);
  const n = outerNormal(theta);
  return { x: p.x + n.x * 3, y: p.y + n.y * 3 };
}

function computeField(x, y) {
  const E0x = Math.cos(cavityField.angle) * cavityField.mag;
  const E0y = Math.sin(cavityField.angle) * cavityField.mag;

  const dx = x - CAVITY_CENTER.x;
  const dy = y - CAVITY_CENTER.y;
  const r2 = dx * dx + dy * dy;
  if (r2 <= R_CONDUCTOR * R_CONDUCTOR) {
    return { Ex: E0x - inducedE.x, Ey: E0y - inducedE.y };
  }
  const r = Math.sqrt(r2);
  const rhatx = dx / r;
  const rhaty = dy / r;
  const EdotR = inducedE.x * rhatx + inducedE.y * rhaty;
  const scale = (R_CONDUCTOR * R_CONDUCTOR) / r2;
  return {
    Ex: E0x + scale * (2 * EdotR * rhatx - inducedE.x),
    Ey: E0y + scale * (2 * EdotR * rhaty - inducedE.y),
  };
}

// ──────────── Test probe ────────────
const probe = { x: OX + 300, y: OY + 150, dragging: false };

function probeField() {
  // No more zone-based fiat zeroing — report whatever the superposition
  // actually gives, everywhere. Drag the probe inside the wall/cavity to
  // see how far our heuristic charge distribution is from a true
  // Laplace-equation solution.
  const zone = classifyPoint(probe.x, probe.y);
  const E = computeField(probe.x, probe.y);
  return { mag: Math.hypot(E.Ex, E.Ey), zone };
}

// ──────────── Drawing: Mode A ────────────
function drawCavity() {
  ctx.clearRect(0, 0, CW, CH);

  // Background field lines (drawn before the conductor so they appear
  // to emerge from its surface).
  if (ui.showLinesA) drawCavityFieldLines();

  // Conductor body (outer filled, cavity cut out via even-odd).
  drawConductorPath();

  // Static + ion lattice first, so mobile electrons sit on top of their
  // "home" ions when unperturbed, and uncovered ions show on the depleted side.
  if (ui.showIonsA)      drawSurfaceIons();
  if (ui.showElectronsA) drawSurfaceCharges();

  // Test probe.
  if (ui.showProbeA) drawProbe();

  // Field direction indicator in a corner.
  drawFieldIndicator();
}

function drawConductorPath() {
  const N = 160;
  ctx.save();
  // Even-odd fill: outer path minus inner path gives the shell with
  // the cavity cut out.
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const p = outerPoint(t);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = innerR(t);
    const x = CAVITY_CENTER.x + r * Math.cos(t);
    const y = CAVITY_CENTER.y + r * Math.sin(t);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = COLOR.conductor;
  ctx.globalAlpha = 0.95;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = COLOR.conductorEdge;
  ctx.stroke();

  // Cavity face (subtle fill + label).
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = innerR(t);
    const x = CAVITY_CENTER.x + r * Math.cos(t);
    const y = CAVITY_CENTER.y + r * Math.sin(t);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = COLOR.cavity;
  ctx.fill();
  ctx.strokeStyle = 'rgba(46, 61, 80, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawSurfaceIons() {
  ctx.save();
  for (const ion of ions) {
    const p = outerPoint(ion.theta);
    const n = outerNormal(ion.theta);
    const px = p.x + n.x * 3;
    const py = p.y + n.y * 3;
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.positive;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', px, py - 0.5);
  }
  ctx.restore();
}

function drawSurfaceCharges() {
  // Mobile electrons only. Drawn on top of ions so a paired electron
  // visually covers its home ion (surface looks neutral there), and an
  // uncovered ion on the depleted side reads as "exposed + charge".
  ctx.save();
  for (const c of charges) {
    const p = outerPoint(c.theta);
    const n = outerNormal(c.theta);
    const px = p.x + n.x * 3;
    const py = p.y + n.y * 3;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.negative;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', px, py - 0.5);
  }
  ctx.restore();
}

// Field lines are true streamlines of the total field. At each step we
// query computeField(x,y) and move along the unit E vector. Seeds are
// placed upstream of the conductor (far off-canvas if necessary) and the
// trace walks forward until it exits the drawing area or terminates on
// the conductor surface. The induced charges are what bend the lines.
const STREAM_STEP   = 5;
const STREAM_MAX    = 360;   // enough steps to cross canvas + upstream gap
const STREAM_MARGIN = 700;   // off-canvas tolerance while tracing

function traceStreamline(x, y, direction) {
  // direction: +1 follows E, −1 walks against E. For direction = −1 the
  // returned point list is reversed so callers always get points in
  // downstream order (arrowhead logic stays agnostic).
  const points = [{ x, y }];
  let cx = x, cy = y;
  let enteredCanvas = false;
  for (let i = 0; i < STREAM_MAX; i++) {
    const E = computeField(cx, cy);
    const mag = Math.hypot(E.Ex, E.Ey);
    if (mag < 1e-6) break;
    const nx = (E.Ex / mag) * direction;
    const ny = (E.Ey / mag) * direction;
    const nextX = cx + nx * STREAM_STEP;
    const nextY = cy + ny * STREAM_STEP;

    const onCanvas =
      nextX >= -5 && nextX <= CW + 5 && nextY >= -5 && nextY <= CH + 5;
    if (onCanvas) enteredCanvas = true;

    // Stop conditions: left the visible region after entering it, or
    // walked too far off-canvas before reaching it.
    if (enteredCanvas && !onCanvas) {
      points.push({ x: nextX, y: nextY });
      break;
    }
    const farOff =
      nextX < -STREAM_MARGIN || nextX > CW + STREAM_MARGIN ||
      nextY < -STREAM_MARGIN || nextY > CH + STREAM_MARGIN;
    if (farOff) break;

    if (classifyPoint(nextX, nextY) !== 'outside') {
      // Bisect so the terminating point sits on the surface, not inside.
      let lo = 0, hi = 1;
      for (let b = 0; b < 6; b++) {
        const mid = (lo + hi) / 2;
        const mx = cx + nx * STREAM_STEP * mid;
        const my = cy + ny * STREAM_STEP * mid;
        if (classifyPoint(mx, my) === 'outside') lo = mid; else hi = mid;
      }
      points.push({
        x: cx + nx * STREAM_STEP * lo,
        y: cy + ny * STREAM_STEP * lo,
      });
      break;
    }
    cx = nextX; cy = nextY;
    points.push({ x: cx, y: cy });
  }
  if (direction < 0) points.reverse();
  return points;
}

function drawStreamline(points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  // Arrowhead at ~55% along the path.
  const idx = Math.max(1, Math.floor(points.length * 0.55));
  const p0 = points[idx - 1];
  const p1 = points[Math.min(idx, points.length - 1)];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy);
  if (L > 1e-3) drawArrowhead(p1.x, p1.y, dx / L, dy / L);
}

function drawCavityFieldLines() {
  if (cavityField.mag < 0.02) return;
  // Two seed planes perpendicular to the field, placed well upstream and
  // downstream of the conductor.
  //   • Upstream plane, traced forward along +E, catches lines that
  //     enter from outside — including those that terminate on the
  //     (− side) face of the conductor.
  //   • Downstream plane, traced backward along −E, catches lines that
  //     emerge from the (+ side) face and head away. Those lines have no
  //     upstream origin, so upstream-only seeding would miss them.
  // Through-going lines are captured twice (once by each plane) which
  // just means a harmless overdraw.
  //
  // Seeding is centred on the conductor (not the canvas centre) so the
  // lines are symmetric about the physics. The k range is derived from
  // the canvas corners projected onto the perpendicular axis — this way
  // we always cover the whole frame regardless of which direction the
  // field points.
  const dirX = Math.cos(cavityField.angle);
  const dirY = Math.sin(cavityField.angle);
  const perpX = -dirY, perpY = dirX;

  const spacing  = 34;
  const UPSTREAM = 500;

  // Perpendicular-axis extent of the canvas as seen from the conductor.
  let pMin = Infinity, pMax = -Infinity;
  for (const [cx, cy] of [[0, 0], [CW, 0], [0, CH], [CW, CH]]) {
    const p = (cx - CAVITY_CENTER.x) * perpX + (cy - CAVITY_CENTER.y) * perpY;
    if (p < pMin) pMin = p;
    if (p > pMax) pMax = p;
  }
  const kMin = Math.floor(pMin / spacing);
  const kMax = Math.ceil (pMax / spacing);

  ctx.save();
  ctx.strokeStyle = COLOR.field;
  ctx.lineWidth = 1.2;

  // Upstream seeds → trace forward.
  const upX = CAVITY_CENTER.x - dirX * UPSTREAM;
  const upY = CAVITY_CENTER.y - dirY * UPSTREAM;
  for (let k = kMin; k <= kMax; k++) {
    const seedX = upX + perpX * k * spacing;
    const seedY = upY + perpY * k * spacing;
    if (classifyPoint(seedX, seedY) !== 'outside') continue;
    drawStreamline(traceStreamline(seedX, seedY, +1));
  }

  // Downstream seeds → trace backward.
  const dnX = CAVITY_CENTER.x + dirX * UPSTREAM;
  const dnY = CAVITY_CENTER.y + dirY * UPSTREAM;
  for (let k = kMin; k <= kMax; k++) {
    const seedX = dnX + perpX * k * spacing;
    const seedY = dnY + perpY * k * spacing;
    if (classifyPoint(seedX, seedY) !== 'outside') continue;
    drawStreamline(traceStreamline(seedX, seedY, -1));
  }

  ctx.restore();
}

function drawArrowhead(x, y, dx, dy) {
  const sz = 6;
  const px = -dy, py = dx; // perpendicular
  ctx.beginPath();
  ctx.moveTo(x + dx * sz, y + dy * sz);
  ctx.lineTo(x - dx * sz * 0.2 + px * sz * 0.6, y - dy * sz * 0.2 + py * sz * 0.6);
  ctx.lineTo(x - dx * sz * 0.2 - px * sz * 0.6, y - dy * sz * 0.2 - py * sz * 0.6);
  ctx.closePath();
  ctx.fillStyle = COLOR.arrow;
  ctx.fill();
}

function drawProbe() {
  const info = probeField();
  ctx.save();
  // Dashed guide to show it's a measurement device.
  ctx.beginPath();
  ctx.arc(probe.x, probe.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(probe.x, probe.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.ink;
  ctx.fill();
  // Label
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = info.mag === 0 ? 'probe · |E|=0' : 'probe';
  ctx.fillText(label, probe.x, probe.y + 18);
  ctx.restore();
}

function drawFieldIndicator() {
  // Small compass-style arrow showing current field direction in the
  // top-right corner.
  const cx = CW - 56, cy = 56, R = 28;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(21,48,77,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  const dx = Math.cos(cavityField.angle);
  const dy = Math.sin(cavityField.angle);
  ctx.beginPath();
  ctx.moveTo(cx - dx * (R - 8), cy - dy * (R - 8));
  ctx.lineTo(cx + dx * (R - 12), cy + dy * (R - 12));
  ctx.strokeStyle = COLOR.ink;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  drawArrowhead(cx + dx * (R - 12), cy + dy * (R - 12), dx, dy);
  ctx.font = '10px "Trebuchet MS", sans-serif';
  ctx.fillStyle = COLOR.muted;
  ctx.textAlign = 'center';
  ctx.fillText('E', cx, cy + R + 12);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════
// ─────────────────────── MODE B — SHARP POINT ───────────────────────
// ════════════════════════════════════════════════════════════════════
//
// Straight wire of fixed arc-length that can be bent into an arc up to
// a semicircle. Charges live on arc parameter s ∈ [0, L], clamped at the
// endpoints (open curve, no wrap). Equilibrium is pure pair repulsion →
// uniform arc-length spacing. The teaching point is that bending the
// wire raises the field at the convex apex *without* any clustering of
// charge — just by folding the rest of the wire closer to that apex.

const POINT_APEX = { x: OX, y: OY - 120 };   // apex (s = L/2) always here

const pointMode = {
  L:         700,     // fixed arc length (px)
  N_MAX:     40,
  N:         10,      // slider-controlled count
  curvature: 0,       // 0..1 slider value
  charges:   [],      // {s, vel}, sorted ascending s
  outline:   [],      // cached polyline, uniformly spaced in arc length
};

const probeB = { x: OX + 200, y: OY - 200, dragging: false };

// Build and cache a polyline of the wire's shape, with M samples
// uniformly spaced in arc length. The slider maps onto two regimes:
//   t ∈ [0, 0.5]:  circular arc whose angle sweeps 0 → π as t rises.
//                  At t = 0.5 the shape is exactly a semicircle.
//   t ∈ [0.5, 1]:  half-ellipse (top half of an ellipse sitting below
//                  the apex), same total arc length L, with the
//                  semi-axis ratio α = b/a growing from 1 (semicircle)
//                  to αMax. Apex radius of curvature is a²/b = a/α, so
//                  stretching the ellipse taller sharpens the tip.
// Arc length of the half-ellipse uses Ramanujan's first approximation:
//   L = (π a / 2) · [3(1 + α) − √((3 + α)(1 + 3α))]
// which we invert for `a` given α and L.
function buildPointOutline() {
  const L = pointMode.L;
  const t = pointMode.curvature;
  const M = 200;
  const out = new Array(M);

  if (t < 1e-4) {
    for (let i = 0; i < M; i++) {
      const u = (i / (M - 1)) * L - L / 2;
      out[i] = {
        x: POINT_APEX.x + u, y: POINT_APEX.y,
        tx: 1, ty: 0, nx: 0, ny: -1,
      };
    }
  } else if (t <= 0.5) {
    const thetaTot = (t / 0.5) * Math.PI;
    const R = L / thetaTot;
    for (let i = 0; i < M; i++) {
      const u = (i / (M - 1)) * L - L / 2;
      const theta = u / R;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      out[i] = {
        x:  POINT_APEX.x + R * sinT,
        y:  POINT_APEX.y + R * (1 - cosT),
        tx: cosT, ty: sinT,
        nx: sinT, ny: -cosT,
      };
    }
  } else {
    const s2 = (t - 0.5) / 0.5;          // 0..1
    const alphaMax = 5.0;
    const alpha = 1 + s2 * (alphaMax - 1);
    const factor = 3 * (1 + alpha) - Math.sqrt((3 + alpha) * (1 + 3 * alpha));
    const a = (2 * L) / (Math.PI * factor);
    const b = alpha * a;

    // Build a dense φ→arclength table so we can resample uniformly in s.
    const K = 1200;
    const lens = new Array(K + 1);
    lens[0] = 0;
    for (let i = 1; i <= K; i++) {
      const phiMid = ((i - 0.5) / K) * Math.PI;
      const ds = Math.hypot(a * Math.sin(phiMid), b * Math.cos(phiMid))
                 * (Math.PI / K);
      lens[i] = lens[i - 1] + ds;
    }
    const total = lens[K];
    let j = 0;
    for (let i = 0; i < M; i++) {
      const sE = (i / (M - 1)) * total;
      while (j < K && lens[j + 1] < sE) j++;
      const span = Math.max(1e-9, lens[j + 1] - lens[j]);
      const f = (sE - lens[j]) / span;
      const phi = ((j + f) / K) * Math.PI;
      // Ellipse parameterisation: φ=0 → left end, φ=π/2 → apex, φ=π → right end.
      const x = POINT_APEX.x - a * Math.cos(phi);
      const y = POINT_APEX.y + b * (1 - Math.sin(phi));
      // Tangent ∝ d/dφ of the above = (a sin φ, −b cos φ).
      const txR =  a * Math.sin(phi);
      const tyR = -b * Math.cos(phi);
      const Lm  = Math.hypot(txR, tyR);
      const tx = txR / Lm, ty = tyR / Lm;
      out[i] = { x, y, tx, ty, nx: ty, ny: -tx };
    }
  }

  pointMode.outline = out;
}

function pointArcPoint(s) {
  const out = pointMode.outline;
  if (out.length === 0) {
    return { x: POINT_APEX.x, y: POINT_APEX.y,
             tx: 1, ty: 0, nx: 0, ny: -1 };
  }
  const L = pointMode.L;
  const sc = Math.max(0, Math.min(L, s));
  const f = (sc / L) * (out.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(out.length - 1, i0 + 1);
  const frac = f - i0;
  const p0 = out[i0], p1 = out[i1];
  return {
    x:  p0.x + (p1.x - p0.x) * frac,
    y:  p0.y + (p1.y - p0.y) * frac,
    tx: p0.tx, ty: p0.ty,
    nx: p0.nx, ny: p0.ny,
  };
}

function setPointChargeCount(n) {
  n = Math.max(0, Math.min(pointMode.N_MAX, Math.round(n)));
  const arr = pointMode.charges;
  const L = pointMode.L;
  // Arc-length spacing used for both cold-start packing and interactive
  // inserts. Slightly larger than twice the draw radius so charges start
  // visibly touching without sitting exactly on top of each other (a
  // co-located pair has dx = dy = 0, so the tangential force vanishes
  // and they'd never separate).
  const PACK = 5;
  if (arr.length === 0 && n > 0) {
    // Cold start: stack all charges at the left end, nearly touching.
    // Repulsion then unfurls them along the wire over the next ~1 s.
    for (let i = 0; i < n; i++) {
      arr.push({ s: i * PACK, vel: 0 });
    }
  } else {
    // Interactive add: slip each new charge in at the very left, keeping
    // the existing leftmost-most one just to its right.
    while (arr.length < n) {
      // Shove anything sitting within PACK of the left end outward.
      for (const c of arr) {
        if (c.s < PACK) c.s = Math.min(L, c.s + PACK);
      }
      arr.unshift({ s: 0, vel: 0 });
    }
    while (arr.length > n) arr.shift();
  }
  pointMode.N = n;
}

function updatePointCharges(dt) {
  const arr = pointMode.charges;
  const N = arr.length;
  if (N === 0) return;
  const L = pointMode.L;

  const pos = new Array(N);
  for (let i = 0; i < N; i++) pos[i] = pointArcPoint(arr[i].s);

  const Q_REP   = 800000;
  const SOFT2   = 40;
  const DAMP    = 4;
  const VEL_CAP = 1500;   // arc-length px / sec
  const damp    = Math.exp(-DAMP * dt);

  for (let i = 0; i < N; i++) {
    const pi = pos[i];
    let fTan = 0;
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const pj = pos[j];
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const r2 = dx * dx + dy * dy + SOFT2;
      const invR3 = 1 / (r2 * Math.sqrt(r2));
      fTan += (dx * pi.tx + dy * pi.ty) * Q_REP * invR3;
    }
    const c = arr[i];
    c.vel = (c.vel + fTan * dt) * damp;
    if (c.vel >  VEL_CAP) c.vel =  VEL_CAP;
    if (c.vel < -VEL_CAP) c.vel = -VEL_CAP;
    c.s += c.vel * dt;
    // Clamp at endpoints; any velocity into the wall is dropped so the
    // charge parks cleanly instead of jittering.
    if (c.s < 0) { c.s = 0;    if (c.vel < 0) c.vel = 0; }
    if (c.s > L) { c.s = L;    if (c.vel > 0) c.vel = 0; }
  }
}

function computeFieldB(x, y) {
  const arr = pointMode.charges;
  if (!arr.length) return { Ex: 0, Ey: 0, mag: 0 };
  // Share the Mode B scale: each charge carries q = 1/N_MAX so adding
  // charges proportionally raises total Q, without per-charge strength
  // depending on N.
  const qEach = 1 / pointMode.N_MAX;
  const K = 2.5e4;
  let Ex = 0, Ey = 0;
  for (const c of arr) {
    const p = pointArcPoint(c.s);
    const dx = x - p.x;
    const dy = y - p.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 4) continue;
    const invR3 = 1 / (r2 * Math.sqrt(r2));
    Ex += K * qEach * dx * invR3;
    Ey += K * qEach * dy * invR3;
  }
  return { Ex, Ey, mag: Math.hypot(Ex, Ey) };
}

function pointApexE() {
  // Sample 5 px above the apex (outward normal at s = L/2 is (0, -1)).
  const E = computeFieldB(POINT_APEX.x, POINT_APEX.y - 5);
  return E.mag;
}

// ──────────── Drawing: Mode C ────────────
function drawPointMode() {
  ctx.clearRect(0, 0, CW, CH);
  drawWireBody();
  if (ui.showLinesB) drawPointFieldStubs();
  drawPointCharges();
  if (ui.showProbeB) drawProbeB();
  drawPointLabels();
}

function drawWireBody() {
  const out = pointMode.outline;
  if (out.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(out[0].x, out[0].y);
  for (let i = 1; i < out.length; i++) ctx.lineTo(out[i].x, out[i].y);
  ctx.lineWidth = 10;
  ctx.strokeStyle = COLOR.conductor;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = COLOR.conductorEdge;
  ctx.stroke();
  ctx.restore();
}

function drawPointCharges() {
  ctx.save();
  for (const c of pointMode.charges) {
    const p = pointArcPoint(c.s);
    const x = p.x + p.nx * 7;
    const y = p.y + p.ny * 7;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.positive;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPointFieldStubs() {
  const STUB_LEN = 40;
  ctx.save();
  ctx.strokeStyle = COLOR.field;
  ctx.lineWidth = 1.2;
  for (const c of pointMode.charges) {
    const p = pointArcPoint(c.s);
    const x1 = p.x + p.nx * 7;
    const y1 = p.y + p.ny * 7;
    const x2 = x1 + p.nx * STUB_LEN;
    const y2 = y1 + p.ny * STUB_LEN;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    drawArrowhead(x2, y2, p.nx, p.ny);
  }
  ctx.restore();
}

function drawProbeB() {
  ctx.save();
  ctx.beginPath();
  ctx.arc(probeB.x, probeB.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(probeB.x, probeB.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.ink;
  ctx.fill();
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('probe', probeB.x, probeB.y + 18);
  ctx.restore();
}

function drawPointLabels() {
  ctx.save();
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.fillStyle = COLOR.muted;
  ctx.textAlign = 'center';
  ctx.fillText('apex', POINT_APEX.x, POINT_APEX.y - 18);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════
// ─────────────────────────── UI & LOOP ──────────────────────────────
// ════════════════════════════════════════════════════════════════════

const ui = {
  mode:           'cavity',
  showLinesA:     true,
  showElectronsA: true,
  showIonsA:      true,
  showProbeA:     true,
  showLinesB:     true,
  showProbeB:     true,
};

// ── Mode switch
const btnModeCavity = document.getElementById('btn-mode-cavity');
const btnModePoint  = document.getElementById('btn-mode-point');
const panelCavity   = document.getElementById('controls-cavity');
const panelPoint    = document.getElementById('controls-point');

function setMode(m) {
  ui.mode = m;
  btnModeCavity.classList.toggle('active', m === 'cavity');
  btnModePoint.classList.toggle('active',  m === 'point');
  btnModeCavity.setAttribute('aria-pressed', m === 'cavity');
  btnModePoint.setAttribute('aria-pressed',  m === 'point');
  panelCavity.classList.toggle('hidden', m !== 'cavity');
  panelPoint.classList.toggle('hidden',  m !== 'point');
}
btnModeCavity.addEventListener('click', () => setMode('cavity'));
btnModePoint.addEventListener('click',  () => setMode('point'));

// ── Mode A controls
const fieldStrength  = document.getElementById('field-strength');
const fieldStrengthV = document.getElementById('field-strength-val');
const fieldAngle     = document.getElementById('field-angle');
const fieldAngleV    = document.getElementById('field-angle-val');

fieldStrength.addEventListener('input', () => {
  cavityField.mag = Number(fieldStrength.value) / 100;
  fieldStrengthV.value = fieldStrength.value;
});
fieldStrengthV.addEventListener('change', () => {
  const raw = parseFloat(fieldStrengthV.value);
  if (isNaN(raw)) { fieldStrengthV.value = fieldStrength.value; return; }
  const v = Math.max(0, Math.min(100, Math.round(raw)));
  fieldStrengthV.value = v;
  fieldStrength.value = v;
  cavityField.mag = v / 100;
});
fieldAngle.addEventListener('input', () => {
  cavityField.angle = (Number(fieldAngle.value) * Math.PI) / 180;
  fieldAngleV.value = fieldAngle.value;
});
fieldAngleV.addEventListener('change', () => {
  const raw = parseFloat(fieldAngleV.value);
  if (isNaN(raw)) { fieldAngleV.value = fieldAngle.value; return; }
  const v = Math.max(0, Math.min(359, Math.round(raw)));
  fieldAngleV.value = v;
  fieldAngle.value = v;
  cavityField.angle = (v * Math.PI) / 180;
});
document.querySelectorAll('.dir-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const a = Number(btn.dataset.angle);
    fieldAngle.value = a;
    fieldAngle.dispatchEvent(new Event('input'));
  });
});

document.getElementById('show-lines').addEventListener('change', (e) => {
  ui.showLinesA = e.target.checked;
});
document.getElementById('show-electrons').addEventListener('change', (e) => {
  ui.showElectronsA = e.target.checked;
});
document.getElementById('show-ions').addEventListener('change', (e) => {
  ui.showIonsA = e.target.checked;
});
document.getElementById('show-probe').addEventListener('change', (e) => {
  ui.showProbeA = e.target.checked;
});

// ── Mode B controls
const pointCount      = document.getElementById('point-count');
const pointCountV     = document.getElementById('point-count-val');
const pointCurvature  = document.getElementById('point-curvature');
const pointCurvatureV = document.getElementById('point-curvature-val');

pointCount.addEventListener('input', () => {
  pointCountV.value = pointCount.value;
  setPointChargeCount(Number(pointCount.value));
});
pointCountV.addEventListener('change', () => {
  const raw = parseFloat(pointCountV.value);
  if (isNaN(raw)) { pointCountV.value = pointCount.value; return; }
  const v = Math.max(0, Math.min(40, Math.round(raw)));
  pointCountV.value = v;
  pointCount.value = v;
  setPointChargeCount(v);
});
pointCurvature.addEventListener('input', () => {
  pointMode.curvature = Number(pointCurvature.value) / 100;
  pointCurvatureV.value = pointCurvature.value;
  buildPointOutline();
});
pointCurvatureV.addEventListener('change', () => {
  const raw = parseFloat(pointCurvatureV.value);
  if (isNaN(raw)) { pointCurvatureV.value = pointCurvature.value; return; }
  const v = Math.max(0, Math.min(100, Math.round(raw)));
  pointCurvatureV.value = v;
  pointCurvature.value = v;
  pointMode.curvature = v / 100;
  buildPointOutline();
});
document.getElementById('show-lines-2').addEventListener('change', (e) => {
  ui.showLinesB = e.target.checked;
});
document.getElementById('show-probe-2').addEventListener('change', (e) => {
  ui.showProbeB = e.target.checked;
});
// Build outline + seed the initial charges.
buildPointOutline();
setPointChargeCount(Number(pointCount.value));

// ── Probe drag (only relevant in cavity mode)
function canvasCoords(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top)  * scaleY,
  };
}
function probeHit(p) {
  return Math.hypot(p.x - probe.x, p.y - probe.y) < 20;
}
function probeBHit(p) {
  return Math.hypot(p.x - probeB.x, p.y - probeB.y) < 20;
}
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasCoords(e);
  if (ui.mode === 'cavity' && ui.showProbeA && probeHit(p)) {
    probe.dragging = true;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  } else if (ui.mode === 'point' && ui.showProbeB && probeBHit(p)) {
    probeB.dragging = true;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = canvasCoords(e);
  if (probe.dragging) {
    probe.x = Math.max(10, Math.min(CW - 10, p.x));
    probe.y = Math.max(10, Math.min(CH - 10, p.y));
  } else if (probeB.dragging) {
    probeB.x = Math.max(10, Math.min(CW - 10, p.x));
    probeB.y = Math.max(10, Math.min(CH - 10, p.y));
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (!probe.dragging && !probeB.dragging) return;
  probe.dragging = false;
  probeB.dragging = false;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});

// ── Readouts
const probeReadout  = document.getElementById('probe-readout');
const probeZone     = document.getElementById('probe-zone');
const apexReadout   = document.getElementById('apex-readout');
const probeReadoutB = document.getElementById('probe-readout-2');

function updateReadouts() {
  if (ui.mode === 'cavity') {
    const info = probeField();
    // Display mag in arbitrary units "kV/m". Map 1.0 slider → 500 kV/m.
    const kvm = info.mag * 500;
    probeReadout.textContent = `${kvm.toFixed(0)} kV/m`;
    probeZone.textContent =
      info.zone === 'outside' ? 'outside the conductor'
      : info.zone === 'wall'  ? 'inside the conductor wall'
      : 'inside the cavity';
  } else {
    apexReadout.textContent   = `${pointApexE().toFixed(2)} MV/m`;
    const Eb = computeFieldB(probeB.x, probeB.y);
    probeReadoutB.textContent = `${Eb.mag.toFixed(2)} MV/m`;
  }
}

// ── Main loop
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (ui.mode === 'cavity') {
    updateInducedE(dt);
    updateCharges(dt);
    drawCavity();
  } else {
    updatePointCharges(dt);
    drawPointMode();
  }
  updateReadouts();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
