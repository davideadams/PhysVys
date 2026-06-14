(() => {
  const canvas = document.getElementById('moire-canvas');
  const ctx = canvas.getContext('2d');

  const state = {
    pattern: 'lines',
    dA: 18,
    dB: 18,
    theta: 3,      // degrees, layer B rotation
    thk: 25,       // percent of spacing
    offX: 0,
    offY: 0,
    showA: true,
    showB: true,
    colour: false,
  };

  const COL_A_MONO = '#0a1628';
  const COL_B_MONO = '#0a1628';
  const COL_A_C = '#0a1628';
  const COL_B_C = '#c2185b';

  // ---------- canvas sizing ----------
  let W = 0, H = 0, dpr = 1;
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ---------- pattern drawers ----------
  // Each drawer expects ctx to already be transformed so (0,0) is the
  // pattern's local origin. Draws to fill a square of radius `R` around origin.

  function drawLines(ctx, d, thk, R) {
    const w = Math.max(0.5, d * thk / 100);
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let y = -R; y <= R + 0.01; y += d) {
      ctx.moveTo(-R, y);
      ctx.lineTo( R, y);
    }
    ctx.stroke();
  }

  function drawDots(ctx, d, thk, R) {
    const r = Math.max(0.4, d * thk / 200);
    for (let y = -R; y <= R + 0.01; y += d) {
      for (let x = -R; x <= R + 0.01; x += d) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCircles(ctx, d, thk, R) {
    const w = Math.max(0.5, d * thk / 100);
    ctx.lineWidth = w;
    for (let rr = d; rr <= R; rr += d) {
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawRadial(ctx, d, thk, R) {
    const step = Math.max(2, d) / R;
    const n = Math.max(6, Math.round(2 * Math.PI / step));
    const w = Math.max(0.5, d * thk / 100);
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.stroke();
  }

  function drawTriangle(ctx, d, thk, R) {
    const w = Math.max(0.5, d * thk / 100);
    ctx.lineWidth = w;
    const angles = [0, Math.PI / 3, 2 * Math.PI / 3];
    for (const a of angles) {
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      for (let y = -R; y <= R + 0.01; y += d) {
        ctx.moveTo(-R, y);
        ctx.lineTo( R, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHex(ctx, d, thk, R) {
    // Flat-top honeycomb. d = centre-to-centre between adjacent cells.
    const s = d / Math.sqrt(3);
    const w = Math.max(0.5, d * thk / 100);
    ctx.lineWidth = w;
    const colStep = 1.5 * s;
    const rowStep = d;
    const cols = Math.ceil(R / colStep) + 1;
    const rows = Math.ceil(R / rowStep) + 1;
    // Pre-compute hex vertex offsets once.
    const vx = new Float64Array(6), vy = new Float64Array(6);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      vx[i] = s * Math.cos(a);
      vy[i] = s * Math.sin(a);
    }
    for (let cx = -cols; cx <= cols; cx++) {
      const px = cx * colStep;
      const yOff = (((cx % 2) + 2) % 2 === 0) ? 0 : rowStep / 2;
      for (let ry = -rows; ry <= rows; ry++) {
        const py = ry * rowStep + yOff;
        // Stroke each hex on its own — small paths render much faster
        // than one mega-path with tens of thousands of subpaths.
        ctx.beginPath();
        ctx.moveTo(px + vx[0], py + vy[0]);
        for (let i = 1; i < 6; i++) ctx.lineTo(px + vx[i], py + vy[i]);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  const drawers = {
    lines:    drawLines,
    dots:     drawDots,
    circles:  drawCircles,
    radial:   drawRadial,
    triangle: drawTriangle,
    hex:      drawHex,
  };

  function drawLayer(d, thetaDeg, ox, oy, colour) {
    if (!d) return;
    const tile = Math.min(W, H) * 0.78;          // each layer is a finite square
    ctx.save();
    ctx.translate(W / 2 + ox, H / 2 + oy);
    ctx.rotate(thetaDeg * Math.PI / 180);

    // Clip to a centred square in the layer's own (rotated) frame so the
    // tile's edges visibly sweep around when you rotate.
    ctx.beginPath();
    ctx.rect(-tile / 2, -tile / 2, tile, tile);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    // R must cover the clipped square; its half-diagonal is tile * √2 / 2.
    const R = tile * 0.72 + 2 * d;
    drawers[state.pattern](ctx, d, state.thk, R);
    ctx.restore();

    // Faint outline so the tile is visible even where the pattern is sparse.
    ctx.strokeStyle = 'rgba(21, 48, 77, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (state.colour) {
      // Layered colour mode: multiply blend so overlaps darken meaningfully.
      ctx.globalCompositeOperation = 'multiply';
      if (state.showA) drawLayer(state.dA, 0, 0, 0, COL_A_C);
      if (state.showB) drawLayer(state.dB, state.theta, state.offX, state.offY, COL_B_C);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      if (state.showA) drawLayer(state.dA, 0, 0, 0, COL_A_MONO);
      if (state.showB) drawLayer(state.dB, state.theta, state.offX, state.offY, COL_B_MONO);
    }
  }

  // ---------- readout ----------
  const ro = {
    theta:  document.getElementById('ro-theta'),
    dd:     document.getElementById('ro-dd'),
    dmRot:  document.getElementById('ro-dm-rot'),
    dmSp:   document.getElementById('ro-dm-sp'),
    off:    document.getElementById('ro-offset'),
  };

  function updateReadout() {
    ro.theta.textContent = `${state.theta.toFixed(1)}°`;
    const dd = Math.abs(state.dA - state.dB);
    ro.dd.textContent = `${dd.toFixed(1)} px`;

    // Rotation formula uses mean spacing for the equal-grid case.
    const dMean = (state.dA + state.dB) / 2;
    const thetaRad = Math.abs(state.theta) * Math.PI / 180;
    if (thetaRad > 1e-4) {
      const dmRot = dMean / (2 * Math.sin(thetaRad / 2));
      ro.dmRot.textContent = `${dmRot.toFixed(1)} px`;
    } else {
      ro.dmRot.textContent = '∞';
    }
    if (dd > 1e-3) {
      const dmSp = (state.dA * state.dB) / dd;
      ro.dmSp.textContent = `${dmSp.toFixed(1)} px`;
    } else {
      ro.dmSp.textContent = '∞';
    }
    ro.off.textContent = `(${state.offX.toFixed(0)}, ${state.offY.toFixed(0)}) px`;
  }

  // ---------- control wiring ----------
  function bindSlider(sliderId, numId, key, after) {
    const s = document.getElementById(sliderId);
    const n = document.getElementById(numId);
    const sync = (v) => {
      const num = Number(v);
      if (Number.isNaN(num)) return;
      state[key] = num;
      s.value = num;
      n.value = num;
      after && after();
      updateReadout();
      draw();
    };
    s.addEventListener('input', e => sync(e.target.value));
    n.addEventListener('input', e => sync(e.target.value));
  }
  bindSlider('slider-dA',    'val-dA',    'dA');
  bindSlider('slider-dB',    'val-dB',    'dB');
  bindSlider('slider-theta', 'val-theta', 'theta');
  bindSlider('slider-thk',   'val-thk',   'thk');

  // Pattern buttons
  document.querySelectorAll('[data-pattern]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pattern]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.pattern = btn.dataset.pattern;
      draw();
    });
  });

  // Toggles
  function bindToggle(id, key) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('active', state[key]);
      draw();
    });
  }
  bindToggle('btn-show-A', 'showA');
  bindToggle('btn-show-B', 'showB');
  bindToggle('btn-colour', 'colour');

  // Match A
  document.getElementById('btn-match').addEventListener('click', () => {
    state.dB = state.dA;
    document.getElementById('slider-dB').value = state.dB;
    document.getElementById('val-dB').value = state.dB;
    updateReadout();
    draw();
  });

  // Presets
  function applyPreset({pattern, dA, dB, theta, offX, offY}) {
    if (pattern) {
      state.pattern = pattern;
      document.querySelectorAll('[data-pattern]').forEach(b => {
        b.classList.toggle('active', b.dataset.pattern === pattern);
      });
    }
    if (dA != null)    { state.dA = dA;       document.getElementById('slider-dA').value = dA;       document.getElementById('val-dA').value = dA; }
    if (dB != null)    { state.dB = dB;       document.getElementById('slider-dB').value = dB;       document.getElementById('val-dB').value = dB; }
    if (theta != null) { state.theta = theta; document.getElementById('slider-theta').value = theta; document.getElementById('val-theta').value = theta; }
    if (offX != null) state.offX = offX;
    if (offY != null) state.offY = offY;
    updateReadout();
    draw();
  }
  document.getElementById('preset-rot').addEventListener('click', () => {
    applyPreset({pattern: 'lines', dA: 18, dB: 18, theta: 3, offX: 0, offY: 0});
  });
  document.getElementById('preset-space').addEventListener('click', () => {
    applyPreset({pattern: 'lines', dA: 18, dB: 20, theta: 0, offX: 0, offY: 0});
  });
  document.getElementById('preset-circle').addEventListener('click', () => {
    applyPreset({pattern: 'circles', dA: 18, dB: 18, theta: 0, offX: 40, offY: 0});
  });
  document.getElementById('preset-reset').addEventListener('click', () => {
    applyPreset({offX: 0, offY: 0});
  });

  // ---------- drag ----------
  let dragging = false;
  let dragMode = 'translate'; // or 'rotate'
  let lastX = 0, lastY = 0;
  let rotAnchorAngle = 0;     // angle from canvas centre to pointer at drag start
  let rotAnchorTheta = 0;     // state.theta at drag start
  function pt(e) {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function pointerAngle(p) {
    return Math.atan2(p.y - H / 2, p.x - W / 2) * 180 / Math.PI;
  }
  function onDown(e) {
    e.preventDefault();
    dragging = true;
    dragMode = e.shiftKey ? 'rotate' : 'translate';
    canvas.classList.add('dragging');
    const p = pt(e);
    lastX = p.x; lastY = p.y;
    if (dragMode === 'rotate') {
      rotAnchorAngle = pointerAngle(p);
      rotAnchorTheta = state.theta;
    }
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const p = pt(e);
    if (dragMode === 'rotate') {
      const a = pointerAngle(p);
      let delta = a - rotAnchorAngle;
      // wrap to [-180, 180]
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      let next = rotAnchorTheta + delta;
      const slider = document.getElementById('slider-theta');
      const min = Number(slider.min), max = Number(slider.max);
      next = Math.max(min, Math.min(max, next));
      state.theta = next;
      slider.value = next;
      document.getElementById('val-theta').value = next.toFixed(1);
    } else {
      state.offX += p.x - lastX;
      state.offY += p.y - lastY;
    }
    lastX = p.x; lastY = p.y;
    updateReadout();
    draw();
  }
  function onUp() {
    dragging = false;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ---------- init ----------
  window.addEventListener('resize', fitCanvas);
  fitCanvas();
  updateReadout();
})();
