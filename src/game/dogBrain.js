// FALSE LIGHT — Juniper, the stray on the spring trail. Pure rules (no three.js, no DOM): taming, following the player's
// breadcrumbs (so she climbs the tower stairs and uses the cab door the way you did), stay / come, the heater at night,
// and the hackles when the Weeper is close. src/game/dog.js is the three.js view + controller that feeds this.
// Points are [x, y, z] in three.js metres (+x east, -z north, +y up). yaw: forward = (sin yaw, 0, cos yaw).

export const DOG = {
  name: 'Juniper',
  // breadcrumbs
  crumbStep: 0.35, crumbCap: 640, saveCrumbs: 160,
  // following
  followGap: 1.6, stopNear: 1.25, trotGap: 5, teleportGap: 40, comeTeleportGap: 160, teleportJump: 3.0,
  walkSpeed: 1.25, trotSpeed: 3.7, accel: 5, decel: 9, loopSnap: 0.45, loopSnapDy: 0.35,
  sitAfter: 3, lieAfter: 20, doorLook: 0.75,   // a shut door this far ahead on the path (her nose is ~0.64 m ahead of her feet): wait
  // the stray
  wanderRange: 6, fleeRange: 38, wanderSpeed: 0.75, keep: 5, keepTrust: 2.4, keepFood: 1.2, approachFood: 1.8,
  flee: 9, jogSpeed: 2.3, lateral: 0.6, aside: 2.3, homeReturn: 70, sightRange: 24,
  // taming
  eatTime: 4.6, tameOffers: 2, tameStill: 20, stillRadius: 4.5, stillSpeed: 0.2, petTime: 2.4, trustMax: 3,
  // the Weeper
  warnRange: 60, warnRearm: 72, warnStare: 3.2,
  // the cab (interior |x|,|z| < 2.03, floor y = 30)
  cabHalf: 1.95, cabFloor: 29.4,
}

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const angWrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI }
const inCab = (p) => p[1] > DOG.cabFloor && Math.abs(p[0]) < DOG.cabHalf && Math.abs(p[2]) < DOG.cabHalf

/** Ring buffer of the player's footsteps, with absolute arc length (3-D, so stairs count). */
export class Crumbs {
  constructor(cap = DOG.crumbCap) {
    this.cap = cap; this.X = new Float64Array(cap); this.Y = new Float64Array(cap); this.Z = new Float64Array(cap); this.S = new Float64Array(cap)
    this.count = 0
  }
  clear() { this.count = 0 }
  get first() { return Math.max(0, this.count - this.cap) }
  get last() { return this.count - 1 }
  valid(i) { return i >= this.first && i <= this.last }
  s(i) { return this.S[i % this.cap] }
  push(x, y, z) {
    const i = this.count % this.cap
    let s = 0
    if (this.count) { const j = (this.count - 1) % this.cap; s = this.S[j] + Math.hypot(x - this.X[j], y - this.Y[j], z - this.Z[j]) }
    this.X[i] = x; this.Y[i] = y; this.Z[i] = z; this.S[i] = s; this.count++
    return this.count - 1
  }
  get(i, out) { const k = i % this.cap; out[0] = this.X[k]; out[1] = this.Y[k]; out[2] = this.Z[k]; return out }
  /** Arc length of the path end = last crumb + the live segment to p. */
  endS(p) { if (!this.count) return 0; const k = this.last % this.cap; return this.S[k] + Math.hypot(p[0] - this.X[k], p[1] - this.Y[k], p[2] - this.Z[k]) }
  /** Index i with S[i] <= s < S[i+1] (searching forward from hint), clamped to the valid range. */
  seek(s, hint = this.first) {
    let i = clamp(hint, this.first, this.last)
    while (i > this.first && this.s(i) > s) i--
    while (i < this.last && this.s(i + 1) <= s) i++
    return i
  }
  /** Point at arc length s; beyond the last crumb it runs along the live segment to `end`. */
  at(s, end, hint, out) {
    const i = this.seek(s, hint)
    const k = i % this.cap
    let bx, by, bz, sb
    if (i < this.last) { const k2 = (i + 1) % this.cap; bx = this.X[k2]; by = this.Y[k2]; bz = this.Z[k2]; sb = this.S[k2] }
    else { bx = end[0]; by = end[1]; bz = end[2]; sb = this.endS(end) }
    const L = sb - this.S[k], t = L > 1e-6 ? clamp((s - this.S[k]) / L, 0, 1) : 0
    out[0] = this.X[k] + (bx - this.X[k]) * t; out[1] = this.Y[k] + (by - this.Y[k]) * t; out[2] = this.Z[k] + (bz - this.Z[k]) * t
    return i
  }
  toJSON(n = DOG.saveCrumbs) {
    const a = []; const from = Math.max(this.first, this.count - n)
    for (let i = from; i <= this.last; i++) { const k = i % this.cap; a.push(+this.X[k].toFixed(2), +this.Y[k].toFixed(2), +this.Z[k].toFixed(2)) }
    return a
  }
}

