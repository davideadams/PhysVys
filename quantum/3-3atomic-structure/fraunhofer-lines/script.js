// Fraunhofer Lines — solar spectrum with element-overlay matching game.
// Static sim: no animation loop. render() called on every state change.

const canvas = document.getElementById('spec-canvas');
const ctx    = canvas.getContext('2d');
const W = 960, H = 600;

// ── Pixel geometry ────────────────────────────────────────────────────────────

// Visible wavelength range mapped to the spectrum strip.
const VIS = { nm0: 380, nm1: 780 };

// Strip: the rainbow/dark-plate region where lines appear.
const STRIP = { xL: 30, xR: 930, y0: 90, y1: 230 };

// Wavelength axis sits just below the strip.
const AXIS = { y: 260, tickMaj: 70, tickMin: 20 };

// Element overlay rows: one fixed-height row per element, stacked below axis.
const OVERLAY_TOP = 300;
const OVERLAY_ROW_H = 28;

// Fraunhofer letter labels appear above the strip at these standard solar lines.
// O₂ telluric band B is included to illustrate atmospheric vs solar absorption.
const FRAUNHOFER = [
  { letter: 'K',  nm: 393.4,  note: 'Ca II' },
  { letter: 'H',  nm: 396.8,  note: 'Ca II' },
  { letter: 'G',  nm: 430.8,  note: 'Fe/CH' },
  { letter: 'F',  nm: 486.1,  note: 'Hβ' },
  { letter: 'b',  nm: 517.3,  note: 'Mg' },
  { letter: 'E',  nm: 527.0,  note: 'Fe' },
  { letter: 'D',  nm: 589.3,  note: 'Na' },
  { letter: 'C',  nm: 656.3,  note: 'Hα' },
  { letter: 'B',  nm: 686.7,  note: 'O₂*', telluric: true },
];

// ── Element data ──────────────────────────────────────────────────────────────
// w = relative oscillator strength (0–1), used to scale line darkness.

const ALL_ELEMS = ['H', 'He', 'Ne', 'Na', 'Mg', 'K', 'Ca', 'Ti', 'Fe', 'Hg'];

const ELEMENTS = {
  H:  { name: 'Hydrogen',  colour: '#6699ff',
        lines: [{nm:410.2,w:0.20},{nm:434.0,w:0.30},{nm:486.1,w:0.60},{nm:656.3,w:1.00}] },
  Na: { name: 'Sodium',    colour: '#ffcc33',
        lines: [{nm:589.0,w:1.00},{nm:589.6,w:0.95}] },
  Mg: { name: 'Magnesium', colour: '#55ddaa',
        lines: [{nm:516.7,w:0.60},{nm:517.3,w:0.80},{nm:518.4,w:0.70}] },
  Ca: { name: 'Calcium',   colour: '#ff88bb',
        lines: [{nm:393.4,w:1.00},{nm:396.8,w:0.90}] },
  Fe: { name: 'Iron',      colour: '#ffaa55',
        lines: [{nm:438.4,w:0.45},{nm:489.1,w:0.40},{nm:495.8,w:0.50},
                {nm:527.0,w:0.60},{nm:532.8,w:0.40},{nm:540.4,w:0.35}] },
  He: { name: 'Helium',    colour: '#aaccff',
        lines: [{nm:587.6,w:0.30}] },
  Ne: { name: 'Neon',      colour: '#ff5533',
        lines: [{nm:585.2,w:0.75},{nm:614.3,w:0.90},{nm:640.2,w:0.70},{nm:703.2,w:0.55}] },
  Hg: { name: 'Mercury',   colour: '#cc99ff',
        lines: [{nm:404.7,w:0.65},{nm:435.8,w:0.90},{nm:546.1,w:1.00},{nm:577.0,w:0.55},{nm:579.1,w:0.50}] },
  K:  { name: 'Potassium', colour: '#dd77ff',
        lines: [{nm:404.4,w:0.45},{nm:766.5,w:1.00},{nm:769.9,w:0.80}] },
  Ti: { name: 'Titanium',  colour: '#88bbdd',
        lines: [{nm:453.4,w:0.35},{nm:499.1,w:0.30},{nm:519.3,w:0.45},{nm:521.0,w:0.40}] },
};

// ── Source definitions ────────────────────────────────────────────────────────
// composition: elements present in an absorbing source, keyed by element symbol.
// emission:    elements emitting in a dark-background lamp source.
// z:           cosmological redshift applied to ALL lines in the spectrum display.
//              Element overlay ticks are always drawn at rest-frame wavelengths,
//              so the student must notice and account for the shift themselves.

