// Organic Molecule Builder -- naming, part 2: choose and number the parent chain.
//
// Every path through the carbon skeleton, in both directions, is a candidate
// "chain + numbering". The rules are applied one at a time, in this order,
// keeping only the candidates that do best on each:
//   1  most principal groups on the chain
//   2  longest chain
//   3  most multiple bonds (C=C, C#C) in the chain
//   4  most double bonds
//   5  lowest locants for the principal groups
//   6  lowest locants for the multiple bonds
//   7  lowest locants for the double bonds
//   8  most substituents
//   9  lowest locants for the substituents
//   10 lowest locant for the substituent first in alphabetical order
// This is the order of the 2013 IUPAC recommendations (P-44.3, P-31.1.4,
// P-45.2): length comes before unsaturation, so a double bond can end up in
// a side chain (3-methylidenehexane). Older rules put rule 3 first.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  function carbonPaths(g) {
    const paths = [];
    for (let s = 0; s < g.n; s++) {
      if (g.el[s] !== 'C') continue;
      const path = [];
      (function walk(a, from) {
        path.push(a);
        paths.push(path.slice());
        g.adj[a].forEach(e => { if (e.to !== from && g.el[e.to] === 'C') walk(e.to, a); });
        path.pop();
      })(s, -1);
    }
    return paths;
  }

  // Describe one oriented chain: what is on it and where.
  OB.evaluateChain = function (ctx, path) {
    const { g, groups, principal } = ctx;
    const pos = new Map(path.map((a, i) => [a, i + 1]));
    const pLocs = [];
    const anchored = [];
    groups.forEach(gr => {
      if (gr.type !== principal) return;
      const c = gr.type === 'amine' ? gr.carbons.find(x => pos.has(x)) : (pos.has(gr.carbon) ? gr.carbon : undefined);
      if (c !== undefined) { pLocs.push(pos.get(c)); anchored.push({ group: gr, carbon: c }); }
    });
    pLocs.sort((a, b) => a - b);

    const dbl = [], tri = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const o = OB.bondOrder(g, path[i], path[i + 1]);
      if (o === 2) dbl.push(i + 1);
      if (o === 3) tri.push(i + 1);
    }

    const prefixes = [];
    path.forEach((a, i) => {
      const L = i + 1;
      groups.forEach(gr => {
        if (gr.carbon !== a || gr.type === principal) return;
        if (gr.type === 'halo') prefixes.push({ kind: 'halo', name: OB.HALOGENS[gr.el], locant: L, atoms: gr.atoms });
        else prefixes.push({ kind: gr.type, name: OB.GROUP_INFO[gr.type].prefix, locant: L, atoms: gr.atoms.filter(x => x !== a) });
      });
      g.adj[a].forEach(e => {
        if (g.el[e.to] === 'C' && !pos.has(e.to)) prefixes.push({ kind: 'alkyl', root: e.to, from: a, locant: L });
      });
    });
    // Substituents on an amine or amide nitrogen take the locant N.
    anchored.forEach(({ group: gr }) => {
      const nOthers = gr.type === 'amine' ? gr.carbons.filter(x => !pos.has(x))
        : gr.type === 'amide' ? gr.nCarbons : [];
      nOthers.forEach(r => prefixes.push({ kind: 'alkyl', root: r, from: gr.n, locant: 'N' }));
    });

    const multLocs = dbl.concat(tri).sort((a, b) => a - b);
    const prefixLocs = prefixes.filter(p => p.locant !== 'N').map(p => p.locant).sort((a, b) => a - b);
    return { path, pos, pLocs, anchored, dbl, tri, multLocs, prefixes, prefixLocs };
  };

  function lexCompare(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }
  OB.lexCompare = lexCompare;
  const fmt = arr => arr.length ? arr.join(',') : 'none';

  // Locants in the order the prefixes will be cited (alphabetical).
  function alphaLocs(ctx, c) {
    if (!c.named) c.named = c.prefixes.map(p => ({ ...p, ...OB.prefixDisplay(ctx.g, p) }));
    return c.named
      .filter(p => p.locant !== 'N')
      .slice()
      .sort((p, q) => p.alpha < q.alpha ? -1 : p.alpha > q.alpha ? 1 : p.locant - q.locant)
      .map(p => p.locant);
  }

  OB.chooseChain = function (ctx) {
    const { g, principal } = ctx;
    const info = principal ? OB.GROUP_INFO[principal] : null;
    let cands = carbonPaths(g).map(p => OB.evaluateChain(ctx, p));
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    const rules = [
      { phase: 'chain', kind: 'max', value: c => c.pLocs.length, skip: !principal,
        say: (best) => best === 1
          ? 'The parent chain must include the carbon that carries the ' + info.label + ' group.'
          : 'The parent chain must include the carbons that carry all ' + best + ' ' + info.label + ' groups.' },
      { phase: 'chain', kind: 'max', value: c => c.path.length, always: true,
        say: (best) => (log.length ? 'The longest chain that does this' : 'The longest carbon chain') +
          ' has ' + plural(best, 'carbon', 'carbons') + ' (highlighted).' },
      { phase: 'chain', kind: 'max', value: c => c.multLocs.length,
        say: (best) => 'There is more than one way to trace a chain that long, so the parent is the one ' +
          'containing the most C=C and C≡C bonds (' + best + ').' },
      { phase: 'chain', kind: 'max', value: c => c.dbl.length,
        say: () => 'Still tied, so the parent is the one with more double bonds.' },
      { phase: 'number', kind: 'low', value: c => c.pLocs, skip: !principal,
        say: (best, worse) => 'The ' + info.label + ' group gets the lowest locant: ' + fmt(best) +
          ' rather than ' + fmt(worse) + '.' },
      { phase: 'number', kind: 'low', value: c => c.multLocs,
        say: (best, worse) => 'The multiple bonds get the lowest locants: ' + fmt(best) + ' rather than ' + fmt(worse) + '.' },
      { phase: 'number', kind: 'low', value: c => c.dbl,
        say: (best, worse) => 'When there is a choice, double bonds get lower locants than triple bonds: ' +
          fmt(best) + ' rather than ' + fmt(worse) + '.' },
      { phase: 'chain', kind: 'max', value: c => c.prefixes.length,
        say: (best) => 'There is more than one way to trace a chain that long, so the parent is the one ' +
          'with the most groups attached to it (' + best + ').' },
      { phase: 'number', kind: 'low', value: c => c.prefixLocs,
        say: (best, worse) => 'The substituents get the lowest set of locants: ' + fmt(best) +
          ' rather than ' + fmt(worse) + ' (compared at the first point of difference).' },
      { phase: 'number', kind: 'low', value: c => alphaLocs(ctx, c),
        say: (best, worse) => 'Still tied, so the substituent cited first in alphabetical order gets the ' +
          'lower number: ' + fmt(best) + ' rather than ' + fmt(worse) + '.' },
    ];

    const log = [];
    rules.forEach((rule, idx) => {
      if (rule.skip) return;
      const vals = cands.map(rule.value);
      let best = vals[0];
      vals.forEach(v => {
        if (rule.kind === 'max' ? v > best : lexCompare(v, best) < 0) best = v;
      });
      const same = v => rule.kind === 'max' ? v === best : lexCompare(v, best) === 0;
      const keep = cands.filter((c, i) => same(vals[i]));
      const dropped = cands.filter((c, i) => !same(vals[i]));
      if (dropped.length || rule.always) {
        let worse = rule.value(dropped[0] || keep[0]);
        if (rule.kind === 'low') {
          // report the runner-up, not an arbitrary loser
          dropped.forEach(c => { const v = rule.value(c); if (lexCompare(v, worse) < 0) worse = v; });
        }
        cands = keep;
        log.push({ phase: rule.phase, text: rule.say(best, worse) });
      }
    });

    const winner = cands[0];
    return { winner, remaining: cands, log };
  };
})();
