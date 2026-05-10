// ── DOM & canvas ──────────────────────────────────────────────────
const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Backing buffer at lower resolution. Field rendering scales N×, so we drop
// resolution for high N to keep the frame budget reasonable.
let buf, bctx, imgData, pxData, BW, BH;
function setBufferRes(bw) {
  BW = bw;
  BH = Math.round(bw * H / W);
  buf = document.createElement('canvas');
  buf.width = BW; buf.height = BH;
  bctx = buf.getContext('2d');
  imgData = bctx.createImageData(BW, BH);
  pxData = imgData.data;
}
setBufferRes(360);

// ── Scene (mm) ────────────────────────────────────────────────────
const SCENE_W = 200;
const SCENE_H = SCENE_W * H / W;     // ≈ 125 mm
const SOURCE_X = 6;
const SLIT_X   = 40;
const CENTER_Y = SCENE_H / 2;
const WAVE_SPEED = 30;
const PLATE_W   = 1.6;
const SCREEN_W  = 2.0;

// ── State ─────────────────────────────────────────────────────────
const state = {
  mode: 'mono',           // 'mono' | 'white'
  N: 6,
  d: 8.0, a: 0.6, lambda: 1.4, L: 130,
  realUnits: false,
  lightMode: false,
  showOrders: false,
  showDeriv: false,
  showProbe: true,
  snapToFringe: true,
  playing: false,
  speed: 1.0,
  t: 0,
  t_on_source: 0,
  cursor: null,
  derivY: null,
  draggingP: false,
};

// ── Real-units mapping ────────────────────────────────────────────
// Two independent scale factors:
//   - LEN_NM_PER_SIM_MM: applies to λ, d, a, p (so λ/d ratio — and therefore all
//     angles — is identical in sim and real readouts).
//   - L_M_PER_SIM_MM:    applies to L and on-screen positions (Δy, y, cursor x/y),
//     calibrated independently because real L is much larger relative to d than
//     fits on the canvas. Calibrated so default sim values map to a familiar
//     school-lab grating: λ=1.4mm → 580 nm, d=8mm → ~3.3 μm (≈300 lines/mm),
//     L=130mm → 1.00 m.
const REAL = {
  LEN_NM_PER_SIM_MM: 580 / 1.4,
  L_M_PER_SIM_MM:    1.0 / 130,
};

function fmtLambda(v) {
  return state.realUnits
    ? [(v * REAL.LEN_NM_PER_SIM_MM).toFixed(0), 'nm']
    : [v.toFixed(2), 'mm'];
}
function fmtSlit(v) {  // d, a
  return state.realUnits
    ? [(v * REAL.LEN_NM_PER_SIM_MM / 1000).toFixed(2), 'μm']
    : [v.toFixed(1), 'mm'];
}
function fmtL(v) {
  return state.realUnits
    ? [(v * REAL.L_M_PER_SIM_MM).toFixed(2), 'm']
    : [v.toFixed(0), 'mm'];
}
// Lengths on the screen plane (Δy, y, cursor x/y) — share L's scale.
function fmtScreenY(simY) {
  if (!state.realUnits) return [simY.toFixed(2), 'mm'];
  const m = simY * REAL.L_M_PER_SIM_MM;
  if (Math.abs(m) >= 1) return [m.toFixed(3), 'm'];
  return [(m * 100).toFixed(2), 'cm'];
}
// Path difference p — uses slit scale (it's of order λ).
function fmtP(simP) {
  return state.realUnits
    ? [(simP * REAL.LEN_NM_PER_SIM_MM).toFixed(0), 'nm']
    : [simP.toFixed(3), 'mm'];
}

function setSlider(key, valId, unitId, fmt) {
  const [v, u] = fmt(state[key]);
  $(valId).textContent = v;
  $(unitId).textContent = u;
}
function refreshUnits() {
  setSlider('lambda', 'val-lambda', 'unit-lambda', fmtLambda);
  setSlider('d',      'val-d',      'unit-d',      fmtSlit);
  setSlider('a',      'val-a',      'unit-a',      fmtSlit);
  setSlider('L',      'val-L',      'unit-L',      fmtL);
}

// ── Helpers ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sceneToCanvas = (x, y) => [x / SCENE_W * W, y / SCENE_H * H];
const canvasToScene = (cx, cy) => [cx / W * SCENE_W, cy / H * SCENE_H];
const screenX = () => SLIT_X + state.L;

function slitYs() {
  // N slits, evenly spaced, centred on CENTER_Y.
  const ys = new Array(state.N);
  const off = (state.N - 1) / 2;
  for (let i = 0; i < state.N; i++) ys[i] = CENTER_Y + (i - off) * state.d;
  return ys;
}

