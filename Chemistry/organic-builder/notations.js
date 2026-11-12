// Organic Molecule Builder -- text notations: molecular and empirical
// formulae, molar mass, condensed structural formula, SMILES.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const FALLBACK_MASSES = { H: 1.008, C: 12.01, N: 14.01, O: 16.00, F: 19.00, Cl: 35.45, Br: 79.90, I: 126.9 };
  const SUB = '₀₁₂₃₄₅₆₇₈₉';

  OB.subscriptHTML = s => s.replace(/([A-Za-z)])(\d+)/g, '$1<sub>$2</sub>');
  OB.subscriptText = s => s.replace(/([A-Za-z)])(\d+)/g, (m, a, d) => a + [...d].map(x => SUB[x]).join(''));

  // Hill order: C, then H, then the rest alphabetically.
  function hillOrder(counts) {
    const keys = Object.keys(counts).filter(k => k !== 'C' && k !== 'H').sort();
    const order = [];
    if (counts.C) order.push('C');
    if (counts.H) order.push('H');
    return order.concat(keys);
  }
  function formulaString(counts, div) {
    return hillOrder(counts).map(k => {
      const n = counts[k] / div;
      return k + (n > 1 ? n : '');
    }).join('');
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : a;

  OB.formulae = function (g) {
    const counts = OB.elementCounts(g);
    const vals = Object.values(counts);
    if (!vals.length) return null;
    const d = vals.reduce(gcd);
    const masses = window.ATOMIC_MASSES || FALLBACK_MASSES;
    let mass = 0;
    Object.keys(counts).forEach(k => { mass += counts[k] * (masses[k] || FALLBACK_MASSES[k]); });
    return { molecular: formulaString(counts, 1), empirical: formulaString(counts, d), mass, counts };
  };

  // ---- condensed structural formula ----
  // Groups such as COOH, CHO and CONH2 are written as one unit on their carbon.
  function absorbedInto(g, c) {
    if (g.el[c] !== 'C') return [];
    const oxo = g.adj[c].find(e => e.order === 2 && g.el[e.to] === 'O');
    if (!oxo) return [];
    const out = [oxo.to];
    g.adj[c].forEach(e => {
      if (e.order === 1 && (g.el[e.to] === 'O' || g.el[e.to] === 'N') && g.adj[e.to].length === 1) out.push(e.to);
    });
    return out;
  }

  OB.condensed = function (g) {
    if (!g.n) return '';
    if (OB.hasRing(g) || OB.components(g).length > 1) return null;
    const absorbedBy = new Map();
    for (let a = 0; a < g.n; a++) absorbedInto(g, a).forEach(x => absorbedBy.set(x, a));
    const keep = a => !absorbedBy.has(a);
    const nbrs = a => g.adj[a].filter(e => keep(e.to));
    const H = n => n === 0 ? '' : n === 1 ? 'H' : 'H' + n;

    function label(a, leading) {
      const h = Math.max(0, g.h[a]);
      if (g.el[a] !== 'C') {
        if (g.el[a] === 'O' || g.el[a] === 'N') return leading && h ? H(h) + g.el[a] : g.el[a] + H(h);
        return g.el[a];
      }
      const abs = absorbedInto(g, a);
      if (!abs.length) return 'C' + H(h);
      const oh = abs.find(x => g.el[x] === 'O' && g.adj[x][0].order === 1);
      const nh = abs.find(x => g.el[x] === 'N');
      if (oh !== undefined) return h ? 'HCOOH' : leading ? 'HOOC' : 'COOH';
      if (nh !== undefined) return h ? 'HCON' + H(g.h[nh]) : leading ? H(g.h[nh]) + 'NOC' : 'CON' + H(g.h[nh]);
      if (h === 2) return 'HCHO';
      if (h && !g.adj[a].some(e => e.order === 1 && g.el[e.to] === 'O')) return leading ? 'OHC' : 'CHO';
      return h ? 'HCO' : 'CO';
    }
    const bondSym = (a, b) => ({ 1: '', 2: '=', 3: '≡' })[OB.bondOrder(g, a, b)];

    // Longest path, preferring one that runs through more carbons.
    const carbons = p => p.filter(x => g.el[x] === 'C').length;
    function longestFrom(start, from) {
      let best = [start];
      nbrs(start).forEach(e => {
        if (e.to === from) return;
        const p = [start].concat(longestFrom(e.to, start));
        if (p.length > best.length || (p.length === best.length && carbons(p) > carbons(best))) best = p;
      });
      return best;
    }

    function render(path, from, leading) {
      let s = '';
      path.forEach((a, i) => {
        if (i > 0) s += bondSym(path[i - 1], a);
        s += label(a, leading && i === 0);
        const skip = new Set([path[i - 1], path[i + 1], i === 0 ? from : -1]);
        const counts = new Map();
        nbrs(a).forEach(e => {
          if (skip.has(e.to)) return;
          const t = bondSym(a, e.to) + render(longestFrom(e.to, a), a, false);
          counts.set(t, (counts.get(t) || 0) + 1);
        });
        counts.forEach((n, t) => { s += '(' + t + ')' + (n > 1 ? n : ''); });
      });
      return s;
    }

    // Backbone: the longest path, oriented to read naturally.
    const keepers = [];
    for (let a = 0; a < g.n; a++) if (keep(a)) keepers.push(a);
    const end1 = longestFrom(keepers[0], -1).slice(-1)[0];
    const path = longestFrom(end1, -1);
    const rev = path.slice().reverse();
    const score = p => {
      let s = 0;
      if (g.el[p[0]] === 'C') s += 4;
      if (!absorbedInto(g, p[0]).length) s += 2;
      // an ester reads C(=O) then O
      for (let i = 0; i + 1 < p.length; i++) {
        if (g.el[p[i + 1]] === 'O' && absorbedInto(g, p[i]).length) s += 8;
      }
      return s;
    };
    const best = score(rev) > score(path) ? rev : path;
    return render(best, -1, true);
  };

  // ---- SMILES (not canonical) ----
  OB.smiles = function (g) {
    if (!g.n) return '';
    const parts = OB.components(g).map(comp => {
      const start = comp.slice().sort((a, b) =>
        (g.el[a] !== 'C') - (g.el[b] !== 'C') || g.adj[a].length - g.adj[b].length)[0];
      // pass 1: DFS tree and ring-closure edges
      const parent = new Map([[start, -1]]);
      const order = [];
      const closures = [];
      (function dfs(a) {
        order.push(a);
        g.adj[a].forEach(e => {
          if (!parent.has(e.to)) { parent.set(e.to, a); dfs(e.to); }
          else if (e.to !== parent.get(a) && order.indexOf(e.to) < order.indexOf(a) &&
                   !closures.some(c => (c.a === e.to && c.b === a) || (c.a === a && c.b === e.to))) {
            closures.push({ a: e.to, b: a, order: e.order });
          }
        });
      })(start);
      let digit = 1;
      const ringMarks = new Map();
      closures.forEach(c => {
        const d = digit++;
        const sym = ({ 1: '', 2: '=', 3: '#' })[c.order];
        ringMarks.set(c.a, (ringMarks.get(c.a) || '') + sym + d);
        ringMarks.set(c.b, (ringMarks.get(c.b) || '') + sym + d);
      });
      const write = a => {
        let s = g.el[a] + (ringMarks.get(a) || '');
        const kids = g.adj[a].filter(e => parent.get(e.to) === a);
        kids.forEach((e, i) => {
          const t = ({ 1: '', 2: '=', 3: '#' })[e.order] + write(e.to);
          s += i < kids.length - 1 ? '(' + t + ')' : t;
        });
        return s;
      };
      return write(start);
    });
    return parts.join('.');
  };
})();
