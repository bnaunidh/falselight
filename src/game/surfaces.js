// FALSE LIGHT — the real geometry things can be set down on. Every triangle of the static models (tower, cab, shed,
// props) goes into a sparse 1 m grid once at load; a ray walks the grid (3D DDA) and tests only the triangles in the cells
// it passes. So a can lands on the actual shelf board, the desk top, a stair tread or the catwalk rail cap, and a wall or
// a window pane stops the ray, without raycasting 250k triangles through three.js every frame.
import * as THREE from 'three';

const CELL = 1.0;
const MOVING = /^(FL_sash|FL_cab_door|FL_searchlight|FL_firefinder_ring|FL_shutter)/;   // they move: never part of the static grid

export function createSurfaces() {
  let tri = new Float32Array(0), nrm = new Float32Array(0), count = 0;
  const grid = new Map();
  const stamp = { arr: new Uint32Array(0), v: 1 };
  const key = (x, y, z) => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  const S = {
    get triangles() { return count; },
    /** roots: Object3Ds to take static meshes from. */
    build(roots) {
      const t0 = performance.now();
      const P = [], N = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
      for (const root of roots) {
        if (!root) continue;
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
          for (let p = o; p; p = p.parent) if (MOVING.test(p.name || '') || /^COL_/.test(p.name || '')) return;
          const g = o.geometry, pos = g && g.attributes.position; if (!pos) return;
          const idx = g.index, m = o.matrixWorld, nt = idx ? idx.count / 3 : pos.count / 3;
          for (let i = 0; i < nt; i++) {
            const i0 = idx ? idx.getX(i * 3) : i * 3, i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
            a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
            n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const l = n.length(); if (l < 1e-9) continue;
            n.multiplyScalar(1 / l);
            P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); N.push(n.x, n.y, n.z);
          }
        });
      }
      tri = new Float32Array(P); nrm = new Float32Array(N); count = N.length / 3; grid.clear();
      for (let i = 0; i < count; i++) {
        const o = i * 9;
        const x0 = Math.floor(Math.min(tri[o], tri[o + 3], tri[o + 6]) / CELL), x1 = Math.floor(Math.max(tri[o], tri[o + 3], tri[o + 6]) / CELL);
        const y0 = Math.floor(Math.min(tri[o + 1], tri[o + 4], tri[o + 7]) / CELL), y1 = Math.floor(Math.max(tri[o + 1], tri[o + 4], tri[o + 7]) / CELL);
        const z0 = Math.floor(Math.min(tri[o + 2], tri[o + 5], tri[o + 8]) / CELL), z1 = Math.floor(Math.max(tri[o + 2], tri[o + 5], tri[o + 8]) / CELL);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4000) continue;   // a giant triangle (a ground plane): the terrain test covers it
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
          const k = key(x, y, z); let arr = grid.get(k); if (!arr) grid.set(k, (arr = [])); arr.push(i);
        }
      }
      stamp.arr = new Uint32Array(count); stamp.v = 1;
      S.buildMs = performance.now() - t0;
      return S;
    },
    /** First triangle along the ray. → { point, distance, normal (facing the ray), up } or null */
    cast(o, d, far) {
      if (!count) return null;
      if (++stamp.v > 4e9) { stamp.arr.fill(0); stamp.v = 1; }
      const sv = stamp.v;
      let ix = Math.floor(o.x / CELL), iy = Math.floor(o.y / CELL), iz = Math.floor(o.z / CELL);
      const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
      const tdx = Math.abs(CELL / (d.x || 1e-9)), tdy = Math.abs(CELL / (d.y || 1e-9)), tdz = Math.abs(CELL / (d.z || 1e-9));
      let tmx = ((sx > 0 ? (ix + 1) * CELL - o.x : o.x - ix * CELL)) / Math.abs(d.x || 1e-9);
      let tmy = ((sy > 0 ? (iy + 1) * CELL - o.y : o.y - iy * CELL)) / Math.abs(d.y || 1e-9);
      let tmz = ((sz > 0 ? (iz + 1) * CELL - o.z : o.z - iz * CELL)) / Math.abs(d.z || 1e-9);
      let best = far, bi = -1, tCell = 0;
      for (let guard = 0; guard < 400 && tCell <= best; guard++) {
        const arr = grid.get(key(ix, iy, iz));
        if (arr) for (const i of arr) {
          if (stamp.arr[i] === sv) continue; stamp.arr[i] = sv;
          const t = rayTri(o, d, tri, i * 9); if (t > 1e-4 && t < best) { best = t; bi = i; }
        }
        if (tmx < tmy && tmx < tmz) { tCell = tmx; tmx += tdx; ix += sx; }
        else if (tmy < tmz) { tCell = tmy; tmy += tdy; iy += sy; }
        else { tCell = tmz; tmz += tdz; iz += sz; }
        if (tCell > far) break;
      }
      if (bi < 0) return null;
      const normal = new THREE.Vector3(nrm[bi * 3], nrm[bi * 3 + 1], nrm[bi * 3 + 2]);
      if (normal.dot(d) > 0) normal.negate();
      return { point: o.clone().addScaledVector(d, best), distance: best, normal, up: normal.y > 0.6 };
    },
  };
  return S;
}

// Möller–Trumbore, two-sided. Returns t or -1.
function rayTri(o, d, T, k) {
  const ax = T[k], ay = T[k + 1], az = T[k + 2];
  const e1x = T[k + 3] - ax, e1y = T[k + 4] - ay, e1z = T[k + 5] - az, e2x = T[k + 6] - ax, e2y = T[k + 7] - ay, e2z = T[k + 8] - az;
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv; if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
