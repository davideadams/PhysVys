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
      blurb: 'A lift and a drop feed a vertical loop, then the track winds back to the station.',
      finish: true,
      build: [].concat(
        // Lift to 14 m.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(6, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        // Drop back to the ground, fast, and level off for the loop.
        [{ id: 'flat-to-gentle-down' }],
        rep(6, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        [{ id: 'flat' }],
        // The loop.
        [{ id: 'loop-right' }],
        rep(2, 'flat')
      )
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
        // A spike tall enough that the train stalls short of the top and rolls
        // back (a launch reaching ~25 m climbs; the spike tops out higher).
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-to-steep-up' }],
        rep(4, 'steep-up')
      )
    }
  };

  /* Build a prefab. Pieces go through the normal RC.place, so a prefab can only
     contain track a student could have built by hand. Closed presets are then
     auto-closed with RC.completeTrack. */
  RC.loadPrefab = function (key) {
    const prefab = RC.PREFABS[key];
    if (!prefab) return { ok: false, why: `No prefab called "${key}"` };

    RC.resetTrack();
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
