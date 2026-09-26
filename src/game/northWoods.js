// FALSE LIGHT — the North Woods, the pure half: Tillman's fire cache at the dead end of the old road, the phone line that
// leads there, the blowdown, his orange flagging, the young-fir thicket you can't get through, the sign on the road bed,
// what you've found (the pencil on your map) and the rules for the door and the one scare out there. No three.js here, so
// node can test it (tests/northWoods.test.mjs). The three.js half (the building, the clues, the thicket) is fireCache.js.
// Coordinates are three.js metres: +x east, -z north, +y up. Bearings are compass degrees (0 = north = -z, 90 = east).
//
// The story: in 1958 the district put a corrugated-steel fire cache at the end of Road 2410-110, the truck road up from
// Hatchet Creek. The tower's crank phone ran to it, one wire nailed tree to tree on glass insulators. A slide took the road
// in the seventies and the 1983 map revision dropped it. Tillman walked the wire up there when Walt came up short.
// Every tree, height and radius below was measured against the real assets (scatter.json, terrain_height.bin): the test
// checks them. The world is free-roam: nothing here gates walking except the thicket, which is a real wall.

const DEG = Math.PI / 180;

export const NORTH_WOODS = {
  // the crank-phone line: down the tower's NE leg (4.1 degree batter) to a bracket at 3 m, a short span to the NE fence
  // corner post, then north on insulators nailed 3.5 m up four real trunks. The fifth tree is the blowdown.
  wire: {
    legTop: 29.0, bracketY: 3.0,                  // along the leg from under the deck down to the bracket
    tie: [6, 1.25, -6],                           // tied off to the fence corner post (the post's foot is at y -0.07)
    ia: [6.3, 1.2, -6.3],                         // E on it (outside the fence corner)
    mount: 3.5,                                   // insulator height above the ground at the trunk
    // [x, z, kind, scale, trunk radius at the mount height] (scatter.json; radius from the LOD0 bark at that height)
    trees: [[9.02, -29.13, 'veg_fir_a', 0.73, 0.37], [8.74, -42.3, 'veg_hemlock_a', 0.71, 0.36], [13.88, -54.74, 'veg_fir_b', 0.56, 0.42], [13.91, -78.14, 'veg_fir_b', 0.57, 0.43]],
    coil: [16.2, -99.4],                          // where the pulled-down wire ends up: a loose coil past the log
  },
  // the 5th insulator tree, blown over toward 250 degrees; its standing copy is culled (see cull)
  blowdown: { root: [18.86, -96.52], bearing: 250, len: 11, r0: 0.43, r1: 0.27, lift: 0.34 },
  // Tillman's orange flagging: [x, z, kind, scale, trunk radius at 1.7 m], F1 at the log's top end, then round the
  // thicket's west edge to the road
  flagHeight: 1.7,
  flags: [[9.66, -94.91, 'veg_fir_a', 0.77, 0.45], [1.97, -100.78, 'veg_fir_c', 0.46, 0.47], [-4.81, -119.17, 'veg_hemlock_a', 0.64, 0.37], [-14.39, -136.12, 'veg_fir_c', 0.5, 0.52], [-13.02, -152.83, 'veg_hemlock_a', 0.7, 0.41]],
  // young fir, packed solid: you can't walk into it (thicketBlocks). It closes the straight line along the wire and hides
  // the cache from the tower (the tower -> cache sight line runs through it from z -100 to z -172).
  thicket: [[6, -100], [26, -98], [34, -108], [40, -140], [46, -168], [30, -175], [14, -166], [4, -146], [0, -122]],
  // Road 2410-110: from the washout to the cache pad (103 m), and the sign where you meet it
  road: { name: '2410-110', points: [[-58, -146], [-34, -150], [-10, -158], [8, -172], [22, -184], [32, -190]], half: 1.3, washout: [-66, -146] },
  sign: { pos: [-8, -155], rotY: -Math.PI / 2 },     // faces west (you come on it from the flagging)
  cache: { pos: [32, -190], rotY: -1.03, w: 4.3, d: 6.1, pad: 7.5 },   // door faces 239 degrees, down the road
  // the loose North Woods (for naming / wildlife keep-outs only: nothing stops you at its edge)
  area: [[-10, -6], [-18, -40], [-26, -90], [-30, -126], [-70, -134], [-74, -160], [-40, -168], [-14, -176], [4, -192], [20, -206], [36, -210], [50, -198], [50, -176], [38, -160], [32, -120], [30, -70], [22, -8]],
  // standing trees that can't be there: the blowdown's own copy, and the trunks on the road bed (<= 3 m from its line)
  cull: [['veg_fir_a', 18.86, -96.52], ['veg_fir_b', 4.35, -167.04], ['veg_fir_b', -55.94, -145.28], ['veg_fir_b', 16.72, -181.98], ['veg_fir_a', -31.34, -148.89], ['veg_fir_a', 22.12, -186.29]],
  // the trailhead station (prop_ranger_station, layout.json): the key lies on the desk beside the fax
  station: { pos: [32, -32.627, 382], rotY: -1.5708, key: [0.72, 0.95, -1.28] },   // key: station-local three coords
};
const NW = NORTH_WOODS;

