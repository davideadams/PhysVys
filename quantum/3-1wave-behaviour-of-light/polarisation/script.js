"use strict";

const canvas = document.getElementById("wave-canvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

const BEAM_Y = H / 2;
const SRC_X = 70;
const SRC_END_X = 0;
const DET_X = 890;
const POL_X = [260, 470, 680];
const POL_R = 72;       // vertical (true) radius
const POL_RX = 32;      // foreshortened horizontal radius (perspective)

const COLORS = {
  beamCore: "#ffe28a",
  beamGlow: "rgba(255, 226, 138, 0.35)",
  arrow: "#fff3c2",
  arrowUnpol: "#f5e4ff",
  disc: "rgba(180, 200, 220, 0.18)",
  discEdge: "rgba(180, 200, 220, 0.55)",
  axis: "#facc15",
  hatch: "rgba(250, 204, 21, 0.35)",
  source: "#fbbf24",
  detector: "#94a3b8",
  detectorOn: "#fde68a",
  text: "#cbd5e1",
  textBright: "#f8fafc",
  slotDot: ["#f59e0b", "#5b8def", "#ef4444"],
};

const DEFAULT_ANGLES = [0, 0, 0];

const state = {
  // polarisers[idx] holds add-order data (idx 0 = first filter ever shown, etc).
  // `count` is how many of them are currently in the beam (1..3).
  // Only the first `count` entries are rendered. The rest keep cached angles
  // until the user adds them.
  polarisers: DEFAULT_ANGLES.map((a) => ({ angle: a })),
  count: 1,
  playing: false,
  speed: 1.0,
  t: 0,
  showArrows: false,
  showAxes: true,
  showLabels: true,
  snap15: true,
  dragging: -1,
};

function applySnap(a) { return state.snap15 ? Math.round(a / 15) * 15 : Math.round(a); }

// Canvas slot position (0=left, 1=middle, 2=right) for filter add-order idx at given count.
function slotPosFor(idx, count) {
  if (count === 1) return 0;
  if (count === 2) return idx === 0 ? 0 : 2;
  return [0, 2, 1][idx]; // count === 3: 1st→left, 2nd→right, 3rd→middle
}

function posXFor(idx) { return POL_X[slotPosFor(idx, state.count)]; }

// Indices 0..count-1 sorted left-to-right along the beam.
function beamOrder() {
  return [...Array(state.count).keys()]
    .sort((a, b) => slotPosFor(a, state.count) - slotPosFor(b, state.count));
}

function toRad(deg) { return deg * Math.PI / 180; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Walk filters in beam order (left to right) to build per-region light state.
// Returns: segs[0..count] (one extra entry: the post-last region toward the detector),
// transFactors keyed by add-order index, and the beam-order array used.
function computeSegments() {
  const order = beamOrder();
  const segs = [];
  let cur = { polarised: false, angle: 0, intensity: 1.0 };
  const transFactors = [null, null, null];
  segs.push({ ...cur });
  for (const idx of order) {
    const p = state.polarisers[idx];
    if (!cur.polarised) {
      transFactors[idx] = 0.5;
      cur = { polarised: true, angle: p.angle, intensity: cur.intensity * 0.5 };
    } else {
      const d = toRad(p.angle - cur.angle);
      const t = Math.cos(d) ** 2;
      transFactors[idx] = t;
      cur = { polarised: true, angle: p.angle, intensity: cur.intensity * t };
    }
    segs.push({ ...cur });
  }
  return { segs, transFactors, order };
}

// Seeded random for stable unpolarised arrow angles per sample
function hashRand(i) {
  let x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const RAY_COUNT = 12;
const RAY_SPACING = 6;

// For each ray, build the list of [x0, x1] sub-segments to draw. A ray that survives a filter
// gets a gap across the filter's horizontal extent so the disc reads cleanly underneath.
function computeRays() {
  const N = RAY_COUNT;
  const yPositions = Array.from({ length: N }, (_, i) =>
    BEAM_Y - (N - 1) * RAY_SPACING / 2 + i * RAY_SPACING
  );
  const raySegments = Array.from({ length: N }, () => []);
  const curX = new Array(N).fill(SRC_END_X);
  const alive = new Array(N).fill(true);
  let survivors = [...Array(N).keys()];
  let cur = { polarised: false, angle: 0 };
  for (const idx of beamOrder()) {
    const p = state.polarisers[idx];
    let T;
    if (!cur.polarised) {
      T = 0.5;
      cur = { polarised: true, angle: p.angle };
    } else {
      T = Math.cos(toRad(p.angle - cur.angle)) ** 2;
      cur = { polarised: true, angle: p.angle };
    }
    const targetN = Math.round(survivors.length * T);
    const drop = survivors.length - targetN;
    const dropTop = Math.ceil(drop / 2);
    const dropBot = Math.floor(drop / 2);
    const kept = new Set(survivors.slice(dropTop, survivors.length - dropBot));
    const fx = posXFor(idx);
    const gapL = fx - POL_RX - 1;
    const gapR = fx + POL_RX + 1;
    for (const ri of survivors) {
      if (gapL > curX[ri]) raySegments[ri].push([curX[ri], gapL]);
      if (kept.has(ri)) {
        curX[ri] = gapR;
      } else {
        alive[ri] = false;
      }
    }
    survivors = [...kept];
  }
  for (let ri = 0; ri < N; ri++) {
    if (alive[ri] && DET_X > curX[ri]) raySegments[ri].push([curX[ri], DET_X]);
  }
  return { yPositions, raySegments, survivorCount: survivors.length };
}

function drawRays() {
  const { yPositions, raySegments } = computeRays();
  const haloA = state.showArrows ? 0.07 : 0.35;
  const coreA = state.showArrows ? 0.22 : 0.95;
  ctx.lineCap = "round";
  for (let i = 0; i < yPositions.length; i++) {
    const y = yPositions[i];
    for (const [x0, x1] of raySegments[i]) {
      ctx.strokeStyle = `rgba(255, 226, 138, ${haloA})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 248, 210, ${coreA})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }
}

function drawArrow(cx, cy, dx, dy, color, width) {
  if (Math.hypot(dx, dy) < 0.6) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - dx, cy - dy);
  ctx.lineTo(cx + dx, cy + dy);
  ctx.stroke();
  // arrowhead at the longer end (we draw both ends, so put small heads on both)
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const hLen = Math.min(6, len * 0.6);
  for (const sign of [1, -1]) {
    const tipX = cx + sign * dx;
    const tipY = cy + sign * dy;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - sign * ux * hLen - sign * uy * hLen * 0.55, tipY - sign * uy * hLen + sign * ux * hLen * 0.55);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - sign * ux * hLen + sign * uy * hLen * 0.55, tipY - sign * uy * hLen - sign * ux * hLen * 0.55);
    ctx.stroke();
  }
}

function drawSegmentArrowsClean(x0, x1, seg, t) {
  if (seg.intensity <= 0.001) return;
  const span = x1 - x0;
  const sampleCount = Math.max(6, Math.round(span / 24));
  const k = 2 * Math.PI / 50;
  const omega = 4.0;
  // Peak arrow length: full ray-band half-width at I = I₀, scaling as √I (since E ∝ √I).
  const ampMax = (RAY_COUNT - 1) * RAY_SPACING / 2;
  const amp = ampMax * Math.sqrt(seg.intensity);

  for (let i = 0; i < sampleCount; i++) {
    const x = x0 + (i + 0.5) * span / sampleCount;
    if (!seg.polarised) {
      const N = 5;
      for (let kk = 0; kk < N; kk++) {
        const idx = i * 100 + kk * 17 + Math.round(x0);
        const ang = hashRand(idx) * Math.PI;
        const phase = hashRand(idx + 5) * Math.PI * 2;
        const env = Math.cos(k * x - omega * t + phase);
        const a = amp * env;
        const dx = a * Math.sin(ang);
        const dy = -a * Math.cos(ang);
        drawArrow(x, BEAM_Y, dx, dy, COLORS.arrowUnpol, 1.2);
      }
    } else {
      const ang = toRad(seg.angle);
      const env = Math.cos(k * x - omega * t);
      const a = amp * env;
      const dx = a * Math.sin(ang);
      const dy = -a * Math.cos(ang);
      drawArrow(x, BEAM_Y, dx, dy, COLORS.arrow, 1.8);
    }
  }
}

function drawPolariser(i, cx) {
  const p = state.polarisers[i];
  const cy = BEAM_Y;
  const ry = POL_R;
  const rx = POL_RX;
  const k = rx / ry;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + 4, ry + 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.disc;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.discEdge;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy - ry - 14, 6, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.slotDot[i];
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = "600 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Filter ${i + 1}`, cx, cy - ry - 26);

  if (state.showAxes) {
    // Project a disc-local point (lx, ly) [in unscaled disc coords where the disc is a circle of radius ry]
    // onto the canvas, with horizontal foreshortening k.
    const ang = toRad(p.angle);
    const cA = Math.cos(ang), sA = Math.sin(ang);
    // Axis unit vector in disc-local: theta measured from +y(up) — but our canvas y is down,
    // so "up" in canvas is -y. We pick disc-local with y-up convention:
    //   axis_local = (sin(theta), cos(theta))  with y-up
    // After rotation, hatch lines run parallel to axis; hatch offset direction is the perpendicular:
    //   perp_local = (cos(theta), -sin(theta))
    // Project (lx, ly) -> canvas:  px = cx + lx * k,  py = cy - ly  (flip y since local is y-up)
    const proj = (lx, ly) => [cx + lx * k, cy - ly];

    // Hatching: parallel lines at perpendicular offsets d, running along the axis direction.
    ctx.strokeStyle = COLORS.hatch;
    ctx.lineWidth = 1.1;
    for (let d = -ry + 8; d <= ry - 8; d += 8) {
      const half = Math.sqrt(ry * ry - d * d) - 2;
      if (half <= 0) continue;
      // endpoints in disc-local (y-up): center_offset = d * perp_local; +/- half along axis_local
      const ox = d * cA, oy = d * (-sA);
      const dxAxis = half * sA, dyAxis = half * cA;
      const [x1, y1] = proj(ox - dxAxis, oy - dyAxis);
      const [x2, y2] = proj(ox + dxAxis, oy + dyAxis);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Transmission axis line (bright)
    const axHalf = ry - 4;
    const [ax1, ay1] = proj(-axHalf * sA, -axHalf * cA);
    const [ax2, ay2] = proj( axHalf * sA,  axHalf * cA);
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ax1, ay1);
    ctx.lineTo(ax2, ay2);
    ctx.stroke();

    // Arrowheads on both ends, in projected coords
    const adx = ax2 - ax1, ady = ay2 - ay1;
    const aL = Math.hypot(adx, ady) || 1;
    const ux = adx / aL, uy = ady / aL;
    const px = -uy, py = ux;
    const ah = 7;
    ctx.fillStyle = COLORS.axis;
    for (const [tx, ty, sign] of [[ax2, ay2, -1], [ax1, ay1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + sign * (ux * ah - px * ah * 0.55), ty + sign * (uy * ah - py * ah * 0.55));
      ctx.lineTo(tx + sign * (ux * ah + px * ah * 0.55), ty + sign * (uy * ah + py * ah * 0.55));
      ctx.closePath();
      ctx.fill();
    }
  }

  // Angle readout below disc
  ctx.fillStyle = COLORS.textBright;
  ctx.font = "600 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`θ = ${p.angle.toFixed(0)}°`, cx, cy + ry + 18);
}

function drawSource() {
  ctx.fillStyle = COLORS.text;
  ctx.font = "600 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Unpolarised", SRC_X - 50, BEAM_Y - 56);
  ctx.fillText("source · I₀", SRC_X - 50, BEAM_Y - 40);
}

function drawDetector(finalSeg) {
  const I = finalSeg.intensity;
  // Detector face (vertical bar)
  ctx.fillStyle = "rgba(148, 163, 184, 0.25)";
  ctx.fillRect(DET_X, BEAM_Y - 60, 18, 120);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(DET_X, BEAM_Y - 60, 18, 120);

  // Glowing dot proportional to intensity
  const glowR = 6 + 26 * Math.sqrt(Math.max(0, I));
  const grad = ctx.createRadialGradient(DET_X + 9, BEAM_Y, 0, DET_X + 9, BEAM_Y, glowR);
  grad.addColorStop(0, `rgba(253, 230, 138, ${0.2 + 0.7 * Math.sqrt(Math.max(0,I))})`);
  grad.addColorStop(1, "rgba(253, 230, 138, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(DET_X - glowR + 9, BEAM_Y - glowR, glowR * 2, glowR * 2);

  ctx.fillStyle = COLORS.textBright;
  ctx.font = "600 13px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Detector", DET_X + 9, BEAM_Y - 72);
  ctx.font = "700 14px 'Trebuchet MS', sans-serif";
  ctx.fillText(`I = ${I.toFixed(3)} I₀`, DET_X + 9, BEAM_Y + 86);
}

function drawIntensityLabels(segs, bounds) {
  if (!state.showLabels) return;
  ctx.fillStyle = "rgba(167, 139, 250, 0.95)";
  ctx.font = "600 12px 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < bounds.length - 1; i++) {
    const x = (bounds[i] + bounds[i + 1]) / 2;
    const I = segs[i].intensity;
    const label = i === 0 ? "I₀" : `${I.toFixed(3)} I₀`;
    ctx.fillText(label, x, BEAM_Y + 56);
    if (i > 0 && segs[i].polarised) {
      ctx.fillStyle = "rgba(167, 139, 250, 0.7)";
      ctx.font = "500 11px 'Trebuchet MS', sans-serif";
      ctx.fillText(`pol. ${segs[i].angle.toFixed(0)}°`, x, BEAM_Y + 72);
      ctx.fillStyle = "rgba(167, 139, 250, 0.95)";
      ctx.font = "600 12px 'Trebuchet MS', sans-serif";
    } else if (i > 0 && !segs[i].polarised) {
      ctx.fillStyle = "rgba(167, 139, 250, 0.7)";
      ctx.font = "500 11px 'Trebuchet MS', sans-serif";
      ctx.fillText(`unpolarised`, x, BEAM_Y + 72);
      ctx.fillStyle = "rgba(167, 139, 250, 0.95)";
      ctx.font = "600 12px 'Trebuchet MS', sans-serif";
    }
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);

  const { segs, transFactors, order } = computeSegments();
  // Bounds along the beam: source-end, then each filter's x in beam order, then detector.
  const filterXs = order.map(idx => posXFor(idx));
  const bounds = [SRC_END_X, ...filterXs, DET_X];

  drawRays();

  drawSource();

  if (state.showArrows) {
    for (let i = 0; i < bounds.length - 1; i++) {
      let x0 = bounds[i];
      let x1 = bounds[i + 1];
      if (i > 0) x0 += POL_RX + 4;
      if (i < bounds.length - 2) x1 -= POL_RX + 4;
      if (x1 > x0 + 6) drawSegmentArrowsClean(x0, x1, segs[i], state.t);
    }
  }

  for (const idx of order) drawPolariser(idx, posXFor(idx));

  drawIntensityLabels(segs, bounds);

  drawDetector(segs[segs.length - 1]);

  updateReadouts(segs, transFactors);
}

function updateReadouts(segs, transFactors) {
  const final = segs[segs.length - 1];
  document.getElementById("rd-iout").textContent = `${final.intensity.toFixed(3)}`;
  document.getElementById("rd-polax").textContent = final.polarised
    ? `${final.angle.toFixed(0)}°`
    : "unpolarised";

  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`slot-${i + 1}`);
    const valEl = slot.querySelector(".pol-angle-val");
    const cosVal = slot.querySelector(".pol-cos-val");
    const cosBar = slot.querySelector(".pol-cos-bar");
    valEl.value = state.polarisers[i].angle.toFixed(0);
    const T = transFactors[i];
    if (i >= state.count || T === null) {
      cosVal.textContent = "—";
      cosBar.style.width = "0%";
    } else {
      cosVal.textContent = T.toFixed(3);
      cosBar.style.width = `${(T * 100).toFixed(1)}%`;
    }
  }
}

function refreshSlotVisibility() {
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`slot-${i + 1}`);
    slot.style.display = (i < state.count) ? "" : "none";
  }
  document.getElementById("btn-add").style.display    = (state.count < 3) ? "" : "none";
  document.getElementById("btn-remove").style.display = (state.count > 1) ? "" : "none";
}

