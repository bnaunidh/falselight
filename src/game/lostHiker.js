// The Lost Hiker (the dead one). Pure.
// He stands facing the tower. He never moves while he is lit (beam, flashlight, flash, daylight)
// and never while you are looking at him. Unlit and unobserved for a moment, he is one spot closer.
// He advances along treeLine toward the gate; each night he may get a little further.
import { dist2d } from './util.js?v=f6619665'

export const LOST = { stepDelay: 2.6, nightCap: { night1: 0, night2: 4, night3: 5, night4: 7, night5: 8 } }

export class LostHikerWatcher {
  /** path: [[x,y,z]...] far → near (the gate last). */
  constructor(path, { idx = 0, cap = 4, id = 0 } = {}) {
    this.path = path; this.idx = idx; this.cap = Math.min(cap, path.length - 1); this.id = id
    this.hidden = 0; this.steps = 0; this.lastStepAt = null
  }
  get pos() { return this.path[this.idx] }
  /** check = engine.view.check(handle) result. Returns 'step' when he moved. */
  update(dt, check, t = 0) {
    const observed = !!(check && check.inFrustum && !check.occluded && (check.onScreen ?? 0) > 0.001)
    const lit = !!(check && check.lit)
    if (observed || lit) { this.hidden = 0; return null }
    this.hidden += dt
    if (this.hidden >= LOST.stepDelay && this.idx < this.cap) {
      this.idx++; this.steps++; this.hidden = 0; this.lastStepAt = t
      return 'step'
    }
    return null
  }
  distanceTo(p) { return dist2d(this.pos, p) }
  toJSON() { return { idx: this.idx, id: this.id } }
}

/** Offset copies for the 2nd, 3rd … lost hiker so they don't overlap (spread sideways, 2.2 m apart). */
export function spreadPath(path, k, towerPos) {
  if (!k) return path
  return path.map((p) => {
    const dx = p[0] - towerPos[0], dz = p[2] - towerPos[2], L = Math.hypot(dx, dz) || 1
    const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.2
    return [p[0] + (-dz / L) * side, p[1], p[2] + (dx / L) * side]
  })
}