// ------------------------------------------------------------------ geometry helpers
/** Even-odd point in polygon; poly = [[x, z], ...]. */
export function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) c = !c;
  }
  return c;
}
const bbox = (poly) => poly.reduce((b, [x, z]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), z0: Math.min(b.z0, z), z1: Math.max(b.z1, z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
const TB = bbox(NW.thicket), AB = bbox(NW.area);
export function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]); return a / 2; }
/** Distance from (x, z) to a polyline [[x, z], ...] → { d, s (arc length at the nearest point), i (segment) }. */
export function nearestOnLine(x, z, pts) {
  let best = { d: Infinity, s: 0, i: 0 }, s0 = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], L = Math.hypot(vx, vz) || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (L * L)));
    const d = Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
    if (d < best.d) best = { d, s: s0 + L * t, i };
    s0 += L;
  }
  return best;
}
export function lineLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
/** The point at arc length s along a polyline → [x, z, dirX, dirZ]. */
export function pointAt(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= L || i === pts.length - 2) { const t = Math.max(0, Math.min(1, s / (L || 1e-9))); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)]; }
    s -= L;
  }
  return [pts[0][0], pts[0][1], 1, 0];
}
export const ROAD_LEN = lineLength(NW.road.points);
export const SIGN_S = nearestOnLine(NW.sign.pos[0], NW.sign.pos[1], NW.road.points).s;
/** The fallen trunk: root, top, unit direction (xz) and length. */
export function blowdownLine() {
  const B = NW.blowdown, dx = Math.sin(B.bearing * DEG), dz = -Math.cos(B.bearing * DEG);
  return { root: B.root, top: [B.root[0] + dx * B.len, B.root[1] + dz * B.len], dir: [dx, dz], len: B.len, mid: [B.root[0] + dx * B.len / 2, B.root[1] + dz * B.len / 2] };
}

// ------------------------------------------------------------------ the thicket (the one real wall out here)
/** true = the young fir is too thick to walk into here. Wire it into the player's movement (player.js). */
export function thicketBlocks(x, z) { return x > TB.x0 && x < TB.x1 && z > TB.z0 && z < TB.z1 && inPoly(x, z, NW.thicket); }
/** Why a spot is blocked, for the one-time toast ('thicket') or null. */
export function whyBlocked(x, z) { return thicketBlocks(x, z) ? 'thicket' : null; }
export function inNorthWoods(x, z) { return x > AB.x0 && x < AB.x1 && z > AB.z0 && z < AB.z1 && inPoly(x, z, NW.area); }

