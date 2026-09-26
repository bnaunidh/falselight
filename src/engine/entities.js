// FALSE LIGHT — entities (posed static meshes, instant pose swaps), what-can-be-seen tests (engine.view),
// line of sight (terrain + tower + tree trunks), and the crosshair interaction registry.
import * as THREE from 'three';
import { loadGLB } from './world.js?v=b5a31e5b';
import { clamp } from './util.js?v=b5a31e5b';

// ------------------------------------------------------------------ placeholder people (until the Blender characters land)
function placeholderFigure(kind) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: kind === 'weeper' ? 0xb9b4ac : 0x6e6a64, roughness: 0.75 });
  const cloth = new THREE.MeshStandardMaterial({ color: kind === 'lost_hiker' ? 0x9a6a1c : kind === 'other_lookout' ? 0x3f4230 : 0x2a2a2a, roughness: 0.9 });
  const tall = kind === 'weeper' ? 1.12 : 1;
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y * tall, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  const poses = {};
  const mk = (name, fn) => { const p = new THREE.Group(); p.name = 'POSE_' + name; fn(p); poses[name] = p; g.add(p); };
  const body = (p, sit = false, lookup = false, run = 0) => {
    const legH = sit ? 0.5 : 0.85;
    const A = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y * tall, z); m.rotation.set(rx, 0, rz); m.castShadow = true; p.add(m); return m; };
    A(new THREE.CapsuleGeometry(0.075, legH, 4, 8), cloth, -0.1, legH / 2 + 0.05, sit ? 0.2 : run * 0.15, sit ? 1.3 : run * 0.6);
    A(new THREE.CapsuleGeometry(0.075, legH, 4, 8), cloth, 0.1, legH / 2 + 0.05, sit ? 0.2 : -run * 0.15, sit ? 1.3 : -run * 0.6);
    const ty = sit ? 0.85 : 1.28;
    A(new THREE.CapsuleGeometry(kind === 'weeper' ? 0.12 : 0.17, 0.5, 4, 10), kind === 'weeper' ? skin : cloth, 0, ty, sit ? -0.05 : 0, sit && !lookup ? 0.45 : run * -0.3);
    A(new THREE.CapsuleGeometry(0.05, 0.62, 4, 8), kind === 'weeper' ? skin : cloth, -0.24, ty + 0.05, sit && !lookup ? 0.25 : 0, sit && !lookup ? -1.1 : run * 1.2, 0.15);
    A(new THREE.CapsuleGeometry(0.05, 0.62, 4, 8), kind === 'weeper' ? skin : cloth, 0.24, ty + 0.05, sit && !lookup ? 0.25 : 0, sit && !lookup ? -1.1 : -run * 1.2, -0.15);
    const head = A(new THREE.SphereGeometry(0.11, 16, 12), skin, 0, ty + 0.46, sit && !lookup ? 0.18 : 0);
    if (kind === 'lost_hiker') head.rotation.z = 0.6;
    const fa = new THREE.Object3D(); fa.name = 'FACE_anchor'; fa.position.set(0, (ty + 0.47) * tall, sit && !lookup ? 0.26 : 0.1); p.add(fa);
  };
  mk('stand', (p) => body(p)); mk('stand_tilt', (p) => body(p)); mk('step', (p) => body(p, false, false, 0.6)); mk('at_door', (p) => body(p));
  mk('sit_sob', (p) => body(p, true, false)); mk('sit_lookup', (p) => body(p, true, true)); mk('run_a', (p) => body(p, false, false, 1)); mk('run_b', (p) => body(p, false, false, -1));
  mk('lunge', (p) => body(p, false, false, 0.8)); mk('crouch_door', (p) => body(p, true, true)); mk('back_window', (p) => body(p)); mk('on_stairs', (p) => body(p));
  mk('sitting_bed', (p) => body(p, true)); mk('body', (p) => body(p));
  g.userData.placeholder = true;
  return g;
}

const MODEL = { hiker: 'char_lost_hiker', lost_hiker: 'char_lost_hiker', lost_hiker_body: 'char_lost_hiker_body', weeper: 'char_weeper', other_lookout: 'char_other_lookout' };

