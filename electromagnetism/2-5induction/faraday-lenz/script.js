/* ═══════════════════════════════════════════════════════════════
   Faraday & Lenz: bar magnet sliding through a coil.

   Coordinate convention (world units = metres):
     Coil axis along +X. Coil sits at the origin, radius R, made of N turns
     spread across a small width along X. The magnet slides along the X axis.

   Physics (axial flux through one circular turn from a magnetic dipole):
     Φ(x) = (μ0 · m · sgn) / 2 · R² / (x² + R²)^(3/2)
            sgn = +1 when the N-pole faces the coil from the +X side.
     dΦ/dx = -(μ0 · m · sgn) / 2 · 3 R² x / (x² + R²)^(5/2)
     ε     = -N · dΦ/dt = -N · (dΦ/dx) · v_x

   Faraday mode shows |Φ| and |ε| (no signs, no current direction).
   Lenz mode shows signed Φ and ε; the galvanometer needle swings both ways.
═══════════════════════════════════════════════════════════════ */

const MU0 = 4 * Math.PI * 1e-7;
const X_RANGE = 0.25;          // magnet x range ±X_RANGE (metres)
const COIL_R  = 0.05;          // coil radius (metres)
const COIL_W  = 0.06;          // coil width along X (metres)
const MAGNET_LEN = 0.08;
const MAGNET_THK = 0.022;
const TIME_WINDOW = 5.0;       // graph rolling window (seconds)

const state = {
  mode: 'faraday',          // 'faraday' or 'lenz'
  strength: 2.0,            // A·m²
  N: 20,                    // turns
  // Magnet orientation: rotation about the Y axis. magAngle = 0 → N pole on
  // the +X side; magAngle = π → flipped. Continuous so the polarity flip can
  // be animated and contributes a real ∂Φ/∂a · da/dt term to the EMF.
  magAngle: 0,
  dMagAngleDt: 0,
  flip: { active: false, t0: 0, from: 0, to: 0, dur: 0.5 },
  R: COIL_R,
  magnetX: 0.20,
  prevMagnetX: 0.20,
  velocity: 0,
  velSmoothed: 0,
  autoPlay: false,
  autoSpeed: 0.40,          // m/s
  autoDir: -1,              // direction of auto-sweep
  showFieldLines: false,
  currentPhase: 0,          // accumulated rotation of the spinning current ring
  tNow: 0,
  phiBuf: [],               // [{t, v}]
  emfBuf: [],
};

/* ── Physics ─────────────────────────────────────────────
   The magnet's dipole moment is m·n̂, with n̂ = (cos a, 0, sin a) where
   a = state.magAngle. Only the X-component of n̂ contributes to the axial
   flux through the coil, so cos(a) acts as a continuous polarity. */
function fluxPerTurn(x) {
  const denom = Math.pow(x*x + state.R*state.R, 1.5);
  return (MU0 * state.strength * Math.cos(state.magAngle) / 2) * (state.R * state.R) / denom;
}
function dPhi_dx(x) {
  const denom = Math.pow(x*x + state.R*state.R, 2.5);
  return -(MU0 * state.strength * Math.cos(state.magAngle) / 2) * 3 * state.R * state.R * x / denom;
}
function dPhi_da(x) {
  const denom = Math.pow(x*x + state.R*state.R, 1.5);
  return -(MU0 * state.strength * Math.sin(state.magAngle) / 2) * (state.R * state.R) / denom;
}
function emf(x, vx, daDt) {
  return -state.N * (dPhi_dx(x) * vx + dPhi_da(x) * daDt);
}

/* ── Polarity-flip animation ────────────────────────────── */
function easeInOut(t) { return t * t * (3 - 2 * t); }
function easeInOutDeriv(t) { return 6 * t * (1 - t); }

function startFlipTo(targetSign) {
  const curSign = Math.cos(state.magAngle) >= 0 ? +1 : -1;
  if (curSign === targetSign && !state.flip.active) return;
  // Start from the *current* (mid-animation) angle so rapid clicks chain
  // smoothly instead of snapping.
  state.flip.from = state.magAngle;
  state.flip.to   = state.magAngle + Math.PI;
  state.flip.t0   = state.tNow;
  state.flip.active = true;
}

function tickFlip() {
  if (!state.flip.active) { state.dMagAngleDt = 0; return; }
  const tau = (state.tNow - state.flip.t0) / state.flip.dur;
  if (tau >= 1) {
    // Wrap to [0, 2π) so the angle doesn't drift over many flips.
    state.magAngle = ((state.flip.to % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    state.dMagAngleDt = 0;
    state.flip.active = false;
    return;
  }
  const span = state.flip.to - state.flip.from;
  state.magAngle    = state.flip.from + span * easeInOut(tau);
  state.dMagAngleDt = span * easeInOutDeriv(tau) / state.flip.dur;
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 5);
const camTarget = new THREE.Vector3(0, 0, 0);
const camState = { radius: 0.55, yaw: 0.7, pitch: 0.30 };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.65));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
dirLight.position.set(0.4, 0.6, 0.5);
scene.add(dirLight);

