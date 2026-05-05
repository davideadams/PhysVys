/* ═══════════════════════════════════════════════════════════════
   Magnetic Flux Explorer.

   Coordinate convention (world units = metres):
     B is fixed along +Y (vertical up), shown as a grid of upward arrows.
     The loop lies in the X–Z plane at θ = 0 (its normal n̂ aligns with +Y),
     and is rotated about the X axis by θ. So:
        n̂(θ) = (0, cos θ, sin θ)
        Φ    = B · A · cos θ

     θ = 0   → loop perpendicular to B → Φ = +BA  (max positive)
     θ = 90  → loop parallel to B      → Φ = 0
     θ = 180 → flipped                 → Φ = -BA  (max negative)
═══════════════════════════════════════════════════════════════ */

const state = {
  shape: 'rect',     // 'rect' | 'circle'
  w: 1.20, h: 0.80,  // rectangle dimensions (m)
  r: 0.55,           // circle radius (m)
  B: 0.40,           // tesla
  theta: 35,         // degrees
  showField: true,
  showPatch: true,
  showNormal: true,
};

function thetaRad() { return state.theta * Math.PI / 180; }
function area() {
  return state.shape === 'rect' ? state.w * state.h : Math.PI * state.r * state.r;
}
function flux() { return state.B * area() * Math.cos(thetaRad()); }

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const perspCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const ORTHO_HALF = 3.2;
const orthoCam = new THREE.OrthographicCamera(
  -ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 200,
);
let camera = perspCam;
const camTarget = new THREE.Vector3(0, 0, 0);
const camState = { radius: 8, yaw: 0.9, pitch: 0.35, mode: 'persp' };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.65));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
dirLight.position.set(5, 7, 4);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(6, 6, 0x9ab2cc, 0xcfddee);
gridHelper.position.y = -2.2;
scene.add(gridHelper);

/* ── Dot/cross glyph textures (used when a vector points along view) ── */
function makeGlyphTexture(into, hexColor) {
  const px = 128;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(px / 2, px / 2, 50, 0, Math.PI * 2);
  ctx.stroke();
  if (into) {
    ctx.beginPath();
    ctx.moveTo(px / 2 - 26, px / 2 - 26); ctx.lineTo(px / 2 + 26, px / 2 + 26);
    ctx.moveTo(px / 2 + 26, px / 2 - 26); ctx.lineTo(px / 2 - 26, px / 2 + 26);
    ctx.stroke();
  } else {
    ctx.fillStyle = hexColor;
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}
const fieldGlyphTexIn  = makeGlyphTexture(true,  '#1d4ed8');
const fieldGlyphTexOut = makeGlyphTexture(false, '#1d4ed8');

/* ── B-field: vertical arrows + dot/cross glyphs on top/bottom view ── */
const fieldGroup = new THREE.Group();
scene.add(fieldGroup);
const fieldArrowsGroup = new THREE.Group();
const fieldGlyphsGroup = new THREE.Group();
fieldGroup.add(fieldArrowsGroup);
fieldGroup.add(fieldGlyphsGroup);

const FIELD_GRID = (() => {
  // 6×6 grid spanning ±1.75 m so the loop (max 2 m wide) sweeps through
  // a varying number of arrows as w, h, r or θ change.
  const xs = [], zs = [];
  for (let i = 0; i < 6; i++) {
    const v = -1.75 + i * 0.7;
    xs.push(v); zs.push(v);
  }
  return { xs, zs };
})();
const FIELD_SHAFT_LEN = 3.6;

function buildFieldArrows() {
  fieldArrowsGroup.clear();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2563eb, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.78,
  });
  const shaftGeo = new THREE.CylinderGeometry(0.014, 0.014, FIELD_SHAFT_LEN, 8);
  const headGeo  = new THREE.ConeGeometry(0.055, 0.18, 12);
  for (const x of FIELD_GRID.xs) {
    for (const z of FIELD_GRID.zs) {
      const shaft = new THREE.Mesh(shaftGeo, mat);
      shaft.position.set(x, 0, z);
      fieldArrowsGroup.add(shaft);
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(x, FIELD_SHAFT_LEN / 2 + 0.09, z);
      fieldArrowsGroup.add(head);
    }
  }
}
buildFieldArrows();

