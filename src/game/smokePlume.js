// FALSE LIGHT — a distant fire's smoke column: ~110 camera-facing puffs in ONE instanced draw, born at the fire, rising and
// drifting downwind, growing and thinning into a leaning plume. Coloured relative to the horizon sky (the fog colour), so
// the brown-grey base reads dark against the haze at noon and it all sinks into the dusk. No scene fog (it's kilometres
// out); its own haze instead.
import * as THREE from 'three';

function puffTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.sqrt(dx * dx + dy * dy);
    let n = 0, a = 0.5, f = 3; for (let o = 0; o < 4; o++) { n += a * noise(x / S * f + o * 7.3, y / S * f + o * 3.1); a *= 0.5; f *= 2; }
    const edge = Math.max(0, 1 - r * (1.05 + 0.5 * (n - 0.5)));
    const al = Math.pow(edge, 1.6) * (0.55 + 0.9 * n);
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.max(0, Math.min(255, al * 255));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export function createPlume(scene, opts = {}) {
  const N = opts.count || 110, LIFE = opts.life || 150;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index; geo.setAttribute('position', quad.attributes.position); geo.setAttribute('uv', quad.attributes.uv);
  const aOff = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3), aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);   // size, alpha, shade, rot
  aOff.setUsage(THREE.DynamicDrawUsage); aP.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', aOff); geo.setAttribute('aP', aP); geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { tPuff: { value: puffTexture() }, uFogCol: { value: new THREE.Color(0.4, 0.44, 0.46) }, uSun: { value: new THREE.Color(1, 0.95, 0.88) }, uDay: { value: 1 }, uOpacity: { value: 0 }, uHaze: { value: 0.1 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec3 aOff; attribute vec4 aP; varying vec2 vUv; varying float vA; varying float vShade;
      void main(){ vUv = uv; vA = aP.y; vShade = aP.z;
        float c = cos(aP.w), s = sin(aP.w); vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aP.x;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = aOff + right * q.x + up * q.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: `uniform sampler2D tPuff; uniform vec3 uFogCol; uniform vec3 uSun; uniform float uDay; uniform float uOpacity; uniform float uHaze;
      varying vec2 vUv; varying float vA; varying float vShade;
      void main(){ float t = texture2D(tPuff, vUv).a; float a = min(1.0, t * 1.5) * vA * uOpacity; if (a < 0.003) discard;
        // albedo: sooty brown-grey at the fire, pale grey-white aloft; lit relative to the horizon sky, sun-warmed on top
        vec3 alb = mix(vec3(0.2, 0.17, 0.14), vec3(0.62, 0.6, 0.58), vShade);
        vec3 col = alb * uFogCol * (1.1 + 0.3 * vShade) + uSun * alb * 0.04 * uDay * vShade;
        col = mix(col, uFogCol, uHaze);
        gl_FragColor = vec4(col, a); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'FL_smoke_plume'; mesh.visible = false;
  scene.add(mesh);
  const src = new THREE.Vector3();
  const P = Array.from({ length: N }, (_, i) => ({ age: (i / N) * LIFE, seed: Math.random() * 1000, x: 0, y: 0, z: 0 }));
  const order = P.map((_, i) => i), dist = new Float32Array(N);
  const wind = new THREE.Vector3(opts.windX ?? 3.4, 0, opts.windZ ?? 1.2);   // m/s, drifting east-south-east
  function place(p) {
    const k = p.age / LIFE, rise = 860 * (1 - Math.pow(1 - k, 1.7)) + 90 * k;   // quick at first, then slowing into a spreading cap
    const lean = Math.pow(k, 1.35) * LIFE;
    const wob = Math.sin(p.seed + p.age * 0.05) * (8 + 60 * k);
    p.x = src.x + wind.x * lean + Math.cos(p.seed) * (10 + 90 * k) + wob;
    p.y = src.y + 4 + rise;
    p.z = src.z + wind.z * lean + Math.sin(p.seed * 1.7) * (6 + 60 * k);
  }
  const api = {
    mesh, opacity: 0,
    setSource(v) { src.copy(v); for (const p of P) place(p); },
    update(dt, camera, fogColor, sunColor, day) {
      if (!mesh.visible) return;
      mat.uniforms.uOpacity.value = api.opacity; if (fogColor) mat.uniforms.uFogCol.value.copy(fogColor); if (sunColor) mat.uniforms.uSun.value.copy(sunColor); mat.uniforms.uDay.value = day ?? 1;
      const cp = camera.position;
      for (let i = 0; i < N; i++) { const p = P[i]; p.age += dt; if (p.age > LIFE) { p.age -= LIFE; p.seed = Math.random() * 1000; } place(p); dist[i] = (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2; }
      order.sort((a, b) => dist[b] - dist[a]);   // back to front
      const O = aOff.array, Q = aP.array;
      for (let j = 0; j < N; j++) {
        const p = P[order[j]], k = p.age / LIFE;
        O[j * 3] = p.x; O[j * 3 + 1] = p.y; O[j * 3 + 2] = p.z;
        Q[j * 4] = 70 + 300 * Math.pow(k, 0.75);                                         // size (m)
        Q[j * 4 + 1] = Math.min(1, p.age / 5) * Math.pow(1 - k, 0.85);           // alpha: in fast, out slow
        Q[j * 4 + 2] = Math.min(1, k * 1.8);                                             // shade: dark base -> pale aloft
        Q[j * 4 + 3] = p.seed + p.age * 0.004;                                           // slow roll
      }
      aOff.needsUpdate = true; aP.needsUpdate = true;
    },
  };
  return api;
}
