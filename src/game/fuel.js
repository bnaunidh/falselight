// Generator + fuel. Pure. The searchlight has power only while the generator runs with fuel in the
// tank. There is never enough for a whole night: a full tank lasts ~5 real minutes with the beam on.
import { clamp } from './util.js?v=fa183c0e'

export const FUEL = {
  capacity: 5.0,        // litres in the generator tank
  can: 5.0,             // one can fills the tank
  idle: 0.45 / 60,      // litres per real second, generator running
  beam: 0.55 / 60,      // extra litres per second with the searchlight lit
  low: 0.3,             // fraction that counts as "low"
}

export class Fuel {
  constructor(s = {}) {
    this.tank = s.tank ?? 4.0
    this.genOn = s.genOn ?? false
    this.cabCans = s.cabCans ?? 0      // cans kept above the gate (rule 2)
    this.baseCans = s.baseCans ?? 3    // cans in the shed
    this.carrying = s.carrying ?? false
    this.rough = s.rough ?? 1.0        // burn multiplier (night 2: the generator runs rough)
    this.wasLow = this.frac < FUEL.low
  }
  get frac() { return clamp(this.tank / FUEL.capacity) }
  get power() { return this.genOn && this.tank > 0 }
  /** 0..1 flicker amount the searchlight should show when the tank is nearly dry. */
  get sputter() { return this.power ? clamp((0.08 - this.frac) / 0.08) : 0 }
  start() { if (this.tank <= 0) return { ok: false, why: 'empty' }; this.genOn = true; return { ok: true } }
  stop() { this.genOn = false }
  tick(dt, beamOn) {
    const ev = []
    if (!this.genOn) return ev
    this.tank = Math.max(0, this.tank - (FUEL.idle + (beamOn ? FUEL.beam : 0)) * this.rough * dt)
    const low = this.frac < FUEL.low
    if (low && !this.wasLow) ev.push('low')
    this.wasLow = low
    if (this.tank <= 0) { this.genOn = false; ev.push('empty') }
    return ev
  }
  pickUp(where) {
    if (this.carrying) return { ok: false, why: 'hands full' }
    if (where === 'base') { if (this.baseCans <= 0) return { ok: false, why: 'no cans left' }; this.baseCans--; }
    else if (where === 'cab') { if (this.cabCans <= 0) return { ok: false, why: 'no can up here' }; this.cabCans--; }
    this.carrying = true
    return { ok: true }
  }
  stow(where) {
    if (!this.carrying) return { ok: false }
    this.carrying = false
    if (where === 'cab') this.cabCans++; else this.baseCans++
    return { ok: true }
  }
  pour() {
    if (!this.carrying) return { ok: false, why: 'no can' }
    this.carrying = false
    this.tank = Math.min(FUEL.capacity, this.tank + FUEL.can)
    this.wasLow = this.frac < FUEL.low
    return { ok: true }
  }
  /** Minutes of beam left at the current burn. */
  minutesLeft(beamOn = true) { return this.tank / ((FUEL.idle + (beamOn ? FUEL.beam : 0)) * this.rough) / 60 }
  toJSON() { return { tank: this.tank, genOn: this.genOn, cabCans: this.cabCans, baseCans: this.baseCans, carrying: this.carrying, rough: this.rough } }
}
