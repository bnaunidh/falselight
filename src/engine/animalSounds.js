// FALSE LIGHT — wildlife voices: procedural WebAudio recipes for the birds, the night callers, the deer, the bear (its
// huff, woof, jaw-pop, growl, bawl, breathing, footfalls, and the sticks that break under it) and the dog. registerAnimalSounds(audio) adds each with audio.addSynth(name, fn); the game plays them with
// engine.audio.play(name, { position, volume }). fn(dest, volume, H), H = { ctx, noise, ... } from src/engine/audio.js.
//
// Each recipe is built from the real call's acoustics (the note above it): layered oscillators with pitch and amplitude
// envelopes, ring/FM roughness, formant banks on sawtooth or noise, noise bursts. Pitch and timing are re-drawn on every
// play. Every call stays under 3 s (the coyote chorus under 6 s). Nothing leaks: every source a call makes is started
// and stopped on a schedule, and when the last one has ended every node the call made is disconnected.
// Pure module (no three.js, no DOM): tests/animalSounds.test.mjs runs it on a strict WebAudio mock + renderer.
//
//   import { registerAnimalSounds } from './engine/animalSounds.js?v=f7378e71';
//   registerAnimalSounds(engine.audio);                  // once, after createAudio()
//   engine.audio.play('owl', { position: new THREE.Vector3(x, y, z), volume: 1 });
// volume: 1 = a close call (see LEVEL for the peaks); clamped to 16, 0 / negative / NaN = silent (nothing is made).
// The engine's panner is inverse-distance (ref 3 m, rolloff 1.1): it passes ~28% at 10 m, 9% at 30 m, 2.7% at 100 m,
// 1.4% at 200 m, so a far call wants volume ~2-8. Only the coyote bakes distance (band-limit + echoes) into itself.

const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const POS = 1e-4;   // floor for exponential ramps (they can't reach 0)

// fallback noise when H.noise is absent (an OfflineAudioContext render): one white + one brown buffer per context,
// made exactly like audio.js's
const noiseCache = new WeakMap();
function ownNoise(ctx, brown) {
  let c = noiseCache.get(ctx);
  if (!c) {
    const len = Math.round(ctx.sampleRate * 3), w = ctx.createBuffer(1, len, ctx.sampleRate), b = ctx.createBuffer(1, len, ctx.sampleRate);
    const n = w.getChannelData(0), m = b.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { n[i] = Math.random() * 2 - 1; last = (last + 0.02 * n[i]) / 1.02; m[i] = last * 3.5; }
    c = { w, b }; noiseCache.set(ctx, c);
  }
  const s = ctx.createBufferSource(); s.buffer = brown ? c.b : c.w; s.loop = true; return s;
}

// A per-call builder. Every node goes through reg(); every source through run(), which stops it at a fixed time and
// counts it; when the last source's `ended` fires, every node is disconnected (the output from `dest` last of all).
let building = null;   // the kit being built right now: if a recipe throws, the registry wrapper aborts it (see RECIPES)
function kit(dest, volume, H) {
  const ctx = H && H.ctx, vol = +volume;
  if (!ctx || !dest || !(vol > 0) || !Number.isFinite(vol)) return null;
  const nodes = []; let live = 0, end = 0, closed = false;
  const t0 = ctx.currentTime + 0.01;
  const reg = (n) => { nodes.push(n); return n; };
  const cleanup = () => { if (closed) return; closed = true; for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } } nodes.length = 0; };
  const run = (s, a, b, offset) => {
    if (offset === undefined) s.start(a); else s.start(a, offset);
    s.stop(b); live++; if (b > end) end = b;
    s.onended = () => { s.onended = null; if (--live === 0) cleanup(); };
    return s;
  };
  const out = reg(ctx.createGain()); out.gain.value = vol; out.connect(dest);
  const K = {
    ctx, t0, out,
    gain(v, to) { const g = reg(ctx.createGain()); g.gain.value = v; if (to) g.connect(to); return g; },
    filt(type, f, Q, to, dB) { const x = reg(ctx.createBiquadFilter()); x.type = type; x.frequency.value = f; x.Q.value = Q; if (dB) x.gain.value = dB; if (to) x.connect(to); return x; },
    osc(type, f, a, b, to) { const o = reg(ctx.createOscillator()); o.type = type; o.frequency.value = f; if (to) o.connect(to); return run(o, a, b); },
    noise(brown, a, b, to) { const s = reg(H.noise ? H.noise(brown) : ownNoise(ctx, brown)); if (to) s.connect(to); return run(s, a, b, Math.random() * 2.5); },
    /** an LFO: osc(rate) -> gain(depth) -> each param. Returns the depth gain (automatable). */
    lfo(type, rate, depth, a, b, ...params) { const o = K.osc(type, rate, a, b), g = K.gain(depth); o.connect(g); for (const p of params) g.connect(p); return g; },
    delay(sec, to) { const x = reg(ctx.createDelay(Math.max(1, sec + 0.1))); x.delayTime.value = sec; if (to) x.connect(to); return x; },
    /** parallel band-pass formants: src -> bp(f, Q) -> gain(g) -> to */
    bank(src, list, to) { for (const [f, Q, g] of list) { const bp = K.filt('bandpass', f, Q); src.connect(bp); bp.connect(K.gain(g, to)); } },
    /** a silent source that keeps the call's nodes alive `extra` s past its last sound (for echo tails) */
    hold(extra) { const o = K.osc('sine', 1, t0, end + extra); o.connect(K.gain(0, out)); },
    done() { return Math.round((end - t0) * 1000) / 1000; },
    /** error path: stop every started source now and disconnect everything this call made */
    abort() { for (const n of nodes) if (typeof n.stop === 'function') { try { n.stop(); } catch (e) { /* never started */ } } cleanup(); },
  };
  building = K;
  return K;
}

// set the first point, then ramp through the rest (exponential when exp: values must be > 0). Returns the last time.
function path(p, pts, exp = false) {
  p.setValueAtTime(pts[0][1], pts[0][0]);
  for (let i = 1; i < pts.length; i++) { const [t, v] = pts[i]; if (exp) p.exponentialRampToValueAtTime(Math.max(POS, v), t); else p.linearRampToValueAtTime(v, t); }
  return pts[pts.length - 1][0];
}
// a gain envelope: 0 -> peak (linear attack a) -> hold -> exponential decay d -> 0. Returns its end time.
function hit(p, t, a, peak, hold, d) {
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) p.setValueAtTime(peak, t + a + hold);
  const te = t + a + hold + Math.max(0.002, d);
  p.exponentialRampToValueAtTime(peak * 1e-3, te); p.linearRampToValueAtTime(0, te + 0.004);
  return te + 0.004;
}
// shaped swell: linear points, then an exponential fade to silence at tEnd
function swell(p, pts, tEnd) { path(p, pts); p.exponentialRampToValueAtTime(POS, tEnd); p.linearRampToValueAtTime(0, tEnd + 0.004); return tEnd + 0.004; }

