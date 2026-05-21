// Fibre optic — total internal reflection
// Logical canvas: 960 x 600. All geometry in these coords.

const W = 960, H = 600;
const FIBRE_RADIUS = 28;
const SAMPLES_PER_SEG = 32;
const MAX_BOUNCES = 600;
const PUSH_OFF = 0.4;
const MIN_INTENSITY = 0.005;
const MIN_ESCAPED_INTENSITY = 0.001;
const ESCAPED_ALPHA_GAMMA = 0.45;
// Arclength window: only walls within this many centreline samples of the ray's
// current section are tested. Keeps self-crossing fibres (e.g. tight loops)
// from letting the ray see walls of a different lap.
const SEARCH_WINDOW = 90;

// ---- State ----
let n_ref = 1.50;
let lambda = 550;
let entryAngleDeg = 8;
let pts = presetStraight();
let showHandles = true;
let absorbOutput = true;
let showNormals = false;
let showBounceLabel = true;
let pulseAnim = true;
let dragIdx = -1;
let lastTrace = null;

// ---- Cauchy dispersion (mild, pedagogical) ----
// n(λ) = n_ref + B (1/λ² − 1/λ_ref²), with λ in micrometres
const CAUCHY_B = 0.00450;
const LAM_REF_UM = 0.589;
function nOfLambda(lam_nm) {
  const lu = lam_nm / 1000;
  return n_ref + CAUCHY_B * (1 / (lu * lu) - 1 / (LAM_REF_UM * LAM_REF_UM));
}

// ---- Wavelength → RGB (Bruton approximation) ----
function wavelengthToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440)      { r = -(wl - 440) / 60; b = 1; }
  else if (wl < 490)              { g = (wl - 440) / 50;  b = 1; }
  else if (wl < 510)              { g = 1; b = -(wl - 510) / 20; }
  else if (wl < 580)              { r = (wl - 510) / 70;  g = 1; }
  else if (wl < 645)              { r = 1; g = -(wl - 645) / 65; }
  else if (wl <= 750)             { r = 1; }
  let f = 1;
  if (wl < 420)       f = 0.35 + 0.65 * (wl - 380) / 40;
  else if (wl > 700)  f = 0.35 + 0.65 * (750 - wl) / 50;
  const gamma = 0.85;
  return {
    r: Math.round(255 * Math.pow(Math.max(0, r * f), gamma)),
    g: Math.round(255 * Math.pow(Math.max(0, g * f), gamma)),
    b: Math.round(255 * Math.pow(Math.max(0, b * f), gamma))
  };
}
const rgbToCss = (c, a = 1) => `rgba(${c.r},${c.g},${c.b},${a})`;

// ---- Presets ----
function defaultSBend() {
  return [
    { x: 30,  y: 300 },
    { x: 220, y: 200 },
    { x: 430, y: 410 },
    { x: 650, y: 200 },
    { x: 860, y: 320 },
    { x: 930, y: 300 }
  ];
}
function presetStraight() {
  return [
    { x: 30,  y: 300 },
    { x: 270, y: 300 },
    { x: 510, y: 300 },
    { x: 750, y: 300 },
    { x: 930, y: 300 }
  ];
}
function presetLoop() {
  return [
    { x: 30,  y: 360 },
    { x: 240, y: 360 },
    { x: 430, y: 480 },
    { x: 560, y: 360 },
    { x: 480, y: 180 },
    { x: 290, y: 170 },
    { x: 290, y: 360 },
    { x: 500, y: 470 },
    { x: 720, y: 380 },
    { x: 930, y: 320 }
  ];
}

// ---- Catmull-Rom spline ----
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}
function sampleSpline(controls) {
  if (controls.length < 2) return controls.slice();
  // Pad with duplicates so the curve passes through endpoints.
  const ext = [controls[0], ...controls, controls[controls.length - 1]];
  const out = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = ext[i], p1 = ext[i + 1], p2 = ext[i + 2], p3 = ext[i + 3];
    const last = i === controls.length - 2;
    const N = last ? SAMPLES_PER_SEG + 1 : SAMPLES_PER_SEG;
    for (let j = 0; j < N; j++) {
      out.push(catmull(p0, p1, p2, p3, j / SAMPLES_PER_SEG));
    }
  }
  return out;
}