// ------------------------------------------------------------------ the cache's own frame (three local: door on +z)
const CR = Math.cos(NW.cache.rotY), SR = Math.sin(NW.cache.rotY);
/** Cache-local [x, y, z] → world [x, y, z]; y is added to baseY (the ground at the cache centre, heightAt(32, -190)). */
export function cacheToWorld(l, baseY = 0) { return [NW.cache.pos[0] + l[0] * CR + l[2] * SR, baseY + l[1], NW.cache.pos[1] - l[0] * SR + l[2] * CR]; }
/** World (x, z) → cache-local [x, z]. */
export function worldToCache(x, z) { const dx = x - NW.cache.pos[0], dz = z - NW.cache.pos[1]; return [dx * CR - dz * SR, dx * SR + dz * CR]; }
/** Inside the building's four walls (the interior, 4.1 x 5.9 m). */
export function inCache(x, z) { const [lx, lz] = worldToCache(x, z); return Math.abs(lx) < 2.08 && Math.abs(lz) < 3.0; }
/** 'fire_cache' inside the building, else null (a player zone name: survival / wildlife / the scare use it). */
export function zoneAt(x, z) { return inCache(x, z) ? 'fire_cache' : null; }

export const CACHE_FLOOR = 0.205;            // deck top (cache-local y)
export const CACHE_SHELVES = [0.75, 1.35, 1.95];   // shelf board tops, both long walls (x = +-1.55..2.05, z = -2.7..1.5)
/** Cache-local anchors (interactions, the boot, spawn points). */
export const CACHE_LOCAL = {
  door: [0.62, 1.1, 3.36],       // outside, at the hasp (unlock / break / open / shut)
  doorIn: [0, 1.25, 2.5],        // inside: open / shut
  sheet: [-1.96, 1.45, 1.86],    // the sign-out clipboard, on the west wall by the door
  toolbox: [1.7, 0.66, 4.02],    // the red FIRE TOOLS box, outside right of the door
  boot: [-0.72, CACHE_FLOOR, 2.2],
  inside: [0, CACHE_FLOOR, 0.4], front: [0, 0, 4.8], hinge: [-0.65, 0.2, 3.07],
};
/** What's in it: [kind, cache-local surface point, local rotY, extra]. Everything sits exactly on the board / floor the
 *  fireCache.js geometry puts there (spawn with these positions; no settle needed). 12.5 L of fuel (someone has been at
 *  the third can), six tins, a film pack and Tillman's refill in the top-shelf corner, two sealed jugs of district water
 *  and a spare emergency tent. */
export const CACHE_STOCK = [
  ['fuel', [-1.18, CACHE_FLOOR, -2.42], 0.25, { fill: 1 }],
  ['fuel', [-0.7, CACHE_FLOOR, -2.48], -0.18, { fill: 1 }],
  ['fuel', [-1.2, CACHE_FLOOR, -1.88], 1.45, { fill: 0.5 }],
  ['food', [1.8, CACHE_SHELVES[1], -1.2], 0.2, { n: 6 }],
  ['film', [1.8, CACHE_SHELVES[2], -0.12], 0.35, {}],
  ['pills', [1.84, CACHE_SHELVES[2], -0.44], 1.1, { n: 4 }],
  ['water', [1.8, CACHE_SHELVES[0], -2.25], 0.3, { fill: 1 }],
  ['water', [1.8, CACHE_SHELVES[0], -1.8], -0.4, { fill: 1 }],
  ['tent', [-1.8, CACHE_SHELVES[0], -1.15], 1.57, { uses: 3 }],
];
/** The stock in world coordinates: [{ kind, pos, rotY, extra }] (baseY: the ground at the cache centre). */
export function cacheStock(baseY) {
  return CACHE_STOCK.map(([kind, l, r, extra]) => ({ kind, pos: cacheToWorld(l, baseY), rotY: NW.cache.rotY + r, extra: { ...extra } }));
}
/** The padlock key's spot on the station desk (world), from the station's placement (layout.json propPlacements). */
export function stationKeySpot(pl = NW.station) {
  const p = pl.position || pl.pos, r = pl.rotY || 0, k = NW.station.key;
  return [p[0] + k[0] * Math.cos(r) + k[2] * Math.sin(r), p[1] + k[1], p[2] - k[0] * Math.sin(r) + k[2] * Math.cos(r)];
}