// Floor grid for visual grounding (10 cm cells).
const gridHelper = new THREE.GridHelper(0.6, 12, 0x9ab2cc, 0xcfddee);
gridHelper.position.y = -0.10;
scene.add(gridHelper);

/* ── Coil ────────────────────────────────────────────────── */
const coilGroup = new THREE.Group();
scene.add(coilGroup);

const coilMat = new THREE.MeshStandardMaterial({
  color: 0xc2410c, metalness: 0.45, roughness: 0.45,
});

let lastCoilN = -1;
function buildCoil() {
  if (state.N === lastCoilN) return;
  lastCoilN = state.N;
  coilGroup.clear();
  // Cap visible turns so we don't render hundreds of tori.
  const visN = Math.min(state.N, 24);
  const halfW = COIL_W / 2;
  const tubeR = 0.0025;
  const torusGeo = new THREE.TorusGeometry(state.R, tubeR, 8, 48);
  for (let i = 0; i < visN; i++) {
    const t = visN === 1 ? 0.5 : i / (visN - 1);
    const x = -halfW + t * COIL_W;
    const ring = new THREE.Mesh(torusGeo, coilMat);
    // Default torus is in X–Y plane (axis = Z). Rotate so axis = X.
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x;
    coilGroup.add(ring);
  }
  // Faint axis hint so the sliding direction reads at a glance.
  const axisGeo = new THREE.CylinderGeometry(0.001, 0.001, 2 * X_RANGE + MAGNET_LEN, 6);
  const axisMat = new THREE.MeshBasicMaterial({ color: 0x9ab2cc, transparent: true, opacity: 0.5 });
  const axis = new THREE.Mesh(axisGeo, axisMat);
  axis.rotation.z = Math.PI / 2;
  coilGroup.add(axis);
}
buildCoil();

/* ── Magnet ───────────────────────────────────────────────── */
const magnetGroup = new THREE.Group();
scene.add(magnetGroup);

// Two halves: north (red) and south (blue). When polarity = +1 the N pole sits
// on the +X side (so it faces the coil whenever the magnet is at x > 0).
const magNorthMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.25, roughness: 0.5 });
const magSouthMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.25, roughness: 0.5 });
const halfGeo = new THREE.BoxGeometry(MAGNET_LEN / 2, MAGNET_THK, MAGNET_THK);
const halfPos = new THREE.Mesh(halfGeo, magNorthMat); // +X half
const halfNeg = new THREE.Mesh(halfGeo, magSouthMat); // −X half
halfPos.position.x = +MAGNET_LEN / 4;
halfNeg.position.x = -MAGNET_LEN / 4;
magnetGroup.add(halfPos);
magnetGroup.add(halfNeg);

function makePoleLabel(text, color) {
  const px = 128;
  const cv = document.createElement('canvas');
  cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 90px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 14;
  ctx.fillText(text, px / 2, px / 2 + 4);
  ctx.shadowBlur = 0;
  ctx.fillText(text, px / 2, px / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.04, 0.04, 1);
  sp.renderOrder = 10;
  return sp;
}
const labelN = makePoleLabel('N', '#dc2626');
const labelS = makePoleLabel('S', '#1d4ed8');
labelN.position.set(+MAGNET_LEN / 2 + 0.012, 0.022, 0);
labelS.position.set(-MAGNET_LEN / 2 - 0.012, 0.022, 0);
magnetGroup.add(labelN);
magnetGroup.add(labelS);

function syncMagnetTransform() {
  magnetGroup.position.x = state.magnetX;
  magnetGroup.rotation.y = state.magAngle;
}
syncMagnetTransform();

/* ── Induced-B arrow inside the coil (Lenz mode only) ─────── */
const inducedGroup = new THREE.Group();
scene.add(inducedGroup);
const inducedMat = new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.2, roughness: 0.5 });
const inducedShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.05, 10), inducedMat);
const inducedHead  = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.018, 14), inducedMat);
inducedShaft.rotation.z = Math.PI / 2;
inducedHead.rotation.z  = Math.PI / 2;
inducedGroup.add(inducedShaft);
inducedGroup.add(inducedHead);
inducedGroup.visible = false;

