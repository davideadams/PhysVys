/* ── Constants ─────────────────────────────────────────────── */

const CW = 960, CH = 560;
const ANIM_DURATION = 6; // seconds for one full traverse

// Muon scenario (fixed physics)
const MUON_BETA   = 0.98;
const MUON_TAU0   = 2.197e-6;   // proper lifetime, s
const MUON_L0_KM  = 10;         // proper atmosphere height, km

// Ship scenario
const SHIP_L0_AU  = 29.1;       // proper Earth-Neptune distance, AU

/* ── State ─────────────────────────────────────────────────── */

const state = {
  scenario: 'muon',   // 'muon' | 'ship'
  frame:    'ground', // 'ground' | 'moving'
  beta:     MUON_BETA,
  animT:    0,        // 0 → 1
  running:  true
};

/* ── DOM ───────────────────────────────────────────────────── */

const canvas  = document.getElementById('sim-canvas');
const ctx     = canvas.getContext('2d');
const btnPlay  = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const sliderBeta = document.getElementById('slider-beta');
const valBeta    = document.getElementById('val-beta');
const groupSpeed = document.getElementById('group-speed');

// Readout elements
const roTime   = document.getElementById('ro-time');
const roLength = document.getElementById('ro-length');
const roGamma  = document.getElementById('ro-gamma');
const roBeta   = document.getElementById('ro-beta');
const roTimeLabel   = document.getElementById('ro-time-label');
const roLengthLabel = document.getElementById('ro-length-label');

/* ── Helpers ───────────────────────────────────────────────── */

function gamma(b) { return 1 / Math.sqrt(1 - b * b); }

function fmt(n, dp) { return n.toFixed(dp); }

function lerp(a, b, t) { return a + (b - a) * t; }

function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

/* ── Readouts ──────────────────────────────────────────────── */

function updateReadouts() {
  const b  = state.beta;
  const g  = gamma(b);
  roBeta.textContent  = fmt(b, 3);
  roGamma.textContent = fmt(g, 4);

  if (state.scenario === 'muon') {
    const tau0   = MUON_TAU0 * 1e6;   // μs
    const tDil   = tau0 * g;
    const L0     = MUON_L0_KM;
    const Lcon   = L0 / g;

    if (state.frame === 'ground') {
      roTimeLabel.textContent   = 'Observed time (dilated)';
      roLengthLabel.textContent = 'Atmosphere height (proper)';
      roTime.innerHTML   = `${fmt(tDil, 2)} μs <span class="tag tag-dilated">dilated</span>`;
      roLength.innerHTML = `${fmt(L0, 1)} km <span class="tag tag-proper">proper</span>`;
    } else {
      roTimeLabel.textContent   = 'Muon lifetime (proper)';
      roLengthLabel.textContent = 'Atmosphere height (contracted)';
      roTime.innerHTML   = `${fmt(tau0, 3)} μs <span class="tag tag-proper">proper</span>`;
      roLength.innerHTML = `${fmt(Lcon, 2)} km <span class="tag tag-contracted">contracted</span>`;
    }
  } else {
    // ship
    const L0   = SHIP_L0_AU;
    const Lcon = L0 / g;
    const v_au_per_s = b * 2.998e8 / 1.496e11; // AU/s
    const tDil   = L0 / v_au_per_s;       // earth frame travel time, s
    const tau0   = tDil / g;              // proper travel time, s

    const fmtTime = (s) => {
      if (s >= 3600) return `${fmt(s/3600, 2)} h`;
      if (s >= 60)   return `${fmt(s/60,   2)} min`;
      return `${fmt(s, 2)} s`;
    };

    if (state.frame === 'ground') {
      roTimeLabel.textContent   = 'Travel time (dilated)';
      roLengthLabel.textContent = 'Earth-Neptune dist (proper)';
      roTime.innerHTML   = `${fmtTime(tDil)} <span class="tag tag-dilated">dilated</span>`;
      roLength.innerHTML = `${fmt(L0, 1)} AU <span class="tag tag-proper">proper</span>`;
    } else {
      roTimeLabel.textContent   = 'Travel time (proper)';
      roLengthLabel.textContent = 'Earth-Neptune dist (contracted)';
      roTime.innerHTML   = `${fmtTime(tau0)} <span class="tag tag-proper">proper</span>`;
      roLength.innerHTML = `${fmt(Lcon, 2)} AU <span class="tag tag-contracted">contracted</span>`;
    }
  }
}

