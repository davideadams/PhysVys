'use strict';

/* ════════════════════════════════════════════════════════════════════
   MUON DECAY — Frisch & Smith 1963 re-creation
   Three phases: Mt Washington collection, sea-level playback, analysis.
   ════════════════════════════════════════════════════════════════════ */

// ── Physics constants ────────────────────────────────────────────────
const MT_ALTITUDE     = 1910;          // m
const MUON_SPEED      = 0.994 * 3e8;   // m / s  (β chosen so γ ≈ 9, matching N_sea/N_mtn)
const MEAN_LIFETIME   = 2.2e-6;        // s (rest-frame)
const MOUNTAIN_RATE   = 568;           // per hour, nominal
const SEA_RATE        = 412;           // per hour, nominal
const MIN_COLLECT_MS  = 5 * 60 * 1000; // 5 minutes
const PLAYBACK_SPEED  = 20;            // phase-2 playback multiplier
const CRO_T_MAX_US    = 6;             // CRO trace covers 0–6 μs

// Per-session random factor (±10 %), applied to both rates so they stay
// correlated — in the real experiment mountain and sea-level fluctuations
// share meteorological/atmospheric causes.
const RATE_FACTOR = 0.9 + Math.random() * 0.2;
const mountainRatePerHour = MOUNTAIN_RATE * RATE_FACTOR;
const seaRatePerHour      = SEA_RATE      * RATE_FACTOR;

// ── DOM refs ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const scintillator      = $('scintillator');
const scintillator2     = $('scintillator-2');
const stopwatchEl       = $('stopwatch');
const stopwatch2El      = $('stopwatch-2');
const arrivedCountEl    = $('arrived-count');
const arrivedCount2El   = $('arrived-count-2');
const queueCountEl      = $('queue-count');
const btnStop           = $('btn-stop');
const stopHint          = $('stop-hint');
const btnNext1          = $('btn-next-1');
const btnNext2          = $('btn-next-2');
const phaseNavHint1     = $('phase-nav-hint-1');
const phaseNavHint2     = $('phase-nav-hint-2');
const croActiveWrap     = $('cro-active-wrap');
const croActive2Wrap    = $('cro-active-wrap-2');
const croEmpty          = $('cro-empty');
const croConfirmedList  = $('cro-confirmed-list');
const confirmedCountInline = $('confirmed-count-inline');
const summaryTime1      = $('summary-time-1');
const summaryN1         = $('summary-n-1');
const summaryRate1      = $('summary-rate-1');
const summaryTime2      = $('summary-time-2');
const summaryN2         = $('summary-n-2');
const summaryRate2      = $('summary-rate-2');
const summaryRow2       = $('summary-row-2');
const detailTbody       = $('detail-tbody');
const playbackBar       = $('playback-bar');
const altitudeCanvas    = $('altitude-canvas');
const tallyMountain     = $('tally-mountain');
const tallySea          = $('tally-sea');
const btnNext3          = $('btn-next-3');
// Phase 4 refs
const effdistCanvas     = $('effdist-canvas');
const effNmtn           = $('eff-n-mtn');
const effNsea           = $('eff-n-sea');
const effSurvival       = $('eff-survival');
const effMeanT          = $('eff-mean-t');
const effInlineNmtn     = $('eff-inline-nmtn');
const effInlineT        = $('eff-inline-t');
const effInlineFrac     = $('eff-inline-frac');
const effSlider         = $('eff-slider');
const effSliderVal      = $('eff-slider-val');
const effPredictedFrac  = $('eff-predicted-frac');
const effMeasuredFrac   = $('eff-measured-frac');
const effSnapBtn        = $('eff-snap-btn');
const gammaRatio        = $('gamma-ratio');
const modalBackdrop     = $('modal-backdrop');
const modalTitle        = $('modal-title');
const modalBody         = $('modal-body');
const modalContinue     = $('modal-continue');

// ── Experiment state ─────────────────────────────────────────────────
const state = {
  phase: 1,
  collecting: false,
  phase1StartMs: 0,          // wall-clock ms when collection started
  phase1DurationMs: 0,       // final elapsed ms (locked when stopped)
  nextArrivalMs: 0,          // scheduled wall-clock ms for next arrival
  queue: [],                 // waiting-to-be-processed: [{id, decayTimeUs}]
  activeMuon: null,          // currently showing on CRO: {id, decayTimeUs}
  confirmed: [],             // in order of confirmation: [{id, decayTimeUs}]
  muonIdCounter: 0,
  phase2: {
    running: false,
    startMs: 0,               // wall-clock start of playback
    durationMs: 0,            // playback duration (= phase1Duration / 20)
    nextArrivalSimMs: 0,      // next arrival in sea-level sim time
    count: 0,
    rate: seaRatePerHour,
  },
};

/* ════════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════════ */

// Exponential-distribution sample with given mean.
function sampleExponential(mean) {
  // -mean * ln(U), U in (0,1]; avoid log(0)
  const u = 1 - Math.random();
  return -mean * Math.log(u);
}

// Format ms as M:SS or MM:SS.
function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Format seconds/ms as H:MM:SS or M:SS for the summary table.
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

function flashScintillator(el) {
  el.classList.remove('flash');
  // force reflow to restart the transition
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 120);
}

/* ════════════════════════════════════════════════════════════════════
   CRO TRACE RENDERING
   Canvas drawing: flat baseline, vertical spike at the decay time.
   ════════════════════════════════════════════════════════════════════ */

