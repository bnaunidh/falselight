// Morse with the searchlight shutter (Space held = shutter open). Pure.
// Timing is forgiving: a press under 0.32 s is a dot, 0.32–2.5 s a dash, longer is just "the light on".
export const CODE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
}
const DECODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]))
export const decodeLetter = (sym) => DECODE[sym] || '?'
export const MORSE = { dotMax: 0.32, dashMax: 2.5, letterGap: 0.75, endGap: 1.9 }

export class MorseKeyer {
  constructor(opts = {}) {
    this.o = { ...MORSE, ...opts }
    this.reset()
  }
  reset() {
    this.sym = ''        // symbols of the letter being keyed
    this.text = ''       // decoded letters of this transmission
    this.isDown = false
    this.tDown = 0
    this.tUp = -Infinity
    this.lastLetterAt = -Infinity
    this.firstLetterAt = null
    this.log = []        // [{ t, kind: 'sym'|'letter'|'end', v }]
    this.ended = false
    this.presses = []    // this attempt's raw presses [{ d, t }] (SOS is judged on their SHAPE, not on fixed timings)
  }
  down(t) {
    if (this.isDown) return
    if (this.ended) { this.reset() }
    if (this.presses.length && t - this.tUp > 2.6) this.presses = []   // a long pause: a fresh attempt
    this.update(t)
    this.isDown = true; this.tDown = t
  }
  up(t) {
    if (!this.isDown) return null
    this.isDown = false; this.tUp = t
    const held = t - this.tDown
    if (held < 6) this.presses.push({ d: held, t })
    let s = null
    if (held <= this.o.dotMax) s = '.'
    else if (held <= this.o.dashMax) s = '-'
    if (s) { this.sym += s; this.log.push({ t, kind: 'sym', v: s }) }
    return s
  }
  /** Call every frame: closes letters and transmissions after silence. Returns new events. */
  update(t) {
    const ev = []
    if (this.isDown) return ev
    const gap = t - this.tUp
    if (this.sym && gap >= this.o.letterGap) {
      const L = decodeLetter(this.sym)
      this.text += L; this.sym = ''
      this.lastLetterAt = t
      if (this.firstLetterAt == null) this.firstLetterAt = t
      this.log.push({ t, kind: 'letter', v: L }); ev.push({ kind: 'letter', v: L })
    }
    if (!this.ended && this.text && !this.sym && gap >= this.o.endGap) {
      this.ended = true
      this.log.push({ t, kind: 'end', v: this.text }); ev.push({ kind: 'end', v: this.text })
    }
    return ev
  }
  /** The attempt so far as dots and dashes, classified against YOUR tempo: your first press is a dot, anything clearly
   *  longer than your dots is a dash (the fixed 0.32 s cut-off made SOS hard to key). */
  marks() {
    const P = this.presses; if (!P.length) return []
    const dots = P.slice(0, 3).map((p) => p.d), base = Math.min(...dots)
    const thr = Math.max(0.2, Math.min(0.6, base * 1.7))
    return P.map((p, i) => (i < 3 ? '.' : p.d > thr ? '-' : '.'))
  }
  /** Dot/dash cut-off for the hold meter right now (seconds). */
  threshold() { const P = this.presses; return P.length ? Math.max(0.2, Math.min(0.6, Math.min(...P.slice(0, 3).map((p) => p.d)) * 1.7)) : 0.32 }
  /** Did the last nine presses make S O S? Three short, three clearly longer, three short: relative, so any steady hand works. */
  sosShape() {
    const P = this.presses; if (P.length < 9) return false
    const d = P.slice(-9).map((p) => p.d), s1 = d.slice(0, 3), l = d.slice(3, 6), s2 = d.slice(6, 9)
    const shortMax = Math.max(...s1, ...s2), longMin = Math.min(...l)
    return longMin > shortMax * 1.35 && longMin >= 0.18
  }
  clearAttempt() { this.presses = []; this.sym = ''; this.text = ''; this.ended = true }
  get keying() { return this.isDown || !!this.sym || (!!this.text && !this.ended) }
  /** Pretty string for the UI: "··· ——— ··" */
  display() {
    const pretty = (s) => s.replace(/\./g, '·').replace(/-/g, '—')
    return this.text.split('').map((L) => pretty(CODE[L] || '?')).concat(this.sym ? [pretty(this.sym)] : []).join('   ')
  }
}

export const isSOS = (text) => /SOS$/.test(text || '') || /SOS/.test(text || '')

/** A light pattern: [{ on, d }] for text at a unit length (seconds). */
export function patternFor(text, unit = 0.3) {
  const out = []
  const words = text.split(' ')
  words.forEach((w, wi) => {
    w.split('').forEach((L, li) => {
      const code = CODE[L.toUpperCase()] || ''
      code.split('').forEach((c, ci) => {
        out.push({ on: true, d: c === '.' ? unit : unit * 3 })
        if (ci < code.length - 1) out.push({ on: false, d: unit })
      })
      if (li < w.length - 1) out.push({ on: false, d: unit * 3 })
    })
    if (wi < words.length - 1) out.push({ on: false, d: unit * 7 })
  })
  return out
}

/**
 * A distant flashlight playing a pattern, optionally looping with a pause.
 * jitter: per-element timing wobble 0..1 (a real hand is uneven; a false light is perfect).
 */
export class LightSignal {
  constructor(pattern, t0 = 0, { loopGap = null, jitter = 0, rng = Math.random } = {}) {
    this.t0 = t0; this.loopGap = loopGap
    this.pattern = pattern.map((p) => ({ ...p, d: p.d * (1 + (rng() * 2 - 1) * jitter) }))
    this.length = this.pattern.reduce((a, p) => a + p.d, 0)
  }
  isOn(t) {
    let u = t - this.t0
    if (u < 0) return false
    const period = this.loopGap == null ? Infinity : this.length + this.loopGap
    if (this.loopGap != null) u = u % period
    if (u >= this.length) return false
    for (const p of this.pattern) { if (u < p.d) return p.on; u -= p.d }
    return false
  }
  done(t) { return this.loopGap == null && t - this.t0 >= this.length }
}
