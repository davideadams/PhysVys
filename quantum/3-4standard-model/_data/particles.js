// Standard Model particle data for Subtopic 3.4 sims.
//
// Single source of truth for the Decay Checker, Hadron Builder, Cloud Chamber
// ID, and Four Forces sims. Numbers are PDG 2024 central values; quark current
// masses (MS-bar at 2 GeV for u/d/s, pole-ish for c/b/t) are used because they
// are what students will see in textbooks, but they are *not* additive to
// hadron masses (binding energy dominates) -- always read a hadron's mass off
// HADRONS, never sum its quark masses.
//
// Charges are in units of e. Mass in MeV/c^2. Mean lifetime in seconds
// (null = stable on lab timescales). Spin in units of hbar.
//
// Antiparticle quantum numbers are derived (charge, baryon, lepton numbers,
// flavour numbers all flip sign), but we materialise every antiparticle as its
// own entry so palette UIs and decay dictionaries can address them by id.

// ---- Quarks ---------------------------------------------------------------

const QUARK_BASE = [
  { id: 'u', display: 'u',  name: 'up',      charge:  2/3, mass: 2.16,     generation: 1, I3:  1/2, S: 0, C: 0, Bn: 0, T: 0 },
  { id: 'd', display: 'd',  name: 'down',    charge: -1/3, mass: 4.67,     generation: 1, I3: -1/2, S: 0, C: 0, Bn: 0, T: 0 },
  { id: 's', display: 's',  name: 'strange', charge: -1/3, mass: 93.4,     generation: 2, I3:  0,   S:-1, C: 0, Bn: 0, T: 0 },
  { id: 'c', display: 'c',  name: 'charm',   charge:  2/3, mass: 1270,     generation: 2, I3:  0,   S: 0, C: 1, Bn: 0, T: 0 },
  { id: 'b', display: 'b',  name: 'bottom',  charge: -1/3, mass: 4180,     generation: 3, I3:  0,   S: 0, C: 0, Bn:-1, T: 0 },
  { id: 't', display: 't',  name: 'top',     charge:  2/3, mass: 172570,   generation: 3, I3:  0,   S: 0, C: 0, Bn: 0, T: 1 },
];

// Top decays via the weak interaction (t -> W+b) before it can hadronise,
// so HADRONS contains no top-quark states by design.

const QUARKS = {};
for (const q of QUARK_BASE) {
  QUARKS[q.id] = {
    kind: 'quark',
    ...q,
    baryon: 1/3,
    spin: 1/2,
    Le: 0, Lmu: 0, Ltau: 0,
    antiparticle: q.id + 'bar',
  };
  QUARKS[q.id + 'bar'] = {
    kind: 'quark',
    id: q.id + 'bar',
    display: q.display + 'Ì„', // combining overline
    name: 'anti-' + q.name,
    charge: -q.charge,
    mass: q.mass,
    generation: q.generation,
    I3: -q.I3, S: -q.S, C: -q.C, Bn: -q.Bn, T: -q.T,
    baryon: -1/3,
    spin: 1/2,
    Le: 0, Lmu: 0, Ltau: 0,
    antiparticle: q.id,
  };
}

// ---- Leptons --------------------------------------------------------------

// Neutrino masses are non-zero (oscillations require it) but the absolute
// scale is sub-eV and irrelevant at Stage 2 -- treat as 0 for Q-value checks.

const LEPTON_BASE = [
  { id: 'e-',    display: 'eâ»',          name: 'electron',         charge: -1, mass: 0.51099895, generation: 1, family: 'e',   neutrino: false },
  { id: 'nu_e',  display: 'Î½â‚‘',     name: 'electron neutrino',charge:  0, mass: 0,          generation: 1, family: 'e',   neutrino: true  },
  { id: 'mu-',   display: 'Î¼â»',     name: 'muon',             charge: -1, mass: 105.6583755,generation: 2, family: 'mu',  neutrino: false },
  { id: 'nu_mu', display: 'Î½_Î¼',    name: 'muon neutrino',    charge:  0, mass: 0,          generation: 2, family: 'mu',  neutrino: true  },
  { id: 'tau-',  display: 'Ï„â»',     name: 'tau',              charge: -1, mass: 1776.86,    generation: 3, family: 'tau', neutrino: false },
  { id: 'nu_tau',display: 'Î½_Ï„',    name: 'tau neutrino',     charge:  0, mass: 0,          generation: 3, family: 'tau', neutrino: true  },
];

