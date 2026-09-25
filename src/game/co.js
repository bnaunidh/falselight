// Carbon monoxide from the cab's propane heater. Pure.
// Heater on + windows shut → the cab air fills → your blood follows → real hallucinations.
// Windows open → your head clears, but you get cold (breath fog, shivering, stiff hands).
import { clamp } from './util.js'

export const COCFG = {
  rise: 0.0034,          // cab air per second, heater on, all shut
  ventPerWindow: 0.007,  // air cleared per open window per second
  heaterOffDecay: 0.003,
  absorb: 0.02,          // blood → air, in the cab
  clear: 0.012,          // blood decay outside the cab
  hallucinateAt: 0.3,
  passOutAt: 0.9,
}

export class CO {
  constructor(s = {}) {
    this.heater = s.heater ?? false
    this.windows = { n: false, e: false, s: false, w: false, ...(s.windows || {}) }
    this.air = s.air ?? 0
    this.blood = s.blood ?? 0
    this.cold = s.cold ?? 0
    this.nextHallu = s.nextHallu ?? 30
    this.passOutTimer = 0
  }
  get open() { return Object.values(this.windows).filter(Boolean).length }
  toggleWindow(k) { this.windows[k] = !this.windows[k]; return this.windows[k] }
  toggleHeater() { this.heater = !this.heater; return this.heater }
  /** ctx: { inCab, night, rng } → events ('hallucinate:<kind>' | 'passout' | 'shiver') */
  tick(dt, { inCab = false, night = false, rng = Math.random } = {}) {
    const ev = []
    const o = this.open
    let dAir = 0
    if (this.heater && o === 0) dAir += COCFG.rise
    else if (this.heater) dAir += COCFG.rise * 0.25
    dAir -= o * COCFG.ventPerWindow
    if (!this.heater) dAir -= COCFG.heaterOffDecay
    this.air = clamp(this.air + dAir * dt)
    if (inCab) this.blood += (this.air - this.blood) * Math.min(1, COCFG.absorb * dt * 3) * (this.air > this.blood ? 1 : 0.6)
    else this.blood -= COCFG.clear * dt
    this.blood = clamp(this.blood)
    // cold: night air through open windows, or no heat
    let target = 0
    if (night) target = inCab ? (this.heater ? 0.05 : 0.45) + 0.13 * o : 0.55
    this.cold += (clamp(target) - this.cold) * Math.min(1, dt * 0.02)
    const wasShiver = this._shiver; this._shiver = this.cold > 0.55
    if (this._shiver && !wasShiver) ev.push('shiver')
    // hallucinations
    if (this.blood >= COCFG.hallucinateAt) {
      this.nextHallu -= dt * (0.6 + this.blood)
      if (this.nextHallu <= 0) {
        const r = rng()
        const kind = r < 0.35 ? 'figure' : r < 0.65 ? 'knock' : r < 0.85 ? 'text' : 'voice'
        ev.push('hallucinate:' + kind)
        this.nextHallu = 18 + rng() * 30
      }
    }
    if (this.blood >= COCFG.passOutAt) { this.passOutTimer += dt; if (this.passOutTimer > 8) { ev.push('passout'); this.passOutTimer = 0 } }
    else this.passOutTimer = 0
    return ev
  }
  /** After passing out: somebody opened a window. */
  wake() { this.windows.n = true; this.heater = false; this.air = 0.2; this.blood = 0.35 }
  toJSON() { return { heater: this.heater, windows: { ...this.windows }, air: this.air, blood: this.blood, cold: this.cold } }
}