/* ── Spinning induced-current ring ─────────────────────────
   A ring of arrowheads orbiting the coil axis. Right-hand rule: thumb along
   induced B → fingers curl with the current → at azimuth θ (from +Y in YZ)
   the current direction is sign(ε) · (0, −sin θ, cos θ).

   We pre-build two oriented sets (forward / reverse). They share a single
   monotonically-growing phase: forward rotates +phase, reverse rotates
   −phase, so whichever one is visible always appears to flow in the
   direction its arrowheads point. */
const N_CURRENT_ARROWS = 8;
const CURRENT_RING_R   = COIL_R * 1.05;          // sit just outside the coil
const arrowMat = new THREE.MeshStandardMaterial({
  color: 0xf59e0b, metalness: 0.2, roughness: 0.45,
  emissive: 0xf59e0b, emissiveIntensity: 0.18,
});
const arrowGeo = new THREE.ConeGeometry(0.005, 0.016, 14);

const arrowsForward = new THREE.Group();
const arrowsReverse = new THREE.Group();
function buildCurrentArrowSet(group, dirSign) {
  for (let i = 0; i < N_CURRENT_ARROWS; i++) {
    const theta = (i / N_CURRENT_ARROWS) * Math.PI * 2;
    const cone = new THREE.Mesh(arrowGeo, arrowMat);
    cone.position.set(0, CURRENT_RING_R * Math.cos(theta), CURRENT_RING_R * Math.sin(theta));
    const tangent = new THREE.Vector3(0, -Math.sin(theta), Math.cos(theta)).multiplyScalar(dirSign);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    group.add(cone);
  }
}
buildCurrentArrowSet(arrowsForward, +1);
buildCurrentArrowSet(arrowsReverse, -1);

// Faint guide ring so the arrows have a visible "track" to orbit on.
const guideRing = new THREE.Mesh(
  new THREE.TorusGeometry(CURRENT_RING_R, 0.0009, 8, 64),
  new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35 }),
);
guideRing.rotation.y = Math.PI / 2;     // axis along X to match the coil

const currentArrowsGroup = new THREE.Group();
currentArrowsGroup.add(guideRing);
currentArrowsGroup.add(arrowsForward);
currentArrowsGroup.add(arrowsReverse);
currentArrowsGroup.visible = false;
scene.add(currentArrowsGroup);

const CURRENT_OMEGA_REF = 0.002;   // EMF (V) at which the ring spins fast
const CURRENT_OMEGA_MAX = 8.0;     // rad/s cap, so big spikes don't blur

function updateInducedArrow(eNow, dt) {
  // Direction of induced B = −sign(dΦ/dt) = sign(ε). Current circulates
  // around the coil axis with the same sign by the right-hand rule.
  if (state.mode !== 'lenz' || Math.abs(eNow) < 1e-6) {
    inducedGroup.visible = false;
    currentArrowsGroup.visible = false;
    return;
  }
  const sgn = Math.sign(eNow);
  inducedShaft.position.set(sgn * 0.025, 0, 0);
  inducedHead.position.set(sgn * 0.060, 0, 0);
  // Cone default tip is +Y; rotation.z = −π/2 maps +Y → +X (tip outward
  // for sgn > 0). Reverse for sgn < 0.
  inducedHead.rotation.z = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
  inducedGroup.visible = true;

  // Spinning current ring: the visible set always rotates in the direction its
  // arrowheads point, so motion = current direction. Speed grows with |ε|
  // through a tanh so the ring never blurs out at big spikes.
  const speed = Math.tanh(Math.abs(eNow) / CURRENT_OMEGA_REF) * CURRENT_OMEGA_MAX;
  state.currentPhase += speed * dt;
  arrowsForward.rotation.x = +state.currentPhase;
  arrowsReverse.rotation.x = -state.currentPhase;

  currentArrowsGroup.visible = true;
  arrowsForward.visible = sgn > 0;
  arrowsReverse.visible = sgn < 0;
}

/* ── Field lines ──────────────────────────────────────────────
   The magnet's field is rotationally symmetric about the magnet's axis (X),
   so its field lines all lie in some meridional plane. To get the classic
   "bar magnet" textbook look we trace one meridional plane only and orient
   it to face the camera (its normal lies in the YZ plane and points roughly
   at the viewer).

   The trace uses a two-monopole approximation: ±q at the magnet's ends. This
   is closer to the look of a real bar magnet than a point dipole, where all
   lines would emerge from a single point.
═══════════════════════════════════════════════════════════════ */
const fieldLinesGroup = new THREE.Group();
scene.add(fieldLinesGroup);

