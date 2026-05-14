// ─── Magnetic field visualiser: bar magnet & solenoid ────────────────────────

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const CY = H / 2;

// Field-line tracing parameters
const LINE_STEP = 4;
const LINE_MAX_STEPS = 1400;
const ARROW_GRID_SPACING = 36;
const ARROW_MIN_LEN = 5;
const ARROW_MAX_LEN = 18;

// Visual constants
const NORTH_COLOUR = '#dc2626';
const SOUTH_COLOUR = '#2563eb';
const LINE_COLOUR = 'rgba(21, 48, 77, 0.65)';
const INTERIOR_COLOUR = 'rgba(13, 148, 136, 0.85)';

const state = {
  mode: 'bar',                  // 'bar' | 'solenoid'
  display: 'lines',             // 'lines' | 'arrows' | 'both'

  // Bar magnet
  bar: {
    poleStrength: 6,
    length: 220,
    width: 70,
    polarity: 'ns',             // 'ns' = N left, 'sn' = S left
    showInterior: true,
  },

  // Solenoid
  sol: {
    current: 3.0,
    turns: 12,
    length: 280,
    radius: 60,
    direction: 'left',          // 'left' = N on left (matches bar magnet default); 'right' = N on right
    showInterior: true,
  },
};

// ─── Field models ─────────────────────────────────────────────────────────────

// Bar magnet: Amperian model. A permanent magnet is equivalent to a stack of
// microscopic current loops; this gives the correct closed-loop B field
// (uniform interior, dipole exterior) using the same wire-pair math as the
// solenoid.
function barField(px, py) {
  const { length, width, poleStrength, polarity } = state.bar;
  const turns = 14;
  const half = length / 2;
  const radius = width / 2;
  // For N on left, B inside points -x. By right-hand rule (with screen y-down,
  // current out of page = +z), top wire current must be out of page (+1).
  const topSign = polarity === 'ns' ? +1 : -1;
  const botSign = -topSign;

  let bx = 0, by = 0;
  const start = CX - half;
  const span = (turns > 1) ? length / (turns - 1) : 0;
  const I = poleStrength;

  for (let i = 0; i < turns; i++) {
    const wx = start + i * span;
    addWireField(px, py, wx, CY - radius, topSign * I, (out) => { bx += out.bx; by += out.by; });
    addWireField(px, py, wx, CY + radius, botSign * I, (out) => { bx += out.bx; by += out.by; });
  }
  return { bx, by };
}

// Solenoid: model as N current loops along the x-axis. In a 2D side-view
// (slice through the axis), each loop appears as two infinite wires —
// one cross-section above the axis, one below — with opposite current
// directions. Each wire contributes B = (μ₀ I / 2π r) tangent to the
// circle around it; sign chosen by the right-hand rule.
function solenoidField(px, py) {
  const { current, turns, length, radius, direction } = state.sol;
  // For "N left": top wire current OUT of page (+1), bottom INTO (-1) →
  // B inside points -x (toward N on the left). For "N right": flipped.
  const topSign = direction === 'left' ? +1 : -1;
  const botSign = -topSign;

  const half = length / 2;
  let bx = 0, by = 0;

  // Place loops evenly along the axis
  const start = CX - half;
  const span = (turns > 1) ? length / (turns - 1) : 0;

  for (let i = 0; i < turns; i++) {
    const wx = (turns === 1) ? CX : start + i * span;
    // Top wire (above axis): at (wx, CY - radius), sign = topSign
    addWireField(px, py, wx, CY - radius, topSign * current, (out) => {
      bx += out.bx; by += out.by;
    });
    // Bottom wire (below axis)
    addWireField(px, py, wx, CY + radius, botSign * current, (out) => {
      bx += out.bx; by += out.by;
    });
  }
  return { bx, by };
}

// Field of an infinite wire perpendicular to the page at (wx, wy)
// carrying current `i` (positive = out of page). B circulates
// counter-clockwise (right-hand rule).
function addWireField(px, py, wx, wy, i, accum) {
  const dx = px - wx;
  const dy = py - wy;
  const r2 = dx * dx + dy * dy;
  if (r2 < 9) { accum({ bx: 0, by: 0 }); return; }
  // For current out of page (+z), B = (k * i / r²) * (-dy, dx)
  const s = i / r2;
  accum({ bx: -s * dy, by: s * dx });
}

function getField(px, py) {
  return state.mode === 'bar' ? barField(px, py) : solenoidField(px, py);
}

