// Atomic Spectra — emission and absorption spectra for common elements.
// Zoom via scroll wheel (centred on cursor); drag to pan; click overview to re-centre.
// Static render: no animation loop. render() called on every state change.

const canvas = document.getElementById('spec-canvas');
const ctx    = canvas.getContext('2d');
const W = 960, H = 600;

// ── Geometry ──────────────────────────────────────────────────────────────────

const STRIP_W  = { xL: 30, xR: 930 };          // shared x bounds for all strips
const SE       = { ...STRIP_W, y0:  45, y1: 185 };  // emission strip
const SA       = { ...STRIP_W, y0: 225, y1: 365 };  // absorption strip
const OV       = { ...STRIP_W, y0: 400, y1: 418 };  // overview bar (full vis, no zoom)
const AXIS_Y   = 435;

// Visible wavelength bounds — hard limits for the overview bar and zoom clamping.
const VIS0 = 380, VIS1 = 780;

// ── Element spectral data ─────────────────────────────────────────────────────
// lines: [{nm, w}]  — nm = wavelength in nm (air), w = relative intensity 0–1.
// colour: CSS hex used only for the dropdown swatch/label; spectra use physical RGB.

const ELEMENTS = [
  { sym: 'H',  name: 'Hydrogen',   colour: '#6699ff',
    lines: [{nm:410.17,w:0.20},{nm:434.05,w:0.30},{nm:486.13,w:0.60},{nm:656.28,w:1.00}] },

  { sym: 'He', name: 'Helium',     colour: '#aaccff',
    lines: [{nm:438.8,w:0.15},{nm:447.1,w:0.50},{nm:471.3,w:0.25},{nm:492.2,w:0.35},
            {nm:501.6,w:0.50},{nm:587.6,w:1.00},{nm:667.8,w:0.55},{nm:706.5,w:0.25}] },

  { sym: 'Li', name: 'Lithium',    colour: '#ff6655',
    lines: [{nm:460.3,w:0.15},{nm:610.4,w:0.25},{nm:670.8,w:1.00}] },

  { sym: 'O',  name: 'Oxygen',     colour: '#88ffcc',
    lines: [{nm:533.1,w:0.30},{nm:543.6,w:0.20},{nm:604.6,w:0.35},
            {nm:615.6,w:0.70},{nm:616.0,w:0.65},{nm:645.4,w:0.50},{nm:700.2,w:0.80}] },

  { sym: 'N',  name: 'Nitrogen',   colour: '#ccaaff',
    lines: [{nm:500.5,w:0.25},{nm:519.8,w:0.20},{nm:567.6,w:0.40},{nm:568.0,w:0.35},
            {nm:648.2,w:0.20},{nm:742.4,w:0.45},{nm:744.2,w:0.55},{nm:746.8,w:0.60}] },

  { sym: 'Ne', name: 'Neon',       colour: '#ff4422',
    lines: [{nm:585.2,w:0.80},{nm:594.5,w:0.45},{nm:607.4,w:0.55},{nm:614.3,w:0.90},
            {nm:621.7,w:0.50},{nm:638.3,w:0.50},{nm:640.2,w:0.70},{nm:659.9,w:0.50},
            {nm:667.8,w:0.35},{nm:692.9,w:0.55},{nm:703.2,w:0.60},{nm:717.4,w:0.40},
            {nm:724.5,w:0.40}] },

  { sym: 'Na', name: 'Sodium',     colour: '#ffcc33',
    lines: [{nm:568.8,w:0.05},{nm:589.00,w:1.00},{nm:589.59,w:0.95},{nm:615.4,w:0.05}] },

  { sym: 'Mg', name: 'Magnesium',  colour: '#55ddaa',
    lines: [{nm:457.1,w:0.15},{nm:470.3,w:0.10},{nm:516.73,w:0.60},
            {nm:517.27,w:0.80},{nm:518.36,w:0.70},{nm:552.8,w:0.15}] },

  { sym: 'Ar', name: 'Argon',      colour: '#88aaff',
    lines: [{nm:420.1,w:0.20},{nm:433.4,w:0.25},{nm:451.1,w:0.15},{nm:675.3,w:0.30},
            {nm:687.1,w:0.35},{nm:696.5,w:0.80},{nm:706.7,w:0.70},{nm:714.7,w:0.40},
            {nm:727.3,w:0.50},{nm:738.4,w:0.55},{nm:750.4,w:0.90},{nm:763.5,w:0.85},
            {nm:772.4,w:0.60}] },

  { sym: 'K',  name: 'Potassium',  colour: '#dd77ff',
    lines: [{nm:404.4,w:0.40},{nm:693.9,w:0.20},{nm:766.49,w:1.00},{nm:769.90,w:0.80}] },

  { sym: 'Ca', name: 'Calcium',    colour: '#ff88bb',
    lines: [{nm:393.37,w:0.95},{nm:396.85,w:0.90},{nm:422.67,w:0.65},
            {nm:430.8,w:0.15},{nm:442.5,w:0.12},{nm:616.2,w:0.12}] },

  { sym: 'Ti', name: 'Titanium',   colour: '#99bbdd',
    lines: [{nm:453.4,w:0.35},{nm:466.0,w:0.25},{nm:499.1,w:0.30},
            {nm:503.6,w:0.20},{nm:519.3,w:0.45},{nm:521.0,w:0.40}] },

  { sym: 'Fe', name: 'Iron',       colour: '#ffaa55',
    lines: [{nm:385.0,w:0.30},{nm:404.6,w:0.25},{nm:438.4,w:0.45},{nm:489.1,w:0.40},
            {nm:495.8,w:0.50},{nm:527.0,w:0.60},{nm:532.8,w:0.40},{nm:540.4,w:0.35}] },

  { sym: 'Sr', name: 'Strontium',  colour: '#ff6680',
    lines: [{nm:407.8,w:0.50},{nm:421.6,w:0.40},{nm:460.7,w:0.90},
            {nm:481.0,w:0.40},{nm:496.2,w:0.30},{nm:707.0,w:0.55}] },

  { sym: 'Ba', name: 'Barium',     colour: '#88ee66',
    lines: [{nm:455.4,w:0.80},{nm:493.4,w:0.55},{nm:553.5,w:0.70},
            {nm:577.7,w:0.40},{nm:614.2,w:0.50},{nm:649.7,w:0.35}] },

  { sym: 'Hg', name: 'Mercury',    colour: '#cc99ff',
    lines: [{nm:404.66,w:0.70},{nm:407.8,w:0.20},{nm:435.84,w:0.90},
            {nm:546.07,w:1.00},{nm:576.96,w:0.60},{nm:578.97,w:0.55}] },
];

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  elemIdx:      0,
  showEmission: true,
  showAbsorption: true,
  zoom: { nm0: VIS0, nm1: VIS1 },
  cursorNm: null,
  drag: null,           // { startX, startNm0, startNm1 } while dragging a strip
  ovDrag: null,         // { startX, startNm0 } while dragging the overview bar
};

