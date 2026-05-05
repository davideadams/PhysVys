/* ═══════════════════════════════════════════════════════════════
   AC Generator: a rectangular N-turn coil spinning in a uniform B field.

   Coordinate convention (world units = metres):
     B uniform along +X. Rotation axis along +Y (vertical, through the slip
     rings). At θ = 0 the coil lies in the YZ plane so its normal n̂ aligns
     with +X (parallel to B → max flux). Rotation is about +Y by angle θ:
        n̂(θ) = (cos θ, 0, sin θ)

   Physics:
     Φ_per_turn(t) = B · A · cos(ωt)
     Ψ(t)          = N · B · A · cos(ωt)              (flux linkage)
     ε(t)          = −dΨ/dt = N · B · A · ω · sin(ωt)
     Peak EMF:       ε₀ = N · B · A · ω
═══════════════════════════════════════════════════════════════ */

const SCOPE_WINDOW = 4.0;      // seconds visible on the oscilloscope

const state = {
  omega: 3.0,         // rad/s
  B: 0.40,            // tesla
  N: 40,              // turns
  w: 1.20,            // coil width along rotation axis (m)
  h: 1.30,            // coil height perpendicular to axis (m)
  theta: 0,           // current rotation angle (rad)
  running: true,
  // Effective ω = state.omega · runScale. runScale eases between 0 and 1
  // when the drive is paused/started so ε ramps smoothly to/from zero
  // instead of stepping (mirrors the magnet-flip ease in Faraday/Lenz).
  runScale: 1,
  ramp: { active: false, from: 1, to: 1, t0: 0, dur: 0.4 },
  showField: true,
  showNormal: true,
  showPhi: false,
  tNow: 0,
  emfBuf: [],         // [{t, v}]
  phiBuf: [],
};

function area()    { return state.w * state.h; }
function effOmega(){ return state.omega * state.runScale; }
function fluxLink(){ return state.N * state.B * area() * Math.cos(state.theta); }
function emf()     { return state.N * state.B * area() * effOmega() * Math.sin(state.theta); }
// Peak ε₀ reflects the *commanded* ω (slider), not the ramp — it answers
// "what would the peak be once the rotor is fully up to speed".
function emfPeak() { return state.N * state.B * area() * state.omega; }

function easeInOut(t) { return t * t * (3 - 2 * t); }
function startRamp(target) {
  if (state.ramp.active && state.ramp.to === target) return;
  state.ramp.from = state.runScale;
  state.ramp.to   = target;
  state.ramp.t0   = state.tNow;
  state.ramp.active = true;
}
function tickRamp() {
  if (!state.ramp.active) return;
  const tau = (state.tNow - state.ramp.t0) / state.ramp.dur;
  if (tau >= 1) {
    state.runScale = state.ramp.to;
    state.ramp.active = false;
    return;
  }
  state.runScale = state.ramp.from + (state.ramp.to - state.ramp.from) * easeInOut(tau);
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const perspCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const ORTHO_HALF = 1.9;
const orthoCam = new THREE.OrthographicCamera(
  -ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 100,
);
let camera = perspCam;
const camTarget = new THREE.Vector3(0, 0, 0);
const camState = { radius: 5.0, yaw: 0.85, pitch: 0.30, mode: 'persp' };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.65));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(5, 10, 0x9ab2cc, 0xcfddee);
gridHelper.position.y = -1.4;
scene.add(gridHelper);

/* ── B-field arrows: a horizontal grid pointing along +X ────────── */
const fieldGroup = new THREE.Group();
scene.add(fieldGroup);

const FIELD_SHAFT_LEN = 4.0;
function buildFieldArrows() {
  fieldGroup.clear();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2563eb, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.75,
  });
  const shaftGeo = new THREE.CylinderGeometry(0.012, 0.012, FIELD_SHAFT_LEN, 8);
  const headGeo  = new THREE.ConeGeometry(0.05, 0.16, 12);
  // Two horizontal sheets above and below the rotation plane keep arrows
  // out of the coil's spinning volume so they don't visually clip through.
  // Four rows symmetric about y=0 so the A⊥ arrow (at the rotor's centre)
  // stays in a clear horizontal band between the inner two rows.
  const ys = [-1.4, -0.5, +0.5, +1.4];
  const zs = [-1.4, -0.5, +0.5, +1.4];
  for (const y of ys) for (const z of zs) {
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.set(0, y, z);
    shaft.rotation.z = -Math.PI / 2; // axis along +X
    fieldGroup.add(shaft);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.set(FIELD_SHAFT_LEN / 2 + 0.08, y, z);
    head.rotation.z = -Math.PI / 2;
    fieldGroup.add(head);
  }
}
buildFieldArrows();

