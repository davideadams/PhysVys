// ── Controls ─────────────────────────────────────────────────────
const voltageSlider  = document.getElementById('voltage-slider');
const currentSlider  = document.getElementById('current-slider');
const metalSelect    = document.getElementById('metal-select');
const voltageReadout = document.getElementById('voltage-readout');
const currentReadout = document.getElementById('current-readout');

voltageSlider.addEventListener('input', () => {
  voltageReadout.value = voltageSlider.value;
  redraw();
});
voltageReadout.addEventListener('change', () => {
  const raw = parseFloat(voltageReadout.value);
  if (isNaN(raw)) { voltageReadout.value = voltageSlider.value; return; }
  const v = Math.max(10, Math.min(75, Math.round(raw)));
  voltageSlider.value = v;
  voltageReadout.value = v;
  redraw();
});
currentSlider.addEventListener('input', () => {
  currentReadout.value = parseFloat(currentSlider.value).toFixed(1);
  redraw();
});
currentReadout.addEventListener('change', () => {
  const raw = parseFloat(currentReadout.value);
  if (isNaN(raw)) { currentReadout.value = parseFloat(currentSlider.value).toFixed(1); return; }
  const v = Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
  currentSlider.value = v;
  currentReadout.value = v.toFixed(1);
  redraw();
});
metalSelect.addEventListener('change', redraw);

function redraw() {
  const V     = parseFloat(voltageSlider.value);
  const I     = parseFloat(currentSlider.value);
  const metal = metalSelect.value;
  drawSchematic(V, I, metal);
  drawSpectrum(V, I, metal);
}

// ═══════════════════════════════════════════════════════════════════
//  SCHEMATIC
// ═══════════════════════════════════════════════════════════════════
const schCanvas = document.getElementById('schematic-canvas');
const schCtx    = schCanvas.getContext('2d');

// ── Layout constants (canvas is 620 × 400) ────────────────────────
//  Envelope
const EX = 50, EY = 82, EW = 462, EH = 162, ER = 32;
const ECY    = EY + EH / 2;   // 163 — centre-line (beam path)
const EBOT   = EY + EH;       // 244
const ERIGHT = EX + EW;       // 512
//  Cathode cup
const CX0 = 86, CX1 = 108, CHH = 27;   // x-left, x-right, half-height
//  Anode face vertices (angled tungsten target)
const AF_TX = 425, AF_TY = EY + 28;    // top of face
const AF_BX = 468, AF_BY = EBOT - 28;  // bottom of face
//  Collimator (centred below beam-impact point on the face)
const COL_CX  = 447, COL_GAP = 24, COL_WW = 34, COL_H = 90;
const COL_Y1  = EBOT;
const COL_Y2  = COL_Y1 + COL_H;        // 334
//  X-ray exit arrow
const XY1 = COL_Y2 + 6, XY2 = COL_Y2 + 36;  // 340 → 370

// ── Drawing helpers ───────────────────────────────────────────────
function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r,     r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r,  0,            Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r,     y + h - r, r,  Math.PI / 2,  Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r,     y + r,     r,  Math.PI,      3 * Math.PI / 2);
  ctx.closePath();
}

