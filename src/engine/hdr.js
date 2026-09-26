// FALSE LIGHT — Radiance RGBE (.hdr) loader, written from the format spec (flat + new-style RLE scanlines).
// Produces a HalfFloat RGBA DataTexture (equirectangular) plus a few statistics the sky uses:
// average horizon colour, zenith colour, mean luminance and the azimuth of the brightest spot (sun/moon).
import * as THREE from 'three';
import { loadq } from './loadq.js?v=3479c8521344c615';

// (mantissa, exponent) -> half-float bits lookup; RGBE value = m * 2^(e-136)
let HALF_LUT = null;
function halfLUT() {
  if (HALF_LUT) return HALF_LUT;
  HALF_LUT = new Uint16Array(256 * 256);
  for (let e = 0; e < 256; e++) {
    const f = e === 0 ? 0 : Math.pow(2, e - 136);
    for (let m = 0; m < 256; m++) HALF_LUT[e * 256 + m] = THREE.DataUtils.toHalfFloat(Math.min(65000, (m + 0.5) * f * (m ? 1 : 0)));
  }
  return HALF_LUT;
}

export function parseRGBE(buffer) {
  const b = new Uint8Array(buffer);
  let p = 0;
  const line = () => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('not a Radiance HDR');
  let exposure = 1;
  for (;;) {
    const l = line();
    if (l === '') break;
    if (l.startsWith('EXPOSURE=')) exposure = parseFloat(l.slice(9)) || 1;
    if (p >= b.length) throw new Error('HDR header truncated');
  }
  const dims = line().trim().split(/\s+/);
  // stored bottom-up (GL convention, row 0 = v 0 = nadir) so three's equirect/PMREM code sees it upright
  let H = 0, W = 0, flipY = true;
  if (dims[0] === '-Y') { H = +dims[1]; W = +dims[3]; } else if (dims[0] === '+Y') { H = +dims[1]; W = +dims[3]; flipY = false; }
  else throw new Error('unsupported HDR orientation ' + dims.join(' '));
  const rgbe = new Uint8Array(W * H * 4);
  const scan = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    const row = flipY ? H - 1 - y : y;
    if (W >= 8 && W < 32768 && b[p] === 2 && b[p + 1] === 2 && ((b[p + 2] << 8) | b[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; for (let k = 0; k < n; k++) scan[(x + k) * 4 + c] = v; }
          else { for (let k = 0; k < n; k++) scan[(x + k) * 4 + c] = b[p++]; }
          x += n;
        }
      }
      rgbe.set(scan, row * W * 4);
    } else {
      rgbe.set(b.subarray(p, p + W * 4), row * W * 4); p += W * 4;
    }
  }
  return { width: W, height: H, rgbe, exposure };
}

export function rgbeToHalf({ width, height, rgbe }) {
  const lut = halfLUT();
  const out = new Uint16Array(width * height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0, n = width * height; i < n; i++) {
    const e = rgbe[i * 4 + 3] * 256;
    out[i * 4] = lut[e + rgbe[i * 4]];
    out[i * 4 + 1] = lut[e + rgbe[i * 4 + 1]];
    out[i * 4 + 2] = lut[e + rgbe[i * 4 + 2]];
    out[i * 4 + 3] = one;
  }
  return out;
}

// statistics on a coarse grid (fast)
export function hdrStats({ width: W, height: H, rgbe }) {
  const val = (x, y) => {
    const i = (y * W + x) * 4, e = rgbe[i + 3];
    if (!e) return [0, 0, 0];
    const f = Math.pow(2, e - 136);
    return [rgbe[i] * f, rgbe[i + 1] * f, rgbe[i + 2] * f];
  };
  const step = Math.max(1, W >> 8);
  const hor = [0, 0, 0], zen = [0, 0, 0], all = [0, 0, 0];
  let nh = 0, nz = 0, na = 0, best = -1, bestAz = 0, bestEl = 0;
  for (let y = H >> 1; y < H; y += step) {
    const el = ((y + 0.5) / H - 0.5) * Math.PI; // row H-1 = zenith
    const w = Math.cos(el);
    for (let x = 0; x < W; x += step) {
      const c = val(x, y);
      const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      all[0] += c[0] * w; all[1] += c[1] * w; all[2] += c[2] * w; na += w;
      if (el < 12 * Math.PI / 180) { hor[0] += c[0]; hor[1] += c[1]; hor[2] += c[2]; nh++; }
      if (el > 60 * Math.PI / 180) { zen[0] += c[0]; zen[1] += c[1]; zen[2] += c[2]; nz++; }
      if (L > best && el > 0.02) { best = L; bestAz = (x / W); bestEl = el; }
    }
  }
  const avg = (v, n) => v.map((k) => k / Math.max(1, n));
  const A = avg(all, na);
  return { horizon: avg(hor, nh), zenith: avg(zen, nz), mean: A, meanLum: 0.2126 * A[0] + 0.7152 * A[1] + 0.0722 * A[2],
    peakLum: best, peakU: bestAz, peakEl: bestEl };
}

