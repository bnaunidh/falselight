// FALSE LIGHT — three landmarks, built in code the way the fire cache is (fireCache.js: the scene's own PBR materials,
// one merged mesh per material, colliders, hidden when far, each built the first time you come within a few hundred
// metres):
//   THE FIRST LOOKOUT, in the Burn: what's left of the Tamarack lookout that burned with the ridge. Four sooty footings
//     (a date plate on one), a leg still standing snapped at head height, a stub, one leaning, one down; the cab where it
//     fell, its roof sheets curled like paper; half a flight of stairs up to nothing; the fire finder's warped ring in the
//     ash. Off the trail, in a clearing in the snags, in plain sight of it. To show this has happened before.
//   THE OLD LOOKOUT ROAD, west out of the Burn: the road bed the first lookout was supplied by, 200 m to the edge of the
//     district, where a striped barricade and a jam of deadfall close it (a wall: walk up to it, not past).
//   THE ROAD OUT, from the trailhead lot up the slope to the Silver Fork tunnel: a gravel strip draped on the ground, a
//     1930s concrete portal in a rock bluff at the edge of the district, its steel gate chained. openTunnel() opens it
//     (the week's last morning: the forest burns and Walt's truck drives you out through it; tunnelRoute() is its way).
// The pure half (where, what blocks, the truck's route) is at the top; node tests it (tests/landmarks.test.mjs).
import * as THREE from 'three';
import { loadGLB } from '../engine/world.js?v=f72bf2c303254cc4';
import { MB, Bins, M4, memberM, WP, WB, canvasTex, decalMat, sceneMaterials, cullTrees, rng, hash, smooth, scuff, SERIF, SANS } from './fireCache.js?v=d62e642fa3a7ab78';
import { nearestOnLine, pointAt, lineLength } from './northWoods.js?v=c3361da37c67a0c9';

const V3 = THREE.Vector3;
export const LANDMARKS = {
  // a clearing in the snags 28 m west of the loop trail, nothing within 10 m, 0.7 m of fall across the footings
  ruin: { pos: [-185, 39], rotY: 0.35, half: 2.4, plate: ['TAMARACK  L.O.', 'U.S.F.S.   1934'], scratched: 'BURNED OVER 8-14-50' },
  oldRoad: { points: [[-179, 41], [-200, 36], [-225, 30], [-255, 26], [-290, 24], [-325, 22], [-360, 20], [-385, 19], [-405, 17]], half: 1.6, barricadeX: -366, deadfall: [-379, -369] },
  // up from the lot (the truck parks at 18, 383 facing it), ~95 m on the easiest grade (≤ 26% over any 2 m) to the portal,
  // where the slope stands up steepest behind it; the district's edge is z 475
  tunnel: { from: [18, 383], road: [[20, 392], [21, 399], [23, 410], [29, 416], [31, 425], [33, 436], [37, 446], [41, 456], [45, 464], [47, 470], [47, 482]], half: 2.1, portal: [47, 470], rotY: Math.PI, span: 4.6, spring: 3.2, depth: 12,
    name: 'SILVER FORK TUNNEL', year: '1937' },
};
const LM = LANDMARKS;
const roadPt = (pts, x) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if ((a[0] - x) * (b[0] - x) <= 0) { const t = (x - a[0]) / (b[0] - a[0] || 1e-9); return [x, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])]; } } return null; };
/** Where the barricade stands on the old road → [x, z, dirX, dirZ] (dir = the road going west, out). */
export const barricadeAt = () => roadPt(LM.oldRoad.points, LM.oldRoad.barricadeX);
/** The deadfall jam behind the barricade: true = you can't clamber through it (wire into the player's extraBlocked). */
export function landmarkBlocks(x, z) {
  const [x0, x1] = LM.oldRoad.deadfall; if (x < x0 || x > x1 || z < 5 || z > 35) return false;
  return nearestOnLine(x, z, LM.oldRoad.points).d < 7.5;
}
/** Walt's truck, out: from its parking spot, up the road, through the portal into the dark. → [[x, y, z]] */
export function tunnelRoute(heightAt, step = 2) {
  const P = [LM.tunnel.from, ...LM.tunnel.road], L = lineLength(P), out = [];
  for (let s = 0; s <= L + 1e-6; s += step) { const [x, z] = pointAt(P, Math.min(s, L)); out.push([x, heightAt(x, z), z]); }
  return out;
}
/** The portal's own frame (local +z = out of the hill, toward the lot): local [x, y, z] → world (y on baseY). */
export function portalToWorld(l, baseY = 0) { const T = LM.tunnel, c = Math.cos(T.rotY), s = Math.sin(T.rotY); return [T.portal[0] + l[0] * c + l[2] * s, baseY + l[1], T.portal[1] - l[0] * s + l[2] * c]; }
export function ruinToWorld(l, baseY = 0) { const R = LM.ruin, c = Math.cos(R.rotY), s = Math.sin(R.rotY); return [R.pos[0] + l[0] * c + l[2] * s, baseY + l[1], R.pos[1] - l[0] * s + l[2] * c]; }

