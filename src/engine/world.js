// FALSE LIGHT — the world: terrain (built from the height bin, splat-shaded), creek, horizon, instanced vegetation
// with LODs + wind, the tower (colliders, anchors), placed props. Everything optional degrades to placeholders.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchBuffer, fetchJSON, tryJSON, assetURL, loadImageBitmap, clamp, smoothstep, fbm, hash2 } from './util.js';

const loader = new GLTFLoader();
export const gltfCache = new Map();
export async function loadGLB(path) {
  if (!gltfCache.has(path)) gltfCache.set(path, loader.loadAsync(assetURL(path)));
  return gltfCache.get(path);
}

// ------------------------------------------------------------------ polyline nearest-point index
class TrailIndex {
  constructor(segments, cell = 12) {
    this.segs = segments; this.cell = cell; this.grid = new Map();
    let s0 = 0;
    this.pieces = [];
    for (const seg of segments) {
      const P = seg.points;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const piece = { a, b, len, s: s0, seg: seg.name };
        const id = this.pieces.push(piece) - 1;
        const x0 = Math.floor((Math.min(a[0], b[0]) - 3) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + 3) / cell);
        const z0 = Math.floor((Math.min(a[2], b[2]) - 3) / cell), z1 = Math.floor((Math.max(a[2], b[2]) + 3) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const k = gx + ',' + gz; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(id);
        }
        s0 += len;
      }
    }
    this.length = s0;
  }
  nearest(x, z) {
    let best = null, bd = Infinity;
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    for (let r = 0; r <= 6 && !best; r++) {
      for (let ix = gx - r; ix <= gx + r; ix++) for (let iz = gz - r; iz <= gz + r; iz++) {
        if (r && ix > gx - r && ix < gx + r && iz > gz - r && iz < gz + r) continue;
        const l = this.grid.get(ix + ',' + iz); if (!l) continue;
        for (const id of l) {
          const p = this.pieces[id];
          const vx = p.b[0] - p.a[0], vz = p.b[2] - p.a[2];
          const t = clamp(((x - p.a[0]) * vx + (z - p.a[2]) * vz) / (vx * vx + vz * vz + 1e-9), 0, 1);
          const px = p.a[0] + vx * t, pz = p.a[2] + vz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < bd) { bd = d; best = { point: [px, p.a[1] + (p.b[1] - p.a[1]) * t, pz], dist: d, s: p.s + p.len * t, segment: p.seg }; }
        }
      }
    }
    return best || { point: [x, 0, z], dist: 1e9, s: 0, segment: null };
  }
}

// ------------------------------------------------------------------ terrain splat material
async function buildLayerArrays(names, manifest, size = 1024) {
  const kinds = { diff: [], arm: [], nor_gl: [] };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const kind of Object.keys(kinds)) {
    const data = new Uint8Array(size * size * 4 * names.length);
    for (let li = 0; li < names.length; li++) {
      const t = manifest.textures && manifest.textures[names[li]];
      let ok = false;
      if (t && t[kind]) {
        try {
          const bmp = await loadImageBitmap('assets/' + t[kind]);
          ctx.drawImage(bmp, 0, 0, size, size); bmp.close && bmp.close();
          data.set(ctx.getImageData(0, 0, size, size).data, li * size * size * 4); ok = true;
        } catch (e) { console.warn('terrain layer', names[li], kind, e); }
      }
      if (!ok) {   // procedural fallback
        const off = li * size * size * 4;
        for (let i = 0; i < size * size; i++) {
          const n = (hash2(i % size, (i / size) | 0) * 40) | 0;
          const base = kind === 'diff' ? [70 + n, 60 + n, 45 + n] : kind === 'arm' ? [255, 220, 0] : [128, 128, 255];
          data[off + i * 4] = base[0]; data[off + i * 4 + 1] = base[1]; data[off + i * 4 + 2] = base[2]; data[off + i * 4 + 3] = 255;
        }
      }
    }
    const tex = new THREE.DataArrayTexture(data, size, size, names.length);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 8;
    tex.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    kinds[kind] = tex;
  }
  return kinds;
}

