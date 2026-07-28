/* Exporting a ride for marking.

   One self-contained HTML file: a picture of the track, the ride report, and
   the graphs, with every image inlined as a data URI so there is nothing to
   lose when it is emailed or dropped in a submission folder. It opens in any
   browser and prints to PDF.

   A spreadsheet was the obvious first thought and is the wrong shape for this.
   The question a teacher is marking — "does it have a loop, and does the energy
   trade the way it should" — is answered by looking at the track and the
   graphs, and a spreadsheet cannot hold either without a chart engine. The
   numbers ride along in tables regardless, and the trace goes out as CSV
   alongside for anyone who does want to work with the figures. */
(function () {
  const RC = window.RC || (window.RC = {});

  const IMG_W = 900, IMG_H = 560;      // the track picture
  const GRAPH_W = 900, GRAPH_H = 300;

  /* ---- images ------------------------------------------------------------ */

  /* A canvas sized in CSS pixels but backed at higher resolution, so the
     exported images stay sharp when printed. */
  function canvasFor(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, ctx };
  }

  /* A camera that frames the whole track — the on-screen one is wherever the
     student happened to leave it, which is no use to a marker. */
  function fitCamera(rot, view, pad) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const consider = (x, y, z) => {
      const p = RC.projWorld(x, y, z, rot);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      // Track carries supports down to the ground, so include the feet.
      const f = RC.projWorld(x, y, 0, rot);
      if (f.y > maxY) maxY = f.y;
    };

    const paths = [RC.trackPath()];
    if (RC.demo) for (const tr of RC.demo.trains) paths.push(tr.path);
    for (const path of paths) for (const p of path.pts) consider(p.x, p.y, p.z);
    if (!isFinite(minX)) return { rot, zoom: 1, panX: 0, panY: 0 };

    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const zoom = Math.min((view.w - 2 * pad) / w, (view.h - 2 * pad) / h);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { rot, zoom, panX: -cx * zoom, panY: -cy * zoom };
  }

  function trackImage() {
    const view = { w: IMG_W, h: IMG_H };
    const { c, ctx } = canvasFor(IMG_W, IMG_H, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, IMG_W, IMG_H);
    const cam = fitCamera(RC.camera ? RC.camera.rot : 0, view, 24);
    RC.drawGround(ctx, cam, view);
    RC.drawTrack(ctx, cam, view, RC.trainDrawables(cam));
    return c.toDataURL('image/png');
  }

  /* The graph drawing measures the canvas's CSS box, so it has to be in the
     document to have one. Park it off screen for the moment it takes. */
  function graphImage(mode) {
    const c = document.createElement('canvas');
    c.style.position = 'fixed';
    c.style.left = '-20000px';
    c.style.top = '0';
    c.style.width = GRAPH_W + 'px';
    c.style.height = GRAPH_H + 'px';
    document.body.appendChild(c);
    try {
      const held = RC.graphMode();
      RC.setGraphMode(mode);
      if (mode === 'bars') RC.drawEnergyBars(c); else RC.drawEnergyGraph(c);
      RC.setGraphMode(held);
      return c.toDataURL('image/png');
    } finally {
      document.body.removeChild(c);
    }
  }

  /* ---- the numbers ------------------------------------------------------- */
  const esc = s => String(s).replace(/[&<>"]/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function row(label, value) {
    return `<tr><th>${label}</th><td>${value}</td></tr>`;
  }

  /* What the track IS, which is most of what a set task asks about: "build one
     with a loop" is answered here rather than by reading the report. */
  function shapeTable() {
    const pieces = RC.track.pieces;
    const path = RC.trackPath();
    let high = 0;
    for (const p of path.pts) high = Math.max(high, p.z * RC.LEVEL_M);

    const counts = {};
    let banked = 0, lifted = 0;
    for (const p of pieces) {
      const def = RC.pieceDef(p.defId);
      const kind = def.kind === 'loop' ? 'loop'
                 : def.kind === 'turn' ? 'turn'
                 : def.station ? 'station' : def.brake ? 'brake'
                 : def.launch ? 'launch' : 'straight';
      counts[kind] = (counts[kind] || 0) + 1;
      if (p.bank) banked++;
      if (p.lift) lifted++;
    }

    let feats = [];
    try { feats = RC.features().filter(f => f.label).map(f => f.label); } catch (e) { feats = []; }

    let html = '<table class="kv">';
    html += row('Circuit', esc(RC.circuitStatus().label));
    html += row('Track length', path.total.toFixed(0) + ' m');
    html += row('Highest point', high.toFixed(0) + ' m');
    html += row('Pieces', pieces.length);
    html += row('Loops', counts.loop || 0);
    html += row('Turns', (counts.turn || 0) + (banked ? ` (${banked} banked)` : ''));
    html += row('Chain lift pieces', lifted);
    html += row('Brake run pieces', counts.brake || 0);
    html += row('Launch pieces', counts.launch || 0);
    html += '</table>';
    if (feats.length) {
      // Escape the labels, THEN join with the separator. Escaping the joined
      // string would eat the arrow's own ampersand along with them.
      html += `<p class="feats"><strong>In order:</strong> ` +
              `${feats.map(esc).join(' &rarr; ')}</p>`;
    }
    return html;
  }

  /* ---- the trace, for anyone who wants the figures ----------------------- */
  RC.traceCSV = function () {
    const rows = [['distance_m', 'time_s', 'speed_ms', 'height_m',
                   'kinetic_J', 'potential_J', 'heat_J', 'total_J', 'supplied_J',
                   'vertical_g', 'lateral_g'].join(',')];
    for (const p of RC.sim.trace) {
      rows.push([p.s, p.t, p.v, p.h, p.ke, p.pe, p.th, p.total, p.supplied, p.vg, p.lg]
        .map(n => (Math.round(n * 1000) / 1000)).join(','));
    }
    return rows.join('\n');
  };

  /* ---- assembly ---------------------------------------------------------- */
  const STYLE = `
    body { font-family: "Trebuchet MS", "Segoe UI", sans-serif; color: #15304d;
           margin: 0 auto; padding: 24px; max-width: 960px; background: #fff; }
    h1 { margin: 0 0 2px; font-size: 1.5rem; }
    h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em;
         color: #55708d; border-bottom: 1px solid #d5dee7; padding-bottom: 4px;
         margin: 28px 0 10px; }
    .who { font-size: 1.1rem; font-weight: 700; margin: 0 0 2px; }
    .when { color: #55708d; font-size: 0.85rem; margin: 0 0 18px; }
    img { width: 100%; height: auto; border: 1px solid #d5dee7; border-radius: 8px; }
    table.kv { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    table.kv th { text-align: left; font-weight: 600; color: #55708d;
                  padding: 4px 8px 4px 0; width: 40%; }
    table.kv td { text-align: right; padding: 4px 0; font-variant-numeric: tabular-nums;
                  border-bottom: 1px solid #eef2f6; }
    .feats { font-size: 0.9rem; line-height: 1.6; }
    .cols { display: flex; gap: 28px; flex-wrap: wrap; }
    .cols > div { flex: 1 1 320px; }
    .report-hd { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em;
                 color: #55708d; margin: 14px 0 4px; font-weight: 700; }
    .readout-row { display: flex; justify-content: space-between; gap: 12px;
                   font-size: 0.9rem; padding: 3px 0; border-bottom: 1px solid #eef2f6; }
    .readout-row > span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
    .report-note { background: #f2f7fb; border-left: 3px solid #0d9488;
                   padding: 8px 10px; font-size: 0.9rem; margin: 10px 0; }
    .report-warn { background: #fdf3f2; border-left: 3px solid #b3261e;
                   padding: 8px 10px; font-size: 0.9rem; margin: 6px 0; }
    .muted { color: #55708d; font-style: italic; font-size: 0.92em; font-weight: 400; }
    .demo-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .demo-table th { text-align: right; color: #55708d; padding: 3px 4px;
                     border-bottom: 1px solid #d5dee7; }
    .demo-table th:first-child, .demo-table td:first-child { text-align: left; }
    .demo-table td { text-align: right; padding: 3px 4px; border-bottom: 1px solid #eef2f6;
                     font-variant-numeric: tabular-nums; }
    .demo-key { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
                margin-right: 6px; }
    .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #d5dee7;
            color: #55708d; font-size: 0.8rem; }
    @media print { body { padding: 0; } h2 { break-after: avoid; } img { break-inside: avoid; } }
  `;

  RC.buildExportHTML = function (who) {
    const sim = RC.sim;
    const when = new Date();
    // The same report the window shows, built from the sim rather than scraped
    // off the page, so the export does not depend on that window being open.
    const report = RC.reportHTML();
    const ran = sim.time > 0;
    const title = who ? `${who} — Rollercoaster` : 'Rollercoaster';

    let html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n';
    html += `<title>${esc(title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n`;

    html += `<h1>Rollercoaster Builder</h1>`;
    if (who) html += `<p class="who">${esc(who)}</p>`;
    html += `<p class="when">Exported ${esc(when.toLocaleString())}</p>`;

    html += `<h2>The track</h2>`;
    html += `<img alt="The track" src="${trackImage()}">`;

    html += `<div class="cols"><div><h2>Shape</h2>${shapeTable()}</div>`;
    // Even with no run behind it, the settings are worth recording: they say
    // what the track was about to be run under.
    html += `<div><h2>Ride report</h2>${ran ? report :
      '<p class="report-warn">The train was never run, so there are no ride figures.</p>' +
      report}</div></div>`;

    if (ran) {
      html += `<h2>Energy as the train goes round</h2>`;
      html += `<img alt="Energy against distance" src="${graphImage('energy')}">`;
      html += `<h2>What the rider feels</h2>`;
      html += `<img alt="Acceleration against distance" src="${graphImage('accel')}">`;
      html += `<h2>Energy at the end of the run</h2>`;
      html += `<img alt="Energy bars" src="${graphImage('bars')}">`;
    }

    html += `<p class="foot">Made with the PhysVys Rollercoaster Builder. ` +
            `One tile is 4&nbsp;m and one height step is 1&nbsp;m; heights are ` +
            `measured from ground level.</p>`;
    html += '\n</body>\n</html>\n';
    return html;
  };

  /* ---- download ---------------------------------------------------------- */
  function download(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking straight away can beat the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const safeName = s => String(s || 'rollercoaster')
    .replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-').slice(0, 40) || 'rollercoaster';

  RC.exportSummary = function (who) {
    const stamp = new Date().toISOString().slice(0, 10);
    download(RC.buildExportHTML(who), `${safeName(who)}-rollercoaster-${stamp}.html`, 'text/html');
    return { ok: true };
  };

  RC.exportTraceCSV = function (who) {
    if (!RC.sim.trace.length) return { ok: false, why: 'Run the train first — there is no trace yet' };
    const stamp = new Date().toISOString().slice(0, 10);
    download(RC.traceCSV(), `${safeName(who)}-rollercoaster-${stamp}.csv`, 'text/csv');
    return { ok: true };
  };
})();