// ── Colour helpers ─────────────────────────────────────────────────────────────

function wavelengthToRGBnm(nm) {
  let R = 0, G = 0, B = 0;
  const lam = Math.max(380, Math.min(780, nm));
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

// ── Coordinate helpers ─────────────────────────────────────────────────────────

function lambdaToX(nm, z) {
  z = z || state.zoom;
  return STRIP_W.xL + (nm - z.nm0) / (z.nm1 - z.nm0) * (STRIP_W.xR - STRIP_W.xL);
}

function xToLambda(x, z) {
  z = z || state.zoom;
  return z.nm0 + (x - STRIP_W.xL) / (STRIP_W.xR - STRIP_W.xL) * (z.nm1 - z.nm0);
}

// Map nm to overview bar x (always full VIS0–VIS1).
function lambdaToOvX(nm) {
  return OV.xL + (nm - VIS0) / (VIS1 - VIS0) * (OV.xR - OV.xL);
}
function ovXToLambda(x) {
  return VIS0 + (x - OV.xL) / (OV.xR - OV.xL) * (VIS1 - VIS0);
}

function inStrip(x, y) {
  if (x < STRIP_W.xL || x > STRIP_W.xR) return false;
  return (y >= SE.y0 && y <= SE.y1) || (y >= SA.y0 && y <= SA.y1);
}

function inOverview(x, y) {
  return x >= OV.xL && x <= OV.xR && y >= OV.y0 && y <= OV.y1 + 6;
}

// ── Strip rendering ────────────────────────────────────────────────────────────
// Vector approach: gradient glow + crisp 2px core rect per line.
// Crisp at every zoom level; no per-pixel loop or temp canvas needed.

// Glow half-width in pixels. Fixed in screen space so lines always look the
// same regardless of zoom — they don't widen as you zoom in.
const GLOW_PX = 8;

function rainbowGradient(x0, x1, nm0, nm1) {
  const grd = ctx.createLinearGradient(x0, 0, x1, 0);
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const nm = nm0 + t * (nm1 - nm0);
    // Edge fade: dim first/last ~14 nm so the strip blends into the dark bg.
    const edge = Math.min(1,
      Math.min((nm - VIS0) / 14, 1) * Math.min((VIS1 - nm) / 14, 1));
    const [r, g, b] = wavelengthToRGBnm(nm);
    grd.addColorStop(t,
      `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},${edge.toFixed(3)})`);
  }
  return grd;
}

