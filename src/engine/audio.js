// FALSE LIGHT — procedural WebAudio: ambience beds (rain, wind, forest day/night, creek, generator, radio static),
// positional one-shots, footsteps by surface, and the human sounds (sob, scream, breath) from filtered noise + formants.
// Starts suspended until the first user gesture; never plays anything by itself before that.
import * as THREE from 'three';

export function createAudio(engine) {
  let ctx = null, master = null, bus = {}, noiseBuf = null, brownBuf = null;
  const beds = {};
  const listenerPos = new THREE.Vector3();
  const A = { volume: 0.8, muted: true, started: false, ambience: { rain: 0, wind: 0.3, generator: 0, radioStatic: 0, forest: 0.6, creek: 0 }, roof: 0 };

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = A.muted ? 0 : A.volume; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(master);
    bus.sfx = ctx.createGain(); bus.sfx.connect(comp);
    bus.amb = ctx.createGain(); bus.amb.gain.value = 0.9; bus.amb.connect(comp);
    // simple convolution-free "room": a feedback delay for the cab/stairwell
    const verbIn = ctx.createGain(); const d1 = ctx.createDelay(1); d1.delayTime.value = 0.043; const fb = ctx.createGain(); fb.gain.value = 0.32; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    verbIn.connect(d1); d1.connect(lp); lp.connect(fb); fb.connect(d1); lp.connect(comp); bus.verb = verbIn; bus.verbSend = ctx.createGain(); bus.verbSend.gain.value = 0.25; bus.verbSend.connect(verbIn); bus.sfx.connect(bus.verbSend);
    const len = ctx.sampleRate * 4;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const n = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { n[i] = Math.random() * 2 - 1; last = (last + 0.02 * n[i]) / 1.02; b[i] = last * 3.5; }
    buildBeds();
    return ctx;
  }
  const noise = (brown = false) => { const s = ctx.createBufferSource(); s.buffer = brown ? brownBuf : noiseBuf; s.loop = true; s.loopStart = Math.random(); return s; };
  const gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
  const filt = (type, f, Q = 0.7, dest) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = Q; if (dest) x.connect(dest); return x; };
  function panner(pos) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 400;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; p.connect(bus.sfx); return p;
  }

  function buildBeds() {
    // rain: broadband hiss + a patter layer; "roof" variant boosts a resonant drum band
    { const out = gain(0, bus.amb); const s = noise(); const hp = filt('highpass', 600); const lp = filt('lowpass', 7000); s.connect(hp); hp.connect(lp); lp.connect(out);
      const roofG = gain(0, out); const s2 = noise(true); const bp = filt('bandpass', 380, 1.4); s2.connect(bp); bp.connect(roofG); s.start(); s2.start();
      beds.rain = { out, roofG }; }
    { const out = gain(0, bus.amb); const s = noise(true); const bp = filt('bandpass', 420, 0.6); s.connect(bp); bp.connect(out); s.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = gain(260); lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      beds.wind = { out, bp }; }
    { const out = gain(0, bus.amb); const s = noise(); const bp = filt('bandpass', 1400, 0.9); s.connect(bp); bp.connect(out); s.start(); beds.creek = { out }; }
    { // generator: a single-cylinder chug (pulse train through a low resonant filter) + mechanical noise
      const out = gain(0); const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.refDistance = 4; pan.rolloffFactor = 1.3; out.connect(pan); pan.connect(bus.amb);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 29; const lp = filt('lowpass', 180, 4); o.connect(lp); lp.connect(out);
      const am = ctx.createOscillator(); am.frequency.value = 14.5; const amg = gain(0.5); am.connect(amg); amg.connect(out.gain);
      const s = noise(); const bp = filt('bandpass', 2600, 1.2); const ng = gain(0.12); s.connect(bp); bp.connect(ng); ng.connect(out);
      o.start(); am.start(); s.start(); beds.generator = { out, pan }; }
    { const out = gain(0, bus.amb); const s = noise(); const bp = filt('bandpass', 1800, 0.8); s.connect(bp); bp.connect(out); s.start(); beds.radio = { out }; }
    { const out = gain(0, bus.amb); beds.forest = { out }; }
  }

  // forest life: scheduled birds by day, crickets by night
  let lifeT = 0;
  function life(dt) {
    lifeT -= dt; if (lifeT > 0 || !ctx) return;
    const day = engine.sky ? engine.sky.dayFactor : 1; const rain = A.ambience.rain;
    lifeT = 0.4 + Math.random() * (day > 0.4 ? 2.5 : 1.2);
    const vol = A.ambience.forest * (1 - rain * 0.8) * (A.roof > 0.5 ? 0.35 : 1);
    if (vol < 0.02) return;
    const t = ctx.currentTime; const out = gain(0, beds.forest.out); beds.forest.out.gain.value = 1;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1; out.disconnect(); out.connect(pan); pan.connect(beds.forest.out);
    if (day > 0.4) {   // a varied thrush-like whistle or a chickadee
      const o = ctx.createOscillator(); o.type = 'sine'; const f0 = 2200 + Math.random() * 2200; o.frequency.setValueAtTime(f0, t);
      const notes = 1 + ((Math.random() * 3) | 0);
      for (let k = 0; k < notes; k++) { const tt = t + k * 0.28; o.frequency.setValueAtTime(f0 * (1 + (Math.random() - 0.5) * 0.3), tt); o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.3), tt + 0.22);
        out.gain.setValueAtTime(0, tt); out.gain.linearRampToValueAtTime(0.05 * vol, tt + 0.03); out.gain.linearRampToValueAtTime(0, tt + 0.24); }
      o.connect(out); o.start(t); o.stop(t + notes * 0.3 + 0.1);
    } else {   // crickets: pulsed 4.6 kHz
      const o = ctx.createOscillator(); o.frequency.value = 4400 + Math.random() * 500; const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 28 + Math.random() * 8;
      const amg = gain(0.5); am.connect(amg); const g2 = gain(0.5); amg.connect(g2.gain); o.connect(g2); g2.connect(out);
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.012 * vol, t + 0.05); out.gain.setValueAtTime(0.012 * vol, t + 0.6); out.gain.linearRampToValueAtTime(0, t + 0.7);
      o.start(t); am.start(t); o.stop(t + 0.75); am.stop(t + 0.75);
    }
  }

  // ---------------- one-shots
  function env(g, t, a, peak, d, sustain = 0, hold = 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, sustain), t + a + hold + d); }
  function burst(dest, { type = 'bandpass', f = 800, Q = 1, a = 0.002, d = 0.1, v = 0.5, brown = false, t = null }) {
    const tt = t ?? ctx.currentTime; const s = noise(brown); const x = filt(type, f, Q); const g = gain(0); s.connect(x); x.connect(g); g.connect(dest);
    env(g, tt, a, v, d); s.start(tt, Math.random() * 3); s.stop(tt + a + d + 0.05); return g;
  }
  function tone(dest, { type = 'sine', f = 440, f1 = null, a = 0.005, d = 0.2, v = 0.3, t = null }) {
    const tt = t ?? ctx.currentTime; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, tt); if (f1) o.frequency.exponentialRampToValueAtTime(f1, tt + a + d);
    const g = gain(0); o.connect(g); g.connect(dest); env(g, tt, a, v, d); o.start(tt); o.stop(tt + a + d + 0.05); return o;
  }
  // a voiced "human" source through vowel formants
  function voice(dest, { f0 = 140, dur = 1, vowel = 'a', breath = 0.3, v = 0.3, t = null, glide = 1, jitter = 0.03, sob = false }) {
    const tt = t ?? ctx.currentTime;
    const F = { a: [800, 1150, 2900], o: [500, 900, 2400], u: [350, 800, 2300], e: [450, 1800, 2600], i: [300, 2200, 3000] }[vowel];
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, tt); o.frequency.linearRampToValueAtTime(f0 * glide, tt + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = sob ? 6.5 : 5.2; const vg = gain(f0 * jitter); vib.connect(vg); vg.connect(o.frequency);
    const src = gain(1); o.connect(src);
    const n = noise(); const ng = gain(breath); n.connect(ng); ng.connect(src);
    const out = gain(0, dest);
    F.forEach((f, i) => { const bp = filt('bandpass', f, 6 - i); const g = gain([1, 0.5, 0.2][i]); src.connect(bp); bp.connect(g); g.connect(out); });
    out.gain.setValueAtTime(0, tt); out.gain.linearRampToValueAtTime(v, tt + Math.min(0.15, dur * 0.2));
    if (sob) for (let k = 0.2; k < dur; k += 0.18 + Math.random() * 0.2) out.gain.setValueAtTime(v * (0.35 + Math.random() * 0.65), tt + k);
    out.gain.linearRampToValueAtTime(0, tt + dur);
    o.start(tt); vib.start(tt); n.start(tt, Math.random() * 3); o.stop(tt + dur + 0.05); vib.stop(tt + dur + 0.05); n.stop(tt + dur + 0.05);
  }

  const SOUNDS = {
    footstep_wood: (d, v) => { burst(d, { type: 'lowpass', f: 260, Q: 3, d: 0.12, v: 0.9 * v, brown: true }); burst(d, { f: 1400, Q: 2, d: 0.05, v: 0.12 * v }); },
    footstep_dirt: (d, v) => { burst(d, { f: 900, Q: 0.8, d: 0.09, v: 0.35 * v }); burst(d, { type: 'lowpass', f: 200, d: 0.08, v: 0.35 * v, brown: true }); },
    footstep_gravel: (d, v) => { for (let k = 0; k < 4; k++) burst(d, { f: 2500 + Math.random() * 2500, Q: 3, d: 0.03, v: 0.18 * v, t: ctx.currentTime + k * 0.012 + Math.random() * 0.01 }); burst(d, { type: 'lowpass', f: 220, d: 0.07, v: 0.3 * v, brown: true }); },
    footstep_wet: (d, v) => { burst(d, { f: 700, Q: 1.5, d: 0.14, v: 0.45 * v }); tone(d, { f: 900, f1: 300, d: 0.08, v: 0.05 * v }); },
    stair_creak: (d, v) => { tone(d, { type: 'sawtooth', f: 180 + Math.random() * 90, f1: 120 + Math.random() * 40, a: 0.05, d: 0.45, v: 0.06 * v }); },
    door: (d, v) => { tone(d, { type: 'sawtooth', f: 320, f1: 190, a: 0.08, d: 0.7, v: 0.07 * v }); burst(d, { type: 'lowpass', f: 180, d: 0.25, v: 0.8 * v, brown: true, t: ctx.currentTime + 0.75 }); },
    trapdoor: (d, v) => { burst(d, { type: 'lowpass', f: 140, Q: 2, d: 0.45, v: 1.2 * v, brown: true }); burst(d, { f: 900, d: 0.08, v: 0.2 * v }); },
    gate_rattle: (d, v) => { for (let k = 0; k < 7; k++) burst(d, { f: 1800 + Math.random() * 1500, Q: 8, d: 0.06, v: 0.25 * v, t: ctx.currentTime + k * 0.07 + Math.random() * 0.03 }); },
    knock: (d, v) => { for (let k = 0; k < 3; k++) burst(d, { type: 'lowpass', f: 220, Q: 4, d: 0.14, v: 1.1 * v, brown: true, t: ctx.currentTime + k * 0.34 }); },
    drip: (d, v) => { tone(d, { f: 1600 + Math.random() * 500, f1: 700, a: 0.001, d: 0.07, v: 0.18 * v }); },
    radio_squelch: (d, v) => { burst(d, { f: 1800, Q: 0.7, a: 0.005, d: 0.22, v: 0.45 * v }); },
    morse_click: (d, v) => { burst(d, { f: 2400, Q: 4, d: 0.025, v: 0.5 * v }); burst(d, { type: 'lowpass', f: 300, d: 0.05, v: 0.4 * v, brown: true }); },
    camera_shutter: (d, v) => { burst(d, { f: 3200, Q: 2, d: 0.02, v: 0.5 * v }); burst(d, { f: 1500, Q: 2, d: 0.03, v: 0.4 * v, t: ctx.currentTime + 0.06 }); },
    camera_eject: (d, v) => { tone(d, { type: 'sawtooth', f: 95, f1: 90, a: 0.02, d: 0.9, v: 0.05 * v }); burst(d, { f: 600, Q: 3, a: 0.05, d: 0.8, v: 0.08 * v }); },
    flash_whine: (d, v) => { tone(d, { f: 2500, f1: 7500, a: 0.1, d: 1.2, v: 0.012 * v }); },
    generator_start: (d, v) => { for (let k = 0; k < 5; k++) burst(d, { type: 'lowpass', f: 250, Q: 3, d: 0.1, v: 0.7 * v, brown: true, t: ctx.currentTime + k * 0.11 }); },
    generator_stop: (d, v) => { tone(d, { type: 'sawtooth', f: 30, f1: 8, a: 0.01, d: 1.4, v: 0.2 * v }); },
    fuel_pour: (d, v) => { for (let k = 0; k < 18; k++) tone(d, { f: 300 + Math.random() * 500, f1: 150, a: 0.005, d: 0.06, v: 0.05 * v, t: ctx.currentTime + k * 0.09 + Math.random() * 0.05 }); },
    paper: (d, v) => { for (let k = 0; k < 5; k++) burst(d, { f: 4000, Q: 0.6, d: 0.04, v: 0.1 * v, t: ctx.currentTime + k * 0.05 }); },
    thunder: (d, v) => { burst(d, { type: 'lowpass', f: 90, Q: 0.5, a: 0.08, d: 3.5, v: 1.4 * v, brown: true }); burst(d, { type: 'lowpass', f: 400, a: 0.01, d: 0.6, v: 0.5 * v, brown: true }); },
    heart: (d, v) => { const t = ctx.currentTime; tone(d, { f: 55, f1: 40, d: 0.12, v: 0.5 * v, t }); tone(d, { f: 50, f1: 38, d: 0.12, v: 0.35 * v, t: t + 0.22 }); },
    breath: (d, v) => { burst(d, { f: 900, Q: 0.6, a: 0.4, d: 0.9, v: 0.12 * v }); },
    sob: (d, v) => { const t = ctx.currentTime; voice(d, { f0: 190, dur: 1.6, vowel: 'u', breath: 0.8, v: 0.25 * v, glide: 0.8, jitter: 0.06, sob: true, t });
      voice(d, { f0: 160, dur: 1.1, vowel: 'o', breath: 0.9, v: 0.18 * v, glide: 0.7, sob: true, t: t + 1.8 }); burst(d, { f: 1200, Q: 0.7, a: 0.3, d: 0.7, v: 0.1 * v, t: t + 3.0 }); },
    scream: (d, v) => { const t = ctx.currentTime; voice(d, { f0: 420, dur: 2.2, vowel: 'a', breath: 0.5, v: 0.6 * v, glide: 1.45, jitter: 0.09, t }); voice(d, { f0: 610, dur: 1.8, vowel: 'e', breath: 0.7, v: 0.35 * v, glide: 1.2, jitter: 0.12, t: t + 0.15 }); },
    radio_voice: (d, v, opts) => { const words = Math.max(2, ((opts && opts.text) || 'copy').split(/\s+/).length); const t = ctx.currentTime;
      const out = gain(1); const hp = filt('highpass', 450); const lp = filt('lowpass', 2800); out.connect(hp); hp.connect(lp); lp.connect(d);
      for (let k = 0; k < words; k++) voice(out, { f0: 105 + Math.random() * 30, dur: 0.18 + Math.random() * 0.12, vowel: 'aoeiu'[(Math.random() * 5) | 0], breath: 0.3, v: 0.35 * v, t: t + 0.15 + k * 0.33 });
      burst(d, { f: 1800, d: 0.2, v: 0.3 * v, t: t + 0.15 + words * 0.33 }); },
  };

  const api = {
    get context() { return ctx; },
    params: A,
    start() { ensure(); if (ctx && ctx.state !== 'running') ctx.resume(); A.started = true; },
    setVolume(v) { A.volume = v; if (master) master.gain.value = A.muted ? 0 : v; },
    get muted() { return A.muted; },
    setMuted(b) { A.muted = b; if (master) master.gain.value = b ? 0 : A.volume; },
    setAmbience(o) { Object.assign(A.ambience, o); },
    play(name, { position = null, volume = 1, loop = false, text = null } = {}) {
      if (!ctx || !A.started) return { stop() {}, setVolume() {} };
      const f = SOUNDS[name]; if (!f) { console.warn('no sound', name); return { stop() {}, setVolume() {} }; }
      const g = gain(1); g.connect(position ? panner(position) : bus.sfx);
      f(g, volume, { text });
      let timer = null;
      if (loop) timer = setInterval(() => f(g, volume, { text }), 3800 + Math.random() * 1500);
      return { stop() { if (timer) clearInterval(timer); g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }, setVolume(x) { g.gain.value = x; } };
    },
    footstep(surface, jog, carrying) {
      const v = (jog ? 1.2 : 0.8) * (carrying ? 1.2 : 1);
      const wet = A.ambience.rain > 0.4 && surface !== 'wood';
      api.play(wet ? 'footstep_wet' : 'footstep_' + surface, { volume: v });
      if (surface === 'wood' && Math.random() < 0.18) api.play('stair_creak', { volume: 0.8 });
    },
    thunder(delay) { if (!ctx || !A.started) return; setTimeout(() => api.play('thunder', { volume: 0.9 }), delay * 1000); },
    update(dt) {
      if (!ctx) return;
      const cam = engine.camera; cam.getWorldPosition(listenerPos);
      const L = ctx.listener; const f = new THREE.Vector3(); cam.getWorldDirection(f);
      if (L.positionX) { L.positionX.value = listenerPos.x; L.positionY.value = listenerPos.y; L.positionZ.value = listenerPos.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      const am = A.ambience, zone = engine.player ? engine.player.zone : 'trail';
      const inCab = zone === 'cab'; A.roof = inCab ? 1 : 0;
      const k = 1 - Math.exp(-dt * 2);
      const set = (param, v) => { param.value += (v - param.value) * k; };
      set(beds.rain.out.gain, am.rain * (inCab ? 0.35 : 0.5)); set(beds.rain.roofG.gain, am.rain * (inCab ? 1.6 : 0.2));
      set(beds.wind.out.gain, am.wind * (inCab ? 0.7 : 0.45) * (engine.player && engine.player.position.y > 20 ? 1.4 : 1));
      set(beds.radio.out.gain, am.radioStatic * 0.07);
      // creek loudness by distance to the nearest creek point
      let cd = 999; const cp = engine.world && engine.world.layout.creek && engine.world.layout.creek.points;
      if (cp) for (let i = 0; i < cp.length; i += 3) { const d = Math.hypot(cp[i][0] - listenerPos.x, cp[i][2] - listenerPos.z); if (d < cd) cd = d; }
      set(beds.creek.out.gain, Math.max(am.creek, 0) * 0 + 0.35 * Math.exp(-cd / 30));
      const gp = engine.world && engine.world.anchors.get('IA_generator');
      if (gp) { beds.generator.pan.positionX.value = gp.x; beds.generator.pan.positionY.value = gp.y; beds.generator.pan.positionZ.value = gp.z; }
      set(beds.generator.out.gain, am.generator * 0.5);
      life(dt);
    },
  };
  // unlock on the first gesture
  const unlock = () => { api.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  return api;
}
