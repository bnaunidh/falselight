// FALSE LIGHT — Tillman's fire cache and the way to it, built in code (no Blender): the 1958 galvanized storehouse on its
// concrete sill at the dead end of Road 2410-110 (a plank door that swings, the hasp and padlock, shelves, tools, pumps,
// hose, the red FIRE TOOLS box, the drum), the crank-phone wire down the tower leg and north on green glass insulators,
// the blowdown that took it out, Tillman's orange flagging, the young-fir thicket, the ROAD CLOSED sign, the ruts and the
// washout. The numbers and the rules are northWoods.js; this is what you see and bump into, and the one scare.
// It borrows the game's own PBR materials off the models already loaded (the tower's corrugated steel, planks, concrete
// and rusty metal; the trail signs' boards; the spring's moss; the firs' bark; the camp boot) so it sits in the same world,
// with plain fallbacks. Walls are corrugated sheet with the rust painted into vertex colours; inside, the same materials
// dimmed (the sky's reflection doesn't get through a tin roof). The thicket and the saplings in the ruts join the forest's
// own instanced sapling set (no new draw calls, the same wind and LOD dissolve). Everything is built once, at init, in a
// few ms; far away it's hidden (no draw calls). Origin of the building: centre of the floor at the ground, door on +z.
import * as THREE from 'three';
import { loadGLB } from '../engine/world.js?v=0cb07d852ed67db5';
import { NORTH_WOODS as NWD, CACHE_LOCAL, CACHE_FLOOR, CACHE_SHELVES, cacheToWorld, worldToCache, inCache, blowdownLine, thicketPlants,
  pointAt, ROAD_LEN, SIGN_S, scareStep, SCARE_BEATS, scareReady, cacheLock, cacheStock, discover, doorPrompt, doorAct, toolboxPrompt } from './northWoods.js?v=38b24fd4e4e18620';

const V3 = THREE.Vector3, WHITE = [1, 1, 1];
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')).setPosition(x, y, z);
/** A member from p0 to p1: its length along local z, w across (kept horizontal), h in the vertical plane through it. */
export function memberM(p0, p1) {
  const d = new V3().subVectors(p1, p0), L = d.length(); d.divideScalar(L || 1);
  const x = new V3().crossVectors(new V3(0, 1, 0), d); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
  const y = new V3().crossVectors(d, x).normalize();
  return { m: new THREE.Matrix4().makeBasis(x, y, d).setPosition(new V3().addVectors(p0, p1).multiplyScalar(0.5)), L };
}
// the two plank textures' layouts (tower_mats.py WOOD, turned into glTF's flipped v): WP vertical planks, WB horizontal
export const WP = { grain: 'v', per: 0.1115, cen: 0.1167 }, WB = { grain: 'u', per: 0.0766, cen: 0.0803 };

// ------------------------------------------------------------------ a tiny mesh builder (one merged mesh per material)
export class MB {
  constructor(colors = false) { this.P = []; this.N = []; this.U = []; this.C = colors ? [] : null; this.I = []; }
  get count() { return this.P.length / 3; }
  get tris() { return this.I.length / 3; }
  v(p, n, u, v, c) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(u, v); if (this.C) { const k = c || WHITE; this.C.push(k[0], k[1], k[2]); } return this.count - 1; }
  /** A flat convex polygon; wound to face n (or its own winding when n is null). */
  poly(pts, uvs, cols = null, n = null) {
    const tn = new V3().subVectors(pts[1], pts[0]).cross(new V3().subVectors(pts[2], pts[0]));
    if (n && tn.dot(n) < 0) { pts = pts.slice().reverse(); uvs = uvs.slice().reverse(); if (cols) cols = cols.slice().reverse(); }
    const nn = n ? n.clone().normalize() : tn.normalize(), i0 = this.count;
    pts.forEach((p, i) => this.v(p, nn, uvs[i][0], uvs[i][1], cols && cols[i]));
    for (let i = 1; i < pts.length - 1; i++) this.I.push(i0, i0 + i, i0 + i + 1);
    return this;
  }
  /** A box sx x sy x sz centred on m. uv: { tile, off } box projection in the builder's frame (v flipped like glTF), or
   *  { wood: WP | WB, tile?, j, r, grain? } plank-fitted along the member's long axis, or { unit: true } 0..1 per face. */
  box(sx, sy, sz, m = new THREE.Matrix4(), uv = {}) {
    const h = [sx / 2, sy / 2, sz / 2], S = [sx, sy, sz], nm = new THREE.Matrix3().getNormalMatrix(m);
    const L = uv.grain ?? (sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2), wood = uv.wood, tile = uv.tile ?? 1, off = uv.off || [0, 0];
    let wt = tile; const j = uv.j ?? 0, r0 = uv.r ?? 0;
    if (wood && uv.tile == null) { const cw = Math.max(...S.filter((_, i) => i !== L)); wt = Math.max(0.9, cw / (wood.per * 0.82)); }
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
      const b = (a + 1) % 3, c = (a + 2) % 3, nl = [0, 0, 0]; nl[a] = s;
      const nW = new V3(...nl).applyMatrix3(nm).normalize(), pts = [], uvs = [];
      for (const [i, k] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = [0, 0, 0]; q[a] = s * h[a]; q[b] = i * h[b]; q[c] = k * h[c];
        const p = new V3(...q).applyMatrix4(m); pts.push(p);
        let u, v;
        if (uv.unit) { u = (i + 1) / 2; v = (k + 1) / 2; }
        else if (wood) {
          if (a === L) { u = q[b] / wt; v = q[c] / wt; }
          else { const X = 3 - a - L, along = q[L], across = q[X];
            if (wood.grain === 'v') { u = across / wt + wood.cen + wood.per * j; v = -(along / wt + r0); }
            else { u = along / wt + r0; v = (1 - wood.cen - wood.per * j) - across / wt; } }
        } else {
          const ax = Math.abs(nW.x) > Math.abs(nW.y) && Math.abs(nW.x) > Math.abs(nW.z) ? 0 : Math.abs(nW.y) > Math.abs(nW.z) ? 1 : 2;
          if (ax === 1) { u = p.x / tile; v = p.z / tile; } else if (ax === 0) { u = p.z / tile; v = -p.y / tile; } else { u = p.x / tile; v = -p.y / tile; }
        }
        uvs.push([u + off[0], v + off[1]]);
      }
      this.poly(pts, uvs, uv.col ? [uv.col, uv.col, uv.col, uv.col] : null, nW);
    }
    return this;
  }
  /** A surface of revolution about local +y: prof = [[r, y], ...] bottom to top. */
  lathe(prof, m = new THREE.Matrix4(), seg = 12, { tile = 1, a0 = 0, a1 = Math.PI * 2, cap0 = false, cap1 = false, inside = false } = {}) {
    const nm = new THREE.Matrix3().getNormalMatrix(m), n = prof.length, i0 = this.count, sg = inside ? -1 : 1;
    const pn = prof.map((p, i) => { const a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)], dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; });
    const vs = [0]; for (let i = 1; i < n; i++) vs.push(vs[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
    const rmax = Math.max(...prof.map((p) => p[0]));
    for (let j = 0; j <= seg; j++) {
      const ang = a0 + (a1 - a0) * j / seg, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let i = 0; i < n; i++) this.v(new V3(prof[i][0] * ca, prof[i][1], prof[i][0] * sa).applyMatrix4(m), new V3(pn[i][0] * ca * sg, pn[i][1] * sg, pn[i][0] * sa * sg).applyMatrix3(nm).normalize(), (ang * rmax) / tile, -vs[i] / tile);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < n - 1; i++) { const a = i0 + j * n + i, b = a + n; if (inside) this.I.push(a, b, a + 1, a + 1, b, b + 1); else this.I.push(a, a + 1, b, a + 1, b + 1, b); }
    const cap = (i, up) => {
      const [r, y] = prof[i]; if (r <= 1e-5) return;
      const c0 = this.count, nn = new V3(0, up ? 1 : -1, 0).applyMatrix3(nm).normalize();
      this.v(new V3(0, y, 0).applyMatrix4(m), nn, 0.5, 0.5);
      for (let j = 0; j <= seg; j++) { const ang = a0 + (a1 - a0) * j / seg; this.v(new V3(r * Math.cos(ang), y, r * Math.sin(ang)).applyMatrix4(m), nn, 0.5 + Math.cos(ang) * r / tile, 0.5 + Math.sin(ang) * r / tile); }
      for (let j = 0; j < seg; j++) { if (up) this.I.push(c0, c0 + j + 2, c0 + j + 1); else this.I.push(c0, c0 + j + 1, c0 + j + 2); }
    };
    if (cap0) cap(0, false); if (cap1) cap(n - 1, true);
    return this;
  }
  /** A round tube through world points (the wire, handles). */
  tube(pts, r, radial = 4, tile = 0.5) {
    const i0 = this.count, n = pts.length; let s = 0;
    for (let i = 0; i < n; i++) {
      const t = new V3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      const nx = new V3().crossVectors(t, Math.abs(t.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0)).normalize(), bx = new V3().crossVectors(t, nx);
      if (i) s += pts[i].distanceTo(pts[i - 1]);
      for (let k = 0; k <= radial; k++) { const a = (k / radial) * Math.PI * 2, d = nx.clone().multiplyScalar(Math.cos(a)).addScaledVector(bx, Math.sin(a)); this.v(pts[i].clone().addScaledVector(d, r), d, k / radial, -s / tile); }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) { const a = i0 + i * (radial + 1) + k, b = a + radial + 1; this.I.push(a, a + 1, b, a + 1, b + 1, b); }
    return this;
  }
  mesh(mat, name = '', shadow = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); if (this.C) g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I); g.computeBoundingSphere(); g.computeBoundingBox();
    const o = new THREE.Mesh(g, mat); o.name = name; o.castShadow = shadow; o.receiveShadow = true; return o;
  }
}
/** Merge-by-material bins: bins.get('timber').box(...); then bins.meshes(M) → one Mesh per material key. */
export class Bins {
  constructor() { this.b = new Map(); }
  get(k, colors = false) { if (!this.b.has(k)) this.b.set(k, new MB(colors)); return this.b.get(k); }
  meshes(M, prefix, shadow = true) { const out = []; for (const [k, mb] of this.b) if (mb.I.length && M[k]) out.push(mb.mesh(M[k], prefix + k, shadow)); return out; }
}

