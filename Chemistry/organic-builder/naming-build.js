// Organic Molecule Builder -- naming, part 3: substituent names, the parent
// name, assembly, stereo warnings, and the step-by-step record.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const STEM = [null, 'meth', 'eth', 'prop', 'but', 'pent', 'hex', 'hept', 'oct', 'non', 'dec',
    'undec', 'dodec', 'tridec', 'tetradec', 'pentadec', 'hexadec', 'heptadec', 'octadec', 'nonadec', 'icos'];
  const MULT = ['', '', 'di', 'tri', 'tetra', 'penta', 'hexa', 'hepta', 'octa', 'nona', 'deca'];
  const MULT_COMPLEX = ['', '', 'bis', 'tris', 'tetrakis', 'pentakis', 'hexakis'];
  OB.STEM = STEM;

  const SUFFIX = { acid: 'oic acid', ester: 'oate', amide: 'amide', aldehyde: 'al', ketone: 'one', alcohol: 'ol', amine: 'amine' };
  const TERMINAL = { acid: '–COOH', ester: '–COO–', amide: '–CONH–', aldehyde: '–CHO' };

  function branchAtoms(g, root, from) {
    const out = [];
    (function walk(a, f) {
      out.push(a);
      g.adj[a].forEach(e => { if (e.to !== f) walk(e.to, a); });
    })(root, from);
    return out;
  }
  OB.branchAtoms = branchAtoms;

  // Why a side chain cannot be named here, or null if it can. Side chains
  // made only of carbon are fine, saturated or not, joined by a single bond
  // (-yl) or a double bond (-ylidene).
  function alkylProblem(g, root, from) {
    const atoms = branchAtoms(g, root, from);
    if (OB.bondOrder(g, from, root) > 2) {
      return { reason: 'A side chain joined to the main chain by a triple bond (an "ylidyne" substituent).', atoms: [from, root] };
    }
    if (atoms.some(a => g.el[a] !== 'C')) {
      return { reason: 'A side chain that itself carries a functional group or halogen (for example ' +
        'chloromethyl or hydroxymethyl). This page only names side chains made of carbon and hydrogen.', atoms };
    }
    return null;
  }

  // Name a carbon side chain attached through `root` (2013 rules, P-29 and
  // P-44): its own parent chain is the longest chain that contains the
  // attachment carbon, then the one with most multiple bonds; the attachment
  // carbon gets the lowest locant it can. The ending is -yl for a single bond
  // to the main chain, -ylidene for a double bond.
  //   methyl, ethyl, propyl, propan-2-yl, 2-methylpropan-2-yl, ethenyl,
  //   prop-2-en-1-yl, methylidene, propan-2-ylidene
  function alkylName(g, root, from, memo) {
    memo = memo || new Map();
    const key = root + ',' + from;
    if (memo.has(key)) return memo.get(key);
    const bo = OB.bondOrder(g, from, root);
    const inBranch = new Set(branchAtoms(g, root, from));

    // every path inside the branch that passes through the attachment carbon
    const cands = [];
    inBranch.forEach(s => {
      const path = [];
      (function walk(a, f) {
        path.push(a);
        if (path.includes(root)) cands.push(evaluate(path.slice()));
        g.adj[a].forEach(e => { if (e.to !== f && inBranch.has(e.to)) walk(e.to, a); });
        path.pop();
      })(s, -1);
    });

    function evaluate(p) {
      const pos = new Map(p.map((a, i) => [a, i + 1]));
      const dbl = [], tri = [];
      for (let i = 0; i + 1 < p.length; i++) {
        const o = OB.bondOrder(g, p[i], p[i + 1]);
        if (o === 2) dbl.push(i + 1);
        if (o === 3) tri.push(i + 1);
      }
      const subs = [];
      p.forEach((x, i) => g.adj[x].forEach(e => {
        if (inBranch.has(e.to) && !pos.has(e.to)) subs.push({ locant: i + 1, ...alkylName(g, e.to, x, memo) });
      }));
      const alpha = subs.slice()
        .sort((s, t) => s.alpha < t.alpha ? -1 : s.alpha > t.alpha ? 1 : s.locant - t.locant)
        .map(s => s.locant);
      return { p, att: pos.get(root), dbl, tri, mult: dbl.concat(tri).sort((a, b) => a - b), subs,
        subLocs: subs.map(s => s.locant).sort((a, b) => a - b), alpha };
    }

    // same rule order as for the main chain, with the attachment point
    // playing the part of the principal group in the numbering
    const order = [
      c => -c.p.length, c => -c.mult.length, c => -c.dbl.length, c => [c.att],
      c => c.mult, c => c.dbl, c => -c.subs.length, c => c.subLocs, c => c.alpha,
    ];
    const cmp = (a, b) => {
      for (const f of order) {
        const x = f(a), y = f(b);
        const d = Array.isArray(x) ? OB.lexCompare(x, y) : x - y;
        if (d) return d;
      }
      return 0;
    };
    cands.sort(cmp);
    let best = null;
    cands.filter(c => cmp(c, cands[0]) === 0).forEach(c => {
      const name = sideChainName(c, bo);
      if (!best || name < best) best = name;
    });
    const out = { name: best, complex: /[0-9(]/.test(best), alpha: best.replace(/[^a-z]/g, '') };
    memo.set(key, out);
    return out;
  }

  function sideChainName(c, bo) {
    const L = c.p.length;
    const suffix = bo === 2 ? 'ylidene' : 'yl';
    let core;
    if (!c.mult.length) {
      core = c.att === 1 ? (STEM[L] || 'C' + L) + suffix : STEM[L] + 'an-' + c.att + '-' + suffix;
    } else if (L === 2) {
      core = parentName(2, c.dbl, c.tri, { text: suffix, count: 1, locs: [], show: false }, false);
    } else {
      core = parentName(L, c.dbl, c.tri, { text: suffix, count: 1, locs: [c.att], show: true }, true);
    }
    return (c.subs.length ? prefixString(c.subs, true) : '') + core;
  }

  // Display name of a prefix, without throwing (used while comparing chains).
  OB.prefixDisplay = function (g, p) {
    if (p.kind !== 'alkyl') return { name: p.name, alpha: p.name, complex: false };
    if (alkylProblem(g, p.root, p.from)) return { name: '?', alpha: '~', complex: false };
    const n = alkylName(g, p.root, p.from);
    return { name: n.name, alpha: n.name.replace(/[^a-z]/g, ''), complex: n.complex };
  };

  // Group identical prefixes, multiply, alphabetise, join.
  function prefixGroups(items, showNumeric) {
    const map = new Map();
    items.forEach(p => {
      const k = p.name + (p.complex ? '|c' : '');
      if (!map.has(k)) map.set(k, { name: p.name, complex: p.complex, locs: [], atoms: [] });
      map.get(k).locs.push(p.locant);
      if (p.atoms) map.get(k).atoms.push(...p.atoms);
    });
    const parts = [...map.values()].map(gp => {
      const ns = gp.locs.filter(l => l === 'N');
      const nums = gp.locs.filter(l => l !== 'N').sort((a, b) => a - b);
      const shown = showNumeric ? ns.concat(nums) : ns;
      const count = gp.locs.length;
      const mult = count > 1 ? (gp.complex ? MULT_COMPLEX[count] : MULT[count]) || '' : '';
      const body = gp.complex ? '(' + gp.name + ')' : gp.name;
      return { ...gp, mult, alpha: gp.name.replace(/[^a-z]/g, ''),
        text: (shown.length ? shown.join(',') + '-' : '') + mult + body };
    });
    parts.sort((a, b) => a.alpha < b.alpha ? -1 : a.alpha > b.alpha ? 1 : 0);
    return parts;
  }

  function prefixString(items, showNumeric) {
    let s = '';
    prefixGroups(items, showNumeric).forEach(p => {
      s += (s && /^[0-9N]/.test(p.text) ? '-' : '') + p.text;
    });
    return s;
  }

  function parentName(len, dbl, tri, suf, showUnsat) {
    const terms = [];
    if (!dbl.length && !tri.length) terms.push({ base: 'an', locs: [] });
    if (dbl.length) terms.push({ base: 'en', locs: dbl });
    if (tri.length) terms.push({ base: 'yn', locs: tri });
    terms.forEach(t => { t.mult = t.locs.length > 1 ? MULT[t.locs.length] : ''; });
    const sufStart = suf ? (suf.count > 1 ? MULT[suf.count] : '') + suf.text : '';
    let s = STEM[len];
    if (terms[0].mult) s += 'a';
    terms.forEach((t, i) => {
      const next = i + 1 < terms.length ? terms[i + 1].mult + terms[i + 1].base : sufStart;
      const loc = showUnsat && t.locs.length ? '-' + t.locs.join(',') + '-' : '';
      s += loc + t.mult + t.base + (/^[aeiouy]/.test(next) ? '' : 'e');
    });
    if (suf) s += (suf.show && suf.locs.length ? '-' + suf.locs.join(',') + '-' : '') + sufStart;
    return s;
  }
  OB.parentName = parentName;

  // Name one chosen chain + numbering. Throws ScopeError if it cannot.
  OB.buildName = function (ctx, c) {
    const { g, groups, principal } = ctx;
    const len = c.path.length;
    if (len > 20) {
      OB.outOfScope('A parent chain longer than 20 carbons. The page only knows stem names up to icos- (20).', c.path);
    }
    if (principal) {
      const total = groups.filter(x => x.type === principal);
      if (c.pLocs.length < total.length) {
        OB.outOfScope('Not all the ' + OB.GROUP_INFO[principal].label + ' groups can lie on one chain. ' +
          'The rest would need prefix forms this page does not do.', total.flatMap(x => x.atoms));
      }
    }
    const named = c.prefixes.map(p => {
      if (p.kind !== 'alkyl') return { ...p, complex: false };
      const prob = alkylProblem(g, p.root, p.from);
      if (prob) OB.outOfScope(prob.reason, prob.atoms);
      const n = alkylName(g, p.root, p.from);
      return { ...p, name: n.name, complex: n.complex, atoms: branchAtoms(g, p.root, p.from) };
    });

    let suf = null, alkylWord = null, esterAtoms = [];
    if (principal) {
      const takesLocs = ['ketone', 'alcohol', 'amine'].includes(principal);
      suf = { text: SUFFIX[principal], count: c.pLocs.length, locs: takesLocs ? c.pLocs : [], show: takesLocs };
      if (principal === 'ester') {
        const est = c.anchored[0].group;
        const prob = alkylProblem(g, est.alkylStart, est.etherO);
        if (prob) {
          OB.outOfScope('The group on the ester\'s single-bonded oxygen is not a plain alkyl group. ' + prob.reason, prob.atoms);
        }
        alkylWord = alkylName(g, est.alkylStart, est.etherO).name;
        esterAtoms = branchAtoms(g, est.alkylStart, est.etherO);
      }
    }

    // Locants left out (2013, P-14.3.4): suffixes that can only be on C1
    // (-al, -oic acid, -amide, -oate); everything on a one-carbon chain; a
    // single group on a two-carbon chain; the multiple bond of ethene/ethyne.
    // Everything else keeps its locants: prop-1-ene, propan-2-one.
    let showNum = true, showUnsat = true, omitNote = null;
    const numPrefixes = named.filter(p => p.locant !== 'N').length;
    const sufLocs = suf && suf.show ? suf.locs.length : 0;
    const unsat = c.dbl.length + c.tri.length;
    if (len === 1) {
      showNum = false;
      if (suf) suf.show = false;
      if (numPrefixes + sufLocs) omitNote = 'With only one carbon, everything is on C1, so no locants are written.';
    } else if (len === 2) {
      showUnsat = false;
      if (numPrefixes + sufLocs === 1) {
        showNum = false;
        if (suf) suf.show = false;
        omitNote = 'On a two-carbon chain a single group can only be on C1, so its locant is left out.';
      } else if (unsat) {
        omitNote = 'In a two-carbon chain the multiple bond can only be between C1 and C2, so it has no locant.';
      }
    } else if (named.length === 0 && ((!principal && unsat === 1 && len === 3) ||
        (principal === 'ketone' && sufLocs === 1 && unsat === 0 && (len === 3 || len === 4)))) {
      omitNote = 'The 2013 rules keep this locant even though there is only one place it could go. ' +
        'Older textbooks often leave it out (' + (principal ? STEM[len] + 'anone' :
          STEM[len] + (c.dbl.length ? 'ene' : 'yne')) + ').';
    }

    const prefixText = prefixString(named, showNum);
    const parent = parentName(len, c.dbl, c.tri, suf, showUnsat);
    let name = prefixText + parent;
    if (alkylWord) name = alkylWord + ' ' + name;
    return { name, named, prefixText, parent, suf, showNum, showUnsat, omitNote, alkylWord, esterAtoms,
      groupsOut: prefixGroups(named, showNum) };
  };

  // ---- stereochemistry warnings ----
  function stereoNotes(g, pos) {
    const memo = new Map();
    const label = a => pos.has(a) ? 'C' + pos.get(a) : 'a side-chain carbon';
    const notes = [];
    g.bonds.forEach(b => {
      if (b.order !== 2 || g.el[b.a] !== 'C' || g.el[b.b] !== 'C') return;
      const ok = [b.a, b.b].every(x => {
        const other = x === b.a ? b.b : b.a;
        const keys = g.adj[x].filter(e => e.to !== other).map(e => e.order + OB.branchKey(g, e.to, x, memo));
        for (let k = 0; k < g.h[x]; k++) keys.push('H');
        return keys.length === 2 && keys[0] !== keys[1];
      });
      if (!ok) return;
      const [p, q] = [b.a, b.b].sort((u, v) => (pos.get(u) || 99) - (pos.get(v) || 99));
      notes.push({ kind: 'ez', atoms: [p, q], text: 'The ' + label(p) + '=' + label(q) + ' double bond ' +
        'can have its groups on the same side or on opposite sides (Z or E; cis or trans). Those are ' +
        'two different compounds, and a full name begins with (E)- or (Z)-. This page does not assign that yet.' });
    });
    for (let a = 0; a < g.n; a++) {
      if (g.el[a] !== 'C' || g.adj[a].some(e => e.order > 1) || g.h[a] > 1) continue;
      const keys = g.adj[a].map(e => OB.branchKey(g, e.to, a, memo));
      if (g.h[a] === 1) keys.push('H');
      if (keys.length === 4 && new Set(keys).size === 4) {
        notes.push({ kind: 'chiral', atoms: [a], text: label(a) + ' has four different groups on it, so it ' +
          'is a chiral centre: the molecule has two mirror-image forms, named (R)- or (S)-. This page does not assign those.' });
      }
    }
    return notes;
  }

  // ---- the whole job ----
  function toIds(g, list) { return (list || []).map(i => g.ids[i]); }

  OB.nameMolecule = function (mol) {
    const g = OB.toGraph(mol);
    const pre = OB.preCheck(g);
    if (pre) return { ...pre, atoms: toIds(g, pre.atoms) };
    try {
      if (OB.hasRing(g)) {
        OB.outOfScope('A ring. Cyclic compounds such as cyclohexane and benzene use naming rules this ' +
          'page does not have yet.', OB.ringAtoms(g));
      }
      const groups = OB.classifyGroups(g);
      const principal = OB.principalOf(groups);
      const ctx = { g, groups, principal };
      const choice = OB.chooseChain(ctx);

      let best = null, firstErr = null, differing = false;
      choice.remaining.forEach(c => {
        let r;
        try { r = OB.buildName(ctx, c); } catch (e) {
          if (!(e instanceof OB.ScopeError)) throw e;
          if (!firstErr) firstErr = e;
          return;
        }
        if (best && r.name !== best.r.name) differing = true;
        if (!best || r.name < best.r.name) best = { c, r };
      });
      if (!best) throw firstErr;

      const steps = OB.describeSteps(ctx, choice, best.c, best.r, differing);
      const notes = stereoNotes(g, best.c.pos);
      const mapStep = s => ({ ...s, atoms: toIds(g, s.atoms), labels: (s.labels || []).map(([i, t]) => [g.ids[i], t]) });
      return {
        status: 'named',
        name: best.r.name,
        parts: OB.nameParts(principal, best.c, best.r),
        steps: steps.map(mapStep),
        notes: notes.map(n => ({ ...n, atoms: toIds(g, n.atoms) })),
        chain: toIds(g, best.c.path),
        principal,
      };
    } catch (e) {
      if (!(e instanceof OB.ScopeError)) throw e;
      return { status: 'out-of-scope', headline: 'Outside this page\'s naming scope', reason: e.reason, atoms: toIds(g, e.atoms) };
    }
  };

  OB.STEP_HELPERS = { STEM, MULT, SUFFIX, TERMINAL, prefixGroups };
})();
