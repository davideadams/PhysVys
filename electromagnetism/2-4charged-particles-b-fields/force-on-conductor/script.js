/* ═══════════════════════════════════════════════════════════════
   Force on a current-carrying conductor in a uniform B field.

   Coordinate convention (world units):
     B is fixed along +X (visualised as parallel arrows pointing right).
     The wire lies in the X–Z plane, tilted by angle θ measured from +X.
        I_hat = currentDir · (cos θ, 0, sin θ)
     F = I ℓ × B,  so for B = (B, 0, 0):
        F = I ℓ B sin θ along ±Y (vertical).
     θ = 0  → wire parallel to B → F = 0
     θ = 90 → wire perpendicular → F = B I ℓ (max)
═══════════════════════════════════════════════════════════════ */

const state = {
  I: 2.0,           // amperes
  B: 0.3,           // tesla
  L: 1.0,           // metres
  theta: 60,        // degrees, angle between I and B
  currentDir: +1,   // +1 = forward, −1 = reversed
  showField: true,
  showForce: true,
  showLabels: { I: true, B: true, F: true, theta: true },
};

/* World scale: 1 unit ≈ 25 cm of physical length, picked so a 1 m wire
   is 4 units long — comfortably inside the ±5-unit scene volume. */
const WIRE_VIS_SCALE = 4.0;
const FORCE_REF_N = 4.0;     // arrow length 4 units when |F| ≈ 4 N
const FIELD_LINE_X_HALF = 3.5;

/* ── Physics ───────────────────────────────────────────── */

function thetaRad() { return state.theta * Math.PI / 180; }

function currentVec() {
  const t = thetaRad();
  return new THREE.Vector3(Math.cos(t), 0, Math.sin(t)).multiplyScalar(state.currentDir);
}

function forceVec() {
  // F = I (ℓ · I_hat) × B_vec, with B = (B, 0, 0)
  const Ihat = currentVec();
  const B = new THREE.Vector3(state.B, 0, 0);
  return new THREE.Vector3().crossVectors(Ihat, B).multiplyScalar(state.I * state.L);
}

function forceMagnitude() {
  return state.B * state.I * state.L * Math.abs(Math.sin(thetaRad()));
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const perspCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const ORTHO_HALF = 4.6;
const orthoCam = new THREE.OrthographicCamera(
  -ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 200,
);
let camera = perspCam;
const camTarget = new THREE.Vector3(0, 0, 0);
const camState = { radius: 14, yaw: 0.9, pitch: 0.35, mode: 'persp' };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(6, 8, 4);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(10, 10, 0x9ab2cc, 0xcfddee);
gridHelper.position.y = -3.5;
scene.add(gridHelper);

/* ── Dot/cross glyph textures ────────────────────────────────── */
// Used whenever a vector points along the camera's view direction (so the
// usual arrow would project to a single point). ⊗ = into screen, ⊙ = out.
function makeGlyphTexture(into, hexColor) {
  const px = 128;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  // Soft white fill so the glyph reads against the field arrows.
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
const forceGlyphTexIn  = makeGlyphTexture(true,  '#15803d');
const forceGlyphTexOut = makeGlyphTexture(false, '#15803d');
const wireGlyphTexIn   = makeGlyphTexture(true,  '#9a3412');
const wireGlyphTexOut  = makeGlyphTexture(false, '#9a3412');

/* ── B-field: arrows + dot/cross glyphs ─────────────────────── */
const fieldGroup = new THREE.Group();
scene.add(fieldGroup);
const fieldArrowsGroup = new THREE.Group();
const fieldGlyphsGroup = new THREE.Group();
fieldGroup.add(fieldArrowsGroup);
fieldGroup.add(fieldGlyphsGroup);

const FIELD_GRID_YS = [-2.2, 0, 2.2];
const FIELD_GRID_ZS = [-2.2, 0, 2.2];

function buildFieldArrows() {
  fieldArrowsGroup.clear();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2563eb, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.85,
  });
  const SHAFT_LEN = FIELD_LINE_X_HALF * 1.7;
  for (const y of FIELD_GRID_YS) {
    for (const z of FIELD_GRID_ZS) {
      if (y === 0 && z === 0) continue;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, SHAFT_LEN, 10),
        mat,
      );
      shaft.rotation.z = -Math.PI / 2;
      shaft.position.set(0, y, z);
      fieldArrowsGroup.add(shaft);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.36, 14),
        mat,
      );
      head.rotation.z = -Math.PI / 2;
      head.position.set(SHAFT_LEN / 2 + 0.18, y, z);
      fieldArrowsGroup.add(head);
    }
  }
}
buildFieldArrows();