function drawCROTrace(canvas, decayTimeUs, options = {}) {
  const { active = false } = options;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Plot margins (inside canvas pixel dimensions)
  const M_L = 40, M_R = 20, M_T = 14, M_B = 28;
  const plotW = W - M_L - M_R;
  const plotH = H - M_T - M_B;
  const baselineY = M_T + plotH - 14;     // baseline sits ~near the bottom of the plot
  const spikeTopY = M_T + 6;              // top of spike — near top of plot

  ctx.clearRect(0, 0, W, H);

  // Plot background
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(M_L, M_T, plotW, plotH);

  // Grid — minor every 0.2 μs, major every 1 μs
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(190,220,255,0.22)';
  for (let t = 0; t <= CRO_T_MAX_US; t += 0.2) {
    if (Math.abs((t * 10) % 10) < 0.001) continue; // skip majors, drawn next
    const x = M_L + (t / CRO_T_MAX_US) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, M_T);
    ctx.lineTo(x, M_T + plotH);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(190,220,255,0.48)';
  ctx.lineWidth = 1.2;
  for (let t = 0; t <= CRO_T_MAX_US; t += 1) {
    const x = M_L + (t / CRO_T_MAX_US) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, M_T);
    ctx.lineTo(x, M_T + plotH);
    ctx.stroke();
  }
  // horizontal baseline grid
  ctx.strokeStyle = 'rgba(190,220,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M_L, baselineY);
  ctx.lineTo(M_L + plotW, baselineY);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = 'rgba(203,213,225,0.75)';
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = 0; t <= CRO_T_MAX_US; t += 1) {
    const x = M_L + (t / CRO_T_MAX_US) * plotW;
    ctx.fillText(t.toFixed(0), x, M_T + plotH + 4);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('μs', M_L + plotW, M_T + plotH + 16);
  ctx.textAlign = 'left';
  ctx.fillText('V', M_L - 28, M_T + plotH / 2);

  // ── Trace ───────────────────────────────────────────────────────
  const traceColour    = active ? '#4ade80' : 'rgba(120,160,140,0.65)';
  const traceWidth     = active ? 2 : 1.4;
  const glowColour     = active ? 'rgba(74,222,128,0.55)' : null;

  ctx.strokeStyle = traceColour;
  ctx.lineWidth   = traceWidth;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  if (glowColour) {
    ctx.shadowColor = glowColour;
    ctx.shadowBlur  = 6;
  }

  const spikeX    = M_L + Math.min(Math.max(decayTimeUs / CRO_T_MAX_US, 0), 1) * plotW;
  const spikeWidth = 2; // canvas px of the vertical portion

  ctx.beginPath();
  ctx.moveTo(M_L, baselineY);
  ctx.lineTo(spikeX - spikeWidth, baselineY);
  ctx.lineTo(spikeX - spikeWidth, spikeTopY);
  ctx.lineTo(spikeX + spikeWidth, spikeTopY);
  ctx.lineTo(spikeX + spikeWidth, baselineY);
  ctx.lineTo(M_L + plotW, baselineY);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

/* ════════════════════════════════════════════════════════════════════
   CRO DOM — active trace + confirmed list
   ════════════════════════════════════════════════════════════════════ */

let activeTraceEl = null;      // DOM element for the current active trace
let activeInputEl = null;
let activeConfirmBtn = null;

function buildActiveTraceDOM(muon) {
  const wrap = document.createElement('div');
  wrap.className = 'cro-trace active';
  wrap.innerHTML = `
    <div class="cro-trace-head">
      <span class="cro-trace-n">Muon #${muon.id}</span>
      <span class="cro-trace-status">Awaiting entry…</span>
    </div>
    <canvas class="cro-trace-canvas" width="720" height="170"
            aria-label="CRO trace showing decay spike"></canvas>
    <div class="cro-input-row">
      <label for="cro-input-${muon.id}">Decay time (μs):</label>
      <input class="cro-input" id="cro-input-${muon.id}" type="number"
             step="0.1" min="0" max="6" inputmode="decimal"
             placeholder="e.g. 1.7">
      <button class="cro-confirm-btn" type="button">Confirm</button>
    </div>
  `;
  const canvas = wrap.querySelector('canvas');
  drawCROTrace(canvas, muon.decayTimeUs, { active: true });

  const input = wrap.querySelector('input');
  const btn   = wrap.querySelector('button');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); tryConfirmActive(); }
  });
  btn.addEventListener('click', tryConfirmActive);

  return { wrap, input, btn };
}

function buildConfirmedTraceDOM(muon, enteredValueUs) {
  const wrap = document.createElement('div');
  wrap.className = 'cro-trace confirmed';
  wrap.innerHTML = `
    <div class="cro-trace-head">
      <span class="cro-trace-n">#${muon.id}</span>
      <span class="cro-trace-confirmed-val">${enteredValueUs.toFixed(2)} μs</span>
    </div>
    <canvas class="cro-trace-canvas" width="720" height="90"></canvas>
  `;
  const canvas = wrap.querySelector('canvas');
  drawCROTrace(canvas, muon.decayTimeUs, { active: false });
  return wrap;
}

function tryConfirmActive() {
  if (!state.activeMuon || !activeInputEl) return;
  const raw = activeInputEl.value.trim();
  if (raw === '') return;
  const val = parseFloat(raw);
  if (!Number.isFinite(val)) return;

  const muon = state.activeMuon;
  const entered = val;

  // Log — we store the entered value (the student's reading), not the true value.
  // The prompt says: "trust the student". The entered value is what drives the
  // Phase 3 visualisation too, since that is the value the student measured.
  state.confirmed.push({ id: muon.id, decayTimeUs: entered });

  // Update detail table
  appendDetailRow(muon.id, entered);
  updateSummaryPhase1();
  updateConfirmedCountInline();

  // Replace the active DOM with a confirmed row, prepended to confirmed list
  if (activeTraceEl && activeTraceEl.parentNode) {
    activeTraceEl.parentNode.removeChild(activeTraceEl);
  }
  const confirmedNode = buildConfirmedTraceDOM(muon, entered);
  croConfirmedList.insertBefore(confirmedNode, croConfirmedList.firstChild);

  state.activeMuon = null;
  activeTraceEl = activeInputEl = activeConfirmBtn = null;

  promoteNextFromQueue();
  updatePhase1NavState();
}

