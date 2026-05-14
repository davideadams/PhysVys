// ── DOM & canvas ──────────────────────────────────────────────────
const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Backing buffer at lower resolution — drawImage scales up.
const BW = 380;
const BH = Math.round(BW * H / W);
const buf = document.createElement('canvas');
buf.width = BW; buf.height = BH;
const bctx = buf.getContext('2d');
const imgData = bctx.createImageData(BW, BH);
const pxData = imgData.data;

// ── Scene (mm) ────────────────────────────────────────────────────
const SCENE_W = 200;
const SCENE_H = SCENE_W * H / W;     // 8:5 aspect → 125 mm
const SOURCE_X = 6;
const SLIT_X   = 40;
const CENTER_Y = SCENE_H / 2;
const WAVE_SPEED = 30;               // mm per sim-second

// Plate / screen visual thicknesses (in mm)
const PLATE_W   = 1.6;
const SCREEN_W  = 2.0;

// ── State ─────────────────────────────────────────────────────────
const state = {
  mode: 'waves',
  d: 12, a: 1.0, lambda: 2.0, L: 110,
  slits: 'both',          // 'both' | 'topOnly' | 'botOnly'
  showDeriv: false,
  showFringes: false,
  showProbe: true,
  snapToFringe: true,
  playing: false,
  speed: 1.0,
  t: 0,
  t_on_source: 0,
  t_on1: 0,               // top slit
  t_on2: 0,               // bottom slit
  cursor: null,           // {x, y} in mm, or null
  derivY: null,           // P position on screen, in mm; null = "first bright fringe above centre"
  draggingP: false,

  // Bullets / electrons
  rate: 100,              // particles per second
  bullets: [],            // [{x, y, vx, vy}]
  bulletAccum: 0,
  histogram: null,        // Float32Array of N_BINS
  electronDots: [],       // [{y, jx}]  jx ∈ [0,1] for x-jitter on screen
  electronAccum: 0,
  detector: false,
  bulletScatter: true,
  showHistogram: false,
  hitCount: 0,
  hitsRecent: [],         // timestamps of recent hits, for live rate readout
};
const N_BINS = 80;
const BULLET_V = 100;     // mm/s — gun muzzle speed
const MAX_DOTS = 6000;
state.histogram = new Float32Array(N_BINS);

// ── Helpers ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sceneToCanvas = (x, y) => [x / SCENE_W * W, y / SCENE_H * H];
const canvasToScene = (cx, cy) => [cx / W * SCENE_W, cy / H * SCENE_H];

const slitsOpen = () => ({
  s1: state.slits === 'both' || state.slits === 'topOnly',
  s2: state.slits === 'both' || state.slits === 'botOnly',
});
const slitYs = () => ({
  y1: CENTER_Y - state.d / 2,
  y2: CENTER_Y + state.d / 2,
});
const screenX = () => SLIT_X + state.L;

// Far-field single-slit amplitude factor: sinc(π a sinθ / λ), sinθ = dy/r.
// Reduces to 1 in the slit's normal direction; first zero at sinθ = λ/a.
function slitEnv(dy, r) {
  if (state.a <= 0 || r <= 1e-6) return 1;
  const arg = Math.PI * state.a * dy / (state.lambda * r);
  if (Math.abs(arg) < 1e-6) return 1;
  return Math.sin(arg) / arg;
}

function syncSlitOnTimes() {
  const { s1, s2 } = slitsOpen();
  if (s1 && state.t_on1 === null) state.t_on1 = state.t;
  if (!s1) state.t_on1 = null;
  if (s2 && state.t_on2 === null) state.t_on2 = state.t;
  if (!s2) state.t_on2 = null;
}

// Default position of the derivation point P on the screen (first-order bright fringe above centre).
function defaultDerivY() {
  // d sin θ = λ → y = L tan(asin(λ/d)). Falls back gracefully if λ > d.
  const r = state.lambda / state.d;
  if (r >= 0.999) return CENTER_Y - state.L * 0.4;   // far off-axis fallback
  const sinTh = r;
  const tanTh = sinTh / Math.sqrt(1 - sinTh*sinTh);
  return CENTER_Y - state.L * tanTh;                // negative offset = above centre (smaller y)
}

function getDerivY() {
  let y = state.derivY != null ? state.derivY : defaultDerivY();
  if (state.snapToFringe && !state.draggingP) {
    // Snap to nearest bright-fringe y. Use exact d sin θ = mλ.
    const yRel = y - CENTER_Y;
    const tanTh = yRel / state.L;
    const sinTh = tanTh / Math.sqrt(1 + tanTh*tanTh);
    const m = Math.round(state.d * sinTh / state.lambda);
    // back-compute snapped y from integer m
    const sinSnap = m * state.lambda / state.d;
    if (Math.abs(sinSnap) < 0.999) {
      const tanSnap = sinSnap / Math.sqrt(1 - sinSnap*sinSnap);
      y = CENTER_Y + state.L * tanSnap;
    }
  }
  return y;
}

