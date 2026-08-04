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
    showHeights: false,
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

  /* Put the track in the middle of the canvas, leaving zoom and rotation
     alone. The park is 40 tiles — 160 m — across and does not all fit at
     zoom 1, so a track built against one edge of it sits well off the side of
     the screen if the view stays centred on the park itself. Centring on the
     TRACK rather than the park means "where I built" is always what is on
     screen, wherever in the park that is. */
  function centreOnTrack() {
    const pts = RC.trackPath().pts;
    if (!pts.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      const q = RC.projWorld(p.x, p.y, p.z, cam.rot);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }
    cam.panX = -((minX + maxX) / 2) * cam.zoom;
    cam.panY = -((minY + maxY) / 2) * cam.zoom;
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
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.classList.remove('dragging');
    if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Double-click a piece of track to select it: opens the build window with
  // that piece's type lit up and highlights it on the map. Hit-tests the
  // track geometry, not the ground tile, so raised track picks correctly.
  canvas.addEventListener('dblclick', (e) => {
    const p = pointerPos(e);
    const pi = RC.pickPiece(p.x, p.y, cam, state.view);
    if (pi != null) {
      RC.setWindow('win-build', true);
      RC.selectPiece(pi);
      state.dirty = true;
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pointerPos(e);
    const factor = Math.pow(1.0015, -e.deltaY);
    setZoom(cam.zoom * factor, p.x, p.y);
  }, { passive: false });

  /* ---- controls -------------------------------------------------------- */
  const btnRotCcw = document.getElementById('btn-rot-ccw');
  const btnRotCw = document.getElementById('btn-rot-cw');
  // The markup ships a plain character so the buttons say something even if
  // this never runs; the drawn glyph replaces it when there is one.
  for (const [btn, name] of [[btnRotCcw, 'view-rotate-ccw'], [btnRotCw, 'view-rotate-cw']]) {
    const svg = RC.icon(name);
    if (svg) btn.innerHTML = svg;
  }
  btnRotCcw.addEventListener('click', () => rotate(-1));
  btnRotCw.addEventListener('click', () => rotate(1));
  document.getElementById('btn-zoom-in').addEventListener('click', () =>
    setZoom(cam.zoom * 1.25, state.view.w / 2, state.view.h / 2));
  document.getElementById('btn-zoom-out').addEventListener('click', () =>
    setZoom(cam.zoom / 1.25, state.view.w / 2, state.view.h / 2));

  /* ---- undo and redo ----------------------------------------------------
     Both live on the toolbar rather than in the build window, because a
     student who has just built something wrong looks at the top of the screen
     for the way out of it, and because the build window can be closed. */
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  function afterEdit() {
    /* The selection is deliberately KEPT. refresh() already clamps a cursor
       left past the end of a shortened track, so nothing dangles — and dropping
       it would break the one loop this is most used for: pick a hill, put a
       chain on it, run the ride, undo, run it again. Losing the piece on every
       press would mean re-finding it each time. */
    RC.refreshBuild();       // resets the sim and syncs the undo pair below
    state.dirty = true;
  }
  function syncUndo() {
    btnUndo.disabled = !RC.canUndo();
    btnRedo.disabled = !RC.canRedo();
  }
  RC.syncUndo = syncUndo;      // so a build or a load can refresh the pair

  btnUndo.addEventListener('click', () => { if (RC.undo()) afterEdit(); });
  btnRedo.addEventListener('click', () => { if (RC.redo()) afterEdit(); });

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    // Ctrl+Y and Ctrl+Shift+Z both redo, because both are muscle memory
    // depending on what else the student uses.
    const redo = k === 'y' || (k === 'z' && e.shiftKey);
    if (k !== 'z' && k !== 'y') return;
    e.preventDefault();
    if (redo ? RC.redo() : RC.undo()) afterEdit();
  });

  const btnHeights = document.getElementById('btn-heights');
  btnHeights.addEventListener('click', () => {
    state.showHeights = !state.showHeights;
    btnHeights.classList.toggle('active', state.showHeights);
    state.dirty = true;
  });

  /* ---- readouts -------------------------------------------------------- */
  document.getElementById('ro-tile').textContent = `${RC.GRID} × ${RC.GRID} tiles`;
  document.getElementById('ro-scale').textContent =
    `1 tile = ${RC.TILE_M} m · 1 step = ${RC.LEVEL_M} m`;

  /* ---- render ---------------------------------------------------------- */
  function render() {
    const view = state.view;
    RC.drawSky(ctx, cam, view);
    RC.drawGround(ctx, cam, view);

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
    if (state.showHeights) RC.drawHeightLabels(ctx, cam, view);
    RC.drawSelection(ctx, cam, view, RC.buildCursor());
    RC.drawCompass(ctx, cam, view);
  }

  /* ---- ride controls ---------------------------------------------------- */
  const btnTest = document.getElementById('btn-test');
  const btnShuttle = document.getElementById('btn-shuttle');
  const roRide = document.getElementById('ro-ride');

  /* Only redraw a display when its window is actually open. */
  function visible(id) {
    const el = document.getElementById(id);
    return el && !el.hidden;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateEnergyPanels() {
    const sim = RC.sim;
    const e = RC.energy();

    if (visible('win-graphs')) {
      // Only the plot on show is drawn; the live readouts below it are useful
      // whichever that is, so they are always kept up to date.
      if (RC.graphMode() === 'bars') {
        RC.drawEnergyBars(document.getElementById('graph-bars'));
      } else {
        RC.drawEnergyGraph(document.getElementById('graph-line'));
      }
      // The heat trace comes and goes with the ride, not with the mode, so
      // its key is settled here rather than in syncGraphMode.
      const heatKey = document.getElementById('legend-heat');
      if (heatKey) heatKey.hidden = !RC.graphHasHeat();
      showGraphPick();
      setText('ro-e-v', Math.abs(sim.v).toFixed(1) + ' m/s');
      setText('ro-e-h', e.h.toFixed(2) + ' m');
      setText('ro-e-ke', RC.fmtEnergy(e.ke));
      setText('ro-e-pe', RC.fmtEnergy(e.pe));
      setText('ro-e-tot', RC.fmtEnergy(e.total));

      const g = sim.g || { vert: 1, lat: 0 };
      const vEl = document.getElementById('ro-g-vert');
      const lEl = document.getElementById('ro-g-lat');
      if (vEl) {
        vEl.textContent = g.vert.toFixed(2) + ' g';
        vEl.style.color = RC.gColour(g.vert, 'vert');
      }
      if (lEl) {
        // Sign is only meaningful as a direction, so show it as one.
        const side = Math.abs(g.lat) < 0.05 ? '' : (g.lat > 0 ? ' right' : ' left');
        lEl.textContent = Math.abs(g.lat).toFixed(2) + ' g' + side;
        lEl.style.color = RC.gColour(g.lat, 'lat');
      }
      setText('e-mass', `${sim.cars} cars, ${(RC.trainMass() / 1000).toFixed(1)} t`);
    }
    if (visible('win-report')) {
      RC.updateReport();
    }
  }
  RC.updateEnergyPanels = updateEnergyPanels;

  /* Shuttle is a fallback for track that is not a closed circuit: it lets an
     unfinished layout be run out-and-back instead of refusing to test. On a
     circuit it has no bearing at all — circuitStatus settles that the train
     goes round before it ever consults the setting — so the button must not
     sit there lit, implying the ride is being run as a shuttle when it is not. */
  function updateShuttleBtn() {
    let kind = 'empty';
    try { kind = RC.circuitStatus().kind; } catch (e) { kind = 'empty'; }
    const settled = kind === 'closed' || kind === 'closed-nostation' || kind === 'demo';
    const on = RC.sim.shuttleMode && !settled;

    btnShuttle.disabled = settled;
    btnShuttle.classList.toggle('active', on);
    btnShuttle.setAttribute('aria-pressed', on ? 'true' : 'false');
    btnShuttle.title = settled
      ? (kind === 'demo'
          ? 'This is a demonstration — the trains run their own tracks'
          : 'This track is a complete circuit, so the train goes round it')
      : 'Run a track that isn\'t a full circuit as an out-and-back shuttle, ' +
        'instead of requiring a closed loop';
  }

  function updateRideUI() {
    const sim = RC.sim;
    // A demo's slower trains keep coming down after the ride's own has
    // stopped, and the button has to stay a Pause while they do.
    const running = sim.state === 'running' || (RC.demoRunning && RC.demoRunning());
    btnTest.textContent = running ? '■ Pause' : '▶ Test';
    btnTest.classList.toggle('active', running);
    updateShuttleBtn();

    if (sim.note && sim.state !== 'running') {
      roRide.textContent = sim.note;
    } else if (running || sim.time > 0) {
      const e = RC.energy();
      roRide.textContent =
        `${Math.abs(sim.v).toFixed(1)} m/s · ${e.h.toFixed(1)} m · ${sim.time.toFixed(1)} s`;
    } else {
      roRide.textContent = 'Train at the station';
    }
    updateEnergyPanels();
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
    RC.resetEnergyScale();
    updateRideUI();
    state.dirty = true;
  });

  // Switching shuttle mode changes whether an unfinished track is testable, so
  // it invalidates any run in progress — put the train back at the station.
  btnShuttle.addEventListener('click', () => {
    RC.sim.shuttleMode = !RC.sim.shuttleMode;
    RC.pauseSim();
    RC.resetSim();
    RC.resetEnergyScale();
    updateRideUI();
    state.dirty = true;
  });

  /* Opening a window mid-run should draw it immediately, not on the next
     frame — which may never come if the sim is paused. */
  document.querySelectorAll('[data-window]').forEach(btn => {
    btn.addEventListener('click', () => updateEnergyPanels());
  });
  window.addEventListener('resize', () => updateEnergyPanels());
  // Re-fit a canvas window's drawing when it's resized by its corner grip.
  RC.onWindowResized = () => updateEnergyPanels();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.matches('input, textarea, button')) return;
    e.preventDefault();
    if (RC.sim.state === 'running') RC.pauseSim(); else RC.startSim();
    updateRideUI();
    state.dirty = true;
  });

  /* Windows open below the top bar, wherever the top bar happens to end.

     The bar wraps to a second row when its buttons will not fit on one, and a
     window pinned to a fixed 76 px would then be sitting underneath it. What
     makes it wrap is rarely the browser being resized — it is saving a track,
     which reveals the Delete button and widens the track list — so a resize
     listener alone would miss it. A ResizeObserver catches every cause.

     Only the DEFAULT position follows this. Once a window has been dragged or
     resized, ui.js writes an inline top and that quite rightly wins. */
  function syncChromeTop() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const bottom = bar.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--chrome-top', Math.round(bottom + 12) + 'px');
  }
  if (window.ResizeObserver) {
    const bar = document.querySelector('.topbar');
    if (bar) new ResizeObserver(syncChromeTop).observe(bar);
  }
  window.addEventListener('resize', syncChromeTop);
  syncChromeTop();

  /* Graph mode: the bar chart of the train's energy now, or one of the two
     line plots along the track. Each mode owns one canvas and one legend. */
  const graphModeBtns = document.querySelectorAll('#graph-modes [data-graph]');

  const graphAxisBtns = document.querySelectorAll('#graph-axes [data-axis]');

  function syncGraphMode() {
    const mode = RC.graphMode();
    const axis = RC.graphAxis();
    graphModeBtns.forEach(b => b.classList.toggle('active', b.dataset.graph === mode));
    graphAxisBtns.forEach(b => b.classList.toggle('active', b.dataset.axis === axis));
    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !on;
    };
    show('graph-bars', mode === 'bars');
    show('graph-line', mode !== 'bars');
    // The bars are a snapshot of now, so they have no axis to choose.
    show('graph-axes', mode !== 'bars');
    show('legend-bars', mode === 'bars');
    show('legend-energy', mode === 'energy');
    show('legend-accel', mode === 'accel');
    // Speed is a single line against a labelled axis, so it needs no key.
  }

  graphModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      RC.setGraphMode(btn.dataset.graph);
      syncGraphMode();
      updateEnergyPanels();
    });
  });

  graphAxisBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      RC.setGraphAxis(btn.dataset.axis);
      syncGraphMode();
      updateEnergyPanels();
    });
  });

  /* Pointing at the line plot reads off the values there. The crosshair is
     drawn by energy.js as part of the plot, which then publishes the sample it
     landed on; this turns that into words. Without it the only way to ask
     "what was the speed at 40 m" was to open the exported CSV. */
  const graphLine = document.getElementById('graph-line');
  if (graphLine) {
    graphLine.addEventListener('mousemove', e => {
      // fit() draws in CSS pixels, so an offset needs no scaling.
      RC.setGraphCursor(e.offsetX);
      updateEnergyPanels();
    });
    graphLine.addEventListener('mouseleave', () => {
      RC.setGraphCursor(null);
      updateEnergyPanels();
    });
  }

  function showGraphPick() {
    const row = document.getElementById('graph-pick-row');
    if (!row) return;
    const p = RC.graphCursor;
    row.hidden = !p;
    if (!p) return;
    const at = RC.graphAxis() === 's'
      ? `At ${p.s.toFixed(1)} m (${p.t.toFixed(1)} s)`
      : `At ${p.t.toFixed(1)} s (${p.s.toFixed(1)} m)`;
    setText('graph-pick-at', at);
    // Whatever the plot on show is about, plus height, which every mode needs.
    const mode = RC.graphMode();
    let vals;
    if (mode === 'accel') {
      // The shape as well as the force, since the whole question a g spike
      // raises is what the track is doing there to cause it.
      vals = `${p.vg.toFixed(2)} g vert, ${p.lg.toFixed(2)} g lat, ` +
             `${RC.radiusText(p.kv, p.kl)}`;
    } else if (mode === 'speed') {
      vals = `${p.v.toFixed(1)} m/s, ${p.h.toFixed(1)} m`;
    } else {
      vals = `${RC.fmtEnergy(p.ke)} kinetic, ${RC.fmtEnergy(p.pe)} potential, ` +
             `${p.v.toFixed(1)} m/s, ${p.h.toFixed(1)} m`;
    }
    setText('graph-pick-vals', vals);
  }

  /* Keep the working track for next time, a moment after the last edit rather
     than on every one — building a lift hill is a rapid burst of clicks, and
     serialising the whole track on each is wasted work. */
  let autosaveTimer = 0;
  let suppressAutosave = false;   // set while a preset or saved track is loaded
  function queueAutosave() {
    if (!RC.autosave || suppressAutosave) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { try { RC.autosave(); } catch (e) { /* not fatal */ } }, 400);
  }

  /* Called by build.js whenever the track is edited. */
  RC.onTrackEdit = function () {
    RC.pauseSim();
    RC.resetSim();
    RC.resetEnergyScale();
    // The release slider's range is the track length, so it has to follow.
    RC.syncTrainControls && RC.syncTrainControls();
    updateRideUI();
    queueAutosave();
  };

  /* ---- frame ------------------------------------------------------------ */
  let lastT = 0;
  function frame(t) {
    const dt = lastT ? (t - lastT) / 1000 : 0;
    lastT = t;

    // Keep stepping while a demo's slower trains are still coming down, even
    // once the ride's own train has finished.
    if (RC.sim.state === 'running' || (RC.demoRunning && RC.demoRunning())) {
      RC.stepSim(dt);
      updateRideUI();
      state.dirty = true;
    }

    // Keep the wreckage tumbling and settling after the run has ended.
    if (RC.sim.blast && RC.stepBlast(dt)) state.dirty = true;

    if (state.dirty) {
      state.dirty = false;
      render();
    }
    requestAnimationFrame(frame);
  }

  RC.requestRender = function () { state.dirty = true; };

  /* ---- presets and saved tracks -----------------------------------------
     Both live in the one dropdown, because from the student's side they are
     the same action: put a track on the screen. Saved ones carry a "save:"
     prefix so a track named after a preset cannot shadow it. */
  const presetSelect = document.getElementById('preset-select');
  const btnSave = document.getElementById('btn-save');
  const btnDeleteSave = document.getElementById('btn-delete-save');

  const SAVE_PREFIX = 'save:';
  const savedName = v => v.indexOf(SAVE_PREFIX) === 0 ? v.slice(SAVE_PREFIX.length) : null;

  function afterTrackChange() {
    // Putting someone else's track on the screen is not the student's work, so
    // it must not overwrite what they had half-built. Peeking at a preset and
    // leaving should bring you back to your own track, not to the preset.
    suppressAutosave = true;
    RC.refreshBuild();       // rebuilds palette state, resets the sim, resyncs controls
    suppressAutosave = false;
    RC.resetEnergyScale();
    updateRideUI();
    // A whole different track has just gone on the screen, so bring it into
    // view. Only ever called when one is loaded, never while building, so it
    // cannot yank the view around under someone laying track.
    centreOnTrack();
    state.dirty = true;
  }

  function loadPreset(key) {
    const res = RC.loadPrefab(key);
    if (!res.ok) {
      console.warn('Preset failed to build:', res.why);
      RC.resetTrack();
    }
    afterTrackChange();
    return res.ok;
  }

  /* Tracks that this build can no longer open, said out loud once on startup.

     Not window.alert. On a shared classroom login that fires for every student
     at the start of every lesson, in front of a track they cannot see yet, and
     it has to be dismissed before the page will do anything — which teaches
     people to dismiss it without reading. A banner sits there until it is
     acknowledged, and the park is usable behind it.

     Dismissal is remembered, so it is a message rather than a nag. The button
     that removes the stale tracks is separate and never automatic: a student
     may want to know the name of what they lost even when nothing can be done
     for it, and deleting someone's work to tidy up after ourselves is not a
     trade we get to make on their behalf. */
  const NOTICE_DISMISSED = 'physvys.rc.stale.seen';

  function showSaveNotice(restoreFailed) {
    const el = document.getElementById('save-notice');
    if (!el) return;

    let stale = [];
    try { stale = RC.staleSaves ? RC.staleSaves() : []; } catch (e) { stale = []; }
    if (!stale.length && !restoreFailed) { el.hidden = true; return; }

    // The signature of what is stale, so a notice dismissed today does not
    // stay dismissed when a different track goes bad tomorrow.
    const key = stale.map(n => n === null ? '(unfinished track)' : n).join('|');
    let seen = null;
    try { seen = window.localStorage.getItem(NOTICE_DISMISSED); } catch (e) { seen = null; }
    if (seen === key && !restoreFailed) { el.hidden = true; return; }

    const named = stale.filter(n => n !== null);
    const hadAuto = stale.some(n => n === null);
    const bits = [];
    if (hadAuto) bits.push('the track you were part way through');
    if (named.length) {
      bits.push(named.length === 1
        ? `your saved track “${named[0]}”`
        : `${named.length} of your saved tracks (${named.join(', ')})`);
    }

    let msg;
    if (bits.length) {
      msg = `The track pieces changed shape in this version, so ${bits.join(' and ')} ` +
            `cannot be opened any more. Nothing has been deleted.`;
    } else {
      msg = `The track you were part way through could not be opened: ${restoreFailed}. ` +
            `Nothing has been deleted.`;
    }

    el.innerHTML = '';
    const p = document.createElement('span');
    p.textContent = msg;
    el.appendChild(p);

    if (stale.length) {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'notice-btn';
      drop.textContent = stale.length === 1 ? 'Remove it' : 'Remove them';
      drop.addEventListener('click', () => {
        try { RC.dropStaleSaves(); } catch (e) { /* nothing more to do */ }
        refreshTrackList(presetSelect);
        el.hidden = true;
      });
      el.appendChild(drop);
    }

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'notice-btn';
    ok.textContent = !stale.length ? 'OK' : (stale.length === 1 ? 'Keep it' : 'Keep them');
    ok.addEventListener('click', () => {
      try { window.localStorage.setItem(NOTICE_DISMISSED, key); } catch (e) { /* fine */ }
      el.hidden = true;
    });
    el.appendChild(ok);

    el.hidden = false;
  }

  function setBuildMessage(text) {
    const el = document.getElementById('build-msg');
    if (el) el.textContent = text || '';
  }

  /* Rebuild the dropdown: the ready-made rides, then whatever the student has
     saved. Called again after every save and delete. */
  function refreshTrackList(select) {
    presetSelect.innerHTML = '';

    const presets = document.createElement('optgroup');
    presets.label = 'Ready-made';
    for (const key of Object.keys(RC.PREFABS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = RC.PREFABS[key].name;
      presets.appendChild(opt);
    }
    presetSelect.appendChild(presets);

    const names = RC.listSaves ? RC.listSaves() : [];
    if (names.length) {
      const mine = document.createElement('optgroup');
      mine.label = 'Saved';
      for (const name of names) {
        const opt = document.createElement('option');
        // The VALUE is the whole name — it is what loads and deletes the
        // track. Only what is shown is shortened, and the full name is on
        // hover for anyone whose names collide in the first fifteen.
        opt.value = SAVE_PREFIX + name;
        opt.textContent = RC.shortTrackName(name);
        opt.title = name;
        mine.appendChild(opt);
      }
      presetSelect.appendChild(mine);
    }

    if (select != null) presetSelect.value = select;
    btnDeleteSave.hidden = !savedName(presetSelect.value);
  }

  function chooseTrack(value) {
    const name = savedName(value);
    if (name === null) { loadPreset(value); btnDeleteSave.hidden = true; return; }
    const res = RC.loadSave(name);
    if (!res.ok) { setBuildMessage(res.why); return; }
    afterTrackChange();
    setBuildMessage('');
    btnDeleteSave.hidden = false;
  }

  function initTrackList(defaultKey) {
    refreshTrackList(defaultKey);
    presetSelect.addEventListener('change', () => chooseTrack(presetSelect.value));

    if (!RC.storageAvailable()) {
      // Nothing can be kept, so do not offer to keep it.
      btnSave.disabled = true;
      btnSave.title = 'This browser will not let the page store anything';
      return;
    }

    btnSave.addEventListener('click', () => {
      const current = savedName(presetSelect.value);
      const name = window.prompt('Name for this track:', current || '');
      if (name === null) return;                 // cancelled
      const res = RC.saveTrack(name);
      if (!res.ok) { setBuildMessage(res.why); return; }
      RC.autosave();
      refreshTrackList(SAVE_PREFIX + res.name);
      setBuildMessage(`Saved as "${res.name}".`);
    });

    btnDeleteSave.addEventListener('click', () => {
      const name = savedName(presetSelect.value);
      if (!name) return;
      if (!window.confirm(`Delete the saved track "${name}"?`)) return;
      RC.deleteSave(name);
      refreshTrackList(defaultKey);
      setBuildMessage(`Deleted "${name}".`);
    });
  }

  /* ---- handing work in ---------------------------------------------------
     The name is asked for once and kept, because a student exporting a second
     time after fixing something should not have to type it again. */
  const NAME_KEY = 'physvys.rc.student';

  function studentName(force) {
    let held = '';
    try { held = window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { held = ''; }
    if (held && !force) return held;
    const given = window.prompt('Your name, so your teacher knows whose this is:', held);
    if (given === null) return null;                 // cancelled
    try { window.localStorage.setItem(NAME_KEY, given.trim()); } catch (e) { /* fine */ }
    return given.trim();
  }

  const btnExport = document.getElementById('btn-export');
  const btnExportCsv = document.getElementById('btn-export-csv');

  // The Build window may well be closed while the Report is open, so this
  // reports next to the buttons that caused it rather than over there.
  function setExportMessage(text) {
    const el = document.getElementById('export-msg');
    if (el) el.textContent = text || '';
  }

  if (btnExport) btnExport.addEventListener('click', () => {
    const who = studentName(false);
    if (who === null) return;
    setExportMessage('Building the summary…');
    try {
      RC.exportSummary(who);
      setExportMessage('Summary saved to your downloads.');
    } catch (e) {
      console.warn('Export failed:', e);
      setExportMessage('Could not build the summary.');
    }
  });

  if (btnExportCsv) btnExportCsv.addEventListener('click', () => {
    const who = studentName(false);
    if (who === null) return;
    const res = RC.exportTraceCSV(who);
    setExportMessage(res.ok ? 'Data saved to your downloads.' : res.why);
  });

  RC.initWindows();
  syncGraphMode();

  /* Start with a working ride standing, so the page is useful before anything
     is clicked. Falls back to a bare station if the prefab ever fails. */
  const DEFAULT_TRACK = 'first-drop';
  const prefab = RC.loadPrefab(DEFAULT_TRACK);
  if (!prefab.ok) {
    console.warn('Prefab failed to build:', prefab.why);
    RC.resetTrack();
  }

  /* ...unless something was left half-built last visit, in which case that is
     what the student came back for. A save that cannot be read is not worth
     breaking the page over: the default ride is already standing behind it. */
  let opening = DEFAULT_TRACK;
  let restoreFailed = '';
  try {
    if (RC.hasAutosave && RC.hasAutosave()) {
      const back = RC.restoreAutosave();
      if (back.ok) opening = '';
      else restoreFailed = back.why;
    }
  } catch (e) {
    restoreFailed = (e && e.message) || String(e);
  }

  RC.initBuild();
  RC.resetSim();
  RC.resetEnergyScale();
  RC.initControls();
  initTrackList(opening);
  updateRideUI();
  showSaveNotice(restoreFailed);
  // Whatever ended up standing — the default ride or a half-built track from
  // last visit — is what the page should open looking at. A track built
  // against an edge of the park is nowhere near the middle of it.
  centreOnTrack();
  resize();
  requestAnimationFrame(frame);
})();
