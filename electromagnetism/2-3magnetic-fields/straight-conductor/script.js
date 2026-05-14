/* ═══════════════════════════════════════════════════════════════
   Straight Conductor — 3D magnetic field sim
   World unit = 1 cm.  Wire along world Y-axis.
   For current in +Y, the field at (x, y, z) has
       B ∝ (z, 0, −x) / (x² + z²)
   i.e. it circles the wire in the right-hand-rule sense
   (thumb along current, fingers curl with B).
═══════════════════════════════════════════════════════════════ */

const MU0 = 4 * Math.PI * 1e-7;    // T·m/A
const CM  = 0.01;                  // 1 world-unit = 1 cm = 0.01 m

const state = {
  dir:        +1,     // +1 = +Y, −1 = −Y
  I:          1.0,    // amperes
  probe:      { x: 1.5, y: 0, z: 1.5 },
  showLines:  true,
  showCross:  false,
  showProbe:  true,
};

/* ── Physics helper ──────────────────────────────────────── */
// Returns B in Tesla plus the unit direction vector in world space.
function bAt(x, y, z) {
  const rSq = x * x + z * z;              // cm²
  if (rSq < 1e-6) return { mag: 0, ux: 0, uy: 0, uz: 0, r_m: 0 };
  const r     = Math.sqrt(rSq);           // cm
  const r_m   = r * CM;                   // m
  const mag   = MU0 * state.I / (2 * Math.PI * r_m);   // T
  // direction for +Y current: (z, 0, −x)/r  (verified by Biot–Savart)
  const sign = state.dir;
  return {
    mag,
    ux: sign * ( z / r),
    uy: 0,
    uz: sign * (-x / r),
    r_m,
  };
}

/* ═══════════════════════════════════════════════════════════════
   Three.js scene
═══════════════════════════════════════════════════════════════ */
const root = document.getElementById('three-root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef6ff);

const perspCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const ORTHO_HALF = 4.8;                     // visible half-height in cm
const orthoCam   = new THREE.OrthographicCamera(
  -ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 200,
);
let camera = perspCam;                      // currently-rendered camera
const camTarget = new THREE.Vector3(0, 0, 0);
const camState  = { radius: 14, yaw: 0.9, pitch: 0.35, mode: 'persp' };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
root.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfdfefe, 0xb5c7e0, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(6, 8, 4);
scene.add(dirLight);

/* ── Axes / reference grid ──────────────────────────────── */
const gridHelper = new THREE.GridHelper(10, 10, 0x9ab2cc, 0xcfddee);
gridHelper.position.y = -4;
scene.add(gridHelper);

/* ── Wire ────────────────────────────────────────────────── */
const WIRE_HALF = 4.6;
const wireGeom = new THREE.CylinderGeometry(0.12, 0.12, WIRE_HALF * 2, 24);
const wireMat  = new THREE.MeshStandardMaterial({
  color: 0xc2410c, metalness: 0.45, roughness: 0.45,
});
const wire = new THREE.Mesh(wireGeom, wireMat);
scene.add(wire);

/* Current-direction arrow at the head of the wire (shown in perspective views) */
const arrowGroup = new THREE.Group();
scene.add(arrowGroup);

/* Dot / × glyph at the camera-facing end of the wire (shown in end-on ortho) */
const endGlyphGroup = new THREE.Group();
scene.add(endGlyphGroup);
const endGlyphMat = new THREE.MeshBasicMaterial({
  color: 0xfff7ed, side: THREE.DoubleSide,
});

function buildCurrentArrow() {
  arrowGroup.clear();
  const tipY = state.dir > 0 ? WIRE_HALF + 0.1 : -WIRE_HALF - 0.1;
  const len  = 1.1;
  // Shaft
  const shaftGeom = new THREE.CylinderGeometry(0.08, 0.08, len * 0.65, 16);
  const shaftMat  = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.3, roughness: 0.5 });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);
  shaft.position.y = tipY + state.dir * (len * 0.33);
  arrowGroup.add(shaft);
  // Head
  const headGeom = new THREE.ConeGeometry(0.22, len * 0.5, 20);
  const head = new THREE.Mesh(headGeom, shaftMat);
  head.position.y = tipY + state.dir * (len * 0.9);
  if (state.dir < 0) head.rotation.z = Math.PI;
  arrowGroup.add(head);
}
buildCurrentArrow();