function drawLineVectors(strip, lines, mode) {
  const y0 = strip.y0 + 2;
  const sh = strip.y1 - strip.y0 - 4;

  for (const { nm, w } of lines) {
    const x = lambdaToX(nm);
    if (x < STRIP_W.xL - GLOW_PX || x > STRIP_W.xR + GLOW_PX) continue;

    const [r, g, b] = wavelengthToRGBnm(nm);
    const ri = (r * 255) | 0, gi = (g * 255) | 0, bi = (b * 255) | 0;

    if (mode === 'emission') {
      // Glow: fixed alpha so all lines appear the same width; only core varies by w.
      const grd = ctx.createLinearGradient(x - GLOW_PX, 0, x + GLOW_PX, 0);
      grd.addColorStop(0,   `rgba(${ri},${gi},${bi},0)`);
      grd.addColorStop(0.5, `rgba(${ri},${gi},${bi},0.28)`);
      grd.addColorStop(1,   `rgba(${ri},${gi},${bi},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(x - GLOW_PX, y0, GLOW_PX * 2, sh);
      // Crisp core — brightness encodes intensity.
      ctx.fillStyle = `rgba(${ri},${gi},${bi},${w.toFixed(3)})`;
      ctx.fillRect(x - 1, y0, 2, sh);
      // White highlight on the very centre.
      ctx.fillStyle = `rgba(255,255,255,${(w * 0.55).toFixed(3)})`;
      ctx.fillRect(x, y0, 1, sh);
    } else {
      // Dark glow: fixed alpha; core darkness encodes intensity.
      const grd = ctx.createLinearGradient(x - GLOW_PX, 0, x + GLOW_PX, 0);
      grd.addColorStop(0,   'rgba(0,0,0,0)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0.35)');
      grd.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x - GLOW_PX, y0, GLOW_PX * 2, sh);
      // Crisp dark core.
      ctx.fillStyle = `rgba(0,0,0,${(w * 0.92).toFixed(3)})`;
      ctx.fillRect(x - 1, y0, 2, sh);
    }
  }
}

function drawStrip(strip, mode, active) {
  const sw = strip.xR - strip.xL;
  const sh = strip.y1 - strip.y0;

  ctx.save();

  if (!active) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(strip.xL, strip.y0, sw, sh);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(strip.xL + 0.5, strip.y0 + 0.5, sw - 1, sh - 1);
    ctx.fillStyle = 'rgba(140, 160, 200, 0.35)';
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mode === 'emission' ? 'Emission' : 'Absorption'} — off`,
      STRIP_W.xL + sw / 2, strip.y0 + sh / 2);
    ctx.restore();
    return;
  }

  const el = ELEMENTS[state.elemIdx];
  const z  = state.zoom;

  if (mode === 'absorption') {
    // Rainbow background clipped to the zoomed view.
    const nm0vis = Math.max(VIS0, z.nm0);
    const nm1vis = Math.min(VIS1, z.nm1);
    const x0 = lambdaToX(nm0vis);
    const x1 = lambdaToX(nm1vis);
    ctx.fillStyle = '#000';
    ctx.fillRect(strip.xL, strip.y0, sw, sh);
    ctx.fillStyle = rainbowGradient(x0, x1, nm0vis, nm1vis);
    ctx.fillRect(x0, strip.y0, x1 - x0, sh);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(strip.xL, strip.y0, sw, sh);
  }

  // Clip line drawing to strip bounds.
  ctx.save();
  ctx.beginPath();
  ctx.rect(strip.xL, strip.y0, sw, sh);
  ctx.clip();
  drawLineVectors(strip, el.lines, mode);
  ctx.restore();

  // Border.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(strip.xL + 0.5, strip.y0 + 0.5, sw - 1, sh - 1);

  ctx.restore();
}

// ── Overview bar ───────────────────────────────────────────────────────────────

function drawOverview() {
  const sw = OV.xR - OV.xL;
  const sh = OV.y1 - OV.y0;

  ctx.save();

  // Rainbow gradient across the full visible range.
  const grd = ctx.createLinearGradient(OV.xL, 0, OV.xR, 0);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const nm = VIS0 + t * (VIS1 - VIS0);
    const [r, g, b] = wavelengthToRGBnm(nm);
    grd.addColorStop(t, `rgb(${(r*255)|0},${(g*255)|0},${(b*255)|0})`);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(OV.xL, OV.y0, sw, sh);

  // Dim lines for the current element over the overview.
  const el = ELEMENTS[state.elemIdx];
  ctx.strokeStyle = 'rgba(0,0,0,0.50)';
  ctx.lineWidth = 1;
  for (const { nm } of el.lines) {
    const x = lambdaToOvX(nm);
    if (x < OV.xL || x > OV.xR) continue;
    ctx.beginPath();
    ctx.moveTo(x, OV.y0);
    ctx.lineTo(x, OV.y1);
    ctx.stroke();
  }

  // Zoom window highlight.
  const wx0 = lambdaToOvX(state.zoom.nm0);
  const wx1 = lambdaToOvX(state.zoom.nm1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fillRect(wx0, OV.y0, wx1 - wx0, sh);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.70)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(wx0 + 0.5, OV.y0 + 0.5, wx1 - wx0 - 1, sh - 1);

  // Overview border.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(OV.xL + 0.5, OV.y0 + 0.5, sw - 1, sh - 1);

  // "full range" label.
  ctx.fillStyle = 'rgba(140, 160, 200, 0.55)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Overview  (380–780 nm)', OV.xL, OV.y0 - 3);

  ctx.restore();
}