/** A plain polyline for the stray's home stretch of trail. */
class Line {
  constructor(points) {
    this.p = points.map((q) => [q[0], q[1], q[2]]); this.cum = [0]
    for (let i = 1; i < this.p.length; i++) this.cum.push(this.cum[i - 1] + d2(this.p[i - 1], this.p[i]))
    this.length = this.cum[this.cum.length - 1] || 0
  }
  at(s, lat, out) {
    const P = this.p; s = clamp(s, 0, this.length)
    let lo = 0, hi = this.cum.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m }
    const a = P[lo], b = P[hi] || a, L = this.cum[hi] - this.cum[lo] || 1, t = (s - this.cum[lo]) / L
    const dx = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot(dx, dz) || 1
    out[0] = a[0] + dx * t + (-dz / dl) * lat; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + dz * t + (dx / dl) * lat
    return out
  }
  project(p, out = { s: 0, dist: 0, lat: 0 }) {
    let best = Infinity, bs = 0, bl = 0
    for (let i = 1; i < this.p.length; i++) {
      const a = this.p[i - 1], b = this.p[i], vx = b[0] - a[0], vz = b[2] - a[2], L2 = vx * vx + vz * vz || 1e-9
      const t = clamp(((p[0] - a[0]) * vx + (p[2] - a[2]) * vz) / L2, 0, 1)
      const ex = p[0] - a[0] - vx * t, ez = p[2] - a[2] - vz * t, d = Math.hypot(ex, ez)
      if (d < best) { best = d; bs = this.cum[i - 1] + t * Math.sqrt(L2); bl = (-vz * ex + vx * ez) / Math.sqrt(L2) }
    }
    out.s = bs; out.dist = best; out.lat = bl
    return out
  }
}

export class DogBrain {
  /** opts: { home: [[x,y,z]...] (the stray's stretch of trail), homeS, ground(x, z) -> y | null, snap(player, out) -> out (a free
   *  spot near a teleported player), rng } ; s = saved JSON */
  constructor(opts = {}, s = null) {
    this.opts = opts
    this.rng = opts.rng || Math.random
    this.line = new Line(opts.home && opts.home.length > 1 ? opts.home : [[0, 0, 0], [0, 0, 10]])
    this.homeS = clamp(opts.homeS ?? this.line.length / 2, 0, this.line.length)
    this.crumbs = new Crumbs(opts.crumbCap || DOG.crumbCap)
    this.events = []; this._out = []   // events: emitted any time (offer/pet/command too), handed out once by update()
    // reusable scratch (no per-frame allocations)
    this._p = [0, 0, 0]; this._q = [0, 0, 0]; this._r = [0, 0, 0]
    this.look = [0, 0, 0]; this.lastPlayer = null
    this.reset()
    if (s) this.restore(s)
  }
  reset() {
    this.tamed = false; this.trust = 0; this.offers = 0; this.mode = 'follow'
    this.hs = this.homeS; this.lat = 0; this.pos = this.line.at(this.hs, 0, [0, 0, 0]); this.yaw = 0; this.speed = 0
    this.fixY()
    this.posture = 'stand'; this.act = 'idle'; this.alert = 0; this.wag = 0; this.lookW = 0; this.hasLook = false
    this.wander = { s: this.hs, lat: 0, t: 2 + this.rng() * 3 }
    this.eatT = 0; this.petT = 0; this.stareT = 0; this.warned = false; this.weeperGoneT = 0
    this.stillT = 0; this.restT = 0; this.stayT = 0; this.tameStillT = 0; this.comeT = 0; this.coming = false
    this.sd = 0; this.ci = 0; this.detour = null; this.atHeater = false; this.lastEndS = null; this.endRate = 0; this.slope = 0
    this.sighted = false; this.shied = 0; this.hinted = false; this.snapT = 0; this.fled = false; this.asideT = 0; this.asideSide = 1
    this.doorT = 0; this.atDoor = false; this.needSnap = false; this.weeperPos = null; this.alertHold = 0; this.nextPause = 'stand'
    this.lastPlayer = null
    this.crumbs.clear()
  }
  get name() { return DOG.name }
  get state() { return this.tamed ? (this.mode === 'stay' ? 'stay' : this.atHeater ? 'heater' : 'follow') : 'stray' }
  emit(type, extra) { this.events.push(extra ? { type, ...extra } : { type }) }
  fixY() {
    if (this.opts.ground) { const g = this.opts.ground(this.pos[0], this.pos[2]); if (Number.isFinite(g)) this.pos[1] = g }
  }

