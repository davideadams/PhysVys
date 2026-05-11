// Rutherford Scattering — apparatus view: foil with detector ring around it.
//
// Diagrammatic geometry on canvas (px). Scattering physics computed in fm/MeV:
//   - Rutherford: closed-form cot(|θ|/2) = 2 E |b| / (k Z z e²), sign(θ) = sign(b).
//   - Thomson:    σ ~ 0.5° Gaussian (multiple scattering through the foil column;
//                 the single-atom deflection at proper R is essentially zero).
// Coulomb constant: k e² = 1.44 MeV·fm.

const PHYS = {
  ke2: 1.44,
  z_alpha: 2,
  B_MAX_FM: 600,            // sampling range for impact parameter
  THOMSON_SIGMA_DEG: 0.5,   // Gaussian σ for accumulated Thomson deflection
};

const TARGETS = {
  Au: { Z: 79, label: 'Gold' },
  Ag: { Z: 47, label: 'Silver' },
  Cu: { Z: 29, label: 'Copper' },
  Al: { Z: 13, label: 'Aluminium' },
};

const canvas = document.getElementById('rs-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// Apparatus layout (canvas px)
const APP = {
  foilX: W * 0.55,
  foilY: H / 2,
  foilHalfHeight: 110,
  foilHalfWidth: 7,
  ringRadius: 230,
  sourceX: 50,
  sourceY: H / 2,
  beamHalfHeight: 16,        // beam spreads ±this y around source line (px)
  collimatorGap: 7.5,        // half-gap in the ring on the source side (deg) → 15° total
};

const SCREEN_CELLS = 720;    // 0.5° angular bins around the phosphor strip
const SCREEN_THICKNESS = 18; // px, ring outer - inner radius

const state = {
  model: 'thomson',
  target: 'Au',
  Z: 79,
  E_MeV: 5.0,
  rate: 12,
  playing: false,
  show: { trails: true, counts: true, axis: false },
  beam: [],
  screenCount: new Float32Array(SCREEN_CELLS),
  screenFlash: new Float32Array(SCREEN_CELLS),
  spawnAccum: 0,
  counters: { fired: 0, forward: 0, back90: 0, back150: 0 },
};

function clearScreen() {
  state.screenCount.fill(0);
  state.screenFlash.fill(0);
}

// ---------- physics ----------

function gaussianRandom() {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function computeScatterAngleRad(b) {
  if (state.model === 'rutherford') {
    const denom = PHYS.ke2 * state.Z * PHYS.z_alpha;
    if (denom <= 0) return 0;
    const cotHalf = 2 * state.E_MeV * Math.abs(b) / denom;
    const halfTheta = Math.atan2(1, cotHalf);   // |θ|/2
    return Math.sign(b || 1) * 2 * halfTheta;
  } else {
    return gaussianRandom() * (PHYS.THOMSON_SIGMA_DEG * Math.PI / 180);
  }
}

// ---------- alpha lifecycle ----------

function makeAlpha() {
  // Random beam y in pixels around source axis
  const yPx = APP.sourceY + (Math.random() * 2 - 1) * APP.beamHalfHeight;
  // Random impact parameter (signed, fm)
  const b = (Math.random() * 2 - 1) * PHYS.B_MAX_FM;
  const theta = computeScatterAngleRad(b);

  // Trajectory: source -> foil entry, then foil exit -> detector ring at angle θ.
  // Foil entry point uses incoming y. Foil exit point is at foil_x + 2*halfWidth (same y for simplicity).
  const entry = { x: APP.foilX - APP.foilHalfWidth, y: yPx };
  const exit = { x: APP.foilX + APP.foilHalfWidth, y: yPx };

  // Endpoint on detector ring around foil centre.
  // Outgoing direction in math convention: angle = θ from +x. Screen y is inverted.
  // Param: (x,y) = (foilX + t cosθ, foilY + (exit.y - foilY) - t sinθ_screen)
  // Use math angle θ_math, with screen sinθ = -sinθ_math.
  // Solve for t at which sqrt((x - foilX)^2 + (y - foilY)^2) = ringRadius.
  const dx = Math.cos(theta);
  const dy = -Math.sin(theta);            // screen y down → math sin flipped
  const ox = exit.x - APP.foilX;
  const oy = exit.y - APP.foilY;
  // |o + t d|² = R²  →  t² + 2(o·d)t + (|o|² - R²) = 0
  const a = 1;
  const bq = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - APP.ringRadius * APP.ringRadius;
  const disc = Math.max(0, bq * bq - 4 * a * c);
  const t = (-bq + Math.sqrt(disc)) / 2;
  const endpoint = { x: exit.x + dx * t, y: exit.y + dy * t };

  // Final angle at ring (atan2 in math convention)
  const endAngleRad = Math.atan2(-(endpoint.y - APP.foilY), endpoint.x - APP.foilX);
  let endAngleDeg = endAngleRad * 180 / Math.PI;
  if (endAngleDeg < 0) endAngleDeg += 360;

  const blockedByCollimator = angularDistanceDeg(endAngleDeg, 180) < APP.collimatorGap;

  return {
    entry, exit, endpoint,
    yPx, b, theta,
    endAngleDeg,
    blockedByCollimator,
    phase: 0,           // 0..1: source → foil → ring
    fade: 0,            // post-arrival fade
    arrived: false,
    counted: false,
  };
}

function angularDistanceDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function thetaDeg(a) {
  let t = Math.abs(a.theta) * 180 / Math.PI;
  if (t > 180) t = 360 - t;
  return t;
}

function tallyArrival(a) {
  if (a.counted) return;
  a.counted = true;
  state.counters.fired++;
  const td = thetaDeg(a);
  if (td < 20) state.counters.forward++;
  if (td > 90) state.counters.back90++;
  if (td > 150) state.counters.back150++;
  if (!a.blockedByCollimator) {
    let deg = a.endAngleDeg % 360;
    if (deg < 0) deg += 360;
    const cell = Math.min(SCREEN_CELLS - 1, Math.floor(deg / 360 * SCREEN_CELLS));
    state.screenCount[cell] += 1;
    state.screenFlash[cell] = 1;
  }
}

// ---------- UI wiring ----------

const els = {
  segModel: document.getElementById('seg-model'),
  selTarget: document.getElementById('sel-target'),
  sliderE: document.getElementById('slider-E'),
  valE: document.getElementById('val-E'),
  sliderRate: document.getElementById('slider-rate'),
  valRate: document.getElementById('val-rate'),
  btnPlay: document.getElementById('btn-play'),
  btnReset: document.getElementById('btn-reset'),
  btnFireOne: document.getElementById('btn-fire-one'),
  btnTrails: document.getElementById('btn-trails'),
  btnCounts: document.getElementById('btn-counts'),
  btnAxis: document.getElementById('btn-axis'),
  rFired: document.getElementById('r-fired'),
  rFwd: document.getElementById('r-fwd'),
  rBack90: document.getElementById('r-back90'),
  rBack150: document.getElementById('r-back150'),
};

function setSeg(group, key, value) {
  group.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset[key] === value);
  });
}
function setVecBtn(btn, on) { btn.classList.toggle('active', on); }