function drawFilament(ctx, xc, y1, y2, intensity) {
  intensity = (intensity === undefined) ? 0.5 : intensity;
  const segs = 8, amp = 5;
  const dy = (y2 - y1) / segs;
  const pts = [[xc, y1]];
  for (let i = 0; i < segs; i++) {
    pts.push([xc + (i % 2 === 0 ? amp : -amp), y1 + (i + 0.5) * dy]);
    pts.push([xc, y1 + (i + 1) * dy]);
  }
  function tracePts() {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  // Glow pass — width and opacity scale with filament current
  ctx.save();
  tracePts();
  ctx.strokeStyle = `rgba(253,186,116,${(0.18 + intensity * 0.44).toFixed(2)})`;
  ctx.lineWidth = 4 + intensity * 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  // Wire pass
  ctx.save();
  tracePts();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function schLabel(ctx, text, x, y, align, muted, bold, size) {
  align = align || 'left';
  size  = size  || 12;
  ctx.save();
  ctx.font = `${bold ? '700 ' : ''}${size}px "Trebuchet MS","Segoe UI",sans-serif`;
  ctx.fillStyle  = muted ? '#55708d' : '#15304d';
  ctx.textAlign  = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function leaderLine(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(85,112,141,0.42)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.restore();
}

// ── Main draw ─────────────────────────────────────────────────────
function drawSchematic(voltageKV, currentRel, metal) {
  const ctx = schCtx;
  ctx.clearRect(0, 0, 620, 400);

  // 1 ── Glass envelope fill
  rrPath(ctx, EX, EY, EW, EH, ER);
  ctx.fillStyle = 'rgba(195,222,250,0.20)';
  ctx.fill();

  // 2 ── Anode block + tungsten face, clipped to envelope shape
  ctx.save();
  rrPath(ctx, EX, EY, EW, EH, ER);
  ctx.clip();
  ctx.fillStyle = '#a06828';   // copper
  ctx.fillRect(AF_TX, EY, ERIGHT - AF_TX, EH);
  // Tungsten target face (angled polygon)
  ctx.beginPath();
  ctx.moveTo(AF_TX,      AF_TY);
  ctx.lineTo(AF_TX + 10, AF_TY);
  ctx.lineTo(AF_BX,      AF_BY);
  ctx.lineTo(AF_BX - 10, AF_BY);
  ctx.closePath();
  ctx.fillStyle = '#b8c4d0';   // tungsten — silvery
  ctx.fill();
  ctx.restore();

  // 3 ── Envelope outline (drawn over anode so it stays crisp)
  rrPath(ctx, EX, EY, EW, EH, ER);
  ctx.strokeStyle = 'rgba(100,152,218,0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 4 ── Cathode focusing cup (C-shape open to the right)
  ctx.save();
  ctx.strokeStyle = '#263f5a';
  ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(CX1, ECY - CHH);
  ctx.lineTo(CX0, ECY - CHH);
  ctx.lineTo(CX0, ECY + CHH);
  ctx.lineTo(CX1, ECY + CHH);
  ctx.stroke();
  ctx.restore();

  // 5 ── Heated filament (orange zigzag inside cup)
  drawFilament(ctx, (CX0 + CX1) / 2, ECY - CHH + 8, ECY + CHH - 8, currentRel / 10);

  // 6 ── Electron beam (dashed blue arrow, cathode → anode face)
  const BX1 = CX1 + 3, BX2 = AF_TX - 6;
  ctx.save();
  ctx.strokeStyle = 'rgba(65,125,215,0.65)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(BX1, ECY); ctx.lineTo(BX2, ECY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(65,125,215,0.65)';
  ctx.beginPath();
  ctx.moveTo(BX2,      ECY);
  ctx.lineTo(BX2 - 11, ECY - 5);
  ctx.lineTo(BX2 - 11, ECY + 5);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // 7 ── Collimator walls (dark lead shielding below envelope)
  ctx.save();
  ctx.fillStyle = '#1e2c3a';
  ctx.fillRect(COL_CX - COL_GAP / 2 - COL_WW, COL_Y1, COL_WW, COL_H);
  ctx.fillRect(COL_CX + COL_GAP / 2,           COL_Y1, COL_WW, COL_H);
  ctx.restore();

  // 8 ── X-ray exit arrow (amber, pointing down from collimator)
  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(COL_CX, XY1); ctx.lineTo(COL_CX, XY2 - 11);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(COL_CX - 7, XY2 - 13);
  ctx.lineTo(COL_CX,     XY2);
  ctx.lineTo(COL_CX + 7, XY2 - 13);
  ctx.stroke();
  ctx.restore();

  // 9 ── Labels ─────────────────────────────────────────────────────
  // Vacuum envelope (above tube)
  leaderLine(ctx, 268, 67, 268, EY + 2);
  schLabel(ctx, 'Vacuum envelope', 268, 61, 'center', true, false, 12);

  // Cathode (below cup)
  leaderLine(ctx, 98, ECY + CHH + 3, 98, EBOT + 8);
  schLabel(ctx, 'Cathode', 98, EBOT + 18, 'center', false, true, 13);
  schLabel(ctx, '(heated filament)', 98, EBOT + 32, 'center', true, false, 11);

  // Anode target (right of envelope)
  leaderLine(ctx, ERIGHT + 4, ECY, (AF_TX + AF_BX) / 2 + 6, ECY);
  schLabel(ctx, 'Anode target', ERIGHT + 9, ECY - 9, 'left', false, true, 13);
  schLabel(ctx, `(${metal})`,   ERIGHT + 9, ECY + 9, 'left', true,  false, 11);

  // Electron beam (inside tube, above beam line)
  schLabel(ctx, 'electron beam →', 264, ECY - 20, 'center', true, false, 11);

  // Accelerating voltage bracket below tube
  const VBY = EBOT + 48;                     // y of horizontal bracket bar
  const VCTR = (CX0 + AF_TX + 18) / 2;       // x-centre of bracket ≈ 262
  ctx.save();
  ctx.strokeStyle = 'rgba(85,112,141,0.38)';
  ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(CX0,         EBOT); ctx.lineTo(CX0,         VBY);  // left tick
  ctx.moveTo(AF_TX + 18,  EBOT); ctx.lineTo(AF_TX + 18,  VBY);  // right tick
  ctx.moveTo(CX0,         VBY);  ctx.lineTo(AF_TX + 18,  VBY);  // bar
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  schLabel(ctx, `Accelerating voltage: ${voltageKV} kV`, VCTR, VBY + 15, 'center', false, true, 12);

  // Collimator (right of right wall)
  const CLX = COL_CX + COL_GAP / 2 + COL_WW + 4;
  leaderLine(ctx, CLX, COL_Y1 + COL_H / 2, CLX + 14, COL_Y1 + COL_H / 2);
  schLabel(ctx, 'Collimator', CLX + 16, COL_Y1 + COL_H / 2, 'left', true, false, 12);

  // X-ray beam (right of arrow)
  schLabel(ctx, 'X-ray beam', COL_CX + 14, (XY1 + XY2) / 2, 'left', true, false, 12);
}

// ── Initial render ────────────────────────────────────────────────
drawSchematic(
  parseFloat(voltageSlider.value),
  parseFloat(currentSlider.value),
  metalSelect.value
);

// ═══════════════════════════════════════════════════════════════════
//  SPECTRUM
// ═══════════════════════════════════════════════════════════════════
const spCanvas = document.getElementById('spectrum-canvas');
const spCtx    = spCanvas.getContext('2d');

// ── Physics constants ─────────────────────────────────────────────
const PLANCK   = 6.626e-34;   // J·s
const E_CHARGE = 1.6e-19;     // C

function keVtoHz(keV) { return keV * 1000 * E_CHARGE / PLANCK; }

// ── Metal data — K-series (and, for W, L-series) characteristic lines.
//   relHeight    : visual height relative to Kα of that metal (Kα = 1.00).
//   thresholdKeV : tube voltage needed to ionise the relevant shell.
// Cu and Mo L-lines are too soft (< 1 keV) to be interesting here, so
// only W gets L-series peaks — which is precisely where they matter,
// since K-lines for W need V > 69.5 kV.
const METALS = {
  Cu: {
    label: 'Cu',
    peaks: [
      { label: 'Kα', energyKeV:  8.048, relHeight: 1.00, thresholdKeV:  8.98 },
      { label: 'Kβ', energyKeV:  8.905, relHeight: 0.20, thresholdKeV:  8.98 },
    ],
  },
  Mo: {
    label: 'Mo',
    peaks: [
      { label: 'Kα', energyKeV: 17.48,  relHeight: 1.00, thresholdKeV: 20.00 },
      { label: 'Kβ', energyKeV: 19.61,  relHeight: 0.20, thresholdKeV: 20.00 },
    ],
  },
  W: {
    label: 'W',
    peaks: [
      { label: 'Lα', energyKeV:  8.398, relHeight: 0.50, thresholdKeV: 10.20 },
      { label: 'Lβ', energyKeV:  9.672, relHeight: 0.40, thresholdKeV: 11.54 },
      { label: 'Kα', energyKeV: 58.80,  relHeight: 1.00, thresholdKeV: 69.50 },
      { label: 'Kβ', energyKeV: 67.20,  relHeight: 0.20, thresholdKeV: 69.50 },
    ],
  },
};

// ── Shape constants ───────────────────────────────────────────────
const KRAMERS_SCALE = 0.65;    // Peak bremsstrahlung intensity at I_rel = 1
const PEAK_SCALE    = 0.55;    // Saturated characteristic peak height (rel = 1, I = 1)
const PEAK_SAT_RATE = 1.5;     // Controls how quickly peaks saturate above threshold

// Bremsstrahlung shape: the raw Kramers' law is monotonically decreasing,
// but a real tube spectrum is suppressed at low frequency by self-absorption
// in the target and by the tube window / any beam filters. The resulting
// "humped" curve (rises from 0, peaks somewhere in the middle, falls to f_max)
// is what appears in every SACE textbook. We approximate it with the
// standard u^1.5 · √(1-u) profile (u = f / f_max), which peaks at u = 0.75.
const BREMS_SHAPE_MAX = Math.pow(0.75, 1.5) * Math.sqrt(0.25);   // ≈ 0.3248

function bremssAt(f, fMax, I_rel) {
  if (fMax <= 0 || f >= fMax) return 0;
  const u = f / fMax;
  const shape = Math.pow(u, 1.5) * Math.sqrt(1 - u);
  return I_rel * KRAMERS_SCALE * (shape / BREMS_SHAPE_MAX);
}

// Characteristic-line amplitude ramps smoothly from 0 at threshold toward
// a saturation plateau — loosely approximates I ∝ (V − V_thresh)^1.5 near
// threshold, then flattens off at high overvoltage.
function peakAmplitude(V_kV, peak, I_rel) {
  if (V_kV <= peak.thresholdKeV) return 0;
  const overvoltage = (V_kV - peak.thresholdKeV) / peak.thresholdKeV;
  const envelope = 1 - Math.exp(-overvoltage * PEAK_SAT_RATE);
  return I_rel * peak.relHeight * envelope * PEAK_SCALE;
}

// ── Spectrum layout (canvas 1200 × 440) ───────────────────────────
const SP = {
  W: 1200, H: 440,
  L: 72,   // left margin (for y-axis label + ticks)
  R: 24,   // right margin
  T: 24,   // top margin
  B: 58,   // bottom margin (for x-axis label + ticks)
};
SP.plotW = SP.W - SP.L - SP.R;   // 1104
SP.plotH = SP.H - SP.T - SP.B;   // 358

// Fixed x-axis: 0 to F_MAX_AXIS Hz
const F_MAX_AXIS = 1.8e19;

// Fixed y-axis base maximum (at filament current = 10, zoom 1×)
const Y_BASE_MAX = 1.0;

// Current zoom level
let yZoom = 1;

// ── Zoom buttons ──────────────────────────────────────────────────
document.querySelectorAll('.zoom-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    yZoom = parseFloat(btn.dataset.zoom);
    redraw();
  });
});

