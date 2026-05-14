// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_FONT = '"Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
const CHARGE_RADIUS = 22;
const POSITIVE_COLOR = '#dc2626';
const NEGATIVE_COLOR = '#2563eb';
const GRID_STEP = 40;
const ARROW_MAX_LENGTH = 17;
const ARROW_MIN_LENGTH = 4;
const LINE_STEP = 4;          // px per RK4 step
const LINE_MAX_STEPS = 400;   // safety cap
const LINE_TERMINATE_R = 9;   // stop when this close to a charge centre (px)
const BASE_LINES_PER_NC = 6;  // seed lines per 1 nC of charge magnitude

// ─── State ────────────────────────────────────────────────────────────────────

let nextId = 1;

const state = {
  charges: [],       // { id, x, y, sign, magnitude }
  selectedId: null,
  mode: 'arrows',    // 'arrows' | 'lines' | 'both'
  preset: 'empty',   // 'empty' | 'plates'
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const chargeTray = document.getElementById('charge-tray');
const selectedPanel = document.getElementById('selected-panel');
const selectedLabel = document.getElementById('selected-label');
const magnitudeSlider = document.getElementById('magnitude-slider');
const magnitudeNum = document.getElementById('magnitude-num');
const btnDelete = document.getElementById('btn-delete');
const btnArrows = document.getElementById('btn-mode-arrows');
const btnLines = document.getElementById('btn-mode-lines');
const presetSelect = document.getElementById('preset-select');
const fieldReadout = document.getElementById('field-readout');

// ─── Utilities ────────────────────────────────────────────────────────────────

function updateMath() {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise();
  }
}

// Convert a pointer event position to canvas logical coordinates.
function screenToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function chargeColor(sign) {
  return sign === '+' ? POSITIVE_COLOR : NEGATIVE_COLOR;
}