/* ── Why cards ─────────────────────────────────────────────── */

function updateWhyCards() {
  document.querySelectorAll('.why-card').forEach(el => {
    const match = el.dataset.scenario === state.scenario &&
                  el.dataset.frame    === state.frame;
    el.classList.toggle('hidden', !match);
  });
}

/* ── Frame label update ────────────────────────────────────── */

function updateFrameLabels() {
  const gBtn = document.getElementById('btn-frame-ground');
  const mBtn = document.getElementById('btn-frame-moving');
  if (state.scenario === 'muon') {
    gBtn.textContent = 'Earth frame';
    mBtn.textContent = 'Muon frame';
  } else {
    gBtn.textContent = 'Earth frame';
    mBtn.textContent = 'Ship frame';
  }
}

/* ═══════════════════════════════════════════════════════════
   DRAWING
═══════════════════════════════════════════════════════════ */

/* ── Shared drawing utilities ──────────────────────────────── */

function drawPanel(x, y, w, h, fill, stroke) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  ctx.restore();
}

function drawLabel(text, x, y, opts = {}) {
  ctx.save();
  ctx.font      = opts.font  || '700 14px "Trebuchet MS", sans-serif';
  ctx.fillStyle = opts.color || '#15304d';
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawBracket(x1, x2, y, color, label, above) {
  // horizontal bracket with label, above = true means text above the line
  const yt = above ? y - 10 : y + 18;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  // tick left
  ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5);
  // main line
  ctx.moveTo(x1, y); ctx.lineTo(x2, y);
  // tick right
  ctx.moveTo(x2, y - 5); ctx.lineTo(x2, y + 5);
  ctx.stroke();
  drawLabel(label, (x1 + x2) / 2, yt, { color, font: '700 12px "Trebuchet MS", sans-serif' });
  ctx.restore();
}

function drawVBracket(x, y1, y2, color, label) {
  // vertical bracket on left side with label to right
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(x - 5, y1); ctx.lineTo(x + 5, y1);
  ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  ctx.moveTo(x - 5, y2); ctx.lineTo(x + 5, y2);
  ctx.stroke();
  ctx.save();
  ctx.translate(x - 18, (y1 + y2) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '700 12px "Trebuchet MS", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawArrow(x1, y1, x2, y2, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const hs = 10;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hs * Math.cos(angle - 0.4), y2 - hs * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - hs * Math.cos(angle + 0.4), y2 - hs * Math.sin(angle + 0.4));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ── Background sky / space ────────────────────────────────── */

function drawSky(muon) {
  if (muon) {
    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0,   '#0a1628');
    grad.addColorStop(0.4, '#1a3a6e');
    grad.addColorStop(1,   '#3a7d44');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);
  } else {
    // Space
    ctx.fillStyle = '#06091a';
    ctx.fillRect(0, 0, CW, CH);
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const stars = [[80,40],[200,90],[340,30],[500,70],[650,20],[800,55],[900,80],
                   [130,200],[420,180],[720,160],[870,220],[50,300],[600,310]];
    stars.forEach(([sx, sy]) => { ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, 2*Math.PI); ctx.fill(); });
  }
}

/* ══════════════════════════════════════════════════════════
   MUON SCENARIO
══════════════════════════════════════════════════════════ */

