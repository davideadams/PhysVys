'use strict';

// ── Quark display helpers ────────────────────────────────────────────────

const QUARK_IDS = ['u','d','s','c','b','t'];
const ANTI_IDS  = ['ubar','dbar','sbar','cbar','bbar','tbar'];

// Human-readable symbols. particles.js uses combining overline which renders
// unreliably in some browsers; we use a plain overbar span in HTML instead.
const QUARK_LABEL = {
  u:'u', d:'d', s:'s', c:'c', b:'b', t:'t',
  ubar:'ū', dbar:'d̄', sbar:'s̄', cbar:'c̄', bbar:'b̄', tbar:'t̄',
};

// Colour sequences per quark type (quarks = RGB, antiquarks = R̄Ḡ B̄)
const COLOUR_CYCLE = {
  quark: ['R','G','B'],
  anti:  ['C','M','Y'],
};

// Complementary pairs for colour neutrality (quark → antiquark)
const COMPLEMENT = { R:'C', G:'M', B:'Y', C:'R', M:'G', Y:'B' };


const COLOUR_NAME = { R:'red', G:'green', B:'blue', C:'anti-red', M:'anti-green', Y:'anti-blue' };

function isAnti(id) { return id.endsWith('bar'); }
function colourCycle(id) { return isAnti(id) ? COLOUR_CYCLE.anti : COLOUR_CYCLE.quark; }

// ── State ────────────────────────────────────────────────────────────────

const state = {
  // Each slot: null | { id: 'u', colour: 'R' }
  slots: [null, null],
  dragSource: null, // { kind: 'palette', quarkId } | { kind: 'slot', slotIndex }
  autoColour: false,
};

// ── DOM refs ─────────────────────────────────────────────────────────────

const toggleAutoColour = document.getElementById('toggle-auto-colour');
const bagEl       = document.getElementById('bag');
const bagSlots    = document.getElementById('bag-slots');
const idArea      = document.getElementById('id-area');
const btnClear    = document.getElementById('btn-clear');
const sceneNote   = document.getElementById('scene-note');
const rdCharge    = document.getElementById('rd-charge');
const rdBaryon    = document.getElementById('rd-baryon');
const rdStrange   = document.getElementById('rd-strangeness');
const rdCharm     = document.getElementById('rd-charm');
const rdBottom    = document.getElementById('rd-bottomness');
const rdContent   = document.getElementById('rd-content');

// ── Build palette ────────────────────────────────────────────────────────

function buildPalette() {
  const qGrid  = document.getElementById('palette-quarks');
  const aqGrid = document.getElementById('palette-antiquarks');

  for (const id of QUARK_IDS) {
    qGrid.appendChild(makeChip(id));
  }
  for (const id of ANTI_IDS) {
    aqGrid.appendChild(makeChip(id));
  }
}

function makeChip(id) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `palette-chip chip-${id}`;
  btn.dataset.quarkId = id;
  btn.textContent = QUARK_LABEL[id];
  btn.title = SM.QUARKS[id].name + ' (charge ' + fmtCharge(SM.QUARKS[id].charge) + ')';
  btn.draggable = true;

  btn.addEventListener('click', () => {
    placeInNextSlot(id);
  });
  btn.addEventListener('dragstart', e => {
    state.dragSource = { kind: 'palette', quarkId: id };
    btn.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', id);
  });
  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    state.dragSource = null;
  });
  return btn;
}

// ── Slot rendering ───────────────────────────────────────────────────────