// Far-field single-slit envelope (per-pixel, used in field rendering): sinc(π a sinθ / λ).
function slitEnv(dy, r) {
  if (state.a <= 0 || r <= 1e-6) return 1;
  const arg = Math.PI * state.a * dy / (state.lambda * r);
  if (Math.abs(arg) < 1e-6) return 1;
  return Math.sin(arg) / arg;
}

// Far-field N-slit intensity at screen, normalised so principal-maximum peak = N².
// I(θ, λ) = sinc²(π a sinθ / λ) · ( sin(Nβ) / sin(β) )²,  β = π d sinθ / λ.
function gratingIntensity(yRel, lambda) {
  const sinTh = yRel / Math.sqrt(state.L * state.L + yRel * yRel);
  let env = 1;
  if (state.a > 0) {
    const arg = Math.PI * state.a * sinTh / lambda;
    if (Math.abs(arg) > 1e-6) env = Math.sin(arg) / arg;
  }
  const beta = Math.PI * state.d * sinTh / lambda;
  let Nf;
  if (Math.abs(Math.sin(beta)) < 1e-6) Nf = state.N;       // β → mπ : limit = N
  else Nf = Math.sin(state.N * beta) / Math.sin(beta);
  return env * env * Nf * Nf;
}

// Visible-spectrum wavelength → sRGB triplet (Bruton's piecewise function),
// with sim λ in [1.0, 1.8] mm mapped onto 380–780 nm.
function wavelengthToRGB(lambdaMM) {
  const lam = 380 + (lambdaMM - 1.0) / 0.8 * 400;
  let R = 0, G = 0, B = 0;
  if      (lam < 440) { R = -(lam - 440) / 60; G = 0; B = 1; }
  else if (lam < 490) { R = 0; G = (lam - 440) / 50; B = 1; }
  else if (lam < 510) { R = 0; G = 1; B = -(lam - 510) / 20; }
  else if (lam < 580) { R = (lam - 510) / 70; G = 1; B = 0; }
  else if (lam < 645) { R = 1; G = -(lam - 645) / 65; B = 0; }
  else                { R = 1; G = 0; B = 0; }
  let f = 1;
  if      (lam < 420) f = 0.3 + 0.7 * (lam - 380) / 40;
  else if (lam > 700) f = 0.3 + 0.7 * (780 - lam) / 80;
  return [R * f, G * f, B * f];
}

// Field-rendering threshold: above this many slits, skip the per-pixel field
// (the screen tells the story; the field would be expensive and noisy).
const FIELD_MAX_N = 8;

// ── Wave field render (monochromatic) ─────────────────────────────
function renderField() {
  const k = 2 * Math.PI / state.lambda;
  const w = WAVE_SPEED * k;
  const t = state.t;
  const tElapsed = Math.max(0, t - state.t_on_source);
  const reachSrc = tElapsed * WAVE_SPEED;
  const wt = w * tElapsed;
  const invLam = 1 / state.lambda;
  const dPlate = SLIT_X - SOURCE_X;
  const phaseRight = k * dPlate;
  const SCREEN_X = screenX();

  const ys = slitYs();
  const renderRight = state.N <= FIELD_MAX_N;

  // Scale buffer resolution to N: full at low N, half at moderate N, off at high N.
  const targetBW = state.N <= 6 ? 360 : state.N <= 20 ? 260 : 200;
  if (BW !== targetBW) setBufferRes(targetBW);

  let i = 0;
  for (let py = 0; py < BH; py++) {
    const y = (py + 0.5) / BH * SCENE_H;
    for (let px = 0; px < BW; px++) {
      const x = (px + 0.5) / BW * SCENE_W;

      let psi;
      if (x > SCREEN_X + 0.5) {
        psi = 0;
      } else if (x < SLIT_X) {
        // Plane wave from source, causally faded
        const dxs = x - SOURCE_X;
        if (dxs < 0) {
          psi = 0;
        } else {
          let f = (reachSrc - dxs) * invLam;
          if (f < 0) f = 0; else if (f > 1) f = 1;
          psi = f * Math.sin(k * dxs - wt);
        }
      } else if (renderRight) {
        // Right side: Huygens sum from N slits
        let p = 0;
        const dxr = x - SLIT_X;
        const dxrsq = dxr * dxr;
        for (let s = 0; s < state.N; s++) {
          const dy = y - ys[s];
          const r = Math.sqrt(dxrsq + dy * dy);
          let f = (reachSrc - (dPlate + r)) * invLam;
          if (f < 0) f = 0; else if (f > 1) f = 1;
          if (f === 0) continue;
          p += f * slitEnv(dy, r) * Math.sin(k * r - wt + phaseRight);
        }
        psi = p;
      } else {
        psi = 0;                    // high N: skip field rendering
      }

      const v = psi * 0.5 / Math.max(1, state.N * 0.5);   // normalise so high-N central peak doesn't blow out
      let r, g, b;
      if (state.lightMode) {
        // Pale background, saturated dark colour for crests/troughs (RdBu_r style).
        if (v >= 0) {
          const vv = Math.min(1, v);
          r = (254 + (30  - 254) * vv) | 0;
          g = (249 + (64  - 249) * vv) | 0;
          b = (231 + (175 - 231) * vv) | 0;
        } else {
          const u = Math.min(1, -v);
          r = (254 + (190 - 254) * u) | 0;
          g = (249 + (30  - 249) * u) | 0;
          b = (231 + (30  - 231) * u) | 0;
        }
      } else {
        if (v >= 0) {
          const vv = Math.min(1, v);
          r = (14  + (220 - 14)  * vv) | 0;
          g = (26  + (235 - 26)  * vv) | 0;
          b = (48  + (255 - 48)  * vv) | 0;
        } else {
          const u = Math.min(1, -v);
          r = (14  + (4  - 14)  * u) | 0;
          g = (26  + (10 - 26)  * u) | 0;
          b = (48  + (22 - 48)  * u) | 0;
        }
      }
      pxData[i++] = r; pxData[i++] = g; pxData[i++] = b; pxData[i++] = 255;
    }
  }
  bctx.putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf, 0, 0, W, H);
}

