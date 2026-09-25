// FALSE LIGHT — the distant Cascades, pure shape code (no three.js: runs in node for tests).
// A height field for the whole horizon — five receding ridge layers (ridged multifractal), a valley floor, low foothills,
// three volcanoes (Rainier NNE, St. Helens SSW with its 1980 horseshoe crater, Adams ESE) and notches that keep every
// fire site in layout.fireSites visible from the cab — plus a builder that samples it on two polar grids around the tower.
//
// Coordinates are three.js metres (+x east, -z north, +y up, tower base y = 0). Bearing = atan2(x, -z): 0 = north, 90 = east
// (the same formula bridge.js uses for the binocular readout).
//
// Mesh layout: a NEAR grid (512 columns) from the edge of the terrain mesh out to rIn = 2.6 km, and a FAR grid (2048
// columns) from rIn to rOut = 11.3 km (inside the camera far plane, 12 km). Far-grid ring radii are chosen per column
// from a sampling density that peaks on each layer's crest and on each volcano's silhouette, so ridgelines stay crisp
// with only 34 rings. The index buffer runs outermost band -> innermost band: with depthFunc LessEqual that painter's
// order makes self-occlusion exact even where the 24-bit depth buffer only resolves ~50-150 m at these distances.

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const MOUNTAINS = {
  seed: 1983,
  eye: [0, 31.0, 0],             // the lowest cab eye (crouched); fire notches are cut against this sightline
  rIn: 2600, rOut: 11300,
  near: { cols: 512, rings: 12, blend: 900, sink: 2.0 },
  far: { cols: 2048, rings: 34 },
  valley: { y: -58, amp: 30, scale: 2300 },                 // valley-floor datum between the ranges
  foot: { amp: 58, scale: 720, r0: 450, r1: 1300, r2: 3300 }, // forested foothills below the cab
  // receding ridges: crest radius r (m), half-width w (m), crest height scale h (m above the tower base), crest wander (m)
  layers: [
    { r: 3400, w: 650, h: 160, wander: 210 },
    { r: 5200, w: 750, h: 320, wander: 270 },
    { r: 7000, w: 800, h: 610, wander: 290 },
    { r: 8800, w: 850, h: 755, wander: 290 },
    { r: 10500, w: 800, h: 1000, wander: 250 },
  ],
  ridge: { scale: 1900, octaves: 6, warp: 0.38, base: 0.36, gain: 1.05 },
  boosts: [{ name: 'Goat Rocks', bearing: 88, width: 14, gain: 0.42, fromLayer: 3 }],
  volcanoes: [
    // h = summit y (m above the tower base); rb = base radius; a/s0 = flank concavity / summit rounding
    { name: 'Rainier', bearing: 32, dist: 10200, h: 2880, rb: 7000, a: 2.1, s0: 0.12, snow: 300, ribs: 6.5, gully: 0.05 },
    { name: 'St. Helens', bearing: 200, dist: 8800, h: 1880, rb: 5200, a: 1.6, s0: 0.10, snow: -230, ribs: 7.5, gully: 0.035,
      crater: { north: 280, r: 850, floor: 1070, dome: 175, domeR: 270, breachW: 560, breachSlope: 0.17 }, ash: true },
    { name: 'Adams', bearing: 128, dist: 10500, h: 1850, rb: 5600, a: 1.7, s0: 0.22, snow: 260, ribs: 5.5, gully: 0.04 },
  ],
  // fire sites: keep the glow (220 m) / smoke (420 m) sprite visible from the cab
  fire: { half: 230, extraDeg: 0.35, fadeDeg: 3.0, baseDrop: 45, marginDeg: 0.3, shelfW: 380 },
  snowLine: 1350, treeLine: 1150,
};