function drawMuonGroundFrame(t) {
  // Earth frame: muon falls through full-height atmosphere
  drawSky(true);

  const b = MUON_BETA;
  const g = gamma(b);

  // Layout
  const ATMO_TOP    = 60;
  const GROUND      = 480;
  const ATMO_H      = GROUND - ATMO_TOP;      // proper length in pixels
  const MX          = CW / 2;                 // x column for muon

  // --- Atmosphere layers ---
  // Upper atmosphere / space transition
  const atmoGrad = ctx.createLinearGradient(0, ATMO_TOP, 0, GROUND);
  atmoGrad.addColorStop(0,   'rgba(26,58,110,0.0)');
  atmoGrad.addColorStop(0.3, 'rgba(60,110,200,0.15)');
  atmoGrad.addColorStop(1,   'rgba(58,125,68,0.5)');
  ctx.fillStyle = atmoGrad;
  ctx.fillRect(0, ATMO_TOP, CW, ATMO_H);

  // Ground strip
  ctx.fillStyle = '#3a7d44';
  ctx.fillRect(0, GROUND, CW, CH - GROUND);
  ctx.fillStyle = '#2d6135';
  ctx.fillRect(0, GROUND, CW, 6);
  drawLabel('Sea level (Earth surface)', MX, GROUND + 16, { color: '#c8f5d0', font: '700 13px "Trebuchet MS", sans-serif' });

  // Atmosphere top label
  drawLabel('Upper atmosphere  (10 km)', MX, ATMO_TOP - 16, { color: '#a8c4ff', font: '700 13px "Trebuchet MS", sans-serif' });

  // Proper length bracket (right side)
  drawVBracket(CW - 55, ATMO_TOP, GROUND, '#16a34a', 'L₀ = 10 km  (proper)');

  // --- Muon position ---
  const muonY = lerp(ATMO_TOP, GROUND, t);

  // Muon trail
  const trailGrad = ctx.createLinearGradient(MX, muonY - 80, MX, muonY);
  trailGrad.addColorStop(0,   'rgba(255,80,60,0)');
  trailGrad.addColorStop(1,   'rgba(255,80,60,0.5)');
  ctx.strokeStyle = trailGrad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MX, Math.max(ATMO_TOP, muonY - 80));
  ctx.lineTo(MX, muonY);
  ctx.stroke();

  // Muon circle
  ctx.save();
  ctx.shadowColor = 'rgba(255,80,60,0.7)';
  ctx.shadowBlur  = 18;
  ctx.beginPath();
  ctx.arc(MX, muonY, 14, 0, 2 * Math.PI);
  ctx.fillStyle = '#ff4040';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  drawLabel('μ', MX, muonY, { color: 'white', font: 'bold 14px serif' });

  // Arrow showing motion
  if (muonY < GROUND - 30) drawArrow(MX + 22, muonY + 5, MX + 22, muonY + 40, '#ff6040');

  // --- Clock showing dilated time ---
  const tau0_us = MUON_TAU0 * 1e6;
  const tDil_us = tau0_us * g;
  const elapsed_us = tDil_us * t;

  drawObserverClock(CW - 150, 200, elapsed_us, tDil_us, 'Earth clock', '#2563eb', false);

  // Annotation: dilated time
  drawPanel(40, 350, 200, 70, 'rgba(255,255,255,0.88)', 'rgba(21,48,77,0.15)');
  drawLabel('Observed time:', 140, 370, { font: '700 12px "Trebuchet MS", sans-serif', color: '#55708d' });
  drawLabel(`t = γτ₀ = ${fmt(tDil_us, 2)} μs`, 140, 390, { font: '700 14px "Trebuchet MS", sans-serif', color: '#d97706' });
  drawLabel('(dilated)', 140, 408, { font: '13px "Trebuchet MS", sans-serif', color: '#d97706' });
}

