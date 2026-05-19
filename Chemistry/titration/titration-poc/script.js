// ═════════════════════════════════════════════════════════════════
// Titration POC — Stage C
// Core loop: tap open ⇒ titrant flows ⇒ flask pH updates ⇒ indicator colours
// ═════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────
const Cb = 1.000;             // NaOH concentration, M  [TESTING: 10× real value — restore to 0.1000 for production]
const Va_mL = 25.00;           // analyte volume in flask, mL
const BURETTE_CAPACITY = 50.0; // mL
const DROP_VOLUME = 0.05;      // mL per visible drop at slow flow
const STREAM_THRESHOLD = 0.5;  // mL/s above which we render a stream

// Flow slider (0..100) maps logarithmically to [0.02, 2.0] mL/s
const FLOW_MIN = 0.02, FLOW_MAX = 2.0;
const flowFromSlider = v => FLOW_MIN * Math.pow(FLOW_MAX / FLOW_MIN, v / 100);
const sliderFromFlow = f => 100 * Math.log(f / FLOW_MIN) / Math.log(FLOW_MAX / FLOW_MIN);

// Indicator colour mapping (phenolphthalein)
const PINK_RGB = [230, 90, 160];
const pinkAlphaForPH = pH => {
  if (pH <= 8.2) return 0;
  if (pH >= 10.0) return 0.75;
  return 0.75 * (pH - 8.2) / (10.0 - 8.2);
};

// Burette geometry (SVG coords)
const BUR_X = 304, BUR_W = 32;
const BUR_TOP_Y = 80;     // y-coord for 0.00 mL mark (liquid surface at 0 dispensed)
const BUR_BOT_Y = 440;    // y-coord for 50.00 mL mark
const BUR_PX_PER_ML = (BUR_BOT_Y - BUR_TOP_Y) / BURETTE_CAPACITY;
const TIP_X = 320, TIP_Y = 540;

// Flask geometry
const FLASK_SURFACE_Y = 605;
const FLASK_BOTTOM_Y = 648;
// Local-plume pH window: drops only cause a visible pink flash when bulk is near endpoint
const PLUME_PH_MIN = 6.0;
const PLUME_PH_MAX = 9.0;

// Waste beaker geometry
const WASTE_BOTTOM_Y = 648;
const WASTE_RIM_Y = 574;
const WASTE_VISUAL_CAPACITY = 150; // mL to fill visually

// ── State ────────────────────────────────────────────────────────
let state = null;

function newTitration() {
  const Ca = 0.080 + Math.random() * (0.120 - 0.080);
  // Burette is deliberately overfilled — meniscus sits 0.4 to 0.6 mL ABOVE the 0 mL mark.
  // Student must use the waste beaker to bring it to a readable level.
  const initialReading = -(0.4 + Math.random() * 0.2);
  state = {
    Ca,                             // true HCl concentration (hidden)
    trueInitialReading: initialReading,
    Vb: 0,                          // volume added to flask (chemistry-relevant), mL
    Vb_waste: 0,                    // volume dumped into waste beaker, mL
    activeVessel: 'flask',          // 'flask' | 'waste'
    tapOpen: false,
    stirrerOn: true,
    flowRate: flowFromSlider(50),   // mL/s
    drops: [],                      // falling drops
    plumes: [],                     // in-flask pink plumes
    lastDropTime: 0,
    revealed: false,
  };
  setActiveVessel('flask');
  document.getElementById('initial-reading').value = '';
  document.getElementById('final-reading').value = '';
  document.getElementById('titre-val').textContent = '—';
  document.getElementById('reveal-panel').classList.add('hidden');
  document.getElementById('message-bar').textContent =
    'Click the burette to zoom in and read the initial level.';
  updateTitreDisplay();
}

