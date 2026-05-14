'use strict';

const canvas = document.getElementById('hene-canvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width;   // 960
const H = canvas.height;  // 600

// ── Colours ──────────────────────────────────────────────────────────────────
const COL = {
  bg:        '#0a1628',
  tubeBody:  '#0c1e38',
  tubeBdr:   'rgba(60,120,200,0.4)',
  hrMirror:  '#101e35',
  ocMirror:  '#131f38',
  heGnd:     'rgba(255,240,100,0.55)',
  heMeta:    'rgba(255,170,0,0.95)',
  neGnd:     'rgba(80,180,255,0.4)',
  neUpper:   'rgba(0,230,130,0.95)',
  neLower:   'rgba(210,80,255,0.88)',
  electron:  'rgba(110,200,255,0.9)',
  photonRed: '#ff4444',
  photonSpo: 'rgba(255,150,80,0.8)',
  photonIR:  'rgba(160,50,20,0.75)',
  levelHe:   'rgba(255,220,80,0.8)',
  levelNeU:  'rgba(0,220,120,0.85)',
  levelNeL:  'rgba(200,80,255,0.8)',
  levelGnd:  'rgba(100,180,255,0.5)',
};

// ── Layout: Full Sim ──────────────────────────────────────────────────────────
const TUBE = { x0:65, x1:895, y0:28, y1:200 };
const GAS  = { x0:120, x1:836, y0:46, y1:183 };
const MHR  = { x0:56, x1:74, y0:22, y1:206 };
const MOC  = { x0:886, x1:904, y0:22, y1:206 };
const CATH = { x:110, y0:52, y1:174 };
const ANOD = { x:850, y0:52, y1:174 };

// Energy diagram region
const ED_Y0 = 214;
const HE_CX = 188;
const NE_CX  = 600;
const HE_YG  = 570;  // He ground y
const HE_YM  = 288;  // He metastable y
const NE_YG  = 570;  // Ne ground y
const NE_YU  = 272;  // Ne upper laser level y
const NE_YL  = 400;  // Ne lower laser level y

// ── Layout: Cascade ───────────────────────────────────────────────────────────
const CX = [168, 308, 452, 596, 740]; // stage x positions (5 stages, 0-indexed)
const CY_CTR = 165;
const C_SPANS = [0, 130, 206, 250, 274]; // total vertical span per stage
const C_EXIT_X = 920;
const C_MINI_Y = 322; // mini energy diagram top y

// ── Utilities ─────────────────────────────────────────────────────────────────
const rnd   = (lo, hi) => lo + Math.random() * (hi - lo);
const rndI  = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function dot(x, y, r, col, glow) {
  ctx.save();
  ctx.fillStyle = col;
  if (glow) { ctx.shadowColor = col; ctx.shadowBlur = glow; }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function arrowDown(x, y1, y2, col, label) {
  const AH = 5, AL = 8;
  ctx.save();
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2 - AL); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y2); ctx.lineTo(x - AH, y2 - AL); ctx.lineTo(x + AH, y2 - AL);
  ctx.closePath(); ctx.fill();
  if (label) {
    ctx.font = '600 10px "Trebuchet MS",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(label, x - AH - 3, (y1 + y2) / 2 + 4);
  }
  ctx.restore();
}

// ── Cascade state ─────────────────────────────────────────────────────────────
function buildCascade() {
  const stages = [];
  for (let s = 0; s <= 4; s++) {
    const count = 1 << s;
    const span  = C_SPANS[s];
    const atoms = [];
    for (let j = 0; j < count; j++) {
      const y = count === 1 ? CY_CTR : CY_CTR - span / 2 + j * span / (count - 1);
      atoms.push({ x: CX[s], y, state: 'ground', flashT: 0 });
    }
    stages.push(atoms);
  }
  return stages;
}

const casc = {
  stages: buildCascade(),
  photons: [],   // {fromX,fromY,toX,toY,x,y,progress,dstS,dstJ}
  exitPhs: [],   // {x,y,alpha}
  playing: false,
  pumped: false,
  speed: 1,
};

function cascPhotonCount() {
  return casc.photons.length + casc.exitPhs.length;
}
function cascInvertedCount() {
  return casc.stages.reduce((s, st) => s + st.filter(a => a.state === 'inverted').length, 0);
}