function promoteNextFromQueue() {
  if (state.activeMuon) return;
  if (state.queue.length === 0) {
    // Show empty placeholder only if we are still collecting or if queue truly empty
    showCROEmpty();
    return;
  }
  const muon = state.queue.shift();
  state.activeMuon = muon;
  const { wrap, input, btn } = buildActiveTraceDOM(muon);
  activeTraceEl = wrap;
  activeInputEl = input;
  activeConfirmBtn = btn;
  hideCROEmpty();
  croActiveWrap.appendChild(wrap);
  input.focus();
  renderQueueCount();
}

function showCROEmpty() {
  if (!croEmpty.parentNode) {
    croActiveWrap.appendChild(croEmpty);
  }
  if (state.collecting) {
    croEmpty.textContent = 'Waiting for the next muon…';
  } else if (state.phase === 1 && state.queue.length === 0 && !state.activeMuon) {
    croEmpty.textContent = 'All traces confirmed. Ready to proceed.';
  }
}

function hideCROEmpty() {
  if (croEmpty.parentNode) croEmpty.parentNode.removeChild(croEmpty);
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 1 — Mt Washington collection loop
   ════════════════════════════════════════════════════════════════════ */

function startPhase1() {
  state.phase = 1;
  state.collecting = true;
  state.phase1StartMs = performance.now();
  // Schedule first arrival — average inter-arrival time in ms
  const meanInterMs = 3.6e6 / mountainRatePerHour;  // 3.6e6 ms/hr
  state.nextArrivalMs = state.phase1StartMs + sampleExponential(meanInterMs);
  state.queue = [];
  state.confirmed = [];
  state.activeMuon = null;
  state.muonIdCounter = 0;

  updatePhase1Clocks();
  showCROEmpty();
  renderQueueCount();
  updateConfirmedCountInline();
  requestAnimationFrame(phase1Tick);
}

function phase1Tick(now) {
  if (state.phase !== 1) return;

  // Arrivals keep happening while collecting
  if (state.collecting) {
    while (now >= state.nextArrivalMs) {
      spawnArrival(state.nextArrivalMs);
      const meanInterMs = 3.6e6 / mountainRatePerHour;
      state.nextArrivalMs += sampleExponential(meanInterMs);
    }
    // Stop button eligibility
    const elapsed = now - state.phase1StartMs;
    if (elapsed >= MIN_COLLECT_MS && btnStop.disabled) {
      btnStop.disabled = false;
      stopHint.textContent = 'Minimum collection time reached — you can stop whenever you\'re ready.';
    }
    updatePhase1Clocks(now);
  }
  requestAnimationFrame(phase1Tick);
}

function spawnArrival(arrivalTimeMs) {
  state.muonIdCounter++;
  const decayTimeUs = sampleExponential(MEAN_LIFETIME) * 1e6;  // μs, clamped by display to 0-6 μs
  const muon = { id: state.muonIdCounter, decayTimeUs };

  flashScintillator(scintillator);
  state.queue.push(muon);
  arrivedCountEl.textContent = state.muonIdCounter;
  renderQueueCount();

  if (!state.activeMuon) promoteNextFromQueue();
}

function updatePhase1Clocks(now) {
  const t = (now ?? performance.now()) - state.phase1StartMs;
  stopwatchEl.textContent = formatClock(state.collecting ? t : state.phase1DurationMs);
}

function renderQueueCount() {
  queueCountEl.textContent = state.queue.length;
}

function updateConfirmedCountInline() {
  confirmedCountInline.textContent = `(${state.confirmed.length})`;
}

function updatePhase1NavState() {
  const canAdvance = !state.collecting
                   && state.queue.length === 0
                   && state.activeMuon === null
                   && state.confirmed.length > 0;
  btnNext1.disabled = !canAdvance;
  if (canAdvance) {
    phaseNavHint1.textContent = 'All traces processed.';
  } else if (state.collecting) {
    phaseNavHint1.textContent = 'Stop collecting to advance.';
  } else {
    phaseNavHint1.textContent = 'Finish confirming the queued traces to continue.';
  }
}

// Stop button
btnStop.addEventListener('click', () => {
  if (!state.collecting) return;
  state.collecting = false;
  state.phase1DurationMs = performance.now() - state.phase1StartMs;
  btnStop.disabled = true;
  stopHint.textContent = 'Collection stopped. Process any remaining traces below.';
  updatePhase1Clocks();
  updateSummaryPhase1();
  updatePhase1NavState();
});

/* ════════════════════════════════════════════════════════════════════
   DATA TABLE HELPERS
   ════════════════════════════════════════════════════════════════════ */

function appendDetailRow(id, decayUs) {
  // Remove the empty-state row on first entry
  const emptyRow = detailTbody.querySelector('.detail-empty');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="mono">${id}</td><td class="mono">${decayUs.toFixed(2)}</td>`;
  detailTbody.appendChild(tr);
}

function updateSummaryPhase1() {
  const dMs = state.collecting
            ? (performance.now() - state.phase1StartMs)
            : state.phase1DurationMs;
  summaryTime1.textContent = formatDuration(dMs);
  summaryN1.textContent    = state.confirmed.length;
  const ratePerHr = dMs > 0 ? (state.confirmed.length / (dMs / 3.6e6)) : 0;
  summaryRate1.textContent = ratePerHr > 0 ? ratePerHr.toFixed(0) : '—';
}

function updateSummaryPhase2() {
  summaryTime2.textContent = formatDuration(state.phase1DurationMs); // same real duration as phase 1
  summaryN2.textContent    = state.phase2.count;
  const ratePerHr = state.phase1DurationMs > 0
                  ? (state.phase2.count / (state.phase1DurationMs / 3.6e6))
                  : 0;
  summaryRate2.textContent = ratePerHr > 0 ? ratePerHr.toFixed(0) : '—';
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 2 — Sea-level playback at 20×
   ════════════════════════════════════════════════════════════════════ */

function startPhase2() {
  state.phase = 2;
  state.phase2.count = 0;
  state.phase2.startMs = performance.now();
  state.phase2.durationMs = state.phase1DurationMs / PLAYBACK_SPEED;
  state.phase2.running = true;
  // Sea-level arrivals: Poisson with seaRatePerHour; we generate in sim-time (real seconds).
  state.phase2.nextArrivalSimMs = sampleExponential(3.6e6 / seaRatePerHour);

  summaryRow2.classList.remove('muted');
  arrivedCount2El.textContent = '0';
  stopwatch2El.textContent = formatClock(0);
  playbackBar.style.width = '0%';
  croActive2Wrap.innerHTML = '<p class="cro-empty">Detector waiting…</p>';
  btnNext2.disabled = true;
  phaseNavHint2.textContent = 'Playback in progress…';
  requestAnimationFrame(phase2Tick);
}

function phase2Tick(now) {
  if (state.phase !== 2 || !state.phase2.running) return;
  const wallElapsed = now - state.phase2.startMs;
  const simElapsedMs = wallElapsed * PLAYBACK_SPEED;  // elapsed sim-world ms
  const frac = Math.min(1, wallElapsed / state.phase2.durationMs);
  playbackBar.style.width = (frac * 100).toFixed(1) + '%';
  stopwatch2El.textContent = formatClock(simElapsedMs);

  // Spawn arrivals up to simElapsedMs
  while (state.phase2.nextArrivalSimMs <= simElapsedMs
         && simElapsedMs <= state.phase1DurationMs) {
    spawnSeaArrival(state.phase2.nextArrivalSimMs);
    state.phase2.nextArrivalSimMs += sampleExponential(3.6e6 / seaRatePerHour);
  }

  if (wallElapsed >= state.phase2.durationMs) {
    state.phase2.running = false;
    playbackBar.style.width = '100%';
    stopwatch2El.textContent = formatClock(state.phase1DurationMs);
    updateSummaryPhase2();
    btnNext2.disabled = false;
    phaseNavHint2.textContent = 'Playback complete.';
    croActive2Wrap.innerHTML = '<p class="cro-empty">Playback complete.</p>';
    return;
  }
  requestAnimationFrame(phase2Tick);
}

function spawnSeaArrival() {
  state.phase2.count++;
  arrivedCount2El.textContent = state.phase2.count;
  flashScintillator(scintillator2);

  // Quick fly-past trace — shown briefly then discarded.
  const decayTimeUs = sampleExponential(MEAN_LIFETIME) * 1e6;
  croActive2Wrap.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'cro-trace active';
  wrap.innerHTML = `
    <div class="cro-trace-head">
      <span class="cro-trace-n">Muon #${state.phase2.count}</span>
      <span class="cro-trace-status">Counting…</span>
    </div>
    <canvas class="cro-trace-canvas" width="720" height="120"></canvas>
  `;
  drawCROTrace(wrap.querySelector('canvas'), decayTimeUs, { active: true });
  croActive2Wrap.appendChild(wrap);

  updateSummaryPhase2();
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 3 — Altitude survival graph
   ════════════════════════════════════════════════════════════════════ */

function drawAltitudeGraph() {
  const ctx = altitudeCanvas.getContext('2d');
  const W = altitudeCanvas.width;
  const H = altitudeCanvas.height;

  ctx.clearRect(0, 0, W, H);

  // Layout
  const M_L = 80, M_R = 40, M_T = 34, M_B = 60;
  const plotW = W - M_L - M_R;
  const plotH = H - M_T - M_B;

  // Y-axis: altitude 0–2200 m
  const Y_MAX = 2200;
  const altToY = (alt) => M_T + (1 - alt / Y_MAX) * plotH;

  // X-axis: muon # 1..N (evenly spaced)
  const N = state.confirmed.length;
  const xSlot = N > 0 ? plotW / N : 0;
  const muonToX = (i) => M_L + (i + 0.5) * xSlot;

  // ── Background/grid ──────────────────────────────────────────────
  // Sky gradient
  const grad = ctx.createLinearGradient(0, M_T, 0, M_T + plotH);
  grad.addColorStop(0, 'rgba(180,210,245,0.35)');
  grad.addColorStop(1, 'rgba(220,238,255,0.15)');
  ctx.fillStyle = grad;
  ctx.fillRect(M_L, M_T, plotW, plotH);

  // ── Mt Washington silhouette (roughly drawn, decorative) ─────────
  // Peak touches the 1910 m dashed line. X-axis is "Muon #", so the
  // mountain is purely illustrative — it fills the plot width.
  // Profile defined as fractions of the plot width and metres of altitude.
  const profile = [
    [0.00,    0], [0.05,  120], [0.11,  340], [0.17,  560],
    [0.24,  900], [0.31, 1260], [0.37, 1560], [0.42, 1910], // summit
    [0.50, 1640], [0.57, 1820], [0.62, 1500], [0.71, 1020],
    [0.80,  640], [0.88,  340], [0.95,  140], [1.00,    0],
  ];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(M_L, altToY(0));
  for (const [fx, alt] of profile) {
    ctx.lineTo(M_L + fx * plotW, altToY(alt));
  }
  ctx.lineTo(M_L + plotW, altToY(0));
  ctx.closePath();
  // Fill with a soft slate-grey-green that reads as "mountain" without
  // competing with the teal/amber trace colours.
  const mtnGrad = ctx.createLinearGradient(0, altToY(MT_ALTITUDE), 0, altToY(0));
  mtnGrad.addColorStop(0, 'rgba(120,135,140,0.55)');
  mtnGrad.addColorStop(1, 'rgba(140,155,150,0.32)');
  ctx.fillStyle = mtnGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,85,95,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // Horizontal grid every 500 m — drawn over the mountain so altitude
  // references stay legible.
  ctx.strokeStyle = 'rgba(21,48,77,0.1)';
  ctx.lineWidth = 1;
  ctx.font = '11px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let alt = 0; alt <= Y_MAX; alt += 500) {
    const y = altToY(alt);
    ctx.beginPath();
    ctx.moveTo(M_L, y);
    ctx.lineTo(M_L + plotW, y);
    ctx.stroke();
    ctx.fillText(alt.toString(), M_L - 8, y);
  }

  // Mt Washington summit line (1910 m, dashed)
  const summitY = altToY(MT_ALTITUDE);
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(M_L, summitY);
  ctx.lineTo(M_L + plotW, summitY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#b45309';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.font = '700 12px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillText(`Mt Washington summit — ${MT_ALTITUDE} m`, M_L + 6, summitY - 4);

  // Sea level line (solid emphasised)
  const seaY = altToY(0);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M_L, seaY);
  ctx.lineTo(M_L + plotW, seaY);
  ctx.stroke();
  ctx.fillStyle = '#0f766e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Sea level — 0 m', M_L + 6, seaY + 4);

  // ── Muon lines ───────────────────────────────────────────────────
  // Each line starts at summit, extends down by d = v·t metres.
  // Colour: green if the tail reaches (or goes below) sea level; red if it decayed first.
  for (let i = 0; i < N; i++) {
    const t_us = state.confirmed[i].decayTimeUs;
    const dist = MUON_SPEED * t_us * 1e-6;       // metres
    const endAlt = Math.max(MT_ALTITUDE - dist, -50); // allow slight undershoot so green ticks extend below 0
    const x = muonToX(i);
    const y1 = summitY;
    const y2 = altToY(endAlt);
    const reached = dist >= MT_ALTITUDE;
    ctx.strokeStyle = reached ? 'rgba(15,118,110,0.75)' : 'rgba(220,38,38,0.45)';
    ctx.lineWidth = Math.max(1, Math.min(2.2, plotW / Math.max(N, 1) * 0.35));
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
  }

  // ── Axes ─────────────────────────────────────────────────────────
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M_L, M_T);
  ctx.lineTo(M_L, M_T + plotH);
  ctx.lineTo(M_L + plotW, M_T + plotH);
  ctx.stroke();

  // Axis titles
  ctx.fillStyle = '#15304d';
  ctx.font = '700 12px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Muon # (1 … ${N})`, M_L + plotW / 2, H - 8);

  ctx.save();
  ctx.translate(18, M_T + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Altitude (m)', 0, 0);
  ctx.restore();

  // Small legend
  const legendY = M_T - 18;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '11px "Trebuchet MS", "Segoe UI", sans-serif';

  ctx.strokeStyle = 'rgba(15,118,110,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M_L, legendY); ctx.lineTo(M_L + 18, legendY); ctx.stroke();
  ctx.fillStyle = '#15304d';
  ctx.fillText('reaches sea level', M_L + 24, legendY);

  ctx.strokeStyle = 'rgba(220,38,38,0.65)';
  ctx.beginPath(); ctx.moveTo(M_L + 170, legendY); ctx.lineTo(M_L + 188, legendY); ctx.stroke();
  ctx.fillStyle = '#15304d';
  ctx.fillText('decays before reaching sea level', M_L + 194, legendY);
}

function startPhase3() {
  state.phase = 3;
  tallyMountain.textContent = state.confirmed.length;
  tallySea.textContent      = state.phase2.count;
  drawAltitudeGraph();
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 4 — Effective distance / Lorentz factor
   ════════════════════════════════════════════════════════════════════ */

function meanDecayTimeUs() {
  if (state.confirmed.length === 0) return 0;
  const sum = state.confirmed.reduce((s, m) => s + m.decayTimeUs, 0);
  return sum / state.confirmed.length;
}

// Predicted survival for classical model: P = exp(-d / (v · ⟨t⟩))
// v in m/s, tMeanUs in μs, d in m.
function predictedSurvival(d, tMeanUs) {
  if (tMeanUs <= 0 || d <= 0) return 1;
  const meanDistance = MUON_SPEED * tMeanUs * 1e-6;   // m
  return Math.exp(-d / meanDistance);
}

// Solve d_eff such that predictedSurvival(d, tMean) = measuredFrac.
// d_eff = -v · ⟨t⟩ · ln(measuredFrac).
function solveEffectiveDistance(measuredFrac, tMeanUs) {
  if (measuredFrac <= 0 || measuredFrac >= 1 || tMeanUs <= 0) return null;
  const meanDistance = MUON_SPEED * tMeanUs * 1e-6;
  return -meanDistance * Math.log(measuredFrac);
}

function drawEffDistGraph(sliderD, tMeanUs, measuredFrac) {
  const ctx = effdistCanvas.getContext('2d');
  const W = effdistCanvas.width;
  const H = effdistCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const M_L = 80, M_R = 40, M_T = 44, M_B = 56;
  const plotW = W - M_L - M_R;
  const plotH = H - M_T - M_B;
  const Y_MAX = 2200;
  const altToY = (alt) => M_T + (1 - alt / Y_MAX) * plotH;

  // Sky gradient
  const grad = ctx.createLinearGradient(0, M_T, 0, M_T + plotH);
  grad.addColorStop(0, 'rgba(180,210,245,0.35)');
  grad.addColorStop(1, 'rgba(220,238,255,0.15)');
  ctx.fillStyle = grad;
  ctx.fillRect(M_L, M_T, plotW, plotH);

  // Mountain silhouette (same profile as Phase 3)
  const profile = [
    [0.00,    0], [0.05,  120], [0.11,  340], [0.17,  560],
    [0.24,  900], [0.31, 1260], [0.37, 1560], [0.42, 1910],
    [0.50, 1640], [0.57, 1820], [0.62, 1500], [0.71, 1020],
    [0.80,  640], [0.88,  340], [0.95,  140], [1.00,    0],
  ];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(M_L, altToY(0));
  for (const [fx, alt] of profile) ctx.lineTo(M_L + fx * plotW, altToY(alt));
  ctx.lineTo(M_L + plotW, altToY(0));
  ctx.closePath();
  const mtnGrad = ctx.createLinearGradient(0, altToY(MT_ALTITUDE), 0, altToY(0));
  mtnGrad.addColorStop(0, 'rgba(120,135,140,0.55)');
  mtnGrad.addColorStop(1, 'rgba(140,155,150,0.32)');
  ctx.fillStyle = mtnGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,85,95,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();

  // Altitude grid every 500 m
  ctx.strokeStyle = 'rgba(21,48,77,0.1)';
  ctx.lineWidth = 1;
  ctx.font = '11px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let alt = 0; alt <= Y_MAX; alt += 500) {
    const y = altToY(alt);
    ctx.beginPath(); ctx.moveTo(M_L, y); ctx.lineTo(M_L + plotW, y); ctx.stroke();
    ctx.fillText(alt.toString(), M_L - 8, y);
  }

  // Mt Washington summit line
  const summitY = altToY(MT_ALTITUDE);
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(M_L, summitY); ctx.lineTo(M_L + plotW, summitY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#b45309';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.font = '700 12px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillText(`Mt Washington summit — ${MT_ALTITUDE} m`, M_L + 6, summitY - 4);

  // Sea level line
  const seaY = altToY(0);
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M_L, seaY); ctx.lineTo(M_L + plotW, seaY); ctx.stroke();
  ctx.fillStyle = '#0f766e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Sea level — 0 m', M_L + 6, seaY + 4);

  // ── Shaded "effective distance" band ─────────────────────────────
  // Starts at summit, extends down by sliderD metres.
  const bandTopY    = summitY;
  const bandBottomY = altToY(Math.max(MT_ALTITUDE - sliderD, 0));
  ctx.save();
  ctx.fillStyle = 'rgba(15,118,110,0.16)';
  ctx.fillRect(M_L, bandTopY, plotW, bandBottomY - bandTopY);
  // Hatch marker at the bottom of the band
  ctx.strokeStyle = 'rgba(15,118,110,0.85)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(M_L, bandBottomY);
  ctx.lineTo(M_L + plotW, bandBottomY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Label on the band
  const bandCentreY = (bandTopY + bandBottomY) / 2;
  ctx.save();
  ctx.fillStyle = '#0f766e';
  ctx.font = '700 13px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`d = ${Math.round(sliderD)} m`, M_L + plotW * 0.55, bandCentreY);
  ctx.font = '11px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillStyle = '#55708d';
  ctx.fillText(
    `predicted survival ≈ ${(predictedSurvival(sliderD, tMeanUs) * 100).toFixed(1)} %`,
    M_L + plotW * 0.55, bandCentreY + 16
  );
  ctx.fillText(
    `measured survival = ${(measuredFrac * 100).toFixed(1)} %`,
    M_L + plotW * 0.55, bandCentreY + 32
  );
  ctx.restore();

  // Axis
  ctx.strokeStyle = '#15304d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M_L, M_T);
  ctx.lineTo(M_L, M_T + plotH);
  ctx.lineTo(M_L + plotW, M_T + plotH);
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = '#15304d';
  ctx.font = '700 12px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.translate(18, M_T + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Altitude (m)', 0, 0);
  ctx.restore();

  // Header
  ctx.fillStyle = '#15304d';
  ctx.font = '700 13px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `Shaded band: how far the muons behave as if they have travelled`,
    M_L, M_T - 24
  );
}

