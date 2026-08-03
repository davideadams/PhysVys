/* Saving tracks.

   A track is entirely described by the node it starts from and the sequence of
   pieces built off it — every node after the first follows from RC.exitNode —
   so that is all that gets written down. Storing the derived nodes as well
   would be larger, and would freeze a piece's geometry at the version that
   saved it; replaying means a track saved today still comes back correctly if
   a piece's shape is ever corrected.

   The exceptions are the loops, whose radius can be changed after building and
   which therefore carry sizing on the node itself. Those ride along.

   Everything here degrades quietly. localStorage is unavailable in a few
   ordinary situations — private windows, storage turned off, some browsers on
   file:// — and a sim that throws on load because it could not read a save
   would be far worse than one that simply has no saves. */
(function () {
  const RC = window.RC || (window.RC = {});

  const INDEX_KEY = 'physvys.rc.saves';
  const SAVE_KEY = 'physvys.rc.save.';
  const AUTO_KEY = 'physvys.rc.autosave';
  /* Bumped to 2 when transitions stopped being one tile long. A save is a list
     of piece ids replayed through today's geometry, which is normally the point
     — correct a piece's shape and old tracks come back correct. But this change
     moved where each piece ENDS, so a replayed track advances further than it
     did, stops closing, and eventually walks off the park. applyTrackData would
     refuse it on the bounds check, which is graceful but says "lands outside the
     park" about a track that used to fit perfectly well. The version number
     makes it say the true thing instead. */
  const FORMAT = 2;

  /* ---- storage, if we have any ------------------------------------------ */
  let store = null, probed = false;

  function storage() {
    if (probed) return store;
    probed = true;
    try {
      const s = window.localStorage;
      // Availability is not the same as usability: Safari's private mode has
      // localStorage but throws on write, so prove it before trusting it.
      const probe = '__rc_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      store = s;
    } catch (e) {
      store = null;
    }
    return store;
  }
  RC.storageAvailable = () => !!storage();

  function readJSON(key) {
    const s = storage();
    if (!s) return null;
    try {
      const raw = s.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;      // out of quota, most likely
    }
  }

  /* ---- the track, written down ------------------------------------------ */
  const node5 = n => ({ i: n.i, j: n.j, dir: n.dir, k: n.k, g: n.g });

  RC.serializeTrack = function () {
    const t = RC.track;
    const pieces = t.pieces.map(p => {
      const out = { d: p.defId };
      if (p.lift) out.l = 1;
      if (p.bank) out.b = 1;
      // Loop sizing lives on the node, since it is set after the piece is laid.
      if (p.node.loopR != null) out.R = p.node.loopR;
      if (p.node.loopL != null) out.L = p.node.loopL;
      if (p.node.loopA != null) out.A = p.node.loopA;
      return out;
    });
    return { v: FORMAT, start: node5(t.start), pieces };
  };

  /* Rebuild a track from serialised data. Returns { ok, why } and leaves the
     existing track untouched on failure — a bad save must not destroy what the
     student currently has on screen. */
  RC.applyTrackData = function (data) {
    if (!data || typeof data !== 'object') return { ok: false, why: 'Not a saved track' };
    if (data.v !== FORMAT) return { ok: false, why: `Saved by a different version (${data.v})` };
    if (!data.start || !Array.isArray(data.pieces)) return { ok: false, why: 'Saved track is incomplete' };

    // Build into a scratch list first, so a failure part way through cannot
    // leave a half-restored track behind.
    const start = node5(data.start);
    let head = Object.assign({}, start);
    const pieces = [];

    for (let n = 0; n < data.pieces.length; n++) {
      const p = data.pieces[n];
      const def = RC.pieceDef(p && p.d);
      if (!def) return { ok: false, why: `Piece ${n + 1} is a kind this version does not have` };
      if (def.gIn !== head.g) return { ok: false, why: `Piece ${n + 1} (${p.d}) does not fit the one before it` };

      const node = Object.assign({}, head);
      if (p.R != null) node.loopR = p.R;
      if (p.L != null) node.loopL = p.L;
      if (p.A != null) node.loopA = p.A;

      pieces.push({ defId: p.d, node, lift: !!p.l, bank: !!p.b });
      head = RC.exitNode(def, node);
      if (head.k < 0 || !RC.inBounds(head.i, head.j)) {
        return { ok: false, why: `Piece ${n + 1} (${p.d}) lands outside the park` };
      }
    }

    RC.demo = null;                 // a saved track replaces any demonstration
    RC.track.start = start;
    RC.track.pieces = pieces;
    RC.track.head = head;
    RC.version++;
    // Opening a track is not an edit to the one that was there, so there is
    // nothing sensible for undo to go back to.
    RC.clearHistory && RC.clearHistory();
    return { ok: true, count: pieces.length };
  };

  /* ---- named saves ------------------------------------------------------- */
  function readIndex() {
    const list = readJSON(INDEX_KEY);
    return Array.isArray(list) ? list.filter(n => typeof n === 'string') : [];
  }

  RC.listSaves = readIndex;

  /* How much of a name a list of tracks shows. A name is stored whole and
     loaded whole — this is only about the width of the track list in the top
     bar, which a select sizes to its longest entry. Fifteen because the
     longest built-in preset name is seventeen characters, so a student's
     track can never widen the bar beyond what it already is; and because ten
     cuts most names before they mean anything. The full name is still there
     on hover, and in the list once it is open. */
  const NAME_SHOWN = 15;
  RC.NAME_SHOWN = NAME_SHOWN;

  RC.shortTrackName = function (name) {
    const s = String(name == null ? '' : name);
    if (s.length <= NAME_SHOWN) return s;
    // The ellipsis counts towards the limit, so the cap really is the width.
    return s.slice(0, NAME_SHOWN - 1).replace(/\s+$/, '') + '…';
  };

  RC.saveTrack = function (name) {
    name = String(name || '').trim();
    if (!name) return { ok: false, why: 'Give the track a name' };
    if (name.length > 40) return { ok: false, why: 'That name is too long' };
    if (!storage()) return { ok: false, why: 'This browser will not let the page store anything' };
    if (!RC.track.pieces.length) return { ok: false, why: 'There is no track to save' };

    if (!writeJSON(SAVE_KEY + name, RC.serializeTrack())) {
      return { ok: false, why: 'There was no room to store it' };
    }
    const list = readIndex();
    if (list.indexOf(name) < 0) {
      list.push(name);
      list.sort();
      writeJSON(INDEX_KEY, list);
    }
    return { ok: true, name };
  };

  RC.loadSave = function (name) {
    const data = readJSON(SAVE_KEY + name);
    if (!data) return { ok: false, why: `No saved track called "${name}"` };
    return RC.applyTrackData(data);
  };

  RC.deleteSave = function (name) {
    const s = storage();
    if (!s) return { ok: false, why: 'Nothing is stored' };
    try { s.removeItem(SAVE_KEY + name); } catch (e) { /* nothing to undo */ }
    writeJSON(INDEX_KEY, readIndex().filter(n => n !== name));
    return { ok: true };
  };

  /* ---- the working track ------------------------------------------------
     Kept separately from the named saves so that coming back to the page
     resumes whatever was being built, without the student having had to think
     to save it. Named saves are for keeping something; this is for not losing
     it. */
  RC.autosave = function () {
    if (RC.demo) return false;      // a demonstration is not the student's work
    if (!RC.track.pieces.length) return false;
    return writeJSON(AUTO_KEY, RC.serializeTrack());
  };

  RC.hasAutosave = function () { return !!readJSON(AUTO_KEY); };

  RC.restoreAutosave = function () {
    const data = readJSON(AUTO_KEY);
    if (!data) return { ok: false, why: 'Nothing was left unfinished' };
    return RC.applyTrackData(data);
  };

  /* ---- saves from an older version --------------------------------------
     Which stored tracks were written by a format this build can no longer
     replay. Returns names, with the autosave listed as null, so a student who
     comes back to a track they spent a lesson on is told what happened to it
     rather than finding an empty park.

     Deliberately does NOT delete anything. Work disappearing without consent is
     worse than work that will not open, and a student may want to know the name
     of what they lost even if nothing can be done for it. */
  RC.staleSaves = function () {
    if (!storage()) return [];
    const out = [];
    const auto = readJSON(AUTO_KEY);
    if (auto && auto.v !== FORMAT) out.push(null);
    for (const name of readIndex()) {
      const data = readJSON(SAVE_KEY + name);
      if (data && data.v !== FORMAT) out.push(name);
    }
    return out;
  };

  /* Throw away exactly the stale ones, leaving anything still readable alone.
     Only ever called from a button the student pressed. */
  RC.dropStaleSaves = function () {
    const stale = RC.staleSaves();
    for (const name of stale) {
      if (name === null) RC.clearAutosave();
      else RC.deleteSave(name);
    }
    return stale.length;
  };

  RC.clearAutosave = function () {
    const s = storage();
    if (s) { try { s.removeItem(AUTO_KEY); } catch (e) { /* fine */ } }
  };
})();
