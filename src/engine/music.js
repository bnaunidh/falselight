// FALSE LIGHT — the score. An adaptive, generative, original soundtrack in plain WebAudio.
//  • Instruments are pre-rendered into AudioBuffers with plain JS math (no AudioWorklet): a fingerpicked steel-string
//    guitar (extended Karplus-Strong: two polarisations, pluck position, fractional tuning, body resonances), a felt
//    piano (inharmonic partials, two-stage decay, detuned unison strings, a soft hammer), warm analog pads (three detuned
//    PolyBLEP saws per note, rendered as seamless loops and played through a slowly opening lowpass), a low bowed drone,
//    a sub swell, bowed metal, an FM brass cluster, a church-bell toll, breaths, drums. They render in idle slices after
//    start() (warm()), or all at once (prerenderAll(), which the tests time), or lazily the first time a note is needed.
//  • A look-ahead scheduler (0.2 s, on a 50 ms timer) asks the current mood's generator to plan phrases from scales and
//    chord progressions, with humanised timing and velocity and long silences: the ambience carries a lot of the time.
//  • Moods crossfade over 3-8 s (setMood); stingers play over them (sting). At most MAX_VOICES sources sound at once
//    (the quietest / oldest is stolen); every node a voice makes is stopped and disconnected when it ends.
//  • The bus: moods + stingers -> tape (a 9 kHz rolloff and a wow/flutter delay) -> dry + a generated convolution hall
//    -> the music volume (0.35 by default) -> out. Nothing is audible while the game is muted (and nothing is scheduled).
// This module also exports the small DSP kit audio.js uses for its own pre-rendered sounds and reverb spaces.

export const MAX_VOICES = 8;
export const MUSIC_DEFAULT_VOLUME = 0.35;
export const MOODS = ['title', 'day', 'dusk', 'night', 'cab', 'dread', 'chase', 'chill', 'silent'];
export const STINGS = ['seen', 'dawn', 'death', 'task', 'found'];
export const MUSIC_SR = 22050;              // the whole score is a warm, cassette-bandwidth thing: 11 kHz is plenty
const LOOKAHEAD = 0.2, TICK_MS = 50, PAD_LOOP = 3, DRONE_LOOP = 6, CHORD_CACHE = 10;
const DWELL = 1.5;        // a (non-urgent) mood change must be asked for this long before it happens (see setMood)
const IDLE_TICKS = 40;
const GAP = 12;           // a generator not asked to plan for this long (muted, a stalled tab) starts its arc afresh    // ~2 s of ticks with nothing audible and the timer stops (wake() restarts it)
const FADE = { chase: 3, dread: 3, silent: 5, title: 4, chill: 5, cab: 5, night: 6, day: 7, dusk: 8 };
const WOBBLE = { title: 1.1, day: 0.6, dusk: 0.8, night: 1.4, cab: 0.8, dread: 1.9, chase: 0.5, chill: 0.6, silent: 0.6 };
const VERB = { title: 0.42, day: 0.32, dusk: 0.38, night: 0.55, cab: 0.3, dread: 0.5, chase: 0.22, chill: 0.3, silent: 0.3 };

