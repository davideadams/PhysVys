// Organic Molecule Builder -- page wiring.
(function () {
  'use strict';
  const OB = window.OB;
  const $ = id => document.getElementById(id);

  // Presets are SMILES. Most are labelled by their condensed formula so the
  // list does not give the names away.
  const PRESETS = [
    ['Alkanes', ['CC', 'CCC', 'CCCC', 'CC(C)C', 'CC(C)(C)CC', 'CCC(CC)C(C)C']],
    ['Alkenes and alkynes', ['C=C', 'CC=CC', 'CC(C)=C', 'C=CC=C', 'CC#C', 'C=CCC#C']],
    ['Haloalkanes', ['CCl', 'ClC(Cl)Cl', 'BrCCBr', 'CC(C)(Cl)C']],
    ['Alcohols', ['CCO', 'CC(O)C', 'CC(C)(O)C', 'OCCO', 'CC=CC(C)O']],
    ['Aldehydes and ketones', ['CC=O', 'CC(=O)C', 'CCC(=O)CC', 'CC(=O)CC=O']],
    ['Carboxylic acids and esters', ['CC(=O)O', 'CC(O)C(=O)O', 'OC(=O)CC(=O)O', 'CC(=O)OC', 'CCC(=O)OCC']],
    ['Amines and amides', ['CN', 'NCCN', 'CCNC', 'CC(N)C(=O)O', 'CC(=O)N', 'CC(=O)NC']],
  ];
  const BEYOND = [
    ['C1CCCCC1', 'A ring (cyclohexane)'],
    ['COC', 'An ether (methoxymethane)'],
    ['CC#N', 'A nitrile (ethanenitrile)'],
    ['O', 'No carbon (water)'],
    ['CC.CC', 'Two separate molecules'],
  ];
  const FALLBACK_START = 'CC(C)CC(=O)O';   // only if the generator ever comes up empty

  const GROUP_COLOUR = {
    acid: 'rgba(234, 88, 12, 0.30)', ester: 'rgba(219, 39, 119, 0.26)', amide: 'rgba(124, 58, 237, 0.26)',
    aldehyde: 'rgba(202, 138, 4, 0.32)', ketone: 'rgba(161, 98, 7, 0.28)', alcohol: 'rgba(220, 38, 38, 0.24)',
    amine: 'rgba(37, 99, 235, 0.26)', halo: 'rgba(22, 163, 74, 0.28)',
  };
  const GROUP_TAG = {
    acid: 'carboxylic acid', ester: 'ester', amide: 'amide', aldehyde: 'aldehyde', ketone: 'ketone',
    alcohol: 'alcohol', amine: 'amine', halo: 'haloalkane',
  };

  let result = null;
  let stepsOpen = false;
  let stepIndex = 0;
  let quiz = true;          // the name stays hidden until the steps are worked through
  let revealed = false;
  let showGroups = false;
  let show3D = true;
  let timer3D = null;
  let flashTimer = null;

  const view3d = window.THREE ? new OB.View3D($('three-root')) : null;
  if (!view3d) { show3D = false; $('visual-grid').classList.add('no-3d'); $('btn-3d').disabled = true; }

  const editor = new OB.Editor($('editor'), { onChange: update, onMessage: flash });

  function flash(text) {
    const el = $('flash');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---- presets ----
  (function fillPresets() {
    const sel = $('preset-select');
    const first = document.createElement('option');
    first.value = ''; first.textContent = 'Choose a molecule…';
    sel.appendChild(first);
    PRESETS.forEach(([label, list]) => {
      const og = document.createElement('optgroup');
      og.label = label;
      list.forEach(smi => {
        const o = document.createElement('option');
        o.value = smi;
        o.textContent = OB.subscriptText(OB.condensed(OB.toGraph(OB.parseSmiles(smi))) || smi);
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    const og = document.createElement('optgroup');
    og.label = 'Beyond this page';
    BEYOND.forEach(([smi, text]) => {
      const o = document.createElement('option');
      o.value = smi; o.textContent = text;
      og.appendChild(o);
    });
    sel.appendChild(og);
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      editor.setMolecule(OB.parseSmiles(sel.value));
      sel.value = '';
    });
  })();

  // ---- controls ----
  function segment(id, attr, fn) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      fn(b.dataset[attr]);
    });
  }
  segment('tool-seg', 'tool', t => {
    editor.tool = t;
    $('editor').dataset.tool = t;
  });
  segment('element-grid', 'el', el => { editor.element = el; });
  segment('view-seg', 'view', v => { editor.view = v; editor.draw(); });
  segment('model-seg', 'model', m => { if (view3d) view3d.setMode(m); });

  const recent = [];
  ['stage1', 'stage2'].forEach(stage => {
    $('btn-rand-' + stage).addEventListener('click', () => {
      const res = OB.randomMolecule(stage, recent);
      if (!res) { flash('Could not make a molecule that time. Try again.'); return; }
      recent.push(res.name);
      if (recent.length > 12) recent.shift();
      stepsOpen = false;
      editor.setMolecule(res.mol);
    });
  });

  $('btn-undo').addEventListener('click', () => editor.undo());
  $('btn-tidy').addEventListener('click', () => editor.tidy());
  $('btn-clear').addEventListener('click', () => editor.clear());
  $('btn-3d').addEventListener('click', () => {
    show3D = !show3D;
    $('btn-3d').classList.toggle('active', show3D);
    $('btn-3d').setAttribute('aria-pressed', String(show3D));
    $('visual-grid').classList.toggle('no-3d', !show3D);
    if (show3D) schedule3D();
  });
  const switchBtn = (id, fn) => $(id).addEventListener('click', () => {
    const on = $(id).getAttribute('aria-pressed') !== 'true';
    $(id).setAttribute('aria-pressed', String(on));
    fn(on);
  });
  switchBtn('btn-groups', on => { showGroups = on; applyHighlight(); });
  switchBtn('btn-quiz', on => { quiz = on; revealed = false; refresh(); });
  $('btn-reveal').addEventListener('click', () => { stepsOpen = true; setStep(0); });
  $('btn-steps').addEventListener('click', () => {
    stepsOpen = !stepsOpen;
    setStep(0);
  });
  $('step-prev').addEventListener('click', () => setStep(stepIndex - 1));
  $('step-next').addEventListener('click', () => setStep(stepIndex + 1));
  $('step-dots').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) setStep(Number(b.dataset.i));
  });

  function refresh() { renderName(); renderSteps(); applyHighlight(); }

  function setStep(i) {
    const n = result && result.steps ? result.steps.length : 1;
    stepIndex = Math.max(0, Math.min(n - 1, i));
    if (stepsOpen && stepIndex >= n - 2) revealed = true;   // step 5 shows the whole name
    refresh();
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      editor.undo();
    }
  });

  // ---- update cycle ----
  function update(mol) {
    const g = OB.toGraph(mol);
    try {
      result = OB.nameMolecule(mol);
    } catch (err) {
      console.error(err);
      result = { status: 'error', headline: 'The naming code hit an error',
        reason: 'This is a fault in the page, not in your molecule: ' + err.message };
    }
    revealed = false;
    stepIndex = 0;
    $('name-more').open = false;
    renderName();
    renderSteps();
    renderNotations(g);
    applyHighlight();
    schedule3D();
  }

  // How much of the name to show: -1 nothing yet, 0..5 the step reached
  // (see OB.nameParts), or 'full'.
  function nameLevel() {
    if (!quiz) return 'full';
    if (stepsOpen) return stepIndex >= result.steps.length - 2 ? 'full' : stepIndex;
    return revealed ? 'full' : -1;
  }

  // The name with the parts not yet worked out shown as empty slots.
  function partialHTML(p, level) {
    const slot = label => '<span class="slot">' + label + '</span>';
    const out = [];
    if (p.alkyl) out.push(level >= 3 ? p.alkyl : slot('alkyl group'), ' ');
    if (level >= 3) { if (p.prefix) out.push(p.prefix); } else out.push(slot('prefixes'));
    out.push(level >= 1 ? p.stem : slot('stem'));
    out.push(slot('…'));
    out.push(level >= 0 ? p.ending : slot('ending'));
    return out.join('');
  }

  function renderName() {
    const r = result;
    const badge = $('name-badge');
    const text = $('name-text');
    const named = r.status === 'named';
    const level = named ? nameLevel() : 'full';
    let label = 'Empty', cls = '';
    if (named && level !== 'full') [label, cls] = stepsOpen ? ['Building the name', 'building'] : ['Name hidden', ''];
    else if (named) [label, cls] = ['IUPAC name', 'ok'];
    else if (r.status === 'out-of-scope') [label, cls] = ['Outside this page\'s scope', 'scope'];
    else if (r.status === 'not-organic') [label, cls] = ['Not organic', 'scope'];
    else if (r.status === 'not-one-compound') [label, cls] = ['No single name', 'bad'];
    else if (r.status === 'invalid' || r.status === 'error') [label, cls] = ['Cannot name', 'bad'];
    badge.textContent = label;
    badge.className = 'badge ' + cls;

    const hiddenAndClosed = named && quiz && !revealed && !stepsOpen;
    $('btn-reveal').hidden = !hiddenAndClosed;
    $('btn-steps').hidden = !named || hiddenAndClosed;
    $('btn-steps').textContent = stepsOpen ? 'Hide naming steps' : 'Show naming steps';
    $('btn-steps').setAttribute('aria-expanded', String(stepsOpen));

    if (named) {
      text.classList.remove('muted');
      if (level === 'full') {
        text.textContent = r.name;
        $('name-reason').textContent = '';
      } else {
        text.innerHTML = partialHTML(r.parts, level);
        $('name-reason').textContent = stepsOpen
          ? 'The name fills in as you work through the steps.'
          : 'Work through the naming steps to build the name.';
      }
    } else if (r.status === 'out-of-scope') {
      text.textContent = 'This page cannot name this molecule';
      text.classList.add('muted');
      $('name-reason').textContent = 'Reason: ' + r.reason + ' The compound does have an IUPAC name; ' +
        'this page does not have the rules to work it out. The highlighted atoms show where the problem is.';
    } else {
      text.textContent = r.headline;
      text.classList.add('muted');
      $('name-reason').textContent = r.reason || '';
    }

    // Stereo notes stay folded away under "Learn more" for students who want them.
    const notes = $('name-notes');
    notes.innerHTML = '';
    const showMore = named && level === 'full' && r.notes.length > 0;
    $('name-more').hidden = !showMore;
    if (showMore) {
      r.notes.forEach(n => {
        const li = document.createElement('li');
        li.textContent = n.text;
        notes.appendChild(li);
      });
    }
  }

  function renderSteps() {
    const open = stepsOpen && result && result.status === 'named';
    $('steps').hidden = !open;
    if (!open) return;
    const steps = result.steps;
    stepIndex = Math.max(0, Math.min(steps.length - 1, stepIndex));
    const dots = $('step-dots');
    dots.innerHTML = '';
    steps.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step-dot' + (i === stepIndex ? ' active' : '');
      b.dataset.i = String(i);
      b.textContent = String(i + 1);
      b.title = s.title;
      dots.appendChild(b);
    });
    const s = steps[stepIndex];
    $('step-title').textContent = 'Step ' + (stepIndex + 1) + ' of ' + steps.length + ': ' + s.title;
    $('step-body').innerHTML = s.lines.map(l => '<p>' + l + '</p>').join('');
    $('step-prev').disabled = stepIndex === 0;
    $('step-next').disabled = stepIndex === steps.length - 1;
  }

  function applyHighlight() {
    const r = result;
    let hl = null;
    if (r && r.status === 'named' && stepsOpen) {
      const s = r.steps[stepIndex];
      hl = { atoms: new Set(s.atoms), labels: new Map(s.labels), problem: false };
    } else if (r && (r.status === 'out-of-scope' || r.status === 'invalid') && r.atoms && r.atoms.length) {
      hl = { atoms: new Set(r.atoms), labels: new Map(), problem: true };
    }
    editor.highlight = hl;

    editor.groupColours = null;
    if (showGroups) {
      const g = OB.toGraph(editor.mol);
      try {
        const groups = OB.classifyGroups(g);
        const map = new Map();
        groups.forEach(gr => gr.atoms.forEach(i => map.set(g.ids[i], GROUP_COLOUR[gr.type])));
        editor.groupColours = map;
      } catch (e) {
        if (!(e instanceof OB.ScopeError)) console.error(e);
      }
    }
    editor.draw();
  }

  function renderNotations(g) {
    const set = (id, html) => { $(id).innerHTML = html; };
    if (!g.n || OB.preCheck(g) && OB.preCheck(g).status === 'invalid') {
      ['n-molecular', 'n-empirical', 'n-mass', 'n-condensed', 'n-smiles', 'n-groups'].forEach(id => set(id, '—'));
      return;
    }
    const f = OB.formulae(g);
    set('n-molecular', OB.subscriptHTML(f.molecular));
    set('n-empirical', OB.subscriptHTML(f.empirical));
    set('n-mass', f.mass.toFixed(2) + ' g mol<sup>−1</sup>');
    const cond = OB.condensed(g);
    set('n-condensed', cond ? OB.subscriptHTML(cond) : 'Not shown for rings or separate pieces.');
    $('n-smiles').textContent = OB.smiles(g);

    let tags = [];
    try {
      const groups = OB.classifyGroups(g);
      const counts = new Map();
      groups.forEach(x => counts.set(x.type, (counts.get(x.type) || 0) + 1));
      counts.forEach((n, t) => tags.push([GROUP_TAG[t] + (n > 1 ? ' × ' + n : ''), GROUP_COLOUR[t]]));
      if (g.bonds.some(b => b.order === 2 && g.el[b.a] === 'C' && g.el[b.b] === 'C')) tags.push(['alkene (C=C)', 'rgba(15,118,110,0.18)']);
      if (g.bonds.some(b => b.order === 3 && g.el[b.a] === 'C' && g.el[b.b] === 'C')) tags.push(['alkyne (C≡C)', 'rgba(15,118,110,0.18)']);
      if (!tags.length) tags.push([g.el.includes('C') ? 'none: an alkane' : 'none', 'rgba(21,48,77,0.08)']);
      set('n-groups', tags.map(([t, c]) => '<span class="group-tag" style="background:' + c + '">' + t + '</span>').join(''));
    } catch (e) {
      if (!(e instanceof OB.ScopeError)) console.error(e);
      set('n-groups', 'Contains a group this page does not classify.');
    }
  }

  function schedule3D() {
    if (!view3d || !show3D) return;
    clearTimeout(timer3D);
    timer3D = setTimeout(() => {
      const g = OB.toGraph(editor.mol);
      view3d.show(OB.preCheck(g) && OB.preCheck(g).status === 'invalid' ? { n: 0 } : g);
    }, 180);
  }

  // Open on a random Stage 1 molecule, ready to name.
  const first = OB.randomMolecule('stage1', recent);
  if (first) recent.push(first.name);
  editor.setMolecule(first ? first.mol : OB.parseSmiles(FALLBACK_START));
  editor.undoStack = [];
})();