// ── Source ────────────────────────────────────────────────────────
function drawSource() {
  const [sxC] = sceneToCanvas(SOURCE_X, 0);
  const colA = state.mode === 'white' ? '#f8f8f4' : '#facc15';
  const colB = state.mode === 'white' ? 'rgba(248,248,244,0.18)' : 'rgba(250,204,21,0.18)';
  ctx.fillStyle = colA;
  ctx.fillRect(sxC - 2, 0, 3, H);
  ctx.fillStyle = colB;
  ctx.fillRect(sxC + 1, 0, 8, H);
}

// ── Slit plate (N gaps) ───────────────────────────────────────────
function drawSlitPlate() {
  const [pxC] = sceneToCanvas(SLIT_X - PLATE_W/2, 0);
  const [pxR] = sceneToCanvas(SLIT_X + PLATE_W/2, 0);
  const wPlate = pxR - pxC;
  const ys = slitYs();
  const halfA = state.a / 2;

  let segs = [[0, SCENE_H]];
  const subtract = (top, bot) => {
    const next = [];
    for (const [a, b] of segs) {
      if (bot <= a || top >= b) { next.push([a, b]); continue; }
      if (top > a) next.push([a, top]);
      if (bot < b) next.push([bot, b]);
    }
    segs = next;
  };
  for (const ys_i of ys) subtract(ys_i - halfA, ys_i + halfA);

  ctx.fillStyle = '#1f2937';
  for (const [a, b] of segs) {
    const [, ya] = sceneToCanvas(0, a);
    const [, yb] = sceneToCanvas(0, b);
    ctx.fillRect(pxC, ya, wPlate, yb - ya);
  }
}

// Screen-arrival gate: when has the wave reached the screen by the shortest path?
function screenReachFrac() {
  const reachSrc = Math.max(0, state.t - state.t_on_source) * WAVE_SPEED;
  const minPath = (SLIT_X - SOURCE_X) + state.L;
  const f = (reachSrc - minPath) / state.lambda;       // ramp over one λ
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  return f;
}

