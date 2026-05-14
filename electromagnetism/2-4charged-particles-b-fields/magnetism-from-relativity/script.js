/* ═══════════════════════════════════════════════════════════════
   Magnetism from Relativity — Purcell's argument, visualised.

   A horizontal wire contains a periodic ion lattice and a stream of
   conduction electrons.  In the lab frame the two line densities are
   equal and opposite (wire neutral); the drifting electrons constitute
   a current that produces a magnetic field, and a test charge moving
   alongside feels F = qv×B.

   In the drift frame (moving with the electrons / test charge), the
   electrons are at rest while the ion lattice now moves the other way.
   Length contraction shrinks the ion spacing (denser) and restores the
   electron spacing to its proper value (less dense), giving the wire
   a net positive line density λ' = γβ² λ₀.  The test charge feels a
   purely electric force qE that matches the lab's magnetic force
   (transverse force transforms as F⊥ = F'⊥/γ).

   Drift speeds shown here are deliberately exaggerated (β up to 0.9)
   so the contraction is visible; in a real wire β ~ 10⁻¹³.
═══════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');

const CW = canvas.width;
const CH = canvas.height;

const state = {
  beta: 0.6,
  qSign: -1,             // −1 = negative test charge (matches electron drift)
  frame: 'lab',          // 'lab' | 'drift'
  showVels: true,
  showForce: true,
  showField: true,
  playing: true,
};

/* ── Layout (canvas-pixel coords) ─────────────────────────── */
const WIRE_X0 = 60;
const WIRE_X1 = 900;
const WIRE_Y_TOP = 200;
const WIRE_Y_BOT = 300;
const WIRE_Y_MID = (WIRE_Y_TOP + WIRE_Y_BOT) / 2;
const TEST_X = 480;
const TEST_Y = 440;

const A_LAB_PX = 56;        // lab-frame spacing of ions = electrons (px)

/* ── Physics helpers ──────────────────────────────────────── */
function gammaOf(b) { return 1 / Math.sqrt(1 - b * b); }

/* In each frame, return spacings (px) and velocities (px/sec) for
   the ion and electron streams, plus the linear charge density of
   each in units of λ₀. */
function streamsForFrame() {
  const b = state.beta;
  const g = gammaOf(b);
  // Pick a screen drift speed (px/s) that is moderate at all β.
  const VPX = 90 * b / 0.6;   // visual speed; β=0.6 ⇒ 90 px/s
  if (state.frame === 'lab') {
    return {
      ion:  { spacing: A_LAB_PX,     vpx:  0,    density: +1 },
      ele:  { spacing: A_LAB_PX,     vpx: +VPX,  density: -1 },
      test: { vpx: +VPX },
      gamma: g,
    };
  }
  // Drift frame: ions move at −v, contracted; electrons at rest, expanded.
  return {
    ion:  { spacing: A_LAB_PX / g, vpx: -VPX,  density: +g },
    ele:  { spacing: A_LAB_PX * g, vpx:  0,    density: -1 / g },
    test: { vpx: 0 },
    gamma: g,
  };
}

/* Force computation, normalised to F₀ = e λ₀ /(2π ε₀ r):
     Lab:    F/F₀ = β²       (purely magnetic)
     Drift:  F/F₀ = γ β²     (purely electric)
   Sign convention: positive ⇒ AWAY from wire (downward, +y in canvas).
   In lab: F_y = -q · v · B  with current to the LEFT (electrons drift
   rightward), so B at test point is OUT of page; for q>0 moving right,
   v×B points downward (+y), force is +q·(+y) — positive q is repelled,
   negative q (matching electrons) is attracted (toward wire).         */
function forceInFrame() {
  const b = state.beta;
  const g = gammaOf(b);
  const dirSign = state.qSign;          // +1 ⇒ away, −1 ⇒ toward
  if (state.frame === 'lab') {
    return { magOverF0: b * b,         dir: dirSign, kind: 'magnetic' };
  }
  return     { magOverF0: g * b * b,    dir: dirSign, kind: 'electric' };
}

/* ── Drawing ──────────────────────────────────────────────── */
function clear() {
  // Translucent panel-tinted background to match the sim style.
  ctx.fillStyle = '#f3f8ff';
  ctx.fillRect(0, 0, CW, CH);
}