// ---------------------------------------------------------------- noise (seeded improved Perlin, fbm, ridged multifractal)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const GX = new Float64Array([1, -1, 1, -1, 1.41, -1.41, 0, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 1.41, -1.41]);
export function makePerlin(seed = 1) {
  const r = mulberry32(seed), perm = new Uint8Array(256), p = new Uint16Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  return function perlin2(x, y) {   // ~[-1, 1]
    let xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi; xi &= 255; yi &= 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = p[xi] + yi, b = p[xi + 1] + yi;
    const g00 = p[a] & 7, g01 = p[a + 1] & 7, g10 = p[b] & 7, g11 = p[b + 1] & 7;
    const n00 = GX[g00] * xf + GY[g00] * yf, n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
    const n01 = GX[g01] * xf + GY[g01] * (yf - 1), n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
    const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export const bearingOf = (x, z) => ((Math.atan2(x, -z) / DEG) + 360) % 360;

// ---------------------------------------------------------------- the height field
/**
 * createField(cfg, fires) -> { column(theta, ctx), height(ctx, r, info), density(ctx, r) }
 * Work is split per COLUMN (a bearing): column() caches everything that depends only on the bearing (crest radii,
 * regional boosts, fire-notch weights, volcano offsets); height() then walks outward along that bearing.
 * info (Float64Array(4)) receives [snowBias m, rock 0..1, ash 0..1, ridge value].
 * fires: [{ x, y, z }] in three coords (layout.fireSites[].position).
 */
export function createField(cfg = MOUNTAINS, fires = []) {
  const perlin = makePerlin(cfg.seed);
  const P2 = makePerlin(cfg.seed + 71);
  const Ls = cfg.layers, NL = Ls.length;
  const RG = cfg.ridge;
  const eyeY = cfg.eye[1];
  const Vs = cfg.volcanoes.map((v, i) => {
    const b = v.bearing * DEG;
    const norm = Math.sqrt(1 + v.s0 * v.s0) - v.s0;
    return { ...v, b, x: Math.sin(b) * v.dist, z: -Math.cos(b) * v.dist, norm, ea: Math.exp(-v.a), seedOff: 17.3 * (i + 1) };
  });
  const FC = cfg.fire;
  const Fs = fires.map((f) => {
    const D = Math.hypot(f.x, f.z), b = Math.atan2(f.x, -f.z);
    const core = Math.atan(FC.half / D) + FC.extraDeg * DEG;
    return { b, D, y: f.y, core, outer: core + FC.fadeDeg * DEG, tanE: (f.y - FC.baseDrop - eyeY) / D, marginTan: Math.tan(FC.marginDeg * DEG) };
  });

  function fbm(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * perlin(x * f + i * 19.1, y * f - i * 7.7); f *= 2.02; a *= 0.5; } return s; }
  // Musgrave ridged multifractal, normalised to ~[0, 1]; sharp crest lines where the base noise crosses zero
  function rmf(x, y, oct) {
    let sum = 0, norm = 0, f = 1, amp = 1, w = 1;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(P2(x * f + i * 31.7, y * f - i * 17.3));
      n *= n; n *= w;
      w = clamp(n * 2.0, 0, 1);
      sum += n * amp; norm += amp;
      f *= 2.03; amp *= 0.52;
    }
    return sum / norm;
  }

  function column(theta, ctx = {}) {
    const sx = Math.sin(theta), cz = -Math.cos(theta);
    ctx.theta = theta; ctx.sx = sx; ctx.cz = cz;
    ctx.R = ctx.R || new Float64Array(NL); ctx.W = ctx.W || new Float64Array(NL); ctx.H = ctx.H || new Float64Array(NL);
    for (let k = 0; k < NL; k++) {
      const L = Ls[k];
      // crest wander: noise sampled on a circle in noise space (seamless all the way round)
      const n = 0.8 * perlin(sx * 2.3 + 13.1 * k, cz * 2.3 - 5.7 * k) + 0.35 * perlin(sx * 5.1 + 3.3 * k, cz * 5.1 + 8.2 * k);
      ctx.R[k] = L.r + L.wander * n;
      ctx.W[k] = L.w * (1 + 0.12 * perlin(sx * 3.1 - 2.2 * k, cz * 3.1 + 4.4 * k));
      let boost = 1;
      for (const B of cfg.boosts) if (k >= B.fromLayer) { const d = wrapPi(theta - B.bearing * DEG) / (B.width * DEG); boost += B.gain * Math.exp(-d * d); }
      ctx.H[k] = L.h * boost;
    }
    // fire notches: angular weight per fire for this bearing
    ctx.fires = ctx.fires || [];
    ctx.fires.length = 0;
    for (const F of Fs) {
      const d = Math.abs(wrapPi(theta - F.b));
      if (d >= F.outer + 0.2) continue;
      ctx.fires.push({ F, d, w: 1 - smoothstep(F.core, F.outer, d), cos: Math.cos(d), sin: Math.sin(d) });
    }
    // volcano silhouettes: along this bearing a cone is highest near the closest approach D cos(phi)
    ctx.vol = ctx.vol || [];
    ctx.vol.length = 0;
    for (const V of Vs) {
      const phi = wrapPi(theta - V.b), lat = V.dist * Math.sin(phi);
      if (Math.cos(phi) <= 0 || Math.abs(lat) > V.rb * 0.85) continue;
      const q = 1 - (lat / (V.rb * 0.85)) ** 2;
      ctx.vol.push({ V, rc: V.dist * Math.cos(phi), lat, w: q * q });
    }
    return ctx;
  }

  function volcanoH(V, x, z, info) {
    const dx = x - V.x, dz = z - V.z, rho = Math.hypot(dx, dz);
    if (rho >= V.rb) return -1e9;
    const s = rho / V.rb;
    const sp = (Math.sqrt(s * s + V.s0 * V.s0) - V.s0) / V.norm;
    const shape = (Math.exp(-V.a * sp) - V.ea) / (1 - V.ea);
    const base = cfg.valley.y, Ht = V.h - base;
    let h = base + Ht * shape;
    // radial cleavers and glacier gullies: noise stretched down the fall line; the angular seam sits on the far side
    const psi = wrapPi(Math.atan2(dx, -dz) - V.b - Math.PI);
    const g = perlin(psi * V.ribs + V.seedOff, rho / 1600 - V.seedOff) + 0.45 * perlin(psi * V.ribs * 2.3 - V.seedOff, rho / 650 + 3.1);
    const taper = s < 0.92 ? Math.sin(Math.PI * Math.min(1, (s + 0.04) / 0.96)) : 0;
    h += Ht * V.gully * g * taper * (s > 0.06 ? 1 : s / 0.06);
    let ash = 0;
    if (V.crater) {
      const C = V.crater;
      const cx = V.x, czz = V.z - C.north;         // crater centre sits north (-z) of the old summit
      const ex = x - cx, ez = z - czz, dc = Math.hypot(ex, ez), t = dc / C.r;
      if (t < 1.3) {
        const wall = Math.pow(smoothstep(0.28, 1.0, t), 1.5);
        let bowl = C.floor + (h - C.floor) * wall;
        const ddx = x - cx, ddz = z - (czz + 120);   // 1983 lava dome, a little south of centre
        bowl += C.dome * Math.exp(-(ddx * ddx + ddz * ddz) / (C.domeR * C.domeR)) * (1 - wall);
        h = lerp(h, Math.min(h, bowl), smoothstep(1.3, 1.0, t));
      }
      // the lateral blast took the north flank: a U-shaped breach opening north (toward the tower's side)
      const along = czz - z, latv = Math.abs(x - cx);
      if (along > -350) {
        const wv = C.breachW + Math.max(0, along) * 0.3;
        const lw = Math.max(0, latv - wv);
        const channel = C.floor + 40 - Math.max(0, along) * C.breachSlope + lw * lw * 0.0035 + (perlin(x / 300, z / 300) * 25);
        h = lerp(h, smin(h, channel, 80), smoothstep(-350, 0, along));
      }
      const north = -dz / Math.max(rho, 1);
      ash = Math.max(smoothstep(0.62, 0.3, s), smoothstep(0.95, 0.55, s) * smoothstep(-0.25, 0.45, north));
    }
    if (info) {
      info[0] = V.snow + Math.max(0, -g) * 320 - Math.max(0, g) * 120;
      info[1] = smoothstep(0.12, 0.5, g) * smoothstep(0.06, 0.22, s) * (V.crater ? 0.5 : 1);
      info[2] = ash;
    }
    return h;
  }

  const vInfo = new Float64Array(4);
  function height(ctx, r, info) {
    const x = ctx.sx * r, z = ctx.cz * r;
    // valley floor
    const VY = cfg.valley;
    const base = VY.y + VY.amp * (perlin(x / VY.scale + 3.1, z / VY.scale - 2.2) + 0.5 * perlin(x / (VY.scale * 0.45) - 1.7, z / (VY.scale * 0.45) + 4.4));
    let h = base;
    // foothills: rolling forested hills below the cab, fading out under the first range
    const FT = cfg.foot;
    if (r < FT.r2) {
      const win = smoothstep(FT.r0, FT.r1, r) * (1 - smoothstep(FT.r1 + 600, FT.r2, r));
      if (win > 0) h += FT.amp * win * (0.45 + fbm(x / FT.scale + 7.7, z / FT.scale - 3.3, 4));
    }
    // ranges
    let rm = 0, active = false;
    for (let k = 0; k < NL; k++) {
      const u = (r - ctx.R[k]) / ctx.W[k];
      if (u <= -1 || u >= 1) continue;
      if (!active) {
        active = true;
        const s = 1 / RG.scale, ws = s / 2.7;
        const wx = x * s + RG.warp * perlin(x * ws + 5.2, z * ws + 1.3), wz = z * s + RG.warp * perlin(x * ws - 7.7, z * ws + 9.4);
        rm = rmf(wx, wz, RG.octaves);
      }
      const e = (1 - u * u) * (1 - u * u);
      const crest = ctx.H[k] * (RG.base + RG.gain * rm);
      h += e * (crest - base);
    }
    let snow = 0, rock = active ? smoothstep(0.58, 0.82, rm) * smoothstep(250, 650, h) : 0, ash = 0;
    // volcanoes (smooth max so their flanks merge into the ranges)
    for (const V of Vs) {
      const hv = volcanoH(V, x, z, vInfo);
      if (hv < h - 400) continue;
      const w = smoothstep(-120, 120, hv - h);
      h = smax(h, hv, 160);
      snow = lerp(snow, vInfo[0], w); rock = lerp(rock, vInfo[1], w); ash = lerp(ash, vInfo[2], w);
    }
    // fire sites: a shelf for the fire to sit on, then a notch so nothing between the cab and the fire rises above the
    // sightline to the bottom of its glow sprite
    for (const c of ctx.fires) {
      const F = c.F;
      const lat = r * c.sin, dr = r * c.cos - F.D;
      const sw = FC.shelfW;
      const g = Math.exp(-(lat * lat) / (2 * sw * sw)) * Math.exp(-(dr * dr) / (2 * (dr < 0 ? 170 : 450) ** 2));
      if (g > 1e-3) h = lerp(h, F.y - FC.baseDrop + 3 + Math.max(0, dr) * 0.18, g);
      if (c.w > 0 && r < F.D - 5) {
        const margin = r * F.marginTan * smoothstep(F.D, F.D - 500, r);
        const maxH = eyeY + r * F.tanE - margin;
        h = lerp(h, smin(h, maxH, 30), c.w);
      }
    }
    if (info) { info[0] = snow; info[1] = rock; info[2] = ash; info[3] = rm; }
    return h;
  }

  // ring-sampling density along a column (rings per metre, unnormalised)
  function density(ctx, r) {
    let d = 1 / (0.17 * r);
    for (let k = 0; k < NL; k++) { const q = (r - ctx.R[k]) / (0.42 * ctx.W[k]); d += (7 / ctx.W[k]) * Math.exp(-q * q); }
    for (const c of ctx.vol) {
      const sg = 380 + 0.22 * Math.abs(c.lat), q = (r - c.rc) / sg;
      d += (5.5 * c.w / sg) * Math.exp(-q * q);
      if (c.V.crater && Math.abs(c.lat) < 1300) { const q2 = (r - (c.rc + 520)) / 330; d += (3 / 330) * Math.exp(-q2 * q2); }
    }
    return d;
  }

  return { column, height, density, fbm, rmf, perlin, volcanoes: Vs, fires: Fs };
}