  // ------------------------------------------------------------------ player actions (from the interaction prompts)
  canOffer() { return this.eatT <= 0 && this.stareT <= 0 }
  /** E with the beans in hand. Returns true if she took them. */
  offer() {
    if (!this.canOffer()) return false
    this.offers++; this.eatT = DOG.eatTime; this.posture = 'eat'; this.speed = 0
    this.trust = Math.min(DOG.trustMax, this.trust + (this.tamed ? 0.25 : 0.5))
    this.emit('ate', { offers: this.offers, tamed: this.tamed })
    return true
  }
  pet() {
    if (!this.tamed) return false
    this.petT = DOG.petTime; this.trust = Math.min(DOG.trustMax, this.trust + 0.25)
    this.emit('pet'); return true
  }
  /** 'stay' | 'come' | 'toggle' */
  command(c) {
    if (!this.tamed) return false
    if (c === 'toggle') c = this.mode === 'stay' ? 'come' : 'stay'
    if (c === 'stay') { this.mode = 'stay'; this.stayT = 0; this.detour = null; this.atHeater = false; this.emit('stay'); return true }
    this.mode = 'follow'; this.coming = true; this.comeT = 2.5; this.stillT = 0
    if (!this.crumbs.count || this.sd < this.crumbs.s(this.crumbs.first) - 1e-6) this.needSnap = true
    this.emit('come'); return true
  }
  tame() {
    if (this.tamed) return
    this.tamed = true; this.mode = 'follow'; this.trust = Math.max(this.trust, 1)
    this.crumbs.clear(); this.crumbs.push(this.pos[0], this.pos[1], this.pos[2]); this.sd = 0; this.ci = 0
    this.emit('tamed', { name: DOG.name })
  }

  // ------------------------------------------------------------------ per frame
  /** ctx: { player:[x,y,z], vel:[vx,vz], jog, food, night, zone, weeper:[x,y,z]|null, heater:{pos:[x,y,z], yaw}|null, play } */
  update(dt, ctx) {
    const out = this._out; out.length = 0
    if (dt <= 0) return out
    dt = Math.min(dt, 0.1)
    const pl = ctx.player
    const pSpeed = ctx.vel ? Math.hypot(ctx.vel[0], ctx.vel[1]) : 0
    // the player teleported (new phase, checkpoint, test hooks)
    let jumped = false
    if (this.lastPlayer) jumped = d3(this.lastPlayer, pl) > DOG.teleportJump
    else this.lastPlayer = [0, 0, 0]
    this.lastPlayer[0] = pl[0]; this.lastPlayer[1] = pl[1]; this.lastPlayer[2] = pl[2]
    // breadcrumbs (only once she's yours)
    if (this.tamed) {
      if (jumped || !this.crumbs.count) this.onPlayerJump(pl)
      else { const c = this.crumbs.get(this.crumbs.last, this._q); if (d3(c, pl) >= DOG.crumbStep) this.crumbs.push(pl[0], pl[1], pl[2]) }
    }
    this.playerStill = pSpeed < DOG.stillSpeed
    this.stillT = this.playerStill ? this.stillT + dt : 0
    // timers
    if (this.eatT > 0) { this.eatT -= dt; if (this.eatT <= 0) this.doneEating() }
    if (this.petT > 0) this.petT -= dt
    if (this.comeT > 0) this.comeT -= dt
    this.weeperTick(dt, ctx)
    const dist = d2(this.pos, pl)
    let target = 0   // desired speed along whatever she's walking
    if (this.stareT > 0) { this.stareT -= dt; target = 0 }
    else if (!this.tamed) target = this.strayTick(dt, ctx, dist, pSpeed)
    else target = this.tamedTick(dt, ctx, dist, pSpeed)
    // look + wag + alert (the view smooths these)
    this.hasLook = false
    if (this.weeperPos && (this.stareT > 0 || this.alertHold > 0)) { this.setLook(this.weeperPos[0], this.weeperPos[1] + 1.2, this.weeperPos[2]); this.lookW = 1 }
    else if (this.posture !== 'eat' && dist < (this.tamed ? 5 : 16) && Math.abs(pl[1] - this.pos[1]) < 3) { this.setLook(pl[0], pl[1] + 1.5, pl[2]); this.lookW = this.tamed ? 1 : 0.8 }
    else this.lookW = 0
    const wagT = this.alertHold > 0 ? 0 : this.petT > 0 ? 1 : this.comeT > 0 ? 0.6 : this.tamed ? (dist < 3 ? 0.4 : 0.12) : (ctx.food && dist < 8 ? 0.18 : 0)
    this.wag += (wagT - this.wag) * Math.min(1, dt * 3)
    const alertT = this.alertHold > 0 ? 1 : !this.tamed && this.fled ? 0.3 : 0
    this.alert += (alertT - this.alert) * Math.min(1, dt * (alertT > this.alert ? 4 : 0.8))
    for (let i = 0; i < this.events.length; i++) out.push(this.events[i])
    this.events.length = 0
    return out
  }

