// FALSE LIGHT — WebAudio for the lookout: ambience beds (rain, gusting wind with tree rustle and a resonant whistle round
// the cab and the rails, a creek, a small single-cylinder generator, radio static, crickets / insects), the cab's own
// small sounds (propane heater, stove burner + percolator, alarm clock, lamp hum), positional one-shots, layered
// footsteps by surface, the human sounds (sob, scream, breath) from filtered noise + formants, two generated
// convolution reverb spaces (the valley outside, the little wooden cab) switched by zone, and the score (music.js).
// Most sounds are pre-rendered into AudioBuffers with plain JS math (warm() spreads that over idle slices after start;
// anything needed sooner renders on the spot). Recorded Kenney one-shots and ambience loops layer in when they load.
// Starts suspended until the first user gesture and never plays anything by itself before that; muted by default, and
// while muted the AudioContext is suspended (after the master fades out): no audio-thread work, no one-shots, no warm-up,
// no sample downloads, the score's scheduler stopped. Every master / per-play gain change is ramped.
import * as THREE from 'three';
import { createMusic, pickMood, MUSIC_DEFAULT_VOLUME, makeIR, toBuffer, rng, bqc, bqRun, addPartial, fadeEdges, normPeak, dcBlock, peakOf } from './music.js?v=f6619665';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const SR_LOOP = 22050, SR_HIT = 32000;
// cab fallbacks for positional beds until the Blender cab provides the anchors (three coords, same as bridge.js)
const CAB_POS = { IA_heater: [1.98, 30.75, 0.85], IA_radio: [1.72, 31.0, -0.45], IA_stove: [1.55, 30.95, 1.45], IA_clock: [1.5, 31.0, 0.5], IA_lamp: [0, 32.2, 0] };

// ================================================================== world sound renderers (plain JS -> Float32Array)
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Filtered noise burst added into out at t0: env 'exp' (tau = dur/4) or 'swell' (rise then fall). */
function burstInto(out, sr, t0, dur, amp, R, { lp = null, hp = null, bp = null, env = 'exp', brown = false } = {}) {
  const n = Math.max(2, Math.round(dur * sr)), x = new Float64Array(n); let b = 0;
  for (let i = 0; i < n; i++) { let v = R() * 2 - 1; if (brown) { b = (b + 0.04 * v) / 1.04; v = b * 6; } const u = i / n; x[i] = v * (env === 'swell' ? Math.sin(Math.PI * Math.pow(u, 0.6)) : Math.exp(-u * 4)); }
  if (hp) bqRun(x, bqc('highpass', hp, 0.7, sr)); if (lp) bqRun(x, bqc('lowpass', lp, 0.7, sr)); if (bp) bqRun(x, bqc('bandpass', bp[0], bp[1], sr));
  const k0 = Math.round(t0 * sr); for (let i = 0; i < n && k0 + i < out.length; i++) out[k0 + i] += x[i] * amp;
}
/** An impact: damped modes [[f, t60, amp], ...] starting at t0 (impulse response of each, so they start at zero). */
function modes(out, sr, t0, list, amp, R, spread = 0) { for (const [f, t60, a] of list) addPartial(out, sr, f * (1 + (R() - 0.5) * spread), amp * a, t60 / 6.91, t60 / 6.91, 1, 0, Math.round(t0 * sr)); }
/** Tiny damped-sine grains (gravel, needles, crackle): n grains, times from timeFn(R), freq range, tau range. */
function grains(out, sr, n, timeFn, fr, taus, amp, R) { for (let k = 0; k < n; k++) { const t = timeFn(R); if (t < 0) continue; const a = amp * Math.pow(R(), 1.6); addPartial(out, sr, fr[0] + R() * (fr[1] - fr[0]), a, taus[0] + R() * (taus[1] - taus[0]), taus[0] + R() * (taus[1] - taus[0]), 1, R() * TAU, Math.round(t * sr)); } }
/** Stick-slip friction (a creak): an impulse train whose rate follows rateFn(u), through resonant wood / hinge modes. */
function creakInto(out, sr, t0, dur, rateFn, res, amp, R, jitter = 0.25) {
  const n = Math.round(dur * sr), e = new Float64Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const u = i / n; ph += rateFn(u) * (1 + (R() - 0.5) * jitter) / sr; if (ph >= 1) { ph -= 1; e[i] = (0.5 + R()) * Math.sin(Math.PI * Math.min(1, u * 6)) * Math.min(1, (1 - u) * 5); } e[i] += (R() * 2 - 1) * 0.02; }
  const acc = new Float64Array(n);
  for (const [f, Q, g] of res) { const y = Float64Array.from(e); bqRun(y, bqc('bandpass', f, Q, sr)); for (let i = 0; i < n; i++) acc[i] += y[i] * g; }
  const k0 = Math.round(t0 * sr); for (let i = 0; i < n && k0 + i < out.length; i++) out[k0 + i] += acc[i] * amp;
}
/** A seamless loop: render L + xf seconds with fn(x), then fold the last xf into the head with an equal-power crossfade. */
function loopify(fn, L, sr, xf = 0.25, chans = 1) {
  const n = Math.round(L * sr), m = Math.round(xf * sr), out = [];
  for (let c = 0; c < chans; c++) {
    const x = new Float64Array(n + m); fn(x, c);
    const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[i];
    for (let i = 0; i < m; i++) { const u = i / m; y[i] = x[i] * Math.sin(u * Math.PI / 2) + x[n + i] * Math.cos(u * Math.PI / 2); }
    out.push(y);
  }
  return out;
}
const WOOD_HEEL = [[105, 0.13, 1], [205, 0.1, 0.7], [470, 0.055, 0.35], [980, 0.03, 0.2], [2300, 0.014, 0.1]];
const WOOD_TOE = [[290, 0.06, 0.6], [780, 0.035, 0.5], [1750, 0.02, 0.3], [3400, 0.01, 0.12]];
/** Footstep layers: surface in wood|gravel|dirt|water|wet, part in heel|toe|scuff. */
function renderStep(surface, part, v) {
  const sr = SR_HIT, R = rng(hashStr(surface + part) + v * 7919), len = { heel: 0.24, toe: 0.14, scuff: 0.22 }[part] * (surface === 'water' ? 1.8 : 1), out = new Float64Array(Math.round(len * sr));
  if (surface === 'wood') {
    if (part === 'heel') { burstInto(out, sr, 0, 0.006, 0.5, R, { lp: 900 }); modes(out, sr, 0.001, WOOD_HEEL, 0.9, R, 0.18); }
    else if (part === 'toe') { burstInto(out, sr, 0, 0.003, 0.35, R, { hp: 1200 }); modes(out, sr, 0.0005, WOOD_TOE, 0.55, R, 0.2); }
    else { const n = out.length; for (let i = 0; i < n; i++) { const u = i / n; out[i] = (R() * 2 - 1) * Math.sin(Math.PI * Math.pow(u, 0.4)) * (0.6 + 0.4 * Math.sin(TAU * (45 + R() * 3) * i / sr)); } bqRun(out, bqc('bandpass', 1700, 1.1, sr)); bqRun(out, bqc('highpass', 500, 0.7, sr)); normPeak(out, 0.35); }
  } else if (surface === 'gravel') {
    const cnt = part === 'heel' ? 42 : part === 'toe' ? 22 : 34, mean = part === 'heel' ? 0.022 : part === 'toe' ? 0.014 : 0.06;
    grains(out, sr, cnt, (r) => (part === 'scuff' ? r() * 0.15 : -Math.log(1 - r() * 0.98) * mean) + 0.002, part === 'toe' ? [2400, 7500] : [1700, 6500], [0.0008, 0.0035], 0.5, R);
    if (part !== 'scuff') burstInto(out, sr, 0, 0.04, part === 'heel' ? 0.9 : 0.4, R, { lp: 180, brown: true });
    else burstInto(out, sr, 0, 0.16, 0.12, R, { hp: 2500, env: 'swell' });
  } else if (surface === 'dirt') {   // the forest floor: duff and needles, a twig now and then
    if (part === 'heel') { burstInto(out, sr, 0, 0.05, 1, R, { lp: 200, brown: true }); burstInto(out, sr, 0.002, 0.03, 0.3, R, { bp: [650, 1.2] }); grains(out, sr, 10, (r) => r() * 0.05, [1800, 5200], [0.0006, 0.002], 0.07, R); }
    else if (part === 'toe') { burstInto(out, sr, 0, 0.03, 0.35, R, { lp: 320, brown: true }); burstInto(out, sr, 0.001, 0.02, 0.3, R, { bp: [1100, 1.2] }); grains(out, sr, 6, (r) => r() * 0.04, [2200, 6000], [0.0005, 0.0018], 0.08, R); }
    else { burstInto(out, sr, 0, 0.16, 0.3, R, { hp: 800, lp: 4500, env: 'swell' }); grains(out, sr, 8, (r) => r() * 0.14, [2500, 6000], [0.0005, 0.0015], 0.05, R); }
  } else if (surface === 'water') {
    const big = part === 'heel' ? 1 : part === 'toe' ? 0.6 : 0.4;
    burstInto(out, sr, 0, part === 'scuff' ? 0.3 : 0.16, 0.7 * big, R, { bp: [1100, 0.8], env: part === 'scuff' ? 'swell' : 'exp' });
    burstInto(out, sr, 0.004, 0.12, 0.6 * big, R, { lp: 280, brown: true });
    for (let k = 0; k < (part === 'heel' ? 7 : 4); k++) {   // Minnaert bubbles, rising as they reach the surface
      const t = 0.03 + R() * 0.22, f0 = 450 + R() * 1300, tau = 0.012 + R() * 0.02, k0 = Math.round(t * sr), n = Math.round(tau * 6 * sr); let ph = 0;
      for (let i = 0; i < n && k0 + i < out.length; i++) { const tt = i / sr; ph += TAU * f0 * (1 + 0.9 * tt / (tau * 4)) / sr; out[k0 + i] += Math.sin(ph) * 0.12 * big * Math.exp(-tt / tau); }
    }
  } else {   // wet: a squelch under the step when it's been raining
    const n = out.length; let ph = 0; for (let i = 0; i < n * 0.6; i++) { const t = i / sr; ph += TAU * (900 - 500 * Math.min(1, t / 0.06)) / sr; out[i] += Math.sin(ph) * 0.15 * Math.exp(-t / 0.03); }
    burstInto(out, sr, 0, 0.09, 0.5, R, { lp: 700 });
  }
  dcBlock(out); fadeEdges(out, sr, 0.0005, 0.02);
  return Float32Array.from(normPeak(out, 0.7));
}
/** Creaks: board (a floorboard taking weight), stair, hinge (the door). */
function renderCreak(kind, v) {
  const sr = SR_LOOP, R = rng(hashStr(kind) + v * 131), dur = kind === 'hinge' ? 0.55 + R() * 0.35 : kind === 'hinge_short' ? 0.22 + R() * 0.1 : 0.32 + R() * 0.2, out = new Float64Array(Math.round((dur + 0.08) * sr));
  if (kind === 'board') creakInto(out, sr, 0, dur, (u) => 38 - 14 * u + 6 * Math.sin(u * 9), [[180 + R() * 40, 6, 1], [340, 7, 0.8], [620, 8, 0.5], [1150, 9, 0.25]], 1, R, 0.35);
  else if (kind === 'stair') creakInto(out, sr, 0, dur, (u) => 55 + 30 * Math.sin(Math.PI * u), [[220 + R() * 60, 7, 1], [460, 8, 0.7], [890, 9, 0.4], [1600, 10, 0.2]], 1, R, 0.3);
  else { const a = 170 + R() * 40, b = 380 + R() * 80; creakInto(out, sr, 0, dur, (u) => a + (b - a) * Math.sin(Math.PI * Math.min(1, u * 1.4)), [[760, 12, 0.8], [1450, 14, 1], [2300, 16, 0.6], [3400, 18, 0.3], [330, 6, 0.4]], 1, R, 0.12); }
  dcBlock(out); fadeEdges(out, sr, 0.003, 0.05);
  return Float32Array.from(normPeak(out, 0.6));
}
function renderLatch(v) {   // bolt withdraws, strikes the keeper: two metal clacks and the wood around them
  const sr = SR_HIT, R = rng(771 + v), out = new Float64Array(Math.round(0.2 * sr));
  for (const [t, a] of [[0, 1], [0.035 + R() * 0.025, 0.7]]) {
    burstInto(out, sr, t, 0.0015, 0.8 * a, R, { hp: 1500 });
    modes(out, sr, t, [[2150, 0.08, 1], [3400, 0.05, 0.7], [5200, 0.04, 0.5], [7300, 0.03, 0.3]], 0.35 * a, R, 0.1);
    modes(out, sr, t, [[310, 0.05, 1], [820, 0.03, 0.6]], 0.4 * a, R, 0.1);
  }
  fadeEdges(out, sr, 0.0003, 0.02); return Float32Array.from(normPeak(out, 0.6));
}
function renderThump(v) {   // the door slab meeting its frame, the glass in the cab windows buzzing after it
  const sr = SR_HIT, R = rng(551 + v), out = new Float64Array(Math.round(0.6 * sr));
  burstInto(out, sr, 0, 0.008, 0.8, R, { lp: 600 });
  modes(out, sr, 0.001, [[85, 0.25, 1], [140, 0.18, 0.8], [232, 0.12, 0.6], [480, 0.07, 0.4], [1100, 0.04, 0.25]], 1, R, 0.1);
  for (let k = 0; k < 5; k++) modes(out, sr, 0.01 + k * 0.012 + R() * 0.01, [[2600 + R() * 2400, 0.02, 1]], 0.12 * Math.pow(0.7, k), R);
  fadeEdges(out, sr, 0.0005, 0.05); return Float32Array.from(normPeak(out, 0.7));
}
function renderSash(dir, v) {   // a wooden sash sliding in its channel: stick-slip friction, catches, then the stop
  const sr = SR_HIT, R = rng(333 + v + (dir === 'down' ? 50 : 0)), dur = 0.5 + R() * 0.2, out = new Float64Array(Math.round((dur + 0.35) * sr)), n = Math.round(dur * sr);
  const x = new Float64Array(n); let am = 0, next = 0;
  for (let i = 0; i < n; i++) { const u = i / n, sp = Math.sin(Math.PI * Math.pow(u, 0.7)); if (i >= next) { am = 0.4 + R() * 0.6; next = i + Math.round(sr / (25 + 40 * sp + R() * 15)); } am *= 0.9993; x[i] = (R() * 2 - 1) * sp * am; }
  const y = Float64Array.from(x); bqRun(x, bqc('bandpass', 900, 0.9, sr)); bqRun(y, bqc('bandpass', 2300, 1.4, sr)); for (let i = 0; i < n; i++) out[i] = x[i] + y[i] * 0.6;
  for (let k = 0; k < 3; k++) modes(out, sr, R() * dur * 0.9, [[380 + R() * 200, 0.03, 1], [1200, 0.02, 0.5]], 0.3, R);
  if (dir === 'down') { modes(out, sr, dur, [[120, 0.12, 1], [260, 0.08, 0.7], [640, 0.05, 0.4]], 1.4, R, 0.1); for (let k = 0; k < 4; k++) modes(out, sr, dur + 0.008 + k * 0.01, [[3000 + R() * 2500, 0.02, 1]], 0.15 * Math.pow(0.7, k), R); }
  else modes(out, sr, dur, [[300, 0.05, 1], [900, 0.03, 0.5]], 0.5, R, 0.1);
  dcBlock(out); fadeEdges(out, sr, 0.004, 0.04); return Float32Array.from(normPeak(out, 0.6));
}
/**
 * The generator: a small four-stroke single at ~3400 rpm = 28.5 firing pulses a second. Rendered circularly (every
 * cycle's tail wraps into the start) with per-cycle jitter, so it loops seamlessly: exhaust pressure pulses through the
 * muffler and pipe resonances, the puff of each firing, a valve tick, sheet-metal shroud rattle, a little saturation.
 */
