// FALSE LIGHT — sky & weather: HDRI sky dome blended across day/dusk/night, PMREM environment, sun/moon with a
// player-following shadow frustum, fog, rain streaks, lightning.
import * as THREE from 'three';
import { loadHDR } from './hdr.js?v=42224745';
import { clamp, smoothstep, lerp } from './util.js?v=42224745';

const KEYS = [   // hour -> which HDRI + light settings
  { h: 0, sky: 'night', exp: 0.55, sun: 0.035, sunCol: [0.55, 0.65, 0.9], fog: [0.012, 0.016, 0.022], env: 0.35, amb: 0.03 },
  { h: 5.2, sky: 'night', exp: 0.6, sun: 0.04, sunCol: [0.55, 0.65, 0.9], fog: [0.015, 0.02, 0.028], env: 0.35, amb: 0.035 },
  { h: 6.4, sky: 'dusk', exp: 0.55, sun: 0.9, sunCol: [1.0, 0.7, 0.5], fog: [0.33, 0.3, 0.32], env: 0.7, amb: 0.12 },
  { h: 8.5, sky: 'day', exp: 0.9, sun: 1.6, sunCol: [1.0, 0.96, 0.9], fog: [0.4, 0.44, 0.46], env: 1.0, amb: 0.25 },
  { h: 16.5, sky: 'day', exp: 0.9, sun: 1.5, sunCol: [1.0, 0.95, 0.88], fog: [0.4, 0.43, 0.46], env: 1.0, amb: 0.24 },
  { h: 19.0, sky: 'dusk', exp: 0.8, sun: 1.1, sunCol: [1.0, 0.62, 0.42], fog: [0.36, 0.3, 0.32], env: 0.75, amb: 0.14 },
  { h: 20.3, sky: 'dusk', exp: 0.28, sun: 0.25, sunCol: [0.7, 0.5, 0.55], fog: [0.1, 0.1, 0.13], env: 0.45, amb: 0.06 },
  { h: 21.4, sky: 'night', exp: 0.6, sun: 0.035, sunCol: [0.55, 0.65, 0.9], fog: [0.012, 0.016, 0.022], env: 0.35, amb: 0.03 },
  { h: 24, sky: 'night', exp: 0.55, sun: 0.035, sunCol: [0.55, 0.65, 0.9], fog: [0.012, 0.016, 0.022], env: 0.35, amb: 0.03 },
];