// --- Animation loop ---
let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (state.playing) state.t += dt * state.speed;
  render();
  requestAnimationFrame(frame);
}

// --- Input wiring ---
function wireSlot(i) {
  const slot = document.getElementById(`slot-${i + 1}`);
  const slider = slot.querySelector(".pol-angle");
  const valEl  = slot.querySelector(".pol-angle-val");
  slider.addEventListener("input", () => {
    const raw = parseFloat(slider.value);
    const snapped = applySnap(raw);
    state.polarisers[i].angle = snapped;
    if (snapped !== raw) slider.value = String(snapped);
    render();
  });
  valEl.addEventListener("change", () => {
    const raw = parseFloat(valEl.value);
    if (isNaN(raw)) { valEl.value = state.polarisers[i].angle.toFixed(0); return; }
    const clamped = Math.max(-90, Math.min(90, raw));
    const snapped = applySnap(clamped);
    state.polarisers[i].angle = snapped;
    slider.value = String(snapped);
    render();
  });
}
[0, 1, 2].forEach(wireSlot);

document.getElementById("btn-add").addEventListener("click", () => {
  if (state.count >= 3) return;
  state.count += 1;
  refreshSlotVisibility();
  render();
});

document.getElementById("btn-remove").addEventListener("click", () => {
  if (state.count <= 1) return;
  state.count -= 1;
  refreshSlotVisibility();
  render();
});