const NUM_LINES_HALF = 7;          // upper half of the meridional plane
const LINE_MAX_PTS   = 600;
const lineMeshes = [];
const lineMat = new THREE.LineBasicMaterial({
  color: 0x6366f1, transparent: true, opacity: 0.55, depthWrite: false,
});
for (let i = 0; i < NUM_LINES_HALF * 2; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_MAX_PTS * 3), 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, lineMat);
  line.frustumCulled = false;
  fieldLinesGroup.add(line);
  lineMeshes.push(line);
}

// Sub-group for arrowheads showing the *direction* of the field along each
// line. Held under fieldLinesGroup so it inherits the same translation +
// rotation (slides with the magnet, rotates during a polarity flip).
const fieldArrowsSubGroup = new THREE.Group();
fieldLinesGroup.add(fieldArrowsSubGroup);
const fieldArrowMat = new THREE.MeshStandardMaterial({
  color: 0x6366f1, metalness: 0.1, roughness: 0.5,
  transparent: true, opacity: 0.9, depthWrite: false,
});
const fieldArrowGeo = new THREE.ConeGeometry(0.0035, 0.011, 12);
const FIELD_ARROW_FRACTIONS = [0.22, 0.50, 0.78];

fieldLinesGroup.visible = false;

function traceFieldLines() {
  // Lines are traced in the magnet's *local* frame: N pole at +d along local
  // X, S pole at −d. The fieldLinesGroup transform places and rotates them
  // into the world (so they translate with the magnet and rotate with it
  // during a polarity flip).
  const d = MAGNET_LEN * 0.42;
  const xN = +d;
  const xS = -d;
  const q  = 1.0;                        // arbitrary; only direction matters
  const ds = 0.002;                      // step size (m)
  const stopR = MAGNET_THK * 0.55;
  const maxX = X_RANGE * 1.6;
  const maxY = X_RANGE * 1.2;
  const halfBudget = (LINE_MAX_PTS - 1) >> 1;

  function field(px, py) {
    const dxN = px - xN, dyN = py;
    const rN  = Math.sqrt(dxN*dxN + dyN*dyN) + 1e-9;
    const fN  = q / (rN * rN * rN);
    const dxS = px - xS, dyS = py;
    const rS  = Math.sqrt(dxS*dxS + dyS*dyS) + 1e-9;
    const fS  = -q / (rS * rS * rS);
    return { x: dxN * fN + dxS * fS, y: dyN * fN + dyS * fS };
  }

  // Trace from a seed in either field direction (dir = +1 or −1) until the
  // line either exits the scene or touches a pole. Returns a flat [x,y,...]
  // array starting at the seed.
  function traceDir(sx, sy, dir) {
    const pts = [sx, sy];
    let px = sx, py = sy;
    for (let s = 0; s < halfBudget; s++) {
      const b = field(px, py);
      const m = Math.sqrt(b.x*b.x + b.y*b.y);
      if (m < 1e-12) break;
      px += (b.x / m) * ds * dir;
      py += (b.y / m) * ds * dir;
      pts.push(px, py);
      if (Math.abs(px) > maxX || Math.abs(py) > maxY) break;
      const dxN = px - xN, dyN = py;
      if (Math.sqrt(dxN*dxN + dyN*dyN) < stopR) break;
      const dxS = px - xS, dyS = py;
      if (Math.sqrt(dxS*dxS + dyS*dyS) < stopR) break;
    }
    return pts;
  }

  // Place a few arrowheads along each line. Array order is the field
  // direction (because we built it as reverse(bwd) + fwd[1..]), so a
  // forward finite difference gives the local tangent in the right sense.
  // For the lower-half mirror (ySign = −1) the field's Y-component flips
  // by symmetry, so flipping the tangent's Y gives the right direction.
  const _tan = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  function placeArrows(flatPts, ySign) {
    const n = flatPts.length / 2;
    if (n < 4) return;
    for (const f of FIELD_ARROW_FRACTIONS) {
      const idx = Math.max(1, Math.min(n - 2, Math.round(f * (n - 1))));
      const px = flatPts[idx * 2];
      const py = flatPts[idx * 2 + 1] * ySign;
      const tx = flatPts[(idx + 1) * 2]     - flatPts[(idx - 1) * 2];
      const ty = (flatPts[(idx + 1) * 2 + 1] - flatPts[(idx - 1) * 2 + 1]) * ySign;
      const tlen = Math.sqrt(tx * tx + ty * ty);
      if (tlen < 1e-9) continue;
      _tan.set(tx / tlen, ty / tlen, 0);
      const cone = new THREE.Mesh(fieldArrowGeo, fieldArrowMat);
      cone.position.set(px, py, 0);
      cone.quaternion.setFromUnitVectors(_yAxis, _tan);
      fieldArrowsSubGroup.add(cone);
    }
  }

  // Seed each line at the magnet's centre, above the axis at varying heights.
  // Tracing forward + backward from one seed gives a symmetric N→S loop.
  // Log-spaced so we get a few tight loops near the magnet plus a couple of
  // far-reaching ones.
  const yMin = MAGNET_THK * 0.65;
  const yMax = X_RANGE * 0.85;
  for (let i = 0; i < NUM_LINES_HALF; i++) {
    const t  = (i + 0.5) / NUM_LINES_HALF;
    const sy = yMin * Math.pow(yMax / yMin, t);
    const sx = 0;     // local-frame magnet centre
    const fwd = traceDir(sx, sy, +1);
    const bwd = traceDir(sx, sy, -1);
    // Concatenate: reverse(bwd) + fwd[1..]. Both halves include the seed.
    const pts = new Array(bwd.length + fwd.length - 2);
    let w = 0;
    for (let k = bwd.length / 2 - 1; k >= 0; k--) {
      pts[w++] = bwd[k * 2];
      pts[w++] = bwd[k * 2 + 1];
    }
    for (let k = 1; k < fwd.length / 2; k++) {
      pts[w++] = fwd[k * 2];
      pts[w++] = fwd[k * 2 + 1];
    }
    writeLine(lineMeshes[i * 2],     pts, +1);
    writeLine(lineMeshes[i * 2 + 1], pts, -1);
    placeArrows(pts, +1);
    placeArrows(pts, -1);
  }

  function writeLine(mesh, flatPts, ySign) {
    const arr = mesh.geometry.attributes.position.array;
    const n = flatPts.length / 2;
    for (let k = 0; k < n; k++) {
      arr[k * 3 + 0] = flatPts[k * 2];
      arr[k * 3 + 1] = flatPts[k * 2 + 1] * ySign;
      arr[k * 3 + 2] = 0;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, n);
  }

}

