"use strict";

// ---- Canvas ----------------------------------------------------------------
const canvas = document.getElementById("rt-canvas");
const ctx = canvas.getContext("2d");
const CW = 960, CH = 500;

// Tube geometry (canvas px, native resolution)
const TX1 = 128, TX2 = 868;   // tube inner x range
const TW  = TX2 - TX1;        // tube inner width  = 740
const TCY = 295;               // tube centre y
const TIH = 68;                // tube inner height
const TWL = 9;                 // tube wall thickness
const TOH = TIH + TWL * 2;    // tube outer height  = 86
const NUM_HOLES = 40;
const VISUAL_SPEED = 0.5;   // multiplier on t for pressure graph and particle oscillation
const MAX_FLAME = 155;         // px above tube top

const NUM_PARTICLES = 560;
const NUM_MODES = 14;

// ---- State -----------------------------------------------------------------
const state = {
  view:      "particles",  // "particles" | "graph"
  source:    "tone",       // "tone" | "mic" | "system"
  lightMode: false,

  tubeLength: 1.5,         // m
  gasCspeed:  250,         // m/s
  Q:          12,

  toneFreq:  100,          // Hz
  soundOn:   false,
  sweeping:  false,
  sweepDir:  1,

  gainMult:  8,
  audioConnected: false,

  audioCtx:   null,
  analyser:   null,
  oscNode:    null,
  oscGain:    null,
  srcNode:    null,
  stream:     null,

  flameProfile:   new Float32Array(NUM_HOLES).fill(0),
  smoothProfile:  new Float32Array(NUM_HOLES).fill(0),

  p0x: null, p0y: null, px: null,
  flickerPhase: null,

  t: 0,
};

// ---- Physics ---------------------------------------------------------------

function resonantFreqs() {
  // Open-closed pipe: speaker end is a pressure node, sealed end is a pressure antinode.
  // Only odd harmonics: fn = (2n-1) * c / (4L)
  const out = [];
  for (let n = 1; n <= NUM_MODES; n++)
    out.push((2 * n - 1) * state.gasCspeed / (4 * state.tubeLength));
  return out;
}

function modeResponse(f, fn) {
  const r = f / fn;
  return 1 / Math.sqrt((1 - r * r) ** 2 + (r / state.Q) ** 2);
}

// Signed spatial pressure pattern at normalised x (0..1).
// sin-based: zero at speaker (x=0), max at sealed end (x=1).
// Only modes whose response is within this fraction of the dominant are included.
// Filters the far-off-resonance modes that would otherwise add visible spatial ripple.
const MODE_THRESHOLD = 0.15;

function tonePattern(x) {
  const fns = resonantFreqs();
  const Rs  = fns.map(fn => modeResponse(state.toneFreq, fn));
  const Rmax = Math.max(...Rs);
  let p = 0, w = 0;
  for (let n = 1; n <= NUM_MODES; n++) {
    if (Rs[n - 1] < Rmax * MODE_THRESHOLD) continue;
    const kn = (2 * n - 1) * Math.PI / 2;
    p += Rs[n - 1] * Math.sin(kn * x);
    w += Rs[n - 1];
  }
  return w > 0 ? p / w : 0;
}

function toneDisplacement(x) {
  const fns = resonantFreqs();
  const Rs  = fns.map(fn => modeResponse(state.toneFreq, fn));
  const Rmax = Math.max(...Rs);
  let u = 0, w = 0;
  for (let n = 1; n <= NUM_MODES; n++) {
    if (Rs[n - 1] < Rmax * MODE_THRESHOLD) continue;
    const kn = (2 * n - 1) * Math.PI / 2;
    u += Rs[n - 1] * Math.cos(kn * x);
    w += Rs[n - 1];
  }
  return w > 0 ? u / w : 0;
}

function toneOverallScale() {
  const fns = resonantFreqs();
  const maxR = Math.max(...fns.map(fn => modeResponse(state.toneFreq, fn)));
  // At resonance maxR === Q, so scale === 1 and the wave fills the tube.
  // Off-resonance it falls below 1 — more steeply for high Q (sharp resonance).
  return Math.min(maxR / state.Q, 1.0);
}