function onCascadeArrival(ph) {
  casc.photons = casc.photons.filter(p => p !== ph);
  const atom = casc.stages[ph.dstS][ph.dstJ];
  if (atom.state !== 'inverted') return;
  atom.state = 'ground';
  atom.flashT = 30;

  if (ph.dstS < 4) {
    const ns = ph.dstS + 1;
    for (const ci of [2 * ph.dstJ, 2 * ph.dstJ + 1]) {
      const child = casc.stages[ns][ci];
      if (child.state === 'inverted') {
        casc.photons.push({
          fromX: atom.x, fromY: atom.y,
          toX: child.x,  toY: child.y,
          x: atom.x, y: atom.y, progress: 0,
          dstS: ns, dstJ: ci,
        });
      }
    }
  } else {
    for (let k = 0; k < 2; k++) {
      casc.exitPhs.push({ x: atom.x, y: atom.y + (k === 0 ? -5 : 5), alpha: 1 });
    }
  }

  document.getElementById('rd-photons').textContent  = String(cascPhotonCount());
  document.getElementById('rd-inverted').textContent = String(cascInvertedCount());
}

const CASC_PH_SPEED = 0.22; // px/ms at 1×

function tickCascade(dt) {
  if (!casc.playing) return;
  const spd = CASC_PH_SPEED * casc.speed;
  const arrivals = [];
  for (const ph of casc.photons) {
    const dist = Math.hypot(ph.toX - ph.fromX, ph.toY - ph.fromY);
    ph.progress = Math.min(1, ph.progress + (spd * dt) / dist);
    ph.x = ph.fromX + ph.progress * (ph.toX - ph.fromX);
    ph.y = ph.fromY + ph.progress * (ph.toY - ph.fromY);
    if (ph.progress >= 1) arrivals.push(ph);
  }
  arrivals.forEach(onCascadeArrival);

  for (const ep of casc.exitPhs) {
    ep.x += 2.8 * casc.speed;
    if (ep.x > C_EXIT_X + 10) ep.alpha = 0;
  }
  casc.exitPhs = casc.exitPhs.filter(ep => ep.alpha > 0);

  for (const st of casc.stages) for (const a of st) if (a.flashT > 0) a.flashT -= casc.speed;

  // Auto-stop when all done
  if (casc.photons.length === 0 && casc.exitPhs.length === 0 && casc.pumped) {
    const allGround = casc.stages.every(st => st.every(a => a.state === 'ground'));
    if (allGround) {
      casc.playing = false;
      const btn = document.getElementById('btn-casc-play');
      btn.textContent = '▶ Play';
      btn.classList.remove('playing');
    }
  }
}

// ── Full sim state ────────────────────────────────────────────────────────────
const full = {
  heAtoms: [],
  neAtoms: [],
  electrons: [],
  photons: [],
  events: [],
  simTime: 0,
  pumpTimer: 0,
  pumpCurrent: 55,
  showIR: false,
  removeHe: false,
  lasingCount: 0,
  flashL: 0,
  flashR: 0,
  playing: false,
  speed: 1,
  lastEvent: '—',
};

function initFull() {
  full.heAtoms = Array.from({ length: 14 }, () => ({
    x: rnd(GAS.x0 + 12, GAS.x1 - 12),
    y: rnd(GAS.y0 + 8,  GAS.y1 - 8),
    vx: rnd(-0.22, 0.22), vy: rnd(-0.22, 0.22),
    state: 'ground', flashT: 0, cooldown: 0,
  }));
  full.neAtoms = Array.from({ length: 10 }, () => ({
    x: rnd(GAS.x0 + 12, GAS.x1 - 12),
    y: rnd(GAS.y0 + 8,  GAS.y1 - 8),
    vx: rnd(-0.18, 0.18), vy: rnd(-0.18, 0.18),
    state: 'ground', flashT: 0, cooldown: 0,
  }));
  full.electrons = [];
  full.photons   = [];
  full.events    = [];
  full.simTime   = 0;
  full.pumpTimer = 0;
  full.lasingCount = 0;
  full.flashL = 0;
  full.flashR = 0;
  setEvent('—');
  updateFullReadouts();
}

function setEvent(text) {
  full.lastEvent = text;
  document.getElementById('rd-event').textContent = text;
}

function updateFullReadouts() {
  const nu = full.neAtoms.filter(a => a.state === 'upper').length;
  const nl = full.neAtoms.filter(a => a.state === 'lower').length;
  document.getElementById('rd-pop').textContent = `Ne upper: ${nu}, lower: ${nl}`;
  document.getElementById('rd-inv').textContent = nu > nl ? 'YES' : (nu === 0 && nl === 0 ? '—' : 'no');
  document.getElementById('rd-cav').textContent = String(full.lasingCount);
}