// ---- Build walls from centreline ----
// Returns { top, bot, tangents, normalsOut } parallel arrays sized to centreline.
function buildWalls(centre) {
  const N = centre.length;
  const top = new Array(N), bot = new Array(N);
  const tangents = new Array(N), normalsOut = new Array(N);
  for (let i = 0; i < N; i++) {
    let tx, ty;
    if (i === 0)            { tx = centre[1].x - centre[0].x;     ty = centre[1].y - centre[0].y; }
    else if (i === N - 1)   { tx = centre[i].x - centre[i - 1].x; ty = centre[i].y - centre[i - 1].y; }
    else                    { tx = centre[i + 1].x - centre[i - 1].x; ty = centre[i + 1].y - centre[i - 1].y; }
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    tangents[i] = { x: tx, y: ty };
    const nx = -ty, ny = tx;          // left-hand perpendicular = "top" side
    normalsOut[i] = { x: nx, y: ny };
    top[i] = { x: centre[i].x + nx * FIBRE_RADIUS, y: centre[i].y + ny * FIBRE_RADIUS };
    bot[i] = { x: centre[i].x - nx * FIBRE_RADIUS, y: centre[i].y - ny * FIBRE_RADIUS };
  }
  return { top, bot, tangents, normalsOut };
}

// ---- Estimate tightest bend radius along centreline ----
function tightestBendRadius(centre) {
  let minR = Infinity;
  for (let i = 1; i < centre.length - 1; i++) {
    const a = centre[i - 1], b = centre[i], c = centre[i + 1];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ac = Math.hypot(c.x - a.x, c.y - a.y);
    // Triangle area via cross product
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (cross < 1e-3) continue;
    // Circumradius R = (ab * bc * ac) / (2 * area), area = cross/2
    const R = (ab * bc * ac) / (2 * cross);
    if (R < minR) minR = R;
  }
  return minR;
}

// ---- Ray-segment intersection ----
// Ray: P + t*d (t > 0). Segment: A + u*(B-A) (0..1). Returns {t, u, point} or null.
function raySegment(P, d, A, B) {
  const sx = B.x - A.x, sy = B.y - A.y;
  const det = sx * d.y - sy * d.x;
  if (Math.abs(det) < 1e-9) return null;
  const ax = A.x - P.x, ay = A.y - P.y;
  const t = (sx * ay - sy * ax) / det;
  const u = (d.x * ay - d.y * ax) / det;
  if (t <= 0 || u < 0 || u > 1) return null;
  return { t, u, point: { x: P.x + d.x * t, y: P.y + d.y * t } };
}

// Snell refraction. d incident unit, N inward normal (into source medium), mu = n1/n2.
function refract(d, N, mu) {
  const cosI = -(d.x * N.x + d.y * N.y);
  const sin2T = mu * mu * (1 - cosI * cosI);
  if (sin2T >= 1) return null;
  const cosT = Math.sqrt(1 - sin2T);
  return {
    x: mu * d.x + (mu * cosI - cosT) * N.x,
    y: mu * d.y + (mu * cosI - cosT) * N.y
  };
}
function reflect(d, N) {
  const dn = d.x * N.x + d.y * N.y;
  return { x: d.x - 2 * dn * N.x, y: d.y - 2 * dn * N.y };
}

