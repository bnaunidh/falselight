// The Weeper. Pure rules.
//   Never see his face — by eye, through binoculars, or on a developed print.
//   Watch him too long and the sobbing stops; a moment later he lifts his head. Look away.
//   Seen: the sob becomes a scream and he comes (in daylight he waits for dark). Nothing stops him.
//   The only way out: send the photograph away. Whoever looks at it next is the one he wants.
import { dist, lerp3, clamp } from './util.js?v=8547b0d4'

export const WEEPER = {
  watchToHush: 5.0,      // seconds of continuous watching before the sobbing stops
  hush: 1.6,             // seconds of silence before he lifts his head
  lookup: 2.4,           // seconds his head stays up
  faceSeen: 0.25,        // seconds of faceVisible that count as "seen"
  cooldown: 22,          // after a lookup, seconds before it can happen again
  scream: 14,            // seconds screaming before he moves
  approach: 330,         // seconds from his rock to the tower gate at night
  stairs: 26,            // seconds on the stairs (heard, not seen)
  hunt: 2.7,             // m/s once he's at the cab and you aren't
  catch: 2.2,            // metres
  watchRange: 140,       // metres (binoculars double it)
}

export class Weeper {
  constructor(s = {}) {
    this.state = s.state ?? 'sitting'     // sitting | hush | lookup | seen_day | screaming | coming | stairs | door | hunting | gone | caught
    this.seenBy = s.seenBy ?? null        // 'eye' | 'binoculars' | 'print'
    this.carrier = s.carrier ?? null      // print id that carries him; 'next' = the next photo of him
    this.progress = s.progress ?? 0       // 0..1 along the approach path
    this.pos = s.pos ?? null
    this.watch = 0; this.timer = 0; this.faceT = 0; this.cool = 0
    this.huntPos = null
  }
  get triggered() { return ['seen_day', 'screaming', 'coming', 'stairs', 'door', 'hunting'].includes(this.state) }
  get pose() {
    return { sitting: 'POSE_sit_sob', hush: 'POSE_sit_sob', lookup: 'POSE_sit_lookup', seen_day: 'POSE_stand', screaming: 'POSE_stand',
      coming: Math.floor(this.timer * 2.6) % 2 ? 'POSE_run_a' : 'POSE_run_b', stairs: 'POSE_run_a', door: 'POSE_crouch_door',
      hunting: 'POSE_lunge', gone: 'POSE_sit_sob', caught: 'POSE_lunge' }[this.state]
  }
  /** What the ambience should play: 'sob' | 'silent' | 'scream'. */
  get sound() { return ['sitting'].includes(this.state) ? 'sob' : ['hush', 'lookup', 'gone', 'stairs', 'door'].includes(this.state) ? 'silent' : 'scream' }

  trigger(by, { night, carrier = null } = {}) {
    if (this.triggered || this.state === 'gone' || this.state === 'caught') return false
    this.seenBy = by
    this.carrier = carrier ?? 'next'
    this.state = night ? 'screaming' : 'seen_day'
    this.timer = 0
    return true
  }
  /** A photo was taken while he's coming: it becomes the thing he follows, if nothing does yet. */
  offerCarrier(printId) { if (this.triggered && this.carrier === 'next') { this.carrier = printId; return true } return false }
  /** The carrier photo was sent away (fax / mail / the driver looked at it). */
  sendAway(printId) {
    if (!this.triggered) return false
    if (this.carrier !== printId) return false
    this.state = 'gone'; this.carrier = null
    return true
  }
  nightFell() { if (this.state === 'seen_day') { this.state = 'screaming'; this.timer = 0 } }