function drawMuonMovingFrame(t) {
  // Muon frame: muon is stationary, atmosphere rushes UP past it
  drawSky(true);

  const b = MUON_BETA;
  const g = gamma(b);

  const ATMO_H_FULL = 420;  // pixel height of full (proper) atmosphere off-screen
  const ATMO_H_CON  = ATMO_H_FULL / g; // contracted atmosphere height in pixels
  const MX          = CW / 2;
  const MUON_Y      = 260;  // muon stays here

  // The atmosphere block moves upward — starts below, ends above
  const ATMO_BOTTOM_START = CH + 20;
  const ATMO_BOTTOM_END   = MUON_Y - 10;
  const atmoBottom = lerp(ATMO_BOTTOM_START, ATMO_BOTTOM_END, t);
  const atmoTop    = atmoBottom - ATMO_H_CON;

  // Draw atmosphere block that passes muon
  const atmoGrad = ctx.createLinearGradient(0, atmoTop, 0, atmoBottom);
  atmoGrad.addColorStop(0,   'rgba(26,58,110,0.0)');
  atmoGrad.addColorStop(0.3, 'rgba(60,110,200,0.18)');
  atmoGrad.addColorStop(1,   'rgba(58,125,68,0.55)');
  ctx.fillStyle = atmoGrad;
  ctx.fillRect(0, Math.max(0, atmoTop), CW, Math.min(CH, atmoBottom) - Math.max(0, atmoTop));

  // Ground (bottom of atmosphere slab) — moves with it
  if (atmoBottom > 0 && atmoBottom < CH) {
    ctx.fillStyle = '#3a7d44';
    ctx.fillRect(0, atmoBottom, CW, 8);
    ctx.fillStyle = '#2d6135';
    ctx.fillRect(0, atmoBottom, CW, 3);
    drawLabel('Sea level', MX, atmoBottom + 18, { color: '#c8f5d0', font: '700 13px "Trebuchet MS", sans-serif' });
  }

  // Upper atmosphere edge
  if (atmoTop > 0 && atmoTop < CH) {
    drawLabel('Upper atmosphere', MX, atmoTop - 14, { color: '#a8c4ff', font: '700 13px "Trebuchet MS", sans-serif' });
  }

  // Contracted length bracket (right side, only when whole slab visible)
  if (atmoTop > 10 && atmoBottom < CH - 10) {
    drawVBracket(CW - 55, atmoTop, atmoBottom, '#d97706', `L = L₀/γ = ${fmt(MUON_L0_KM / g, 1)} km`);
  }

  // Muon — stationary
  ctx.save();
  ctx.shadowColor = 'rgba(255,80,60,0.7)';
  ctx.shadowBlur  = 18;
  ctx.beginPath();
  ctx.arc(MX, MUON_Y, 14, 0, 2 * Math.PI);
  ctx.fillStyle = '#ff4040';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  drawLabel('μ', MX, MUON_Y, { color: 'white', font: 'bold 14px serif' });
  drawLabel('(at rest)', MX, MUON_Y + 26, { color: '#ffa0a0', font: '13px "Trebuchet MS", sans-serif' });

  // Arrow showing atmosphere moving up
  const arrowY = Math.min(CH - 60, atmoBottom + 30);
  if (arrowY > MUON_Y + 40 && arrowY < CH - 20) {
    drawArrow(MX + 22, arrowY + 30, MX + 22, arrowY - 10, '#a8c4ff');
    drawLabel('atmosphere', MX + 60, arrowY + 10, { color: '#a8c4ff', font: '13px "Trebuchet MS", sans-serif', align: 'left' });
  }

  // Proper time clock
  const tau0_us = MUON_TAU0 * 1e6;
  const elapsed_us = tau0_us * t;
  drawObserverClock(CW - 150, 170, elapsed_us, tau0_us, 'Muon clock', '#ff4040', true);

  // Annotation: proper time
  drawPanel(40, 350, 200, 70, 'rgba(255,255,255,0.88)', 'rgba(21,48,77,0.15)');
  drawLabel('Proper lifetime:', 140, 370, { font: '700 12px "Trebuchet MS", sans-serif', color: '#55708d' });
  drawLabel(`τ₀ = ${fmt(tau0_us, 3)} μs`, 140, 390, { font: '700 14px "Trebuchet MS", sans-serif', color: '#16a34a' });
  drawLabel('(proper)', 140, 408, { font: '13px "Trebuchet MS", sans-serif', color: '#16a34a' });
}