// Fresnel power reflectance for unpolarised light at an n1→n2 interface.
// cosI, cosT positive. Returns R in [0,1]; T = 1 - R.
function fresnelR(n1, n2, cosI, cosT) {
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

// How far along (P, dir) before it leaves the canvas — used to render escaped rays.
function distanceToCanvasEdge(P, dir) {
  let tMax = Infinity;
  if (dir.x > 1e-9)  tMax = Math.min(tMax, (W - P.x) / dir.x);
  if (dir.x < -1e-9) tMax = Math.min(tMax, (0 - P.x) / dir.x);
  if (dir.y > 1e-9)  tMax = Math.min(tMax, (H - P.y) / dir.y);
  if (dir.y < -1e-9) tMax = Math.min(tMax, (0 - P.y) / dir.y);
  return Math.max(0, tMax);
}

// ---- Trace the ray through the fibre ----
function traceRay(walls, n_glass) {
  const { top, bot, tangents, normalsOut } = walls;
  const N = top.length;

  // Start ray at the input face midpoint (centreline[0]); shift just inside.
  const t0 = tangents[0];
  const aRad = entryAngleDeg * Math.PI / 180;
  // Rotate tangent by entry angle to get initial direction
  const c = Math.cos(aRad), s = Math.sin(aRad);
  const dir0 = { x: t0.x * c - t0.y * s, y: t0.x * s + t0.y * c };
  const start = {
    x: (top[0].x + bot[0].x) / 2 + dir0.x * 0.5,
    y: (top[0].y + bot[0].y) / 2 + dir0.y * 0.5
  };

  const path = [{ x: start.x, y: start.y, intensity: 1 }];
  const escaped = [];   // refracted rays {p, dir, intensity, len}
  let P = { ...start };
  let d = { ...dir0 };
  let intensity = 1;
  const mu = n_glass;   // n1/n2 with n2 = 1 (air)
  const sinC = 1 / n_glass;
  let bounces = 0;
  let lastSinI = null;
  let lastSinC = sinC;
  let lastHit = null;     // {point, normalIn, sinI}
  let exitReason = 'absorbed';
  let curSegIdx = 0;      // arclength position along centreline (in samples)

  // Find the nearest intersection. Restricts the search to ±SEARCH_WINDOW
  // around curSegIdx so self-overlapping strips (loops) don't leak.
  // Falls back to a full scan if nothing is found in the window.
  function findHit(P, d, win) {
    let best = null;
    const lo = Math.max(0, curSegIdx - win);
    const hi = Math.min(N - 2, curSegIdx + win);
    for (let i = lo; i <= hi; i++) {
      const hitT = raySegment(P, d, top[i], top[i + 1]);
      if (hitT && hitT.t > 1e-4 && (!best || hitT.t < best.t)) {
        const nx = -(normalsOut[i].x + normalsOut[i + 1].x) * 0.5;
        const ny = -(normalsOut[i].y + normalsOut[i + 1].y) * 0.5;
        const nl = Math.hypot(nx, ny) || 1;
        best = { ...hitT, kind: 'wall', N: { x: nx / nl, y: ny / nl }, segIdx: i };
      }
      const hitB = raySegment(P, d, bot[i], bot[i + 1]);
      if (hitB && hitB.t > 1e-4 && (!best || hitB.t < best.t)) {
        const nx = (normalsOut[i].x + normalsOut[i + 1].x) * 0.5;
        const ny = (normalsOut[i].y + normalsOut[i + 1].y) * 0.5;
        const nl = Math.hypot(nx, ny) || 1;
        best = { ...hitB, kind: 'wall', N: { x: nx / nl, y: ny / nl }, segIdx: i };
      }
    }
    if (lo === 0) {
      const inputHit = raySegment(P, d, top[0], bot[0]);
      if (inputHit && inputHit.t > 1e-4 && (!best || inputHit.t < best.t)) {
        best = { ...inputHit, kind: 'end', which: 'input',
          N: { x: tangents[0].x, y: tangents[0].y }, segIdx: 0 };
      }
    }
    if (hi === N - 2) {
      const outputHit = raySegment(P, d, top[N - 1], bot[N - 1]);
      if (outputHit && outputHit.t > 1e-4 && (!best || outputHit.t < best.t)) {
        best = { ...outputHit, kind: 'end', which: 'output',
          N: { x: -tangents[N - 1].x, y: -tangents[N - 1].y }, segIdx: N - 2 };
      }
    }
    return best;
  }

  for (let step = 0; step < MAX_BOUNCES; step++) {
    let best = findHit(P, d, SEARCH_WINDOW);
    if (!best) best = findHit(P, d, N);   // fallback for shallow rays / large gaps

    if (!best) { exitReason = 'lost'; break; }
    curSegIdx = best.segIdx;

    P = best.point;
    path.push({ x: P.x, y: P.y, intensity });

    const cosI = -(d.x * best.N.x + d.y * best.N.y);
    const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
    lastSinI = sinI;
    lastHit = { point: { ...P }, normalIn: { ...best.N }, sinI };

    if (best.kind === 'end') {
      if (best.which === 'output' && absorbOutput) {
        // Detector / absorber: swallows everything, no escape beam.
        exitReason = 'absorbed';
        break;
      }
      // Otherwise handle with Fresnel (mostly transmits at near-normal incidence).
      const r = refract(d, best.N, mu);
      if (r) {
        const cosT = Math.sqrt(Math.max(0, 1 - mu * mu * (1 - cosI * cosI)));
        const R = fresnelR(n_glass, 1, cosI, cosT);
        const len = distanceToCanvasEdge(P, r);
        if (len > 0 && intensity * (1 - R) > MIN_ESCAPED_INTENSITY) {
          escaped.push({ p: { ...P }, dir: r, intensity: intensity * (1 - R), len });
        }
        exitReason = best.which === 'output' ? 'exit' : 'back';
      } else {
        // TIR at end face (very grazing).
        d = reflect(d, best.N);
        P = { x: P.x + d.x * PUSH_OFF, y: P.y + d.y * PUSH_OFF };
        bounces++;
        continue;
      }
      break;
    }

    bounces++;

    if (sinI >= sinC) {
      // Total internal reflection — wall is a perfect mirror.
      d = reflect(d, best.N);
      P = { x: P.x + d.x * PUSH_OFF, y: P.y + d.y * PUSH_OFF };
    } else {
      // Below critical: Fresnel split into a transmitted (escaping) ray and a reflected ray.
      const r = refract(d, best.N, mu);
      const cosT = Math.sqrt(Math.max(0, 1 - mu * mu * (1 - cosI * cosI)));
      const R = fresnelR(n_glass, 1, cosI, cosT);
      const T = 1 - R;
      if (r && intensity * T > MIN_ESCAPED_INTENSITY) {
        const len = distanceToCanvasEdge({ x: P.x + r.x * 1, y: P.y + r.y * 1 }, r);
        escaped.push({ p: { ...P }, dir: r, intensity: intensity * T, len: Math.max(40, len) });
      }
      intensity *= R;
      d = reflect(d, best.N);
      P = { x: P.x + d.x * PUSH_OFF, y: P.y + d.y * PUSH_OFF };
      if (intensity < MIN_INTENSITY) { exitReason = 'leaked'; break; }
    }
  }

  return {
    path, escaped, bounces, lastSinI, lastSinC,
    finalIntensity: intensity,
    exitReason, lastHit
  };
}

// ---- Drawing ----
const canvas = document.getElementById('fibre-canvas');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
function toCanvasScale() {
  return { sx: canvas.width / W, sy: canvas.height / H };
}
function pointerToLogical(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * W,
    y: ((evt.clientY - rect.top) / rect.height) * H
  };
}