function terrainMaterial(arrays, splatTex, rect, tiles) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const U = {
    uSplat: { value: splatTex }, uDiff: { value: arrays.diff }, uArm: { value: arrays.arm }, uNor: { value: arrays.nor_gl },
    uRectMin: { value: new THREE.Vector2(rect.min[0], rect.min[1]) },
    uRectSize: { value: new THREE.Vector2(rect.max[0] - rect.min[0], rect.max[1] - rect.min[1]) },
    uTiles: { value: new THREE.Vector4(...tiles) }, uWet: { value: 0 },
    uTints: { value: [new THREE.Vector3(0.62, 0.64, 0.56), new THREE.Vector3(0.86, 0.85, 0.82), new THREE.Vector3(0.8, 0.84, 0.78), new THREE.Vector3(0.7, 0.68, 0.66)] },
  };
  m.userData.uniforms = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFLW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFLW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFLW;
uniform sampler2D uSplat; uniform highp sampler2DArray uDiff; uniform highp sampler2DArray uArm; uniform highp sampler2DArray uNor;
uniform vec2 uRectMin; uniform vec2 uRectSize; uniform vec4 uTiles; uniform float uWet; uniform vec3 uTints[4];
vec4 flW; vec3 flN; float flR; float flAO; vec3 flCol;
float flHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float flNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(flHash(i),flHash(i+vec2(1,0)),f.x), mix(flHash(i+vec2(0,1)),flHash(i+vec2(1,1)),f.x), f.y); }
void flSample(){
  vec2 suv = (vFLW.xz - uRectMin) / uRectSize;
  vec3 s = texture2D(uSplat, suv).rgb;
  vec4 w = vec4(s, max(0.0, 1.0 - s.r - s.g - s.b));
  float nz = flNoise(vFLW.xz * 0.05) * 0.6 + flNoise(vFLW.xz * 0.21) * 0.4;
  vec3 col = vec3(0.); vec3 arm = vec3(0.); vec3 nt = vec3(0.); float hs[4]; vec3 cs[4]; vec3 as[4]; vec3 ns[4];
  for (int i = 0; i < 4; i++) {
    cs[i] = vec3(0.); as[i] = vec3(0., 1., 0.); ns[i] = vec3(0.5, 0.5, 1.); hs[i] = 0.;
    if (w[i] < 0.004) continue;
    float tile = uTiles[i];
    vec2 uv = vFLW.xz / tile;
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vFLW.xz / (tile * 2.7) + 0.37;   // anti-tiling colour read
    float k = smoothstep(0.35, 0.65, nz);
    cs[i] = mix(texture(uDiff, vec3(uv, float(i))).rgb, texture(uDiff, vec3(uv2, float(i))).rgb, k) * uTints[i];
    as[i] = texture(uArm, vec3(uv, float(i))).rgb; ns[i] = texture(uNor, vec3(uv, float(i))).rgb;
    hs[i] = dot(cs[i], vec3(0.33));
  }
  // height-based blend: crisper, natural transitions (pebbles poke through dirt, etc.)
  vec4 hw = w * vec4(pow(hs[0]+0.6,5.), pow(hs[1]+0.6,5.), pow(hs[2]+0.6,5.), pow(hs[3]+0.6,5.));
  hw /= max(1e-4, hw.x + hw.y + hw.z + hw.w);
  for (int i = 0; i < 4; i++) { col += cs[i] * hw[i]; arm += as[i] * hw[i]; nt += (ns[i] * 2. - 1.) * hw[i]; }
  flW = hw; flN = normalize(vec3(nt.x, -nt.y, max(0.2, nt.z))); flR = arm.g; flAO = arm.r;
  col *= mix(1.0, 0.62, uWet * (1. - hw.z));   // wet ground darkens
  flR = mix(flR, flR * 0.55, uWet);
  flCol = col;
}`)
      .replace('#include <map_fragment>', 'flSample(); diffuseColor.rgb *= flCol;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * flR;')
      .replace('#include <normal_fragment_maps>', `{
  vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 T = normalize(vec3(1.,0.,0.) - Nw * Nw.x);
  vec3 B = normalize(vec3(0.,0.,1.) - Nw * Nw.z);
  vec3 nw = normalize(T * flN.x + B * flN.y + Nw * flN.z);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(1.0, flAO, 0.7);');
  };
  m.customProgramCacheKey = () => 'fl-terrain';
  return m;
}