function renderGenerator(sr = SR_LOOP) {
  const R = rng(1983), cycles = 80, fire = 28.5, L = cycles / fire, n = Math.round(L * sr), e = new Float64Array(n), rat = new Float64Array(n), tick = new Float64Array(n);
  const per = []; let sum = 0; for (let k = 0; k < cycles; k++) { const p = 1 + (R() - 0.5) * 0.06; per.push(p); sum += p; }
  let t = 0;
  for (let k = 0; k < cycles; k++) {
    const k0 = Math.round(t / sum * n), P = per[k] / sum * n, a = R() < 0.025 ? 0.35 : 0.85 + R() * 0.3;
    const pw = Math.round(0.004 * sr); for (let i = 0; i < pw; i++) e[(k0 + i) % n] += a * Math.sin(Math.PI * i / pw);   // the pressure pulse
    const pn = Math.round(0.012 * sr); for (let i = 0; i < pn; i++) e[(k0 + i) % n] += (R() * 2 - 1) * 0.35 * a * Math.exp(-i / (0.003 * sr));   // the puff
    const rn = Math.round(P * 0.8); for (let i = 0; i < rn; i++) rat[(k0 + i) % n] += (R() * 2 - 1) * a * Math.exp(-i / (0.01 * sr));   // the shroud rattles after each bang
    tick[Math.round(k0 + P * 0.45) % n] += 0.5 + R() * 0.3;   // the valve train
    t += per[k];
  }
  const two = (x) => { const y = new Float64Array(2 * n); y.set(x); y.set(x, n); return y; };   // two laps: keep the second (steady state)
  const ex = two(e), acc = new Float64Array(2 * n);
  for (const [f, Q, g] of [[95, 2.5, 1], [190, 3, 0.6], [420, 4, 0.35], [760, 3, 0.18]]) { const y = Float64Array.from(ex); bqRun(y, bqc('bandpass', f, Q, sr)); for (let i = 0; i < 2 * n; i++) acc[i] += y[i] * g; }
  const lpe = Float64Array.from(ex); bqRun(lpe, bqc('lowpass', 1400, 0.7, sr)); for (let i = 0; i < 2 * n; i++) acc[i] += lpe[i] * 0.25;
  const rt = two(rat); const r2 = Float64Array.from(rt); bqRun(rt, bqc('bandpass', 1350, 5, sr)); bqRun(r2, bqc('bandpass', 2650, 6, sr)); for (let i = 0; i < 2 * n; i++) acc[i] += (rt[i] + r2[i] * 0.7) * 0.22;
  const tk = two(tick); bqRun(tk, bqc('bandpass', 3100, 8, sr)); for (let i = 0; i < 2 * n; i++) acc[i] += tk[i] * 0.35;
  const out = new Float32Array(n), pk = peakOf(acc.subarray(n)) || 1; for (let i = 0; i < n; i++) out[i] = Math.tanh(acc[n + i] / pk * 1.4) * 0.6;
  return out;
}
/** The generator catching (pull-cord zip, a few coughs, then it runs) / dying (the pulses slowing to a stop, a clunk). */
function renderGenerator2(kind, sr = SR_LOOP) {
  const R = rng(kind === 'start' ? 11 : 12), dur = kind === 'start' ? 2.2 : 1.8, n = Math.round(dur * sr), e = new Float64Array(n);
  let t = kind === 'start' ? 0.55 : 0;
  if (kind === 'start') { const zn = Math.round(0.45 * sr); for (let i = 0; i < zn; i++) { const u = i / zn; e[i] += (R() * 2 - 1) * 0.25 * Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(TAU * (30 + 60 * u) * i / sr)); } }
  while (t < dur - 0.05) {
    const k0 = Math.round(t * sr), u = t / dur, a = kind === 'start' ? (t < 1.0 ? 0.5 + R() * 0.6 : 0.9) : 0.9 * (1 - u * 0.6);
    const pw = Math.round(0.005 * sr); for (let i = 0; i < pw && k0 + i < n; i++) e[k0 + i] += a * Math.sin(Math.PI * i / pw);
    const pn = Math.round(0.02 * sr); for (let i = 0; i < pn && k0 + i < n; i++) e[k0 + i] += (R() * 2 - 1) * 0.35 * a * Math.exp(-i / (0.004 * sr));
    const rate = kind === 'start' ? (t < 1.0 ? 5 + R() * 6 : Math.min(28.5, 8 + (t - 1.0) * 30)) : Math.max(2.5, 28.5 * Math.pow(1 - u, 1.6));
    t += 1 / rate;
  }
  const acc = new Float64Array(n);
  for (const [f, Q, g] of [[95, 2.5, 1], [190, 3, 0.6], [420, 4, 0.35]]) { const y = Float64Array.from(e); bqRun(y, bqc('bandpass', f, Q, sr)); for (let i = 0; i < n; i++) acc[i] += y[i] * g; }
  if (kind === 'stop') { const R2 = rng(5); modes(acc, sr, dur - 0.25, [[140, 0.2, 1], [390, 0.1, 0.5], [1900, 0.05, 0.2]], 0.3, R2); }
  for (let i = 0; i < n; i++) acc[i] = Math.tanh(acc[i] * 1.4);
  fadeEdges(acc, sr, 0.003, 0.1); return Float32Array.from(normPeak(acc, 0.7));
}
/** Radio static bed: 300-3200 Hz hiss that fades (QSB), crackle pops, a faint drifting heterodyne. */
function renderStatic(sr = SR_LOOP) {
  return loopify((x) => {
    const R = rng(1200); let fad = 0.7, ft = 0.7, pop = 0, ph = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % 2205 === 0) ft = 0.35 + R() * 0.65; fad += (ft - fad) * 0.0004;
      if (R() < 5 / sr) pop = (R() < 0.5 ? -1 : 1) * (0.6 + R() * 1.4); pop *= 0.985;
      ph += TAU * (1350 + 250 * Math.sin(i / sr * 0.7)) / sr;
      x[i] = (R() * 2 - 1) * fad + pop + Math.sin(ph) * 0.03;
    }
    bqRun(x, bqc('highpass', 330, 0.7, sr)); bqRun(x, bqc('lowpass', 3200, 0.8, sr)); bqRun(x, bqc('peaking', 1800, 1, sr, 3)); normPeak(x, 0.5);
  }, 4, sr)[0];
}
/** A squelch tail: the key-up pop, a burst of band-limited static that cuts off hard. */
function renderSquelch(v) {
  const sr = SR_HIT, R = rng(4040 + v), d = 0.14 + R() * 0.1, out = new Float64Array(Math.round((d + 0.05) * sr)), n = Math.round(d * sr);
  for (let i = 0; i < Math.round(0.002 * sr); i++) out[i] += (1 - i / (0.002 * sr)) * 0.9;
  for (let i = 0; i < n; i++) { const u = i / n; out[i + 40] += (R() * 2 - 1) * Math.min(1, u * 20) * (0.8 + 0.2 * Math.sin(u * 40)); }
  bqRun(out, bqc('highpass', 400, 0.7, sr)); bqRun(out, bqc('lowpass', 3500, 0.9, sr));
  for (let i = n + 40; i < Math.min(out.length, n + 40 + 60); i++) out[i] *= 1 - (i - n - 40) / 60;
  for (let i = n + 100; i < out.length; i++) out[i] = 0;
  return Float32Array.from(normPeak(out, 0.6));
}
function renderHeater(sr = SR_LOOP) {   // propane: a steady gas hiss and a low soft flame, flickering
  return loopify((x) => {
    const R = rng(71), lo = new Float64Array(x.length); let fl = 1, ft = 1;
    for (let i = 0; i < x.length; i++) { if (i % 900 === 0) ft = 0.75 + R() * 0.5; fl += (ft - fl) * 0.002; x[i] = (R() * 2 - 1); lo[i] = (R() * 2 - 1) * fl; }
    bqRun(x, bqc('highpass', 2600, 0.7, sr)); bqRun(x, bqc('peaking', 5200, 1, sr, 4)); bqRun(lo, bqc('lowpass', 260, 0.7, sr)); bqRun(lo, bqc('lowpass', 320, 0.7, sr));
    for (let i = 0; i < x.length; i++) x[i] = x[i] * 0.35 + lo[i] * 1.6;
    normPeak(x, 0.5);
  }, 3, sr)[0];
}
function renderStove(sr = SR_LOOP) {    // a gas ring at full: a turbulent roar with a flutter in it
  return loopify((x) => {
    const R = rng(72), hi = new Float64Array(x.length); let am = 1, at = 1;
    for (let i = 0; i < x.length; i++) { if (i % 60 === 0) at = 0.75 + R() * 0.5; am += (at - am) * 0.05; x[i] = (R() * 2 - 1) * am; hi[i] = R() * 2 - 1; }
    bqRun(x, bqc('lowpass', 900, 0.7, sr)); bqRun(x, bqc('peaking', 380, 1.2, sr, 5)); bqRun(hi, bqc('bandpass', 3200, 1.5, sr));
    for (let i = 0; i < x.length; i++) x[i] += hi[i] * 0.08;
    normPeak(x, 0.5);
  }, 3, sr)[0];
}
function renderHum(sr = SR_LOOP) {   // the lamp: 60 Hz mains, a 120 Hz transformer buzz and its harmonics (exactly periodic in 1 s)
  const n = sr, x = new Float32Array(n);
  for (const [h, a] of [[60, 0.35], [120, 1], [180, 0.3], [240, 0.35], [360, 0.18], [480, 0.1], [600, 0.06], [840, 0.04], [1080, 0.03]]) {
    const cw = Math.cos(TAU * h / sr), sw = Math.sin(TAU * h / sr); let c = 1, s = 0; for (let i = 0; i < n; i++) { x[i] += s * a; const r = c * cw - s * sw; s = c * sw + s * cw; c = r; }
  }
  return normPeak(x, 0.5);
}
function renderTick(v) {   // a wind-up alarm clock: tick / tock (the escapement's two sides differ)
  const sr = SR_HIT, R = rng(80 + v), out = new Float64Array(Math.round(0.05 * sr));
  burstInto(out, sr, 0, 0.001, 0.4, R, { hp: 2000 });
  modes(out, sr, 0, v ? [[2800, 0.012, 1], [4200, 0.009, 0.6], [1150, 0.02, 0.4]] : [[3100, 0.01, 1], [4700, 0.008, 0.7], [6200, 0.006, 0.4], [1200, 0.02, 0.3]], 0.8, R, 0.05);
  fadeEdges(out, sr, 0.0002, 0.005); return Float32Array.from(normPeak(out, 0.6));
}
function renderPerc(v) {   // the percolator: a blup of coffee against the glass knob (v 0-2), or the pot ticking as it heats (3)
  const sr = SR_LOOP, R = rng(90 + v), out = new Float64Array(Math.round(0.15 * sr));
  if (v === 3) { modes(out, sr, 0, [[2400 + R() * 800, 0.015, 1], [5100, 0.01, 0.4]], 0.6, R); }
  else { let ph = 0; const f0 = 280 + R() * 300; for (let i = 0; i < out.length; i++) { const t = i / sr; ph += TAU * f0 * (1 + 2.5 * t) / sr; out[i] = Math.sin(ph) * Math.exp(-t / 0.025) * Math.min(1, t / 0.002); } burstInto(out, sr, 0, 0.03, 0.2, R, { lp: 1200 }); }
  fadeEdges(out, sr, 0.0005, 0.01); return Float32Array.from(normPeak(out, 0.6));
}
function renderRustle(sr = SR_LOOP) {   // wind in the firs: needles hiss, fluttering at leaf rate, swelling; stereo
  return loopify((x, c) => {
    const R = rng(501 + c * 7); let am = 0.5, at = 0.5, sw = 0.6, st = 0.6;
    for (let i = 0; i < x.length; i++) { if (i % 1100 === 0) at = 0.15 + R() * 0.85; if (i % 22050 === 0) st = 0.3 + R() * 0.7; am += (at - am) * 0.01; sw += (st - sw) * 0.00006; x[i] = (R() * 2 - 1) * am * sw; }
    bqRun(x, bqc('highpass', 1300, 0.7, sr)); bqRun(x, bqc('peaking', 4200, 0.8, sr, 3)); bqRun(x, bqc('lowpass', 8500, 0.7, sr)); normPeak(x, 0.5);
  }, 6, sr, 0.4, 2);
}
function renderBabble(sr = SR_LOOP) {   // a stream over stones: a rush plus a steady rain of little bubble chirps
  return loopify((x) => {
    const R = rng(606); for (let i = 0; i < x.length; i++) x[i] = R() * 2 - 1;
    bqRun(x, bqc('lowpass', 1300, 0.7, sr)); bqRun(x, bqc('highpass', 250, 0.7, sr)); for (let i = 0; i < x.length; i++) x[i] *= 0.5;
    const nb = Math.round(x.length / sr * 45);
    for (let k = 0; k < nb; k++) {
      const k0 = (R() * x.length) | 0, f0 = 300 + Math.pow(R(), 1.5) * 1500, tau = 0.006 + R() * 0.02, a = 0.15 + R() * 0.3, m = Math.round(tau * 5 * sr); let ph = 0;
      for (let i = 0; i < m && k0 + i < x.length; i++) { const t = i / sr; ph += TAU * f0 * (1 + 0.8 * t / (tau * 3)) / sr; x[k0 + i] += Math.sin(ph) * a * Math.exp(-t / tau) * Math.min(1, t / 0.001); }
    }
    normPeak(x, 0.5);
  }, 5, sr, 0.3)[0];
}
function renderCrickets(sr = SR_LOOP) {   // fallback if the recording doesn't load: four field crickets, each on its own clock
  return loopify((x, c) => {
    const R = rng(700 + c);
    for (let k = 0; k < 4; k++) {
      const f = 4300 + R() * 600, per = 0.45 + R() * 0.3, a = (0.3 + R() * 0.7) * (c ? (k % 2 ? 1 : 0.5) : (k % 2 ? 0.5 : 1)), pulses = 3 + ((R() * 2) | 0);
      for (let t = R() * per; t < x.length / sr - 0.2; t += per * (0.97 + R() * 0.06)) for (let p = 0; p < pulses; p++) {
        const k0 = Math.round((t + p * 0.032) * sr), m = Math.round(0.014 * sr);
        for (let i = 0; i < m && k0 + i < x.length; i++) x[k0 + i] += Math.sin(TAU * f * i / sr) * a * Math.sin(Math.PI * i / m);
      }
    }
    normPeak(x, 0.4);
  }, 6, sr, 0.2, 2);
}
function renderHopper(v) {   // a grasshopper's stridulation: syllables of fast clicks, 6-9 kHz
  const sr = SR_HIT, R = rng(810 + v), dur = 1.0 + R() * 0.8, out = new Float64Array(Math.round(dur * sr)), rate = 25 + R() * 18, f = 6000 + R() * 2800;
  for (let t = 0.01; t < dur - 0.05;) {
    const syl = 0.18 + R() * 0.25; for (let s = 0; s < syl; s += 1 / rate) { const k0 = Math.round((t + s) * sr); addPartial(out, sr, f * (0.95 + R() * 0.1), 0.4 + R() * 0.6, 0.0006, 0.0006, 1, 0, k0); }
    t += syl + 0.08 + R() * 0.2;
  }
  bqRun(out, bqc('highpass', 3000, 0.7, sr)); fadeEdges(out, sr, 0.002, 0.02); return Float32Array.from(normPeak(out, 0.5));
}
function renderBuzz(v) {   // a fly going past: a buzzy harmonic tone drifting in pitch (Doppler) and swelling past you
  const sr = SR_LOOP, R = rng(830 + v), dur = 2.2 + R(), n = Math.round(dur * sr), out = new Float64Array(n), f0 = 170 + R() * 60; let ph = 0;
  for (let i = 0; i < n; i++) { const u = i / n, f = f0 * (1 + 0.04 * Math.cos(Math.PI * u)) * (1 + 0.01 * Math.sin(TAU * 7 * i / sr)); ph += f / sr; if (ph >= 1) ph -= 1; out[i] = (2 * ph - 1) * Math.pow(Math.sin(Math.PI * u), 2); }
  bqRun(out, bqc('bandpass', 900, 0.8, sr)); bqRun(out, bqc('lowpass', 3000, 0.7, sr)); fadeEdges(out, sr, 0.01, 0.05); return Float32Array.from(normPeak(out, 0.4));
}
function renderThunder(v) {   // 0 near (a crack, then the roll), 1 mid, 2 far: a rumble of slow swells, darker with distance
  const sr = SR_LOOP, R = rng(900 + v), dur = 7 - v * 0.5, n = Math.round(dur * sr), out = new Float64Array(n), env = new Float64Array(n);
  const bumps = 5 + ((R() * 4) | 0), cr = 32, nc = Math.ceil(n / cr) + 1, ce = new Float64Array(nc);   // the swells, at control rate
  for (let k = 0; k < bumps; k++) { const c = (0.15 + Math.pow(R(), 1.3) * (dur * 0.55)) * sr / cr, w = (0.2 + R() * 0.7) * sr / cr, a = (0.4 + R() * 0.6) * (k === 0 ? 1.3 : 1); for (let j = Math.max(0, (c - 3 * w) | 0); j < Math.min(nc, c + 4 * w); j++) { const z = (j - c) / w; ce[j] += a * Math.exp(-z * z / (z < 0 ? 0.5 : 2.5)); } }
  for (let j = 0; j < nc; j++) ce[j] *= Math.exp(-j * cr / n * 1.5);
  for (let i = 0; i < n; i++) { const u = i / cr, j = u | 0; env[i] = ce[j] + (ce[j + 1] - ce[j]) * (u - j); }
  let b = 0; for (let i = 0; i < n; i++) { b = (b + 0.03 * (R() * 2 - 1)) / 1.03; out[i] = b * 7 * env[i]; }
  bqRun(out, bqc('lowpass', [260, 190, 130][v], 0.7, sr));
  if (v < 2) { const g = new Float64Array(n), kd = Math.exp(-2.5 / n); let ed = 1; for (let i = 0; i < n; i++) { g[i] = (R() * 2 - 1) * env[i] * ed; ed *= kd; } bqRun(g, bqc('bandpass', 650, 0.8, sr)); for (let i = 0; i < n; i++) out[i] += g[i] * (v ? 0.08 : 0.18); }
  if (v === 0) { for (let k = 0; k < 3; k++) burstInto(out, sr, 0.01 + k * 0.03 + R() * 0.02, 0.12, 1.2 - k * 0.3, R, { hp: 900 }); burstInto(out, sr, 0.005, 0.25, 0.8, R, { lp: 2400 }); }
  fadeEdges(out, sr, 0.004, 0.5); return Float32Array.from(normPeak(out, 0.8));
}
function renderMatch() {   // a strike and flare (the stove is lit with a kitchen match)
  const sr = SR_HIT, R = rng(1001), out = new Float64Array(Math.round(0.6 * sr));
  burstInto(out, sr, 0, 0.09, 0.6, R, { bp: [3200, 1.2] }); burstInto(out, sr, 0.07, 0.4, 0.35, R, { hp: 1500, env: 'swell' });
  fadeEdges(out, sr, 0.001, 0.05); return Float32Array.from(normPeak(out, 0.5));
}
function renderWhump(v) {   // gas catching: a soft low pressure swell
  const sr = SR_LOOP, R = rng(1100 + v), out = new Float64Array(Math.round(0.5 * sr));
  burstInto(out, sr, 0, 0.35, 1, R, { lp: 220, env: 'swell', brown: true }); burstInto(out, sr, 0.02, 0.3, 0.2, R, { hp: 2500, env: 'swell' });
  fadeEdges(out, sr, 0.002, 0.08); return Float32Array.from(normPeak(out, 0.6));
}
function renderValve(v) {   // a gas valve turning: a metal click and a short rising hiss
  const sr = SR_HIT, R = rng(1200 + v), out = new Float64Array(Math.round(0.35 * sr));
  modes(out, sr, 0, [[2900, 0.02, 1], [5100, 0.012, 0.5]], 0.5, R); burstInto(out, sr, 0.03, 0.3, 0.25, R, { hp: 3000, env: 'swell' });
  fadeEdges(out, sr, 0.0005, 0.04); return Float32Array.from(normPeak(out, 0.5));
}
const VARS = { wood_heel: 5, wood_toe: 5, wood_scuff: 3, gravel_heel: 5, gravel_toe: 5, gravel_scuff: 3, dirt_heel: 5, dirt_toe: 5, dirt_scuff: 3, water_heel: 4, water_toe: 4, water_scuff: 3, wet_heel: 3,
  creak_board: 4, creak_stair: 3, creak_hinge: 3, creak_hinge_short: 2, latch: 3, thump: 2, sash_up: 2, sash_down: 2, squelch: 3, tick: 2, perc: 4, hopper: 3, buzz: 2, thunder: 3, whump: 2, valve: 2 };