function renderSlots() {
  // Resize bag to fit current slot count
  const n = state.slots.length;
  bagEl.style.width = (48 + 88 * n) + 'px';

  // Rebuild slot DOM completely
  bagSlots.innerHTML = '';
  state.slots.forEach((q, i) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'slot';

    slotEl.addEventListener('dragover', e => {
      if (state.dragSource) {
        e.preventDefault();
        e.dataTransfer.dropEffect = state.dragSource.kind === 'palette' ? 'copy' : 'move';
        slotEl.classList.add('drag-over');
      }
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      slotEl.classList.remove('drag-over');
      if (!state.dragSource) return;
      const src = state.dragSource;
      if (src.kind === 'palette') {
        placeInSlot(i, src.quarkId);
      } else if (src.kind === 'slot' && src.slotIndex !== i) {
        const tmp = state.slots[i];
        state.slots[i] = state.slots[src.slotIndex];
        state.slots[src.slotIndex] = tmp;
        normalizeSlots();
        update();
      }
      state.dragSource = null;
    });

    if (q) {
      const qDiv = document.createElement('div');
      qDiv.className = `slot-quark chip-${q.id}`;
      qDiv.draggable = true;
      qDiv.addEventListener('dragstart', e => {
        state.dragSource = { kind: 'slot', slotIndex: i };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', q.id);
      });
      qDiv.addEventListener('dragend', () => { state.dragSource = null; });

      const sym = document.createElement('span');
      sym.className = 'slot-quark-symbol';
      sym.textContent = QUARK_LABEL[q.id];

      const dot = document.createElement('span');
      dot.className = 'slot-quark-colour' + (state.autoColour ? ' auto' : '');
      dot.dataset.colour = q.colour;
      dot.title = state.autoColour ? COLOUR_NAME[q.colour] : COLOUR_NAME[q.colour] + ' — click to cycle';
      if (!state.autoColour) {
        dot.addEventListener('click', e => {
          e.stopPropagation();
          cycleColour(i);
        });
      }

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'slot-remove';
      rm.textContent = '×';
      rm.title = 'Remove quark';
      rm.addEventListener('click', e => {
        e.stopPropagation();
        removeFromSlot(i);
      });

      qDiv.appendChild(sym);
      qDiv.appendChild(dot);
      qDiv.appendChild(rm);
      slotEl.appendChild(qDiv);
    } else {
      const hint = document.createElement('span');
      hint.className = 'slot-hint';
      hint.textContent = 'drop quark';
      slotEl.appendChild(hint);
    }

    bagSlots.appendChild(slotEl);
  });
}

// ── Slot actions ─────────────────────────────────────────────────────────

function placeInNextSlot(id) {
  const free = state.slots.findIndex(s => s === null);
  if (free === -1) return;
  placeInSlot(free, id);
}

const MAX_SLOTS = 6;

function placeInBag(id) {
  if (!state.slots.includes(null)) {
    if (state.slots.length >= MAX_SLOTS) return;
    state.slots.push(null);
  }
  const free = state.slots.findIndex(s => s === null);
  placeInSlot(free, id);
}

