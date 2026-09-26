// FALSE LIGHT — the game: wires the pure rules (clock, objectives, fuel, morse, hikers, the Weeper, photos,
// sending, CO, the Other Lookout) to the engine and the UI, and runs the Day 1 → Night 2 script.
import * as THREE from 'three';
import { Clock, PHASES, isNight, nextPhase } from './clock.js?v=239df90c';
import { Objectives } from './objectives.js?v=239df90c';
import { Radio } from './radio.js?v=239df90c';
import { Fuel, FUEL } from './fuel.js?v=239df90c';
import { Inventory, KINDS, HAND_SLOTS, PACK_SLOTS } from './items.js?v=239df90c';
import { Survival, SURV } from './survival.js?v=239df90c';
import { createItemsView } from './itemsView.js?v=239df90c';
import { createChill } from './chill.js?v=239df90c';
import { createPlume } from './smokePlume.js?v=239df90c';
import { FireFinder, spokenBearing } from './firefinder.js?v=239df90c';
import { Photos, classifyShot } from './photos.js?v=239df90c';
import { CO } from './co.js?v=239df90c';
import { Weeper, lookupChance } from './weeper.js?v=239df90c';
import { OtherLookout } from './otherLookout.js?v=239df90c';
import { LostHikerWatcher, LOST, spreadPath } from './lostHiker.js?v=239df90c';
import { GuidedHiker } from './hikers.js?v=239df90c';
import { MorseKeyer, isSOS } from './morse.js?v=239df90c';
import { normalizeLayout } from './layout.js?v=239df90c';
import { createSaves } from './saves.js?v=239df90c';
import { createRng } from './rng.js?v=239df90c';
import { canSend, send as sendPrint, isProof } from './sending.js?v=239df90c';
import { fmtHour, dayHour, dist, dist2d, bearing, angDiff } from './util.js?v=239df90c';
import * as S from './content/story.js?v=239df90c';
import { createDog, setDogName } from './dog.js?v=239df90c';
import { createWildlife } from './wildlife.js?v=239df90c';

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
    this.lampPool = [0, 1].map(() => { const l = new THREE.PointLight(0xffd9a0, 0, 12, 2); this.e.scene.add(l); return l; });   // created up front: adding lights later recompiles every shader
    this.smoke = createPlume(e.scene);
    // entities that exist every day
    const seat = W.weeperSeat || V3(this.L.places.weeper_rock || [58, -42, 196]);
    this.weeperSeat = seat;
    this.weeperH = e.entities.spawn('weeper', { position: seat.clone(), facing: V3(this.L.places.creek_bridge || [34, -46, 176]), pose: 'sit_sob' });
    this.interactions();
    this.inputs();
    this.iv = createItemsView(e); this.itemIA = new Map(); this.health = 1; this.limp = 0;
    e.player.onLand = (drop, v) => this.onLand(drop, v);
    this.itemsReady = this.iv.load().then(() => { try { this.iv.buildSurfaces(); } catch (err) { console.warn('surfaces', err); } this.syncItems(); }).catch((err) => console.warn('items', err));
    // Juniper, the stray on the spring trail (src/game/dog.js + dogBrain.js)
    this.dog = null;
    this.dogReady = createDog(e, {
      foodInHands: () => (this.inv ? this.inv.inHands('food') : null),
      eatFood: (it) => { this.inv.remove(it.id); this.syncItems(); e.audio.sfx('metal', { volume: 0.25 }); },
      toast: (text, secs) => this.ui.toast(text, secs),
      say: (text) => this.say([{ who: S.WHO.NOTE, text, note: true }]),
      onTamed: () => {   // you name her
        this.openModal(() => this.ui.ask('She\'s yours now', 'She leans her whole weight against your leg. What do you call her?', this.flags.dogName || 'Juniper', (v) => {
          const n = setDogName(v || this.flags.dogName || 'Juniper'); this.flags.dogName = n; this.closedModal();
          this.ui.toast(`You call her ${n}. Her ears go up at it.`, 4);
        }));
      },
      isPlay: () => this.state === 'play',
      walkMode: () => this.mode === 'walk' && !this.placing && !this.camRaised,
      night: () => !!this.clock && this.night,
      weeperNear: () => (this.weeper && this.weeperH && this.weeper.state !== 'gone' ? this.weeperH.position : null),
      onDogWarn: (info) => {
        if (!info || info.playerDistance > 30) return;   // she froze somewhere you couldn't see it
        this._dogWarns = (this._dogWarns || 0) + 1;
        if (this._dogWarns > 2 && !this.weeper.triggered) return;
        const st = this.weeper.state;
        const where = ['stairs', 'door'].includes(st) ? 'at the door' : ['coming', 'hunting'].includes(st) ? 'into the dark' : 'toward the creek';
        this.say([{ who: S.WHO.NOTE, note: true, text: info.tamed
          ? `${this.flags.dogName || 'Juniper'} stops dead. Hackles up, ears flat, staring ${where}. A growl you feel more than hear.`
          : `The stray has frozen on the trail, hackles up, staring ${where}.` }]);
      },
    }).then((d) => {
      this.dog = d; if (window.__fl) window.__fl.dog = d; setDogName(this.flags.dogName || 'Juniper');
      if (this._dogSave !== undefined) { if (this._dogSave) d.restore(this._dogSave); else d.reset(); this._dogSave = undefined; }
      return d;
    }).catch((err) => console.warn('dog', err));
    // deer, the black bear, birds / owls / coyotes (src/game/wildlife.js + wildlifeBrain.js)
    this.wildlife = null;
    this.wildReady = createWildlife(e, {
      isPlay: () => this.state === 'play',
      night: () => !!this.clock && this.night,
      dog: () => this.dog,
      hurt: (amount, why) => this.hurt(amount, why),
      fear: (amount) => { this.bearFear = Math.min(1, Math.max(this.bearFear || 0, amount)); },   // held while it's near (decays when not refreshed)
      scare: (o = {}) => this.scare(o),
      dogWhine: (pos) => { if (e.audio.has('dog_whine')) e.audio.play('dog_whine', { position: pos, volume: 0.8 }); },
      say: (text) => this.say([{ who: S.WHO.NOTE, text, note: true }]),
      toast: (text, secs) => this.ui.toast(text, secs),
      sfx: (name, pos, volume) => { if (e.audio.has(name)) e.audio.play(name, { position: pos, volume }); },
      weeperNear: () => (this.weeper && this.weeperH && this.weeper.state !== 'gone' ? this.weeperH.position : null),
      weeperTriggered: () => !!(this.weeper && this.weeper.triggered),
      dogSwat: () => { const d = this.dog; if (d && d.tamed && d.brain.command('come')) d.brain.events.pop(); },   // she bolts back to you (the wildlife line says why)
    }).then((w) => {
      this.wildlife = w; if (window.__fl) window.__fl.wild = w;
      if (this._wildSave !== undefined) { if (this._wildSave) w.restore(this._wildSave); else w.reset(); this._wildSave = undefined; }
      return w;
    }).catch((err) => console.warn('wildlife', err));
    e.onUpdate((dt, t) => this.update(dt, t));
    // benches and the catwalk chair: sit, look, let the time go by (src/game/chill.js)
    this.sitting = false;
    this.chill = createChill(e, {
      isPlay: () => this.state === 'play',
      walkMode: () => this.mode === 'walk',
      setSitting: (b) => { this.sitting = b; if (b) { this.binocular = false; if (this.placing) this.cancelPlace(); } },
      setTimeScale: (k) => { if (this.clock && !this.resting) this.clock.speed = k; },
      calm: (dt) => {
        const P = e.post.params;
        if (!(this.weeper && this.weeper.triggered)) P.fear = Math.max(0, P.fear - dt * 0.25);
        if (this.co) this.co.blood = Math.max(0, this.co.blood - dt * 0.006);
        this.limp = Math.max(0, (this.limp || 0) - dt / 40);
      },
      toast: (text, s) => this.ui.toast(text, s),
      say: (text) => this.ui.subtitle('', text, 7, { note: true }),
      danger: () => !!(this.weeper && this.weeper.triggered),
      canFastForward: () => !(this.radio && this.radio.busy) && !(this.clock && this.clock.held) && !(this.obj && this.obj.current() && this.obj.current().urgent),
      isNight: () => !!this.clock && this.night,
      ownInteract: false,
    });
    // the benches are placement surfaces too, once they're in
    Promise.all([this.itemsReady, this.chill.ready]).then(() => { try { this.iv.buildSurfaces(); } catch (err) { console.warn('surfaces', err); } });
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
    this.coffee = null;
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
    this.inv = this.startInventory(phase); this.surv = new Survival(); this.placing = null;
  }
  /** Your kit + what's at the lookout: three cans by the shed door, tins on the cab shelf. */
  startInventory(phase = 'day1') {
    const fa = this.anchor('IA_fuel_cans') || new THREE.Vector3(7.05, 0.4, 7.9);
    const fuel = [[0, 0], [0.38, -0.05], [0.15, -0.42]].map(([dx, dz]) => [fa.x - 0.15 + dx, fa.y, fa.z + dz]);
    const food = [[0.5, -1.86], [0.63, -1.9], [0.76, -1.85]].map(([x, z]) => [x, 31.3, z]);
    const inv = Inventory.start({ fuel, food });
    for (const it of inv.world) it.settle = true;
    if (phase !== 'day1') {   // starting later (skip / old save): a can already up top, and the camera
      const can = inv.world.find((i) => i.kind === 'fuel'); if (can) can.pos = [2.58, 30.2, 0.6];
      inv.create('camera', { where: 'pack', slot: 4 });
    }
    return inv;
  }
  /** Saves from before the item system: rebuild the same situation. */
  migrateInventory(s) {
    const inv = this.startInventory('day1'), f = s.fuel || {};
    const cans = inv.world.filter((i) => i.kind === 'fuel');
    for (let k = 0; k < Math.min(f.cabCans || 0, cans.length); k++) cans[k].pos = [2.58, 30.2, 0.6 - k * 0.45];
    if (f.carrying && cans[2]) Object.assign(cans[2], { where: 'hand', slot: 1, pos: null });
    if (s.photos && s.photos.hasCamera) inv.create('camera', { where: 'pack', slot: 4 });
    return inv;
  }
  snapshot() {
    const P = this.e.player;
    return { phase: this.clock.phase, hour: this.clock.hour, flags: { ...this.flags }, fuel: this.fuel.toJSON(), photos: this.photos.toJSON(), co: this.co.toJSON(),
      weeper: this.weeper.toJSON(), other: this.other.toJSON(), log: this.log.map((x) => ({ ...x })), proofs: this.proofs, obj: this.obj.toJSON(),
      fired: [...(this.fired || [])], truckVisible: !!this.truckVisible, slLit: !!this.slLit, inv: this.inv.toJSON(), surv: this.surv.toJSON(), health: this.health ?? 1, chillSeen: this.chill ? this.chill.toJSON() : [], dog: this.dog ? this.dog.toJSON() : (this._dogSave || null), wildlife: this.wildlife ? this.wildlife.toJSON() : (this._wildSave || null),
      player: { pos: [P.position.x, P.position.y, P.position.z], yaw: P.yaw },
      hikers: (this.hikers || []).map((h) => ({ which: h.which, s: h.rules.s, off: h.rules.off, status: h.rules.status })),
      lost: (this.lostWatchers || []).map((w) => ({ idx: w.idx, steps: w.steps })) };
  }
  clearWorldEntities() {
    for (const h of this.hikers || []) { h.ent && h.ent.remove(); h.lamp && this.e.scene.remove(h.lamp); if (h.light) h.light.intensity = 0; }
    for (const w of this.lostWatchers || []) w.ent && w.ent.remove();
    this.hikers = []; this.lostWatchers = [];
  }
  restore(s) {
    this.clearWorldEntities();
    this.fresh(s.phase);
    this.flags = { rulesTo: 5, ...s.flags }; this.fuel = new Fuel(s.fuel); this.photos = new Photos(s.photos); this.co = new CO(s.co);
    this.weeper = new Weeper(s.weeper); this.other = new OtherLookout(s.other); this.log = (s.log || []).map((x) => ({ ...x })); this.proofs = s.proofs || 0;
    this.inv = s.inv ? new Inventory(s.inv) : this.migrateInventory(s); this.surv = new Survival(s.surv || {}); this.health = s.health ?? 1; this.limp = 0;
    setDogName(this.flags.dogName || 'Juniper');
    if (this.dog) { if (s.dog) this.dog.restore(s.dog); else this.dog.reset(); } else this._dogSave = s.dog || null;
    if (this.wildlife) { if (s.wildlife) this.wildlife.restore(s.wildlife); else this.wildlife.reset(); } else this._wildSave = s.wildlife || null;
    if (this.chill) this.chill.load(s.chillSeen || []);
  }
  /** Secret checkpoints: silent saves of exactly where you are. Never during a chase (you'd respawn into it). */
  checkpoint(reason = '') {
    if (this.state !== 'play' && reason !== 'pause') return false;
    if (!this.clock || ['coming', 'stairs', 'door', 'hunting', 'caught'].includes(this.weeper.state)) return false;
    if (this.e.player.velocity && Math.abs(this.e.player.velocity.y) > 1) return false;   // not mid-fall
    const now = performance.now();
    if (reason !== 'pause' && this._cpAt && now - this._cpAt < 4000) return false;
    this._cpAt = now;
    this.cpSnap = this.snapshot(); this.cpSnap.reason = reason;
    this.persist();
    return true;
  }
  persist() { this.saves.save({ ...(this.lastSaved || this.snapshot()), checkpoint: this.cpSnap || null }); }
  // ------------------------------------------------------------------ flow
  newGame() { setDogName('Juniper'); if (this.dog) this.dog.reset(); else this._dogSave = null; if (this.wildlife) this.wildlife.reset(); else this._wildSave = null; if (this.chill) this.chill.load([]); this.saves.clear(); this.cpSnap = null; this.fresh('day1'); this.startPhase('day1'); }
  continueGame() {
    const s = this.saves.load(); if (!s) return this.newGame();
    this.lastSaved = { ...s }; delete this.lastSaved.checkpoint;
    const cp = s.checkpoint && s.checkpoint.phase === s.phase ? s.checkpoint : null;
    this.restore(cp || s); this.startPhase(s.phase, true, cp);
  }
  restartPhase() { const s = this.lastSaved || this.saves.load(); if (!s) return this.newGame(); this.cpSnap = null; this.restore(s); this.startPhase(s.phase, true); }
  retry() {
    const cp = this.cpSnap && this.lastSaved && this.cpSnap.phase === this.lastSaved.phase ? this.cpSnap : null;
    if (cp) { this.restore(cp); this.startPhase(cp.phase, true, cp); return; }
    this.restartPhase();
  }
  startPhase(phase, restored = false, cp = null) {
    this._cpHour = null; this._lastZone = null;
    const e = this.e;
    e.uiBlocking = false; this.binocular = false; if (this.camRaised) this.lowerCamera(); if (this.photos) this.photos.close(); this.ui.print(null);
    if (!restored || !this.clock || this.clock.phase !== phase) this.clock = new Clock(phase);
    this.obj = new Objectives(S.OBJECTIVES); this.radio = new Radio();
    this.fired = new Set(); this.phaseTime = 0; this.state = 'play';
    for (const h of this.hikers) h.ent && h.ent.remove(); for (const h of this.hikers) { h.lamp && e.scene.remove(h.lamp); if (h.light) h.light.intensity = 0; }
    for (const w of this.lostWatchers) w.ent.remove();
    this.hikers = []; this.lostWatchers = []; this.keyer = new MorseKeyer();
    if (this.otherEnt) { this.otherEnt.remove(); this.otherEnt = null; }
    if (this.bodyEnt) { this.bodyEnt.remove(); this.bodyEnt = null; }
    this.exitMode(); this.holding = null;
    this.placing = null; this.syncItems();
    if (!restored) this.health = Math.max(this.health ?? 1, 0.85);   // a night's sleep (or a day's) mends most of it
    if (this.weeper.state === 'caught' || (this.weeper.state === 'gone' && !isNight(phase))) this.weeper.state = this.weeper.state === 'gone' ? 'gone' : 'sitting';
    if (['coming', 'stairs', 'door', 'hunting'].includes(this.weeper.state)) { this.weeper.state = 'screaming'; this.weeper.timer = 0; this.weeper.progress = 0; }
    const sky = e.sky;
    sky.setWeather(phase === 'night2' ? { rain: 0.15, wind: 0.55, fog: 0.35, lightning: 0.012 } : phase === 'night1' ? { rain: 0, wind: 0.35, fog: 0.3, lightning: 0 } : phase === 'day2' ? { rain: 0.25, wind: 0.4, fog: 0.5, lightning: 0 } : { rain: 0, wind: 0.3, fog: 0.3, lightning: 0 });
    e.lights.cabLamp.on = isNight(phase) && !this.flags.lampOff;
    const P = this.player();
    if (phase === 'day1') { P.teleport(this.anchor('SP_trailhead') || 'SP_stair_foot'); P.lookAt(V3(this.L.places.trailhead || [22, -32, 380]).add(new THREE.Vector3(-8, 1.5, -40))); }
    else if (phase === 'day2' || phase === 'end') { P.teleport(this.anchor('SP_cab_bed') || new THREE.Vector3(-1, 30, -0.7)); P.lookAt(new THREE.Vector3(0, 31.4, 3)); }
    else { P.teleport(this.anchor('SP_cab_bed') || new THREE.Vector3(-1, 30, -0.7)); P.lookAt(new THREE.Vector3(2, 31.4, 2)); }
    if (phase === 'night2' && this.weeper.state === 'seen_day') this.weeper.nightFell();
    if (cp) {   // resuming a secret checkpoint: put everything back exactly as it was
      this.clock.setHour(cp.hour); this.obj.load(cp.obj || []); this.fired = new Set(cp.fired || []);
      this.truckVisible = !!cp.truckVisible; this.slLit = !!cp.slLit;
      if (cp.player) { P.teleport(V3(cp.player.pos), cp.player.yaw); P.pitch = 0; }
      for (const h of cp.hikers || []) {
        this.spawnHiker(h.which); const r = this.hikers[this.hikers.length - 1].rules;
        r.s = h.s; r.off = h.off || [0, 0];
        r.status = ['answered', 'walking', 'straying'].includes(h.status) ? 'waiting' : h.status;
      }
      if ((cp.lost || []).length) { this.spawnLost(); cp.lost.forEach((l, k) => { const w = this.lostWatchers[k]; if (w) { w.idx = l.idx; w.steps = l.steps || 0; w.ent.setPosition(V3(w.pos)); } }); }
      for (const f of this.activeFires()) this.showFire(f.name, true);   // the smoke / glow the open task is about
      this.cpSnap = cp;
      this.refreshTracker();
      return;
    }
    this.lastSaved = this.snapshot(); this.cpSnap = null; this.persist();
    this.ui.toast(PHASES[phase].date, 5);
    this.script('start');
    this.refreshTracker();
  }
  endPhase() {
    const M = this.e.audio.music;
    if (isNight(this.clock.phase)) M.sting('dawn');   // relief: the night is over
    M.setMood('silent', 2);                            // update() doesn't run during the transition; finish() overrides with the title
    const n = nextPhase(this.clock.phase);
    if (n === 'end' || this.clock.phase === 'night2') { this.finish(); return; }
    this.ui.fade(1);
    setTimeout(() => { this.startPhase(n); this.ui.fade(0); }, 900);
    this.state = 'transition';
  }
  finish() {
    this.state = 'end'; this.e.uiBlocking = false; if (this.ui.modalOpen()) this.ui.closeModal(); this.e.input.unlock(); this.e.audio.music.setMood('title', 8);
    const sent = this.photos.prints.filter((p) => p.sent).length;
    this.ui.screen('end', { text: 'Grey in the east. Somewhere below, the truck is coming up the road.',
      detail: `End of the first two nights. Proof sent: ${this.proofs} of ${S.PROOF_GOAL}. Prints taken: ${this.photos.prints.length} (${sent} sent). ${this.flags.lostN1 ? 'You lost Lyle Pruitt.' : 'Lyle Pruitt made it to the lot.'} Nights three to seven are still being built.`,
      onAction: (a) => { this.ui.closeModal(); this.onTitle && this.onTitle(); } });
  }
  die(kind) {
    if (this.state !== 'play') return;
    this.state = 'dead'; if (this.ui.modalOpen()) this.ui.closeModal(); this.e.uiBlocking = false; this.binocular = false; if (this.camRaised) this.lowerCamera(); this.exitMode(); this.e.audio.play('scream', { volume: 1 }); this.e.audio.music.sting('death');
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
    // the fuel tasks' hints follow what you're actually doing (it used to say "set it down" before you had a can)
    if (v.current && this.inv) {
      const can = this.inv.inHands('fuel', (i) => i.fill > 0.01), id = v.current.id;
      if (id === 'd1_fuel' || id === 'd2_fuel') v.current.hint = can ? 'You have a can. Carry it up the stairs to the cab, then set it down anywhere up there with G (or keep holding it).'
        : 'The fuel cans stand outside the shed door, at the foot of the tower. Walk up to one and press E to pick it up.';
      if (id === 'n1_refuel' || id === 'n2_refuel') v.current.hint = can ? 'Take the can down to the shed and press E at the generator to pour it.'
        : 'Pick up a full can (one you brought up, or the ones outside the shed), carry it to the generator in the shed, and press E.';
      if (id === 'd1_generator' || id === 'd2_generator') v.current.hint = this.fuel.tank <= 0.05 ? 'The generator in the shed at the base is dry: pour a can into it (E with the can in hand), then start it (E).' : 'The generator is in the shed at the foot of the tower. Walk in and press E to start it.';
    }
    if (!v.current) v.current = this.night ? { text: 'Keep watch from the cab', hint: 'Scan the dark. F works the searchlight from the cab or the catwalk. Tab: logbook.' }
      : { text: 'Keep watch — Silver Fork will call', hint: 'Scan the horizon from the catwalk, or rest on the bed to let the hours pass.' };
    this.ui.tracker(v, { date: PHASES[this.clock.phase].short + ' · ' + this.hourText() });
  }
  complete(id, note) { if (this.obj.complete(id, note)) { this.e.audio.play('paper', { volume: 0.4 }); if (id !== 'n1_guide' && id !== 'weeper_send') this.e.audio.music.sting('task'); this.refreshTracker(); setTimeout(() => this.checkpoint('task:' + id), 1500); } }
  add(id, extra) { if (!this.obj.has(id)) { this.obj.add(id, extra); this.refreshTracker(); } }
  inCab() { return this.player().zone === 'cab'; }
  /** Night falls: never start it with no way to get power (a spare can in the shed), and say so if the light is dead. */
  nightFuelCheck() {
    const anyFuel = this.inv.items.some((i) => i.kind === 'fuel' && i.fill > 0.01);
    if (!anyFuel && this.fuel.tank < 1.5) {
      const g = this.anchor('IA_generator') || new THREE.Vector3(9.3, 0.7, 6.8);
      this.inv.create('fuel', { pos: [g.x - 0.9, g.y, g.z + 0.9], rotY: 1.2, settle: true }); this.syncItems();
      setTimeout(() => this.ui.toast('There\'s one last can of fuel in the shed, beside the generator.', 4), 8000);
    }
    if (!this.fuel.power) this.add(this.clock.phase === 'night1' ? 'n1_refuel' : 'n2_refuel', { urgent: true });
  }
  /** What ends the Weeper right now: send the print he's already in, or photograph him (and then send that). */
  weeperTask() { const c = this.weeper.carrier; return c && c !== 'next' ? 'weeper_send' : 'weeper_photo'; }
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
    else { const fp = (this.e.world.layout.fireSites || []).find((q) => q.name === name); if (fp && on) { this.smoke.setSource(new THREE.Vector3(fp.position[0], fp.position[1], fp.position[2])); this.smoke.mesh.visible = true; this.smokeFade = 1; } else this.smokeFade = 0; }
  }

  // ------------------------------------------------------------------ the script
  script(ev) {
    const ph = this.clock.phase, f = this.flags;
    if (ev === 'start') {
      if (ph === 'day1') { this.add('d1_walk'); this.say(S.LINES.arrive); this.truckVisible = true; }
      if (ph === 'night1') { this.say(S.LINES.night1Start); this.add('n1_dawn', { optional: true }); this.nightFuelCheck(); }
      if (ph === 'day2') { this.say(f.lostN1 ? S.LINES.day2Lost : S.LINES.day2Saved); this.add('d2_camp'); this.add('d2_overlook'); this.add('d2_photo'); this.add('d2_send'); this.truckVisible = true;
        if (!this.photos.hasCamera) this.photos.giveCamera(1);
        { const cam = this.inv.items.find((i) => i.kind === 'camera'); if (cam && cam.where === 'world') { const r = this.inv.take(cam.id); if (!r.ok) Object.assign(cam, { where: 'pack', slot: this.inv.freePack() >= 0 ? this.inv.freePack() : 4, pos: null }); } else if (!cam) this.inv.create('camera', { where: 'pack', slot: this.inv.freePack() >= 0 ? this.inv.freePack() : 4 }); }
        const full = this.inv.items.filter((i) => i.kind === 'fuel' && i.fill > 0.01).length, fa = this.anchor('IA_fuel_cans') || new THREE.Vector3(7.05, 0.4, 7.9);
        for (let k = full; k < 3; k++) this.inv.create('fuel', { pos: [fa.x - 0.5 + k * 0.4, fa.y, fa.z + 0.6], rotY: k, settle: true });
        if (full < 3) setTimeout(() => this.ui.toast('Walt left fresh cans of fuel by the shed door.', 4), 6000);
        this.syncItems(); }
      if (ph === 'night2') { this.say(S.LINES.night2Start); this.add('n2_dawn', { optional: true }); this.nightFuelCheck(); }
    }
  }
  scriptTick(dt) {
    const ph = this.clock.phase, h = this.clock.hour, f = this.flags, z = this.player().zone, o = this.obj;
    const done = (id) => o.isDone(id);
    // gates (the clock holds until the work is done)
    if (ph === 'day1') {
      this.clock.addGate('rules', 13.0, () => done('d1_rules'));
      this.clock.addGate('smoke', 19.0, () => done('d1_smoke') && done('d1_fuel'));
      this.clock.addGate('dusk', 20.45, () => this.fuel.genOn && z === 'cab');
      if (!done('d1_walk') && (z === 'base' || z === 'stairs' || z === 'cab')) { this.complete('d1_walk'); this.add('d1_climb'); }
      if (this.obj.has('d1_fuel') && this.fuelUpTop()) this.complete('d1_fuel');
      if (done('d1_walk') && !done('d1_climb') && z === 'cab') { this.complete('d1_climb'); this.addLog(S.AUTO_LOG.arrived(this.hourText())); this.add('d1_radio'); }
      if (h >= 13.0 && done('d1_rules')) this.once('smokeCall', () => { this.say(S.LINES.smokeCall); this.add('d1_smoke'); this.showFire('Cold Creek Basin', true); });
      if (done('d1_smoke') || h >= 16) this.once('genTask', () => this.add('d1_generator'));
      if (h >= 18.9 && done('d1_smoke')) this.once('camera', () => { this.flags.cameraOut = true; this.add('d1_camera', { optional: true }); });
      if (h >= 19.6) this.once('sob', () => { this.say(S.LINES.duskSob); });
      if (h >= 19.9) this.once('dusktask', () => this.add('d1_dusk'));
      if (this.fuel.genOn && z === 'cab' && h >= 20.2) this.complete('d1_dusk');
      if (h >= 18 && done('d1_generator') && !this.fuel.genOn && !done('d1_dusk')) { o.remove('d1_generator'); this.add('d1_generator', { urgent: true }); }   // it ran dry or you stopped it: dusk needs it running
      if (h > 12 && this.truckVisible && z !== 'trailhead') this.truckVisible = false;
    }
    if (ph === 'night1') {
      this.clock.addGate('hiker', 24.5, () => this.hikers.some((k) => k.rules.done && k.rules.kind === 'hiker'));
      if (this.clock.held === 'hiker' && !this.fuel.power && !this.inv.items.some((i) => i.kind === 'fuel' && i.fill > 0.01)) {
        this._darkHold = (this._darkHold || 0) + dt;
        if (this._darkHold > 240) { const H = this.hikers.find((k) => k.rules.kind === 'hiker' && !k.rules.done); if (H) { H.rules.status = 'out'; this.say([{ who: S.WHO.NOTE, note: true, text: 'Down on the ridge the little light starts moving again, slowly, on its own. Then it\'s gone into the trees.' }]); } this._darkHold = 0; }
      } else this._darkHold = 0;
      if (h >= 21.3) this.once('glow1', () => { this.say(S.LINES.glowN1); this.add('n1_fire'); this.showFire('Hatchet Peak', true); });
      if (h >= 22.4) this.once('sos1', () => { this.spawnHiker('night1'); this.say(S.LINES.sosN1); this.add('n1_answer'); });
      if (h >= 26.0) this.once('gate', () => { this.e.audio.play('gate_rattle', { position: this.anchor('IA_gate') || new THREE.Vector3(0, 1, 6), volume: 1.2 }); this.say(S.LINES.gateRattle); f.gateRattled = true; this.addLog('0200 — gate. Wind.'); });
      if (h >= 28.4) this.once('dawnObj', () => this.add('n1_dawn'));
    }
    if (ph === 'day2') {
      this.clock.addGate('dusk2', 20.45, () => z === 'cab' && this.fuel.genOn);
      if (h >= 14.0) this.once('fuel2', () => { this.add('d2_fuel'); this.add('d2_generator'); });
      if (h >= 19.5) this.once('dusk2', () => { this.add('d2_dusk', { urgent: true }); for (const id of ['d2_fuel', 'd2_generator']) { const x = o.get && o.get(id); if (x && !x.done) x.urgent = true; } this.refreshTracker(); });
      if (o.has('d2_fuel') && this.fuelUpTop()) this.complete('d2_fuel');
      if (h >= 19.5 && done('d2_generator') && !this.fuel.genOn && !done('d2_dusk')) { o.remove('d2_generator'); this.add('d2_generator', { urgent: true }); }
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
      this.otherEnt = e.entities.spawn('other_lookout', { position: new THREE.Vector3(-1.0, 30.0, -1.2), facing: new THREE.Vector3(-1, 30, 1), pose: 'sitting_bed' });   // on the edge of the bed, facing into the cab
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
    const light = this.lampPool[this.hikers.length % this.lampPool.length];
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
        if (ev === 'saved') { e.audio.music.sting('found'); setTimeout(() => this.checkpoint('saved'), 2000); this.say(S.LINES.savedN1); this.complete('n1_guide'); this.addLog(S.AUTO_LOG.saved()); this.flags.savedN1 = true; }
        if (ev === 'fell') { setTimeout(() => this.checkpoint('fell'), 2000); this.say(S.LINES.fellN1); this.obj.complete('n1_guide', null, true); this.refreshTracker(); this.addLog(S.AUTO_LOG.lost()); this.flags.lostN1 = true; e.audio.play('breath', { volume: 0.6 }); }
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
      trapdoor: this.anchor('IA_cab_door') ? A3(this.anchor('IA_cab_door')) : this.anchor('IA_trapdoor') ? A3(this.anchor('IA_trapdoor')) : [-1.5, 30, 0], player: this.pos(), playerInCab: this.inCab() };
    const evs = W.update(dt, ctx);
    for (const ev of evs) {
      if (ev === 'hush') { this.say(S.LINES.weeperHush); }
      if (ev === 'resume') this.say(S.LINES.weeperResume);
      if (ev === 'lookup') { /* pose shows it */ }
      if (ev === 'seen') { e.audio.music.sting('seen'); this.say(S.LINES.weeperSeen); e.audio.play('heart', { volume: 1 }); if (!this.night) { setTimeout(() => this.say(S.LINES.weeperDay), 2500); } this.add('weeper_photo'); }
      if (ev === 'scream') this.say(S.LINES.weeperScream);
      if (ev === 'coming') { this.say(S.LINES.weeperComing); this.add(this.weeperTask()); }
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
      if (!['sitting', 'hush', 'gone'].includes(W.state)) h.face(e.camera.position);
    }
    h.setVisible(!['stairs', 'door', 'gone'].includes(W.state) || W.state === 'gone');
    // sound
    const snd = W.state === 'gone' ? 'silent' : W.sound;
    this.sobT = (this.sobT || 0) - dt;
    if (this.sobT <= 0 && (this.fired.has('sob') || this.clock.phase !== 'day1')) {
      if (snd === 'sob') { e.audio.play('sob', { position: h.position.clone().add(new THREE.Vector3(0, 1.2, 0)), volume: 1.4 }); this.sobT = 4.5 + Math.random() * 3; }
      else if (snd === 'scream') { e.audio.play('scream', { position: h.position.clone().add(new THREE.Vector3(0, 1.5, 0)), volume: 1.8 }); this.sobT = 2.4 + Math.random(); }
      else this.sobT = 1;
    }
    // fear
    const near = W.pos ? dist(W.pos, this.pos()) : 999;
    const fear = Math.max(W.triggered ? Math.max(0.25, 1 - near / 120) : 0, this.bearFear || 0);
    e.post.params.fear += (fear - e.post.params.fear) * Math.min(1, dt * 1.5);
    if (W.triggered || (this.bearFear || 0) > 0.5) { this.heartT = (this.heartT || 0) - dt; if (this.heartT <= 0) { e.audio.play('heart', { volume: 0.4 + fear }); this.heartT = 1.4 - fear * 0.8; } }
    if (W.triggered) this.add(this.weeperTask());
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
      this.addLog(S.AUTO_LOG.sent(channel, this.hourText())); setTimeout(() => this.checkpoint('sent'), 1000);
      this.complete('d2_send');
      if (channel === 'fax') { this.say(S.LINES.faxSent); this.flags.faxUsed = true; }
      if (channel === 'mailbox') this.say(S.LINES.mailSent);
      if (channel === 'driver') this.say(it.p.faceDown ? S.LINES.driverFaceDown : it.p.forbidden ? S.LINES.driverFace : S.LINES.driverNormal);
      if (this.weeper.sendAway(it.p.id)) { this.e.audio.music.sting('dawn'); this.say(S.LINES.weeperGone); this.complete('weeper_send'); this.obj.remove('weeper_photo'); this.refreshTracker(); }
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
    reg('heater', 'IA_heater', () => this.co.heater ? 'E — Turn the heater off' : 'E — Light the propane heater', () => { this.co.toggleHeater(); e.audio.play(this.co.heater ? 'heater_on' : 'heater_off', { volume: 0.7, position: this.anchor('IA_heater') }); });
    for (const k of ['n', 'e', 's', 'w']) reg('win_' + k, 'IA_window_' + k, () => this.co.windows[k] ? 'E — Close the window' : 'E — Open the window', () => {
      const open = this.co.toggleWindow(k); e.audio.play(open ? 'window_open' : 'window_close', { volume: 0.7, position: this.anchor('IA_window_' + k) });
      this.ui.toast(open ? 'Cold air pours in. The cab smells of pine instead of propane.' : 'The window thumps shut. Quieter.', 2.5);
    }, () => true, 0.7);
    reg('searchlight', 'IA_searchlight', 'E — Take the searchlight', () => this.enterSearchlight(), () => true, 0.7);
    const fullCan = () => this.inv.inHands('fuel', (i) => i.fill > 0.01);
    const tankTxt = () => `tank ${this.fuel.tank.toFixed(1)} of ${FUEL.capacity} L`;
    const startGen = () => { const r = this.fuel.start(); if (r.ok) { e.audio.play('generator_start'); this.complete('d1_generator'); this.ui.toast('It catches and settles into a rattle. The searchlight has power.', 3); } else this.ui.toast('The tank is dry. Bring a can of fuel (the cans are outside the shed door).', 3.5); };
    reg('generator', 'IA_generator', () => fullCan() && this.fuel.tank < FUEL.capacity - 0.05 ? `E — Pour fuel into the generator (${tankTxt()})` : this.fuel.genOn ? `E — Stop the generator (${tankTxt()})` : `E — Start the generator (${tankTxt()})`, () => {
      const can = fullCan();
      if (can && this.fuel.tank < FUEL.capacity - 0.05) {
        const pour = Math.min(FUEL.capacity - this.fuel.tank, FUEL.can * can.fill);
        this.fuel.tank += pour; this.fuel.wasLow = this.fuel.frac < FUEL.low; can.fill = Math.max(0, can.fill - pour / FUEL.can); if (can.fill < 0.01) can.fill = 0;
        e.audio.play('fuel_pour'); this.addLog(S.AUTO_LOG.refuel(this.hourText())); { const rid = this.clock.phase === 'night1' ? 'n1_refuel' : 'n2_refuel'; if (this.night && this.obj.has(rid) && !this.obj.isDone(rid)) this.complete(rid); } this.flags.refueledOnce = true;
        this.ui.toast(can.fill > 0 ? `Tank full. About ${Math.round(can.fill * FUEL.can * 10) / 10} L left in the can.${this.fuel.genOn ? '' : ' Now start it (E).'}` : `Tank at ${this.fuel.tank.toFixed(1)} L. The can is empty: set it down anywhere (G).${this.fuel.genOn ? '' : ' Now start it (E).'}`, 3.5);
        this.refreshHotbar();
      }
      else if (this.fuel.genOn) { this.fuel.stop(); e.audio.play('generator_stop'); }
      else startGen();
    }, () => true, 0.7);
    reg('mailbox', 'IA_mailbox', 'E — Mail a photograph', () => this.sendFlow('mailbox'), () => this.photos.sendable().length > 0);
    reg('fax', 'IA_fax', 'E — Fax a photograph to the district', () => this.sendFlow('fax'), () => this.photos.sendable().length > 0);
    reg('truck', 'IA_truck', () => this.photos.sendable().length ? 'E — Give Walt a photograph' : 'E — Talk to Walt', () => { if (this.photos.sendable().length) this.sendFlow('driver'); else this.say(S.LINES.driverHello); }, () => this.truckVisible);
    reg('pack', 'IA_camp_backpack', 'E — Search the pack', () => {
      e.audio.music.sting('found');
      const f = S.FINDS.camp_backpack; this.flags.rulesTo = Math.max(this.flags.rulesTo, f.rulesTo);
      this.openModal(() => this.ui.note(f.title, f.text + '\n\n' + S.RULES.slice(5, 8).map((r, i) => `${i + 6}. ${r}`).join('\n'), () => { this.closedModal(); this.complete('d2_camp'); }));
    }, () => this.clock.phase === 'day2');
    reg('overlook', 'IA_overlook', 'E — Look over the rail', () => {
      if (!this.flags.lostN1) e.audio.music.sting('found');
      const f = this.flags.lostN1 ? S.FINDS.body : S.FINDS.noBody;
      if (this.flags.lostN1 && !this.bodyEnt) { const ov = V3(this.L.places.ravine_overlook); this.bodyEnt = e.entities.spawn('lost_hiker_body', { position: new THREE.Vector3(ov.x + 22, e.world.heightAt(ov.x + 22, ov.z + 4), ov.z + 4), pose: 'body' }); }
      this.player().lookAt(V3(this.L.places.ravine_overlook).add(new THREE.Vector3(24, -30, 4)), 1.2);
      setTimeout(() => { if (this.state !== 'play' || this.ui.modalOpen()) return; this.openModal(() => this.ui.note(f.title, f.text, () => { this.closedModal(); this.complete('d2_overlook'); })); }, 1400);
    }, () => this.clock.phase === 'day2');
    reg('rest', 'IA_bed', 'E — Lie down and rest (let the hours pass)', () => {
      if (this.clock.held) { const c = this.obj.current(); this.ui.toast('You can\'t sleep yet.' + (c ? ' ' + this.obj.text(c) + '.' : ''), 3); return; }
      this.resting = true; this.restObjN = this.obj.list.length; this.clock.speed = 14; e.post.set({ blackout: 0.85 }); this.ui.toast('You lie down. The hours go by. (W to get up)', 3);
    }, () => !this.resting && !this.weeper.triggered, 0.8);
    reg('door', 'IA_cab_door', () => this.flags.doorShut ? 'E — Open the door' : 'E — Shut the door', () => {
      this.flags.doorShut = !this.flags.doorShut; e.audio.play(this.flags.doorShut ? 'door_close' : 'door_open', { volume: 0.8, position: this.anchor('IA_cab_door') });
      if (this.flags.doorShut && this.inCab()) this.ui.toast('The latch drops. The wind noise halves.', 2);
    }, () => true, 0.75);
    reg('lamp', 'IA_lamp', () => e.lights.cabLamp.on ? 'E — Pull the chain (lamp off)' : 'E — Pull the chain (lamp on)', () => {
      e.lights.cabLamp.on = !e.lights.cabLamp.on; this.flags.lampOff = !e.lights.cabLamp.on; e.audio.play('lamp_chain', { volume: 0.6 });
    }, () => true, 0.6);
    reg('stove', 'IA_stove', () => this.coffee == null ? 'E — Light the stove and put the coffee on' : this.coffee < 1 ? 'The coffee pot is ticking on the burner…' : 'E — Pour a cup of coffee', () => {
      if (this.coffee == null) { this.coffee = 0; e.audio.play('stove_on', { volume: 0.7, position: this.anchor('IA_stove') }); this.ui.toast('The burner catches with a soft whump. Give it a minute.', 2.5); }
      else if (this.coffee >= 1) { this.coffee = null; this.surv.drink(0.3); this.surv.warmth = 1; this.co.blood = Math.max(0, this.co.blood - 0.02); this.ui.toast('Boiled coffee, grounds and all. Heat spreads through your chest.', 3); this.refreshHotbar(); }
    }, () => this.coffee == null || this.coffee >= 1, 0.6);
    reg('clock', 'IA_clock', 'E — Look at the alarm clock', () => { this.ui.toast(`The alarm clock says ${fmtHour(this.clock.hour)}. It gains a minute a day.`, 3); e.audio.play('morse_click', { volume: 0.15 }); }, () => true, 0.45);
    reg('books', 'IA_books', 'E — Take a book off the shelf', () => {
      const b = S.BOOKS[(this.bookI = ((this.bookI ?? -1) + 1) % S.BOOKS.length)];
      this.openModal(() => this.ui.note(b.title, b.text, () => this.closedModal()));
    }, () => true, 0.5);

    reg('spring', 'IA_spring', () => { const c = this.inv.find('canteen'); return c && c.fill < 1 ? 'E — Drink, and fill the canteen' : 'E — Drink from the spring'; }, () => {
      const c = this.inv.find('canteen'); this.surv.drink(1); if (c) c.fill = 1;
      this.ui.toast(c ? 'Cold enough to hurt your teeth. The canteen is full.' : 'Cold enough to hurt your teeth.'); this.refreshHotbar();
    });
  }

  // ------------------------------------------------------------------ modes
  enterFinder() {
    this.mode = 'finder'; const p = this.player(); p.setEnabled(false); p.lookLocked = true; this.fovTarget = 32;
    this.finderPos = (this.anchor('IA_firefinder') || new THREE.Vector3(0.3, 31, -0.15)).clone().add(new THREE.Vector3(0, 0.55, 0));
  }
  enterSearchlight() {
    const p = this.player(); this.slReturn = { pos: p.position.clone(), yaw: p.yaw };
    this.mode = 'searchlight'; p.setEnabled(false); p.lookLocked = true;
    if (!this.fuel.power) this.ui.toast(this.fuel.tank <= 0 ? 'No power: the generator tank is dry. Bring fuel to the shed.' : 'No power: start the generator in the shed at the base.', 4);
    const SL = this.e.lights.searchlight; SL.operating = true; this.slLit = true; this.fovTarget = 58;
    if (this.fuel.power && this.e.sky.dayFactor > 0.45) this.ui.toast('The lamp is lit, but in daylight the beam barely shows. It comes alive after dusk.', 4);
  }
  exitMode() {
    const p = this.player && this.e.player ? this.e.player : null; if (!p) return;
    if (this.mode === 'searchlight') { this.e.lights.searchlight.operating = false; }
    if (this.mode === 'finder' || this.mode === 'searchlight') {
      const a = this.mode === 'finder' ? (this.anchor('IA_firefinder') || new THREE.Vector3(0.3, 30, -0.15)) : (this.anchor('IA_searchlight') || new THREE.Vector3(2, 30, 2));
      p.position.set(a.x + (this.mode === 'finder' ? -0.6 : 0), 30.0, a.z + (this.mode === 'finder' ? 0.3 : 0));
      p.yaw = this.e.camera.rotation.y; p.pitch = 0;
      if (this.mode === 'searchlight' && this.slReturn) { p.position.copy(this.slReturn.pos); p.yaw = this.slReturn.yaw; }
      this.slReturn = null;
    }
    this.mode = 'walk'; p.setEnabled(true); p.lookLocked = false; this.fovTarget = 68;
    this.ui.finder(null); this.ui.searchlight(null);
  }
  openModal(fn) { this.e.uiBlocking = true; this.e.input.unlock(); this.player().setEnabled(false); fn(); }
  closedModal() { this.e.uiBlocking = false; this.player().setEnabled(this.mode === 'walk' && !this.sitting); if (this.state === 'play') this.e.input.lock(); }
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
      creek: W.layout.creek && W.layout.creek.points, ravine: W.layout.ravine && W.layout.ravine.polygon,
      spots: this.chill ? this.chill.spots : [], heading: this.player().yaw }, () => this.closedModal()));
  }

  inputs() {
    const e = this.e, In = e.input;
    In.onAction('interact', (d) => {
      if (!d || this.state !== 'play') return;
      if (this.ui.modalOpen()) { this.ui.closeModal(); return; }
      if (this.chill && this.chill.sitting) { this.chill.stand(); return; }
      if (this.mode === 'finder') { this.reportFinder(); return; }
      if (this.mode === 'searchlight') { this.slLit = !this.slLit; return; }
      e.interact.use();
    });
    In.onAction('pause', (d) => {
      if (!d) return;
      if (this.ui.modalOpen()) { if (this.ui.canClose()) this.ui.closeModal(); return; }   // title / death / end have no 'back': Esc does nothing there
      if (this.escape()) return;
      if (this.state === 'play') this.onPause && this.onPause();
    });
    In.onAction('searchlight', (d) => {
      if (!d || this.state !== 'play' || this.ui.modalOpen()) return;
      if (this.camRaised) { this.flashOn = !this.flashOn; return; }
      if (this.mode === 'searchlight') { this.exitMode(); return; }
      if (this.mode !== 'walk') return;
      const z = this.player().zone;
      if (z === 'cab' || z === 'catwalk') this.enterSearchlight();
      else this.ui.toast('The searchlight is on the cab roof. Work it from the cab or the catwalk (F).', 3);
    });
    In.onAction('logbook', (d) => { if (!d || this.state !== 'play') return; if (this.ui.modalOpen()) this.ui.closeModal(); else if (this.mode === 'walk') this.openLogbook(); });
    In.onAction('map', (d) => { if (!d || this.state !== 'play') return; if (this.ui.modalOpen()) this.ui.closeModal(); else if (this.mode === 'walk') this.openMap(); });
    In.onAction('camera', (d) => {
      if (!d || this.state !== 'play' || this.mode !== 'walk' || this.ui.modalOpen()) return;
      if (this.holding) { this.holding = null; this.photos.close(); this.ui.print(null); return; }
      this.toggleCamera();
    });
    // left click, or the Use key (U by default): whatever is in your hand
    const usePrimary = (d) => {
      if (this.state !== 'play' || this.ui.modalOpen()) return;
      if (this.placing) { if (d) this.confirmPlace(); return; }
      if (this.camRaised) { if (d) this.takePhoto(); return; }
      if (this.mode === 'walk') this.useActive(d);
    };
    In.onAction('primary', usePrimary);
    In.onAction('use', usePrimary);
    In.onAction('secondary', (d) => { if (d && this.placing) this.cancelPlace(); });
    for (let i = 0; i < HAND_SLOTS; i++) In.onAction('slot' + (i + 1), (d) => { if (d && this.state === 'play' && this.mode === 'walk' && !this.ui.modalOpen()) this.selectSlot(i); });
    In.onAction('place', (d) => {
      if (!d || this.state !== 'play' || this.mode !== 'walk' || this.ui.modalOpen()) return;
      if (this.placing) this.confirmPlace(); else this.beginPlace();
    });
    In.onAction('inventory', (d) => { if (!d || this.state !== 'play') return; if (this.ui.modalOpen()) this.ui.closeModal(); else if (this.mode === 'walk') this.openPack(); });
    In.onAction('flip', (d) => {
      if (!d || !this.holding) return;
      const r = this.photos.flipOrShake();
      if (r === 'flipped') { e.audio.play('paper', { volume: 0.5 }); }
    });
    In.onAction('flashlight', (d) => { if (d && this.state === 'play' && !this.ui.modalOpen()) this.toggleFlashlight(); });
    In.onAction('binoculars', (d) => {
      if (this.state !== 'play' || this.mode !== 'walk' || this.ui.modalOpen()) { this.binocular = false; return; }
      const now = e.time.value;
      if (d) {
        if (this.binocular) { this.binocular = false; return; }
        // straight from the pack or a hand: raising them never needs a free hand
        if (!this.inv.find('binoculars')) { this.ui.toast(this.inv.items.some((i) => i.kind === 'binoculars' && i.where === 'pack') ? 'The binoculars are in the pack, and you set the pack down.' : 'You don\'t have the binoculars with you.', 3); this.binocular = false; return; }
        if (this.camRaised) this.lowerCamera();
        if (this.placing) this.cancelPlace();
        this.binocular = true; this.binocAt = now;
        if (!this.flags.toldBinoc) { this.flags.toldBinoc = true; this.ui.toast('B again (or Esc) lowers them. Your bearing is at the bottom.', 3); }
      } else if (this.binocular && now - (this.binocAt || 0) > 0.45) this.binocular = false;   // held down: letting go lowers them
    });
    In.onAction('signal', (d) => {
      if (this.mode !== 'searchlight') return;
      const t = e.time.value;
      if (d) { this.signal.mode = true; this.signal.last = t; this.keyer.down(t); e.audio.play('morse_click', { volume: 0.5 }); }
      else { this.signal.last = t; this.keyer.up(t); e.audio.play('morse_click', { volume: 0.35 }); }
    });
  }
  // ------------------------------------------------------------------ items: hands, pack, setting things down anywhere
  fuelUpTop() {
    const z = this.player().zone;
    return this.inv.items.some((it) => it.kind === 'fuel' && it.fill > 0.01 && ((it.where === 'world' && it.pos[1] > 29) || (it.where === 'hand' && (z === 'cab' || z === 'catwalk'))));
  }
  syncItems() {
    if (!this.iv || !this.inv) return;
    for (const it of this.inv.world) if (it.settle) { it.pos = this.iv.settle(it.pos); delete it.settle; }
    this.iv.sync(this.inv);
    const live = new Set(this.inv.world.map((i) => i.id));
    for (const [id, r] of this.itemIA) if (!live.has(id)) { r.off(); this.itemIA.delete(id); }
    for (const it of this.inv.world) {
      const top = this.iv.topOf(it);
      if (this.itemIA.has(it.id)) { this.itemIA.get(it.id).t.anchor.copy(top); continue; }
      const id = it.id;
      const t = { id: 'item:' + id, anchor: top, radius: it.kind === 'backpack' || it.kind === 'fuel' ? 0.45 : 0.32, reach: 2.6,
        label: () => { const x = this.inv.get(id); return x ? 'E — Pick up the ' + this.inv.label(x).replace(/^./, (c) => c.toLowerCase()) : ''; },
        enabled: () => this.state === 'play' && this.mode === 'walk' && !this.placing && !!this.inv.get(id) && this.inv.get(id).where === 'world',
        onUse: () => this.pickUp(id) };
      this.itemIA.set(id, { t, off: this.e.interact.register(t) });
    }
    this.player().carrying = this.inv.carryingHeavy ? 'fuel' : null;
    this.refreshHotbar();
  }
  slotView(it) { return it ? { icon: this.iv.icons[it.kind] || '', label: this.inv.label(it), short: KINDS[it.kind].name, fill: it.kind === 'canteen' || it.kind === 'fuel' ? it.fill : null } : null; }
  refreshHotbar() {
    if (!this.inv) return;
    const a = this.inv.activeItem, pl = this.placing && this.inv.get(this.placing.id);
    const packN = this.inv.items.filter((i) => i.where === 'pack').length;
    this.ui.hotbar({ slots: [0, 1, 2].map((i) => this.slotView(this.inv.hand(i))), active: this.inv.active,
      label: pl ? `Setting down: ${this.inv.label(pl)} — click or G · wheel turns it · right-click cancels` : a ? this.inv.label(a) : '',
      pack: this.inv.wearingPack ? `pack ${packN}/${PACK_SLOTS} · I` : 'pack set down somewhere' });
  }
  pickUp(id) {
    const it = this.inv.get(id); if (!it) return;
    const r = this.inv.take(id);
    if (!r.ok) { this.ui.toast(r.why, 3); return; }
    this.e.audio.sfx(it.kind === 'fuel' ? 'metal_heavy' : it.kind === 'backpack' ? 'cloth' : 'metal', { volume: it.kind === 'fuel' ? 0.35 : 0.3 });
    if (it.kind === 'camera' && !this.photos.hasCamera) {
      this.photos.giveCamera(1); this.flags.hasCamera = true; this.say(S.LINES.cameraFound); this.complete('d1_camera');
      this.ui.toast(r.to === 'pack' ? 'Into the pack. C raises the camera.' : 'C raises the camera · click takes a picture.', 4);
    } else if (r.to === 'pack') this.ui.toast(`Into the pack: ${this.inv.label(it)}.`, 2);
    if (it.kind === 'backpack') this.ui.toast(`Pack on. ${this.inv.items.filter((i) => i.where === 'pack').length} things in it · I to look.`, 2.5);
    this.syncItems();
  }
  selectSlot(i) {
    if (this.placing) this.cancelPlace();
    this.inv.select(i); if (this.camRaised && !this.inv.inHands('camera', (c) => c.slot === i)) this.lowerCamera();
    this.binocular = false; this.refreshHotbar();
  }
  beginPlace() {
    const it = this.inv.activeItem;
    if (!it) { this.ui.toast('Nothing in that hand. 1 · 2 · 3 or the mouse wheel to switch.', 3); return; }
    if (this.camRaised) this.lowerCamera();
    this.binocular = false;
    this.placing = { id: it.id, rot: 0, spot: null, rotY: 0 }; this.refreshHotbar();
  }
  updatePlace() {
    const pl = this.placing;
    if (!pl) { this.iv.ghost(null); return; }
    const it = this.inv.get(pl.id);
    if (!it || it.where !== 'hand' || this.mode !== 'walk') { this.cancelPlace(); return; }
    const P = this.player(), taken = new Set(this.inv.world.map((i) => i.hook).filter(Boolean));
    pl.spot = this.iv.findSpot(3.5, it.kind, taken, { x: P.position.x, z: P.position.z, yaw: P.yaw });
    pl.rotY = pl.spot.hook ? pl.spot.rotY : P.yaw + Math.PI + pl.rot;
    this.iv.ghost(it.kind, pl.spot.pos, pl.rotY, pl.spot.ok);
  }
  confirmPlace() {
    const pl = this.placing; if (!pl || !pl.spot) return;
    if (!pl.spot.ok) { this.ui.toast('Nowhere to put it there. Look at a floor, a shelf, a table, a peg or the ground.', 2.5); return; }
    const it = this.inv.get(pl.id), p = pl.spot.pos;
    if (it.kind === 'flashlight') this.e.lights.flashlight.on = false;
    if (it.kind === 'camera' && this.camRaised) this.lowerCamera();
    this.inv.place(pl.id, [p.x, p.y, p.z], pl.rotY, pl.spot.hook || null);
    this.placing = null; this.iv.ghost(null);
    this.e.audio.sfx(it.kind === 'fuel' ? 'metal_heavy' : it.kind === 'backpack' ? 'cloth' : 'knock_one', { position: p.clone(), volume: it.kind === 'fuel' ? 0.4 : 0.25 });
    if (it.kind === 'backpack') this.ui.toast(pl.spot.hook ? 'Hung on the peg. Its five slots stay with it.' : 'Pack down. Its five slots stay with it.', 2.5);
    this.syncItems();
  }
  cancelPlace() { this.placing = null; this.iv && this.iv.ghost(null); this.refreshHotbar(); }
  toggleCamera() {
    if (!this.camRaised) {
      if (!this.inv.find('camera')) { this.ui.toast(this.photos.hasCamera ? 'You set the camera down somewhere.' : 'You don\'t have a camera.'); return; }
      const r = this.inv.ready('camera'); if (!r.ok) { this.ui.toast(r.why, 2.5); return; }
      if (r.fromPack) { this.ui.toast('You take the camera out of the pack.', 2); this.syncItems(); }
    }
    this.camRaised = !this.camRaised; this.fovTarget = this.camRaised ? 58 : 68; if (!this.camRaised) this.ui.cameraFrame(null);
  }
  toggleFlashlight() {
    const FL = this.e.lights.flashlight;
    if (!FL.on) {
      const f = this.inv.find('flashlight');
      if (!f) { this.ui.toast('You don\'t have the flashlight with you.', 2.5); return; }
      if (f.where === 'pack') { const r = this.inv.ready('flashlight'); if (!r.ok) { this.ui.toast('The flashlight is in the pack and your hands are full.', 3); return; } this.ui.toast('You dig the flashlight out of the pack.', 2); this.syncItems(); }
    }
    FL.on = !FL.on; this.e.audio.play('morse_click', { volume: 0.3 });
  }
  /** Left click: use whatever is in your hand. */
  useActive(down) {
    const it = this.inv.activeItem; if (!it) return;
    if (it.kind === 'binoculars') { if (down) { this.binocular = !this.binocular; this.binocAt = this.e.time.value; } return; }
    if (!down) return;
    if (it.kind === 'canteen') {
      if (this.inv.sip(it)) { this.surv.drink(SURV.sip); this.ui.toast(it.fill > 0 ? 'Cold, tinny water.' : 'That\'s the last of it. The spring will fill it.', 2.2); this.e.audio.sfx('cloth', { volume: 0.2 }); }
      else this.ui.toast('The canteen is empty. Fill it at the spring.', 2.5);
      this.refreshHotbar();
    } else if (it.kind === 'food') {
      this.surv.eat(SURV.meal); this.inv.remove(it.id); this.e.audio.sfx('metal', { volume: 0.25 });
      this.ui.toast(this.surv.food > 0.9 ? 'Cold pork and beans. You\'re full.' : 'Cold pork and beans, straight from the tin.', 2.5); this.syncItems();
    } else if (it.kind === 'flashlight') this.toggleFlashlight();
    else if (it.kind === 'camera') this.toggleCamera();
    else if (it.kind === 'fuel') this.ui.toast(it.fill > 0.01 ? 'Pour it at the generator in the shed (E). G sets it down anywhere.' : 'Empty. G sets it down.', 3);
    else if (it.kind === 'backpack') this.openPack();
  }
  openPack() {
    const render = () => this.ui.pack({
      hands: [0, 1, 2].map((i) => this.slotView(this.inv.hand(i))), pack: Array.from({ length: PACK_SLOTS }, (_, i) => this.slotView(this.inv.packSlot(i))),
      worn: this.inv.wearingPack, active: this.inv.active, stats: { water: this.surv.water, food: this.surv.food },
    }, (where, i) => {
      const it = where === 'hand' ? this.inv.hand(i) : this.inv.packSlot(i);
      if (!it) { if (where === 'hand') this.inv.select(i); render(); this.refreshHotbar(); return; }
      if (where === 'hand' && it.kind === 'backpack') { this.ui.toast('To take the pack off, set it down (G).', 2.5); return; }
      const r = where === 'hand' ? this.inv.stow(it.id) : this.inv.unstow(it.id);
      if (!r.ok && r.why) this.ui.toast(r.why, 2.5);
      if (where === 'hand' && it.kind === 'flashlight') this.e.lights.flashlight.on = false;
      if (where === 'hand' && it.kind === 'camera') this.lowerCamera();
      this.e.audio.sfx('cloth', { volume: 0.2 }); this.syncItems(); render();
    }, () => this.closedModal());
    this.openModal(render);
  }
  /** Fall damage. Under ~1.5 m you just thump down; a storey hurts and leaves you limping; ~8 m kills. */
  /** A jolt: screen shake (0..1) for `seconds`, an FOV punch (negative degrees = the world lurches closer), a heartbeat. */
  scare({ shake = 0, seconds = 0.6, fov = 0, heartbeat = false } = {}) {
    if (this.state !== 'play') return;
    if (shake > (this._shake ? this._shake.amp * (1 - this._shake.t / this._shake.dur) : 0)) this._shake = { amp: Math.min(1, shake), t: 0, dur: Math.max(0.1, seconds) };
    if (fov) this.fovPunch = Math.min(this.fovPunch || 0, fov);
    if (heartbeat && this.e.time.value - (this._beatAt ?? -9) > 1.5) { this._beatAt = this.e.time.value; this.e.audio.play('heart', { volume: 1 }); }
  }
  /** Something hurt you that isn't a fall (the bear's swat). One blow never kills from above half health. */
  hurt(amount, why = 'generic') {
    if (this.state !== 'play') return;
    const e = this.e, floor = this.health > 0.5 ? 0.05 : 0;
    this.health = Math.max(floor, this.health - amount); this.hurtAt = e.time.value; this.limp = Math.min(1, this.limp + amount);
    e.audio.sfx('cloth', { volume: 0.6 }); e.audio.sfx('knock_one', { volume: 0.5 });
    if (this.health <= 0.001) this.die(why);
  }
  onLand(drop) {
    if (this.state !== 'play') return;
    const e = this.e;
    e.audio.sfx('knock_one', { volume: Math.min(0.9, 0.2 + drop * 0.12) });
    if (drop < 1.5) return;
    e.audio.sfx('cloth', { volume: 0.45 });
    if (drop >= 8) { this.health = 0; this.die('fall'); return; }
    const dmg = Math.min(0.95, Math.pow((drop - 1.5) / 5.5, 1.3));
    this.health = Math.max(0, this.health - dmg); this.hurtAt = e.time.value; this.limp = Math.min(1, this.limp + dmg * 1.5);
    e.post.params.fear = Math.min(1, 0.45 + dmg);
    if (this.health <= 0.001) { this.die('fall'); return; }
    this.ui.toast(dmg > 0.4 ? 'You hit the ground hard. Something in your ankle gives.' : 'You land badly. That will bruise.', 3);
    setTimeout(() => this.checkpoint('fell'), 1500);
  }
  /** What Esc means right now, short of pausing. Returns true if it did something. */
  escape() {
    if (this.chill && this.chill.sitting) { this.chill.stand(); return true; }
    if (this.placing) { this.cancelPlace(); return true; }
    if (this.binocular) { this.binocular = false; return true; }
    if (this.mode !== 'walk') { this.exitMode(); return true; }
    if (this.camRaised) { this.lowerCamera(); return true; }
    if (this.holding) { this.holding = null; this.photos.close(); this.ui.print(null); return true; }
    return false;
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
    const [hFrom, hTo] = this.clock.tick(dt);
    e.sky.setTime(dayHour(this.clock.hour));
    // radio
    if (this.resting && (this.obj.list.length !== this.restObjN || this.radio.busy || e.input.isDown('forward') || e.input.isDown('back') || this.clock.held)) { this.resting = false; this.clock.speed = 1; e.post.set({ blackout: 0 }); }
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
      if (ev === 'low') { this.say(S.LINES.fuelLow); if (this.night) { const rid = this.clock.phase === 'night1' ? 'n1_refuel' : 'n2_refuel'; if (this.obj.isDone(rid)) this.obj.remove(rid); this.add(rid, { urgent: true }); } }
      if (ev === 'empty') { this.say(S.LINES.fuelEmpty); e.audio.play('generator_stop'); }
    }
    const sigMode = this.signal.mode && t - this.signal.last < 2.4;
    if (!sigMode) this.signal.mode = false;
    SL.on = this.fuel.power && !!this.slLit && (sigMode ? e.input.isDown('signal') : true);
    SL.power = this.fuel.power ? 1 - this.fuel.sputter * 0.7 : 0;
    e.audio.setAmbience({ generator: this.fuel.genOn ? 1 : 0, genSputter: this.fuel.sputter, rain: e.sky.weather.rain, wind: e.sky.weather.wind * (this.inCab() ? 1 + this.co.open * 0.5 : 1),
      forest: this.wildlife && this.wildlife.silent ? 0 : (this.night ? 0.8 : 0.6), radioStatic: this.inCab() ? 0.35 : 0,
      heater: this.co.heater ? 1 : 0, stove: this.coffee != null ? 1 : 0, coffee: this.coffee ?? 0, lamp: e.lights.cabLamp.on ? 1 : 0, clockTick: 1,
      inCab: this.inCab(), doorOpen: !this.flags.doorShut, windowsOpen: this.co.open });
    // the score follows what's happening (src/engine/music.js; changes are debounced inside, so asking every frame is fine)
    { const W = this.weeper, M = e.audio.music;
      const mood = M && M.pickMood ? M.pickMood({ state: this.state, phase: this.clock.phase, hour: this.clock.hour, inCab: this.inCab(), sitting: !!this.sitting, weeper: W.state, weeperDist: W.pos ? dist(W.pos, this.pos()) : 999 }) : null;
      if (mood) M.setMood(mood); }
    for (const ev of this.keyer.update(t)) if (ev.kind === 'end') this.onMorseEnd(ev.v, t);
    // modes: camera placement
    const cam = e.camera;
    if (this.mode === 'searchlight') {
      const o = SL.worldOrigin(), d = SL.worldDir();
      cam.position.copy(o).addScaledVector(d, -0.95).add(this._slUp || (this._slUp = new THREE.Vector3(0, 0.66, 0)));   // over the lamp's shoulder: the housing sits low in the view
      cam.lookAt(o.clone().addScaledVector(d, 60));
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
    this.fovPunch = (this.fovPunch || 0) * Math.exp(-dt * 3.5);
    const fovT = (this.binocular && this.mode === 'walk' ? 16 : this.fovTarget) + this.fovPunch;
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    cam.userData.zoom = 68 / cam.fov;
    const fw = cam.getWorldDirection(this._fw || (this._fw = new THREE.Vector3()));
    this.ui.binoculars(this.binocular && this.mode === 'walk', (Math.atan2(fw.x, -fw.z) * 180 / Math.PI + 360) % 360);
    // windows: slide the sashes to match the rule state
    if (!this.sashes) { this.sashes = {}; for (const k of 'nesw') { const o = e.world.objects.get('FL_sash_' + k); if (o) this.sashes[k] = { o, base: o.position.clone(), t: 0 }; } }
    for (const k in this.sashes) {
      const s = this.sashes[k], tgt = this.co.windows[k] ? 1 : 0; if (Math.abs(s.t - tgt) < 1e-3 && s.done) continue;
      s.t += Math.sign(tgt - s.t) * Math.min(Math.abs(tgt - s.t), dt * 1.6); s.done = Math.abs(s.t - tgt) < 1e-3;
      const sl = { n: [1, 0, 0], s: [-1, 0, 0], e: [0, 0, 1], w: [0, 0, -1] }[k], inw = { n: [0, 0, 1], s: [0, 0, -1], e: [-1, 0, 0], w: [1, 0, 0] }[k];
      const u = s.t * s.t * (3 - 2 * s.t) * 0.88, v = Math.min(1, s.t * 8) * 0.08;
      s.o.position.set(s.base.x + sl[0] * u + inw[0] * v, s.base.y, s.base.z + sl[2] * u + inw[2] * v);
    }
    // the cab door swings to its state (E); its collider only while it's shut
    if (this._door === undefined) { this._door = e.world.objects.get('FL_cab_door') || null; this._doorCol = e.world.colliders.find((c) => c.name === 'COL_wall_cab_door') || null; this._doorA = this.flags.doorShut ? 0 : 1; }
    if (this._door) {
      const tgt = this.flags.doorShut ? 0 : 1; this._doorA += Math.sign(tgt - this._doorA) * Math.min(Math.abs(tgt - this._doorA), dt * 1.4);
      const k = this._doorA * this._doorA * (3 - 2 * this._doorA);
      this._door.quaternion.setFromAxisAngle(this._yAxis || (this._yAxis = new THREE.Vector3(0, 1, 0)), THREE.MathUtils.degToRad(178) * k);
    }
    if (this._doorCol) this._doorCol.enabled = !!this.flags.doorShut && this._doorA < 0.15;
    // coffee on the stove
    if (this.coffee != null && this.coffee < 1) { this.coffee = Math.min(1, this.coffee + dt / 25); if (this.coffee >= 1) this.ui.toast('The coffee pot rattles its lid.', 2.5); }
    // the camera on the south shelf appears at dusk on day 1 (a real item: E picks it up)
    if (this.flags.cameraOut && !this.photos.hasCamera && this.iv.templates.camera && !this.inv.items.some((i) => i.kind === 'camera')) {
      const a = this.anchor('IA_camera_shelf') || new THREE.Vector3(-0.62, 30.9, 1.865);
      this.inv.create('camera', { where: 'world', pos: this.iv.settle([a.x, a.y, a.z]), rotY: Math.PI * 0.9 }); this.syncItems();
    }
    if (this.camRaised) this.ui.cameraFrame({ left: this.photos.packLeft, flash: this.flashOn });
    // prints
    for (const ev of this.photos.tick(dt)) {
      if (ev.kind === 'seen') {
        const p = this.photos.get(ev.id);
        if (p && p.forbidden) { e.audio.music.sting('seen'); this.weeper.trigger('print', { night: this.night, carrier: p.id }); this.say(S.LINES.weeperSeen); e.audio.play('heart', { volume: 1 }); this.add('weeper_send'); }
      }
    }
    if (this.holding) { const p = this.photos.get(this.holding); const v = this.photos.look(this.holding); this.ui.print(p && v ? { ...v, dataURL: p.dataURL } : null); } else this.ui.print(null);
    // CO
    // body: temperature, thirst, hunger
    const Pl = this.player(), wx = e.sky.weather, ha = this.anchor('IA_heater');
    for (const ev of this.surv.tick(Math.max(0, hTo - hFrom), { hour: dayHour(this.clock.hour), y: Pl.position.y, zone: Pl.zone, rain: wx.rain, fog: wx.fog, wind: wx.wind,
      heater: this.co.heater, open: this.co.open, inWater: !!Pl.inWater, jog: e.input.isDown('jog') && Pl.stamina > 0.05, night: this.night,
      nearHeater: ha ? Pl.position.distanceTo(ha) < 1.6 : false })) {
      if (ev === 'thirsty') this.ui.toast('Your mouth is dry. Drink something: the canteen, or the spring.', 4);
      if (ev === 'hungry') this.ui.toast('Your stomach is knotted. Eat something: there are tins on the shelf in the cab.', 4);
      if (ev === 'freezing') this.ui.toast('You\'re shaking with cold. Get inside and light the heater.', 4);
    }
    // injuries mend slowly on their own, quickly asleep; a limp fades
    if (this.health < 1 && e.time.value - (this.hurtAt ?? -99) > 8) this.health = Math.min(1, this.health + dt * (this.resting ? 1 / 25 : this.sitting ? 1 / 90 : 1 / 240));
    this.limp = Math.max(0, this.limp - dt / 45);
    Pl.speedMul = this.surv.vigor * (1 - 0.45 * this.limp) * (this.health < 0.3 ? 0.8 : 1);
    this.survT = (this.survT || 0) - dt;
    if (this.survT <= 0) { this.survT = 0.25; this.ui.survival({ feels: this.surv.feelsF, air: this.surv.airF, icon: this.surv.icon, water: this.surv.water, food: this.surv.food, wet: this.surv.wet, mph: this.surv.mph, health: this.health }); this.refreshHotbar(); }
    // items: the thing in your hand, the placing ghost, wheel = switch hands (or turn what you're placing)
    const wh = e.input.consumeWheel();
    if (wh && this.mode === 'walk' && !this.ui.modalOpen()) { if (this.placing) this.placing.rot += wh * Math.PI / 12; else this.selectSlot((this.inv.active + (wh > 0 ? 1 : HAND_SLOTS - 1)) % HAND_SLOTS); }
    this.updatePlace();
    const act = this.inv.activeItem;
    const moving = e.input.isDown('forward') || e.input.isDown('back') || e.input.isDown('left') || e.input.isDown('right') ? 1 : 0;
    this.iv.hold(this.mode === 'walk' && !this.camRaised && !this.binocular && !this.placing && act ? act.kind : null, t, moving);
    if (e.lights.flashlight.on && !this.inv.inHands('flashlight')) e.lights.flashlight.on = false;
    this.iv.setTorchGlow(e.lights.flashlight.on);
    const coEv = this.co.tick(dt, { inCab: this.inCab(), night: this.night, rng: this.rng, coldTarget: this.surv.coldTarget });
    e.post.params.co = this.co.blood;
    for (const ev of coEv) {
      if (ev === 'shiver') this.say(S.LINES.shiver);
      if (ev === 'passout') { e.post.set({ blackout: 1 }); this.say(S.LINES.passout); setTimeout(() => { this.co.wake(); e.post.set({ blackout: 0 }); this.say(S.LINES.wakeWindow); }, 3500); }
      if (ev.startsWith('hallucinate:')) this.hallucinate(ev.split(':')[1]);
    }
    // world entities
    this.updateHikers(dt, t);
    this.updateLost(dt, t);
    this.bearFear = Math.max(0, (this.bearFear || 0) - dt * 0.35);   // wildlife refreshes it every frame while the bear is close
    if (this.wildlife) this.wildlife.update(dt, t);
    this.updateWeeper(dt, t);
    if (this.dog) this.dog.update(dt, t);
    // sitting down turns you to face what the seat looks out on
    if (this.sitting && this.chill && this.chill.sitting && this.chill.sitting !== this._sitFaced) {
      const sp = this.chill.spots.find((x) => x.id === this.chill.sitting);
      if (sp && sp.facing) this.player().lookAt(new THREE.Vector3(sp.pos[0] + sp.facing[0] * 40, sp.pos[1] + 0.6, sp.pos[2] + sp.facing[1] * 40), 1.2);
      this._sitFaced = this.chill.sitting;
    }
    if (!this.sitting) this._sitFaced = null;
    if (this.otherEnt && this.bedSitterT != null) { this.bedSitterT += dt; const c = e.view.check(this.otherEnt); if (!c.inFrustum && this.bedSitterT > 3) { this.otherEnt.remove(); this.otherEnt = null; this.bedSitterT = null; } }
    // smoke by day
    if (this.smoke.mesh.visible) {
      this.smoke.opacity += ((this.smokeFade || 0) - this.smoke.opacity) * Math.min(1, dt * 0.4);
      this.smoke.update(dt, e.camera, e.scene.fog && e.scene.fog.color, e.sky.sun && e.sky.sun.color, e.sky.dayFactor);
      if (this.smoke.opacity < 0.01 && !this.smokeFade) this.smoke.mesh.visible = false;
    }
    // truck / placeholders visibility
    const truck = e.scene.getObjectByName('placed:prop_supply_truck') || this.ph['prop_supply_truck']; if (truck) truck.visible = !!this.truckVisible;
    // held can in view, watch
    this.ui.watch(e.input.isDown('watch'), fmtHour(this.clock.hour) + (this.clock.held ? '' : ''));
    // the path rule, said once
    const off = this.player().offTrail || 0;
    if (off > 13 && !this._warnedOff) { this._warnedOff = true; this.ui.toast(this.night ? 'You can\'t see the trail anymore. Go back.' : 'The trail is behind you. Don\'t lose it.', 4); }
    if (off < 6) this._warnedOff = false;
    if (this.player().blockedByPath && !this.flags.toldPath) { this.flags.toldPath = true; this.ui.toast('The timber is too thick to go any further. Back to the trail.'); }
    // secret checkpoints: walking into the cab, and every two game hours
    const zoneNow = this.player().zone;
    if (this._lastZone === 'cab' && zoneNow !== 'cab' && this.phaseTime > 3) {
      if (this.clock.phase === 'night1' && this.flags.refueledOnce) this.flags.leftCabAfterRefuel = true;
      if (this.clock.phase === 'night2') this.flags.leftCabNight2 = true;
    }
    if (zoneNow === 'cab' && this._lastZone !== 'cab' && this.phaseTime > 3) this.checkpoint('cab');
    this._lastZone = zoneNow;
    const half = Math.floor(this.clock.hour * 2);   // time checkpoints: every :00 and :30 on the game clock
    if (this._cpHour == null) this._cpHour = half;
    else if (half !== this._cpHour) { this._cpHour = half; this._cpAt = 0; this.checkpoint('time ' + fmtHour(half / 2)); }
    // script + tracker
    this.scriptTick(dt);
    this.trackerT = (this.trackerT || 0) - dt; if (this.trackerT <= 0) { this.trackerT = 1; this.refreshTracker(); }
    // screen shake last: player.update already placed the camera this frame, so the offset never accumulates
    const sh = this._shake;
    if (sh) {
      sh.t += dt; const k = sh.amp * Math.max(0, 1 - sh.t / sh.dur); if (k <= 0.001) this._shake = null;
      else { const c = e.camera, w = t * 38; c.position.x += Math.sin(w * 1.3) * 0.045 * k; c.position.y += Math.sin(w * 1.7 + 1) * 0.035 * k; c.rotation.z += Math.sin(w * 0.9 + 2) * 0.03 * k; }
    }
  }
  hallucinate(kind) {
    const e = this.e;
    this.say(S.LINES.hallu[kind] || []);
    if (kind === 'figure') { const h = e.entities.spawn('other_lookout', { position: new THREE.Vector3(2.6, 30.0, 1.2), facing: new THREE.Vector3(0, 30, 0), pose: 'back_window' }); setTimeout(() => h.remove(), 1600); }
    if (kind === 'knock') e.audio.play('knock', { position: this.anchor('IA_cab_door') || this.anchor('IA_trapdoor') || new THREE.Vector3(-1.5, 30, 0), volume: 1.2 });
  }

  // ------------------------------------------------------------------ test hooks
  skipTo(phase) { if (!this.clock) this.fresh(phase); if (isNight(phase)) this.fuel.genOn = this.fuel.tank > 0; if (phase !== 'day1' && !this.photos.hasCamera) this.photos.giveCamera(1); this.startPhase(phase, false); return phase; }
  setTime(h) { this.clock.setHour(h); return this.clock.hour; }
}