function buildToneProfile() {
  const overallScale = toneOverallScale();

  const raw = new Float32Array(NUM_HOLES);
  let maxV = 0;
  for (let i = 0; i < NUM_HOLES; i++) {
    const x = (i + 0.5) / NUM_HOLES;
    raw[i] = Math.abs(tonePattern(x));
    if (raw[i] > maxV) maxV = raw[i];
  }
  if (maxV > 0) for (let i = 0; i < NUM_HOLES; i++) raw[i] /= maxV;
  for (let i = 0; i < NUM_HOLES; i++) raw[i] *= overallScale;
  state.flameProfile = raw;
}

function buildAudioProfile() {
  const { analyser, audioCtx, gainMult } = state;
  if (!analyser) return;

  const fftSize = analyser.fftSize;
  const sr = audioCtx.sampleRate;
  const freqBuf = new Float32Array(fftSize / 2);
  analyser.getFloatFrequencyData(freqBuf);

  const fns = resonantFreqs();
  const amps = new Float32Array(NUM_MODES);
  for (let n = 0; n < NUM_MODES; n++) {
    const bin = Math.round(fns[n] * fftSize / sr);
    if (bin >= freqBuf.length) continue;
    const db = Math.max(freqBuf[bin], -90);
    amps[n] = Math.pow(10, db / 20) * gainMult;
  }

  const raw = new Float32Array(NUM_HOLES);
  let maxV = 0;
  for (let i = 0; i < NUM_HOLES; i++) {
    const x = (i + 0.5) / NUM_HOLES;
    let p2 = 0;
    for (let n = 0; n < NUM_MODES; n++) {
      const kn = (n + 1) * Math.PI;
      p2 += amps[n] * amps[n] * Math.cos(kn * x) * Math.cos(kn * x);
    }
    raw[i] = Math.sqrt(p2);
    if (raw[i] > maxV) maxV = raw[i];
  }
  if (maxV > 0) for (let i = 0; i < NUM_HOLES; i++) raw[i] /= maxV;

  const α = 0.20;
  for (let i = 0; i < NUM_HOLES; i++)
    state.smoothProfile[i] = α * raw[i] + (1 - α) * state.smoothProfile[i];

  state.flameProfile = state.smoothProfile;
}

// Find interior zero-crossings of tonePattern by sampling, using linear interpolation.
// x=0 (speaker) is always a node and is excluded.
function findNodes() {
  const STEPS = 800;
  const nodes = [];
  let prev = tonePattern(1 / STEPS);
  for (let i = 2; i <= STEPS; i++) {
    const x = i / STEPS;
    const curr = tonePattern(x);
    if (prev * curr < 0) {
      const x0 = (i - 1) / STEPS;
      nodes.push(x0 + (1 / STEPS) * Math.abs(prev) / (Math.abs(prev) + Math.abs(curr)));
    }
    prev = curr;
  }
  return nodes;
}

function dominantMode() {
  const fns = resonantFreqs();
  let best = 0, bestR = 0;
  for (let n = 1; n <= NUM_MODES; n++) {
    const R = modeResponse(state.toneFreq, fns[n - 1]);
    if (R > bestR) { bestR = R; best = n; }
  }
  return best;
}

// ---- Particles -------------------------------------------------------------

function initParticles() {
  state.p0x = new Float32Array(NUM_PARTICLES);
  state.p0y = new Float32Array(NUM_PARTICLES);
  state.px  = new Float32Array(NUM_PARTICLES);
  for (let i = 0; i < NUM_PARTICLES; i++) {
    state.p0x[i] = TX1 + Math.random() * TW;
    state.p0y[i] = TCY - TIH / 2 + 4 + Math.random() * (TIH - 8);
  }
}

function updateParticles(t) {
  const omega = 2 * Math.PI * state.toneFreq;
  const DISP = 22;
  const sinT = Math.sin(omega * t * VISUAL_SPEED);
  for (let i = 0; i < NUM_PARTICLES; i++) {
    const x = (state.p0x[i] - TX1) / TW;
    state.px[i] = state.p0x[i] + toneDisplacement(x) * sinT * DISP;
  }
}