function renderWorld(key) {
  const [name, vs] = key.split('#'), v = +vs || 0;
  const step = /^(wood|gravel|dirt|water|wet)_(heel|toe|scuff)$/.exec(name);
  if (step) return { data: [renderStep(step[1], step[2], v)], sr: SR_HIT };
  const one = (f, sr = SR_HIT) => ({ data: [f()], sr });
  switch (name) {
    case 'creak_board': return one(() => renderCreak('board', v), SR_LOOP);
    case 'creak_stair': return one(() => renderCreak('stair', v), SR_LOOP);
    case 'creak_hinge': return one(() => renderCreak('hinge', v), SR_LOOP);
    case 'creak_hinge_short': return one(() => renderCreak('hinge_short', v), SR_LOOP);
    case 'latch': return one(() => renderLatch(v)); case 'thump': return one(() => renderThump(v));
    case 'sash_up': return one(() => renderSash('up', v)); case 'sash_down': return one(() => renderSash('down', v));
    case 'squelch': return one(() => renderSquelch(v)); case 'tick': return one(() => renderTick(v));
    case 'perc': return one(() => renderPerc(v), SR_LOOP); case 'hopper': return one(() => renderHopper(v)); case 'buzz': return one(() => renderBuzz(v), SR_LOOP);
    case 'thunder': return one(() => renderThunder(v), SR_LOOP); case 'match': return one(renderMatch); case 'whump': return one(() => renderWhump(v), SR_LOOP); case 'valve': return one(() => renderValve(v));
    case 'gen': return one(renderGenerator, SR_LOOP); case 'gen_start': return one(() => renderGenerator2('start'), SR_LOOP); case 'gen_stop': return one(() => renderGenerator2('stop'), SR_LOOP);
    case 'static': return one(renderStatic, SR_LOOP); case 'heater': return one(renderHeater, SR_LOOP); case 'stove': return one(renderStove, SR_LOOP); case 'hum': return one(renderHum, SR_LOOP);
    case 'rustle': return { data: renderRustle(), sr: SR_LOOP }; case 'babble': return one(renderBabble, SR_LOOP); case 'crickets': return { data: renderCrickets(), sr: SR_LOOP };
    default: throw new Error('audio: no renderer for ' + key);
  }
}
export const WORLD_KEYS = [...Object.entries(VARS).filter(([k]) => k !== 'thunder').flatMap(([k, n]) => Array.from({ length: n }, (_, i) => k + '#' + i)), 'match', 'gen', 'gen_start', 'gen_stop', 'static', 'heater', 'stove', 'hum', 'rustle', 'babble', 'crickets', 'thunder#0', 'thunder#1', 'thunder#2'];
export { pickMood };

