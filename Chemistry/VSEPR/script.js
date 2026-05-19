// ---- 1. State ----

const state = {
  mode: 'single',  // 'single' or 'multi'
  centralElement: 'C',
  selectedTerminal: 'H',
  selectedBondOrder: 1,
  domains: [],
  domainNodes: [],   // parallel to domains: { group: THREE.Group } per domain
  simulating: false,
  simSteps: 0,
  pinnedDomainIndex: -1,  // index of domain being click-dragged; -1 when none
  multi: null,     // populated by loadMultiPreset
  lastTimestamp: null,
};

// ---- 2. Controls ----

const controls = {
  root:             document.getElementById('three-root'),
  btnFront:         document.getElementById('btn-front'),
  btnTop:           document.getElementById('btn-top'),
  btnIsometric:     document.getElementById('btn-isometric'),
  btnPrincipal:     document.getElementById('btn-principal'),
  btnAddBond:       document.getElementById('btn-add-bond'),
  btnAddLP:         document.getElementById('btn-add-lp'),
  btnRemoveLast:    document.getElementById('btn-remove-last'),
  btnClear:         document.getElementById('btn-clear'),
  domainCount:      document.getElementById('domain-count'),
  readoutAtom:      document.getElementById('readout-atom'),
  readoutDomains:   document.getElementById('readout-domains'),
  readoutMaxAngle:  document.getElementById('readout-max-angle'),
  readoutMinAngle:  document.getElementById('readout-min-angle'),
  readoutAnglesCard: document.getElementById('readout-angles-card'),
  readoutAnglesList: document.getElementById('readout-angles-list'),
  centralAtomGrid:  document.getElementById('central-atom-grid'),
  terminalAtomGrid: document.getElementById('terminal-atom-grid'),
  valenceNote:      document.getElementById('valence-note'),
  presetSelect:     document.getElementById('preset-select'),
  btnShuffle:       document.getElementById('btn-shuffle'),
  builderSection:   document.getElementById('builder-section'),
  bondOrderChips:   Array.from(document.querySelectorAll('[data-order]')),
};

// ---- 3. Constants ----

const CPK = {
  H:  0xeeeeee,
  C:  0x2b2b2b,
  N:  0x3050f8,
  O:  0xff0d0d,
  F:  0x90e050,
  Cl: 0x1ff01f,
  Br: 0xa62929,
  I:  0x940094,
  S:  0xffff30,
  P:  0xff8000,
  Xe: 0x429eb0,
  B:  0xffb5b5,
  Si: 0xf0c8a0,
  _:  0x888888,
};

const DOMAIN_WEIGHT = {
  lone_pair: 1.3,
  bond1:     1.0,
  bond2:     1.3,
  bond3:     1.5,
};

// Common bonding-capacity (sum of bond orders) for each element when it sits
// as the central atom. Used purely as an advisory; nothing is blocked.
const TYPICAL_VALENCES = {
  H:  [1],
  B:  [3],
  C:  [4],
  N:  [3, 4],
  O:  [2],
  F:  [1],
  Si: [4],
  P:  [3, 5],
  S:  [2, 4, 6],
  Cl: [1, 3, 5, 7],
  Br: [1, 3, 5, 7],
  I:  [1, 3, 5, 7],
  Xe: [0, 2, 4, 6, 8],
};

const BOND_DISTANCE   = 2.0;
const CENTRAL_RADIUS  = 0.5;
const TERMINAL_RADIUS = 0.35;
const LP_DISTANCE     = 1.5;
const BOND_COLOR      = 0x999999;
const LP_COLOR        = 0xb8a0e8;

// Physics
const REPULSION_POWER   = 3;
const DAMPING           = 0.85;
const PHYS_DT           = 0.05;
const PHYS_STEPS_MAX    = 600;
const PHYS_EPSILON      = 1e-4;
const CHORD_FLOOR       = 0.1;
const INIT_PERTURBATION = 0.35;
const PHYS_STEPS_PER_FRAME = 2;  // 2 substeps/frame -> ~1s visible relax @60fps

const Y_UP = new THREE.Vector3(0, 1, 0);

// ---- 4. Three.js setup ----

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8cce2);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
const cameraTarget = new THREE.Vector3(0, 0, 0);
const cameraState = { radius: 8, yaw: Math.PI / 4, pitch: Math.PI / 6 };
const interactionState = { dragging: false, lastX: 0, lastY: 0 };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
controls.root.appendChild(renderer.domElement);

const moleculeGroup = new THREE.Group();
scene.add(moleculeGroup);

const ambient = new THREE.HemisphereLight(0xf8fbff, 0x9fb8d9, 0.55);
scene.add(ambient);
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
sunLight.position.set(8, 10, 6);
scene.add(sunLight);
const fillLight = new THREE.DirectionalLight(0xcce8ff, 0.45);
fillLight.position.set(-6, -4, -8);
scene.add(fillLight);

// ---- 5. Helpers ----

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isLightColor(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 128;
}

