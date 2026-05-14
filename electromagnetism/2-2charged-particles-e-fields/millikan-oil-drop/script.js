// Millikan's Oil Drop — parallel plates, charged drops, adjustable voltage.
// No drag, no buoyancy: drops at rest stay at rest only when qE = mg.
// Students measure the radius of floating drops with the microscope and
// calculate q themselves using the displayed constants.

// ───────── Physics constants (real units) ─────────
let   V_VOLT = 500;                // plate voltage (user-adjustable)
const D_M = 0.005;                 // plate separation, metres
let   E_FIELD = V_VOLT / D_M;      // recomputed on voltage change
const RHO = 875;                   // oil density, kg/m³
const G = 9.80;                    // m/s²
const E_CHARGE = 1.602e-19;        // elementary charge

// Balance radius for n-charge drop (in μm), at the current V.
function rBalanceUm(n) {
  const r3 = (3 * n * E_CHARGE * E_FIELD) / (4 * Math.PI * RHO * G);
  return Math.cbrt(r3) * 1e6;
}

function setVoltage(v) {
  V_VOLT = v;
  E_FIELD = V_VOLT / D_M;
}

// ───────── Canvas setup ─────────
const simCanvas = document.getElementById("sim");
const simCtx = simCanvas.getContext("2d");
const scopeCanvas = document.getElementById("scope");
const scopeCtx = scopeCanvas.getContext("2d");

const SIM_W = 960, SIM_H = 540;
const SCOPE_W = 960, SCOPE_H = 480;

// Chamber geometry (main canvas, design coords)
const CHAMBER = {
  xLeft: 220,
  xRight: 820,
  yTopPlate: 70,
  yTopInner: 90,     // inner face of top plate
  yBotInner: 470,    // inner face of bottom plate
  yBotPlate: 490,
};
const CHAMBER_H_PX = CHAMBER.yBotInner - CHAMBER.yTopInner; // 380 px → represents 5 mm

// Colours
const COL = {
  plateTop: "#dc2626",      // +  (red)
  plateBot: "#2563eb",      // −  (blue)
  plateEdge: "#111827",
  chamberBg: "rgba(248, 252, 255, 0.8)",
  drop: "#d4a93a",
  dropEdge: "#7c5e12",
  dropSelect: "#16a34a",
  label: "#15304d",
  muted: "#55708d",
  dim: "#8ca0b6",
  scopeBg: "#0b1220",
  scopeDrop: "#f5c548",
  scopeDropEdge: "#b07a1a",
  scopeRule: "#c8d6e4",
  scopeRuleMajor: "#ffffff",
  scopeDim: "#6b7a8f",
};

// ───────── Simulation state ─────────
const drops = [];
let selectedId = null;
let nextId = 1;

// Visual gravity chosen so that a neutral drop (β=0) crosses the chamber
// in ~5 s. ½·g_viz·t² = 380 → g_viz ≈ 30 px/s².
const G_VIZ = 30;

// Seed the chamber with one spritz on load.
function spritz() {
  // Clear all drops except the one the student is currently examining
  for (let i = drops.length - 1; i >= 0; i--) {
    if (drops[i].id !== selectedId) drops.splice(i, 1);
  }
  const NUM = 15;
  for (let i = 0; i < NUM; i++) {
    const roll = Math.random();
    let n, rUm;
    if (roll < 0.25) {
      // neutral drop — no charge, falls under gravity
      n = 0;
      rUm = 0.40 + Math.random() * 1.80;    // 0.40 … 2.20 μm
    } else {
      n = 1 + Math.floor(Math.random() * 6); // 1 … 6
      const rBal = rBalanceUm(n);
      if (Math.random() < 0.15) {
        // truly balanced drop
        rUm = rBal;
      } else {
        // off-balance: radius perturbed so the drop drifts up or down
        const sign = Math.random() < 0.5 ? -1 : 1;
        const eps = sign * (0.06 + Math.random() * 0.24); // |ε| ∈ [0.06, 0.30]
        rUm = rBal * (1 + eps);
      }
    }
    // spawn from the atomiser on the left, in a band around mid-chamber
    const yMid = (CHAMBER.yTopInner + CHAMBER.yBotInner) / 2;
    const x = CHAMBER.xLeft + 6 + Math.random() * 14;
    const y = yMid + (Math.random() - 0.5) * 100;
    // horizontal speed chosen so each drop glides to rest near mid-chamber
    const vx = 280 + Math.random() * 110;    // 280 … 390 px/s rightward
    drops.push({
      id: nextId++,
      x, y, vx, vy: 0,
      rUm,
      n,
      bornAt: performance.now(),
    });
  }
}

