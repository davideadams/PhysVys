'use strict';

// SM is set by ../_data/particles.js as window.SM
if (typeof SM === 'undefined') {
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="position:fixed;top:0;left:0;right:0;background:#fee2e2;color:#991b1b;padding:1rem;font-weight:700;z-index:9999">' +
    'Error: particles.js did not load — SM is undefined. Check the browser console and verify the script path.' +
    '</div>');
  throw new Error('SM is undefined — particles.js failed to set window.SM');
}
// Use SM.* directly — particles.js declares top-level `const QUARKS`, `const CURATED_DECAYS`,
// etc. which live in classic-script scope and would collide with redeclarations here.
const DECAYS = SM.CURATED_DECAYS;
const getPart = SM.getParticle;
const checkRxn = SM.checkReaction;

// ── Display overrides (corrects encoding garble in particles.js) ──────────
const SYM = {
  // Leptons
  'e-': 'e⁻',      'e+': 'e⁺',
  'nu_e':   'ν<sub>e</sub>',                  'nu_e_bar':   '<span class="overbar">ν</span><sub>e</sub>',
  'mu-':    'μ⁻',                             'mu+':        'μ⁺',
  'nu_mu':  'ν<sub>μ</sub>',                  'nu_mu_bar':  '<span class="overbar">ν</span><sub>μ</sub>',
  'tau-':   'τ⁻',                             'tau+':       'τ⁺',
  'nu_tau': 'ν<sub>τ</sub>',                  'nu_tau_bar': '<span class="overbar">ν</span><sub>τ</sub>',
  // Bosons
  'photon': 'γ',   'W+': 'W⁺',  'W-': 'W⁻',  'Z0': 'Z⁰',
  'gluon': 'g',    'higgs': 'H⁰', 'graviton': 'G',
  // Quarks
  'u': 'u', 'ubar': '<span class="overbar">u</span>',
  'd': 'd', 'dbar': '<span class="overbar">d</span>',
  's': 's', 'sbar': '<span class="overbar">s</span>',
  'c': 'c', 'cbar': '<span class="overbar">c</span>',
  'b': 'b', 'bbar': '<span class="overbar">b</span>',
  't': 't', 'tbar': '<span class="overbar">t</span>',
  // Light mesons
  'pi+': 'π⁺', 'pi-': 'π⁻', 'pi0': 'π⁰',
  'eta': 'η', 'eta_prime': "η'",
  'rho+': 'ρ⁺', 'rho0': 'ρ⁰', 'omega': 'ω', 'phi': 'φ',
  // Strange mesons
  'K+': 'K⁺', 'K-': 'K⁻', 'K0': 'K⁰', 'K0bar': '<span class="overbar">K</span>⁰',
  // Charm mesons
  'D+': 'D⁺', 'D-': 'D⁻', 'D0': 'D⁰', 'D0bar': '<span class="overbar">D</span>⁰',
  'Ds+': 'D<sub>s</sub>⁺', 'Ds-': 'D<sub>s</sub>⁻', 'Jpsi': 'J/ψ',
  // Bottom mesons
  'B+': 'B⁺', 'B-': 'B⁻', 'B0': 'B⁰', 'B0bar': '<span class="overbar">B</span>⁰', 'Upsilon': 'Υ',
  // Light baryons
  'p': 'p', 'n': 'n',
  'pbar': '<span class="overbar">p</span>', 'nbar': '<span class="overbar">n</span>',
  'Delta++': 'Δ⁺⁺', 'Delta+': 'Δ⁺', 'Delta0': 'Δ⁰', 'Delta-': 'Δ⁻',
  // Strange baryons
  'Lambda': 'Λ',
  'Sigma+': 'Σ⁺', 'Sigma0': 'Σ⁰', 'Sigma-': 'Σ⁻',
  'Xi0': 'Ξ⁰', 'Xi-': 'Ξ⁻', 'Omega-': 'Ω⁻',
  // Charm baryons
  'Lambda_c+': 'Λ<sub>c</sub>⁺',
};
function sym(id) { return SYM[id] || getPart(id).display; }