// ── Wave-field render ─────────────────────────────────────────────
function renderField() {
  const k = 2 * Math.PI / state.lambda;
  const w = WAVE_SPEED * k;
  const t = state.t;
  const tElapsed = Math.max(0, t - state.t_on_source);
  const reachSrc = tElapsed * WAVE_SPEED;
  const wt = w * tElapsed;
  const invLam = 1 / state.lambda;

  const { s1, s2 } = slitsOpen();
  const { y1, y2 } = slitYs();

  // Reach for slit-as-emitter (only counts time slit has been open).
  const reach1 = state.t_on1 !== null ? (t - state.t_on1) * WAVE_SPEED : -1;
  const reach2 = state.t_on2 !== null ? (t - state.t_on2) * WAVE_SPEED : -1;

  const dPlate = SLIT_X - SOURCE_X;
  const phaseRight = k * dPlate;     // common phase offset for right-side waves
  const SCREEN_X = screenX();

  let i = 0;
  for (let py = 0; py < BH; py++) {
    const y = (py + 0.5) / BH * SCENE_H;
    const dy1 = y - y1, dy1sq = dy1 * dy1;
    const dy2 = y - y2, dy2sq = dy2 * dy2;
    for (let px = 0; px < BW; px++) {
      const x = (px + 0.5) / BW * SCENE_W;

      let psi;
      if (x > SCREEN_X + 0.5) {
        psi = 0;                         // post-screen: black
      } else if (x < SLIT_X) {
        // Plane wave from the source
        const dxs = x - SOURCE_X;
        if (dxs < 0) {
          psi = 0;                       // left of source — quiet
        } else {
          let f = (reachSrc - dxs) * invLam;
          if (f < 0) f = 0; else if (f > 1) f = 1;
          psi = f * Math.sin(k*dxs - wt);
        }
      } else {
        // Right side: cylindrical waves from open slits, gated by both source and slit causality.
        let p = 0;
        const dxr = x - SLIT_X;
        const dxrsq = dxr * dxr;
        if (s1) {
          const r1 = Math.sqrt(dxrsq + dy1sq);
          let fs = (reachSrc - (dPlate + r1)) * invLam;
          if (fs < 0) fs = 0; else if (fs > 1) fs = 1;
          let fSlit = (reach1 - r1) * invLam;
          if (fSlit < 0) fSlit = 0; else if (fSlit > 1) fSlit = 1;
          const f = fs < fSlit ? fs : fSlit;
          p += f * slitEnv(dy1, r1) * Math.sin(k*r1 - wt + phaseRight);
        }
        if (s2) {
          const r2 = Math.sqrt(dxrsq + dy2sq);
          let fs = (reachSrc - (dPlate + r2)) * invLam;
          if (fs < 0) fs = 0; else if (fs > 1) fs = 1;
          let fSlit = (reach2 - r2) * invLam;
          if (fSlit < 0) fSlit = 0; else if (fSlit > 1) fSlit = 1;
          const f = fs < fSlit ? fs : fSlit;
          p += f * slitEnv(dy2, r2) * Math.sin(k*r2 - wt + phaseRight);
        }
        psi = p;
      }

      const v = psi * 0.5;       // ~[-1, 1]
      let r, g, b;
      if (v >= 0) {
        r = (14  + (220 - 14)  * v) | 0;
        g = (26  + (235 - 26)  * v) | 0;
        b = (48  + (255 - 48)  * v) | 0;
      } else {
        const u = -v;
        r = (14  + (4  - 14)  * u) | 0;
        g = (26  + (10 - 26)  * u) | 0;
        b = (48  + (22 - 48)  * u) | 0;
      }
      pxData[i++] = r; pxData[i++] = g; pxData[i++] = b; pxData[i++] = 255;
    }
  }
  bctx.putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf, 0, 0, W, H);
}

// ── Source bar, slit plate, screen strip ──────────────────────────
function drawSource() {
  const [sxC, ] = sceneToCanvas(SOURCE_X, 0);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(sxC - 2, 0, 3, H);
  ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
  ctx.fillRect(sxC + 1, 0, 8, H);
}

function drawSlitPlate() {
  const [pxC] = sceneToCanvas(SLIT_X - PLATE_W/2, 0);
  const [pxR] = sceneToCanvas(SLIT_X + PLATE_W/2, 0);
  const wPlate = pxR - pxC;
  const { y1, y2 } = slitYs();
  const { s1, s2 } = slitsOpen();
  const halfA = state.a / 2;

  // Build vertical segments of the plate by subtracting open-slit gaps from the full bar.
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
  if (s1) subtract(y1 - halfA, y1 + halfA);
  if (s2) subtract(y2 - halfA, y2 + halfA);

  ctx.fillStyle = '#1f2937';
  for (const [a, b] of segs) {
    const [, ya] = sceneToCanvas(0, a);
    const [, yb] = sceneToCanvas(0, b);
    ctx.fillRect(pxC, ya, wPlate, yb - ya);
  }
}