// ------------------------------------------------------------------ what you've found
export const FIND = { wire: 4.5, ins: 6, blow: 9, flag: 7, sign: 7, wash: 11, cache: 30, road: 3.2 };
/** Call a few times a second with the player's position ([x, y, z]); it marks flags and returns what's new:
 *  'wire', 'ins1'..'ins4', 'blowdown', 'flag1'..'flag5', 'sign', 'road' (first time on the road bed), 'roadMore' (you've
 *  walked 8+ m more of it), 'washout', 'cache' (seen, within 30 m), 'inside' (each time you go in). flags keys: fcWire,
 *  fcIns (bitmask), fcBlow, fcFlag (bitmask), fcSign, fcRoadA / fcRoadB (arc range of the road walked), fcWash, fcCache,
 *  cacheVisits, and _fcIn (you're inside now). All primitives: flags survive the game's shallow snapshot copy. */
export function discover(p, f) {
  const out = [], x = p[0], z = p[2];
  if (p[1] > 8) return out;   // up the tower: nothing out here is 'found' from the catwalk
  if (z > 10 || z < -215 || x < -80 || x > 60) { f._fcIn = false; return out; }
  const W = NW.wire;
  if (!f.fcWire && Math.hypot(x - W.tie[0], z - W.tie[2]) < FIND.wire) { f.fcWire = true; out.push('wire'); }
  W.trees.forEach((t, i) => { const b = 1 << i; if (!((f.fcIns || 0) & b) && Math.hypot(x - t[0], z - t[1]) < FIND.ins) { f.fcIns = (f.fcIns || 0) | b; out.push('ins' + (i + 1)); } });
  if (z < -60) {
    const B = blowdownLine();
    if (!f.fcBlow && nearestOnLine(x, z, [B.root, B.top]).d < FIND.blow) { f.fcBlow = true; out.push('blowdown'); }
    NW.flags.forEach((t, i) => { const b = 1 << i; if (!((f.fcFlag || 0) & b) && Math.hypot(x - t[0], z - t[1]) < FIND.flag) { f.fcFlag = (f.fcFlag || 0) | b; out.push('flag' + (i + 1)); } });
  }
  if (z < -120) {
    if (!f.fcSign && Math.hypot(x - NW.sign.pos[0], z - NW.sign.pos[1]) < FIND.sign) { f.fcSign = true; out.push('sign'); }
    const r = nearestOnLine(x, z, NW.road.points);
    if (r.d < FIND.road) {
      if (f.fcRoadA == null) { f.fcRoadA = f.fcRoadB = r.s; f._fcRoadPen = r.s; out.push('road'); }
      else { f.fcRoadA = Math.min(f.fcRoadA, r.s); f.fcRoadB = Math.max(f.fcRoadB, r.s); if (Math.abs(r.s - (f._fcRoadPen ?? r.s)) > 8) { f._fcRoadPen = r.s; out.push('roadMore'); } }
    }
    if (!f.fcWash && Math.hypot(x - NW.road.washout[0], z - NW.road.washout[1]) < FIND.wash) { f.fcWash = true; out.push('washout'); }
    if (!f.fcCache && Math.hypot(x - NW.cache.pos[0], z - NW.cache.pos[1]) < FIND.cache) { f.fcCache = true; out.push('cache'); }
  }
  const inside = inCache(x, z);
  if (inside && !f._fcIn) { f.cacheVisits = (f.cacheVisits || 0) + 1; out.push('inside'); }
  f._fcIn = inside;
  return out;
}
/** Which story line (content/story.js LINES key) a find says, once. Most finds are silent: the pencil does the talking. */
export const FIND_LINE = { flag1: 'flagFirst', cache: 'cacheSeen' };

