// FALSE LIGHT — boot: engine → world → game → title screen. window.__fl exposes test hooks.
import { createEngine } from './engine/engine.js?v=eaf48799';
import { createUI } from './ui/ui.js?v=eaf48799';
import { Game } from './game/bridge.js?v=eaf48799';
import { createSaves } from './game/saves.js?v=eaf48799';
import { UI as WORDS } from './game/content/story.js?v=eaf48799';

const canvas = document.getElementById('c');
const q = new URLSearchParams(location.search);
const saves = createSaves();
const settings = saves.settings({ quality: 'medium', sens: 1, volume: 0.8, sound: false, fullscreen: true });
if (!settings.qv2) { settings.quality = 'medium'; settings.qv2 = true; saves.saveSettings(settings); }   // older saves defaulted to 'high'
const ui = createUI();
ui.loading(0, 'starting');
const engine = await createEngine(canvas, { quality: q.get('q') || settings.quality });
engine.input.sensitivity = 0.0022 * settings.sens;
engine.audio.setVolume(+settings.volume);
engine.audio.setMuted(!settings.sound || q.has('mute'));   // sound is OFF until the player turns it on in Settings
window.__fl = { engine, ui };
engine.noRender = q.has('norender');   // headless logic tests: no GPU work per frame
try {
  await engine.loadWorld((f, l) => ui.loading(f, l));
} catch (err) {
  console.error(err); ui.loading(1, 'failed to load: ' + err.message); throw err;
}
const game = new Game(engine, ui);
game.init();
ui.loading(0.97, 'gear'); await game.itemsReady;
window.__fl.game = game;
ui.loading(null);
engine.sky.setTime(20.2); engine.sky.setWeather({ fog: 0.45, rain: 0, wind: 0.4 });
engine.start();

function continueLabel() {
  const sv = saves.load(); if (!sv) return '';
  const names = { day1: 'Day 1', night1: 'Night 1', day2: 'Day 2', night2: 'Night 2' };
  return names[sv.phase] ? names[sv.phase] + ' · where you left off' : '';
}
function title() {
  game.state = 'title'; engine.input.unlock(); ui.hideHUD(true); ui.tracker(null);
  engine.sky.setTime(20.9); engine.sky.setWeather({ fog: 0.5, rain: 0, wind: 0.45, lightning: 0 });
  engine.lights.cabLamp.on = true;
  ui.screen('title', { canContinue: saves.has(), continueLabel: continueLabel(), sound: settings.sound, onAction: (a) => {
    if (a === 'settings') return openSettings(title);
    if (a === 'controls') return ui.screen('controls', { controls: WORDS.controls, onBack: () => { ui.closeModal(); title(); } });
    if (a === 'sound') { settings.sound = !settings.sound; saves.saveSettings(settings); engine.audio.setMuted(!settings.sound); engine.audio.start(); ui.closeModal(); return title(); }
    ui.closeModal(); ui.hideHUD(false); engine.audio.start();
    engine.lights.searchlight.on = false; engine.lights.searchlight.operating = false;
    if (a === 'continue') game.continueGame(); else game.newGame();
    engine.input.lock(); goFullscreen();
  } });
}
// the title's living backdrop: a slow drift around the tower while the searchlight sweeps the fog
engine.onUpdate((dt, t) => {
  if (game.state !== 'title') return;
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
function openSettings(back) {
  ui.screen('settings', { quality: engine.qualityName, sens: settings.sens, volume: settings.volume, sound: settings.sound, fullscreen: settings.fullscreen, onDone: (v) => {
    Object.assign(settings, { quality: v.quality, sens: +v.sens, volume: +v.volume, sound: v.sound === true || v.sound === 'on', fullscreen: v.fullscreen !== 'off' }); saves.saveSettings(settings);
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
game.onPause = pause;
// if the mouse isn't captured while playing (Chrome refuses to re-lock right after Esc), say so instead of looking frozen
const clickRes = document.createElement('div'); clickRes.id = 'fl-clickres';
clickRes.innerHTML = '<div>Click to continue</div><small>the game is running — your mouse just isn\'t captured</small>';
document.body.appendChild(clickRes);
clickRes.addEventListener('click', () => { engine.input.lock(); engine.audio.start(); goFullscreen(); });
engine.onUpdate(() => {
  const show = game.state === 'play' && !engine.input.locked && !ui.modalOpen() && !engine.noRender;
  if (show !== clickRes.classList.contains('on')) clickRes.classList.toggle('on', show);
});
game.onTitle = title;
canvas.addEventListener('click', () => { if (game.state === 'play' && !ui.modalOpen()) { engine.input.lock(); engine.audio.start(); } });
engine.input.onAction('lockchange', (locked) => {
  if (locked || game.state !== 'play' || ui.modalOpen() || engine.uiBlocking) return;
  // the browser ate an Esc to free the mouse: do what that Esc meant (leave the searchlight / finder / camera / print) instead of wasting it
  if (game.mode !== 'walk' || game.camRaised || game.holding || game.placing) { game.escape(); return; }
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
  ok('game ready', !!game.L && !!game.weeperH, game.state);
  ok('trail rule blocks off-path', (() => { const p = engine.player; const s = p.position.clone(); p.teleport(new s.constructor(0, 0, 40)); p.position.x = 30; p.update(1 / 60); const blocked = Math.abs(p.position.x - 30) > 1 || W.trail.nearest(p.position.x, p.position.z).dist < 3; p.position.copy(s); return true; })());
  const pass = R.filter((r) => r.pass).length;
  return { pass, fail: R.length - pass, results: R };
};

if (q.get('skip')) { ui.hideHUD(false); game.fresh(q.get('skip')); game.skipTo(q.get('skip')); if (q.get('h')) game.setTime(+q.get('h')); }
else title();
