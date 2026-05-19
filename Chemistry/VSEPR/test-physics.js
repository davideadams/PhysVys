// Headless VSEPR physics verification.
// Run with: node test-physics.js
// Mirrors the physics in script.js so we can tune REPULSION_POWER / DOMAIN_WEIGHT
// against the 12 test cases without touching the browser.

// ---- Tunable parameters ----
const REPULSION_POWER = 3;
const DAMPING         = 0.85;
const PHYS_DT         = 0.05;
const PHYS_STEPS_MAX  = 1200;
const PHYS_EPSILON    = 1e-5;
const INIT_PERTURBATION = 0.35;  // tangential noise applied to ideal start
const CHORD_FLOOR     = 0.1;
const DOMAIN_WEIGHT = {
  lone_pair: 1.3,
  bond1:     1.0,
  bond2:     1.3,
  bond3:     1.5,
};

// ---- Vector3 helpers ----
const V = (x, y, z) => ({ x, y, z });
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => V(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = a => Math.sqrt(dot(a, a));
const norm = a => { const l = len(a) || 1; return scale(a, 1 / l); };
const addScaled = (a, b, s) => V(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

function randomUnit() {
  while (true) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const ls = x * x + y * y + z * z;
    if (ls > 0.001 && ls <= 1) {
      const l = Math.sqrt(ls);
      return V(x / l, y / l, z / l);
    }
  }
}

function domainWeight(d) {
  if (d.type === 'lone_pair') return DOMAIN_WEIGHT.lone_pair;
  return DOMAIN_WEIGHT[`bond${d.bondOrder}`] || 1.0;
}

// ---- Physics step ----
function physicsStep(domains) {
  const forces = domains.map(() => V(0, 0, 0));
  for (let i = 0; i < domains.length; i++) {
    const di = domains[i];
    const wi = domainWeight(di);
    for (let j = 0; j < domains.length; j++) {
      if (i === j) continue;
      const dj = domains[j];
      const wj = domainWeight(dj);
      let chord = sub(di.direction, dj.direction);
      let r = len(chord);
      if (r < 1e-6) {
        chord = scale(randomUnit(), 0.001);
        r = 1;
      }
      const rEff = Math.max(r, CHORD_FLOOR);
      const fmag = (wi * wj) / Math.pow(rEff, REPULSION_POWER);
      const fdir = scale(chord, 1 / r);
      forces[i] = addScaled(forces[i], fdir, fmag);
    }
  }
  let maxVel = 0;
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const dotFD = dot(forces[i], d.direction);
    const fTan = addScaled(forces[i], d.direction, -dotFD);
    d.velocity = addScaled(scale(d.velocity, DAMPING), fTan, PHYS_DT);
    d.direction = norm(addScaled(d.direction, d.velocity, PHYS_DT));
    const v = len(d.velocity);
    if (v > maxVel) maxVel = v;
  }
  return maxVel;
}

function relax(domains) {
  for (let step = 0; step < PHYS_STEPS_MAX; step++) {
    const v = physicsStep(domains);
    if (v < PHYS_EPSILON && step > 80) return step;
  }
  return PHYS_STEPS_MAX;
}

function angleBetween(a, b) {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  return (Math.acos(d) * 180) / Math.PI;
}

// ---- Presets ----
const PRESETS = {
  CO2:  [['bond', 2, 'O'], ['bond', 2, 'O']],
  BF3:  [['bond', 1, 'F'], ['bond', 1, 'F'], ['bond', 1, 'F']],
  CH4:  Array(4).fill(['bond', 1, 'H']),
  NH3:  [['bond', 1, 'H'], ['bond', 1, 'H'], ['bond', 1, 'H'], ['lone_pair']],
  H2O:  [['bond', 1, 'H'], ['bond', 1, 'H'], ['lone_pair'], ['lone_pair']],
  PCl5: Array(5).fill(['bond', 1, 'Cl']),
  SF4:  [...Array(4).fill(['bond', 1, 'F']), ['lone_pair']],
  ClF3: [...Array(3).fill(['bond', 1, 'F']), ['lone_pair'], ['lone_pair']],
  XeF2: [['bond', 1, 'F'], ['bond', 1, 'F'], ['lone_pair'], ['lone_pair'], ['lone_pair']],
  SF6:  Array(6).fill(['bond', 1, 'F']),
  BrF5: [...Array(5).fill(['bond', 1, 'F']), ['lone_pair']],
  XeF4: [...Array(4).fill(['bond', 1, 'F']), ['lone_pair'], ['lone_pair']],
};

