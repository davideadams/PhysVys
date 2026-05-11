"use strict";

const canvas = document.getElementById("pe-canvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;   // 960
const H = canvas.height;  // 600

// ---- Scene geometry --------------------------------------------------------

const LAMP = { x: 50, y: 235, w: 90, h: 130, slitX: 140 };
const BEAM = { x0: 140, x1: 286, yMid: 300, halfH: 55 };
const CATHODE = { x: 286, w: 12, y0: 175, y1: 425 };
const ANODE   = { x: 662, w: 12, y0: 175, y1: 425 };
const TUBE = { x0: 218, y0: 148, x1: 742, y1: 452 };
const RAIL_Y = 515;
const BATT = { xL: 478, xR: 522, y: RAIL_Y };
const AMM  = { x: 388, y: RAIL_Y, r: 28 };

// Gap between plates (inner faces)
const GAP_X0 = CATHODE.x + CATHODE.w;   // 298
const GAP_X1 = ANODE.x;                 // 662
const GAP_LEN = GAP_X1 - GAP_X0;        // 364

// ---- Physics ---------------------------------------------------------------

const HC_eVnm = 1240;     // hc in eV·nm, so E(eV) = HC_eVnm / λ(nm)

const METAL_COLOR = "#b8c5d2";   // uniform neutral grey — no visual tells
const METALS = {
  Cs:      { W: 2.14, label: "Cs" },
  Na:      { W: 2.36, label: "Na" },
  Ca:      { W: 2.87, label: "Ca" },
  Mg:      { W: 3.68, label: "Mg" },
  Zn:      { W: 4.33, label: "Zn" },
  Cu:      { W: 4.65, label: "Cu" },
  Unknown: { W: 2.87, label: "?" },  // identical to Ca; students must determine this
};

// Visual speed reference: at KE = 2 eV, electron crosses gap in ~0.8 s at 1× speed.
const E_VIS_REF = 2.0;                  // eV
const V_ELECTRON_REF = GAP_LEN / 0.8;   // px/s when KE = E_VIS_REF

const PHOTON_SPEED = 320;               // px/s, visual
const PHOTON_RATE_MAX = 22;             // photons/s emitted at intensity 100%
const QE = 0.55;                        // fraction of above-threshold photons that emit an electron

// ---- State -----------------------------------------------------------------

const state = {
  lambda: 450,           // nm
  intensity: 60,         // 0..100
  metal: "Cs",
  V: 0.0,                // V (collector relative to cathode)

  showPhotons: true,
  showElectrons: true,
  maxKEOnly: false,
  showKEBars: false,

  lampOn: true,
  t: 0,
  photonAccum: 0,

  photons: [],   // { x, y, t }
  electrons: [], // { x, y, KE0, KE, dir, vy, alive }

  current: 0,    // smoothed display value (µA-equivalent units)
};

// ---- Wavelength → RGB ------------------------------------------------------

function wavelengthToRGB(nm) {
  // Bruton-style piecewise. Outside 380-700, return dimmed violet/deep-red.
  let r = 0, g = 0, b = 0;
  if (nm < 380) { r = 0.35; g = 0.0; b = 0.55; }
  else if (nm < 440) { r = -(nm - 440) / 60; g = 0; b = 1; }
  else if (nm < 490) { r = 0; g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { r = 0; g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; b = 0; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; b = 0; }
  else if (nm <= 700){ r = 1; g = 0; b = 0; }
  else               { r = 0.7; g = 0; b = 0; }

  // intensity falloff at the edges of the visible band
  let factor = 1;
  if (nm < 380) factor = 0.45;
  else if (nm < 420) factor = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm <= 645) factor = 1.0;
  else if (nm <= 700) factor = 0.3 + 0.7 * (700 - nm) / 55;
  else factor = 0.45;

  return [Math.round(255 * r * factor), Math.round(255 * g * factor), Math.round(255 * b * factor)];
}

function rgbStr(rgb, a = 1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

// ---- Derived physics -------------------------------------------------------

function getPhotonEnergy() { return HC_eVnm / state.lambda; }
function getWorkFn() { return METALS[state.metal].W; }
function getEMax() { return Math.max(0, getPhotonEnergy() - getWorkFn()); }

function getPhotonRate() {
  if (!state.lampOn) return 0;
  return (state.intensity / 100) * PHOTON_RATE_MAX;
}

// Collection fraction given current state.V and electron-KE distribution.
// Returns fraction of *emitted* electrons that reach the collector.
function collectionFraction() {
  const Emax = getEMax();
  if (Emax <= 0) return 0;
  if (state.V >= 0) return 1;          // accelerating: all reach collector
  const Vs = Emax;                      // stopping voltage (numerically, V_s = E_max/e)
  const Vret = -state.V;                // magnitude of retarding voltage
  if (Vret >= Vs) return 0;
  // V_a < 0, |V_a| < V_s
  if (state.maxKEOnly) return 1;
  // Uniform KE distribution on [0, E_max]: fraction with KE ≥ e·Vret
  return (Vs - Vret) / Vs;
}

// True current (analytic). Arbitrary units calibrated so saturation ~ 1.0.
function trueCurrent() {
  const Emax = getEMax();
  if (Emax <= 0) return 0;
  const emitRate = getPhotonRate() * QE;     // electrons/s emitted
  return emitRate * collectionFraction() / (PHOTON_RATE_MAX * QE); // 0..1
}

// ---- Particle lifecycle ----------------------------------------------------

function spawnPhoton() {
  const y = BEAM.yMid + (Math.random() - 0.5) * BEAM.halfH * 1.6;
  state.photons.push({ x: LAMP.slitX + 4, y, t: state.t });
}

function spawnElectron() {
  const Emax = getEMax();
  if (Emax <= 0) return;
  const KE0 = state.maxKEOnly ? Emax : Math.random() * Emax;
  const y = CATHODE.y0 + 16 + Math.random() * (CATHODE.y1 - CATHODE.y0 - 32);
  state.electrons.push({
    x: GAP_X0 + 1,
    y,
    KE0,
    KE: KE0,
    dir: 1,                // +1 toward anode, -1 back toward cathode
    vy: (Math.random() - 0.5) * 12,
    alive: true,
  });
}

function updatePhotons(dt) {
  for (const p of state.photons) p.x += PHOTON_SPEED * dt;
  for (let i = state.photons.length - 1; i >= 0; i--) {
    const p = state.photons[i];
    if (p.x >= CATHODE.x) {
      // Photon strike. Possibly emit an electron.
      const Eph = getPhotonEnergy();
      const Wfn = getWorkFn();
      if (Eph > Wfn && Math.random() < QE) spawnElectron();
      state.photons.splice(i, 1);
    }
  }
}

function updateElectrons(dt) {
  const Vc = state.V;        // collector potential (volts); cathode = 0
  for (const e of state.electrons) {
    if (!e.alive) continue;
    // KE at position x: KE = KE0 + e·V(x); V(x) = Vc · (x - GAP_X0)/GAP_LEN
    const Vx = Vc * (e.x - GAP_X0) / GAP_LEN;
    let KEnow = e.KE0 + Vx;  // numerically in eV (e cancels with V in eV)
    if (KEnow <= 0) {
      // Turn around: at this point KE was momentarily 0. Reverse direction.
      KEnow = 0.0005;
      e.dir = -1;
    }
    e.KE = KEnow;
    // visual speed
    const v = V_ELECTRON_REF * Math.sqrt(Math.max(KEnow, 0.001) / E_VIS_REF);
    e.x += e.dir * v * dt;
    e.y += e.vy * dt;
    // clamp y to gap interior
    const yMin = CATHODE.y0 + 6, yMax = CATHODE.y1 - 6;
    if (e.y < yMin) { e.y = yMin; e.vy = Math.abs(e.vy); }
    if (e.y > yMax) { e.y = yMax; e.vy = -Math.abs(e.vy); }
    // absorb at plates
    if (e.x >= GAP_X1) { e.alive = false; }
    if (e.x <= GAP_X0) { e.alive = false; }
  }
  state.electrons = state.electrons.filter((e) => e.alive);
}

// ---- Drawing ---------------------------------------------------------------

function drawLamp() {
  const rgb = wavelengthToRGB(state.lambda);
  const on = state.lampOn;
  // body
  ctx.fillStyle = "#1c2738";
  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = 1.5;
  roundRect(LAMP.x, LAMP.y, LAMP.w, LAMP.h, 8, true, true);
  if (on) {
    // bulb glow at the right face
    const gx = LAMP.x + LAMP.w - 18;
    const gy = LAMP.y + LAMP.h / 2;
    const grad = ctx.createRadialGradient(gx, gy, 4, gx, gy, 60);
    grad.addColorStop(0, rgbStr(rgb, 0.95));
    grad.addColorStop(0.4, rgbStr(rgb, 0.55));
    grad.addColorStop(1, rgbStr(rgb, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(LAMP.x, LAMP.y - 30, LAMP.w + 80, LAMP.h + 60);
  }
  // slit/aperture
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(LAMP.x + LAMP.w - 6, LAMP.y + LAMP.h / 2 - 30, 8, 60);
  if (on) {
    ctx.fillStyle = rgbStr(rgb, 0.85);
    ctx.fillRect(LAMP.x + LAMP.w - 4, LAMP.y + LAMP.h / 2 - 24, 4, 48);
  }
  // labels — placed clear of the glow gradient
  ctx.fillStyle = "#9fb4c8";
  ctx.font = "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Lamp", LAMP.x + LAMP.w / 2, LAMP.y - 14);
  // wavelength readout (below the glow region)
  const cx = LAMP.x + LAMP.w / 2;
  const yReadout = LAMP.y + LAMP.h + 42;
  ctx.fillStyle = "#cfdce8";
  ctx.font = "700 13px 'Segoe UI', sans-serif";
  ctx.fillText(`λ = ${state.lambda} nm`, cx, yReadout);
  // band indicator
  let band = "visible";
  if (state.lambda < 380) band = "ultraviolet";
  else if (state.lambda > 700) band = "infrared";
  ctx.fillStyle = "#7d93aa";
  ctx.font = "italic 500 11px 'Segoe UI', sans-serif";
  ctx.fillText(band, cx, yReadout + 16);
}

function drawBeam() {
  if (!state.lampOn) return;
  const rgb = wavelengthToRGB(state.lambda);
  const alpha = 0.08 + 0.12 * (state.intensity / 100);
  const grad = ctx.createLinearGradient(BEAM.x0, 0, BEAM.x1, 0);
  grad.addColorStop(0, rgbStr(rgb, alpha));
  grad.addColorStop(1, rgbStr(rgb, alpha * 0.6));
  ctx.fillStyle = grad;
  ctx.fillRect(BEAM.x0, BEAM.yMid - BEAM.halfH, BEAM.x1 - BEAM.x0, BEAM.halfH * 2);
}

function drawTube() {
  ctx.save();
  ctx.strokeStyle = "rgba(180,210,235,0.35)";
  ctx.lineWidth = 2;
  ctx.fillStyle = "rgba(140,180,220,0.04)";
  roundRect(TUBE.x0, TUBE.y0, TUBE.x1 - TUBE.x0, TUBE.y1 - TUBE.y0, 28, true, true);
  // glass highlight
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(TUBE.x0 + 30, TUBE.y0 + 10);
  ctx.lineTo(TUBE.x1 - 30, TUBE.y0 + 10);
  ctx.stroke();
  ctx.restore();
  // vacuum label
  ctx.fillStyle = "rgba(160,190,220,0.4)";
  ctx.font = "italic 500 11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("evacuated", (TUBE.x0 + TUBE.x1) / 2, TUBE.y0 + 22);
}

function drawPlates() {
  // Cathode
  ctx.fillStyle = METAL_COLOR;
  ctx.fillRect(CATHODE.x, CATHODE.y0, CATHODE.w, CATHODE.y1 - CATHODE.y0);
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.strokeRect(CATHODE.x, CATHODE.y0, CATHODE.w, CATHODE.y1 - CATHODE.y0);

  ctx.fillStyle = "#cfdce8";
  ctx.font = "700 13px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Cathode", CATHODE.x + 6, CATHODE.y0 - 22);
  ctx.fillStyle = "#9fb4c8";
  ctx.font = "600 11px 'Segoe UI', sans-serif";
  ctx.fillText(METALS[state.metal].label, CATHODE.x + 6, CATHODE.y0 - 8);

  // Anode (collector)
  ctx.fillStyle = METAL_COLOR;
  ctx.fillRect(ANODE.x, ANODE.y0, ANODE.w, ANODE.y1 - ANODE.y0);
  ctx.strokeRect(ANODE.x, ANODE.y0, ANODE.w, ANODE.y1 - ANODE.y0);
  ctx.fillStyle = "#cfdce8";
  ctx.font = "700 13px 'Segoe UI', sans-serif";
  ctx.fillText("Collector", ANODE.x + 6, ANODE.y0 - 14);
}

function drawCircuit() {
  ctx.strokeStyle = "#7c93aa";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  // Cathode wire: down then right to ammeter
  ctx.beginPath();
  ctx.moveTo(CATHODE.x + CATHODE.w / 2, CATHODE.y1);
  ctx.lineTo(CATHODE.x + CATHODE.w / 2, RAIL_Y);
  ctx.lineTo(AMM.x - AMM.r, RAIL_Y);
  ctx.stroke();

  // Ammeter circle
  ctx.fillStyle = "#101a2c";
  ctx.beginPath();
  ctx.arc(AMM.x, AMM.y, AMM.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#fde68a";
  ctx.font = "700 16px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", AMM.x, AMM.y - 2);

  // Ammeter wire to battery left
  ctx.strokeStyle = "#7c93aa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(AMM.x + AMM.r, RAIL_Y);
  ctx.lineTo(BATT.xL - 4, RAIL_Y);
  ctx.stroke();

  // Battery
  // Convention: collector at potential V (set by slider).
  // If V > 0 → anode side is +, so the cell's long line (positive terminal)
  // is on the right (anode-facing). If V < 0, swapped. If V == 0, neutral.
  const V = state.V;
  const longOnRight = V > 0;
  const noPolarity = Math.abs(V) < 0.05;
  // Draw plates
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineCap = "butt";
  // Left plate (length depends on polarity)
  const leftLong = !longOnRight && !noPolarity;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(BATT.xL, RAIL_Y - (leftLong ? 18 : 10));
  ctx.lineTo(BATT.xL, RAIL_Y + (leftLong ? 18 : 10));
  ctx.stroke();
  // Right plate
  const rightLong = longOnRight && !noPolarity;
  ctx.beginPath();
  ctx.moveTo(BATT.xR, RAIL_Y - (rightLong ? 18 : 10));
  ctx.lineTo(BATT.xR, RAIL_Y + (rightLong ? 18 : 10));
  ctx.stroke();
  // + / - labels
  if (!noPolarity) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "700 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(leftLong ? "+" : "−", BATT.xL, RAIL_Y - 24);
    ctx.fillText(rightLong ? "+" : "−", BATT.xR, RAIL_Y - 24);
  }

  // Battery wire to anode
  ctx.strokeStyle = "#7c93aa";
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BATT.xR + 4, RAIL_Y);
  ctx.lineTo(ANODE.x + ANODE.w / 2, RAIL_Y);
  ctx.lineTo(ANODE.x + ANODE.w / 2, ANODE.y1);
  ctx.stroke();

  // Voltage label below battery
  ctx.fillStyle = "#9fb4c8";
  ctx.font = "600 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const sign = V > 0 ? "+" : (V < 0 ? "−" : "");
  ctx.fillText(`V = ${sign}${Math.abs(V).toFixed(1)} V`, (BATT.xL + BATT.xR) / 2, RAIL_Y + 36);
}