// ================================================================== the engine side
export function createAudio(engine, opts = {}) {
  let ctx = null, master = null, comp = null, bus = {}, noiseBuf = null, brownBuf = null, music = null;
  const beds = {}, verb = {};
  let heard = false;   // audibleNow() as of this frame's update()
  const SAMPLE_SETS = {
    footstep_wood: ['footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002', 'footstep_wood_003', 'footstep_wood_004'],
    footstep_dirt: ['footstep_grass_000', 'footstep_grass_001', 'footstep_grass_002', 'footstep_grass_003', 'footstep_grass_004'],
    footstep_gravel: ['footstep00', 'footstep01', 'footstep02', 'footstep03', 'footstep04', 'footstep05', 'footstep06', 'footstep07', 'footstep08', 'footstep09'],
    door: ['doorOpen_1', 'doorOpen_2'], door_close: ['doorClose_1', 'doorClose_2', 'doorClose_3', 'doorClose_4'], trapdoor: ['doorClose_2', 'doorClose_4'],
    stair_creak: ['creak1', 'creak2', 'creak3'], hinge: ['creak1', 'creak2', 'creak3'], paper: ['bookFlip1', 'bookFlip2', 'bookFlip3'], logbook_open: ['bookOpen'], logbook_close: ['bookClose'],
    knock_one: ['impactPlank_medium_000', 'impactPlank_medium_001', 'impactPlank_medium_002', 'impactPlank_medium_003', 'impactPlank_medium_004'],
    metal: ['impactMetal_light_000', 'impactMetal_light_001', 'impactMetal_light_002', 'impactMetal_light_003', 'impactMetal_light_004'],
    metal_heavy: ['impactMetal_heavy_000', 'impactMetal_heavy_001', 'impactMetal_heavy_002'], cloth: ['cloth1', 'cloth2', 'cloth3', 'cloth4'],
  };
  const samples = {};
  let samplesLoading = false;
  const AMB = { rain: 'amb_rain.ogg', creek: 'amb_creek.ogg', wind: 'amb_wind.ogg', crickets: 'amb_crickets.mp3' };
  const rec = {};
  async function loadAmbience() {
    await Promise.all(Object.entries(AMB).map(async ([k, f]) => {
      try {
        const r = await fetch('assets/audio/' + f); if (!r.ok) return;
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = gain(0, bus.amb);
        if (k === 'rain') { const lp = filt('lowpass', 9000); src.connect(lp); lp.connect(g); rec.rainLP = lp; } else src.connect(g);
        src.start(0, Math.random() * buf.duration); rec[k] = g; rec[k + 'Src'] = src;
      } catch (e) { /* the synthesized bed stays */ }
    }));
  }
  async function loadSamples() {
    if (samplesLoading || !ctx) return; samplesLoading = true;
    loadAmbience();
    const names = [...new Set(Object.values(SAMPLE_SETS).flat())];
    await Promise.all(names.map(async (n) => {
      try { const r = await fetch('assets/audio/' + n + '.ogg'); if (!r.ok) return; samples[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { /* keep the procedural fallback */ }
    }));
  }
  function playSample(set, dest, v, rate = 1, t = 0) {
    const list = (SAMPLE_SETS[set] || []).map((n) => samples[n]).filter(Boolean);
    if (!list.length) return false;
    const src = ctx.createBufferSource(); src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate * (0.93 + Math.random() * 0.14);
    const g = ctx.createGain(); g.gain.value = v; src.connect(g); g.connect(dest);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start(t); return src;
  }
  const listenerPos = new THREE.Vector3(), fwd = new THREE.Vector3();
  const A = {
    volume: 0.8, muted: true, started: false, musicVolume: MUSIC_DEFAULT_VOLUME, roof: 0, zone: 'trail', gust: 0.3,
    // heater / stove / lamp / clockTick: 0..1 levels; coffee: 0..1 (the percolator starts to blup past ~0.5); inCab / doorOpen:
    // booleans (null = work it out from the player's zone / assume open); windowsOpen: 0-4; genSputter: 0..1 (fuel running out)
    ambience: { rain: 0, wind: 0.3, generator: 0, radioStatic: 0, forest: 0.6, creek: 0, heater: 0, stove: 0, coffee: 0, lamp: 0, clockTick: 0, inCab: null, doorOpen: null, windowsOpen: 0, genSputter: 0 },
  };

  // ---- is anything audible / running? (a muted game suspends its AudioContext: no audio-thread work, no timers, no nodes)
  const isOffline = () => !!ctx && typeof ctx.startRendering === 'function';   // an OfflineAudioContext counts as running
  const running = () => !!ctx && (ctx.state === 'running' || isOffline());
  /** One-shots / play(): only into a running context (a suspended one would hold every node until it resumed). */
  const live = () => A.started && running();
  /** The autonomous sounds (rain drops, insects, the clock, the percolator, starting a bed, the warm-up): only when heard. */
  const audibleNow = () => live() && !A.muted && A.volume > 0.001;
  let suspT = null, loaded = false;
  function applyMaster() {   // ramped (a jump in the master gain is a click)
    if (!master) return;
    const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(A.muted ? 0 : A.volume, t, 0.03);
  }
  function syncRunning() {
    if (!ctx || isOffline()) return;
    if (suspT) { clearTimeout(suspT); suspT = null; }
    if (A.muted) {   // after the master has faded out
      if (A.started && ctx.state === 'running' && typeof ctx.suspend === 'function') suspT = setTimeout(() => { suspT = null; if (A.muted && ctx.state === 'running') { try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ok */ } } }, 300);
    } else if (A.started && ctx.state !== 'running' && ctx.resume) { try { const p = ctx.resume(); if (p && p.then) p.then(wakeAll, () => {}); } catch (e) { /* ok */ } }
  }
  function wakeAll() {   // audible (again): the score's scheduler, the recorded samples (first time), the warm-up
    if (music) music.wake();
    if (!audibleNow()) return;
    if (!loaded) { loaded = true; loadSamples(); }
    kickWarm();
  }

  // ---- pre-rendered world buffers (idle warm-up, or on the spot); the looped beds first, they're needed soonest
  const LOOP_KEYS = ['rustle', 'babble', 'static', 'gen', 'crickets', 'heater', 'stove', 'hum'];
  const sbank = new Map(); let warmList = [...LOOP_KEYS, ...WORLD_KEYS.filter((k) => !LOOP_KEYS.includes(k))], warmT = null;
  function kickWarm() {
    if (warmT || opts.warm === false || !warmList.length) return;
    const w = () => { warmT = null; if (!audibleNow()) return; if (!warm(5)) warmT = setTimeout(w, 40); };
    warmT = setTimeout(w, 120);
  }
  const stats = { renderMs: 0, rendered: 0 };
  function sbuf(key) {
    let b = sbank.get(key); if (b) return b;
    const t0 = perfNow(), r = renderWorld(key); b = toBuffer(ctx, r.data, r.sr); sbank.set(key, b);
    stats.renderMs += perfNow() - t0; stats.rendered++; return b;
  }
  const svar = (name) => sbuf(name + '#' + ((Math.random() * (VARS[name] || 1)) | 0));
  function warm(budgetMs = 6) { const t0 = perfNow(); while (warmList.length && perfNow() - t0 < budgetMs) sbuf(warmList.shift()); return !warmList.length; }
  /** A one-shot buffer into dest: src -> gain; both disconnected when it ends. */
  function shot(b, dest, { t = null, gain: gv = 1, rate = 1, pan = null } = {}) {
    if (!b || !(gv > 0)) return null;
    const tt = Math.max(ctx.currentTime, t ?? ctx.currentTime), src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate; g.gain.value = gv; src.connect(g);
    let p = null; if (pan != null) { p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(dest); } else g.connect(dest);
    src.onended = () => { src.disconnect(); g.disconnect(); if (p) p.disconnect(); };
    src.start(tt); src.stop(tt + b.duration / rate + 0.02); return src;
  }

  function ensure() {
    if (ctx) return ctx;
    if (opts.context) ctx = opts.context;
    else { const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return null; ctx = new AC(); }
    master = ctx.createGain(); master.gain.value = A.muted ? 0 : A.volume; master.connect(ctx.destination);
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(master);
    bus.sfx = ctx.createGain(); bus.sfx.connect(comp);
    bus.pos = ctx.createGain(); bus.pos.connect(comp);               // positional one-shots (they get more of the space)
    bus.amb = ctx.createGain(); bus.amb.gain.value = 0.9; bus.amb.connect(comp);
    bus.music = ctx.createGain(); bus.music.connect(master);          // the score: its own volume, not ducked by the sfx compressor
    // reverb spaces: one send, two generated convolution rooms (the valley outside, the little wooden cab) crossfaded by zone
    const verbIn = ctx.createGain(); bus.verb = verbIn;
    gain(0.7, verbIn, bus.sfx); gain(1.3, verbIn, bus.pos); gain(0.06, verbIn, bus.amb);
    if (typeof ctx.createConvolver === 'function') {
      try {
        const sr = ctx.sampleRate;
        verb.out = ctx.createConvolver(); verb.out.buffer = toBuffer(ctx, makeIR({ sr, dur: 3.0, rt: [2.0, 1.6, 0.55], xover: [350, 2500], predelay: 0.012, build: 0.07, seed: 11,
          early: [[0.006, 0.5], [0.021, 0.2], [0.034, 0.16], [0.052, 0.12], [0.075, 0.1]], echoes: [[0.42, 0.09, 0.08], [0.93, 0.05, 0.12], [1.55, 0.025, 0.16]], echoLP: 1400 }), sr);
        verb.cab = ctx.createConvolver(); verb.cab.buffer = toBuffer(ctx, makeIR({ sr, dur: 0.9, rt: [0.45, 0.38, 0.24], xover: [300, 3500], predelay: 0.002, build: 0.004, seed: 12,
          early: [[0.0035, 0.6], [0.0061, 0.5], [0.0088, 0.45], [0.0117, 0.4], [0.0142, 0.3], [0.019, 0.25]], flutter: { period: 0.0117, gain: 0.35, count: 10 } }), sr);
        verb.outSend = gain(0, comp); verb.cabSend = gain(0, comp);
        verbIn.connect(verb.out); verb.out.connect(verb.outSend); verbIn.connect(verb.cab); verb.cab.connect(verb.cabSend);
      } catch (e) { verb.out = verb.cab = null; }
    }
    if (!verb.out) {   // no convolver: the old feedback-delay "room"
      const d1 = ctx.createDelay(1); d1.delayTime.value = 0.043; const fb = gain(0.32), lp = filt('lowpass', 2400);
      verbIn.connect(d1); d1.connect(lp); lp.connect(fb); fb.connect(d1); verb.fbSend = gain(0.25, comp); lp.connect(verb.fbSend);
    }
    const len = ctx.sampleRate * 4;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const n = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { n[i] = Math.random() * 2 - 1; last = (last + 0.02 * n[i]) / 1.02; b[i] = last * 3.5; }
    buildBeds();
    // the recorded samples load the first time the game is actually audible (wakeAll): a muted game never fetches them
    if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', () => { if (ctx.state === 'running') wakeAll(); });
    return ctx;
  }
  const noise = (brown = false) => { const s = ctx.createBufferSource(); s.buffer = brown ? brownBuf : noiseBuf; s.loop = true; s.loopStart = Math.random(); return s; };
  const gain = (v, dest, src) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); if (src) src.connect(g); return g; };
  const filt = (type, f, Q = 0.7, dest) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = Q; if (dest) x.connect(dest); return x; };
  function panner(pos, dest = bus.pos) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 400;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; p.connect(dest); return p;
  }
  const CAB_V = {};
  const anchor = (name) => { const a = engine.world && engine.world.anchors && engine.world.anchors.get(name); return a || (CAB_POS[name] ? (CAB_V[name] || (CAB_V[name] = new THREE.Vector3(...CAB_POS[name]))) : null); };
  /** A looped pre-rendered bed that starts when it's first needed and stops (and lets go of its nodes) when it's been silent. */
  function loopBed(key, { dest = bus.amb, pos = null, model = 'equalpower', ref = 1.5, roll = 1.4, lpf = null, rate = 1 } = {}) {
    const B = { key, src: null, g: null, lp: null, pan: null, level: 0, idle: 0, pos };
    B.start = () => {
      const b = sbuf(key); B.src = ctx.createBufferSource(); B.src.buffer = b; B.src.loop = true; B.src.playbackRate.value = rate;
      B.g = gain(0); let head = B.src;
      if (lpf) { B.lp = filt('lowpass', lpf); head.connect(B.lp); head = B.lp; }
      head.connect(B.g);
      if (pos) { const p = ctx.createPanner(); p.panningModel = model; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 300; B.pan = p; B.place(); B.g.connect(p); p.connect(dest); }
      else B.g.connect(dest);
      B.src.start(0, Math.random() * b.duration * 0.9);
    };
    B.place = () => { if (!B.pan) return; const p = typeof B.pos === 'function' ? B.pos() : B.pos; if (p) { B.pan.positionX.value = p.x; B.pan.positionY.value = p.y; B.pan.positionZ.value = p.z; } };
    B.stop = () => { try { B.src.stop(); } catch (e) { /* ok */ } for (const n of [B.src, B.lp, B.g, B.pan]) if (n) n.disconnect(); B.src = B.lp = B.g = B.pan = null; B.level = 0; };
    B.set = (target, dt) => {
      if (!(target >= 0)) target = 0;
      if (target > 0.0005 && !B.src && heard) B.start();   // (a muted game doesn't render or start a bed)
      if (!B.src) return;
      B.level += (target - B.level) * (1 - Math.exp(-dt * 3)); B.g.gain.value = B.level;
      if (target <= 0.0005 && B.level < 0.001) { B.idle += dt; if (B.idle > 2) B.stop(); } else B.idle = 0;
    };
    return B;
  }

  function buildBeds() {
    // rain: broadband hiss + a patter layer; "roof" variant boosts a resonant drum band
    { const out = gain(0, bus.amb); const s = noise(); const hp = filt('highpass', 900); const lp = filt('lowpass', 4200); const sh = filt('highshelf', 3000); sh.gain.value = -9; s.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(out);
      const roofG = gain(0, out); const s2 = noise(true); const bp = filt('bandpass', 380, 1.4); s2.connect(bp); bp.connect(roofG); s.start(); s2.start();
      beds.rain = { out, roofG }; }
    // wind: a synthetic body (used when the recording is missing), the firs rustling, and the whistle / moan the tower makes
    { const out = gain(0, bus.amb); const s = noise(true); const bp = filt('bandpass', 420, 0.6); s.connect(bp); bp.connect(out); s.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = gain(260); lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
      const wh = gain(0, bus.amb), sw = noise(), w1 = filt('bandpass', 820, 32), w2 = filt('bandpass', 1240, 24), mo = filt('bandpass', 260, 10), g1 = gain(2.2, wh), g2 = gain(1.2, wh), gm = gain(0, bus.amb);   // narrow bands of noise: they need the gain
      sw.connect(w1); sw.connect(w2); w1.connect(g1); w2.connect(g2); const sm = noise(true); sm.connect(mo); mo.connect(gm); sw.start(); sm.start();
      beds.wind = { out, bp, whistle: wh, w1, w2, moan: gm, mo }; }
    beds.rustle = loopBed('rustle');
    beds.creekSyn = loopBed('babble');
    { const out = gain(0, bus.amb); const s = noise(); const bp = filt('bandpass', 1400, 0.9); s.connect(bp); bp.connect(out); s.start(); beds.creek = { out }; }
    beds.generator = loopBed('gen', { pos: () => anchor('IA_generator'), model: 'HRTF', ref: 4, roll: 1.3, lpf: 8000 });
    beds.radio = loopBed('static', { pos: () => anchor('IA_radio'), ref: 1.2, roll: 1.5 });
    beds.heater = loopBed('heater', { pos: () => anchor('IA_heater'), ref: 1, roll: 1.6 });
    beds.stove = loopBed('stove', { pos: () => anchor('IA_stove') || anchor('IA_heater'), ref: 1, roll: 1.6 });
    beds.hum = loopBed('hum', { pos: () => anchor('IA_lamp'), ref: 1, roll: 1.8 });
    beds.crickets = loopBed('crickets');
    beds.clock = { g: gain(0), pan: null };
    { const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 0.8; p.rolloffFactor = 1.8; p.maxDistance = 60; beds.clock.g.connect(p); p.connect(bus.amb); beds.clock.pan = p; }
    beds.forest = { out: gain(1, bus.amb) };
  }

  // rain drops: short random ticks on leaves / the cab roof while it rains
  let dropT = 0;
  function drops(dt) {
    const r = A.ambience.rain; if (r < 0.05) return;
    dropT -= dt; if (dropT > 0) return; dropT = 0.012 + Math.random() * 0.05 / (0.3 + r);
    const t = ctx.currentTime, pan = ctx.createStereoPanner(), g = gain(0, pan); pan.pan.value = Math.random() * 2 - 1; pan.connect(bus.amb);
    const s = noise(), bp = filt('bandpass', A.roof > 0.5 ? 900 + Math.random() * 1200 : 2500 + Math.random() * 4000, 3); s.connect(bp); bp.connect(g);
    const v = (A.roof > 0.5 ? 0.08 : 0.035) * r * (0.4 + Math.random());
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.002); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.04 + Math.random() * 0.05);
    s.onended = () => { s.disconnect(); bp.disconnect(); g.disconnect(); pan.disconnect(); };
    s.start(t, Math.random() * 3); s.stop(t + 0.12);
  }
  // forest life: insects by day (grasshoppers, a fly going by), a bird now and then (if src/engine/animalSounds.js is
  // registered), an owl at night; the crickets are a bed (update)
  // insects by day (grasshoppers, a fly going by); the crickets are a bed (update). The animal calls (birds, the owl,
  // coyotes...) belong to src/game/wildlife.js, which plays animalSounds.js's recipes through play(): not doubled here.
  let lifeT = 2;
  function life(dt, hgt, inCab) {
    lifeT -= dt; if (lifeT > 0) return;
    const day = engine.sky ? engine.sky.dayFactor : 1, rain = A.ambience.rain;
    const vol = A.ambience.forest * (1 - rain * 0.85) * (inCab ? 0.3 : 1) * (1 - hgt * 0.55);
    lifeT = day > 0.4 ? 0.9 + Math.random() * 2.4 : 2 + Math.random() * 4;
    if (vol < 0.02 || day <= 0.4) return;
    const r = Math.random();
    if (r < 0.55) shot(svar('hopper'), beds.forest.out, { gain: vol * 0.05 * (0.4 + Math.random() * 0.6), rate: 0.92 + Math.random() * 0.16, pan: Math.random() * 1.8 - 0.9 });
    else if (r < 0.66) shot(svar('buzz'), beds.forest.out, { gain: vol * 0.035, rate: 0.9 + Math.random() * 0.2, pan: Math.random() * 1.8 - 0.9 });
  }

  // ---------------- one-shots (the old procedural helpers, kept for addSynth / animalSounds.js and the human sounds)
  function env(g, t, a, peak, d, sustain = 0, hold = 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, sustain), t + a + hold + d); }
  function burst(dest, { type = 'bandpass', f = 800, Q = 1, a = 0.002, d = 0.1, v = 0.5, brown = false, t = null }) {
    const tt = t ?? ctx.currentTime; const s = noise(brown); const x = filt(type, f, Q); const g = gain(0); s.connect(x); x.connect(g); g.connect(dest);
    env(g, tt, a, v, d); s.onended = () => { s.disconnect(); x.disconnect(); g.disconnect(); }; s.start(tt, Math.random() * 3); s.stop(tt + a + d + 0.05); return g;
  }
  function tone(dest, { type = 'sine', f = 440, f1 = null, a = 0.005, d = 0.2, v = 0.3, t = null }) {
    const tt = t ?? ctx.currentTime; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, tt); if (f1) o.frequency.exponentialRampToValueAtTime(f1, tt + a + d);
    const g = gain(0); o.connect(g); g.connect(dest); env(g, tt, a, v, d); o.onended = () => { o.disconnect(); g.disconnect(); }; o.start(tt); o.stop(tt + a + d + 0.05); return o;
  }
  // a voiced "human" source through vowel formants
  function voice(dest, { f0 = 140, dur = 1, vowel = 'a', breath = 0.3, v = 0.3, t = null, glide = 1, jitter = 0.03, sob = false }) {
    const tt = t ?? ctx.currentTime;
    const F = { a: [800, 1150, 2900], o: [500, 900, 2400], u: [350, 800, 2300], e: [450, 1800, 2600], i: [300, 2200, 3000] }[vowel];
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, tt); o.frequency.linearRampToValueAtTime(f0 * glide, tt + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = sob ? 6.5 : 5.2; const vg = gain(f0 * jitter); vib.connect(vg); vg.connect(o.frequency);
    const src = gain(1); o.connect(src);
    const n = noise(); const ng = gain(breath); n.connect(ng); ng.connect(src);
    const out = gain(0, dest), made = [o, vib, vg, src, n, ng, out];
    F.forEach((f, i) => { const bp = filt('bandpass', f, 6 - i); const g = gain([1, 0.5, 0.2][i]); src.connect(bp); bp.connect(g); g.connect(out); made.push(bp, g); });
    o.onended = () => { for (const m of made) m.disconnect(); };
    out.gain.setValueAtTime(0, tt); out.gain.linearRampToValueAtTime(v, tt + Math.min(0.15, dur * 0.2));
    // the sob's catches: sudden level changes, each over 15 ms (a stepped gain on a buzzy source clicks)
    if (sob) { let lv = v; for (let k = Math.max(0.2, Math.min(0.15, dur * 0.2) + 0.01); k < dur - 0.05; k += 0.18 + Math.random() * 0.2) { const nv = v * (0.35 + Math.random() * 0.65); out.gain.setValueAtTime(lv, tt + k); out.gain.linearRampToValueAtTime(nv, tt + k + 0.015); lv = nv; } }
    out.gain.linearRampToValueAtTime(0, tt + dur);
    o.start(tt); vib.start(tt); n.start(tt, Math.random() * 3); o.stop(tt + dur + 0.05); vib.stop(tt + dur + 0.05); n.stop(tt + dur + 0.05);
  }
  const now = () => ctx.currentTime;
  const HEEL = { wood: 0.9, gravel: 0.8, dirt: 0.75, water: 0.9, wet: 0.5 }, TOE = { wood: 0.5, gravel: 0.55, dirt: 0.45, water: 0.5 }, SCUFF = { wood: 0.35, gravel: 0.45, dirt: 0.35, water: 0.4 };
  /** A layered footstep into dest: heel, then toe (closer together when jogging), sometimes a scuff; pitch / gain varied. */
  function stepLayers(surf, d, v, jog = false, bodyGain = 1, t0 = null) {
    const t = t0 ?? now() + 0.004, rate = 0.92 + Math.random() * 0.16, gv = v * (0.85 + Math.random() * 0.3);
    shot(svar(surf + '_heel'), d, { t, gain: gv * HEEL[surf] * bodyGain, rate });
    const gap = jog ? 0.042 + Math.random() * 0.022 : 0.075 + Math.random() * 0.045;
    shot(svar(surf + '_toe'), d, { t: t + gap, gain: gv * TOE[surf] * (0.8 + Math.random() * 0.4), rate: rate * (1.02 + Math.random() * 0.06) });
    if (Math.random() < (jog ? 0.35 : 0.2)) shot(svar(surf + '_scuff'), d, { t: t + gap * 0.5 + Math.random() * 0.03, gain: gv * SCUFF[surf] * (0.6 + Math.random() * 0.5), rate });
  }
  const doorOpen = (d, v) => { const t = now(); shot(svar('latch'), d, { t, gain: 0.7 * v }); if (!(samples.creak1 && playSample('hinge', d, 0.45 * v, 0.85, t + 0.1))) shot(svar('creak_hinge'), d, { t: t + 0.1, gain: 0.5 * v, rate: 0.9 + Math.random() * 0.2 }); shot(svar('thump'), d, { t: t + 0.03, gain: 0.12 * v, rate: 1.4 }); };
  const doorClose = (d, v) => { const t = now(); shot(svar('creak_hinge_short'), d, { t, gain: 0.35 * v, rate: 0.9 + Math.random() * 0.2 }); const tt = t + 0.24 + Math.random() * 0.06; shot(svar('thump'), d, { t: tt, gain: 0.9 * v }); shot(svar('latch'), d, { t: tt + 0.012, gain: 0.55 * v }); if (samples.doorClose_1) playSample('door_close', d, 0.35 * v, 1, tt); };

  const SOUNDS = {
    footstep_wood: (d, v) => stepLayers('wood', d, v),
    footstep_dirt: (d, v) => stepLayers('dirt', d, v),
    footstep_gravel: (d, v) => stepLayers('gravel', d, v),
    footstep_water: (d, v) => stepLayers('water', d, v),
    footstep_wet: (d, v) => { shot(svar('wet_heel'), d, { gain: 0.8 * v, rate: 0.9 + Math.random() * 0.2 }); },
    splash: (d, v) => { stepLayers('water', d, v * 1.2); const t = now(); burst(d, { type: 'lowpass', f: 420, a: 0.01, d: 0.25, v: 0.3 * v, brown: true, t }); },
    // a floorboard taking weight: slow stick-slip through the board's modes, low and dry
    board_creak: (d, v) => { shot(svar('creak_board'), d, { gain: 0.35 * v, rate: 0.85 + Math.random() * 0.3 }); },
    stair_creak: (d, v) => { shot(svar('creak_stair'), d, { gain: 0.4 * v, rate: 0.85 + Math.random() * 0.3 }); },
    door: (d, v) => doorOpen(d, v), door_open: (d, v) => doorOpen(d, v), door_close: (d, v) => doorClose(d, v),
    window_open: (d, v) => { shot(svar('sash_up'), d, { gain: 0.6 * v, rate: 0.95 + Math.random() * 0.1 }); },
    window_close: (d, v) => { shot(svar('sash_down'), d, { gain: 0.7 * v, rate: 0.95 + Math.random() * 0.1 }); },
    window: (d, v) => { shot(svar('sash_up'), d, { gain: 0.6 * v }); },
    heater_on: (d, v) => { const t = now(); shot(svar('valve'), d, { t, gain: 0.5 * v }); shot(svar('whump'), d, { t: t + 0.35, gain: 0.7 * v }); },
    heater_off: (d, v) => { shot(svar('valve'), d, { gain: 0.45 * v, rate: 0.9 }); },
    stove_on: (d, v) => { const t = now(); shot(sbuf('match'), d, { t, gain: 0.5 * v }); shot(svar('valve'), d, { t: t + 0.5, gain: 0.35 * v, rate: 1.1 }); shot(svar('whump'), d, { t: t + 0.75, gain: 0.8 * v }); },
    lamp_chain: (d, v) => { const t = now(); shot(svar('tick'), d, { t, gain: 0.5 * v, rate: 0.7 }); shot(svar('latch'), d, { t: t + 0.05, gain: 0.25 * v, rate: 1.6 }); },
    trapdoor: (d, v) => { burst(d, { type: 'lowpass', f: 140, Q: 2, d: 0.45, v: 1.2 * v, brown: true }); burst(d, { f: 900, d: 0.08, v: 0.2 * v }); },
    gate_rattle: (d, v) => { for (let k = 0; k < 7; k++) burst(d, { f: 1800 + Math.random() * 1500, Q: 8, d: 0.06, v: 0.25 * v, t: ctx.currentTime + k * 0.07 + Math.random() * 0.03 }); },
    knock: (d, v) => { for (let k = 0; k < 3; k++) burst(d, { type: 'lowpass', f: 220, Q: 4, d: 0.14, v: 1.1 * v, brown: true, t: ctx.currentTime + k * 0.34 }); },
    drip: (d, v) => { tone(d, { f: 1600 + Math.random() * 500, f1: 700, a: 0.001, d: 0.07, v: 0.18 * v }); },
    radio_squelch: (d, v) => { shot(svar('squelch'), d, { gain: 0.5 * v, rate: 0.95 + Math.random() * 0.1 }); },
    radio_tail: (d, v) => { shot(svar('squelch'), d, { gain: 0.45 * v, rate: 0.9 + Math.random() * 0.1 }); },
    morse_click: (d, v) => { burst(d, { f: 2400, Q: 4, d: 0.025, v: 0.5 * v }); burst(d, { type: 'lowpass', f: 300, d: 0.05, v: 0.4 * v, brown: true }); },
    camera_shutter: (d, v) => { burst(d, { f: 3200, Q: 2, d: 0.02, v: 0.5 * v }); burst(d, { f: 1500, Q: 2, d: 0.03, v: 0.4 * v, t: ctx.currentTime + 0.06 }); },
    camera_eject: (d, v) => { tone(d, { type: 'sawtooth', f: 95, f1: 90, a: 0.02, d: 0.9, v: 0.05 * v }); burst(d, { f: 600, Q: 3, a: 0.05, d: 0.8, v: 0.08 * v }); },
    flash_whine: (d, v) => { tone(d, { f: 2500, f1: 7500, a: 0.1, d: 1.2, v: 0.012 * v }); },
    generator_start: (d, v) => { shot(sbuf('gen_start'), d, { gain: 0.8 * v }); },
    generator_stop: (d, v) => { shot(sbuf('gen_stop'), d, { gain: 0.8 * v }); },
    fuel_pour: (d, v) => { for (let k = 0; k < 18; k++) tone(d, { f: 300 + Math.random() * 500, f1: 150, a: 0.005, d: 0.06, v: 0.05 * v, t: ctx.currentTime + k * 0.09 + Math.random() * 0.05 }); },
    paper: (d, v) => { for (let k = 0; k < 5; k++) burst(d, { f: 4000, Q: 0.6, d: 0.04, v: 0.1 * v, t: ctx.currentTime + k * 0.05 }); },
    thunder: (d, v, o) => { const k = o && o.near != null ? o.near : 1; shot(sbuf('thunder#' + k), d, { gain: 1.1 * v * (k === 0 ? 1 : k === 1 ? 0.85 : 0.7), rate: 0.9 + Math.random() * 0.2 }); },
    heart: (d, v) => { const t = ctx.currentTime; tone(d, { f: 55, f1: 40, d: 0.12, v: 0.5 * v, t }); tone(d, { f: 50, f1: 38, d: 0.12, v: 0.35 * v, t: t + 0.22 }); },
    breath: (d, v) => { burst(d, { f: 900, Q: 0.6, a: 0.4, d: 0.9, v: 0.12 * v }); },
    sob: (d, v) => { const t = ctx.currentTime;   // far-off crying: shuddering breaths (catches), a faint low moan, a long inhale
      for (let k = 0; k < 4; k++) burst(d, { f: 700 + k * 60, Q: 1.4, a: 0.03, d: 0.16, v: 0.16 * v, t: t + k * 0.22 });
      voice(d, { f0: 140, dur: 1.2, vowel: 'u', breath: 1.6, v: 0.07 * v, glide: 0.85, jitter: 0.05, sob: true, t: t + 0.9 });
      burst(d, { f: 1400, Q: 0.6, a: 0.5, d: 0.6, v: 0.09 * v, t: t + 2.3 }); },
    scream: (d, v) => { const t = ctx.currentTime;   // raw, breathy and ragged rather than a clean tone
      voice(d, { f0: 380, dur: 2.0, vowel: 'a', breath: 2.2, v: 0.32 * v, glide: 1.35, jitter: 0.16, t });
      burst(d, { f: 2200, Q: 0.8, a: 0.08, d: 1.8, v: 0.28 * v, t }); burst(d, { type: 'lowpass', f: 500, a: 0.05, d: 1.6, v: 0.25 * v, t: t + 0.1 }); },
    radio_voice: (d, v, opts) => { const words = Math.max(2, ((opts && opts.text) || 'copy').split(/\s+/).length); const t = ctx.currentTime;
      // a voice under heavy static: band-limited noise that swells with the syllables (no fake formant buzz)
      for (let k = 0; k < words; k++) burst(d, { f: 1100 + Math.random() * 700, Q: 1.2, a: 0.03, d: 0.16 + Math.random() * 0.1, v: 0.1 * v, t: t + 0.15 + k * 0.31 });
      burst(d, { f: 1800, d: 0.18, v: 0.25 * v, t: t + 0.15 + words * 0.31 }); },
  };

  // ---- the score: always an object; the engine behind it is made in start() (it needs the AudioContext)
  const musicApi = {
    setMood(name, fade) { musicApi._mood = name; if (music) music.setMood(name, fade); },
    sting(name) { if (music && A.started) music.sting(name); },
    setVolume(v) { A.musicVolume = clamp(Number.isFinite(+v) ? +v : MUSIC_DEFAULT_VOLUME, 0, 1); if (music) { music.setVolume(A.musicVolume); music.wake(); } },
    get volume() { return A.musicVolume; },
    /** The mood playing now (a requested change waits out a short dwell first: see music.js setMood). */
    get mood() { return music ? music.mood : musicApi._mood; },
    get engine() { return music; },
    get ready() { return !!music && music.ready; },
    /** pickMood(state) with the current mood filled in (the chase radius has hysteresis). */
    pickMood: (s) => pickMood({ current: music ? music.pending || music.mood : musicApi._mood, ...s }),
    _mood: 'silent',
  };

  const api = {
    get context() { return ctx; },
    params: A,
    music: musicApi,
    start() {
      ensure(); if (!ctx) return;
      A.started = true;
      if (!music) {
        music = createMusic({ ctx, out: bus.music, timer: opts.musicTimer !== false, audible: () => audibleNow() && A.musicVolume > 0.001 });
        music.setVolume(A.musicVolume); if (musicApi._mood !== 'silent') music.setMood(musicApi._mood, 3);
      }
      syncRunning();   // sound on: resume the context; sound off (the default): suspend it once the master has faded
      wakeAll();
    },
    setVolume(v) { A.volume = Number.isFinite(+v) ? clamp(+v, 0, 4) : A.volume; applyMaster(); wakeAll(); },
    get muted() { return A.muted; },
    setMuted(b) { A.muted = !!b; applyMaster(); syncRunning(); wakeAll(); },
    setMusicVolume(v) { musicApi.setVolume(v); },
    get musicVolume() { return A.musicVolume; },
    setAmbience(o) { Object.assign(A.ambience, o); },
    /** A recorded sample set straight (pickups, set-downs): metal, metal_heavy, cloth, paper, knock_one, door_close. */
    sfx(set, { position = null, volume = 1 } = {}) {
      if (!live()) return;
      const g = gain(1), p = position ? panner(position) : null; g.connect(p || bus.sfx);
      const s = playSample(set, g, volume), done = () => { g.disconnect(); if (p) p.disconnect(); };
      if (s) s.addEventListener('ended', done); else done();
    },
    /** Register an extra procedural sound. fn(dest, volume, H) where H = { ctx, burst, tone, filt, gain, noise, voice, env } (see src/engine/animalSounds.js). */
    addSynth(name, fn) { SOUNDS[name] = (d, v, o) => fn(d, v, { ctx, burst, tone, filt, gain, noise, voice, env, ...o }); },
    has(name) { return !!SOUNDS[name]; },
    play(name, { position = null, volume = 1, loop = false, text = null, near = null } = {}) {
      if (!live()) return { stop() {}, setVolume() {} };
      const f = SOUNDS[name]; if (!f) { console.warn('no sound', name); return { stop() {}, setVolume() {} }; }
      volume = Math.min(16, +volume > 0 ? +volume : 0);   // NaN / negative / Infinity would throw inside a recipe's automation
      const g = gain(1); if (position) { g._p = panner(position); g.connect(g._p); } else g.connect(bus.sfx);
      const rel = { g, p: g._p || null, at: loop ? Infinity : now() + PLAY_TTL }; plays.push(rel);   // let go of these once it's surely over
      const handle = (timer = null) => ({ stop() { if (timer) clearInterval(timer); g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); rel.at = Math.min(rel.at, now() + PLAY_TTL); }, setVolume(x) { if (Number.isFinite(+x)) g.gain.setTargetAtTime(Math.max(0, +x), ctx.currentTime, 0.02); } });
      if (!(volume > 0)) { rel.at = now() + 0.5; return handle(); }   // silent: no recipe (its envelopes would ramp from 0)
      const map = { trapdoor: 'trapdoor', paper: 'paper', gate_rattle: 'metal', generator_start: 'metal_heavy' };
      if (name === 'knock' && samples.impactPlank_medium_000) { for (let k = 0; k < 3; k++) playSample('knock_one', g, volume * 1.4, 0.8, now() + k * 0.34); return handle(); }
      if (map[name] && playSample(map[name], g, volume * (name === 'gate_rattle' ? 0.9 : name === 'generator_start' ? 0.5 : 1.1))) {
        if (name === 'gate_rattle') for (let k = 1; k < 5; k++) playSample('metal', g, volume * 0.7, 1, now() + k * 0.09 + Math.random() * 0.04);
        if (name === 'generator_start') f(g, volume, { text });
        return handle();
      }
      const len = f(g, volume, { text, near });
      // a recipe that says how long it lasts (animalSounds.js does) lets go of its HRTF panner then, not 20 s later
      if (!loop && Number.isFinite(len) && len >= 0) rel.at = Math.min(rel.at, now() + len + 1);
      return handle(loop ? setInterval(() => f(g, volume, { text, near }), 3800 + Math.random() * 1500) : null);
    },
    footstep(surface, jog, carrying) {
      if (!live()) return;
      const v = (jog ? 1.2 : 0.8) * (carrying ? 1.2 : 1);
      const wet = A.ambience.rain > 0.4 && surface !== 'wood' && surface !== 'water';
      if (surface === 'water') { stepLayers('water', bus.sfx, v * 1.1, jog); return; }
      const surf = surface === 'wood' ? 'wood' : surface === 'gravel' ? 'gravel' : 'dirt';
      // the recorded Kenney step (when loaded) is the body under the synthesized heel + toe for wood and the forest floor
      const body = surf !== 'gravel' && playSample('footstep_' + surf, bus.sfx, v * (surf === 'wood' ? 0.45 : 0.3));
      stepLayers(surf, bus.sfx, v * 0.55, jog, body ? 0.6 : 1);
      if (wet) shot(svar('wet_heel'), bus.sfx, { t: now() + 0.01, gain: v * 0.3, rate: 0.9 + Math.random() * 0.2 });
      if (surface === 'wood' && Math.random() < (jog ? 0.06 : 0.1)) api.play('board_creak', { volume: 0.8 });
    },
    thunder(delay) { if (!audibleNow()) return; const k = delay < 1.6 ? 0 : delay < 3 ? 1 : 2; setTimeout(() => api.play('thunder', { volume: 0.9, near: k }), delay * 1000); },
    /** Pre-render every world sound now (tests / a loading screen); returns ms. */
    prerenderAll() { if (!ensure()) return 0; const t0 = perfNow(); warm(1e9); return perfNow() - t0; },
    warm,
    stats,
    update(dt) {
      if (!ctx) return;
      dt = Math.min(0.1, Math.max(0, dt || 0));
      heard = audibleNow();   // muted / suspended: levels still follow the game, but no one-shots are made and no bed starts
      const cam = engine.camera;
      if (cam) { cam.getWorldPosition(listenerPos); cam.getWorldDirection(fwd); }
      const L = ctx.listener;
      if (L && L.positionX) { L.positionX.value = listenerPos.x; L.positionY.value = listenerPos.y; L.positionZ.value = listenerPos.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      const am = A.ambience, zone = engine.player ? engine.player.zone : 'trail';
      const inCab = am.inCab != null ? !!am.inCab : zone === 'cab'; A.roof = inCab ? 1 : 0; A.zone = zone;
      const hgt = clamp((listenerPos.y - 3) / 27, 0, 1), catwalk = zone === 'catwalk', openK = inCab ? clamp((am.doorOpen === false ? 0 : 0.5) + (am.windowsOpen || 0) * 0.15, 0, 1) : 1;
      const k = 1 - Math.exp(-dt * 2);
      const set = (param, v) => { param.value += (v - param.value) * k; };
      const hasRec = (key) => !!rec[key];
      // reverb space by zone: the cab's little room, or the valley (more of it up high)
      if (verb.outSend) { set(verb.outSend.gain, inCab ? 0.05 + 0.2 * openK * 0.5 : catwalk ? 0.5 : zone === 'stairs' ? 0.4 : 0.32); set(verb.cabSend.gain, inCab ? 0.55 : 0); }
      // rain
      const rainV = am.rain * (inCab ? 0.55 : 0.7);
      if (hasRec('rain')) { set(rec.rain.gain, rainV); set(rec.rainLP.frequency, inCab ? 1400 : 9000); set(beds.rain.out.gain, 0); set(beds.rain.roofG.gain, am.rain * (inCab ? 0.6 : 0)); }
      else { set(beds.rain.out.gain, am.rain * (inCab ? 0.35 : 0.5)); set(beds.rain.roofG.gain, am.rain * (inCab ? 1.6 : 0.2)); }
      // wind: gusts (a slow random walk around weather.wind); tree rustle low down, a whistle + moan round the cab and rails up high
      gustT -= dt; if (gustT <= 0) { gustTarget = clamp(am.wind * (0.45 + Math.random() * 0.9) + (Math.random() < 0.12 ? 0.3 * am.wind + 0.1 : 0), 0, 1.5); gustT = 1.2 + Math.random() * 4.5; }
      A.gust += (gustTarget - A.gust) * (1 - Math.exp(-dt / 1.1));
      const gn = clamp(A.gust / Math.max(0.15, am.wind), 0, 1.6), gf = 0.6 + 0.6 * gn;
      const windV = am.wind * (inCab ? 0.25 : 0.32) * gf;
      if (hasRec('wind')) { set(rec.wind.gain, windV); rec.windSrc.playbackRate.value = 0.94 + 0.08 * gn; set(beds.wind.out.gain, 0); } else set(beds.wind.out.gain, am.wind * (inCab ? 0.22 : 0.18) * gf);
      const forestness = inCab ? 0.12 : catwalk ? 0.4 : 1 - hgt * 0.5;
      beds.rustle.set(am.wind * gf * 0.24 * forestness * (1 - am.rain * 0.4), dt);
      const wh = Math.pow(Math.max(0, A.gust - 0.3), 2) * 0.9 * hgt * (inCab ? 0.25 + 0.4 * openK : catwalk ? 1.2 : 0.8);
      set(beds.wind.whistle.gain, Math.min(0.2, wh)); beds.wind.w1.frequency.value = 820 * (0.85 + 0.3 * A.gust); beds.wind.w2.frequency.value = 1240 * (0.88 + 0.26 * A.gust);
      set(beds.wind.moan.gain, Math.min(0.32, Math.max(0, A.gust - 0.2) * 0.52 * hgt * (inCab ? 0.6 : 1))); beds.wind.mo.frequency.value = 250 * (0.9 + 0.25 * A.gust);
      // radio static (a positioned bed at the radio)
      beds.radio.place(); beds.radio.set(am.radioStatic * 0.22, dt);
      // creek: the recording (drifting in speed so its short loop doesn't show) + a synthesized babble
      let cd = 999; const cp = engine.world && engine.world.layout && engine.world.layout.creek && engine.world.layout.creek.points;
      if (cp) for (let i = 0; i < cp.length; i += 3) { const d = Math.hypot(cp[i][0] - listenerPos.x, cp[i][2] - listenerPos.z); if (d < cd) cd = d; }
      const creekV = Math.max(am.creek || 0, 0.55 * Math.exp(-cd / 22));
      creekDrift += dt * (0.13 + 0.05 * Math.sin(creekDrift * 0.7));
      if (hasRec('creek')) { set(rec.creek.gain, creekV * 0.8); rec.creekSrc.playbackRate.value = 0.96 + 0.07 * (0.5 + 0.5 * Math.sin(creekDrift)); set(beds.creek.out.gain, 0); beds.creekSyn.set(creekV * 0.35, dt); }
      else { set(beds.creek.out.gain, creekV * 0.25); beds.creekSyn.set(creekV * 0.6, dt); }
      // night: crickets (the recording, or four synthesized ones); day insects + birds come from life()
      // (forest -> 0 hushes them too: bridge.js passes 0 while wildlife.silent, the Weeper near)
      const night = engine.sky ? 1 - engine.sky.dayFactor : 0, crick = 0.22 * night * (1 - am.rain * 0.8) * (inCab ? 0.4 : 1) * (1 - hgt * 0.4) * clamp(am.forest / 0.5, 0, 1);
      if (hasRec('crickets')) { set(rec.crickets.gain, crick); beds.crickets.set(0, dt); } else beds.crickets.set(crick * 0.5, dt);
      // the generator: positional, muffled with distance (and by the cab)
      beds.generator.place();
      const gp = anchor('IA_generator'), gd = gp ? gp.distanceTo(listenerPos) : 30;
      if (beds.generator.lp) beds.generator.lp.frequency.value = clamp(9000 * Math.exp(-gd / 28) * (inCab ? 0.5 : 1), 350, 9000);
      if (beds.generator.src) { const sp = am.genSputter || 0; beds.generator.src.playbackRate.value = 1 - sp * (0.08 + 0.1 * Math.random()); }
      beds.generator.set(am.generator * 0.3 * (1 - (am.genSputter || 0) * 0.5 * Math.random()), dt);
      // the cab: heater hiss, the stove's roar (and the percolator), the lamp's hum, the alarm clock
      const cabK = inCab ? 1 : zone === 'catwalk' ? 0.25 : 0;
      beds.heater.place(); beds.heater.set(am.heater * 0.09 * (inCab ? 1 : 0.3), dt);
      beds.stove.place(); beds.stove.set(am.stove * 0.12 * (inCab ? 1 : 0.3), dt);
      beds.hum.place(); beds.hum.set(am.lamp * 0.012 * cabK, dt);
      if (heard && am.stove > 0.05 && cabK > 0) { percT -= dt; if (percT <= 0) { const c = am.coffee || 0; const blup = c > 0.5; shot(sbuf('perc#' + (blup ? (Math.random() * 3) | 0 : 3)), beds.stove.g || bus.amb, { gain: blup ? 0.5 + c * 0.5 : 0.35, rate: 0.9 + Math.random() * 0.2 }); percT = blup ? 0.25 + Math.random() * (1.4 - c) : 1.5 + Math.random() * 3; } }
      clockTicks(heard ? am.clockTick * cabK : 0, k);
      if (heard) { life(dt, hgt, inCab); drops(dt); }
      releasePlays();
    },
  };
  const plays = [], PLAY_TTL = 20;   // no one-shot recipe runs longer than this (the coyote is 6 s, thunder 7 s)
  function releasePlays() { if (!plays.length) return; const t = now(); for (let i = plays.length - 1; i >= 0; i--) if (plays[i].at < t) { const r = plays[i]; r.g.disconnect(); if (r.p) r.p.disconnect(); plays.splice(i, 1); } }
  let gustT = 0, gustTarget = 0.3, creekDrift = Math.random() * 10, percT = 1, tickNext = 0, tickIdx = 0;
  function clockTicks(lv, k = 1) {
    const cg = beds.clock.g.gain; cg.value += (lv * 0.05 - cg.value) * k;
    if (!(lv > 0.01)) { tickNext = 0; return; }
    const cp = anchor('IA_clock'); if (cp && beds.clock.pan) { beds.clock.pan.positionX.value = cp.x; beds.clock.pan.positionY.value = cp.y; beds.clock.pan.positionZ.value = cp.z; }
    const t = now(); if (tickNext < t) tickNext = t + 0.05;
    while (tickNext < t + 0.25) { shot(sbuf('tick#' + (tickIdx++ % 2)), beds.clock.g, { t: tickNext, gain: 0.85 + Math.random() * 0.15 }); tickNext += 0.5 + (Math.random() - 0.5) * 0.004; }
  }
  // unlock on the first gesture
  if (typeof window !== 'undefined' && window.addEventListener) {
    const unlock = () => { api.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  }
  api._debug = { beds, verb, bus, sbank, sbuf, SOUNDS, get music() { return music; } };
  return api;
}
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