function drawWireFrame() {
  // Faint wire body (a horizontal channel)
  const grad = ctx.createLinearGradient(0, WIRE_Y_TOP, 0, WIRE_Y_BOT);
  grad.addColorStop(0,   '#e8d5b3');
  grad.addColorStop(0.5, '#f3e2c4');
  grad.addColorStop(1,   '#d8bf95');
  ctx.fillStyle = grad;
  ctx.fillRect(WIRE_X0, WIRE_Y_TOP, WIRE_X1 - WIRE_X0, WIRE_Y_BOT - WIRE_Y_TOP);
  ctx.strokeStyle = 'rgba(120, 85, 30, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(WIRE_X0, WIRE_Y_TOP, WIRE_X1 - WIRE_X0, WIRE_Y_BOT - WIRE_Y_TOP);
}

function drawStream(streamRow, spacing, phase, color, glyph) {
  // Draw a row of evenly-spaced symbols across the wire, offset by phase.
  const y = streamRow;
  // Find first x ≥ WIRE_X0 such that x ≡ phase (mod spacing).
  const startOffset = ((phase % spacing) + spacing) % spacing;
  let x = WIRE_X0 + startOffset;
  ctx.save();
  ctx.font = '700 22px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (; x <= WIRE_X1 - 4; x += spacing) {
    // Glyph disk
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.fillText(glyph, x, y + 1);
  }
  ctx.restore();
}

function drawArrow(x0, y0, x1, y1, color, width = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // Arrowhead
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) { ctx.restore(); return; }
  const ux = dx / len, uy = dy / len;
  const head = Math.min(12, len * 0.45);
  const wing = head * 0.6;
  const nx = -uy, ny = ux;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head + nx * wing, y1 - uy * head + ny * wing);
  ctx.lineTo(x1 - ux * head - nx * wing, y1 - uy * head - ny * wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTestCharge() {
  const r = 17;
  ctx.save();
  ctx.beginPath();
  ctx.arc(TEST_X, TEST_Y, r, 0, Math.PI * 2);
  ctx.fillStyle = state.qSign > 0 ? '#c2410c' : '#1d4ed8';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.stroke();
  ctx.fillStyle = 'white';
  ctx.font = '800 22px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.qSign > 0 ? '+' : '−', TEST_X, TEST_Y + 1);
  ctx.restore();
  // Label
  ctx.save();
  ctx.font = 'italic 700 18px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'left';
  ctx.fillText('test charge q', TEST_X + 26, TEST_Y - 12);
  ctx.restore();
}

function drawVelocityArrows(streams) {
  if (!state.showVels) return;
  const VSCALE = 0.55;     // px shown per (px/s) of motion
  // Ion velocity arrow at left edge of wire
  if (Math.abs(streams.ion.vpx) > 1) {
    const len = streams.ion.vpx * VSCALE;
    drawArrow(WIRE_X0 + 30, WIRE_Y_TOP - 18,
              WIRE_X0 + 30 + len, WIRE_Y_TOP - 18,
              '#c2410c', 2.5);
    annotate(WIRE_X0 + 30, WIRE_Y_TOP - 32, 'v(ions)', '#c2410c');
  }
  // Electron velocity arrow at right edge of wire
  if (Math.abs(streams.ele.vpx) > 1) {
    const len = streams.ele.vpx * VSCALE;
    drawArrow(WIRE_X1 - 30 - Math.max(0, len), WIRE_Y_BOT + 20,
              WIRE_X1 - 30 - Math.max(0, len) + len, WIRE_Y_BOT + 20,
              '#1d4ed8', 2.5);
    annotate(WIRE_X1 - 60, WIRE_Y_BOT + 36, 'v(electrons)', '#1d4ed8');
  }
  // Test charge velocity arrow
  if (Math.abs(streams.test.vpx) > 1) {
    const len = streams.test.vpx * VSCALE;
    drawArrow(TEST_X, TEST_Y + 30, TEST_X + len, TEST_Y + 30, '#0d9488', 2.5);
    annotate(TEST_X, TEST_Y + 50, 'v(test)', '#0d9488');
  }
}

function annotate(x, y, text, color) {
  ctx.save();
  ctx.font = 'italic 600 13px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawForce() {
  if (!state.showForce) return;
  const f = forceInFrame();
  if (f.magOverF0 < 1e-6) return;
  // Visual length: clamp by sqrt for readability across β range.
  const visLen = 30 + 60 * Math.sqrt(f.magOverF0);
  const yEnd = TEST_Y + f.dir * visLen;       // dir +1 = away (down), −1 = toward (up)
  drawArrow(TEST_X - 24, TEST_Y, TEST_X - 24, yEnd, '#15803d', 3.5);
  ctx.save();
  ctx.font = 'italic 800 18px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#15803d';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', TEST_X - 32, (TEST_Y + yEnd) / 2);
  ctx.restore();
}

function drawFieldAtTest(streams) {
  if (!state.showField) return;
  // In lab: B field. In drift: E field. Show as a small symbol next
  // to the test charge.
  ctx.save();
  ctx.font = 'italic 800 18px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.frame === 'lab') {
    // Conventional current is OPPOSITE to electron drift (electrons →
    // means I ←). Below the wire, by RHR, B is OUT of page (⊙).
    drawCircleGlyph(TEST_X + 50, TEST_Y, 14, '#9333ea', 'out');
    ctx.fillStyle = '#9333ea';
    ctx.fillText('B', TEST_X + 76, TEST_Y);
  } else {
    // Net + line density ⇒ E points radially outward; below wire that's
    // straight down (+y).
    drawArrow(TEST_X + 50, TEST_Y - 20, TEST_X + 50, TEST_Y + 20, '#9333ea', 3);
    ctx.fillStyle = '#9333ea';
    ctx.fillText('E', TEST_X + 76, TEST_Y);
  }
  ctx.restore();
}