function fieldUnit(px, py) {
  const { bx, by } = getField(px, py);
  const m = Math.hypot(bx, by);
  if (m === 0) return { ux: 0, uy: 0, mag: 0 };
  return { ux: bx / m, uy: by / m, mag: m };
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function isInsideMagnet(x, y) {
  const { length, width } = state.bar;
  return Math.abs(x - CX) <= length / 2 && Math.abs(y - CY) <= width / 2;
}

function isInsideSolenoidCore(x, y) {
  const { length, radius } = state.sol;
  return Math.abs(x - CX) <= length / 2 && Math.abs(y - CY) <= radius;
}

// ─── Field-line tracing ───────────────────────────────────────────────────────

function traceLine(startX, startY, sign, stopFn) {
  const points = [{ x: startX, y: startY }];
  let x = startX, y = startY;
  for (let s = 0; s < LINE_MAX_STEPS; s++) {
    const k1 = fieldUnit(x, y);
    if (k1.mag === 0) break;
    const hx = LINE_STEP / 2;
    const k2 = fieldUnit(x + sign * hx * k1.ux, y + sign * hx * k1.uy);
    const k3 = fieldUnit(x + sign * hx * k2.ux, y + sign * hx * k2.uy);
    const k4 = fieldUnit(x + sign * LINE_STEP * k3.ux, y + sign * LINE_STEP * k3.uy);
    x += sign * (LINE_STEP / 6) * (k1.ux + 2 * k2.ux + 2 * k3.ux + k4.ux);
    y += sign * (LINE_STEP / 6) * (k1.uy + 2 * k2.uy + 2 * k3.uy + k4.uy);
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) break;
    if (stopFn && stopFn(x, y)) break;
    points.push({ x, y });
  }
  return points;
}

// Trace a HALF loop, starting from a seed on the source's centre line
// (x = CX) at y = seedY. Stops when the trace crosses x = CX again going
// in the +x direction (the loop's apex on the opposite side from the seed).
// Mirroring this half about x = CX yields a perfectly symmetric closed loop.
// `isInsideSource` flags points inside the source body (magnet body or
// solenoid core); the apex check only fires once the trace has left it.
function traceHalfLoop(seedY, isInsideSource) {
  const points = [{ x: CX, y: seedY }];
  let x = CX, y = seedY;
  let prevX = CX;
  let leftSource = false;

  for (let s = 0; s < LINE_MAX_STEPS; s++) {
    const k1 = fieldUnit(x, y);
    if (k1.mag === 0) break;
    const hx = LINE_STEP / 2;
    const k2 = fieldUnit(x + hx * k1.ux, y + hx * k1.uy);
    const k3 = fieldUnit(x + hx * k2.ux, y + hx * k2.uy);
    const k4 = fieldUnit(x + LINE_STEP * k3.ux, y + LINE_STEP * k3.uy);
    x += (LINE_STEP / 6) * (k1.ux + 2 * k2.ux + 2 * k3.ux + k4.ux);
    y += (LINE_STEP / 6) * (k1.uy + 2 * k2.uy + 2 * k3.uy + k4.uy);
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) break;

    if (!leftSource && !isInsideSource(x, y)) leftSource = true;

    // Apex = first crossing of x = CX after leaving the source body. Detected
    // by sign change of (x − CX), so it works whether the trace heads −x
    // first (N on left) or +x first (N on right).
    const prevSign = Math.sign(prevX - CX);
    const curSign = Math.sign(x - CX);
    if (leftSource && prevSign !== 0 && curSign !== 0 && curSign !== prevSign) {
      const t = (CX - prevX) / (x - prevX);
      const apexY = points[points.length - 1].y + t * (y - points[points.length - 1].y);
      points.push({ x: CX, y: apexY });
      break;
    }
    points.push({ x, y });
    prevX = x;
  }
  return points;
}

// Build a closed loop by mirroring a half-loop about the line x = CX.
// The half starts on x = CX (seed) and ends on x = CX (apex); the mirror
// covers the other side.
function mirrorAboutCX(half) {
  if (half.length < 2) return half;
  const out = half.slice();
  // Iterate the half in reverse, skipping both endpoints (they're already on x = CX)
  for (let i = half.length - 2; i >= 1; i--) {
    out.push({ x: 2 * CX - half[i].x, y: half[i].y });
  }
  // Close the loop back to the seed
  out.push({ x: half[0].x, y: half[0].y });
  return out;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.06)';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = step; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = step; y < H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