  weeperTick(dt, ctx) {
    const w = ctx.weeper
    this.weeperPos = w || null
    const d = w ? d3(w, this.pos) : Infinity
    if (d <= DOG.warnRange) {
      this.weeperGoneT = 0; this.alertHold = 1
      if (!this.warned) {
        this.warned = true; this.stareT = DOG.warnStare; this.speed = 0
        if (this.posture === 'lie' || this.posture === 'eat') this.posture = 'stand'
        // playerDistance lets the game decide whether you could have seen it (a stray freezing 100 m away isn't news)
        this.emit('warn', { distance: d, tamed: this.tamed, playerDistance: d3(ctx.player, this.pos) })
      }
      // stare down the thing: turn to face it while standing still
      if (this.stareT > 0) this.turnTo(Math.atan2(w[0] - this.pos[0], w[2] - this.pos[2]), dt, 3)
    } else {
      this.alertHold = 0
      if (d > DOG.warnRearm || !w) { this.weeperGoneT += dt; if (this.weeperGoneT > 2) this.warned = false }
    }
  }

  doneEating() {
    this.posture = 'stand'
    if (!this.tamed && this.offers >= DOG.tameOffers) this.tame()
    else if (!this.tamed) this.emit('offer1')
  }

  // ------------------------------------------------------------------ the stray
  strayTick(dt, ctx, dist, pSpeed) {
    const pl = ctx.player, L = this.line
    if (!this.sighted && dist < DOG.sightRange && Math.abs(pl[1] - this.pos[1]) < 6) { this.sighted = true; this.emit('sighted') }
    // 1 offering + standing still near her = hers
    if (this.offers >= 1 && dist < DOG.stillRadius && this.playerStill && this.eatT <= 0) {
      this.tameStillT += dt
      if (this.tameStillT >= DOG.tameStill) { this.tame(); return 0 }
    } else this.tameStillT = Math.max(0, this.tameStillT - dt * 0.5)
    if (this.eatT > 0) { this.posture = 'eat'; this.act = 'eat'; return this.moveLine(dt, this.hs, this.lat, 0) }
    const ps = L.project(pl, this._proj || (this._proj = { s: 0, dist: 0, lat: 0 }))
    const vx = ctx.vel ? ctx.vel[0] : 0, vz = ctx.vel ? ctx.vel[1] : 0
    const toDogX = this.pos[0] - pl[0], toDogZ = this.pos[2] - pl[2], toDogL = Math.hypot(toDogX, toDogZ) || 1
    const at = pSpeed > 0.1 ? (vx * toDogX + vz * toDogZ) / (pSpeed * toDogL) : 0
    const jogAt = pSpeed > DOG.jogSpeed && at > 0.5 && dist < 14
    const near = ps.dist < 12 && Math.abs(pl[1] - this.pos[1]) < 4
    const keep = ctx.food && !jogAt && pSpeed < 1.7 ? DOG.keepFood : this.trust > 0 ? DOG.keepTrust : DOG.keep
    const lo = Math.max(0, this.homeS - DOG.fleeRange), hi = Math.min(L.length, this.homeS + DOG.fleeRange)
    // run from a jogger, back off from a walker, edge closer to a tin of beans
    if (near && (jogAt || dist < keep)) {
      const away = ps.s < this.hs ? 1 : -1
      const want = jogAt ? DOG.flee : keep + 1.2
      const ts = clamp(this.hs + away * Math.max(0.6, want - dist + 1), lo, hi)
      this.fled = true
      // run out of trail (the end of her range)? step off into the brush and let you pass
      if (this.asideT > 0 || (away > 0 ? this.hs > hi - 0.6 : this.hs < lo + 0.6)) {
        if (!(this.asideT > 0)) this.asideSide = ps.lat > 0 ? -1 : 1
        this.asideT = 3; this.act = 'aside'; this.posture = 'stand'
        this.turnTo(Math.atan2(pl[0] - this.pos[0], pl[2] - this.pos[2]), dt, 3)
        return this.moveLine(dt, this.hs, this.asideSide * DOG.aside, 1.7)
      }
      if (!this.hinted && !ctx.food && !this.offers) { this.shied += dt; if (this.shied > 2.5) { this.hinted = true; this.emit('shy') } }
      this.act = 'flee'; this.posture = 'stand'
      this.wander.s = ts; this.wander.t = 3 + this.rng() * 3
      return this.moveLine(dt, ts, this.lat * 0.9, jogAt ? DOG.trotSpeed : 1.6)
    }
    if (near && ctx.food && pSpeed < 0.8 && dist > DOG.approachFood + 0.3 && dist < 9) {
      // the smell of beans: come most of the way
      const dir = ps.s > this.hs ? 1 : -1
      const ts = clamp(ps.s - dir * DOG.approachFood, lo, hi)
      this.act = 'approach'; this.posture = 'stand'
      return this.moveLine(dt, ts, clamp(-this.lat, -0.3, 0.3), 0.7)
    }
    // too far from home (player gone): drift back; otherwise wander and pause
    this.fled = false
    if (this.asideT > 0) {   // wait in the brush until you're well past, then back onto the trail
      this.asideT -= dt; this.act = 'aside'
      if (this.asideT > 0 || dist < keep + 2) { this.asideT = Math.max(this.asideT, dist < keep + 2 ? 0.5 : 0); return this.moveLine(dt, this.hs, this.lat, 0) }
      this.wander.lat = (this.rng() * 2 - 1) * DOG.lateral; this.wander.s = this.hs
    }
    if (Math.abs(this.hs - this.homeS) > DOG.wanderRange + 2 && dist > 14) { this.wander.s = this.homeS + (this.rng() - 0.5) * DOG.wanderRange; this.wander.t = 0 }
    if (near && dist < 10) {   // someone is watching: stand and watch back
      this.act = 'watch'
      if (this.posture === 'eat') this.posture = 'stand'
      this.turnTo(Math.atan2(pl[0] - this.pos[0], pl[2] - this.pos[2]), dt, 2)
      return this.moveLine(dt, this.hs, this.lat, 0)
    }
    const w = this.wander
    if (Math.abs(w.s - this.hs) > 0.25 || Math.abs(w.lat - this.lat) > 0.1) {
      this.act = 'wander'; this.posture = 'stand'
      return this.moveLine(dt, w.s, w.lat, DOG.wanderSpeed)
    }
    w.t -= dt
    this.act = 'idle'
    if (w.t <= 0) {
      w.s = clamp(this.homeS + (this.rng() * 2 - 1) * DOG.wanderRange, lo, hi)
      w.lat = (this.rng() * 2 - 1) * DOG.lateral
      w.t = 3 + this.rng() * 6
      const r = this.rng(); this.nextPause = r < 0.55 ? 'stand' : r < 0.8 ? 'sit' : 'eat'
    } else if (w.t < 8) this.posture = this.nextPause || 'stand'
    return this.moveLine(dt, this.hs, this.lat, 0)
  }
  /** Walk along the home line toward (ts, tlat) at up to vmax. */
  moveLine(dt, ts, tlat, vmax) {
    const ds = ts - this.hs, dl = tlat - this.lat
    const want = Math.hypot(ds, dl) > 0.05 ? vmax : 0
    this.accelTo(want, dt)
    if (this.speed > 0.01) {
      const L = Math.hypot(ds, dl) || 1, step = Math.min(this.speed * dt, L)
      this.hs += (ds / L) * step; this.lat += (dl / L) * step
      this.line.at(this.hs, this.lat, this._p)
      const hy = Math.atan2(this._p[0] - this.pos[0], this._p[2] - this.pos[2])
      if (Math.hypot(this._p[0] - this.pos[0], this._p[2] - this.pos[2]) > 1e-4) this.turnTo(hy, dt, 6)
      this.pos[0] = this._p[0]; this.pos[1] = this._p[1]; this.pos[2] = this._p[2]; this.fixY()
    }
    return this.speed
  }

