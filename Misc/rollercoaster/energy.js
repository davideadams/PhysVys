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

  /* ---- graph against distance -------------------------------------------
     Two modes over the same x-axis (distance along the track): energy, and
     the g-forces the rider feels. The turn/loop overlay is drawn in both, so
     a spike can be read off against the piece that caused it. */
  const VERT_G = '#0d9488';   // vertical g
  const LAT_G = '#c2185b';    // lateral g

  /* Three plots share one window: 'bars' is the train's energy right now,
     'energy' and 'accel' are the whole ride against distance along the track.
     Anything unrecognised falls back to the bars, which is what the window
     opens on. */
  const GRAPH_MODES = ['bars', 'energy', 'accel'];
  let graphMode = 'bars';
  RC.setGraphMode = function (m) {
    graphMode = GRAPH_MODES.indexOf(m) >= 0 ? m : 'bars';
  };
  RC.graphMode = () => graphMode;

  /* Draw one trace series as a polyline, breaking where a lap wraps past the
     start line rather than streaking back across the plot. */
  function plotSeries(ctx, trace, key, X, Y, total, colour, width, dash) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let started = false, prevS = null;
    for (const p of trace) {
      const x = X(p.s), y = Y(p[key]);
      if (started && prevS !== null && p.s < prevS - total * 0.5) started = false;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
      prevS = p.s;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Each named feature of the ride gets its own colour, so the plot reads as
     a strip map: it is obvious where Turn 1 ends and Hill 1 begins. Bands are
     drawn behind the traces, deliberately pale, with the solid version used for
     the label tab on top. */
  const FEATURE_COLOURS = {
    lift:    { band: 'rgba(184,134,11,0.16)',  tab: 'rgba(150,108,8,0.92)' },
    hill:    { band: 'rgba(47,133,90,0.16)',   tab: 'rgba(38,110,74,0.92)' },
    drop:    { band: 'rgba(31,111,178,0.16)',  tab: 'rgba(26,92,148,0.92)' },
    turn:    { band: 'rgba(194,24,91,0.14)',   tab: 'rgba(163,20,76,0.92)' },
    loop:    { band: 'rgba(111,63,150,0.18)',  tab: 'rgba(95,52,130,0.94)' },
    brake:   { band: 'rgba(140,59,59,0.14)',   tab: 'rgba(118,49,49,0.92)' },
    launch:  { band: 'rgba(111,63,150,0.14)',  tab: 'rgba(95,52,130,0.92)' },
    station: { band: 'rgba(89,99,109,0.12)',   tab: 'rgba(74,83,92,0.9)' }
  };
  RC.FEATURE_COLOURS = FEATURE_COLOURS;

  /* Shaded bands behind the plot, one per named feature. */
  function drawFeatureBands(ctx, X, padT, plotH) {
    let feats;
    try { feats = RC.features(); } catch (e) { return; }
    ctx.save();
    for (const f of feats) {
      if (!f.label) continue;
      const c = FEATURE_COLOURS[f.type];
      if (!c) continue;
      const x0 = X(f.s0), x1 = X(f.s1);
      if (x1 - x0 < 0.5) continue;
      ctx.fillStyle = c.band;
      ctx.fillRect(x0, padT, x1 - x0, plotH);
      // A firmer edge at the boundary, so entering a feature is a visible line.
      ctx.strokeStyle = c.tab;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, padT);
      ctx.lineTo(x0 + 0.5, padT + plotH);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* Name tabs along the top, drawn over the traces. Labels are dropped where
     the band is too narrow to hold one rather than overprinting a neighbour. */
  function drawFeatureLabels(ctx, X, padT) {
    let feats;
    try { feats = RC.features(); } catch (e) { return; }
    ctx.save();
    ctx.font = 'bold 9px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (const f of feats) {
      if (!f.label) continue;
      const c = FEATURE_COLOURS[f.type];
      if (!c) continue;
      const x0 = X(f.s0), x1 = X(f.s1);
      const w = ctx.measureText(f.label).width + 7;
      if (x1 - x0 < w * 0.55) continue;        // too narrow to name
      const x = Math.max(x0 + w / 2, Math.min(x1 - w / 2, X(f.sMid)));
      if (x - w / 2 < lastRight + 1) continue; // would collide with the last tab
      lastRight = x + w / 2;
      ctx.fillStyle = c.tab;
      ctx.fillRect(x - w / 2, padT, w, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(f.label, x, padT + 2);
    }
    ctx.restore();
  }

  RC.drawEnergyGraph = function (canvas) {
    const f = fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const trace = RC.sim.trace;
    const total = RC.trackPath().total;

    const padL = 36, padR = 8, padT = 14, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const X = s => padL + plotW * Math.min(1, Math.max(0, s / total));

    if (!trace.length || total <= 0) {
      ctx.strokeStyle = AXIS;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL + 0.5, padT);
      ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
      ctx.lineTo(padL + plotW, padT + plotH + 0.5);
      ctx.stroke();
      ctx.fillStyle = LABEL;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Run the train to plot the ride', padL + plotW / 2, padT + plotH / 2);
      return;
    }

    // Feature bands go down first so the traces read on top of them.
    drawFeatureBands(ctx, X, padT, plotH);

    if (graphMode === 'accel') drawAccel(ctx, trace, total, X, padL, padT, plotW, plotH);
    else drawEnergy(ctx, trace, total, X, padL, padT, plotW, plotH);

    drawFeatureLabels(ctx, X, padT);

    // Where the train is now.
    const xNow = X(trace[trace.length - 1].s);
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

  function drawEnergy(ctx, trace, total, X, padL, padT, plotW, plotH) {
    let top = 0;
    for (const p of trace) top = Math.max(top, p.total, p.supplied);
    top = Math.max(top * 1.1, 1);
    const Y = j => padT + plotH * (1 - j / top);

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
    ctx.textAlign = 'left';
    ctx.fillText('kJ', 3, padT - 4);

    plotSeries(ctx, trace, 'supplied', X, Y, total, SUPPLIED, 1.5, [4, 3]);
    plotSeries(ctx, trace, 'total', X, Y, total, '#0d9488', 2);
    plotSeries(ctx, trace, 'pe', X, Y, total, PE, 1.6);
    plotSeries(ctx, trace, 'ke', X, Y, total, KE, 1.6);

    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
    ctx.lineTo(padL + plotW, padT + plotH + 0.5);
    ctx.stroke();
  }

  function drawAccel(ctx, trace, total, X, padL, padT, plotW, plotH) {
    // Range always spans 0..1 g (weightless to sitting still) plus the data,
    // so the 1 g reference line is meaningful and airtime shows below zero.
    let lo = -0.5, hi = 1.4;
    for (const p of trace) {
      lo = Math.min(lo, p.vg, p.lg);
      hi = Math.max(hi, p.vg, Math.abs(p.lg));
    }
    lo = Math.floor(lo * 2) / 2;
    hi = Math.ceil(hi * 2) / 2;
    const Y = g => padT + plotH * (1 - (g - lo) / (hi - lo));

    // Gridline at every whole g.
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = Math.ceil(lo); g <= Math.floor(hi); g++) {
      const yy = Math.round(Y(g)) + 0.5;
      ctx.strokeStyle = (g === 0) ? 'rgba(21,48,77,0.3)' : GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = LABEL;
      ctx.fillText(g.toFixed(0), padL - 5, yy);
    }

    // Dashed reference at 1 g — what a rider feels sitting still.
    const y1 = Math.round(Y(1)) + 0.5;
    ctx.strokeStyle = 'rgba(21,48,77,0.28)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, y1);
    ctx.lineTo(padL + plotW, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'left';
    ctx.fillStyle = LABEL;
    ctx.fillText('g', 3, padT - 4);

    plotSeries(ctx, trace, 'vg', X, Y, total, VERT_G, 1.8);
    plotSeries(ctx, trace, 'lg', X, Y, total, LAT_G, 1.8);

    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
    ctx.stroke();
  }

  /* ---- ride report ------------------------------------------------------- */
  function row(label, value) {
    return `<div class="readout-row"><span>${label}</span><span>${value}</span></div>`;
  }

  /* A plain-English read on how the ride feels, from the g extremes. */
  RC.rideVerdict = function (sim) {
    // A wreck outranks any comment on comfort.
    if (sim.state === 'crashed') {
      return sim.overhang && sim.overhang.cause === 'inverted'
        ? 'The train fell out of the loop and crashed. It needed more speed going in — ' +
          'a bigger drop before it, or a smaller loop.'
        : 'The train left the track and crashed. It needed a slower launch, or more ' +
          'height at the end to climb against.';
    }
    const L = RC.G_LIMITS;
    if (sim.minVertG < L.airtimeHard) {
      return 'This ride would throw riders out of the train. It needs less speed over ' +
             'the crests, or gentler ones.';
    }
    if (sim.maxLatG > L.latExtreme) {
      return 'The sideways forces are violent. Banking those turns, or widening them, ' +
             'would fix it.';
    }
    if (sim.maxVertG > L.vertExtreme) return 'Brutally heavy through the dips — riders would grey out.';
    if (sim.minVertG < L.airtimeGood) return 'Strong ejector airtime — right at the edge of what restraints hold.';
    if (sim.maxVertG > L.vertHigh) return 'Heavy through the dips, but within what a real ride may pull briefly.';
    if (sim.maxLatG > L.latHigh) return 'Those turns pull harder sideways than most rides allow — bank them.';
    if (sim.minVertG < -0.05) return 'Has genuine airtime over the crests without being dangerous.';
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

  /* The comparison a demo exists to make: a row per train, and the figure that
     matters — the speed each reached at the bottom — lined up underneath each
     other so three different routes can be seen to give one answer. */
  function demoTable() {
    const sim = RC.sim;
    const num = (v, dp, unit) => v === null || v === undefined ? '—' : v.toFixed(dp) + unit;

    // The ride's own train is the first runner; the rest are the demo's.
    const rows = [{
      label: RC.demo.mainLabel,
      colour: RC.demo.mainColour,
      length: RC.trackPath().total,
      tGround: sim.tGround,
      vGround: sim.vGround,
      keGround: sim.vGround === null ? null
              : 0.5 * RC.trainMass() * sim.vGround * sim.vGround
    }];
    for (const tr of RC.demo.trains) {
      const st = RC.demoState(tr);
      rows.push({
        label: tr.label, colour: tr.colour,
        length: st.length, tGround: st.tGround,
        vGround: st.vGround, keGround: st.keGround
      });
    }

    let html = `<div class="report-hd">${RC.demo.label}</div>`;
    html += `<table class="demo-table"><thead><tr>` +
            `<th>Route</th><th>Track</th><th>Time</th><th>Speed</th><th>E<sub>k</sub></th>` +
            `</tr></thead><tbody>`;
    for (const r of rows) {
      html += `<tr>` +
              `<td><i class="demo-key" style="background:${r.colour}"></i>${r.label}</td>` +
              `<td>${num(r.length, 0, ' m')}</td>` +
              `<td>${num(r.tGround, 1, ' s')}</td>` +
              `<td>${num(r.vGround, 1, ' m/s')}</td>` +
              `<td>${r.keGround === null ? '—' : fmt(r.keGround)}</td>` +
              `</tr>`;
    }
    html += `</tbody></table>`;

    // Say plainly whether the speeds agree, and if not, why not.
    const got = rows.filter(r => r.vGround !== null).map(r => r.vGround);
    if (got.length === rows.length) {
      const spread = Math.max.apply(null, got) - Math.min.apply(null, got);
      const ideal = Math.sqrt(2 * 9.81 * RC.demo.drop);
      html += spread <= 0.15
        ? `<p class="report-note">All ${rows.length} reached the bottom at the same speed, ` +
          `about ${ideal.toFixed(1)}&nbsp;m/s — the &radic;(2gh) for a ${RC.demo.drop}&nbsp;m ` +
          `drop, whichever way down they came.</p>`
        : `<p class="report-note">The speeds differ by ${spread.toFixed(1)}&nbsp;m/s. With ` +
          `friction on they must: the losses follow the LENGTH of each path, not the ` +
          `height it drops, so the long shallow route gives up the most.</p>`;
    }
    return html;
  }

  RC.updateReport = function () {
    const el = document.getElementById('report-body');
    if (!el) return;
    const sim = RC.sim;
    const e = RC.energy();
    const st = RC.circuitStatus();

    if (!sim.time) {
      el.innerHTML = row('Track length', RC.trackLength().toFixed(0) + ' m') +
                     row('Circuit', st.label);
      return;
    }

    const drift = Math.abs(e.total - e.supplied);
    const driftPct = e.supplied > 0 ? 100 * drift / e.supplied : 0;

    let html = '';
    if (sim.note) html += `<p class="report-note">${sim.note}</p>`;

    if (RC.demo) html += demoTable();

    html += `<div class="report-hd">Ride</div>`;
    html += row('Top speed', sim.maxV.toFixed(1) + ' m/s');
    html += row('Highest point', sim.maxZ.toFixed(1) + ' m');
    html += row('Ride time', sim.time.toFixed(1) + ' s');
    html += row('Track length', RC.trackLength().toFixed(0) + ' m');

    // Ran off the end: the numbers a student needs to work out how much more
    // spike (or less launch) it would have taken to hold the train.
    if (sim.overhang) {
      const fl = sim.overhang;
      const inverted = fl.cause === 'inverted';
      html += `<div class="report-hd">${inverted ? 'Left the track' : 'Over the end'}</div>`;
      html += row(inverted ? 'Speed when it let go' : 'Speed at the end',
                  fl.v0.toFixed(1) + ' m/s');
      html += row('Height it left at', fl.z0.toFixed(1) + ' m');
      if (sim.wrecked) html += row('Hit the ground at', sim.crashSpeed.toFixed(1) + ' m/s');
      else if (!inverted) html += row('Tipped over the edge', fl.committed ? 'yes' : 'not yet');

      // The physics that decides it, given as figures rather than prose.
      if (inverted) {
        // Upside down, gravity alone supplies the centripetal force, so the
        // train holds on only while v^2 / r >= g — that is, v >= sqrt(gr).
        const r = fl.curv > 1e-6 ? 1 / fl.curv : 0;
        if (r > 0) {
          html += row('Radius there', r.toFixed(1) + ' m');
          html += row('Speed needed <span class="muted">(v = &radic;gr)</span>',
                      Math.sqrt(9.81 * r).toFixed(1) + ' m/s');
        }
      } else {
        // v^2 = 2gh: how much more climb the leftover speed needed.
        const needed = fl.v0 * fl.v0 / (2 * 9.81);
        html += row('Climb needed <span class="muted">(v&sup2; = 2gh)</span>',
                    needed.toFixed(1) + ' m');
        html += row('Height the track needed', (fl.z0 + needed).toFixed(1) + ' m');
      }
    }

    // Name the feature each extreme happened on, rather than a distance.
    const onFeature = s => {
      let f = null;
      try { f = (s == null) ? null : RC.featureAt(s); } catch (e) { f = null; }
      return f ? ` <span class="muted">on ${f.label}</span>` : '';
    };
    const L = RC.G_LIMITS;

    html += `<div class="report-hd">G-force</div>`;
    html += row('Vertical, greatest',
                sim.maxVertG.toFixed(2) + ' g' + onFeature(sim.maxVertGs));
    html += row('Vertical, least',
                sim.minVertG.toFixed(2) + ' g' + onFeature(sim.minVertGs));
    html += row('Lateral, greatest',
                sim.maxLatG.toFixed(2) + ' g' + onFeature(sim.maxLatGs));
    // The published short-burst limits, as a figure to read the rows against
    // rather than a paragraph explaining them.
    html += row('Allowed briefly <span class="muted">(ASTM/EN)</span>',
                `${L.vertHigh} · ${L.airtimeGood} · ${L.latHigh} g`);
    html += `<p class="report-note">${RC.rideVerdict(sim)}</p>`;

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