// ------------------------------------------------------------------ paint
const TX = {
  plate: () => canvasTex(160, 96, (g, w, h) => {   // the date plate: cast bronze gone black, the letters rubbed brighter
    g.fillStyle = '#3a2f1e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6d5a36'; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 22px ${SERIF}`;
    for (const [t, y] of [[LM.ruin.plate[0], 34], [LM.ruin.plate[1], 66]]) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(t, w / 2 + 1, y + 1.5); g.fillStyle = '#9c8452'; g.fillText(t, w / 2, y); }
    g.font = `12px ${SANS}`; g.fillStyle = 'rgba(200,180,130,0.75)'; g.fillText(LM.ruin.scratched, w / 2 + 2, 84);   // scratched in later with a nail point
    scuff(g, w, h, 500, 19, 'rgba(10,8,6,0.6)');
  }),
  ash: () => canvasTex(256, 256, (g, w, h) => {   // the ground under the ruin: ash, char, a few nails and glass
    const R = rng(1950); g.clearRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const x = w / 2 + (R() - 0.5) * w * 0.8, y = h / 2 + (R() - 0.5) * h * 0.8, r = 10 + R() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); const k = R() < 0.6 ? '12,11,10' : '92,88,82'; gr.addColorStop(0, `rgba(${k},${0.35 + R() * 0.4})`); gr.addColorStop(1, `rgba(${k},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    for (let i = 0; i < 900; i++) { const a = R() * 6.28, d = Math.pow(R(), 0.7) * w * 0.42; g.fillStyle = R() < 0.9 ? `rgba(20,18,16,${0.5 + R() * 0.5})` : `rgba(160,160,150,${0.6})`; g.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 1 + R() * 3, 1 + R() * 2); }
    g.globalCompositeOperation = 'destination-in'; const m = g.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w / 2); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = m; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
  }),
  oldRoad: () => canvasTex(64, 256, (g, w, h) => {   // an old dirt road bed: two faint tracks, needles and cones over it
    const R = rng(410); g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) { const u = x / (w - 1), tr = Math.max(Math.exp(-(((u - 0.3) / 0.08) ** 2)), Math.exp(-(((u - 0.7) / 0.08) ** 2))), e = smooth(0, 0.14, u) * smooth(1, 0.86, u); g.fillStyle = `rgba(${72 - tr * 14 | 0},${60 - tr * 12 | 0},${46 - tr * 10 | 0},${(0.34 + tr * 0.46) * e})`; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${55 + R() * 55 | 0},${42 + R() * 35 | 0},${28 + R() * 18 | 0},${R() * 0.5})`; g.fillRect(R() * w, R() * h, 1, 2 + R() * 4); }
  }, { repeat: true }),
  gravel: () => canvasTex(64, 256, (g, w, h) => {   // the road out: grey gravel, packed darker in the wheel tracks, a weedy crown
    const R = rng(1937); g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x++) { const u = x / (w - 1), tr = Math.max(Math.exp(-(((u - 0.28) / 0.09) ** 2)), Math.exp(-(((u - 0.72) / 0.09) ** 2))), e = smooth(0, 0.08, u) * smooth(1, 0.92, u), crown = Math.exp(-(((u - 0.5) / 0.06) ** 2));
      g.fillStyle = `rgba(${98 - tr * 24 - crown * 20 | 0},${94 - tr * 22 - crown * 8 | 0},${86 - tr * 22 - crown * 18 | 0},${(0.62 + tr * 0.25) * e})`; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 2600; i++) { const v = 70 + R() * 110 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.35 + R() * 0.5})`; g.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1 + R() * 1.5); }
  }, { repeat: true }),
  stripes: () => canvasTex(256, 32, (g, w, h) => {   // barricade rails: orange and white, faded, chipped
    for (let x = -h; x < w + h; x += 32) { g.fillStyle = '#c96a2c'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 - h, h); g.lineTo(x - h, h); g.closePath(); g.fill(); g.fillStyle = '#ddd6c6'; g.beginPath(); g.moveTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 - h, h); g.lineTo(x + 16 - h, h); g.closePath(); g.fill(); }
    scuff(g, w, h, 400, 7, 'rgba(70,56,40,0.7)');
  }),
  closed: () => canvasTex(200, 96, (g, w, h) => { g.fillStyle = '#d9d4c6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1d1c1a'; g.lineWidth = 5; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#1d1c1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 34px ${SANS}`; g.fillText('ROAD', w / 2, 32); g.fillText('CLOSED', w / 2, 66); scuff(g, w, h, 350, 13, 'rgba(110,70,40,0.7)'); }),
  portal: () => canvasTex(512, 96, (g, w, h) => {   // cast into the headwall: the name and the year, dark with weather
    g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 46px ${SERIF}`;
    g.fillStyle = 'rgba(30,28,24,0.75)'; g.fillText(LM.tunnel.name, w / 2 + 2, 36 + 2); g.fillStyle = 'rgba(52,50,45,0.9)'; g.fillText(LM.tunnel.name, w / 2, 36);
    g.font = `bold 30px ${SERIF}`; g.fillText(LM.tunnel.year, w / 2, 78);
  }),
  stain: () => canvasTex(256, 256, (g, w, h) => {   // forty years of rain: dark runs down from the coping and round the arch
    const R = rng(37); g.clearRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) { const x = R() * w, y0 = R() < 0.6 ? 0 : h * (0.2 + R() * 0.3), l = 20 + R() * 150; const gr = g.createLinearGradient(0, y0, 0, y0 + l); gr.addColorStop(0, `rgba(20,22,18,${0.25 + R() * 0.35})`); gr.addColorStop(1, 'rgba(20,22,18,0)'); g.fillStyle = gr; g.fillRect(x, y0, 1.5 + R() * 5, l); }
    const gb = g.createLinearGradient(0, h, 0, h * 0.75); gb.addColorStop(0, 'rgba(40,44,30,0.6)'); gb.addColorStop(1, 'rgba(40,44,30,0)'); g.fillStyle = gb; g.fillRect(0, h * 0.75, w, h * 0.25);   // splash + moss at the foot
  }),
  gateSign: () => canvasTex(180, 100, (g, w, h) => { g.fillStyle = '#cfc6b2'; g.fillRect(0, 0, w, h); g.fillStyle = '#8e2d20'; g.fillRect(0, 0, w, 34); g.fillStyle = '#e8e0cf'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 22px ${SANS}`; g.fillText('TUNNEL CLOSED', w / 2, 18); g.fillStyle = '#26221e'; g.font = `14px ${SANS}`; g.fillText('AUTHORIZED VEHICLES ONLY', w / 2, 56); g.fillText('SILVER FORK R.D.', w / 2, 80); scuff(g, w, h, 500, 29, 'rgba(120,80,45,0.6)'); }),
};

// ------------------------------------------------------------------ materials
function makeMats(W) {
  const found = sceneMaterials(W), got = [];
  const std = (name, o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.9, ...o }); m.name = name; return m; };
  const get = (n, fb) => { const m = found.get(n); if (m) { got.push(n); return m; } return std(n + '_fb', fb); };
  const tint = (m, name, col, o = {}) => { const c = m.clone(); c.name = name; c.color.multiply(new THREE.Color(...col)); Object.assign(c, o); if (o.envMapIntensity != null) c.userData.envBase = o.envMapIntensity; return c; };
  const M = {
    timber: get('FL_tw_timber', { color: 0x6d6254 }), conc: get('FL_tw_concrete', { color: 0x8a867e }), steel: get('FL_tw_steel', { color: 0x5e5248, roughness: 0.7, metalness: 0.55 }),
    roof: get('FL_tw_roof', { color: 0x5f5e5a, roughness: 0.6, metalness: 0.45 }), sign: get('FL_pr_sign', { color: 0x4a3526 }),
    rock: found.get('boulder_01') || get('FL_pr_mossy', { color: 0x6a665c, roughness: 0.95 }),
  };
  if (found.get('boulder_01')) got.push('boulder_01');
  M.char = tint(M.timber, 'FL_lm_char', [0.2, 0.17, 0.15], { roughness: 1, envMapIntensity: 0.35 });   // burned timber: the planks' grain, gone black
  M.soot = tint(M.conc, 'FL_lm_soot', [0.52, 0.5, 0.47], { envMapIntensity: 0.6 });
  M.iron = tint(M.steel, 'FL_lm_iron', [0.5, 0.42, 0.38]);
  M.sheet = tint(M.roof, 'FL_lm_scorched', [1, 1, 1]); M.sheet.vertexColors = true; M.sheet.side = THREE.DoubleSide;
  M.lining = tint(M.conc, 'FL_lm_lining', [0.55, 0.55, 0.53], { envMapIntensity: 0.18 }); M.lining.vertexColors = true;
  M.headwall = tint(M.conc, 'FL_lm_headwall', [0.86, 0.85, 0.82]);
  M.dark = std('FL_lm_dark', { color: 0x020202, roughness: 1 }); M.dark.envMapIntensity = 0; M.dark.userData.envBase = 0;
  M.bronze = std('FL_lm_bronze', { color: 0xffffff, roughness: 0.55, metalness: 0.7 });
  M.brass = std('FL_lm_brass', { color: 0x8f6f38, roughness: 0.42, metalness: 1 });
  M.found = got;
  return M;
}

