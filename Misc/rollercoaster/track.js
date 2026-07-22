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

  /* Bumped whenever the track changes, so derived data can cache against it. */
  RC.version = 0;

  /* ---- arc-length path -------------------------------------------------
     Every piece sampled into one continuous polyline with cumulative distance
     in METRES. The renderer uses it to space sleepers and supports evenly
     (rather than per-piece, which would bunch them up on turns), and the
     physics runs along the same table so what you see is what is simulated. */
  let pathCache = null, pathCacheVersion = -1;

  RC.trackPath = function () {
    if (pathCache && pathCacheVersion === RC.version) return pathCache;

    const pts = [];
    let s = 0, prev = null;

    for (let pi = 0; pi < RC.track.pieces.length; pi++) {
      const p = RC.track.pieces[pi];
      const def = BY_ID.get(p.defId);
      const n = def.kind === 'straight' ? 8 : 24;   // ~0.5 m resolution
      for (let q = 0; q <= n; q++) {
        if (q === 0 && pi > 0) continue;            // joint shared with previous piece
        const t = q / n;
        const c = RC.centreline(def, p.node, t);
        if (prev) {
          s += Math.hypot(
            (c.x - prev.x) * RC.TILE_M,
            (c.y - prev.y) * RC.TILE_M,
            (c.z - prev.z) * RC.LEVEL_M
          );
        }
        pts.push({ x: c.x, y: c.y, z: c.z, s, pi, t, piece: p, def });
        prev = c;
      }
    }

    /* Per-point slope and curvature, in metres, for the physics. dz/ds is the
       sine of the track's pitch — the whole of the gravitational term.

       Curvature is kept as a VECTOR, not just a magnitude: it is d(unit
       tangent)/ds, which points towards the centre of curvature. The g-force
       calculation needs that direction to tell a rider being pressed into
       their seat from one being thrown sideways. */
    for (let n = 0; n < pts.length; n++) {
      const a = pts[Math.max(0, n - 1)];
      const b = pts[Math.min(pts.length - 1, n + 1)];
      const ds = b.s - a.s;
      pts[n].dzds = ds > 1e-9 ? (b.z - a.z) * RC.LEVEL_M / ds : 0;

      const k = curvatureVector(a, pts[n], b);
      pts[n].kx = k[0];
      pts[n].ky = k[1];
      pts[n].kz = k[2];
      pts[n].curv = Math.hypot(k[0], k[1], k[2]);
    }

    pathCache = { pts, total: s };
    pathCacheVersion = RC.version;
    return pathCache;
  };

  /* Curvature vector at b, from its neighbours a and c: the rate of change of
     the unit tangent with arc length. Magnitude is 1/radius; direction points
     towards the centre of curvature. All in metres. */
  function curvatureVector(a, b, c) {
    const P = p => [p.x * RC.TILE_M, p.y * RC.TILE_M, p.z * RC.LEVEL_M];
    const A = P(a), B = P(b), C = P(c);
    const t1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const t2 = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
    const l1 = Math.hypot(t1[0], t1[1], t1[2]);
    const l2 = Math.hypot(t2[0], t2[1], t2[2]);
    if (l1 < 1e-9 || l2 < 1e-9) return [0, 0, 0];
    const ds = (l1 + l2) / 2;
    return [
      (t2[0] / l2 - t1[0] / l1) / ds,
      (t2[1] / l2 - t1[1] / l1) / ds,
      (t2[2] / l2 - t1[2] / l1) / ds
    ];
  }

  /* Distance along the track between two arc positions. On a closed circuit
     the short way round counts, so a point just after the start line is near
     one just before it rather than a full lap away. */
  RC.arcGap = function (s1, s2, closed) {
    const total = RC.trackPath().total;
    let d = Math.abs(s1 - s2);
    if (closed && total > 0) {
      d = d % total;
      d = Math.min(d, total - d);
    }
    return d;
  };

  /* Interpolated state at arc position s (metres). Wraps on a closed
     circuit, clamps otherwise. */
  RC.pathAt = function (sQuery, closed) {
    const path = RC.trackPath();
    const pts = path.pts;
    if (pts.length < 2) return null;

    let s = sQuery;
    if (closed) {
      s = ((s % path.total) + path.total) % path.total;
    } else {
      s = Math.min(path.total, Math.max(0, s));
    }

    let lo = 0, hi = pts.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const span = b.s - a.s;
    const f = span > 1e-9 ? (s - a.s) / span : 0;
    const mix = (p, q) => p + (q - p) * f;
    return {
      s,
      x: mix(a.x, b.x),
      y: mix(a.y, b.y),
      z: mix(a.z, b.z),
      dzds: mix(a.dzds, b.dzds),
      curv: mix(a.curv, b.curv),
      kx: mix(a.kx, b.kx),
      ky: mix(a.ky, b.ky),
      kz: mix(a.kz, b.kz),
      piece: f < 0.5 ? a.piece : b.piece,
      def: f < 0.5 ? a.def : b.def
    };
  };

  function sameNode(a, b) {
    return a && b && a.i === b.i && a.j === b.j && a.dir === b.dir && a.k === b.k && a.g === b.g;
  }
  RC.sameNode = sameNode;

  /* ---- collision -------------------------------------------------------
     Track may cross over itself, but not run through itself. Two bits of
     track conflict when they share a tile with less than CLEARANCE levels
     between them.

     Only the INTERIOR of a piece is tested (t in 0.2..0.8) and the piece
     immediately behind the head is skipped, because neighbouring pieces
     legitimately share their joint tile. Without both of those, ordinary
     S-bends and U-turns would be refused. */
  const CLEARANCE = 3;   // levels = metres

  function interiorCells(def, node) {
    const cells = [];
    const n = def.kind === 'straight' ? 10 : 24;
    for (let q = 0; q <= n; q++) {
      const t = q / n;
      if (t < 0.2 || t > 0.8) continue;
      const c = RC.centreline(def, node, t);
      cells.push({ i: Math.floor(c.x), j: Math.floor(c.y), z: c.z });
    }
    return cells;
  }

  /* Occupancy of the existing track, tile -> [{z, pi}], cached against the
     version counter. Rebuilding this per collision test made the palette
     O(pieces^2) on every refresh and would have made the route search below
     unusable. */
  let occCache = null, occCacheVersion = -1;

  function occupancy() {
    if (occCache && occCacheVersion === RC.version) return occCache;
    const m = new Map();
    const pieces = RC.track.pieces;
    for (let pi = 0; pi < pieces.length; pi++) {
      for (const c of interiorCells(BY_ID.get(pieces[pi].defId), pieces[pi].node)) {
        const key = c.i + ',' + c.j;
        let arr = m.get(key);
        if (!arr) { arr = []; m.set(key, arr); }
        arr.push({ z: c.z, pi });
      }
    }
    occCache = m;
    occCacheVersion = RC.version;
    return m;
  }

  function collidesWith(def, node, occ, skipPi) {
    for (const c of interiorCells(def, node)) {
      const arr = occ.get(c.i + ',' + c.j);
      if (!arr) continue;
      for (const e of arr) {
        if (e.pi === skipPi) continue;
        if (Math.abs(e.z - c.z) < CLEARANCE) return true;
      }
    }
    return false;
  }

  function collides(def, head) {
    // The piece at the head legitimately shares its joint tile.
    return collidesWith(def, head, occupancy(), RC.track.pieces.length - 1);
  }

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
    if (collides(def, head)) return { ok: false, why: 'Runs into track already built' };
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
    RC.version++;
    return true;
  };

  RC.undo = function () {
    const t = RC.track;
    if (!t.pieces.length) return false;
    const last = t.pieces.pop();
    t.head = { i: last.node.i, j: last.node.j, dir: last.node.dir, k: last.node.k, g: last.node.g };
    RC.version++;
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

  /* ---- finish the track -------------------------------------------------
     RCT2's "complete the circuit": search for any sequence of pieces from the
     build head back to the start node. The result is deliberately dull — the
     point is to close a circuit so it can be tested, not to design a ride.

     A* over nodes {i, j, dir, k, g}. The cost is roughly one per piece, so a
     heuristic counting the fewest pieces that could possibly cover the
     remaining distance is admissible. */

  /* Only plain geometry — no stations, brakes or launches in a filler run. */
  const ROUTE_IDS = [
    'flat',
    'gentle-up', 'gentle-down', 'steep-up', 'steep-down',
    'flat-to-gentle-up', 'gentle-up-to-flat',
    'flat-to-gentle-down', 'gentle-down-to-flat',
    'gentle-to-steep-up', 'steep-to-gentle-up',
    'gentle-to-steep-down', 'steep-to-gentle-down',
    'turn-left-wide', 'turn-right-wide', 'turn-left-tight', 'turn-right-tight'
  ];

  /* Slight preferences, so the filler favours straight level track. */
  function routeCost(def) {
    if (def.kind === 'turn') return 1.25;
    if (def.gIn !== 0 || def.gOut !== 0) return 1.2;
    return 1;
  }

  const MAX_ADVANCE = 5;   // best Manhattan tile gain from one piece (wide turn)
  const MAX_CLIMB = 6;     // best height change from one piece (steep)

  function Heap() { this.a = []; }
  Heap.prototype.push = function (item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  };

  const nodeKey = n => n.i + ',' + n.j + ',' + n.dir + ',' + n.k + ',' + n.g;

  RC.findRouteHome = function (limits) {
    const target = RC.track.start;
    const from = RC.track.head;
    if (!target || !from) return { ok: false, why: 'There is no track to finish' };
    if (sameNode(from, target)) return { ok: false, why: 'The circuit is already complete' };

    const maxExpand = (limits && limits.maxExpand) || 40000;
    const maxPieces = (limits && limits.maxPieces) || 150;
    const occ = occupancy();
    const skipPi = RC.track.pieces.length - 1;
    const defs = ROUTE_IDS.map(id => BY_ID.get(id)).filter(Boolean);

    const heuristic = n => Math.max(
      (Math.abs(n.i - target.i) + Math.abs(n.j - target.j)) / MAX_ADVANCE,
      Math.abs(n.k - target.k) / MAX_CLIMB
    );

    const open = new Heap();
    const best = new Map();
    const startKey = nodeKey(from);
    best.set(startKey, { g: 0, node: from, parent: null, defId: null });
    // Weighted slightly, trading a possibly longer route for a much faster
    // search. The route only has to be legal and dull, not optimal.
    open.push({ f: heuristic(from) * 1.2, key: startKey });

    let expanded = 0;
    let goal = null;

    while (open.a.length && expanded < maxExpand) {
      const cur = open.pop();
      // Stale heap items resolve to whatever entry is now best for that key,
      // so a single closed flag is enough to skip repeats.
      const entry = best.get(cur.key);
      if (!entry || entry.closed) continue;
      entry.closed = true;
      expanded++;

      const node = entry.node;
      if (sameNode(node, target)) { goal = entry; break; }
      if (entry.g >= maxPieces) continue;

      for (const def of defs) {
        if (def.gIn !== node.g) continue;
        const exit = RC.exitNode(def, node);
        if (exit.k < 0 || exit.k > MAX_H) continue;
        if (!RC.inBounds(exit.i, exit.j)) continue;

        // Bounds and collision from one pass over the cells. A quarter turn's
        // widest bulge is at t = 0.5, so the interior samples catch it.
        let bad = false;
        for (const c of interiorCells(def, node)) {
          if (!RC.inBounds(c.i, c.j)) { bad = true; break; }
          const arr = occ.get(c.i + ',' + c.j);
          if (!arr) continue;
          for (const e of arr) {
            if (e.pi !== skipPi && Math.abs(e.z - c.z) < CLEARANCE) { bad = true; break; }
          }
          if (bad) break;
        }
        if (bad) continue;

        const g = entry.g + routeCost(def);
        const key = nodeKey(exit);
        const prev = best.get(key);
        if (prev && prev.g <= g) continue;
        const next = { g, node: exit, parent: entry, defId: def.id };
        best.set(key, next);
        open.push({ f: g + heuristic(exit) * 1.2, key });
      }
    }

    if (!goal) {
      return {
        ok: false,
        why: expanded >= maxExpand
          ? 'Could not find a way back to the station'
          : 'There is no way back to the station from here'
      };
    }

    const ids = [];
    for (let e = goal; e && e.defId; e = e.parent) ids.unshift(e.defId);
    return { ok: true, ids, expanded };
  };

  /* Find a route and actually build it. Everything is placed through the
     normal RC.place, so the finished track obeys exactly the same rules as
     hand-built track; if any piece is refused the whole lot is rolled back
     rather than leaving a half-finished stub. */
  RC.completeTrack = function (limits) {
    const route = RC.findRouteHome(limits);
    if (!route.ok) return route;

    const before = RC.track.pieces.length;
    for (const id of route.ids) {
      if (!RC.place(id)) {
        while (RC.track.pieces.length > before) RC.undo();
        return { ok: false, why: 'The route it found ran into the track on the way' };
      }
    }
    if (!sameNode(RC.track.head, RC.track.start)) {
      while (RC.track.pieces.length > before) RC.undo();
      return { ok: false, why: 'The route it found did not close the circuit' };
    }
    return { ok: true, added: route.ids.length };
  };

  /* ---- setup ----------------------------------------------------------
     Start every park with a short station, so there is always something to
     build from and the first load isn't a blank field. */
  RC.resetTrack = function () {
    const t = RC.track;
    t.pieces = [];
    RC.version++;
    // Near the middle of the park, so it's on screen at the default zoom and
    // there's room to build in every direction.
    t.start = { i: 16, j: 19, dir: 0, k: 0, g: FLAT };
    t.head = Object.assign({}, t.start);
    for (let n = 0; n < 3; n++) RC.place('station');
    return t;
  };

  RC.clearToStation = RC.resetTrack;
})();