/** Your own pencil on the trail map (and the sheet pinned in the cab): what you've found, drawn in your hand. Never the
 *  printed map: the 1983 revision dropped the road, the phone line and the cache.
 *  → [{ kind: 'dots' | 'x' | 'ticks' | 'road' | 'squiggle' | 'box', pts?: [[x, z]], pos?: [x, z], rotY?, label? }] */
export function pencilMarks(f = {}) {
  const out = [], W = NW.wire;
  const ins = f.fcIns || 0;
  if (f.fcWire || ins) {
    let last = -1; for (let i = 0; i < W.trees.length; i++) if (ins & (1 << i)) last = i;   // the line as far as you've followed it
    const pts = [[W.tie[0], W.tie[2]], ...W.trees.slice(0, last + 1).map((t) => [t[0], t[1]])];
    out.push({ kind: 'dots', pts, label: last >= 1 ? 'phone line' : null });
  }
  if (f.fcBlow) out.push({ kind: 'x', pos: blowdownLine().mid, label: 'wire down' });
  const fl = f.fcFlag || 0;
  if (fl) out.push({ kind: 'ticks', pts: NW.flags.filter((_, i) => fl & (1 << i)).map((t) => [t[0], t[1]]), label: 'T.\'s tape' });
  if (f.fcSign || f.fcRoadA != null) {
    const a = Math.min(f.fcRoadA ?? SIGN_S, SIGN_S - 6), b = Math.max(f.fcRoadB ?? SIGN_S, SIGN_S + 6), pts = [];
    for (let s = Math.max(0, a); s < Math.min(ROAD_LEN, b); s += 4) pts.push(pointAt(NW.road.points, s).slice(0, 2));
    pts.push(pointAt(NW.road.points, Math.min(ROAD_LEN, b)).slice(0, 2));
    out.push({ kind: 'road', pts, label: 'old rd 2410-110' });
  }
  if (f.fcWash) out.push({ kind: 'squiggle', pos: NW.road.washout, label: 'washed out' });
  if (f.fcCache) out.push({ kind: 'box', pos: NW.cache.pos, rotY: NW.cache.rotY, label: 'CACHE' });
  return out;
}
/** Every point the pencil marks touch (for the map's extent: the sheet grows north to take them in). */
export function pencilPoints(marks) { const o = []; for (const m of marks || []) { if (m.pts) o.push(...m.pts); if (m.pos) o.push(m.pos); } return o; }

// a hand, not a plotter: the same small wobble every time the map opens (seeded by the point)
const wob = (x, z, k) => { const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return (h - Math.floor(h)) * 2 - 1; };
export const PENCIL = { ink: 'rgba(64,62,66,0.78)', font: '"Bradley Hand","Segoe Print","Chalkboard SE","Comic Sans MS",cursive', jitter: 1.5 };
/** Draw the pencil marks on a map canvas. g: 2D context; view: mapdraw's mapView() ({ px(x), py(z), s }); k: the UI
 *  scale. Run it after the place symbols and before the heading arrow. */
