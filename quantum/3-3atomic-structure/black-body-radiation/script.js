'use strict';

// ─── Physical constants ───────────────────────────────────────────────────────
const H_P  = 6.626e-34;          // J·s  (Planck)
const C_L  = 2.998e8;            // m/s  (speed of light)
const K_B  = 1.381e-23;          // J/K  (Boltzmann)
const C1   = 2 * H_P * C_L * C_L; // 1.191e-16 W·sr⁻¹·m²
const C2   = H_P * C_L / K_B;     // 0.014388 m·K
const WIEN_B = 2.898e-3;           // m·K (displacement law)

// ─── Temperature range (log slider) ──────────────────────────────────────────
const T_MIN = 300, T_MAX = 15000;
function sliderToT(s) { return T_MIN * Math.pow(T_MAX / T_MIN, s); }
function TToSlider(T) { return Math.log(T / T_MIN) / Math.log(T_MAX / T_MIN); }

// ─── Wavelength plot range ────────────────────────────────────────────────────
const LAM_MIN = 100e-9, LAM_MAX = 3000e-9; // m

// ─── Spectral functions ───────────────────────────────────────────────────────
function planck(lam, T) {
  const ex = C2 / (lam * T);
  if (ex > 500) return 0;
  return C1 / (lam ** 5 * (Math.exp(ex) - 1));
}

function rayleighJeans(lam, T) {
  return 2 * C_L * K_B * T / lam ** 4;
}

function wienApprox(lam, T) {
  const ex = C2 / (lam * T);
  if (ex > 500) return 0;
  return C1 / lam ** 5 * Math.exp(-ex);
}

// ─── CIE 1931 CMF — Wyman 2013 Gaussian fit ──────────────────────────────────
function cieCMF(lam_nm) {
  function g(t, mu, s1, s2) {
    return Math.exp(-0.5 * ((t - mu) / (t < mu ? s1 : s2)) ** 2);
  }
  return [
    1.056*g(lam_nm,599.8,37.9,31.0) + 0.362*g(lam_nm,442.0,16.0,26.7) - 0.065*g(lam_nm,501.1,20.4,26.2),
    0.821*g(lam_nm,568.8,46.9,40.5) + 0.286*g(lam_nm,530.9,16.3,31.1),
    1.217*g(lam_nm,437.0,11.8,36.0) + 0.681*g(lam_nm,459.0,26.0,13.8),
  ];
}

// Convert blackbody temperature to normalised sRGB (hue only; brightness applied separately)
function tempToSRGB(T) {
  let X = 0, Y = 0, Z = 0;
  for (let lam = 380; lam <= 700; lam += 5) {
    const B = planck(lam * 1e-9, T);
    const [xb, yb, zb] = cieCMF(lam);
    X += B * xb; Y += B * yb; Z += B * zb;
  }
  if (Y < 1e-20) return [0.9, 0.05, 0]; // below visible: deep red
  const Xn = X / Y, Zn = Z / Y; // Y normalised to 1
  // XYZ → linear sRGB
  let r =  3.2406*Xn - 1.5372 - 0.4986*Zn;
  let g = -0.9689*Xn + 1.8758 + 0.0415*Zn;
  let b =  0.0557*Xn - 0.2040 + 1.0570*Zn;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  // Normalise to max channel so we get pure hue
  const mx = Math.max(r, g, b, 1e-9);
  // Gamma encode (sRGB)
  const gm = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return [gm(r / mx), gm(g / mx), gm(b / mx)];
}

// Visual glow brightness: near-zero below ~700 K, full by ~5000 K
function glowAlpha(T) {
  return Math.min(1, Math.pow(Math.max(0, T - 600) / 4400, 1.8));
}

// ─── Wavelength → approximate RGB (for visible-band shading) ─────────────────
function lamNmToRGB(lam) {
  let r = 0, g = 0, b = 0;
  if      (lam >= 380 && lam < 440) { r = (440 - lam) / 60; b = 1; }
  else if (lam >= 440 && lam < 490) { g = (lam - 440) / 50; b = 1; }
  else if (lam >= 490 && lam < 510) { g = 1; b = (510 - lam) / 20; }
  else if (lam >= 510 && lam < 580) { r = (lam - 510) / 70; g = 1; }
  else if (lam >= 580 && lam < 645) { r = 1; g = (645 - lam) / 65; }
  else if (lam >= 645 && lam <= 700) { r = 1; }
  let f = 1;
  if      (lam < 420) f = 0.3 + 0.7 * (lam - 380) / 40;
  else if (lam > 680) f = 0.3 + 0.7 * (700 - lam) / 20;
  return `rgb(${Math.round(255*r*f)},${Math.round(255*g*f)},${Math.round(255*b*f)})`;
}

