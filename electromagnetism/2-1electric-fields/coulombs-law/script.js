// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
const CHARGE_RADIUS = 26;
const POSITIVE_COLOR = '#dc2626';
const NEGATIVE_COLOR = '#2563eb';
const K = 8.99e9;          // Coulomb's constant, N m² C⁻²
const PIXELS_PER_METRE = 500; // 1 m = 500 px  →  canvas ≈ 1.92 m × 1.12 m
const SCALE_BAR_PX = 100;  // 100 px = 0.2 m = 20 cm

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  q1: { x: 300, y: 280, sign: '+', magnitude: 1 },
  q2: { x: 660, y: 280, sign: '-', magnitude: 1 },
  showForces: false,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');
const btnShowForces = document.getElementById('btn-show-forces');
const q1Display = document.getElementById('q1-display');
const q2Display = document.getElementById('q2-display');
const q1Num = document.getElementById('q1-num');
const q2Num = document.getElementById('q2-num');
const q1Slider = document.getElementById('q1-slider');
const q2Slider = document.getElementById('q2-slider');
const readoutR = document.getElementById('readout-r');
const readoutF = document.getElementById('readout-f');

// ─── Utilities ────────────────────────────────────────────────────────────────

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

function screenToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

function chargeColor(sign) {
  return sign === '+' ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

function separation() {
  const dx = state.q2.x - state.q1.x;
  const dy = state.q2.y - state.q1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Physics ──────────────────────────────────────────────────────────────────

function separationMetres() {
  return separation() / PIXELS_PER_METRE;
}

function coulombForce() {
  const r = separationMetres();
  if (r < 0.01) return Infinity; // charges nearly overlapping
  const q1 = state.q1.magnitude * 1e-6;
  const q2 = state.q2.magnitude * 1e-6;
  return K * q1 * q2 / (r * r);
}

// Format a value in scientific notation, e.g. 1.23 × 10⁴ N
const SUPERSCRIPT = { '-':'⁻','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
function toSup(n) {
  return String(n).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
}

function formatSci(value, unit = '') {
  if (!Number.isFinite(value)) return `∞${unit ? ' ' + unit : ''}`;
  if (value === 0) return `0${unit ? ' ' + unit : ''}`;
  const exp = Math.floor(Math.log10(value));
  const man = value / 10 ** exp;
  const rounded = man >= 9.995 ? 10 : man;
  const finalExp = rounded === 10 ? exp + 1 : exp;
  const finalMan = rounded === 10 ? 1 : rounded;
  return `${finalMan.toFixed(2)} × 10${toSup(finalExp)}${unit ? ' ' + unit : ''}`;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawGrid() {
  const { width, height } = canvas;
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.restore();
}

function drawDistanceLine() {
  const { q1, q2 } = state;
  const dx = q2.x - q1.x;
  const dy = q2.y - q1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const ux = dx / dist;
  const uy = dy / dist;

  // Start and end at the edge of each charge circle
  const x1 = q1.x + ux * CHARGE_RADIUS;
  const y1 = q1.y + uy * CHARGE_RADIUS;
  const x2 = q2.x - ux * CHARGE_RADIUS;
  const y2 = q2.y - uy * CHARGE_RADIUS;

  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  // r label at midpoint, offset perpendicular to the line
  const mx = (q1.x + q2.x) / 2;
  const my = (q1.y + q2.y) / 2;
  const perpX = -uy;
  const perpY = ux;
  const labelX = mx + perpX * 22;
  const labelY = my + perpY * 22;

  ctx.fillStyle = 'rgba(21, 48, 77, 0.7)';
  ctx.font = `700 14px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`r = ${separationMetres().toFixed(2)} m`, labelX, labelY);
  ctx.restore();
}

function drawScaleBar() {
  const { width, height } = canvas;
  const x = width - 30 - SCALE_BAR_PX;
  const y = height - 28;

  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.45)';
  ctx.lineWidth = 2;

  // Horizontal bar with end ticks
  ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
  ctx.moveTo(x, y); ctx.lineTo(x + SCALE_BAR_PX, y);
  ctx.moveTo(x + SCALE_BAR_PX, y - 5); ctx.lineTo(x + SCALE_BAR_PX, y + 5);
  ctx.stroke();

  ctx.fillStyle = 'rgba(21, 48, 77, 0.6)';
  ctx.font = `500 13px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('20 cm', x + SCALE_BAR_PX / 2, y - 6);
  ctx.restore();
}

function drawCharge(charge, label) {
  const { x, y, sign } = charge;
  const color = chargeColor(sign);
  const r = CHARGE_RADIUS;

  const gradient = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, 'rgba(16, 24, 40, 0.85)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Symbol
  ctx.fillStyle = 'white';
  ctx.font = `900 ${r}px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign === '+' ? '+' : '−', x, y + 1);

  // Label below
  ctx.fillStyle = chargeColor(sign);
  ctx.font = `700 15px ${CANVAS_FONT}`;
  ctx.fillText(label, x, y + r + 18);
  ctx.restore();
}

// ─── Force arrows ─────────────────────────────────────────────────────────────

function forceArrowLength(f) {
  if (!Number.isFinite(f) || f <= 0) return 24;
  // Log scale: 0.0005 N → 24 px, 50 N → 130 px
  const norm = Math.max(0, Math.min(1, (Math.log10(f) + 3.3) / 5.3));
  return 24 + norm * 106;
}

function drawForceArrow(charge, dirX, dirY, length, color, label) {
  const sx = charge.x + dirX * (CHARGE_RADIUS + 2);
  const sy = charge.y + dirY * (CHARGE_RADIUS + 2);
  const ex = sx + dirX * length;
  const ey = sy + dirY * length;
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;
  const headLen = 13;
  const angle = Math.atan2(dirY, dirX);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - 0.42), ey - headLen * Math.sin(angle - 0.42));
  ctx.lineTo(ex - headLen * Math.cos(angle + 0.42), ey - headLen * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();

  // Label offset perpendicular to the arrow
  ctx.font = `700 13px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX - dirY * 20, midY + dirX * 20);
  ctx.restore();
}

function drawForces() {
  const { q1, q2 } = state;
  const dx = q2.x - q1.x;
  const dy = q2.y - q1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  const ux = dx / dist;
  const uy = dy / dist;
  const f = coulombForce();
  const len = forceArrowLength(f);
  const attractive = q1.sign !== q2.sign;

  // Force on q1: toward q2 (attractive) or away from q2 (repulsive)
  const d1x = attractive ? ux : -ux;
  const d1y = attractive ? uy : -uy;
  // Force on q2: Newton's Third Law — opposite to force on q1
  const d2x = -d1x;
  const d2y = -d1y;

  drawForceArrow(q1, d1x, d1y, len, chargeColor(q1.sign), 'F on q₁');
  drawForceArrow(q2, d2x, d2y, len, chargeColor(q2.sign), 'F on q₂');
}

function drawInteractionBadge() {
  const { q1, q2 } = state;
  const attractive = q1.sign !== q2.sign;
  const label = attractive ? 'Attractive' : 'Repulsive';
  const bgColor = attractive ? 'rgba(13, 148, 136, 0.12)' : 'rgba(220, 38, 38, 0.12)';
  const textColor = attractive ? '#0f766e' : '#b91c1c';

  const textW = 110;
  const bx = canvas.width / 2 - textW / 2;
  const by = 18;
  const bh = 30;

  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(bx, by, textW, bh, 999);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.font = `700 14px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, by + bh / 2);
  ctx.restore();
}

function updateReadouts() {
  const r = separationMetres();
  const f = coulombForce();
  readoutR.textContent = `${r.toFixed(2)} m`;
  readoutF.textContent = formatSci(f, 'N');
}

function draw() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid();
  drawDistanceLine();
  drawScaleBar();

  if (state.showForces) {
    drawForces();
    drawInteractionBadge();
  }

  drawCharge(state.q1, 'q₁');
  drawCharge(state.q2, 'q₂');
  updateReadouts();
}

// ─── Dragging ─────────────────────────────────────────────────────────────────

const drag = {
  active: false,
  target: null,   // 'q1' | 'q2'
  offsetX: 0,
  offsetY: 0,
  moved: false,
};

function hitTest(x, y) {
  for (const key of ['q1', 'q2']) {
    const c = state[key];
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= CHARGE_RADIUS * CHARGE_RADIUS) return key;
  }
  return null;
}

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const hit = hitTest(x, y);
  if (!hit) return;
  drag.active = true;
  drag.target = hit;
  drag.offsetX = x - state[hit].x;
  drag.offsetY = y - state[hit].y;
  drag.moved = false;
  canvas.classList.add('dragging');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!drag.active) {
    // Hover cursor
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    canvas.style.cursor = hitTest(x, y) ? 'grab' : 'default';
    return;
  }
  drag.moved = true;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  state[drag.target].x = x - drag.offsetX;
  state[drag.target].y = y - drag.offsetY;
  draw();
});

window.addEventListener('mouseup', () => {
  if (!drag.active) return;
  drag.active = false;
  drag.target = null;
  canvas.classList.remove('dragging');
});

canvas.addEventListener('mouseleave', () => {
  if (!drag.active) canvas.style.cursor = 'default';
});

// ─── Panel displays ───────────────────────────────────────────────────────────

function formatCharge(key) {
  const c = state[key];
  const sign = c.sign === '+' ? '+' : '−';
  const sub = key === 'q1' ? '₁' : '₂';
  return `q${sub} = ${sign}${c.magnitude} μC`;
}

function updateDisplays() {
  q1Display.textContent = formatCharge('q1');
  q2Display.textContent = formatCharge('q2');
  q1Num.value = state.q1.magnitude;
  q2Num.value = state.q2.magnitude;
  q1Slider.value = state.q1.magnitude;
  q2Slider.value = state.q2.magnitude;
}

// ─── Sign toggles ─────────────────────────────────────────────────────────────

function setSign(key, sign) {
  state[key].sign = sign;
  const posBtn = document.getElementById(`${key}-sign-pos`);
  const negBtn = document.getElementById(`${key}-sign-neg`);
  posBtn.classList.toggle('active', sign === '+');
  posBtn.setAttribute('aria-pressed', String(sign === '+'));
  negBtn.classList.toggle('active', sign === '-');
  negBtn.setAttribute('aria-pressed', String(sign === '-'));
  updateDisplays();
  draw();
}

document.getElementById('q1-sign-pos').addEventListener('click', () => setSign('q1', '+'));
document.getElementById('q1-sign-neg').addEventListener('click', () => setSign('q1', '-'));
document.getElementById('q2-sign-pos').addEventListener('click', () => setSign('q2', '+'));
document.getElementById('q2-sign-neg').addEventListener('click', () => setSign('q2', '-'));

// ─── Magnitude sliders ────────────────────────────────────────────────────────

q1Slider.addEventListener('input', (e) => {
  state.q1.magnitude = Number(e.target.value);
  updateDisplays();
  draw();
});

q2Slider.addEventListener('input', (e) => {
  state.q2.magnitude = Number(e.target.value);
  updateDisplays();
  draw();
});

function bindNumInput(numEl, sliderEl, key) {
  numEl.addEventListener('change', () => {
    const raw = parseFloat(numEl.value);
    if (isNaN(raw)) { numEl.value = state[key].magnitude; return; }
    const clamped = Math.max(1, Math.min(10, Math.round(raw)));
    state[key].magnitude = clamped;
    updateDisplays();
    draw();
  });
}
bindNumInput(q1Num, q1Slider, 'q1');
bindNumInput(q2Num, q2Slider, 'q2');

// ─── Show Forces toggle ───────────────────────────────────────────────────────

btnShowForces.addEventListener('click', () => {
  state.showForces = !state.showForces;
  btnShowForces.textContent = state.showForces ? 'Hide Forces' : 'Show Forces';
  btnShowForces.classList.toggle('active', state.showForces);
  btnShowForces.setAttribute('aria-pressed', String(state.showForces));
  draw();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

updateDisplays();
draw();
updateMath();