function drawScreenStrip() {
  const SCREEN_X = screenX();
  const k = 2 * Math.PI / state.lambda;
  const reachSrc = Math.max(0, state.t - state.t_on_source) * WAVE_SPEED;
  const reach1 = state.t_on1 !== null ? (state.t - state.t_on1) * WAVE_SPEED : -1;
  const reach2 = state.t_on2 !== null ? (state.t - state.t_on2) * WAVE_SPEED : -1;
  const invLam = 1 / state.lambda;
  const dPlate = SLIT_X - SOURCE_X;
  const { s1, s2 } = slitsOpen();
  const { y1, y2 } = slitYs();
  const a1 = s1 ? 1 : 0, a2 = s2 ? 1 : 0;
  const dx = SCREEN_X - SLIT_X;
  const dxsq = dx * dx;

  const [sxC, ] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [exC, ] = sceneToCanvas(SCREEN_X + SCREEN_W/2, 0);
  ctx.fillStyle = '#050b18';
  ctx.fillRect(sxC, 0, exC - sxC, H);

  const N = 240;
  for (let i = 0; i < N; i++) {
    const y0 = i / N * SCENE_H;
    const y1p = (i + 1) / N * SCENE_H;
    const ym = (y0 + y1p) * 0.5;

    let A1 = 0, A2 = 0, r1 = 0, r2 = 0;
    if (a1) {
      r1 = Math.sqrt(dxsq + (ym - y1)*(ym - y1));
      let fs = (reachSrc - (dPlate + r1)) * invLam;
      if (fs < 0) fs = 0; else if (fs > 1) fs = 1;
      let fS = (reach1 - r1) * invLam;
      if (fS < 0) fS = 0; else if (fS > 1) fS = 1;
      A1 = (fs < fS ? fs : fS) * slitEnv(ym - y1, r1);
    }
    if (a2) {
      r2 = Math.sqrt(dxsq + (ym - y2)*(ym - y2));
      let fs = (reachSrc - (dPlate + r2)) * invLam;
      if (fs < 0) fs = 0; else if (fs > 1) fs = 1;
      let fS = (reach2 - r2) * invLam;
      if (fS < 0) fS = 0; else if (fS > 1) fS = 1;
      A2 = (fs < fS ? fs : fS) * slitEnv(ym - y2, r2);
    }
    let I;
    if (a1 && a2) I = A1*A1 + A2*A2 + 2*A1*A2*Math.cos(k*(r2 - r1));
    else          I = A1*A1 + A2*A2;
    const v = I * 0.25;
    const r = (255 * Math.min(1, v * 1.25)) | 0;
    const g = (190 * v) | 0;
    const b = (55  * v) | 0;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const [, ya] = sceneToCanvas(0, y0);
    const [, yb] = sceneToCanvas(0, y1p);
    ctx.fillRect(sxC, ya, exC - sxC, yb - ya + 1);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sxC, 0, exC - sxC, H);
}

// ── Fringe markers on the screen ──────────────────────────────────
function drawFringeMarkers() {
  if (!state.showFringes) return;
  const { s1, s2 } = slitsOpen();
  if (!(s1 && s2)) return;          // only meaningful with two open slits
  const SCREEN_X = screenX();
  const [tickXc] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  ctx.font = '11px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  const M = 12;
  for (let m = -M; m <= M; m++) {
    const sinTh = m * state.lambda / state.d;
    if (Math.abs(sinTh) >= 0.999) continue;
    const tanTh = sinTh / Math.sqrt(1 - sinTh*sinTh);
    const yMM = CENTER_Y + state.L * tanTh;
    if (yMM < 4 || yMM > SCENE_H - 4) continue;
    const [, yc] = sceneToCanvas(0, yMM);
    ctx.fillStyle = '#5b8def';
    ctx.fillRect(tickXc - 9, yc - 1, 8, 2);
    ctx.fillStyle = '#cdd9ee';
    ctx.fillText(`m=${m}`, tickXc - 12, yc);
  }
  ctx.textAlign = 'left';
}

