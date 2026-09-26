// FALSE LIGHT — the distant Cascades seen from the lookout: five receding ridge layers from 3 to 11 km, Rainier NNE,
// St. Helens SSW (1983: horseshoe crater, grey blast zone), Adams ESE. One mesh, one draw call, 138k triangles (+ a 1.5k
// triangle night-sky band, a second draw only while the night HDRI shows).
//
// Shape lives in mountainsShape.js (pure, node-tested). This file wraps it for three.js and shades it:
//   * sun/moon Lambert + sky ambient taken from the engine's own sky (the dome's HDRI stats, env intensity, fog colour)
//   * snow above a noisy snowline, only where the slope holds it; rock on steep ground, forest below the tree line
//   * aerial perspective: exponential valley fog (thick below the cab, thin above it) + a thin air haze, both
//     converging on the colour the sky dome draws behind the fragment, so far ranges pale into the sky and never show
//     an edge; near the terrain edge it switches to three's FogExp2 on the view depth, exactly what the terrain gets
// Not a collider, not a raycast target, no shadows, fog:false (it does its own), frustumCulled off (it rings the camera).
// A second, tiny draw (the night band, below) paints a clean sky over the rocky hill baked into the night HDRI.
import * as THREE from 'three';
import { buildMountains, skyBandTable, MOUNTAINS } from './mountainsShape.js?v=f6619665';

const VS = /* glsl */`
attribute vec4 aInfo;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vInfo;
varying float vFogDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vInfo = aInfo;
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */`
uniform vec3 uSunDir;      // toward the sun (or the moon at night)
uniform vec3 uSunCol;      // colour * intensity of the engine's sun light
uniform vec3 uAmbSky;      // sky irradiance on an up-facing surface (HDRI mean * env intensity + hemi)
uniform vec3 uAmbGround;
uniform vec3 uFogCol;      // scene fog colour == the dome's horizon colour
uniform vec3 uSkyHor;      // HDRI horizon / zenith averages * dome exposure
uniform vec3 uSkyZen;
uniform vec3 uHazeTint;
uniform float uFlash;
uniform float uSigmaAir;   // air haze extinction, 1/m
uniform float uValleyDen;  // valley fog extinction at uValleyRef, 1/m
uniform float uValleyRef;
uniform float uValleyH;    // valley fog scale height, m
uniform float uSceneFog;   // scene.fog.density (FogExp2)
uniform vec4 uBox;         // terrain mesh box: centre xz, half size xz
uniform float uEdgeFade;
uniform float uLowSun;
uniform float uSnowLine;
uniform float uTreeLine;
uniform float uWet;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vInfo;
varying float vFogDepth;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the sky dome's colour in direction d, minus its HDRI texture detail (sky.js: mix(uFog, hdri * exp, smoothstep(-.02,.28,y)))
vec3 skyColor(vec3 d) {
  float h = smoothstep(-0.02, 0.28, d.y);
  vec3 c = mix(uFogCol, mix(uSkyHor, uSkyZen, smoothstep(0.05, 0.9, d.y)), h);
  return c + vec3(0.75, 0.8, 1.0) * uFlash * (0.5 + 0.5 * h);
}