const SOURCES = {
  sun: {
    label: 'Sun',
    continuum: true,
    z: 0,
    composition: { H:1.00, Na:0.55, Mg:0.50, Ca:0.75, Fe:0.85, He:0.12 },
    note: 'Sunlight dispersed through a diffraction grating.',
  },
  hLamp: {
    label: 'Lab: H lamp',
    continuum: false,
    z: 0,
    emission: { H: 1.0 },
    note: 'Hydrogen discharge lamp — emission spectrum only.',
  },
  naLamp: {
    label: 'Lab: Na lamp',
    continuum: false,
    z: 0,
    emission: { Na: 1.0 },
    note: 'Sodium discharge lamp — emission spectrum only.',
  },
  unknown: {
    label: 'Unknown star',
    continuum: true,
    z: 0.04,
    composition: { H:1.00, Na:0.55, Mg:0.50, Ca:0.75, Fe:0.85, He:0.12 },
    note: 'Spectrum of a distant star recorded by an automated telescope.',
  },
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  sourceKey: 'sun',
  enabledElements: new Set(),
  showFraunhofer: false,
  cursorNm: null,
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

// ── Coordinate helpers ────────────────────────────────────────────────────────

function lambdaToX(nm) {
  return STRIP.xL + (nm - VIS.nm0) / (VIS.nm1 - VIS.nm0) * (STRIP.xR - STRIP.xL);
}

function xToLambda(x) {
  return VIS.nm0 + (x - STRIP.xL) / (STRIP.xR - STRIP.xL) * (VIS.nm1 - VIS.nm0);
}

function inStrip(x) {
  return x >= STRIP.xL && x <= STRIP.xR;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function clearBg() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
}

function drawStrip() {
  const src = SOURCES[state.sourceKey];
  const sh  = STRIP.y1 - STRIP.y0;
  const sw  = STRIP.xR - STRIP.xL;

  ctx.save();

  if (src.continuum) {
    // Build per-pixel image for full control over line darkness.
    // Resolution: 1px per x column in the strip.
    const imgData = ctx.createImageData(sw, sh);
    const buf = imgData.data;

    // Pre-compute absorption line list shifted by source redshift.
    const absorbers = [];
    for (const [sym, compW] of Object.entries(src.composition)) {
      for (const {nm, w} of ELEMENTS[sym].lines) {
        absorbers.push({ nm: nm * (1 + src.z), absW: compW * w });
      }
    }

    for (let px = 0; px < sw; px++) {
      const nm = xToLambda(STRIP.xL + px);
      let [R, G, B] = wavelengthToRGBnm(nm);

      // Darken for absorption lines using a narrow Lorentzian profile.
      // Physical half-width in px units ≈ 2 px → ~0.9 nm at this scale.
      let darkness = 0;
      for (const { nm: lnm, absW } of absorbers) {
        const dpx = Math.abs(px - (lambdaToX(lnm) - STRIP.xL));
        const d = absW * Math.exp(-dpx * dpx / 2.2);
        darkness = Math.min(1, darkness + d);
      }
      R *= (1 - darkness * 0.96);
      G *= (1 - darkness * 0.96);
      B *= (1 - darkness * 0.96);

      // Brightness roll-off near vis edges to blend into dark shoulders.
      const edgeFade = Math.min(1,
        Math.min((nm - VIS.nm0) / 18, 1) *
        Math.min((VIS.nm1 - nm) / 18, 1)
      );
      R *= edgeFade; G *= edgeFade; B *= edgeFade;

      for (let row = 0; row < sh; row++) {
        const idx = (row * sw + px) * 4;
        buf[idx]   = (R * 255) | 0;
        buf[idx+1] = (G * 255) | 0;
        buf[idx+2] = (B * 255) | 0;
        buf[idx+3] = 255;
      }
    }

    // Blit into a temp canvas, then drawImage to the real canvas.
    const tmp = document.createElement('canvas');
    tmp.width  = sw;
    tmp.height = sh;
    tmp.getContext('2d').putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, STRIP.xL, STRIP.y0);

  } else {
    // Emission lamp: dark background + bright lines.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(STRIP.xL, STRIP.y0, sw, sh);

    const src2 = src;
    for (const [sym, emitW] of Object.entries(src2.emission)) {
      for (const {nm, w} of ELEMENTS[sym].lines) {
        const [R, G, B] = wavelengthToRGBnm(nm);
        const x = lambdaToX(nm);
        const alpha = emitW * w;
        // Glow: wide soft halo + narrow bright core.
        const grd = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
        grd.addColorStop(0,   `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},0)`);
        grd.addColorStop(0.4, `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},${alpha*0.4})`);
        grd.addColorStop(0.5, `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},${alpha})`);
        grd.addColorStop(0.6, `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},${alpha*0.4})`);
        grd.addColorStop(1,   `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(x - 12, STRIP.y0 + 2, 24, sh - 4);
        // Bright 2px core.
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.fillRect(x - 1, STRIP.y0 + 4, 2, sh - 8);
      }
    }
  }

  // Strip border.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(STRIP.xL + 0.5, STRIP.y0 + 0.5, sw - 1, sh - 1);

  ctx.restore();
}

function drawAxis() {
  const y = AXIS.y;
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.45)';
  ctx.fillStyle   = 'rgba(180, 200, 240, 0.80)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;

  // Draw axis line.
  ctx.beginPath();
  ctx.moveTo(STRIP.xL, y);
  ctx.lineTo(STRIP.xR, y);
  ctx.stroke();

  for (let nm = 400; nm <= 760; nm += 10) {
    const x = lambdaToX(nm);
    const isMaj = nm % 50 === 0;
    const tickLen = isMaj ? 8 : 4;
    ctx.strokeStyle = isMaj
      ? 'rgba(200, 220, 255, 0.65)'
      : 'rgba(200, 220, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + tickLen);
    ctx.stroke();
    if (isMaj) {
      ctx.fillStyle = 'rgba(180, 200, 240, 0.80)';
      ctx.fillText(`${nm}`, x, y + 11);
    }
  }

  // Axis label.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(140, 170, 210, 0.70)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.fillText('λ (nm)', STRIP.xR, y + 11);

  ctx.restore();
}

function drawFraunhoferLetters() {
  if (!state.showFraunhofer) return;
  const src = SOURCES[state.sourceKey];
  if (!src.continuum || src.z !== 0) return; // Only for Sun (rest-frame continuum)

  ctx.save();
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';

  for (const { letter, nm, telluric } of FRAUNHOFER) {
    const x = lambdaToX(nm);
    if (x < STRIP.xL || x > STRIP.xR) continue;

    const [R, G, B] = wavelengthToRGBnm(nm);
    const baseAlpha = telluric ? 0.55 : 0.90;

    // Short tick from strip top upward.
    ctx.strokeStyle = `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},${baseAlpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, STRIP.y0 - 2);
    ctx.lineTo(x, STRIP.y0 - 16);
    ctx.stroke();

    // Letter.
    ctx.fillStyle = `rgba(${(R*255)|0},${(G*255)|0},${(B*255)|0},${baseAlpha})`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(letter, x, STRIP.y0 - 17);

    // Telluric asterisk sub-label.
    if (telluric) {
      ctx.font = '600 9px "Trebuchet MS", sans-serif';
      ctx.fillStyle = 'rgba(160, 180, 220, 0.50)';
      ctx.fillText('atm', x, STRIP.y0 - 29);
      ctx.font = '700 11px "Trebuchet MS", sans-serif';
    }
  }

  ctx.restore();
}

function drawElementOverlays() {
  if (state.enabledElements.size === 0) return;

  const allElems = ALL_ELEMS;
  let rowIndex = 0;

  ctx.save();

  for (const sym of allElems) {
    if (!state.enabledElements.has(sym)) { rowIndex++; continue; }

    const el   = ELEMENTS[sym];
    const rowY = OVERLAY_TOP + rowIndex * OVERLAY_ROW_H;
    const tickH = 14;
    const tickY0 = rowY + (OVERLAY_ROW_H - tickH) / 2;

    // Element label on the left.
    ctx.fillStyle = el.colour;
    ctx.font = '700 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.name, 2, rowY + OVERLAY_ROW_H / 2);

    for (const { nm, w } of el.lines) {
      const x = lambdaToX(nm);
      if (x < STRIP.xL || x > STRIP.xR) continue;

      const alpha = 0.55 + 0.45 * w;

      const [rr, gg, bb] = hexToRgb(el.colour);
      // Vertical guide from tick up to the spectrum strip bottom.
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alpha * 0.22})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, STRIP.y1 + 4);
      ctx.lineTo(x, tickY0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tick mark.
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, tickY0);
      ctx.lineTo(x, tickY0 + tickH);
      ctx.stroke();
    }

    rowIndex++;
  }

  ctx.restore();
}