/** A strip draped on the ground along a polyline ([[x, z]]): half-width, a texture across (u) and repeating along (v). */
function ribbon(pts, half, heightAt, mat, { vScale = 4, lift = 0.05, s0 = 0.5, s1 = null, step = 1, cols = 5 } = {}) {
  const L = lineLength(pts), end = s1 ?? L - 0.5, pos = [], uv = [], idx = []; let n = 0;
  for (let s = s0; s <= end + 1e-6; s += step, n++) {
    const [x, z, dx, dz] = pointAt(pts, s), q = pointAt(pts, Math.min(L, s + 1.5)), tx = dx + q[2], tz = dz + q[3], l = Math.hypot(tx, tz) || 1;
    for (let c = 0; c < cols; c++) { const u = c / (cols - 1), o = (u - 0.5) * 2 * half, px = x - (tz / l) * o, pz = z + (tx / l) * o; pos.push(px, heightAt(px, pz) + lift, pz); uv.push(u, s / vScale); }
  }
  for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) { const a = i * cols + c, b = a + cols; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = 1; return m;
}
const stripMat = (tex) => (tex ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }) : null);

/** Collect standing things of these kinds (world.js vegetation sets) that pred(x, z) says go → cullTrees list. */
function cullWhere(W, kinds, pred) {
  const list = []; for (const vs of W.vegSets || []) if (kinds.test(vs.kind) && vs.inst) for (const p of vs.inst) if (pred(p[0], p[2])) list.push([vs.kind, p[0], p[2]]);
  return { list, n: cullTrees(W, list) };
}

