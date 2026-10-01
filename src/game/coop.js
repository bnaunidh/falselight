// FALSE LIGHT — co-op, up to four lookouts (src/net/mp.js carries the messages). The host's game is the world: the clock
// and the story, the tasks (anyone's work counts for everyone), the generator's fuel, the fires, Juniper, and the last
// morning's truck. Everyone keeps their own pack, their own head (the director's tricks are yours alone) and their own
// Weeper: whoever meets his eyes is the one he comes for. Friends are figures with a name over them and a light in hand.
// Hooked onto the Game from outside (wrapping a few of its methods), so the single-player game is untouched.
import * as THREE from 'three';
import { createMP, MAX_PLAYERS } from '../net/mp.js?v=4f44325106300c7d';

const TINTS = [0xb8332a, 0x2f6db3, 0x3e8f4e, 0xd2a019];
const SYNC_FLAGS = /^(fire_|fireReported_)|^(savedN1|lostN1|walkedOffN1|falseWalked|gateShut|gateOpenedByIt|radioDead|evac|cacheStocked|cacheDoorOpen|cacheLock|tunnelOpen|dogName)$/;
const WAIT_CARD = '<b>In the truck</b>Walt keeps the engine running. Waiting for the others…';

export function createCoop(engine, ui, { getGame, begin }) {
  const mp = createMP();
  const C = { mp, get on() { return !!mp.role; }, get host() { return mp.role === 'host'; }, get client() { return mp.role === 'client'; } };
  const players = new Map();   // id -> { name, p:[x,y,z], yaw, fl, ent, tag, glow, k (tint), seen, lastP }
  let poseT = 0, stateT = 0, applying = false, hooked = null, myId = 'h', dogSnap = null, badge = null, joinMsg = null;
  const inTruck = new Set(), dead = new Set();
  const G = () => getGame();
  const say = (t, s = 3) => ui.toast(t, s);

  // ---------------------------------------------------------------- the menu (title → Play with friends)
  C.menu = (back) => ui.choose('Play with friends', [{ label: 'Host a game' }, { label: 'Join a game' }, { label: 'Back' }], (c) => {
    if (c.label === 'Back') return back();
    ui.ask('Your name', 'What the others see over your head.', C.lastName || 'Lookout', (name) => {
      name = String(name || '').trim().slice(0, 16) || 'Lookout'; C.lastName = name;
      const fail = (title, e) => { ui.closeModal(); ui.card(title, (e && e.message) || String(e), [{ id: 'ok', label: 'Back' }], () => back()); };
      if (c.label === 'Host a game') {
        ui.note('Opening a room…', 'Connecting.');
        mp.host(name).then((code) => {
          ui.closeModal(); myId = 'h'; players.clear();
          ui.card('Room ' + code, `Tell your friends the code: ${code}. They choose Play with friends → Join a game. Start whenever you like: friends can join any time, up to three of them.`,
            [{ id: 'go', label: 'Start the season' }, { id: 'back', label: 'Cancel' }], (id) => { if (id === 'go') { begin('new'); hook(); } else { C.leave(); back(); } });
        }).catch((e) => fail('Couldn\'t open a room', e));
      } else ui.ask('Room code', 'Five letters, from the host.', '', (code) => {
        ui.note('Joining…', 'Looking for room ' + String(code || '').toUpperCase() + '.');
        mp.join(code, name).catch((e) => fail('Couldn\'t join', e));
      });
    });
  });
  C.leave = () => { if (!mp.role) return; mp.leave(); for (const pl of players.values()) dropAvatar(pl); players.clear(); inTruck.clear(); dead.clear(); const g = G(); if (g) g.mpClient = false; if (badge) badge.style.display = 'none'; };

  // ---------------------------------------------------------------- hooks on the Game (once per game object)
  function hook() {
    const g = G(); if (!g || hooked === g) return; hooked = g; g.coop = C;
    const complete = g.complete.bind(g);
    g.complete = (id, note) => { const had = g.obj && g.obj.has(id) && !g.obj.isDone(id); complete(id, note); if (had && C.client && !applying) mp.send({ t: 'act', a: 'complete', id }); };
    const retry = g.retry.bind(g);
    g.retry = () => {   // co-op: you come to in the cab; the clock never goes back for everyone
      if (!C.on) return retry();
      if (g.clock.phase === 'day7' && g.clock.ended) { C.leave(); g.calmBody(); if (g.onTitle) g.onTitle(); return; }
      dead.delete(myId); if (C.client) mp.send({ t: 'act', a: 'alive' });
      engine.post.set({ blackout: 0, fear: 0 }); g.calmBody(); g.health = 0.6; g.limp = 0.5;
      if (g.weeper && g.weeper.state === 'caught') g.weeper.state = 'gone';
      g.player().teleport(g.anchor('SP_cab_bed') || new THREE.Vector3(-1, 30, -0.7)); g.state = 'play'; engine.input.lock();
      say('You come to on the floor of the cab. Someone dragged you up here.', 4);
    };
    const die = g.die.bind(g);
    g.die = (kind) => { if (g.state !== 'play') return; die(kind); if (!C.on) return; dead.add(myId); if (C.client) mp.send({ t: 'act', a: 'dead' }); else { if (kind === 'fire') mp.send({ t: 'dieAll', kind }); checkTruck(); } };
    const getIn = g.getIn.bind(g);
    g.getIn = () => {
      if (!C.on) return getIn();
      const d = g.dog, P = g.player().position, withDog = !!(d && d.tamed && d.position.distanceTo(P) < 15);
      if (C.host && d && d.tamed && !withDog && !g._leaveDog) { g._leaveDog = true; say(`${g.flags.dogName || 'Juniper'} isn't with you. E again to go without her.`, 4); return; }
      if (C.host) g.flags.dogOut = withDog;
      g.state = 'transition'; ui.fade(1, WAIT_CARD);
      if (C.client) mp.send({ t: 'act', a: 'in' }); else { inTruck.add('h'); checkTruck(); }
    };
    C._getIn = getIn;
    const ot = g.onTitle; g.onTitle = () => { C.leave(); if (ot) ot(); };
    // the generator: whoever pours or starts it, the host's tank is the one
    const gen = engine.interact.targets.get('generator');
    if (gen && !gen._coop) { const use = gen.onUse; gen._coop = true; gen.onUse = () => { use(); if (C.client) mp.send({ t: 'act', a: 'fuel', tank: g.fuel.tank, gen: !!g.fuel.genOn }); }; }
    // Juniper lives in the host's game: what you do to her goes there
    if (g.dogReady) g.dogReady.then(() => {
      const b = g.dog && g.dog.brain; if (!b || b._coop) return; b._coop = true;
      for (const m of ['command', 'offer', 'pet']) { const f = b[m].bind(b); b[m] = (...a) => { if (!C.client) return f(...a); mp.send({ t: 'act', a: 'dog', m, arg: a[0] }); return true; }; }
    });
  }
  /** Client side of the dog: her pose from the host's snapshot, no rules of her own. → true when it applied (skip her brain). */
  C.hook = hook;   // (the menu does this; tests call it)
  C.dogRemote = (b) => {
    if (!C.client) return false; const s = dogSnap; if (!s) return true;
    b.pos[0] = s.p[0]; b.pos[1] = s.p[1]; b.pos[2] = s.p[2]; b.yaw = s.y; b.speed = s.s; b.posture = s.po; b.act = s.a; b.tamed = !!s.tm; b.mode = s.m; b.atBed = !!s.b;
    return true;
  };
  function checkTruck() {   // the host's truck goes when everyone still alive is in it
    if (!C.host || !inTruck.has('h')) return;
    const all = ['h', ...mp.peers.keys()];
    if (!all.every((id) => inTruck.has(id) || dead.has(id))) { ui.fade(1, WAIT_CARD + `<br>${inTruck.size} of ${all.length}`); return; }
    const g = G(); mp.send({ t: 'end', dogOut: !!g.flags.dogOut });
    g.state = 'play'; g._leaveDog = true; C._getIn();
  }

  // ---------------------------------------------------------------- messages
  mp.on('hello', (m, from) => {   // host: a friend arrived
    const g = G(); players.set(from, { name: String(m.name || 'Lookout').slice(0, 16), k: players.size + 1 });
    say(`${players.get(from).name} is coming up the trail.`, 3);
    const flags = {}; if (g && g.flags) for (const [k, v] of Object.entries(g.flags)) if (SYNC_FLAGS.test(k)) flags[k] = v;
    mp.send({ t: 'welcome', you: from, ph: g && g.clock ? g.clock.phase : 'day1', h: g && g.clock ? g.clock.hour : null, flags, playing: !!(g && g.state === 'play') }, from);
  });
  mp.on('welcome', (m) => { myId = m.you; joinMsg = m; startClient(); });
  mp.on('full', () => { C.leave(); ui.card('That room is full', `Four lookouts already.`, [{ id: 'ok', label: 'OK' }], () => {}); });
  mp.on('left', (m, from) => { const pl = players.get(from); if (pl) { say(`${pl.name} left.`, 3); dropAvatar(pl); players.delete(from); } inTruck.delete(from); dead.delete(from); checkTruck(); });
  mp.on('hostLeft', () => { const g = G(); C.leave(); say('The host left. The mountain is yours alone now.', 5); if (g) g.mpClient = false; });
  mp.on('pose', (m, from) => { const pl = players.get(from); if (pl) Object.assign(pl, { p: m.p, yaw: m.yaw, fl: m.fl, dead: m.d }); });
  mp.on('poses', (m) => { const seen = new Set(); for (const q of m.list) { if (q.id === myId) continue; seen.add(q.id); let pl = players.get(q.id); if (!pl) players.set(q.id, pl = { name: q.n, k: q.k }); Object.assign(pl, { name: q.n, p: q.p, yaw: q.yaw, fl: q.fl, dead: q.d, k: q.k }); }
    for (const [id, pl] of players) if (!seen.has(id)) { dropAvatar(pl); players.delete(id); } });
  mp.on('chat', (m, from) => { const name = C.host ? (players.get(from) || {}).name || 'Lookout' : m.n; say(`${name}: ${m.text}`, 5); if (C.host) mp.send({ t: 'chat', n: name, text: m.text }, null, from); });
  mp.on('act', (m, from) => {   // host: what a friend did that changes the shared world
    const g = G(); if (!g || !g.clock) return;
    if (m.a === 'complete' && g.obj.has(m.id)) g.complete(m.id);
    else if (m.a === 'fuel') { g.fuel.tank = Math.max(0, +m.tank || 0); if (!!m.gen !== !!g.fuel.genOn) { if (m.gen) g.fuel.start(); else g.fuel.stop(); } }
    else if (m.a === 'dog') { const b = g.dog && g.dog.brain; if (b) { if (m.m === 'command') b.command(m.arg); else if (m.m === 'offer') b.offer(); else b.pet(); } }
    else if (m.a === 'in') { inTruck.add(from); checkTruck(); }
    else if (m.a === 'dead') { dead.add(from); const pl = players.get(from); if (pl) say(`${pl.name} is down.`, 3); checkTruck(); }
    else if (m.a === 'alive') dead.delete(from);
  });
  mp.on('state', (m) => applyState(m));
  mp.on('end', (m) => { const g = G(); if (!g) return; g.flags.dogOut = !!m.dogOut; if (g.landmarks && g.landmarks.openTunnel) g.landmarks.openTunnel(true); g.finish({ evac: true }); });
  mp.on('dieAll', (m) => { const g = G(); if (g && g.state === 'play') g.die(m.kind); });

  function startClient() {   // a friend's game: start a season and follow the host to the same day and hour
    const g = G(), m = joinMsg; if (!m) return;
    if (!g || !g.itemsReady) { setTimeout(startClient, 500); return; }
    ui.closeModal(); begin('new');
    const wait = () => { const g2 = G(); if (!g2 || g2.state !== 'play') return setTimeout(wait, 300);
      g2.mpClient = true; hook();
      if (m.ph && m.ph !== g2.clock.phase) g2.skipTo(m.ph);
      if (m.h != null) g2.clock.setHour(m.h);
      Object.assign(g2.flags, m.flags || {});
      say(`You're in room ${mp.code}.`, 3); joinMsg = null; };
    wait();
  }
  function applyState(m) {
    const g = G(); if (!g || !g.clock || !C.client) return;
    dogSnap = m.dog || null;
    if (g.state === 'transition' || g.state === 'end' || g.state === 'dead') return;
    if (m.ph !== g.clock.phase && g.state === 'play') {   // the host's day turned: follow (the same card the host saw)
      const n = m.ph; g.state = 'transition'; ui.fade(1, `<b>${/night/.test(n) ? 'Dusk' : 'First light'}</b>`);
      setTimeout(() => { g.clearWorldEntities(); g.startPhase(n); g.clock.setHour(m.h); setTimeout(() => ui.fade(0), 1500); }, 900);
      return;
    }
    g.clock.gates = [];   // the host's gates hold the clock, not ours
    if (Math.abs(m.h - g.clock.hour) > 0.02) g.clock.setHour(m.h);
    g.clock.speed = 1;
    applying = true;
    for (const [id, done] of m.obj || []) if (done && g.obj.has(id) && !g.obj.isDone(id)) g.complete(id);
    applying = false;
    if (m.fuel && g.fuel) { g.fuel.tank = m.fuel[0]; if (!!m.fuel[1] !== !!g.fuel.genOn) { if (m.fuel[1]) g.fuel.start(); else g.fuel.stop(); } }
    if (m.flags) Object.assign(g.flags, m.flags);
  }

  // ---------------------------------------------------------------- per frame: send, sync, draw the others
  C.update = (dt) => {
    const g = G(); if (!C.on || !g || !g.clock) { if (badge) badge.style.display = 'none'; return; }
    const P = g.player(), playing = g.state === 'play' || g.state === 'dead';
    if ((poseT -= dt) <= 0 && playing) {
      poseT = 0.1;
      const me = { p: [+P.position.x.toFixed(2), +P.position.y.toFixed(2), +P.position.z.toFixed(2)], yaw: +P.yaw.toFixed(3), fl: !!engine.lights.flashlight.on, d: g.state === 'dead' };
      if (C.client) mp.send({ t: 'pose', ...me });
      else {
        const list = [{ id: 'h', n: mp.name, k: 0, ...me }];
        for (const [id, pl] of players) if (pl.p) list.push({ id, n: pl.name, k: pl.k, p: pl.p, yaw: pl.yaw, fl: pl.fl, d: pl.dead });
        mp.send({ t: 'poses', list });
      }
    }
    if (C.host && (stateT -= dt) <= 0 && g.state === 'play') {
      stateT = 0.25;
      const flags = {}; for (const [k, v] of Object.entries(g.flags)) if (SYNC_FLAGS.test(k) && (typeof v !== 'object' || v === null)) flags[k] = v;
      const b = g.dog && g.dog.brain;
      mp.send({ t: 'state', ph: g.clock.phase, h: g.clock.hour, obj: g.obj.list.map((o) => [o.id, o.done ? 1 : 0]), fuel: [g.fuel.tank, g.fuel.genOn ? 1 : 0], flags,
        dog: b ? { p: b.pos.map((v) => +v.toFixed(2)), y: +b.yaw.toFixed(3), s: +b.speed.toFixed(2), po: b.posture, a: b.act, tm: b.tamed ? 1 : 0, m: b.mode, b: b.atBed ? 1 : 0 } : null });
    }
    for (const pl of players.values()) drawAvatar(pl, dt);
    drawBadge();
  };
  // chat: T
  addEventListener('keydown', (e) => {
    const g = G(); if (!C.on || !g || g.state !== 'play' || ui.modalOpen() || e.code !== 'KeyT' || e.repeat) return;
    e.preventDefault();
    g.openModal(() => ui.ask('Say', 'To everyone on the mountain.', '', (text) => { g.closedModal(); text = String(text || '').trim().slice(0, 140); if (!text) return; say(`${mp.name}: ${text}`, 5); mp.send(C.host ? { t: 'chat', n: mp.name, text } : { t: 'chat', text }); }));
  });

  function drawAvatar(pl, dt) {
    if (!pl.p) return;
    if (!pl.ent) {
      pl.ent = engine.entities.spawn('hiker', { position: new THREE.Vector3(...pl.p), pose: 'stand' });
      const tint = new THREE.Color(TINTS[(pl.k || 0) % TINTS.length]);
      pl.ent.ready.then(() => pl.ent.root.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && /jacket|shell|coat|top|shirt/i.test(o.material.name || o.name)) { o.material = o.material.clone(); o.material.color.lerp(tint, 0.75); } }));
      pl.tag = nameTag(pl.name); engine.scene.add(pl.tag);
      pl.glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe2b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
      pl.glow.scale.set(0.5, 0.5, 1); engine.scene.add(pl.glow); pl.lastP = pl.p.slice(); pl.cur = new THREE.Vector3(...pl.p);
    }
    const tgt = new THREE.Vector3(...pl.p), k = 1 - Math.exp(-dt * 12);
    const jump = pl.cur.distanceTo(tgt) > 6; if (jump) pl.cur.copy(tgt); else pl.cur.lerp(tgt, k);
    pl.ent.setPosition(pl.cur); pl.ent.root.rotation.y = (pl.yaw || 0) + Math.PI;
    const moving = Math.hypot(pl.p[0] - pl.lastP[0], pl.p[2] - pl.lastP[2]) > 0.02; pl.lastP = pl.p.slice();
    pl.walkT = moving ? (pl.walkT || 0) + dt : 0;
    pl.ent.setPose(pl.dead ? 'stand_tilt' : moving && Math.floor(pl.walkT * 3.4) % 2 ? 'step' : 'stand');
    pl.tag.position.set(pl.cur.x, pl.cur.y + 2.05, pl.cur.z);
    const fw = new THREE.Vector3(-Math.sin(pl.yaw || 0), 0, -Math.cos(pl.yaw || 0));
    pl.glow.position.copy(pl.cur).addScaledVector(fw, 0.45).add(new THREE.Vector3(0.15, 1.25, 0)); pl.glow.visible = !!pl.fl;
  }
  function dropAvatar(pl) { if (pl.ent) pl.ent.remove(); if (pl.tag) engine.scene.remove(pl.tag); if (pl.glow) engine.scene.remove(pl.glow); pl.ent = pl.tag = pl.glow = null; }
  function nameTag(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    x.font = '600 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillText(name, 129, 34); x.fillStyle = 'rgba(240,232,214,0.95)'; x.fillText(name, 128, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false })); s.scale.set(1.2, 0.3, 1); s.renderOrder = 9; return s;
  }
  function drawBadge() {
    if (!badge) { badge = document.createElement('div'); badge.style.cssText = 'position:fixed;left:14px;top:12px;z-index:30;font:600 12px Georgia,serif;color:rgba(240,232,214,.9);background:rgba(10,12,14,.45);padding:5px 9px;border-radius:6px;pointer-events:none;letter-spacing:.3px'; document.body.appendChild(badge); }
    const n = C.host ? 1 + mp.peers.size : players.size + 1, txt = `Room ${mp.code} · ${n}/${MAX_PLAYERS} lookouts · T to talk`;
    if (badge.textContent !== txt) badge.textContent = txt; badge.style.display = 'block';
  }
  return C;
}