document.getElementById("btn-play").addEventListener("click", () => {
  state.playing = !state.playing;
  const b = document.getElementById("btn-play");
  b.textContent = state.playing ? "■ Pause" : "▶ Play";
  b.classList.toggle("playing", state.playing);
});

document.getElementById("btn-reset").addEventListener("click", () => {
  state.polarisers = DEFAULT_ANGLES.map((a) => ({ angle: a }));
  state.count = 1;
  state.t = 0;
  state.speed = 1.0;
  document.getElementById("slider-speed").value = "1.0";
  document.getElementById("val-speed").value = "1.00";
  for (let i = 0; i < 3; i++) {
    document.getElementById(`slot-${i + 1}`)
      .querySelector(".pol-angle").value = state.polarisers[i].angle;
  }
  refreshSlotVisibility();
  render();
});

document.getElementById("slider-speed").addEventListener("input", (e) => {
  state.speed = parseFloat(e.target.value);
  document.getElementById("val-speed").value = state.speed.toFixed(2);
});
document.getElementById("val-speed").addEventListener("change", (e) => {
  const raw = parseFloat(e.target.value);
  if (isNaN(raw)) { e.target.value = state.speed.toFixed(2); return; }
  const v = Math.max(0.1, Math.min(2.0, raw));
  state.speed = v;
  document.getElementById("slider-speed").value = v;
  e.target.value = v.toFixed(2);
});

