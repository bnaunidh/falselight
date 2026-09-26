// FALSE LIGHT — the nightmare director's sounds (src/game/director.js): procedural WebAudio recipes, no samples. The same
// contract as src/engine/animalSounds.js: registerScareSounds(audio) adds each with audio.addSynth(name, fn); the game plays
// them with engine.audio.play(name, { position, volume }). fn(dest, volume, H), H = { ctx, noise, ... } from audio.js.
//
// Everything here is something close to you in the dark, so it's built from the physics of the real thing (the note above
// each): wood is short, dull, damped modes and a noise-excited body (never a long ring: that reads as metal); breath and
// whispers are turbulence through a moving vocal tract with NO voicing (a whisper has no pitch); glass is bright plate modes
// in a buzzing frame. Pitch and timing re-drawn on every play. Nothing leaks: every source is started and stopped on a
// schedule, and when the last one has ended every node the call made is disconnected. A recipe that throws plays nothing
// (warned once) instead of taking the frame down. Pure module (no three.js, no DOM): tests/scareSounds.test.mjs.
//
//   import { registerScareSounds } from './engine/scareSounds.js?v=7c0235c6';
//   registerScareSounds(engine.audio);          // once, after createAudio() (and after registerAnimalSounds)
// volume 1 = close (LEVEL below calibrates each so its median peak lands where it should); the engine's panner is inverse-
// distance (ref 3 m), so the stair steps from 25 m below want ~1-1.5 and a knock at the door 1.2.

const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const POS = 1e-4;

// ---------------------------------------------------------------- the per-call kit (as animalSounds.js)
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
let building = null;
function kit(dest, volume, H) {
  const ctx = H && H.ctx, vol = +volume;
  if (!ctx || !dest || !(vol > 0) || !Number.isFinite(vol)) return null;
  const nodes = []; let live = 0, end = 0, closed = false;
  const t0 = ctx.currentTime + 0.01;
  const reg = (n) => { nodes.push(n); return n; };
  const cleanup = () => { if (closed) return; closed = true; for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } nodes.length = 0; };
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
    bank(src, list, to) { for (const [f, Q, g] of list) { const bp = K.filt('bandpass', f, Q); src.connect(bp); bp.connect(K.gain(g, to)); } },
    done() { return Math.round((end - t0) * 1000) / 1000; },
    abort() { for (const n of nodes) if (typeof n.stop === 'function') { try { n.stop(); } catch (e) { /* never started */ } } cleanup(); },
  };
  building = K;
  return K;
}
function path(p, pts, exp = false) {
  p.setValueAtTime(pts[0][1], pts[0][0]);
  for (let i = 1; i < pts.length; i++) { const [t, v] = pts[i]; if (exp) p.exponentialRampToValueAtTime(Math.max(POS, v), t); else p.linearRampToValueAtTime(v, t); }
  return pts[pts.length - 1][0];
}
// 0 -> peak (linear attack a) -> hold -> exponential decay to -60 dB over d -> 0. Returns its end time.
function hit(p, t, a, peak, hold, d) {
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) p.setValueAtTime(peak, t + a + hold);
  const te = t + a + hold + Math.max(0.002, d);
  p.exponentialRampToValueAtTime(peak * 1e-3, te); p.linearRampToValueAtTime(0, te + 0.004);
  return te + 0.004;
}
// linear points, then an exponential fade to silence at tEnd
function fade(p, pts, tEnd) { path(p, pts); p.exponentialRampToValueAtTime(Math.max(POS, pts[pts.length - 1][1] * 0.004), tEnd); p.linearRampToValueAtTime(0, tEnd + 0.004); return tEnd + 0.004; }
// a crack: a click of excitation (0.5 ms up, a few ms down)
function crack(p, t, a) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(a, t + 0.0005); p.exponentialRampToValueAtTime(a * 0.01, t + R(0.003, 0.006)); p.linearRampToValueAtTime(0, t + 0.0065); return t + 0.0065; }

// ================================================================ the recipes

