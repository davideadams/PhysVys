/* ═══════════════════════════════════════════════════════════════
   Two Parallel Wires — 3D superposition + attraction/repulsion sim.

   World units: 1 unit = 1 cm.  Wires run along the world Y-axis at
   x = ±d/2, z = 0.  Field traced in the X-Z plane at y = 0.

   For a wire along +Y at (xi, *, 0), B at (x, 0, z) is
       B = (μ₀ I / 2π r²)·(z, 0, −(x−xi))  with r in metres.
   Force on wire 2 from wire 1, per unit length:
       F/ℓ = ±μ₀ I₁ I₂ / 2π d   (− for parallel = attractive, + for
   antiparallel = repulsive); direction is along ±X.
═══════════════════════════════════════════════════════════════ */

const MU0 = 4 * Math.PI * 1e-7;
const CM  = 0.01;

const state = {
  I1: 5.0, I2: 5.0,
  d: 3.0,                      // cm
  dir1: +1, dir2: +1,          // +1 = +Y, −1 = −Y
  showLines: true,
  showForce: true,
  showLabels: true,
};

/* ── Physics ───────────────────────────────────────────── */
function wireXs() { return [-state.d / 2, +state.d / 2]; }

function bAt(x, z) {
  // Returns (Bx, Bz) in tesla. y has no effect (wires are infinite along Y).
  let Bx = 0, Bz = 0;
  const xs = wireXs();
  const Is = [state.I1 * state.dir1, state.I2 * state.dir2];
  for (let i = 0; i < 2; i++) {
    const dx = x - xs[i];
    const dz = z;
    const r2 = dx * dx + dz * dz;        // cm²
    if (r2 < 1e-6) continue;
    // (μ₀ I / 2π) / r_m / r_w  =  (μ₀ I / 2π CM) / r_w²
    const k = (MU0 * Is[i]) / (2 * Math.PI * CM * r2);
    Bx += k * dz;
    Bz += k * (-dx);
  }
  return { Bx, Bz };
}

function bMagAt(x, z) {
  const { Bx, Bz } = bAt(x, z);
  return Math.hypot(Bx, Bz);
}

function bUnit(x, z) {
  const { Bx, Bz } = bAt(x, z);
  const m = Math.hypot(Bx, Bz);
  if (m === 0) return { ux: 0, uz: 0, mag: 0 };
  return { ux: Bx / m, uz: Bz / m, mag: m };
}