function drawAmmeterReading() {
  const I = state.current;
  // map 0..1 to 0..9.99 µA
  const reading = (I * 9.99);
  ctx.fillStyle = "#0a1628";
  const bx = AMM.x - 44, by = AMM.y + AMM.r + 8, bw = 88, bh = 22;
  roundRect(bx, by, bw, bh, 5, true, false);
  ctx.fillStyle = "#fde68a";
  ctx.font = "700 13px 'Consolas', 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${reading.toFixed(2)} mA`, AMM.x, by + bh / 2 + 1);
}

function drawPhotons() {
  if (!state.showPhotons) return;
  const rgb = wavelengthToRGB(state.lambda);
  // Wave packet: a few cycles of sine inside a gaussian envelope.
  // Cycle count tied loosely to inverse wavelength (shorter λ → tighter wiggles).
  const halfLen = 9;                                       // packet half-length in px
  const cycles = 2.2 + (700 - state.lambda) / 250;         // ~2.2 (red) … 4.2 (UV)
  const amp = 3.2;
  const k = (cycles * 2 * Math.PI) / (2 * halfLen);        // spatial frequency
  ctx.strokeStyle = rgbStr(rgb, 0.95);
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const p of state.photons) {
    ctx.beginPath();
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const dx = -halfLen + (2 * halfLen) * (i / steps);
      const env = Math.exp(-(dx * dx) / (2 * (halfLen * 0.45) * (halfLen * 0.45)));
      const dy = amp * env * Math.sin(k * dx);
      if (i === 0) ctx.moveTo(p.x + dx, p.y + dy);
      else ctx.lineTo(p.x + dx, p.y + dy);
    }
    ctx.stroke();
  }
}

