// FALSE LIGHT engine — small shared helpers (no game logic).
import * as THREE from 'three';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// deterministic PRNG (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, z) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) ^ 0x1b873593, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
}
// value noise + fbm (CPU side, for dev terrain / scatter)
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm(x, z, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f + i * 17.3, z * f - i * 9.1); f *= 2.03; amp *= 0.5; }
  return s;
}

// distance from point to polyline in XZ; pts = [[x,z],...] or [[x,y,z],...]
export function distToPolyline2(px, pz, pts) {
  let best = 1e9, bs = 0, acc = 0, bi = 0, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ax = a[0], az = a.length === 3 ? a[2] : a[1], bx = b[0], bz = b.length === 3 ? b[2] : b[1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = clamp(t, 0, 1);
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(px - qx, pz - qz);
    const L = Math.sqrt(L2);
    if (d < best) { best = d; bs = acc + t * L; bi = i; bt = t; }
    acc += L;
  }
  return { d: best, s: bs, i: bi, t: bt };
}

// Catmull-Rom through waypoints [[x,z]...] → dense [[x,z]...] every `step` metres
export function catmull(way, step = 1) {
  if (way.length < 2) return way.slice();
  const P = [way[0], ...way, way[way.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(way[way.length - 1].slice());
  return out;
}

// ---------------------------------------------------------------- asset fetching
// Every asset read goes through here so the single-file build can serve them from an inline table.
export function assetURL(path) {
  const inl = (typeof window !== 'undefined') && window.__FL_INLINE;
  if (inl && inl[path]) return inl[path];
  return path;
}
export function hasInline(path) {
  const inl = (typeof window !== 'undefined') && window.__FL_INLINE;
  return !!(inl && inl[path]);
}
async function dataURLToBuffer(u) {
  const i = u.indexOf(',');
  const bin = atob(u.slice(i + 1));
  const a = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
  return a.buffer;
}
export async function fetchBuffer(path, onProgress) {
  const u = assetURL(path);
  if (u.startsWith('data:')) { const b = await dataURLToBuffer(u); onProgress && onProgress(1); return b; }
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const total = +r.headers.get('Content-Length') || 0;
  if (!onProgress || !r.body || !total) { const b = await r.arrayBuffer(); onProgress && onProgress(1); return b; }
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
export async function fetchJSON(path) {
  const u = assetURL(path);
  if (u.startsWith('data:')) return JSON.parse(new TextDecoder().decode(await dataURLToBuffer(u)));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
export async function tryJSON(path) { try { return await fetchJSON(path); } catch (e) { return null; } }
export async function loadImageBitmap(path, opts = {}) {
  const buf = await fetchBuffer(path);
  const blob = new Blob([buf], { type: path.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  return createImageBitmap(blob, { imageOrientation: opts.flipY ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
export async function loadTexture(path, { srgb = true, repeat = true, flipY = true, aniso = 8 } = {}) {
  const bmp = await loadImageBitmap(path, { flipY });
  const t = new THREE.Texture(bmp);
  t.flipY = false; // ImageBitmap already flipped
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// OBB helper: world-space oriented box from a mesh (geometry bbox in local space + matrixWorld)
export function obbFromObject(obj) {
  obj.updateWorldMatrix(true, false);
  const g = obj.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  const c = new THREE.Vector3(); bb.getCenter(c);
  const h = new THREE.Vector3(); bb.getSize(h).multiplyScalar(0.5);
  const m = obj.matrixWorld;
  const center = c.clone().applyMatrix4(m);
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  m.extractBasis(ax, ay, az);
  const sx = ax.length(), sy = ay.length(), sz = az.length();
  ax.divideScalar(sx || 1); ay.divideScalar(sy || 1); az.divideScalar(sz || 1);
  return { center, axes: [ax, ay, az], half: new THREE.Vector3(h.x * sx, h.y * sy, h.z * sz), name: obj.name };
}
export function makeOBB(center, half, rotY = 0, rotX = 0) {
  const e = new THREE.Euler(rotX, rotY, 0, 'YXZ');
  const m = new THREE.Matrix4().makeRotationFromEuler(e);
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  m.extractBasis(ax, ay, az);
  return { center: center.clone(), axes: [ax, ay, az], half: half.clone() };
}

export function nextFrame() { return new Promise((r) => setTimeout(r, 0)); }

// small DOM helper
export function el(tag, css, parent, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