function strokePolyline(points, colour, width = 1.5) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawArrowheadOnLine(points, fraction, colour) {
  const idx = Math.max(1, Math.min(points.length - 1, Math.floor(points.length * fraction)));
  const prev = points[idx - 1];
  const curr = points[idx];
  const angle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
  const size = 11;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(curr.x, curr.y);
  ctx.lineTo(curr.x - size * Math.cos(angle - 0.42), curr.y - size * Math.sin(angle - 0.42));
  ctx.lineTo(curr.x - size * Math.cos(angle + 0.42), curr.y - size * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawArrowAt(x, y, ux, uy, length, colour, alpha = 1) {
  const x1 = x - ux * length * 0.35;
  const y1 = y - uy * length * 0.35;
  const x2 = x + ux * length * 0.65;
  const y2 = y + uy * length * 0.65;
  const head = 4.5;
  const angle = Math.atan2(uy, ux);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Map normalised magnitude to a colour from blue → teal → yellow → red.
function magColour(norm) {
  const stops = [
    [68, 136, 255],
    [0, 204, 170],
    [255, 204, 0],
    [255, 51, 0],
  ];
  const t = Math.max(0, Math.min(1, norm)) * (stops.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = stops[Math.min(i, stops.length - 1)];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  return `rgb(${Math.round(a[0] + f*(b[0]-a[0]))},${Math.round(a[1] + f*(b[1]-a[1]))},${Math.round(a[2] + f*(b[2]-a[2]))})`;
}

function drawArrowGrid() {
  // Sample magnitudes on the grid first to normalise
  const samples = [];
  let maxMag = 0;
  for (let y = ARROW_GRID_SPACING / 2; y < H; y += ARROW_GRID_SPACING) {
    for (let x = ARROW_GRID_SPACING / 2; x < W; x += ARROW_GRID_SPACING) {
      // Skip points inside the source object
      if (state.mode === 'bar' && isInsideMagnet(x, y) && !state.bar.showInterior) continue;
      if (state.mode === 'solenoid' && isInsideSolenoidCore(x, y) && !state.sol.showInterior) continue;
      const f = fieldUnit(x, y);
      if (f.mag === 0) continue;
      samples.push({ x, y, ux: f.ux, uy: f.uy, mag: f.mag });
      if (f.mag > maxMag) maxMag = f.mag;
    }
  }
  // Use a log scale: dynamic range is huge near sources
  const norm = (m) => {
    if (maxMag <= 0) return 0;
    const lm = Math.log(1 + m);
    const lmax = Math.log(1 + maxMag);
    return lm / lmax;
  };
  for (const s of samples) {
    const n = norm(s.mag);
    const length = ARROW_MIN_LEN + n * (ARROW_MAX_LEN - ARROW_MIN_LEN);
    drawArrowAt(s.x, s.y, s.ux, s.uy, length, magColour(n), 0.55 + n * 0.45);
  }
}

// ─── Bar-magnet rendering ─────────────────────────────────────────────────────

function drawBarMagnet() {
  const { length, width, polarity } = state.bar;
  const half = length / 2;
  const halfW = width / 2;
  const x0 = CX - half;
  const y0 = CY - halfW;

  ctx.save();
  // Two halves
  const leftIsN = polarity === 'ns';
  ctx.fillStyle = leftIsN ? NORTH_COLOUR : SOUTH_COLOUR;
  ctx.fillRect(x0, y0, length / 2, width);
  ctx.fillStyle = leftIsN ? SOUTH_COLOUR : NORTH_COLOUR;
  ctx.fillRect(CX, y0, length / 2, width);

  // Outline
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0, y0, length, width);

  // Pole labels
  ctx.fillStyle = 'white';
  ctx.font = '700 26px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(leftIsN ? 'N' : 'S', x0 + length / 4, CY);
  ctx.fillText(leftIsN ? 'S' : 'N', CX + length / 4, CY);

  ctx.restore();
}

// Walk the path and split it into alternating interior/exterior runs.
function segmentByInside(pts, isInsideSource) {
  const segs = [];
  if (pts.length < 2) return segs;
  let segStart = 0;
  let segInside = isInsideSource(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const inside = isInsideSource(pts[i].x, pts[i].y);
    if (inside !== segInside) {
      segs.push({ inside: segInside, start: segStart, end: i });
      segStart = i;
      segInside = inside;
    }
  }
  segs.push({ inside: segInside, start: segStart, end: pts.length - 1 });
  return segs;
}

// Generic closed/open field-line drawing for both bar magnet and solenoid.
// Mirrors each seed's half-loop about x = CX for guaranteed left-right
// symmetry, then places arrowheads at consistent positions:
//   exterior arrow at the apex (midpoint of longest exterior run, on x = CX)
//   interior arrow at the seed (so all interior arrows line up vertically)
function drawSymmetricLines(seedYs, isInsideSource, showInterior) {
  for (const sy of seedYs) {
    const half = traceHalfLoop(sy, isInsideSource);
    if (half.length < 6) continue;
    const last = half[half.length - 1];
    const reachedApex = Math.abs(last.x - CX) < 1;

    let pts;
    let seedIdx;
    if (reachedApex) {
      pts = mirrorAboutCX(half);
      seedIdx = 0;
    } else {
      // Trace exited canvas before reaching apex. Build one continuous,
      // symmetric open path by prepending the reflected reversed half:
      //   reflected_canvas_edge → … → seed → … → canvas_edge.
      const mirror = half.slice().reverse().map((p) => ({ x: 2 * CX - p.x, y: p.y }));
      pts = mirror.concat(half.slice(1));
      seedIdx = mirror.length - 1;
    }

    // Stroke each interior/exterior segment.
    const segs = segmentByInside(pts, isInsideSource);
    for (const seg of segs) {
      if (seg.end - seg.start < 1) continue;
      const slice = pts.slice(seg.start, seg.end + 1);
      if (seg.inside) {
        if (showInterior) strokePolyline(slice, INTERIOR_COLOUR, 1.8);
      } else {
        strokePolyline(slice, LINE_COLOUR, 1.6);
      }
    }

    // Exterior arrow at midpoint of longest exterior run (apex on x = CX).
    const longestExt = segs
      .filter((s) => !s.inside)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    if (longestExt && longestExt.end - longestExt.start > 6) {
      const mid = Math.floor((longestExt.start + longestExt.end) / 2);
      drawArrowheadOnLine(pts.slice(mid - 2, mid + 2), 1.0, LINE_COLOUR);
    }

    // Interior arrow at the seed: same x for every loop, varying y. The
    // direction comes from seed → next-trace-point, which is forward B.
    if (showInterior && seedIdx + 1 < pts.length) {
      drawArrowheadOnLine(pts.slice(seedIdx, seedIdx + 2), 1.0, INTERIOR_COLOUR);
    }
  }
}

function drawBarLines() {
  const { width, poleStrength, showInterior } = state.bar;
  const numLines = Math.round(6 + poleStrength * 2);
  const halfH = width / 2 - 6;
  const seedYs = [];
  for (let i = 0; i < numLines; i++) {
    const t = (i + 0.5) / numLines;
    const sy = CY - halfH + t * 2 * halfH;
    if (Math.abs(sy - CY) < 2) continue;
    seedYs.push(sy);
  }
  drawSymmetricLines(seedYs, isInsideMagnet, showInterior);
}

// ─── Solenoid rendering ───────────────────────────────────────────────────────

function drawSolenoid() {
  const { length, turns, radius, direction } = state.sol;
  const half = length / 2;
  const start = CX - half;
  const span = (turns > 1) ? length / (turns - 1) : 0;

  ctx.save();

  // Coil body outline (faint)
  ctx.fillStyle = 'rgba(21, 48, 77, 0.04)';
  ctx.fillRect(start, CY - radius, length, 2 * radius);

  // Each turn: top wire and bottom wire as circles with current symbol
  // For "N left", top wire current is OUT of page (•), bottom INTO (×).
  // For "N right", flipped.
  const topIntoPage = direction === 'right';

  ctx.font = '700 14px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < turns; i++) {
    const wx = (turns === 1) ? CX : start + i * span;

    // Top wire
    drawWireSymbol(wx, CY - radius, topIntoPage);
    // Bottom wire
    drawWireSymbol(wx, CY + radius, !topIntoPage);
  }

  // Endpoint labels: which end is N?
  const nRight = direction === 'right';
  ctx.fillStyle = NORTH_COLOUR;
  ctx.font = '700 16px "Trebuchet MS", sans-serif';
  ctx.fillText('N', nRight ? CX + half + 22 : CX - half - 22, CY);
  ctx.fillStyle = SOUTH_COLOUR;
  ctx.fillText('S', nRight ? CX - half - 22 : CX + half + 22, CY);

  ctx.restore();
}

function drawWireSymbol(x, y, intoPage) {
  ctx.save();
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1.6;
  if (intoPage) {
    // ×
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  } else {
    // •
    ctx.fillStyle = '#15304d';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

function drawSolenoidFieldLines() {
  const { current, turns, radius, showInterior } = state.sol;
  // Line density ∝ NI (solenoid field strength). Capped so the canvas
  // doesn't get crowded at the slider extremes.
  const numLines = Math.min(30, Math.max(8, Math.round(4 + current * turns / 6)));
  const halfH = radius - 6;
  const seedYs = [];
  for (let i = 0; i < numLines; i++) {
    const t = (i + 0.5) / numLines;
    const sy = CY - halfH + t * 2 * halfH;
    if (Math.abs(sy - CY) < 2) continue;
    seedYs.push(sy);
  }
  drawSymmetricLines(seedYs, isInsideSolenoidCore, showInterior);
}

// ─── Master draw ──────────────────────────────────────────────────────────────

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawGrid();

  if (state.display === 'arrows' || state.display === 'both') {
    drawArrowGrid();
  }
  const showLines = state.display === 'lines' || state.display === 'both';

  if (state.mode === 'bar') {
    drawBarMagnet();
    if (showLines) drawBarLines();
  } else {
    if (showLines) drawSolenoidFieldLines();
    drawSolenoid();
  }
}

// ─── UI wiring ────────────────────────────────────────────────────────────────

function setMode(mode) {
  state.mode = mode;
  document.getElementById('btn-mode-bar').classList.toggle('active', mode === 'bar');
  document.getElementById('btn-mode-bar').setAttribute('aria-pressed', mode === 'bar');
  document.getElementById('btn-mode-solenoid').classList.toggle('active', mode === 'solenoid');
  document.getElementById('btn-mode-solenoid').setAttribute('aria-pressed', mode === 'solenoid');
  document.getElementById('bar-controls').classList.toggle('is-hidden', mode !== 'bar');
  document.getElementById('solenoid-controls').classList.toggle('is-hidden', mode !== 'solenoid');
  document.getElementById('readout-bar').classList.toggle('is-hidden', mode !== 'bar');
  document.getElementById('readout-sol').classList.toggle('is-hidden', mode !== 'solenoid');
  draw();
}

function setSegActive(groupId, value) {
  const buttons = document.querySelectorAll(`#${groupId} .seg-btn`);
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.val === value));
}

function bindSeg(groupId, handler) {
  document.querySelectorAll(`#${groupId} .seg-btn`).forEach((btn) => {
    btn.addEventListener('click', () => {
      setSegActive(groupId, btn.dataset.val);
      handler(btn.dataset.val);
    });
  });
}

function bindSlider(id, valId, transform, handler) {
  const slider = document.getElementById(id);
  const out = document.getElementById(valId);
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step) || 1;
  const update = () => {
    out.value = transform(parseFloat(slider.value));
    handler(parseFloat(slider.value));
  };
  slider.addEventListener('input', update);
  out.addEventListener('change', () => {
    const raw = parseFloat(out.value);
    if (isNaN(raw)) { out.value = transform(parseFloat(slider.value)); return; }
    const snapped = Math.round((raw - min) / step) * step + min;
    const v = Math.max(min, Math.min(max, snapped));
    slider.value = v;
    out.value = transform(v);
    handler(v);
  });
  update();
}