function clearDrops() {
  drops.length = 0;
  selectedId = null;
}

// ───────── Update ─────────
function update(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    // β = qE / (mg).  m = (4/3)π r³ ρ.  r in metres.
    const rM = d.rUm * 1e-6;
    const m = (4 / 3) * Math.PI * rM * rM * rM * RHO;
    const qE = d.n * E_CHARGE * E_FIELD;
    const beta = qE / (m * G);
    // Visual acceleration: gravity pulls +y, field pushes −y.
    const ay = G_VIZ * (1 - beta);
    d.vy += ay * dt;
    d.y += d.vy * dt;
    // Horizontal damping only — purely visual, so drops glide in from
    // the atomiser and settle near mid-chamber. Vertical motion remains
    // drag-free so the qE = mg balance stays honest.
    d.x += d.vx * dt;
    d.vx *= Math.exp(-1.1 * dt);
    // Remove drops that leave the chamber
    if (d.y < CHAMBER.yTopInner - 10 || d.y > CHAMBER.yBotInner + 10 ||
        d.x > CHAMBER.xRight + 10) {
      if (selectedId === d.id) selectedId = null;
      drops.splice(i, 1);
    }
  }
}

// ───────── Drawing: main chamber ─────────
function drawChamber() {
  const ctx = simCtx;
  ctx.clearRect(0, 0, SIM_W, SIM_H);

  // Chamber interior
  ctx.fillStyle = COL.chamberBg;
  ctx.fillRect(CHAMBER.xLeft, CHAMBER.yTopInner, CHAMBER.xRight - CHAMBER.xLeft, CHAMBER_H_PX);

  // Plates
  drawPlate(CHAMBER.yTopPlate, CHAMBER.yTopInner, COL.plateTop, "+");
  drawPlate(CHAMBER.yBotInner, CHAMBER.yBotPlate, COL.plateBot, "−");

  // Oil atomiser on the left, spraying into the chamber
  drawAtomiser();

  // Labels: d arrow on the right, V centred above the chamber
  drawDimensionArrow();
  drawVoltageLabel();

  // Drops
  for (const d of drops) drawDrop(d);
}

function drawPlate(yTop, yBot, fill, glyph) {
  const ctx = simCtx;
  const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
  grad.addColorStop(0, fill);
  grad.addColorStop(1, shade(fill, -0.25));
  ctx.fillStyle = grad;
  ctx.fillRect(CHAMBER.xLeft - 40, yTop, (CHAMBER.xRight - CHAMBER.xLeft) + 80, yBot - yTop);
  ctx.strokeStyle = COL.plateEdge;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(CHAMBER.xLeft - 40, yTop, (CHAMBER.xRight - CHAMBER.xLeft) + 80, yBot - yTop);
  // Glyph
  ctx.fillStyle = "white";
  ctx.font = "bold 20px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ym = (yTop + yBot) / 2;
  ctx.fillText(glyph, CHAMBER.xLeft - 20, ym);
  ctx.fillText(glyph, CHAMBER.xRight + 20, ym);
}