// ── Cursor probe ──────────────────────────────────────────────────
function drawCursorProbe() {
  if (!state.showProbe || !state.cursor) return;
  const { x, y } = state.cursor;
  const SCREEN_X = screenX();
  if (x < SLIT_X || x > SCREEN_X) return;        // probe only meaningful in interference region
  const { y1, y2 } = slitYs();
  const r1 = Math.hypot(x - SLIT_X, y - y1);
  const r2 = Math.hypot(x - SLIT_X, y - y2);
  const [cx, cy]   = sceneToCanvas(x, y);
  const [s1cx, s1cy] = sceneToCanvas(SLIT_X, y1);
  const [s2cx, s2cy] = sceneToCanvas(SLIT_X, y2);
  const pxPerMm = W / SCENE_W;

  ctx.setLineDash([4, 4]); ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(13, 148, 136, 0.85)';
  ctx.beginPath(); ctx.arc(s1cx, s1cy, r1 * pxPerMm, 0, 2*Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(s2cx, s2cy, r2 * pxPerMm, 0, 2*Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#0d9488'; ctx.fillStyle = 'rgba(13,148,136,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
}

// ── Derivation triangle overlay ───────────────────────────────────
function drawDerivation() {
  if (!state.showDeriv) return;
  const SCREEN_X = screenX();
  const yP = getDerivY();
  const { y1, y2 } = slitYs();
  const midY = CENTER_Y;

  const [s1cx, s1cy] = sceneToCanvas(SLIT_X, y1);
  const [s2cx, s2cy] = sceneToCanvas(SLIT_X, y2);
  const [mcx, mcy]   = sceneToCanvas(SLIT_X, midY);
  const [pcx, pcy]   = sceneToCanvas(SCREEN_X, yP);
  const [scx, scy]   = sceneToCanvas(SCREEN_X, midY);

  // Central axis (dashed)
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(255, 215, 130, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(mcx, mcy); ctx.lineTo(scx, scy); ctx.stroke();
  ctx.setLineDash([]);

  // Two rays slit→P
  ctx.strokeStyle = '#e8b246';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(s1cx, s1cy); ctx.lineTo(pcx, pcy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s2cx, s2cy); ctx.lineTo(pcx, pcy); ctx.stroke();

  // Drop perpendicular from CLOSER slit onto the FURTHER slit's ray to P.
  // That puts the path-difference segment on the *longer* ray, length ≈ d sin θ.
  const r1 = Math.hypot(SCREEN_X - SLIT_X, yP - y1);
  const r2 = Math.hypot(SCREEN_X - SLIT_X, yP - y2);
  const closer  = r1 < r2 ? { y: y1, cx: s1cx, cy: s1cy } : { y: y2, cx: s2cx, cy: s2cy };
  const further = r1 < r2 ? { y: y2, cx: s2cx, cy: s2cy } : { y: y1, cx: s1cx, cy: s1cy };

  // Further-slit's ray direction (in canvas pixels — scene scale is uniform 8:5).
  const rayCDX = pcx - further.cx;
  const rayCDY = pcy - further.cy;
  const rayCL = Math.hypot(rayCDX, rayCDY);
  const ucx = rayCDX / rayCL, ucy = rayCDY / rayCL;

  // Vector from further to closer in canvas pixels
  const cfX = closer.cx - further.cx;
  const cfY = closer.cy - further.cy;
  const projC = cfX * ucx + cfY * ucy;        // canvas-pixel length of the path-difference segment

  const fcx = further.cx + projC * ucx;
  const fcy = further.cy + projC * ucy;

  // Perpendicular dropped from CLOSER slit to foot (visualises the "≈ parallel rays" trick)
  ctx.strokeStyle = 'rgba(245, 212, 147, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(closer.cx, closer.cy);
  ctx.lineTo(fcx, fcy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Path-difference segment (further-slit → foot) — bright and bold
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(further.cx, further.cy);
  ctx.lineTo(fcx, fcy);
  ctx.stroke();

  // Right-angle marker at the foot, using the ray direction and the perpendicular.
  let perpCX = -ucy, perpCY = ucx;
  if (perpCX * (closer.cx - fcx) + perpCY * (closer.cy - fcy) < 0) { perpCX = -perpCX; perpCY = -perpCY; }
  const tick = 7;
  ctx.strokeStyle = '#f5d493';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fcx - ucx * tick,                    fcy - ucy * tick);
  ctx.lineTo(fcx - ucx * tick + perpCX * tick,    fcy - ucy * tick + perpCY * tick);
  ctx.lineTo(fcx + perpCX * tick,                 fcy + perpCY * tick);
  ctx.stroke();

  // Slit-separation bracket (between slits) labelled d
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  const bracketX = s1cx - 22;
  ctx.beginPath();
  ctx.moveTo(bracketX,    s1cy); ctx.lineTo(bracketX - 6, s1cy);
  ctx.moveTo(bracketX,    s1cy); ctx.lineTo(bracketX,    s2cy);
  ctx.moveTo(bracketX,    s2cy); ctx.lineTo(bracketX - 6, s2cy);
  ctx.stroke();
  ctx.fillStyle = '#fde68a';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('d', bracketX - 9, (s1cy + s2cy) / 2);

  // L label along central axis
  ctx.fillStyle = 'rgba(255,215,130,0.85)';
  ctx.textAlign = 'center';
  ctx.fillText('L', (mcx + scx) / 2, mcy - 8);

  // y label on the screen between centre and P
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fde68a';
  const yMid = (scy + pcy) / 2;
  ctx.fillText('y', scx + 8, yMid);

  // θ angle marker at midpoint of slits
  const thetaDX = SCREEN_X - SLIT_X;
  const thetaDY = yP - midY;
  const thetaR = Math.hypot(thetaDX, thetaDY);
  const arcR = 36;
  const ang0 = 0;                          // along +x (toward screen centre)
  const ang1 = Math.atan2(thetaDY * (H/SCENE_H), thetaDX * (W/SCENE_W));   // canvas-pixel angle
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (ang1 < ang0) ctx.arc(mcx, mcy, arcR, ang1, ang0);
  else             ctx.arc(mcx, mcy, arcR, ang0, ang1);
  ctx.stroke();
  ctx.textAlign = 'left';
  const labA = (ang0 + ang1) / 2;
  ctx.fillText('θ', mcx + Math.cos(labA) * (arcR + 10), mcy + Math.sin(labA) * (arcR + 10));

  // p label near the path-difference segment (middle of it)
  const labelX = (further.cx + fcx) / 2 + 10;
  const labelY = (further.cy + fcy) / 2;
  ctx.fillStyle = '#fef3c7';
  ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
  ctx.fillText('p = d sin θ', labelX, labelY);
  ctx.font = '13px "Trebuchet MS", sans-serif';

  // Draggable handle on the screen at P
  ctx.fillStyle = '#fde68a';
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(pcx, pcy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
}

// ── Readouts ──────────────────────────────────────────────────────
function updateReadouts() {
  // Geometry readout (always)
  const dy = state.lambda * state.L / state.d;
  $('rd-dy').textContent = (state.mode === 'bullets') ? '— (no λ)' : `${dy.toFixed(2)} mm`;
  const sin1 = state.lambda / state.d;
  if (Math.abs(sin1) < 0.999) {
    const th1 = Math.asin(sin1) * 180 / Math.PI;
    $('rd-th1').textContent = `${th1.toFixed(2)}°`;
  } else {
    $('rd-th1').textContent = '— (λ ≥ d)';
  }

  // Cursor probe readout
  if (state.cursor) {
    const { x, y } = state.cursor;
    const SCREEN_X = screenX();
    const inField = x >= SLIT_X && x <= SCREEN_X;
    if (inField) {
      const { y1, y2 } = slitYs();
      const r1 = Math.hypot(x - SLIT_X, y - y1);
      const r2 = Math.hypot(x - SLIT_X, y - y2);
      const p = Math.abs(r2 - r1);
      const m = p / state.lambda;
      const f = m - Math.round(m);
      $('rd-pos').textContent = `${x.toFixed(1)}, ${y.toFixed(1)} mm`;
      $('rd-r1').textContent  = `${r1.toFixed(1)} mm`;
      $('rd-r2').textContent  = `${r2.toFixed(1)} mm`;
      $('rd-pd').textContent  = `${p.toFixed(2)} mm`;
      const { s1, s2 } = slitsOpen();
      let v;
      if (!(s1 && s2)) v = 'single source';
      else if (Math.abs(f) < 0.05) v = 'constructive';
      else if (Math.abs(Math.abs(f) - 0.5) < 0.05) v = 'destructive';
      else v = 'between';
      $('rd-verd').textContent = v;
    } else {
      ['rd-pos','rd-r1','rd-r2','rd-pd','rd-verd'].forEach(id => $(id).textContent = '—');
    }
  } else {
    ['rd-pos','rd-r1','rd-r2','rd-pd','rd-verd'].forEach(id => $(id).textContent = '—');
  }

  // Particle hit readout (bullets / electrons)
  if (state.mode !== 'waves') {
    $('rd-hits').textContent = String(state.hitCount);
    const now = performance.now();
    while (state.hitsRecent.length && now - state.hitsRecent[0] > 1500) state.hitsRecent.shift();
    const r = state.hitsRecent.length / 1.5;
    $('rd-rate').textContent = `${r.toFixed(0)} /s`;
  }

  // Derivation readout
  if (state.showDeriv) {
    const yP = getDerivY();
    const yRel = yP - CENTER_Y;
    const tanTh = yRel / state.L;
    const sinTh = tanTh / Math.sqrt(1 + tanTh*tanTh);
    const thDeg = Math.atan(tanTh) * 180 / Math.PI;
    const p = state.d * Math.abs(sinTh);
    const pl = p / state.lambda;
    const pApp = state.d * Math.abs(yRel) / state.L;
    const m = Math.round(pl);
    $('rd-y').textContent  = `${yRel >= 0 ? '+' : ''}${yRel.toFixed(2)} mm`;
    $('rd-th').textContent = `${thDeg.toFixed(2)}°`;
    $('rd-p').textContent  = `${p.toFixed(3)} mm`;
    $('rd-pl').textContent = pl.toFixed(3);
    $('rd-m').textContent  = String(m);
    $('rd-papp').textContent = `${pApp.toFixed(3)} mm`;
  }
}

// ── Bullets mode ──────────────────────────────────────────────────
function gaussian() {
  // Box-Muller — single sample
  let u1 = Math.random(); if (u1 < 1e-9) u1 = 1e-9;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
}

function spawnBullet() {
  // Narrow Gaussian gun y, wider Gaussian angle. The tight gun y means bullets that
  // pass through a slit have nearly determined angle, giving Gaussian bumps on the
  // screen centred at y_slit·(dScreen/dPlate) instead of flat-topped slabs.
  const dPlate = SLIT_X - SOURCE_X;
  const sigmaY = state.d * 0.15;
  const sigmaTheta = Math.atan2(state.d * 0.7, dPlate);
  const yGun = CENTER_Y + gaussian() * sigmaY;
  const theta = gaussian() * sigmaTheta;
  const v = BULLET_V;
  state.bullets.push({
    x: SOURCE_X, y: yGun,
    vx: v * Math.cos(theta), vy: v * Math.sin(theta),
  });
}

function stepBullets(dt) {
  if (dt <= 0) return;
  state.bulletAccum += state.rate * dt;
  while (state.bulletAccum >= 1) { state.bulletAccum -= 1; spawnBullet(); }

  const SCREEN_X = screenX();
  const { y1, y2 } = slitYs();
  const halfA = state.a / 2;
  const { s1, s2 } = slitsOpen();

  const survivors = [];
  for (const b of state.bullets) {
    const xPrev = b.x;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Plate crossing
    if (xPrev < SLIT_X && b.x >= SLIT_X) {
      const yAtPlate = b.y - b.vy * ((b.x - SLIT_X) / b.vx);
      const inS1 = s1 && Math.abs(yAtPlate - y1) <= halfA;
      const inS2 = s2 && Math.abs(yAtPlate - y2) <= halfA;
      if (!inS1 && !inS2) continue;     // absorbed by plate

      // Slit-edge ricochet: bullets that pass near the slit edge get a small angular kick.
      // Centre passes go straight (edgeFrac = 0); edge grazes scatter most (|edgeFrac| → 1).
      if (state.bulletScatter) {
        const slitC = inS1 ? y1 : y2;
        const edgeFrac = (yAtPlate - slitC) / halfA;
        const sigmaMax = Math.atan2(state.a * 1.6, SLIT_X - SOURCE_X);
        const sigma = Math.abs(edgeFrac) * sigmaMax;
        if (sigma > 0) {
          const v = Math.hypot(b.vx, b.vy);
          const oldTheta = Math.atan2(b.vy, b.vx);
          const newTheta = oldTheta + gaussian() * sigma;
          b.vx = v * Math.cos(newTheta);
          b.vy = v * Math.sin(newTheta);
        }
      }
    }
    // Screen crossing
    if (b.x >= SCREEN_X) {
      const yAtScreen = b.y - b.vy * ((b.x - SCREEN_X) / b.vx);
      recordHit(yAtScreen);
      continue;
    }
    // Off scene
    if (b.y < -5 || b.y > SCENE_H + 5 || b.x > SCENE_W) continue;
    survivors.push(b);
  }
  state.bullets = survivors;
}

function drawBullets() {
  ctx.fillStyle = '#facc15';
  for (const b of state.bullets) {
    const [cx, cy] = sceneToCanvas(b.x, b.y);
    ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, 2 * Math.PI); ctx.fill();
  }
}

function drawHistogramBars(alpha) {
  const SCREEN_X = screenX();
  const [sxStripL] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [barLeft]  = sceneToCanvas(SCREEN_X - 22, 0);   // bars extend 22 mm leftward into the field
  let maxC = 1;
  for (const c of state.histogram) if (c > maxC) maxC = c;
  const binPx = H / N_BINS;
  ctx.fillStyle = `rgba(250, 204, 21, ${alpha})`;
  for (let i = 0; i < N_BINS; i++) {
    const c = state.histogram[i];
    if (c <= 0) continue;
    const w = (c / maxC) * (sxStripL - barLeft);
    ctx.fillRect(sxStripL - w, i * binPx, w, binPx + 0.5);
  }
}

function drawHistogram() {
  const SCREEN_X = screenX();
  const [sxStripL] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [sxStripR] = sceneToCanvas(SCREEN_X + SCREEN_W/2, 0);
  // Backdrop strip (the "screen")
  ctx.fillStyle = '#050b18';
  ctx.fillRect(sxStripL, 0, sxStripR - sxStripL, H);
  drawHistogramBars(0.85);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sxStripL, 0, sxStripR - sxStripL, H);
}

// ── Electrons mode ────────────────────────────────────────────────
function intensityAt(yScreen) {
  const k = 2 * Math.PI / state.lambda;
  const SCREEN_X = screenX();
  const dx = SCREEN_X - SLIT_X;
  const { y1, y2 } = slitYs();
  const { s1, s2 } = slitsOpen();
  let A1 = 0, A2 = 0, r1 = 0, r2 = 0;
  if (s1) { r1 = Math.hypot(dx, yScreen - y1); A1 = slitEnv(yScreen - y1, r1); }
  if (s2) { r2 = Math.hypot(dx, yScreen - y2); A2 = slitEnv(yScreen - y2, r2); }
  if (s1 && s2) return A1*A1 + A2*A2 + 2*A1*A2 * Math.cos(k * (r2 - r1));
  return A1*A1 + A2*A2;
}

function sampleElectronY_interference() {
  const I_max = 4.0;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * SCENE_H;
    const I = intensityAt(y);
    if (Math.random() * I_max < I) return y;
  }
  return null;
}

function sampleElectronY_detector() {
  // Same gun/slit geometry as bullets, but compute screen y directly:
  // pick gun y (Gaussian), pick where in the slit gap the electron passed (uniform),
  // then project to the screen.
  const { s1, s2 } = slitsOpen();
  if (!s1 && !s2) return null;
  const { y1, y2 } = slitYs();
  const ySlit = (s1 && s2) ? (Math.random() < 0.5 ? y1 : y2) : (s1 ? y1 : y2);
  const halfA = state.a / 2;
  const dPlate = SLIT_X - SOURCE_X;
  const dScreen = screenX() - SOURCE_X;
  const sigmaY = state.d * 0.15;
  const yGun = CENTER_Y + gaussian() * sigmaY;
  const yAtSlit = ySlit + (Math.random() * 2 - 1) * halfA;
  const theta = (yAtSlit - yGun) / dPlate;
  return yGun + theta * dScreen;
}

function stepElectrons(dt) {
  if (dt <= 0) return;
  state.electronAccum += state.rate * dt;
  while (state.electronAccum >= 1) {
    state.electronAccum -= 1;
    const y = state.detector ? sampleElectronY_detector() : sampleElectronY_interference();
    if (y == null || y < 0 || y > SCENE_H) continue;
    state.electronDots.push({ y, jx: Math.random() });
    if (state.electronDots.length > MAX_DOTS) state.electronDots.shift();
    recordHit(y);
  }
}

function drawElectronDots() {
  const SCREEN_X = screenX();
  const [sxStripL] = sceneToCanvas(SCREEN_X - SCREEN_W/2, 0);
  const [sxStripR] = sceneToCanvas(SCREEN_X + SCREEN_W/2, 0);
  // Backdrop
  ctx.fillStyle = '#050b18';
  ctx.fillRect(sxStripL, 0, sxStripR - sxStripL, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sxStripL, 0, sxStripR - sxStripL, H);
  // Dots
  ctx.fillStyle = '#facc15';
  for (const d of state.electronDots) {
    const [, yc] = sceneToCanvas(0, d.y);
    const x = sxStripL + d.jx * (sxStripR - sxStripL);
    ctx.beginPath(); ctx.arc(x, yc, 1.4, 0, 2 * Math.PI); ctx.fill();
  }
}

// ── Hit recording (shared bullets/electrons) ──────────────────────
function recordHit(y) {
  if (y < 0 || y > SCENE_H) return;
  const bin = Math.floor(y / SCENE_H * N_BINS);
  if (bin >= 0 && bin < N_BINS) state.histogram[bin] += 1;
  state.hitCount += 1;
  state.hitsRecent.push(performance.now());
  if (state.hitsRecent.length > 200) state.hitsRecent.shift();
}

function clearScreen() {
  state.bullets = [];
  state.electronDots = [];
  state.histogram = new Float32Array(N_BINS);
  state.hitCount = 0;
  state.hitsRecent = [];
  state.bulletAccum = 0;
  state.electronAccum = 0;
}

function drawDarkBackdrop() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
}