// ------------------------------------------------------------------ painted textures (browser only: null in node)
export function canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); if (!g) return null;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export const SERIF = '"Century Schoolbook","New Century Schoolbook",Georgia,"Times New Roman",serif', SANS = '"Franklin Gothic Medium","Arial Narrow",Arial,sans-serif';
const HAND = '"Bradley Hand","Segoe Print","Chalkboard SE","Comic Sans MS",cursive';
export function routed(g, text, x, y, px, { font = SERIF, fill = '#e6d8b0', shadow = 'rgba(20,12,6,0.85)', bold = 'bold' } = {}) {   // routed + painted: a dark cut edge, then the cream
  g.font = `${bold} ${px}px ${font}`; g.fillStyle = shadow; g.fillText(text, x + px * 0.03, y + px * 0.05); g.fillStyle = fill; g.fillText(text, x, y);
}
export function scuff(g, w, h, n, seed, col = 'rgba(40,28,18,0.35)') { const R = rng(seed); g.fillStyle = col; for (let i = 0; i < n; i++) { g.globalAlpha = 0.2 + R() * 0.6; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2); } g.globalAlpha = 1; }
const TEX = {
  sign: () => canvasTex(512, 116, (g, w, h) => {   // over the door: shield, U.S. FOREST SERVICE / TAMARACK FIRE CACHE
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(46, 58); g.beginPath(); g.moveTo(-30, -40); g.lineTo(30, -40); g.lineTo(30, 6); g.quadraticCurveTo(28, 30, 0, 44); g.quadraticCurveTo(-28, 30, -30, 6); g.closePath();
    g.fillStyle = 'rgba(20,12,6,0.85)'; g.translate(1.5, 2); g.fill(); g.translate(-1.5, -2); g.fillStyle = '#c9a44e'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#5a3d20'; g.stroke();
    g.fillStyle = '#3f5a33'; g.beginPath(); g.moveTo(0, -30); g.lineTo(16, 10); g.lineTo(5, 10); g.lineTo(5, 22); g.lineTo(-5, 22); g.lineTo(-5, 10); g.lineTo(-16, 10); g.closePath(); g.fill(); g.restore();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    routed(g, 'U.S. FOREST SERVICE', 96, 30, 26); routed(g, 'TAMARACK FIRE CACHE', 94, 78, 44);
    scuff(g, w, h, 260, 11, 'rgba(60,40,22,0.5)');
  }),
  plate: () => canvasTex(256, 154, (g, w, h) => {   // the road sign: USFS brown, cream letters, rust coming through everywhere
    const R = rng(23); g.fillStyle = '#4c3322'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${120 + R() * 40 | 0},${60 + R() * 20 | 0},${24 + R() * 10 | 0},${0.5 + R() * 0.4})`); gr.addColorStop(1, 'rgba(110,60,25,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    routed(g, 'U.S. FOREST SERVICE', w / 2, 22, 15, { font: SANS, fill: '#d9cfb4', shadow: 'rgba(0,0,0,0.3)', bold: '' });
    routed(g, 'ROAD 2410-110', w / 2, 58, 30, { font: SANS, fill: '#ddd3b8', shadow: 'rgba(0,0,0,0.3)' });
    routed(g, 'CLOSED', w / 2, 108, 50, { font: SANS, fill: '#e2d8bd', shadow: 'rgba(0,0,0,0.3)' });
    for (let i = 0; i < 40; i++) { const x = R() * w, y = R() * h, r = 2 + R() * 9, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(128,66,26,0.9)'); gr.addColorStop(1, 'rgba(128,66,26,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (const bx of [12, w - 12]) { g.fillStyle = 'rgba(95,48,18,0.8)'; g.fillRect(bx - 2, 6, 4, h - 6); }   // rust runs from the bolts
  }),
  fallen: () => canvasTex(512, 90, (g, w, h) => {   // the board that hung under it, face-up in the needles
    g.clearRect(0, 0, w, h); g.textBaseline = 'middle'; g.textAlign = 'left';
    routed(g, 'TAMARACK FIRE CACHE', 18, h / 2 + 2, 40);
    g.fillStyle = 'rgba(20,12,6,0.85)'; const ar = (dx, dy) => { g.beginPath(); g.moveTo(410 + dx, 36 + dy); g.lineTo(470 + dx, 36 + dy); g.lineTo(470 + dx, 24 + dy); g.lineTo(500 + dx, 46 + dy); g.lineTo(470 + dx, 68 + dy); g.lineTo(470 + dx, 56 + dy); g.lineTo(410 + dx, 56 + dy); g.closePath(); g.fill(); };
    ar(1.5, 2); g.fillStyle = '#e6d8b0'; ar(0, 0); scuff(g, w, h, 320, 5, 'rgba(60,40,22,0.55)');
  }),
  litter: () => canvasTex(128, 128, (g, w, h) => {   // fir needles and duff over the board's end
    const R = rng(8); g.clearRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { const x = R() * w, y = R() * h, a = R() * Math.PI, l = 3 + R() * 7, d = Math.hypot(x - w * 0.25, y - h / 2) / (w * 0.6); if (R() < d) continue;
      g.strokeStyle = `rgba(${70 + R() * 50 | 0},${45 + R() * 30 | 0},${25 + R() * 15 | 0},${0.7 + R() * 0.3})`; g.lineWidth = 1 + R(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  }),
  tools: () => canvasTex(256, 116, (g, w, h) => {   // the red box: stencilled white
    g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold 46px ${SANS}`; g.fillStyle = '#ece6d6'; g.fillText('FIRE TOOLS', w / 2, 44); g.font = `20px ${SANS}`; g.fillText('FOR FIRE USE ONLY', w / 2, 88);
    g.globalCompositeOperation = 'destination-out'; scuff(g, w, h, 400, 17, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'source-over';
  }),
  rack: () => canvasTex(256, 56, (g, w, h) => { g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 38px ${SANS}`; g.fillStyle = '#9a2a1c'; g.fillText('FIRE TOOLS', w / 2, h / 2 + 2); g.globalCompositeOperation = 'destination-out'; scuff(g, w, h, 200, 3, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'source-over'; }),
  chalk: () => canvasTex(128, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 34px ${HAND}`; g.fillStyle = 'rgba(235,232,222,0.85)'; g.fillText('EMPTY', w / 2, h / 2); g.globalCompositeOperation = 'destination-out'; scuff(g, w, h, 300, 9, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'source-over'; }),
  sheet: () => canvasTex(128, 176, (g, w, h) => {   // the sign-out sheet: a ruled form, pencil you can't read from here
    const R = rng(41); g.fillStyle = '#e4dcc6'; g.fillRect(0, 0, w, h); g.fillStyle = '#2d2a28'; g.font = `bold 8px ${SANS}`; g.textAlign = 'center'; g.fillText('EQUIPMENT OUT', w / 2, 12);
    g.strokeStyle = 'rgba(40,60,90,0.45)'; g.lineWidth = 1; for (let y = 22; y < h - 6; y += 9) { g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y); g.stroke(); }
    for (const x of [30, 78, 92]) { g.beginPath(); g.moveTo(x, 18); g.lineTo(x, h - 6); g.stroke(); }
    g.strokeStyle = 'rgba(60,58,62,0.8)'; for (let r = 0; r < 5; r++) { const y = 29 + r * 9; for (let x = 8; x < w - 12; x += 5 + R() * 8) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2 + R() * 4, y - 2 - R() * 2); g.stroke(); } }
  }),
  tally: () => canvasTex(128, 96, (g, w, h) => {   // pencil on the inside of the door
    g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(52,50,54,0.9)'; g.lineWidth = 2; const R = rng(4);
    let x = 10; for (let grp = 0; grp < 4; grp++) { const n = grp === 3 ? 2 : 5; for (let i = 0; i < Math.min(n, 4); i++) { g.beginPath(); g.moveTo(x + i * 6, 30 + R() * 4); g.lineTo(x + i * 6 + R() * 2, 66 + R() * 4); g.stroke(); } if (n === 5) { g.beginPath(); g.moveTo(x - 4, 60); g.lineTo(x + 24, 36); g.stroke(); } if (n === 2) { g.beginPath(); g.moveTo(x + 6, 30); g.lineTo(x + 7, 66); g.stroke(); } x += 32; }
  }),
  hose: () => canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#6f6754'; g.lineWidth = 2.2; g.beginPath(); for (let a = 0; a < Math.PI * 16; a += 0.2) { const r = 4 + a * 0.54; const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r; if (a) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }),
  ruts: () => canvasTex(64, 256, (g, w, h) => {   // across the road bed: two packed wheel tracks, a crown of duff between
    const R = rng(77); g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) { const u = x / (w - 1), tr = Math.max(Math.exp(-(((u - 0.27) / 0.075) ** 2)), Math.exp(-(((u - 0.73) / 0.075) ** 2))), edge = smooth(0, 0.12, u) * smooth(1, 0.88, u);
      g.fillStyle = `rgba(${78 - tr * 18 | 0},${64 - tr * 16 | 0},${48 - tr * 12 | 0},${(0.16 + tr * 0.5) * edge})`; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 1400; i++) { const x = R() * w, y = R() * h; g.fillStyle = `rgba(${60 + R() * 60 | 0},${48 + R() * 40 | 0},${30 + R() * 20 | 0},${R() * 0.45})`; g.fillRect(x, y, 1, 2 + R() * 3); }
  }, { repeat: true }),
  keyTag: () => canvasTex(96, 56, (g, w, h) => { g.fillStyle = '#cdb98b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#a38f60'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); g.fillStyle = '#2b2622'; g.font = `bold 15px "Courier New",monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F.C.', w / 2 + 6, 20); g.fillText('2410-110', w / 2 + 6, 38); g.fillStyle = '#9c8a5e'; g.beginPath(); g.arc(12, h / 2, 5, 0, 7); g.fill(); }),
  film: () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#26272a'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8352a'; g.fillRect(0, 70, w, 12); g.fillStyle = '#e8e4d8'; g.textAlign = 'center'; g.font = `bold 17px ${SANS}`; g.fillText('INSTANT FILM', w / 2, 34); g.font = `12px ${SANS}`; g.fillText('10 EXPOSURES · COLOR', w / 2, 54); g.fillText('EXP 11/83', w / 2, 104); }),
  jug: () => canvasTex(128, 48, (g, w, h) => { g.fillStyle = '#d8cfae'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f2a44'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 15px ${HAND}`; g.fillText('DRINKING WATER', w / 2, 16); g.font = `13px ${HAND}`; g.fillText('S.F.R.D.  6/83', w / 2, 34); }),
};
export const decalMat = (map, o = {}) => (map ? new THREE.MeshStandardMaterial({ map, alphaTest: 0.42, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, ...o }) : null);

// ------------------------------------------------------------------ the materials, off the models already in the scene
export function sceneMaterials(W) {
  const found = new Map();
  for (const r of W.modelRoots || []) if (r && r.traverse) r.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return; for (const x of Array.isArray(o.material) ? o.material : [o.material]) if (x && x.name && !found.has(x.name)) found.set(x.name, x); });
  return found;
}
function makeMaterials(W) {
  const found = sceneMaterials(W), got = [];
  const std = (name, o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }); m.name = name; return m; };
  const get = (n, fb) => { const m = found.get(n); if (m) { got.push(n); return m; } return std(n + '_fb', fb); };
  // the interior: the same stuff, but the sky's reflection mostly doesn't reach in (userData.envBase: engine.setEnvIntensity)
  const dim = (m, env = 0.3, k = 0.86) => { const c = m.clone(); c.name = m.name + '_in'; c.color.multiplyScalar(k); c.envMapIntensity = (m.userData.envBase ?? m.envMapIntensity ?? 1) * env; c.userData.envBase = c.envMapIntensity; return c; };
  const M = {
    corr: get('FL_tw_corrugated', { color: 0x8f8d88, roughness: 0.55, metalness: 0.5 }),
    roof: get('FL_tw_roof', { color: 0x5f5e5a, roughness: 0.6, metalness: 0.45 }),
    timber: get('FL_tw_timber', { color: 0x6d6254, roughness: 0.9 }),
    deck: get('FL_tw_deck', { color: 0x6b5b49, roughness: 0.9 }),
    conc: get('FL_tw_concrete', { color: 0x8a867e, roughness: 0.95 }),
    steel: get('FL_tw_steel', { color: 0x5e5248, roughness: 0.7, metalness: 0.55 }),
    sign: get('FL_pr_sign', { color: 0x4a3526, roughness: 0.85 }),
    red: get('FL_pr_flagred', { color: 0x8e2a1e, roughness: 0.6 }),
    paper: get('FL_pr_paper', { color: 0xd9d2bf, roughness: 0.9 }),
    mossy: get('FL_pr_mossy', { color: 0x4d5a34, roughness: 0.95 }),
    glass: get('FL_pr_glass', { color: 0x9aa6a2, roughness: 0.1, transparent: true, opacity: 0.35 }),
    dark: get('FL_pr_dark', { color: 0x151412, roughness: 0.8 }),
  };
  // walls: the corrugated sheet, rust painted in per vertex (a splash band along the bottom, runs under the nail lines)
  M.corrOut = M.corr.clone(); M.corrOut.name = 'FL_cache_corr'; M.corrOut.vertexColors = true;
  M.corrIn = dim(M.corrOut, 0.25, 0.8); M.roofIn = dim(M.roof, 0.25, 0.75);
  M.timberIn = dim(M.timber); M.deckIn = dim(M.deck, 0.35, 0.9); M.steelIn = dim(M.steel); M.paperIn = dim(M.paper, 0.4, 0.9); M.redIn = dim(M.red, 0.35);
  M.galv = dim(M.steel, 0.4, 1.25); M.galv.color.lerp(new THREE.Color(0.62, 0.62, 0.6), 0.5); M.galv.name = 'FL_cache_galv';
  M.canvas = std('FL_cache_canvas', { color: 0xa89d82, roughness: 0.97 }); M.canvas.envMapIntensity = 0.3; M.canvas.userData.envBase = 0.3;
  M.brass = std('FL_cache_brass', { color: 0x8f6f38, roughness: 0.42, metalness: 1 });
  M.wire = std('FL_nw_wire', { color: 0x4e3524, roughness: 0.62, metalness: 0.55 });
  M.soil = std('FL_nw_soil', { color: 0x3b2e23, roughness: 1 });
  M.tape = std('FL_nw_tape', { color: 0xd9774a, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xd9774a, emissiveIntensity: 0 });
  M.bead = std('FL_nw_bead', { color: 0xe9e4d6, roughness: 0.14, metalness: 0.1, emissive: 0xfff2dc, emissiveIntensity: 0 });
  M.bark = std('FL_nw_bark_fb', { color: 0x4c4540, roughness: 0.95 });   // replaced by the firs' own bark once it's fetched
  M.rubber = std('FL_nw_rubber_fb', { color: 0x2d2b24, roughness: 0.7 });
  M.found = got;
  return M;
}
const insulatorMat = () => { const m = new THREE.MeshStandardMaterial({ color: 0x3e7b58, roughness: 0.09, metalness: 0, emissive: 0x3f8f62, emissiveIntensity: 0 }); m.name = 'FL_nw_insulator'; m.envMapIntensity = 1.6; m.userData.envBase = 1.6; return m; };