function resetRun() {
  state.beam = [];
  clearScreen();
  state.counters = { fired: 0, forward: 0, back90: 0, back150: 0 };
  state.spawnAccum = 0;
}

function invalidate() { resetRun(); }

els.segModel.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn'); if (!btn) return;
  state.model = btn.dataset.model;
  setSeg(els.segModel, 'model', state.model);
  invalidate();
});
els.selTarget.addEventListener('change', () => {
  state.target = els.selTarget.value;
  state.Z = TARGETS[state.target].Z;
  invalidate();
});
els.sliderE.addEventListener('input', () => {
  state.E_MeV = parseFloat(els.sliderE.value);
  els.valE.textContent = state.E_MeV.toFixed(1);
  invalidate();
});
els.sliderRate.addEventListener('input', () => {
  state.rate = parseInt(els.sliderRate.value, 10);
  els.valRate.textContent = String(state.rate);
});
els.btnPlay.addEventListener('click', () => {
  state.playing = !state.playing;
  els.btnPlay.classList.toggle('playing', state.playing);
  els.btnPlay.textContent = state.playing ? '■ Pause' : '▶ Play';
});
els.btnReset.addEventListener('click', resetRun);
els.btnFireOne.addEventListener('click', () => state.beam.push(makeAlpha()));

for (const [btn, key] of [
  [els.btnTrails, 'trails'],
  [els.btnCounts, 'counts'],
  [els.btnAxis, 'axis'],
]) {
  btn.addEventListener('click', () => {
    state.show[key] = !state.show[key];
    setVecBtn(btn, state.show[key]);
  });
}

setSeg(els.segModel, 'model', state.model);
setVecBtn(els.btnTrails, state.show.trails);
setVecBtn(els.btnCounts, state.show.counts);
setVecBtn(els.btnAxis, state.show.axis);

// ---------- rendering ----------

function detPos(angleDeg, r) {
  const rad = angleDeg * Math.PI / 180;
  return { x: APP.foilX + r * Math.cos(rad), y: APP.foilY - r * Math.sin(rad) };
}

