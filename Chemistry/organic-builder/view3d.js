// Organic Molecule Builder -- three.js ball-and-stick / space-filling view.
(function () {
  'use strict';
  const OB = window.OB = window.OB || {};

  const COLOUR = { H: 0xf4f6f8, C: 0x3a3f47, N: 0x2f5fd0, O: 0xd8322d, F: 0x7cc242, Cl: 0x2f9e44, Br: 0x8b2a1f, I: 0x6b2c91 };
  const BALL = { H: 0.22, C: 0.36, N: 0.34, O: 0.34, F: 0.32, Cl: 0.42, Br: 0.46, I: 0.52 };
  const VDW = { H: 1.10, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Cl: 1.75, Br: 1.85, I: 1.98 };

  OB.View3D = class {
    constructor(root) {
      this.root = root;
      this.mode = 'ball';
      this.data = null;
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
      this.camera.position.set(0, 0, 16);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      root.appendChild(this.renderer.domElement);
      this.scene.add(new THREE.HemisphereLight(0xf8fbff, 0x8aa0bb, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(5, 8, 10);
      this.scene.add(sun);
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.autoSpin = true;
      this.dragging = null;

      const el = this.renderer.domElement;
      el.addEventListener('pointerdown', e => {
        this.dragging = { x: e.clientX, y: e.clientY };
        this.autoSpin = false;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!this.dragging) return;
        const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
        this.dragging = { x: e.clientX, y: e.clientY };
        const q = new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(dy * 0.01, dx * 0.01, 0, 'XYZ'));
        this.group.quaternion.premultiply(q);
        this.render();
      });
      el.addEventListener('pointerup', () => { this.dragging = null; });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        this.camera.position.z = Math.min(80, Math.max(4, this.camera.position.z * (1 + Math.sign(e.deltaY) * 0.1)));
        this.render();
      }, { passive: false });
      new ResizeObserver(() => this.resize()).observe(root);
      this.resize();
      const tick = () => {
        if (this.autoSpin && this.data && this.isVisible()) {
          this.group.rotation.y += 0.004;
          this.render();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    isVisible() { return this.root.offsetParent !== null; }

    resize() {
      const w = this.root.clientWidth || 1, h = this.root.clientHeight || 1;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.render();
    }

    setMode(mode) { this.mode = mode; this.rebuild(); }

    show(g) {
      this.data = g.n ? OB.build3D(g) : null;
      this.autoSpin = true;
      this.group.quaternion.identity();
      this.rebuild();
    }

    rebuild() {
      while (this.group.children.length) {
        const c = this.group.children.pop();
        if (c.geometry) c.geometry.dispose();
      }
      if (!this.data) { this.render(); return; }
      const { atoms, bonds } = this.data;
      const v = a => new THREE.Vector3(a.x, a.y, a.z);
      const spaceFill = this.mode === 'space';
      atoms.forEach(a => {
        const r = spaceFill ? VDW[a.el] * 0.85 : BALL[a.el];
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18),
          new THREE.MeshStandardMaterial({ color: COLOUR[a.el], roughness: 0.45, metalness: 0.05 }));
        mesh.position.copy(v(a));
        this.group.add(mesh);
      });
      if (!spaceFill) {
        const mat = new THREE.MeshStandardMaterial({ color: 0x9aa5b4, roughness: 0.5 });
        bonds.forEach(b => {
          const A = v(atoms[b.a]), B = v(atoms[b.b]);
          const axis = B.clone().sub(A);
          const perp = this.perpendicular(b, axis);
          const offsets = b.order === 1 ? [0] : b.order === 2 ? [-0.09, 0.09] : [-0.14, 0, 0.14];
          const r = b.order === 1 ? 0.08 : 0.055;
          offsets.forEach(o => {
            const p = A.clone().add(perp.clone().multiplyScalar(o));
            const q = B.clone().add(perp.clone().multiplyScalar(o));
            this.group.add(this.cylinder(p, q, r, mat));
          });
        });
      }
      let maxR = 1;
      atoms.forEach(a => { maxR = Math.max(maxR, Math.hypot(a.x, a.y, a.z)); });
      this.camera.position.z = Math.max(8, maxR * 3.6 + 2);
      this.render();
    }

    // Offset direction for double/triple bonds: in the plane of a neighbour.
    perpendicular(b, axis) {
      const { atoms, adj } = this.data;
      const nb = adj[b.a].find(e => e.to !== b.b) || adj[b.b].find(e => e.to !== b.a);
      let ref = nb ? new THREE.Vector3(atoms[nb.to].x - atoms[b.a].x, atoms[nb.to].y - atoms[b.a].y,
        atoms[nb.to].z - atoms[b.a].z) : new THREE.Vector3(0, 0, 1);
      let n = new THREE.Vector3().crossVectors(axis, ref);
      if (n.lengthSq() < 1e-6) n = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0));
      if (n.lengthSq() < 1e-6) n = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
      return new THREE.Vector3().crossVectors(n, axis).normalize();
    }

    cylinder(p, q, r, mat) {
      const dir = q.clone().sub(p);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat);
      mesh.position.copy(p).add(q).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return mesh;
    }

    render() { this.renderer.render(this.scene, this.camera); }
  };
})();
