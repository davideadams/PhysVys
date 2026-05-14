// Bremsstrahlung — single-atom view.
//
// One electron, one nucleus, one photon per encounter. Impact parameter b is
// sampled uniformly over a range that auto-scales with (E, Z), so the spread
// of deflections (and hence photon energies) stays readable as the user
// slides V or changes target. Each emitted photon flies down to a horizontal
// spectrometer strip and lights up the bin matching its energy.
//
// Physics (attractive Coulomb, electron on nucleus):
//   cot(|θ|/2) = 2 E_MeV |b_fm| / (k e² Z)     with k e² = 1.44 MeV·fm
//   sign(θ_screen) = -sign(b)                  electron pulled toward nucleus
//   E_γ = E_k · sin²(|θ|/2)                    0 (glancing) → E_k (head-on)
// E_k for an electron through tube voltage V is just eV; numerically with V in
// kV we get E_k in keV. So E_MeV = V_kV · 1e-3.
//
// The E_γ = E_k sin²(θ/2) rule isn't a derivation — it's a pedagogically clean
// single-encounter rule that gives the right qualitative shape (peaked at low
// E, sharp cutoff at E_max = eV) and ties trajectory tightly to photon energy.

const PHYS = {
  ke2: 1.44,            // MeV·fm
  z_proj: 1,            // electron projectile charge magnitude
};

const TARGETS = {
  W:  { Z: 74, label: 'Tungsten' },
  Mo: { Z: 42, label: 'Molybdenum' },
  Cu: { Z: 29, label: 'Copper' },
};

const V_MAX_keV = 160;  // strip max — fixed so cutoff position is meaningful

const canvas = document.getElementById('br-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// Layout: scene on top, spectrum strip along the bottom.
const APP = {
  sceneTop: 0,
  sceneBottom: 430,
  sourceX: 60,
  nucleusX: W * 0.52,
  beamHalfHeight: 80,         // px — visual spread of the beam
  stripTop: 470,
  stripBottom: 555,
  stripLeft: 70,
  stripRight: W - 30,
};
APP.sceneY = (APP.sceneTop + APP.sceneBottom) / 2;
APP.sourceY = APP.sceneY;
APP.nucleusY = APP.sceneY;
APP.stripWidth = APP.stripRight - APP.stripLeft;
APP.stripHeight = APP.stripBottom - APP.stripTop;

const NBINS = 240;

const state = {
  target: 'W',
  Z: 74,
  V_kV: 80,                // tube voltage
  rate: 6,
  playing: false,
  show: { trails: true, photons: true, cutoff: true, lambda: false },
  electrons: [],
  photons: [],
  spectrum: new Float32Array(NBINS),
  flash: new Float32Array(NBINS),
  spawnAccum: 0,
  fired: 0,
};

// ---------- physics ----------

function E_MeV() { return state.V_kV * 1e-3; }
function E_keV() { return state.V_kV; }

// Auto-scaled max impact parameter: 5 × b₉₀ so ~10% of events have θ > 90°.
// b₉₀ = k e² Z / (2 E_MeV)   [from cot(45°) = 1]
function bMaxFm() {
  return 5 * PHYS.ke2 * state.Z / (2 * E_MeV());
}

function deflectionAngle(b_fm) {
  // |θ|/2 = atan( k e² Z / (2 E |b|) )
  const denom = 2 * E_MeV() * Math.abs(b_fm);
  if (denom === 0) return Math.PI;     // head-on: θ = 180°
  const halfTheta = Math.atan2(PHYS.ke2 * state.Z, denom);
  // Attractive: sign opposite to b (electron pulled toward nucleus).
  return -Math.sign(b_fm || 1) * 2 * halfTheta;
}

function photonEnergy_keV(theta) {
  const s = Math.sin(Math.abs(theta) / 2);
  return E_keV() * s * s;
}

// ---------- electron / photon lifecycle ----------

const ORBIT_SAMPLES = 80;
const ELECTRON_FLIGHT_S = 3.6;   // ~0.5× the kinked version's pace
const PHOTON_FLIGHT_S = 1.0;
const FADE_S = 1.6;

function inScene(p) {
  return p.x >= 0 && p.x <= W &&
         p.y >= APP.sceneTop + 2 && p.y <= APP.sceneBottom - 4;
}

function intersectSceneEdge(outside, inside) {
  let lo = 0, hi = 1;
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    const x = outside.x + (inside.x - outside.x) * mid;
    const y = outside.y + (inside.y - outside.y) * mid;
    if (inScene({ x, y })) hi = mid; else lo = mid;
  }
  return {
    x: outside.x + (inside.x - outside.x) * hi,
    y: outside.y + (inside.y - outside.y) * hi,
  };
}

