// FALSE LIGHT — wildlife, the pure rules (no three.js, no DOM; node-testable): three small groups of Columbian black-tailed
// deer, one American black bear, and the ambient calls around the player (birds by day; an owl, far coyotes and a rare elk by
// night — all of it silent while the Weeper is near). src/game/wildlife.js is the three.js view + controller that feeds it.
// Points are [x, y, z] three.js metres (+x east, -z north, +y up); yaw: forward = (sin yaw, 0, cos yaw), as in dogBrain.js.
//
//   const brain = new WildlifeBrain(opts, saved?)      // opts: see the constructor; resolvePlaces(layout) builds most of them
//   const events = brain.update(dt, ctx)                // POOLED objects: handle them before the next update()
//   ctx = { player:[x,y,z], vel:[vx,vz], jog, playerSafe, indoor, night, rain, weeper:[x,y,z]|null, weeperTriggered,
//           dog:{ pos:[x,y,z], tamed }|null }
//   events: { type:'sfx', name, pos:[x,y,z], volume } · { type:'hurt', amount, why } · { type:'fear', amount }
//           { type:'say', text } · { type:'toast', text, s } · { type:'dogSwat', pos:[x,y,z] }
//
// The bear, as a readable state machine (bear.state):
//   calm ──(you within ~30 m; 18 m if you're still, 40 m if you jog)──> notice ──> rear (sniffs) ──> huff (huff / jaw-pop / woof)
//   huff ──(you back off, stand still, or it runs out of patience)──> leave ──> calm (ignores you for a while)
//   huff ──(you keep coming inside 10 m, or run at it; or you're within 5 m)──> bluff (charges, stops ~3 m short: fear 0.6) ──> standoff
//   standoff ──(you keep closing inside 4 m, or the dog keeps harassing it)──> swat (a lunge: hurt 0.35 + fear 1 if it reaches
//     you, a miss if you got clear) ──> leave (retreats).   You up the tower, inside the fence or inside the shed's walls are
//     'safe': it notices you at 16 m and huffs, but never charges or swats.
//   any ──(the Weeper within 80 m)──> flee.   A tamed dog within 25 m barks every 1-2 s; the bear may charge her (dogcharge).
//   While calm the bear runs a task: forage (day range: burn-scar edge + hikers' camp) · visit (a night walk up the trail to the
//   tower clearing) · sniff (round the generator shed) · return. It never enters the fenced tower base, so never the stairs.

export const WILD = {
  // ---------------------------------------------------------------- world
  edgeMargin: 30,          // m kept inside the terrain's edge
  fence: 8.5,              // half-size of the square round the tower no animal enters (the stair-foot fence is at +-6)
  shedRadius: 3.2,         // the generator shed's walls (a circle nothing walks into; the shed is 2.4 x 3 m round its centre)
  shedShelter: 2.0,        // you within this of the shed's centre are inside its walls: the bear huffs at the wall, never charges or swats through it
  // ---------------------------------------------------------------- view (wildlife.js)
  hideRange: 220,          // animals further than this from the camera are hidden (and not animated)
  lodNear: 45, lodEvery: 4, // beyond lodNear the mixers update 1 frame in lodEvery
  // metres travelled per gait cycle, as baked in Blender (char_deer.py / char_bear.py log them: "strides (m per cycle)" =
  // WALK S/Dty, RUN S/Dty). The GLBs are exported without extras, so these numbers are the only source: keep them in step.
  stride: { deer: { walk: 0.645, run: 2.5 }, bear: { walk: 0.781, run: 2.5 } },
  // ---------------------------------------------------------------- deer
  deer: {
    walkSpeed: 0.6, runSpeed: 7.5, accel: 6, decel: 8, turn: 2.6, turnRun: 4.5, probe: 2.2,
    maxSlope: 0.5, hardSlope: 0.85, rockAvoid: 45,
    graze: [7, 20], idle: [2.5, 6], hop: [3, 11], range: 22, keepFawn: 5, keepDoe: 9, homePull: 0.08,
    alertRange: 25, alertHyst: 5, alertCalm: 5, calmStill: 7, stillSpeed: 0.25, acceptSlack: 3,
    fleeRange: 12, jogRange: 35, jogSpeed: 2.2, dogRange: 15, weeperRange: 60,
    flee: [40, 80], fleeMax: 16, fleeArrive: 1.6, wary: [6, 12],
    snortEvery: [3.5, 7], bleatChance: 0.6, snortVol: 1.0, bleatVol: 0.8, head: 1.0,
  },
  // where they graze: open ground near a place in layout.places ('tower' = the lookout). members: [role, scale]
  deerGroups: [
    { id: 'burn', at: 'burn_scar', off: [-27, -27], members: [['doe', 1], ['fawn', 0.6]] },            // burn-scar meadow
    { id: 'meadow', at: 'tower', off: [38, 48], members: [['doe', 1], ['doe', 0.94]] },               // below the meadow bench, 60 m from the cab
    { id: 'creek', at: 'creek_bridge', off: [-94, 9], members: [['doe', 1], ['fawn', 0.62]] },        // the flats by the creek ford
  ],
  // ---------------------------------------------------------------- the bear
  bear: {
    walkSpeed: 0.95, travelSpeed: 1.3, runSpeed: 6.5, chargeSpeed: 7.5, swatSpeed: 7, accel: 7, decel: 16, turn: 1.8, turnRun: 3.4, probe: 2.6,
    maxSlope: 0.65, hardSlope: 1.0, rockAvoid: 40, head: 0.8,
    forage: [10, 26], rearIdle: 0.03, rearIdleTime: 3,                 // rearIdle: chance per second, while nosing about, of standing to sniff
    noticeRange: 30, noticeStill: 18, noticeJog: 40, noticeSafe: 16, noticeTime: 1.3, loseRange: 40, jogSpeed: 2.2, stillSpeed: 0.25,
    rearTime: 3.2,
    huffTime: 10, huffEvery: [1.0, 1.9], backoff: 3, stillCalm: 5,
    // bluffClosing: inside bluffRange it charges only if you are still coming at it (m/s toward it) — a bear that wanders up to
    // someone standing still huffs and goes; surprise: this close it charges even a still player
    bluffRange: 10, bluffClosing: 0.3, surprise: 5, runAtRange: 20, runAtClosing: 1.5, bluffStop: 3, bluffMax: 4, bluffFear: 0.6, maxBluffs: 2,
    standoffTime: 7, standoffEvery: [0.7, 1.3],
    // the swat: a lunge that starts at swatLunge0 of swatSpeed and lands inside swatReach; if the lunge runs out (swatLunge s)
    // with you further than swatReach + swatMiss (you got away), it misses: no hurt, and it goes
    swatRange: 4, swatClosing: 0.35, swatHard: 2, swatReach: 1.5, swatMiss: 0.8, swatLunge: 0.7, swatLunge0: 0.5, swatHurt: 0.35, swatFear: 1, swatMissFear: 0.6,
    leave: [35, 55], retreatRun: 14, provoke: 5, ignore: 35, ignoreSwat: 60, restoreGrace: 10, leaveMax: 60,
    mood: { bluff: 0.3, swat: 0.5, dog: 0.15, decay: 0.004, range: 0.3, patience: 0.4 },   // mood 0..1: shorter fuse, longer reach
    dogChaseRange: 12, dogChargeChance: 0.35, dogChase: 2.5, dogChaseStop: 2.2, dogChargeCool: 10,
    dogHarassRange: 4.5, dogHarassTime: 5, playerSwatNear: 5,   // the dog in its face: it swats HER, unless you are this close (then you: the lunge must still reach)
    spotClear: 25,         // after an encounter it picks its next spot so the walk there keeps at least this far from you
    weeperRange: 80, weeperFlee: [60, 90], fleeArrive: 1.5,
    visitChance: 0.85, visitDelay: [40, 160], lookahead: 4, towerStop: 16, sniff: [45, 90], sniffAt: [5, 10], sniffRear: 0.08,
    snuffle: [14, 30], snuffleRange: 45, snuffleVol: 0.35, huffVol: 1.1, woofVol: 1.2, popVol: 1.0, growlVol: 1.3,
  },
  bearStart: 0,            // index into bearSpots
  bearSpots: [             // day range: the burn-scar edge and round the hikers' camp (the camp -> burn trail runs between them)
    ['burn_scar', 48, 18], ['burn_scar', -40, 45], ['burn_scar', -50, -25], ['burn_scar', 20, -45], ['burn_scar', 12, 62],
    ['hikers_camp', 18, -12], ['hikers_camp', -22, 10], ['hikers_camp', 6, -36],
  ],
  shedSpots: [['generator_shed', 6, -3], ['generator_shed', 5, 5], ['generator_shed', -0.5, 6]],
  nightRoute: [['loop_burn_to_spring', 1], ['loop_spring_to_J1', 1], ['tower_to_J1', -1]],   // trail segments, direction
  // ---------------------------------------------------------------- the dog
  dogBark: [1, 2], dogBarkRange: 25, firstBark: 0.35, barkVol: 1,
  // ---------------------------------------------------------------- ambient life (sound only, positional, around the player)
  ambient: {
    weeperHush: 120, resume: [25, 45], indoor: 0.5, rainDay: 0.85, rainNight: 0.6, minActivity: 0.08, start: [3, 10],
    day: { every: [10, 30], quietChance: 0.22, quiet: [25, 55], species: [
      { name: 'jay', w: 0.22, calls: [2, 4], gap: [0.35, 0.9], dist: [25, 80], h: [4, 14], vol: 3.9, cool: 0 },
      { name: 'raven', w: 0.14, calls: [1, 3], gap: [0.9, 1.8], dist: [40, 90], h: [14, 32], vol: 4.0, cool: 0 },
      { name: 'thrush', w: 0.24, calls: [1, 2], gap: [4, 8], dist: [30, 90], h: [4, 12], vol: 1.9, cool: 0 },
      { name: 'chickadee', w: 0.24, calls: [2, 3], gap: [0.8, 2], dist: [20, 50], h: [2, 8], vol: 2.3, cool: 0 },
      { name: 'woodpecker', w: 0.16, calls: [1, 2], gap: [2, 5], dist: [30, 90], h: [4, 12], vol: 5.7, cool: 0 },
    ] },
    night: { every: [12, 35], quietChance: 0.15, quiet: [30, 60], species: [
      { name: 'owl', w: 0.7, calls: [1, 2], gap: [4, 8], dist: [30, 90], h: [6, 16], vol: 1.45, cool: 0 },
      { name: 'coyote', w: 0.23, calls: [1, 1], gap: [1, 1], dist: [78, 90], h: [0.5, 2], vol: 3.0, cool: 90 },
      { name: 'elk_bugle', w: 0.07, calls: [1, 1], gap: [1, 1], dist: [82, 90], h: [1, 2.5], vol: 2.9, cool: 300 },
    ] },
  },
  // ---------------------------------------------------------------- lines (each said once per game; {dog} = her name)
  lines: {
    deerFirst: 'Deer. A doe has her head up and her ears on you, one forefoot lifted.',
    bearFirst: 'A black bear. Don\'t run. Stand still, or back away slowly.',
    bearBluff: 'It comes at you in a rush of black and stops dead, three metres off, blowing and popping its jaw.',
    bearSwat: 'The paw catches you across the ribs and throws you sideways.',
    bearShed: 'Something big is moving around the generator shed. A bear, nosing along the wall.',
    dogSwat: 'The bear swats at {dog}. A yelp, and she bolts back to you.',
  },
}