const _fl = {
  dAxis: new THREE.Vector3(),
  vCam:  new THREE.Vector3(),
  up:    new THREE.Vector3(),
  out:   new THREE.Vector3(),
  mat:   new THREE.Matrix4(),
};
function updateFieldLineOrientation() {
  if (!fieldLinesGroup.visible) return;

  // Slide the whole line picture with the magnet (translation only — the
  // shape itself was traced in the magnet's local frame and is rotationally
  // symmetric about the dipole axis).
  fieldLinesGroup.position.set(state.magnetX, 0, 0);

  // World direction of the dipole axis (rotates with the magnet about Y).
  _fl.dAxis.set(Math.cos(state.magAngle), 0, Math.sin(state.magAngle));
  _fl.vCam.subVectors(camTarget, camera.position).normalize();

  // The meridional plane should contain the dipole axis and face the camera,
  // i.e. its normal should be parallel to the camera view direction. Pick
  // the in-plane "up" vector as vCam × dAxis, then "out" = dAxis × up is the
  // plane normal (≈ vCam).
  _fl.up.crossVectors(_fl.vCam, _fl.dAxis);
  if (_fl.up.lengthSq() < 1e-6) {
    // View dir parallel to dipole axis: the symmetry plane is undefined.
    // Hide rather than render edge-on.
    lineMeshes.forEach(m => m.visible = false);
    return;
  }
  lineMeshes.forEach(m => m.visible = true);
  _fl.up.normalize();
  _fl.out.crossVectors(_fl.dAxis, _fl.up).normalize();

  // Build orthonormal basis (localX → dAxis, localY → up, localZ → out).
  _fl.mat.makeBasis(_fl.dAxis, _fl.up, _fl.out);
  fieldLinesGroup.quaternion.setFromRotationMatrix(_fl.mat);
}