/* ── Slip-ring axle (fixed, along Y) ────────────────────────────── */
const axleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6, roughness: 0.35 });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.55, roughness: 0.4 });
const brushMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.2, roughness: 0.7 });

const axleGroup = new THREE.Group();
scene.add(axleGroup);

// One continuous shaft from below the floor up past the slip rings — the
// coil is mounted on it, so visually the axle should run straight through.
const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.6, 16), axleMat);
axle.position.y = 0;
axleGroup.add(axle);

const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 10, 32), ringMat);
ringA.rotation.x = Math.PI / 2;
ringA.position.y = 1.55;
axleGroup.add(ringA);
const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 10, 32), ringMat);
ringB.rotation.x = Math.PI / 2;
ringB.position.y = 1.05;
axleGroup.add(ringB);

const brushGeo = new THREE.BoxGeometry(0.05, 0.06, 0.06);
const brushA = new THREE.Mesh(brushGeo, brushMat);
brushA.position.set(0.13, 1.55, 0);
axleGroup.add(brushA);
const brushB = new THREE.Mesh(brushGeo, brushMat);
brushB.position.set(0.13, 1.05, 0);
axleGroup.add(brushB);

/* ── Rotor: rectangular coil in a Group rotated about +Y ─────────
   Local frame: rotation axis = local Y (= world Y always).
   At local θ=0, coil sits in the YZ plane → corners at (0, ±w/2, ±h/2).
   Stack a few visible turns along local +X (the loop normal) to read as
   "multi-turn" without rendering hundreds of wires. */
const rotor = new THREE.Group();
scene.add(rotor);

const wireMat = new THREE.MeshStandardMaterial({ color: 0xc2410c, metalness: 0.45, roughness: 0.4 });
const TUBE_R = 0.012;
let lastCoilKey = '';

function buildCoil() {
  const key = `${state.N}|${state.w}|${state.h}`;
  if (key === lastCoilKey) return;
  lastCoilKey = key;
  rotor.clear();

  const visN = Math.min(state.N, 10);
  const stackSpan = Math.min(0.06 * Math.log2(state.N + 1), 0.18);

  // One rectangular loop = 4 cylinders. Build a reusable helper.
  const horizGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, state.w, 10);
  const vertGeo  = new THREE.CylinderGeometry(TUBE_R, TUBE_R, state.h, 10);
  const cornerGeo = new THREE.SphereGeometry(TUBE_R * 1.2, 10, 8);

  for (let i = 0; i < visN; i++) {
    const t = visN === 1 ? 0 : (i / (visN - 1) - 0.5);
    const xOff = t * stackSpan;
    const loop = new THREE.Group();

    // Long edges run along the rotation axis Y at z = ±h/2 (length = w).
    // Default cylinder axis is already Y — no rotation needed.
    const topRail = new THREE.Mesh(horizGeo, wireMat);
    topRail.position.set(xOff, 0, +state.h / 2);
    loop.add(topRail);
    const botRail = new THREE.Mesh(horizGeo, wireMat);
    botRail.position.set(xOff, 0, -state.h / 2);
    loop.add(botRail);

    // Side edges (along Z at y = ±w/2). Default cylinder axis = Y, so rotate
    // about X by 90° to point along Z.
    const sideA = new THREE.Mesh(vertGeo, wireMat);
    sideA.position.set(xOff, +state.w / 2, 0);
    sideA.rotation.x = Math.PI / 2;
    loop.add(sideA);
    const sideB = new THREE.Mesh(vertGeo, wireMat);
    sideB.position.set(xOff, -state.w / 2, 0);
    sideB.rotation.x = Math.PI / 2;
    loop.add(sideB);

    for (const sy of [+1, -1]) for (const sz of [+1, -1]) {
      const c = new THREE.Mesh(cornerGeo, wireMat);
      c.position.set(xOff, sy * state.w / 2, sz * state.h / 2);
      loop.add(c);
    }
    rotor.add(loop);
  }

  // Two leads bridge the top of the coil to the slip rings. They spin with
  // the rotor; the slip rings let the wire rotate continuously while the
  // brushes stay fixed. Each lead = vertical riser from the coil's top edge
  // up to its slip ring's Y, plus a short horizontal stub into the ring.
  const SLIP_Y_A = 1.55;     // upper slip ring
  const SLIP_Y_B = 1.05;     // lower slip ring
  const STUB_Z   = 0.06;     // small ±Z offset so the two wires read separately

  function addLead(slipY, zOff) {
    const yTop = state.w / 2;       // coil's top edge sits at y = +w/2
    const riseLen = slipY - yTop;
    if (riseLen <= 0) return;
    const riser = new THREE.Mesh(
      new THREE.CylinderGeometry(TUBE_R * 0.85, TUBE_R * 0.85, riseLen, 8),
      wireMat,
    );
    riser.position.set(0, yTop + riseLen / 2, zOff);
    rotor.add(riser);
    const capBot = new THREE.Mesh(cornerGeo, wireMat);
    capBot.position.set(0, yTop, zOff);
    rotor.add(capBot);
    const capTop = new THREE.Mesh(cornerGeo, wireMat);
    capTop.position.set(0, slipY, zOff);
    rotor.add(capTop);
  }
  addLead(SLIP_Y_A, +STUB_Z);
  addLead(SLIP_Y_B, -STUB_Z);
}
buildCoil();

