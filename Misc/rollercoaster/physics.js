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
  const STATION_BRAKE = 5;      // m/s^2 once the lap is done
  const STATION_DISPATCH = 2.5; // m/s — drive tyres pushing the train out

  RC.sim = {
    state: 'ready',      // ready | running | finished | valleyed | stopped
    s: 0, v: 0, time: 0,

    cars: 4,
    releaseS: null,      // metres along the track, or null for the station
    liftSpeed: 4.0,      // m/s — chain lift
    brakeSpeed: 3.0,     // m/s — brake run target
    launchSpeed: 22.0,   // m/s — shuttle launch

    friction: false,
    mu: 0.02,            // rolling resistance
    // Air drag per unit mass, so the deceleration is kDrag * v^2. This is
    // half.rho.Cd.A / m: about 0.5 * 1.2 * 1.0 * 4 m^2 / 2000 kg for a
    // four-car train.
    kDrag: 0.0012,

    E0: 0, eMotor: 0, eThermal: 0,
    maxV: 0, maxG: 0, maxZ: 0,
    g: { vert: 1, lat: 0, long: 0 },
    maxVertG: 1, minVertG: 1, maxLatG: 0,
    warnings: [],
    trace: [],
    note: ''
  };

  RC.trainMass = () => RC.sim.cars * CAR_MASS;
  RC.CAR_SPACING = CAR_SPACING;

  /* Where the front car parks by default: the station exit, so the train sits
     back inside the station. Falls back to clearing the train's own length off
     the start when there's no station (custom tracks, tests). */
  RC.defaultBerth = function () {
    const total = RC.trackPath().total;
    const st = RC.stationEndS();
    return Math.min(st > 0 ? st : CAR_SPACING * RC.sim.cars, total);
  };

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

  /* Orthonormal frame for a car at path point p, in METRES so the pitch is a
     true angle rather than one distorted by the tile/level scale difference.

       f — forward, the full 3D tangent, so the car pitches with the track
       r — right, horizontal by construction (f x up)
       u — up, perpendicular to the track surface (r x f)

     Returned in metre-space; the renderer divides back by TILE_M / LEVEL_M. */
  /* The frame is built once per track version by track.js, parallel-
     transported along the path so it can invert through a loop, with any bank
     already rolled in. Both entry points below just read it — interpolating
     between two path points can leave the axes slightly non-orthogonal, so
     they are tidied up here. */
  function tidy(fx, fy, fz, ux, uy, uz) {
    let fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-9) { fx = 1; fy = 0; fz = 0; fl = 1; }
    fx /= fl; fy /= fl; fz /= fl;

    // Re-orthogonalise up against forward.
    const d = ux * fx + uy * fy + uz * fz;
    ux -= d * fx; uy -= d * fy; uz -= d * fz;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-9) {
      ux = -fz * fx; uy = -fz * fy; uz = 1 - fz * fz;
      ul = Math.hypot(ux, uy, uz) || 1;
    }
    ux /= ul; uy /= ul; uz /= ul;

    // r = u x f completes a right-handed triad.
    const rx = uy * fz - uz * fy;
    const ry = uz * fx - ux * fz;
    const rz = ux * fy - uy * fx;

    return {
      f: { x: fx, y: fy, z: fz },
      r: { x: rx, y: ry, z: rz },
      u: { x: ux, y: uy, z: uz }
    };
  }

  RC.carFrame = function (p) {
    if (p.fx === undefined) return tidy(1, 0, 0, 0, 0, 1);
    return tidy(p.fx, p.fy, p.fz, p.ux, p.uy, p.uz);
  };

  RC.frameAtPoint = function (pts, idx) {
    const p = pts[idx];
    return tidy(p.fx, p.fy, p.fz, p.ux, p.uy, p.uz);
  };

  /* What the rider feels, resolved onto the car's own axes.

     The seat has to supply the train's acceleration AND hold the rider up
     against gravity, so the specific force is (a - g_vector). Projected onto
     the car frame that gives:

       vertical    +1 sitting still on level track; 0 is weightless and
                   negative is airtime, being lifted out of the seat
       lateral     sideways, the force an unbanked turn throws at you
       longitudinal fore and aft, from braking and the chain lift

     Signs follow the car's axes: lateral is positive towards the rider's
     right, longitudinal positive forwards. */
  RC.gForces = function (p, v, aTangential) {
    if (!p) return { vert: 1, lat: 0, long: 0 };
    const fr = RC.carFrame(p);
    const vv = v * v;

    // Acceleration = along the track + towards the centre of curvature.
    const ax = aTangential * fr.f.x + vv * (p.kx || 0);
    const ay = aTangential * fr.f.y + vv * (p.ky || 0);
    const az = aTangential * fr.f.z + vv * (p.kz || 0);

    // Specific force: subtract gravity, which points down.
    const Ax = ax, Ay = ay, Az = az + G;

    return {
      vert: (Ax * fr.u.x + Ay * fr.u.y + Az * fr.u.z) / G,
      lat: (Ax * fr.r.x + Ay * fr.r.y + Az * fr.r.z) / G,
      long: (Ax * fr.f.x + Ay * fr.f.y + Az * fr.f.z) / G
    };
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
    // Where the train starts: an explicit argument, else the release point the
    // student has chosen, else the station berth (front car at the exit).
    sim.s = startS != null ? startS
          : (sim.releaseS != null ? Math.min(sim.releaseS, path.total) : RC.defaultBerth());
    sim.startS = sim.s;      // the berth the train must return to
    sim.lapDone = false;
    sim.v = 0;
    sim.time = 0;
    sim.eMotor = 0;
    sim.eThermal = 0;
    sim.maxV = 0;
    sim.maxG = 0;
    sim.maxZ = 0;
    sim.warnings = [];
    sim.trace = [];

    // Seed the g extremes from the train standing still, so an untouched
    // report reads 1.00 g rather than an empty range.
    const rest = RC.gForces(RC.pathAt(sim.s, closed()), 0, 0);
    sim.g = rest;
    sim.maxVertG = rest.vert;
    sim.minVertG = rest.vert;
    sim.maxLatG = Math.abs(rest.lat);
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

    // Station dispatch: while the train is still in the station on its way out
    // (before it has completed a lap), the station's drive tyres push it
    // forward onto the lift. Without this a train parked at the station exit
    // just creeps backward down the faint uphill of the lift ahead and never
    // reaches the chain. Booked as motor work, like the lift and launch.
    const onStation = cars.some(p => p.def && p.def.station);
    if (onStation && !sim.lapDone && sim.v < STATION_DISPATCH && sim.state === 'running') {
      const before = 0.5 * m * sim.v * sim.v;
      const after = 0.5 * m * STATION_DISPATCH * STATION_DISPATCH;
      sim.eMotor += after - before;
      sim.v = STATION_DISPATCH;
    }

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

    // G-forces at the front car, where the ride is most extreme.
    const g = RC.gForces(lead, sim.v, a);
    sim.g = g;
    sim.maxVertG = Math.max(sim.maxVertG, g.vert);
    sim.minVertG = Math.min(sim.minVertG, g.vert);
    sim.maxLatG = Math.max(sim.maxLatG, Math.abs(g.lat));
    sim.maxG = Math.max(sim.maxG, Math.abs(g.vert));

    // Thresholds roughly follow real ride-comfort limits.
    if (g.vert < 0) addWarning('Airtime — riders are lifted out of their seats here');
    if (g.vert < -1.5) addWarning(`Dangerous negative g (${g.vert.toFixed(1)}) — riders would be thrown from the train`);
    if (g.vert > 5) addWarning(`Punishing vertical g (${g.vert.toFixed(1)}) on a curve`);
    if (Math.abs(g.lat) > 1.8) addWarning(`Violent sideways force (${Math.abs(g.lat).toFixed(1)} g) — this turn needs banking`);
    else if (Math.abs(g.lat) > 1.0) addWarning(`Uncomfortable sideways force (${Math.abs(g.lat).toFixed(1)} g) on a turn`);
    if (sim.maxV > 45) addWarning(`Train reaches ${sim.maxV.toFixed(0)} m/s — too fast to be safe`);

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

    // End of the ride. Crossing the finish is not the end of the run: the
    // train still has to pull round into the station and stop where it
    // started, the way it does in the real thing.
    if (c) {
      if (!sim.lapDone && sim.s >= path.total) {
        sim.s -= path.total;
        sim.sMax = sim.s;
        sim.lapDone = true;
      }
      if (sim.lapDone) {
        const onStation = cars.some(p => p.def && p.def.station);
        if (onStation && sim.v > 0) {
          const dv = Math.min(sim.v, STATION_BRAKE * dt);
          const after = sim.v - dv;
          sim.eThermal += 0.5 * m * (sim.v * sim.v - after * after);
          sim.v = after;
        }
        const berthed = sim.s >= sim.startS;
        // Below a crawl the station's drive tyres see it home; without this
        // a train that brakes early would stall short of its berth.
        const crawling = sim.v < 0.5;
        if (berthed || crawling) {
          sim.eThermal += 0.5 * m * sim.v * sim.v;
          sim.s = sim.startS;
          sim.v = 0;
          sim.state = 'finished';
          sim.note = 'Completed the circuit and returned to the station.';
        }
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

  /* ---- trace ------------------------------------------------------------
     One sample per frame, not per substep — the graph only needs enough
     points to draw a smooth line, and 240 Hz would fill the cap in seconds. */
  const TRACE_CAP = 4000;

  function record() {
    const sim = RC.sim;
    if (sim.trace.length >= TRACE_CAP) return;
    const e = RC.energy();
    sim.trace.push({
      s: sim.s, t: sim.time, v: Math.abs(sim.v), h: e.h,
      ke: e.ke, pe: e.pe, th: e.thermal, total: e.total, supplied: e.supplied,
      vg: sim.g.vert, lg: sim.g.lat
    });
  }
  RC.recordTrace = record;

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
    record();
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
