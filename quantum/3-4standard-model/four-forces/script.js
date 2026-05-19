'use strict';

// ── Canvas ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('forces-canvas');
const ctx = canvas.getContext('2d');
const W = 960, H = 600;

// ── DOM ───────────────────────────────────────────────────────────────────
const segModeEl    = document.getElementById('seg-mode');
const subToggleEl  = document.getElementById('sub-toggle-area');
const btnPlay      = document.getElementById('btn-play');
const btnStep      = document.getElementById('btn-step');
const gravityNote  = document.getElementById('gravity-note');
const sceneNoteEl  = document.getElementById('scene-note');
const rdBoson      = document.getElementById('rd-boson');
const rdMass       = document.getElementById('rd-mass');
const rdRange      = document.getElementById('rd-range');
const rdCoupling   = document.getElementById('rd-coupling');
const rdCouples    = document.getElementById('rd-couples');
const rdFelt       = document.getElementById('rd-felt');

// ── Force property data ───────────────────────────────────────────────────
const FORCES = {
  em: {
    boson: 'γ (photon)',
    mass:  '0',
    range: 'Infinite',
    coupling: '~10⁻²',
    couples: 'Electric charge',
    felt:    'All charged particles',
    notInSM: false,
  },
  weak: {
    boson: 'W⁺, W⁻, Z⁰',
    mass:  '~80–91 GeV/c²',
    range: '~10⁻¹⁸ m',
    coupling: '~10⁻⁶',
    couples: 'Weak isospin / flavour',
    felt:    'All fermions',
    notInSM: false,
  },
  strong: {
    boson: 'gluon (g)',
    mass:  '0',
    range: '~1 fm (confined)',
    coupling: '~1',
    couples: 'Colour charge',
    felt:    'Quarks and gluons',
    notInSM: false,
  },
  gravity: {
    boson: 'graviton (predicted)',
    mass:  '0',
    range: 'Infinite',
    coupling: '~10⁻³⁹',
    couples: 'Energy-momentum',
    felt:    'Everything with energy',
    notInSM: true,
  },
};

// ── Sub-mode options per force ────────────────────────────────────────────
const SUB_MODES = {
  em:      [{ label: 'Repulsion (e⁻ + e⁻)' }, { label: 'Attraction (e⁻ + e⁺)' }],
  weak:    [{ label: 'Charged current (β⁻)' }, { label: 'Neutral current (Z⁰)' }],
  strong:  [],
  gravity: [],
};

// ── Colours ───────────────────────────────────────────────────────────────
const CLR = {
  electron:   '#38bdf8',
  positron:   '#f472b6',
  quarkU:     '#fbbf24',
  quarkD:     '#60a5fa',
  neutrino:   '#a5f3fc',
  photon:     '#fde68a',
  bosonW:     '#c084fc',
  bosonZ:     '#818cf8',
  gluon:      '#4ade80',
  graviton:   '#94a3b8',
  mass:       '#e2e8f0',
  colourR:    '#ef4444',
  colourG:    '#22c55e',
  ghost:      'rgba(255,255,255,0.15)',
  axis:       'rgba(255,255,255,0.25)',
};

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  mode: 'em',
  subMode: 0,
  t: 0,
  playing: false,
  lastTs: null,
  inspectVertex: null,  // id of inspected vertex, or null
};

// ── Diagram config factory ────────────────────────────────────────────────
// Each config defines segments, bosons, vertices, sceneNote.
//
// Segment: { from, to, color, label, labelAngle, tRange:[start,end], anti }
//   from/to: [x, y]. tRange: phase window this segment animates over.
//   anti: true = arrowhead points opposite to travel direction (antiparticle).
//
// Boson: { from, to, kind, color, label, tRange:[start,end] }
//   kind: 'photon' | 'W' | 'Z' | 'gluon' | 'graviton'
//
// Vertex: { x, y, id, info, tActive }
//   info: string shown when user inspects.
//   tActive: t at which this vertex is "hit".
//
// Keyframes: t values that Step button cycles through.

function getConfig() {
  const m = state.mode;
  const s = state.subMode;

  if (m === 'em') return em(s);
  if (m === 'weak') return weak(s);
  if (m === 'strong') return strong();
  return gravity();
}

// Vertex helpers
const V = (...args) => args;  // [x, y]

// ── EM ────────────────────────────────────────────────────────────────────