// ---- Flicker ---------------------------------------------------------------

function initFlicker() {
  state.flickerPhase = new Float32Array(NUM_HOLES);
  for (let i = 0; i < NUM_HOLES; i++)
    state.flickerPhase[i] = Math.random() * Math.PI * 2;
}

function flickerAt(i, t) {
  return 1 + 0.04 * Math.sin(state.flickerPhase[i] + t * 7.3)
           + 0.03 * Math.sin(state.flickerPhase[i] * 1.7 + t * 13.1);
}

// ---- Drawing — tube --------------------------------------------------------

function drawTube() {
  const light = state.lightMode;
  const tubeTop = TCY - TOH / 2;
  const innerTop = TCY - TIH / 2;

  // Metal body
  ctx.fillStyle = light ? "#b8b0a0" : "#2c2820";
  ctx.beginPath();
  ctx.roundRect(TX1 - TWL, tubeTop, TW + TWL * 2 + 12, TOH, 6);
  ctx.fill();

  // Gas interior
  ctx.fillStyle = light ? "#ddd8c8" : "#0e0c08";
  ctx.fillRect(TX1, innerTop, TW, TIH);

  // Holes: clear gaps in top wall
  const hStep = TW / NUM_HOLES;
  const holeW = Math.max(hStep * 0.38, 3);
  ctx.fillStyle = light ? "#ddd8c8" : "#0e0c08";
  for (let i = 0; i < NUM_HOLES; i++) {
    const hx = TX1 + (i + 0.5) * hStep;
    ctx.fillRect(hx - holeW / 2, tubeTop, holeW, TWL);
  }

  // Sealed end cap
  ctx.fillStyle = light ? "#a09080" : "#1e1a14";
  ctx.fillRect(TX2 + 12, tubeTop, 10, TOH);

  // Speaker
  drawSpeaker(light);

  // Outline
  ctx.strokeStyle = light ? "rgba(80,60,40,0.2)" : "rgba(255,220,160,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(TX1 - TWL, tubeTop, TW + TWL * 2 + 22, TOH, 6);
  ctx.stroke();
}

