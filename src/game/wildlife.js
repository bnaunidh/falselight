// FALSE LIGHT — the wildlife, three.js side: deer, the black bear and the ambient calls (rules: wildlifeBrain.js).
// Models: assets/models/char_deer.glb and char_bear.glb — ONE skinned mesh each, baked actions (deer: idle walk run graze alert;
// bear: idle walk run rear huff forage), cloned per animal with SkeletonUtils, crossfaded by an AnimationMixer the way
// dog.js does it. A missing model falls back to a simple procedurally-posed placeholder. Runs the same under ?norender=1.
// The bear is a big boar: drawn at WILD.bear.scale (the root scales, and with it the metres per stride, so the feet don't
// skate, and the model-space cull sphere); a heavy side-to-side roll at the walk; head carried low when it's worked up
// (bear.agit); 'bear_step' footfalls on the run clip's footfall phases while it runs near you; and EYESHINE — two small
// gold-green glints riding the head bone, shown only while a light (the flashlight's cone, the searchlight's beam) is on
// its eyes at night and it faces it (bear.eyes).
//
//   const wild = await createWildlife(engine, hooks)   // hooks: see createWildlife()
//   wild.update(dt, t) every frame while playing · wild.toJSON() / wild.restore(json) in the save · wild.reset() on a new game
//   wild.animals: [{ id, kind: 'deer'|'bear', role, root, position: Vector3, act, state }] · wild.nearestDeer(pos, maxDist)
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLB } from '../engine/world.js?v=7c0235c6';
import { WildlifeBrain, WILD, resolvePlaces } from './wildlifeBrain.js?v=7c0235c6';

const CLIPS = { deer: ['idle', 'walk', 'run', 'graze', 'alert'], bear: ['idle', 'walk', 'run', 'rear', 'huff', 'forage'] };
const POSE = { deer: { graze: 1, alert: 1 }, bear: { rear: 1, huff: 1, forage: 1 } };   // clips the brain's `act` picks when standing
const GAIT = { deer: [0.08, 0.35, 2.2, 3.8], bear: [0.08, 0.35, 1.8, 3.2] };            // walk fade-in, run fade-in (m/s)
// skinned-mesh cull sphere in MODEL space (centre y, radius): three culls by it x the root's world matrix, so the bear's
// 1.25x scale grows it with the body (rearing: ~1.9 m x 1.25 = 2.4 m tall, inside a 2.1 m sphere centred 1 m up)
const SPHERE = { deer: [0.8, 1.3], bear: [0.85, 1.7] };
// the run clip's footfalls: [phase, x, z] in model metres (LH, RH, LF, RF; +x = its left) — char_bear.py's gallop
const FOOT = [[0, 0.17, -0.5], [0.08, -0.17, -0.5], [0.44, 0.17, 0.45], [0.52, -0.17, 0.45]];
// eyeshine: where char_bear.glb's eyes are, in head-bone space (the UV spheres char_bear.py sinks in the skull, at
// model (+-0.071, 0.706, 0.784), pushed out along their gaze to the cornea); and the placeholder's, on its neck group
const EYES = { bear: [[0.076, 0.168, -0.091], [-0.076, 0.168, -0.091]], placeholder: [[0.08, 0.1, 0.35], [-0.08, 0.1, 0.35]] };
export const EYESHINE_AT = EYES;   // (tests/wildlife_models.test.mjs checks the bear's against the GLB's eyes)
const HEAD_DOWN = [0.32, -0.14];   // agitated: the neck drops this far (rad), the head tips back up this much (a low, level stare)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const snapW = (w) => (w < 2e-3 ? 0 : w > 0.998 ? 1 : w);
const crossed = (a, b, p) => (b > a ? p > a && p <= b : b < a ? p > a || p <= b : false);   // phase a -> b (wrapping) passed p
const _X = new THREE.Vector3(1, 0, 0), _q = new THREE.Quaternion();