// A thick dead limb breaking under a boot, a few metres behind you. Heavier than the bear's twig (animalSounds branch_snap):
// the fibres go first (a crackle of small cracks over 60-150 ms), then the break (the limb's modes ring low: ~0.7-1.1 kHz and
// one about twice that, struck, a few ms each), splintering aftershocks, the weight landing on the duff (a low thud) and the
// needles settling.
function snapClose(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, tEnd = T + 0.75, f1 = R(700, 1100), r2 = R(1.8, 2.3), tb = T + R(0.06, 0.15);
  const nz = K.noise(false, T, tEnd), exc = K.gain(0); nz.connect(exc);
  exc.connect(K.filt('bandpass', f1, 5, K.gain(3, K.out))); exc.connect(K.filt('bandpass', f1 * r2, 4, K.gain(1.8, K.out)));
  exc.connect(K.filt('bandpass', R(2600, 3400), 2, K.gain(0.8, K.out)));   // the splinter
  exc.connect(K.filt('lowpass', 500, 0, K.gain(1.4, K.out)));              // the limb's body
  const ring = K.gain(0, K.out); K.osc('sine', f1, T, tEnd, ring); K.osc('sine', f1 * r2, T, tEnd, K.gain(0.45, ring));
  let t = T;
  for (let i = 0, m = RI(5, 9); i < m && t < tb - 0.012; i++) { crack(exc.gain, t, R(0.08, 0.28)); t += R(0.008, 0.03); }
  crack(exc.gain, tb, 1); hit(ring.gain, tb, 0.0004, 1, 0, R(0.02, 0.035));
  let ta = tb + R(0.015, 0.03);
  for (let i = 0, n = RI(2, 4); i < n; i++) { crack(exc.gain, ta, R(0.25, 0.55)); ta += R(0.015, 0.05); }
  const th = K.gain(0, K.filt('highpass', 35, 0, K.out)), o = K.osc('sine', R(75, 95), T, tEnd, th);
  path(o.frequency, [[tb, 90], [tb + 0.08, 50]], true);
  hit(th.gain, tb + 0.005, 0.004, 0.9, 0.01, 0.12);
  const ru = K.gain(0, K.out); nz.connect(K.filt('bandpass', R(3500, 5000), 0.7, ru)); hit(ru.gain, tb + 0.02, 0.02, 0.12, 0.05, 0.3);
  return K.done();
}

// Someone breathing right behind your head: a slow open-mouthed exhale (breath turbulence through a relaxed tract, formants
// ~650 / 1150 / 2500 Hz, air hiss on top) with the close, low rumble of it moving past your ear, a creak of vocal fry as it
// runs out, a pause, then a slow inhale through the nose (narrower, higher, a faint whistle). Wet lips as the mouth opens.
function breathClose(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, rate = R(0.9, 1.1), le = R(1.0, 1.3) * rate, gap = R(0.25, 0.4), li = R(0.8, 1.0) * rate;
  const te = T, ti = T + le + gap, tEnd = ti + li + 0.05;
  const nz = K.noise(false, T, tEnd), br = K.noise(true, T, tEnd);
  const ex = K.gain(0, K.out);
  K.bank(nz, [[R(600, 700), 2.5, 0.8], [R(1080, 1220), 3, 0.55], [R(2350, 2650), 3.5, 0.3]], ex);
  nz.connect(K.filt('highpass', 3500, 0, K.gain(0.18, ex)));
  br.connect(K.filt('lowpass', 220, 0, K.gain(0.9, ex)));
  path(ex.gain, [[te, 0], [te + le * 0.25, 0.9], [te + le * 0.6, 0.7]]); ex.gain.exponentialRampToValueAtTime(0.01, te + le); ex.gain.linearRampToValueAtTime(0, te + le + 0.004);
  const fry = K.gain(0, K.filt('bandpass', 600, 1.5, K.out)), fo = K.osc('sawtooth', R(55, 75), T, tEnd, fry), tf = te + le * 0.55;
  path(fry.gain, [[tf, 0], [tf + 0.1, 0.1]]); fry.gain.exponentialRampToValueAtTime(0.004, te + le * 0.95); fry.gain.linearRampToValueAtTime(0, te + le * 0.95 + 0.004);
  path(fo.frequency, [[tf, 70], [te + le, 48]], true);
  const inh = K.gain(0, K.out);
  nz.connect(K.filt('bandpass', R(1800, 2300), 2.2, inh)); nz.connect(K.filt('bandpass', R(3600, 4300), 3, K.gain(0.5, inh)));
  K.osc('sine', R(2600, 3100), T, tEnd, K.gain(0.012, inh));
  path(inh.gain, [[ti, 0], [ti + li * 0.5, 0.55]]); inh.gain.exponentialRampToValueAtTime(0.005, ti + li); inh.gain.linearRampToValueAtTime(0, ti + li + 0.004);
  const wet = K.gain(0, K.filt('bandpass', 2400, 1.5, K.out)); nz.connect(wet);
  let tc = te + 0.01; for (let i = 0, m = RI(1, 3); i < m; i++) tc = hit(wet.gain, tc, 0.0006, R(0.2, 0.4), 0, R(0.004, 0.01)) + R(0.02, 0.06);
  return K.done();
}

