// FALSE LIGHT — chill spots, the engine half: puts the log benches (and the camp chair on the catwalk) in the world,
// registers "E — Sit and rest a while", and while you sit: the camera settles to seated eye height, you can look
// around but not walk, the clock runs 8x (if the game allows), fear and CO ease off, and each spot's quiet line
// appears once. Any movement key, E or Esc (if the game wires it) gets you up. The rules live in chillSpots.js (pure).
import * as THREE from 'three';
import { CHILL_SPOTS, SEAT, SIT, ChillRules, seatFor, localToWorld, rotYFromBearing, facingFromBearing, mapSpots, canReach } from './chillSpots.js?v=fa183c0e';

export { CHILL_SPOTS, mapSpots };

const ease = (k) => k * k * (3 - 2 * k);

/**
 * hooks: { isPlay(), walkMode(), setSitting(bool), setTimeScale(k), calm(dt), toast(text, s), say(text),
 *          danger?() -> bool (stand up now, and no sitting down: the prompt reads "Too on edge to sit" and E does
 *          nothing; e.g. the Weeper is up), canFastForward?() -> bool (false = keep 1x,
 *          e.g. the radio is talking or a clock gate is holding), isNight?() -> bool, seen?: [spot ids already told],
 *          ownInteract?: false when the game's own E handler calls chill.stand() while chill.sitting (recommended:
 *          then E that closes a map you opened while sitting doesn't also get you up) }
 */