document.getElementById("btn-arrows").addEventListener("click", () => {
  state.showArrows = !state.showArrows;
  document.getElementById("btn-arrows").classList.toggle("active", state.showArrows);
  render();
});

document.getElementById("btn-axes").addEventListener("click", () => {
  state.showAxes = !state.showAxes;
  document.getElementById("btn-axes").classList.toggle("active", state.showAxes);
  render();
});

document.getElementById("btn-labels").addEventListener("click", () => {
  state.showLabels = !state.showLabels;
  document.getElementById("btn-labels").classList.toggle("active", state.showLabels);
  render();
});

document.getElementById("btn-snap").addEventListener("click", () => {
  state.snap15 = !state.snap15;
  document.getElementById("btn-snap").classList.toggle("active", state.snap15);
  // Re-apply snap to current angles so the visible state matches the new rule
  if (state.snap15) {
    for (let i = 0; i < 3; i++) {
      state.polarisers[i].angle = applySnap(state.polarisers[i].angle);
      const slot = document.getElementById(`slot-${i + 1}`);
      slot.querySelector(".pol-angle").value = state.polarisers[i].angle;
    }
  }
  render();
});

// --- Canvas drag-to-rotate ---
function canvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (W / rect.width);
  const y = (evt.clientY - rect.top) * (H / rect.height);
  return { x, y };
}