// A whisper at your ear, not quite words: 5-8 syllables at ~5 a second, in words of two or three. Whispered speech has no
// voice at all: breath through three formants that move for every syllable (a, e, i, o, u targets), onsets of a stop (a
// click through ~2.2 kHz) or a sibilant (s: noise over 4 kHz lifted at 6.5), sometimes a trailing s; the close breath under it.
function whisper(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = RI(5, 8), syl = [];
  let t = T + 0.02;
  for (let i = 0; i < n; i++) { const l = R(0.12, 0.24), coda = Math.random() < 0.25; syl.push([t, l, coda, Math.random()]); t += l + R(0.03, 0.09) + (coda ? 0.1 : 0) + (i < n - 1 && Math.random() < 0.2 ? R(0.1, 0.2) : 0); }
  const tEnd = t + 0.1;
  const nz = K.noise(false, T, tEnd), br = K.noise(true, T, tEnd);
  const vw = K.gain(0, K.out), f = [K.filt('bandpass', 500, 6), K.filt('bandpass', 1500, 8), K.filt('bandpass', 2600, 9)];
  f.forEach((x, i) => { nz.connect(x); x.connect(K.gain([1, 0.7, 0.35][i], vw)); });
  br.connect(K.filt('lowpass', 200, 0, K.gain(0.35, vw)));
  const s = K.gain(0, K.out); nz.connect(K.filt('highpass', 4200, 0, K.filt('peaking', 6500, 1, s, 6)));
  const k = K.gain(0, K.out); nz.connect(K.filt('bandpass', 2200, 1, k));
  const V = [[700, 1200], [420, 2000], [300, 2300], [550, 1800], [500, 900], [350, 800]];
  for (const [ts, l, coda, r] of syl) {
    const [f1, f2] = pick(V);
    for (const [x, fv] of [[f[0], f1], [f[1], f2], [f[2], R(2400, 2900)]]) path(x.frequency, [[ts, fv * R(0.9, 1.1)], [ts + l, fv * R(0.85, 1.15)]], true);
    let vs = ts + 0.01;
    if (r < 0.35) hit(k.gain, ts, 0.001, R(0.4, 0.8), 0.004, 0.02);
    else if (r < 0.65) { path(s.gain, [[ts, 0], [ts + 0.03, R(0.5, 0.9)], [ts + 0.08, 0.3]]); s.gain.linearRampToValueAtTime(0, ts + 0.1); vs = ts + 0.06; }
    path(vw.gain, [[vs, 0], [vs + 0.03, R(0.6, 1)], [ts + l * 0.7 + 0.03, R(0.5, 0.8)]]); vw.gain.linearRampToValueAtTime(0, ts + l + 0.03);
    if (coda) { path(s.gain, [[ts + l + 0.035, 0], [ts + l + 0.07, R(0.4, 0.7)]]); s.gain.linearRampToValueAtTime(0, ts + l + 0.12); }
  }
  return K.done();
}

