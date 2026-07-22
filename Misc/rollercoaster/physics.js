/* Train physics: a bead on a wire, run along RC.trackPath()'s arc-length
   table so the simulated path is literally the drawn one.

   The train is NOT a point mass. Its cars are spread along the track and
   share one speed, so the driving force uses the MEAN slope under the cars
   and the potential energy uses their MEAN height. That is why a long train
   crests a hill differently from a short one, and it is what makes the car
   count a real physical control rather than decoration. */
(function () {
  const RC = window.RC || (window.RC = {});

  const G = 9.81;
  const CAR_SPACING = 3.5;   // metres between car centres
  const CAR_MASS = 500;      // kg per car including riders

  const SUBSTEP = 1 / 240;   // s — fixed physics step
  const MAX_FRAME = 0.1;     // s — ignore huge gaps after a tab switch

  RC.sim = {
    state: 'ready',      // ready | running | finished | valleyed | stopped
    s: 0, v: 0, time: 0,

    cars: 4,
    liftSpeed: 4.0,      // m/s — chain lift
    brakeSpeed: 3.0,     // m/s — brake run target
    launchSpeed: 22.0,   // m/s — shuttle launch

    friction: false,
    mu: 0.02,            // rolling resistance
    kDrag: 0.0022,       // air drag, per unit mass

    E0: 0, eMotor: 0, eThermal: 0,
    maxV: 0, maxG: 0, maxZ: 0,
    warnings: [],
    note: ''
  };

  RC.trainMass = () => RC.sim.cars * CAR_MASS;
  RC.CAR_SPACING = CAR_SPACING;

  function closed() {
    const st = RC.circuitStatus();
    return st.kind === 'closed' || st.kind === 'closed-nostation';
  }
  RC.isClosed = closed;

  /* Where each car sits, front car first. */
  RC.carStates = function () {
    const sim = RC.sim;
    const c = closed();
    const out = [];
    for (let n = 0; n < sim.cars; n++) {
      const p = RC.pathAt(sim.s - n * CAR_SPACING, c);
      if (p) out.push(p);
    }
    return out;
  };

  function meanOf(cars, key) {
    if (!cars.length) return 0;
    let t = 0;
    for (const c of cars) t += c[key];
    return t / cars.length;
  }

  /* Energy, all in joules, computed from the exact state — never from
     anything the renderer approximates. */
  RC.energy = function () {
    const sim = RC.sim;
    const m = RC.trainMass();
    const cars = RC.carStates();
    const h = meanOf(cars, 'z') * RC.LEVEL_M;
    const ke = 0.5 * m * sim.v * sim.v;
    const pe = m * G * h;
    return {
      ke, pe, h,
      thermal: sim.eThermal,
      motor: sim.eMotor,
      total: ke + pe + sim.eThermal,
      supplied: sim.E0 + sim.eMotor
    };
  };

  function addWarning(msg) {
    const sim = RC.sim;
    if (!sim.warnings.includes(msg)) sim.warnings.push(msg);
  }

  /* ---- reset ----------------------------------------------------------- */
  RC.resetSim = function (startS) {
    const sim = RC.sim;
    const path = RC.trackPath();
    sim.s = startS != null ? startS : Math.min(CAR_SPACING * sim.cars, path.total);
    sim.v = 0;
    sim.time = 0;
    sim.eMotor = 0;
    sim.eThermal = 0;
    sim.maxV = 0;
    sim.maxG = 0;
    sim.maxZ = 0;
    sim.warnings = [];
    sim.note = '';
    sim.state = 'ready';
    sim.reversals = 0;
    sim.lastVSign = 0;
    sim.sMax = sim.s;
    sim.stallTime = 0;

    const cars = RC.carStates();
    const m = RC.trainMass();
    sim.E0 = m * G * meanOf(cars, 'z') * RC.LEVEL_M;   // at rest, so no KE
    return sim;
  };

  /* ---- one physics substep --------------------------------------------- */
  function substep(dt) {
    const sim = RC.sim;
    const m = RC.trainMass();
    const c = closed();
    const path = RC.trackPath();
    const cars = RC.carStates();
    if (!cars.length) return;

    const slope = meanOf(cars, 'dzds');          // sin of pitch, averaged
    const cosPitch = Math.sqrt(Math.max(0, 1 - Math.min(1, slope * slope)));

    // Gravity along the track.
    let a = -G * slope;

    // Resistances always oppose motion.
    if (sim.friction && Math.abs(sim.v) > 1e-6) {
      const sign = Math.sign(sim.v);
      const aFric = sim.mu * G * cosPitch + sim.kDrag * sim.v * sim.v;
      a -= sign * aFric;
      sim.eThermal += m * aFric * Math.abs(sim.v) * dt;
    }

    sim.v += a * dt;

    // Chain lift: holds the train at lift speed. The kinetic energy it has
    // to put back in is exactly the motor's work.
    const onLift = cars.some(p => p.piece && p.piece.lift);
    if (onLift && sim.v < sim.liftSpeed) {
      const before = 0.5 * m * sim.v * sim.v;
      const after = 0.5 * m * sim.liftSpeed * sim.liftSpeed;
      sim.eMotor += after - before;
      sim.v = sim.liftSpeed;
    }

    // Launch track, for shuttle rides.
    const onLaunch = cars.some(p => p.def && p.def.launch);
    if (onLaunch && sim.v < sim.launchSpeed && sim.state === 'running') {
      const before = 0.5 * m * sim.v * sim.v;
      const after = 0.5 * m * sim.launchSpeed * sim.launchSpeed;
      sim.eMotor += after - before;
      sim.v = sim.launchSpeed;
    }

    // Brakes bleed energy to heat.
    const onBrake = cars.some(p => p.def && p.def.brake);
    if (onBrake && Math.abs(sim.v) > sim.brakeSpeed) {
      const target = Math.sign(sim.v) * sim.brakeSpeed;
      const dv = target - sim.v;
      const lost = 0.5 * m * (sim.v * sim.v - target * target);
      sim.eThermal += Math.max(0, lost);
      sim.v += dv;
    }

    sim.s += sim.v * dt;
    sim.time += dt;

    // Track the extremes for the ride report.
    const lead = cars[0];
    sim.maxV = Math.max(sim.maxV, Math.abs(sim.v));
    sim.maxZ = Math.max(sim.maxZ, lead.z * RC.LEVEL_M);

    // Vertical g: centripetal term plus the component of gravity the track
    // has to carry. Negative means the train is being lifted off the rails.
    const n = (sim.v * sim.v * lead.curv) / G + cosPitch;
    sim.maxG = Math.max(sim.maxG, Math.abs(n));
    if (n < 0) addWarning('Train would leave the track — not enough speed for this curve');
    if (Math.abs(n) > 6) addWarning(`Ride is too rough — ${Math.abs(n).toFixed(1)} g on a curve`);
    if (sim.maxV > 45) addWarning(`Train reaches ${(sim.maxV * 3.6).toFixed(0)} km/h — too fast to be safe`);

    // Valleying: sign changes with no forward progress.
    const vs = Math.sign(sim.v);
    if (vs !== 0 && sim.lastVSign !== 0 && vs !== sim.lastVSign) sim.reversals++;
    if (vs !== 0) sim.lastVSign = vs;
    if (sim.s > sim.sMax) { sim.sMax = sim.s; sim.stallTime = 0; }
    else sim.stallTime += dt;

    if (sim.reversals >= 4 && sim.stallTime > 3) {
      sim.state = 'valleyed';
      sim.note = 'The train valleyed — it never had enough energy for the next hill.';
      addWarning('Train valleys and rolls back');
      return;
    }

    // End of the ride.
    if (c) {
      if (sim.s >= path.total) {
        sim.s -= path.total;
        sim.sMax = sim.s;
        sim.state = 'finished';
        sim.note = 'Completed the circuit.';
      }
    } else {
      // Hitting either end stops the train dead. That kinetic energy has to
      // go somewhere or the conservation readout would spring a leak.
      const stop = (where, why) => {
        sim.eThermal += 0.5 * m * sim.v * sim.v;
        sim.s = where;
        sim.v = 0;
        sim.state = 'stopped';
        sim.note = why;
      };
      if (sim.s >= path.total) stop(path.total, 'Reached the end of the track.');
      else if (sim.s <= 0) stop(0, 'Rolled back to the start.');
    }
  }

  /* ---- frame ----------------------------------------------------------- */
  RC.stepSim = function (dtFrame) {
    const sim = RC.sim;
    if (sim.state !== 'running') return false;
    let dt = Math.min(MAX_FRAME, Math.max(0, dtFrame));
    while (dt > 0 && sim.state === 'running') {
      const step = Math.min(SUBSTEP, dt);
      substep(step);
      dt -= step;
    }
    return true;
  };

  RC.startSim = function () {
    const sim = RC.sim;
    const st = RC.circuitStatus();
    if (!st.ok) {
      sim.note = st.label + ' — finish the track before testing.';
      return false;
    }
    if (sim.state !== 'running') {
      if (sim.state !== 'ready') RC.resetSim();
      sim.state = 'running';
      sim.note = '';
    }
    return true;
  };

  RC.pauseSim = function () {
    if (RC.sim.state === 'running') RC.sim.state = 'ready';
  };
})();