function em(sub) {
  const V1 = [380, 210];
  const V2 = [380, 390];
  const attract = sub === 1;

  // Outgoing directions: repulsion = away from centre, attraction = toward
  const topOutY    = attract ? 260 : 160;
  const bottomOutY = attract ? 340 : 440;
  const bottomColor = attract ? CLR.positron : CLR.electron;
  const bottomLabel = attract ? 'e⁺' : 'e⁻';
  const bottomAnti  = attract;  // e⁺ arrow points backward

  return {
    segments: [
      { from: [60, 210],    to: V1,            color: CLR.electron, label: 'e⁻', tRange: [0, 0.35] },
      { from: [60, 390],    to: V2,            color: bottomColor,  label: bottomLabel, anti: bottomAnti, tRange: [0, 0.35] },
      { from: V1,           to: [900, topOutY],  color: CLR.electron, label: 'e⁻', tRange: [0.65, 1.0] },
      { from: V2,           to: [900, bottomOutY], color: bottomColor, label: bottomLabel, anti: bottomAnti, tRange: [0.65, 1.0] },
    ],
    bosons: [
      { from: V1, to: V2, kind: 'photon', color: CLR.photon, label: 'γ (virtual)', tRange: [0.35, 0.65] },
    ],
    vertices: [
      {
        x: V1[0], y: V1[1], id: 'v1', tActive: 0.35,
        info: attract
          ? 'e⁻ emits a virtual photon — this costs it momentum, pulling it toward e⁺.\nCharge: −1 in = −1 out ✓\nLepton number: 1 = 1 ✓'
          : 'e⁻ emits a virtual photon — this costs it momentum, pushing it away from the other e⁻.\nCharge: −1 in = −1 out ✓\nLepton number: 1 = 1 ✓',
      },
      {
        x: V2[0], y: V2[1], id: 'v2', tActive: 0.65,
        info: attract
          ? 'e⁺ absorbs the photon, gaining momentum toward e⁻.\nCharge: +1 in = +1 out ✓'
          : 'e⁻ absorbs the photon, gaining momentum away from the other e⁻.\nCharge: −1 in = −1 out ✓\nLepton number: 1 = 1 ✓',
      },
    ],
    sceneNote: null,
    keyframes: [0, 0.35, 0.65, 1.0],
  };
}

// ── Weak ──────────────────────────────────────────────────────────────────

function weak(sub) {
  if (sub === 0) return weakCharged();
  return weakNeutral();
}

function weakCharged() {
  // d → u + W⁻; W⁻ → e⁻ + ν̄ₑ
  const V1 = [340, 295];
  const V2 = [590, 430];

  return {
    segments: [
      // incoming d
      { from: [60, 295], to: V1, color: CLR.quarkD, label: 'd', tRange: [0, 0.30] },
      // u continues from V1
      { from: V1, to: [900, 220], color: CLR.quarkU, label: 'u', tRange: [0.30, 1.0] },
      // e⁻ from V2
      { from: V2, to: [900, 380], color: CLR.electron, label: 'e⁻', tRange: [0.60, 1.0] },
      // ν̄ₑ from V2 (antiparticle arrow)
      { from: V2, to: [900, 490], color: CLR.neutrino, label: 'ν̄ₑ', anti: true, tRange: [0.60, 1.0] },
    ],
    bosons: [
      { from: V1, to: V2, kind: 'W', color: CLR.bosonW, label: 'W⁻ (virtual)', tRange: [0.30, 0.60] },
    ],
    vertices: [
      {
        x: V1[0], y: V1[1], id: 'v1', tActive: 0.30,
        info: 'A down quark emits a virtual W⁻ and becomes an up quark.\n' +
              'Charge: −⅓ in = +⅔ − 1 = −⅓ out ✓\n' +
              'Baryon number: ⅓ = ⅓ ✓\n' +
              'Flavour changes: weak interaction can change quark flavour.',
      },
      {
        x: V2[0], y: V2[1], id: 'v2', tActive: 0.60,
        info: 'The W⁻ decays to an electron and an electron antineutrino.\n' +
              'Charge: −1 in = −1 + 0 = −1 out ✓\n' +
              'Lₑ: 0 in = 1 + (−1) = 0 out ✓',
      },
    ],
    sceneNote: 'This is neutron beta-minus decay at quark level.',
    keyframes: [0, 0.30, 0.60, 1.0],
  };
}

