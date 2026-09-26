// Lost hikers at night, guided with the searchlight. Pure.
//   * They walk along their route while the beam is on them.
//   * Unlit for more than 4 s, they stop and wait (and flash SOS again).
//   * If the beam sits off the trail they follow it off the trail — 8 m out, the ground drops away.
// The False Light obeys the same beam, but it is too steady, sits too high and answers too fast,
// and its route ends at the tower gate, not the trailhead.
import { Polyline, clamp, dist2d } from './util.js?v=f6619665'
import { patternFor, LightSignal } from './morse.js?v=f6619665'

export const HIKER = { walk: 1.15, unlitStop: 4, onRouteTol: 7, stray: 0.85, strayBack: 1.0, fallAt: 8, lampHeight: 1.15, falseHeight: 2.7 }

/** Estimate the beam's ground spot near `around` by sampling isLit on a grid (API-only; no engine internals). */
export function estimateBeamCenter(isLit, around, { radius = 30, step = 3, heightAt = null, lift = 1.0 } = {}) {
  let sx = 0, sz = 0, n = 0
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dz = -radius; dz <= radius; dz += step) {
      if (dx * dx + dz * dz > radius * radius) continue
      const x = around[0] + dx, z = around[2] + dz
      const y = (heightAt ? heightAt(x, z) : around[1]) + lift
      if (isLit([x, y, z])) { sx += x; sz += z; n++ }
    }
  }
  if (!n) return null
  const x = sx / n, z = sz / n
  return [x, heightAt ? heightAt(x, z) : around[1], z]
}

export class GuidedHiker {
  /**
   * route: Polyline or points. kind: 'hiker' | 'false'. rng: () => 0..1
   */
  constructor(route, { kind = 'hiker', rng = Math.random, t0 = 0, name = 'hiker' } = {}) {
    this.route = route instanceof Polyline ? route : new Polyline(route)
    this.kind = kind; this.rng = rng; this.name = name
    this.s = 0
    this.off = [0, 0]          // xz offset from the route (straying)
    this.status = 'signalling' // signalling → answered → waiting/walking/straying → saved | fell | arrived | out
    this.unlit = 0
    this.walked = 0
    this.litTime = 0
    this.answeredAt = null
    this.replyAt = null
    this.phase = rng() * 6.28
    this.signal = new LightSignal(patternFor('SOS', kind === 'false' ? 0.26 : 0.3), t0, { loopGap: kind === 'false' ? 3.0 : 4.5, jitter: kind === 'false' ? 0 : 0.28, rng })
    this.reply = null
    this.t = t0
  }
  get done() { return ['saved', 'fell', 'arrived', 'out'].includes(this.status) }
  get moving() { return this.status === 'walking' || this.status === 'straying' }
  /** Ground position (without lamp height). */
  get ground() {
    const p = this.route.at(this.s)
    return [p[0] + this.off[0], p[1], p[2] + this.off[1]]
  }
  /** Where the flashlight is: a real hand bobs with each step; the false light floats, perfectly still. */
  lampPos(t = this.t) {
    const g = this.ground
    if (this.kind === 'false') return [g[0], g[1] + HIKER.falseHeight, g[2]]
    const bob = this.moving ? Math.sin(t * 2 * Math.PI * 1.7 + this.phase) * 0.07 + Math.sin(t * 3.1 + this.phase) * 0.03 : Math.sin(t * 0.9 + this.phase) * 0.015
    const sway = this.moving ? Math.sin(t * Math.PI * 1.7 + this.phase) * 0.05 : 0
    return [g[0] + sway, g[1] + HIKER.lampHeight + bob, g[2]]
  }
  /** Is the lamp lit right now (flashing SOS, replying, or held on the trail)? */
  lampOn(t = this.t) {
    if (this.done) return false
    if (this.reply && t >= this.replyAt && !this.reply.done(t)) return this.reply.isOn(t)
    if (this.status === 'signalling') return this.signal.isOn(t)
    if (this.status === 'answered') return false
    if (this.status === 'waiting' && this.unlit > HIKER.unlitStop + 5) return this.signal.isOn(t) // flashing SOS again
    return true
  }
  /** The player finished an SOS (tEnd) — or, for the false light, started one. */
  answer(t) {
    if (this.status !== 'signalling') return false
    this.status = 'answered'; this.answeredAt = t
    const delay = this.kind === 'false' ? 0.15 : 1.4 + this.rng() * 1.6
    this.replyAt = t + delay
    this.reply = new LightSignal(patternFor('OK', this.kind === 'false' ? 0.2 : 0.32), this.replyAt, { jitter: this.kind === 'false' ? 0 : 0.3, rng: this.rng })
    return true
  }
  /**
   * lit: is the searchlight on the hiker. beam: estimated beam ground spot or null.
   * Returns an event string when something happens ('walking', 'stopped', 'straying', 'fell', 'saved', 'arrived').
   */
  update(dt, { lit, beam, t }) {
    this.t = t
    if (this.done) return null
    if (this.status === 'signalling') return null
    if (this.status === 'answered') { if (this.reply && this.reply.done(t)) { this.status = 'waiting'; return 'ready' } return null }
    let ev = null
    if (lit) {
      this.unlit = 0; this.litTime += dt
      const n = beam ? this.route.nearest(beam, Math.max(0, this.s - 15), this.s + 80) : null
      const onRoute = !n || n.dist <= HIKER.onRouteTol
      const offLen = Math.hypot(this.off[0], this.off[1])
      if (onRoute) {
        if (offLen > 0.05) {
          const k = Math.max(0, offLen - HIKER.strayBack * dt) / offLen
          this.off = [this.off[0] * k, this.off[1] * k]
          if (this.status !== 'straying') { ev = 'straying' }
          this.status = 'straying'
        } else {
          const before = this.status
          this.status = 'walking'
          const ds = HIKER.walk * dt
          this.s = Math.min(this.route.length, this.s + ds); this.walked += ds
          if (before !== 'walking') ev = 'walking'
        }
      } else {
        // follow the beam off the trail
        const g = this.ground
        const dx = beam[0] - g[0], dz = beam[2] - g[2], L = Math.hypot(dx, dz) || 1
        this.off = [this.off[0] + (dx / L) * HIKER.stray * dt, this.off[1] + (dz / L) * HIKER.stray * dt]
        if (this.status !== 'straying') ev = 'straying'
        this.status = 'straying'
        if (Math.hypot(this.off[0], this.off[1]) >= HIKER.fallAt) { this.status = 'fell'; return 'fell' }
      }
    } else {
      this.unlit += dt
      if (this.unlit > HIKER.unlitStop) { if (this.status !== 'waiting') ev = 'stopped'; this.status = 'waiting' }
      else if (this.status === 'walking') { const ds = HIKER.walk * 0.6 * dt; this.s = Math.min(this.route.length, this.s + ds); this.walked += ds }
    }
    if (this.s >= this.route.length - 2 && Math.hypot(this.off[0], this.off[1]) < 1) {
      this.status = this.kind === 'false' ? 'arrived' : 'saved'
      return this.status
    }
    return ev
  }
  /** For the tracker: fraction of the way out. */
  get progress() { return clamp(this.s / (this.route.length || 1)) }
  toJSON() { return { s: this.s, off: this.off, status: this.status, kind: this.kind, name: this.name } }
}

/** Distance from the hiker's lamp to the nearest point of a polygon edge is not needed; fall = stray. */
export const isNearRoute = (h, p, tol = HIKER.onRouteTol) => h.route.nearest(p).dist <= tol
export const distXZ = dist2d