/* ═══════════════════════════════════════════════════════════════
   Camera orbit + magnet drag
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
  camera.up.set(0, 1, 0);
  camera.lookAt(camTarget);
}
updateCamera();

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y = 0 plane
const planeHit = new THREE.Vector3();

function ndcFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  ndc.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

function hitsMagnet(e) {
  ndcFromEvent(e);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(magnetGroup, true).length > 0;
}

function magnetXFromPointer(e) {
  ndcFromEvent(e);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return null;
  return Math.max(-X_RANGE, Math.min(X_RANGE, planeHit.x));
}

const drag = { mode: null, lx: 0, ly: 0 };
root.style.cursor = 'grab';

root.addEventListener('pointerdown', e => {
  if (hitsMagnet(e)) {
    drag.mode = 'magnet';
    state.autoPlay = false;
    document.getElementById('btn-play').classList.remove('playing');
    document.getElementById('btn-play').textContent = '▶ Start';
    const x = magnetXFromPointer(e);
    if (x !== null) state.magnetX = x;
  } else {
    drag.mode = 'orbit';
    drag.lx = e.clientX; drag.ly = e.clientY;
  }
  root.setPointerCapture(e.pointerId);
  root.style.cursor = drag.mode === 'magnet' ? 'ew-resize' : 'grabbing';
});

root.addEventListener('pointermove', e => {
  if (drag.mode === 'magnet') {
    const x = magnetXFromPointer(e);
    if (x !== null) state.magnetX = x;
  } else if (drag.mode === 'orbit') {
    const dx = e.clientX - drag.lx;
    const dy = e.clientY - drag.ly;
    drag.lx = e.clientX; drag.ly = e.clientY;
    camState.yaw -= dx * 0.008;
    const LIM = Math.PI / 2 - 0.05;
    camState.pitch = Math.max(-LIM, Math.min(LIM, camState.pitch - dy * 0.006));
    updateCamera();
  }
});

function endDrag(e) {
  if (drag.mode && e.pointerId !== undefined && root.hasPointerCapture(e.pointerId)) {
    root.releasePointerCapture(e.pointerId);
  }
  drag.mode = null;
  root.style.cursor = 'grab';
}
root.addEventListener('pointerup', endDrag);
root.addEventListener('pointerleave', endDrag);

root.addEventListener('wheel', e => {
  e.preventDefault();
  camState.radius = Math.max(0.18, Math.min(1.6, camState.radius + e.deltaY * 0.0008));
  updateCamera();
}, { passive: false });

/* ═══════════════════════════════════════════════════════════════
   Galvanometer
═══════════════════════════════════════════════════════════════ */
const galvoCanvas = document.getElementById('galvo');
const galvoCtx = galvoCanvas.getContext('2d');

function drawGalvo(emfNow) {
  const W = galvoCanvas.width, H = galvoCanvas.height;
  galvoCtx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.92;
  const R  = H * 0.78;

  // Dial background half-disc.
  galvoCtx.fillStyle = 'rgba(248,251,255,0.95)';
  galvoCtx.beginPath();
  galvoCtx.arc(cx, cy, R, Math.PI, 0, false);
  galvoCtx.lineTo(cx + R, cy);
  galvoCtx.lineTo(cx - R, cy);
  galvoCtx.closePath();
  galvoCtx.fill();

  // Tick marks. Lenz mode → ±60°, symmetric ticks. Faraday → 0..60° on the right.
  galvoCtx.strokeStyle = 'rgba(21,48,77,0.45)';
  galvoCtx.lineWidth = 1.5;
  const SWING = Math.PI / 3; // 60°
  const tickFrom = state.mode === 'lenz' ? -SWING : 0;
  const tickTo   = SWING;
  const steps = state.mode === 'lenz' ? 12 : 6;
  for (let i = 0; i <= steps; i++) {
    const a = tickFrom + (i / steps) * (tickTo - tickFrom);
    // Needle-zero is straight up. a = 0 → up; positive a → right.
    const x1 = cx + Math.sin(a) * R * 0.92;
    const y1 = cy - Math.cos(a) * R * 0.92;
    const x2 = cx + Math.sin(a) * R * 0.78;
    const y2 = cy - Math.cos(a) * R * 0.78;
    galvoCtx.beginPath();
    galvoCtx.moveTo(x1, y1); galvoCtx.lineTo(x2, y2);
    galvoCtx.stroke();
  }

  // Centre line / "0".
  galvoCtx.fillStyle = '#55708d';
  galvoCtx.font = '10px "Trebuchet MS", sans-serif';
  galvoCtx.textAlign = 'center';
  galvoCtx.textBaseline = 'middle';
  galvoCtx.fillText('0', cx, cy - R * 0.62);
  if (state.mode === 'lenz') {
    galvoCtx.fillText('−', cx - R * 0.78, cy - R * 0.30);
    galvoCtx.fillText('+', cx + R * 0.78, cy - R * 0.30);
  } else {
    galvoCtx.fillText('|ε|', cx + R * 0.78, cy - R * 0.30);
  }

  // Needle. Map EMF → angle. Use a soft non-linear map so small currents are
  // visible, but big spikes don't peg permanently.
  const SCALE_REF = 0.004;     // 4 mV → near full deflection
  const e = state.mode === 'lenz' ? emfNow : Math.abs(emfNow);
  const norm = Math.tanh(e / SCALE_REF);
  const angle = norm * SWING;

  galvoCtx.strokeStyle = '#dc2626';
  galvoCtx.lineWidth = 2.5;
  galvoCtx.beginPath();
  galvoCtx.moveTo(cx, cy);
  galvoCtx.lineTo(cx + Math.sin(angle) * R * 0.85, cy - Math.cos(angle) * R * 0.85);
  galvoCtx.stroke();

  // Pivot.
  galvoCtx.fillStyle = '#15304d';
  galvoCtx.beginPath();
  galvoCtx.arc(cx, cy, 4, 0, Math.PI * 2);
  galvoCtx.fill();
}

