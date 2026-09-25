// FALSE LIGHT — the trail map, drawn like a 1983 Forest Service topographic sheet on a plain 2D canvas: shaded relief
// (hillshade from heightAt, light from the north-west) over woodland tint, 10 m contours with bold 50 m index contours,
// the trail in dashed red-brown, Cold Creek in blue, the ravine hatched, the old burn stippled, place symbols with
// serif names, rest benches, a north arrow with declination, metre + foot scale bars, a legend, paper grain, folds
// and a vignette, and a red "you are here" arrow. Pure canvas code, no three.js; the slow parts (height grid, relief
// raster, contours) are cached per heightAt + view, so the second opening is just the drawing.
//
// drawMap(canvas, data) — data (same contract as U.map in ui.js, plus two optional fields):
//   segments  [{ name, points: [[x, y, z], ...] }]   the trail (layout.trail.segments)
//   places    { name: [x, y, z] }                    'tower', 'spring', 'creek bridge', 'hikers camp', 'burn scar', ...
//   player    [x, y, z] | null
//   rect      { min: [x, z], max: [x, z] }           the terrain's extent (world.rect)
//   heightAt  (x, z) => y
//   creek     [[x, y, z], ...]                        the creek's centre line
//   ravine    [[x, z], ...]                           the ravine polygon
//   spots     [{ id, name, kind, pos: [x, y, z], facing: [fx, fz] }]   optional: rest benches (chill.js mapSpots)
//   heading   radians, three.js yaw (forward = (-sin, -cos) in x/z; 0 = north)     optional: the arrow's direction
//   dpr       optional: canvas.width / CSS width (draw in CSS pixels, stay sharp on Retina)
// World axes: +x east, -z north. Returns { ms, cached, view, benches: [{ id, x, y, box }], labels: [screen boxes] }.

export const ELEV0 = 1750;             // metres above sea level of the ground at the tower (world y = 0)
export const CONTOUR = 10, INDEX = 50;

const C = {
  paper: [236, 227, 203], wood: [205, 221, 180], burn: [231, 224, 208], cliff: [226, 212, 186],
  shadow: [112, 98, 80], light: [252, 248, 234],
  ink: '#2a241b', brown: 'rgba(140,92,52,0.72)', brownIdx: 'rgba(112,66,34,0.92)', contourLabel: '#7a4c2c',
  water: '#3a6f9c', waterLight: '#9fc0d4', trail: '#a02e1d', red: '#c0221a', stipple: 'rgba(58,48,40,0.55)', hatch: 'rgba(96,66,40,0.55)',
};
const SERIF = '"Century Schoolbook","New Century Schoolbook","Georgia","Times New Roman",serif';
const rgb = (a) => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ view / projection
/** Where the map frame and the side panel go on a W x H canvas, and the world extent that fills the frame. */
export function mapView(data, W, H) {
  const m = Math.round(Math.min(W, H) * 0.03);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const inc = (x, z) => { if (!Number.isFinite(x) || !Number.isFinite(z)) return; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const s of data.segments || []) for (const p of s.points) inc(p[0], p[2]);
  for (const p of Object.values(data.places || {})) if (p) inc(p[0], p[2]);
  for (const s of data.spots || []) if (s && s.pos) inc(s.pos[0], s.pos[2]);
  if (data.player) inc(data.player[0], data.player[2]);
  if (!Number.isFinite(x0)) { x0 = -200; x1 = 200; z0 = -200; z1 = 200; }
  const pad = 42; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  const panelW = W / H > 1.12 ? Math.round(clamp(W * 0.27, 250, 340)) : 0;
  const gap = panelW ? Math.round(m * 0.7) : 0;
  const frame = { x: m, y: m, w: W - 2 * m - panelW - gap, h: H - 2 * m };
  const fa = frame.w / frame.h;
  let ew = x1 - x0, eh = z1 - z0;
  if (ew / eh < fa) ew = eh * fa; else eh = ew / fa;
  let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const r = data.rect;
  if (r) {   // keep the sheet on the surveyed ground where it fits
    if (ew <= r.max[0] - r.min[0]) cx = clamp(cx, r.min[0] + ew / 2, r.max[0] - ew / 2);
    if (eh <= r.max[1] - r.min[1]) cz = clamp(cz, r.min[1] + eh / 2, r.max[1] - eh / 2);
  }
  const ext = { x0: cx - ew / 2, x1: cx + ew / 2, z0: cz - eh / 2, z1: cz + eh / 2 };
  const s = frame.w / ew;
  return {
    W, H, m, frame, ext, s,
    panel: panelW ? { x: frame.x + frame.w + gap, y: m, w: panelW, h: H - 2 * m } : null,
    px: (x) => frame.x + (x - ext.x0) * s, py: (z) => frame.y + (z - ext.z0) * s,
  };
}
/** Screen direction (dx, dy) of a three.js yaw on this north-up sheet. */
export const headingVec = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

// ------------------------------------------------------------------ height grid, relief, contours (pure)
export function heightGrid(heightAt, ext, step) {
  const nx = Math.ceil((ext.x1 - ext.x0) / step) + 1, ny = Math.ceil((ext.z1 - ext.z0) / step) + 1;
  const h = new Float32Array(nx * ny);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j++) {
    const z = ext.z0 + j * step;
    for (let i = 0; i < nx; i++) { const v = heightAt(ext.x0 + i * step, z); h[j * nx + i] = v; if (v < min) min = v; if (v > max) max = v; }
  }
  return { nx, ny, step, x0: ext.x0, z0: ext.z0, h, min, max };
}
/** Hillshade 0..1 (flat ground = sin(alt)); light from azimuth az (deg, 315 = NW), altitude alt (deg). */
export function hillshade(g, { az = 315, alt = 45, exag = 1.8 } = {}) {
  const { nx, ny, h, step } = g, out = new Float32Array(nx * ny);
  const A = az * Math.PI / 180, E = alt * Math.PI / 180;
  const Lx = Math.sin(A) * Math.cos(E), Ln = Math.cos(A) * Math.cos(E), Lu = Math.sin(E);
  for (let j = 0; j < ny; j++) {
    const jn = j > 0 ? j - 1 : j, js = j < ny - 1 ? j + 1 : j;
    for (let i = 0; i < nx; i++) {
      const iw = i > 0 ? i - 1 : i, ie = i < nx - 1 ? i + 1 : i;
      const dx = (h[j * nx + ie] - h[j * nx + iw]) / ((ie - iw) * step) * exag;          // rise per metre east
      const dn = (h[jn * nx + i] - h[js * nx + i]) / ((js - jn) * step) * exag;          // rise per metre north (-z)
      const inv = 1 / Math.sqrt(dx * dx + dn * dn + 1);
      out[j * nx + i] = Math.max(0, (-dx * Lx - dn * Ln + Lu) * inv);
    }
  }
  return out;
}
/** Marching squares for many levels in one pass over the grid (a cell only visits the levels between its lowest and
 *  highest corner). Returns, per level, polylines of world [x, z] points. Saddles are resolved by the cell mean. */
