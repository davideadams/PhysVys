/* Vector icons for the construction window.

   Drawn on a 24x24 grid, stroked in currentColor so the disabled and selected
   states in style.css carry through without a second set of assets.

   Two things are deliberate rather than decorative:

   - The turn icons use the same arc geometry as the pieces they build. Tight
     turns sweep a full 90 degrees at a small radius; wide turns sweep 45 at a
     large one, so the wider turn visibly bends less over the same distance.
   - The slope icons are drawn at the real angles: gentle is atan(2/4) = 27
     degrees and steep is atan(6/4) = 56, matching the 2 and 6 levels per tile
     the track model uses. The icon is a scale drawing of the thing it builds. */
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

    /* ---- slope, seen from the side, travelling left to right ------------ */
    'slope-level': svg(
      `<path d="M3.5 12 H16.5"/>` +
      head('21 12 L15.8 9 L15.8 15')
    ),

    // 1 in 2: gentle, 27 degrees.
    'slope-gentle-up': svg(
      `<path d="M4 16.5 L16.4 10.3"/>` +
      head('20.6 8.2 L17.7 12.9 L15.1 7.7')
    ),
    'slope-gentle-down': svg(
      `<path d="M4 7.5 L16.4 13.7"/>` +
      head('20.6 15.8 L15.1 16.3 L17.7 11.1')
    ),

    // 3 in 2: steep, 56 degrees.
    'slope-steep-up': svg(
      `<path d="M7 19 L14.4 7.9"/>` +
      head('17 4 L16.9 9.6 L11.9 6.2')
    ),
    'slope-steep-down': svg(
      `<path d="M7 5 L14.4 16.1"/>` +
      head('17 20 L11.9 17.8 L16.9 14.4')
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