// ── Palette definitions ───────────────────────────────────────────────────
// Each entry: { id, cat } where cat maps to a CSS class.

const PALETTE = {
  hadrons: {
    main: [
      { id: 'p',       cat: 'cat-hadron-b' },
      { id: 'n',       cat: 'cat-hadron-b' },
      { id: 'pbar',    cat: 'cat-hadron-b' },
      { id: 'nbar',    cat: 'cat-hadron-b' },
      { id: 'pi+',     cat: 'cat-hadron-m' },
      { id: 'pi-',     cat: 'cat-hadron-m' },
      { id: 'pi0',     cat: 'cat-hadron-m' },
      { id: 'K+',      cat: 'cat-hadron-m' },
      { id: 'K-',      cat: 'cat-hadron-m' },
      { id: 'K0',      cat: 'cat-hadron-m' },
      { id: 'K0bar',   cat: 'cat-hadron-m' },
      { id: 'eta',     cat: 'cat-hadron-m' },
      { id: 'Lambda',  cat: 'cat-hadron-b' },
      { id: 'Sigma+',  cat: 'cat-hadron-b' },
      { id: 'Sigma0',  cat: 'cat-hadron-b' },
      { id: 'Sigma-',  cat: 'cat-hadron-b' },
      { id: 'Xi0',     cat: 'cat-hadron-b' },
      { id: 'Xi-',     cat: 'cat-hadron-b' },
      { id: 'Omega-',  cat: 'cat-hadron-b' },
    ],
    more: [
      { id: 'D+',      cat: 'cat-hadron-m' },
      { id: 'D-',      cat: 'cat-hadron-m' },
      { id: 'D0',      cat: 'cat-hadron-m' },
      { id: 'Ds+',     cat: 'cat-hadron-m' },
      { id: 'Jpsi',    cat: 'cat-hadron-m' },
      { id: 'B+',      cat: 'cat-hadron-m' },
      { id: 'B-',      cat: 'cat-hadron-m' },
      { id: 'B0',      cat: 'cat-hadron-m' },
      { id: 'Lambda_c+', cat: 'cat-hadron-b' },
    ],
  },
  leptons: {
    main: [
      { id: 'e-',      cat: 'cat-lepton'      },
      { id: 'e+',      cat: 'cat-antilepton'  },
      { id: 'nu_e',    cat: 'cat-neutrino'    },
      { id: 'nu_e_bar',cat: 'cat-antineutrino'},
      { id: 'mu-',     cat: 'cat-lepton'      },
      { id: 'mu+',     cat: 'cat-antilepton'  },
      { id: 'nu_mu',   cat: 'cat-neutrino'    },
      { id: 'nu_mu_bar',cat:'cat-antineutrino'},
      { id: 'tau-',    cat: 'cat-lepton'      },
      { id: 'tau+',    cat: 'cat-antilepton'  },
      { id: 'nu_tau',  cat: 'cat-neutrino'    },
      { id: 'nu_tau_bar',cat:'cat-antineutrino'},
    ],
    more: [],
  },
  bosons: {
    main: [
      { id: 'photon',  cat: 'cat-boson' },
      { id: 'W+',      cat: 'cat-boson' },
      { id: 'W-',      cat: 'cat-boson' },
      { id: 'Z0',      cat: 'cat-boson' },
    ],
    more: [
      { id: 'gluon',   cat: 'cat-boson' },
      { id: 'higgs',   cat: 'cat-boson' },
    ],
  },
  quarks: {
    main: [
      { id: 'u',    cat: 'cat-quark-light' },
      { id: 'ubar', cat: 'cat-quark-anti'  },
      { id: 'd',    cat: 'cat-quark-dark'  },
      { id: 'dbar', cat: 'cat-quark-anti'  },
      { id: 's',    cat: 'cat-quark-dark'  },
      { id: 'sbar', cat: 'cat-quark-anti'  },
      { id: 'c',    cat: 'cat-quark-light' },
      { id: 'cbar', cat: 'cat-quark-anti'  },
    ],
    more: [
      { id: 'b',    cat: 'cat-quark-dark'  },
      { id: 'bbar', cat: 'cat-quark-anti'  },
      { id: 't',    cat: 'cat-quark-light' },
      { id: 'tbar', cat: 'cat-quark-anti'  },
    ],
  },
};