// ── Main loop ─────────────────────────────────────────────────────
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const stepDt = state.playing ? dt * state.speed : 0;
  if (state.playing) state.t += stepDt;
  syncSlitOnTimes();

  if (state.mode === 'waves') {
    renderField();
    drawScreenStrip();
  } else {
    drawDarkBackdrop();
    if (state.mode === 'bullets') {
      stepBullets(stepDt);
      drawHistogram();
      drawBullets();
    } else if (state.mode === 'electrons') {
      stepElectrons(stepDt);
      drawElectronDots();
      if (state.showHistogram) drawHistogramBars(0.7);
    }
  }
  drawSlitPlate();
  drawSource();
  if (state.mode === 'waves') {
    drawFringeMarkers();
    drawDerivation();
    drawCursorProbe();
  }
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
bindSeg('seg-mode',  'mode', () => onModeChange());
bindSeg('seg-slits', 'slits', () => { updateSingleSlitGating(); clearScreen(); });

function onModeChange() {
  clearScreen();
  // Pause on mode switch so the teacher can set the scene before pressing play.
  state.playing = false;
  const playBtn = $('btn-play');
  playBtn.classList.remove('playing');
  playBtn.textContent = '▶ Play';
  const m = state.mode;
  const noteEl = document.querySelector('.scene-note');
  if (noteEl) {
    noteEl.textContent =
      m === 'bullets'   ? 'Wide gun fires erratically; only bullets that pass through a slit reach the screen.'
    : m === 'electrons' ? (state.detector ? 'Which-path detector ON — pattern collapses to two bumps.' : 'No detector — each electron lands at random, but the pattern is the wave intensity.')
    :                     'Hover the field to probe · drag P on the screen for the derivation triangle';
  }
  // Mode-appropriate default rates: bullets fast, electrons slow so the pattern builds visibly.
  if (m === 'bullets')   { state.rate = 100; $('slider-rate').value = 100; $('val-rate').value = '100'; }
  if (m === 'electrons') { state.rate = 10;  $('slider-rate').value = 10;  $('val-rate').value = '10';  }
  $('particle-controls').style.display = (m === 'waves') ? 'none' : 'block';
  $('bullets-toggles').style.display   = (m === 'bullets')   ? 'flex' : 'none';
  $('electron-toggles').style.display  = (m === 'electrons') ? 'flex' : 'none';
  $('overlays-group').style.display    = (m === 'waves') ? 'block' : 'none';
  $('lambda-group').style.display      = (m === 'bullets') ? 'none' : 'block';
  $('readout-probe').style.display     = (m === 'waves') ? 'block' : 'none';
  $('readout-particles').style.display = (m === 'waves') ? 'none' : 'block';
  // If derivation/fringes were on in waves, hide their readout when leaving
  if (m !== 'waves' && state.showDeriv) {
    state.showDeriv = false;
    $('btn-deriv').classList.remove('active');
    $('readout-deriv').style.display = 'none';
  }
}