const LEPTON_FAMILY_FLAGS = { e: 'Le', mu: 'Lmu', tau: 'Ltau' };

function antiLeptonId(id) {
  if (id.endsWith('-'))   return id.slice(0, -1) + '+';
  if (id.startsWith('nu_')) return id + '_bar';
  throw new Error('antiLeptonId: ' + id);
}

function antiLeptonDisplay(p) {
  if (p.neutrino) return 'Î½Ì„' + p.display.slice(1); // bar over nu
  return p.display.replace('â»', 'âº'); // - to +
}

const LEPTONS = {};
for (const l of LEPTON_BASE) {
  const flag = LEPTON_FAMILY_FLAGS[l.family];
  const base = {
    kind: 'lepton',
    ...l,
    baryon: 0,
    spin: 1/2,
    Le: 0, Lmu: 0, Ltau: 0,
    antiparticle: antiLeptonId(l.id),
  };
  base[flag] = 1;
  LEPTONS[l.id] = base;

  const anti = {
    kind: 'lepton',
    id: antiLeptonId(l.id),
    display: antiLeptonDisplay(l),
    name: 'anti-' + l.name,
    charge: -l.charge,
    mass: l.mass,
    generation: l.generation,
    family: l.family,
    neutrino: l.neutrino,
    baryon: 0,
    spin: 1/2,
    Le: 0, Lmu: 0, Ltau: 0,
    antiparticle: l.id,
  };
  anti[flag] = -1;
  LEPTONS[anti.id] = anti;
}

// ---- Gauge bosons (and graviton) -----------------------------------------

// The graviton is flagged inStandardModel: false. We include it because Stage 2
// students are taught "four fundamental forces" and the Four Forces sim has a
// Gravity mode; consumers can filter on the flag if they need SM-only.

const BOSONS = {
  'photon': {
    kind: 'boson', id: 'photon', display: 'Î³', name: 'photon',
    charge: 0, mass: 0, spin: 1,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'electromagnetic',
    range: Infinity,
    antiparticle: 'photon', // self-conjugate
    inStandardModel: true,
  },
  'W+': {
    kind: 'boson', id: 'W+', display: 'Wâº', name: 'W boson (+)',
    charge: +1, mass: 80369.2, spin: 1,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'weak',
    range: 2.5e-18, // metres, ~ hbar c / M_W c^2
    antiparticle: 'W-',
    inStandardModel: true,
  },
  'W-': {
    kind: 'boson', id: 'W-', display: 'Wâ»', name: 'W boson (-)',
    charge: -1, mass: 80369.2, spin: 1,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'weak',
    range: 2.5e-18,
    antiparticle: 'W+',
    inStandardModel: true,
  },
  'Z0': {
    kind: 'boson', id: 'Z0', display: 'Zâ°', name: 'Z boson',
    charge: 0, mass: 91188.0, spin: 1,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'weak',
    range: 2.2e-18,
    antiparticle: 'Z0',
    inStandardModel: true,
  },
  'gluon': {
    kind: 'boson', id: 'gluon', display: 'g', name: 'gluon',
    charge: 0, mass: 0, spin: 1,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'strong',
    // Range is formally infinite (massless) but colour confinement caps the
    // effective range at ~1 fm; consumers should display "~1 fm (confined)".
    range: 1e-15,
    antiparticle: 'gluon',
    inStandardModel: true,
  },
  'higgs': {
    kind: 'boson', id: 'higgs', display: 'Hâ°', name: 'Higgs boson',
    charge: 0, mass: 125250, spin: 0,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: null,
    range: 2e-18,
    antiparticle: 'higgs',
    inStandardModel: true,
  },
  'graviton': {
    kind: 'boson', id: 'graviton', display: 'G', name: 'graviton (predicted)',
    charge: 0, mass: 0, spin: 2,
    baryon: 0, Le: 0, Lmu: 0, Ltau: 0,
    mediates: 'gravity',
    range: Infinity,
    antiparticle: 'graviton',
    inStandardModel: false,
  },
};