function clipToScene(pts) {
  let firstIn = -1, lastIn = -1;
  for (let i = 0; i < pts.length; i++) {
    if (inScene(pts[i])) {
      if (firstIn < 0) firstIn = i;
      lastIn = i;
    }
  }
  if (firstIn < 0) return null;
  const out = [];
  if (firstIn > 0) out.push(intersectSceneEdge(pts[firstIn - 1], pts[firstIn]));
  for (let i = firstIn; i <= lastIn; i++) out.push(pts[i]);
  if (lastIn < pts.length - 1) out.push(intersectSceneEdge(pts[lastIn + 1], pts[lastIn]));
  return out;
}

function resampleByArcLength(pts, N) {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return pts.slice(0, N);
  const out = new Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const target = (k / (N - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 0 ? (target - cum[j]) / segLen : 0;
    out[k] = {
      x: pts[j].x + (pts[j + 1].x - pts[j].x) * t,
      y: pts[j].y + (pts[j + 1].y - pts[j].y) * t,
    };
  }
  return { points: out, totalArcPx: total };
}

// Hyperbolic trajectory under attractive Coulomb. Focus at the nucleus,
// asymptotically incoming along +x (math frame). Returns the on-canvas
// arc resampled to equal-arc-length steps, plus the periapsis position.
function trajectoryPoints(b_fm) {
  const E = E_MeV();
  const alpha = PHYS.ke2 * state.Z;
  const a = alpha / (2 * E);
  const eps = Math.sqrt(1 + (b_fm * b_fm) / (a * a));
  const theta = deflectionAngle(b_fm);
  const vOutx = Math.cos(theta), vOuty = Math.sin(theta);

  // Periapsis direction p̂ = normalize(vIn - vOut).
  let px = 1 - vOutx;
  let py = 0 - vOuty;
  let pn = Math.hypot(px, py);
  if (pn < 1e-6) { px = 0; py = b_fm >= 0 ? 1 : -1; pn = 1; }
  px /= pn; py /= pn;

  const cosNu = -1 / eps;
  const sinNu = Math.sqrt(Math.max(0, eps * eps - 1)) / eps;
  let qx, qy;
  if (sinNu < 1e-6) { qx = -py; qy = px; }
  else {
    qx = (vOutx - cosNu * px) / sinNu;
    qy = (vOuty - cosNu * py) / sinNu;
    const qn = Math.hypot(qx, qy);
    if (qn > 0) { qx /= qn; qy /= qn; }
  }

  const B_MAX = bMaxFm();
  const pxPerFm = APP.beamHalfHeight / B_MAX;
  const nuMax = Math.acos(-1 / eps);
  const margin = 0.003;                      // small so the dense sample reaches well past the canvas
  const p_slr = a * (eps * eps - 1);

  const N_DENSE = 600;
  const dense = new Array(N_DENSE);
  for (let i = 0; i < N_DENSE; i++) {
    const u = i / (N_DENSE - 1);
    const nu = (-nuMax + margin) + u * 2 * (nuMax - margin);
    const r = p_slr / (1 + eps * Math.cos(nu));
    const cn = Math.cos(nu), sn = Math.sin(nu);
    const lx = r * (cn * px + sn * qx);
    const ly = r * (cn * py + sn * qy);
    dense[i] = {
      x: APP.nucleusX + lx * pxPerFm,
      y: APP.nucleusY - ly * pxPerFm,
    };
  }

  const r_p_fm = a * (eps - 1);
  const periapsisPos = {
    x: APP.nucleusX + r_p_fm * px * pxPerFm,
    y: APP.nucleusY - r_p_fm * py * pxPerFm,
  };

  const clipped = clipToScene(dense);
  let points, totalArcPx;
  if (!clipped || clipped.length < 2) {
    points = dense;
    totalArcPx = 0;
  } else {
    const res = resampleByArcLength(clipped, ORBIT_SAMPLES);
    points = res.points;
    totalArcPx = res.totalArcPx;
  }

  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i].x - periapsisPos.x) ** 2 + (points[i].y - periapsisPos.y) ** 2;
    if (d < bestD) { bestD = d; bestI = i; }
  }

  return { points, periapsisIdx: bestI, periapsisPos, totalArcPx };
}

