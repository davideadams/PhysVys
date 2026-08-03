/* Track model: piece catalogue, build head, circuit validation.
   Knows nothing about the camera — see HANDOVER.md on the rotation design. */
(function () {
  const RC = window.RC || (window.RC = {});

  /* Directions are world-fixed: 0 = +i, 1 = +j, 2 = -i, 3 = -j. */
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  RC.DIRS = D;

  /* Slope in height levels per tile, signed by travel direction. A tile is 6 m
     and a level is 0.5 m, so a grade of g works out to atan(g/12):

       GENTLE  2  ->  9.5 deg    1 in 6
       MEDIUM  4  -> 18.4 deg    1 in 3
       STEEP  12  -> 45.0 deg    1 in 1     — the classic first-drop angle

     Four grades a student names, and no fifth one hidden behind them. The
     ladder is not a free choice: a transition out of FLAT gets no help from the
     (1 + z'^2) term that eases the steeper ones, so at one tile it can only
     reach atan(1/6) before it starts bending tighter than 20 m. That fixes the
     first rung at 9.5 degrees, and the same argument fixes the second at 18.4.
     Only the last step is big enough to need two tiles.

     The grades are in levels PER TILE, so the tile scale does not move them —
     only the angle they work out to. */
  const FLAT = 0, GENTLE = 2, MEDIUM = 4, STEEP = 12;

  /* No transition may bend tighter than this, in metres. It is the number the
     piece lengths are solved from rather than a check on them, so changing a
     grade re-sizes its transitions instead of quietly making them sharper.
     20 m carries 20.7 m/s before a crest passes the airtime limit, which clears
     everything the presets reach and everything the turns are headed for. */
  const MIN_TRANS_R = 18;

  /* 120 levels is still 60 m. Deliberately far more height than the catalogue
     can carry honestly — a 60 m drop is 34 m/s, and the pieces are good for
     20.7 — because building something far too fast and reading the report tell
     you WHY is the exercise. The Shape section names the piece that cannot take
     it; the ceiling is not the place to prevent it. */
  const MAX_H = 120;
  RC.MAX_H = MAX_H;

  /* Smootherstep: 0 to 1 with zero FIRST AND SECOND derivative at both ends.
     Used wherever a correction has to be blended into a piece without leaving a
     curvature step where it starts and finishes. */
  function smootherstep(t) { return t * t * t * (t * (6 * t - 15) + 10); }

  /* ---- eased turns -------------------------------------------------------
     A quarter turn is a SPIRAL - ARC - SPIRAL, not a circular arc. Its
     curvature ramps linearly from zero to 1/R over the first spiral, holds
     through the middle, and ramps back to zero over the last, so the piece
     meets straight track with NO STEP in curvature. That is the lateral
     equivalent of what the smoothstep slope profile does for crests and
     valleys, and it is the reason spirals exist on real railways.

     The turn is still symmetric and still exactly 90°, so the exit is still
     E + T*(u + v) and the node model, the collision checker and the auto-closer
     never learn about it. T stays the grid parameter; the RADIUS becomes an
     output, and a smaller one — which is the entire price of the change.

     THETA is the deflection each spiral does, and it is small because THE TILE
     FOOTPRINT IS THE MANDATE. A quarter turn spanning T tiles bends at
     T/(1 + THETA + ...), so every radian of easement is radius given away — a
     3-tile corner at 0.2 rad is really a 2.49-tile bend, which is not what
     anyone reading the palette expects. At 0.05 it is 2.86.

     What THETA buys is onset time. The easement is 2*THETA*R long and the train
     crosses it at roughly sqrt(1.5 g R), so it lasts about 2*THETA seconds, and
     the radius given up is about THETA: ONE PERCENT OF RADIUS BUYS TWENTY
     MILLISECONDS. At 0.05 that is a tenth of a second, which is six frames of
     the acceleration trace and reads as a ramp; much below it and the graph
     draws a vertical edge, which is the very thing the easement exists to
     remove. Three limits all bite around there — the trace's 60 Hz, the path's
     sampling, and the thousandth of a parameter curvInside measures across —
     so 0.05 is the floor rather than a preference. */
  const SPIRAL_THETA = 0.05;
  const SPIRAL_LS = 2 * SPIRAL_THETA;                 // spiral length, in radii

  /* The LOOP eases by its own, larger angle, and deliberately. A loop is not
     fighting for a tile footprint the way a corner is — its shape is set by the
     teardrop and the easement is added at the ends — so nothing is given up by
     making it long, and it has the biggest step on the catalogue to remove:
     4.19 g at once, against a corner's 1.5. At 0.05 its easement would be under
     a metre. */
  const LOOP_THETA = 0.2;
  const LOOP_LS = 2 * LOOP_THETA;

  /* Where a spiral deflecting THETA has reached after arc length s, in radii,
     measured from its start with the heading along +x.

     A clothoid has no closed form and the usual answer is a precomputed Fresnel
     table. It needs none here. The heading is psi = s^2/(4*theta), so expanding
     cos and sin as power series and integrating term by term collapses to one
     series in psi for both coordinates:

       x = s * SUM  psi^m / ((2m+1) m!)   over even m
       y = s * SUM  psi^m / ((2m+1) m!)   over odd m

     with the sign running +, +, -, -, +, + as m climbs, which is the two
     alternating series interleaved. Fourteen terms hold to about 1e-12 out to
     psi = 1.2, which covers the longest easement in the catalogue — the 180's,
     which is 65 degrees.

     That accuracy is not a nicety. curvInside measures a piece's curvature from
     three centreline points a thousandth of a parameter apart, so an
     interpolated table would be read across the chords between its own knots
     and would report a turn as dead straight. */
  function spiralPoint(s, theta) {
    const psi = s * s / (4 * theta);          // the heading here, in radians
    let x = 0, y = 0, term = 1, sign = 1;     // term = psi^m / m!
    for (let m = 0; m < 14; m++) {
      const c = sign * term / (2 * m + 1);
      if (m % 2) { y += c; sign = -sign; } else { x += c; }
      term *= psi / (m + 1);
    }
    return { x: s * x, y: s * y };
  }

  /* The entry spiral's far end, the centre of the constant-radius arc that
     follows it, and TAU — the ratio between the grid parameter T and the radius
     the turn actually achieves.

     TAU comes from the shape's own symmetry rather than from integrating the
     whole of it. The curve is symmetric under (x, y) -> (TAU - y, TAU - x),
     which maps its start onto its end, so applying that to the point where the
     entry spiral finishes gives TAU = x1 + y1 + cos(THETA) - sin(THETA)
     outright. At 0.05 rad that is 1.05041, so R = 0.952 T: a tight turn is
     8.57 m rather than 9, and a wide one 14.28 m rather than 15. */
  const SPIRAL_END = spiralPoint(SPIRAL_LS, SPIRAL_THETA);
  const LOOP_SPIRAL_END = spiralPoint(LOOP_LS, LOOP_THETA);

  /* A turn shape: spiral in, constant-radius arc, spiral out, deflecting
     DEFLECT radians in all. Only two exist — the quarter every corner is built
     from, and the half a 180 is — and they share every line of this, because
     the only thing that differs between them is how much arc sits between the
     two spirals.

     Everything here is in RADII; multiply by the radius to get tiles.

       cx, cy   centre of the constant-radius arc
       ax, ay   where the exit spiral leaves that arc
       ex, ey   where the turn finishes, measured along the entry direction and
                the direction one right angle over
       S        arc length
       tau      lateral extent divided by the LATERAL TILE MULTIPLIER, which is
                what ties the shape to the grid: scaling by T/tau lands the exit
                exactly where the node model expects it, whatever the shape.

     That multiplier is read off the circle the eased turn stands in for. A
     unit circle through DEFLECT ends at (sin DEFLECT, 1 - cos DEFLECT), which
     is (1,1) for a quarter, (0,2) for a half and (-1,1) for a 270 — the same
     numbers chaining that many quarter turns gives. The eased shape lands on
     the same RAY as the circle and only the scale differs, so dividing by
     1 - cos DEFLECT is the whole of the grid fit.

     The exit spiral is the entry spiral again, run backwards into the exit
     heading. Its heading a distance w from the far end is exactly
     DEFLECT - psi(w), so its displacement is the entry spiral's rotated by
     DEFLECT and flipped — which is why there is one spiralPoint and not two,
     and why a 180 costs no new integration at all.

     For the quarter that gives ex = ey = 1.20639, the familiar TAU. For the
     half it gives ex = 0 and ey = 2 * cy, so a 180 finishes directly abeam of
     where it started, exactly as two quarters do. */
  function turnShape(deflect, theta) {
    const Ls = 2 * theta;
    const e = spiralPoint(Ls, theta);
    const cx = e.x - Math.sin(theta);
    const cy = e.y + Math.cos(theta);
    const ax = cx + Math.sin(deflect - theta);
    const ay = cy - Math.cos(deflect - theta);
    const dx = Math.cos(deflect) * e.x + Math.sin(deflect) * e.y;
    const dy = Math.sin(deflect) * e.x - Math.cos(deflect) * e.y;
    const ey = ay + dy;
    return {
      deflect, theta, Ls, cx, cy, ax, ay,
      ex: ax + dx, ey,
      quarters: Math.round(deflect / (Math.PI / 2)),
      S: deflect + 2 * theta,
      tau: ey / Math.round(1 - Math.cos(deflect))
    };
  }

  /* A 180 is not two quarters end to end, and that is the whole point of it.
     Two eased quarters ease down to zero curvature and back up where they meet,
     so the train goes briefly straight and a banked pair rolls level and back;
     one 180 eases only at its OUTER ends and holds full curvature the whole way
     through. A 270 does the same again over three right angles.

     ALL THREE EASE BY THE SAME THETA, and the longer bends come out wider than
     the corners they replace. That is not a defect in the merge; it is what
     deleting the internal easements MEANS. Writing P = y1 + cos(theta) and
     Q = x1 - sin(theta) for the entry spiral's far end,

       tau(quarter) = P + Q      tau(180) = P      tau(270) = P - Q

     with R = T/tau, so

       quarter  tau 1.05041   R = 0.9520 T   14.28 m
       180      tau 1.00042   R = 0.9996 T   14.99 m     x (1 + theta)
       270      tau 0.95042   R = 1.0522 T   15.78 m     x (1 + 2 theta)

     at 2.5 tiles across: one theta of extra radius per internal joint removed.
     Five percent and ten, where at a 0.2 easement they were twenty and fifty.

     THE REASON, since it is not obvious. On a 90 degree bend the entry and exit
     tangents are PERPENDICULAR, so easing — starting the turn earlier and
     finishing it later — pushes both of them outward and the box grows in both
     directions. A corner in a fixed square therefore gives up about THETA of
     its radius to pay for its easements: 4.8% here. On a 180 the tangents are
     PARALLEL, and starting to turn earlier does not change the gap between two
     parallel lines; the only cost is the sideways shift R*theta^2/6, which is
     0.04%. So the corner is the odd one out, not the 180 — a 6-tile 180 really
     is the 3-tile semicircle it looks like, to four figures.

     MAKING THEM MATCH EXACTLY IS POSSIBLE AND NOT WORTH IT. A 180's tangent
     separation is 2R + p1 + p2, so squeezing the corner's radius into the same
     span means finding all of the difference in p, which needs a very long
     easement however it is split. That was built and measured at the old 0.2:
     it matched the radius exactly, but a long spiral runs a long way nearly
     straight before it bends, which shoves the whole arc forward — the bend
     reached 5.2 tiles deep where the pair it replaced reached 3.0, so it
     refused to merge whenever there was track a couple of tiles in front. It
     also made the piece 37% longer than its corners, which a sloped variant's
     height profile cannot absorb.

     Nor can banking hide the gap: lateral force is (v^2/R)cos(phi) - g sin(phi),
     two terms against one angle, so no bank angle makes two radii feel alike at
     more than one speed. Every principled rule for choosing phi comes out
     constant anyway — "balanced at the speed its own radius is honest to" is
     tan(phi) = 1.5 for every size, since R cancels.

     So the bend is wider by a twentieth, it is gentler rather than sharper, and
     it sweeps an eighth of a tile further forward than the pair it replaces. */
  const QUARTER = turnShape(Math.PI / 2, SPIRAL_THETA);
  const HALF = turnShape(Math.PI, SPIRAL_THETA);
  const THREE_QUARTER = turnShape(3 * Math.PI / 2, SPIRAL_THETA);

  RC.SPIRAL_THETA = SPIRAL_THETA;
  RC.SPIRAL_TAU = QUARTER.tau;

  /* The point at arc length s along a unit-radius turn of that shape, starting
     at the origin heading +x. */
  function turnPoint(shape, s) {
    if (s <= shape.Ls) return spiralPoint(s, shape.theta);
    if (s >= shape.S - shape.Ls) {
      const p = spiralPoint(shape.S - s, shape.theta);   // the exit spiral
      const c = Math.cos(shape.deflect), n = Math.sin(shape.deflect);
      return { x: shape.ex - (c * p.x + n * p.y), y: shape.ey - (n * p.x - c * p.y) };
    }
    const psi = shape.theta + (s - shape.Ls);
    return { x: shape.cx + Math.sin(psi), y: shape.cy - Math.cos(psi) };
  }

  /* How much of its full curvature the turn has reached at arc length s: zero
     at both ends, one through the middle, linear across each spiral. */
  function turnKappa(shape, s) {
    if (s <= shape.Ls) return s / shape.Ls;
    if (s >= shape.S - shape.Ls) return (shape.S - s) / shape.Ls;
    return 1;
  }

  /* What a turn IS, as against what the grid asked for: the radius it reaches
     and the horizontal distance it covers, both in tiles. def.R is the grid
     parameter T and is no longer a radius — every reader that wants one of
     these should say so. */
  RC.turnRadius = def => def.R / def.shape.tau;
  RC.turnRun = def => def.R * def.shape.S / def.shape.tau;

  /* Banking is a single angle, applied to turns only, and its profile is now
     simply how much of its curvature the turn has reached — so the train rolls
     into the bend THROUGH the spiral, arriving at full bank exactly when the
     full sideways force does.

     It used to be a ramp of its own, a smoothstep over the first and last
     quarter of the piece, and that was wrong in a way that measured. Curvature
     arrived in full at the joint while the bank was still rolling in, so the
     entry of a banked turn was, for a fifth of a second, an UNBANKED turn: a
     15 m corner taken at 19.8 m/s spiked to 2.7 g however well it was banked,
     and layout had to be arranged around it. Tying bank to curvature also makes
     "a banked piece starts and finishes level" a consequence of the geometry
     rather than a rule kept by hand, so bank still never enters the node state.

     A run of same-direction turns no longer needs special handling, and no
     longer gets it. Two eased quarters genuinely do go straight for an instant
     between them, so rolling level there is the honest thing to draw. It also
     rides worse than one continuous 180° would, which is what phase 5 is for. */
  const BANK_ANGLE = 45 * Math.PI / 180;
  RC.BANK_ANGLE = BANK_ANGLE;

  function bankProfile(t, shape) {
    shape = shape || QUARTER;
    return turnKappa(shape, t * shape.S);
  }
  RC.bankProfile = bankProfile;

  /* A piece's height gain is the integral of its slope profile, which whatever
     shape that profile takes averages to (gIn+gOut)/2 — so dH is L*(gIn+gOut)/2
     and lands on a whole level for every combination below. That is why GENTLE
     and STEEP are even numbers, and it is what keeps the track on the grid.

     LENGTH IS SET BY THE GRADE CHANGE: one tile per level of it. A transition
     bends by its grade change spread over its length, so pricing length that way
     lands every transition on the SAME curvature — flat to gentle and gentle to
     steep are equally tight, and so are their concave and convex versions.

     That last part is the point. A palette where a convex transition and a
     concave one of the same grade change had different lengths would be a
     palette a student has to memorise rather than reason about, and the whole
     argument for tile-based building is that the pieces behave predictably.
     Constant-grade pieces have no grade change, so they take the floor of one
     tile. */
  /* Tiles a transition needs, solved from MIN_TRANS_R rather than written down.

     Its slope ramps from gIn to gOut through a smoothstep, so the curvature it
     reaches peaks at 1.5x the mean rate of that ramp, eased by (1 + z'^2)^1.5
     where z' is the slope at the tightest point — which is why a piece bending
     between two steep grades needs less length than the same bend near level:
     45 degree track covers 8.5 m per tile against flat track's 6, so the same
     turn of the tangent spreads over more of it.

     The peak is FOUND, not assumed to be at the middle. z'' does peak there,
     but (1 + z'^2)^1.5 grows right through the piece, so on a large grade change
     the tightest point sits earlier — where the bend is slightly gentler but the
     slope has not yet arrived to ease it. Assuming the midpoint put
     medium-to-steep at 20.8 m when it is really 18.9, which is the sort of error
     that makes a stated minimum a fiction.

     One tile everywhere except MEDIUM <-> STEEP, which needs two. */
  function transitionTiles(gIn, gOut) {
    const dg = gOut - gIn;
    if (!dg) return 1;
    let peak = 0;
    for (let n = 0; n <= 100; n++) {
      const t = n / 100;
      // Slope, and the rate it is changing, at t — for a single tile.
      const g = gIn + dg * t * t * (3 - 2 * t);
      const dgdt = dg * 6 * (t - t * t);
      const zp = g * RC.LEVEL_M / RC.TILE_M;
      const zpp = dgdt * RC.LEVEL_M / (RC.TILE_M * RC.TILE_M);
      peak = Math.max(peak, Math.abs(zpp) / Math.pow(1 + zp * zp, 1.5));
    }
    return Math.max(1, Math.ceil(peak * MIN_TRANS_R));
  }
  RC.transitionTiles = transitionTiles;

  function straight(id, label, gIn, gOut, extra) {
    const L = transitionTiles(gIn, gOut);
    return Object.assign({
      id, label, kind: 'straight', gIn, gOut, L,
      dH: L * (gIn + gOut) / 2
    }, extra || {});
  }

  /* Quarter turns. R here is the GRID PARAMETER T, not the radius: the exit
     lands on an edge midpoint only when it is a half-integer number of tiles,
     so the usable values are 1.5 (9 m across) and 2.5 (15 m). The turn is eased
     (see the spiral block above), so the radius it actually reaches is T/TAU —
     7.46 m and 12.43 m. RC.turnRadius is the one to ask.

     A turn can be sloped, which is how track curves during a drop — and it is
     what makes a helix nothing more special than four of them in a row.

     Four of them in a row is also as much helix as anyone should build. A helix
     turning through PHI at pitch theta drops r*PHI*tan(theta), so
     v^2 = 2g*r*PHI*tan(theta) and the lateral v^2/r = 2g*PHI*tan(theta): THE
     RADIUS CANCELS. In g that is 2*PHI*tan(theta), so a full circle costs

       gentle  2.1 g      medium  4.2 g      steep  12.6 g

     at the bottom whatever radius it is drawn at, and widening it does nothing
     at all. The same figures for a quarter turn are 0.5, 1.0 and 3.1 g. So a
     curving drop is a quarter or two, and a full 360 on anything but the
     gentlest grade is not a design that can be rescued.

     The compromise is in dH. Track has to land on whole levels or it leaves
     the grid, but the honest drop through a quarter turn is its horizontal
     distance times the slope, which is never a whole number. Each piece takes
     the nearest one, so its average pitch misses the slope it is named for by
     at most 1.4 degrees — the tight medium turn, worst of the twelve; every
     other combination is inside a degree. That is small enough not to read as a
     kink where it joins straight track of the same slope, and far smaller than
     the error in pretending a coaster is a bead on a wire. turnHeightFrac
     absorbs it in the middle of the piece, so both ENDS sit at exactly the
     named grade whatever the rounding did.

     dH is still measured against the pi/2*T circle the turn used to be, not
     against the 4% longer path easement gives it, and that is deliberate.
     It is a GRID quantity — which whole number of levels a piece moves the head
     by — so re-deriving it would change the node graph, break every saved track
     for a second time in two commits, and make phase 5's swap of two quarters
     for one 180 stop adding up. What the piece is named for is carried by its
     end grades, which are exact; what the grid needs is a number that does not
     move. */
  function turn(id, label, dir, R, g, shape) {
    g = g || FLAT;
    shape = shape || QUARTER;
    return {
      id, label, kind: 'turn', gIn: g, gOut: g,
      turn: dir, R, shape,
      // Per right angle, so a 180 moves the head exactly as far as the two
      // quarters it stands in for. That is what lets one be swapped for the
      // other without the node model noticing.
      dH: shape.quarters * Math.round(R * Math.PI / 2 * g),
      // A chain can be put on a corner that climbs, the same as on a straight
      // one: a lift hill is allowed to bend. Only on a climb, though — a chain
      // hauls a train up, and there is nothing for it to do on the way down.
      liftable: g > 0
    };
  }

  /* Three sizes, and the names are the ids so the palette and the piece list
     cannot drift apart. T goes up in whole tiles because it must stay a
     half-integer, which makes the ladder even; what a rider feels does not,
     because radius sets the sideways force and easing scales it by 1/TAU:

       tight     T 1.5   9 m across    R  8.6 m   1.5 g at 11.2 m/s
       wide      T 2.5  15 m           R 14.3 m   1.5 g at 14.5 m/s
       sweeping  T 3.5  21 m           R 20.0 m   1.5 g at 17.2 m/s

     Not "medium", deliberately, and not "small/medium/large": the grade ladder
     already has a MEDIUM in it, and a sloped turn's name is its size plus its
     grade, so that would have produced "Right, medium, medium down" in the
     palette. Tight, wide and sweeping are what the shapes are called anyway.

     4.5 tiles is available and would give a 22.4 m radius, but it is 27 m of
     park across a 240 m one — a preset side is 12 to 15 tiles, so two of them
     would eat most of a leg. 3.5 is the largest that still leaves a circuit
     room to have anything else in it.

     The sloped variants are named <turn>-<slope> and generated rather than
     written out: it is the same six shapes against the same six slopes, and
     spelling out thirty-six near-identical lines invites one of them to be
     quietly wrong. */
  const TURN_SHAPES = [
    { id: 'turn-left-tight',     label: 'Left, tight',      dir: -1, R: 1.5 },
    { id: 'turn-right-tight',    label: 'Right, tight',     dir:  1, R: 1.5 },
    { id: 'turn-left-wide',      label: 'Left, wide',       dir: -1, R: 2.5 },
    { id: 'turn-right-wide',     label: 'Right, wide',      dir:  1, R: 2.5 },
    { id: 'turn-left-sweeping',  label: 'Left, sweeping',   dir: -1, R: 3.5 },
    { id: 'turn-right-sweeping', label: 'Right, sweeping',  dir:  1, R: 3.5 }
  ];
  const TURN_SLOPES = [
    { suffix: 'gentle-down', g: -GENTLE, label: 'gentle down' },
    { suffix: 'medium-down', g: -MEDIUM, label: 'medium down' },
    { suffix: 'steep-down',  g: -STEEP,  label: 'steep down' },
    { suffix: 'gentle-up',   g: GENTLE,  label: 'gentle up' },
    { suffix: 'medium-up',   g: MEDIUM,  label: 'medium up' },
    { suffix: 'steep-up',    g: STEEP,   label: 'steep up' }
  ];

  /* The bends longer than a quarter, and which grades each is offered on. See
     longTurns below for why the 270 is flat only. */
  const LONG_BENDS = [
    { suffix: '-180', label: ', 180', shape: HALF, slopes: TURN_SLOPES },
    { suffix: '-270', label: ', 270', shape: THREE_QUARTER, slopes: [] }
  ];

  function slopedTurns() {
    const out = [];
    for (const sh of TURN_SHAPES) {
      for (const sl of TURN_SLOPES) {
        out.push(turn(sh.id + '-' + sl.suffix, sh.label + ', ' + sl.label,
                      sh.dir, sh.R, sl.g));
      }
    }
    return out;
  }

  /* The same catalogue again as 180s and 270s, named <turn>-180 and <turn>-270,
     for a run of same-direction banked corners to be merged into.

     A long bend's dH must be exactly as many times the quarter's as it turns
     right angles, or the merge would move the track — so it inherits the
     corners' rounding and adds a little of its own, since its path is 1.9%
     longer than theirs. The two effects partly cancel and which way they land
     varies by combination: most sloped bends come out a shade gentler than the
     grade they name, the tight gentle one a shade steeper. Worst case 1.3
     degrees, against a corner's own 1.0, and the ENDS are exact in every case
     so nothing kinks — only the average moves.

     That is comfortably inside the rule that a substituted piece may hide at
     most half a rung of the grade ladder, 4.7 degrees, so the 180 is offered on
     every grade. (At the old 0.2 easement it ran 7.7% long and 3.5 degrees out,
     which was inside the rule but only just; the shorter easement bought that
     back along with the radius.)

     THE 270 IS FLAT ONLY, on the physics rather than the arithmetic. A turn
     descending through PHI at pitch theta loads 2*PHI*tan(theta) at the bottom
     WHATEVER RADIUS IT IS DRAWN AT, so a descending 270 is 3.1 g at medium and
     9.4 at steep and widening it does nothing at all. Three sloped corners
     still build that descent — the merge simply declines to fold them into one
     piece that makes it look like a considered element. */
  function longTurns() {
    const out = [];
    for (const sh of TURN_SHAPES) {
      for (const b of LONG_BENDS) {
        out.push(turn(sh.id + b.suffix, sh.label + b.label,
                      sh.dir, sh.R, FLAT, b.shape));
        for (const sl of b.slopes) {
          out.push(turn(sh.id + b.suffix + '-' + sl.suffix,
                        sh.label + b.label + ', ' + sl.label,
                        sh.dir, sh.R, sl.g, b.shape));
        }
      }
    }
    return out;
  }

  /* Vertical loop. Footprint: L tiles long, finishing one tile to the left or
     right so the exit clears the entry. Entry and exit are both level.

     NOT a circle. A circular loop has a constant radius, so with the train
     fastest at the bottom the centripetal g there (v^2/r) is brutal while the
     top needs a small radius just to stay on. Real coasters use a clothoid /
     teardrop: a large radius at the bottom where the train is fast, tightening
     to a small radius at the top where it is slow, which keeps the g-forces
     manageable all the way round.

     The shape is built in the vertical plane by sweeping the tangent angle phi
     from 0 to 2pi with a radius of curvature that varies as r(phi) = A + B cos
     phi, so r = A + B = R at the bottom (phi = 0) and r = A - B = a*R at the
     top (phi = pi). Integrating the tangent gives closed forms for the forward
     (u) and vertical (w) excursion; a forward drift confined to the bottom of
     the loop is added so the piece advances exactly L tiles and grid-snaps
     without distorting the upper body (see loopDrift). LOOP_A is the bottom/top
     radius ratio's complement — smaller means a pointier teardrop.

     r(phi) = A + B cos phi          A = R(1+a)/2,  B = R(1-a)/2
     u(phi) = A sin phi + B(phi/2 + sin 2phi / 4)
     w(phi) = A(1 - cos phi) + B sin^2 phi / 2      peaks at w(pi) = R(1+a) */
  /* A 7 m loop was not a loop anyone could ride. Its top radius was 2.45 m, so
     it needed 4.9 m/s up there to hold the train on and therefore about 14.5 m/s
     at the bottom — while the shape itself only stayed inside the g limits to
     9.7 m/s. There was NO SPEED at which it both stayed on and stayed legal, and
     that is not a ride that can be tuned, only replaced.

     At 10 m the window exists: a 3.5 m top needs 5.9 m/s, so 17.3 m/s at the
     bottom, and 5 g at the bottom is not reached until 19.8 m/s. Narrow, but a
     real target a student can aim a lift hill at — which is the exercise.
     13.5 m tall, and 5.1 g at the bottom at 20 m/s against 6.8 g before.

     LOOP_LEN follows from it. The footprint has to hold 2R = 20 m, so four tiles
     of 6 m rather than three. That used to cost shape: the bare teardrop reaches
     only B*pi forward, about 10.2 m, so loopDrift had to smear the remaining
     13.8 m across the bottom — more than the 10.8 m that phase 1 already found
     marginal. Easing the ends fixed that as a side effect, since a clothoid runs
     nearly straight where it meets the track: the shape now reaches 14.2 m of
     its own accord and only 9.8 m is left to smear. */
  const LOOP_LEN = 4;      // tiles advanced
  const LOOP_LAT = 1;      // tiles sideways
  const LOOP_R = 10;       // metres — the bottom radius of curvature
  const LOOP_A = 0.35;     // top radius = LOOP_A * R; the teardrop's pointiness
  RC.LOOP_R = LOOP_R;
  RC.LOOP_A = LOOP_A;

  /* ---- loop easements ----------------------------------------------------
     The teardrop has r(0) = A + B = R, so until this the curvature STEPPED from
     nothing to 1/R the instant the straight ended — 4.19 g arriving at once on
     the Looper preset, and the last such step anywhere on the catalogue.

     It is eased with the same clothoid a turn uses, laid in the vertical plane:
     curvature ramps linearly from zero to the teardrop's own 1/r at the angle
     the body starts from, so the two meet with nothing in between. The tangent
     still turns through exactly 2*pi over the whole piece — THETA at each end
     and 2*pi - 2*THETA through the body — so the loop still comes back level,
     and the entry easement's rise is exactly the exit easement's fall, so it
     still leaves at the height it entered.

     THE OTHER OPTION IN THE PLAN CANNOT WORK. Redefining the teardrop with
     r -> infinity at phi = 0 fails because tangent angle stops being a usable
     parameter where the track is straight: r ~ 1/phi makes the forward integral
     diverge logarithmically and the loop reaches infinitely far ahead. An
     easement has to be measured in arc length, which is what a clothoid is.

     So t runs uniformly in ARC LENGTH through each easement and uniformly in
     TANGENT ANGLE through the body, each given the share of t its share of the
     length deserves. Uniform angle throughout would be worse than it sounds:
     phi goes as s^2 along a clothoid, so a thousandth of a parameter in is a
     quarter of the way along the easement, and both the sampling and the jolt
     readout would report a step that is not there. */
  function bodyU(phi, A, B) {
    return A * Math.sin(phi) + B * (phi / 2 + Math.sin(2 * phi) / 4);
  }
  function bodyW(phi, A, B) {
    return A * (1 - Math.cos(phi)) + B * Math.sin(phi) * Math.sin(phi) / 2;
  }

  /* Everything about a loop of this size that does not depend on t. Memoised on
     one entry, because centreline is called in a tight loop and always with the
     same size all the way round the piece. */
  let loopShapeCache = null;
  function loopShape(R, a) {
    if (loopShapeCache && loopShapeCache.R === R && loopShapeCache.a === a) {
      return loopShapeCache;
    }
    const th = LOOP_THETA;
    const A = R * (1 + a) / 2, B = R * (1 - a) / 2;
    const re = A + B * Math.cos(th);            // radius where the body begins
    loopShapeCache = {
      R, a, A, B, th, re,
      /* Share of t each easement gets, chosen so that ds/dt MATCHES ACROSS THE
         SEAM: the easement runs at ease/te and the body starts at re*dphi/dt,
         and setting those equal gives te = Ls/(2pi - 2*THETA + 2*Ls), which is
         the same number for every size of loop.

         Sizing it by share of arc length instead — the obvious choice — quietly
         made the ride worse. It ran the easement at the loop's MEAN rate while
         the body starts at its widest and therefore fastest, so t was
         compressed by a quarter right where the sideways drift is steepest, and
         the drift's own bend went from a 14 m radius to 8. That bend is a real
         feature of the piece (a loop steps one tile sideways) and it has to be
         paid for in forward distance; squeezing the forward distance is the one
         thing that makes it sharply worse, since curvature goes as the square
         of it. */
      te: LOOP_LS / (2 * Math.PI - 2 * th + 2 * LOOP_LS),
      jx: re * LOOP_SPIRAL_END.x,                    // where the entry hands over
      jy: re * LOOP_SPIRAL_END.y,
      // The shape's own forward reach, before the grid-snapping drift is added,
      // so the drift can be sized to land the exit on L tiles exactly.
      reach: 2 * re * LOOP_SPIRAL_END.x - 2 * A * Math.sin(th)
             + B * (Math.PI - th - Math.sin(2 * th) / 2),
      top: re * LOOP_SPIRAL_END.y + 2 * A - bodyW(th, A, B)
    };
    return loopShapeCache;
  }

  /* Forward and upward position, in metres, at parameter t. */
  function loopPoint(sh, t) {
    if (t <= sh.te) {
      const p = spiralPoint(LOOP_LS * t / sh.te, LOOP_THETA);
      return { u: sh.re * p.x, w: sh.re * p.y };
    }
    if (t >= 1 - sh.te) {
      // The exit easement is the entry one again, run backwards out of a tangent
      // that has come the whole way round to horizontal.
      const p = spiralPoint(LOOP_LS * (1 - t) / sh.te, LOOP_THETA);
      return { u: sh.reach - sh.re * p.x, w: sh.re * p.y };
    }
    const phi = sh.th + (t - sh.te) / (1 - 2 * sh.te) * (2 * Math.PI - 2 * sh.th);
    return {
      u: sh.jx + bodyU(phi, sh.A, sh.B) - bodyU(sh.th, sh.A, sh.B),
      w: sh.jy + bodyW(phi, sh.A, sh.B) - bodyW(sh.th, sh.A, sh.B)
    };
  }

  /* The height of the top, in metres. Not R(1+a) any more: the entry easement
     lifts the body clear of the ground before the teardrop starts, and the body
     then climbs from THETA rather than from nothing. About half a percent. */
  RC.loopHeight = (R, a) => loopShape(R, a == null ? LOOP_A : a).top;

  function loop(id, label, side) {
    return {
      id, label, kind: 'loop', gIn: FLAT, gOut: FLAT,
      side, L: LOOP_LEN, lat: LOOP_LAT, R: LOOP_R, a: LOOP_A, dH: 0
    };
  }

  const PIECES = [
    straight('flat', 'Flat', FLAT, FLAT),

    straight('gentle-up', 'Gentle up', GENTLE, GENTLE, { liftable: true }),
    straight('gentle-down', 'Gentle down', -GENTLE, -GENTLE),
    straight('medium-up', 'Medium up', MEDIUM, MEDIUM, { liftable: true }),
    straight('medium-down', 'Medium down', -MEDIUM, -MEDIUM),
    straight('steep-up', 'Steep up', STEEP, STEEP, { liftable: true }),
    straight('steep-down', 'Steep down', -STEEP, -STEEP),

    straight('flat-to-gentle-up', 'Flat → gentle up', FLAT, GENTLE, { liftable: true }),
    straight('gentle-up-to-flat', 'Gentle up → flat', GENTLE, FLAT, { liftable: true }),
    straight('flat-to-gentle-down', 'Flat → gentle down', FLAT, -GENTLE),
    straight('gentle-down-to-flat', 'Gentle down → flat', -GENTLE, FLAT),

    straight('gentle-to-medium-up', 'Gentle → medium up', GENTLE, MEDIUM, { liftable: true }),
    straight('medium-to-gentle-up', 'Medium → gentle up', MEDIUM, GENTLE, { liftable: true }),
    straight('gentle-to-medium-down', 'Gentle → medium down', -GENTLE, -MEDIUM),
    straight('medium-to-gentle-down', 'Medium → gentle down', -MEDIUM, -GENTLE),

    straight('medium-to-steep-up', 'Medium → steep up', MEDIUM, STEEP, { liftable: true }),
    straight('steep-to-medium-up', 'Steep → medium up', STEEP, MEDIUM, { liftable: true }),
    straight('medium-to-steep-down', 'Medium → steep down', -MEDIUM, -STEEP),
    straight('steep-to-medium-down', 'Steep → medium down', -STEEP, -MEDIUM),

    turn('turn-left-tight', 'Left, tight', -1, 1.5),
    turn('turn-right-tight', 'Right, tight', 1, 1.5),
    turn('turn-left-wide', 'Left, wide', -1, 2.5),
    turn('turn-right-wide', 'Right, wide', 1, 2.5),
    turn('turn-left-sweeping', 'Left, sweeping', -1, 3.5),
    turn('turn-right-sweeping', 'Right, sweeping', 1, 3.5),

    loop('loop-left', 'Loop, exits left', -1),
    loop('loop-right', 'Loop, exits right', 1),

    straight('station', 'Station', FLAT, FLAT, { station: true }),
    straight('brake', 'Brake run', FLAT, FLAT, { brake: true }),
    straight('launch', 'Launch', FLAT, FLAT, { launch: true })
  ].concat(slopedTurns()).concat(longTurns());

  const BY_ID = new Map(PIECES.map(p => [p.id, p]));

  /* ---- runs of corners --------------------------------------------------
     Two banked corners the same way round are not two corners; they are one
     180 that the builder happened to ask for in two presses. So that is what
     they become, silently, the moment the second one is placed — and a third
     makes a 270. The student never chooses "90, 180 or 270" any more than they
     choose how long a piece of flat track is; it just works.

     LONGER maps a bend to the same bend with one more right angle in it, and
     SHORTER back again. Built by walking the catalogue rather than by splicing
     ids at the call site, so a bend that does not exist — a sloped 270 — simply
     has no entry and the merge declines without needing to know why. */
  const LONGER = new Map(), SHORTER = new Map();
  for (const sh of TURN_SHAPES) {
    const grades = [''].concat(TURN_SLOPES.map(s => '-' + s.suffix));
    for (const g of grades) {
      const chain = [sh.id + g, sh.id + '-180' + g, sh.id + '-270' + g];
      for (let n = 0; n + 1 < chain.length; n++) {
        if (!BY_ID.has(chain[n]) || !BY_ID.has(chain[n + 1])) continue;
        LONGER.set(chain[n], chain[n + 1]);
        SHORTER.set(chain[n + 1], chain[n]);
      }
    }
  }
  RC.PIECES = PIECES;
  RC.pieceDef = id => BY_ID.get(id);

  RC.SLOPE = { FLAT, GENTLE, MEDIUM, STEEP };
  RC.MIN_TRANS_R = MIN_TRANS_R;
  /* Every grade a piece may sit at, shallowest first — the ladder, in one
     place, so the palette and the route search do not each keep their own. */
  RC.GRADES = [FLAT, GENTLE, MEDIUM, STEEP];

  /* What one press actually commits, for the pieces where that stopped being
     obvious. Transitions are now as long as their grade change, so choosing
     "steep" from flat lays two tiles and 2 m of climb, then four tiles and 16 m
     more — a quarter of the way to the ceiling from two clicks. Better said
     before the press than discovered after it. */
  RC.pieceCost = function (def) {
    if (!def) return '';
    const parts = [];
    // A turn's name says how wide it is across the grid, which since the turns
    // were eased is no longer the radius it bends at — and the radius is what
    // decides the sideways force, so it is the number worth saying out loud.
    if (def.kind === 'turn') {
      parts.push(`${(RC.turnRadius(def) * RC.TILE_M).toFixed(1)} m radius`);
    } else if (def.kind !== 'straight') {
      return '';
    } else if (def.L > 1) {
      parts.push(`${def.L} tiles`);
    }
    if (def.dH) {
      parts.push(`${def.dH > 0 ? '+' : '−'}${Math.abs(def.dH) * RC.LEVEL_M} m`);
    }
    return parts.join(', ');
  };

  /* Human-readable slope, for the status bar and palette grouping. */
  const GRADE_NAME = {};
  GRADE_NAME[GENTLE] = 'gentle';
  GRADE_NAME[MEDIUM] = 'medium';
  GRADE_NAME[STEEP] = 'steep';

  RC.slopeName = function (g) {
    if (g === 0) return 'flat';
    return (GRADE_NAME[Math.abs(g)] || '?') + ' ' + (g > 0 ? 'up' : 'down');
  };

  /* ---- geometry -------------------------------------------------------
     A node is the joint between two pieces:
       { i, j, dir, k, g }
     meaning "the track is about to enter tile (i, j) travelling in direction
     dir, at height k levels, with slope g". Its position in continuous tile
     coordinates is the midpoint of that tile's incoming edge. */
  function entryPoint(node) {
    const d = D[node.dir];
    return { x: node.i + 0.5 - 0.5 * d[0], y: node.j + 0.5 - 0.5 * d[1] };
  }
  RC.entryPoint = entryPoint;

  /* Where does this piece put the head? */
  RC.exitNode = function (def, node) {
    const k = node.k + def.dH;
    if (def.kind === 'loop') {
      const d = D[node.dir];
      const lat = D[(node.dir + def.side + 4) & 3];
      const L = node.loopL != null ? node.loopL : def.L;   // grown end loops
      return {
        i: node.i + d[0] * L + lat[0] * def.lat,
        j: node.j + d[1] * L + lat[1] * def.lat,
        dir: node.dir,
        k, g: def.gOut
      };
    }
    if (def.kind === 'straight') {
      const d = D[node.dir];
      return {
        i: node.i + d[0] * def.L,
        j: node.j + d[1] * def.L,
        dir: node.dir,
        k, g: def.gOut
      };
    }
    /* Turn: laid out along the entry direction u and the direction v one right
       angle over, which is where the shape's own (ex, ey) are measured. A
       quarter lands on E + T(u + v); a 180 on E + 2T*v, directly abeam. Either
       way the exit is a whole number of half-tiles along both axes, which is
       what makes it a grid node at all. */
    const dir2 = (node.dir + def.turn + 4) & 3;
    const dirOut = (node.dir + def.turn * def.shape.quarters + 4) & 3;
    const u = D[node.dir], v = D[dir2], w = D[dirOut];
    const E = entryPoint(node);
    const R = def.R / def.shape.tau;
    const px = E.x + R * (def.shape.ex * u[0] + def.shape.ey * v[0]);
    const py = E.y + R * (def.shape.ex * u[1] + def.shape.ey * v[1]);
    // Convert that exit point back into "about to enter tile (i, j)".
    const cx = px + 0.5 * w[0], cy = py + 0.5 * w[1];
    return { i: Math.round(cx - 0.5), j: Math.round(cy - 0.5), dir: dirOut, k, g: def.gOut };
  };

  /* Drift 0 -> 1 for BOTH the loop's forward advance and its sideways offset,
     done ENTIRELY on the bottom of the loop (t in [0, tau] and [1-tau, 1]) and
     held flat through the whole upper body (t in [tau, 1-tau]).

     This is what keeps the loop a proper teardrop. The forward drift exists to
     advance the piece L tiles, but the clothoid's own forward speed goes
     backward over the upper body and is smallest at the top; adding drift
     there fights it and collapses the curvature (radius = speed^2 / accel)
     into vicious tight bends — a huge g at the top, and a second tight spot on
     the ascending side where the two forward speeds cancel. Confining the
     drift to the bottom, where the clothoid is already sweeping forward fast,
     leaves the entire upper body — sides and top — the gentle, undistorted
     clothoid it should be. Holding it flat through the middle also keeps the
     sideways offset constant across the top, so the top is planar and the
     frame inverts cleanly. Smootherstep ramps keep it C^2 at the joins. */
  const LOOP_DRIFT_TAU = 0.25;
  function loopDrift(t) {
    const tau = LOOP_DRIFT_TAU;
    if (t < tau) return 0.5 * smootherstep(t / tau);
    if (t > 1 - tau) return 0.5 + 0.5 * smootherstep((t - (1 - tau)) / tau);
    return 0.5;
  }

  /* A sloped turn's dH is rounded to a whole level, so ramping straight through
     it leaves the piece a fraction of a degree off the grade it joins at either
     end. That reads as nothing on the drawing, but the physics differentiates
     the path: a 1.4 degree bend inside half a metre of track is a 19 m radius,
     and at 20 m/s that is a 2.3 g spike on the trace, in and out within one
     sample. It looked like a fault in the ride and was really a fault here.

     So carry the rounding on a SMOOTHERSTEP, which is zero to one with zero
     first and second derivative at both ends, and let the grade itself carry
     the rest:

       h(t) = m*t + (1 - m) * smootherstep(t)

     where m is the grade's own drop as a fraction of the rounded one. h(0)=0,
     h(1)=1 and h'(0)=h'(1)=m, so the piece leaves and arrives at exactly the
     declared grade — and h''(0)=h''(1)=0, so it also leaves and arrives with no
     VERTICAL curvature, matching the constant-grade track either side of it
     with no step at all.

     That second derivative is why this is no longer the cubic it was. A cubic
     can match the grade at both ends but not the curvature, so it left a step
     of about 0.45 g at 20 m/s at the joints of a sloped turn — small, and
     easily the largest thing left once the turn's own lateral step was eased
     away. There is no reason for the last step on the track to be an artefact
     of rounding. */
  function turnHeightFrac(def, t) {
    const natural = RC.turnRun(def) * def.gIn;   // levels the grade alone gives
    const m = natural / def.dH;
    return m * t + (1 - m) * smootherstep(t);
  }

  /* Height gained by parameter t, in LEVELS, on a straight piece.

     The slope ramps from gIn to gOut through a SMOOTHSTEP rather than linearly.
     That is the whole of the change, and everything else follows from it:

       g(t)    = a + (b - a)(3t^2 - 2t^3)
       rise(t) = L * ( a*t + (b - a)(t^3 - t^4/2) )

     Curvature is proportional to the rate the slope changes, so ramping
     linearly — as this used to — meant a piece held a CONSTANT non-zero
     curvature from end to end and stepped to it at both joints. A rider felt
     the full force of a transition arrive instantly and leave the same way, and
     the measurements bear that out: 1.76 g at once on First Drop, with nothing
     leading up to it. No real track is built that way.

     A smoothstep starts and ends at zero rate, so the piece has zero curvature
     at both ends and meets constant-grade track — which is also zero — with no
     step at all. Not a smaller step: none.

     The integral of a smoothstep over [0,1] is exactly 1/2, so rise(1) is
     L*(a+b)/2 = dH exactly, whatever a and b are. The piece still lands on the
     grid and the node model never notices.

     It costs 1.5x in peak curvature — the same total slope change now happens
     through a profile that starts and ends at zero, and the peak of that is 1.5
     times its mean. The lengths above pay for it and then some: flat to gentle
     went from an 18 m radius over one tile to 25 m over two.

     Working in rise rather than a normalised 0-to-1 fraction also fixes a real
     limitation. A fraction has to be scaled by dH, so a piece whose ends are at
     the SAME height — a crest, gentle up to gentle down — could only ever come
     out flat. Height is integrated here instead, so dH falls out of it rather
     than being assumed non-zero. */
  function riseAt(def, t) {
    const a = def.gIn, b = def.gOut;
    return def.L * (a * t + (b - a) * (t * t * t - t * t * t * t / 2));
  }
  RC.riseAt = riseAt;

  /* The slope, in levels per tile, at parameter t. The derivative of the above
     divided by L — quoted directly because the curvature readout and the tests
     both want the grade at a point rather than the height. */
  function gradeAt(def, t) {
    const a = def.gIn, b = def.gOut;
    return a + (b - a) * t * t * (3 - 2 * t);
  }
  RC.gradeAt = gradeAt;

  /* Centreline point at parameter t in [0, 1].
     Returns continuous tile coords (x, y) and height in levels (z). */
  RC.centreline = function (def, node, t) {
    const E = entryPoint(node);
    if (def.kind === 'loop') {
      const d = D[node.dir];
      const latDir = D[(node.dir + def.side + 4) & 3];
      // Per-piece size if set (resized loops), else the definition's default.
      const R = node.loopR != null ? node.loopR : def.R;
      const a = node.loopA != null ? node.loopA : def.a;
      // Eased clothoid teardrop in the vertical plane, in metres.
      const sh = loopShape(R, a);
      const p = loopPoint(sh, t);
      // Forward + sideways drift, confined to the bottom of the loop (loopDrift)
      // so the piece advances L tiles and grid-snaps without distorting the
      // upper body. Smootherstep, so it is flat in its first two derivatives at
      // t = 0 and adds no curvature of its own where the easement starts.
      const L = node.loopL != null ? node.loopL : def.L;
      const fwdM = p.u + (L * RC.TILE_M - sh.reach) * loopDrift(t);
      const lat = def.lat * loopDrift(t);
      return {
        x: E.x + d[0] * (fwdM / RC.TILE_M) + latDir[0] * lat,
        y: E.y + d[1] * (fwdM / RC.TILE_M) + latDir[1] * lat,
        z: node.k + p.w / RC.LEVEL_M
      };
    }
    if (def.kind === 'straight') {
      const d = D[node.dir];
      return {
        x: E.x + d[0] * def.L * t,
        y: E.y + d[1] * def.L * t,
        z: node.k + riseAt(def, t)
      };
    }
    /* An eased quarter turn, laid out along the entry direction u and the exit
       direction v: the unit shape runs from (0, 0) to (TAU, TAU) in those two
       axes, so scaling by R = T/TAU lands the exit on E + T*(u + v) exactly,
       whichever way the turn goes. t is uniform in ARC LENGTH, as it was for
       the circle, which is what lets the height profile below reason about
       grade at all.

       A turn holds one grade, so that profile is only ever about absorbing the
       rounding in dH; a flat turn has none to absorb. */
    const dir2 = (node.dir + def.turn + 4) & 3;
    const u = D[node.dir], v = D[dir2];
    const R = def.R / def.shape.tau;
    const P = turnPoint(def.shape, t * def.shape.S);
    return {
      x: E.x + R * (u[0] * P.x + v[0] * P.y),
      y: E.y + R * (u[1] * P.x + v[1] * P.y),
      z: node.k + (def.dH === 0 ? 0 : def.dH * turnHeightFrac(def, t))
    };
  };

  /* Path length in metres.

     Measured by sampling for anything whose grade changes along it, which is
     loops and every transition. The closed form below is hypot(run, rise), and
     that is the length of the straight LINE between the ends — right only while
     the grade is constant. It was near enough when a transition was one tile;
     it is not now, and it never described a crest at all, whose ends are at the
     same height while the track between them plainly is not level. */
  function sampledLength(def, samples) {
    const node = { i: 10, j: 10, dir: 0, k: 10, g: def.gIn };
    let total = 0, prev = RC.centreline(def, node, 0);
    for (let n = 1; n <= samples; n++) {
      const c = RC.centreline(def, node, n / samples);
      total += Math.hypot(
        (c.x - prev.x) * RC.TILE_M,
        (c.y - prev.y) * RC.TILE_M,
        (c.z - prev.z) * RC.LEVEL_M
      );
      prev = c;
    }
    return total;
  }

  RC.pieceLength = function (def) {
    if (def.kind === 'loop') return sampledLength(def, 96);
    if (def.kind === 'straight') {
      if (def.gIn === def.gOut) {
        return Math.hypot(def.L * RC.TILE_M, def.dH * RC.LEVEL_M);
      }
      return sampledLength(def, 24 * def.L);
    }
    // A turn: horizontal arc R*(pi/2 + 2*THETA) — the constant-radius middle
    // plus the two spirals, which each turn THETA at half the full curvature
    // and so are twice as long as the arc that would do the same.
    return Math.hypot(RC.turnRun(def) * RC.TILE_M, def.dH * RC.LEVEL_M);
  };

  /* Tiles the piece passes over, by sampling the centreline. Used for bounds
     checks, collision and (later) support placement. */
  RC.pieceTiles = function (def, node) {
    const seen = new Map();
    // Per TILE, not per piece: a four-tile transition sampled eight times could
    // step clean over a tile it passes through and call the ground free.
    const N = def.kind === 'straight' ? 8 * def.L
            : (def.kind === 'loop' ? 48 : 20 * def.shape.quarters);
    for (let s = 0; s <= N; s++) {
      const p = RC.centreline(def, node, s / N);
      const i = Math.floor(p.x), j = Math.floor(p.y);
      const key = i + ',' + j;
      if (!seen.has(key)) seen.set(key, { i, j, k: Math.round(p.z) });
    }
    return [...seen.values()];
  };

  /* ---- the track ------------------------------------------------------ */
  /* A running demonstration, or null. Holds extra tracks standing in the park
     next to the editable one, each with its own train, for comparisons the
     single track cannot make. Set by a prefab, cleared by RC.resetTrack. */
  RC.demo = null;

  RC.track = {
    start: null,     // node the first piece leaves from
    pieces: [],      // [{ defId, node, lift }] — node is the ENTRY node
    head: null       // node the next piece would leave from
  };

  /* Bumped whenever the track changes, so derived data can cache against it. */
  RC.version = 0;

  /* ---- arc-length path -------------------------------------------------
     Every piece sampled into one continuous polyline with cumulative distance
     in METRES. The renderer uses it to space sleepers and supports evenly
     (rather than per-piece, which would bunch them up on turns), and the
     physics runs along the same table so what you see is what is simulated. */
  let pathCache = null, pathCacheVersion = -1;

  /* Sample any chain of pieces into a path. Kept separate from RC.trackPath so
     that a comparison track — one a demo puts in the park alongside the track
     being built — can have a path of its own without going near the editable
     one or its cache. */
  RC.buildPath = function (pieces) {
    const pts = [];
    let s = 0, prev = null;

    for (let pi = 0; pi < pieces.length; pi++) {
      const p = pieces[pi];
      const def = BY_ID.get(p.defId);
      // Per tile for straights, so a long transition's curvature is resolved as
      // finely as a short one's rather than being averaged into a smooth lie.
      // A turn now spends its first and last fifth ramping curvature in and
      // out, so it is sampled more finely than the circle needed: 32 puts six
      // points across each spiral rather than four.
      /* Both curved kinds are sampled by their EASEMENT rather than by their
         length, since that is the shortest thing on them that has to be
         resolved. Six points across a spiral wants about 4.8/THETA, which is 96
         for a turn at 0.05 and the same for a loop's sixteenth. Sampled any
         coarser, a turn's easement would fall between two points and pathAt
         would interpolate straight across it — the physics would never see the
         shape that was drawn. */
      const n = def.kind === 'straight' ? 8 * def.L
              : (def.kind === 'loop' ? 96 : 96 * def.shape.quarters);

      for (let q = 0; q <= n; q++) {
        if (q === 0 && pi > 0) continue;            // joint shared with previous piece
        const t = q / n;
        const c = RC.centreline(def, p.node, t);
        if (prev) {
          s += Math.hypot(
            (c.x - prev.x) * RC.TILE_M,
            (c.y - prev.y) * RC.TILE_M,
            (c.z - prev.z) * RC.LEVEL_M
          );
        }
        // Signed by turn direction: a right turn banks to the right, and rolls
        // in exactly as fast as the curvature does.
        const bank = p.bank && def.kind === 'turn'
          ? def.turn * BANK_ANGLE * bankProfile(t, def.shape)
          : 0;
        pts.push({ x: c.x, y: c.y, z: c.z, s, pi, t, bank, piece: p, def });
        prev = c;
      }
    }

    /* Per-point slope and curvature, in metres, for the physics. dz/ds is the
       sine of the track's pitch — the whole of the gravitational term.

       Curvature is kept as a VECTOR, not just a magnitude: it is d(unit
       tangent)/ds, which points towards the centre of curvature. The g-force
       calculation needs that direction to tell a rider being pressed into
       their seat from one being thrown sideways. */
    for (let n = 0; n < pts.length; n++) {
      const a = pts[Math.max(0, n - 1)];
      const b = pts[Math.min(pts.length - 1, n + 1)];
      const ds = b.s - a.s;
      pts[n].dzds = ds > 1e-9 ? (b.z - a.z) * RC.LEVEL_M / ds : 0;

      const k = curvatureVector(a, pts[n], b);
      pts[n].kx = k[0];
      pts[n].ky = k[1];
      pts[n].kz = k[2];
      pts[n].curv = Math.hypot(k[0], k[1], k[2]);
    }

    buildFrames(pts);

    return { pts, total: s };
  };

  RC.trackPath = function () {
    if (pathCache && pathCacheVersion === RC.version) return pathCache;
    pathCache = RC.buildPath(RC.track.pieces);
    pathCacheVersion = RC.version;
    return pathCache;
  };

  /* ---- orientation frames -----------------------------------------------
     Each path point carries an orthonormal (forward, right, up) frame, built
     POINT BY POINT from the track's design — NOT carried along.

     An earlier version parallel-transported the frame (project the previous
     "up" onto each new tangent). That inverts through a loop, but a loop's path
     is not planar (its sideways drift takes it out of plane), so the transport
     accumulates a holonomy — a net roll that does not cancel at the loop exit
     and then contaminates every piece after it (a banked post-loop turn came
     out upside down). Defining the frame pointwise has no such memory.

     "Up" is:
       - on a loop, the direction toward the centre of curvature (the curvature
         vector). That points up at the bottom, backward on the sides, DOWN at
         the top (so the train inverts), and returns to up at the level exit —
         all with no accumulated twist, because it is read off each point.
       - everywhere else, world up, perpendicular to the tangent. (Non-loop
         track never pitches past ~56 deg, so this never degenerates. Using the
         curvature there would be wrong: at a hill crest the curvature points
         down, but the rider stays upright.)
     Piece bank is then applied on top as a roll about the forward axis. The
     loop's own ends are level with curvature pointing up, matching the world-up
     of the neighbouring track, so the frame stays continuous across the join. */
  function buildFrames(pts) {
    for (let n = 0; n < pts.length; n++) {
      const a = pts[Math.max(0, n - 1)];
      const b = pts[Math.min(pts.length - 1, n + 1)];
      let fx = (b.x - a.x) * RC.TILE_M;
      let fy = (b.y - a.y) * RC.TILE_M;
      let fz = (b.z - a.z) * RC.LEVEL_M;
      let fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-9) { fx = 1; fy = 0; fz = 0; fl = 1; }
      fx /= fl; fy /= fl; fz /= fl;

      // Seed "up": the curvature direction inside a loop, else world up.
      let ux, uy, uz;
      if (pts[n].def && pts[n].def.kind === 'loop') {
        ux = pts[n].kx; uy = pts[n].ky; uz = pts[n].kz;
        if (Math.hypot(ux, uy, uz) < 1e-9) { ux = 0; uy = 0; uz = 1; }
      } else {
        ux = 0; uy = 0; uz = 1;
      }

      // Make it perpendicular to the tangent and unit length.
      let d = ux * fx + uy * fy + uz * fz;
      ux -= d * fx; uy -= d * fy; uz -= d * fz;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-6) {
        ux = -fz * fx; uy = -fz * fy; uz = 1 - fz * fz;
        ul = Math.hypot(ux, uy, uz);
        if (ul < 1e-6) { ux = 0; uy = 1; uz = 0; ul = 1; }
      }
      ux /= ul; uy /= ul; uz /= ul;

      // Right-handed triad: r = u x f.
      let rx = uy * fz - uz * fy;
      let ry = uz * fx - ux * fz;
      let rz = ux * fy - uy * fx;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;

      // Banking rolls the frame about the forward axis.
      const bank = pts[n].bank || 0;
      if (bank) {
        const c = Math.cos(bank), s = Math.sin(bank);
        const nUx = ux * c + rx * s, nUy = uy * c + ry * s, nUz = uz * c + rz * s;
        const nRx = rx * c - ux * s, nRy = ry * c - uy * s, nRz = rz * c - uz * s;
        ux = nUx; uy = nUy; uz = nUz;
        rx = nRx; ry = nRy; rz = nRz;
      }

      pts[n].fx = fx; pts[n].fy = fy; pts[n].fz = fz;
      pts[n].rx = rx; pts[n].ry = ry; pts[n].rz = rz;
      pts[n].ux = ux; pts[n].uy = uy; pts[n].uz = uz;

      /* The geometry readout, kept separate from the frame above because it
         must not move when a turn is banked or when a loop borrows its own
         curvature for "up". */
      const sp = splitCurv([pts[n].kx, pts[n].ky, pts[n].kz], [fx, fy, fz],
                           rightOfDir(pts[n].piece.node.dir));
      pts[n].kVert = sp.vert;
      pts[n].kLat = sp.lat;
    }
  }

  /* Resolve a curvature vector into the two planes a builder thinks in: the
     VERTICAL one, which is grade change — crests and valleys — and the
     HORIZONTAL one, which is turning.

     Both axes come from the WORLD, not from the car. Banking a turn must not
     change the geometry the track reports, and buildFrames seeds a loop's "up"
     from its own curvature, so reading the split off the car frame would call
     every part of a loop a valley. Here "up" is world up made perpendicular to
     the tangent, which fixes the sign everywhere: +vert is a valley (concave
     up), −vert a crest, and +lat a right-hand turn, matching def.turn.

     It flips sense as the track passes through vertical, which happens only
     inside a loop and is not an artefact: past vertical the train is heading
     backwards and down, and the same bend genuinely becomes crest-like — which
     is exactly why the upper half of a loop needs speed to hold the train on.
     Where the tangent is EXACTLY vertical there is no horizontal heading to
     work from, so the caller's fallback "right" stands in.

     `f` is a unit tangent, `k` a curvature vector, both [x, y, z] in metres. */
  function splitCurv(k, f, fallbackRight) {
    // World up, projected perpendicular to the tangent.
    let ux = -f[2] * f[0], uy = -f[2] * f[1], uz = 1 - f[2] * f[2];
    const ul = Math.hypot(ux, uy, uz);
    let rx, ry, rz;
    if (ul > 1e-6) {
      ux /= ul; uy /= ul; uz /= ul;
      rx = uy * f[2] - uz * f[1];      // r = u x f, as in buildFrames
      ry = uz * f[0] - ux * f[2];
      rz = ux * f[1] - uy * f[0];
    } else {
      // Straight up or down: flatten the caller's "right" into the horizontal
      // plane, where it is the only axis left that is perpendicular to travel.
      rx = fallbackRight[0]; ry = fallbackRight[1]; rz = 0;
      const rl = Math.hypot(rx, ry) || 1;
      rx /= rl; ry /= rl;
      ux = f[1] * rz - f[2] * ry;      // u = f x r
      uy = f[2] * rx - f[0] * rz;
      uz = f[0] * ry - f[1] * rx;
    }
    return {
      vert: k[0] * ux + k[1] * uy + k[2] * uz,
      lat: k[0] * rx + k[1] * ry + k[2] * rz
    };
  }
  RC.splitCurv = splitCurv;

  /* The rider's right, in world terms, for a node's entry direction. */
  function rightOfDir(dir) {
    const d = D[dir & 3];
    return [-d[1], d[0]];
  }

  /* Curvature vector at b, from its neighbours a and c: the rate of change of
     the unit tangent with arc length. Magnitude is 1/radius; direction points
     towards the centre of curvature. All in metres. */
  function curvatureVector(a, b, c) {
    const P = p => [p.x * RC.TILE_M, p.y * RC.TILE_M, p.z * RC.LEVEL_M];
    const A = P(a), B = P(b), C = P(c);
    const t1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const t2 = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
    const l1 = Math.hypot(t1[0], t1[1], t1[2]);
    const l2 = Math.hypot(t2[0], t2[1], t2[2]);
    if (l1 < 1e-9 || l2 < 1e-9) return [0, 0, 0];
    const ds = (l1 + l2) / 2;
    return [
      (t2[0] / l2 - t1[0] / l1) / ds,
      (t2[1] / l2 - t1[1] / l1) / ds,
      (t2[2] / l2 - t1[2] / l1) / ds
    ];
  }

  /* Each piece's extent along the arc-length path, in metres, with its
     midpoint — for annotating the graph. Turns and loops are numbered in
     build order (T1, T2… and L1, L2…) since those are the pieces whose
     acceleration is worth pointing at. */
  RC.pieceSpans = function () {
    const pts = RC.trackPath().pts;
    const spans = [];
    let cur = null, tN = 0, lN = 0;
    for (const p of pts) {
      if (!cur || cur.pi !== p.pi) {
        // The joint point (a piece's t=1) is recorded against the previous
        // piece, and the new piece's first recorded point is one sample in.
        // Start the new span at the previous span's end so they stay
        // contiguous rather than leaving the joint gap uncovered.
        cur = { pi: p.pi, defId: p.piece.defId, kind: p.def.kind,
                s0: cur ? cur.s1 : p.s, s1: p.s, label: null };
        spans.push(cur);
      } else {
        cur.s1 = p.s;
      }
    }
    for (const sp of spans) {
      sp.sMid = (sp.s0 + sp.s1) / 2;
      if (sp.kind === 'turn') sp.label = 'T' + (++tN);
      else if (sp.kind === 'loop') sp.label = 'L' + (++lN);
    }
    return spans;
  };

  /* ---- joints and what the shape allows ---------------------------------
     Where two pieces meet, the curvature changes in one jump. That is not a
     small thing: the force a rider feels changes by dk*v^2 with no transition
     at all, so the jerk at a joint is infinite and no real track is built that
     way — real track eases every joint out to zero curvature and back.

     The STEP is what this model can state exactly. "3.2 g arrives at once
     entering Turn 1" is a true sentence about this track; "the jerk is 40 g/s"
     would be a number invented by the sampling rate, which is why there is a
     jolt readout here and no jerk graph anywhere. */
  /* How far inside a piece to look, as a fraction of its parameter. It has to
     be small against the shortest easement on the catalogue or it reads across
     one and reports a step that is not there: a corner eases over 6% of its
     parameter now, where it used to be 20%, so a thousandth was 1.7% of the way
     up the ramp and a ten-thousandth is 0.17%. Numerically safe at that — 2 mm
     between samples on a 24 m piece, against a double's 1e-15. */
  const CURV_EPS = 1e-4;
  RC.CURV_EPS = CURV_EPS;

  /* Curvature just INSIDE a piece, at parameter t. Sampling only within the
     piece is the whole point: the path's own three-point curvature at a joint
     straddles both sides and averages away the very step being measured. */
  function curvInside(def, node, t) {
    const a = RC.centreline(def, node, t - CURV_EPS);
    const b = RC.centreline(def, node, t);
    const c = RC.centreline(def, node, t + CURV_EPS);
    const k = curvatureVector(a, b, c);
    let fx = (c.x - a.x) * RC.TILE_M;
    let fy = (c.y - a.y) * RC.TILE_M;
    let fz = (c.z - a.z) * RC.LEVEL_M;
    const fl = Math.hypot(fx, fy, fz) || 1;
    return splitCurv(k, [fx / fl, fy / fl, fz / fl], rightOfDir(node.dir));
  }
  RC.curvInside = curvInside;

  function jointRecord(s, pi, kIn, kOut) {
    const dVert = kOut.vert - kIn.vert;
    const dLat = kOut.lat - kIn.lat;
    return {
      s, pi,
      vertIn: kIn.vert, vertOut: kOut.vert,
      latIn: kIn.lat, latOut: kOut.lat,
      dVert, dLat,
      dMag: Math.hypot(dVert, dLat)
    };
  }

  let jointCache = null, jointCacheVersion = -1;

  /* Every joint on the track, with the curvature on each side of it. `pi` is
     the piece the train is entering. */
  RC.jointSteps = function () {
    if (jointCache && jointCacheVersion === RC.version) return jointCache;
    const pieces = RC.track.pieces;
    const out = [];
    const at = (pi, t) => {
      const p = pieces[pi];
      return curvInside(BY_ID.get(p.defId), p.node, t);
    };
    if (pieces.length > 1) {
      const spans = RC.pieceSpans();
      for (let pi = 1; pi < pieces.length; pi++) {
        out.push(jointRecord(spans[pi].s0, pi, at(pi - 1, 1 - CURV_EPS), at(pi, CURV_EPS)));
      }
      // On a closed circuit the last piece runs into the first, and the train
      // crosses that joint at speed like any other. Recorded at the far end of
      // the path, so it is passed before the lap counter wraps s back to zero.
      if (sameNode(RC.track.head, RC.track.start)) {
        out.push(jointRecord(RC.trackPath().total, 0,
                             at(pieces.length - 1, 1 - CURV_EPS), at(0, CURV_EPS)));
      }
    }
    jointCache = out;
    jointCacheVersion = RC.version;
    return out;
  };

  /* The jolt a joint delivers to a train crossing it at v, in g. */
  RC.jointStepG = function (joint, v) {
    return joint.dMag * v * v / (RC.G || 9.81);
  };

  /* What the track's SHAPE allows, before any train has run on it.

     Every limit in RC.G_LIMITS is a bound on v^2, because the centripetal term
     is the only speed-dependent part of what a rider feels: each axis reads
     A + B*v^2, where A is what they feel standing still on that piece of track
     and B comes from the curvature. So the speed at which a point of track
     first breaks a published limit is solved, not searched for, and the
     smallest of those over the whole track is the speed the track is honest to.

     That number is the whole point of the geometry work — a catalogue that lets
     a student reach speeds its own pieces cannot carry is a catalogue that
     judges them against limits it never gave them the means to meet. */
  RC.trackGeometry = function () {
    const pts = RC.trackPath().pts;
    const L = RC.G_LIMITS;
    const g = RC.G || 9.81;
    const out = {
      crestR: null, crestS: null,      // tightest radius of each kind, in metres
      valleyR: null, valleyS: null,
      turnR: null, turnS: null,
      honestV: null, honestS: null, honestWhy: null
    };
    if (!pts.length || !L) return out;

    const tighter = (r, key) => out[key + 'R'] === null || r < out[key + 'R'];

    for (const p of pts) {
      const kv = p.kVert || 0, kl = p.kLat || 0;
      if (kv < -1e-9 && tighter(-1 / kv, 'crest')) { out.crestR = -1 / kv; out.crestS = p.s; }
      if (kv > 1e-9 && tighter(1 / kv, 'valley')) { out.valleyR = 1 / kv; out.valleyS = p.s; }
      if (Math.abs(kl) > 1e-9 && tighter(1 / Math.abs(kl), 'turn')) {
        out.turnR = 1 / Math.abs(kl); out.turnS = p.s;
      }

      // Resolved on the CAR's axes, banking and all, because that is what the
      // rider feels and what the g limits are written against.
      const Bv = (p.kx * p.ux + p.ky * p.uy + p.kz * p.uz) / g, Av = p.uz;
      const Bl = (p.kx * p.rx + p.ky * p.ry + p.kz * p.rz) / g, Al = p.rz;
      const cap = (num, den, why) => {
        if (Math.abs(den) < 1e-12) return;
        const v2 = num / den;
        // A negative bound means the limit is broken standing still, which only
        // a loop can manage — there it is a MINIMUM speed, not a maximum, and
        // the ride report's own g warnings are the place for it.
        if (!(v2 >= 0)) return;
        const v = Math.sqrt(v2);
        if (out.honestV === null || v < out.honestV) {
          out.honestV = v; out.honestS = p.s; out.honestWhy = why;
        }
      };
      if (Bv > 0) cap(L.vertHigh - Av, Bv, 'vertical');
      else if (Bv < 0) cap(L.airtimeGood - Av, Bv, 'airtime');
      if (Bl > 0) cap(L.latHigh - Al, Bl, 'sideways');
      else if (Bl < 0) cap(-L.latHigh - Al, Bl, 'sideways');
    }
    return out;
  };

  /* ---- named features ---------------------------------------------------
     The things a student would point at: "Drop 1", "Turn 2", "Loop 1". A
     feature is a contiguous run of pieces doing the same job, so a hill built
     from six pieces is ONE hill rather than six, and each kind is numbered in
     build order. This is what the report quotes and what the graph shades, so
     a spike can be named instead of being given as a distance along the track. */
  const FEATURE_NAMES = {
    loop: 'Loop', turn: 'Turn', lift: 'Lift', hill: 'Hill', drop: 'Drop',
    brake: 'Brakes', launch: 'Launch', station: 'Station'
  };
  // Everything except the station, of which there is only ever the one.
  const NUMBERED = { loop: 1, turn: 1, lift: 1, hill: 1, drop: 1, brake: 1, launch: 1 };

  function featureKind(pieceEntry, def) {
    if (def.kind === 'loop') return { type: 'loop' };
    // Turns only merge with turns going the SAME way, so an S-bend reads as
    // two turns rather than one long one.
    if (def.kind === 'turn') return { type: 'turn', dir: def.turn };
    if (def.station) return { type: 'station' };
    if (def.brake) return { type: 'brake' };
    if (def.launch) return { type: 'launch' };
    if (def.dH > 0) return { type: pieceEntry && pieceEntry.lift ? 'lift' : 'hill' };
    if (def.dH < 0) return { type: 'drop' };
    return { type: 'flat' };          // plain track, deliberately unnamed
  }

  let featCache = null, featCacheVersion = -1;

  RC.features = function () {
    if (featCache && featCacheVersion === RC.version) return featCache;

    const feats = [];
    let cur = null;
    for (const sp of RC.pieceSpans()) {
      const k = featureKind(RC.track.pieces[sp.pi], BY_ID.get(sp.defId));
      if (cur && cur.type === k.type && cur.dir === k.dir) {
        cur.s1 = sp.s1;
      } else {
        cur = { type: k.type, dir: k.dir, s0: sp.s0, s1: sp.s1, label: null };
        feats.push(cur);
      }
    }

    const seen = {};
    for (const f of feats) {
      f.sMid = (f.s0 + f.s1) / 2;
      const name = FEATURE_NAMES[f.type];
      if (!name) continue;
      if (NUMBERED[f.type]) {
        seen[f.type] = (seen[f.type] || 0) + 1;
        f.n = seen[f.type];
        f.label = name + ' ' + f.n;
      } else {
        f.label = name;
      }
    }

    featCache = feats;
    featCacheVersion = RC.version;
    return feats;
  };

  /* The named feature covering this point, or null on plain track (and past
     the end of it, where a train that has left the rails has no feature). */
  RC.featureAt = function (s) {
    for (const f of RC.features()) {
      if (s >= f.s0 && s <= f.s1) return f.label ? f : null;
    }
    return null;
  };

  /* Distance along the track between two arc positions. On a closed circuit
     the short way round counts, so a point just after the start line is near
     one just before it rather than a full lap away. */
  RC.arcGap = function (s1, s2, closed) {
    const total = RC.trackPath().total;
    let d = Math.abs(s1 - s2);
    if (closed && total > 0) {
      d = d % total;
      d = Math.min(d, total - d);
    }
    return d;
  };

  /* Interpolated state at arc position s (metres). Wraps on a closed
     circuit, clamps otherwise. */
  RC.pathAt = function (sQuery, closed) {
    return RC.pathAtIn(RC.trackPath(), sQuery, closed);
  };

  /* The same lookup against an explicitly given path, so a comparison train
     can be positioned on its own track. */
  RC.pathAtIn = function (path, sQuery, closed) {
    const pts = path.pts;
    if (pts.length < 2) return null;

    let s = sQuery;
    if (closed) {
      s = ((s % path.total) + path.total) % path.total;
    } else {
      s = Math.min(path.total, Math.max(0, s));
    }

    let lo = 0, hi = pts.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const span = b.s - a.s;
    const f = span > 1e-9 ? (s - a.s) / span : 0;
    const mix = (p, q) => p + (q - p) * f;
    return {
      s,
      x: mix(a.x, b.x),
      y: mix(a.y, b.y),
      z: mix(a.z, b.z),
      dzds: mix(a.dzds, b.dzds),
      curv: mix(a.curv, b.curv),
      kVert: mix(a.kVert, b.kVert),
      kLat: mix(a.kLat, b.kLat),
      kx: mix(a.kx, b.kx),
      ky: mix(a.ky, b.ky),
      kz: mix(a.kz, b.kz),
      bank: mix(a.bank, b.bank),
      // Frame axes, interpolated; RC.carFrame re-orthonormalises them.
      fx: mix(a.fx, b.fx), fy: mix(a.fy, b.fy), fz: mix(a.fz, b.fz),
      ux: mix(a.ux, b.ux), uy: mix(a.uy, b.uy), uz: mix(a.uz, b.uz),
      piece: f < 0.5 ? a.piece : b.piece,
      def: f < 0.5 ? a.def : b.def
    };
  };

  function sameNode(a, b) {
    return a && b && a.i === b.i && a.j === b.j && a.dir === b.dir && a.k === b.k && a.g === b.g;
  }
  RC.sameNode = sameNode;

  /* ---- collision -------------------------------------------------------
     Track may cross over itself, but not run through itself. Two bits of
     track conflict when they share a tile with less than CLEARANCE levels
     between them.

     Only the INTERIOR of a piece is tested (t in 0.2..0.8) and the piece
     immediately behind the head is skipped, because neighbouring pieces
     legitimately share their joint tile. Without both of those, ordinary
     S-bends and U-turns would be refused. */
  const CLEARANCE = 6;   // levels — 3 m, as it has always been

  function interiorCells(def, node) {
    const cells = [];
    const n = def.kind === 'straight' ? 10 * def.L
            : (def.kind === 'turn' ? 24 * def.shape.quarters : 24);
    for (let q = 0; q <= n; q++) {
      const t = q / n;
      if (t < 0.2 || t > 0.8) continue;
      const c = RC.centreline(def, node, t);
      cells.push({ i: Math.floor(c.x), j: Math.floor(c.y), z: c.z });
    }
    return cells;
  }

  /* Occupancy of the existing track, tile -> [{z, pi}], cached against the
     version counter. Rebuilding this per collision test made the palette
     O(pieces^2) on every refresh and would have made the route search below
     unusable. */
  let occCache = null, occCacheVersion = -1;

  function occupancy() {
    if (occCache && occCacheVersion === RC.version) return occCache;
    const m = new Map();
    const pieces = RC.track.pieces;
    for (let pi = 0; pi < pieces.length; pi++) {
      for (const c of interiorCells(BY_ID.get(pieces[pi].defId), pieces[pi].node)) {
        const key = c.i + ',' + c.j;
        let arr = m.get(key);
        if (!arr) { arr = []; m.set(key, arr); }
        arr.push({ z: c.z, pi });
      }
    }
    occCache = m;
    occCacheVersion = RC.version;
    return m;
  }

  /* skipFrom: ignore that piece and everything after it. Placing skips the one
     at the head, which legitimately shares its joint tile; merging a run of
     corners skips the whole run, since the piece being tested is standing in
     for exactly those. */
  function collidesWith(def, node, occ, skipFrom) {
    for (const c of interiorCells(def, node)) {
      const arr = occ.get(c.i + ',' + c.j);
      if (!arr) continue;
      for (const e of arr) {
        if (e.pi >= skipFrom) continue;
        if (Math.abs(e.z - c.z) < CLEARANCE) return true;
      }
    }
    return false;
  }

  function collides(def, head) {
    // The piece at the head legitimately shares its joint tile.
    return collidesWith(def, head, occupancy(), RC.track.pieces.length - 1);
  }

  /* Can this piece go on the head right now, and if not, why? */
  RC.canPlace = function (def, head) {
    if (!head) return { ok: false, why: 'No build head' };
    if (def.gIn !== head.g) {
      return { ok: false, why: `Needs a ${RC.slopeName(def.gIn)} entry` };
    }
    const exit = RC.exitNode(def, head);
    if (exit.k < 0) return { ok: false, why: 'Would go below ground' };
    if (exit.k > MAX_H) return { ok: false, why: 'Too high' };

    // A loop rises well above both its ends, so checking the exit alone isn't
    // enough — the whole centreline has to clear the ground and the ceiling.
    if (def.kind === 'loop') {
      for (let n = 0; n <= 24; n++) {
        const z = RC.centreline(def, head, n / 24).z;
        if (z < 0) return { ok: false, why: 'The loop would go below ground' };
        if (z > MAX_H) return { ok: false, why: 'The loop would be too high' };
      }
    }
    for (const t of RC.pieceTiles(def, head)) {
      if (!RC.inBounds(t.i, t.j)) return { ok: false, why: 'Off the edge of the park' };
    }
    if (!RC.inBounds(exit.i, exit.j)) return { ok: false, why: 'Off the edge of the park' };
    if (collides(def, head)) return { ok: false, why: 'Runs into track already built' };
    return { ok: true, exit };
  };

  /* Would these two placed pieces read as one longer bend? Everything has to
     match, because the merged piece has one id and therefore one of each: the
     same size, the same way round, the same grade, the same chain, and banked —
     the roll pulsing to level and back between two eased quarters is the fault
     being fixed, and an unbanked pair has no pulse to fix. The second must be a
     plain quarter, so a 180 and a 180 do not become a 360 that has no exit. */
  function sameRun(aDef, a, bDef, b) {
    return a.bank && b.bank && !!a.lift === !!b.lift &&
           aDef.kind === 'turn' && bDef.kind === 'turn' &&
           aDef.turn === bDef.turn && aDef.R === bDef.R && aDef.gIn === bDef.gIn &&
           bDef.shape.quarters === 1;
  }

  /* Fold the last two pieces into one longer bend, if they are a run and the
     bend that would replace them fits. Its exit node is identical by
     construction — that is what the whole shape is arranged around — but it
     bends at a WIDER radius and so covers different ground, which has to be
     checked against everything except the pieces it is standing in for. */
  function mergeRun() {
    const pieces = RC.track.pieces;
    const n = pieces.length;
    if (n < 2) return;
    const prev = pieces[n - 2], last = pieces[n - 1];
    const prevDef = BY_ID.get(prev.defId), lastDef = BY_ID.get(last.defId);
    if (!sameRun(prevDef, prev, lastDef, last)) return;
    const merged = BY_ID.get(LONGER.get(prev.defId));
    if (!merged) return;              // no such bend — a sloped 270, say

    for (const t of RC.pieceTiles(merged, prev.node)) {
      if (!RC.inBounds(t.i, t.j)) return;
    }
    if (collidesWith(merged, prev.node, occupancy(), n - 2)) return;

    pieces.splice(n - 2, 2, {
      defId: merged.id, node: prev.node, lift: prev.lift, bank: true
    });
    RC.version++;
  }

  RC.place = function (defId, opts) {
    const def = BY_ID.get(defId);
    if (!def) return false;
    const head = RC.track.head;
    const check = RC.canPlace(def, head);
    if (!check.ok) return false;
    mark();                              // after the check: a refusal is not an edit
    RC.track.pieces.push({
      defId,
      node: { i: head.i, j: head.j, dir: head.dir, k: head.k, g: head.g },
      lift: !!(opts && opts.lift) && !!def.liftable,
      bank: !!(opts && opts.bank) && def.kind === 'turn'
    });
    RC.track.head = check.exit;
    RC.version++;
    mergeRun();
    return true;
  };

  /* Lay out a chain of pieces from a start node WITHOUT touching RC.track —
     for the comparison tracks a demo stands in the park beside the one being
     built. Deliberately does not run the collision checks: these tracks are
     positioned by the preset that knows where it is putting them, and testing
     them against the editable track's occupancy would be wrong anyway. Slope
     continuity is still enforced, since a mismatch there is a mistake. */
  RC.buildChain = function (startNode, ids) {
    const start = Object.assign({}, startNode);
    let head = Object.assign({}, startNode);
    const pieces = [];
    for (const id of ids) {
      const def = BY_ID.get(id);
      if (!def) return { ok: false, why: `No piece called "${id}"` };
      if (def.gIn !== head.g) {
        return { ok: false, why: `${id} needs a ${RC.slopeName(def.gIn)} entry, ` +
                                 `but the chain is ${RC.slopeName(head.g)} there` };
      }
      pieces.push({
        defId: id,
        node: { i: head.i, j: head.j, dir: head.dir, k: head.k, g: head.g },
        lift: false, bank: false
      });
      head = RC.exitNode(def, head);
      if (head.k < 0) return { ok: false, why: `${id} would go below ground` };
      if (head.k > MAX_H) return { ok: false, why: `${id} would go too high` };
      if (!RC.inBounds(head.i, head.j)) return { ok: false, why: `${id} would leave the park` };
    }
    return { ok: true, pieces, start, head };
  };

  /* ---- undo and redo ----------------------------------------------------
     UNDO REVERSES THE LAST THING THE STUDENT DID, whatever that was. It used to
     mean "take the last piece off", which is a different thing wearing the same
     name and reads as a bug the moment you delete a section: pressing undo
     carried on deleting rather than putting the section back. Removing track is
     an EDIT now (RC.removeLast, on Backspace and the build window's button) and
     undo reverses edits, including that one.

     Both stacks are whole-track snapshots. Inverse operations were tried for
     undo and are a trap: "what was removed" is not recoverable from what is
     left, and a merge means one press can change two pieces. Snapshots are JSON,
     which is what the save format already is — small, cheap, and immune to any
     structure sharing a reference with the live track.

     mark() is called by every edit before it changes anything, and clears the
     redo stack because a fresh edit forks the future. RC.edit groups several
     changes into one step, which is what makes "Finish track" and "remove this
     section" one press of undo each rather than thirty. */
  const MAX_UNDO = 100;
  let undoStack = [], redoStack = [], editDepth = 0;

  function snapshot() {
    return JSON.stringify({
      start: RC.track.start, head: RC.track.head, pieces: RC.track.pieces
    });
  }
  function restore(json) {
    const d = JSON.parse(json);
    RC.track.start = d.start;
    RC.track.head = d.head;
    RC.track.pieces = d.pieces;
    RC.version++;
  }

  function mark() {
    if (editDepth) return;                 // already inside a grouped edit
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  /* Run fn as ONE undoable step, however many edits it makes inside. */
  RC.edit = function (fn) {
    mark();
    editDepth++;
    try { return fn(); } finally { editDepth--; }
  };

  /* Opening a different track is not an edit to this one — there is nothing
     sensible to undo back to, so both stacks go. Called by the loaders. */
  RC.clearHistory = function () {
    undoStack.length = 0;
    redoStack.length = 0;
    editDepth = 0;
  };

  RC.canUndo = () => undoStack.length > 0;
  RC.canRedo = () => redoStack.length > 0;

  RC.undo = function () {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    return true;
  };

  RC.redo = function () {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    return true;
  };

  /* Take the last piece off — the EDIT, not the undo. A long bend loses one
     right angle rather than vanishing, so a 270 takes three presses to clear
     what three presses built. Deriving the shorter bend from the longer one
     rather than remembering what was merged is what lets this work on a track
     this session never built: a 180 opened from a save comes apart exactly like
     one just placed. */
  RC.removeLast = function () {
    const t = RC.track;
    if (!t.pieces.length) return false;
    mark();

    const last = t.pieces[t.pieces.length - 1];
    const def = BY_ID.get(last.defId);

    // Shrinking a long bend can only ever return the footprint to a state the
    // track was already in, so it needs no collision check of its own.
    const shorter = def && def.kind === 'turn' ? BY_ID.get(SHORTER.get(last.defId)) : null;
    if (shorter) {
      t.pieces[t.pieces.length - 1] = {
        defId: shorter.id, node: last.node, lift: last.lift, bank: last.bank
      };
      t.head = RC.exitNode(shorter, last.node);
      RC.version++;
      return true;
    }

    t.pieces.pop();
    t.head = { i: last.node.i, j: last.node.j, dir: last.node.dir, k: last.node.k, g: last.node.g };
    RC.version++;
    return true;
  };

  /* ---- loop sizing -----------------------------------------------------
     A loop's radius can be changed after it's built, in discrete metre steps.

     Both end and in-situ loops behave identically until the FIXED footprint
     can no longer hold a bigger loop. Up to that point the footprint stays put
     and only the height changes. Past it:
       - A loop at the END (the last piece) grows its footprint — a longer
         intro/outro — and moves the build head, which disturbs nothing.
       - A loop IN SITU (track after it) simply caps there, since growing its
         footprint would move its exit and shift everything downstream.

     A loop's horizontal excursion is about 2R metres, so a footprint of L tiles
     holds it when 2R <= L * TILE_M, i.e. up to R = L * TILE_M / 2.

     That conversion used to be written `2 * L`, which is the same number only
     while a tile is 4 m — it was multiplying tiles as though they were metres.
     At 6 m tiles it under-capped badly enough to clamp the default 7 m loop
     down to 6 m. Both directions now go through TILE_M. */
  /* The range a built loop may be resized through. LOOP_R_MAX has to leave the
     default loop room to GROW past its own footprint, or "a loop at the end
     grows its footprint" stops being a thing that can happen: at 4 tiles the
     footprint holds 2R = 24 m, so a 12 m ceiling meant the biggest loop fitted
     exactly and the footprint never moved. 15 m needs five tiles. */
  const LOOP_R_MIN = 5, LOOP_R_MAX = 15, LOOP_R_STEP = 1;
  RC.LOOP_R_MIN = LOOP_R_MIN;
  RC.LOOP_R_MAX = LOOP_R_MAX;
  RC.LOOP_R_STEP = LOOP_R_STEP;

  /* Smallest footprint (tiles) that holds a loop of radius R metres. */
  function loopFootprintFor(R, def) {
    return Math.max(def.L, Math.ceil(2 * R / RC.TILE_M));
  }
  /* Largest radius (metres) a fixed footprint of L tiles can hold. Deliberately
     stricter than the shape needs: an eased loop reaches 1.416 R forward on its
     own, so L tiles would hold R up to 0.706*L*TILE_M, but pricing it at 2R
     leaves the drift room to work with rather than squeezing it to nothing. */
  function loopMaxRForFootprint(L) {
    return Math.min(LOOP_R_MAX, L * RC.TILE_M / 2);
  }

  RC.loopR = function (pieceIndex) {
    const p = RC.track.pieces[pieceIndex];
    if (!p) return null;
    const def = BY_ID.get(p.defId);
    if (def.kind !== 'loop') return null;
    return p.node.loopR != null ? p.node.loopR : def.R;
  };

  RC.loopFootprint = function (pieceIndex) {
    const p = RC.track.pieces[pieceIndex];
    if (!p) return null;
    const def = BY_ID.get(p.defId);
    if (def.kind !== 'loop') return null;
    return p.node.loopL != null ? p.node.loopL : def.L;
  };

  /* Whether resizing this loop would grow its footprint (it's the last piece). */
  RC.loopGrowsFootprint = function (pieceIndex) {
    return pieceIndex === RC.track.pieces.length - 1;
  };

  /* The largest radius this particular loop may take: the whole range if it's
     at the end (footprint can grow), else only what its fixed footprint holds. */
  RC.loopMaxR = function (pieceIndex) {
    if (RC.loopGrowsFootprint(pieceIndex)) return LOOP_R_MAX;
    return loopMaxRForFootprint(RC.loopFootprint(pieceIndex));
  };

  /* Set a loop's radius, validating that the resized shape stays in the park,
     above ground, under the ceiling, and clear of other track. An end loop
     grows its footprint past the fixed-footprint limit and moves the build
     head; an in-situ loop is capped there. On failure nothing changes. */
  RC.setLoopR = function (pieceIndex, newR) {
    const pieces = RC.track.pieces;
    const p = pieces[pieceIndex];
    if (!p) return { ok: false, why: 'No such piece' };
    const def = BY_ID.get(p.defId);
    if (def.kind !== 'loop') return { ok: false, why: 'That piece is not a loop' };

    const isEnd = pieceIndex === pieces.length - 1;
    const curL = p.node.loopL != null ? p.node.loopL : def.L;
    // Cap the radius: the full range at the end, else what the footprint holds.
    const cap = isEnd ? LOOP_R_MAX : loopMaxRForFootprint(curL);
    newR = Math.min(cap, Math.max(LOOP_R_MIN, newR));
    // Only an end loop grows its footprint, and only once past the fixed limit.
    const newL = isEnd ? loopFootprintFor(newR, def) : curL;
    const testNode = Object.assign({}, p.node, { loopR: newR, loopL: newL });

    for (let n = 0; n <= 40; n++) {
      const c = RC.centreline(def, testNode, n / 40);
      if (!RC.inBounds(Math.floor(c.x), Math.floor(c.y))) {
        return { ok: false, why: 'A bigger loop would leave the park' };
      }
      if (c.z < 0) return { ok: false, why: 'The loop would dip below ground' };
      if (c.z > MAX_H) return { ok: false, why: 'The loop would be too tall' };
    }
    const exit = RC.exitNode(def, testNode);
    if (!RC.inBounds(exit.i, exit.j)) return { ok: false, why: 'A bigger loop would run off the edge' };
    // Check the resized loop against every OTHER piece; occupancy still holds
    // this loop's old cells at its own index, which collidesWith skips.
    if (collidesWith(def, testNode, occupancy(), pieceIndex)) {
      return { ok: false, why: 'A bigger loop would hit other track' };
    }

    mark();                               // every check passed, so this is an edit
    p.node.loopR = newR;
    p.node.loopL = newL;
    if (isEnd) RC.track.head = exit;      // the grown footprint moved the head
    RC.version++;
    return { ok: true, R: newR, L: newL };
  };

  /* ---- circuit validation ---------------------------------------------
     Closed: the head has come back to exactly the node the track started
     from. Shuttle: it hasn't, but there's a launch piece to drive an
     out-and-back run. */
  RC.circuitStatus = function () {
    const t = RC.track;
    if (!t.pieces.length) return { kind: 'empty', label: 'No track' };

    // A demonstration is a straight run down a hill, released from rest: no
    // station (whose drive tyres would add energy the demo is trying to say
    // came only from gravity) and no circuit to close.
    if (RC.demo) return { kind: 'demo', label: RC.demo.label || 'Demonstration', ok: true };

    const hasStation = t.pieces.some(p => BY_ID.get(p.defId).station);
    const hasLaunch = t.pieces.some(p => BY_ID.get(p.defId).launch);

    if (sameNode(t.head, t.start)) {
      return hasStation
        ? { kind: 'closed', label: 'Complete circuit', ok: true }
        : { kind: 'closed-nostation', label: 'Circuit closed, but no station' };
    }
    // Not a closed loop, but it can still be driven out-and-back: it has a
    // launch piece, or the student has left Shuttle switched on. Either way it
    // needs a station to launch from and return to.
    const asShuttle = hasLaunch || (hasStation && RC.sim && RC.sim.shuttleMode);
    if (asShuttle) {
      return hasStation
        ? { kind: 'shuttle', label: 'Shuttle track', ok: true }
        : { kind: 'shuttle-nostation', label: 'Shuttle, but no station' };
    }
    return { kind: 'open', label: 'Track is not finished' };
  };

  /* Total path length in metres. */
  RC.trackLength = function () {
    return RC.track.pieces.reduce((s, p) => s + RC.pieceLength(BY_ID.get(p.defId)), 0);
  };

  /* Arc position, in metres, at the exit of the station the train starts in —
     the first contiguous run of station pieces from the start of the track.
     Returns 0 if there is no station. The train parks with its front car
     here, so the whole train sits back inside the station. */
  RC.stationEndS = function () {
    const pts = RC.trackPath().pts;
    let end = 0;
    for (const p of pts) {
      if (p.def && p.def.station) end = p.s;
      else if (end > 0) break;      // left the opening station run
    }
    return end;
  };

  /* ---- finish the track -------------------------------------------------
     RCT2's "complete the circuit": search for any sequence of pieces from the
     build head back to the start node. The result is deliberately dull — the
     point is to close a circuit so it can be tested, not to design a ride.

     A* over nodes {i, j, dir, k, g}. The cost is roughly one per piece, so a
     heuristic counting the fewest pieces that could possibly cover the
     remaining distance is admissible. */

  /* Only plain geometry — no stations, brakes or launches in a filler run.

     The sweeping turn is deliberately NOT here. Every id in this list widens
     the search and raises MAX_ADVANCE, which the heuristic divides by — a
     3.5-tile piece would weaken it by 40% and slow every auto-close, to offer a
     corner too big to be much use in the short hop this is asked to find. The
     filler's job is to close a circuit, not to design one. */
  const ROUTE_IDS = [
    'flat',
    'gentle-up', 'gentle-down', 'medium-up', 'medium-down', 'steep-up', 'steep-down',
    'flat-to-gentle-up', 'gentle-up-to-flat',
    'flat-to-gentle-down', 'gentle-down-to-flat',
    'gentle-to-medium-up', 'medium-to-gentle-up',
    'gentle-to-medium-down', 'medium-to-gentle-down',
    'medium-to-steep-up', 'steep-to-medium-up',
    'medium-to-steep-down', 'steep-to-medium-down',
    'turn-left-wide', 'turn-right-wide', 'turn-left-tight', 'turn-right-tight'
  ];

  /* Slight preferences, so the filler favours straight level track. */
  function routeCost(def) {
    if (def.kind === 'turn') return 1.25;
    if (def.gIn !== 0 || def.gOut !== 0) return 1.2;
    return 1;
  }

  /* Both are ceilings on what ONE piece in ROUTE_IDS can do, and the A*
     heuristic divides by them. Understating either makes the heuristic
     overestimate the pieces still needed, which stops it being admissible and
     lets the search settle for a worse route than it could have found.

     Read off the catalogue rather than written down, since the ladder has moved
     twice now and a stale literal fails silently — the route still works, it is
     just needlessly long, which is exactly the sort of thing nobody notices. */
  const MAX_ADVANCE = 5;   // best Manhattan tile gain from one piece (wide turn)
  let maxClimb = 0;
  function MAX_CLIMB() {
    if (!maxClimb) {
      for (const id of ROUTE_IDS) {
        const def = BY_ID.get(id);
        if (def) maxClimb = Math.max(maxClimb, Math.abs(def.dH));
      }
      maxClimb = maxClimb || 1;
    }
    return maxClimb;
  }

  function Heap() { this.a = []; }
  Heap.prototype.push = function (item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  };

  const nodeKey = n => n.i + ',' + n.j + ',' + n.dir + ',' + n.k + ',' + n.g;

  RC.findRouteHome = function (limits) {
    const target = RC.track.start;
    const from = RC.track.head;
    if (!target || !from) return { ok: false, why: 'There is no track to finish' };
    if (sameNode(from, target)) return { ok: false, why: 'The circuit is already complete' };

    const maxExpand = (limits && limits.maxExpand) || 40000;
    const maxPieces = (limits && limits.maxPieces) || 150;
    const occ = occupancy();
    const skipPi = RC.track.pieces.length - 1;
    const defs = ROUTE_IDS.map(id => BY_ID.get(id)).filter(Boolean);

    const heuristic = n => Math.max(
      (Math.abs(n.i - target.i) + Math.abs(n.j - target.j)) / MAX_ADVANCE,
      Math.abs(n.k - target.k) / MAX_CLIMB()
    );

    const open = new Heap();
    const best = new Map();
    const startKey = nodeKey(from);
    best.set(startKey, { g: 0, node: from, parent: null, defId: null });
    // Weighted slightly, trading a possibly longer route for a much faster
    // search. The route only has to be legal and dull, not optimal.
    open.push({ f: heuristic(from) * 1.2, key: startKey });

    let expanded = 0;
    let goal = null;

    while (open.a.length && expanded < maxExpand) {
      const cur = open.pop();
      // Stale heap items resolve to whatever entry is now best for that key,
      // so a single closed flag is enough to skip repeats.
      const entry = best.get(cur.key);
      if (!entry || entry.closed) continue;
      entry.closed = true;
      expanded++;

      const node = entry.node;
      if (sameNode(node, target)) { goal = entry; break; }
      if (entry.g >= maxPieces) continue;

      for (const def of defs) {
        if (def.gIn !== node.g) continue;
        const exit = RC.exitNode(def, node);
        if (exit.k < 0 || exit.k > MAX_H) continue;
        if (!RC.inBounds(exit.i, exit.j)) continue;

        // Bounds and collision from one pass over the cells. A quarter turn's
        // widest bulge is at t = 0.5, so the interior samples catch it.
        let bad = false;
        for (const c of interiorCells(def, node)) {
          if (!RC.inBounds(c.i, c.j)) { bad = true; break; }
          const arr = occ.get(c.i + ',' + c.j);
          if (!arr) continue;
          for (const e of arr) {
            if (e.pi !== skipPi && Math.abs(e.z - c.z) < CLEARANCE) { bad = true; break; }
          }
          if (bad) break;
        }
        if (bad) continue;

        const g = entry.g + routeCost(def);
        const key = nodeKey(exit);
        const prev = best.get(key);
        if (prev && prev.g <= g) continue;
        const next = { g, node: exit, parent: entry, defId: def.id };
        best.set(key, next);
        open.push({ f: g + heuristic(exit) * 1.2, key });
      }
    }

    if (!goal) {
      return {
        ok: false,
        why: expanded >= maxExpand
          ? 'Could not find a way back to the station'
          : 'There is no way back to the station from here'
      };
    }

    const ids = [];
    for (let e = goal; e && e.defId; e = e.parent) ids.unshift(e.defId);
    return { ok: true, ids, expanded };
  };

  /* Find a route and actually build it. Everything is placed through the
     normal RC.place, so the finished track obeys exactly the same rules as
     hand-built track; if any piece is refused the whole lot is rolled back
     rather than leaving a half-finished stub. */
  RC.completeTrack = function (limits) {
    const route = RC.findRouteHome(limits);
    if (!route.ok) return route;

    // One undoable step however many pieces it lays: a student who does not
    // like the filler wants it gone in one press, not thirty.
    return RC.edit(() => {
      const before = RC.track.pieces.length;
      for (const id of route.ids) {
        if (!RC.place(id)) {
          while (RC.track.pieces.length > before) RC.removeLast();
          return { ok: false, why: 'The route it found ran into the track on the way' };
        }
      }
      if (!sameNode(RC.track.head, RC.track.start)) {
        while (RC.track.pieces.length > before) RC.removeLast();
        return { ok: false, why: 'The route it found did not close the circuit' };
      }
      return { ok: true, added: route.ids.length };
    });
  };

  /* ---- setup ----------------------------------------------------------
     Start every park with a short station, so there is always something to
     build from and the first load isn't a blank field. */
  RC.resetTrack = function () {
    // One undoable step, so Clear is recoverable from — it is the single most
    // destructive button on the page. The loaders call it too and then wipe the
    // history behind themselves, since opening another track is not an edit to
    // this one.
    return RC.edit(() => {
      const t = RC.track;
      t.pieces = [];
      RC.demo = null;          // any comparison tracks go with the old layout
      // ...and with them the car count a demo borrowed to run point masses.
      RC.returnDemoCars && RC.returnDemoCars();
      RC.version++;
      // Near the middle of the park, so it's on screen at the default zoom and
      // there's room to build in every direction.
      t.start = { i: 16, j: 19, dir: 0, k: 0, g: FLAT };
      t.head = Object.assign({}, t.start);
      for (let n = 0; n < 3; n++) RC.place('station');
      return t;
    });
  };

  RC.clearToStation = RC.resetTrack;
})();