// distance from the origin to the edge of an axis-aligned box along a bearing (the box contains the origin)
function rayBox(sx, cz, B) {
  const tx = sx > 1e-9 ? B.maxX / sx : sx < -1e-9 ? B.minX / sx : Infinity;
  const tz = cz > 1e-9 ? B.maxZ / cz : cz < -1e-9 ? B.minZ / cz : Infinity;
  return Math.min(tx, tz);
}

// ---------------------------------------------------------------- the mesh
/**
 * buildMountains({ heightAt, box, fires, config }) -> { positions, normals, info, index, stats, ... }
 *   heightAt(x, z): the playable terrain's height (the near grid starts 2 m under the terrain mesh's edge)
 *   box: the terrain MESH extent { minX, maxX, minZ, maxZ } (world.js chunks overrun W.rect to the next 64 m)
 *   fires: [{ x, y, z }] — layout.fireSites[].position
 * info: Uint8 x4 per vertex = [snow bias (m, (b + 800) / 1600), rock, depth below the local crest (m / 6), ash]
 */
export function buildMountains(opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const cfg = opts.config ? { ...MOUNTAINS, ...opts.config } : MOUNTAINS;
  const field = createField(cfg, opts.fires || []);
  const terrainH = opts.heightAt || (() => 0);
  const box = opts.box || { minX: -420, maxX: 476, minZ: -420, maxZ: 540 };
  const NAn = cfg.near.cols, NRn = cfg.near.rings, NAf = cfg.far.cols, NRf = cfg.far.rings;
  const ratio = NAf / NAn;
  if (ratio !== Math.round(ratio)) throw new Error('far.cols must be a multiple of near.cols');
  const nFar = NAf * NRf, nNear = NAn * NRn, nV = nFar + nNear;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), inf = new Uint8Array(nV * 4);
  const rad = new Float32Array(nV);
  const snowA = new Float32Array(nV), rockA = new Float32Array(nV), ashA = new Float32Array(nV);
  const info = new Float64Array(4);
  const ctx = {};
  const vFar = (i, j) => j * NAf + i, vNear = (i, j) => nFar + j * NAn + i;
  const put = (v, x, y, z, r) => { pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; rad[v] = r; snowA[v] = info[0]; rockA[v] = info[1]; ashA[v] = info[2]; };

  // --- near grid: terrain-mesh edge -> rIn, blended from the terrain's edge height into the field over near.blend metres
  const bx0 = box.minX, bx1 = box.maxX, bz0 = box.minZ, bz1 = box.maxZ;
  for (let i = 0; i < NAn; i++) {
    const th = (i / NAn) * TAU;
    field.column(th, ctx);
    const rE = rayBox(ctx.sx, ctx.cz, box);
    for (let j = 0; j < NRn; j++) {
      const t = j / (NRn - 1);
      const r = rE * Math.pow(cfg.rIn / rE, Math.pow(t, 1.35));
      const x = ctx.sx * r, z = ctx.cz * r;
      const hm = field.height(ctx, r, info);
      let y;
      if (j === 0) {   // on the terrain mesh edge, a little under it (and under its neighbours along the edge)
        const ex = -ctx.cz, ez = ctx.sx;
        y = Math.min(terrainH(x, z), terrainH(x + ex * 4, z + ez * 4), terrainH(x - ex * 4, z - ez * 4)) - cfg.near.sink;
        info[0] = 0; info[1] = 0; info[2] = 0;
      } else {
        const cx = clamp(x, bx0, bx1), cz2 = clamp(z, bz0, bz1);
        const de = Math.hypot(x - cx, z - cz2);
        y = lerp(terrainH(cx, cz2) - cfg.near.sink, hm, smoothstep(0, cfg.near.blend, de));
      }
      put(vNear(i, j), x, y, z, r);
    }
  }
  const tNear = now();

  // --- far grid: ring radii = quantiles of a per-column sampling density. The density only varies slowly with bearing,
  // so it is solved on every RSTEP-th column and interpolated (a blend of increasing sequences is still increasing).
  const M = 72, dr = (cfg.rOut - cfg.rIn) / (M - 1), RSTEP = 4, NC = Math.ceil(NAf / RSTEP);
  const cdf = new Float64Array(M), radii = new Float64Array(NRf), coarse = new Float64Array(NC * NRf);
  for (let c = 0; c < NC; c++) {
    field.column(((c * RSTEP) / NAf) * TAU, ctx);
    cdf[0] = 0;
    for (let m = 1; m < M; m++) cdf[m] = cdf[m - 1] + field.density(ctx, cfg.rIn + (m - 0.5) * dr) * dr;
    const total = cdf[M - 1];
    let m = 1;
    for (let j = 0; j < NRf; j++) {
      const target = (total * j) / (NRf - 1);
      while (m < M - 1 && cdf[m] < target) m++;
      const f = (target - cdf[m - 1]) / Math.max(1e-12, cdf[m] - cdf[m - 1]);
      coarse[c * NRf + j] = cfg.rIn + (m - 1 + clamp(f, 0, 1)) * dr;
    }
  }
  for (let i = 0; i < NAf; i++) {
    const th = (i / NAf) * TAU;
    field.column(th, ctx);
    const c0 = Math.floor(i / RSTEP), c1 = (c0 + 1) % NC, f = (i % RSTEP) / RSTEP;
    for (let j = 0; j < NRf; j++) radii[j] = lerp(coarse[c0 * NRf + j], coarse[c1 * NRf + j], f);
    radii[0] = cfg.rIn; radii[NRf - 1] = cfg.rOut;
    for (let j = 1; j < NRf; j++) {
      const r = radii[j];
      const y = field.height(ctx, r, info);
      put(vFar(i, j), ctx.sx * r, y, ctx.cz * r, r);
    }
  }
  // far ring 0 lies exactly on the chords of the near grid's outer ring (no T-junction cracks)
  for (let i = 0; i < NAf; i++) {
    const i0 = Math.floor(i / ratio), f = (i % ratio) / ratio, i1 = (i0 + 1) % NAn;
    const a = vNear(i0, NRn - 1), b = vNear(i1, NRn - 1), v = vFar(i, 0);
    for (let c = 0; c < 3; c++) pos[v * 3 + c] = lerp(pos[a * 3 + c], pos[b * 3 + c], f);
    rad[v] = cfg.rIn; snowA[v] = lerp(snowA[a], snowA[b], f); rockA[v] = lerp(rockA[a], rockA[b], f); ashA[v] = lerp(ashA[a], ashA[b], f);
  }
  const tFar = now();

  // --- normals (central differences on the grid; the near outer ring looks across the seam into far ring 1)
  const tA = [0, 0, 0], tR = [0, 0, 0];
  const sub = (o, a, b) => { o[0] = pos[a * 3] - pos[b * 3]; o[1] = pos[a * 3 + 1] - pos[b * 3 + 1]; o[2] = pos[a * 3 + 2] - pos[b * 3 + 2]; };
  const setN = (v) => {
    let nx = tA[1] * tR[2] - tA[2] * tR[1], ny = tA[2] * tR[0] - tA[0] * tR[2], nz = tA[0] * tR[1] - tA[1] * tR[0];
    const l = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
  };
  for (let j = 0; j < NRn; j++) for (let i = 0; i < NAn; i++) {
    const v = vNear(i, j);
    sub(tA, vNear((i + 1) % NAn, j), vNear((i + NAn - 1) % NAn, j));
    const out = j < NRn - 1 ? vNear(i, j + 1) : vFar(i * ratio, 1), inn = j > 0 ? vNear(i, j - 1) : v;
    sub(tR, out, inn); setN(v);
  }
  for (let j = 1; j < NRf; j++) for (let i = 0; i < NAf; i++) {
    const v = vFar(i, j);
    sub(tA, vFar((i + 1) % NAf, j), vFar((i + NAf - 1) % NAf, j));
    sub(tR, j < NRf - 1 ? vFar(i, j + 1) : v, vFar(i, j - 1)); setN(v);
  }
  for (let i = 0; i < NAf; i++) {
    const i0 = Math.floor(i / ratio), f = (i % ratio) / ratio, a = vNear(i0, NRn - 1), b = vNear((i0 + 1) % NAn, NRn - 1), v = vFar(i, 0);
    let nx = lerp(nor[a * 3], nor[b * 3], f), ny = lerp(nor[a * 3 + 1], nor[b * 3 + 1], f), nz = lerp(nor[a * 3 + 2], nor[b * 3 + 2], f);
    const l = Math.hypot(nx, ny, nz) || 1; nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
  }

  // --- depth below the local crest (drives low-sun shadowing + ambient occlusion in the shader)
  const colDepth = (vid, n, win) => {
    for (let j = 0; j < n; j++) {
      const v = vid(j); let hi = pos[v * 3 + 1];
      for (let k = 0; k < n; k++) { const w = vid(k); if (Math.abs(rad[w] - rad[v]) <= win) hi = Math.max(hi, pos[w * 3 + 1]); }
      const below = hi - pos[v * 3 + 1];
      inf[v * 4 + 2] = clamp(Math.round(below / 6), 0, 255);
    }
  };
  for (let i = 0; i < NAn; i++) colDepth((j) => vNear(i, j), NRn, 700);
  for (let i = 0; i < NAf; i++) colDepth((j) => vFar(i, j), NRf, 1600);
  for (let v = 0; v < nV; v++) {
    inf[v * 4] = clamp(Math.round(((snowA[v] + 800) / 1600) * 255), 0, 255);
    inf[v * 4 + 1] = clamp(Math.round(rockA[v] * 255), 0, 255);
    inf[v * 4 + 3] = clamp(Math.round(ashA[v] * 255), 0, 255);
  }

  // --- index: outermost band first (painter's order), far grid then near grid
  const nTri = 2 * NAf * (NRf - 1) + 2 * NAn * (NRn - 1);
  const index = new Uint32Array(nTri * 3);
  let k = 0;
  const band = (vid, NA, j) => {
    for (let i = 0; i < NA; i++) {
      const i1 = (i + 1) % NA, a = vid(i, j), b = vid(i1, j), c = vid(i, j + 1), d = vid(i1, j + 1);
      index[k++] = a; index[k++] = b; index[k++] = c;
      index[k++] = b; index[k++] = d; index[k++] = c;
    }
  };
  for (let j = NRf - 2; j >= 0; j--) band(vFar, NAf, j);
  for (let j = NRn - 2; j >= 0; j--) band(vNear, NAn, j);
  const t1 = now();

  return {
    positions: pos, normals: nor, info: inf, index, radius: rad,
    grids: { far: { cols: NAf, rings: NRf, offset: 0 }, near: { cols: NAn, rings: NRn, offset: nFar } },
    rOut: cfg.rOut, config: cfg, field, box,
    stats: { vertices: nV, triangles: nTri, ms: +(t1 - t0).toFixed(1), msNear: +(tNear - t0).toFixed(1), msFar: +(tFar - tNear).toFixed(1) },
  };
}