/* Dot when current flows toward the camera, × when it flows away. */
function buildEndGlyph() {
  endGlyphGroup.clear();
  if (camState.mode !== 'ortho') return;

  const camSide = Math.sign(camState.pitch) || 1;   // +1 = above, −1 = below
  const towardCamera = camSide === state.dir;
  const glyphY = camSide * (WIRE_HALF + 0.05);

  if (towardCamera) {
    // Small filled dot, well inside the wire's circular cross-section.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.015, 24),
      endGlyphMat,
    );
    disc.position.y = glyphY;
    endGlyphGroup.add(disc);
  } else {
    // Two crossed flat bars (×), sized so the wire's rim stays visible around them.
    const BAR_LEN = 0.17, BAR_THK = 0.015, BAR_W = 0.035;
    [ Math.PI / 4, -Math.PI / 4 ].forEach(ang => {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(BAR_LEN, BAR_THK, BAR_W),
        endGlyphMat,
      );
      bar.position.y = glyphY;
      bar.rotation.y = ang;
      endGlyphGroup.add(bar);
    });
  }
}

/* ── Field lines ─────────────────────────────────────────── */
const linesGroup = new THREE.Group();
scene.add(linesGroup);

// Radii are spaced geometrically (rₙ₊₁/rₙ ≈ 1.6) so the line density in
// a cross-section scales as 1/r, matching |B| ∝ 1/r. Equal-radius spacing
// would wrongly imply a uniform field.
const FIELD_RADII   = [0.5, 0.8, 1.3, 2.1, 3.4];   // cm
const FIELD_HEIGHTS = [-3, -1.5, 0, 1.5, 3];       // cm (field is translation-symmetric along the wire)
const CIRCLE_SEGMENTS = 96;

function buildFieldLines() {
  linesGroup.clear();
  // TorusGeometry renders the circle as a thin tube so its width isn't
  // capped by WebGL's 1-pixel LineBasicMaterial limit.
  const TUBE_R = 0.04;
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x0d9488, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.88,
  });
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0x0d9488, metalness: 0.1, roughness: 0.55,
  });

  FIELD_RADII.forEach(r => {
    FIELD_HEIGHTS.forEach(h => {
      // Thin torus around the Y-axis (default torus is in XY, rotate into XZ).
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(r, TUBE_R, 10, CIRCLE_SEGMENTS),
        tubeMat,
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.y = h;
      linesGroup.add(torus);

      // Four arrowheads around each circle.
      for (let k = 0; k < 4; k++) {
        const t  = k * Math.PI / 2 + Math.PI / 6;   // offset so they don't stack on axes
        const px = r * Math.cos(t);
        const py = h;
        const pz = -r * Math.sin(t);

        // Tangent for +θ direction:
        let tx = -r * Math.sin(t);
        let tz = -r * Math.cos(t);
        const tlen = Math.hypot(tx, tz);
        tx /= tlen; tz /= tlen;

        // Flip for downward current
        if (state.dir < 0) { tx = -tx; tz = -tz; }

        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.11, 0.28, 14),
          coneMat
        );
        cone.position.set(px, py, pz);
        // Align cone's default +Y axis with the tangent (tx, 0, tz)
        const fromV = new THREE.Vector3(0, 1, 0);
        const toV   = new THREE.Vector3(tx, 0, tz);
        cone.quaternion.setFromUnitVectors(fromV, toV);
        linesGroup.add(cone);
      }
    });
  });
}
buildFieldLines();

/* ── Probe ───────────────────────────────────────────────── */
const probeGroup = new THREE.Group();
scene.add(probeGroup);

const probeSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 20, 14),
  new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.2, roughness: 0.45 }),
);
probeGroup.add(probeSphere);

const probeArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0x1e3a8a, 0.35, 0.18,
);
probeArrow.line.material.linewidth = 2;
probeGroup.add(probeArrow);

/* ── Cross-section vectors (2D grid in XZ plane at probe.y) ─ */
const crossGroup = new THREE.Group();
scene.add(crossGroup);

function buildCrossSection() {
  crossGroup.clear();
  if (!state.showCross) return;

  // Translucent disk at the probe's y-height
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(4.3, 48),
    new THREE.MeshBasicMaterial({
      color: 0x2563eb, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
    }),
  );
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = state.probe.y;
  crossGroup.add(disk);

  const arrowMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.1, roughness: 0.6 });

  for (let gx = -4; gx <= 4; gx++) {
    for (let gz = -4; gz <= 4; gz++) {
      if (gx === 0 && gz === 0) continue;
      const f = bAt(gx, state.probe.y, gz);
      if (f.mag === 0) continue;
      // Visual length ∝ sqrt(|B|/|B|(r=1cm, I=1A)), capped, so distant arrows still visible.
      const refMag = MU0 * state.I / (2 * Math.PI * CM);
      const L = 0.45 + 0.55 * Math.min(1, Math.sqrt(f.mag / refMag));
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, L * 0.65, 10),
        arrowMat,
      );
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, L * 0.35, 12),
        arrowMat,
      );
      const toV = new THREE.Vector3(f.ux, 0, f.uz).normalize();
      const q   = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), toV);
      body.quaternion.copy(q);
      head.quaternion.copy(q);
      const base = new THREE.Vector3(gx, state.probe.y, gz);
      body.position.copy(base).addScaledVector(toV,  L * 0.325);
      head.position.copy(base).addScaledVector(toV,  L * 0.825);
      crossGroup.add(body);
      crossGroup.add(head);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   Updates driven by state
═══════════════════════════════════════════════════════════════ */
function updateProbe() {
  probeGroup.visible = state.showProbe;
  probeSphere.position.set(state.probe.x, state.probe.y, state.probe.z);

  const f = bAt(state.probe.x, state.probe.y, state.probe.z);
  probeArrow.position.set(state.probe.x, state.probe.y, state.probe.z);

  const dir = new THREE.Vector3(f.ux, f.uy, f.uz);
  if (dir.lengthSq() < 1e-8) {
    probeArrow.visible = false;
  } else {
    probeArrow.visible = true;
    probeArrow.setDirection(dir);
    // Arrow length: logarithmic-ish scaling so it stays visible across r.
    const refMag = MU0 * state.I / (2 * Math.PI * CM);     // |B| at r=1cm
    const L = 0.5 + 1.3 * Math.min(1.4, Math.sqrt(f.mag / refMag));
    probeArrow.setLength(L, 0.35, 0.18);
  }

  // Readout
  const r_cm = Math.hypot(state.probe.x, state.probe.z);
  document.getElementById('rd-r').textContent = r_cm < 0.01
    ? '— (on wire)'
    : `${r_cm.toFixed(2)} cm`;
  if (r_cm < 0.01) {
    document.getElementById('rd-mag').textContent = '—';
    document.getElementById('rd-dir').textContent = '—';
  } else {
    document.getElementById('rd-mag').textContent = formatB(f.mag);
    document.getElementById('rd-dir').textContent =
      `(${f.ux.toFixed(2)}, 0, ${f.uz.toFixed(2)})`;
  }
}

function formatB(teslas) {
  if (teslas >= 1e-3)  return (teslas * 1e3).toFixed(2) + ' mT';
  if (teslas >= 1e-6)  return (teslas * 1e6).toFixed(1) + ' µT';
  return (teslas * 1e9).toFixed(1) + ' nT';
}