// ── Full sim event queue ──────────────────────────────────────────────────────
function scheduleEvent(delayMs, fn) {
  full.events.push({ time: full.simTime + delayMs, fn });
}

function processEvents() {
  const ready = full.events.filter(e => e.time <= full.simTime);
  full.events  = full.events.filter(e => e.time > full.simTime);
  for (const e of ready) e.fn();
}

// ── Full sim physics ──────────────────────────────────────────────────────────
function fireHeExcitation() {
  if (full.removeHe) return;
  const cands = full.heAtoms.filter(a => a.state === 'ground' && a.cooldown <= 0);
  if (!cands.length) return;
  const he = cands[rndI(0, cands.length)];
  he.state   = 'meta';
  he.flashT  = 30;
  he.cooldown = 200;

  // Cosmetic electron
  full.electrons.push({
    x: CATH.x + 6,
    y: rnd(CATH.y0 + 10, CATH.y1 - 10),
    vx: rnd(3.5, 5.5),
  });

  setEvent('e⁻ excites He → metastable');
  scheduleEvent(rnd(350, 850), () => fireTransfer(he));
}

function fireTransfer(he) {
  if (full.removeHe) { he.state = 'ground'; return; }
  if (he.state !== 'meta') return;

  const cands = full.neAtoms.filter(a => a.state === 'ground' && a.cooldown <= 0);
  if (!cands.length) { scheduleEvent(200, () => fireTransfer(he)); return; }

  let best = null, bestD = Infinity;
  for (const ne of cands) {
    const d = Math.hypot(ne.x - he.x, ne.y - he.y);
    if (d < bestD) { bestD = d; best = ne; }
  }

  he.state  = 'ground'; he.flashT = 20;
  best.state = 'upper'; best.flashT = 40; best.cooldown = 100;
  setEvent('He* + Ne → He + Ne* (resonant transfer)');
  scheduleEvent(rnd(400, 1100), () => neDecay(best));
}

function neDecay(ne) {
  if (ne.state !== 'upper') return;

  const laserPhs = full.photons.filter(p => p.type === 'lasing');
  const stimulated = laserPhs.length > 0 && Math.random() < 0.72;

  ne.state  = 'lower'; ne.flashT = 30;

  if (stimulated) {
    if (full.photons.filter(p => p.type === 'lasing').length < 8) {
      const vx = Math.random() < 0.5 ? 4 : -4;
      full.photons.push({ x: ne.x, y: ne.y, vx, vy: 0, type: 'lasing', alpha: 1 });
    }
    setEvent('Stimulated emission: 3s → 2p  (632.8 nm)');
  } else {
    const angle = Math.random() * Math.PI * 2;
    full.photons.push({ x: ne.x, y: ne.y, vx: Math.cos(angle) * 2.2, vy: Math.sin(angle) * 2.2, type: 'spon', alpha: 1 });

    // Seed the cavity if no lasing photons yet
    const nu = full.neAtoms.filter(a => a.state === 'upper').length;
    if (laserPhs.length === 0 && nu >= 1 && full.pumpCurrent > 25) {
      const vx2 = Math.random() < 0.5 ? 4 : -4;
      const tubeY = rnd(GAS.y0 + 15, GAS.y1 - 15);
      full.photons.push({ x: ne.x, y: tubeY, vx: vx2, vy: 0, type: 'lasing', alpha: 1 });
      setEvent('Spontaneous emission seeds the cavity!');
    } else {
      setEvent('Spontaneous emission: 3s → 2p  (632.8 nm)');
    }
  }

  if (full.showIR && Math.random() < 0.25) {
    const angle2 = Math.random() * Math.PI * 2;
    full.photons.push({ x: ne.x, y: ne.y, vx: Math.cos(angle2) * 1.8, vy: Math.sin(angle2) * 1.8, type: 'ir', alpha: 1 });
  }

  scheduleEvent(rnd(45, 115), () => neFastDecay(ne));
}

function neFastDecay(ne) {
  if (ne.state !== 'lower') return;
  ne.state = 'ground'; ne.flashT = 15; ne.cooldown = 60;
}