  // ------------------------------------------------------------------ yours
  tamedTick(dt, ctx, dist, pSpeed) {
    const pl = ctx.player, C = this.crumbs
    if (this.needSnap) { this.needSnap = false; this.snapTo(pl) }
    if (this.eatT > 0) { this.posture = 'eat'; this.act = 'eat'; this.accelTo(0, dt); return 0 }
    // stay: hold the spot; sit, then lie down
    if (this.mode === 'stay') {
      this.act = 'stay'; this.accelTo(0, dt); this.stayT += dt
      this.posture = this.stayT > DOG.lieAfter ? 'lie' : 'sit'
      return 0
    }
    // night in the cab: the rug by the heater
    const heater = ctx.heater
    const wantHeater = ctx.night && heater && ctx.zone === 'cab' && inCab(pl)
    if (wantHeater && (inCab(this.pos) || this.atHeater || (this.detour && this.detour.then === 'heater'))) {
      if (!this.atHeater && !(this.detour && this.detour.then === 'heater')) this.detour = { to: heater.pos.slice(), then: 'heater' }
      if (this.detour) return this.detourTick(dt, heater)
      this.act = 'heater'; this.posture = 'lie'; this.turnTo(heater.yaw, dt, 2); this.accelTo(0, dt)
      return 0
    }
    if (this.atHeater || (this.detour && this.detour.then === 'heater')) {
      // the player left the cab (or it's day): get up and step back onto the path
      this.atHeater = false; this.posture = 'stand'
      const j = this.nearestCrumb(this.pos, 3.2, 90)
      if (j >= 0) this.detour = { to: C.get(j, [0, 0, 0]), then: 'path', s: C.s(j), i: j }
      else { this.detour = null; this.snapTo(pl) }
    }
    if (this.detour) return this.detourTick(dt, null)
    // follow the breadcrumbs
    if (this.sd < C.s(C.first)) { this.snapTo(pl) }
    let gap = C.endS(pl) - this.sd
    // a shut door on the path just ahead (you closed it between you): she waits at it, and doesn't teleport through it
    if (this.doorAhead(pl)) {
      this.speed = 0; this.slope = 0; this.act = 'door'; this.doorT += dt
      // it swung shut in her face (she was already inside the look-ahead): ease back along her own path until her nose is clear
      if (this.sd > C.s(C.first) + 0.02) {
        C.at(this.sd + DOG.doorLook - 0.05, pl, this.ci, this._q)
        if (this.opts.blocked(this.pos, this._q)) { this.sd = Math.max(C.s(C.first), this.sd - 0.45 * dt); this.ci = C.at(this.sd, pl, this.ci, this.pos) }
      }
      if (!this.atDoor) { this.atDoor = true; this.emit('door', { tamed: true }) }
      this.posture = this.doorT > 4 ? 'sit' : 'stand'
      return 0
    }
    if (this.atDoor) { this.atDoor = false; this.doorT = 0; this.lastEndS = null }
    const tele = this.coming ? DOG.comeTeleportGap : DOG.teleportGap
    if (gap > tele) { this.snapTo(pl); gap = C.endS(pl) - this.sd }
    // cut out loops (the player doubled back past her)
    this.snapT -= dt
    if (this.snapT <= 0) { this.snapT = 0.2; this.cutLoops() }
    const endS = C.endS(pl)
    gap = endS - this.sd
    // feed-forward: how fast the end of the path is running away from her (your speed along it)
    const rate = this.lastEndS == null ? 0 : clamp((endS - this.lastEndS) / dt, 0, 6)
    this.lastEndS = endS
    this.endRate += (rate - this.endRate) * Math.min(1, dt * 6)
    const behind = gap - DOG.followGap
    const vmax = behind > DOG.trotGap ? DOG.trotSpeed : Math.max(DOG.walkSpeed, pSpeed * 1.2, this.endRate * 1.2)
    let want = behind > 0 ? clamp(this.endRate + behind * 2.2, 0, vmax) : 0
    if (d3(this.pos, pl) < DOG.stopNear && gap < DOG.followGap + 2.5) want = 0
    if (this.alertHold > 0) want = Math.min(want, 2.4)   // slinking past the creek
    this.accelTo(want, dt)
    if (this.speed > 0.01 && behind > 0) {
      const step = Math.min(this.speed * dt, behind)
      this.sd += step
      const prev = this._r; prev[0] = this.pos[0]; prev[1] = this.pos[1]; prev[2] = this.pos[2]
      this.ci = C.at(this.sd, pl, this.ci, this.pos)
      const mx = this.pos[0] - prev[0], mz = this.pos[2] - prev[2]
      if (Math.hypot(mx, mz) > 1e-4) this.turnTo(Math.atan2(mx, mz), dt, 7)
      this.slope = clamp((this.pos[1] - prev[1]) / Math.max(1e-4, Math.hypot(mx, mz)), -1.2, 1.2)
    } else this.slope = 0
    if (this.coming && gap < DOG.followGap + 1) this.coming = false
    // posture: stand while moving; sit 3 s after you stop, lie down after 20
    if (this.speed > 0.08 || !this.playerStill) { this.restT = 0; this.posture = 'stand'; this.act = this.speed > 2.2 ? 'trot' : this.speed > 0.08 ? 'follow' : 'wait' }
    else {
      this.restT += dt
      this.posture = this.stillT >= DOG.lieAfter ? 'lie' : this.stillT >= DOG.sitAfter ? 'sit' : 'stand'
      this.act = 'rest'
      if (this.posture !== 'lie' && dist > 0.5) this.turnTo(Math.atan2(pl[0] - this.pos[0], pl[2] - this.pos[2]), dt, 1.5)
    }
    return this.speed
  }
  detourTick(dt, heater) {
    const to = this.detour.to
    const dx = to[0] - this.pos[0], dy = to[1] - this.pos[1], dz = to[2] - this.pos[2], L = Math.hypot(dx, dz)
    this.posture = 'stand'; this.act = this.detour.then === 'heater' ? 'to-heater' : 'rejoin'
    if (L < 0.06) {
      this.pos[0] = to[0]; this.pos[1] = to[1]; this.pos[2] = to[2]
      if (this.detour.then === 'heater') { this.atHeater = true; this.detour = null; this.posture = 'lie'; this.accelTo(0, dt); if (heater) this.turnTo(heater.yaw, dt, 3) }
      else { this.sd = this.detour.s; this.ci = this.detour.i; this.detour = null }
      return 0
    }
    this.accelTo(Math.min(DOG.walkSpeed, L * 2 + 0.3), dt)
    this.slope = 0
    const step = Math.min(this.speed * dt, L)
    this.pos[0] += (dx / L) * step; this.pos[2] += (dz / L) * step; this.pos[1] += dy * (step / L)
    this.turnTo(Math.atan2(dx, dz), dt, 6)
    return this.speed
  }
  /** opts.blocked(a, b): is the straight move a -> b through something shut (the cab door)? Checked from her feet to a point
   *  on the path a nose-length (+ a little braking room) ahead. */
  doorAhead(pl) {
    const C = this.crumbs
    if (!this.opts.blocked || !C.count) return false
    C.at(this.sd + DOG.doorLook + this.speed * 0.25, pl, this.ci, this._q)
    return !!this.opts.blocked(this.pos, this._q)
  }
  /** Newest crumb within r of p (same floor), looking back at most `back` crumbs. -1 if none. */
  nearestCrumb(p, r, back = 200) {
    const C = this.crumbs, q = this._q
    let best = -1, bd = r
    for (let i = C.last; i >= Math.max(C.first, C.last - back); i--) {
      C.get(i, q)
      if (Math.abs(q[1] - p[1]) > 0.5) continue
      if (inCab(p) !== inCab(q)) continue   // never through a wall
      const d = d2(q, p); if (d < bd) { bd = d; best = i }
    }
    return best
  }
  cutLoops() {
    const C = this.crumbs, q = this._q
    for (let i = C.last; i > this.ci + 2; i--) {
      C.get(i, q)
      if (Math.abs(q[1] - this.pos[1]) < DOG.loopSnapDy && d2(q, this.pos) < DOG.loopSnap) {
        if (C.s(i) > this.sd) { this.sd = C.s(i); this.ci = i }
        return
      }
    }
  }
  onPlayerJump(pl) {
    this.crumbs.clear()
    if (this.mode === 'stay') { this.crumbs.push(pl[0], pl[1], pl[2]); this.sd = -1; this.ci = 0; return }
    this.snapTo(pl)
  }
  /** Put her right behind a player who's somewhere she can't walk to (teleport, lost path). */
  snapTo(pl) {
    const out = this._p
    if (this.opts.snap) this.opts.snap(pl, out); else { out[0] = pl[0]; out[1] = pl[1]; out[2] = pl[2] }
    this.crumbs.clear()
    this.crumbs.push(out[0], out[1], out[2])
    if (d3(out, pl) > 0.05) this.crumbs.push(pl[0], pl[1], pl[2])
    this.pos[0] = out[0]; this.pos[1] = out[1]; this.pos[2] = out[2]
    this.sd = 0; this.ci = 0; this.detour = null; this.atHeater = false; this.speed = 0; this.coming = false; this.lastEndS = null; this.endRate = 0
    this.yaw = Math.atan2(pl[0] - out[0], pl[2] - out[2]) || this.yaw
    this.emit('teleport')
  }

