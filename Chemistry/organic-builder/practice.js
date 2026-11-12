// Organic Molecule Builder -- random molecules for naming practice.
//
// A molecule is grown from a straight chain: maybe one C=C or C#C, a few
// methyl/ethyl branches, then functional groups. Each attempt is named by the
// page's own engine and kept only if it is named in full and its name uses
// what a course covers (no bracketed side chains, no -ylidene/-enyl groups).
//
// Which groups each stage includes is set in OB.PRACTICE below: edit the
// weights to match the course (0 or absent = never).
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  // SACE Stage 1 (subtopic 3.3 Hydrocarbons): up to eight carbons in the main
  // chain, side chains of at most two carbons, one or more alkene groups;
  // teachers may introduce Stage 2 groups. Stage 2 (Topic 3) adds alcohols,
  // aldehydes and ketones, carboxylic acids, amines, esters and amides.
  OB.PRACTICE = {
    stage1: {
      chain: [2, 8],          // carbons in the starting chain
      maxParent: 8,           // longest parent chain allowed in the final name
      branches: 2,            // up to this many methyl/ethyl branches
      multiple: { none: 4, double: 4, triple: 1.5 },
      extraDouble: 0.15,      // chance of a second C=C (a diene) when there is one
      multipleOnlyInHydrocarbons: true,   // C=C and C#C only in alkenes and alkynes
      groups: { none: 3, halo: 1.5, alcohol: 1.5, acid: 1.5, ester: 1.5 },
      second: 0.1,            // chance of a second group, drawn from the list below
      secondary: ['alcohol', 'halo'],
    },
    stage2: {
      chain: [2, 8],
      maxParent: 8,
      branches: 2,
      multiple: { none: 7, double: 2.5, triple: 0.5 },
      extraDouble: 0.05,
      groups: { none: 0.5, halo: 0.5, alcohol: 2, aldehyde: 1.5, ketone: 1.5, acid: 2, ester: 2, amine: 1.5, amide: 1.5 },
      second: 0.2,
      secondary: ['alcohol', 'halo', 'amine', 'ketone'],
    },
  };

  const rand = n => Math.floor(Math.random() * n);
  const pick = arr => arr.length ? arr[rand(arr.length)] : null;
  const range = ([lo, hi]) => lo + rand(hi - lo + 1);
  function weighted(obj) {
    const entries = Object.entries(obj).filter(([, w]) => w > 0);
    let t = entries.reduce((s, [, w]) => s + w, 0) * Math.random();
    for (const [k, w] of entries) { t -= w; if (t <= 0) return k; }
    return entries[entries.length - 1][0];
  }

  function attempt(cfg) {
    const m = new OB.Molecule();
    const n = range(cfg.chain);
    const chain = [];
    for (let i = 0; i < n; i++) {
      const a = m.addAtom('C', 0, 0);
      if (i) m.addBond(chain[i - 1].id, a.id, 1);
      chain.push(a);
    }

    const groups = [];
    const first = weighted(cfg.groups);
    if (first !== 'none') {
      groups.push(first);
      if (cfg.second && Math.random() < cfg.second) groups.push(pick(cfg.secondary));
    }

    const saturate = cfg.multipleOnlyInHydrocarbons && groups.length > 0;
    const mult = n >= 2 && !saturate ? weighted(cfg.multiple) : 'none';
    if (mult !== 'none') {
      const i = rand(n - 1);
      const b = m.bondBetween(chain[i].id, chain[i + 1].id);
      const order = mult === 'double' ? 2 : 3;
      if (m.canSetOrder(b, order)) b.order = order;
      // a second C=C, not sharing a carbon with the first (no allenes)
      if (order === 2 && cfg.extraDouble && Math.random() < cfg.extraDouble) {
        const free = [];
        for (let j = 0; j + 1 < n; j++) {
          if (m.bondsOf(chain[j].id).concat(m.bondsOf(chain[j + 1].id)).every(x => x.order === 1)) free.push(j);
        }
        const j = pick(free);
        if (j !== null) m.bondBetween(chain[j].id, chain[j + 1].id).order = 2;
      }
    }

    // Branches go on inner carbons only, so they stay branches.
    const count = rand(cfg.branches + 1);
    for (let k = 0; k < count; k++) {
      const ethyl = Math.random() < 0.25;
      const lo = ethyl ? 2 : 1, hi = ethyl ? n - 3 : n - 2;
      if (hi < lo) continue;
      const c = chain[lo + rand(hi - lo + 1)];
      if (m.freeValence(c.id) < 1) continue;
      let prev = c;
      for (let j = 0; j < (ethyl ? 2 : 1); j++) {
        const x = m.addAtom('C', 0, 0);
        m.addBond(prev.id, x.id, 1);
        prev = x;
      }
    }

    for (const g of groups) if (!addGroup(m, chain, g)) return null;
    return m;
  }

  function addGroup(m, chain, type) {
    const free = a => m.freeValence(a.id);
    const others = a => m.bondsOf(a.id).map(b => m.atom(b.a === a.id ? b.b : b.a));
    const saturated = a => m.bondsOf(a.id).every(b => b.order === 1);
    const hasON = a => others(a).some(o => o.el === 'O' || o.el === 'N');
    const hasHetero = a => others(a).some(o => o.el !== 'C');
    const add = (on, el, order) => {
      const x = m.addAtom(el, 0, 0);
      m.addBond(on.id, x.id, order || 1);
      return x;
    };
    const alkyl = (on, len) => {
      let prev = on;
      for (let i = 0; i < len; i++) {
        const c = m.addAtom('C', 0, 0);
        m.addBond(prev.id, c.id, 1);
        prev = c;
      }
    };
    // -OH and -NH2 only on saturated carbons (no enols or enamines)
    const plain = chain.filter(a => saturated(a) && !hasHetero(a) && free(a) >= 1);
    const ends = [chain[chain.length - 1], chain[0]];
    const terminal = () => ends.find(a => free(a) >= 3 && saturated(a) && !hasHetero(a)) || null;

    let c;
    switch (type) {
      case 'halo': {
        const k = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < k; i++) {
          c = pick(chain.filter(a => free(a) >= 1 && !hasON(a)));
          if (!c) return false;
          add(c, pick(['F', 'Cl', 'Cl', 'Br', 'Br', 'I']));
        }
        return true;
      }
      case 'alcohol':
        if (!(c = pick(plain))) return false;
        add(c, 'O');
        return true;
      case 'amine': {
        if (!(c = pick(plain))) return false;
        const N = add(c, 'N');
        if (Math.random() < 0.25) alkyl(N, 1);
        return true;
      }
      case 'ketone':
        if (!(c = pick(chain.slice(1, -1).filter(a => free(a) >= 2 && !hasHetero(a))))) return false;
        add(c, 'O', 2);
        return true;
      case 'aldehyde':
        if (!(c = terminal())) return false;
        add(c, 'O', 2);
        return true;
      case 'acid':
        if (!(c = terminal())) return false;
        add(c, 'O', 2); add(c, 'O');
        return true;
      case 'ester': {
        if (!(c = terminal())) return false;
        add(c, 'O', 2);
        alkyl(add(c, 'O'), 1 + rand(3));
        return true;
      }
      case 'amide': {
        if (!(c = terminal())) return false;
        add(c, 'O', 2);
        const N = add(c, 'N');
        if (Math.random() < 0.3) alkyl(N, 1);
        return true;
      }
    }
    return false;
  }

  // Returns { mol, name } or null. `avoid` is a list of recent names.
  OB.randomMolecule = function (stage, avoid) {
    const cfg = OB.PRACTICE[stage];
    for (let tries = 0; tries < 400; tries++) {
      const m = attempt(cfg);
      if (!m) continue;
      const r = OB.nameMolecule(m);
      if (r.status !== 'named') continue;
      if (/[()]|ylidene|enyl|ynyl|an-\d+-yl/.test(r.name)) continue;
      if (r.chain.length > cfg.maxParent) continue;
      if (avoid && avoid.includes(r.name) && tries < 300) continue;
      OB.layout2D(m, 0, 0);
      return { mol: m, name: r.name };
    }
    return null;
  };
})();