function makeElectron() {
  const B_MAX = bMaxFm();
  let b = (Math.random() * 2 - 1) * B_MAX;
  if (Math.abs(b) < 0.005 * B_MAX) b = (b >= 0 ? 1 : -1) * 0.005 * B_MAX;
  const theta = deflectionAngle(b);
  const traj = trajectoryPoints(b);
  return {
    b, theta,
    E_gamma_keV: photonEnergy_keV(theta),
    points: traj.points,
    periapsisIdx: traj.periapsisIdx,
    periapsisPos: traj.periapsisPos,
    phase: 0,
    fade: 0,
    photonEmitted: false,
  };
}

function positionAt(electron, phase) {
  const last = electron.points.length - 1;
  const f = Math.max(0, Math.min(1, phase));
  const fi = f * last;
  const i0 = Math.min(last - 1, Math.floor(fi));
  const t = fi - i0;
  const p0 = electron.points[i0];
  const p1 = electron.points[i0 + 1];
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
}

function emitPhoton(e) {
  if (e.photonEmitted) return;
  e.photonEmitted = true;
  state.fired++;

  const Eg = e.E_gamma_keV;
  const frac = Math.max(0, Math.min(0.999, Eg / V_MAX_keV));
  const bin = Math.min(NBINS - 1, Math.floor(frac * NBINS));
  const binCx = APP.stripLeft + (bin + 0.5) / NBINS * APP.stripWidth;
  const target = { x: binCx, y: APP.stripTop + 6 };
  const start = e.periapsisPos;

  state.photons.push({
    start: { x: start.x, y: start.y },
    target,
    bin,
    E_keV: Eg,
    phase: 0,
  });
}

function tallyPhoton(p) {
  state.spectrum[p.bin] += 1;
  state.flash[p.bin] = 1;
}

// ---------- UI wiring ----------

const els = {
  selTarget: document.getElementById('sel-target'),
  sliderV: document.getElementById('slider-V'),
  valV: document.getElementById('val-V'),
  sliderRate: document.getElementById('slider-rate'),
  valRate: document.getElementById('val-rate'),
  btnPlay: document.getElementById('btn-play'),
  btnReset: document.getElementById('btn-reset'),
  btnFireOne: document.getElementById('btn-fire-one'),
  btnTrails: document.getElementById('btn-trails'),
  btnPhotons: document.getElementById('btn-photons'),
  btnCutoff: document.getElementById('btn-cutoff'),
  btnLambda: document.getElementById('btn-lambda'),
  rFired: document.getElementById('r-fired'),
  rV: document.getElementById('r-V'),
};

function setVecBtn(btn, on) { btn.classList.toggle('active', on); }

function resetRun() {
  state.electrons = [];
  state.photons = [];
  state.spectrum.fill(0);
  state.flash.fill(0);
  state.fired = 0;
  state.spawnAccum = 0;
}