// ---------------------------------------------------------------- eyeshine
let EYE_TEX = null;
/** A soft round glint (32 x 32, white, alpha falling off from a hot core): a DataTexture, so it builds without a DOM. */
function eyeTex() {
  if (EYE_TEX) return EYE_TEX;
  const N = 32, px = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2), a = r >= 1 ? 0 : Math.pow(1 - r, 1.8) * 0.75 + (r < 0.28 ? 0.25 * (1 - r / 0.28) : 0);
    const k = (j * N + i) * 4; px[k] = px[k + 1] = px[k + 2] = 255; px[k + 3] = Math.round(Math.min(1, a) * 255);
  }
  EYE_TEX = new THREE.DataTexture(px, N, N, THREE.RGBAFormat); EYE_TEX.magFilter = THREE.LinearFilter; EYE_TEX.minFilter = THREE.LinearFilter; EYE_TEX.needsUpdate = true;
  return EYE_TEX;
}
/** Two glints on `parent` (the head bone) at `pts`; `unit` = the parent's world scale (the sprites are sized in metres). */
function makeEyes(parent, pts, unit) {
  const mat = new THREE.SpriteMaterial({ map: eyeTex(), color: new THREE.Color(1.25, 1.4, 0.55), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  // the glint is bigger than the eye (so it reads at 30 m): nudged 15 cm toward the camera in view space, its quad clears
  // the brow and fur round the socket, while a trunk or a rock in the way still hides it (depth-tested, not drawn on top)
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );', '$&\n\tmvPosition.z += 0.15;'); };
  mat.customProgramCacheKey = () => 'fl-eyeshine';
  const spr = pts.map((p) => { const s = new THREE.Sprite(mat); s.name = 'eyeshine'; s.position.set(p[0], p[1], p[2]); s.visible = false; s.renderOrder = 7; parent.add(s); return s; });
  return { spr, mat, unit: unit || 1, k: 0 };
}

/** Tracks that hold one value in every clip are set once on the bone and dropped (a third of the mixer's work; see dog.js).
 *  Returns { clips (trimmed clones, shared by every animal of the kind), fixed: [[boneName, prop, [x,y,z]]] }. */
function trimClips(clips, model) {
  const fixed = new Map();
  for (const c of clips) for (const tr of c.tracks) {
    if (!/\.(position|scale)$/.test(tr.name) || fixed.get(tr.name) === null) continue;
    const v = tr.values, ref = fixed.get(tr.name) || [v[0], v[1], v[2]];
    let same = v.length % 3 === 0;
    for (let i = 0; i < v.length && same; i++) if (Math.abs(v[i] - ref[i % 3]) > 1e-5) same = false;
    fixed.set(tr.name, same ? ref : null);
  }
  for (const c of clips) { const names = new Set(c.tracks.map((tr) => tr.name)); for (const n of fixed.keys()) if (!names.has(n)) fixed.set(n, null); }
  const list = [];
  for (const [n, ref] of fixed) {
    if (!ref) continue;
    const dot = n.lastIndexOf('.'), bone = n.slice(0, dot), prop = n.slice(dot + 1), b = model.getObjectByName(bone);
    if (b && b[prop] && b[prop].isVector3) list.push([bone, prop, ref]); else fixed.set(n, null);
  }
  return { clips: clips.map((c) => { const t = c.clone(); t.tracks = t.tracks.filter((tr) => !fixed.get(tr.name)); return t; }), fixed: list };
}

/** Metres travelled per cycle of a baked in-place gait, read off the clip itself: a planted hoof slides backward at ground
 *  speed, so its median backward speed while it is down (lowest 5 mm) x the cycle length. Measured on the real GLBs this gives
 *  the builders' own S/Dty (deer 0.645 / 2.5, bear 0.781 / 2.5, and the dog's 0.48), so a retuned gait can't make the feet skate.
 *  null if it can't tell (no feet on the ground, a stand-in model). Load time only (a throwaway clone + mixer). */
const _mv = new THREE.Vector3();
function measureStride(scene, clip, N = 160) {
  if (!clip || !(clip.duration > 0)) return null;
  const model = cloneSkinned(scene), feet = [];
  model.traverse((o) => { if (o.isBone && !o.children.some((c) => c.isBone)) feet.push(o); });
  if (!feet.length) return null;
  const mixer = new THREE.AnimationMixer(model), act = mixer.clipAction(clip); act.play();
  const ys = feet.map(() => new Float32Array(N)), zs = feet.map(() => new Float32Array(N));
  for (let i = 0; i < N; i++) {
    mixer.setTime((i / N) * clip.duration); model.updateMatrixWorld(true);
    for (let k = 0; k < feet.length; k++) { feet[k].getWorldPosition(_mv); ys[k][i] = _mv.y; zs[k][i] = _mv.z; }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(model);
  const v = [];
  for (let k = 0; k < feet.length; k++) {
    let lo = Infinity; for (let i = 0; i < N; i++) lo = Math.min(lo, ys[k][i]);
    if (lo > 0.12) continue;   // not a foot (an ear, the tail, the jaw)
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (ys[k][i] < lo + 0.005 && ys[k][j] < lo + 0.005) v.push((zs[k][i] - zs[k][j]) * N); }
  }
  if (v.length < 6) return null;
  v.sort((a, b) => a - b);
  const m = v[v.length >> 1];
  return m > 0.05 && Number.isFinite(m) ? m : null;
}

// ---------------------------------------------------------------- placeholders (until the GLBs land)
const PH_MATS = {};
function phMat(key, color) { return PH_MATS[key] || (PH_MATS[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.92 })); }
/** A stand-in animal built from capsules, posed procedurally (legs swing, head down to graze, the bear rears). */
function placeholder(kind) {
  const bear = kind === 'bear';
  const coat = bear ? phMat('bear', 0x161412) : phMat('deer', 0x7b5b43), pale = bear ? phMat('muzzle', 0x9b7b58) : phMat('belly', 0xcdbfa6), dark = phMat('tail', 0x2a2119);
  const g = new THREE.Group(); g.name = kind + '_placeholder';
  const mesh = (geo, m, x, y, z, rx = 0, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  const legLen = bear ? 0.42 : 0.62, legR = bear ? 0.1 : 0.035, hipY = bear ? 0.6 : 0.8, half = bear ? 0.42 : 0.38, bodyR = bear ? 0.32 : 0.19;
  const hips = new THREE.Group(); hips.position.set(0, hipY, -half); g.add(hips);             // rearing pivots here
  mesh(new THREE.CapsuleGeometry(bodyR, half * 2, 4, 10), coat, 0, bear ? 0.05 : 0.02, half, Math.PI / 2, hips);
  if (!bear) mesh(new THREE.CapsuleGeometry(bodyR * 0.8, half * 1.6, 4, 8), pale, 0, -0.07, half, Math.PI / 2, hips);
  const neck = new THREE.Group(); neck.position.set(0, bear ? 0.08 : 0.12, half * 2 + (bear ? 0.05 : 0.02)); hips.add(neck);   // head-down pivots here
  if (bear) {
    mesh(new THREE.SphereGeometry(0.2, 12, 10), coat, 0, 0.02, 0.2, 0, neck);
    mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.2, 10), pale, 0, -0.03, 0.38, Math.PI / 2, neck);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.06, 8, 6), coat, s * 0.13, 0.19, 0.16, 0, neck);
  } else {
    mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 8), coat, 0, 0.2, 0.08, -0.55, neck);
    mesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), coat, 0, 0.4, 0.26, Math.PI / 2 - 0.3, neck);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.05, 0.16, 0.02), coat, s * 0.1, 0.52, 0.18, 0, neck).rotation.z = s * -0.5;
  }
  const legs = [];
  const leg = (x, y, z, parent) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); mesh(new THREE.CapsuleGeometry(legR, legLen - legR * 2, 4, 6), coat, 0, -legLen / 2, 0, 0, p); legs.push(p); return p; };
  const lx = bear ? 0.17 : 0.09;
  leg(lx, 0, half * 2 - 0.05, hips); leg(-lx, 0, half * 2 - 0.05, hips);                    // front (ride the hips when rearing)
  leg(lx, hipY, -half + 0.05, g); leg(-lx, hipY, -half + 0.05, g);                          // hind
  mesh(bear ? new THREE.SphereGeometry(0.05, 6, 5) : new THREE.BoxGeometry(0.07, 0.16, 0.03), bear ? coat : dark, 0, hipY + (bear ? 0.05 : 0.02), -half - (bear ? 0.3 : 0.2), 0.4);
  return { group: g, hips, neck, legs, legLen, st: { phase: 0, head: 0, rear: 0, sway: 0 } };
}
function posePlaceholder(ph, a, dt) {
  const S = ph.st, bear = a.kind === 'bear', v = a.speed;
  const stride = (bear ? 1.3 : v > 3 ? 3.6 : 0.95) * a.scale;
  S.phase = (S.phase + (dt * v) / stride) % 1;
  const amp = Math.min(0.75, 0.25 + v * 0.08) * sstep(0.05, 0.3, v), s = Math.sin(S.phase * Math.PI * 2) * amp;
  const L = ph.legs; L[0].rotation.x = s; L[1].rotation.x = -s; L[2].rotation.x = -s; L[3].rotation.x = s;
  const act = a.act, still = v < 0.3;
  const head = still && (act === 'graze' || act === 'forage') ? 1.0 : still && act === 'huff' ? 0.45 : act === 'alert' ? -0.35 : 0;
  S.head = damp(S.head, head, 5, dt); S.rear = damp(S.rear, act === 'rear' && still ? 1 : 0, 3.5, dt);
  S.sway += dt * 3;
  ph.neck.rotation.set(S.head, act === 'huff' ? Math.sin(S.sway) * 0.35 : 0, 0);
  ph.hips.rotation.x = -1.05 * S.rear;
  L[0].rotation.x += 0.9 * S.rear; L[1].rotation.x += 0.9 * S.rear;
}

