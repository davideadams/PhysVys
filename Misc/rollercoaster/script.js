/* Rollercoaster Builder — canvas setup, camera interaction, render loop. */
(function () {
  const RC = window.RC;

  const canvas = document.getElementById('park-canvas');
  const ctx = canvas.getContext('2d');
  const cam = RC.camera;

  // Lower bound chosen so the whole 40x40 park fits on a typical screen.
  const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5;

  const state = {
    view: { w: 960, h: 600, dpr: 1 },
    hover: null,       // {i, j} tile under the cursor, or null
    dragging: false,
    dragMoved: false,
    lastX: 0,
    lastY: 0,
    dirty: true
  };

  /* ---- sizing ---------------------------------------------------------- */
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    state.view.w = w;
    state.view.h = h;
    state.view.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dirty = true;
  }
  window.addEventListener('resize', resize);

  /* ---- camera ---------------------------------------------------------- */
  function setZoom(z, sx, sy) {
    // Snapped to 0.02 so a continuous wheel gesture doesn't rebuild the
    // ground cache on every single event.
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const next = Math.round(clamped * 50) / 50;
    if (next === cam.zoom) return;
    // Keep the world point under (sx, sy) pinned while zooming.
    const cx = state.view.w / 2, cy = state.view.h / 2;
    const px = (sx - cx - cam.panX) / cam.zoom;
    const py = (sy - cy - cam.panY) / cam.zoom;
    cam.zoom = next;
    cam.panX = sx - cx - px * next;
    cam.panY = sy - cy - py * next;
    state.dirty = true;
  }

  function resetView() {
    cam.zoom = 1;
    cam.panX = 0;
    cam.panY = 0;
    cam.rot = 0;
    state.dirty = true;
  }

  function rotate(dir) {
    cam.rot = (cam.rot + dir + 4) & 3;
    state.dirty = true;
  }

  /* ---- pointer --------------------------------------------------------- */
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function updateHover(p) {
    const [wi, wj] = RC.screenToWorld(p.x, p.y, cam, state.view);
    const i = Math.floor(wi), j = Math.floor(wj);
    const next = RC.inBounds(i, j) ? { i, j } : null;
    const a = state.hover, b = next;
    if ((a === null) !== (b === null) || (a && b && (a.i !== b.i || a.j !== b.j))) {
      state.hover = next;
      state.dirty = true;
      readTile();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    state.dragging = true;
    state.dragMoved = false;
    const p = pointerPos(e);
    state.lastX = p.x;
    state.lastY = p.y;
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointerPos(e);
    if (state.dragging) {
      const dx = p.x - state.lastX, dy = p.y - state.lastY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) state.dragMoved = true;
      cam.panX += dx;
      cam.panY += dy;
      state.lastX = p.x;
      state.lastY = p.y;
      state.dirty = true;
    }
    updateHover(p);
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.classList.remove('dragging');
    if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('pointerleave', () => {
    if (state.hover) { state.hover = null; state.dirty = true; readTile(); }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointerPos(e);
    const factor = Math.pow(1.0015, -e.deltaY);
    setZoom(cam.zoom * factor, p.x, p.y);
  }, { passive: false });

  /* ---- controls -------------------------------------------------------- */
  document.getElementById('btn-rot-ccw').addEventListener('click', () => rotate(-1));
  document.getElementById('btn-rot-cw').addEventListener('click', () => rotate(1));
  document.getElementById('btn-zoom-in').addEventListener('click', () =>
    setZoom(cam.zoom * 1.25, state.view.w / 2, state.view.h / 2));
  document.getElementById('btn-zoom-out').addEventListener('click', () =>
    setZoom(cam.zoom / 1.25, state.view.w / 2, state.view.h / 2));
  document.getElementById('btn-view-reset').addEventListener('click', resetView);

  /* ---- readouts -------------------------------------------------------- */
  const roTile = document.getElementById('ro-tile');
  const roScale = document.getElementById('ro-scale');

  function readTile() {
    roTile.textContent = state.hover
      ? `tile (${state.hover.i}, ${state.hover.j})`
      : `${RC.GRID} × ${RC.GRID} tiles`;
  }

  roScale.textContent = `1 tile = ${RC.TILE_M} m · 1 step = ${RC.LEVEL_M} m`;
  readTile();

  /* ---- render ---------------------------------------------------------- */
  function render() {
    const view = state.view;
    RC.drawSky(ctx, cam, view);
    RC.drawGround(ctx, cam, view);

    if (state.hover) {
      RC.strokeTile(ctx, state.hover.i, state.hover.j, 0, cam, view,
        'rgba(255,255,255,0.85)', 2, 'rgba(255,255,255,0.16)');
    }

    // The head arrow and the ghost preview join the depth-sorted list so
    // they're occluded by any track standing in front of them.
    const head = RC.track.head;
    const ghostDef = RC.ghostDef();
    const extras = [];

    if (head) {
      extras.push({
        depth: RC.depth(head.i + 0.5, head.j + 0.5, head.k, cam.rot) + 0.5,
        draw: RC.drawHead, head
      });
    }
    if (ghostDef && head) {
      const mid = RC.centreline(ghostDef, head, 0.5);
      extras.push({
        depth: RC.depth(mid.x, mid.y, mid.z, cam.rot) + 0.6,
        draw: RC.drawGhost,
        def: ghostDef, head, ok: RC.canPlace(ghostDef, head).ok
      });
    }

    for (const t of RC.trainDrawables(cam)) extras.push(t);

    RC.drawTrack(ctx, cam, view, extras);
    RC.drawCompass(ctx, cam, view);
  }

  /* ---- ride controls ---------------------------------------------------- */
  const btnTest = document.getElementById('btn-test');
  const roRide = document.getElementById('ro-ride');

  function updateRideUI() {
    const sim = RC.sim;
    const running = sim.state === 'running';
    btnTest.textContent = running ? '■ Pause' : '▶ Test';
    btnTest.classList.toggle('active', running);

    if (sim.note && sim.state !== 'running') {
      roRide.textContent = sim.note;
    } else if (running || sim.time > 0) {
      const e = RC.energy();
      roRide.textContent =
        `${(Math.abs(sim.v) * 3.6).toFixed(0)} km/h · ${e.h.toFixed(1)} m · ${sim.time.toFixed(1)} s`;
    } else {
      roRide.textContent = 'Train at the station';
    }
  }
  RC.updateRideUI = updateRideUI;

  btnTest.addEventListener('click', () => {
    if (RC.sim.state === 'running') RC.pauseSim();
    else RC.startSim();
    updateRideUI();
    state.dirty = true;
  });

  document.getElementById('btn-ride-reset').addEventListener('click', () => {
    RC.resetSim();
    updateRideUI();
    state.dirty = true;
  });

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.matches('input, textarea, button')) return;
    e.preventDefault();
    if (RC.sim.state === 'running') RC.pauseSim(); else RC.startSim();
    updateRideUI();
    state.dirty = true;
  });

  /* Called by build.js whenever the track is edited. */
  RC.onTrackEdit = function () {
    RC.pauseSim();
    RC.resetSim();
    updateRideUI();
  };

  /* ---- frame ------------------------------------------------------------ */
  let lastT = 0;
  function frame(t) {
    const dt = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;

    if (RC.sim.state === 'running') {
      RC.stepSim(dt);
      updateRideUI();
      state.dirty = true;
    }

    if (state.dirty) {
      state.dirty = false;
      render();
    }
    requestAnimationFrame(frame);
  }

  RC.requestRender = function () { state.dirty = true; };

  RC.initWindows();
  RC.resetTrack();
  RC.initBuild();
  RC.resetSim();
  updateRideUI();
  resize();
  requestAnimationFrame(frame);
})();