// ================================================================ birds (day)

// Steller's jay: a harsh, descending "shaack shaack shaack", 3-5 notes about four a second. Each note is a noisy
// harmonic stack (f0 ~600 Hz, falling ~40% through the note) with its energy in the 2-4 kHz band: band-passed noise
// ring-modulated by the voice (that makes it a rasp, not a tone) plus the voice itself through a ~2.9 kHz band,
// roughened by a square flutter on the pitch; loud through half the note so the fall is heard.
function jay(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, p = R(0.9, 1.1), n = RI(3, 5), step = R(0.21, 0.27);
  const env = K.gain(0, K.out), mix = K.filt('highpass', 1900, 0, K.filt('highpass', 1900, 0, env));
  const ring = K.gain(0, mix), hiss = K.filt('bandpass', 3000 * p, 0.9, ring);
  const peak = K.filt('bandpass', 3000 * p, 1.4, K.gain(1.2, mix));
  let t = T, last = T; const notes = [];
  for (let i = 0; i < n; i++) { const dur = R(0.11, 0.15); notes.push([t, dur, 650 * p * (1 - 0.03 * i) * R(0.97, 1.03), 1 - 0.06 * i]); last = t + dur; t = Math.max(t + step * R(0.94, 1.08), last + 0.04); }
  const tEnd = last + 0.05;
  const voice = K.osc('sawtooth', 650 * p, T, tEnd); voice.connect(ring.gain); voice.connect(peak);
  K.lfo('square', R(55, 75), 45 * p, T, tEnd, voice.frequency);
  K.noise(false, T, tEnd, hiss);
  for (const [tn, dur, f, a] of notes) { path(voice.frequency, [[tn, f * 1.2], [tn + dur, f * 0.66]], true); hit(env.gain, tn, 0.006, a, dur * 0.5, dur * 0.5 - 0.01); }
  return K.done();
}

// Common raven: a deep, croaking "gronk" — f0 ~300-370 Hz, scooping up then falling, rough and pulsed: the syrinx
// period-doubles (a square sub-harmonic at f0/2) and the voice is chopped into ~45 Hz pulses; low "o" formants
// (~550 / 1050 / 2300 Hz) make it deep. One to three croaks.
function raven(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f0 = R(300, 370), n = pick([1, 2, 2, 3]), len = R(0.22, 0.32), gap = R(0.42, 0.55);
  const env = K.gain(0, K.out), lp = K.filt('lowpass', 3000, 0, env);
  const src = K.gain(1), am = K.gain(0.6); src.connect(am);
  K.bank(am, [[560, 5, 1], [1050, 6, 0.8], [2300, 8, 0.3]], lp);
  const croaks = []; let t = T, last = T;
  for (let i = 0; i < n; i++) { const l = len * R(0.9, 1.1); croaks.push([t, l, f0 * R(0.95, 1.05)]); last = t + l; t = Math.max(t + gap * R(0.93, 1.08), last + 0.05); }
  const tEnd = last + 0.05;
  const saw = K.osc('sawtooth', f0, T, tEnd, src), sub = K.osc('square', f0 / 2, T, tEnd, K.gain(0.35, src));
  K.noise(false, T, tEnd, K.gain(0.3, src));
  K.lfo('sawtooth', R(38, 52), 0.4, T, tEnd, am.gain);
  croaks.forEach(([tc, l, f], i) => {
    path(saw.frequency, [[tc, f * 0.82], [tc + l * 0.3, f * 1.05], [tc + l, f * 0.78]], true);
    path(sub.frequency, [[tc, f * 0.41], [tc + l * 0.3, f * 0.525], [tc + l, f * 0.39]], true);
    hit(env.gain, tc, 0.02, i ? 0.85 : 1, l * 0.5, l * 0.5 - 0.02);
  });
  return K.done();
}

// Varied thrush: one long, eerie, steady whistled note (~2.7-4.4 kHz) with a buzzy burr — two voices of the syrinx a
// few tens of Hz apart, beating — then a pause, and a second note at a different pitch.
function thrush(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f1 = R(2700, 4400), f2 = Math.min(5000, Math.max(2400, f1 * pick([R(0.74, 0.88), R(1.12, 1.28)])));
  const l1 = R(0.8, 1.05), l2 = R(0.7, 0.9), T2 = T + l1 + R(0.5, 0.7), tEnd = T2 + l2 + 0.05, burr = R(50, 85);
  const env = K.gain(0, K.out);
  const a = K.osc('sine', f1, T, tEnd, K.gain(0.55, env)), b = K.osc('sine', f1 + burr, T, tEnd, K.gain(0.4, env)), h = K.osc('sine', 2 * f1, T, tEnd, K.gain(0.04, env));
  for (const [t, f, l] of [[T, f1, l1], [T2, f2, l2]]) {
    const dr = R(0.99, 1.01);
    path(a.frequency, [[t, f], [t + l, f * dr]]); path(b.frequency, [[t, f + burr], [t + l, (f + burr) * dr]]); path(h.frequency, [[t, 2 * f], [t + l, 2 * f * dr]]);
    swell(env.gain, [[t, 0], [t + 0.14, 0.55], [t + l * 0.6, 1], [t + l - 0.1, 0.8]], t + l);
  }
  return K.done();
}

// Black-capped chickadee "chick-a-dee-dee-dee": a high whistled "chick" sweeping down from ~7.5 kHz, a short "a"
// (~4 kHz), then 2-4 buzzy "dee"s — a ~420 Hz harmonic stack whose energy sits around 3.5 kHz.
function chickadee(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, p = R(0.95, 1.06), m = RI(2, 4), step = R(0.15, 0.18);
  const whEnv = K.gain(0, K.out), dEnv = K.gain(0, K.out);
  let t = T; const sweeps = [];
  sweeps.push([t, 7600 * p, 3900 * p, 0.045, 0.55, 0.012, 0.03]); t += R(0.07, 0.085);
  sweeps.push([t, 4400 * p, 3500 * p, 0.05, 0.45, 0.02, 0.028]); t += R(0.085, 0.1);
  const dees = []; let last = t;
  for (let k = 0; k < m; k++) { const hold = R(0.06, 0.085); dees.push([t, 420 * p * (1 - 0.015 * k), hold]); last = t + 0.012 + hold + 0.044; t = Math.max(t + step * R(0.97, 1.05), last + 0.01); }
  const tEnd = last + 0.05;
  const wh = K.osc('sine', 7500 * p, T, tEnd, whEnv), buzz = K.osc('sawtooth', 420 * p, T, tEnd);
  K.bank(buzz, [[3500 * p, 2.2, 1], [6900 * p, 3, 0.35]], dEnv);
  for (const [ts, fa, fb, l, a, hold, dd] of sweeps) { path(wh.frequency, [[ts, fa], [ts + l, fb]], true); hit(whEnv.gain, ts, 0.004, a, hold, dd); }
  for (const [td, f, hold] of dees) { path(buzz.frequency, [[td, f * 1.03], [td + 0.12, f * 0.97]], true); hit(dEnv.gain, td, 0.012, 1, hold, 0.04); }
  return K.done();
}