const TAU = Math.PI * 2
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const angWrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI }
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** Distance from (px, pz) to the segment (ax, az)-(bx, bz). */
const segDist = (ax, az, bx, bz, px, pz) => {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz, t = L2 > 1e-9 ? clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1) : 0
  return Math.hypot(px - ax - vx * t, pz - az - vz * t)
}
const OFFS = [0, 0.35, -0.35, 0.75, -0.75, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3, Math.PI]
const HUFFS = ['bear_huff', 'bear_jawpop', 'bear_woof']
const NUDGE = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5]
const ENGAGED = { notice: 1, rear: 1, huff: 1, bluff: 1, standoff: 1, swat: 1, dogcharge: 1 }
const CHARGEABLE = { calm: 1, notice: 1, rear: 1, huff: 1 }
const FALLBACK = { tower: [0, 0], burn_scar: [-158, 22], hikers_camp: [-118, 150], creek_bridge: [34, 176], generator_shed: [9, 7], spring: [-58, 74] }

/** A polyline (the bear's night route) with arc length. */
export class Path {
  constructor(points) {
    this.p = points.map((q) => [q[0], q.length > 2 ? q[1] : 0, q.length > 2 ? q[2] : q[1]])
    this.cum = [0]
    for (let i = 1; i < this.p.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][2] - this.p[i - 1][2]))
    this.length = this.cum[this.cum.length - 1] || 0
  }
  at(s, out) {
    const P = this.p, C = this.cum; s = clamp(s, 0, this.length)
    let lo = 0, hi = C.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m }
    const a = P[lo], b = P[hi] || a, L = C[hi] - C[lo] || 1, t = clamp((s - C[lo]) / L, 0, 1)
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t
    return out
  }
  /** Arc length of the point nearest (x, z), looking only at pieces that overlap [s0, s1]. */
  project(x, z, s0 = -Infinity, s1 = Infinity) {
    const P = this.p, C = this.cum
    let best = Infinity, bs = 0
    for (let i = 1; i < P.length; i++) {
      if (C[i] < s0 || C[i - 1] > s1) continue
      const a = P[i - 1], b = P[i], vx = b[0] - a[0], vz = b[2] - a[2], L2 = vx * vx + vz * vz || 1e-9
      const t = clamp(((x - a[0]) * vx + (z - a[2]) * vz) / L2, 0, 1)
      const d = Math.hypot(x - a[0] - vx * t, z - a[2] - vz * t)
      if (d < best) { best = d; bs = C[i - 1] + t * (C[i] - C[i - 1]) }
    }
    return bs
  }
}

/** Where everything lives, from layout.json (pure). Missing places fall back to the numbers the layout had in Sept '26. */
export function resolvePlaces(layout = {}, cfg = WILD) {
  const places = layout.places || {}
  const at = (name) => {
    const p = places[name]; if (p && p.position) return [p.position[0], p.position[2]]
    const j = layout.junctions && layout.junctions[name]; if (j) return [j[0], j[2]]
    return (FALLBACK[name] || [0, 0]).slice()
  }
  const deerGroups = cfg.deerGroups.map((g) => { const a = at(g.at); return { id: g.id, home: [a[0] + g.off[0], a[1] + g.off[1]], members: g.members.map(([role, scale]) => ({ role, scale })) } })
  const rel = (list) => list.map(([n, dx, dz]) => { const a = at(n); return [a[0] + dx, a[1] + dz] })
  const segs = (layout.trail && layout.trail.segments) || []
  let route = []
  for (const [name, dir] of cfg.nightRoute) {
    const s = segs.find((q) => q.name === name)
    if (!s || !s.points || s.points.length < 2) { route = []; break }
    let pts = s.points.map((q) => (q.length > 2 ? [q[0], q[1], q[2]] : [q[0], 0, q[1]]))
    if (dir < 0) pts.reverse()
    if (route.length) pts = pts.slice(1)
    route = route.concat(pts)
  }
  if (route.length < 2) { const b = at('burn_scar'), s = at('spring'), t = at('tower'); route = [[b[0], 0, b[1]], [s[0], 0, s[1]], [t[0] + 4, 0, t[1] + 20]] }
  const wr = (layout.weeperRock && layout.weeperRock.position) || (places.weeper_rock && places.weeper_rock.position) || null
  return {
    deerGroups, bearSpots: rel(cfg.bearSpots), shedSpots: rel(cfg.shedSpots), route,
    rock: wr ? [wr[0], wr[1], wr[2]] : null, tower: at('tower'), shed: at('generator_shed'),
    ravine: (layout.ravine && layout.ravine.polygon) || null,
  }
}

