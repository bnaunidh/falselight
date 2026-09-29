// FALSE LIGHT — engine assembly (contract §3). createEngine -> loadWorld -> start. Also stepFrames for headless tests.
import * as THREE from 'three';
import { createInput } from './input.js?v=18bc18106d93c298';
import { createWorld, loadGLB } from './world.js?v=f72bf2c303254cc4';
import { createPlayer } from './player.js?v=1dc0031345c6950f';
import { createSky } from './sky.js?v=68a95a40cff6b4bd';
import { createLights } from './lights.js?v=792a7514929cb178';
import { createPost } from './post.js?v=44767cb562821303';
import { createEntities, createView, createInteract } from './entities.js?v=b5bcb59c17f83bbc';
import { createAudio } from './audio.js?v=7ce46a68a1f43df1';
import { createPhoto } from './photo.js?v=d4ecc9fcde07cf48';
import { createMountains } from './mountains.js?v=6559f3372d4228da';
import { loadq, tryTakeJSON } from './loadq.js?v=3479c8521344c615';
import { createStream, PRIO } from './stream.js?v=f7881cfe4ef01982';
import {QUALITY,qualityName,applyQualityResources} from './quality.js?v=da7ec5f545e60526';
export {QUALITY} from './quality.js?v=da7ec5f545e60526';

export async function createEngine(canvas, opts = {}) {
  const qname = qualityName(opts.quality);
  const quality = { ...QUALITY[qname] };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.05, 12000);
  scene.add(camera);
  const E = {
    renderer, scene, camera, quality, qualityName: qname, requestedQuality:qname, adaptive: true, _pr: null, msaa: quality.msaa, manifest: { models: {}, data: {}, textures: {}, hdri: {} },
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
    const pr = E._pr || Math.min(window.devicePixelRatio || 1, quality.pr) * (E.saving && E.saving() ? 0.8 : 1);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    E.post && E.post.resize(w, h, pr);
  }
  window.addEventListener('resize', resize);

  // Resolves once the title's set (stream stage A) is built; everything else keeps downloading in the background, most
  // urgent first, and E.stream.ready(stage) says when a stage is in (src/engine/stream.js).
  E.loadWorld = async (onProgress = () => {}) => {
    E.manifest = (await tryTakeJSON('assets/manifest.json?v=5d122f86c17e86ec', PRIO.A)) || E.manifest;   // (the site build stamps this URL with ?v=<hash>)
    loadq.setFiles(E.manifest.files);
    const S = E.stream = createStream(E.manifest);
    const layout = null;   // (the plan reads the prop list from the manifest on the site; the dev server loads on demand)
    S.plan(layout, quality.terrainTex);
    for (const [st, path] of S.models) S.track(st, loadGLB(path, PRIO[st]));   // parsed as soon as it arrives: a stage is 'in' when its models are ready to use
    const bar = (f, label) => onProgress(Math.min(0.97, 0.88 * S.progress('A') + 0.1 * f), label);   // mostly bytes: it never freezes on one big file
    E.world = await createWorld(E, E.manifest, bar, S);
    E.sky = await createSky(E, E.manifest, (f) => bar(0.95, 'sky'), S);
    E.mountains = createMountains(E);   // the distant Cascades (FL_mountains) + a night-sky band; updates itself via E.onUpdate
    E.view = createView(E);
    E.lights = createLights(E);
    E.entities = createEntities(E);
    E.interact = createInteract(E);
    E.player = createPlayer(E);
    E.post = createPost(E);
    E.photo = createPhoto(E);
    applyQualityResources(E);
    resize();
    E.player.teleport('SP_stair_foot');
    S.seal();
    onProgress(1, 'ready');
    return E.world;
  };

  // ---------------------------------------------------------------- loop
  let last = performance.now(), running = false, lastRAF = 0, fpsAcc = 0, fpsN = 0, lastStep = 0;
  // Battery: frames are capped (a 120 Hz screen would otherwise draw twice as often for nothing), menus / the title draw at
  // 30, the pause screen at ~6, and on battery (saver 'auto' + unplugged, or 'on') the game runs at 30 with a lower resolution.
  E.fpsCap = 60; E.idle = false; E.saverMode = 'auto'; E.onBattery = false;
  E.saving = () => E.saverMode === 'on' || (E.saverMode === 'auto' && E.onBattery);
  E.frameCap = () => (E.paused ? 6 : E.idle ? 30 : E.saving() ? 30 : E.fpsCap || 0);
  try { navigator.getBattery && navigator.getBattery().then((b) => { const f = () => { const was = E.saving(); E.onBattery = !b.charging; if(E.requestedQuality==='max'&&E.setQuality)E.setQuality('max');else if (was !== E.saving()) { E._pr = null; resize(); } }; f(); b.addEventListener('chargingchange', f); }).catch(() => {}); } catch (e) { /* no battery API: charging reminder stays in Settings */ }
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
    const cap = E.frameCap();
    if (cap > 0 && now - lastStep < 1000 / cap - 1.5) return;   // skip this vsync: we're ahead of the cap
    lastStep = now;
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
        const target = Math.min(60, E.frameCap() || 60);   // judge speed against the cap (30 fps on battery isn't 'slow')
        slowS = E.fps < target * 0.66 ? slowS + 1 : 0; fastS = E.fps > target * 0.95 ? fastS + 1 : 0;
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
    // (never in a real hidden tab: that just burns battery; the Claude pane / headless tests are 'visible' but get no rAF)
    setInterval(() => { if (running && performance.now() - lastRAF > 250 && (document.visibilityState === 'visible' || E.noRender)) step(performance.now()); }, 33);
  };
  E.setPaused = (b) => { E.paused = b; };
  E.resize = resize;
  E.stepFrames = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { if (!E.paused) tick(dt); } render(dt); last = performance.now(); };
  E.setQuality = (name) => {
    E.requestedQuality=qualityName(name);
    const effective=E.requestedQuality==='max'&&E.onBattery?'medium':E.requestedQuality;
    Object.assign(quality,{spotMap:1024,flashMap:512,lampMap:512,grain:.055},QUALITY[effective]);E.qualityName=effective;
    E._pr=null;E._pendingPr=null;slowS=fastS=0;applyQualityResources(E);resize();
  };
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
