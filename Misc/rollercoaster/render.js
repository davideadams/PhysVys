/* Track rendering. Everything drawable is collected into one list, sorted
   back-to-front by RC.depth, then drawn — so track that crosses over other
   track occludes it correctly. Phase 3 refines the artwork; the sorting
   structure here is the part that matters. */
(function () {
  const RC = window.RC || (window.RC = {});

  const RAIL = '#e8eef3';
  const RAIL_DARK = '#7d909f';
  const SLEEPER = '#6d4c33';
  const LIFT_SLEEPER = '#b8860b';
  const STATION_SLEEPER = '#5b6670';
  const BRAKE_SLEEPER = '#8c3b3b';
  const LAUNCH_SLEEPER = '#7a3f9d';
  const SUPPORT = '#8a949c';
  const SUPPORT_DARK = '#5d666d';

  /* Sample every piece's centreline into short segments. */
  RC.trackSegments = function () {
    const out = [];
    for (const p of RC.track.pieces) {
      const def = RC.pieceDef(p.defId);
      const n = def.kind === 'straight' ? 4 : 14;
      let prev = RC.centreline(def, p.node, 0);
      for (let s = 1; s <= n; s++) {
        const cur = RC.centreline(def, p.node, s / n);
        out.push({ a: prev, b: cur, piece: p, def, t: (s - 0.5) / n });
        prev = cur;
      }
    }
    return out;
  };

  function sleeperColour(def, piece) {
    if (piece && piece.lift) return LIFT_SLEEPER;
    if (def.station) return STATION_SLEEPER;
    if (def.brake) return BRAKE_SLEEPER;
    if (def.launch) return LAUNCH_SLEEPER;
    return SLEEPER;
  }

  /* Screen-space perpendicular to a segment, for offsetting the two rails. */
  function perp(pa, pb) {
    let dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
  }

  function drawSegment(ctx, item, cam, view) {
    const { a, b, def, piece } = item;
    const pa = RC.toScreen(a.x, a.y, a.z, cam, view);
    const pb = RC.toScreen(b.x, b.y, b.z, cam, view);
    const n = perp(pa, pb);
    const half = 3.2 * cam.zoom;

    // Sleeper first, so the rails sit on top of it.
    ctx.strokeStyle = sleeperColour(def, piece);
    ctx.lineWidth = Math.max(1, 4.5 * cam.zoom);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(pa.x + n.x * half * 1.35, pa.y + n.y * half * 1.35);
    ctx.lineTo(pa.x - n.x * half * 1.35, pa.y - n.y * half * 1.35);
    ctx.stroke();

    // Two rails.
    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      ctx.strokeStyle = RAIL_DARK;
      ctx.lineWidth = Math.max(1.6, 2.6 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(pa.x + n.x * half * s, pa.y + n.y * half * s);
      ctx.lineTo(pb.x + n.x * half * s, pb.y + n.y * half * s);
      ctx.stroke();

      ctx.strokeStyle = RAIL;
      ctx.lineWidth = Math.max(0.8, 1.3 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(pa.x + n.x * half * s, pa.y + n.y * half * s);
      ctx.lineTo(pb.x + n.x * half * s, pb.y + n.y * half * s);
      ctx.stroke();
    }
  }

  function drawSupport(ctx, item, cam, view) {
    const p = item.p;
    const top = RC.toScreen(p.x, p.y, p.z, cam, view);
    const foot = RC.toScreen(p.x, p.y, 0, cam, view);
    ctx.strokeStyle = SUPPORT_DARK;
    ctx.lineWidth = Math.max(1.5, 3.4 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
    ctx.strokeStyle = SUPPORT;
    ctx.lineWidth = Math.max(0.8, 1.6 * cam.zoom);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
  }

  /* Support struts every few sample points, wherever the track is off the
     ground. Drawn as part of the same sorted list so they occlude properly. */
  function collectSupports(segments) {
    const out = [];
    const seen = new Set();
    for (const s of segments) {
      const p = s.a;
      if (p.z < 0.6) continue;
      const key = Math.round(p.x * 2) + ',' + Math.round(p.y * 2);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'support', p });
    }
    return out;
  }

  RC.drawTrack = function (ctx, cam, view, extras) {
    const segs = RC.trackSegments();
    const list = [];

    for (const s of segs) {
      const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2, mz = (s.a.z + s.b.z) / 2;
      list.push({ type: 'seg', item: s, depth: RC.depth(mx, my, mz, cam.rot) });
    }
    for (const sp of collectSupports(segs)) {
      // Supports sort at their foot, so track above them draws later.
      list.push({ type: 'support', item: sp, depth: RC.depth(sp.p.x, sp.p.y, 0, cam.rot) });
    }
    for (const e of (extras || [])) {
      list.push(e);
    }

    list.sort((p, q) => p.depth - q.depth);

    for (const d of list) {
      if (d.type === 'seg') drawSegment(ctx, d.item, cam, view);
      else if (d.type === 'support') drawSupport(ctx, d.item, cam, view);
      else if (d.draw) d.draw(ctx, cam, view);
    }
  };

  /* ---- build head and ghost preview ----------------------------------- */

  /* An arrow on the ground plane showing where the next piece leaves from
     and which way it points. */
  RC.drawHead = function (ctx, cam, view, head) {
    if (!head) return;
    const E = RC.entryPoint(head);
    const d = RC.DIRS[head.dir];
    const tip = RC.toScreen(E.x + d[0] * 0.55, E.y + d[1] * 0.55, head.k, cam, view);
    const base = RC.toScreen(E.x, E.y, head.k, cam, view);
    const perpD = [-d[1], d[0]];
    const l = RC.toScreen(E.x + perpD[0] * 0.28, E.y + perpD[1] * 0.28, head.k, cam, view);
    const r = RC.toScreen(E.x - perpD[0] * 0.28, E.y - perpD[1] * 0.28, head.k, cam, view);

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

  /* Translucent preview of the piece currently selected in the palette. */
  RC.drawGhost = function (ctx, cam, view, def, head, ok) {
    if (!def || !head) return;
    const n = def.kind === 'straight' ? 6 : 18;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = ok ? '#0d9488' : '#c62828';
    ctx.lineWidth = Math.max(2.5, 5 * cam.zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let s = 0; s <= n; s++) {
      const c = RC.centreline(def, head, s / n);
      const p = RC.toScreen(c.x, c.y, c.z, cam, view);
      if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Mark where the head would end up.
    const end = RC.centreline(def, head, 1);
    const pe = RC.toScreen(end.x, end.y, end.z, cam, view);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ok ? '#0d9488' : '#c62828';
    ctx.beginPath();
    ctx.arc(pe.x, pe.y, Math.max(3, 4.5 * cam.zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
})();