// Woodpecker drumming (hairy / pileated): a rapid roll of 15-25 knocks on hollow wood, ~18 a second at first and
// slowing to ~11, fading at the end. Each knock is a ~5 ms click ringing two resonances of the trunk (~0.7-0.95 kHz and
// ~2 kHz) plus a dull thump.
function woodpecker(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = RI(15, 25), i0 = R(0.05, 0.06), slow = R(1.5, 1.9), fr = R(700, 950);
  const times = []; let t = T;
  for (let i = 0; i < n; i++) { times.push(t); t += i0 * (1 + (slow - 1) * Math.pow(i / (n - 1), 1.4)) * R(0.97, 1.03); }
  const tEnd = times[n - 1] + 0.12;
  const exc = K.gain(0);
  exc.connect(K.filt('bandpass', fr, 28, K.gain(14, K.out)));   // high-Q resonators pass little of a 5 ms click: big gains
  exc.connect(K.filt('bandpass', fr * R(2.1, 2.5), 14, K.gain(5.6, K.out)));
  exc.connect(K.filt('highpass', 40, 0, K.filt('lowpass', 260, 0, K.gain(3.75, K.out))));   // the thump, minus sub-40 Hz
  K.noise(false, T, tEnd, exc);
  times.forEach((ti, i) => {
    const u = i / (n - 1), a = (u > 0.7 ? 1 - (u - 0.7) * 1.6 : 1) * R(0.8, 1);
    exc.gain.setValueAtTime(0, ti); exc.gain.linearRampToValueAtTime(a, ti + 0.0008);
    exc.gain.exponentialRampToValueAtTime(a * 0.01, ti + 0.006); exc.gain.linearRampToValueAtTime(0, ti + 0.0065);
  });
  return K.done();
}

// ================================================================ night

// Great horned owl: "hoo, h'HOO, hoo, hoo" — soft, low (~290-360 Hz), nearly pure hoots with a rounded ~50 ms attack,
// a slight scoop up into each note and a little breath; the second phrase is a quick grace note into the stressed HOO.
function owl(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f0 = R(290, 360), k = R(0.92, 1.08);
  const notes = [[0, 0.3, 1, 0.8], [0.52, 0.09, 1.02, 0.5], [0.64, 0.42, 1.04, 1], [1.3, 0.38, 0.99, 0.82]];
  if (Math.random() < 0.75) notes.push([1.9, 0.4, 0.97, 0.72]);
  const env = K.gain(0, K.out);
  const sched = []; let prev = T - 0.01;
  for (const [s, l, rel, lvl] of notes) {
    const t = Math.max(T + s * k + (l > 0.2 ? R(-0.02, 0.02) : 0), prev + 0.01), dur = l * k;
    sched.push([t, dur, f0 * rel, lvl]); prev = t + dur + 0.012;
  }
  const tEnd = prev + 0.04;
  const o1 = K.osc('sine', f0, T, tEnd, env), o2 = K.osc('sine', 2 * f0, T, tEnd, K.gain(0.1, env));
  K.noise(true, T, tEnd, K.filt('lowpass', 600, 0, K.gain(0.12, env)));
  for (const [t, dur, f, lvl] of sched) {
    const sc = Math.min(0.07, dur * 0.5), a = Math.min(0.05, dur * 0.35);
    path(o1.frequency, [[t, f * 0.94], [t + sc, f], [t + dur, f * 0.97]], true);
    path(o2.frequency, [[t, 2 * f * 0.94], [t + sc, 2 * f], [t + dur, 2 * f * 0.97]], true);
    path(env.gain, [[t, 0], [t + a, lvl * 0.85], [t + dur * 0.6, lvl]]);
    env.gain.exponentialRampToValueAtTime(lvl * 0.01, t + dur); env.gain.linearRampToValueAtTime(0, t + dur + 0.012);
  }
  return K.done();
}

// Coyote chorus, far off: a burst of yips (short, high, rising-falling barks ~0.7-1.2 kHz), then 2-3 voices howling
// over each other — each howl scoops up from ~500 Hz to a 0.85-1.3 kHz peak, wavers (5-7 Hz vibrato) and falls away —
// with more yips thrown in. Distance: band-limited (300 Hz - ~2.6 kHz) plus two late echoes off the ridges. Under 6 s.
function coyote(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, lim = T + 5.0;
  const lp = K.filt('lowpass', R(2200, 2900), 0, K.out), bus = K.gain(1, K.filt('highpass', 300, 0, lp));
  const el = K.filt('lowpass', 1400, 0, K.out);
  lp.connect(K.delay(R(0.26, 0.34), K.gain(0.22, el))); lp.connect(K.delay(R(0.55, 0.7), K.gain(0.1, el)));
  const yips = (a, b, count) => {   // one yipping voice
    const list = []; let t = a, last = a;
    for (let i = 0; i < count && t < b; i++) { const l = R(0.07, 0.14); list.push([t, l, R(700, 1150), R(0.35, 0.6)]); last = t + l + 0.004; t += l + R(0.05, 0.16); }
    const e = K.gain(0, bus), o = K.osc('sawtooth', 900, a, last + 0.02, e);
    for (const [ty, l, f, amp] of list) { path(o.frequency, [[ty, f * 0.75], [ty + l * 0.35, f * 1.15], [ty + l, f * 0.7]], true); hit(e.gain, ty, 0.008, amp, l * 0.3, l * 0.7 - 0.008); }
  };
  yips(T, T + R(0.9, 1.3), RI(4, 7));
  const voices = RI(2, 3); let s = T + R(0.6, 0.9);
  for (let k = 0; k < voices; k++) {
    const len = Math.min(R(1.6, 2.5), lim - s); if (len < 0.8) break;
    const peak = R(850, 1300) * (1 - 0.07 * k), base = peak * R(0.42, 0.55), e = K.gain(0, bus);
    const o = K.osc('sine', base, s, s + len + 0.02, e), o2 = K.osc('sine', 2 * base, s, s + len + 0.02, K.gain(0.12, e));
    const pts = [[s, base], [s + len * 0.3, peak], [s + len * 0.68, peak * R(0.93, 1.01)], [s + len * 0.9, peak * R(0.7, 0.8)], [s + len, base * 0.8]];
    path(o.frequency, pts, true); path(o2.frequency, pts.map(([t, f]) => [t, 2 * f]), true);
    const vib = K.lfo('sine', R(5, 7), 0, s, s + len + 0.02, o.detune, o2.detune);
    path(vib.gain, [[s, 0], [s + len * 0.35, R(20, 35)], [s + len, R(30, 45)]]);
    path(e.gain, [[s, 0], [s + 0.18, 0.35], [s + len * 0.3, 0.75], [s + len * 0.8, 0.65], [s + len, 0]]);
    s += R(0.45, 0.95);
  }
  const y2 = T + R(1.8, 2.3); yips(y2, Math.min(lim - 0.3, y2 + R(1.4, 1.9)), RI(3, 6));
  K.hold(0.75);   // let the echoes finish before the call's nodes are disconnected
  return K.done();
}