// ================================================================== DSP kit (plain JS)
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Deterministic PRNG (mulberry32): pre-renders are the same every run. */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** RBJ biquad coefficients [b0, b1, b2, a1, a2] (normalised). bandpass = 0 dB peak. */
export function bqc(type, f, Q, sr, dB = 0) {
  const w = TAU * clamp(f, 1, sr * 0.49) / sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Math.max(Q, 1e-3)), A = Math.pow(10, dB / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'peaking': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
    case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
    case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
    default: throw new Error('bqc: ' + type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** Run a biquad over x in place (transposed direct form II). */
export function bqRun(x, c, from = 0, to = x.length) {
  const [b0, b1, b2, a1, a2] = c; let z1 = 0, z2 = 0;
  for (let i = from; i < to; i++) {
    const v = x[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; x[i] = y;
    if ((i & 255) === 0 && z1 < 1e-20 && z1 > -1e-20 && z2 < 1e-20 && z2 > -1e-20) z1 = z2 = 0;   // no denormal tails in silences
  }
  return x;
}
/** One-pole lowpass in place. */
export function lp1(x, fc, sr) { const a = Math.exp(-TAU * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } return x; }
/** A 4096-point sine table (linear interpolation, about -100 dB error): for FM, where Math.sin per sample is the cost. */
const SIN_N = 4096, SINT = new Float64Array(SIN_N + 1); for (let i = 0; i <= SIN_N; i++) SINT[i] = Math.sin(TAU * i / SIN_N);
export function tsin(x) { let u = x * (SIN_N / TAU); u -= Math.floor(u / SIN_N) * SIN_N; const i = u | 0, f = u - i; return SINT[i] + (SINT[i + 1] - SINT[i]) * f; }
/** Two-sample polynomial band-limited step correction for a saw. */
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
export function dcBlock(x, r = 0.995) { let px = 0, py = 0; for (let i = 0; i < x.length; i++) { const v = x[i], y = v - px + r * py; px = v; py = y; x[i] = y; } return x; }
export function fadeEdges(x, sr, inS = 0.002, outS = 0.05) {
  const a = Math.max(1, Math.round(inS * sr)), b = Math.max(1, Math.round(outS * sr)), n = x.length;
  for (let i = 0; i < a && i < n; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / a);
  for (let i = 0; i < b && i < n; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / b);
  return x;
}
export function peakOf(x) { let p = 0; for (let i = 0; i < x.length; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > p) p = v; } return p; }
export function normPeak(x, peak) { const p = peakOf(x); if (p > 0) { const k = peak / p; for (let i = 0; i < x.length; i++) x[i] *= k; } return x; }
/** One damped partial (two-stage decay) added into out: a rotating phasor, no Math.sin per sample. */
export function addPartial(out, sr, f, amp, tau1, tau2 = tau1, w = 1, ph = 0, start = 0) {
  if (!(f > 0) || f >= sr / 2 || !(amp > 0)) return;
  const cw = Math.cos(TAU * f / sr), sw = Math.sin(TAU * f / sr); let re = Math.cos(ph), im = Math.sin(ph);
  const d1 = Math.exp(-1 / (tau1 * sr)), d2 = Math.exp(-1 / (tau2 * sr)); let e1 = amp * w, e2 = amp * (1 - w);
  const end = Math.min(out.length, start + Math.ceil(Math.max(tau1, tau2) * sr * 7));
  for (let i = start; i < end; i++) { out[i] += im * (e1 + e2); const r = re * cw - im * sw; im = re * sw + im * cw; re = r; e1 *= d1; e2 *= d2; }
}
/** A partial whose amplitude follows envFn(t) (evaluated every 64 samples, linearly interpolated). */
export function addPartialEnv(out, sr, f, amp, envFn, ph = 0, start = 0, end = out.length) {
  if (!(f > 0) || f >= sr / 2 || !(amp > 0)) return;
  const cw = Math.cos(TAU * f / sr), sw = Math.sin(TAU * f / sr); let re = Math.cos(ph), im = Math.sin(ph), e = amp * envFn(0);
  for (let i0 = start; i0 < end; i0 += 64) {
    const i1 = Math.min(end, i0 + 64), e1 = amp * envFn((i1 - start) / sr), de = (e1 - e) / (i1 - i0);
    for (let i = i0; i < i1; i++) { out[i] += im * e; e += de; const r = re * cw - im * sw; im = re * sw + im * cw; re = r; }
    e = e1;
  }
}
/** A Float32 AudioBuffer from channel arrays. */
export function toBuffer(ctx, chans, sr) {
  const n = Math.max(1, chans[0].length), b = ctx.createBuffer(chans.length, n, sr);
  chans.forEach((c, i) => { const d = b.getChannelData(i); if (c instanceof Float32Array) d.set(c); else for (let k = 0; k < c.length; k++) d[k] = c[k]; });
  return b;
}
/**
 * A generated convolution impulse response: three bands of noise decaying at their own RT60 (low / mid / high, split at
 * xover), a pre-delay, a build-up ramp (outdoor scattering takes a moment), discrete early reflections ([t, gain]),
 * an optional flutter echo between parallel walls ({ period, gain, count }), and smeared, darkened far echoes
 * ([t, gain, smear s]: a valley's mountainsides). Returns one Float32Array per channel, peak-normalised to 0.5.
 */
export function makeIR({ sr, dur, rt = [1.5, 1.2, 0.5], xover = [350, 3000], predelay = 0.01, build = 0.02, early = [], flutter = null, echoes = [], seed = 7, stereo = true, echoLP = 1600 }) {
  const len = Math.max(8, Math.round(dur * sr)), chans = [];
  for (let c = 0; c < (stereo ? 2 : 1); c++) {
    const R = rng(seed * 31 + c * 977), out = new Float32Array(len), p0 = Math.round(predelay * sr), nb = Math.max(1, Math.round(build * sr));
    const aL = Math.exp(-TAU * xover[0] / sr), aH = Math.exp(-TAU * xover[1] / sr);
    const dL = Math.pow(0.001, 1 / (rt[0] * sr)), dM = Math.pow(0.001, 1 / (rt[1] * sr)), dH = Math.pow(0.001, 1 / (rt[2] * sr));
    let lo = 0, lm = 0, eL = 1, eM = 1, eH = 1;
    for (let i = p0; i < len; i++) {
      const n = R() * 2 - 1; lo = (1 - aL) * n + aL * lo; lm = (1 - aH) * n + aH * lm;
      const k = i - p0, b = k < nb ? Math.sin(0.5 * Math.PI * k / nb) : 1;
      out[i] = (lo * 1.6 * eL + (lm - lo) * eM + (n - lm) * 0.7 * eH) * b;
      eL *= dL; eM *= dM; eH *= dH;
    }
    for (const [t, g] of early) {   // each reflection: a 1-2 ms burst, a little darker than the direct sound
      const k0 = Math.round((t + (c ? 0.0007 : 0)) * sr), m = Math.round(0.0015 * sr); let y = 0;
      for (let j = 0; j < m && k0 + j < len; j++) { y = 0.55 * y + 0.45 * (R() * 2 - 1); out[k0 + j] += g * y * (1 - j / m) * 2.2; }
    }
    if (flutter) for (let q = 1; q <= flutter.count; q++) {
      const k0 = Math.round((predelay + q * flutter.period) * sr), g = flutter.gain * Math.pow(0.72, q);
      for (let j = 0; j < 6 && k0 + j < len; j++) out[k0 + j] += g * (R() * 2 - 1) * (1 - j / 6);
    }
    for (const [t, g, smear] of echoes) {   // a far, soft, darkened copy of the sound: a mountainside answering
      const k0 = Math.round((t + (c ? 0.011 : 0)) * sr), m = Math.round(smear * sr), a = Math.exp(-TAU * echoLP / sr); let y = 0, y2 = 0;
      for (let j = 0; j < m * 3 && k0 + j < len; j++) {
        const env = j < m * 0.25 ? j / (m * 0.25) : Math.exp(-(j - m * 0.25) / m * 2.2);
        y = (1 - a) * (R() * 2 - 1) + a * y; y2 = (1 - a) * y + a * y2; out[k0 + j] += g * y2 * env * 3;
      }
    }
    chans.push(normPeak(out, 0.5));
  }
  return chans;
}

// ================================================================== instruments (plain-JS renderers)
/** One Karplus-Strong string (extended): pluck-position comb, 3-tap brightness loop filter, allpass fractional tuning. */
function ksPluck(out, sr, f0, t60, bright, beta, amp, R) {
  const N = sr / f0, L = Math.max(2, Math.floor(N - 1.1)), d = N - 1 - L, C = (1 - d) / (1 + d);
  const g0 = (1 + bright) / 2, g1 = (1 - bright) / 4, H = g0 + 2 * g1 * Math.cos(TAU * f0 / sr);
  const rho = Math.min(0.99985, Math.pow(0.001, 1 / (t60 * f0)) / H);
  const buf = new Float64Array(L), P = Math.max(1, Math.round(beta * L)), a = Math.exp(-TAU * 2600 / sr);
  let lp = 0, mean = 0;
  for (let i = 0; i < L; i++) { const tri = i < P ? i / P : (L - i) / (L - P); lp = (1 - a) * (R() * 2 - 1) + a * lp; buf[i] = tri * 0.7 + lp * 1.4; }
  for (let i = L - 1; i >= P; i--) buf[i] -= 0.55 * buf[i - P];
  for (let i = 0; i < L; i++) mean += buf[i] / L; for (let i = 0; i < L; i++) buf[i] -= mean;
  let idx = 0, s1 = 0, s2 = 0, apx = 0, apy = 0;
  for (let n = 0; n < out.length; n++) {
    const s = buf[idx], f = rho * (g1 * s + g0 * s1 + g1 * s2);
    apy = C * f + apx - C * apy; apx = f; buf[idx] = apy;
    out[n] += s * amp; s2 = s1; s1 = s; if (++idx >= L) idx = 0;
  }
}
/** A fingerpicked steel-string note (mono Float32Array at sr). */
export function renderGuitar(midi, sr = MUSIC_SR) {
  const R = rng(midi * 7919 + 13), f0 = mtof(midi);
  const dur = clamp(3.4 - (midi - 40) * 0.04, 1.6, 3.4), out = new Float64Array(Math.round(dur * sr));
  const t60 = clamp(Math.min(5.6 * Math.sqrt(82.4 / f0), dur * 1.5), 1.2, 5.6), bright = clamp(0.3 + (midi - 40) * 0.009, 0.3, 0.7), beta = 0.13 + R() * 0.06;
  ksPluck(out, sr, f0, t60, bright, beta, 1, R);
  ksPluck(out, sr, f0 * 1.0006, t60 * 1.35, bright * 0.85, beta, 0.45, R);   // the other polarisation: beating + a two-stage decay
  const nz = Math.round(0.004 * sr); let pv = 0, hp = 0;                       // a whisper of fingertip on the string
  for (let i = 0; i < nz; i++) { const n = R() * 2 - 1; hp = 0.75 * (hp + n - pv); pv = n; out[i] += hp * 0.06 * (1 - i / nz); }
  bqRun(out, bqc('peaking', 102, 2.2, sr, 7)); bqRun(out, bqc('peaking', 205, 1.6, sr, 4));   // air mode + top plate
  bqRun(out, bqc('highshelf', 6000, 0.7, sr, -5));
  dcBlock(out); fadeEdges(out, sr, 0.0015, 0.35);
  return Float32Array.from(normPeak(out, 0.7 - (midi - 40) * 0.004));
}
/** A felt piano note: inharmonic partials, soft hammer (dark), detuned unison on the low partials, two-stage decay. */
export function renderPiano(midi, sr = MUSIC_SR) {
  const R = rng(midi * 104729 + 7), f0 = mtof(midi);
  const dur = clamp(3.6 - (midi - 45) * 0.045, 1.6, 3.6), len = Math.round(dur * sr), out = new Float64Array(len);
  const B = 0.00012 * Math.pow(2, (midi - 48) / 14), felt = 950 + (midi - 48) * 16, K = Math.max(3, Math.min(11, Math.floor(3400 / f0)));
  for (let n = 1; n <= K; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n); if (fn > sr * 0.45) break;
    const a = Math.pow(n, -1.2) / (1 + Math.pow(fn / felt, 2)) * (Math.abs(Math.sin(Math.PI * n * 0.118)) + 0.12);
    const tau2 = clamp(Math.min(2.3 * Math.pow(261.6 / fn, 0.55), dur / 4.4), 0.08, 5), tau1 = tau2 * 0.15, str = n <= 3 ? 2 : 1;
    for (let s = 0; s < str; s++) {
      const det = str === 2 ? (s ? 1 : -1) * (0.3 + R() * 0.5) * 0.000578 : 0;   // ±(0.3-0.8) cent
      addPartial(out, sr, fn * (1 + det), a / str, tau1, tau2, 0.62, R() * TAU);
    }
  }
  const hz = Math.round(0.012 * sr); let y = 0; const ah = Math.exp(-TAU * 500 / sr);   // the felt hammer: a soft low thock
  for (let i = 0; i < hz; i++) { y = (1 - ah) * (R() * 2 - 1) + ah * y; out[i] += y * 0.5 * Math.exp(-i / (0.003 * sr)); }
  dcBlock(out); fadeEdges(out, sr, 0.004, 0.3);
  return Float32Array.from(normPeak(out, 0.6));
}
/** One pad note as a seamless loop: three detuned PolyBLEP saws on frequencies that repeat exactly every PAD_LOOP s. */
export function renderPadNote(midi, sr = MUSIC_SR, L = PAD_LOOP) {
  const len = Math.round(L * sr), out = new Float32Array(len), f = mtof(midi), q = (x) => Math.max(1, Math.round(x * L)) / L, R = rng(midi * 31337 + 5);
  const cents = [-7, 0.5, 6.5]; let prev = 0;
  for (let k = 0; k < 3; k++) {
    let fk = q(f * Math.pow(2, cents[k] / 1200)); if (fk <= prev) fk = prev + 1 / L; prev = fk;
    const dt0 = fk / sr, vw = TAU / len; let p = R(), c = Math.cos(R() * TAU), s = Math.sin(R() * TAU);
    const cw = Math.cos(vw), sw = Math.sin(vw);   // a slow analog drift (1 cycle per loop, ±1.5 cents): still exactly periodic
    for (let n = 0; n < len; n++) {
      const dt = dt0 * (1 + 0.00087 * s);
      out[n] += (2 * p - 1 - blep(p, dt)) * 0.3333;
      p += dt; if (p >= 1) p -= 1;
      const r = c * cw - s * sw; s = c * sw + s * cw; c = r;
    }
  }
  return out;
}
/** A low bowed-string drone loop: Helmholtz saw + rosin noise at the slip, body formants, a slow wavering; periodic. */
export function renderDrone(midi, sr = MUSIC_SR, L = DRONE_LOOP) {
  const len = Math.round(L * sr), lead = Math.round(0.25 * sr), x = new Float64Array(len + lead), f = Math.max(1, Math.round(mtof(midi) * L)) / L, R = rng(midi * 7 + 99);
  const dt0 = f / sr; let p = 0, dt = dt0, amp = 1;
  for (let n = 0; n < len + lead; n++) {
    if ((n & 63) === 0) { const u = TAU * n / len; dt = dt0 * (1 + 0.0013 * Math.sin(5 * u + 1.1)); amp = 1 + 0.22 * Math.sin(u + 0.4) + 0.12 * Math.sin(2 * u + 2.2); }
    const bow = (R() * 2 - 1) * (p < 0.08 ? 0.5 : 0.1);
    x[n] = ((2 * p - 1 - blep(p, dt)) * 0.8 + bow) * amp;
    p += dt; if (p >= 1) p -= 1;
  }
  bqRun(x, bqc('peaking', 280, 1.4, sr, 6)); bqRun(x, bqc('peaking', 720, 2, sr, 4)); bqRun(x, bqc('peaking', 1500, 2.5, sr, 3)); bqRun(x, bqc('lowpass', 2000, 0.6, sr));
  return Float32Array.from(normPeak(x.subarray(lead), 0.6));   // skip the lead-in: the filters are in their steady state
}
/** A sub-bass sine loop (D1 with a touch of 2nd/3rd harmonic so small speakers hint at it). */
export function renderSub(sr = MUSIC_SR, L = DRONE_LOOP) {
  const len = Math.round(L * sr), out = new Float32Array(len), f = Math.round(36.71 * L) / L;
  const cw = Math.cos(TAU * f / sr), sw = Math.sin(TAU * f / sr); let c = 1, s = 0;
  for (let n = 0; n < len; n++) { const s2 = 2 * s * c, c2 = c * c - s * s; out[n] = 0.6 * (s + 0.12 * s2 + 0.05 * (s2 * c + c2 * s)); const r = c * cw - s * sw; s = c * sw + s * cw; c = r; }
  return out;
}
export function renderBreath(v, sr = MUSIC_SR) {
  const R = rng(900 + v * 17), len = Math.round(3.3 * sr), x = new Float64Array(len), inh = 1.0 + R() * 0.3, gap = 0.25, exh = 1.5 + R() * 0.3;
  for (let i = 0; i < len; i++) {
    const t = i / sr; let e = 0;
    if (t < inh) e = 0.4 * Math.pow(Math.sin(Math.PI * t / inh), 1.6);
    else if (t > inh + gap && t < inh + gap + exh) { const u = (t - inh - gap) / exh; e = Math.pow(Math.sin(Math.PI * Math.sqrt(u)), 1.3); }
    x[i] = (R() * 2 - 1) * e;
  }
  bqRun(x, bqc('highpass', 180, 0.7, sr)); bqRun(x, bqc('peaking', 520 + v * 60, 2.5, sr, 8)); bqRun(x, bqc('peaking', 1250, 3, sr, 5));
  bqRun(x, bqc('peaking', 2500, 3, sr, 3)); bqRun(x, bqc('lowpass', 3200, 0.7, sr));
  return Float32Array.from(normPeak(x, 0.55));
}
/** Bowed metal (a bowed cymbal / saw blade): split inharmonic modes swelling in one by one, with a thread of bow noise. */
export function renderMetal(v, sr = MUSIC_SR) {
  const R = rng(4242 + v), dur = 5.8, len = Math.round(dur * sr), out = new Float64Array(len), f0 = [430, 505, 377][v % 3];
  const ratios = [1, 1.506, 2.013, 2.524, 3.26, 4.07], amps = [0.7, 1, 0.8, 0.55, 0.45, 0.3];
  for (let k = 0; k < ratios.length; k++) for (let s = 0; s < 2; s++) {
    const f = f0 * ratios[k] + (s ? 1 : -1) * (0.3 + R() * 1.2); if (f > sr * 0.45) continue;
    const att = 1.2 + k * 0.45 + R(), wob = 0.13 + R() * 0.2, wp = R() * TAU;
    addPartialEnv(out, sr, f, amps[k] * 0.5, (t) => { const u = Math.min(1, t / att); return u * u * (3 - 2 * u) * (t > dur - 1.8 ? 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (t - dur + 1.8) / 1.8)) : 1) * (1 + 0.35 * Math.sin(TAU * wob * t + wp)); }, R() * TAU);
  }
  const nb = new Float64Array(len); for (let i = 0; i < len; i++) { const t = i / sr; nb[i] = (R() * 2 - 1) * Math.min(1, t / 2) * (t > dur - 1.8 ? (dur - t) / 1.8 : 1); }
  bqRun(nb, bqc('bandpass', f0 * 2.013, 14, sr)); for (let i = 0; i < len; i++) out[i] += nb[i] * 0.5;
  fadeEdges(out, sr, 0.01, 0.1);
  return Float32Array.from(normPeak(out, 0.55));
}
/** A low church-bell toll (hum, prime, minor tierce, quint, nominal...; each partial split into a slow warble). */
export function renderBell(sr = MUSIC_SR) {
  const R = rng(1983), len = Math.round(6.5 * sr), out = new Float64Array(len), f = mtof(50);
  const P = [[0.5, 0.55, 9], [1, 0.8, 6], [1.19, 0.5, 5], [1.5, 0.22, 3], [2, 0.5, 3.5], [2.51, 0.18, 2], [2.66, 0.15, 1.6], [3.01, 0.12, 1.2], [4.0, 0.06, 0.8]];
  for (const [r, a, t60] of P) for (let s = 0; s < 2; s++) addPartial(out, sr, f * r + (s ? 0.5 : -0.5) * (0.4 + R()), a * 0.5, t60 / 6.91, t60 / 6.91, 1, R() * TAU);
  let y = 0; for (let i = 0; i < 0.015 * sr; i++) { y = 0.8 * y + 0.2 * (R() * 2 - 1); out[i] += y * 1.5 * (1 - i / (0.015 * sr)); }
  fadeEdges(out, sr, 0.002, 0.4);
  return Float32Array.from(normPeak(out, 0.65));
}
export function renderChime(midi, sr = MUSIC_SR) {
  const R = rng(midi + 555), len = Math.round(2.8 * sr), out = new Float64Array(len), f = mtof(midi);
  [[1, 1, 2.6], [2.0, 0.3, 1.4], [3.01, 0.15, 0.9], [4.16, 0.08, 0.5], [5.43, 0.04, 0.3]].forEach(([r, a, t]) => addPartial(out, sr, f * r, a, t / 6.91 * 1.4, t / 6.91 * 1.4, 1, R() * TAU));
  fadeEdges(out, sr, 0.003, 0.3);
  return Float32Array.from(normPeak(out, 0.5));
}
/** Low drum (a taiko-ish tom): a pitch-dropping membrane, its second mode, a felt thump and a skin slap. */
export function renderHit(sr = MUSIC_SR) {
  const R = rng(77), len = Math.round(0.9 * sr), out = new Float64Array(len); let p1 = 0, p2 = 0, y = 0, fe = 70, a = 1, b = 0.35, c = 2.5, d = 0.15;
  const kf = Math.exp(-1 / (0.05 * sr)), ka = Math.exp(-1 / (0.28 * sr)), kb = Math.exp(-1 / (0.09 * sr)), kc = Math.exp(-1 / (0.02 * sr)), kd = Math.exp(-1 / (0.004 * sr));
  for (let i = 0; i < len; i++) {
    const f = 48 + fe; fe *= kf;
    p1 += TAU * f / sr; p2 += TAU * f * 1.52 / sr; y = 0.9 * y + 0.1 * (R() * 2 - 1);
    out[i] = Math.sin(p1) * a + Math.sin(p2) * b + y * c + (R() * 2 - 1) * d; a *= ka; b *= kb; c *= kc; d *= kd;
  }
  fadeEdges(out, sr, 0.0008, 0.1);
  return Float32Array.from(normPeak(out, 0.7));
}
export function renderClank(sr = MUSIC_SR) {
  const R = rng(91), len = Math.round(1.3 * sr), out = new Float64Array(len), f = 262;
  [[1, 1, 1.1], [2.41, 0.7, 0.8], [3.93, 0.5, 0.6], [5.39, 0.35, 0.4], [6.97, 0.25, 0.3]].forEach(([r, a, t]) => addPartial(out, sr, f * r, a, t / 6.91, t / 6.91, 1, R() * TAU));
  for (let i = 0; i < 0.004 * sr; i++) out[i] += (R() * 2 - 1) * 0.6;
  fadeEdges(out, sr, 0.0005, 0.1);
  return Float32Array.from(normPeak(out, 0.55));
}
/** A short dark analog bass pulse for the chase ostinato (saw + square through a resonant SVF with a snappy envelope). */
export function renderBass(midi, sr = MUSIC_SR) {
  const len = Math.round(0.42 * sr), out = new Float64Array(len), f = mtof(midi), dt = f / sr; let p = 0, q = 0.5, ic1 = 0, ic2 = 0, g = 0, a1 = 0, a2 = 0, a3 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if ((i & 15) === 0) { const fc = 160 + 1500 * Math.exp(-t / 0.055); g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr); const k = 1 / 2.8; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const saw = 2 * p - 1 - blep(p, dt), sq = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(q, dt);
    const x = (0.6 * saw + 0.4 * sq) * Math.min(1, t / 0.003) * Math.exp(-t / 0.16);
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3; ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    out[i] = v2 + 0.5 * Math.sin(TAU * f * t) * Math.exp(-t / 0.2);
    p += dt; if (p >= 1) p -= 1; q = p + 0.5; if (q >= 1) q -= 1;
  }
  fadeEdges(out, sr, 0.001, 0.06);
  return Float32Array.from(normPeak(out, 0.6));
}
/** A dissonant FM brass swell (1:1 carrier:modulator, index following the swell), cut short at the top. */
export function renderBrass(notes, sr = MUSIC_SR) {
  const R = rng(notes.reduce((a, b) => a * 31 + b, 7)), dur = 3.3, len = Math.round(dur * sr), out = new Float64Array(len);
  for (const m of notes) {
    const f = mtof(m) * Math.pow(2, (R() * 6 - 3) / 1200); let ph = R() * TAU, sw = 0, I = 0.4, w = TAU * f / sr;
    for (let i = 0; i < len; i++) {
      if ((i & 31) === 0) { const t = i / sr; sw = t < 2.5 ? Math.pow(t / 2.5, 2.2) : t < 3.0 ? 1 : Math.max(0, 1 - (t - 3.0) / 0.12); w = TAU * f * (1 + 0.004 * sw * Math.sin(TAU * 5.2 * t)) / sr; I = 0.4 + 3.4 * Math.pow(sw, 1.5); }
      ph += w; if (ph > TAU) ph -= TAU;
      out[i] += tsin(ph + I * tsin(ph)) * sw / notes.length;   // 1:1 FM: carrier and modulator share the phase
    }
  }
  lp1(out, 3000, sr); for (let i = 0; i < len; i++) out[i] = Math.tanh(out[i] * 1.6);
  fadeEdges(out, sr, 0.002, 0.02);
  return Float32Array.from(normPeak(out, 0.55));
}
/** 'seen': a reversed dissonant cluster swelling into a hard cut, then a sub boom and a far high ping. */
export function renderSeen(sr = MUSIC_SR) {
  const R = rng(666), T = 1.45, len = Math.round(3.6 * sr), out = new Float64Array(len), cut = Math.round(T * sr);
  const cl = [62, 63, 68, 69, 75];
  for (const m of cl) for (const [r, a] of [[1, 1], [2, 0.4], [3, 0.2]]) {
    const f = mtof(m) * r * (1 + 0.0002 * r * r), cw = Math.cos(TAU * f / sr), sw = Math.sin(TAU * f / sr), k = Math.exp(1 / (0.33 * sr)); let re = 1, im = 0, e = a * 0.3 * Math.exp(-cut / (0.33 * sr));
    for (let i = 0; i < cut; i++) { out[i] += im * e; e *= k; const q = re * cw - im * sw; im = re * sw + im * cw; re = q; }   // a reversed decay: swells up to the cut
  }
  const nb = new Float64Array(cut), kn = Math.exp(1 / (0.28 * sr)); let en = Math.exp(-cut / (0.28 * sr)); for (let i = 0; i < cut; i++) { nb[i] = (R() * 2 - 1) * en; en *= kn; }
  bqRun(nb, bqc('bandpass', 2200, 1.2, sr)); for (let i = 0; i < cut; i++) out[i] += nb[i] * 0.5;
  for (let i = Math.max(0, cut - Math.round(0.003 * sr)); i < cut; i++) out[i] *= (cut - i) / (0.003 * sr);   // the hard cut
  let ph = 0, y = 0, e1 = 1, e2 = 1.2; const k1 = Math.exp(-1 / (0.9 * sr)), k2 = Math.exp(-1 / (0.05 * sr));
  for (let i = cut; i < len; i++) {
    const t = (i - cut) / sr; ph += TAU * (32 + 26 * Math.exp(-t / 0.25)) / sr; y = 0.85 * y + 0.15 * (R() * 2 - 1);
    out[i] += 0.9 * Math.sin(ph) * e1 * Math.min(1, t / 0.004) + y * e2; e1 *= k1; e2 *= k2;
  }
  addPartial(out, sr, mtof(86), 0.08, 0.5, 0.5, 1, 0, cut); addPartial(out, sr, mtof(87) * 1.001, 0.07, 0.45, 0.45, 1, 1, cut);
  addPartial(out, sr, mtof(38), 0.25, 0.25, 0.9, 0.5, 0, cut); addPartial(out, sr, mtof(39), 0.22, 0.25, 0.9, 0.5, 2, cut);
  fadeEdges(out, sr, 0.01, 0.3);
  return Float32Array.from(normPeak(out, 0.7));
}