function setupBagDropTarget() {
  bagEl.addEventListener('dragover', e => {
    if (state.dragSource && state.dragSource.kind === 'palette') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  bagEl.addEventListener('drop', e => {
    e.preventDefault();
    if (!state.dragSource || state.dragSource.kind !== 'palette') return;
    const id = state.dragSource.quarkId;
    state.dragSource = null;
    placeInBag(id);
  });
}

function placeInSlot(index, id) {
  const cycle = colourCycle(id);
  state.slots[index] = { id, colour: cycle[Math.floor(Math.random() * cycle.length)] };
  normalizeSlots();
  update();
}

function removeFromSlot(index) {
  state.slots.splice(index, 1);
  normalizeSlots();
  update();
}

function normalizeSlots() {
  const filled = state.slots.filter(Boolean).length;
  // Strip all trailing empty slots
  while (state.slots.length > 1 && state.slots[state.slots.length - 1] === null) {
    state.slots.pop();
  }
  // Show a trailing empty slot only when fewer than 3 quarks are present
  if (filled < 3 && state.slots.length < MAX_SLOTS) {
    state.slots.push(null);
  }
}

function cycleColour(index) {
  const q = state.slots[index];
  if (!q) return;
  const cycle = colourCycle(q.id);
  const next = (cycle.indexOf(q.colour) + 1) % cycle.length;
  q.colour = cycle[next];
  update();
}

// ── Clear ────────────────────────────────────────────────────────────────

toggleAutoColour.addEventListener('click', () => {
  state.autoColour = !state.autoColour;
  toggleAutoColour.setAttribute('aria-checked', state.autoColour);
  update();
});

btnClear.addEventListener('click', () => {
  state.slots = [null, null, null];
  update();
});

// ── Auto-colour assignment ───────────────────────────────────────────────

function applyAutoColour() {
  const filled = state.slots.filter(Boolean);
  const quarks = filled.filter(q => !isAnti(q.id));
  const antis  = filled.filter(q =>  isAnti(q.id));
  const nq = quarks.length, naq = antis.length;
  const pairs = [['R','C'],['G','M'],['B','Y']];
  const rndPair = () => pairs[Math.floor(Math.random() * 3)];

  // Meson: random complementary pair
  if (nq === 1 && naq === 1) {
    const [qc, aqc] = rndPair();
    quarks[0].colour = qc; antis[0].colour = aqc;
    return;
  }
  // Baryon: RGB
  if (nq === 3 && naq === 0) {
    ['R','G','B'].forEach((c, i) => { quarks[i].colour = c; });
    return;
  }
  // Antibaryon: CMY
  if (naq === 3 && nq === 0) {
    ['C','M','Y'].forEach((c, i) => { antis[i].colour = c; });
    return;
  }
  // Tetraquark (2q + 2q̄): two distinct random pairs
  if (nq === 2 && naq === 2) {
    const shuffled = [...pairs].sort(() => Math.random() - 0.5);
    quarks[0].colour = shuffled[0][0]; antis[0].colour = shuffled[0][1];
    quarks[1].colour = shuffled[1][0]; antis[1].colour = shuffled[1][1];
    return;
  }
  // Pentaquark (4q + 1q̄): RGB + one random complementary pair
  if (nq === 4 && naq === 1) {
    const [qc, aqc] = rndPair();
    const rgb = ['R','G','B'];
    quarks[0].colour = rgb[0]; quarks[1].colour = rgb[1]; quarks[2].colour = rgb[2];
    quarks[3].colour = qc; antis[0].colour = aqc;
    return;
  }
  // Anti-pentaquark (1q + 4q̄): CMY + one random complementary pair
  if (naq === 4 && nq === 1) {
    const [qc, aqc] = rndPair();
    antis[0].colour = 'C'; antis[1].colour = 'M'; antis[2].colour = 'Y';
    antis[3].colour = aqc; quarks[0].colour = qc;
    return;
  }
  // Dibaryon (6q): 2× RGB
  if (nq === 6 && naq === 0) {
    ['R','G','B','R','G','B'].forEach((c, i) => { quarks[i].colour = c; });
    return;
  }
  // Anti-dibaryon (6q̄): 2× CMY
  if (naq === 6 && nq === 0) {
    ['C','M','Y','C','M','Y'].forEach((c, i) => { antis[i].colour = c; });
    return;
  }
  // Hexaquark (3q + 3q̄): three complementary pairs
  if (nq === 3 && naq === 3) {
    pairs.forEach(([qc, aqc], i) => { quarks[i].colour = qc; antis[i].colour = aqc; });
    return;
  }

  // Fallback for invalid combinations
  filled.forEach(q => { q.colour = colourCycle(q.id)[0]; });
}

// ── Colour neutrality check ──────────────────────────────────────────────

function checkColourNeutral(filled) {
  if (filled.length === 0) return false;

  // Compositional model: repeatedly strip neutral sub-groups until nothing
  // more can be removed. Neutral sub-groups: RGB triple, CMY triple, or any
  // complementary pair (R+C, G+M, B+Y).
  const pool = filled.map(q => q.colour);
  let changed = true;
  while (changed) {
    changed = false;

    // Try RGB triple
    const ri = pool.indexOf('R'), gi = pool.indexOf('G'), bi = pool.indexOf('B');
    if (ri !== -1 && gi !== -1 && bi !== -1) {
      [ri, gi, bi].sort((a, b) => b - a).forEach(i => pool.splice(i, 1));
      changed = true; continue;
    }

    // Try CMY triple
    const ci = pool.indexOf('C'), mi = pool.indexOf('M'), yi = pool.indexOf('Y');
    if (ci !== -1 && mi !== -1 && yi !== -1) {
      [ci, mi, yi].sort((a, b) => b - a).forEach(i => pool.splice(i, 1));
      changed = true; continue;
    }

    // Try any complementary pair
    for (const [q, aq] of [['R','C'],['G','M'],['B','Y']]) {
      const qi = pool.indexOf(q), aqi = pool.indexOf(aq);
      if (qi !== -1 && aqi !== -1) {
        [qi, aqi].sort((a, b) => b - a).forEach(i => pool.splice(i, 1));
        changed = true; break;
      }
    }
  }

  return pool.length === 0;
}

// ── Quantum number totals ────────────────────────────────────────────────

function computeTotals(filled) {
  let charge = 0, baryon = 0, S = 0, C = 0, Bn = 0;
  for (const q of filled) {
    const data = SM.QUARKS[q.id];
    charge += data.charge;
    baryon += data.baryon;
    S  += data.S;
    C  += data.C;
    Bn += data.Bn;
  }
  // Clean float noise
  if (Math.abs(charge) < 1e-9) charge = 0;
  if (Math.abs(baryon) < 1e-9) baryon = 0;
  return { charge, baryon, S, C, Bn };
}

// ── Validity classification ───────────────────────────────────────────────

function classify(filled) {
  const n = filled.length;
  if (n === 0) return null;

  const nq  = filled.filter(q => !isAnti(q.id)).length;
  const naq = filled.filter(q =>  isAnti(q.id)).length;
  const hasTop = filled.some(q => q.id === 't' || q.id === 'tbar');

  // A colour singlet requires (nq − naq) ≡ 0 (mod 3).
  if ((nq - naq) % 3 !== 0) return { type: 'invalid', message: 'Not a valid hadron.' };

  if (hasTop) return { type: 'warning', message: 'Top quarks decay before hadronising — no top hadron exists.' };

  if (n === 1) return { type: 'invalid', message: 'Not a valid hadron.' };

  if (n === 2 && nq === 1 && naq === 1) return { type: 'meson',  message: 'Meson' };
  if (n === 3 && nq === 3)              return { type: 'baryon', message: 'Baryon' };
  if (n === 3 && naq === 3)             return { type: 'baryon', message: 'Antibaryon' };
  if (n === 4 && nq === 2 && naq === 2) return { type: 'exotic', message: 'Tetraquark — exotic hadron, first evidence at LHCb / Belle II.' };
  if (n === 5 && nq === 4 && naq === 1) return { type: 'exotic', message: 'Pentaquark — exotic hadron, first observed at LHCb in 2015.' };
  if (n === 5 && naq === 4 && nq === 1) return { type: 'exotic', message: 'Anti-pentaquark — exotic hadron.' };
  if (n === 6 && nq === 6)              return { type: 'exotic', message: 'Dibaryon (hexaquark) — candidate observed as d*(2380).' };
  if (n === 6 && naq === 6)             return { type: 'exotic', message: 'Anti-dibaryon (hexaquark) — exotic candidate.' };
  if (n === 6 && nq === 3 && naq === 3) return { type: 'exotic', message: 'Hexaquark — exotic candidate.' };

  return { type: 'invalid', message: 'Not a valid hadron.' };
}

// ── Identification ────────────────────────────────────────────────────────

function formatLifetime(lt) {
  if (lt === null) return 'stable';
  if (lt < 1e-20) return lt.toExponential(2) + ' s (resonance)';
  return lt.toExponential(2) + ' s';
}

function fmtCharge(q) {
  if (q === 0) return '0';
  const sign = q > 0 ? '+' : '−';
  const abs = Math.abs(q);
  if (Math.abs(abs - 1) < 1e-9) return sign + '1';
  if (Math.abs(abs - 2/3) < 1e-9) return sign + '²⁄₃';
  if (Math.abs(abs - 1/3) < 1e-9) return sign + '¹⁄₃';
  return (q > 0 ? '+' : '') + q.toFixed(4).replace(/\.?0+$/, '');
}

function fmtNum(v) {
  if (v === 0) return '0';
  return (v > 0 ? '+' : '') + v;
}

function buildIdArea(filled, classification) {
  idArea.innerHTML = '';

  if (!classification) {
    const p = document.createElement('p');
    p.className = 'id-placeholder';
    p.textContent = 'Place quarks in the bag to identify a hadron.';
    idArea.appendChild(p);
    return;
  }

  // Composition type badge
  const badge = document.createElement('div');
  badge.className = 'id-type ' + classification.type;
  badge.textContent = classification.message;
  idArea.appendChild(badge);

  if (classification.type !== 'meson' && classification.type !== 'baryon') return;

  // Look up known particles
  const ids = filled.map(q => q.id);
  const matches = SM.findHadrons(ids);

  if (matches.length === 0) {
    const noMatch = document.createElement('p');
    noMatch.className = 'no-match';
    noMatch.textContent = 'No known particle with this quark content.';
    idArea.appendChild(noMatch);
    return;
  }

  for (const h of matches) {
    const card = document.createElement('div');
    card.className = 'particle-card';

    const nameRow = document.createElement('div');
    nameRow.className = 'pc-name';

    const sym = document.createElement('span');
    sym.className = 'pc-symbol';
    sym.textContent = h.name;

    const spinBadge = document.createElement('span');
    spinBadge.className = 'pc-spin pc-qn';
    spinBadge.textContent = 'spin ' + (Number.isInteger(h.spin) ? h.spin : (h.spin * 2) + '/2');

    nameRow.appendChild(sym);
    nameRow.appendChild(spinBadge);
    card.appendChild(nameRow);

    const stats = document.createElement('div');
    stats.className = 'pc-stats';

    const statItems = [
      ['Mass',     h.mass >= 1000 ? (h.mass / 1000).toFixed(3) + ' GeV/c²' : h.mass.toFixed(3) + ' MeV/c²', false],
      ['Lifetime', formatLifetime(h.lifetime),                                                                  false],
      ['Charge',   fmtCharge(h.charge),                                                                        true],
      ['Baryon B', fmtNum(h.baryon),                                                                           true],
    ];
    if (h.mixingNote) statItems.push(['Note', h.mixingNote, false]);

    for (const [k, v, isQN] of statItems) {
      const item = document.createElement('span');
      if (isQN) item.className = 'pc-qn';
      item.innerHTML = k + ' <span class="pc-stat-val">' + v + '</span>';
      stats.appendChild(item);
    }

    card.appendChild(stats);
    idArea.appendChild(card);
  }
}

// ── Readout update ───────────────────────────────────────────────────────

function updateReadouts(filled, totals) {
  if (filled.length === 0) {
    rdCharge.textContent = '—';
    rdBaryon.textContent = '—';
    rdStrange.textContent = '—';
    rdCharm.textContent = '—';
    rdBottom.textContent = '—';
    rdContent.textContent = '—';
    return;
  }
  rdCharge.textContent   = fmtCharge(totals.charge);
  rdBaryon.textContent   = fmtNum(totals.baryon);
  rdStrange.textContent  = fmtNum(totals.S);
  rdCharm.textContent    = fmtNum(totals.C);
  rdBottom.textContent   = fmtNum(totals.Bn);
  rdContent.textContent  = filled.map(q => QUARK_LABEL[q.id]).join(' ');
}

// ── Bag glow ─────────────────────────────────────────────────────────────

function updateBagGlow(filled, neutral) {
  bagEl.classList.remove('neutral-2', 'neutral-3', 'not-neutral');
  if (filled.length === 0) return;
  if (neutral) {
    bagEl.classList.add('neutral-' + filled.length);
  } else {
    bagEl.classList.add('not-neutral');
  }
}

// ── Master update ────────────────────────────────────────────────────────

function update() {
  if (state.autoColour) applyAutoColour();

  const filled = state.slots.filter(Boolean);
  const totals = computeTotals(filled);
  const neutral = checkColourNeutral(filled);
  const classification = classify(filled);

  renderSlots();
  updateReadouts(filled, totals);
  updateBagGlow(filled, neutral);
  buildIdArea(filled, classification);
  sceneNote.textContent = state.autoColour
    ? 'Quarks are confined by colour charge.'
    : 'Quarks are confined by colour charge. Try cycling the colour dots and see when the bag glows.';
}

// ── Init ─────────────────────────────────────────────────────────────────

buildPalette();
setupBagDropTarget();
update();