// Bull elk bugle: a low grunting roar that climbs into a high, pure whistle (~1.2-1.9 kHz), holds and wavers, then
// breaks and falls; the roar keeps sounding under the whistle (a real bugle's two-voice "biphonation"), and the call
// ends in a few deep grunts ("chuckles").
function elkBugle(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, peak = R(1200, 1900), base = R(380, 480), f0 = R(110, 145);
  const rise = R(0.5, 0.7), hold = R(0.4, 0.6), fall = R(0.22, 0.3), tw = T + 0.12, tb = tw + rise + hold, tf = tb + fall;
  const lp = K.filt('lowpass', 4200, 0, K.out);
  // the whistle
  const we = K.gain(0, lp);
  const w = K.osc('sine', base, tw, tf + 0.1, we), w2 = K.osc('sine', 2 * base, tw, tf + 0.1, K.gain(0.08, we));
  const wp = [[tw, base], [tw + rise, peak], [tb, peak * R(0.94, 1.02)], [tf, peak * 0.55], [tf + 0.08, peak * 0.3]];
  path(w.frequency, wp, true); path(w2.frequency, wp.map(([t, f]) => [t, 2 * f]), true);
  const vib = K.lfo('sine', R(6, 9), 0, tw, tf + 0.1, w.detune, w2.detune); path(vib.gain, [[tw, 0], [tw + rise, 18], [tb, 30]]);
  path(we.gain, [[tw, 0], [tw + 0.2, 0.3], [tw + rise, 0.85], [tb, 0.75], [tf, 0.25], [tf + 0.08, 0]]);
  // the roar under it, then the grunts (same voice)
  const re = K.gain(0), src = K.gain(1, re);
  K.bank(re, [[480, 3, 3.2], [950, 4, 1.8], [2000, 6, 0.45]], lp);
  const grunts = []; let t = tf + R(0.08, 0.14), last = tf;
  for (let i = 0, m = RI(3, 5); i < m && t + 0.13 < T + 2.88; i++) { const l = R(0.07, 0.11); grunts.push([t, l, f0 * R(0.9, 1.1)]); last = t + l + 0.014; t += R(0.17, 0.23); }
  const gEnd = last + 0.04;
  const saw = K.osc('sawtooth', f0, T, gEnd, src);
  K.noise(false, T, gEnd, K.filt('bandpass', 900, 0.8, K.gain(0.35, src)));
  path(saw.frequency, [[T, f0 * 0.9], [tw + 0.3, f0 * 1.1], [tb, f0]], true);
  path(re.gain, [[T, 0], [T + 0.07, 0.7], [tw + 0.3, 0.4], [tb, 0.32], [tf, 0]]);
  for (const [tg, l, ff] of grunts) { path(saw.frequency, [[tg, ff * 1.15], [tg + l, ff * 0.8]], true); hit(re.gain, tg, 0.01, 0.9, l * 0.3, l * 0.7); }
  return K.done();
}

// ================================================================ deer

// Black-tailed deer alarm snort: a sudden, forceful blast of air through the nose — broadband noise with a fast (6 ms)
// attack whose nasal resonance sweeps down (~1.6 -> 0.9 kHz) over ~0.3 s; sometimes a faint whistle rides on it, and
// often a second, weaker snort follows.
function deerSnort(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, blasts = [[T, 1, R(0.26, 0.38)]];
  if (Math.random() < 0.45) blasts.push([T + R(0.45, 0.6), 0.55, R(0.22, 0.32)]);
  const lastB = blasts[blasts.length - 1], tEnd = lastB[0] + lastB[2] + 0.05;
  const env = K.gain(0, K.out), hp = K.filt('highpass', 350, 0, env);
  const nas = K.filt('bandpass', 1500, 1.8, K.gain(1, hp)), air = K.filt('bandpass', 2900, 1.1, K.gain(0.28, hp)), body = K.filt('bandpass', 700, 1.2, K.gain(0.5, hp));
  const nz = K.noise(false, T, tEnd); nz.connect(nas); nz.connect(air); nz.connect(body);
  for (const [t, a, l] of blasts) {
    path(nas.frequency, [[t, R(1500, 1800)], [t + l, R(850, 1000)]], true);
    path(env.gain, [[t, 0], [t + 0.006, a], [t + 0.04, a * 0.8]]); env.gain.exponentialRampToValueAtTime(a * 0.001, t + l); env.gain.linearRampToValueAtTime(0, t + l + 0.004);
  }
  if (Math.random() < 0.35) {
    const we = K.gain(0, K.out), w = K.osc('sine', 2100, T, T + 0.3, we);
    path(w.frequency, [[T, R(1900, 2300)], [T + 0.25, R(1400, 1600)]], true); path(we.gain, [[T, 0], [T + 0.02, 0.06], [T + 0.25, 0]]);
  }
  return K.done();
}

// Doe bleat: a short, nasal "maa" (0.3-0.5 s): a voiced source (~380-520 Hz, rising then falling, with a quaver)
// through "a" formants with a nasal notch (~1.1 kHz) and a ~2.6 kHz twang, opened by a lowpass sweep (the "m").
function deerBleat(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f0 = R(380, 520), l0 = R(0.3, 0.48), calls = [T];
  if (Math.random() < 0.3) calls.push(T + R(0.55, 0.7));
  const ls = calls.map(() => l0 * R(0.9, 1.1)), tEnd = calls[calls.length - 1] + ls[ls.length - 1] + 0.05;
  const env = K.gain(0, K.out), mouth = K.filt('lowpass', 500, 0, env), notch = K.filt('notch', 1100, 3, mouth);
  const src = K.gain(1);
  K.bank(src, [[780, 5, 1], [1450, 6, 0.6], [2650, 8, 0.45]], notch);
  src.connect(K.filt('lowpass', 520, 0, K.gain(0.3, notch)));
  const saw = K.osc('sawtooth', f0, T, tEnd, src); K.lfo('sine', R(8, 11), R(10, 20), T, tEnd, saw.detune);
  K.noise(false, T, tEnd, K.gain(0.12, src));
  calls.forEach((t, i) => {
    const l = ls[i], f = f0 * R(0.96, 1.04);
    path(saw.frequency, [[t, f * 0.92], [t + l * 0.25, f * 1.06], [t + l, f * 0.84]], true);
    path(mouth.frequency, [[t, 450], [t + 0.07, 3600]], true);
    swell(env.gain, [[t, 0], [t + 0.045, 1], [t + l * 0.7, 0.8]], t + l);
  });
  return K.done();
}

// ================================================================ bear