function drawCircleGlyph(cx, cy, r, color, kind) {
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (kind === 'in') {
    ctx.moveTo(cx - r * 0.55, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.55, cy + r * 0.55);
    ctx.moveTo(cx + r * 0.55, cy - r * 0.55);
    ctx.lineTo(cx - r * 0.55, cy + r * 0.55);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFrameLabel() {
  ctx.save();
  ctx.font = '700 16px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const txt = state.frame === 'lab'
    ? 'Lab frame — wire at rest, electrons drift'
    : 'Drift frame — riding with the electrons';
  ctx.fillText(txt, 24, 18);
  ctx.font = 'italic 600 13px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.fillText(`β = ${state.beta.toFixed(2)},  γ = ${gammaOf(state.beta).toFixed(3)}`,
               24, 40);
  ctx.restore();
}

/* ── Animation ────────────────────────────────────────────── */
let phaseIon = 0;     // px offset of ion lattice
let phaseEle = 0;     // px offset of electron stream
let lastT = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  const streams = streamsForFrame();
  if (state.playing) {
    phaseIon += streams.ion.vpx * dt;
    phaseEle += streams.ele.vpx * dt;
  }

  clear();
  drawFrameLabel();
  drawWireFrame();
  // Two rows: ions on top half, electrons on bottom half — keeps the
  // spacings comparable side-by-side.
  drawStream(WIRE_Y_MID - 17, streams.ion.spacing, phaseIon, '#c2410c', '+');
  drawStream(WIRE_Y_MID + 17, streams.ele.spacing, phaseEle, '#1d4ed8', '−');
  drawVelocityArrows(streams);
  drawTestCharge();
  drawFieldAtTest(streams);
  drawForce();

  updateReadout(streams);

  requestAnimationFrame(frame);
}