function makeAnimal(id, kind, role, scale) {
  return {
    id, kind, role, scale, group: null, pos: [0, 0, 0], yaw: 0, speed: 0, act: 'idle', slope: 0,
    tx: 0, tz: 0, timer: 0, walkV: 0, arrived: false, steer: 0, steerT: 0, best: Infinity, stuckT: 0,
    // bear only (kept on every animal so they all share one shape)
    state: 'calm', task: 'forage', sub: 'go', subT: 0, rearIdleT: 0, spotI: 0, routeS: 0, sniffT: 0,
    lastD: -1, closing: 0, stillT: 0, idleT: 0, dMin: Infinity, bluffs: 0, swats: 0, mood: 0, ignoreT: 0, retreat: false, run: 0,
    huffT: 0, huffI: 0, snuffT: 0, barkT: 0, barks: 0, harassT: 0, dogCool: 0, prev: 'calm', engaged: false,
    nightOn: false, nightT: 0, visitAt: 0, visitRoll: false, visited: false,
  }
}

export class WildlifeBrain {
  /**
   * opts: { ground(x, z) -> y, rect: { min:[x,z], max:[x,z] }, ravine: [[x,z]...] | null, rock: [x,y,z] | null (the Weeper's),
   *         tower: [x,z], shed: [x,z] | null, deerGroups: [{ id, home:[x,z], members:[{ role, scale }] }], bearSpots: [[x,z]...],
   *         shedSpots: [[x,z]...], route: [[x,y,z]...] (night: burn -> tower), bear: false (no bear), rng } ; saved = toJSON()
   */
  constructor(opts = {}, saved = null) {
    this.opts = opts
    this.rng = opts.rng || Math.random
    this.ground = opts.ground || (() => 0)
    const r = opts.rect || { min: [-1e5, -1e5], max: [1e5, 1e5] }, m = WILD.edgeMargin
    this.rx0 = r.min[0] + m; this.rx1 = r.max[0] - m; this.rz0 = r.min[1] + m; this.rz1 = r.max[1] - m
    this.ravine = opts.ravine && opts.ravine.length > 2 ? opts.ravine : null
    this.rb = [Infinity, -Infinity, Infinity, -Infinity]
    if (this.ravine) for (const q of this.ravine) { this.rb[0] = Math.min(this.rb[0], q[0]); this.rb[1] = Math.max(this.rb[1], q[0]); this.rb[2] = Math.min(this.rb[2], q[1]); this.rb[3] = Math.max(this.rb[3], q[1]) }
    this.rock = opts.rock || null
    this.tower = opts.tower || [0, 0]
    this.shed = opts.shed || null
    this.route = opts.route && opts.route.length > 1 ? new Path(opts.route) : null
    // pooled events + scratch (update() allocates nothing)
    this._out = []; this._pool = []; this._pi = 0
    for (let i = 0; i < 32; i++) this._pool.push({ type: '', name: '', pos: [0, 0, 0], volume: 1, amount: 0, why: '', text: '', s: 0 })
    this._t = [0, 0]; this._q = [0, 0, 0]
    // the deer
    this.groups = []; this.deer = []
    for (const gd of opts.deerGroups || []) {
      const home = this.findSpot(gd.home[0], gd.home[1], 20, WILD.deer)
      const g = { id: gd.id, home, anchor: [home[0], home[1]], members: [], leader: null, state: 'calm', timer: 0, stillT: 0, awayT: 0,
        snortT: 0, wary: false, waryT: 0, accept: Infinity, threat: [0, 0], why: '', dP: Infinity }
      gd.members.forEach((md, i) => {
        const a = makeAnimal(`deer_${gd.id}_${i}`, 'deer', md.role || 'doe', md.scale || 1)
        a.group = g; g.members.push(a); this.deer.push(a)
      })
      g.leader = g.members.find((a) => a.role !== 'fawn') || g.members[0]
      if (g.members.length) this.groups.push(g)
    }
    // the bear
    this.bearSpots = (opts.bearSpots || []).map((p) => this.findSpot(p[0], p[1], 12, WILD.bear))
    if (!this.bearSpots.length) this.bearSpots.push(this.findSpot(-150, 40, 12, WILD.bear))
    this.shedSpots = (opts.shedSpots || []).map((p) => this.findSpot(p[0], p[1], 3, WILD.bear))
    this.bear = opts.bear === false ? null : makeAnimal('bear', 'bear', 'bear', 1)
    this.animals = this.deer.concat(this.bear ? [this.bear] : [])
    // ambient: every species gets an index into one cooldown array
    this.ambNames = []
    const idx = (sp) => { let i = this.ambNames.indexOf(sp.name); if (i < 0) i = this.ambNames.push(sp.name) - 1; return { sp, i } }
    this.ambSets = { day: WILD.ambient.day.species.map(idx), night: WILD.ambient.night.species.map(idx) }
    this.amb = { t: 0, hush: 0, left: 0, gap: 0, sp: null, x: 0, y: 0, z: 0, silent: false, cool: new Float64Array(this.ambNames.length), calls: 0 }
    this.flags = {}
    this.time = 0
    this.reset()
    if (saved) this.restore(saved)
  }

  // ------------------------------------------------------------------ setup
  reset() {
    const D = WILD.deer
    for (const g of this.groups) {
      g.anchor[0] = g.home[0]; g.anchor[1] = g.home[1]
      g.state = 'calm'; g.timer = 0; g.stillT = 0; g.awayT = 0; g.wary = false; g.accept = Infinity
      g.members.forEach((m, i) => {
        let x = g.home[0], z = g.home[1]
        if (m !== g.leader) {
          for (let k = 0; k < 12; k++) { const a = this.rng() * TAU, r = 2 + this.rng() * 3; const px = g.home[0] + Math.sin(a) * r, pz = g.home[1] + Math.cos(a) * r; if (this.ok(px, pz, D)) { x = px; z = pz; break } }
        }
        this.place(m, x, z, this.rng() * TAU)
        m.act = this.rng() < 0.7 ? 'graze' : 'idle'; m.timer = this.rng() * D.graze[1]
      })
    }
    const b = this.bear
    if (b) {
      b.spotI = clamp(WILD.bearStart, 0, this.bearSpots.length - 1)
      const s = this.bearSpots[b.spotI]
      this.place(b, s[0], s[1], this.rng() * TAU)
      b.state = 'calm'; b.task = 'forage'; b.sub = 'nose'; b.subT = this.U(WILD.bear.forage); b.act = 'forage'; b.rearIdleT = 0
      b.lastD = -1; b.closing = 0; b.stillT = 0; b.bluffs = 0; b.swats = 0; b.mood = 0; b.ignoreT = 0; b.dogCool = 0; b.harassT = 0
      b.barkT = WILD.firstBark; b.barks = 0; b.snuffT = this.U(WILD.bear.snuffle); b.huffI = 0
      b.nightOn = false; b.nightT = 0; b.visited = false; b.visitRoll = false; b.routeS = 0; b.sniffT = 0
    }
    const A = this.amb; A.t = this.U(WILD.ambient.start); A.hush = 0; A.left = 0; A.sp = null; A.silent = false; A.calls = 0
    A.cool.fill(0)
    this.flags = {}
  }
  place(a, x, z, yaw) { a.pos[0] = x; a.pos[2] = z; a.yaw = yaw; a.speed = 0; a.steerT = 0; a.best = Infinity; a.stuckT = 0; this.settle(a) }
  U(r) { return r[0] + this.rng() * (r[1] - r[0]) }