// ------------------------------------------------------------------ the building (cache-local)
const CW = 2.15, CD = 3.05, EAVE = 2.45, RIDGE = 3.35, OH = 0.35, PITCH = Math.atan2(RIDGE - EAVE, CW), HOSES = [-2.42, -1.98];
const yRoof = (x) => EAVE + (RIDGE - EAVE) * (1 - Math.min(1, Math.abs(x) / CW));
function rustCol(u, y, seed) {   // galvanized gone grey; brown at the splash line and in runs under the nails
  const col = Math.round(u / 0.3), h = hash(col + seed * 17.3, 3.1), streak = h > 0.7 ? (0.45 + 0.55 * hash(col + seed, 9.7)) * smooth(0.3, 2.35, y) * 0.55 : 0;
  const k = Math.min(1, smooth(0.85, 0.12, y) * 0.8 + streak), mott = (hash(col * 7 + seed, Math.round(y * 3)) - 0.5) * 0.09;
  return [1 - k * 0.36 + mott, 1 - k * 0.5 + mott, 1 - k * 0.62 + mott];
}
/** A corrugated wall (outer + inner face): the ribs run up it (u = along the wall), holes for the door / window. */
function corrWall(out, inn, o) {
  const us = new Set([o.u0, o.u1, ...(o.extraU || [])]); for (let u = Math.ceil(o.u0 / 0.3) * 0.3; u < o.u1; u += 0.3) us.add(+u.toFixed(4));
  const U = [...us].filter((u) => u >= o.u0 - 1e-6 && u <= o.u1 + 1e-6).sort((a, b) => a - b);
  const Y = [...new Set([0.08, 0.35, 0.65, 1.0, 1.4, 1.8, 2.15, EAVE, ...(o.extraY || [])])].sort((a, b) => a - b);
  const P = (u, y, d) => (o.axis === 'x' ? new V3(o.at + d, y, u) : new V3(u, y, o.at + d));
  const nOut = o.axis === 'x' ? new V3(o.sgn, 0, 0) : new V3(0, 0, o.sgn), nIn = nOut.clone().negate();
  const hole = (u, y) => (o.holes || []).some(([a, b, c, d]) => u > a && u < b && y > c && y < d);
  const quad = (ua, ub, ya0, yb0, ya1, yb1) => {
    const uvs = [[ua / 0.9, -ya0 / 0.9], [ub / 0.9, -yb0 / 0.9], [ub / 0.9, -yb1 / 0.9], [ua / 0.9, -ya1 / 0.9]];
    const cs = [rustCol(ua, ya0, o.seed), rustCol(ub, yb0, o.seed), rustCol(ub, yb1, o.seed), rustCol(ua, ya1, o.seed)];
    out.poly([P(ua, ya0, 0), P(ub, yb0, 0), P(ub, yb1, 0), P(ua, ya1, 0)], uvs, cs, nOut);
    inn.poly([P(ua, ya0, -o.sgn * 0.012), P(ub, yb0, -o.sgn * 0.012), P(ub, yb1, -o.sgn * 0.012), P(ua, ya1, -o.sgn * 0.012)], uvs, cs.map((c) => c.map((v) => 0.55 + v * 0.45)), nIn);
  };
  for (let i = 0; i < U.length - 1; i++) {
    const ua = U[i], ub = U[i + 1], um = (ua + ub) / 2;
    for (let k = 0; k < Y.length - 1; k++) if (!hole(um, (Y[k] + Y[k + 1]) / 2)) quad(ua, ub, Y[k], Y[k], Y[k + 1], Y[k + 1]);
    if (o.top) { const ta = o.top(ua), tb = o.top(ub); if (ta > EAVE + 0.004 || tb > EAVE + 0.004) quad(ua, ub, EAVE, EAVE, ta, tb); }
  }
}
function buildBuilding(M, ground, R) {
  const X = new Bins(), I = new Bins();   // X: the shell (outside), I: the interior (dim)
  const out = X.get('corrOut', true), inn = I.get('corrIn', true);
  corrWall(out, inn, { axis: 'x', at: -CW, sgn: -1, u0: -CD, u1: CD, seed: 1 });
  corrWall(out, inn, { axis: 'x', at: CW, sgn: 1, u0: -CD, u1: CD, seed: 2, holes: [[1.85, 2.65, 1.4, 2.0]], extraU: [1.85, 2.65], extraY: [1.4, 2.0] });
  const gTop = (u) => yRoof(u) + 0.08;
  corrWall(out, inn, { axis: 'z', at: -CD, sgn: -1, u0: -CW, u1: CW, seed: 3, top: gTop });
  corrWall(out, inn, { axis: 'z', at: CD, sgn: 1, u0: -CW, u1: CW, seed: 4, top: gTop, holes: [[-0.65, 0.65, -1, 2.25]], extraU: [-0.65, 0.65], extraY: [2.25] });
  // corner flashing (steel angle)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    X.get('steel').box(0.09, EAVE - 0.06, 0.012, M4(sx * (CW - 0.035), (EAVE + 0.02) / 2, sz * (CD + 0.008)), { tile: 0.6 });
    X.get('steel').box(0.012, EAVE - 0.06, 0.09, M4(sx * (CW + 0.008), (EAVE + 0.02) / 2, sz * (CD - 0.035)), { tile: 0.6 });
  }
  // the roof: corrugated, ribs down the slope, a ridge roll, fascia and barge boards, moss creeping up from the eaves
  const zr = CD + OH, yR = RIDGE + 0.1, yE = EAVE + 0.1 - OH * Math.tan(PITCH), Ls = Math.hypot(CW + OH, yR - yE);
  for (const s of [-1, 1]) {
    const xe = s * (CW + OH), nUp = new V3(s * Math.sin(PITCH), Math.cos(PITCH), 0);
    const pts = [new V3(0, yR, -zr), new V3(0, yR, zr), new V3(xe, yE, zr), new V3(xe, yE, -zr)], uvs = [[-zr / 0.9, 0], [zr / 0.9, 0], [zr / 0.9, -Ls / 0.9], [-zr / 0.9, -Ls / 0.9]];
    X.get('roof').poly(pts, uvs, null, nUp);
    I.get('roofIn').poly(pts.map((p) => p.clone().addScaledVector(nUp, -0.012)), uvs, null, nUp.clone().negate());
    X.get('roof').poly([new V3(0, yR + 0.02, -zr), new V3(0, yR + 0.02, zr), new V3(s * 0.16, yR + 0.02 - 0.16 * Math.tan(PITCH), zr), new V3(s * 0.16, yR + 0.02 - 0.16 * Math.tan(PITCH), -zr)], [[0.3, 0], [0.3 + 2 * zr / 0.9, 0], [0.3 + 2 * zr / 0.9, 0.2], [0.3, 0.2]], null, nUp);
    X.get('timber').box(0.03, 0.14, zr * 2 + 0.06, M4(xe + s * 0.015, yE - 0.06, 0), { wood: WP, j: 2 });
    for (const z of [-zr - 0.015, zr + 0.015]) { const { m, L } = memberM(new V3(0, yR + 0.03, z), new V3(xe, yE - 0.02, z)); X.get('timber').box(0.03, 0.17, L + 0.04, m, { wood: WP, j: 4 }); }
    for (let i = 0; i < 7; i++) {   // moss patches along the eave
      const z0 = -zr + 0.2 + R() * (2 * zr - 1.4), len = 0.3 + R() * 1.1, up = 0.12 + R() * 0.3, lift = 0.006;
      const q = (d, z) => new V3(xe - s * d * Math.cos(PITCH), yE + d * Math.sin(PITCH) + lift, z).addScaledVector(nUp, lift);
      X.get('mossy').poly([q(0.02, z0), q(0.02, z0 + len), q(up, z0 + len * 0.8), q(up * 0.8, z0 + len * 0.15)], [[z0 / 0.7, 0], [(z0 + len) / 0.7, 0], [(z0 + len * 0.8) / 0.7, up / 0.7], [(z0 + len * 0.15) / 0.7, up / 0.7]], null, nUp);
    }
  }
  // the sill, the step, the floor and the threshold
  X.get('conc').box(4.6, 0.6, 6.4, M4(0, -0.15, 0), { tile: 1.2 });
  const stepTop = Math.min(0.1, Math.max(0.02, ground(0, 3.55) + 0.08));
  X.get('conc').box(1.5, 0.34, 0.74, M4(0, stepTop - 0.17, CD + 0.15 + 0.37), { tile: 1.2, off: [0.37, 0.11] });
  I.get('deckIn').box(4.1, 0.05, 5.92, M4(0, CACHE_FLOOR - 0.025, 0), { wood: WB, tile: 1.4, grain: 2 });
  X.get('timber').box(1.3, 0.03, 0.14, M4(0, CACHE_FLOOR - 0.012, CD - 0.02), { wood: WP, j: 1 });
  // framing: studs on 0.6 m centres, plates, a nailer, the rafters, ridge board, purlins, two collar ties
  const T = I.get('timberIn'), sx = CW - 0.057;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 11; i++) { const z = -2.95 + i * 0.59; if (s > 0 && z > 1.8 && z < 2.7) continue; T.box(0.09, 2.19, 0.045, M4(s * sx, 0.2 + 2.19 / 2, z), { wood: WP, j: i % 7, r: R() }); }
    T.box(0.09, 0.045, 6.0, M4(s * sx, 0.228, 0), { wood: WP, j: 3 }); T.box(0.09, 0.08, 6.1, M4(s * sx, EAVE - 0.04, 0), { wood: WP, j: 5 });
    for (const [z0, z1] of s > 0 ? [[-2.98, 1.82], [2.68, 2.98]] : [[-2.98, 2.98]]) T.box(0.09, 0.045, z1 - z0, M4(s * sx, 1.25, (z0 + z1) / 2), { wood: WP, j: 6 });
    for (const x of [0.6, 1.3]) T.box(0.045, yRoof(x) - 0.25, 0.09, M4(s * x, 0.2 + (yRoof(x) - 0.25) / 2, -(CD - 0.057)), { wood: WP, j: 2 });
    T.box(0.045, EAVE - 0.25, 0.09, M4(s * 1.42, 0.2 + (EAVE - 0.25) / 2, CD - 0.057), { wood: WP, j: 1 });
    for (let i = 0; i < 6; i++) { const z = -2.98 + i * 1.192; const { m, L } = memberM(new V3(s * (CW + OH - 0.03), yRoof(CW) - 0.03 - (OH - 0.03) * Math.tan(PITCH), z), new V3(0, RIDGE - 0.03, z)); T.box(0.045, 0.14, L, m, { wood: WP, j: i }); }
    for (const x of [0.72, 1.45]) T.box(0.09, 0.045, 2 * zr - 0.05, M4(s * x, yRoof(x) + 0.075, 0), { wood: WP, j: 3 });
  }
  T.box(0.045, 0.18, 2 * CD + 0.1, M4(0, RIDGE, 0), { wood: WP, j: 4 });
  for (const z of [-1.742, 1.834]) T.box(2.4, 0.14, 0.045, M4(0, 2.72, z), { wood: WP, j: 2 });
  for (const x of [-0.6, 0, 0.6]) { const h = yRoof(x) - 0.05 - 2.35; T.box(0.045, h, 0.09, M4(x, 2.35 + h / 2, CD - 0.057), { wood: WP, j: 4 }); }
  // the door frame (jambs + header), and the window: frame, a cross muntin, glass, one plank nailed across it outside
  for (const s of [-1, 1]) X.get('timber').box(0.07, 2.1, 0.1, M4(s * 0.685, 0.2 + 1.05, CD - 0.035), { wood: WP, j: 5 });
  X.get('timber').box(1.44, 0.09, 0.1, M4(0, 2.3, CD - 0.035), { wood: WP, j: 3 });
  { const x = CW - 0.02, W = X.get('timber');
    W.box(0.1, 0.06, 0.92, M4(x, 1.37, 2.25), { wood: WP }); W.box(0.1, 0.06, 0.92, M4(x, 2.03, 2.25), { wood: WP, j: 2 });
    W.box(0.1, 0.72, 0.06, M4(x, 1.7, 1.82), { wood: WP, j: 4 }); W.box(0.1, 0.72, 0.06, M4(x, 1.7, 2.68), { wood: WP, j: 6 });
    W.box(0.04, 0.6, 0.03, M4(x + 0.005, 1.7, 2.25), { wood: WP, j: 1 }); W.box(0.04, 0.03, 0.8, M4(x + 0.005, 1.7, 2.25), { wood: WP, j: 3 });
    for (const d of [-0.01, 0.01]) X.get('glass').poly([new V3(x + d, 1.4, 1.85), new V3(x + d, 1.4, 2.65), new V3(x + d, 2.0, 2.65), new V3(x + d, 2.0, 1.85)], [[0, 0], [1, 0], [1, 1], [0, 1]], null, new V3(Math.sign(d), 0, 0));
    W.box(0.025, 0.13, 1.08, M4(CW + 0.035, 1.7, 2.25, 0.38, 0, 0), { wood: WP, j: 5, r: 0.3 }); }
  // the corrugated walls stop at the eave; close the eave gap between wall and roof with a timber frieze board
  for (const s of [-1, 1]) X.get('timber').box(0.025, 0.12, 2 * CD, M4(s * (CW + 0.014), EAVE + 0.05, 0), { wood: WP, j: 2 });
  // shelves both long walls: steel uprights, three plank boards, an angle under each front edge
  for (const s of [-1, 1]) {
    for (const z of [-2.7, -0.6, 1.5]) for (const x of [1.575, 2.02]) I.get('steelIn').box(0.035, 2.05, 0.035, M4(s * x, CACHE_FLOOR + 1.025, z), { tile: 0.6 });
    CACHE_SHELVES.forEach((y, i) => { I.get('timberIn').box(0.5, 0.03, 4.25, M4(s * 1.8, y - 0.015, -0.6), { wood: WP, j: i * 2 + (s > 0 ? 1 : 0), r: R() }); I.get('steelIn').box(0.03, 0.03, 4.2, M4(s * 1.575, y - 0.045, -0.6), { tile: 0.6 }); });
  }
  // the back wall: a tool rack, six Pulaskis leaning on the sheet (heads up, blades out), four shovels on the rail
  I.get('timberIn').box(2.9, 0.12, 0.03, M4(0, 1.42, -CD + 0.1), { wood: WP, j: 2 });
  I.get('timberIn').box(1.0, 0.2, 0.025, M4(0, 1.8, -CD + 0.075), { wood: WP, j: 5 });
  for (let i = 0; i < 6; i++) pulaski(I, M4(-1.32 + i * 0.22, CACHE_FLOOR, -2.58, -0.35 + (R() - 0.5) * 0.04, (R() - 0.5) * 0.12, (R() - 0.5) * 0.06), 'timberIn', 'steelIn');
  for (let i = 0; i < 4; i++) shovel(I, M4(0.12 + i * 0.27, CACHE_FLOOR, -2.62, -0.27, (R() - 0.5) * 0.2, (R() - 0.5) * 0.05), 'timberIn', 'steelIn');
  // hose rolls, backpack pumps, Tillman's red coffee can, the sign-out clipboard on the stud by the door
  for (const z of HOSES) I.get('canvas').lathe([[0.2, -0.037], [0.2, 0.037]], M4(-1.8, CACHE_SHELVES[0] + 0.2, z, 0, 0, -Math.PI / 2), 14, { tile: 0.4, cap0: true, cap1: true });
  for (const [x, z] of [[1.8, -2.4], [1.8, -1.93], [1.28, -1.52]]) pump(I, M4(x, CACHE_FLOOR, z, 0, R() * 6, 0));
  I.get('redIn').lathe([[0.075, 0], [0.075, 0.15], [0.07, 0.152]], M4(1.82, CACHE_SHELVES[2], 0.24), 14, { tile: 0.3, cap0: true });
  I.get('timberIn').box(0.006, 0.32, 0.23, M4(-2.044, 1.45, 1.77), { wood: WP, j: 6 });
  I.get('steelIn').box(0.012, 0.03, 0.08, M4(-2.036, 1.6, 1.77), { tile: 0.3 });
  // over the door: the routed sign board with its shield
  X.get('sign').box(1.6, 0.36, 0.04, M4(0, 2.63, CD + 0.03), { wood: WB, tile: 1.4, grain: 0 });
  for (const s of [-1, 1]) X.get('steel').box(0.02, 0.02, 0.012, M4(s * 0.74, 2.63, CD + 0.056), { tile: 0.2 });
  // outside, right of the door: the red FIRE TOOLS box on skids (the lid moves; see moving parts); left: the drum
  const tb = { x: 1.7, z: 3.72 }, tg = ground(tb.x, tb.z);
  X.get('red').box(1.1, 0.42, 0.45, M4(tb.x, tg + 0.08 + 0.21, tb.z), { tile: 0.8 });
  for (const s of [-1, 1]) X.get('timber').box(0.07, 0.09, 0.52, M4(tb.x + s * 0.44, tg + 0.035, tb.z), { wood: WP, j: 2 });
  const dg = ground(-2.62, 2.3);
  X.get('steel').lathe([[0.29, 0], [0.29, 0.28], [0.302, 0.29], [0.29, 0.3], [0.29, 0.58], [0.302, 0.59], [0.29, 0.6], [0.29, 0.88], [0.285, 0.885]], M4(-2.62, dg - 0.02, 2.3, 0, 0.5, 0), 18, { tile: 0.9, cap1: true });
  X.get('steel').lathe([[0.03, 0], [0.03, 0.012]], M4(-2.62 + 0.18, dg + 0.873, 2.3), 8, { tile: 0.3, cap1: true });
  return { X, I, stepTop, toolbox: { ...tb, y: tg }, drum: { x: -2.62, z: 2.3, y: dg } };
}
/** A Pulaski built up local +y: hickory handle, the head across it (axe blade out, adze back). */
function pulaski(B, m, wood, steel) {
  B.get(wood).lathe([[0.017, 0], [0.016, 0.8], [0.019, 0.87]], m, 6, { tile: 0.5 });
  const head = m.clone().multiply(M4(0, 0.87, 0)); B.get(steel).box(0.034, 0.06, 0.3, head, { tile: 0.3 });
  B.get(steel).box(0.012, 0.1, 0.07, head.clone().multiply(M4(0, 0, 0.16)), { tile: 0.3 });
  B.get(steel).box(0.07, 0.012, 0.09, head.clone().multiply(M4(0, -0.02, -0.16, -0.3, 0, 0)), { tile: 0.3 });
}
function shovel(B, m, wood, steel) {
  B.get(steel).box(0.22, 0.27, 0.008, m.clone().multiply(M4(0, 0.135, 0, 0.12, 0, 0)), { tile: 0.4 });
  B.get(steel).lathe([[0.024, 0.26], [0.02, 0.36]], m, 8, { tile: 0.3 });
  B.get(wood).lathe([[0.018, 0.35], [0.017, 1.3], [0.022, 1.33]], m, 6, { tile: 0.5 });
}
/** A backpack pump: a galvanized tank, its cap, the trombone pump along its side, two canvas straps. */
function pump(B, m) {
  B.get('galv').lathe([[0.155, 0], [0.16, 0.02], [0.16, 0.42], [0.13, 0.47], [0.05, 0.49]], m, 14, { tile: 0.5, cap0: true, cap1: true });
  B.get('steelIn').lathe([[0.035, 0.49], [0.035, 0.52]], m, 8, { tile: 0.2, cap1: true });
  for (const d of [-0.025, 0.025]) B.get('steelIn').lathe([[0.012, 0.05], [0.012, 0.5]], m.clone().multiply(M4(0.175 + d, 0, 0.03)), 6, { tile: 0.3 });
  for (const y of [0.12, 0.38]) B.get('canvas').box(0.06, 0.02, 0.33, m.clone().multiply(M4(-0.13, y, 0, 0, 0, 0.2)), { tile: 0.3 });
}