// ── Wavelength axis ────────────────────────────────────────────────────────────

function niceStep(range) {
  // Pick the largest step from this list that gives ≥ 4 divisions.
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (range / steps[i] >= 4) return steps[i];
  }
  return steps[0];
}

function drawAxis() {
  const z     = state.zoom;
  const range = z.nm1 - z.nm0;
  const majStep = niceStep(range);
  const minStep = majStep / 5;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  // Axis line.
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.40)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(STRIP_W.xL, AXIS_Y);
  ctx.lineTo(STRIP_W.xR, AXIS_Y);
  ctx.stroke();

  // Compute first tick aligned to the grid.
  const firstMaj = Math.ceil(z.nm0 / majStep) * majStep;
  const firstMin = Math.ceil(z.nm0 / minStep) * minStep;

  // Minor ticks.
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.20)';
  ctx.lineWidth = 1;
  for (let nm = firstMin; nm <= z.nm1 + 1e-9; nm += minStep) {
    const x = lambdaToX(nm);
    if (x < STRIP_W.xL || x > STRIP_W.xR) continue;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_Y);
    ctx.lineTo(x, AXIS_Y + 4);
    ctx.stroke();
  }

  // Major ticks + labels.
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.55)';
  ctx.fillStyle   = 'rgba(180, 200, 240, 0.80)';
  ctx.font        = '600 11px "Trebuchet MS", sans-serif';
  for (let nm = firstMaj; nm <= z.nm1 + 1e-9; nm += majStep) {
    const x = lambdaToX(nm);
    if (x < STRIP_W.xL || x > STRIP_W.xR) continue;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_Y);
    ctx.lineTo(x, AXIS_Y + 8);
    ctx.stroke();

    // Label: show decimals only when step < 1.
    const label = majStep < 1 ? nm.toFixed(1) : String(Math.round(nm));
    ctx.fillText(label, x, AXIS_Y + 10);
  }

  // Axis unit label.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(140, 165, 205, 0.60)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.fillText('λ (nm)', STRIP_W.xR, AXIS_Y + 10);

  ctx.restore();
}