// ------------------------------------------------------------------ vegetation: instanced LOD sets with wind
const WIND = { time: { value: 0 }, amount: { value: 0.35 } };
function patchWind(mat, soft) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev.call(mat, sh, r);
    sh.uniforms.uFLTime = WIND.time; sh.uniforms.uFLWind = WIND.amount;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 flwind;\nuniform float uFLTime; uniform float uFLWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
  ip = instanceMatrix[3].xyz;
  #endif
  float ph = flwind.y * 6.2831 + dot(ip.xz, vec2(0.071, 0.053));
  float t = uFLTime * ${soft ? '1.9' : '1.1'} + ph;
  float sway = flwind.x;
  vec3 gust = vec3(sin(t) * 0.6 + sin(t * 2.37) * 0.25, sin(t * 3.1) * 0.12, cos(t * 0.83) * 0.45);
  transformed += gust * uFLWind * sway * ${soft ? '0.08' : '(0.18 + position.y * 0.004)'};
  ${soft ? '' : 'transformed.xz += vec2(sin(uFLTime * 0.37 + ph * 0.3), cos(uFLTime * 0.29 + ph * 0.3)) * uFLWind * 0.35 * pow(max(position.y, 0.0) / 50.0, 2.0);'}
}`);
  };
  mat.customProgramCacheKey = () => 'fl-wind-' + (soft ? 's' : 't') + mat.uuid;
}

function prepVegMaterial(mat, isFoliage, msaa) {
  const n = (mat.name || '').toLowerCase();
  if (isFoliage || n.includes('foliage') || n.includes('impostor') || mat.alphaTest > 0 || mat.transparent) {
    mat.transparent = false; mat.alphaTest = 0.42; mat.side = THREE.DoubleSide; mat.alphaToCoverage = !!msaa; mat.depthWrite = true;
  }
  if (n.includes('impostor')) { mat.roughness = 1; mat.envMapIntensity = 0.4; }
  if (n.includes('fir_bark')) mat.color.multiply(new THREE.Color(0.66, 0.72, 0.76));  // Douglas fir bark is grey-brown, not red
  mat.vertexColors = false;
  return mat;
}

class VegSet {
  constructor(kind, lods, placements, ranges, opts) {
    this.kind = kind; this.lods = lods; this.inst = placements; this.ranges = ranges;
    this.group = new THREE.Group(); this.group.name = 'veg:' + kind;
    this.meshes = lods.map((parts, li) => parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, placements.length);
      im.count = 0; im.frustumCulled = false; im.name = `${kind}_LOD${li}`;
      im.castShadow = li === 0 && opts.castShadow; im.receiveShadow = true;
      im.userData.part = p.matrix;
      this.group.add(im);
      return im;
    }));
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.base = placements.map(([x, y, z, r, s]) => {
      const m = new THREE.Matrix4();
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); this._s.setScalar(s * (opts.baseScale || 1)); this._p.set(x, y, z);
      return m.compose(this._p, this._q, this._s);
    });
  }
  update(cam, force) {
    const cx = cam.x, cz = cam.z;
    const counts = this.meshes.map(() => 0);
    const r0 = this.ranges[0] ** 2, r1 = (this.ranges[1] || 0) ** 2, r2 = (this.ranges[2] || 0) ** 2;
    for (let i = 0; i < this.inst.length; i++) {
      const p = this.inst[i];
      const d2 = (p[0] - cx) ** 2 + (p[2] - cz) ** 2;
      let li = d2 < r0 ? 0 : d2 < r1 ? 1 : d2 < r2 ? 2 : -1;
      if (li >= this.meshes.length) li = -1;
      if (li < 0) continue;
      const k = counts[li]++;
      for (const im of this.meshes[li]) {
        this._m.multiplyMatrices(this.base[i], im.userData.part);
        im.setMatrixAt(k, this._m);
      }
    }
    this.meshes.forEach((parts, li) => parts.forEach((im) => { im.count = counts[li]; im.instanceMatrix.needsUpdate = true; }));
    return counts;
  }
}

async function loadVegKind(kind, path, msaa) {
  const g = await loadGLB(path);
  const root = g.scene; root.updateMatrixWorld(true);
  const lodRoots = [0, 1, 2].map((i) => root.getObjectByName(`${kind}_LOD${i}`)).filter(Boolean);
  const roots = lodRoots.length ? lodRoots : [root];
  const soft = /fern|grass|salal|moss/.test(kind);
  return roots.map((r) => {
    const parts = [];
    r.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(r.matrixWorld).invert();
    const rootPos = new THREE.Matrix4().makeTranslation(r.matrixWorld.elements[12], 0, r.matrixWorld.elements[14]).invert();
    r.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      const col = geo.getAttribute('color');
      if (col) { const a = new Float32Array(col.count * 3); for (let i = 0; i < col.count; i++) { a[i * 3] = col.getX(i); a[i * 3 + 1] = col.getY(i); a[i * 3 + 2] = col.getZ(i); } geo.setAttribute('flwind', new THREE.BufferAttribute(a, 3)); geo.deleteAttribute('color'); }
      const mat = prepVegMaterial(o.material.clone(), /foliage|impostor/i.test(o.material.name), msaa);
      if (geo.getAttribute('flwind')) patchWind(mat, soft);
      // part matrix relative to the LOD root, but keep the LOD root's own offset out (LODs sit side by side in Blender)
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      parts.push({ geometry: geo, material: mat, matrix: m });
    });
    return parts;
  });
}

// ------------------------------------------------------------------ horizon ring (distant ridges, aerial perspective via fog)
function buildHorizon(heightAt, rect, fireSites) {
  const segA = 360, radii = [];
  for (let r = 420; r < 9500; r *= 1.12) radii.push(r);
  const pos = [], col = [], idx = [];
  const inRect = (x, z) => x > rect.min[0] + 2 && x < rect.max[0] - 2 && z > rect.min[1] + 2 && z < rect.max[1] - 2;
  for (let j = 0; j < radii.length; j++) {
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2, r = radii[j];
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      const f = clamp((r - 420) / 8000, 0, 1);
      let y = -30 + fbm(x * 0.0016, z * 0.0016, 5) * (60 + 520 * f) + 420 * Math.pow(f, 0.8) * (0.55 + 0.45 * Math.sin(a * 3 + 1.1)) - 60;
      for (const fs of fireSites || []) {   // raise the named fire ridges
        const fb = fs.bearingDeg * Math.PI / 180; let da = Math.abs(((a - fb + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        y += 260 * Math.exp(-(da * da) / 0.02) * Math.exp(-((r - fs.distance) ** 2) / (1200 ** 2));
      }
      const cx = clamp(x, rect.min[0], rect.max[0]), cz = clamp(z, rect.min[1], rect.max[1]);
      const edge = heightAt(cx, cz);
      const de = Math.hypot(x - cx, z - cz);
      y = inRect(x, z) ? edge - 60 : THREE.MathUtils.lerp(edge - 1.5, y, smoothstep(0, 900, de));
      pos.push(x, y, z);
      const g = 0.5 + 0.5 * fbm(x * 0.01, z * 0.01, 3);
      col.push(0.045 * g, 0.06 * g, 0.05 * g);
    }
  }
  for (let j = 0; j < radii.length - 1; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.name = 'FL_horizon'; m.receiveShadow = false;
  return m;
}

// ------------------------------------------------------------------ the world
export async function createWorld(engine, manifest, onProgress = () => {}) {
  const { scene } = engine;
  const W = { anchors: new Map(), colliders: [], layout: null, fires: new Map(), objects: new Map(), vegSets: [] };
  const prog = (f, label) => onProgress(f, label);

  // --- layout + heightfield
  const layout = (await tryJSON('assets/data/layout.json')) || (await tryJSON('docs/layout_plan.json')) || { places: {} };
  W.layout = layout;
  const hmeta = await tryJSON('assets/data/terrain_height.json');
  let H = null, HW = 0, HH = 0, hx0 = 0, hz0 = 0, hc = 1;
  if (hmeta) {
    try { H = new Float32Array(await fetchBuffer('assets/data/terrain_height.bin', (f) => prog(0.05 + f * 0.1, 'terrain'))); } catch (e) { console.warn('height bin', e); }
    [HW, HH] = hmeta.size; [hx0, hz0] = hmeta.origin; hc = hmeta.cell;
  }
  const heightAt = (x, z) => {
    if (!H) return 0;
    const fi = clamp((x - hx0) / hc, 0, HW - 1.001), fj = clamp((z - hz0) / hc, 0, HH - 1.001);
    const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j;
    const a = H[j * HW + i], b = H[j * HW + i + 1], c = H[(j + 1) * HW + i], d = H[(j + 1) * HW + i + 1];
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
  };
  W.heightAt = heightAt;
  const rect = hmeta ? { min: [hx0, hz0], max: [hx0 + (HW - 1) * hc, hz0 + (HH - 1) * hc] } : { min: [-420, -420], max: [420, 520] };
  W.rect = rect;
  // trail
  let segs = layout.trail && layout.trail.segments;
  if (!segs && layout.route) segs = layout.route.map((r) => ({ name: r.name, points: r.via.map(([x, z]) => [x, 0, z]) }));
  W.trail = new TrailIndex(segs || []);
  W.trail.halfWidth = (layout.trail && layout.trail.halfWidth) || 1.1;
  W.zones = (layout.zones || []).map((z) => ({ name: z.name, x: z.center[0], z: z.center[2], r: z.radius }));
  W.poi = (name) => {
    const a = W.anchors.get(name); if (a) return a.clone();
    const p = (layout.places && layout.places[name]) || (layout.junctions && { position: layout.junctions[name] });
    if (p && p.position) return new THREE.Vector3(...p.position);
    if (p && p.xz) return new THREE.Vector3(p.xz[0], heightAt(p.xz[0], p.xz[1]), p.xz[1]);
    return null;
  };

  // --- terrain mesh
  const splatJ = await tryJSON('assets/data/terrain_splat.json');
  const L = splatJ ? splatJ.layers : null;
  const names = L ? [L.r.name, L.g.name, L.b.name, (L.burn || L.a || L.r).name] : ['forest_floor', 'rocky_trail', 'mossy_rock', 'burned_ground_01'];
  const tiles = L ? [L.r.tileMeters, L.g.tileMeters, L.b.tileMeters, (L.burn || L.r).tileMeters] : [3.2, 2.2, 3, 3];
  prog(0.18, 'ground textures');
  const arrays = await buildLayerArrays(names, manifest, engine.quality.terrainTex);
  let splatTex;
  try {
    const bmp = await loadImageBitmap('assets/data/terrain_splat.png', { flipY: false });
    splatTex = new THREE.Texture(bmp); splatTex.flipY = false; splatTex.needsUpdate = true;
  } catch (e) {
    splatTex = new THREE.DataTexture(new Uint8Array([200, 30, 25, 255]), 1, 1); splatTex.needsUpdate = true;
  }
  splatTex.colorSpace = THREE.NoColorSpace; splatTex.minFilter = THREE.LinearFilter; splatTex.magFilter = THREE.LinearFilter;
  const tmat = terrainMaterial(arrays, splatTex, rect, tiles);
  W.terrainMaterial = tmat;
  const CH = 64;
  const chunks = [];
  const terrainGroup = new THREE.Group(); terrainGroup.name = 'FL_terrain';
  const mkChunk = (x0, z0, step) => {
    const n = Math.round(CH / step) + 1;
    const pos = new Float32Array((n * n + n * 4) * 3), nor = new Float32Array((n * n + n * 4) * 3);
    let k = 0;
    const hN = (x, z) => { const e = 1.0; const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e); const v = new THREE.Vector3(-dx, 2 * e, -dz).normalize(); return v; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step; const y = heightAt(x, z); const nv = hN(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; nor[k * 3] = nv.x; nor[k * 3 + 1] = nv.y; nor[k * 3 + 2] = nv.z; k++;
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    // skirts (hide LOD cracks)
    const edges = [[...Array(n).keys()].map((i) => i), [...Array(n).keys()].map((i) => i * n + n - 1), [...Array(n).keys()].map((i) => (n - 1) * n + (n - 1 - i)), [...Array(n).keys()].map((i) => (n - 1 - i) * n)];
    for (const e of edges) {
      const start = k;
      for (const vi of e) { pos[k * 3] = pos[vi * 3]; pos[k * 3 + 1] = pos[vi * 3 + 1] - 2.5; pos[k * 3 + 2] = pos[vi * 3 + 2]; nor[k * 3] = nor[vi * 3]; nor[k * 3 + 1] = nor[vi * 3 + 1]; nor[k * 3 + 2] = nor[vi * 3 + 2]; k++; }
      for (let t = 0; t < e.length - 1; t++) { const a = e[t], b = e[t + 1], c = start + t, d = start + t + 1; idx.push(a, b, c, b, d, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, tmat); m.receiveShadow = true; m.matrixAutoUpdate = false;
    return m;
  };
  for (let z0 = rect.min[1]; z0 < rect.max[1] - 1; z0 += CH) {
    for (let x0 = rect.min[0]; x0 < rect.max[0] - 1; x0 += CH) {
      const c = { x: x0 + CH / 2, z: z0 + CH / 2, lod0: mkChunk(x0, z0, 1), lod1: mkChunk(x0, z0, 4) };
      c.lod0.castShadow = false;   // terrain self-shadowing isn't worth a second pass over 200k tris
      terrainGroup.add(c.lod0, c.lod1); chunks.push(c);
    }
    prog(0.25 + 0.15 * (z0 - rect.min[1]) / (rect.max[1] - rect.min[1]), 'terrain');
    await new Promise((r) => setTimeout(r, 0));
  }
  scene.add(terrainGroup);
  W.terrain = { group: terrainGroup, chunks };

  // --- horizon + creek
  scene.add(buildHorizon(heightAt, rect, layout.fireSites));
  if (layout.creek && layout.creek.points && layout.creek.points.length > 1) {
    const P = layout.creek.points, hw = layout.creek.halfWidth || 1.6;
    const pos = [], idx = [], uv = [];
    let acc = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[2] - a[2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      if (i) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
      const y = Math.max(P[i][1] - 0.15, heightAt(P[i][0], P[i][2]) + 0.12);
      pos.push(P[i][0] - tz * hw, y, P[i][2] + tx * hw, P[i][0] + tz * hw, y, P[i][2] - tx * hw);
      uv.push(0, acc / 4, 1, acc / 4);
      if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const wm = new THREE.MeshStandardMaterial({ color: 0x0e1413, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86 });
    const WU = { uT: engine.time };
    wm.onBeforeCompile = (sh) => {
      sh.uniforms.uT = WU.uT;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uT;')
        .replace('#include <normal_fragment_maps>', `{ vec2 q = vNormal.xy; float t = uT;
          vec3 p = vViewPosition; float a = sin(p.x*2.1 + t*3.1) + sin(p.z*1.7 - t*2.3 + p.x) + sin((p.x+p.z)*3.3 + t*4.0)*0.5;
          normal = normalize(normal + vec3(cos(p.x*2.1+t*3.1), 0.0, cos(p.z*1.7-t*2.3)) * 0.12 * a); }`);
    };
    const water = new THREE.Mesh(g, wm); water.name = 'FL_creek_water'; water.renderOrder = 2;
    scene.add(water);
  }

  // --- tower
  prog(0.45, 'tower');
  const glass = [];
  async function addModel(name, pos = null, rotY = 0, scale = 1) {
    const e = manifest.models && manifest.models[name];
    if (!e) return null;
    try {
      const g = await loadGLB('assets/' + e.path);
      const root = (pos ? g.scene.clone(true) : g.scene);
      if (pos) { root.position.copy(pos); root.rotation.y = rotY; root.scale.setScalar(scale); }
      root.updateMatrixWorld(true);
      const toRemove = [];
      root.traverse((o) => {
        const n = o.name || '';
        if (n.startsWith('COL_')) { o.visible = false; if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ visible: false }); W.colliders.push({ name: n, type: n.startsWith('COL_ramp') ? 'ramp' : n.startsWith('COL_floor') ? 'floor' : 'wall', mesh: o, enabled: true }); } return; }
        if (/^(IA_|SP_|LIGHT_|FACE_|FL_searchlight_beam_origin)/.test(n)) { const v = new THREE.Vector3(); o.getWorldPosition(v); W.anchors.set(n, v); }
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            if (m.name === 'FL_glass') { m.transparent = true; m.opacity = 0.18; m.roughness = 0.08; m.metalness = 0; m.depthWrite = false; glass.push(m); o.castShadow = false; }
            if (/wiremesh|mesh$/i.test(m.name) || m.alphaTest > 0) { m.alphaTest = Math.max(0.35, m.alphaTest); m.transparent = false; m.side = THREE.DoubleSide; o.castShadow = true; }
            if (/oilstain/i.test(m.name)) { m.transparent = true; m.depthWrite = false; o.castShadow = false; }
            if (/searchlight_lens/i.test(m.name)) { m.transparent = true; m.opacity = 0.5; }
          }
        }
        W.objects.set(n, o);
      });
      scene.add(root);
      return root;
    } catch (err) { console.warn('model', name, err); return null; }
  }
  W.addModel = addModel;
  const tower = await addModel('tower');
  if (!tower) {   // placeholder tower so the game runs without art
    const g = new THREE.Group(); g.name = 'placeholder_tower';
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.3, 30, 0.3, sx * 3.6, 15, sz * 3.6, wood);
    box(6.1, 0.1, 6.1, 0, 29.95, 0, wood); box(4.3, 2.5, 4.3, 0, 31.25, 0, new THREE.MeshStandardMaterial({ color: 0xb8b2a8 }));
    scene.add(g);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 42.5), new THREE.MeshBasicMaterial({ visible: false }));
    ramp.position.set(-0.2, 15, 0); ramp.rotation.x = Math.atan2(30, 30) * 0; ramp.visible = false; ramp.updateMatrixWorld();
    W.anchors.set('SP_cab_bed', new THREE.Vector3(-1, 30, -0.7)); W.anchors.set('SP_stair_foot', new THREE.Vector3(-0.2, 0, 3));
  }
  W.glassMaterials = glass;
  const cab = await addModel('cab_interior');
  // searchlight nodes
  W.searchlight = { yaw: W.objects.get('FL_searchlight_yaw') || null, pitch: W.objects.get('FL_searchlight_pitch') || null };

  // --- placed props (whatever exists)
  prog(0.52, 'props');
  for (const pp of layout.propPlacements || []) {
    const r = await addModel(pp.model, new THREE.Vector3(...pp.position), pp.rotY || 0, pp.scale || 1);
    if (r) r.name = 'placed:' + pp.model;
  }
  // the Weeper's rock
  if (layout.weeperRock) {
    const wr = layout.weeperRock;
    const r = await addModel('veg_rocks_boulder', new THREE.Vector3(wr.position[0], wr.position[1] - 0.25, wr.position[2]), Math.atan2(wr.facing[0], wr.facing[2]), 1.6);
    if (r) r.name = 'weeper_rock';
    W.weeperSeat = new THREE.Vector3(wr.position[0], wr.rockTopY != null ? wr.rockTopY : wr.position[1] + 1.35, wr.position[2]);
  }

  // --- vegetation
  const scatter = await tryJSON('assets/data/scatter.json');
  if (scatter) {
    const kinds = Object.keys(scatter);
    let done = 0;
    for (const kind of kinds) {
      const e = manifest.models && manifest.models[kind];
      if (!e) { done++; continue; }
      try {
        const lods = await loadVegKind(kind, 'assets/' + e.path, engine.msaa);
        const isTree = /fir|hemlock|snag|sapling/.test(kind);
        const q = engine.quality;
        const ranges = isTree ? (kind === 'veg_sapling' ? [q.treeLod0 * 0.6, q.treeLod1 * 0.6, q.treeLod2 * 0.5] : [q.treeLod0, q.treeLod1, q.treeLod2])
          : /rocks|stump|log|boulder/.test(kind) ? [q.debris] : [q.plants];
        const baseScale = kind === 'veg_moss' ? 4 : 1;
        const vs = new VegSet(kind, lods, scatter[kind], ranges, { castShadow: isTree || /rocks|stump|log/.test(kind), baseScale });
        scene.add(vs.group); W.vegSets.push(vs);
      } catch (err) { console.warn('veg', kind, err); }
      done++; prog(0.55 + 0.35 * done / kinds.length, 'forest');
    }
  }
  // trunk list for line-of-sight tests (trees only, LOD-independent)
  W.trunks = [];
  if (scatter) for (const k of Object.keys(scatter)) if (/fir|hemlock|snag/.test(k)) for (const p of scatter[k]) W.trunks.push([p[0], p[2], (/fir_c/.test(k) ? 1.0 : /fir_b/.test(k) ? 0.8 : 0.55) * p[4]]);
  W.trunkGrid = new Map();
  for (const t of W.trunks) { const k = Math.floor(t[0] / 20) + ',' + Math.floor(t[1] / 20); if (!W.trunkGrid.has(k)) W.trunkGrid.set(k, []); W.trunkGrid.get(k).push(t); }

  // --- distant fire glows (driven by the game)
  W.setFire = (name, intensity) => {
    const fs = (layout.fireSites || []).find((f) => f.name === name); if (!fs) return;
    let f = W.fires.get(name);
    if (!f) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff6a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.scale.set(220, 120, 1); s.position.set(...fs.position); scene.add(s);
      f = { sprite: s, base: new THREE.Vector3(...fs.position), target: 0, value: 0 }; W.fires.set(name, f);
    }
    f.target = intensity;
  };

  // --- per-frame
  let lodTimer = 0; const lastCam = new THREE.Vector3(1e9, 0, 0);
  W.update = (dt, t, cam) => {
    WIND.time.value = t; WIND.amount.value = engine.sky ? 0.25 + (engine.sky.weather.wind || 0) * 0.9 : 0.35;
    lodTimer -= dt;
    if (lodTimer <= 0 || cam.distanceToSquared(lastCam) > 16) {
      lodTimer = 0.35; lastCam.copy(cam);
      for (const c of chunks) { const d = Math.hypot(c.x - cam.x, c.z - cam.z); const near = d < engine.quality.terrainLod0; c.lod0.visible = near; c.lod1.visible = !near; }
      W.vegCounts = W.vegSets.map((v) => [v.kind, v.update(cam)]);
    }
    for (const f of W.fires.values()) {
      f.value += (f.target - f.value) * Math.min(1, dt * 0.5);
      const fl = 0.75 + 0.25 * Math.sin(t * 7.3 + f.base.x) * Math.sin(t * 3.1);
      f.sprite.material.opacity = clamp(f.value * fl, 0, 1); f.sprite.visible = f.value > 0.01;
    }
  };
  prog(0.95, 'world ready');
  return W;
}