// ------------------------------------------------------------------ the item models (itemsView PROC: bottom-centred)
/** The padlock key: brass, on a split ring and a manila tag typed F.C. 2410-110. Lies flat. */
export function makeCacheKey() {
  const G = new THREE.Group(); G.name = 'FL_cache_key';
  const brass = new THREE.MeshStandardMaterial({ color: 0x9c7c40, roughness: 0.35, metalness: 1 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0035, 6, 16), brass); bow.rotation.x = Math.PI / 2; bow.position.set(-0.024, 0.0035, 0); G.add(bow);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.003, 0.008), brass); blade.position.set(0.006, 0.0025, 0); G.add(blade);
  for (const [x, d] of [[0.012, 0.005], [0.019, 0.004], [0.024, 0.006]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, d), brass); b.position.set(x, 0.0025, -0.004 - d / 2); G.add(b); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0012, 5, 14), new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.3, metalness: 1 })); ring.rotation.x = Math.PI / 2; ring.position.set(-0.04, 0.0015, 0.003); G.add(ring);
  const tex = TEX.keyTag(), plain = new THREE.MeshStandardMaterial({ color: 0xcdb98b, roughness: 0.9 }), face = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }) : plain;
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.0016, 0.04), [plain, plain, face, plain, plain, plain]);
  tag.position.set(-0.085, 0.0008, 0.012); tag.rotation.y = 0.35; G.add(tag);
  return G;
}
/** A boxed pack of instant film: ten exposures (Tillman kept it dry in his coffee can). */
export function makeFilmPack() {
  const G = new THREE.Group(), tex = TEX.film(); G.name = 'FL_film_pack';
  const side = new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.55 }), top = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }) : side;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.028, 0.095), [side, side, top, side, side, side]); b.position.y = 0.014; G.add(b);
  const foil = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.004, 0.02), new THREE.MeshStandardMaterial({ color: 0xb9b8b2, roughness: 0.25, metalness: 1 })); foil.position.set(0, 0.029, -0.036); G.add(foil);
  return G;
}
/** A sealed gallon jug of district water: milky plastic, a blue cap, a masking-tape label in marker. */
export function makeWaterJug() {
  const G = new THREE.Group(); G.name = 'FL_water_jug';
  const plastic = new THREE.MeshStandardMaterial({ color: 0xd6d9d2, roughness: 0.4, metalness: 0 });
  const mb = new MB(); mb.lathe([[0.0, 0], [0.068, 0.002], [0.074, 0.012], [0.075, 0.2], [0.066, 0.235], [0.03, 0.262], [0.02, 0.268], [0.02, 0.28]], new THREE.Matrix4(), 18, { tile: 0.3 });
  G.add(mb.mesh(plastic, 'FL_jug_body'));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.022, 14), new THREE.MeshStandardMaterial({ color: 0x2c5aa0, roughness: 0.45 })); cap.position.y = 0.29; G.add(cap);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 6, 12, Math.PI * 1.1), plastic); handle.position.set(0.052, 0.215, 0); handle.rotation.set(0, 0, -0.6); G.add(handle);
  const tex = TEX.jug(); if (tex) { const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.0755, 0.0755, 0.05, 18, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); lb.position.y = 0.12; G.add(lb); }
  return G;
}

// ------------------------------------------------------------------ the forest: culling standing trees, planting young ones
/** Take standing trees out of the instanced forest (the blowdown's own copy, the trunks on the road bed): their instance
 *  collapses to nothing and their trunk leaves W.trunks / W.trunkGrid (no invisible walls, no shade, no line-of-sight).
 *  list: [[kind, x, z]] → how many were found. */
export function cullTrees(W, list) {
  let n = 0; const Z = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [kind, x, z] of list) {
    const vs = (W.vegSets || []).find((v) => v.kind === kind);
    if (vs && vs.inst && vs.base) { const i = vs.inst.findIndex((p) => Math.abs(p[0] - x) < 0.05 && Math.abs(p[2] - z) < 0.05); if (i >= 0) { vs.base[i] = Z.clone().setPosition(x, -500, z); n++; } }
    const hit = (t) => Math.abs(t[0] - x) < 0.05 && Math.abs(t[1] - z) < 0.05;
    if (W.trunks) for (let i = W.trunks.length - 1; i >= 0; i--) if (hit(W.trunks[i])) W.trunks.splice(i, 1);
    const cell = W.trunkGrid && W.trunkGrid.get(Math.floor(x / 20) + ',' + Math.floor(z / 20));
    if (cell) for (let i = cell.length - 1; i >= 0; i--) if (hit(cell[i])) cell.splice(i, 1);
  }
  if (W.vegSets) W._vegQueue = W.vegSets.slice();   // world.update re-lays the sets over the next frames
  return n;
}
/** Add young firs to the forest's own instanced sapling set (world.js VegSet: same wind, same LOD dissolve, no new draw
 *  calls). plants: [[x, z, rotY, scale]]. Returns false when there's no set to join (then plantOwn draws them). */
export function plantInVegSet(W, plants, heightAt) {
  const vs = (W.vegSets || []).find((v) => v.kind === 'veg_sapling');
  if (!vs || !Array.isArray(vs.inst) || !Array.isArray(vs.base) || !Array.isArray(vs.meshes) || !plants.length) return false;
  const n = vs.inst.length + plants.length;
  for (const parts of vs.meshes) for (const im of parts) {   // room for the new instances (a set is sized when it's made)
    if (!im.isInstancedMesh || !im.instanceMatrix) return false;
    const a = new Float32Array(n * 16); a.set(im.instanceMatrix.array.subarray(0, Math.min(im.instanceMatrix.array.length, n * 16)));
    const ia = new THREE.InstancedBufferAttribute(a, 16); ia.setUsage(THREE.DynamicDrawUsage); im.instanceMatrix = ia;
    if (im.geometry.attributes.instFade) { const fa = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); fa.setUsage(THREE.DynamicDrawUsage); im.geometry.setAttribute('instFade', fa); }
  }
  const up = new V3(0, 1, 0), q = new THREE.Quaternion(), p = new V3(), s = new V3();
  for (const [x, z, r, sc] of plants) {   // seated like world.js seats a sapling: upright, sunk 0.2 m (+ a little on a slope)
    const dx = heightAt(x + 1, z) - heightAt(x - 1, z), dz = heightAt(x, z + 1) - heightAt(x, z - 1), slope = Math.hypot(dx, dz) / 2;
    vs.inst.push([x, heightAt(x, z) - 0.1, z, r, sc]);
    vs.base.push(new THREE.Matrix4().compose(p.set(x, heightAt(x, z) - 0.2 - slope * 0.2 * sc, z), q.setFromAxisAngle(up, r), s.setScalar(sc)));
  }
  vs.cur = null; vs.fading = null;   // its LOD state is re-made for the new length on the next pass
  W._vegQueue = W.vegSets.slice();
  return true;
}
/** No forest set to join (a world without scatter): our own instanced young firs from the sapling GLB, LOD by distance. */
async function plantOwn(engine, group, plants) {
  const e = engine.manifest && engine.manifest.models && engine.manifest.models.veg_sapling; if (!e) return null;
  const g = await loadGLB('assets/' + e.path), root = g.scene; root.updateMatrixWorld(true);
  const lods = [0, 1, 2].map((i) => root.getObjectByName(`veg_sapling_LOD${i}`)).filter(Boolean); if (!lods.length) return null;
  const H = engine.world.heightAt, sets = lods.map((l) => {
    const parts = []; const inv = new THREE.Matrix4().copy(l.matrixWorld).invert();
    l.traverse((o) => { if (!o.isMesh) return; const m = o.material.clone(); m.vertexColors = false; if (/foliage|impostor/i.test(m.name)) { m.alphaTest = 0.42; m.transparent = false; m.side = THREE.DoubleSide; }
      const im = new THREE.InstancedMesh(o.geometry, m, plants.length); im.frustumCulled = false; im.count = 0; im.castShadow = l === lods[0]; im.receiveShadow = true; im.userData.part = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); group.add(im); parts.push(im); });
    return parts;
  });
  const base = plants.map(([x, z, r, sc]) => new THREE.Matrix4().compose(new V3(x, H(x, z) - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), r), new V3(sc, sc, sc)));
  const ranges = [30, 140, 900], tmp = new THREE.Matrix4();
  return (cam) => {
    const cnt = sets.map(() => 0);
    plants.forEach((pl, i) => { const d = Math.hypot(pl[0] - cam.x, pl[1] - cam.z); const li = ranges.findIndex((r) => d < r); if (li < 0 || li >= sets.length) return; const k = cnt[li]++; for (const im of sets[li]) { tmp.multiplyMatrices(base[i], im.userData.part); im.setMatrixAt(k, tmp); } });
    sets.forEach((parts, li) => parts.forEach((im) => { im.count = cnt[li]; im.instanceMatrix.needsUpdate = true; }));
  };
}