// ---- Hadrons --------------------------------------------------------------

// Each hadron's `content` is the canonical sorted list of constituent quark
// ids (anti's included). The HADRON_INDEX below maps canonical-content keys
// to arrays of hadrons; multiple hadrons can share content (Lambda and Sigma0
// are both uds; pi0/eta/eta' all live in the u-ubar / d-dbar mixing).

const HADRON_BASE = [
  // Light mesons (u,d) -------------------------------------------------------
  { id: 'pi+',    display: 'Ï€âº', name: 'pion (+)',  content: ['u','dbar'], spin: 0, mass: 139.57039, lifetime: 2.6033e-8,  decays: [{ products: ['mu+','nu_mu'], br: 0.9999 }] },
  { id: 'pi-',    display: 'Ï€â»', name: 'pion (-)',  content: ['d','ubar'], spin: 0, mass: 139.57039, lifetime: 2.6033e-8,  decays: [{ products: ['mu-','nu_mu_bar'], br: 0.9999 }] },
  { id: 'pi0',    display: 'Ï€â°', name: 'pion (0)',  content: ['u','ubar'], spin: 0, mass: 134.9768,  lifetime: 8.43e-17,   decays: [{ products: ['photon','photon'], br: 0.988 }], mixingNote: 'u-ubar / d-dbar superposition' },
  { id: 'eta',    display: 'Î·',       name: 'eta',       content: ['u','ubar'], spin: 0, mass: 547.862,   lifetime: 5.06e-19,   decays: [{ products: ['photon','photon'], br: 0.394 }], mixingNote: 'u-ubar / d-dbar / s-sbar octet mix' },
  { id: 'eta_prime', display: "Î·'",   name: "eta'",      content: ['s','sbar'], spin: 0, mass: 957.78,    lifetime: 3.4e-21,    decays: [{ products: ['pi+','pi-','eta'], br: 0.426 }], mixingNote: 'u-ubar / d-dbar / s-sbar singlet mix' },
  { id: 'rho+',   display: 'Ïâº',name: 'rho (+)',    content: ['u','dbar'], spin: 1, mass: 775.26,    lifetime: 4.5e-24,    decays: [{ products: ['pi+','pi0'], br: 1.0 }] },
  { id: 'rho0',   display: 'Ïâ°',name: 'rho (0)',    content: ['u','ubar'], spin: 1, mass: 775.26,    lifetime: 4.5e-24,    decays: [{ products: ['pi+','pi-'], br: 1.0 }] },
  { id: 'omega',  display: 'Ï‰',      name: 'omega',      content: ['u','ubar'], spin: 1, mass: 782.66,    lifetime: 7.75e-23,   decays: [{ products: ['pi+','pi-','pi0'], br: 0.892 }] },

  // Strange mesons -----------------------------------------------------------
  { id: 'K+',     display: 'Kâº',     name: 'kaon (+)',   content: ['u','sbar'], spin: 0, mass: 493.677,   lifetime: 1.238e-8,   decays: [{ products: ['mu+','nu_mu'], br: 0.636 }, { products: ['pi+','pi0'], br: 0.207 }] },
  { id: 'K-',     display: 'Kâ»',     name: 'kaon (-)',   content: ['s','ubar'], spin: 0, mass: 493.677,   lifetime: 1.238e-8,   decays: [{ products: ['mu-','nu_mu_bar'], br: 0.636 }] },
  { id: 'K0',     display: 'Kâ°',     name: 'kaon (0)',   content: ['d','sbar'], spin: 0, mass: 497.611,   lifetime: null,       decays: [], mixingNote: 'physical states are K_S (8.95e-11 s) and K_L (5.12e-8 s)' },
  { id: 'K0bar',  display: 'KÌ„â°',name:'anti-kaon (0)',content:['s','dbar'], spin: 0, mass: 497.611,   lifetime: null,       decays: [], mixingNote: 'mixes with K0 to form K_S, K_L mass eigenstates' },
  { id: 'phi',    display: 'Ï†',      name: 'phi',        content: ['s','sbar'], spin: 1, mass: 1019.461,  lifetime: 1.55e-22,   decays: [{ products: ['K+','K-'], br: 0.492 }] },

  // Charm mesons -------------------------------------------------------------
  { id: 'D+',     display: 'Dâº',     name: 'D (+)',      content: ['c','dbar'], spin: 0, mass: 1869.66,   lifetime: 1.040e-12,  decays: [{ products: ['K-','pi+','pi+'], br: 0.094 }] },
  { id: 'D-',     display: 'Dâ»',     name: 'D (-)',      content: ['d','cbar'], spin: 0, mass: 1869.66,   lifetime: 1.040e-12,  decays: [] },
  { id: 'D0',     display: 'Dâ°',     name: 'D (0)',      content: ['c','ubar'], spin: 0, mass: 1864.84,   lifetime: 4.10e-13,   decays: [{ products: ['K-','pi+'], br: 0.0395 }] },
  { id: 'D0bar',  display: 'DÌ„â°',name:'anti-D (0)', content: ['u','cbar'], spin: 0, mass: 1864.84,   lifetime: 4.10e-13,   decays: [] },
  { id: 'Ds+',    display: 'Dâ‚›âº',name:'D_s (+)',    content: ['c','sbar'], spin: 0, mass: 1968.35,   lifetime: 5.04e-13,   decays: [] },
  { id: 'Ds-',    display: 'Dâ‚›â»',name:'D_s (-)',    content: ['s','cbar'], spin: 0, mass: 1968.35,   lifetime: 5.04e-13,   decays: [] },
  { id: 'Jpsi',   display: 'J/Ïˆ',    name: 'J/psi',      content: ['c','cbar'], spin: 1, mass: 3096.900,  lifetime: 7.09e-21,   decays: [] },

  // Bottom mesons ------------------------------------------------------------
  { id: 'B+',     display: 'Bâº',     name: 'B (+)',      content: ['u','bbar'], spin: 0, mass: 5279.34,   lifetime: 1.638e-12,  decays: [] },
  { id: 'B-',     display: 'Bâ»',     name: 'B (-)',      content: ['b','ubar'], spin: 0, mass: 5279.34,   lifetime: 1.638e-12,  decays: [] },
  { id: 'B0',     display: 'Bâ°',     name: 'B (0)',      content: ['d','bbar'], spin: 0, mass: 5279.65,   lifetime: 1.519e-12,  decays: [] },
  { id: 'B0bar',  display: 'BÌ„â°',name:'anti-B (0)', content: ['b','dbar'], spin: 0, mass: 5279.65,   lifetime: 1.519e-12,  decays: [] },
  { id: 'Upsilon',display: 'Î¥',      name: 'Upsilon',    content: ['b','bbar'], spin: 1, mass: 9460.30,   lifetime: 1.22e-20,   decays: [] },

  // Light baryons (u, d) ----------------------------------------------------
  { id: 'p',      display: 'p',           name: 'proton',     content: ['u','u','d'], spin: 1/2, mass: 938.27208816, lifetime: null,        decays: [] },
  { id: 'n',      display: 'n',           name: 'neutron',    content: ['u','d','d'], spin: 1/2, mass: 939.56542052, lifetime: 878.4,       decays: [{ products: ['p','e-','nu_e_bar'], br: 1.0 }] },
  { id: 'pbar',   display: 'pÌ„',     name: 'antiproton', content: ['ubar','ubar','dbar'], spin: 1/2, mass: 938.27208816, lifetime: null, decays: [] },
  { id: 'nbar',   display: 'nÌ„',     name: 'antineutron',content: ['ubar','dbar','dbar'], spin: 1/2, mass: 939.56542052, lifetime: 878.4, decays: [{ products: ['pbar','e+','nu_e'], br: 1.0 }] },
  { id: 'Delta++',display: 'Î”âºâº',name:'Delta (++)',content:['u','u','u'], spin: 3/2, mass: 1232, lifetime: 5.6e-24, decays: [{ products: ['p','pi+'], br: 1.0 }] },
  { id: 'Delta+', display: 'Î”âº',name: 'Delta (+)',  content: ['u','u','d'], spin: 3/2, mass: 1232,        lifetime: 5.6e-24,    decays: [{ products: ['p','pi0'], br: 0.667 }] },
  { id: 'Delta0', display: 'Î”â°',name: 'Delta (0)',  content: ['u','d','d'], spin: 3/2, mass: 1232,        lifetime: 5.6e-24,    decays: [{ products: ['n','pi0'], br: 0.667 }] },
  { id: 'Delta-', display: 'Î”â»',name: 'Delta (-)',  content: ['d','d','d'], spin: 3/2, mass: 1232,        lifetime: 5.6e-24,    decays: [{ products: ['n','pi-'], br: 1.0 }] },

  // Strange baryons ---------------------------------------------------------
  { id: 'Lambda', display: 'Î›',      name: 'Lambda',     content: ['u','d','s'], spin: 1/2, mass: 1115.683,    lifetime: 2.617e-10,  decays: [{ products: ['p','pi-'], br: 0.639 }, { products: ['n','pi0'], br: 0.358 }] },
  { id: 'Sigma+', display: 'Î£âº',name: 'Sigma (+)',  content: ['u','u','s'], spin: 1/2, mass: 1189.37,     lifetime: 8.018e-11,  decays: [{ products: ['p','pi0'], br: 0.519 }, { products: ['n','pi+'], br: 0.483 }] },
  { id: 'Sigma0', display: 'Î£â°',name: 'Sigma (0)',  content: ['u','d','s'], spin: 1/2, mass: 1192.642,    lifetime: 7.4e-20,    decays: [{ products: ['Lambda','photon'], br: 1.0 }] },
  { id: 'Sigma-', display: 'Î£â»',name: 'Sigma (-)',  content: ['d','d','s'], spin: 1/2, mass: 1197.449,    lifetime: 1.479e-10,  decays: [{ products: ['n','pi-'], br: 0.999 }] },
  { id: 'Xi0',    display: 'Îžâ°',name: 'Xi (0)',     content: ['u','s','s'], spin: 1/2, mass: 1314.86,     lifetime: 2.90e-10,   decays: [{ products: ['Lambda','pi0'], br: 0.995 }] },
  { id: 'Xi-',    display: 'Îžâ»',name: 'Xi (-)',     content: ['d','s','s'], spin: 1/2, mass: 1321.71,     lifetime: 1.639e-10,  decays: [{ products: ['Lambda','pi-'], br: 0.999 }] },
  { id: 'Omega-', display: 'Î©â»',name: 'Omega (-)',  content: ['s','s','s'], spin: 3/2, mass: 1672.45,     lifetime: 8.21e-11,   decays: [{ products: ['Lambda','K-'], br: 0.678 }, { products: ['Xi0','pi-'], br: 0.236 }] },

  // Charm baryons (one each, for completeness) -------------------------------
  { id: 'Lambda_c+', display:'Î›â‚œâº', name:'Lambda_c (+)', content:['u','d','c'], spin: 1/2, mass: 2286.46, lifetime: 2.024e-13, decays: [] },
];