export function drawPencil(g, view, k, marks) {
  if (!marks || !marks.length) return;
  const J = (x, z, i = 0) => [view.px(x + wob(x, z, i) * PENCIL.jitter), view.py(z + wob(z, x, i + 3) * PENCIL.jitter)];
  g.save(); g.strokeStyle = PENCIL.ink; g.fillStyle = PENCIL.ink; g.lineWidth = 1.1 * k; g.lineCap = 'round'; g.lineJoin = 'round';
  const label = (text, x, y, dx = 6, dy = -6, ang = -0.06) => {
    if (!text) return; g.save(); g.translate(x + dx * k, y + dy * k); g.rotate(ang); g.font = `italic ${Math.round(12 * k)}px ${PENCIL.font}`;
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, 0, 0); g.restore();
  };
  const poly = (pts, i = 0) => { g.beginPath(); pts.forEach(([x, z], n) => { const [a, b] = J(x, z, i + n); if (n) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); };
  for (const m of marks) {
    if (m.kind === 'dots') {
      g.save(); if (g.setLineDash) g.setLineDash([1.2 * k, 3.2 * k]); poly(m.pts, 1); g.restore();
      for (const [x, z] of m.pts.slice(1)) { const [a, b] = J(x, z, 9); g.beginPath(); g.arc(a, b, 1.6 * k, 0, Math.PI * 2); g.stroke(); }
      const e = m.pts[m.pts.length - 1]; const [a, b] = J(e[0], e[1], 9); if (m.label) label(m.label, a, b, 5, 2, -1.35);
    } else if (m.kind === 'x') {
      const [a, b] = J(m.pos[0], m.pos[1], 2), r = 4.2 * k;
      g.beginPath(); g.moveTo(a - r, b - r); g.lineTo(a + r * 1.1, b + r * 0.9); g.moveTo(a + r, b - r * 1.1); g.lineTo(a - r * 0.9, b + r); g.stroke(); label(m.label, a, b, 7, 1);
    } else if (m.kind === 'ticks') {
      m.pts.forEach(([x, z], n) => { const [a, b] = J(x, z, 4 + n), r = 3.2 * k; g.beginPath(); g.moveTo(a, b - r); g.lineTo(a + r * 0.9, b + r * 0.6); g.lineTo(a - r * 0.9, b + r * 0.6); g.closePath(); g.stroke(); });
      const [a, b] = J(m.pts[0][0], m.pts[0][1], 4); label(m.label, a, b, -64, 12, -0.12);
    } else if (m.kind === 'road') {
      const P = m.pts.map(([x, z], n) => J(x, z, 20 + n));
      for (const side of [-1, 1]) {   // a double line, like the printed roads (in pencil)
        g.beginPath();
        P.forEach(([a, b], n) => { const q = P[Math.min(P.length - 1, n + 1)], p0 = P[Math.max(0, n - 1)]; let tx = q[0] - p0[0], ty = q[1] - p0[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; const ox = -ty * side * 1.7 * k, oy = tx * side * 1.7 * k; if (n) g.lineTo(a + ox, b + oy); else g.moveTo(a + ox, b + oy); });
        g.stroke();
      }
      const mid = P[Math.floor(P.length / 2)]; label(m.label, mid[0], mid[1], -40, 14, -0.55);
    } else if (m.kind === 'squiggle') {
      const [a, b] = J(m.pos[0], m.pos[1], 7), r = 6 * k;
      g.beginPath(); for (let i = 0; i <= 10; i++) { const t = i / 10, x = a - r + 2 * r * t, y = b + Math.sin(t * Math.PI * 4) * 2.2 * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
      label(m.label, a, b, -r / k - 58, 12, -0.04);
    } else if (m.kind === 'box') {
      const [a, b] = J(m.pos[0], m.pos[1], 11), hw = Math.max(3.2 * k, NW.cache.w / 2 * view.s), hd = Math.max(4.5 * k, NW.cache.d / 2 * view.s);
      g.save(); g.translate(a, b); g.rotate(-(m.rotY || 0)); g.strokeRect(-hw, -hd, hw * 2, hd * 2);
      g.beginPath(); g.moveTo(-hw * 0.4, hd); g.lineTo(-hw * 0.4, hd + 3 * k); g.stroke(); g.restore();   // the door tick
      label(m.label, a, b, 9, -4, -0.05);
    }
  }
  g.restore();
}

// ------------------------------------------------------------------ the door, the hasp, the tools box
/** 'locked' | 'unlocked' (the key) | 'broken' (the Pulaski). flags: cacheLock, cacheDoorOpen, haspHits, toolboxOpen. */
export const cacheLock = (f) => f.cacheLock || 'locked';
export const HASP_BLOWS = 3;
/** What E at the door does now → { label, act } (act: 'locked' | 'unlock' | 'strike' | 'open' | 'shut'). */
export function doorPrompt(f, { hasKey = false, inside = false } = {}) {
  const L = cacheLock(f);
  if (L === 'locked' && !inside) {
    if (hasKey) return { label: 'E — Unlock the padlock', act: 'unlock' };
    if (f.toolboxOpen) { const n = HASP_BLOWS - (f.haspHits || 0); return { label: `E — Break the hasp with the Pulaski (${n})`, act: 'strike' }; }
    return { label: 'The door is padlocked', act: 'locked' };
  }
  return f.cacheDoorOpen ? { label: 'E — Shut the door', act: 'shut' } : { label: 'E — Open the door', act: 'open' };
}
/** Do it: mutates flags, returns events ('locked' | 'unlock' | 'strike' | 'broken' | 'open' | 'first' | 'shut'). 'first'
 *  = the door opened for the first time ever (spawn the stock then: flags.cacheStocked). */
export function doorAct(f, act) {
  const ev = [];
  if (act === 'locked') ev.push('locked');
  else if (act === 'unlock' && cacheLock(f) === 'locked') { f.cacheLock = 'unlocked'; ev.push('unlock'); }
  else if (act === 'strike' && cacheLock(f) === 'locked' && f.toolboxOpen) {
    f.haspHits = (f.haspHits || 0) + 1; ev.push('strike');
    if (f.haspHits >= HASP_BLOWS) { f.cacheLock = 'broken'; ev.push('broken'); }
  } else if (act === 'open' && cacheLock(f) !== 'locked') {
    f.cacheDoorOpen = true; ev.push('open');
    if (!f.cacheOpened) { f.cacheOpened = true; ev.push('first'); }
  } else if (act === 'shut') { f.cacheDoorOpen = false; ev.push('shut'); }
  return ev;
}
export function toolboxPrompt(f) { return f.toolboxOpen ? { label: 'The fire tools box (a Pulaski, a shovel, a file)', act: 'none' } : { label: 'E — Break the seal on the fire tools box', act: 'open' }; }

// ------------------------------------------------------------------ the one scare out here
/** Whether the cache scare may start now (once ever: flags.cacheScare). ctx: { inside, openFor (s the door has stood open
 *  with you inside), night, visits, broken (you broke the hasp), chase (the Weeper is coming), busy (a modal / the radio),
 *  bear (it's close) }. */
export function scareReady(f, c) {
  return !f.cacheScare && !!c.inside && c.openFor >= 6 && (!!c.night || (c.visits || 0) >= 2 || !!c.broken) && !c.chase && !c.busy && !c.bear;
}
/** The beat, seconds from the start. 'hush': the score drops, the forest ducks. 'slam': the door swings shut by itself.
 *  'step': a footstep (i of n) on a ring round the building, clockwise, ending at the door. 'growl': a tamed dog growls at
 *  the door. 'rattle': the hasp rattles. Then silence until you open the door: the boot is gone. */
export const SCARE_BEATS = [
  { t: 0, do: 'hush' }, { t: 2.5, do: 'slam' },
  ...Array.from({ length: 9 }, (_, i) => ({ t: 5 + i * 0.95, do: 'step', i, n: 9 })),
  { t: 9.5, do: 'growl' }, { t: 16, do: 'rattle' }, { t: 17.2, do: 'end' },
];
/** Cache-local position of footstep i of n: a 4.6 m ring from behind the building round the east side to the door. */
export function scareStep(i, n = 9) {
  const a = Math.PI - (Math.PI - 0.32) * (i / Math.max(1, n - 1));
  return [4.6 * Math.sin(a), 0, 4.6 * Math.cos(a)];
}

// ------------------------------------------------------------------ planting (its own seed: the forest's stays the same)
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** The young fir: a dense 3 m band just inside the thicket's edge (the wall you see) plus a looser fill (the screen from
 *  the tower), and knee-to-head-high saplings coming up in the old road's ruts. Deterministic (seed 2410).
 *  avoid(x, z) → true to skip a spot (existing trunks). → [[x, z, rotY, scale, tag]] (veg_sapling scale: 1 = 5 m tall). */
export function thicketPlants({ avoid = null, seed = 2410 } = {}) {
  const R = mulberry(seed), out = [], P = NW.thicket, cell = 1.25, grid = new Map();
  const keyOf = (x, z) => Math.floor(x / cell) * 7919 + Math.floor(z / cell);
  const clear = (x, z, r) => { const cx = Math.floor(x / cell), cz = Math.floor(z / cell), n = Math.ceil(r / cell);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const q of grid.get((cx + i) * 7919 + cz + j) || []) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < r * r) return false; return true; };
  const put = (x, z, s, tag) => { out.push([x, z, R() * Math.PI * 2, s, tag]); const k = keyOf(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]); };
  const keepClear = (x, z) => {   // the clues stay readable: nothing right on a flag or insulator tree, the log or the wire's end
    for (const t of NW.flags) if (Math.hypot(x - t[0], z - t[1]) < 2.6) return false;
    for (const t of NW.wire.trees) if (Math.hypot(x - t[0], z - t[1]) < 2.2) return false;
    const B = blowdownLine(); if (nearestOnLine(x, z, [B.root, B.top]).d < 1.8) return false;
    return !(avoid && avoid(x, z));
  };
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    const inw = inPoly((a[0] + b[0]) / 2 - tz * 0.5, (a[1] + b[1]) / 2 + tx * 0.5, P) ? 1 : -1, nx = -tz * inw, nz = tx * inw;   // the inward normal
    for (let q = 0, n = Math.round(L * 2.2); q < n; q++) {
      const u = R() * L, d = 0.35 + Math.pow(R(), 1.3) * 2.9, x = a[0] + tx * u + nx * d, z = a[1] + tz * u + nz * d;
      if (!inPoly(x, z, P) || !clear(x, z, 1.15) || !keepClear(x, z)) continue;
      put(x, z, 0.55 + R() * 0.65, 'band');
    }
  }
  for (let x = TB.x0 + 1; x < TB.x1; x += 3.3) for (let z = TB.z0 + 1; z < TB.z1; z += 3.3) {
    const jx = x + (R() - 0.5) * 2.4, jz = z + (R() - 0.5) * 2.4;
    if (!inPoly(jx, jz, P) || R() < 0.12 || !clear(jx, jz, 1.9) || !keepClear(jx, jz)) continue;
    put(jx, jz, 0.8 + R() * 0.75, 'fill');
  }
  // the ruts: one every ~4 m, never on the sign, the washout lip or the cache pad
  const rd = NW.road.points;
  for (let s = 3; s < ROAD_LEN - 9; s += 3 + R() * 2.2) {
    const [x0, z0, dx, dz] = pointAt(rd, s), side = (R() - 0.5) * 2 * NW.road.half, x = x0 - dz * side, z = z0 + dx * side;
    if (Math.hypot(x - NW.sign.pos[0], z - NW.sign.pos[1]) < 4 || Math.hypot(x - NW.road.washout[0], z - NW.road.washout[1]) < 6) continue;
    if (Math.hypot(x - NW.cache.pos[0], z - NW.cache.pos[1]) < NW.cache.pad + 2) continue;
    if (avoid && avoid(x, z)) continue;
    put(x, z, 0.24 + R() * 0.3, 'rut');
  }
  return out;
}