// ------------------------------------------------------------------ the whole thing
/**
 * Build it all (call once at init, BEFORE the item surfaces are built: its static roots join W.modelRoots so things can be
 * set down on the shelves). H (hooks, all optional):
 *   flags() → the game's flags object (read every frame; the door / scare write it)
 *   play(name, pos: Vector3, volume) · sfx(set, pos, volume) · fear(k, why) · quiet(sec) · duck(sec) · dog(kind, pos) → bool
 *   say(key) (a content/story.js LINES key) · found(id) (a northWoods.discover id: pencil, sounds, log)
 * → the API documented at the bottom (update(dt, ctx) every frame).
 */
export function createFireCache(engine, H = {}) {
  const { scene } = engine, W = engine.world, heightAt = W.heightAt || (() => 0);
  const flags = () => (H.flags ? H.flags() : {}) || {};
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0), t0 = now(), timings = []; const mark = (k) => timings.push([k, Math.round(now() - t0)]);
  const M = makeMaterials(W), R = rng(1958);
  const baseY = heightAt(NWD.cache.pos[0], NWD.cache.pos[1]);
  const localGround = (lx, lz) => { const w = cacheToWorld([lx, 0, lz], 0); return heightAt(w[0], w[2]) - baseY; };
  const colliders = [];
  const colBox = (parent, name, sx, sy, sz, m, type = 'wall', enabled = true) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false })); o.name = name; o.visible = false;
    o.applyMatrix4(m); parent.add(o); parent.updateWorldMatrix(true, false); o.updateMatrixWorld(true);
    const c = { name, type, mesh: o, enabled }; colliders.push(c); return c;
  };

  // ---------------------------------------------------------------- the cache
  const cache = new THREE.Group(); cache.name = 'FL_fire_cache';
  cache.position.set(NWD.cache.pos[0], baseY, NWD.cache.pos[1]); cache.rotation.y = NWD.cache.rotY;
  const shell = new THREE.Group(); shell.name = 'fire_cache_static';
  const interior = new THREE.Group(); interior.name = 'fire_cache_interior';
  const moving = new THREE.Group(); moving.name = 'fire_cache_moving';
  cache.add(shell, interior, moving); scene.add(cache);
  mark('materials'); const B = buildBuilding(M, localGround, R); mark('building');
  for (const m of B.X.meshes(M, 'FL_cache_')) shell.add(m);
  for (const m of B.I.meshes(M, 'FL_cache_in_')) interior.add(m);
  // decals: the gable sign's letters, the tool rack board, the box's stencil, the drum's chalk, the sheet, the hose ends
  const decals = [];
  const decal = (group, tex, w, h, m, o = {}) => { const mat = tex && tex.isMaterial ? tex : decalMat(tex, o); if (!mat) return null; const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); q.applyMatrix4(m); q.receiveShadow = true; q.castShadow = false; group.add(q); decals.push(q); return q; };
  decal(shell, TEX.sign(), 1.56, 0.354, M4(0, 2.63, CD + 0.051));
  decal(interior, TEX.rack(), 0.95, 0.2, M4(0, 1.8, -CD + 0.0885), { envMapIntensity: 0.3 });
  decal(shell, TEX.tools(), 0.9, 0.36, M4(B.toolbox.x, B.toolbox.y + 0.3, B.toolbox.z + 0.2265));
  { const cm = decalMat(TEX.chalk(), { roughness: 1 }); if (cm) { const q = new THREE.Mesh(new THREE.CylinderGeometry(0.294, 0.294, 0.16, 10, 1, true, Math.PI * 1.5 - 0.6, 1.2), cm); q.position.set(B.drum.x, B.drum.y + 0.5, B.drum.z); shell.add(q); decals.push(q); } }
  decal(interior, TEX.sheet(), 0.2, 0.275, M4(-2.04, 1.44, 1.77, 0, Math.PI / 2, 0), { roughness: 0.95, envMapIntensity: 0.4 });
  { const hm = decalMat(TEX.hose(), { color: 0xcfc6ad, envMapIntensity: 0.3 }); for (const z of HOSES) for (const s of [-1, 1]) decal(interior, hm, 0.4, 0.4, M4(-1.8 + s * 0.0385, CACHE_SHELVES[0] + 0.2, z, 0, s * Math.PI / 2, 0)); }

  // moving parts: the door (on its hinge), the hasp, staple and padlock, the toolbox lid and its seal, the Pulaskis, the boot
  const door = new THREE.Group(); door.name = 'FL_cache_door'; door.position.set(-0.65, 0.2, CD + 0.02); moving.add(door);
  const hasp = new THREE.Group(); hasp.name = 'FL_cache_hasp'; hasp.position.set(1.16, 0.9, 0.021); door.add(hasp);
  { const D = new Bins();
    for (let i = 0; i < 5; i++) D.get('timber').box(0.254, 2.03, 0.035, M4(0.13 + i * 0.26, 1.015, 0), { wood: WP, j: (i * 3) % 7, r: R() });
    for (const y of [0.35, 1.72]) D.get('timber').box(1.2, 0.12, 0.025, M4(0.65, y, -0.03), { wood: WP, j: 2 });
    { const { m, L } = memberM(new V3(0.14, 0.42, -0.03), new V3(1.16, 1.64, -0.03)); D.get('timber').box(0.025, 0.11, L, m, { wood: WP, j: 5 }); }
    for (const y of [0.4, 1.75]) { D.get('steel').box(0.55, 0.045, 0.006, M4(0.28, y, 0.021), { tile: 0.4 }); D.get('steel').lathe([[0.012, -0.05], [0.012, 0.05]], M4(-0.01, y, 0.02), 8, { tile: 0.2, cap0: true, cap1: true }); }
    D.get('steel').box(0.03, 0.12, 0.02, M4(1.08, 1.0, 0.035), { tile: 0.2 });
    for (const m of D.meshes(M, 'FL_cache_door_')) door.add(m);
    const hp = new MB(); hp.box(0.2, 0.045, 0.006, M4(0.1, 0, 0), { tile: 0.3 }); hp.lathe([[0.006, -0.025], [0.006, 0.025]], M4(0, 0, 0), 6, { tile: 0.1 }); hasp.add(hp.mesh(M.steel, 'FL_cache_hasp_plate'));
    decal(door, TEX.tally(), 0.24, 0.18, M4(0.42, 1.42, -0.0185, 0, Math.PI, 0), { envMapIntensity: 0.4 }); }
  const staple = new THREE.Group(); staple.name = 'FL_cache_staple'; staple.position.set(0.69, 1.1, CD + 0.045); moving.add(staple);
  { const sb = new MB(); sb.box(0.012, 0.055, 0.004, M4(0, 0, -0.014), { tile: 0.1 }); sb.box(0.012, 0.012, 0.03, M4(0, 0.022, 0), { tile: 0.1 }); sb.box(0.012, 0.012, 0.03, M4(0, -0.022, 0), { tile: 0.1 }); sb.box(0.012, 0.055, 0.006, M4(0, 0, 0.014), { tile: 0.1 }); staple.add(sb.mesh(M.steel, 'FL_cache_staple_mesh')); }
  const padlock = new THREE.Group(); padlock.name = 'FL_cache_padlock'; padlock.position.set(0.69, 1.07, CD + 0.062); moving.add(padlock);
  { const pb = new MB(); pb.box(0.05, 0.056, 0.022, M4(0, -0.035, 0), { tile: 0.1 }); padlock.add(pb.mesh(M.brass, 'FL_cache_padlock_body'));
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0042, 6, 12, Math.PI), M.steel); sh.position.set(0, -0.007, 0); padlock.add(sh); }
  const lockHome = { padlock: padlock.position.clone(), prot: padlock.rotation.clone(), staple: staple.position.clone(), srot: staple.rotation.clone() };
  const lid = new THREE.Group(); lid.name = 'FL_cache_toolbox_lid'; lid.position.set(B.toolbox.x, B.toolbox.y + 0.5, B.toolbox.z - 0.225); moving.add(lid);
  { const lb = new MB(); lb.box(1.14, 0.035, 0.48, M4(0, 0.0175, 0.24), { tile: 0.8 }); lid.add(lb.mesh(M.red, 'FL_cache_lid')); }
  const seal = new THREE.Group(); seal.name = 'FL_cache_toolbox_seal'; seal.position.set(B.toolbox.x, B.toolbox.y + 0.47, B.toolbox.z + 0.236); moving.add(seal);
  { const sm = new MB(); sm.lathe([[0.008, -0.004], [0.008, 0.004]], M4(0, -0.03, 0, Math.PI / 2, 0, 0), 8, { tile: 0.1, cap0: true, cap1: true }); seal.add(sm.mesh(M.galv, 'FL_cache_seal_lead'));
    const wl = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0012, 4, 12), M.steel); wl.position.y = -0.012; seal.add(wl); }
  const pulaskiBox = new THREE.Group(); pulaskiBox.name = 'FL_cache_pulaski_box'; moving.add(pulaskiBox);
  { const pb = new Bins(); pulaski(pb, M4(B.toolbox.x - 0.4, B.toolbox.y + 0.2, B.toolbox.z + 0.05, 0, 0, -Math.PI / 2 + 0.08), 'timber', 'steel'); for (const m of pb.meshes(M, 'FL_cache_pbox_')) pulaskiBox.add(m); }
  const pulaskiOut = new THREE.Group(); pulaskiOut.name = 'FL_cache_pulaski_out'; moving.add(pulaskiOut);
  { const pb = new Bins(); pulaski(pb, M4(1.02, localGround(1.02, CD + 0.32) + 0.01, CD + 0.32, -0.3, 0, 0.05), 'timber', 'steel'); for (const m of pb.meshes(M, 'FL_cache_pout_')) pulaskiOut.add(m); }
  pulaskiOut.visible = false;
  const boot = new THREE.Group(); boot.name = 'FL_cache_boot'; boot.position.set(...CACHE_LOCAL.boot); boot.rotation.y = 0.45; moving.add(boot);
  { const bb = new MB(); bb.lathe([[0.05, 0], [0.052, 0.06], [0.05, 0.36], [0.052, 0.37]], M4(0, 0, -0.03), 12, { tile: 0.3, cap0: true }); bb.box(0.1, 0.07, 0.24, M4(0, 0.035, 0.02), { tile: 0.3 }); boot.add(bb.mesh(M.rubber, 'FL_cache_boot_fb')); }

  // colliders (cache-local boxes; the door has one shut and one standing open)
  const cols = new THREE.Group(); cols.name = 'fire_cache_cols'; cache.add(cols); cache.updateMatrixWorld(true);
  colBox(cols, 'COL_wall_cache_back', 4.3, 2.6, 0.12, M4(0, 1.3, -CD));
  for (const s of [-1, 1]) { colBox(cols, 'COL_wall_cache_side' + s, 0.12, 2.6, 6.1, M4(s * CW, 1.3, 0)); colBox(cols, 'COL_wall_cache_front' + s, 1.5, 2.6, 0.12, M4(s * 1.4, 1.3, CD)); colBox(cols, 'COL_wall_cache_shelf' + s, 0.5, 2.1, 4.2, M4(s * 1.8, 1.05, -0.6)); }
  const doorShutCol = colBox(cols, 'COL_wall_cache_door', 1.3, 2.05, 0.08, M4(0, 0.2 + 1.025, CD), 'wall', true);
  const th = -105 * Math.PI / 180, doorOpenCol = colBox(cols, 'COL_wall_cache_door_open', 1.3, 2.05, 0.06, M4(-0.65 + 0.65 * Math.cos(th), 1.225, CD + 0.02 - 0.65 * Math.sin(th), 0, th, 0), 'wall', false);
  colBox(cols, 'COL_floor_cache', 4.2, 0.1, 6.0, M4(0, CACHE_FLOOR - 0.05, 0), 'floor');
  { const a = Math.atan2(CACHE_FLOOR - B.stepTop + 0.02, 0.95); colBox(cols, 'COL_ramp_cache_step', 1.3, 0.04, 0.98, M4(0, (CACHE_FLOOR + B.stepTop) / 2 - 0.03, CD + 0.47, a, 0, 0), 'ramp'); }
  colBox(cols, 'COL_wall_cache_rack', 2.9, 1.5, 0.3, M4(0, 0.95, -CD + 0.2));
  colBox(cols, 'COL_wall_cache_pump', 0.36, 0.55, 0.36, M4(1.28, CACHE_FLOOR + 0.27, -1.52));
  colBox(cols, 'COL_wall_cache_toolbox', 1.2, 0.62, 0.55, M4(B.toolbox.x, B.toolbox.y + 0.3, B.toolbox.z));
  colBox(cols, 'COL_wall_cache_drum', 0.62, 0.95, 0.62, M4(B.drum.x, B.drum.y + 0.45, B.drum.z));

  // ---------------------------------------------------------------- the woods (world coordinates)
  const woods = new THREE.Group(); woods.name = 'FL_north_woods'; scene.add(woods);
  mark('cache parts'); const culled = cullTrees(W, NWD.cull); mark('cull');
  // the phone line: down the NE leg, to the fence post, north on the insulators, down under the blowdown into the thicket
  const Wr = NWD.wire, legS = (y) => 4.75 + (2.6 - 4.75) * (y - 0.45) / (29.42 - 0.45);
  const wirePts = [], add = (p) => { if (!wirePts.length || wirePts[wirePts.length - 1].distanceTo(p) > 0.02) wirePts.push(p); };
  const span = (a, b, sagPerM = 0.028, step = 0.6) => { const L = a.distanceTo(b), n = Math.max(2, Math.ceil(L / step)), sag = L * sagPerM; for (let i = 0; i <= n; i++) { const t = i / n; add(new V3().lerpVectors(a, b, t).add(new V3(0, -4 * sag * t * (1 - t), 0))); } };
  for (const y of [Wr.legTop, Wr.bracketY]) { const s = legS(y) + 0.2; add(new V3(s, y, -s)); }
  const bracket = wirePts[wirePts.length - 1].clone();
  span(bracket, new V3(Wr.tie[0] + 0.05, Wr.tie[1], Wr.tie[2] - 0.05), 0.05, 0.3);
  const insMats = [], insPos = [], brk = new MB(), ins = [];
  let last = new V3(Wr.tie[0], Wr.tie[1], Wr.tie[2]);
  Wr.trees.forEach(([x, z, , , r], i) => {
    const nxt = Wr.trees[i + 1] || [NWD.blowdown.root[0], NWD.blowdown.root[1]], prv = i ? Wr.trees[i - 1] : [Wr.tie[0], Wr.tie[2]];
    const dir = new V3(nxt[0] - prv[0], 0, nxt[1] - prv[1]).normalize(), e = new V3(-dir.z, 0, dir.x); if (e.x < 0) e.negate();   // mounted on the east side
    const gy = heightAt(x, z), my = gy + Wr.mount, rot = Math.atan2(e.x, e.z);
    brk.box(0.08, 0.3, 0.13, new THREE.Matrix4().makeRotationY(rot).setPosition(x + e.x * (r + 0.005), my - 0.06, z + e.z * (r + 0.005)), { wood: WP, j: i });   // block nailed on (half in the bark)
    brk.box(0.05, 0.05, 0.17, new THREE.Matrix4().makeRotationY(rot).setPosition(x + e.x * (r + 0.13), my + 0.03, z + e.z * (r + 0.13)), { wood: WP, j: i + 2 });
    brk.lathe([[0.013, 0.055], [0.011, 0.12]], new THREE.Matrix4().setPosition(x + e.x * (r + 0.19), my, z + e.z * (r + 0.19)), 6, { tile: 0.2 });
    const top = new V3(x + e.x * (r + 0.19), my + 0.055, z + e.z * (r + 0.19));
    const im = insulatorMat(); insMats.push(im); insPos.push(top.clone().add(new V3(0, 0.06, 0)));
    const ib = new MB(); insulator(ib, new THREE.Matrix4().setPosition(top.x, top.y, top.z)); const mesh = ib.mesh(im, 'FL_nw_insulator_' + (i + 1)); woods.add(mesh); ins.push(mesh);
    const wp = top.clone().add(new V3(-e.x * 0.036, 0.068, -e.z * 0.036));
    span(last, wp); last = wp;
  });
  // past the fourth: the line was pulled down with the fifth tree; slack to the ground, under the log, into the young fir
  const BL = blowdownLine(), gnd = (x, z, d = 0.02) => new V3(x, heightAt(x, z) + d, z);
  span(last, gnd(15.0, -89.8, 0.03), 0.09, 0.5);
  for (const [x, z] of [[15.2, -91.5], [15.35, -93.2], [15.5, -94.7], [15.7, -96.3], [16.1, -98.2], [16.6, -100.4], [17.1, -102.5], [17.5, -104.6]]) add(gnd(x, z, 0.015));
  const wm = new MB(); wm.tube(wirePts, 0.0055, 4, 0.6); woods.add(wm.mesh(M.wire, 'FL_nw_phone_wire', false));
  // the tie round the fence post, the leg bracket, and the fifth insulator smashed by the log
  { const tb = new MB(); tb.lathe([[0.075, -0.012], [0.075, 0.012]], new THREE.Matrix4().setPosition(Wr.tie[0], Wr.tie[1], Wr.tie[2]), 10, { tile: 0.2 });
    tb.box(0.06, 0.04, 0.3, new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(bracket.x - 0.1, bracket.y, bracket.z + 0.1), { tile: 0.3 });
    woods.add(tb.mesh(M.steel, 'FL_nw_wire_hardware')); }
  // the blowdown: a Douglas fir down toward 250 degrees, root plate up, the top snapped off, branch stubs
  const blow = new THREE.Group(); blow.name = 'FL_nw_blowdown'; woods.add(blow);
  const log = buildLog(heightAt, R);
  const logMesh = log.bark.mesh(M.bark, 'FL_nw_blowdown_log'); blow.add(logMesh);
  blow.add(log.wood.mesh(M.timber, 'FL_nw_blowdown_break'), log.soil.mesh(M.soil, 'FL_nw_blowdown_rootplate'));
  { const top = log.at(3.5 / BL.len);
    const bm = new MB(); bm.box(0.13, 0.08, 0.3, new THREE.Matrix4().makeRotationY(Math.atan2(BL.dir[0], BL.dir[1])).setPosition(top.x, top.y + log.r(3.5 / BL.len) - 0.01, top.z), { wood: WP, j: 3 }); blow.add(bm.mesh(M.timber, 'FL_nw_blowdown_bracket'));
    const sm = new MB(), gm = insulatorMat(); insMats.push(gm); insPos.push(new V3(15.3, heightAt(15.3, -94.1) + 0.05, -94.1));
    insulator(sm, new THREE.Matrix4().makeRotationZ(1.3).setPosition(15.35, heightAt(15.35, -94.05) + 0.04, -94.05), Math.PI * 0.9);
    const S = rng(55); for (let k = 0; k < 9; k++) { const sx = 15.0 + S() * 0.9, sz = -94.6 + S() * 1.0, s = 0.01 + S() * 0.02; sm.box(s, 0.004, s * 1.6, new THREE.Matrix4().makeRotationY(S() * 6).setPosition(sx, heightAt(sx, sz) + 0.004, sz), { tile: 0.1 }); }
    const sh = sm.mesh(gm, 'FL_nw_insulator_5', false); woods.add(sh); ins.push(sh); }
  { colBox(woods, 'COL_wall_blowdown', 0.85, 1.1, BL.len, new THREE.Matrix4().makeRotationY(Math.atan2(BL.dir[0], BL.dir[1])).setPosition((BL.root[0] + BL.top[0]) / 2, (log.at(0).y + log.at(1).y) / 2, (BL.root[1] + BL.top[1]) / 2)); }
  woods.add(brk.mesh(M.timber, 'FL_nw_insulator_brackets')); mark('wire + log');
  // Tillman's flagging: a wrap of orange tape round each trunk at 1.7 m, a knot, two tails that move in the wind
  const band = new MB(), tails = [];
  NWD.flags.forEach(([x, z, , , r], i) => {
    const y = heightAt(x, z) + NWD.flagHeight, rr = r * 1.03 + 0.012, prev = i ? NWD.flags[i - 1] : [BL.top[0], BL.top[1]];
    band.lathe([[rr, -0.016], [rr * 1.01, 0.016]], new THREE.Matrix4().setPosition(x, y, z), 14, { tile: 0.3 });
    const toward = new V3(prev[0] - x, 0, prev[1] - z).normalize(), k = new V3(x, y, z).addScaledVector(toward, rr + 0.004);   // the knot faces the way you came
    band.box(0.035, 0.03, 0.02, new THREE.Matrix4().makeRotationY(Math.atan2(toward.x, toward.z)).setPosition(k.x, k.y, k.z), { tile: 0.1 });
    for (const s of [-1, 1]) tails.push({ root: k.clone().add(new V3(0, -0.01, 0)), side: new V3(-toward.z, 0, toward.x).multiplyScalar(s * 0.012), out: toward.clone(), len: 0.3 + i * 0.013 + (s > 0 ? 0.06 : 0), ph: i * 1.7 + s });
  });
  woods.add(band.mesh(M.tape, 'FL_nw_flag_bands', false));
  const TS = 7, tailGeo = new THREE.BufferGeometry(), tailPos = new Float32Array(tails.length * (TS + 1) * 2 * 3), tailIdx = [];
  tails.forEach((_, t) => { const o = t * (TS + 1) * 2; for (let s = 0; s < TS; s++) { const a = o + s * 2; tailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3).setUsage(THREE.DynamicDrawUsage)); tailGeo.setIndex(tailIdx);
  const tailMesh = new THREE.Mesh(tailGeo, M.tape); tailMesh.name = 'FL_nw_flag_tails'; tailMesh.frustumCulled = false; woods.add(tailMesh);
  const flutter = (t, wind) => {
    tails.forEach((T, n) => {
      const o = n * (TS + 1) * 2 * 3, p = T.root.clone();
      for (let s = 0; s <= TS; s++) {
        const k = s / TS, sw = (0.2 + wind * 0.9) * (0.55 + 0.45 * Math.sin(t * (2.6 + wind * 3) + T.ph + k * 2.2)) * (0.3 + k), d = new V3(T.out.x * sw + Math.sin(t * 1.7 + T.ph) * 0.15 * k, -1 + sw * 0.35, T.out.z * sw + Math.cos(t * 1.3 + T.ph) * 0.15 * k).normalize();
        if (s) p.addScaledVector(d, T.len / TS);
        tailPos[o + s * 6] = p.x - T.side.x; tailPos[o + s * 6 + 1] = p.y; tailPos[o + s * 6 + 2] = p.z - T.side.z;
        tailPos[o + s * 6 + 3] = p.x + T.side.x; tailPos[o + s * 6 + 4] = p.y; tailPos[o + s * 6 + 5] = p.z + T.side.z;
      }
    });
    tailGeo.attributes.position.needsUpdate = true; tailGeo.computeVertexNormals();
  };
  flutter(0, 0.3);
  // the sign on the road bed: a leaning pipe post, the rusted plate (beads left in it), the board that fell off it
  const sgn = new THREE.Group(); sgn.name = 'FL_nw_road_sign'; const sp = NWD.sign.pos, sgy = heightAt(sp[0], sp[1]);
  sgn.position.set(sp[0], sgy, sp[1]); sgn.rotation.y = NWD.sign.rotY; woods.add(sgn);
  const lean = new THREE.Group(); lean.rotation.set(-0.05, 0, 0.14); sgn.add(lean);
  { const pm = new MB(); pm.lathe([[0.03, -0.45], [0.03, 2.05], [0.034, 2.06], [0.034, 2.09], [0.001, 2.1]], new THREE.Matrix4(), 10, { tile: 0.6 });
    for (const y of [1.62, 1.93]) pm.lathe([[0.012, 0], [0.012, 0.02]], M4(0, y, 0.043, Math.PI / 2, 0, 0), 6, { tile: 0.1, cap1: true });
    lean.add(pm.mesh(M.steel, 'FL_nw_sign_post'));
    const plateMat = M.steel.clone(); plateMat.name = 'FL_nw_sign_plate'; const pt = TEX.plate(); if (pt) { plateMat.map = pt; plateMat.color.set(0xffffff); }
    const pl = new MB(); pl.box(0.75, 0.45, 0.005, M4(0, 1.78, 0.036), { tile: 0.6 }); lean.add(pl.mesh(M.steel, 'FL_nw_sign_plate_back'));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.45), plateMat); face.name = 'FL_nw_sign_plate'; face.position.set(0, 1.78, 0.0392); face.castShadow = true; face.receiveShadow = true; lean.add(face);
    const bm = new MB(), BR = rng(3); for (let k = 0; k < 9; k++) { const u = 0.2 + BR() * 0.6, v = 0.1 + BR() * 0.25; bm.lathe([[0.009, 0], [0.006, 0.004], [0.001, 0.006]], M4((u - 0.5) * 0.75, 1.78 - 0.225 + v * 0.45, 0.0395, Math.PI / 2, 0, 0), 6, { tile: 0.05 }); }
    lean.add(bm.mesh(M.bead, 'FL_nw_sign_beads', false));
    colBox(sgn, 'COL_wall_road_sign', 0.2, 2.2, 0.2, M4(0.1, 1.0, 0)); }
  const signIA = new V3(0, 1.78, 0.06).applyEuler(lean.rotation).applyEuler(sgn.rotation).add(sgn.position);
  { const [bx, bz, dx, dz] = pointAt(NWD.road.points, SIGN_S + 1.4), yaw = Math.atan2(-dz, dx), cx = bx - dz * 0.7, cz = bz + dx * 0.7, by = heightAt(cx, cz);
    const bd = new MB(); bd.box(1.3, 0.035, 0.24, new THREE.Matrix4(), { wood: WB, tile: 1.4, grain: 0 }); const board = bd.mesh(M.sign, 'FL_nw_fallen_board'); board.position.set(cx, by + 0.012, cz); board.rotation.set(0.03, yaw, -0.04); woods.add(board);
    const ft = decalMat(TEX.fallen()); if (ft) { const q = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.22), ft); q.rotation.x = -Math.PI / 2; q.position.y = 0.0185; board.add(q); }
    const lt = decalMat(TEX.litter(), { roughness: 1 }); if (lt) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.34), lt); q.rotation.set(-Math.PI / 2, 0, 0.2); q.position.set(-0.42, 0.022, 0.01); board.add(q); } }
  // the ruts: two packed wheel tracks with duff between, draped on the ground from the washout to the pad
  const ruts = (() => {
    const tex = TEX.ruts(); if (!tex) return null;
    const pos = [], uv = [], idx = [], cols = 5, half = 1.45;
    let n = 0; for (let s = 1.5; s < ROAD_LEN - 5; s += 1, n++) {
      const [x, z, dx, dz] = pointAt(NWD.road.points, s), [, , dx2, dz2] = pointAt(NWD.road.points, Math.min(ROAD_LEN, s + 1.5)); const tx = dx + dx2, tz = dz + dz2, l = Math.hypot(tx, tz) || 1;
      for (let c = 0; c < cols; c++) { const u = c / (cols - 1), off = (u - 0.5) * 2 * half, px = x - (tz / l) * off, pz = z + (tx / l) * off; pos.push(px, heightAt(px, pz) + 0.05, pz); uv.push(u, s / 4); }
    }
    for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) { const a = i * cols + c, b = a + cols; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const m = new THREE.Mesh(g, mat); m.name = 'FL_nw_ruts'; m.receiveShadow = true; m.renderOrder = 1; woods.add(m); return m;
  })();
  // the washout: the road runs into a slide: a raw mound of dirt, the old culvert sticking out of it, roots, a couple of rocks
  const wash = new THREE.Group(); wash.name = 'FL_nw_washout'; woods.add(wash);
  { const [wx, wz] = NWD.road.washout, S = rng(12), sm = new MB(), n = 14, rings = 5;
    for (let i = 0; i <= rings; i++) for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2, t = i / rings, r = (2.6 + 0.8 * Math.sin(a * 2 + 1) + 0.3 * S()) * Math.sin(t * Math.PI / 2 + 0.0001), x = wx + Math.cos(a) * r * 1.1, z = wz + Math.sin(a) * r * 0.85, hgt = 1.15 * Math.cos(t * Math.PI / 2) ** 1.4 * (0.8 + 0.4 * S());
      sm.v(new V3(x, heightAt(x, z) - 0.15 + hgt, z), new V3(0, 1, 0), x / 0.8, z / 0.8); }
    for (let i = 0; i < rings; i++) for (let k = 0; k < n; k++) { const a = i * (n + 1) + k, b = a + n + 1; sm.I.push(a, a + 1, b, a + 1, b + 1, b); }
    const mound = sm.mesh(M.soil, 'FL_nw_washout_mound'); mound.geometry.computeVertexNormals(); wash.add(mound);
    const cm = new MB(), cyaw = 0.15, cx = wx + 2.1, cz = wz + 0.4, cy = heightAt(cx, cz) + 0.05;
    cm.lathe([[0.3, -1.1], [0.3, 1.1]], M4(cx, cy, cz, Math.PI / 2 - 0.12, cyaw, 0), 16, { tile: 0.9 }); cm.lathe([[0.285, -1.1], [0.285, 1.1]], M4(cx, cy, cz, Math.PI / 2 - 0.12, cyaw, 0), 16, { tile: 0.9, inside: true });
    wash.add(cm.mesh(M.steel, 'FL_nw_culvert')); }

  // the thicket + the saplings in the ruts: into the forest's own set if there is one
  const avoid = (x, z) => { const cell = W.trunkGrid && W.trunkGrid.get(Math.floor(x / 20) + ',' + Math.floor(z / 20)); if (cell) for (const t of cell) if (Math.hypot(t[0] - x, t[1] - z) < t[2] * 0.75 + 0.7) return true; return false; };
  mark('sign, ruts, washout'); const plants = thicketPlants({ avoid }); mark('plants');
  let ownThicket = null;
  const thicketGroup = new THREE.Group(); thicketGroup.name = 'FL_nw_thicket'; woods.add(thicketGroup);
  const inForest = plantInVegSet(W, plants, heightAt); mark('planted');

  // everything static that you can set things on joins the item surfaces; everything solid joins the colliders
  W.modelRoots = W.modelRoots || []; const surfaceRoots = [shell, interior, blow]; W.modelRoots.push(...surfaceRoots);
  W.colliders = W.colliders || []; W.colliders.push(...colliders);
  if (engine.player && engine.player.rebuildColliders) engine.player.rebuildColliders();

  // ---------------------------------------------------------------- what needs fetching (all already loaded by the world)
  const fetchModel = (name) => { const e = engine.manifest && engine.manifest.models && engine.manifest.models[name]; return e ? loadGLB('assets/' + e.path).catch(() => null) : Promise.resolve(null); };
  const ready = Promise.all([
    fetchModel('veg_fir_a').then((g) => { let bark = null; if (g) g.scene.traverse((o) => { if (!bark && o.isMesh && /fir_bark/i.test(o.material && o.material.name)) bark = o.material; });
      if (bark) { const b = bark.clone(); b.vertexColors = false; b.color.multiply(new THREE.Color(0.66, 0.72, 0.76)); b.name = 'FL_nw_bark'; logMesh.material = b; M.bark = b; } }),
    fetchModel('veg_roots').then((g) => { if (!g) return; let n = 0;
      for (const [rot, sc] of [[0, 1.35], [1.3, 1.1]]) { const r = g.scene.clone(true); r.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), log.plateNormal); r.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), rot)); r.scale.setScalar(sc); r.position.copy(log.plateCentre).addScaledVector(log.plateNormal, 0.2 + n * 0.02); blow.add(r); n++; }
      const r2 = g.scene.clone(true); r2.position.set(NWD.road.washout[0] + 1.2, heightAt(NWD.road.washout[0] + 1.2, NWD.road.washout[1] - 0.8) + 0.5, NWD.road.washout[1] - 0.8); r2.rotation.set(0.9, 0.4, 0); r2.scale.setScalar(1.2); wash.add(r2); }),
    fetchModel('prop_rubber_boot_fallen').then((g) => { let m = null; if (g) g.scene.traverse((o) => { if (!m && o.isMesh) m = o; });   // the camp boot's mate: same boot, standing
      if (m) { boot.clear(); const b = new THREE.Mesh(m.geometry, m.material); b.castShadow = true; b.receiveShadow = true; b.name = 'FL_cache_boot'; boot.add(b); } }),
    inForest ? Promise.resolve() : plantOwn(engine, thicketGroup, plants).then((f) => { ownThicket = f; }).catch(() => {}),
  ]).catch((err) => console.warn('fire cache', err));

  // ---------------------------------------------------------------- per frame
  const world = (l) => { const w = cacheToWorld(l, baseY); return new V3(w[0], w[1], w[2]); };
  const anchors = { wire: new V3(...Wr.ia), sign: signIA, door: world(CACHE_LOCAL.door), doorIn: world(CACHE_LOCAL.doorIn), sheet: world(CACHE_LOCAL.sheet), toolbox: world(CACHE_LOCAL.toolbox) };
  const haspW = world([0.69, 1.08, CD + 0.06]), doorW = world([0, 1.2, CD + 0.1]), bootW = world([CACHE_LOCAL.boot[0], CACHE_LOCAL.boot[1] + 0.2, CACHE_LOCAL.boot[2]]);
  const cachePos = new V3(NWD.cache.pos[0], baseY, NWD.cache.pos[1]), signPos = new V3(sp[0], sgy, sp[1]), blowPos = new V3(BL.mid[0], heightAt(BL.mid[0], BL.mid[1]), BL.mid[1]);
  const flagMid = new V3(-4, 0, -125), rm = pointAt(NWD.road.points, ROAD_LEN / 2), roadMid = new V3(rm[0], 0, rm[1]);
  let doorA = 0, lidA = 0, slam = false, openFor = 0, scare = null, rattle = 0, discT = 0, thT = 0, bootWatch = false, tailT = 0;
  const tmp = new V3();
  function applyState(f, snapNow = false) {
    const L = cacheLock(f), dT = f.cacheDoorOpen ? 1 : 0, lT = f.toolboxOpen ? 1 : 0;
    if (snapNow) { doorA = dT; lidA = lT; slam = false; }
    padlock.visible = L !== 'unlocked'; staple.visible = true;
    if (L === 'broken') {   // torn out: staple and lock on the step, the hasp hanging off the door
      padlock.position.set(0.52, B.stepTop + 0.014, CD + 0.42); padlock.rotation.set(Math.PI / 2, 0, 0.7);
      staple.position.set(0.75, B.stepTop + 0.008, CD + 0.62); staple.rotation.set(Math.PI / 2, 0, 1.9); hasp.rotation.z = -1.25;
    } else { padlock.position.copy(lockHome.padlock); padlock.rotation.copy(lockHome.prot); staple.position.copy(lockHome.staple); staple.rotation.copy(lockHome.srot); hasp.rotation.z = 0; }
    seal.visible = !f.toolboxOpen; pulaskiOut.visible = (f.haspHits || 0) > 0; pulaskiBox.visible = !pulaskiOut.visible;
    boot.visible = !f.bootGone;
  }
  function beat(b, f) {
    if (b.do === 'hush') { H.quiet && H.quiet(25); H.duck && H.duck(22); }
    else if (b.do === 'slam') { f.cacheDoorOpen = false; slam = true; }
    else if (b.do === 'step') { const l = scareStep(b.i, b.n), w = world(l); w.y = heightAt(w.x, w.z) + 0.05; H.play && H.play('footstep_dirt', w, 1.15); }
    else if (b.do === 'growl') { H.dog && H.dog('growl', doorW.clone()); }
    else if (b.do === 'rattle') { H.play && H.play('gate_rattle', haspW.clone(), 0.9); rattle = 0.9; H.fear && H.fear(0.6, 'cache'); }
    else if (b.do === 'end') { scare = null; FC.scareActive = false; bootWatch = true; }
  }
  const FC = {
    root: woods, cache, shell, interior, surfaceRoots, colliders, anchors, baseY, materials: M, scareActive: false,
    get built() { return true; }, ready, culled, inForest: () => inForest,
    /** The stock to spawn the first time the door opens (flags.cacheStocked): [{ kind, pos, rotY, extra }]. */
    stock: () => cacheStock(baseY),
    inside: (x, z) => inCache(x, z),
    doorLabel: (inside, hasKey) => doorPrompt(flags(), { inside, hasKey }).label,
    toolboxLabel: () => toolboxPrompt(flags()).label,
    /** E at the door (inside: from within). Plays the sounds; returns the events for the game to act on (northWoods
     *  doorAct: 'locked' | 'unlock' | 'strike' | 'broken' | 'open' | 'first' | 'shut'). */
    useDoor(inside, hasKey) {
      const f = flags(), p = doorPrompt(f, { inside, hasKey }), ev = doorAct(f, p.act);
      if (ev.includes('locked')) { H.sfx && H.sfx('metal', haspW.clone(), 0.35); rattle = 0.4; }
      if (ev.includes('unlock')) H.sfx && H.sfx('metal', haspW.clone(), 0.4);
      if (ev.includes('strike')) { H.sfx && H.sfx('metal_heavy', haspW.clone(), 1.0); H.play && H.play('gate_rattle', haspW.clone(), 1.1); rattle = 0.5; H.fear && H.fear(0.3, 'hasp'); }
      if (ev.includes('broken')) { H.sfx && H.sfx('knock_one', haspW.clone(), 0.9); H.quiet && H.quiet(20); }
      if (ev.includes('open')) { H.play && H.play('door_open', doorW.clone(), 0.9); slam = false; }
      if (ev.includes('shut')) H.play && H.play('door_close', doorW.clone(), 0.8);
      applyState(f); return ev;
    },
    /** E at the red box: break the wire seal, lift the lid (a Pulaski inside). → true if it opened. */
    useToolbox() { const f = flags(); if (f.toolboxOpen) return false; f.toolboxOpen = true; H.sfx && H.sfx('metal', anchors.toolbox.clone(), 0.4); H.play && H.play('door_open', anchors.toolbox.clone(), 0.4); applyState(f); return true; },
    /** After a restore / new game: put the door, lock, lid and boot straight to the flags (no swing), forget any scare. */
    snap() { const f = flags(); applyState(f, true); scare = null; FC.scareActive = false; openFor = 0; bootWatch = !!f.cacheScare && !f.bootGone; },
    /** ctx: { t, cam (Vector3), fwd (Vector3, the camera's look), pos ([x, y, z] the player's feet), torch, night, busy,
     *  chase, bear, wind (0..1) }. */
    update(dt, ctx = {}) {
      const f = flags(), cam = ctx.cam || engine.camera && engine.camera.position || new V3(), t = ctx.t || 0;
      const dC = Math.hypot(cam.x - cachePos.x, cam.z - cachePos.z);
      cache.visible = dC < 260; interior.visible = dC < 45;
      blow.visible = cam.distanceTo(blowPos) < 220; sgn.visible = cam.distanceTo(signPos) < 180; wash.visible = Math.hypot(cam.x - NWD.road.washout[0], cam.z - NWD.road.washout[1]) < 160;
      if (ruts) ruts.visible = Math.hypot(cam.x - roadMid.x, cam.z - roadMid.z) < 200;
      // discovery (a few times a second)
      if ((discT -= dt) <= 0 && ctx.pos) { discT = 0.25; for (const id of discover(ctx.pos, f)) H.found && H.found(id); }
      // the door and the lid swing to their flags; the door's colliders follow
      const dT = f.cacheDoorOpen ? 1 : 0, was = doorA; doorA += Math.sign(dT - doorA) * Math.min(Math.abs(dT - doorA), dt * (slam ? 3.2 : 1.25));
      if (was !== doorA || !doorA) { const k = doorA * doorA * (3 - 2 * doorA); door.rotation.y = -105 * Math.PI / 180 * k; }
      if (slam && doorA <= 0) { slam = false; H.play && H.play('door_close', doorW.clone(), 1.35); H.sfx && H.sfx('door_close', doorW.clone(), 0.9); H.fear && H.fear(0.5, 'cache'); }
      doorShutCol.enabled = !f.cacheDoorOpen && doorA < 0.12; doorOpenCol.enabled = doorA > 0.9;
      const lT = f.toolboxOpen ? 1 : 0; if (lidA !== lT) { lidA += Math.sign(lT - lidA) * Math.min(Math.abs(lT - lidA), dt * 1.6); lid.rotation.x = -1.9 * lidA * lidA * (3 - 2 * lidA); }
      applyState(f);
      if (rattle > 0) { rattle -= dt; const j = Math.sin(t * 60) * 0.12 * Math.min(1, rattle * 3); padlock.rotation.z += j; hasp.rotation.x = j * 0.3; }
      // the scare: inside, the door open behind you a while, at night / on a second visit / after you broke in
      const P = ctx.pos || [cam.x, cam.y, cam.z], inside = inCache(P[0], P[2]), lz = worldToCache(P[0], P[2])[1];
      if (!scare) { openFor = inside && f.cacheDoorOpen && doorA > 0.95 && lz < 2.2 ? openFor + dt : 0;
        if (scareReady(f, { inside, openFor, night: ctx.night, visits: f.cacheVisits, broken: cacheLock(f) === 'broken', chase: ctx.chase, busy: ctx.busy, bear: ctx.bear })) { f.cacheScare = true; scare = { t: 0, k: 0 }; FC.scareActive = true; } }
      if (scare) { scare.t += dt; while (scare && scare.k < SCARE_BEATS.length && SCARE_BEATS[scare.k].t <= scare.t) beat(SCARE_BEATS[scare.k++], f); }
      // the boot: first time you see it, a line; after the scare it goes the first moment nobody's looking at it
      const fwd = ctx.fwd; if (fwd && boot.visible) { tmp.subVectors(bootW, cam); const d = tmp.length(), look = tmp.normalize().dot(fwd);
        if (!f.bootToldIn && d < 3.2 && look > 0.9) { f.bootToldIn = true; H.say && H.say('bootInside'); }
        if (bootWatch && !f.bootGone && !FC.scareActive && (look < 0.55 || d > 12)) { f.bootGone = true; boot.visible = false; } }
      if (fwd && f.bootGone && !f.bootToldGone) { tmp.subVectors(bootW, cam); const d = tmp.length(); if (d < 5 && tmp.normalize().dot(fwd) > 0.93) { f.bootToldGone = true; H.say && H.say('bootGone'); } }
      // tape in the wind, glass and beads catching the torch
      if (cam.distanceTo(flagMid) < 90 && (tailT -= dt) <= 0) { tailT = 1 / 30; flutter(t, ctx.wind ?? 0.3); }
      const glint = (p, reach = 45) => { if (!ctx.torch || !fwd) return 0; tmp.subVectors(p, cam); const d = tmp.length(); if (d > reach) return 0; return smooth(0.94, 0.992, tmp.normalize().dot(fwd)) * (1 - d / reach); };
      insMats.forEach((m, i) => { m.emissiveIntensity = glint(insPos[i]) * 1.4; });
      M.bead.emissiveIntensity = glint(signIA, 60) * 2.5; M.tape.emissiveIntensity = ctx.torch ? 0.12 : 0;
      if (ownThicket && (thT -= dt) <= 0) { thT = 0.5; ownThicket(cam); }
    },
    /** Triangles / meshes in what this built (for the budget test / the debug overlay). */
    stats() { let tris = 0, meshes = 0; for (const r of [woods, cache]) r.traverse((o) => { if (o.isMesh && !/^COL_/.test(o.name)) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } }); return { tris: Math.round(tris), meshes, plants: plants.length, inForest, culled, materialsFound: M.found.length, buildMs: FC.buildMs }; },
    dispose() {
      scene.remove(woods, cache);
      for (const c of colliders) { const i = W.colliders.indexOf(c); if (i >= 0) W.colliders.splice(i, 1); }
      for (const r of surfaceRoots) { const i = W.modelRoots.indexOf(r); if (i >= 0) W.modelRoots.splice(i, 1); }
      if (engine.player && engine.player.rebuildColliders) engine.player.rebuildColliders();
    },
  };
  applyState(flags(), true);
  FC.buildMs = now() - t0; FC.timings = timings;
  return FC;
}