function forcePerLength() {
  // F/ℓ on wire 2, in N/m.  Negative = pull toward wire 1 (attractive),
  // positive = push away from wire 1 (repulsive).
  const d_m = state.d * CM;
  return -(MU0 * state.I1 * state.dir1 * state.I2 * state.dir2) / (2 * Math.PI * d_m);
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const perspCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const ORTHO_HALF = 5.2;
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
gridHelper.position.y = -4;
scene.add(gridHelper);

/* ── Glyph textures (⊗ and ⊙) ───────────────────────────────── */
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
const wireGlyphTexIn  = makeGlyphTexture(true,  '#9a3412');
const wireGlyphTexOut = makeGlyphTexture(false, '#9a3412');

function makeGlyphSprite() {
  const mat = new THREE.SpriteMaterial({ map: wireGlyphTexIn, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.5, 0.5, 1);
  sp.renderOrder = 6;
  return sp;
}

/* ── Text labels ─────────────────────────────────────────── */
function makeLabel(text, color) {
  const px = 256;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.font = `italic bold 150px "Trebuchet MS", "Gill Sans", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, px / 2, px / 2 + 6);
  ctx.shadowBlur = 0;
  ctx.fillText(text, px / 2, px / 2 + 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.85, 0.85, 1);
  sp.renderOrder = 10;
  return sp;
}
const labelGroup = new THREE.Group();
scene.add(labelGroup);
const labels = {
  I1: makeLabel('I₁', '#9a3412'),
  I2: makeLabel('I₂', '#9a3412'),
  F1: makeLabel('F',  '#15803d'),
  F2: makeLabel('F',  '#15803d'),
};
Object.values(labels).forEach((s) => labelGroup.add(s));

/* ── Wires (cylinders + arrowheads + glyphs) ─────────────────── */
const wireGroup = new THREE.Group();
scene.add(wireGroup);
const wireMeshGroup = new THREE.Group();
const wireGlyphGroup = new THREE.Group();
wireGroup.add(wireMeshGroup);
wireGroup.add(wireGlyphGroup);

const wireGlyphSprites = [makeGlyphSprite(), makeGlyphSprite()];
wireGlyphSprites.forEach((s) => wireGlyphGroup.add(s));
wireGlyphGroup.visible = false;

const WIRE_HALF = 4.6;

function buildWires() {
  wireMeshGroup.clear();
  const xs = wireXs();
  const dirs = [state.dir1, state.dir2];
  for (let i = 0; i < 2; i++) {
    const cylinderMat = new THREE.MeshStandardMaterial({
      color: 0xc2410c, metalness: 0.45, roughness: 0.45,
    });
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2 * WIRE_HALF, 24),
      cylinderMat,
    );
    cyl.position.set(xs[i], 0, 0);
    wireMeshGroup.add(cyl);

    // Current arrow at the +current end of each wire.
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.3, roughness: 0.5 });
    const tipY = dirs[i] > 0 ? WIRE_HALF + 0.55 : -WIRE_HALF - 0.55;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.55, 20),
      arrowMat,
    );
    cone.position.set(xs[i], tipY, 0);
    if (dirs[i] < 0) cone.rotation.z = Math.PI;
    wireMeshGroup.add(cone);
  }
}

/* ── Field lines (traced in the X-Z plane at y=0) ─────────────── */
const linesGroup = new THREE.Group();
scene.add(linesGroup);

const LINE_STEP = 0.06;          // cm
const LINE_MAX_STEPS = 1200;
const FIELD_BOUND_X = 6.5;
const FIELD_BOUND_Z = 4.6;
const WIRE_TERM_R2 = 0.18 * 0.18;  // stop tracing within 0.18 cm of a wire centre

function nearWire(x, z) {
  const xs = wireXs();
  for (const xi of xs) {
    const dx = x - xi, dz = z;
    if (dx * dx + dz * dz < WIRE_TERM_R2) return true;
  }
  return false;
}

function traceLine(seedX, seedZ, sign) {
  const points = [{ x: seedX, z: seedZ }];
  let x = seedX, z = seedZ;
  for (let s = 0; s < LINE_MAX_STEPS; s++) {
    const k1 = bUnit(x, z); if (k1.mag === 0) break;
    const hx = LINE_STEP / 2;
    const k2 = bUnit(x + sign * hx * k1.ux, z + sign * hx * k1.uz);
    const k3 = bUnit(x + sign * hx * k2.ux, z + sign * hx * k2.uz);
    const k4 = bUnit(x + sign * LINE_STEP * k3.ux, z + sign * LINE_STEP * k3.uz);
    x += sign * (LINE_STEP / 6) * (k1.ux + 2 * k2.ux + 2 * k3.ux + k4.ux);
    z += sign * (LINE_STEP / 6) * (k1.uz + 2 * k2.uz + 2 * k3.uz + k4.uz);
    if (Math.abs(x) > FIELD_BOUND_X || Math.abs(z) > FIELD_BOUND_Z) break;
    if (nearWire(x, z)) break;
    points.push({ x, z });
  }
  return points;
}

function buildFieldLines() {
  linesGroup.clear();
  if (!state.showLines) return;

  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x0d9488, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.88,
  });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x0d9488 });

  const xs = wireXs();
  // One closed curve per radius around each wire (matches the single-wire
  // sim's geometric-ring convention) — gives a clean image with no
  // overlapping near-duplicates.
  const innerRadii = [0.55, 1.1];
  for (let w = 0; w < 2; w++) {
    const xi = xs[w];
    for (const seedR of innerRadii) {
      const pts = traceLine(xi, seedR, +1);
      drawTracedLine(pts, tubeMat, headMat);
    }
  }

  // Outer seeds depend on the configuration:
  //   parallel    → midline seeds give big encompassing loops around both wires
  //   antiparallel → off-midline seeds give the dipole-like connecting field
  //     lines (a midline seed would trace a degenerate vertical line because
  //     Bx cancels and only −Z survives along x = 0)
  const isParallel = state.dir1 * state.dir2 > 0;
  const outerSeeds = isParallel
    ? [{ x: 0, z: 2.4 }, { x: 0, z: 3.6 }]
    : [{ x: -1.0, z: 1.8 }, { x: +1.0, z: 1.8 }];
  for (const s of outerSeeds) {
    const pts = traceLine(s.x, s.z, +1);
    drawTracedLine(pts, tubeMat, headMat);
  }
}

function drawTracedLine(pts, tubeMat, headMat) {
  if (pts.length < 4) return;
  // Build a tube along the line, in the y=0 plane.
  const path3d = pts.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(path3d);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(8, pts.length), 0.025, 6, false),
    tubeMat,
  );
  linesGroup.add(tube);

  // One arrowhead near the middle of the line, pointing along +B.
  const idx = Math.floor(pts.length * 0.45);
  if (idx < 1 || idx >= pts.length) return;
  const p = pts[idx];
  const pPrev = pts[idx - 1];
  const dx = p.x - pPrev.x;
  const dz = p.z - pPrev.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return;
  const ux = dx / len, uz = dz / len;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.24, 12),
    headMat,
  );
  cone.position.set(p.x, 0, p.z);
  // Cone default axis is +Y; rotate so it points along (ux, 0, uz).
  const fromV = new THREE.Vector3(0, 1, 0);
  const toV = new THREE.Vector3(ux, 0, uz);
  cone.quaternion.setFromUnitVectors(fromV, toV);
  linesGroup.add(cone);
}

/* ── Force arrows on each wire ──────────────────────────────── */
const forceGroup = new THREE.Group();
scene.add(forceGroup);

function buildForce() {
  forceGroup.clear();
  if (!state.showForce) return;

  const fL = forcePerLength();           // N/m, along ±X on wire 2
  const mag = Math.abs(fL);
  if (mag < 1e-12) return;

  // Visual length: sqrt scaling so it stays readable across the dynamic range.
  // 1 mN/m → ~1 unit, 50 mN/m → ~3 units.
  const refN = 0.005;                    // 5 mN/m reference
  const visLen = Math.max(0.6, Math.min(3.0, 0.5 + 1.4 * Math.sqrt(mag / refN)));

  const xs = wireXs();
  // Direction on wire 2: sign(fL) along X.  Direction on wire 1: opposite.
  const sign2 = Math.sign(fL);
  const sign1 = -sign2;

  const mat = new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.2, roughness: 0.5 });

  for (let w = 0; w < 2; w++) {
    const wirex = xs[w];
    const sgn = w === 0 ? sign1 : sign2;
    const dir = new THREE.Vector3(sgn, 0, 0);

    const SHAFT = visLen * 0.7;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, SHAFT, 14),
      mat,
    );
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    shaft.quaternion.copy(q);
    shaft.position.set(wirex + dir.x * SHAFT / 2, 0, 0);
    forceGroup.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, visLen * 0.32, 16),
      mat,
    );
    head.quaternion.copy(q);
    head.position.set(wirex + dir.x * (visLen - visLen * 0.16), 0, 0);
    forceGroup.add(head);
  }
}

/* ── Labels ────────────────────────────────────────────────── */
function updateLabels() {
  if (!state.showLabels) {
    Object.values(labels).forEach((s) => (s.visible = false));
    return;
  }
  const xs = wireXs();
  const dirs = [state.dir1, state.dir2];

  // Force direction signs (used both for placing F labels and for placing I
  // labels on the OPPOSITE side of each wire).
  const fL = forcePerLength();
  const fMag = Math.abs(fL);
  const fSign2 = Math.sign(fL);
  const fSign1 = -fSign2;
  const fSigns = [fSign1, fSign2];

  // I₁ and I₂: at the +current end of each wire, on the opposite side
  // from the force arrow.  Falls back to "outer" placement (left of wire 1,
  // right of wire 2) when there is no force at all.
  for (let i = 0; i < 2; i++) {
    const lab = i === 0 ? labels.I1 : labels.I2;
    const tipY = dirs[i] > 0 ? WIRE_HALF + 1.25 : -WIRE_HALF - 1.25;
    const offsetX = fSigns[i] === 0
      ? (i === 0 ? -0.55 : +0.55)
      : -fSigns[i] * 0.55;
    lab.position.set(xs[i] + offsetX, tipY, 0);
    lab.visible = true;
  }

  // F labels: just outside each force arrow's tip.
  if (fMag < 1e-12 || !state.showForce) {
    labels.F1.visible = false;
    labels.F2.visible = false;
  } else {
    const refN = 0.005;
    const visLen = Math.max(0.6, Math.min(3.0, 0.5 + 1.4 * Math.sqrt(fMag / refN)));
    labels.F1.position.set(xs[0] + fSign1 * (visLen + 0.45), 0.55, 0);
    labels.F2.position.set(xs[1] + fSign2 * (visLen + 0.45), 0.55, 0);
    labels.F1.visible = true;
    labels.F2.visible = true;
  }
}

/* ── Readout ───────────────────────────────────────────────── */
function updateReadout() {
  const fL = forcePerLength();
  const mag = Math.abs(fL);
  document.getElementById('rd-mag').textContent = formatForce(mag);
  if (mag < 1e-15) {
    document.getElementById('rd-kind').textContent = '—';
  } else {
    document.getElementById('rd-kind').textContent =
      fL < 0 ? 'attractive (parallel currents)' : 'repulsive (antiparallel)';
  }
}
function formatForce(F) {
  if (F < 1e-6) return (F * 1e9).toFixed(1) + ' nN/m';
  if (F < 1e-3) return (F * 1e6).toFixed(1) + ' µN/m';
  if (F < 1)    return (F * 1e3).toFixed(2) + ' mN/m';
  return F.toFixed(2) + ' N/m';
}

/* ── Pick arrow vs glyph based on view direction ─────────────── */
function updateRepresentation() {
  if (!camera) return;
  const view = camTarget.clone().sub(camera.position).normalize();

  // Wires run along Y. They appear head-on when view direction is along ±Y.
  const wireAxialDot = view.y;
  const wireAxial = Math.abs(wireAxialDot) > 0.95;
  wireMeshGroup.visible = !wireAxial;
  wireGlyphGroup.visible = wireAxial;
  if (wireAxial) {
    // Looking down −Y (camera above): a wire with current +Y is going OUT of
    // screen toward viewer ⇒ ⊙.   Going +Y would take charges from y>0 to y<0
    // … wait: current along +y means flow is upward; viewing from above, you
    // see the *back* of the flow ⇒ INTO screen ⇒ ⊗.
    //   Camera position has y>0 ⇒ view.y < 0.  +Y current: dir=+1.
    //   wireAxialDot = view.y = −1.   For dir=+1, the current actually points
    //   away from the camera (+Y while we look from +Y down) → into screen.
    // The cleanest formulation: the current points into the screen when
    // (view direction) · (current direction) > 0.  view·(0,dir,0) = view.y · dir.
    const dirs = [state.dir1, state.dir2];
    const xs = wireXs();
    for (let i = 0; i < 2; i++) {
      const into = view.y * dirs[i] > 0;
      wireGlyphSprites[i].material.map = into ? wireGlyphTexIn : wireGlyphTexOut;
      wireGlyphSprites[i].material.needsUpdate = true;
      wireGlyphSprites[i].position.set(xs[i], 0, 0);
    }
  }
}

/* ── Master rebuild ───────────────────────────────────────── */
function rebuildScene() {
  buildWires();
  buildFieldLines();
  buildForce();
  updateLabels();
  updateReadout();
  updateRepresentation();
}

/* ═══════════════════════════════════════════════════════════════
   Camera orbit (matches the straight-conductor pattern)
═══════════════════════════════════════════════════════════════ */
function updateCamera() {
  const r = camState.radius, p = camState.pitch, y = camState.yaw;
  camera.position.set(
    r * Math.cos(p) * Math.sin(y),
    r * Math.sin(p),
    r * Math.cos(p) * Math.cos(y),
  );
  const horizCos = Math.cos(p);
  if (Math.abs(horizCos) < 0.15) {
    const blend = Math.abs(horizCos) / 0.15;
    const sgn = Math.sign(p) || 1;
    const fbX = -Math.sin(y) * sgn;
    const fbZ = -Math.cos(y) * sgn;
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

root.addEventListener('pointerdown', (e) => {
  drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
  root.setPointerCapture(e.pointerId);
  root.style.cursor = 'grabbing';
});
root.addEventListener('pointermove', (e) => {
  if (!drag.on) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  camState.yaw -= dx * 0.008;
  const LIM = Math.PI / 2;
  camState.pitch = Math.max(-LIM, Math.min(LIM, camState.pitch - dy * 0.006));
  if (camState.mode === 'ortho') useCamera('persp');
  document.querySelectorAll('#seg-cam .seg-btn').forEach((b) => b.classList.remove('active'));
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
root.addEventListener('wheel', (e) => {
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
  if (preset === 'endon') {
    // Look down −Y onto the X-Z plane (the textbook cross-section).
    camState.yaw = 0; camState.pitch = Math.PI / 2 - 0.001; camState.radius = 13;
    orthoCam.zoom = 1; orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
  if (preset === 'side') {
    // Look along −Z so both wires sit side-by-side as parallel verticals.
    camState.yaw = 0; camState.pitch = 0; camState.radius = 13;
    orthoCam.zoom = 1; orthoCam.updateProjectionMatrix();
    useCamera('ortho');
  }
}

/* ═══════════════════════════════════════════════════════════════
   UI wiring
═══════════════════════════════════════════════════════════════ */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('#seg-dir1 .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.dir1 = btn.dataset.val === 'up' ? +1 : -1;
    setActive('#seg-dir1', btn);
    rebuildScene();
  });
});
document.querySelectorAll('#seg-dir2 .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.dir2 = btn.dataset.val === 'up' ? +1 : -1;
    setActive('#seg-dir2', btn);
    rebuildScene();
  });
});
document.querySelectorAll('#seg-cam .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setCamPreset(btn.dataset.val);
    setActive('#seg-cam', btn);
  });
});

function wireSlider(id, valId, onChange, digits = 1) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.textContent = v.toFixed(digits);
    onChange(v);
  });
}
wireSlider('slider-i1', 'val-i1', (v) => { state.I1 = v; rebuildScene(); }, 1);
wireSlider('slider-i2', 'val-i2', (v) => { state.I2 = v; rebuildScene(); }, 1);
wireSlider('slider-d',  'val-d',  (v) => { state.d  = v; rebuildScene(); }, 1);

function toggleBtn(id, key, sideEffect) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (sideEffect) sideEffect();
  });
}
toggleBtn('btn-lines',  'showLines',  () => { buildFieldLines(); });
toggleBtn('btn-force',  'showForce',  () => { buildForce(); updateLabels(); });
toggleBtn('btn-labels', 'showLabels', updateLabels);

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
