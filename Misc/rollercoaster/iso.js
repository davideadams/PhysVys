/* Isometric world: projection, camera, ground rendering.
   Plain script (no ES modules) so the page works from file:// as well as a server. */
(function () {
  const RC = window.RC || (window.RC = {});

  const GRID = 20;      // tiles per side
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
     The ground never changes, so it is rendered once into an offscreen
     canvas and blitted. The cache is keyed on rotation and zoom; panning
     just moves the blit. */
  const GRASS_A = '#4f9c3d';
  const GRASS_B = '#57a844';
  const GRASS_EDGE = 'rgba(20, 60, 20, 0.10)';
  const TUFT = 'rgba(32, 84, 30, 0.34)';
  const DIRT_LIGHT = '#8a6a3f';
  const DIRT_DARK = '#6b5231';
  const DIRT_TOP = '#7a5c37';

  let groundCache = null;
  let groundKey = '';

  /* Deterministic per-tile pseudo-random, so grass tufts don't crawl
     around when the cache is rebuilt. */
  function hash2(i, j) {
    let h = (i * 374761393 + j * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* Built at zoom * devicePixelRatio so the grass stays crisp on HiDPI
     displays; drawGround scales the blit back down by dpr. */
  function buildGround(z, rot) {
    const pad = 4;
    const w = Math.ceil(GRID * TW * z) + pad * 2;
    const h = Math.ceil(GRID * TH * z + SLAB * z) + pad * 2;
    const ox = w / 2;                       // where world x = 0 lands
    const oy = GRID * TH * z / 2 + pad;     // where world y = 0 lands

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');

    const P = (a, b, k) => {
      const p = RC.projView(a, b, k);
      return { x: p.x * z + ox, y: p.y * z + oy };
    };

    // Tiles are emitted in view-space order so the perimeter dirt faces of
    // near tiles paint over the far ones.
    const tiles = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const [ra, rb] = RC.rotTile(i, j, rot);
        tiles.push({ i, j, ra, rb });
      }
    }
    tiles.sort((p, q) => (p.ra + p.rb) - (q.ra + q.rb));

    for (const t of tiles) {
      const { i, j, ra, rb } = t;
      const c0 = P(ra, rb, 0);
      const c1 = P(ra + 1, rb, 0);
      const c2 = P(ra + 1, rb + 1, 0);
      const c3 = P(ra, rb + 1, 0);

      g.beginPath();
      g.moveTo(c0.x, c0.y);
      g.lineTo(c1.x, c1.y);
      g.lineTo(c2.x, c2.y);
      g.lineTo(c3.x, c3.y);
      g.closePath();
      g.fillStyle = ((i + j) & 1) ? GRASS_A : GRASS_B;
      g.fill();
      g.strokeStyle = GRASS_EDGE;
      g.lineWidth = 1;
      g.stroke();

      // A few tufts so the grass doesn't read as flat colour.
      const n = 2 + Math.floor(hash2(i, j) * 3);
      g.fillStyle = TUFT;
      for (let t2 = 0; t2 < n; t2++) {
        const fa = 0.18 + hash2(i * 31 + t2, j) * 0.64;
        const fb = 0.18 + hash2(i, j * 31 + t2) * 0.64;
        const p = P(ra + fa, rb + fb, 0);
        const s = Math.max(1, 1.6 * z);
        g.fillRect(p.x - s / 2, p.y - s / 2, s, s * 0.8);
      }

      // Perimeter slab faces: the +a and +b edges of the outermost tiles
      // in view space are the ones facing the camera.
      const drop = SLAB * z;
      if (ra === GRID - 1) {
        const a0 = P(ra + 1, rb, 0), a1 = P(ra + 1, rb + 1, 0);
        g.beginPath();
        g.moveTo(a0.x, a0.y);
        g.lineTo(a1.x, a1.y);
        g.lineTo(a1.x, a1.y + drop);
        g.lineTo(a0.x, a0.y + drop);
        g.closePath();
        g.fillStyle = DIRT_LIGHT;
        g.fill();
      }
      if (rb === GRID - 1) {
        const b0 = P(ra, rb + 1, 0), b1 = P(ra + 1, rb + 1, 0);
        g.beginPath();
        g.moveTo(b0.x, b0.y);
        g.lineTo(b1.x, b1.y);
        g.lineTo(b1.x, b1.y + drop);
        g.lineTo(b0.x, b0.y + drop);
        g.closePath();
        g.fillStyle = DIRT_DARK;
        g.fill();
      }
      if (ra === GRID - 1 && rb === GRID - 1) {
        // Bottom corner cap, so the two faces meet cleanly.
        const c = P(ra + 1, rb + 1, 0);
        g.fillStyle = DIRT_TOP;
        g.fillRect(c.x - 1, c.y, 2, drop);
      }
    }

    groundCache = cv;
    return { cv, ox, oy };
  }

  let cacheOx = 0, cacheOy = 0, cacheScale = 1;

  /* The cache covers the whole map, so its cost grows as scale^2: at zoom 2.5
     on a dpr-2 display an uncapped cache would be ~6400x3300 (84 MB). Cap the
     render scale and let the blit upscale past it — mild softening at extreme
     zoom in exchange for bounded memory. */
  const CACHE_SCALE_MAX = 2.5;

  RC.drawGround = function (ctx, cam, view) {
    const dpr = view.dpr || 1;
    const scale = Math.min(cam.zoom * dpr, CACHE_SCALE_MAX);
    const key = cam.rot + '|' + scale.toFixed(3);
    if (key !== groundKey) {
      const built = buildGround(scale, cam.rot);
      cacheOx = built.ox;
      cacheOy = built.oy;
      cacheScale = scale;
      groundKey = key;
    }
    // The cache holds (world px * cacheScale); the screen wants (world px *
    // zoom) in CSS px, the context handling dpr on top. So convert by k.
    const k = cam.zoom / cacheScale;
    ctx.drawImage(
      groundCache,
      view.w / 2 + cam.panX - cacheOx * k,
      view.h / 2 + cam.panY - cacheOy * k,
      groundCache.width * k,
      groundCache.height * k
    );
  };

  RC.invalidateGround = function () { groundKey = ''; };

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

  /* ---- tile highlight -------------------------------------------------- */
  RC.strokeTile = function (ctx, i, j, k, cam, view, style, width, fill) {
    const c0 = RC.toScreen(i, j, k, cam, view);
    const c1 = RC.toScreen(i + 1, j, k, cam, view);
    const c2 = RC.toScreen(i + 1, j + 1, k, cam, view);
    const c3 = RC.toScreen(i, j + 1, k, cam, view);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.lineTo(c3.x, c3.y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (style) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width || 2;
      ctx.stroke();
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