  /**
   * ctx: { check (engine.view.check result or null), binoculars, night, rock:[x,y,z], gate:[x,y,z], cab:[x,y,z],
   *        trapdoor:[x,y,z], player:[x,y,z], playerInCab }
   * Returns an array of events.
   */
  update(dt, ctx) {
    const ev = []
    this.timer += dt
    const c = ctx.check || {}
    const range = WEEPER.watchRange * (ctx.binoculars ? 2 : 1)
    const watching = !!(c.inFrustum && !c.occluded && (c.onScreen ?? 0) > 0.0005 && (c.distance ?? 0) < range)
    this.cool = Math.max(0, this.cool - dt)
    switch (this.state) {
      case 'sitting':
        this.pos = ctx.rock
        if (watching && this.cool <= 0) this.watch += dt * (ctx.binoculars ? 2 : 1); else this.watch = Math.max(0, this.watch - dt * 2)
        if (this.watch >= WEEPER.watchToHush) { this.state = 'hush'; this.timer = 0; ev.push('hush') }
        break
      case 'hush':
        if (!watching) { this.state = 'sitting'; this.watch = 0; this.cool = 6; ev.push('resume') }
        else if (this.timer >= WEEPER.hush) { this.state = 'lookup'; this.timer = 0; this.faceT = 0; ev.push('lookup') }
        break
      case 'lookup':
        if (c.faceVisible) this.faceT += dt
        if (this.faceT >= WEEPER.faceSeen) { this.trigger(ctx.binoculars ? 'binoculars' : 'eye', { night: ctx.night }); ev.push('seen'); break }
        if (this.timer >= WEEPER.lookup) { this.state = 'sitting'; this.watch = 0; this.cool = WEEPER.cooldown; ev.push('resume') }
        break
      case 'seen_day':
        this.pos = ctx.rock
        if (ctx.night) { this.state = 'screaming'; this.timer = 0; ev.push('scream') }
        break
      case 'screaming':
        this.pos = ctx.rock
        if (this.timer >= WEEPER.scream) { this.state = 'coming'; this.timer = 0; this.progress = 0; ev.push('coming') }
        break
      case 'coming': {
        this.progress = clamp(this.progress + dt / WEEPER.approach)
        this.pos = lerp3(ctx.rock, ctx.gate, this.progress)
        if (this.progress >= 1) { this.state = 'stairs'; this.timer = 0; ev.push('stairs') }
        break
      }
      case 'stairs':
        this.pos = lerp3(ctx.gate, ctx.trapdoor || ctx.cab, clamp(this.timer / WEEPER.stairs))
        if (this.timer >= WEEPER.stairs) { this.state = 'door'; this.timer = 0; this.pos = ctx.trapdoor || ctx.cab; ev.push('door') }
        break
      case 'door':
        if (ctx.playerInCab) { this.state = 'caught'; ev.push('caught') }
        else if (this.timer > 3) { this.state = 'hunting'; this.timer = 0; this.huntPos = (ctx.gate || this.pos).slice(); ev.push('hunting') }
        break
      case 'hunting': {
        const p = this.huntPos, q = ctx.player
        const d = dist(p, q)
        const step = Math.min(d, WEEPER.hunt * dt)
        this.huntPos = [p[0] + ((q[0] - p[0]) / (d || 1)) * step, p[1] + ((q[1] - p[1]) / (d || 1)) * step, p[2] + ((q[2] - p[2]) / (d || 1)) * step]
        this.pos = this.huntPos
        break
      }
    }
    if (['coming', 'hunting'].includes(this.state) && ctx.player && this.pos && dist(this.pos, ctx.player) < WEEPER.catch) { this.state = 'caught'; ev.push('caught') }
    return ev
  }
  /** Seconds until he reaches the cab (for pacing/tests). */
  eta() {
    if (this.state === 'coming') return (1 - this.progress) * WEEPER.approach + WEEPER.stairs
    if (this.state === 'screaming') return WEEPER.scream - this.timer + WEEPER.approach + WEEPER.stairs
    if (this.state === 'stairs') return WEEPER.stairs - this.timer
    return Infinity
  }
  toJSON() { return { state: this.state === 'hush' || this.state === 'lookup' ? 'sitting' : this.state, seenBy: this.seenBy, carrier: this.carrier, progress: this.progress } }
}

/** Chance a print of him shows POSE_sit_lookup (a scripted rule: the flash draws his face up). */
export function lookupChance({ flash = false, night = false, nth = 0 } = {}) {
  return clamp(0.3 + (flash ? 0.35 : 0) + (night ? 0.1 : 0) + nth * 0.1, 0, 0.9)
}