// ── Coordinate helpers ───────────────────────────────────────────
function freqToX(f) {
  return SP.L + (f / F_MAX_AXIS) * SP.plotW;
}

function intensityToY(intensity, yMax) {
  const clamped = Math.max(0, Math.min(intensity, yMax));
  return SP.T + SP.plotH - (clamped / yMax) * SP.plotH;
}

// ── Main spectrum draw ────────────────────────────────────────────
function drawSpectrum(voltageKV, currentRel, metal) {
  const ctx  = spCtx;
  const m    = METALS[metal];
  const fMax = keVtoHz(voltageKV);                  // bremsstrahlung cutoff
  const I    = currentRel / 10;                     // normalise current to [0.1, 1.0]

  // ── Precompute bremsstrahlung curve points ─────────────────────
  // Kramers: I(f) ∝ (f_max − f). Sampled across the full x-axis so we
  // can reuse the same array for the fill and stroke passes.
  const STEPS = 800;
  const df    = F_MAX_AXIS / STEPS;
  const bremsPts = new Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const f = i * df;
    bremsPts[i] = { f, intensity: bremssAt(f, fMax, I) };
  }

  // ── Gather active characteristic peaks at this V, I ────────────
  const peaks = [];
  for (const pk of m.peaks) {
    const amp = peakAmplitude(voltageKV, pk, I);
    if (amp <= 0) continue;
    const freq = keVtoHz(pk.energyKeV);
    const base = bremssAt(freq, fMax, I);
    peaks.push({ label: pk.label, freq, base, top: base + amp });
  }

  // ── Dynamic yMax: zooming in must never clip visible features ──
  // Start with the zoom-requested yMax, then widen if the bremsstrahlung
  // or any characteristic peak would otherwise overflow the plot.
  let yMax = Y_BASE_MAX / yZoom;
  const bremsMax = I * KRAMERS_SCALE;                 // peak of bremsstrahlung at f = 0
  if (bremsMax * 1.05 > yMax) yMax = bremsMax * 1.05;
  for (const pk of peaks) {
    if (pk.top * 1.1 > yMax) yMax = pk.top * 1.1;
  }

  ctx.clearRect(0, 0, SP.W, SP.H);

  // ── Grid lines ──────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = 'rgba(85,112,141,0.12)';
  ctx.lineWidth = 1;
  // Vertical grid every 3×10¹⁸ Hz
  for (let f = 0; f <= F_MAX_AXIS; f += 3e18) {
    const x = freqToX(f);
    ctx.beginPath(); ctx.moveTo(x, SP.T); ctx.lineTo(x, SP.T + SP.plotH); ctx.stroke();
  }
  // Horizontal grid at 25% intervals
  for (let frac = 0.25; frac <= 1.0; frac += 0.25) {
    const y = SP.T + SP.plotH * (1 - frac);
    ctx.beginPath(); ctx.moveTo(SP.L, y); ctx.lineTo(SP.L + SP.plotW, y); ctx.stroke();
  }
  ctx.restore();

  // ── Bremsstrahlung curve — fill ─────────────────────────────────
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const x = freqToX(bremsPts[i].f);
    const y = intensityToY(bremsPts[i].intensity, yMax);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.lineTo(freqToX(F_MAX_AXIS), intensityToY(0, yMax));
  ctx.lineTo(freqToX(0),          intensityToY(0, yMax));
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,118,110,0.14)';
  ctx.fill();
  ctx.restore();

  // ── Bremsstrahlung curve — stroke ───────────────────────────────
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const x = freqToX(bremsPts[i].f);
    const y = intensityToY(bremsPts[i].intensity, yMax);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ── Characteristic peaks — vertical lines rising from bremsstrahlung
  for (const pk of peaks) {
    const x     = freqToX(pk.freq);
    const yBase = intensityToY(pk.base, yMax);
    const yTop  = intensityToY(pk.top,  yMax);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, yBase);
    ctx.lineTo(x, yTop);
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // ── fMax cutoff marker ───────────────────────────────────────────
  if (fMax < F_MAX_AXIS) {
    const cx = freqToX(fMax);
    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(cx, SP.T); ctx.lineTo(cx, SP.T + SP.plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Small label
    ctx.save();
    ctx.font = '10px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(180,120,0,0.85)';
    ctx.textAlign = cx > SP.L + SP.plotW - 40 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('fₘₐₓ', cx + (cx > SP.L + SP.plotW - 40 ? -4 : 4), SP.T + 4);
    ctx.restore();
  }

  // ── Axes ─────────────────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1.5;
  // x-axis
  ctx.beginPath();
  ctx.moveTo(SP.L, SP.T + SP.plotH);
  ctx.lineTo(SP.L + SP.plotW, SP.T + SP.plotH);
  ctx.stroke();
  // y-axis
  ctx.beginPath();
  ctx.moveTo(SP.L, SP.T);
  ctx.lineTo(SP.L, SP.T + SP.plotH);
  ctx.stroke();
  ctx.restore();

  // ── X-axis ticks and labels (units of ×10¹⁸ Hz) ──────────────────
  ctx.save();
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1;
  const baseY = SP.T + SP.plotH;
  // Minor ticks every 0.5×10¹⁸ Hz
  for (let f = 0.5e18; f < F_MAX_AXIS; f += 1e18) {
    const x = freqToX(f);
    ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY + 3); ctx.stroke();
  }
  // Major ticks + labels every 1×10¹⁸ Hz
  ctx.font = '10px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let f = 0; f <= F_MAX_AXIS + 1e15; f += 1e18) {
    const x = freqToX(f);
    ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY + 5); ctx.stroke();
    ctx.fillText(Math.round(f / 1e18).toString(), x, baseY + 7);
  }
  ctx.restore();

  // X-axis title
  ctx.save();
  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Frequency (×10¹⁸ Hz)', SP.L + SP.plotW / 2, SP.H - 2);
  ctx.restore();

  // ── Y-axis label (rotated) ────────────────────────────────────────
  ctx.save();
  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(14, SP.T + SP.plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Intensity (arb. units)', 0, 0);
  ctx.restore();

  // Y-axis ticks (at 25% intervals) — just small marks, no numbers
  ctx.save();
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1;
  for (let frac = 0.25; frac <= 1.0; frac += 0.25) {
    const y = SP.T + SP.plotH * (1 - frac);
    ctx.beginPath(); ctx.moveTo(SP.L - 4, y); ctx.lineTo(SP.L, y); ctx.stroke();
  }
  ctx.restore();
}