function bindToggle(id, getCurrent, setCurrent) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    setCurrent(!getCurrent());
    btn.classList.toggle('active', getCurrent());
    draw();
  });
}

document.getElementById('btn-mode-bar').addEventListener('click', () => setMode('bar'));
document.getElementById('btn-mode-solenoid').addEventListener('click', () => setMode('solenoid'));

bindSeg('seg-display', (v) => { state.display = v; draw(); });
bindSeg('seg-polarity', (v) => { state.bar.polarity = v; draw(); });
bindSeg('seg-current-dir', (v) => { state.sol.direction = v; draw(); });

bindSlider('slider-pole', 'val-pole', (v) => v.toFixed(0), (v) => { state.bar.poleStrength = v; draw(); });
bindSlider('slider-mlen', 'val-mlen', (v) => v.toFixed(0), (v) => { state.bar.length = v; draw(); });
bindSlider('slider-current', 'val-current', (v) => v.toFixed(1), (v) => { state.sol.current = v; draw(); });
bindSlider('slider-turns', 'val-turns', (v) => v.toFixed(0), (v) => { state.sol.turns = v; draw(); });
bindSlider('slider-slen', 'val-slen', (v) => v.toFixed(0), (v) => { state.sol.length = v; draw(); });

bindToggle('btn-bar-interior',
  () => state.bar.showInterior,
  (v) => { state.bar.showInterior = v; });
bindToggle('btn-sol-interior',
  () => state.sol.showInterior,
  (v) => { state.sol.showInterior = v; });

draw();
