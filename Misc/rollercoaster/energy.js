/* Energy displays: the stacked bars, the energy-against-distance graph, and
   the ride report.

   The numbers all come from RC.energy(), computed from the exact simulation
   state — never from anything the renderer approximates. The bars are the
   whole reason the sim exists, so if they and the physics ever disagree, the
   physics is right and the drawing is wrong. */
(function () {
  const RC = window.RC || (window.RC = {});

  const KE = '#e8963c';        // kinetic — warm, it's motion
  const PE = '#4a90d9';        // gravitational potential — height
  const TH = '#a0574a';        // thermal — losses
  const SUPPLIED = '#15304d';  // the line everything should add up to

  const GRID = 'rgba(21, 48, 77, 0.12)';
  const AXIS = 'rgba(21, 48, 77, 0.35)';
  const LABEL = '#55708d';

  const FONT = '10px "Trebuchet MS", "Segoe UI", sans-serif';
  const FONT_BOLD = 'bold 10px "Trebuchet MS", "Segoe UI", sans-serif';

  /* Size a canvas to its CSS box at device resolution. */
  function fit(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /* Energies are joules but read better in kJ once a train is involved. */
  const kJ = j => j / 1000;

  function fmt(j) {
    const k = kJ(j);
    if (Math.abs(k) >= 100) return k.toFixed(0) + ' kJ';
    if (Math.abs(k) >= 10) return k.toFixed(1) + ' kJ';
    return k.toFixed(2) + ' kJ';
  }
  RC.fmtEnergy = fmt;

  /* The vertical scale is held across a run so the bars don't jump about as
     energy moves between them; it only ever grows, and resets with the sim. */
  let barScale = 0;
  RC.resetEnergyScale = function () { barScale = 0; };

  /* ---- stacked bars ------------------------------------------------------ */
  RC.drawEnergyBars = function (canvas) {
    const f = fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const e = RC.energy();

    const supplied = Math.max(e.supplied, e.total);
    barScale = Math.max(barScale, supplied * 1.12, 1);

    const padL = 34, padR = 8, padT = 12, padB = 22;
    const plotH = h - padT - padB;
    const plotW = w - padL - padR;
    const y = j => padT + plotH * (1 - j / barScale);

    // Horizontal gridlines.
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = LABEL;
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const steps = 4;
    for (let n = 0; n <= steps; n++) {
      const j = barScale * n / steps;
      const yy = Math.round(y(j)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.fillText(kJ(j).toFixed(0), padL - 5, yy);
    }

    const bars = [
      { label: 'KE', value: e.ke, colour: KE },
      { label: 'GPE', value: e.pe, colour: PE },
      { label: 'Heat', value: e.thermal, colour: TH },
      { label: 'Total', stack: [e.ke, e.pe, e.thermal], colours: [KE, PE, TH] }
    ];

    const slot = plotW / bars.length;
    const bw = Math.min(34, slot * 0.62);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let n = 0; n < bars.length; n++) {
      const b = bars[n];
      const cx = padL + slot * (n + 0.5);
      const x = cx - bw / 2;

      if (b.stack) {
        let base = 0;
        for (let k = 0; k < b.stack.length; k++) {
          const v = b.stack[k];
          if (v <= 0) continue;
          const yTop = y(base + v), yBot = y(base);
          ctx.fillStyle = b.colours[k];
          ctx.fillRect(x, yTop, bw, Math.max(0, yBot - yTop));
          base += v;
        }
      } else if (b.value > 0) {
        const yTop = y(b.value);
        ctx.fillStyle = b.colour;
        ctx.fillRect(x, yTop, bw, Math.max(0, y(0) - yTop));
      }

      ctx.fillStyle = LABEL;
      ctx.font = FONT;
      ctx.fillText(b.label, cx, h - padB + 5);
    }

    // The line every bar has to add up to: what the ride started with plus
    // whatever the chain lift has put in.
    const ySup = Math.round(y(e.supplied)) + 0.5;
    ctx.strokeStyle = SUPPLIED;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, ySup);
    ctx.lineTo(w - padR, ySup);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = SUPPLIED;
    ctx.font = FONT_BOLD;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('supplied', padL + 3, ySup - 2);

    // Axis.
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
    ctx.lineTo(w - padR, padT + plotH + 0.5);
    ctx.stroke();

    ctx.fillStyle = LABEL;
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('kJ', 4, padT - 9);
  };

  /* ---- energy against distance ------------------------------------------ */
  RC.drawEnergyGraph = function (canvas) {
    const f = fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const trace = RC.sim.trace;
    const total = RC.trackPath().total;

    const padL = 36, padR = 8, padT = 10, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
    ctx.lineTo(padL + plotW, padT + plotH + 0.5);
    ctx.stroke();

    if (!trace.length || total <= 0) {
      ctx.fillStyle = LABEL;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Run the train to plot its energy', padL + plotW / 2, padT + plotH / 2);
      return;
    }

    let top = 0;
    for (const p of trace) top = Math.max(top, p.total, p.supplied);
    top = Math.max(top * 1.1, 1);

    const X = s => padL + plotW * Math.min(1, Math.max(0, s / total));
    const Y = j => padT + plotH * (1 - j / top);

    // Gridlines.
    ctx.strokeStyle = GRID;
    ctx.fillStyle = LABEL;
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let n = 0; n <= 4; n++) {
      const j = top * n / 4;
      const yy = Math.round(Y(j)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillText(kJ(j).toFixed(0), padL - 5, yy);
    }

    const series = [
      { key: 'supplied', colour: SUPPLIED, dash: [4, 3], width: 1.5 },
      { key: 'total', colour: '#0d9488', dash: [], width: 2 },
      { key: 'pe', colour: PE, dash: [], width: 1.6 },
      { key: 'ke', colour: KE, dash: [], width: 1.6 }
    ];

    for (const ser of series) {
      ctx.strokeStyle = ser.colour;
      ctx.lineWidth = ser.width;
      ctx.setLineDash(ser.dash);
      ctx.beginPath();
      let started = false;
      let prevS = null;
      for (const p of trace) {
        const x = X(p.s), y = Y(p[ser.key]);
        // A lap wrapping past the start line shouldn't draw a line straight
        // back across the plot.
        if (started && prevS !== null && p.s < prevS - total * 0.5) started = false;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
        prevS = p.s;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Where the train is now.
    const last = trace[trace.length - 1];
    const xNow = X(last.s);
    ctx.strokeStyle = 'rgba(21,48,77,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xNow, padT);
    ctx.lineTo(xNow, padT + plotH);
    ctx.stroke();

    ctx.fillStyle = LABEL;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('0', padL, padT + plotH + 4);
    ctx.fillText(total.toFixed(0) + ' m along the track', padL + plotW / 2, padT + plotH + 4);
  };

  /* ---- ride report ------------------------------------------------------- */
  function row(label, value) {
    return `<div class="readout-row"><span>${label}</span><span>${value}</span></div>`;
  }

  /* A plain-English read on how the ride feels, from the g extremes. */
  RC.rideVerdict = function (sim) {
    if (sim.minVertG < -1.5) {
      return 'This ride would throw riders out of the train. It needs less speed over ' +
             'the crests, or gentler ones.';
    }
    if (sim.maxLatG > 1.8) {
      return 'The sideways forces are violent. Wider turns, or less speed entering them, ' +
             'would fix it.';
    }
    if (sim.maxVertG > 5) return 'Brutally heavy through the dips — riders would grey out.';
    if (sim.minVertG < 0) return 'Has genuine airtime over the crests without being dangerous.';
    if (sim.maxVertG < 1.4 && sim.maxLatG < 0.4) return 'A very gentle ride.';
    return 'Forces stay within comfortable limits.';
  };

  /* Colour a live g reading by how comfortable it is. */
  function gColour(value, kind) {
    const m = Math.abs(value);
    if (kind === 'vert') {
      if (value < -1.5 || value > 5) return '#b3261e';
      if (value < 0 || value > 3.5) return '#b06a12';
      return '#15304d';
    }
    if (m > 1.8) return '#b3261e';
    if (m > 1.0) return '#b06a12';
    return '#15304d';
  }
  RC.gColour = gColour;

  RC.updateReport = function () {
    const el = document.getElementById('report-body');
    if (!el) return;
    const sim = RC.sim;
    const e = RC.energy();
    const st = RC.circuitStatus();

    if (!sim.time) {
      el.innerHTML = `<p class="hint">Press <strong>Test</strong> to run the train, ` +
                     `then its statistics appear here.</p>` +
                     row('Track length', RC.trackLength().toFixed(0) + ' m') +
                     row('Circuit', st.label);
      return;
    }

    const drift = Math.abs(e.total - e.supplied);
    const driftPct = e.supplied > 0 ? 100 * drift / e.supplied : 0;

    let html = '';
    if (sim.note) html += `<p class="report-note">${sim.note}</p>`;

    html += `<div class="report-hd">Ride</div>`;
    html += row('Top speed', (sim.maxV * 3.6).toFixed(0) + ' km/h');
    html += row('Highest point', sim.maxZ.toFixed(1) + ' m');
    html += row('Ride time', sim.time.toFixed(1) + ' s');
    html += row('Track length', RC.trackLength().toFixed(0) + ' m');

    html += `<div class="report-hd">G-force</div>`;
    html += row('Vertical, greatest', sim.maxVertG.toFixed(2) + ' g');
    html += row('Vertical, least', sim.minVertG.toFixed(2) + ' g');
    html += row('Lateral, greatest', sim.maxLatG.toFixed(2) + ' g');
    html += `<p class="hint">Vertical is 1.00&nbsp;g sitting still; below zero the riders ` +
            `leave their seats. Lateral is sideways: banking a turn tilts the track so ` +
            `some of that force pushes riders into their seats instead of across them.</p>`;
    html += `<p class="hint">${RC.rideVerdict(sim)}</p>`;

    html += `<div class="report-hd">Energy</div>`;
    html += row('Started with', fmt(sim.E0));
    html += row('Chain lift added', fmt(sim.eMotor));
    html += row('Lost to heat', fmt(sim.eThermal));
    html += row('Kinetic now', fmt(e.ke));
    html += row('Potential now', fmt(e.pe));
    html += row('<strong>Total now</strong>', '<strong>' + fmt(e.total) + '</strong>');
    html += row('<strong>Supplied</strong>', '<strong>' + fmt(e.supplied) + '</strong>');

    if (driftPct > 1) {
      html += `<p class="report-warn">Energy is not adding up (${driftPct.toFixed(1)}% out) — ` +
              `this is a bug in the simulation, not something you did.</p>`;
    }

    if (sim.warnings.length) {
      html += `<div class="report-hd">Warnings</div>`;
      for (const wmsg of sim.warnings) html += `<p class="report-warn">${wmsg}</p>`;
    }

    el.innerHTML = html;
  };
})();