// ================================================================== the music: keys, progressions, the theme
const SC = { dDorian: [2, 4, 5, 7, 9, 11, 0], bbMajor: [10, 0, 2, 3, 5, 7, 9], gLydian: [7, 9, 11, 1, 2, 4, 6] };
const inScale = (m, sc) => sc.includes(((m % 12) + 12) % 12);
const scaleNotes = (sc, lo, hi) => { const a = []; for (let m = lo; m <= hi; m++) if (inScale(m, sc)) a.push(m); return a; };
// phrase moods: guitar-led (a pad under it), chord progressions in a modal key, arpeggios / motifs / long rests
const PHRASE = {
  day: {   // D dorian: bittersweet, open
    bpm: 66, scale: SC.dDorian, mel: [57, 76], guitarLv: 0.55, padP: 0.8, padLv: 0.3, padCut: [380, 1300], piano: 0,
    tex: { arp: 0.4, motif: 0.3 }, active: [70, 150], quiet: [25, 70], bars: 2,
    progs: [
      [{ g: [50, 57, 60, 64, 65], p: [50, 57, 60, 64] }, { g: [43, 50, 59, 64], p: [55, 59, 62, 64] }, { g: [41, 48, 57, 64], p: [53, 57, 60, 64] }, { g: [40, 48, 55, 62], p: [48, 55, 62, 64] }],
      [{ g: [45, 52, 55, 60], p: [52, 55, 60, 64] }, { g: [50, 57, 62, 64, 65], p: [50, 57, 62, 65] }, { g: [48, 55, 62, 64], p: [48, 55, 62, 64] }, { g: [43, 50, 59, 62, 64], p: [55, 59, 62, 64] }],
    ],
  },
  dusk: {  // B-flat major, lower and warmer, fewer notes; some of it on the piano
    bpm: 56, scale: SC.bbMajor, mel: [53, 70], guitarLv: 0.5, padP: 0.9, padLv: 0.32, padCut: [300, 900], piano: 0.3,
    tex: { arp: 0.35, motif: 0.15 }, active: [60, 120], quiet: [30, 80], bars: 2,
    progs: [[{ g: [46, 53, 57, 62], p: [46, 53, 57, 62] }, { g: [43, 50, 57, 58], p: [50, 53, 57, 58] }, { g: [46, 51, 55, 57], p: [39, 46, 55, 57] }, { g: [41, 48, 55, 57], p: [48, 53, 55, 57] }]],
  },
  chill: { // G lydian: warm, gentle, the raised fourth
    bpm: 70, scale: SC.gLydian, mel: [59, 79], guitarLv: 0.52, padP: 1, padLv: 0.3, padCut: [500, 1800], piano: 0,
    tex: { arp: 0.6, motif: 0.3 }, active: [100, 200], quiet: [20, 45], bars: 2,
    progs: [[{ g: [43, 50, 54, 57, 59], p: [55, 59, 62, 66] }, { g: [43, 52, 57, 61, 64], p: [57, 61, 64, 67] }, { g: [40, 47, 54, 55, 59], p: [52, 55, 59, 66] }, { g: [42, 50, 54, 57, 62], p: [54, 57, 62, 64] }]],
  },
};
// arpeggio figures over 2 bars (beats, index into the chord voicing: 0 = bass)
const ARPS = [
  [[0, 0], [1.5, 2], [2.5, 3], [4, 1], [5.5, 3], [6.5, 2]],
  [[0, 0], [1, 2], [2, 3], [3, 4], [4.5, 3]],
  [[0, 0], [0.5, 1], [1.5, 3], [3, 2], [4, 0], [5, 4]],
  [[0, 0], [2, 3], [3.5, 2], [6, 4]],
  [[0, 0], [0.03, 2], [0.06, 3], [0.09, 4]],
];
const RHYTHMS = [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 2]], [[0.5, 0.5], [1, 1], [2, 1], [3, 3]], [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5], [4, 3]], [[0, 2], [2, 2]]];
// the title theme (D dorian, 58 bpm): 8 bars of melody [midi, beats] (null = rest) over these chords
const TITLE = {
  bpm: 58,
  chords: [{ g: [50, 57, 60, 64, 65], p: [50, 57, 60, 64] }, { g: [43, 50, 59, 64], p: [55, 59, 62, 64] }, { g: [45, 52, 55, 60], p: [52, 55, 60, 64] }, { g: [48, 55, 62, 64], p: [48, 55, 62, 64] },
    { g: [50, 57, 60, 64, 65], p: [50, 57, 60, 64] }, { g: [43, 50, 59, 62], p: [55, 59, 62, 67] }, { g: [41, 48, 57, 64], p: [53, 57, 60, 64] }, { g: [50, 57, 62, 64], p: [50, 57, 62, 64] }],
  mel: [[[69, 1], [74, 1], [76, 1.5], [77, 0.5]], [[76, 3], [null, 1]], [[72, 1], [74, 1], [72, 0.5], [71, 0.5], [69, 1]], [[67, 1], [69, 3]],
    [[69, 1], [74, 1], [76, 1], [81, 1]], [[79, 2], [77, 1], [76, 1]], [[74, 1.5], [76, 0.5], [72, 1], [71, 1]], [[74, 4]]],
};
const NIGHT = { active: [50, 100], quiet: [20, 50], droneSets: [[38, 45], [38, 51]], droneLv: 0.42, pcs: [2, 3, 8, 9, 1, 5], range: [60, 86], vel: [0.3, 0.52], gap: [5, 15], dyad: 0.3, dyadIv: [1, 11, 6], breath: [16, 38], pad: null };
const CAB = { active: [45, 90], quiet: [25, 60], droneSets: [[38, 45]], droneLv: 0.26, pcs: [2, 5, 9, 0, 4, 7], range: [55, 79], vel: [0.26, 0.42], gap: [6, 14], dyad: 0.2, dyadIv: [7, 9, 5], breath: null, pad: { chord: [50, 53, 57, 64], p: 0.35, lv: 0.2, cut: [300, 700] } };
const DREAD = { cluster: [50, 51, 56, 57], lowPiano: [38, 39] };
const CHASE = { bpm: 124, roots: [38, 38, 39, 38, 38, 38, 41, 39], brass: [[50, 51, 56], [62, 63, 68]], bass: [38, 39, 41, 50, 51, 53] };
const DAWN = { pad: [50, 57, 62, 66], strum: [50, 57, 62, 66, 69, 76], chime: 81 };
const FOUND = [62, 64, 69, 74];
const TASK = [81, 86];