// Black bear huff: a forceful, breathy exhale through the mouth — a burst of low, chesty noise (most energy below
// ~1 kHz) with a 12-18 ms onset, a short burst of air on top, and a 0.3-0.4 s decay; usually two or three in a row.
function bearHuff(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = pick([1, 2, 2, 3]), gap = R(0.45, 0.6);
  const env = K.gain(0, K.out), chest = K.filt('peaking', 230, 1.2, env, 6), puff = K.gain(0, K.out);
  // mostly low-passed WHITE noise (broadband turbulence: a steady envelope) + a little brown noise high-passed at 90 Hz
  // (narrow low-band noise swells over 10-20 ms at random and would smear the onset)
  const lo = K.filt('highpass', 90, 0, K.filt('lowpass', 750, 0, K.gain(0.5, chest))), bp = K.filt('bandpass', 560, 0.7, K.gain(0.55, chest)), air = K.filt('bandpass', 1500, 1, K.gain(0.1, chest));
  const wlo = K.filt('lowpass', 800, 0, K.gain(0.8, chest));
  let t = T, last = T;
  for (let i = 0; i < n; i++) {
    const l = R(0.3, 0.4), a = [1, 0.85, 0.72][i];
    bp.frequency.setValueAtTime(R(450, 650), t);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(a, t + R(0.012, 0.018));
    env.gain.exponentialRampToValueAtTime(a * 0.5, t + 0.12); env.gain.exponentialRampToValueAtTime(a * 0.001, t + l); env.gain.linearRampToValueAtTime(0, t + l + 0.004);
    hit(puff.gain, t, 0.003, 0.5 * a, 0.012, 0.05);   // the burst of air leaving: the force of the huff
    last = t + l + 0.004; t = Math.max(t + gap * R(0.93, 1.08), last + 0.03);
  }
  const tEnd = last + 0.04;
  K.noise(true, T, tEnd, lo);
  const w = K.noise(false, T, tEnd, bp); w.connect(air); w.connect(wlo); w.connect(K.filt('bandpass', 950, 0.8, puff));
  return K.done();
}

// Bear woof: a short, low, bark-like exhale (0.14-0.2 s) — a huff with voice in it: a ~95-125 Hz falling voiced source
// through low formants (~420 / 900 Hz) plus chesty noise, with a sudden onset.
function bearWoof(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f0 = R(95, 125), times = Math.random() < 0.3 ? [T, T + R(0.36, 0.5)] : [T];
  const tEnd = times[times.length - 1] + 0.3;
  const env = K.gain(0, K.out), vm = K.gain(1, env);
  const saw = K.osc('sawtooth', f0, T, tEnd); K.bank(saw, [[420, 4, 1], [900, 5, 0.6], [2000, 7, 0.2]], vm);
  // brown noise is flat down to DC: high-pass it at 60 Hz or ~14% of the woof is sub-30 Hz rumble + DC offset
  K.noise(true, T, tEnd, K.filt('highpass', 60, 0, K.filt('lowpass', 900, 0, K.gain(1.2, vm))));
  K.noise(false, T, tEnd, K.filt('bandpass', 700, 0.8, K.gain(0.35, vm)));
  times.forEach((t, i) => { const l = R(0.16, 0.24), a = i ? 0.7 : 1; path(saw.frequency, [[t, f0 * 1.2], [t + l, f0 * 0.8]], true); swell(env.gain, [[t, 0], [t + 0.006, a], [t + 0.06, a * 0.7]], t + l); });
  return K.done();
}

// Jaw popping: the bear snaps its jaws — a hollow, woody clack (a sub-ms click ringing ~0.65-0.95 kHz and ~2 kHz
// resonances of the mouth, plus a dull thump), 1-4 in a quick run, each with a small wet smack after it.
function bearJawPop(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = pick([1, 2, 2, 3, 3, 4]), fr = R(650, 950);
  const times = []; let t = T; for (let i = 0; i < n; i++) { times.push(t); t += R(0.12, 0.22); }
  const tEnd = times[n - 1] + 0.15;
  const exc = K.gain(0), wet = K.gain(0, K.out);
  exc.connect(K.filt('bandpass', fr, 14, K.gain(12.3, K.out)));
  exc.connect(K.filt('bandpass', fr * R(2.2, 2.8), 9, K.gain(4.9, K.out)));
  exc.connect(K.filt('highpass', 40, 0, K.filt('lowpass', 200, 0, K.gain(2.45, K.out))));   // the thump, minus sub-40 Hz
  const nz = K.noise(false, T, tEnd, exc); nz.connect(K.filt('highpass', 3500, 0, wet));
  for (const ti of times) {
    const a = R(0.75, 1);
    exc.gain.setValueAtTime(0, ti); exc.gain.linearRampToValueAtTime(a, ti + 0.0008);
    exc.gain.exponentialRampToValueAtTime(a * 0.01, ti + 0.0045); exc.gain.linearRampToValueAtTime(0, ti + 0.005);
    hit(wet.gain, ti + R(0.018, 0.035), 0.002, 0.15 * a, 0, 0.012);
  }
  return K.done();
}

// Black bear growl (rare — bears mostly huff and pop), a big boar's, close: a deep, rough rumble you feel in your chest —
// a ~40-52 Hz voice doubled by a second a few % sharp (the thick, beating rasp) and period-doubled (a square sub-voice at
// half the pitch, heard through the formants as creak, never as sub-bass); the pitch jittered by low-passed noise and
// rattled by a ~19-25 Hz square flutter; chesty breath noise in it; pulsing at ~6-9 Hz with a slow surge; dark formants
// (~210 / 480 / 950 Hz). Two high-passes at 38 Hz keep the energy out of the sub-30 Hz rumble a speaker can't play.
function bearGrowl(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, l = R(1.6, 2.3), f0 = R(40, 52), tEnd = T + l + 0.05, dt2 = R(1.02, 1.03);
  const env = K.gain(0, K.out), lp = K.filt('lowpass', 1100, 0, K.filt('highpass', 38, 0, K.filt('highpass', 38, 0, env)));
  const src = K.gain(1), am = K.gain(0.5); src.connect(am);
  K.bank(am, [[210, 2.5, 1.1], [480, 3.5, 0.8], [950, 5, 0.3], [2100, 7, 0.07]], lp);
  const saw = K.osc('sawtooth', f0, T, tEnd, src), saw2 = K.osc('sawtooth', f0 * dt2, T, tEnd, K.gain(0.65, src));
  const sub = K.osc('square', f0 / 2, T, tEnd, K.gain(0.3, src));
  K.lfo('square', R(19, 25), f0 * 0.12, T, tEnd, saw.frequency, saw2.frequency);   // the rattle
  const jit = K.gain(f0 * 0.3); jit.connect(saw.frequency); jit.connect(saw2.frequency); jit.connect(sub.frequency);
  K.noise(true, T, tEnd, K.filt('lowpass', 30, 0, jit));                              // the wandering, unsteady pitch
  K.noise(true, T, tEnd, K.filt('highpass', 60, 0, K.gain(0.9, src))); K.noise(false, T, tEnd, K.filt('bandpass', 420, 0.8, K.gain(0.25, src)));
  K.lfo('sine', R(6, 9), 0.4, T, tEnd, am.gain); K.lfo('sine', R(1.8, 2.8), 0.12, T, tEnd, am.gain);
  const pts = [[T, f0 * 0.88], [T + l * 0.4, f0 * 1.1], [T + l * 0.62, f0 * 1.02], [T + l, f0 * 0.82]];
  path(saw.frequency, pts, true); path(saw2.frequency, pts.map(([t, f]) => [t, f * dt2]), true); path(sub.frequency, pts.map(([t, f]) => [t, f / 2]), true);
  swell(env.gain, [[T, 0], [T + 0.22, 0.75], [T + l * 0.45, 1], [T + l * 0.6, 0.88], [T + l * 0.8, 0.95]], T + l);
  return K.done();
}