// Derivation triangle and fringe markers are only meaningful with two slits open.
function updateSingleSlitGating() {
  const both = state.slits === 'both';
  for (const id of ['btn-deriv', 'btn-fringes']) {
    const btn = $(id);
    btn.disabled = !both;
    btn.classList.toggle('disabled', !both);
    if (!both && state[id === 'btn-deriv' ? 'showDeriv' : 'showFringes']) {
      // force-off + reflect in UI
      if (id === 'btn-deriv') {
        state.showDeriv = false;
        $('readout-deriv').style.display = 'none';
      } else {
        state.showFringes = false;
      }
      btn.classList.remove('active');
    }
  }
}

function bindSlider(id, valId, key, fmt, onChange) {
  const sl = $(id), va = $(valId);
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    state[key] = v;
    va.value = fmt(v);
    if (onChange) onChange(v);
  });
  va.addEventListener('change', () => {
    const raw = parseFloat(va.value);
    if (isNaN(raw)) { va.value = fmt(state[key]); return; }
    const lo = parseFloat(sl.min), hi = parseFloat(sl.max);
    const v = Math.max(lo, Math.min(hi, raw));
    state[key] = v;
    sl.value = v;
    va.value = fmt(v);
    if (onChange) onChange(v);
  });
}
bindSlider('slider-d',      'val-d',      'd',      v => v.toFixed(1), () => clearScreen());
bindSlider('slider-a',      'val-a',      'a',      v => v.toFixed(1), () => clearScreen());
bindSlider('slider-lambda', 'val-lambda', 'lambda', v => v.toFixed(1), () => clearScreen());
bindSlider('slider-L',      'val-L',      'L',      v => v.toFixed(0), () => clearScreen());
bindSlider('slider-speed',  'val-speed',  'speed',  v => v.toFixed(2));
bindSlider('slider-rate',   'val-rate',   'rate',   v => v.toFixed(0));