function weakNeutral() {
  // νₑ + e⁻ → νₑ + e⁻ via Z⁰ (elastic scatter)
  const V1 = [380, 190];
  const V2 = [380, 410];

  return {
    segments: [
      { from: [60, 190],  to: V1,          color: CLR.neutrino,  label: 'νₑ',  tRange: [0, 0.35] },
      { from: [60, 410],  to: V2,          color: CLR.electron,  label: 'e⁻',  tRange: [0, 0.35] },
      { from: V1, to: [900, 160], color: CLR.neutrino,  label: 'νₑ',  tRange: [0.65, 1.0] },
      { from: V2, to: [900, 440], color: CLR.electron,  label: 'e⁻',  tRange: [0.65, 1.0] },
    ],
    bosons: [
      { from: V1, to: V2, kind: 'Z', color: CLR.bosonZ, label: 'Z⁰ (virtual)', tRange: [0.35, 0.65] },
    ],
    vertices: [
      {
        x: V1[0], y: V1[1], id: 'v1', tActive: 0.35,
        info: 'Neutrino emits a virtual Z⁰.\n' +
              'Charge: 0 = 0 ✓ (Z⁰ carries no electric charge)\n' +
              'Lepton number: 1 = 1 ✓\n' +
              'Flavour is preserved — the neutrino stays a neutrino.',
      },
      {
        x: V2[0], y: V2[1], id: 'v2', tActive: 0.65,
        info: 'Electron absorbs the Z⁰, gaining momentum (scatter).\n' +
              'Charge: −1 = −1 ✓\n' +
              'Flavour preserved: unlike W exchange, Z⁰ does not change particle identity.',
      },
    ],
    sceneNote: 'Neutral current: Z⁰ scatters without changing particle identity.',
    keyframes: [0, 0.35, 0.65, 1.0],
  };
}

// ── Strong ────────────────────────────────────────────────────────────────

function strong() {
  const V1 = [400, 205];
  const V2 = [400, 395];

  // q1 (top) starts R, ends G. q2 (bottom) starts G, ends R.
  // Colour dot info is managed separately in draw code via colourSwap.

  // Both quarks swap colour together at the moment the gluon arrives at q₂
  // (t=0.65). Before then the pair reads R+G; after, G+R — the visible pair
  // always sums to R+G, and the swap coincides with the gluon completing
  // its journey to the bottom quark. Step keyframes below visit the pre-
  // swap and post-swap states so Step matches what Play shows.
  return {
    segments: [
      { from: [60, 205],  to: V1,          color: CLR.quarkU, label: 'q₁', tRange: [0, 0.35],   colourPre: CLR.colourR, colourPost: CLR.colourG },
      { from: [60, 395],  to: V2,          color: CLR.quarkU, label: 'q₂', tRange: [0, 0.35],   colourPre: CLR.colourG, colourPost: CLR.colourR },
      { from: V1, to: [900, 205], color: CLR.quarkU, label: 'q₁', tRange: [0.65, 1.0], colourPre: CLR.colourG, colourPost: CLR.colourG },
      { from: V2, to: [900, 395], color: CLR.quarkU, label: 'q₂', tRange: [0.65, 1.0], colourPre: CLR.colourR, colourPost: CLR.colourR },
    ],
    bosons: [
      { from: V1, to: V2, kind: 'gluon', color: CLR.gluon, label: 'g  (R G̅)', tRange: [0.35, 0.65] },
    ],
    vertices: [
      {
        x: V1[0], y: V1[1], id: 'v1', tActive: 0.35,
        info: 'q₁ emits a gluon carrying colour charge RG̅.\n' +
              'q₁ changes from Red → Green to conserve colour at the vertex.\n' +
              'Colour charge is always conserved at a strong vertex.',
      },
      {
        x: V2[0], y: V2[1], id: 'v2', tActive: 0.65,
        info: 'q₂ absorbs the gluon (RG̅).\n' +
              'q₂ changes from Green → Red (absorbing R, losing G̅).\n' +
              'Net colour of the pair is unchanged: R+G before and after.',
      },
    ],
    sceneNote: 'Gluons carry colour charge — the colour labels swap at each vertex.',
    // Extra keyframe at 0.18 lets Step show the pre-swap R/G moving phase
    // that Play passes through, so the two views agree on what colours appear.
    keyframes: [0, 0.18, 0.35, 0.65, 1.0],
  };
}

