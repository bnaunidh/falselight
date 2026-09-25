// node src/game/dogBrain.test.mjs — Juniper's rules, headless.
import { DogBrain, DOG, Crumbs } from './dogBrain.js'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  — ' + info : ''}`) }
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : v)

// a seeded rng so runs repeat
const rng = (() => { let s = 1983; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
// the stray's stretch of trail: straight north->south along +z, flat
const home = []; for (let z = 0; z <= 80; z += 2) home.push([0, 0, z])
const opts = () => ({ home, homeS: 40, ground: () => 0, rng, snap: (p, out) => { out[0] = p[0]; out[1] = p[1]; out[2] = p[2] - 1.2; return out } })

const DT = 1 / 60
function makeCtx() { return { player: [0, 0, 0], vel: [0, 0], jog: false, food: false, night: false, zone: 'trail', weeper: null, heater: null, play: true } }
/** Move the player toward `to` at `speed` (m/s) for up to `secs`, stepping the brain; onStep(t) after each frame. */
function walk(b, ctx, to, speed, secs = 1e9, onStep) {
  const ev = []; let t = 0
  while (t < secs) {
    const p = ctx.player, dx = to[0] - p[0], dy = to[1] - p[1], dz = to[2] - p[2], L = Math.hypot(dx, dy, dz)
    if (L < 1e-3 && secs > 1e8) break
    const step = Math.min(L, speed * DT)
    if (L > 1e-6) { p[0] += dx / L * step; p[1] += dy / L * step; p[2] += dz / L * step }
    const h = Math.hypot(dx, dz) || 1
    ctx.vel[0] = L > 1e-3 ? dx / h * speed * (Math.hypot(dx, dz) / (L || 1)) : 0; ctx.vel[1] = L > 1e-3 ? dz / h * speed * (Math.hypot(dx, dz) / (L || 1)) : 0
    for (const e of b.update(DT, ctx)) ev.push(e.type)
    t += DT
    onStep && onStep(t)
  }
  return ev
}
function wait(b, ctx, secs, onStep) { ctx.vel[0] = ctx.vel[1] = 0; const ev = []; for (let t = 0; t < secs; t += DT) { for (const e of b.update(DT, ctx)) ev.push(e.type); onStep && onStep(t) } return ev }
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
function distToPolyline(p, pts) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const L2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2 || 1e-12
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1] + (p[2] - a[2]) * v[2]) / L2))
    best = Math.min(best, Math.hypot(p[0] - a[0] - v[0] * t, p[1] - a[1] - v[1] * t, p[2] - a[2] - v[2] * t))
  }
  return best
}

// ------------------------------------------------------------------ 1. the stray keeps her distance
{
  const b = new DogBrain(opts()); const ctx = makeCtx(); ctx.player = [0, 0, 18]
  ok('starts on her stretch of trail', d2(b.pos, [0, 0, 40]) < 0.01 && b.state === 'stray', b.pos.map(f2).join(','))
  let minD = Infinity
  const ev = walk(b, ctx, [0, 0, 46], 1.5, 18, () => { if (ctx.player[2] > 30) minD = Math.min(minD, d2(b.pos, ctx.player)) })
  ok('sighting line fires once', ev.filter((e) => e === 'sighted').length === 1)
  ok('a walker never gets closer than ~3.5 m', minD > 3.5, 'min ' + f2(minD) + ' m (keep ' + DOG.keep + ')')
  ok('"she keeps her distance" hint fires (no food)', ev.includes('shy'))
  ok('she stays on the trail line', Math.abs(b.pos[0]) <= DOG.lateral + 1e-6, 'x ' + f2(b.pos[0]))
  // jog straight at her: she trots off
  let maxV = 0, minJ = Infinity
  walk(b, ctx, [0, 0, 80], 3.2, 6, () => { maxV = Math.max(maxV, b.speed); minJ = Math.min(minJ, d2(b.pos, ctx.player)) })
  ok('jogging at her makes her trot away', maxV > 2.5, 'max speed ' + f2(maxV) + ' m/s, closest ' + f2(minJ) + ' m')
}

