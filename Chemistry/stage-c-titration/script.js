// Stage C — Titration (v2)
// Reads the live shared doc (chem.titration.live), titrates the aliquot in
// the cone, and writes status/titre back so Stage B can clear the flask and
// Stage E can compute the answer key.

(() => {
  const LIVE_KEY = 'chem.titration.live';
  const POUR_RATE_ML_PER_TICK = 0.20;     // 0.2 mL every 100 ms = 2 mL/s
  const POUR_TICK_MS          = 100;
  const DRIP_VOL_ML           = 0.05;     // single drip
  const BURETTE_CAPACITY_ML   = 50;

  // Burette geometry (mL → svg y for the meniscus / liquid top edge).
  const BUR_Y_TOP_mL    = 50;             // y at v = 0 (full)
  const BUR_Y_BOT_mL    = 290;            // y at v = 50 (empty / drained 50 mL)
  function buretteYAt(addedML) {
    const t = Math.max(0, Math.min(BURETTE_CAPACITY_ML, addedML)) / BURETTE_CAPACITY_ML;
    return BUR_Y_TOP_mL + t * (BUR_Y_BOT_mL - BUR_Y_TOP_mL);
  }

  // Indicator colours (acid side / base side). Tints are RGBA fills used on
  // the cone liquid; we blend between them through the equivalence zone.
  const INDICATOR_COLORS = {
    'phenolphthalein': {
      acid: [220, 235, 245, 0.45],   // colourless / very pale
      base: [220,  90, 160, 0.55],   // pink
    },
    'methyl-orange': {
      acid: [220, 100,  60, 0.65],   // red
      base: [240, 210, 120, 0.55],   // yellow
    },
  };
  const INDICATOR_LABEL = {
    'phenolphthalein': 'phenolphthalein',
    'methyl-orange':   'methyl orange',
  };

  // ── DOM refs ────────────────────────────────────────────
  const messageBar    = document.getElementById('message-bar');
  const buretteLiquid = document.getElementById('burette-liquid');
  const buretteMeniscus = document.getElementById('burette-meniscus');
  const buretteGraduations = document.getElementById('burette-graduations');
  const coneLiquid    = document.getElementById('cone-liquid');
  const streamLayer   = document.getElementById('stream-layer');
  const zoomContent   = document.getElementById('zoom-content');

  const infoReagent   = document.getElementById('info-reagent');
  const infoStdConc   = document.getElementById('info-stdconc');
  const infoBurette   = document.getElementById('info-burette');
  const infoCone      = document.getElementById('info-cone');

  const btnPour       = document.getElementById('btn-pour');
  const btnDrip       = document.getElementById('btn-drip');
  const btnEnd        = document.getElementById('btn-end');
  const btnRefill     = document.getElementById('btn-refill');

  const titreList     = document.getElementById('titre-list');

  // ── State ───────────────────────────────────────────────
  // The live doc is the source of truth for aliquots, burette fill, cone.
  // Stage C tracks how much has been dispensed in the current titration
  // session (`addedVol_mL`) and whether the tap is currently open.
  const state = {
    live: null,
    addedVol_mL: 0,
    pouring: false,
    pourTimer: null,
  };

  function setMessage(t, kind) {
    messageBar.textContent = t;
    messageBar.classList.toggle('warn', kind === 'warn');
  }

  // ── Burette graduations (drawn once) ────────────────────
  function drawGraduations() {
    let html = '';
    for (let v = 0; v <= 50; v++) {
      const y = buretteYAt(v);
      const long = v % 5 === 0;
      const x1 = long ? 100 : 102;
      html += `<line x1="${x1}" y1="${y.toFixed(1)}" x2="106" y2="${y.toFixed(1)}"
               stroke="#3d2f1f" stroke-width="${long ? 1 : 0.5}"/>`;
      if (long) {
        html += `<text x="96" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#3d2f1f"
                 font-size="8" font-family="Trebuchet MS, sans-serif">${v}</text>`;
      }
    }
    buretteGraduations.innerHTML = html;
  }
  drawGraduations();

  // ── Live doc ────────────────────────────────────────────
  function readLive() {
    try { return JSON.parse(sessionStorage.getItem(LIVE_KEY)); }
    catch (_) { return null; }
  }
  function writeLive(doc) {
    try { sessionStorage.setItem(LIVE_KEY, JSON.stringify(doc)); } catch (_) {}
  }

  function getActiveAliquot() {
    if (!state.live || !state.live.cone) return null;
    const id = state.live.cone.aliquotId;
    if (id == null) return null;
    return (state.live.aliquots || []).find(a => a.id === id) || null;
  }

  // ── Chemistry ───────────────────────────────────────────
  // Stage B records each aliquot's `moles_true` already adjusted for pipette
  // and cone-rinse technique. Equivalents come from the standard reagent
  // (looked up via REAGENTS); the moles needed in the burette depend on
  // whether the standard is in the cone (typical) or in the burette (tech-
  // nique-different).
  function chemistry() {
    const a = getActiveAliquot();
    if (!a || !state.live) return null;
    const reagent = (state.live.reagentId && window.REAGENTS &&
                     window.REAGENTS[state.live.reagentId])
                  ? window.REAGENTS[state.live.reagentId] : null;
    const equivalents = reagent ? reagent.equivalents : 1;
    const stdRole     = reagent ? reagent.role : 'base';
    const titrantRole = stdRole === 'acid' ? 'base' : 'acid';
    const burette = state.live.burette || {};
    const buretteTag = burette.fillTag;
    // What's in the cone (aliquot.sourceTag) and what's in the burette must
    // be different reagents for any reaction to occur.
    if (!burette.filled)              return { aliquot: a, valid: false, reason: 'no-burette' };
    if (buretteTag === 'di')          return { aliquot: a, valid: false, reason: 'di-burette' };
    if (buretteTag === a.sourceTag)   return { aliquot: a, valid: false, reason: 'same-side' };
    if (buretteTag !== 'standard' && buretteTag !== 'titrant') {
      return { aliquot: a, valid: false, reason: 'unknown-burette' };
    }
    const coneIsStd = a.sourceTag === 'standard';

    const c_burette  = state.live.burette.effectiveConc_M;
    // Moles needed in the burette to reach equivalence:
    //   if standard is in cone → moles_burette = moles_cone × equivalents
    //   if standard is in burette → moles_burette = moles_cone / equivalents
    const moles_in_burette_needed = coneIsStd
      ? a.moles_true * equivalents
      : a.moles_true / equivalents;
    const equivalence_titre_mL = c_burette > 0
      ? (moles_in_burette_needed / c_burette) * 1000
      : 0;
    // Which side dominates the cone now, given how much we've added:
    //   pre-equivalence: cone shows the analyte (initial side)
    //   post-equivalence: cone shows the titrant (excess from burette)
    const initialSideRole = coneIsStd ? stdRole : titrantRole;
    const buretteSideRole = coneIsStd ? titrantRole : stdRole;
    const f = equivalence_titre_mL > 0 ? state.addedVol_mL / equivalence_titre_mL : 0;

    return {
      aliquot: a, valid: true,
      reagent, equivalents, stdRole, titrantRole, buretteTag,
      c_burette, equivalence_titre_mL,
      initialSideRole, buretteSideRole, f,
    };
  }

  function indicatorColour(ch) {
    const indId = (state.live && state.live.cone && state.live.cone.indicator) || null;
    if (!indId || !INDICATOR_COLORS[indId]) {
      return 'rgba(160, 200, 230, 0.45)';        // no indicator — pale water
    }
    const colours = INDICATOR_COLORS[indId];
    const pre  = ch.initialSideRole === 'acid' ? colours.acid : colours.base;
    const post = ch.buretteSideRole  === 'acid' ? colours.acid : colours.base;
    // Smooth blend through a narrow zone around f = 1 (sharp endpoint).
    const f = ch.f;
    let t;
    if      (f < 0.998) t = 0;
    else if (f > 1.002) t = 1;
    else                t = (f - 0.998) / 0.004;
    const r = pre[0] + (post[0] - pre[0]) * t;
    const g = pre[1] + (post[1] - pre[1]) * t;
    const b = pre[2] + (post[2] - pre[2]) * t;
    const a = pre[3] + (post[3] - pre[3]) * t;
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(2)})`;
  }

  // ── Pouring control ─────────────────────────────────────
  function startPour() {
    if (state.pouring) return;
    if (!canDispense()) return;
    state.pouring = true;
    state.pourTimer = setInterval(() => {
      if (!canDispense()) { stopPour(); return; }
      state.addedVol_mL = Math.min(BURETTE_CAPACITY_ML,
                                    state.addedVol_mL + POUR_RATE_ML_PER_TICK);
      render();
    }, POUR_TICK_MS);
    render();
  }
  function stopPour() {
    if (state.pourTimer) { clearInterval(state.pourTimer); state.pourTimer = null; }
    state.pouring = false;
    render();
  }
  function drip() {
    if (!canDispense()) return;
    state.addedVol_mL = Math.min(BURETTE_CAPACITY_ML, state.addedVol_mL + DRIP_VOL_ML);
    render();
  }
  function refill() {
    stopPour();
    state.addedVol_mL = 0;
    setMessage('Burette refilled to 0 mL.');
    render();
  }
  function endTitration() {
    stopPour();
    const a = getActiveAliquot();
    if (!a) { setMessage('No aliquot in the flask.', 'warn'); return; }
    if (state.addedVol_mL <= 0) {
      setMessage('Add some titrant before ending the titration.', 'warn');
      return;
    }
    // Write back to live doc.
    const doc = readLive();
    if (!doc) return;
    const target = doc.aliquots.find(x => x.id === a.id);
    if (target) {
      target.status = 'titrated';
      target.titre_mL = state.addedVol_mL;
    }
    if (doc.cone) doc.cone.aliquotId = null;
    writeLive(doc);
    state.live = doc;
    state.addedVol_mL = 0;          // auto-refill for the next titration
    setMessage('Titration recorded — write the final burette reading on your paper.');
    render();
  }

  function canDispense() {
    if (state.addedVol_mL >= BURETTE_CAPACITY_ML) return false;
    const ch = chemistry();
    if (!ch) return false;
    if (!ch.valid) return false;
    return true;
  }

  btnPour.addEventListener('click', () => state.pouring ? stopPour() : startPour());
  btnDrip.addEventListener('click', drip);
  btnEnd.addEventListener('click', endTitration);
  btnRefill.addEventListener('click', refill);

  // ── Render ──────────────────────────────────────────────
  function render() {
    const ch = chemistry();
    // Burette
    const bY = buretteYAt(state.addedVol_mL);
    const bH = Math.max(0, BUR_Y_BOT_mL - bY + 16);  // a little extra below the 50 line
    buretteLiquid.setAttribute('y', String(bY));
    buretteLiquid.setAttribute('height', String(bH));
    buretteLiquid.setAttribute('fill',
      state.live && state.live.burette && state.live.burette.fillTag === 'standard'
        ? 'rgba(180, 200, 230, 0.55)'
        : 'rgba(180, 80, 80, 0.45)');
    // Tiny meniscus curve on the burette (concave dip).
    const mxL = 107, mxR = 119;
    buretteMeniscus.setAttribute('d',
      `M ${mxL} ${bY} Q 113 ${bY + 3} ${mxR} ${bY}`);

    // Cone
    if (ch && ch.valid) {
      // Visual level rises with titrant added (very compressed scale just for vibe).
      const visualBase = 35;
      const cV = Math.min(110, visualBase + state.addedVol_mL * 0.6);
      coneLiquid.setAttribute('y', String(380 - cV));
      coneLiquid.setAttribute('height', String(cV));
      coneLiquid.setAttribute('fill', indicatorColour(ch));
    } else {
      coneLiquid.setAttribute('height', '0');
    }

    // Stream visualisation while pouring
    if (state.pouring && ch && ch.valid) {
      streamLayer.innerHTML =
        `<line x1="113" y1="332" x2="400" y2="${380 - 110}"
               stroke="${state.live.burette.fillTag === 'standard'
                          ? 'rgba(180, 200, 230, 0.6)'
                          : 'rgba(180, 80, 80, 0.55)'}"
               stroke-width="1.4" stroke-dasharray="2 3"/>`;
    } else {
      streamLayer.innerHTML = '';
    }

    // Zoom panel — meniscus close-up with neighbouring graduations.
    renderZoom();

    // Side panel info
    if (state.live) {
      infoReagent.textContent = state.live.reagentName || '—';
      infoStdConc.textContent = state.live.stdConc_M ? state.live.stdConc_M.toFixed(4) + ' M' : '—';
      const burTag = state.live.burette && state.live.burette.fillTag;
      infoBurette.textContent = burTag
        ? burTag + (state.live.burette.effectiveConc_M
            ? ' (' + state.live.burette.effectiveConc_M.toFixed(4) + ' M)'
            : '')
        : 'not filled';
      const a = getActiveAliquot();
      infoCone.textContent = a
        ? '#' + a.id + ' — ' + a.sourceTag +
          (state.live.cone.indicator
            ? ', ' + INDICATOR_LABEL[state.live.cone.indicator]
            : ', no indicator')
        : 'empty';
    } else {
      infoReagent.textContent = '—';
      infoStdConc.textContent = '—';
      infoBurette.textContent = '—';
      infoCone.textContent    = '—';
    }

    // Buttons
    const ready = !!(ch && ch.valid && state.addedVol_mL < BURETTE_CAPACITY_ML);
    btnPour.disabled = !ready;
    btnDrip.disabled = !ready;
    btnEnd.disabled  = !(ch && ch.valid && state.addedVol_mL > 0);
    btnRefill.disabled = state.addedVol_mL === 0;
    btnPour.classList.toggle('active', state.pouring);
    btnPour.textContent = state.pouring ? 'Close tap' : 'Open tap';

    // Status / readiness messages
    if (!state.live) {
      setMessage('Open the Standard Solution and Rinsing & Pipetting tabs first.', 'warn');
    } else if (!ch) {
      setMessage('No aliquot in the flask. Pipette one in the Rinsing & Pipetting tab.', 'warn');
    } else if (!ch.valid) {
      if (ch.reason === 'no-burette')
        setMessage('Burette isn\'t filled. Fill it in Rinsing & Pipetting.', 'warn');
      else if (ch.reason === 'di-burette')
        setMessage('Burette is filled with DI water — that won\'t titrate anything.', 'warn');
      else if (ch.reason === 'same-side')
        setMessage('Burette and flask both contain ' + ch.aliquot.sourceTag + ' — no reaction will occur.', 'warn');
      else
        setMessage('Burette contents look off — check the Rinsing & Pipetting tab.', 'warn');
    } else if (state.addedVol_mL >= BURETTE_CAPACITY_ML) {
      setMessage('Burette is empty — refill before continuing.', 'warn');
    }

    // Titre history — show 'titrated' aliquots in the doc.
    renderTitreList();
  }

  function renderZoom() {
    // Show ±2 mL around the current meniscus, magnified.
    const v = state.addedVol_mL;
    const lo = Math.max(0, Math.floor(v) - 2);
    const hi = Math.min(50, lo + 4);
    const span = hi - lo;
    let html = '';
    // Tube outline (zoom local coords: x 50..90, y 16..212, height 196 px / span mL).
    const TUBE_X1 = 50, TUBE_X2 = 90, TUBE_TOP = 16, TUBE_BOT = 212;
    const yAtZoom = (vv) => TUBE_TOP + ((vv - lo) / span) * (TUBE_BOT - TUBE_TOP);
    html += `<rect x="${TUBE_X1}" y="${TUBE_TOP}" width="${TUBE_X2 - TUBE_X1}"
             height="${TUBE_BOT - TUBE_TOP}" fill="rgba(230,240,250,0.35)"
             stroke="#6a829a" stroke-width="1.2"/>`;
    // Liquid (above the meniscus when looking from top, since burette reading
    // increases as fluid drops).
    const yMen = yAtZoom(v);
    const liqColor = state.live && state.live.burette && state.live.burette.fillTag === 'standard'
      ? 'rgba(180, 200, 230, 0.55)' : 'rgba(180, 80, 80, 0.5)';
    html += `<rect x="${TUBE_X1 + 1}" y="${yMen}" width="${TUBE_X2 - TUBE_X1 - 2}"
             height="${TUBE_BOT - yMen}" fill="${liqColor}"/>`;
    // Curved meniscus line.
    html += `<path d="M ${TUBE_X1 + 1} ${yMen} Q 70 ${yMen + 4} ${TUBE_X2 - 1} ${yMen}"
             fill="none" stroke="rgba(60,40,30,0.6)" stroke-width="0.9"/>`;
    // Graduations at every 0.1 mL with labels every 1 mL.
    for (let mm = lo * 10; mm <= hi * 10; mm++) {
      const vv = mm / 10;
      const y = yAtZoom(vv);
      const major = mm % 10 === 0;
      const mid   = mm % 5 === 0;
      const tickLen = major ? 14 : (mid ? 9 : 5);
      html += `<line x1="${TUBE_X1 - tickLen}" y1="${y.toFixed(2)}"
               x2="${TUBE_X1}" y2="${y.toFixed(2)}"
               stroke="#3d2f1f" stroke-width="${major ? 1.1 : 0.6}"/>`;
      if (major) {
        html += `<text x="${TUBE_X1 - tickLen - 3}" y="${(y + 3).toFixed(2)}"
                 text-anchor="end" fill="#3d2f1f"
                 font-size="9" font-family="Trebuchet MS, sans-serif"
                 font-weight="700">${vv.toFixed(0)}</text>`;
      }
    }
    zoomContent.innerHTML = html;
  }

  function renderTitreList() {
    if (!state.live) return;
    const titrated = (state.live.aliquots || []).filter(a => a.status === 'titrated');
    if (titrated.length === 0) {
      titreList.innerHTML = '<li class="titre-empty">No titrations yet.</li>';
      return;
    }
    titreList.innerHTML = titrated.map(a =>
      `<li>
        <span class="a-id">#${a.id}</span>
        <span class="meta">${a.sourceTag}</span>
        <span class="titre">${a.titre_mL.toFixed(2)} mL</span>
      </li>`).join('');
  }

  // ── Reload from live doc on storage change ──────────────
  function refreshLive() {
    state.live = readLive();
    render();
  }
  window.addEventListener('storage', (ev) => {
    if (ev.key !== LIVE_KEY) return;
    refreshLive();
  });

  // Stop pouring if the iframe goes hidden (e.g. user switched tabs while
  // titrant was flowing) — avoid runaway off-screen titrations. The wrapper
  // posts 'tab-inactive' on tab switches; this also handles being navigated
  // away from the parent tab via the standard visibilitychange API.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPour();
  });
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || !ev.data) return;
    if (ev.data.type === 'tab-inactive') stopPour();
    if (ev.data.type === 'tab-active')   refreshLive();
  });

  // ── Init ────────────────────────────────────────────────
  refreshLive();
})();