// ── Gravity ───────────────────────────────────────────────────────────────

function gravity() {
  const V1 = [400, 205];
  const V2 = [400, 395];

  return {
    segments: [
      { from: [60, 205],  to: V1,          color: CLR.mass, label: 'm₁', tRange: [0, 0.35] },
      { from: [60, 395],  to: V2,          color: CLR.mass, label: 'm₂', tRange: [0, 0.35] },
      { from: V1, to: [900, 240], color: CLR.mass, label: 'm₁', tRange: [0.65, 1.0] },
      { from: V2, to: [900, 360], color: CLR.mass, label: 'm₂', tRange: [0.65, 1.0] },
    ],
    bosons: [
      { from: V1, to: V2, kind: 'graviton', color: CLR.graviton, label: 'G (predicted)', tRange: [0.35, 0.65] },
    ],
    vertices: [
      {
        x: V1[0], y: V1[1], id: 'v1', tActive: 0.35,
        info: 'Mass m₁ emits a virtual graviton.\n' +
              'Energy-momentum is conserved at the vertex.\n' +
              'Note: gravitons have not been observed. Gravity is not yet incorporated into the Standard Model.',
      },
      {
        x: V2[0], y: V2[1], id: 'v2', tActive: 0.65,
        info: 'Mass m₂ absorbs the graviton, gaining momentum toward m₁.\n' +
              'Gravity is always attractive for ordinary matter.\n' +
              'The graviton is predicted to be spin-2.',
      },
    ],
    sceneNote: null,
    keyframes: [0, 0.35, 0.65, 1.0],
  };
}

// ── Drawing helpers ───────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

// Point along a straight segment at fraction f
function segPoint(from, to, f) {
  return [lerp(from[0], to[0], f), lerp(from[1], to[1], f)];
}

