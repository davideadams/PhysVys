/* Ready-built coasters, offered from a dropdown in the top bar.

   The page loads with one already standing, because a station on its own can't
   be tested — pressing Test on an unfinished circuit correctly refuses, which
   is a poor greeting for a teacher who has just opened the link.

   Closed presets list only their interesting part and set `finish: true`; the
   loader then calls RC.completeTrack (the same A* the "Finish track" button
   uses) to join the layout back to the station. That guarantees closure
   without hand-solving the arithmetic. `first-drop` is the exception — it is
   hand-closed and its shape is checked by test.html.

   A shuttle preset sets `shuttle: true`: it is an OPEN out-and-back (launch,
   loop, spike, roll back through the loop to the station), not a circuit. */
(function () {
  const RC = window.RC || (window.RC = {});

  const rep = (n, id, opts) =>
    new Array(n).fill(0).map(() => Object.assign({ id }, opts || {}));

  /* Demo lanes are plain lists of piece ids rather than build steps. */
  const repId = (n, id) => new Array(n).fill(id);

  const GENTLE = RC.SLOPE.GENTLE, STEEP = RC.SLOPE.STEEP;

  RC.PREFABS = {
    'first-drop': {
      name: 'First Drop',
      blurb: 'Chain lift, then three drops and two airtime hills back to the station.',
      /* Height profile, in metres:
         0 --lift--> 16 --drop--> 2 --hill--> 10 --drop--> 4 --hill--> 8 --drop--> 0
         Three drops and two hills rather than one long descent, so potential and
         kinetic energy trade back and forth five times. Each hill is lower than
         the last — it has to be, since the train never climbs higher than it
         started. */
      build: [].concat(
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(7, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        [{ id: 'turn-right-wide' }],
        [{ id: 'flat-to-gentle-down' }],
        rep(6, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        [{ id: 'flat-to-gentle-up' }],
        rep(3, 'gentle-up'),
        [{ id: 'gentle-up-to-flat' }],
        [{ id: 'turn-right-wide', bank: true }],
        [{ id: 'flat-to-gentle-down' }],
        rep(2, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-up' }, { id: 'gentle-up-to-flat' }],
        rep(6, 'flat'),
        [{ id: 'turn-right-wide', bank: true }],
        [{ id: 'flat-to-gentle-down' }],
        rep(3, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        rep(6, 'flat'),
        [{ id: 'brake' }, { id: 'brake' }],
        [{ id: 'turn-right-wide' }]
      )
    },

    'gentle-hills': {
      name: 'Gentle Hills',
      blurb: 'A tame family ride — a modest lift and a couple of small hills, no big forces.',
      finish: true,
      build: [].concat(
        // Lift to 6 m.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(2, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        // Drop back to the ground, a low hill, and back to the ground so the
        // auto-close solver only has to navigate home on the flat.
        [{ id: 'flat-to-gentle-down' }],
        rep(2, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-up-to-flat' }],
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-down-to-flat' }]
      )
    },

    'looper': {
      name: 'Looper',
      blurb: 'A lift and a drop feed a vertical loop, then the track curves back to the station.',
      finish: true,
      /* Laid out as a rough rectangle that turns back toward the station, so
         the auto-close solver only has a short final corner to fill rather than
         a whole U-turn-and-return from far out (which it couldn't find). */
      build: [].concat(
        // Side 1 (+i): lift to 14 m.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(6, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        rep(2, 'flat'),
        [{ id: 'turn-right-wide' }],
        // Side 2 (+j): drop to the ground, level off, and take the loop fast.
        [{ id: 'flat-to-gentle-down' }],
        rep(6, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        [{ id: 'flat' }],
        [{ id: 'loop-right' }],
        rep(2, 'flat'),
        [{ id: 'turn-right-wide' }],
        // Side 3 (-i): back across.
        rep(12, 'flat'),
        [{ id: 'turn-right-wide' }],
        // Side 4 (-j): part way home; the solver closes the last corner.
        rep(6, 'flat')
      )
    },

    'custom': {
      name: 'Custom (blank)',
      blurb: 'Just a station — a blank slate to build your own coaster from.',
      blank: true,
      build: []
    },

    /* Three trains, three routes down the same 23 m, released together.
       Whatever shape the track is, each arrives at the bottom doing the same
       speed, because gravity's work depends on the height dropped and nothing
       else. They arrive at very different TIMES, which is the other half of
       the point — and switching friction on breaks the match, because losses
       go with the length of the path rather than the height of it.

       Heights below are in levels (= metres), all from 23 down to 0:
         Steep    -6 -6 -6 -4 -1                       over 5 tiles
         Shallow  -2 x11, -1                           over 12 tiles
         Varied   -6 -4 -2 -1  0  0 -1 -4 -4 -1        over 10 tiles
       Each is padded with level track to the same finish line, so the trains
       end up side by side, still moving, at matching speeds. */
    'path-independence': {
      name: 'Path independence',
      blurb: 'Three trains race 23 m down a steep, a shallow and a varied track. ' +
             'Different routes, different times, identical speed at the bottom.',
      demo: {
        label: 'Path independence',
        cars: 1,             // a point mass, so the demo is about the path alone
        drop: 23,
        lanes: [
          {
            label: 'Steep', colour: '#cf3a2f', j: 12, g: -STEEP,
            ids: repId(3, 'steep-down')
              .concat(['steep-to-gentle-down', 'gentle-down-to-flat'])
              .concat(repId(15, 'flat'))
          },
          {
            label: 'Shallow', colour: '#1f6fb2', j: 20, g: -GENTLE,
            ids: repId(11, 'gentle-down')
              .concat(['gentle-down-to-flat'])
              .concat(repId(8, 'flat'))
          },
          {
            label: 'Varied', colour: '#2f855a', j: 28, g: -STEEP,
            ids: ['steep-down', 'steep-to-gentle-down', 'gentle-down',
                  'gentle-down-to-flat', 'flat', 'flat', 'flat-to-gentle-down',
                  'gentle-to-steep-down', 'steep-to-gentle-down', 'gentle-down-to-flat']
              .concat(repId(10, 'flat'))
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
        /* The spike, topping out at 35 m. It has to clear the LEAD car, not the
           train's average: the physics stalls the train when its MEAN height
           has used up the launch, and on this steep a grade a four-car train
           averages ~4.4 m below its front car. A 22 m/s launch is worth 24.7 m
           of mean climb, so the front car crests about 29 m — which is why a
           29 m spike (the obvious arithmetic) let it run off the top. 35 m
           leaves real margin, and a student who winds the launch past about
           24.5 m/s will still fly off the end, which is the lesson. */
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-to-steep-up' }],
        rep(5, 'steep-up')
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
    if (d.cars) RC.sim.cars = d.cars;
    return { ok: true, demo: true, closed: false, shuttle: false };
  }

  RC.loadPrefab = function (key) {
    const prefab = RC.PREFABS[key];
    if (!prefab) return { ok: false, why: `No prefab called "${key}"` };
    prefab.key = key;

    RC.resetTrack();
    if (prefab.demo) return loadDemo(prefab);
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