// Build a quick lookup keyed by canonical content string. Multiple hadrons may
// share content (Lambda/Sigma0; pi0/eta both u-ubar) -- the index holds an
// array.

function canonicalContent(quarkIds) {
  return [...quarkIds].sort().join('+');
}

const HADRONS = {};
const HADRON_INDEX = {};
for (const h of HADRON_BASE) {
  HADRONS[h.id] = {
    kind: h.content.length === 2 ? 'meson' : 'baryon',
    ...h,
    charge: h.content.reduce((s, q) => s + QUARKS[q].charge, 0),
    baryon: h.content.reduce((s, q) => s + QUARKS[q].baryon, 0),
    strangeness: h.content.reduce((s, q) => s + QUARKS[q].S, 0),
    charm:       h.content.reduce((s, q) => s + QUARKS[q].C, 0),
    bottomness:  h.content.reduce((s, q) => s + QUARKS[q].Bn, 0),
    Le: 0, Lmu: 0, Ltau: 0,
  };
  const key = canonicalContent(h.content);
  (HADRON_INDEX[key] ||= []).push(HADRONS[h.id]);
}

// Round any near-zero numerical-noise charge to exact 0 (e.g. 2/3 - 1/3 - 1/3
// = 5.55e-17 in IEEE-754). Run once after the fact rather than threading the
// rounding through every accumulator.
for (const id in HADRONS) {
  if (Math.abs(HADRONS[id].charge) < 1e-9) HADRONS[id].charge = 0;
  if (Math.abs(HADRONS[id].baryon) < 1e-9) HADRONS[id].baryon = 0;
}

