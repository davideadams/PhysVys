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
  const TOTAL = '#0d9488';     // the three of them added up
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

  /* What each line plot is drawn in, so anything that has to LABEL one — the
     exported summary carries its own key, having no app around it — reads the
     colours off the same list the canvas is painted from and cannot drift out
     of step with it. The window's own legends are in index.html beside the
     canvas, where a wrong colour is obvious on sight. */
  RC.GRAPH_KEY = {
    energy: [
      { colour: KE, label: 'Kinetic' },
      { colour: PE, label: 'Potential' },
      { colour: TH, label: 'Heat', onlyWithHeat: true },
      { colour: TOTAL, label: 'Total' },
      { dashed: true, label: 'Supplied' }
    ],
    accel: [
      { colour: VERT_G, label: 'Vertical g' },
      { colour: LAT_G, label: 'Lateral g' },
      { dashed: true, label: '1 g (sitting still)' },
      { colour: 'rgba(198,40,40,0.35)', label: 'Beyond real limits' }
    ],
    // One line and a labelled axis needs no key.
    speed: []
  };

  /* Four plots share one window: 'bars' is the train's energy right now; the
     other three plot the whole ride. Anything unrecognised falls back to the
     bars, which is what the window opens on. */
  const GRAPH_MODES = ['bars', 'energy', 'accel', 'speed'];
  let graphMode = 'bars';
  RC.setGraphMode = function (m) {
    graphMode = GRAPH_MODES.indexOf(m) >= 0 ? m : 'bars';
  };
  RC.graphMode = () => graphMode;

  /* Which way the line plots run. Distance answers "where on the track does
     this happen"; time answers "how long does it last", and the two are not
     the same shape at all — a crest the train crawls over is narrow against
     distance and wide against time. Only the time axis gives a speed plot the
     shape of the v-t graph a student is taught to read. The trace has recorded
     both all along, so this costs nothing but the axis itself. */
  const GRAPH_AXES = ['s', 't'];
  let graphAxis = 's';
  RC.setGraphAxis = function (a) {
    graphAxis = GRAPH_AXES.indexOf(a) >= 0 ? a : 's';
  };
  RC.graphAxis = () => graphAxis;

  /* Sample indices where a lap wraps past the start line. Against distance the
     line would streak back across the plot from right to left, so the polyline
     is broken there. Against time nothing ever goes backwards and there is
     nothing to break — which is also why a shuttle's return leg must not be
     broken here: it retraces the track legitimately, and only a jump of half a
     lap or more is a wrap. */
  function lapBreaks(trace, total) {
    const at = new Set();
    if (graphAxis !== 's' || !(total > 0)) return at;
    for (let n = 1; n < trace.length; n++) {
      if (trace[n].s < trace[n - 1].s - total * 0.5) at.add(n);
    }
    return at;
  }

  function plotSeries(ctx, trace, key, xOf, Y, breaks, colour, width, dash) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    let started = false;
    for (let n = 0; n < trace.length; n++) {
      const p = trace[n];
      if (breaks.has(n)) started = false;
      const x = xOf(p), y = Y(p[key]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
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

  /* Which feature the train was in, sample by sample, collapsed into runs.

     Taken from where the train actually WAS rather than from the track's own
     distance intervals. Against distance the two agree; against time a
     distance interval has no one place to sit, since a lap can visit the same
     turn twice at two different times. So the bands have to come from the
     trace for the time axis, and one code path is worth more than two. It also
     stops the plot shading track the train never reached, which a run that
     crashed halfway used to do.

     Cached on the trace length and track version: during a run the trace grows
     by a sample a frame so this is recomputed anyway, but once the train has
     stopped it settles and the featureAt scan stops repeating. */
  let bandCache = null, bandKey = '';
  function traceBands(trace) {
    const key = trace.length + ':' + RC.version;
    if (bandCache && bandKey === key) return bandCache;
    const runs = [];
    let cur = null;
    for (let n = 0; n < trace.length; n++) {
      let f = null;
      try { f = RC.featureAt(trace[n].s); } catch (e) { f = null; }
      const id = f && f.label ? f.type + ' ' + f.label : '';
      if (!cur || cur.id !== id) {
        cur = { id, type: f && f.type, label: f && f.label, from: n, to: n };
        runs.push(cur);
      } else {
        cur.to = n;
      }
    }
    bandCache = runs.filter(b => b.id);
    bandKey = key;
    return bandCache;
  }

  /* Shaded bands behind the plot, one per stretch of named feature. */
  function drawFeatureBands(ctx, trace, bands, xOf, padT, plotH) {
    ctx.save();
    for (const b of bands) {
      const c = FEATURE_COLOURS[b.type];
      if (!c) continue;
      const x0 = xOf(trace[b.from]), x1 = xOf(trace[b.to]);
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
  function drawFeatureLabels(ctx, trace, bands, xOf, padT) {
    ctx.save();
    ctx.font = 'bold 9px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (const b of bands) {
      const c = FEATURE_COLOURS[b.type];
      if (!c) continue;
      const x0 = xOf(trace[b.from]), x1 = xOf(trace[b.to]);
      const w = ctx.measureText(b.label).width + 7;
      if (x1 - x0 < w * 0.55) continue;        // too narrow to name
      const x = Math.max(x0 + w / 2, Math.min(x1 - w / 2, (x0 + x1) / 2));
      if (x - w / 2 < lastRight + 1) continue; // would collide with the last tab
      lastRight = x + w / 2;
      ctx.fillStyle = c.tab;
      ctx.fillRect(x - w / 2, padT, w, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.label, x, padT + 2);
    }
    ctx.restore();
  }

  /* A crosshair wherever the reader is pointing, and the sample under it
     published for the readout beside the graph. Without it the only way to ask
     "how fast was it at 40 m" was to open the exported CSV.

     Pointer position comes in as a CSS pixel along the canvas — fit() sets the
     transform to the device ratio, so drawing coordinates are CSS pixels and
     an offsetX needs no conversion. */
  let cursorX = null;
  RC.graphCursor = null;
  RC.setGraphCursor = function (x) {
    cursorX = (x == null || !isFinite(x)) ? null : x;
    if (cursorX === null) RC.graphCursor = null;
  };

  function drawCursor(ctx, trace, xOf, padL, padT, plotW, plotH) {
    RC.graphCursor = null;
    if (cursorX === null || cursorX < padL || cursorX > padL + plotW) return;

    /* Nearest sample by x. On a distance plot of a completed lap two samples
       share an x — the way out and the way home — and this takes whichever is
       nearer, then the earlier of equals. Against time every x is unique. */
    let best = null, bestD = Infinity;
    for (const p of trace) {
      const d = Math.abs(xOf(p) - cursorX);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    RC.graphCursor = best;

    const x = Math.round(xOf(best)) + 0.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(21,48,77,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
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

    /* The axis. Distance spans the whole track whether or not the train got
       round it, so two runs of the same track are directly comparable; time
       spans however long this run has lasted, which is all there is to span. */
    const tEnd = trace[trace.length - 1].t;
    const span = graphAxis === 's' ? total : Math.max(tEnd, 0.001);
    const xOf = p => padL + plotW * Math.min(1, Math.max(0, p[graphAxis] / span));

    const bands = traceBands(trace);
    const breaks = lapBreaks(trace, total);

    // Feature bands go down first so the traces read on top of them.
    drawFeatureBands(ctx, trace, bands, xOf, padT, plotH);

    const args = [ctx, trace, xOf, breaks, padL, padT, plotW, plotH];
    if (graphMode === 'accel') drawAccel.apply(null, args);
    else if (graphMode === 'speed') drawSpeed.apply(null, args);
    else drawEnergy.apply(null, args);

    drawFeatureLabels(ctx, trace, bands, xOf, padT);

    // Where the train is now.
    const xNow = xOf(trace[trace.length - 1]);
    ctx.strokeStyle = 'rgba(21,48,77,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xNow, padT);
    ctx.lineTo(xNow, padT + plotH);
    ctx.stroke();

    drawCursor(ctx, trace, xOf, padL, padT, plotW, plotH);

    ctx.fillStyle = LABEL;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('0', padL, padT + plotH + 4);
    ctx.fillText(graphAxis === 's'
      ? total.toFixed(0) + ' m along the track'
      : tEnd.toFixed(1) + ' s since it set off',
      padL + plotW / 2, padT + plotH + 4);
  };

  /* Has this ride actually made any heat worth a line of its own?

     With friction off and no brake run there is nothing for a heat trace to
     do but lie flat along the bottom of the plot, which is one more line to
     read for no information. Turn friction on — or run through brakes — and
     it becomes the most interesting line on the graph: the one that only
     ever goes up, and that explains exactly why the total is sagging away
     from the supplied line. The same test drives the legend, so the key
     never names a colour that isn't on the plot. */
  function tracedHeat(trace) {
    for (const p of trace) if (p.th > 1) return true;
    return false;
  }
  RC.graphHasHeat = () => tracedHeat(RC.sim.trace);

  /* Gridlines with a labelled value at each, and the unit in the top-left
     corner. Shared by all three line plots so their furniture matches. */
  function drawScale(ctx, Y, values, label, padL, padT, plotW, fmtV, zeroAt) {
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of values) {
      const yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = (zeroAt && v === 0) ? 'rgba(21,48,77,0.3)' : GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = LABEL;
      ctx.fillText(fmtV(v), padL - 5, yy);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = LABEL;
    ctx.fillText(label, 3, padT - 4);
  }

  function drawAxes(ctx, padL, padT, plotW, plotH, withBase) {
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + 0.5, padT);
    ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
    if (withBase) ctx.lineTo(padL + plotW, padT + plotH + 0.5);
    ctx.stroke();
  }

  function drawEnergy(ctx, trace, xOf, breaks, padL, padT, plotW, plotH) {
    let top = 0;
    for (const p of trace) top = Math.max(top, p.total, p.supplied);
    top = Math.max(top * 1.1, 1);
    const Y = j => padT + plotH * (1 - j / top);

    const marks = [];
    for (let n = 0; n <= 4; n++) marks.push(top * n / 4);
    drawScale(ctx, Y, marks, 'kJ', padL, padT, plotW, v => kJ(v).toFixed(0), false);

    plotSeries(ctx, trace, 'supplied', xOf, Y, breaks, SUPPLIED, 1.5, [4, 3]);
    plotSeries(ctx, trace, 'total', xOf, Y, breaks, TOTAL, 2);
    // Heat under the two it is stealing from, so they stay the easiest to
    // follow — it is a slow climb, they are the ones swapping back and forth.
    if (tracedHeat(trace)) plotSeries(ctx, trace, 'th', xOf, Y, breaks, TH, 1.6);
    plotSeries(ctx, trace, 'pe', xOf, Y, breaks, PE, 1.6);
    plotSeries(ctx, trace, 'ke', xOf, Y, breaks, KE, 1.6);

    drawAxes(ctx, padL, padT, plotW, plotH, true);
  }

  /* Speed on its own. Kinetic energy is what the physics turns on, but "how
     fast is it going here" is the question students actually ask, and it was
     only ever available as a live number or a column of the exported CSV.
     Against time this is the v-t graph off the syllabus. */
  function drawSpeed(ctx, trace, xOf, breaks, padL, padT, plotW, plotH) {
    let top = 1;
    for (const p of trace) top = Math.max(top, p.v);
    top = Math.max(top * 1.1, 1);
    const Y = v => padT + plotH * (1 - v / top);

    const marks = [];
    for (let n = 0; n <= 4; n++) marks.push(top * n / 4);
    drawScale(ctx, Y, marks, 'm/s', padL, padT, plotW, v => v.toFixed(0), false);

    plotSeries(ctx, trace, 'v', xOf, Y, breaks, KE, 2);
    drawAxes(ctx, padL, padT, plotW, plotH, true);
  }

  function drawAccel(ctx, trace, xOf, breaks, padL, padT, plotW, plotH) {
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

    /* The envelope a real ride has to stay inside, from RC.G_LIMITS — the same
       figures the report judges the track against. It used to say so only in
       words, which left a student reading "4.8 g on Turn 2 is more than a real
       coaster is allowed" while looking at a plot that gave no hint where the
       line was.

       Drawn only where it falls inside the plot. Forcing 5 g into range would
       squash every ordinary ride into the bottom of the box to make room for a
       limit it never goes near. */
    const L = RC.G_LIMITS;
    const shade = (from, to) => {
      const a = Math.min(Math.max(from, lo), hi);
      const b = Math.min(Math.max(to, lo), hi);
      if (b - a < 1e-9) return;
      ctx.fillStyle = 'rgba(198,40,40,0.10)';
      ctx.fillRect(padL, Y(b), plotW, Y(a) - Y(b));
    };
    shade(L.vertHigh, hi);          // pressed into the seat harder than allowed
    shade(lo, L.airtimeGood);       // thrown out of it harder than allowed

    // Gridline at every whole g.
    const marks = [];
    for (let g = Math.ceil(lo); g <= Math.floor(hi); g++) marks.push(g);
    drawScale(ctx, Y, marks, 'g', padL, padT, plotW, v => v.toFixed(0), true);

    // Dashed reference at 1 g — what a rider feels sitting still.
    const dashAt = (g, colour) => {
      if (g < lo || g > hi) return;
      const yy = Math.round(Y(g)) + 0.5;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    dashAt(1, 'rgba(21,48,77,0.28)');
    // Sideways has its own, much lower, limit — and a band would be read as
    // applying to the vertical trace, so it gets lines in its own colour.
    dashAt(L.latHigh, 'rgba(194,24,91,0.38)');
    dashAt(-L.latHigh, 'rgba(194,24,91,0.38)');

    plotSeries(ctx, trace, 'vg', xOf, Y, breaks, VERT_G, 1.8);
    plotSeries(ctx, trace, 'lg', xOf, Y, breaks, LAT_G, 1.8);

    // No baseline: zero g is a gridline inside the plot, not the floor of it.
    drawAxes(ctx, padL, padT, plotW, plotH, false);
  }

  /* ---- ride report ------------------------------------------------------- */
  function row(label, value) {
    return `<div class="readout-row"><span>${label}</span><span>${value}</span></div>`;
  }

  /* Name the feature a distance falls on, rather than quoting the distance.
     Tolerant of a track that has changed under an old figure. */
  function onFeature(s, nudge) {
    let f = null;
    try { f = (s == null) ? null : RC.featureAt(s + (nudge || 0)); } catch (e) { f = null; }
    return f ? ` <span class="muted">on ${f.label}</span>` : '';
  }

  /* A radius in words. Which plane the bend is in, and which way, is more use
     to a builder than the two signed curvatures it comes from. */
  RC.radiusText = function (kVert, kLat) {
    const parts = [];
    const kv = Math.abs(kVert || 0), kl = Math.abs(kLat || 0);
    if (kv > 1e-4) parts.push(`${(1 / kv).toFixed(0)} m ${kVert < 0 ? 'crest' : 'valley'}`);
    if (kl > 1e-4) parts.push(`${(1 / kl).toFixed(0)} m turn`);
    return parts.length ? parts.join(', ') : 'straight';
  };

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
    return html;
  }

  /* What the run was made under. Two students handing in the same track get
     different numbers if one had friction on, so the conditions have to travel
     with the figures or the figures cannot be compared.

     Only what bears on this track is listed: the friction constants are no use
     when friction is off, and a lift speed means nothing on a ride with no
     chain on it. */
  function settingsSection() {
    const sim = RC.sim;
    let hasLift = false, hasBrake = false, hasLaunch = false;
    for (const p of RC.track.pieces) {
      const def = RC.pieceDef(p.defId);
      if (p.lift) hasLift = true;
      if (def.brake) hasBrake = true;
      if (def.launch) hasLaunch = true;
    }

    let html = `<div class="report-hd">Settings</div>`;
    // Mass and length both, since either can be changed on its own and either
    // changes the ride. A report that only said "2.0 t" would not distinguish
    // four 500 kg cars from two of a tonne, which do not ride the same.
    html += row('Train', `${sim.cars} ${sim.cars === 1 ? 'car' : 'cars'} at ` +
                         `${sim.carMass} kg, ${(RC.trainMass() / 1000).toFixed(2)} t`);
    html += row('Released from', sim.releaseS == null
      ? 'the station' : sim.releaseS.toFixed(1) + ' m along');
    html += row('Friction', sim.friction ? 'on' : 'off');
    if (sim.friction) {
      html += row('Rolling resistance <span class="muted">&mu;</span>', sim.mu.toFixed(3));
      html += row('Air drag <span class="muted">k</span>', sim.kDrag.toFixed(4));
    }
    if (hasLift) html += row('Chain lift speed', sim.liftSpeed.toFixed(1) + ' m/s');
    if (hasBrake) html += row('Brake speed', sim.brakeSpeed.toFixed(1) + ' m/s');
    if (hasLaunch) html += row('Launch speed', sim.launchSpeed.toFixed(1) + ' m/s');
    return html;
  }

  /* What the SHAPE of the track allows, as opposed to what this particular run
     did on it. Available before the train has moved, which is the point: a
     student can check whether the corner they just laid can carry the speed
     they are about to arrive at, instead of finding out from a warning.

     "Honest to" is the speed at which the first published limit is broken
     somewhere on the track — see RC.trackGeometry. If the run beat it, that is
     said plainly, because a ride judged against limits its own pieces cannot
     meet is the problem this readout exists to make visible. */
  function geometrySection() {
    const geo = RC.trackGeometry();
    const sim = RC.sim;
    // A park with nothing but level straight track in it has no shape to
    // report, and three em dashes would say less than nothing.
    if (geo.crestR === null && geo.valleyR === null && geo.turnR === null) return '';
    const R = (r, s) => r === null ? '—' : r.toFixed(1) + ' m' + onFeature(s);

    let html = `<div class="report-hd">Shape</div>`;
    html += row('Tightest crest', R(geo.crestR, geo.crestS));
    html += row('Tightest valley', R(geo.valleyR, geo.valleyS));
    html += row('Tightest turn', R(geo.turnR, geo.turnS));
    if (geo.honestV !== null) {
      html += row('Within the limits to',
                  `${geo.honestV.toFixed(1)} m/s <span class="muted">` +
                  `(${geo.honestWhy})</span>${onFeature(geo.honestS)}`);
    }

    // The worst jolts this run actually took. A joint the train never reached
    // has no entry, so an untested corner is silent rather than reassuring.
    const jolts = RC.worstJolts ? RC.worstJolts(3) : [];
    if (jolts.length && jolts[0].g > 0.05) {
      html += `<div class="report-hd">Jolts</div>`;
      for (const j of jolts) {
        if (j.g <= 0.05) continue;
        // Plain track is deliberately unnamed, so a jolt on it would otherwise
        // say only how fast the train was going — no use to someone trying to
        // find the joint. Fall back to the distance, which always locates it.
        const where = onFeature(j.s, 0.05) ||
                      ` <span class="muted">at ${j.s.toFixed(0)} m</span>`;
        html += row(`At ${j.v.toFixed(1)} m/s${where}`,
                    j.g.toFixed(2) + ' g, all at once');
      }
      html += `<p class="report-note">Each piece meets the next with a step in ` +
              `curvature, so that much force arrives with nothing leading up to ` +
              `it. Real track eases every joint in and out instead.</p>`;
    }

    if (geo.honestV !== null && sim.maxV > geo.honestV + 0.05) {
      html += `<p class="report-warn">This track reached ${sim.maxV.toFixed(1)} m/s ` +
              `but its shape only stays within the limits to ` +
              `${geo.honestV.toFixed(1)} m/s.</p>`;
    }
    return html;
  }

  /* The report as a string, so it can be written to the page or dropped into an
     exported document without either having to know about the other. */
  RC.reportHTML = function () {
    const sim = RC.sim;
    const e = RC.energy();
    const st = RC.circuitStatus();

    if (!sim.time) {
      return row('Track length', RC.trackLength().toFixed(0) + ' m') +
             row('Circuit', st.label) +
             settingsSection() +
             geometrySection();
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

    html += settingsSection();

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

    const L = RC.G_LIMITS;

    html += geometrySection();

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

    return html;
  };

  RC.updateReport = function () {
    const el = document.getElementById('report-body');
    if (el) el.innerHTML = RC.reportHTML();
  };
})();
