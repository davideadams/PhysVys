/* Ready-built coasters, offered from a dropdown in the top bar.

   The page loads with one already standing, because a station on its own can't
   be tested — pressing Test on an unfinished circuit correctly refuses, which
   is a poor greeting for a teacher who has just opened the link.

   Closed presets list only their interesting part and set `finish: true`; the
   loader then calls RC.completeTrack (the same A* the "Finish track" button
   uses) to join the layout back to the station. That guarantees closure without
   hand-solving the arithmetic, which matters more than it used to: a piece's
   length now follows from its grade change, so hand-closed geometry has to be
   re-solved every time the grade ladder moves, and a preset that quietly stops
   closing turns itself into a shuttle and throws the train off the end.

   A shuttle preset sets `shuttle: true`: it is an OPEN out-and-back (launch,
   loop, spike, roll back through the loop to the station), not a circuit. */
(function () {
  const RC = window.RC || (window.RC = {});

  const rep = (n, id, opts) =>
    new Array(n).fill(0).map(() => Object.assign({ id }, opts || {}));

  /* Demo lanes are plain lists of piece ids rather than build steps. */
  const repId = (n, id) => new Array(n).fill(id);

  const GENTLE = RC.SLOPE.GENTLE, MEDIUM = RC.SLOPE.MEDIUM, STEEP = RC.SLOPE.STEEP;

  /* Heights below are quoted in METRES, which is what the comments mean and
     what a reader can check against the ride. A level is half a metre, so a
     medium tile climbing 4 levels gains 2 m. */
  const M = 1 / RC.LEVEL_M;      // levels per metre

  RC.PREFABS = {
    /* Every layout here is a rough rectangle: three sides laid by hand, then
       RC.completeTrack fills the last corner. Closing them by hand instead
       would be tighter, but a transition is now as long as its grade change, so
       every leg's length is set by the heights it has to reach — and a preset
       that has to be re-solved by hand whenever a piece changes shape is a
       preset that quietly stops closing. The solver only ever gets a short hop
       to find, which is the one thing it is reliably good at. */
    'first-drop': {
      name: 'First Drop',
      blurb: 'Chain lift, a long drop, then two airtime hills back to the station.',
      /* Height profile, in metres:
         0 --lift--> 20 --> 10 --> 0 --> 10 --> 0 --hill--> 1 --> 0

         THE CORNERS ARE AT HEIGHT AND THE HILLS ARE AT THE BOTTOM, and that is
         the whole shape of the ride rather than a detail of it.

         A 15 m corner is 1.5 g sideways at 14.8 m/s, which is the limit the
         report judges a student by, and banking does not rescue a corner taken
         faster: the bank ramps in over the first quarter of the piece while the
         curvature arrives in full at the joint, so the ENTRY of a banked turn
         is an unbanked turn. (Phase 4's spiral easements fix that by tying bank
         to curvature; until then it is a real constraint on layout.) 14.8 m/s
         is 11 m of drop, so every corner here sits 10 m up, where the train has
         used most of its height and is slow.

         Airtime wants the opposite. A crest bends at about 24 m, so it only
         lifts a rider out of their seat above sqrt(gR) = 15.4 m/s — and a train
         is slowest at the top of a hill. So the hill goes at the BOTTOM, low
         and late, where the train still has nearly the whole 20 m in it: 1 m
         high, crossed at about 17 m/s, worth around -0.2 g.

         Everything worth height is on MEDIUM (18.4 deg, 2 m a tile). Gentle is
         half that now and would take twice the park to climb the same hill.

         Closed BY HAND, unlike the others, because the brake has to finish
         within a turn of the station: braking to 3 m/s and then asking the
         train to cross whatever length of filler the solver happens to choose
         is asking it to valley short of home. The station is three tiles, so
         the two legs across the park differ by three and the two along it
         match. */
      build: [].concat(
        // Side 1 (+i), 12 tiles: lift to 20 m.
        [{ id: 'flat-to-gentle-up', lift: true }],
        [{ id: 'gentle-to-medium-up', lift: true }],
        rep(8, 'medium-up', { lift: true }),
        [{ id: 'medium-to-gentle-up', lift: true }],
        [{ id: 'gentle-up-to-flat', lift: true }],
        // Taken at chain speed, so it needs nothing.
        [{ id: 'turn-right-wide' }],
        // Side 2 (+j), 14 tiles: halfway down, to 10 m.
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-to-medium-down' }],
        rep(3, 'medium-down'),
        [{ id: 'medium-to-gentle-down' }, { id: 'gentle-down-to-flat' }],
        rep(7, 'flat'),
        [{ id: 'turn-right-wide', bank: true }],
        // Side 3 (-i), 15 tiles: down to the ground and straight back up to 10,
        // which is the valley that makes the ride and the reason the next
        // corner is slow enough to take.
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-to-medium-down' }],
        rep(3, 'medium-down'),
        [{ id: 'medium-to-gentle-down' }, { id: 'gentle-down-to-flat' }],
        [{ id: 'flat' }],
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-to-medium-up' }],
        rep(3, 'medium-up'),
        [{ id: 'medium-to-gentle-up' }, { id: 'gentle-up-to-flat' }],
        [{ id: 'turn-right-wide', bank: true }],
        /* Side 4 (-j), 14 tiles: down to the ground, over the airtime hill, and
           home. One brake piece, not two — two took the train down to a walk
           with a whole banked turn still to travel, and with friction on it
           died a metre short of the station. */
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-to-medium-down' }],
        rep(3, 'medium-down'),
        [{ id: 'medium-to-gentle-down' }, { id: 'gentle-down-to-flat' }],
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-up-to-flat' }],
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-down-to-flat' }],
        rep(2, 'flat'),
        [{ id: 'brake' }],
        [{ id: 'turn-right-wide' }]
      )
    },

    'gentle-hills': {
      name: 'Gentle Hills',
      blurb: 'A tame family ride — a modest lift and a couple of small hills, no big forces.',
      finish: true,
      /* The only preset that stays on GENTLE throughout — 9.5 degrees, a metre
         of climb a tile. It is the shallowest thing the palette offers and the
         whole character of the ride. */
      build: [].concat(
        // Side 1 (+i): lift to 6 m.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(5, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'turn-right-wide' }],
        // Side 2 (+j): down to the ground, over a low hill, back to the ground.
        [{ id: 'flat-to-gentle-down' }],
        rep(5, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        // A 2 m hill, which needs only three tiles at this grade.
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-up' }, { id: 'gentle-up-to-flat' }],
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-down' }, { id: 'gentle-down-to-flat' }],
        [{ id: 'turn-right-wide' }],
        // Side 3 (-i): back across, and round toward the station.
        rep(9, 'flat'),
        [{ id: 'turn-right-wide' }],
        rep(12, 'flat')
      )
    },

    'looper': {
      name: 'Looper',
      blurb: 'A lift and a long drop feed a vertical loop, then the track curves back to the station.',
      finish: true,
      /* Its own station, in a corner of the park, because this one needs the
         room. The loop is 13.5 m tall and needs about 17.3 m/s at the bottom to
         hold the train through the top, which is an 18 m drop before losses —
         so the lift and the drop alone are 22 tiles before anything else is
         laid. From the middle of the park that runs out of room; from a corner
         it does not. */
      start: { i: 2, j: 6, dir: 0, k: 0, g: 0 },
      build: [].concat(
        rep(3, 'station'),
        // Side 1 (+i): lift to 18 m, on medium.
        [{ id: 'flat-to-gentle-up', lift: true }],
        [{ id: 'gentle-to-medium-up', lift: true }],
        rep(7, 'medium-up', { lift: true }),
        [{ id: 'medium-to-gentle-up', lift: true }],
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        [{ id: 'turn-right-wide' }],
        // Side 2 (+j): the whole 18 m back down, then straight into the loop.
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-to-medium-down' }],
        rep(7, 'medium-down'),
        [{ id: 'medium-to-gentle-down' }, { id: 'gentle-down-to-flat' }],
        [{ id: 'flat' }],
        [{ id: 'loop-right' }],
        rep(2, 'flat'),
        [{ id: 'turn-right-wide' }],
        // Side 3 (-i): back across.
        rep(10, 'flat'),
        [{ id: 'turn-right-wide' }],
        // Side 4 (-j): part way home; the solver closes the last corner.
        rep(16, 'flat')
      )
    },

    'custom': {
      name: 'Custom (blank)',
      blurb: 'Just a station — a blank slate to build your own coaster from.',
      blank: true,
      build: []
    },

    /* The same blank slate, but against one edge of the park instead of in the
       middle of it, so the whole 40 tiles lie on one side of the station
       rather than being split around it. A layout that wants to run out and
       come back has the room to; from the middle, the return leg has to fit
       into whatever is left.

       The station lies ALONG the edge, not pointing away from it — the same
       way a real station sits beside the park rather than aiming through the
       middle of it. So it runs +j down the i = 0 boundary, which puts the
       whole park to its left and nothing at all to its right. Turning out of
       the park is correctly impossible; every first move goes inward.

       It has to lay its own station: a preset that names its own start does
       not get the one RC.resetTrack puts in the middle. Three tiles from
       GRID/2 - 1 straddle the middle of the edge. */
    'custom-edge': {
      name: 'Custom (edge)',
      blurb: 'A station along the middle of one edge, with the whole park to one side of it.',
      blank: true,
      start: { i: 0, j: RC.GRID / 2 - 1, dir: 1, k: 0, g: 0 },
      build: rep(3, 'station')
    },

    /* Three trains, three routes down the same 24 m, released together.
       Whatever shape the track is, each arrives at the bottom doing the same
       speed, because gravity's work depends on the height dropped and nothing
       else. They arrive at very different TIMES, which is the other half of
       the point — and switching friction on breaks the match, because losses
       go with the length of the path rather than the height of it.

       22 m, and the figure is not free to choose. Every lane must total the
       same drop out of whole levels, and a lane that walks the grade ladder
       down to flat picks up the ladder's own transitions on the way: a steep
       lane sheds 16 + 3 + 1 levels getting back to level, a medium one 3 + 1.
       Those differ in PARITY, so a lane starting steep and a lane starting
       gentle can never total the same number of levels however much constant
       grade either is given. Starting the shallow lane on MEDIUM fixes it, and
       is no loss — medium is 18.4 degrees, which is what "gentle" meant before
       the ladder gained a rung below it.

       Heights below are in levels (0.5 m each), all from 44 down to 0:
         Steep    -12 x2, -16, -3, -1              over 6 tiles
         Shallow  -4 x10, -3, -1                   over 12 tiles
         Varied   -12, -16, -4 x2, -3, -2 x2, -1   over 9 tiles
       Each is padded with level track to the same finish line, so the trains
       end up side by side, still moving, at matching speeds. */
    'path-independence': {
      name: 'Path independence',
      blurb: 'Three trains race 22 m down a steep, a shallow and a varied track. ' +
             'Different routes, different times, identical speed at the bottom.',
      demo: {
        label: 'Path independence',
        cars: 1,             // point masses, so the demo is about the path alone
        drop: 22 * M,
        lanes: [
          {
            label: 'Steep', colour: '#cf3a2f', j: 12, g: -STEEP,
            ids: repId(2, 'steep-down')
              .concat(['steep-to-medium-down', 'medium-to-gentle-down',
                       'gentle-down-to-flat'])
              .concat(repId(14, 'flat'))
          },
          {
            label: 'Shallow', colour: '#1f6fb2', j: 20, g: -MEDIUM,
            ids: repId(10, 'medium-down')
              .concat(['medium-to-gentle-down', 'gentle-down-to-flat'])
              .concat(repId(8, 'flat'))
          },
          {
            label: 'Varied', colour: '#2f855a', j: 28, g: -STEEP,
            ids: ['steep-down', 'steep-to-medium-down']
              .concat(repId(2, 'medium-down'))
              .concat(['medium-to-gentle-down'])
              .concat(repId(2, 'gentle-down'))
              .concat(['gentle-down-to-flat'])
              .concat(repId(11, 'flat'))
          }
        ]
      }
    },

    'shuttle-loop': {
      name: 'Shuttle Loop',
      blurb: 'Launched from the station through a loop and up a tall spike, then rolls back ' +
             'through the loop to the station — an out-and-back, not a circuit.',
      shuttle: true,
      build: [].concat(
        // Launched out of the station.
        [{ id: 'launch' }, { id: 'launch' }],
        rep(2, 'flat'),
        // Through the loop while going fast.
        [{ id: 'loop-right' }],
        rep(2, 'flat'),
        /* The spike, topping out at 34 m. It has to clear the LEAD car, not the
           train's average: the physics stalls the train when its MEAN height
           has used up the launch, and on this steep a grade a four-car train
           averages ~4.4 m below its front car. A 22 m/s launch is worth 24.7 m
           of mean climb, so the front car crests about 29 m — which is why a
           29 m spike (the obvious arithmetic) let it run off the top. 34 m
           leaves real margin, and a student who winds the launch past about
           24.5 m/s will still fly off the end, which is the lesson.

           Climbing the ladder to 45 degrees costs four tiles and 10 m before a
           single length of constant steep track is laid — which is what a
           20 m radius through 45 degrees of arc actually costs, and is the
           reason a spike is an expensive thing to build. */
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-to-medium-up' },
         { id: 'medium-to-steep-up' }],
        rep(4, 'steep-up')
      )
    }
  };

  /* Build a prefab. Pieces go through the normal RC.place, so a prefab can only
     contain track a student could have built by hand. Closed presets are then
     auto-closed with RC.completeTrack. */
  /* A demonstration: several tracks side by side, each with its own train.
     The FIRST lane becomes the editable track, so the build window, the graphs
     and the report all keep working on something real; the rest are comparison
     tracks the demo stands beside it.

     These start part way down a slope rather than from a station, because the
     station's drive tyres would add energy and the whole point is that gravity
     did all of it. The start node carries the entry slope, so the trains are
     already on the grade and move the moment they are released — from level
     track at s = 0 they would simply sit there. */
  function loadDemo(prefab) {
    const d = prefab.demo;
    const lanes = d.lanes;
    const startFor = lane => ({ i: 3, j: lane.j, dir: 0, k: d.drop, g: lane.g });

    // Lane 0 replaces the station RC.resetTrack just laid down.
    const main = lanes[0];
    RC.track.pieces = [];
    RC.track.start = startFor(main);
    RC.track.head = Object.assign({}, RC.track.start);
    RC.version++;
    for (let n = 0; n < main.ids.length; n++) {
      if (!RC.place(main.ids[n])) {
        const why = RC.canPlace(RC.pieceDef(main.ids[n]), RC.track.head).why;
        return { ok: false, why: `${prefab.name}: ${main.label} piece ${n + 1} refused — ${why}` };
      }
    }

    const trains = [];
    for (let n = 1; n < lanes.length; n++) {
      const lane = lanes[n];
      const chain = RC.buildChain(startFor(lane), lane.ids);
      if (!chain.ok) return { ok: false, why: `${prefab.name}: ${lane.label} — ${chain.why}` };
      trains.push({
        label: lane.label,
        colour: lane.colour,
        pieces: chain.pieces,
        path: RC.buildPath(chain.pieces),
        s: 0, v: 0, time: 0, eThermal: 0, E0: 0, h0: 0,
        vGround: null, tGround: null, done: false
      });
    }

    RC.demo = {
      key: prefab.key,
      label: d.label,
      drop: d.drop,
      mainLabel: main.label,
      mainColour: main.colour,
      trains
    };
    if (d.cars) borrowCars(d.cars);
    return { ok: true, demo: true, closed: false, shuttle: false };
  }

  /* A demo runs every train as a point mass, and the comparison trains take
     their length from RC.sim.cars like the ride's own does — so setting up a
     demo means reaching into the train the student configured.

     BORROWING it, not taking it. It used to be taken: load the path-independence
     demo, then load any other preset, and the ride stayed on one car with
     nothing to say why. The car count is a control the student owns, and a
     demonstration is a visit, not a handover. RC.resetTrack gives it back,
     which covers loading another preset, clearing the park, and anything else
     that puts the demo away. */
  let carsBeforeDemo = null;

  function borrowCars(n) {
    if (carsBeforeDemo === null) carsBeforeDemo = RC.sim.cars;
    RC.sim.cars = n;
  }

  RC.returnDemoCars = function () {
    if (carsBeforeDemo === null) return false;
    RC.sim.cars = carsBeforeDemo;
    carsBeforeDemo = null;
    return true;
  };

  RC.loadPrefab = function (key) {
    const prefab = RC.PREFABS[key];
    if (!prefab) return { ok: false, why: `No prefab called "${key}"` };
    prefab.key = key;

    RC.resetTrack();
    if (prefab.demo) return loadDemo(prefab);

    /* A preset may place its own station rather than take the one in the middle
       of the park that RC.resetTrack lays down. A layout of any size has to, or
       it can only ever grow into the quarter of the park that happens to lie
       ahead of that fixed spot. Such a preset builds its own station pieces. */
    if (prefab.start) {
      RC.track.pieces = [];
      RC.track.start = Object.assign({}, prefab.start);
      RC.track.head = Object.assign({}, prefab.start);
      RC.version++;
    }
    for (let n = 0; n < prefab.build.length; n++) {
      const step = prefab.build[n];
      if (!RC.place(step.id, step)) {
        const why = RC.canPlace(RC.pieceDef(step.id), RC.track.head).why;
        return { ok: false, why: `${prefab.name}: piece ${n + 1} (${step.id}) refused — ${why}` };
      }
    }
    if (prefab.finish) {
      // A generous budget: a preset's return leg can be long, and this only
      // runs once when a preset is chosen, not interactively.
      const res = RC.completeTrack({ maxExpand: 300000 });
      if (!res.ok) return { ok: false, why: `${prefab.name}: could not close the circuit — ${res.why}` };
    }
    return { ok: true, closed: RC.sameNode(RC.track.head, RC.track.start), shuttle: !!prefab.shuttle };
  };
})();
