"use strict";

const canvas = document.getElementById("ed-canvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 960
const H = canvas.height;  // 600

// ---- Scene geometry --------------------------------------------------------

const CENTRE = { x: 480, y: 300 };
const SCREEN_RADIUS_PX = 252;             // visible phosphor radius
const PX_PER_CM = SCREEN_RADIUS_PX / 5;   // screen radius = 5 cm → 50.4 px/cm
const L_CM = 14.0;                        // foil-to-screen distance (instrument constant)

// ---- Physics ---------------------------------------------------------------

// Non-relativistic de Broglie for an electron accelerated through V volts.
// λ (nm) = 1.2264 / √V  (V in volts). 5 kV → 0.0174 nm.
function lambdaNm(V) { return 1.2264 / Math.sqrt(Math.max(V, 1)); }

// Small-angle ring radius on the phosphor for d-spacing d (nm), λ (nm).
function ringRadiusPx(d_nm, lam_nm) {
  return L_CM * (lam_nm / d_nm) * PX_PER_CM;
}

// Target d-spacings (nm). Weights are aesthetic relative intensities — only
// the inner two reflections per material are drawn, by design.
const TARGETS = {
  graphite:  { label: "Graphite",  rings: [{ d: 0.213, w: 1.00 }, { d: 0.123, w: 0.55 }] },
  unknownA:  { label: "Unknown A", rings: [{ d: 0.234, w: 1.00 }, { d: 0.143, w: 0.45 }] },
  unknownB:  { label: "Unknown B", rings: [{ d: 0.314, w: 0.70 }, { d: 0.192, w: 1.00 }] },
};

// ---- State -----------------------------------------------------------------

const state = {
  V: 3000,
  rate: 120,                // electrons per second
  target: "graphite",
  mode: "single",           // "single" | "continuous"
  beamOn: false,
  showScale: false,
  lightMode: false,

  dots: [],                 // { x, y, t0 }
  dotAccum: 0,
  t: 0,
};

const DOT_CAP = 3500;
const DOT_FADE_SECONDS = 18;
const RING_SIGMA_PX = 5.5;          // radial spread of a powder ring
const CENTRE_SIGMA_PX = 6.5;        // direct (undiffracted) beam spot
const CENTRE_WEIGHT = 1.4;          // direct-beam vs ring relative intensity

// ---- Helpers ---------------------------------------------------------------

function boxMuller() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u));
  return [mag * Math.cos(2 * Math.PI * v), mag * Math.sin(2 * Math.PI * v)];
}

function $(id) { return document.getElementById(id); }

// ---- Sampling: where does the next electron land? --------------------------

function sampleElectronLanding() {
  const t = TARGETS[state.target];
  const lam = lambdaNm(state.V);
  const entries = [{ kind: "centre", w: CENTRE_WEIGHT }];
  for (const r of t.rings) {
    entries.push({ kind: "ring", w: r.w, rPx: ringRadiusPx(r.d, lam) });
  }
  const total = entries.reduce((s, e) => s + e.w, 0);
  let u = Math.random() * total;
  let pick = entries[entries.length - 1];
  for (const e of entries) {
    if (u < e.w) { pick = e; break; }
    u -= e.w;
  }
  let dx, dy;
  if (pick.kind === "centre") {
    const [n1, n2] = boxMuller();
    dx = n1 * CENTRE_SIGMA_PX;
    dy = n2 * CENTRE_SIGMA_PX;
  } else {
    const r = pick.rPx + boxMuller()[0] * RING_SIGMA_PX;
    const theta = Math.random() * Math.PI * 2;
    dx = r * Math.cos(theta);
    dy = r * Math.sin(theta);
  }
  return { x: CENTRE.x + dx, y: CENTRE.y + dy };
}

function dotIsOnScreen(d) {
  const dx = d.x - CENTRE.x, dy = d.y - CENTRE.y;
  return dx * dx + dy * dy <= SCREEN_RADIUS_PX * SCREEN_RADIUS_PX;
}

// ---- Continuous field (cached, re-rendered on V/target/lightMode change) --

const BW = 480, BH = 300;
const backing = document.createElement("canvas");
backing.width = BW; backing.height = BH;
const bctx = backing.getContext("2d");
const bimg = bctx.createImageData(BW, BH);

let fieldCacheKey = "";
function fieldKey() { return `${state.V}|${state.target}|${state.lightMode ? "L" : "D"}`; }

