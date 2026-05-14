/* ── Constants ─────────────────────────────────────────────── */

const CW = 960, CH = 560;

// Graph margins
const PAD_L = 84, PAD_R = 52, PAD_T = 52, PAD_B = 62;
const GW = CW - PAD_L - PAD_R;
const GH = CH - PAD_T - PAD_B;
const P_MAX = 8;   // y-axis max: p / m₀c

const COL_CLASSICAL    = '#64748b';
const COL_RELATIVISTIC = '#0d9488';
const COL_ACCENT       = '#0f766e';

/* ── State ─────────────────────────────────────────────────── */

let beta = 0.80;

const show = {
  classical:    false,
  relativistic: false,
  formula:      false,
  values:       false,
  explanation:  false,
};

/* ── Canvas ─────────────────────────────────────────────────── */

const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');

/* ── Physics ────────────────────────────────────────────────── */

function gamma(b)  { return 1 / Math.sqrt(1 - b * b); }
function pRel(b)   { return b * gamma(b); }   // p / (m₀c) — relativistic
function pClas(b)  { return b; }              // p / (m₀c) — classical

/* ── Coordinate transforms ──────────────────────────────────── */

// β → canvas x   (β = 0 → left edge, β = 1 → right edge)
function bx(b) { return PAD_L + b * GW; }

// p/m₀c → canvas y   (0 → bottom, P_MAX → top)
function py(p) { return PAD_T + GH * (1 - Math.min(p, P_MAX) / P_MAX); }

/* ── Drawing helpers ────────────────────────────────────────── */

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function txt(text, x, y, opts = {}) {
  ctx.save();
  ctx.font         = opts.font  || '13px "Trebuchet MS", sans-serif';
  ctx.fillStyle    = opts.color || '#15304d';
  ctx.textAlign    = opts.align || 'left';
  ctx.textBaseline = opts.base  || 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ── Main draw ──────────────────────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, CW, CH);
  drawBackground();
  drawGrid();
  drawAxes();
  if (show.classical)    drawClassicalCurve();
  if (show.relativistic) drawRelativisticCurve();
  drawMarkerLine();
  if (show.classical || show.relativistic) drawDots();
  if (show.values)  drawCallout();
  if (show.formula) drawFormulaBox();
}

/* ── Background ─────────────────────────────────────────────── */

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, CH);
  bg.addColorStop(0, '#f0f4ff');
  bg.addColorStop(1, '#e4ecff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CW, CH);

  // Subtle shaded region near β=1 ("forbidden zone")
  const x0 = bx(0.92), x1 = bx(1.0);
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, 'rgba(220,38,38,0)');
  grad.addColorStop(1, 'rgba(220,38,38,0.07)');
  ctx.fillStyle = grad;
  ctx.fillRect(x0, PAD_T, x1 - x0, GH);
}

/* ── Grid ───────────────────────────────────────────────────── */

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.07)';
  ctx.lineWidth = 1;
  for (let p = 0; p <= P_MAX; p++) {
    const y = py(p);
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + GW, y); ctx.stroke();
  }
  for (let b = 0; b <= 1.0; b += 0.2) {
    const x = bx(b);
    ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + GH); ctx.stroke();
  }
  ctx.restore();
}

/* ── Axes ───────────────────────────────────────────────────── */

function drawAxes() {
  const gx0 = PAD_L, gy0 = PAD_T + GH;

  ctx.save();
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  // x-axis with arrow
  ctx.beginPath();
  ctx.moveTo(gx0, gy0);
  ctx.lineTo(PAD_L + GW + 18, gy0);
  ctx.stroke();
  ctx.fillStyle = '#15304d';
  ctx.beginPath();
  ctx.moveTo(PAD_L + GW + 18, gy0);
  ctx.lineTo(PAD_L + GW + 8,  gy0 - 5);
  ctx.lineTo(PAD_L + GW + 8,  gy0 + 5);
  ctx.fill();

  // y-axis with arrow
  ctx.beginPath();
  ctx.moveTo(gx0, gy0);
  ctx.lineTo(gx0, PAD_T - 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx0, PAD_T - 18);
  ctx.lineTo(gx0 - 5, PAD_T - 8);
  ctx.lineTo(gx0 + 5, PAD_T - 8);
  ctx.fill();
  ctx.restore();

  // x-axis ticks and labels
  ctx.save();
  ctx.strokeStyle = '#15304d'; ctx.lineWidth = 1.5;
  ctx.fillStyle = '#55708d';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let b = 0; b <= 1.0; b += 0.2) {
    const x = bx(b);
    ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy0 + 5); ctx.stroke();
    ctx.fillText(b === 0 ? '0' : b.toFixed(1), x, gy0 + 9);
  }
  // x-axis title
  ctx.font = '700 14px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.fillText('β  =  v / c', PAD_L + GW / 2, gy0 + 34);
  ctx.restore();

  // y-axis ticks and labels
  ctx.save();
  ctx.strokeStyle = '#15304d'; ctx.lineWidth = 1.5;
  ctx.fillStyle = '#55708d';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let p = 0; p <= P_MAX; p++) {
    const y = py(p);
    ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx0 - 5, y); ctx.stroke();
    if (p > 0) ctx.fillText(String(p), gx0 - 10, y);
  }
  // y-axis title (rotated)
  ctx.save();
  ctx.translate(18, PAD_T + GH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '700 14px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('p / m₀c', 0, 0);
  ctx.restore();
  ctx.restore();

  // Asymptote at β = 1
  ctx.save();
  ctx.strokeStyle = 'rgba(220,38,38,0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  const ax = bx(1.0);
  ctx.beginPath(); ctx.moveTo(ax, PAD_T + GH); ctx.lineTo(ax, PAD_T - 4); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(220,38,38,0.75)';
  ctx.font = '700 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('v = c', ax, PAD_T - 6);
  ctx.restore();
}

