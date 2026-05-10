// ── DOM & canvas ──────────────────────────────────────────────────
const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

// Backing buffer at lower resolution — drawImage will scale up.
const BW = 320;
const BH = Math.round(BW * H / W);   // 320 × 213
const buf = document.createElement('canvas');
buf.width = BW; buf.height = BH;
const bctx = buf.getContext('2d');
const imgData = bctx.createImageData(BW, BH);
const pxData = imgData.data;

// ── Scene (mm) ────────────────────────────────────────────────────
const SCENE_W = 200;
const SCENE_H = SCENE_W * H / W;     // ≈ 133.33 mm
const SOURCE_X = 0;                  // sources sit on the left edge; only their right halves show
const CENTER_Y = SCENE_H / 2;
const WAVE_SPEED = 30;               // mm/s — animation pace only

// ── State ─────────────────────────────────────────────────────────
const state = {
  d: 40,
  lambda: 12,
  phaseMode: 'in',       // 'in' | 'anti' | 'custom'
  phaseCustom: 0,
  active: 'both',        // 'both' | 'top' | 'bot'
  view: 'wave',          // 'wave' | 'int' | 'both'
  showAnti: false,
  showNode: false,
  showProbe: true,
  showScreen: false,
  playing: true,
  speed: 1.0,
  t: 0,
  t_on1: 0,              // wall-clock sim time when source 1 was turned on (null = off)
  t_on2: 0,
  cursor: null
};

const getPhaseRel = () =>
  state.phaseMode === 'in' ? 0 :
  state.phaseMode === 'anti' ? Math.PI :
  state.phaseCustom;

const sourceAmps = () => ({
  a1: (state.active === 'both' || state.active === 'top') ? 1 : 0,
  a2: (state.active === 'both' || state.active === 'bot') ? 1 : 0,
});

const sceneToCanvas = (x, y) => [x / SCENE_W * W, y / SCENE_H * H];

// Keep t_on values in sync with which sources are currently active.
function syncSourceOnTimes() {
  const { a1, a2 } = sourceAmps();
  if (a1 > 0 && state.t_on1 === null) state.t_on1 = state.t;
  else if (a1 === 0) state.t_on1 = null;
  if (a2 > 0 && state.t_on2 === null) state.t_on2 = state.t;
  else if (a2 === 0) state.t_on2 = null;
}

// ── Wave-field render (per pixel into ImageData) ──────────────────
function renderField() {
  const { a1, a2 } = sourceAmps();
  const k = 2 * Math.PI / state.lambda;
  const w = WAVE_SPEED * k;
  const phaseRel = getPhaseRel();
  const t = state.t;

  const s1y = CENTER_Y - state.d / 2;
  const s2y = CENTER_Y + state.d / 2;
  const sx = SOURCE_X;

  const isInt = state.view === 'int';
  const wt = w * t;

  // Causal reach of each source: distance the leading wavefront has travelled.
  // -1 means "off" (no contribution at all). Soft fade-in over one wavelength behind the front.
  const reach1 = state.t_on1 !== null ? (t - state.t_on1) * WAVE_SPEED : -1;
  const reach2 = state.t_on2 !== null ? (t - state.t_on2) * WAVE_SPEED : -1;
  const invLam = 1 / state.lambda;

  let i = 0;
  for (let py = 0; py < BH; py++) {
    const y = (py + 0.5) / BH * SCENE_H;
    const dy1 = y - s1y, dy1sq = dy1 * dy1;
    const dy2 = y - s2y, dy2sq = dy2 * dy2;
    for (let px = 0; px < BW; px++) {
      const x = (px + 0.5) / BW * SCENE_W;
      const dx = x - sx, dxsq = dx * dx;
      const r1 = Math.sqrt(dxsq + dy1sq);
      const r2 = Math.sqrt(dxsq + dy2sq);

      // Soft causal envelopes: 0 just past the wavefront, 1 once λ inside.
      let f1 = (reach1 - r1) * invLam; if (f1 < 0) f1 = 0; else if (f1 > 1) f1 = 1;
      let f2 = (reach2 - r2) * invLam; if (f2 < 0) f2 = 0; else if (f2 > 1) f2 = 1;
      const A1 = a1 * f1, A2 = a2 * f2;

      let r, g, b;
      if (isInt) {
        // Time-averaged |E|² with effective (causally-gated) amplitudes
        const I = A1*A1 + A2*A2 + 2*A1*A2 * Math.cos(k*(r2 - r1) + phaseRel);
        const v = I * 0.25;                                // 0..1
        r = (255 * Math.min(1, v * 1.25)) | 0;
        g = (190 * v) | 0;
        b = (55  * v) | 0;
      } else {
        // Instantaneous ψ
        const psi = A1 * Math.sin(k*r1 - wt) + A2 * Math.sin(k*r2 - wt + phaseRel);
        const v = psi * 0.5;                               // ~[-1, 1]
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
      }
      pxData[i++] = r; pxData[i++] = g; pxData[i++] = b; pxData[i++] = 255;
    }
  }
  bctx.putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(buf, 0, 0, W, H);
}