export function contourAll(g, levels) {
  const { nx, ny, h, x0, z0, step } = g;
  const ys = levels.map((l) => (typeof l === 'number' ? l : l.y)), order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const sy = order.map((o) => o[0]), segsBy = ys.map(() => []);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k0 = j * nx + i, a = h[k0], b = h[k0 + 1], c = h[k0 + nx + 1], d = h[k0 + nx];
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
    if (hi < sy[0] || lo > sy[sy.length - 1]) continue;
    let q = 0; while (q < sy.length && sy[q] <= lo) q++;          // levels with lo < level <= hi cut this cell
    for (; q < sy.length && sy[q] <= hi; q++) {
      const level = sy[q], segs = segsBy[order[q][1]];
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = 2 * k0, R = 2 * (k0 + 1) + 1, B = 2 * (k0 + nx), L = 2 * k0 + 1;
      switch (code) {
        case 1: case 14: segs.push(L, B); break;
        case 2: case 13: segs.push(B, R); break;
        case 3: case 12: segs.push(L, R); break;
        case 4: case 11: segs.push(T, R); break;
        case 6: case 9: segs.push(T, B); break;
        case 7: case 8: segs.push(L, T); break;
        case 5: if ((a + b + c + d) / 4 >= level) segs.push(L, T, B, R); else segs.push(T, R, L, B); break;
        case 10: if ((a + b + c + d) / 4 >= level) segs.push(T, R, L, B); else segs.push(L, T, B, R); break;
      }
    }
  }
  return ys.map((level, li) => chain(g, segsBy[li], level));
}
function chain(g, segs, level) {
  const { nx, h, x0, z0, step } = g;
  const pt = (e) => {
    const k = e >> 1, i = k % nx, j = (k / nx) | 0, va = h[k];
    if ((e & 1) === 0) { const t = (level - va) / (h[k + 1] - va || 1e-9); return [x0 + (i + t) * step, z0 + j * step]; }
    const t = (level - va) / (h[k + nx] - va || 1e-9); return [x0 + i * step, z0 + (j + t) * step];
  };
  const n = segs.length / 2, adj = new Map(), used = new Uint8Array(n);
  for (let s = 0; s < n; s++) for (let e2 = 0; e2 < 2; e2++) { const e = segs[2 * s + e2], l = adj.get(e); if (l) l.push(s); else adj.set(e, [s]); }
  const other = (s, e) => (segs[2 * s] === e ? segs[2 * s + 1] : segs[2 * s]);
  const lines = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const head = [], tail = [segs[2 * s0], segs[2 * s0 + 1]];
    for (let dir = 0; dir < 2; dir++) {                  // grow from the tail end, then from the head end
      let e = dir ? tail[0] : tail[tail.length - 1];
      for (;;) {
        const l = adj.get(e); let nxt = -1;
        if (l) for (const s of l) if (!used[s]) { nxt = s; break; }
        if (nxt < 0) break;
        used[nxt] = 1; e = other(nxt, e);
        if (dir) head.push(e); else tail.push(e);
      }
    }
    head.reverse();
    lines.push(head.concat(tail).map(pt));
  }
  return lines;
}
/** Marching squares at one level, chained into polylines of world [x, z] points. */
export const contourLines = (g, level) => contourAll(g, [level])[0];
export function contourLevels(g, interval = CONTOUR, elev0 = ELEV0) {
  const out = [];
  for (let E = Math.ceil((g.min + elev0) / interval) * interval; E <= g.max + elev0; E += interval) out.push({ elev: E, y: E - elev0, index: E % INDEX === 0 });
  return out;
}
/** Scanline fill of a polygon ([[x, z], ...]) into a grid-sized Uint8Array mask. */
export function polyMask(g, poly, mask = new Uint8Array(g.nx * g.ny), val = 1) {
  if (!poly || poly.length < 3) return mask;
  const xs = [];
  for (let j = 0; j < g.ny; j++) {
    const z = g.z0 + j * g.step; xs.length = 0;
    for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
      const a = poly[k], b = poly[l];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.step)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.step));
      for (let i = i0; i <= i1; i++) mask[j * g.nx + i] = val;
    }
  }
  return mask;
}
/** The 1980 burn: an irregular blob round the burn-scar place (radius ~70 m, per the layout notes). */
export function burnShape(c, r = 68) {
  const out = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const rr = r * (1 + 0.16 * Math.sin(3 * a + 1.1) + 0.09 * Math.sin(7 * a + 2.3) + 0.05 * Math.sin(13 * a + 0.4));
    out.push([c[0] + Math.cos(a) * rr, c[2] + Math.sin(a) * rr]);
  }
  return out;
}
const normKey = (k) => String(k).toLowerCase().replace(/[_\s]+/g, ' ').trim();
const findPlace = (places, ...names) => { for (const [k, v] of Object.entries(places || {})) if (names.includes(normKey(k))) return v; return null; };

// ------------------------------------------------------------------ canvases
function makeCanvas(w, h, data) {
  if (data && data.makeCanvas) return data.makeCanvas(w, h);
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
let paperTile = null;
function paperGrain(data) {
  if (paperTile) return paperTile;
  const N = 160, c = makeCanvas(N, N, data); if (!c) return null;
  const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) { const v = 128 + (rnd() - 0.5) * 34; d[i * 4] = v; d[i * 4 + 1] = v * 0.97; d[i * 4 + 2] = v * 0.9; d[i * 4 + 3] = 255; }
  for (let f = 0; f < 70; f++) {   // paper fibres
    let x = rnd() * N, y = rnd() * N; const a = rnd() * Math.PI, L = 4 + rnd() * 12, dv = (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 16);
    for (let t = 0; t < L; t++) { const ix = (((x + Math.cos(a) * t) | 0) + N) % N, iy = (((y + Math.sin(a) * t) | 0) + N) % N, k = (iy * N + ix) * 4; d[k] += dv; d[k + 1] += dv; d[k + 2] += dv * 0.9; }
  }
  g.putImageData(im, 0, 0);
  paperTile = c; return c;
}