function drawBackground() {
  ctx.fillStyle = '#06121f';
  ctx.fillRect(0, 0, W, H);

  // soft vignette around foil
  const g = ctx.createRadialGradient(APP.foilX, APP.foilY, 0, APP.foilX, APP.foilY, 300);
  g.addColorStop(0, 'rgba(125, 211, 252, 0.04)');
  g.addColorStop(1, 'rgba(125, 211, 252, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawScreen() {
  const rIn = APP.ringRadius;
  const rOut = APP.ringRadius + SCREEN_THICKNESS;
  const cx = APP.foilX, cy = APP.foilY;
  const gapHalf = APP.collimatorGap;       // degrees

  // 1) Backing strip (dark phosphor at rest)
  ctx.fillStyle = 'rgba(15, 30, 40, 0.85)';
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.25)';
  ctx.lineWidth = 1;
  // draw as two halves, splitting around the collimator gap
  const segs = [
    [180 + gapHalf, 360 + (180 - gapHalf)],   // long way around (the screen)
  ];
  for (const [d1, d2] of segs) {
    const a1 = -d1 * Math.PI / 180;
    const a2 = -d2 * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, a1, a2, true);
    ctx.arc(cx, cy, rIn, a2, a1, false);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 2) Accumulated count → persistent phosphor glow (log-scaled).
  //    3) Recent flash → bright spark on top.
  const dDeg = 360 / SCREEN_CELLS;
  // Build a max value for normalisation so a sparse Rutherford run still shows.
  let maxC = 1;
  for (let i = 0; i < SCREEN_CELLS; i++) if (state.screenCount[i] > maxC) maxC = state.screenCount[i];
  const logMax = Math.log10(1 + maxC);

  for (let i = 0; i < SCREEN_CELLS; i++) {
    const c = state.screenCount[i];
    const f = state.screenFlash[i];
    if (c === 0 && f < 0.02) continue;

    const dCentre = (i + 0.5) * dDeg;
    if (angularDistanceDeg(dCentre, 180) < gapHalf) continue;

    const d1 = i * dDeg;
    const d2 = (i + 1) * dDeg;
    const a1 = -d1 * Math.PI / 180;
    const a2 = -d2 * Math.PI / 180;

    // persistent glow
    if (c > 0) {
      const norm = Math.log10(1 + c) / Math.max(0.4, logMax);
      const greenG = Math.min(255, Math.round(190 * norm + 50));
      const blueG  = Math.min(255, Math.round(120 * norm + 30));
      const alpha  = Math.min(0.95, 0.20 + 0.75 * norm);
      ctx.fillStyle = `rgba(190, ${greenG}, ${blueG}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, a1, a2, true);
      ctx.arc(cx, cy, rIn, a2, a1, false);
      ctx.closePath();
      ctx.fill();
    }

    // recent flash (bright spark, fades fast)
    if (f > 0.02) {
      ctx.fillStyle = `rgba(254, 240, 138, ${0.85 * f})`;
      // flash extends slightly past the outer edge for a halo feel
      ctx.beginPath();
      ctx.arc(cx, cy, rOut + 4 * f, a1, a2, true);
      ctx.arc(cx, cy, rIn - 2 * f, a2, a1, false);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 4) Collimator walls at the gap edges
  for (const a of [180 - gapHalf, 180 + gapHalf]) {
    const p = detPos(a, rIn + SCREEN_THICKNESS / 2);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-(a * Math.PI / 180));
    ctx.fillRect(-3, -(SCREEN_THICKNESS / 2 + 4), 6, SCREEN_THICKNESS + 8);
    ctx.restore();
  }
  const slit = detPos(180, rOut + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('beam in', slit.x, slit.y);

  // 5) Angle labels (every 30°)
  if (state.show.counts) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 30) {
      if (angularDistanceDeg(deg, 180) < gapHalf + 8) continue;
      const lp = detPos(deg, rIn - 14);
      ctx.fillText(deg + '°', lp.x, lp.y);
    }
  }
}

function drawFoil() {
  const x0 = APP.foilX - APP.foilHalfWidth;
  const y0 = APP.foilY - APP.foilHalfHeight;
  const w = APP.foilHalfWidth * 2;
  const h = APP.foilHalfHeight * 2;
  // base gold strip
  const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  g.addColorStop(0, '#a76b1a');
  g.addColorStop(0.5, '#f4c772');
  g.addColorStop(1, '#a76b1a');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, h);

  // atom-lattice texture
  ctx.fillStyle = state.model === 'rutherford' ? 'rgba(20,16,4,0.95)' : 'rgba(244, 114, 182, 0.55)';
  const spacing = 9;
  for (let yy = y0 + 4; yy < y0 + h; yy += spacing) {
    for (let xx = x0 + 2; xx < x0 + w - 1; xx += spacing) {
      ctx.beginPath();
      if (state.model === 'rutherford') {
        ctx.arc(xx, yy, 0.9, 0, 2 * Math.PI);
      } else {
        ctx.arc(xx, yy, 2.3, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
  }
  // label
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(TARGETS[state.target].label + ' foil', APP.foilX, y0 - 8);
  ctx.font = '500 10px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  const sub = state.model === 'thomson'
    ? 'Thomson model: positive charge spread through each atom'
    : 'Rutherford model: positive charge in a tiny nucleus';
  ctx.fillText(sub, APP.foilX, y0 + h + 18);
}

function drawSource() {
  // body
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.fillRect(APP.sourceX - 30, APP.sourceY - 28, 50, 56);
  // collimator tube
  ctx.fillStyle = 'rgba(71, 85, 105, 0.95)';
  ctx.fillRect(APP.sourceX + 20, APP.sourceY - 4, 60, 8);
  // slit
  ctx.fillStyle = '#0b1a2a';
  ctx.fillRect(APP.sourceX + 18, APP.sourceY - 2, 4, 4);
  // label
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('α source', APP.sourceX - 5, APP.sourceY - 36);
}

function drawBeamAxis() {
  if (!state.show.axis) return;
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(APP.sourceX + 22, APP.sourceY);
  ctx.lineTo(APP.foilX + APP.foilHalfWidth, APP.foilY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAlphas(dt) {
  for (const a of state.beam) {
    if (!a.arrived) a.phase = Math.min(1, a.phase + dt / 1.4);   // 1.4 s total flight
    else a.fade += dt;

    // segments: source → entry → exit → endpoint (split into halves of phase)
    let x, y;
    const p = a.phase;
    if (p < 0.5) {
      const u = p / 0.5;
      x = APP.sourceX + 22 + (a.entry.x - (APP.sourceX + 22)) * u;
      y = APP.sourceY + (a.entry.y - APP.sourceY) * u;
    } else {
      const u = (p - 0.5) / 0.5;
      x = a.exit.x + (a.endpoint.x - a.exit.x) * u;
      y = a.exit.y + (a.endpoint.y - a.exit.y) * u;
    }

    if (!a.arrived && p >= 1) {
      a.arrived = true;
      tallyArrival(a);
    }

    // trail
    if (state.show.trails) {
      const alpha = a.arrived ? Math.max(0, 0.85 * (1 - a.fade / 1.8)) : 0.85;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      // pre-foil
      ctx.moveTo(APP.sourceX + 22, APP.sourceY);
      const preEnd = p < 0.5 ? { x, y } : a.entry;
      ctx.lineTo(preEnd.x, preEnd.y);
      // post-foil (only if past foil)
      if (p >= 0.5 || a.arrived) {
        const postStart = a.exit;
        const postEnd = a.arrived ? a.endpoint : { x, y };
        ctx.moveTo(postStart.x, postStart.y);
        ctx.lineTo(postEnd.x, postEnd.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // alpha dot
    if (!a.arrived) {
      ctx.fillStyle = 'rgba(253, 224, 71, 1)';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // cull
  state.beam = state.beam.filter(a => !a.arrived || a.fade < 2.0);
  if (state.beam.length > 240) state.beam.splice(0, state.beam.length - 240);
}

function drawLegend() {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  const lines = [
    `${TARGETS[state.target].label} (Z=${state.Z}), E_α = ${state.E_MeV.toFixed(1)} MeV`,
    `model: ${state.model === 'thomson' ? 'Thomson' : 'Rutherford'}`,
  ];
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 14, 18 + i * 14);
}

function syncReadouts() {
  const n = state.counters.fired;
  els.rFired.textContent = String(n);
  const pct = (k) => n ? (100 * k / n).toFixed(1) + '%' : '0.0%';
  els.rFwd.textContent = `${state.counters.forward} (${pct(state.counters.forward)})`;
  els.rBack90.textContent = `${state.counters.back90} (${pct(state.counters.back90)})`;
  els.rBack150.textContent = `${state.counters.back150} (${pct(state.counters.back150)})`;
}

// ---------- main loop ----------

let lastT = performance.now();
function tick(now) {
  const dtMs = Math.min(60, now - lastT);
  lastT = now;
  const dt = dtMs / 1000;

  // spawn
  if (state.playing) {
    state.spawnAccum += dt * state.rate;
    while (state.spawnAccum >= 1) {
      state.spawnAccum -= 1;
      state.beam.push(makeAlpha());
    }
  }

  // decay phosphor flashes
  const decay = Math.exp(-dt * 3.5);
  for (let i = 0; i < SCREEN_CELLS; i++) {
    if (state.screenFlash[i] > 0) state.screenFlash[i] *= decay;
  }

  // draw
  drawBackground();
  drawBeamAxis();
  drawScreen();
  drawFoil();
  drawSource();
  drawAlphas(dt);
  drawLegend();

  syncReadouts();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