function drawAtomiser() {
  const ctx = simCtx;
  const yMid = (CHAMBER.yTopInner + CHAMBER.yBotInner) / 2;
  // Rubber bulb on the far left
  ctx.fillStyle = "#6b7280";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(70, yMid, 32, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Neck connecting bulb to nozzle
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(98, yMid - 7, 22, 14);
  ctx.strokeRect(98, yMid - 7, 22, 14);
  // Tapered nozzle extending into the chamber
  ctx.beginPath();
  ctx.moveTo(120, yMid - 10);
  ctx.lineTo(120, yMid + 10);
  ctx.lineTo(CHAMBER.xLeft + 4, yMid + 3);
  ctx.lineTo(CHAMBER.xLeft + 4, yMid - 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Label
  ctx.fillStyle = COL.muted;
  ctx.font = "italic 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("atomiser", 70, yMid + 32);
}

function drawDimensionArrow() {
  const ctx = simCtx;
  const x = CHAMBER.xRight + 60;
  const y1 = CHAMBER.yTopInner;
  const y2 = CHAMBER.yBotInner;
  ctx.strokeStyle = COL.label;
  ctx.fillStyle = COL.label;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();
  // Arrowheads
  arrowhead(ctx, x, y1, 0, -1);
  arrowhead(ctx, x, y2, 0, 1);
  // Label to the right of the arrow, horizontal
  ctx.font = "bold 15px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("d = 5.00 mm", x + 12, (y1 + y2) / 2);
}

function drawVoltageLabel() {
  const ctx = simCtx;
  const cx = (CHAMBER.xLeft + CHAMBER.xRight) / 2;
  const y = 32;
  ctx.fillStyle = COL.label;
  ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`V = ${V_VOLT} V`, cx, y);
}

function arrowhead(ctx, x, y, dx, dy) {
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - dy * size * 0.6 + dx * size, y + dx * size * 0.6 + dy * size);
  ctx.lineTo(x + dy * size * 0.6 + dx * size, y - dx * size * 0.6 + dy * size);
  ctx.closePath();
  ctx.fill();
}