// Category for a given particle id (used for chip colouring)
function chipCat(id) {
  for (const tab of Object.values(PALETTE)) {
    for (const entry of [...tab.main, ...tab.more]) {
      if (entry.id === id) return entry.cat;
    }
  }
  return 'cat-hadron-b';
}

// ── State ─────────────────────────────────────────────────────────────────
// All curated reactions — valid and broken interleaved. Students must work out
// from the conservation table whether a given reaction is allowed (no swap
// needed) or broken (one chip must change). Pure recognition + repair.
const FIXABLE = DECAYS;

const state = {
  mode: 'fixit',        // 'fixit' | 'free'
  lhs: [],              // particle id strings
  rhs: [],
  fixIndex: 0,          // index into FIXABLE
  paletteTab: 'hadrons',
  moreOpen: false,
  activeZone: 'lhs',    // free-build: which zone palette clicks go to (matches the HTML default-active button)
  swapTarget: null,     // fix-it: { zone, index } of chip selected for swap
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const verdictTable  = document.getElementById('verdict-table');
const fitixArea     = document.getElementById('fixit-area');
const freeZoneArea  = document.getElementById('free-zone-area');
const navCounter    = document.getElementById('nav-counter');
const btnPrev       = document.getElementById('btn-prev');
const btnNext       = document.getElementById('btn-next');
const paletteGrid   = document.getElementById('palette-grid');
const qnScoreEl     = document.getElementById('qn-score');
const btnCheck      = document.getElementById('btn-check');
const btnReveal     = document.getElementById('btn-reveal');
const btnClear      = document.getElementById('btn-clear');

// ── Formatting ────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (Math.abs(n) < 1e-9) return '0';
  // Express in thirds
  const t3 = Math.round(n * 3);
  if (Math.abs(t3 / 3 - n) < 1e-9) {
    const map = { 3:'+1', '-3':'−1', 2:'+⅔', '-2':'−⅔',
                  1:'+⅓', '-1':'−⅓' };
    if (map[String(t3)]) return map[String(t3)];
    return (t3 > 0 ? '+' : '') + t3 + '/3';
  }
  return (n > 0 ? '+' : '') + n.toFixed(3).replace(/\.?0+$/, '');
}

function fmtMass(mev) {
  if (mev < 1) return mev.toFixed(3) + ' MeV';
  if (mev < 1000) return mev.toFixed(1) + ' MeV';
  return (mev / 1000).toFixed(3) + ' GeV';
}

// Compact quantum-number formatter for chip sub/super prefixes and table cells.
// Shows fractions (⅓, ⅔) for thirds, signed integers otherwise, and bare "0".
function fmtQN(n) {
  if (Math.abs(n) < 1e-9) return '0';
  const t3 = Math.round(n * 3);
  if (Math.abs(t3 / 3 - n) < 1e-9 && Math.abs(t3) % 3 !== 0) {
    const map = { '2':'⅔', '-2':'−⅔', '1':'⅓', '-1':'−⅓' };
    if (map[String(t3)]) return map[String(t3)];
  }
  return (n < 0 ? '−' : '') + Math.abs(n);
}