// A heavy boot on an open wooden stair tread (2-by plank on stringers): the heel takes the weight, a low thud of the tread
// and the stringers (~95-125 Hz, swept down a little as it loads, damped in ~0.1 s), the plank's own modes (230 / 460 / 920 /
// 1800 Hz, each shorter than the one below it: wood), the heel's dull knock, grit under the sole; then the toe, lighter.
function stairStep(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, tEnd = T + 0.5, f0 = R(95, 125), tt = T + R(0.08, 0.12);
  const hp = K.filt('highpass', 40, 0, K.out), nz = K.noise(false, T, tEnd);
  const th = K.gain(0, hp), o = K.osc('sine', f0, T, tEnd, th);
  path(o.frequency, [[T, f0 * 1.25], [T + 0.05, f0]], true);
  hit(th.gain, T, 0.003, 1, 0.008, R(0.09, 0.13));
  for (const [f, a, t60] of [[R(210, 250), 0.55, 0.11], [R(430, 500), 0.4, 0.075], [R(860, 980), 0.2, 0.05], [R(1700, 1950), 0.09, 0.03]]) {
    const g = K.gain(0, hp), g2 = K.gain(0, hp), o2 = K.osc('sine', f, T, tEnd); o2.connect(g); o2.connect(g2);   // heel, toe (they overlap)
    hit(g.gain, T + 0.001, 0.0015, a, 0, t60 * R(0.85, 1.15)); hit(g2.gain, tt + 0.001, 0.0015, a * 0.35, 0, t60 * 0.7);
  }
  const kn = K.gain(0, hp); nz.connect(K.filt('bandpass', R(900, 1300), 1.3, kn));
  hit(kn.gain, T, 0.0008, 0.9, 0.002, 0.018); hit(kn.gain, tt, 0.0008, 0.45, 0.002, 0.014);
  const body = K.gain(0, hp); nz.connect(K.filt('lowpass', 350, 0, body)); hit(body.gain, T, 0.002, 0.7, 0.004, 0.05);
  const gr = K.gain(0, hp); nz.connect(K.filt('bandpass', 5000, 0.8, gr));
  let tg = T + 0.005; for (let i = 0, m = RI(3, 7); i < m && tg < tt - 0.012; i++) tg = hit(gr.gain, tg, 0.0004, R(0.05, 0.18), 0, R(0.002, 0.006)) + R(0.004, 0.015);
  const toe = K.gain(0, hp); K.osc('sine', f0 * 1.4, T, tEnd, toe); hit(toe.gain, tt, 0.002, 0.45, 0.004, 0.06);
  return K.done();
}

// A drop of water off a wet boot onto the landing's boards: the tick of it meeting the film of water, the air bubble it traps
// ringing up in pitch (Minnaert, ~1.3-2.4 kHz rising 40-80% in 50 ms), and the board under it, barely.
function bootDrip(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, tEnd = T + 0.25, f = R(1300, 2400);
  const b = K.gain(0, K.out), o = K.osc('sine', f, T, tEnd, b);
  path(o.frequency, [[T + 0.004, f], [T + 0.054, f * R(1.4, 1.8)]], true);
  hit(b.gain, T + 0.004, 0.0015, 0.6, 0, R(0.04, 0.07));
  const nz = K.noise(false, T, tEnd), tk = K.gain(0, K.out); nz.connect(K.filt('bandpass', R(3000, 4200), 1.2, tk)); hit(tk.gain, T, 0.0005, 0.5, 0, 0.008);
  const wd = K.gain(0, K.out); K.osc('sine', R(380, 520), T, tEnd, wd); hit(wd.gain, T, 0.001, 0.2, 0, 0.03);
  return K.done();
}

// Knuckles on a single pane of window glass in a wooden sash, two or three taps: the glass's bright "tock" (plate modes
// ~2.3 / 3.5 / 5 / 7 kHz, ringing 60-90 ms), the pane buzzing low in its frame (~300-600 Hz), the knuckle's dull click. The
// last tap softer.
function windowTap(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, n = RI(2, 3), taps = [];
  let t = T; for (let i = 0; i < n; i++) { taps.push([t, i === n - 1 ? R(0.5, 0.7) : R(0.85, 1)]); t += R(0.2, 0.32); }
  const tEnd = t + 0.3;
  const gl = K.gain(0, K.out), fr = K.gain(0, K.out), kn = K.gain(0, K.out);
  for (const [f, a] of [[R(2100, 2500), 1], [R(3300, 3800), 0.6], [R(4700, 5400), 0.35], [R(6800, 7600), 0.15]]) K.osc('sine', f, T, tEnd, K.gain(a, gl));
  for (const [f, a] of [[R(300, 380), 1], [R(520, 600), 0.5]]) K.osc('sine', f, T, tEnd, K.gain(a, fr));
  const nz = K.noise(false, T, tEnd); nz.connect(K.filt('bandpass', R(1100, 1500), 1.5, kn));
  for (const [tt, a] of taps) { hit(gl.gain, tt, 0.0004, 0.5 * a, 0, R(0.06, 0.09)); hit(fr.gain, tt, 0.001, 0.6 * a, 0, R(0.05, 0.08)); hit(kn.gain, tt, 0.0005, 0.9 * a, 0.001, 0.012); }
  return K.done();
}