// ── Screen strip (monochromatic) ──────────────────────────────────
function drawScreenStripMono() {
  const SCREEN_X = screenX();
  const [sxC] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [exC] = sceneToCanvas(SCREEN_X + SCREEN_W/2, 0);
  ctx.fillStyle = state.lightMode ? '#fef9e7' : '#050b18';
  ctx.fillRect(sxC, 0, exC - sxC, H);

  const fade = screenReachFrac();
  if (fade > 0) {
    // Odd row count → one row's midpoint sits exactly on CENTER_Y.
    // 4× supersampling per row catches narrow principal maxima at high N / low λ.
    const Nrows = 301;
    const SS = 4;
    const Imax = state.N * state.N;
    for (let row = 0; row < Nrows; row++) {
      const y0 = row / Nrows * SCENE_H;
      const y1p = (row + 1) / Nrows * SCENE_H;
      let Isum = 0;
      for (let s = 0; s < SS; s++) {
        const ys = y0 + (s + 0.5) / SS * (y1p - y0);
        Isum += gratingIntensity(ys - CENTER_Y, state.lambda);
      }
      const I = Isum / SS;
      const v = (I / Imax) * fade;
      const cv = Math.min(1, v * 1.25);
      let r, g, b;
      if (state.lightMode) {
        // Pale → dark amber: bright fringes appear as dark bands on the page.
        r = (254 + (146 - 254) * cv) | 0;
        g = (249 + (64  - 249) * v)  | 0;
        b = (231 + (14  - 231) * v)  | 0;
      } else {
        r = (255 * cv) | 0;
        g = (190 * v) | 0;
        b = (55  * v) | 0;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const [, ya] = sceneToCanvas(0, y0);
      const [, yb] = sceneToCanvas(0, y1p);
      ctx.fillRect(sxC, ya, exC - sxC, yb - ya + 1);
    }
  }
  ctx.strokeStyle = state.lightMode ? 'rgba(21,48,77,0.35)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sxC, 0, exC - sxC, H);
}

// ── Screen strip (white light) ────────────────────────────────────
// Cached per-row RGB; recomputed only when geometry changes.
let whiteCache = null;
function whiteCacheKey() {
  return `${state.N}|${state.d.toFixed(3)}|${state.a.toFixed(3)}|${state.L.toFixed(2)}`;
}
const WHITE_NROWS = 301;
const WHITE_SS = 4;
const WHITE_SAMPLES = 32;
const WHITE_LMIN = 1.0, WHITE_LMAX = 1.8;

function computeWhiteCache() {
  // Normalise against the single-wavelength principal-max peak (N²), not the
  // global brightest pixel. Otherwise m=0 (where all WHITE_SAMPLES wavelengths
  // pile up) dwarfs the m≥1 spectra and they render as black. Saturate-and-clip
  // gives the correct picture: m=0 → white (clipped sum), m≥1 → coloured bands.
  const data = new Float32Array(WHITE_NROWS * 3);
  const Imax = state.N * state.N;
  for (let row = 0; row < WHITE_NROWS; row++) {
    const y0 = row / WHITE_NROWS * SCENE_H;
    const y1p = (row + 1) / WHITE_NROWS * SCENE_H;
    let sR = 0, sG = 0, sB = 0;
    for (let li = 0; li < WHITE_SAMPLES; li++) {
      const lam = WHITE_LMIN + (WHITE_LMAX - WHITE_LMIN) * li / (WHITE_SAMPLES - 1);
      let I = 0;
      for (let s = 0; s < WHITE_SS; s++) {
        const ys = y0 + (s + 0.5) / WHITE_SS * (y1p - y0);
        I += gratingIntensity(ys - CENTER_Y, lam);
      }
      I /= WHITE_SS;
      const v = I / Imax;
      const [R, G, B] = wavelengthToRGB(lam);
      sR += v * R; sG += v * G; sB += v * B;
    }
    data[row*3]   = Math.min(1, sR);
    data[row*3+1] = Math.min(1, sG);
    data[row*3+2] = Math.min(1, sB);
  }
  return data;
}

function drawScreenStripWhite() {
  const SCREEN_X = screenX();
  const [sxC] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [exC] = sceneToCanvas(SCREEN_X + SCREEN_W/2, 0);
  ctx.fillStyle = '#050b18';
  ctx.fillRect(sxC, 0, exC - sxC, H);

  const key = whiteCacheKey();
  if (!whiteCache || whiteCache.key !== key) {
    whiteCache = { key, data: computeWhiteCache() };
  }
  const fade = screenReachFrac();
  if (fade > 0) {
    const data = whiteCache.data;
    for (let row = 0; row < WHITE_NROWS; row++) {
      const y0 = row / WHITE_NROWS * SCENE_H;
      const y1p = (row + 1) / WHITE_NROWS * SCENE_H;
      const r = (data[row*3]   * 255 * fade) | 0;
      const g = (data[row*3+1] * 255 * fade) | 0;
      const b = (data[row*3+2] * 255 * fade) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const [, ya] = sceneToCanvas(0, y0);
      const [, yb] = sceneToCanvas(0, y1p);
      ctx.fillRect(sxC, ya, exC - sxC, yb - ya + 1);
    }
  }
  ctx.strokeStyle = state.lightMode ? 'rgba(21,48,77,0.35)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sxC, 0, exC - sxC, H);
}

// ── Order markers ─────────────────────────────────────────────────
function drawOrderMarkers() {
  if (!state.showOrders) return;
  const SCREEN_X = screenX();
  const [tickXc] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  // Use the centre wavelength in white-light mode, current λ in mono.
  const lam = state.mode === 'white' ? (WHITE_LMIN + WHITE_LMAX) / 2 : state.lambda;
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  const M = Math.floor(state.d / lam);
  for (let m = -M; m <= M; m++) {
    const sinTh = m * lam / state.d;
    if (Math.abs(sinTh) >= 0.999) continue;
    const tanTh = sinTh / Math.sqrt(1 - sinTh*sinTh);
    const yMM = CENTER_Y + state.L * tanTh;
    if (yMM < 4 || yMM > SCENE_H - 4) continue;
    const [, yc] = sceneToCanvas(0, yMM);
    ctx.fillStyle = state.lightMode ? '#1d4ed8' : '#5b8def';
    ctx.fillRect(tickXc - 9, yc - 1, 8, 2);
    ctx.fillStyle = state.lightMode ? '#15304d' : '#cdd9ee';
    ctx.fillText(`m=${m}`, tickXc - 12, yc);
  }
  ctx.textAlign = 'left';
}

// ── Cursor probe ──────────────────────────────────────────────────
function drawCursorProbe() {
  if (!state.showProbe || !state.cursor) return;
  const { x, y } = state.cursor;
  const SCREEN_X = screenX();
  if (x < SLIT_X || x > SCREEN_X) return;
  // Angle from the grating centre to the cursor
  const yRel = y - CENTER_Y;
  const xRel = x - SLIT_X;
  const r = Math.hypot(xRel, yRel);
  if (r < 1e-6) return;
  // Draw ray from grating centre through cursor
  const [s0x, s0y] = sceneToCanvas(SLIT_X, CENTER_Y);
  const [cx, cy]   = sceneToCanvas(x, y);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(13, 148, 136, 0.85)';
  ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#0d9488';
  ctx.fillStyle = 'rgba(13,148,136,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
}

// ── Derivation triangle ──────────────────────────────────────────
function defaultDerivY() {
  // First-order bright fringe above centre
  const lam = state.mode === 'white' ? (WHITE_LMIN + WHITE_LMAX) / 2 : state.lambda;
  const sinTh = lam / state.d;
  if (sinTh >= 0.999) return CENTER_Y - state.L * 0.4;
  const tanTh = sinTh / Math.sqrt(1 - sinTh*sinTh);
  return CENTER_Y - state.L * tanTh;
}

function getDerivY() {
  let y = state.derivY != null ? state.derivY : defaultDerivY();
  if (state.snapToFringe && !state.draggingP) {
    const lam = state.mode === 'white' ? (WHITE_LMIN + WHITE_LMAX) / 2 : state.lambda;
    const yRel = y - CENTER_Y;
    const tanTh = yRel / state.L;
    const sinTh = tanTh / Math.sqrt(1 + tanTh*tanTh);
    const m = Math.round(state.d * sinTh / lam);
    const sinSnap = m * lam / state.d;
    if (Math.abs(sinSnap) < 0.999) {
      const tanSnap = sinSnap / Math.sqrt(1 - sinSnap*sinSnap);
      y = CENTER_Y + state.L * tanSnap;
    }
  }
  return y;
}

function drawDerivation() {
  if (!state.showDeriv) return;
  const C = state.lightMode ? {
    axis: 'rgba(146, 64, 14, 0.55)', ray: '#b45309', perp: 'rgba(180, 83, 9, 0.85)',
    pSeg: '#92400e', rt: '#a16207', bracket: 'rgba(21,48,77,0.5)',
    label: '#78350f', pLabel: '#7c2d12', handleFill: '#f59e0b', handleStroke: '#15304d',
  } : {
    axis: 'rgba(255, 215, 130, 0.55)', ray: '#e8b246', perp: 'rgba(245, 212, 147, 0.85)',
    pSeg: '#fde68a', rt: '#f5d493', bracket: 'rgba(255,255,255,0.6)',
    label: '#fde68a', pLabel: '#fef3c7', handleFill: '#fde68a', handleStroke: '#1f2937',
  };
  const SCREEN_X = screenX();
  const yP = getDerivY();
  const ys = slitYs();
  // Adjacent pair near the centre of the grating
  const iA = Math.max(0, Math.floor(state.N / 2) - 1);
  const iB = iA + 1;
  const y1 = ys[iA], y2 = ys[iB];

  const [s1cx, s1cy] = sceneToCanvas(SLIT_X, y1);
  const [s2cx, s2cy] = sceneToCanvas(SLIT_X, y2);
  const [mcx, mcy]   = sceneToCanvas(SLIT_X, (y1 + y2) / 2);
  const [pcx, pcy]   = sceneToCanvas(SCREEN_X, yP);
  const [scx, scy]   = sceneToCanvas(SCREEN_X, (y1 + y2) / 2);

  // Central axis (dashed) from the midpoint of the chosen pair to the screen
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(mcx, mcy); ctx.lineTo(scx, scy); ctx.stroke();
  ctx.setLineDash([]);

  // Two rays slit→P
  ctx.strokeStyle = C.ray;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(s1cx, s1cy); ctx.lineTo(pcx, pcy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s2cx, s2cy); ctx.lineTo(pcx, pcy); ctx.stroke();

  // Path-difference triangle: drop perpendicular from CLOSER slit onto FURTHER's ray.
  const r1 = Math.hypot(SCREEN_X - SLIT_X, yP - y1);
  const r2 = Math.hypot(SCREEN_X - SLIT_X, yP - y2);
  const closer  = r1 < r2 ? { y: y1, cx: s1cx, cy: s1cy } : { y: y2, cx: s2cx, cy: s2cy };
  const further = r1 < r2 ? { y: y2, cx: s2cx, cy: s2cy } : { y: y1, cx: s1cx, cy: s1cy };

  const rayCDX = pcx - further.cx, rayCDY = pcy - further.cy;
  const rayCL = Math.hypot(rayCDX, rayCDY);
  const ucx = rayCDX / rayCL, ucy = rayCDY / rayCL;
  const cfX = closer.cx - further.cx, cfY = closer.cy - further.cy;
  const projC = cfX * ucx + cfY * ucy;
  const fcx = further.cx + projC * ucx;
  const fcy = further.cy + projC * ucy;

  ctx.strokeStyle = C.perp;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(closer.cx, closer.cy); ctx.lineTo(fcx, fcy); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.pSeg;
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(further.cx, further.cy); ctx.lineTo(fcx, fcy); ctx.stroke();

  // Right-angle marker
  let perpCX = -ucy, perpCY = ucx;
  if (perpCX * (closer.cx - fcx) + perpCY * (closer.cy - fcy) < 0) { perpCX = -perpCX; perpCY = -perpCY; }
  const tick = 7;
  ctx.strokeStyle = C.rt;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fcx - ucx * tick, fcy - ucy * tick);
  ctx.lineTo(fcx - ucx * tick + perpCX * tick, fcy - ucy * tick + perpCY * tick);
  ctx.lineTo(fcx + perpCX * tick, fcy + perpCY * tick);
  ctx.stroke();

  // d bracket between the two reference slits
  ctx.strokeStyle = C.bracket;
  ctx.lineWidth = 1;
  const bracketX = Math.min(s1cx, s2cx) - 22;
  ctx.beginPath();
  ctx.moveTo(bracketX, s1cy); ctx.lineTo(bracketX - 6, s1cy);
  ctx.moveTo(bracketX, s1cy); ctx.lineTo(bracketX, s2cy);
  ctx.moveTo(bracketX, s2cy); ctx.lineTo(bracketX - 6, s2cy);
  ctx.stroke();
  ctx.fillStyle = C.label;
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('d', bracketX - 9, (s1cy + s2cy) / 2);

  // L label
  ctx.fillStyle = C.label;
  ctx.textAlign = 'center';
  ctx.fillText('L', (mcx + scx) / 2, mcy - 8);

  // y label
  ctx.textAlign = 'left';
  ctx.fillStyle = C.label;
  const yMid = (scy + pcy) / 2;
  ctx.fillText('y', scx + 8, yMid);

  // θ marker at midpoint
  const ang0 = 0;
  const ang1 = Math.atan2(yP - (y1 + y2) / 2, SCREEN_X - SLIT_X);
  const arcR = 36;
  ctx.strokeStyle = C.label;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (ang1 < ang0) ctx.arc(mcx, mcy, arcR, ang1, ang0);
  else             ctx.arc(mcx, mcy, arcR, ang0, ang1);
  ctx.stroke();
  const labA = (ang0 + ang1) / 2;
  ctx.fillText('θ', mcx + Math.cos(labA) * (arcR + 10), mcy + Math.sin(labA) * (arcR + 10));

  // p label
  ctx.fillStyle = C.pLabel;
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillText('p = d sin θ', (further.cx + fcx) / 2 + 10, (further.cy + fcy) / 2);
  ctx.font = '13px "Trebuchet MS", sans-serif';

  // Drag handle on screen
  ctx.fillStyle = C.handleFill;
  ctx.strokeStyle = C.handleStroke;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(pcx, pcy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
}

function drawDarkBackdrop() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
}