/** Every buffer key the score can ask for (the warm-up list). */
function allKeys() {
  const g = new Set(), p = new Set(), pn = new Set();
  for (const C of Object.values(PHRASE)) { for (const pr of C.progs) for (const ch of pr) { ch.g.forEach((m, i) => { g.add(m); if (C.piano) p.add(i === 0 ? m + 12 : m); }); ch.p.forEach((m) => pn.add(m)); } scaleNotes(C.scale, C.mel[0], C.mel[1]).forEach((m) => { g.add(m); if (C.piano) p.add(m); }); }
  for (const ch of TITLE.chords) { ch.g.forEach((m) => g.add(m)); ch.p.forEach((m) => pn.add(m)); }
  for (const bar of TITLE.mel) for (const [m] of bar) if (m) { p.add(m); g.add(m - 12); }
  for (const C of [NIGHT, CAB]) { for (let m = C.range[0]; m <= C.range[1]; m++) if (C.pcs.includes(m % 12)) p.add(m); if (C.pad) C.pad.chord.forEach((m) => pn.add(m)); }
  DREAD.cluster.forEach((m) => pn.add(m)); DREAD.lowPiano.forEach((m) => p.add(m)); DAWN.pad.forEach((m) => pn.add(m)); DAWN.strum.forEach((m) => g.add(m)); FOUND.forEach((m) => g.add(m));
  const K = [...[...g].map((m) => 'g:' + m), ...[...p].map((m) => 'p:' + m), ...[...pn].map((m) => 'pn:' + m),
    ...new Set([...NIGHT.droneSets, ...CAB.droneSets].flat().map((m) => 'dr:' + m)), 'sub', 'br:0', 'br:1', 'br:2', 'bm:0', 'bm:1', 'bell', 'c:81', 'c:86', 'hit', 'clank',
    ...CHASE.bass.map((m) => 'bs:' + m), ...CHASE.brass.map((b) => 'fm:' + b.join(',')), 'seen'];
  return K;
}
export const MUSIC_KEYS = allKeys();