function drawSpeaker(light) {
  const cx = TX1 - TWL - 1;
  const cy = TCY;
  const hw = TIH / 2 + 2;
  const coneW = 36, bodyW = 18;

  ctx.fillStyle = light ? "#c8b898" : "#3a3020";
  ctx.beginPath();
  ctx.moveTo(cx - coneW, cy - hw - 10);
  ctx.lineTo(cx,          cy - hw);
  ctx.lineTo(cx,          cy + hw);
  ctx.lineTo(cx - coneW, cy + hw + 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = light ? "#b0a090" : "#2a2418";
  ctx.fillRect(cx - coneW - bodyW, cy - hw - 12, bodyW, (hw + 12) * 2);

  // Sine squiggle on body
  ctx.strokeStyle = light ? "rgba(100,80,60,0.45)" : "rgba(255,200,100,0.30)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const bx = cx - coneW - bodyW + 5;
  const bw = bodyW - 10;
  for (let xi = 0; xi <= 24; xi++) {
    const px = bx + (xi / 24) * bw;
    const py = cy + Math.sin(xi / 24 * Math.PI * 2.5) * 7;
    xi === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// ---- Drawing — flames ------------------------------------------------------

function drawFlames(t) {
  const tubeTop = TCY - TOH / 2;
  const hStep = TW / NUM_HOLES;

  for (let i = 0; i < NUM_HOLES; i++) {
    const hx = TX1 + (i + 0.5) * hStep;
    const h = state.flameProfile[i] * MAX_FLAME * flickerAt(i, t);
    if (h < 2) continue;
    const lean = Math.sin(state.flickerPhase[i] * 2.3 + t * 5.7) * 2.5;
    ctx.save();
    drawFlame(hx, tubeTop, h, lean);
    ctx.restore();
  }
}

function drawFlame(x, baseY, height, lean) {
  const hw  = Math.max(height * 0.18, 3.5);
  const tipX = x + lean;
  const tipY = baseY - height;

  ctx.beginPath();
  ctx.moveTo(x - hw, baseY);
  ctx.bezierCurveTo(x - hw * 0.8, baseY - height * 0.35,
                    tipX - hw * 0.5, tipY + height * 0.25, tipX, tipY);
  ctx.bezierCurveTo(tipX + hw * 0.5, tipY + height * 0.25,
                    x + hw * 0.8, baseY - height * 0.35, x + hw, baseY);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, baseY, 0, tipY);
  grad.addColorStop(0,    "rgba(80,  130, 240, 0.90)");
  grad.addColorStop(0.18, "rgba(255, 110,  20, 0.95)");
  grad.addColorStop(0.55, "rgba(255, 210,  40, 0.90)");
  grad.addColorStop(1,    "rgba(255, 255, 200, 0.00)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Bright inner core
  const core = ctx.createLinearGradient(0, baseY, 0, tipY);
  core.addColorStop(0,    "rgba(200, 220, 255, 0.55)");
  core.addColorStop(0.25, "rgba(255, 255, 200, 0.35)");
  core.addColorStop(1,    "rgba(255, 255, 200, 0.00)");
  const cw = hw * 0.35;
  ctx.beginPath();
  ctx.moveTo(x - cw, baseY);
  ctx.bezierCurveTo(x - cw * 0.7, baseY - height * 0.5,
                    tipX - cw * 0.3, tipY + height * 0.3, tipX, tipY);
  ctx.bezierCurveTo(tipX + cw * 0.3, tipY + height * 0.3,
                    x + cw * 0.7, baseY - height * 0.5, x + cw, baseY);
  ctx.closePath();
  ctx.fillStyle = core;
  ctx.fill();
}

// ---- Drawing — particles (inside tube) -------------------------------------

function drawParticles(t) {
  if (state.source === "tone") updateParticles(t);

  const light = state.lightMode;

  ctx.save();
  ctx.beginPath();
  ctx.rect(TX1, TCY - TIH / 2, TW, TIH);
  ctx.clip();

  for (let i = 0; i < NUM_PARTICLES; i++) {
    const dpx = state.source === "tone" ? state.px[i] : state.p0x[i];
    const dpy = state.p0y[i];
    if (dpx < TX1 || dpx > TX2) continue;

    const x = (state.p0x[i] - TX1) / TW;
    const pval = state.source === "tone"
      ? Math.abs(tonePattern(x))
      : state.flameProfile[Math.floor(x * NUM_HOLES)];

    let col;
    if (light) {
      const v = Math.round(pval * 180);
      col = `rgb(${180 - v},${80 + Math.round(pval * 40)},50)`;
    } else {
      col = `rgb(${Math.round(80 + pval * 175)},${Math.round(60 + pval * 100)},${Math.round(200 - pval * 160)})`;
    }

    ctx.beginPath();
    ctx.arc(dpx, dpy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.restore();
}

// ---- Drawing — pressure graph (drawn inside the tube body) -----------------

function drawPressureGraph(t) {
  const light   = state.lightMode;
  const isTone  = state.source === "tone";
  const omega   = 2 * Math.PI * state.toneFreq;
  const cosT    = isTone ? Math.cos(omega * t * VISUAL_SPEED) : 1;
  const scale   = isTone ? toneOverallScale() : 1;
  const AMP     = (TIH / 2 - 5) * scale;   // shrinks with Q and off-resonance
  const muted   = light ? "rgba(59,26,7,0.30)"  : "rgba(255,200,120,0.35)";
  const waveCol = light ? "#c2410c" : "#fb923c";

  const N = 400;

  // Pre-compute wave y-positions
  const waveY = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const p = isTone
      ? tonePattern(x) * cosT
      : state.flameProfile[Math.min(Math.floor(x * NUM_HOLES), NUM_HOLES - 1)];
    waveY[i] = TCY - p * AMP;
  }

  // Helper: draw the filled region between wave and centre line, clipped to a y-band
  function fillBand(y0, y1, col) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(TX1, y0, TW, y1 - y0);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(TX1, waveY[0]);
    for (let i = 1; i <= N; i++)
      ctx.lineTo(TX1 + (i / N) * TW, waveY[i]);
    ctx.lineTo(TX2, TCY);
    ctx.lineTo(TX1, TCY);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  }

  // Clip everything to tube interior
  ctx.save();
  ctx.beginPath();
  ctx.rect(TX1, TCY - TIH / 2, TW, TIH);
  ctx.clip();

  // Positive pressure (above centre line) — warm
  fillBand(TCY - TIH / 2, TCY + 1,
    light ? "rgba(194,65,12,0.28)" : "rgba(251,146,60,0.28)");

  // Negative pressure (below centre line) — cool
  fillBand(TCY - 1, TCY + TIH / 2,
    light ? "rgba(37,99,235,0.18)" : "rgba(96,165,250,0.22)");

  // Dashed zero (centre) line
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(TX1, TCY);
  ctx.lineTo(TX2, TCY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Node markers — only shown near a resonance, fading with overall scale
  if (isTone && scale > 0.15) {
    const nodeAlpha = Math.min((scale - 0.15) / 0.35, 1.0);
    ctx.strokeStyle = light
      ? `rgba(59,26,7,${(0.30 * nodeAlpha).toFixed(2)})`
      : `rgba(255,200,120,${(0.35 * nodeAlpha).toFixed(2)})`;
    ctx.lineWidth = 1.5;
    for (const xf of findNodes()) {
      const xc = TX1 + xf * TW;
      ctx.beginPath();
      ctx.moveTo(xc, TCY - TIH / 2 + 2);
      ctx.lineTo(xc, TCY + TIH / 2 - 2);
      ctx.stroke();
    }
  }

  // Animated wave stroke
  ctx.beginPath();
  ctx.moveTo(TX1, waveY[0]);
  for (let i = 1; i <= N; i++)
    ctx.lineTo(TX1 + (i / N) * TW, waveY[i]);
  ctx.strokeStyle = waveCol;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.restore(); // end tube clip

  // Node labels below the tube — same fade as markers
  if (isTone && scale > 0.15) {
    const nodeAlpha = Math.min((scale - 0.15) / 0.35, 1.0);
    ctx.font = "italic 10px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = light
      ? `rgba(59,26,7,${(0.45 * nodeAlpha).toFixed(2)})`
      : `rgba(255,200,120,${(0.45 * nodeAlpha).toFixed(2)})`;
    for (const xf of findNodes())
      ctx.fillText("node", TX1 + xf * TW, TCY + TOH / 2 + 30);
    ctx.textAlign = "left";
  }
}

// ---- Drawing — x-axis labels -----------------------------------------------

function drawAxisLabels() {
  const light = state.lightMode;
  const y = TCY + TOH / 2 + 16;
  ctx.font = "600 10px 'Trebuchet MS', sans-serif";
  ctx.fillStyle = light ? "rgba(59,26,7,0.50)" : "rgba(255,200,120,0.50)";
  ctx.textAlign = "center";

  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const x = TX1 + f * TW;
    ctx.fillText((f * state.tubeLength).toFixed(2) + " m", x, y);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, TCY + TOH / 2 + 2);
    ctx.lineTo(x, TCY + TOH / 2 + 7);
    ctx.stroke();
  });
  ctx.textAlign = "left";
}

// ---- Main draw -------------------------------------------------------------

function draw(t) {
  ctx.clearRect(0, 0, CW, CH);
  drawTube();
  drawFlames(t);    // always on
  if (state.view === "particles") {
    drawParticles(t);
  } else {
    drawPressureGraph(t);
  }
  drawAxisLabels();
}

// ---- Audio -----------------------------------------------------------------

function ensureAudioCtx() {
  if (!state.audioCtx) state.audioCtx = new AudioContext();
  if (state.audioCtx.state === "suspended") state.audioCtx.resume();
}

function stopCurrentSource() {
  if (state.oscNode) { try { state.oscNode.stop(); } catch (_) {} state.oscNode = null; }
  if (state.srcNode) { try { state.srcNode.disconnect(); } catch (_) {} state.srcNode = null; }
  if (state.stream)  { state.stream.getTracks().forEach(tr => tr.stop()); state.stream = null; }
  if (state.analyser) { try { state.analyser.disconnect(); } catch (_) {} state.analyser = null; }
  state.audioConnected = false;
}

function startToneOscillator() {
  ensureAudioCtx();
  const { audioCtx } = state;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.18;
  state.oscGain = gain;

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = state.toneFreq;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  state.oscNode = osc;
}

function stopToneOscillator() {
  if (state.oscNode) { try { state.oscNode.stop(); } catch (_) {} state.oscNode = null; }
  if (state.oscGain) { state.oscGain.disconnect(); state.oscGain = null; }
}

async function connectMic() {
  ensureAudioCtx();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.stream = stream;
    setupStreamAnalyser(stream);
    setAudioHint("Microphone connected.");
  } catch (e) {
    setAudioHint("Could not access microphone: " + e.message);
  }
}

