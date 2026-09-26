// FALSE LIGHT — items in the world: one template per kind (the Blender / Poly Haven models), world copies for
// everything set down, the thing in your hand drawn at the bottom-right of the view, the see-through "ghost" that shows
// where G will put it, the surface finder (floors, tables, shelves, the ground), and inventory icons rendered from the
// real models.
import * as THREE from 'three';
import { KINDS } from './items.js?v=f7378e71';
import { createSurfaces } from './surfaces.js?v=f7378e71';

export function createItemsView(engine) {
  const { scene, camera } = engine;
  const W = () => engine.world;
  const T = {};            // kind -> { obj (bottom-centred group), size }
  const icons = {};
  const meshes = new Map(); // item id -> Object3D
  const ray = new THREE.Raycaster();
  const V = {
    templates: T, icons, meshes,
    async load() {
      const anchors = new Map(W().anchors), nCol = W().colliders.length;   // templates must not add anchors / colliders to the world
      for (const [kind, k] of Object.entries(KINDS)) {
        const root = await W().addModel(k.model, new THREE.Vector3(0, -500, 0), 0, 1);
        if (!root) continue;
        scene.remove(root); root.position.set(0, 0, 0); root.scale.setScalar(k.scale || 1); root.updateMatrixWorld(true);
        root.traverse((o) => { if (/^COL_/.test(o.name)) o.visible = false; });
        if (kind === 'backpack') root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(0.55, 0.62, 0.45)); } });   // Forest Service olive: not the hiker's pack
        const box = new THREE.Box3(); root.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const g = new THREE.Group(); root.position.set(-c.x, -box.min.y, -c.z); g.add(root); g.name = 'item_tpl:' + kind;
        T[kind] = { obj: g, size };
      }
      W().anchors.clear(); for (const [a, b] of anchors) W().anchors.set(a, b); W().colliders.length = nCol;
      if (!engine.noRender) try { renderIcons(); } catch (e) { console.warn('item icons', e); }
    },
    spawn(item) {
      const t = T[item.kind]; if (!t) return null;
      const o = t.obj.clone(true); o.name = 'item:' + item.id;
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      scene.add(o); meshes.set(item.id, o); return o;
    },
    /** Make the world copies match the inventory. Returns { added: [items], removed: [ids] }. */
    sync(inv) {
      const want = new Map(inv.world.map((i) => [i.id, i]));
      const added = [], removed = [];
      for (const [id, o] of meshes) if (!want.has(id)) { scene.remove(o); meshes.delete(id); removed.push(id); }
      for (const it of want.values()) {
        let o = meshes.get(it.id);
        if (!o) { o = V.spawn(it); if (!o) continue; added.push(it); }
        o.position.set(it.pos[0], it.pos[1], it.pos[2]); o.rotation.set(0, it.rotY || 0, 0);
      }
      return { added, removed };
    },
    /** Where a picked-up prompt should sit (top of the thing). */
    topOf(item) { const t = T[item.kind]; const h = t ? t.size.y : 0.3; return new THREE.Vector3(item.pos[0], item.pos[1] + Math.min(0.9, h * 0.7), item.pos[2]); },
    clearAll() { for (const o of meshes.values()) scene.remove(o); meshes.clear(); },
  };

  // ---------------------------------------------------------------- the thing in your hand
  let vm = null, vmKind = null;
  V.setTorchGlow = () => {};   // (the beam shows it's on; a lens glow read as a halo from behind)
  const HOLD = { fuel: [0.17, -0.17, -0.3], flashlight: [0.125, -0.12, -0.25], camera: [0.12, -0.12, -0.25], binoculars: [0.1, -0.13, -0.25],
    canteen: [0.12, -0.13, -0.24], food: [0.11, -0.11, -0.23] };
  V.hold = (kind, t = 0, moving = 0) => {
    if (kind !== vmKind || (!vm && kind && T[kind] && HOLD[kind])) {
      if (vm) { camera.remove(vm); vm = null; }
      vmKind = kind;
      if (kind && T[kind] && HOLD[kind]) {
        vm = T[kind].obj.clone(true);
        vm.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
        vm.scale.setScalar(0.42);           // small and close = normal size at arm's length, and never pokes through walls
        vm.rotation.set(0.12, kind === 'fuel' ? 1.9 : kind === 'flashlight' ? Math.PI + 0.14 : 2.6, 0.05);   // the torch's lens is at the model's +Z end
        camera.add(vm);
      }
    }
    if (vm) { const p = HOLD[vmKind]; vm.position.set(p[0] + Math.sin(t * 5.2) * 0.004 * moving, p[1] + Math.abs(Math.cos(t * 5.2)) * 0.005 * moving, p[2]); }
  };

  // ---------------------------------------------------------------- placing: ghost + surface finder
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xcfe8c4, transparent: true, opacity: 0.38, depthWrite: false });
  let ghost = null, ghostKind = null;
  V.ghost = (kind, pos, rotY, ok) => {
    if (kind !== ghostKind || (!ghost && kind && T[kind])) {
      if (ghost) scene.remove(ghost); ghost = null; ghostKind = kind;
      if (kind && T[kind]) { ghost = T[kind].obj.clone(true); ghost.traverse((m) => { if (m.isMesh) { m.material = ghostMat; m.castShadow = m.receiveShadow = false; } }); scene.add(ghost); }
    }
    if (!ghost) return;
    ghost.visible = !!pos;
    if (pos) { ghost.position.copy(pos); ghost.rotation.set(0, rotY, 0); ghostMat.color.set(ok ? 0xcfe8c4 : 0xe8a49a); }
  };
  // the static world's real triangles (built once the models are in), the terrain, and things already set down
  const grid = createSurfaces();
  V.surfaces = grid;
  V.buildSurfaces = () => { grid.build(W().modelRoots || []); return grid; };
  const itemMeshes = [];
  function itemHit(o, d, far) {
    itemMeshes.length = 0;
    for (const m of meshes.values()) if (m.position.distanceToSquared(o) < (far + 1.5) ** 2) m.traverse((x) => { if (x.isMesh && x.visible) itemMeshes.push(x); });
    if (!itemMeshes.length) return null;
    ray.set(o, d); ray.far = far; ray.near = 0;
    const h = ray.intersectObjects(itemMeshes, false)[0]; if (!h || !h.face) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.dot(d) > 0) n.negate();
    return { point: h.point.clone(), distance: h.distance, normal: n, up: n.y > 0.6 };
  }
  function colliderHit(o, d, far) {   // only until the grid exists (no art loaded): the old box colliders
    const list = []; for (const c of W().colliders) if (c.enabled && c.mesh) list.push(c.mesh);
    ray.set(o, d); ray.far = far; ray.near = 0;
    const h = ray.intersectObjects(list, false)[0]; if (!h || !h.face) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.dot(d) > 0) n.negate();
    return { point: h.point.clone(), distance: h.distance, normal: n, up: n.y > 0.6 && !/^COL_wall/.test(h.object.name) };
  }
  const tmp = new THREE.Vector3();
  function terrainHit(o, d, far) {
    const h = W().heightAt; let prev = 0;
    for (let s = 0.05; s <= far; s += 0.05) {
      tmp.copy(o).addScaledVector(d, s);
      if (tmp.y <= h(tmp.x, tmp.z)) { let a = prev, b = s; for (let i = 0; i < 8; i++) { const m = (a + b) / 2; tmp.copy(o).addScaledVector(d, m); if (tmp.y <= h(tmp.x, tmp.z)) b = m; else a = m; } tmp.copy(o).addScaledVector(d, b); tmp.y = h(tmp.x, tmp.z); const n = terrainNormal(tmp.x, tmp.z); return { point: tmp.clone(), distance: b, normal: n, up: n.y > 0.6 }; }
      prev = s;
    }
    return null;
  }
  function terrainNormal(x, z) { const h = W().heightAt, e = 0.3; return new THREE.Vector3(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize(); }
  /** Nearest thing along a ray: the static geometry, items, the ground. */
  function cast(o, d, far) {
    let best = grid.triangles ? grid.cast(o, d, far) : colliderHit(o, d, far);
    const ih = itemHit(o, d, best ? best.distance : far); if (ih && (!best || ih.distance < best.distance)) best = ih;
    const th = terrainHit(o, d, best ? best.distance : far); if (th && (!best || th.distance < best.distance)) best = th;
    return best;
  }
  const DOWN = new THREE.Vector3(0, -1, 0);
  // pegs: IA_hook_<name>_<px|nx|pz|nz> anchors (the outward direction in three axes)
  const HANG = { backpack: 0.93, canteen: 0.9, binoculars: 0.85, camera: 0.85, flashlight: 0.95 };
  let hooks = null;
  function hookList() {
    if (hooks) return hooks;
    hooks = [];
    for (const [n, p] of W().anchors) {
      const m = /^IA_hook_(.+)_(px|nx|pz|nz)$/.exec(n); if (!m) continue;
      const dir = { px: [1, 0, 0], nx: [-1, 0, 0], pz: [0, 0, 1], nz: [0, 0, -1] }[m[2]];
      hooks.push({ name: n, pos: p.clone(), dir: new THREE.Vector3(...dir) });
    }
    return hooks;
  }
  V.hooks = hookList;
  /** Where G would put `kind`: a free peg you're pointing at, else the first flat surface you're looking at, else straight
   * down from where your look ends, else the floor at your feet. → { pos, ok, hook?, rotY? } */
  V.findSpot = (reach = 3.5, kind = null, taken = new Set(), feet = null) => {
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    const hit = cast(o, d, reach);
    if (kind && HANG[kind] && T[kind]) {
      let best = null, bp = 0.24;
      for (const h of hookList()) {
        if (taken.has(h.name)) continue;
        const to = h.pos.clone().sub(o), t = to.dot(d); if (t < 0.25 || t > reach + 0.4) continue;
        const perp = to.clone().addScaledVector(d, -t).length(); if (perp >= bp) continue;
        const dist = to.length(), los = grid.triangles ? grid.cast(o, to.clone().normalize(), dist - 0.06) : null;
        if (los) continue;   // a wall between you and that peg
        best = h; bp = perp;
      }
      if (best) {
        const sz = T[kind].size, rotY = Math.atan2(best.dir.x, best.dir.z);
        const pos = best.pos.clone().addScaledVector(best.dir, sz.z / 2 - 0.02); pos.y -= sz.y * HANG[kind];
        return { pos, ok: true, hook: best.name, rotY };
      }
    }
    if (hit && hit.up) return { pos: hit.point, ok: true };
    // a wall, a rail, a pane, or the air: drop straight down from just short of it
    const end = hit ? hit.point.clone().addScaledVector(d, -0.12) : o.clone().addScaledVector(d, reach);
    const down = cast(end, DOWN, 3.5);
    if (down && down.up) return { pos: down.point, ok: true };
    if (feet) {   // at your feet, a step ahead
      const f = new THREE.Vector3(feet.x + Math.sin(feet.yaw) * -0.55, o.y, feet.z + Math.cos(feet.yaw) * -0.55);
      const dn = cast(f, DOWN, 3.5); if (dn && dn.up) return { pos: dn.point, ok: true };
    }
    return { pos: hit ? hit.point : end, ok: false };
  };
  /** Settle a point onto whatever is under it (for spawning things on shelves / the ground). */
  V.settle = (p) => { const d = cast(new THREE.Vector3(p[0], p[1] + 0.6, p[2]), DOWN, 3); return d && d.up ? [p[0], d.point.y, p[2]] : [p[0], W().heightAt(p[0], p[2]), p[2]]; };

  // ---------------------------------------------------------------- icons rendered from the real models
  function renderIcons() {
    const R = engine.renderer, S = 96;
    const rt = new THREE.WebGLRenderTarget(S, S);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xfff2dc, 0x3a342c, 2.4));
    const dl = new THREE.DirectionalLight(0xffffff, 3.2); dl.position.set(1.2, 2, 1.6); sc.add(dl);
    if (scene.environment) sc.environment = scene.environment;
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
    const px = new Uint8Array(S * S * 4), cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), img = g.createImageData(S, S);
    const prevT = R.getRenderTarget(), prevC = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
    for (const [kind, t] of Object.entries(T)) {
      const o = t.obj.clone(true); sc.add(o);
      const r = Math.max(t.size.x, t.size.y, t.size.z) * 0.62, dist = r / Math.tan(THREE.MathUtils.degToRad(14));
      const c = new THREE.Vector3(0, t.size.y / 2, 0);
      cam.position.set(c.x + dist * 0.55, c.y + dist * 0.42, c.z + dist * 0.72); cam.lookAt(c);
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam);
      R.readRenderTargetPixels(rt, 0, 0, S, S, px);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const si = ((S - 1 - y) * S + x) * 4, di = (y * S + x) * 4;
        for (let k = 0; k < 3; k++) { const v = px[si + k] / 255, tm = v / (1 + v * 0.6); img.data[di + k] = Math.round(Math.pow(tm * 1.25, 1 / 2.2) * 255); }
        img.data[di + 3] = px[si + 3];
      }
      g.putImageData(img, 0, 0); icons[kind] = cv.toDataURL('image/png');
      sc.remove(o);
    }
    R.setRenderTarget(prevT); R.setClearColor(prevC, prevA); rt.dispose();
  }
  return V;
}