// Initial spectrum render
drawSpectrum(
  parseFloat(voltageSlider.value),
  parseFloat(currentSlider.value),
  metalSelect.value
);

// ═══════════════════════════════════════════════════════════════════
//  ANIMATION — electrons and photons on the schematic
// ═══════════════════════════════════════════════════════════════════

const electrons = [];   // { x, y, speed }
const photons   = [];   // { x, y, speed }
const flashes   = [];   // { x, y, age, maxAge }  — brief impact glow

function spawnElectron(V_kV) {
  // Kinetic energy gained = eV ⇒ v ∝ √V. Scale relative to V = 40 kV
  // (mid-slider) and clamp so the range stays visually reasonable — the
  // animation is indicative, not a quantitative speed display.
  const speedFactor = Math.min(1.4, Math.max(0.7, Math.sqrt(V_kV / 40)));
  electrons.push({
    x:     CX1 + 3,
    y:     ECY + (Math.random() - 0.5) * 4,   // small y jitter on beam line
    speed: (1.9 + Math.random() * 0.5) * speedFactor,
  });
}

function spawnPhoton() {
  // Flash at impact point on the anode face
  flashes.push({ x: AF_TX - 5, y: ECY, age: 0, maxAge: 20 });
  // Dot emerges at the base of the envelope and travels downward
  photons.push({
    x:     COL_CX,
    y:     EBOT + 1,
    speed: 3.0 + Math.random() * 0.5,
  });
}