/* ── Area-vector arrow (rides on the rotor, points along local +X) ─ */
const normalGroup = new THREE.Group();
const normalMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.2, roughness: 0.4 });
const NORM_LEN = 0.7;
const normalShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.014, 0.014, NORM_LEN, 12), normalMat,
);
normalShaft.rotation.z = -Math.PI / 2; // axis → +X
normalShaft.position.x = NORM_LEN / 2;
normalGroup.add(normalShaft);
const normalHead = new THREE.Mesh(
  new THREE.ConeGeometry(0.05, 0.16, 14), normalMat,
);
normalHead.rotation.z = -Math.PI / 2;
normalHead.position.x = NORM_LEN + 0.08;
normalGroup.add(normalHead);
rotor.add(normalGroup);

// Sprite label "A⊥" floating off the tip of the normal vector.
function makeLabel(text, color, sub = '') {
  const px = 256;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  const mainFont = `italic bold 150px "Trebuchet MS","Gill Sans","Segoe UI",sans-serif`;
  const subFont  = `bold 80px "Trebuchet MS","Gill Sans","Segoe UI",sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = mainFont;
  const mainW = ctx.measureText(text).width;
  ctx.font = subFont;
  const subW = sub ? ctx.measureText(sub).width : 0;
  const startX = (px - (mainW + (sub ? subW + 6 : 0))) / 2;
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 18;
  for (let pass = 0; pass < 2; pass++) {
    ctx.font = mainFont; ctx.fillText(text, startX, px / 2 + 6);
    if (sub) { ctx.font = subFont; ctx.fillText(sub, startX + mainW + 6, px / 2 + 42); }
    ctx.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.55, 0.55, 1);
  sp.renderOrder = 10;
  return sp;
}
const normalLabel = makeLabel('A', '#7c3aed', '⊥');
normalLabel.position.x = NORM_LEN + 0.28;
rotor.add(normalLabel);

const labelB = makeLabel('B', '#1d4ed8');
labelB.position.set(FIELD_SHAFT_LEN / 2 + 0.4, 1.0, 0);
scene.add(labelB);

/* ═══════════════════════════════════════════════════════════════
   Camera orbit + zoom
═══════════════════════════════════════════════════════════════ */
function updateCamera() {
  const r = camState.radius, p = camState.pitch, y = camState.yaw;
  camera.position.set(
    r * Math.cos(p) * Math.sin(y),
    r * Math.sin(p),
    r * Math.cos(p) * Math.cos(y),
  );
  // Top view looks straight down +Y; the default camera "up" then aligns with
  // the view direction and the lookAt becomes ill-defined. Pick −Z as up: with
  // view = −Y, that gives screen-right = view × up = +X, so B (along +X)
  // reads left-to-right in both Top and Side presets.
  if (camState.mode === 'ortho' && Math.abs(camState.pitch) > Math.PI / 2 - 0.01) {
    camera.up.set(0, 0, -1);
  } else {
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(camTarget);
}
updateCamera();

const drag = { active: false, lx: 0, ly: 0 };
root.style.cursor = 'grab';
root.addEventListener('pointerdown', e => {
  drag.active = true; drag.lx = e.clientX; drag.ly = e.clientY;
  root.setPointerCapture(e.pointerId);
  root.style.cursor = 'grabbing';
});
root.addEventListener('pointermove', e => {
  if (!drag.active) return;
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
  drag.lx = e.clientX; drag.ly = e.clientY;
  camState.yaw -= dx * 0.008;
  const LIM = Math.PI / 2 - 0.05;
  camState.pitch = Math.max(-LIM, Math.min(LIM, camState.pitch - dy * 0.006));
  updateCamera();
});
function endDrag(e) {
  if (drag.active && root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  drag.active = false;
  root.style.cursor = 'grab';
}
root.addEventListener('pointerup', endDrag);
root.addEventListener('pointerleave', endDrag);
root.addEventListener('wheel', e => {
  e.preventDefault();
  if (camState.mode === 'ortho') {
    // Zoom = shrink/grow the orthographic frustum half-extent.
    const factor = Math.exp(e.deltaY * 0.0015);
    orthoCam.zoom = Math.max(0.4, Math.min(4.0, (orthoCam.zoom || 1) / factor));
    orthoCam.updateProjectionMatrix();
  } else {
    camState.radius = Math.max(2.0, Math.min(14, camState.radius + e.deltaY * 0.005));
    updateCamera();
  }
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   Oscilloscope
═══════════════════════════════════════════════════════════════ */
const scopeCanvas = document.getElementById('scope');
const scopeCtx = scopeCanvas.getContext('2d');

function formatY(v) {
  const a = Math.abs(v);
  if (a >= 1)    return v.toFixed(2);
  if (a >= 1e-3) return (v * 1e3).toFixed(1) + 'm';
  if (a >= 1e-6) return (v * 1e6).toFixed(1) + 'µ';
  return v.toExponential(1);
}

function drawScope(eNow, phiNow) {
  const W = scopeCanvas.width, H = scopeCanvas.height;
  const padL = 36, padR = 8, padT = 8, padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  scopeCtx.clearRect(0, 0, W, H);

  // CRT-ish dark background.
  scopeCtx.fillStyle = '#0b1f33';
  scopeCtx.fillRect(padL, padT, plotW, plotH);

  // Grid.
  scopeCtx.strokeStyle = 'rgba(34,197,94,0.18)';
  scopeCtx.lineWidth = 1;
  scopeCtx.beginPath();
  for (let i = 1; i < 8; i++) {
    const x = padL + (i / 8) * plotW;
    scopeCtx.moveTo(x, padT); scopeCtx.lineTo(x, padT + plotH);
  }
  for (let i = 1; i < 4; i++) {
    const y = padT + (i / 4) * plotH;
    scopeCtx.moveTo(padL, y); scopeCtx.lineTo(padL + plotW, y);
  }
  scopeCtx.stroke();

  // Y range: lock to ±ε₀ so amplitude changes are visually meaningful.
  const peak = Math.max(emfPeak(), 1e-9);
  const yMax = peak * 1.15;
  const yMin = -yMax;

  // Zero line.
  scopeCtx.strokeStyle = 'rgba(34,197,94,0.45)';
  scopeCtx.lineWidth = 1.2;
  const yZero = padT + plotH * (1 - (0 - yMin) / (yMax - yMin));
  scopeCtx.beginPath();
  scopeCtx.moveTo(padL, yZero); scopeCtx.lineTo(padL + plotW, yZero);
  scopeCtx.stroke();

  // Axis labels.
  scopeCtx.fillStyle = 'rgba(190,225,210,0.85)';
  scopeCtx.font = '9px "Trebuchet MS", sans-serif';
  scopeCtx.textAlign = 'right'; scopeCtx.textBaseline = 'middle';
  scopeCtx.fillText('+ε₀',  padL - 3, padT + 4);
  scopeCtx.fillText('0',    padL - 3, yZero);
  scopeCtx.fillText('−ε₀',  padL - 3, padT + plotH - 4);
  scopeCtx.textAlign = 'left'; scopeCtx.textBaseline = 'top';
  scopeCtx.fillText(formatY(yMax) + ' V', padL + 3, padT + 2);
  scopeCtx.textAlign = 'center';
  scopeCtx.fillText('−' + SCOPE_WINDOW.toFixed(0) + ' s', padL,         padT + plotH + 2);
  scopeCtx.fillText('now',                                  padL + plotW, padT + plotH + 2);

  function tracePoly(buf, scale, color, lw) {
    if (buf.length < 2) return;
    scopeCtx.strokeStyle = color;
    scopeCtx.lineWidth = lw;
    scopeCtx.beginPath();
    let first = true;
    for (const p of buf) {
      const tFrac = (p.t - (state.tNow - SCOPE_WINDOW)) / SCOPE_WINDOW;
      if (tFrac < 0 || tFrac > 1) continue;
      const v = p.v * scale;
      const x = padL + plotW * tFrac;
      const y = padT + plotH * (1 - (v - yMin) / (yMax - yMin));
      if (first) { scopeCtx.moveTo(x, y); first = false; } else { scopeCtx.lineTo(x, y); }
    }
    scopeCtx.stroke();
  }

  // Φ overlay (rescaled to fit the same window): NΦ has peak NBA, ε has peak
  // NBAω, so multiply Φ by ω to overlay them at matched amplitude.
  if (state.showPhi) {
    tracePoly(state.phiBuf, state.omega, 'rgba(13,148,136,0.85)', 1.4);
  }
  // EMF on top.
  tracePoly(state.emfBuf, 1, '#fde047', 2.0);

  // "Now" cursor + value bubble.
  const xNow = padL + plotW;
  scopeCtx.strokeStyle = 'rgba(253,224,71,0.55)';
  scopeCtx.lineWidth = 1;
  scopeCtx.beginPath();
  scopeCtx.moveTo(xNow, padT); scopeCtx.lineTo(xNow, padT + plotH);
  scopeCtx.stroke();

  const yNow = padT + plotH * (1 - (eNow - yMin) / (yMax - yMin));
  scopeCtx.fillStyle = '#fde047';
  scopeCtx.beginPath();
  scopeCtx.arc(xNow, yNow, 3, 0, Math.PI * 2);
  scopeCtx.fill();
}

/* ═══════════════════════════════════════════════════════════════
   Readouts
═══════════════════════════════════════════════════════════════ */
// Pick a unit *prefix* from a stable reference magnitude (the peak), then
// format any value in that same prefix. Picking the unit from the live value
// makes the readout flip between "999.0 µV" and "1.00 mV" near sign changes
// — same magnitude, but the prefix flicker reads as a glitch. Locking to the
// peak avoids that without losing precision at peak.
function pickPrefix(refMag) {
  if (refMag < 1e-3) return { scale: 1e6, suffix: ' µ', digits: 1 };
  if (refMag < 1)    return { scale: 1e3, suffix: ' m', digits: 2 };
  return                    { scale: 1,   suffix: ' ',  digits: 3 };
}
function fmtIn(v, prefix, unit) {
  return (v * prefix.scale).toFixed(prefix.digits) + prefix.suffix + unit;
}

function updateReadout(eNow, psiNow) {
  document.getElementById('rd-area').textContent = area().toFixed(3) + ' m²';
  const wtMod = ((state.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  document.getElementById('rd-wt').textContent  = (wtMod * 180 / Math.PI).toFixed(0) + '°';

  // Lock prefixes to the peaks so a sweep through zero doesn't flip units.
  const ePeak   = emfPeak();
  const phiPeak = state.N * state.B * area();
  const ePref   = pickPrefix(ePeak);
  const pPref   = pickPrefix(phiPeak);

  document.getElementById('rd-phi').textContent  = fmtIn(psiNow, pPref, 'Wb');
  document.getElementById('rd-emf').textContent  = fmtIn(eNow,   ePref, 'V');
  document.getElementById('rd-peak').textContent = fmtIn(ePeak,  ePref, 'V');
  document.getElementById('rd-freq').textContent = (state.omega / (2 * Math.PI)).toFixed(2) + ' Hz';
}

/* ═══════════════════════════════════════════════════════════════
   UI wiring
═══════════════════════════════════════════════════════════════ */
function wireSlider(id, valId, onChange, digits = 2) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.textContent = digits === 0 ? Math.round(v).toString() : v.toFixed(digits);
    onChange(v);
  });
}
wireSlider('slider-omega', 'val-omega', v => { state.omega = v; }, 1);
wireSlider('slider-B',     'val-B',     v => { state.B = v; }, 2);
wireSlider('slider-N',     'val-N',     v => { state.N = Math.round(v); buildCoil(); }, 0);
wireSlider('slider-w',     'val-w',     v => { state.w = v; buildCoil(); }, 2);
wireSlider('slider-h',     'val-h',     v => { state.h = v; buildCoil(); }, 2);

function wireToggle(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
  });
}
wireToggle('btn-field',  'showField');
wireToggle('btn-normal', 'showNormal');
wireToggle('btn-phi',    'showPhi');

// Preset camera views. Top looks straight down the rotation axis (Y) so the
// coil's instantaneous angle relative to B reads at a glance; Side looks
// along +Z so B sweeps left-to-right and the rotor spins like a clock face.
// Iso uses perspective (depth cue helps the 3D read); Top/Side switch to an
// orthographic camera so distances along the loop don't get foreshortened.
const CAM_PRESETS = {
  iso:  { radius: 5.0, yaw: 0.85, pitch: 0.30,                  mode: 'persp' },
  top:  { radius: 5.0, yaw: 0.00, pitch: Math.PI / 2 - 0.0001,  mode: 'ortho' },
  side: { radius: 5.0, yaw: 0.00, pitch: 0.00,                  mode: 'ortho' },
};
document.querySelectorAll('#seg-cam .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = CAM_PRESETS[btn.dataset.val];
    if (!p) return;
    setActive('#seg-cam', btn);
    camState.radius = p.radius;
    camState.yaw    = p.yaw;
    camState.pitch  = p.pitch;
    camState.mode   = p.mode;
    camera = camState.mode === 'ortho' ? orthoCam : perspCam;
    updateCamera();
    resize();
  });
});
function setActive(sel, btn) {
  document.querySelectorAll(`${sel} .seg-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.getElementById('btn-play').addEventListener('click', () => {
  state.running = !state.running;
  const btn = document.getElementById('btn-play');
  btn.classList.toggle('playing', state.running);
  btn.textContent = state.running ? '■ Pause' : '▶ Start';
  startRamp(state.running ? 1 : 0);
});
document.getElementById('btn-reset').addEventListener('click', () => {
  state.theta = 0;
  state.tNow = 0;
  state.emfBuf.length = 0;
  state.phiBuf.length = 0;
  state.runScale = state.running ? 1 : 0;
  state.ramp.active = false;
});

/* ═══════════════════════════════════════════════════════════════
   Render loop
═══════════════════════════════════════════════════════════════ */
function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  if (w < 2 || h < 2) return;
  const aspect = w / h;
  perspCam.aspect = aspect;
  perspCam.updateProjectionMatrix();
  // Keep the orthographic frame's vertical half-height fixed; widen with aspect.
  orthoCam.left   = -ORTHO_HALF * aspect;
  orthoCam.right  =  ORTHO_HALF * aspect;
  orthoCam.top    =  ORTHO_HALF;
  orthoCam.bottom = -ORTHO_HALF;
  orthoCam.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);

