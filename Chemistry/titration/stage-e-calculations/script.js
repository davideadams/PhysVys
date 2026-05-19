// Stage E — Check Your Calculations
// Reads the live shared doc (chem.titration.live) and renders, per titrated
// aliquot, the textbook n_known → n_unknown → expected titre → c(titrant)
// chain. Reactive: re-renders on storage events so it stays current as new
// titrations finish in Stage C.

(() => {
  const ALIQUOT_NOMINAL_ML = 25.00;
  const LIVE_KEY = 'chem.titration.live';

  function readLive() {
    let doc;
    try { doc = JSON.parse(sessionStorage.getItem(LIVE_KEY)); } catch (_) { doc = null; }
    if (doc) return doc;
    // Backwards compat: legacy single-shot handoff written by older Stage B.
    try { return JSON.parse(sessionStorage.getItem('chem.stageB.result')); }
    catch (_) { return null; }
  }

  const cards     = document.getElementById('aliquot-cards');
  const empty     = document.getElementById('empty-state');
  const sumName   = document.getElementById('sum-reagent');
  const sumForm   = document.getElementById('sum-formula');
  const sumRole   = document.getElementById('sum-role');
  const sumStdC   = document.getElementById('sum-stdconc');
  const sumRatio  = document.getElementById('sum-ratio');
  const truthCT   = document.getElementById('truth-titrant');
  const truthMean = document.getElementById('truth-mean');
  const truthPct  = document.getElementById('truth-pct');

  // ── Helpers ─────────────────────────────────────────────
  function fmtMol(x)  { return x.toFixed(5) + ' mol'; }
  function fmtML(x)   { return x.toFixed(2) + ' mL'; }
  function fmtM(x)    { return x.toFixed(4) + ' M'; }
  function calcLine(label, work, result, headline) {
    return `<div class="calc-line${headline ? ' headline' : ''}">
              <span class="label">${label}</span>
              <span class="work">${work}</span>
              <span class="result">${result}</span>
            </div>`;
  }

  function render() {
    const live = readLive();
    const allAliquots = (live && Array.isArray(live.aliquots)) ? live.aliquots : [];
    // Only show aliquots the student has actually titrated — pending and
    // discarded ones don't have a measured titre to compare against.
    const titrated = allAliquots.filter(a => a.status === 'titrated');

    if (!live || titrated.length === 0) {
      empty.classList.remove('hidden');
      cards.innerHTML = '';
      // Keep summary blank until there's something.
      sumName.textContent  = '—';
      sumForm.innerHTML    = '—';
      sumRole.textContent  = '—';
      sumStdC.textContent  = '—';
      sumRatio.textContent = '—';
      truthCT.textContent   = '—';
      truthMean.textContent = '—';
      truthPct.textContent  = '—';
      return;
    }
    empty.classList.add('hidden');

    // Reagent metadata for the chain.
    const reagent = (live.reagentId && window.REAGENTS && window.REAGENTS[live.reagentId])
      ? window.REAGENTS[live.reagentId] : null;
    const equivalents = reagent ? reagent.equivalents : 1;
    const stdRole     = reagent ? reagent.role : 'standard';
    const titrantRole = stdRole === 'acid' ? 'base' : stdRole === 'base' ? 'acid' : 'titrant';
    const stdName     = reagent ? reagent.name : (live.reagentName || 'standard');
    const stdFormula  = reagent ? reagent.formula : '—';
    const stdConcM    = live.stdConc_M;
    const trueTitrantC = live.titrantTrueConc_M || 0.1000;

    sumName.textContent  = stdName;
    sumForm.innerHTML    = stdFormula;
    sumRole.textContent  = stdRole + ' (titrant is ' + titrantRole + ')';
    sumStdC.textContent  = stdConcM.toFixed(4) + ' M';
    sumRatio.textContent = equivalents + ' : 1';

    const computedTitrantConcs = [];
    const c_burette_actual = (live.burette && live.burette.effectiveConc_M) || trueTitrantC;
    const V_aliq_L = ALIQUOT_NOMINAL_ML / 1000;

    cards.innerHTML = titrated.map(a => {
      // The student's chain always ENDS at c(titrant) — the unknown — but
      // which "side" the standard is on flips between techniques.
      const coneIsStd = a.sourceTag === 'standard';

      // Expected titre = the volume reading a perfect titrator would see,
      // accounting for Stage B technique via moles_true.
      let titreL_expected, n_known, n_unknown, c_titrant_computed;
      let chainRows;
      if (coneIsStd) {
        // Standard in cone (typical). c_std × V_aliq → n(std) → ×eq → n(tit) → ÷V_titre → c(tit).
        titreL_expected = (a.moles_true * equivalents) / c_burette_actual;
        n_known   = stdConcM * V_aliq_L;
        n_unknown = n_known * equivalents;
        c_titrant_computed = n_unknown / titreL_expected;
        chainRows = [
          [`n(${stdRole})`,
           `c × V = ${stdConcM.toFixed(4)} × ${V_aliq_L.toFixed(5)}`,
           fmtMol(n_known)],
          [`n(${titrantRole})`,
           `n(${stdRole}) × ${equivalents} = ${n_known.toFixed(5)} × ${equivalents}`,
           fmtMol(n_unknown)],
          [`V(titre)`,
           `expected reading on the burette`,
           fmtML(titreL_expected * 1000)],
          [`c(${titrantRole})`,
           `n ÷ V = ${n_unknown.toFixed(5)} ÷ ${titreL_expected.toFixed(5)}`,
           fmtM(c_titrant_computed), true],
        ];
      } else {
        // Titrant in cone, standard in burette (technique-different).
        // c_std × V_titre → n(std) → ×eq → n(tit) in aliquot → ÷V_aliq → c(tit).
        titreL_expected = (a.moles_true / equivalents) / stdConcM;
        n_known   = stdConcM * titreL_expected;
        n_unknown = n_known * equivalents;
        c_titrant_computed = n_unknown / V_aliq_L;
        chainRows = [
          [`V(titre)`,
           `expected reading on the burette`,
           fmtML(titreL_expected * 1000)],
          [`n(${stdRole})`,
           `c × V = ${stdConcM.toFixed(4)} × ${titreL_expected.toFixed(5)}`,
           fmtMol(n_known)],
          [`n(${titrantRole})`,
           `n(${stdRole}) × ${equivalents} = ${n_known.toFixed(5)} × ${equivalents}`,
           fmtMol(n_unknown)],
          [`c(${titrantRole})`,
           `n ÷ V = ${n_unknown.toFixed(5)} ÷ ${V_aliq_L.toFixed(5)}`,
           fmtM(c_titrant_computed), true],
        ];
      }
      computedTitrantConcs.push(c_titrant_computed);

      const measured = (typeof a.titre_mL === 'number') ? a.titre_mL : null;
      const measuredHtml = measured != null
        ? `<span class="meta">your titre <b>${fmtML(measured)}</b></span>`
        : '';
      const sourceLabel = coneIsStd ? 'standard' : 'titrant (technique-different)';

      return `<div class="aliquot-card">
        <div class="aliquot-card-head">
          <span class="id">Aliquot #${a.id}</span>
          <span class="meta">from ${sourceLabel} · expected titre <b>${fmtML(titreL_expected * 1000)}</b></span>
          ${measuredHtml}
        </div>
        ${chainRows.map(r => calcLine(r[0], r[1], r[2], r[3])).join('')}
      </div>`;
    }).join('');

    // Truth comparison — student's computed unknown is always c(titrant);
    // truth is the live doc's `titrantTrueConc_M`.
    const meanC = computedTitrantConcs.reduce((s, x) => s + x, 0) / computedTitrantConcs.length;
    const pctDiff = trueTitrantC > 0
      ? ((meanC - trueTitrantC) / trueTitrantC) * 100
      : 0;
    truthCT.textContent   = fmtM(trueTitrantC);
    truthMean.textContent = fmtM(meanC);
    truthPct.textContent  = (pctDiff >= 0 ? '+' : '') + pctDiff.toFixed(2) + ' %';
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key !== LIVE_KEY && ev.key !== 'chem.stageB.result') return;
    render();
  });

  render();
})();
