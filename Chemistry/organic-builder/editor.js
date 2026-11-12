// Organic Molecule Builder -- 2D drawing canvas.
// Draw tool: click empty space for a new atom; click an atom to grow a bond
// from it (or to change its element, if a different element is selected);
// drag from an atom to make a bond to a new or existing atom; click a bond
// to cycle single -> double -> triple. Erase and Move tools do what they say.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const L = OB.BOND_LENGTH;
  const INK = '#15304d';
  const EL_COLOUR = { C: INK, N: '#1e4fbf', O: '#c62828', F: '#2e7d32', Cl: '#2e7d32', Br: '#8b2a1f', I: '#6b2c91' };
  const DEG = Math.PI / 180;

  OB.Editor = class {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onChange = opts.onChange || (() => {});
      this.onMessage = opts.onMessage || (() => {});
      this.mol = new OB.Molecule();
      this.tool = 'draw';
      this.element = 'C';
      this.view = 'displayed';
      this.highlight = null;   // { atoms:Set, labels:Map, problem:bool }
      this.groupColours = null; // Map atomId -> colour
      this.undoStack = [];
      this.scale = 1;
      this.drag = null;
      this.hover = null;

      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      canvas.addEventListener('pointerup', e => this.up(e));
      canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }

    // ---- view transform: world (0,0) sits at the canvas centre ----
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.fit(false);
      this.draw();
    }
    fit(recentre) {
      if (!this.mol.atoms.length) { this.scale = 1; return; }
      if (recentre) {
        const xs = this.mol.atoms.map(a => a.x), ys = this.mol.atoms.map(a => a.y);
        const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
        this.mol.atoms.forEach(a => { a.x -= mx; a.y -= my; });
      }
      let ext = 1;
      this.mol.atoms.forEach(a => {
        ext = Math.max(ext, (Math.abs(a.x) + 40) / (this.w / 2), (Math.abs(a.y) + 40) / (this.h / 2));
      });
      this.scale = Math.min(1.3, 1 / ext);
    }
    toWorld(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.w / 2) / this.scale, y: (e.clientY - r.top - this.h / 2) / this.scale };
    }
    sx(x) { return this.w / 2 + x * this.scale; }
    sy(y) { return this.h / 2 + y * this.scale; }

    // ---- editing ----
    snapshot() {
      this.undoStack.push(JSON.stringify(this.mol.toJSON()));
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    undo() {
      if (!this.undoStack.length) return;
      this.mol = OB.Molecule.fromJSON(JSON.parse(this.undoStack.pop()));
      this.changed();
    }
    setMolecule(mol) {
      this.snapshot();
      this.mol = mol;
      this.fit(true);
      this.changed();
    }
    clear() { this.setMolecule(new OB.Molecule()); }
    tidy() {
      if (!this.mol.atoms.length) return;
      const m = this.mol.clone();
      OB.layout2D(m, 0, 0);
      this.setMolecule(m);
    }
    changed() { this.onChange(this.mol); this.draw(); }

    hitAtom(p, except) {
      let best = null, bd = 16 / this.scale;
      this.mol.atoms.forEach(a => {
        if (a.id === except) return;
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d < bd) { bd = d; best = a; }
      });
      return best;
    }
    hitBond(p) {
      let best = null, bd = 8 / this.scale;
      this.mol.bonds.forEach(b => {
        const A = this.mol.atom(b.a), B = this.mol.atom(b.b);
        const dx = B.x - A.x, dy = B.y - A.y;
        const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(A.x + t * dx - p.x, A.y + t * dy - p.y);
        if (d < bd) { bd = d; best = b; }
      });
      return best;
    }

    // Free directions around an atom (radians), for new bonds and drawn H.
    freeAngles(atom, k) {
      const angs = this.mol.bondsOf(atom.id).map(b => {
        const o = this.mol.atom(b.a === atom.id ? b.b : b.a);
        return Math.atan2(o.y - atom.y, o.x - atom.x);
      }).sort((a, b) => a - b);
      if (!angs.length) return Array.from({ length: k }, (_, i) => (-30 + i * 360 / k) * DEG);
      const linear = this.mol.bondsOf(atom.id).some(b => b.order === 3) ||
        this.mol.bondsOf(atom.id).filter(b => b.order === 2).length === 2;
      if (angs.length === 1 && k === 1) {
        if (linear) return [angs[0] + Math.PI];
        const cands = [angs[0] + 120 * DEG, angs[0] - 120 * DEG];
        const room = a => {
          const x = atom.x + L * Math.cos(a), y = atom.y + L * Math.sin(a);
          return Math.min(...this.mol.atoms.filter(o => o.id !== atom.id).map(o => Math.hypot(o.x - x, o.y - y)));
        };
        const r0 = room(cands[0]), r1 = room(cands[1]);
        if (Math.abs(r0 - r1) > 1) return [r0 > r1 ? cands[0] : cands[1]];
        // zigzag: turn the opposite way to the previous bond
        return [Math.sin(angs[0]) > 0 ? cands[0] : cands[1]];
      }
      let bestGap = -1, start = 0;
      for (let i = 0; i < angs.length; i++) {
        const a = angs[i], b = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
        if (b - a > bestGap) { bestGap = b - a; start = a; }
      }
      return Array.from({ length: k }, (_, i) => start + bestGap * (i + 1) / (k + 1));
    }

    explain(atom, need) {
      const name = { C: 'Carbon', N: 'Nitrogen', O: 'Oxygen', F: 'Fluorine', Cl: 'Chlorine', Br: 'Bromine', I: 'Iodine' }[atom.el];
      const v = OB.VALENCE[atom.el];
      this.onMessage(name + ' forms ' + v + ' bond' + (v > 1 ? 's' : '') + ', and this one has no room for ' +
        (need > 1 ? 'a bond of order ' + need : 'another bond') + '.');
    }

    sprout(atom) {
      if (this.mol.freeValence(atom.id) < 1) return this.explain(atom, 1);
      const a = this.freeAngles(atom, 1)[0];
      this.snapshot();
      const n = this.mol.addAtom(this.element, atom.x + L * Math.cos(a), atom.y + L * Math.sin(a));
      this.mol.addBond(atom.id, n.id, 1);
      this.changed();
    }

    cycleBond(b) {
      for (let step = 1; step <= 2; step++) {
        const next = (b.order + step - 1) % 3 + 1;
        if (this.mol.canSetOrder(b, next)) {
          this.snapshot();
          b.order = next;
          this.changed();
          return;
        }
      }
      this.onMessage('Neither atom has room for a stronger bond here.');
    }

    down(e) {
      const p = this.toWorld(e);
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { start: p, atom: this.hitAtom(p), bond: null, moved: false, cur: p };
      if (!this.drag.atom) this.drag.bond = this.hitBond(p);
      if (this.tool === 'move') this.snapshot();
    }

    move(e) {
      const p = this.toWorld(e);
      if (!this.drag) {
        const a = this.hitAtom(p);
        const b = a ? null : this.hitBond(p);
        const hv = a ? { atom: a.id } : b ? { bond: b } : null;
        const same = (hv === null && this.hover === null) ||
          (hv && this.hover && hv.atom === this.hover.atom && hv.bond === this.hover.bond);
        if (!same) { this.hover = hv; this.draw(); }
        return;
      }
      const d = this.drag;
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.scale > 6) d.moved = true;
      if (this.tool === 'move' && d.moved) {
        const dx = p.x - d.cur.x, dy = p.y - d.cur.y;
        (d.atom ? [d.atom] : this.mol.atoms).forEach(a => { a.x += dx; a.y += dy; });
        this.draw();
      }
      d.cur = p;
      if (this.tool === 'draw') this.draw();
    }

    // Where a bond dragged from `from` towards p would end.
    snapTarget(from, p) {
      const hit = this.hitAtom(p, from.id);
      if (hit) return { atom: hit, x: hit.x, y: hit.y };
      const ang = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (30 * DEG)) * 30 * DEG;
      return { atom: null, x: from.x + L * Math.cos(ang), y: from.y + L * Math.sin(ang) };
    }

    up(e) {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const p = this.toWorld(e);
      if (this.tool === 'move') { if (d.moved) this.changed(); return; }
      if (this.tool === 'erase') {
        if (d.atom) { this.snapshot(); this.mol.removeAtom(d.atom.id); this.changed(); }
        else if (d.bond) { this.snapshot(); this.mol.removeBond(d.bond); this.changed(); }
        return;
      }
      // draw tool
      if (d.atom && d.moved) {
        const t = this.snapTarget(d.atom, p);
        if (t.atom) {
          const existing = this.mol.bondBetween(d.atom.id, t.atom.id);
          if (existing) return this.cycleBond(existing);
          if (this.mol.freeValence(d.atom.id) < 1) return this.explain(d.atom, 1);
          if (this.mol.freeValence(t.atom.id) < 1) return this.explain(t.atom, 1);
          this.snapshot();
          this.mol.addBond(d.atom.id, t.atom.id, 1);
          this.changed();
        } else {
          if (this.mol.freeValence(d.atom.id) < 1) { this.draw(); return this.explain(d.atom, 1); }
          this.snapshot();
          const n = this.mol.addAtom(this.element, t.x, t.y);
          this.mol.addBond(d.atom.id, n.id, 1);
          this.changed();
        }
      } else if (d.atom) {
        if (d.atom.el !== this.element) {
          if (!this.mol.canSetElement(d.atom.id, this.element)) {
            this.onMessage('That atom has ' + this.mol.usedValence(d.atom.id) + ' bonds, more than ' +
              this.element + ' can form. Remove some bonds first.');
            return;
          }
          this.snapshot();
          d.atom.el = this.element;
          this.changed();
        } else {
          this.sprout(d.atom);
        }
      } else if (d.bond && !d.moved) {
        this.cycleBond(d.bond);
      } else if (!d.bond) {
        this.snapshot();
        const a = this.mol.addAtom(this.element, d.start.x, d.start.y);
        if (d.moved) {
          const t = this.snapTarget(a, p);
          if (t.atom) {
            if (this.mol.freeValence(t.atom.id) >= 1) this.mol.addBond(a.id, t.atom.id, 1);
          } else {
            const n = this.mol.addAtom(this.element, t.x, t.y);
            this.mol.addBond(a.id, n.id, 1);
          }
        }
        this.changed();
      }
    }

    // ---- drawing ----
    labelFor(atom) {
      const h = this.mol.hCount(atom.id);
      const deg = this.mol.bondsOf(atom.id).length;
      if (this.view === 'displayed') return { el: atom.el, h: 0 };
      if (atom.el === 'C' && this.view === 'skeletal' && deg > 0) return null;
      return { el: atom.el, h };
    }

    draw() {
      const c = this.ctx;
      c.clearRect(0, 0, this.w, this.h);
      const mol = this.mol;
      const S = this.scale;
      const pos = a => ({ x: this.sx(a.x), y: this.sy(a.y) });
      const labels = new Map(mol.atoms.map(a => [a.id, this.labelFor(a)]));
      const hl = this.highlight;

      // highlight layer
      if (this.groupColours) {
        this.groupColours.forEach((col, id) => {
          const a = mol.atom(id); if (!a) return;
          const p = pos(a);
          c.fillStyle = col;
          c.beginPath(); c.arc(p.x, p.y, 15 * S, 0, 2 * Math.PI); c.fill();
        });
      }
      if (hl && hl.atoms.size) {
        const col = hl.problem ? 'rgba(220, 60, 40, 0.28)' : 'rgba(13, 148, 136, 0.25)';
        c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round';
        c.lineWidth = 18 * S;
        mol.bonds.forEach(b => {
          if (!hl.atoms.has(b.a) || !hl.atoms.has(b.b)) return;
          const p = pos(mol.atom(b.a)), q = pos(mol.atom(b.b));
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
        });
        hl.atoms.forEach(id => {
          const a = mol.atom(id); if (!a) return;
          const p = pos(a);
          c.beginPath(); c.arc(p.x, p.y, 11 * S, 0, 2 * Math.PI); c.fill();
        });
      }

      // bonds
      c.lineCap = 'round';
      mol.bonds.forEach(b => {
        const A = mol.atom(b.a), B = mol.atom(b.b);
        const p = pos(A), q = pos(B);
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const gapA = labels.get(A.id) ? 11 * S : 0, gapB = labels.get(B.id) ? 11 * S : 0;
        const p2 = { x: p.x + ux * gapA, y: p.y + uy * gapA }, q2 = { x: q.x - ux * gapB, y: q.y - uy * gapB };
        const nx = -uy, ny = ux;
        const offs = b.order === 1 ? [0] : b.order === 2 ? [-3.2, 3.2] : [-5, 0, 5];
        const hot = this.hover && this.hover.bond === b;
        c.strokeStyle = hot ? '#0d9488' : INK;
        c.lineWidth = (hot ? 2.6 : 1.8) * Math.max(0.8, S);
        offs.forEach(o => {
          c.beginPath();
          c.moveTo(p2.x + nx * o * S, p2.y + ny * o * S);
          c.lineTo(q2.x + nx * o * S, q2.y + ny * o * S);
          c.stroke();
        });
      });

      // explicit hydrogens in displayed-formula view
      if (this.view === 'displayed') {
        c.font = 'bold ' + Math.round(14 * S) + 'px "Trebuchet MS", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        mol.atoms.forEach(a => {
          const k = mol.hCount(a.id);
          if (!k) return;
          const p = pos(a);
          this.freeAngles(a, k).forEach(ang => {
            const ex = p.x + 0.72 * L * S * Math.cos(ang), ey = p.y + 0.72 * L * S * Math.sin(ang);
            c.strokeStyle = 'rgba(21,48,77,0.75)'; c.lineWidth = 1.4 * Math.max(0.8, S);
            c.beginPath();
            c.moveTo(p.x + 11 * S * Math.cos(ang), p.y + 11 * S * Math.sin(ang));
            c.lineTo(ex - 7 * S * Math.cos(ang), ey - 7 * S * Math.sin(ang));
            c.stroke();
            c.fillStyle = '#5a738f';
            c.fillText('H', ex, ey);
          });
        });
      }

      // atom labels
      mol.atoms.forEach(a => {
        const lab = labels.get(a.id);
        const p = pos(a);
        const hot = this.hover && this.hover.atom === a.id;
        if (hot) {
          c.strokeStyle = '#0d9488'; c.lineWidth = 2;
          c.beginPath(); c.arc(p.x, p.y, 13 * S, 0, 2 * Math.PI); c.stroke();
        }
        if (!lab) return;
        this.drawLabel(a, lab, p);
      });

      // locant labels
      if (hl && hl.labels && hl.labels.size) {
        c.font = 'bold ' + Math.round(11 * Math.max(0.85, S)) + 'px "Trebuchet MS", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        hl.labels.forEach((text, id) => {
          const a = mol.atom(id); if (!a) return;
          const ang = this.freeAngles(a, 1)[0];
          const p = pos(a);
          const x = p.x + 22 * Math.max(0.85, S) * Math.cos(ang), y = p.y + 22 * Math.max(0.85, S) * Math.sin(ang);
          c.fillStyle = '#0f766e';
          c.beginPath(); c.arc(x, y, 8.5 * Math.max(0.85, S), 0, 2 * Math.PI); c.fill();
          c.fillStyle = 'white';
          c.fillText(text, x, y + 0.5);
        });
      }

      // drag preview
      const d = this.drag;
      if (d && this.tool === 'draw' && d.moved) {
        const from = d.atom || d.start;
        const t = this.snapTarget(from.id ? from : { ...from, id: -1 }, d.cur);
        c.strokeStyle = 'rgba(13,148,136,0.8)'; c.lineWidth = 2; c.setLineDash([5, 4]);
        c.beginPath(); c.moveTo(this.sx(from.x), this.sy(from.y)); c.lineTo(this.sx(t.x), this.sy(t.y)); c.stroke();
        c.setLineDash([]);
      }

      if (!mol.atoms.length) {
        c.fillStyle = '#5a738f';
        c.font = '16px "Trebuchet MS", sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('Click to place a carbon, then click it again to grow a chain.', this.w / 2, this.h / 2);
      }
    }

    drawLabel(a, lab, p) {
      const c = this.ctx, S = Math.max(0.8, this.scale);
      const big = Math.round(17 * S), small = Math.round(12 * S);
      // Put the H on the side away from the bonds.
      let dx = 0;
      this.mol.bondsOf(a.id).forEach(b => {
        const o = this.mol.atom(b.a === a.id ? b.b : b.a);
        dx += o.x - a.x;
      });
      const hLeft = dx > 1;
      c.textBaseline = 'middle';
      c.font = 'bold ' + big + 'px "Trebuchet MS", sans-serif';
      const elW = c.measureText(lab.el).width;
      c.fillStyle = 'rgba(247, 251, 255, 0.92)';
      c.beginPath(); c.arc(p.x, p.y, 10.5 * S, 0, 2 * Math.PI); c.fill();
      c.fillStyle = EL_COLOUR[lab.el] || INK;
      c.textAlign = 'center';
      c.fillText(lab.el, p.x, p.y);
      if (!lab.h) return;
      const hText = 'H';
      const hW = c.measureText(hText).width;
      c.font = 'bold ' + small + 'px "Trebuchet MS", sans-serif';
      const nText = lab.h > 1 ? String(lab.h) : '';
      const nW = nText ? c.measureText(nText).width : 0;
      c.font = 'bold ' + big + 'px "Trebuchet MS", sans-serif';
      c.textAlign = 'left';
      let x = hLeft ? p.x - elW / 2 - hW - nW - 1 : p.x + elW / 2 + 1;
      c.fillText(hText, x, p.y);
      if (nText) {
        c.font = 'bold ' + small + 'px "Trebuchet MS", sans-serif';
        c.fillText(nText, x + hW, p.y + 5 * S);
      }
    }
  };
})();