function drawCursor() {
  if (state.cursorNm === null) return;
  const x = lambdaToX(state.cursorNm);
  if (x < STRIP.xL || x > STRIP.xR) return;

  ctx.save();

  // Vertical hair line through the whole strip height + axis area.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.70)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, STRIP.y0);
  ctx.lineTo(x, AXIS.y + 32);
  ctx.stroke();
  ctx.setLineDash([]);

  // Horizontal rule across the strip at cursor level (shows position within strip height).
  // Instead: simple top-of-strip tick.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.90)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 4, STRIP.y0);
  ctx.lineTo(x + 4, STRIP.y0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 4, STRIP.y1);
  ctx.lineTo(x + 4, STRIP.y1);
  ctx.stroke();

  // Lambda label above strip.
  const label = `${state.cursorNm.toFixed(1)} nm`;
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  const tw = ctx.measureText(label).width;
  const lx = Math.min(Math.max(x - tw / 2, STRIP.xL + 2), STRIP.xR - tw - 2);
  const ly = STRIP.y0 - (state.showFraunhofer ? 46 : 22);

  ctx.fillStyle = 'rgba(10, 22, 40, 0.72)';
  ctx.beginPath();
  ctx.roundRect(lx - 4, ly - 2, tw + 8, 16, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, lx, ly);

  ctx.restore();
}

