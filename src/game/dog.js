// FALSE LIGHT — Juniper: the three.js view + controller for the stray on the spring trail (rules: dogBrain.js).
// One skinned mesh (assets/models/char_dog.glb: actions idle/walk/trot/sit/lie/eat + an additive tail wag, morph "hackles").
// Head-look, ears back, tail tuck and hackles are layered on after the mixer. Runs the same under ?norender=1.
//
//   const dog = await createDog(engine, hooks)   // hooks: see createDog()
//   dog.update(dt, t) every frame while playing · dog.toJSON() / dog.restore(json) in the save
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLB } from '../engine/world.js?v=fa183c0e';
import { DogBrain, DOG } from './dogBrain.js?v=fa183c0e';

// gait clips as baked in Blender (char_dog.py): metres travelled per cycle
const STRIDE = { walk: 0.484, trot: 0.857 };
const HOLD_E = 0.45;                 // seconds held = a command instead of a pat
const HEATER_FALLBACK = [1.98, 30.75, 0.85];
const CAB_SPOTS = [[-0.2, 30, 1.2], [0.95, 30, 1.05], [-1.25, 30, 0.55], [0.95, 30, -0.55], [-0.35, 30, -0.75]];
const LINES = {
  sighted: 'A dog, on the trail. A stray — all ribs and ears. She hasn\'t taken her eyes off you.',
  shy: 'She backs off every time you get close. Something to eat might change her mind.',
  ate1: 'She snatches the beans and backs off to eat, watching you the whole time.',
  offer1: 'She licks the tin clean. Still wary — but she isn\'t going anywhere.',
  get tamed() { return `She's yours now. You call her ${DOG.name}.`; },
  get stay() { return `"Stay." ${DOG.name} sits and watches you go.`; },
  get come() { return `You whistle. ${DOG.name} comes trotting.`; },
  firstPet: 'Her tail thumps against your leg.',
  get door() { return `${DOG.name} scratches at the door and whines.`; },
};
/** The player names her (the lines and prompts read DOG.name live). */
export function setDogName(n) { const v = String(n || '').trim().slice(0, 20); if (v) DOG.name = v; return DOG.name; }