// Spectral region name for peak wavelength
function spectralRegion(T) {
  const nm = WIEN_B / T * 1e9;
  if (nm <  10)   return 'X-ray / Extreme UV';
  if (nm <  100)  return 'Far ultraviolet';
  if (nm <  380)  return 'Ultraviolet';
  if (nm <  700)  return 'Visible';
  if (nm < 1400)  return 'Near infrared';
  if (nm < 3000)  return 'Mid infrared';
  return 'Far infrared';
}

// ─── Canvas + layout ──────────────────────────────────────────────────────────
const canvas = document.getElementById('bb-canvas');
const ctx    = canvas.getContext('2d');
const CW = canvas.width, CH = canvas.height; // 960 × 600

const GLOW_H = 168; // px — height of glow panel at top of canvas

// Plot margins (within the lower plot area)
const pL = 80, pR = CW - 32, pT = GLOW_H + 26, pB = CH - 44;
const pW = pR - pL, pH = pB - pT;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  T: 3000,
  showPlanck: true,
  showRJ: false,
  showWien: false,
  logScale: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const sliderT   = document.getElementById('slider-T');
const valTEl    = document.getElementById('val-T');
const rLmax     = document.getElementById('r-lmax');
const rRegion   = document.getElementById('r-region');
const rPower    = document.getElementById('r-power');
const btnPlanck = document.getElementById('btn-planck');
const btnRJ     = document.getElementById('btn-rj');
const btnWien   = document.getElementById('btn-wien');
const btnLinear = document.getElementById('btn-linear');
const btnLog    = document.getElementById('btn-log');

// ─── Coordinate helpers ───────────────────────────────────────────────────────
function lamToX(lam_m) {
  return pL + (lam_m - LAM_MIN) / (LAM_MAX - LAM_MIN) * pW;
}

function valToY(v, yMax) {
  if (state.logScale) {
    if (v <= 0) return pB + 20;
    const log = Math.log10(v / yMax); // 0 at peak, negative below
    if (log > 0.1) return pT - 20;   // RJ shooting above top
    if (log < -4)  return pB + 20;
    return pT + (log / -4) * pH;     // 0→pT, -4→pB
  }
  return pB - (v / yMax) * pH;
}

// ─── Rounded rect helper (cross-browser) ─────────────────────────────────────
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Draw: glowing body panel ─────────────────────────────────────────────────
function drawGlow(T) {
  // Background
  ctx.fillStyle = '#060f1a';
  ctx.fillRect(0, 0, CW, GLOW_H);

  const [r, g, b] = tempToSRGB(T);
  const alpha = glowAlpha(T);
  const ri = Math.round(r * 255), gi = Math.round(g * 255), bi = Math.round(b * 255);

  const cx = CW * 0.40, cy = GLOW_H / 2;

  // Outer atmospheric glow
  const grd1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 210);
  grd1.addColorStop(0, `rgba(${ri},${gi},${bi},${(alpha * 0.35).toFixed(3)})`);
  grd1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd1;
  ctx.fillRect(0, 0, CW, GLOW_H);

  // Inner corona
  const grd2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
  grd2.addColorStop(0, `rgba(${ri},${gi},${bi},${(alpha * 0.6).toFixed(3)})`);
  grd2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd2;
  ctx.fillRect(0, 0, CW, GLOW_H);

  // Glowing body rectangle
  const bw = 200, bh = 58;
  const bx = cx - bw / 2, by = cy - bh / 2;

  const bodyGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  const af = Math.min(1, alpha + 0.15);
  bodyGrad.addColorStop(0,   `rgba(${Math.min(255,ri+55)},${Math.min(255,gi+55)},${Math.min(255,bi+55)},${af.toFixed(3)})`);
  bodyGrad.addColorStop(0.5, `rgba(${ri},${gi},${bi},${af.toFixed(3)})`);
  bodyGrad.addColorStop(1,   `rgba(${Math.max(0,ri-30)},${Math.max(0,gi-30)},${Math.max(0,bi-30)},${(af*0.85).toFixed(3)})`);
  rrect(bx, by, bw, bh, 10);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Specular highlight
  const hiGrad = ctx.createLinearGradient(bx, by, bx, by + bh * 0.5);
  hiGrad.addColorStop(0, `rgba(255,255,255,${(alpha * 0.22).toFixed(3)})`);
  hiGrad.addColorStop(1, 'rgba(255,255,255,0)');
  rrect(bx, by, bw, bh * 0.55, 10);
  ctx.fillStyle = hiGrad;
  ctx.fill();

  // Region label above body
  ctx.font = '700 13px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = `rgba(${ri},${gi},${bi},${Math.min(1, alpha * 2 + 0.3).toFixed(3)})`;
  ctx.textAlign = 'center';
  ctx.fillText(`Peak: ${spectralRegion(T)}`, cx, by - 10);

  // Right-side info box
  const bxR = CW * 0.66, byR = 18;
  const lmax_nm = Math.round(WIEN_B / T * 1e9);

  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'left';
  ctx.fillText('Peak wavelength  (Wien)', bxR, byR + 15);

  ctx.font = '700 15px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const lmaxStr = lmax_nm >= 1000
    ? `${(lmax_nm / 1000).toFixed(2)} µm  (${lmax_nm} nm)`
    : `${lmax_nm} nm`;
  ctx.fillText(lmaxStr, bxR, byR + 33);

  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('Radiated power  (relative to Sun)', bxR, byR + 58);

  ctx.font = '700 15px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const relP = (T / 5778) ** 4;
  const relPStr = relP >= 100 ? relP.toFixed(0) + '×'
                : relP >= 10  ? relP.toFixed(1) + '×'
                : relP >= 0.01 ? relP.toFixed(3) + '×'
                : relP.toExponential(1) + '×';
  ctx.fillText(relPStr, bxR, byR + 76);

  ctx.textAlign = 'left';
}

