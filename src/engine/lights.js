// FALSE LIGHT — the tower searchlight (spot + volumetric beam + operator mode), the flashlight, the cab lamp,
// and the camera flash pulse.
import * as THREE from 'three';
import { clamp, damp } from './util.js?v=39bbb9d6';

// The searchlight beam: light scattered by haze inside the cone. Each pixel the cone covers gets ONE fragment (front faces
// from outside, back faces from inside) and works out analytically how much beam its view ray crosses: the ray's closest
// approach to the axis and the chord it cuts through the cone. So the beam reads from the side AND straight down its
// length from behind the lamp (the old rim-lit shell vanished from the operator's own view).
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uPow: { value: 1 }, uT: { value: 0 }, uDen: { value: 0.02 }, uGain: { value: 2.5 }, uLen: { value: 320 }, uR0: { value: 0.28 }, uR1: { value: 18 },
      uO: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3(0, 0, -1) }, uCol: { value: new THREE.Color(1.0, 0.94, 0.82) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
    vertexShader: `varying vec3 vW;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uPow; uniform float uT; uniform float uDen; uniform float uGain; uniform float uLen; uniform float uR0; uniform float uR1;
      uniform vec3 uO; uniform vec3 uD; uniform vec3 uCol; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - ro), w0 = ro - uO;
        float b = dot(rd, uD), d = dot(rd, w0), e = dot(uD, w0), den = max(1.0 - b * b, 1e-5);
        float sc = max((b * e - d) / den, 0.0);                 // along the view ray: closest approach to the axis
        vec3 pr = ro + rd * sc;
        float tc = dot(pr - uO, uD);                            // along the beam
        if (tc <= 0.0) discard;
        float along = clamp(tc / uLen, 0.0, 1.0);
        float R = mix(uR0, uR1, along);
        float dist = length(pr - (uO + uD * tc));
        float sinT = sqrt(den);
        float path = min(2.0 * sqrt(max(R * R - dist * dist, 0.0)) / max(sinT, 0.06), uLen * (1.0 - along) + 2.0 * R);
        float soft = 1.0 - smoothstep(0.55 * R, R, dist);
        float fall = exp(-along * 2.4) * (0.12 + 0.88 * smoothstep(0.0, 0.06, along));   // the lens glow covers the first metres
        vec3 q = pr * 0.08 + vec3(0.0, -uT * 0.22, uT * 0.1);
        float dust = 0.6 + 0.4 * n3(q) * n3(q * 2.3 + 4.1);
        float a = (1.0 - exp(-path * uDen)) * soft * fall * dust * uPow;
        gl_FragColor = vec4(uCol * a * uGain, 1.0); }`,
  });
}

