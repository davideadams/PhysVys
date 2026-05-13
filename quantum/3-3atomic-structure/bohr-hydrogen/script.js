// Bohr Model of Hydrogen — energy-level diagram + accumulating spectrum strip.
// One ground-state H atom; drag the electron up from n=1 to excite, then watch
// it cascade back down. Emission mode builds bright lines on a dark strip;
// absorption mode shows a faded continuous background with dark absorption
// lines. Line counts are shared across modes — the same transition contributes
// to both views.

const canvas = document.getElementById('bohr-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ── Layout ──────────────────────────────────────────────────────────
const DIAGRAM = { x0: 70, x1: 840, yTop: 40, yBot: 480 };  // energy-axis region
const ATOM_X = 95;                                          // x for electron (left of diagram)
const ARROWS_X0 = ATOM_X + 22;                             // x where transition arrows begin
const STRIP = { y0: 510, y1: 590, xL: 20, xR: 940 };        // spectrum strip
const STRIP_VIS = { xL: 120, xR: 840 };                     // visible band 380–780 nm
const STRIP_UV  = { xL: 20,  xR: 120 };                     // 80–380 nm log
const STRIP_IR  = { xL: 840, xR: 940 };                     // 780–20000 nm log

// ── Physics ─────────────────────────────────────────────────────────
const N_MAX = 5;
const E_RYDBERG = 13.6;                       // eV (ionisation of H from n=1)
const HC_EV_NM = 1240;                        // hc in eV·nm
const E_n = (n) => -E_RYDBERG / (n * n);      // eV
const lambdaNm = (n_hi, n_lo) =>
  HC_EV_NM / (E_n(n_hi) - E_n(n_lo));         // n_hi > n_lo, returns positive nm

// Series colours for the auto-highlight bands
const SERIES = {
  1: { name: 'Lyman',    rgb: [122, 90, 207] },
  2: { name: 'Balmer',   rgb: [88, 184, 230] },
  3: { name: 'Paschen',  rgb: [230, 130, 80] },
  4: { name: 'Brackett', rgb: [200, 90, 130] },
};

// ── State ───────────────────────────────────────────────────────────
const state = {
  mode: 'emission',           // 'emission' | 'absorption'
  electronN: 1,               // current level the electron sits on (idle)
  drag: null,                 // { startN, x, y } while dragging
  hoverN: null,               // level being hovered during drag (for snap preview)
  anim: null,                 // { phase, ... } while a cascade plays
  lineCounts: {},             // key "lo-hi" → cumulative count (drives spectrum strip)
  groupObserved: {},          // n_target → Set of keys observed in cascades from that level
  excitationTargets: [],      // n values excited to, in first-seen order
  chronoArrows: [],           // {type:'up'|'dn', excN, lo?, hi?} in observation order
  sortMode: 'chrono',         // 'chrono' | 'series'
  highlight: null,            // transition key currently highlighted, or null
  lastTransition: null,       // { n_hi, n_lo, dE, lambda }
  highlightSeries: null,      // n_lo of last transition (for series highlight)
  highlightAt: 0,             // perf.now() of last highlight refresh
  t: 0,                       // last frame time
};

// ── Helpers ─────────────────────────────────────────────────────────
function levelY(n) {
  // True-scale: yTop (small y, visually top) at E = 0; yBot (visually bottom)
  // at E = -13.6. So n=1 sits at the bottom and the levels bunch up toward
  // the ionisation line at the top.
  const e = E_n(n);
  return DIAGRAM.yTop + (-e / E_RYDBERG) * (DIAGRAM.yBot - DIAGRAM.yTop);
}

function snapToLevel(y) {
  // Return n if y is within tolerance of a level; else null.
  // For tightly-packed upper levels, snap to nearest within the gap to the
  // adjacent level. For widely-spaced lower levels, allow ±40 px.
  let best = null, bestDist = Infinity;
  for (let n = 1; n <= N_MAX; n++) {
    const d = Math.abs(y - levelY(n));
    if (d < bestDist) { bestDist = d; best = n; }
  }
  if (best === null) return null;
  // Tolerance: half the gap to nearer neighbour, capped at 40 px.
  let neighGap = Infinity;
  if (best > 1)     neighGap = Math.min(neighGap, Math.abs(levelY(best) - levelY(best - 1)));
  if (best < N_MAX) neighGap = Math.min(neighGap, Math.abs(levelY(best) - levelY(best + 1)));
  const tol = Math.min(40, neighGap / 2);
  return bestDist <= tol ? best : null;
}

function lambdaToStripX(nm) {
  if (nm >= 380 && nm <= 780) {
    return STRIP_VIS.xL + (nm - 380) / (780 - 380) * (STRIP_VIS.xR - STRIP_VIS.xL);
  }
  if (nm < 380) {
    const lo = Math.log(80), hi = Math.log(380);
    const t = (Math.log(Math.max(nm, 80)) - lo) / (hi - lo);
    return STRIP_UV.xL + t * (STRIP_UV.xR - STRIP_UV.xL);
  }
  const lo = Math.log(780), hi = Math.log(20000);
  const t = (Math.log(Math.min(nm, 20000)) - lo) / (hi - lo);
  return STRIP_IR.xL + t * (STRIP_IR.xR - STRIP_IR.xL);
}

// Visible-band wavelength → sRGB triplet (Bruton's piecewise), nm input.
function wavelengthToRGBnm(nm) {
  let R = 0, G = 0, B = 0;
  const lam = Math.max(380, Math.min(780, nm));
  if      (lam < 440) { R = -(lam - 440) / 60; G = 0; B = 1; }
  else if (lam < 490) { R = 0; G = (lam - 440) / 50; B = 1; }
  else if (lam < 510) { R = 0; G = 1; B = -(lam - 510) / 20; }
  else if (lam < 580) { R = (lam - 510) / 70; G = 1; B = 0; }
  else if (lam < 645) { R = 1; G = -(lam - 645) / 65; B = 0; }
  else                { R = 1; G = 0; B = 0; }
  let f = 1;
  if      (lam < 420) f = 0.3 + 0.7 * (lam - 380) / 40;
  else if (lam > 700) f = 0.3 + 0.7 * (780 - lam) / 80;
  return [R * f, G * f, B * f];
}

// Colour for a photon of arbitrary λ. Visible → wavelengthToRGBnm. UV → muted
// violet. IR → muted dark red. Returns 'rgb(...)' string.
function photonColour(nm) {
  if (nm >= 380 && nm <= 780) {
    const [r, g, b] = wavelengthToRGBnm(nm);
    return `rgb(${(r*255)|0}, ${(g*255)|0}, ${(b*255)|0})`;
  }
  if (nm < 380) return 'rgb(160, 110, 220)';
  return 'rgb(160, 70, 70)';
}

function transitionKey(n_lo, n_hi) { return `${n_lo}-${n_hi}`; }

function recordLine(n_hi, n_lo) {
  const k = transitionKey(n_lo, n_hi);
  state.lineCounts[k] = (state.lineCounts[k] || 0) + 1;
}

// ── Drawing ─────────────────────────────────────────────────────────
function clearBackground() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
}