// ------------------------------------------------------------------ the ruin (local: centre of the four footings)
function buildRuin(M, g, R) {
  const B = new Bins(), H = LM.ruin.half, pier = {};
  // the footings: sooty concrete, each at its own ground (the ridge falls away southwest)
  for (const [k, sx, sz] of [['a', 1, -1], ['b', -1, -1], ['c', -1, 1], ['d', 1, 1]]) {
    const x = sx * H, z = sz * H, gy = g(x, z), top = gy + 0.35; pier[k] = { x, z, top };
    B.get('soot').box(0.62, top - gy + 0.4, 0.62, M4(x, (top + gy - 0.4) / 2, z), { tile: 1.1, off: [hash(sx, sz), 0.3] });
    B.get('iron').box(0.06, 0.12, 0.06, M4(x, top + 0.04, z), { tile: 0.2 });   // the anchor bolt, bent
  }
  // the legs: A still standing, snapped at head height; B a stub; C leaning out over the slope; D down in the ash
  const post = (m, h, r = 0.13) => B.get('char').lathe([[r * 1.12, 0], [r * 1.05, h * 0.55], [r * 0.95, h - 0.35], [r * 0.6, h - 0.12], [r * 0.18, h]], m, 4, { tile: 0.9, a0: Math.PI / 4, a1: Math.PI / 4 + Math.PI * 2 });
  post(M4(pier.a.x, pier.a.top, pier.a.z, 0.035, 0, -0.03), 3.4);
  post(M4(pier.b.x, pier.b.top, pier.b.z, 0, 0.3, 0.02), 1.25);
  const leanM = new THREE.Matrix4().compose(new V3(pier.c.x, pier.c.top, pier.c.z), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(-0.42, 0.87, 0.26).normalize()), new V3(1, 1, 1));
  post(leanM, 5.4);
  { const d = new V3(0.35, 0, 1).normalize(), L = 6.6, a = new V3(pier.d.x, pier.d.top + 0.05, pier.d.z), b = a.clone().addScaledVector(d, L); b.y = g(b.x, b.z) + 0.12;
    const { m } = memberM(a, b); B.get('char').box(0.24, 0.24, L, m, { wood: WP, j: 3 }); }
  // braces: one hanging off A by a bolt, one burned through and lying between the footings, a girt stub off A
  { const { m, L } = memberM(new V3(pier.a.x - 0.1, pier.a.top + 3.1, pier.a.z), new V3(pier.a.x - 1.2, g(pier.a.x - 1.3, pier.a.z + 0.5) + 0.05, pier.a.z + 0.5)); B.get('char').box(0.05, 0.19, L, m, { wood: WP, j: 1 }); }
  { const a = new V3(0.3, g(0.3, -1.6) + 0.06, -1.6), b = new V3(-2.1, g(-2.1, -0.4) + 0.06, -0.4), { m, L } = memberM(a, b); B.get('char').box(0.19, 0.05, L, m, { wood: WP, j: 5 }); }
  { const { m, L } = memberM(new V3(pier.a.x - 0.1, pier.a.top + 1.4, pier.a.z), new V3(pier.a.x - 2.3, pier.a.top + 1.25, pier.a.z + 0.05)); B.get('char').box(0.05, 0.19, L, m, { wood: WP, j: 4 }); }
  // half a flight of stairs up to nothing: two stringers, treads (two gone), a burned post under the top
  { const x0 = 5.9, x1 = 3.0, zc = -0.9, y0 = g(x0, zc), y1 = y0 + 1.9;
    for (const dz of [-0.42, 0.42]) { const { m, L } = memberM(new V3(x0 + 0.2, y0 - 0.05, zc + dz), new V3(x1, y1, zc + dz)); B.get('char').box(0.06, 0.25, L, m, { wood: WP, j: 2 }); }
    for (let i = 0; i < 7; i++) { if (i === 2 || i === 5) continue; const t = (i + 0.7) / 7.4, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + 0.12; B.get('char').box(0.26, 0.04, 0.8 - (i === 6 ? 0.25 : 0), M4(x, y, zc + (i === 6 ? 0.12 : 0), 0, 0, (hash(i) - 0.5) * 0.12), { wood: WP, j: i }); }
    post(M4(x1 + 0.1, g(x1 + 0.1, zc), zc, 0, 0.5, 0), 1.75, 0.07); }
  // the cab, where it came down: its sill frame on the slope, window posts burned to stumps, a few floor boards
  const cab = { x: -4.4, z: 4.6, r: 0.3 };
  { const c = Math.cos(cab.r), s = Math.sin(cab.r), P = (lx, lz) => [cab.x + lx * c + lz * s, cab.z - lx * s + lz * c], half = 2.1;
    const sill = (ax, az, bx, bz, cut = 0) => { const [x0, z0] = P(ax, az), [x1, z1] = P(bx, bz); const a = new V3(x0, g(x0, z0) + 0.09, z0), b = new V3(x1, g(x1, z1) + 0.09, z1); b.lerp(a, cut); const { m, L } = memberM(a, b); B.get('char').box(0.15, 0.18, L, m, { wood: WP, j: 2 }); };
    sill(-half, -half, half, -half); sill(half, -half, half, half, 0.35); sill(half, half, -half, half); sill(-half, half, -half, -half, 0.2);
    for (let i = 0; i < 9; i++) { const u = -half + (i + 0.5) * (2 * half / 9); if (hash(i, 4) < 0.45) continue; const [x0, z0] = P(u, -half + 0.2), [x1, z1] = P(u, -half + 0.2 + 1.2 + hash(i) * 2.2); const { m, L } = memberM(new V3(x0, g(x0, z0) + 0.14, z0), new V3(x1, g(x1, z1) + 0.14, z1)); B.get('char').box(0.14, 0.03, L, m, { wood: WP, j: i }); }
    for (const [lx, lz] of [[-half, -half], [half, -half], [half, half], [-half, half], [0, -half], [half, 0.3], [-0.6, half], [-half, -0.8]]) { const [x, z] = P(lx, lz); post(M4(x, g(x, z) + 0.12, z, (hash(lx, lz) - 0.5) * 0.3, 0, (hash(lz, lx) - 0.5) * 0.3), 0.25 + hash(lx + 3, lz) * 0.9, 0.05); }
    // the rafters, fallen across it
    for (const [ax, az, bx, bz] of [[-2.6, -1.2, 1.5, 2.8], [-1.2, -2.9, 2.4, 0.4]]) { const [x0, z0] = P(ax, az), [x1, z1] = P(bx, bz); const { m, L } = memberM(new V3(x0, g(x0, z0) + 0.18, z0), new V3(x1, g(x1, z1) + 0.45, z1)); B.get('char').box(0.06, 0.16, L, m, { wood: WP, j: 6 }); }
    // the woodstove on its side, and its pipe
    const [sx, sz] = P(0.9, 0.8); B.get('iron').box(0.62, 0.38, 0.42, M4(sx, g(sx, sz) + 0.2, sz, 0, 0.6, 0.12), { tile: 0.5 });
    B.get('iron').lathe([[0.075, 0], [0.075, 0.9]], M4(sx + 0.5, g(sx + 0.5, sz - 0.6) + 0.08, sz - 0.6, 0, 0.3, Math.PI / 2), 10, { tile: 0.4 });
    // the fire finder: its ring warped in the heat, half in the ash, the pedestal beside it
    const [fx, fz] = P(-0.7, 0.2), ring = [];
    for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, r = 0.33 * (1 + 0.07 * Math.sin(a * 2 + 0.6)); ring.push(new V3(fx + Math.cos(a) * r, g(fx, fz) + 0.03 + 0.05 * Math.sin(a * 3) + 0.06 * Math.cos(a), fz + Math.sin(a) * r)); }
    B.get('iron').tube(ring, 0.017, 5, 0.3);
    B.get('iron').lathe([[0.09, 0], [0.06, 0.12], [0.06, 0.8], [0.11, 0.9]], M4(fx - 0.9, g(fx - 0.9, fz + 0.3) + 0.09, fz + 0.3, 0, 1.1, Math.PI / 2 - 0.05), 10, { tile: 0.4, cap0: true, cap1: true });
  }
  // the roof: corrugated sheets curled by the heat, scorched black to rust (vertex colours), round the cab and on leg D
  const S = B.get('sheet', true), Rr = rng(1980);
  for (const [x, z, yaw, bend, lift] of [[-5.6, 2.4, 0.6, 0.45, 0], [-2.8, 6.6, 2.1, 0.3, 0], [-6.4, 6.2, -0.4, 0.6, 0], [1.9, 4.6, 1.2, 0.25, 0.28]]) {
    const n = 7, m = 3, L = 2.2, Wd = 0.9, c = Math.cos(yaw), s = Math.sin(yaw), tw = (Rr() - 0.5) * 0.6, i0 = S.count;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      const u = i / n, v = j / m, lx = (u - 0.5) * L, lz = (v - 0.5) * Wd, px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      const y = g(px, pz) + 0.04 + lift * (1 - u) + bend * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(v * 3 + u)) + tw * (v - 0.5) * u + 0.05 * Math.sin(u * 17 + v * 9);
      const k = hash(i * 7 + j, x); S.v(new V3(px, y, pz), new V3(0, 1, 0), u * L / 0.9, -v * Wd / 0.9, k < 0.45 ? [0.18, 0.15, 0.13] : k < 0.8 ? [0.62, 0.38, 0.22] : [0.85, 0.8, 0.74]);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const a = i0 + i * (m + 1) + j, b = a + m + 1; S.I.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  return { B, pier, cab };
}