// The cab radio opening by itself: band-limited static (330-3200 Hz, the set's speaker) swelling in, sagging, surging, a
// heterodyne whistle drifting up through it, crackle, something like syllables of a voice just under the hiss, just short of
// words — then cut dead as the far end lets go of the key, and the squelch tail.
function radioWrong(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, L = R(2.4, 3.0), tEnd = T + L + 0.3;
  const bus = K.filt('lowpass', 3200, 0.8, K.filt('highpass', 330, 0.7, K.out));
  const nz = K.noise(false, T, tEnd), hiss = K.gain(0, bus); nz.connect(hiss);
  path(hiss.gain, [[T, 0], [T + 0.08, 0.25], [T + L * 0.35, 0.6], [T + L * 0.55, 0.3], [T + L * 0.8, 0.8], [T + L, 0.75]]); hiss.gain.linearRampToValueAtTime(0, T + L + 0.005);
  const w0 = R(900, 1100), wh = K.gain(0, bus), o = K.osc('sine', w0, T, tEnd, wh);
  path(o.frequency, [[T, w0], [T + L, R(1400, 1700)]], true);
  path(wh.gain, [[T + L * 0.2, 0], [T + L * 0.5, 0.05], [T + L * 0.9, 0.02]]); wh.gain.linearRampToValueAtTime(0, T + L + 0.005);
  const vo = K.gain(0, bus); nz.connect(K.filt('bandpass', R(700, 900), 4, K.gain(1.2, vo))); nz.connect(K.filt('bandpass', R(1500, 1900), 5, K.gain(0.8, vo)));
  let t = T + L * 0.3; while (t < T + L * 0.85) { const l = R(0.09, 0.18); path(vo.gain, [[t, 0], [t + 0.02, R(0.25, 0.45)]]); vo.gain.linearRampToValueAtTime(0, t + l); t += l + R(0.03, 0.08); }
  const pop = K.gain(0, bus); K.noise(true, T, tEnd, pop);
  let tp = T + 0.05; while (tp < T + L - 0.05) tp = hit(pop.gain, tp, 0.0005, R(0.5, 1.2), 0, R(0.005, 0.015)) + R(0.05, 0.3);
  const sq = K.gain(0, bus); nz.connect(sq); hit(sq.gain, T + L + 0.01, 0.002, 0.8, 0.12, 0.03);
  return K.done();
}

// Under a jump scare: a sub-bass hit you feel (a sine falling ~58 -> 30 Hz over two seconds with a fifth above it, and a
// low-passed thump of noise on the attack).
function subBoom(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, L = R(1.6, 2.2), tEnd = T + L + 0.05;
  const b = K.gain(0, K.out), o = K.osc('sine', 58, T, tEnd, b), o2 = K.osc('sine', 87, T, tEnd, K.gain(0.3, b));
  path(o.frequency, [[T, R(56, 62)], [T + 0.4, 38], [T + L, 30]], true); path(o2.frequency, [[T, 90], [T + 0.4, 57], [T + L, 45]], true);
  hit(b.gain, T, 0.006, 1, 0.08, L - 0.1);
  const th = K.gain(0, K.filt('lowpass', 180, 0, K.out)); K.noise(true, T, tEnd, th); hit(th.gain, T, 0.004, 0.9, 0.02, 0.35);
  return K.done();
}

// After the jump: the ringing in your ears. A thin high tone (6-8 kHz) and its twin a hair apart so it beats, a quieter one a
// fourth below; in fast, fading over five seconds.
function tinnitus(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, L = R(4.5, 6), tEnd = T + L + 0.05, f = R(6200, 8200);
  const g = K.gain(0, K.out);
  K.osc('sine', f, T, tEnd, g); K.osc('sine', f * R(1.003, 1.008), T, tEnd, K.gain(0.6, g)); K.osc('sine', f * 0.75, T, tEnd, K.gain(0.15, g));
  path(g.gain, [[T, 0], [T + 0.05, 1], [T + 0.6, 0.8]]); g.gain.exponentialRampToValueAtTime(0.002, T + L); g.gain.linearRampToValueAtTime(0, T + L + 0.004);
  return K.done();
}

