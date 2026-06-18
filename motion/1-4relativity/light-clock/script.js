/* ── Constants ─────────────────────────────────────────────── */

const CW = 960, CH = 560;

// Geometry: bottom & top mirrors, vertical separation L_PX.
const L_PX       = 220;
const Y_BOTTOM   = 420;
const Y_TOP      = Y_BOTTOM - L_PX;        // 200
const MIRROR_W   = 120;                    // visual mirror plate width

// Lab-frame layout
const X_START    = 110;                    // clock's bottom-mirror x at t = 0
const X_END      = CW - 80;                // wrap point

// Proper period at display c: T0 = 2L/c. Pick T0 = 2.0 s → display c = L_PX / 1 = 220 px/s.
const T0         = 2.0;                    // seconds
const DISP_C     = (2 * L_PX) / T0;        // 220 px/s

// Mirror-frame clock x
const MIRROR_X   = CW / 2;

/* ── State ─────────────────────────────────────────────────── */

const state = {
  frame:    'mirror',  // 'mirror' | 'lab'
  beta:     0.80,
  tFrame:   0,         // seconds in current frame's clock
  ticks:    0,         // cumulative full round-trips completed
  running:  true,
  showLabels:     true,
  showTrail:      true,
  showDerivation: false,
  pinTents:       false,
  pinnedTents:    [],   // {x_lo, y_lo, x_hi, y_hi}
  lastBounce:     0,
  lastWall: 0
};

/* ── DOM ───────────────────────────────────────────────────── */

const canvas  = document.getElementById('sim-canvas');
const ctx     = canvas.getContext('2d');
const btnPlay  = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const segFrame = document.getElementById('seg-frame');
const sliderBeta = document.getElementById('slider-beta');
const valBeta    = document.getElementById('val-beta');
const chkLabels     = document.getElementById('chk-labels');
const chkTrail      = document.getElementById('chk-trail');
const chkPin        = document.getElementById('chk-pin');
const chkDerivation = document.getElementById('chk-derivation');
const derivationPanel = document.getElementById('derivation-panel');
const whyCards = document.querySelectorAll('.why-card');

const roBeta  = document.getElementById('ro-beta');
const roGamma = document.getElementById('ro-gamma');
const roPeriod = document.getElementById('ro-period');
const roPeriodLabel = document.getElementById('ro-period-label');
const roTicks = document.getElementById('ro-ticks');

/* ── Helpers ───────────────────────────────────────────────── */

const gamma = b => 1 / Math.sqrt(1 - b * b);
const fmt   = (n, dp) => n.toFixed(dp);
const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function currentPeriod() {
  return state.frame === 'mirror' ? T0 : gamma(state.beta) * T0;
}

function frameReset() {
  state.tFrame = 0;
}

function fullReset() {
  state.tFrame = 0;
  state.ticks  = 0;
}

/* ── Photon position ───────────────────────────────────────── */

// Returns the bottom-mirror x position in the lab frame at lab time t.
function clockX(t) {
  const v = state.beta * DISP_C;
  return X_START + v * t;
}

// Returns photon (x, y) and the bounce index k it sits within (between bounce k and k+1).
function photonPos(t) {
  const T = currentPeriod();
  const half = T / 2;
  const k = Math.floor(t / half);
  const u = (t / half) - k;            // 0..1

  const y_k    = (k & 1) ? Y_TOP : Y_BOTTOM;
  const y_kp1  = (k & 1) ? Y_BOTTOM : Y_TOP;

  let x_k, x_kp1;
  if (state.frame === 'mirror') {
    x_k = x_kp1 = MIRROR_X;
  } else {
    x_k   = clockX(k * half);
    x_kp1 = clockX((k + 1) * half);
  }
  return {
    x: lerp(x_k, x_kp1, u),
    y: lerp(y_k, y_kp1, u),
    bounceIndex: k
  };
}

/* ── Drawing ───────────────────────────────────────────────── */

function drawMirror(x, y) {
  // Reflective plate centered on x at y
  ctx.fillStyle = '#1f4068';
  ctx.fillRect(x - MIRROR_W / 2, y - 4, MIRROR_W, 8);
  // hatching underside
  ctx.strokeStyle = 'rgba(31, 64, 104, 0.55)';
  ctx.lineWidth = 1;
  for (let i = -MIRROR_W / 2 + 6; i < MIRROR_W / 2; i += 10) {
    ctx.beginPath();
    if (y > CH / 2) {            // bottom mirror → ticks point down
      ctx.moveTo(x + i, y + 4);
      ctx.lineTo(x + i + 6, y + 12);
    } else {                      // top mirror → ticks point up
      ctx.moveTo(x + i, y - 4);
      ctx.lineTo(x + i + 6, y - 12);
    }
    ctx.stroke();
  }
}