function tryStimulatedEmission(ph) {
  if (full.photons.filter(p => p.type === 'lasing').length >= 8) return;
  for (const ne of full.neAtoms) {
    if (ne.state !== 'upper' || ne.cooldown > 0) continue;
    if (Math.abs(ne.y - ph.y) < 22 && Math.abs(ne.x - ph.x) < 28) {
      if (Math.random() < 0.30) {
        ne.state = 'lower'; ne.flashT = 28; ne.cooldown = 60;
        const vx = ph.vx > 0 ? 4 : -4;
        full.photons.push({ x: ne.x, y: ne.y, vx, vy: 0, type: 'lasing', alpha: 1 });
        setEvent('Stimulated emission: 3s → 2p  (632.8 nm)');
        scheduleEvent(rnd(45, 110), () => neFastDecay(ne));
        return;
      }
    }
  }
}

// ── Full sim tick ─────────────────────────────────────────────────────────────
function tickFull(dt) {
  if (!full.playing) return;
  const simDt = dt * full.speed;
  full.simTime += simDt;

  // Pump timer
  if (!full.removeHe && full.pumpCurrent > 0) {
    full.pumpTimer += simDt;
    const interval = 20000 / full.pumpCurrent;
    while (full.pumpTimer >= interval) { full.pumpTimer -= interval; fireHeExcitation(); }
  }

  processEvents();

  // Move atoms
  for (const a of [...full.heAtoms, ...full.neAtoms]) {
    a.x += a.vx * full.speed; a.y += a.vy * full.speed;
    if (a.x < GAS.x0 + 7)  { a.x = GAS.x0 + 7;  a.vx =  Math.abs(a.vx); }
    if (a.x > GAS.x1 - 7)  { a.x = GAS.x1 - 7;  a.vx = -Math.abs(a.vx); }
    if (a.y < GAS.y0 + 7)  { a.y = GAS.y0 + 7;  a.vy =  Math.abs(a.vy); }
    if (a.y > GAS.y1 - 7)  { a.y = GAS.y1 - 7;  a.vy = -Math.abs(a.vy); }
    if (a.flashT  > 0) a.flashT  -= full.speed;
    if (a.cooldown > 0) a.cooldown -= full.speed;
  }

  // Move electrons
  for (const e of full.electrons) e.x += e.vx * full.speed;
  full.electrons = full.electrons.filter(e => e.x < ANOD.x + 8);

  // Move photons
  for (const p of full.photons) {
    p.x += p.vx * full.speed;
    p.y += p.vy * full.speed;

    if (p.type === 'lasing') {
      // Left mirror bounce
      if (p.x <= MHR.x1 + 3) {
        p.x = MHR.x1 + 3; p.vx = Math.abs(p.vx);
        full.flashL = 14;
        tryStimulatedEmission(p);
      }
      // Output coupler
      if (p.x >= MOC.x0 - 3) {
        if (Math.random() < 0.016) {
          p.alpha = 0; // escapes
          setEvent('Photon leaks through output coupler → output beam');
        } else {
          p.x = MOC.x0 - 3; p.vx = -Math.abs(p.vx);
          full.flashR = 14;
          tryStimulatedEmission(p);
        }
      }
      p.y = clamp(p.y, GAS.y0 + 4, GAS.y1 - 4);
    } else {
      p.alpha -= 0.014 * full.speed;
    }
  }

  full.photons = full.photons.filter(p =>
    p.alpha > 0.02 &&
    p.x > MHR.x0 - 20 && p.x < MOC.x1 + 30 &&
    p.y > GAS.y0 - 30 && p.y < GAS.y1 + 30
  );

  full.lasingCount = full.photons.filter(p => p.type === 'lasing').length;
  if (full.flashL > 0) full.flashL -= full.speed;
  if (full.flashR > 0) full.flashR -= full.speed;

  // Periodic mid-tube stimulation (photon passes near inverted Ne atom in flight)
  if (Math.random() < 0.12) {
    for (const p of full.photons) {
      if (p.type === 'lasing') tryStimulatedEmission(p);
    }
  }

  updateFullReadouts();
}

// ── Draw: Full Sim ────────────────────────────────────────────────────────────
function drawFull() {
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);
  drawTube();
  drawGasAtoms();
  drawElectrons();
  drawPhotons();
  drawOutputBeam();
  drawEnergyDiagram();
}

