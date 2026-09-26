// FALSE LIGHT — fear: one number for how scared you are, and the body that follows it. Threats close by, the lights
// stuttering, a hallucination, a jump: each pushes it up; it drops slowly (your heart doesn't settle the moment the thing is
// gone). The heart is the readout: ~64 bpm resting, climbing past 170 when something is on you, audible from about a
// third of the way up, a lub-dub whose gap tightens as it races; ragged breathing near the top. Pure logic + two tiny synths.
import { clamp } from './util.js?v=7c0235c6'

export const FEAR = {
  rest: 64, max: 188,        // bpm
  attack: 3.5,               // how fast fear climbs toward what's happening (per s)
  release: 0.028,            // how slowly it lets go (per s): a real scare keeps you up for most of a minute; sitting / in bed: calmRelease
  calmRelease: 0.12,
  spikeFade: 0.035,          // a scare's own push fades over ~25 s
  audible: 0.22,             // the heart becomes something you hear
  breathing: 0.55,
}

export class Fear {
  constructor() {
    this.level = 0; this.spikes = 0; this.bpm = FEAR.rest; this.phase = 0; this.pulse = 0; this.dubAt = -1
    this.breathT = 0; this.breathIn = true; this.why = ''; this.shake = 0
  }
  /** A scare: k 0..1 (0.15 a whisper … 1 a jump). It lands immediately on the heart. */
  spike(k, why = '') {
    k = clamp(k); if (!(k > 0)) return
    this.spikes = Math.max(this.spikes, k); this.level = Math.max(this.level, k * 0.9); if (why) this.why = why
    this.bpm = Math.max(this.bpm, FEAR.rest + (FEAR.max - FEAR.rest) * Math.pow(k, 0.8) * 0.9)   // the jolt: no ramp
  }
  /** ctx: { threat 0..1 (something wrong is close), dark 0..1, exertion 0..1, health 0..1, calm bool }
   *  → events [{ kind: 'lub'|'dub'|'breath_in'|'breath_out', v }] for the game to play. */
  update(dt, ctx = {}) {
    const ev = []
    this.spikes = Math.max(0, this.spikes - dt * FEAR.spikeFade)
    const target = clamp(Math.max(ctx.threat || 0, this.spikes, (ctx.dark || 0) * 0.18))
    if (target > this.level) this.level += (target - this.level) * Math.min(1, dt * FEAR.attack)
    else this.level = Math.max(target, this.level - dt * (ctx.calm ? FEAR.calmRelease : FEAR.release))
    const hurt = 1 - clamp(ctx.health ?? 1)
    const want = Math.min(FEAR.max + 8, FEAR.rest + (FEAR.max - FEAR.rest) * Math.pow(this.level, 0.85) + 26 * clamp(ctx.exertion || 0) + 34 * hurt * hurt)
    this.bpm += (want - this.bpm) * Math.min(1, dt * (want > this.bpm ? 2.2 : 0.25))
    // the beat: lub on the period, dub a third of the way in (the gap tightens as the rate climbs)
    const period = 60 / this.bpm
    this.phase += dt / period
    const loud = clamp((Math.max(this.level, hurt * 0.8) - FEAR.audible) / (1 - FEAR.audible))
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase)
      this.pulse = 1
      if (loud > 0) ev.push({ kind: 'lub', v: 0.25 + 0.95 * loud })
      this.dubAt = Math.min(0.42, 0.13 / period + 0.06)   // fraction of the period
    }
    if (this.dubAt >= 0 && this.phase >= this.dubAt) { this.dubAt = -1; this.pulse = Math.max(this.pulse, 0.6); if (loud > 0) ev.push({ kind: 'dub', v: 0.18 + 0.7 * loud }) }
    this.pulse = Math.max(0, this.pulse - dt * (3 + this.bpm / 40))
    // breathing: ragged, faster the more scared
    if (this.level > FEAR.breathing) {
      this.breathT -= dt
      if (this.breathT <= 0) {
        const k = (this.level - FEAR.breathing) / (1 - FEAR.breathing)
        ev.push({ kind: this.breathIn ? 'breath_in' : 'breath_out', v: 0.3 + 0.6 * k })
        this.breathT = (this.breathIn ? 0.9 : 1.1) - 0.5 * k + Math.random() * 0.25; this.breathIn = !this.breathIn
      }
    } else { this.breathT = 0; this.breathIn = true }
    // hands: a tremor that grows with fear (the game adds it to the view)
    this.shake = Math.pow(Math.max(0, this.level - 0.35) / 0.65, 1.5)
    return ev
  }
  reset() { this.level = 0; this.spikes = 0; this.bpm = FEAR.rest; this.pulse = 0 }
}

/** The heart and the breathing, as audio.addSynth recipes: a heart heard from inside (low, felt more than heard). */
export function registerFearSounds(audio) {
  if (!audio || !audio.addSynth) return
  audio.addSynth('heart_lub', (d, v, H) => { H.tone(d, { f: 64, f1: 36, a: 0.004, d: 0.15, v: 0.75 * v }); H.burst(d, { type: 'lowpass', f: 140, Q: 0.7, a: 0.003, d: 0.08, v: 0.55 * v, brown: true }); return 0.25 })
  audio.addSynth('heart_dub', (d, v, H) => { H.tone(d, { f: 56, f1: 34, a: 0.004, d: 0.11, v: 0.5 * v }); H.burst(d, { type: 'lowpass', f: 110, Q: 0.7, a: 0.003, d: 0.06, v: 0.35 * v, brown: true }); return 0.2 })
  audio.addSynth('breath_in', (d, v, H) => { H.burst(d, { type: 'bandpass', f: 1500, Q: 0.9, a: 0.22, d: 0.45, v: 0.09 * v }); H.burst(d, { type: 'bandpass', f: 3200, Q: 1.4, a: 0.2, d: 0.35, v: 0.04 * v }); return 0.7 })
  audio.addSynth('breath_out', (d, v, H) => { H.burst(d, { type: 'bandpass', f: 650, Q: 0.7, a: 0.04, d: 0.6, v: 0.11 * v }); return 0.7 })
}