// Three slow knocks on the cab door with a knuckle: the door slab booms low (~95-130 Hz, then 230-290, 480-600, ~1.1 kHz,
// each damped faster than the one below), the knuckle clicks, the panel's body thumps, and on the heavy ones the latch
// rattles in its keeper. Almost a second apart; the last one late, and softer.
function knockSlow(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, sp = R(0.85, 1.1), knocks = [[T, 1], [T + sp, R(1, 1.12)], [T + sp * 2 + R(0.1, 0.35), R(0.7, 0.85)]];
  const tEnd = knocks[2][0] + 0.4;
  const hp = K.filt('highpass', 45, 0, K.out), nz = K.noise(false, T, tEnd);
  const modes = [[R(95, 130), 0.16, 1], [R(230, 290), 0.1, 0.55], [R(480, 600), 0.06, 0.3], [R(1000, 1250), 0.035, 0.12]];
  const mg = modes.map(([f, , a]) => { const g = K.gain(0, hp); K.osc('sine', f, T, tEnd, K.gain(a, g)); return g; });
  const kn = K.gain(0, hp); nz.connect(K.filt('bandpass', R(1500, 2200), 1.2, kn));
  const body = K.gain(0, hp); nz.connect(K.filt('lowpass', 400, 0, body));
  const la = K.gain(0, hp); nz.connect(K.filt('bandpass', R(3200, 4200), 6, la));
  for (const [t, a] of knocks) {
    modes.forEach(([, t60], i) => hit(mg[i].gain, t, 0.002, a, 0, t60));
    hit(kn.gain, t, 0.0006, 0.7 * a, 0.001, 0.012); hit(body.gain, t, 0.002, 0.8 * a, 0.004, 0.05);
    if (a > 0.95) { let tl = t + 0.01; for (let i = 0; i < 3; i++) tl = hit(la.gain, tl, 0.0005, R(0.1, 0.25) * a, 0, 0.006) + R(0.012, 0.025); }
  }
  return K.done();
}

// A yawn (yours: in your head): a long inhale through a mouth opening wider (breath through an "aah" tract, F1 rising
// 450 -> 800 Hz), then the sighing voiced "haaah-uhh" as it lets go (a breathy voice falling ~0.6x in pitch, the mouth closing
// a -> o -> u), and the breath out after it.
function yawn(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, li = R(1.0, 1.35), lv = R(0.9, 1.3), lo = R(0.5, 0.8), ti = T, tv = T + li, to = tv + lv, tEnd = to + lo + 0.05;
  const nz = K.noise(false, T, tEnd);
  const inh = K.gain(0, K.out), F1 = K.filt('bandpass', 450, 3), F2 = K.filt('bandpass', 1000, 4);
  nz.connect(F1); nz.connect(F2); F1.connect(inh); F2.connect(K.gain(0.6, inh));
  path(F1.frequency, [[ti, 450], [tv, 800]], true); path(F2.frequency, [[ti, 1000], [tv, 1250]], true);
  path(inh.gain, [[ti, 0], [ti + li * 0.7, 0.5], [tv - 0.05, 0.6]]); inh.gain.linearRampToValueAtTime(0, tv + 0.1);
  const vg = K.gain(0, K.out), src = K.gain(1), f0 = R(150, 200), saw = K.osc('sawtooth', f0, T, tEnd, src);
  path(saw.frequency, [[tv, f0 * 1.15], [tv + lv * 0.3, f0], [to, f0 * 0.6]], true);
  nz.connect(K.gain(0.8, src));
  const V1 = K.filt('bandpass', 800, 5), V2 = K.filt('bandpass', 1200, 6), V3 = K.filt('bandpass', 2600, 7);
  for (const [x, a] of [[V1, 1], [V2, 0.5], [V3, 0.15]]) { src.connect(x); x.connect(K.gain(a, vg)); }
  path(V1.frequency, [[tv, 800], [to, 380]], true); path(V2.frequency, [[tv, 1200], [to, 800]], true);
  path(vg.gain, [[tv, 0], [tv + 0.12, 0.35], [tv + lv * 0.5, 0.28]]); vg.gain.exponentialRampToValueAtTime(0.004, to); vg.gain.linearRampToValueAtTime(0, to + 0.004);
  const ex = K.gain(0, K.out); nz.connect(K.filt('bandpass', 700, 1, ex));
  path(ex.gain, [[to - 0.05, 0], [to + 0.1, 0.3]]); ex.gain.exponentialRampToValueAtTime(0.003, to + lo); ex.gain.linearRampToValueAtTime(0, to + lo + 0.004);
  return K.done();
}

