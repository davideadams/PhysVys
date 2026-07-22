/* Ready-built coasters.

   The page loads with one already standing, because a station on its own
   can't be tested — pressing Test on an unfinished circuit correctly refuses,
   which is a poor greeting for a teacher who has just opened the link.

   A closed circuit has to satisfy two arithmetic conditions, and both are
   easy to break by eye:

     - Four quarter turns of equal radius cancel exactly, so the STRAIGHTS
       alone must carry the head back to the start. Here the station is 3
       pieces long, so the -i side runs 3 pieces longer than the +i side and
       the two j sides match.
     - The height changes must sum to zero.

   test.html checks both for every prefab, so a layout that doesn't close is
   caught rather than shipped. */
(function () {
  const RC = window.RC || (window.RC = {});

  const rep = (n, id, opts) =>
    new Array(n).fill(0).map(() => Object.assign({ id }, opts || {}));

  RC.PREFABS = {
    'first-drop': {
      name: 'First Drop',
      blurb: 'Chain lift, a drop, and two banked turns back to the station.',
      build: [].concat(
        // Lift hill: 10 m up, chain all the way.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(4, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        // Crest turn, taken slowly, so it doesn't need banking.
        [{ id: 'turn-right-wide' }],
        // The drop: 6 m.
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-down' },
         { id: 'gentle-down' }, { id: 'gentle-down-to-flat' }],
        rep(2, 'flat'),
        // Fast turns, banked — flat ones here would be about 1.4 g sideways.
        [{ id: 'turn-right-wide', bank: true }],
        [{ id: 'flat-to-gentle-down' }, { id: 'gentle-down' },
         { id: 'gentle-down-to-flat' }],
        rep(7, 'flat'),
        [{ id: 'turn-right-wide', bank: true }],
        // Brake run, then the last turn at a crawl into the station.
        rep(4, 'flat'),
        [{ id: 'brake' }, { id: 'brake' }],
        [{ id: 'turn-right-wide' }]
      )
    }
  };

  /* Build a prefab from scratch. Pieces go through the normal RC.place, so a
     prefab can only contain track a student could have built by hand. */
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
    return { ok: true, closed: RC.sameNode(RC.track.head, RC.track.start) };
  };
})();
