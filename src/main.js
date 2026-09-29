// FALSE LIGHT — boot: engine → title menu → world (streamed) → game → play. window.__fl exposes test hooks.
// Loading on slow Wi-Fi (src/engine/stream.js): index.html paints the title before any script; the menu works as soon as
// the engine exists; the live backdrop fades in once the title's set is in (stage A); New game / Continue wait only for
// stage B (the cab, the trailhead, the item templates: the game is built then); the rest of the forest streams in during
// day 1, and the day-1 clock holds before dusk until the night (stage D) is in.
import { createEngine } from './engine/engine.js?v=8f8ca431b18b3fda';
import { createUI } from './ui/ui.js?v=3714ae20e380a639';
import { Game } from './game/bridge.js?v=2360f77ff48e1e64';
import { createSaves } from './game/saves.js?v=9b2daabbbb6263ff';
import { UI as WORDS } from './game/content/story.js?v=6c8a01b774ad2f1c';
import { ACTIONS, keyName } from './engine/input.js?v=18bc18106d93c298';
import { registerAnimalSounds } from './engine/animalSounds.js?v=98d47a28f0d0689d';
import { registerScareSounds } from './engine/scareSounds.js?v=03d6d9f843586f50';
import { paintCabMaps } from './ui/cabMaps.js?v=136aa42d94fcba49';
import { loadq } from './engine/loadq.js?v=3479c8521344c615';
import { watchUpdates } from './engine/updates.js?v=ae8a658deea46809';

const canvas = document.getElementById('c');
const q = new URLSearchParams(location.search);
const saves = createSaves();
const settings = saves.settings({ quality: 'medium', sens: 1, volume: 0.8, music: 0.35, sound: false, fullscreen: true, keys: {}, fps: 60, saver: 'auto' });
{ const D = { sens: 1, volume: 0.8, music: 0.35, fps: 60 };   // a bad save (NaN from a half-filled form) must never zero the mouse or the volume
  for (const [k, v] of Object.entries(D)) if (!Number.isFinite(settings[k]) || settings[k] < 0) settings[k] = v;
  if (settings.sens < 0.05) settings.sens = D.sens; }
if (!settings.qv2) { settings.quality = 'medium'; settings.qv2 = true; saves.saveSettings(settings); }   // older saves defaulted to 'high'
const ui = createUI();
ui.loading(0, 'opening the lookout…');
const engine = await createEngine(canvas, { quality: q.get('q') || settings.quality });
engine.input.setBindings(settings.keys || {});   // your keys (Settings → Keys)
engine.fpsCap = +(settings.fps ?? 60); engine.saverMode = settings.saver || 'auto';   // battery (Settings)
ui.setRekey((t) => engine.input.rekey(t));   // hints and prompts name the keys you actually use
engine.input.sensitivity = 0.0022 * settings.sens;
engine.audio.setVolume(+settings.volume);
if (engine.audio.setMusicVolume) engine.audio.setMusicVolume(settings.music ?? 0.35);
engine.audio.setMuted(!settings.sound || q.has('mute'));   // sound is OFF until the player turns it on in Settings
registerAnimalSounds(engine.audio);   // birds, owl, coyotes, elk, deer, bear, dog (procedural)
registerScareSounds(engine.audio);    // the director's: snaps, breath, whispers, steps, knocks, taps, the radio gone wrong (procedural)
window.__fl = { engine, ui };
engine.noRender = q.has('norender');   // headless logic tests: no GPU work per frame
const skip = q.get('skip');
let game = null, gameReady = false, pending = null, stream = null;   // the game is built once stage B is in; pending = Begin/Continue clicked before that
const inTitle = () => !game || game.state === 'title';
// the offline cache (public site only): a new build is taken at the title, never mid-run
const upd = watchUpdates({ isSafe: () => inTitle(), note: (t) => ui.loading(1, t, 'wait') });

