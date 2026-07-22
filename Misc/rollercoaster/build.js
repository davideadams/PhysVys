/* Build palette, modelled on RCT's construction window.

   The important idea borrowed from RCT is that a piece is not chosen from a
   flat list of every combination. You choose a DIRECTION and the SLOPE you
   want to be travelling at, and the game works out which piece that implies —
   including inserting the transition piece for you. So going from level to a
   gentle climb is one click of "gentle up", not a click of "flat to gentle up"
   followed by a click of "gentle up". Selecting a slope and pressing build
   repeatedly walks the track up through the transitions on its own.

   Anything unreachable from the current build head greys out, which is how RCT
   teaches its own constraints without a word of explanation. */
(function () {
  const RC = window.RC || (window.RC = {});

  const S = { STEEP_DOWN: -6, GENTLE_DOWN: -2, LEVEL: 0, GENTLE_UP: 2, STEEP_UP: 6 };

  const DIRECTIONS = [
    { id: 'left-tight',  icon: 'dir-left-tight',  label: 'Tight left',  piece: 'turn-left-tight' },
    { id: 'left-wide',   icon: 'dir-left-wide',   label: 'Left',        piece: 'turn-left-wide' },
    { id: 'straight',    icon: 'dir-straight',    label: 'Straight',    piece: null },
    { id: 'right-wide',  icon: 'dir-right-wide',  label: 'Right',       piece: 'turn-right-wide' },
    { id: 'right-tight', icon: 'dir-right-tight', label: 'Tight right', piece: 'turn-right-tight' }
  ];

  const SLOPES = [
    { g: S.STEEP_DOWN,  icon: 'slope-steep-down',  label: 'Steep down' },
    { g: S.GENTLE_DOWN, icon: 'slope-gentle-down', label: 'Gentle down' },
    { g: S.LEVEL,       icon: 'slope-level',       label: 'Level' },
    { g: S.GENTLE_UP,   icon: 'slope-gentle-up',   label: 'Gentle up' },
    { g: S.STEEP_UP,    icon: 'slope-steep-up',    label: 'Steep up' }
  ];

  const SPECIALS = [
    { id: 'station',    icon: 'station',    label: 'Station' },
    { id: 'brake',      icon: 'brake',      label: 'Brakes' },
    { id: 'launch',     icon: 'launch',     label: 'Launch' },
    { id: 'loop-left',  icon: 'loop-left',  label: 'Loop, exits left' },
    { id: 'loop-right', icon: 'loop-right', label: 'Loop, exits right' }
  ];

  /* Straight pieces indexed by "entry slope > exit slope", so a direction plus
     a target slope resolves to exactly one piece. Specials are excluded so
     they don't shadow plain flat track. */
  const STRAIGHTS = new Map();
  for (const def of RC.PIECES) {
    if (def.kind !== 'straight') continue;
    if (def.station || def.brake || def.launch) continue;
    STRAIGHTS.set(def.gIn + '>' + def.gOut, def);
  }

  const ROLLS = [
    { bank: false, icon: 'roll-none', label: 'No banking' },
    { bank: true, icon: 'roll-bank', label: 'Banked 45°' }
  ];

  const sel = { dir: 'straight', slope: S.LEVEL, special: null, lift: false, bank: false };
  RC.build = sel;

  const dirBtns = new Map(), slopeBtns = new Map(), specialBtns = new Map();
  const rollBtns = new Map();

  /* Banking applies to turns only — there's nothing to bank on straight
     track, and the piece has to start and finish level either way. */
  function bankable() {
    const dir = DIRECTIONS.find(d => d.id === sel.dir);
    return !sel.special && !!(dir && dir.piece);
  }

  /* What would "build" place, for a given selection? */
  function resolveWith(dirId, slopeG, specialId) {
    if (specialId) return RC.pieceDef(specialId);
    const dir = DIRECTIONS.find(d => d.id === dirId);
    if (dir && dir.piece) return RC.pieceDef(dir.piece);
    const head = RC.track.head;
    if (!head) return null;
    return STRAIGHTS.get(head.g + '>' + slopeG) || null;
  }

  function resolve() { return resolveWith(sel.dir, sel.slope, sel.special); }

  /* Hovering a button previews that choice without committing to it. */
  let hover = null;
  RC.ghostDef = function () {
    if (hover) return resolveWith(hover.dir, hover.slope, hover.special);
    return resolve();
  };

  function setHover(h) {
    hover = h;
    RC.requestRender && RC.requestRender();
  }

  /* ---- construction ----------------------------------------------------- */
  function makeBtn(row, icon, label, onClick, onHover) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rct-btn';
    b.innerHTML = RC.icon(icon);
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    b.addEventListener('pointerenter', () => onHover && setHover(onHover()));
    b.addEventListener('pointerleave', () => setHover(null));
    row.appendChild(b);
    return b;
  }

  function buildRows() {
    const dirRow = document.getElementById('row-dir');
    const slopeRow = document.getElementById('row-slope');
    const specialRow = document.getElementById('row-special');
    if (!dirRow || !slopeRow || !specialRow) return;
    dirRow.innerHTML = slopeRow.innerHTML = specialRow.innerHTML = '';

    for (const d of DIRECTIONS) {
      const b = makeBtn(dirRow, d.icon, d.label, () => {
        sel.dir = d.id;
        sel.special = null;
        // Turns are level-only for now, so keep the slope row honest.
        if (d.piece) sel.slope = S.LEVEL;
        refresh();
      }, () => ({ dir: d.id, slope: d.piece ? S.LEVEL : sel.slope, special: null }));
      dirBtns.set(d.id, b);
    }

    for (const s of SLOPES) {
      const b = makeBtn(slopeRow, s.icon, s.label, () => {
        sel.slope = s.g;
        sel.special = null;
        sel.dir = 'straight';
        refresh();
      }, () => ({ dir: 'straight', slope: s.g, special: null }));
      slopeBtns.set(s.g, b);
    }

    // Chain lift lives with the slope controls, as it does in RCT.
    const lift = document.createElement('button');
    lift.type = 'button';
    lift.className = 'rct-btn rct-btn-wide';
    lift.id = 'btn-lift';
    // Deliberately a word, not an icon: it toggles a property of the pieces
    // you build rather than choosing a shape, so it shouldn't look like the
    // shape buttons beside it.
    lift.textContent = 'Chain';
    lift.title = 'Put a chain lift on uphill pieces as you build them';
    lift.addEventListener('click', () => {
      sel.lift = !sel.lift;
      setStatus(sel.lift ? 'Chain lift on — applies to uphill pieces' : 'Chain lift off');
      refresh();
    });
    slopeRow.appendChild(lift);

    const rollRow = document.getElementById('row-roll');
    if (rollRow) {
      rollRow.innerHTML = '';
      for (const r of ROLLS) {
        const b = makeBtn(rollRow, r.icon, r.label, () => {
          sel.bank = r.bank;
          refresh();
        }, null);
        rollBtns.set(r.bank, b);
      }
    }

    for (const sp of SPECIALS) {
      const b = makeBtn(specialRow, sp.icon, sp.label, () => {
        sel.special = sp.id;
        refresh();
      }, () => ({ dir: sel.dir, slope: sel.slope, special: sp.id }));
      specialBtns.set(sp.id, b);
    }
  }

  /* ---- build ------------------------------------------------------------ */
  function buildSelected() {
    const def = resolve();
    if (!def) { setStatus('Nothing to build from here'); return; }
    const check = RC.canPlace(def, RC.track.head);
    if (!check.ok) { setStatus(check.why); return; }
    RC.place(def.id, { lift: sel.lift, bank: sel.bank && bankable() });
    // A special is a one-shot choice; drop back to plain track afterwards.
    if (sel.special) sel.special = null;
    refresh();
  }

  let statusTimer = null;
  function setStatus(msg) {
    const el = document.getElementById('build-msg');
    if (!el) return;
    el.textContent = msg || '';
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => { el.textContent = ''; }, 2800);
  }

  /* ---- refresh ---------------------------------------------------------- */
  function refresh() {
    const head = RC.track.head;

    for (const d of DIRECTIONS) {
      const b = dirBtns.get(d.id);
      if (!b) continue;
      const def = resolveWith(d.id, d.piece ? S.LEVEL : sel.slope, null);
      const check = def ? RC.canPlace(def, head) : { ok: false, why: 'Not possible here' };
      b.disabled = !check.ok;
      b.title = check.ok ? d.label : `${d.label} — ${check.why}`;
      b.classList.toggle('selected', !sel.special && sel.dir === d.id);
    }

    for (const s of SLOPES) {
      const b = slopeBtns.get(s.g);
      if (!b) continue;
      const def = resolveWith('straight', s.g, null);
      const check = def ? RC.canPlace(def, head) : { ok: false, why: 'Not possible from this slope' };
      b.disabled = !check.ok;
      // The label says where you'll end up, not which piece it takes to get there.
      b.title = check.ok
        ? (def.gIn === def.gOut ? s.label : `${s.label} (via ${def.label.toLowerCase()})`)
        : `${s.label} — ${check.why}`;
      b.classList.toggle('selected', !sel.special && sel.dir === 'straight' && sel.slope === s.g);
    }

    for (const sp of SPECIALS) {
      const b = specialBtns.get(sp.id);
      if (!b) continue;
      const check = RC.canPlace(RC.pieceDef(sp.id), head);
      b.disabled = !check.ok;
      b.title = check.ok ? sp.label : `${sp.label} — ${check.why}`;
      b.classList.toggle('selected', sel.special === sp.id);
    }

    const canBank = bankable();
    for (const r of ROLLS) {
      const b = rollBtns.get(r.bank);
      if (!b) continue;
      b.disabled = !canBank;
      b.title = canBank ? r.label : `${r.label} — only turns can be banked`;
      b.classList.toggle('selected', canBank && sel.bank === r.bank);
    }

    const liftBtn = document.getElementById('btn-lift');
    if (liftBtn) liftBtn.classList.toggle('active', sel.lift);

    // Preview: name what will be built, or say why it can't be.
    const def = resolve();
    const check = def ? RC.canPlace(def, head) : { ok: false, why: 'Nothing to build from here' };
    const nameEl = document.getElementById('preview-name');
    const whyEl = document.getElementById('preview-why');
    if (nameEl) {
      nameEl.textContent = def
        ? def.label + (sel.bank && canBank ? ', banked' : '')
        : '—';
    }
    if (whyEl) whyEl.textContent = check.ok ? '' : check.why;

    const buildBtn = document.getElementById('btn-build');
    if (buildBtn) buildBtn.disabled = !check.ok;

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.disabled = RC.track.pieces.length === 0;

    const finishBtn = document.getElementById('btn-finish');
    if (finishBtn) {
      const done = RC.sameNode(RC.track.head, RC.track.start);
      finishBtn.disabled = done || RC.track.pieces.length === 0;
      finishBtn.title = done
        ? 'The circuit is already complete'
        : 'Join the track back to the station with plain filler track';
    }

    const roHead = document.getElementById('ro-head');
    if (roHead && head) {
      roHead.textContent = `(${head.i}, ${head.j}) · ${head.k} m · ${RC.slopeName(head.g)}`;
    }
    const st = RC.circuitStatus();
    const roCircuit = document.getElementById('ro-circuit');
    if (roCircuit) {
      roCircuit.textContent = st.label;
      roCircuit.className = st.ok ? 'ok' : '';
    }
    const roLength = document.getElementById('ro-length');
    if (roLength) roLength.textContent = RC.trackLength().toFixed(0) + ' m';

    // Only a real track edit should throw away a run in progress — merely
    // clicking a different slope button shouldn't.
    if (RC.version !== lastVersion) {
      lastVersion = RC.version;
      if (RC.onTrackEdit) RC.onTrackEdit();
    }
    RC.requestRender && RC.requestRender();
  }
  let lastVersion = -1;
  RC.refreshBuild = refresh;

  /* ---- wiring ----------------------------------------------------------- */
  RC.initBuild = function () {
    buildRows();

    const build = document.getElementById('btn-build');
    if (build) build.addEventListener('click', buildSelected);

    const undo = document.getElementById('btn-undo');
    if (undo) undo.addEventListener('click', () => { RC.undo(); refresh(); });

    const clear = document.getElementById('btn-clear');
    if (clear) clear.addEventListener('click', () => {
      RC.resetTrack();
      setStatus('Track cleared back to the station');
      refresh();
    });

    const finish = document.getElementById('btn-finish');
    if (finish) finish.addEventListener('click', () => {
      finish.disabled = true;
      const was = finish.textContent;
      finish.textContent = 'Working…';
      requestAnimationFrame(() => {
        const t0 = performance.now();
        const res = RC.completeTrack();
        const ms = performance.now() - t0;
        finish.textContent = was;
        setStatus(res.ok
          ? `Joined up with ${res.added} pieces (${ms.toFixed(0)} ms)`
          : res.why);
        refresh();
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        RC.undo();
        refresh();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        buildSelected();
      }
    });

    refresh();
  };
})();