// In white-light mode, the source emits incoherent broadband — no clean wavefronts,
// so we draw a uniform pale haze between source and plate that brightens as the
// "wave" reaches further. Visually says "light is heading toward the slits".
function renderPlaneWaveLeft() {
  const tElapsed = Math.max(0, state.t - state.t_on_source);
  const reach = tElapsed * WAVE_SPEED;
  const xLead = Math.min(SLIT_X, SOURCE_X + reach);
  if (xLead <= SOURCE_X) return;
  const [sxC] = sceneToCanvas(SOURCE_X, 0);
  const [exC] = sceneToCanvas(xLead, 0);
  const grad = ctx.createLinearGradient(sxC, 0, exC, 0);
  grad.addColorStop(0,    'rgba(248, 248, 244, 0.18)');
  grad.addColorStop(0.85, 'rgba(248, 248, 244, 0.10)');
  grad.addColorStop(1,    'rgba(248, 248, 244, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(sxC, 0, exC - sxC, H);
}

// ── Readouts ──────────────────────────────────────────────────────
function updateReadouts() {
  // Geometry readout
  const sin1 = state.lambda / state.d;
  if (Math.abs(sin1) < 0.999) {
    const th1 = Math.asin(sin1);
    $('rd-th1').textContent = `${(th1 * 180 / Math.PI).toFixed(2)}°`;
    const [dyV, dyU] = fmtScreenY(state.L * Math.tan(th1));
    $('rd-dy').textContent  = `${dyV} ${dyU}`;
  } else {
    $('rd-th1').textContent = '— (λ ≥ d)';
    $('rd-dy').textContent  = '—';
  }
  const mMax = Math.floor(state.d / state.lambda);
  $('rd-mmax').textContent = String(mMax);

  // Cursor probe
  if (state.showProbe && state.cursor) {
    const { x, y } = state.cursor;
    const SCREEN_X = screenX();
    if (x >= SLIT_X && x <= SCREEN_X) {
      const yRel = y - CENTER_Y;
      const xRel = x - SLIT_X;
      const tanTh = yRel / xRel;
      const sinTh = tanTh / Math.sqrt(1 + tanTh*tanTh);
      const thDeg = Math.atan(tanTh) * 180 / Math.PI;
      const lam = state.mode === 'white' ? (WHITE_LMIN + WHITE_LMAX) / 2 : state.lambda;
      const pl = state.d * Math.abs(sinTh) / lam;
      const f = pl - Math.round(pl);
      const [xv, xu] = fmtScreenY(x - SLIT_X);
      const [yv, yu] = fmtScreenY(y - CENTER_Y);
      $('rd-pos').textContent = `+${xv} ${xu}, ${y - CENTER_Y >= 0 ? '+' : ''}${yv} ${yu}`;
      $('rd-pth').textContent = `${thDeg.toFixed(2)}°`;
      $('rd-ppl').textContent = pl.toFixed(3);
      let v;
      if (Math.abs(f) < 0.05) v = 'constructive (≈ m)';
      else if (Math.abs(Math.abs(f) - 0.5) < 0.05) v = 'destructive';
      else v = 'between';
      $('rd-verd').textContent = v;
    } else {
      ['rd-pos','rd-pth','rd-ppl','rd-verd'].forEach(id => $(id).textContent = '—');
    }
  } else {
    ['rd-pos','rd-pth','rd-ppl','rd-verd'].forEach(id => $(id).textContent = '—');
  }

  // Derivation readout
  if (state.showDeriv) {
    const yP = getDerivY();
    const yRel = yP - CENTER_Y;
    const tanTh = yRel / state.L;
    const sinTh = tanTh / Math.sqrt(1 + tanTh*tanTh);
    const thDeg = Math.atan(tanTh) * 180 / Math.PI;
    const lam = state.mode === 'white' ? (WHITE_LMIN + WHITE_LMAX) / 2 : state.lambda;
    const p = state.d * Math.abs(sinTh);
    const pl = p / lam;
    const m = Math.round(pl);
    const [yv, yu] = fmtScreenY(Math.abs(yRel));
    const [pv, pu] = fmtP(p);
    $('rd-y').textContent  = `${yRel >= 0 ? '+' : '−'}${yv} ${yu}`;
    $('rd-th').textContent = `${thDeg.toFixed(2)}°`;
    $('rd-p').textContent  = `${pv} ${pu}`;
    $('rd-pl').textContent = pl.toFixed(3);
    $('rd-m').textContent  = String(m);
  }
}

// ── Main loop ─────────────────────────────────────────────────────
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (state.playing) state.t += dt * state.speed;

  if (state.mode === 'mono') {
    renderField();
    drawScreenStripMono();
  } else {
    // White light: render the plane wave on the LEFT (visual only — neutral white tint),
    // skip the right-side field, then draw the colour spectrum on the screen.
    drawDarkBackdrop();
    renderPlaneWaveLeft();
    drawScreenStripWhite();
  }
  drawSlitPlate();
  drawSource();
  drawOrderMarkers();
  drawDerivation();
  drawCursorProbe();
  updateReadouts();

  requestAnimationFrame(loop);
}