// ------------------------------------------------------------------ 1b. walked the length of her trail: she steps aside, you pass
{
  const long = []; for (let z = 0; z <= 130; z += 2) long.push([0, 0, z])
  const b = new DogBrain({ ...opts(), home: long }); const ctx = makeCtx(); ctx.player = [0.3, 0, 22]
  let minD = Infinity, maxLat = 0
  walk(b, ctx, [0.3, 0, 110], 1.5, 1e9, () => { minD = Math.min(minD, d2(b.pos, ctx.player)); maxLat = Math.max(maxLat, Math.abs(b.pos[0])) })
  const passed = ctx.player[2] > b.pos[2] + 3
  wait(b, ctx, 10)
  ok('walked the whole trail: cornered, she steps into the brush and lets you pass', passed && minD > 1.7 && maxLat > 1.8 && maxLat < 2.5, 'closest ' + f2(minD) + ' m, off the trail ' + f2(maxLat) + ' m')
  ok('...then she is back on the trail', Math.abs(b.pos[0]) <= DOG.lateral + 0.05, 'x ' + f2(b.pos[0]))
}

// ------------------------------------------------------------------ 2. taming with two tins of beans
let tamedBrain, ctxT
{
  const b = new DogBrain(opts()); const ctx = makeCtx(); ctx.player = [0, 0, 30]
  wait(b, ctx, 2)
  ctx.food = true
  let minD = Infinity
  walk(b, ctx, [0, 0, 37.2], 0.6, 1e9, () => { minD = Math.min(minD, d2(b.pos, ctx.player)) })
  wait(b, ctx, 3, () => { minD = Math.min(minD, d2(b.pos, ctx.player)) })
  ok('with beans in hand she lets you within reach (2.6 m)', minD < 2.5, 'closest ' + f2(minD) + ' m')
  ok('offer #1 accepted', b.offer() === true && b.posture === 'eat')
  ok('cannot offer twice while she eats', b.offer() === false)
  let ev = wait(b, ctx, DOG.eatTime + 0.2)
  ok('after one tin she is still a stray (offer1 event)', ev.includes('offer1') && !b.tamed && b.trust > 0, 'trust ' + b.trust)
  ok('offer #2 accepted', b.offer() === true)
  ev = wait(b, ctx, DOG.eatTime + 0.2)
  ok('two tins: tamed event, she is yours', ev.includes('tamed') && b.tamed && b.state === 'follow' && b.name === 'Juniper')
  tamedBrain = b; ctxT = ctx
}

// ------------------------------------------------------------------ 3. taming: one tin + standing still near her for 20 s
{
  const b = new DogBrain(opts()); const ctx = makeCtx(); ctx.player = [0, 0, 32]; ctx.food = true
  walk(b, ctx, [0, 0, 37.5], 0.6)
  wait(b, ctx, 2)
  b.offer(); ctx.food = false
  wait(b, ctx, DOG.eatTime + 0.3)
  ok('one tin alone does not tame her', !b.tamed)
  const ev = wait(b, ctx, 19)
  ok('...not before 20 s of standing still', !b.tamed && !ev.includes('tamed'), 'still timer ' + f2(b.tameStillT))
  const ev2 = wait(b, ctx, 3)
  ok('one tin + 20 s standing still near her = tamed', ev2.includes('tamed') && b.tamed, 'dist ' + f2(d2(b.pos, ctx.player)))
}