function drawSeriesHighlight() {
  if (state.highlightSeries === null) return;
  const age = (performance.now() - state.highlightAt) / 1000;
  const fade = Math.max(0, 1 - age / 3);  // 3 s decay
  if (fade <= 0) { state.highlightSeries = null; return; }
  const nf = state.highlightSeries;
  const rgb = SERIES[nf]?.rgb;
  if (!rgb) return;
  // Band: from levelY(nf) up to top of diagram (since transitions all end at nf).
  const yTop = DIAGRAM.yTop - 6;
  const yBot = levelY(nf);
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.10 * fade})`;
  ctx.fillRect(DIAGRAM.x0 - 30, yTop, (DIAGRAM.x1 - DIAGRAM.x0) + 60, yBot - yTop);
  // Label, anchored top-left so staggered upper-level labels can't collide.
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.85 * fade})`;
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${SERIES[nf].name} series  (n_f = ${nf})`, DIAGRAM.x0 - 30, 22);
}

function drawLevels() {
  ctx.save();
  // Ionisation line
  ctx.strokeStyle = 'rgba(255, 220, 130, 0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(DIAGRAM.x0 - 30, DIAGRAM.yTop);
  ctx.lineTo(DIAGRAM.x1 + 25, DIAGRAM.yTop);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 220, 130, 0.9)';
  ctx.font = '600 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('n → ∞  (E = 0,  ionisation)', DIAGRAM.x0 - 25, DIAGRAM.yTop - 8);

  // Levels
  for (let n = 1; n <= N_MAX; n++) {
    const y = levelY(n);
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(DIAGRAM.x0, y);
    ctx.lineTo(DIAGRAM.x1, y);
    ctx.stroke();

    // n label (left)
    ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
    ctx.font = '700 14px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`n = ${n}`, DIAGRAM.x0 - 8, y);

    // Energy label — right side. n=4,5 stagger right with a leader line to
    // avoid vertical collision (those levels are only ~10 px apart).
    const e = E_n(n);
    ctx.fillStyle = 'rgba(170, 200, 235, 0.85)';
    ctx.font = '600 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    let lx = DIAGRAM.x1 + 8;
    let ly = y;
    if (n >= 4) {
      const stagger = (n - 4) * 26;
      lx = DIAGRAM.x1 + 36 + stagger;
      ctx.strokeStyle = 'rgba(170, 200, 235, 0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(DIAGRAM.x1 + 4, y);
      ctx.lineTo(lx - 3, y);
      ctx.stroke();
    }
    const decimals = n <= 2 ? (n === 1 ? 1 : 3) : 2;
    ctx.fillText(`${e.toFixed(decimals)} eV`, lx, ly);
  }
  ctx.restore();
}

function drawElectron(y, opts = {}) {
  const x = opts.x ?? ATOM_X;
  ctx.save();
  ctx.fillStyle = opts.fill || '#5dd1ff';
  ctx.strokeStyle = 'rgba(10, 22, 40, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Tag
  if (opts.tag !== false) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 9px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('e⁻', x, y);
  }
  ctx.restore();
}

function drawDragArrow() {
  const d = state.drag;
  if (!d) return;
  const startY = levelY(d.startN);
  const snapN = snapToLevel(d.y);
  const targetY = snapN !== null && snapN > d.startN ? levelY(snapN) : d.y;
  const valid = snapN !== null && snapN > d.startN;
  ctx.save();
  ctx.strokeStyle = valid ? 'rgba(255, 216, 107, 0.95)' : 'rgba(255, 110, 110, 0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash(valid ? [] : [5, 4]);
  ctx.beginPath();
  ctx.moveTo(ATOM_X, startY);
  ctx.lineTo(ATOM_X, targetY);
  ctx.stroke();
  // Arrowhead
  if (Math.abs(targetY - startY) > 6) {
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(ATOM_X, targetY);
    ctx.lineTo(ATOM_X - 5, targetY + 8);
    ctx.lineTo(ATOM_X + 5, targetY + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Ghost label: target transition only. Wavelength is for the student to
  // work out from the spectrum strip; don't pre-empt it here.
  if (valid) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 216, 107, 0.85)';
    ctx.font = '600 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const midY = (startY + targetY) / 2;
    ctx.fillText(`n = ${d.startN} → ${snapN}`, ATOM_X + 14, midY);
    ctx.restore();
  }
  // Re-draw the electron at its origin level
  drawElectron(startY);
}

function drawAbsorptionLabel() {
  if (state.mode !== 'absorption') return;
  ctx.save();
  ctx.fillStyle = 'rgba(220, 235, 255, 0.55)';
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('continuous source →', DIAGRAM.x0, DIAGRAM.yTop - 10);
  ctx.restore();
}

function drawSpectrumStrip() {
  // Background plate
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(STRIP.xL, STRIP.y0, STRIP.xR - STRIP.xL, STRIP.y1 - STRIP.y0);

  // Visible-band background: dark in emission, continuous-rainbow in absorption.
  const stripH = STRIP.y1 - STRIP.y0;
  if (state.mode === 'absorption') {
    // Build a 1px-tall rainbow gradient across the visible band.
    const grd = ctx.createLinearGradient(STRIP_VIS.xL, 0, STRIP_VIS.xR, 0);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const nm = 380 + t * (780 - 380);
      const [r, g, b] = wavelengthToRGBnm(nm);
      grd.addColorStop(t, `rgba(${(r*255)|0}, ${(g*255)|0}, ${(b*255)|0}, 0.78)`);
    }
    ctx.fillStyle = grd;
    ctx.fillRect(STRIP_VIS.xL, STRIP.y0 + 2, STRIP_VIS.xR - STRIP_VIS.xL, stripH - 4);
    // Faded shoulder tint for UV/IR continuum context
    ctx.fillStyle = 'rgba(120, 90, 180, 0.18)';
    ctx.fillRect(STRIP_UV.xL, STRIP.y0 + 2, STRIP_UV.xR - STRIP_UV.xL, stripH - 4);
    ctx.fillStyle = 'rgba(150, 70, 70, 0.16)';
    ctx.fillRect(STRIP_IR.xL, STRIP.y0 + 2, STRIP_IR.xR - STRIP_IR.xL, stripH - 4);
  }

  // Lines
  for (const k in state.lineCounts) {
    const count = state.lineCounts[k];
    const [lo, hi] = k.split('-').map(Number);
    const nm = lambdaNm(hi, lo);
    const x = lambdaToStripX(nm);
    const isLit = k === state.highlight;
    if (state.mode === 'emission') {
      const intensity = Math.min(1, count / 6);
      const alpha = isLit ? 1 : (0.5 + 0.5 * intensity);
      if (nm >= 380 && nm <= 780) {
        const [r, g, b] = wavelengthToRGBnm(nm);
        ctx.fillStyle = `rgba(${(r*255)|0}, ${(g*255)|0}, ${(b*255)|0}, ${alpha})`;
      } else if (nm < 380) {
        ctx.fillStyle = `rgba(170, 120, 230, ${alpha})`;
      } else {
        ctx.fillStyle = `rgba(220, 110, 110, ${alpha})`;
      }
      const w = isLit ? 3 : 2;
      ctx.fillRect(x - w / 2, STRIP.y0 + 4, w, stripH - 8);
      if (isLit) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x - 2, STRIP.y0 + 4, 4, stripH - 8);
      }
    } else {
      // Absorption: dark line cuts into the strip.
      const darkness = isLit ? 1 : Math.min(0.95, 0.45 + count * 0.12);
      const w = isLit ? 3 : 2;
      ctx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
      ctx.fillRect(x - w / 2, STRIP.y0 + 2, w, stripH - 4);
    }
  }

  // Band-divider ticks
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(STRIP_VIS.xL, STRIP.y0 + 2);
  ctx.lineTo(STRIP_VIS.xL, STRIP.y1 - 2);
  ctx.moveTo(STRIP_VIS.xR, STRIP.y0 + 2);
  ctx.lineTo(STRIP_VIS.xR, STRIP.y1 - 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Wavelength axis labels
  ctx.fillStyle = 'rgba(220, 235, 255, 0.75)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  const labelY = STRIP.y0 - 6;
  ctx.fillText('UV', (STRIP_UV.xL + STRIP_UV.xR) / 2, labelY);
  ctx.fillText('IR', (STRIP_IR.xL + STRIP_IR.xR) / 2, labelY);
  ctx.fillText('400 nm', STRIP_VIS.xL + 36, labelY);
  ctx.fillText('500 nm', STRIP_VIS.xL + (500-380)/400 * (STRIP_VIS.xR - STRIP_VIS.xL), labelY);
  ctx.fillText('600 nm', STRIP_VIS.xL + (600-380)/400 * (STRIP_VIS.xR - STRIP_VIS.xL), labelY);
  ctx.fillText('700 nm', STRIP_VIS.xL + (700-380)/400 * (STRIP_VIS.xR - STRIP_VIS.xL), labelY);

  ctx.restore();
}

// ── Cascade animation ─────────────────────────────────────────────────
// Phases:
//  excite: electron rises from n=1 to target level, optional incoming photon
//          flying into gas cell (absorption mode). 300 ms.
//  drop:   one downward step. Electron slides, photon emerges. 350 ms.
//          Repeat until at n=1.
function startCascade(targetN) {
  if (targetN <= state.electronN) return;
  const incomingLambda = lambdaNm(targetN, state.electronN);
  if (!state.groupObserved[targetN]) state.groupObserved[targetN] = new Set();
  state.anim = {
    phase: 'excite',
    phaseStart: performance.now(),
    phaseDuration: 300,
    fromN: state.electronN,
    toN: targetN,
    excitationN: targetN,   // original target, constant for the whole cascade
    photonLambda: incomingLambda,
    pendingCascadeFrom: targetN,
    offAxisPhotons: [],
  };
  // Record the absorbed (excitation) transition: only registers as a line in
  // absorption mode (it's the absorbed photon). In emission mode the excitation
  // is the trigger, not a measured line, so skip.
  if (state.mode === 'absorption') {
    recordLine(targetN, state.electronN);
    setLastTransition(state.electronN, targetN, /*absorbed*/ true);
    if (!state.excitationTargets.includes(targetN)) {
      state.excitationTargets.push(targetN);
      state.chronoArrows.push({ type: 'up', excN: targetN });
    }
  }
}

function setLastTransition(n_lo, n_hi, absorbed) {
  // Display in n_i → n_f order from the electron's perspective.
  const n_i = absorbed ? n_lo : n_hi;
  const n_f = absorbed ? n_hi : n_lo;
  const dE = Math.abs(E_n(n_hi) - E_n(n_lo));
  state.lastTransition = { n_i, n_f, dE, lambda: lambdaNm(n_hi, n_lo) };
  state.highlightSeries = absorbed ? null : n_lo;  // only emission picks a series
  state.highlightAt = performance.now();
  document.getElementById('rd-transition').textContent = `${n_i} → ${n_f}`;
  document.getElementById('rd-de').innerHTML =
    `${dE.toFixed(3)} <span class="readout-unit">eV</span>`;
}

function allArrowsFilled(excN) {
  const total = excN * (excN - 1) / 2;  // all (lo,hi) pairs with hi ≤ excN
  return (state.groupObserved[excN]?.size || 0) >= total;
}

function stepCascade() {
  const from = state.anim.pendingCascadeFrom;
  if (from <= 1) { finishAnim(); return; }

  const excN = state.anim.excitationN;
  const observed = state.groupObserved[excN] || new Set();
  let to;

  if (allArrowsFilled(excN)) {
    // Every arrow in this group is known — free to randomise.
    to = 1 + Math.floor(Math.random() * (from - 1));
  } else {
    // Prefer the first unobserved direct step from `from` (n-1 first).
    to = null;
    for (let lo = from - 1; lo >= 1; lo--) {
      if (!observed.has(transitionKey(lo, from))) { to = lo; break; }
    }
    // All direct steps from this level already seen — pick randomly.
    if (to === null) to = 1 + Math.floor(Math.random() * (from - 1));
  }

  state.anim.phase = 'drop';
  state.anim.phaseStart = performance.now();
  state.anim.phaseDuration = 700;
  state.anim.fromN = from;
  state.anim.toN = to;
  state.anim.photonLambda = lambdaNm(from, to);
  state.anim.dropEmitted = false;
}

function finishAnim() {
  // Settle electron back at n=1.
  state.electronN = 1;
  state.anim = null;
}

function tickAnim(now) {
  if (!state.anim) return;
  const a = state.anim;
  const elapsed = now - a.phaseStart;
  if (elapsed >= a.phaseDuration) {
    if (a.phase === 'excite') {
      // Excitation complete; electron sits at target.
      state.electronN = a.toN;
      a.pendingCascadeFrom = a.toN;
      stepCascade();
    } else if (a.phase === 'drop') {
      if (state.mode === 'emission') {
        const k = transitionKey(a.toN, a.fromN);
        const isNewGroup = !state.excitationTargets.includes(a.excitationN);
        const isNewStep  = !state.groupObserved[a.excitationN]?.has(k);
        recordLine(a.fromN, a.toN);
        state.groupObserved[a.excitationN].add(k);
        setLastTransition(a.toN, a.fromN, /*absorbed*/ false);
        if (isNewGroup) {
          state.excitationTargets.push(a.excitationN);
          // Upward arrow enters the chrono list just before its first drop.
          state.chronoArrows.push({ type: 'up', excN: a.excitationN });
        }
        if (isNewStep) {
          state.chronoArrows.push({ type: 'dn', excN: a.excitationN, lo: a.toN, hi: a.fromN });
        }
      }
      state.electronN = a.toN;
      a.pendingCascadeFrom = a.toN;
      a.phase = 'hold';
      a.phaseStart = performance.now();
      a.phaseDuration = 260;
    } else if (a.phase === 'hold') {
      stepCascade();
    }
  }
  // Tick off-axis photons (absorption mode)
  for (const p of a.offAxisPhotons || []) {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
  }
  if (a.offAxisPhotons) a.offAxisPhotons = a.offAxisPhotons.filter(p => p.life > 0);
}

function drawCascade() {
  if (!state.anim) return;
  const a = state.anim;

  if (a.phase === 'hold') {
    drawElectron(levelY(state.electronN));
    return;
  }

  const t = Math.min(1, (performance.now() - a.phaseStart) / a.phaseDuration);
  const y = levelY(a.fromN) + t * (levelY(a.toN) - levelY(a.fromN));
  drawElectron(y);

  if (a.phase === 'excite' && state.mode === 'absorption') {
    // Photon flies in from the left edge toward the electron.
    const px = -20 + t * (ATOM_X + 20);
    const py = levelY(a.fromN) + t * (levelY(a.toN) - levelY(a.fromN));
    drawPhoton(px, py, a.photonLambda);
  }

  if (a.phase === 'drop') {
    // Photon visualisation: emission mode → fly toward strip x at λ; absorption
    // mode → fly off in a random direction out of the gas cell.
    if (state.mode === 'emission') {
      const targetX = lambdaToStripX(a.photonLambda);
      const targetY = STRIP.y0 + 4;
      const startX = ATOM_X;
      const startY = (levelY(a.fromN) + levelY(a.toN)) / 2;
      const px = startX + t * (targetX - startX);
      const py = startY + t * (targetY - startY);
      drawPhoton(px, py, a.photonLambda);
    } else {
      // Spawn an off-axis photon once per drop, then animate it via offAxisPhotons.
      if (!a.dropEmitted) {
        a.dropEmitted = true;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        const speed = 4;
        a.offAxisPhotons.push({
          x: ATOM_X,
          y: levelY(a.fromN),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          colour: photonColour(a.photonLambda),
          life: 60,
        });
      }
    }
  }
  // Draw any off-axis photons in flight
  for (const p of a.offAxisPhotons || []) {
    ctx.save();
    ctx.fillStyle = p.colour;
    ctx.globalAlpha = Math.max(0, p.life / 60);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPhoton(x, y, nm) {
  const colour = photonColour(nm);
  ctx.save();
  // Glow
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Transition arrows ────────────────────────────────────────────────
const ARROW_UP_COL = 'rgba(140, 190, 255, 0.80)';
const ARROW_DN_COL = 'rgba(255, 210, 110, 0.80)';
const ARROW_STEP  = 11;   // px between adjacent arrows
const ARROW_GAP   = 5;    // extra px between groups

// Rebuilt every frame during drawTransitionArrows for click/hover detection.
let arrowHitRegions = [];  // [{key, x, yMin, yMax}]

function drawArrow(x, yFrom, yTo, colour, lit = false) {
  const AH = 4;
  const AL = 7;
  const up = yTo < yFrom;
  const tipY = yTo;
  const stemEndY = up ? yTo + AL : yTo - AL;
  ctx.save();
  if (lit) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, yFrom);
    ctx.lineTo(x, stemEndY);
    ctx.stroke();
  }
  ctx.strokeStyle = lit ? 'white' : colour;
  ctx.fillStyle   = lit ? 'white' : colour;
  ctx.lineWidth = lit ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yFrom);
  ctx.lineTo(x, stemEndY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - AH, stemEndY);
  ctx.lineTo(x + AH, stemEndY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


function drawTransitionArrows() {
  arrowHitRegions = [];
  if (state.excitationTargets.length === 0) return;
  if (state.sortMode === 'chrono') {
    // Strict observation order — no gaps, no pre-reserved slots.
    const yGround = levelY(1);
    state.chronoArrows.forEach((entry, i) => {
      const x = ARROWS_X0 + i * ARROW_STEP;
      if (entry.type === 'up') {
        const key = transitionKey(1, entry.excN);
        const yTo = levelY(entry.excN);
        drawArrow(x, yGround, yTo, ARROW_UP_COL, key === state.highlight);
        arrowHitRegions.push({ key, x, yMin: Math.min(yGround, yTo), yMax: Math.max(yGround, yTo) });
      } else {
        const key = transitionKey(entry.lo, entry.hi);
        const yFrom = levelY(entry.hi);
        const yTo   = levelY(entry.lo);
        drawArrow(x, yFrom, yTo, ARROW_DN_COL, key === state.highlight);
        arrowHitRegions.push({ key, x, yMin: Math.min(yFrom, yTo), yMax: Math.max(yFrom, yTo) });
      }
    });
  } else {
    // Series order — groups sorted by excitation level, slots pre-reserved.
    const targets = [...state.excitationTargets].sort((a, b) => a - b);
    const yGround = levelY(1);
    let x = ARROWS_X0;
    targets.forEach(n_target => {
      const upKey = transitionKey(1, n_target);
      const yUpTo = levelY(n_target);
      drawArrow(x, yGround, yUpTo, ARROW_UP_COL, upKey === state.highlight);
      arrowHitRegions.push({ key: upKey, x, yMin: Math.min(yGround, yUpTo), yMax: Math.max(yGround, yUpTo) });
      x += ARROW_STEP;
      const observed = state.groupObserved[n_target] || new Set();
      for (let hi = n_target; hi >= 2; hi--) {
        for (let lo = hi - 1; lo >= 1; lo--) {
          if (observed.has(transitionKey(lo, hi))) {
            const dnKey = transitionKey(lo, hi);
            const yFrom = levelY(hi);
            const yTo   = levelY(lo);
            drawArrow(x, yFrom, yTo, ARROW_DN_COL, dnKey === state.highlight);
            arrowHitRegions.push({ key: dnKey, x, yMin: Math.min(yFrom, yTo), yMax: Math.max(yFrom, yTo) });
          }
          x += ARROW_STEP;
        }
      }
      x += ARROW_GAP;
    });
  }
}

// ── Frame ────────────────────────────────────────────────────────────
function frame(now) {
  state.t = now;
  tickAnim(now);
  clearBackground();
  drawSeriesHighlight();
  drawLevels();
  drawTransitionArrows();
  drawAbsorptionLabel();

  // Electron resting state, drag preview, or cascade animation
  if (state.anim) {
    drawCascade();
  } else if (state.drag) {
    drawDragArrow();
  } else {
    drawElectron(levelY(state.electronN));
  }

  drawSpectrumStrip();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Input ────────────────────────────────────────────────────────────
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * W,
    y: ((e.clientY - r.top) / r.height) * H,
  };
}

function isOnElectron(p) {
  if (state.anim || state.drag) return false;
  const ey = levelY(state.electronN);
  return Math.hypot(p.x - ATOM_X, p.y - ey) < 16;
}

function isOverClickable(p) {
  // Returns true if p is over a spectrum line or a transition arrow.
  if (p.y >= STRIP.y0 && p.y <= STRIP.y1) {
    for (const k in state.lineCounts) {
      const [lo, hi] = k.split('-').map(Number);
      const x = lambdaToStripX(lambdaNm(hi, lo));
      if (Math.abs(p.x - x) <= 6) return true;
    }
  }
  for (const region of arrowHitRegions) {
    if (Math.abs(p.x - region.x) <= 6 &&
        p.y >= region.yMin - 4 && p.y <= region.yMax + 4) return true;
  }
  return false;
}

canvas.addEventListener('pointermove', (e) => {
  const p = canvasPos(e);
  if (state.drag) {
    state.drag.x = p.x;
    state.drag.y = p.y;
  } else if (state.anim) {
    canvas.classList.remove('grabbable', 'dragging');
    canvas.classList.add('locked');
  } else {
    const onElectron = isOnElectron(p);
    const onClickable = !onElectron && isOverClickable(p);
    canvas.classList.toggle('grabbable', onElectron);
    canvas.classList.toggle('pointer', onClickable);
    canvas.classList.remove('locked', 'dragging');
  }
});

canvas.addEventListener('click', (e) => {
  if (state.drag || state.anim) return;
  const p = canvasPos(e);
  if (isOnElectron(p)) return;  // electron click handled by pointerdown/up

  // Spectrum strip click
  if (p.y >= STRIP.y0 && p.y <= STRIP.y1) {
    let bestKey = null, bestDist = 8;
    for (const k in state.lineCounts) {
      const [lo, hi] = k.split('-').map(Number);
      const x = lambdaToStripX(lambdaNm(hi, lo));
      const d = Math.abs(p.x - x);
      if (d < bestDist) { bestDist = d; bestKey = k; }
    }
    state.highlight = (bestKey !== null && bestKey !== state.highlight) ? bestKey : null;
    return;
  }

  // Transition arrow click
  let bestKey = null, bestDist = 8;
  for (const region of arrowHitRegions) {
    const dx = Math.abs(p.x - region.x);
    if (dx > 6) continue;
    if (p.y < region.yMin - 4 || p.y > region.yMax + 4) continue;
    if (dx < bestDist) { bestDist = dx; bestKey = region.key; }
  }
  state.highlight = (bestKey !== null && bestKey !== state.highlight) ? bestKey : null;
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.anim) return;
  const p = canvasPos(e);
  if (!isOnElectron(p)) return;
  state.drag = { startN: state.electronN, x: p.x, y: p.y };
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  if (!state.drag) return;
  const p = canvasPos(e);
  const targetN = snapToLevel(p.y);
  const valid = targetN !== null && targetN > state.drag.startN;
  const startN = state.drag.startN;
  state.drag = null;
  canvas.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  if (valid) startCascade(targetN);
  // Invalid release → snap back (no-op, electron stays at startN).
});

canvas.addEventListener('pointercancel', () => {
  state.drag = null;
  canvas.classList.remove('dragging');
});

// ── Controls ────────────────────────────────────────────────────────
document.getElementById('seg-mode').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  for (const b of document.querySelectorAll('#seg-mode .seg-btn')) {
    b.classList.toggle('active', b === btn);
  }
});

document.getElementById('seg-sort').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.sortMode = btn.dataset.sort;
  for (const b of document.querySelectorAll('#seg-sort .seg-btn')) {
    b.classList.toggle('active', b === btn);
  }
});

document.getElementById('btn-clear').addEventListener('click', () => {
  state.lineCounts = {};
  state.groupObserved = {};
  state.excitationTargets = [];
  state.chronoArrows = [];
  state.lastTransition = null;
  state.highlightSeries = null;
  state.highlight = null;
  document.getElementById('rd-transition').textContent = '—';
  document.getElementById('rd-de').innerHTML = '— <span class="readout-unit">eV</span>';
});

document.getElementById('btn-reset').addEventListener('click', () => {
  state.anim = null;
  state.electronN = 1;
  state.drag = null;
});
