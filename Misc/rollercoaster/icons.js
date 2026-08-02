/* Vector icons for the construction window.

   Drawn on a 24x24 grid, stroked in currentColor so the disabled and selected
   states in style.css carry through without a second set of assets.

   Two things are deliberate rather than decorative:

   - The three turn icons are arcs of the SAME LENGTH at increasing radius, so
     each visibly bends less than the last over the same distance travelled —
     which is the whole of what the three sizes mean. They are ordered, not
     scale drawings: the radii here are 7, 15 and 26 against real ones in the
     ratio 1 : 1.67 : 2.33, because a literal drawing of a sweeping turn is
     nearly a straight line in a 24-pixel box.
   - The slope icons are drawn at the real angles: a grade of g levels per tile
     is atan(g * LEVEL_M / TILE_M), so with 0.5 m levels against a 6 m tile
     gentle (2) is 9.5 degrees, medium (4) is 18.4 and steep (12) is 45. The
     icon is a scale drawing of the thing it builds, so all three have to be
     redrawn if either scale moves again — as they did when the level halved and
     the old gentle drawing became the medium one. */
(function () {
  const RC = window.RC || (window.RC = {});

  const svg = body =>
    `<svg class="rct-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

  const head = pts => `<path d="M${pts}Z" fill="currentColor" stroke="none"/>`;

  RC.ICONS = {
    /* ---- direction, seen from above, travelling up the icon ------------- */
    'dir-straight': svg(
      `<path d="M12 21 V7"/>` +
      head('12 3.2 L8.4 9.2 L15.6 9.2')
    ),

    // Quarter arc, radius 7: a tight turn.
    'dir-right-tight': svg(
      `<path d="M12 20 A7 7 0 0 1 19 13"/>` +
      head('23 13 L17.6 9.9 L17.6 16.1')
    ),
    'dir-left-tight': svg(
      `<path d="M12 20 A7 7 0 0 0 5 13"/>` +
      head('1 13 L6.4 9.9 L6.4 16.1')
    ),

    // 45 degrees of a radius-15 arc: same start, much less bend.
    'dir-right-wide': svg(
      `<path d="M12 20 A15 15 0 0 1 16.4 9.4"/>` +
      head('19.9 5.9 L18.5 11.5 L14.3 7.3')
    ),
    'dir-left-wide': svg(
      `<path d="M12 20 A15 15 0 0 0 7.6 9.4"/>` +
      head('4.1 5.9 L9.7 7.3 L5.5 11.5')
    ),

    // 24 degrees of a radius-26 arc: the same 11 units of travel again, barely
    // leaning off straight.
    'dir-right-sweeping': svg(
      `<path d="M12 20 A26 26 0 0 1 14.25 9.42"/>` +
      head('16.26 4.90 L16.96 10.63 L11.53 8.22')
    ),
    'dir-left-sweeping': svg(
      `<path d="M12 20 A26 26 0 0 0 9.75 9.42"/>` +
      head('7.74 4.90 L12.47 8.22 L7.04 10.63')
    ),

    /* ---- slope, seen from the side, travelling left to right ------------ */
    'slope-level': svg(
      `<path d="M3.5 12 H16.5"/>` +
      head('21 12 L15.8 9 L15.8 15')
    ),

    /* These are SCALE DRAWINGS of the pieces they build, so they move whenever
       the grade ladder does. Arrowheads are placed in the line's own frame —
       tip 4.43 along it, base corners 1.01 along and 2.91 either side — which
       is what keeps them looking like one set at three different angles. */

    // 1 in 6: gentle, 9.5 degrees.
    'slope-gentle-up': svg(
      `<path d="M4 13 L16 11"/>` +
      head('20.4 10.3 L17.5 13.7 L16.5 8.0')
    ),
    'slope-gentle-down': svg(
      `<path d="M4 11 L16 13"/>` +
      head('20.4 13.7 L17.5 10.3 L16.5 16.0')
    ),

    // 1 in 3: medium, 18.4 degrees.
    'slope-medium-up': svg(
      `<path d="M4 14 L16 10"/>` +
      head('20.2 8.6 L17.9 12.4 L16 6.9')
    ),
    'slope-medium-down': svg(
      `<path d="M4 10 L16 14"/>` +
      head('20.2 15.4 L17.9 11.6 L16 17.1')
    ),

    // 1 in 1: steep, 45 degrees.
    'slope-steep-up': svg(
      `<path d="M6.5 16.5 L15.5 7.5"/>` +
      head('18.6 4.4 L18.3 8.8 L14.2 4.7')
    ),
    'slope-steep-down': svg(
      `<path d="M6.5 7.5 L15.5 16.5"/>` +
      head('18.6 19.6 L18.3 15.2 L14.2 19.3')
    ),

    /* ---- special pieces -------------------------------------------------- */
    'station': svg(
      `<path d="M3 9 H21"/>` +
      `<rect x="4" y="13" width="16" height="6" rx="1.5"/>` +
      `<path d="M8 13 V19 M12 13 V19 M16 13 V19" stroke-width="1.2"/>`
    ),
    'brake': svg(
      `<path d="M3 12 H21"/>` +
      `<path d="M8 7.5 V16.5 M12 7.5 V16.5 M16 7.5 V16.5"/>`
    ),
    'launch': svg(
      `<path d="M2.5 12 H11"/>` +
      `<path d="M11 6.5 L16.5 12 L11 17.5"/>` +
      `<path d="M16 6.5 L21.5 12 L16 17.5"/>`
    ),

    /* Vertical loop, seen from the side: track in, round, and out one tile
       over. The gap at the crossing shows the path passing over itself. */
    'loop-right': svg(
      `<path d="M2 19 H7"/>` +
      `<path d="M7 19 A6.5 6.5 0 1 1 15.5 18.4"/>` +
      `<path d="M15.5 18.4 H22" stroke-dasharray="0"/>`
    ),
    'loop-left': svg(
      `<path d="M22 19 H17"/>` +
      `<path d="M17 19 A6.5 6.5 0 1 0 8.5 18.4"/>` +
      `<path d="M8.5 18.4 H2"/>`
    ),

    /* Track cross-sections, seen head on: level rails, then rolled 45. */
    'roll-none': svg(
      `<path d="M4 14 H20"/>` +
      `<path d="M7 14 V10 M17 14 V10" stroke-width="1.6"/>`
    ),
    'roll-bank': svg(
      `<path d="M5.4 17.6 L18.6 8.4"/>` +
      `<path d="M8.1 15.7 L5.8 12.4 M18.1 8.7 L15.8 5.4" stroke-width="1.6"/>`
    ),

    /* Chain lift: links climbing a gradient. */
    'chain': svg(
      `<path d="M4.5 18.5 L19.5 7.5" stroke-width="1.6"/>` +
      `<circle cx="8" cy="15.9" r="2"/>` +
      `<circle cx="12" cy="13" r="2"/>` +
      `<circle cx="16" cy="10.1" r="2"/>`
    )
  };

  RC.icon = name => RC.ICONS[name] || '';
})();