// ── Render: per-particle quantum-number breakdown (transposed, student-fill) ─
// Columns mirror the equation: [QN label] [LHS particles with + between]
// [→] [RHS particles with + between] [Σ before] [Σ after] [OK?]
// All value cells are empty inputs the student fills in, then checks.

function qn(p, key) {
  if (key === 'charge') return p.charge;
  if (key === 'baryon') return p.baryon || 0;
  return p[key] || 0;
}

function sumQN(ids, key) {
  return ids.reduce((s, id) => s + qn(getPart(id), key), 0);
}

function isConserved(key) {
  return Math.abs(sumQN(state.lhs, key) - sumQN(state.rhs, key)) < 1e-9;
}

// Parse a student-entered value. Accepts: "+1", "-1", "0", "1/3", "-2/3",
// Unicode fractions ⅓ ⅔, and either ASCII "-" or Unicode "−".
function parseQN(text) {
  if (text == null) return NaN;
  let s = String(text).trim().replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (s === '' || s === '+' || s === '-') return NaN;
  const frac = {
    '⅓':1/3, '+⅓':1/3, '-⅓':-1/3,
    '⅔':2/3, '+⅔':2/3, '-⅔':-2/3,
  };
  if (frac[s] !== undefined) return frac[s];
  const m = s.match(/^([+-]?)(\d+)\/(\d+)$/);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const den = parseInt(m[3], 10);
    if (!den) return NaN;
    return sign * parseInt(m[2], 10) / den;
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function equalQN(a, b) {
  return !isNaN(a) && !isNaN(b) && Math.abs(a - b) < 1e-6;
}

function addCell(table, cls, html, title) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  if (title) el.title = title;
  table.appendChild(el);
  return el;
}

// ── Drag-and-drop helpers ────────────────────────────────────────────────
// `position` is the index at which to splice the new particle into state[zone].
// If undefined, append. The drop target cell registers handlers for dragover
// (must preventDefault to accept the drop) and drop.
function addParticleAt(zone, id, position) {
  if (typeof position === 'number') {
    state[zone].splice(position, 0, id);
  } else {
    state[zone].push(id);
  }
  state.swapTarget = null;
  renderVerdict();
}

function makeDropTarget(cell, zone, position) {
  cell.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  cell.addEventListener('drop', e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) addParticleAt(zone, id, position);
  });
}

function setActiveZone(zone) {
  state.activeZone = zone;
  document.querySelectorAll('.zone-sel-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.zone === zone)
  );
}

const QN_ROWS = [
  { label: 'Q',  key: 'charge', title: 'Charge' },
  { label: 'B',  key: 'baryon', title: 'Baryon number' },
  { label: 'L<sub>e</sub>', key: 'Le',   title: 'Electron lepton number' },
  { label: 'L<sub>μ</sub>', key: 'Lmu',  title: 'Muon lepton number' },
  { label: 'L<sub>τ</sub>', key: 'Ltau', title: 'Tau lepton number' },
];

function makeQNInput(dataset) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'qn-input';
  inp.inputMode = 'text';
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.maxLength = 6;
  Object.assign(inp.dataset, dataset);
  // Clear correct/wrong styling when the student edits a cell
  inp.addEventListener('input', () => {
    inp.classList.remove('qn-correct', 'qn-wrong');
  });
  return inp;
}

function makeOKCell(qnKey) {
  const div = document.createElement('div');
  div.className = 'qn-ok-cell';
  div.dataset.qn = qnKey;
  div.textContent = '—';
  return div;
}