function updatePhase4Display() {
  const nMtn  = state.confirmed.length;
  const nSea  = state.phase2.count;
  const tMean = meanDecayTimeUs();
  const measuredFrac = nMtn > 0 ? nSea / nMtn : 0;
  const d = parseFloat(effSlider.value);

  // Text readouts
  effNmtn.textContent      = nMtn;
  effNsea.textContent      = nSea;
  effSurvival.textContent  = nMtn > 0 ? (measuredFrac * 100).toFixed(1) + '%' : '—';
  effMeanT.textContent     = tMean > 0 ? tMean.toFixed(2) + ' μs' : '—';
  effInlineNmtn.textContent = nMtn;
  effInlineT.textContent    = tMean > 0 ? tMean.toFixed(2) : '—';
  effInlineFrac.textContent = nMtn > 0 ? (measuredFrac * 100).toFixed(1) + '%' : '—';

  effSliderVal.value            = `${Math.round(d)}`;
  effPredictedFrac.textContent  = (predictedSurvival(d, tMean) * 100).toFixed(1) + '%';
  effMeasuredFrac.textContent   = nMtn > 0 ? (measuredFrac * 100).toFixed(1) + '%' : '—';

  // γ readout — only show once the slider is close to a physically meaningful value.
  // We show L / d at the slider position, with a note comparing to γ if close.
  const ratio = d > 0 ? MT_ALTITUDE / d : 0;
  gammaRatio.textContent = ratio > 0 ? ratio.toFixed(2) : '—';

  drawEffDistGraph(d, tMean, measuredFrac);
}