/* ── Simple analogue clock readout ─────────────────────────── */
function drawObserverClock(cx, cy, elapsed, total, label, accentCol, proper) {
  const R  = 38;
  drawPanel(cx - R - 14, cy - R - 30, (R + 14) * 2, (R + 14) * 2 + 50,
    'rgba(255,255,255,0.92)', 'rgba(21,48,77,0.15)');

  // clock face
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = '#f8faff';
  ctx.fill();
  ctx.strokeStyle = accentCol;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // hand — sweeps once from top over the animation
  const frac  = Math.min(elapsed / total, 1);
  const angle = -Math.PI / 2 + frac * 2 * Math.PI;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (R - 6) * Math.cos(angle), cy + (R - 6) * Math.sin(angle));
  ctx.strokeStyle = accentCol;
  ctx.lineWidth = 3;
  ctx.stroke();

  // centre dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI);
  ctx.fillStyle = accentCol;
  ctx.fill();
  ctx.restore();

  // label below
  drawLabel(label, cx, cy + R + 14, { font: '700 12px "Trebuchet MS", sans-serif', color: '#55708d' });
  const badge = proper ? 'proper' : 'dilated';
  const badgeCol = proper ? '#16a34a' : '#d97706';
  drawLabel(badge, cx, cy + R + 30, { font: '700 11px "Trebuchet MS", sans-serif', color: badgeCol });
}

/* ══════════════════════════════════════════════════════════
   SHIP SCENARIO
══════════════════════════════════════════════════════════ */

// Star positions for scrolling background
const BG_STARS = Array.from({length: 40}, (_, i) => ({
  x: (i * 137.5) % CW,
  y: 30 + ((i * 91) % (CH - 100)),
  r: 0.8 + (i % 3) * 0.7
}));

function drawShipGroundFrame(t) {
  drawSky(false);

  const b = state.beta;
  const g = gamma(b);

  // Planets — fixed (Earth left, Neptune right)
  const EARTH_X   = 80;
  const NEPTUNE_X = 880;
  const LANE_Y    = 300;

  // Route line (proper length)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 12]);
  ctx.beginPath();
  ctx.moveTo(EARTH_X, LANE_Y);
  ctx.lineTo(NEPTUNE_X, LANE_Y);
  ctx.stroke();
  ctx.restore();

  drawPlanet(EARTH_X, LANE_Y, 28, '#2463e8', '#4da0ff', 'Earth');
  drawPlanet(NEPTUNE_X, LANE_Y, 24, '#1e44c8', '#6080ff', 'Neptune');

  // Proper length bracket
  drawBracket(EARTH_X, NEPTUNE_X, LANE_Y + 60, '#16a34a', `L₀ = ${fmt(SHIP_L0_AU, 1)} AU  (proper)`, false);

  // Ship position — travels at constant speed, coasts past Neptune
  const shipX = (EARTH_X + 40) + t * (NEPTUNE_X - EARTH_X);

  drawSpaceship(shipX, LANE_Y - 30, false);
  if (shipX < CW + 60) drawArrow(shipX + 55, LANE_Y - 30, shipX + 90, LANE_Y - 30, '#ffd060');

  // Dilated time clock (top right)
  const L0_m  = SHIP_L0_AU * 1.496e11;
  const v_m_s = b * 2.998e8;
  const tDil  = L0_m / v_m_s;
  const tau0  = tDil / g;

  const elapsed = tDil * Math.min(t, 1);
  drawObserverClock(CW - 130, 110, elapsed, tDil, 'Earth clock', '#2563eb', false);

  // Annotation box
  const dispTime = fmtTimeShip(tDil);
  drawPanel(40, 160, 210, 80, 'rgba(255,255,255,0.88)', 'rgba(21,48,77,0.15)');
  drawLabel('Travel time (Earth):', 145, 180, { font: '700 12px "Trebuchet MS",sans-serif', color: '#55708d' });
  drawLabel(`t = L₀/v = ${dispTime}`, 145, 200, { font: '700 13px "Trebuchet MS",sans-serif', color: '#d97706' });
  drawLabel('(dilated — ship clock runs slow)', 145, 220, { font: '12px "Trebuchet MS",sans-serif', color: '#d97706' });
}