async function connectSystem() {
  ensureAudioCtx();
  setAudioHint("Pick a tab/screen and tick “Share audio” in the dialog.");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach(tr => tr.stop());
    if (!stream.getAudioTracks().length) {
      setAudioHint("No audio captured — tick “Share audio” in the Chrome share dialog.");
      return;
    }
    state.stream = stream;
    setupStreamAnalyser(stream);
    setAudioHint("System audio connected.");
  } catch (e) {
    setAudioHint("Capture cancelled or not supported: " + e.message);
  }
}

function setupStreamAnalyser(stream) {
  const { audioCtx } = state;
  const src = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.75;
  src.connect(analyser);
  state.srcNode = src;
  state.analyser = analyser;
  state.audioConnected = true;
  state.smoothProfile.fill(0);
}

// ---- Sweep -----------------------------------------------------------------

let sweepRaf = null, sweepLastTs = 0, sweepF = 100;
const SWEEP_RATE = 7; // Hz per second

function doSweep(ts) {
  if (!state.sweeping) return;
  const dt = Math.min((ts - sweepLastTs) / 1000, 0.05);
  sweepLastTs = ts;
  sweepF += state.sweepDir * SWEEP_RATE * dt;
  if (sweepF >= 600) { sweepF = 600; state.sweepDir = -1; }
  if (sweepF <=  20) { sweepF =  20; state.sweepDir =  1; }
  setFreq(sweepF);   // setFreq rounds for display; sweepF stays a float
  sweepRaf = requestAnimationFrame(doSweep);
}

