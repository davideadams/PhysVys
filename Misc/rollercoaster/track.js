/* Track model: piece catalogue, build head, circuit validation.
   Knows nothing about the camera — see HANDOVER.md on the rotation design. */
(function () {
  const RC = window.RC || (window.RC = {});

  /* Directions are world-fixed: 0 = +i, 1 = +j, 2 = -i, 3 = -j. */
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  RC.DIRS = D;

  /* Slope is measured in height levels per tile, signed by travel direction.
     One tile is 4 m and one level is 1 m, so GENTLE is atan(2/4) = 27 deg and
     STEEP is atan(6/4) = 56 deg. Both plausible for a real coaster. */
  const FLAT = 0, GENTLE = 2, STEEP = 6;
  const MAX_H = 60;
  RC.MAX_H = MAX_H;

  /* A piece's height gain is the integral of its slope profile. Ramping the
     slope linearly from gIn to gOut over L tiles gives L*(gIn+gOut)/2, which
     is an integer for every combination below — that is why GENTLE and STEEP
     are even numbers, and it is what keeps the track snapped to the grid. */
  function straight(id, label, gIn, gOut, extra) {
    const L = 1;
    return Object.assign({
      id, label, kind: 'straight', gIn, gOut, L,
      dH: L * (gIn + gOut) / 2
    }, extra || {});
  }

  /* Quarter turns. The exit lands on an edge midpoint only when the radius is
     a half-integer number of tiles, so the usable radii are 1.5 (6 m) and
     2.5 (10 m). Flat only for now; sloped turns are a later phase. */
  function turn(id, label, dir, R) {
    return {
      id, label, kind: 'turn', gIn: FLAT, gOut: FLAT,
      turn: dir, R, dH: 0
    };
  }

  const PIECES = [
    straight('flat', 'Flat', FLAT, FLAT),

    straight('gentle-up', 'Gentle up', GENTLE, GENTLE, { liftable: true }),
    straight('gentle-down', 'Gentle down', -GENTLE, -GENTLE),
    straight('steep-up', 'Steep up', STEEP, STEEP, { liftable: true }),
    straight('steep-down', 'Steep down', -STEEP, -STEEP),

    straight('flat-to-gentle-up', 'Flat → gentle up', FLAT, GENTLE, { liftable: true }),
    straight('gentle-up-to-flat', 'Gentle up → flat', GENTLE, FLAT, { liftable: true }),
    straight('flat-to-gentle-down', 'Flat → gentle down', FLAT, -GENTLE),
    straight('gentle-down-to-flat', 'Gentle down → flat', -GENTLE, FLAT),

    straight('gentle-to-steep-up', 'Gentle → steep up', GENTLE, STEEP, { liftable: true }),
    straight('steep-to-gentle-up', 'Steep → gentle up', STEEP, GENTLE, { liftable: true }),
    straight('gentle-to-steep-down', 'Gentle → steep down', -GENTLE, -STEEP),
    straight('steep-to-gentle-down', 'Steep → gentle down', -STEEP, -GENTLE),

    turn('turn-left-tight', 'Left, tight', -1, 1.5),
    turn('turn-right-tight', 'Right, tight', 1, 1.5),
    turn('turn-left-wide', 'Left, wide', -1, 2.5),
    turn('turn-right-wide', 'Right, wide', 1, 2.5),

    straight('station', 'Station', FLAT, FLAT, { station: true }),
    straight('brake', 'Brake run', FLAT, FLAT, { brake: true }),
    straight('launch', 'Launch', FLAT, FLAT, { launch: true })
  ];

  const BY_ID = new Map(PIECES.map(p => [p.id, p]));
  RC.PIECES = PIECES;
  RC.pieceDef = id => BY_ID.get(id);

  RC.SLOPE = { FLAT, GENTLE, STEEP };

  /* Human-readable slope, for the status bar and palette grouping. */
  RC.slopeName = function (g) {
    if (g === 0) return 'flat';
    const dir = g > 0 ? 'up' : 'down';
    const mag = Math.abs(g) === GENTLE ? 'gentle' : (Math.abs(g) === STEEP ? 'steep' : '?');
    return mag + ' ' + dir;
  };

  /* ---- geometry -------------------------------------------------------
     A node is the joint between two pieces:
       { i, j, dir, k, g }
     meaning "the track is about to enter tile (i, j) travelling in direction
     dir, at height k levels, with slope g". Its position in continuous tile
     coordinates is the midpoint of that tile's incoming edge. */
  function entryPoint(node) {
    const d = D[node.dir];
    return { x: node.i + 0.5 - 0.5 * d[0], y: node.j + 0.5 - 0.5 * d[1] };
  }
  RC.entryPoint = entryPoint;

  /* Where does this piece put the head? */
  RC.exitNode = function (def, node) {
    const k = node.k + def.dH;
    if (def.kind === 'straight') {
      const d = D[node.dir];
      return {
        i: node.i + d[0] * def.L,
        j: node.j + d[1] * def.L,
        dir: node.dir,
        k, g: def.gOut
      };
    }
    // Turn: the exit is displaced by R along both the entry and exit
    // directions, which is what makes the quarter-circle land on a grid edge.
    const dir2 = (node.dir + def.turn + 4) & 3;
    const u = D[node.dir], v = D[dir2];
    const E = entryPoint(node);
    const px = E.x + def.R * (u[0] + v[0]);
    const py = E.y + def.R * (u[1] + v[1]);
    // Convert that exit point back into "about to enter tile (i, j)".
    const cx = px + 0.5 * v[0], cy = py + 0.5 * v[1];
    return { i: Math.round(cx - 0.5), j: Math.round(cy - 0.5), dir: dir2, k, g: def.gOut };
  };

  /* Normalised height profile: 0 at t=0, 1 at t=1, with end slopes in the
     ratio gIn : gOut so slope stays continuous across joints. */
  function heightFrac(def, t) {
    const a = def.gIn, b = def.gOut;
    const denom = (a + b) / 2;
    if (Math.abs(denom) < 1e-9) return t;   // flat piece, or dH === 0
    return (a * t + (b - a) * t * t / 2) / denom;
  }

  /* Centreline point at parameter t in [0, 1].
     Returns continuous tile coords (x, y) and height in levels (z). */
  RC.centreline = function (def, node, t) {
    const z = node.k + def.dH * heightFrac(def, t);
    const E = entryPoint(node);
    if (def.kind === 'straight') {
      const d = D[node.dir];
      return { x: E.x + d[0] * def.L * t, y: E.y + d[1] * def.L * t, z };
    }
    const dir2 = (node.dir + def.turn + 4) & 3;
    const u = D[node.dir], v = D[dir2];
    const C = { x: E.x + def.R * v[0], y: E.y + def.R * v[1] };
    const th = t * Math.PI / 2;
    const c = Math.cos(th), s = Math.sin(th);
    return {
      x: C.x + def.R * (-v[0] * c + u[0] * s),
      y: C.y + def.R * (-v[1] * c + u[1] * s),
      z
    };
  };

  /* Path length in metres. */
  RC.pieceLength = function (def) {
    const horiz = def.kind === 'straight'
      ? def.L * RC.TILE_M
      : def.R * RC.TILE_M * Math.PI / 2;
    const rise = def.dH * RC.LEVEL_M;
    return Math.hypot(horiz, rise);
  };

  /* Tiles the piece passes over, by sampling the centreline. Used for bounds
     checks, collision and (later) support placement. */
  RC.pieceTiles = function (def, node) {
    const seen = new Map();
    const N = def.kind === 'straight' ? 8 : 20;
    for (let s = 0; s <= N; s++) {
      const p = RC.centreline(def, node, s / N);
      const i = Math.floor(p.x), j = Math.floor(p.y);
      const key = i + ',' + j;
      if (!seen.has(key)) seen.set(key, { i, j, k: Math.round(p.z) });
    }
    return [...seen.values()];
  };

  /* ---- the track ------------------------------------------------------ */
  RC.track = {
    start: null,     // node the first piece leaves from
    pieces: [],      // [{ defId, node, lift }] — node is the ENTRY node
    head: null       // node the next piece would leave from
  };

  function sameNode(a, b) {
    return a && b && a.i === b.i && a.j === b.j && a.dir === b.dir && a.k === b.k && a.g === b.g;
  }
  RC.sameNode = sameNode;

  /* Can this piece go on the head right now, and if not, why? */
  RC.canPlace = function (def, head) {
    if (!head) return { ok: false, why: 'No build head' };
    if (def.gIn !== head.g) {
      return { ok: false, why: `Needs a ${RC.slopeName(def.gIn)} entry` };
    }
    const exit = RC.exitNode(def, head);
    if (exit.k < 0) return { ok: false, why: 'Would go below ground' };
    if (exit.k > MAX_H) return { ok: false, why: 'Too high' };
    for (const t of RC.pieceTiles(def, head)) {
      if (!RC.inBounds(t.i, t.j)) return { ok: false, why: 'Off the edge of the park' };
    }
    if (!RC.inBounds(exit.i, exit.j)) return { ok: false, why: 'Off the edge of the park' };
    return { ok: true, exit };
  };

  RC.place = function (defId, opts) {
    const def = BY_ID.get(defId);
    if (!def) return false;
    const head = RC.track.head;
    const check = RC.canPlace(def, head);
    if (!check.ok) return false;
    RC.track.pieces.push({
      defId,
      node: { i: head.i, j: head.j, dir: head.dir, k: head.k, g: head.g },
      lift: !!(opts && opts.lift) && !!def.liftable
    });
    RC.track.head = check.exit;
    return true;
  };

  RC.undo = function () {
    const t = RC.track;
    if (!t.pieces.length) return false;
    const last = t.pieces.pop();
    t.head = { i: last.node.i, j: last.node.j, dir: last.node.dir, k: last.node.k, g: last.node.g };
    return true;
  };

  /* ---- circuit validation ---------------------------------------------
     Closed: the head has come back to exactly the node the track started
     from. Shuttle: it hasn't, but there's a launch piece to drive an
     out-and-back run. */
  RC.circuitStatus = function () {
    const t = RC.track;
    if (!t.pieces.length) return { kind: 'empty', label: 'No track' };

    const hasStation = t.pieces.some(p => BY_ID.get(p.defId).station);
    const hasLaunch = t.pieces.some(p => BY_ID.get(p.defId).launch);

    if (sameNode(t.head, t.start)) {
      return hasStation
        ? { kind: 'closed', label: 'Complete circuit', ok: true }
        : { kind: 'closed-nostation', label: 'Circuit closed, but no station' };
    }
    if (hasLaunch) {
      return hasStation
        ? { kind: 'shuttle', label: 'Shuttle track', ok: true }
        : { kind: 'shuttle-nostation', label: 'Shuttle, but no station' };
    }
    return { kind: 'open', label: 'Track is not finished' };
  };

  /* Total path length in metres. */
  RC.trackLength = function () {
    return RC.track.pieces.reduce((s, p) => s + RC.pieceLength(BY_ID.get(p.defId)), 0);
  };

  /* ---- setup ----------------------------------------------------------
     Start every park with a short station, so there is always something to
     build from and the first load isn't a blank field. */
  RC.resetTrack = function () {
    const t = RC.track;
    t.pieces = [];
    t.start = { i: 4, j: 9, dir: 0, k: 0, g: FLAT };
    t.head = Object.assign({}, t.start);
    for (let n = 0; n < 3; n++) RC.place('station');
    return t;
  };

  RC.clearToStation = RC.resetTrack;
})();