function randNormal(mean, sd) {
  // Box-Muller
  const u1 = Math.random(), u2 = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Chemistry ────────────────────────────────────────────────────
function currentPH() {
  const Ca = state.Ca, Va = Va_mL;
  const Vb = state.Vb;
  const molesA = Ca * Va;
  const molesB = Cb * Vb;
  const totalV = Va + Vb;
  let H;
  if (Math.abs(molesA - molesB) < 1e-9) {
    H = 1e-7;
  } else if (molesA > molesB) {
    H = (molesA - molesB) / totalV;
  } else {
    const OH = (molesB - molesA) / totalV;
    H = 1e-14 / OH;
  }
  return -Math.log10(H);
}

// Burette reading a student would see = initial + everything dispensed (flask + waste)
function currentBuretteReading() {
  return state.trueInitialReading + state.Vb + state.Vb_waste;
}

// Vessel swap
function setActiveVessel(which) {
  state.activeVessel = which;
  document.getElementById('flask-group').style.display = (which === 'flask') ? '' : 'none';
  document.getElementById('waste-group').style.display = (which === 'waste') ? '' : 'none';
  const btn = document.getElementById('btn-swap');
  btn.textContent = (which === 'flask')
    ? '⇄ Swap to waste beaker'
    : '⇄ Swap to conical flask';
  // Clear any in-flight drops so they don't land in the wrong vessel
  state.drops = [];
}

// ── Input handlers ───────────────────────────────────────────────
const tapHint = document.getElementById('tap-hint');
let holdActive = false;

function openTap() {
  if (holdActive) return;
  holdActive = true;
  state.tapOpen = true;
  tapHint.setAttribute('opacity', '1');
  document.getElementById('stopcock-handle')
    .setAttribute('transform', 'rotate(90 320 492)');
}
function closeTap() {
  if (!holdActive) return;
  holdActive = false;
  state.tapOpen = false;
  tapHint.setAttribute('opacity', '0');
  document.getElementById('stopcock-handle')
    .setAttribute('transform', 'rotate(0 320 492)');
}

// Space held
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !isTypingField(e.target)) {
    e.preventDefault();
    if (!e.repeat) openTap();
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') { e.preventDefault(); closeTap(); }
});
function isTypingField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

// Mouse-hold on the stopcock
const scene = document.getElementById('scene');
const stopcockArea = document.getElementById('stopcock-handle');
// Create a larger invisible hit region for the stopcock
const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
hitRect.setAttribute('x', '292'); hitRect.setAttribute('y', '476');
hitRect.setAttribute('width', '56'); hitRect.setAttribute('height', '32');
hitRect.setAttribute('fill', 'transparent');
hitRect.style.cursor = 'pointer';
document.getElementById('burette-group').appendChild(hitRect);

hitRect.addEventListener('mousedown', e => { e.preventDefault(); openTap(); });
document.addEventListener('mouseup', closeTap);
hitRect.addEventListener('mouseleave', () => { /* keep open while mouse held */ });

// Burette click → zoom (avoid hitting stopcock)
document.getElementById('burette-group').addEventListener('click', e => {
  const pt = scene.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const svgPt = pt.matrixTransform(scene.getScreenCTM().inverse());
  // Only zoom if click is on the tube (above the stopcock)
  if (svgPt.y < 470) openZoom();
});

// Stirrer toggle
document.getElementById('stirrer-toggle').addEventListener('change', e => {
  state.stirrerOn = e.target.checked;
  document.getElementById('stirrer-led').setAttribute(
    'fill', state.stirrerOn ? '#ff6b6b' : '#555'
  );
});

// Flow slider
const flowSlider = document.getElementById('flow-slider');
const flowReadout = document.getElementById('flow-readout');
flowSlider.addEventListener('input', () => {
  state.flowRate = flowFromSlider(+flowSlider.value);
  flowReadout.value = state.flowRate.toFixed(2);
});
flowReadout.addEventListener('change', () => {
  const raw = parseFloat(flowReadout.value);
  if (isNaN(raw)) { flowReadout.value = state.flowRate.toFixed(2); return; }
  state.flowRate = Math.max(FLOW_MIN, Math.min(FLOW_MAX, raw));
  flowSlider.value = sliderFromFlow(state.flowRate);
  flowReadout.value = state.flowRate.toFixed(2);
});