// ------------------------------------------------------------------ the portal (local: the headwall's foot centre, +z out)
function buildPortal(M, g, floorAt) {
  const T = LM.tunnel, B = new Bins(), span = T.span / 2, crown = T.spring + span, HW = 4.9, TOP = 7.3;
  // the headwall: a slab with the arch cut through it, pilasters, a coping and a keystone
  // (the opening comes down to the slab's foot: the road runs straight in under it)
  const hs = new THREE.Shape(); hs.moveTo(-HW, 0); hs.lineTo(-span, 0); hs.lineTo(-span, T.spring); hs.absarc(0, T.spring, span, Math.PI, 0, true); hs.lineTo(span, 0); hs.lineTo(HW, 0); hs.lineTo(HW, TOP); hs.lineTo(-HW, TOP); hs.closePath();
  const eg = new THREE.ExtrudeGeometry(hs, { depth: 1.2, bevelEnabled: false, curveSegments: 14 }); eg.translate(0, 0, -1.2);
  { const uv = eg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.4, -uv.getY(i) / 1.4); }
  const headwall = new THREE.Mesh(eg, M.headwall); headwall.castShadow = headwall.receiveShadow = true; headwall.name = 'FL_lm_portal_headwall';
  B.get('headwall').box(HW * 2 + 0.3, 0.6, 1.1, M4(0, -0.3, -0.5), { tile: 1.4 });   // its footing, down into the grade
  for (const s of [-1, 1]) B.get('headwall').box(0.55, TOP + 0.4, 0.28, M4(s * (HW - 0.3), (TOP - 0.4) / 2 + 0.2, 0.12), { tile: 1.4, off: [0.3 * s, 0] });
  B.get('headwall').box(HW * 2 + 0.4, 0.32, 1.5, M4(0, TOP + 0.14, -0.45), { tile: 1.4 });
  B.get('headwall').box(0.62, 0.72, 0.18, M4(0, crown + 0.2, 0.08), { tile: 1 });
  // the lining: the arch, on into the hill, floor rising with the ground, going dark (vertex colours) to a black end
  const lin = B.get('lining', true), segA = 14, prof = [];
  prof.push([-span, -0.5], [-span, T.spring]); for (let k = 1; k < segA; k++) { const a = Math.PI - (k / segA) * Math.PI; prof.push([Math.cos(a) * span, T.spring + Math.sin(a) * span]); } prof.push([span, T.spring], [span, -0.5]);
  const rings = 13;
  for (let r = 0; r <= rings; r++) { const z = -1.2 - (T.depth - 1.2) * r / rings, fy = floorAt(z), dk = Math.max(0.03, 1 - r / rings * 1.15);
    prof.forEach(([x, y], k) => { const nx = k === 0 || k === 1 ? 1 : k >= prof.length - 2 ? -1 : -x / span, ny = k <= 1 || k >= prof.length - 2 ? 0 : -(y - T.spring) / span; lin.v(new V3(x, fy + y, z), new V3(nx, ny, 0), (k / prof.length) * 6, -(z) / 1.5, [dk, dk, dk]); }); }
  for (let r = 0; r < rings; r++) for (let k = 0; k < prof.length - 1; k++) { const a = r * prof.length + k, b = a + prof.length; lin.I.push(a, b, a + 1, a + 1, b, b + 1); }   // (facing in)
  const end = new THREE.Shape(); end.moveTo(-span, -0.5); end.lineTo(span, -0.5); end.lineTo(span, T.spring); end.absarc(0, T.spring, span, 0, Math.PI, false); end.closePath();
  const cap = new THREE.Mesh(new THREE.ShapeGeometry(end, 12), M.dark); cap.position.set(0, floorAt(-T.depth), -T.depth); cap.name = 'FL_lm_tunnel_dark';
  // the bluff it's set in: rock that stands up out of the slope over the portal and lies back into the hill
  const rk = new MB(), cols = [], rows = [0, 0.35, 0.8, 1.5, 2.6, 4, 6, 8.5, 11, 14, 17.5, 21];
  for (let u = -21; u <= 21 + 1e-6; u += 1.5) cols.push(u);
  const top = (u) => (8.6 + 2.4 * (hash(Math.round(u * 2), 3) - 0.5) + 1.2 * Math.sin(u * 0.35) - 0.011 * u * u) * (1 - smooth(14, 21, Math.abs(u)));
  const f = (v) => (v <= 0 ? 0 : v < 0.35 ? 0.55 : v < 0.8 ? 0.93 : 1 - 0.5 * smooth(1.5, 21, v));
  const foot = (u) => g(u, 0.2);
  const Vtx = [];
  rows.forEach((v, i) => cols.forEach((u, j) => {
    let x = u + (i > 0 && i < 4 ? (hash(i, j) - 0.5) * 0.5 : 0), z = -v + (i > 0 && i < 4 ? (hash(j, i) - 0.5) * 0.35 : 0) + (i === 0 ? 0.25 : 0);
    if (i > 0) { x += (hash(i * 7, j * 3) - 0.5) * 0.9; z += (hash(j * 11, i * 5) - 0.5) * 0.9; }
    let y = i === 0 ? g(x, z) - 0.35 : Math.max(g(x, z) + 0.12, foot(u) + top(u) * f(v) + (i > 1 ? (hash(i * 3, j * 5) - 0.5) * 1.7 + (hash(i, j * 2) > 0.7 ? 0.9 : 0) : 0));
    if (Math.abs(u) < HW + 0.35 && v < 1.3) { z = -1.25; y = Math.max(y, TOP + 0.05); }   // behind the headwall: rock only above it
    if (Math.abs(u) < span + 2.2 && v >= 1.3 && v <= T.depth + 2) y = Math.max(y, floorAt(-v) + crown + 1.2 + 0.3 * hash(i, j));   // always cover the tunnel
    Vtx.push(new V3(x, y, z));
  }));
  rows.forEach((v, i) => cols.forEach((u, j) => { const p = Vtx[i * cols.length + j]; rk.v(p, new V3(0, 1, 0), (p.x + p.z * 0.3) / 2.6, -(p.y * 0.8 - p.z * 0.6) / 2.6); }));
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols.length - 1; j++) { const a = i * cols.length + j, b = a + cols.length; rk.I.push(a, a + 1, b, a + 1, b + 1, b); }
  const rockM = M.rock.clone(); rockM.color.setHex(0x8c8880); rockM.name = 'FL_lm_bluff_rock';   // the scene's boulder, weathered greyer (a cut face, not a pile)
  const bluff = rk.mesh(rockM, 'FL_lm_bluff'); bluff.geometry.computeVertexNormals();
  // a few loose rocks at its foot (lumpy icosahedra in the same rock)
  const rocks = new MB();
  // crags set into the face and along the top (never over the tunnel: a rock that big would poke down through the lining)
  const crag = []; for (let n = 0; n < 26; n++) { const u = -19 + hash(n, 41) * 38, v = 0.6 + hash(n, 43) * 9; if (Math.abs(u) < HW + 2.5) continue; const yb = foot(u) + top(u) * f(v); crag.push([u, -v, 0.9 + hash(n, 47) * 1.9, yb]); }
  for (const [x, z, s, yb] of [[-6.8, 1.4, 0.9], [-8.3, 0.6, 0.6], [6.4, 1.7, 1.1], [8.9, 0.9, 0.7], [-12, 1.1, 1.3], [13.5, 1.3, 0.8], [3.4, 0.9, 0.35], [-3.6, 1.2, 0.4], ...crag]) {
    const ico = new THREE.IcosahedronGeometry(s, 1), p = ico.attributes.position, i0 = rocks.count;
    for (let i = 0; i < p.count; i++) { const v = new V3().fromBufferAttribute(p, i), k = 1 + (hash(Math.round(v.x * 9 + x), Math.round(v.z * 9 + z)) - 0.5) * 0.5; v.multiplyScalar(k); v.y *= 0.7; rocks.v(new V3(x + v.x, (yb != null ? Math.max(g(x, z), yb - s * 0.3) : g(x, z) + s * 0.3) + v.y, z + v.z), v.clone().normalize(), (v.x + x) / 2, -(v.y) / 2); }
    for (let i = 0; i < p.count; i += 3) rocks.I.push(i0 + i, i0 + i + 1, i0 + i + 2);
  }
  const rockBits = rocks.mesh(rockM, 'FL_lm_portal_rocks'); rockBits.geometry.computeVertexNormals();
  return { B, headwall, bluff, rockBits, cap, span, crown, HW };
}
/** One gate leaf (steel bars in a tube frame), hinge at the origin, the leaf running +x (w) and up (h). */
function gateLeaf(B, w, h) {
  const st = B.get('steel');
  st.box(0.06, h, 0.06, M4(0.03, h / 2, 0), { tile: 0.6 }); st.box(0.06, h, 0.06, M4(w - 0.03, h / 2, 0), { tile: 0.6 });
  for (const y of [0.1, h * 0.5, h - 0.05]) st.box(w, 0.06, 0.06, M4(w / 2, y, 0), { tile: 0.6 });
  for (let x = 0.17; x < w - 0.08; x += 0.14) st.lathe([[0.012, 0.1], [0.012, h - 0.05]], M4(x, 0, 0), 5, { tile: 0.4 });
  const { m, L } = memberM(new V3(0.08, 0.15, 0.03), new V3(w - 0.08, h - 0.1, 0.03)); st.box(0.05, 0.02, L, m, { tile: 0.6 });
}