function drawElectrons() {
  if (!state.showElectrons) return;
  for (const e of state.electrons) {
    ctx.fillStyle = "#5dd1ff";
    ctx.beginPath();
    ctx.arc(e.x, e.y, 3.8, 0, Math.PI * 2);
    ctx.fill();
    if (state.showKEBars) {
      // little vertical bar above electron showing KE / E_max_init
      const Emax = getEMax();
      if (Emax > 0) {
        const f = Math.max(0, Math.min(1, e.KE / Emax));
        const barH = 18;
        ctx.fillStyle = "rgba(52,211,153,0.25)";
        ctx.fillRect(e.x - 2, e.y - 22, 4, barH);
        ctx.fillStyle = "#34d399";
        ctx.fillRect(e.x - 2, e.y - 22 + (barH * (1 - f)), 4, barH * f);
      }
    }
  }
}

// rounded-rect helper
function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ---- Main loop -------------------------------------------------------------

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  state.t += dt;

  // Spawn photons
  state.photonAccum += getPhotonRate() * dt;
  while (state.photonAccum >= 1) {
    spawnPhoton();
    state.photonAccum -= 1;
  }

  updatePhotons(dt);
  updateElectrons(dt);

  // Smooth current readout (idealised: exact analytic value, lightly smoothed for ammeter feel)
  const I = trueCurrent();
  state.current += (I - state.current) * Math.min(1, dt * 8);

  // Draw
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, W, H);

  drawTube();
  drawLamp();
  drawBeam();
  drawPlates();
  drawCircuit();
  drawAmmeterReading();
  drawPhotons();
  drawElectrons();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Controls --------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function setV(v, source) {
  if (!Number.isFinite(v)) return;
  v = Math.max(-3.0, Math.min(3.0, Math.round(v * 10) / 10));
  state.V = v;
  if (source !== "slider") $("slider-V").value = v.toFixed(1);
  if (source !== "number") $("num-V").value = v.toFixed(1);
}