// ---- Unified lookup -------------------------------------------------------

const ALL_PARTICLES = { ...QUARKS, ...LEPTONS, ...BOSONS, ...HADRONS };

function getParticle(id) {
  const p = ALL_PARTICLES[id];
  if (!p) throw new Error('Unknown particle id: ' + id);
  return p;
}

function antiOf(id) {
  return getParticle(id).antiparticle;
}

// Look up hadrons by quark content. Returns [] for combinations that don't
// correspond to any catalogued hadron -- consumers can treat that as
// "no known particle with this content" rather than "invalid".
function findHadrons(quarkIds) {
  return HADRON_INDEX[canonicalContent(quarkIds)] || [];
}

// ---- Conservation-law totals ---------------------------------------------

// Sum the quantum numbers across a list of particle ids. Used by Decay
// Checker on both sides of a reaction; the verdict is `lhs === rhs` per row.
// Charge / baryon are summed exactly; lepton-flavour numbers are summed per
// family. Energy is the rest-mass sum (Q-value = lhs - rhs; reaction allowed
// if Q >= 0, since extra mass converts to kinetic energy of the products).

function totals(particleIds) {
  const t = { charge: 0, baryon: 0, Le: 0, Lmu: 0, Ltau: 0, mass: 0 };
  for (const id of particleIds) {
    const p = getParticle(id);
    t.charge += p.charge;
    t.baryon += p.baryon || 0;
    t.Le     += p.Le || 0;
    t.Lmu    += p.Lmu || 0;
    t.Ltau   += p.Ltau || 0;
    t.mass   += p.mass;
  }
  // Same anti-noise cleanup as in the hadron loop.
  if (Math.abs(t.charge) < 1e-9) t.charge = 0;
  if (Math.abs(t.baryon) < 1e-9) t.baryon = 0;
  return t;
}

