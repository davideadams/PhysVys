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
  RC.G = G;                  // track.js reads it for the geometry readout
  const CAR_SPACING = 3.5;   // metres between car centres
  const CAR_MASS = 500;      // kg per car including riders — the default

  /* Rolling resistance, and the one free parameter in the loss model — unlike
     the drag constant below it is not derived from anything, it was picked so
     that losses are VISIBLE over a ride in a sim about losses.

     It came down from 0.02 when the tile went from 4 m to 6 m. Rolling
     resistance is a force times a distance, so a track 1.5x longer in metres
     loses 1.5x more at the same coefficient — and the shallower grades raise
     cos(pitch), which takes a little more again. At 0.02 the default ride no
     longer made it home, which is a poor advert for the defaults. Scaling by
     the same 1.5 restores the energy budget and lands nearer real steel-on-steel
     figures (0.005 to 0.01) than 0.02 was, so it costs no honesty. */
  const DEFAULT_MU = 0.013;
  RC.DEFAULT_MU = DEFAULT_MU;

  const SUBSTEP = 1 / 240;   // s — fixed physics step
  const MAX_FRAME = 0.1;     // s — ignore huge gaps after a tab switch
  const STATION_BRAKE = 5;      // m/s^2 once the lap is done
  const STATION_DISPATCH = 2.5; // m/s — drive tyres pushing the train out
  const STATION_HOME = 1.5;     // m/s — and walking it back into its berth
  /* m/s^2 — how hard a brake run bites. About 1.5 g, which is a firm but
     ordinary trim brake; two pieces of it take a train from 16 m/s to a walk,
     which is roughly what the old instant clamp did. */
  const BRAKE_DECEL = 15;

  /* ---- what a real coaster is allowed to pull ---------------------------
     Roughly the envelopes in the ride-design standards (ASTM F2291 and
     EN 13814). Both are DURATION-dependent — a coaster may pull far more for
     a fraction of a second than it may sustain — and this sim tests
     instantaneous peaks, so these are the short-burst figures, not the
     sustained ones. A real ride sits well inside them.

     The important consequence: AIRTIME IS THE POINT OF A COASTER, not a
     fault. Floater airtime around -0.2 to -0.5 g is what an airtime hill is
     built for, and ejector airtime near -1 g is a selling point. So negative
     vertical g is reported as a feature and only flagged once it passes what
     a restraint is designed to hold. The old code warned at ANY negative g,
     which flagged every good hill on the ride. */
  RC.G_LIMITS = {
    vertHigh: 5.0,       // heavy; the standards' short-burst ceiling is ~6 g
    vertExtreme: 6.0,    // beyond what any real coaster pulls
    airtimeGood: -1.1,   // strong ejector airtime, still within EN 13814
    airtimeHard: -1.5,   // past the short-burst limit for restraints
    latHigh: 1.5,        // real coasters bank turns to stay under this
    latExtreme: 1.8,     // violent; the turn needs banking or widening
    speedMax: 45         // m/s — faster than any coaster ever built
  };

  RC.sim = {
    state: 'ready',      // ready | running | finished | valleyed | stopped | crashed
    s: 0, v: 0, time: 0,

    // Set once the front of the train has run past the end of the track (or
    // lost its grip in a loop). The cars beyond that point hang on a ballistic
    // continuation of the track, still coupled to the ones behind. Null the
    // rest of the time. See buildOverhang.
    overhang: null,
    blast: null,         // wreckage, once it has hit the ground
    crashSpeed: 0,       // m/s it struck the ground at
    wrecked: false,      // destroyed: all its energy has gone to heat

    cars: 4,
    carMass: CAR_MASS,   // kg each, riders included — see RC.trainMass
    releaseS: null,      // metres along the track, or null for the station
    liftSpeed: 4.0,      // m/s — chain lift
    brakeSpeed: 3.0,     // m/s — brake run target
    launchSpeed: 22.0,   // m/s — shuttle launch

    // When the track isn't a closed loop, run it as an out-and-back shuttle
    // rather than refusing to test. On by default, so Test always does
    // something; a student can switch it off to insist on a full circuit.
    shuttleMode: true,

    friction: false,
    mu: DEFAULT_MU,      // rolling resistance
    // Air drag per unit mass, so the deceleration is kDrag * v^2. This is
    // half.rho.Cd.A / m: about 0.5 * 1.2 * 1.0 * 4 m^2 / 2000 kg for a
    // four-car train.
    kDrag: 0.0012,

    E0: 0, eMotor: 0, eThermal: 0,
    maxV: 0, maxG: 0, maxZ: 0,
    g: { vert: 1, lat: 0, long: 0 },
    // The shape of the track under the front car: curvature in the vertical
    // plane (crests and valleys) and in the horizontal one (turning), 1/m.
    kVert: 0, kLat: 0,
    // The worst jolt taken at each joint, indexed to match RC.jointSteps().
    jolts: [],
    maxVertG: 1, minVertG: 1, maxLatG: 0,
    // Arc position of each of those extremes, for naming the feature to blame.
    maxVertGs: 0, minVertGs: 0, maxLatGs: 0,
    warnings: [],
    warnKeys: {},
    warnSeverity: {},
    trace: [],
    note: ''
  };

  /* Mass and LENGTH are separate controls on purpose. Adding cars does both —
     it makes the train heavier and it spreads it further along the track — and
     the length genuinely changes the physics, because the driving force uses
     the mean slope under the cars. So a student answering "does mass matter?"
     by dragging the car count is moving two variables at once and cannot get a
     clean answer. Mass per car moves only the one. */
  RC.trainMass = () => RC.sim.cars * RC.sim.carMass;
  RC.CAR_SPACING = CAR_SPACING;

  /* Where the front car parks by default: the station exit, so the train sits
     back inside the station. Falls back to clearing the train's own length off
     the start when there's no station (custom tracks, tests). */
  RC.defaultBerth = function () {
    // A demo's trains are all released from the very top of their hills, so
    // they start from the same height. Clearing a train's length off the start
    // here would set this one off lower than the ones it is being compared to.
    if (RC.demo) return 0;
    const total = RC.trackPath().total;
    const st = RC.stationEndS();
    return Math.min(st > 0 ? st : CAR_SPACING * RC.sim.cars, total);
  };

  function closed() {
    const st = RC.circuitStatus();
    return st.kind === 'closed' || st.kind === 'closed-nostation';
  }
  RC.isClosed = closed;

  function shuttle() {
    const st = RC.circuitStatus();
    return st.kind === 'shuttle' || st.kind === 'shuttle-nostation';
  }
  RC.isShuttle = shuttle;

  /* Where each car sits, front car first. Cars that have gone past the end of
     the track sit on the overhang — the hanging continuation — instead. */
  RC.carStates = function () {
    const sim = RC.sim;
    const c = closed();
    const oh = sim.overhang;
    const out = [];
    for (let n = 0; n < sim.cars; n++) {
      const s = sim.s - n * CAR_SPACING;
      // Once the train has tipped, every car is off the rails — including the
      // ones still short of the edge, which trail back along the arc.
      const off = oh && (oh.committed || s > oh.s0);
      const p = off ? RC.overhangAt(s - oh.s0) : RC.pathAt(s, c);
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
    if (sim.wrecked) {
      // Destroyed: everything it had — motion and height — has become heat and
      // scattered wreckage, so there is no train left to hold energy.
      return {
        ke: 0, pe: 0, h: 0,
        thermal: sim.eThermal,
        motor: sim.eMotor,
        total: sim.eThermal,
        supplied: sim.E0 + sim.eMotor
      };
    }
    // The overhang is part of the wire, so hanging cars need no special case:
    // their height and slope come back from carStates like any others.
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

  /* One line per problem per feature, showing the WORST it got. A g-force
     complaint fires on every substep it holds for, so without this the report
     filled up with "4.3 g on Turn 1", "4.2 g on Turn 1", "4.1 g on Turn 1"…
     `key` groups them and `severity` decides which reading survives. */
  function addWarning(msg, key, severity) {
    const sim = RC.sim;
    const k = key || msg;
    const at = sim.warnKeys[k];
    const sev = severity || 0;
    if (at === undefined) {
      sim.warnKeys[k] = sim.warnings.length;
      sim.warnSeverity[k] = sev;
      sim.warnings.push(msg);
    } else if (sev > sim.warnSeverity[k]) {
      sim.warnSeverity[k] = sev;
      sim.warnings[at] = msg;
    }
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
    sim.launchedOut = false; // shuttle: has it left the station yet
    sim.overhang = null;     // nothing hanging off the end
    sim.blast = null;        // no wreckage
    sim.crashSpeed = 0;
    sim.wrecked = false;
    sim.v = 0;
    sim.time = 0;
    sim.eMotor = 0;
    sim.eThermal = 0;
    sim.maxV = 0;
    sim.maxG = 0;
    sim.maxZ = 0;
    sim.vGround = null;      // speed on first reaching ground, for a demo
    sim.tGround = null;
    sim.warnings = [];
    sim.warnKeys = {};       // key -> index in warnings, so repeats collapse
    sim.warnSeverity = {};   // key -> worst reading seen for that key
    sim.trace = [];
    sim.jolts = [];          // indexed by joint; sparse until one is crossed
    sim.kVert = 0;
    sim.kLat = 0;

    // Seed the g extremes from the train standing still, so an untouched
    // report reads 1.00 g rather than an empty range.
    const rest = RC.gForces(RC.pathAt(sim.s, closed()), 0, 0);
    sim.g = rest;
    sim.maxVertG = rest.vert;
    sim.minVertG = rest.vert;
    sim.maxLatG = Math.abs(rest.lat);
    sim.maxVertGs = sim.s;
    sim.minVertGs = sim.s;
    sim.maxLatGs = sim.s;
    sim.note = '';
    sim.state = 'ready';
    sim.reversals = 0;
    sim.lastVSign = 0;
    sim.sMax = sim.s;
    sim.stallTime = 0;

    const cars = RC.carStates();
    const m = RC.trainMass();
    sim.E0 = m * G * meanOf(cars, 'z') * RC.LEVEL_M;   // at rest, so no KE
    RC.resetDemo();      // comparison trains go back to the top with it
    return sim;
  };

  /* Gravity along the track, plus the resistances, for a train whose cars are
     at `cars`. Shared by the ride and by a demo's comparison trains, so those
     are running the same physics rather than a second, subtly different copy
     of it — which for a demonstration about conservation of energy is rather
     the point.

     Heat comes back per METRE travelled, not per second. Friction is a force,
     and the energy it takes is that force times the distance the train
     actually moves in the step — so charging it against the same displacement
     that gravity is charged against keeps the two exactly in step. Billing it
     per second instead used the speed at the START of the step against a
     displacement made at the MEAN speed, which is a small mismatch that
     accumulates over thousands of steps. Signed, so a train that reverses
     inside a single step is still booked consistently. */
  function rollingForces(cars, v, mass) {
    const slope = meanOf(cars, 'dzds');          // sin of pitch, averaged
    const cosPitch = Math.sqrt(Math.max(0, 1 - Math.min(1, slope * slope)));

    let a = -G * slope;                          // gravity along the track
    let heatPerM = 0;

    // Resistances always oppose motion.
    const sim = RC.sim;
    if (sim.friction && Math.abs(v) > 1e-6) {
      const aFric = sim.mu * G * cosPitch + sim.kDrag * v * v;
      const dir = Math.sign(v);
      a -= dir * aFric;
      heatPerM = mass * aFric * dir;
    }
    return { a, heatPerM };
  }

  /* Advance a bead on the wire by one step, and say how far it went.

     The order here is the whole of the energy bookkeeping, so it is worth
     being explicit about. Gravity changes the speed over the step, which
     changes the kinetic energy by m*a*v_mean*dt where v_mean is the MEAN speed
     across the step. The potential energy changes by m*g*slope*ds. Those two
     cancel exactly — but only if the step moves the train by v_mean*dt.

     Moving it by the END speed instead (v += a*dt; s += v*dt) makes the
     distance climbed slightly disagree with the kinetic energy paid for it,
     by half*m*a^2*dt^2 every step. One step of that is nothing; a lift hill is
     tens of thousands of steps all leaning the same way, which is what put
     "energy is not adding up" on the report for a track that was almost
     entirely chain lift. */
  function glide(state, a, dt) {
    const ds = (state.v + a * dt / 2) * dt;
    state.v += a * dt;
    return ds;
  }

  /* Every joint the front car crossed in this step, and the jolt it took there.
     Curvature changes in one jump at a joint, so the rider's acceleration
     changes by dk*v^2 with nothing in between — the thing a real track's
     easements exist to prevent, and the only part of "jerk" this model can
     state exactly rather than infer from the sampling rate.

     Kept per joint rather than as a single worst figure: a track can have one
     awkward corner and be fine everywhere else, and the report should be able
     to name the joint rather than the ride. */
  function recordJolts(s0, s1, v) {
    const sim = RC.sim;
    const joints = RC.jointSteps();
    if (!joints.length) return;
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    if (hi <= lo) return;
    for (let n = 0; n < joints.length; n++) {
      const j = joints[n];
      if (j.s <= lo || j.s > hi) continue;
      const jg = j.dMag * v * v / G;
      const prev = sim.jolts[n];
      if (!prev || jg > prev.g) sim.jolts[n] = { s: j.s, g: jg, v: Math.abs(v), joint: j };
    }
  }

  /* Worst first, holes skipped — joints the train never reached have no entry. */
  RC.worstJolts = function (n) {
    const out = RC.sim.jolts.filter(Boolean);
    out.sort((a, b) => b.g - a.g);
    return n ? out.slice(0, n) : out;
  };

  /* Bring a train that has finished its ride back to exactly where it set off
     from, the way the real thing does: the station's drive tyres slow it if it
     arrives quickly and carry it the rest of the way at a walking pace.

     It used to stop as soon as it was under half a metre per second and snap to
     the berth, which took a train from the station THRESHOLD to its berth in
     one frame — the run appeared to end the moment the front car reached the
     platform, a dozen metres short of where it started. Now it drives in.

     `sign` is +1 when the berth lies ahead (a circuit, arriving forwards) and
     -1 when it lies behind (a shuttle, rolling back in). Returns true once the
     train is home. */
  function stationHome(sim, m, dt, sign, onStation) {
    if ((sim.startS - sim.s) * sign <= 0) return true;
    if (!onStation) return false;              // still out on the track

    const closing = sim.v * sign;              // how fast it is nearing the berth
    const target = closing > STATION_HOME
      ? Math.max(STATION_HOME, closing - STATION_BRAKE * dt)
      : STATION_HOME;

    // Slowing it down sheds energy as heat; nudging it along costs the motor.
    const before = 0.5 * m * sim.v * sim.v;
    const after = 0.5 * m * target * target;
    if (after > before) sim.eMotor += after - before;
    else sim.eThermal += before - after;

    sim.v = target * sign;
    return false;
  }

  /* ---- one physics substep --------------------------------------------- */
  function substep(dt) {
    const sim = RC.sim;
    const m = RC.trainMass();
    const c = closed();
    const path = RC.trackPath();
    const cars = RC.carStates();
    if (!cars.length) return;

    /* Everything down to the brakes is a DRIVE SYSTEM, and every one of them
       works by setting the speed outright. They go FIRST, before the train
       has moved anywhere, so each is a pure change of kinetic energy over no
       distance at all — which makes what it costs the motor, or gives up to
       the brakes, exactly the kinetic energy it changed. The glide that
       follows is then the only thing that moves the train, and it balances
       against gravity on its own.

       Order matters twice over. Gliding first and clamping afterwards books
       the same energy, but it lets a train standing at the bottom of a lift
       slide backwards for one step before the chain catches it — and a train
       parked at s = 0 slides straight off the start of the track and the run
       ends before it has begun. The chain holds the train; it does not catch
       it after it has already let go. */

    // Station dispatch: while the train is still leaving the station on its way
    // out, the station's drive tyres push it forward onto the lift (or launch).
    // Without this a train parked at the station exit just creeps backward down
    // the faint uphill ahead and never gets going. Gated on !launchedOut, not
    // !lapDone, so it fires once on the way out and never re-grabs a train
    // coming home (which matters for a shuttle, whose lap is never "done").
    const onStation = cars.some(p => p.def && p.def.station);
    if (onStation && !sim.launchedOut && sim.v < STATION_DISPATCH && sim.state === 'running') {
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

    // Launch track, for shuttle rides. Only fires while the train is heading
    // OUT (v >= 0); on the way back it must coast through, not be re-launched.
    const onLaunch = cars.some(p => p.def && p.def.launch);
    if (onLaunch && sim.v >= 0 && sim.v < sim.launchSpeed && sim.state === 'running') {
      const before = 0.5 * m * sim.v * sim.v;
      const after = 0.5 * m * sim.launchSpeed * sim.launchSpeed;
      sim.eMotor += after - before;
      sim.v = sim.launchSpeed;
    }

    /* Brakes bleed energy to heat, at a rate, over the length of the brake run
       — they do not simply clamp the train to the brake speed the instant it
       touches one. Clamping made the number of brake pieces meaningless: one
       stopped a train exactly as hard as four, and "shorten the brake run" was
       not something a student could do. A run now bites over its own length,
       and cannot take a train below the speed it is set to hold. */
    const onBrake = cars.some(p => p.def && p.def.brake);
    if (onBrake && Math.abs(sim.v) > sim.brakeSpeed) {
      const sign = Math.sign(sim.v);
      const speed = Math.abs(sim.v);
      const after = Math.max(sim.brakeSpeed, speed - BRAKE_DECEL * dt);
      sim.eThermal += 0.5 * m * (speed * speed - after * after);
      sim.v = sign * after;
    }

    /* Now roll. Gravity and the resistances act over the step, and the train
       moves by the MEAN speed across it — which is what makes the height it
       gains agree exactly with the kinetic energy it paid, and the heat agree
       exactly with the distance it rubbed along. */
    const roll = rollingForces(cars, sim.v, m);
    const a = roll.a;            // tangential acceleration, for the g-forces below
    const ds = glide(sim, a, dt);
    sim.eThermal += roll.heatPerM * ds;

    const sBefore = sim.s;
    sim.s += ds;
    sim.time += dt;
    // Before the lap wrap below moves s, so the closing joint is seen where
    // jointSteps put it: at the far end of the path, not back at zero.
    if (!sim.overhang) recordJolts(sBefore, sim.s, sim.v);

    // Once the train has cleared the berth it has "launched out"; this stops
    // the station dispatch re-grabbing it, and marks a shuttle's outbound leg.
    if (sim.s > sim.startS + 1) sim.launchedOut = true;

    // Track the extremes for the ride report.
    const lead = cars[0];
    sim.maxV = Math.max(sim.maxV, Math.abs(sim.v));
    sim.maxZ = Math.max(sim.maxZ, lead.z * RC.LEVEL_M);

    // In a demo, the ride's own train is one of the runners, so it records
    // its arrival at the bottom the same way the comparison trains do.
    if (RC.demo && sim.vGround === null && lead.z * RC.LEVEL_M <= 0.001) {
      sim.vGround = Math.abs(sim.v);
      sim.tGround = sim.time;
    }

    // G-forces at the front car, where the ride is most extreme.
    const g = RC.gForces(lead, sim.v, a);
    sim.g = g;
    // The shape under the front car, for the trace and the hover readout.
    sim.kVert = lead.kVert || 0;
    sim.kLat = lead.kLat || 0;
    // Keep WHERE each extreme happened, so the report can name the feature
    // responsible rather than quoting a distance along the track.
    if (g.vert > sim.maxVertG) { sim.maxVertG = g.vert; sim.maxVertGs = lead.s; }
    if (g.vert < sim.minVertG) { sim.minVertG = g.vert; sim.minVertGs = lead.s; }
    if (Math.abs(g.lat) > sim.maxLatG) { sim.maxLatG = Math.abs(g.lat); sim.maxLatGs = lead.s; }
    sim.maxG = Math.max(sim.maxG, Math.abs(g.vert));

    // Only flag what a real ride would not be allowed to do (see RC.G_LIMITS);
    // ordinary airtime and a well-banked turn are left alone. Each complaint
    // names the feature it happened on, so it can be found and fixed.
    const L = RC.G_LIMITS;
    const feat = RC.featureAt ? RC.featureAt(lead.s) : null;
    const at = feat ? ` on ${feat.label}` : '';
    const lat = Math.abs(g.lat);

    const spot = feat ? feat.label : 'track';

    if (g.vert > L.vertExtreme) {
      addWarning(`Vertical ${g.vert.toFixed(1)} g${at} — beyond anything a real coaster pulls`,
                 'vert:' + spot, g.vert);
    } else if (g.vert > L.vertHigh) {
      addWarning(`Heavy vertical ${g.vert.toFixed(1)} g${at} — at the limit even for a moment`,
                 'vert:' + spot, g.vert);
    }

    if (g.vert < L.airtimeHard) {
      addWarning(`Airtime ${g.vert.toFixed(1)} g${at} — riders would be thrown from the train`,
                 'airtime:' + spot, -g.vert);
    } else if (g.vert < L.airtimeGood) {
      addWarning(`Airtime ${g.vert.toFixed(1)} g${at} — more than a restraint is meant to hold`,
                 'airtime:' + spot, -g.vert);
    }

    if (lat > L.latExtreme) {
      addWarning(`Violent sideways ${lat.toFixed(1)} g${at} — it needs banking or a wider radius`,
                 'lat:' + spot, lat);
    } else if (lat > L.latHigh) {
      addWarning(`Uncomfortable sideways ${lat.toFixed(1)} g${at} — worth banking`,
                 'lat:' + spot, lat);
    }

    if (sim.maxV > L.speedMax) {
      addWarning(`Train reaches ${sim.maxV.toFixed(0)} m/s — faster than any coaster ever built`,
                 'speed', sim.maxV);
    }

    // Falling out of a loop. Upside down, the ONLY thing holding the train on
    // is its own speed: the track can push riders into their seats but cannot
    // pull the train inwards. The classic result — a loop of radius r needs
    // v >= sqrt(g r) at the top — falls out of this, and it is the question the
    // loop is there to raise.
    //
    // Judged over the WHOLE train, not just the front car: the cars are coupled,
    // so one car losing its grip at the top is held on by the ones still pressed
    // into the track below it. Requiring a clear inversion (not merely tilted)
    // keeps airtime hills and banked turns, which are legitimately negative-g,
    // on the rails.
    if (!sim.overhang && RC.carFrame(lead).u.z < -0.2) {
      let vertSum = 0;
      for (const cc of cars) vertSum += RC.gForces(cc, sim.v, a).vert;
      if (vertSum / cars.length < 0) {
        sim.overhang = buildOverhang(lead, sim.v, 'inverted');
      }
    }

    // Valleying: sign changes with no forward progress.
    const vs = Math.sign(sim.v);
    if (vs !== 0 && sim.lastVSign !== 0 && vs !== sim.lastVSign) sim.reversals++;
    if (vs !== 0) sim.lastVSign = vs;
    if (sim.s > sim.sMax) { sim.sMax = sim.s; sim.stallTime = 0; }
    else sim.stallTime += dt;

    // A train see-sawing on the edge of a drop is not valleying; it is about to
    // come off, and the overhang below decides that.
    if (!sim.overhang && sim.reversals >= 4 && sim.stallTime > 3) {
      sim.state = 'valleyed';
      sim.note = 'The train valleyed — it never had enough energy for the next hill.';
      addWarning('Train valleys and rolls back');
      return;
    }

    // Hanging off the end. While any of the train is out there the ordinary
    // end-of-ride tests do not apply — it has not finished, it is part way over
    // a cliff — so the only question is whether it goes over or is hauled back.
    if (sim.overhang) {
      const oh = sim.overhang;

      /* The point of no return is the CENTRE OF MASS crossing the edge. Past
         that, more than half the train's weight is beyond its last support, so
         it tips off however the tangential force balance happens to read.

         That balance alone is not enough to decide it. A train leaving fast is
         out on a shallow part of the ballistic arc, where gravity has little
         component along the track, so the hanging cars barely pull — and the
         climb behind could otherwise drag the whole thing back on when half of
         it is already in the air. Once the centre of mass is over, the train
         has tipped: every car comes off the rails and follows the arc. */
      const sCom = sim.s - (sim.cars - 1) * CAR_SPACING / 2;
      if (!oh.committed && sCom > oh.s0) {
        oh.committed = true;
        addWarning(oh.cause === 'inverted'
          ? 'The whole train came off the track — its centre of mass left the rails'
          : 'The train tipped over the end — its centre of mass passed the last rail');
      }

      if (sim.s - oh.s0 >= oh.length) { wreck(); return; }
      if (oh.committed) {
        // Tipped and stalled is still falling, not a ride that can recover.
        if (sim.v <= 0) { wreck(); return; }
        return;
      }
      if (sim.s > oh.s0) return;                // hanging, but still recoverable
      sim.overhang = null;                      // hauled back on: carry on
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
        // The berth is ahead of it: it came round and pulls forward into place.
        if (stationHome(sim, m, dt, 1, onStation)) {
          sim.eThermal += 0.5 * m * sim.v * sim.v;
          sim.s = sim.startS;
          sim.v = 0;
          sim.state = 'finished';
          sim.note = 'Completed the circuit and returned to the station.';
        }
      }
    } else if (shuttle()) {
      // Shuttle: launched out, up the spike, then rolls back through to the
      // station. A well-judged spike stalls the train under gravity and it
      // reverses on its own. If the spike is too short the front car noses over
      // the top and hangs there, and from that point the overhang decides it —
      // the whole point of the exercise: work out how tall the spike must be to
      // catch a given launch.
      if (sim.s > path.total) {
        sim.overhang = buildOverhang(RC.pathAt(path.total, false), sim.v, 'end');
        return;
      }

      // Coming home: only the station catches the train. The finish must be
      // gated on actually being ON the station — otherwise the crawl at the
      // top of the spike (|v| ~ 0 as it reverses) would wrongly "finish" the
      // run out on the spike and leak all its energy.
      const onStation = cars.some(p => p.def && p.def.station);
      if (sim.launchedOut && onStation && sim.v <= 0) {
        // The berth is behind it: it rolls back in the way it came out.
        if (stationHome(sim, m, dt, -1, true)) {
          sim.eThermal += 0.5 * m * sim.v * sim.v;
          sim.s = sim.startS;
          sim.v = 0;
          sim.state = 'finished';
          sim.note = 'The shuttle rolled back to the station.';
        }
      }
    } else {
      // A dead-end track: hitting either end stops the train dead. That kinetic
      // energy has to go somewhere or the conservation readout would leak.
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

  /* ---- running off the rails --------------------------------------------
     A train that reaches the end of the track does NOT simply take off. The
     front car noses over the edge and hangs there, still coupled to the cars
     behind it — exactly like pushing the end of a chain over the edge of a
     table. Its weight pulls the rest of the train forward, and whether that is
     enough to drag the whole train over, or whether the train is heavy enough
     on the climb behind to stop and pull it back, is the interesting question.

     The overhang is modelled as a continuation of the WIRE the train runs on:
     the ballistic arc the front car would fly, tabulated by arc length. That
     shape is not a fudge — a bead sliding frictionlessly along a projectile's
     own trajectory follows exactly the projectile's motion, because the wire
     has to supply no normal force. So a train that leaves fast sails out in a
     proper arc, one that just creeps over the lip droops almost straight down,
     and in between the cars behind decide what happens.

     Because it is just more wire, the ordinary bead-on-wire integrator handles
     it: the mean slope over the cars now includes the hanging ones (slope -1
     when vertical, pulling hard), and energy is conserved without any special
     bookkeeping. */
  const OVERHANG_DT = 0.01;    // s — integration step for the tabulated arc
  const OVERHANG_MAX = 3000;   // samples, ~30 s of fall

  function buildOverhang(p, v, cause) {
    const fr = RC.carFrame(p);
    // A stationary train still droops over the edge, so give the arc a nudge
    // rather than letting a zero speed leave the tangent undefined.
    const speed = Math.max(0.05, Math.abs(v)) * (v < 0 ? -1 : 1);
    let x = p.x * RC.TILE_M, y = p.y * RC.TILE_M, z = p.z * RC.LEVEL_M;
    let vx = speed * fr.f.x, vy = speed * fr.f.y, vz = speed * fr.f.z;
    // A ballistic arc stays in one vertical plane, so the departure frame's
    // horizontal "right" is normal to that plane the whole way down.
    const r = fr.r;
    const pts = [];
    let u = 0;

    for (let n = 0; n < OVERHANG_MAX; n++) {
      const sp = Math.hypot(vx, vy, vz) || 1;
      const fx = vx / sp, fy = vy / sp, fz = vz / sp;

      // up = f x r, matching the frame convention elsewhere (r = u x f).
      let ux = fy * r.z - fz * r.y;
      let uy = fz * r.x - fx * r.z;
      let uz = fx * r.y - fy * r.x;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;

      // Curvature of a projectile: gravity resolved across the path, over v^2.
      const dot = -G * fz;
      const kx = (-dot * fx) / (sp * sp);
      const ky = (-dot * fy) / (sp * sp);
      const kz = (-G - dot * fz) / (sp * sp);

      // The same geometry split the track carries, so a car out over the edge
      // reads back in the same units as one still on the rails. A ballistic arc
      // stays in one vertical plane, so `r` is its horizontal normal throughout
      // and stands in where the fall goes vertical and has no heading left.
      const split = RC.splitCurv([kx, ky, kz], [fx, fy, fz], [r.x, r.y]);

      pts.push({
        u, x, y, z, fx, fy, fz, ux, uy, uz,
        kx, ky, kz, curv: Math.hypot(kx, ky, kz), dzds: fz,
        kVert: split.vert, kLat: split.lat
      });

      if (z <= 0) break;
      vz -= G * OVERHANG_DT;
      const nx = x + vx * OVERHANG_DT, ny = y + vy * OVERHANG_DT, nz = z + vz * OVERHANG_DT;
      u += Math.hypot(nx - x, ny - y, nz - z);
      x = nx; y = ny; z = nz;
    }

    return {
      s0: p.s, cause,
      v0: Math.abs(v),                 // speed the front car left the rails at
      z0: p.z * RC.LEVEL_M,            // height it left from
      // Radius of curvature there, so the report can quote the speed the train
      // needed to hold that part of a loop: v^2 / r >= g.
      curv: p.curv || 0,
      pts, length: u
    };
  }

  /* State at arc distance u past the departure point, in the same units and
     shape as a path point so the rest of the physics cannot tell the
     difference. Positions come back in tiles/levels, like RC.pathAt. */
  RC.overhangAt = function (u) {
    const oh = RC.sim.overhang;
    if (!oh || !oh.pts.length) return null;
    const pts = oh.pts;

    /* Behind the edge: a car that has not reached it yet, on a train that has
       already tipped. It is still strung out along the track it has not
       finished travelling, so that is where it is drawn from — the track
       point, flagged as off the rails so no station, chain or brake can grab
       an airborne train through it.

       It used to trail back along the departure TANGENT instead, a straight
       line out of the last sleeper. On constant-grade track the two are the
       same line, which is why it went unnoticed; on anything that curves
       vertically they part company, and the moment the train committed, half
       its cars jumped to a different height. Potential energy appeared out of
       nowhere in a single frame, and the report — correctly — called it a bug
       in the simulation. Geometry a car is standing on must never change
       discontinuously, whatever the car is doing. */
    if (u < 0) {
      const p = RC.pathAt(oh.s0 + u, RC.isClosed());
      return p && Object.assign({}, p, { piece: null, def: null, overhang: true });
    }

    let a, b, f;
    if (u <= 0) { a = b = pts[0]; f = 0; }
    else if (u >= oh.length) { a = b = pts[pts.length - 1]; f = 0; }
    else {
      let lo = 0, hi = pts.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].u <= u) lo = mid; else hi = mid;
      }
      a = pts[lo]; b = pts[hi];
      const span = b.u - a.u;
      f = span > 1e-9 ? (u - a.u) / span : 0;
    }
    const mix = (p, q) => p + (q - p) * f;

    return {
      s: oh.s0 + u,
      x: mix(a.x, b.x) / RC.TILE_M,
      y: mix(a.y, b.y) / RC.TILE_M,
      z: mix(a.z, b.z) / RC.LEVEL_M,
      dzds: mix(a.dzds, b.dzds),
      curv: mix(a.curv, b.curv),
      kx: mix(a.kx, b.kx), ky: mix(a.ky, b.ky), kz: mix(a.kz, b.kz),
      kVert: mix(a.kVert, b.kVert), kLat: mix(a.kLat, b.kLat),
      bank: 0,
      fx: mix(a.fx, b.fx), fy: mix(a.fy, b.fy), fz: mix(a.fz, b.fz),
      ux: mix(a.ux, b.ux), uy: mix(a.uy, b.uy), uz: mix(a.uz, b.uz),
      // Not on a piece any more: no station, lift, brake or launch out here.
      piece: null, def: null,
      overhang: true
    };
  };

  /* The front of the train has reached the ground. Everything it still had —
     its motion and the height of the cars strung out behind it — ends up as
     heat and wreckage. */
  function wreck() {
    const sim = RC.sim;
    const cars = RC.carStates();
    const e = RC.energy();
    const oh = sim.overhang;

    sim.crashSpeed = Math.abs(sim.v);
    sim.eThermal += e.ke + e.pe;
    sim.v = 0;
    sim.wrecked = true;
    sim.state = 'crashed';
    sim.note = oh && oh.cause === 'inverted'
      ? `Too slow at ${oh.v0.toFixed(1)} m/s to hold the track upside down — the train ` +
        `fell out of the loop from ${oh.z0.toFixed(1)} m and hit the ground at ` +
        `${sim.crashSpeed.toFixed(1)} m/s. It is wrecked.`
      : `Dragged over the end of the track and hit the ground at ` +
        `${sim.crashSpeed.toFixed(1)} m/s — the train is wrecked.`;
    addWarning(oh && oh.cause === 'inverted'
      ? 'The train fell out of the loop and crashed'
      : 'The train ran off the end of the track and crashed');

    // Each car breaks up where IT is, so the wreckage is strung out along the
    // fall rather than heaped in one place.
    if (RC.makeDebris) {
      sim.blast = { parts: [] };
      for (const c of cars) {
        const cf = RC.carFrame(c);
        const parts = RC.makeDebris({
          x: c.x * RC.TILE_M, y: c.y * RC.TILE_M, z: Math.max(0, c.z * RC.LEVEL_M),
          fx: cf.f.x, fy: cf.f.y, impact: sim.crashSpeed
        });
        for (const part of parts) sim.blast.parts.push(part);
      }
    }
  }

  /* ---- comparison trains ------------------------------------------------
     A demo can stand extra tracks in the park with a train on each, released
     together with the ride's own. They are deliberately plain: no station, no
     lift, no brakes — just a bead on a wire under gravity, so that whatever
     they show comes from the shape of the track and nothing else.

     Each records the speed its front car had the moment it first reached
     ground level. That is the figure the whole path-independence demo turns
     on, and capturing it there rather than reading it live means it survives
     the run-out afterwards (where friction, if it is on, would eat into it). */
  RC.resetDemo = function () {
    if (!RC.demo) return;
    RC.demo.running = false;      // back at the top, waiting to be released
    for (const tr of RC.demo.trains) {
      tr.s = 0;
      tr.v = 0;
      tr.time = 0;
      tr.eThermal = 0;
      tr.vGround = null;
      tr.tGround = null;
      tr.done = false;
      const cars = demoCars(tr);
      tr.h0 = cars.length ? meanOf(cars, 'z') * RC.LEVEL_M : 0;
      tr.E0 = demoMass(tr) * G * tr.h0;
    }
  };

  function demoMass(tr) { return RC.trainMass(); }

  /* Where a comparison train's cars sit. Same shape as RC.carStates, read off
     that train's own path. */
  function demoCars(tr) {
    const out = [];
    for (let n = 0; n < RC.sim.cars; n++) {
      const p = RC.pathAtIn(tr.path, tr.s - n * CAR_SPACING, false);
      if (p) out.push(p);
    }
    return out;
  }
  RC.demoCars = demoCars;

  function stepDemoTrain(tr, dt) {
    if (tr.done) return;
    const cars = demoCars(tr);
    if (!cars.length) return;
    const m = demoMass(tr);

    const roll = rollingForces(cars, tr.v, m);
    const ds = glide(tr, roll.a, dt);
    tr.eThermal += roll.heatPerM * ds;
    tr.s += ds;
    tr.time += dt;

    // First arrival at the bottom: the number the demo exists to show.
    if (tr.vGround === null && cars[0].z * RC.LEVEL_M <= 0.001) {
      tr.vGround = Math.abs(tr.v);
      tr.tGround = tr.time;
    }

    // Dead-ended either way: stop dead and book what it had as heat, the same
    // as the ride does at the end of an unfinished track.
    if (tr.s >= tr.path.total) {
      tr.eThermal += 0.5 * m * tr.v * tr.v;
      tr.s = tr.path.total;
      tr.v = 0;
      tr.done = true;
    } else if (tr.s <= 0 && tr.v < 0) {
      tr.eThermal += 0.5 * m * tr.v * tr.v;
      tr.s = 0;
      tr.v = 0;
      tr.done = true;
    }
  }

  /* Live figures for one comparison train, for the demo's table. */
  RC.demoState = function (tr) {
    const cars = demoCars(tr);
    const m = demoMass(tr);
    const h = cars.length ? meanOf(cars, 'z') * RC.LEVEL_M : 0;
    const ke = 0.5 * m * tr.v * tr.v;
    return {
      h, ke,
      pe: m * G * h,
      thermal: tr.eThermal,
      total: ke + m * G * h + tr.eThermal,
      supplied: tr.E0,
      vGround: tr.vGround,
      tGround: tr.tGround,
      keGround: tr.vGround === null ? null : 0.5 * m * tr.vGround * tr.vGround,
      length: tr.path.total
    };
  };

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
      vg: sim.g.vert, lg: sim.g.lat,
      kv: sim.kVert, kl: sim.kLat
    });
  }
  RC.recordTrace = record;

  /* ---- frame ----------------------------------------------------------- */
  /* Are a demo's comparison trains under way? They outlast the ride's own — the
     steep route is home long before the shallow one — so the clock has to keep
     running after the main train has stopped, or the slow ones freeze halfway
     down and the comparison never completes.

     `running` is what makes that safe. Asking only whether a train is still
     unfinished would be true the moment the preset loaded, and the comparison
     trains would set off down the hill on their own without the Test button
     ever being pressed. */
  RC.demoRunning = function () {
    return !!(RC.demo && RC.demo.running && RC.demo.trains.some(t => !t.done));
  };

  RC.stepSim = function (dtFrame) {
    const sim = RC.sim;
    // The comparison trains are released by the ride's own train setting off,
    // so every route in — the Test button, the space bar, a test harness —
    // starts all of them together. It latches, so they carry on down after the
    // main train has finished its own much shorter run.
    if (sim.state === 'running' && RC.demo) RC.demo.running = true;

    const going = () => sim.state === 'running' || RC.demoRunning();
    if (!going()) return false;

    let dt = Math.min(MAX_FRAME, Math.max(0, dtFrame));
    while (dt > 0 && going()) {
      const step = Math.min(SUBSTEP, dt);
      if (sim.state === 'running') substep(step);
      // Comparison trains run on the same clock, so they are genuinely
      // released together with the ride's own train.
      if (RC.demo) for (const tr of RC.demo.trains) stepDemoTrain(tr, step);
      dt -= step;
    }
    if (sim.state === 'running') record();
    return true;
  };

  RC.startSim = function () {
    const sim = RC.sim;
    const st = RC.circuitStatus();
    if (!st.ok) {
      sim.note = st.kind === 'open'
        ? st.label + ' — close the circuit, or switch on Shuttle to run it out-and-back.'
        : st.label + ' — finish the track before testing.';
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
    // Not conditional on that: a demo's slow trains are often still coming
    // down after the ride's own has stopped, and Pause has to catch them too.
    if (RC.demo) RC.demo.running = false;
  };
})();