// ------------------------------------------------------------------ 4. following the breadcrumbs (turns, stairs, a doorway)
{
  const b = tamedBrain, ctx = ctxT; ctx.food = false
  const trail = [b.crumbs.get(b.crumbs.first, [0, 0, 0])]; const rec = () => { const p = ctx.player; const l = trail[trail.length - 1]; if (!l || d3(l, p) > 0.02) trail.push([p[0], p[1], p[2]]) }
  rec()
  let maxOff = 0, lagSamples = []
  const check = () => { rec(); maxOff = Math.max(maxOff, distToPolyline(b.pos, trail)) }
  walk(b, ctx, [0, 0, 20], 1.5, 1e9, check)
  // steady walk: how far behind (along the path)?
  walk(b, ctx, [0, 0, 8], 1.5, 1e9, () => { check(); lagSamples.push(b.crumbs.endS(ctx.player) - b.sd) })
  const lag = lagSamples.slice(-60).reduce((a, v) => a + v, 0) / 60
  ok('walking: she keeps ~1.6 m behind you (along your path)', lag > 1.4 && lag < 2.3, 'avg path gap ' + f2(lag) + ' m')
  // an L-turn, a ramp up (stairs), a switchback, a doorway
  const pts = [[8, 0, 8], [8, 0, 4], [8, 3, -1], [5, 3, -1], [5, 6, 4], [3, 6, 4], [3, 6, 6.5], [1.5, 6, 6.5]]
  let maxSpeed = 0
  for (const p of pts) walk(b, ctx, p, 1.5, 1e9, () => { check(); maxSpeed = Math.max(maxSpeed, b.speed) })
  wait(b, ctx, 3, check)
  ok('she never leaves your footsteps (turns, stairs, doorway)', maxOff < 0.2, 'max off your path ' + f2(maxOff) + ' m (your capsule radius is 0.3)')
  ok('she climbs with you (stairs)', b.pos[1] > 5.5, 'y ' + f2(b.pos[1]))
  // jog: she trots and keeps up
  let maxGap = 0, trotV = 0
  walk(b, ctx, [1.5, 6, 30], 3.2, 1e9, () => { check(); trotV = Math.max(trotV, b.speed); maxGap = Math.max(maxGap, b.crumbs.endS(ctx.player) - b.sd) })
  ok('jogging: she trots to keep up', trotV > 2.2 && maxGap < DOG.teleportGap, 'max speed ' + f2(trotV) + ', max gap ' + f2(maxGap))
  // stop: sit after 3 s, lie after 20 s
  wait(b, ctx, 1.5); const p0 = b.posture
  wait(b, ctx, 2.2); const p1 = b.posture
  wait(b, ctx, 17.5); const p2 = b.posture
  ok('you stop: stand, sit after 3 s, lie after 20 s', p0 === 'stand' && p1 === 'sit' && p2 === 'lie', [p0, p1, p2].join(' → '))
  // double back past her: she turns with you instead of walking to where you turned
  const back = [1.5, 6, 22]
  let maxBehind = 0
  walk(b, ctx, back, 1.5, 1e9, () => { check(); maxBehind = Math.max(maxBehind, d2(b.pos, ctx.player)) })
  ok('doubling back past her cuts the loop (no walking to the turnaround)', maxBehind < 4.5 && maxOff < 0.2, 'max distance ' + f2(maxBehind) + ' m')
  // teleport
  ctx.player = [40, 0, 100]
  const ev = wait(b, ctx, 0.5)
  ok('you teleport: she is put right behind you', ev.includes('teleport') && d3(b.pos, ctx.player) < 2, 'dist ' + f2(d3(b.pos, ctx.player)))
}

// ------------------------------------------------------------------ 5. stay / come
{
  const b = tamedBrain, ctx = ctxT
  walk(b, ctx, [40, 0, 110], 1.5)
  wait(b, ctx, 1)
  const at = b.pos.slice()
  ok('"Stay"', b.command('stay') && b.mode === 'stay')
  let moved = 0
  walk(b, ctx, [40, 0, 150], 1.5, 1e9, () => { moved = Math.max(moved, d3(b.pos, at)) })
  wait(b, ctx, 21)
  ok('staying: she holds the spot while you walk 40 m off', moved < 0.01 && b.posture === 'lie', 'moved ' + f2(moved) + ' m, posture ' + b.posture)
  const ev = []
  ev.push(...(b.command('come') ? ['come'] : []))
  let offPath = 0; const line = [[40, 0, at[2]], [40, 0, 150]]
  wait(b, ctx, 25, () => { offPath = Math.max(offPath, distToPolyline(b.pos, line)) })
  ok('"Come": she runs your path back to you', ev.includes('come') && d2(b.pos, ctx.player) < 2.2 && offPath < 0.06, 'dist ' + f2(d2(b.pos, ctx.player)) + ', off path ' + f2(offPath))
}

// ------------------------------------------------------------------ 6. the Weeper: hackles, once per approach
{
  const b = tamedBrain, ctx = ctxT
  ctx.weeper = [40, 0, 230]   // 80 m off
  let ev = wait(b, ctx, 1)
  ok('no warning while he is 80 m off', !ev.includes('warn'))
  const warns = []
  ctx.weeper = [40, 0, 200]   // 50 m
  ev = wait(b, ctx, 5, () => {}); warns.push(ev.filter((e) => e === 'warn').length)
  ok('he comes within 60 m: one warning, she stares, hackles up', warns[0] === 1 && b.alert > 0.8, 'alert ' + f2(b.alert))
  ev = wait(b, ctx, 5)
  ok('...and only once while he stays', !ev.includes('warn'))
  ctx.weeper = null; wait(b, ctx, 3)
  ctx.weeper = [40, 0, 195]; ev = wait(b, ctx, 1)
  ok('a second approach warns again', ev.includes('warn'))
  ctx.weeper = null; wait(b, ctx, 4)
  ok('hackles settle once he is gone', b.alert < 0.2, 'alert ' + f2(b.alert))
}