// Conservation verdict for a reaction LHS -> RHS. Returns one row per checked
// quantity with {label, lhs, rhs, ok}. Energy uses Q = lhs.mass - rhs.mass and
// is "ok" iff Q >= 0 (initial rest mass must cover final rest mass).
function checkReaction(lhsIds, rhsIds) {
  const L = totals(lhsIds);
  const R = totals(rhsIds);
  const Q = L.mass - R.mass;
  return [
    { label: 'Charge',          lhs: L.charge, rhs: R.charge, ok: L.charge === R.charge },
    { label: 'Baryon number',   lhs: L.baryon, rhs: R.baryon, ok: L.baryon === R.baryon },
    { label: 'Lepton # (e)',    lhs: L.Le,     rhs: R.Le,     ok: L.Le     === R.Le },
    { label: 'Lepton # (Î¼)',lhs: L.Lmu,   rhs: R.Lmu,    ok: L.Lmu    === R.Lmu },
    { label: 'Lepton # (Ï„)',lhs: L.Ltau,  rhs: R.Ltau,   ok: L.Ltau   === R.Ltau },
    { label: 'Energy (Q â‰¥ 0)', lhs: L.mass.toFixed(3) + ' MeV', rhs: R.mass.toFixed(3) + ' MeV', ok: Q >= -1e-6, Q },
  ];
}

// ---- Curated decays for the Decay Checker --------------------------------

// Mix of correct decays and deliberately-broken siblings. The `broken` field
// flags which conservation row the student should land on once they spot the
// problem; `fix` suggests one swap that repairs the decay (used by Fix-it
// mode to highlight the slot to perturb). Free-build mode ignores this list.