// Reading inputs
['initial-reading', 'final-reading'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateTitreDisplay);
});
function parseReading(str) {
  const v = parseFloat(String(str).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? v : null;
}
function updateTitreDisplay() {
  const i = parseReading(document.getElementById('initial-reading').value);
  const f = parseReading(document.getElementById('final-reading').value);
  const out = document.getElementById('titre-val');
  if (i !== null && f !== null && f > i) {
    out.textContent = (f - i).toFixed(2) + ' mL';
  } else {
    out.textContent = '—';
  }
}

// Buttons
document.getElementById('btn-reset').addEventListener('click', newTitration);
document.getElementById('btn-reveal').addEventListener('click', revealTruth);
document.getElementById('btn-swap').addEventListener('click', () => {
  setActiveVessel(state.activeVessel === 'flask' ? 'waste' : 'flask');
});

function revealTruth() {
  // "True initial" = reading after any waste dump, before any went into the flask
  const trueInitial = state.trueInitialReading + state.Vb_waste;
  const trueFinal = trueInitial + state.Vb;
  const trueTitre = state.Vb;
  const trueCa = state.Ca;
  document.getElementById('true-initial').textContent = trueInitial.toFixed(2) + ' mL';
  document.getElementById('true-final').textContent = trueFinal.toFixed(2) + ' mL';
  document.getElementById('true-titre').textContent = trueTitre.toFixed(2) + ' mL';
  document.getElementById('true-conc').textContent = trueCa.toFixed(4) + ' M';

  const i = parseReading(document.getElementById('initial-reading').value);
  const f = parseReading(document.getElementById('final-reading').value);
  if (i !== null && f !== null && f > i) {
    const studentTitre = f - i;
    const studentCa = (Cb * studentTitre) / Va_mL;
    const pctErr = 100 * (studentCa - trueCa) / trueCa;
    document.getElementById('your-conc').textContent =
      `${studentCa.toFixed(4)} M  (${pctErr >= 0 ? '+' : ''}${pctErr.toFixed(1)}%)`;
  } else {
    document.getElementById('your-conc').textContent = 'enter both readings';
  }
  document.getElementById('reveal-panel').classList.remove('hidden');
}

// ── Zoom modal ───────────────────────────────────────────────────
const zoomModal = document.getElementById('zoom-modal');
const zoomSvg = document.getElementById('zoom-svg');
document.getElementById('zoom-close').addEventListener('click', closeZoom);
document.getElementById('zoom-done').addEventListener('click', closeZoom);
zoomModal.addEventListener('click', e => { if (e.target === zoomModal) closeZoom(); });

function openZoom() {
  renderZoom();
  zoomModal.classList.remove('hidden');
}
function closeZoom() {
  zoomModal.classList.add('hidden');
}

function renderZoom() {
  const reading = currentBuretteReading();
  // Centre the zoom window around the current level, clamped to burette range
  const windowSpan = 1.0; // mL shown
  // Centre on the meniscus, but clamp the upper (high-mL) end so we don't go off the bottom
  // of the scale. Do NOT clamp at the low end — if the burette is overfilled, the meniscus
  // sits above the 0 mL mark and the view should show that unmarked glass above the scale.
  let centre = Math.min(BURETTE_CAPACITY - windowSpan / 2, reading);
  const top = centre - windowSpan / 2;
  const bottom = centre + windowSpan / 2;

  // SVG coords: 0..500 y maps to top..bottom in mL
  const yFromML = mL => 30 + ((mL - top) / windowSpan) * 440;

  const tubeX = 90, tubeW = 140;
  let out = '';

  // Tube
  out += `<rect x="${tubeX}" y="20" width="${tubeW}" height="460"
          fill="rgba(230,240,250,0.4)" stroke="#6a829a" stroke-width="1.5" rx="4"/>`;

  // Liquid
  const liquidYTop = yFromML(reading);
  out += `<rect x="${tubeX + 2}" y="${liquidYTop}" width="${tubeW - 4}"
          height="${480 - liquidYTop}" fill="rgba(255,230,245,0.35)"/>`;

  // Meniscus — concave, with fill below and a curve the student reads
  const menDepth = 6;
  const mxL = tubeX + 0.75, mxR = tubeX + tubeW - 0.75;
  out += `<path d="M ${mxL} ${liquidYTop - menDepth}
                  Q ${tubeX + tubeW/2} ${liquidYTop + menDepth}
                    ${mxR} ${liquidYTop - menDepth}
                  L ${mxR} ${liquidYTop + 2}
                  L ${mxL} ${liquidYTop + 2} Z"
          fill="rgba(230,240,250,0.75)" stroke="none"/>`;
  out += `<path d="M ${mxL} ${liquidYTop - menDepth}
                  Q ${tubeX + tubeW/2} ${liquidYTop + menDepth}
                    ${mxR} ${liquidYTop - menDepth}"
          fill="none" stroke="#5a7a95" stroke-width="1.2"/>`;

  // Scale markings — every 0.1 mL (the real graduation), all labelled.
  // Skip anything above the 0 mL line (that's unmarked glass at the top of the burette).
  const firstTick = Math.max(0, Math.ceil(top * 10) / 10);
  for (let mL = firstTick; mL <= bottom + 1e-6; mL = +(mL + 0.1).toFixed(2)) {
    const y = yFromML(mL);
    const isWhole = Math.abs(mL - Math.round(mL)) < 1e-6;
    const tickLen = isWhole ? 36 : 28;
    const weight = isWhole ? 2.2 : 1.5;
    out += `<line x1="${tubeX}" y1="${y}" x2="${tubeX + tickLen}" y2="${y}"
            stroke="#2a2a2a" stroke-width="${weight}"/>`;
    out += `<line x1="${tubeX + tubeW - tickLen}" y1="${y}" x2="${tubeX + tubeW}" y2="${y}"
            stroke="#2a2a2a" stroke-width="${weight}"/>`;
    out += `<text x="${tubeX - 6}" y="${y + 4}" text-anchor="end"
            font-family="Courier New, monospace" font-size="14"
            font-weight="${isWhole ? 700 : 500}" fill="#2a2a2a">${mL.toFixed(1)}</text>`;
  }

  // Highlight strip
  out += `<rect x="${tubeX + 4}" y="22" width="6" height="456"
          fill="rgba(255,255,255,0.6)" rx="3"/>`;

  zoomSvg.innerHTML = out;
}

// ── Simulation step ─────────────────────────────────────────────
let lastFrameTime = performance.now();

function step(now) {
  const dtMs = now - lastFrameTime;
  const dt = Math.min(dtMs, 50) / 1000;
  lastFrameTime = now;

  // Dispense titrant
  const totalDispensed = state.Vb + state.Vb_waste;
  if (state.tapOpen && totalDispensed < BURETTE_CAPACITY - 0.01) {
    const dV = Math.min(state.flowRate * dt, BURETTE_CAPACITY - totalDispensed);
    if (state.activeVessel === 'flask') state.Vb += dV;
    else state.Vb_waste += dV;

    // Spawn visible drops/stream
    if (state.flowRate < STREAM_THRESHOLD) {
      // Discrete drops — spawn one every (DROP_VOLUME / rate) seconds
      const interval = DROP_VOLUME / state.flowRate; // seconds
      if ((now - state.lastDropTime) / 1000 >= interval) {
        spawnDrop();
        state.lastDropTime = now;
      }
    } else {
      // Stream — spawn many small packets each frame
      const packets = Math.max(1, Math.floor(dt / 0.03));
      for (let i = 0; i < packets; i++) spawnDrop(true);
    }
  }

  // Update drops
  const landingY = (state.activeVessel === 'flask')
    ? FLASK_SURFACE_Y
    : wasteSurfaceY();
  for (const d of state.drops) {
    d.y += d.vy * dt;
    d.vy += 900 * dt; // fake gravity in px/s²
    if (d.y >= landingY) {
      d.landed = true;
      if (state.activeVessel === 'flask') {
        const pH = currentPH();
        if (pH > PLUME_PH_MIN && pH < PLUME_PH_MAX) {
          spawnPlume(d.x, FLASK_SURFACE_Y + 4 + Math.random() * 30);
        }
      }
    }
  }
  state.drops = state.drops.filter(d => !d.landed);

  // Update plumes (mix into bulk)
  const mixRate = state.stirrerOn ? 1.8 : 0.25; // 1/s
  for (const p of state.plumes) {
    p.age += dt;
    p.r += (state.stirrerOn ? 18 : 6) * dt;
    p.alpha *= Math.exp(-mixRate * dt);
  }
  state.plumes = state.plumes.filter(p => p.alpha > 0.02);

  render();
  requestAnimationFrame(step);
}

function spawnDrop(isStream = false) {
  state.drops.push({
    x: TIP_X + (isStream ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 1),
    y: TIP_Y + 2,
    vy: 60 + Math.random() * 20,
    r: isStream ? 2.5 : 3.5,
    landed: false,
  });
}

function spawnPlume(x, y) {
  state.plumes.push({
    x,
    y,
    r: 4 + Math.random() * 3,
    alpha: 0.7,
    age: 0,
  });
}

// ── Render ──────────────────────────────────────────────────────
const buretteLiquidEl = document.getElementById('burette-liquid');
const buretteMeniscusFillEl = document.getElementById('burette-meniscus-fill');
const buretteMeniscusCurveEl = document.getElementById('burette-meniscus-curve');
const buretteScaleEl = document.getElementById('burette-scale');
const flaskBulkEl = document.getElementById('flask-bulk');
const plumeLayerEl = document.getElementById('plume-layer');
const dropsLayerEl = document.getElementById('drops-layer');
const stirrerBarEl = document.getElementById('stirrer-bar');
const wasteLiquidEl = document.getElementById('waste-liquid');

function wasteSurfaceY() {
  const fillFrac = Math.min(1, state.Vb_waste / WASTE_VISUAL_CAPACITY);
  return WASTE_BOTTOM_Y - fillFrac * (WASTE_BOTTOM_Y - WASTE_RIM_Y);
}

let stirrerAngle = 0;

// Build static burette scale once
(function buildBuretteScale() {
  let out = '';
  for (let mL = 0; mL <= BURETTE_CAPACITY; mL += 0.1) {
    mL = +mL.toFixed(1);
    const y = BUR_TOP_Y + mL * BUR_PX_PER_ML;
    const isMajor = Math.abs(mL - Math.round(mL)) < 1e-6;
    if (isMajor) {
      out += `<line x1="${BUR_X + 2}" y1="${y}" x2="${BUR_X + 10}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`;
      out += `<line x1="${BUR_X + BUR_W - 10}" y1="${y}" x2="${BUR_X + BUR_W - 2}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`;
      if (mL % 5 === 0) {
        out += `<text x="${BUR_X - 4}" y="${y + 3}" text-anchor="end" font-family="Courier New, monospace" font-size="9" fill="#2a2a2a">${mL.toFixed(0)}</text>`;
      }
    } else {
      out += `<line x1="${BUR_X + 2}" y1="${y}" x2="${BUR_X + 5}" y2="${y}" stroke="#555" stroke-width="0.5"/>`;
      out += `<line x1="${BUR_X + BUR_W - 5}" y1="${y}" x2="${BUR_X + BUR_W - 2}" y2="${y}" stroke="#555" stroke-width="0.5"/>`;
    }
  }
  buretteScaleEl.innerHTML = out;
})();

function render(dt) {
  // Burette liquid level
  const reading = currentBuretteReading();
  const levelY = BUR_TOP_Y + reading * BUR_PX_PER_ML;
  buretteLiquidEl.setAttribute('y', levelY);
  buretteLiquidEl.setAttribute('height', Math.max(0, BUR_BOT_Y + 30 - levelY));
  buretteLiquidEl.setAttribute('fill', 'rgba(235, 245, 255, 0.55)');
  // Meniscus — extends to the inner glass wall (tube outer rect is BUR_X-2 .. BUR_X+BUR_W+2)
  const mxL = BUR_X - 1.4, mxR = BUR_X + BUR_W + 1.4;
  buretteMeniscusFillEl.setAttribute('d',
    `M ${mxL} ${levelY - 3} Q ${BUR_X + BUR_W/2} ${levelY + 3} ${mxR} ${levelY - 3}
     L ${mxR} ${levelY + 1.5} L ${mxL} ${levelY + 1.5} Z`);
  buretteMeniscusCurveEl.setAttribute('d',
    `M ${mxL} ${levelY - 3} Q ${BUR_X + BUR_W/2} ${levelY + 3} ${mxR} ${levelY - 3}`);

  // Waste beaker fill
  if (state.activeVessel === 'waste' || state.Vb_waste > 0) {
    const surfY = wasteSurfaceY();
    wasteLiquidEl.setAttribute('y', surfY);
    wasteLiquidEl.setAttribute('height', Math.max(0, WASTE_BOTTOM_Y - surfY));
  }

  // Flask bulk colour based on true pH
  const pH = currentPH();
  const alpha = pinkAlphaForPH(pH);
  flaskBulkEl.setAttribute('fill', `rgba(${PINK_RGB[0]}, ${PINK_RGB[1]}, ${PINK_RGB[2]}, ${alpha.toFixed(3)})`);

  // Plumes
  let plumeHTML = '';
  for (const p of state.plumes) {
    plumeHTML += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}"
                  fill="rgba(${PINK_RGB[0]}, ${PINK_RGB[1]}, ${PINK_RGB[2]}, ${p.alpha.toFixed(3)})"/>`;
  }
  plumeLayerEl.innerHTML = plumeHTML;

  // Drops
  let dropHTML = '';
  for (const d of state.drops) {
    dropHTML += `<ellipse cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" rx="${d.r * 0.7}" ry="${d.r}"
                 fill="rgba(200, 220, 240, 0.7)" stroke="rgba(120,160,200,0.6)" stroke-width="0.5"/>`;
  }
  dropsLayerEl.innerHTML = dropHTML;

  // Stirrer bar — spins about vertical axis, so from the side it squashes/stretches horizontally
  if (state.stirrerOn) {
    stirrerAngle = (stirrerAngle + 0.25) % (Math.PI * 2);
    const sx = Math.max(0.05, Math.abs(Math.cos(stirrerAngle)));
    stirrerBarEl.setAttribute('transform', `translate(320 645) scale(${sx.toFixed(3)} 1)`);
  }

  // Warn if burette empty
  if (state.Vb >= BURETTE_CAPACITY - 0.01 && state.tapOpen) {
    document.getElementById('message-bar').textContent = 'Burette is empty.';
  }
}

// ── Boot ────────────────────────────────────────────────────────
newTitration();
requestAnimationFrame(t => { lastFrameTime = t; step(t); });