// ── Controls ──────────────────────────────────────────────────────
function bindSeg(id, key, onChange) {
  const wrap = $(id);
  wrap.querySelectorAll('.seg-btn').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = btn.dataset.val;
      if (onChange) onChange(btn.dataset.val);
    });
  });
}

function bindSlider(id, valId, key, fmt, onChange) {
  const sl = $(id), va = $(valId);
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    state[key] = v;
    va.textContent = fmt(v);
    if (onChange) onChange(v);
  });
}

function bindToggle(id, key, onChange) {
  const btn = $(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (onChange) onChange(state[key]);
  });
}

bindSeg('seg-mode', 'mode', m => onModeChange(m));
bindSlider('slider-N',      'val-N',      'N',      v => v.toFixed(0));
function bindUnitSlider(id, key, valId, unitId, fmt) {
  const sl = $(id);
  sl.addEventListener('input', () => {
    state[key] = parseFloat(sl.value);
    setSlider(key, valId, unitId, fmt);
  });
}
bindUnitSlider('slider-d',      'd',      'val-d',      'unit-d',      fmtSlit);
bindUnitSlider('slider-a',      'a',      'val-a',      'unit-a',      fmtSlit);
bindUnitSlider('slider-lambda', 'lambda', 'val-lambda', 'unit-lambda', fmtLambda);
bindUnitSlider('slider-L',      'L',      'val-L',      'unit-L',      fmtL);
bindSlider('slider-speed',  'val-speed',  'speed',  v => v.toFixed(2));
bindToggle('btn-real',   'realUnits', () => refreshUnits());
bindToggle('btn-light',  'lightMode', v => {
  // Light bg only meaningful in mono mode, but the toggle stays available either way.
  document.querySelector('.canvas-wrap').classList.toggle('light', v && state.mode === 'mono');
});
bindToggle('btn-orders', 'showOrders');
bindToggle('btn-deriv',  'showDeriv', v => { $('readout-deriv').style.display = v ? 'block' : 'none'; });
bindToggle('btn-probe',  'showProbe');