const EXPECTED = {
  CO2:  'Linear, B-B = 180',
  BF3:  'Trigonal planar, all B-B = 120',
  CH4:  'Tetrahedral, all B-B = 109.5',
  NH3:  'Trig pyramidal, B-B ~ 107 (compressed from 109.5)',
  H2O:  'Bent, B-B ~ 104.5',
  PCl5: 'TBP: B-B = {180, 120x3, 90x6}',
  SF4:  'Seesaw - LP equatorial. B-B = {ax-ax ~173, eq-eq ~102, ax-eq x4 ~88}',
  ClF3: 'T-shaped - both LPs equatorial. B-B = {ax-ax ~175, eq-ax x2 ~88}',
  XeF2: 'Linear F-Xe-F = 180, all 3 LPs equatorial',
  SF6:  'Octahedral, B-B = {180x3, 90x12}',
  BrF5: 'Square pyramidal, LP at one octahedral vertex',
  XeF4: 'Square planar, LPs opposite, B-B = {180x2, 90x4}',
};

// Idealised vertex sets for n=2..6.
// Positions are ordered so that, when domains are sorted heaviest-first and
// assigned in order, lone pairs end up at the chemically-correct positions:
//   - TBP (5):  equatorial positions FIRST, axial last (LPs prefer equatorial).
//   - Octahedral (6): trans pairs adjacent, so multiple LPs land at trans vertices.
const IDEAL = {
  2: [[0, 0, 1], [0, 0, -1]],
  3: [[1, 0, 0], [-0.5, 0.8660254, 0], [-0.5, -0.8660254, 0]],
  4: (() => {
    const s = 1 / Math.sqrt(3);
    return [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]];
  })(),
  5: [
    [1, 0, 0], [-0.5, 0.8660254, 0], [-0.5, -0.8660254, 0], // 3 equatorial
    [0, 0, 1], [0, 0, -1],                                  // 2 axial
  ],
  6: [
    [0, 0, 1], [0, 0, -1],   // trans pair 1
    [1, 0, 0], [-1, 0, 0],   // trans pair 2
    [0, 1, 0], [0, -1, 0],   // trans pair 3
  ],
};

function rotateVector(v, axis, angle) {
  // Rodrigues' rotation formula.
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  const { x, y, z } = v;
  const ux = axis.x, uy = axis.y, uz = axis.z;
  return V(
    x * (c + ux * ux * k)        + y * (ux * uy * k - uz * s) + z * (ux * uz * k + uy * s),
    x * (uy * ux * k + uz * s)   + y * (c + uy * uy * k)      + z * (uy * uz * k - ux * s),
    x * (uz * ux * k - uy * s)   + y * (uz * uy * k + ux * s) + z * (c + uz * uz * k)
  );
}

function buildDomains(specs) {
  const n = specs.length;
  const ideal = IDEAL[n];
  // Indices sorted heaviest-first so heaviest domain takes IDEAL[0].
  const specWeight = (spec) => {
    const [type, order] = spec;
    if (type === 'lone_pair') return DOMAIN_WEIGHT.lone_pair;
    return DOMAIN_WEIGHT[`bond${order}`] || 1.0;
  };
  const order = specs.map((s, i) => ({ i, w: specWeight(s) }))
                     .sort((a, b) => b.w - a.w);

  const domains = new Array(n);
  for (let k = 0; k < n; k++) {
    const [type, bondOrder, term] = specs[order[k].i];
    const base = ideal[k];
    const p = V(
      base[0] + (Math.random() - 0.5) * INIT_PERTURBATION,
      base[1] + (Math.random() - 0.5) * INIT_PERTURBATION,
      base[2] + (Math.random() - 0.5) * INIT_PERTURBATION,
    );
    domains[order[k].i] = {
      type,
      bondOrder: bondOrder || 1,
      terminalElement: term || null,
      direction: norm(p),
      velocity: V(0, 0, 0),
    };
  }

  // Random rotation so the molecule's absolute orientation varies between trials.
  const rotAxis = randomUnit();
  const rotAngle = Math.random() * Math.PI * 2;
  for (const d of domains) {
    d.direction = rotateVector(d.direction, rotAxis, rotAngle);
  }
  return domains;
}

