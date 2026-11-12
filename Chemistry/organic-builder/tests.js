// Organic Molecule Builder -- self-test. Loaded by test.html.
// Each case is a SMILES string and the expected result. Names follow the
// conventions the page states: the parent chain holds as many multiple bonds
// as possible, and a locant that can only take one value is left out.
(function () {
  'use strict';
  const OB = window.OB;

  const NAMES = [
    // alkanes
    ['C', 'methane'], ['CC', 'ethane'], ['CCC', 'propane'], ['CCCC', 'butane'], ['CCCCCCCCCC', 'decane'],
    ['CC(C)C', '2-methylpropane'], ['CC(C)(C)C', '2,2-dimethylpropane'], ['CCC(C)CC', '3-methylpentane'],
    ['CC(C)CC(C)C', '2,4-dimethylpentane'], ['CC(C)(C)CC', '2,2-dimethylbutane'],
    ['CC(C)C(C)(C)C', '2,2,3-trimethylbutane'], ['CCC(CC)C(C)C', '3-ethyl-2-methylpentane'],
    ['CCC(C)C(CC)CC', '3-ethyl-4-methylhexane'], ['CCCC(C(C)C)CCC', '4-(propan-2-yl)heptane'], ['CCCCC(C(C)(C)C)CCCC', '5-(2-methylpropan-2-yl)nonane'],
    ['CCCCC(C(C)CC)CCCC', '5-(butan-2-yl)nonane'], ['C=CCC(CCCC)CCCC', '5-(prop-2-en-1-yl)nonane'],
    ['CC(=C)C(CCCC)CCCC', '5-(prop-1-en-2-yl)nonane'], ['CCCCC(C(C)C)C(C)C', '2-methyl-3-(propan-2-yl)heptane'],
    ['CCCC(CC(C)C)CCCC', '2-methyl-4-propyloctane'], ['CCCCCC(CC(C)C)CCCCC', '6-(2-methylpropyl)undecane'],
    // alkenes and alkynes
    ['C=C', 'ethene'], ['CC=C', 'prop-1-ene'], ['C=CCC', 'but-1-ene'], ['CC=CC', 'but-2-ene'],
    ['CC(C)=C', '2-methylprop-1-ene'], ['CC(C)=CC', '2-methylbut-2-ene'], ['C=CC=C', 'buta-1,3-diene'],
    ['C#C', 'ethyne'], ['CC#C', 'prop-1-yne'], ['CC#CC', 'but-2-yne'], ['C=CCC#C', 'pent-1-en-4-yne'],
    ['CC=CC#C', 'pent-3-en-1-yne'], ['CC(=C)CC', '2-methylbut-1-ene'], ['C=C(CC)CCC', '3-methylidenehexane'], ['CCC(=C)CCC', '3-methylidenehexane'],
    ['C=CC(CCC)CCCC', '4-ethenyloctane'], ['C#CC(CCC)CCCC', '4-ethynyloctane'], ['CC(C)=C(CCC)CCC', '4-(propan-2-ylidene)heptane'],
    ['C=CC=CC=C', 'hexa-1,3,5-triene'],
    // haloalkanes
    ['CCl', 'chloromethane'], ['ClC(Cl)Cl', 'trichloromethane'], ['ClC(Cl)(Cl)Cl', 'tetrachloromethane'],
    ['CCBr', 'bromoethane'], ['BrCCBr', '1,2-dibromoethane'], ['CC(Br)Br', '1,1-dibromoethane'],
    ['CC(C)(Cl)C', '2-chloro-2-methylpropane'], ['CC(Cl)CC(C)C', '2-chloro-4-methylpentane'],
    ['ClC=C', 'chloroethene'], ['FC(F)(F)C(Cl)Br', '2-bromo-2-chloro-1,1,1-trifluoroethane'],
    ['CCCI', '1-iodopropane'],
    // alcohols
    ['CO', 'methanol'], ['CCO', 'ethanol'], ['CCCO', 'propan-1-ol'], ['CC(O)C', 'propan-2-ol'],
    ['CC(C)(O)C', '2-methylpropan-2-ol'], ['OCCO', 'ethane-1,2-diol'], ['OCC(O)CO', 'propane-1,2,3-triol'],
    ['CC(O)CC(C)C', '4-methylpentan-2-ol'], ['C=CCO', 'prop-2-en-1-ol'], ['CC=CC(C)O', 'pent-3-en-2-ol'],
    ['CC(CO)CC', '2-methylbutan-1-ol'], ['ClCCO', '2-chloroethan-1-ol'],
    // aldehydes and ketones
    ['C=O', 'methanal'], ['CC=O', 'ethanal'], ['CCC=O', 'propanal'], ['CC(C)C=O', '2-methylpropanal'],
    ['O=CCC=O', 'propanedial'], ['CC(=O)C', 'propan-2-one'], ['CCC(=O)C', 'butan-2-one'],
    ['CCC(=O)CC', 'pentan-3-one'], ['CCCC(=O)C', 'pentan-2-one'], ['CC(=O)CC(C)=O', 'pentane-2,4-dione'],
    ['CC(=O)CC=O', '3-oxobutanal'], ['C=CC(=O)C', 'but-3-en-2-one'],
    // carboxylic acids
    ['OC=O', 'methanoic acid'], ['CC(=O)O', 'ethanoic acid'], ['CCCC(=O)O', 'butanoic acid'],
    ['CC(C)CC(=O)O', '3-methylbutanoic acid'], ['CC(O)C(=O)O', '2-hydroxypropanoic acid'],
    ['OC(=O)CC(=O)O', 'propanedioic acid'], ['OC(=O)C(=O)O', 'ethanedioic acid'],
    ['C=CC(=O)O', 'prop-2-enoic acid'], ['CC(=O)CC(=O)O', '3-oxobutanoic acid'],
    ['ClCC(=O)O', 'chloroethanoic acid'], ['OCC(Cl)C(=O)O', '2-chloro-3-hydroxypropanoic acid'],
    // esters
    ['O=COC', 'methyl methanoate'], ['CC(=O)OC', 'methyl ethanoate'], ['CCC(=O)OCC', 'ethyl propanoate'],
    ['CCCC(=O)OCCC', 'propyl butanoate'], ['CC(=O)OC(C)C', 'propan-2-yl ethanoate'], ['CC(=O)OC(C)(C)C', '2-methylpropan-2-yl ethanoate'], ['CC(=O)OC=C', 'ethenyl ethanoate'],
    ['CC(=O)OCCC(C)C', '3-methylbutyl ethanoate'],
    // amines
    ['CN', 'methanamine'], ['CCN', 'ethanamine'], ['CCCN', 'propan-1-amine'], ['CC(N)C', 'propan-2-amine'],
    ['NCCN', 'ethane-1,2-diamine'], ['CNC', 'N-methylmethanamine'], ['CCNC', 'N-methylethanamine'],
    ['CN(C)C', 'N,N-dimethylmethanamine'], ['CCN(C)CC', 'N-ethyl-N-methylethanamine'],
    ['CC(N)C(=O)O', '2-aminopropanoic acid'], ['NCC(=O)O', 'aminoethanoic acid'], ['NCCO', '2-aminoethan-1-ol'],
    // amides
    ['NC=O', 'methanamide'], ['CC(=O)N', 'ethanamide'], ['CCC(=O)N', 'propanamide'],
    ['CC(=O)NC', 'N-methylethanamide'], ['CN(C)C=O', 'N,N-dimethylmethanamide'],
  ];

  const VERDICTS = [
    ['', 'empty'], ['O', 'not-organic'], ['N', 'not-organic'], ['ClCl', 'not-organic'],
    ['CC.CC', 'not-one-compound'], ['CCO.O', 'not-one-compound'], ['C(C)(C)(C)(C)C', 'invalid'],
    ['C1CCCCC1', 'out-of-scope'], ['C1CC1C', 'out-of-scope'], ['COC', 'out-of-scope'],
    ['CC#N', 'out-of-scope'], ['CC(=O)Cl', 'out-of-scope'], ['O=C=O', 'out-of-scope'],
    ['CC(=O)OC(C)=O', 'out-of-scope'], ['CCOO', 'out-of-scope'], ['OC(=O)CC(=O)OC', 'out-of-scope'],
    ['CCC(CCl)CCC', 'out-of-scope'], ['C=CC(C=C)CC', 'named'], ['CCNN', 'out-of-scope'],
    ['CC=NC', 'out-of-scope'], ['OC(=O)CC(N)=O', 'out-of-scope'], ['CNCCO', 'out-of-scope'],
  ];

  // Which stereo notes each name should carry.
  const STEREO = [
    ['CC=CC', ['ez']], ['C=CC', []], ['CC(C)=CC', []], ['CC(O)CC', ['chiral']], ['CC(O)C', []],
    ['CC=CC(C)O', ['ez', 'chiral']], ['CC(N)C(=O)O', ['chiral']], ['ClC=CCl', ['ez']], ['CC(Cl)(Br)F', ['chiral']],
    ['CC(Cl)CC', ['chiral']],
  ];

  const NOTATION = [
    ['CCO', 'molecular', 'C2H6O'], ['CCCCCC', 'empirical', 'C3H7'], ['C=CCCCC', 'empirical', 'CH2'],
    ['ClC(Cl)Cl', 'molecular', 'CHCl3'], ['CC(O)C', 'condensed', 'CH3CH(OH)CH3'],
    ['CC(=O)O', 'condensed', 'CH3COOH'], ['CC=O', 'condensed', 'CH3CHO'],
    ['CC(=O)OC', 'condensed', 'CH3COOCH3'], ['CC(C)C', 'condensed', 'CH3CH(CH3)CH3'],
    ['CC(=O)C', 'condensed', 'CH3COCH3'], ['OC=O', 'condensed', 'HCOOH'], ['CC(=O)N', 'condensed', 'CH3CONH2'],
    ['C=CC', 'condensed', 'CH3CH=CH2'], ['CCN', 'condensed', 'CH3CH2NH2'],
  ];

  const out = [];
  let pass = 0, fail = 0;
  const check = (ok, label, detail) => {
    if (ok) pass++; else { fail++; out.push('FAIL  ' + label + (detail ? '   ' + detail : '')); }
  };
  const run = (smi, fn) => {
    try { return fn(OB.parseSmiles(smi)); } catch (e) { return { crash: e.message }; }
  };

  NAMES.forEach(([smi, want]) => {
    const r = run(smi, m => OB.nameMolecule(m));
    check(r.status === 'named' && r.name === want, smi + ' -> ' + want,
      'got ' + (r.crash ? 'CRASH ' + r.crash : r.status === 'named' ? r.name : r.status + ': ' + (r.reason || '')));
    if (r.status === 'named') check(r.steps && r.steps.length === 6, smi + ' has 6 steps', 'got ' + (r.steps || []).length);
  });
  VERDICTS.forEach(([smi, want]) => {
    const r = run(smi, m => OB.nameMolecule(m));
    check(r.status === want, '"' + smi + '" -> ' + want,
      'got ' + (r.crash ? 'CRASH ' + r.crash : r.status + (r.name ? ' (' + r.name + ')' : '') + (r.reason ? ': ' + r.reason : '')));
    if (want === 'out-of-scope' && r.status === want) check(r.reason && r.reason.length > 10, smi + ' gives a reason');
  });
  STEREO.forEach(([smi, want]) => {
    const r = run(smi, m => OB.nameMolecule(m));
    const got = r.status === 'named' ? r.notes.map(n => n.kind).sort() : ['(' + r.status + ')'];
    check(JSON.stringify(got) === JSON.stringify(want.slice().sort()), smi + ' stereo notes ' + JSON.stringify(want),
      'got ' + JSON.stringify(got));
  });
  NOTATION.forEach(([smi, kind, want]) => {
    const got = run(smi, m => {
      const g = OB.toGraph(m);
      return kind === 'condensed' ? OB.condensed(g) : OB.formulae(g)[kind];
    });
    check(got === want, smi + ' ' + kind + ' ' + want, 'got ' + (got && got.crash ? 'CRASH ' + got.crash : got));
  });
  // SMILES round trip: writing then reading back gives the same formula and name.
  NAMES.forEach(([smi, want]) => {
    const r = run(smi, m => {
      const s = OB.smiles(OB.toGraph(m));
      const back = OB.parseSmiles(s);
      return { s, f1: OB.formulae(OB.toGraph(m)).molecular, f2: OB.formulae(OB.toGraph(back)).molecular,
        name: OB.nameMolecule(back).name };
    });
    check(!r.crash && r.f1 === r.f2 && r.name === want, smi + ' SMILES round trip',
      r.crash ? 'CRASH ' + r.crash : 'wrote ' + r.s + ', read back ' + r.f2 + ' / ' + r.name);
  });
  // 3D geometry: C-C bond in ethane near 1.52 A, and the H-C-H angle in methane near 109.5.
  {
    const ethane = OB.build3D(OB.toGraph(OB.parseSmiles('CC')));
    const [a, b] = ethane.atoms;
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    check(Math.abs(d - 1.52) < 0.06, '3D ethane C-C length ~1.52', 'got ' + d.toFixed(3));
    const me = OB.build3D(OB.toGraph(OB.parseSmiles('C')));
    const c = me.atoms[0], h1 = me.atoms[1], h2 = me.atoms[2];
    const v1 = [h1.x - c.x, h1.y - c.y, h1.z - c.z], v2 = [h2.x - c.x, h2.y - c.y, h2.z - c.z];
    const ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / Math.hypot(...v1) / Math.hypot(...v2)) * 180 / Math.PI;
    check(Math.abs(ang - 109.5) < 4, '3D methane H-C-H ~109.5', 'got ' + ang.toFixed(1));
  }
  // Practice generator: every molecule it hands out must be named in full,
  // keep its name once laid out, and fit its stage.
  ['stage1', 'stage2'].forEach(stage => {
    const names = new Set();
    const bad = [];
    let none = 0;
    const kinds = new Set();
    for (let i = 0; i < 150; i++) {
      let res;
      try { res = OB.randomMolecule(stage); } catch (e) { bad.push('CRASH ' + e.message); continue; }
      if (!res) { none++; continue; }
      names.add(res.name);
      const r = OB.nameMolecule(res.mol);
      if (r.status !== 'named' || r.name !== res.name) bad.push(res.name + ' -> ' + (r.name || r.status));
      if (stage === 'stage1' && (res.mol.atoms.some(a => a.el === 'N') ||
          ['aldehyde', 'ketone', 'amine', 'amide'].includes(r.principal))) {
        bad.push(res.name + ' uses a Stage 2 group');
      }
      const ccMultiple = res.mol.bonds.some(b => b.order > 1 && res.mol.atom(b.a).el === 'C' && res.mol.atom(b.b).el === 'C');
      if (stage === 'stage1' && ccMultiple && res.mol.atoms.some(a => a.el !== 'C')) {
        bad.push(res.name + ' has a C=C or C≡C alongside a functional group');
      }
      const ccDouble = b => b.order === 2 && res.mol.atom(b.a).el === 'C' && res.mol.atom(b.b).el === 'C';
      if (res.mol.bonds.some(b => ccDouble(b) &&
          res.mol.bondsOf(b.a).concat(res.mol.bondsOf(b.b)).some(x => x !== b && ccDouble(x)))) {
        bad.push(res.name + ' has touching C=C bonds');
      }
      if (r.principal) kinds.add(r.principal);
    }
    check(!bad.length, stage + ' practice molecules are all named', bad.slice(0, 5).join('; '));
    check(none === 0, stage + ' generator always finds a molecule', none + ' failures');
    check(names.size >= 40, stage + ' practice gives variety (40+ names in 150)', names.size + ' distinct');
    check(kinds.size >= (stage === 'stage2' ? 6 : 3), stage + ' covers its functional groups', [...kinds].join(', '));
  });

  const summary = 'Organic builder self-test: ' + pass + ' passed, ' + fail + ' failed';
  document.getElementById('out').textContent = summary + '\n' + (out.length ? '\n' + out.join('\n') : '\nAll checks passed.');
  document.title = (fail ? 'FAIL ' : 'PASS ') + document.title;
})();