function makeLabel(text, hex) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const fontSize = text.length > 1 ? size * 0.38 : size * 0.52;
  ctx.font = `bold ${fontSize}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const light = isLightColor(hex);
  ctx.strokeStyle = light ? '#333' : '#fff';
  ctx.lineWidth = 9;
  ctx.strokeText(text, size / 2, size / 2);
  ctx.fillStyle = light ? '#111' : '#eee';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 1;
  sprite.scale.set(0.65, 0.65, 1);
  return sprite;
}

function makeDomain(type, bondOrder, terminalElement, direction) {
  return {
    type,
    bondOrder: bondOrder || 1,
    terminalElement: terminalElement || null,
    direction: direction.clone().normalize(),
    velocity: new THREE.Vector3(),
  };
}

function domainWeight(domain) {
  if (domain.type === 'lone_pair') return DOMAIN_WEIGHT.lone_pair;
  return DOMAIN_WEIGHT[`bond${domain.bondOrder}`] ?? 1.0;
}

function randomUnitVector() {
  while (true) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const ls = x * x + y * y + z * z;
    if (ls > 0.001 && ls <= 1) {
      const l = Math.sqrt(ls);
      return new THREE.Vector3(x / l, y / l, z / l);
    }
  }
}

// Idealised vertex sets per domain count. Position order matters:
//   - TBP (5): equatorial first, axial last. Heaviest-first assignment puts
//     LPs at equatorial positions (correct for SF4, ClF3, XeF2).
//   - Octahedral (6): trans pairs adjacent. Heaviest-first assignment puts
//     pairs of LPs at trans vertices (correct for XeF4).
const IDEAL_VERTICES = {
  2: [[0, 0, 1], [0, 0, -1]],
  3: [[1, 0, 0], [-0.5, 0.8660254, 0], [-0.5, -0.8660254, 0]],
  4: (() => {
    const s = 1 / Math.sqrt(3);
    return [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]];
  })(),
  5: [
    [1, 0, 0], [-0.5, 0.8660254, 0], [-0.5, -0.8660254, 0], // 3 equatorial
    [0, 0, 1], [0, 0, -1],                                  // 2 axial
  ],
  6: [
    [0, 0, 1], [0, 0, -1],
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
  ],
};

function specWeight(spec) {
  const [type, order] = spec;
  if (type === 'lone_pair') return DOMAIN_WEIGHT.lone_pair;
  return DOMAIN_WEIGHT[`bond${order}`] ?? 1.0;
}

// Returns an array of THREE.Vector3 initial directions parallel to specs[],
// using an idealised arrangement with heaviest domain at IDEAL_VERTICES[0].
// Adds tangential noise so students see relaxation, and a random global
// rotation so the same preset looks different each load.
function smartInitDirections(specs) {
  const n = specs.length;
  const ideal = IDEAL_VERTICES[n];
  if (!ideal) {
    return specs.map(() => randomUnitVector());
  }
  const order = specs.map((s, i) => ({ i, w: specWeight(s) }))
                     .sort((a, b) => b.w - a.w);
  const dirs = new Array(n);
  for (let k = 0; k < n; k++) {
    const base = ideal[k];
    const v = new THREE.Vector3(
      base[0] + (Math.random() - 0.5) * INIT_PERTURBATION,
      base[1] + (Math.random() - 0.5) * INIT_PERTURBATION,
      base[2] + (Math.random() - 0.5) * INIT_PERTURBATION,
    ).normalize();
    dirs[order[k].i] = v;
  }
  // Orient the molecule so lone pairs land near the top of the view.
  // Use the LP centroid; if LPs cancel out (trans pair, equatorial triplet)
  // fall back to the first LP's direction. No LPs => keep arbitrary orientation.
  const lpIdx = [];
  for (let i = 0; i < n; i++) if (specs[i][0] === 'lone_pair') lpIdx.push(i);

  const up = new THREE.Vector3(0, 1, 0);
  let upRef = null;
  if (lpIdx.length > 0) {
    const sum = new THREE.Vector3();
    lpIdx.forEach(i => sum.add(dirs[i]));
    upRef = sum.lengthSq() > 0.05 ? sum.normalize() : dirs[lpIdx[0]].clone();
  } else {
    // No LPs: random orientation so it doesn't always face the same way.
    upRef = randomUnitVector();
  }
  const qAlign = new THREE.Quaternion().setFromUnitVectors(upRef, up);
  for (const d of dirs) d.applyQuaternion(qAlign);

  // Small random rotation around +Y for variety between loads.
  const qSpin = new THREE.Quaternion().setFromAxisAngle(up, Math.random() * Math.PI * 2);
  for (const d of dirs) d.applyQuaternion(qSpin);

  return dirs;
}

// ---- 6. Object construction ----

function makeBondCylinder(radius, offsetX, offsetZ) {
  const geo = new THREE.CylinderGeometry(radius, radius, BOND_DISTANCE, 12, 1);
  const mat = new THREE.MeshStandardMaterial({ color: BOND_COLOR, roughness: 0.7, metalness: 0.0 });
  const cyl = new THREE.Mesh(geo, mat);
  cyl.position.set(offsetX || 0, BOND_DISTANCE / 2, offsetZ || 0);
  return cyl;
}

function makeLonePairLobe() {
  // Control points for the silhouette (x = radius, y = height along the lobe
  // axis). Catmull-Rom smoothing through these gives a clean teardrop with no
  // visible faceting on the silhouette.
  const ctrl = [
    [0,    0   ],
    [0.08, 0.16],
    [0.20, 0.36],
    [0.30, 0.58],
    [0.34, 0.78],
    [0.30, 0.96],
    [0.18, 1.15],
    [0.06, 1.28],
    [0,    1.35],
  ];
  const yScale = LP_DISTANCE / 1.35;
  const controls2D = ctrl.map(([x, y]) => new THREE.Vector2(x, y * yScale));
  const spline = new THREE.SplineCurve(controls2D);
  const profile = spline.getPoints(64);
  const geo = new THREE.LatheGeometry(profile, 40);
  const mat = new THREE.MeshStandardMaterial({
    color: LP_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.35,
    emissive: LP_COLOR,
    emissiveIntensity: 0.18,
  });
  return new THREE.Mesh(geo, mat);
}

function createDomainNode(domain) {
  // Returns a THREE.Group whose local +Y is the domain direction.
  // Animation just rotates this group's quaternion each frame.
  const group = new THREE.Group();

  if (domain.type === 'bond') {
    const order = domain.bondOrder;
    if (order === 1) {
      group.add(makeBondCylinder(0.06, 0, 0));
    } else if (order === 2) {
      const off = 0.10;
      group.add(makeBondCylinder(0.045,  off, 0));
      group.add(makeBondCylinder(0.045, -off, 0));
    } else {
      const r = 0.12;
      for (let k = 0; k < 3; k++) {
        const a = k * (Math.PI * 2 / 3);
        group.add(makeBondCylinder(0.035, r * Math.cos(a), r * Math.sin(a)));
      }
    }

    const color = CPK[domain.terminalElement] ?? CPK._;
    const sphereGeo = new THREE.SphereGeometry(TERMINAL_RADIUS, 28, 20);
    const sphereMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.1 });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(0, BOND_DISTANCE, 0);
    sphere.userData.clickable = true;
    group.add(sphere);

    const label = makeLabel(domain.terminalElement, color);
    label.position.set(0, BOND_DISTANCE, 0);
    group.add(label);
  } else {
    const lobe = makeLonePairLobe();
    lobe.userData.clickable = true;
    group.add(lobe);
  }

  return group;
}

function disposeNode(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
  moleculeGroup.remove(group);
}

let centralAtomMesh = null;
let centralAtomLabel = null;

function buildCentralAtom() {
  if (centralAtomMesh) {
    moleculeGroup.remove(centralAtomMesh);
    centralAtomMesh.geometry.dispose();
    centralAtomMesh.material.dispose();
  }
  if (centralAtomLabel) {
    moleculeGroup.remove(centralAtomLabel);
    if (centralAtomLabel.material.map) centralAtomLabel.material.map.dispose();
    centralAtomLabel.material.dispose();
  }
  const color = CPK[state.centralElement] ?? CPK._;
  const geo = new THREE.SphereGeometry(CENTRAL_RADIUS, 32, 24);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  centralAtomMesh = new THREE.Mesh(geo, mat);
  moleculeGroup.add(centralAtomMesh);
  centralAtomLabel = makeLabel(state.centralElement, color);
  moleculeGroup.add(centralAtomLabel);
}

function renderMolecule() {
  // Dispose previous nodes.
  state.domainNodes.forEach(disposeNode);
  state.domainNodes = [];
  // Build new nodes.
  state.domains.forEach((domain) => {
    const group = createDomainNode(domain);
    moleculeGroup.add(group);
    state.domainNodes.push(group);
  });
  updateDomainTransforms();
}

function updateDomainTransforms() {
  for (let i = 0; i < state.domains.length; i++) {
    const dir = state.domains[i].direction;
    state.domainNodes[i].quaternion.setFromUnitVectors(Y_UP, dir);
  }
}

// ---- 7. Physics ----

function runPhysicsStep() {
  const n = state.domains.length;
  if (n < 2) return 0;

  const forces = [];
  for (let i = 0; i < n; i++) forces.push(new THREE.Vector3());

  for (let i = 0; i < n; i++) {
    const di = state.domains[i];
    const wi = domainWeight(di);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dj = state.domains[j];
      const wj = domainWeight(dj);
      const chord = new THREE.Vector3().subVectors(di.direction, dj.direction);
      let r = chord.length();
      if (r < 1e-6) {
        chord.copy(randomUnitVector()).multiplyScalar(0.001);
        r = 1;
      }
      const rEff = Math.max(r, CHORD_FLOOR);
      const fmag = (wi * wj) / Math.pow(rEff, REPULSION_POWER);
      forces[i].addScaledVector(chord, fmag / r);
    }
  }

  let maxVel = 0;
  for (let i = 0; i < n; i++) {
    if (i === state.pinnedDomainIndex) continue;  // held by user's mouse
    const d = state.domains[i];
    const dotFD = forces[i].dot(d.direction);
    forces[i].addScaledVector(d.direction, -dotFD);
    d.velocity.multiplyScalar(DAMPING).addScaledVector(forces[i], PHYS_DT);
    d.direction.addScaledVector(d.velocity, PHYS_DT).normalize();
    const v = d.velocity.length();
    if (v > maxVel) maxVel = v;
  }
  return maxVel;
}

function startSimulation(reseedRandom) {
  if (reseedRandom) {
    state.domains.forEach((d) => {
      d.direction.copy(randomUnitVector());
      d.velocity.set(0, 0, 0);
    });
  } else {
    state.domains.forEach((d) => d.velocity.set(0, 0, 0));
  }
  state.simulating = true;
  state.simSteps = 0;
}

function logAngles(name) {
  const dirs = state.domains.map(d => d.direction);
  const angles = [];
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const dot = clamp(dirs[i].dot(dirs[j]), -1, 1);
      const ti = state.domains[i].type === 'bond' ? 'B' : 'L';
      const tj = state.domains[j].type === 'bond' ? 'B' : 'L';
      angles.push({ ti, tj, angle: Math.acos(dot) * 180 / Math.PI });
    }
  }
  const bb = angles.filter(a => a.ti === 'B' && a.tj === 'B').map(a => a.angle.toFixed(1));
  const lb = angles.filter(a => (a.ti === 'B') !== (a.tj === 'B')).map(a => a.angle.toFixed(1));
  const ll = angles.filter(a => a.ti === 'L' && a.tj === 'L').map(a => a.angle.toFixed(1));
  console.log(`[${name}]  B-B: [${bb.join(', ')}]  B-LP: [${lb.join(', ')}]  LP-LP: [${ll.join(', ')}]`);
}

// ---- 8. Mode / UI functions ----

function updateCamera() {
  const safePitch = clamp(cameraState.pitch, -1.15, 1.15);
  const radius = clamp(cameraState.radius, 3, 20);
  camera.position.set(
    cameraTarget.x + radius * Math.cos(safePitch) * Math.sin(cameraState.yaw),
    cameraTarget.y + radius * Math.sin(safePitch),
    cameraTarget.z + radius * Math.cos(safePitch) * Math.cos(cameraState.yaw)
  );
  camera.lookAt(cameraTarget);
}

const CAMERA_PRESETS = {
  front:     { yaw: 0,           pitch: 0 },
  top:       { yaw: 0,           pitch: 1.1 },
  isometric: { yaw: Math.PI / 4, pitch: Math.PI / 6 },
};

const cameraAnim = { active: false, fromYaw: 0, fromPitch: 0, toYaw: 0, toPitch: 0, t: 0 };

function setCameraPreset(yaw, pitch) {
  cameraAnim.fromYaw   = cameraState.yaw;
  cameraAnim.fromPitch = cameraState.pitch;
  cameraAnim.toYaw     = yaw;
  cameraAnim.toPitch   = pitch;
  cameraAnim.t         = 0;
  cameraAnim.active    = true;
}

function stepCameraAnim(delta) {
  if (!cameraAnim.active) return;
  cameraAnim.t = Math.min(1, cameraAnim.t + delta / 0.4);
  const ease = 1 - Math.pow(1 - cameraAnim.t, 3);
  cameraState.yaw   = cameraAnim.fromYaw   + (cameraAnim.toYaw   - cameraAnim.fromYaw)   * ease;
  cameraState.pitch = cameraAnim.fromPitch + (cameraAnim.toPitch - cameraAnim.fromPitch) * ease;
  if (cameraAnim.t >= 1) cameraAnim.active = false;
  updateCamera();
}

function updateAngleReadouts() {
  const bondDirs = state.domains.filter(d => d.type === 'bond').map(d => d.direction);
  if (bondDirs.length < 2) {
    controls.readoutMaxAngle.textContent = '—';
    controls.readoutMinAngle.textContent = '—';
    return;
  }
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  for (let i = 0; i < bondDirs.length; i++) {
    for (let j = i + 1; j < bondDirs.length; j++) {
      const dot = clamp(bondDirs[i].dot(bondDirs[j]), -1, 1);
      const angle = Math.acos(dot) * 180 / Math.PI;
      if (angle < minAngle) minAngle = angle;
      if (angle > maxAngle) maxAngle = angle;
    }
  }
  controls.readoutMaxAngle.textContent = `${maxAngle.toFixed(1)}°`;
  controls.readoutMinAngle.textContent = `${minAngle.toFixed(1)}°`;
}

function valenceAdvisory() {
  const valence = state.domains
    .filter(d => d.type === 'bond')
    .reduce((sum, d) => sum + d.bondOrder, 0);
  if (valence === 0) return '';
  const typical = TYPICAL_VALENCES[state.centralElement];
  if (!typical || typical.includes(valence)) return '';
  const fmt = typical.length === 1
    ? `${typical[0]}`
    : typical.slice(0, -1).join(', ') + ` or ${typical[typical.length - 1]}`;
  const noun = (typical.length === 1 && typical[0] === 1) ? 'bond' : 'bonds';
  return `${state.centralElement} usually forms ${fmt} ${noun} (here: ${valence}).`;
}

function updateReadouts() {
  controls.readoutAtom.textContent = state.centralElement;
  const bonds = state.domains.filter(d => d.type === 'bond');
  const lps   = state.domains.filter(d => d.type === 'lone_pair');
  if (bonds.length === 0 && lps.length === 0) {
    controls.readoutDomains.textContent = 'None';
  } else {
    const bondStr = bonds.length ? `${bonds.length} bond${bonds.length !== 1 ? 's' : ''}` : '';
    const lpStr   = lps.length   ? `${lps.length} lone pair${lps.length !== 1 ? 's' : ''}` : '';
    controls.readoutDomains.textContent = [bondStr, lpStr].filter(Boolean).join(', ');
  }
  controls.domainCount.textContent = String(state.domains.length);
  controls.btnAddBond.disabled = state.domains.length >= 6;
  controls.btnAddLP.disabled   = state.domains.length >= 6;
  controls.valenceNote.textContent = valenceAdvisory();
  updateAngleReadouts();
}

// ---- Presets ----

const PRESETS = {
  CO2:  { central: 'C',  domains: [['bond', 2, 'O'], ['bond', 2, 'O']] },
  BF3:  { central: 'B',  domains: [['bond', 1, 'F'], ['bond', 1, 'F'], ['bond', 1, 'F']] },
  CH4:  { central: 'C',  domains: Array(4).fill(['bond', 1, 'H']) },
  NH3:  { central: 'N',  domains: [['bond', 1, 'H'], ['bond', 1, 'H'], ['bond', 1, 'H'], ['lone_pair']] },
  H2O:  { central: 'O',  domains: [['bond', 1, 'H'], ['bond', 1, 'H'], ['lone_pair'], ['lone_pair']] },
  PCl5: { central: 'P',  domains: Array(5).fill(['bond', 1, 'Cl']) },
  SF4:  { central: 'S',  domains: [...Array(4).fill(['bond', 1, 'F']), ['lone_pair']] },
  ClF3: { central: 'Cl', domains: [...Array(3).fill(['bond', 1, 'F']), ['lone_pair'], ['lone_pair']] },
  XeF2: { central: 'Xe', domains: [['bond', 1, 'F'], ['bond', 1, 'F'], ['lone_pair'], ['lone_pair'], ['lone_pair']] },
  SF6:  { central: 'S',  domains: Array(6).fill(['bond', 1, 'F']) },
  BrF5: { central: 'Br', domains: [...Array(5).fill(['bond', 1, 'F']), ['lone_pair']] },
  XeF4: { central: 'Xe', domains: [...Array(4).fill(['bond', 1, 'F']), ['lone_pair'], ['lone_pair']] },
};

let currentPresetName = null;

function loadPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  if (state.mode === 'multi') {
    disposeMultiMolecule();
    state.mode = 'single';
  }
  currentPresetName = name;
  state.centralElement = preset.central;
  const initDirs = smartInitDirections(preset.domains);
  state.domains = preset.domains.map(([type, order, term], i) =>
    makeDomain(type, order, term, initDirs[i])
  );
  buildCentralAtom();
  renderMolecule();
  startSimulation(false);
  updateReadouts();
  syncBuilderChips();
  controls.presetSelect.value = name;
  updateBuilderVisibility();
}

// ---- Custom builder ----

function updateBuilderVisibility() {
  const isCustom = controls.presetSelect.value === '';
  controls.builderSection.style.display = isCustom ? '' : 'none';
  if (isCustom) controls.builderSection.open = true;
}

function clearPresetHighlight() {
  currentPresetName = null;
  controls.presetSelect.value = '';
  updateBuilderVisibility();
}

function syncBuilderChips() {
  controls.centralAtomGrid.querySelectorAll('[data-central]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.central === state.centralElement);
  });
  controls.terminalAtomGrid.querySelectorAll('[data-terminal]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.terminal === state.selectedTerminal);
  });
  controls.bondOrderChips.forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.order) === state.selectedBondOrder);
  });
}

// Returns a unit vector that maximises the minimum chord-distance to all
// existing domain directions, so a new domain "slots into" an open spot.
function findOpenDirection() {
  if (state.domains.length === 0) return new THREE.Vector3(0, 1, 0);
  let best = null;
  let bestScore = -1;
  for (let k = 0; k < 80; k++) {
    const candidate = randomUnitVector();
    let minDist = Infinity;
    for (const d of state.domains) {
      const dist = candidate.distanceTo(d.direction);
      if (dist < minDist) minDist = dist;
    }
    if (minDist > bestScore) {
      bestScore = minDist;
      best = candidate;
    }
  }
  return best;
}

function relaxFromCurrent() {
  state.domains.forEach((d) => d.velocity.set(0, 0, 0));
  state.simulating = true;
  state.simSteps = 0;
}

function setCentralElement(elem) {
  state.centralElement = elem;
  state.domains = [];
  clearPresetHighlight();
  buildCentralAtom();
  renderMolecule();
  updateReadouts();
  syncBuilderChips();
}

function addBondDomain() {
  if (state.domains.length >= 6) return;
  const dir = findOpenDirection();
  const domain = makeDomain('bond', state.selectedBondOrder, state.selectedTerminal, dir);
  state.domains.push(domain);
  clearPresetHighlight();
  renderMolecule();
  relaxFromCurrent();
  updateReadouts();
}

function addLonePairDomain() {
  if (state.domains.length >= 6) return;
  const dir = findOpenDirection();
  const domain = makeDomain('lone_pair', 1, null, dir);
  state.domains.push(domain);
  clearPresetHighlight();
  renderMolecule();
  relaxFromCurrent();
  updateReadouts();
}

function removeLastDomain() {
  if (state.domains.length === 0) return;
  state.domains.pop();
  clearPresetHighlight();
  renderMolecule();
  relaxFromCurrent();
  updateReadouts();
}

function clearAllDomains() {
  if (state.domains.length === 0) return;
  state.domains = [];
  clearPresetHighlight();
  renderMolecule();
  updateReadouts();
}

// ---- 8b. Multi-centre molecules ----

// Each preset declares its atoms, bonds (with order), and per-atom LP counts.
// No customisation: presets are read-only structures.
const MULTI_PRESETS = {
  ethane: {
    label: 'C2H6',
    atoms: ['C', 'C', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [
      [0, 1, 1],
      [0, 2, 1], [0, 3, 1], [0, 4, 1],
      [1, 5, 1], [1, 6, 1], [1, 7, 1],
    ],
    lps: {},
  },
  ethene: {
    label: 'C2H4',
    atoms: ['C', 'C', 'H', 'H', 'H', 'H'],
    bonds: [
      [0, 1, 2],
      [0, 2, 1], [0, 3, 1],
      [1, 4, 1], [1, 5, 1],
    ],
    lps: {},
  },
  ethyne: {
    label: 'C2H2',
    atoms: ['C', 'C', 'H', 'H'],
    bonds: [
      [0, 1, 3],
      [0, 2, 1],
      [1, 3, 1],
    ],
    lps: {},
  },
  propane: {
    label: 'C3H8',
    atoms: ['C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [
      [0, 1, 1], [1, 2, 1],
      [0, 3, 1], [0, 4, 1], [0, 5, 1],
      [1, 6, 1], [1, 7, 1],
      [2, 8, 1], [2, 9, 1], [2, 10, 1],
    ],
    lps: {},
  },
};

// Bond lengths in scene units. Picked to give visually balanced multi-atom
// molecules at the existing camera radius.
const BOND_LENGTHS = {
  'C-H-1': 1.20, 'O-H-1': 1.05, 'N-H-1': 1.10,
  'C-C-1': 1.70, 'C-C-2': 1.55, 'C-C-3': 1.45,
  'C-O-1': 1.55, 'C-N-1': 1.55,
};

function bondLengthFor(elemA, elemB, order) {
  return BOND_LENGTHS[`${elemA}-${elemB}-${order}`]
      ?? BOND_LENGTHS[`${elemB}-${elemA}-${order}`]
      ?? 1.4;
}

const MULTI_HEAVY_RADIUS = 0.42;
const MULTI_TIP_RADIUS   = 0.30;
const MULTI_LP_DISTANCE  = 1.05;

const multiGroup = new THREE.Group();
scene.add(multiGroup);

function disposeMultiMolecule() {
  if (!state.multi) return;
  multiGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
  while (multiGroup.children.length) multiGroup.remove(multiGroup.children[0]);
  state.multi = null;
}

// Build atom records + tree + initial domain directions for a multi preset.
function loadMultiPreset(name) {
  const preset = MULTI_PRESETS[name];
  if (!preset) return;

  // Tear down whichever mode was active.
  if (state.mode === 'single') {
    state.domainNodes.forEach(disposeNode);
    state.domainNodes = [];
    if (centralAtomMesh) {
      moleculeGroup.remove(centralAtomMesh);
      centralAtomMesh.geometry.dispose();
      centralAtomMesh.material.dispose();
      centralAtomMesh = null;
    }
    if (centralAtomLabel) {
      moleculeGroup.remove(centralAtomLabel);
      if (centralAtomLabel.material.map) centralAtomLabel.material.map.dispose();
      centralAtomLabel.material.dispose();
      centralAtomLabel = null;
    }
    state.domains = [];
  } else {
    disposeMultiMolecule();
  }
  state.mode = 'multi';
  currentPresetName = name;

  const atoms = preset.atoms.map((elem) => ({
    element: elem,
    position: new THREE.Vector3(),
    parent: -1,
    children: [],   // atom indices of this atom's children in the tree
    isHeavy: false,
  }));
  const bonds = preset.bonds.map(([a, b, order]) => ({
    a, b, order,
    len: bondLengthFor(atoms[a].element, atoms[b].element, order),
  }));

  // Count incident bonds per atom to decide which are "heavy" (need VSEPR).
  const degree = new Array(atoms.length).fill(0);
  bonds.forEach((bd) => { degree[bd.a] += 1; degree[bd.b] += 1; });
  atoms.forEach((a, i) => {
    a.isHeavy = degree[i] > 1 || (preset.lps[i] || 0) > 0;
  });

  // BFS from the first heavy atom to define the tree.
  const rootIdx = atoms.findIndex((a) => a.isHeavy);
  const visited = new Set([rootIdx]);
  const queue = [rootIdx];
  while (queue.length) {
    const cur = queue.shift();
    bonds.forEach((bd) => {
      let neighbor = -1;
      if (bd.a === cur && !visited.has(bd.b)) neighbor = bd.b;
      else if (bd.b === cur && !visited.has(bd.a)) neighbor = bd.a;
      if (neighbor < 0) return;
      visited.add(neighbor);
      atoms[neighbor].parent = cur;
      atoms[cur].children.push(neighbor);
      queue.push(neighbor);
    });
  }

  // Build localDomains for each heavy atom (bonds + LPs).
  const domainsByAtom = {};
  atoms.forEach((atom, i) => {
    if (!atom.isHeavy) return;
    const list = [];
    bonds.forEach((bd) => {
      let other = -1;
      if (bd.a === i) other = bd.b;
      else if (bd.b === i) other = bd.a;
      if (other < 0) return;
      list.push({
        kind: 'bond',
        toAtom: other,
        bondOrder: bd.order,
        direction: randomUnitVector(),
        velocity: new THREE.Vector3(),
        isFixed: atom.parent === other, // parent-bond direction is set by parent each step
      });
    });
    const lpCount = preset.lps[i] || 0;
    for (let k = 0; k < lpCount; k++) {
      list.push({
        kind: 'lone_pair',
        bondOrder: 1,
        toAtom: -1,
        direction: randomUnitVector(),
        velocity: new THREE.Vector3(),
        isFixed: false,
      });
    }
    domainsByAtom[i] = list;
  });

  state.multi = {
    atoms,
    bonds,
    domainsByAtom,
    rootIdx,
    meshes: { atomGroups: [], bondGroups: [], lpGroups: {} },
    selectedAtomIdx: -1,
  };

  buildMultiMeshes();
  computeMultiPositions();
  updateMultiTransforms();
  state.simulating = true;
  state.simSteps = 0;
  updateMultiReadouts();
  updateBuilderVisibility();
  controls.presetSelect.value = name;
}

function buildMultiMeshes() {
  const m = state.multi;
  m.atoms.forEach((atom, i) => {
    const color = CPK[atom.element] ?? CPK._;
    const radius = atom.isHeavy ? MULTI_HEAVY_RADIUS : MULTI_TIP_RADIUS;
    const geo = new THREE.SphereGeometry(radius, 28, 20);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.08 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.clickable = true;
    mesh.userData.atomIndex = i;
    const label = makeLabel(atom.element, color);
    const group = new THREE.Group();
    group.add(mesh);
    group.add(label);
    multiGroup.add(group);
    m.meshes.atomGroups.push(group);
  });
  m.bonds.forEach((bd) => {
    const group = new THREE.Group();
    if (bd.order === 1) {
      group.add(makeBondCylinderLen(0.06, bd.len, 0, 0));
    } else if (bd.order === 2) {
      const off = 0.10;
      group.add(makeBondCylinderLen(0.045, bd.len, off, 0));
      group.add(makeBondCylinderLen(0.045, bd.len, -off, 0));
    } else {
      const r = 0.12;
      for (let k = 0; k < 3; k++) {
        const a = k * (Math.PI * 2 / 3);
        group.add(makeBondCylinderLen(0.035, bd.len, r * Math.cos(a), r * Math.sin(a)));
      }
    }
    multiGroup.add(group);
    m.meshes.bondGroups.push(group);
  });
  // LP lobes per heavy atom that has LPs
  Object.keys(m.domainsByAtom).forEach((atomIdxStr) => {
    const atomIdx = +atomIdxStr;
    const domains = m.domainsByAtom[atomIdx];
    const lpDomains = domains.filter((d) => d.kind === 'lone_pair');
    if (!lpDomains.length) return;
    m.meshes.lpGroups[atomIdx] = lpDomains.map(() => {
      const group = new THREE.Group();
      const lobe = makeMultiLonePairLobe();
      group.add(lobe);
      multiGroup.add(group);
      return group;
    });
  });
}

function makeBondCylinderLen(radius, len, offsetX, offsetZ) {
  const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1);
  const mat = new THREE.MeshStandardMaterial({ color: BOND_COLOR, roughness: 0.7, metalness: 0.0 });
  const cyl = new THREE.Mesh(geo, mat);
  cyl.position.set(offsetX || 0, 0, offsetZ || 0);  // centered along local Y, so bond group at midpoint works
  return cyl;
}

function makeMultiLonePairLobe() {
  // Smaller lobe for multi-centre molecules (atoms are closer together).
  const ctrl = [
    [0,    0   ],
    [0.06, 0.16],
    [0.16, 0.36],
    [0.24, 0.58],
    [0.26, 0.80],
    [0.22, 0.98],
    [0.12, 1.18],
    [0.04, 1.30],
    [0,    1.35],
  ];
  const yScale = MULTI_LP_DISTANCE / 1.35;
  const controls2D = ctrl.map(([x, y]) => new THREE.Vector2(x, y * yScale));
  const spline = new THREE.SplineCurve(controls2D);
  const profile = spline.getPoints(48);
  const geo = new THREE.LatheGeometry(profile, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: LP_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.35,
    emissive: LP_COLOR,
    emissiveIntensity: 0.18,
  });
  return new THREE.Mesh(geo, mat);
}

function computeMultiPositions() {
  const m = state.multi;
  if (!m) return;
  const root = m.atoms[m.rootIdx];
  root.position.set(0, 0, 0);
  const queue = [m.rootIdx];
  while (queue.length) {
    const cur = queue.shift();
    const curAtom = m.atoms[cur];
    const curDomains = m.domainsByAtom[cur];
    curAtom.children.forEach((childIdx) => {
      const bond = m.bonds.find((b) =>
        (b.a === cur && b.b === childIdx) || (b.b === cur && b.a === childIdx));
      let dir = null;
      if (curDomains) {
        const dom = curDomains.find((d) => d.kind === 'bond' && d.toAtom === childIdx);
        if (dom) dir = dom.direction;
      }
      if (!dir) dir = new THREE.Vector3(0, 1, 0);
      m.atoms[childIdx].position.copy(curAtom.position).addScaledVector(dir, bond.len);
      queue.push(childIdx);
    });
  }
  // Recenter so the molecule's centroid sits at the camera target.
  const centroid = new THREE.Vector3();
  m.atoms.forEach((a) => centroid.add(a.position));
  centroid.divideScalar(m.atoms.length);
  m.atoms.forEach((a) => a.position.sub(centroid));
}

function updateMultiTransforms() {
  const m = state.multi;
  if (!m) return;
  m.atoms.forEach((atom, i) => {
    m.meshes.atomGroups[i].position.copy(atom.position);
  });
  m.bonds.forEach((bd, i) => {
    const a = m.atoms[bd.a].position;
    const b = m.atoms[bd.b].position;
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(b, a);
    const grp = m.meshes.bondGroups[i];
    grp.position.copy(mid);
    if (dir.lengthSq() > 1e-12) {
      grp.quaternion.setFromUnitVectors(Y_UP, dir.normalize());
    }
  });
  // LPs
  Object.keys(m.meshes.lpGroups).forEach((atomIdxStr) => {
    const atomIdx = +atomIdxStr;
    const groups = m.meshes.lpGroups[atomIdx];
    const atom = m.atoms[atomIdx];
    const domains = m.domainsByAtom[atomIdx].filter((d) => d.kind === 'lone_pair');
    groups.forEach((grp, k) => {
      grp.position.copy(atom.position);
      const lpDir = domains[k].direction;
      if (lpDir.lengthSq() > 1e-12) {
        grp.quaternion.setFromUnitVectors(Y_UP, lpDir.clone().normalize());
      }
    });
  });
}

function runMultiPhysicsStep() {
  const m = state.multi;
  if (!m) return 0;

  // Pass 1: sync each non-root heavy atom's parent-bond direction.
  m.atoms.forEach((atom, i) => {
    if (!atom.isHeavy || atom.parent < 0) return;
    const parentDomains = m.domainsByAtom[atom.parent];
    if (!parentDomains) return;
    const parentOut = parentDomains.find((d) => d.kind === 'bond' && d.toAtom === i);
    if (!parentOut) return;
    const myDomains = m.domainsByAtom[i];
    const myParentBond = myDomains.find((d) => d.kind === 'bond' && d.toAtom === atom.parent);
    if (!myParentBond) return;
    myParentBond.direction.copy(parentOut.direction).negate();
  });

  // Pass 2: run VSEPR at each heavy atom on its localDomains.
  let maxVel = 0;
  Object.keys(m.domainsByAtom).forEach((atomIdxStr) => {
    const domains = m.domainsByAtom[+atomIdxStr];
    const n = domains.length;
    if (n < 2) return;
    const forces = domains.map(() => new THREE.Vector3());
    for (let j = 0; j < n; j++) {
      const dj = domains[j];
      const wj = (dj.kind === 'lone_pair') ? DOMAIN_WEIGHT.lone_pair
        : (DOMAIN_WEIGHT[`bond${dj.bondOrder}`] ?? 1.0);
      for (let k = 0; k < n; k++) {
        if (j === k) continue;
        const dk = domains[k];
        const wk = (dk.kind === 'lone_pair') ? DOMAIN_WEIGHT.lone_pair
          : (DOMAIN_WEIGHT[`bond${dk.bondOrder}`] ?? 1.0);
        const chord = new THREE.Vector3().subVectors(dj.direction, dk.direction);
        let r = chord.length();
        if (r < 1e-6) {
          chord.copy(randomUnitVector()).multiplyScalar(0.001);
          r = 1;
        }
        const rEff = Math.max(r, CHORD_FLOOR);
        const fmag = (wj * wk) / Math.pow(rEff, REPULSION_POWER);
        forces[j].addScaledVector(chord, fmag / r);
      }
    }
    for (let j = 0; j < n; j++) {
      if (domains[j].isFixed) continue;
      const d = domains[j];
      const dotFD = forces[j].dot(d.direction);
      forces[j].addScaledVector(d.direction, -dotFD);
      d.velocity.multiplyScalar(DAMPING).addScaledVector(forces[j], PHYS_DT);
      d.direction.addScaledVector(d.velocity, PHYS_DT).normalize();
      const v = d.velocity.length();
      if (v > maxVel) maxVel = v;
    }
  });

  computeMultiPositions();
  return maxVel;
}

function updateMultiReadouts() {
  const m = state.multi;
  if (!m) return;
  controls.readoutAtom.textContent = MULTI_PRESETS[currentPresetName]?.label ?? '—';
  controls.readoutDomains.textContent = `${m.atoms.length} atoms, ${m.bonds.length} bonds`;
  controls.readoutMaxAngle.textContent = '—';
  controls.readoutMinAngle.textContent = '—';
  controls.valenceNote.textContent = '';
  controls.domainCount.textContent = String(m.atoms.length);
  controls.readoutAnglesCard.hidden = true;
}

function bondAnglesAtAtom(atomIdx) {
  const m = state.multi;
  if (!m) return [];
  const atom = m.atoms[atomIdx];
  const dirs = [];
  m.bonds.forEach((b) => {
    let other = -1;
    if (b.a === atomIdx) other = b.b;
    else if (b.b === atomIdx) other = b.a;
    if (other < 0) return;
    const dir = new THREE.Vector3().subVectors(m.atoms[other].position, atom.position);
    if (dir.lengthSq() > 1e-10) dirs.push(dir.normalize());
  });
  const angles = [];
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const d = clamp(dirs[i].dot(dirs[j]), -1, 1);
      angles.push(Math.acos(d) * 180 / Math.PI);
    }
  }
  return angles.sort((a, b) => a - b);
}

function setMultiAtomHighlight(idx, on) {
  if (!state.multi || idx < 0) return;
  const group = state.multi.meshes.atomGroups[idx];
  if (!group) return;
  group.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material.emissive) {
      if (on) {
        obj.material.emissive.setHex(obj.material.color.getHex());
        obj.material.emissiveIntensity = 0.35;
      } else {
        obj.material.emissive.setHex(0x000000);
        obj.material.emissiveIntensity = 0;
      }
    }
  });
}

function selectMultiAtom(idx) {
  const m = state.multi;
  if (!m) return;
  if (m.selectedAtomIdx >= 0 && m.selectedAtomIdx !== idx) {
    setMultiAtomHighlight(m.selectedAtomIdx, false);
  }
  m.selectedAtomIdx = idx;
  setMultiAtomHighlight(idx, true);
  updateMultiSelectionReadout();
}

function deselectMultiAtom() {
  const m = state.multi;
  if (!m) return;
  if (m.selectedAtomIdx >= 0) {
    setMultiAtomHighlight(m.selectedAtomIdx, false);
  }
  m.selectedAtomIdx = -1;
  updateMultiReadouts();
}

function updateMultiSelectionReadout() {
  const m = state.multi;
  if (!m || m.selectedAtomIdx < 0) return;
  const idx = m.selectedAtomIdx;
  const atom = m.atoms[idx];
  controls.readoutAtom.textContent = `${atom.element} (selected)`;
  const bondCount = m.bonds.filter((b) => b.a === idx || b.b === idx).length;
  const lpCount = (m.domainsByAtom[idx] || []).filter((d) => d.kind === 'lone_pair').length;
  const parts = [];
  if (bondCount) parts.push(`${bondCount} bond${bondCount !== 1 ? 's' : ''}`);
  if (lpCount)   parts.push(`${lpCount} lone pair${lpCount !== 1 ? 's' : ''}`);
  controls.readoutDomains.textContent = parts.join(', ') || 'None';
  const angles = bondAnglesAtAtom(idx);
  if (angles.length === 0) {
    controls.readoutMaxAngle.textContent = '—';
    controls.readoutMinAngle.textContent = '—';
    controls.readoutAnglesCard.hidden = true;
  } else {
    controls.readoutMaxAngle.textContent = `${angles[angles.length - 1].toFixed(1)}°`;
    controls.readoutMinAngle.textContent = `${angles[0].toFixed(1)}°`;
    controls.readoutAnglesList.textContent = angles.map(a => `${a.toFixed(1)}°`).join(', ');
    controls.readoutAnglesCard.hidden = false;
  }
}

function pickMultiAtom(event) {
  if (!state.multi) return -1;
  raycaster.setFromCamera(eventNDC(event), camera);
  const targets = [];
  state.multi.meshes.atomGroups.forEach((group) => {
    group.traverse((obj) => {
      if (obj.userData && obj.userData.clickable) targets.push(obj);
    });
  });
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].object.userData.atomIndex : -1;
}

// ---- Principal-axis detection ----

// Jacobi-rotation eigendecomposition for a 3x3 symmetric matrix.
// Returns sorted eigenvalues (ascending) and the matching eigenvectors.
function eigen3x3Symmetric(m) {
  const A = [m[0].slice(), m[1].slice(), m[2].slice()];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iter = 0; iter < 40; iter++) {
    let p = 0, q = 1;
    let maxOff = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > maxOff) { p = 0; q = 2; maxOff = Math.abs(A[0][2]); }
    if (Math.abs(A[1][2]) > maxOff) { p = 1; q = 2; maxOff = Math.abs(A[1][2]); }
    if (maxOff < 1e-10) break;
    const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
    const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    const App = A[p][p], Aqq = A[q][q], Apq = A[p][q];
    A[p][p] = App - t * Apq;
    A[q][q] = Aqq + t * Apq;
    A[p][q] = A[q][p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const Arp = A[r][p], Arq = A[r][q];
      A[r][p] = A[p][r] = c * Arp - s * Arq;
      A[r][q] = A[q][r] = s * Arp + c * Arq;
    }
    for (let r = 0; r < 3; r++) {
      const Vrp = V[r][p], Vrq = V[r][q];
      V[r][p] = c * Vrp - s * Vrq;
      V[r][q] = s * Vrp + c * Vrq;
    }
  }
  const triples = [0, 1, 2].map(i => ({
    value: A[i][i],
    vector: new THREE.Vector3(V[0][i], V[1][i], V[2][i]),
  }));
  triples.sort((a, b) => a.value - b.value);
  return triples;
}

function detectPrincipalAxis() {
  if (state.domains.length === 0) return null;

  // 1. If lone pairs exist, look down the LP centroid.
  const lps = state.domains.filter(d => d.type === 'lone_pair');
  if (lps.length > 0) {
    const sum = new THREE.Vector3();
    lps.forEach(lp => sum.add(lp.direction));
    if (sum.lengthSq() > 0.05) return sum.normalize();
    return lps[0].direction.clone();
  }

  // 2. Otherwise compute inertia tensor of unit-mass points on the unit sphere.
  let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
  state.domains.forEach(d => {
    const v = d.direction;
    Ixx += 1 - v.x * v.x;
    Iyy += 1 - v.y * v.y;
    Izz += 1 - v.z * v.z;
    Ixy -= v.x * v.y;
    Ixz -= v.x * v.z;
    Iyz -= v.y * v.z;
  });
  const triples = eigen3x3Symmetric([
    [Ixx, Ixy, Ixz],
    [Ixy, Iyy, Iyz],
    [Ixz, Iyz, Izz],
  ]);
  // triples[0].value <= triples[1].value <= triples[2].value
  const gapLow  = triples[1].value - triples[0].value;
  const gapHigh = triples[2].value - triples[1].value;
  const scale = Math.max(1e-6, triples[2].value);
  if (Math.max(gapLow, gapHigh) < 0.08 * scale) {
    // Near-isotropic (tetrahedral, octahedral): no unique axis. Look down a bond.
    return state.domains[0].direction.clone();
  }
  // Pick the eigenvector whose eigenvalue is most isolated.
  const unique = gapLow > gapHigh ? triples[0] : triples[2];
  return unique.vector.clone().normalize();
}

// ---- 9. Wiring ----

// --- Raycaster for domain picking ---
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _origin = new THREE.Vector3(0, 0, 0);
const _hitPoint = new THREE.Vector3();
const _pickSphere = new THREE.Sphere(_origin, BOND_DISTANCE);

function eventNDC(event) {
  const rect = controls.root.getBoundingClientRect();
  _ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return _ndc;
}

function pickDomainAt(event) {
  raycaster.setFromCamera(eventNDC(event), camera);
  const targets = [];
  for (let i = 0; i < state.domainNodes.length; i++) {
    state.domainNodes[i].traverse((obj) => {
      if (obj.userData && obj.userData.clickable) {
        obj.userData.domainIndex = i;
        targets.push(obj);
      }
    });
  }
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].object.userData.domainIndex : -1;
}

function projectMouseToUnitDirection(event) {
  raycaster.setFromCamera(eventNDC(event), camera);
  if (raycaster.ray.intersectSphere(_pickSphere, _hitPoint)) {
    return _hitPoint.clone().normalize();
  }
  raycaster.ray.closestPointToPoint(_origin, _hitPoint);
  return _hitPoint.clone().normalize();
}

function wireViewControls() {
  controls.root.style.cursor = 'grab';

  controls.root.addEventListener('pointerdown', (e) => {
    if (state.mode === 'multi') {
      const atomIdx = pickMultiAtom(e);
      if (atomIdx >= 0) {
        selectMultiAtom(atomIdx);
        // Don't start camera drag on atom selection.
        return;
      }
      // Clicking empty space: deselect.
      deselectMultiAtom();
    } else {
      const idx = pickDomainAt(e);
      if (idx >= 0) {
        state.pinnedDomainIndex = idx;
        state.domains[idx].velocity.set(0, 0, 0);
        state.simulating = true;
        state.simSteps = 0;
        controls.root.style.cursor = 'grabbing';
        controls.root.setPointerCapture(e.pointerId);
        return;
      }
    }
    // Camera orbit mode
    interactionState.dragging = true;
    interactionState.lastX = e.clientX;
    interactionState.lastY = e.clientY;
    controls.root.style.cursor = 'grabbing';
    controls.root.setPointerCapture(e.pointerId);
  });

  controls.root.addEventListener('pointermove', (e) => {
    if (state.pinnedDomainIndex >= 0) {
      const dir = projectMouseToUnitDirection(e);
      const d = state.domains[state.pinnedDomainIndex];
      d.direction.copy(dir);
      d.velocity.set(0, 0, 0);
      updateDomainTransforms();
      return;
    }
    if (!interactionState.dragging) {
      const hoverIdx = (state.mode === 'multi') ? pickMultiAtom(e) : pickDomainAt(e);
      controls.root.style.cursor = hoverIdx >= 0 ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - interactionState.lastX;
    const dy = e.clientY - interactionState.lastY;
    interactionState.lastX = e.clientX;
    interactionState.lastY = e.clientY;
    cameraState.yaw -= dx * 0.008;
    cameraState.pitch = clamp(cameraState.pitch - dy * 0.006, -1.15, 1.15);
    updateCamera();
  });

  function finishDrag(e) {
    if (state.pinnedDomainIndex >= 0) {
      // Release pin and let physics relax everything back.
      state.pinnedDomainIndex = -1;
      state.domains.forEach((d) => d.velocity.set(0, 0, 0));
      state.simulating = true;
      state.simSteps = 0;
      if (e.pointerId !== undefined && controls.root.hasPointerCapture(e.pointerId)) {
        controls.root.releasePointerCapture(e.pointerId);
      }
      controls.root.style.cursor = 'grab';
      return;
    }
    if (interactionState.dragging && e.pointerId !== undefined && controls.root.hasPointerCapture(e.pointerId)) {
      controls.root.releasePointerCapture(e.pointerId);
    }
    interactionState.dragging = false;
    controls.root.style.cursor = 'grab';
  }

  controls.root.addEventListener('pointerup', finishDrag);
  controls.root.addEventListener('pointerleave', finishDrag);

  controls.root.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraState.radius = clamp(cameraState.radius + e.deltaY * 0.01, 3, 20);
    updateCamera();
  }, { passive: false });
}

function wireCameraPresets() {
  controls.btnFront.addEventListener('click', () => {
    const p = CAMERA_PRESETS.front;
    setCameraPreset(p.yaw, p.pitch);
  });
  controls.btnTop.addEventListener('click', () => {
    const p = CAMERA_PRESETS.top;
    setCameraPreset(p.yaw, p.pitch);
  });
  controls.btnIsometric.addEventListener('click', () => {
    const p = CAMERA_PRESETS.isometric;
    setCameraPreset(p.yaw, p.pitch);
  });
  controls.btnPrincipal.addEventListener('click', () => {
    const axis = detectPrincipalAxis();
    if (!axis) {
      const p = CAMERA_PRESETS.isometric;
      setCameraPreset(p.yaw, p.pitch);
      return;
    }
    const pitch = Math.asin(clamp(axis.y, -1, 1));
    const yaw = Math.atan2(axis.x, axis.z);
    setCameraPreset(yaw, pitch);
  });
}

function wirePresetSelect() {
  controls.presetSelect.addEventListener('change', () => {
    const name = controls.presetSelect.value;
    if (name in PRESETS) {
      loadPreset(name);
    } else if (name in MULTI_PRESETS) {
      loadMultiPreset(name);
    } else {
      // "Custom build…" — keep current molecule, reveal builder (only useful in single mode).
      if (state.mode === 'multi') {
        // Bail back to a single-centre default if user picks Custom from a multi preset.
        loadPreset('CH4');
        controls.presetSelect.value = '';
      }
      currentPresetName = null;
      updateBuilderVisibility();
    }
  });
  controls.btnShuffle.addEventListener('click', shuffleStart);
}

// Re-initialise the current molecule with fresh randomised directions so the
// student can watch it relax from a different starting scatter.
function shuffleStart() {
  if (state.mode === 'multi') {
    if (currentPresetName && MULTI_PRESETS[currentPresetName]) {
      loadMultiPreset(currentPresetName);
    }
    return;
  }
  if (state.domains.length === 0) return;
  const specs = state.domains.map(d => [d.type, d.bondOrder, d.terminalElement]);
  const dirs = smartInitDirections(specs);
  state.domains.forEach((d, i) => {
    d.direction.copy(dirs[i]);
    d.velocity.set(0, 0, 0);
  });
  updateDomainTransforms();
  state.simulating = true;
  state.simSteps = 0;
}

function wireCustomBuilder() {
  controls.centralAtomGrid.querySelectorAll('[data-central]').forEach((btn) => {
    btn.addEventListener('click', () => setCentralElement(btn.dataset.central));
  });
  controls.terminalAtomGrid.querySelectorAll('[data-terminal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedTerminal = btn.dataset.terminal;
      syncBuilderChips();
    });
  });
  controls.bondOrderChips.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedBondOrder = Number(btn.dataset.order);
      syncBuilderChips();
    });
  });
  controls.btnAddBond.addEventListener('click', addBondDomain);
  controls.btnAddLP.addEventListener('click', addLonePairDomain);
  controls.btnRemoveLast.addEventListener('click', removeLastDomain);
  controls.btnClear.addEventListener('click', clearAllDomains);
}

// ---- 10. Animation loop ----

function resizeRenderer() {
  const { clientWidth, clientHeight } = controls.root;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  updateCamera();
}

function animate(timestamp) {
  if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
  const delta = Math.min((timestamp - state.lastTimestamp) / 1000, 0.1);
  state.lastTimestamp = timestamp;

  if (state.simulating) {
    let maxVel = 0;
    for (let s = 0; s < PHYS_STEPS_PER_FRAME; s++) {
      maxVel = (state.mode === 'multi') ? runMultiPhysicsStep() : runPhysicsStep();
      state.simSteps += 1;
      if (state.simSteps > 80 && maxVel < PHYS_EPSILON) break;
      if (state.simSteps >= PHYS_STEPS_MAX) break;
    }
    if (state.mode === 'multi') {
      updateMultiTransforms();
      if (state.multi && state.multi.selectedAtomIdx >= 0) {
        updateMultiSelectionReadout();
      }
    } else {
      updateDomainTransforms();
      updateAngleReadouts();
    }
    if ((state.simSteps > 80 && maxVel < PHYS_EPSILON) || state.simSteps >= PHYS_STEPS_MAX) {
      state.simulating = false;
      if (state.mode === 'single' && currentPresetName) logAngles(currentPresetName);
    }
  }

  resizeRenderer();
  stepCameraAnim(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---- 11. Init ----

window.addEventListener('resize', resizeRenderer);
wireViewControls();
wireCameraPresets();
wirePresetSelect();
wireCustomBuilder();
loadPreset('CH4');
updateCamera();
requestAnimationFrame(animate);