// ---------------------------------------------------------------- analysis helpers (tests / tuning; not used at runtime)
/** Max elevation angle (deg) of the mesh per far-grid column, seen from eye [x, y, z]. */
export function meshSkyline(mesh, eye = MOUNTAINS.eye) {
  const { positions: P, grids } = mesh, out = new Float64Array(grids.far.cols);
  const NA = grids.far.cols, NRf = grids.far.rings, NAn = grids.near.cols, ratio = NA / NAn;
  for (let i = 0; i < NA; i++) {
    let best = -90;
    const test = (v) => { const dx = P[v * 3] - eye[0], dy = P[v * 3 + 1] - eye[1], dz = P[v * 3 + 2] - eye[2]; best = Math.max(best, Math.atan2(dy, Math.hypot(dx, dz)) / DEG); };
    for (let j = 0; j < NRf; j++) test(j * NA + i);
    const inear = Math.round(i / ratio) % NAn;
    for (let j = 0; j < grids.near.rings; j++) test(grids.near.offset + j * NAn + inear);
    out[i] = best;
  }
  return out;
}
/** Ground-truth skyline of the field along the same bearings, sampled every `step` metres. */
export function fieldSkyline(mesh, eye = MOUNTAINS.eye, step = 12) {
  const cfg = mesh.config, field = mesh.field, NA = mesh.grids.far.cols, out = new Float64Array(NA), ctx = {};
  for (let i = 0; i < NA; i++) {
    field.column((i / NA) * TAU, ctx);
    let best = -90;
    for (let r = cfg.rIn; r <= cfg.rOut; r += step) {
      const h = field.height(ctx, r);
      best = Math.max(best, Math.atan2(h - eye[1], r) / DEG);
    }
    out[i] = best;
  }
  return out;
}