const fieldGlyphSprites = [];
function buildFieldGlyphs() {
  fieldGlyphsGroup.clear();
  fieldGlyphSprites.length = 0;
  for (const x of FIELD_GRID.xs) {
    for (const z of FIELD_GRID.zs) {
      const mat = new THREE.SpriteMaterial({ map: fieldGlyphTexIn, transparent: true, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(0.22, 0.22, 1);
      sp.position.set(x, 0, z);
      sp.renderOrder = 5;
      fieldGlyphsGroup.add(sp);
      fieldGlyphSprites.push(sp);
    }
  }
}
buildFieldGlyphs();
fieldGlyphsGroup.visible = false;

/* ── Label sprites ────────────────────────────────────────────── */
function makeLabel(text, color, italic = true, subscript = '') {
  const px = 256;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  const mainFont = `${italic ? 'italic ' : ''}bold 150px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif`;
  const subFont  = `bold 80px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = mainFont;
  const mainW = ctx.measureText(text).width;
  ctx.font = subFont;
  const subW = subscript ? ctx.measureText(subscript).width : 0;
  const totalW = mainW + (subscript ? subW + 6 : 0);
  const startX = (px - totalW) / 2;
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 18;
  // Two passes for a stronger halo.
  for (let pass = 0; pass < 2; pass++) {
    ctx.font = mainFont;
    ctx.fillText(text, startX, px / 2 + 6);
    if (subscript) {
      ctx.font = subFont;
      ctx.fillText(subscript, startX + mainW + 6, px / 2 + 42);
    }
    ctx.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.7, 0.7, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const labelGroup = new THREE.Group();
scene.add(labelGroup);

const labels = {
  B:     makeLabel('B',  '#1d4ed8'),
  n:     makeLabel('A',  '#7c3aed', true, '⊥'),
  theta: makeLabel('θ',  '#15304d'),
};
Object.values(labels).forEach((s) => labelGroup.add(s));

/* ── Loop group: rotates by θ about X axis ───────────────────── */
const loopGroup = new THREE.Group();
scene.add(loopGroup);

const loopFrameGroup = new THREE.Group();   // outline (rectangle or torus)
const fluxPatchGroup = new THREE.Group();   // shaded patch
const normalGroup    = new THREE.Group();   // n̂ arrow
loopGroup.add(loopFrameGroup);
loopGroup.add(fluxPatchGroup);
loopGroup.add(normalGroup);

const wireMat = new THREE.MeshStandardMaterial({
  color: 0xc2410c, metalness: 0.4, roughness: 0.45,
});

function buildRectFrame(w, h) {
  loopFrameGroup.clear();
  const tubeR = 0.035;
  const sides = [
    { len: w, pos: new THREE.Vector3(0,    0,  h/2), axis: 'x' },
    { len: w, pos: new THREE.Vector3(0,    0, -h/2), axis: 'x' },
    { len: h, pos: new THREE.Vector3( w/2, 0, 0),    axis: 'z' },
    { len: h, pos: new THREE.Vector3(-w/2, 0, 0),    axis: 'z' },
  ];
  for (const s of sides) {
    const geo = new THREE.CylinderGeometry(tubeR, tubeR, s.len, 14);
    const mesh = new THREE.Mesh(geo, wireMat);
    if (s.axis === 'x')      mesh.rotation.z = Math.PI / 2;
    else /* axis === 'z' */  mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(s.pos);
    loopFrameGroup.add(mesh);
  }
  // Corner spheres so the joins look continuous from any angle.
  const sphereGeo = new THREE.SphereGeometry(tubeR * 1.05, 12, 10);
  const corners = [
    [ w/2, 0,  h/2], [-w/2, 0,  h/2],
    [ w/2, 0, -h/2], [-w/2, 0, -h/2],
  ];
  for (const [x, y, z] of corners) {
    const m = new THREE.Mesh(sphereGeo, wireMat);
    m.position.set(x, y, z);
    loopFrameGroup.add(m);
  }
}

function buildCircleFrame(r) {
  loopFrameGroup.clear();
  const tubeR = 0.035;
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(r, tubeR, 12, 64),
    wireMat,
  );
  // Default torus is in X–Y plane; rotate to X–Z plane.
  torus.rotation.x = Math.PI / 2;
  loopFrameGroup.add(torus);
}

function buildFluxPatch() {
  fluxPatchGroup.clear();
  if (!state.showPatch) return;
  let geo;
  if (state.shape === 'rect') {
    geo = new THREE.PlaneGeometry(state.w, state.h);
  } else {
    geo = new THREE.CircleGeometry(state.r, 48);
  }
  const cosT = Math.cos(thetaRad());
  const positive = new THREE.Color(0x0d9488); // teal — +Φ
  const negative = new THREE.Color(0xea580c); // orange — −Φ
  const col = cosT >= 0 ? positive : negative;
  const opacity = 0.18 + 0.55 * Math.abs(cosT);
  const mat = new THREE.MeshBasicMaterial({
    color: col, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // PlaneGeometry / CircleGeometry sit in X–Y plane. Rotate so the patch
  // coincides with the loop in X–Z when θ = 0.
  mesh.rotation.x = -Math.PI / 2;
  fluxPatchGroup.add(mesh);
}

function buildNormalArrow() {
  normalGroup.clear();
  if (!state.showNormal) return;
  const len = 1.0;
  const mat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.2, roughness: 0.45 });
  // Cylinder along +Y by default (this is the loop's local normal).
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, len * 0.78, 14),
    mat,
  );
  shaft.position.y = len * 0.39;
  normalGroup.add(shaft);
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.28, 16),
    mat,
  );
  head.position.y = len * 0.78 + 0.14;
  normalGroup.add(head);
}

/* ── θ arc (drawn in the rotation plane: Y–Z, around the X axis) ── */
const thetaArcGroup = new THREE.Group();
scene.add(thetaArcGroup);

function buildThetaArc() {
  thetaArcGroup.clear();
  const t = thetaRad();
  if (t < 0.01 || t > 2 * Math.PI - 0.01) return;
  const r = 0.55;
  const segs = Math.max(8, Math.ceil(t / 0.08));
  const pts = [];
  // From +Y (n̂ at θ=0) sweeping toward (0, cos θ, sin θ). Rotation about +X
  // is positive in the standard right-hand sense, so the arc lives in Y–Z.
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * t;
    pts.push(new THREE.Vector3(0, r * Math.cos(a), r * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segs * 2, 0.018, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x15304d }),
  );
  thetaArcGroup.add(tube);
}

/* ── Updates ───────────────────────────────────────────────── */
function applyTilt() {
  loopGroup.rotation.x = thetaRad();
}

function updateLabels() {
  // B label: near the top of one of the field arrows.
  labels.B.position.set(2.0, FIELD_SHAFT_LEN / 2 + 0.55, 2.0);
  labels.B.visible = state.showField;

  // n̂ label: at the head of the normal arrow, in world coords (since the
  // normal rotates with the loop, transform a local point).
  if (state.showNormal) {
    const local = new THREE.Vector3(0, 1.18, 0);
    local.applyEuler(new THREE.Euler(thetaRad(), 0, 0));
    labels.n.position.copy(local);
    labels.n.visible = true;
  } else {
    labels.n.visible = false;
  }

  // θ label: at the angular bisector between +Y and n̂, slightly outside the arc.
  const t = thetaRad();
  const halfA = t / 2;
  const r = 0.85;
  labels.theta.position.set(0, r * Math.cos(halfA), r * Math.sin(halfA));
  labels.theta.visible = t > 0.05 && t < 2 * Math.PI - 0.05;
}

function updateRepresentation() {
  if (!camera) return;
  const view = camTarget.clone().sub(camera.position).normalize();
  // B is along +Y. View y-component close to ±1 means we're looking along B.
  const bDot = view.y;
  const fieldAxial = Math.abs(bDot) > 0.95;
  fieldArrowsGroup.visible = state.showField && !fieldAxial;
  fieldGlyphsGroup.visible = state.showField && fieldAxial;
  if (fieldAxial) {
    // bDot > 0 → view dir is +Y, B is +Y → B INTO screen (⊗).
    const tex = bDot > 0 ? fieldGlyphTexIn : fieldGlyphTexOut;
    fieldGlyphSprites.forEach((sp) => { sp.material.map = tex; sp.material.needsUpdate = true; });
  }
  updateLabels();
}

function updateReadout() {
  const A = area();
  const cosT = Math.cos(thetaRad());
  const phi = state.B * A * cosT;
  document.getElementById('rd-area').textContent = A.toFixed(3) + ' m²';
  document.getElementById('rd-cos').textContent  = cosT.toFixed(3);
  document.getElementById('rd-phi').textContent  = formatWb(phi);
}

function formatWb(phi) {
  const a = Math.abs(phi);
  if (a < 1e-4) return phi.toExponential(2) + ' Wb';
  if (a < 1)    return (phi * 1000).toFixed(1) + ' mWb';
  return phi.toFixed(3) + ' Wb';
}

function rebuildLoop() {
  if (state.shape === 'rect') buildRectFrame(state.w, state.h);
  else                        buildCircleFrame(state.r);
  buildFluxPatch();
  buildNormalArrow();
}

function rebuildScene() {
  rebuildLoop();
  buildThetaArc();
  applyTilt();
  fieldGroup.visible = state.showField;
  updateRepresentation();   // also calls updateLabels()
  updateReadout();
  drawPhiGraph();
}

/* ═══════════════════════════════════════════════════════════════
   Φ-vs-θ mini graph (2D canvas in the controls panel)
═══════════════════════════════════════════════════════════════ */
const phiCanvas = document.getElementById('phi-graph');
const phiCtx = phiCanvas.getContext('2d');

function drawPhiGraph() {
  const W = phiCanvas.width;
  const H = phiCanvas.height;
  const padL = 30, padR = 8, padT = 10, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  phiCtx.clearRect(0, 0, W, H);

  // Axes background.
  phiCtx.fillStyle = 'rgba(255,255,255,0.6)';
  phiCtx.fillRect(padL, padT, plotW, plotH);

  // Zero line and ±1 grid lines.
  phiCtx.strokeStyle = 'rgba(21,48,77,0.18)';
  phiCtx.lineWidth = 1;
  phiCtx.beginPath();
  for (const v of [-1, 0, 1]) {
    const y = padT + plotH * (1 - (v + 1) / 2);
    phiCtx.moveTo(padL, y); phiCtx.lineTo(padL + plotW, y);
  }
  // Quarter-turn markers.
  for (const a of [90, 180, 270]) {
    const x = padL + plotW * (a / 360);
    phiCtx.moveTo(x, padT); phiCtx.lineTo(x, padT + plotH);
  }
  phiCtx.stroke();

  // Axis labels.
  phiCtx.fillStyle = '#55708d';
  phiCtx.font = '10px "Trebuchet MS", sans-serif';
  phiCtx.textAlign = 'right';
  phiCtx.textBaseline = 'middle';
  phiCtx.fillText('+BA', padL - 4, padT);
  phiCtx.fillText('0',    padL - 4, padT + plotH / 2);
  phiCtx.fillText('−BA',  padL - 4, padT + plotH);
  phiCtx.textAlign = 'center';
  phiCtx.textBaseline = 'top';
  phiCtx.fillText('0°',   padL,             padT + plotH + 4);
  phiCtx.fillText('90°',  padL + plotW * 0.25, padT + plotH + 4);
  phiCtx.fillText('180°', padL + plotW * 0.5,  padT + plotH + 4);
  phiCtx.fillText('270°', padL + plotW * 0.75, padT + plotH + 4);
  phiCtx.fillText('360°', padL + plotW,        padT + plotH + 4);

  // Φ(θ) = BA cos θ, normalised to ±1.
  phiCtx.strokeStyle = '#0d9488';
  phiCtx.lineWidth = 2;
  phiCtx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const ang = (i / 120) * 2 * Math.PI;
    const v = Math.cos(ang);
    const x = padL + plotW * (i / 120);
    const y = padT + plotH * (1 - (v + 1) / 2);
    if (i === 0) phiCtx.moveTo(x, y); else phiCtx.lineTo(x, y);
  }
  phiCtx.stroke();

  // Current θ marker.
  const tDeg = state.theta;
  const x = padL + plotW * (tDeg / 360);
  const v = Math.cos(thetaRad());
  const y = padT + plotH * (1 - (v + 1) / 2);
  phiCtx.strokeStyle = 'rgba(21,48,77,0.4)';
  phiCtx.lineWidth = 1;
  phiCtx.beginPath();
  phiCtx.moveTo(x, padT); phiCtx.lineTo(x, padT + plotH);
  phiCtx.stroke();
  phiCtx.fillStyle = v >= 0 ? '#0d9488' : '#ea580c';
  phiCtx.beginPath();
  phiCtx.arc(x, y, 4, 0, Math.PI * 2);
  phiCtx.fill();
}

/* ═══════════════════════════════════════════════════════════════
   Camera orbit
═══════════════════════════════════════════════════════════════ */
function updateCamera() {
  const r = camState.radius;
  const p = camState.pitch;
  const y = camState.yaw;
  camera.position.set(
    r * Math.cos(p) * Math.sin(y),
    r * Math.sin(p),
    r * Math.cos(p) * Math.cos(y),
  );
  const horizCos = Math.cos(p);
  if (Math.abs(horizCos) < 0.15) {
    const blend = Math.abs(horizCos) / 0.15;
    const sgn   = Math.sign(p) || 1;
    const fbX   = -Math.sin(y) * sgn;
    const fbZ   = -Math.cos(y) * sgn;
    camera.up.set(fbX * (1 - blend), blend, fbZ * (1 - blend)).normalize();
  } else {
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(camTarget);
  if (typeof updateRepresentation === 'function') updateRepresentation();
}

function useCamera(mode) {
  camState.mode = mode;
  camera = mode === 'ortho' ? orthoCam : perspCam;
  updateCamera();
}
updateCamera();

const drag = { on: false, x: 0, y: 0 };
root.style.cursor = 'grab';

root.addEventListener('pointerdown', e => {
  drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
  root.setPointerCapture(e.pointerId);
  root.style.cursor = 'grabbing';
});
root.addEventListener('pointermove', e => {
  if (!drag.on) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  camState.yaw -= dx * 0.008;
  const LIM = Math.PI / 2;
  camState.pitch = Math.max(-LIM, Math.min(LIM, camState.pitch - dy * 0.006));
  if (camState.mode === 'ortho') useCamera('persp');
  document.querySelectorAll('#seg-cam .seg-btn').forEach(b => b.classList.remove('active'));
  updateCamera();
});
function endDrag(e) {
  if (drag.on && e.pointerId !== undefined && root.hasPointerCapture(e.pointerId)) {
    root.releasePointerCapture(e.pointerId);
  }
  drag.on = false;
  root.style.cursor = 'grab';
}
root.addEventListener('pointerup', endDrag);
root.addEventListener('pointerleave', endDrag);
root.addEventListener('wheel', e => {
  e.preventDefault();
  if (camState.mode === 'ortho') {
    orthoCam.zoom = Math.max(0.4, Math.min(4, orthoCam.zoom * (1 - e.deltaY * 0.001)));
    orthoCam.updateProjectionMatrix();
  } else {
    camState.radius = Math.max(3.5, Math.min(20, camState.radius + e.deltaY * 0.006));
    updateCamera();
  }
}, { passive: false });

function setCamPreset(preset) {
  if (preset === 'iso') {
    camState.yaw = 0.9; camState.pitch = 0.35; camState.radius = 8;
    useCamera('persp');
  }
  if (preset === 'top') {
    // Look down −Y so the X–Z plane is flat: B comes out of the page (⊙)
    // and the loop appears at full area only when θ = 0.
    camState.yaw = 0; camState.pitch = Math.PI / 2 - 0.001; camState.radius = 8;
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
  if (preset === 'front') {
    // Look along −Z: B goes straight up, loop face is visible at θ = 90°.
    camState.yaw = 0; camState.pitch = 0; camState.radius = 8;
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
  if (preset === 'side') {
    // Look along −X (down the rotation axis). The loop is seen edge-on, so
    // tilting θ sweeps it through  –  /  |  \  –  …
    camState.yaw = Math.PI / 2; camState.pitch = 0; camState.radius = 8;
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
}

/* ═══════════════════════════════════════════════════════════════
   UI wiring
═══════════════════════════════════════════════════════════════ */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('#seg-shape .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.shape = btn.dataset.val;
    setActive('#seg-shape', btn);
    document.getElementById('grp-rect').style.display   = state.shape === 'rect'   ? '' : 'none';
    document.getElementById('grp-circle').style.display = state.shape === 'circle' ? '' : 'none';
    rebuildScene();
  });
});

document.querySelectorAll('#seg-cam .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setCamPreset(btn.dataset.val);
    setActive('#seg-cam', btn);
  });
});

function wireSlider(id, valId, onChange, digits = 2) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.textContent = v.toFixed(digits);
    onChange(v);
  });
}
wireSlider('slider-width',  'val-width',  v => { state.w = v; rebuildScene(); }, 2);
wireSlider('slider-height', 'val-height', v => { state.h = v; rebuildScene(); }, 2);
wireSlider('slider-radius', 'val-radius', v => { state.r = v; rebuildScene(); }, 2);
wireSlider('slider-field',  'val-field',  v => { state.B = v; rebuildScene(); }, 2);
wireSlider('slider-theta',  'val-theta',  v => { state.theta = v; rebuildScene(); }, 0);

function toggleBtn(id, key, sideEffect) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (sideEffect) sideEffect();
  });
}
toggleBtn('btn-field',  'showField',  () => { fieldGroup.visible = state.showField; updateRepresentation(); });
toggleBtn('btn-patch',  'showPatch',  () => { buildFluxPatch(); });
toggleBtn('btn-normal', 'showNormal', () => { buildNormalArrow(); updateLabels(); });

/* ═══════════════════════════════════════════════════════════════
   Render loop + resize
═══════════════════════════════════════════════════════════════ */
function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  if (w < 2 || h < 2) return;
  const aspect = w / h;
  perspCam.aspect = aspect;
  perspCam.updateProjectionMatrix();
  orthoCam.left   = -ORTHO_HALF * aspect;
  orthoCam.right  =  ORTHO_HALF * aspect;
  orthoCam.top    =  ORTHO_HALF;
  orthoCam.bottom = -ORTHO_HALF;
  orthoCam.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);

function loop() {
  resize();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

rebuildScene();
requestAnimationFrame(loop);
