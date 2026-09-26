// FALSE LIGHT — engine assembly (contract §3). createEngine -> loadWorld -> start. Also stepFrames for headless tests.
import * as THREE from 'three';
import { createInput } from './input.js?v=8547b0d4';
import { createWorld } from './world.js?v=8547b0d4';
import { createPlayer } from './player.js?v=8547b0d4';
import { createSky } from './sky.js?v=8547b0d4';
import { createLights } from './lights.js?v=8547b0d4';
import { createPost } from './post.js?v=8547b0d4';
import { createEntities, createView, createInteract } from './entities.js?v=8547b0d4';
import { createAudio } from './audio.js?v=8547b0d4';
import { createPhoto } from './photo.js?v=8547b0d4';
import { createMountains } from './mountains.js?v=8547b0d4';
import { tryJSON } from './util.js?v=8547b0d4';

export const QUALITY = {
  low: { pr: 0.75, prMin: 0.5, msaa: false, aniso: 4, shadowMap: 1024, shadowExtent: 35, treeLod0: 28, treeLod1: 90, treeLod2: 800, plants: 28, debris: 60, terrainLod0: 90, spotShadows: false, flashShadows: false, lampShadows: false, terrainTex: 512 },
  // medium is meant to look properly good: full-ish resolution with MSAA, sharp textures at grazing angles, real shadows
  medium: { pr: 1.3, prMin: 0.8, msaa: true, aniso: 8, shadowMap: 2048, shadowExtent: 55, treeLod0: 44, treeLod1: 150, treeLod2: 1500, plants: 50, debris: 110, terrainLod0: 150, spotShadows: true, flashShadows: false, lampShadows: false, terrainTex: 1024 },
  high: { pr: 1.75, prMin: 0.9, msaa: true, aniso: 16, shadowMap: 4096, shadowExtent: 70, treeLod0: 60, treeLod1: 200, treeLod2: 2000, plants: 70, debris: 150, terrainLod0: 200, spotShadows: true, flashShadows: true, lampShadows: true, terrainTex: 1024 },
};

export async function createEngine(canvas, opts = {}) {
  const qname = opts.quality || 'high';
  const quality = { ...QUALITY[qname] };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 12000);
  scene.add(camera);
  const E = {
    renderer, scene, camera, quality, qualityName: qname, adaptive: true, _pr: null, msaa: quality.msaa, manifest: { models: {}, data: {}, textures: {}, hdri: {} },
    time: { value: 0 }, paused: false, uiBlocking: false, frame: 0, fps: 0,
    _cbs: [], onUpdate(fn) { E._cbs.push(fn); return () => { const i = E._cbs.indexOf(fn); if (i >= 0) E._cbs.splice(i, 1); }; },
  };
  E.input = createInput(canvas);
  E.audio = createAudio(E);
  // env intensity applied to every standard material (r160 has no scene.environmentIntensity)
  let envMats = [], envCount = -1, envVal = 1;
  let envRecount = 0;
  E.setEnvIntensity = (v) => {
    envVal = v;
    let c = envCount;
    if (performance.now() > envRecount) { envRecount = performance.now() + 2000; c = 0; scene.traverse(() => c++); }
    if (c !== envCount) { envCount = c; envMats = []; const seen = new Set(); scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m && m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); if (m.userData.envBase == null) m.userData.envBase = m.envMapIntensity; envMats.push(m); } }); }
    for (const m of envMats) m.envMapIntensity = v * m.userData.envBase;
  };
  E.setEnvCheap = () => { envCount = -1; };

  function resize() {
    const w = canvas.clientWidth || window.innerWidth || 1440, h = canvas.clientHeight || window.innerHeight || 810;
    const pr = E._pr || Math.min(window.devicePixelRatio || 1, quality.pr);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    E.post && E.post.resize(w, h, pr);
  }
  window.addEventListener('resize', resize);

  E.loadWorld = async (onProgress = () => {}) => {
    E.manifest = (await tryJSON('assets/manifest.json')) || E.manifest;
    E.world = await createWorld(E, E.manifest, (f, l) => onProgress(f * 0.85, l));
    E.sky = await createSky(E, E.manifest, (f) => onProgress(0.85 + f * 0.1, 'sky'));
    E.mountains = createMountains(E);   // the distant Cascades (FL_mountains) + a night-sky band; updates itself via E.onUpdate
    E.view = createView(E);
    E.lights = createLights(E);
    E.entities = createEntities(E);
    E.interact = createInteract(E);
    E.player = createPlayer(E);
    E.post = createPost(E);
    E.photo = createPhoto(E);
    resize();
    E.player.teleport('SP_stair_foot');
    onProgress(1, 'ready');
    return E.world;
  };

  // ---------------------------------------------------------------- loop
  let last = performance.now(), running = false, lastRAF = 0, fpsAcc = 0, fpsN = 0;
  function tick(dt) {
    E.time.value += dt;
    const t = E.time.value;
    E.player.update(dt);
    E.sky.update(dt, t, camera.position);
    E.lights.update(dt, t);
    E.world.update(dt, t, camera.position);
    for (const f of E._cbs.slice()) f(dt, t);
    E.interact.update();
    E.audio.update(dt);
    E.frame++;
  }
  function render(dt) { if (E.noRender) return; renderer.info.reset(); E.post.render(scene, camera, dt); }
  function frame(now) {
    if (!running) return;
    lastRAF = now;
    requestAnimationFrame(frame);
    step(now);
  }
  // Adaptive resolution. Resizing clears the canvas, so a new size is applied BEFORE the frame renders (resizing after the
  // render showed a blank frame = the screen flashed), and only after sustained slow / fast seconds so it can't flip-flop.
  let slowS = 0, fastS = 0, lastDrop = -1e9;
  function step(now) {
    const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
    if (E._pendingPr) { E._pr = E._pendingPr; E._pendingPr = null; resize(); }
    if (E.paused) { render(0); return; }
    tick(dt); render(dt);
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 1.0) {
      E.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      if (E.adaptive && !E.paused) {
        const pr = renderer.getPixelRatio(), max = Math.min(window.devicePixelRatio || 1, quality.pr);
        slowS = E.fps < 40 ? slowS + 1 : 0; fastS = E.fps > 57 ? fastS + 1 : 0;
        let np = pr;
        if (slowS >= 3) { np = Math.max(quality.prMin || 0.5, pr - 0.1); slowS = 0; lastDrop = now; }
        else if (fastS >= 12 && now - lastDrop > 45000) { np = Math.min(max, pr + 0.05); fastS = 0; }
        if (Math.abs(np - pr) > 0.01) E._pendingPr = np;
      }
    }
  }
  E.start = () => {
    if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame);
    // hidden panes throttle rAF to nothing: keep the world alive at ~30 Hz if frames stop arriving
    setInterval(() => { if (running && performance.now() - lastRAF > 250) step(performance.now()); }, 33);
  };
  E.setPaused = (b) => { E.paused = b; };
  E.resize = resize;
  E.stepFrames = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { if (!E.paused) tick(dt); } render(dt); last = performance.now(); };
  E.setQuality = (name) => { Object.assign(quality, QUALITY[name]); E.qualityName = name; E._pr = null; resize(); };
  E.debug = {
    teleport(name) { return E.player.teleport(name); },
    fly(b) { E.player.fly = b; E.player.freeRoam = b; },
    stats() {
      const i = renderer.info; return { fps: Math.round(E.fps), calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures,
        pos: E.player.position.toArray().map((v) => +v.toFixed(2)), zone: E.player.zone, veg: E.world.vegCounts };
    },
  };
  resize();
  return E;
}
