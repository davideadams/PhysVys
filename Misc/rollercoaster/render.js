/* Track rendering. Everything drawable is collected into one list, sorted
   back-to-front by RC.depth, then drawn — so track crossing over other track
   occludes it correctly.

   Geometry comes from RC.trackPath(), the arc-length table, so sleepers and
   supports are spaced evenly in METRES rather than per piece (which would
   bunch them up on turns and stretch them on straights). */
(function () {
  const RC = window.RC || (window.RC = {});

  const RAIL_TOP = '#eef3f7';
  const RAIL_DARK = '#5f7080';
  const SPINE = '#4a5a68';
  const SPINE_DARK = '#33404b';

  const SLEEPER = '#6d4c33';
  const LIFT_SLEEPER = '#b8860b';
  const STATION_SLEEPER = '#59636d';
  const BRAKE_SLEEPER = '#8c3b3b';
  const LAUNCH_SLEEPER = '#6f3f96';

  const POST = '#9aa4ac';
  const POST_DARK = '#68727a';
  const BRACE = '#7d878f';

  const PLATFORM = '#c9b18b';
  const PLATFORM_EDGE = '#9c8259';

  const CHAIN = '#3d3428';

  /* Half the track gauge, in tiles. 0.2 tiles = 0.8 m each side. */
  const HG = 0.2;
  const SLEEPER_M = 1.6;    // metres between sleepers
  const SUPPORT_M = 6.0;    // metres between support bents
  const BENT_RUNG_M = 5.0;  // metres between cross-braces up a tall bent

  function sleeperColour(def, piece) {
    if (piece && piece.lift) return LIFT_SLEEPER;
    if (def.station) return STATION_SLEEPER;
    if (def.brake) return BRAKE_SLEEPER;
    if (def.launch) return LAUNCH_SLEEPER;
    return SLEEPER;
  }

  /* Tangent from neighbouring path points, and the horizontal normal to it.
     Offsets are done in WORLD space then projected, so the track's width
     foreshortens correctly instead of staying a constant number of pixels. */
  function normalAt(pts, idx) {
    const a = pts[Math.max(0, idx - 1)];
    const b = pts[Math.min(pts.length - 1, idx + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
  }

  function line(ctx, p, q, colour, width) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  /* ---- drawables -------------------------------------------------------- */

  function drawRail(ctx, d, cam, view) {
    const { a, b, na, nb } = d;
    const z = cam.zoom;
    const S = (p, n, s, dz) => RC.toScreen(p.x + n.x * HG * s, p.y + n.y * HG * s, p.z + (dz || 0), cam, view);

    // Spine below the rails, which is what gives the track visual mass.
    const sa = S(a, na, 0, -0.35), sb = S(b, nb, 0, -0.35);
    line(ctx, sa, sb, SPINE_DARK, Math.max(2, 5.2 * z));
    line(ctx, sa, sb, SPINE, Math.max(1, 3.0 * z));

    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      const pa = S(a, na, s), pb = S(b, nb, s);
      line(ctx, pa, pb, RAIL_DARK, Math.max(1.8, 3.4 * z));
      line(ctx, pa, pb, RAIL_TOP, Math.max(0.8, 1.5 * z));
    }
    ctx.lineCap = 'butt';
  }

  function drawSleeper(ctx, d, cam, view) {
    const { p, n, colour } = d;
    const z = cam.zoom;
    const l = RC.toScreen(p.x + n.x * HG * 1.5, p.y + n.y * HG * 1.5, p.z - 0.3, cam, view);
    const r = RC.toScreen(p.x - n.x * HG * 1.5, p.y - n.y * HG * 1.5, p.z - 0.3, cam, view);
    line(ctx, l, r, colour, Math.max(1.5, 4.0 * z));
  }

  /* Chain dogs along a lift hill, so it reads as powered rather than just
     coloured differently. */
  function drawChain(ctx, d, cam, view) {
    const { p, n } = d;
    const z = cam.zoom;
    const l = RC.toScreen(p.x + n.x * HG * 0.35, p.y + n.y * HG * 0.35, p.z - 0.15, cam, view);
    const r = RC.toScreen(p.x - n.x * HG * 0.35, p.y - n.y * HG * 0.35, p.z - 0.15, cam, view);
    line(ctx, l, r, CHAIN, Math.max(1.2, 2.4 * z));
  }

  /* A support bent: two legs under the rails, cross-braced up its height. */
  function drawBent(ctx, d, cam, view) {
    const { p, n } = d;
    const z = cam.zoom;
    const legW = Math.max(1.5, 3.6 * z);

    const feet = [], tops = [];
    for (const s of [1, -1]) {
      const x = p.x + n.x * HG * s, y = p.y + n.y * HG * s;
      tops.push(RC.toScreen(x, y, p.z - 0.4, cam, view));
      feet.push(RC.toScreen(x, y, 0, cam, view));
    }

    // Cross-bracing first so the legs draw over it.
    const rungs = Math.max(1, Math.floor(p.z / BENT_RUNG_M));
    for (let r = 1; r <= rungs; r++) {
      const h = p.z * (r / (rungs + 1));
      const a = RC.toScreen(p.x + n.x * HG, p.y + n.y * HG, h, cam, view);
      const b = RC.toScreen(p.x - n.x * HG, p.y - n.y * HG, h, cam, view);
      line(ctx, a, b, BRACE, Math.max(1, 1.8 * z));
      // Alternating diagonal, giving the lattice its zig-zag.
      const hNext = p.z * ((r + 0.5) / (rungs + 1));
      const c = RC.toScreen(
        p.x + n.x * HG * (r % 2 ? -1 : 1),
        p.y + n.y * HG * (r % 2 ? -1 : 1),
        hNext, cam, view);
      line(ctx, r % 2 ? a : b, c, BRACE, Math.max(0.8, 1.4 * z));
    }

    for (let s = 0; s < 2; s++) {
      line(ctx, tops[s], feet[s], POST_DARK, legW);
      line(ctx, tops[s], feet[s], POST, Math.max(0.8, legW * 0.45));
    }
  }

  /* Station platforms, one either side of the track. */
  function drawPlatform(ctx, d, cam, view) {
    const { a, b, na, nb } = d;
    for (const s of [1, -1]) {
      const q = [
        RC.toScreen(a.x + na.x * HG * 1.6 * s, a.y + na.y * HG * 1.6 * s, a.z - 0.4, cam, view),
        RC.toScreen(a.x + na.x * HG * 4.2 * s, a.y + na.y * HG * 4.2 * s, a.z - 0.4, cam, view),
        RC.toScreen(b.x + nb.x * HG * 4.2 * s, b.y + nb.y * HG * 4.2 * s, b.z - 0.4, cam, view),
        RC.toScreen(b.x + nb.x * HG * 1.6 * s, b.y + nb.y * HG * 1.6 * s, b.z - 0.4, cam, view)
      ];
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let n = 1; n < 4; n++) ctx.lineTo(q[n].x, q[n].y);
      ctx.closePath();
      ctx.fillStyle = PLATFORM;
      ctx.fill();
      ctx.strokeStyle = PLATFORM_EDGE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /* ---- assembly --------------------------------------------------------- */

  RC.drawTrack = function (ctx, cam, view, extras) {
    const path = RC.trackPath();
    const pts = path.pts;
    const list = [];

    if (pts.length > 1) {
      const normals = pts.map((_, n) => normalAt(pts, n));

      for (let n = 1; n < pts.length; n++) {
        const a = pts[n - 1], b = pts[n];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const d = RC.depth(mid.x, mid.y, mid.z, cam.rot);
        list.push({
          depth: d, draw: drawRail,
          a, b, na: normals[n - 1], nb: normals[n]
        });
        if (b.def.station) {
          list.push({
            depth: d - 0.5, draw: drawPlatform,
            a, b, na: normals[n - 1], nb: normals[n]
          });
        }
      }

      // Evenly spaced sleepers, chain dogs and support bents.
      let nextSleeper = 0, nextSupport = 0;
      for (let n = 0; n < pts.length; n++) {
        const p = pts[n];
        if (p.s >= nextSleeper) {
          nextSleeper = p.s + SLEEPER_M;
          list.push({
            depth: RC.depth(p.x, p.y, p.z, cam.rot) - 0.3,
            draw: drawSleeper, p, n: normals[n],
            colour: sleeperColour(p.def, p.piece)
          });
          if (p.piece.lift) {
            list.push({
              depth: RC.depth(p.x, p.y, p.z, cam.rot) + 0.2,
              draw: drawChain, p, n: normals[n]
            });
          }
        }
        if (p.s >= nextSupport && p.z > 0.8) {
          nextSupport = p.s + SUPPORT_M;
          // Sorted at the foot, so anything in front of the bent draws later.
          list.push({
            depth: RC.depth(p.x, p.y, 0, cam.rot),
            draw: drawBent, p, n: normals[n]
          });
        } else if (p.s >= nextSupport) {
          nextSupport = p.s + SUPPORT_M;
        }
      }
    }

    for (const e of (extras || [])) list.push(e);

    list.sort((p, q) => p.depth - q.depth);
    for (const d of list) d.draw(ctx, d, cam, view);
  };

  /* ---- train ------------------------------------------------------------
     Each car is a small isometric box sitting on the rails, oriented along
     the local tangent so it banks round with the track. */
  /* All in METRES; drawCar converts to tile/level space at the end. */
  const CAR_HL = 1.5;     // half length (3 m car)
  const CAR_HW = 0.8;     // half width (1.6 m)
  const CAR_H = 1.6;      // height
  const CAR_FLOOR = 0.25; // clearance above the rail centreline

  const CAR_FRONT = '#cf3a2f';
  const CAR_BODY = '#1f6fb2';
  const CAR_TOP_LIGHTEN = '#ffffff';
  const CAR_EDGE = 'rgba(15, 30, 45, 0.75)';

  function quad(ctx, p, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let n = 1; n < p.length; n++) ctx.lineTo(p[n].x, p[n].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawCar(ctx, d, cam, view) {
    const p = d.p;
    // Body axes follow the track's full 3D tangent, so the car pitches with
    // the slope instead of sitting horizontally on a hill.
    const { f, r, u } = RC.carFrame(p);

    const P = (fl, fw, fu) => {
      const up = CAR_FLOOR + CAR_H * fu;
      const mx = p.x * RC.TILE_M + f.x * CAR_HL * fl + r.x * CAR_HW * fw + u.x * up;
      const my = p.y * RC.TILE_M + f.y * CAR_HL * fl + r.y * CAR_HW * fw + u.y * up;
      const mz = p.z * RC.LEVEL_M + f.z * CAR_HL * fl + r.z * CAR_HW * fw + u.z * up;
      return RC.toScreen(mx / RC.TILE_M, my / RC.TILE_M, mz / RC.LEVEL_M, cam, view);
    };

    const lo = [P(1, 1, 0), P(1, -1, 0), P(-1, -1, 0), P(-1, 1, 0)];
    const hi = [P(1, 1, 1), P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1)];

    const base = d.idx === 0 ? CAR_FRONT : CAR_BODY;

    // Side faces sorted back-to-front, then the roof on top.
    const faces = [];
    for (let n = 0; n < 4; n++) {
      const m = (n + 1) % 4;
      const pts = [lo[n], lo[m], hi[m], hi[n]];
      const midY = (lo[n].y + lo[m].y + hi[m].y + hi[n].y) / 4;
      faces.push({ pts, midY });
    }
    faces.sort((u, w) => u.midY - w.midY);
    for (const f of faces) quad(ctx, f.pts, base, CAR_EDGE);

    ctx.globalAlpha = 0.22;
    quad(ctx, hi, CAR_TOP_LIGHTEN, null);
    ctx.globalAlpha = 1;
    quad(ctx, hi, 'rgba(0,0,0,0)', CAR_EDGE);
  }

  RC.trainDrawables = function (cam) {
    const out = [];
    if (!RC.sim || RC.trackPath().pts.length < 2) return out;
    const cars = RC.carStates();
    for (let n = 0; n < cars.length; n++) {
      const p = cars[n];
      out.push({
        depth: RC.depth(p.x, p.y, p.z, cam.rot) + 0.4,
        draw: drawCar, p, idx: n
      });
    }
    return out;
  };

  /* ---- build head and ghost preview ----------------------------------- */

  RC.drawHead = function (ctx, d, cam, view) {
    const head = d.head;
    if (!head) return;
    const E = RC.entryPoint(head);
    const dir = RC.DIRS[head.dir];
    const per = [-dir[1], dir[0]];
    const P = (fx, fy) => RC.toScreen(E.x + fx, E.y + fy, head.k, cam, view);

    const tip = P(dir[0] * 0.55, dir[1] * 0.55);
    const base = P(0, 0);
    const l = P(per[0] * 0.28, per[1] * 0.28);
    const r = P(-per[0] * 0.28, -per[1] * 0.28);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(l.x, l.y);
    ctx.lineTo(base.x, base.y);
    ctx.lineTo(r.x, r.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 214, 74, 0.92)';
    ctx.strokeStyle = 'rgba(90, 60, 0, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  RC.drawGhost = function (ctx, d, cam, view) {
    const { def, head, ok } = d;
    if (!def || !head) return;
    const n = def.kind === 'straight' ? 8 : 20;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = ok ? '#0d9488' : '#c62828';
    ctx.lineWidth = Math.max(3, 6 * cam.zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = 0; s <= n; s++) {
      const c = RC.centreline(def, head, s / n);
      const p = RC.toScreen(c.x, c.y, c.z, cam, view);
      if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    const end = RC.centreline(def, head, 1);
    const pe = RC.toScreen(end.x, end.y, end.z, cam, view);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = ok ? '#0d9488' : '#c62828';
    ctx.beginPath();
    ctx.arc(pe.x, pe.y, Math.max(3, 4.5 * cam.zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
})();