effSlider.addEventListener('input', updatePhase4Display);
effSliderVal.addEventListener('change', () => {
  const raw = parseFloat(effSliderVal.value);
  if (isNaN(raw)) { effSliderVal.value = Math.round(parseFloat(effSlider.value)); return; }
  const min = parseFloat(effSlider.min), max = parseFloat(effSlider.max);
  effSlider.value = Math.max(min, Math.min(max, raw));
  updatePhase4Display();
});

effSnapBtn.addEventListener('click', () => {
  const nMtn = state.confirmed.length;
  const nSea = state.phase2.count;
  const tMean = meanDecayTimeUs();
  if (nMtn === 0 || nSea === 0 || tMean === 0) return;
  const frac = nSea / nMtn;
  const dEff = solveEffectiveDistance(frac, tMean);
  if (dEff === null || !Number.isFinite(dEff)) return;
  const clamped = Math.max(parseFloat(effSlider.min),
                           Math.min(parseFloat(effSlider.max), dEff));
  effSlider.value = clamped;
  updatePhase4Display();
});

function startPhase4() {
  state.phase = 4;
  effSlider.value = 1910;
  updatePhase4Display();
}

/* ════════════════════════════════════════════════════════════════════
   PHASE TRANSITIONS
   ════════════════════════════════════════════════════════════════════ */