export async function createSky(engine, manifest, onProgress = () => {}) {
  const { scene, renderer } = engine;
  const pm = new THREE.PMREMGenerator(renderer);
  const want = { day: 'kloofendal_overcast_puresky', dusk: 'qwantani_dusk_2_puresky', night: 'rogland_moonlit_night' };
  const tex = {}, env = {};
  let k = 0;
  for (const [slot, name] of Object.entries(want)) {
    const p = manifest.hdri && manifest.hdri[name];
    try { tex[slot] = p ? await loadHDR('assets/' + p) : null; } catch (e) { console.warn('hdri', name, e); tex[slot] = null; }
    if (tex[slot]) env[slot] = pm.fromEquirectangular(tex[slot]).texture;
    onProgress(++k / 3);
  }
  const blank = new THREE.DataTexture(new Uint16Array([15360, 15360, 15360, 15360]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); blank.needsUpdate = true;
  // sky dome: blends two equirect HDRIs, fades into the fog colour at the horizon (aerial perspective)
  const U = {
    uA: { value: tex.day || blank }, uB: { value: tex.day || blank }, uMix: { value: 0 }, uExp: { value: 1 },
    uFog: { value: new THREE.Color() }, uFlash: { value: 0 }, uRot: { value: 0 }, uCloudDark: { value: 0 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: `uniform sampler2D uA; uniform sampler2D uB; uniform float uMix; uniform float uExp; uniform vec3 uFog; uniform float uFlash; uniform float uRot; uniform float uCloudDark;
      varying vec3 vDir;
      vec2 eq(vec3 d){ float u = atan(d.z, d.x) / 6.2831853 + 0.5 + uRot; float v = asin(clamp(d.y,-1.,1.)) / 3.14159265 + 0.5; return vec2(u, v); }
      void main(){ vec3 d = normalize(vDir); vec2 uv = eq(d);
        vec3 c = mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMix) * uExp * (1.0 - uCloudDark);
        float h = smoothstep(-0.02, 0.28, d.y);
        c = mix(uFog, c, h);
        c += vec3(0.75, 0.8, 1.0) * uFlash * (0.5 + 0.5 * h);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  dome.renderOrder = -10; dome.frustumCulled = false; dome.name = 'FL_sky';
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  const q = engine.quality;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  const sc = sun.shadow.camera; sc.near = 1; sc.far = 400; sc.left = sc.bottom = -q.shadowExtent; sc.right = sc.top = q.shadowExtent;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9aa8b8, 0x2a2620, 0.2); scene.add(hemi);
  scene.fog = new THREE.FogExp2(0x88939c, 0.004);

  // rain: streak particles in a box around the camera, wrapped in the vertex shader
  const N = 9000;
  const rp = new Float32Array(N * 2 * 3), rs = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 44 - 22, y = Math.random() * 30, z = Math.random() * 44 - 22;
    rp.set([x, y, z, x, y, z], i * 6); rs[i * 2] = 0; rs[i * 2 + 1] = 1;
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('seg', new THREE.BufferAttribute(rs, 1));
  const RU = { uT: engine.time, uCam: { value: new THREE.Vector3() }, uRain: { value: 0 }, uWind: { value: new THREE.Vector2(0.15, 0.05) }, uLight: { value: 0.3 } };
  const rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
    uniforms: RU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float seg; uniform float uT; uniform vec3 uCam; uniform vec2 uWind; uniform float uRain; varying float vA;
      void main(){ vec3 p = position; float sp = 9.0 + fract(p.x * 13.7) * 3.0; p.y = mod(p.y - uT * sp, 30.0);
        vec3 w = p - vec3(22.0, 0.0, 22.0); w.x = mod(w.x - uCam.x + 22.0, 44.0) - 22.0; w.z = mod(w.z - uCam.z + 22.0, 44.0) - 22.0;
        vec3 wp = vec3(uCam.x + w.x, uCam.y - 12.0 + p.y, uCam.z + w.z) + vec3(uWind.x, 0., uWind.y) * p.y * 0.3;
        wp += seg * vec3(uWind.x * 0.25, 0.42, uWind.y * 0.25);
        vA = step(fract(p.z * 7.13 + p.x * 3.1), uRain) * (0.35 + 0.65 * seg);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: 'uniform float uLight; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.6,0.65,0.7) * uLight, vA * 0.55); }',
  }));
  rain.frustumCulled = false; rain.name = 'FL_rain'; scene.add(rain);

  const S = {
    hour: 9, weather: { rain: 0, wind: 0.3, fog: 0.3, lightning: 0 }, sun, hemi, dome, tex, env,
    dayFactor: 1, flash: 0, _slot: null, rotation: 0.0,
    setTime(h) { S.hour = ((h % 24) + 24) % 24; },
    setWeather(w) { Object.assign(S.weather, w); },
    flashLightning() { S._strike = { t: 0, pulses: 1 + ((Math.random() * 3) | 0) }; engine.audio && engine.audio.thunder(1.2 + Math.random() * 3); },
    isDaylight() { return S.dayFactor > 0.35; },
    update(dt, t, cam) {
      const h = S.hour;
      let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
      const a = KEYS[i], b = KEYS[i + 1], f = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
      const L = (k) => lerp(a[k], b[k], f);
      const La = (k) => a[k].map((v, j) => lerp(v, b[k][j], f));
      // sky textures
      U.uA.value = tex[a.sky] || tex.day || blank; U.uB.value = tex[b.sky] || tex.day || blank; U.uMix.value = f;
      const storm = S.weather.rain * 0.7 + S.weather.fog * 0.2;
      U.uExp.value = L('exp') * (1 - storm * 0.55); U.uCloudDark.value = 0;
      S.dayFactor = clamp((L('sun') - 0.1) / 1.2, 0, 1);
      // environment: the closer keyframe's PMREM, intensity blended
      const slot = f < 0.5 ? a.sky : b.sky;
      if (slot !== S._slot && env[slot]) { scene.environment = env[slot]; S._slot = slot; }
      engine.setEnvIntensity(L('env') * (1 - storm * 0.4));
      // sun / moon direction: east at 6h, south at 12h, west at 18h; the moon by night
      const night = S.dayFactor < 0.1;
      const ang = ((night ? (h + 12) % 24 : h) - 6) / 12 * Math.PI;
      const el = Math.max(0.12, Math.sin(ang)) * (night ? 0.8 : 1);
      const dir = new THREE.Vector3(Math.cos(ang) * 0.9, el, 0.45).normalize();
      sun.position.copy(cam).addScaledVector(dir, 180); sun.target.position.copy(cam);
      sun.intensity = L('sun') * (1 - storm * 0.6);
      sun.color.setRGB(...La('sunCol'));
      hemi.intensity = L('amb') * (1 - storm * 0.3);
      // fog
      const fc = La('fog'); const fogCol = new THREE.Color(fc[0], fc[1], fc[2]).multiplyScalar(1 - storm * 0.35);
      scene.fog.color.copy(fogCol); U.uFog.value.copy(fogCol);
      scene.fog.density = 0.002 + S.weather.fog * 0.0075 + S.weather.rain * 0.003 + (night ? 0.002 : 0);
      // lightning
      if (S.weather.lightning > 0 && !S._strike && Math.random() < S.weather.lightning * dt) S.flashLightning();
      if (S._strike) {
        S._strike.t += dt; const st = S._strike;
        const pulse = st.t < 0.06 ? 1 : st.t < 0.12 ? 0.25 : st.t < 0.2 && st.pulses > 1 ? 0.8 : st.t < 0.32 && st.pulses > 2 ? 0.5 : 0;
        S.flash = pulse; if (st.t > 0.45) S._strike = null;
      } else S.flash = Math.max(0, S.flash - dt * 6);
      U.uFlash.value = S.flash * 1.5;
      if (S.flash > 0) { sun.intensity += S.flash * 2.5; sun.color.setRGB(0.8, 0.85, 1.0); hemi.intensity += S.flash * 0.8; }
      // rain
      RU.uCam.value.copy(cam); RU.uRain.value = S.weather.rain; RU.uLight.value = 0.12 + S.dayFactor * 0.4 + S.flash;
      RU.uWind.value.set(S.weather.wind * 1.2, S.weather.wind * 0.4); rain.visible = S.weather.rain > 0.01;
      if (engine.world && engine.world.terrainMaterial) engine.world.terrainMaterial.userData.uniforms.uWet.value = clamp(S.weather.rain * 1.3, 0, 1);
    },
  };
  return S;
}