function rebuildScene() {
  buildCurrentArrow();
  buildEndGlyph();
  buildFieldLines();
  buildCrossSection();
  linesGroup.visible = state.showLines;
  crossGroup.visible = state.showCross;
  updateProbe();
}

/* ═══════════════════════════════════════════════════════════════
   Camera orbit (pointer drag + wheel zoom)
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
  // Gimbal fix near vertical pitch — blend up-vector to a horizontal fallback.
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
}

function useCamera(mode) {
  camState.mode = mode;
  camera = mode === 'ortho' ? orthoCam : perspCam;
  // In end-on ortho view we replace the 3D tip arrow with the
  // dot/× glyph convention; in perspective views the tip arrow returns.
  arrowGroup.visible = mode !== 'ortho';
  buildEndGlyph();
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
  camState.yaw   -= dx * 0.008;
  const LIM = Math.PI / 2;
  camState.pitch  = Math.max(-LIM, Math.min(LIM, camState.pitch - dy * 0.006));
  // Dragging away from End-on returns us to a perspective view — and
  // clears the End-on segmented highlight so the UI stays honest.
  if (camState.mode === 'ortho') {
    useCamera('persp');
    document.querySelectorAll('#seg-cam .seg-btn').forEach(b => b.classList.remove('active'));
  }
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

/* ── Camera presets ──────────────────────────────────────── */
function setCamPreset(preset) {
  if (preset === 'iso') {
    camState.yaw = 0.9; camState.pitch = 0.35; camState.radius = 14;
    useCamera('persp');
  }
  if (preset === 'endon') {
    // Look down the wire against the current so the field circles CCW
    // in view (right-hand-rule "current coming toward you" convention).
    // Orthographic projection so every Y-stacked ring projects to the same
    // concentric circle — the textbook picture, from real 3D geometry.
    camState.yaw   = 0;
    camState.pitch = state.dir > 0 ?  Math.PI / 2 : -Math.PI / 2;
    camState.radius = 11;
    useCamera('ortho');
  }
  if (preset === 'side') {
    camState.yaw = Math.PI / 2; camState.pitch = 0; camState.radius = 14;
    useCamera('persp');
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
    state.dir = btn.dataset.val === 'up' ? +1 : -1;
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

function wireSlider(id, valId, onChange, unit = '', digits = 2) {
  const el = document.getElementById(id);
  const vl = document.getElementById(valId);
  const min = parseFloat(el.min);
  const max = parseFloat(el.max);
  const step = parseFloat(el.step) || 1;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    vl.value = v.toFixed(digits);
    onChange(v);
  });
  vl.addEventListener('change', () => {
    const raw = parseFloat(vl.value);
    if (isNaN(raw)) { vl.value = parseFloat(el.value).toFixed(digits); return; }
    const snapped = Math.round((raw - min) / step) * step + min;
    const v = Math.max(min, Math.min(max, snapped));
    el.value = v;
    vl.value = v.toFixed(digits);
    onChange(v);
  });
}

wireSlider('slider-current', 'val-current', v => { state.I = v; rebuildScene(); }, 'A', 1);
wireSlider('slider-px', 'val-px', v => { state.probe.x = v; if (state.showCross) buildCrossSection(); updateProbe(); });
wireSlider('slider-py', 'val-py', v => { state.probe.y = v; if (state.showCross) buildCrossSection(); updateProbe(); });
wireSlider('slider-pz', 'val-pz', v => { state.probe.z = v; if (state.showCross) buildCrossSection(); updateProbe(); });

function toggleBtn(id, key, sideEffect) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    state[key] = !state[key];
    btn.classList.toggle('active', state[key]);
    if (sideEffect) sideEffect();
  });
}
toggleBtn('btn-lines', 'showLines', () => { linesGroup.visible = state.showLines; });
toggleBtn('btn-cross', 'showCross', () => { buildCrossSection(); crossGroup.visible = state.showCross; });
toggleBtn('btn-probe', 'showProbe', updateProbe);

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

updateProbe();
requestAnimationFrame(loop);