function showModal(title, bodyHtml, onContinue) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalBackdrop.classList.remove('hidden');
  modalBackdrop.setAttribute('aria-hidden', 'false');
  const handler = () => {
    modalBackdrop.classList.add('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    modalContinue.removeEventListener('click', handler);
    onContinue();
  };
  modalContinue.addEventListener('click', handler);
}

function showPhase(n) {
  for (const el of document.querySelectorAll('.phase-content')) {
    el.classList.toggle('hidden', Number(el.id.split('-')[1]) !== n);
  }
  const steps = document.querySelectorAll('.phase-step');
  steps.forEach((el) => {
    const p = Number(el.dataset.phase);
    el.classList.toggle('active', p === n);
    el.classList.toggle('done', p < n);
  });
}

// Dev shortcut: clicking a phase-bar step jumps straight to that phase so the
// layout can be inspected without replaying the whole experiment.
document.querySelectorAll('.phase-step').forEach((step) => {
  step.setAttribute('role', 'button');
  step.setAttribute('tabindex', '0');
  step.setAttribute('title', `Jump to Phase ${step.dataset.phase}`);
  const jump = () => showPhase(Number(step.dataset.phase));
  step.addEventListener('click', jump);
  step.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
  });
});

btnNext1.addEventListener('click', () => {
  showModal(
    'Phase 2 — Sea Level',
    `<p>We now run an identical detector at sea level, for the same amount of real
     time as Phase 1. To save you waiting, the sim plays back at <strong>20×
     speed</strong>.</p>
     <p>Muons are counted automatically — you don't need to time the decays
     here. Just watch the count climb, and compare the sea-level rate to the
     mountain rate when it's done.</p>`,
    () => { showPhase(2); startPhase2(); }
  );
});