function drawSceneNote() {
  const src = SOURCES[state.sourceKey];
  ctx.save();
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const text = src.note + (src.z > 0 ? '  |  * Element overlays shown at rest-frame λ.' : '');
  const tw = ctx.measureText(text).width;

  ctx.fillStyle = 'rgba(10, 22, 40, 0.62)';
  ctx.beginPath();
  ctx.roundRect(STRIP.xL, H - 22, tw + 16, 18, 6);
  ctx.fill();

  ctx.fillStyle = 'rgba(170, 195, 230, 0.88)';
  ctx.fillText(text, STRIP.xL + 8, H - 6);

  ctx.restore();
}

function drawSectionHeaders() {
  ctx.save();
  ctx.font = '700 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // "Spectrum" label above the strip.
  const src = SOURCES[state.sourceKey];
  const stripLabel = src.continuum ? 'Source spectrum' : 'Emission lines';
  ctx.fillStyle = 'rgba(140, 165, 205, 0.70)';
  ctx.fillText(stripLabel.toUpperCase(), STRIP.xL, STRIP.y0 - (state.showFraunhofer ? 62 : 5) + (state.showFraunhofer ? 0 : -14));

  // Label for overlay section if anything is toggled.
  if (state.enabledElements.size > 0) {
    ctx.fillStyle = 'rgba(140, 165, 205, 0.55)';
    ctx.fillText('ELEMENT OVERLAYS', STRIP.xL, OVERLAY_TOP - 16);
  }

  ctx.restore();
}

// ── Main render ────────────────────────────────────────────────────────────────

function render() {
  clearBg();
  drawSectionHeaders();
  drawStrip();
  drawAxis();
  drawFraunhoferLetters();
  drawElementOverlays();
  drawCursor();
  drawSceneNote();
}

// ── Utility ────────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// ── UI wiring ─────────────────────────────────────────────────────────────────

function buildElementButtons() {
  const container = document.getElementById('elem-grid');
  for (const sym of ALL_ELEMS) {
    const el  = ELEMENTS[sym];
    const btn = document.createElement('button');
    btn.className  = 'elem-btn';
    btn.type       = 'button';
    btn.dataset.sym = sym;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = el.colour;

    btn.appendChild(swatch);
    btn.appendChild(document.createTextNode(el.name));
    container.appendChild(btn);

    btn.addEventListener('click', () => {
      const active = state.enabledElements.has(sym);
      if (active) {
        state.enabledElements.delete(sym);
        btn.classList.remove('active');
      } else {
        state.enabledElements.add(sym);
        btn.classList.add('active');
      }
      render();
    });
  }
}

function updateFraunhoferToggle() {
  const src = SOURCES[state.sourceKey];
  const btn = document.getElementById('btn-fraunhofer');
  const available = src.continuum && src.z === 0;
  btn.disabled = !available;
  if (!available && state.showFraunhofer) {
    state.showFraunhofer = false;
    btn.dataset.active = 'false';
  }
}

document.getElementById('sel-source').addEventListener('change', e => {
  state.sourceKey = e.target.value;
  updateFraunhoferToggle();
  render();
});

document.getElementById('btn-fraunhofer').addEventListener('click', () => {
  const btn = document.getElementById('btn-fraunhofer');
  if (btn.disabled) return;
  state.showFraunhofer = !state.showFraunhofer;
  btn.dataset.active = String(state.showFraunhofer);
  render();
});

// ── Canvas mouse tracking ──────────────────────────────────────────────────────

function canvasNm(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const cx = (evt.clientX - rect.left) * scaleX;
  if (!inStrip(cx)) return null;
  return xToLambda(cx);
}

canvas.addEventListener('mousemove', evt => {
  const nm = canvasNm(evt);
  state.cursorNm = nm;
  const el = document.getElementById('rd-lambda');
  if (nm !== null) {
    el.innerHTML = `${nm.toFixed(1)} <span class="readout-unit">nm</span>`;
  } else {
    el.innerHTML = '— <span class="readout-unit">nm</span>';
  }
  render();
});

canvas.addEventListener('mouseleave', () => {
  state.cursorNm = null;
  document.getElementById('rd-lambda').innerHTML = '— <span class="readout-unit">nm</span>';
  render();
});

// ── Init ───────────────────────────────────────────────────────────────────────

buildElementButtons();
render();