// You, going down: knees first, then the rest (two heavy, damped, low thuds ~55-105 Hz: a body is soft), the slap of cloth
// and body on the boards or the ground, clothes rustling on the way down, the breath knocked out of you.
function bodyFall(d, v, H) {
  const K = kit(d, v, H); if (!K) return 0;
  const T = K.t0, tb = T + R(0.18, 0.3), tEnd = tb + 0.6;
  const hp = K.filt('highpass', 35, 0, K.out), nz = K.noise(false, T, tEnd);
  const th = K.gain(0, hp), o = K.osc('sine', 100, T, tEnd, th);
  path(o.frequency, [[T, R(95, 110)], [T + 0.05, 70], [tb, 95], [tb + 0.07, 55]], true);
  hit(th.gain, T, 0.004, 0.55, 0.01, 0.1); hit(th.gain, tb, 0.005, 1, 0.015, 0.16);
  const sl = K.gain(0, hp); nz.connect(K.filt('lowpass', 900, 0, K.filt('highpass', 150, 0, sl)));
  hit(sl.gain, T, 0.003, 0.35, 0.01, 0.06); hit(sl.gain, tb, 0.004, 0.7, 0.02, 0.1);
  const cl = K.gain(0, hp); nz.connect(K.filt('bandpass', R(2500, 3500), 0.8, cl));
  fade(cl.gain, [[T, 0], [T + 0.08, 0.12], [tb + 0.1, 0.1]], tb + 0.4);
  const hf = K.gain(0, hp); nz.connect(K.filt('bandpass', 900, 1.2, hf)); hit(hf.gain, tb + 0.03, 0.02, 0.25, 0.03, 0.25);
  return K.done();
}

// ================================================================ registry
const RECIPE = {
  snap_close: snapClose, breath_close: breathClose, whisper, stair_step: stairStep, bootprint_drip: bootDrip,
  window_tap: windowTap, radio_wrong: radioWrong, sub_boom: subBoom, tinnitus, knock_slow: knockSlow, yawn, body_fall: bodyFall,
};
// output trim so each call's MEDIAN peak at volume 1 (before the panner) is: snap 0.6; knocks, stair step, body fall 0.55;
// window tap 0.5; radio 0.45; breath, whisper 0.35 (they're at your ear: loud enough); yawn 0.3; drip 0.25; sub boom 0.7;
// tinnitus 0.1 (a whine, not a tone). Calibrated on 5 seeds each in the test renderer (tests/scareSounds.test.mjs checks them).
export const SCARE_LEVEL = {
  snap_close: 0.483, breath_close: 0.591, whisper: 0.235, stair_step: 0.378, bootprint_drip: 0.395,
  window_tap: 0.38, radio_wrong: 0.518, sub_boom: 0.518, tinnitus: 0.058, knock_slow: 0.375, yawn: 1.473, body_fall: 0.44,
};
export const SCARE_SOUNDS = Object.keys(RECIPE);
/** The longest each call lasts (s). */
export const SCARE_SOUND_MAX_S = { snap_close: 1, breath_close: 3.3, whisper: 4.5, stair_step: 0.7, bootprint_drip: 0.5, window_tap: 1.3,
  radio_wrong: 3.6, sub_boom: 2.5, tinnitus: 6.5, knock_slow: 3.2, yawn: 4, body_fall: 1.2 };
const warned = new Set();
function guard(n) {
  return (dest, volume, H) => {
    building = null;
    try { return RECIPE[n](dest, Math.min(volume == null ? 1 : +volume, 16) * SCARE_LEVEL[n], H); }
    catch (e) {
      if (building) building.abort();
      if (!warned.has(n)) { warned.add(n); try { console.warn('scare sound "' + n + '" failed, playing nothing:', e); } catch (e2) { /* no console */ } }
      return 0;
    } finally { building = null; }
  };
}
/** name -> fn(dest, volume, H): each returns the call's length in seconds (0 when silent). They never throw. */
export const SCARE_RECIPES = Object.fromEntries(SCARE_SOUNDS.map((n) => [n, guard(n)]));
/** Add every scare sound to the engine's synth table. Returns the names added ([] for a stub audio without addSynth). */
export function registerScareSounds(audio) {
  if (!audio || typeof audio.addSynth !== 'function') return [];
  for (const n of SCARE_SOUNDS) audio.addSynth(n, SCARE_RECIPES[n]);
  return SCARE_SOUNDS;
}
/** H for rendering outside the engine (an OfflineAudioContext). */
export function scareHelpers(ctx) { return { ctx, noise: (brown = false) => ownNoise(ctx, brown) }; }