btnNext2.addEventListener('click', () => {
  showModal(
    'Phase 3 — Classical Survival',
    `<p>Each muon you detected on Mt Washington travels at ≈ 0.994 c, so we can
     convert its measured decay time into a distance: <em>d = 0.994c · t</em>.</p>
     <p>The graph that follows draws one vertical line per muon, starting at
     the summit and extending down by that distance. Count how many lines
     make it all the way to sea level according to this classical picture,
     then compare with the sea-level count you just measured.</p>`,
    () => { showPhase(3); startPhase3(); }
  );
});

btnNext3.addEventListener('click', () => {
  showModal(
    'Phase 4 — Effective Distance',
    `<p>Classically, only a handful of your muons should have reached sea
     level — yet the sea-level detector counted hundreds. The decay times
     you measured are real, so the issue is with the <em>distance</em>.</p>
     <p>Work backwards: what distance would give the survival fraction you
     actually observed? This is the distance the muons appear to travel —
     and comparing it to the real 1910 m of mountain tells you something
     about how length contraction works in their reference frame.</p>`,
    () => { showPhase(4); startPhase4(); }
  );
});

document.querySelectorAll('#btn-restart').forEach((b) => {
  b.addEventListener('click', () => location.reload());
});

/* ════════════════════════════════════════════════════════════════════
   INITIAL KICK-OFF
   The stopwatch must not start until the student has read the briefing,
   so Phase 1 only begins once this intro modal is dismissed.
   ════════════════════════════════════════════════════════════════════ */