function drawDrop(d) {
  const ctx = simCtx;
  const age = (performance.now() - d.bornAt) / 1000;
  const alpha = Math.min(1, age / 0.25);
  // Chamber radius scales with the drop's actual radius so the size
  // variation is visible at a glance. True scale (0.08 px/μm) would be
  // invisible, so we use an exaggerated but monotonic mapping.
  const R = 1.6 + d.rUm * 3.4;   // rUm 0.40→3.0 px, 2.20→9.1 px
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COL.drop;
  ctx.strokeStyle = COL.dropEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(d.x, d.y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (d.id === selectedId) {
    ctx.strokeStyle = COL.dropSelect;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(d.x, d.y, R + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ───────── Drawing: microscope ─────────
function drawScope() {
  const ctx = scopeCtx;
  ctx.fillStyle = COL.scopeBg;
  ctx.fillRect(0, 0, SCOPE_W, SCOPE_H);

  // Header
  ctx.fillStyle = "#e6eef8";
  ctx.font = "bold 13px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("MICROSCOPE", 18, 14);

  const drop = drops.find(d => d.id === selectedId);
  if (!drop) {
    ctx.fillStyle = COL.scopeDim;
    ctx.font = "italic 16px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("click a drop to examine it", SCOPE_W / 2, SCOPE_H / 2 - 40);
    drawScopeRuler(null, SCOPE_H / 2);
    return;
  }

  // Drop at microscope scale: 1 μm = 100 px → 0.1 μm ticks are 10 px apart
  const PPM = 100;
  const cx = SCOPE_W / 2;
  const cy = SCOPE_H / 2;
  const rPx = drop.rUm * PPM;

  // Drop
  const grd = ctx.createRadialGradient(cx - rPx * 0.35, cy - rPx * 0.4, rPx * 0.1,
                                        cx, cy, rPx);
  grd.addColorStop(0, "#ffe3a0");
  grd.addColorStop(0.6, COL.scopeDrop);
  grd.addColorStop(1, COL.scopeDropEdge);
  ctx.fillStyle = grd;
  ctx.strokeStyle = COL.scopeDropEdge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ruler centred on the drop, drawn on top
  drawScopeRuler(PPM, cy);
}

function drawScopeRuler(PPM, yRule) {
  const ctx = scopeCtx;
  const cx = SCOPE_W / 2;
  if (PPM == null) PPM = 100;

  // Ruler spans ±2 μm (4 μm total — wider than the largest drop)
  const uMin = -2, uMax = 2;
  const xMin = cx + uMin * PPM;
  const xMax = cx + uMax * PPM;

  // Baseline through the drop's horizontal diameter
  ctx.strokeStyle = COL.scopeRuleMajor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xMin, yRule);
  ctx.lineTo(xMax, yRule);
  ctx.stroke();

  // Symmetric tick ladder — 0.1 μm minor, 0.5 μm medium, 1 μm major
  ctx.font = "12px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const STEPS = Math.round((uMax - uMin) / 0.1);
  for (let i = 0; i <= STEPS; i++) {
    const u = uMin + i * 0.1;
    const x = cx + u * PPM;
    const major = (i % 10) === 0;        // every 1.0 μm
    const half  = (i % 5) === 0;         // every 0.5 μm
    ctx.strokeStyle = major ? COL.scopeRuleMajor : COL.scopeRule;
    ctx.lineWidth = major ? 1.8 : (half ? 1.2 : 1);
    const tickLen = major ? 18 : (half ? 12 : 7);
    ctx.beginPath();
    ctx.moveTo(x, yRule - tickLen);
    ctx.lineTo(x, yRule + tickLen);
    ctx.stroke();
    if (major) {
      const label = (Math.abs(u) < 1e-6) ? "0"
                  : (u > 0 ? `+${u.toFixed(0)}` : `${u.toFixed(0)}`);
      ctx.fillStyle = COL.scopeRuleMajor;
      ctx.fillText(label, x, yRule + tickLen + 4);
    }
  }
  // Axis units label at the right end
  ctx.fillStyle = COL.scopeDim;
  ctx.font = "italic 13px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("μm", xMax + 12, yRule);

  // Hint text well below the ruler
  ctx.fillStyle = COL.scopeDim;
  ctx.font = "italic 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("minor ticks = 0.1 μm", cx, SCOPE_H - 28);
}

// ───────── Interaction ─────────
function canvasCoords(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * sx,
    y: (evt.clientY - rect.top) * sy,
  };
}

simCanvas.addEventListener("pointerdown", (e) => {
  const p = canvasCoords(simCanvas, e);
  // find closest drop within 16 px
  let bestId = null, bestD2 = 16 * 16;
  for (const d of drops) {
    const dx = d.x - p.x, dy = d.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; bestId = d.id; }
  }
  selectedId = bestId; // may be null → deselects
});

document.getElementById("btn-spritz").addEventListener("click", spritz);
document.getElementById("btn-clear").addEventListener("click", clearDrops);

const vSlider = document.getElementById("v-slider");
const vVal = document.getElementById("v-val");
vSlider.addEventListener("input", () => {
  setVoltage(Number(vSlider.value));
  vVal.value = V_VOLT;
});
vVal.addEventListener("change", () => {
  const raw = parseFloat(vVal.value);
  if (isNaN(raw)) { vVal.value = V_VOLT; return; }
  const v = Math.max(100, Math.min(1000, Math.round(raw / 25) * 25));
  vVal.value = v;
  vSlider.value = v;
  setVoltage(v);
});

// ───────── Utilities ─────────
function shade(hex, amount) {
  // amount: -1..1 ; negative darkens, positive lightens
  const c = hex.replace("#", "");
  const n = parseInt(c, 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  const f = amount < 0 ? 1 + amount : 1 - amount;
  const t = amount < 0 ? 0 : 255;
  r = Math.round(r * f + t * (1 - f));
  g = Math.round(g * f + t * (1 - f));
  b = Math.round(b * f + t * (1 - f));
  return `rgb(${r},${g},${b})`;
}

// ───────── Main loop ─────────
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt);
  drawChamber();
  drawScope();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
