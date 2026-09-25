// FALSE LIGHT — instant-camera capture: render the player's view square, tone map it, then an instant-film grade
// (lifted blacks, cyan shadows / warm highlights, soft focus, flash hot-spot + falloff, chemistry blotches, grain).
import * as THREE from 'three';

export function createPhoto(engine) {
  const { renderer, scene } = engine;
  const S = 1024;
  const hdr = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: engine.msaa ? 4 : 0 });
  const ldr = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace });
  const film = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: ldr.texture }, uFlash: { value: 0 }, uSeed: { value: 0 }, uNight: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D tSrc; uniform float uFlash; uniform float uSeed; uniform float uNight; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 uv = vUv; vec2 d = uv - 0.5; float r = length(d);
        // soft focus: small blur growing to the edges
        vec3 c = vec3(0.); float tot = 0.; float rad = 0.0012 + r * 0.004;
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec2 o = vec2(cos(a), sin(a)) * rad; c += texture2D(tSrc, uv + o).rgb; tot += 1.; }
        c = mix(texture2D(tSrc, uv).rgb, c / tot, 0.6);
        // film response
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, 0.82);
        c = c * 0.86 + 0.06;                                  // lifted blacks, rolled highlights
        c *= mix(vec3(0.86, 0.97, 1.02), vec3(1.07, 1.0, 0.86), smoothstep(0.1, 0.8, l));   // cyan shadows, warm highs
        // flash: hot centre, fast falloff, darker edges
        c *= mix(1.0, 1.35 - r * 1.3, uFlash);
        c *= 1.0 - smoothstep(0.35, 0.75, r) * (0.45 + 0.25 * uNight);
        // chemistry: faint uneven development + grain
        c *= 0.94 + 0.08 * n2(uv * 6.0 + uSeed);
        c += (h(uv * 1024.0) - 0.5) * 0.05;
        gl_FragColor = vec4(clamp(c, 0., 1.), 1.); }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S; const ctx = canvas.getContext('2d');
  const px = new Uint8Array(S * S * 4);
  let n = 0;
  return {
    async capture({ flash = false } = {}) {
      const cam = engine.camera.clone(); cam.aspect = 1; cam.fov = 58; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      cam.userData.zoom = 1;
      if (flash) { engine.lights.cameraFlash(); engine.lights.update(0, engine.time.value); }
      renderer.setRenderTarget(hdr); renderer.render(scene, cam);
      engine.post.compositeTo(hdr, ldr);
      mat.uniforms.uFlash.value = flash ? 1 : 0; mat.uniforms.uSeed.value = (n++ * 17.31) % 97; mat.uniforms.uNight.value = engine.sky ? 1 - engine.sky.dayFactor : 0;
      renderer.setRenderTarget(film); renderer.render(qs, qc);
      renderer.readRenderTargetPixels(film, 0, 0, S, S, px);
      renderer.setRenderTarget(null);
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      ctx.putImageData(img, 0, 0);
      const out = document.createElement('canvas'); out.width = out.height = S; out.getContext('2d').drawImage(canvas, 0, 0);
      const entities = [...engine.entities.list].map((h) => ({ kind: h.kind, id: h.id, pose: h.pose, ...engine.view.check(h, cam) }));
      return { image: out, dataURL: out.toDataURL('image/jpeg', 0.86),
        meta: { time: engine.sky ? engine.sky.hour : 0, pos: cam.position.toArray(), dir: cam.getWorldDirection(new THREE.Vector3()).toArray(), flash, entities } };
    },
  };
}
