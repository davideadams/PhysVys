// Stage A — Making a Standard Solution (pass 2)
// Adds: volumetric flask, funnel, wash bottle, transfer, rinse, swirl/dissolve,
// meniscus zoom, "Done" recording with reveal.

(() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────
  const BOAT_MASS_G          = 2.4567;     // tare reminder
  const POUR_RATE_G_PER_S    = 0.15;       // reagent jar → boat
  const TRANSFER_RETENTION   = 0.04;       // 4% mass stays as boat residue after tipping
  const FUNNEL_RETENTION     = 0.015;      // 1.5% of transferred passes funnel as residue
  const RINSE_WATER_ML       = 6;          // water added per rinse squeeze
  const RINSE_DURATION_MS    = 600;        // length of one rinse pulse
  const FILL_RATE_ML_PER_S   = 6;          // wash bottle into flask
  const SWIRL_DISSOLVE_G_PS  = 0.40;       // undissolved → dissolved while swirling (with water)
  const FLASK_NOMINAL_ML     = 250.0;
  const FLASK_VOLUME_ERR_ML  = 0.15;       // ± Class A tolerance @ 250 mL

  // Balance display jitter
  const LAST_DIGIT_IDLE_MS   = 3000;
  const LAST_DIGIT_ACTIVE_MS = 120;
  const MOUSE_SPEED_SCALE    = 1500;

  // Geometry (must match SVG)
  const BOAT_CENTER          = { x: 130, y: 245 };
  const FLASK_CENTER_X       = 460;
  const FLASK_NECK_TOP_Y     = 50;
  const FLASK_NECK_BOTTOM_Y  = 235;
  const FLASK_BULB_BOTTOM_Y  = 347;        // visible bulb base sits ~3 px above bench (y=350)
  const FLASK_MARK_Y         = 140;        // y-coord of the 250 mL line on the SVG
  const FUNNEL_MOUTH_Y       = 2;          // top of funnel cone (where transfer particles spawn)
  const NECK_INNER_X_L       = 447.2;      // inner glass walls (for meniscus geometry)
  const NECK_INNER_X_R       = 472.8;
  const BULB_VOLUME_ML       = 200;        // volume to fill bulb up to neck base
  const NECK_VOLUME_AT_MARK  = FLASK_NOMINAL_ML - BULB_VOLUME_ML;  // 50 mL in the neck

  // ── State ──────────────────────────────────────────────
  const state = {
    held: null,                     // { kind: 'equip'|'tool'|'reagent', id }
    bench: { balance: false, boat: false, volflask: false, funnel: false },
    boat:  { contents: null, residue_g: 0 },     // residue separate from contents (sticks after tip)
    flask: {                                     // contents of the volumetric flask
      reagentId: null,
      dissolved_g: 0,
      undissolved_g: 0,
      water_mL: 0,
      // Hidden calibration error: actual volume when bottom of meniscus sits on the mark.
      trueVolumeAtMark_mL: FLASK_NOMINAL_ML + (Math.random() - 0.5) * 2 * FLASK_VOLUME_ERR_ML,
    },
    funnel: { residue_g: 0, reagentId: null },
    tareOffset_g: 0,
    pouring: false,
    swirling: false,
    filling: false,
    transferring: false,                          // brief animation state after click-tip
    transferEndsAt: 0,
    rinsing: null,                                // { target: 'boat'|'funnel', endsAt }
    lastTick_ms: null,
    t0_ms: performance.now(),
    mouse: { x: null, y: null, t: 0, speed: 0 },
    lastDigit: 0,
    lastDigitChange_ms: 0,
    swirlPhase: 0,                                // for wobble animation
  };

  // ── DOM ────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const scene           = $('scene');
  const sceneWrap       = document.querySelector('.scene-wrap');
  const balanceSlot     = $('balance-slot');
  const balanceGroup    = $('balance-group');
  const boatGroup       = $('boat-group');
  const boatPile        = $('boat-pile');
  const balanceReadout  = $('balance-readout');
  const pourLayer       = $('pour-layer');
  const streamLayer     = $('stream-layer');
  const heldPreview     = $('held-preview');
  const messageBar      = $('message-bar');
  const reagentList     = $('reagent-list');
  const equipList       = $('equip-list');
  const drawerHint      = $('drawer-hint');
  const nbReagentSel    = $('nb-reagent');
  const nbMassInput     = $('nb-mass');
  const nbVolInput      = $('nb-volume');
  const atomicGrid      = $('atomic-grid');
  const btnTare         = $('btn-tare');
  const btnReset        = $('btn-balance-reset');
  const btnDone         = $('btn-done');
  const btnReveal       = $('btn-reveal');
  const revealPanel     = $('reveal-panel');

  const volflaskSlot    = $('volflask-slot');
  const volflaskGroup   = $('volflask-group');
  const flaskLiquid     = $('flask-liquid');
  const flaskMeniscusFill  = $('flask-meniscus-fill');
  const flaskMeniscusCurve = $('flask-meniscus-curve');
  const flaskPile       = $('flask-pile');
  const stopperGroup    = $('stopper-group');
  const flaskZoomHit    = $('flask-zoom-hit');
  const flaskSwirlHit   = $('flask-swirl-hit');
  const funnelSlot      = $('funnel-slot');
  const funnelGroup     = $('funnel-group');
  const funnelHit       = $('funnel-hit');

  const zoomModal       = $('zoom-modal');
  const zoomClose       = $('zoom-close');
  const zoomDone        = $('zoom-done');
  const zoomSvg         = $('zoom-svg');

  // ── Static data ───────────────────────────────────────
  const REAGENTS = window.REAGENTS || {};
  const ATOMIC   = window.ATOMIC_MASSES || {};

  Object.values(REAGENTS).forEach((r) => {
    const li = document.createElement('li');
    li.className = 'drawer-item';
    li.dataset.reagent = r.id;
    li.innerHTML = `
      <span class="item-swatch" style="background:${r.appearance.colour}"></span>
      <span class="item-label">${r.name}</span>
    `;
    reagentList.appendChild(li);

    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    nbReagentSel.appendChild(opt);
  });

  Object.entries(ATOMIC).forEach(([sym, m]) => {
    const el = document.createElement('span');
    el.innerHTML = `<span class="sym">${sym}</span> ${m.toFixed(2)}`;
    atomicGrid.appendChild(el);
  });

  // ── Helpers ────────────────────────────────────────────
  const setMessage = (msg) => { messageBar.textContent = msg; };

  function reagentColour(id) {
    return REAGENTS[id]?.appearance?.colour || '#f5f3ee';
  }

  // ── Pickup / place flow ────────────────────────────────
  function pickUp(kind, id) {
    if (state.held) return;

    if (kind === 'equip') {
      if (id === 'balance' && state.bench.balance) return;
      if (id === 'boat'    && state.bench.boat)    return;
      if (id === 'volflask'&& state.bench.volflask) return;
      if (id === 'funnel'  && state.bench.funnel)   return;

      if (id === 'boat' && !state.bench.balance) {
        setMessage('Place the balance first — the boat sits on its pan.'); return;
      }
      if (id === 'funnel' && !state.bench.volflask) {
        setMessage('Place the volumetric flask first — the funnel sits in its neck.'); return;
      }
    }

    if (kind === 'tool' && id === 'spatula') {
      setMessage('The spatula stays near the reagent jar — click a reagent directly to pour.');
      return;
    }

    if (kind === 'reagent') {
      if (!state.bench.boat) {
        setMessage('Place the weighing boat on the balance pan first.'); return;
      }
      if (state.boat.contents && state.boat.contents.reagentId !== id) {
        setMessage('Clear the pan first — the boat already has a different reagent.'); return;
      }
    }

    state.held = { kind, id };
    sceneWrap.classList.add('holding');
    updateDrawerUI();
    updateHeldPreview();
    showSlots();

    if (kind === 'equip') {
      const labels = {
        balance: 'the balance', boat: 'the weighing boat',
        volflask: 'the volumetric flask', funnel: 'the funnel',
      };
      setMessage(`Holding ${labels[id]}. Click on the bench to place it.`);
    } else if (kind === 'tool' && id === 'washbottle') {
      setMessage('Holding the wash bottle. Click and hold on the flask to fill, ' +
                 'or on the boat/funnel to rinse residue into the flask.');
    } else if (kind === 'reagent') {
      setMessage(`Holding ${REAGENTS[id].name}. Click and hold on the boat to pour.`);
    }
  }

  function cancelHeld() {
    state.held = null;
    state.pouring = false;
    state.filling = false;
    state.rinsing = null;
    sceneWrap.classList.remove('holding');
    updateDrawerUI();
    updateHeldPreview();
    showSlots();
  }

  function updateDrawerUI() {
    document.querySelectorAll('.drawer-item').forEach((el) => {
      el.classList.remove('held', 'placed');
      const equip = el.dataset.equip;
      const reag  = el.dataset.reagent;
      if (equip === 'balance'  && state.bench.balance)  el.classList.add('placed');
      if (equip === 'boat'     && state.bench.boat)     el.classList.add('placed');
      if (equip === 'volflask' && state.bench.volflask) el.classList.add('placed');
      if (equip === 'funnel'   && state.bench.funnel)   el.classList.add('placed');
      if (state.held) {
        if (state.held.kind === 'equip'   && state.held.id === equip) el.classList.add('held');
        if (state.held.kind === 'reagent' && state.held.id === reag)  el.classList.add('held');
        if (state.held.kind === 'tool'    && state.held.id === equip) el.classList.add('held');
      }
    });
  }

  // ── Held preview / placement slots ─────────────────────
  function updateHeldPreview(clientX, clientY) {
    if (!state.held) { heldPreview.style.display = 'none'; heldPreview.innerHTML = ''; return; }
    heldPreview.style.display = '';
    if (clientX == null) return;
    const pt = scene.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const { x, y } = pt.matrixTransform(scene.getScreenCTM().inverse());

    let m = '';
    if (state.held.kind === 'equip' && state.held.id === 'balance') {
      m = `<rect x="${x-60}" y="${y-25}" width="120" height="50" fill="#d9d1c4" stroke="#5a4a3a" stroke-width="1" rx="4" opacity="0.7"/>`;
    } else if (state.held.kind === 'equip' && state.held.id === 'boat') {
      m = `<path d="M ${x-40} ${y-6} L ${x-30} ${y+6} L ${x+30} ${y+6} L ${x+40} ${y-6} Z" fill="#e6ddc8" stroke="#8a7555" stroke-width="1" opacity="0.8"/>`;
    } else if (state.held.kind === 'equip' && state.held.id === 'volflask') {
      // Reuse the actual flask outline so the preview matches the placed object.
      // Source flask spans (~398..522, 80..345); centre at (460, 212), so translate it
      // onto the cursor and scale 0.45.
      const s = 0.45;
      m = `<g transform="translate(${x - 460*s} ${y - 212*s}) scale(${s})" opacity="0.75">
        <path d="M 446 80 L 446 265 Q 446 285 434 292 A 55 45 0 1 0 486 292 Q 474 285 474 265 L 474 80"
              fill="rgba(230,240,250,0.45)" stroke="#6a829a" stroke-width="3.2"
              stroke-linejoin="round" stroke-linecap="round"/>
      </g>`;
    } else if (state.held.kind === 'equip' && state.held.id === 'funnel') {
      // Cone + tube (no internal box artefact: tube has fill but only side strokes).
      m = `<g opacity="0.85">
        <path d="M ${x-32} ${y-18} L ${x+32} ${y-18} L ${x+8} ${y+8} L ${x-8} ${y+8} Z"
              fill="rgba(230,240,250,0.45)" stroke="#6a829a"
              stroke-width="1.2" stroke-linejoin="round"/>
        <rect x="${x-8}" y="${y+8}" width="16" height="14"
              fill="rgba(230,240,250,0.3)" stroke="none"/>
        <line x1="${x-8}" y1="${y+8}" x2="${x-8}" y2="${y+22}"
              stroke="#6a829a" stroke-width="1.2"/>
        <line x1="${x+8}" y1="${y+8}" x2="${x+8}" y2="${y+22}"
              stroke="#6a829a" stroke-width="1.2"/>
      </g>`;
    } else if (state.held.kind === 'tool' && state.held.id === 'washbottle') {
      m = `<g opacity="0.85">
        <rect x="${x-12}" y="${y-4}" width="24" height="34" rx="4" fill="#eaf6ff" stroke="#4a7090" stroke-width="1.2"/>
        <path d="M ${x-2} ${y-4} L ${x+1} ${y-22} L ${x+22} ${y-22}" fill="none" stroke="#4a7090" stroke-width="1.4"/>
      </g>`;
    } else if (state.held.kind === 'reagent') {
      m = `<circle cx="${x}" cy="${y}" r="8" fill="${reagentColour(state.held.id)}" stroke="#8a7555" stroke-width="1" opacity="0.85"/>`;
    }
    heldPreview.innerHTML = m;
  }

  function showSlots() {
    const h = state.held;
    balanceSlot.style.display =
      (h && h.kind === 'equip' && h.id === 'balance' && !state.bench.balance) ? '' : 'none';
    volflaskSlot.style.display =
      (h && h.kind === 'equip' && h.id === 'volflask' && !state.bench.volflask) ? '' : 'none';
    funnelSlot.style.display =
      (h && h.kind === 'equip' && h.id === 'funnel'
        && state.bench.volflask && !state.bench.funnel) ? '' : 'none';
  }

  // ── Drawer clicks ──────────────────────────────────────
  equipList.addEventListener('click', (e) => {
    const li = e.target.closest('.drawer-item');
    if (!li) return;
    const id = li.dataset.equip;
    const kind = (id === 'spatula' || id === 'washbottle') ? 'tool' : 'equip';
    if (state.held && state.held.kind === kind && state.held.id === id) {
      cancelHeld(); return;
    }
    if (!state.held) pickUp(kind, id);
  });

  reagentList.addEventListener('click', (e) => {
    const li = e.target.closest('.drawer-item');
    if (!li) return;
    const id = li.dataset.reagent;
    if (state.held && state.held.kind === 'reagent' && state.held.id === id) {
      cancelHeld(); return;
    }
    if (!state.held) pickUp('reagent', id);
  });

  // ── Bench click: place equipment ───────────────────────
  scene.addEventListener('click', (e) => {
    if (!state.held || state.held.kind !== 'equip') return;
    const id = state.held.id;

    if (id === 'balance') {
      state.bench.balance = true;
      balanceGroup.style.display = '';
      cancelHeld();
      setMessage('Balance placed. Now fetch the weighing boat.');
    } else if (id === 'boat' && state.bench.balance) {
      state.bench.boat = true;
      boatGroup.style.display = '';
      cancelHeld();
      setMessage('Boat placed. Press TARE to zero, then pour a primary standard.');
    } else if (id === 'volflask') {
      state.bench.volflask = true;
      volflaskGroup.style.display = '';
      cancelHeld();
      setMessage('Volumetric flask placed. Add the funnel before transferring solid.');
    } else if (id === 'funnel' && state.bench.volflask) {
      state.bench.funnel = true;
      funnelGroup.style.display = '';
      stopperGroup.style.display = 'none';
      cancelHeld();
      setMessage('Funnel placed. Click the boat to tip its contents into the flask.');
    }
  });

  scene.addEventListener('mousemove', (e) => {
    if (state.held) updateHeldPreview(e.clientX, e.clientY);
  });

  // Hide held-item preview when the cursor leaves the bench area.
  scene.addEventListener('mouseleave', () => {
    heldPreview.innerHTML = '';
  });

  // ── Boat interactions ──────────────────────────────────
  boatGroup.addEventListener('mousedown', (e) => {
    // Pour reagent onto boat
    if (state.held && state.held.kind === 'reagent') {
      if (state.boat.contents && state.boat.contents.reagentId !== state.held.id) return;
      state.pouring = true;
      e.preventDefault();
      return;
    }
    // Rinse boat (wash bottle held)
    if (state.held && state.held.kind === 'tool' && state.held.id === 'washbottle') {
      startRinse('boat');
      e.preventDefault();
      return;
    }
  });

  // Click (no held item) on boat = tip into flask via funnel
  boatGroup.addEventListener('click', (e) => {
    if (state.held) return;
    if (!state.boat.contents || state.boat.contents.mass_g <= 0) return;
    if (!state.bench.volflask || !state.bench.funnel) {
      setMessage('Set up the volumetric flask and funnel before transferring.');
      return;
    }
    tipBoatIntoFlask();
  });

  // ── Funnel rinse / remove ──────────────────────────────
  funnelHit.addEventListener('mousedown', (e) => {
    if (!state.held || state.held.kind !== 'tool' || state.held.id !== 'washbottle') return;
    startRinse('funnel');
    e.preventDefault();
  });

  // Click the funnel with no held item to remove it (back to the drawer).
  // Important procedurally: students should remove the funnel before topping
  // up to the mark, so water doesn't drip down the neck above the line.
  funnelHit.addEventListener('click', (e) => {
    if (state.held) return;
    if (!state.bench.funnel) return;
    state.bench.funnel = false;
    funnelGroup.style.display = 'none';
    // Leave the neck open (no stopper) — student tops up, then conceptually caps it later.
    if (state.funnel.residue_g > 0) {
      setMessage(`Funnel removed with ${state.funnel.residue_g.toFixed(4)} g of residue still on it — that mass never made it into the flask.`);
      state.funnel.residue_g = 0;
      state.funnel.reagentId = null;
    } else {
      setMessage('Funnel removed. Now you can top up to the mark with the wash bottle.');
    }
    updateDrawerUI();
  });

  // Affordance: hovering the funnel with nothing held shows a "remove" cursor.
  funnelHit.addEventListener('mouseenter', () => {
    if (!state.held) funnelHit.style.cursor = 'pointer';
    else funnelHit.style.cursor = '';
  });

  // ── Flask interactions: zoom / swirl / fill ───────────
  flaskZoomHit.addEventListener('click', (e) => {
    if (state.held) return;
    openZoomModal();
  });

  flaskSwirlHit.addEventListener('mousedown', (e) => {
    if (state.held && state.held.kind === 'tool' && state.held.id === 'washbottle') {
      // Wash bottle squirting into flask = filling
      state.filling = true;
      e.preventDefault();
      return;
    }
    if (!state.held) {
      state.swirling = true;
      e.preventDefault();
    }
  });

  // Wash bottle clicked anywhere on the flask group also fills
  volflaskGroup.addEventListener('mousedown', (e) => {
    if (e.target === flaskZoomHit || e.target === flaskSwirlHit) return;
    if (state.held && state.held.kind === 'tool' && state.held.id === 'washbottle') {
      state.filling = true;
      e.preventDefault();
    }
  });

  window.addEventListener('mouseup', () => {
    state.pouring = false;
    state.swirling = false;
    state.filling = false;
  });

  // ── Tare / clear ───────────────────────────────────────
  btnTare.addEventListener('click', () => {
    if (!state.bench.balance) return;
    state.tareOffset_g = currentGrossMass();
    setMessage('Balance tared.');
  });
  btnReset.addEventListener('click', () => {
    if (!state.bench.balance) return;
    state.boat.contents = null;
    state.boat.residue_g = 0;
    state.tareOffset_g = 0;
    setMessage('Pan cleared.');
  });

  // ── Mouse speed tracker ────────────────────────────────
  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    const m = state.mouse;
    if (m.x != null) {
      const dt = Math.max(0.001, (now - m.t) / 1000);
      const dx = e.clientX - m.x, dy = e.clientY - m.y;
      const inst = Math.hypot(dx, dy) / dt;
      const a = 1 - Math.exp(-dt / 0.3);
      m.speed = m.speed * (1 - a) + inst * a;
    }
    m.x = e.clientX; m.y = e.clientY; m.t = now;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!zoomModal.classList.contains('hidden')) closeZoomModal();
      else if (state.held) cancelHeld();
    }
  });

  // ── Mass model ─────────────────────────────────────────
  function currentGrossMass() {
    let m = 0;
    if (state.bench.boat) m += BOAT_MASS_G;
    if (state.boat.contents) m += state.boat.contents.mass_g;
    m += state.boat.residue_g;
    return m;
  }

  function formattedMass(now_ms) {
    if (!state.bench.balance) return '0.000';
    const net = currentGrossMass() - state.tareOffset_g;
    const speedFrac = Math.min(1, state.mouse.speed / MOUSE_SPEED_SCALE);
    const interval =
      LAST_DIGIT_IDLE_MS + (LAST_DIGIT_ACTIVE_MS - LAST_DIGIT_IDLE_MS) * speedFrac;
    if (now_ms - state.lastDigitChange_ms > interval) {
      const step = Math.random() < 0.5 ? -1 : 1;
      state.lastDigit = (state.lastDigit + step * (1 + (Math.random() < 0.3 ? 1 : 0)) + 10) % 10;
      state.lastDigitChange_ms = now_ms;
    }
    const displayed = net + (state.lastDigit - 4.5) * 0.0001;
    const r = Math.round(displayed * 1000) / 1000;
    const sign = r < 0 ? '−' : '';
    const abs = Math.abs(r);
    const intPart = Math.floor(abs);
    const milli = Math.round((abs - intPart) * 1000);
    return `${sign}${intPart}.${String(milli).padStart(3, '0')}`;
  }

  // ── Boat pile visual ───────────────────────────────────
  function updateBoatPile() {
    if (!state.bench.boat) { boatPile.setAttribute('d', ''); return; }
    const c = state.boat.contents;
    const totalMass = (c ? c.mass_g : 0) + state.boat.residue_g;
    if (totalMass <= 0) { boatPile.setAttribute('d', ''); return; }
    const colour = reagentColour(c?.reagentId || state.flask.reagentId);
    boatPile.setAttribute('fill', colour);
    const h = Math.min(18, 3 + 8 * Math.cbrt(totalMass));
    const w = Math.min(78, 30 + 26 * Math.cbrt(totalMass));
    const cx = BOAT_CENTER.x, baseY = BOAT_CENTER.y;
    boatPile.setAttribute('d',
      `M ${cx-w/2} ${baseY} Q ${cx-w/4} ${baseY-h} ${cx} ${baseY-h} Q ${cx+w/4} ${baseY-h} ${cx+w/2} ${baseY} Z`);
  }

  // ── Flask liquid level rendering ───────────────────────
  function liquidYForVolume(v_mL) {
    if (v_mL <= 0) return FLASK_BULB_BOTTOM_Y;
    if (v_mL <= BULB_VOLUME_ML) {
      const f = v_mL / BULB_VOLUME_ML;
      return FLASK_BULB_BOTTOM_Y - f * (FLASK_BULB_BOTTOM_Y - FLASK_NECK_BOTTOM_Y);
    }
    // Past bulb: fill into neck. mark is at 250 mL → y=FLASK_MARK_Y
    const slope = (FLASK_MARK_Y - FLASK_NECK_BOTTOM_Y) / NECK_VOLUME_AT_MARK;
    return Math.max(FLASK_NECK_TOP_Y, FLASK_NECK_BOTTOM_Y + (v_mL - BULB_VOLUME_ML) * slope);
  }

  function updateFlaskRender() {
    if (!state.bench.volflask) return;
    const y = liquidYForVolume(state.flask.water_mL);
    flaskLiquid.setAttribute('y', y);
    flaskLiquid.setAttribute('height', Math.max(0, FLASK_BULB_BOTTOM_Y - y));

    // Tint by dissolved reagent (colourless for current reagents, but ready for future)
    flaskLiquid.setAttribute('fill', 'rgba(160, 200, 230, 0.5)');

    // Meniscus only when the liquid surface is up in the narrow neck.
    if (state.flask.water_mL > BULB_VOLUME_ML && y < FLASK_NECK_BOTTOM_Y) {
      const cx = FLASK_CENTER_X;
      const xL = NECK_INNER_X_L;
      const xR = NECK_INNER_X_R;
      const bow = 1.8;
      // Crescent: walls raised by `bow`, centre dipped to y. Closed at y for fill.
      flaskMeniscusFill.setAttribute('d',
        `M ${xL} ${y - bow} Q ${cx} ${y + bow} ${xR} ${y - bow} L ${xR} ${y} L ${xL} ${y} Z`);
      flaskMeniscusCurve.setAttribute('d',
        `M ${xL} ${y - bow} Q ${cx} ${y + bow} ${xR} ${y - bow}`);
    } else {
      flaskMeniscusFill.setAttribute('d', '');
      flaskMeniscusCurve.setAttribute('d', '');
    }

    // Undissolved pile at bottom of bulb
    if (state.flask.undissolved_g > 0 && state.flask.reagentId) {
      flaskPile.setAttribute('fill', reagentColour(state.flask.reagentId));
      const m = state.flask.undissolved_g;
      const w = Math.min(78, 28 + 24 * Math.cbrt(m));
      const h = Math.min(18, 3 + 7 * Math.cbrt(m));
      const cx = FLASK_CENTER_X, baseY = FLASK_BULB_BOTTOM_Y;
      flaskPile.setAttribute('d',
        `M ${cx-w/2} ${baseY} Q ${cx-w/4} ${baseY-h} ${cx} ${baseY-h} Q ${cx+w/4} ${baseY-h} ${cx+w/2} ${baseY} Z`);
    } else {
      flaskPile.setAttribute('d', '');
    }

    // Swirl wobble: animate flask group transform slightly
    const wob = state.swirling ? Math.sin(state.swirlPhase) * 0.04 : 0;
    volflaskGroup.setAttribute('transform',
      `rotate(${(wob*180/Math.PI).toFixed(2)} ${FLASK_CENTER_X} 320)`);
  }

  // ── Particles (boat-pour & transfer & rinse splashes) ──
  const particles = [];

  function spawnBoatPourParticle() {
    if (!state.held || state.held.kind !== 'reagent') return;
    const r = REAGENTS[state.held.id];
    particles.push({
      kind: 'free',
      x: BOAT_CENTER.x - 10 + Math.random() * 20,
      y: 150,
      vy: 180 + Math.random() * 60,
      targetY: 240,
      colour: r.appearance.colour,
      size: 1.8 + Math.random() * 1.2,
    });
  }

  function spawnTransferParticle(reagentId) {
    // Falls from above the funnel into the flask neck
    particles.push({
      kind: 'free',
      x: FLASK_CENTER_X - 8 + Math.random() * 16,
      y: FUNNEL_MOUTH_Y - 4,
      vy: 120 + Math.random() * 60,
      targetY: liquidYForVolume(state.flask.water_mL) - 2,
      colour: reagentColour(reagentId),
      size: 1.7 + Math.random() * 1.2,
    });
  }

  function renderParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 380 * dt;
      p.y += p.vy * dt;
      const tgt = p.targetY ?? p.y + 1;
      if (p.y >= tgt) particles.splice(i, 1);
    }
    pourLayer.innerHTML = particles
      .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.size}" fill="${p.colour}"/>`)
      .join('');
  }

  // ── Wash bottle stream rendering ───────────────────────
  function renderStream() {
    let html = '';
    if (state.filling && state.bench.volflask) {
      // From above the flask neck down to current liquid level (or just below the mouth if neck is full)
      const yTop = state.bench.funnel ? FUNNEL_MOUTH_Y - 2 : FLASK_NECK_TOP_Y - 2;
      const yBot = liquidYForVolume(state.flask.water_mL);
      html += `<rect x="${FLASK_CENTER_X-2}" y="${yTop}" width="4" height="${Math.max(0, yBot-yTop)}"
              fill="rgba(120, 180, 220, 0.7)"/>`;
    }
    if (state.rinsing) {
      const tgt = state.rinsing.target;
      let x = 0, yTop = 0, yBot = 0;
      if (tgt === 'boat') {
        x = BOAT_CENTER.x; yTop = 180; yBot = 245;
      } else if (tgt === 'funnel') {
        x = FLASK_CENTER_X; yTop = 5; yBot = 30;
      }
      html += `<rect x="${x-2}" y="${yTop}" width="4" height="${yBot-yTop}"
              fill="rgba(120, 180, 220, 0.7)"/>`;
    }
    streamLayer.innerHTML = html;
  }

  // ── Tip boat into flask ────────────────────────────────
  function tipBoatIntoFlask() {
    const c = state.boat.contents;
    if (!c || c.mass_g <= 0) return;
    const transferred = c.mass_g * (1 - TRANSFER_RETENTION);
    const boatRetained = c.mass_g - transferred;
    const funnelKept = transferred * FUNNEL_RETENTION;
    const intoFlask = transferred - funnelKept;

    state.boat.residue_g += boatRetained;
    state.boat.contents = null;
    state.funnel.residue_g += funnelKept;
    state.funnel.reagentId = c.reagentId;
    state.flask.reagentId = c.reagentId;
    state.flask.undissolved_g += intoFlask;

    // Animate ~30 falling particles
    let n = 30;
    const interval = setInterval(() => {
      spawnTransferParticle(c.reagentId);
      if (--n <= 0) clearInterval(interval);
    }, 18);

    setMessage('Solid transferred. Some residue remains in the boat and funnel — rinse them with the wash bottle.');
  }

  // ── Rinse pulse ────────────────────────────────────────
  function startRinse(target) {
    if (!state.bench.volflask) {
      setMessage('Set up the volumetric flask before rinsing — there\'s nowhere for the rinse to go.');
      return;
    }
    state.rinsing = { target, endsAt: performance.now() + RINSE_DURATION_MS };

    if (target === 'boat') {
      const m = state.boat.residue_g;
      if (m > 0) {
        // Residue is the same reagent that was in the boat; track via flask.reagentId
        // Use the reagent the boat last held. We keep this in funnel.reagentId or recover from contents.
        const rid = state.flask.reagentId || state.funnel.reagentId;
        if (rid) {
          state.flask.undissolved_g += m;
          state.flask.reagentId = rid;
        }
        state.boat.residue_g = 0;
      }
      state.flask.water_mL += RINSE_WATER_ML;
      setMessage('Rinsing the boat into the flask. Residue is being washed across.');
    } else if (target === 'funnel') {
      const m = state.funnel.residue_g;
      if (m > 0 && state.funnel.reagentId) {
        state.flask.undissolved_g += m;
        state.flask.reagentId = state.funnel.reagentId;
        state.funnel.residue_g = 0;
      }
      state.flask.water_mL += RINSE_WATER_ML;
      setMessage('Rinsing the funnel.');
    }
  }

  // ── Zoom modal ────────────────────────────────────────
  function openZoomModal() {
    zoomModal.classList.remove('hidden');
    renderZoom();
  }
  function closeZoomModal() {
    zoomModal.classList.add('hidden');
  }
  zoomClose.addEventListener('click', closeZoomModal);
  zoomDone.addEventListener('click', closeZoomModal);
  zoomModal.addEventListener('click', (e) => {
    if (e.target === zoomModal) closeZoomModal();
  });

  function renderZoom() {
    // Show a tall slice of the flask neck centered on the mark — derived from
    // FLASK_MARK_Y so this never falls out of sync with the scene flask.
    const Y0_FL = FLASK_MARK_Y - 40, Y1_FL = FLASK_MARK_Y + 40;
    const Y0_Z  = 60,                Y1_Z  = 380;
    const NECK_X0_Z = 90, NECK_X1_Z = 230;  // wide neck

    const mapY = (yFl) => Y0_Z + (yFl - Y0_FL) / (Y1_FL - Y0_FL) * (Y1_Z - Y0_Z);
    const markYZ = mapY(FLASK_MARK_Y);
    const liquidYFl = liquidYForVolume(state.flask.water_mL);
    const liquidYZ = mapY(liquidYFl);

    // Meniscus geometry
    const cx = (NECK_X0_Z + NECK_X1_Z) / 2;
    const innerLeft  = NECK_X0_Z + 1.5;
    const innerRight = NECK_X1_Z - 1.5;
    const bow = 6;
    const yWall = liquidYZ - bow;       // liquid touches glass higher up
    const yCtrl = liquidYZ + bow;       // control pulls midpoint down (concave)

    // Build SVG content
    let html = '';
    // Glass background
    html += `<rect x="${NECK_X0_Z}" y="40" width="${NECK_X1_Z-NECK_X0_Z}" height="360"
             fill="rgba(230,240,250,0.35)" stroke="#9fb4c7" stroke-width="1.4"/>`;
    // Liquid fill — single path whose top edge IS the curved meniscus
    if (liquidYZ < Y1_Z) {
      html += `<path d="M ${innerLeft} ${yWall}
                       Q ${cx} ${yCtrl} ${innerRight} ${yWall}
                       L ${innerRight} ${Y1_Z-2}
                       L ${innerLeft}  ${Y1_Z-2} Z"
               fill="rgba(160, 200, 230, 0.5)"/>`;
      // Meniscus stroke overlay
      html += `<path d="M ${innerLeft} ${yWall} Q ${cx} ${yCtrl} ${innerRight} ${yWall}"
               fill="none" stroke="#6a829a" stroke-width="1.4"/>`;
    }
    // Graduation mark (drawn over the glass, full width)
    html += `<line x1="${NECK_X0_Z-6}" y1="${markYZ}" x2="${NECK_X1_Z+6}" y2="${markYZ}"
             stroke="#3d2f1f" stroke-width="1.6"/>`;
    html += `<text x="${NECK_X1_Z+12}" y="${markYZ+4}" fill="#3d2f1f"
             font-size="13" font-family="Trebuchet MS, sans-serif" font-weight="700">250 mL</text>`;
    // Highlight
    html += `<rect x="${NECK_X0_Z+2}" y="42" width="3" height="356" fill="rgba(255,255,255,0.5)"/>`;

    zoomSvg.innerHTML = html;
  }

  // ── Done & reveal ─────────────────────────────────────
  btnDone.addEventListener('click', () => {
    const recordedMass   = parseFloat(nbMassInput.value);
    const recordedVolume = parseFloat(nbVolInput.value);
    const reagentId      = nbReagentSel.value;

    if (!reagentId || isNaN(recordedMass) || isNaN(recordedVolume)) {
      setMessage('Fill in the reagent, mass and volume in the notebook before recording.');
      return;
    }

    const reagent = REAGENTS[reagentId];
    const yourC = (recordedMass / reagent.trueMolarMass) / (recordedVolume / 1000);

    // Truth: actual dissolved mass / actual volume.
    // If they typed "250.0" but truth is the calibration error, use trueVolumeAtMark when at the mark;
    // otherwise use the actual water poured.
    const m_in_flask_g = state.flask.dissolved_g + state.flask.undissolved_g;
    const trueVol_mL =
      Math.abs(state.flask.water_mL - FLASK_NOMINAL_ML) < 0.5
        ? state.flask.trueVolumeAtMark_mL
        : state.flask.water_mL;
    const trueC = m_in_flask_g > 0 && trueVol_mL > 0
      ? (m_in_flask_g / reagent.trueMolarMass) / (trueVol_mL / 1000)
      : 0;

    // Stash for stage B (no consumer yet, but the contract is ready)
    sessionStorage.setItem('chem.stageA.result', JSON.stringify({
      reagentId,
      yourMass_g: recordedMass,
      yourVolume_mL: recordedVolume,
      yourConc_M: yourC,
      trueMassInFlask_g: m_in_flask_g,
      trueVolume_mL: trueVol_mL,
      trueConc_M: trueC,
      timestamp: Date.now(),
    }));

    setMessage(`Recorded. Your concentration: ${yourC.toFixed(4)} mol L⁻¹.`);
  });

  btnReveal.addEventListener('click', () => {
    const reagentId = nbReagentSel.value || state.flask.reagentId;
    if (!reagentId) { setMessage('Choose a reagent in the notebook first.'); return; }
    const reagent = REAGENTS[reagentId];

    const m_in_flask = state.flask.dissolved_g + state.flask.undissolved_g;
    const trueVol = state.flask.water_mL > 0 ? state.flask.water_mL : 0;
    const usedVol = (Math.abs(state.flask.water_mL - FLASK_NOMINAL_ML) < 0.5)
      ? state.flask.trueVolumeAtMark_mL
      : trueVol;
    const trueC = m_in_flask > 0 && usedVol > 0
      ? (m_in_flask / reagent.trueMolarMass) / (usedVol / 1000)
      : 0;

    const recordedMass = parseFloat(nbMassInput.value);
    const recordedVolume = parseFloat(nbVolInput.value);
    const yourC = (!isNaN(recordedMass) && !isNaN(recordedVolume) && recordedVolume > 0)
      ? (recordedMass / reagent.trueMolarMass) / (recordedVolume / 1000)
      : null;

    $('true-mass').textContent   = `${m_in_flask.toFixed(4)} g`;
    $('true-volume').textContent = `${usedVol.toFixed(2)} mL`;
    $('true-mm').textContent     = `${reagent.trueMolarMass.toFixed(2)} g/mol`;
    $('true-conc').textContent   = `${trueC.toFixed(4)} mol/L`;
    $('your-conc').textContent   = yourC != null ? `${yourC.toFixed(4)} mol/L` : '—';
    revealPanel.classList.remove('hidden');
  });

  // ── Main loop ──────────────────────────────────────────
  function tick(now) {
    const last = state.lastTick_ms ?? now;
    const dt = Math.min(0.05, (now - last) / 1000);
    state.lastTick_ms = now;

    // Pour reagent onto boat
    if (state.pouring && state.held && state.held.kind === 'reagent' && state.bench.boat) {
      const added = POUR_RATE_G_PER_S * dt;
      if (!state.boat.contents) state.boat.contents = { reagentId: state.held.id, mass_g: 0 };
      state.boat.contents.mass_g += added;
      if (Math.random() < dt * 20) spawnBoatPourParticle();
    }

    // Filling flask with wash bottle
    if (state.filling && state.held && state.held.kind === 'tool' && state.held.id === 'washbottle' && state.bench.volflask) {
      state.flask.water_mL += FILL_RATE_ML_PER_S * dt;
    }

    // Rinse pulse end
    if (state.rinsing && now > state.rinsing.endsAt) state.rinsing = null;

    // Swirl: dissolve + wobble
    if (state.swirling) {
      state.swirlPhase += dt * 8;
      if (state.flask.water_mL >= 5 && state.flask.undissolved_g > 0) {
        const d = Math.min(state.flask.undissolved_g, SWIRL_DISSOLVE_G_PS * dt);
        state.flask.undissolved_g -= d;
        state.flask.dissolved_g   += d;
      }
    } else {
      state.swirlPhase *= 0.9;  // settle
    }

    renderParticles(dt);
    renderStream();
    updateBoatPile();
    updateFlaskRender();

    if (state.bench.balance) balanceReadout.textContent = `${formattedMass(now)} g`;

    state.mouse.speed *= Math.exp(-dt / 0.6);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

})();