els.selTarget.addEventListener('change', () => {
  state.target = els.selTarget.value;
  state.Z = TARGETS[state.target].Z;
  resetRun();
});
els.sliderV.addEventListener('input', () => {
  state.V_kV = parseInt(els.sliderV.value, 10);
  els.valV.value = String(state.V_kV);
  resetRun();
});
els.valV.addEventListener('change', () => {
  const raw = parseFloat(els.valV.value);
  if (isNaN(raw)) { els.valV.value = String(state.V_kV); return; }
  const v = Math.max(20, Math.min(150, Math.round(raw)));
  state.V_kV = v;
  els.sliderV.value = v;
  els.valV.value = String(v);
  resetRun();
});
els.sliderRate.addEventListener('input', () => {
  state.rate = parseInt(els.sliderRate.value, 10);
  els.valRate.value = String(state.rate);
});
els.valRate.addEventListener('change', () => {
  const raw = parseFloat(els.valRate.value);
  if (isNaN(raw)) { els.valRate.value = String(state.rate); return; }
  const v = Math.max(1, Math.min(60, Math.round(raw)));
  state.rate = v;
  els.sliderRate.value = v;
  els.valRate.value = String(v);
});
els.btnPlay.addEventListener('click', () => {
  state.playing = !state.playing;
  els.btnPlay.classList.toggle('playing', state.playing);
  els.btnPlay.textContent = state.playing ? '■ Pause' : '▶ Play';
});
els.btnReset.addEventListener('click', resetRun);
els.btnFireOne.addEventListener('click', () => state.electrons.push(makeElectron()));

for (const [btn, key] of [
  [els.btnTrails, 'trails'],
  [els.btnPhotons, 'photons'],
  [els.btnCutoff, 'cutoff'],
  [els.btnLambda, 'lambda'],
]) {
  btn.addEventListener('click', () => {
    state.show[key] = !state.show[key];
    setVecBtn(btn, state.show[key]);
  });
}
setVecBtn(els.btnTrails, state.show.trails);
setVecBtn(els.btnPhotons, state.show.photons);
setVecBtn(els.btnCutoff, state.show.cutoff);
setVecBtn(els.btnLambda, state.show.lambda);

// ---------- rendering ----------

function drawBackground() {
  ctx.fillStyle = '#06121f';
  ctx.fillRect(0, 0, W, H);
  // separator between scene and strip
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, APP.sceneBottom + 8);
  ctx.lineTo(W, APP.sceneBottom + 8);
  ctx.stroke();
}

function drawSource() {
  const sx = APP.sourceX, sy = APP.sourceY;
  // body
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.fillRect(sx - 34, sy - 90, 50, 180);
  // filament hint
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(sx - 22, sy - 12);
  ctx.quadraticCurveTo(sx - 12, sy, sx - 22, sy + 12);
  ctx.stroke();
  // accelerator tube (wide aperture so the spread of paths visibly emerges)
  ctx.fillStyle = 'rgba(71, 85, 105, 0.95)';
  ctx.fillRect(sx + 16, sy - APP.beamHalfHeight - 8, 12, 2 * (APP.beamHalfHeight + 8));
  ctx.fillStyle = '#0b1a2a';
  ctx.fillRect(sx + 18, sy - APP.beamHalfHeight, 8, 2 * APP.beamHalfHeight);
  // label
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('e⁻ gun', sx - 8, sy - 100);
  ctx.font = '500 10px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`V = ${state.V_kV} kV`, sx - 8, sy + 108);
}

