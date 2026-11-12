// Organic Molecule Builder -- 3D coordinates for the ball-and-stick view.
// Starts from the 2D drawing, adds the hydrogens, then relaxes the structure
// by repeatedly correcting bond lengths, bond angles (as 1-3 distances),
// cis/trans arrangement across double bonds (as 1-4 distances, taken from
// the drawing), and clashes between atoms that are not bonded.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const RADIUS = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Cl: 1.02, Br: 1.20, I: 1.39 };
  const ORDER_SCALE = { 1: 1, 2: 0.87, 3: 0.78 };

  function bondLength(e1, e2, order) {
    return (RADIUS[e1] + RADIUS[e2]) * ORDER_SCALE[order];
  }

  OB.build3D = function (g) {
    const atoms = [];   // { el, x, y, z, heavy: index or -1 }
    const bonds = [];   // { a, b, order }
    const scale = 1.5 / OB.BOND_LENGTH;
    const rnd = () => (Math.random() - 0.5) * 0.6;
    for (let i = 0; i < g.n; i++) {
      atoms.push({ el: g.el[i], x: g.x[i] * scale, y: -g.y[i] * scale, z: rnd(), heavy: i });
    }
    g.bonds.forEach(b => bonds.push({ a: b.a, b: b.b, order: b.order }));
    for (let i = 0; i < g.n; i++) {
      const hs = Math.max(0, g.h[i]);
      let dx = 0, dy = 0;
      g.adj[i].forEach(e => {
        const vx = atoms[e.to].x - atoms[i].x, vy = atoms[e.to].y - atoms[i].y;
        const l = Math.hypot(vx, vy) || 1;
        dx -= vx / l; dy -= vy / l;
      });
      for (let k = 0; k < hs; k++) {
        const ang = Math.atan2(dy, dx) + (k - (hs - 1) / 2) * 1.2 + rnd();
        const idx = atoms.length;
        atoms.push({ el: 'H', x: atoms[i].x + Math.cos(ang), y: atoms[i].y + Math.sin(ang), z: atoms[i].z + rnd() * 2, heavy: -1 });
        bonds.push({ a: i, b: idx, order: 1 });
      }
    }

    const n = atoms.length;
    const adj = Array.from({ length: n }, () => []);
    bonds.forEach(b => { adj[b.a].push({ to: b.b, order: b.order }); adj[b.b].push({ to: b.a, order: b.order }); });

    const cons = [];   // distance constraints { i, j, d, w }
    const linked = new Set();
    const key = (i, j) => i < j ? i + ',' + j : j + ',' + i;
    bonds.forEach(b => {
      cons.push({ i: b.a, j: b.b, d: bondLength(atoms[b.a].el, atoms[b.b].el, b.order), w: 1 });
      linked.add(key(b.a, b.b));
    });

    function idealAngle(c) {
      const nb = adj[c];
      if (nb.some(e => e.order === 3) || nb.filter(e => e.order === 2).length === 2) return 180;
      if (nb.some(e => e.order === 2)) return 120;
      if (atoms[c].el === 'O') return 104.5;
      if (atoms[c].el === 'N') return 107;
      return 109.5;
    }
    const lenOf = (i, j) => {
      const e = adj[i].find(x => x.to === j);
      return bondLength(atoms[i].el, atoms[j].el, e.order);
    };
    for (let c = 0; c < n; c++) {
      const th = idealAngle(c) * Math.PI / 180;
      const nb = adj[c];
      for (let p = 0; p < nb.length; p++) for (let q = p + 1; q < nb.length; q++) {
        const i = nb[p].to, j = nb[q].to;
        const a = lenOf(c, i), b = lenOf(c, j);
        cons.push({ i, j, d: Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(th)), w: 0.8 });
        linked.add(key(i, j));
      }
    }

    // Double bonds: keep the cis/trans arrangement the user drew.
    bonds.forEach(bd => {
      if (bd.order !== 2) return;
      const A = bd.a, B = bd.b;
      const subsA = adj[A].filter(e => e.to !== B).map(e => e.to);
      const subsB = adj[B].filter(e => e.to !== A).map(e => e.to);
      if (!subsA.length || !subsB.length) return;
      const L = lenOf(A, B);
      const ax = atoms[B].x - atoms[A].x, ay = atoms[B].y - atoms[A].y;
      const side = p => Math.sign(ax * (atoms[p].y - atoms[A].y) - ay * (atoms[p].x - atoms[A].x));
      subsA.forEach(x => subsB.forEach(y => {
        const r1 = lenOf(A, x), r2 = lenOf(B, y);
        const cis = side(x) === side(y) && side(x) !== 0;
        const px = -r1 * 0.5, py = r1 * Math.sqrt(3) / 2;
        const qx = L + r2 * 0.5, qy = (cis ? 1 : -1) * r2 * Math.sqrt(3) / 2;
        cons.push({ i: x, j: y, d: Math.hypot(qx - px, qy - py), w: 0.6 });
        linked.add(key(x, y));
      }));
    });

    for (let it = 0; it < 700; it++) {
      cons.forEach(c => {
        const A = atoms[c.i], B = atoms[c.j];
        let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) { dx = 1e-3; d = 1e-3; }
        const k = c.w * 0.5 * (d - c.d) / d;
        A.x += dx * k; A.y += dy * k; A.z += dz * k;
        B.x -= dx * k; B.y -= dy * k; B.z -= dz * k;
      });
      if (it % 4 === 0) {
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          if (linked.has(key(i, j))) continue;
          const A = atoms[i], B = atoms[j];
          const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
          const min = (A.el === 'H' || B.el === 'H') ? 2.3 : 2.9;
          if (d < min) {
            const k = 0.1 * (d - min) / d;
            A.x += dx * k; A.y += dy * k; A.z += dz * k;
            B.x -= dx * k; B.y -= dy * k; B.z -= dz * k;
          }
        }
      }
    }

    const cx = atoms.reduce((s, a) => s + a.x, 0) / n;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / n;
    const cz = atoms.reduce((s, a) => s + a.z, 0) / n;
    atoms.forEach(a => { a.x -= cx; a.y -= cy; a.z -= cz; });
    return { atoms, bonds, adj };
  };
})();