function segAngle(from, to) {
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

function drawArrowHead(x, y, angle, color, size, reversed) {
  const a = reversed ? angle + Math.PI : angle;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.42);
  ctx.lineTo(-size,  size * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Ghost of full segment (dim dashed)
function drawSegmentGhost(from, to, color) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Animated fermion segment: draw up to `progress` (0..1)
function drawFermionSegment(seg, progress) {
  if (progress <= 0) return;
  const p = Math.min(progress, 1);
  const end = segPoint(seg.from, seg.to, p);
  const angle = segAngle(seg.from, seg.to);

  ctx.save();
  ctx.strokeStyle = seg.color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = seg.color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(...seg.from);
  ctx.lineTo(...end);
  ctx.stroke();

  // Arrowhead at leading end; antiparticles point backward
  drawArrowHead(end[0], end[1], angle, seg.color, 9, seg.anti || false);
  ctx.restore();
}

function drawColourDot(x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.restore();
}

// Wavy boson line (photon, graviton)
function drawWavy(from, to, progress, color, nCycles, thickness, doubleOffset) {
  if (progress <= 0) return;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const L = len * Math.min(progress, 1);
  const steps = Math.max(4, Math.floor(L * 0.5));
  const amp = 11;

  ctx.save();
  ctx.translate(from[0], from[1]);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness || 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;

  const offsets = doubleOffset ? [-5, 5] : [0];
  for (const off of offsets) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const lx = (i / steps) * L;
      const ly = Math.sin((i / steps) * Math.PI * 2 * nCycles) * amp + off;
      i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Zigzag boson line (W, Z)
function drawZigzag(from, to, progress, color) {
  if (progress <= 0) return;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const L = len * Math.min(progress, 1);
  const nZigs = 10;
  const amp = 12;

  ctx.save();
  ctx.translate(from[0], from[1]);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= nZigs * 2; i++) {
    const lx = (i / (nZigs * 2)) * L;
    if (lx > L) { ctx.lineTo(L, 0); break; }
    const ly = (i % 2 === 1) ? amp : -amp;
    ctx.lineTo(lx, ly);
    if (i === nZigs * 2) ctx.lineTo(L, 0);
  }
  ctx.stroke();
  ctx.restore();
}

// Curly gluon line (looping circles along the path)
function drawGluon(from, to, progress, color) {
  if (progress <= 0) return;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const L = len * Math.min(progress, 1);
  const loopR = 13;
  const spacing = loopR * 2.2;

  ctx.save();
  ctx.translate(from[0], from[1]);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;

  let x = 0;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  while (x + spacing <= L) {
    const cx = x + loopR;
    // Draw a loop: arc from far side, going up and around
    ctx.arc(cx, 0, loopR, Math.PI, -Math.PI, false);
    x += spacing;
  }
  if (x < L) ctx.lineTo(L, 0);
  ctx.stroke();
  ctx.restore();
}

function drawBoson(boson, progress) {
  const { from, to, kind, color } = boson;
  if (kind === 'photon')   drawWavy(from, to, progress, color, 5, 2.5, false);
  else if (kind === 'W' || kind === 'Z') drawZigzag(from, to, progress, color);
  else if (kind === 'gluon') drawGluon(from, to, progress, color);
  else if (kind === 'graviton') drawWavy(from, to, progress, color, 4.5, 2, true);
}

function drawBosonLabel(boson, progress) {
  if (progress < 0.5) return;
  const mid = segPoint(boson.from, boson.to, 0.5);
  const dx = boson.to[0] - boson.from[0];
  const dy = boson.to[1] - boson.from[1];
  const len = Math.hypot(dx, dy) || 1;
  // Offset perpendicular to the boson line so the label sits beside the wavy/
  // zigzag drawing rather than across it. For a vertical boson (dx=0, dy>0)
  // this reduces to a horizontal offset to the left, matching the original
  // placement; for a diagonal boson (e.g. W⁻ in weak-charged mode) the label
  // moves perpendicular to the slope so it clears the line.
  const offDist = 52;
  const ox = (-dy / len) * offDist;
  const oy = ( dx / len) * offDist;
  ctx.save();
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
  ctx.fillStyle = boson.color;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 6;
  ctx.textAlign = 'center';
  ctx.fillText(boson.label, mid[0] + ox, mid[1] + oy + 5);
  ctx.restore();
}

function drawVertex(vx, vy, glow, inspected) {
  ctx.save();
  if (glow || inspected) {
    ctx.shadowColor = inspected ? '#fbbf24' : '#ffffff';
    ctx.shadowBlur = inspected ? 22 : 18;
  }
  ctx.beginPath();
  ctx.arc(vx, vy, inspected ? 9 : 6, 0, Math.PI * 2);
  ctx.fillStyle = inspected ? '#fbbf24' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#0a1628';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawParticleLabel(x, y, label, color, side) {
  ctx.save();
  ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 7;
  ctx.textAlign = side === 'right' ? 'left' : 'right';
  // Offset the label clear of the line in BOTH axes — sideways past the
  // endpoint, AND above/below the line — so the line stroke never runs
  // through the glyph. Pick above/below by canvas half so labels stay on
  // the outside of the diagram, well clear of the central boson exchange.
  const hOff = side === 'right' ? 14 : -14;
  const vOff = y < H / 2 ? -10 : 18;
  ctx.fillText(label, x + hOff, y + vOff);
  ctx.restore();
}

// Time axis arrow at the bottom
function drawTimeAxis() {
  const y = H - 28;
  ctx.save();
  ctx.strokeStyle = CLR.axis;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(50, y);
  ctx.lineTo(W - 60, y);
  ctx.stroke();
  ctx.setLineDash([]);
  // arrowhead
  ctx.fillStyle = CLR.axis;
  ctx.beginPath();
  ctx.moveTo(W - 58, y);
  ctx.lineTo(W - 70, y - 5);
  ctx.lineTo(W - 70, y + 5);
  ctx.closePath();
  ctx.fill();
  // label
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = CLR.axis;
  ctx.textAlign = 'right';
  ctx.fillText('time →', W - 50, y - 6);
  ctx.restore();
}

// Wrap a string to lines that fit within maxWidth, using the ctx's current
// font for measurement. Splits on whitespace; respects existing words.
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

// Inspect overlay drawn on canvas — wraps long lines so they don't spill
// past the box edge.
function drawInspectOverlay(vx, vy, text) {
  const rawLines = text.split('\n');
  const pad = 12;
  const lineH = 19;
  const boxW = 320;
  const innerW = boxW - pad * 2;

  // Pre-wrap every raw line under its own font (header is bold) so the box
  // height can be computed accurately.
  const wrapped = [];
  rawLines.forEach((line, i) => {
    const isHeader = i === 0;
    ctx.save();
    ctx.font = isHeader
      ? 'bold 13px "Trebuchet MS", sans-serif'
      : '12.5px "Trebuchet MS", sans-serif';
    wrapText(ctx, line, innerW).forEach(t => wrapped.push({ text: t, isHeader }));
    ctx.restore();
  });

  const boxH = wrapped.length * lineH + pad * 2;

  // Position: prefer right of vertex, flip if off-screen
  let bx = vx + 20;
  let by = vy - boxH / 2;
  if (bx + boxW > W - 10) bx = vx - boxW - 20;
  if (by < 8) by = 8;
  if (by + boxH > H - 8) by = H - boxH - 8;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 22, 40, 0.92)';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, boxW, boxH, 10);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  wrapped.forEach((line, i) => {
    ctx.fillStyle = line.isHeader ? '#fbbf24' : '#cbd5e1';
    ctx.font = line.isHeader
      ? 'bold 13px "Trebuchet MS", sans-serif'
      : '12.5px "Trebuchet MS", sans-serif';
    ctx.fillText(line.text, bx + pad, by + pad + lineH * i + 13);
  });
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// ── Segment progress from t ───────────────────────────────────────────────
function segProgress(tRange, t) {
  const [ts, te] = tRange;
  if (t <= ts) return 0;
  if (t >= te) return 1;
  return (t - ts) / (te - ts);
}