  // ------------------------------------------------------------------ the ground
  slopeAt(x, z) { const g = this.ground, e = 1.5; return Math.hypot(g(x + e, z) - g(x - e, z), g(x, z + e) - g(x, z - e)) / (2 * e) }
  inRavine(x, z) {
    const P = this.ravine; if (!P) return false
    const b = this.rb; if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) return false
    let ins = false
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1]
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) ins = !ins
    }
    return ins
  }
  /** Never: off the map, into the ravine, inside the tower fence or the shed, near the Weeper's rock (slope aside). */
  placeOk(x, z, spec) {
    if (!(x >= this.rx0 && x <= this.rx1 && z >= this.rz0 && z <= this.rz1)) return false   // (NaN fails too)
    const F = WILD.fence, t = this.tower
    if (Math.abs(x - t[0]) < F && Math.abs(z - t[1]) < F) return false
    if (this.shed && Math.hypot(x - this.shed[0], z - this.shed[1]) < WILD.shedRadius) return false
    if (spec.rockAvoid && this.rock && Math.hypot(x - this.rock[0], z - this.rock[2]) < spec.rockAvoid) return false
    return !this.inRavine(x, z)
  }
  /** Where an animal can put a foot: placeOk and not a cliff. */
  hardOk(x, z, spec) { return this.placeOk(x, z, spec) && this.slopeAt(x, z) <= spec.hardSlope }
  /** Where an animal would choose to go: placeOk and not steep. */
  ok(x, z, spec) { return this.placeOk(x, z, spec) && this.slopeAt(x, z) <= spec.maxSlope }
  /** The flattest good spot within r of (x, z) (setup only). */
  findSpot(x, z, r, spec) {
    let best = null, bs = Infinity; const st = Math.max(1, r / 5)
    for (let dx = -r; dx <= r + 1e-6; dx += st) for (let dz = -r; dz <= r + 1e-6; dz += st) {
      const q = Math.hypot(dx, dz); if (q > r + 1e-6) continue
      const px = x + dx, pz = z + dz; if (!this.ok(px, pz, spec)) continue
      const s = this.slopeAt(px, pz) + (q / (r || 1)) * 0.12
      if (s < bs) { bs = s; best = [px, pz] }
    }
    return best || [x, z]
  }
  /** (x, z) if an animal can stand there, else the nearest spot within 2.5 m where it can (save rounding, moved props), else null. */
  standAt(x, z, spec) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    if (this.hardOk(x, z, spec)) return [x, z]
    for (let i = 0; i < NUDGE.length; i++) for (let k = 0; k < 12; k++) {
      const r = NUDGE[i], a = (k / 12) * TAU, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r
      if (this.hardOk(px, pz, spec)) return [px, pz]
    }
    return null
  }
  settle(a) {
    const g = this.ground, x = a.pos[0], z = a.pos[2], s = Math.sin(a.yaw) * 0.8, c = Math.cos(a.yaw) * 0.8
    a.pos[1] = g(x, z)
    a.slope = (g(x + s, z + c) - g(x - s, z - c)) / 1.6
  }
  turnTo(a, h, rate, dt) { a.yaw = angWrap(a.yaw + clamp(angWrap(h - a.yaw), -rate * dt, rate * dt)) }
  /** A heading near `want` whose next couple of metres are good ground. */
  heading(a, want, spec) {
    const px = a.pos[0], pz = a.pos[2], pr = spec.probe
    for (let i = 0; i < OFFS.length; i++) { const h = want + OFFS[i]; if (this.ok(px + Math.sin(h) * pr, pz + Math.cos(h) * pr, spec)) return h }
    return want
  }
  /** Walk / run a toward (tx, tz) at up to v m/s, steering round bad ground. Returns the 2-D distance left. rush: no easing in. */
  move(a, tx, tz, v, dt, spec, turn, rush = false) {
    const px = a.pos[0], pz = a.pos[2], dx = tx - px, dz = tz - pz, dist = Math.hypot(dx, dz)
    const want = Math.atan2(dx, dz)
    a.steerT -= dt
    if (a.steerT <= 0) { a.steerT = 0.2; a.steer = this.heading(a, want, spec) }
    this.turnTo(a, a.steer, turn, dt)
    const off = Math.abs(angWrap(want - a.yaw))
    let vt = dist < 0.12 ? 0 : rush ? v : Math.min(v, Math.max(0.3, dist * 1.5))
    if (dist < 3 && off > 1.2) vt = Math.min(vt, 0.3)            // close and facing away: turn on the spot, don't orbit
    a.speed += clamp(vt - a.speed, -spec.decel * dt, spec.accel * dt)
    const step = a.speed * dt
    if (step > 0) {
      const nx = px + Math.sin(a.yaw) * step, nz = pz + Math.cos(a.yaw) * step
      if (this.hardOk(nx, nz, spec) || !this.hardOk(px, pz, spec)) { a.pos[0] = nx; a.pos[2] = nz }
      else { a.speed *= 0.3; a.steerT = 0 }
    }
    this.settle(a)
    const left = Math.hypot(tx - a.pos[0], tz - a.pos[2])
    if (left < a.best - 0.25) { a.best = left; a.stuckT = 0 } else a.stuckT += dt
    return left
  }
  target(a, x, z) { a.tx = x; a.tz = z; a.best = Infinity; a.stuckT = 0; a.steerT = 0; a.arrived = false }
  /** Stop where you are (easing off) and turn to face (x, z). */
  hold(a, x, z, spec, turn, dt) {
    a.speed = Math.max(0, a.speed - spec.decel * dt)
    if (a.speed > 0) { const s = a.speed * dt, nx = a.pos[0] + Math.sin(a.yaw) * s, nz = a.pos[2] + Math.cos(a.yaw) * s; if (this.hardOk(nx, nz, spec)) { a.pos[0] = nx; a.pos[2] = nz } else a.speed = 0 }
    this.turnTo(a, Math.atan2(x - a.pos[0], z - a.pos[2]), turn, dt)
    this.settle(a)
  }
  /** A good spot dMin..dMax away from (fx, fz), heading away from it where the ground allows (writes out[0], out[1]). */
  awayFrom(x, z, fx, fz, dMin, dMax, spec, out) {
    const ax = x - fx, az = z - fz
    const base = Math.hypot(ax, az) > 0.01 ? Math.atan2(ax, az) : this.rng() * TAU
    const jitter = (this.rng() - 0.5) * 0.9
    let bx = x, bz = z, bs = -Infinity
    for (let k = 0; k < 15; k++) {
      const off = k === 0 ? jitter : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.33 + jitter * 0.3
      const h = base + off, dist = dMin + this.rng() * (dMax - dMin), ux = Math.sin(h), uz = Math.cos(h)
      let good = 0
      for (let s = 5; s <= dist + 1e-6; s += 5) { if (!this.ok(x + ux * s, z + uz * s, spec)) break; good = s }
      if (good >= dist - 5 && this.ok(x + ux * dist, z + uz * dist, spec)) { out[0] = x + ux * dist; out[1] = z + uz * dist; return true }
      const score = good - Math.abs(off) * 8
      if (good > 0 && score > bs) { bs = score; bx = x + ux * good; bz = z + uz * good }
    }
    out[0] = bx; out[1] = bz
    return false
  }

  // ------------------------------------------------------------------ events (pooled)
  ev(type) {
    const e = this._pool[this._pi]; this._pi = (this._pi + 1) % this._pool.length
    e.type = type; e.name = ''; e.volume = 1; e.amount = 0; e.why = ''; e.text = ''; e.s = 0
    this._out.push(e); return e
  }
  sfx(name, x, y, z, volume) { const e = this.ev('sfx'); e.name = name; e.pos[0] = x; e.pos[1] = y; e.pos[2] = z; e.volume = volume; return e }
  fear(amount) { this.ev('fear').amount = amount }
  say(key) { if (this.flags[key]) return; this.flags[key] = true; this.ev('say').text = WILD.lines[key] }
  toast(key, s) { if (this.flags[key]) return; this.flags[key] = true; const e = this.ev('toast'); e.text = WILD.lines[key]; e.s = s }
  animalSfx(a, name, vol, head) { this.sfx(name, a.pos[0] + Math.sin(a.yaw) * head, a.pos[1] + head * a.scale, a.pos[2] + Math.cos(a.yaw) * head, vol) }

  // ------------------------------------------------------------------ per frame
  update(dt, ctx) {
    const out = this._out; out.length = 0
    if (!(dt > 0) || !ctx || !ctx.player) return out
    dt = Math.min(dt, 0.1)
    this.time += dt
    this._pl = ctx.player
    const pSpeed = ctx.vel ? Math.hypot(ctx.vel[0], ctx.vel[1]) : 0
    for (let i = 0; i < this.groups.length; i++) this.deerGroup(this.groups[i], dt, ctx, pSpeed)
    if (this.bear) this.bearUpdate(dt, ctx, pSpeed)
    this.ambient(dt, ctx)
    return out
  }

  // ------------------------------------------------------------------ deer
  deerGroup(g, dt, ctx, pSpeed) {
    const D = WILD.deer, M = g.members, n = M.length, pl = ctx.player
    let dP = Infinity, dDog = Infinity, dW = Infinity
    for (let i = 0; i < n; i++) {
      const p = M[i].pos
      const a = d3(p, pl); if (a < dP) dP = a
      if (ctx.dog) { const b = d3(p, ctx.dog.pos); if (b < dDog) dDog = b }
      if (ctx.weeper) { const c = d2(p, ctx.weeper); if (c < dW) dW = c }
    }
    g.dP = dP
    const jog = !!ctx.jog && pSpeed > D.jogSpeed
    if (g.state !== 'flee') {
      if (dW < D.weeperRange) this.deerFlee(g, ctx.weeper, 'weeper')
      else if (dDog < D.dogRange) this.deerFlee(g, ctx.dog.pos, 'dog')
      else if (dP < D.fleeRange || (jog && dP < D.jogRange)) this.deerFlee(g, pl, 'player')
    }
    if (dP > D.alertRange + D.alertHyst) g.accept = Infinity
    g.timer += dt
    if (g.state === 'calm') {
      if (dP < D.alertRange && dP < g.accept - D.acceptSlack) this.deerAlert(g, pl, true)
      else {
        this.pullAnchor(g, dt)
        for (let i = 0; i < n; i++) this.deerCalm(g, M[i], dt)
      }
    }
    if (g.state === 'alert') {
      g.stillT = pSpeed < D.stillSpeed ? g.stillT + dt : 0
      g.awayT = dP > D.alertRange + D.alertHyst ? g.awayT + dt : 0
      if (g.wary && dP <= D.alertRange) { g.wary = false; g.snortT = 0.6; g.timer = 0 }
      const watch = dP < D.alertRange + D.alertHyst + 15
      const lx = watch ? pl[0] : g.threat[0], lz = watch ? pl[2] : g.threat[1]
      for (let i = 0; i < n; i++) { const m = M[i]; m.act = 'alert'; this.hold(m, lx, lz, D, D.turn, dt) }
      if (!g.wary) { g.snortT -= dt; if (g.snortT <= 0) { this.animalSfx(g.leader, 'deer_snort', D.snortVol, D.head); g.snortT = this.U(D.snortEvery) } }
      const calmNow = g.wary ? g.timer > g.waryT && dP > D.alertRange : g.awayT > D.alertCalm || (g.stillT > D.calmStill && dP > D.fleeRange)
      if (calmNow) { if (!g.wary && g.awayT <= D.alertCalm) g.accept = dP; this.deerCalmDown(g) }
    } else if (g.state === 'flee') {
      let all = true
      for (let i = 0; i < n; i++) {
        const m = M[i]
        if (!m.arrived) {
          const left = this.move(m, m.tx, m.tz, D.runSpeed, dt, D, D.turnRun)
          m.act = 'run'
          if (left < D.fleeArrive || m.stuckT > 2) m.arrived = true; else all = false
        } else { m.act = 'alert'; this.hold(m, g.threat[0], g.threat[1], D, D.turn, dt) }
      }
      if (all || g.timer > D.fleeMax) {
        let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += M[i].pos[0]; cz += M[i].pos[2] }
        g.anchor[0] = cx / n; g.anchor[1] = cz / n
        g.state = 'alert'; g.wary = true; g.waryT = this.U(D.wary); g.timer = 0; g.stillT = 0; g.awayT = 0
      }
    }
  }
  deerAlert(g, from, snort) {
    const D = WILD.deer
    g.state = 'alert'; g.timer = 0; g.stillT = 0; g.awayT = 0; g.wary = false
    g.threat[0] = from[0]; g.threat[1] = from[2]
    g.snortT = this.U(D.snortEvery)
    if (snort) this.animalSfx(g.leader, 'deer_snort', D.snortVol, D.head)
    this.say('deerFirst')
  }
  deerFlee(g, from, why) {
    const D = WILD.deer, M = g.members, n = M.length, L = g.leader
    g.state = 'flee'; g.timer = 0; g.why = why; g.threat[0] = from[0]; g.threat[1] = from[2]
    let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += M[i].pos[0]; cz += M[i].pos[2] }
    cx /= n; cz /= n
    this.awayFrom(cx, cz, from[0], from[2], D.flee[0], D.flee[1], D, this._t)
    const tx = this._t[0], tz = this._t[1], dx = tx - cx, dz = tz - cz, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl
    for (let i = 0; i < n; i++) {
      const m = M[i]
      let x = tx, z = tz
      if (m !== L) {
        const side = i % 2 ? 1 : -1, lat = m.role === 'fawn' ? 1.4 : 3, back = m.role === 'fawn' ? 2.2 : 1.2
        x = tx - uz * lat * side - ux * back; z = tz + ux * lat * side - uz * back
        if (!this.ok(x, z, D)) { x = tx; z = tz }
      }
      this.target(m, x, z); m.act = 'run'
    }
    this.animalSfx(L, 'deer_snort', D.snortVol * 1.1, D.head)
    for (let i = 0; i < n; i++) if (M[i].role === 'fawn' && this.rng() < D.bleatChance) { this.animalSfx(M[i], 'deer_bleat', D.bleatVol, D.head * 0.7); break }
  }
  deerCalmDown(g) {
    const D = WILD.deer
    g.state = 'calm'; g.timer = 0; g.wary = false
    for (const m of g.members) { m.act = this.rng() < 0.75 ? 'graze' : 'idle'; m.timer = this.U(m.act === 'graze' ? D.graze : D.idle) * 0.6 }
  }
  pullAnchor(g, dt) {
    const dx = g.home[0] - g.anchor[0], dz = g.home[1] - g.anchor[1], L = Math.hypot(dx, dz)
    if (L < 0.01) return
    const s = Math.min(L, WILD.deer.homePull * dt); g.anchor[0] += (dx / L) * s; g.anchor[1] += (dz / L) * s
  }
  deerCalm(g, m, dt) {
    const D = WILD.deer, L = g.leader
    if (m.act === 'walk') {
      const left = this.move(m, m.tx, m.tz, m.walkV, dt, D, D.turn)
      if (left < 0.35 || m.stuckT > 3) { m.act = this.rng() < 0.7 ? 'graze' : 'idle'; m.timer = this.U(m.act === 'graze' ? D.graze : D.idle) }
      return
    }
    if (m.act !== 'graze' && m.act !== 'idle') { m.act = 'graze'; m.timer = this.U(D.graze) }
    this.hold(m, m.pos[0] + Math.sin(m.yaw), m.pos[2] + Math.cos(m.yaw), D, D.turn, dt)
    m.timer -= dt
    const far = m !== L && d2(m.pos, L.pos) > (m.role === 'fawn' ? D.keepFawn : D.keepDoe) * 1.6
    if (m.timer > 0 && !far) return
    if ((far || this.rng() < 0.6) && this.deerWanderTarget(g, m)) { m.act = 'walk'; m.walkV = D.walkSpeed * (far ? 1.5 : 0.8 + this.rng() * 0.4); return }
    m.act = m.act === 'graze' ? 'idle' : 'graze'; m.timer = this.U(m.act === 'graze' ? D.graze : D.idle)
  }
  deerWanderTarget(g, m) {
    const D = WILD.deer, L = g.leader, pl = this._pl
    // a group that has put up with you nearby grazes away from you, never toward you
    const keepOff = pl && g.dP < D.alertRange + D.alertHyst ? Math.min(g.dP, D.alertRange) : 0
    for (let k = 0; k < 8; k++) {
      let x, z
      if (m === L) {
        const a = this.rng() * TAU, r = this.U(D.hop)
        x = m.pos[0] + Math.sin(a) * r; z = m.pos[2] + Math.cos(a) * r
        const ax = x - g.anchor[0], az = z - g.anchor[1], al = Math.hypot(ax, az)
        if (al > D.range) { x = g.anchor[0] + (ax / al) * D.range * 0.8; z = g.anchor[1] + (az / al) * D.range * 0.8 }
      } else {
        const keep = m.role === 'fawn' ? D.keepFawn : D.keepDoe, a = this.rng() * TAU, r = 1.5 + this.rng() * (keep - 1.5)
        x = L.pos[0] + Math.sin(a) * r; z = L.pos[2] + Math.cos(a) * r
      }
      if (keepOff && Math.hypot(x - pl[0], z - pl[2]) < keepOff) continue
      if (this.ok(x, z, D)) { this.target(m, x, z); return true }
    }
    return false
  }

  // ------------------------------------------------------------------ the bear
  /** You inside the generator shed's walls (it can't reach you through them). */
  inShed(p) { return !!this.shed && Math.hypot(p[0] - this.shed[0], p[2] - this.shed[1]) < WILD.shedShelter && p[1] < this.ground(p[0], p[2]) + 2.5 }
  bearUpdate(dt, ctx, pSpeed) {
    const B = WILD.bear, b = this.bear, pl = ctx.player, safe = !!ctx.playerSafe || this.inShed(pl)
    const d = d3(b.pos, pl), dxz = d2(b.pos, pl)
    // how fast YOU are coming at it (your velocity toward it; its own charge doesn't count)
    const vel = ctx.vel
    b.closing = vel && dxz > 1e-3 ? (vel[0] * (b.pos[0] - pl[0]) + vel[1] * (b.pos[2] - pl[2])) / dxz : 0
    b.lastD = d
    b.stillT = pSpeed < B.stillSpeed ? b.stillT + dt : 0
    b.ignoreT = Math.max(0, b.ignoreT - dt); b.dogCool = Math.max(0, b.dogCool - dt); b.mood = Math.max(0, b.mood - B.mood.decay * dt)
    b.timer += dt
    this.bearDog(dt, ctx, dxz, safe)
    if (ctx.weeper && b.state !== 'flee' && d2(b.pos, ctx.weeper) < B.weeperRange) this.bearAway(ctx.weeper[0], ctx.weeper[2])
    const bluffR = B.bluffRange * (1 + B.mood.range * b.mood)
    switch (b.state) {
      case 'calm': {
        this.bearTask(dt, ctx)
        const nr = safe ? B.noticeSafe : pSpeed < B.stillSpeed ? B.noticeStill : ctx.jog && pSpeed > B.jogSpeed ? B.noticeJog : B.noticeRange
        if (d < nr && (b.ignoreT <= 0 || (!safe && d < bluffR))) this.bearEnter('notice')
        break
      }
      case 'notice':
        this.hold(b, pl[0], pl[2], B, B.turn, dt)
        if (d > B.loseRange) this.bearCalm(0)
        else if (b.timer >= B.noticeTime) this.bearEnter('rear')
        break
      case 'rear':
        this.hold(b, pl[0], pl[2], B, B.turn * 0.5, dt)
        if (!safe && d < bluffR && b.closing > 0.5) this.bearEnter('bluff')
        else if (b.timer >= B.rearTime) { if (d > B.loseRange) this.bearCalm(0); else this.bearEnter('huff') }
        break
      case 'huff': {
        this.hold(b, pl[0], pl[2], B, B.turn, dt)
        this.bearHuffing(dt, B.huffEvery)
        if (d < b.dMin) b.dMin = d
        if (b.closing < 0.3) b.idleT += dt   // its patience only runs out while you aren't coming closer
        const patience = B.huffTime * (1 - B.mood.patience * b.mood)
        // it charges if YOU keep coming (inside 10 m, or running at it inside 20), or if you are right on top of it; a bear
        // that wandered up to you while you stood still just huffs and goes
        if (!safe && ((d < bluffR && b.closing > B.bluffClosing) || d < B.surprise || (ctx.jog && pSpeed > B.jogSpeed && b.closing > B.runAtClosing && d < B.runAtRange))) this.bearEnter('bluff')
        else if (d > b.dMin + B.backoff || d > B.loseRange || b.stillT > B.stillCalm || b.idleT > patience) this.bearLeave(pl[0], pl[2], false)
        break
      }
      case 'bluff':
        if (safe || b.timer > B.bluffMax) { this.bearEnter('standoff'); break }
        this.move(b, pl[0], pl[2], B.chargeSpeed, dt, B, B.turnRun, true)
        if (d2(b.pos, pl) <= B.bluffStop) { b.speed = 0; this.bearEnter('standoff') }
        break
      case 'standoff':
        this.hold(b, pl[0], pl[2], B, B.turn, dt)
        this.bearHuffing(dt, B.standoffEvery)
        if (d < b.dMin) b.dMin = d
        if (!safe && (dxz < B.swatHard || (dxz < B.swatRange && b.closing > B.swatClosing && b.timer > 0.5))) this.bearEnter('swat')
        else if (!safe && b.bluffs < B.maxBluffs && b.timer > 1.5 && d < bluffR * 0.8 && d > B.swatRange && b.closing > 0.3) this.bearEnter('bluff')
        else if (d > b.dMin + B.backoff || b.stillT > B.stillCalm || b.timer > B.standoffTime || d > B.loseRange) this.bearLeave(pl[0], pl[2], false)
        break
      case 'swat':
        if (safe) { this.bearLeave(pl[0], pl[2], true); break }
        this.move(b, pl[0], pl[2], B.swatSpeed, dt, B, B.turnRun, true)
        if (d2(b.pos, pl) <= B.swatReach) this.bearHit(pl)
        else if (b.timer > B.swatLunge) { if (d2(b.pos, pl) <= B.swatReach + B.swatMiss) this.bearHit(pl); else this.bearMiss(pl) }
        break
      case 'leave': {
        const v = b.retreat && b.run < B.retreatRun ? B.runSpeed : B.walkSpeed
        const left = this.move(b, b.tx, b.tz, v, dt, B, v > 2 ? B.turnRun : B.turn)
        b.run += b.speed * dt; b.act = 'walk'
        if (!safe && dxz < B.provoke && b.closing > 0.3 && b.timer > 1) this.bearEnter('standoff')
        else if (left < 1.5 || b.stuckT > 5 || b.timer > B.leaveMax) this.bearCalm(B.ignore)
        break
      }
      case 'dogcharge': {
        const dog = ctx.dog
        if (!dog) { this.bearEnter(b.engaged && d < B.loseRange ? 'huff' : 'calm'); break }
        this.move(b, dog.pos[0], dog.pos[2], B.chargeSpeed * 0.85, dt, B, B.turnRun, true)
        if (d2(b.pos, dog.pos) <= B.dogChaseStop || b.timer > B.dogChase) {
          b.speed = 0; b.dogCool = B.dogChargeCool; b.mood = Math.min(1, b.mood + B.mood.dog)
          this.animalSfx(b, 'bear_huff', B.huffVol, B.head); this.animalSfx(b, 'bear_jawpop', B.popVol, B.head)
          if (b.engaged && d < B.loseRange) this.bearEnter('huff'); else this.bearCalm(0)
        }
        break
      }
      case 'flee': {
        const left = this.move(b, b.tx, b.tz, B.runSpeed, dt, B, B.turnRun)
        b.act = 'run'
        if (left < B.fleeArrive || b.stuckT > 4 || b.timer > 25) this.bearCalm(20)
        break
      }
    }
  }
  bearEnter(state) {
    const B = WILD.bear, b = this.bear
    b.prev = b.state; b.state = state; b.timer = 0; b.steerT = 0; b.best = Infinity; b.stuckT = 0
    switch (state) {
      case 'calm':
        if (this.route && (b.task === 'visit' || b.task === 'return')) b.routeS = this.route.project(b.pos[0], b.pos[2])
        if (b.task === 'forage' || b.task === 'sniff') b.sub = 'go'
        break
      case 'notice': b.act = 'idle'; this.toast('bearFirst', 6); break
      case 'rear': b.act = 'rear'; break
      case 'huff': b.act = 'huff'; b.huffT = 0; b.dMin = b.lastD; b.stillT = 0; b.idleT = 0; break
      case 'bluff':
        b.act = 'run'; b.bluffs++; b.mood = Math.min(1, b.mood + B.mood.bluff)
        this.fear(B.bluffFear); this.animalSfx(b, 'bear_huff', B.huffVol * 1.15, B.head); this.say('bearBluff')
        break
      case 'standoff':
        b.act = 'huff'; b.dMin = b.lastD; b.stillT = 0; b.huffT = 0.5
        this.animalSfx(b, 'bear_jawpop', B.popVol, B.head); this.animalSfx(b, 'bear_woof', B.woofVol, B.head)
        break
      case 'swat': b.act = 'run'; b.speed = Math.max(b.speed, B.swatSpeed * B.swatLunge0); break   // a lunge, not a walk-up
      case 'dogcharge': b.act = 'run'; break
      default: break
    }
  }
  /** Back to its own business; it won't take notice of you again for `ignore` s unless you come right up to it. */
  bearCalm(ignore) {
    const b = this.bear
    b.ignoreT = Math.max(b.ignoreT, ignore); b.bluffs = 0; b.harassT = 0
    if (ignore > 0 && (b.task === 'visit' || b.task === 'sniff')) this.bearTask0('return')   // it leaves the clearing
    else if (b.task === 'forage') this.pickSpot(this.bearSpots, true, ignore > 0)   // somewhere away from you
    this.bearEnter('calm')
  }
  bearLeave(fx, fz, retreat) {
    const B = WILD.bear, b = this.bear
    this.awayFrom(b.pos[0], b.pos[2], fx, fz, B.leave[0], B.leave[1], B, this._t)
    this.bearEnter('leave'); this.target(b, this._t[0], this._t[1]); b.retreat = retreat; b.run = 0; b.act = 'walk'
  }
  bearAway(fx, fz) {
    const B = WILD.bear, b = this.bear
    this.awayFrom(b.pos[0], b.pos[2], fx, fz, B.weeperFlee[0], B.weeperFlee[1], B, this._t)
    this.bearEnter('flee'); this.target(b, this._t[0], this._t[1]); b.act = 'run'
    if (b.task === 'visit' || b.task === 'sniff') b.task = 'return'
  }
  bearHit(pl) {
    const B = WILD.bear, b = this.bear
    b.speed = 0; b.act = 'huff'; b.swats++; b.mood = Math.min(1, b.mood + B.mood.swat)
    const e = this.ev('hurt'); e.amount = B.swatHurt; e.why = 'bear'
    this.fear(B.swatFear)
    this.animalSfx(b, 'bear_growl', B.growlVol, B.head)
    this.say('bearSwat')
    this.bearLeave(pl[0], pl[2], true)
    b.ignoreT = Math.max(b.ignoreT, B.ignoreSwat)
  }
  /** The lunge ran out with you beyond its reach (you got clear): no hurt. It blows, pops its jaw and goes. */
  bearMiss(pl) {
    const B = WILD.bear, b = this.bear
    b.speed = 0; b.act = 'huff'; b.mood = Math.min(1, b.mood + B.mood.swat * 0.5)
    this.fear(B.swatMissFear)
    this.animalSfx(b, 'bear_huff', B.huffVol * 1.15, B.head); this.animalSfx(b, 'bear_jawpop', B.popVol, B.head)
    this.bearLeave(pl[0], pl[2], true)
    b.ignoreT = Math.max(b.ignoreT, B.ignoreSwat)
  }
  bearHuffing(dt, every) {
    const B = WILD.bear, b = this.bear
    b.huffT -= dt
    if (b.huffT > 0) return
    const name = HUFFS[b.huffI % HUFFS.length]; b.huffI++
    this.animalSfx(b, name, name === 'bear_woof' ? B.woofVol : name === 'bear_jawpop' ? B.popVol : B.huffVol, B.head)
    b.huffT = this.U(every)
  }
  /** The tamed dog: barks at it every 1-2 s inside 25 m; the bear may run at her; if she gets in its face it swats. */
  bearDog(dt, ctx, dxz, safe) {
    const B = WILD.bear, b = this.bear, dog = ctx.dog
    if (!dog || !dog.tamed) { b.barkT = WILD.firstBark; b.harassT = Math.max(0, b.harassT - dt); return }
    const dd = d3(b.pos, dog.pos)
    if (dd < WILD.dogBarkRange) {
      b.barkT -= dt
      if (b.barkT <= 0) {
        b.barkT = this.U(WILD.dogBark); b.barks++
        this.sfx('dog_bark', dog.pos[0], dog.pos[1] + 0.55, dog.pos[2], WILD.barkVol)
        if (dd < B.dogChaseRange && b.dogCool <= 0 && CHARGEABLE[b.state] && this.rng() < B.dogChargeChance) { b.engaged = b.state !== 'calm'; this.bearEnter('dogcharge') }
      }
    } else b.barkT = WILD.firstBark
    if (dd < B.dogHarassRange && dd < dxz - 0.5) b.harassT += dt; else b.harassT = Math.max(0, b.harassT - dt * 0.5)
    if (b.harassT > B.dogHarassTime && b.state !== 'swat' && b.state !== 'leave' && b.state !== 'flee') {
      b.harassT = 0
      if (!safe && dxz < B.playerSwatNear) { this.bearEnter('swat'); return }   // you're right there: the paw is for you
      this.animalSfx(b, 'bear_growl', B.growlVol, B.head)
      this.sfx('dog_whine', dog.pos[0], dog.pos[1] + 0.5, dog.pos[2], 1)
      const e = this.ev('dogSwat'); e.pos[0] = dog.pos[0]; e.pos[1] = dog.pos[1]; e.pos[2] = dog.pos[2]
      this.say('dogSwat')
      b.mood = Math.min(1, b.mood + B.mood.swat * 0.5)
      this.bearLeave(dog.pos[0], dog.pos[2], true)
    }
  }
  bearTask0(task) {
    const B = WILD.bear, b = this.bear
    b.task = task; b.sub = 'go'
    if ((task === 'visit' || task === 'return') && this.route) b.routeS = this.route.project(b.pos[0], b.pos[2])
    if (task === 'sniff') { b.sniffT = this.U(B.sniff); this.pickSpot(this.shedSpots, false) }
    if (task === 'forage') this.pickSpot(this.bearSpots, false)
  }
  /** Next place to nose about: the nearest one (random = a different one at random; awayFromYou = one 40+ m from you whose
   *  walk there keeps spotClear m from you, if there is one, else the one that comes closest to that). */
  pickSpot(spots, random, awayFromYou = false) {
    const b = this.bear, n = spots.length, pl = this._pl
    if (!n) { b.sub = 'nose'; b.subT = 5; return }
    let i = 0
    if (random && n > 1) {
      let best = -1, bs = -Infinity
      for (let k = 0; k < 12; k++) {
        i = Math.floor(this.rng() * (n - 1)); if (i >= b.spotI) i++
        if (!awayFromYou || !pl) break
        const far = Math.hypot(spots[i][0] - pl[0], spots[i][1] - pl[2]) - 40
        const clear = segDist(b.pos[0], b.pos[2], spots[i][0], spots[i][1], pl[0], pl[2]) - WILD.bear.spotClear
        if (far >= 0 && clear >= 0) { best = -1; break }
        const sc = Math.min(far, clear); if (sc > bs) { bs = sc; best = i }
      }
      if (best >= 0) i = best
    }
    else { let bd = Infinity; for (let k = 0; k < n; k++) { const q = Math.hypot(spots[k][0] - b.pos[0], spots[k][1] - b.pos[2]); if (q < bd) { bd = q; i = k } } }
    b.spotI = i
    const s = spots[i], j = spots === this.shedSpots ? 0.8 : 3
    let x = s[0], z = s[1]
    for (let k = 0; k < 6; k++) { const px = s[0] + (this.rng() - 0.5) * 2 * j, pz = s[1] + (this.rng() - 0.5) * 2 * j; if (this.ok(px, pz, WILD.bear)) { x = px; z = pz; break } }
    this.target(b, x, z); b.sub = 'go'
  }
  bearTask(dt, ctx) {
    const B = WILD.bear, b = this.bear
    if (ctx.night) {
      if (!b.nightOn) { b.nightOn = true; b.visited = false; b.nightT = 0; b.visitAt = this.U(B.visitDelay); b.visitRoll = this.rng() < B.visitChance }
      b.nightT += dt
      if (b.task === 'forage' && !b.visited && b.visitRoll && this.route && b.nightT >= b.visitAt) { b.visited = true; this.bearTask0('visit') }
    } else if (b.nightOn) { b.nightOn = false; if (b.task === 'visit' || b.task === 'sniff') this.bearTask0('return') }
    switch (b.task) {
      case 'visit': {
        const left = this.followRoute(dt, 1)
        if (left < 1 || Math.hypot(b.pos[0] - this.tower[0], b.pos[2] - this.tower[1]) < B.towerStop) this.bearTask0('sniff')
        break
      }
      case 'sniff':
        b.sniffT -= dt
        if (b.sniffT <= 0) { this.bearTask0('return'); break }
        this.bearNose(dt, this.shedSpots, B.sniffAt, B.sniffRear)
        if (d3(b.pos, ctx.player) < 70) this.say('bearShed')
        break
      case 'return':
        if (this.followRoute(dt, -1) < 1) this.bearTask0('forage')
        break
      default: this.bearNose(dt, this.bearSpots, B.forage, B.rearIdle)
    }
    b.snuffT -= dt
    if (b.snuffT <= 0) { b.snuffT = this.U(B.snuffle); if (d3(b.pos, ctx.player) < B.snuffleRange) this.animalSfx(b, 'bear_huff', B.snuffleVol, B.head) }
  }
  followRoute(dt, dir) {
    const B = WILD.bear, b = this.bear, R = this.route
    if (!R) return 0
    b.routeS = R.project(b.pos[0], b.pos[2], b.routeS - 8, b.routeS + 12)
    R.at(clamp(b.routeS + dir * B.lookahead, 0, R.length), this._q)
    this.move(b, this._q[0], this._q[2], B.travelSpeed, dt, B, B.turn)
    b.act = 'walk'
    return dir > 0 ? R.length - b.routeS : b.routeS
  }
  /** Walk to a spot, nose about there (forage, now and then standing up to sniff the air), pick another. */
  bearNose(dt, spots, stay, rearRate) {
    const B = WILD.bear, b = this.bear
    if (b.sub === 'go') {
      const left = this.move(b, b.tx, b.tz, B.walkSpeed, dt, B, B.turn)
      b.act = 'walk'
      if (left < 1.2 || b.stuckT > 5) { b.sub = 'nose'; b.subT = this.U(stay); b.rearIdleT = 0 }
      return
    }
    this.hold(b, b.pos[0] + Math.sin(b.yaw), b.pos[2] + Math.cos(b.yaw), B, B.turn, dt)
    b.subT -= dt
    if (b.rearIdleT > 0) b.rearIdleT -= dt
    else if (this.rng() < rearRate * dt) b.rearIdleT = B.rearIdleTime
    b.act = b.rearIdleT > 0 ? 'rear' : 'forage'
    if (b.subT <= 0 && b.rearIdleT <= 0) this.pickSpot(spots, true)
  }

  // ------------------------------------------------------------------ ambient life
  ambient(dt, ctx) {
    const A = WILD.ambient, s = this.amb, pl = ctx.player, C = s.cool
    for (let i = 0; i < C.length; i++) if (C[i] > 0) C[i] -= dt
    const wd = ctx.weeper ? d3(ctx.weeper, pl) : Infinity
    if (ctx.weeperTriggered || wd < A.weeperHush) { s.hush = this.U(A.resume); s.left = 0; s.silent = true; return }
    if (s.hush > 0) { s.hush -= dt; s.silent = true; return }
    s.silent = false
    const vol = ctx.indoor ? A.indoor : 1
    if (s.left > 0) {
      s.gap -= dt
      if (s.gap <= 0) {
        const sp = s.sp
        this.sfx(sp.name, s.x + (this.rng() - 0.5) * 3, s.y, s.z + (this.rng() - 0.5) * 3, sp.vol * vol); s.calls++
        s.left--; s.gap = this.U(sp.gap)
      }
      return
    }
    const rain = clamp(+ctx.rain || 0, 0, 1)
    const activity = Math.max(A.minActivity, 1 - rain * (ctx.night ? A.rainNight : A.rainDay))
    s.t -= dt * activity
    if (s.t > 0) return
    const set = ctx.night ? A.night : A.day, L = ctx.night ? this.ambSets.night : this.ambSets.day
    let tot = 0; for (let i = 0; i < L.length; i++) if (!(C[L[i].i] > 0)) tot += L[i].sp.w
    let r = this.rng() * tot, pick = null
    for (let i = 0; i < L.length && !pick; i++) { if (C[L[i].i] > 0) continue; r -= L[i].sp.w; if (r <= 0) pick = L[i] }
    pick = pick || L[0]
    const sp = pick.sp
    const a = this.rng() * TAU, dist = this.U(sp.dist)
    s.x = pl[0] + Math.sin(a) * dist; s.z = pl[2] + Math.cos(a) * dist; s.y = this.ground(s.x, s.z) + this.U(sp.h)
    s.sp = sp; s.left = sp.calls[0] + Math.floor(this.rng() * (sp.calls[1] - sp.calls[0] + 1)); s.gap = 0
    if (sp.cool) C[pick.i] = sp.cool
    s.t = this.U(set.every) + (this.rng() < set.quietChance ? this.U(set.quiet) : 0)
  }

  // ------------------------------------------------------------------ save / restore
  toJSON() {
    const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000, b = this.bear
    const cool = {}; this.ambNames.forEach((k, i) => { if (this.amb.cool[i] > 0) cool[k] = r2(this.amb.cool[i]) })
    return {
      v: 1,
      groups: this.groups.map((g) => ({ id: g.id, anchor: [r2(g.anchor[0]), r2(g.anchor[1])], state: g.state, members: g.members.map((m) => [r3(m.pos[0]), r3(m.pos[2]), r2(m.yaw)]) })),
      bear: b ? {
        pos: [r3(b.pos[0]), r3(b.pos[2])], yaw: r2(b.yaw), state: b.state, task: b.task, routeS: r2(b.routeS), spotI: b.spotI, sniffT: r2(b.sniffT),
        mood: r2(b.mood), ignoreT: r2(b.ignoreT), dogCool: r2(b.dogCool), bluffs: b.bluffs, swats: b.swats,
        nightOn: b.nightOn, nightT: r2(b.nightT), visitAt: r2(b.visitAt), visitRoll: b.visitRoll, visited: b.visited,
      } : null,
      amb: { t: r2(this.amb.t), hush: r2(this.amb.hush), cool },
      flags: Object.keys(this.flags).filter((k) => this.flags[k]),
    }
  }
  restore(s) {
    this.reset()
    if (!s || typeof s !== 'object') return
    const num = (v, d) => (Number.isFinite(v) ? v : d)
    for (const gs of s.groups || []) {
      const g = this.groups.find((q) => q.id === gs.id); if (!g) continue
      if (Array.isArray(gs.anchor) && this.placeOk(num(gs.anchor[0], NaN), num(gs.anchor[1], NaN), WILD.deer)) { g.anchor[0] = gs.anchor[0]; g.anchor[1] = gs.anchor[1] }
      g.members.forEach((m, i) => {
        const q = gs.members && gs.members[i], at = q ? this.standAt(num(q[0], NaN), num(q[1], NaN), WILD.deer) : null
        if (at) this.place(m, at[0], at[1], num(q[2], 0))
      })
      // a save mid-bolt comes back as a group that's just stopped running and is still watching
      if (gs.state && gs.state !== 'calm') { g.state = 'alert'; g.wary = true; g.waryT = 4; g.timer = 0; for (const m of g.members) m.act = 'alert' }
    }
    const b = this.bear, bs = s.bear
    if (b && bs) {
      const at = Array.isArray(bs.pos) ? this.standAt(num(bs.pos[0], NaN), num(bs.pos[1], NaN), WILD.bear) : null
      if (at) this.place(b, at[0], at[1], num(bs.yaw, 0))
      b.mood = clamp(num(bs.mood, 0), 0, 1); b.ignoreT = Math.max(0, num(bs.ignoreT, 0)); b.dogCool = Math.max(0, num(bs.dogCool, 0))
      b.swats = num(bs.swats, 0)
      b.nightOn = !!bs.nightOn; b.nightT = num(bs.nightT, 0); b.visitAt = num(bs.visitAt, 0); b.visitRoll = !!bs.visitRoll; b.visited = !!bs.visited
      b.spotI = clamp(num(bs.spotI, 0) | 0, 0, Math.max(0, this.bearSpots.length - 1))
      const task = ['forage', 'visit', 'sniff', 'return'].includes(bs.task) ? bs.task : 'forage'
      this.bearTask0(task)
      if (task === 'sniff') b.sniffT = Math.max(1, num(bs.sniffT, b.sniffT))
      if (ENGAGED[bs.state] || bs.state === 'leave' || bs.state === 'flee') b.ignoreT = Math.max(b.ignoreT, WILD.bear.restoreGrace)   // restored mid-encounter: a moment's grace
      this.bearEnter('calm')
    }
    const A = s.amb
    if (A) {
      this.amb.t = Math.max(0, num(A.t, this.amb.t)); this.amb.hush = Math.max(0, num(A.hush, 0))
      for (const k in A.cool || {}) { const i = this.ambNames.indexOf(k); if (i >= 0) this.amb.cool[i] = Math.max(0, num(A.cool[k], 0)) }
    }
    for (const k of s.flags || []) if (k in WILD.lines) this.flags[k] = true
  }
}