let animId = null;

function animStep() {
  const I     = parseFloat(currentSlider.value);
  const V     = parseFloat(voltageSlider.value);
  const metal = metalSelect.value;

  // ── Spawn electrons (Poisson-ish rate ∝ filament current) ──────
  if (Math.random() < I * 0.009) spawnElectron(V);

  // ── Update electrons ────────────────────────────────────────────
  for (let i = electrons.length - 1; i >= 0; i--) {
    electrons[i].x += electrons[i].speed;
    if (electrons[i].x >= AF_TX - 4) {
      if (Math.random() < 0.28) spawnPhoton();
      electrons.splice(i, 1);
    }
  }

  // ── Update photons ──────────────────────────────────────────────
  for (let i = photons.length - 1; i >= 0; i--) {
    photons[i].y += photons[i].speed;
    if (photons[i].y > 400) photons.splice(i, 1);
  }

  // ── Age flashes ─────────────────────────────────────────────────
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].age++;
    if (flashes[i].age >= flashes[i].maxAge) flashes.splice(i, 1);
  }

  // ── Redraw static schematic ─────────────────────────────────────
  drawSchematic(V, I, metal);

  // ── Overlay animated particles ──────────────────────────────────
  const ctx = schCtx;

  // Electrons — small blue dots
  for (const e of electrons) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80,140,230,0.90)';
    ctx.fill();
    ctx.restore();
  }

  // Flashes — expanding pale-yellow disc at impact point
  for (const f of flashes) {
    const t      = f.age / f.maxAge;
    const radius = 3 + t * 12;
    const alpha  = (1 - t) * 0.65;
    ctx.save();
    ctx.beginPath();
    ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,240,140,${alpha.toFixed(2)})`;
    ctx.fill();
    ctx.restore();
  }

  // Photons — bright amber dot traveling through the collimator and out
  for (const p of photons) {
    // While inside the collimator zone, clip drawing to the gap
    const inColZone = p.y >= COL_Y1 && p.y <= COL_Y2;
    if (inColZone) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        COL_CX - COL_GAP / 2,
        COL_Y1,
        COL_GAP,
        COL_H
      );
      ctx.clip();
    } else {
      ctx.save();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(251,191,36,0.96)';
    ctx.shadowColor = 'rgba(251,191,36,0.55)';
    ctx.shadowBlur  = 7;
    ctx.fill();
    ctx.restore();
  }

  animId = requestAnimationFrame(animStep);
}

// Redraw schematic immediately when the collapsible section is opened
document.getElementById('schematic-details').addEventListener('toggle', function () {
  if (this.open) {
    drawSchematic(
      parseFloat(voltageSlider.value),
      parseFloat(currentSlider.value),
      metalSelect.value
    );
  }
});

// Pause when tab is hidden, resume when visible
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(animId);
    animId = null;
  } else if (!animId) {
    animId = requestAnimationFrame(animStep);
  }
});

// Kick off the loop
animId = requestAnimationFrame(animStep);
