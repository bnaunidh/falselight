// FALSE LIGHT — post chain: scene -> HDR MSAA target -> bloom (mip chain) -> composite (AgX tone map, grain,
// vignette, chromatic edges, CO hallucination warp, fear, blackout) -> screen (sRGB).
import * as THREE from 'three';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function fsQuad(material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); m.frustumCulled = false;
  const s = new THREE.Scene(); s.add(m);
  return { scene: s, mesh: m, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

export function createPost(engine) {
  const { renderer } = engine;
  const q = engine.quality;
  const size = new THREE.Vector2();
  const mk = (w, h, samples = 0) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
  let main = mk(4, 4, q.msaa ? 4 : 0);
  const mips = [];
  const NM = 5;
  for (let i = 0; i < NM; i++) mips.push({ down: mk(4, 4), up: mk(4, 4) });
  const P = {
    co: 0, fear: 0, blackout: 0, pulse: 0, cold: 0, heat: 0, hurt: 0, exposure: 1.0, bloom: 0.55, grain: 0.055, time: 0, saturation: 1.0, contrast: 1.04,
    set(o) { Object.assign(P, o); },
  };
  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.);
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.,-1.)).rgb; c += texture2D(tSrc, vUv + uTexel * vec2(1.,-1.)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.,1.)).rgb;  c += texture2D(tSrc, vUv + uTexel * vec2(1.,1.)).rgb;
        c *= 0.25;
        if (uThreshold > 0.0) { float l = dot(c, vec3(0.2126,0.7152,0.0722)); c *= smoothstep(uThreshold, uThreshold * 2.2, l); c = min(c, vec3(40.)); }
        gl_FragColor = vec4(c, 1.); }`,
  });
  const upMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uHasPrev: { value: 0 } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uHasPrev; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 0.5;
        if (uHasPrev > 0.5) { vec3 p = vec3(0.);
          p += texture2D(tPrev, vUv + uTexel * vec2(-1., 0.)).rgb; p += texture2D(tPrev, vUv + uTexel * vec2(1., 0.)).rgb;
          p += texture2D(tPrev, vUv + uTexel * vec2(0., -1.)).rgb; p += texture2D(tPrev, vUv + uTexel * vec2(0., 1.)).rgb;
          c += p * 0.25; }
        gl_FragColor = vec4(c, 1.); }`,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.5 }, uExp: { value: 1 }, uTime: { value: 0 },
      uGrain: { value: 0.05 }, uCO: { value: 0 }, uFear: { value: 0 }, uBlack: { value: 0 }, uPulse: { value: 0 }, uCold: { value: 0 }, uHeat: { value: 0 }, uHurt: { value: 0 }, uRes: { value: new THREE.Vector2() },
      uSat: { value: 1 }, uCon: { value: 1.04 },
    },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uExp; uniform float uTime;
      uniform float uGrain; uniform float uCO; uniform float uFear; uniform float uBlack; uniform vec2 uRes; uniform float uSat; uniform float uCon;
      uniform float uPulse; uniform float uCold; uniform float uHeat; uniform float uHurt;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // AgX (Blender's / three's), approximated with the published polynomial
      vec3 agxContrast(vec3 x){ vec3 x2 = x*x; vec3 x4 = x2*x2;
        return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
      vec3 agx(vec3 c){
        const mat3 inM = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336,
          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
        const mat3 outM = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
          -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
        c = inM * max(c, vec3(1e-10));
        c = clamp(log2(c), -12.47393, 4.026069); c = (c + 12.47393) / 16.49999;
        c = agxContrast(c); c = outM * c;
        c = pow(max(vec3(0.), c), vec3(2.2)); return c; }
      void main(){
        vec2 uv = vUv;
        // carbon monoxide: slow breathing warp + doubled edges; fear: tunnel + pulse
        if (uCO > 0.001) {
          float t = uTime * 0.35;
          uv += uCO * 0.006 * vec2(sin(uv.y * 7.0 + t * 2.1), cos(uv.x * 6.0 - t * 1.7));
        }
        // the heartbeat: every beat squeezes the view a hair (only when scared or hurt); heat: the air shimmers
        float thump = uPulse * (uFear + uHurt * 0.8);
        uv = 0.5 + (uv - 0.5) * (1.0 - thump * 0.006);
        if (uHeat > 0.001) { float t = uTime; vec2 q = uv - 0.5; uv += uHeat * (0.0012 + dot(q, q) * 0.006) * vec2(sin(uv.y * 38.0 + t * 5.3) + 0.5 * sin(uv.y * 91.0 - t * 7.1), sin(uv.x * 29.0 + t * 4.2)); }
        vec2 d = uv - 0.5; float r2 = dot(d, d);
        float ca = 0.0003 + r2 * 0.0016 + uCO * 0.004 + uFear * 0.002 + thump * 0.004 + uHurt * r2 * 0.01;   // a whisper of lens fringe: more painted red/blue pixels on every needle edge
        vec3 c;
        c.r = texture2D(tScene, uv - d * ca).r; c.g = texture2D(tScene, uv).g; c.b = texture2D(tScene, uv + d * ca).b;
        if (uCO > 0.2) { vec3 ghost = texture2D(tScene, uv + vec2(0.012 * sin(uTime * 0.6), 0.004) * uCO).rgb; c = mix(c, max(c, ghost), 0.35 * uCO); }
        c += texture2D(tBloom, uv).rgb * uBloom;
        c *= uExp;
        c = agx(c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat * (1.0 - uCO * 0.45) * (1.0 - uHurt * 0.55) * (1.0 - uCold * 0.3) * (1.0 - uFear * 0.25));
        c *= mix(vec3(1.0), vec3(0.88, 0.97, 1.1), uCold);                  // cold: the colour drains toward blue
        c *= mix(vec3(1.0), vec3(1.1, 0.97, 0.84), uHeat);                  // heat: everything goes amber
        c = mix(c, c * vec3(1.05, 0.5, 0.45), uHurt * smoothstep(0.1, 0.4, r2) * (0.35 + 0.25 * uPulse));   // hurt: the edges bleed red, in time
        c = (c - 0.5) * uCon + 0.5;
        float fv = uFear + thump * 0.35 + uHurt * 0.3; float vig = smoothstep(0.95, 0.25 - fv * 0.2, sqrt(r2) * (1.0 + fv * 0.6));
        c *= mix(0.55, 1.0, vig);
        float g = hash(vUv * uRes + fract(uTime * 13.1)) - 0.5;
        c += g * uGrain * (0.25 + 0.45 * (1.0 - l));
        c *= 1.0 - uBlack;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const quad = fsQuad(downMat);
  function resize(w, h, pr) {
    const W = Math.max(4, Math.floor(w * pr)), H = Math.max(4, Math.floor(h * pr));
    main.setSize(W, H);
    let mw = W, mh = H;
    for (const m of mips) { mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1); m.down.setSize(mw, mh); m.up.setSize(mw, mh); }
    compMat.uniforms.uRes.value.set(W, H);
  }
  function pass(mat, target) { quad.mesh.material = mat; renderer.setRenderTarget(target); renderer.render(quad.scene, quad.cam); }
  return {
    params: P,
    get target() { return main; },
    set(o) { Object.assign(P, o); },
    resize,
    rebuild(msaa) { const w = main.width, h = main.height; main.dispose(); main = mk(w, h, msaa ? 4 : 0); },
    render(scene, camera, dt) {
      P.time += dt;
      renderer.setRenderTarget(main); renderer.render(scene, camera);
      // bloom
      let src = main.texture, sw = main.width, sh = main.height;
      for (let i = 0; i < NM; i++) {
        downMat.uniforms.tSrc.value = src; downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh); downMat.uniforms.uThreshold.value = i === 0 ? 1.1 : 0;
        pass(downMat, mips[i].down); src = mips[i].down.texture; sw = mips[i].down.width; sh = mips[i].down.height;
      }
      let prev = null;
      for (let i = NM - 1; i >= 0; i--) {
        upMat.uniforms.tSrc.value = mips[i].down.texture; upMat.uniforms.tPrev.value = prev; upMat.uniforms.uHasPrev.value = prev ? 1 : 0;
        upMat.uniforms.uTexel.value.set(1 / mips[i].up.width, 1 / mips[i].up.height);
        pass(upMat, mips[i].up); prev = mips[i].up.texture;
      }
      const u = compMat.uniforms;
      u.tScene.value = main.texture; u.tBloom.value = prev; u.uBloom.value = P.bloom; u.uExp.value = P.exposure; u.uTime.value = P.time;
      u.uGrain.value = P.grain; u.uCO.value = P.co; u.uFear.value = P.fear; u.uBlack.value = P.blackout; u.uPulse.value = P.pulse; u.uCold.value = P.cold; u.uHeat.value = P.heat; u.uHurt.value = P.hurt; u.uSat.value = P.saturation; u.uCon.value = P.contrast;
      pass(compMat, null);
    },
    // grade + tone map an arbitrary HDR target into an 8-bit canvas-ready target (used by photo capture)
    compositeTo(srcTarget, outTarget) {
      const u = compMat.uniforms; const save = { b: u.uBloom.value, co: u.uCO.value, f: u.uFear.value, bl: u.uBlack.value, g: u.uGrain.value, pu: u.uPulse.value, cd: u.uCold.value, ht: u.uHeat.value, hu: u.uHurt.value };
      u.uPulse.value = 0; u.uCold.value = 0; u.uHeat.value = 0; u.uHurt.value = 0;   // a photograph shows the world, not how you felt
      u.tScene.value = srcTarget.texture; u.tBloom.value = srcTarget.texture; u.uBloom.value = 0.0; u.uCO.value = 0; u.uFear.value = 0; u.uBlack.value = 0; u.uGrain.value = 0;
      pass(compMat, outTarget);
      u.uBloom.value = save.b; u.uCO.value = save.co; u.uFear.value = save.f; u.uBlack.value = save.bl; u.uGrain.value = save.g; u.uPulse.value = save.pu; u.uCold.value = save.cd; u.uHeat.value = save.ht; u.uHurt.value = save.hu;
    },
  };
}
