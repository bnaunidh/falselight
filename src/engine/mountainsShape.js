// FALSE LIGHT — the distant Cascades, pure shape code (no three.js: runs in node for tests).
// A height field for the whole horizon — five receding ridge layers (ridged multifractal), a valley floor, low foothills,
// three volcanoes (Rainier NNE, St. Helens SSW with its 1980 horseshoe crater, Adams ESE) and notches that keep every
// fire site in layout.fireSites visible from the cab — plus a builder that samples it on two polar grids around the tower.
//
// Coordinates are three.js metres (+x east, -z north, +y up, tower base y = 0). Bearing = atan2(x, -z): 0 = north, 90 = east
// (the same formula bridge.js uses for the binocular readout).
//
// Mesh layout: a NEAR grid (512 columns) from the edge of the terrain mesh out to rIn = 2.6 km, and a FAR grid (2048
// columns x 32 rings) from rIn to rOut = 11.3 km (inside the camera far plane, 12 km); 138k triangles in all. Far-grid
// ring radii are chosen per column from a sampling density that peaks on each layer's crest and on each volcano's
// silhouette, so ridgelines stay crisp with few rings. The index buffer runs outermost band -> innermost band: with
// depthFunc LessEqual that painter's order makes self-occlusion exact even where the 24-bit depth buffer only resolves
// ~50-150 m at these distances.

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const MOUNTAINS = {
  seed: 1983,
  eye: [0, 31.0, 0],             // the lowest cab eye (crouched); fire notches are cut against this sightline
  rIn: 2600, rOut: 11300,
  near: { cols: 512, rings: 12, blend: 900, sink: 2.0 },
  far: { cols: 2048, rings: 32 },
  valley: { y: -58, amp: 30, scale: 2300 },                 // valley-floor datum between the ranges
  foot: { amp: 58, scale: 720, r0: 450, r1: 1300, r2: 3300 }, // forested foothills below the cab
  // receding ridges: crest radius r (m), half-width w (m), crest height scale h (m above the tower base), crest wander (m)
  layers: [
    { r: 3400, w: 650, h: 160, wander: 210 },
    { r: 5200, w: 750, h: 305, wander: 270 },
    { r: 7000, w: 800, h: 530, wander: 290 },
    { r: 8800, w: 850, h: 680, wander: 290 },
    { r: 10500, w: 800, h: 870, wander: 250 },
  ],
  ridge: { scale: 1900, octaves: 5, warp: 0.38, base: 0.36, gain: 1.05 },
  boosts: [{ name: 'Goat Rocks', bearing: 88, width: 14, gain: 0.38, fromLayer: 3 }],
  volcanoes: [
    // h = summit y (m above the tower base); rb = base radius; a/s0 = flank concavity / summit rounding
    { name: 'Rainier', bearing: 32, dist: 10200, h: 2880, rb: 7000, a: 2.1, s0: 0.12, snow: 300, ribs: 11, gully: 0.05 },
    { name: 'St. Helens', bearing: 200, dist: 8800, h: 1880, rb: 5200, a: 1.6, s0: 0.10, snow: -230, ribs: 7.5, gully: 0.035,
      crater: { north: 280, r: 850, floor: 1070, dome: 175, domeR: 270, breachW: 560, breachSlope: 0.17 }, ash: true },
    { name: 'Adams', bearing: 128, dist: 10500, h: 1850, rb: 5600, a: 1.7, s0: 0.22, snow: 260, ribs: 9, gully: 0.035 },
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

/**
 * Periodic gradient noise baked into a 257x257 table (period 16 units, 16 samples per unit) and read back bilinearly.
 * About 5x cheaper than evaluating Perlin and small enough for V8 to inline, which matters: a non-inlined call that
 * returns a double allocates a heap number, and the builder makes ~1M noise calls.
 */
const TABLES = new Map();
export function makeTableNoise(seed = 1, period = 16, res = 16) {
  const key = seed + ':' + period + ':' + res;
  if (!TABLES.has(key)) TABLES.set(key, bakeTable(seed, period, res));
  const { T, W, mask } = TABLES.get(key);
  const fn = function tnoise(x, y) {
    const fx = x * res, fy = y * res;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const k = (iy & mask) * W + (ix & mask);
    const a = T[k], b = T[k + 1], c = T[k + W], d = T[k + W + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
  };
  fn.table = { T, W, mask, res };
  return fn;
}
function bakeTable(seed, period, res) {
  const r = mulberry32(seed), perm = new Uint8Array(256), p = new Uint16Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const m = period - 1, N = period * res, W = N + 1, T = new Float32Array(W * W);
  const fade = new Float64Array(res);
  for (let s = 0; s < res; s++) { const f = s / res; fade[s] = f * f * f * (f * (f * 6 - 15) + 10); }
  for (let cy = 0; cy < period; cy++) for (let cx = 0; cx < period; cx++) {
    const h00 = p[p[cx & m] + (cy & m)] & 7, h10 = p[p[(cx + 1) & m] + (cy & m)] & 7;
    const h01 = p[p[cx & m] + ((cy + 1) & m)] & 7, h11 = p[p[(cx + 1) & m] + ((cy + 1) & m)] & 7;
    for (let sj = 0; sj < res; sj++) {
      const yf = sj / res, v = fade[sj], row = (cy * res + sj) * W + cx * res;
      for (let si = 0; si < res; si++) {
        const xf = si / res, u = fade[si];
        const a = GX[h00] * xf + GY[h00] * yf, b = GX[h10] * (xf - 1) + GY[h10] * yf;
        const c = GX[h01] * xf + GY[h01] * (yf - 1), d = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
        const ab = a + u * (b - a), cd = c + u * (d - c);
        T[row + si] = ab + v * (cd - ab);
      }
    }
  }
  for (let j = 0; j < N; j++) T[j * W + N] = T[j * W];     // periodic wrap: last column / row repeat the first
  for (let i = 0; i < W; i++) T[N * W + i] = T[i];
  return { T, W, mask: N - 1 };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
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
  const perlin = makePerlin(cfg.seed);            // exact gradient noise: per-column work + volcano flanks
  const N1 = makeTableNoise(cfg.seed + 5);        // table noise: everything evaluated per vertex (one baked table,
  const N2 = N1;                                  // decorrelated by offsets)
  const T1 = N1.table.T, W1 = N1.table.W, M1 = N1.table.mask, R1 = N1.table.res;
  const n1 = (x, y) => {
    const fx = x * R1, fy = y * R1, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const k = (iy & M1) * W1 + (ix & M1), a = T1[k], b = T1[k + 1], c = T1[k + W1], d = T1[k + W1 + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
  };
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

  function fbm(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * N1(x * f + i * 19.1, y * f - i * 7.7); f *= 2.02; a *= 0.5; } return s; }
  // Musgrave ridged multifractal, normalised to ~[0, 1]; sharp crest lines where the base noise crosses zero.
  // The table lookup is written out by hand: this loop runs ~400k times per build.
  const T2 = N2.table.T, W2 = N2.table.W, M2 = N2.table.mask, R2 = N2.table.res;
  function rmf(x, y, oct) {
    let sum = 0, norm = 0, f = 1, amp = 1, w = 1;
    for (let i = 0; i < oct; i++) {
      const fx = (x * f + i * 31.7 + 5.37) * R2, fy = (y * f - i * 17.3 + 9.71) * R2;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const k = (iy & M2) * W2 + (ix & M2);
      const a = T2[k], b = T2[k + 1], c = T2[k + W2], d = T2[k + W2 + 1];
      const nz = a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
      let n = 1 - (nz < 0 ? -nz : nz);
      n *= n; n *= w;
      w = n * 2 > 1 ? 1 : n * 2;
      sum += n * amp; norm += amp;
      f *= 2.03; amp *= 0.52;
    }
    return sum / norm;
  }

  const NV = Vs.length, NF = Fs.length;
  const boosts = cfg.boosts.map((B) => ({ b: B.bearing * DEG, w: B.width * DEG, gain: B.gain, from: B.fromLayer }));
  function column(theta, ctx = {}) {
    const sx = Math.sin(theta), cz = -Math.cos(theta);
    ctx.theta = theta; ctx.sx = sx; ctx.cz = cz;
    if (!ctx.R) {
      ctx.R = new Float64Array(NL); ctx.W = new Float64Array(NL); ctx.H = new Float64Array(NL);
      ctx.vi = new Int32Array(NV); ctx.vRc = new Float64Array(NV); ctx.vLat = new Float64Array(NV); ctx.vW = new Float64Array(NV);
      ctx.fi = new Int32Array(NF); ctx.fW = new Float64Array(NF); ctx.fCos = new Float64Array(NF); ctx.fSin = new Float64Array(NF);
    }
    for (let k = 0; k < NL; k++) {
      const L = Ls[k];
      // crest wander: noise sampled on a circle in noise space (seamless all the way round)
      const n = 0.8 * perlin(sx * 2.3 + 13.1 * k, cz * 2.3 - 5.7 * k) + 0.35 * perlin(sx * 5.1 + 3.3 * k, cz * 5.1 + 8.2 * k);
      ctx.R[k] = L.r + L.wander * n;
      ctx.W[k] = L.w * (1 + 0.12 * perlin(sx * 3.1 - 2.2 * k, cz * 3.1 + 4.4 * k));
      let boost = 1;
      for (let q = 0; q < boosts.length; q++) { const B = boosts[q]; if (k >= B.from) { const d = wrapPi(theta - B.b) / B.w; boost += B.gain * Math.exp(-d * d); } }
      ctx.H[k] = L.h * boost;
    }
    // fire notches that reach this bearing
    let nf = 0;
    for (let q = 0; q < NF; q++) {
      const F = Fs[q], d = Math.abs(wrapPi(theta - F.b));
      if (d >= F.outer + 0.2) continue;
      ctx.fi[nf] = q; ctx.fW[nf] = 1 - smoothstep(F.core, F.outer, d); ctx.fCos[nf] = Math.cos(d); ctx.fSin[nf] = Math.sin(d); nf++;
    }
    ctx.nf = nf;
    // volcanoes whose footprint this bearing crosses (+ where the silhouette forms: the closest approach D cos(phi))
    let nv = 0;
    for (let q = 0; q < NV; q++) {
      const V = Vs[q], phi = wrapPi(theta - V.b), lat = V.dist * Math.sin(phi);
      if (Math.cos(phi) <= 0 || Math.abs(lat) >= V.rb) continue;
      const u = Math.min(1, Math.abs(lat) / (V.rb * 0.85)), w = (1 - u * u) * (1 - u * u);
      ctx.vi[nv] = q; ctx.vRc[nv] = V.dist * Math.cos(phi); ctx.vLat[nv] = lat; ctx.vW[nv] = w; nv++;
    }
    ctx.nv = nv;
    return ctx;
  }

  const baseY = cfg.valley.y;
  function volcanoH(V, x, z, info, under) {
    const dx = x - V.x, dz = z - V.z, rho = Math.sqrt(dx * dx + dz * dz);
    if (rho >= V.rb) return -1e9;
    const s = rho / V.rb;
    const sp = (Math.sqrt(s * s + V.s0 * V.s0) - V.s0) / V.norm;
    const shape = (Math.exp(-V.a * sp) - V.ea) / (1 - V.ea);
    const Ht = V.h - baseY;
    let h = baseY + Ht * shape;
    if (h + Ht * V.gully * 1.5 < under) return -1e9;   // buried under the ranges here: skip the detail
    // radial cleavers and glacier gullies: noise stretched down the fall line; the angular seam sits on the far side
    const psi = wrapPi(Math.atan2(dx, -dz) - V.b - Math.PI);
    // (exact Perlin here: psi * ribs spans more than the 16-unit period of the baked table)
    const g = perlin(psi * V.ribs + V.seedOff, rho / 1600 - V.seedOff) + 0.5 * perlin(psi * V.ribs * 2.3 - V.seedOff, rho / 650 + 3.1);
    const taper = smoothstep(0.1, 0.38, s) * (1 - smoothstep(0.72, 0.95, s));   // smooth summit dome, no ribs on the apron
    h += Ht * V.gully * g * taper;
    let ash = 0;
    if (V.crater) {
      const C = V.crater;
      const cx = V.x, czz = V.z - C.north;         // crater centre sits north (-z) of the old summit
      const ex = x - cx, ez = z - czz, dc = Math.sqrt(ex * ex + ez * ez), t = dc / C.r;
      if (t < 1.3) {
        const ws = smoothstep(0.28, 1.0, t), wall = ws * Math.sqrt(ws);
        let bowl = C.floor + (h - C.floor) * wall;
        const ddz = z - (czz + 120);   // 1983 lava dome, a little south of centre
        bowl += C.dome * Math.exp(-(ex * ex + ddz * ddz) / (C.domeR * C.domeR)) * (1 - wall);
        h = lerp(h, Math.min(h, bowl), smoothstep(1.3, 1.0, t));
      }
      // the lateral blast took the north flank: a U-shaped breach opening north (toward the tower's side)
      const along = czz - z, latv = Math.abs(x - cx);
      if (along > -350) {
        const wv = C.breachW + Math.max(0, along) * 0.3;
        const lw = Math.max(0, latv - wv);
        const channel = C.floor + 40 - Math.max(0, along) * C.breachSlope + lw * lw * 0.0035 + N1(x / 300, z / 300) * 25;
        h = lerp(h, smin(h, channel, 80), smoothstep(-350, 0, along));
      }
      const north = -dz / Math.max(rho, 1);
      ash = Math.max(smoothstep(0.62, 0.3, s), smoothstep(0.95, 0.55, s) * smoothstep(-0.25, 0.45, north));
    }
    info[0] = V.snow + Math.max(0, -g) * 380 - Math.max(0, g) * 160;       // glaciers fill the gullies
    info[1] = smoothstep(0.18, 0.55, g) * smoothstep(0.05, 0.2, s);         // cleavers: rock ribs between them
    info[2] = ash;
    if (V.crater) {                                                          // crater walls + 1983 dome: dark fresh rock
      const C = V.crater, ex = x - V.x, ez = z - (V.z - C.north), t = Math.sqrt(ex * ex + ez * ez) / C.r;
      info[1] = Math.max(info[1] * 0.4, smoothstep(1.08, 0.85, t) * 0.85);
    }
    return h;
  }

  const vInfo = new Float64Array(4);
  const VY = cfg.valley, FT = cfg.foot, iVS = 1 / VY.scale, iVS2 = 1 / (VY.scale * 0.45), iFT = 1 / FT.scale;
  const rS = 1 / RG.scale, rWS = rS / 2.7, shelf2 = 2 * FC.shelfW * FC.shelfW, dropY = FC.baseDrop - 3;
  // small helpers write into a scratch array instead of returning doubles (keeps the table lookups inlined, no boxing)
  const scr = new Float64Array(4);
  function baseAndWarp(x, z) {
    scr[0] = VY.y + VY.amp * (n1(x * iVS + 3.1, z * iVS - 2.2) + 0.5 * n1(x * iVS2 - 1.7, z * iVS2 + 4.4));
    scr[1] = x * rS + RG.warp * n1(x * rWS + 5.2, z * rWS + 1.3);
    scr[2] = z * rS + RG.warp * n1(x * rWS - 7.7, z * rWS + 9.4);
  }
  function height(ctx, r, info) {
    const x = ctx.sx * r, z = ctx.cz * r;
    // valley floor
    baseAndWarp(x, z);
    const base = scr[0];
    let h = base;
    // foothills: rolling forested hills below the cab, fading out under the first range
    if (r < FT.r2) {
      const win = smoothstep(FT.r0, FT.r1, r) * (1 - smoothstep(FT.r1 + 600, FT.r2, r));
      if (win > 0) h += FT.amp * win * (0.45 + fbm(x * iFT + 7.7, z * iFT - 3.3, 3));
    }
    // ranges
    let rm = 0, active = false;
    for (let k = 0; k < NL; k++) {
      const u = (r - ctx.R[k]) / ctx.W[k];
      if (u <= -1 || u >= 1) continue;
      if (!active) { active = true; rm = rmf(scr[1], scr[2], RG.octaves); }
      const e = (1 - u * u) * (1 - u * u);
      h += e * (ctx.H[k] * (RG.base + RG.gain * rm) - base);
    }
    let snow = 0, rock = active ? smoothstep(0.58, 0.82, rm) * smoothstep(250, 650, h) : 0, ash = 0;
    // volcanoes (smooth max so their flanks merge into the ranges)
    for (let q = 0; q < ctx.nv; q++) {
      const hv = volcanoH(Vs[ctx.vi[q]], x, z, vInfo, h - 400);
      if (hv < h - 400) continue;
      const w = smoothstep(-120, 120, hv - h);
      h = smax(h, hv, 160);
      snow = lerp(snow, vInfo[0], w); rock = lerp(rock, vInfo[1], w); ash = lerp(ash, vInfo[2], w);
    }
    // fire sites: a shelf for the fire to sit on, then a notch so nothing between the cab and the fire rises above the
    // sightline to the bottom of its glow sprite
    for (let q = 0; q < ctx.nf; q++) {
      const F = Fs[ctx.fi[q]];
      const lat = r * ctx.fSin[q], dr = r * ctx.fCos[q] - F.D;
      const sd = dr < 0 ? 170 : 450;
      const g = Math.exp(-(lat * lat) / shelf2 - (dr * dr) / (2 * sd * sd));
      if (g > 1e-3) h = lerp(h, F.y - dropY + Math.max(0, dr) * 0.18, g);
      const w = ctx.fW[q];
      if (w > 0 && r < F.D - 5) {
        const margin = r * F.marginTan * smoothstep(F.D, F.D - 500, r);
        h = lerp(h, smin(h, eyeY + r * F.tanE - margin, 30), w);
      }
    }
    if (info) { info[0] = snow; info[1] = rock; info[2] = ash; info[3] = rm; }
    return h;
  }

  // ring-sampling density along a column (rings per metre, unnormalised)
  function density(ctx, r) {
    let d = 1 / (0.17 * r);
    for (let k = 0; k < NL; k++) { const q = (r - ctx.R[k]) / (0.42 * ctx.W[k]); d += (7 / ctx.W[k]) * Math.exp(-q * q); }
    for (let i = 0; i < ctx.nv; i++) {
      const lat = Math.abs(ctx.vLat[i]), sg = 380 + 0.22 * lat, q = (r - ctx.vRc[i]) / sg;
      d += (5.5 * ctx.vW[i] / sg) * Math.exp(-q * q);
      if (Vs[ctx.vi[i]].crater && lat < 1300) { const q2 = (r - (ctx.vRc[i] + 520)) / 330; d += (3 / 330) * Math.exp(-q2 * q2); }
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
  // opts.clock lets node tests time the phases in CPU ms (wall time is useless on a loaded machine)
  const now = opts.clock || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  const cfg = opts.config ? { ...MOUNTAINS, ...opts.config } : MOUNTAINS;
  const field = createField(cfg, opts.fires || []);
  const NAn = cfg.near.cols, NRn = cfg.near.rings, NAf = cfg.far.cols, NRf = cfg.far.rings;
  if (NAf % NAn) throw new Error('far.cols must be a multiple of near.cols');
  const nFar = NAf * NRf, nNear = NAn * NRn, nV = nFar + nNear;
  const S = {
    cfg, field, terrainH: opts.heightAt || (() => 0), box: opts.box || { minX: -420, maxX: 476, minZ: -420, maxZ: 540 },
    NAn, NRn, NAf, NRf, ratio: NAf / NAn, nFar, nV,
    pos: new Float32Array(nV * 3), nor: new Float32Array(nV * 3), inf: new Uint8Array(nV * 4), rad: new Float32Array(nV),
    snow: new Float32Array(nV), rock: new Float32Array(nV), ash: new Float32Array(nV), info: new Float64Array(4), ctx: {},
  };
  const t1 = now(); nearGrid(S);
  const t2 = now(); farGrid(S); seamRing(S);
  const t3 = now(); normals(S);
  const t3a = now(); crestDepth(S);
  const t3b = now(); packInfo(S);
  const t3c = now(); const index = buildIndex(S);
  const t4 = now();
  return {
    positions: S.pos, normals: S.nor, info: S.inf, index, radius: S.rad,
    grids: { far: { cols: NAf, rings: NRf, offset: 0 }, near: { cols: NAn, rings: NRn, offset: nFar } },
    rOut: cfg.rOut, config: cfg, field, box: S.box,
    stats: { vertices: nV, triangles: index.length / 3, ms: +(t4 - t0).toFixed(1), msSetup: +(t1 - t0).toFixed(1), msNear: +(t2 - t1).toFixed(1), msFar: +(t3 - t2).toFixed(1), msPost: +(t4 - t3).toFixed(1), post: [+(t3a - t3).toFixed(1), +(t3b - t3a).toFixed(1), +(t3c - t3b).toFixed(1), +(t4 - t3c).toFixed(1)] },
  };
}

function put(S, v, x, y, z, r) {
  const p = S.pos, i = S.info;
  p[v * 3] = x; p[v * 3 + 1] = y; p[v * 3 + 2] = z; S.rad[v] = r; S.snow[v] = i[0]; S.rock[v] = i[1]; S.ash[v] = i[2];
}

// near grid: from the terrain-mesh edge out to rIn, blended from the terrain's edge height into the field over near.blend m
function nearGrid(S) {
  const { cfg, field, terrainH, box, NAn, NRn, nFar, info, ctx } = S;
  const sink = cfg.near.sink, blend = cfg.near.blend;
  for (let i = 0; i < NAn; i++) {
    field.column((i / NAn) * TAU, ctx);
    const rE = rayBox(ctx.sx, ctx.cz, box), lg = Math.log(cfg.rIn / rE);
    for (let j = 0; j < NRn; j++) {
      const r = rE * Math.exp(lg * Math.pow(j / (NRn - 1), 1.35));
      const x = ctx.sx * r, z = ctx.cz * r;
      let y;
      if (j === 0) {   // on the terrain mesh edge, a little under it (and under its neighbours along the edge)
        const ex = -ctx.cz * 4, ez = ctx.sx * 4;
        y = Math.min(terrainH(x, z), terrainH(x + ex, z + ez), terrainH(x - ex, z - ez)) - sink;
        info[0] = 0; info[1] = 0; info[2] = 0;
      } else {
        const hm = field.height(ctx, r, info);
        const cx = x < box.minX ? box.minX : x > box.maxX ? box.maxX : x, cz = z < box.minZ ? box.minZ : z > box.maxZ ? box.maxZ : z;
        const de = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
        y = lerp(terrainH(cx, cz) - sink, hm, smoothstep(0, blend, de));
      }
      put(S, nFar + j * NAn + i, x, y, z, r);
    }
  }
}

// far grid: ring radii = quantiles of a per-column sampling density. The density only varies slowly with bearing, so it
// is solved on every RSTEP-th column and interpolated (a blend of increasing sequences is still increasing).
function farRadii(S, RSTEP, M) {
  const { cfg, field, NAf, NRf, ctx } = S;
  const dr = (cfg.rOut - cfg.rIn) / (M - 1), NC = Math.ceil(NAf / RSTEP);
  const cdf = new Float64Array(M), coarse = new Float64Array(NC * NRf);
  for (let c = 0; c < NC; c++) {
    field.column(((c * RSTEP) / NAf) * TAU, ctx);
    cdf[0] = 0;
    for (let m = 1; m < M; m++) cdf[m] = cdf[m - 1] + field.density(ctx, cfg.rIn + (m - 0.5) * dr) * dr;
    const total = cdf[M - 1];
    let m = 1;
    for (let j = 0; j < NRf; j++) {
      const target = (total * j) / (NRf - 1);
      while (m < M - 1 && cdf[m] < target) m++;
      let f = (target - cdf[m - 1]) / Math.max(1e-12, cdf[m] - cdf[m - 1]);
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      coarse[c * NRf + j] = cfg.rIn + (m - 1 + f) * dr;
    }
  }
  return coarse;
}
function farGrid(S) {
  const { cfg, field, NAf, NRf, info, ctx } = S;
  const RSTEP = 8, NC = Math.ceil(NAf / RSTEP), coarse = farRadii(S, RSTEP, 60);
  for (let i = 0; i < NAf; i++) {
    field.column((i / NAf) * TAU, ctx);
    const c0 = Math.floor(i / RSTEP), c1 = (c0 + 1) % NC, f = (i % RSTEP) / RSTEP;
    for (let j = 1; j < NRf; j++) {
      const r = j === NRf - 1 ? cfg.rOut : coarse[c0 * NRf + j] + (coarse[c1 * NRf + j] - coarse[c0 * NRf + j]) * f;
      const y = field.height(ctx, r, info);
      put(S, j * NAf + i, ctx.sx * r, y, ctx.cz * r, r);
    }
  }
}
// far ring 0 lies exactly on the chords of the near grid's outer ring (no T-junction cracks)
function seamRing(S) {
  const { NAf, NAn, NRn, nFar, ratio, pos, snow, rock, ash, rad, cfg } = S;
  for (let i = 0; i < NAf; i++) {
    const i0 = Math.floor(i / ratio), f = (i % ratio) / ratio, i1 = (i0 + 1) % NAn;
    const a = nFar + (NRn - 1) * NAn + i0, b = nFar + (NRn - 1) * NAn + i1, v = i;
    for (let c = 0; c < 3; c++) pos[v * 3 + c] = lerp(pos[a * 3 + c], pos[b * 3 + c], f);
    rad[v] = cfg.rIn; snow[v] = lerp(snow[a], snow[b], f); rock[v] = lerp(rock[a], rock[b], f); ash[v] = lerp(ash[a], ash[b], f);
  }
}

// normals: central differences on the grid (the near outer ring looks across the seam into far ring 1)
function setNormal(pos, nor, v, a0, a1, r0, r1) {
  const ax = pos[a0 * 3] - pos[a1 * 3], ay = pos[a0 * 3 + 1] - pos[a1 * 3 + 1], az = pos[a0 * 3 + 2] - pos[a1 * 3 + 2];
  const rx = pos[r0 * 3] - pos[r1 * 3], ry = pos[r0 * 3 + 1] - pos[r1 * 3 + 1], rz = pos[r0 * 3 + 2] - pos[r1 * 3 + 2];
  let nx = ay * rz - az * ry, ny = az * rx - ax * rz, nz = ax * ry - ay * rx;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
  nor[v * 3] = nx * l; nor[v * 3 + 1] = ny * l; nor[v * 3 + 2] = nz * l;
}
function normals(S) {
  const { pos, nor, NAn, NRn, NAf, NRf, nFar, ratio } = S;
  for (let j = 0; j < NRn; j++) {
    const row = nFar + j * NAn;
    for (let i = 0; i < NAn; i++) {
      const v = row + i, ip = i + 1 === NAn ? 0 : i + 1, im = i === 0 ? NAn - 1 : i - 1;
      setNormal(pos, nor, v, row + ip, row + im, j < NRn - 1 ? v + NAn : NAf + i * ratio, j > 0 ? v - NAn : v);
    }
  }
  for (let j = 1; j < NRf; j++) {
    const row = j * NAf;
    for (let i = 0; i < NAf; i++) {
      const v = row + i, ip = i + 1 === NAf ? 0 : i + 1, im = i === 0 ? NAf - 1 : i - 1;
      setNormal(pos, nor, v, row + ip, row + im, j < NRf - 1 ? v + NAf : v, v - NAf);
    }
  }
  const outer = nFar + (NRn - 1) * NAn;
  for (let i = 0; i < NAf; i++) {
    const i0 = Math.floor(i / ratio), f = (i % ratio) / ratio, a = outer + i0, b = outer + (i0 + 1 === NAn ? 0 : i0 + 1), v = i;
    const nx = nor[a * 3] + (nor[b * 3] - nor[a * 3]) * f, ny = nor[a * 3 + 1] + (nor[b * 3 + 1] - nor[a * 3 + 1]) * f, nz = nor[a * 3 + 2] + (nor[b * 3 + 2] - nor[a * 3 + 2]) * f;
    const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nor[v * 3] = nx * l; nor[v * 3 + 1] = ny * l; nor[v * 3 + 2] = nz * l;
  }
}

// depth below the highest ground within `win` metres along the same bearing (low-sun shadowing + ambient occlusion).
// One call per grid (not per column) so V8 optimises the loop early in a cold build.
function gridDepth(pos, rad, inf, off, NA, NR, win) {
  // two monotone sweeps (outward and inward) give max(y) over rings within +-win of each ring in O(rings)
  const hiA = new Float64Array(NR), dq = new Int32Array(NR);
  for (let i = 0; i < NA; i++) {
    let h = 0, t = 0;
    for (let j = 0; j < NR; j++) {             // max over rings k <= j with r_j - r_k <= win
      const v = off + j * NA + i, y = pos[v * 3 + 1];
      while (t > h && pos[(off + dq[t - 1] * NA + i) * 3 + 1] <= y) t--;
      dq[t++] = j;
      while (rad[v] - rad[off + dq[h] * NA + i] > win) h++;
      hiA[j] = pos[(off + dq[h] * NA + i) * 3 + 1];
    }
    h = 0; t = 0;
    for (let j = NR - 1; j >= 0; j--) {        // max over rings k >= j with r_k - r_j <= win
      const v = off + j * NA + i, y = pos[v * 3 + 1];
      while (t > h && pos[(off + dq[t - 1] * NA + i) * 3 + 1] <= y) t--;
      dq[t++] = j;
      while (rad[off + dq[h] * NA + i] - rad[v] > win) h++;
      const hi = Math.max(hiA[j], pos[(off + dq[h] * NA + i) * 3 + 1]);
      const q = Math.round((hi - y) / 6);
      inf[v * 4 + 2] = q > 255 ? 255 : q;
    }
  }
}
function crestDepth(S) {
  gridDepth(S.pos, S.rad, S.inf, S.nFar, S.NAn, S.NRn, 700);
  gridDepth(S.pos, S.rad, S.inf, 0, S.NAf, S.NRf, 1600);
}
function packInfo(S) {
  const { inf, snow, rock, ash, nV } = S;
  for (let v = 0; v < nV; v++) {
    let a = Math.round((snow[v] + 800) * 0.159375), b = Math.round(rock[v] * 255), c = Math.round(ash[v] * 255);
    inf[v * 4] = a < 0 ? 0 : a > 255 ? 255 : a; inf[v * 4 + 1] = b < 0 ? 0 : b > 255 ? 255 : b; inf[v * 4 + 3] = c < 0 ? 0 : c > 255 ? 255 : c;
  }
}

// index: outermost band first (painter's order), far grid then near grid
function bandIndex(index, k, off, NA, j) {
  const r0 = off + j * NA, r1 = r0 + NA;
  for (let i = 0; i < NA; i++) {
    const i1 = i + 1 === NA ? 0 : i + 1, a = r0 + i, b = r0 + i1, c = r1 + i, d = r1 + i1;
    index[k] = a; index[k + 1] = b; index[k + 2] = c; index[k + 3] = b; index[k + 4] = d; index[k + 5] = c; k += 6;
  }
  return k;
}
function buildIndex(S) {
  const { NAn, NRn, NAf, NRf, nFar } = S;
  const index = new Uint32Array((2 * NAf * (NRf - 1) + 2 * NAn * (NRn - 1)) * 3);
  let k = 0;
  for (let j = NRf - 2; j >= 0; j--) k = bandIndex(index, k, 0, NAf, j);
  for (let j = NRn - 2; j >= 0; j--) k = bandIndex(index, k, nFar, NAn, j);
  return index;
}

// ---------------------------------------------------------------- night-sky band table (used by mountains.js at runtime)
/**
 * Per-column colour of an equirect sky image laid out like sky.js reads it (row H-1 = zenith, row y at elevation
 * ((y + 0.5) / H - 0.5) * 180 deg; column = texture u) between el0 and el1 degrees: per column, the mean of the texels
 * no brighter than 1.25x the column's median (stars drop out, the moon halo stays), then smoothed circularly.
 * read(x, y, out) writes the linear rgb of texel (x, y) into out[0..2].
 * Returns { cols, rgb: Float64Array(cols * 3), mean: [r, g, b] } or null.
 */
export function skyBandTable(W, H, read, cols = 128, el0 = 23.5, el1 = 28) {
  if (!(W > 0 && H > 0)) return null;
  const y0 = Math.max(0, Math.round((el0 / 180 + 0.5) * H - 0.5)), y1 = Math.min(H - 1, Math.round((el1 / 180 + 0.5) * H - 0.5));
  const xs = Math.max(1, Math.floor(W / 512)), nx = Math.ceil(W / xs), ny = y1 - y0 + 1;
  const px = new Float32Array(nx * ny * 4), pc = new Uint16Array(nx * ny), o = [0, 0, 0];   // r, g, b, luminance + column
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W; x += xs) {
      read(x, y, o);
      const r = o[0], g = o[1], b = o[2];
      if (!(r >= 0 && g >= 0 && b >= 0 && r + g + b < 1e6)) continue;   // NaN / inf guard
      px[n * 4] = r; px[n * 4 + 1] = g; px[n * 4 + 2] = b; px[n * 4 + 3] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      pc[n] = Math.round(((x + 0.5) / W) * cols) % cols; n++;
    }
  }
  if (!n) return null;
  // per column: the mean of the texels no brighter than 1.25x that column's median luminance. Stars (and the moon disc,
  // were it in the rows) are rare bright outliers and drop out; the smooth moon halo moves the median with it and stays.
  const start = new Uint32Array(cols + 1), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) start[pc[i] + 1]++;
  for (let c = 0; c < cols; c++) start[c + 1] += start[c];
  const cur = start.slice(0, cols);
  for (let i = 0; i < n; i++) order[cur[pc[i]]++] = i;
  let out = new Float64Array(cols * 3);
  for (let c = 0; c < cols; c++) {
    const a = start[c], m = start[c + 1] - a;
    if (!m) continue;
    const L = new Float32Array(m);
    for (let k = 0; k < m; k++) L[k] = px[order[a + k] * 4 + 3];
    L.sort();
    const cap = 1.25 * L[m >> 1] + 1e-9;
    let r = 0, g = 0, b = 0, w = 0;
    for (let k = 0; k < m; k++) { const i = order[a + k]; if (px[i * 4 + 3] <= cap) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; w++; } }
    out[c * 3] = r / w; out[c * 3 + 1] = g / w; out[c * 3 + 2] = b / w;
  }
  for (let c = 0; c < cols; c++) {                  // columns with no samples (tiny images): borrow a neighbour
    if (start[c + 1] > start[c]) continue;
    for (let d = 1; d < cols; d++) { const e = (c + d) % cols; if (start[e + 1] > start[e]) { for (let q = 0; q < 3; q++) out[c * 3 + q] = out[e * 3 + q]; break; } }
  }
  for (let pass = 0; pass < 4; pass++) {            // circular [1 2 1] smoothing (sigma ~1.4 columns = 4°): no seams, no streaks
    const s = new Float64Array(cols * 3);
    for (let c = 0; c < cols; c++) {
      const a = ((c + cols - 1) % cols) * 3, b = ((c + 1) % cols) * 3;
      for (let q = 0; q < 3; q++) s[c * 3 + q] = 0.25 * out[a + q] + 0.5 * out[c * 3 + q] + 0.25 * out[b + q];
    }
    out = s;
  }
  const mean = [0, 0, 0];
  for (let c = 0; c < cols; c++) for (let q = 0; q < 3; q++) mean[q] += out[c * 3 + q] / cols;
  return { cols, rgb: out, mean };
}

// ---------------------------------------------------------------- analysis helpers (tests / tuning; not used at runtime)
/** Max elevation angle (deg) of the mesh per far-grid column, seen from eye [x, y, z]. */
export function meshSkyline(mesh, eye = MOUNTAINS.eye) {
  const { positions: P, grids } = mesh, out = new Float64Array(grids.far.cols);
  const NA = grids.far.cols, NRf = grids.far.rings, NAn = grids.near.cols, ratio = NA / NAn;
  for (let i = 0; i < NA; i++) {
    let best = -90;
    const test = (v) => { const dx = P[v * 3] - eye[0], dy = P[v * 3 + 1] - eye[1], dz = P[v * 3 + 2] - eye[2]; best = Math.max(best, Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) / DEG); };
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