// ── Hyperbola (locus of constant path difference p = r2 − r1) ─────
function drawHyperbola(C, color) {
  const a = Math.abs(C) / 2;
  const c = state.d / 2;
  if (a >= c - 0.01) return;          // not a valid hyperbola
  const b = Math.sqrt(c*c - a*a);
  const sign = Math.sign(C) || 1;
  const branchSign = -sign;           // C>0 → closer to S1 (top, smaller y) → Y<0

  const sx = SOURCE_X;
  const xMax = Math.max(sx, SCENE_W - sx);
  const Tmax = Math.asinh((xMax + 5) / b);
  const N = 220;

  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= N; i++) {
    const tt = -Tmax + (2 * Tmax) * i / N;
    const X = b * Math.sinh(tt);
    const Y = branchSign * a * Math.cosh(tt);
    const x = sx + X;
    const y = CENTER_Y + Y;
    if (x < 0 || x > SCENE_W || y < 0 || y > SCENE_H) {
      started = false;
      continue;
    }
    const [cx, cy] = sceneToCanvas(x, y);
    if (!started) { ctx.moveTo(cx, cy); started = true; }
    else ctx.lineTo(cx, cy);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// ── Overlays drawn on top of the wave field ───────────────────────
function drawOverlays() {
  const { a1, a2 } = sourceAmps();
  const phaseRel = getPhaseRel();
  const phaseFrac = phaseRel / (2 * Math.PI);

  const s1y = CENTER_Y - state.d / 2;
  const s2y = CENTER_Y + state.d / 2;
  const sx = SOURCE_X;

  const showA = (state.showAnti || state.view === 'both') && a1 > 0 && a2 > 0;
  const showN = (state.showNode || state.view === 'both') && a1 > 0 && a2 > 0;

  if (showA || showN) {
    const M = Math.ceil(state.d / state.lambda) + 2;
    if (showA) {
      ctx.setLineDash([]);
      for (let m = -M; m <= M; m++) {
        const C = (m - phaseFrac) * state.lambda;
        drawHyperbola(C, 'rgba(232, 178, 70, 0.9)');
      }
    }
    if (showN) {
      ctx.setLineDash([6, 5]);
      for (let m = -M; m <= M; m++) {
        const C = (m + 0.5 - phaseFrac) * state.lambda;
        drawHyperbola(C, 'rgba(120, 165, 250, 0.9)');
      }
      ctx.setLineDash([]);
    }
  }

  // Right-edge "screen" intensity strip
  if (state.showScreen) {
    const stripW_mm = 14;
    const stripX_mm = SCENE_W - stripW_mm - 2;
    const xProbe = stripX_mm + stripW_mm * 0.5;
    const [sxC, syC] = sceneToCanvas(stripX_mm, 0);
    const [exC, eyC] = sceneToCanvas(stripX_mm + stripW_mm, SCENE_H);
    ctx.fillStyle = '#050b18';
    ctx.fillRect(sxC, syC, exC - sxC, eyC - syC);

    const k = 2 * Math.PI / state.lambda;
    const reach1 = state.t_on1 !== null ? (state.t - state.t_on1) * WAVE_SPEED : -1;
    const reach2 = state.t_on2 !== null ? (state.t - state.t_on2) * WAVE_SPEED : -1;
    const invLam = 1 / state.lambda;
    const N = 220;
    for (let i = 0; i < N; i++) {
      const y0 = i / N * SCENE_H;
      const y1 = (i + 1) / N * SCENE_H;
      const ym = (y0 + y1) * 0.5;
      const r1 = Math.hypot(xProbe - sx, ym - s1y);
      const r2 = Math.hypot(xProbe - sx, ym - s2y);
      let f1 = (reach1 - r1) * invLam; if (f1 < 0) f1 = 0; else if (f1 > 1) f1 = 1;
      let f2 = (reach2 - r2) * invLam; if (f2 < 0) f2 = 0; else if (f2 > 1) f2 = 1;
      const A1 = a1 * f1, A2 = a2 * f2;
      const I = A1*A1 + A2*A2 + 2*A1*A2 * Math.cos(k*(r2 - r1) + phaseRel);
      const v = I * 0.25;
      const r = (255 * Math.min(1, v * 1.25)) | 0;
      const g = (190 * v) | 0;
      const b = (55  * v) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const [, ya] = sceneToCanvas(0, y0);
      const [, yb] = sceneToCanvas(0, y1);
      ctx.fillRect(sxC, ya, exC - sxC, yb - ya + 1);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sxC, syC, exC - sxC, eyC - syC);
  }

  // Sources
  const drawSource = (xm, ym, on, isAnti) => {
    const [cx, cy] = sceneToCanvas(xm, ym);
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, 2 * Math.PI);
    ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = on
      ? (isAnti ? '#e0a93a' : '#0d9488')
      : 'rgba(255,255,255,0.35)';
    ctx.stroke();
  };
  const isAnti = state.phaseMode === 'anti';
  drawSource(sx, s1y, a1 > 0, false);
  drawSource(sx, s2y, a2 > 0, isAnti);   // mark the phase-flipped one

  // Cursor probe
  if (state.showProbe && state.cursor) {
    const { x, y } = state.cursor;
    const [cx, cy] = sceneToCanvas(x, y);
    const r1 = Math.hypot(x - sx, y - s1y);
    const r2 = Math.hypot(x - sx, y - s2y);
    const [s1cx, s1cy] = sceneToCanvas(sx, s1y);
    const [s2cx, s2cy] = sceneToCanvas(sx, s2y);
    const pxPerMm = W / SCENE_W;

    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(13, 148, 136, 0.85)';
    ctx.beginPath(); ctx.arc(s1cx, s1cy, r1 * pxPerMm, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(s2cx, s2cy, r2 * pxPerMm, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#0d9488';
    ctx.fillStyle = 'rgba(13, 148, 136, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
  }
}

// ── Live readouts ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function updateReadouts() {
  if (!state.cursor) {
    ['rd-pos','rd-r1','rd-r2','rd-dr','rd-drl','rd-verd'].forEach(id => $(id).textContent = '—');
    return;
  }
  const { x, y } = state.cursor;
  const s1y = CENTER_Y - state.d / 2;
  const s2y = CENTER_Y + state.d / 2;
  const r1 = Math.hypot(x - SOURCE_X, y - s1y);
  const r2 = Math.hypot(x - SOURCE_X, y - s2y);
  const p = Math.abs(r2 - r1);
  const pl = p / state.lambda;
  const phaseFrac = getPhaseRel() / (2 * Math.PI);
  const m = pl + phaseFrac;
  const f = m - Math.round(m);

  $('rd-pos').textContent  = `${x.toFixed(1)}, ${y.toFixed(1)} mm`;
  $('rd-r1').textContent   = `${r1.toFixed(1)} mm`;
  $('rd-r2').textContent   = `${r2.toFixed(1)} mm`;
  $('rd-dr').textContent   = `${p.toFixed(2)} mm`;
  $('rd-drl').textContent  = pl.toFixed(3);

  const { a1, a2 } = sourceAmps();
  let verd;
  if (a1 === 0 || a2 === 0) verd = 'single source';
  else if (Math.abs(f) < 0.05) verd = 'constructive';
  else if (Math.abs(Math.abs(f) - 0.5) < 0.05) verd = 'destructive';
  else verd = 'between';
  $('rd-verd').textContent = verd;
}

// ── Main loop ─────────────────────────────────────────────────────
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (state.playing && state.view !== 'int') {
    state.t += dt * state.speed;
  }
  syncSourceOnTimes();
  renderField();
  drawOverlays();
  updateReadouts();
  requestAnimationFrame(loop);
}