export function createEntities(engine) {
  const { scene } = engine;
  const list = new Set();
  let nextId = 1;
  const api = {
    list,
    spawn(kind, { position = new THREE.Vector3(), facing = null, pose = null } = {}) {
      const root = new THREE.Group(); root.name = 'entity:' + kind; scene.add(root);
      const h = {
        id: nextId++, kind, root, pose: null, poses: new Map(), faceAnchors: new Map(), ready: null,
        setPose(name) {
          h.pose = name;
          for (const [n, o] of h.poses) o.visible = n === name;
          if (h.poses.size && !h.poses.has(name)) { const first = [...h.poses.keys()][0]; h.poses.get(first).visible = true; }
        },
        setPosition(v) { root.position.copy(v); },
        face(v) { const d = new THREE.Vector3().subVectors(v, root.position); root.rotation.y = Math.atan2(d.x, d.z); },
        setVisible(b) { root.visible = b; },
        get visible() { return root.visible; },
        remove() { scene.remove(root); list.delete(h); },
        faceAnchor() { const a = h.faceAnchors.get(h.pose); return a || null; },
        get position() { return root.position; },
      };
      const attach = (model) => {
        model.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true;
            // skin and cloth are never metal (the exporter's JPEG'd ORM maps leak into the metal channel); a badge or buckle may be
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && 'metalness' in m && !/badge|buckle|brass|metal|button/i.test(m.name || '')) m.metalness = 0; }
          if (o.name && o.name.startsWith('POSE_')) h.poses.set(o.name.slice(5), o);
        });
        for (const [n, o] of h.poses) { let fa = null; o.traverse((c) => { if (c.name && c.name.startsWith('FACE_anchor')) fa = c; }); if (fa) h.faceAnchors.set(n, fa); }
        root.add(model);
        h.setPose(pose || h.pose || [...h.poses.keys()][0]);
      };
      const m = engine.manifest.models && engine.manifest.models[MODEL[kind]];
      h.ready = (m ? loadGLB('assets/' + m.path).then((g) => g.scene.clone(true)) : Promise.resolve(placeholderFigure(kind)))
        .catch(() => placeholderFigure(kind)).then(attach);
      h.setPosition(position); if (facing) h.face(facing);
      h.pose = pose;
      list.add(h);
      return h;
    },
    update() {},
  };
  return api;
}

// ------------------------------------------------------------------ visibility
export function createView(engine) {
  const { camera } = engine;
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Vector3();
  let blockers = null;
  function structureMeshes() {
    if (blockers) return blockers;
    blockers = [];
    const tw = engine.scene.getObjectByName('placeholder_tower');
    engine.scene.traverse((o) => { if (o.isMesh && o.visible && /FL_tower_(siding|trim|timber|deck|floor|roof|shedwall|glass)/.test(o.name)) blockers.push(o); });
    return blockers;
  }
  const V = {
    lineOfSight(a, b, { trees = true, structures = true } = {}) {
      const w = engine.world; const d = tmp.subVectors(b, a); const L = d.length(); if (L < 0.01) return true;
      // terrain: march the segment
      const n = Math.min(64, Math.max(6, Math.ceil(L / 4)));
      for (let i = 1; i < n; i++) { const t = i / n; const x = a.x + d.x * t, y = a.y + d.y * t, z = a.z + d.z * t; if (w.heightAt(x, z) > y + 0.15) return false; }
      // tree trunks (2-D circle test on the grid cells the segment crosses)
      if (trees && w.trunkGrid) {
        const seen = new Set();
        const steps = Math.ceil(L / 10) + 1;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps; const cx = Math.floor((a.x + d.x * t) / 20), cz = Math.floor((a.z + d.z * t) / 20);
          for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
            const k = ix + ',' + iz; if (seen.has(k)) continue; seen.add(k);
            for (const tr of w.trunkGrid.get(k) || []) {
              const vx = d.x, vz = d.z; const tt = clamp(((tr[0] - a.x) * vx + (tr[1] - a.z) * vz) / (vx * vx + vz * vz + 1e-9), 0, 1);
              if (tt < 0.02 || tt > 0.98) continue;
              const px = a.x + vx * tt, pz = a.z + vz * tt; const yy = a.y + d.y * tt;
              if (Math.hypot(px - tr[0], pz - tr[1]) < tr[2] * 0.9 && yy < w.heightAt(tr[0], tr[1]) + 18) return false;
            }
          }
        }
      }
      const box = V._box || (V._box = new THREE.Box3(new THREE.Vector3(-6.5, -1, -6.5), new THREE.Vector3(6.5, 37, 6.5)));
      if (structures && (box.containsPoint(a) || box.containsPoint(b) || new THREE.Ray(a, d.clone().normalize()).intersectsBox(box))) {
        const bl = structureMeshes();
        if (bl.length) { ray.set(a, d.clone().normalize()); ray.far = L - 0.3; const hit = ray.intersectObjects(bl, false).find((h) => !(h.object.material && h.object.material.name === 'FL_glass')); if (hit) return false; }
      }
      return true;
    },
    litAt(p) {
      const L = engine.lights;
      if (engine.sky && engine.sky.dayFactor > 0.35) return 'daylight';
      if (L.searchlight.isLit(p)) return 'beam';
      if (L.flashlight.isLit(p)) return 'flashlight';
      if (L.flashAge() < 0.2 && p.distanceTo(camera.position) < 40 && V.lineOfSight(camera.position, p, { trees: false })) return 'flash';
      if (engine.sky && engine.sky.flash > 0.3) return 'lightning';
      if (L.cabLamp.on && p.distanceTo(L.cabLamp.light.position) < 5) return 'lamp';
      return null;
    },
    check(h, cam = camera) {
      cam.updateMatrixWorld(); pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
      const base = h.root.position;
      const pts = [0.15, 0.6, 1.1, 1.6].map((y) => new THREE.Vector3(base.x, base.y + y, base.z));
      let inF = 0, vis = 0, lit = null;
      for (const p of pts) {
        if (frustum.containsPoint(p)) { inF++; if (V.lineOfSight(cam.position, p)) { vis++; lit = lit || V.litAt(p); } }
      }
      const fa = h.faceAnchor();
      let faceVisible = false;
      if (fa && h.root.visible) {
        const fp = new THREE.Vector3(); fa.getWorldPosition(fp);
        const fdir = new THREE.Vector3(0, 0, 1).transformDirection(fa.matrixWorld);
        const toCam = new THREE.Vector3().subVectors(cam.position, fp); const dist = toCam.length(); toCam.normalize();
        const facing = fdir.dot(toCam) > Math.cos(THREE.MathUtils.degToRad(60));
        const zoom = cam.userData.zoom || 1;
        faceVisible = facing && dist < 70 * zoom && frustum.containsPoint(fp) && V.lineOfSight(cam.position, fp) && !!V.litAt(fp);
      }
      return { inFrustum: inF > 0, onScreen: inF / pts.length, occluded: inF > 0 && vis === 0, visible: vis > 0 && h.root.visible,
        lit: vis > 0 ? lit : null, faceVisible, distance: cam.position.distanceTo(base) };
    },
  };
  return V;
}