// ------------------------------------------------------------------ the expensive layer, cached
const cache = new WeakMap();
function terrainLayer(data, view) {
  const ha = data.heightAt;
  const key = [view.ext.x0, view.ext.z0, view.ext.x1, view.ext.z1, view.frame.w, view.frame.h].map((v) => Math.round(v * 10)).join(',');
  const hit = ha && cache.get(ha);
  if (hit && hit.key === key) return { ...hit, cached: true };
  const ext = view.ext, span = Math.max(ext.x1 - ext.x0, ext.z1 - ext.z0);
  const step = clamp(span / 230, 2, 4);
  const g = ha ? heightGrid(ha, ext, step) : null;
  const layer = { key, g, raster: null, levels: [], labels: [] };
  if (!g) return layer;
  const sh = hillshade(g);
  const flat = Math.sin(45 * Math.PI / 180);
  // masks: open ground (no woodland tint), the ravine (cliff), the burn
  const open = new Uint8Array(g.nx * g.ny);
  polyMask(g, data.ravine, open, 2);
  const burnC = findPlace(data.places, 'burn scar', 'burn');
  if (burnC) polyMask(g, burnShape(burnC), open, 3);
  const clear = [[findPlace(data.places, 'tower'), 16], [findPlace(data.places, 'trailhead'), 26], [findPlace(data.places, 'hikers camp', 'camp'), 11],
    [findPlace(data.places, 'ravine overlook', 'overlook'), 8], [findPlace(data.places, 'spring'), 6]];
  for (const [p, r] of clear) {
    if (!p) continue;
    const i0 = Math.max(0, Math.floor((p[0] - r - g.x0) / g.step)), i1 = Math.min(g.nx - 1, Math.ceil((p[0] + r - g.x0) / g.step));
    const j0 = Math.max(0, Math.floor((p[2] - r - g.z0) / g.step)), j1 = Math.min(g.ny - 1, Math.ceil((p[2] + r - g.z0) / g.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.x0 + i * g.step, z = g.z0 + j * g.step, a = Math.atan2(z - p[2], x - p[0]);
      const re = r * (1 + 0.13 * Math.sin(3 * a + p[0]) + 0.08 * Math.sin(5 * a + p[2]));   // clearings are never circles
      if ((x - p[0]) ** 2 + (z - p[2]) ** 2 < re * re && !open[j * g.nx + i]) open[j * g.nx + i] = 1;
    }
  }
  const rc = makeCanvas(g.nx, g.ny, data);
  if (rc) {
    const rg = rc.getContext('2d'), im = rg.createImageData(g.nx, g.ny), d = im.data;
    const pal = [C.wood, C.paper, C.cliff, C.burn];
    for (let k = 0; k < g.nx * g.ny; k++) {
      const c = pal[open[k]], dv = sh[k] - flat, o = c === undefined ? C.wood : c;
      const tgt = dv < 0 ? C.shadow : C.light, t = dv < 0 ? Math.min(0.46, -dv * 1.05) : Math.min(0.34, dv * 1.1);
      d[k * 4] = o[0] + (tgt[0] - o[0]) * t; d[k * 4 + 1] = o[1] + (tgt[1] - o[1]) * t; d[k * 4 + 2] = o[2] + (tgt[2] - o[2]) * t; d[k * 4 + 3] = 255;
    }
    rg.putImageData(im, 0, 0);
    layer.raster = rc;
  }
  const lv = contourLevels(g), all = contourAll(g, lv);
  lv.forEach((L, i) => layer.levels.push({ ...L, lines: all[i] }));
  cache.set(ha, layer);
  return layer;
}

// ------------------------------------------------------------------ drawing helpers
function pathLine(g, pts, px, py, close = false) {
  g.beginPath();
  for (let i = 0; i < pts.length; i++) { const p = pts[i]; const x = px(p[0]), y = py(p.length === 3 ? p[2] : p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  if (close) g.closePath();
}
let BOXES = null;   // label boxes placed so far in this draw (screen AABBs), for the few labels that move to stay clear
function textBox(g, text, x, y, font, align, angle = 0) {
  g.save(); g.font = font; const w = g.measureText(text).width; g.restore();
  const fs = +((/([\d.]+)px/.exec(font) || [])[1] || 12), hw = w / 2, hh = fs * 0.6;
  const cx = align === 'center' ? x : align === 'right' ? x - hw : x + hw;
  const ex = Math.abs(Math.cos(angle)) * hw + Math.abs(Math.sin(angle)) * hh, ey = Math.abs(Math.sin(angle)) * hw + Math.abs(Math.cos(angle)) * hh;
  return [cx - ex, y - ey, cx + ex, y + ey];
}
const overlaps = (b) => BOXES && BOXES.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
function haloText(g, text, x, y, { font, fill = C.ink, halo = 'rgba(238,230,208,0.92)', hw = 3.2, align = 'left', base = 'middle', angle = 0 } = {}) {
  if (BOXES) BOXES.push(textBox(g, text, x, y, font, align, angle));
  g.save(); g.translate(x, y); if (angle) g.rotate(angle);
  g.font = font; g.textAlign = align; g.textBaseline = base; g.lineJoin = 'round';
  if (halo) { g.strokeStyle = halo; g.lineWidth = hw; g.strokeText(text, 0, 0); }
  g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}
/** A label laid along a polyline (world points) at fraction f of its screen length, kept upright. */
function lineLabel(g, pts, view, f, text, style) {
  const P = pts.map((p) => [view.px(p[0]), view.py(p.length === 3 ? p[2] : p[1])]);
  let L = 0; const acc = [0]; for (let i = 1; i < P.length; i++) { L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); acc.push(L); }
  if (L < 60) return false;
  const target = L * f; let i = 1; while (i < P.length - 1 && acc[i] < target) i++;
  const t = (target - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
  const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
  const a = P[Math.max(0, i - 4)], b = P[Math.min(P.length - 1, i + 3)];
  let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
  haloText(g, text, x, y, { ...style, align: 'center', angle: ang });
  return true;
}
const SYM = {
  lookout(g, x, y, k) {   // tower: splayed legs, the cab, a flag
    g.save(); g.translate(x, y); g.scale(k, k);
    g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(-5, 6); g.lineTo(-2.4, -3); g.moveTo(5, 6); g.lineTo(2.4, -3); g.moveTo(-3.7, 1.5); g.lineTo(3.7, 1.5); g.moveTo(-4.4, 4); g.lineTo(4.4, 4); g.stroke();
    g.fillRect(-3.6, -7.2, 7.2, 4.4);
    g.beginPath(); g.moveTo(0, -7.2); g.lineTo(0, -12); g.stroke(); g.fillStyle = C.red; g.fillRect(0, -12, 3.6, 2.2);
    g.restore();
  },
  spring(g, x, y, k) {
    g.save(); g.translate(x, y); g.scale(k, k);
    g.strokeStyle = C.water; g.lineWidth = 1.4; g.fillStyle = 'rgba(236,227,203,0.95)';
    g.beginPath(); g.arc(0, 0, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(3.4, 1.2); g.quadraticCurveTo(7, 3.5, 9.5, 2.2); g.stroke();
    g.restore();
  },
  bridge(g, x, y, k, ang) {   // ")(" across the water, along the trail
    g.save(); g.translate(x, y); g.rotate(ang); g.scale(k, k);
    g.strokeStyle = C.ink; g.lineWidth = 1.5;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-6.5, s * 5.5); g.lineTo(-4.5, s * 3); g.lineTo(4.5, s * 3); g.lineTo(6.5, s * 5.5); g.stroke(); }
    g.restore();
  },
  camp(g, x, y, k) {
    g.save(); g.translate(x, y); g.scale(k, k);
    g.fillStyle = C.ink; g.beginPath(); g.moveTo(0, -5.5); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill();
    g.fillStyle = 'rgb(236,227,203)'; g.beginPath(); g.moveTo(0, -0.5); g.lineTo(1.9, 4); g.lineTo(-1.9, 4); g.closePath(); g.fill();
    g.restore();
  },
  parking(g, x, y, k) {
    g.save(); g.translate(x, y); g.scale(k, k);
    g.fillStyle = C.ink; g.fillRect(-5.5, -5.5, 11, 11);
    g.fillStyle = 'rgb(236,227,203)'; g.font = `bold 9px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 0, 0.6);
    g.restore();
  },
  vista(g, x, y, k) {   // viewpoint: a half-sun of rays
    g.save(); g.translate(x, y); g.scale(k, k);
    g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, 1.5, 3, Math.PI, 0); g.closePath(); g.fill();
    for (let a = 0; a <= 4; a++) { const t = Math.PI + (a / 4) * Math.PI; g.beginPath(); g.moveTo(Math.cos(t) * 4.8, 1.5 + Math.sin(t) * 4.8); g.lineTo(Math.cos(t) * 7.5, 1.5 + Math.sin(t) * 7.5); g.stroke(); }
    g.restore();
  },
  bench(g, x, y, k) {
    g.save(); g.translate(x, y); g.scale(k, k);
    g.fillStyle = 'rgba(238,230,208,0.9)'; g.fillRect(-6, -3.6, 12, 7);
    g.fillStyle = '#5b3d24'; g.fillRect(-5, -1.6, 10, 2.3); g.fillRect(-3.8, 0.7, 1.6, 2.3); g.fillRect(2.2, 0.7, 1.6, 2.3);
    g.restore();
  },
  dot(g, x, y, k) { g.save(); g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, 2.6 * k, 0, Math.PI * 2); g.fill(); g.restore(); },
};
const PLACE = {
  'tower': { sym: 'lookout', label: 'TAMARACK L.O.', bold: true, elev: true },
  'spring': { sym: 'spring', label: 'Spring', water: true },
  'creek bridge': { sym: 'bridge', label: 'Footbridge' },
  'hikers camp': { sym: 'camp', label: 'Camp' },
  'camp': { sym: 'camp', label: 'Camp' },
  'trailhead': { sym: 'parking', label: 'Trailhead', elev: true },
  'ravine overlook': { sym: 'vista', label: 'Overlook' },
  'burn scar': { sym: null },
};
const SKIP = new Set(['gate', 'generator shed', 'weeper rock', 'j1', 'j2', 'tower base']);
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ drawMap
export function drawMap(canvas, data = {}) {
  const t0 = now();
  const g = canvas.getContext('2d');
  BOXES = [];
  const dpr = data.dpr > 0 ? data.dpr : 1;                       // canvas.width = CSS width x dpr for a crisp HiDPI sheet
  const W = canvas.width / dpr, H = canvas.height / dpr, k = Math.max(0.75, Math.min(1.4, Math.min(W / 1200, H / 900) * 1.08));
  const view = mapView(data, W, H), { frame, px, py } = view;
  const layer = terrainLayer(data, view);
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  // --- paper
  g.fillStyle = rgb(C.paper); g.fillRect(0, 0, W, H);
  const grain = paperGrain(data);
  if (grain) { const pat = g.createPattern(grain, 'repeat'); if (pat) { g.globalAlpha = 0.22; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.globalAlpha = 1; } }
  // --- the map frame
  g.save();
  g.beginPath(); g.rect(frame.x, frame.y, frame.w, frame.h); g.clip();
  if (layer.raster) {
    g.imageSmoothingEnabled = true; try { g.imageSmoothingQuality = 'high'; } catch (e) { /* older canvases */ }
    const gr = layer.g;
    g.drawImage(layer.raster, px(gr.x0 - gr.step / 2), py(gr.z0 - gr.step / 2), gr.nx * gr.step * view.s, gr.ny * gr.step * view.s);
  } else { g.fillStyle = rgb(C.wood); g.fillRect(frame.x, frame.y, frame.w, frame.h); }
  // burn: stipple + dashed edge
  const burnC = findPlace(data.places, 'burn scar', 'burn');
  if (burnC) {
    const shp = burnShape(burnC);
    g.save(); pathLine(g, shp, px, py, true); g.clip();
    g.fillStyle = C.stipple;
    let seed = 1980; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bx = px(burnC[0]), by = py(burnC[2]), R = 90 * view.s, n = Math.round(R * R * 0.028);
    for (let i = 0; i < n; i++) { const x = bx + (rnd() * 2 - 1) * R, y = by + (rnd() * 2 - 1) * R; const s = 0.9 + rnd() * 0.9; g.fillRect(x, y, s, s); }
    g.restore();
    g.save(); g.strokeStyle = 'rgba(58,48,40,0.5)'; g.lineWidth = 0.9; g.setLineDash([2.5, 3]); pathLine(g, shp, px, py, true); g.stroke(); g.restore();
  }
  // ravine: hatched, outlined
  if (data.ravine && data.ravine.length > 2) {
    g.save(); pathLine(g, data.ravine, px, py, true); g.clip();
    let rx0 = Infinity, rx1 = -Infinity, ry0 = Infinity, ry1 = -Infinity;
    for (const p of data.ravine) { const x = px(p[0]), y = py(p[1]); rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); ry0 = Math.min(ry0, y); ry1 = Math.max(ry1, y); }
    rx0 = Math.max(rx0, frame.x - 10); rx1 = Math.min(rx1, frame.x + frame.w + 10); ry0 = Math.max(ry0, frame.y - 10); ry1 = Math.min(ry1, frame.y + frame.h + 10);
    g.strokeStyle = C.hatch; g.lineWidth = 0.8; g.beginPath();
    for (let c = rx0 - (ry1 - ry0); c < rx1; c += 4.2) { g.moveTo(c, ry1); g.lineTo(c + (ry1 - ry0), ry0); }
    g.stroke(); g.restore();
    g.save(); g.strokeStyle = 'rgba(92,60,34,0.8)'; g.lineWidth = 1.1; pathLine(g, data.ravine, px, py, true); g.stroke(); g.restore();
  }
  // contours
  for (const idx of [false, true]) {
    g.strokeStyle = idx ? C.brownIdx : C.brown; g.lineWidth = idx ? 1.6 : 0.85; g.lineJoin = 'round';
    g.beginPath();
    for (const L of layer.levels) {
      if (L.index !== idx) continue;
      for (const ln of L.lines) { if (ln.length < 3) continue; g.moveTo(px(ln[0][0]), py(ln[0][1])); for (let i = 1; i < ln.length; i++) g.lineTo(px(ln[i][0]), py(ln[i][1])); }
    }
    g.stroke();
  }
  // index contour labels: a few, on the longest runs, away from the frame edge
  {
    const cands = [];
    for (const L of layer.levels) if (L.index) for (const ln of L.lines) if (ln.length > 30) cands.push({ L, ln, len: ln.length });
    cands.sort((a, b) => b.len - a.len);
    let n = 0; const placed = [];
    for (const c of cands) {
      if (n >= 7) break;
      const m = c.ln[Math.floor(c.ln.length * 0.4)], sx = px(m[0]), sy = py(m[1]);
      if (sx < frame.x + 30 || sx > frame.x + frame.w - 30 || sy < frame.y + 20 || sy > frame.y + frame.h - 20) continue;
      if (placed.some(([x, y]) => Math.hypot(x - sx, y - sy) < 130)) continue;
      if (lineLabel(g, c.ln, view, 0.4, String(c.L.elev), { font: `${Math.round(10 * k)}px ${SERIF}`, fill: C.contourLabel, halo: 'rgba(232,224,200,0.95)', hw: 3.5 })) { placed.push([sx, sy]); n++; }
    }
  }
  // creek
  if (data.creek && data.creek.length > 1) {
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = C.waterLight; g.lineWidth = 4.2 * k; pathLine(g, data.creek, px, py); g.stroke();
    g.strokeStyle = C.water; g.lineWidth = 1.9 * k; pathLine(g, data.creek, px, py); g.stroke();
    g.restore();
    // the name on a straight, visible stretch upstream of the bridge
    const vis = data.creek.filter((p) => { const x = px(p[0]), y = py(p[2]); return x > frame.x + 40 && x < frame.x + frame.w - 40 && y > frame.y + 20 && y < frame.y + frame.h - 20; });
    if (vis.length > 20) lineLabel(g, vis, view, 0.3, 'Cold Creek', { font: `italic ${Math.round(13 * k)}px ${SERIF}`, fill: C.water, hw: 3.5 });
  }
  if (data.ravine && data.ravine.length > 2) {
    let cx = 0, cz = 0, n = 0; for (const p of data.ravine) { const x = px(p[0]), y = py(p[1]); if (x > frame.x + 50 && x < frame.x + frame.w - 50 && y > frame.y + 30 && y < frame.y + frame.h - 30) { cx += p[0]; cz += p[1]; n++; } }
    if (n) haloText(g, 'Cold Creek Cut', px(cx / n) + 14 * k, py(cz / n), { font: `italic ${Math.round(12 * k)}px ${SERIF}`, fill: '#5d3d22', angle: -Math.PI / 2 * 0.92, align: 'center' });
  }
  // trail: halo, then the dashed red-brown line
  const segs = data.segments || [];
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(240,233,212,0.75)'; g.lineWidth = 5.4 * k;
  for (const s of segs) { pathLine(g, s.points, px, py); g.stroke(); }
  g.strokeStyle = C.trail; g.lineWidth = 2.5 * k; g.setLineDash([8 * k, 4.5 * k]); g.lineCap = 'butt';
  for (const s of segs) { pathLine(g, s.points, px, py); g.stroke(); }
  g.setLineDash([]); g.restore();
  // trail names
  const segBy = (re) => segs.find((s) => re.test(s.name));
  const tstyle = { font: `italic ${Math.round(11 * k)}px ${SERIF}`, fill: C.trail, hw: 3.2 };
  const tn = segBy(/J2_to_trailhead|J1_to_creek/); if (tn) lineLabel(g, tn.points, view, 0.45, 'Trail No. 1411', tstyle);
  const lp = segBy(/loop_J2_to_camp|loop/); if (lp) lineLabel(g, lp.points, view, 0.55, 'Camp Loop', tstyle);
  const sp = segBy(/spur/); if (sp) lineLabel(g, sp.points, view, 0.6, 'Overlook Spur', tstyle);
  // places
  const labelFont = (b) => `${b ? 'bold ' : ''}${Math.round(12.5 * k)}px ${SERIF}`;
  for (const [key, p] of Object.entries(data.places || {})) {
    const nk = normKey(key); if (!p || SKIP.has(nk)) continue;
    const def = PLACE[nk] || { sym: 'dot', label: titleCase(nk) };
    const x = px(p[0]), y = py(p[2]);
    if (x < frame.x || x > frame.x + frame.w || y < frame.y || y > frame.y + frame.h) continue;
    if (nk === 'burn scar') { haloText(g, 'THE BURN · 1980', x, y - 4 * k, { font: `${Math.round(11.5 * k)}px ${SERIF}`, align: 'center', hw: 3.6 }); continue; }
    let ang = 0;
    if (def.sym === 'bridge') { let best = null; for (const s of segs) for (let i = 0; i < s.points.length - 1; i++) { const a = s.points[i], b = s.points[i + 1]; const d = Math.hypot(a[0] - p[0], a[2] - p[2]); if (!best || d < best.d) best = { d, a: Math.atan2(b[2] - a[2], b[0] - a[0]) }; } ang = best ? best.a : 0; }
    SYM[def.sym](g, x, y, k, ang);
    const lx = x + (def.sym === 'lookout' ? 10 : 11) * k, ly = y + (def.sym === 'lookout' ? -3 : 0);
    haloText(g, def.label, lx, ly, { font: (def.water ? 'italic ' : '') + labelFont(def.bold), fill: def.water ? C.water : C.ink });
    if (def.elev && data.heightAt) haloText(g, String(Math.round(data.heightAt(p[0], p[2]) + ELEV0)), lx, ly + 13 * k, { font: `${Math.round(10 * k)}px ${SERIF}`, fill: '#4a3c2c' });
  }
  // rest benches (nudged off a place symbol or a label they'd sit on; the catwalk chair is part of the lookout)
  const tower = findPlace(data.places, 'tower') || [0, 0, 0];
  const symAt = Object.entries(data.places || {}).filter(([kk, p]) => p && !SKIP.has(normKey(kk)) && normKey(kk) !== 'burn scar').map(([, p]) => [px(p[0]), py(p[2])]);
  const benchBox = (x, y) => [x - 6.2 * k, y - 3.8 * k, x + 6.2 * k, y + 3.6 * k];
  const clearOfSyms = (x, y) => symAt.every(([sx, sy]) => Math.hypot(x - sx, y - sy) >= 15 * k - 0.01);
  const benches = [];
  for (const s of data.spots || []) {
    if (!s || !s.pos || s.kind === 'chair' || Math.hypot(s.pos[0] - tower[0], s.pos[2] - tower[2]) < 9) continue;
    let x = px(s.pos[0]), y = py(s.pos[2]);
    if (x < frame.x || x > frame.x + frame.w || y < frame.y || y > frame.y + frame.h) continue;
    for (const [sx, sy] of symAt) {
      const d = Math.hypot(x - sx, y - sy), need = 15 * k;
      if (d < need) { const ux = d > 0.5 ? (x - sx) / d : 0, uy = d > 0.5 ? (y - sy) / d : 1; x = sx + ux * need; y = sy + uy * need; }
    }
    if (overlaps(benchBox(x, y))) {   // e.g. the burn bench, right under "THE BURN · 1980": the nearest clear spot
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 1.8], [0, -1.8], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx * 13 * k, ny = y + dy * 9 * k;
        if (!overlaps(benchBox(nx, ny)) && clearOfSyms(nx, ny)) { x = nx; y = ny; break; }
      }
    }
    SYM.bench(g, x, y, k * 0.95);
    const bb = benchBox(x, y);
    if (BOXES) BOXES.push(bb);   // so "YOU ARE HERE" keeps off it too
    benches.push({ id: s.id, x, y, box: bb });
  }
  // you are here
  if (data.player) {
    const x = px(data.player[0]), y = py(data.player[2]);
    const hv = Number.isFinite(data.heading) ? headingVec(data.heading) : null;
    g.save(); g.translate(x, y);
    if (hv) {
      g.rotate(Math.atan2(hv[1], hv[0]) + Math.PI / 2);   // local -y = forward
      const L = 15 * k, B = 7.5 * k;
      g.beginPath(); g.moveTo(0, -L); g.lineTo(B, L * 0.62); g.lineTo(0, L * 0.28); g.lineTo(-B, L * 0.62); g.closePath();
      g.lineJoin = 'round'; g.strokeStyle = 'rgba(245,238,220,0.95)'; g.lineWidth = 3.5; g.stroke();
      g.fillStyle = C.red; g.fill();
    } else {
      g.beginPath(); g.arc(0, 0, 6 * k, 0, Math.PI * 2); g.strokeStyle = 'rgba(245,238,220,0.95)'; g.lineWidth = 3; g.stroke(); g.fillStyle = C.red; g.fill();
    }
    g.restore();
    const font = `bold ${Math.round(10.5 * k)}px ${SERIF}`;
    const tries = [[16, 13, 'left'], [16, -13, 'left'], [-16, 13, 'right'], [-16, -13, 'right'], [0, 24, 'center'], [0, -24, 'center']]
      .filter(([dx]) => (dx >= 0 ? x < frame.x + frame.w - 110 : x > frame.x + 110) || dx === 0);
    const pick = tries.find(([dx, dy, al]) => !overlaps(textBox(g, 'YOU ARE HERE', x + dx * k, y + dy * k, font, al))) || tries[0] || [16, 13, 'left'];
    haloText(g, 'YOU ARE HERE', x + pick[0] * k, y + pick[1] * k, { font, fill: C.red, align: pick[2], hw: 3.5 });
  }
  g.restore();   // unclip
  // --- neatline + edge ticks every 100 m
  g.save();
  g.strokeStyle = C.ink; g.lineWidth = 1.6; g.strokeRect(frame.x, frame.y, frame.w, frame.h);
  g.lineWidth = 0.6; g.strokeRect(frame.x - 4, frame.y - 4, frame.w + 8, frame.h + 8);
  g.lineWidth = 0.9; g.font = `${Math.round(8.5 * k)}px ${SERIF}`; g.fillStyle = '#3d3326';
  const tick = 100;
  g.beginPath();
  for (let x = Math.ceil(view.ext.x0 / tick) * tick; x <= view.ext.x1; x += tick) { const X = px(x); g.moveTo(X, frame.y); g.lineTo(X, frame.y + 7); g.moveTo(X, frame.y + frame.h); g.lineTo(X, frame.y + frame.h - 7); }
  for (let z = Math.ceil(view.ext.z0 / tick) * tick; z <= view.ext.z1; z += tick) { const Y = py(z); g.moveTo(frame.x, Y); g.lineTo(frame.x + 7, Y); g.moveTo(frame.x + frame.w, Y); g.lineTo(frame.x + frame.w - 7, Y); }
  g.stroke();
  g.restore();
  // --- title, legend, scale, north arrow
  if (view.panel) drawPanel(g, view, k, data); else drawOverlay(g, view, k, data);
  // --- folds + vignette
  g.save();
  for (const [x0, y0, x1, y1] of [[W / 2, 0, W / 2, H], [0, H / 2, W, H / 2]]) {
    g.strokeStyle = 'rgba(255,252,240,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 1, y0 + 1); g.lineTo(x1 + 1, y1 + 1); g.stroke();
    g.strokeStyle = 'rgba(80,60,34,0.14)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.56);
  vg.addColorStop(0, 'rgba(90,62,30,0)'); vg.addColorStop(1, 'rgba(90,62,30,0.3)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.restore();
  g.restore();
  const labels = BOXES; BOXES = null;
  return { ms: now() - t0, cached: !!layer.cached, view, benches, labels };
}

// ------------------------------------------------------------------ margin furniture
function legendRows() {
  return [
    ['trail', 'Trail'], ['creek', 'Stream'], ['contour', 'Contour, 10 m'], ['index', 'Index contour, 50 m'], ['wood', 'Timber'],
    ['ravine', 'Ravine, cliff'], ['burn', 'Burned area, 1980'], ['lookout', 'Fire lookout'], ['spring', 'Spring'], ['bridge', 'Footbridge'],
    ['camp', 'Campsite'], ['parking', 'Trailhead parking'], ['vista', 'Viewpoint'], ['bench', 'Rest bench'], ['you', 'You are here'],
  ];
}
function legendSwatch(g, kind, x, y, k) {
  g.save();
  const w = 26 * k;
  if (kind === 'trail') { g.strokeStyle = C.trail; g.lineWidth = 2.5 * k; g.setLineDash([8 * k, 4.5 * k]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
  else if (kind === 'creek') { g.strokeStyle = C.waterLight; g.lineWidth = 4 * k; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + w * 0.3, y - 4, x + w * 0.6, y + 4, x + w, y); g.stroke(); g.strokeStyle = C.water; g.lineWidth = 1.8 * k; g.stroke(); }
  else if (kind === 'contour' || kind === 'index') { g.strokeStyle = kind === 'index' ? C.brownIdx : C.brown; g.lineWidth = kind === 'index' ? 1.35 : 0.8; g.beginPath(); g.moveTo(x, y + 3); g.bezierCurveTo(x + w * 0.35, y - 5, x + w * 0.65, y + 5, x + w, y - 3); g.stroke(); }
  else if (kind === 'wood') { g.fillStyle = rgb(C.wood); g.fillRect(x, y - 6, w, 12); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.6; g.strokeRect(x, y - 6, w, 12); }
  else if (kind === 'ravine') { g.fillStyle = rgb(C.cliff); g.fillRect(x, y - 6, w, 12); g.beginPath(); g.rect(x, y - 6, w, 12); g.clip(); g.strokeStyle = C.hatch; g.lineWidth = 0.8; g.beginPath(); for (let c = x - 12; c < x + w; c += 4.2) { g.moveTo(c, y + 6); g.lineTo(c + 12, y - 6); } g.stroke(); }
  else if (kind === 'burn') { g.fillStyle = rgb(C.burn); g.fillRect(x, y - 6, w, 12); g.fillStyle = C.stipple; let s = 3; for (let i = 0; i < 26; i++) { s = (s * 16807) % 2147483647; const a = s / 2147483647; s = (s * 16807) % 2147483647; const b = s / 2147483647; g.fillRect(x + a * w, y - 6 + b * 12, 1.2, 1.2); } }
  else if (kind === 'you') { g.translate(x + w / 2, y); const L = 9 * k, B = 5 * k; g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(0, -L); g.lineTo(B, L * 0.62); g.lineTo(0, L * 0.28); g.lineTo(-B, L * 0.62); g.closePath(); g.fillStyle = C.red; g.fill(); }
  else if (SYM[kind]) SYM[kind](g, x + w / 2, y, k * 0.95, 0);
  g.restore();
}
function scaleBars(g, x, y, maxW, s, k) {
  // metres: a nice round length that fits
  const pick = (unitPx, cands) => { for (const c of cands) if (c * unitPx <= maxW) return c; return cands[cands.length - 1]; };
  const m = pick(s, [500, 400, 300, 200, 100, 50]);
  const ft = pick(s * 0.3048, [1500, 1000, 800, 600, 500, 300, 200]);
  g.save(); g.font = `${Math.round(9.5 * k)}px ${SERIF}`; g.fillStyle = C.ink; g.strokeStyle = C.ink; g.textBaseline = 'alphabetic';
  const bar = (yy, len, units, label, div) => {
    const L = len * units, n = div;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? 'rgb(236,227,203)' : C.ink; g.fillRect(x + (L * i) / n, yy, L / n, 4.5 * k); }
    g.lineWidth = 0.8; g.strokeRect(x, yy, L, 4.5 * k);
    g.fillStyle = C.ink; g.textAlign = 'center';
    for (const i of [0, n / 2, n]) g.fillText(String(Math.round((len * i) / n)), x + (L * i) / n, yy - 3);
    g.textAlign = 'left'; g.fillText(label, x + L + 6, yy + 5 * k);
  };
  bar(y, m, s, 'METRES', 4);
  bar(y + 26 * k, ft, s * 0.3048, 'FEET', 4);
  g.restore();
  return 44 * k;
}
function northArrow(g, x, y, k) {   // true north (star) and magnetic north, 20 deg east in the Cascades in 1983
  g.save(); g.translate(x, y);
  const L = 58 * k, d = 20 * Math.PI / 180;
  g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
  g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.6 * k : 6.5 * k, a = -Math.PI / 2 + (i * Math.PI) / 5, px_ = Math.cos(a) * r, py_ = -L - 5 * k + Math.sin(a) * r; if (i) g.lineTo(px_, py_); else g.moveTo(px_, py_); }
  g.closePath(); g.fill();
  const tx = Math.sin(d) * L * 0.88, ty = -Math.cos(d) * L * 0.88;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(tx, ty); g.stroke();
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 3.4 * k * Math.cos(d) + 0.6 * k, ty + 9 * k); g.lineTo(tx + 0.8 * k, ty + 8.4 * k); g.closePath(); g.fill();   // half arrowhead
  g.font = `${Math.round(9 * k)}px ${SERIF}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('MN', tx + 4 * k, ty + 2 * k);
  g.textAlign = 'left'; g.font = `${Math.round(8 * k)}px ${SERIF}`; g.fillText('20°', tx * 0.45 + 4 * k, ty * 0.45 + 6 * k);
  g.restore();
}
function wrapText(g, text, x, y, maxW, lh) {
  const words = text.split(/\s+/); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}
function drawPanel(g, view, k, data) {
  const P = view.panel, x = P.x, w = P.w; let y = P.y;
  g.save();
  g.strokeStyle = C.ink; g.lineWidth = 1.6; g.strokeRect(P.x, P.y, P.w, P.h); g.lineWidth = 0.6; g.strokeRect(P.x - 4, P.y - 4, P.w + 8, P.h + 8);
  const cx = x + w / 2, pad = 16 * k;
  g.fillStyle = C.ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  y += 24 * k; g.font = `${Math.round(8.6 * k)}px ${SERIF}`; g.fillText('UNITED STATES DEPARTMENT OF AGRICULTURE', cx, y);
  y += 12 * k; g.fillText('FOREST SERVICE', cx, y);
  y += 34 * k; g.font = `bold ${Math.round(27 * k)}px ${SERIF}`; g.fillText('TAMARACK', cx, y);
  y += 25 * k; g.font = `${Math.round(17 * k)}px ${SERIF}`; g.fillText('LOOKOUT  &  VICINITY', cx, y);
  y += 20 * k; g.font = `italic ${Math.round(12 * k)}px ${SERIF}`; g.fillText('Trail No. 1411 · Camp Loop · Overlook Spur', cx, y);
  y += 16 * k; g.fillText('Silver Fork Ranger District', cx, y);
  y += 14 * k; g.strokeStyle = C.ink; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + pad, y); g.lineTo(x + w - pad, y); g.stroke();
  // legend
  y += 20 * k; g.font = `bold ${Math.round(10.5 * k)}px ${SERIF}`; g.textAlign = 'left'; g.fillText('LEGEND', x + pad, y);
  const rows = legendRows(), rh = Math.min(21 * k, (P.y + P.h - y - 230 * k) / rows.length);
  y += 8 * k;
  g.font = `${Math.round(11 * k)}px ${SERIF}`;
  for (const [kind, label] of rows) {
    y += rh; legendSwatch(g, kind, x + pad, y - 4 * k, k);
    g.fillStyle = C.ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(label, x + pad + 36 * k, y);
  }
  y += 14 * k; g.beginPath(); g.moveTo(x + pad, y); g.lineTo(x + w - pad, y); g.stroke();
  // scale + north arrow
  y += 26 * k; g.font = `bold ${Math.round(10 * k)}px ${SERIF}`; g.fillStyle = C.ink; g.fillText('SCALE', x + pad, y);
  y += 20 * k; scaleBars(g, x + pad, y, w - pad * 2 - 56 * k, view.s, k);
  y += 64 * k;
  northArrow(g, x + w - pad - 24 * k, y + 50 * k, k);
  g.font = `${Math.round(9.4 * k)}px ${SERIF}`; g.textAlign = 'left'; g.fillStyle = C.ink;
  g.fillText('CONTOUR INTERVAL 10 METRES', x + pad, y);
  y += 13 * k; g.fillText('Elevations in metres above sea level', x + pad, y);
  y += 13 * k; g.fillText('Magnetic declination 20° E, 1983', x + pad, y);
  // the notice every district map carried, in this district's words
  const noteTop = y + 40 * k, noteBottom = P.y + P.h - 30 * k;
  if (noteBottom - noteTop > 60 * k) {
    let yy = noteTop;
    g.font = `bold ${Math.round(9.6 * k)}px ${SERIF}`; g.fillText('NOTICE', x + pad, yy); yy += 14 * k;
    g.font = `italic ${Math.round(9.8 * k)}px ${SERIF}`;
    for (const para of ['Stay on established trails. Timber off the trail is dense and unmarked; the ground at the Cold Creek Cut is undercut and gives way without warning.',
      'Report every smoke to Tamarack Lookout. Walkers after dark: signal the lookout with your light, and follow the lamp down.']) {
      if (yy > noteBottom - 12 * k) break;
      yy = wrapText(g, para, x + pad, yy, w - pad * 2, 12.5 * k) + 5 * k;
    }
  }
  g.font = `italic ${Math.round(9.4 * k)}px ${SERIF}`; g.textAlign = 'center';
  g.fillText('Revised 1983 · pinned in the cab', cx, P.y + P.h - 12 * k);
  g.restore();
}
function drawOverlay(g, view, k, data) {   // square canvas: cartouche + legend boxes over the map corners
  const F = view.frame;
  g.save();
  const box = (x, y, w, h) => { g.fillStyle = 'rgba(238,230,208,0.94)'; g.fillRect(x, y, w, h); g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(x, y, w, h); };
  box(F.x + 10, F.y + 10, 214 * k, 64 * k);
  g.fillStyle = C.ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `bold ${Math.round(17 * k)}px ${SERIF}`; g.fillText('TAMARACK LOOKOUT', F.x + 20, F.y + 32 * k);
  g.font = `italic ${Math.round(10.5 * k)}px ${SERIF}`; g.fillText('Trail No. 1411 · Silver Fork R.D. · 1983', F.x + 20, F.y + 48 * k);
  g.font = `${Math.round(9 * k)}px ${SERIF}`; g.fillText('Contour interval 10 m', F.x + 20, F.y + 62 * k);
  const rows = legendRows(), rh = 17 * k, bh = rows.length * rh + 16 * k, bw = 168 * k, bx = F.x + 10, by = F.y + F.h - bh - 10;
  box(bx, by, bw, bh);
  g.font = `${Math.round(10 * k)}px ${SERIF}`;
  rows.forEach(([kind, label], i) => { const yy = by + 12 * k + i * rh; legendSwatch(g, kind, bx + 8, yy, k * 0.85); g.fillStyle = C.ink; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, bx + 40 * k, yy); });
  box(F.x + F.w - 250 * k, F.y + F.h - 66 * k, 240 * k, 56 * k);
  scaleBars(g, F.x + F.w - 240 * k, F.y + F.h - 48 * k, 160 * k, view.s, k * 0.85);
  box(F.x + F.w - 74 * k, F.y + 10, 64 * k, 96 * k);
  northArrow(g, F.x + F.w - 50 * k, F.y + 96 * k, k * 0.95);
  g.restore();
}
