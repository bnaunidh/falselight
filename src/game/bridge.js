// FALSE LIGHT — the game: wires the pure rules (clock, objectives, fuel, morse, hikers, the Weeper, photos,
// sending, CO, the Other Lookout) to the engine and the UI, and runs the Day 1 → Night 2 script.
import * as THREE from 'three';
import { Clock, PHASES, isNight, nextPhase } from './clock.js';
import { Objectives } from './objectives.js';
import { Radio } from './radio.js';
import { Fuel } from './fuel.js';
import { FireFinder, spokenBearing } from './firefinder.js';
import { Photos, classifyShot } from './photos.js';
import { CO } from './co.js';
import { Weeper, lookupChance } from './weeper.js';
import { OtherLookout } from './otherLookout.js';
import { LostHikerWatcher, LOST, spreadPath } from './lostHiker.js';
import { GuidedHiker } from './hikers.js';
import { MorseKeyer, isSOS } from './morse.js';
import { normalizeLayout } from './layout.js';
import { createSaves } from './saves.js';
import { createRng } from './rng.js';
import { canSend, send as sendPrint, isProof } from './sending.js';
import { fmtHour, dayHour, dist, dist2d, bearing, angDiff } from './util.js';
import * as S from './content/story.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const A3 = (v) => [v.x, v.y, v.z];
// cab + trailhead anchors used until the Blender cab interior / trailhead props provide real ones (three coords)
const CAB = {
  IA_radio: [1.72, 31.0, -0.45], IA_firefinder: [0.3, 31.05, -0.15], IA_logbook: [1.62, 30.98, 0.2], IA_bed: [-1.0, 30.55, -1.55],
  IA_heater: [1.98, 30.75, 0.85], IA_map: [-1.98, 31.35, 0.25], IA_camera_shelf: [0.7, 30.95, 1.88],
};

function lampTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,248,225,1)'); gr.addColorStop(0.18, 'rgba(255,230,170,.85)'); gr.addColorStop(0.5, 'rgba(255,190,110,.18)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function smokeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const y = 250 - i * 2.6, x = 64 + Math.sin(i * 0.19) * (8 + i * 0.35) + i * 0.4, r = 10 + i * 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(215,212,205,${0.08 * (1 - i / 110)})`); gr.addColorStop(1, 'rgba(215,212,205,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Game {
  constructor(engine, ui) {
    this.e = engine; this.ui = ui; this.saves = createSaves();
    this.rng = createRng(1983).next;
    this.mode = 'walk'; this.flags = {}; this.log = []; this.fired = new Set(); this.lastSaved = null;
    this.fovTarget = 68; this.binocular = false; this.camRaised = false; this.flashOn = false; this.holding = null;
    this.signal = { mode: false, last: -99 }; this.phaseTime = 0; this.state = 'title';
  }

  // ------------------------------------------------------------------ setup
  init() {
    const e = this.e, W = e.world;
    this.L = normalizeLayout(W.layout, W.heightAt);
    this.anchor = (n) => {
      const a = W.anchors.get(n); if (a) return a.clone();
      if (CAB[n]) return V3(CAB[n]);
      const pp = (W.layout.propPlacements || []);
      const byModel = (m, dx = 0, dy = 1, dz = 0) => { const p = pp.find((q) => q.model === m); return p ? new THREE.Vector3(p.position[0] + dx, p.position[1] + dy, p.position[2] + dz) : null; };
      const pl = (k) => this.L.places[k] && V3(this.L.places[k]);
      const map = {
        IA_mailbox: () => byModel('prop_mailbox', 0, 1.1), IA_fax: () => byModel('prop_ranger_station', 0, 1.0), IA_phone: () => byModel('prop_ranger_station', 0.8, 1.5),
        IA_truck: () => byModel('prop_supply_truck', 1.2, 1.3), IA_camp_backpack: () => byModel('prop_backpack', 0, 0.6), IA_spring: () => pl('spring') && pl('spring').add(new THREE.Vector3(1.2, 0.8, 0.8)),
        IA_overlook: () => pl('ravine_overlook') && pl('ravine_overlook').add(new THREE.Vector3(1.6, 1.1, 0)),
        SP_trailhead: () => pl('trailhead') && pl('trailhead').add(new THREE.Vector3(-6, 0, -10)),
      };
      return map[n] ? map[n]() : null;
    };
    this.placeholders();
    // lamps (hikers' flashlights) and the day smoke
    this.lampTex = lampTexture();
    this.smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    this.smoke.scale.set(420, 840, 1); this.smoke.visible = false; e.scene.add(this.smoke);
    // entities that exist every day
    const seat = W.weeperSeat || V3(this.L.places.weeper_rock || [58, -42, 196]);
    this.weeperSeat = seat;
    this.weeperH = e.entities.spawn('weeper', { position: seat.clone(), facing: V3(this.L.places.creek_bridge || [34, -46, 176]), pose: 'sit_sob' });
    this.interactions();
    this.inputs();
    e.onUpdate((dt, t) => this.update(dt, t));
  }

  placeholders() {
    const e = this.e, W = e.world, scene = e.scene;
    const has = (n) => W.anchors.has(n);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b4a38, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x34372f, roughness: 0.55, metalness: 0.4 });
    const box = (w, h, d, p, m, parent = scene) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.copy(p); b.castShadow = b.receiveShadow = true; parent.add(b); return b; };
    this.ph = {};
    if (!has('IA_radio')) {   // the cab interior hasn't been built yet: simple stand-ins so the cab works
      const g = new THREE.Group(); g.name = 'placeholder_cab'; scene.add(g);
      box(0.6, 0.76, 1.5, new THREE.Vector3(1.72, 30.38, -0.4), wood, g); box(0.4, 0.22, 0.3, new THREE.Vector3(1.72, 30.87, -0.45), metal, g);
      box(1.95, 0.45, 0.9, new THREE.Vector3(-1.0, 30.25, -1.55), new THREE.MeshStandardMaterial({ color: 0x5d5a4e, roughness: 0.95 }), g);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.95, 12), metal); ped.position.set(0.3, 30.48, -0.15); g.add(ped);
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 40), new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.85 })); disk.position.set(0.3, 30.97, -0.15); g.add(disk);
      box(1.7, 0.05, 0.32, new THREE.Vector3(0.9, 30.88, 1.86), wood, g);
      this.ph.camera = box(0.14, 0.1, 0.16, new THREE.Vector3(0.7, 30.96, 1.86), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6 }), g);
      box(0.18, 0.5, 0.12, new THREE.Vector3(1.98, 30.55, 0.85), metal, g);
      box(0.02, 0.6, 0.8, new THREE.Vector3(-2.0, 31.35, 0.25), new THREE.MeshStandardMaterial({ color: 0xd8ccae, roughness: 0.9 }), g);
      box(0.25, 0.04, 0.34, new THREE.Vector3(1.62, 30.78, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a2b1f, roughness: 0.8 }), g);
    }
    const pp = W.layout.propPlacements || [];
    const place = (model, w, h, d, m) => {
      if (e.manifest.models && e.manifest.models[model]) return;
      const p = pp.find((q) => q.model === model); if (!p) return;
      const b = box(w, h, d, new THREE.Vector3(p.position[0], p.position[1] + h / 2, p.position[2]), m); b.rotation.y = p.rotY || 0; this.ph[model] = b;
    };
    place('prop_mailbox', 0.25, 1.2, 0.5, metal);
    place('prop_ranger_station', 5, 3, 4, new THREE.MeshStandardMaterial({ color: 0x4d3f30, roughness: 0.9 }));
    place('prop_supply_truck', 2.0, 1.8, 5.2, new THREE.MeshStandardMaterial({ color: 0x6f7d5c, roughness: 0.6, metalness: 0.2 }));
    place('prop_backpack', 0.45, 0.75, 0.35, new THREE.MeshStandardMaterial({ color: 0x7a3322, roughness: 0.9 }));
    place('prop_tent_collapsed', 2.2, 0.5, 2.0, new THREE.MeshStandardMaterial({ color: 0x3f5b4c, roughness: 0.8 }));
  }

  // ------------------------------------------------------------------ the rules instances
  fresh(phase = 'day1') {
    this.clock = new Clock(phase);
    this.obj = new Objectives(S.OBJECTIVES);
    this.radio = new Radio();
    this.fuel = new Fuel();
    this.finder = new FireFinder(180);
    this.photos = new Photos();
    this.co = new CO();
    this.weeper = new Weeper();
    this.other = new OtherLookout();
    this.flags = { rulesTo: 5 };
    this.log = [];
    this.proofs = 0;
    this.hikers = []; this.lostWatchers = []; this.keyer = new MorseKeyer();
  }
  snapshot() {
    return { phase: this.clock.phase, flags: this.flags, fuel: this.fuel.toJSON(), photos: this.photos.toJSON(), co: this.co.toJSON(), weeper: this.weeper.toJSON(),
      other: this.other.toJSON(), log: this.log, proofs: this.proofs, obj: this.obj.toJSON() };
  }
  restore(s) {
    this.fresh(s.phase);
    this.flags = { rulesTo: 5, ...s.flags }; this.fuel = new Fuel(s.fuel); this.photos = new Photos(s.photos); this.co = new CO(s.co);
    this.weeper = new Weeper(s.weeper); this.other = new OtherLookout(s.other); this.log = s.log || []; this.proofs = s.proofs || 0;
  }

  // ------------------------------------------------------------------ flow
  newGame() { this.saves.clear(); this.fresh('day1'); this.startPhase('day1'); }
  continueGame() { const s = this.saves.load(); if (!s) return this.newGame(); this.restore(s); this.startPhase(s.phase, true); }
  retry() { const s = this.lastSaved || this.saves.load(); if (s) { this.restore(s); this.startPhase(s.phase, true); } else this.newGame(); }
  startPhase(phase, restored = false) {
    const e = this.e;
    if (!restored || !this.clock || this.clock.phase !== phase) this.clock = new Clock(phase);
    this.obj = new Objectives(S.OBJECTIVES); this.radio = new Radio();
    this.fired = new Set(); this.phaseTime = 0; this.state = 'play';
    for (const h of this.hikers) h.ent && h.ent.remove(); for (const h of this.hikers) h.lamp && e.scene.remove(h.lamp);
    for (const w of this.lostWatchers) w.ent.remove();
    this.hikers = []; this.lostWatchers = []; this.keyer = new MorseKeyer();
    if (this.otherEnt) { this.otherEnt.remove(); this.otherEnt = null; }
    if (this.bodyEnt) { this.bodyEnt.remove(); this.bodyEnt = null; }
    this.exitMode(); this.holding = null;
    this.player().carrying = this.fuel.carrying ? 'fuel' : null;
    if (this.weeper.state === 'caught' || (this.weeper.state === 'gone' && !isNight(phase))) this.weeper.state = this.weeper.state === 'gone' ? 'gone' : 'sitting';
    if (['coming', 'stairs', 'door', 'hunting'].includes(this.weeper.state)) { this.weeper.state = 'screaming'; this.weeper.timer = 0; this.weeper.progress = 0; }
    const sky = e.sky;
    sky.setWeather(phase === 'night2' ? { rain: 0.15, wind: 0.55, fog: 0.35, lightning: 0.012 } : phase === 'night1' ? { rain: 0, wind: 0.35, fog: 0.3, lightning: 0 } : phase === 'day2' ? { rain: 0.25, wind: 0.4, fog: 0.5, lightning: 0 } : { rain: 0, wind: 0.3, fog: 0.3, lightning: 0 });
    e.lights.cabLamp.on = isNight(phase);
    const P = this.player();
    if (phase === 'day1') { P.teleport(this.anchor('SP_trailhead') || 'SP_stair_foot'); P.lookAt(V3(this.L.places.trailhead || [22, -32, 380]).add(new THREE.Vector3(-8, 1.5, -40))); }
    else if (phase === 'day2' || phase === 'end') { P.teleport(this.anchor('SP_cab_bed') || new THREE.Vector3(-1, 30, -0.7)); P.lookAt(new THREE.Vector3(0, 31.4, 3)); }
    else { P.teleport(this.anchor('SP_cab_bed') || new THREE.Vector3(-1, 30, -0.7)); P.lookAt(new THREE.Vector3(2, 31.4, 2)); }
    if (phase === 'night2' && this.weeper.state === 'seen_day') this.weeper.nightFell();
    this.lastSaved = this.snapshot(); this.saves.save(this.lastSaved);
    this.ui.toast(PHASES[phase].date, 5);
    this.script('start');
    this.refreshTracker();
  }
  endPhase() {
    const n = nextPhase(this.clock.phase);
    if (n === 'end' || this.clock.phase === 'night2') { this.finish(); return; }
    this.ui.fade(1);
    setTimeout(() => { this.startPhase(n); this.ui.fade(0); }, 900);
    this.state = 'transition';
  }
  finish() {
    this.state = 'end'; this.e.input.unlock();
    const sent = this.photos.prints.filter((p) => p.sent).length;
    this.ui.screen('end', { text: 'Grey in the east. Somewhere below, the truck is coming up the road.',
      detail: `End of the first two nights. Proof sent: ${this.proofs} of ${S.PROOF_GOAL}. Prints taken: ${this.photos.prints.length} (${sent} sent). ${this.flags.lostN1 ? 'You lost Lyle Pruitt.' : 'Lyle Pruitt made it to the lot.'} Nights three to seven are still being built.`,
      onAction: (a) => { this.ui.closeModal(); this.onTitle && this.onTitle(); } });
  }
  die(kind) {
    if (this.state !== 'play') return;
    this.state = 'dead'; this.exitMode(); this.e.audio.play('scream', { volume: 1 });
    this.e.post.set({ blackout: 1 }); this.e.input.unlock();
    setTimeout(() => this.ui.screen('death', { text: S.UI.death[kind] || S.UI.death.generic, onAction: (a) => { this.ui.closeModal(); this.e.post.set({ blackout: 0, fear: 0 }); if (a === 'retry') this.retry(); else this.onTitle && this.onTitle(); } }), 1400);
  }

  // ------------------------------------------------------------------ helpers
  player() { return this.e.player; }
  pos() { return A3(this.e.player.position); }
  get night() { return isNight(this.clock.phase); }
  hourText() { return fmtHour(this.clock.hour); }
  say(lines, opts) { if (typeof lines === 'function') return; this.radio.say(lines, opts); }
  addLog(text, own = false) { this.log.push({ date: PHASES[this.clock.phase].short + ' ' + fmtHour(this.clock.hour), text, own }); if (own) this.ui.toast('The logbook is open to a page you don\'t remember writing.', 4); }
  once(id, fn) { if (this.fired.has(id)) return false; this.fired.add(id); fn(); return true; }
  refreshTracker() {
    const v = this.obj.view();
    if (!v.current) v.current = this.night ? { text: 'Keep watch from the cab', hint: 'Scan the dark. The light is on the roof — the control column by the bed. Tab: logbook.' }
      : { text: 'Keep watch — Silver Fork will call', hint: 'Scan the horizon from the catwalk, or rest on the bed to let the hours pass.' };
    this.ui.tracker(v, { date: PHASES[this.clock.phase].short + ' · ' + this.hourText() });
  }
  complete(id, note) { if (this.obj.complete(id, note)) { this.e.audio.play('paper', { volume: 0.4 }); this.refreshTracker(); } }
  add(id, extra) { if (!this.obj.has(id)) { this.obj.add(id, extra); this.refreshTracker(); } }
  inCab() { return this.player().zone === 'cab'; }
  beamSpot() {
    const SL = this.e.lights.searchlight; if (!SL.on) return null;
    const o = SL.worldOrigin(), d = SL.worldDir(), p = new THREE.Vector3();
    for (let s = 3; s < 650; s += 2) { p.copy(o).addScaledVector(d, s); const h = this.e.world.heightAt(p.x, p.z); if (p.y < h) return [p.x, h, p.z]; }
    return null;
  }
  activeFires() {
    const out = [];
    for (const f of this.L.fireSites) if (this.flags['fire_' + f.name] && !this.flags['fireReported_' + f.name]) out.push(f);
    return out;
  }
  showFire(name, on) {
    const f = this.L.fireSites.find((q) => q.name === name); if (!f) return;
    this.flags['fire_' + name] = on;
    if (this.night) this.e.world.setFire(name, on ? 1 : 0);
    else { const fp = (this.e.world.layout.fireSites || []).find((q) => q.name === name); if (fp && on) { this.smoke.position.set(fp.position[0], fp.position[1] + 380, fp.position[2]); this.smoke.visible = true; this.smokeFade = 1; } else this.smokeFade = 0; }
  }

  // ------------------------------------------------------------------ the script
  script(ev) {
    const ph = this.clock.phase, f = this.flags;
    if (ev === 'start') {
      if (ph === 'day1') { this.add('d1_walk'); this.say(S.LINES.arrive); this.truckVisible = true; }
      if (ph === 'night1') { this.say(S.LINES.night1Start); this.add('n1_dawn', { optional: true }); }
      if (ph === 'day2') { this.say(f.lostN1 ? S.LINES.day2Lost : S.LINES.day2Saved); this.add('d2_camp'); this.add('d2_overlook'); this.add('d2_photo'); this.add('d2_send'); this.truckVisible = true;
        if (!this.photos.hasCamera) this.photos.giveCamera(1); }
      if (ph === 'night2') { this.say(S.LINES.night2Start); this.add('n2_dawn', { optional: true }); }
    }
  }
  scriptTick(dt) {
    const ph = this.clock.phase, h = this.clock.hour, f = this.flags, z = this.player().zone, o = this.obj;
    const done = (id) => o.isDone(id);
    // gates (the clock holds until the work is done)
    if (ph === 'day1') {
      this.clock.addGate('rules', 13.0, () => done('d1_rules'));
      this.clock.addGate('smoke', 19.0, () => done('d1_smoke') && done('d1_fuel'));
      this.clock.addGate('dusk', 20.45, () => done('d1_generator') && z === 'cab');
      if (!done('d1_walk') && (z === 'base' || z === 'stairs' || z === 'cab')) { this.complete('d1_walk'); this.add('d1_climb'); }
      if (done('d1_walk') && !done('d1_climb') && z === 'cab') { this.complete('d1_climb'); this.addLog(S.AUTO_LOG.arrived(this.hourText())); this.add('d1_radio'); }
      if (h >= 13.0 && done('d1_rules')) this.once('smokeCall', () => { this.say(S.LINES.smokeCall); this.add('d1_smoke'); this.showFire('Cold Creek Basin', true); });
      if (done('d1_smoke') || h >= 16) this.once('genTask', () => this.add('d1_generator'));
      if (h >= 18.9 && done('d1_smoke')) this.once('camera', () => { this.flags.cameraOut = true; this.add('d1_camera', { optional: true }); });
      if (h >= 19.6) this.once('sob', () => { this.say(S.LINES.duskSob); this.sobOn = true; });
      if (h >= 19.9) this.once('dusktask', () => this.add('d1_dusk'));
      if (done('d1_generator') && z === 'cab' && h >= 20.2) this.complete('d1_dusk');
      if (h > 12 && this.truckVisible && z !== 'trailhead') this.truckVisible = false;
    }
    if (ph === 'night1') {
      this.clock.addGate('hiker', 24.5, () => this.hikers.some((k) => k.rules.done && k.rules.kind === 'hiker'));
      if (h >= 21.3) this.once('glow1', () => { this.say(S.LINES.glowN1); this.add('n1_fire'); this.showFire('Hatchet Peak', true); });
      if (h >= 22.4) this.once('sos1', () => { this.spawnHiker('night1'); this.say(S.LINES.sosN1); this.add('n1_answer'); });
      if (h >= 26.0) this.once('gate', () => { this.e.audio.play('gate_rattle', { position: this.anchor('IA_gate') || new THREE.Vector3(0, 1, 6), volume: 1.2 }); this.say(S.LINES.gateRattle); f.gateRattled = true; this.addLog('0200 — gate. Wind.'); });
      if (h >= 28.4) this.once('dawnObj', () => this.add('n1_dawn'));
    }
    if (ph === 'day2') {
      this.clock.addGate('dusk2', 20.45, () => z === 'cab' && this.fuel.genOn);
      if (h >= 14.0) this.once('fuel2', () => { this.add('d2_fuel'); this.add('d2_generator'); });
      if (h >= 19.5) this.once('dusk2', () => this.add('d2_dusk'));
      if (this.fuel.cabCans > 0) this.complete('d2_fuel');
      if (this.fuel.genOn && h >= 14) this.complete('d2_generator');
      if (z === 'cab' && h >= 20.2 && this.fuel.genOn) this.complete('d2_dusk');
      if (h >= 11.0 && !done('d2_photo')) this.once('nudge', () => this.say(S.LINES.day2Nudge));
      if (h >= 16 && this.truckVisible) this.truckVisible = false;
    }
    if (ph === 'night2') {
      if (h >= 21.4) this.once('glow2', () => { this.say(S.LINES.glowN2); this.add('n2_fire'); this.showFire('Sheep Ridge', true); });
      if (h >= 22.0) this.once('tree', () => this.spawnLost());
      if (h >= 23.2) this.once('false', () => { this.spawnHiker('false'); this.say(S.LINES.falseSOS); this.add('n2_light', { optional: true }); });
      if (h >= 28.4) this.once('dawnObj2', () => this.add('n2_dawn'));
    }
    // the Other Lookout
    const evs = this.other.check({ phase: ph, hour: h, zone: z, flags: { ...f, weeperComing: this.weeper.triggered, lostHikerStepped: f.lostSteps || 0 } });
    for (const id of evs) this.otherEvent(id);
    if (this.clock.ended && this.state === 'play') this.endPhase();
  }
  otherEvent(id) {
    const e = this.e;
    if (id === 'boots_catwalk' || id === 'boots_catwalk_2') {
      this.say(S.LINES.bootsCatwalk);
      const pts = [[3, 30.1, 3], [3, 30.1, 0], [3, 30.1, -3], [0, 30.1, -3], [-3, 30.1, -3], [-3, 30.1, 0], [-3, 30.1, 3], [0, 30.1, 3]];
      pts.forEach((p, i) => setTimeout(() => e.audio.play('footstep_wood', { position: V3(p), volume: 1.3 }), 600 + i * 700));
    } else if (id === 'fax_silhouette') {
      const st = this.anchor('IA_fax'); if (st) { this.otherEnt = e.entities.spawn('other_lookout', { position: st.clone().add(new THREE.Vector3(2.5, -1, 1.2)), pose: 'back_window' }); this.say(S.LINES.faxSilhouette); setTimeout(() => { this.otherEnt && this.otherEnt.remove(); this.otherEnt = null; }, 9000); }
    } else if (id === 'bed_sitter') {
      this.otherEnt = e.entities.spawn('other_lookout', { position: new THREE.Vector3(-1.0, 30.0, -1.2), facing: new THREE.Vector3(-1, 30, -3), pose: 'sitting_bed' });
      this.say(S.LINES.bedSitter); this.bedSitterT = 0;
    } else if (S.OWN_LOG[id]) {
      const en = S.OWN_LOG[id]; this.addLog(en.text, true);
      if (id === 'own_entry_closer') this.flags.rulesTo = 12;
    }
  }

  // ------------------------------------------------------------------ hikers & the false light
  spawnHiker(which) {
    const e = this.e;
    const route = which === 'false' ? this.L.hikerRoutes.night2_false_light : this.L.hikerRoutes.night1;
    const rules = new GuidedHiker(route, { kind: which === 'false' ? 'false' : 'hiker', rng: this.rng, t0: e.time.value, name: which === 'false' ? 'false' : 'Lyle Pruitt' });
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.lampTex, color: which === 'false' ? 0xfff6e8 : 0xffe2b0, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    lamp.renderOrder = 6; e.scene.add(lamp);
    const light = new THREE.PointLight(0xffd9a0, 0, 12, 2); e.scene.add(light);
    const ent = which === 'false' ? null : e.entities.spawn('hiker', { position: V3(rules.ground), pose: 'step' });
    this.hikers.push({ rules, lamp, light, ent, which, announced: {} });
  }
  updateHikers(dt, t) {
    const e = this.e, SL = e.lights.searchlight;
    const o = SL.worldOrigin(), dir = SL.worldDir();
    for (const H of this.hikers) {
      const r = H.rules;
      const lp = r.lampPos(t); const lv = V3(lp);
      const lit = SL.on && SL.isLit(lv, { trees: false });
      // where the hiker sees the beam land: the point on the beam axis closest to them, dropped to the ground
      let spot = null;
      if (SL.on) { const g = V3(r.ground); const k = Math.max(0, g.clone().sub(o).dot(dir)); const q = o.clone().addScaledVector(dir, k); spot = [q.x, e.world.heightAt(q.x, q.z), q.z]; }
      const ev = r.update(dt, { lit, beam: spot, t });
      const on = r.lampOn(t);
      const d = lv.distanceTo(e.camera.position);
      H.losT = (H.losT || 0) - dt;
      if (H.losT <= 0) { H.losT = 0.25; H.seeGround = e.view.lineOfSight(e.camera.position, lv, { trees: false }); H.seeTrees = e.view.lineOfSight(e.camera.position, lv); }
      const flick = H.seeTrees ? 1 : (0.25 + 0.75 * (Math.sin(t * 9.1 + H.rules.phase) > 0.2 ? 1 : 0.15));
      H.lamp.visible = on && H.seeGround; H.lamp.material.opacity = flick; H.lamp.position.copy(lv); H.lamp.scale.setScalar(Math.max(0.5, d * 0.011)); H.light.position.copy(lv); H.light.intensity = on ? 1.5 : 0;
      if (H.ent) { H.ent.setPosition(V3(r.ground)); const fwd = route_dir(r); if (fwd) H.ent.face(V3(r.ground).add(new THREE.Vector3(fwd[0], 0, fwd[2]))); H.ent.setPose(r.moving ? (Math.floor(t * 1.7) % 2 ? 'step' : 'stand') : 'stand'); H.ent.setVisible(!r.done || r.status === 'saved'); }
      if (!ev) continue;
      if (H.which === 'false') {
        if (ev === 'arrived') { this.say(S.LINES.falseArrived); this.flags.falseWalked = true; this.addLog(S.AUTO_LOG.falseWalked()); this.complete('n2_light'); H.lamp.visible = false; }
      } else {
        if (ev === 'ready') { this.complete('n1_answer'); this.add('n1_guide'); }
        if (ev === 'stopped' && !H.announced.stopped) { H.announced.stopped = true; this.say(S.LINES.hikerStopped); }
        if (ev === 'straying' && !H.announced.stray) { H.announced.stray = true; this.say(S.LINES.hikerStraying); }
        if (ev === 'saved') { this.say(S.LINES.savedN1); this.complete('n1_guide'); this.addLog(S.AUTO_LOG.saved()); this.flags.savedN1 = true; }
        if (ev === 'fell') { this.say(S.LINES.fellN1); this.obj.complete('n1_guide', null, true); this.refreshTracker(); this.addLog(S.AUTO_LOG.lost()); this.flags.lostN1 = true; e.audio.play('breath', { volume: 0.6 }); }
      }
    }
    function route_dir(r) { return r.route.dir ? r.route.dir(r.s) : null; }
    // the false light goes out if left alone too long
    for (const H of this.hikers) if (H.which === 'false' && H.rules.status === 'signalling' && this.clock.hour > 25.5 && !H.rules.done) { H.rules.status = 'out'; this.say(S.LINES.falseOut); this.addLog(S.AUTO_LOG.falseIgnored()); this.complete('n2_light'); }
  }
  onMorseEnd(text, t) {
    if (!isSOS(text)) return;
    if (!this.fuel.power) { this.ui.toast('The lamp is dead. Start the generator.'); return; }
    const SL = this.e.lights.searchlight; const o = SL.worldOrigin(), d = SL.worldDir();
    for (const H of this.hikers) {
      if (H.rules.status !== 'signalling') continue;
      const to = V3(H.rules.lampPos(t)).sub(o);
      if (to.angleTo(d) < THREE.MathUtils.degToRad(7)) {
        H.rules.answer(t);
        if (H.which === 'false') this.say(S.LINES.falseAnswered); else this.say(S.LINES.answeredN1);
        return;
      }
    }
    this.ui.toast('Nobody answers. Point the lamp at the light before you send.');
  }

  // ------------------------------------------------------------------ the Lost Hiker(s) at the tree line
  spawnLost() {
    const e = this.e; const n = 1 + (this.flags.lostN1 ? 1 : 0);
    const tower = this.L.places.tower || [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const path = spreadPath(this.L.treeLine, k, tower);
      const w = new LostHikerWatcher(path, { cap: LOST.nightCap.night2, id: k });
      w.ent = e.entities.spawn('lost_hiker', { position: V3(path[0]), facing: V3(tower), pose: 'stand_tilt' });
      this.lostWatchers.push(w);
    }
    this.add('n2_treeline', { optional: true });
  }
  updateLost(dt, t) {
    for (const w of this.lostWatchers) {
      const c = this.e.view.check(w.ent);
      if (c.visible && c.lit && !this.flags.treeSeen) { this.flags.treeSeen = true; this.say(S.LINES.treeLine); }
      const ev = w.update(dt, c, t);
      if (ev === 'step') { w.ent.setPosition(V3(w.pos)); w.ent.face(V3(this.L.places.tower || [0, 0, 0])); w.ent.setPose(w.steps % 2 ? 'stand' : 'stand_tilt'); this.flags.lostSteps = (this.flags.lostSteps || 0) + 1; }
    }
  }

  // ------------------------------------------------------------------ the Weeper
  updateWeeper(dt, t) {
    const e = this.e, W = this.weeper, h = this.weeperH;
    const c = e.view.check(h);
    const ctx = { check: c, binoculars: this.binocular, night: this.night, rock: A3(this.weeperSeat), gate: this.L.gate || [0, 0, 6], cab: [0, 30, 0],
      trapdoor: this.anchor('IA_trapdoor') ? A3(this.anchor('IA_trapdoor')) : [-1.5, 30, 0], player: this.pos(), playerInCab: this.inCab() };
    const evs = W.update(dt, ctx);
    for (const ev of evs) {
      if (ev === 'hush') { this.say(S.LINES.weeperHush); }
      if (ev === 'resume') this.say(S.LINES.weeperResume);
      if (ev === 'lookup') { /* pose shows it */ }
      if (ev === 'seen') { this.say(S.LINES.weeperSeen); e.audio.play('heart', { volume: 1 }); if (!this.night) { setTimeout(() => this.say(S.LINES.weeperDay), 2500); } this.add('weeper_photo'); }
      if (ev === 'scream') this.say(S.LINES.weeperScream);
      if (ev === 'coming') { this.say(S.LINES.weeperComing); this.add('weeper_photo'); }
      if (ev === 'stairs') { this.say(S.LINES.weeperStairs); }
      if (ev === 'door') { e.audio.play('knock', { position: V3(ctx.trapdoor), volume: 1.5 }); }
      if (ev === 'caught') this.die('weeper');
    }
    // body
    const pose = (W.pose || 'POSE_sit_sob').replace('POSE_', '');
    if (h.pose !== pose) h.setPose(pose);
    if (W.pos) {
      const p = V3(W.pos);
      if (['coming', 'hunting'].includes(W.state)) p.y = e.world.heightAt(p.x, p.z);
      h.setPosition(p);
      if (W.state !== 'sitting' && W.state !== 'hush') h.face(e.camera.position);
    }
    h.setVisible(!['stairs', 'door', 'gone'].includes(W.state) || W.state === 'gone');
    // sound
    const snd = W.state === 'gone' ? 'silent' : W.sound;
    this.sobT = (this.sobT || 0) - dt;
    if (this.sobT <= 0 && (this.sobOn || this.clock.phase !== 'day1')) {
      if (snd === 'sob') { e.audio.play('sob', { position: h.position.clone().add(new THREE.Vector3(0, 1.2, 0)), volume: 1.4 }); this.sobT = 4.5 + Math.random() * 3; }
      else if (snd === 'scream') { e.audio.play('scream', { position: h.position.clone().add(new THREE.Vector3(0, 1.5, 0)), volume: 1.8 }); this.sobT = 2.4 + Math.random(); }
      else this.sobT = 1;
    }
    // fear
    const near = W.pos ? dist(W.pos, this.pos()) : 999;
    const fear = W.triggered ? Math.max(0.25, 1 - near / 120) : 0;
    e.post.params.fear += (fear - e.post.params.fear) * Math.min(1, dt * 1.5);
    if (W.triggered) { this.heartT = (this.heartT || 0) - dt; if (this.heartT <= 0) { e.audio.play('heart', { volume: 0.4 + fear }); this.heartT = 1.4 - fear * 0.8; } }
    if (W.triggered && !W.carrier) this.add('weeper_photo');
  }

  // ------------------------------------------------------------------ photos
  async takePhoto() {
    const e = this.e;
    if (!this.photos.canShoot()) { this.ui.toast('The film pack is empty.'); return; }
    const flash = this.flashOn;
    const h = this.weeperH;
    const pre = e.view.check(h);
    let forbidden = false;
    if (pre.visible && (this.weeper.state === 'sitting' || this.weeper.state === 'hush')) {
      const nth = this.photos.prints.filter((p) => p.subject === 'weeper').length;
      forbidden = this.rng() < lookupChance({ flash, night: this.night, nth });
    }
    const savePose = h.pose;
    if (forbidden) h.setPose('sit_lookup');
    e.audio.play('camera_shutter', { volume: 1 });
    const shot = await e.photo.capture({ flash });
    if (forbidden) h.setPose(savePose);
    const cls = classifyShot(shot.meta, { flash, night: this.night });
    const subject = cls.weeper ? 'weeper' : cls.subject;
    const p = this.photos.take({ subject, forbidden: forbidden && !!cls.weeper, entities: shot.meta.entities, dataURL: shot.dataURL, flash, phase: this.clock.phase, hour: this.clock.hour });
    if (!p) return;
    e.audio.play('camera_eject', { volume: 0.9 });
    this.addLog(S.AUTO_LOG.photo(this.hourText(), subject === 'nothing' ? 'Nothing much.' : subject === 'weeper' ? 'The man at the creek.' : subject.replace('_', ' ') + '.'));
    if (subject === 'weeper') this.complete('d2_photo');
    if (this.weeper.triggered) { if (this.weeper.offerCarrier(p.id)) { this.complete('weeper_photo'); this.add('weeper_send'); } }
    this.lowerCamera(); this.holding = p.id; this.photos.open(p.id);
    // a photo taken while he's looking up is also "seeing" him if the print is looked at later — handled by Photos
  }
  lowerCamera() { this.camRaised = false; this.ui.cameraFrame(null); this.fovTarget = 68; }
  sendFlow(channel) {
    const ph = this.clock.phase, h = this.clock.hour;
    const items = this.photos.sendable().map((p) => ({ p, label: `${p.id} · ${p.subject === 'nothing' ? 'nothing much' : p.subject === 'weeper' ? 'the man at the creek' : p.subject.replace('_', ' ')}${p.faceDown ? ' · face-down' : ''}`, img: p.faceDown ? null : p.dataURL }));
    this.openModal(() => this.ui.choose('Send which print?', items, (it) => {
      const r = sendPrint(it.p, channel, { phase: ph, hour: h, day: PHASES[ph].day });
      if (!r.ok) { this.ui.toast(r.why); return; }
      if (r.proof) this.proofs++;
      this.addLog(S.AUTO_LOG.sent(channel, this.hourText()));
      this.complete('d2_send');
      if (channel === 'fax') { this.say(S.LINES.faxSent); this.flags.faxUsed = true; }
      if (channel === 'mailbox') this.say(S.LINES.mailSent);
      if (channel === 'driver') this.say(it.p.faceDown ? S.LINES.driverFaceDown : it.p.forbidden ? S.LINES.driverFace : S.LINES.driverNormal);
      if (this.weeper.sendAway(it.p.id)) { this.say(S.LINES.weeperGone); this.complete('weeper_send'); this.obj.remove('weeper_photo'); this.refreshTracker(); }
    }, () => this.closedModal()));
  }

  // ------------------------------------------------------------------ interactions
  interactions() {
    const e = this.e, I = e.interact;
    const reg = (id, anchor, label, onUse, enabled = () => true, radius = 0.5) => I.register({ id, anchor: typeof anchor === 'string' ? (this.anchor(anchor) || anchor) : anchor, label, onUse, enabled: () => this.state === 'play' && this.mode === 'walk' && enabled(), radius, reach: 2.6 });
    reg('radio', 'IA_radio', () => this.obj.has('d1_radio') && !this.obj.isDone('d1_radio') ? 'E — Call Silver Fork' : 'E — Radio (nothing to report)', () => {
      if (this.obj.has('d1_radio') && !this.obj.isDone('d1_radio')) { e.audio.play('radio_squelch'); this.say(S.LINES.briefing, { onDone: () => { this.complete('d1_radio'); this.add('d1_rules'); } }); }
      else { e.audio.play('radio_squelch'); this.ui.toast('Static. Silver Fork is quiet.'); }
    });
    reg('finder', 'IA_firefinder', () => this.obj.has('d1_rules') && !this.obj.isDone('d1_rules') ? 'E — Read the card taped to the fire finder' : 'E — Use the fire finder', () => {
      if (this.obj.has('d1_rules') && !this.obj.isDone('d1_rules')) {
        this.openModal(() => this.ui.note('Tillman\'s rules', S.RULES.slice(0, this.flags.rulesTo).map((r, i) => `${i + 1}. ${r}`).join('\n'), () => { this.closedModal(); this.complete('d1_rules'); this.add('d1_fuel'); }));
      } else this.enterFinder();
    });
    reg('tillman', 'IA_logbook', 'E — Read Tillman\'s logbook', () => { this.flags.readTillman = true; this.openLogbook('tillman'); });
    reg('map', 'IA_map', 'E — The trail map', () => this.openMap());
    reg('heater', 'IA_heater', () => this.co.heater ? 'E — Turn the heater off' : 'E — Light the propane heater', () => { this.co.toggleHeater(); e.audio.play('door', { volume: 0.2 }); });
    for (const k of ['n', 'e', 's', 'w']) reg('win_' + k, 'IA_window_' + k, () => this.co.windows[k] ? 'E — Close the window' : 'E — Open the window', () => { this.co.toggleWindow(k); e.audio.play('door', { volume: 0.3 }); }, () => true, 0.7);
    reg('hatch', 'IA_trapdoor', () => this.fuel.carrying ? 'E — Set the can down by the hatch' : `E — Take the can (${this.fuel.cabCans} here)`, () => {
      if (this.fuel.carrying) { this.fuel.stow('cab'); this.player().carrying = null; this.complete('d1_fuel'); this.complete('d2_fuel'); e.audio.play('fuel_pour', { volume: 0.2 }); }
      else if (this.fuel.pickUp('cab').ok) { this.player().carrying = 'fuel'; }
    }, () => this.fuel.carrying || this.fuel.cabCans > 0, 0.8);
    reg('searchlight', 'IA_searchlight', 'E — Take the searchlight', () => this.enterSearchlight(), () => true, 0.7);
    reg('cans', 'IA_fuel_cans', () => `E — Pick up a can of fuel (${this.fuel.baseCans} left)`, () => { const r = this.fuel.pickUp('base'); if (r.ok) this.player().carrying = 'fuel'; else this.ui.toast(r.why); }, () => !this.fuel.carrying);
    reg('generator', 'IA_generator', () => this.fuel.carrying ? 'E — Pour the fuel into the generator' : this.fuel.genOn ? 'E — Stop the generator' : 'E — Start the generator', () => {
      if (this.fuel.carrying) { this.fuel.pour(); this.player().carrying = null; e.audio.play('fuel_pour'); this.addLog(S.AUTO_LOG.refuel(this.hourText())); this.complete('n1_refuel'); this.complete('n2_refuel'); this.flags.refueledOnce = true; }
      else if (this.fuel.genOn) { this.fuel.stop(); e.audio.play('generator_stop'); }
      else { const r = this.fuel.start(); if (r.ok) { e.audio.play('generator_start'); this.complete('d1_generator'); } else this.ui.toast('The tank is dry.'); }
    }, () => true, 0.7);
    reg('camera', 'IA_camera_shelf', 'E — Take the camera', () => { this.photos.giveCamera(1); this.flags.hasCamera = true; this.say(S.LINES.cameraFound); this.complete('d1_camera'); this.ph.camera && (this.ph.camera.visible = false); this.ui.toast('C — raise the camera', 5); }, () => this.flags.cameraOut && !this.photos.hasCamera);
    reg('mailbox', 'IA_mailbox', 'E — Mail a photograph', () => this.sendFlow('mailbox'), () => this.photos.sendable().length > 0);
    reg('fax', 'IA_fax', 'E — Fax a photograph to the district', () => this.sendFlow('fax'), () => this.photos.sendable().length > 0);
    reg('truck', 'IA_truck', () => this.photos.sendable().length ? 'E — Give Walt a photograph' : 'E — Talk to Walt', () => { if (this.photos.sendable().length) this.sendFlow('driver'); else this.say(S.LINES.driverHello); }, () => this.truckVisible);
    reg('pack', 'IA_camp_backpack', 'E — Search the pack', () => {
      const f = S.FINDS.camp_backpack; this.flags.rulesTo = Math.max(this.flags.rulesTo, f.rulesTo);
      this.openModal(() => this.ui.note(f.title, f.text + '\n\n' + S.RULES.slice(5, 8).map((r, i) => `${i + 6}. ${r}`).join('\n'), () => { this.closedModal(); this.complete('d2_camp'); }));
    }, () => this.clock.phase === 'day2');
    reg('overlook', 'IA_overlook', 'E — Look over the rail', () => {
      const f = this.flags.lostN1 ? S.FINDS.body : S.FINDS.noBody;
      if (this.flags.lostN1 && !this.bodyEnt) { const ov = V3(this.L.places.ravine_overlook); this.bodyEnt = e.entities.spawn('lost_hiker_body', { position: new THREE.Vector3(ov.x + 22, e.world.heightAt(ov.x + 22, ov.z + 4), ov.z + 4), pose: 'body' }); }
      this.player().lookAt(V3(this.L.places.ravine_overlook).add(new THREE.Vector3(24, -30, 4)), 1.2);
      setTimeout(() => this.openModal(() => this.ui.note(f.title, f.text, () => { this.closedModal(); this.complete('d2_overlook'); })), 1400);
    }, () => this.clock.phase === 'day2');
    reg('rest', 'IA_bed', 'E — Lie down and rest (let the hours pass)', () => {
      this.resting = true; this.clock.speed = 14; e.post.set({ blackout: 0.85 }); this.ui.toast('You lie down. The hours go by.', 3);
    }, () => !this.obj.current() && !this.resting && !this.weeper.triggered, 0.8);
    reg('spring', 'IA_spring', 'E — Drink from the spring', () => { this.co.cold = Math.max(0, this.co.cold - 0.1); this.ui.toast('Cold enough to hurt your teeth.'); });
  }

  // ------------------------------------------------------------------ modes
  enterFinder() {
    this.mode = 'finder'; const p = this.player(); p.setEnabled(false); p.lookLocked = true; this.fovTarget = 32;
    this.finderPos = (this.anchor('IA_firefinder') || new THREE.Vector3(0.3, 31, -0.15)).clone().add(new THREE.Vector3(0, 0.55, 0));
  }
  enterSearchlight() {
    this.mode = 'searchlight'; const p = this.player(); p.setEnabled(false); p.lookLocked = true;
    const SL = this.e.lights.searchlight; SL.operating = true; this.slLit = true; this.fovTarget = 58;
  }
  exitMode() {
    const p = this.player && this.e.player ? this.e.player : null; if (!p) return;
    if (this.mode === 'searchlight') { this.e.lights.searchlight.operating = false; }
    if (this.mode === 'finder' || this.mode === 'searchlight') {
      const a = this.mode === 'finder' ? (this.anchor('IA_firefinder') || new THREE.Vector3(0.3, 30, -0.15)) : (this.anchor('IA_searchlight') || new THREE.Vector3(2, 30, 2));
      p.position.set(a.x + (this.mode === 'finder' ? -0.6 : 0), 30.0, a.z + (this.mode === 'finder' ? 0.3 : 0));
      p.yaw = this.e.camera.rotation.y; p.pitch = 0;
    }
    this.mode = 'walk'; p.setEnabled(true); p.lookLocked = false; this.fovTarget = 68;
    this.ui.finder(null); this.ui.searchlight(null);
  }
  openModal(fn) { this.e.uiBlocking = true; this.e.input.unlock(); this.player().setEnabled(false); fn(); }
  closedModal() { this.e.uiBlocking = false; this.player().setEnabled(this.mode === 'walk'); }
  openLogbook(page = 'tasks') {
    const o = this.obj;
    const data = {
      date: PHASES[this.clock.phase].date + ' · ' + this.hourText(),
      tasks: o.list.map((x) => ({ text: o.text(x), hint: o.hint(x), done: x.done, urgent: x.urgent })),
      rules: S.RULES.slice(0, this.flags.rulesTo || 5), rulesTyped: 5,
      tillman: this.flags.readTillman ? S.PREV_LOG.map((en) => ({ ...en, text: S.coDistort(en.text, this.co.blood) })) : [],
      mine: this.log.map((en) => ({ ...en, text: S.coDistort(en.text, this.co.blood) })),
      photos: this.photos.prints.map((p) => ({ id: p.id, dataURL: p.dataURL, develop: p.develop, faceDown: p.faceDown, sent: !!p.sent })),
      proofs: this.proofs, proofGoal: S.PROOF_GOAL,
      onPhoto: (id) => { this.ui.closeModal(); this.holding = id; this.photos.open(id); },
    };
    this.openModal(() => this.ui.logbook(data, () => this.closedModal(), page));
  }
  openMap() {
    const W = this.e.world;
    const places = {}; for (const k of ['tower', 'trailhead', 'hikers_camp', 'burn_scar', 'spring', 'ravine_overlook', 'creek_bridge']) if (this.L.places[k]) places[k.replace('_', ' ')] = this.L.places[k];
    this.openModal(() => this.ui.map({ segments: W.layout.trail ? W.layout.trail.segments : [], places, player: this.pos(), rect: W.rect, heightAt: W.heightAt,
      creek: W.layout.creek && W.layout.creek.points, ravine: W.layout.ravine && W.layout.ravine.polygon }, () => this.closedModal()));
  }

  inputs() {
    const e = this.e, In = e.input;
    In.onAction('interact', (d) => {
      if (!d || this.state !== 'play') return;
      if (this.ui.modalOpen()) { this.ui.closeModal(); return; }
      if (this.mode === 'finder') { this.reportFinder(); return; }
      if (this.mode === 'searchlight') { this.slLit = !this.slLit; return; }
      e.interact.use();
    });
    In.onAction('pause', (d) => {
      if (!d) return;
      if (this.ui.modalOpen()) { this.ui.closeModal(); return; }
      if (this.mode !== 'walk') { this.exitMode(); return; }
      if (this.camRaised) { this.lowerCamera(); return; }
      if (this.holding) { this.holding = null; this.photos.close(); this.ui.print(null); return; }
      if (this.state === 'play') this.onPause && this.onPause();
    });
    In.onAction('searchlight', (d) => { if (!d || this.state !== 'play') return; if (this.camRaised) { this.flashOn = !this.flashOn; return; } if (this.mode === 'searchlight') this.exitMode(); });
    In.onAction('logbook', (d) => { if (!d || this.state !== 'play') return; if (this.ui.modalOpen()) this.ui.closeModal(); else if (this.mode === 'walk') this.openLogbook(); });
    In.onAction('map', (d) => { if (!d || this.state !== 'play') return; if (this.ui.modalOpen()) this.ui.closeModal(); else if (this.mode === 'walk') this.openMap(); });
    In.onAction('camera', (d) => {
      if (!d || this.state !== 'play' || this.mode !== 'walk') return;
      if (this.holding) { this.holding = null; this.photos.close(); this.ui.print(null); return; }
      if (!this.photos.hasCamera) { this.ui.toast('You don\'t have a camera.'); return; }
      this.camRaised = !this.camRaised; this.fovTarget = this.camRaised ? 58 : 68; if (!this.camRaised) this.ui.cameraFrame(null);
    });
    In.onAction('primary', (d) => { if (d && this.camRaised && this.state === 'play') this.takePhoto(); });
    In.onAction('flip', (d) => {
      if (!d || !this.holding) return;
      const r = this.photos.flipOrShake();
      if (r === 'flipped') { e.audio.play('paper', { volume: 0.5 }); }
    });
    In.onAction('flashlight', (d) => { if (d && this.state === 'play') { e.lights.flashlight.on = !e.lights.flashlight.on; e.audio.play('morse_click', { volume: 0.3 }); } });
    In.onAction('binoculars', (d) => { if (this.state !== 'play' || this.mode !== 'walk') { this.binocular = false; return; } this.binocular = d; });
    In.onAction('signal', (d) => {
      if (this.mode !== 'searchlight') return;
      const t = e.time.value;
      if (d) { this.signal.mode = true; this.signal.last = t; this.keyer.down(t); e.audio.play('morse_click', { volume: 0.5 }); }
      else { this.signal.last = t; this.keyer.up(t); e.audio.play('morse_click', { volume: 0.35 }); }
    });
  }
  reportFinder() {
    const fires = this.activeFires();
    const r = this.finder.report(fires.length ? fires : this.L.fireSites.filter((f) => this.flags['fire_' + f.name]));
    const spoken = spokenBearing(r.bearing);
    const phase = this.clock.phase;
    if (!fires.length) { this.say([{ who: S.WHO.YOU, text: `Silver Fork, Tamarack. Nothing to report.`, radio: true }]); return; }
    if (r.ok) {
      this.flags['fireReported_' + r.fire.name] = true;
      const lines = this.night ? S.LINES.fireOk(spoken, r.fire.name) : S.LINES.smokeOk(spoken, r.fire.name);
      this.say(lines);
      this.addLog(this.night ? S.AUTO_LOG.glow(r.bearing, r.fire.name) : S.AUTO_LOG.smoke(r.bearing, r.fire.name));
      this.complete(phase === 'day1' ? 'd1_smoke' : phase === 'night1' ? 'n1_fire' : 'n2_fire');
      if (!this.night) this.smokeFade = 0;
      this.exitMode();
    } else this.say(this.night ? S.LINES.fireBad(spoken) : S.LINES.smokeBad(spoken));
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    const e = this.e;
    this.ui.update(dt);
    if (this.state !== 'play') return;
    this.phaseTime += dt;
    // clock → sky
    this.clock.tick(dt);
    e.sky.setTime(dayHour(this.clock.hour));
    // radio
    if (this.resting && (this.obj.current() || this.radio.busy || e.input.isDown('forward') || e.input.isDown('back') || this.clock.held)) { this.resting = false; this.clock.speed = 1; e.post.set({ blackout: 0 }); }
    for (const ev of this.radio.tick(dt)) {
      if (ev.kind === 'start') {
        const l = ev.line;
        this.ui.subtitle(l.who, l.text, l.dur, { radio: l.radio, note: l.note });
        if (l.radio) { e.audio.play('radio_squelch', { volume: 0.5 }); if (l.who !== S.WHO.YOU) e.audio.play('radio_voice', { text: l.text, volume: 0.6 }); }
      }
    }
    // fuel + generator + searchlight power
    const SL = e.lights.searchlight;
    const beamOn = this.mode === 'searchlight' ? this.slLit : this.slLit && !this.leftOff;
    for (const ev of this.fuel.tick(dt, SL.on)) {
      if (ev === 'low') { this.say(S.LINES.fuelLow); if (this.night) this.add(this.clock.phase === 'night1' ? 'n1_refuel' : 'n2_refuel', { urgent: true }); }
      if (ev === 'empty') { this.say(S.LINES.fuelEmpty); e.audio.play('generator_stop'); }
    }
    const sigMode = this.signal.mode && t - this.signal.last < 2.4;
    if (!sigMode) this.signal.mode = false;
    SL.on = this.fuel.power && !!this.slLit && (sigMode ? e.input.isDown('signal') : true);
    SL.power = this.fuel.power ? 1 - this.fuel.sputter * 0.7 : 0;
    e.audio.setAmbience({ generator: this.fuel.genOn ? 1 : 0, rain: e.sky.weather.rain, wind: e.sky.weather.wind, forest: this.night ? 0.8 : 0.6, radioStatic: this.inCab() ? 0.35 : 0 });
    for (const ev of this.keyer.update(t)) if (ev.kind === 'end') this.onMorseEnd(ev.v, t);
    // modes: camera placement
    const cam = e.camera;
    if (this.mode === 'searchlight') {
      const o = SL.worldOrigin(), d = SL.worldDir();
      cam.position.copy(o).addScaledVector(d, -1.25).add(new THREE.Vector3(0, 0.32, 0));
      cam.lookAt(o.clone().addScaledVector(d, 30));
      this.ui.searchlight({ fuel: this.fuel.frac, morse: this.keyer.display(), power: this.fuel.power });
    } else if (this.mode === 'finder') {
      let dir = 0; if (e.input.isDown('left')) dir -= 1; if (e.input.isDown('right')) dir += 1;
      this.finder.step(dt, dir, e.input.isDown('jog'), this.co.cold);
      const b = THREE.MathUtils.degToRad(this.finder.ring);
      cam.position.copy(this.finderPos);
      cam.lookAt(this.finderPos.clone().add(new THREE.Vector3(Math.sin(b) * 100, -2.2, -Math.cos(b) * 100)));
      this.ui.finder({ readout: this.finder.readout });
    }
    // fov (camera, binoculars, finder)
    const fovT = this.binocular && this.mode === 'walk' ? 16 : this.fovTarget;
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    cam.userData.zoom = 68 / cam.fov;
    this.ui.binoculars(this.binocular && this.mode === 'walk');
    if (this.camRaised) this.ui.cameraFrame({ left: this.photos.packLeft, flash: this.flashOn });
    // prints
    for (const ev of this.photos.tick(dt)) {
      if (ev.kind === 'seen') {
        const p = this.photos.get(ev.id);
        if (p && p.forbidden) { this.weeper.trigger('print', { night: this.night, carrier: p.id }); this.say(S.LINES.weeperSeen); e.audio.play('heart', { volume: 1 }); this.add('weeper_send'); }
      }
    }
    if (this.holding) { const p = this.photos.get(this.holding); const v = this.photos.look(this.holding); this.ui.print(p && v ? { ...v, dataURL: p.dataURL } : null); } else this.ui.print(null);
    // CO
    const coEv = this.co.tick(dt, { inCab: this.inCab(), night: this.night, rng: this.rng });
    e.post.params.co = this.co.blood;
    for (const ev of coEv) {
      if (ev === 'shiver') this.say(S.LINES.shiver);
      if (ev === 'passout') { e.post.set({ blackout: 1 }); this.say(S.LINES.passout); setTimeout(() => { this.co.wake(); e.post.set({ blackout: 0 }); this.say(S.LINES.wakeWindow); }, 3500); }
      if (ev.startsWith('hallucinate:')) this.hallucinate(ev.split(':')[1]);
    }
    // world entities
    this.updateHikers(dt, t);
    this.updateLost(dt, t);
    this.updateWeeper(dt, t);
    if (this.otherEnt && this.bedSitterT != null) { this.bedSitterT += dt; const c = e.view.check(this.otherEnt); if (!c.inFrustum && this.bedSitterT > 3) { this.otherEnt.remove(); this.otherEnt = null; this.bedSitterT = null; } }
    // smoke by day
    if (this.smoke.visible) { this.smoke.material.opacity += ((this.smokeFade || 0) * 0.55 - this.smoke.material.opacity) * Math.min(1, dt * 0.5); if (this.smoke.material.opacity < 0.01 && !this.smokeFade) this.smoke.visible = false; }
    // truck / placeholders visibility
    const truck = e.scene.getObjectByName('placed:prop_supply_truck') || this.ph['prop_supply_truck']; if (truck) truck.visible = !!this.truckVisible;
    // held can in view, watch
    this.ui.watch(e.input.isDown('watch'), fmtHour(this.clock.hour) + (this.clock.held ? '' : ''));
    // the path rule, said once
    if (this.player().blockedByPath && !this.flags.toldPath) { this.flags.toldPath = true; this.ui.toast('Stay on the trail. The timber is thick and the ground falls away.'); }
    // script + tracker
    this.scriptTick(dt);
    this.trackerT = (this.trackerT || 0) - dt; if (this.trackerT <= 0) { this.trackerT = 1; this.refreshTracker(); }
  }
  hallucinate(kind) {
    const e = this.e;
    this.say(S.LINES.hallu[kind] || []);
    if (kind === 'figure') { const h = e.entities.spawn('other_lookout', { position: new THREE.Vector3(2.6, 30.0, 1.2), facing: new THREE.Vector3(0, 30, 0), pose: 'back_window' }); setTimeout(() => h.remove(), 1600); }
    if (kind === 'knock') e.audio.play('knock', { position: this.anchor('IA_trapdoor') || new THREE.Vector3(-1.5, 30, 0), volume: 1.2 });
  }

  // ------------------------------------------------------------------ test hooks
  skipTo(phase) { if (!this.clock) this.fresh(phase); if (isNight(phase)) this.fuel.genOn = this.fuel.tank > 0; if (phase !== 'day1' && !this.photos.hasCamera) this.photos.giveCamera(1); this.startPhase(phase, false); return phase; }
  setTime(h) { this.clock.setHour(h); return this.clock.hour; }
}