// ---- Animation loop --------------------------------------------------------

let rafId = null, lastTs = 0;

function tick(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  state.t += dt;

  if (state.source === "tone") {
    buildToneProfile();
  } else if (state.audioConnected) {
    buildAudioProfile();
  }

  draw(state.t);
  rafId = requestAnimationFrame(tick);
}

// ---- UI helpers ------------------------------------------------------------

function setFreq(f) {
  f = Math.max(20, Math.min(600, Math.round(f)));
  state.toneFreq = f;
  document.getElementById("slider-freq").value = f;
  document.getElementById("val-freq").value = f;
  if (state.oscNode)
    state.oscNode.frequency.setTargetAtTime(f, state.audioCtx.currentTime, 0.02);
  updateReadout();
  updateModeHint();
}

function setAudioHint(msg) {
  document.getElementById("hint-audio").textContent = msg;
}

function updateModeHint() {
  const fns = resonantFreqs();
  const shown = fns.slice(0, 4).map(f => Math.round(f)).join(", ");
  document.getElementById("hint-modes").textContent = "Resonances (Hz): " + shown + "…";
}

function updateReadout() {
  const fns = resonantFreqs();
  const shown = fns.slice(0, 3).map(f => Math.round(f)).join(", ");
  document.getElementById("r-drive").textContent =
    state.source === "tone" ? state.toneFreq + " Hz" : "Audio input";
  document.getElementById("r-dominant").textContent =
    state.source === "tone" ? "n = " + dominantMode() : "—";
  document.getElementById("r-modes").textContent = shown + "…";
}