/** A CD-145 'beehive' glass insulator on its pin (drip skirt, a wire groove, the dome). m: at the pin top. */
function insulator(mb, m, a1 = Math.PI * 2) {
  mb.lathe([[0.03, 0.0], [0.046, 0.004], [0.047, 0.012], [0.042, 0.03], [0.04, 0.05], [0.036, 0.058], [0.031, 0.064], [0.036, 0.072], [0.034, 0.086], [0.024, 0.099], [0.0, 0.104]], m, 14, { tile: 0.1, a1 });
  mb.lathe([[0.022, 0.07], [0.029, 0.0]], m, 10, { tile: 0.1, a1 });   // the inside of the skirt (you see it from below)
}
/** The fallen trunk (world coordinates): bark tube resting on the ground, root flare, the snapped end, branch stubs, root
 *  plate. → { bark, wood, soil (MBs), at(t) centre, r(t), plateCentre, plateNormal } */
function buildLog(heightAt, R) {
  const BD = NWD.blowdown, BL = blowdownLine(), n = 26, seg = 12;
  const r = (t) => { let v = BD.r0 + (BD.r1 - BD.r0) * t; if (t < 0.09) v *= 1 + 0.55 * (1 - t / 0.09) ** 2; return v; };
  const gp = (t) => { const x = BL.root[0] + BL.dir[0] * BL.len * t, z = BL.root[1] + BL.dir[1] * BL.len * t; return [x, heightAt(x, z), z]; };
  let y0 = gp(0.1)[1] + r(0.1) + BD.lift, y1 = gp(1)[1] + r(1) - 0.06, lift = 0;
  for (let i = 0; i <= 24; i++) { const t = i / 24, y = y0 + (y1 - y0) * t, g = gp(t); lift = Math.max(lift, g[1] + r(t) * 0.75 - y); }
  y0 += lift; y1 += lift;
  const at = (t) => { const g = gp(t); return new V3(g[0], y0 + (y1 - y0) * t, g[2]); };
  const axis = at(1).sub(at(0)).normalize(), side = new V3().crossVectors(axis, new V3(0, 1, 0)).normalize(), upv = new V3().crossVectors(side, axis).normalize();
  const bark = new MB(), wood = new MB(), soil = new MB();
  const ring = (k) => { const a = k / seg * Math.PI * 2; return side.clone().multiplyScalar(Math.cos(a)).addScaledVector(upv, Math.sin(a)); };
  const tipJag = []; for (let k = 0; k <= seg; k++) tipJag.push(k === seg ? null : R() * 0.4);
  tipJag[seg] = tipJag[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n, c = at(t), rr = r(t);
    for (let k = 0; k <= seg; k++) { const d = ring(k), bump = 1 + 0.045 * Math.sin((k % seg) / seg * Math.PI * 10 + i * 1.7) + 0.03 * (hash(i, k % seg) - 0.5); bark.v(c.clone().addScaledVector(d, rr * bump).addScaledVector(axis, i === n ? tipJag[k] : 0), d, (k / seg) * (2 * Math.PI * 0.38) / 1.1, -(t * BL.len) / 1.5); }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; bark.I.push(a, b, a + 1, a + 1, b, b + 1); }
  { const p0 = new V3(bark.P[0], bark.P[1], bark.P[2]), p1 = new V3(bark.P[(seg + 1) * 3], bark.P[(seg + 1) * 3 + 1], bark.P[(seg + 1) * 3 + 2]), p2 = new V3(bark.P[3], bark.P[4], bark.P[5]);
    const nn = new V3().subVectors(p1, p0).cross(new V3().subVectors(p2, p0)); if (nn.dot(ring(0)) < 0) for (let q = 0; q < bark.I.length; q += 3) { const s = bark.I[q + 1]; bark.I[q + 1] = bark.I[q + 2]; bark.I[q + 2] = s; } }
  // the snapped end: splinters round a torn core
  { const c = at(1).addScaledVector(axis, 0.12), i0 = wood.count; wood.v(c, axis, 0.5, 0.5);
    for (let k = 0; k <= seg; k++) { const d = ring(k), p = at(1).addScaledVector(d, r(1) * 0.96).addScaledVector(axis, tipJag[k] * 0.9); wood.v(p, axis, 0.5 + d.x * 0.2, 0.5 + d.z * 0.2); }
    for (let k = 0; k < seg; k++) wood.I.push(i0, i0 + k + 1, i0 + k + 2);
    const tn = new V3(wood.P[3] - wood.P[0], wood.P[4] - wood.P[1], wood.P[5] - wood.P[2]).cross(new V3(wood.P[6] - wood.P[0], wood.P[7] - wood.P[1], wood.P[8] - wood.P[2])); if (tn.dot(axis) < 0) for (let q = 0; q < wood.I.length; q += 3) { const s = wood.I[q + 1]; wood.I[q + 1] = wood.I[q + 2]; wood.I[q + 2] = s; } }
  // branch stubs (none pointing into the ground)
  for (let k = 0; k < 8; k++) {
    const t = 0.3 + R() * 0.66, a = (R() - 0.5) * 3.2 + Math.PI / 2, d = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(upv, Math.sin(a)).addScaledVector(axis, 0.35).normalize();
    const base = at(t).addScaledVector(d, r(t) * 0.85), L = 0.25 + R() * 0.45, br = 0.035 + R() * 0.03;
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d), m = new THREE.Matrix4().compose(base, q, new V3(1, 1, 1));
    bark.lathe([[br, 0], [br * 0.65, L * 0.7], [0.006, L]], m, 6, { tile: 0.4 });
  }
  // the root plate: a torn-up disc of dirt stood on edge at the root, facing away from the log
  const plateNormal = axis.clone().negate(), plateCentre = at(0).addScaledVector(axis, -0.18), ns = 16, radii = [];
  for (let k = 0; k < ns; k++) radii.push(1.15 + 0.35 * hash(k, 5) + 0.12 * Math.sin(k * 1.9));
  const pv = (k, dz, s = 1) => { const a = k / ns * Math.PI * 2, d = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(upv, Math.sin(a)); return plateCentre.clone().addScaledVector(d, radii[k % ns] * s).addScaledVector(plateNormal, dz); };
  for (const [dz, nrm] of [[0.22, plateNormal], [-0.2, axis]]) { const pts = [], uvs = []; for (let k = 0; k < ns; k++) { const p = pv(k, dz * (0.7 + 0.3 * hash(k, dz))); pts.push(p); uvs.push([p.x / 0.8, p.y / 0.8]); } const c = plateCentre.clone().addScaledVector(plateNormal, dz * 1.4); for (let k = 0; k < ns; k++) soil.poly([c, pts[k], pts[(k + 1) % ns]], [[c.x / 0.8, c.y / 0.8], uvs[k], uvs[(k + 1) % ns]], null, nrm); }
  for (let k = 0; k < ns; k++) { const a = pv(k, 0.22 * (0.7 + 0.3 * hash(k, 0.22))), b = pv((k + 1) % ns, 0.22 * (0.7 + 0.3 * hash((k + 1) % ns, 0.22))), c = pv((k + 1) % ns, -0.2 * (0.7 + 0.3 * hash((k + 1) % ns, -0.2))), d = pv(k, -0.2 * (0.7 + 0.3 * hash(k, -0.2)));
    const out = new V3().addVectors(a, b).multiplyScalar(0.5).sub(plateCentre); soil.poly([a, b, c, d], [[0, 0], [0.5, 0], [0.5, 0.4], [0, 0.4]], null, out.addScaledVector(plateNormal, -out.dot(plateNormal)).normalize()); }
  return { bark, wood, soil, at, r, plateCentre, plateNormal };
}