showModal(
  'The plan',
  `<p>
     Cosmic rays slamming into the upper atmosphere produce a shower of
     <strong>muons</strong> — heavy cousins of the electron. A muon at rest
     has a mean lifetime of only <strong>2.2 μs</strong>, so even travelling
     at nearly the speed of light it should decay long before reaching the
     ground. Yet plenty still make it to sea level. In 1963 Frisch & Smith
     measured this directly by counting muons at the summit of Mt Washington
     and again at sea level.
   </p>

   <p>Your detector is a block of plastic <strong>scintillator</strong>
      viewed by a <strong>photomultiplier tube (PMT)</strong>. A slab of
      <strong>iron absorber</strong> above the scintillator slows incoming
      muons so that they stop inside the plastic and decay there. Each stop
      flashes the scintillator, and each decay flashes it a second time —
      the PMT turns both flashes into pulses displayed on the oscilloscope
      (CRO). The CRO is triggered by the first pulse, so it sits at
      <em>t</em> = 0; you read the muon's lifetime straight off the trace as
      the time of the second pulse.</p>

   <svg class="intro-diagram" viewBox="-50 0 620 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schematic of the detector: muons pass through iron absorbers into a scintillator viewed by a PMT wired to a CRO.">
     <defs>
       <pattern id="ironHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
         <rect width="6" height="6" fill="#8892a0"/>
         <line x1="0" y1="0" x2="0" y2="6" stroke="#5a6472" stroke-width="1"/>
       </pattern>
       <marker id="muonArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
         <path d="M 0 0 L 10 5 L 0 10 z" fill="#15304d"/>
       </marker>
     </defs>

     <!-- Muon arrows coming in from above -->
     <g stroke="#15304d" stroke-width="2" fill="none" marker-end="url(#muonArrow)">
       <line x1="120" y1="8"  x2="120" y2="58"/>
       <line x1="200" y1="8"  x2="200" y2="58"/>
       <line x1="280" y1="8"  x2="280" y2="58"/>
     </g>
     <text x="310" y="24" font-size="13" fill="#15304d" font-family="system-ui, sans-serif" font-style="italic">
       incoming muons
     </text>

     <!-- Iron absorber blocks -->
     <rect x="70" y="70" width="260" height="22" fill="url(#ironHatch)" stroke="#3e4857" stroke-width="1.2" rx="2"/>
     <rect x="70" y="96" width="260" height="22" fill="url(#ironHatch)" stroke="#3e4857" stroke-width="1.2" rx="2"/>
     <text x="340" y="93" font-size="13" fill="#15304d" font-family="system-ui, sans-serif">
       iron absorber
     </text>
     <text x="340" y="110" font-size="11" fill="#4a5668" font-family="system-ui, sans-serif" font-style="italic">
       slows muons so they stop
     </text>

     <!-- Scintillator block -->
     <rect x="70" y="132" width="260" height="46" fill="#c7e8de" stroke="#2a8a74" stroke-width="1.5" rx="4"/>
     <text x="200" y="160" font-size="14" fill="#15304d" font-family="system-ui, sans-serif" text-anchor="middle" font-weight="600">
       scintillator
     </text>

     <!-- PMT attached to the right of the scintillator -->
     <path d="M 330 138 L 430 138 L 450 155 L 450 155 L 430 172 L 330 172 Z"
           fill="#1f4160" stroke="#0c2036" stroke-width="1.2"/>
     <rect x="450" y="148" width="14" height="14" fill="#0c2036"/>
     <text x="380" y="160" font-size="12" fill="#f3f7fb" font-family="system-ui, sans-serif" text-anchor="middle" font-weight="600">
       PMT
     </text>

     <!-- Wire to CRO -->
     <path d="M 464 155 Q 500 155 500 200" stroke="#15304d" stroke-width="1.5" fill="none"/>

     <!-- CRO -->
     <rect x="450" y="198" width="96" height="54" fill="#0f2436" stroke="#0c2036" stroke-width="1.5" rx="6"/>
     <rect x="458" y="206" width="80" height="38" fill="#0b5a3a" stroke="#052010" stroke-width="1" rx="2"/>
     <path d="M 462 232 L 478 232 L 482 214 L 486 232 L 498 232 L 502 220 L 506 232 L 534 232"
           stroke="#7fffb0" stroke-width="1.3" fill="none"/>
     <text x="498" y="250" font-size="11" fill="#f3f7fb" font-family="system-ui, sans-serif" text-anchor="middle" font-style="italic">
       CRO
     </text>

     <!-- Label bracket on the left grouping iron+scint as "detector stack" -->
     <path d="M 60 70 L 52 70 L 52 178 L 60 178" stroke="#4a5668" stroke-width="1.2" fill="none"/>
     <text x="44" y="128" font-size="12" fill="#4a5668" font-family="system-ui, sans-serif" text-anchor="end" font-style="italic">
       detector
     </text>
     <text x="44" y="142" font-size="12" fill="#4a5668" font-family="system-ui, sans-serif" text-anchor="end" font-style="italic">
       stack
     </text>
   </svg>

   <p>You'll re-create their measurement in four steps:</p>
   <ol>
     <li><strong>Mt Washington summit (1910 m).</strong> Count the muons
         arriving at the detector, and time how long each one survives
         before it decays.</li>
     <li><strong>Sea level.</strong> Repeat the count with an identical
         detector, for the same amount of time. How many muons make it
         down?</li>
     <li><strong>Classical prediction.</strong> Use the decay times you
         measured to work out how many muons we <em>expect</em> to reach
         sea level, and compare with what was actually counted.</li>
     <li><strong>Effective distance.</strong> From the discrepancy, extract
         the Lorentz factor — the amount by which the mountain has
         contracted in the muon's frame.</li>
   </ol>

   <p>The stopwatch starts when you close this briefing.</p>`,
  () => { startPhase1(); }
);