function showSourceControls() {
  const isTone = state.source === "tone";
  document.getElementById("grp-tone").style.display  = isTone  ? "" : "none";
  document.getElementById("grp-audio").style.display = !isTone ? "" : "none";
  if (!isTone) {
    const hints = {
      mic:    "Grant microphone permission when prompted.",
      system: "Chrome/Edge only. Select a tab and tick “Share audio”."
    };
    setAudioHint(hints[state.source] || "");
  }
}

// ---- UI bindings -----------------------------------------------------------

function bindSeg(id, key, onChange) {
  document.getElementById(id).addEventListener("click", e => {
    const btn = e.target.closest("[data-" + key + "]");
    if (!btn) return;
    document.querySelectorAll("#" + id + " .seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state[key] = btn.dataset[key];
    onChange(state[key]);
  });
}

bindSeg("seg-view", "view", () => {});

bindSeg("seg-source", "source", () => {
  stopToneOscillator();
  stopCurrentSource();
  state.soundOn = false;
  document.getElementById("btn-sound").textContent = "▶ Sound on";
  document.getElementById("btn-sound").classList.remove("active");
  showSourceControls();
  updateReadout();
});

document.getElementById("slider-freq").addEventListener("input", e => {
  setFreq(+e.target.value);
});

document.getElementById("val-freq").addEventListener("input", e => {
  const f = +e.target.value;
  if (f >= 20 && f <= 600) setFreq(f);
});
document.getElementById("val-freq").addEventListener("change", e => {
  // Clamp and correct on blur/Enter if the typed value was out of range
  setFreq(+e.target.value);
});

document.getElementById("btn-sound").addEventListener("click", () => {
  state.soundOn = !state.soundOn;
  const btn = document.getElementById("btn-sound");
  if (state.soundOn) {
    startToneOscillator();
    btn.textContent = "■ Sound off";
    btn.classList.add("active");
  } else {
    stopToneOscillator();
    btn.textContent = "▶ Sound on";
    btn.classList.remove("active");
  }
});

document.getElementById("btn-sweep").addEventListener("click", () => {
  state.sweeping = !state.sweeping;
  const btn = document.getElementById("btn-sweep");
  btn.classList.toggle("active", state.sweeping);
  if (state.sweeping) {
    sweepLastTs = performance.now();
    sweepF = state.toneFreq;   // start from current slider position
    sweepRaf = requestAnimationFrame(doSweep);
  } else {
    cancelAnimationFrame(sweepRaf);
  }
});

document.getElementById("btn-connect").addEventListener("click", () => {
  stopCurrentSource();
  if (state.source === "mic") connectMic();
  else if (state.source === "system") connectSystem();
});

document.getElementById("slider-gain").addEventListener("input", e => {
  state.gainMult = +e.target.value;
  document.getElementById("val-gain").textContent = e.target.value;
});

document.getElementById("sel-gas").addEventListener("change", e => {
  state.gasCspeed = +e.target.value;
  updateReadout();
  updateModeHint();
});

document.getElementById("slider-L").addEventListener("input", e => {
  state.tubeLength = +e.target.value;
  document.getElementById("val-L").textContent = (+e.target.value).toFixed(2);
  updateReadout();
  updateModeHint();
});

document.getElementById("slider-Q").addEventListener("input", e => {
  state.Q = +e.target.value;
  document.getElementById("val-Q").textContent = e.target.value;
});

document.getElementById("btn-light").addEventListener("click", () => {
  state.lightMode = !state.lightMode;
  document.getElementById("btn-light").classList.toggle("active", state.lightMode);
  document.getElementById("canvas-wrap").classList.toggle("light", state.lightMode);
});

// ---- Init ------------------------------------------------------------------

initParticles();
initFlicker();
updateModeHint();
updateReadout();
showSourceControls();
rafId = requestAnimationFrame(tick);
