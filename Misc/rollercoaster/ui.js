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

    window.addEventListener('resize', () => {
      document.querySelectorAll('.window').forEach((win) => {
        if (!win.hidden) clampIntoView(win);
      });
    });

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