function renderContinuousField() {
  const key = fieldKey();
  if (key === fieldCacheKey) return;
  fieldCacheKey = key;

  const t = TARGETS[state.target];
  const lam = lambdaNm(state.V);
  const sx = BW / W, sy = BH / H;
  const rings = t.rings.map((r) => ({ r: ringRadiusPx(r.d, lam) * sx, w: r.w }));
  const centreSig = CENTRE_SIGMA_PX * sx;
  const ringSig   = RING_SIGMA_PX * sx;
  const cx = CENTRE.x * sx, cy = CENTRE.y * sy;
  const screenR = SCREEN_RADIUS_PX * sx;
  const data = bimg.data;
  // Palette
  const dark = !state.lightMode;
  // Bright phosphor green vs dark teal-on-cream
  const R0 = dark ? 120 : 12, G0 = dark ? 255 : 70, B0 = dark ? 170 : 80;
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      const dxp = x - cx, dyp = y - cy;
      const r = Math.sqrt(dxp * dxp + dyp * dyp);
      const idx = (y * BW + x) * 4;
      if (r > screenR + 1.5) {
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 0;
        continue;
      }
      let I = CENTRE_WEIGHT * Math.exp(-(r * r) / (2 * centreSig * centreSig));
      for (const ring of rings) {
        const dr = r - ring.r;
        I += ring.w * Math.exp(-(dr * dr) / (2 * ringSig * ringSig));
      }
      const a = Math.min(1, I * 0.95);
      data[idx]     = Math.round(R0 * a);
      data[idx + 1] = Math.round(G0 * a);
      data[idx + 2] = Math.round(B0 * a);
      data[idx + 3] = Math.round(255 * Math.min(1, I * 1.4));
    }
  }
  bctx.putImageData(bimg, 0, 0);
}

// ---- Drawing ---------------------------------------------------------------

function clearScene() {
  const bg = state.lightMode ? "#f6efdc" : "#04140e";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
}

function drawPhosphorDisc() {
  // The phosphor face — slightly inset so the bezel reads.
  const dark = !state.lightMode;
  ctx.save();
  // bezel
  ctx.beginPath();
  ctx.arc(CENTRE.x, CENTRE.y, SCREEN_RADIUS_PX + 14, 0, Math.PI * 2);
  ctx.fillStyle = dark ? "#1c2530" : "#cdb993";
  ctx.fill();
  // screen face
  ctx.beginPath();
  ctx.arc(CENTRE.x, CENTRE.y, SCREEN_RADIUS_PX, 0, Math.PI * 2);
  ctx.fillStyle = dark ? "#031208" : "#fff7e2";
  ctx.fill();
  // inner highlight ring
  ctx.lineWidth = 2;
  ctx.strokeStyle = dark ? "rgba(100,160,140,0.18)" : "rgba(80,60,30,0.15)";
  ctx.stroke();
  ctx.restore();
}

function clipToScreen() {
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTRE.x, CENTRE.y, SCREEN_RADIUS_PX, 0, Math.PI * 2);
  ctx.clip();
}

