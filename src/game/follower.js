// FALSE LIGHT — what walks behind you in the deep woods at night. Pure rules; the game plays the sounds and owns the death.
//   Deep enough (player.depth > ~0.4) after dark, it's there: every step you take, one of its steps lands a beat later,
//   somewhere behind you on the way you came. Stop, and it takes one more step, then stops too.
//   Stand still in the dark (no light) and it doesn't stay stopped: the steps come closer, then breathing. Too close: that's it.
//   Turn round with the flashlight on and you catch it: a crash through the brush, running, and it hangs back a while.
//   Walk out toward the trail and it lets you go (the last steps stop at the tree line).
import { clamp } from './util.js?v=d92670d68201cefe'

export const FOLLOW = {
  onDepth: 0.4, offDepth: 0.22,   // where it picks you up / lets you go (player.depth: 0 trail … 1 deep)
  rest: 12, near: 4, catchAt: 1.3, // metres behind you: where it keeps to, breathing distance, the end
  creep: 0.9,                      // m/s it closes in while you stand in the dark (~20 s from the first step to the end)
  waitDark: 9,                     // seconds of standing still in the dark before it comes
  lag: [0.3, 0.46],                // how far behind your step its step lands (s)
  fleeTo: 20, fleeCool: 25,        // caught in the light: how far it runs, and for how long it won't come near
  seeAngle: 0.6,                   // radians: 'looking back at it'
}

export class Follower {
  constructor() { this.reset() }
  reset() { this.active = false; this.dist = FOLLOW.rest; this.still = 0; this.due = []; this.cool = 0; this.pos = null; this.crumbs = []; this.lastStepT = -9; this.creepT = 0; this.breathT = 0 }
  /** ctx: { t, dt, night, depth, busy, stepped (you took a step this frame), moving, lit (a light in your hand), eye:[x,y,z], fwd:[x,z] (camera),
   *        pos:[x,y,z] (feet), rain }. A: { step(pos, v, wet), flee(pos), breath(pos, v), snap(pos, v), fear(k), caught(), dog(pos) } */
  update(dt, c, A) {
    if (c.busy) return
    const t = c.t
    // the way you came: a breadcrumb every half metre (it walks where you walked)
    const last = this.crumbs[this.crumbs.length - 1]
    if (!last || Math.hypot(c.pos[0] - last[0], c.pos[2] - last[2]) > 0.5) { this.crumbs.push([c.pos[0], c.pos[1], c.pos[2]]); if (this.crumbs.length > 120) this.crumbs.shift() }
    const want = c.night && c.depth > (this.active ? FOLLOW.offDepth : FOLLOW.onDepth)
    if (!want) { if (this.active) { this.active = false; this.due.length = 0 } this.dist = FOLLOW.rest; this.still = 0; return }
    if (!this.active) { this.active = true; this.dist = FOLLOW.rest + 3; this.cool = 0 }
    this.cool = Math.max(0, this.cool - dt)
    // where it is: back along your crumbs, `dist` metres
    this.pos = this.behind(c)
    // your steps → its steps, a beat later
    if (c.stepped) { this.lastStepT = t; this.due.push({ t: t + FOLLOW.lag[0] + Math.random() * (FOLLOW.lag[1] - FOLLOW.lag[0]), v: 1 }) }
    if (!c.moving && t - this.lastStepT > 0.4 && t - this.lastStepT < 0.5 && !this._tail) { this._tail = true; this.due.push({ t: t + 0.55, v: 0.8 }) }   // one more, after you've stopped
    if (c.moving) this._tail = false
    for (let i = this.due.length - 1; i >= 0; i--) if (t >= this.due[i].t) { const d = this.due.splice(i, 1)[0]; A.step(this.pos, clamp(1.15 - this.dist / 26) * d.v, !!c.rain) }
    // standing still in the dark: it comes
    if (!c.moving) this.still += dt; else this.still = 0
    const dark = !c.lit
    if (c.moving) this.dist = Math.min(FOLLOW.rest, this.dist + dt * 0.8)   // it keeps up, lagging
    else if (this.still > FOLLOW.waitDark && dark && this.cool <= 0) {
      this.dist -= FOLLOW.creep * dt
      this.creepT -= dt; if (this.creepT <= 0) { this.creepT = 0.55 + Math.random() * 0.2; A.step(this.pos, clamp(1.25 - this.dist / 20), !!c.rain) }
      if (this.dist < FOLLOW.near) { this.breathT -= dt; if (this.breathT <= 0) { this.breathT = 2.2; A.breath(this.pos, clamp(1.4 - this.dist / 4)) } }
    }
    if (!dark) this.dist = Math.max(this.dist, 8)   // a light keeps it off you
    // looking back at it with a light: you catch it (almost) and it runs
    const to = [this.pos[0] - c.eye[0], this.pos[2] - c.eye[2]], tl = Math.hypot(to[0], to[1]) || 1
    const facing = Math.acos(clamp((to[0] * c.fwd[0] + to[1] * c.fwd[1]) / tl / (Math.hypot(c.fwd[0], c.fwd[1]) || 1), -1, 1)) < FOLLOW.seeAngle
    if (facing && c.lit && this.cool <= 0 && this.dist < FOLLOW.rest + 2) { A.flee(this.pos); this.dist = FOLLOW.fleeTo; this.cool = FOLLOW.fleeCool; this.still = 0; this.due.length = 0 }
    // the dog knows
    if (A.dog && Math.random() < dt * 0.25) A.dog(this.pos)
    A.fear(clamp(0.28 + 0.6 * (1 - this.dist / (FOLLOW.rest + 4))))
    if (this.dist <= FOLLOW.catchAt) { this.reset(); A.caught() }
  }
  behind(c) {
    let need = this.dist, prev = [c.pos[0], c.pos[1], c.pos[2]]
    for (let i = this.crumbs.length - 1; i >= 0; i--) {
      const q = this.crumbs[i], d = Math.hypot(q[0] - prev[0], q[2] - prev[2])
      if (d >= need) { const k = need / (d || 1); return [prev[0] + (q[0] - prev[0]) * k, prev[1] + (q[1] - prev[1]) * k, prev[2] + (q[2] - prev[2]) * k] }
      need -= d; prev = q
    }
    const f = Math.hypot(c.fwd[0], c.fwd[1]) || 1   // not enough path yet: straight behind you
    return [prev[0] - (c.fwd[0] / f) * need, prev[1], prev[2] - (c.fwd[1] / f) * need]
  }
}
