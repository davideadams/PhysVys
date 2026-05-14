// Fluorescence & Phosphorescence — Jablonski diagram + spectrum strip.
// UV photon in → S1* (vibrational) → vibrational relaxation → S1 →
//   fluorescence path: S1 → S0 (fast, blue)
//   phosphorescence path: S1 → T1 (intersystem crossing) → S0 (slow, green)

const canvas = document.getElementById('fluor-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 960
const H = canvas.height;  // 600

// ── Layout ────────────────────────────────────────────────────────────
const DIAGRAM = { x0: 230, x1: 860, yTop: 32, yBot: 405 };
const MOL_X   = 132;   // molecule dot x
const LAMP_X  = 40;    // UV lamp centre x
const E_FULL  = 4.6;   // eV at yTop

const STRIP     = { y0: 452, y1: 530, xL: 20, xR: 940 };
const STRIP_UV  = { xL: 20,  xR: 120 };
const STRIP_VIS = { xL: 120, xR: 840 };
const STRIP_IR  = { xL: 840, xR: 940 };

// ── Physics ───────────────────────────────────────────────────────────
const HC = 1240; // eV·nm

// Named energy levels (eV)
const E = {
  G:    0,
  M:    2.34,   // metastable T1  → 530 nm green
  S:    2.76,   // S1 v=0         → 449 nm blue
  Sabs: 4.13,   // S1* vibrational→ 300 nm UV (absorbed)
};

const NM_ABS   = Math.round(HC / (E.Sabs - E.G));  // 300
const NM_FLUOR = Math.round(HC / (E.S   - E.G));   // 449
const NM_PHOS  = Math.round(HC / (E.M   - E.G));   // 530

function levelY(eV) {
  return DIAGRAM.yBot - (eV / E_FULL) * (DIAGRAM.yBot - DIAGRAM.yTop);
}

const LY = {
  G:    levelY(E.G),
  M:    levelY(E.M),
  S:    levelY(E.S),
  Sabs: levelY(E.Sabs),
};

// Static x-positions for each Jablonski arrow on the diagram
const AX = {
  abs:   DIAGRAM.x0 + 50,   // absorption
  vib:   DIAGRAM.x0 + 130,  // vibrational relaxation
  fluor: DIAGRAM.x0 + 235,  // fluorescence S→G
  isc:   DIAGRAM.x0 + 360,  // intersystem crossing S→M
  phos:  DIAGRAM.x0 + 460,  // phosphorescence M→G
};

// ── State ─────────────────────────────────────────────────────────────
const state = {
  mode:        'fluorescence',
  sourceMode:  'single',
  lampCycling: false,
  anim:        null,
  lineCounts:  {},   // nm string → count
  lifetime:    2.0,  // seconds (phosphorescence wait)
};

// ── Colour helpers ─────────────────────────────────────────────────────
function wavelengthToRGB(nm) {
  let R = 0, G = 0, B = 0;
  const l = Math.max(380, Math.min(780, nm));
  if      (l < 440) { R = -(l-440)/60;  G = 0;          B = 1; }
  else if (l < 490) { R = 0;            G = (l-440)/50;  B = 1; }
  else if (l < 510) { R = 0;            G = 1;           B = -(l-510)/20; }
  else if (l < 580) { R = (l-510)/70;   G = 1;           B = 0; }
  else if (l < 645) { R = 1;            G = -(l-645)/65; B = 0; }
  else              { R = 1;            G = 0;            B = 0; }
  let f = 1;
  if      (l < 420) f = 0.3 + 0.7*(l-380)/40;
  else if (l > 700) f = 0.3 + 0.7*(780-l)/80;
  return [R*f, G*f, B*f];
}

function photonCol(nm) {
  if (nm < 380) return 'rgb(140, 70, 215)';
  if (nm > 780) return 'rgb(160, 60, 60)';
  const [r,g,b] = wavelengthToRGB(nm);
  return `rgb(${(r*255)|0},${(g*255)|0},${(b*255)|0})`;
}

function lambdaToStripX(nm) {
  if (nm >= 380 && nm <= 780)
    return STRIP_VIS.xL + (nm-380)/400 * (STRIP_VIS.xR - STRIP_VIS.xL);
  if (nm < 380) {
    const t = (Math.log(Math.max(nm,80)) - Math.log(80)) / (Math.log(380) - Math.log(80));
    return STRIP_UV.xL + t * (STRIP_UV.xR - STRIP_UV.xL);
  }
  const t = (Math.log(Math.min(nm,20000)) - Math.log(780)) / (Math.log(20000) - Math.log(780));
  return STRIP_IR.xL + t * (STRIP_IR.xR - STRIP_IR.xL);
}

// ── Background ─────────────────────────────────────────────────────────
function clearBg() {
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, W, H);
}

