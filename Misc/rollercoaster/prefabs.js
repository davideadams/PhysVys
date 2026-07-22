/* Ready-built coasters.

   The page loads with one already standing, because a station on its own
   can't be tested — pressing Test on an unfinished circuit correctly refuses,
   which is a poor greeting for a teacher who has just opened the link.

   A closed circuit has to satisfy two arithmetic conditions, and both are
   easy to break by eye:

     - Four quarter turns of equal radius cancel exactly, so the STRAIGHTS
       alone must carry the head back to the start. Here the station is 3
       pieces long, so the -i side runs 3 pieces longer than the +i side and
       the two j sides match. First Drop uses 10 / 13 / 13 / 13.
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
      blurb: 'Chain lift, then three drops and two airtime hills back to the station.',

      /* Height profile, in metres:
         0 --lift--> 16 --drop--> 2 --hill--> 10 --drop--> 4 --hill--> 8 --drop--> 0

         Deliberately three drops and two hills rather than one long descent.
         A single descent shows potential energy turning into kinetic once;
         this trades it back and forth five times, so the bars visibly swap
         and the graph is a row of peaks and troughs rather than a slope.

         Each hill is lower than the one before it — it has to be, since the
         train can never climb higher than it started, and lower still once
         friction is switched on. */
      build: [].concat(
        // Lift hill: 16 m up, chain all the way.
        [{ id: 'flat-to-gentle-up', lift: true }],
        rep(7, 'gentle-up', { lift: true }),
        [{ id: 'gentle-up-to-flat', lift: true }],
        [{ id: 'flat' }],
        // Crest turn, taken at lift speed, so it needs no banking.
        [{ id: 'turn-right-wide' }],

        // Drop 1: the big one, 16 m down to 2 m.
        [{ id: 'flat-to-gentle-down' }],
        rep(6, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        // Hill 1: back up to 10 m.
        [{ id: 'flat-to-gentle-up' }],
        rep(3, 'gentle-up'),
        [{ id: 'gentle-up-to-flat' }],

        [{ id: 'turn-right-wide', bank: true }],

        // Drop 2: 10 m down to 4 m.
        [{ id: 'flat-to-gentle-down' }],
        rep(2, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        // Hill 2: back up to 8 m.
        [{ id: 'flat-to-gentle-up' }, { id: 'gentle-up' }, { id: 'gentle-up-to-flat' }],
        rep(6, 'flat'),

        [{ id: 'turn-right-wide', bank: true }],

        // Drop 3: 8 m down to the ground.
        [{ id: 'flat-to-gentle-down' }],
        rep(3, 'gentle-down'),
        [{ id: 'gentle-down-to-flat' }],
        // Brake run, then the last turn at a crawl into the station.
        rep(6, 'flat'),
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