$('btn-snap').addEventListener('click', e => {
  state.snapToFringe = !state.snapToFringe;
  e.currentTarget.classList.toggle('playing', state.snapToFringe);
  e.currentTarget.textContent = state.snapToFringe ? 'Snap to fringe' : 'Free drag';
});

$('btn-play').addEventListener('click', e => {
  state.playing = !state.playing;
  e.currentTarget.classList.toggle('playing', state.playing);
  e.currentTarget.textContent = state.playing ? '■ Pause' : '▶ Play';
});
$('btn-reset').addEventListener('click', () => {
  state.t = 0;
  state.t_on_source = 0;
});

function onModeChange(m) {
  // Pause on mode swap so the teacher can set the scene first
  state.playing = false;
  const playBtn = $('btn-play');
  playBtn.classList.remove('playing');
  playBtn.textContent = '▶ Play';
  $('lambda-group').style.display = (m === 'mono') ? 'block' : 'none';
  document.querySelector('.canvas-wrap').classList.toggle('light', state.lightMode && m === 'mono');
}

function mouseToScene(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / rect.width  * W;
  const cy = (e.clientY - rect.top)  / rect.height * H;
  return [cx / W * SCENE_W, cy / H * SCENE_H];
}
canvas.addEventListener('mousedown', e => {
  if (!state.showDeriv) return;
  const [x, y] = mouseToScene(e);
  if (Math.abs(x - screenX()) < 4) { state.draggingP = true; state.derivY = y; e.preventDefault(); }
});
canvas.addEventListener('mousemove', e => {
  const [x, y] = mouseToScene(e);
  state.cursor = { x, y };
  if (state.draggingP) state.derivY = Math.max(2, Math.min(SCENE_H - 2, y));
});
canvas.addEventListener('mouseup',    () => { state.draggingP = false; });
canvas.addEventListener('mouseleave', () => { state.cursor = null; state.draggingP = false; });

requestAnimationFrame(loop);