// ── Controls ──────────────────────────────────────────────────────
function bindSeg(id, key, onChange) {
  const wrap = $(id);
  wrap.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = btn.dataset.val;
      if (onChange) onChange(btn.dataset.val);
    });
  });
}
bindSeg('seg-view', 'view');
bindSeg('seg-phase', 'phaseMode', v => {
  $('phase-row').style.display = (v === 'custom') ? 'flex' : 'none';
});
bindSeg('seg-active', 'active');

function bindSlider(id, valId, key, fmt) {
  const sl = $(id), va = $(valId);
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    state[key] = v;
    va.textContent = fmt(v);
  });
}
bindSlider('slider-d',      'val-d',      'd',           v => v.toFixed(0));
bindSlider('slider-lambda', 'val-lambda', 'lambda',      v => v.toFixed(1));
bindSlider('slider-phase',  'val-phase',  'phaseCustom', v => v.toFixed(2));
bindSlider('slider-speed',  'val-speed',  'speed',       v => v.toFixed(2));

function bindToggle(id, key) {
  const btn = $(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
  });
}
bindToggle('btn-anti',   'showAnti');
bindToggle('btn-node',   'showNode');
bindToggle('btn-probe',  'showProbe');
bindToggle('btn-screen', 'showScreen');

$('btn-play').addEventListener('click', e => {
  state.playing = !state.playing;
  e.currentTarget.classList.toggle('playing', state.playing);
  e.currentTarget.textContent = state.playing ? '■ Pause' : '▶ Play';
});
$('btn-reset').addEventListener('click', () => {
  state.t = 0;
  const { a1, a2 } = sourceAmps();
  state.t_on1 = a1 > 0 ? 0 : null;
  state.t_on2 = a2 > 0 ? 0 : null;
});

// Cursor probe
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / rect.width  * W;
  const cy = (e.clientY - rect.top)  / rect.height * H;
  state.cursor = { x: cx / W * SCENE_W, y: cy / H * SCENE_H };
});
canvas.addEventListener('mouseleave', () => { state.cursor = null; });

requestAnimationFrame(loop);