let pulseT = 0;
function draw() {
  const centre = sampleSpline(pts);
  const walls = buildWalls(centre);
  const n_glass = nOfLambda(lambda);
  const trace = traceRay(walls, n_glass);
  lastTrace = trace;

  const { sx, sy } = toCanvasScale();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Background subtle grid
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Fibre fill: outline top + bot reversed
  ctx.beginPath();
  ctx.moveTo(walls.top[0].x, walls.top[0].y);
  for (let i = 1; i < walls.top.length; i++) ctx.lineTo(walls.top[i].x, walls.top[i].y);
  for (let i = walls.bot.length - 1; i >= 0; i--) ctx.lineTo(walls.bot[i].x, walls.bot[i].y);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, 0, W, 0);
  fillGrad.addColorStop(0, 'rgba(140, 200, 255, 0.12)');
  fillGrad.addColorStop(1, 'rgba(140, 200, 255, 0.20)');
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Wall strokes
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(walls.top[0].x, walls.top[0].y);
  for (let i = 1; i < walls.top.length; i++) ctx.lineTo(walls.top[i].x, walls.top[i].y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(walls.bot[0].x, walls.bot[0].y);
  for (let i = 1; i < walls.bot.length; i++) ctx.lineTo(walls.bot[i].x, walls.bot[i].y);
  ctx.stroke();

  // End faces
  ctx.strokeStyle = 'rgba(200, 230, 255, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(walls.top[0].x, walls.top[0].y); ctx.lineTo(walls.bot[0].x, walls.bot[0].y);
  ctx.moveTo(walls.top[walls.top.length - 1].x, walls.top[walls.top.length - 1].y);
  ctx.lineTo(walls.bot[walls.bot.length - 1].x, walls.bot[walls.bot.length - 1].y);
  ctx.stroke();

  // Absorber cap on the output end (toggle)
  if (absorbOutput) {
    const last = walls.top.length - 1;
    const tEnd = walls.tangents[last];
    const tA = walls.top[last], tB = walls.bot[last];
    const capLen = 14;
    const ax = tA.x + tEnd.x * capLen, ay = tA.y + tEnd.y * capLen;
    const bx = tB.x + tEnd.x * capLen, by = tB.y + tEnd.y * capLen;
    ctx.fillStyle = 'rgba(20, 24, 33, 0.95)';
    ctx.strokeStyle = 'rgba(180, 200, 220, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tA.x, tA.y); ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by); ctx.lineTo(tB.x, tB.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Hatch lines to suggest absorption
    ctx.strokeStyle = 'rgba(140, 160, 180, 0.45)';
    ctx.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      const f = k / 4;
      const sxA = tA.x + (tB.x - tA.x) * f;
      const syA = tA.y + (tB.y - tA.y) * f;
      ctx.beginPath();
      ctx.moveTo(sxA, syA);
      ctx.lineTo(sxA + tEnd.x * capLen, syA + tEnd.y * capLen);
      ctx.stroke();
    }
  }

  // Refracted (escaped) rays
  const col = wavelengthToRGB(lambda);
  for (const e of trace.escaped) {
    const startAlpha = Math.min(1, Math.pow(e.intensity, ESCAPED_ALPHA_GAMMA));
    const grad = ctx.createLinearGradient(e.p.x, e.p.y,
      e.p.x + e.dir.x * e.len, e.p.y + e.dir.y * e.len);
    grad.addColorStop(0, rgbToCss(col, startAlpha));
    grad.addColorStop(0.6, rgbToCss(col, startAlpha * 0.55));
    grad.addColorStop(1, rgbToCss(col, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(e.p.x, e.p.y);
    ctx.lineTo(e.p.x + e.dir.x * e.len, e.p.y + e.dir.y * e.len);
    ctx.stroke();
  }

  // Glow underlay for ray
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (trace.path.length > 1) {
    ctx.strokeStyle = rgbToCss(col, 0.25);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(trace.path[0].x, trace.path[0].y);
    for (let i = 1; i < trace.path.length; i++) ctx.lineTo(trace.path[i].x, trace.path[i].y);
    ctx.stroke();
    // Crisp ray, segments coloured by their stored intensity
    ctx.lineWidth = 2.2;
    for (let i = 1; i < trace.path.length; i++) {
      const a = trace.path[i - 1], b = trace.path[i];
      ctx.strokeStyle = rgbToCss(col, Math.max(0.08, b.intensity));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  // Travelling pulse
  if (pulseAnim && trace.path.length > 1) {
    const segLens = [];
    let total = 0;
    for (let i = 1; i < trace.path.length; i++) {
      const dx = trace.path[i].x - trace.path[i - 1].x;
      const dy = trace.path[i].y - trace.path[i - 1].y;
      const L = Math.hypot(dx, dy);
      segLens.push(L); total += L;
    }
    if (total > 0) {
      const pos = (pulseT % 1) * total;
      let acc = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (acc + segLens[i] >= pos) {
          const f = (pos - acc) / segLens[i];
          const a = trace.path[i], b = trace.path[i + 1];
          const px = a.x + (b.x - a.x) * f;
          const py = a.y + (b.y - a.y) * f;
          ctx.fillStyle = rgbToCss(col, Math.max(0.4, b.intensity));
          ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgbToCss(col, 0.18);
          ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
          break;
        }
        acc += segLens[i];
      }
    }
  }

  // Last-bounce normal & angle label
  if (trace.lastHit && (showNormals || showBounceLabel)) {
    const h = trace.lastHit;
    if (showNormals) {
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.85)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(h.point.x - h.normalIn.x * 38, h.point.y - h.normalIn.y * 38);
      ctx.lineTo(h.point.x + h.normalIn.x * 38, h.point.y + h.normalIn.y * 38);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (showBounceLabel && trace.lastSinI !== null) {
      const thetaI = Math.asin(Math.min(1, trace.lastSinI)) * 180 / Math.PI;
      const thetaC = Math.asin(Math.min(1, trace.lastSinC)) * 180 / Math.PI;
      const tir = trace.lastSinI >= trace.lastSinC;
      const label = `θᵢ = ${thetaI.toFixed(1)}° ${tir ? '≥' : '<'} θc = ${thetaC.toFixed(1)}°`;
      const lx = h.point.x + h.normalIn.x * 46;
      const ly = h.point.y + h.normalIn.y * 46;
      ctx.font = '600 13px "Trebuchet MS", "Segoe UI", sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(10, 22, 40, 0.85)';
      ctx.fillRect(lx - tw / 2 - 6, ly - 11, tw + 12, 20);
      ctx.strokeStyle = tir ? 'rgba(125, 211, 252, 0.7)' : 'rgba(248, 113, 113, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - tw / 2 - 6, ly - 11, tw + 12, 20);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  // Handles
  if (showHandles) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const isDrag = i === dragIdx;
      ctx.fillStyle = isDrag ? '#fbbf24' : 'rgba(250, 204, 21, 0.92)';
      ctx.strokeStyle = 'rgba(10, 22, 40, 0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, isDrag ? 9 : 7, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  updateReadouts(trace, n_glass);
}

function updateReadouts(trace, n_glass) {
  const thetaC = Math.asin(1 / n_glass) * 180 / Math.PI;
  document.getElementById('rd-n').textContent = n_glass.toFixed(3);
  document.getElementById('rd-crit').textContent = thetaC.toFixed(2) + '°';
  document.getElementById('rd-incidence').textContent = (trace.lastSinI === null)
    ? '—'
    : (Math.asin(Math.min(1, trace.lastSinI)) * 180 / Math.PI).toFixed(2) + '°';
  document.getElementById('rd-bounces').textContent = trace.bounces;
  const centre = sampleSpline(pts);
  const R = tightestBendRadius(centre);
  document.getElementById('rd-bend').textContent = isFinite(R) ? Math.round(R) + ' px' : '—';
  document.getElementById('rd-exit').textContent =
    Math.round(trace.finalIntensity * 100) + '%';

  const title = document.getElementById('status-title');
  const body  = document.getElementById('status-body');
  if (trace.exitReason === 'absorbed') {
    title.textContent = 'Absorbed at the detector';
    body.textContent = `${trace.bounces} bounce${trace.bounces===1?'':'s'}; the absorber at the far end caught ${Math.round(trace.finalIntensity*100)}% of the launched intensity.`;
  } else if (trace.exitReason === 'exit') {
    title.textContent = 'Reached the far end';
    body.textContent = `${trace.bounces} bounce${trace.bounces===1?'':'s'}, with ${Math.round(trace.finalIntensity*100)}% of the launched intensity surviving.`;
  } else if (trace.exitReason === 'back') {
    title.textContent = 'Reflected back out of the input';
    body.textContent = 'The ray turned around inside the fibre — try a smaller entry angle or a gentler bend.';
  } else if (trace.exitReason === 'leaked') {
    title.textContent = 'Leaked away at the bends';
    body.textContent = 'The fibre bent too sharply somewhere — each leaky wall hit dimmed the trapped ray below the threshold to keep tracing.';
  } else {
    title.textContent = 'Tracing stopped';
    body.textContent = 'Bounce limit reached or no further intersection found.';
  }
}

// ---- Pointer interaction ----
function nearestHandleIdx(p) {
  let best = -1, bestD = 18 * 18;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - p.x, dy = pts[i].y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = i; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!showHandles) return;
  const p = pointerToLogical(e);
  const idx = nearestHandleIdx(p);
  if (idx >= 0) {
    dragIdx = idx;
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (dragIdx < 0) return;
  const p = pointerToLogical(e);
  pts[dragIdx].x = Math.max(8, Math.min(W - 8, p.x));
  pts[dragIdx].y = Math.max(8, Math.min(H - 8, p.y));
});
canvas.addEventListener('pointerup', (e) => {
  if (dragIdx >= 0) { try { canvas.releasePointerCapture(e.pointerId); } catch {} dragIdx = -1; }
});
canvas.addEventListener('pointercancel', () => { dragIdx = -1; });

// ---- Controls wiring ----
function bindSlider(sliderId, valueId, onChange) {
  const s = document.getElementById(sliderId);
  const v = document.getElementById(valueId);
  s.addEventListener('input', () => { v.value = s.value; onChange(parseFloat(s.value)); });
  v.addEventListener('input', () => {
    const x = parseFloat(v.value);
    if (!isFinite(x)) return;
    s.value = x; onChange(parseFloat(s.value));
  });
}
bindSlider('slider-n', 'val-n', (x) => { n_ref = x; });
bindSlider('slider-lambda', 'val-lambda', (x) => {
  lambda = x;
  const pct = (x - 380) / (750 - 380) * 100;
  document.getElementById('lambda-marker').style.left = pct + '%';
});
bindSlider('slider-angle', 'val-angle', (x) => { entryAngleDeg = x; });

document.getElementById('lambda-marker').style.left =
  ((lambda - 380) / (750 - 380) * 100) + '%';

document.getElementById('btn-add').addEventListener('click', () => {
  // Insert a new handle at the longest gap, mid-point of that segment.
  let bestI = 0, bestD = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (d > bestD) { bestD = d; bestI = i; }
  }
  const mid = {
    x: (pts[bestI].x + pts[bestI + 1].x) / 2,
    y: (pts[bestI].y + pts[bestI + 1].y) / 2
  };
  pts.splice(bestI + 1, 0, mid);
});
document.getElementById('btn-remove').addEventListener('click', () => {
  if (pts.length <= 3) return;
  // Remove an interior handle (not the endpoints).
  pts.splice(Math.floor(pts.length / 2), 1);
});
document.getElementById('btn-preset-straight').addEventListener('click', () => { pts = presetStraight(); });
document.getElementById('btn-preset-sbend').addEventListener('click',    () => { pts = defaultSBend(); });
document.getElementById('btn-preset-loop').addEventListener('click',     () => { pts = presetLoop(); });

function bindToggle(btnId, getter, setter) {
  const b = document.getElementById(btnId);
  const refresh = () => b.classList.toggle('active', getter());
  refresh();
  b.addEventListener('click', () => { setter(!getter()); refresh(); });
}
bindToggle('btn-handles',     () => showHandles,     v => showHandles = v);
bindToggle('btn-absorb',      () => absorbOutput,    v => absorbOutput = v);
bindToggle('btn-normals',     () => showNormals,     v => showNormals = v);
bindToggle('btn-bouncelabel', () => showBounceLabel, v => showBounceLabel = v);
bindToggle('btn-pulse',       () => pulseAnim,       v => pulseAnim = v);

// ---- Main loop ----
let lastTime = performance.now();
function loop(now) {
  const dt = (now - lastTime) / 1000; lastTime = now;
  if (pulseAnim) pulseT += dt * 0.35;
  draw();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();
requestAnimationFrame(loop);