const fieldGlyphSprites = [];
function buildFieldGlyphs() {
  fieldGlyphsGroup.clear();
  fieldGlyphSprites.length = 0;
  for (const y of FIELD_GRID_YS) {
    for (const z of FIELD_GRID_ZS) {
      if (y === 0 && z === 0) continue;
      const mat = new THREE.SpriteMaterial({ map: fieldGlyphTexIn, transparent: true, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(0.55, 0.55, 1);
      sp.position.set(0, y, z);
      sp.renderOrder = 5;
      fieldGlyphsGroup.add(sp);
      fieldGlyphSprites.push(sp);
    }
  }
}
buildFieldGlyphs();
fieldGlyphsGroup.visible = false;

/* ── Label sprites ────────────────────────────────────────── */
// Sprites always face the camera; we generate the glyph onto a tiny canvas
// with high-DPR scaling so it stays crisp at any zoom.
function makeLabel(text, color) {
  const px = 256;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.font = `italic bold 150px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  // Soft halo so labels stay legible against the field arrows.
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 18;
  ctx.fillText(text, px / 2, px / 2 + 6);
  ctx.shadowBlur = 0;
  ctx.fillText(text, px / 2, px / 2 + 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.85, 0.85, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const labelGroup = new THREE.Group();
scene.add(labelGroup);

const labels = {
  I:     makeLabel('I',  '#9a3412'),
  B:     makeLabel('B',  '#1d4ed8'),
  F:     makeLabel('F',  '#15803d'),
  theta: makeLabel('θ',  '#15304d'),
};
Object.values(labels).forEach((s) => labelGroup.add(s));

const thetaArcGroup = new THREE.Group();
scene.add(thetaArcGroup);

function buildThetaArc() {
  thetaArcGroup.clear();
  if (!state.showLabels.theta) return;
  const t = thetaRad();
  // Hide whenever the wire is parallel to +X — that is, at θ ≈ 0° or ≈ 360°.
  if (t < 0.01 || t > 2 * Math.PI - 0.01) return;
  const r = 0.85;
  const segs = Math.max(8, Math.ceil(t / 0.08));
  const points = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * t;
    points.push(new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segs * 2, 0.025, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x15304d }),
  );
  thetaArcGroup.add(tube);
}

function updateLabels() {
  // I — at the wire's tip with a perpendicular offset so the glyph doesn't
  // sit on the arrow head. In glyph mode the wire is seen end-on at origin,
  // so park the label just above origin instead.
  const Ihat = currentVec();
  if (wireGlyphGroup.visible) {
    labels.I.position.set(0, 0.7, 0);
  } else {
    const wireTip = Ihat.clone().multiplyScalar(state.L * WIRE_VIS_SCALE / 2);
    const Iperp = new THREE.Vector3(-Ihat.z, 0, Ihat.x).multiplyScalar(0.45);
    labels.I.position.copy(wireTip).addScaledVector(Ihat, 0.55).add(Iperp);
  }
  labels.I.visible = state.showLabels.I;

  // B — near the head of one of the field arrows.
  labels.B.position.set(FIELD_LINE_X_HALF * 0.95 + 0.55, 2.2, 2.2);
  labels.B.visible = state.showLabels.B;

  // F — diagonally offset in X–Z so it never sits directly on the arrow shaft.
  // Same offset works for arrow mode (label beside arrow tip) and glyph mode
  // (label beside the dot/cross at the origin).
  const F = forceVec();
  const Fmag = F.length();
  if (Fmag < 1e-9 || !state.showForce) {
    labels.F.visible = false;
  } else {
    const PERP = new THREE.Vector3(0.55, 0, 0.55);
    if (forceGlyphGroup.visible) {
      labels.F.position.set(0.7, 0, 0.7);
    } else {
      const dir = F.clone().normalize();
      const visLen = forceVisLen(Fmag);
      labels.F.position.copy(dir).multiplyScalar(visLen + 0.15).add(PERP);
    }
    labels.F.visible = state.showLabels.F;
  }

  // θ — at the bisector of the angle between +X and the wire direction.
  // Hidden at θ ≈ 0° AND θ ≈ 360°, so a full rotation looks the same as no
  // rotation (which it physically is).
  const t = thetaRad();
  const halfA = t / 2;
  const r = 1.25;
  labels.theta.position.set(r * Math.cos(halfA), 0, r * Math.sin(halfA));
  labels.theta.visible = state.showLabels.theta && t > 0.01 && t < 2 * Math.PI - 0.01;
}

/* ── Pick arrow vs glyph based on camera view direction ─────── */
function updateRepresentation() {
  if (!camera) return;
  const view = camTarget.clone().sub(camera.position).normalize();

  // B is along +X. View direction's x-component tells us alignment.
  const bDot = view.x;
  const fieldAxial = Math.abs(bDot) > 0.95;
  fieldArrowsGroup.visible = state.showField && !fieldAxial;
  fieldGlyphsGroup.visible = state.showField && fieldAxial;
  if (fieldAxial) {
    // bDot > 0 → view direction is +X, B is +X → B INTO screen (⊗).
    const tex = bDot > 0 ? fieldGlyphTexIn : fieldGlyphTexOut;
    fieldGlyphSprites.forEach((sp) => { sp.material.map = tex; sp.material.needsUpdate = true; });
  }

  // F vector
  const F = forceVec();
  const Fmag = F.length();
  if (Fmag < 1e-9 || !state.showForce) {
    forceArrowGroup.visible = false;
    forceGlyphGroup.visible = false;
  } else {
    const fDot = view.dot(F.clone().normalize());
    const forceAxial = Math.abs(fDot) > 0.95;
    forceArrowGroup.visible = !forceAxial;
    forceGlyphGroup.visible = forceAxial;
    if (forceAxial) {
      forceGlyphMat.map = fDot > 0 ? forceGlyphTexIn : forceGlyphTexOut;
      forceGlyphMat.needsUpdate = true;
    }
  }

  // Wire current I — when the wire points along the view direction, swap the
  // foreshortened cylinder for the dot/cross glyph at the wire's centre.
  const wDot = view.dot(currentVec());
  const wireAxial = Math.abs(wDot) > 0.95;
  wireMeshGroup.visible = !wireAxial;
  wireGlyphGroup.visible = wireAxial;
  if (wireAxial) {
    wireGlyphMat.map = wDot > 0 ? wireGlyphTexIn : wireGlyphTexOut;
    wireGlyphMat.needsUpdate = true;
  }

  updateLabels();
}

/* ── Wire: cylinder + arrow head, plus dot/cross glyph ──────── */
const wireGroup = new THREE.Group();
scene.add(wireGroup);
const wireMeshGroup = new THREE.Group();
const wireGlyphGroup = new THREE.Group();
wireGroup.add(wireMeshGroup);
wireGroup.add(wireGlyphGroup);

const wireGlyphMat = new THREE.SpriteMaterial({ map: wireGlyphTexIn, transparent: true, depthTest: false });
const wireGlyphSprite = new THREE.Sprite(wireGlyphMat);
wireGlyphSprite.scale.set(0.95, 0.95, 1);
wireGlyphSprite.renderOrder = 6;
wireGlyphGroup.add(wireGlyphSprite);
wireGlyphGroup.visible = false;

function buildWire() {
  wireMeshGroup.clear();
  const visualLen = state.L * WIRE_VIS_SCALE;
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0xc2410c, metalness: 0.45, roughness: 0.45,
  });

  // Cylinder: built along +Y, then rotated to align with current direction.
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, visualLen, 24),
    wireMat,
  );
  const Ihat = currentVec();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Ihat);
  cyl.quaternion.copy(q);
  wireMeshGroup.add(cyl);

  // Arrow head at the +current end.
  const tip = Ihat.clone().multiplyScalar(visualLen / 2);
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.3, roughness: 0.5 });
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 20),
    arrowMat,
  );
  head.quaternion.copy(q);
  head.position.copy(tip).addScaledVector(Ihat, 0.27);
  wireMeshGroup.add(head);
}

/* ── Force vector: arrow + dot/cross glyph ──────────────────── */
const forceGroup = new THREE.Group();
scene.add(forceGroup);
const forceArrowGroup = new THREE.Group();
const forceGlyphGroup = new THREE.Group();
forceGroup.add(forceArrowGroup);
forceGroup.add(forceGlyphGroup);

const forceGlyphMat = new THREE.SpriteMaterial({ map: forceGlyphTexIn, transparent: true, depthTest: false });
const forceGlyphSprite = new THREE.Sprite(forceGlyphMat);
forceGlyphSprite.scale.set(0.95, 0.95, 1);
forceGlyphSprite.renderOrder = 6;
forceGlyphGroup.add(forceGlyphSprite);
forceGlyphGroup.visible = false;

function forceVisLen(mag) {
  return Math.max(0.6, Math.min(5.0, 1.0 + 1.6 * Math.sqrt(mag / FORCE_REF_N)));
}

function buildForce() {
  forceArrowGroup.clear();
  if (!state.showForce) return;
  const F = forceVec();
  const mag = F.length();
  if (mag < 1e-9) return;

  const dir = F.clone().normalize();
  const visLen = forceVisLen(mag);

  const mat = new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.2, roughness: 0.5 });

  const SHAFT = visLen * 0.7;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, SHAFT, 14),
    mat,
  );
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  shaft.quaternion.copy(q);
  shaft.position.copy(dir).multiplyScalar(SHAFT / 2);
  forceArrowGroup.add(shaft);

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, visLen * 0.32, 16),
    mat,
  );
  head.quaternion.copy(q);
  head.position.copy(dir).multiplyScalar(visLen - visLen * 0.16);
  forceArrowGroup.add(head);
}

/* ═══════════════════════════════════════════════════════════════
   Updates driven by state
═══════════════════════════════════════════════════════════════ */
function updateReadout() {
  const F = forceMagnitude();
  const sinT = Math.sin(thetaRad());
  document.getElementById('rd-sin').textContent = sinT.toFixed(3);
  document.getElementById('rd-mag').textContent = formatN(F);
  const Fvec = forceVec();
  if (Fvec.lengthSq() < 1e-12) {
    document.getElementById('rd-dir').textContent = 'no force';
  } else {
    const sgn = Math.sign(Fvec.y);
    document.getElementById('rd-dir').textContent = sgn > 0 ? '+y (up)' : '−y (down)';
  }
}

function formatN(F) {
  if (F < 1e-3) return (F * 1000).toFixed(2) + ' mN';
  if (F < 1)    return (F * 1000).toFixed(0) + ' mN';
  return F.toFixed(2) + ' N';
}

function rebuildScene() {
  buildWire();
  buildForce();
  buildThetaArc();
  fieldGroup.visible = state.showField;
  forceGroup.visible = state.showForce;
  updateRepresentation();   // also calls updateLabels()
  updateReadout();
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
  // Gimbal blend near vertical pitch (matches straight-conductor sim).
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
  // Re-evaluate arrow vs glyph after camera moves. Defined later, so guard.
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
  // Manual orbit drops back to perspective and clears any active preset.
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
    camState.radius = Math.max(5, Math.min(40, camState.radius + e.deltaY * 0.01));
    updateCamera();
  }
}, { passive: false });

function setCamPreset(preset) {
  if (preset === 'iso') {
    camState.yaw = 0.9; camState.pitch = 0.35; camState.radius = 14;
    useCamera('persp');
  }
  if (preset === 'top') {
    // Look down −Y so the X–Z plane (wire + B) is flat to the viewer
    // and the force points straight at you. Orthographic so parallel
    // field arrows project to perfectly parallel arrows on screen.
    camState.yaw = 0; camState.pitch = Math.PI / 2 - 0.001; camState.radius = 13;
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
  if (preset === 'side') {
    // Look along −X so B comes straight at you and force is vertical.
    camState.yaw = -Math.PI / 2; camState.pitch = 0; camState.radius = 13;
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

document.querySelectorAll('#seg-dir .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.currentDir = btn.dataset.val === 'fwd' ? +1 : -1;
    setActive('#seg-dir', btn);
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
wireSlider('slider-current', 'val-current', v => { state.I = v; rebuildScene(); }, 1);
wireSlider('slider-field',   'val-field',   v => { state.B = v; rebuildScene(); }, 2);
wireSlider('slider-length',  'val-length',  v => { state.L = v; rebuildScene(); }, 2);
wireSlider('slider-theta',   'val-theta',   v => { state.theta = v; rebuildScene(); }, 0);

function toggleBtn(id, key, sideEffect) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (sideEffect) sideEffect();
  });
}
toggleBtn('btn-field', 'showField', () => { updateRepresentation(); });
toggleBtn('btn-force', 'showForce', () => { buildForce(); updateRepresentation(); });

// Per-label toggles (F, B, I, θ each independently).
document.querySelectorAll('#seg-labels .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    state.showLabels[key] = !state.showLabels[key];
    btn.classList.toggle('active', state.showLabels[key]);
    if (key === 'theta') buildThetaArc();
    updateLabels();
  });
});

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
  // Keep ortho frustum height fixed; scale width by aspect so circles stay round.
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