function drawContinuous(alpha) {
  renderContinuousField();
  clipToScreen();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(backing, 0, 0, BW, BH, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDots() {
  if (state.dots.length === 0) return;
  clipToScreen();
  const dark = !state.lightMode;
  const now = state.t;
  for (const d of state.dots) {
    const age = now - d.t0;
    const a = Math.max(0, 1 - age / DOT_FADE_SECONDS);
    if (a <= 0) continue;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 1.6, 0, Math.PI * 2);
    if (dark) {
      ctx.fillStyle = `rgba(190,255,210,${0.85 * a})`;
    } else {
      ctx.fillStyle = `rgba(20,70,55,${0.85 * a})`;
    }
    ctx.fill();
  }
  ctx.restore();
}

function drawRadialScale() {
  if (!state.showScale) return;
  const dark = !state.lightMode;
  ctx.save();
  ctx.strokeStyle = dark ? "rgba(180,210,200,0.55)" : "rgba(70,80,90,0.55)";
  ctx.fillStyle   = dark ? "rgba(200,220,210,0.85)" : "rgba(50,60,70,0.85)";
  ctx.lineWidth = 1;
  ctx.font = "600 10px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // horizontal line across the screen with mm ticks
  const y = CENTRE.y;
  ctx.beginPath();
  ctx.moveTo(CENTRE.x - SCREEN_RADIUS_PX, y);
  ctx.lineTo(CENTRE.x + SCREEN_RADIUS_PX, y);
  ctx.stroke();
  const pxPerMm = PX_PER_CM / 10;
  const screenMm = SCREEN_RADIUS_PX / pxPerMm; // 50 mm
  for (let mm = -Math.floor(screenMm); mm <= Math.floor(screenMm); mm++) {
    const x = CENTRE.x + mm * pxPerMm;
    const major = mm % 10 === 0;
    const mid = mm % 5 === 0;
    const h = major ? 9 : (mid ? 6 : 3);
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    if (major && mm !== 0) {
      ctx.fillText(`${Math.abs(mm / 10)} cm`, x, y + 11);
    }
  }
  // centre tick
  ctx.fillText("0", CENTRE.x, y + 11);
  ctx.restore();
}

function drawHeader() {
  const dark = !state.lightMode;
  const t = TARGETS[state.target];
  ctx.save();
  ctx.fillStyle = dark ? "#cfdce8" : "#3b4a5a";
  ctx.font = "700 16px 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Target: ${t.label}`, 24, 22);
  ctx.font = "700 15px 'Consolas', 'Courier New', monospace";
  ctx.fillStyle = dark ? "#fde68a" : "#7a5510";
  ctx.fillText(`V = ${state.V} V`, 24, 46);
  // beam-off indicator
  if (!state.beamOn) {
    ctx.fillStyle = dark ? "rgba(255,120,120,0.9)" : "rgba(160,40,40,0.9)";
    ctx.font = "italic 600 13px 'Segoe UI', sans-serif";
    ctx.fillText("beam off", 24, 70);
  }
  ctx.restore();
}

// ---- Main loop -------------------------------------------------------------

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  state.t += dt;

  // Spawn dots in single-electron mode
  if (state.beamOn && state.mode === "single") {
    state.dotAccum += state.rate * dt;
    while (state.dotAccum >= 1) {
      const p = sampleElectronLanding();
      if (dotIsOnScreen(p)) {
        state.dots.push({ x: p.x, y: p.y, t0: state.t });
        if (state.dots.length > DOT_CAP) state.dots.shift();
      }
      state.dotAccum -= 1;
    }
  } else {
    state.dotAccum = 0;
  }

  // Prune fully-faded dots
  if (state.dots.length > 0) {
    const cutoff = state.t - DOT_FADE_SECONDS;
    while (state.dots.length && state.dots[0].t0 < cutoff) state.dots.shift();
  }

  // Draw
  clearScene();
  drawPhosphorDisc();

  if (state.mode === "continuous") {
    if (state.beamOn) drawContinuous(1.0);
  } else {
    drawDots();
  }

  drawRadialScale();
  drawHeader();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Controls --------------------------------------------------------------

function clearScreen() { state.dots = []; state.dotAccum = 0; }

$("slider-V").addEventListener("input", (e) => {
  state.V = parseInt(e.target.value, 10);
  $("val-V").textContent = state.V;
  fieldCacheKey = "";   // force re-render
  clearScreen();
});

$("slider-rate").addEventListener("input", (e) => {
  state.rate = parseInt(e.target.value, 10);
  $("val-rate").textContent = state.rate;
});

$("sel-target").addEventListener("change", (e) => {
  state.target = e.target.value;
  fieldCacheKey = "";
  clearScreen();
});

document.querySelectorAll("#seg-mode .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#seg-mode .seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    clearScreen();
  });
});

function bindToggle(btnId, prop, onChange) {
  const btn = $(btnId);
  btn.addEventListener("click", () => {
    state[prop] = !state[prop];
    btn.classList.toggle("active", state[prop]);
    if (onChange) onChange();
  });
}
bindToggle("btn-scale", "showScale");
bindToggle("btn-light", "lightMode", () => {
  document.querySelector(".canvas-wrap").classList.toggle("light", state.lightMode);
  fieldCacheKey = "";
});

$("btn-beam").addEventListener("click", () => {
  state.beamOn = !state.beamOn;
  const btn = $("btn-beam");
  btn.classList.toggle("playing", state.beamOn);
  btn.textContent = state.beamOn ? "Beam: ON" : "Beam: OFF";
});

$("btn-reset").addEventListener("click", clearScreen);
