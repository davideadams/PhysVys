// Stage B — Rinsing & Pipetting
// Held-item model identical to Stage A: click drawer item → held; click target.

(() => {
  // ── Constants ────────────────────────────────────────────
  const ALIQUOT_VOL_ML = 25.00;
  const MAX_ALIQUOTS   = 10;
  const BURETTE_FILL_ML = 50.0;

  // Aliquot dilution / contamination factors (multiplied into true moles)
  const PIP_FACTOR = {
    ok:   1.00,    // pipette conditioned with correct contents
    none: 0.985,   // never rinsed — residual water dilutes ~1.5%
    di:   0.985,   // rinsed with DI but not solution → same effect
    cross:0.96,    // conditioned with a DIFFERENT solution
  };
  const CONE_FACTOR = {
    di:    1.00,
    none:  1.00,
    same:  1.04,   // last rinse was the same solution as the aliquot (residue adds)
    other: 0.95,   // last rinse was the OTHER analyte/titrant (consumes)
  };
  const BURETTE_FACTOR = {
    ok:  1.00,     // rinsed with titrant immediately before fill
    bad: 0.97,     // any other state (DI residual, no rinse, etc.)
  };
  const DEFAULT_STD_CONC_M = 0.1000;
  const DEFAULT_TITRANT_CONC_M = 0.1000;  // truth — Stage C will pull this

  // Shared live document used by Stage B (rinsing/pipetting), Stage C (titration),
  // and Stage E (calculations). Each stage reads/writes this single sessionStorage
  // key; storage events propagate changes between iframes.
  const LIVE_KEY = 'chem.titration.live';

  // ── DOM refs ─────────────────────────────────────────────
  const sceneSvg     = document.getElementById('scene');
  const messageBar   = document.getElementById('message-bar');
  const heldPreview  = document.getElementById('held-preview');
  const streamLayer  = document.getElementById('stream-layer');

  const buretteHit   = document.getElementById('burette-hit');
  const buretteLiquid= document.getElementById('burette-liquid');
  const coneHit      = document.getElementById('cone-hit');
  const coneLiquid   = document.getElementById('cone-liquid');
  const wasteHit     = document.getElementById('waste-hit');
  const wasteLiquid  = document.getElementById('waste-liquid');

  const pipStatus    = document.getElementById('pipette-status');
  const burStatus    = document.getElementById('burette-status');
  const aliquotList  = document.getElementById('aliquot-list');

  const btnDone      = document.getElementById('btn-done');
  const btnReveal    = document.getElementById('btn-reveal');
  const revealPanel  = document.getElementById('reveal-panel');

  const toolItems      = document.querySelectorAll('[data-tool]');
  const bottleItems    = document.querySelectorAll('[data-bottle]');
  const indicatorItems = document.querySelectorAll('[data-indicator]');

  // Indicator visual map: tint applied to a cone aliquot based on the analyte role.
  // We use the standard reagent's role (from REAGENTS) to infer the opposite role
  // for the unknown titrant.
  const INDICATOR_TINT = {
    'phenolphthalein': { acid: 'rgba(160,200,230,0.55)', base: 'rgba(220, 90,160,0.55)' },
    'methyl-orange':   { acid: 'rgba(220,100, 60,0.55)', base: 'rgba(240,210,120,0.55)' },
  };
  const INDICATOR_LABEL = {
    'phenolphthalein': 'phenolphthalein',
    'methyl-orange':   'methyl orange',
  };

  // ── Stage A handoff ──────────────────────────────────────
  let stageA;
  try {
    stageA = JSON.parse(sessionStorage.getItem('chem.stageA.result'));
  } catch (_) { stageA = null; }
  const stdConcM = (stageA && stageA.trueConc_M) || DEFAULT_STD_CONC_M;
  const stageAReagent =
    (stageA && stageA.reagentId && window.REAGENTS && window.REAGENTS[stageA.reagentId])
      ? window.REAGENTS[stageA.reagentId] : null;
  const stageAReagentName = stageAReagent ? stageAReagent.name : 'standard';
  const standardRole = stageAReagent ? stageAReagent.role : 'base';   // sane default
  const titrantRole  = standardRole === 'acid' ? 'base' : 'acid';
  function roleOf(tag) {
    if (tag === 'standard') return standardRole;
    if (tag === 'titrant')  return titrantRole;
    return null;
  }

  // ── State ────────────────────────────────────────────────
  // held: { kind: 'tool'|'bottle', id: string } | null
  // For tools: 'pipette', 'filler', 'washbottle'
  // For bottles: 'standard', 'titrant'
  const state = {
    held: null,
    pipette: {
      inDrawer: true,
      fillerAttached: false,
      contentsTag: null,         // 'standard' | 'titrant' | null
      contentsVol_mL: 0,
      lastDiscardTag: null,      // tag of last contents discarded to waste (= "conditioned with")
      tipAt: 'air',              // 'air' | 'beaker:standard' | 'beaker:titrant' | 'cone' | 'waste'
      primed: false,             // A pressed since last draw — required for full vacuum
    },
    burette: {
      rinses: [],                // [{tag}] in chronological order
      filled: false,
      effectiveConc_M: 0,        // computed at fill time
    },
    cone: {
      lastRinseTag: null,        // 'di' | 'standard' | 'titrant' | null
      aliquotInside: null,       // { volMl, moles, recordRef }
      visualLevel: 0,            // visual rinse fluid amount (mL eq.)
    },
    waste: { visualLevel: 53 },  // px height of waste liquid
    aliquots: [],                // delivered aliquot records
    selectedAliquotId: null,
    eventLog: [],                // diagnostic notes for the run
  };

  function logEvent(level, text, aliquotId) {
    state.eventLog.push({ level, text, aliquotId });
  }

  // ── Held & messaging ─────────────────────────────────────
  function setMessage(t) { messageBar.textContent = t; }

  function pickUp(kind, id) {
    if (state.held) {
      // already holding something — try to put it back if clicking same kind
      if (state.held.kind === kind && state.held.id === id) {
        putHeldBack();
        return;
      }
      setMessage('You\'re already holding the ' + heldName() + '. Put it back first or use it.');
      return;
    }
    if (kind === 'tool' && id === 'pipette' && !state.pipette.inDrawer) {
      setMessage('The pipette is already in use.');
      return;
    }
    state.held = { kind, id };
    if (id === 'pipette') {
      state.pipette.inDrawer = false;
      state.pipette.tipAt = 'air';
    }
    refresh();
    setMessage('Holding the ' + heldName() + '. Click target glassware to use it.');
  }

  function putHeldBack() {
    if (!state.held) return;
    const h = state.held;
    if (h.id === 'pipette') {
      if (state.pipette.contentsVol_mL > 0) {
        setMessage('Empty the pipette to the waste beaker before putting it back.');
        return;
      }
      state.pipette.inDrawer = true;
      state.pipette.tipAt = 'air';
      state.pipette.primed = false;
    }
    state.held = null;
    refresh();
    setMessage('Returned to drawer.');
  }

  function heldName() {
    if (!state.held) return '';
    const m = {
      'pipette': 'pipette' + (state.pipette.fillerAttached ? ' (with filler)' : ''),
      'filler': 'pipette filler',
      'washbottle': 'wash bottle (DI water)',
      'standard': 'standard beaker',
      'titrant': 'titrant beaker',
    };
    if (state.held.kind === 'indicator') return INDICATOR_LABEL[state.held.id] + ' dropper';
    return m[state.held.id] || state.held.id;
  }

  function bottleTagOf(id) {
    return id === 'washbottle' ? 'di' : id;   // 'standard' | 'titrant' | 'di'
  }
  function isPourable(held) {
    if (!held) return false;
    return held.kind === 'bottle' || held.id === 'washbottle';
  }
  function bottleLabel(tag) {
    return { di: 'DI water', standard: 'standard', titrant: 'titrant' }[tag] || tag;
  }

  // ── Drawer click handlers ────────────────────────────────
  toolItems.forEach(li => {
    li.addEventListener('click', () => {
      const id = li.dataset.tool;
      // Special: holding pipette + click filler → attach
      if (state.held && state.held.id === 'pipette' && id === 'filler') {
        if (!state.pipette.fillerAttached) {
          state.pipette.fillerAttached = true;
          setMessage('Filler attached to pipette.');
          refresh();
        }
        return;
      }
      // Special: holding filler + click pipette → attach
      if (state.held && state.held.id === 'filler' && id === 'pipette') {
        if (!state.pipette.fillerAttached) {
          state.pipette.fillerAttached = true;
          state.held = { kind: 'tool', id: 'pipette' };  // user now holds the assembled tool
          setMessage('Filler attached. You\'re holding the pipette + filler.');
          refresh();
        }
        return;
      }
      pickUp('tool', id);
    });
  });

  bottleItems.forEach(li => {
    li.addEventListener('click', () => pickUp('bottle', li.dataset.bottle));
  });

  indicatorItems.forEach(li => {
    li.addEventListener('click', () => pickUp('indicator', li.dataset.indicator));
  });

  // ── Bench targets ────────────────────────────────────────
  buretteHit.addEventListener('click', () => onClickBurette());
  coneHit.addEventListener('click',    () => onClickCone());
  wasteHit.addEventListener('click',   () => onClickWaste());

  // Beaker groups: clicking "standard"/"titrant" group on bench is equivalent to
  // picking up the beaker (so students can grab it from either drawer or bench).
  document.getElementById('beaker-standard-group')
    .addEventListener('click', () => onClickBeaker('standard'));
  document.getElementById('beaker-titrant-group')
    .addEventListener('click', () => onClickBeaker('titrant'));

  function onClickBeaker(beakerId) {
    if (!state.held) {
      pickUp('bottle', beakerId);
      return;
    }
    // Holding pipette → tip moves to the beaker (drawing is via the S valve)
    if (state.held.id === 'pipette') {
      if (!state.pipette.fillerAttached) {
        setMessage('Attach the pipette filler before drawing solution.');
        return;
      }
      state.pipette.tipAt = 'beaker:' + beakerId;
      state.held = null;
      setMessage('Pipette tip is in the ' + bottleLabel(beakerId) + ' beaker. Press A to release air, then S to siphon.');
      refresh();
      return;
    }
    // Pouring the wash bottle into a stock beaker dilutes it — flag it.
    if (state.held.id === 'washbottle') {
      logEvent('warn', 'Wash bottle poured into the ' + bottleLabel(beakerId) + ' beaker — stock contaminated/diluted.');
      setMessage('You diluted the ' + bottleLabel(beakerId) + ' beaker with DI water. That\'s bad.');
      return;
    }
    setMessage('Nothing to do with the ' + heldName() + ' on the ' + beakerId + ' beaker.');
  }

  function onClickBurette() {
    if (state.burette.filled) {
      setMessage('Burette is already filled with titrant. Don\'t add anything else.');
      return;
    }
    if (!state.held) {
      setMessage('Pick up a bottle to rinse or fill the burette.');
      return;
    }
    if (!isPourable(state.held)) {
      setMessage('Only pourable liquids go into the burette.');
      return;
    }
    const tag = bottleTagOf(state.held.id);
    state.burette.rinses.push({ tag });
    setMessage(bottleLabel(tag) + ' poured into burette and drained. Use the FILL button to commit a fill.');
    refresh();
  }

  function onClickFill() {
    if (state.burette.filled) {
      setMessage('Burette is already filled.');
      return;
    }
    if (!isPourable(state.held)) {
      setMessage('Pick up a bottle first, then click FILL to fill the burette with it.');
      return;
    }
    const tag = bottleTagOf(state.held.id);
    state.burette.filled = true;
    state.burette.fillTag = tag;
    state.burette.filledLevel_mL = BURETTE_FILL_ML;

    // The burette can legitimately hold either standard or titrant — different
    // technique, same titration. DI is the only outright wrong fill.
    if (tag === 'di') {
      state.burette.effectiveConc_M = 0;
      logEvent('warn', 'Burette filled with DI water — there\'s no analyte or titrant in it.');
      setMessage('Burette filled with DI water. That\'s wrong.');
    } else {
      const baseConc = tag === 'standard' ? stdConcM : DEFAULT_TITRANT_CONC_M;
      const conditioned = state.burette.rinses.some(r => r.tag === tag);
      const factor = conditioned ? BURETTE_FACTOR.ok : BURETTE_FACTOR.bad;
      state.burette.effectiveConc_M = baseConc * factor;
      if (conditioned) logEvent('ok', 'Burette rinsed with ' + bottleLabel(tag) + ' before filling.');
      else             logEvent('warn', 'Burette was filled with ' + bottleLabel(tag) + ' without a prior ' + bottleLabel(tag) + ' rinse — residual water dilutes it.');
      setMessage('Burette filled with ' + bottleLabel(tag) + ' near the 0 mL mark.');
    }
    refresh();
  }
  document.getElementById('burette-fill-btn').addEventListener('click', onClickFill);

  // ── Pipette valves: A / S / E delegated from the placed-pipette group ──
  const placedGroup = document.getElementById('pipette-placed-group');
  placedGroup.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-pip-valve], [data-pip-tube]');
    if (!t) return;
    if (t.dataset.pipTube) { pickUpPlacedPipette(); return; }
    const valve = t.dataset.pipValve;
    if (valve === 'A') onValveA();
    else if (valve === 'S') onValveS();
    else if (valve === 'E') onValveE();
  });

  function onValveA() {
    if (!pipettePlacedOrInHand()) return;
    state.pipette.primed = true;
    setMessage('Bulb squeezed — air released. Now press S to siphon.');
    refresh();
  }
  function onValveS() {
    if (!pipettePlacedOrInHand()) return;
    if (!state.pipette.tipAt.startsWith('beaker:')) {
      setMessage('Tip isn\'t in a liquid — click a beaker to position the tip first.');
      return;
    }
    if (state.pipette.contentsVol_mL > 0) {
      setMessage('Pipette already has liquid — dispense or empty to waste first.');
      return;
    }
    if (!state.pipette.primed) {
      setMessage('Squeeze the bulb (A) first to release air, then siphon.');
      return;
    }
    openSiphonModal();
  }
  // ── Siphon modal ──────────────────────────────────────────
  // Pipette geometry: tip y=472, lower-stem→bulb at y=360, bulb→upper-stem at y=280,
  // mouth y=42. Bulb holds the bulk of the volume (fills slowly per mL).
  const SIPHON_V_MAX = 30;
  // Piecewise (y, v) breakpoints from tip up.
  const SIPHON_BREAKS = [
    { y: 472, v: 0    },
    { y: 360, v: 1    },   // tip + lower stem
    { y: 280, v: 23   },   // bulb (22 mL over 80 px → ~3.6 px/mL — slow)
    { y: 42,  v: 30   },   // upper stem (7 mL over 238 px — fast)
  ];
  const siphonModal     = document.getElementById('siphon-modal');
  const siphonLiquidBody= document.getElementById('siphon-liquid-body');
  const siphonMeniscus  = document.getElementById('siphon-meniscus');
  const siphonStatus    = document.getElementById('siphon-status');
  const siphonBtnS      = document.getElementById('siphon-btn-s');
  const siphonBtnE      = document.getElementById('siphon-btn-e');
  const siphonBtnDone   = document.getElementById('siphon-btn-done');
  const siphonBtnCxl    = document.getElementById('siphon-btn-cancel');

  let siphonVol = 0;
  let siphonSourceTag = null;

  function siphonY(v) {
    const c = Math.max(0, Math.min(SIPHON_V_MAX, v));
    for (let i = 1; i < SIPHON_BREAKS.length; i++) {
      const lo = SIPHON_BREAKS[i - 1], hi = SIPHON_BREAKS[i];
      if (c <= hi.v) {
        const t = (c - lo.v) / (hi.v - lo.v);
        return lo.y + t * (hi.y - lo.y);
      }
    }
    return SIPHON_BREAKS[SIPHON_BREAKS.length - 1].y;
  }

  // Inner half-width of the pipette interior at vertical coordinate y.
  function siphonHalfWidth(y) {
    if (y < 280)        return 4;       // upper stem (x=56..64)
    if (y > 360)        return 4;       // lower stem (x=56..64)
    // Bulb region — approximated by the same quadratic bulge used in the clip path.
    // Bulge peaks at y=320 with half-width ~22 px.
    const t = (y - 320) / 40;           // -1 at top of bulb, +1 at bottom
    const k = 1 - t * t;                // 0 at edges, 1 at centre
    return 4 + k * 18;                  // 4 px at stem, 22 px at bulb centre
  }

  function renderSiphon() {
    const surfaceY = siphonY(siphonVol);
    const liqColor = siphonSourceTag === 'titrant'
      ? 'rgba(180,80,80,0.65)' : 'rgba(180,200,230,0.7)';
    // Body of the liquid: rect from below the meniscus down to the tip, clipped to interior.
    siphonLiquidBody.setAttribute('y', String(surfaceY + 1));
    siphonLiquidBody.setAttribute('height', String(Math.max(0, 472 - surfaceY)));
    siphonLiquidBody.setAttribute('fill', liqColor);
    // Concave meniscus drawn locally to the current pipette width.
    if (siphonVol > 0) {
      const hw  = siphonHalfWidth(surfaceY);
      const dip = Math.min(5, 1 + hw * 0.18);
      const xL  = 60 - hw - 1;
      const xR  = 60 + hw + 1;
      // Quadratic curve: edges high, centre dipped by `dip`.
      siphonMeniscus.setAttribute('d',
        `M ${xL} ${surfaceY} Q 60 ${surfaceY + 2 * dip} ${xR} ${surfaceY}` +
        ` L ${xR} ${surfaceY + 4} L ${xL} ${surfaceY + 4} Z`);
      siphonMeniscus.setAttribute('fill', liqColor);
    } else {
      siphonMeniscus.setAttribute('d', '');
    }
    siphonBtnE.disabled = siphonVol <= 0;
    siphonBtnS.disabled = siphonVol >= SIPHON_V_MAX;
  }
  function openSiphonModal() {
    siphonSourceTag = state.pipette.tipAt.split(':')[1];
    siphonVol = 0;
    siphonStatus.textContent = '';
    renderSiphon();
    siphonModal.classList.remove('hidden');
  }
  function closeSiphonModal() {
    siphonModal.classList.add('hidden');
  }
  // Each S click adds a randomized 3.5–7.0 mL draw.
  siphonBtnS.addEventListener('click', () => {
    const draw = 3.5 + Math.random() * 3.5;
    siphonVol = Math.min(SIPHON_V_MAX, siphonVol + draw);
    renderSiphon();
  });
  // Each E click drips 0.10–0.35 mL.
  siphonBtnE.addEventListener('click', () => {
    const drip = 0.10 + Math.random() * 0.25;
    siphonVol = Math.max(0, siphonVol - drip);
    renderSiphon();
  });
  siphonBtnDone.addEventListener('click', () => {
    if (siphonVol <= 0) {
      siphonStatus.textContent = 'Pipette is empty — siphon some liquid up first, or cancel.';
      return;
    }
    state.pipette.contentsTag = siphonSourceTag;
    state.pipette.contentsVol_mL = siphonVol;
    state.pipette.primed = false;
    closeSiphonModal();
    setMessage('Pipette filled. Move the tip to the conical flask and press E to dispense.');
    refresh();
  });
  siphonBtnCxl.addEventListener('click', () => {
    // Liquid drains back to source beaker — no state change to pipette contents.
    state.pipette.primed = false;
    siphonVol = 0;
    closeSiphonModal();
    setMessage('Returned the liquid to the ' + bottleLabel(siphonSourceTag) + ' beaker.');
    refresh();
  });
  // S / E keys mirror the modal buttons while the modal is open.
  document.addEventListener('keydown', (ev) => {
    if (siphonModal.classList.contains('hidden')) return;
    if (ev.target && ev.target.matches && ev.target.matches('input,textarea')) return;
    const k = ev.key.toLowerCase();
    if (k === 's' && !siphonBtnS.disabled) { ev.preventDefault(); siphonBtnS.click(); }
    else if (k === 'e' && !siphonBtnE.disabled) { ev.preventDefault(); siphonBtnE.click(); }
  });

  function onValveE() {
    if (!pipettePlacedOrInHand()) return;
    if (state.pipette.contentsVol_mL <= 0) {
      setMessage('Pipette is empty.');
      return;
    }
    if (state.pipette.tipAt === 'cone')  { deliverAliquotToCone(); return; }
    if (state.pipette.tipAt === 'waste') {
      state.pipette.lastDiscardTag = state.pipette.contentsTag;
      state.pipette.contentsTag = null;
      state.pipette.contentsVol_mL = 0;
      bumpWasteVisual();
      setMessage('Pipette emptied to waste. It\'s now conditioned with ' + bottleLabel(state.pipette.lastDiscardTag) + '.');
      refresh();
      return;
    }
    if (state.pipette.tipAt.startsWith('beaker:')) {
      setMessage('Don\'t empty the pipette back into a beaker — move the tip to the cone or waste first.');
      return;
    }
    setMessage('Move the tip over the cone or waste before dispensing.');
  }
  function pipettePlacedOrInHand() {
    // Pipette is operable when out of the drawer with filler attached, regardless
    // of whether it's currently held or placed at a target.
    if (state.pipette.inDrawer) return false;
    if (!state.pipette.fillerAttached) return false;
    return true;
  }
  function pickUpPlacedPipette() {
    if (state.held) {
      setMessage('Put down the ' + heldName() + ' first.');
      return;
    }
    state.held = { kind: 'tool', id: 'pipette' };
    state.pipette.tipAt = 'air';
    setMessage('Pipette in hand. Click a target to position the tip.');
    refresh();
  }

  function onClickCone() {
    if (!state.held) {
      setMessage('Pick up a bottle to rinse the conical flask, or use the pipette to deliver an aliquot.');
      return;
    }
    // Indicator drops
    if (state.held.kind === 'indicator') {
      if (!state.cone.aliquotInside) {
        setMessage('Deliver an aliquot first, then add indicator to it.');
        return;
      }
      const indId = state.held.id;
      const aliquot = state.aliquots.find(a => a.id === state.cone.aliquotInside.recordRef);
      if (aliquot.indicator && aliquot.indicator !== indId) {
        logEvent('warn', 'Aliquot #' + aliquot.id + ': two different indicators added — colour change will be muddled.', aliquot.id);
      }
      aliquot.indicator = indId;
      state.cone.indicator = indId;
      logEvent('ok', 'Aliquot #' + aliquot.id + ': ' + INDICATOR_LABEL[indId] + ' added.', aliquot.id);
      setMessage(INDICATOR_LABEL[indId] + ' added to aliquot #' + aliquot.id + '.');
      refresh();
      return;
    }
    // Pipette → tip moves over the cone (delivery is via the E valve)
    if (state.held.id === 'pipette') {
      if (!state.pipette.fillerAttached) {
        setMessage('Attach the pipette filler first.');
        return;
      }
      state.pipette.tipAt = 'cone';
      state.held = null;
      setMessage(state.pipette.contentsVol_mL > 0
        ? 'Pipette tip is over the conical flask. Press E to dispense.'
        : 'Pipette tip is over the conical flask, but it\'s empty.');
      refresh();
      return;
    }
    // Bottle/wash-bottle pour → rinse the cone
    if (isPourable(state.held)) {
      if (state.cone.aliquotInside) {
        setMessage('There\'s an aliquot in the conical flask. Don\'t add other liquids until you\'ve titrated.');
        return;
      }
      const tag = bottleTagOf(state.held.id);
      state.cone.lastRinseTag = tag;
      state.cone.visualLevel = Math.min(60, state.cone.visualLevel + 12);
      setMessage('Conical flask rinsed with ' + bottleLabel(tag) + '. Discard to waste before adding the aliquot.');
      refresh();
      return;
    }
  }

  function deliverAliquotToCone() {
    if (state.aliquots.length >= MAX_ALIQUOTS) {
      setMessage('Maximum of ' + MAX_ALIQUOTS + ' aliquots reached.');
      return;
    }
    if (state.cone.visualLevel > 0 && !state.cone.aliquotInside) {
      // residual rinse fluid still in cone — flag it
      logEvent('warn', 'Pipette delivered aliquot into a conical flask still wet with rinse — discard rinses to waste first.');
    }
    const sourceTag = state.pipette.contentsTag;          // what the pipette is delivering
    const conditioning = state.pipette.lastDiscardTag;    // what it was conditioned with
    let pipKey;
    if (conditioning === sourceTag)       pipKey = 'ok';
    else if (conditioning === null)       pipKey = 'none';
    else if (conditioning === 'di')       pipKey = 'di';
    else                                  pipKey = 'cross';
    const pipFactor = PIP_FACTOR[pipKey];

    let coneKey;
    const cr = state.cone.lastRinseTag;
    if (cr === null || cr === 'di')         coneKey = 'di';
    else if (cr === sourceTag)              coneKey = 'same';
    else                                    coneKey = 'other';
    const coneFactor = CONE_FACTOR[coneKey];

    // True moles: only counts if pipette was actually drawing standard.
    const sourceConc = sourceTag === 'standard' ? stdConcM
                     : sourceTag === 'titrant'  ? DEFAULT_TITRANT_CONC_M
                     : 0;
    const vol_actual = state.pipette.contentsVol_mL;
    const moles = sourceConc * (vol_actual / 1000) * pipFactor * coneFactor;

    const id = state.aliquots.length + 1;
    const record = {
      id,
      sourceTag,
      pipFactor, pipKey,
      coneFactor, coneKey,
      coneLastRinseTag: cr,
      pipConditionedWith: conditioning,
      moles_true: moles,
      vol_mL: vol_actual,
      vol_underFilled: vol_actual < ALIQUOT_VOL_ML - 0.01,
      status: 'pending',                    // 'pending' | 'titrated' | 'discarded'
      titre_mL: null,                       // set by Stage C when titrated
    };
    state.aliquots.push(record);
    if (state.selectedAliquotId === null) state.selectedAliquotId = id;
    state.cone.aliquotInside = { volMl: ALIQUOT_VOL_ML, moles, recordRef: id };
    state.cone.visualLevel = Math.max(state.cone.visualLevel, 18);

    // Drain pipette (it's been delivered)
    state.pipette.contentsTag = null;
    state.pipette.contentsVol_mL = 0;

    // Per-aliquot events. Either solution may legitimately be the analyte —
    // it's just a different valid technique.
    if (pipKey === 'ok') {
      logEvent('ok', 'Aliquot #' + id + ': pipette correctly conditioned with ' + bottleLabel(sourceTag) + '.', id);
    } else if (pipKey === 'cross') {
      logEvent('warn', 'Aliquot #' + id + ': pipette was last conditioned with ' + bottleLabel(conditioning) + ' — cross-contamination.', id);
    } else {
      logEvent('warn', 'Aliquot #' + id + ': pipette wasn\'t conditioned with the standard before drawing.', id);
    }
    if (coneKey === 'same') {
      logEvent('warn', 'Aliquot #' + id + ': conical flask\'s last rinse was the same solution — residue boosts moles.', id);
    } else if (coneKey === 'other') {
      logEvent('warn', 'Aliquot #' + id + ': conical flask was last rinsed with the OTHER reagent — analyte/titrant residue interferes.', id);
    } else {
      logEvent('ok', 'Aliquot #' + id + ': conical flask correctly rinsed with DI (or unrinsed).', id);
    }

    setMessage('Aliquot #' + id + ' delivered to the conical flask.');
    refresh();
  }

  function onClickWaste() {
    if (!state.held) {
      // Discard cone contents
      if (state.cone.aliquotInside || state.cone.visualLevel > 0) {
        if (state.cone.aliquotInside) {
          const aId = state.cone.aliquotInside.recordRef;
          const ali = state.aliquots.find(a => a.id === aId);
          if (ali && ali.status === 'pending') ali.status = 'discarded';
          logEvent('warn', 'Aliquot #' + aId + ' poured to waste before titrating.');
        }
        state.cone.aliquotInside = null;
        state.cone.visualLevel = 0;
        state.cone.lastRinseTag = null;
        state.cone.indicator = null;
        bumpWasteVisual();
        setMessage('Conical flask emptied to waste.');
        refresh();
        return;
      }
      setMessage('Nothing to discard.');
      return;
    }
    // Pipette → tip moves over the waste beaker (discard is via the E valve)
    if (state.held.id === 'pipette') {
      state.pipette.tipAt = 'waste';
      state.held = null;
      setMessage(state.pipette.contentsVol_mL > 0
        ? 'Pipette tip is over the waste beaker. Press E to discard.'
        : 'Pipette tip is over the waste beaker, but it\'s empty.');
      refresh();
      return;
    }
    // Holding bottle → "tip a small amount to waste" (no-op for state)
    setMessage('Don\'t pour stock straight to waste — return it to the drawer.');
  }

  function bumpWasteVisual() {
    state.waste.visualLevel = Math.min(110, state.waste.visualLevel + 8);
  }

  // ── Held preview (cursor) ────────────────────────────────
  const sceneWrap = document.querySelector('.scene-wrap');
  sceneWrap.addEventListener('mousemove', (ev) => {
    if (!state.held) { heldPreview.style.display = 'none'; return; }
    const rect = sceneSvg.getBoundingClientRect();
    const vb = sceneSvg.viewBox.baseVal;
    const x = (ev.clientX - rect.left) / rect.width  * vb.width;
    const y = (ev.clientY - rect.top)  / rect.height * vb.height;
    heldPreview.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    heldPreview.style.display = '';
  });
  sceneWrap.addEventListener('mouseleave', () => {
    heldPreview.style.display = 'none';
  });

  // Three-valve rubber pipette filler, drawn with its bottom socket at (cx, cy)
  // and growing upward. Includes A (top), S (under bulb), E (side branch) labels.
  function renderRubberFiller(cx, cy) {
    const RED = '#c43a2c', DARK = '#8a1f15', LBL = 'rgba(255,255,255,0.9)';
    return `
      <g transform="translate(${cx} ${cy})">
        <!-- Bottom socket (pipette inserts up into here) -->
        <rect x="-3.5" y="-10" width="7" height="10" fill="${RED}"
              stroke="${DARK}" stroke-width="0.7"/>
        <!-- S valve sleeve -->
        <rect x="-5" y="-22" width="10" height="12" fill="${RED}"
              stroke="${DARK}" stroke-width="0.7" rx="1"/>
        <text x="0" y="-13" text-anchor="middle" fill="${LBL}"
              font-size="6" font-family="Trebuchet MS, sans-serif"
              font-weight="700">S</text>
        <!-- E side branch -->
        <rect x="5" y="-19" width="9" height="6" fill="${RED}"
              stroke="${DARK}" stroke-width="0.7"/>
        <ellipse cx="18" cy="-16" rx="6" ry="5" fill="${RED}"
                 stroke="${DARK}" stroke-width="0.7"/>
        <text x="18" y="-14" text-anchor="middle" fill="${LBL}"
              font-size="6" font-family="Trebuchet MS, sans-serif"
              font-weight="700">E</text>
        <!-- Lower stem to bulb -->
        <rect x="-3" y="-32" width="6" height="10" fill="${RED}"
              stroke="${DARK}" stroke-width="0.7"/>
        <!-- Main bulb -->
        <circle cx="0" cy="-54" r="22" fill="${RED}"
                stroke="${DARK}" stroke-width="0.8"/>
        <!-- Mold-seam shadow -->
        <ellipse cx="-5" cy="-56" rx="9" ry="8" fill="none"
                 stroke="${DARK}" stroke-width="0.6" opacity="0.45"/>
        <!-- Upper stem -->
        <rect x="-3" y="-82" width="6" height="8" fill="${RED}"
              stroke="${DARK}" stroke-width="0.7"/>
        <!-- A valve nub: pressed against the side of the stem at bulb level -->
        <ellipse cx="5" cy="-78" rx="5" ry="4" fill="${RED}"
                 stroke="${DARK}" stroke-width="0.7"/>
        <text x="5" y="-76" text-anchor="middle" fill="${LBL}"
              font-size="6" font-family="Trebuchet MS, sans-serif"
              font-weight="700">A</text>
      </g>`;
  }

  // Placed-pipette positions (tip coordinates per location)
  const PIP_PLACED_POS = {
    'beaker:standard': { tipX: 360, tipY: 305, tubeLen: 80 },
    'beaker:titrant':  { tipX: 450, tipY: 305, tubeLen: 80 },
    'cone':            { tipX: 230, tipY: 178, tubeLen: 60 },
    'waste':           { tipX: 540, tipY: 290, tubeLen: 80 },
  };

  function renderPlacedPipette() {
    const placedGroup = document.getElementById('pipette-placed-group');
    const tip = state.pipette.tipAt;
    const pos = PIP_PLACED_POS[tip];
    if (state.pipette.inDrawer || !state.pipette.fillerAttached || !pos) {
      placedGroup.style.display = 'none';
      placedGroup.innerHTML = '';
      return;
    }
    const { tipX, tipY, tubeLen } = pos;
    const tubeTopY = tipY - tubeLen;
    // Bulb sits ~1/3 of the way up from the tip (matches a volumetric pipette).
    const bulbBotY = tipY - 0.20 * tubeLen;
    const bulbTopY = tipY - 0.40 * tubeLen;
    const bulbCY   = tipY - 0.30 * tubeLen;
    const liqColor = state.pipette.contentsTag === 'titrant'
      ? 'rgba(180,80,80,0.55)' : 'rgba(180,200,230,0.65)';
    // Body path: tip → lower stem → bulb bulge → upper stem → top → mirror back.
    const bodyPath =
      `M ${tipX} ${tipY + 8}
       L ${tipX - 3} ${tipY}
       L ${tipX - 3} ${bulbBotY}
       Q ${tipX - 9} ${bulbCY} ${tipX - 3} ${bulbTopY}
       L ${tipX - 3} ${tubeTopY}
       L ${tipX + 3} ${tubeTopY}
       L ${tipX + 3} ${bulbTopY}
       Q ${tipX + 9} ${bulbCY} ${tipX + 3} ${bulbBotY}
       L ${tipX + 3} ${tipY} Z`;
    const liqFill = state.pipette.contentsVol_mL > 0
      ? `<path d="${bodyPath}" fill="${liqColor}" pointer-events="none"/>`
      : '';
    const tubeSvg = `
      <path data-pip-tube="1" d="${bodyPath}"
            fill="rgba(230,240,250,0.5)" stroke="#6a829a" stroke-width="1"
            stroke-linejoin="round" style="cursor:pointer"/>
      ${liqFill}`;

    // Filler with interactive valve overlays
    const RED = '#c43a2c', DARK = '#8a1f15', LBL = 'rgba(255,255,255,0.9)';
    const cx = tipX, cy = tubeTopY;
    const fillerSvg = `
      <g transform="translate(${cx} ${cy})">
        <rect x="-3.5" y="-10" width="7" height="10" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
        <rect x="-5" y="-22" width="10" height="12" fill="${RED}" stroke="${DARK}" stroke-width="0.7" rx="1"/>
        <rect x="5" y="-19" width="9" height="6" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
        <rect x="-3" y="-32" width="6" height="10" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
        <circle cx="0" cy="-54" r="22" fill="${RED}" stroke="${DARK}" stroke-width="0.8"/>
        <ellipse cx="-5" cy="-56" rx="9" ry="8" fill="none" stroke="${DARK}" stroke-width="0.6" opacity="0.45"/>
        <rect x="-3" y="-82" width="6" height="8" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
        <!-- Interactive valves -->
        <g data-pip-valve="S" style="cursor:pointer">
          <rect x="-7" y="-24" width="14" height="16" fill="transparent"/>
          <text x="0" y="-13" text-anchor="middle" fill="${LBL}" font-size="6"
                font-family="Trebuchet MS, sans-serif" font-weight="700"
                pointer-events="none">S</text>
        </g>
        <g data-pip-valve="E" style="cursor:pointer">
          <ellipse cx="18" cy="-16" rx="6" ry="5" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
          <text x="18" y="-14" text-anchor="middle" fill="${LBL}" font-size="6"
                font-family="Trebuchet MS, sans-serif" font-weight="700"
                pointer-events="none">E</text>
        </g>
        <g data-pip-valve="A" style="cursor:pointer">
          <ellipse cx="5" cy="-78" rx="5" ry="4" fill="${RED}" stroke="${DARK}" stroke-width="0.7"/>
          <text x="5" y="-76" text-anchor="middle" fill="${LBL}" font-size="6"
                font-family="Trebuchet MS, sans-serif" font-weight="700"
                pointer-events="none">A</text>
        </g>
      </g>`;
    placedGroup.innerHTML = tubeSvg + fillerSvg;
    placedGroup.style.display = '';
  }

  function renderHeldPreview() {
    const h = state.held;
    if (!h) { heldPreview.innerHTML = ''; return; }
    const id = h.id;
    let svg = '';
    if (id === 'pipette') {
      // Volumetric pipette: tip → lower stem → bulb bulge (1/3 up) → upper stem.
      const bodyPath =
        `M 0 18 L -3 10 L -3 -13
         Q -9 -23 -3 -33
         L -3 -90 L 3 -90
         L 3 -33 Q 9 -23 3 -13
         L 3 10 Z`;
      svg += `<path d="${bodyPath}" fill="rgba(230,240,250,0.5)"
              stroke="#6a829a" stroke-width="1" stroke-linejoin="round"/>`;
      if (state.pipette.contentsVol_mL > 0) {
        const liqColor = state.pipette.contentsTag === 'titrant'
          ? 'rgba(180,80,80,0.55)' : 'rgba(180,200,230,0.65)';
        svg += `<path d="${bodyPath}" fill="${liqColor}"/>`;
      }
      if (state.pipette.fillerAttached) {
        svg += renderRubberFiller(0, -90);
      }
    } else if (id === 'filler') {
      svg += renderRubberFiller(0, 28);
    } else if (id === 'washbottle') {
      svg += `<rect x="-9" y="-25" width="18" height="35" fill="rgba(230,240,250,0.5)"
              stroke="#6a829a" stroke-width="1" rx="2"/>
              <path d="M 0 -25 Q 3 -35 18 -38" fill="none" stroke="#6a829a" stroke-width="1.4"/>`;
    } else if (h.kind === 'indicator') {
      const swatch = id === 'phenolphthalein' ? '#e8a8c8' : '#e89456';
      svg += `<rect x="-5" y="-22" width="10" height="22" fill="rgba(230,240,250,0.5)"
              stroke="#6a829a" stroke-width="1" rx="1"/>
              <rect x="-3" y="-18" width="6" height="14" fill="${swatch}"/>
              <ellipse cx="0" cy="-28" rx="6" ry="4" fill="#c4d0a8" stroke="#5a4a3a" stroke-width="1"/>`;
    } else if (id === 'standard' || id === 'titrant') {
      const fill = id === 'titrant' ? 'rgba(180,80,80,0.55)' : 'rgba(180,200,230,0.6)';
      svg += `<path d="M -14 -22 L -14 16 Q -14 22 -8 22 L 8 22 Q 14 22 14 16 L 14 -22 Z"
              fill="rgba(200,220,235,0.3)" stroke="#6a829a" stroke-width="1"/>
              <rect x="-12" y="-4" width="24" height="22" fill="${fill}"/>`;
    }
    heldPreview.innerHTML = svg;
  }

  // ── Render bench liquids & status ────────────────────────
  function renderBench() {
    // Burette liquid
    if (state.burette.filled) {
      const bMaxH = 230;
      buretteLiquid.setAttribute('y', String(50));
      buretteLiquid.setAttribute('height', String(bMaxH));
      const fillColor = state.burette.fillTag === 'titrant' ? 'rgba(180, 80, 80, 0.45)'
                      : state.burette.fillTag === 'di'      ? 'rgba(180, 200, 230, 0.4)'
                      :                                       'rgba(180, 200, 230, 0.55)';
      buretteLiquid.setAttribute('fill', fillColor);
    } else {
      buretteLiquid.setAttribute('height', '0');
    }
    // Conical flask liquid (clipped to interior; bottom at y=330)
    const cMax = 110;
    const cv = Math.min(cMax, state.cone.visualLevel);
    coneLiquid.setAttribute('y', String(330 - cv));
    coneLiquid.setAttribute('height', String(cv));
    if (state.cone.aliquotInside) {
      const a = state.aliquots.find(x => x.id === state.cone.aliquotInside.recordRef);
      const ind = a && a.indicator;
      const role = a && roleOf(a.sourceTag);
      const tint = ind && role && INDICATOR_TINT[ind] && INDICATOR_TINT[ind][role];
      coneLiquid.setAttribute('fill', tint || 'rgba(160, 200, 230, 0.55)');
    } else if (state.cone.lastRinseTag === 'titrant') {
      coneLiquid.setAttribute('fill', 'rgba(180, 80, 80, 0.4)');
    } else {
      coneLiquid.setAttribute('fill', 'rgba(180, 200, 230, 0.4)');
    }
    // Waste
    const wH = Math.min(95, state.waste.visualLevel);
    wasteLiquid.setAttribute('y', String(330 - wH));
    wasteLiquid.setAttribute('height', String(wH));
  }

  function renderStatus() {
    let p = 'Pipette is ';
    if (state.pipette.inDrawer) p += 'in the drawer.';
    else {
      p += 'in hand';
      p += state.pipette.fillerAttached ? ' (with filler)' : ' (no filler — attach one)';
      const tip = state.pipette.tipAt;
      const tipDesc = tip === 'air' ? 'in air'
                    : tip === 'cone' ? 'over the cone'
                    : tip === 'waste' ? 'over waste'
                    : 'in the ' + bottleLabel(tip.split(':')[1]) + ' beaker';
      p += `, tip ${tipDesc}`;
      if (state.pipette.primed) p += ', bulb squeezed';
      if (state.pipette.contentsVol_mL > 0) p += `, holding ${state.pipette.contentsVol_mL.toFixed(2)} mL of ${bottleLabel(state.pipette.contentsTag)}`;
      if (state.pipette.lastDiscardTag) p += `. Conditioned with ${bottleLabel(state.pipette.lastDiscardTag)}`;
      p += '.';
    }
    pipStatus.textContent = p;

    let b;
    if (state.burette.filled) {
      const tag = state.burette.fillTag;
      if (tag === 'di') {
        b = 'Filled with DI water — that\'s wrong.';
      } else {
        const baseConc = tag === 'standard' ? stdConcM : DEFAULT_TITRANT_CONC_M;
        const f = baseConc > 0 ? state.burette.effectiveConc_M / baseConc : 0;
        b = f >= 0.999 ? `Filled with ${bottleLabel(tag)}. Ready.`
                       : `Filled with ${bottleLabel(tag)} — but residual water may dilute it.`;
      }
    } else {
      const last = state.burette.rinses.length ? bottleLabel(state.burette.rinses[state.burette.rinses.length-1].tag) : 'none';
      b = `Empty. Rinses so far: ${state.burette.rinses.length} (last: ${last}). Hold a bottle and click FILL to fill.`;
    }
    burStatus.textContent = b;
  }

  function renderAliquots() {
    if (state.aliquots.length === 0) {
      aliquotList.innerHTML = '<li class="aliquot-empty">No aliquots yet.</li>';
      return;
    }
    aliquotList.innerHTML = state.aliquots.map(a => {
      const sel = a.id === state.selectedAliquotId ? ' selected' : '';
      const meta = `from ${bottleLabel(a.sourceTag)}`;
      return `<li class="aliquot-row${sel}" data-aid="${a.id}">
                <input type="radio" name="aliquot-pick" ${a.id === state.selectedAliquotId ? 'checked' : ''}/>
                <span class="a-id">#${a.id}</span>
                <span class="a-meta">${meta}</span>
              </li>`;
    }).join('');
    aliquotList.querySelectorAll('.aliquot-row').forEach(row => {
      row.addEventListener('click', () => {
        state.selectedAliquotId = parseInt(row.dataset.aid, 10);
        renderAliquots();
      });
    });
  }

  function refresh() {
    // Drawer placed-state (grey out items currently held)
    document.querySelectorAll('.drawer-item').forEach(li => li.classList.remove('held', 'placed'));
    if (state.held) {
      const sel = state.held.kind === 'tool'
        ? `[data-tool="${state.held.id}"]`
        : `[data-bottle="${state.held.id}"]`;
      const el = document.querySelector(sel);
      if (el) el.classList.add('held');
    }
    if (state.pipette.fillerAttached && (!state.held || state.held.id !== 'filler')) {
      const f = document.querySelector('[data-tool="filler"]');
      if (f) f.classList.add('placed');
    }
    if (!state.pipette.inDrawer && (!state.held || state.held.id !== 'pipette')) {
      const p = document.querySelector('[data-tool="pipette"]');
      if (p) p.classList.add('placed');
    }
    renderBench();
    renderStatus();
    renderAliquots();
    renderPlacedPipette();
    renderHeldPreview();
    persistLive();
  }

  // ── Live shared-doc persistence ─────────────────────────
  // Stage B is the source of truth for aliquot creation, burette state, and
  // cone state. Stage C reads this doc and writes back status / titre_mL when
  // a titration completes; this listener reconciles those writebacks into
  // local state. The doc is keyed by `LIVE_KEY` and shared via sessionStorage
  // across same-origin iframes — the wrapper relies on storage events firing
  // between sibling iframes for cross-tab updates.
  let lastPersistedJson = null;
  function buildLiveDoc() {
    return {
      schemaVersion: 1,
      reagentId: (stageA && stageA.reagentId) || null,
      reagentName: stageAReagentName,
      stdConc_M: stdConcM,
      titrantTrueConc_M: DEFAULT_TITRANT_CONC_M,
      burette: {
        filled: state.burette.filled,
        fillTag: state.burette.fillTag || null,
        effectiveConc_M: state.burette.effectiveConc_M || 0,
        filledLevel_mL: state.burette.filledLevel_mL || 0,
        rinses: state.burette.rinses,
      },
      aliquots: state.aliquots.map(a => ({ ...a })),
      cone: {
        aliquotId: state.cone.aliquotInside ? state.cone.aliquotInside.recordRef : null,
        indicator: state.cone.indicator || null,
        lastRinseTag: state.cone.lastRinseTag,
        visualLevel: state.cone.visualLevel,
      },
      events: state.eventLog,
    };
  }
  function persistLive() {
    const json = JSON.stringify(buildLiveDoc());
    if (json === lastPersistedJson) return;   // no change → no event → no loop
    lastPersistedJson = json;
    try { sessionStorage.setItem(LIVE_KEY, json); } catch (_) {}
  }

  // Reconcile a doc written by Stage C: update local aliquot status / titre,
  // and clear the cone if C says the aliquot has been consumed.
  function reconcileFromLiveDoc(doc) {
    if (!doc || !Array.isArray(doc.aliquots)) return;
    let changed = false;
    doc.aliquots.forEach(da => {
      const local = state.aliquots.find(a => a.id === da.id);
      if (!local) return;
      if (local.status !== da.status) { local.status = da.status; changed = true; }
      if (local.titre_mL !== da.titre_mL) { local.titre_mL = da.titre_mL; changed = true; }
    });
    const docConeId = doc.cone ? doc.cone.aliquotId : null;
    const localConeId = state.cone.aliquotInside ? state.cone.aliquotInside.recordRef : null;
    if (docConeId !== localConeId && docConeId === null && localConeId !== null) {
      // Stage C consumed the aliquot — empty the cone visually.
      const a = state.aliquots.find(x => x.id === localConeId);
      if (a && a.status === 'titrated') {
        logEvent('ok', 'Aliquot #' + a.id + ': titrated (titre = ' +
          (a.titre_mL != null ? a.titre_mL.toFixed(2) : '?') + ' mL).', a.id);
      }
      state.cone.aliquotInside = null;
      state.cone.visualLevel = 0;
      state.cone.indicator = null;
      state.cone.lastRinseTag = null;
      changed = true;
    }
    if (changed) {
      // Update lastPersistedJson to the incoming content so the upcoming
      // refresh() doesn't immediately re-write the same data.
      lastPersistedJson = JSON.stringify(buildLiveDoc());
      refresh();
      lastPersistedJson = JSON.stringify(buildLiveDoc());  // sync after refresh
    }
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key === LIVE_KEY && ev.newValue) {
      try { reconcileFromLiveDoc(JSON.parse(ev.newValue)); } catch (_) {}
      return;
    }
    // If Stage A's handoff appears or changes after Stage B has booted, the
    // simplest correct behaviour is to reload — `stdConcM`, role, reagent
    // name and friends are all derived once at module init.
    if (ev.key === 'chem.stageA.result') {
      location.reload();
    }
  });

  // Drawer "put back" via clicking a placed item slot
  document.querySelectorAll('[data-tool], [data-bottle]').forEach(li => {
    // already wired above for click → pickup; the pickUp() function returns the held
    // item if you click the same item twice.
  });

  // ── Done & Reveal ────────────────────────────────────────
  btnDone.addEventListener('click', () => {
    if (state.aliquots.length === 0) {
      setMessage('Deliver at least one aliquot before recording.');
      return;
    }
    if (!state.burette.filled) {
      setMessage('Fill the burette before recording.');
      return;
    }
    const sel = state.aliquots.find(a => a.id === state.selectedAliquotId);
    // Inconsistency: same solution in burette and conical flask = no titration possible.
    if (sel && state.burette.fillTag === sel.sourceTag) {
      logEvent('warn', 'Burette and conical flask both contain ' + bottleLabel(sel.sourceTag) + ' — no acid–base reaction will happen.');
    }
    const handoff = {
      reagentId: (stageA && stageA.reagentId) || null,
      reagentName: stageAReagentName,
      stdConc_M: stdConcM,
      titrantTrueConc_M: DEFAULT_TITRANT_CONC_M,
      selectedAliquot: sel,
      aliquots: state.aliquots,
      burette: {
        filled: state.burette.filled,
        fillTag: state.burette.fillTag,
        effectiveConc_M: state.burette.effectiveConc_M,
      },
      events: state.eventLog,
    };
    sessionStorage.setItem('chem.stageB.result', JSON.stringify(handoff));
    setMessage('Recorded. Aliquot #' + sel.id + ' will carry forward to Stage C.');
  });

  btnReveal.addEventListener('click', () => {
    if (revealPanel.classList.contains('hidden')) {
      revealPanel.classList.remove('hidden');
      btnReveal.textContent = 'Hide technique log';
    } else {
      revealPanel.classList.add('hidden');
      btnReveal.textContent = 'Reveal technique log';
      return;
    }
    const sel = state.aliquots.find(a => a.id === state.selectedAliquotId);
    document.getElementById('rv-aliquot-id').textContent = sel ? '#' + sel.id : '—';
    document.getElementById('rv-moles').textContent = sel
      ? sel.moles_true.toFixed(5) + ' mol'
      : '—';
    if (!state.burette.filled) {
      document.getElementById('rv-burette').textContent = 'No';
    } else {
      const tag = state.burette.fillTag;
      const baseConc = tag === 'standard' ? stdConcM : DEFAULT_TITRANT_CONC_M;
      const f = baseConc > 0 ? state.burette.effectiveConc_M / baseConc : 0;
      document.getElementById('rv-burette').textContent =
        tag === 'di' ? 'Filled with DI — wrong'
        : (f >= 0.999 ? `Yes — ${bottleLabel(tag)} at expected concentration`
                      : `Yes — ${bottleLabel(tag)}, slightly diluted`);
    }
    const ev = document.getElementById('rv-events');
    if (state.eventLog.length === 0) {
      ev.innerHTML = '<li class="ok">No notable technique events.</li>';
    } else {
      ev.innerHTML = state.eventLog.map(e =>
        `<li class="${e.level}">${e.text}</li>`).join('');
    }
  });

  // ── Init ─────────────────────────────────────────────────
  if (!stageA) {
    setMessage('No Stage A standard found in this session — using a default 0.1000 M for practice.');
  } else {
    setMessage(`Loaded your Stage A ${stageAReagentName} standard (${stdConcM.toFixed(4)} M). Begin rinsing.`);
  }
  refresh();
})();