// ─── Draw: spectrum plot ───────────────────────────────────────────────────────
function drawPlot() {
  const { T, showPlanck, showRJ, showWien, logScale } = state;

  // Plot background
  ctx.fillStyle = '#0a1520';
  ctx.fillRect(0, GLOW_H, CW, CH - GLOW_H);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, GLOW_H); ctx.lineTo(CW, GLOW_H); ctx.stroke();

  // ── Visible band shading ──
  const vx1 = lamToX(380e-9), vx2 = lamToX(700e-9);
  const bandGrad = ctx.createLinearGradient(vx1, 0, vx2, 0);
  for (let lam = 380; lam <= 700; lam += 8) {
    bandGrad.addColorStop((lam - 380) / 320, lamNmToRGB(lam));
  }
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = bandGrad;
  ctx.fillRect(vx1, pT, vx2 - vx1, pH);
  ctx.globalAlpha = 1;

  // Visible label
  ctx.font = '11px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.textAlign = 'center';
  ctx.fillText('Visible', (vx1 + vx2) / 2, pT - 7);

  // ── Axes ──
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pL, pT - 8); ctx.lineTo(pL, pB);
  ctx.lineTo(pR, pB);
  ctx.stroke();

  // x-axis ticks
  const xTicks = [200, 400, 600, 800, 1000, 1500, 2000, 2500, 3000];
  ctx.textAlign = 'center';
  for (const nm of xTicks) {
    const x = lamToX(nm * 1e-9);
    // grid line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.moveTo(x, pT); ctx.lineTo(x, pB);
    ctx.stroke();
    ctx.setLineDash([]);
    // tick
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.moveTo(x, pB); ctx.lineTo(x, pB + 5);
    ctx.stroke();
    // label
    ctx.font = '11px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(nm >= 1000 ? (nm / 1000).toFixed(1) + ' µm' : nm + ' nm', x, pB + 17);
  }

  // x-axis label
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillText('Wavelength', pL + pW / 2, pB + 32);

  // y-axis ticks
  ctx.textAlign = 'right';
  if (!logScale) {
    for (let f = 0; f <= 1.0; f += 0.25) {
      const y = pB - f * pH;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.moveTo(pL, y); ctx.lineTo(pR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(pL - 5, y); ctx.lineTo(pL, y);
      ctx.stroke();
      ctx.font = '11px "Trebuchet MS","Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(f.toFixed(2), pL - 8, y + 4);
    }
  } else {
    const logLabels = [[0,'1'],[-1,'10⁻¹'],[-2,'10⁻²'],[-3,'10⁻³'],[-4,'10⁻⁴']];
    for (const [logV, label] of logLabels) {
      const y = pT + (logV / -4) * pH;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.moveTo(pL, y); ctx.lineTo(pR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(pL - 5, y); ctx.lineTo(pL, y);
      ctx.stroke();
      ctx.font = '11px "Trebuchet MS","Segoe UI",sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(label, pL - 8, y + 4);
    }
  }

  // y-axis label (rotated)
  ctx.save();
  ctx.translate(18, pT + pH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('Spectral radiance  (normalised to Planck peak)', 0, 0);
  ctx.restore();

  // ── Compute normalisation: Planck peak ──
  const lam_peak = WIEN_B / T;
  const yMax = planck(lam_peak, T);

  // ── Clip curves to plot area ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(pL, pT - 12, pW, pH + 12);
  ctx.clip();

  const NPTS = 700;
  function drawCurve(fn, color, dash, lineW) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.setLineDash(dash);
    let first = true;
    for (let i = 0; i <= NPTS; i++) {
      const lam = LAM_MIN + (LAM_MAX - LAM_MIN) * i / NPTS;
      const v   = fn(lam, T);
      const x   = lamToX(lam);
      const y   = valToY(v, yMax);
      if (first) { ctx.moveTo(x, y); first = false; }
      else        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (showWien)   drawCurve(wienApprox,   '#a78bfa', [5, 4], 2);
  if (showRJ)     drawCurve(rayleighJeans, '#f97316', [7, 4], 2.5);
  if (showPlanck) drawCurve(planck,         '#2dd4bf', [],    3);

  ctx.restore(); // end clip

  // ── Wien peak marker ──
  const lam_peak_nm = lam_peak * 1e9;
  if (lam_peak_nm >= 105 && lam_peak_nm <= 2980) {
    const px = lamToX(lam_peak);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(px, pT); ctx.lineTo(px, pB);
    ctx.stroke();
    ctx.setLineDash([]);
    // label — offset left if near right edge
    const lblX = px + (px > pR - 130 ? -125 : 6);
    ctx.font = '700 12px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText(`λₘₐˣ = ${Math.round(lam_peak_nm)} nm`, lblX, pT + 15);
  }

  // ── Ultraviolet Catastrophe annotation ──
  if (showRJ) {
    // Box behind text
    const annX = pL + 8, annY = pT + 8;
    ctx.fillStyle = 'rgba(249,115,22,0.13)';
    rrect(annX - 4, annY - 2, 360, 46, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249,115,22,0.4)';
    ctx.lineWidth = 1;
    rrect(annX - 4, annY - 2, 360, 46, 6);
    ctx.stroke();

    ctx.font = '700 13px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(249,115,22,0.95)';
    ctx.textAlign = 'left';
    ctx.fillText('Rayleigh–Jeans: intensity → ∞ as λ → 0', annX, annY + 16);
    ctx.font = '12px "Trebuchet MS","Segoe UI",sans-serif';
    ctx.fillStyle = 'rgba(249,115,22,0.7)';
    ctx.fillText('Ultraviolet Catastrophe — not what is observed', annX, annY + 33);
  }

  ctx.textAlign = 'left';
}

// ─── Full redraw ──────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, CW, CH);
  drawGlow(state.T);
  drawPlot();
}

// ─── Readout panel (sidebar) ──────────────────────────────────────────────────
function updateReadouts() {
  const T = state.T;
  const lmax_nm = Math.round(WIEN_B / T * 1e9);
  valTEl.value = Math.round(T);
  rLmax.textContent = lmax_nm >= 1000
    ? `${(lmax_nm / 1000).toFixed(2)} µm`
    : `${lmax_nm} nm`;
  rRegion.textContent = spectralRegion(T);
  const relP = (T / 5778) ** 4;
  rPower.textContent = relP >= 100 ? relP.toFixed(0) + '×'
                     : relP >= 10  ? relP.toFixed(1) + '×'
                     : relP.toFixed(3) + '×';
}

function refresh() {
  updateReadouts();
  draw();
}

// ─── Events ───────────────────────────────────────────────────────────────────
sliderT.addEventListener('input', () => {
  state.T = sliderToT(parseFloat(sliderT.value));
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  refresh();
});

valTEl.addEventListener('change', () => {
  const raw = parseFloat(valTEl.value);
  if (isNaN(raw)) { valTEl.value = Math.round(state.T); return; }
  state.T = Math.max(T_MIN, Math.min(T_MAX, Math.round(raw)));
  sliderT.value = TToSlider(state.T);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  refresh();
});

document.getElementById('preset-chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.T = parseFloat(chip.dataset.t);
  sliderT.value = TToSlider(state.T);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  refresh();
});

function bindToggle(btn, key) {
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    refresh();
  });
}
bindToggle(btnPlanck, 'showPlanck');
bindToggle(btnRJ,     'showRJ');
bindToggle(btnWien,   'showWien');

btnLinear.addEventListener('click', () => {
  state.logScale = false;
  btnLinear.classList.add('active');
  btnLog.classList.remove('active');
  refresh();
});
btnLog.addEventListener('click', () => {
  state.logScale = true;
  btnLog.classList.add('active');
  btnLinear.classList.remove('active');
  refresh();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
sliderT.value = TToSlider(state.T);
refresh();