function discIndexAt(x, y) {
  for (let i = 0; i < state.count; i++) {
    const cx = posXFor(i);
    const dx = (x - cx) / POL_RX;
    const dy = (y - BEAM_Y) / POL_R;
    if (dx * dx + dy * dy <= 1) return i;
  }
  return -1;
}

function angleFromCenter(i, x, y) {
  const cx = posXFor(i);
  const dx = (x - cx) / (POL_RX / POL_R);
  const dy = y - BEAM_Y;
  let a = Math.atan2(dx, -dy) * 180 / Math.PI;
  while (a > 90) a -= 180;
  while (a < -90) a += 180;
  return applySnap(a);
}

canvas.addEventListener("mousedown", (e) => {
  const { x, y } = canvasPos(e);
  const i = discIndexAt(x, y);
  if (i >= 0) {
    state.dragging = i;
    const a = angleFromCenter(i, x, y);
    state.polarisers[i].angle = Math.round(a);
    document.getElementById(`slot-${i + 1}`).querySelector(".pol-angle").value = state.polarisers[i].angle;
    render();
  }
});

canvas.addEventListener("mousemove", (e) => {
  const { x, y } = canvasPos(e);
  if (state.dragging >= 0) {
    const i = state.dragging;
    const a = angleFromCenter(i, x, y);
    state.polarisers[i].angle = Math.round(a);
    document.getElementById(`slot-${i + 1}`).querySelector(".pol-angle").value = state.polarisers[i].angle;
    render();
  } else {
    const i = discIndexAt(x, y);
    canvas.style.cursor = (i >= 0) ? "grab" : "crosshair";
  }
});

window.addEventListener("mouseup", () => {
  if (state.dragging >= 0) {
    state.dragging = -1;
  }
});

// Touch support
canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length === 0) return;
  const t = e.touches[0];
  const { x, y } = canvasPos(t);
  const i = discIndexAt(x, y);
  if (i >= 0) {
    state.dragging = i;
    const a = angleFromCenter(i, x, y);
    state.polarisers[i].angle = Math.round(a);
    document.getElementById(`slot-${i + 1}`).querySelector(".pol-angle").value = state.polarisers[i].angle;
    render();
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (state.dragging < 0 || e.touches.length === 0) return;
  const t = e.touches[0];
  const { x, y } = canvasPos(t);
  const i = state.dragging;
  const a = angleFromCenter(i, x, y);
  state.polarisers[i].angle = Math.round(a);
  document.getElementById(`slot-${i + 1}`).querySelector(".pol-angle").value = state.polarisers[i].angle;
  render();
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", () => { state.dragging = -1; });

// Kick off
refreshSlotVisibility();
render();
requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(frame); });