function chargeLabel(sign) {
  return sign === '+' ? '+' : '−';
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function drawGrid() {
  const { width, height } = canvas;
  ctx.save();
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCharge(charge, isSelected) {
  const { x, y, sign } = charge;
  const color = chargeColor(sign);
  const r = CHARGE_RADIUS;

  // Glow for selected charge
  if (isSelected) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Filled circle
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
  ctx.fillText(chargeLabel(sign), x, y + 1);
  ctx.restore();
}

// ─── Physics ──────────────────────────────────────────────────────────────────

// Returns the E-field vector at canvas point (px, py) due to all charges.
// Uses relative units: q in nC, r in pixels — result is proportional to real E.
function computeEField(px, py) {
  let ex = 0;
  let ey = 0;
  for (const charge of state.charges) {
    const dx = px - charge.x;
    const dy = py - charge.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1) continue;
    const r = Math.sqrt(r2);
    const q = charge.sign === '+' ? charge.magnitude : -charge.magnitude;
    const strength = q / r2;
    ex += strength * (dx / r);
    ey += strength * (dy / r);
  }
  return { ex, ey };
}

// ─── Arrow grid ───────────────────────────────────────────────────────────────

// Interpolates through blue → teal → yellow → red for norm in [0, 1].
function fieldColor(norm) {
  const stops = [
    [68, 136, 255],
    [0, 204, 170],
    [255, 204, 0],
    [255, 51, 0],
  ];
  const t = Math.max(0, Math.min(1, norm)) * (stops.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = stops[Math.min(i, stops.length - 1)];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const r = Math.round(a[0] + f * (b[0] - a[0]));
  const g = Math.round(a[1] + f * (b[1] - a[1]));
  const bl = Math.round(a[2] + f * (b[2] - a[2]));
  return `rgb(${r},${g},${bl})`;
}

function drawArrowAt(x, y, ex, ey, norm) {
  const mag = Math.sqrt(ex * ex + ey * ey);
  if (mag === 0) return;
  const ux = ex / mag;
  const uy = ey / mag;
  const length = ARROW_MIN_LENGTH + norm * (ARROW_MAX_LENGTH - ARROW_MIN_LENGTH);

  // Centre the arrow on the grid point (tail behind, head ahead)
  const x1 = x - ux * length * 0.35;
  const y1 = y - uy * length * 0.35;
  const x2 = x + ux * length * 0.65;
  const y2 = y + uy * length * 0.65;

  const headSize = 4.5;
  const angle = Math.atan2(uy, ux);
  const color = fieldColor(norm);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6 + norm * 0.4;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headSize * Math.cos(angle - 0.45), y2 - headSize * Math.sin(angle - 0.45));
  ctx.lineTo(x2 - headSize * Math.cos(angle + 0.45), y2 - headSize * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawArrowGrid() {
  const { width, height } = canvas;
  const cols = Math.ceil(width / GRID_STEP) + 1;
  const rows = Math.ceil(height / GRID_STEP) + 1;
  const xOffset = (width % GRID_STEP) / 2;
  const yOffset = (height % GRID_STEP) / 2;

  // Compute field at every grid point, skipping those too close to a charge.
  const points = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = xOffset + col * GRID_STEP;
      const py = yOffset + row * GRID_STEP;

      const tooClose = state.charges.some((c) => {
        const dx = px - c.x;
        const dy = py - c.y;
        return dx * dx + dy * dy < (CHARGE_RADIUS + 12) * (CHARGE_RADIUS + 12);
      });
      if (tooClose) continue;

      const { ex, ey } = computeEField(px, py);
      const magnitude = Math.sqrt(ex * ex + ey * ey);
      if (magnitude === 0) continue;
      points.push({ px, py, ex, ey, magnitude });
    }
  }

  if (points.length === 0) return;

  // Normalise on a log scale so both weak and strong regions are visible.
  const logMags = points.map((p) => Math.log(p.magnitude));
  const logMin = Math.min(...logMags);
  const logMax = Math.max(...logMags);
  const logRange = logMax - logMin || 1;

  points.forEach((p, i) => {
    const norm = (logMags[i] - logMin) / logRange;
    drawArrowAt(p.px, p.py, p.ex, p.ey, norm);
  });
}

// ─── Field line tracing ───────────────────────────────────────────────────────

// Returns a unit vector of E at (px, py), or {ux:0, uy:0} if field is zero.
function eFieldUnit(px, py) {
  const { ex, ey } = computeEField(px, py);
  const mag = Math.sqrt(ex * ex + ey * ey);
  if (mag === 0) return { ux: 0, uy: 0 };
  return { ux: ex / mag, uy: ey / mag };
}

// Traces one field line from (startX, startY).
// direction: +1 follows E (away from +), -1 follows -E (away from -).
// Returns an array of {x, y} canvas points.
function traceFieldLine(startX, startY, direction) {
  const { width, height } = canvas;
  const points = [{ x: startX, y: startY }];
  let x = startX;
  let y = startY;

  for (let step = 0; step < LINE_MAX_STEPS; step++) {
    const k1 = eFieldUnit(x, y);
    const k2 = eFieldUnit(x + (LINE_STEP / 2) * direction * k1.ux, y + (LINE_STEP / 2) * direction * k1.uy);
    const k3 = eFieldUnit(x + (LINE_STEP / 2) * direction * k2.ux, y + (LINE_STEP / 2) * direction * k2.uy);
    const k4 = eFieldUnit(x + LINE_STEP * direction * k3.ux, y + LINE_STEP * direction * k3.uy);

    x += direction * (LINE_STEP / 6) * (k1.ux + 2 * k2.ux + 2 * k3.ux + k4.ux);
    y += direction * (LINE_STEP / 6) * (k1.uy + 2 * k2.uy + 2 * k3.uy + k4.uy);

    if (x < 0 || x > width || y < 0 || y > height) break;

    const nearCharge = state.charges.some((c) => {
      const dx = x - c.x;
      const dy = y - c.y;
      return dx * dx + dy * dy < LINE_TERMINATE_R * LINE_TERMINATE_R;
    });
    if (nearCharge) break;

    points.push({ x, y });
  }

  return points;
}

// Draws a small arrowhead along a field line to indicate direction.
function drawLineArrowhead(points) {
  const idx = Math.floor(points.length * 0.42);
  if (idx < 1 || idx >= points.length) return;

  const prev = points[idx - 1];
  const curr = points[idx];
  const angle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
  const size = 11;

  ctx.save();
  ctx.fillStyle = 'rgba(21, 48, 77, 0.7)';
  ctx.beginPath();
  ctx.moveTo(curr.x, curr.y);
  ctx.lineTo(curr.x - size * Math.cos(angle - 0.4), curr.y - size * Math.sin(angle - 0.4));
  ctx.lineTo(curr.x - size * Math.cos(angle + 0.4), curr.y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTracedLine(points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let j = 1; j < points.length; j++) {
    ctx.lineTo(points[j].x, points[j].y);
  }
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  drawLineArrowhead(points);
}

// For parallel plates: seed from a uniform horizontal line just inside the
// positive plate so lines are evenly spaced rather than clustered per charge.
function drawPlatesFieldLines() {
  const positives = state.charges.filter((c) => c.sign === '+');
  const negatives = state.charges.filter((c) => c.sign === '-');
  if (positives.length === 0 || negatives.length === 0) return;

  const posY = positives.reduce((sum, c) => sum + c.y, 0) / positives.length;
  const negY = negatives.reduce((sum, c) => sum + c.y, 0) / negatives.length;
  const direction = posY < negY ? 1 : -1;

  const xCoords = positives.map((c) => c.x).sort((a, b) => a - b);
  const xMin = xCoords[0];
  const xMax = xCoords[xCoords.length - 1];

  const seedY = posY + direction * (CHARGE_RADIUS + 7);
  const LINE_SPACING = 25; // px between seed points
  const numSeeds = Math.round((xMax - xMin) / LINE_SPACING) + 1;

  for (let i = 0; i < numSeeds; i++) {
    const sx = xMin + (i / (numSeeds - 1)) * (xMax - xMin);
    const pts = traceFieldLine(sx, seedY, direction);
    if (direction === -1) pts.reverse();
    drawTracedLine(pts);
  }
}

function drawFieldLines() {
  if (state.preset === 'plates') {
    drawPlatesFieldLines();
    return;
  }

  const positiveCharges = state.charges.filter((c) => c.sign === '+');
  const negativeCharges = state.charges.filter((c) => c.sign === '-');

  // Seed from positive charges (trace forward). If none, seed from negative
  // charges and trace backward — lines emerge from them as if they were sources.
  const seedCharges = positiveCharges.length > 0 ? positiveCharges : negativeCharges;
  const direction = positiveCharges.length > 0 ? 1 : -1;
  const seedRadius = CHARGE_RADIUS + 7;

  for (const charge of seedCharges) {
    const numLines = Math.min(Math.round(BASE_LINES_PER_NC * charge.magnitude), 60);
    for (let i = 0; i < numLines; i++) {
      const angle = (2 * Math.PI * i) / numLines;
      const sx = charge.x + seedRadius * Math.cos(angle);
      const sy = charge.y + seedRadius * Math.sin(angle);
      const pts = traceFieldLine(sx, sy, direction);
      if (direction === -1) pts.reverse();
      drawTracedLine(pts);
    }
  }
}

function drawPlaceholder() {
  const { width, height } = canvas;
  ctx.save();
  ctx.fillStyle = 'rgba(21, 48, 77, 0.18)';
  ctx.font = `500 22px ${CANVAS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Drag a charge onto the canvas to get started.', width / 2, height / 2);
  ctx.restore();
}

function draw() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid();

  if (state.charges.length === 0) {
    drawPlaceholder();
    return;
  }

  if (state.mode === 'arrows' || state.mode === 'both') drawArrowGrid();
  if (state.mode === 'lines' || state.mode === 'both') drawFieldLines();

  // Draw unselected charges first, then selected charge on top.
  state.charges.forEach((charge) => {
    if (charge.id !== state.selectedId) drawCharge(charge, false);
  });
  const selected = state.charges.find((c) => c.id === state.selectedId);
  if (selected) drawCharge(selected, true);
}

// ─── Selection panel ──────────────────────────────────────────────────────────

function showSelectedPanel(charge) {
  selectedLabel.textContent = `Selected: ${charge.sign === '+' ? 'positive' : 'negative'} charge`;
  magnitudeSlider.value = charge.magnitude;
  magnitudeNum.value = charge.magnitude;
  selectedPanel.classList.remove('is-hidden');
}

function hideSelectedPanel() {
  selectedPanel.classList.add('is-hidden');
}

function setSelected(id) {
  state.selectedId = id;
  if (id === null) {
    hideSelectedPanel();
  } else {
    const charge = state.charges.find((c) => c.id === id);
    if (charge) showSelectedPanel(charge);
  }
  draw();
}

// ─── Charge management ────────────────────────────────────────────────────────

function addCharge(sign, x, y) {
  const charge = { id: nextId++, x, y, sign, magnitude: 1 };
  state.charges.push(charge);
  return charge;
}

function deleteCharge(id) {
  state.charges = state.charges.filter((c) => c.id !== id);
  if (state.selectedId === id) {
    setSelected(null); // setSelected calls draw()
  } else {
    draw();
  }
}

function hitTest(x, y) {
  // Return the topmost charge under (x, y), or null.
  for (let i = state.charges.length - 1; i >= 0; i--) {
    const c = state.charges[i];
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= CHARGE_RADIUS * CHARGE_RADIUS) return c;
  }
  return null;
}

// ─── Drag from tray → canvas ──────────────────────────────────────────────────

let dragSign = null;

document.getElementById('token-positive').addEventListener('dragstart', (e) => {
  dragSign = '+';
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', '+');
});

document.getElementById('token-negative').addEventListener('dragstart', (e) => {
  dragSign = '-';
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', '-');
});

canvasWrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvasWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  const sign = e.dataTransfer.getData('text/plain') || dragSign;
  if (sign !== '+' && sign !== '-') return;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const charge = addCharge(sign, x, y);
  setSelected(charge.id);
  draw();
  dragSign = null;
});

// ─── Drag placed charges: move & drop-to-delete ───────────────────────────────

const drag = {
  active: false,
  chargeId: null,
  offsetX: 0,   // cursor offset from charge centre in canvas coords
  offsetY: 0,
  moved: false, // did the pointer actually move? (distinguishes click from drag)
};

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const hit = hitTest(x, y);
  if (!hit) return;
  drag.active = true;
  drag.chargeId = hit.id;
  drag.offsetX = x - hit.x;
  drag.offsetY = y - hit.y;
  drag.moved = false;
  canvas.classList.add('dragging');
  e.preventDefault(); // stop text selection while dragging
});

canvas.addEventListener('mousemove', (e) => {
  if (drag.active) return; // grabbing cursor handled separately
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  canvas.style.cursor = hitTest(x, y) ? 'grab' : 'default';
  updateFieldReadout(e.clientX, e.clientY);
});

canvas.addEventListener('mouseleave', () => {
  if (!drag.active) canvas.style.cursor = 'default';
  fieldReadout.textContent = '—';
  fieldReadout.classList.add('field-readout-empty');
});

window.addEventListener('mousemove', (e) => {
  if (!drag.active) return;
  drag.moved = true;

  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const charge = state.charges.find((c) => c.id === drag.chargeId);
  if (!charge) return;

  charge.x = x - drag.offsetX;
  charge.y = y - drag.offsetY;

  // Highlight the tray when the cursor is over it
  const trayRect = chargeTray.getBoundingClientRect();
  const overTray = e.clientX >= trayRect.left && e.clientX <= trayRect.right
    && e.clientY >= trayRect.top && e.clientY <= trayRect.bottom;
  chargeTray.classList.toggle('drop-target', overTray);

  draw();
});

window.addEventListener('mouseup', (e) => {
  if (!drag.active) return;

  chargeTray.classList.remove('drop-target');

  // Drop over tray → delete
  const trayRect = chargeTray.getBoundingClientRect();
  const overTray = e.clientX >= trayRect.left && e.clientX <= trayRect.right
    && e.clientY >= trayRect.top && e.clientY <= trayRect.bottom;

  if (overTray) {
    deleteCharge(drag.chargeId);
  }

  drag.active = false;
  drag.chargeId = null;
  canvas.classList.remove('dragging');
});

// ─── Canvas pointer: click to select ─────────────────────────────────────────

canvas.addEventListener('click', (e) => {
  // Ignore clicks that were actually the end of a drag
  if (drag.moved) {
    drag.moved = false;
    return;
  }
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const hit = hitTest(x, y);
  setSelected(hit ? hit.id : null);
});

// ─── Selected panel controls ──────────────────────────────────────────────────

magnitudeSlider.addEventListener('input', () => {
  const charge = state.charges.find((c) => c.id === state.selectedId);
  if (!charge) return;
  charge.magnitude = Number(magnitudeSlider.value);
  magnitudeNum.value = charge.magnitude;
  draw();
});

magnitudeNum.addEventListener('change', () => {
  const charge = state.charges.find((c) => c.id === state.selectedId);
  if (!charge) return;
  const raw = parseFloat(magnitudeNum.value);
  if (isNaN(raw)) { magnitudeNum.value = charge.magnitude; return; }
  const clamped = Math.max(1, Math.min(10, Math.round(raw)));
  charge.magnitude = clamped;
  magnitudeNum.value = clamped;
  magnitudeSlider.value = clamped;
  draw();
});

btnDelete.addEventListener('click', () => {
  if (state.selectedId !== null) deleteCharge(state.selectedId);
});

// ─── Mode toggle ──────────────────────────────────────────────────────────────

const btnBoth = document.getElementById('btn-mode-both');
const modeButtons = [btnArrows, btnLines, btnBoth];

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((btn) => {
    const active = btn.id === `btn-mode-${mode}`;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  draw();
}

btnArrows.addEventListener('click', () => setMode('arrows'));
btnLines.addEventListener('click', () => setMode('lines'));
btnBoth.addEventListener('click', () => setMode('both'));

// ─── Preset ───────────────────────────────────────────────────────────────────

function applyEmptyPreset() {
  state.charges = [];
  state.preset = 'empty';
  setSelected(null);
  draw();
}

function applyParallelPlatesPreset() {
  state.charges = [];
  state.selectedId = null;

  const numPerPlate = 13;
  const xStart = 155;
  const xEnd = 805;
  const yPositive = 182;
  const yNegative = 378;
  const xStep = (xEnd - xStart) / (numPerPlate - 1);

  for (let i = 0; i < numPerPlate; i++) {
    const x = Math.round(xStart + i * xStep);
    addCharge('+', x, yPositive);
    addCharge('-', x, yNegative);
  }

  state.preset = 'plates';
  hideSelectedPanel();
  draw();
}

presetSelect.addEventListener('change', () => {
  if (presetSelect.value === 'plates') {
    applyParallelPlatesPreset();
  } else {
    applyEmptyPreset();
  }
});

// ─── Hover readout ────────────────────────────────────────────────────────────

function updateFieldReadout(clientX, clientY) {
  if (state.charges.length === 0) {
    fieldReadout.textContent = '—';
    fieldReadout.classList.add('field-readout-empty');
    return;
  }

  const { x, y } = screenToCanvas(clientX, clientY);
  const { ex, ey } = computeEField(x, y);
  const mag = Math.sqrt(ex * ex + ey * ey);

  if (mag === 0) {
    fieldReadout.textContent = 'E = 0 (neutral point)';
    fieldReadout.classList.remove('field-readout-empty');
    return;
  }

  // Negate ey: canvas y increases downward, physics convention y increases upward.
  const angleRad = Math.atan2(-ey, ex);
  const angleDeg = Math.round(((angleRad * 180) / Math.PI + 360) % 360);
  fieldReadout.textContent = `Direction: ${angleDeg}°`;
  fieldReadout.classList.remove('field-readout-empty');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

draw();
updateMath();
