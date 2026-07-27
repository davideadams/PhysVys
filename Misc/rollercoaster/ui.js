/* Floating window chrome: toggle from the top bar, drag by the header.
   Windows are registered by id so later phases can just drop markup in. */
(function () {
  const RC = window.RC || (window.RC = {});

  const MARGIN = 8;

  function clampIntoView(win) {
    const r = win.getBoundingClientRect();
    const maxLeft = window.innerWidth - r.width - MARGIN;
    const maxTop = window.innerHeight - r.height - MARGIN;
    const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, maxLeft));
    const top = Math.min(Math.max(MARGIN, r.top), Math.max(MARGIN, maxTop));
    win.style.left = left + 'px';
    win.style.top = top + 'px';
    // Windows may be positioned from the right in markup; once we start
    // driving `left` those must be released or the box is over-constrained.
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }

  /* Windows stack in click order, so the last one touched sits on top. */
  let topZ = 30;
  function raise(win) { win.style.zIndex = ++topZ; }

  function makeDraggable(win) {
    const hd = win.querySelector('.window-hd');
    if (!hd) return;
    let dragging = false, offX = 0, offY = 0;

    hd.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.window-x')) return;
      const r = win.getBoundingClientRect();
      dragging = true;
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      win.classList.add('dragging');
      raise(win);
      hd.setPointerCapture(e.pointerId);
    });

    hd.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      win.style.left = (e.clientX - offX) + 'px';
      win.style.top = (e.clientY - offY) + 'px';
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      win.classList.remove('dragging');
      clampIntoView(win);
      if (e && hd.hasPointerCapture(e.pointerId)) hd.releasePointerCapture(e.pointerId);
    }
    hd.addEventListener('pointerup', end);
    hd.addEventListener('pointercancel', end);
  }

  /* ---- resizing ---------------------------------------------------------
     Windows-style: grab any edge or corner, not just the bottom-right. CSS
     `resize` can only ever give the one corner, so the handles are real
     elements and the geometry is driven here.

     Dragging the left or top edge has to MOVE the window as well as resize
     it, which is why a resize begins by freezing the box into explicit
     left/top/width/height — markup that pins a window by `right` cannot have
     its left edge pulled. */
  const MIN_W = 240, MIN_H = 150;            // must match the CSS minimums
  const MAX_W_FRAC = 0.96, MAX_H_FRAC = 0.92; // and these the CSS maximums
  const DIRS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

  function makeResizable(win) {
    for (const dir of DIRS) {
      const grip = document.createElement('div');
      grip.className = 'window-rz window-rz-' + dir;
      win.appendChild(grip);

      let active = false, from = null;

      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();          // not a header drag, and not a raise
        const r = win.getBoundingClientRect();
        win.style.left = r.left + 'px';
        win.style.top = r.top + 'px';
        win.style.right = 'auto';
        win.style.bottom = 'auto';
        win.style.width = r.width + 'px';
        win.style.height = r.height + 'px';
        from = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
        active = true;
        win.classList.add('resizing');
        raise(win);
        grip.setPointerCapture(e.pointerId);
      });

      grip.addEventListener('pointermove', (e) => {
        if (!active) return;
        const dx = e.clientX - from.x, dy = e.clientY - from.y;

        let w = from.w, h = from.h;
        if (dir.indexOf('e') >= 0) w = from.w + dx;
        if (dir.indexOf('w') >= 0) w = from.w - dx;
        if (dir.indexOf('s') >= 0) h = from.h + dy;
        if (dir.indexOf('n') >= 0) h = from.h - dy;

        // Size is settled first — including the same ceiling the stylesheet
        // applies, so dragging past it doesn't build up slack the drag back
        // has to undo before the window moves again.
        w = Math.max(MIN_W, Math.min(window.innerWidth * MAX_W_FRAC, w));
        h = Math.max(MIN_H, Math.min(window.innerHeight * MAX_H_FRAC, h));

        // Then the edge being dragged follows from the one that isn't moving,
        // which is what stops the window walking sideways at the minimum.
        let left = from.left, top = from.top;
        if (dir.indexOf('w') >= 0) left = from.left + from.w - w;   // right edge pinned
        if (dir.indexOf('n') >= 0) top = from.top + from.h - h;     // bottom edge pinned

        // Neither of those edges may be dragged off the screen.
        if (left < MARGIN) { w -= MARGIN - left; left = MARGIN; }
        if (top < MARGIN) { h -= MARGIN - top; top = MARGIN; }

        win.style.left = left + 'px';
        win.style.top = top + 'px';
        win.style.width = w + 'px';
        win.style.height = h + 'px';
      });

      const end = (e) => {
        if (!active) return;
        active = false;
        win.classList.remove('resizing');
        clampIntoView(win);
        if (RC.onWindowResized) RC.onWindowResized(win);
        if (e && grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
      };
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    }
  }

  const toggles = new Map();  // window id -> [buttons]

  function syncButtons(id, open) {
    const btns = toggles.get(id);
    if (btns) btns.forEach(b => b.classList.toggle('active', open));
  }

  RC.setWindow = function (id, open) {
    const win = document.getElementById(id);
    if (!win) return;
    win.hidden = !open;
    if (open) { raise(win); clampIntoView(win); }
    syncButtons(id, open);
  };

  RC.toggleWindow = function (id) {
    const win = document.getElementById(id);
    if (win) RC.setWindow(id, win.hidden);
  };

  RC.initWindows = function () {
    document.querySelectorAll('.window').forEach((win) => {
      makeDraggable(win);
      makeResizable(win);
      win.addEventListener('pointerdown', () => raise(win));
      const x = win.querySelector('.window-x');
      if (x) x.addEventListener('click', () => RC.setWindow(win.id, false));
    });

    document.querySelectorAll('[data-window]').forEach((btn) => {
      const id = btn.dataset.window;
      if (!toggles.has(id)) toggles.set(id, []);
      toggles.get(id).push(btn);
      btn.addEventListener('click', () => RC.toggleWindow(id));
      const win = document.getElementById(id);
      if (win) btn.classList.toggle('active', !win.hidden);
    });

    // Convert any window that starts visible (the build window) from right- to
    // left-anchoring now, so its left edge can be dragged rather than fighting
    // a pinned right edge.
    document.querySelectorAll('.window').forEach((win) => {
      if (!win.hidden) clampIntoView(win);
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll('.window').forEach((win) => {
        if (!win.hidden) clampIntoView(win);
      });
    });

    // Keep a window that's been resized larger from spilling off-screen, and
    // let the canvas-based windows re-fit their drawings to the new size.
    if (window.ResizeObserver) {
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          if (e.target.hidden) continue;
          // Mid-gesture the resize code owns the geometry: clamping here would
          // fight a left- or top-edge drag, which legitimately moves the box.
          if (!e.target.classList.contains('resizing')) clampIntoView(e.target);
          if (RC.onWindowResized) RC.onWindowResized(e.target);
        }
      });
      document.querySelectorAll('.window').forEach((win) => ro.observe(win));
    }

    // Escape closes the topmost open window.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.window')].filter(w => !w.hidden);
      if (!open.length) return;
      open.sort((a, b) => (+a.style.zIndex || 30) - (+b.style.zIndex || 30));
      RC.setWindow(open[open.length - 1].id, false);
    });
  };
})();