const _cp = new THREE.Vector3();
export function createLights(engine) {
  const { scene, camera } = engine;
  const W = engine.world;
  const q = engine.quality;
  // ---------------- searchlight
  const spot = new THREE.SpotLight(0xfff0d8, 0, 650, THREE.MathUtils.degToRad(3.2), 0.35, 1.0);
  spot.castShadow = q.spotShadows; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 1.5; spot.shadow.camera.far = 650; spot.shadow.bias = -0.0002;
  scene.add(spot, spot.target);
  const yawObj = W.searchlight.yaw, pitchObj = W.searchlight.pitch;
  const origin = new THREE.Object3D();
  if (pitchObj) { pitchObj.add(origin); origin.position.set(0, 0, -0.45); }
  else { origin.position.set(2.6, 31.3, 2.6); scene.add(origin); }
  const beam = new THREE.Group();
  const beamLen = 320, bm = beamMaterial();
  {
    const g = new THREE.CylinderGeometry(22, 0.34, beamLen, 48, 1, true); g.rotateX(-Math.PI / 2); g.translate(0, 0, -beamLen / 2);
    const m = new THREE.Mesh(g, bm); m.frustumCulled = false; m.renderOrder = 5; beam.add(m);
  }
  origin.add(beam);
  // the lens itself glows when the lamp is lit (so you can always tell it's on)
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.25, 'rgba(255,236,200,.7)'); gr.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.position.set(0, 0, -0.08); glow.scale.set(1.1, 1.1, 1); glow.renderOrder = 6; origin.add(glow);
  const SL = {
    on: false, power: 1, yaw: 0, pitch: -0.12, operating: false,
    object: origin, spot, beam,
    setAim(y, p) { SL.yaw = y; SL.pitch = clamp(p, -0.85, 0.35); },
    aimAt(v) {
      const o = new THREE.Vector3(); (yawObj || origin).getWorldPosition(o);
      const d = new THREE.Vector3().subVectors(v, o);
      SL.setAim(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    },
    worldOrigin() { const v = new THREE.Vector3(); origin.getWorldPosition(v); return v; },
    worldDir() { const v = new THREE.Vector3(0, 0, -1); return v.transformDirection(origin.matrixWorld); },
    isLit(p, losOpts) {
      if (!SL.on || SL.power <= 0.05) return false;
      const o = SL.worldOrigin(), d = SL.worldDir();
      const to = new THREE.Vector3().subVectors(p, o); const dist = to.length();
      if (dist > 600) return false;
      const ang = to.angleTo(d);
      if (ang > spot.angle * (1 + spot.penumbra * 0.5) + 0.004) return false;
      return engine.view.lineOfSight(o, p, losOpts);
    },
  };
  function applyAim() {
    if (yawObj && pitchObj) { yawObj.rotation.set(0, SL.yaw, 0); pitchObj.rotation.set(SL.pitch, 0, 0); }
    else { origin.rotation.set(SL.pitch, SL.yaw, 0, 'YXZ'); }
  }
  // ---------------- flashlight (camera-mounted)
  const flash = new THREE.SpotLight(0xffe6c0, 0, 45, THREE.MathUtils.degToRad(20), 0.6, 1.6);
  flash.castShadow = q.flashShadows; flash.shadow.mapSize.set(512, 512); flash.shadow.camera.near = 0.2; flash.shadow.bias = -0.0005;
  camera.add(flash); flash.position.set(0.12, -0.075, -0.34); flash.target.position.set(0.02, -0.04, -4); camera.add(flash.target);   // at the lens of the torch in your hand, so it lights the path, not the torch
  const FL = {
    on: false, battery: 1, light: flash,
    isLit(p) {
      if (!FL.on) return false;
      const o = new THREE.Vector3(); flash.getWorldPosition(o); const d = new THREE.Vector3(); camera.getWorldDirection(d);
      const to = new THREE.Vector3().subVectors(p, o); if (to.length() > 30) return false;
      return to.angleTo(d) < flash.angle && engine.view.lineOfSight(o, p);
    },
  };
  // ---------------- cab lamp
  const lampPos = (W.anchors.get('LIGHT_cab_lamp') || new THREE.Vector3(1.05, 32.1, -0.45));
  const lamp = new THREE.PointLight(0xffb070, 0, 9, 1.8); lamp.position.copy(lampPos); lamp.castShadow = q.lampShadows; lamp.shadow.mapSize.set(512, 512); lamp.shadow.bias = -0.002;
  scene.add(lamp);
  const LAMP = { on: false, light: lamp, flicker: 0 };
  // ---------------- camera flash
  const cf = new THREE.PointLight(0xf4f6ff, 0, 60, 1.4); camera.add(cf); cf.position.set(0, 0.12, -0.1);
  let cfT = 1;
  const api = {
    searchlight: SL, flashlight: FL, cabLamp: LAMP,
    cameraFlash() { cfT = 0; engine.audio && engine.audio.play('flash_whine', { volume: 0.4 }); },
    flashAge() { return cfT; },
    update(dt, t) {
      // searchlight operator mode: mouse aims the lamp, the view rides along
      if (SL.operating) {
        const [mx, my] = engine.input.consumeMouse();
        SL.setAim(SL.yaw - mx * 0.0012, SL.pitch - my * 0.0012);
      }
      applyAim();
      origin.updateWorldMatrix(true, false);
      const o = SL.worldOrigin(), d = SL.worldDir();
      spot.position.copy(o); spot.target.position.copy(o).addScaledVector(d, 50);
      const flick = SL.power < 0.35 ? (0.75 + 0.25 * Math.sin(t * 43) * Math.sin(t * 17)) : 1;
      const I = SL.on ? SL.power * flick : 0;
      spot.intensity = damp(spot.intensity, I * 6.5e4, 18, dt);
      spot.visible = true; spot.shadow.autoUpdate = spot.intensity > 1;   // never toggle visibility: a light-count change recompiles every material (multi-second freeze)
      beam.visible = I > 0.02; bm.uniforms.uPow.value = damp(bm.uniforms.uPow.value, I, 18, dt); bm.uniforms.uT.value = t;
      const sky = engine.sky, day = sky ? sky.dayFactor : 0, wx = sky ? sky.weather : { fog: 0.3, rain: 0 };
      bm.uniforms.uDen.value = 0.012 + wx.fog * 0.03 + wx.rain * 0.03;                 // haze in the air
      bm.uniforms.uGain.value = 2.6 * (1 - 0.8 * day);                                  // against a daylit sky it barely registers
      bm.uniforms.uO.value.copy(o); bm.uniforms.uD.value.copy(d);
      // camera inside the cone: draw its back faces instead (one fragment per pixel either way)
      const cp = camera.getWorldPosition(_cp), tcc = _cp.sub(o).dot(d);
      const inside = tcc > 0 && _cp.addScaledVector(d, -tcc).length() < 0.34 + (22 - 0.34) * Math.min(1, tcc / beamLen) + 0.2;
      const side = inside ? THREE.BackSide : THREE.FrontSide; if (bm.side !== side) { bm.side = side; bm.needsUpdate = true; }
      glow.visible = I > 0.02; glow.material.opacity = Math.min(1, I * 1.2);
      flash.intensity = FL.on ? 130 * (0.5 + 0.5 * FL.battery) : 0; flash.shadow.autoUpdate = FL.on;
      LAMP.flicker = damp(LAMP.flicker, 0, 3, dt);
      lamp.intensity = LAMP.on ? 3.2 * (1 - LAMP.flicker * (0.5 + 0.5 * Math.sin(t * 60))) : 0;
      cfT += dt; cf.intensity = cfT < 0.05 ? 2600 : cfT < 0.25 ? 2600 * Math.exp(-(cfT - 0.05) * 22) : 0;
    },
  };
  return api;
}
