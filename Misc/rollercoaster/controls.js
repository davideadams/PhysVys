/* The Train window: everything about the train and the losses.

   Each control is a range paired with a number box, two-way bound and
   clamped, which is the standard PhysVys pattern. Changing anything resets
   the run, because a half-finished ride simulated under two different sets
   of numbers would be meaningless. */
(function () {
  const RC = window.RC || (window.RC = {});

  /* key, element id, [min, max, step], decimals, and how it reaches the sim.
     `live` controls stay meaningful mid-run; the rest force a reset. */
  const CONTROLS = [
    { id: 'cars', min: 1, max: 8, step: 1, dp: 0, get: () => RC.sim.cars, set: v => { RC.sim.cars = Math.round(v); } },
    { id: 'release', min: 0, max: 100, step: 0.5, dp: 1, get: () => releaseValue(), set: v => { RC.sim.releaseS = v; } },
    { id: 'lift', min: 1, max: 12, step: 0.5, dp: 1, get: () => RC.sim.liftSpeed, set: v => { RC.sim.liftSpeed = v; } },
    { id: 'brake', min: 0, max: 12, step: 0.5, dp: 1, get: () => RC.sim.brakeSpeed, set: v => { RC.sim.brakeSpeed = v; } },
    { id: 'launch', min: 5, max: 40, step: 1, dp: 0, get: () => RC.sim.launchSpeed, set: v => { RC.sim.launchSpeed = v; } },
    { id: 'mu', min: 0, max: 0.06, step: 0.002, dp: 3, get: () => RC.sim.mu, set: v => { RC.sim.mu = v; } },
    { id: 'drag', min: 0, max: 0.005, step: 0.0002, dp: 4, get: () => RC.sim.kDrag, set: v => { RC.sim.kDrag = v; } }
  ];

  function releaseValue() {
    if (RC.sim.releaseS != null) return RC.sim.releaseS;
    return RC.defaultBerth();
  }

  const els = new Map();

  function clamp(v, c) {
    if (!isFinite(v)) return c.get();
    return Math.min(c.max, Math.max(c.min, v));
  }

  function apply(c, raw) {
    const v = clamp(raw, c);
    c.set(v);
    syncOne(c);
    restart();
  }

  function syncOne(c) {
    const e = els.get(c.id);
    if (!e) return;
    const v = c.get();
    e.range.min = c.min;
    e.range.max = c.max;
    e.range.step = c.step;
    e.range.value = v;
    e.num.min = c.min;
    e.num.max = c.max;
    e.num.step = c.step;
    e.num.value = Number(v).toFixed(c.dp);
  }

  /* Any change invalidates a run in progress. */
  function restart() {
    RC.pauseSim();
    RC.resetSim();
    RC.resetEnergyScale && RC.resetEnergyScale();
    RC.updateRideUI && RC.updateRideUI();
    RC.requestRender && RC.requestRender();
    syncDerived();
  }

  function syncDerived() {
    const mass = RC.trainMass();
    const massEl = document.getElementById('ro-train-mass');
    if (massEl) massEl.textContent = (mass / 1000).toFixed(1) + ' t';

    const p = RC.pathAt(RC.sim.s, RC.isClosed());
    const hEl = document.getElementById('ro-release-h');
    if (hEl) hEl.textContent = p ? (p.z * RC.LEVEL_M).toFixed(1) + ' m up' : '—';

    // The friction sliders do nothing while friction is off.
    const on = RC.sim.friction;
    for (const id of ['mu', 'drag']) {
      const e = els.get(id);
      if (!e) continue;
      e.range.disabled = !on;
      e.num.disabled = !on;
      if (e.row) e.row.classList.toggle('dimmed', !on);
    }
    const fb = document.getElementById('btn-friction');
    if (fb) {
      fb.classList.toggle('active', on);
      fb.textContent = on ? 'Friction on' : 'Friction off';
    }
  }

  /* The release slider's range depends on the track, so it has to be
     refreshed whenever the track changes. */
  RC.syncTrainControls = function () {
    const total = RC.trackPath().total;
    const release = CONTROLS.find(c => c.id === 'release');
    release.max = Math.max(1, Math.round(total * 2) / 2);
    if (RC.sim.releaseS != null && RC.sim.releaseS > release.max) {
      RC.sim.releaseS = release.max;
    }
    for (const c of CONTROLS) syncOne(c);
    syncDerived();
  };

  RC.initControls = function () {
    for (const c of CONTROLS) {
      const range = document.getElementById('sl-' + c.id);
      const num = document.getElementById('val-' + c.id);
      if (!range || !num) continue;
      els.set(c.id, { range, num, row: range.closest('.control-group') });

      range.addEventListener('input', () => apply(c, parseFloat(range.value)));
      // Commit the box on change rather than input, so half-typed numbers
      // don't get clamped out from under the cursor.
      num.addEventListener('change', () => apply(c, parseFloat(num.value)));
    }

    const fb = document.getElementById('btn-friction');
    if (fb) fb.addEventListener('click', () => {
      RC.sim.friction = !RC.sim.friction;
      restart();
    });

    const rb = document.getElementById('btn-release-station');
    if (rb) rb.addEventListener('click', () => {
      RC.sim.releaseS = null;          // back to the default berth
      RC.syncTrainControls();
      restart();
    });

    RC.syncTrainControls();
  };
})();