const POSTURES = ['sit', 'lie', 'eat'], SIDES = ['L', 'R'];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/** The stray's stretch of trail: tower -> J1 -> spring, cropped around a home spot ~14 m up from J1. */
function homeLine(W) {
  const segs = (W.layout && W.layout.trail && W.layout.trail.segments) || [];
  const seg = (n) => (segs.find((s) => s.name === n) || {}).points || null;
  const a = seg('tower_to_J1'), b = seg('loop_spring_to_J1');
  let pts;
  if (a && a.length > 1) pts = a.concat(b ? b.slice().reverse().slice(1) : []);
  else if (segs[0] && segs[0].points.length > 1) pts = segs[0].points;
  else pts = [[0, 0, 6], [8, 0, 92], [-58, 0, 74]];
  pts = pts.map((p) => [p[0], p.length > 2 ? p[1] : 0, p.length > 2 ? p[2] : p[1]]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const sJ1 = a ? cum[a.length - 1] : cum[cum.length - 1] * 0.6;
  const s0 = Math.max(0, sJ1 - 50), s1 = Math.min(cum[cum.length - 1], sJ1 + 42);
  const out = []; let first = -1;
  for (let i = 0; i < pts.length; i++) if (cum[i] >= s0 - 1e-6 && cum[i] <= s1 + 1e-6) { if (first < 0) first = i; out.push(pts[i]); }
  if (out.length < 2) return { points: pts, homeS: Math.max(0, sJ1 - 14) };
  return { points: out, homeS: Math.max(0, sJ1 - 14 - cum[first]) };
}

/** The exporter samples position + rotation + scale for all 30 bones in every clip (90 tracks), but only body.position
 *  and the rotations move. Tracks that hold one value in every clip are set once on the bone and dropped: 90 -> ~31 tracks
 *  a clip, a third of the mixer's per-frame work (three's mixer boxes a few numbers per track evaluated, so also far
 *  less garbage). Returns trimmed clones; the cached glTF clips are left alone. */
function trimClips(clips, model) {
  const fixed = new Map();   // 'bone.position' -> [x, y, z] while constant everywhere so far, null once it varies
  for (const c of clips) for (const tr of c.tracks) {
    if (!/\.(position|scale)$/.test(tr.name) || fixed.get(tr.name) === null) continue;
    const v = tr.values, ref = fixed.get(tr.name) || [v[0], v[1], v[2]];
    let same = v.length % 3 === 0;
    for (let i = 0; i < v.length && same; i++) if (Math.abs(v[i] - ref[i % 3]) > 1e-5) same = false;
    fixed.set(tr.name, same ? ref : null);
  }
  for (const c of clips) {   // a clip without the track would fall back to the bone's rest value: only trim if all have it
    const names = new Set(c.tracks.map((tr) => tr.name));
    for (const n of fixed.keys()) if (!names.has(n)) fixed.set(n, null);
  }
  for (const [n, ref] of fixed) {
    if (!ref) continue;
    const dot = n.lastIndexOf('.'), b = model.getObjectByName(n.slice(0, dot)), prop = n.slice(dot + 1);
    if (b && b[prop] && b[prop].isVector3) b[prop].set(ref[0], ref[1], ref[2]); else fixed.set(n, null);
  }
  return clips.map((c) => { const t = c.clone(); t.tracks = t.tracks.filter((tr) => !fixed.get(tr.name)); return t; });
}

/** A stand-in dog when the GLB isn't there (keeps the game playable). */
function placeholder() {
  const g = new THREE.Group(); g.name = 'dog_placeholder';
  const tan = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9 }), blk = new THREE.MeshStandardMaterial({ color: 0x1c1916, roughness: 0.8 });
  const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.12, 0.42, 4, 10), tan, 0, 0.47, 0, Math.PI / 2);
  add(new THREE.CapsuleGeometry(0.07, 0.18, 4, 8), tan, 0, 0.6, 0.3, -0.7);
  add(new THREE.SphereGeometry(0.075, 12, 10), tan, 0, 0.72, 0.44);
  add(new THREE.CapsuleGeometry(0.03, 0.1, 4, 8), blk, 0, 0.7, 0.54, Math.PI / 2);
  for (const [x, z] of [[0.08, 0.24], [-0.08, 0.24], [0.08, -0.26], [-0.08, -0.26]]) add(new THREE.CapsuleGeometry(0.025, 0.36, 4, 6), tan, x, 0.2, z);
  add(new THREE.CapsuleGeometry(0.03, 0.3, 4, 6), blk, 0, 0.4, -0.42, -0.6);
  return g;
}

/**
 * hooks = { foodInHands: () => item|null, eatFood: (item) => void, toast: (text, seconds) => void, say: (text) => void,
 *           isPlay: () => bool, walkMode: () => bool, night: () => bool, weeperNear: () => THREE.Vector3|null, onDogWarn: (info) => void }
 */