function drawAtom() {
  const cx = APP.nucleusX, cy = APP.nucleusY;
  // electron cloud halo
  const cloudR = 60;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cloudR);
  g.addColorStop(0, 'rgba(148, 163, 184, 0.16)');
  g.addColorStop(1, 'rgba(148, 163, 184, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, cloudR, 0, 2 * Math.PI);
  ctx.fill();
  // nucleus dot with glow
  const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
  ng.addColorStop(0, 'rgba(250, 204, 21, 1)');
  ng.addColorStop(0.6, 'rgba(250, 204, 21, 0.55)');
  ng.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fcd34d';
  ctx.beginPath();
  ctx.arc(cx, cy, 3.2, 0, 2 * Math.PI);
  ctx.fill();
  // label below
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${TARGETS[state.target].label} atom`, cx, cy + cloudR + 14);
  ctx.font = '500 10px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`Z = ${state.Z}`, cx, cy + cloudR + 28);
}

function drawElectrons(dt) {
  for (const e of state.electrons) {
    if (e.phase < 1) {
      e.phase = Math.min(1, e.phase + dt / ELECTRON_FLIGHT_S);
      const last = e.points.length - 1;
      const periapsisPhase = e.periapsisIdx / last;
      if (!e.photonEmitted && e.phase >= periapsisPhase) emitPhoton(e);
      if (e.phase >= 1) e.fade = 0.0001;       // begin fade
    } else {
      e.fade += dt;
    }

    const last = e.points.length - 1;
    const fi = Math.max(0, Math.min(1, e.phase)) * last;
    const headIdx = Math.min(last, Math.floor(fi));
    const tFrac = fi - headIdx;

    if (state.show.trails) {
      const alpha = e.fade > 0 ? Math.max(0, 0.85 * (1 - e.fade / FADE_S)) : 0.85;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(e.points[0].x, e.points[0].y);
      const upTo = e.fade > 0 ? last : headIdx;
      for (let i = 1; i <= upTo; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
      if (e.fade === 0 && tFrac > 0 && headIdx < last) {
        const p0 = e.points[headIdx], p1 = e.points[headIdx + 1];
        ctx.lineTo(p0.x + (p1.x - p0.x) * tFrac, p0.y + (p1.y - p0.y) * tFrac);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (e.fade === 0) {
      const head = positionAt(e, e.phase);
      ctx.fillStyle = 'rgba(253, 224, 71, 1)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.6, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  state.electrons = state.electrons.filter(e => e.fade < FADE_S);
  if (state.electrons.length > 240) state.electrons.splice(0, state.electrons.length - 240);
}

function drawPhotons(dt) {
  for (const p of state.photons) {
    p.phase = Math.min(1, p.phase + dt / PHOTON_FLIGHT_S);
    if (p.phase >= 1 && !p.tallied) {
      p.tallied = true;
      tallyPhoton(p);
    }
  }

  if (state.show.photons) {
    for (const p of state.photons) {
      if (p.phase >= 1) continue;
      const u = p.phase;
      const x = p.start.x + (p.target.x - p.start.x) * u;
      const y = p.start.y + (p.target.y - p.start.y) * u;
      const dx = p.target.x - p.start.x;
      const dy = p.target.y - p.start.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const streak = 40;
      const tailX = x - ux * streak;
      const tailY = y - uy * streak;

      const f = Math.max(0, Math.min(1, p.E_keV / Math.max(20, state.V_kV)));
      const baseAlpha = 0.7 + 0.3 * f;
      const width = 2.4 + 2.6 * f;

      // soft halo at head
      ctx.fillStyle = `rgba(186, 230, 253, ${0.30 + 0.35 * f})`;
      ctx.beginPath();
      ctx.arc(x, y, 6 + 4 * f, 0, 2 * Math.PI);
      ctx.fill();

      // bright streak
      const grad = ctx.createLinearGradient(tailX, tailY, x, y);
      grad.addColorStop(0, `rgba(125, 211, 252, 0)`);
      grad.addColorStop(0.5, `rgba(186, 230, 253, ${baseAlpha * 0.55})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${baseAlpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  state.photons = state.photons.filter(p => !p.tallied);
}

function drawStrip() {
  const x0 = APP.stripLeft, x1 = APP.stripRight;
  const y0 = APP.stripTop, y1 = APP.stripBottom;
  const w = APP.stripWidth, h = APP.stripHeight;

  // backing
  ctx.fillStyle = 'rgba(15, 30, 40, 0.9)';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

  // inert region right of cutoff
  const cutoffFrac = state.V_kV / V_MAX_keV;
  const xCutoff = x0 + cutoffFrac * w;
  if (cutoffFrac < 1) {
    ctx.fillStyle = 'rgba(8, 14, 22, 0.7)';
    ctx.fillRect(xCutoff, y0, x1 - xCutoff, h);
    // diagonal hatching for "inaccessible"
    ctx.save();
    ctx.beginPath();
    ctx.rect(xCutoff, y0, x1 - xCutoff, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.08)';
    ctx.lineWidth = 1;
    for (let dx = -h; dx < (x1 - xCutoff) + h; dx += 8) {
      ctx.beginPath();
      ctx.moveTo(xCutoff + dx, y0);
      ctx.lineTo(xCutoff + dx + h, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // bin glow + flash
  let maxC = 1;
  for (let i = 0; i < NBINS; i++) if (state.spectrum[i] > maxC) maxC = state.spectrum[i];
  const logMax = Math.log10(1 + maxC);
  const binW = w / NBINS;

  for (let i = 0; i < NBINS; i++) {
    const c = state.spectrum[i];
    const f = state.flash[i];
    if (c === 0 && f < 0.02) continue;

    const bx = x0 + i * binW;

    if (c > 0) {
      const norm = Math.log10(1 + c) / Math.max(0.4, logMax);
      const greenG = Math.min(255, Math.round(190 * norm + 50));
      const blueG  = Math.min(255, Math.round(220 * norm + 35));
      const alpha  = Math.min(0.95, 0.22 + 0.75 * norm);
      ctx.fillStyle = `rgba(190, ${greenG}, ${blueG}, ${alpha})`;
      // bar grows from bottom upward
      const barH = (0.25 + 0.7 * norm) * h;
      ctx.fillRect(bx, y1 - barH, Math.max(1, binW), barH);
    }
    if (f > 0.02) {
      ctx.fillStyle = `rgba(254, 240, 138, ${0.7 * f})`;
      ctx.fillRect(bx - 1, y0 - 4 * f, Math.max(1, binW) + 2, h + 8 * f);
    }
  }

  // cutoff marker
  if (state.show.cutoff && cutoffFrac <= 1) {
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(xCutoff, y0 - 6);
    ctx.lineTo(xCutoff, y1 + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    // small label above
    ctx.fillStyle = 'rgba(244, 114, 182, 0.95)';
    ctx.font = '600 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`E_max = eV`, xCutoff, y0 - 10);
  }

  // ticks + axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tickStep = 20;
  for (let E = 0; E <= V_MAX_keV; E += tickStep) {
    const tx = x0 + (E / V_MAX_keV) * w;
    ctx.beginPath();
    ctx.moveTo(tx, y1);
    ctx.lineTo(tx, y1 + 4);
    ctx.stroke();
    let lbl;
    if (state.show.lambda) {
      if (E === 0) continue;
      const lamPm = 1240 / E;  // hc = 1240 eV·nm = 1240 pm·keV (close enough)
      lbl = lamPm >= 100 ? lamPm.toFixed(0) : lamPm.toFixed(1);
    } else {
      lbl = String(E);
    }
    ctx.fillText(lbl, tx, y1 + 6);
  }
  // axis caption
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(state.show.lambda ? 'photon wavelength λ (pm)' : 'photon energy E_γ (keV)', x0, y1 + 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('spectrometer', x1, y0 - 6);
}

function syncReadouts() {
  els.rFired.textContent = String(state.fired);
  els.rV.textContent = `${state.V_kV} kV`;
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
      state.electrons.push(makeElectron());
    }
  }

  // decay flashes
  const decay = Math.exp(-dt * 3.5);
  for (let i = 0; i < NBINS; i++) {
    if (state.flash[i] > 0) state.flash[i] *= decay;
  }

  drawBackground();
  drawStrip();
  drawAtom();
  drawSource();
  drawElectrons(dt);
  drawPhotons(dt);
  syncReadouts();

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