/* ═══════════════════════════════════════════════════════════════
   Time-series graphs
═══════════════════════════════════════════════════════════════ */
const phiCanvas = document.getElementById('phi-graph');
const phiCtx = phiCanvas.getContext('2d');
const emfCanvas = document.getElementById('emf-graph');
const emfCtx = emfCanvas.getContext('2d');

function drawTrace(ctx, canvas, buf, color, signed, fixedMax) {
  const W = canvas.width, H = canvas.height;
  const padL = 32, padR = 8, padT = 8, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(padL, padT, plotW, plotH);

  // Y range
  let yMax = fixedMax;
  if (!yMax) {
    let m = 1e-12;
    for (const p of buf) { const v = signed ? Math.abs(p.v) : Math.abs(p.v); if (v > m) m = v; }
    yMax = m * 1.25;
  }
  const yMin = signed ? -yMax : 0;

  // Zero line (or baseline).
  ctx.strokeStyle = 'rgba(21,48,77,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const yZero = padT + plotH * (1 - (0 - yMin) / (yMax - yMin));
  ctx.moveTo(padL, yZero); ctx.lineTo(padL + plotW, yZero);
  ctx.stroke();

  // Y labels (just min/max + zero).
  ctx.fillStyle = '#55708d';
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatY(yMax),     padL - 3, padT);
  ctx.fillText('0',               padL - 3, yZero);
  if (signed) ctx.fillText(formatY(-yMax), padL - 3, padT + plotH);
  else        ctx.fillText('',    padL - 3, padT + plotH);

  // Time axis label.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('−' + TIME_WINDOW.toFixed(0) + ' s', padL,            padT + plotH + 2);
  ctx.fillText('now',                                padL + plotW,    padT + plotH + 2);

  // Polyline.
  if (buf.length > 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let first = true;
    for (const p of buf) {
      const tFrac = (p.t - (state.tNow - TIME_WINDOW)) / TIME_WINDOW;
      if (tFrac < 0 || tFrac > 1) continue;
      const v = signed ? p.v : Math.abs(p.v);
      const x = padL + plotW * tFrac;
      const y = padT + plotH * (1 - (v - yMin) / (yMax - yMin));
      if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }
}

function formatY(v) {
  const a = Math.abs(v);
  if (a >= 1)     return v.toFixed(2);
  if (a >= 1e-3)  return (v * 1e3).toFixed(1) + 'm';
  if (a >= 1e-6)  return (v * 1e6).toFixed(1) + 'µ';
  return v.toExponential(1);
}

/* ═══════════════════════════════════════════════════════════════
   Readouts
═══════════════════════════════════════════════════════════════ */
function fmtPhi(p) {
  const a = Math.abs(p);
  if (a < 1e-9) return '0 Wb';
  if (a < 1e-6) return (p * 1e9).toFixed(1) + ' nWb';
  if (a < 1e-3) return (p * 1e6).toFixed(2) + ' µWb';
  return (p * 1e3).toFixed(2) + ' mWb';
}
function fmtEmf(e) {
  const a = Math.abs(e);
  if (a < 1e-6) return (e * 1e6).toFixed(2) + ' µV';
  if (a < 1e-3) return (e * 1e3).toFixed(2) + ' mV';
  return e.toFixed(3) + ' V';
}

function updateReadout(phi, e) {
  document.getElementById('rd-x').textContent   = (state.magnetX * 100).toFixed(1) + ' cm';
  document.getElementById('rd-phi').textContent = state.mode === 'lenz' ? fmtPhi(phi) : fmtPhi(Math.abs(phi));
  document.getElementById('rd-emf').textContent = state.mode === 'lenz' ? fmtEmf(e)   : fmtEmf(Math.abs(e));
}