/**
 * pickMood(s): the mood for a game state. s = { state, phase: 'day1'|'night1'|..., hour, inCab, sitting,
 * weeper: weeper.state ('sitting'|'hush'|'lookup'|'seen_day'|'screaming'|'coming'|'stairs'|'door'|'hunting'|'gone'|'caught'),
 * weeperDist (m), current (the mood playing now: the chase radius has hysteresis) }. Returns a mood name, or null to keep
 * whatever is playing (paused, menus). Note bridge.update() only runs in 'play': the other states are set explicitly.
 */
export function pickMood(s = {}) {
  const st = s.state || 'play';
  if (st === 'title' || st === 'end') return 'title';   // the end card: the theme comes back after the 'dawn' sting
  if (st === 'dead' || st === 'transition') return 'silent';
  if (st !== 'play') return null;
  const w = s.weeper || 'sitting', d = s.weeperDist ?? 999, chaseR = s.current === 'chase' ? 90 : 70;
  if (w === 'hunting' || w === 'stairs' || (w === 'coming' && d < chaseR)) return 'chase';
  if (['coming', 'screaming', 'door', 'lookup', 'seen_day'].includes(w)) return 'dread';
  if (w === 'hush') return 'silent';   // the crying stops: so does everything else
  const night = /night/.test(s.phase || '');
  if (s.sitting && !night) return 'chill';   // a warm lydian guitar would undo the night: sitting out at night stays night
  if (night) return s.inCab ? 'cab' : 'night';
  const h = s.hour ?? 12;
  return h >= 18.75 ? 'dusk' : 'day';
}

// ================================================================== the engine
/**
 * createMusic({ ctx, out, audible?, timer?, sr? }) -> music
 *   ctx: an AudioContext (or OfflineAudioContext), out: the node the music bus feeds, audible(): false while the game is
 *   muted (nothing is scheduled then), timer: false to drive tick() / tickUntil() yourself (tests, offline renders).
 */