$("slider-lambda").addEventListener("input", (e) => {
  state.lambda = parseInt(e.target.value, 10);
  $("val-lambda").textContent = state.lambda;
});
$("slider-intensity").addEventListener("input", (e) => {
  state.intensity = parseInt(e.target.value, 10);
  $("val-intensity").textContent = state.intensity;
});
$("slider-V").addEventListener("input", (e) => {
  setV(parseFloat(e.target.value), "slider");
});
$("num-V").addEventListener("input", (e) => {
  const raw = parseFloat(e.target.value);
  if (Number.isFinite(raw)) setV(raw, "number");
});
$("num-V").addEventListener("blur", () => {
  // On blur, re-normalise the displayed value (handles incomplete/invalid edits)
  $("num-V").value = state.V.toFixed(1);
});

$("sel-metal").addEventListener("change", (e) => {
  state.metal = e.target.value;
  state.electrons = [];
});

function bindToggle(btnId, prop) {
  const btn = $(btnId);
  btn.addEventListener("click", () => {
    state[prop] = !state[prop];
    btn.classList.toggle("active", state[prop]);
    // Clear in-flight particles so what's on screen reflects the new toggle state
    state.photons = [];
    state.electrons = [];
    state.photonAccum = 0;
  });
}
bindToggle("btn-photons", "showPhotons");
bindToggle("btn-electrons", "showElectrons");
bindToggle("btn-maxke", "maxKEOnly");
bindToggle("btn-kebars", "showKEBars");

$("btn-lamp").addEventListener("click", () => {
  state.lampOn = !state.lampOn;
  const btn = $("btn-lamp");
  btn.classList.toggle("playing", state.lampOn);
  btn.textContent = state.lampOn ? "Light: ON" : "Light: OFF";
  if (!state.lampOn) state.photons = [];
});

// Initial label sync
setV(state.V, "init");