  // ------------------------------------------------------------------ helpers
  accelTo(v, dt) { const a = v > this.speed ? DOG.accel : DOG.decel; this.speed += clamp(v - this.speed, -a * dt, a * dt); if (this.speed < 0) this.speed = 0 }
  turnTo(y, dt, rate) { const d = angWrap(y - this.yaw); this.yaw = angWrap(this.yaw + clamp(d, -rate * dt, rate * dt)) }
  setLook(x, y, z) { this.look[0] = x; this.look[1] = y; this.look[2] = z; this.hasLook = true }

  // ------------------------------------------------------------------ save / load
  toJSON() {
    return { v: 1, tamed: this.tamed, trust: +this.trust.toFixed(2), offers: this.offers, mode: this.mode,
      pos: this.pos.map((v) => +v.toFixed(3)), yaw: +this.yaw.toFixed(3), posture: this.posture, hs: +this.hs.toFixed(2), lat: +this.lat.toFixed(2),
      tameStillT: +this.tameStillT.toFixed(1), sighted: this.sighted, hinted: this.hinted, stayT: +this.stayT.toFixed(1),
      crumbs: this.tamed ? this.crumbs.toJSON() : [], sd: this.tamed ? +(this.sd - this.firstSavedS()).toFixed(3) : 0,
      // she's off the saved stretch of your path (staying far back, or you jumped): "Come" must put her with you, not on it
      lost: this.tamed && (!this.crumbs.count || this.sd < this.firstSavedS() - 1e-6) }
  }
  firstSavedS() { const C = this.crumbs; return C.count ? C.s(Math.max(C.first, C.count - DOG.saveCrumbs)) : 0 }
  restore(s) {
    if (!s || typeof s !== 'object') return
    this.reset()
    const num = (v, d = 0) => (Number.isFinite(v) ? v : d)
    this.tamed = !!s.tamed; this.trust = clamp(num(s.trust), 0, DOG.trustMax); this.offers = num(s.offers); this.mode = s.mode === 'stay' ? 'stay' : 'follow'
    if (Array.isArray(s.pos) && s.pos.length === 3 && s.pos.every(Number.isFinite)) { this.pos[0] = s.pos[0]; this.pos[1] = s.pos[1]; this.pos[2] = s.pos[2] }
    this.yaw = num(s.yaw); this.posture = ['stand', 'sit', 'lie'].includes(s.posture) ? s.posture : 'stand'
    this.hs = clamp(num(s.hs, this.homeS), 0, this.line.length); this.lat = clamp(num(s.lat), -DOG.aside, DOG.aside); this.wander.s = this.hs; this.wander.lat = this.lat
    this.tameStillT = num(s.tameStillT); this.sighted = !!s.sighted; this.hinted = !!s.hinted; this.stayT = num(s.stayT)
    if (this.tamed) {
      const a = Array.isArray(s.crumbs) ? s.crumbs : []
      for (let i = 0; i + 2 < a.length; i += 3) if (Number.isFinite(a[i]) && Number.isFinite(a[i + 1]) && Number.isFinite(a[i + 2])) this.crumbs.push(a[i], a[i + 1], a[i + 2])
      if (this.crumbs.count) {
        this.sd = clamp(num(s.sd), 0, this.crumbs.s(this.crumbs.last)); this.ci = this.crumbs.seek(this.sd, 0)
        if (s.lost) this.sd = -1   // not on the saved path: follow = snap behind you; stay -> "Come" = snap (see command())
        this.lastPlayer = this.crumbs.get(this.crumbs.last, [0, 0, 0])   // a player restored somewhere else = a jump
      }
      else this.needSnap = this.mode !== 'stay'
      if (this.mode === 'stay') this.posture = this.stayT > DOG.lieAfter ? 'lie' : 'sit'
    }
  }
}
