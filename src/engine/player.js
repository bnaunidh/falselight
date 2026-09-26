// FALSE LIGHT — first-person player: walking/jogging, capsule vs COL_wall OBBs, ground from the heightfield and
// raycasts onto COL_floor/COL_ramp (stairs climb smoothly), the trail-corridor rule, head bob, footsteps.
import * as THREE from 'three';
import { clamp, damp } from './util.js?v=8547b0d4';

const EYE = 1.65, RADIUS = 0.3, STEP = 0.5;

export function createPlayer(engine) {
  const { camera, input } = engine;
  const W = () => engine.world;
  const pos = new THREE.Vector3(0, 0, 8);
  const vel = new THREE.Vector3();
  let yaw = 0, pitch = 0, enabled = true, onGround = true, bob = 0, stepAcc = 0, lookTween = null, fallTop = null;
  const ray = new THREE.Raycaster(); ray.far = 3;
  const down = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  let obbs = null, floorMeshes = [];

  function buildColliders() {
    obbs = []; floorMeshes = [];
    for (const c of W().colliders) {
      c.mesh.updateWorldMatrix(true, false);
      if (c.type === 'wall') {
        const g = c.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox; const ctr = bb.getCenter(new THREE.Vector3()); const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        const m = c.mesh.matrixWorld;
        const sc = new THREE.Vector3(); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc); half.multiply(sc);
        const center = ctr.clone().applyMatrix4(m);
        const rot = new THREE.Matrix4().extractRotation(m); const inv = rot.clone().invert();
        // vertical extent in world
        const corners = []; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(m).y);
        obbs.push({ c, center, half, rot, inv, ymin: Math.min(...corners), ymax: Math.max(...corners), rxz: Math.hypot(half.x, half.y, half.z) });
      } else floorMeshes.push(c);
    }
  }

  function groundAt(x, y, z) {
    // highest supporting surface at or below y+STEP: terrain or a floor/ramp collider
    let g = W().heightAt(x, z), onStructure = false, surface = 'dirt';
    tmp.set(x, y + STEP, z); ray.set(tmp, down); ray.far = STEP + 2.5;
    const cands = floorMeshes.filter((c) => c.enabled !== false).map((c) => c.mesh);
    if (cands.length) {
      const hits = ray.intersectObjects(cands, false);
      for (const h of hits) { if (h.point.y > g - 0.05) { g = h.point.y; onStructure = true; surface = 'wood'; break; } }
    }
    const tr = W().trail.nearest(x, z);
    if (!onStructure && tr.dist < 1.6) surface = 'gravel';
    return { y: g, onStructure, surface, trail: tr };
  }

  function pushOutWalls(p) {
    if (!obbs) return;
    for (const o of obbs) {
      if (o.c.enabled === false) continue;
      if (Math.abs(p.x - o.center.x) > o.rxz + RADIUS || Math.abs(p.z - o.center.z) > o.rxz + RADIUS) continue;
      if (p.y + 1.7 < o.ymin || p.y + 0.25 > o.ymax) continue;
      for (const hgt of [0.35, 1.0, 1.55]) {
        tmp.set(p.x, p.y + hgt, p.z).sub(o.center).applyMatrix4(o.inv);
        const cx = clamp(tmp.x, -o.half.x, o.half.x), cy = clamp(tmp.y, -o.half.y, o.half.y), cz = clamp(tmp.z, -o.half.z, o.half.z);
        tmp2.set(tmp.x - cx, tmp.y - cy, tmp.z - cz);
        // horizontal component only (world), measured in world space
        const dw = tmp2.clone().applyMatrix4(o.rot); dw.y = 0;
        const d = dw.length();
        if (d < RADIUS) {
          if (d > 1e-5) { dw.multiplyScalar((RADIUS - d) / d); p.x += dw.x; p.z += dw.z; }
          else {   // centre inside the box: push out along the shortest local horizontal axis
            const ex = o.half.x - Math.abs(tmp.x), ez = o.half.z - Math.abs(tmp.z);
            const lv = ex < ez ? new THREE.Vector3(Math.sign(tmp.x) * (ex + RADIUS), 0, 0) : new THREE.Vector3(0, 0, Math.sign(tmp.z) * (ez + RADIUS));
            lv.applyMatrix4(o.rot); p.x += lv.x; p.z += lv.z;
          }
        }
      }
    }
  }

  const FOREST_LIMIT = 19.4;   // you can leave the trail up to the wall of trees at ~20 m
  function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) inside = !inside;
    }
    return inside;
  }
  function allowedXZ(x, z) {
    const w = W();
    const rav = w.layout && w.layout.ravine && w.layout.ravine.polygon;
    if (rav && rav.length > 2 && inPoly(x, z, rav)) return false;        // the ravine: never
    for (const zn of w.zones) if ((x - zn.x) ** 2 + (z - zn.z) ** 2 < zn.r * zn.r) return true;
    if (Math.abs(x) < 7.5 && Math.abs(z) < 7.5) return true;           // the fenced tower base
    return w.trail.nearest(x, z).dist <= FOREST_LIMIT;
  }
  function pushOutTrunks(p) {   // tree trunks are solid once you're off the trail
    const w = W(); if (!w.trunkGrid) return;
    const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      for (const t of w.trunkGrid.get(ix + ',' + iz) || []) {
        const r = t[2] * 0.75 + RADIUS, dx = p.x - t[0], dz = p.z - t[1], d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) { p.x = t[0] + (dx / d) * r; p.z = t[1] + (dz / d) * r; }
      }
    }
  }

  const api = {
    position: pos, velocity: vel,
    get yaw() { return yaw; }, set yaw(v) { yaw = v; },
    get pitch() { return pitch; }, set pitch(v) { pitch = v; },
    zone: 'trail', surface: 'dirt', stamina: 1, carrying: null, onStructure: false, freeRoam: false, fly: false,
    speedMul: 1, lookLocked: false,
    teleport(target, y) {
      let v = target;
      if (typeof target === 'string') v = W().anchors.get(target) || W().poi(target);
      if (!v) return false;
      pos.copy(v); if (typeof y === 'number') yaw = y; fallTop = null; onGround = true;
      const g = groundAt(pos.x, pos.y + 0.2, pos.z); pos.y = g.y; vel.set(0, 0, 0); return true;
    },
    setEnabled(b) { enabled = b; },
    get enabled() { return enabled; },
    lookAt(v, seconds = 0) {
      const d = new THREE.Vector3().subVectors(v, camera.position);
      const ty = Math.atan2(-d.x, -d.z), tp = Math.atan2(d.y, Math.hypot(d.x, d.z));
      if (!seconds) { yaw = ty; pitch = tp; return; }
      lookTween = { y0: yaw, p0: pitch, y1: yaw + ((((ty - yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI), p1: tp, t: 0, d: seconds };
    },
    rebuildColliders: buildColliders,
    update(dt) {
      if (!obbs) buildColliders();
      // look
      const [mx, my] = input.consumeMouse();
      if (lookTween) {
        lookTween.t += dt; const k = clamp(lookTween.t / lookTween.d, 0, 1), e = k * k * (3 - 2 * k);
        yaw = lookTween.y0 + (lookTween.y1 - lookTween.y0) * e; pitch = lookTween.p0 + (lookTween.p1 - lookTween.p0) * e;
        if (k >= 1) lookTween = null;
      } else if (!api.lookLocked) {
        yaw -= mx * input.sensitivity; pitch = clamp(pitch - my * input.sensitivity, -1.45, 1.45);
      }
      // move
      let fx = 0, fz = 0;
      if (enabled) {
        if (input.isDown('forward')) fz -= 1; if (input.isDown('back')) fz += 1;
        if (input.isDown('left')) fx -= 1; if (input.isDown('right')) fx += 1;
      }
      const len = Math.hypot(fx, fz) || 1; fx /= len; fz /= len;
      const jog = input.isDown('jog') && !api.carrying && api.stamina > 0.05;
      const sp = (jog ? 3.2 : 1.5) * api.speedMul * (api.carrying ? 0.8 : 1) * (api.onStructure && !jog ? 0.95 : 1) * (api.inWater ? 0.55 : 1);
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const wx = (fx * cos + fz * sin) * sp, wz = (-fx * sin + fz * cos) * sp;
      vel.x = damp(vel.x, wx, 12, dt); vel.z = damp(vel.z, wz, 12, dt);
      api.stamina = clamp(api.stamina + (jog && (fx || fz) ? -dt / 14 : dt / 9), 0, 1);
      const old = pos.clone();
      if (api.fly) {
        const f = new THREE.Vector3(); camera.getWorldDirection(f);
        pos.addScaledVector(f, -fz * sp * 8 * dt); pos.x += (fx * cos) * sp * 8 * dt; pos.z += (-fx * sin) * sp * 8 * dt;
      } else {
        pos.x += vel.x * dt; pos.z += vel.z * dt;
        pushOutWalls(pos);
        pushOutTrunks(pos);
        const g = groundAt(pos.x, pos.y, pos.z);
        // the path rule: off-structure, stay inside the trail corridor or a place's zone
        if (!api.freeRoam && !g.onStructure && !allowedXZ(pos.x, pos.z)) {
          if (allowedXZ(old.x, pos.z)) pos.x = old.x;
          else if (allowedXZ(pos.x, old.z)) pos.z = old.z;
          else { pos.x = old.x; pos.z = old.z; }
          api.blockedByPath = 0.6;
        }
        const g2 = groundAt(pos.x, pos.y, pos.z);
        if (g2.y > pos.y + STEP + 0.05 && !g2.onStructure) { pos.x = old.x; pos.z = old.z; }   // too steep a step
        const target = g2.y;
        // landings report how far you fell (fall damage lives in the game, api.onLand)
        const land = () => { if (fallTop != null) { const drop = fallTop - pos.y, v = -vel.y; fallTop = null; if (drop > 0.9 && api.onLand) api.onLand(drop, v); } };
        if (target >= pos.y - 0.02 || onGround && pos.y - target < 0.6) { pos.y = damp(pos.y, target, 30, dt); land(); vel.y = 0; onGround = true; }
        else {
          if (fallTop == null) fallTop = old.y;
          vel.y -= 9.81 * dt; pos.y += vel.y * dt;
          if (pos.y <= target) { pos.y = target; land(); vel.y = 0; onGround = true; } else onGround = false;
        }
        api.onStructure = g2.onStructure; api.surface = g2.surface; api.trail = g2.trail;
        api.offTrail = g2.onStructure ? 0 : (g2.trail ? g2.trail.dist : 0);
        const wy = !g2.onStructure && W().waterY ? W().waterY(pos.x, pos.z) : null;
        api.inWater = wy != null && wy > pos.y + 0.03;
        if (api.inWater) api.surface = 'water';
      }
      if (api.blockedByPath) api.blockedByPath = Math.max(0, api.blockedByPath - dt);
      // zone name
      const w = W(); let zone = 'trail';
      if (pos.y > 29) zone = (Math.abs(pos.x) < 2.05 && Math.abs(pos.z) < 2.05) ? 'cab' : 'catwalk';
      else if (api.onStructure && Math.hypot(pos.x, pos.z) < 7) zone = pos.y > 0.4 ? 'stairs' : 'base';
      else { for (const zn of w.zones) if ((pos.x - zn.x) ** 2 + (pos.z - zn.z) ** 2 < zn.r * zn.r) { zone = zn.name; break; } }
      if (zone === 'tower' || zone === 'gate' || zone === 'generator_shed') zone = 'base';
      api.zone = zone;
      // head bob + footsteps
      const moving = Math.hypot(vel.x, vel.z);
      if (onGround && moving > 0.3) {
        bob += dt * moving * 3.1; stepAcc += moving * dt;
        const stride = jog ? 1.25 : 0.78;
        if (stepAcc > stride) {
          stepAcc = 0; engine.audio && engine.audio.footstep(api.surface, jog, api.carrying);
          if (api.inWater && W().ripple) { const wy2 = W().waterY(pos.x, pos.z); if (wy2 != null) W().ripple(pos.x + Math.sin(bob) * 0.15, wy2, pos.z, jog ? 1.4 : 1); }
        }
      } else bob = damp(bob, Math.round(bob / Math.PI) * Math.PI, 4, dt);
      const bobY = Math.sin(bob * 2) * 0.035 * Math.min(1, moving / 1.5), bobX = Math.cos(bob) * 0.025 * Math.min(1, moving / 1.5);
      camera.position.set(pos.x, pos.y + EYE + bobY, pos.z);
      camera.rotation.set(pitch, yaw, bobX * 0.3, 'YXZ');
      camera.position.x += Math.cos(yaw) * bobX; camera.position.z -= Math.sin(yaw) * bobX;
    },
  };
  return api;
}
