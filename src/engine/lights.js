// FALSE LIGHT — the tower searchlight (spot + volumetric beam + operator mode), the flashlight, the cab lamp,
// and the camera flash pulse.
import * as THREE from 'three';
import { clamp, damp } from './util.js?v=cb2ac382';

function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uPow: { value: 1 }, uT: { value: 0 }, uFog: { value: 0.4 }, uLen: { value: 320 }, uCol: { value: new THREE.Color(1.0, 0.94, 0.82) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
      void main(){ vAlong = -position.z; vec4 wp = modelMatrix * vec4(position,1.); vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uPow; uniform float uT; uniform float uFog; uniform float uLen; uniform vec3 uCol;
      varying vec3 vN; varying vec3 vV; varying float vAlong; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = clamp(vAlong / uLen, 0.0, 1.0);
        float fall = exp(-along * 3.2) * smoothstep(0.0, 0.015, along);
        vec3 q = vW * 0.09 + vec3(0.0, -uT * 0.25, uT * 0.12);
        float dust = 0.55 + 0.45 * n3(q) * n3(q * 2.3 + 4.1);
        float a = edge * fall * dust * uPow * (0.05 + uFog * 0.16);
        gl_FragColor = vec4(uCol * a, a); }`,
  });
}

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
  for (const [r0, r1, k] of [[0.3, 20, 1.0], [0.25, 12, 0.8], [0.2, 6.5, 0.65]]) {
    const g = new THREE.CylinderGeometry(r1, r0, beamLen, 40, 24, true); g.rotateX(-Math.PI / 2); g.translate(0, 0, -beamLen / 2);
    const m = new THREE.Mesh(g, bm); m.frustumCulled = false; m.renderOrder = 5; m.scale.set(1, 1, 1);
    beam.add(m);
  }
  origin.add(beam);
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
  const flash = new THREE.SpotLight(0xffe6c0, 0, 38, THREE.MathUtils.degToRad(19), 0.55, 1.6);
  flash.castShadow = q.flashShadows; flash.shadow.mapSize.set(512, 512); flash.shadow.camera.near = 0.2; flash.shadow.bias = -0.0005;
  camera.add(flash); flash.position.set(0.18, -0.2, 0.05); flash.target.position.set(0.05, -0.05, -3); camera.add(flash.target);
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
      spot.intensity = damp(spot.intensity, I * 9.0e4, 18, dt);
      spot.visible = true; spot.shadow.autoUpdate = spot.intensity > 1;   // never toggle visibility: a light-count change recompiles every material (multi-second freeze)
      beam.visible = I > 0.02; bm.uniforms.uPow.value = damp(bm.uniforms.uPow.value, I, 18, dt); bm.uniforms.uT.value = t;
      bm.uniforms.uFog.value = engine.sky ? clamp(0.35 + engine.sky.weather.fog * 0.6 + engine.sky.weather.rain * 0.5 - engine.sky.dayFactor * 0.6, 0.05, 1.3) : 0.5;
      flash.intensity = FL.on ? 40 * (0.5 + 0.5 * FL.battery) : 0; flash.shadow.autoUpdate = FL.on;
      LAMP.flicker = damp(LAMP.flicker, 0, 3, dt);
      lamp.intensity = LAMP.on ? 3.2 * (1 - LAMP.flicker * (0.5 + 0.5 * Math.sin(t * 60))) : 0;
      cfT += dt; cf.intensity = cfT < 0.05 ? 2600 : cfT < 0.25 ? 2600 * Math.exp(-(cfT - 0.05) * 22) : 0;
    },
  };
  return api;
}