// Render the unified table: the chip pills serve as column headers in row 1,
// with quantum-number rows beneath. There is no separate reaction zone — the
// equation lives in the header row of the table itself.
function renderVerdict() {
  verdictTable.innerHTML = '';
  qnScoreEl.textContent = '';
  qnScoreEl.classList.remove('complete', 'partial');

  const lhsItems = state.lhs.map((id, i) => ({ id, zone: 'lhs', index: i }));
  const rhsItems = state.rhs.map((id, i) => ({ id, zone: 'rhs', index: i }));

  // Column template — fully deterministic so the chip in the header lines up
  // exactly with its quantum-number inputs below. Each side always ends with a
  // permanent `+ add` cell that doubles as a drop target.
  //   [QN-label] [chip / + / chip / ... / +add] [→] [chip / + / chip / ... / +add] [Σb] [Σa] [OK?]
  const cols = ['72px']; // QN label (Q, B, Lₑ…)
  function pushSideTracks(items) {
    items.forEach((item, i) => {
      if (i > 0) cols.push('1fr'); // + operator
      cols.push('80px');           // chip column
    });
    cols.push('80px');             // +add cell at end of side
  }
  pushSideTracks(lhsItems);
  cols.push('1fr');                  // → arrow column
  pushSideTracks(rhsItems);
  cols.push('52px');                 // Σ before
  cols.push('52px');                 // Σ after
  cols.push('44px');                 // OK?

  const table = document.createElement('div');
  table.className = 'qn-table';
  table.style.gridTemplateColumns = cols.join(' ');

  // ---- Header row: empty corner | chips/+/+add | → | chips/+/+add | Σ labels | OK label
  addCell(table, 'qn-h qn-lbl', '');
  appendHeaderSide(table, lhsItems, 'lhs');
  addCell(table, 'qn-h qn-op qn-arrow', '→');
  appendHeaderSide(table, rhsItems, 'rhs');
  addCell(table, 'qn-h qn-sum-h', 'Σ<sub>before</sub>', 'Σ before');
  addCell(table, 'qn-h qn-sum-h', 'Σ<sub>after</sub>',  'Σ after');
  addCell(table, 'qn-h qn-check-h', 'OK?', 'Conserved? — auto-computed from your Σ values');

  // ---- One row per conservation law (Q, B, Lₑ, Lμ, Lτ) ----
  QN_ROWS.forEach(def => {
    const lblCell = document.createElement('div');
    lblCell.className = 'qn-lbl';
    lblCell.title = def.title;
    lblCell.innerHTML = def.label;
    table.appendChild(lblCell);

    appendDataSide(table, lhsItems, def, 'lhs');
    addCell(table, 'qn-op qn-arrow', '→');
    appendDataSide(table, rhsItems, def, 'rhs');

    // Σ before / Σ after
    const sumB = document.createElement('div');
    sumB.className = 'qn-cell qn-cell-input qn-sum-input';
    sumB.appendChild(makeQNInput({ kind: 'sum', qn: def.key, zone: 'lhs' }));
    table.appendChild(sumB);

    const sumA = document.createElement('div');
    sumA.className = 'qn-cell qn-cell-input qn-sum-input';
    sumA.appendChild(makeQNInput({ kind: 'sum', qn: def.key, zone: 'rhs' }));
    table.appendChild(sumA);

    // OK? auto-computed
    const okCell = document.createElement('div');
    okCell.className = 'qn-cell qn-check-auto';
    okCell.appendChild(makeOKCell(def.key));
    table.appendChild(okCell);
  });

  verdictTable.appendChild(table);
}

// Append one side's header cells: chip cells interleaved with +, ending with
// a permanent "+ add" drop cell. Every cell on the side is a drop target —
// dropping on a chip inserts immediately after it; dropping on a + operator
// inserts at that gap; dropping on the trailing +add appends.
function appendHeaderSide(table, items, zone) {
  items.forEach((item, i) => {
    if (i > 0) {
      const opCell = addCell(table, 'qn-h qn-op', '+');
      makeDropTarget(opCell, zone, i); // gap between chip i-1 and chip i
    }
    const cell = document.createElement('div');
    cell.className = 'qn-h qn-chip-cell';
    const isSwap = !!(state.swapTarget && state.swapTarget.zone === item.zone && state.swapTarget.index === item.index);
    cell.appendChild(makeChip(item.id, item.zone, item.index, isSwap));
    makeDropTarget(cell, zone, item.index + 1); // insert immediately after this chip
    table.appendChild(cell);
  });

  // Permanent "+ add" cell at the end of every side. Drop here appends.
  const addEl = document.createElement('div');
  addEl.className = 'qn-h qn-add-cell';
  addEl.innerHTML = '<span class="add-pill">+ add</span>';
  addEl.title = 'Drag a particle here, or click then tap a palette button';
  makeDropTarget(addEl, zone, items.length);
  addEl.addEventListener('click', () => setActiveZone(zone));
  table.appendChild(addEl);
}

