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

  /* Half the track gauge, in METRES. Offsets are taken along the frame's
     right and up axes so banked track rolls properly. */
  const HG = 0.8;
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

  /* Offsets are taken in metre-space along a point's frame and converted back
     for projection, so the track foreshortens correctly and rolls with the
     bank. `side` is metres to the rider's right, `up` metres perpendicular to
     the track surface. */
  function off(p, fr, side, up, cam, view) {
    const mx = p.x * RC.TILE_M + fr.r.x * side + fr.u.x * up;
    const my = p.y * RC.TILE_M + fr.r.y * side + fr.u.y * up;
    const mz = p.z * RC.LEVEL_M + fr.r.z * side + fr.u.z * up;
    return RC.toScreen(mx / RC.TILE_M, my / RC.TILE_M, mz / RC.LEVEL_M, cam, view);
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
    const { a, b, fa, fb } = d;
    const z = cam.zoom;

    // Spine below the rails, which is what gives the track visual mass.
    const sa = off(a, fa, 0, -0.35, cam, view);
    const sb = off(b, fb, 0, -0.35, cam, view);
    line(ctx, sa, sb, SPINE_DARK, Math.max(2, 5.2 * z));
    line(ctx, sa, sb, SPINE, Math.max(1, 3.0 * z));

    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      const pa = off(a, fa, HG * s, 0, cam, view);
      const pb = off(b, fb, HG * s, 0, cam, view);
      line(ctx, pa, pb, RAIL_DARK, Math.max(1.8, 3.4 * z));
      line(ctx, pa, pb, RAIL_TOP, Math.max(0.8, 1.5 * z));
    }
    ctx.lineCap = 'butt';
  }

  function drawSleeper(ctx, d, cam, view) {
    const { p, fr, colour } = d;
    const z = cam.zoom;
    const l = off(p, fr, HG * 1.5, -0.3, cam, view);
    const r = off(p, fr, -HG * 1.5, -0.3, cam, view);
    line(ctx, l, r, colour, Math.max(1.5, 4.0 * z));
  }

  /* Chain dogs along a lift hill, so it reads as powered rather than just
     coloured differently. */
  function drawChain(ctx, d, cam, view) {
    const { p, fr } = d;
    const z = cam.zoom;
    const l = off(p, fr, HG * 0.35, -0.15, cam, view);
    const r = off(p, fr, -HG * 0.35, -0.15, cam, view);
    line(ctx, l, r, CHAIN, Math.max(1.2, 2.4 * z));
  }

  /* A support bent: two legs under the rails, cross-braced up its height.
     The legs meet the track wherever the (possibly banked) rails are, but
     drop vertically to the ground — supports don't lean with the track. */
  function drawBent(ctx, d, cam, view) {
    const { p, fr } = d;
    const z = cam.zoom;
    const legW = Math.max(1.5, 3.6 * z);

    const feet = [], tops = [], legX = [], legY = [];
    for (const s of [1, -1]) {
      const mx = p.x * RC.TILE_M + fr.r.x * HG * s + fr.u.x * -0.4;
      const my = p.y * RC.TILE_M + fr.r.y * HG * s + fr.u.y * -0.4;
      const mz = p.z * RC.LEVEL_M + fr.r.z * HG * s + fr.u.z * -0.4;
      const tx = mx / RC.TILE_M, ty = my / RC.TILE_M;
      legX.push(tx); legY.push(ty);
      tops.push(RC.toScreen(tx, ty, mz / RC.LEVEL_M, cam, view));
      feet.push(RC.toScreen(tx, ty, 0, cam, view));
    }

    // Cross-bracing first so the legs draw over it.
    const rungs = Math.max(1, Math.floor(p.z / BENT_RUNG_M));
    for (let r = 1; r <= rungs; r++) {
      const h = p.z * (r / (rungs + 1));
      const a = RC.toScreen(legX[0], legY[0], h, cam, view);
      const b = RC.toScreen(legX[1], legY[1], h, cam, view);
      line(ctx, a, b, BRACE, Math.max(1, 1.8 * z));
      // Alternating diagonal, giving the lattice its zig-zag.
      const hNext = p.z * ((r + 0.5) / (rungs + 1));
      const side = r % 2 ? 1 : 0;
      const c = RC.toScreen(legX[side], legY[side], hNext, cam, view);
      line(ctx, r % 2 ? a : b, c, BRACE, Math.max(0.8, 1.4 * z));
    }

    for (let s = 0; s < 2; s++) {
      line(ctx, tops[s], feet[s], POST_DARK, legW);
      line(ctx, tops[s], feet[s], POST, Math.max(0.8, legW * 0.45));
    }
  }

  /* Station platforms, one either side of the track. */
  function drawPlatform(ctx, d, cam, view) {
    const { a, b, fa, fb } = d;
    for (const s of [1, -1]) {
      const q = [
        off(a, fa, HG * 1.6 * s, -0.4, cam, view),
        off(a, fa, HG * 4.2 * s, -0.4, cam, view),
        off(b, fb, HG * 4.2 * s, -0.4, cam, view),
        off(b, fb, HG * 1.6 * s, -0.4, cam, view)
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

  /* Sorting each rail segment on its own breaks down where a car sits on the
     track: segments a little ahead of the car sort in front of it and paint
     over the body. Track a car is riding on is always underneath it, so those
     segments are pushed behind their car. Math.min means a segment is only
     ever moved earlier, never later, so nothing else's ordering is disturbed.

     Only segments within a car's own length are affected, so track genuinely
     crossing in front at a different point along the ride still occludes
     normally. */
  const CAR_COVER_M = 3.0;

  function coverSorter(cam) {
    // Wrecked: there is no train on the rails to pull the track's depth forward.
    if (RC.sim && RC.sim.blast) return null;
    const cars = (RC.sim && RC.carStates) ? RC.carStates() : [];
    if (!cars.length) return null;
    const closed = RC.isClosed();
    const depths = cars.map(c => RC.depth(c.x, c.y, c.z, cam.rot) + 0.4);
    return function (s, natural) {
      for (let n = 0; n < cars.length; n++) {
        if (RC.arcGap(s, cars[n].s, closed) < CAR_COVER_M) {
          return Math.min(natural, depths[n] - 0.01);
        }
      }
      return natural;
    };
  }

  RC.drawTrack = function (ctx, cam, view, extras) {
    const path = RC.trackPath();
    const pts = path.pts;
    const list = [];
    const cover = coverSorter(cam);

    if (pts.length > 1) {
      const frames = pts.map((_, n) => RC.frameAtPoint(pts, n));

      for (let n = 1; n < pts.length; n++) {
        const a = pts[n - 1], b = pts[n];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        let d = RC.depth(mid.x, mid.y, mid.z, cam.rot);
        if (cover) d = cover((a.s + b.s) / 2, d);
        list.push({
          depth: d, draw: drawRail,
          a, b, fa: frames[n - 1], fb: frames[n]
        });
        if (b.def.station) {
          list.push({
            depth: d - 0.5, draw: drawPlatform,
            a, b, fa: frames[n - 1], fb: frames[n]
          });
        }
      }

      // Evenly spaced sleepers, chain dogs and support bents.
      let nextSleeper = 0, nextSupport = 0;
      for (let n = 0; n < pts.length; n++) {
        const p = pts[n];
        if (p.s >= nextSleeper) {
          nextSleeper = p.s + SLEEPER_M;
          const base = RC.depth(p.x, p.y, p.z, cam.rot);
          let ds = base - 0.3;
          if (cover) ds = cover(p.s, ds);
          list.push({
            depth: ds,
            draw: drawSleeper, p, fr: frames[n],
            colour: sleeperColour(p.def, p.piece)
          });
          if (p.piece.lift) {
            let dc = base + 0.2;
            if (cover) dc = cover(p.s, dc);
            list.push({
              depth: dc,
              draw: drawChain, p, fr: frames[n]
            });
          }
        }
        if (p.s >= nextSupport && p.z > 0.8) {
          nextSupport = p.s + SUPPORT_M;
          // Sorted at the foot, so anything in front of the bent draws later.
          list.push({
            depth: RC.depth(p.x, p.y, 0, cam.rot),
            draw: drawBent, p, fr: frames[n]
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

  // Chunks the wreck breaks into: car colours plus dark metal and a spark or two.
  const DEBRIS_COLOURS = ['#cf3a2f', '#1f6fb2', '#2b3a45', '#c9702a', '#e0a53a'];

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

  /* A chunk of wreckage: a small box tumbling on the ground. */
  function drawDebris(ctx, d, cam, view) {
    const p = d.part, h = p.size;
    const S = (dx, dy, dz) => RC.toScreen(
      (p.x + dx) / RC.TILE_M, (p.y + dy) / RC.TILE_M, (p.z + dz) / RC.LEVEL_M, cam, view);
    const t0 = S(-h, -h, 2 * h), t1 = S(h, -h, 2 * h), t2 = S(h, h, 2 * h), t3 = S(-h, h, 2 * h);
    const b1 = S(h, -h, 0), b2 = S(h, h, 0), b3 = S(-h, h, 0);
    quad(ctx, [b1, b2, t2, t1], p.colour, null);
    quad(ctx, [b2, b3, t3, t2], p.colour, null);
    ctx.globalAlpha = 0.28;
    quad(ctx, [b1, b2, t2, t1], '#000', null);
    ctx.globalAlpha = 0.14;
    quad(ctx, [b2, b3, t3, t2], '#000', null);
    ctx.globalAlpha = 1;
    quad(ctx, [t0, t1, t2, t3], p.colour, CAR_EDGE);
  }

  RC.trainDrawables = function (cam) {
    const out = [];
    const sim = RC.sim;
    if (!sim) return out;

    // Wrecked: the scattered debris stands in for the train.
    if (sim.blast) {
      for (const part of sim.blast.parts) {
        out.push({
          depth: RC.depth(part.x / RC.TILE_M, part.y / RC.TILE_M, part.z / RC.LEVEL_M, cam.rot) + 0.5,
          draw: drawDebris, part
        });
      }
      return out;
    }

    if (RC.trackPath().pts.length < 2) return out;
    // Cars hanging off the end come back from carStates like any others, so
    // they need no special case here — they are simply drawn past the rails.
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

  /* Wreckage from ONE car breaking up: chunks thrown from where that car was,
     which then fall under gravity and settle. World METRES. Cars still high up
     when the front hit the ground shed their parts from up there, so the
     wreckage ends up strung along the fall rather than heaped in one place. */
  RC.makeDebris = function (c) {
    const parts = [];
    const spread = 2 + Math.min(8, (c.impact || 0) * 0.3);
    for (let n = 0; n < 8; n++) {
      const ang = Math.random() * Math.PI * 2;
      const horiz = spread * (0.4 + Math.random() * 0.8);
      parts.push({
        x: c.x + (Math.random() - 0.5) * 0.6,
        y: c.y + (Math.random() - 0.5) * 0.6,
        z: (c.z || 0) + 0.3 + Math.random() * 0.6,
        // Thrown outwards, and carried on in the direction the car was going.
        vx: Math.cos(ang) * horiz + c.fx * spread * 0.4,
        vy: Math.sin(ang) * horiz + c.fy * spread * 0.4,
        vz: 3 + Math.random() * 7,
        size: 0.25 + Math.random() * 0.5,
        colour: DEBRIS_COLOURS[(Math.random() * DEBRIS_COLOURS.length) | 0],
        rest: false
      });
    }
    return parts;
  };

  /* Advance the wreckage a frame. Returns true while anything is still moving,
     so the animation loop knows to keep drawing. */
  RC.stepBlast = function (dt) {
    const b = RC.sim && RC.sim.blast;
    if (!b) return false;
    let moving = false;
    for (const p of b.parts) {
      if (p.rest) continue;
      p.vz -= 9.81 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        if (Math.abs(p.vz) < 1.3) { p.vx *= 0.4; p.vy *= 0.4; p.vz = 0; p.rest = true; }
        else { p.vz = -p.vz * 0.4; p.vx *= 0.55; p.vy *= 0.55; }   // bounce
      }
      if (!p.rest) moving = true;
    }
    return moving;
  };

  /* ---- height labels ----------------------------------------------------
     One small tag per piece, at its midpoint, reading its height above the
     ground in metres. Drawn as a flat overlay on top of everything rather
     than in the depth-sorted list — they are annotations, so being occluded
     by the track they annotate would defeat the point. Near pieces are drawn
     last so their tags sit over far ones where the track doubles back. */
  RC.drawHeightLabels = function (ctx, cam, view) {
    const pieces = RC.track.pieces;
    if (!pieces.length) return;

    const tags = [];
    for (const p of pieces) {
      const def = RC.pieceDef(p.defId);
      const c = RC.centreline(def, p.node, 0.5);
      const m = c.z * RC.LEVEL_M;
      const s = RC.toScreen(c.x, c.y, c.z, cam, view);
      tags.push({ x: s.x, y: s.y, text: m.toFixed(0) + ' m', depth: RC.depth(c.x, c.y, c.z, cam.rot) });
    }
    tags.sort((a, b) => a.depth - b.depth);

    ctx.save();
    ctx.font = 'bold 11px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];   // suppress a repeated height stacked on its neighbour
    for (const t of tags) {
      const w = ctx.measureText(t.text).width + 8;
      const h = 15, r = 4;
      let clash = false;
      for (const q of placed) {
        if (q.text === t.text && Math.abs(q.x - t.x) < w && Math.abs(q.y - t.y) < h) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push({ x: t.x, y: t.y, text: t.text });
      const x = t.x - w / 2, y = t.y - h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = 'rgba(21, 48, 77, 0.85)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.text, t.x, t.y + 0.5);
    }
    ctx.restore();
  };

  /* ---- selecting an existing piece --------------------------------------
     Hit-test the TRACK, not the ground tile: elevated track projects well
     above the tile it sits over, so picking by the hovered ground tile would
     select empty ground under raised track. Instead find the path point whose
     projected position is nearest the click, and return its piece index. */
  RC.pickPiece = function (sx, sy, cam, view) {
    const pts = RC.trackPath().pts;
    if (pts.length < 2) return null;
    const threshold = 18;   // px
    let best = Infinity, bestPi = null;
    for (const p of pts) {
      const s = RC.toScreen(p.x, p.y, p.z, cam, view);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < best) { best = d; bestPi = p.pi; }
    }
    return best <= threshold ? bestPi : null;
  };

  /* Bright outline over the selected piece, drawn on top so it's always
     visible regardless of what stands in front of it. */
  RC.drawSelection = function (ctx, cam, view, pieceIndex) {
    if (pieceIndex == null) return;
    const pts = RC.trackPath().pts.filter(p => p.pi === pieceIndex);
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineWidth = Math.max(3, 6 * cam.zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 214, 74, 0.95)';
    ctx.beginPath();
    for (let n = 0; n < pts.length; n++) {
      const s = RC.toScreen(pts[n].x, pts[n].y, pts[n].z + 0.25, cam, view);
      if (n === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 80, 0, 0.6)';
    ctx.lineWidth = Math.max(1, 1.5 * cam.zoom);
    ctx.stroke();
    ctx.restore();
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