// ------------------------------------------------------------------ 7. the cab at night: the rug by the heater
{
  const b = tamedBrain, ctx = ctxT
  // up the "stairs" to the catwalk, through the door, into the cab (floor y = 30)
  const route = [[40, 0, 152], [3.5, 0, 3.5], [3.5, 30, -3.5], [0.52, 30, 2.6], [0.52, 30, 1.2], [-0.8, 30, -0.4]]
  ctx.player = [40, 0, 150]; b.update(DT, ctx)
  for (const p of route) walk(b, ctx, p, 3, 1e9)
  ctx.night = true; ctx.zone = 'cab'; ctx.heater = { pos: [1.42, 30, 0.88], yaw: Math.PI }
  wait(b, ctx, 8)
  ok('night, cab: she goes and lies by the heater', b.state === 'heater' && d2(b.pos, ctx.heater.pos) < 0.08 && b.posture === 'lie', b.pos.map(f2).join(',') + ' ' + b.posture)
  // out the door onto the catwalk: she gets up and follows (through the door, not the wall)
  ctx.zone = 'catwalk'
  const out = []; const rec = () => out.push(b.pos.slice())
  walk(b, ctx, [0.52, 30, 1.2], 1.5, 1e9, rec); walk(b, ctx, [0.52, 30, 2.8], 1.5, 1e9, rec); walk(b, ctx, [2.6, 30, 2.8], 1.5, 1e9, rec)
  wait(b, ctx, 4, rec)
  const crossedWall = out.some((p, i) => i && ((Math.abs(p[0]) < 2.03 && Math.abs(p[2]) < 2.03) !== (Math.abs(out[i - 1][0]) < 2.03 && Math.abs(out[i - 1][2]) < 2.03)) && !(Math.abs(p[0] - 0.52) < 0.6))
  ok('you leave: she follows you out through the door', b.state === 'follow' && !(Math.abs(b.pos[0]) < 2.03 && Math.abs(b.pos[2]) < 2.03) && !crossedWall, b.pos.map(f2).join(','))
  ctx.night = false; ctx.zone = 'catwalk'; ctx.heater = null
}

// ------------------------------------------------------------------ 8. save / restore
{
  const b = tamedBrain, ctx = ctxT
  walk(b, ctx, [2.6, 30, -2.8], 1.5); wait(b, ctx, 1)
  const js = JSON.parse(JSON.stringify(b.toJSON()))
  const r = new DogBrain(opts(), js)
  ok('save/restore keeps tamed, trust, mode, spot', r.tamed && r.trust === b.trust && r.mode === b.mode && d3(r.pos, b.pos) < 0.01, JSON.stringify({ trust: r.trust, mode: r.mode }))
  ok('save/restore keeps the breadcrumb trail', r.crumbs.count > 10 && Math.abs((r.crumbs.endS(ctx.player) - r.sd) - (b.crumbs.endS(ctx.player) - b.sd)) < 0.05,
    'gap ' + f2(r.crumbs.endS(ctx.player) - r.sd) + ' vs ' + f2(b.crumbs.endS(ctx.player) - b.sd))
  r.lastPlayer = ctx.player.slice()
  const trail = [ctx.player.slice()]; let off = 0
  walk(r, ctx, [2.6, 30, -0.5], 1.5, 1e9, () => { trail.push(ctx.player.slice()) })
  wait(r, ctx, 2)
  ok('restored dog keeps following', d2(r.pos, ctx.player) < 2.2, 'dist ' + f2(d2(r.pos, ctx.player)))
  const stray = new DogBrain(opts(), JSON.parse(JSON.stringify(new DogBrain(opts()).toJSON())))
  ok('restored stray is a stray at home', stray.state === 'stray' && d2(stray.pos, [0, 0, 40]) < 0.01)
  const bad = new DogBrain(opts(), { garbage: true })
  ok('garbage save does not crash', bad.state === 'stray')
}

// ------------------------------------------------------------------ 9. crumbs ring buffer
{
  const c = new Crumbs(8); for (let i = 0; i < 20; i++) c.push(i, 0, 0)
  ok('ring buffer keeps the last N crumbs with arc length', c.first === 12 && c.s(19) === 19 && c.seek(15.5, 12) === 15)
}