// Append one side's data cells for a given QN row: input cells interleaved
// with +, ending with an empty cell aligned under the +add header.
function appendDataSide(table, items, def, zone) {
  items.forEach((item, i) => {
    if (i > 0) addCell(table, 'qn-op', '+');
    const cell = document.createElement('div');
    cell.className = 'qn-cell qn-cell-input';
    cell.appendChild(makeQNInput({
      kind: 'particle',
      qn: def.key,
      zone: item.zone,
      index: String(item.index),
    }));
    table.appendChild(cell);
  });
  addCell(table, 'qn-cell qn-cell-empty', '');
}

// ── Check / Reveal / Clear ────────────────────────────────────────────────

function expectedFor(el) {
  const { kind, qn: key, zone } = el.dataset;
  if (kind === 'particle') {
    const idx = parseInt(el.dataset.index, 10);
    const id = state[zone][idx];
    return id ? qn(getPart(id), key) : NaN;
  }
  if (kind === 'sum')  return sumQN(state[zone], key);
  return NaN;
}

function checkAnswers() {
  let correct = 0, total = 0;

  verdictTable.querySelectorAll('.qn-input').forEach(inp => {
    total++;
    const got = parseQN(inp.value);
    const want = expectedFor(inp);
    if (equalQN(got, want)) {
      inp.classList.add('qn-correct');
      inp.classList.remove('qn-wrong');
      correct++;
    } else {
      inp.classList.add('qn-wrong');
      inp.classList.remove('qn-correct');
    }
  });

  // Auto-fill OK? cells by comparing student's Σ before vs Σ after inputs
  verdictTable.querySelectorAll('.qn-ok-cell').forEach(cell => {
    const key = cell.dataset.qn;
    const sumBefore = verdictTable.querySelector(`.qn-input[data-kind="sum"][data-qn="${key}"][data-zone="lhs"]`);
    const sumAfter  = verdictTable.querySelector(`.qn-input[data-kind="sum"][data-qn="${key}"][data-zone="rhs"]`);
    const before = sumBefore ? parseQN(sumBefore.value) : NaN;
    const after  = sumAfter  ? parseQN(sumAfter.value)  : NaN;
    if (equalQN(before, after)) {
      cell.textContent = '✓';
      cell.className = 'qn-ok-cell qn-ok';
    } else {
      cell.textContent = '✗';
      cell.className = 'qn-ok-cell qn-fail';
    }
  });

  if (total === 0) {
    qnScoreEl.textContent = '';
    return;
  }
  qnScoreEl.textContent = correct === total
    ? `Perfect — ${correct} / ${total} ✓`
    : `${correct} / ${total} correct`;
  qnScoreEl.classList.toggle('complete', correct === total);
  qnScoreEl.classList.toggle('partial',  correct !== total);
}

// Compact display string for revealed values (matches student-friendly format).
function fmtReveal(n) {
  if (Math.abs(n) < 1e-9) return '0';
  const t3 = Math.round(n * 3);
  if (Math.abs(t3 / 3 - n) < 1e-9 && Math.abs(t3) % 3 !== 0) {
    const map = { '2':'2/3', '-2':'-2/3', '1':'1/3', '-1':'-1/3' };
    if (map[String(t3)]) return map[String(t3)];
  }
  return (n < 0 ? '-' : '') + Math.abs(n);
}