// ── Main draw ─────────────────────────────────────────────────────────────
function drawFrame() {
  const cfg = getConfig();
  const t = state.t;

  ctx.clearRect(0, 0, W, H);

  // Ghost paths for all segments
  cfg.segments.forEach(seg => drawSegmentGhost(seg.from, seg.to, seg.color));

  // Ghost for bosons (dim line)
  cfg.bosons.forEach(b => {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(...b.from);
    ctx.lineTo(...b.to);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  });

  // Animated fermion segments
  cfg.segments.forEach(seg => {
    const p = segProgress(seg.tRange, t);
    drawFermionSegment(seg, p);

    // Colour dot for strong mode — both quarks swap together at the moment
    // the gluon reaches the bottom quark (t=0.65). Before that the pair is
    // R+G; after, G+R. (The reverse-direction gluon to the top quark isn't
    // drawn, so the swap reads as a single visible exchange event.)
    if (seg.colourPre) {
      const vtxT = 0.65;
      const colour = t < vtxT ? seg.colourPre : seg.colourPost;
      const headP = Math.min(p, 1);
      const head = segPoint(seg.from, seg.to, headP);
      if (p > 0 && p < 1.0) {
        drawColourDot(head[0] - 18, head[1] - 18, colour);
      } else if (p >= 1) {
        // dot at endpoint
        const dot = segPoint(seg.from, seg.to, 0.95);
        drawColourDot(dot[0] - 18, dot[1] - 18, colour);
      }
    }
  });

  // Particle labels at track start and end. Incoming labels sit in the left
  // margin (before the start) so they don't overlap the line going rightward;
  // outgoing labels sit to the right of the endpoint (past the arrowhead).
  cfg.segments.forEach(seg => {
    const p = segProgress(seg.tRange, t);
    if (p > 0.05) {
      const [ts] = seg.tRange;
      const isOutgoing = ts > 0.4;
      if (!isOutgoing) {
        drawParticleLabel(seg.from[0], seg.from[1], seg.label, seg.color, 'left');
      } else if (p > 0.85) {
        drawParticleLabel(seg.to[0], seg.to[1], seg.label, seg.color, 'right');
      }
    }
  });

  // Bosons
  cfg.bosons.forEach(b => {
    const p = segProgress(b.tRange, t);
    drawBoson(b, p);
    drawBosonLabel(b, p);
  });

  // Vertices
  cfg.vertices.forEach(v => {
    const anyBosonNear = cfg.bosons.some(b => {
      const p = segProgress(b.tRange, t);
      return p > 0 && p < 1;
    });
    const glow = t >= v.tActive - 0.05 && t <= v.tActive + 0.1 && anyBosonNear;
    const inspected = state.inspectVertex === v.id;
    drawVertex(v.x, v.y, glow, inspected);

    // "click me" hint label on first load (t < 0.1)
    if (t < 0.08) {
      ctx.save();
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center';
      ctx.fillText('click', v.x, v.y - 14);
      ctx.restore();
    }
  });

  // Inspect overlay
  if (state.inspectVertex) {
    const v = cfg.vertices.find(v => v.id === state.inspectVertex);
    if (v) drawInspectOverlay(v.x, v.y, v.info);
  }

  drawTimeAxis();
}