/**
 * hooks = { isPlay(): bool, night(): bool, dog(): the dog handle or null ({ position: Vector3, tamed, name }), hurt(amount 0..1, why),
 *           fear(amount 0..1): called EVERY FRAME with the bear's sustained fear while it's near (brain.fearLevel > 0), and
 *             once with a one-off jolt (0.6 a bluff, 1 a blow) — max-combine it with the rest and let it decay,
 *           say(text), toast(text, s), sfx(name, positionVector3, volume), weeperNear(): Vector3|null,
 *           weeperTriggered(): bool (optional), rain(): 0..1 (optional; default engine.sky.weather.rain), dogSwat() (optional),
 *           scare({ shake 0..1, seconds, fov: -degrees, heartbeat: bool }) (optional): a jolt — a charge starting, a blow, the
 *             stalker closing in, eyes in the beam,
 *           dogWhine(positionVector3) (optional): the tamed dog whimpers (while the bear stalks you),
 *           rng(): 0..1 (optional; tests pass a seeded one) }
 * Reads, if they're there: engine.camera (getWorldDirection: where you look), engine.lights.flashlight (.on, .isLit(pos)),
 * engine.lights.searchlight (.on, .isLit(pos), .worldOrigin()), engine.player.offTrail.
 */
export async function createWildlife(engine, hooks = {}) {
  const W = engine.world, scene = engine.scene;
  const H = {
    isPlay: () => true, night: () => false, dog: () => null, hurt: () => {}, fear: () => {}, say: () => {}, toast: () => {},
    sfx: () => {}, weeperNear: () => null, weeperTriggered: () => false, rain: null, dogSwat: null, scare: null, dogWhine: null, rng: null, ...hooks,
  };
  const P = resolvePlaces(W.layout || {});
  const brain = new WildlifeBrain({
    ground: (x, z) => W.heightAt(x, z), rect: W.rect, ravine: P.ravine, rock: P.rock, tower: P.tower, shed: P.shed,
    deerGroups: P.deerGroups, bearSpots: P.bearSpots, shedSpots: P.shedSpots, route: P.route, rng: H.rng || undefined,
  });
  const tower = { x: P.tower[0], z: P.tower[1] };

  // ---------------------------------------------------------------- views
  const group = new THREE.Group(); group.name = 'wildlife'; scene.add(group);
  const views = brain.animals.map((a) => {
    const root = new THREE.Group(); root.name = 'wild:' + a.id; root.rotation.order = 'YXZ'; root.scale.setScalar(a.scale);
    group.add(root);
    return { a, root, model: null, mixer: null, actions: {}, w: {}, tw: {}, dur: {}, stride: { walk: 1, run: 3 }, phase: 0, ph: null, lodN: 0, acc: 0, lean: 0,
      bear: a.kind === 'bear', dc: Infinity, roll: 0, agit: 0, neck: null, head: null, hsign: 1, eyes: null, nq: null, hq: null, off: false };
  });
  const bearView = views.find((v) => v.bear) || null;
  const kinds = {};
  async function loadKind(kind) {
    const e = engine.manifest && engine.manifest.models && engine.manifest.models['char_' + kind];
    if (!e) return null;
    try { return await loadGLB('assets/' + e.path); } catch (err) { console.warn(kind + ' model', err); return null; }
  }
  function attach(v, gltf) {
    const kind = v.a.kind;
    if (!gltf) {
      v.ph = placeholder(kind); v.root.add(v.ph.group);
      if (v.bear) v.eyes = makeEyes(v.ph.neck, EYES.placeholder, v.a.scale);
      return;
    }
    const model = cloneSkinned(gltf.scene);
    const sp = SPHERE[kind];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      if (o.isSkinnedMesh) {   // r160 culls a SkinnedMesh by its own boundingSphere: one that covers every pose (the bear rears to ~1.9 m)
        o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, sp[0], 0), sp[1]);
        if (!o.geometry.boundingSphere || o.geometry.boundingSphere.radius < sp[1]) o.geometry.boundingSphere = o.boundingSphere.clone();
        const m = o.material; if (m && m.map) m.map.anisotropy = 4;
      }
    });
    let K = kinds[kind];
    if (!K) {
      const t = trimClips(gltf.animations || [], model);
      // metres per gait cycle: measured off the clips; WILD.stride (the builders' logged numbers) if that can't tell, or if
      // the measurement is wildly off it (a broken rig should not send the feet skating either way)
      const ST = WILD.stride[kind], clip = (n) => (gltf.animations || []).find((c) => c.name === n);
      const pick = (n) => { let m = null; try { m = measureStride(gltf.scene, clip(n)); } catch (err) { m = null; } return m && m > ST[n] * 0.6 && m < ST[n] * 1.6 ? m : ST[n]; };
      // bones some clip rotates: the mixer rewrites them every update, so an offset added after it can't accumulate
      const quat = new Set(); for (const c of t.clips) for (const tr of c.tracks) if (tr.name.endsWith('.quaternion')) quat.add(tr.name.slice(0, -11));
      K = kinds[kind] = { byName: new Map(t.clips.map((c) => [c.name, c])), fixed: t.fixed, compiled: false, stride: { walk: pick('walk'), run: pick('run') }, quat, hsign: 0 };
    }
    for (const [bone, prop, ref] of K.fixed) { const b = model.getObjectByName(bone); if (b) b[prop].set(ref[0], ref[1], ref[2]); }
    if (v.bear) {
      const neck = model.getObjectByName('neck'), head = model.getObjectByName('head');
      if (neck && head && K.quat.has('neck')) {
        if (!K.hsign) {   // which way about the neck's local x lowers the head (measured once on the rest pose)
          model.updateMatrixWorld(true); const y0 = head.getWorldPosition(_mv).y, q0 = neck.quaternion.clone();
          neck.quaternion.multiply(_q.setFromAxisAngle(_X, 0.2)); model.updateMatrixWorld(true);
          K.hsign = head.getWorldPosition(_mv).y < y0 ? 1 : -1; neck.quaternion.copy(q0);
        }
        v.neck = neck; v.head = K.quat.has('head') ? head : null; v.hsign = K.hsign; v.nq = new THREE.Quaternion(); v.hq = new THREE.Quaternion();
      }
      if (head) { model.updateMatrixWorld(true); v.eyes = makeEyes(head, EYES.bear, head.getWorldScale(_mv).x * v.a.scale); }
    }
    v.mixer = new THREE.AnimationMixer(model);
    for (const n of CLIPS[kind]) {
      const clip = K.byName.get(n); if (!clip) continue;
      const act = v.mixer.clipAction(clip); act.play(); act.setEffectiveWeight(n === 'idle' ? 1 : 0);
      if (n === 'walk' || n === 'run') act.timeScale = 0;   // phase-locked to the ground speed instead
      v.actions[n] = act; v.w[n] = n === 'idle' ? 1 : 0; v.dur[n] = clip.duration || 1;
    }
    v.stride.walk = K.stride.walk; v.stride.run = K.stride.run;
    v.model = model; v.root.add(model);
    if (!K.compiled && !engine.noRender && engine.renderer && engine.renderer.compileAsync && engine.camera) {
      K.compiled = true;
      try { engine.renderer.compileAsync(model, engine.camera, scene).catch(() => {}); } catch (err) { /* compiles on first sight instead */ }
    }
  }
  const ready = (async () => {
    const [bear, deer] = await Promise.all([loadKind('bear'), loadKind('deer')]);
    for (const v of views) attach(v, v.a.kind === 'bear' ? bear : deer);
  })();

  // ---------------------------------------------------------------- per frame (allocation-free)
  const ctx = { player: [0, 0, 0], vel: [0, 0], jog: false, playerSafe: false, indoor: false, night: false, rain: 0, weeper: null, weeperTriggered: false, dog: null,
    look: null, torch: false, lit: false, litFrom: null, offTrail: null };
  const dogCtx = { pos: [0, 0, 0], tamed: false }, wpos = [0, 0, 0], look = [0, 1], eyeW = [0, 0, 0], litSrc = [0, 0, 0];
  const vpool = []; for (let i = 0; i < 16; i++) vpool.push(new THREE.Vector3());
  const _fw = new THREE.Vector3(), _ev = new THREE.Vector3();
  let vi = 0, litN = 0;
  const vec = (x, y, z) => { const q = vpool[vi]; vi = (vi + 1) % vpool.length; return q.set(x, y, z); };
  /** Is a light on the bear's eyes right now (at night): the flashlight (its cone reaches 30 m) or the searchlight's beam?
   *  Sets ctx.lit / ctx.litFrom. A cheap cone test first; the lights' own isLit (line of sight) only when that passes. */
  function lightCheck() {
    ctx.lit = false; ctx.litFrom = null;
    // (only where it's drawn: the searchlight reaches 600 m, and eyes you can't see must not bring the jolt and the line)
    if (!bearView || !ctx.night || !(bearView.dc < WILD.hideRange)) return;
    const L = engine.lights, FL = L && L.flashlight, SL = L && L.searchlight, cam = engine.camera;
    brain.eyePos(bearView.a, eyeW); _ev.set(eyeW[0], eyeW[1], eyeW[2]);
    try {
      if (FL && FL.on && cam && ctx.look) {
        const cp = cam.position, dx = _ev.x - cp.x, dy = _ev.y - cp.y, dz = _ev.z - cp.z, dd = Math.hypot(dx, dy, dz);
        if (dd < 31 && (dx * _fw.x + dy * _fw.y + dz * _fw.z) > dd * 0.9 && FL.isLit(_ev)) { ctx.lit = true; litSrc[0] = cp.x; litSrc[1] = cp.y; litSrc[2] = cp.z; ctx.litFrom = litSrc; return; }
      }
      if (SL && SL.on && SL.isLit(_ev)) {
        ctx.lit = true;
        const o = typeof SL.worldOrigin === 'function' ? SL.worldOrigin() : null;
        if (o) { litSrc[0] = o.x; litSrc[1] = o.y; litSrc[2] = o.z; ctx.litFrom = litSrc; }
      }
    } catch (err) { ctx.lit = false; ctx.litFrom = null; }   // a light without its view / world: not lit
  }
  function update(dt, t) {
    if (!H.isPlay() || !(dt > 0)) return;
    const Pl = engine.player, p = Pl.position;
    ctx.player[0] = p.x; ctx.player[1] = p.y; ctx.player[2] = p.z;
    ctx.vel[0] = Pl.velocity ? Pl.velocity.x : 0; ctx.vel[1] = Pl.velocity ? Pl.velocity.z : 0;
    ctx.jog = !!(engine.input && engine.input.isDown && engine.input.isDown('jog')) && !(Pl.stamina <= 0.05);
    const zone = Pl.zone, gy = W.heightAt(p.x, p.z);
    ctx.playerSafe = zone === 'cab' || zone === 'catwalk' || zone === 'stairs' || (Math.abs(p.x - tower.x) < 7.5 && Math.abs(p.z - tower.z) < 7.5) || (!!Pl.onStructure && p.y > gy + 1.2);
    ctx.indoor = zone === 'cab';
    ctx.night = !!H.night();
    ctx.rain = H.rain ? +H.rain() || 0 : engine.sky && engine.sky.weather ? +engine.sky.weather.rain || 0 : 0;
    const w = H.weeperNear();
    if (w) { wpos[0] = w.x; wpos[1] = w.y; wpos[2] = w.z; ctx.weeper = wpos; } else ctx.weeper = null;
    ctx.weeperTriggered = !!H.weeperTriggered();
    const d = H.dog();
    if (d && d.position) { dogCtx.pos[0] = d.position.x; dogCtx.pos[1] = d.position.y; dogCtx.pos[2] = d.position.z; dogCtx.tamed = !!d.tamed; ctx.dog = dogCtx; } else ctx.dog = null;
    // what the stalker reads off you: where you're looking, the torch, how far off the trail; and (20x a second) any light on its eyes
    const cam = engine.camera;
    ctx.look = null;
    if (cam && typeof cam.getWorldDirection === 'function') { cam.getWorldDirection(_fw); const h = Math.hypot(_fw.x, _fw.z); if (h > 1e-3) { look[0] = _fw.x / h; look[1] = _fw.z / h; ctx.look = look; } }
    ctx.torch = !!(engine.lights && engine.lights.flashlight && engine.lights.flashlight.on);
    ctx.offTrail = Number.isFinite(Pl.offTrail) ? Pl.offTrail : null;
    if (--litN <= 0) { litN = 3; lightCheck(); }
    const evs = brain.update(dt, ctx);
    for (let i = 0; i < evs.length; i++) onEvent(evs[i]);
    if (brain.fearLevel > 0.005) H.fear(brain.fearLevel);   // sustained: every frame it's near
    // bodies: hidden past hideRange; posed every frame close up, 1 frame in lodEvery past lodNear
    const cp = cam ? cam.position : p;
    for (let i = 0; i < views.length; i++) {
      const v = views[i], a = v.a, R = v.root;
      R.position.set(a.pos[0], a.pos[1], a.pos[2]);
      v.lean = damp(v.lean, a.speed > 0.05 ? Math.max(-0.45, Math.min(0.45, Math.atan(a.slope || 0) * 0.8)) : 0, 6, dt);
      R.rotation.set(-v.lean, a.yaw, v.roll);
      const dc = Math.hypot(cp.x - a.pos[0], cp.y - a.pos[1], cp.z - a.pos[2]);
      const vis = dc < WILD.hideRange;
      R.visible = vis; v.dc = dc;
      if (v.eyes) eyesUpdate(v, dt, dc, vis);
      if (!vis) { v.acc = 0; v.lodN = 0; continue; }
      const every = dc < WILD.lodNear ? 1 : WILD.lodEvery;
      v.acc += dt;
      if (++v.lodN >= every) { v.lodN = 0; animate(v, Math.min(v.acc, 0.25)); v.acc = 0; }
    }
  }
  /** The glints: on the instant a light finds its eyes, fading as it turns away; sized in metres to stay a couple of pixels
   *  at 30 m without swelling into one blob close up, and past 30 m (the searchlight's reach) growing with the distance so
   *  they stay a couple of pixels out to where the bear is hidden. */
  function eyesUpdate(v, dt, dc, vis) {
    const E = v.eyes, want = vis ? v.a.eyes || 0 : 0;
    E.k = want >= E.k ? want : damp(E.k, want, 14, dt);
    const on = E.k > 0.02;
    if (on) {
      E.mat.opacity = Math.min(1, E.k);
      const s = (dc < 30 ? 0.03 + dc * 0.0027 : dc * 0.0037) / E.unit;
      for (let i = 0; i < E.spr.length; i++) { E.spr[i].visible = true; E.spr[i].scale.set(s, s, 1); }
    } else if (E.spr[0].visible) for (let i = 0; i < E.spr.length; i++) E.spr[i].visible = false;
  }
  /** Heavy footfalls ('bear_step') as the run clip's feet come down (phase a -> b), while it runs within stepRange of you. */
  function footfalls(v, a, b, fast) {
    const A = v.a, B = WILD.bear;
    if (!v.bear || fast < 0.5 || v.dc > B.stepRange || A.speed < 1) return;
    const s = A.scale, sy = Math.sin(A.yaw), cy = Math.cos(A.yaw);
    for (let i = 0; i < FOOT.length; i++) {
      const F = FOOT[i], fz = F[2];
      if (!crossed(a, b, F[0])) continue;
      const x = F[1] * s, z = fz * s;
      H.sfx('bear_step', vec(A.pos[0] + cy * x + sy * z, A.pos[1] + 0.05, A.pos[2] - sy * x + cy * z), B.stepVol * (0.6 + 0.4 * Math.min(1, fast)) * (fz > 0 ? 1 : 0.85));
    }
  }
  function animate(v, dt) {
    const a = v.a;
    if (v.ph) {
      const p0 = v.ph.st.phase;
      posePlaceholder(v.ph, a, dt);
      if (v.bear) footfalls(v, p0, v.ph.st.phase, sstep(GAIT.bear[2], GAIT.bear[3], a.speed));
      return;
    }
    if (!v.mixer) return;
    const kind = a.kind, G = GAIT[kind], sp = a.speed, A = v.actions, names = CLIPS[kind], pose = POSE[kind];
    const moving = sstep(G[0], G[1], sp), fast = sstep(G[2], G[3], sp), still = 1 - moving;
    const posed = pose[a.act] === 1;
    const T = v.tw;
    let spare = 0;
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      const tw = n === 'walk' ? moving * (1 - fast) : n === 'run' ? moving * fast : n === 'idle' ? (posed ? 0 : still) : a.act === n ? still : 0;
      if (A[n]) T[n] = tw; else { T[n] = 0; spare += tw; }
    }
    if (A.idle) T.idle += spare;   // a clip the model doesn't have: stand instead
    for (let i = 0; i < names.length; i++) { const n = names[i]; if (!A[n]) continue; v.w[n] = damp(v.w[n], T[n], 1 / 0.3, dt); A[n].setEffectiveWeight(snapW(v.w[n])); }
    const stride = (v.stride.walk + (v.stride.run - v.stride.walk) * fast) * a.scale;   // metres per cycle at this size: no skating
    const p0 = v.phase;
    v.phase = (v.phase + (dt * sp) / Math.max(0.05, stride)) % 1;
    if (A.walk) A.walk.time = v.phase * v.dur.walk;
    if (A.run) A.run.time = v.phase * v.dur.run;
    // take last frame's head-down offset back off first: three's mixer only rewrites a bone whose blended clip value
    // CHANGED since its last update (PropertyMixer.apply), so on a held key an offset left on the bone would compound
    if (v.off) { v.neck.quaternion.copy(v.nq); if (v.head) v.head.quaternion.copy(v.hq); v.off = false; }
    v.mixer.update(dt);
    if (!v.bear) return;
    footfalls(v, p0, v.phase, moving * fast);
    // a heavy animal's walk: its weight rolls side to side over each stride
    v.roll = Math.sin(v.phase * Math.PI * 2) * 0.035 * moving * (1 - fast);
    // worked up: head low, eyes level (the neck drops, the head tips back up); never while it's up on its hind legs
    v.agit = damp(v.agit, a.act === 'rear' ? 0 : a.agit || 0, 4, dt);
    if (v.neck && v.agit > 0.01) {
      v.nq.copy(v.neck.quaternion); if (v.head) v.hq.copy(v.head.quaternion); v.off = true;
      v.neck.quaternion.multiply(_q.setFromAxisAngle(_X, v.hsign * HEAD_DOWN[0] * v.agit));
      if (v.head) v.head.quaternion.multiply(_q.setFromAxisAngle(_X, v.hsign * HEAD_DOWN[1] * v.agit));
    }
  }
  const dogName = () => { const d = H.dog(); return (d && d.name) || 'the dog'; };
  const fill = (s) => (s && s.indexOf('{dog}') >= 0 ? s.split('{dog}').join(dogName()) : s);
  function onEvent(e) {
    switch (e.type) {
      case 'sfx': H.sfx(e.name, vec(e.pos[0], e.pos[1], e.pos[2]), e.volume); break;
      case 'hurt': H.hurt(e.amount, e.why); break;
      case 'fear': H.fear(e.amount); break;
      case 'say': H.say(fill(e.text)); break;
      case 'toast': H.toast(fill(e.text), e.s); break;
      case 'dogSwat': if (H.dogSwat) H.dogSwat(); break;
      case 'scare': if (H.scare) H.scare({ shake: e.shake, seconds: e.s, fov: e.fov, heartbeat: e.beat }); break;
      case 'dogWhine': if (H.dogWhine) H.dogWhine(vec(e.pos[0], e.pos[1], e.pos[2])); break;
      default: break;
    }
  }
  function snapViews() {
    for (const v of views) {
      const a = v.a; v.root.position.set(a.pos[0], a.pos[1], a.pos[2]); v.root.rotation.set(0, a.yaw, 0); v.lean = 0; v.phase = 0; v.roll = 0; v.agit = 0;
      if (v.eyes) { v.eyes.k = 0; for (const s of v.eyes.spr) s.visible = false; }
      if (v.ph) { v.ph.st.head = 0; v.ph.st.rear = 0; }
      for (const n in v.w) v.w[n] = n === 'idle' ? 1 : 0;
    }
  }

  const handles = views.map((v) => ({
    id: v.a.id, kind: v.a.kind, role: v.a.role, root: v.root, position: v.root.position, rules: v.a,
    get act() { return v.a.act; },
    get state() { return v.a.kind === 'bear' ? v.a.state : v.a.group.state; },
    get placeholder() { return !!v.ph; },
  }));
  const api = {
    ready: ready.then(() => api),
    brain, root: group, animals: handles, _views: views,   // (_views: the per-animal view state, for tests)
    deer: handles.filter((h) => h.kind === 'deer'),
    bear: handles.find((h) => h.kind === 'bear') || null,
    update,
    /** Metres per gait cycle in use for each loaded kind (measured off the clips, else WILD.stride). */
    get strides() { const o = {}; for (const k in kinds) o[k] = { ...kinds[k].stride }; return o; },
    /** True while the ambient calls are hushed (the Weeper near or coming): the lead can hush other forest sounds with it. */
    get silent() { return brain.amb.silent; },
    /** The bear's sustained fear this frame, 0..1 (also sent to hooks.fear every frame it's above 0). */
    get fearLevel() { return brain.fearLevel; },
    /** The nearest deer to a Vector3 within maxDist (e.g. for the dog), or null. */
    nearestDeer(pos, maxDist = Infinity) {
      let best = null, bd = maxDist;
      for (let i = 0; i < handles.length; i++) { const h = handles[i]; if (h.kind !== 'deer') continue; const q = h.rules.pos, dd = Math.hypot(q[0] - pos.x, q[1] - pos.y, q[2] - pos.z); if (dd < bd) { bd = dd; best = h; } }
      return best;
    },
    /** The generator sputtering at the shed draws the bear up tonight (brain.callToShed, e.g. { delay: 15 }); the view says
     *  whether you can see it now (in frustum, not behind terrain or trees), since only an unseen bear may be moved closer. */
    callToShed(o = {}) {
      let hidden = true;
      try { if (bearView && engine.view && engine.view.check) hidden = !engine.view.check({ root: bearView.root, faceAnchor: () => null }).visible; } catch (err) { hidden = true; }
      return brain.callToShed({ ...o, hidden });
    },
    toJSON: () => brain.toJSON(),
    restore(json) { brain.restore(json); snapViews(); },
    /** New game: everyone back home, calm, nothing said yet. */
    reset() { brain.reset(); snapViews(); },
    dispose() { scene.remove(group); for (const v of views) if (v.mixer) v.mixer.stopAllAction(); },
  };
  snapViews();
  await ready;
  return api;
}