function drawPlanetArc(px, surfaceCol, atmoCol, name, proximity, g) {
  // Draw a huge planetary arc rising from the bottom of the canvas at x = px.
  // proximity 0→1 controls alpha (1 = planet directly "below" the ship).
  // g = Lorentz factor: arc is contracted by 1/g along x (planet is moving in this frame).
  const alpha = Math.max(0, 1 - proximity);
  if (alpha < 0.02) return;

  const R  = 750;           // planet radius in px — large so only arc is visible
  const cy = CH + R - 110;  // arc centre (below canvas)

  ctx.save();
  ctx.globalAlpha = alpha;

  // Apply x-contraction: scale x by 1/g, then draw a circle at px*g
  // so it appears as a horizontally squished ellipse on screen.
  ctx.scale(1 / g, 1);
  const spx = px * g;

  const surfGrad = ctx.createRadialGradient(spx, cy, R * 0.5, spx, cy, R);
  surfGrad.addColorStop(0,   surfaceCol);
  surfGrad.addColorStop(0.9, surfaceCol);
  surfGrad.addColorStop(1,   atmoCol);
  ctx.beginPath();
  ctx.arc(spx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = surfGrad;
  ctx.fill();

  // Atmosphere halo
  ctx.globalAlpha = alpha * 0.35;
  ctx.beginPath();
  ctx.arc(spx, cy, R + 30, 0, 2 * Math.PI);
  ctx.lineWidth = 28;
  ctx.strokeStyle = atmoCol;
  ctx.stroke();

  ctx.restore();

  // Label drawn at unscaled screen position
  if (alpha > 0.15) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.8);
    drawLabel(name, px, Math.min(CH - 22, cy - R + 50),
              { color: 'white', font: '700 20px "Trebuchet MS", sans-serif' });
    ctx.restore();
  }
}

function drawShipMovingFrame(t) {
  // Ship frame: ship large and stationary, planets + stars scroll left
  drawSky(false);

  const b = state.beta;
  const g = gamma(b);

  const SHIP_X = CW / 2;
  const SHIP_Y = 210;

  // CON_PX: visual separation between planet arc centres.
  // Arc half-width on screen = sqrt(220*750 - 12100) / g ≈ 391/g px.
  // Require separation ≥ 2.8 × half-width so arcs never geometrically touch.
  // FADE_R kept below CON_PX/2 so one arc reaches alpha=0 before the other appears.
  const FULL_PX    = 700;
  const PHYS_CON   = FULL_PX / g;
  const arcHalfW   = 391 / g;                      // screen-space arc half-width
  const CON_PX     = Math.max(PHYS_CON, arcHalfW * 2.8);
  const FADE_R     = CON_PX * 0.52;                // fades out well before midpoint
  const SCROLL     = CON_PX * t;

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  BG_STARS.forEach(s => {
    const sx = ((s.x - SCROLL % CW) + CW * 4) % CW;
    ctx.beginPath();
    ctx.arc(sx, s.y, s.r, 0, 2 * Math.PI);
    ctx.fill();
  });

  // Planet x positions — both slide left at constant speed
  const earthX   = SHIP_X - CON_PX * t;
  const neptuneX = SHIP_X + CON_PX * (1 - t);

  drawPlanetArc(earthX,   '#1a52cc', '#80b4ff', 'Earth',   Math.abs(earthX   - SHIP_X) / FADE_R, g);
  drawPlanetArc(neptuneX, '#1a3aaa', '#5566ee', 'Neptune', Math.abs(neptuneX - SHIP_X) / FADE_R, g);

  // Contracted distance bracket between the two planet arcs (when both roughly on screen)
  if (earthX > 40 && neptuneX < CW - 40) {
    drawBracket(earthX, neptuneX, CH - 18, '#d97706',
                `L = L₀/γ = ${fmt(SHIP_L0_AU / g, 1)} AU  (contracted)`, true);
  }

  // Large stationary ship — 2.5× scale, centred
  drawSpaceship(SHIP_X, SHIP_Y, false, 2.5);
  drawLabel('at rest in this frame', SHIP_X, SHIP_Y + 62,
            { color: '#ffd090', font: '700 14px "Trebuchet MS",sans-serif' });

  // Proper time clock
  const v_m_s = b * 2.998e8;
  const tau0   = (SHIP_L0_AU * 1.496e11 / g) / v_m_s;
  const elapsed = tau0 * Math.min(t, 1);
  drawObserverClock(CW - 130, 110, elapsed, tau0, 'Ship clock', '#ea580c', true);

  // Annotation box
  drawPanel(40, 160, 210, 80, 'rgba(255,255,255,0.88)', 'rgba(21,48,77,0.15)');
  drawLabel('Travel time (ship):', 145, 180, { font: '700 12px "Trebuchet MS",sans-serif', color: '#55708d' });
  drawLabel(`τ₀ = t/γ = ${fmtTimeShip(tau0)}`, 145, 200, { font: '700 13px "Trebuchet MS",sans-serif', color: '#16a34a' });
  drawLabel('(proper — measured by ship)', 145, 220, { font: '12px "Trebuchet MS",sans-serif', color: '#16a34a' });
}