// ── Strip labels ───────────────────────────────────────────────────────────────

function drawStripLabels() {
  ctx.save();
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';

  const el = ELEMENTS[state.elemIdx];

  // Emission label + element name.
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = state.showEmission
    ? 'rgba(180, 200, 240, 0.80)'
    : 'rgba(140, 160, 200, 0.35)';
  ctx.fillText('EMISSION', STRIP_W.xL, SE.y0 - 4);

  ctx.fillStyle = state.showEmission
    ? el.colour
    : 'rgba(140, 160, 200, 0.25)';
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${el.name}  (${el.sym})`, STRIP_W.xR, SE.y0 - 4);

  // Absorption label.
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = state.showAbsorption
    ? 'rgba(180, 200, 240, 0.80)'
    : 'rgba(140, 160, 200, 0.35)';
  ctx.fillText('ABSORPTION', STRIP_W.xL, SA.y0 - 4);

  ctx.restore();
}

// ── Cursor ─────────────────────────────────────────────────────────────────────

function drawCursor() {
  if (state.cursorNm === null) return;
  const nm = state.cursorNm;
  const x  = lambdaToX(nm);
  if (x < STRIP_W.xL || x > STRIP_W.xR) return;

  ctx.save();

  // Hairline through both strips + axis area.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.60)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, SE.y0);
  ctx.lineTo(x, AXIS_Y + 22);
  ctx.stroke();
  ctx.setLineDash([]);

  // Top/bottom edge ticks on each strip.
  const drawEdgeTicks = (strip) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.80)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 4, strip.y0); ctx.lineTo(x + 4, strip.y0);
    ctx.moveTo(x - 4, strip.y1); ctx.lineTo(x + 4, strip.y1);
    ctx.stroke();
  };
  drawEdgeTicks(SE);
  drawEdgeTicks(SA);

  // λ readout pill above the emission strip.
  const label = `${nm.toFixed(2)} nm`;
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  const tw = ctx.measureText(label).width;
  const lx = Math.min(Math.max(x - tw / 2 - 4, STRIP_W.xL), STRIP_W.xR - tw - 8);
  const ly = SE.y0 - 20;
  ctx.fillStyle = 'rgba(10, 22, 40, 0.80)';
  ctx.beginPath();
  ctx.roundRect(lx, ly, tw + 8, 16, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, lx + 4, ly + 2);

  ctx.restore();
}

// ── Scene note ─────────────────────────────────────────────────────────────────

function drawSceneNote() {
  const text = 'Scroll to zoom · Drag to pan · Click overview to re-centre';
  ctx.save();
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(10, 22, 40, 0.55)';
  ctx.beginPath();
  ctx.roundRect(STRIP_W.xL, H - 20, tw + 14, 16, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(160, 185, 220, 0.80)';
  ctx.fillText(text, STRIP_W.xL + 7, H - 5);
  ctx.restore();
}

// ── Main render ────────────────────────────────────────────────────────────────

function render() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);

  drawStripLabels();
  drawStrip(SE, 'emission',   state.showEmission);
  drawStrip(SA, 'absorption', state.showAbsorption);
  drawOverview();
  drawAxis();
  drawCursor();
  drawSceneNote();
}

// ── Zoom / pan helpers ─────────────────────────────────────────────────────────

const MIN_RANGE = 1.5;   // nm — minimum zoom window

function clampZoom(nm0, nm1) {
  const range = Math.max(MIN_RANGE, Math.min(VIS1 - VIS0, nm1 - nm0));
  nm0 = Math.max(VIS0, Math.min(VIS1 - range, nm0));
  nm1 = nm0 + range;
  return { nm0, nm1 };
}

function zoomAroundNm(pivotNm, factor) {
  const { nm0, nm1 } = state.zoom;
  const range = (nm1 - nm0) * factor;
  const t = (pivotNm - nm0) / (nm1 - nm0);  // pivot fraction (0–1)
  const newNm0 = pivotNm - t * range;
  const newNm1 = newNm0 + range;
  state.zoom = clampZoom(newNm0, newNm1);
}

function setZoom(nm0, nm1) {
  state.zoom = clampZoom(nm0, nm1);
}

// ── Canvas pixel coordinates from event ───────────────────────────────────────

function canvasXY(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (W / rect.width),
    y: (evt.clientY - rect.top)  * (H / rect.height),
  };
}

// ── Events ─────────────────────────────────────────────────────────────────────

// Scroll-wheel zoom centred on cursor.
canvas.addEventListener('wheel', evt => {
  evt.preventDefault();
  const { x, y } = canvasXY(evt);
  if (x < STRIP_W.xL || x > STRIP_W.xR) return;
  const pivotNm = (y >= OV.y0 && y <= OV.y1 + 6)
    ? ovXToLambda(x)
    : xToLambda(x);
  const factor = evt.deltaY > 0 ? 1.18 : 1 / 1.18;
  zoomAroundNm(pivotNm, factor);
  updateRangeReadout();
  render();
}, { passive: false });

// Mouse down — start drag on strip or overview.
canvas.addEventListener('mousedown', evt => {
  const { x, y } = canvasXY(evt);

  if (inOverview(x, y)) {
    // Click overview: re-centre zoom window on this λ (keep current range).
    const clickNm = ovXToLambda(x);
    const half = (state.zoom.nm1 - state.zoom.nm0) / 2;
    state.zoom = clampZoom(clickNm - half, clickNm + half);
    state.ovDrag = { startX: x, startNm0: state.zoom.nm0 };
    updateRangeReadout();
    render();
    return;
  }

  if (inStrip(x, y)) {
    state.drag = { startX: x, startNm0: state.zoom.nm0, startNm1: state.zoom.nm1 };
    canvas.classList.add('grabbing');
  }
});

canvas.addEventListener('mousemove', evt => {
  const { x, y } = canvasXY(evt);

  if (state.drag) {
    const dNm = (state.drag.startX - x) / (STRIP_W.xR - STRIP_W.xL)
                * (state.drag.startNm1 - state.drag.startNm0);
    const range = state.drag.startNm1 - state.drag.startNm0;
    state.zoom = clampZoom(state.drag.startNm0 + dNm, state.drag.startNm0 + dNm + range);
    updateRangeReadout();
    render();
    return;
  }

  if (state.ovDrag) {
    const dNm = (x - state.ovDrag.startX) / (OV.xR - OV.xL) * (VIS1 - VIS0);
    const range = state.zoom.nm1 - state.zoom.nm0;
    state.zoom = clampZoom(state.ovDrag.startNm0 + dNm, state.ovDrag.startNm0 + dNm + range);
    updateRangeReadout();
    render();
    return;
  }

  // Cursor tracking.
  if (inStrip(x, y)) {
    state.cursorNm = xToLambda(x);
    document.getElementById('rd-lambda').innerHTML =
      `${state.cursorNm.toFixed(2)} <span class="readout-unit">nm</span>`;
  } else {
    state.cursorNm = null;
    document.getElementById('rd-lambda').innerHTML = '— <span class="readout-unit">nm</span>';
  }
  render();
});

canvas.addEventListener('mouseup', () => {
  state.drag   = null;
  state.ovDrag = null;
  canvas.classList.remove('grabbing');
});

canvas.addEventListener('mouseleave', () => {
  state.drag     = null;
  state.ovDrag   = null;
  state.cursorNm = null;
  canvas.classList.remove('grabbing');
  document.getElementById('rd-lambda').innerHTML = '— <span class="readout-unit">nm</span>';
  render();
});

// ── Preset data ────────────────────────────────────────────────────────────────
// always: true → shown regardless of element. Otherwise shown only when the
// current element has at least one line within [nm0, nm1].

const PRESETS = [
  { label: 'Full visible',  nm0: 380, nm1: 780, always: true },
  { label: 'Ca H&K',        nm0: 386, nm1: 406 },
  { label: 'Hβ–Hγ', nm0: 428, nm1: 494 },
  { label: 'Mg b triplet',  nm0: 513, nm1: 523 },
  { label: 'Na D doublet',  nm0: 583, nm1: 596 },
  { label: 'Hα',       nm0: 648, nm1: 664 },
  { label: 'K / Ar red',    nm0: 762, nm1: 775 },
];

// ── Controls wiring ────────────────────────────────────────────────────────────

function populateElementSelect() {
  const sel = document.getElementById('sel-element');
  ELEMENTS.forEach((el, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${el.sym} — ${el.name}`;
    sel.appendChild(opt);
  });
}