// The public site's skies (tools/build_site.py): 'FLSK' + u32 [version, W, H, K, LW, LH], then the top K rows (d.y down to
// about -0.047, i.e. everything the dome shows) exactly, as 4 planes (R, G, B, E) of rows stored as differences from the
// left neighbour; then the rest of the sphere as a small LW x LH RGBE image (same coding) that only feeds the blurred
// environment map. Returns parseRGBE's shape (rgbe = the exact rows, GL order) plus the small lower image.
export function parseSkyBin(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length < 28 || b[0] !== 70 || b[1] !== 76 || b[2] !== 83 || b[3] !== 75) throw new Error('not a FALSE LIGHT sky');
  const dv = new DataView(b.buffer, b.byteOffset, 28);
  const [, W, H, K, LW, LH] = [0, 1, 2, 3, 4, 5].map((i) => dv.getUint32(4 + i * 4, true));
  if (b.length < 28 + 4 * (K * W + LW * LH)) throw new Error('sky truncated');
  const rgbe = new Uint8Array(W * H * 4);
  let p = 28;
  for (let c = 0; c < 4; c++) for (let y = 0; y < K; y++) {   // top-origin row y -> GL row H-1-y (row 0 = nadir, as parseRGBE)
    let acc = 0, o = (H - 1 - y) * W * 4 + c;
    for (let x = 0; x < W; x++, o += 4) { acc = (acc + b[p++]) & 255; rgbe[o] = acc; }
  }
  const lr = new Uint8Array(LW * LH * 4);
  for (let c = 0; c < 4; c++) for (let y = 0; y < LH; y++) { let acc = 0; for (let x = 0; x < LW; x++) { acc = (acc + b[p++]) & 255; lr[(y * LW + x) * 4 + c] = acc; } }
  const low = new Float32Array(LW * LH * 3);
  for (let i = 0; i < LW * LH; i++) { const e = lr[i * 4 + 3], f = e ? Math.pow(2, e - 136) : 0; for (let c = 0; c < 3; c++) low[i * 3 + c] = lr[i * 4 + c] ? (lr[i * 4 + c] + 0.5) * f : 0; }
  return { width: W, height: H, rgbe, exposure: 1, keep: K, low, lowW: LW, lowH: LH };
}
// fill the GL rows below the exact part (top-origin rows K..H-1) of a half-float RGBA array by bilinear upsampling
function fillLower(out, { width: W, height: H, keep: K, low, lowW: LW, lowH: LH }) {
  const s = (H - K) / LH, sx = W / LW, row = new Float32Array(LW * 3), toHalf = THREE.DataUtils.toHalfFloat;
  for (let y = K; y < H; y++) {
    let ly = (y - K + 0.5) / s - 0.5; ly = Math.min(LH - 1, Math.max(0, ly));
    const y0 = Math.floor(ly), y1 = Math.min(LH - 1, y0 + 1), fy = ly - y0;
    for (let i = 0; i < LW * 3; i++) row[i] = low[y0 * LW * 3 + i] * (1 - fy) + low[y1 * LW * 3 + i] * fy;
    const o0 = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x++) {
      const lx = (x + 0.5) / sx - 0.5, xf = Math.floor(lx), fx = lx - xf;
      const x0 = ((xf % LW) + LW) % LW, x1 = (x0 + 1) % LW, o = o0 + x * 4;
      for (let c = 0; c < 3; c++) out[o + c] = toHalf(Math.min(65000, row[x0 * 3 + c] * (1 - fx) + row[x1 * 3 + c] * fx));
    }
  }
}

export async function loadHDR(path, onProgress, prio = 1) {
  const buf = await loadq.take(path, prio);   // (through the download queue: counted, prioritised, ?v-stamped on the site)
  if (onProgress) onProgress(1);
  const sky = /\.sky\.bin(\?|$)/.test(path);
  const img = sky ? parseSkyBin(buf) : parseRGBE(buf);
  const data = rgbeToHalf(img);
  if (sky) fillLower(data, img);
  const tex = new THREE.DataTexture(data, img.width, img.height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.flipY = false;
  tex.needsUpdate = true;
  tex.userData.stats = hdrStats(img);
  tex.userData.path = path;
  return tex;
}