export async function createDog(engine, hooks = {}) {
  const W = engine.world, scene = engine.scene;
  const H = {
    foodInHands: () => null, eatFood: () => {}, toast: () => {}, say: () => {}, isPlay: () => true, walkMode: () => true,
    night: () => false, weeperNear: () => null, onDogWarn: () => {}, ...hooks,
  };
  const home = homeLine(W);
  const brain = new DogBrain({
    home: home.points, homeS: home.homeS,
    ground: (x, z) => W.heightAt(x, z),
    snap: (p, out) => snapSpot(p, out),
    blocked: (a, b) => doorBetween(a, b),
  });

  // ---------------------------------------------------------------- view
  const root = new THREE.Group(); root.name = 'dog:Juniper';
  root.rotation.order = 'YXZ';
  scene.add(root);
  const V = { model: null, mixer: null, actions: {}, wag: null, mesh: null, hackIdx: -1, bones: {}, ready: false };
  const ready = (async () => {
    const e = engine.manifest.models && engine.manifest.models.char_dog;
    let gltf = null;
    if (e) { try { gltf = await loadGLB('assets/' + e.path); } catch (err) { console.warn('dog model', err); } }
    if (!gltf) { V.model = placeholder(); root.add(V.model); V.ready = true; return; }
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.isSkinnedMesh) {
          V.mesh = o;
          // r160 culls a SkinnedMesh by its OWN boundingSphere (computed once from whatever pose it's first seen in), not the
          // geometry's: give it one that covers every pose (sit / lie / eat reach ~0.8 m from her feet)
          o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.42, 0), 1.05);
          o.geometry.boundingSphere = o.boundingSphere.clone();
          const d = o.morphTargetDictionary; if (d && d.hackles != null) V.hackIdx = d.hackles;
          const m = o.material; if (m) { if (m.map) m.map.anisotropy = 4; m.needsUpdate = true; }
        }
      }
    });
    const bone = (n) => model.getObjectByName(n) || model.getObjectByName(n.replace('.', '')) || model.getObjectByName(n.replace('.', '_'));
    for (const n of ['neck', 'head', 'hips', 'chest', 'tail1', 'ear.L', 'ear.R']) V.bones[n] = bone(n);
    V.mixer = new THREE.AnimationMixer(model);
    const byName = new Map(trimClips(gltf.animations, model).map((c) => [c.name, c]));
    for (const n of ['idle', 'walk', 'trot', 'sit', 'lie', 'eat']) {
      const clip = byName.get(n); if (!clip) continue;
      const a = V.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      if (n === 'walk' || n === 'trot') a.timeScale = 0;
      V.actions[n] = a;
    }
    const wc = byName.get('wag');
    if (wc) {
      const tail = wc.clone(); tail.tracks = tail.tracks.filter((tr) => /^tail\d\.quaternion$/.test(tr.name));
      THREE.AnimationUtils.makeClipAdditive(tail, 0, tail, 30);
      const a = V.mixer.clipAction(tail, undefined, THREE.AdditiveAnimationBlendMode); a.play(); a.setEffectiveWeight(0);
      V.wag = a;
    }
    // bind-pose axes for the procedural layers (in each parent's local frame)
    model.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion(), q = new THREE.Quaternion();
    model.getWorldQuaternion(rootInv).invert();
    const localAxis = (parent, axis) => { parent.getWorldQuaternion(q); q.premultiply(rootInv).invert(); return axis.clone().applyQuaternion(q).normalize(); };
    const X = new THREE.Vector3(1, 0, 0);
    V.axEar = { L: V.bones['ear.L'] && localAxis(V.bones['ear.L'].parent, X), R: V.bones['ear.R'] && localAxis(V.bones['ear.R'].parent, X) };
    V.axTail = V.bones.tail1 && localAxis(V.bones.tail1.parent, X);
    // the bones the procedural layers rotate, and the mixer's clean pose of each (see animate())
    V.proc = ['neck', 'head', 'ear.L', 'ear.R', 'tail1'].map((n) => V.bones[n]).filter(Boolean);
    V.clean = V.proc.map((b) => b.quaternion.clone()); V.cleanOk = false;
    V.model = model; root.add(model); V.ready = true;
    // build her shader (skinned + morph + sheen) now, not as a hitch on the first frame she comes into view
    if (!engine.noRender && engine.renderer && engine.renderer.compileAsync && engine.camera) {
      try { engine.renderer.compileAsync(model, engine.camera, scene).catch(() => {}); } catch (err) { /* compiles on first sight instead */ }
    }
  })();

  // the tin she eats out of
  let tin = null, tinT = 0, tinLift = 0;
  (async () => {
    const e = engine.manifest.models && engine.manifest.models.prop_food_tin;
    if (!e) return;
    try {
      const g = await loadGLB('assets/' + e.path); tin = g.scene.clone(true); tin.visible = false;
      tin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      tinLift = -new THREE.Box3().setFromObject(tin).min.y;   // sit it on the ground whatever its origin
      scene.add(tin);
    } catch (err) { /* optional */ }
  })();

  // ---------------------------------------------------------------- where she can be put when the player jumps
  const inCabXYZ = (x, y, z) => y > 29 && Math.abs(x) < 2.03 && Math.abs(z) < 2.03;
  function inCab(p) { return inCabXYZ(p[0], p[1], p[2]); }
  function snapSpot(p, out) {
    if (inCab(p)) {
      let best = null, bd = Infinity;
      for (const s of CAB_SPOTS) { const d = Math.hypot(s[0] - p[0], s[2] - p[2]); if (d > 0.9 && d < bd) { bd = d; best = s; } }
      const s = best || CAB_SPOTS[0]; out[0] = s[0]; out[1] = p[1]; out[2] = s[2]; return out;
    }
    const P = engine.player;
    if (!P.onStructure && p[1] < 5) {
      const yaw = P.yaw, bx = p[0] + Math.sin(yaw) * 1.2, bz = p[2] + Math.cos(yaw) * 1.2;   // behind the camera
      const inBase = Math.abs(bx) < 7 && Math.abs(bz) < 7;
      if (inBase || W.trail.nearest(bx, bz).dist < (W.trail.halfWidth || 1.1) + 0.6) { out[0] = bx; out[1] = W.heightAt(bx, bz); out[2] = bz; return out; }
    }
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out;
  }

  // ---------------------------------------------------------------- shut doors (the cab door's COL_wall_*door* collider is enabled only while it's shut)
  let doors = null;
  function findDoors() {
    doors = [];
    for (const c of W.colliders || []) {
      if (!c || c.type !== 'wall' || !c.mesh || !/door/i.test(c.name || '')) continue;
      c.mesh.updateWorldMatrix(true, false);
      doors.push({ c, box: new THREE.Box3().setFromObject(c.mesh) });
    }
  }
  /** Does the straight move a -> b ([x,y,z]) pass through a shut door? Standing inside the door's slab (it swung shut on
   *  her) never counts, so she can always step out of it. Allocation-free. */
  function doorBetween(a, b) {
    if (!doors) { if (!W.colliders) return false; findDoors(); }
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i]; if (d.c.enabled === false) continue;
      const B = d.box, m = 0.03;
      if (Math.max(a[1], b[1]) < B.min.y - 0.4 || Math.min(a[1], b[1]) > B.max.y) continue;
      const x0 = B.min.x - m, x1 = B.max.x + m, z0 = B.min.z - m, z1 = B.max.z + m;
      if (a[0] > x0 && a[0] < x1 && a[2] > z0 && a[2] < z1) continue;
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dz = b[2] - a[2];
      if (Math.abs(dx) < 1e-9) { if (a[0] < x0 || a[0] > x1) continue; }
      else { let u = (x0 - a[0]) / dx, v = (x1 - a[0]) / dx; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (a[2] < z0 || a[2] > z1) continue; }
      else { let u = (z0 - a[2]) / dz, v = (z1 - a[2]) / dz; if (u > v) { const w = u; u = v; v = w; } if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) continue; }
      return true;
    }
    return false;
  }
  /** Same side of the cab wall (no patting her through the glass). */
  function sameRoom() {
    const p = engine.player.position, q = root.position;
    if (p.y < 29 && q.y < 29) return true;
    return inCabXYZ(p.x, p.y, p.z) === inCabXYZ(q.x, q.y, q.z);
  }

  // ---------------------------------------------------------------- interactions
  const headAnchor = new THREE.Vector3(), bodyAnchor = new THREE.Vector3();
  let pending = null, petted = false;
  const I = engine.interact;
  const playing = () => H.isPlay() && H.walkMode();
  const offMain = I.register({
    id: 'dog:main', anchor: headAnchor, radius: 0.6, reach: 2.6,
    label: () => {
      if (H.foodInHands()) return brain.tamed ? `E — Give ${DOG.name} the beans` : 'E — Offer the beans';
      return brain.mode === 'stay' ? `E — Pet ${DOG.name}   ·   hold E — Come` : `E — Pet ${DOG.name}   ·   hold E — Stay`;
    },
    enabled: () => playing() && V.ready && brain.canOffer() && (brain.tamed || !!H.foodInHands()) && sameRoom(),
    onUse: () => {
      const food = H.foodInHands();
      if (food) { if (brain.offer()) { H.eatFood(food); showTin(); } return; }
      if (brain.tamed) pending = { t: 0 };
    },
  });
  const offCall = I.register({
    id: 'dog:call', anchor: bodyAnchor, radius: 1.0, reach: 30,
    label: () => `E — Whistle for ${DOG.name}`,
    enabled: () => playing() && V.ready && brain.tamed && brain.mode === 'stay' && root.position.distanceTo(engine.player.position) > 3.2,
    onUse: () => brain.command('come'),
  });

  function showTin() {
    if (!tin) return;
    // the nose in the eat pose is ~0.32 m ahead of her origin (char_dog.py prints it)
    const s = Math.sin(brain.yaw), c = Math.cos(brain.yaw);
    tin.position.set(brain.pos[0] + s * 0.34, brain.pos[1] + tinLift + 0.003, brain.pos[2] + c * 0.34);
    tin.rotation.set(0, brain.yaw + 0.6, 0); tin.visible = true; tinT = DOG.eatTime + 25;
  }

  // ---------------------------------------------------------------- per frame (allocation-free)
  const ctx = { player: [0, 0, 0], vel: [0, 0], jog: false, food: false, night: false, zone: 'trail', weeper: null, heater: null, play: true };
  const heater = { pos: [0, 30, 0], yaw: Math.PI };
  const wpos = [0, 0, 0];
  const post = { sit: 0, lie: 0, eat: 0 }, sm = { look: 0, lyaw: 0, lpitch: 0, alert: 0, wag: 0, hack: 0 };
  let phase = 0, clock = 0, hasLast = false, animAcc = 0, animN = 0;
  const lastB = [0, 0, 0], vo = new THREE.Vector3();
  const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tq3 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), rgt = new THREE.Vector3();

  function update(dt, t) {
    if (!H.isPlay()) return;
    const P = engine.player;
    ctx.player[0] = P.position.x; ctx.player[1] = P.position.y; ctx.player[2] = P.position.z;
    ctx.vel[0] = P.velocity ? P.velocity.x : 0; ctx.vel[1] = P.velocity ? P.velocity.z : 0;
    ctx.jog = !!(engine.input && engine.input.isDown('jog'));
    ctx.food = !!H.foodInHands(); ctx.night = !!H.night(); ctx.zone = P.zone;
    const w = H.weeperNear();
    if (w) { wpos[0] = w.x; wpos[1] = w.y; wpos[2] = w.z; ctx.weeper = wpos; } else ctx.weeper = null;
    const ha = W.anchors.get('IA_heater');
    const hx = ha ? ha.x : HEATER_FALLBACK[0], hz = ha ? ha.z : HEATER_FALLBACK[2];
    heater.pos[0] = hx - 0.55; heater.pos[1] = 30.0; heater.pos[2] = hz; heater.yaw = Math.PI;
    ctx.heater = heater;
    // hold E: a pat, or (held) stay / come
    if (pending) {
      if (engine.input.isDown('interact')) { pending.t += dt; if (pending.t >= HOLD_E) { pending = null; brain.command('toggle'); } }
      else { pending = null; brain.pet(); }
    }
    clock += dt;
    const evs = brain.update(dt, ctx);
    for (let i = 0; i < evs.length; i++) onEvent(evs[i]);
    // root transform (+ lean up/down slopes and stairs). Small pops in the rules (a loop cut when you double back past her,
    // up to ~0.45 m) glide out over ~0.2 s instead of snapping; real teleports (>= 1 m) still snap.
    const jx = brain.pos[0] - lastB[0], jy = brain.pos[1] - lastB[1], jz = brain.pos[2] - lastB[2];
    const jump = Math.hypot(jx, jy, jz), expect = brain.speed * dt + 0.05;
    if (!hasLast || jump >= 1) vo.set(0, 0, 0);
    else if (jump > expect) { const f = 1 - expect / jump; vo.x -= jx * f; vo.y -= jy * f; vo.z -= jz * f; }
    vo.multiplyScalar(Math.exp(-14 * dt));
    lastB[0] = brain.pos[0]; lastB[1] = brain.pos[1]; lastB[2] = brain.pos[2]; hasLast = true;
    root.position.set(brain.pos[0] + vo.x, brain.pos[1] + vo.y, brain.pos[2] + vo.z);
    const lean = brain.speed > 0.05 ? Math.max(-0.5, Math.min(0.5, Math.atan(brain.slope || 0) * 0.85)) : 0;
    root.rotation.set(damp(root.rotation.x, -lean, 6, dt), brain.yaw, 0);
    if (tinT > 0) { tinT -= dt; if (tinT <= 0 && tin) tin.visible = false; }
    // animation LOD: at 45 m+ she's a few pixels (the stray while you're up the tower): pose her 1 frame in 4; past 150 m not
    // at all until you come back. The rules, her position and the prompts still run every frame.
    const cp = engine.camera ? engine.camera.position : P.position;
    const dc = Math.hypot(cp.x - root.position.x, cp.y - root.position.y, cp.z - root.position.z);
    const every = dc < 45 ? 1 : dc < 150 ? 4 : 0;
    animAcc += dt;
    if (every && ++animN >= every) { animN = 0; animate(Math.min(animAcc, 0.25)); animAcc = 0; }
    // anchors: her head (pat / beans) and her back (whistle)
    if (V.bones.head) V.bones.head.getWorldPosition(headAnchor); else headAnchor.set(0, post.lie > 0.5 ? 0.42 : 0.7, 0.45).applyEuler(root.rotation).add(root.position);
    headAnchor.y += 0.04;
    bodyAnchor.set(0, post.lie > 0.5 ? 0.25 : 0.45, 0).add(root.position);
  }

  // a damped weight never quite reaches 0, and three's mixer evaluates every track of any clip with weight > 0: snap the
  // invisible tails to 0 so faded-out clips cost nothing (with 7 clips that halves the mixer's work in most states)
  const snapW = (w) => (w < 2e-3 ? 0 : w > 0.998 ? 1 : w);
  function setW(n, wgt) { const a = V.actions[n]; if (a) a.setEffectiveWeight(snapW(wgt)); }
  function animate(dt) {
    if (!V.ready || !V.mixer) return;
    const A = V.actions, k = 1 / 0.45;
    for (let i = 0; i < 3; i++) { const n = POSTURES[i]; post[n] = snapW(damp(post[n], brain.posture === n ? 1 : 0, k * 1.6, dt)); }
    const stand = Math.max(0, 1 - post.sit - post.lie - post.eat);
    const v = brain.speed, s1 = sstep(0.06, 0.35, v), s2 = sstep(1.0, 1.7, v);
    phase = (phase + dt * v / (STRIDE.walk + (STRIDE.trot - STRIDE.walk) * s2)) % 1;
    setW('idle', stand * (1 - s1)); setW('walk', stand * s1 * (1 - s2)); setW('trot', stand * s1 * s2);
    setW('sit', post.sit); setW('lie', post.lie); setW('eat', post.eat);
    if (A.walk) A.walk.time = phase * A.walk.getClip().duration;
    if (A.trot) A.trot.time = phase * A.trot.getClip().duration;
    sm.wag = damp(sm.wag, brain.wag, 4, dt);
    if (V.wag) { V.wag.setEffectiveWeight(snapW(Math.min(1, sm.wag * 1.3))); V.wag.timeScale = 0.55 + sm.wag * 0.9; }
    // three's PropertyMixer only writes a bone when the blended value CHANGED since last frame, so in a held pose (sit / lie
    // with a still tail) last frame's head-look / ears-back / tail-tuck would stay on the bone and pile up every frame (the
    // tail spun ~50 deg a frame). Put the mixer's own last pose back first; if it doesn't write, that is still correct.
    const PB = V.proc, CQ = V.clean;
    if (V.cleanOk) for (let i = 0; i < PB.length; i++) PB[i].quaternion.copy(CQ[i]);
    V.mixer.update(dt);
    for (let i = 0; i < PB.length; i++) CQ[i].copy(PB[i].quaternion);
    V.cleanOk = true;
    // ---- procedural layers on top of the clips
    root.updateMatrixWorld(true);
    sm.alert = damp(sm.alert, brain.alert, 3, dt);
    // head-look: yaw about world up, pitch about her right axis, split neck 40 % / head 60 %
    sm.look = damp(sm.look, brain.hasLook ? brain.lookW * (post.eat > 0.5 ? 0 : 1) : 0, 3, dt);
    if (brain.hasLook && V.bones.head) {
      V.bones.head.getWorldPosition(tv);
      const dx = brain.look[0] - tv.x, dy = brain.look[1] - tv.y, dz = brain.look[2] - tv.z;
      const lx = dx * Math.cos(brain.yaw) - dz * Math.sin(brain.yaw), lz = dx * Math.sin(brain.yaw) + dz * Math.cos(brain.yaw);
      const yawT = Math.max(-1.3, Math.min(1.3, Math.atan2(lx, lz))), pitchT = Math.max(-0.6, Math.min(0.75, Math.atan2(-dy, Math.hypot(lx, lz))));
      sm.lyaw = damp(sm.lyaw, yawT, 5, dt); sm.lpitch = damp(sm.lpitch, pitchT, 5, dt);
    }
    if (sm.look > 0.01 && V.bones.neck && V.bones.head) {
      rgt.set(1, 0, 0).applyQuaternion(root.quaternion);
      for (let i = 0; i < 2; i++) {
        const b = i ? V.bones.head : V.bones.neck, f = i ? 0.6 : 0.4;
        tq.setFromAxisAngle(up, sm.lyaw * f * sm.look).multiply(tq2.setFromAxisAngle(rgt, sm.lpitch * f * sm.look * (post.lie > 0.5 ? 0.6 : 1)));
        b.parent.getWorldQuaternion(tq3);
        // local' = parentWorld^-1 * R * parentWorld * local
        b.quaternion.premultiply(tq3).premultiply(tq).premultiply(tq3.invert());
        b.updateMatrixWorld(true);
      }
    }
    // ears back + tail tucked when she's afraid (and a little when trotting / fleeing)
    const earBack = Math.max(sm.alert * 0.95, sstep(1.8, 3.2, brain.speed) * 0.25);
    for (let i = 0; i < 2; i++) { const sd = SIDES[i], e = V.bones[i ? 'ear.R' : 'ear.L'], ax = V.axEar[sd]; if (e && ax && earBack > 0.01) e.quaternion.premultiply(tq.setFromAxisAngle(ax, -earBack)); }
    if (V.bones.tail1 && V.axTail && sm.alert > 0.01) V.bones.tail1.quaternion.premultiply(tq.setFromAxisAngle(V.axTail, -0.85 * sm.alert));
    sm.hack = damp(sm.hack, brain.alert > 0.6 ? 1 : 0, 2.5, dt);
    if (V.mesh && V.hackIdx >= 0) V.mesh.morphTargetInfluences[V.hackIdx] = sm.hack;
  }

  let doorToldAt = -1e9;
  function onEvent(ev) {
    switch (ev.type) {
      case 'sighted': H.say(LINES.sighted); break;
      case 'shy': H.toast(LINES.shy, 4.5); break;
      case 'ate': if (!ev.tamed && ev.offers === 1) H.toast(LINES.ate1, 4); break;
      case 'offer1': H.toast(LINES.offer1, 4); break;
      case 'tamed': if (H.onTamed) H.onTamed(); else H.toast(LINES.tamed, 5); break;
      case 'pet': if (!petted) { petted = true; H.toast(LINES.firstPet, 2.5); } break;
      case 'stay': H.toast(LINES.stay, 2.5); break;
      case 'come': H.toast(LINES.come, 2.5); break;
      case 'warn': H.onDogWarn({ name: DOG.name, tamed: ev.tamed, distance: ev.distance, playerDistance: ev.playerDistance }); break;
      case 'door': {   // shut out (or in): tell the player once per minute at most, only if they're close enough to hear
        const p = engine.player.position;
        if (clock - doorToldAt > 60 && Math.hypot(p.x - brain.pos[0], p.y - brain.pos[1], p.z - brain.pos[2]) < 12) { doorToldAt = clock; H.toast(LINES.door, 3); }
        break;
      }
      default: break;
    }
  }

  const api = {
    ready: ready.then(() => api),
    brain, root,
    get name() { return DOG.name; },
    get state() { return brain.state; },
    get tamed() { return brain.tamed; },
    get position() { return root.position; },
    update,
    toJSON: () => brain.toJSON(),
    restore(json) {
      brain.restore(json); pending = null; tinT = 0; hasLast = false; if (tin) tin.visible = false;
      root.position.set(brain.pos[0], brain.pos[1], brain.pos[2]); root.rotation.set(0, brain.yaw, 0);
      for (const n in post) post[n] = brain.posture === n ? 1 : 0;
    },
    /** New game: back to a stray on the spring trail. */
    reset() {
      brain.reset(); pending = null; tinT = 0; petted = false; hasLast = false; if (tin) tin.visible = false;
      root.position.set(brain.pos[0], brain.pos[1], brain.pos[2]); root.rotation.set(0, brain.yaw, 0);
      for (const n in post) post[n] = 0;
    },
    dispose() { offMain(); offCall(); scene.remove(root); if (tin) scene.remove(tin); if (V.mixer) V.mixer.stopAllAction(); },
  };
  root.position.set(brain.pos[0], brain.pos[1], brain.pos[2]);
  await ready;
  return api;
}