function fmtTimeShip(s) {
  if (s >= 3600) return `${(s/3600).toFixed(2)} h`;
  if (s >= 60)   return `${(s/60).toFixed(2)} min`;
  return `${s.toFixed(2)} s`;
}

function drawPlanet(x, y, r, innerCol, outerCol, name) {
  ctx.save();
  const grad = ctx.createRadialGradient(x - r*0.3, y - r*0.3, r*0.1, x, y, r);
  grad.addColorStop(0, outerCol);
  grad.addColorStop(1, innerCol);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
  drawLabel(name, x, y + r + 14, { color: '#a8c4ff', font: '700 13px "Trebuchet MS", sans-serif' });
}

function drawSpaceship(cx, cy, flipped, scale = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  if (flipped) ctx.scale(-scale, scale); else ctx.scale(scale, scale);

  // Body
  ctx.beginPath();
  ctx.moveTo(-50, 10);
  ctx.lineTo( 40,  0);
  ctx.lineTo(-50,-10);
  ctx.closePath();
  ctx.fillStyle = '#c8d8f0';
  ctx.fill();
  ctx.strokeStyle = '#8aaad0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cockpit
  ctx.beginPath();
  ctx.ellipse(10, 0, 14, 8, 0, 0, 2*Math.PI);
  ctx.fillStyle = '#7ec8e3';
  ctx.fill();

  // Engine glow
  ctx.beginPath();
  ctx.arc(-50, 0, 6, 0, 2*Math.PI);
  ctx.fillStyle = '#ffd060';
  ctx.fill();
  const glow = ctx.createRadialGradient(-55, 0, 0, -55, 0, 20);
  glow.addColorStop(0, 'rgba(255,200,60,0.6)');
  glow.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.beginPath();
  ctx.arc(-55, 0, 20, 0, 2*Math.PI);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════
   FRAME TITLE OVERLAY
══════════════════════════════════════════════════════════ */

function drawFrameTitle() {
  let line1, line2;
  if (state.scenario === 'muon') {
    if (state.frame === 'ground') {
      line1 = 'Earth Frame';
      line2 = 'Muon moves at β = 0.98c downward';
    } else {
      line1 = 'Muon Frame';
      line2 = 'Muon is at rest — atmosphere rushes past';
    }
  } else {
    const b = state.beta;
    if (state.frame === 'ground') {
      line1 = 'Earth Frame';
      line2 = `Ship moves at β = ${fmt(b, 2)}c toward Neptune`;
    } else {
      line1 = 'Ship Frame';
      line2 = 'Ship at rest — Neptune rushes toward it';
    }
  }

  // Top-left badge
  drawPanel(16, 16, 320, 56, 'rgba(255,255,255,0.88)', 'rgba(21,48,77,0.12)');
  drawLabel(line1, 26, 34, { align: 'left', font: '700 15px "Trebuchet MS", sans-serif', color: '#15304d' });
  drawLabel(line2, 26, 56, { align: 'left', font: '13px "Trebuchet MS", sans-serif', color: '#55708d' });
}

/* ── Main draw dispatch ────────────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, CW, CH);
  const t = state.animT;

  if (state.scenario === 'muon') {
    if (state.frame === 'ground') drawMuonGroundFrame(t);
    else                          drawMuonMovingFrame(t);
  } else {
    if (state.frame === 'ground') drawShipGroundFrame(t);
    else                          drawShipMovingFrame(t);
  }

  drawFrameTitle();
}

/* ══════════════════════════════════════════════════════════
   ANIMATION LOOP
══════════════════════════════════════════════════════════ */

let lastTs = null;

function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (state.running) {
    state.animT += dt / ANIM_DURATION;
    // Muon: stop when it hits the ground
    if (state.scenario === 'muon' && state.animT >= 1) {
      state.animT = 1;
      state.running = false;
      btnPlay.textContent = 'Play';
    }
    // Ship: coast off the canvas (stop a bit past the edge)
    if (state.scenario === 'ship' && state.animT >= 1.3) {
      state.animT = 1.3;
      state.running = false;
      btnPlay.textContent = 'Play';
    }
  }

  draw();
  updateReadouts();
  requestAnimationFrame(loop);
}

