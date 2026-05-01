// Reagent library shared across the Chemistry sims.
// Extend this file (no build step) to add reagents; consumer apps read via window.REAGENTS.
//
// Molar masses are the TRUE values used by the sim internally — they must never be
// displayed to the student. Students calculate molar mass themselves from ATOMIC_MASSES.

window.REAGENTS = {
  'na2co3': {
    id: 'na2co3',
    category: 'primary-standard',
    type: 'solid',
    name: 'Sodium carbonate',
    formula: 'Na\u2082CO\u2083',
    composition: [['Na', 2], ['C', 1], ['O', 3]],
    trueMolarMass: 105.99,
    purity: 1.0,
    role: 'base',
    equivalents: 2,
    hazards: ['irritant'],
    jarLabel: {
      title: 'Sodium carbonate',
      subtitle: 'Na\u2082CO\u2083 \u00b7 anhydrous',
      grade: 'Primary standard',
    },
    appearance: { colour: '#f5f3ee' },
  },

  'khp': {
    id: 'khp',
    category: 'primary-standard',
    type: 'solid',
    name: 'Potassium hydrogen phthalate',
    formula: 'KHC\u2088H\u2084O\u2084',
    composition: [['K', 1], ['H', 5], ['C', 8], ['O', 4]],
    trueMolarMass: 204.22,
    purity: 1.0,
    role: 'acid',
    equivalents: 1,
    hazards: [],
    jarLabel: {
      title: 'Potassium hydrogen phthalate',
      subtitle: 'KHC\u2088H\u2084O\u2084 \u00b7 "KHP"',
      grade: 'Primary standard',
    },
    appearance: { colour: '#fafafa' },
  },

  'oxalic-acid-dihydrate': {
    id: 'oxalic-acid-dihydrate',
    category: 'primary-standard',
    type: 'solid',
    name: 'Oxalic acid dihydrate',
    formula: 'H\u2082C\u2082O\u2084\u00b72H\u2082O',
    composition: [['H', 6], ['C', 2], ['O', 6]],
    trueMolarMass: 126.07,
    purity: 1.0,
    role: 'acid',
    equivalents: 2,
    hazards: ['harmful-if-swallowed'],
    jarLabel: {
      title: 'Oxalic acid dihydrate',
      subtitle: 'H\u2082C\u2082O\u2084 \u00b7 2H\u2082O',
      grade: 'Primary standard',
    },
    appearance: { colour: '#ffffff' },
  },
};