// Bear breathing, close by: heavy, wet, huffing breaths — two or three in 1-2 s. Each a loud low exhale (chesty turbulence
// ~300-900 Hz with a rough roar and a faint voiced groan in it, 0.3-0.45 s) and a shorter, softer, higher intake (~1.3-1.6
// kHz through the throat, 0.2-0.3 s); saliva crackle over both (sparse, tiny clicks of 2.6 kHz noise).
function bearBreath(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, rate = R(0.85, 1.05), cyc = [];
  let t = T;
  for (let i = 0; i < 3; i++) {
    const le = R(0.3, 0.45) * rate, gap = R(0.04, 0.1), li = R(0.2, 0.3) * rate;
    if (i >= 2 && t + le + gap + li > T + 1.9) break;
    cyc.push([t, le, t + le + gap, li, [1, 0.85, 0.72][i]]); t += le + gap + li + R(0.05, 0.14);
  }
  const lc = cyc[cyc.length - 1], tEnd = lc[2] + lc[3] + 0.05;
  const ex = K.gain(0, K.out), inh = K.gain(0, K.out), wet = K.gain(0, K.out), chest = K.filt('peaking', 280, 1, ex, 6);
  const nz = K.noise(false, T, tEnd);
  nz.connect(K.filt('lowpass', 900, 0, K.gain(0.7, chest))); nz.connect(K.filt('bandpass', 520, 0.9, K.gain(0.6, chest)));
  K.noise(true, T, tEnd, K.filt('highpass', 70, 0, K.gain(0.6, chest)));                                    // the rough roar in it
  const gf = R(62, 80), groan = K.osc('sawtooth', gf, T, tEnd, K.filt('bandpass', 330, 3, K.gain(0.3, chest)));   // a faint voice
  nz.connect(K.filt('bandpass', R(1300, 1600), 1.1, inh)); nz.connect(K.filt('bandpass', 650, 2, K.gain(0.35, inh)));
  nz.connect(K.filt('bandpass', 2600, 1.2, wet));
  let tc = T;
  for (const [te, le, ti, li, a] of cyc) {
    path(ex.gain, [[te, 0], [te + 0.04, a], [te + le * 0.35, a * 0.8]]); ex.gain.exponentialRampToValueAtTime(a * 0.004, te + le); ex.gain.linearRampToValueAtTime(0, te + le + 0.004);
    path(inh.gain, [[ti, 0], [ti + li * 0.45, 0.32 * a]]); inh.gain.exponentialRampToValueAtTime(0.32 * a * 0.004, ti + li); inh.gain.linearRampToValueAtTime(0, ti + li + 0.004);
    path(groan.frequency, [[te, gf * 1.08], [te + le, gf * 0.85]], true);
    // crackle: through the back of the exhale and the intake
    tc = Math.max(tc, te + le * 0.4);
    for (let k = 0, m = RI(3, 6); k < m && tc < ti + li - 0.02; k++) { tc = hit(wet.gain, tc, 0.0008, R(0.12, 0.35) * a, 0, R(0.005, 0.012)) + R(0.02, 0.09); }
  }
  return K.done();
}

// A heavy footfall — a big bear at a run: a padded thud (a low body thump sweeping ~95 -> 50 Hz in 60 ms, and the soft slap
// of the pad: low-passed noise) and the crunch of the forest floor under it (a handful of tiny cracks of needles and
// twigs over ~0.1-0.2 s, and a brief rustle).
function bearStep(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f = R(85, 105), tEnd = T + 0.32;
  const hp = K.filt('highpass', 36, 0, K.out);
  const th = K.gain(0, hp), o = K.osc('sine', f, T, tEnd, th);
  path(o.frequency, [[T, f], [T + 0.06, f * 0.55], [T + 0.2, f * 0.5]], true);
  hit(th.gain, T, 0.003, 1, 0.01, R(0.1, 0.14));
  const pad = K.gain(0, hp), cr = K.gain(0, hp), ru = K.gain(0, hp), nz = K.noise(false, T, tEnd);
  nz.connect(K.filt('lowpass', R(260, 380), 0, K.filt('highpass', 60, 0, pad)));
  nz.connect(K.filt('highpass', 1500, 0, K.filt('bandpass', R(2400, 3400), 0.7, cr)));
  nz.connect(K.filt('bandpass', 4000, 0.6, ru));
  hit(pad.gain, T + 0.002, 0.004, 0.9, 0.012, R(0.06, 0.09));
  let tc = T + R(0.004, 0.012);
  for (let i = 0, m = RI(5, 9); i < m && tc < T + 0.2; i++) tc = hit(cr.gain, tc, 0.0006, R(0.45, 0.9) * (1 - i / (m + 2)), 0, R(0.004, 0.01)) + R(0.004, 0.025);
  hit(ru.gain, T + 0.005, 0.01, 0.1, 0.02, 0.12);
  return K.done();
}

// A dry stick breaking in the undergrowth, somewhere off the trail: a sharp crack — the wood ringing (a ~1.6-2.4 kHz mode and
// one about twice that, struck: sine bursts with a 0.4 ms attack and a few ms of ring, so every crack is as sharp as the
// last), a click of noise through the same resonances for grain, a bright splinter and a little body — then within
// 20-90 ms one to three smaller splintering cracks, and the brush settling (a short 3.5-5 kHz rustle).
function branchSnap(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, tEnd = T + 0.42, f1 = R(1600, 2400), r2 = R(1.9, 2.3);
  const cracks = [[T, 1]]; let t = T + R(0.02, 0.045);
  for (let i = 0, m = RI(1, 3); i < m; i++) { cracks.push([t, R(0.25, 0.6)]); t += R(0.018, 0.04); }
  const ring = K.gain(0, K.out);
  K.osc('sine', f1, T, tEnd, ring); K.osc('sine', f1 * r2, T, tEnd, K.gain(0.5, ring));
  const exc = K.gain(0), nz = K.noise(false, T, tEnd, exc);
  exc.connect(K.filt('bandpass', f1, 8, K.gain(3, K.out))); exc.connect(K.filt('bandpass', f1 * r2, 6, K.gain(2, K.out)));
  exc.connect(K.filt('highpass', 5000, 0, K.gain(0.6, K.out)));              // the splinter
  exc.connect(K.filt('bandpass', R(500, 800), 3, K.gain(1, K.out)));         // the stick's body
  for (const [tc, a] of cracks) {
    hit(ring.gain, tc, 0.0004, a, 0, R(0.006, 0.012));
    exc.gain.setValueAtTime(0, tc); exc.gain.linearRampToValueAtTime(a, tc + 0.0005); exc.gain.exponentialRampToValueAtTime(a * 0.01, tc + R(0.003, 0.006)); exc.gain.linearRampToValueAtTime(0, tc + 0.0065);
  }
  const ru = K.gain(0, K.out); nz.connect(K.filt('bandpass', R(3500, 5000), 0.6, ru));
  hit(ru.gain, T + 0.01, 0.015, 0.1, 0.03, R(0.14, 0.22));
  return K.done();
}