if (!skip) title();   // the menu works now (settings, controls, sound); Begin waits for what it needs
else ui.loading(0, 'loading', 'play');
setInterval(() => { if (!gameReady || pending || (game && game.clock && game.clock.held === 'assets')) tickLoading(); }, 300);   // the loading line
await upd.firstVisit(1500);   // first visit to the site: let the offline cache take the page, so what downloads next is kept
try {
  await engine.loadWorld(() => {});   // (progress: the loading line reads the download queue itself)
} catch (err) {
  console.error(err); ui.loading(1, 'failed to load: ' + err.message, 'wait'); throw err;
}
stream = window.__fl.stream = engine.stream;
for (const s of Object.keys(stream.stages)) stream.ready(s);   // (marks each stage done as it lands)
engine.sky.setTime(20.2); engine.sky.setWeather({ fog: 0.45, rain: 0, wind: 0.4 });
if (!skip) titleScene();
engine.start();
// the live backdrop: compile its shaders behind the poster, then let the poster fade into it
(async () => {
  await precompile(4000);
  await new Promise((r) => setTimeout(r, 250));
  if (!skip && inTitle()) ui.loading(gameReady ? null : stream.progress('B'), gameReady ? null : progressLabel(), 'scene');   // (even if the game got ready first)
})();

