/* Build palette: piece selection, placement, undo, and the RCT-style
   greying-out of pieces that don't match the build head's current slope. */
(function () {
  const RC = window.RC || (window.RC = {});

  const GROUPS = [
    { label: 'Straight', ids: ['flat', 'gentle-up', 'steep-up', 'gentle-down', 'steep-down'] },
    {
      label: 'Transitions', ids: [
        'flat-to-gentle-up', 'gentle-up-to-flat', 'gentle-to-steep-up', 'steep-to-gentle-up',
        'flat-to-gentle-down', 'gentle-down-to-flat', 'gentle-to-steep-down', 'steep-to-gentle-down'
      ]
    },
    { label: 'Turns', ids: ['turn-left-wide', 'turn-right-wide', 'turn-left-tight', 'turn-right-tight'] },
    { label: 'Special', ids: ['station', 'brake', 'launch'] }
  ];

  /* Compact glyphs so the palette reads at a glance rather than as prose. */
  const GLYPH = {
    'flat': '—',
    'gentle-up': '／', 'steep-up': '⟋',
    'gentle-down': '＼', 'steep-down': '⟍',
    'flat-to-gentle-up': '—／', 'gentle-up-to-flat': '／—',
    'gentle-to-steep-up': '／⟋', 'steep-to-gentle-up': '⟋／',
    'flat-to-gentle-down': '—＼', 'gentle-down-to-flat': '＼—',
    'gentle-to-steep-down': '＼⟍', 'steep-to-gentle-down': '⟍＼',
    'turn-left-wide': '↰', 'turn-right-wide': '↱',
    'turn-left-tight': '⤺', 'turn-right-tight': '⤻',
    'station': '▤', 'brake': '▥', 'launch': '»'
  };

  const state = { selected: 'flat', lift: false };
  RC.build = state;

  const buttons = new Map();   // defId -> button element
  let paletteEl = null;

  function buildPalette() {
    paletteEl = document.getElementById('palette');
    if (!paletteEl) return;
    paletteEl.innerHTML = '';

    for (const group of GROUPS) {
      const wrap = document.createElement('div');
      wrap.className = 'pal-group';

      const lab = document.createElement('div');
      lab.className = 'pal-label';
      lab.textContent = group.label;
      wrap.appendChild(lab);

      const grid = document.createElement('div');
      grid.className = 'pal-grid';

      for (const id of group.ids) {
        const def = RC.pieceDef(id);
        if (!def) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pal-btn';
        b.dataset.piece = id;
        b.innerHTML = `<span class="pal-glyph">${GLYPH[id] || '?'}</span>` +
                      `<span class="pal-name">${def.label}</span>`;
        b.addEventListener('click', () => selectAndPlace(id));
        b.addEventListener('pointerenter', () => preview(id));
        b.addEventListener('pointerleave', () => preview(null));
        grid.appendChild(b);
        buttons.set(id, b);
      }
      wrap.appendChild(grid);
      paletteEl.appendChild(wrap);
    }
  }

  /* Hovering a palette button previews that piece instead of the selected
     one, so you can see where something lands before committing. */
  let previewId = null;
  function preview(id) {
    previewId = id;
    RC.requestRender && RC.requestRender();
  }

  RC.ghostDef = function () {
    const id = previewId || state.selected;
    return id ? RC.pieceDef(id) : null;
  };

  function selectAndPlace(id) {
    state.selected = id;
    const def = RC.pieceDef(id);
    const check = RC.canPlace(def, RC.track.head);
    if (check.ok) {
      RC.place(id, { lift: state.lift });
      flash(id, 'ok');
    } else {
      flash(id, 'bad');
      setStatus(check.why);
    }
    refresh();
  }

  function flash(id, cls) {
    const b = buttons.get(id);
    if (!b) return;
    b.classList.add('flash-' + cls);
    setTimeout(() => b.classList.remove('flash-' + cls), 180);
  }

  /* ---- status ---------------------------------------------------------- */
  let statusTimer = null;
  function setStatus(msg) {
    const el = document.getElementById('build-msg');
    if (!el) return;
    el.textContent = msg || '';
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => { el.textContent = ''; }, 2600);
  }

  function refresh() {
    const head = RC.track.head;

    // Grey out anything whose entry slope doesn't match the head.
    for (const [id, b] of buttons) {
      const def = RC.pieceDef(id);
      const check = RC.canPlace(def, head);
      b.disabled = !check.ok;
      b.title = check.ok ? def.label : `${def.label} — ${check.why}`;
      b.classList.toggle('selected', id === state.selected);
    }

    const liftBtn = document.getElementById('btn-lift');
    if (liftBtn) liftBtn.classList.toggle('active', state.lift);

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.disabled = RC.track.pieces.length === 0;

    // Head + circuit readouts.
    const st = RC.circuitStatus();
    const roHead = document.getElementById('ro-head');
    if (roHead && head) {
      roHead.textContent =
        `(${head.i}, ${head.j}) · ${head.k} m · ${RC.slopeName(head.g)}`;
    }
    const roCircuit = document.getElementById('ro-circuit');
    if (roCircuit) {
      roCircuit.textContent = st.label;
      roCircuit.className = st.ok ? 'ok' : '';
    }
    const roLength = document.getElementById('ro-length');
    if (roLength) roLength.textContent = RC.trackLength().toFixed(0) + ' m';

    // Editing the track invalidates any run in progress.
    if (RC.onTrackEdit) RC.onTrackEdit();

    RC.requestRender && RC.requestRender();
  }
  RC.refreshBuild = refresh;

  /* ---- wiring ---------------------------------------------------------- */
  RC.initBuild = function () {
    buildPalette();

    const undo = document.getElementById('btn-undo');
    if (undo) undo.addEventListener('click', () => { RC.undo(); refresh(); });

    const clear = document.getElementById('btn-clear');
    if (clear) clear.addEventListener('click', () => {
      RC.resetTrack();
      setStatus('Track cleared back to the station');
      refresh();
    });

    const lift = document.getElementById('btn-lift');
    if (lift) lift.addEventListener('click', () => {
      state.lift = !state.lift;
      setStatus(state.lift
        ? 'Chain lift on — applies to uphill pieces as you build'
        : 'Chain lift off');
      refresh();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        RC.undo();
        refresh();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectAndPlace(state.selected);
      }
    });

    refresh();
  };
})();