// ── Jablonski diagram ──────────────────────────────────────────────────
function drawArrow(x, y1, y2, col, alpha, lineW) {
  // Vertical arrow from y1 to y2.
  const up = y2 < y1;
  const AH = 5, AL = 9;
  const stemY = up ? y2 + AL : y2 - AL;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lineW;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, stemY); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y2); ctx.lineTo(x - AH, stemY); ctx.lineTo(x + AH, stemY);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawWavyArrow(x, y1, y2, col, alpha) {
  // Dashed zigzag arrow for non-radiative transitions.
  const n = 7;
  const dy = (y2 - y1) / n;
  const amp = 5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col; ctx.lineWidth = 1.6;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x, y1);
  for (let i = 1; i <= n; i++) {
    const xOff = (i % 2 === 0) ? amp : -amp;
    ctx.lineTo(x + xOff, y1 + i * dy);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead
  const up = y2 < y1;
  const AH = 4, AL = 7;
  const stemY = up ? y2 + AL : y2 - AL;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x, y2); ctx.lineTo(x - AH, stemY); ctx.lineTo(x + AH, stemY);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function arrowLabel(x, y1, y2, text, col, alpha) {
  const midY = (y1 + y2) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + 13, midY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = col;
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawLevels() {
  ctx.save();
  const isPhos  = state.mode === 'phosphorescence';
  const phase   = state.anim?.phase ?? '';
  const { x0, x1 } = DIAGRAM;

  // ── Level lines ──
  function level(y, col, dash = []) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.8;
    ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.setLineDash([]);
  }

  // S1* (dashed, faint — excited vibrational)
  level(LY.Sabs, 'rgba(160,200,255,0.28)', [5,4]);
  // S1
  level(LY.S, 'rgba(160,200,255,0.88)');
  // T1 metastable (amber, dimmed in fluorescence mode)
  const mAlpha = isPhos ? 0.90 : 0.28;
  level(LY.M, `rgba(255,190,80,${mAlpha})`, isPhos ? [] : [6,4]);
  // S0 ground
  level(LY.G, 'rgba(200,230,255,0.88)');

  // ── Level labels (left of diagram) ──
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(140,190,255,0.35)';
  ctx.fillText('S₁*', x0 - 8, LY.Sabs);
  ctx.fillStyle = 'rgba(200,220,255,0.95)';
  ctx.fillText('S₁',  x0 - 8, LY.S);
  ctx.fillStyle = `rgba(255,200,100,${mAlpha})`;
  ctx.fillText('T₁',  x0 - 8, LY.M);
  ctx.fillStyle = 'rgba(200,230,255,0.95)';
  ctx.fillText('S₀',  x0 - 8, LY.G);

  // ── Energy labels (right of diagram) ──
  ctx.font = '600 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left'; const ex = x1 + 8;
  ctx.fillStyle = 'rgba(140,190,255,0.32)';
  ctx.fillText(`${E.Sabs.toFixed(2)} eV`, ex, LY.Sabs);
  ctx.fillStyle = 'rgba(160,200,255,0.78)';
  ctx.fillText(`${E.S.toFixed(2)} eV`, ex, LY.S);
  ctx.fillStyle = `rgba(255,190,80,${mAlpha * 0.88})`;
  ctx.fillText(`${E.M.toFixed(2)} eV`, ex, LY.M);
  ctx.fillStyle = 'rgba(160,200,255,0.68)';
  ctx.fillText('0 eV', ex, LY.G);

  // ── Static Jablonski arrows ──
  // Each one brightens when its phase is active.
  function lit(phases) { return phases.includes(phase); }

  // Absorption: G → Sabs (UV purple)
  const absA = lit(['absorbing','at_sabs']) ? 1.0 : 0.55;
  const absW = lit(['absorbing','at_sabs']) ? 2.4 : 1.6;
  drawArrow(AX.abs, LY.G, LY.Sabs, 'rgb(140,70,210)', absA, absW);
  arrowLabel(AX.abs, LY.G, LY.Sabs, `absorption  (UV, ${NM_ABS} nm)`, 'rgba(160,100,230,1)', absA * 0.9);

  // Vibrational relaxation: Sabs → S (wavy, amber)
  const vibA = lit(['relaxing']) ? 1.0 : 0.50;
  drawWavyArrow(AX.vib, LY.Sabs, LY.S, 'rgba(255,180,60,1)', vibA);
  arrowLabel(AX.vib, LY.Sabs, LY.S, 'vibrational relaxation  (heat)', 'rgba(255,190,80,1)', vibA * 0.9);

  // Fluorescence: S → G (blue)
  const flA = isPhos ? 0.22 : (lit(['emitting_f']) ? 1.0 : 0.65);
  const flW = lit(['emitting_f']) ? 2.4 : 1.6;
  drawArrow(AX.fluor, LY.S, LY.G, 'rgba(100,160,255,1)', flA, flW);
  arrowLabel(AX.fluor, LY.S, LY.G, `fluorescence  (${NM_FLUOR} nm)`, 'rgba(130,180,255,1)', flA * 0.9);

  // Intersystem crossing: S → M (wavy amber)
  const iscA = isPhos ? (lit(['crossing']) ? 1.0 : 0.65) : 0.22;
  drawWavyArrow(AX.isc, LY.S, LY.M, 'rgba(255,170,50,1)', iscA);
  arrowLabel(AX.isc, LY.S, LY.M, 'intersystem crossing', 'rgba(255,190,80,1)', iscA * 0.9);

  // Phosphorescence: M → G (green)
  const phA = isPhos ? (lit(['emitting_p']) ? 1.0 : 0.65) : 0.22;
  const phW = lit(['emitting_p']) ? 2.4 : 1.6;
  drawArrow(AX.phos, LY.M, LY.G, 'rgba(80,200,120,1)', phA, phW);
  arrowLabel(AX.phos, LY.M, LY.G, `phosphorescence  (${NM_PHOS} nm)`, 'rgba(100,215,140,1)', phA * 0.9);

  ctx.restore();
}