// Draw a stacked fraction centred horizontally on x, with the vinculum at y.
function drawFraction(num, den, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px "Trebuchet MS", sans-serif`;
  const numW = ctx.measureText(num).width;
  const denW = ctx.measureText(den).width;
  const barW = Math.max(numW, denW) + 4;
  const gap  = size * 0.18;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(num, x, y - gap);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - barW / 2, y);
  ctx.lineTo(x + barW / 2, y);
  ctx.stroke();

  ctx.textBaseline = 'top';
  ctx.fillText(den, x, y + gap);
}

function drawArrowhead(x1, y1, x2, y2, size) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * size + px * size * 0.5, y2 - uy * size + py * size * 0.5);
  ctx.lineTo(x2 - ux * size - px * size * 0.5, y2 - uy * size - py * size * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawTrailMirror(t) {
  // Vertical line between mirrors at MIRROR_X. Photon's path is fixed.
  ctx.strokeStyle = 'rgba(217, 119, 6, 0.45)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(MIRROR_X, Y_TOP);
  ctx.lineTo(MIRROR_X, Y_BOTTOM);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTrailLab(t) {
  // Draw every bounce-segment from t=0 up to current t.
  const T = currentPeriod();
  const half = T / 2;
  const k_cur = Math.floor(t / half);

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  // First bounce point
  let x0 = clockX(0), y0 = Y_BOTTOM;
  ctx.moveTo(x0, y0);
  for (let k = 1; k <= k_cur; k++) {
    const xk = clockX(k * half);
    const yk = (k & 1) ? Y_TOP : Y_BOTTOM;
    ctx.lineTo(xk, yk);
  }
  // Current partial segment to photon position
  const photon = photonPos(t);
  ctx.lineTo(photon.x, photon.y);
  ctx.stroke();
}

function drawLabelsMirror() {
  // "L" beside the vertical path
  ctx.fillStyle = '#15304d';
  ctx.font = '600 18px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('L', MIRROR_X + 14, (Y_TOP + Y_BOTTOM) / 2);

  // Tiny brackets at mirror ends
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MIRROR_X + 6, Y_TOP);    ctx.lineTo(MIRROR_X + 14, Y_TOP);
  ctx.moveTo(MIRROR_X + 6, Y_BOTTOM); ctx.lineTo(MIRROR_X + 14, Y_BOTTOM);
  ctx.moveTo(MIRROR_X + 10, Y_TOP);   ctx.lineTo(MIRROR_X + 10, Y_BOTTOM);
  ctx.stroke();
}

function bounceGeometry(t) {
  const half = currentPeriod() / 2;
  const k = Math.floor(t / half);
  return {
    x_lo: clockX(k * half),
    x_hi: clockX((k + 1) * half),
    y_lo: (k & 1) ? Y_TOP    : Y_BOTTOM,
    y_hi: (k & 1) ? Y_BOTTOM : Y_TOP
  };
}

function drawTentFromGeom(g, opts = {}) {
  const alpha    = opts.alpha    ?? 0.85;
  const showLabels = opts.showLabels ?? true;
  const { x_lo, y_lo, x_hi, y_hi } = g;

  ctx.strokeStyle = `rgba(15, 118, 110, ${alpha})`;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x_lo, y_lo);
  ctx.lineTo(x_hi, y_lo);
  ctx.lineTo(x_hi, y_hi);
  ctx.stroke();
  ctx.setLineDash([]);

  // Right-angle marker
  const sgnY = y_hi < y_lo ? -1 : 1;
  const sgnX = x_hi > x_lo ? -1 : 1;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x_hi + sgnX * 12, y_lo);
  ctx.lineTo(x_hi + sgnX * 12, y_lo + sgnY * 12);
  ctx.lineTo(x_hi,            y_lo + sgnY * 12);
  ctx.stroke();

  if (!showLabels) return;

  const labelColor = `rgba(15, 118, 110, ${alpha})`;

  // "vt/2" beneath (or above) the horizontal leg
  const baseY = y_lo + (y_lo > CH / 2 ? 32 : -32);
  drawFraction('vt', '2', (x_lo + x_hi) / 2, baseY, 16, labelColor);

  // "L" beside the vertical leg (single character, no fraction)
  ctx.fillStyle = labelColor;
  ctx.font = '600 16px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('L', x_hi + 10, (y_lo + y_hi) / 2);

  // "ct/2" offset above the hypotenuse, perpendicular to its slope
  const mx = (x_lo + x_hi) / 2;
  const my = (y_lo + y_hi) / 2;
  const hdx = x_hi - x_lo, hdy = y_hi - y_lo;
  const hLen = Math.hypot(hdx, hdy) || 1;
  // Perpendicular offset away from the right-angle vertex at (x_hi, y_lo)
  const perpX = hdy / hLen;
  const perpY = -hdx / hLen;
  drawFraction('ct', '2', mx + perpX * 22, my + perpY * 22, 16, labelColor);
}

function drawTentTriangle(t) {
  drawTentFromGeom(bounceGeometry(t));
}

function drawPinnedTents() {
  // Older pins are drawn fainter; only the most recent few keep labels.
  const pins = state.pinnedTents;
  const n = pins.length;
  pins.forEach((g, i) => {
    const age = n - 1 - i;          // 0 = newest
    const alpha = Math.max(0.25, 0.7 - age * 0.08);
    drawTentFromGeom(g, { alpha, showLabels: age < 2 });
  });
}

function drawClockBody(xBottom) {
  drawMirror(xBottom, Y_BOTTOM);
  drawMirror(xBottom, Y_TOP);
}

function drawPhoton(x, y) {
  // Glow
  const grad = ctx.createRadialGradient(x, y, 1, x, y, 16);
  grad.addColorStop(0, 'rgba(253, 224, 71, 1)');
  grad.addColorStop(0.4, 'rgba(250, 204, 21, 0.7)');
  grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawVelocityArrow() {
  if (state.frame !== 'lab') return;
  const photon = photonPos(state.tFrame);
  const xClock = clockX(state.tFrame);
  // Arrow above the clock
  const y = Y_TOP - 50;
  const x1 = xClock - 36;
  const x2 = xClock + 36;
  ctx.strokeStyle = '#1f4068';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.fillStyle = '#1f4068';
  drawArrowhead(x1, y, x2, y, 10);
  ctx.font = '600 15px "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#15304d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`v = ${fmt(state.beta, 2)} c`, xClock, y - 6);
}

function drawAxisGround() {
  if (state.frame !== 'lab') return;
  // Faint horizontal ground line
  ctx.strokeStyle = 'rgba(21, 48, 77, 0.15)';
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, Y_BOTTOM + 50);
  ctx.lineTo(CW - 40, Y_BOTTOM + 50);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(85, 112, 141, 0.85)';
  ctx.font = '600 12px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('lab frame (you are at rest)', 50, Y_BOTTOM + 50);
}

function drawFrameTag() {
  ctx.fillStyle = 'rgba(21, 48, 77, 0.85)';
  ctx.font = '700 13px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const tag = state.frame === 'mirror'
    ? 'MIRROR (REST) FRAME — clock stationary'
    : 'LAB FRAME — clock drifts at v';
  ctx.fillText(tag, 24, 22);
}

function draw() {
  ctx.clearRect(0, 0, CW, CH);
  drawAxisGround();
  drawFrameTag();

  const t = state.tFrame;
  const xClock = state.frame === 'mirror' ? MIRROR_X : clockX(t);
  const photon = photonPos(t);

  // Photon trail under everything
  if (state.showTrail) {
    if (state.frame === 'mirror') drawTrailMirror(t);
    else                          drawTrailLab(t);
  }

  // Pinned tent snapshots (drawn beneath the live overlay)
  if (state.frame === 'lab' && state.pinTents && state.pinnedTents.length) {
    drawPinnedTents();
  }

  // Right-triangle overlay (lab frame only, when labels are on)
  if (state.showLabels && state.frame === 'lab') {
    drawTentTriangle(t);
  }

  // Clock (mirrors)
  drawClockBody(xClock);

  // Velocity arrow on clock (lab frame only)
  drawVelocityArrow();

  // Photon
  drawPhoton(photon.x, photon.y);

  // Mirror-frame labels
  if (state.showLabels && state.frame === 'mirror') {
    drawLabelsMirror();
  }
}

/* ── Loop ──────────────────────────────────────────────────── */

function tick(now) {
  const wall = now * 0.001;
  const dt = clamp(wall - state.lastWall, 0, 0.05);
  state.lastWall = wall;

  if (state.running) {
    state.tFrame += dt;

    // Tick counter (cumulative across lab-frame wraps)
    const T = currentPeriod();
    state.ticks = state.ticksBase + Math.floor(state.tFrame / T);

    // Snapshot the just-completed half-period tent when a bounce occurs.
    if (state.frame === 'lab' && state.pinTents) {
      const half = T / 2;
      const k = Math.floor(state.tFrame / half);
      while (state.lastBounce < k) {
        const half_t = state.lastBounce * half;
        state.pinnedTents.push({
          x_lo: clockX(half_t),
          x_hi: clockX(half_t + half),
          y_lo: (state.lastBounce & 1) ? Y_TOP    : Y_BOTTOM,
          y_hi: (state.lastBounce & 1) ? Y_BOTTOM : Y_TOP
        });
        state.lastBounce++;
      }
    }

    // Lab-frame edge behaviour: wrap by default, but pause when pins are on
    // so the assembled diagram stays put for discussion.
    if (state.frame === 'lab' && clockX(state.tFrame) > X_END) {
      if (state.pinTents) {
        state.tFrame = (X_END - X_START) / (state.beta * DISP_C);
        state.running = false;
        btnPlay.textContent = 'Play';
      } else {
        state.ticksBase = state.ticks;
        state.tFrame = 0;
        state.lastBounce = 0;
      }
    }
  }

  updateReadouts();
  draw();
  requestAnimationFrame(tick);
}

/* ── Readouts ──────────────────────────────────────────────── */

function updateReadouts() {
  const b = state.beta;
  const g = gamma(b);
  roBeta.textContent  = fmt(b, 2);
  roGamma.textContent = fmt(g, 3);

  if (state.frame === 'mirror') {
    roPeriodLabel.textContent = 'Tick period (proper)';
    roPeriod.innerHTML = `T<sub>0</sub> = ${fmt(T0, 2)} s <span class="tag tag-proper">proper</span>`;
  } else {
    roPeriodLabel.textContent = 'Tick period (dilated)';
    roPeriod.innerHTML = `t = ${fmt(g * T0, 3)} s <span class="tag tag-dilated">dilated</span>`;
  }
  roTicks.textContent = state.ticks;
}

/* ── Events ────────────────────────────────────────────────── */

btnPlay.addEventListener('click', () => {
  state.running = !state.running;
  btnPlay.textContent = state.running ? 'Pause' : 'Play';
});

function resetTimeline() {
  state.tFrame = 0;
  state.ticks = 0;
  state.ticksBase = 0;
  state.lastBounce = 0;
  state.pinnedTents = [];
}

btnReset.addEventListener('click', resetTimeline);

segFrame.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const val = btn.dataset.val;
  if (val === state.frame) return;
  state.frame = val;
  segFrame.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
  // Switching frames resets the local timeline + ticks for clarity.
  resetTimeline();
  // Update why card
  whyCards.forEach(c => c.classList.toggle('hidden', c.dataset.frame !== val));
});

function applyBeta(v) {
  v = clamp(parseFloat(v), 0.10, 0.99);
  if (Number.isNaN(v)) return;
  state.beta = v;
  sliderBeta.value = v;
  valBeta.value = v.toFixed(2);
  // Restart timeline so the geometry updates cleanly.
  resetTimeline();
}

sliderBeta.addEventListener('input', e => applyBeta(e.target.value));
valBeta.addEventListener('change', e => applyBeta(e.target.value));

chkLabels.addEventListener('change', e => { state.showLabels = e.target.checked; });
chkTrail.addEventListener('change',  e => { state.showTrail  = e.target.checked; });
chkPin.addEventListener('change', e => {
  state.pinTents = e.target.checked;
  if (!state.pinTents) state.pinnedTents = [];
  state.lastBounce = Math.floor(state.tFrame / (currentPeriod() / 2));
});
chkDerivation.addEventListener('change', e => {
  state.showDerivation = e.target.checked;
  derivationPanel.classList.toggle('hidden', !state.showDerivation);
  if (state.showDerivation && window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([derivationPanel]);
  }
});

/* ── Boot ──────────────────────────────────────────────────── */

state.ticksBase = 0;
applyBeta(state.beta);
updateReadouts();
state.lastWall = performance.now() * 0.001;
requestAnimationFrame(tick);
