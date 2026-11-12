// Organic Molecule Builder -- molecule model.
// A molecule is heavy atoms plus bonds; hydrogens are implicit and fill each
// atom up to its usual valence. Everything here is DOM-free so test.html can
// load it on its own. Exposed on window.OB.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const VALENCE = { C: 4, N: 3, O: 2, F: 1, Cl: 1, Br: 1, I: 1 };
  OB.VALENCE = VALENCE;
  OB.ELEMENTS = ['C', 'N', 'O', 'F', 'Cl', 'Br', 'I'];
  OB.HALOGENS = { F: 'fluoro', Cl: 'chloro', Br: 'bromo', I: 'iodo' };
  OB.BOND_LENGTH = 52;

  class Molecule {
    constructor() {
      this.atoms = [];
      this.bonds = [];
      this.nextId = 1;
    }

    clone() {
      const m = new Molecule();
      m.atoms = this.atoms.map(a => ({ ...a }));
      m.bonds = this.bonds.map(b => ({ ...b }));
      m.nextId = this.nextId;
      return m;
    }

    isEmpty() { return this.atoms.length === 0; }
    atom(id) { return this.atoms.find(a => a.id === id) || null; }

    addAtom(el, x, y) {
      const a = { id: this.nextId++, el, x, y };
      this.atoms.push(a);
      return a;
    }

    removeAtom(id) {
      this.atoms = this.atoms.filter(a => a.id !== id);
      this.bonds = this.bonds.filter(b => b.a !== id && b.b !== id);
    }

    bondBetween(a, b) {
      return this.bonds.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)) || null;
    }

    bondsOf(id) { return this.bonds.filter(b => b.a === id || b.b === id); }
    usedValence(id) { return this.bondsOf(id).reduce((s, b) => s + b.order, 0); }

    // Bonding capacity still free on an atom; this is also its hydrogen count.
    freeValence(id) {
      const a = this.atom(id);
      return a ? VALENCE[a.el] - this.usedValence(id) : 0;
    }
    hCount(id) { return Math.max(0, this.freeValence(id)); }

    addBond(a, b, order = 1) {
      if (a === b || this.bondBetween(a, b)) return null;
      if (this.freeValence(a) < order || this.freeValence(b) < order) return null;
      const bond = { a, b, order };
      this.bonds.push(bond);
      return bond;
    }

    canSetOrder(bond, order) {
      const delta = order - bond.order;
      return delta <= 0 || (this.freeValence(bond.a) >= delta && this.freeValence(bond.b) >= delta);
    }

    removeBond(bond) { this.bonds = this.bonds.filter(b => b !== bond); }
    canSetElement(id, el) { return this.usedValence(id) <= VALENCE[el]; }

    toJSON() { return { atoms: this.atoms, bonds: this.bonds }; }

    static fromJSON(data) {
      const m = new Molecule();
      m.atoms = data.atoms.map(a => ({ ...a }));
      m.bonds = data.bonds.map(b => ({ ...b }));
      m.nextId = m.atoms.reduce((mx, a) => Math.max(mx, a.id), 0) + 1;
      return m;
    }
  }
  OB.Molecule = Molecule;

  // Index-based view of a molecule for the analysis code. Atoms are 0..n-1;
  // g.ids maps back to editor atom ids. g.h may go negative for an
  // over-bonded atom, which the naming code reports as an invalid structure.
  OB.toGraph = function (mol) {
    const index = new Map();
    mol.atoms.forEach((a, i) => index.set(a.id, i));
    const n = mol.atoms.length;
    const g = {
      n,
      el: mol.atoms.map(a => a.el),
      ids: mol.atoms.map(a => a.id),
      x: mol.atoms.map(a => a.x),
      y: mol.atoms.map(a => a.y),
      adj: Array.from({ length: n }, () => []),
      bonds: [],
    };
    mol.bonds.forEach(b => {
      const i = index.get(b.a), j = index.get(b.b);
      if (i === undefined || j === undefined) return;
      g.bonds.push({ a: i, b: j, order: b.order });
      g.adj[i].push({ to: j, order: b.order });
      g.adj[j].push({ to: i, order: b.order });
    });
    g.h = g.el.map((e, i) => VALENCE[e] - g.adj[i].reduce((s, x) => s + x.order, 0));
    return g;
  };

  OB.bondOrder = function (g, a, b) {
    const e = g.adj[a].find(x => x.to === b);
    return e ? e.order : 0;
  };

  OB.components = function (g) {
    const seen = new Array(g.n).fill(false);
    const comps = [];
    for (let s = 0; s < g.n; s++) {
      if (seen[s]) continue;
      const comp = [];
      const stack = [s];
      seen[s] = true;
      while (stack.length) {
        const a = stack.pop();
        comp.push(a);
        g.adj[a].forEach(e => { if (!seen[e.to]) { seen[e.to] = true; stack.push(e.to); } });
      }
      comps.push(comp);
    }
    return comps;
  };

  OB.hasRing = function (g) {
    return g.bonds.length > g.n - OB.components(g).length;
  };

  // Atoms in a ring: those left after repeatedly stripping atoms of degree <= 1.
  OB.ringAtoms = function (g) {
    const deg = g.adj.map(a => a.length);
    const gone = new Array(g.n).fill(false);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < g.n; i++) {
        if (!gone[i] && deg[i] <= 1) {
          gone[i] = true;
          changed = true;
          g.adj[i].forEach(e => { if (!gone[e.to]) deg[e.to]--; });
        }
      }
    }
    const out = [];
    for (let i = 0; i < g.n; i++) if (!gone[i]) out.push(i);
    return out;
  };

  OB.elementCounts = function (g) {
    const counts = {};
    let h = 0;
    for (let i = 0; i < g.n; i++) {
      counts[g.el[i]] = (counts[g.el[i]] || 0) + 1;
      h += Math.max(0, g.h[i]);
    }
    if (h) counts.H = h;
    return counts;
  };

  // Canonical description of the branch reached from `from` into `a`, used to
  // tell whether two groups on the same atom are identical. Acyclic only.
  OB.branchKey = function (g, a, from, memo) {
    memo = memo || new Map();
    const key = a + ',' + from;
    if (memo.has(key)) return memo.get(key);
    const kids = g.adj[a]
      .filter(e => e.to !== from)
      .map(e => e.order + OB.branchKey(g, e.to, a, memo))
      .sort();
    const s = g.el[a] + 'H' + Math.max(0, g.h[a]) + '(' + kids.join(',') + ')';
    memo.set(key, s);
    return s;
  };

  // ---- SMILES reader (organic subset, used for presets and tests) ----
  OB.parseSmiles = function (s) {
    const mol = new Molecule();
    let prev = null;
    let order = 1;
    const stack = [];
    const rings = {};
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '(') { stack.push(prev); i++; continue; }
      if (c === ')') { prev = stack.pop(); i++; continue; }
      if (c === '-') { order = 1; i++; continue; }
      if (c === '=') { order = 2; i++; continue; }
      if (c === '#') { order = 3; i++; continue; }
      if (c === '.') { prev = null; i++; continue; }
      if (c >= '0' && c <= '9') {
        if (rings[c]) {
          mol.bonds.push({ a: rings[c].id, b: prev.id, order: Math.max(order, rings[c].order) });
          delete rings[c];
        } else {
          rings[c] = { id: prev.id, order };
        }
        order = 1;
        i++;
        continue;
      }
      let el = null;
      if (s.startsWith('Cl', i)) el = 'Cl';
      else if (s.startsWith('Br', i)) el = 'Br';
      else if ('CNOFI'.includes(c)) el = c;
      if (!el) throw new Error('Unsupported SMILES character "' + c + '" in ' + s);
      const a = mol.addAtom(el, 0, 0);
      if (prev) mol.bonds.push({ a: prev.id, b: a.id, order });
      prev = a;
      order = 1;
      i += el.length;
    }
    OB.layout2D(mol, 0, 0);
    return mol;
  };

  // ---- 2D layout: zigzag main chain, branches at 60/90 degrees ----
  function farthest(g, start, allowed) {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    let last = start;
    while (queue.length) {
      const a = queue.shift();
      last = a;
      g.adj[a].forEach(e => {
        if (allowed.has(e.to) && !dist.has(e.to)) { dist.set(e.to, dist.get(a) + 1); queue.push(e.to); }
      });
    }
    return last;
  }

  OB.layout2D = function (mol, cx, cy) {
    const g = OB.toGraph(mol);
    if (!g.n) return;
    const L = OB.BOND_LENGTH;
    const px = new Array(g.n).fill(0);
    const py = new Array(g.n).fill(0);
    const deg = Math.PI / 180;
    let offset = 0;

    OB.components(g).forEach(comp => {
      const allowed = new Set(comp);
      const root = farthest(g, farthest(g, comp[0], allowed), allowed);

      // spanning tree by DFS
      const kids = new Map();
      const seen = new Set([root]);
      (function build(a) {
        const list = [];
        g.adj[a].forEach(e => {
          if (seen.has(e.to)) return;
          seen.add(e.to);
          list.push(e.to);
          build(e.to);
        });
        kids.set(a, list);
      })(root);
      const height = new Map();
      (function h(a) {
        let best = 0;
        kids.get(a).forEach(k => { best = Math.max(best, h(k)); });
        height.set(a, best + 1);
        return best + 1;
      })(root);

      const isLinear = a => g.adj[a].some(e => e.order === 3) ||
        g.adj[a].filter(e => e.order === 2).length === 2;

      (function place(a, dir, sign) {
        const list = kids.get(a).slice().sort((p, q) => height.get(q) - height.get(p));
        let offs;
        if (dir === null) {
          offs = list.map((_, i) => -30 + i * (360 / Math.max(1, list.length)));
        } else if (list.length === 1) {
          offs = [isLinear(a) ? 0 : sign * 60];
        } else if (list.length === 2) {
          offs = isLinear(a) ? [0, 90] : [sign * 60, -sign * 60];
        } else {
          offs = [0, 90, -90, 180].slice(0, list.length);
        }
        list.forEach((k, i) => {
          const d = dir === null ? offs[i] : dir + offs[i];
          px[k] = px[a] + L * Math.cos(d * deg);
          py[k] = py[a] + L * Math.sin(d * deg);
          const o = dir === null ? -1 : offs[i];
          place(k, d, o > 0 ? -1 : o < 0 ? 1 : -sign);
        });
      })(root, null, 1);

      // Relax only if something overlaps (rings, crowded branches).
      const tooClose = () => {
        for (let i = 0; i < comp.length; i++) for (let j = i + 1; j < comp.length; j++) {
          const a = comp[i], b = comp[j];
          if (Math.hypot(px[a] - px[b], py[a] - py[b]) < 0.7 * L) return true;
        }
        return false;
      };
      if (tooClose() || OB.ringAtoms(g).some(a => allowed.has(a))) {
        for (let it = 0; it < 400; it++) {
          const fx = new Map(comp.map(a => [a, 0]));
          const fy = new Map(comp.map(a => [a, 0]));
          for (let i = 0; i < comp.length; i++) for (let j = i + 1; j < comp.length; j++) {
            const a = comp[i], b = comp[j];
            let dx = px[b] - px[a], dy = py[b] - py[a];
            let d = Math.hypot(dx, dy);
            if (d < 1e-3) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
            const bonded = g.adj[a].some(e => e.to === b);
            let f = 0;
            if (bonded) f = (d - L) * 0.3;
            else if (d < 1.7 * L) f = -(1.7 * L - d) * 0.08;
            fx.set(a, fx.get(a) + f * dx / d); fy.set(a, fy.get(a) + f * dy / d);
            fx.set(b, fx.get(b) - f * dx / d); fy.set(b, fy.get(b) - f * dy / d);
          }
          comp.forEach(a => { px[a] += fx.get(a); py[a] += fy.get(a); });
        }
      }

      // pack components left to right
      const minX = Math.min(...comp.map(a => px[a]));
      const maxX = Math.max(...comp.map(a => px[a]));
      const midY = (Math.min(...comp.map(a => py[a])) + Math.max(...comp.map(a => py[a]))) / 2;
      comp.forEach(a => { px[a] += offset - minX; py[a] -= midY; });
      offset += maxX - minX + 2 * L;
    });

    const midX = (Math.min(...px) + Math.max(...px)) / 2;
    mol.atoms.forEach((atom, i) => { atom.x = px[i] - midX + cx; atom.y = py[i] + cy; });
  };
})();