// ------------------------------------------------------------------ crosshair interaction
export function createInteract(engine) {
  const { camera } = engine;
  const targets = new Map();
  const el = document.createElement('div');
  el.id = 'fl-prompt';
  el.style.cssText = 'position:fixed;left:50%;top:calc(50% + 28px);transform:translateX(-50%);font:500 16px/1.3 Georgia,serif;color:#f1ebdd;letter-spacing:.03em;text-shadow:0 1px 3px #000;padding:5px 12px;border-radius:14px;background:rgba(10,10,8,.45);pointer-events:none;opacity:0;transition:opacity .15s;white-space:nowrap;z-index:20';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:rgba(235,228,212,.55);pointer-events:none;z-index:20';
  document.body.append(el, dot);
  const dir = new THREE.Vector3(), p = new THREE.Vector3(), tmp = new THREE.Vector3();
  const api = {
    current: null, crosshair: dot, promptEl: el,
    register(t) { targets.set(t.id, t); return () => targets.delete(t.id); },
    unregister(id) { targets.delete(id); },
    targets,
    position(t) {
      if (t.anchor instanceof THREE.Vector3) return t.anchor;
      if (t.anchor && t.anchor.isObject3D) return t.anchor.getWorldPosition(p);
      return engine.world.anchors.get(t.anchor) || null;
    },
    update() {
      camera.getWorldDirection(dir);
      let best = null, bs = Infinity;
      for (const t of targets.values()) {
        if (t.enabled && !t.enabled()) continue;
        const pos = api.position(t); if (!pos) continue;
        tmp.subVectors(pos, camera.position); const along = tmp.dot(dir);
        const maxD = t.reach || 2.4;
        if (along < 0.1 || along > maxD + (t.radius || 0.4)) continue;
        const off = tmp.addScaledVector(dir, -along).length();
        if (off > (t.radius || 0.4)) continue;
        const s = off + along * 0.1;
        if (s < bs) { bs = s; best = t; }
      }
      api.current = best;
      const show = best && engine.input.locked && !engine.uiBlocking;
      el.style.opacity = show ? 1 : 0; if (best) { const lb = typeof best.label === 'function' ? best.label() : best.label; el.textContent = engine.input.rekey ? engine.input.rekey(lb) : lb; }
      dot.style.background = show ? 'rgba(255,236,200,.95)' : 'rgba(235,228,212,.45)';
    },
    use() { const t = api.current; if (t && t.onUse) { t.onUse(); return true; } return false; },
  };
  return api;
}