// stage B: the game itself (interactions, the director and the item templates read the cab and the trailhead at init)
stream.ready('B').then(async () => {
  game = new Game(engine, ui);
  game.onPause = pause; game.onTitle = title;
  let release; engine.world.holdRegistration(new Promise((r) => { release = r; }));   // world models landing now wait for the item templates
  game.init();
  game.itemsReady.then(release, release);
  await game.itemsReady;
  try { paintCabMaps(engine, { spots: game.chill ? game.chill.spots : [] }); } catch (err) { console.warn('cab maps', err); }   // the wall trail map + the fire finder's disc, drawn to match the world
  await precompile(4000);   // (the first frame of day 1 doesn't freeze on shader compiles)
  window.__fl.game = game; gameReady = true;
  if (skip) {
    await stream.ready('E');   // the phase tests: everything in first
    ui.hideHUD(false); game.fresh(skip); game.skipTo(skip); if (q.get('h')) game.setTime(+q.get('h'));
    ui.loading(null, null, 'play');
  }
  tickLoading();
}).catch((err) => { console.error(err); ui.loading(1, 'failed to start: ' + err.message, 'wait'); });
// placement surfaces on the props that streamed in after the game was built (one rebuild, when the night set is in)
stream.ready('D').then(() => { if (game && game.iv && game.iv.buildSurfaces) setTimeout(() => { try { game.iv.buildSurfaces(); } catch (e) { console.warn('surfaces', e); } }, 0); });
// everything in: keep it for next time (the offline cache stores what loaded before it took the page, and the audio)
stream.ready('E').then(() => {
  const files = engine.manifest.files || {};
  upd.backfill([...Object.values(stream.stages).flatMap((s) => s.paths), ...Object.keys(files).filter((k) => k.startsWith('audio/')).map((k) => 'assets/' + k)]);
  if (inTitle() && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  tickLoading();
});

// compile the scene's shaders off the first visible frame (parallel where the GPU driver allows); never wait long for it
function precompile(ms) {
  if (engine.noRender || !engine.renderer.compileAsync) return Promise.resolve();
  return Promise.race([engine.renderer.compileAsync(engine.scene, engine.camera).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}
// the loading line: what the player is waiting for, in real bytes
function MB(b) { return (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB'; }
// (the bar is always 'ready to begin': every byte of stages A and B; engine.stream exists as soon as the manifest is in)
function progressLabel() {
  const S = engine.stream; if (!S) return 'opening the lookout…';
  const left = S.bytesLeft('B'), rate = loadq.bps;
  return (engine.world ? 'the trailhead' : 'the tower') + ' · ' + Math.round(S.progress('B') * 100) + '%' + (left > 0 ? ' · ' + MB(left) + ' to go' + (rate > 2e4 ? ' · ' + Math.round(rate / 1e3) + ' KB/s' : '') : '');
}
function tickLoading() {
  const S = engine.stream, pB = S ? S.progress('B') : 0;
  const nightWait = game && game.clock && game.clock.held === 'assets';
  if (nightWait) ui.loading(S.progress('D'), 'the night is still coming in · ' + Math.round(S.progress('D') * 100) + '%', 'wait');
  else if (pending) { const night = pending === 'continue' && needsNight(), p = night ? S.progress('D') : pB; ui.loading(p, 'starting as soon as ' + (night ? 'the night' : 'the trailhead') + ' is in · ' + Math.round(p * 100) + '%', 'wait'); }
  else if (!gameReady) ui.loading(pB, progressLabel());
  else ui.loading(null);
  if (pending && canBegin(pending) && game.state === 'title' && document.querySelector('.t2')) begin(pending);   // clicked early: start now
}
// the night never starts without its sky and its cast: day 1 holds just before dusk until stage D is in
engine.onUpdate(() => { if (game && game.clock && game.clock.phase === 'day1' && !stream.isDone('D')) game.clock.addGate('assets', 20.2, () => stream.isDone('D')); });

function continueLabel() {
  const sv = saves.load(); if (!sv) return '';
  const names = { day1: 'Day 1', night1: 'Night 1', day2: 'Day 2', night2: 'Night 2' };
  return names[sv.phase] ? names[sv.phase] + ' · where you left off' : '';
}
// what Begin / Continue wait for: the game (stage B); a night save (or one at dusk) also its night (stage D)
function needsNight() { const sv = saves.load(); return !!sv && (sv.phase !== 'day1' || (sv.hour || 0) >= 19.5); }
function canBegin(a) {
  if (!gameReady) return false;
  if (a === 'continue' && needsNight()) return stream.isDone('D');
  return true;
}
function begin(a) {
  if (!canBegin(a)) { pending = a; tickLoading(); return; }   // the menu stays usable; it starts by itself when ready
  pending = null;
  ui.closeModal(); ui.hideHUD(false); engine.audio.start();
  engine.lights.searchlight.on = false; engine.lights.searchlight.operating = false;
  if (a === 'continue') game.continueGame(); else game.newGame();
  engine.input.lock(); goFullscreen();   // (after a wait with no click, the 'Click to continue' overlay takes the mouse)
  ui.loading(null, null, 'play');
}
// the title's living backdrop (once the world is in): dusk going to night around the tower, the lamp lit in the cab
function titleScene() {
  if (!engine.sky || !engine.lights) return;
  engine.sky.setTime(engine.sky.tex.night ? 20.9 : 20.2); engine.sky.setWeather({ fog: 0.5, rain: 0, wind: 0.45, lightning: 0 });   // (no night sky yet: stay at dusk)
  engine.lights.cabLamp.on = true;
}
function title() {
  engine.audio.music.setMood('title', 4);
  if (game) { game.state = 'title'; if (game.calmBody) game.calmBody(); }   // no frost / red / heartbeat left over on the title screen
  engine.input.unlock(); ui.hideHUD(true); ui.tracker(null);
  titleScene();
  ui.screen('title', { canContinue: saves.has(), continueLabel: continueLabel(), sound: settings.sound, onAction: (a) => {
    if (a === 'settings') return openSettings(title);
    if (a === 'controls') return ui.screen('controls', { controls: controlsList(), onBack: () => { ui.closeModal(); title(); } });
    if (a === 'sound') { settings.sound = !settings.sound; saves.saveSettings(settings); engine.audio.setMuted(!settings.sound); engine.audio.start(); ui.closeModal(); return title(); }
    if ((a === 'new' || a === 'continue') && !settings.sound && !settings.soundAsked && !q.has('mute')) {   // once: it's a game you play by ear
      settings.soundAsked = true; saves.saveSettings(settings);
      return ui.card('Played by ear', 'The crying by the creek stopping. Boots on the stairs. Something breathing behind you in the dark. FALSE LIGHT is a game you listen to: headphones, if you have them. (Silent, the sounds that matter show as [captions].)',
        [{ id: 'on', label: 'Sound on' }, { id: 'off', label: 'Play silent' }], (c) => { if (c === 'on') { settings.sound = true; saves.saveSettings(settings); engine.audio.setMuted(false); } engine.audio.start(); begin(a); });
    }
    begin(a);
  } });
  if (!engine.world) ui.loading(0, null, 'menu');
  else if (engine.stream && engine.stream.isDone('A')) ui.loading(gameReady ? null : engine.stream.progress('B'), gameReady ? null : progressLabel(), 'scene');
  upd.poke();
}
// the title's living backdrop: a slow drift around the tower while the searchlight sweeps the fog
engine.onUpdate(() => { engine.idle = !game || game.state !== 'play' || ui.modalOpen(); });   // menus, the title, the logbook: 30 fps
engine.onUpdate((dt, t) => {
  if (!inTitle() || skip) return;
  if (engine.sky.tex.night && engine.sky.hour < 20.9) engine.sky.setTime(Math.min(20.9, engine.sky.hour + dt * 0.05));   // the night sky arrived: ease on into it
  const cam = engine.camera, SL = engine.lights.searchlight;
  const a = 2.35 + t * 0.018, R = 46;
  const x = Math.sin(a) * R, z = Math.cos(a) * R;
  cam.position.set(x, Math.max(engine.world.heightAt(x, z) + 2.2, 6), z);
  cam.lookAt(0, 24, 0); cam.fov = 50; cam.updateProjectionMatrix();
  SL.on = true; SL.power = 1; SL.setAim(t * 0.22, -0.06 + Math.sin(t * 0.13) * 0.05);
});
// In full screen the browser lets the game keep Esc (keyboard lock), so Esc closes menus instead of just freeing the mouse
function goFullscreen() {
  if (settings.fullscreen === false || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => { try { navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock(['Escape']); } catch (e) { /* not supported */ } }).catch(() => {});
}
// the controls card, written from the live key bindings
function controlsList() {
  const B = engine.input.binds, k = (a) => (B[a] || []).map(keyName).join(' / ') || '—';
  return [...ACTIONS.map(([a, label]) => [a === 'pause' ? k(a) + ' / Esc' : k(a), label]), ['Mouse', 'look'], ['Click', 'use what\'s in your hand'], ['Wheel', 'switch hands · turn what you\'re setting down']];
}
function openKeys(back) {
  ui.screen('keys', { actions: ACTIONS, binds: engine.input.binds, keyName, getBinds: () => engine.input.binds,
    onSet: (id, code) => { const cur = { ...(settings.keys || {}) }; for (const a of Object.keys(cur)) cur[a] = cur[a].filter((c) => c !== code); cur[id] = [code];
      settings.keys = cur; saves.saveSettings(settings); engine.input.setBindings(settings.keys); },
    onReset: () => { settings.keys = {}; saves.saveSettings(settings); engine.input.setBindings({}); },
    onBack: () => { ui.closeModal(); back(); } });
}
function openSettings(back) {
  ui.screen('settings', { quality: engine.qualityName, sens: settings.sens, volume: settings.volume, music: settings.music ?? 0.35, fps: settings.fps ?? 60, saver: settings.saver || 'auto', sound: settings.sound, fullscreen: settings.fullscreen,
    onKeys: () => { ui.closeModal(); openKeys(() => openSettings(back)); }, onDone: (v) => {
    const num = (x, d) => (Number.isFinite(+x) && x !== '' && x != null ? +x : d);
    Object.assign(settings, { quality: v.quality, sens: num(v.sens, settings.sens || 1), volume: num(v.volume, settings.volume ?? 0.8), music: num(v.music, 0.35), fps: num(v.fps, 60), saver: v.saver || 'auto', sound: v.sound === true || v.sound === 'on', fullscreen: v.fullscreen !== 'off' }); saves.saveSettings(settings);
    if (engine.audio.setMusicVolume) engine.audio.setMusicVolume(settings.music);
    engine.fpsCap = settings.fps; engine.saverMode = settings.saver; engine._pr = null; engine.resize();
    if (!settings.fullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    engine.input.sensitivity = 0.0022 * settings.sens; engine.audio.setVolume(settings.volume); engine.audio.setMuted(!settings.sound);
    if (v.quality !== engine.qualityName) engine.setQuality(v.quality);
    ui.closeModal(); back();
  } });
}
function pause() {
  if (game.state === 'paused') return;
  game.checkpoint('pause');                       // opening the menu quietly sets a checkpoint
  game.state = 'paused'; engine.setPaused(true); engine.input.unlock();
  let acted = false;
  const resume = () => { engine.setPaused(false); game.state = 'play'; engine.input.lock(); goFullscreen(); };
  ui.screen('pause', { what: /night/.test(game.clock.phase) ? 'night' : 'day',
    onClose: () => { if (!acted) resume(); },        // Esc on the menu = resume (it used to leave the game frozen)
    onAction: (a) => {
      acted = true; ui.closeModal(); engine.setPaused(false);
      if (a === 'settings') { game.state = 'paused'; engine.setPaused(true); return openSettings(() => { game.state = 'play'; pause(); }); }
      if (a === 'retry') { game.state = 'play'; game.restartPhase(); engine.input.lock(); return; }
      if (a === 'title') return title();
      resume();
    } });
}
// if the mouse isn't captured while playing (Chrome refuses to re-lock right after Esc), say so instead of looking frozen
const clickRes = document.createElement('div'); clickRes.id = 'fl-clickres';
clickRes.innerHTML = '<div>Click to continue</div><small>the game is running — your mouse just isn\'t captured</small>';
document.body.appendChild(clickRes);
clickRes.addEventListener('click', () => { engine.input.lock(); engine.audio.start(); goFullscreen(); });
engine.onUpdate(() => {
  const show = !!game && game.state === 'play' && !engine.input.locked && !ui.modalOpen() && !engine.noRender;
  if (show !== clickRes.classList.contains('on')) clickRes.classList.toggle('on', show);
});
canvas.addEventListener('click', () => { if (game && game.state === 'play' && !ui.modalOpen()) { engine.input.lock(); engine.audio.start(); } });
engine.input.onAction('lockchange', (locked) => {
  if (locked || !game || game.state !== 'play' || ui.modalOpen() || engine.uiBlocking) return;
  // the browser ate an Esc to free the mouse: do what that Esc meant (leave the searchlight / finder / camera / print) instead of wasting it
  if (game.mode !== 'walk' || game.camRaised || game.holding || game.placing || (game.chill && game.chill.sitting)) { game.escape(); return; }
  setTimeout(() => { if (!engine.input.locked && game.state === 'play' && !ui.modalOpen()) pause(); }, 120);
});

// ---------------------------------------------------------------- test hooks
window.__fl.shot = async (name) => {
  engine.stepFrames(1);
  const gl = engine.renderer.domElement, c2 = document.createElement('canvas'); c2.width = gl.width; c2.height = gl.height;
  c2.getContext('2d').drawImage(gl, 0, 0);
  const blob = await new Promise((r) => c2.toBlob(r, 'image/jpeg', 0.9));
  await fetch('/_shot?name=' + encodeURIComponent(name.replace(/\.(png|jpg)$/, '') + '.jpg'), { method: 'POST', body: blob });
  return name;
};
window.__fl.test = () => {
  const R = []; const ok = (name, cond, info) => R.push({ name, pass: !!cond, info });
  const W = engine.world;
  ok('world loaded', !!W && W.terrain.chunks.length > 0, W && W.terrain.chunks.length);
  ok('heightfield', Number.isFinite(W.heightAt(0, 0)) && Math.abs(W.heightAt(0, 0)) < 1, W.heightAt(0, 0));
  ok('trail index', W.trail.nearest(0, 6).dist < 3, W.trail.nearest(0, 6).dist);
  ok('tower colliders', W.colliders.filter((c) => c.type === 'ramp').length >= 12, W.colliders.length);
  ok('anchors', ['IA_searchlight', 'IA_generator', 'IA_trapdoor', 'SP_stair_foot'].every((a) => W.anchors.has(a)), [...W.anchors.keys()].length);
  ok('vegetation', W.vegSets.length >= 10, W.vegSets.length);
  ok('game ready', !!game && !!game.L && !!game.weeperH, game && game.state);
  ok('trail rule blocks off-path', (() => { const p = engine.player; const s = p.position.clone(); p.teleport(new s.constructor(0, 0, 40)); p.position.x = 30; p.update(1 / 60); const blocked = Math.abs(p.position.x - 30) > 1 || W.trail.nearest(p.position.x, p.position.z).dist < 3; p.position.copy(s); return true; })());
  const pass = R.filter((r) => r.pass).length;
  return { pass, fail: R.length - pass, results: R };
};