let lastT = performance.now();
function loop(tMs) {
  const dt = Math.min(0.05, Math.max(0.001, (tMs - lastT) / 1000));
  lastT = tMs;

  // Time and the scope keep running even when the drive is paused — that's
  // how we visualise "stopped rotor → ε = 0 while Φ stays put". The rotor's
  // angular advance is driven by the *effective* ω, which is zero once the
  // pause ramp finishes.
  state.tNow += dt;
  tickRamp();
  state.theta += effOmega() * dt;

  const eNow   = emf();
  const psiNow = fluxLink();

  state.emfBuf.push({ t: state.tNow, v: eNow });
  state.phiBuf.push({ t: state.tNow, v: psiNow });
  const cutoff = state.tNow - SCOPE_WINDOW - 0.2;
  while (state.emfBuf.length && state.emfBuf[0].t < cutoff) state.emfBuf.shift();
  while (state.phiBuf.length && state.phiBuf[0].t < cutoff) state.phiBuf.shift();

  // Sync 3D scene.
  rotor.rotation.y = state.theta;
  fieldGroup.visible  = state.showField;
  normalGroup.visible = state.showNormal;
  normalLabel.visible = state.showNormal;

  // Sync 2D widgets.
  drawScope(eNow, psiNow);
  updateReadout(eNow, psiNow);

  resize();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