export function createMusic({ ctx, out, audible = () => true, timer = true, sr = null, offline = null } = {}) {
  if (offline == null) offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  if (offline) timer = false;
  const SR = sr || MUSIC_SR;
  const S = { mood: 'silent', vol: MUSIC_DEFAULT_VOLUME, acts: [], cur: null, queue: [], voices: [], vnow: null, id: 0, timer: null, warmT: null, pending: null, idle: 0,
    stats: { started: 0, stolen: 0, peak: 0, skipped: 0, events: 0, renderMs: 0, rendered: 0 } };
  const now = () => (S.vnow != null ? S.vnow : ctx.currentTime);
  // ---- graph: moods + stings -> tape (rolloff + wow/flutter) -> dry + hall -> volume -> out
  const g = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
  const vol = g(S.vol, out);
  const pre = g(1), tapeLP = ctx.createBiquadFilter(); tapeLP.type = 'lowpass'; tapeLP.frequency.value = 9000; tapeLP.Q.value = 0.5;
  const wob = ctx.createDelay(0.1); wob.delayTime.value = 0.02;
  pre.connect(tapeLP); tapeLP.connect(wob); wob.connect(vol);
  const lfoW = ctx.createOscillator(), lfoF = ctx.createOscillator(); lfoW.frequency.value = 0.33; lfoF.frequency.value = 5.7;
  const depW = g(0.0011 * WOBBLE.silent), depF = g(0.00003); lfoW.connect(depW); lfoF.connect(depF); depW.connect(wob.delayTime); depF.connect(wob.delayTime);
  lfoW.start(); lfoF.start();
  const verbSend = g(VERB.silent); let verb = null;
  if (typeof ctx.createConvolver === 'function') {
    verb = ctx.createConvolver();
    try { verb.buffer = toBuffer(ctx, makeIR({ sr: ctx.sampleRate, dur: 3.4, rt: [3.0, 2.6, 1.1], xover: [300, 2800], predelay: 0.028, build: 0.06, seed: 58,
      early: [[0.011, 0.35], [0.019, 0.28], [0.027, 0.22], [0.041, 0.18]] }), ctx.sampleRate); } catch (e) { verb = null; }
    if (verb) { wob.connect(verbSend); verbSend.connect(verb); verb.connect(vol); }
  }
  const stingBus = g(1, pre);

  // ---- buffers: rendered once (idle slices / prerenderAll / lazily)
  const bank = new Map(), raw = new Map(), chordKeys = [];
  const RENDER = {
    g: (m) => renderGuitar(m, SR), p: (m) => renderPiano(m, SR), pn: (m) => renderPadNote(m, SR), dr: (m) => renderDrone(m, SR),
    c: (m) => renderChime(m, SR), bs: (m) => renderBass(m, SR), br: (v) => renderBreath(v, SR), bm: (v) => renderMetal(v, SR),
    sub: () => renderSub(SR), bell: () => renderBell(SR), hit: () => renderHit(SR), clank: () => renderClank(SR), seen: () => renderSeen(SR),
    fm: (a) => renderBrass(a, SR),
  };
  function renderKey(key) {
    const t0 = perfNow(); const [k, arg] = key.split(':');
    const f = RENDER[k]; if (!f) throw new Error('music: no renderer for ' + key);
    const a = arg == null ? undefined : arg.includes(',') ? arg.split(',').map(Number) : Number(arg);
    const data = f(a);
    if (k === 'pn' || k === 'dr') raw.set(key, data); else bank.set(key, toBuffer(ctx, [data], SR));
    S.stats.renderMs += perfNow() - t0; S.stats.rendered++;
  }
  const buf = (key) => { if (!bank.has(key)) renderKey(key); return bank.get(key); };
  const rawOf = (key) => { if (!raw.has(key)) renderKey(key); return raw.get(key); };
  /** Stereo chord / drone-set loop from mono note loops: each channel reads each note from its own offset (width). */
  function stack(prefix, notes, peak) {
    const key = prefix + notes.join(',');
    if (bank.has(key)) return bank.get(key);
    const src = notes.map((m) => rawOf(prefix.slice(0, 2) + ':' + m)), len = src[0].length, L = new Float32Array(len), Rr = new Float32Array(len), R = rng(hashStr(key));
    src.forEach((x) => { const oL = (R() * len) | 0, oR = (R() * len) | 0; for (let i = 0; i < len; i++) { L[i] += x[(i + oL) % len]; Rr[i] += x[(i + oR) % len]; } });
    const k = peak / Math.max(peakOf(L), peakOf(Rr), 1e-9); for (let i = 0; i < len; i++) { L[i] *= k; Rr[i] *= k; }
    const b = toBuffer(ctx, [L, Rr], SR); bank.set(key, b);
    if (prefix === 'pn|') { chordKeys.push(key); while (chordKeys.length > CHORD_CACHE) bank.delete(chordKeys.shift()); }
    return b;
  }
  const chordBuf = (notes) => stack('pn|', notes, 0.5), droneBuf = (notes) => stack('dr|', notes, 0.55);
  /** A rolled chord / rising figure as one buffer, summed from the guitar notes (one voice instead of six). */
  function strumBuf(notes, spacing, seed = 1) {
    const key = 'st|' + notes.join(',') + '|' + spacing; if (bank.has(key)) return bank.get(key);
    const R = rng(seed + notes.length), parts = notes.map((m) => buf('g:' + m).getChannelData(0)), offs = notes.map((_, i) => Math.round((i * spacing + (i ? (R() - 0.5) * spacing * 0.3 : 0)) * SR));
    const len = Math.max(...parts.map((p, i) => p.length + offs[i])), x = new Float32Array(len);
    parts.forEach((p, i) => { const v = 0.75 + R() * 0.25; for (let k = 0; k < p.length; k++) x[k + offs[i]] += p[k] * v; });
    normPeak(x, 0.7); const b = toBuffer(ctx, [x], SR); bank.set(key, b); return b;
  }
  let warmList = MUSIC_KEYS.slice();
  function warm(budgetMs = 6) {
    const t0 = perfNow();
    while (warmList.length && perfNow() - t0 < budgetMs) { const k = warmList.shift(); if (!bank.has(k) && !raw.has(k)) renderKey(k); }
    return !warmList.length;
  }
  function prerenderAll() { const t0 = perfNow(); warm(1e9); return perfNow() - t0; }
  function bumpWarm(mood) {   // what a mood needs goes to the front of the warm-up queue
    const want = { title: ['g:', 'p:', 'pn:'], day: ['g:', 'pn:'], dusk: ['g:', 'pn:', 'p:'], chill: ['g:', 'pn:'], night: ['dr:', 'p:', 'br:'], cab: ['dr:', 'p:', 'pn:'], dread: ['pn:5', 'sub', 'bm:', 'p:3'], chase: ['bs:', 'hit', 'clank', 'fm:', 'sub'] }[mood] || [];
    const hit = warmList.filter((k) => want.some((w) => k.startsWith(w))); warmList = [...hit, ...warmList.filter((k) => !hit.includes(k))];
  }

  // ---- voices
  class Env {   // a gain param plus a JS-side model of its linear automation (so a release starts from the right level)
    constructor(p) { this.p = p; this.pts = [[0, 0]]; }
    at(t) { const P = this.pts; if (t <= P[0][0]) return P[0][1]; for (let i = P.length - 1; i >= 0; i--) if (P[i][0] <= t) { const n = P[i + 1]; return n ? P[i][1] + (n[1] - P[i][1]) * (t - P[i][0]) / Math.max(1e-6, n[0] - P[i][0]) : P[i][1]; } return 0; }
    start(t, v) { this.pts = [[t, v]]; this.p.setValueAtTime(v, t); }
    ramp(t, v) { this.pts.push([t, v]); this.p.linearRampToValueAtTime(v, t); }
    /**
     * Freeze the envelope at t (>= now) and return its level there. cancelScheduledValues(t) alone would also delete a
     * ramp that is still in progress, and the param would snap back to that ramp's START value until t (a dropout and
     * two clicks: a 'seen' sting during a mood's fade-in, a release during a drone's attack). So re-anchor at now at the
     * level the ramp has reached, and ramp on to the level it would have had at t.
     */
    hold(t) {
      const n = Math.min(t, now()), vn = this.at(n), v = this.at(t);
      this.p.cancelScheduledValues(n); this.p.setValueAtTime(vn, n);
      this.pts = this.pts.filter((q) => q[0] < n); this.pts.push([n, vn]);
      if (t > n) this.ramp(t, v);
      return v;
    }
    release(t, dur) { this.hold(t); this.ramp(t + dur, 0); }
  }
  function kill(v) {
    if (v.dead) return; v.dead = true;
    for (const n of v.nodes) { try { n.disconnect(); } catch (e) { /* already */ } }
    const i = S.voices.indexOf(v); if (i >= 0) S.voices.splice(i, 1);
    if (v.act) v.act.voices.delete(v);
  }
  function steal(t) {
    let best = null, bs = Infinity;
    for (const v of S.voices) { if (v.stolen || v.dead || v.end <= t) continue; const sc = (v.act && v.act.dying ? -100 : 0) + v.prio * 10 + (v.t0 - t) * 0.01; if (sc < bs) { bs = sc; best = v; } }
    if (!best) return null;
    const at = Math.max(now(), Math.min(t, best.end)); best.stolen = true; S.stats.stolen++;
    best.env.release(at, 0.04); best.src.stop(at + 0.05); best.end = at + 0.05;
    return at + 0.055;
  }
  /**
   * Start a voice: spec = { buf, t, gain, pan?, rate?, attack?, loop?, hold? (loop length), release?, dur? (one-shot early
   * release), lp? { f0, f1, dur, Q }, rateTo? { v, dur }, swell? [lo, hi, period], act, bus, prio }. Returns it or null.
   */
  function voice(sp) {
    if (!audible() || !sp.buf || !(sp.gain > 0)) { S.stats.skipped++; return null; }
    let t = Math.max(sp.t, now() + 0.005);
    if (!offline) for (const v of S.voices.slice()) if (v.end < now() - 0.5) kill(v);   // an 'ended' that never came
    const sounding = S.voices.filter((v) => v.end > t);
    if (sounding.length >= MAX_VOICES) { const t2 = steal(t); if (t2 == null) return null; t = Math.max(t, t2); }
    const rate = sp.rate || 1, src = ctx.createBufferSource(); src.buffer = sp.buf; src.playbackRate.value = rate;
    const nodes = [src]; let head = src;
    if (sp.loop) { src.loop = true; }
    if (sp.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = sp.lp.Q || 0.8; f.frequency.setValueAtTime(sp.lp.f0, t); f.frequency.linearRampToValueAtTime(sp.lp.f1, t + (sp.lp.dur || 4)); head.connect(f); head = f; nodes.push(f); }
    if (sp.rateTo) src.playbackRate.setValueAtTime(rate, t), src.playbackRate.linearRampToValueAtTime(sp.rateTo.v, t + sp.rateTo.dur);
    const gn = ctx.createGain(); gn.gain.value = 0; head.connect(gn); nodes.push(gn);
    let tail = gn;
    if (sp.pan != null && sp.buf.numberOfChannels === 1) { const p = ctx.createStereoPanner(); p.pan.value = clamp(sp.pan, -1, 1); gn.connect(p); nodes.push(p); tail = p; }
    tail.connect(sp.bus || (sp.act ? sp.act.bus : stingBus));
    const env = new Env(gn.gain), a = sp.attack ?? 0.004, rel = sp.release ?? 0.25, G = sp.gain;
    env.start(t, 0); env.ramp(t + a, G);
    let end;
    if (sp.loop) {
      const hold = Math.max(a, sp.hold || 8);
      if (sp.swell) { let tt = t + a; const [lo, hi, per] = sp.swell; let up = false; while (tt + per < t + hold) { tt += per * (0.7 + Math.random() * 0.6); env.ramp(Math.min(tt, t + hold), G * (up ? hi : lo)); up = !up; } }
      env.ramp(t + hold, env.at(t + hold)); env.ramp(t + hold + rel, 0); end = t + hold + rel;
    } else {
      const natural = sp.buf.duration / rate;
      if (sp.dur && sp.dur < natural) { env.ramp(t + sp.dur, G); env.ramp(t + sp.dur + rel, 0); end = t + sp.dur + rel; } else end = t + natural;
    }
    const v = { id: ++S.id, src, nodes, env, t0: t, end, act: sp.act || null, prio: sp.prio ?? 1, dead: false, stolen: false, hold: sp.loop ? t + (sp.hold || 8) : end };
    src.onended = () => kill(v);
    src.start(t, sp.offset != null ? sp.offset : sp.loop ? Math.random() * sp.buf.duration * 0.9 : 0); src.stop(end);
    S.voices.push(v); if (v.act) v.act.voices.add(v);
    S.stats.started++; S.stats.peak = Math.max(S.stats.peak, S.voices.filter((q) => q.end > t && !q.dead).length);
    return v;
  }
  function releaseVoice(v, at, rel) { if (!v || v.dead || v.stolen || v.end <= at) return; v.env.release(at, rel); v.src.stop(at + rel + 0.02); v.end = at + rel + 0.02; v.hold = at; }
  const alive = (v, t) => v && !v.dead && !v.stolen && v.hold > t;

  // ---- helpers for generators
  const rr = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const hT = (s = 0.018) => (Math.random() + Math.random() + Math.random() - 1.5) * s * 1.4;
  const hV = (v, s = 0.12) => v * (1 + (Math.random() * 2 - 1) * s);
  const panOf = (m, spread = 0.35) => clamp((m - 60) / 30 * spread + (Math.random() - 0.5) * 0.25, -0.8, 0.8);
  function at(act, t, fn) { const e = { t, act, fn }; const Q = S.queue; let i = Q.length; while (i > 0 && Q[i - 1].t > t) i--; Q.splice(i, 0, e); S.stats.events++; }
  const note = (act, inst, m, t, vel, o = {}) => voice({ act, buf: buf(inst + ':' + m), t, gain: vel, pan: o.pan ?? panOf(m), dur: o.dur, release: o.release ?? 0.4, prio: 1 });
  const padV = (act, notes, t, hold, lv, cut, o = {}) => voice({ act, buf: chordBuf(notes), t, gain: lv, loop: true, hold, attack: o.attack ?? 3, release: o.release ?? 4,
    lp: { f0: cut[0], f1: cut[1], dur: Math.min(hold, o.lpDur ?? hold * 0.6), Q: o.Q ?? 0.9 }, rate: o.rate, rateTo: o.rateTo, prio: 2 });

  // ---- mood generators: plan(t0) schedules one unit (bar / phrase / window) and returns where the next one starts
  function phraseGen(act, C) {
    let prog = C.progs[0], ci = 0, arc = 'play', arcEnd = null, lastM = null, last = null;
    return { plan(t0) {
      if (last != null && t0 - last > GAP) { arc = 'play'; arcEnd = null; }   // back after a mute / a stalled tab: start afresh
      last = t0;
      if (arcEnd == null) { arcEnd = t0 + rr(C.active[0] * 0.6, C.active[1] * 0.6); return t0 + rr(1.5, 5); }   // a breath before it starts
      if (t0 >= arcEnd) { arc = arc === 'play' ? 'quiet' : 'play'; arcEnd = t0 + rr(...(arc === 'play' ? C.active : C.quiet)); }
      const beat = 60 / (C.bpm * rr(0.95, 1.04)), len = beat * 4 * C.bars, ch = prog[ci];
      if (arc === 'play') {
        if (Math.random() < C.padP) at(act, t0, (t) => padV(act, ch.p, t, len + 2, hV(C.padLv, 0.1), C.padCut));
        const r = Math.random(), inst = C.piano && Math.random() < C.piano ? 'p' : 'g', lv = inst === 'p' ? C.guitarLv * 0.8 : C.guitarLv;
        if (r < C.tex.arp) {
          const fig = pick(ARPS), start = Math.random() < 0.3 ? beat * pick([1, 2]) : 0, cut = Math.random() < 0.3 ? fig.length - 2 : fig.length;
          fig.slice(0, cut).forEach(([b, i]) => { const m = ch.g[Math.min(i, ch.g.length - 1)] + (inst === 'p' && i === 0 ? 12 : 0); const t = t0 + start + b * beat + hT(); at(act, t, (tt) => note(act, inst, m, tt, hV(i === 0 ? lv : lv * 0.8), { dur: 2.4 })); });
        } else if (r < C.tex.arp + C.tex.motif) {
          const notes = scaleNotes(C.scale, C.mel[0], C.mel[1]); let idx = lastM != null ? notes.indexOf(lastM) : -1;
          if (idx < 0) { const tones = notes.filter((m) => ch.g.some((c) => c % 12 === m % 12)); idx = notes.indexOf(pick(tones.length ? tones : notes)); }
          const rh = pick(RHYTHMS), start = beat * pick([0, 0, 1, 2]);
          if (Math.random() < 0.6) at(act, t0 + start + hT(), (tt) => note(act, 'g', ch.g[0], tt, hV(lv * 0.8), { dur: 2.6 }));
          rh.forEach(([b, d], k) => {
            if (k > 0) { const step = Math.random() < 0.15 ? pick([-3, 3, 4, -4]) : pick([-2, -1, -1, 1, 1, 2]); idx = clamp(idx + step, 0, notes.length - 1); }
            let m = notes[idx];
            if (k === rh.length - 1) { const tones = notes.filter((q) => ch.g.some((c) => c % 12 === q % 12)); m = tones.reduce((a, q) => (Math.abs(q - m) < Math.abs(a - m) ? q : a), tones[0] ?? m); idx = notes.indexOf(m); }
            lastM = m; const t = t0 + start + b * beat + hT(0.025);
            at(act, t, (tt) => note(act, inst, m, tt, hV(lv * (k === 0 ? 0.95 : 0.85)), { dur: Math.min(2.2, d * beat + 0.6) }));
          });
        } else if (Math.random() < 0.5) at(act, t0 + hT(), (tt) => note(act, 'g', ch.g[0], tt, hV(lv * 0.7), { dur: 2.8 }));
      }
      ci = (ci + 1) % prog.length; if (ci === 0 && C.progs.length > 1 && Math.random() < 0.5) prog = pick(C.progs);
      return t0 + len;
    } };
  }
  function titleGen(act) {
    const beat = 60 / TITLE.bpm; let bar = 0, pass = 0;
    const PASSES = ['intro', 'theme', 'low', 'rest', 'theme'];
    return { plan(t0) {
      const kind = PASSES[pass % PASSES.length], ch = TITLE.chords[bar], len = beat * 4 * rr(0.98, 1.03);
      at(act, t0, (t) => padV(act, ch.p, t, len + 0.4, kind === 'rest' ? 0.17 : 0.26, kind === 'rest' ? [300, 600] : [400, 1200], { attack: 1.8, release: 2.5 }));
      if (kind !== 'rest') {
        const arp = kind === 'low' ? [[0, 0], [2, 2]] : [[0, 0], [1, 2], [2, 3], [3, 1]];
        arp.forEach(([b, i]) => at(act, t0 + b * beat + hT(), (t) => note(act, 'g', ch.g[Math.min(i, ch.g.length - 1)], t, hV(kind === 'intro' ? 0.44 : 0.36), { dur: 1.8 })));
      }
      if (kind === 'theme' || kind === 'low') {
        let b = 0; for (const [m, d] of TITLE.mel[bar]) { if (m) { const tt = t0 + b * beat + hT(0.03); const inst = kind === 'low' ? 'g' : 'p', mm = kind === 'low' ? m - 12 : m; at(act, tt, (t) => note(act, inst, mm, t, hV(inst === 'p' ? 0.62 : 0.52, 0.08), { dur: Math.min(2.4, d * beat + 0.6), pan: 0.1 })); } b += d; }
      }
      bar++; if (bar >= 8) { bar = 0; pass++; }
      return t0 + len;
    } };
  }
  function nightGen(act, C) {
    let drone = null, di = 0, nextNote = null, nextBreath = null, pad = null, arc = 'play', arcEnd = null, last = null;
    return { plan(t0) {
      const U = 3;
      if (last != null && t0 - last > GAP) { arc = 'play'; arcEnd = nextNote = nextBreath = null; }   // back after a mute: start afresh
      last = t0;
      // after a mute / a stalled background tab the clock has run on without us: pick up from now, don't spend minutes
      // skipping every note that was due in the meantime
      if (nextNote != null && nextNote < t0 - 0.25) nextNote = t0 + rr(1, 4);
      if (nextBreath != null && nextBreath < t0 - 0.25) nextBreath = t0 + rr(4, 10);
      if (arcEnd == null) arcEnd = t0 + rr(...C.active);
      if (t0 >= arcEnd) {
        arc = arc === 'play' ? 'quiet' : 'play'; arcEnd = t0 + rr(...(arc === 'play' ? C.active : C.quiet));
        if (arc === 'quiet') { const d = drone, p = pad; at(act, t0, (t) => { releaseVoice(d, t, 8); releaseVoice(p, t, 8); }); drone = pad = null; nextNote = arcEnd - rr(0, 6); }
      }
      if (arc === 'quiet') return t0 + U;
      if (!alive(drone, t0 + U)) { const set = C.droneSets[di++ % C.droneSets.length], hold = rr(40, 70); at(act, t0, (t) => { drone = voice({ act, buf: droneBuf(set), t, gain: C.droneLv, loop: true, hold, attack: drone ? 6 : 4, release: 6, prio: 2 }); }); }
      if (nextNote == null) nextNote = t0 + rr(1.5, 5);
      if (nextNote < t0 + U) {
        const tt = nextNote, notes = []; for (let m = C.range[0]; m <= C.range[1]; m++) if (C.pcs.includes(m % 12)) notes.push(m);
        const m = pick(notes); at(act, tt, (t) => note(act, 'p', m, t, hV(rr(...C.vel), 0.1), { pan: (Math.random() - 0.5) * 1.2 }));
        const pair = notes.filter((q) => C.dyadIv.includes(Math.abs(q - m)));   // a second note from the same set, at one of the mood's intervals
        if (pair.length && Math.random() < C.dyad) { const m2 = pick(pair); at(act, tt + rr(0.02, 0.9), (t) => note(act, 'p', m2, t, hV(C.vel[0], 0.1), { pan: (Math.random() - 0.5) * 1.2 })); }
        nextNote = tt + rr(...C.gap);
      }
      if (C.breath) {
        if (nextBreath == null) nextBreath = t0 + rr(6, 14);
        if (nextBreath < t0 + U) { const tt = nextBreath; at(act, tt, (t) => voice({ act, buf: buf('br:' + ((Math.random() * 3) | 0)), t, gain: hV(0.26, 0.2), pan: (Math.random() - 0.5) * 1.4, prio: 0 })); nextBreath = tt + rr(...C.breath); }
      }
      if (C.pad && !alive(pad, t0) && Math.random() < C.pad.p * U / 20) at(act, t0, (t) => { pad = padV(act, C.pad.chord, t, rr(14, 24), C.pad.lv, C.pad.cut, { attack: 5, release: 6 }); });
      return t0 + U;
    } };
  }
  function dreadGen(act) {
    let cluster = null, sub = null, nextMetal = null, first = true, arc = 'play', arcEnd = null, last = null;
    return { plan(t0) {
      const U = 4;
      if (last != null && t0 - last > GAP) { arc = 'play'; arcEnd = nextMetal = null; }   // back after a mute: start afresh
      last = t0;
      if (nextMetal != null && nextMetal < t0 - 0.25) nextMetal = t0 + rr(1, 4);   // back from a mute / a stalled tab
      // dread can last the rest of a day (weeper 'seen_day'): after a long stretch it lets go for a while, everything
      // but the ambience drops away, then it comes back in (the return is worse than the drone ever was)
      if (arcEnd == null) arcEnd = t0 + rr(70, 120);
      if (t0 >= arcEnd) {
        arc = arc === 'play' ? 'quiet' : 'play'; arcEnd = t0 + (arc === 'play' ? rr(60, 110) : rr(16, 32));
        if (arc === 'quiet') { const c = cluster, s = sub; at(act, t0, (t) => { releaseVoice(c, t, 7); releaseVoice(s, t, 9); }); cluster = sub = null; nextMetal = null; }
      }
      if (arc === 'quiet') return t0 + U;
      if (!alive(cluster, t0 + U)) { const hold = rr(34, 44), f = first; at(act, t0, (t) => { cluster = padV(act, DREAD.cluster, t, hold, 0.17, [250, 1500], { attack: f ? 2.5 : 6, release: 6, lpDur: hold, Q: 1.4, rate: 0.944, rateTo: { v: 1.06, dur: hold } }); }); }
      if (!alive(sub, t0 + U)) { const hold = rr(26, 36); at(act, t0, (t) => { sub = voice({ act, buf: buf('sub'), t, gain: 0.5, loop: true, hold, attack: first ? 3 : 7, release: 6, swell: [0.35, 1, 7], prio: 2 }); }); }
      if (nextMetal == null) nextMetal = t0 + rr(2, 6);
      if (nextMetal < t0 + U) { const tt = nextMetal; at(act, tt, (t) => voice({ act, buf: buf('bm:' + ((Math.random() * 2) | 0)), t, gain: hV(0.3, 0.2), pan: (Math.random() - 0.5) * 1.4, prio: 1, dur: 5.0, release: 0.7 })); nextMetal = tt + rr(9, 16); }
      if (Math.random() < 0.08) { const tt = t0 + rr(0, U); at(act, tt, (t) => { note(act, 'p', 38, t, 0.3, { pan: -0.2 }); note(act, 'p', 39, t + 0.01, 0.26, { pan: 0.2 }); }); }
      first = false;
      return t0 + U;
    } };
  }
  function chaseGen(act) {
    const beat = 60 / CHASE.bpm, e8 = beat / 2; let b = 0, sub = null, bi = 0;
    return { plan(t0) {
      const root = CHASE.roots[b % CHASE.roots.length], acc = [1, 0, 0, 1, 0, 0, 1, 0];
      if (!alive(sub, t0 + 4 * beat)) at(act, t0, (t) => { sub = voice({ act, buf: buf('sub'), t, gain: 0.32, loop: true, hold: 30, attack: 1.5, release: 3, prio: 2 }); });
      for (let k = 0; k < 8; k++) {
        const m = acc[k] && k > 0 && Math.random() < 0.35 ? root + 12 : root, gv = acc[k] ? 0.5 : 0.3;
        at(act, t0 + k * e8 + hT(0.004), (t) => voice({ act, buf: buf('bs:' + m), t, gain: hV(gv, 0.06), pan: -0.05, dur: e8 * 0.85, release: 0.03, prio: 1 }));
      }
      at(act, t0 + hT(0.003), (t) => voice({ act, buf: buf('hit'), t, gain: 0.55, pan: 0, prio: 1 }));
      if (b % 2 === 1) at(act, t0 + 2.5 * beat, (t) => voice({ act, buf: buf('hit'), t, gain: 0.38, pan: 0.1, prio: 0, dur: 0.5, release: 0.1 }));
      if (b % 4 === 3) at(act, t0 + 3 * beat, (t) => voice({ act, buf: buf('clank'), t, gain: 0.22, pan: 0.4, prio: 0 }));
      if (b % 4 === 0) { const cl = CHASE.brass[bi++ % CHASE.brass.length]; at(act, t0 + 0.02, (t) => voice({ act, buf: buf('fm:' + cl.join(',')), t, gain: 0.3, pan: (Math.random() - 0.5) * 0.6, prio: 1 })); }
      b++;
      return t0 + 4 * beat;
    } };
  }
  const GENS = { day: (a) => phraseGen(a, PHRASE.day), dusk: (a) => phraseGen(a, PHRASE.dusk), chill: (a) => phraseGen(a, PHRASE.chill), title: titleGen,
    night: (a) => nightGen(a, NIGHT), cab: (a) => nightGen(a, CAB), dread: dreadGen, chase: chaseGen };

  // ---- moods
  function dropAct(a) { try { a.bus.disconnect(); } catch (e) { /* ok */ } const i = S.acts.indexOf(a); if (i >= 0) S.acts.splice(i, 1); }
  function retire(a, fade) {
    if (a.dying) return; a.dying = true; const t = now(); a.dieAt = t + fade;
    S.queue = S.queue.filter((e) => e.act !== a);
    if (!a.voices.size) { dropAct(a); return; }   // nothing sounding through it (muted, or it never got going): let go now
    a.env.release(t, fade);
    for (const v of a.voices) if (v.end > t + fade) { v.src.stop(t + fade + 0.05); v.end = t + fade + 0.05; }
  }
  /**
   * setMood(name, fade?): the game asks every frame (pickMood), so a change has to be asked for steadily for DWELL s
   * before it happens: a player standing in the cab doorway (zone flipping cab / catwalk) or the Weeper hovering at the
   * chase radius mustn't restart the score 60 times a second. Immediate: an explicit fade (scripted: death, dawn, the
   * title), and a threat arriving (chase / dread from a calm mood).
   */
  function setMood(name, fade) {
    if (!MOODS.includes(name)) { console.warn('music: no mood', name); return; }
    if (name === S.mood) { S.pending = null; return; }
    const threat = (m) => m === 'chase' || m === 'dread';
    if (fade != null || (threat(name) && !threat(S.mood))) { S.pending = null; applyMood(name, fade); return; }
    if (!S.pending || S.pending.name !== name) S.pending = { name, since: now() };
  }
  function applyMood(name, fade) {
    const t = now(), f = clamp(fade ?? FADE[name] ?? 6, 0.05, 20);
    for (const a of S.acts.slice()) retire(a, f);
    S.mood = name; S.cur = null;
    const tc = Math.max(0.05, f / 3);
    depW.gain.setTargetAtTime(0.0011 * (WOBBLE[name] ?? 1), t, tc); verbSend.gain.setTargetAtTime(VERB[name] ?? 0.35, t, tc);
    if (name === 'silent') return;
    bumpWarm(name);
    const bus = g(0, pre), a = { name, bus, env: new Env(bus.gain), voices: new Set(), dying: false, cursor: t + 0.05 };
    a.env.start(t, 0); a.env.ramp(t + f, 1);
    a.gen = GENS[name](a); S.acts.push(a); S.cur = a;
  }
  function sting(name) {
    if (name === 'death') setMood('silent', 1.5);   // the score stops even while muted (the mood follows the game)
    if (!audible()) return;
    const t = now() + 0.02;
    if (name === 'seen') { voice({ buf: buf('seen'), t, gain: 0.9, pan: 0, prio: 3 }); if (S.cur) { const v0 = S.cur.env.hold(t); S.cur.env.ramp(t + 0.25, v0 * 0.3); S.cur.env.ramp(t + 1.6, v0 * 0.3); S.cur.env.ramp(t + 5, 1); } }
    else if (name === 'dawn') {
      voice({ buf: chordBuf(DAWN.pad), t, gain: 0.2, loop: true, hold: 6, attack: 1.5, release: 5, lp: { f0: 400, f1: 2200, dur: 4 }, prio: 3 });
      voice({ buf: strumBuf(DAWN.strum, 0.09, 3), t: t + 0.8, gain: 0.45, pan: -0.1, prio: 3 });
      voice({ buf: buf('c:' + DAWN.chime), t: t + 2.3, gain: 0.25, pan: 0.3, prio: 3 });
    } else if (name === 'death') {
      [0, 3.4, 6.8].forEach((d, i) => voice({ buf: buf('bell'), t: t + d, gain: [0.75, 0.6, 0.48][i], pan: 0, prio: 3 }));
    } else if (name === 'task') {
      voice({ buf: buf('c:' + TASK[0]), t, gain: 0.26, pan: 0.15, prio: 3 }); voice({ buf: buf('c:' + TASK[1]), t: t + 0.26, gain: 0.22, pan: 0.25, prio: 3 });
    } else if (name === 'found') voice({ buf: strumBuf(FOUND, 0.21, 9), t, gain: 0.45, pan: 0.05, prio: 3 });
    else console.warn('music: no sting', name);
  }

  // ---- the scheduler
  function tick() {
    const t = now(), horizon = t + (typeof document !== 'undefined' && document.hidden ? 1.5 : LOOKAHEAD);
    if (S.pending && t - S.pending.since >= DWELL) { const p = S.pending; S.pending = null; applyMood(p.name); }
    for (const a of S.acts.slice()) if (a.dying && t > a.dieAt + 0.3) {
      if (!offline) for (const v of [...a.voices]) if (v.end < t) kill(v);
      if (!a.voices.size) dropAct(a);
    }
    const a = S.cur, on = audible();
    if (a && on) { if (a.cursor < t) a.cursor = t + 0.02; let guard = 0; while (a.cursor < horizon && guard++ < 8) a.cursor = a.gen.plan(a.cursor); }
    else if (a) a.cursor = t + 0.05;
    while (S.queue.length && S.queue[0].t < horizon) {
      const e = S.queue.shift();
      if (e.act && e.act.dying) continue;
      if (e.t < t - 0.25) { S.stats.skipped++; continue; }   // too late (the tab stalled): drop it rather than pile notes up
      e.fn(Math.max(e.t, t + 0.005));
    }
    // muted (or music volume 0, or the context suspended) for a while: stop the timer altogether; wake() restarts it
    if (S.timer) { S.idle = on || S.pending ? 0 : S.idle + 1; if (S.idle > IDLE_TICKS && !S.queue.length) stopTimer(); }
  }
  function tickUntil(tEnd, step = 0.05) { const t0 = S.vnow ?? ctx.currentTime; for (let x = t0; x <= tEnd; x += step) { S.vnow = x; tick(); } S.vnow = tEnd; }
  /** The idle warm-up: only while the score can be heard (a muted game never spends the CPU or the ~27 MB). */
  function warmStep() { S.warmT = null; if (!audible()) return; if (!warm(6)) S.warmT = setTimeout(warmStep, 30); }
  function startTimer() {
    if (!timer) return;
    if (!S.timer && (audible() || S.pending)) { S.idle = 0; S.timer = setInterval(tick, TICK_MS); }
    if (!S.warmT && warmList.length && audible()) S.warmT = setTimeout(warmStep, 60);
  }
  function stopTimer() { if (S.timer) clearInterval(S.timer); if (S.warmT) clearTimeout(S.warmT); S.timer = S.warmT = null; }
  function dispose() {
    stopTimer();
    for (const v of S.voices.slice()) { try { v.src.stop(); } catch (e) { /* ok */ } kill(v); }
    for (const a of S.acts) { try { a.bus.disconnect(); } catch (e) { /* ok */ } }
    S.acts = []; S.cur = null; S.queue = [];
    try { lfoW.stop(); lfoF.stop(); } catch (e) { /* ok */ }
    for (const n of [lfoW, lfoF, depW, depF, pre, tapeLP, wob, verbSend, verb, vol, stingBus]) if (n) try { n.disconnect(); } catch (e) { /* ok */ }
  }
  startTimer();
  return {
    MOODS, STINGS,
    get mood() { return S.mood; },
    /** The mood waiting out its DWELL (or null). */
    get pending() { return S.pending ? S.pending.name : null; },
    setMood(name, fade) { setMood(name, fade); if (S.pending) startTimer(); },
    sting,
    get volume() { return S.vol; },
    setVolume(v) { S.vol = clamp(Number.isFinite(+v) ? +v : MUSIC_DEFAULT_VOLUME, 0, 1); vol.gain.setTargetAtTime(S.vol, now(), 0.08); },
    /** Call when audible() may have become true (unmuted, volume up, the context resumed): restarts the scheduler. */
    wake: startTimer,
    get running() { return !!S.timer; },
    tick, tickUntil, warm, prerenderAll, dispose,
    get ready() { return !warmList.length; },
    get voices() { return S.voices.filter((v) => !v.dead && v.end > now()).length; },
    stats: S.stats,
    _S: S, _bank: bank, _raw: raw, _buf: buf, _chord: chordBuf, _strum: strumBuf, _nodes: { out: vol, pre, stingBus, verb, wob },
  };
}
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