// ------------------------------------------------------------------ 10. a door you shut between you (review fix)
{
  let shut = false; const D = 60
  // the "door": the plane z = 60 (the real one is the cab door's collider, enabled only while it's shut)
  const b = new DogBrain({ ...opts(), blocked: (a, q) => shut && (a[2] - D) * (q[2] - D) < 0 })
  const ctx = makeCtx(); ctx.player = [0, 0, 41.6]; b.update(DT, ctx); b.tame()
  walk(b, ctx, [0, 0, D + 1.0], 1.5)                // through the doorway; she is ~1.6 m behind you, still on her side
  wait(b, ctx, 0.3)
  const side0 = b.pos[2] < D
  shut = true
  let crossed = false, minClear = Infinity, maxGap = 0; const evs = []
  const watch = () => { if (b.pos[2] >= D) crossed = true; minClear = Math.min(minClear, D - b.pos[2]); maxGap = Math.max(maxGap, b.crumbs.endS(ctx.player) - b.sd) }
  for (let k = 0; k < 2; k++) { evs.push(...walk(b, ctx, [0, 0, D + 12], 1.5, 1e9, watch)); evs.push(...walk(b, ctx, [0, 0, D + 1.5], 1.5, 1e9, watch)) }
  evs.push(...wait(b, ctx, 5, watch))
  ok('a shut door between you: she waits on her side, nose clear of it, never through it — not even past the 40 m teleport gap',
    side0 && !crossed && minClear > 0.55 && D - b.pos[2] > 0.68 && maxGap > DOG.teleportGap && !evs.includes('teleport'), 'feet ' + f2(D - b.pos[2]) + ' m from it (closest ' + f2(minClear) + '), path gap ' + f2(maxGap) + ' m')
  ok('...one "door" event, and she sits down to wait', evs.filter((e) => e === 'door').length === 1 && b.posture === 'sit' && b.act === 'door')
  shut = false
  wait(b, ctx, 6)
  ok('...you open it: she comes to you', d2(b.pos, ctx.player) < 2.5 && b.pos[2] > D, 'dist ' + f2(d2(b.pos, ctx.player)))
  // short wait at a door, then open: she walks through (no teleport)
  walk(b, ctx, [0, 0, 50], 1.5); wait(b, ctx, 2); walk(b, ctx, [0, 0, 60.8], 1.5); wait(b, ctx, 0.2)
  shut = true; const e2 = walk(b, ctx, [0, 0, 66], 1.5); wait(b, ctx, 1)
  const held = b.pos[2] < D - 0.6
  shut = false; e2.push(...wait(b, ctx, 5))
  ok('...a short wait, then through the doorway on foot (no teleport)', held && b.pos[2] > D && !e2.includes('teleport') && d2(b.pos, ctx.player) < 2.3, 'dist ' + f2(d2(b.pos, ctx.player)))
}

// ------------------------------------------------------------------ 11. save while she stays far back, then "Come" (review fix)
{
  const b = new DogBrain(opts()); const ctx = makeCtx(); ctx.player = [0, 0, 41.6]; b.update(DT, ctx); b.tame()
  walk(b, ctx, [0, 0, 44], 1.5); wait(b, ctx, 1); b.command('stay')
  walk(b, ctx, [0, 0, 80], 1.5); walk(b, ctx, [0, 0, 46], 1.5); walk(b, ctx, [0, 0, 80], 1.5)   // ~70 m of path since she stayed
  const js = JSON.parse(JSON.stringify(b.toJSON()))
  const r = new DogBrain(opts(), js); r.lastPlayer = ctx.player.slice()
  const at = r.pos.slice(); wait(r, ctx, 1)
  ok('saved while staying off the saved path: restored, she still stays put', js.lost === true && r.mode === 'stay' && d3(r.pos, at) < 0.01)
  r.command('come'); const ev = wait(r, ctx, 0.5)
  ok('..."Come" puts her with you (not on an old footstep 50 m back)', ev.includes('teleport') && d3(r.pos, ctx.player) < 2, 'dist ' + f2(d3(r.pos, ctx.player)))
}

// ------------------------------------------------------------------ 12. warn carries how far YOU are; junk saves never make NaN (review)
{
  const b = new DogBrain(opts()); const ctx = makeCtx(); ctx.player = [0, 0, 10]; ctx.weeper = [0, 0, 70]
  const e = b.update(DT, ctx).find((x) => x.type === 'warn')
  ok('warn event has playerDistance (the game can skip a stray freezing where you can\'t see her)', e && Math.abs(e.playerDistance - 30) < 0.01 && Math.abs(e.distance - 30) < 0.01, e && f2(e.playerDistance))
  const j = new DogBrain(opts(), { tamed: true, mode: 'follow', pos: [NaN, 1, 2], crumbs: [1, NaN, 3, 4, 5, 6], sd: 'x', yaw: null, trust: 'a', hs: Infinity, posture: 'eat' })
  const c2 = makeCtx(); c2.player = [0, 0, 30]
  for (let i = 0; i < 120; i++) j.update(DT, c2)
  ok('junk save: no NaN anywhere', [...j.pos, j.yaw, j.trust, j.sd, j.hs].every(Number.isFinite) && j.tamed, j.pos.map(f2).join(','))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