// Black bear bawl, the moan at the start of a charge: a drawn-out, rough "mmwaaAAHH-uhh" (0.8-1.35 s) — two saws a little
// apart and a period-doubled sub-voice, the pitch wandering and wavering, rising from ~100-125 Hz to ~1.6-1.9x that and
// sinking away; through an "aw" mouth that opens then closes (the low-pass sweeps up, then down), breath under it.
function bearBawl(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, l = R(0.8, 1.35), f0 = R(100, 125), pk = f0 * R(1.6, 1.9), tEnd = T + l + 0.05;
  const env = K.gain(0, K.out), mouth = K.filt('lowpass', 700, 0.5, K.filt('highpass', 60, 0, env));
  const src = K.gain(1);
  K.bank(src, [[320, 3, 0.5], [650, 5, 1], [1080, 6, 0.75], [2500, 8, 0.22]], mouth);
  const saw = K.osc('sawtooth', f0, T, tEnd, src), saw2 = K.osc('sawtooth', f0 * 1.015, T, tEnd, K.gain(0.6, src)), sub = K.osc('square', f0 / 2, T, tEnd, K.gain(0.22, src));
  const jit = K.gain(f0 * 0.05); jit.connect(saw.frequency); jit.connect(saw2.frequency);
  K.noise(true, T, tEnd, K.filt('lowpass', 25, 0, jit));
  K.lfo('sine', R(5, 6.5), R(15, 25), T, tEnd, saw.detune, saw2.detune);
  K.noise(false, T, tEnd, K.filt('bandpass', 1300, 0.7, K.gain(0.22, src)));
  const pts = [[T, f0], [T + l * 0.3, pk], [T + l * 0.55, pk * R(0.93, 1.0)], [T + l, f0 * R(0.75, 0.85)]];
  path(saw.frequency, pts, true); path(saw2.frequency, pts.map(([t, f]) => [t, f * 1.015]), true); path(sub.frequency, pts.map(([t, f]) => [t, f / 2]), true);
  path(mouth.frequency, [[T, 500], [T + l * 0.3, 3200], [T + l * 0.7, 2200], [T + l, 800]], true);
  swell(env.gain, [[T, 0], [T + 0.07, 0.6], [T + l * 0.3, 1], [T + l * 0.65, 0.85]], T + l);
  return K.done();
}

// ================================================================ dog

// Mid-size dog bark ("ruff"): a sudden (4 ms), noisy, voiced burst 0.12-0.17 s long — f0 ~320-420 Hz jumping up then
// falling fast — through a dog's formants (~620 / 1350 / 2500 Hz), with a chest component and a breathy onset. 1-3 barks.
function dogBark(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, f0 = R(320, 420), n = pick([1, 2, 2, 2, 3, 3]), gap = R(0.26, 0.38);
  const barks = []; let t = T, last = T;
  for (let i = 0; i < n; i++) { const l = R(0.13, 0.18); barks.push([t, l]); last = t + l + 0.004; t = Math.max(t + gap * R(0.9, 1.1), last + 0.03); }
  const tEnd = last + 0.05;
  const env = K.gain(0, K.out), pe = K.gain(0, K.out), src = K.gain(1);
  K.bank(src, [[620, 4, 1], [1350, 5, 1], [2500, 6, 0.45]], env);
  const saw = K.osc('sawtooth', f0, T, tEnd, src); saw.connect(K.filt('lowpass', 700, 0, K.gain(0.18, env)));
  const nz = K.noise(false, T, tEnd, K.gain(0.6, src)); nz.connect(K.filt('highpass', 1800, 0, pe));
  barks.forEach(([tb, l], i) => {
    const f = f0 * R(0.94, 1.06), a = i ? R(0.8, 0.95) : 1;
    path(saw.frequency, [[tb, f * 1.1], [tb + 0.01, f * 1.25], [tb + l, f * 0.72]], true);
    hit(env.gain, tb, 0.004, a, 0.055, l - 0.059);
    hit(pe.gain, tb, 0.002, 0.25 * a, 0, 0.03);
  });
  return K.done();
}

// Dog whine: a high, thin, nasal tone (~650-900 Hz) that slides up 25-45% and back down with a tremble (5-7 Hz
// vibrato) and a touch of breath; one to three whines.
function dogWhine(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = pick([1, 2, 2, 3]);
  const list = []; let t = T, last = T;
  for (let i = 0; i < n; i++) { const l = R(0.45, 0.8); if (t + l > T + 2.8) break; list.push([t, l, R(650, 900)]); last = t + l + 0.004; t = last + R(0.15, 0.3); }
  const tEnd = last + 0.05;
  const env = K.gain(0, K.out), nas = K.filt('peaking', 2000, 1, env, 5);
  const o = K.osc('triangle', 700, T, tEnd, nas), o2 = K.osc('sine', 1400, T, tEnd, K.gain(0.18, nas));
  K.lfo('sine', R(5, 7), R(25, 40), T, tEnd, o.detune, o2.detune);
  K.noise(false, T, tEnd, K.filt('bandpass', 2400, 1.5, K.gain(0.06, nas)));
  for (const [tw, l, f] of list) {
    const up = f * R(1.25, 1.45);
    path(o.frequency, [[tw, f], [tw + l * 0.55, up], [tw + l, f * 0.9]], true);
    path(o2.frequency, [[tw, 2 * f], [tw + l * 0.55, 2 * up], [tw + l, 2 * f * 0.9]], true);
    swell(env.gain, [[tw, 0], [tw + 0.08, 0.7], [tw + l * 0.55, 1]], tw + l);
  }
  return K.done();
}