/* ── Classical curve ────────────────────────────────────────── */

function drawClassicalCurve() {
  ctx.save();
  ctx.strokeStyle = COL_CLASSICAL;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx(0), py(0));
  ctx.lineTo(bx(1.0), py(1.0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Label along the line
  const lb = 0.55;
  const lx = bx(lb) + 10, ly = py(pClas(lb)) - 14;
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = COL_CLASSICAL;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Classical  p = m₀v', lx, ly);
  ctx.restore();
}

/* ── Relativistic curve ─────────────────────────────────────── */

function drawRelativisticCurve() {
  ctx.save();
  ctx.strokeStyle = COL_RELATIVISTIC;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  let started = false;
  for (let b = 0; b <= 0.9998; b += 0.001) {
    const p = pRel(b);
    if (p > P_MAX * 1.005) break;
    const x = bx(b), y = py(p);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Label (placed where curve is well above classical)
  const lb = 0.72;
  const pr = pRel(lb);
  if (pr < P_MAX) {
    const lx = bx(lb) + 10, ly = py(pr) - 14;
    ctx.font = '700 13px "Trebuchet MS", sans-serif';
    ctx.fillStyle = COL_RELATIVISTIC;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Relativistic  p = \u03b3m\u2080v', lx, ly);
  }
  ctx.restore();
}

/* ── Current-β marker line ──────────────────────────────────── */

function drawMarkerLine() {
  const x = bx(beta);
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x, PAD_T);
  ctx.lineTo(x, PAD_T + GH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* ── Dots on curves at current β ────────────────────────────── */

function drawDots() {
  const x = bx(beta);

  if (show.classical) {
    const y = py(pClas(beta));
    ctx.save();
    ctx.fillStyle = COL_CLASSICAL;
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  if (show.relativistic) {
    const pr = pRel(beta);
    if (pr <= P_MAX) {
      const y = py(pr);
      ctx.save();
      ctx.fillStyle = COL_RELATIVISTIC;
      ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}

/* ── Values callout ─────────────────────────────────────────── */

function drawCallout() {
  const b  = beta;
  const g  = gamma(b);
  const pr = pRel(b);
  const pc = pClas(b);

  const lines = [];
  lines.push({ text: '\u03b2 = ' + b.toFixed(2),         color: '#15304d' });
  lines.push({ text: '\u03b3 = ' + g.toFixed(3),         color: COL_ACCENT });
  if (show.classical)    lines.push({ text: 'p\u1D04\u02e1\u02e2 = ' + pc.toFixed(3) + ' m\u2080c',  color: COL_CLASSICAL });
  if (show.relativistic) lines.push({ text: 'p\u02b3\u1D49\u02e1 = ' + pr.toFixed(3) + ' m\u2080c',  color: COL_RELATIVISTIC });
  if (show.classical && show.relativistic) {
    lines.push({ text: 'ratio = \u00d7' + g.toFixed(3) + '  (= \u03b3)', color: '#7c3aed' });
  }

  const W = 178, lineH = 20, pad = 11;
  const H = pad * 2 + lines.length * lineH;

  // Position callout: right of marker if β < 0.55, else left
  const mx = bx(b);
  const cx = b < 0.55 ? mx + 14 : mx - W - 14;
  const cy = PAD_T + 14;

  ctx.save();
  roundRect(cx, cy, W, H, 10, 'rgba(255,255,255,0.94)', 'rgba(21,48,77,0.12)');

  ctx.font = '700 12.5px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((ln, i) => {
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, cx + pad, cy + pad + i * lineH);
  });
  ctx.restore();
}

/* ── Formula box ────────────────────────────────────────────── */

function drawFormulaBox() {
  const W = 222, H = 66;
  // Place in an open part of the graph — lower right (below the relativistic curve)
  const fx = PAD_L + GW * 0.58;
  const fy = PAD_T + GH * 0.62;

  ctx.save();
  roundRect(fx, fy, W, H, 12, 'rgba(255,255,255,0.94)', 'rgba(13,148,136,0.4)');

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_RELATIVISTIC;
  ctx.font = '700 16px "Trebuchet MS", sans-serif';
  ctx.fillText('p  =  \u03b3 m\u2080 v', fx + W / 2, fy + 20);

  ctx.fillStyle = '#55708d';
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.fillText('where  \u03b3 = 1 / \u221a(1 \u2212 \u03b2\u00b2)', fx + W / 2, fy + 46);
  ctx.restore();
}

/* ── UI — slider ────────────────────────────────────────────── */

const slider   = document.getElementById('slider-beta');
const valLabel = document.getElementById('val-beta');

slider.addEventListener('input', () => {
  beta = parseFloat(slider.value);
  valLabel.value = beta.toFixed(2);
  draw();
});
valLabel.addEventListener('change', () => {
  const raw = parseFloat(valLabel.value);
  if (isNaN(raw)) { valLabel.value = beta.toFixed(2); return; }
  beta = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), raw));
  slider.value = beta;
  valLabel.value = beta.toFixed(2);
  draw();
});

/* ── UI — toggle buttons ────────────────────────────────────── */

function updateToggleUI() {
  document.querySelectorAll('.vec-btn[data-key]').forEach(btn => {
    btn.classList.toggle('active', show[btn.dataset.key]);
  });
  // Sidebar explanation card
  document.getElementById('why-card').classList.toggle('hidden', !show.explanation);
}

document.querySelectorAll('.vec-btn[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    show[key] = !show[key];
    updateToggleUI();
    draw();
  });
});

/* ── Init ───────────────────────────────────────────────────── */

updateToggleUI();
draw();