function buildPresets() {
  const grid = document.getElementById('preset-grid');
  PRESETS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className    = 'preset-btn';
    btn.type         = 'button';
    btn.dataset.idx  = i;
    btn.textContent  = p.label;
    btn.addEventListener('click', () => {
      setZoom(p.nm0, p.nm1);
      updateRangeReadout();
      render();
    });
    grid.appendChild(btn);
  });
}

function updatePresets() {
  const el = ELEMENTS[state.elemIdx];
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const p = PRESETS[Number(btn.dataset.idx)];
    const relevant = p.always || el.lines.some(l => l.nm >= p.nm0 && l.nm <= p.nm1);
    btn.style.display = relevant ? '' : 'none';
  });
}

document.getElementById('sel-element').addEventListener('change', e => {
  state.elemIdx = Number(e.target.value);
  updatePresets();
  render();
});

function wireShowBtn(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    render();
  });
}
wireShowBtn('btn-emission',   'showEmission');
wireShowBtn('btn-absorption', 'showAbsorption');

function updateRangeReadout() {
  const { nm0, nm1 } = state.zoom;
  document.getElementById('rd-range').innerHTML =
    `${nm0.toFixed(nm1 - nm0 < 5 ? 1 : 0)}–${nm1.toFixed(nm1 - nm0 < 5 ? 1 : 0)} <span class="readout-unit">nm</span>`;
}

// ── Init ───────────────────────────────────────────────────────────────────────

populateElementSelect();
buildPresets();
updatePresets();
updateRangeReadout();
render();