function revealAnswers() {
  verdictTable.querySelectorAll('.qn-input').forEach(inp => {
    inp.value = fmtReveal(expectedFor(inp));
    inp.classList.remove('qn-wrong');
    inp.classList.add('qn-correct');
  });
  verdictTable.querySelectorAll('.qn-ok-cell').forEach(cell => {
    const conserved = isConserved(cell.dataset.qn);
    cell.textContent = conserved ? '✓' : '✗';
    cell.className = 'qn-ok-cell ' + (conserved ? 'qn-ok' : 'qn-fail');
  });
  const total = verdictTable.querySelectorAll('.qn-input').length;
  qnScoreEl.textContent = `Revealed (${total} cells)`;
  qnScoreEl.classList.remove('complete', 'partial');
}

function clearAnswers() {
  verdictTable.querySelectorAll('.qn-input').forEach(inp => {
    inp.value = '';
    inp.classList.remove('qn-correct', 'qn-wrong');
  });
  verdictTable.querySelectorAll('.qn-ok-cell').forEach(cell => {
    cell.textContent = '—';
    cell.className = 'qn-ok-cell';
  });
  qnScoreEl.textContent = '';
  qnScoreEl.classList.remove('complete', 'partial');
}

// ── Render: particle chips ────────────────────────────────────────────────
function makeChip(id, zone, index, selectedSwap) {
  const p = getPart(id);
  const btn = document.createElement('button');
  btn.type = 'button';
  const cat = chipCat(id);
  btn.className = `particle-chip ${cat}`;
  if (selectedSwap) btn.classList.add('chip-selected-swap');

  // Sub/super prefix in SACE-style nuclear notation:
  //   ᴮ  X    (B = baryon number on top, Q = charge on bottom, both left of symbol)
  //   ꟴ
  const prefix = document.createElement('span');
  prefix.className = 'quantum-prefix';
  prefix.innerHTML =
    `<span class="qn-top">${fmtQN(p.baryon || 0)}</span>` +
    `<span class="qn-bottom">${fmtQN(p.charge)}</span>`;

  const symEl = document.createElement('span');
  symEl.className = 'chip-symbol';
  symEl.innerHTML = sym(id);

  const rem = document.createElement('button');
  rem.type = 'button';
  rem.className = 'chip-remove';
  rem.textContent = '×';
  rem.title = 'Remove';
  rem.addEventListener('click', e => {
    e.stopPropagation();
    removeParticle(zone, index);
  });

  btn.appendChild(prefix);
  btn.appendChild(symEl);
  btn.appendChild(rem);

  // In fix-it mode, clicking any chip selects it for swap — the student has
  // to work out which particle is wrong from the conservation table.
  if (state.mode === 'fixit') {
    btn.style.cursor = 'pointer';
    btn.title = 'Click, then choose a replacement from the palette';
    btn.addEventListener('click', () => {
      if (state.swapTarget && state.swapTarget.zone === zone && state.swapTarget.index === index) {
        state.swapTarget = null;  // deselect
      } else {
        state.swapTarget = { zone, index };
      }
      renderVerdict();
    });
  }

  // In free-build, the chip remove button handles removal; the chip itself does nothing
  return btn;
}

// ── Particle manipulation ─────────────────────────────────────────────────
function addParticle(id) {
  if (state.mode === 'fixit') {
    // Palette click in fix-it = swap the selected slot
    if (!state.swapTarget) return;
    const { zone, index } = state.swapTarget;
    state[zone][index] = id;
    state.swapTarget = null;
  } else {
    state[state.activeZone].push(id);
  }
  renderVerdict();
}

function removeParticle(zone, index) {
  state[zone].splice(index, 1);
  state.swapTarget = null;
  renderVerdict();
}