// Dog growl: a steady, rough "grrrr" — a ~95-125 Hz voice roughened by a fast square flutter (~30 Hz) and irregular
// amplitude pulses (~10-14 Hz), breath noise, a medium dog's formants (~480 / 1150 / 2400 Hz) — higher and quicker than
// the bear's.
function dogGrowl(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, l = R(1.0, 1.8), f0 = R(95, 125), tEnd = T + l + 0.05;
  const env = K.gain(0, K.out), lp = K.filt('lowpass', 3000, 0, env);
  const src = K.gain(1), am = K.gain(0.6); src.connect(am);
  K.bank(am, [[480, 4, 1], [1150, 5, 0.65], [2400, 6, 0.3]], lp);
  const saw = K.osc('sawtooth', f0, T, tEnd, src); K.lfo('square', R(28, 36), f0 * 0.12, T, tEnd, saw.frequency);
  K.noise(false, T, tEnd, K.filt('bandpass', 900, 0.8, K.gain(0.4, src))); K.noise(true, T, tEnd, K.gain(0.4, src));
  K.lfo('sine', R(10, 14), 0.3, T, tEnd, am.gain); K.lfo('triangle', R(3, 4.5), 0.1, T, tEnd, am.gain);
  path(saw.frequency, [[T, f0 * 0.95], [T + l * 0.5, f0 * 1.1], [T + l, f0 * 0.9]], true);
  swell(env.gain, [[T, 0], [T + 0.1, 0.8], [T + l * 0.6, 1]], T + l);
  return K.done();
}

// Dog panting: quick, breathy in-out pants (~3.2-4.3 a second) — the out-breath louder and lower (noise ~1.3 kHz with a
// faint voiced tinge), the in-breath softer and higher (~2.1 kHz) — for ~1.6-2.4 s.
function dogPant(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, P0 = 1 / R(3.2, 4.3), l = R(1.6, 2.4);
  const cycles = []; let t = T;
  while (t + P0 < T + l) { const P = P0 * R(0.93, 1.07); cycles.push([t, P]); t += P; }
  const tEnd = t + 0.05;
  const ex = K.gain(0, K.out), inh = K.gain(0, K.out);
  const nz = K.noise(false, T, tEnd);
  nz.connect(K.filt('bandpass', 1300, 0.9, ex)); nz.connect(K.filt('bandpass', 2700, 1.3, K.gain(0.4, ex))); nz.connect(K.filt('bandpass', 2100, 1.2, inh));
  K.osc('sawtooth', R(180, 240), T, tEnd, K.filt('bandpass', 1100, 3, K.gain(0.06, ex)));
  for (const [tc, P] of cycles) {
    const a = R(0.8, 1);
    ex.gain.setValueAtTime(0, tc); ex.gain.linearRampToValueAtTime(a, tc + 0.03);
    ex.gain.exponentialRampToValueAtTime(a * 0.01, tc + P * 0.48); ex.gain.linearRampToValueAtTime(0, tc + P * 0.48 + 0.004);
    inh.gain.setValueAtTime(0, tc + P * 0.53); inh.gain.linearRampToValueAtTime(0.45 * a, tc + P * 0.6);
    inh.gain.exponentialRampToValueAtTime(0.0045 * a, tc + P * 0.88); inh.gain.linearRampToValueAtTime(0, tc + P * 0.88 + 0.004);
  }
  return K.done();
}

// ================================================================ registry

const RECIPE = {
  jay, raven, thrush, chickadee, woodpecker,
  owl, coyote, elk_bugle: elkBugle,
  deer_snort: deerSnort, deer_bleat: deerBleat,
  bear_huff: bearHuff, bear_woof: bearWoof, bear_jawpop: bearJawPop, bear_growl: bearGrowl,
  dog_bark: dogBark, dog_whine: dogWhine, dog_growl: dogGrowl, dog_pant: dogPant,
  bear_breath: bearBreath, bear_step: bearStep, branch_snap: branchSnap, bear_bawl: bearBawl,
};
// output trim so that at volume 1 each call's MEDIAN peak (before the panner) is: bark 0.7; jay, raven, elk, snort, huff,
// jaw pop, woodpecker, bawl, bear step 0.6; woof 0.65; growl 0.5-0.55; branch snap 0.55; coyote 0.5; thrush, chickadee,
// owl, bleat, bear breath 0.45; whine 0.4; pant 0.25. Calibrated on 40 random plays each in the test renderer; the
// loudest play stays under ~0.92 (the clicks, the snap, woof and bleat vary most: their level depends on where a random
// pitch or noise burst lands on a resonance).
const LEVEL = {
  jay: 0.504, raven: 0.929, thrush: 0.473, chickadee: 0.643, woodpecker: 0.9,
  owl: 0.429, coyote: 0.23, elk_bugle: 0.316,
  deer_snort: 1.0, deer_bleat: 1.19,
  bear_huff: 0.925, bear_woof: 0.8, bear_jawpop: 1.036, bear_growl: 0.56,
  dog_bark: 1.09, dog_whine: 0.319, dog_growl: 0.976, dog_pant: 0.395,
  bear_breath: 0.574, bear_step: 0.485, branch_snap: 0.366, bear_bawl: 0.587,
};

/** Every name registerAnimalSounds() adds. */
export const ANIMAL_SOUNDS = Object.keys(RECIPE);
/** The longest a call lasts (s), for spacing repeats: 3, or 6 for the coyote chorus. */
export const ANIMAL_SOUND_MAX_S = Object.fromEntries(ANIMAL_SOUNDS.map((n) => [n, n === 'coyote' ? 6 : 3]));
// A sound must never take the game down: engine.audio.play() runs inside the frame's update (a bear's huff fires from
// wildlife.update), so a recipe that throws (a browser quirk the tests can't see) is caught here, whatever it had built
// is stopped and disconnected, it warns once per name, and the call is silent (returns 0).
const warned = new Set();
function guard(n) {
  return (dest, volume, H) => {
    building = null;
    try { return RECIPE[n](dest, Math.min(volume == null ? 1 : +volume, 16) * LEVEL[n], H); }
    catch (e) {
      if (building) building.abort();
      if (!warned.has(n)) { warned.add(n); try { console.warn('animal sound "' + n + '" failed, playing nothing:', e); } catch (e2) { /* no console */ } }
      return 0;
    } finally { building = null; }
  };
}
/** name -> fn(dest, volume, H): the synths as audio.addSynth() takes them. Each returns the call's length in seconds
 *  (0 when silent). They never throw. */
export const RECIPES = Object.fromEntries(ANIMAL_SOUNDS.map((n) => [n, guard(n)]));

/** Add every animal sound to the engine's synth table: registerAnimalSounds(engine.audio). Returns the names added
 *  ([] for a stub audio without addSynth, e.g. a headless test harness: boot must not crash on it). */
export function registerAnimalSounds(audio) {
  if (!audio || typeof audio.addSynth !== 'function') return [];
  for (const n of ANIMAL_SOUNDS) audio.addSynth(n, RECIPES[n]);
  return ANIMAL_SOUNDS;
}

/** H for rendering outside the engine (e.g. an OfflineAudioContext): RECIPES.owl(dest, 1, synthHelpers(ctx)). */
export function synthHelpers(ctx) { return { ctx, noise: (brown = false) => ownNoise(ctx, brown) }; }
