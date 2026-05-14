"use strict";

// ── Constants ────────────────────────────────────────────────
const E_OVER_M = 1.759e11;          // C/kg
const D_PHYS   = 0.040;             // plate separation, metres
const L_PHYS   = 0.080;             // plate length, metres

// SVG geometry (matches viewBox 0 0 800 360)
const AXIS_Y       = 180;
const PLATE_X0     = 200;
const PLATE_X1     = 400;
const SCREEN_X     = 725;
const PLATE_TOP_Y  = 134;
const PLATE_BOT_Y  = 226;
const PX_PER_M_X   = (PLATE_X1 - PLATE_X0) / L_PHYS;
const PX_PER_M_Y   = (PLATE_BOT_Y - PLATE_TOP_Y) / D_PHYS;

// Per-session calibration error. The slider value differs slightly from the
// physics actually delivered to the beam, so the recorded data has built-in
// uncertainty (matches a real lab). Constant within a session.
function gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const cal = {
  vd: 1 + gauss() * 0.005,
  b:  1 + gauss() * 0.003,
};

// ── State ────────────────────────────────────────────────────
const state = { Va: 200, Vd: 0, B: 0 };

// ── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const beamPath     = $("beam-path");
const beamSpot     = $("beam-spot");
const bSymbols     = $("b-symbols");
const plateTop     = $("plate-top");
const plateBot     = $("plate-bot");
const plateTopSign = $("plate-top-sign");
const plateBotSign = $("plate-bot-sign");
const sliderVa = $("va");
const sliderVd = $("vd");
const sliderB  = $("b");
const valVa = $("va-val");
const valVd = $("vd-val");
const valB  = $("b-val");
const rVa = $("r-va");
const rVd = $("r-vd");
const rB  = $("r-b");

sliderVa.addEventListener("input", e => { state.Va = +e.target.value; refresh(); });
sliderVd.addEventListener("input", e => { state.Vd = +e.target.value; refresh(); });
sliderB .addEventListener("input", e => { state.B  = +e.target.value; refresh(); });

function wireNumInput(numEl, sliderEl, parseKey) {
  numEl.addEventListener("change", () => {
    let v = parseFloat(numEl.value);
    if (isNaN(v)) { refresh(); return; }
    const min = parseFloat(sliderEl.min), max = parseFloat(sliderEl.max);
    v = Math.max(min, Math.min(max, v));
    sliderEl.value = v;
    state[parseKey] = +sliderEl.value;
    refresh();
  });
}
wireNumInput(valVa, sliderVa, "Va");
wireNumInput(valVd, sliderVd, "Vd");
wireNumInput(valB,  sliderB,  "B");

// ── B-field overlay (always into page) ───────────────────────
function renderBSymbols(B_mT) {
  bSymbols.innerHTML = "";
  if (B_mT < 0.005) return;
  const opacity = Math.min(1, 0.3 + B_mT / 0.7);
  const xs = [225, 265, 305, 345, 385];
  const ys = [155, 180, 205];
  for (const x of xs) for (const y of ys) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    g.setAttribute("opacity", opacity);
    g.innerHTML =
      `<circle r="5.5" class="b-sym"/>` +
      `<line x1="-3.5" y1="-3.5" x2="3.5" y2="3.5" class="b-sym"/>` +
      `<line x1="-3.5" y1="3.5"  x2="3.5" y2="-3.5" class="b-sym"/>`;
    bSymbols.appendChild(g);
  }
}

// ── Plate sign / colour ──────────────────────────────────────
function renderPlateSigns(Vd) {
  if (Math.abs(Vd) < 0.5) {
    plateTop.classList.remove("charged-pos","charged-neg");
    plateBot.classList.remove("charged-pos","charged-neg");
    plateTopSign.classList.remove("show");
    plateBotSign.classList.remove("show");
    return;
  }
  const topPos = Vd > 0;
  plateTop.classList.toggle("charged-pos",  topPos);
  plateTop.classList.toggle("charged-neg", !topPos);
  plateBot.classList.toggle("charged-pos", !topPos);
  plateBot.classList.toggle("charged-neg",  topPos);
  plateTopSign.textContent = topPos ? "+" : "−";
  plateBotSign.textContent = topPos ? "−" : "+";
  plateTopSign.classList.add("show");
  plateBotSign.classList.add("show");
}

// ── Beam physics & rendering ────────────────────────────────
// Sign convention:
//   +V_d → top plate positive, electron deflects UP   (screen y decreases)
//   +B   → field INTO page,    electron deflects DOWN (screen y increases)
function computeBeam() {
  const v   = Math.sqrt(2 * E_OVER_M * state.Va);
  const E   = (state.Vd * cal.vd) / D_PHYS;
  const Bt  = (state.B * cal.b) * 1e-3;
  const aUp = E_OVER_M * (E - v * Bt);

  const tubeX0 = 162;
  const tubeX1 = 740;
  const N = 90;
  const pts = [];
  let hitsPlate = false;

  for (let i = 0; i <= N; i++) {
    const xPx = tubeX0 + (tubeX1 - tubeX0) * (i / N);
    let yMetres = 0;

    if (xPx <= PLATE_X0) {
      yMetres = 0;
    } else if (xPx <= PLATE_X1) {
      const xInPlate = (xPx - PLATE_X0) / PX_PER_M_X;
      const t = xInPlate / v;
      yMetres = 0.5 * aUp * t * t;
    } else {
      const tFull = L_PHYS / v;
      const yExit = 0.5 * aUp * tFull * tFull;
      const vyExit = aUp * tFull;
      const xPast = (xPx - PLATE_X1) / PX_PER_M_X;
      yMetres = yExit + vyExit * (xPast / v);
    }

    const yPx = AXIS_Y - yMetres * PX_PER_M_Y;

    if (xPx >= PLATE_X0 && xPx <= PLATE_X1) {
      if (yPx < PLATE_TOP_Y || yPx > PLATE_BOT_Y) {
        hitsPlate = true;
        pts.push({ x: xPx, y: Math.max(PLATE_TOP_Y, Math.min(PLATE_BOT_Y, yPx)) });
        break;
      }
    }

    pts.push({ x: xPx, y: yPx });

    if (xPx >= SCREEN_X) break;
  }

  let screenY_m = 0;
  if (!hitsPlate) {
    const tFull = L_PHYS / v;
    const yExit = 0.5 * aUp * tFull * tFull;
    const vyExit = aUp * tFull;
    const xPastM = (SCREEN_X - PLATE_X1) / PX_PER_M_X;
    screenY_m = yExit + vyExit * (xPastM / v);
  }

  return { points: pts, hitsPlate, screenY_m };
}

function renderBeam(beam) {
  beamPath.setAttribute("points",
    beam.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));

  if (beam.hitsPlate) {
    beamSpot.classList.add("hidden");
  } else {
    beamSpot.classList.remove("hidden");
    const yPx = AXIS_Y - beam.screenY_m * PX_PER_M_Y;
    beamSpot.setAttribute("cy", yPx.toFixed(1));
  }
}

function updateReadings() {
  rVa.textContent = `${state.Va} V`;
  rVd.textContent = `${state.Vd >= 0 ? "+" : ""}${state.Vd} V`;
  rB.textContent  = `${state.B.toFixed(3)} mT`;
  valVa.value = String(state.Va);
  valVd.value = String(state.Vd);
  valB.value  = state.B.toFixed(3);
}

function refresh() {
  renderBSymbols(state.B);
  renderPlateSigns(state.Vd);
  renderBeam(computeBeam());
  updateReadings();
}

refresh();