// ── Palette ───────────────────────────────────────────────────────────────
function renderPalette() {
  paletteGrid.innerHTML = '';
  const tab = PALETTE[state.paletteTab];
  const items = state.moreOpen ? [...tab.main, ...tab.more] : tab.main;

  items.forEach(({ id, cat }) => {
    const p = getPart(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-btn ${cat}`;
    btn.innerHTML = sym(id);
    btn.title = p.name + (p.mass ? ' — ' + fmtMass(p.mass) : '');
    btn.draggable = true;
    btn.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('dragging-particle');
    });
    btn.addEventListener('dragend', () => {
      document.body.classList.remove('dragging-particle');
    });
    btn.addEventListener('click', () => addParticle(id));
    paletteGrid.appendChild(btn);
  });

  if (tab.more.length > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-toggle';
    more.textContent = state.moreOpen ? '− Less' : '+ More';
    more.addEventListener('click', () => {
      state.moreOpen = !state.moreOpen;
      renderPalette();
    });
    paletteGrid.appendChild(more);
  }
}

// ── Fix-it mode ───────────────────────────────────────────────────────────
function loadFixit(index) {
  const decay = FIXABLE[index];
  state.lhs = [...decay.lhs];
  state.rhs = [...decay.rhs];
  state.swapTarget = null;

  navCounter.textContent = `${index + 1} / ${FIXABLE.length}`;
  btnPrev.disabled = index === 0;
  btnNext.disabled = index === FIXABLE.length - 1;

  renderVerdict();
}

// ── Mode switch ───────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  state.lhs = [];
  state.rhs = [];
  state.swapTarget = null;

  document.querySelectorAll('#seg-mode .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );

  fitixArea.style.display    = mode === 'fixit' ? '' : 'none';
  freeZoneArea.style.display = mode === 'free'  ? '' : 'none';
  // Clear buttons live inside freeZoneArea now, so they hide/show with the whole panel.

  if (mode === 'fixit') loadFixit(state.fixIndex);
  else renderVerdict();
}

// ── Event wiring ──────────────────────────────────────────────────────────
btnCheck.addEventListener('click', checkAnswers);
btnReveal.addEventListener('click', revealAnswers);
btnClear.addEventListener('click', clearAnswers);

document.getElementById('seg-mode').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setMode(btn.dataset.mode);
});

btnPrev.addEventListener('click', () => {
  if (state.fixIndex > 0) { state.fixIndex--; loadFixit(state.fixIndex); }
});
btnNext.addEventListener('click', () => {
  if (state.fixIndex < FIXABLE.length - 1) { state.fixIndex++; loadFixit(state.fixIndex); }
});

document.getElementById('palette-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.palette-tab');
  if (!btn) return;
  state.paletteTab = btn.dataset.tab;
  state.moreOpen = false;
  document.querySelectorAll('.palette-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === state.paletteTab)
  );
  renderPalette();
});

document.getElementById('lhs-clear').addEventListener('click', () => {
  state.lhs = []; renderVerdict();
});
document.getElementById('rhs-clear').addEventListener('click', () => {
  state.rhs = []; renderVerdict();
});

// Zone selector buttons (free-build) — just toggle which side the palette feeds.
document.querySelectorAll('.zone-sel-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveZone(btn.dataset.zone));
});

// ── ?decay= URL param (deep-link from Hadron Builder) ────────────────────
const _urlDecay = new URLSearchParams(location.search).get('decay');
if (_urlDecay) {
  // Find by id in DECAYS and switch to free-build with it pre-loaded
  const found = DECAYS.find(d => d.id === _urlDecay);
  if (found) {
    setMode('free');
    state.lhs = [...found.lhs];
    state.rhs = [...found.rhs];
    renderVerdict();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
// Set hadrons as the active palette tab
document.querySelector('[data-tab="hadrons"]').classList.add('active');
setMode('fixit');
renderPalette();