$('btn-clear').addEventListener('click', clearScreen);
$('btn-ricochet').addEventListener('click', e => {
  state.bulletScatter = !state.bulletScatter;
  e.currentTarget.classList.toggle('active', state.bulletScatter);
  clearScreen();
});

$('btn-histogram').addEventListener('click', e => {
  state.showHistogram = !state.showHistogram;
  e.currentTarget.classList.toggle('active', state.showHistogram);
});

$('btn-detector').addEventListener('click', e => {
  state.detector = !state.detector;
  e.currentTarget.classList.toggle('active', state.detector);
  clearScreen();
  const noteEl = document.querySelector('.scene-note');
  if (noteEl) noteEl.textContent = state.detector
    ? 'Which-path detector ON — pattern collapses to two bumps.'
    : 'No detector — each electron lands at random, but the pattern is the wave intensity.';
});

function bindToggle(id, key, onChange) {
  const btn = $(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (onChange) onChange(state[key]);
  });
}
bindToggle('btn-deriv',   'showDeriv', v => {
  $('readout-deriv').style.display = v ? 'block' : 'none';
});
bindToggle('btn-fringes', 'showFringes');
bindToggle('btn-probe',   'showProbe');

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
  const { s1, s2 } = slitsOpen();
  state.t_on1 = s1 ? 0 : null;
  state.t_on2 = s2 ? 0 : null;
});