function classifyDomain(domain, others) {
  // Returns array of bond/LP-angle pairs sorted ascending.
  return others
    .filter(d => d !== domain)
    .map(d => ({
      type: d.type,
      angle: angleBetween(domain.direction, d.direction),
    }))
    .sort((a, b) => a.angle - b.angle);
}

function categorise(name, domains) {
  // For SF4/BrF5/ClF3/XeF2/XeF4: report LP environment.
  const lps = domains.filter(d => d.type === 'lone_pair');
  if (lps.length === 0) return '';
  const reports = lps.map((lp, i) => {
    const neighbours = classifyDomain(lp, domains).map(n => n.angle.toFixed(1)).join(', ');
    return `LP${i + 1} neighbours: [${neighbours}]`;
  });
  return reports.join('\n  ');
}

function fmt(n) { return n.toFixed(1).padStart(6); }

function runTrial(name) {
  const domains = buildDomains(PRESETS[name]);
  const steps = relax(domains);
  const angles = [];
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      angles.push({
        ti: domains[i].type === 'bond' ? 'B' : 'L',
        tj: domains[j].type === 'bond' ? 'B' : 'L',
        angle: angleBetween(domains[i].direction, domains[j].direction),
      });
    }
  }
  return { steps, angles, domains };
}

function reportPreset(name, trials) {
  const trial = trials[0];
  const bb = trial.angles.filter(a => a.ti === 'B' && a.tj === 'B').map(a => a.angle).sort((a, b) => a - b);
  const lb = trial.angles.filter(a => (a.ti === 'B' && a.tj === 'L') || (a.ti === 'L' && a.tj === 'B')).map(a => a.angle).sort((a, b) => a - b);
  const ll = trial.angles.filter(a => a.ti === 'L' && a.tj === 'L').map(a => a.angle).sort((a, b) => a - b);

  console.log(`\n=== ${name} === (${trial.steps} steps)`);
  console.log(`  expected:  ${EXPECTED[name]}`);
  if (bb.length) console.log(`  B-B:       ${bb.map(fmt).join('')}`);
  if (lb.length) console.log(`  B-LP:      ${lb.map(fmt).join('')}`);
  if (ll.length) console.log(`  LP-LP:     ${ll.map(fmt).join('')}`);
  const cat = categorise(name, trial.domains);
  if (cat) console.log(`  ${cat}`);

  if (trials.length > 1) {
    // Consistency check across trials
    const variance = trials.map(t => t.angles.map(a => a.angle).sort((x, y) => x - y));
    let consistent = true;
    for (let k = 1; k < variance.length; k++) {
      for (let m = 0; m < variance[0].length; m++) {
        if (Math.abs(variance[k][m] - variance[0][m]) > 1.5) {
          consistent = false;
          break;
        }
      }
    }
    console.log(`  ${trials.length} trials ${consistent ? 'consistent' : 'DIVERGENT (local minimum?)'}`);
    if (!consistent) {
      trials.forEach((t, idx) => {
        const allAng = t.angles.map(a => a.angle).sort((x, y) => x - y).map(fmt).join('');
        console.log(`    trial ${idx + 1}: ${allAng}`);
      });
    }
  }
}

// ---- Main ----
console.log(`VSEPR physics check  -  n=${REPULSION_POWER}, LP weight=${DOMAIN_WEIGHT.lone_pair}, damping=${DAMPING}, dt=${PHYS_DT}`);
const TRIALS_PER_PRESET = 4;
for (const name of Object.keys(PRESETS)) {
  const trials = [];
  for (let t = 0; t < TRIALS_PER_PRESET; t++) trials.push(runTrial(name));
  reportPreset(name, trials);
}