// ── Animation loop ────────────────────────────────────────────────────────
const CYCLE_DURATION = 3200;  // ms per full t=0..1 cycle

let rafId = null;
function loop(ts) {
  if (!state.playing) { rafId = null; return; }
  if (state.lastTs === null) state.lastTs = ts;
  const dt = ts - state.lastTs;
  state.lastTs = ts;

  state.t = (state.t + dt / CYCLE_DURATION) % 1.0;
  drawFrame();
  rafId = requestAnimationFrame(loop);
}

function startPlay() {
  state.playing = true;
  state.lastTs = null;
  btnPlay.textContent = '■ Pause';
  btnPlay.classList.add('playing');
  rafId = requestAnimationFrame(loop);
}

function stopPlay() {
  state.playing = false;
  state.lastTs = null;
  btnPlay.textContent = '▶ Play';
  btnPlay.classList.remove('playing');
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// ── Controls ──────────────────────────────────────────────────────────────
function updatePanel() {
  const f = FORCES[state.mode];
  rdBoson.textContent   = f.boson;
  rdMass.textContent    = f.mass;
  rdRange.textContent   = f.range;
  rdCoupling.textContent = f.coupling;
  rdCouples.textContent = f.couples;
  rdFelt.textContent    = f.felt;

  gravityNote.classList.toggle('visible', state.mode === 'gravity');

  // Scene note
  const cfg = getConfig();
  if (cfg.sceneNote) {
    sceneNoteEl.textContent = cfg.sceneNote;
    sceneNoteEl.classList.add('visible');
  } else {
    sceneNoteEl.classList.remove('visible');
  }
}

function buildSubToggle() {
  const opts = SUB_MODES[state.mode];
  subToggleEl.innerHTML = '';
  if (!opts || opts.length === 0) return;

  const label = document.createElement('label');
  label.textContent = 'Interaction';
  subToggleEl.appendChild(label);

  const seg = document.createElement('div');
  seg.className = 'seg-control cols-2';
  opts.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'seg-btn' + (i === state.subMode ? ' active' : '');
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      if (state.subMode === i) return;
      state.subMode = i;
      state.inspectVertex = null;
      seg.querySelectorAll('.seg-btn').forEach((b, j) => b.classList.toggle('active', j === i));
      stopPlay();
      state.t = 0;
      updatePanel();
      drawFrame();
    });
    seg.appendChild(btn);
  });
  subToggleEl.appendChild(seg);
}

function setMode(mode) {
  state.mode = mode;
  state.subMode = 0;
  state.inspectVertex = null;
  segModeEl.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  stopPlay();
  state.t = 0;
  buildSubToggle();
  updatePanel();
  drawFrame();
}

segModeEl.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setMode(btn.dataset.mode);
});

btnPlay.addEventListener('click', () => {
  if (state.playing) stopPlay();
  else startPlay();
});

btnStep.addEventListener('click', () => {
  stopPlay();
  const cfg = getConfig();
  const kf = cfg.keyframes;
  const next = kf.find(k => k > state.t + 0.01);
  state.t = next !== undefined ? next : 0;
  state.inspectVertex = null;
  drawFrame();
});

// ── Canvas click for vertex inspection ────────────────────────────────────
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;

  const cfg = getConfig();
  const hit = cfg.vertices.find(v => Math.hypot(v.x - mx, v.y - my) < 28);
  if (hit) {
    state.inspectVertex = state.inspectVertex === hit.id ? null : hit.id;
  } else {
    state.inspectVertex = null;
  }

  // Cursor hint
  canvas.classList.toggle('clickable',
    cfg.vertices.some(v => Math.hypot(v.x - mx, v.y - my) < 28)
  );

  drawFrame();
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;
  const cfg = getConfig();
  const near = cfg.vertices.some(v => Math.hypot(v.x - mx, v.y - my) < 28);
  canvas.classList.toggle('clickable', near);
});

// ── Init ──────────────────────────────────────────────────────────────────
const _urlMode = new URLSearchParams(location.search).get('mode');
if (_urlMode && FORCES[_urlMode]) setMode(_urlMode);
else { buildSubToggle(); updatePanel(); drawFrame(); }