function drawTube() {
  ctx.save();
  // Tube body
  ctx.fillStyle = COL.tubeBody;
  ctx.strokeStyle = COL.tubeBdr;
  ctx.lineWidth = 2;
  roundRect(TUBE.x0, TUBE.y0, TUBE.x1 - TUBE.x0, TUBE.y1 - TUBE.y0, 8);
  ctx.fill(); ctx.stroke();

  // HR mirror
  const gl = clamp(full.flashL / 14, 0, 1);
  ctx.fillStyle = gl > 0 ? `rgba(80,160,255,${0.35 * gl})` : COL.hrMirror;
  ctx.fillRect(MHR.x0, MHR.y0, MHR.x1 - MHR.x0, MHR.y1 - MHR.y0);
  ctx.strokeStyle = 'rgba(120,180,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(MHR.x0, MHR.y0, MHR.x1 - MHR.x0, MHR.y1 - MHR.y0);

  // Output coupler (hatched)
  const gr = clamp(full.flashR / 14, 0, 1);
  ctx.fillStyle = gr > 0 ? `rgba(255,80,80,${0.35 * gr})` : COL.ocMirror;
  ctx.fillRect(MOC.x0, MOC.y0, MOC.x1 - MOC.x0, MOC.y1 - MOC.y0);
  ctx.strokeStyle = 'rgba(120,180,255,0.3)'; ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (let yy = MOC.y0 - 4; yy < MOC.y1; yy += 9) {
    ctx.beginPath(); ctx.moveTo(MOC.x0, yy); ctx.lineTo(MOC.x1, yy + 9); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(120,180,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(MOC.x0, MOC.y0, MOC.x1 - MOC.x0, MOC.y1 - MOC.y0);

  // Electrodes
  ctx.fillStyle = '#304a68';
  ctx.fillRect(CATH.x, CATH.y0, 5, CATH.y1 - CATH.y0);
  ctx.fillRect(ANOD.x, ANOD.y0, 5, ANOD.y1 - ANOD.y0);

  // Labels
  ctx.font = '600 10px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(140,190,255,0.85)';
  ctx.fillText('HR mirror', (MHR.x0 + MHR.x1) / 2, MHR.y0 - 7);
  ctx.fillText('Output coupler', (MOC.x0 + MOC.x1) / 2, MOC.y0 - 7);
  ctx.fillStyle = 'rgba(200,170,100,0.9)';
  ctx.fillText('−', CATH.x + 2, CATH.y1 + 13);
  ctx.fillText('+', ANOD.x + 2, ANOD.y1 + 13);
  ctx.restore();
}

function drawGasAtoms() {
  ctx.save();
  for (const a of full.heAtoms) {
    const isMeta = a.state === 'meta';
    const col = isMeta ? COL.heMeta : COL.heGnd;
    const r   = isMeta ? 6.5 : 4.5;
    const glow = (isMeta && a.flashT > 0) ? 14 * (a.flashT / 30) : (isMeta ? 6 : 0);
    dot(a.x, a.y, r, col, glow);
  }
  for (const a of full.neAtoms) {
    let col = COL.neGnd, r = 4.5, glow = 0;
    if (a.state === 'upper') { col = COL.neUpper; r = 6.5; glow = a.flashT > 0 ? 16 * (a.flashT / 40) : 7; }
    else if (a.state === 'lower') { col = COL.neLower; r = 5.5; glow = 5; }
    dot(a.x, a.y, r, col, glow);
  }

  // Compact legend inside tube
  const ly = TUBE.y1 - 9;
  const items = [
    { col: COL.heGnd, r: 3.5, label: 'He', x: 200 },
    { col: COL.heMeta, r: 4.5, label: 'He* (metastable)', x: 235 },
    { col: COL.neGnd, r: 3.5, label: 'Ne', x: 450 },
    { col: COL.neUpper, r: 4.5, label: 'Ne* (upper)', x: 490 },
    { col: COL.neLower, r: 4, label: 'Ne† (lower)', x: 640 },
  ];
  ctx.font = '600 9px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'left';
  for (const it of items) {
    ctx.fillStyle = it.col;
    ctx.beginPath(); ctx.arc(it.x, ly, it.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180,210,255,0.75)';
    ctx.fillText(it.label, it.x + it.r + 3, ly + 3);
  }
  ctx.restore();
}

function drawElectrons() {
  ctx.save();
  ctx.fillStyle = COL.electron;
  ctx.shadowColor = 'rgba(100,210,255,0.6)';
  ctx.shadowBlur = 5;
  for (const e of full.electrons) {
    ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPhotons() {
  ctx.save();
  for (const p of full.photons) {
    const col = p.type === 'lasing' ? COL.photonRed : p.type === 'ir' ? COL.photonIR : COL.photonSpo;
    const r   = p.type === 'lasing' ? 5 : 3.5;
    const glow = p.type === 'lasing' ? 12 : 4;
    ctx.globalAlpha = p.alpha;
    dot(p.x, p.y, r, col, glow);
  }
  ctx.restore();
}

function drawOutputBeam() {
  if (full.lasingCount <= 0) return;
  const intensity = clamp(full.lasingCount / 5, 0, 1);
  ctx.save();
  const bx  = MOC.x1;
  const bcy = (GAS.y0 + GAS.y1) / 2;
  const bh  = (GAS.y1 - GAS.y0) * 0.55;
  const grd = ctx.createLinearGradient(bx, 0, bx + 70, 0);
  grd.addColorStop(0, `rgba(255,60,60,${0.7 * intensity})`);
  grd.addColorStop(1, 'rgba(255,60,60,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(bx, bcy - bh / 2, 70, bh);
  ctx.restore();
}

function drawEnergyDiagram() {
  ctx.save();
  // Dim background
  const ED_X0 = 60, ED_X1 = W - 60;
  ctx.fillStyle = 'rgba(15,35,65,0.3)';
  ctx.fillRect(ED_X0, ED_Y0, ED_X1 - ED_X0, H - ED_Y0 - 8);

  // Column headers
  ctx.font = '700 13px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,230,255,0.9)';
  ctx.fillText('He', HE_CX, ED_Y0 + 18);
  ctx.fillText('Ne', NE_CX, ED_Y0 + 18);

  // Level lines
  function level(x0, x1, y, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  level(HE_CX - 55, HE_CX + 55, HE_YG,  COL.levelGnd);
  level(HE_CX - 55, HE_CX + 55, HE_YM,  COL.levelHe);
  level(NE_CX - 80, NE_CX + 80, NE_YG,  COL.levelGnd);
  level(NE_CX - 80, NE_CX + 80, NE_YU,  COL.levelNeU);
  level(NE_CX - 80, NE_CX + 80, NE_YL,  COL.levelNeL);

  // Level labels (right of Ne column)
  function lbl(text, x, y, col) {
    ctx.fillStyle = col;
    ctx.font = '600 10px "Trebuchet MS",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
  }
  lbl('metastable  (~20 eV)', HE_CX + 60, HE_YM + 4, 'rgba(255,210,80,0.85)');
  lbl('ground', HE_CX + 60, HE_YG + 4, 'rgba(160,200,120,0.7)');
  lbl('upper laser level (3s)  ~20.7 eV', NE_CX + 86, NE_YU + 4, 'rgba(0,220,120,0.9)');
  lbl('lower laser level (2p)  ~18.7 eV', NE_CX + 86, NE_YL + 4, 'rgba(200,80,255,0.85)');
  lbl('ground', NE_CX + 86, NE_YG + 4, 'rgba(100,180,255,0.7)');

  // Resonant transfer arc
  ctx.strokeStyle = full.removeHe ? 'rgba(255,80,60,0.3)' : 'rgba(255,255,140,0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(HE_CX + 55, HE_YM);
  ctx.bezierCurveTo(HE_CX + 55 + 120, HE_YM - 32, NE_CX - 80 - 120, NE_YU - 32, NE_CX - 80, NE_YU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = full.removeHe ? 'rgba(255,80,60,0.5)' : 'rgba(255,255,140,0.7)';
  ctx.font = '600 10px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  const arcMidX = (HE_CX + 55 + NE_CX - 80) / 2;
  ctx.fillText(full.removeHe ? 'He removed — no transfer' : 'resonant transfer', arcMidX, HE_YM - 38);

  // Transition arrows
  arrowDown(NE_CX - 22, NE_YU + 4, NE_YL - 4, 'rgba(255,60,60,0.9)',    '632.8 nm');
  arrowDown(NE_CX - 22, NE_YL + 4, NE_YG - 4, 'rgba(160,80,220,0.5)',   'fast decay (UV)');
  if (full.showIR) {
    arrowDown(NE_CX - 5, NE_YU + 4, NE_YL + 68, 'rgba(160,50,20,0.7)', 'IR (3.39 μm)');
  }

  // Population dots
  const heMetaCount = full.heAtoms.filter(a => a.state === 'meta').length;
  const neUpCount   = full.neAtoms.filter(a => a.state === 'upper').length;
  const neLoCount   = full.neAtoms.filter(a => a.state === 'lower').length;
  popDots(HE_CX,      HE_YM, heMetaCount, COL.heMeta);
  popDots(NE_CX - 20, NE_YU, neUpCount,   COL.neUpper);
  popDots(NE_CX + 20, NE_YL, neLoCount,   COL.neLower);

  ctx.restore();
}

function popDots(cx, levelY, count, col) {
  ctx.fillStyle = col;
  const N = Math.min(count, 10);
  for (let i = 0; i < N; i++) {
    ctx.beginPath();
    ctx.arc(cx + (i % 5) * 11 - 22, levelY - 12 - Math.floor(i / 5) * 12, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Draw: Cascade ─────────────────────────────────────────────────────────────
function drawCascade() {
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);

  // Tree guide lines
  ctx.strokeStyle = 'rgba(60,100,160,0.22)';
  ctx.lineWidth = 1;
  for (let s = 0; s < 4; s++) {
    for (let j = 0; j < casc.stages[s].length; j++) {
      const p  = casc.stages[s][j];
      const c0 = casc.stages[s + 1][2 * j];
      const c1 = casc.stages[s + 1][2 * j + 1];
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c0.x, c0.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();
    }
  }

  // Stage photon count labels
  ctx.font = '700 11px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  for (let s = 0; s <= 4; s++) {
    const allFired = casc.stages[s].every(a => a.state === 'ground');
    const fired = casc.pumped && allFired && cascPhotonCount() > 0;
    const n = fired ? (1 << (s + 1)) : '';
    ctx.fillStyle = fired ? 'rgba(255,150,60,0.9)' : 'rgba(100,140,200,0.45)';
    if (n) ctx.fillText(n + (n === 1 ? ' photon' : ' photons'), CX[s], 308);
  }

  // "×2" between stages
  ctx.fillStyle = 'rgba(160,200,255,0.55)';
  ctx.font = '700 12px "Trebuchet MS",sans-serif';
  for (let s = 0; s < 4; s++) {
    const midX = (CX[s] + CX[s + 1]) / 2;
    ctx.fillText('×2', midX, 294);
  }
  // final ×2
  ctx.fillText('×2', (CX[4] + C_EXIT_X) / 2, 294);

  // Seed entry hint
  if (casc.pumped && !casc.playing && casc.photons.length === 0 && cascInvertedCount() > 0) {
    ctx.fillStyle = 'rgba(180,220,255,0.55)';
    ctx.font = '600 11px "Trebuchet MS",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('→ press Play to launch seed photon', 58, CY_CTR + 3);
  }

  // In-flight photons
  ctx.save();
  ctx.fillStyle = COL.photonRed;
  ctx.shadowColor = COL.photonRed;
  ctx.shadowBlur = 12;
  for (const ph of casc.photons) {
    ctx.beginPath(); ctx.arc(ph.x, ph.y, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Exit photons
  ctx.save();
  ctx.fillStyle = COL.photonRed;
  ctx.shadowColor = COL.photonRed;
  ctx.shadowBlur = 9;
  for (const ep of casc.exitPhs) {
    ctx.globalAlpha = ep.alpha;
    ctx.beginPath(); ctx.arc(ep.x, ep.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Atoms
  for (let s = 0; s <= 4; s++) {
    const r = Math.max(4, 8 - s);
    for (const a of casc.stages[s]) {
      const isInv = a.state === 'inverted';
      const col   = isInv ? 'rgba(255,155,0,0.92)' : 'rgba(60,130,220,0.70)';
      const glow  = (isInv && a.flashT > 0) ? 16 * (a.flashT / 30) : (isInv ? 5 : 0);
      dot(a.x, a.y, r, col, glow);
    }
  }

  // Completion message
  const allDone = casc.pumped &&
    casc.stages.every(st => st.every(a => a.state === 'ground')) &&
    casc.photons.length === 0 && casc.exitPhs.length === 0;
  if (allDone) {
    ctx.fillStyle = 'rgba(255,200,100,0.92)';
    ctx.font = '700 14px "Trebuchet MS",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('31 inverted atoms → 32 coherent photons', W / 2, 308);
  }

  // Mini energy diagram
  drawMiniEnergyDiag();
}

function drawMiniEnergyDiag() {
  const y0  = C_MINI_Y;
  const cx  = W / 2;
  const yU  = y0 + 38;
  const yL  = y0 + 148;

  ctx.fillStyle = 'rgba(15,35,65,0.28)';
  ctx.fillRect(cx - 230, y0, 460, 172);

  ctx.font = '700 12px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200,230,255,0.85)';
  ctx.fillText('Stimulated Emission', cx, y0 + 16);

  ctx.strokeStyle = COL.levelNeU; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 80, yU); ctx.lineTo(cx + 80, yU); ctx.stroke();
  ctx.fillStyle = 'rgba(0,220,120,0.8)';
  ctx.font = '600 10px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('upper laser level (3s)', cx + 84, yU + 4);

  ctx.strokeStyle = COL.levelNeL; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 80, yL); ctx.lineTo(cx + 80, yL); ctx.stroke();
  ctx.fillStyle = 'rgba(200,80,255,0.8)';
  ctx.fillText('lower laser level (2p)', cx + 84, yL + 4);

  arrowDown(cx, yU + 4, yL - 4, 'rgba(255,60,60,0.9)', '632.8 nm');

  ctx.fillStyle = 'rgba(180,215,255,0.6)';
  ctx.font = '600 10px "Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Each passing photon triggers emission of a second identical photon.', cx, y0 + 162);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let prevT = 0;
let appMode = 'cascade';

function frame(now) {
  const dt = Math.min(50, now - prevT);
  prevT = now;
  if (appMode === 'cascade') {
    tickCascade(dt);
    drawCascade();
  } else {
    tickFull(dt);
    drawFull();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Controls ──────────────────────────────────────────────────────────────────
document.getElementById('seg-mode').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  appMode = btn.dataset.mode;
  document.querySelectorAll('#seg-mode .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('casc-controls').style.display = appMode === 'cascade' ? '' : 'none';
  document.getElementById('full-controls').style.display = appMode === 'full'    ? '' : 'none';
  if (appMode === 'full' && full.heAtoms.length === 0) initFull();
});

// Cascade
document.getElementById('btn-pump').addEventListener('click', () => {
  casc.stages = buildCascade();
  for (const st of casc.stages) for (const a of st) a.state = 'inverted';
  casc.pumped   = true;
  casc.playing  = false;
  casc.photons  = [];
  casc.exitPhs  = [];
  document.getElementById('btn-casc-play').textContent = '▶ Play';
  document.getElementById('btn-casc-play').classList.remove('playing');
  document.getElementById('rd-photons').textContent  = '—';
  document.getElementById('rd-inverted').textContent = '31';
});

document.getElementById('btn-casc-play').addEventListener('click', () => {
  if (!casc.pumped) return;
  casc.playing = !casc.playing;
  if (casc.playing && casc.photons.length === 0 && casc.stages[0][0].state === 'inverted') {
    const s0 = casc.stages[0][0];
    casc.photons.push({
      fromX: 50, fromY: CY_CTR, toX: s0.x, toY: s0.y,
      x: 50, y: CY_CTR, progress: 0, dstS: 0, dstJ: 0,
    });
    document.getElementById('rd-photons').textContent  = '1';
    document.getElementById('rd-inverted').textContent = '31';
  }
  document.getElementById('btn-casc-play').textContent = casc.playing ? '■ Pause' : '▶ Play';
  document.getElementById('btn-casc-play').classList.toggle('playing', casc.playing);
});

document.getElementById('btn-casc-reset').addEventListener('click', () => {
  casc.stages  = buildCascade();
  casc.photons = []; casc.exitPhs = [];
  casc.playing = false; casc.pumped = false;
  document.getElementById('btn-casc-play').textContent = '▶ Play';
  document.getElementById('btn-casc-play').classList.remove('playing');
  document.getElementById('rd-photons').textContent  = '—';
  document.getElementById('rd-inverted').textContent = '—';
});

document.getElementById('seg-casc-speed').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  casc.speed = parseFloat(btn.dataset.speed);
  document.querySelectorAll('#seg-casc-speed .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});

// Full sim
document.getElementById('sld-current').addEventListener('input', e => {
  full.pumpCurrent = parseInt(e.target.value);
  full.pumpTimer   = 0;
});

document.getElementById('chk-ir').addEventListener('change', e => {
  full.showIR = e.target.checked;
});

document.getElementById('chk-nohe').addEventListener('change', e => {
  full.removeHe = e.target.checked;
  if (full.removeHe) {
    for (const a of full.heAtoms) a.state = 'ground';
    full.events = full.events.filter(ev => false); // clear pending transfers
  }
});

document.getElementById('btn-full-play').addEventListener('click', () => {
  if (full.heAtoms.length === 0) initFull();
  full.playing = !full.playing;
  document.getElementById('btn-full-play').textContent = full.playing ? '■ Pause' : '▶ Play';
  document.getElementById('btn-full-play').classList.toggle('playing', full.playing);
});

document.getElementById('btn-full-reset').addEventListener('click', () => {
  full.playing = false;
  document.getElementById('btn-full-play').textContent = '▶ Play';
  document.getElementById('btn-full-play').classList.remove('playing');
  initFull();
});

document.getElementById('seg-full-speed').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  full.speed = parseFloat(btn.dataset.speed);
  document.querySelectorAll('#seg-full-speed .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
