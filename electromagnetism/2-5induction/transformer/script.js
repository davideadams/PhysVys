(() => {
  const canvas = document.getElementById('schematic');
  const ctx = canvas.getContext('2d');

  const state = {
    Vin: 120,
    Nin: 20,
    Nout: 10,
    playing: true,
    t: 0,
  };

  const PERIOD = 1.6;

  const els = {
    vin:  document.getElementById('slider-vin'),
    nin:  document.getElementById('slider-nin'),
    nout: document.getElementById('slider-nout'),
    vinV: document.getElementById('val-vin'),
    ninV: document.getElementById('val-nin'),
    noutV: document.getElementById('val-nout'),
    play: document.getElementById('btn-play'),
    rdRatio: document.getElementById('rd-ratio'),
    rdVin:  document.getElementById('rd-vin'),
    rdVout: document.getElementById('rd-vout'),
    rdMode: document.getElementById('rd-mode'),
  };

  function bindSlider(el, valEl, key, parse = parseFloat) {
    el.addEventListener('input', () => {
      state[key] = parse(el.value);
      valEl.value = el.value;
      updatePresetHighlight();
      updateReadouts();
    });
    valEl.addEventListener('change', () => {
      let v = parseFloat(valEl.value);
      if (isNaN(v)) { valEl.value = el.value; return; }
      const min = parseFloat(el.min), max = parseFloat(el.max);
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      state[key] = parse(el.value);
      valEl.value = el.value;
      updatePresetHighlight();
      updateReadouts();
    });
  }
  bindSlider(els.vin,  els.vinV,  'Vin',  parseFloat);
  bindSlider(els.nin,  els.ninV,  'Nin',  v => parseInt(v, 10));
  bindSlider(els.nout, els.noutV, 'Nout', v => parseInt(v, 10));

  document.querySelectorAll('#seg-preset .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.val;
      if (v === 'up')   { state.Nin = 8;  state.Nout = 32; }
      else if (v === 'down') { state.Nin = 32; state.Nout = 8;  }
      else                   { state.Nin = 20; state.Nout = 20; }
      els.nin.value  = state.Nin;  els.ninV.value  = state.Nin;
      els.nout.value = state.Nout; els.noutV.value = state.Nout;
      updatePresetHighlight();
      updateReadouts();
    });
  });

  function updatePresetHighlight() {
    const want =
      state.Nin === 8  && state.Nout === 32 ? 'up'   :
      state.Nin === 32 && state.Nout === 8  ? 'down' :
      state.Nin === 20 && state.Nout === 20 ? 'even' :
      null;
    document.querySelectorAll('#seg-preset .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === want);
    });
  }

  els.play.addEventListener('click', () => {
    state.playing = !state.playing;
    els.play.classList.toggle('playing', state.playing);
    els.play.textContent = state.playing ? '■ Pause' : '▶ Play';
  });

  function Vout() { return state.Vin * state.Nout / state.Nin; }
  function ratio() { return state.Nout / state.Nin; }

  function updateReadouts() {
    els.rdRatio.textContent = ratio().toFixed(2);
    els.rdVin.textContent   = state.Vin.toFixed(0) + ' V';
    els.rdVout.textContent  = Vout().toFixed(1) + ' V';
    let mode = '1 : 1';
    if (state.Nout > state.Nin) mode = 'Step-up';
    else if (state.Nout < state.Nin) mode = 'Step-down';
    els.rdMode.textContent = mode;
  }
  updateReadouts();
  updatePresetHighlight();

  function resize() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  // ---------- Drawing helpers ----------

  const COIL_RX = 38;
  const CORE_FILL = '#cbd2dc';
  const CORE_EDGE = '#6c7a93';
  const COPPER_BACK  = '#c98a52';
  const COPPER_FRONT = '#a85a1f';

  function drawCoreRing(x, y, w, h, t) {
    ctx.save();
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#dde2ec');
    grad.addColorStop(1, '#bcc4d2');
    ctx.fillStyle = grad;
    ctx.strokeStyle = CORE_EDGE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.rect(x + t, y + t, w - 2 * t, h - 2 * t);
    ctx.fill('evenodd');
    ctx.stroke();

    ctx.strokeStyle = 'rgba(80,98,120,0.28)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const fx = x + t * i / 4;
      ctx.beginPath(); ctx.moveTo(fx, y + 4); ctx.lineTo(fx, y + h - 4); ctx.stroke();
      const rx = x + w - t + t * i / 4;
      ctx.beginPath(); ctx.moveTo(rx, y + 4); ctx.lineTo(rx, y + h - 4); ctx.stroke();
    }
    ctx.restore();
  }

  function drawLegOverlay(legCx, top, bot, t) {
    ctx.save();
    const grad = ctx.createLinearGradient(legCx - t/2, 0, legCx + t/2, 0);
    grad.addColorStop(0, '#c5cdd9');
    grad.addColorStop(0.5, '#dde2ec');
    grad.addColorStop(1, '#c5cdd9');
    ctx.fillStyle = grad;
    ctx.strokeStyle = CORE_EDGE;
    ctx.lineWidth = 1.6;
    ctx.fillRect(legCx - t/2, top, t, bot - top);
    ctx.beginPath();
    ctx.moveTo(legCx - t/2, top); ctx.lineTo(legCx - t/2, bot);
    ctx.moveTo(legCx + t/2, top); ctx.lineTo(legCx + t/2, bot);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,98,120,0.28)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const lx = legCx - t/2 + t * i / 4;
      ctx.beginPath(); ctx.moveTo(lx, top + 2); ctx.lineTo(lx, bot - 2); ctx.stroke();
    }
    ctx.restore();
  }

  function coilTurnY(top, bot, N, i) {
    const turnH = (bot - top) / N;
    return top + turnH * (i + 0.5);
  }

  function coilRY(top, bot, N) {
    const turnH = (bot - top) / N;
    return Math.max(2.2, Math.min(turnH * 0.42, 13));
  }

  function drawCoilBack(legX, top, bot, N) {
    const ry = coilRY(top, bot, N);
    ctx.save();
    ctx.strokeStyle = COPPER_BACK;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const cy = coilTurnY(top, bot, N, i);
      ctx.beginPath();
      ctx.ellipse(legX, cy, COIL_RX, ry, 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCoilFront(legX, top, bot, N) {
    const ry = coilRY(top, bot, N);
    ctx.save();
    ctx.strokeStyle = COPPER_FRONT;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const cy = coilTurnY(top, bot, N, i);
      ctx.beginPath();
      ctx.ellipse(legX, cy, COIL_RX, ry, 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWire(points, color = '#384a64', width = 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(x1, y1, x2, y2, alpha, color) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ah = 9;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ah * Math.cos(ang - 0.5), y2 - ah * Math.sin(ang - 0.5));
    ctx.lineTo(x2 - ah * Math.cos(ang + 0.5), y2 - ah * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawACSource(cx, cy) {
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#1f3a5f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.bezierCurveTo(cx - 8, cy - 10, cx - 4, cy - 10, cx, cy);
    ctx.bezierCurveTo(cx + 4, cy + 10, cx + 8, cy + 10, cx + 12, cy);
    ctx.stroke();
    ctx.restore();
  }

  function drawVoltmeter(cx, cy, value) {
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#1f3a5f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1f3a5f';
    ctx.font = '700 18px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('V', cx, cy - 2);
    ctx.restore();
  }

  function drawLabel(text, x, y, color = '#1f3a5f', size = 13, weight = 700) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawFluxArrow(x1, y1, x2, y2, sinP) {
    const intensity = Math.abs(sinP);
    const dir = sinP >= 0 ? 1 : -1;
    const a = 0.18 + 0.78 * intensity;
    const color = '#0d9488';
    if (dir > 0) drawArrow(x1, y1, x2, y2, a, color);
    else drawArrow(x2, y2, x1, y1, a, color);
  }

  // ---------- Main render ----------

  function draw(dt) {
    if (state.playing) state.t += dt;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const phase = (state.t / PERIOD) * Math.PI * 2;
    const sinP = Math.sin(phase);

    // Layout
    const cx = w / 2, cy = h / 2;
    const coreW = Math.min(380, w - 280);
    const coreH = Math.min(300, h - 140);
    const t = 30;
    const coreX = cx - coreW / 2;
    const coreY = cy - coreH / 2;

    const legLeftX  = coreX + t / 2;
    const legRightX = coreX + coreW - t / 2;
    const coilTop = coreY + t + 16;
    const coilBot = coreY + coreH - t - 16;

    // 1. Core ring (full)
    drawCoreRing(coreX, coreY, coreW, coreH, t);

    // 2. Coil back halves
    drawCoilBack(legLeftX,  coilTop, coilBot, state.Nin);
    drawCoilBack(legRightX, coilTop, coilBot, state.Nout);

    // 3. Re-draw legs over back halves
    drawLegOverlay(legLeftX,  coilTop, coilBot, t);
    drawLegOverlay(legRightX, coilTop, coilBot, t);

    // 4. Coil front halves
    drawCoilFront(legLeftX,  coilTop, coilBot, state.Nin);
    drawCoilFront(legRightX, coilTop, coilBot, state.Nout);

    // 5. External components
    const sourceX = coreX - 86;
    const meterX  = coreX + coreW + 86;

    const inTopY  = coilTop + (coilBot - coilTop) / state.Nin * 0.5;
    const inBotY  = coilBot - (coilBot - coilTop) / state.Nin * 0.5;
    const outTopY = coilTop + (coilBot - coilTop) / state.Nout * 0.5;
    const outBotY = coilBot - (coilBot - coilTop) / state.Nout * 0.5;

    // input lead wires (left coil → AC source)
    drawWire([
      [legLeftX - COIL_RX, inTopY],
      [sourceX, inTopY],
      [sourceX, cy - 22],
    ]);
    drawWire([
      [legLeftX - COIL_RX, inBotY],
      [sourceX, inBotY],
      [sourceX, cy + 22],
    ]);

    // output lead wires (right coil → voltmeter)
    drawWire([
      [legRightX + COIL_RX, outTopY],
      [meterX, outTopY],
      [meterX, cy - 24],
    ]);
    drawWire([
      [legRightX + COIL_RX, outBotY],
      [meterX, outBotY],
      [meterX, cy + 24],
    ]);

    // AC source & voltmeter
    drawACSource(sourceX, cy);
    drawVoltmeter(meterX, cy);

    // 6. Flux arrows on top + bottom yokes (animated)
    const yokeTopY = coreY + t / 2;
    const yokeBotY = coreY + coreH - t / 2;
    const fluxXa = coreX + t + 32;
    const fluxXb = coreX + coreW - t - 32;
    drawFluxArrow(fluxXa, yokeTopY, fluxXb, yokeTopY, sinP);
    drawFluxArrow(fluxXb, yokeBotY, fluxXa, yokeBotY, sinP);
    drawLabel('Φ', (fluxXa + fluxXb) / 2, yokeTopY - 12, '#0d9488', 13);
    drawLabel('Φ', (fluxXa + fluxXb) / 2, yokeBotY + 14, '#0d9488', 13);

    // 7. Labels
    drawLabel(`Input coil  N = ${state.Nin}`, legLeftX,  coreY - 14, '#15304d');
    drawLabel(`Output coil  N = ${state.Nout}`, legRightX, coreY - 14, '#15304d');
    drawLabel('AC source', sourceX, cy + 44, '#55708d', 12);
    drawLabel(`${state.Vin.toFixed(0)} V`, sourceX, cy + 60, '#15304d', 13);
    drawLabel('Voltmeter', meterX, cy + 44, '#55708d', 12);
    drawLabel(`${Vout().toFixed(1)} V`, meterX, cy + 60, '#15304d', 13);
  }

  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    draw(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