export function createChill(engine, hooks = {}) {
  const H = {
    isPlay: () => true, walkMode: () => true, setSitting() {}, setTimeScale() {}, calm() {}, toast() {}, say() {},
    danger: () => false, canFastForward: () => true, isNight: null, ownInteract: true, ...hooks,
  };
  const W = engine.world, P = engine.player, cam = engine.camera, In = engine.input;
  const rules = new ChillRules(CHILL_SPOTS, hooks.seen || []);
  const night = () => (H.isNight ? !!H.isNight() : engine.sky ? engine.sky.dayFactor < 0.3 : false);

  // ground: benches sit at the mean height under their two stumps and their middle (stumps are sunk 0.1 m)
  const spots = CHILL_SPOTS.map((s) => {
    let y = s.pos[1];
    if (s.kind === 'bench' && W.heightAt) {
      const hs = [-0.6, 0, 0.61].map((lx) => { const p = localToWorld(s, [lx, 0, 0]); return W.heightAt(p[0], p[2]); });
      y = hs.reduce((a, b) => a + b, 0) / hs.length;
    }
    return { ...s, pos: [s.pos[0], y, s.pos[2]], rotY: rotYFromBearing(s.bearing), facing: facingFromBearing(s.bearing) };
  });
  const byId = new Map(spots.map((s) => [s.id, s]));

  // ------------------------------------------------------------------ props
  const roots = new Map();
  function fallbackProp(s) {   // until the GLBs are imported: plain shapes, and a wall collider for the bench
    const g = new THREE.Group(); g.position.set(...s.pos); g.rotation.y = s.rotY;
    const bark = new THREE.MeshStandardMaterial({ color: 0x5e554c, roughness: 0.95 }), top = new THREE.MeshStandardMaterial({ color: 0x8d877d, roughness: 0.85 });
    const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    if (s.kind === 'bench') {
      add(new THREE.CylinderGeometry(0.2, 0.2, 1.84, 16, 1, false, Math.PI / 2, Math.PI), bark, 0, 0.44, 0, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(1.84, 0.02, 0.4), top, 0, 0.45, 0);
      for (const x of [-0.6, 0.61]) add(new THREE.CylinderGeometry(0.2, 0.25, 0.37, 14), bark, x, 0.085, 0);
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.52, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
      col.name = 'COL_wall_log_bench'; col.position.set(0, 0.26, 0); col.visible = false; g.add(col);
      W.colliders && W.colliders.push({ name: col.name, type: 'wall', mesh: col, enabled: true });
    } else {
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.7 }), canvas = new THREE.MeshStandardMaterial({ color: 0x6b6a45, roughness: 0.95, side: THREE.DoubleSide });
      for (const [x, z, h] of [[-0.26, 0.2, 0.64], [0.26, 0.2, 0.64], [-0.26, -0.2, 0.87], [0.26, -0.2, 0.87]]) add(new THREE.BoxGeometry(0.034, h, 0.034), wood, x, h / 2, z);
      add(new THREE.BoxGeometry(0.48, 0.01, 0.4), canvas, 0, 0.42, 0);
      add(new THREE.BoxGeometry(0.52, 0.2, 0.01), canvas, 0, 0.73, -0.22);
    }
    engine.scene.add(g); g.updateMatrixWorld(true);
    return g;
  }
  let disposed = false;
  function removeProps(list) {   // the props, their COL_ boxes in the world's colliders (else invisible walls stay), surfaces
    const mine = new Set(); for (const r of list) r.traverse((o) => mine.add(o));
    if (W.colliders) for (let i = W.colliders.length - 1; i >= 0; i--) if (mine.has(W.colliders[i].mesh)) W.colliders.splice(i, 1);
    if (W.modelRoots) for (let i = W.modelRoots.length - 1; i >= 0; i--) if (mine.has(W.modelRoots[i])) W.modelRoots.splice(i, 1);
    for (const r of list) if (r.parent) r.parent.remove(r);
  }
  const ready = Promise.all(spots.map(async (s) => {
    const S = SEAT[s.kind];
    let root = null;
    try { root = W.addModel ? await W.addModel(S.model, new THREE.Vector3(...s.pos), s.rotY, 1) : null; } catch (e) { root = null; }
    if (!root) root = fallbackProp(s);
    root.name = 'chill:' + s.id;
    if (disposed) { removeProps([root]); return; }   // disposed while the GLB was still loading
    roots.set(s.id, root);
  })).then(() => { if (P && P.rebuildColliders) P.rebuildColliders(); return api; });

  // ------------------------------------------------------------------ sitting
  let seat = null, blend = 0, blendTarget = 0, justSat = false;
  const eyeV = new THREE.Vector3(), standV = new THREE.Vector3();
  // the body is put on the stand point at once; the camera glides there from where your head was (no pop)
  const fromV = new THREE.Vector3(), offV = new THREE.Vector3();
  let offPending = false, offT = 1, inDur = SIT.blendIn;
  const danger = () => !!H.danger();
  const canSitNow = () => !rules.sitting && H.isPlay() && H.walkMode() && !danger();

  function apply(evs) {
    for (const e of evs) {
      if (e.type === 'stand') {
        blendTarget = 0;
        if (e.reason === 'state' || e.reason === 'mode' || e.reason === 'moved') { blend = 0; offT = 1; offPending = false; }   // the game is taking the camera
        H.setSitting(false);
        if (e.reason !== 'mode' && e.reason !== 'state' && H.walkMode() && !engine.uiBlocking) P.setEnabled(true);
      } else if (e.type === 'timeScale') H.setTimeScale(e.k);
      else if (e.type === 'line') H.say(e.text);
      else if (e.type === 'hint') H.toast(e.text, 4);
      else if (e.type === 'calm') H.calm(e.dt);
    }
  }
  function sit(id) {
    const s = byId.get(id); if (!s) return false;
    if (!canSitNow()) return false;
    const from = [P.position.x, P.position.y, P.position.z];
    const ev = rules.sit(id); if (!ev.length) return false;
    seat = seatFor(s, from, s.pos);
    justSat = true;   // cleared on the next frame: the E press that sat you down must not also stand you up
    fromV.copy(cam.position); offPending = true; offT = 0; blend = 0;   // (re-sitting mid stand-up: start from where the head is)
    // a longer way to the seat takes a little longer (0.75 s from the stand point, ~1.2 s from 3 m off)
    inDur = SIT.blendIn + 0.2 * Math.min(3, Math.max(0, fromV.distanceTo(eyeV.set(...seat.eye)) - 1));
    // the body stands just in front of the seat (clear of the bench's collider); the camera sits
    const sy = s.kind === 'bench' && W.heightAt ? W.heightAt(seat.stand[0], seat.stand[2]) : seat.stand[1];
    P.position.set(seat.stand[0], sy, seat.stand[2]);
    if (P.velocity) P.velocity.set(0, 0, 0);
    P.setEnabled(false);
    H.setSitting(true);
    P.lookAt(new THREE.Vector3(...seat.look), 0.9);
    standV.set(seat.stand[0], sy, seat.stand[2]);
    blendTarget = 1;
    apply(ev);
    return true;
  }
  function stand(reason = 'input') { apply(rules.stand(reason)); }

  // the prompt on every seat
  const offs = spots.map((s) => {
    const S = SEAT[s.kind];
    const anchor = new THREE.Vector3(...localToWorld(s, [0, S.top + 0.04, 0]));
    // the Weeper up and about (danger): the seat still answers, but you can't make yourself sit
    return engine.interact.register({
      id: 'chill:' + s.id, anchor, label: () => (danger() ? 'Too on edge to sit' : S.label), radius: s.kind === 'bench' ? 0.95 : 0.45, reach: 2.4,
      enabled: () => !rules.sitting && H.isPlay() && H.walkMode() && canReach(s, P.position.x, P.position.y, P.position.z),
      onUse: () => sit(s.id),
    });
  });
  // E gets you up (the press that sat you down doesn't count)
  const offKey = In.onAction('interact', (d) => {
    if (!H.ownInteract || !d || !rules.sitting || engine.uiBlocking) return;
    if (justSat) return;
    stand('input');
  });

  const tickCtx = { play: true, walk: true, danger: false, moving: false, fastOK: true, night: false };   // reused every frame
  const offUpd = engine.onUpdate((dt, t) => {
    justSat = false;
    if (rules.sitting) {
      const play = H.isPlay(), walk = H.walkMode();
      // something else moved the body (a phase change, a retry): don't leave the camera on the bench. If the game has
      // also left play / walk mode, that wins (reason 'state' / 'mode': the game keeps the player the way it set it).
      if (play && walk && P.position.distanceToSquared(standV) > 2.25) apply(rules.stand('moved'));
      else {
        tickCtx.play = play; tickCtx.walk = walk; tickCtx.danger = danger();
        // behind a modal (map, logbook) the keys aren't yours to move with: they don't get you up
        tickCtx.moving = !engine.uiBlocking && (In.isDown('forward') || In.isDown('back') || In.isDown('left') || In.isDown('right'));
        tickCtx.fastOK = H.canFastForward() !== false; tickCtx.night = night();
        apply(rules.tick(dt, tickCtx));
      }
    }
    // cam.position is the standing head the player just set (at the stand point); lean it into the seat
    if (offPending) { offPending = false; offV.subVectors(fromV, cam.position); if (offV.lengthSq() > 36) offV.set(0, 0, 0); }
    const dur = blendTarget ? inDur : SIT.blendOut;
    blend = blendTarget ? Math.min(1, blend + dt / dur) : Math.max(0, blend - dt / dur);
    if (seat && blend > 1e-4) {
      const k = ease(blend);
      eyeV.set(seat.eye[0], seat.eye[1] + (rules.sitting ? Math.sin(t * 1.3) * 0.004 * k : 0), seat.eye[2]);   // a breath
      cam.position.lerp(eyeV, k);
    }
    // the body jumped to the stand point when you sat; the head didn't. Add back where it was and fade that out on the
    // same curve, so the view goes in a straight line from your head to the seat and never pops.
    if (offT < 1) { offT = Math.min(1, offT + dt / inDur); cam.position.addScaledVector(offV, 1 - ease(offT)); }
    if (!rules.sitting && blend <= 0) seat = null;
  });

  const api = {
    /** For the map: [{ id, name, kind, pos: [x, y, z], facing: [fx, fz], bearing }] */
    spots: mapSpots(spots),
    list: spots,
    ready,
    roots,
    get sitting() { return rules.sitting; },
    get seated() { return blend; },
    get timeScale() { return rules.scale; },
    sit, stand,
    get seen() { return rules.seen; },
    load(arr) { rules.seen = new Set(arr || []); },
    toJSON() { return rules.toJSON(); },
    rules,
    dispose() {
      if (rules.sitting) stand('state');
      if (disposed) return;
      disposed = true;
      offs.forEach((f) => f()); offKey(); offUpd();
      removeProps([...roots.values()]); roots.clear();
      if (P && P.rebuildColliders) P.rebuildColliders();
    },
  };
  return api;
}