/* ── Readouts ─────────────────────────────────────────────── */
function fmt(v, digits = 3) {
  if (Math.abs(v) < 1e-12) return '0';
  return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

function updateReadout(streams) {
  const g = gammaOf(state.beta);
  document.getElementById('ro-gamma').textContent = g.toFixed(3);
  document.getElementById('ro-lp').textContent = fmt(streams.ion.density) + ' λ₀';
  document.getElementById('ro-ln').textContent = fmt(streams.ele.density) + ' λ₀';
  const net = streams.ion.density + streams.ele.density;
  document.getElementById('ro-lnet').textContent = fmt(net) + ' λ₀';

  const f = forceInFrame();
  let dirText;
  if (f.dir > 0) dirText = 'AWAY from wire';
  else           dirText = 'TOWARD wire';
  const fLabel = `${f.kind} · ${dirText}\n|F| = ${f.magOverF0.toFixed(3)} F₀`;
  // Two-line readout
  const fEl = document.getElementById('ro-fkind');
  fEl.innerHTML = `<span style="color:#0f766e;text-transform:capitalize">${f.kind}</span> · ${dirText}` +
                  `<br><span style="color:#55708d;font-weight:600;font-size:0.82rem">|F| = ${f.magOverF0.toFixed(3)} F₀ &nbsp;` +
                  `<span style="font-style:italic">F₀ = eλ₀ ⁄ 2πε₀r</span></span>`;

  updateWhyCard();
}

function updateWhyCard() {
  const el = document.getElementById('why-card');
  const sign = state.qSign > 0 ? 'positive' : 'negative';
  if (state.frame === 'lab') {
    el.innerHTML =
      `<strong>Lab frame:</strong> ions and electrons have equal and opposite line ` +
      `densities (+λ₀ and −λ₀), so the wire is neutral — no electric field. ` +
      `The drifting electrons carry a current; that current makes a magnetic field ` +
      `B at the test charge, and the moving ${sign} test charge feels ` +
      `<em>F = qv×B</em>.`;
  } else {
    el.innerHTML =
      `<strong>Drift frame:</strong> the electrons are now at rest — no current, no B. ` +
      `But the ion lattice is moving, so it is length-contracted: ion spacing shrinks by γ ` +
      `(density ×γ) while the electron spacing relaxes to its proper value (density ÷γ). ` +
      `Net line density is <em>+γβ²λ₀</em>, giving an electric field E pointing away from ` +
      `the wire. The ${sign} test charge (now at rest) feels <em>F = qE</em> — same direction ` +
      `as the lab's magnetic force, larger by exactly γ as required by force transformation.`;
  }
}

/* ── UI wiring ────────────────────────────────────────────── */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('#seg-frame .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.frame = btn.dataset.val;
    setActive('#seg-frame', btn);
    // Reset phases so the visual flips cleanly.
    phaseIon = 0; phaseEle = 0;
  });
});
document.querySelectorAll('#seg-q .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.qSign = btn.dataset.val === 'pos' ? +1 : -1;
    setActive('#seg-q', btn);
  });
});

const sliderBeta = document.getElementById('slider-beta');
const valBeta = document.getElementById('val-beta');
sliderBeta.addEventListener('input', () => {
  state.beta = parseFloat(sliderBeta.value);
  valBeta.value = state.beta.toFixed(2);
});
valBeta.addEventListener('change', () => {
  let v = parseFloat(valBeta.value);
  if (isNaN(v)) { valBeta.value = state.beta.toFixed(2); return; }
  const min = parseFloat(sliderBeta.min), max = parseFloat(sliderBeta.max);
  v = Math.max(min, Math.min(max, v));
  sliderBeta.value = v;
  state.beta = parseFloat(sliderBeta.value);
  valBeta.value = state.beta.toFixed(2);
});

function toggleVecBtn(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
  });
}
toggleVecBtn('btn-vels',  'showVels');
toggleVecBtn('btn-force', 'showForce');
toggleVecBtn('btn-field', 'showField');

const btnPlay = document.getElementById('btn-play');
btnPlay.addEventListener('click', () => {
  state.playing = !state.playing;
  btnPlay.textContent = state.playing ? 'Pause' : 'Play';
});

document.getElementById('btn-reset').addEventListener('click', () => {
  state.beta = 0.6;
  state.qSign = -1;
  state.frame = 'lab';
  state.showVels = true;
  state.showForce = true;
  state.showField = true;
  state.playing = true;
  sliderBeta.value = '0.6';
  valBeta.value = '0.60';
  setActive('#seg-frame', document.querySelector('#seg-frame .seg-btn[data-val="lab"]'));
  setActive('#seg-q',     document.querySelector('#seg-q .seg-btn[data-val="neg"]'));
  ['btn-vels','btn-force','btn-field'].forEach((id) => document.getElementById(id).classList.add('active'));
  btnPlay.textContent = 'Pause';
  phaseIon = 0; phaseEle = 0;
});

/* ── Hi-DPI canvas ────────────────────────────────────────── */
function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW < 2 || cssH < 2) return;
  // Keep internal coordinate system at 960×560; just resize the
  // backing store for crisp rendering.
  canvas.width  = Math.round(960);
  canvas.height = Math.round(560);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

requestAnimationFrame((t) => { lastT = t; frame(t); });