/* ═══════════════════════════════════════════════════════════════
   UI wiring
═══════════════════════════════════════════════════════════════ */
function setActive(groupSel, btn) {
  document.querySelectorAll(`${groupSel} .seg-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.querySelectorAll('#seg-mode .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.val;
    setActive('#seg-mode', btn);
  });
});

document.querySelectorAll('#seg-pol .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.val === 'ns' ? +1 : -1;
    setActive('#seg-pol', btn);
    startFlipTo(target);
  });
});

function wireSlider(id, valId, onChange, digits = 2) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  function fmt(v) { return digits === 0 ? Math.round(v).toString() : v.toFixed(digits); }
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.value = fmt(v);
    onChange(v);
  });
  vl.addEventListener('change', () => {
    let v = parseFloat(vl.value);
    if (isNaN(v)) { vl.value = fmt(parseFloat(el.value)); return; }
    const min = parseFloat(el.min), max = parseFloat(el.max);
    v = Math.max(min, Math.min(max, v));
    el.value = v;
    v = parseFloat(el.value);
    vl.value = fmt(v);
    onChange(v);
  });
}
wireSlider('slider-strength', 'val-strength', v => { state.strength = v; }, 2);
wireSlider('slider-turns',    'val-turns',    v => { state.N = Math.round(v); buildCoil(); }, 0);
wireSlider('slider-speed',    'val-speed',    v => { state.autoSpeed = v; }, 2);

// Trace once: line shape is fixed in the magnet's local frame; world position
// and orientation come from the fieldLinesGroup transform updated each frame.
traceFieldLines();

document.getElementById('btn-flines').addEventListener('click', () => {
  state.showFieldLines = !state.showFieldLines;
  const btn = document.getElementById('btn-flines');
  btn.classList.toggle('active', state.showFieldLines);
  fieldLinesGroup.visible = state.showFieldLines;
});

document.getElementById('btn-play').addEventListener('click', () => {
  state.autoPlay = !state.autoPlay;
  const btn = document.getElementById('btn-play');
  btn.classList.toggle('playing', state.autoPlay);
  btn.textContent = state.autoPlay ? '■ Pause' : '▶ Start';
});
document.getElementById('btn-reset').addEventListener('click', () => {
  state.magnetX = +0.20;
  state.prevMagnetX = state.magnetX;
  state.velocity = 0; state.velSmoothed = 0;
  state.autoDir = -1;
  state.autoPlay = false;
  state.magAngle = 0; state.dMagAngleDt = 0;
  state.flip.active = false;
  document.querySelectorAll('#seg-pol .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  state.phiBuf.length = 0; state.emfBuf.length = 0;
  state.tNow = 0;
  const btn = document.getElementById('btn-play');
  btn.classList.remove('playing');
  btn.textContent = '▶ Start';
});

/* ═══════════════════════════════════════════════════════════════
   Render loop
═══════════════════════════════════════════════════════════════ */
function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;
  if (w < 2 || h < 2) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);

let lastT = performance.now();
function loop(tMs) {
  const dt = Math.min(0.05, Math.max(0.001, (tMs - lastT) / 1000));
  lastT = tMs;
  state.tNow += dt;

  // Auto-sweep moves the magnet at constant speed, bouncing at the limits.
  if (state.autoPlay) {
    state.magnetX += state.autoDir * state.autoSpeed * dt;
    if (state.magnetX >  X_RANGE) { state.magnetX =  X_RANGE; state.autoDir = -1; }
    if (state.magnetX < -X_RANGE) { state.magnetX = -X_RANGE; state.autoDir = +1; }
  }

  // Advance any in-flight polarity-flip animation; this also sets dMagAngleDt
  // which is what gives the EMF its spike during a flip.
  tickFlip();

  // Velocity from finite difference + light smoothing so the EMF trace isn't
  // visually noisy when the user drags by hand.
  const v = (state.magnetX - state.prevMagnetX) / dt;
  state.velocity = v;
  state.velSmoothed = state.velSmoothed * 0.65 + v * 0.35;
  state.prevMagnetX = state.magnetX;

  const phi = fluxPerTurn(state.magnetX);
  const e   = emf(state.magnetX, state.velSmoothed, state.dMagAngleDt);

  // Push to rolling buffers and trim.
  state.phiBuf.push({ t: state.tNow, v: phi });
  state.emfBuf.push({ t: state.tNow, v: e });
  const cutoff = state.tNow - TIME_WINDOW - 0.2;
  while (state.phiBuf.length && state.phiBuf[0].t < cutoff) state.phiBuf.shift();
  while (state.emfBuf.length && state.emfBuf[0].t < cutoff) state.emfBuf.shift();

  // Sync 3D scene.
  syncMagnetTransform();
  updateInducedArrow(e, dt);
  if (state.showFieldLines) {
    updateFieldLineOrientation();
  }

  // Sync 2D widgets.
  drawGalvo(e);
  // Φ y-scale: fixed at the analytical max for the current strength so the
  // shape is comparable across runs. Max occurs at x = 0.
  const phiMax = (MU0 * state.strength / 2) / state.R;
  drawTrace(phiCtx, phiCanvas, state.phiBuf, '#0d9488',
            state.mode === 'lenz', phiMax * 1.1);
  drawTrace(emfCtx, emfCanvas, state.emfBuf, '#dc2626',
            state.mode === 'lenz', null);
  updateReadout(phi, e);

  resize();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