/* ══════════════════════════════════════════════════════════
   UI EVENTS
══════════════════════════════════════════════════════════ */

function setScenario(s) {
  state.scenario = s;
  state.beta = (s === 'muon') ? MUON_BETA : parseFloat(sliderBeta.value);
  state.animT = 0;
  groupSpeed.style.display = (s === 'ship') ? '' : 'none';
  updateFrameLabels();
  updateWhyCards();
  updateReadouts();

  // Sync seg buttons
  document.querySelectorAll('#seg-scenario .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === s);
  });
}

function setFrame(f) {
  state.frame = f;
  state.animT = 0;
  updateWhyCards();
  updateReadouts();

  document.querySelectorAll('#seg-frame .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === f);
  });
}

document.querySelectorAll('#seg-scenario .seg-btn').forEach(b => {
  b.addEventListener('click', () => setScenario(b.dataset.val));
});

document.querySelectorAll('#seg-frame .seg-btn').forEach(b => {
  b.addEventListener('click', () => setFrame(b.dataset.val));
});

btnPlay.addEventListener('click', () => {
  state.running = !state.running;
  btnPlay.textContent = state.running ? 'Pause' : 'Play';
});

btnReset.addEventListener('click', () => {
  state.animT = 0;
  state.running = true;
  btnPlay.textContent = 'Pause';
});

function applyBeta(b) {
  valBeta.value = fmt(b, 2);
  sliderBeta.value = b;
  if (state.scenario === 'ship') {
    state.beta = b;
    state.animT = 0;
  }
  updateReadouts();
}
sliderBeta.addEventListener('input', () => {
  applyBeta(parseFloat(sliderBeta.value));
});
valBeta.addEventListener('change', () => {
  const raw = parseFloat(valBeta.value);
  if (isNaN(raw)) { valBeta.value = fmt(parseFloat(sliderBeta.value), 2); return; }
  applyBeta(Math.max(0.1, Math.min(0.99, raw)));
});

/* ── Init ───────────────────────────────────────────────────── */

setScenario('muon');   // also hides speed slider
updateWhyCards();
requestAnimationFrame(loop);