void main() {
  vec3 N = normalize(vN);
  vec3 P = vWorld;
  vec3 V = P - cameraPosition;
  float dist = length(V);
  vec3 dir = V / dist;
  float snowBias = vInfo.x * 1600.0 - 800.0;
  float rockA = vInfo.y;
  float below = vInfo.z * 1530.0;       // metres under the highest ground within ~1.6 km along this bearing
  float ash = vInfo.w;

  // --- surface: detail noise faded out once it would alias (fwidth = metres per pixel)
  float fp = length(fwidth(P.xz)) + 1e-3;
  float n0 = vnoise(P.xz / 420.0 + 3.7);
  float n1 = mix(0.5, vnoise(P.xz / 90.0), 1.0 - smoothstep(30.0, 70.0, fp));
  float n2 = mix(0.5, vnoise(P.xz / 23.0 + 11.3), 1.0 - smoothstep(8.0, 18.0, fp));
  float slope = 1.0 - N.y;
  vec3 forest = vec3(0.020, 0.029, 0.021) * (0.65 + 0.7 * n1) * (0.8 + 0.4 * n2);
  vec3 meadow = vec3(0.058, 0.056, 0.038) * (0.8 + 0.4 * n2);
  vec3 rock = vec3(0.105, 0.098, 0.090) * (0.7 + 0.6 * n2);
  vec3 ashC = mix(vec3(0.165, 0.155, 0.145), vec3(0.06, 0.055, 0.052), rockA) * (0.8 + 0.4 * n1);   // pumice / crater rock
  float tl = uTreeLine + (n0 - 0.5) * 300.0 + (n1 - 0.5) * 80.0;
  float trees = 1.0 - smoothstep(tl - 90.0, tl + 60.0, P.y);
  float steep = smoothstep(0.34, 0.55, slope + (n2 - 0.5) * 0.12);
  vec3 alb = mix(mix(meadow, rock, 0.55 + 0.45 * steep), forest, trees * (1.0 - 0.8 * steep));
  alb = mix(alb, rock, rockA * (1.0 - ash));
  alb = mix(alb, ashC, ash);
  alb *= 1.0 - 0.25 * uWet;
  // snow above a noisy line, held on gentle and north-facing (-z) slopes, shed by steep rock
  float sl = uSnowLine - snowBias + N.z * 150.0 - (n0 - 0.5) * 180.0 - (n1 - 0.5) * 160.0 - (n2 - 0.5) * 60.0;
  float snow = smoothstep(sl - 40.0, sl + 40.0, P.y) * (1.0 - smoothstep(0.40, 0.60, slope + (n2 - 0.5) * 0.18));
  snow *= 1.0 - smoothstep(0.35, 0.8, rockA);                          // cleavers and crater walls stay bare
  alb = mix(alb, vec3(0.74, 0.77, 0.83) * (0.9 + 0.2 * n2), snow);

  // --- light: Lambert sun/moon, low sun only reaching what the ridge in front does not shade, sky ambient + occlusion
  float ndl = max(dot(N, uSunDir), 0.0);
  float reach = 1800.0 * uSunDir.y / max(length(uSunDir.xz), 1e-3);
  float vis = 1.0 - smoothstep(reach * 0.6, reach * 1.4 + 40.0, below);
  float ao = 1.0 - 0.5 * smoothstep(0.0, 600.0, below);
  vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y) * ao;
  // with the sun low, slopes turned away from it only see the dim, blue half of the sky
  float away = uLowSun * clamp(-dot(N.xz, normalize(uSunDir.xz + 1e-5)), 0.0, 1.0);
  amb *= mix(vec3(1.0), vec3(0.5, 0.62, 0.95), away);
  vec3 col = alb * (uSunCol * (ndl * vis * 0.31831) + amb);
  // warm rim: the last ~80 m under a crest glows when the low sun sits right behind it (light through the treetops)
  float back = pow(max(dot(dir, uSunDir), 0.0), 8.0);
  float rim = (1.0 - smoothstep(0.0, 80.0, below)) * pow(1.0 - clamp(dot(N, -dir), 0.0, 1.0), 2.0);
  col += uSunCol * back * rim * uLowSun * (0.22 * trees + 0.06);

  // --- aerial perspective
  float yc = cameraPosition.y;
  float tauA = uSigmaAir * dist;
  float k = clamp((P.y - yc) / uValleyH, -40.0, 80.0);
  float integ = abs(k) < 1e-3 ? 1.0 : (1.0 - exp(-k)) / k;
  float tauV = uValleyDen * dist * exp(clamp((uValleyRef - yc) / uValleyH, -40.0, 40.0)) * integ;
  float T = exp(-(tauA + tauV));
  vec3 sky = skyColor(dir);
  vec3 haze = mix(sky * uHazeTint, sky, 1.0 - exp(-tauA));      // bluish at middle distance, the sky itself far off
  vec3 inC = (tauA * haze + tauV * uFogCol) / max(tauA + tauV, 1e-6);
  vec3 phys = col * T + inC * (1.0 - T);
  // near the terrain edge: exactly the FogExp2 the terrain itself gets, so the seam cannot show
  vec2 q = abs(P.xz - uBox.xy) - uBox.zw;
  float de = length(max(q, 0.0));
  float fs = 1.0 - exp(-uSceneFog * uSceneFog * vFogDepth * vFogDepth);
  vec3 sceneC = mix(col, uFogCol, fs);
  gl_FragColor = vec4(mix(sceneC, phys, smoothstep(0.0, uEdgeFade, de)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- night band
// sky.js's night HDRI (rogland_moonlit_night) is not a pure sky: a rocky, bushy hill rises to 21.3° (bearing 95°) across
// bearings ~10-155°, so boulders hung in the sky right above the ranges. This band redraws the dome below 29.5° with the
// dome's own formula (same textures, blend, exposure, fog curve, flash), except that wherever a slot holds the night
// HDRI, that texture is swapped below 28° for a clean sky: per azimuth, the HDRI's own colour at 23.5-28° (star-free:
// texels above 1.25x the column median are dropped; the moon's halo stays), crossfading back to the real texture between
// 22.3° and 28° (the moon disc sits at 29.4-30.9°, untouched). Because it replaces only the night texture's share, the
// dusk <-> night crossfades stay exact. Same sphere as the dome (same directions per pixel), drawn at the far plane in
// the transparent pass with depth test on, so it only lands where the sky shows (early-z skips the terrain / ranges).
// Visible only while the night texture is in the blend; off when the dome masks that band itself (a `uNightW` uniform on
// the dome) and with opts.nightBand === false.
const BAND_COLS = 128, BAND_EL = [-6, 0, 8, 16, 22, 26, 29.5];   // degrees; the swap is 0 from 28° up
const BAND_VS = /* glsl */`
attribute vec3 aSky;
varying vec3 vDir;
varying vec3 vSky;
void main() {
  vDir = position;
  vSky = aSky;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const BAND_FS = /* glsl */`
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uExp;
uniform float uCloudDark;
uniform vec3 uFog;
uniform float uFlash;
uniform float uRot;
uniform float uANight;   // 1 when that dome slot holds the night HDRI
uniform float uBNight;
varying vec3 vDir;
varying vec3 vSky;
vec2 eq(vec3 d) { float u = atan(d.z, d.x) / 6.2831853 + 0.5 + uRot; float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5; return vec2(u, v); }
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = eq(d);
  float sw = 1.0 - smoothstep(0.38, 0.47, d.y);
  vec3 a = mix(texture2D(uA, uv).rgb, vSky, uANight * sw);
  vec3 b = mix(texture2D(uB, uv).rgb, vSky, uBNight * sw);
  vec3 c = mix(a, b, uMix) * uExp * (1.0 - uCloudDark);
  float h = smoothstep(-0.02, 0.28, d.y);
  c = mix(uFog, c, h);
  c += vec3(0.75, 0.8, 1.0) * uFlash * (0.5 + 0.5 * h);
  gl_FragColor = vec4(c, 1.0);
}`;

/** skyBandTable() on a sky.js / hdr.js texture (half-float or float RGBA DataTexture). */
export function bandTable(tex, cols = BAND_COLS) {
  const img = tex && tex.image, D = img && img.data;
  if (!D || !img.width || !img.height) return null;
  const W = img.width, ch = D.length >= W * img.height * 4 ? 4 : 3;
  const dec = D instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (v) => v;
  return skyBandTable(W, img.height, (x, y, o) => { const k = (y * W + x) * ch; o[0] = dec(D[k]); o[1] = dec(D[k + 1]); o[2] = dec(D[k + 2]); }, cols);
}

function createNightBand(radius) {
  const nr = BAND_EL.length, nc = BAND_COLS + 1;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(nc * nr * 3), sky = new Float32Array(nc * nr * 3), idx = [];
  for (let j = 0; j < nr - 1; j++) for (let i = 0; i < BAND_COLS; i++) { const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1; idx.push(a, b, c, b, d, c); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSky', new THREE.BufferAttribute(sky, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  const uniforms = {
    uA: { value: null }, uB: { value: null }, uMix: { value: 0 }, uExp: { value: 1 }, uCloudDark: { value: 0 }, uFog: { value: new THREE.Color() },
    uFlash: { value: 0 }, uRot: { value: 0 }, uANight: { value: 0 }, uBNight: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: BAND_VS, fragmentShader: BAND_FS, side: THREE.DoubleSide,
    transparent: true, blending: THREE.NoBlending, depthWrite: false, depthTest: true, fog: false, lights: false,
  });
  material.forceSinglePass = true;   // three draws transparent DoubleSide in two passes otherwise (a 3rd draw call)
  material.name = 'FL_mountains_nightband';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'FL_mountains_nightband';
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -9;          // first among the transparents (it overwrites the dome): glows, smoke, rain draw over it
  mesh.visible = false;
  mesh.raycast = () => {};
  mesh.userData.noCollide = true; mesh.userData.noRaycast = true;
  let rot = NaN, table = null;
  return {
    mesh, uniforms, geo, material,
    get table() { return table; },
    // directions: column i sits where sky.js's eq() reads texture u = i / BAND_COLS (so the table never depends on uRot)
    place(uRot) {
      if (uRot === rot) return;
      rot = uRot;
      for (let j = 0; j < nr; j++) {
        const e = BAND_EL[j] * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e);
        for (let i = 0; i < nc; i++) {
          const phi = (i / BAND_COLS - 0.5 - uRot) * 2 * Math.PI, k = (j * nc + i) * 3;
          pos[k] = radius * ce * Math.cos(phi); pos[k + 1] = radius * se; pos[k + 2] = radius * ce * Math.sin(phi);
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
    fill(t) {
      table = t;
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const c = i % BAND_COLS, k = (j * nc + i) * 3;
        sky[k] = t.rgb[c * 3]; sky[k + 1] = t.rgb[c * 3 + 1]; sky[k + 2] = t.rgb[c * 3 + 2];
      }
      geo.attributes.aSky.needsUpdate = true;
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}

const FALLBACK_STATS = { horizon: [1, 1, 1], zenith: [1, 1, 1], mean: [1, 1, 1] };   // sky.js's blank 1x1 texture is 1.0
const statsOf = (tex) => (tex && tex.userData && tex.userData.stats) || FALLBACK_STATS;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the terrain MESH extent: world.js builds 64 m chunks from W.rect.min and overruns rect.max to the next chunk
export function terrainBox(W) {
  const ch = W && W.terrain && W.terrain.chunks;
  if (ch && ch.length > 1) {
    const xs = [...new Set(ch.map((c) => c.x))].sort((a, b) => a - b), zs = [...new Set(ch.map((c) => c.z))].sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < xs.length; i++) step = Math.min(step, xs[i] - xs[i - 1]);
    for (let i = 1; i < zs.length; i++) step = Math.min(step, zs[i] - zs[i - 1]);
    if (Number.isFinite(step)) return { minX: xs[0] - step / 2, maxX: xs[xs.length - 1] + step / 2, minZ: zs[0] - step / 2, maxZ: zs[zs.length - 1] + step / 2 };
  }
  const r = (W && W.rect) || { min: [-420, -420], max: [420, 520] };
  return { minX: r.min[0], maxX: r.max[0], minZ: r.min[1], maxZ: r.max[1] };
}

/**
 * createMountains(engine, opts?) -> { group, mesh, band, material, uniforms, stats, config, box, update(dt, t), dispose() }
 * Call after engine.world exists (needs heightAt, rect/terrain chunks, layout.fireSites). engine.sky is read lazily in
 * update(), so it may be created before or after. The group (FL_mountains) is added to engine.scene unless
 * opts.addToScene === false. opts.config overrides MOUNTAINS fields; opts.box overrides the terrain box.
 * Per frame: update() registers itself with engine.onUpdate (runs after sky.update in engine.js tick) unless
 * opts.autoUpdate === false; calling update() yourself as well is harmless (it only copies sky state).
 * world.js's old horizon ring (FL_horizon) is hidden if it is still in the scene (it would poke through the ranges);
 * opts.hideHorizon === false keeps it. opts.nightBand === false turns the night-sky band off (setNightBand() at runtime).
 */
export function createMountains(engine, opts = {}) {
  const W = engine.world || {};
  const fires = ((W.layout && W.layout.fireSites) || []).filter((f) => f && f.position).map((f) => ({ x: f.position[0], y: f.position[1], z: f.position[2] }));
  const box = opts.box || terrainBox(W);
  const M = buildMountains({ heightAt: W.heightAt, box, fires, config: opts.config });
  const cfg = M.config;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(M.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(M.normals, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(M.info, 4, true));
  geo.setIndex(new THREE.BufferAttribute(M.index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), cfg.rOut + 3000);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-cfg.rOut, -200, -cfg.rOut), new THREE.Vector3(cfg.rOut, 3200, cfg.rOut));

  const U = {
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() }, uSunCol: { value: new THREE.Color(1.5, 1.45, 1.35) },
    uAmbSky: { value: new THREE.Color(0.9, 0.95, 1.05) }, uAmbGround: { value: new THREE.Color(0.08, 0.08, 0.07) },
    uFogCol: { value: new THREE.Color(0.4, 0.44, 0.46) }, uSkyHor: { value: new THREE.Color(0.7, 0.75, 0.83) }, uSkyZen: { value: new THREE.Color(0.9, 1.0, 1.27) },
    uHazeTint: { value: new THREE.Color(0.74, 0.9, 1.25) },
    uFlash: { value: 0 }, uSigmaAir: { value: 0.0001 }, uValleyDen: { value: 0.004 }, uValleyRef: { value: -40 }, uValleyH: { value: 20 },
    uSceneFog: { value: 0.004 },
    uBox: { value: new THREE.Vector4((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, (box.maxX - box.minX) / 2, (box.maxZ - box.minZ) / 2) },
    uEdgeFade: { value: 1500 }, uLowSun: { value: 0 }, uSnowLine: { value: cfg.snowLine }, uTreeLine: { value: cfg.treeLine }, uWet: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, fog: false, lights: false });
  material.extensions.derivatives = true;   // fwidth() on a WebGL1 context (WebGL2 has it built in)
  material.name = 'FL_mountains';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'FL_mountains_mesh';
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.renderOrder = 1;               // after the default opaques: the terrain/tower/trees in front reject its fragments early
  mesh.matrixAutoUpdate = false;
  mesh.userData.noCollide = true; mesh.userData.noRaycast = true;
  mesh.raycast = () => {};           // never a pick / line-of-sight target, whatever list it ends up in
  const group = new THREE.Group();
  group.name = 'FL_mountains';
  group.matrixAutoUpdate = false;
  group.add(mesh);
  const domeGeo = engine.sky && engine.sky.dome && engine.sky.dome.geometry, domeR = domeGeo && domeGeo.parameters && domeGeo.parameters.radius;
  const band = opts.nightBand === false ? null : createNightBand(opts.skyRadius || domeR || 9000);   // the dome's own sphere
  if (band) group.add(band.mesh);
  let bandFor = null, bandOn = false, bandEnabled = !!band;
  // the table (a few ms) is built when the night texture is first seen: at load when the sky already exists (the normal
  // order in engine.js loadWorld), else on the first frame that has it
  const bandFill = (nt) => { if (bandFor !== nt) { bandFor = nt; const tb = bandTable(nt); if (tb) band.fill(tb); } };
  if (band && engine.sky && engine.sky.tex && engine.sky.tex.night) bandFill(engine.sky.tex.night);

  const tmp = new THREE.Vector3();
  const mix3 = (out, a, b, t, s) => out.setRGB((a[0] + (b[0] - a[0]) * t) * s, (a[1] + (b[1] - a[1]) * t) * s, (a[2] + (b[2] - a[2]) * t) * s);
  function envIntensity(sky) {
    const m = W.terrainMaterial;
    if (m && m.isMeshStandardMaterial) return m.envMapIntensity / (m.userData.envBase || 1);
    return 0.35 + 0.65 * (sky ? sky.dayFactor : 1);
  }

  function update() {
    const sky = engine.sky, fog = engine.scene && engine.scene.fog;
    if (fog) { U.uSceneFog.value = fog.density || 0; U.uFogCol.value.copy(fog.color); }
    if (!sky) return;
    const sun = sky.sun, w = sky.weather || {};
    if (sun) {
      tmp.copy(sun.position).sub(sun.target.position);
      if (tmp.lengthSq() > 1e-6) U.uSunDir.value.copy(tmp.normalize());
      U.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
    }
    const du = sky.dome && sky.dome.material && sky.dome.material.uniforms;
    const env = envIntensity(sky);
    bandOn = false;
    if (du) {
      U.uFogCol.value.copy(du.uFog.value);
      const a = statsOf(du.uA.value), b = statsOf(du.uB.value), m = du.uMix.value;
      const ex = du.uExp.value * (1 - (du.uCloudDark ? du.uCloudDark.value : 0));
      // night band: weight of the night HDRI in the dome's blend
      const nt = sky.tex && sky.tex.night;
      if (band && bandEnabled && nt && !du.uNightW) {
        const an = du.uA.value === nt ? 1 : 0, bn = du.uB.value === nt ? 1 : 0;
        if (an * (1 - m) + bn * m > 0.001) {
          bandFill(nt);
          if (band.table) {
            const BU = band.uniforms, rot = du.uRot ? du.uRot.value : 0;
            band.place(rot);
            BU.uA.value = du.uA.value; BU.uB.value = du.uB.value; BU.uMix.value = m; BU.uExp.value = du.uExp.value;
            BU.uCloudDark.value = du.uCloudDark ? du.uCloudDark.value : 0; BU.uFog.value.copy(du.uFog.value);
            BU.uFlash.value = du.uFlash ? du.uFlash.value : 0; BU.uRot.value = rot; BU.uANight.value = an; BU.uBNight.value = bn;
            bandOn = true;
          }
        }
      }
      if (band) band.mesh.visible = bandOn;
      // the haze converges on what the dome shows at the horizon: with the band on, that is the band, not the rocks
      const bt = bandOn ? band.table.mean : null;
      mix3(U.uSkyHor.value, bt && du.uA.value === bandFor ? bt : a.horizon, bt && du.uB.value === bandFor ? bt : b.horizon, m, ex);
      mix3(U.uSkyZen.value, a.zenith, b.zenith, m, ex);
      // ambient on an up-facing surface ~ the cosine-weighted sky: between the hemisphere mean and the zenith
      U.uAmbSky.value.setRGB(
        (0.5 * (a.mean[0] + a.zenith[0]) * (1 - m) + 0.5 * (b.mean[0] + b.zenith[0]) * m) * env,
        (0.5 * (a.mean[1] + a.zenith[1]) * (1 - m) + 0.5 * (b.mean[1] + b.zenith[1]) * m) * env,
        (0.5 * (a.mean[2] + a.zenith[2]) * (1 - m) + 0.5 * (b.mean[2] + b.zenith[2]) * m) * env);
      U.uFlash.value = du.uFlash ? du.uFlash.value : 0;
    }
    if (sky.hemi) {
      const hi = sky.hemi.intensity / Math.PI;
      U.uAmbSky.value.r += sky.hemi.color.r * hi; U.uAmbSky.value.g += sky.hemi.color.g * hi; U.uAmbSky.value.b += sky.hemi.color.b * hi;
      const g = sky.hemi.groundColor, s = U.uAmbSky.value;
      U.uAmbGround.value.setRGB(g.r * hi + s.r * 0.06, g.g * hi + s.g * 0.06, g.b * hi + s.b * 0.06);
    } else U.uAmbGround.value.copy(U.uAmbSky.value).multiplyScalar(0.08);
    const f = w.fog || 0, rain = w.rain || 0, night = (sky.dayFactor != null ? sky.dayFactor : 1) < 0.1;
    U.uSigmaAir.value = 0.00006 + f * 0.00012 + rain * 0.0006;
    U.uValleyDen.value = (0.002 + f * 0.007) * (night ? 1.4 : 1);
    U.uValleyRef.value = -55 + f * 50 + (night ? 8 : 0);
    U.uValleyH.value = 20 + f * 20;
    U.uLowSun.value = 1 - smooth(0.12, 0.5, U.uSunDir.value.y);
    U.uWet.value = Math.min(1, rain * 1.3);
  }
  update();
  if (opts.addToScene !== false && engine.scene) engine.scene.add(group);
  // world.js's old horizon ring, if the line that adds it is still there: it rises through the valleys between ranges
  const oldHorizon = opts.hideHorizon === false || !engine.scene ? null : engine.scene.getObjectByName('FL_horizon');
  const oldHorizonVis = oldHorizon ? oldHorizon.visible : true;
  if (oldHorizon) oldHorizon.visible = false;
  // per frame, after sky.update (engine.js tick runs the onUpdate callbacks after sky/lights/world)
  let offUpdate = opts.autoUpdate !== false && typeof engine.onUpdate === 'function' ? engine.onUpdate(update) : null;

  return {
    group, mesh, band: band ? band.mesh : null, material, uniforms: U, stats: M.stats, config: cfg, box,
    update,
    /** A/B switch for the night band (the preview page's N key); takes effect on the next update(). */
    setNightBand(on) { bandEnabled = !!band && !!on; },
    dispose() {
      if (offUpdate) { offUpdate(); offUpdate = null; }   // once only: engine.js's off() splices index -1 if called twice
      if (oldHorizon) oldHorizon.visible = oldHorizonVis;
      if (group.parent) group.parent.remove(group);
      geo.dispose(); material.dispose(); if (band) band.dispose();
    },
  };
}

export { MOUNTAINS };
