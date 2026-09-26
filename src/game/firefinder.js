// Osborne Fire Finder: a brass sighting ring on a map table. The player turns the ring until the
// hair in the far sight sits on the smoke, then radios the azimuth. Pure.
import { norm360, angDiff, clamp } from './util.js?v=b81b31af'

export const FINDER = { tolerance: 3, speedDegPerSec: 38, fineDegPerSec: 6 }

export class FireFinder {
  constructor(ring = 180) { this.ring = norm360(ring); this.reports = [] }
  turn(deg) { this.ring = norm360(this.ring + deg); return this.ring }
  set(deg) { this.ring = norm360(deg); return this.ring }
  /** Turn by held keys: dir = -1|0|1, fine = true slows to 6°/s. cold 0..1 makes stiff hands slower. */
  step(dt, dir, fine = false, cold = 0) {
    if (!dir) return this.ring
    const sp = (fine ? FINDER.fineDegPerSec : FINDER.speedDegPerSec) * (1 - 0.45 * clamp(cold))
    return this.turn(dir * sp * dt)
  }
  get readout() { return String(Math.round(this.ring) % 360).padStart(3, '0') + '°' }
  /** Compare the ring to every visible fire; returns the best match. */
  report(fires, tol = FINDER.tolerance) {
    let best = null
    for (const f of fires) {
      const err = Math.abs(angDiff(this.ring, f.bearingDeg))
      if (!best || err < best.err) best = { fire: f, err }
    }
    const r = { bearing: Math.round(this.ring) % 360, ok: !!(best && best.err <= tol), err: best ? best.err : null, fire: best ? best.fire : null }
    this.reports.push(r)
    return r
  }
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner']
/** 71 → "zero-seven-one" (radio procedure reads azimuths digit by digit). */
export function spokenBearing(b) {
  return String(Math.round(norm360(b)) % 360).padStart(3, '0').split('').map((d) => DIGITS[+d]).join('-')
}
export const compassWord = (b) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(norm360(b) / 45) % 8]
