/* Isometric world: projection, camera, ground rendering.
   Plain script (no ES modules) so the page works from file:// as well as a server. */
(function () {
  const RC = window.RC || (window.RC = {});

  const GRID = 40;      // tiles per side (160 m square)
  const TILE_M = 4;     // metres per tile
  const LEVEL_M = 1;    // metres per height level
  const TW = 64;        // tile width in px at zoom 1
  const TH = 32;        // tile height in px at zoom 1 (2:1 isometric)
  const LEVEL_PX = 10;  // px per height level at zoom 1
  const SLAB = 20;      // px thickness of the ground slab's dirt sides

  Object.assign(RC, { GRID, TILE_M, LEVEL_M, TW, TH, LEVEL_PX, SLAB });

  RC.camera = { zoom: 1, panX: 0, panY: 0, rot: 0 };

  /* ---- rotation -------------------------------------------------------
     The world is stored in fixed (i, j) tile coordinates. The camera's
     rotation is applied by swizzling into "view" coordinates (a, b) just
     before projection, so nothing about the track model ever rotates.

     These act on CONTINUOUS coordinates: tile i spans [i, i+1], and its
     mirror image spans [N-i-1, N-i], hence N-i rather than N-1-i. The
     integer tile-index form is RC.rotTile below. */
  RC.rot = function (i, j, rot) {
    const N = GRID;
    switch (rot & 3) {
      case 1:  return [j, N - i];
      case 2:  return [N - i, N - j];
      case 3:  return [N - j, i];
      default: return [i, j];
    }
  };

  RC.unrot = function (a, b, rot) {
    const N = GRID;
    switch (rot & 3) {
      case 1:  return [N - b, a];
      case 2:  return [N - a, N - b];
      case 3:  return [b, N - a];
      default: return [a, b];
    }
  };

  RC.rotTile = function (i, j, rot) {
    const N = GRID;
    switch (rot & 3) {
      case 1:  return [j, N - 1 - i];
      case 2:  return [N - 1 - i, N - 1 - j];
      case 3:  return [N - 1 - j, i];
      default: return [i, j];
    }
  };

  /* ---- projection -----------------------------------------------------
     World-pixel space: origin at the centre of the ground slab, +x right,
     +y down, height k rising up the screen. Pan/zoom are applied on top by
     the caller (or by RC.toScreen). */
  RC.projView = function (a, b, k) {
    return {
      x: (a - b) * TW / 2,
      y: (a + b - GRID) * TH / 2 - k * LEVEL_PX
    };
  };

  RC.projWorld = function (i, j, k, rot) {
    const [a, b] = RC.rot(i, j, rot);
    return RC.projView(a, b, k);
  };

  /* Full world -> screen, including camera. `view` is {w, h}. */
  RC.toScreen = function (i, j, k, cam, view) {
    const p = RC.projWorld(i, j, k, cam.rot);
    return {
      x: p.x * cam.zoom + cam.panX + view.w / 2,
      y: p.y * cam.zoom + cam.panY + view.h / 2
    };
  };

  /* Screen -> world tile coordinates on the ground plane (k = 0).
     Returns continuous (i, j); floor them for a tile index. */
  RC.screenToWorld = function (sx, sy, cam, view) {
    const u = (sx - view.w / 2 - cam.panX) / cam.zoom;
    const v = (sy - view.h / 2 - cam.panY) / cam.zoom;
    const ab = 2 * v / TH + GRID;   // a + b
    const dab = 2 * u / TW;         // a - b
    const a = (ab + dab) / 2;
    const b = (ab - dab) / 2;
    return RC.unrot(a, b, cam.rot);
  };

  RC.inBounds = function (i, j) {
    return i >= 0 && j >= 0 && i < GRID && j < GRID;
  };

  /* Painter's-algorithm sort key. Larger = drawn later = nearer the viewer.
     Ties on (a + b) are broken by height so a support drawn at the same
     tile sits behind the track above it. */
  RC.depth = function (i, j, k, rot) {
    const [a, b] = RC.rot(i, j, rot);
    return (a + b) * 100 + k;
  };

  /* ---- ground ---------------------------------------------------------
     Only the tiles actually on screen are drawn, and they are batched into a
     handful of Path2Ds so the cost is ~4 draw calls regardless of how many
     tiles that is.

     This replaced a whole-map offscreen cache. The cache was fine at a 20x20
     park but its memory grows as (GRID * scale)^2, and at 40x40 it would have
     wanted ~333 MB at maximum zoom on a dpr-2 display. Culling to the viewport
     is bounded by screen size instead of park size, stays crisp at every zoom,
     and removes the cache-invalidation problem entirely. */
  const GRASS_A = '#4f9c3d';
  const GRASS_B = '#57a844';
  const GRASS_EDGE = 'rgba(20, 60, 20, 0.10)';
  const TUFT = 'rgba(32, 84, 30, 0.34)';
  const DIRT_LIGHT = '#8a6a3f';
  const DIRT_DARK = '#6b5231';

  /* Deterministic per-tile pseudo-random, so grass tufts stay put. */
  function hash2(i, j) {
    let h = (i * 374761393 + j * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* Project already-rotated view coordinates straight to screen. Saves
     rotating all four corners of every tile. */
  RC.viewToScreen = function (a, b, k, cam, view) {
    const p = RC.projView(a, b, k);
    return {
      x: p.x * cam.zoom + cam.panX + view.w / 2,
      y: p.y * cam.zoom + cam.panY + view.h / 2
    };
  };

  /* Inverse of RC.rotTile: view tile index -> world tile index. */
  RC.unrotTile = function (ra, rb, rot) {
    const M = GRID - 1;
    switch (rot & 3) {
      case 1:  return [M - rb, ra];
      case 2:  return [M - ra, M - rb];
      case 3:  return [rb, M - ra];
      default: return [ra, rb];
    }
  };

  /* Range of view tiles touching the screen. The visible region is a rotated
     rectangle in tile space, so its bounding box is a superset — a couple of
     extra rows is much cheaper than getting the geometry exactly right. */
  function visibleRange(cam, view) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    const corners = [[0, 0], [view.w, 0], [0, view.h], [view.w, view.h]];
    for (const [sx, sy] of corners) {
      const u = (sx - view.w / 2 - cam.panX) / cam.zoom;
      const v = (sy - view.h / 2 - cam.panY) / cam.zoom;
      const ab = 2 * v / TH + GRID;
      const dab = 2 * u / TW;
      const a = (ab + dab) / 2, b = (ab - dab) / 2;
      if (a < aMin) aMin = a;
      if (a > aMax) aMax = a;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
    }
    return {
      a0: Math.max(0, Math.floor(aMin) - 2),
      a1: Math.min(GRID - 1, Math.ceil(aMax) + 2),
      b0: Math.max(0, Math.floor(bMin) - 2),
      b1: Math.min(GRID - 1, Math.ceil(bMax) + 2)
    };
  }

  RC.drawGround = function (ctx, cam, view) {
    const r = visibleRange(cam, view);
    if (r.a1 < r.a0 || r.b1 < r.b0) return;   // park entirely off screen

    const P = (a, b) => RC.viewToScreen(a, b, 0, cam, view);
    const checkerA = new Path2D();
    const checkerB = new Path2D();
    const faceLight = new Path2D();
    const faceDark = new Path2D();
    const tufts = new Path2D();

    const showTufts = cam.zoom >= 0.6;   // sub-pixel below this
    const tuftSize = Math.max(1, 1.6 * cam.zoom);
    const drop = SLAB * cam.zoom;

    for (let ra = r.a0; ra <= r.a1; ra++) {
      for (let rb = r.b0; rb <= r.b1; rb++) {
        const c0 = P(ra, rb), c1 = P(ra + 1, rb);
        const c2 = P(ra + 1, rb + 1), c3 = P(ra, rb + 1);

        const [i, j] = RC.unrotTile(ra, rb, cam.rot);
        const path = ((i + j) & 1) ? checkerA : checkerB;
        path.moveTo(c0.x, c0.y);
        path.lineTo(c1.x, c1.y);
        path.lineTo(c2.x, c2.y);
        path.lineTo(c3.x, c3.y);
        path.closePath();

        if (showTufts) {
          const n = 2 + Math.floor(hash2(i, j) * 3);
          for (let t = 0; t < n; t++) {
            const fa = 0.18 + hash2(i * 31 + t, j) * 0.64;
            const fb = 0.18 + hash2(i, j * 31 + t) * 0.64;
            const p = P(ra + fa, rb + fb);
            tufts.rect(p.x - tuftSize / 2, p.y - tuftSize / 2, tuftSize, tuftSize * 0.8);
          }
        }

        // The +a and +b edges of the outermost view tiles face the camera,
        // giving the park its slab of earth.
        if (ra === GRID - 1) {
          faceLight.moveTo(c1.x, c1.y);
          faceLight.lineTo(c2.x, c2.y);
          faceLight.lineTo(c2.x, c2.y + drop);
          faceLight.lineTo(c1.x, c1.y + drop);
          faceLight.closePath();
        }
        if (rb === GRID - 1) {
          faceDark.moveTo(c3.x, c3.y);
          faceDark.lineTo(c2.x, c2.y);
          faceDark.lineTo(c2.x, c2.y + drop);
          faceDark.lineTo(c3.x, c3.y + drop);
          faceDark.closePath();
        }
      }
    }

    ctx.fillStyle = GRASS_A;
    ctx.fill(checkerA);
    ctx.fillStyle = GRASS_B;
    ctx.fill(checkerB);

    ctx.strokeStyle = GRASS_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke(checkerA);
    ctx.stroke(checkerB);

    if (showTufts) {
      ctx.fillStyle = TUFT;
      ctx.fill(tufts);
    }

    ctx.fillStyle = DIRT_LIGHT;
    ctx.fill(faceLight);
    ctx.fillStyle = DIRT_DARK;
    ctx.fill(faceDark);
  };

  /* ---- sky ------------------------------------------------------------ */
  const CLOUDS = [
    { x: -0.30, y: 0.10, r: 46, n: 4 },
    { x: 0.22, y: 0.05, r: 34, n: 3 },
    { x: 0.44, y: 0.24, r: 26, n: 3 },
    { x: -0.05, y: 0.30, r: 20, n: 3 }
  ];

  RC.drawSky = function (ctx, cam, view) {
    const sky = ctx.createLinearGradient(0, 0, 0, view.h);
    sky.addColorStop(0, '#63bde8');
    sky.addColorStop(0.55, '#8fd0ef');
    sky.addColorStop(1, '#c8e9f8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, view.h);

    // Clouds drift with the pan a little, for a sense of depth.
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    for (const c of CLOUDS) {
      const cx = view.w * (0.5 + c.x) + cam.panX * 0.12;
      const cy = view.h * c.y + cam.panY * 0.06;
      for (let n = 0; n < c.n; n++) {
        const dx = (n - (c.n - 1) / 2) * c.r * 0.72;
        const rr = c.r * (n === Math.floor(c.n / 2) ? 1 : 0.72);
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy, rr, rr * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  /* ---- compass --------------------------------------------------------- */
  RC.drawCompass = function (ctx, cam, view) {
    const cx = view.w - 46, cy = 46, r = 24;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.strokeStyle = 'rgba(21,48,77,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // World +i is "north"; find where it points on screen under this rotation.
    const o = RC.projWorld(0, 0, 0, cam.rot);
    const n = RC.projWorld(1, 0, 0, cam.rot);
    let dx = n.x - o.x, dy = n.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    ctx.beginPath();
    ctx.moveTo(cx + dx * r * 0.66, cy + dy * r * 0.66);
    ctx.lineTo(cx - dy * r * 0.26 - dx * r * 0.2, cy + dx * r * 0.26 - dy * r * 0.2);
    ctx.lineTo(cx + dy * r * 0.26 - dx * r * 0.2, cy - dx * r * 0.26 - dy * r * 0.2);
    ctx.closePath();
    ctx.fillStyle = '#c2185b';
    ctx.fill();

    ctx.fillStyle = '#15304d';
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx + dx * r * 0.88, cy + dy * r * 0.88);
    ctx.restore();
  };
})();