// SACE Stage 2 scope: reactions here may only use particles whose 5 conserved
// quantum numbers (Q, B, Lₑ, Lμ, Lτ) students are expected to know — quarks,
// leptons, gauge bosons, plus the proton and neutron. Hadrons beyond p/n
// (pions, kaons, hyperons) sit outside the syllabus and are excluded.
const CURATED_DECAYS = [
  { id: 'beta-minus',       lhs: ['n'],       rhs: ['p','e-','nu_e_bar'],   broken: null,    note: 'Free-neutron beta-minus decay.' },
  { id: 'beta-minus-bad-nu',lhs: ['n'],       rhs: ['p','e-','nu_e'],       broken: 'Le',    fix: { slot: 2, to: 'nu_e_bar' }, note: 'Wrong neutrino: must be antineutrino to balance Le.' },
  { id: 'beta-minus-bad-q', lhs: ['n'],       rhs: ['p','e-','e+'],         broken: 'charge',fix: { slot: 2, to: 'nu_e_bar' }, note: 'Looks like β⁻, but a positron in place of the antineutrino throws off the charge balance.' },
  { id: 'beta-plus',        lhs: ['p'],       rhs: ['n','e+','nu_e'],       broken: null,    note: 'Conserves all 5 QNs (forbidden in vacuum by energy, but that is outside the 5-QN check).' },
  { id: 'muon-decay',       lhs: ['mu-'],     rhs: ['e-','nu_e_bar','nu_mu'],broken: null,   note: 'Canonical muon decay.' },
  { id: 'muon-decay-bad',   lhs: ['mu-'],     rhs: ['e-','nu_e','nu_mu_bar'],broken: 'Le',   fix: { slot: 1, to: 'nu_e_bar' }, note: 'Lepton-flavour numbers must each balance.' },
  { id: 'pair-annihilation',lhs: ['e-','e+'], rhs: ['photon','photon'],     broken: null,    note: 'Electron–positron annihilation into two photons (two are needed to conserve momentum).' },
  { id: 'proton-decay',     lhs: ['p'],       rhs: ['e+','nu_e'],           broken: 'baryon',fix: null, note: 'Hypothetical proton decay into leptons — baryon number not conserved.' },
];

// ---- Force / boson summary for the Four Forces sim -----------------------

// Couplings are dimensionless (alpha-like) at low energy; weak/gravity are
// notoriously scheme-dependent so these are textbook-style order-of-magnitude
// figures, fine for a "relative strength" bar chart, not for calculation.

const FORCES = {
  electromagnetic: {
    label: 'Electromagnetic',
    bosons: ['photon'],
    couplesTo: 'electric charge',
    rangeNote: 'infinite (1/rÂ² falloff)',
    coupling: 1/137,
    relativeStrength: 1e-2,
    feltBy: 'all charged particles',
    mechanismHint: 'Two charged particles exchange a virtual photon.',
  },
  weak: {
    label: 'Weak',
    bosons: ['W+','W-','Z0'],
    couplesTo: 'weak isospin / flavour',
    rangeNote: '~10â»Â¹â¸ m (short, because W and Z are heavy)',
    coupling: 1e-6,
    relativeStrength: 1e-6,
    feltBy: 'all fermions',
    mechanismHint: 'Charged-current: a quark or lepton emits a virtual W and changes flavour.',
  },
  strong: {
    label: 'Strong',
    bosons: ['gluon'],
    couplesTo: 'colour charge',
    rangeNote: '~1 fm (confinement; force does *not* fall off until then)',
    coupling: 1,
    relativeStrength: 1,
    feltBy: 'quarks and gluons',
    mechanismHint: 'Two quarks swap a gluon; gluons carry colour, so the quarksâ€™ colours swap at the vertices.',
  },
  gravity: {
    label: 'Gravity',
    bosons: ['graviton'],
    couplesTo: 'energy-momentum (mass)',
    rangeNote: 'infinite (1/rÂ² falloff)',
    coupling: 1e-39,
    relativeStrength: 1e-39,
    feltBy: 'everything with energy',
    mechanismHint: 'Predicted exchange of spin-2 gravitons; not yet observed and not part of the Standard Model.',
    inStandardModel: false,
  },
};

// ---- Global export (plain-script / file:// compatible) ------------------
window.SM = { QUARKS, LEPTONS, BOSONS, HADRONS, ALL_PARTICLES, FORCES, CURATED_DECAYS, getParticle, antiOf, findHadrons, canonicalContent, totals, checkReaction };

