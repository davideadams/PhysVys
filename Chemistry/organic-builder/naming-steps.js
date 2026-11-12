// Organic Molecule Builder -- naming, part 4: the step-by-step explanation.
// Each step: { title, lines: [html], atoms: [graph index], labels: [[index, text]] }.
// Every line is generated here from fixed text and computed names, so it is
// safe to insert as HTML.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const EL_NAME = { F: 'fluorine', Cl: 'chlorine', Br: 'bromine', I: 'iodine' };
  const b = s => '<b>' + s + '</b>';

  // The pieces of the name, so the page can fill it in step by step:
  // step 1 gives the ending, step 2 the stem, step 4 the prefixes (and an
  // ester's alkyl word), step 5 the whole parent name.
  OB.nameParts = function (principal, c, r) {
    const { STEM, MULT, SUFFIX } = OB.STEP_HELPERS;
    const ending = principal
      ? (r.suf.count > 1 ? MULT[r.suf.count] : '') + SUFFIX[principal]
      : c.tri.length ? 'yne' : c.dbl.length ? 'ene' : 'ane';
    return { alkyl: r.alkylWord, prefix: r.prefixText, stem: STEM[c.path.length], ending, parent: r.parent, name: r.name };
  };

  OB.describeSteps = function (ctx, choice, c, r, differing) {
    const { g, groups, principal } = ctx;
    const { STEM, MULT, SUFFIX, TERMINAL } = OB.STEP_HELPERS;
    const info = principal ? OB.GROUP_INFO[principal] : null;
    const chainLabels = c.path.map((a, i) => [a, String(i + 1)]);
    const len = c.path.length;
    const steps = [];

    // 1. functional groups
    {
      const lines = [];
      const counts = new Map();
      groups.forEach(x => {
        const k = x.type === 'halo' ? 'halo:' + x.el : x.type;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
      if (!groups.length) {
        lines.push('There are no functional groups and no halogens: this is a hydrocarbon.');
        lines.push(g.bonds.some(x => x.order > 1)
          ? 'It has a C=C or C≡C bond, so the ending will be -ene or -yne.'
          : 'All its bonds are single, so it is an alkane and the ending will be ' + b('-ane') + '.');
      } else {
        const found = [...counts].map(([k, n]) => {
          if (k.startsWith('halo:')) return b(EL_NAME[k.slice(5)]) + (n > 1 ? ' × ' + n : '');
          return b(OB.GROUP_INFO[k].label) + ' (' + OB.GROUP_INFO[k].formula + ')' + (n > 1 ? ' × ' + n : '');
        });
        lines.push('Found: ' + found.join(', ') + '.');
        const types = new Set(groups.map(x => x.type).filter(t => t !== 'halo'));
        if (principal) {
          lines.push('The highest-priority group is the ' + b(info.label) + ', so it sets the ending: ' +
            b('-' + SUFFIX[principal]) + '.');
          if (types.size > 1) {
            lines.push('Priority order: carboxylic acid &gt; ester &gt; amide &gt; aldehyde &gt; ketone &gt; alcohol &gt; amine.');
          }
          const others = [...new Set(groups.filter(x => x.type !== principal)
            .map(x => x.type === 'halo' ? OB.HALOGENS[x.el] : OB.GROUP_INFO[x.type].prefix))];
          if (others.length) lines.push('Everything else becomes a prefix: ' + others.map(p => b(p + '-')).join(', ') + '.');
        } else {
          lines.push('Halogens never set the ending; they are always prefixes. The ending comes from the ' +
            'carbon chain: -ane, -ene or -yne.');
        }
        if (principal === 'ester') {
          lines.push('An ester\'s name is two words: first the alkyl group on the single-bonded oxygen, ' +
            'then the acid part, ending in ' + b('-oate') + '.');
        }
      }
      const atoms = [...new Set(groups.flatMap(x => x.atoms.concat(x.carbon !== undefined ? [x.carbon] : [])))];
      steps.push({ title: 'Find the functional groups', lines, atoms, labels: [] });
    }

    // 2. parent chain
    {
      const lines = choice.log.filter(x => x.phase === 'chain').map(x => x.text);
      if (principal === 'ester') {
        lines.push('For an ester the parent chain is the acid part, which includes the C=O carbon. ' +
          'The group on the other oxygen is named separately.');
      }
      if (c.prefixes.some(p => p.locant === 'N')) {
        lines.push('Groups on the nitrogen are not part of the chain; they become N- prefixes.');
      }
      const ccMultiple = g.bonds.filter(x => x.order > 1 && g.el[x.a] === 'C' && g.el[x.b] === 'C').length;
      if (ccMultiple > c.multLocs.length) {
        lines.push('Note: not every C=C or C≡C is in this chain. The 2013 rules choose the longest ' +
          'chain first, so a multiple bond can end up in a side chain. (Older rules, still in some ' +
          'textbooks, made the chain include every multiple bond, which gives a different name.)');
      }
      steps.push({ title: 'Choose the parent chain', lines, atoms: c.path.slice(), labels: [] });
    }

    // 3. numbering
    {
      const lines = [];
      if (len === 1) {
        lines.push('A one-carbon chain needs no numbering.');
      } else {
        if (TERMINAL[principal]) lines.push('The carbon of the ' + TERMINAL[principal] + ' group is always C1.');
        const numLines = choice.log.filter(x => x.phase === 'number').map(x => x.text);
        lines.push(...numLines);
        const ends = x => { const p = x.path[0], q = x.path[x.path.length - 1]; return Math.min(p, q) + '-' + Math.max(p, q); };
        const tiedChains = new Set(choice.remaining.map(ends)).size;
        if (choice.remaining.length > 1 && !differing) {
          if (tiedChains > 1) {
            lines.push('Other chains of the same length give exactly the same name, so it does not ' +
              'matter which one is used.');
          } else {
            lines.push(numLines.length
              ? 'What is left gives the same name whichever way it is numbered.'
              : 'Numbering from either end gives the same locants, so either end can be C1.');
          }
        }
        if (differing) {
          lines.push('Every rule this page applies still leaves a tie, and the choices give different ' +
            'names. The page picks the one that comes first alphabetically; full IUPAC rules have ' +
            'further tie-breakers that it does not apply, so treat this name with care.');
        }
      }
      steps.push({ title: 'Number the chain', lines, atoms: c.path.slice(), labels: chainLabels });
    }

    // 4. substituents
    {
      const lines = [];
      const parts = r.groupsOut;
      if (!parts.length) {
        lines.push('Nothing else is attached to the parent chain' +
          (principal ? ' apart from the ' + info.label + ' group' : '') + ', so there are no prefixes.');
      } else {
        parts.forEach(p => {
          const where = p.locs.map(l => l === 'N' ? 'the nitrogen' : 'C' + l);
          lines.push(p.name + ' on ' + where.join(' and ') + ' → ' + b(p.text));
        });
        if (parts.some(p => p.mult)) {
          lines.push('Identical groups are counted with di-, tri-, tetra-' +
            (parts.some(p => p.complex && p.mult) ? ' (bis-, tris- for bracketed groups)' : '') + '.');
        }
        if (parts.length > 1) {
          lines.push('Prefixes go in alphabetical order, ignoring di-, tri- and so on' +
            (parts.some(p => p.complex) ? ' (a bracketed group is alphabetised by its full name)' : '') +
            ': ' + b(r.prefixText) + '.');
        }
        if (parts.some(p => p.complex || /ylidene$/.test(p.name))) {
          lines.push('A side chain is named as a chain of its own: the longest chain through the carbon ' +
            'joined to the main chain, numbered so that carbon gets the lowest number it can. ' +
            '-yl means it is joined by a single bond, -ylidene by a double bond.' +
            (parts.some(p => p.complex) ? ' A side-chain name with its own locants goes in brackets.' : ''));
        }
        if (parts.some(p => p.locs.includes('N'))) {
          lines.push('N- shows the group is on the nitrogen rather than on a carbon of the chain.');
        }
      }
      if (r.alkylWord) {
        lines.push('The alkyl group on the ester oxygen is ' + b(r.alkylWord) + '. It becomes the first word of the name.');
      }
      const atoms = parts.flatMap(p => p.atoms).concat(r.esterAtoms);
      steps.push({ title: 'Name the substituents', lines, atoms, labels: chainLabels });
    }

    // 5. parent name
    {
      const lines = [];
      lines.push('The chain has ' + len + ' carbon' + (len > 1 ? 's' : '') + ': stem ' + b(STEM[len] + '-') + '.');
      if (!c.dbl.length && !c.tri.length) {
        lines.push('All the C–C bonds in the chain are single: ' + b('-ane') + '.');
      }
      [[c.dbl, 'C=C', 'en'], [c.tri, 'C≡C', 'yn']].forEach(([locs, sym, base]) => {
        if (!locs.length) return;
        const mult = locs.length > 1 ? MULT[locs.length] : '';
        lines.push(sym + ' starting at ' + locs.map(l => 'C' + l).join(' and ') + ': ' +
          b('-' + (r.showUnsat ? locs.join(',') + '-' : '') + mult + base + 'e') +
          ' (each locant is the lower-numbered carbon of the bond).');
      });
      if (c.dbl.length > 1 || (!c.dbl.length && c.tri.length > 1)) {
        lines.push('An a is added to the stem before di- or tri-: ' + b(STEM[len] + 'a-') + '.');
      }
      if (principal) {
        const sufText = (r.suf.count > 1 ? MULT[r.suf.count] : '') + SUFFIX[principal];
        if (TERMINAL[principal]) {
          lines.push('The ' + info.label + ' gives the ending ' + b('-' + sufText) +
            '. It needs no locant, because its carbon is always C1' + (r.suf.count > 1 ? ' and the last carbon' : '') + '.');
        } else {
          lines.push('The ' + info.label + ' gives the ending ' + b('-' + sufText) + ' on ' +
            c.pLocs.map(l => 'C' + l).join(' and ') + '.');
        }
        lines.push(/^[aeiou]/.test(sufText)
          ? 'The final e of -ane, -ene or -yne is dropped before an ending that starts with a vowel.'
          : 'The final e of -ane, -ene or -yne is kept, because the ending starts with a consonant.');
      }
      if (r.omitNote) lines.push(r.omitNote);
      lines.push('Parent name: ' + b(r.parent) + '.');
      const atoms = c.path.concat(c.anchored.flatMap(x => x.group.atoms));
      steps.push({ title: 'Name the parent chain', lines, atoms, labels: chainLabels });
    }

    // 6. assemble
    {
      const lines = [];
      const acidPart = r.prefixText + r.parent;
      if (r.alkylWord) {
        lines.push('Alkyl group, a space, then the acid part: ' + b(r.alkylWord) + ' + ' + b(acidPart) + '.');
      } else if (r.prefixText) {
        lines.push('Prefixes, then the parent name, written as one word: ' + b(r.prefixText) + ' + ' + b(r.parent) + '.');
      } else {
        lines.push('There are no prefixes, so the name is just the parent name.');
      }
      lines.push('Name: ' + b(r.name));
      const atoms = [];
      for (let i = 0; i < g.n; i++) atoms.push(i);
      steps.push({ title: 'Put the name together', lines, atoms, labels: chainLabels });
    }
    return steps;
  };
})();
