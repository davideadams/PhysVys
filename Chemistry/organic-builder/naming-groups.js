// Organic Molecule Builder -- naming, part 1: is this nameable, and what
// functional groups does it contain?
//
// Verdicts the page can give, in the order they are checked:
//   empty            nothing drawn
//   invalid          an atom has more bonds than it can make
//   not-one-compound several unconnected pieces: a name describes one compound
//   not-organic      no carbon: it has a name, but from inorganic rules
//   out-of-scope     a real organic compound with an IUPAC name that this
//                    page does not have the rules to produce
//   named            named (notes may say the name lacks a stereo prefix)
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  class ScopeError extends Error {
    constructor(reason, atoms) {
      super(reason);
      this.reason = reason;
      this.atoms = atoms || [];
    }
  }
  OB.ScopeError = ScopeError;
  OB.outOfScope = function (reason, atoms) { throw new ScopeError(reason, atoms); };

  // Highest priority first. Only these can become the name's suffix.
  OB.PRIORITY = ['acid', 'ester', 'amide', 'aldehyde', 'ketone', 'alcohol', 'amine'];

  OB.GROUP_INFO = {
    acid:     { label: 'carboxylic acid', formula: '–COOH', suffix: 'oic acid', prefix: null },
    ester:    { label: 'ester', formula: '–COO–', suffix: 'oate', prefix: null },
    amide:    { label: 'amide', formula: '–CONH–', suffix: 'amide', prefix: null },
    aldehyde: { label: 'aldehyde', formula: '–CHO', suffix: 'al', prefix: 'oxo' },
    ketone:   { label: 'ketone', formula: 'C=O', suffix: 'one', prefix: 'oxo' },
    alcohol:  { label: 'alcohol (hydroxyl)', formula: '–OH', suffix: 'ol', prefix: 'hydroxy' },
    amine:    { label: 'amine', formula: '–N<', suffix: 'amine', prefix: 'amino' },
    halo:     { label: 'halogen', formula: '–X', suffix: null, prefix: null },
  };

  // Checks that come before any chemistry: returns a verdict object, or null
  // if the structure is a single, valid organic molecule.
  OB.preCheck = function (g) {
    if (g.n === 0) {
      return { status: 'empty', headline: 'Nothing to name yet',
        reason: 'Draw a molecule, or pick a preset.' };
    }
    const over = [];
    for (let i = 0; i < g.n; i++) if (g.h[i] < 0) over.push(i);
    if (over.length) {
      return { status: 'invalid', headline: 'Not a valid structure',
        reason: 'An atom has more bonds than it can form (' +
          over.map(i => g.el[i]).join(', ') + '). Remove a bond to fix it.', atoms: over };
    }
    const comps = OB.components(g);
    if (comps.length > 1) {
      return { status: 'not-one-compound', headline: 'Not a single compound',
        reason: 'The drawing has ' + comps.length + ' separate pieces. An IUPAC name describes ' +
          'one compound, so there is no single name for this. Join the pieces with a bond, or ' +
          'delete the ones you do not want.' };
    }
    if (!g.el.includes('C')) {
      return { status: 'not-organic', headline: 'Not an organic compound',
        reason: 'There is no carbon, so this is named with inorganic nomenclature, which this ' +
          'page does not cover. It does have a name; this page just cannot give it.' };
    }
    return null;
  };

  function isCarbonylCarbon(g, c) {
    return g.el[c] === 'C' && g.adj[c].some(e => e.order === 2 && g.el[e.to] === 'O');
  }

  // Sorts every heteroatom into a functional group, or throws ScopeError for
  // anything the page cannot name. Returns a list of groups:
  //   { type, carbon, atoms, ... }   carbon = the chain carbon it hangs from
  OB.classifyGroups = function (g) {
    const groups = [];
    const claimed = new Set();
    const C = i => g.el[i] === 'C';

    // Carbonyl carbons first: they decide what their neighbouring O and N are.
    for (let c = 0; c < g.n; c++) {
      if (!C(c)) continue;
      const dO = g.adj[c].filter(e => e.order === 2 && g.el[e.to] === 'O');
      if (!dO.length) continue;
      if (dO.length > 1) {
        OB.outOfScope('A carbon double-bonded to two oxygens, as in carbon dioxide or a ' +
          'carbonate. This is not one of the groups the page names.', [c, ...dO.map(e => e.to)]);
      }
      const oxo = dO[0].to;
      const others = g.adj[c].filter(e => e.to !== oxo);
      if (others.some(e => e.order > 1)) {
        OB.outOfScope('A C=O carbon that is also double-bonded to another atom (a ketene).', [c, oxo]);
      }
      const hetero = others.filter(e => !C(e.to)).map(e => e.to);
      const carbons = others.filter(e => C(e.to)).map(e => e.to);
      if (hetero.length > 1) {
        OB.outOfScope('A C=O carbon bonded to two other non-carbon atoms (a carbonate, carbamate ' +
          'or urea-type group).', [c, oxo, ...hetero]);
      }
      claimed.add(oxo);
      if (hetero.length === 1) {
        const x = hetero[0];
        claimed.add(x);
        if (g.el[x] === 'O') {
          const beyond = g.adj[x].filter(e => e.to !== c).map(e => e.to);
          if (!beyond.length) {
            groups.push({ type: 'acid', carbon: c, atoms: [c, oxo, x] });
          } else {
            const y = beyond[0];
            if (!C(y)) OB.outOfScope('An oxygen bonded to another oxygen or nitrogen (a peroxy group).', [x, y]);
            if (isCarbonylCarbon(g, y)) OB.outOfScope('An acid anhydride (–CO–O–CO–).', [c, x, y]);
            groups.push({ type: 'ester', carbon: c, atoms: [c, oxo, x], etherO: x, alkylStart: y });
          }
        } else if (g.el[x] === 'N') {
          const beyond = g.adj[x].filter(e => e.to !== c);
          if (beyond.some(e => e.order > 1 || !C(e.to))) {
            OB.outOfScope('An amide nitrogen with an unusual bond (to N, O, or a double bond).', [c, x]);
          }
          if (beyond.some(e => isCarbonylCarbon(g, e.to))) {
            OB.outOfScope('A nitrogen bonded to two C=O groups (an imide).', [c, x]);
          }
          groups.push({ type: 'amide', carbon: c, atoms: [c, oxo, x], n: x, nCarbons: beyond.map(e => e.to) });
        } else {
          OB.outOfScope('An acyl halide (–COX). Its name uses rules this page does not have.', [c, oxo, x]);
        }
      } else if (carbons.length <= 1 && g.h[c] >= 1) {
        groups.push({ type: 'aldehyde', carbon: c, atoms: [c, oxo] });
      } else {
        groups.push({ type: 'ketone', carbon: c, atoms: [c, oxo] });
      }
    }

    for (let i = 0; i < g.n; i++) {
      if (C(i) || claimed.has(i)) continue;
      const el = g.el[i];
      const nbs = g.adj[i];
      if (!nbs.length) continue;   // a lone atom: only possible in a drawing of several pieces
      if (OB.HALOGENS[el]) {
        if (!C(nbs[0].to)) {
          OB.outOfScope('A halogen bonded to ' + g.el[nbs[0].to] + ' rather than to carbon.', [i, nbs[0].to]);
        }
        groups.push({ type: 'halo', carbon: nbs[0].to, atoms: [i], el });
      } else if (el === 'O') {
        if (nbs.some(e => e.order > 1)) OB.outOfScope('An oxygen double-bonded to nitrogen (a nitroso or nitro group).', [i]);
        if (nbs.some(e => !C(e.to))) {
          OB.outOfScope('An oxygen bonded to another oxygen or to nitrogen (a peroxide or hydroxylamine).', [i]);
        }
        if (nbs.length === 2) {
          OB.outOfScope('An ether (C–O–C). Ethers are named with "alkoxy" prefixes, which ' +
            'this page does not do yet.', [i, nbs[0].to, nbs[1].to]);
        }
        groups.push({ type: 'alcohol', carbon: nbs[0].to, atoms: [i] });
      } else if (el === 'N') {
        const triple = nbs.find(e => e.order === 3);
        if (triple) OB.outOfScope('A nitrile (C≡N). Nitriles are outside this page\'s naming rules.', [i, triple.to]);
        const dbl = nbs.find(e => e.order === 2);
        if (dbl) OB.outOfScope('A C=N or N=N double bond (an imine or azo compound).', [i, dbl.to]);
        if (nbs.some(e => !C(e.to))) {
          OB.outOfScope('A nitrogen bonded to nitrogen or oxygen (a hydrazine or hydroxylamine).', [i]);
        }
        groups.push({ type: 'amine', carbon: nbs[0].to, carbons: nbs.map(e => e.to), n: i, atoms: [i] });
      }
    }
    return groups;
  };

  // Decide the principal group and check that the others can be prefixes.
  OB.principalOf = function (groups) {
    const types = new Set(groups.map(x => x.type));
    const principal = OB.PRIORITY.find(t => types.has(t)) || null;
    const all = t => groups.filter(x => x.type === t);

    if (types.has('ester')) {
      if (principal !== 'ester') {
        OB.outOfScope('An ester alongside a carboxylic acid. The ester would need an ' +
          '"alkoxycarbonyl" prefix, which this page does not do.', all('ester')[0].atoms);
      }
      if (all('ester').length > 1) {
        OB.outOfScope('More than one ester group.', all('ester').flatMap(x => x.atoms));
      }
    }
    if (types.has('amide') && principal !== 'amide') {
      OB.outOfScope('An amide alongside a higher-priority group. It would need a "carbamoyl" ' +
        'prefix, which this page does not do.', all('amide')[0].atoms);
    }
    if (principal === 'amide' && all('amide').length > 1 && all('amide').some(x => x.nCarbons.length)) {
      OB.outOfScope('Several amide groups with substituted nitrogens.', all('amide').flatMap(x => x.atoms));
    }
    all('amine').forEach(x => {
      if (x.carbons.length > 1 && principal !== 'amine') {
        OB.outOfScope('A secondary or tertiary amine alongside a higher-priority group. It would ' +
          'need an "alkylamino" prefix, which this page does not do.', [x.n]);
      }
    });
    if (principal === 'amine' && all('amine').length > 1 && all('amine').some(x => x.carbons.length > 1)) {
      OB.outOfScope('Several amine groups, at least one of them secondary or tertiary.', all('amine').map(x => x.n));
    }
    return principal;
  };
})();