// ── UV lamp ────────────────────────────────────────────────────────────
function drawLamp() {
  const isActive = state.lampCycling || (state.anim?.phase === 'absorbing');
  ctx.save();
  if (isActive) {
    const g = ctx.createRadialGradient(LAMP_X, LY.G, 2, LAMP_X, LY.G, 30);
    g.addColorStop(0, 'rgba(160,80,255,0.30)');
    g.addColorStop(1, 'rgba(160,80,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(LAMP_X, LY.G, 30, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle   = isActive ? 'rgba(140,70,220,0.90)' : 'rgba(70,40,130,0.65)';
  ctx.strokeStyle = isActive ? 'rgba(190,130,255,0.80)' : 'rgba(100,70,160,0.40)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(LAMP_X, LY.G, 16, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = isActive ? 'rgba(255,255,255,0.95)' : 'rgba(200,170,255,0.60)';
  ctx.font = '700 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('UV', LAMP_X, LY.G);
  ctx.restore();
}

// ── Molecule dot ────────────────────────────────────────────────────────
function drawMolecule(y, glowCol, glowR) {
  ctx.save();
  if (glowCol && glowR > 0) {
    const g = ctx.createRadialGradient(MOL_X, y, 0, MOL_X, y, glowR);
    g.addColorStop(0, glowCol.replace(')', ',0.35)').replace('rgb','rgba'));
    g.addColorStop(1, glowCol.replace(')', ',0)').replace('rgb','rgba'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(MOL_X, y, glowR, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle = '#5dd1ff';
  ctx.strokeStyle = 'rgba(10,22,40,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(MOL_X, y, 7.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '700 9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('e⁻', MOL_X, y);
  ctx.restore();
}

function drawPhoton(x, y, nm, r) {
  const col = photonCol(nm);
  ctx.save();
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.28;
  ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

// ── Animation state machine ────────────────────────────────────────────
// Phases (in order):
//  absorbing   500 ms  UV photon travels LAMP_X → MOL_X; electron at LY.G
//  at_sabs      80 ms  electron jumps to LY.Sabs; photon absorbed
//  relaxing    380 ms  electron slides Sabs → S; heat particles spawn
//  waiting_s   280 ms  electron sits at S (brief pause before choosing path)
//  -- fluorescence --
//  emitting_f  500 ms  electron slides S → G; blue photon flies to strip
//  -- phosphorescence --
//  crossing    700 ms  electron slides S → M (ISC)
//  waiting_m   lifetime*1000 ms  electron at M; amber glow
//  emitting_p  500 ms  electron slides M → G; green photon flies to strip

function startCycle() {
  if (state.anim) return;
  state.anim = {
    phase: 'absorbing',
    phaseStart: performance.now(),
    phaseDuration: 500,
    electronY: LY.G,
    inPhoton: { x: LAMP_X + 16, y: LY.G },
    outPhoton: null,
    heatParticles: [],
    heatSpawned: false,
  };
}

function nextPhase(phase, duration) {
  const a = state.anim;
  a.phase = phase;
  a.phaseStart = performance.now();
  a.phaseDuration = duration;
}

function finishCycle() {
  state.anim = null;
  if (state.lampCycling) setTimeout(startCycle, 300);
}

function updateReadout(absNm, emitNm) {
  const eIn  = (HC / absNm).toFixed(2);
  const eOut = (HC / emitNm).toFixed(2);
  document.getElementById('rd-abs').innerHTML  = `${absNm} <span class="readout-unit">nm</span>`;
  document.getElementById('rd-emit').innerHTML = `${emitNm} <span class="readout-unit">nm</span>`;
  document.getElementById('rd-ein').innerHTML  = `${eIn} <span class="readout-unit">eV</span>`;
  document.getElementById('rd-eout').innerHTML = `${eOut} <span class="readout-unit">eV</span>`;
}

function tickAnim(now) {
  const a = state.anim;
  if (!a) return;

  const elapsed = now - a.phaseStart;
  const t = Math.min(1, elapsed / a.phaseDuration);

  switch (a.phase) {

    case 'absorbing':
      a.inPhoton.x = LAMP_X + 16 + t * (MOL_X - LAMP_X - 16);
      a.electronY  = LY.G;
      if (elapsed >= a.phaseDuration) nextPhase('at_sabs', 80);
      break;

    case 'at_sabs':
      a.electronY = LY.Sabs;
      a.inPhoton  = null;
      if (elapsed >= a.phaseDuration) nextPhase('relaxing', 380);
      break;

    case 'relaxing':
      a.electronY = LY.Sabs + t * (LY.S - LY.Sabs);
      if (!a.heatSpawned) {
        a.heatSpawned = true;
        const baseY = LY.Sabs;
        a.heatParticles.push({ x: MOL_X, y: baseY, vx:  3.5, vy: -1.8, life: 50, max: 50 });
        a.heatParticles.push({ x: MOL_X, y: baseY, vx:  2.2, vy: -3.2, life: 44, max: 44 });
        a.heatParticles.push({ x: MOL_X, y: baseY, vx:  4.5, vy: -0.6, life: 38, max: 38 });
        a.heatParticles.push({ x: MOL_X, y: baseY, vx: -2.5, vy: -2.0, life: 42, max: 42 });
      }
      if (elapsed >= a.phaseDuration) nextPhase('waiting_s', 280);
      break;

    case 'waiting_s':
      a.electronY = LY.S;
      if (elapsed >= a.phaseDuration) {
        if (state.mode === 'fluorescence') {
          nextPhase('emitting_f', 500);
          a.outPhoton = {
            x: MOL_X, y: LY.S,
            startX: MOL_X, startY: LY.S,
            targetX: lambdaToStripX(NM_FLUOR), targetY: STRIP.y0 + 4,
            nm: NM_FLUOR,
          };
        } else {
          nextPhase('crossing', 700);
        }
      }
      break;

    case 'emitting_f':
      a.electronY = LY.S + t * (LY.G - LY.S);
      if (a.outPhoton) {
        a.outPhoton.x = a.outPhoton.startX + t * (a.outPhoton.targetX - a.outPhoton.startX);
        a.outPhoton.y = a.outPhoton.startY + t * (a.outPhoton.targetY - a.outPhoton.startY);
      }
      if (elapsed >= a.phaseDuration) {
        state.lineCounts[String(NM_FLUOR)] = (state.lineCounts[String(NM_FLUOR)] || 0) + 1;
        updateReadout(NM_ABS, NM_FLUOR);
        finishCycle();
      }
      break;

    case 'crossing':
      a.electronY = LY.S + t * (LY.M - LY.S);
      if (elapsed >= a.phaseDuration) nextPhase('waiting_m', state.lifetime * 1000);
      break;

    case 'waiting_m':
      a.electronY = LY.M;
      if (elapsed >= a.phaseDuration) {
        nextPhase('emitting_p', 500);
        a.outPhoton = {
          x: MOL_X, y: LY.M,
          startX: MOL_X, startY: LY.M,
          targetX: lambdaToStripX(NM_PHOS), targetY: STRIP.y0 + 4,
          nm: NM_PHOS,
        };
      }
      break;

    case 'emitting_p':
      a.electronY = LY.M + t * (LY.G - LY.M);
      if (a.outPhoton) {
        a.outPhoton.x = a.outPhoton.startX + t * (a.outPhoton.targetX - a.outPhoton.startX);
        a.outPhoton.y = a.outPhoton.startY + t * (a.outPhoton.targetY - a.outPhoton.startY);
      }
      if (elapsed >= a.phaseDuration) {
        state.lineCounts[String(NM_PHOS)] = (state.lineCounts[String(NM_PHOS)] || 0) + 1;
        updateReadout(NM_ABS, NM_PHOS);
        finishCycle();
      }
      break;
  }

  // Tick heat particles
  for (const p of a.heatParticles) { p.x += p.vx; p.y += p.vy; p.vy -= 0.08; p.life--; }
  a.heatParticles = a.heatParticles.filter(p => p.life > 0);
}

// ── Draw animation layer ────────────────────────────────────────────────
function drawAnimLayer() {
  const a = state.anim;
  const phase  = a?.phase ?? 'idle';
  const eY     = a ? a.electronY : LY.G;

  // Glow colour based on phase
  let glowCol = null, glowR = 0;
  if (phase === 'waiting_m') {
    glowCol = 'rgb(255,190,80)'; glowR = 26;
  } else if (phase === 'waiting_s' || phase === 'at_sabs') {
    glowCol = 'rgb(100,180,255)'; glowR = 18;
  } else if (phase === 'emitting_f') {
    glowCol = 'rgb(100,155,255)'; glowR = 14;
  } else if (phase === 'emitting_p') {
    glowCol = 'rgb(80,210,130)'; glowR = 14;
  }

  drawMolecule(eY, glowCol, glowR);

  // Incoming UV photon
  if (a?.inPhoton) drawPhoton(a.inPhoton.x, a.inPhoton.y, NM_ABS, 4.5);

  // Outgoing visible photon
  if (a?.outPhoton) drawPhoton(a.outPhoton.x, a.outPhoton.y, a.outPhoton.nm, 4.5);

  // Heat / vibrational energy particles
  if (a) {
    for (const p of a.heatParticles) {
      ctx.save();
      ctx.globalAlpha = (p.life / p.max) * 0.80;
      ctx.fillStyle = 'rgba(255,210,80,1)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
}

// ── Spectrum strip ──────────────────────────────────────────────────────
function drawStrip() {
  ctx.save();
  const { y0, y1, xL, xR } = STRIP;
  const sh = y1 - y0;

  // Black background plate
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(xL, y0, xR - xL, sh);

  // Faint visible-band rainbow tint
  const grd = ctx.createLinearGradient(STRIP_VIS.xL, 0, STRIP_VIS.xR, 0);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const nm = 380 + t * 400;
    const [r, g, b] = wavelengthToRGB(nm);
    grd.addColorStop(t, `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},0.20)`);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(STRIP_VIS.xL, y0 + 2, STRIP_VIS.xR - STRIP_VIS.xL, sh - 4);

  // UV/IR shoulder tints
  ctx.fillStyle = 'rgba(110,55,190,0.14)';
  ctx.fillRect(STRIP_UV.xL, y0+2, STRIP_UV.xR - STRIP_UV.xL, sh - 4);
  ctx.fillStyle = 'rgba(150,55,55,0.11)';
  ctx.fillRect(STRIP_IR.xL, y0+2, STRIP_IR.xR - STRIP_IR.xL, sh - 4);

  // Band dividers
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
  ctx.beginPath();
  ctx.moveTo(STRIP_VIS.xL, y0+2); ctx.lineTo(STRIP_VIS.xL, y1-2);
  ctx.moveTo(STRIP_VIS.xR, y0+2); ctx.lineTo(STRIP_VIS.xR, y1-2);
  ctx.stroke(); ctx.setLineDash([]);

  // Emission lines
  for (const k in state.lineCounts) {
    const nm    = parseInt(k);
    const count = state.lineCounts[k];
    const x     = lambdaToStripX(nm);
    const intensity = Math.min(1, count / 6);
    if (nm >= 380 && nm <= 780) {
      const [r, g, b] = wavelengthToRGB(nm);
      ctx.fillStyle = `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},${0.5 + 0.5*intensity})`;
    } else {
      ctx.fillStyle = `rgba(150,80,220,${0.45 + 0.45*intensity})`;
    }
    ctx.fillRect(x - 1, y0 + 4, 2, sh - 8);
  }

  // Axis labels
  ctx.fillStyle = 'rgba(220,235,255,0.75)';
  ctx.font = '600 10px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  const labelY = y0 - 6;
  ctx.fillText('UV', (STRIP_UV.xL + STRIP_UV.xR) / 2, labelY);
  ctx.fillText('IR', (STRIP_IR.xL + STRIP_IR.xR) / 2, labelY);
  ctx.fillText('400 nm', STRIP_VIS.xL + 36, labelY);
  ctx.fillText('500 nm', lambdaToStripX(500), labelY);
  ctx.fillText('600 nm', lambdaToStripX(600), labelY);
  ctx.fillText('700 nm', lambdaToStripX(700), labelY);

  ctx.restore();
}

// ── Frame loop ──────────────────────────────────────────────────────────
function frame(now) {
  tickAnim(now);
  clearBg();
  drawLamp();
  drawLevels();
  drawAnimLayer();
  drawStrip();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Controls ────────────────────────────────────────────────────────────
document.getElementById('seg-mode').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  state.anim = null;
  state.lampCycling = false;
  updateLampBtn();
  for (const b of document.querySelectorAll('#seg-mode .seg-btn'))
    b.classList.toggle('active', b === btn);
  updateLifetimeVisibility();
});

document.getElementById('seg-source').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.sourceMode = btn.dataset.src;
  state.anim = null;
  state.lampCycling = false;
  updateLampBtn();
  for (const b of document.querySelectorAll('#seg-source .seg-btn'))
    b.classList.toggle('active', b === btn);
  const cont = state.sourceMode === 'continuous';
  document.getElementById('grp-fire').classList.toggle('hidden', cont);
  document.getElementById('grp-lamp').classList.toggle('hidden', !cont);
  updateLifetimeVisibility();
});

document.getElementById('btn-fire').addEventListener('click', () => {
  startCycle();
});

document.getElementById('btn-lamp').addEventListener('click', () => {
  state.lampCycling = !state.lampCycling;
  if (state.lampCycling && !state.anim) startCycle();
  updateLampBtn();
});

document.getElementById('sld-lifetime').addEventListener('input', e => {
  state.lifetime = parseFloat(e.target.value);
  document.getElementById('lbl-lifetime').value = state.lifetime.toFixed(1);
});
document.getElementById('lbl-lifetime').addEventListener('change', e => {
  const raw = parseFloat(e.target.value);
  if (isNaN(raw)) { e.target.value = state.lifetime.toFixed(1); return; }
  const v = Math.max(0.5, Math.min(5, Math.round(raw * 2) / 2));
  state.lifetime = v;
  document.getElementById('sld-lifetime').value = v;
  e.target.value = v.toFixed(1);
});

document.getElementById('btn-clear').addEventListener('click', () => {
  state.lineCounts = {};
});

function updateLampBtn() {
  const btn = document.getElementById('btn-lamp');
  btn.textContent = state.lampCycling ? 'Lamp off' : 'Lamp on';
  btn.classList.toggle('ghost', state.lampCycling);
}

function updateLifetimeVisibility() {
  const show = state.mode === 'phosphorescence';
  document.getElementById('grp-lifetime').classList.toggle('hidden', !show);
}