// ── Mouse handling: cursor probe + draggable P ────────────────────
function mouseToScene(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / rect.width  * W;
  const cy = (e.clientY - rect.top)  / rect.height * H;
  return canvasToScene(cx, cy);
}

canvas.addEventListener('mousedown', e => {
  if (!state.showDeriv) return;
  const [x, y] = mouseToScene(e);
  const SCREEN_X = screenX();
  if (Math.abs(x - SCREEN_X) < 4) {
    state.draggingP = true;
    state.derivY = y;
    e.preventDefault();
  }
});
canvas.addEventListener('mousemove', e => {
  const [x, y] = mouseToScene(e);
  state.cursor = { x, y };
  if (state.draggingP) {
    state.derivY = Math.max(2, Math.min(SCENE_H - 2, y));
  }
});
canvas.addEventListener('mouseup', () => { state.draggingP = false; });
canvas.addEventListener('mouseleave', () => {
  state.cursor = null;
  state.draggingP = false;
});

// Honour ?mode=… in the URL so the same page can be linked from 3.1 (default waves)
// or 3.2 (electrons) with the right starting mode.
{
  const params = new URLSearchParams(window.location.search);
  const m = params.get('mode');
  if (m === 'bullets' || m === 'waves' || m === 'electrons') {
    document.querySelectorAll('#seg-mode .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === m);
    });
    state.mode = m;
    onModeChange();
  }
}

requestAnimationFrame(loop);