// ------------------------------------------------------------------ the whole thing
/**
 * createLandmarks(engine, H): each site builds itself the first time you come within a few hundred metres (or all at
 * once with buildAll()). H (optional): flags() → the game's flags (flags.tunnelOpen persists the gate), play(name, pos, vol),
 * sfx(set, pos, vol). The API is documented on the returned object.
 */
export function createLandmarks(engine, H = {}) {
  const { scene } = engine, W = engine.world, heightAt = W.heightAt || (() => 0), flags = () => (H.flags ? H.flags() : null) || {};
  const M = makeMats(W), root = new THREE.Group(); root.name = 'FL_landmarks'; scene.add(root);
  const colliders = [], anchors = {};
  const colBox = (parent, name, sx, sy, sz, m, enabled = true) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false })); o.name = name; o.visible = false; o.applyMatrix4(m);
    parent.add(o); parent.updateWorldMatrix(true, false); o.updateMatrixWorld(true); const c = { name, type: 'wall', mesh: o, enabled }; colliders.push(c); W.colliders = W.colliders || []; W.colliders.push(c); return c;
  };
  const rebuild = () => { if (engine.player && engine.player.rebuildColliders) engine.player.rebuildColliders(); };
  // the road beds are clear of standing trees (old roads: stumps and saplings, no big trunks), the bluff and apron too
  const trees = /fir|hemlock|snag|sapling|stump|log|rocks|fern|salal/;
  const Tn = LM.tunnel, pY = heightAt(Tn.portal[0], Tn.portal[1]);
  const inBluff = (x, z) => { const c = Math.cos(Tn.rotY), s = Math.sin(Tn.rotY), dx = x - Tn.portal[0], dz = z - Tn.portal[1], lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < 23 && lz < 3 && lz > -24; };
  const culled = cullWhere(W, trees, (x, z) => nearestOnLine(x, z, LM.oldRoad.points).d < LM.oldRoad.half + 1.4 || nearestOnLine(x, z, [Tn.from, ...Tn.road]).d < Tn.half + 1.2 || inBluff(x, z)
    || Math.hypot(x - LM.ruin.pos[0], z - LM.ruin.pos[1]) < 8.5).n;

  const sites = {};
  const fetch = (name) => { const e = engine.manifest && engine.manifest.models && engine.manifest.models[name]; return e ? loadGLB('assets/' + e.path).catch(() => null) : Promise.resolve(null); };
  // ---------------------------------------------------------------- the first lookout
  sites.ruin = { at: new V3(LM.ruin.pos[0], 0, LM.ruin.pos[1]), buildR: 320, viewR: 300, build() {
    const y0 = heightAt(LM.ruin.pos[0], LM.ruin.pos[1]), G = new THREE.Group(); G.name = 'FL_lm_ruin'; G.position.set(LM.ruin.pos[0], y0, LM.ruin.pos[1]); G.rotation.y = LM.ruin.rotY; root.add(G); G.updateMatrixWorld(true);
    const g = (lx, lz) => { const w = ruinToWorld([lx, 0, lz], 0); return heightAt(w[0], w[2]) - y0; };
    const { B, pier } = buildRuin(M, g, rng(1950));
    for (const m of B.meshes(M, 'FL_lm_ruin_')) { if (/sheet/.test(m.name)) m.geometry.computeVertexNormals(); G.add(m); }
    const pt = TX.plate(); if (pt) { const mat = M.bronze.clone(); mat.map = pt; const q = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), mat); q.position.set(pier.d.x + 0.313, pier.d.top - 0.17, pier.d.z); q.rotation.y = Math.PI / 2; q.name = 'FL_lm_ruin_plate'; G.add(q); }
    const at = decalMat(TX.ash(), { roughness: 1, alphaTest: 0, transparent: true, depthWrite: false }); if (at) { const ash = ribbon([[-7.5, 0.5], [7.5, 0.5]].map(([x, z]) => { const w = ruinToWorld([x, 0, z], 0); return [w[0], w[2]]; }), 7.5, heightAt, at, { vScale: 15, s0: 0, s1: 15, step: 1.5, cols: 9, lift: 0.04 }); ash.name = 'FL_lm_ruin_ash'; ash.renderOrder = 1; root.add(ash); this.ash = ash; }
    // the road bed out of the clearing (built with the ruin: it starts here)
    const om = stripMat(TX.oldRoad()); if (om) { const r = ribbon(LM.oldRoad.points, LM.oldRoad.half, heightAt, om, { vScale: 5 }); r.name = 'FL_lm_old_road'; root.add(r); this.road = r; }
    for (const [k, h] of [['a', 3.3], ['b', 1.2]]) colBox(G, 'COL_wall_ruin_leg_' + k, 0.32, h, 0.32, M4(pier[k].x, pier[k].top + h / 2, pier[k].z));
    for (const k of ['a', 'b', 'c', 'd']) colBox(G, 'COL_wall_ruin_pier_' + k, 0.64, 1.0, 0.64, M4(pier[k].x, pier[k].top - 0.3, pier[k].z));
    colBox(G, 'COL_wall_ruin_leg_c', 0.34, 4.2, 0.34, new THREE.Matrix4().compose(new V3(pier.c.x - 0.42 * 2.1 / 0.99, pier.c.top + 0.87 * 2.1 / 0.99, pier.c.z + 0.26 * 2.1 / 0.99), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(-0.42, 0.87, 0.26).normalize()), new V3(1, 1, 1)));
    { const x0 = 5.9, x1 = 3.0, zc = -0.9; colBox(G, 'COL_wall_ruin_stairs', 3.1, 1.2, 0.95, M4((x0 + x1) / 2, g((x0 + x1) / 2, zc) + 0.55, zc, 0, 0, -0.55)); }
    const w = ruinToWorld([pier.d.x + 0.4, pier.d.top - 0.17, pier.d.z], y0); anchors.ruinPlate = new V3(w[0], w[1], w[2]);
    this.group = G; } };
  // ---------------------------------------------------------------- the barricade on the old road
  sites.barricade = { at: new V3(LM.oldRoad.barricadeX, 0, barricadeAt()[1]), buildR: 280, viewR: 240, build() {
    const [bx, bz, dx, dz] = barricadeAt(), y = heightAt(bx, bz), G = new THREE.Group(); G.name = 'FL_lm_barricade'; G.position.set(bx, y, bz); G.rotation.y = Math.atan2(-dx, -dz); root.add(G); G.updateMatrixWorld(true);
    const B = new Bins(), g = (lx, lz) => { const p = new V3(lx, 0, lz).applyMatrix4(G.matrixWorld); return heightAt(p.x, p.z) - y; };
    for (const s of [-1, 1]) for (const k of [-1, 1]) { const { m, L } = memberM(new V3(s * 1.35, g(s * 1.35, k * 0.42), k * 0.42), new V3(s * 1.35, 1.5, 0)); B.get('timber').box(0.09, 0.05, L, m, { wood: WP, j: 3 + k }); }
    for (const s of [-1, 1]) B.get('timber').box(0.05, 0.05, 0.9, M4(s * 1.35, 0.3, 0), { wood: WP, j: 1 });
    const rails = new MB(); for (const ry of [0.55, 1.0, 1.45]) rails.box(2.95, 0.2, 0.025, M4(0, ry, 0.05, 0, 0, (ry === 1.0 ? 0.03 : 0)), { unit: true });
    const st = TX.stripes(), railMat = st ? new THREE.MeshStandardMaterial({ map: st, roughness: 0.8 }) : new THREE.MeshStandardMaterial({ color: 0xc96a2c, roughness: 0.8 }); G.add(rails.mesh(railMat, 'FL_lm_barricade_rails'));
    const ct = TX.closed(); if (ct) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.43), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7, metalness: 0.2 })); q.position.set(0.1, 1.82, 0.07); q.rotation.z = -0.04; q.castShadow = true; q.name = 'FL_lm_barricade_sign'; G.add(q); }
    B.get('steel').box(0.92, 0.45, 0.012, M4(0.1, 1.82, 0.058, 0, 0, -0.04), { tile: 0.6 });
    for (const s of [-0.25, 0.45]) B.get('steel').box(0.03, 0.5, 0.02, M4(s, 1.55, 0.06), { tile: 0.3 });
    for (const m of B.meshes(M, 'FL_lm_barricade_')) G.add(m);
    colBox(G, 'COL_wall_barricade', 3.1, 1.7, 0.6, M4(0, 0.85, 0));
    const w = new V3(0.1, 1.8, 0.4).applyMatrix4(G.matrixWorld); anchors.barricade = w;
    // the deadfall jam behind it: whole trunks across the road, one on another, a heap of limbs (it blocks: landmarkBlocks)
    fetch('veg_log_b').then((gl) => { if (!gl) return; const R = rng(369);
      for (const [lz, yaw, sc, up] of [[-2.9, 0.22, 1.7, 0], [-3.5, -0.3, 1.6, 0.62], [-4.3, 0.12, 1.8, 0.1], [-4.1, -0.9, 1.35, 1.25], [-5.1, 0.45, 1.7, 0.75], [-5.6, 1.25, 1.2, 1.55], [-6.2, -0.15, 1.8, 0.2], [-4.8, 0.05, 1.5, 1.9], [-3.3, 1.45, 1.1, 0.05]]) {
        const r = gl.scene.clone(true); r.position.set((R() - 0.5) * 1.4, g(0, lz) + up - 0.05, lz); r.rotation.set((R() - 0.5) * 0.14, yaw, (R() - 0.5) * 0.16); r.scale.set(sc, 0.95 * sc, 0.95 * sc);
        r.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); G.add(r); }
      colBox(G, 'COL_wall_deadfall', 8, 2.6, 5.5, M4(0, 1.3, -4.6)); rebuild(); });
    this.group = G; } };
  // ---------------------------------------------------------------- the road out, the portal, the gate
  const floorAt = (lz) => { const w = portalToWorld([0, 0, lz], 0); return heightAt(w[0], w[2]) - pY; };
  sites.tunnel = { at: new V3(Tn.portal[0], 0, Tn.portal[1]), buildR: 460, viewR: 420, build() {
    const G = new THREE.Group(); G.name = 'FL_lm_tunnel'; G.position.set(Tn.portal[0], pY, Tn.portal[1]); G.rotation.y = Tn.rotY; root.add(G); G.updateMatrixWorld(true);
    const g = (lx, lz) => { const w = portalToWorld([lx, 0, lz], 0); return heightAt(w[0], w[2]) - pY; };
    const P = buildPortal(M, g, floorAt);
    G.add(P.headwall, P.bluff, P.rockBits, P.cap); for (const m of P.B.meshes(M, 'FL_lm_portal_')) G.add(m);
    const nt = decalMat(TX.portal(), { roughness: 0.95 }); if (nt) { const q = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.86), nt); q.position.set(0, P.crown + 0.95, 0.012); G.add(q); }
    const sm = decalMat(TX.stain(), { roughness: 1, alphaTest: 0, transparent: true, depthWrite: false }); if (sm) { const q = new THREE.Mesh(new THREE.PlaneGeometry(P.HW * 2, 7.6), sm); q.position.set(0, 3.5, 0.008); q.renderOrder = 2; G.add(q); }
    const gm = stripMat(TX.gravel()); if (gm) { const r = ribbon([Tn.from, ...Tn.road], Tn.half, heightAt, gm, { vScale: 3.5, s0: 3.5 }); r.name = 'FL_lm_gravel_road'; root.add(r); this.road = r; }
    // the gate: two barred leaves, chained and padlocked in the middle, a sign wired on
    const leafH = 3.5, w = P.span - 0.02, gates = [];
    for (const s of [-1, 1]) { const leaf = new THREE.Group(); leaf.name = 'FL_lm_tunnel_gate' + (s < 0 ? 'L' : 'R'); leaf.position.set(s * P.span, floorAt(-0.45) + 0.02, -0.45); leaf.scale.x = -s; G.add(leaf);
      const lb = new Bins(); gateLeaf(lb, w, leafH); for (const m of lb.meshes(M, 'FL_lm_gate_')) leaf.add(m); gates.push({ leaf, s }); }
    const gs = TX.gateSign(); if (gs) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ map: gs, roughness: 0.75, metalness: 0.2 })); q.position.set(w * 0.52, 1.75, 0.045); q.name = 'FL_lm_gate_sign'; gates[0].leaf.add(q); }
    const chain = new THREE.Group(); chain.name = 'FL_lm_gate_chain'; G.add(chain);
    { const cb = new MB(), pts = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2; pts.push(new V3(Math.cos(a) * 0.1, floorAt(-0.45) + 1.15 + Math.sin(a) * 0.08 - 0.05 * Math.abs(Math.cos(a)), -0.45 + Math.sin(a) * 0.05)); } cb.tube(pts, 0.012, 5, 0.2); chain.add(cb.mesh(M.steel, 'FL_lm_chain'));
      const pl = new MB(); pl.box(0.07, 0.08, 0.03, M4(0, floorAt(-0.45) + 1.0, -0.4), { tile: 0.1 }); chain.add(pl.mesh(M.brass, 'FL_lm_gate_padlock')); }
    const dropped = new THREE.Group(); dropped.name = 'FL_lm_gate_chain_down'; dropped.visible = false; G.add(dropped);
    { const cb = new MB(), pts = []; for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 5, r = 0.08 + k * 0.004; pts.push(new V3(-0.6 + Math.cos(a) * r, floorAt(0.4) + 0.03 + k * 0.001, 0.4 + Math.sin(a) * r)); } cb.tube(pts, 0.012, 5, 0.2); dropped.add(cb.mesh(M.steel, 'FL_lm_chain_down')); }
    // colliders: the face either side of the opening (the bluff), its flanks, the gate while it's shut
    const side = (21 - P.span) / 2 + P.span;
    for (const s of [-1, 1]) { colBox(G, 'COL_wall_portal_face' + s, 21 - P.span, 9, 1.6, M4(s * side, 4.5, -0.8)); colBox(G, 'COL_wall_portal_flank' + s, 1.2, 8, 7, M4(s * 21, 4, -3.4)); }
    this.gateCol = colBox(G, 'COL_wall_tunnel_gate', P.span * 2, 4, 0.35, M4(0, floorAt(-0.45) + 2, -0.45));
    anchors.tunnelGate = new V3(...portalToWorld([P.span * 0.5, 1.6, 0.2], pY)); anchors.tunnelName = new V3(...portalToWorld([0, P.crown + 0.95, 0.5], pY));
    this.gates = gates; this.chain = chain; this.dropped = dropped; this.group = G; this.gateA = flags().tunnelOpen ? 1 : 0; this.apply(true); },
    apply(snap) { if (!this.gates) return; const open = !!flags().tunnelOpen; if (snap) this.gateA = open ? 1 : 0;
      const k = this.gateA * this.gateA * (3 - 2 * this.gateA); for (const { leaf, s } of this.gates) leaf.rotation.y = -s * 1.53 * k;   // in, flat to the lining
      this.chain.visible = !open; this.dropped.visible = open; this.gateCol.enabled = this.gateA < 0.1; } };

  let buildQueue = null;
  const API = {
    root, colliders, anchors, materials: M, culled, sites,
    /** true = something here can't be walked through (the deadfall jam). OR it into the player's extraBlocked. */
    blocks: landmarkBlocks,
    /** The way Walt's truck drives out: [[x, y, z]] from its parking spot up the road and in through the portal. */
    route: () => tunnelRoute(heightAt),
    /** The last morning: the chain comes off, the gate swings in (saved in flags.tunnelOpen). instant: no swing. */
    openTunnel(instant = false) { const f = flags(); if (f.tunnelOpen) return false; f.tunnelOpen = true; const T = sites.tunnel; if (T.built && instant) T.apply(true); else if (T.built) { H.play && H.play('gate_rattle', anchors.tunnelGate, 1); H.play && H.play('door_open', anchors.tunnelGate, 1.2); } return true; },
    closeTunnel() { const f = flags(); f.tunnelOpen = false; if (sites.tunnel.built) sites.tunnel.apply(true); },
    get tunnelOpen() { return !!flags().tunnelOpen; },
    /** Build everything now (tests, or a loading screen). */
    buildAll() { for (const s of Object.values(sites)) if (!s.built) { s.build(); s.built = true; } rebuild(); },
    /** After a restore: the gate straight to its flag. */
    snap() { if (sites.tunnel.built) sites.tunnel.apply(true); },
    /** ctx: { cam (Vector3) }. Builds a site the first time you're within its radius (one per frame), hides far ones. */
    update(dt, ctx = {}) {
      const cam = ctx.cam || (engine.camera && engine.camera.position) || new V3();
      for (const s of Object.values(sites)) {
        const d = Math.hypot(cam.x - s.at.x, cam.z - s.at.z);
        if (!s.built && d < s.buildR && !buildQueue) { buildQueue = s; }
        if (s.built) { const vis = d < s.viewR; if (s.group) s.group.visible = vis; if (s.road) s.road.visible = d < s.viewR + 120; if (s.ash) s.ash.visible = vis; }
      }
      if (buildQueue) { buildQueue.build(); buildQueue.built = true; buildQueue = null; rebuild(); }
      const T = sites.tunnel; if (T.built) { const tgt = flags().tunnelOpen ? 1 : 0; if (T.gateA !== tgt) { T.gateA += Math.sign(tgt - T.gateA) * Math.min(Math.abs(tgt - T.gateA), dt * 0.35); T.apply(false); } }
    },
    stats() { let tris = 0, meshes = 0; root.traverse((o) => { if (o.isMesh && !/^COL_/.test(o.name)) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } }); return { tris: Math.round(tris), meshes, culled, built: Object.keys(sites).filter((k) => sites[k].built), materialsFound: M.found.length }; },
    dispose() { scene.remove(root); for (const c of colliders) { const i = (W.colliders || []).indexOf(c); if (i >= 0) W.colliders.splice(i, 1); } rebuild(); },
  };
  return API;
}
