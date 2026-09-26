// node --expose-gc src/game/wildlifeBrain.test.mjs — the wildlife rules, headless (deer, the bear — its bluffs, the chase if you
// run, the night stalk, its eyeshine — the dog's barking, the ambient calls, save/restore), on synthetic ground and then on the
// real terrain + layout if assets/ is there.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WildlifeBrain, WILD, resolvePlaces, Path, eyeshine } from './wildlifeBrain.js'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  — ' + info : ''}`) }
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v))
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v))
const DT = 1 / 60
const D = WILD.deer, B = WILD.bear
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)

// ---------------------------------------------------------------- a synthetic world
// flat at y = 0, except a steep bank rising east of x = 60 (slope 1.2) and a ravine polygon north of z = -60
const flat = () => 0
const bank = (x, z) => (x > 60 ? (x - 60) * 1.2 : 0)
const RAVINE = [[-200, -60], [200, -60], [200, -200], [-200, -200]]
const rect = { min: [-500, -500], max: [500, 500] }
function makeBrain(o = {}) {
  return new WildlifeBrain({
    ground: o.ground || flat, rect, ravine: o.ravine || null, rock: o.rock || null, tower: o.tower || [0, -400], shed: o.shed || null,
    deerGroups: o.deer === undefined ? [{ id: 'g', home: [0, 100], members: [{ role: 'doe', scale: 1 }, { role: 'fawn', scale: 0.6 }] }] : o.deer,
    bearSpots: o.bearSpots || [[0, 100], [30, 110], [-30, 90]], shedSpots: o.shedSpots || [], route: o.route || null,
    bear: o.bear === undefined ? false : o.bear, rng: seeded(o.seed || 1983),
  }, o.saved || null)
}
function makeCtx(o = {}) {
  return { player: [0, 0, 0], vel: [0, 0], jog: false, playerSafe: false, indoor: false, night: false, rain: 0, weeper: null, weeperTriggered: false, dog: null, ...o }
}
const rec = (e, t) => ({ t, type: e.type, name: e.name, amount: e.amount, why: e.why, text: e.text, pos: e.pos.slice(), volume: e.volume, shake: e.shake, fov: e.fov, beat: e.beat })
/** Step the brain for secs, moving the player toward `to` at `speed` (null = stand still). onStep(t) after each frame. */
function sim(b, ctx, secs, { to = null, speed = 0, jog = false, onStep = null, log = null, stopAt = null } = {}) {
  const evs = log || []
  for (let t = 0; t < secs; t += DT) {
    const p = ctx.player
    if (to) {
      const dx = to[0] - p[0], dz = to[2] - p[2], L = Math.hypot(dx, dz)
      if (L > 1e-3) { const s = Math.min(L, speed * DT); p[0] += dx / L * s; p[2] += dz / L * s; ctx.vel[0] = dx / L * speed; ctx.vel[1] = dz / L * speed } else { ctx.vel[0] = ctx.vel[1] = 0 }
    } else { ctx.vel[0] = ctx.vel[1] = 0 }
    ctx.jog = jog
    b.time0 = (b.time0 || 0) + DT
    for (const e of b.update(DT, ctx)) evs.push(rec(e, b.time0))
    if (onStep) onStep(t)
    if (stopAt && stopAt()) break
  }
  ctx.vel[0] = ctx.vel[1] = 0
  return evs
}
const named = (evs, n) => evs.filter((e) => e.type === 'sfx' && e.name === n)
const typed = (evs, ty) => evs.filter((e) => e.type === ty)
const centroid = (g) => { let x = 0, z = 0; for (const m of g.members) { x += m.pos[0]; z += m.pos[2] } return [x / g.members.length, 0, z / g.members.length] }
const AMB = new Set([...WILD.ambient.day.species, ...WILD.ambient.night.species].map((s) => s.name))
const wildOnly = (evs) => evs.filter((e) => !(e.type === 'sfx' && AMB.has(e.name)))

console.log('— deer —')
// ------------------------------------------------------------------ 1. grazing, left alone
{
  const b = makeBrain(), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 400] })
  const acts = new Set(); let maxOff = 0, maxFawn = 0
  sim(b, ctx, 300, { onStep: () => { for (const m of g.members) { acts.add(m.act); maxOff = Math.max(maxOff, Math.hypot(m.pos[0] - 0, m.pos[2] - 100)) } maxFawn = Math.max(maxFawn, d2(g.members[0].pos, g.members[1].pos)) } })
  ok('left alone, they graze and wander slowly', acts.has('graze') && acts.has('walk') && g.state === 'calm', [...acts].join(' '))
  ok('they keep to their patch', maxOff < D.range + D.keepFawn + 3, 'furthest ' + f1(maxOff) + ' m from home')
  ok('the fawn stays near her mother', maxFawn < D.keepFawn * 1.6 + 4, 'max ' + f1(maxFawn) + ' m apart')
}
// ------------------------------------------------------------------ 2. alert at ~25 m, snort, bolt at ~12 m, calm down again
{
  const b = makeBrain({ seed: 7 }), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 170] })
  let alertAt = null, fleeAt = null, alertT = 0
  const evs = sim(b, ctx, 80, { to: [0, 0, 100], speed: 1.4, onStep: () => {
    if (alertAt == null && g.state === 'alert') { alertAt = g.dP; alertT = b.time0 }
    if (fleeAt == null && g.state === 'flee') fleeAt = g.dP
  }, stopAt: () => g.state === 'flee' })
  const snort0 = named(evs, 'deer_snort').find((e) => Math.abs(e.t - alertT) < 0.05)
  ok('a walker within ~25 m: they go alert', alertAt != null && alertAt <= D.alertRange && alertAt > D.alertRange - 2, 'alert at ' + f1(alertAt) + ' m')
  ok('...and snort (sfx deer_snort, from the doe)', !!snort0 && d2(snort0.pos, g.leader.pos) < 1.5 && snort0.pos[1] > 0.5, snort0 ? 'at ' + snort0.pos.map(f1).join(',') : 'none')
  ok('the first alert says the deer line once', typed(evs, 'say').length === 1 && /Deer\./.test(typed(evs, 'say')[0].text))
  ok('at ~12 m they bolt', fleeAt != null && fleeAt <= D.fleeRange && fleeAt > D.fleeRange - 1.5, 'fled at ' + f1(fleeAt) + ' m')
  const from = g.members.map((m) => m.pos.slice()), pl = ctx.player.slice()
  let maxV = 0
  const evs2 = sim(b, ctx, 25, { onStep: () => { for (const m of g.members) maxV = Math.max(maxV, m.speed) } , stopAt: () => g.state !== 'flee' })
  const moved = g.members.map((m, i) => d2(m.pos, from[i]))
  ok('they bound away 40-80 m', moved.every((d) => d > D.flee[0] - 6 && d < D.flee[1] + 6), moved.map(f1).join(' / ') + ' m, top speed ' + f1(maxV) + ' m/s')
  ok('...away from you', g.members.every((m, i) => d2(m.pos, pl) > d2(from[i], pl) + 30), g.members.map((m) => f1(d2(m.pos, pl))).join(' / ') + ' m from you now')
  ok('the bolt snorts (and the fawn may bleat)', named(evs, 'deer_snort').length >= 2 || named(evs2, 'deer_snort').length >= 1)
  let grazing = false
  sim(b, ctx, 60, { onStep: () => { if (g.state === 'calm' && g.members.some((m) => m.act === 'graze')) grazing = true } })
  ok('afterwards they calm down and graze again', grazing && g.state === 'calm', 'state ' + g.state + ', anchor ' + g.anchor.map(f1).join(','))
  const a0 = g.anchor.slice()
  sim(b, ctx, 120, {})
  ok('...and drift back toward home', Math.hypot(g.anchor[0], g.anchor[1] - 100) < Math.hypot(a0[0], a0[1] - 100) - 5, f1(Math.hypot(a0[0], a0[1] - 100)) + ' -> ' + f1(Math.hypot(g.anchor[0], g.anchor[1] - 100)) + ' m from home')
}
// ------------------------------------------------------------------ 3. stand still at 20 m: alert, then they settle
{
  const b = makeBrain({ seed: 11 }), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 60, { to: [0, 0, 100], speed: 1.4, stopAt: () => g.dP < 20 })
  const wasAlert = g.state === 'alert'
  const evs = sim(b, ctx, 20, {})
  ok('a still watcher at 20 m: alert, then they go back to grazing (no bolt)', wasAlert && g.state === 'calm' && !evs.some((e) => e.name === 'deer_bleat') && g.dP > D.fleeRange, 'state ' + g.state + ', ' + f1(g.dP) + ' m')
  const before = g.state
  sim(b, ctx, 8, { to: [ctx.player[0], 0, ctx.player[2] - 1.0], speed: 0.4 })
  ok('...and a small step does not set them off again', before === 'calm' && g.state === 'calm')
}
// ------------------------------------------------------------------ 4. a jogger at 30 m
{
  const b = makeBrain({ seed: 3 }), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 145] })
  let at = null
  sim(b, ctx, 20, { to: [0, 0, 100], speed: 3.2, jog: true, stopAt: () => { if (g.state === 'flee' && at == null) at = g.dP; return at != null } })
  ok('a jogging player makes them bolt from further off', at != null && at > D.alertRange && at <= D.jogRange, 'bolted at ' + f1(at) + ' m')
}
// ------------------------------------------------------------------ 5. the dog within 15 m
{
  const b = makeBrain({ seed: 5 }), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 300], dog: { pos: [0, 0, 130], tamed: true } })
  let at = null
  for (let t = 0; t < 20 && at == null; t += DT) { ctx.dog.pos[2] -= 3 * DT; b.update(DT, ctx); if (g.state === 'flee') at = Math.min(...g.members.map((m) => Math.hypot(m.pos[0] - ctx.dog.pos[0], m.pos[2] - ctx.dog.pos[2]))) }
  ok('the dog within 15 m: they bolt (you nowhere near)', at != null && at <= D.dogRange, 'at ' + f1(at) + ' m from her')
  const from = g.members.map((m) => m.pos.slice())
  sim(b, ctx, 20, { stopAt: () => g.state !== 'flee' })
  ok('...away from the dog', g.members.every((m, i) => d2(m.pos, ctx.dog.pos) > d2(from[i], ctx.dog.pos) + 25))
}
// ------------------------------------------------------------------ 6. the Weeper within 60 m
{
  const b = makeBrain({ seed: 9 }), g = b.groups[0], ctx = makeCtx({ player: [0, 0, 400], weeper: [-70, 1.3, 100] })
  sim(b, ctx, 2)
  ok('the Weeper at 70 m: nothing yet', g.state === 'calm')
  ctx.weeper[0] = -45
  const c0 = centroid(g)
  sim(b, ctx, 20, { stopAt: () => g.state !== 'flee' && b.time0 > 0 })
  sim(b, ctx, 20, { stopAt: () => g.state !== 'flee' })
  const c1 = centroid(g), dir = [c1[0] - c0[0], c1[2] - c0[2]], away = [c0[0] - ctx.weeper[0], c0[2] - ctx.weeper[2]]
  const cos = (dir[0] * away[0] + dir[1] * away[1]) / (Math.hypot(...dir) * Math.hypot(...away) || 1)
  ok('the Weeper within 60 m: they bolt, away from him', Math.hypot(...dir) > 30 && cos > 0.6, f1(Math.hypot(...dir)) + ' m, cos ' + f2(cos))
}
// ------------------------------------------------------------------ 7. never into the ravine, up the bank, or off the map
{
  // graze just south of the ravine's rim and west of the steep bank; you come at them from the south-west
  const b = makeBrain({ seed: 21, ground: bank, ravine: RAVINE, deer: [{ id: 'g', home: [40, -45], members: [{ role: 'doe', scale: 1 }, { role: 'doe', scale: 1 }] }] })
  const g = b.groups[0], ctx = makeCtx({ player: [0, 0, 0] })
  let inRav = 0, maxSlope = 0, minEdge = Infinity
  const watch = () => { for (const m of g.members) { if (b.inRavine(m.pos[0], m.pos[2])) inRav++; maxSlope = Math.max(maxSlope, b.slopeAt(m.pos[0], m.pos[2])); minEdge = Math.min(minEdge, 500 - Math.abs(m.pos[0]), 500 - Math.abs(m.pos[2])) } }
  for (let k = 0; k < 6; k++) {   // chase them round a few times
    const c = centroid(g), dx = c[0] + 12 * Math.cos(k), dz = c[2] + 12 * Math.sin(k)
    ctx.player[0] = c[0] - 30 * Math.cos(k); ctx.player[2] = c[2] - 30 * Math.sin(k)
    sim(b, ctx, 30, { to: [dx, 0, dz], speed: 1.4, onStep: watch })
    sim(b, ctx, 20, { onStep: watch })
  }
  ok('chased about by a cliff and a ravine: never in the ravine', inRav === 0, inRav + ' frames')
  ok('...never up the steep bank', maxSlope <= D.hardSlope + 1e-6, 'steepest ground stood on ' + f2(maxSlope) + ' (limit ' + D.hardSlope + ')')
  ok('...never near the map edge', minEdge >= WILD.edgeMargin - 1, f1(minEdge) + ' m')
}

console.log('— the bear —')
const bearBrain = (o = {}) => makeBrain({ deer: [], bear: true, bearSpots: [[0, 100]], ...o })
// ------------------------------------------------------------------ 8. notice -> rear -> huff (sounds) -> you back off -> it leaves
{
  const b = bearBrain(), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
  let noticeAt = null
  const states = []
  const evs = sim(b, ctx, 40, { to: [0, 0, 100], speed: 1.4, onStep: () => { if (states[states.length - 1] !== br.state) states.push(br.state); if (noticeAt == null && br.state === 'notice') noticeAt = d2(br.pos, ctx.player) }, stopAt: () => br.state === 'notice' })
  ok('it notices a walker at ~30 m', noticeAt != null && noticeAt <= B.noticeRange && noticeAt > B.noticeRange - 2, f1(noticeAt) + ' m')
  ok('the first time, a tip (toast): don\'t run', typed(evs, 'toast').length === 1 && /Don't run/.test(typed(evs, 'toast')[0].text))
  const evs2 = sim(b, ctx, 8, { onStep: () => { if (states[states.length - 1] !== br.state) states.push(br.state) } })
  ok('then rears up to sniff, then huffs', states.join('>').includes('notice>rear>huff'), states.join(' > '))
  sim(b, ctx, 4, { log: evs2 })
  const hs = ['bear_huff', 'bear_jawpop', 'bear_woof'].map((n) => named(evs2, n).length)
  ok('huffing: bear_huff, bear_jawpop and bear_woof', hs.every((n) => n > 0), 'huff ' + hs[0] + ', jawpop ' + hs[1] + ', woof ' + hs[2])
  ok('no fear, no harm while you keep your distance', !evs2.some((e) => e.type === 'fear' || e.type === 'hurt'))
  const at = br.pos.slice()
  sim(b, ctx, 6, { to: [0, 0, 160], speed: 1.0, stopAt: () => br.state === 'leave' })
  ok('you back off: it loses interest and walks away', br.state === 'leave', br.state)
  let went = 0
  sim(b, ctx, 70, { to: [0, 0, 160], speed: 1.0, onStep: () => { went = Math.max(went, d2(br.pos, at)) }, stopAt: () => br.state === 'calm' })
  ok('...35+ m off, then back to its business (ignoring you a while)', went > 30 && br.state === 'calm' && br.ignoreT > 20, f1(went) + ' m, ' + br.state + ', ignoring you for ' + f1(br.ignoreT) + ' s')
}
// ------------------------------------------------------------------ 9. standing still
{
  const b = bearBrain(), br = b.bear, ctx = makeCtx({ player: [0, 0, 122] })
  sim(b, ctx, 10)
  ok('a still player at 22 m is not noticed (still: ' + B.noticeStill + ' m)', br.state === 'calm', br.state)
  const b2 = bearBrain(), br2 = b2.bear, ctx2 = makeCtx({ player: [0, 0, 150] })
  sim(b2, ctx2, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => br2.state === 'notice' })
  const evs = sim(b2, ctx2, 20, { stopAt: () => br2.state === 'leave' })
  ok('notice, then you freeze: it rears, huffs, and walks off', br2.state === 'leave' && !evs.some((e) => e.type === 'fear'), 'after ' + f1(evs.length ? evs[evs.length - 1].t : 0) + ' s')
}
// ------------------------------------------------------------------ 10. keep coming: bluff charge (10 m/s, stops ~2 m short, rears and
// growls over you) -> close in -> swat -> retreat
{
  const b = bearBrain({ seed: 4 }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
  let bluffAt = null, minD = Infinity, topV = 0
  const evs = sim(b, ctx, 20, { to: [br.pos[0], 0, br.pos[2]], speed: 1.0, onStep: () => { if (bluffAt == null && br.state === 'bluff') bluffAt = d2(br.pos, ctx.player) }, stopAt: () => br.state === 'bluff' })
  sim(b, ctx, 5, { log: evs, onStep: () => { minD = Math.min(minD, d2(br.pos, ctx.player)); topV = Math.max(topV, br.speed) }, stopAt: () => br.state === 'standoff' })
  const fear = typed(evs, 'fear')
  ok('inside 10 m it bluff-charges', bluffAt != null && bluffAt <= B.bluffRange + 0.1, 'charged at ' + f1(bluffAt) + ' m, top speed ' + f1(topV) + ' m/s')
  ok('...fast: ~10 m/s (a big boar, off the mark like a shot)', topV >= B.chargeSpeed * 0.95 && topV <= B.chargeSpeed + 1e-9, 'top speed ' + f1(topV) + ' m/s')
  ok('...hooks.fear(0.6) and a huff', fear.length === 1 && Math.abs(fear[0].amount - 0.6) < 1e-9 && named(evs, 'bear_huff').length > 0)
  const sc = typed(evs, 'scare')
  ok('...a jolt as it comes (hooks.scare: shake, FOV punch, heartbeat) and a bawl', sc.some((e) => e.why === 'bluff' && e.shake > 0.3 && e.fov < 0 && e.beat) && named(evs, 'bear_bawl').length === 1, sc.map((e) => e.why + ' ' + e.shake + '/' + e.fov).join(', '))
  ok('...and stops ~2 m short', br.state === 'standoff' && minD > 1.7 && minD < 2.6, 'closest ' + f2(minD) + ' m')
  ok('...where it rears to its full height over you, growling', br.act === 'rear' && named(evs, 'bear_growl').length === 1 && sc.some((e) => e.why === 'rear'), 'act ' + br.act + ', ' + named(evs, 'bear_growl').length + ' growl')
  ok('the bluff says its line once', typed(evs, 'say').filter((e) => /stops dead/.test(e.text)).length === 1)
  ok('no hurt from a bluff', !evs.some((e) => e.type === 'hurt'))
  const evs2 = sim(b, ctx, 4, { to: [br.pos[0], 0, br.pos[2]], speed: 0.8, stopAt: () => typed(b._out, 'hurt').length > 0 })
  const hurt = typed(evs2, 'hurt'), fear2 = typed(evs2, 'fear')
  ok('close inside 4 m after the bluff: it SWATS — hooks.hurt(0.35, "bear")', hurt.length === 1 && Math.abs(hurt[0].amount - 0.35) < 1e-9 && hurt[0].why === 'bear', hurt.length ? 'hurt ' + hurt[0].amount + ' ' + hurt[0].why : 'no swat')
  ok('...hooks.fear(1), a growl and a hard jolt', fear2.some((e) => e.amount === 1) && named(evs2, 'bear_growl').length === 1 && typed(evs2, 'scare').some((e) => e.why === 'hit' && e.shake === 1 && e.beat))
  const evs3 = sim(b, ctx, 25)
  ok('then it retreats (and does not come back for more)', d2(br.pos, ctx.player) > 25 && !evs3.some((e) => e.type === 'hurt'), f1(d2(br.pos, ctx.player)) + ' m, ' + br.state)
  ok('its mood is up after all that', br.mood > 0.5, 'mood ' + f2(br.mood))
}
// ------------------------------------------------------------------ 11. bluffed, then you stand your ground (still): no swat
{
  const b = bearBrain({ seed: 8 }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
  sim(b, ctx, 20, { to: [br.pos[0], 0, br.pos[2]], speed: 1.0, stopAt: () => br.state === 'bluff' })
  const evs = sim(b, ctx, 20, {})
  ok('bluffed, you stand still: it walks away, no swat', !evs.some((e) => e.type === 'hurt') && (br.state === 'leave' || br.state === 'calm'), br.state)
}
// ------------------------------------------------------------------ 12. run at it
{
  const b = bearBrain({ seed: 12 }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
  let at = null
  sim(b, ctx, 10, { to: [br.pos[0], 0, br.pos[2]], speed: 3.2, jog: true, stopAt: () => { if (br.state === 'bluff') at = d2(br.pos, ctx.player); return at != null } })
  ok('running at it makes it charge before 10 m', at != null && at > B.bluffRange, 'charged at ' + f1(at) + ' m')
}
// ------------------------------------------------------------------ 13. the tower: it never comes in, never charges you there; the night visit
{
  const route = []; for (let z = 200; z >= 6; z -= 4) route.push([4, 0, z])   // a trail straight up to the gate (0, 6)
  const b = bearBrain({ seed: 2, tower: [0, 0], shed: [9, 7], shedSpots: [[15, 4], [12, 10], [8.5, 11]], route, bearSpots: [[0, 220], [20, 230]] })
  const br = b.bear, ctx = makeCtx({ player: [1.2, 30, 1.2], playerSafe: true, indoor: true, night: true })   // you're up in the cab
  b.update(DT, ctx); br.visitRoll = true   // (it visits on 85 % of nights: made certain here; the odds are checked below)
  let minCheb = Infinity, tasks = [], minShed = Infinity
  const evs = sim(b, ctx, 700, { onStep: () => {
    minCheb = Math.min(minCheb, Math.max(Math.abs(br.pos[0]), Math.abs(br.pos[2]))); minShed = Math.min(minShed, Math.hypot(br.pos[0] - 9, br.pos[2] - 7))
    if (tasks[tasks.length - 1] !== br.task) tasks.push(br.task)
  } })
  ok('at night it walks up to the tower clearing, sniffs round the shed, and goes back', tasks.join('>').includes('forage>visit>sniff>return'), tasks.join(' > '))
  ok('it never enters the fenced tower base (so never the stairs)', minCheb >= WILD.fence - 0.05, 'closest ' + f2(minCheb) + ' m (Chebyshev) from the tower centre')
  ok('...nor walks through the shed', minShed >= WILD.shedRadius - 0.05, f2(minShed) + ' m from the shed centre')
  ok('you inside the fence: no charge, no swat, no fear', !evs.some((e) => e.type === 'fear' || e.type === 'hurt'))
  ok('the shed line is said once (you can hear it from up there)', typed(evs, 'say').filter((e) => /generator shed/.test(e.text)).length === 1)
  // you're down at the stair foot, inside the fence, when it comes: it sees you, huffs at the fence, and leaves the clearing
  const bf = bearBrain({ seed: 2, tower: [0, 0], shed: [9, 7], shedSpots: [[15, 4], [12, 10], [8.5, 11]], route, bearSpots: [[0, 220], [20, 230]] })
  const cf = makeCtx({ player: [1.5, 0, 1.5], playerSafe: true, night: true }), st = []
  bf.update(DT, cf); bf.bear.visitRoll = true
  const evf = sim(bf, cf, 700, { onStep: () => { if (st[st.length - 1] !== bf.bear.state) st.push(bf.bear.state) } })
  ok('...you at the fence: it rears and huffs at you, never charges, and takes itself off', st.join('>').includes('notice>rear>huff>leave') && !st.includes('bluff') && !evf.some((e) => e.type === 'fear' || e.type === 'hurt') && bf.bear.task !== 'sniff', st.join(' > ') + ', task ' + bf.bear.task)
  // you step out of the fence toward it while it's sniffing: normal rules again
  const b2 = bearBrain({ seed: 2, tower: [0, 0], shed: [9, 7], shedSpots: [[15, 4]], route, bearSpots: [[15, 4]] })
  const ctx2 = makeCtx({ player: [0, 0, 0], playerSafe: true })
  sim(b2, ctx2, 8)
  ctx2.playerSafe = false
  const evs2 = sim(b2, ctx2, 20, { to: [12, 0, 4], speed: 1.2, stopAt: () => b2.bear.state === 'bluff' })
  ok('...step out of the fence toward it and it bluffs like anywhere else', b2.bear.state === 'bluff' && typed(evs2, 'fear').length === 1, b2.bear.state)
  sim(b2, ctx2, 1); ctx2.playerSafe = true
  const evs3 = sim(b2, ctx2, 30, { to: [0, 0, 0], speed: 1.5 })
  let visits = 0
  for (let k = 0; k < 400; k++) { const q = bearBrain({ seed: 100 + k, route }); q.update(DT, makeCtx({ player: [300, 0, 0], night: true })); if (q.bear.visitRoll) visits++ }
  ok('it comes up to the tower on about ' + Math.round(B.visitChance * 100) + ' % of nights', Math.abs(visits / 400 - B.visitChance) < 0.06, f1(visits / 4) + ' % of 400 nights')
  ok('...and back inside the fence it will not follow', !evs3.some((e) => e.type === 'hurt') && Math.max(Math.abs(b2.bear.pos[0]), Math.abs(b2.bear.pos[2])) >= WILD.fence - 0.05, b2.bear.state)
}
// ------------------------------------------------------------------ 14. the dog barks at it every 1-2 s inside 25 m
{
  const b = bearBrain({ seed: 6 }), br = b.bear, ctx = makeCtx({ player: [200, 0, 100], dog: { pos: [30, 0, 100], tamed: true } })
  let evs = sim(b, ctx, 10)
  ok('tamed dog 30 m off: no barking', named(evs, 'dog_bark').length === 0)
  B.dogChargeChance = 0   // (cadence only: no charges here)
  ctx.dog.pos[0] = 20
  evs = sim(b, ctx, 40)
  const barks = named(evs, 'dog_bark'), gaps = barks.slice(1).map((e, i) => e.t - barks[i].t)
  const t0 = evs.length ? barks[0].t - (b.time0 - 40) : Infinity
  ok('inside 25 m: hooks.sfx("dog_bark", dogPos) every 1-2 s', barks.length >= 19 && gaps.every((g) => g >= 1 - 1e-6 && g <= 2 + DT + 1e-6), barks.length + ' barks, gaps ' + f2(Math.min(...gaps)) + '..' + f2(Math.max(...gaps)) + ' s')
  ok('...the first one straight away, from where the dog is', t0 < 0.5 && d2(barks[0].pos, ctx.dog.pos) < 0.01 && barks[0].pos[1] > 0.3, 'after ' + f2(t0) + ' s')
  ctx.dog.tamed = false
  evs = sim(b, ctx, 10)
  ok('the stray (untamed) does not', named(evs, 'dog_bark').length === 0)
  B.dogChargeChance = WILD.bear.dogChargeChance = 0.35
}
// ------------------------------------------------------------------ 15. it may charge the dog; harassing it gets a swat
{
  const b = bearBrain({ seed: 10 }), br = b.bear, ctx = makeCtx({ player: [200, 0, 100], dog: { pos: [8, 0, 100], tamed: true } })
  let charged = false, minD = Infinity
  sim(b, ctx, 40, { onStep: () => { if (br.state === 'dogcharge') { charged = true; minD = Math.min(minD, d2(br.pos, ctx.dog.pos)) } } })
  ok('a barking dog 8 m off: the bear charges her, briefly', charged && minD >= B.dogChaseStop - 1, 'closest ' + f2(minD) + ' m, now ' + br.state)
  // the dog right in its face, closer than you: swats at her (you're 60 m away: no harm to you)
  const b2 = bearBrain({ seed: 10 }), ctx2 = makeCtx({ player: [60, 0, 100], dog: { pos: [3, 0, 100], tamed: true } })
  B.dogChargeChance = 0
  let evs = []
  for (let t = 0; t < 12; t += DT) { const q = b2.bear.pos; ctx2.dog.pos[0] = q[0] + 3; ctx2.dog.pos[2] = q[2]; for (const e of b2.update(DT, ctx2)) evs.push(rec(e, t)) }
  ok('the dog keeps harassing it: it swats at her (dogSwat + a whine), you unhurt', typed(evs, 'dogSwat').length === 1 && named(evs, 'dog_whine').length === 1 && !evs.some((e) => e.type === 'hurt'), typed(evs, 'say').map((e) => e.text).join(' | '))
  // ... and if you're right there too, you get it
  const b3 = bearBrain({ seed: 10 }), ctx3 = makeCtx({ player: [4.5, 0, 100], dog: { pos: [2, 0, 100], tamed: true } })
  evs = []
  let hurtAt3 = null
  for (let t = 0; t < 12; t += DT) {
    const q = b3.bear.pos
    if (b3.bear.state !== 'swat' && b3.bear.state !== 'leave') { ctx3.dog.pos[0] = q[0] + 2; ctx3.dog.pos[2] = q[2]; ctx3.player[0] = q[0] + 4.5; ctx3.player[2] = q[2] }   // (you stand your ground once it lunges)
    for (const e of b3.update(DT, ctx3)) { evs.push(rec(e, t)); if (e.type === 'hurt' && hurtAt3 == null) hurtAt3 = d2(q, ctx3.player) }
  }
  ok('...with you standing right behind her, the swat is yours (the lunge reaches you)', typed(evs, 'hurt').length === 1 && hurtAt3 <= B.swatReach + B.swatMiss, hurtAt3 != null ? 'hit from ' + f2(hurtAt3) + ' m' : 'no hit')
  B.dogChargeChance = 0.35
}
// ------------------------------------------------------------------ 16. the Weeper
{
  const b = bearBrain({ seed: 13 }), br = b.bear, ctx = makeCtx({ player: [300, 0, 100], weeper: [0, 0, 185] })
  sim(b, ctx, 3)
  const was = br.state
  ctx.weeper[2] = 170
  const p0 = br.pos.slice()
  sim(b, ctx, 30, { stopAt: () => br.state === 'flee' })
  sim(b, ctx, 30, { stopAt: () => br.state !== 'flee' })
  ok('the Weeper within 80 m: the bear runs from him', was === 'calm' && d2(br.pos, ctx.weeper) > d2(p0, ctx.weeper) + 45, f1(d2(p0, ctx.weeper)) + ' -> ' + f1(d2(br.pos, ctx.weeper)) + ' m')
}

// ------------------------------------------------------------------ 16b. review regressions: the paw has a reach, walls stop it,
// the dog's harassment falls on the dog while you're safe, a bear that wanders up to a still player doesn't charge
{
  // (a) walk in until it swats, then turn and jog away the instant it lunges: when a hit lands, it lands within reach
  let hits = 0, worst = 0, extra = 0
  for (let seed = 1; seed <= 24; seed++) {
    const b = bearBrain({ seed }), br = b.bear, ctx = makeCtx({ player: [0, 0, 140] })
    sim(b, ctx, 120, { to: [0, 0, 100], speed: 1.5, stopAt: () => br.state === 'swat' })
    if (br.state !== 'swat') continue
    const away = [ctx.player[0] * 3 - br.pos[0] * 2, 0, ctx.player[2] * 3 - br.pos[2] * 2]
    let n = 0
    sim(b, ctx, 3, { to: away, speed: 3.2, jog: true, onStep: () => { for (const e of b._out) if (e.type === 'hurt') { n++; hits++; worst = Math.max(worst, d2(br.pos, ctx.player)) } } })
    extra += Math.max(0, n - 1)
  }
  ok('the swat lands only within the paw\'s reach (even on a player jogging off as it lunges)', hits > 0 && worst <= B.swatReach + B.swatMiss + 1e-6 && extra === 0, hits + ' hits, furthest ' + f2(worst) + ' m (reach ' + B.swatReach + ' + ' + B.swatMiss + ')')
  // (b) the dog in its face with you 4.9 m off, and you jog away the moment it lunges at you: the lunge runs out, a miss
  const bm = bearBrain({ seed: 10 }), cm = makeCtx({ player: [4.9, 0, 100], dog: { pos: [2, 0, 100], tamed: true } })
  const dcc = B.dogChargeChance; B.dogChargeChance = 0
  const evm = []
  let lunged = false
  for (let t = 0; t < 12; t += DT) {
    const q = bm.bear.pos
    if (bm.bear.state === 'swat') lunged = true
    if (!lunged) { cm.dog.pos[0] = q[0] + 2; cm.dog.pos[2] = q[2]; cm.player[0] = q[0] + 4.9; cm.player[2] = q[2]; cm.vel[0] = cm.vel[1] = 0 }
    else { cm.player[0] += 3.2 * DT; cm.vel[0] = 3.2; cm.vel[1] = 0; cm.jog = true }
    for (const e of bm.update(DT, cm)) evm.push(rec(e, t))
  }
  B.dogChargeChance = dcc
  ok('...and a lunge that runs out with you clear is a miss: no hurt, a start (fear), a huff, and it goes', lunged && !typed(evm, 'hurt').length && typed(evm, 'fear').some((e) => Math.abs(e.amount - B.swatMissFear) < 1e-9) && named(evm, 'bear_jawpop').length > 0 && (bm.bear.state === 'leave' || bm.bear.state === 'calm'), 'lunged ' + lunged + ', ' + typed(evm, 'hurt').length + ' hurts, now ' + bm.bear.state)
  // (c) you inside the generator shed (walls 2.4 x 3 m round [9, 7]), the bear nosing about just outside, you pacing inside
  let fear = 0, hurt = 0, attack = 0, huffed = 0
  for (let seed = 1; seed <= 12; seed++) {
    const b = bearBrain({ seed, tower: [0, 0], shed: [9, 7], shedSpots: [[13, 7]], bearSpots: [[60, 60]] }), br = b.bear
    b.place(br, 12.4, 7, -Math.PI / 2); b.bearTask0('sniff'); br.sub = 'nose'; br.subT = 60
    const ctx = makeCtx({ player: [8.3, 0, 7] })
    for (let t = 0; t < 40; t += DT) {
      const x = 9.1 + Math.sin(t * 0.9) * 0.8; ctx.vel[0] = (x - ctx.player[0]) / DT; ctx.vel[1] = 0; ctx.player[0] = x
      for (const e of b.update(DT, ctx)) { if (e.type === 'fear') fear++; if (e.type === 'hurt') hurt++; if (e.type === 'sfx' && e.name === 'bear_woof') huffed++ }
      if (br.state === 'bluff' || br.state === 'swat') attack++
    }
  }
  ok('you inside the shed\'s walls: it huffs at the wall, never charges or swats through it', !fear && !hurt && !attack && huffed > 0, fear + ' fear, ' + hurt + ' hurt, ' + attack + ' charge frames, ' + huffed + ' woofs')
  // (d) the dog harassing it while you stand safe inside the fence: SHE gets the swat, not you, and it doesn't just walk off
  let dogSwats = 0, hurts = 0
  for (let seed = 1; seed <= 8; seed++) {
    const b = bearBrain({ seed, tower: [0, 0], bearSpots: [[12, 0]] }), br = b.bear, dcc2 = B.dogChargeChance
    B.dogChargeChance = 0
    const ctx = makeCtx({ player: [6.5, 0, 0], playerSafe: true, dog: { pos: [9.5, 0, 0], tamed: true } })
    for (let t = 0; t < 20; t += DT) { ctx.dog.pos[0] = br.pos[0] - 2.5; ctx.dog.pos[2] = br.pos[2]; for (const e of b.update(DT, ctx)) { if (e.type === 'hurt') hurts++; if (e.type === 'dogSwat') dogSwats++ } }
    B.dogChargeChance = dcc2
  }
  ok('the dog harassing it while you are safe inside the fence: she gets swatted, you don\'t', dogSwats === 8 && hurts === 0, dogSwats + ' dog swats in 8, ' + hurts + ' hurts')
  // (e) it has had its encounter with you and is ignoring you; its walk takes it right past you, standing still
  let bluffs = 0, closest = Infinity
  const seen = new Set()
  for (let seed = 1; seed <= 10; seed++) {
    const b = makeBrain({ seed, deer: [], bear: true, bearSpots: [[0, 60], [0, -60]] }), br = b.bear, ctx = makeCtx({ player: [0.5, 0, 0] })
    br.ignoreT = 300; b.target(br, 0, -60); br.sub = 'go'; br.task = 'forage'
    const evs = sim(b, ctx, 120, { onStep: () => { closest = Math.min(closest, d2(br.pos, ctx.player)); seen.add(br.state) } })
    bluffs += typed(evs, 'fear').length + typed(evs, 'hurt').length
  }
  ok('a bear that wanders up to you while you stand still huffs and goes (no charge)', bluffs === 0 && seen.has('huff') && seen.has('leave'), 'closest ' + f1(closest) + ' m, ' + [...seen].join(' > '))
  // (f) after an encounter it picks a spot whose walk keeps clear of you (not one straight through you)
  let through = 0, picks = 0
  for (let seed = 1; seed <= 16; seed++) {
    const b = makeBrain({ seed, deer: [], bear: true, bearSpots: [[0, 60], [0, -60], [90, 10]] }), br = b.bear, ctx = makeCtx({ player: [0, 0, 20] })
    sim(b, ctx, 30, { to: [0, 0, 32], speed: 1.2, stopAt: () => br.state === 'huff' })
    sim(b, ctx, 90, { to: [0, 0, 10], speed: 1.0, stopAt: () => br.state === 'calm' && br.ignoreT > 0 })
    if (br.state !== 'calm') continue
    picks++
    const L = Math.hypot(br.tx - br.pos[0], br.tz - br.pos[2]) || 1, t = Math.max(0, Math.min(1, ((ctx.player[0] - br.pos[0]) * (br.tx - br.pos[0]) + (ctx.player[2] - br.pos[2]) * (br.tz - br.pos[2])) / (L * L)))
    const clear = Math.hypot(br.pos[0] + (br.tx - br.pos[0]) * t - ctx.player[0], br.pos[2] + (br.tz - br.pos[2]) * t - ctx.player[2])
    if (clear < B.spotClear - 4) through++
  }
  ok('...and its next spot is one whose walk keeps clear of you', picks >= 8 && through === 0, through + ' of ' + picks + ' walks pass within ' + (B.spotClear - 4) + ' m of you')
}

console.log('— the bear: don\'t run —')
/** The bridge's hurt(): one blow never kills from above half health (health 1 -> dead takes four 0.3 blows). */
const hurtFn = (h, a) => Math.max(h > 0.5 ? 0.05 : 0, h - a)
/** A bear that has noticed you (huffing) ~20-25 m off, by day. */
function noticed(seed) {
  const b = bearBrain({ seed }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
  return { b, br, ctx }
}
// ------------------------------------------------------------------ 24. run from it: it chases you down and mauls you; keep running and it kills you
{
  const { b, br, ctx } = noticed(4)
  const d0 = d2(br.pos, ctx.player)
  let chaseAt = null, topV = 0, health = 1, deadAt = null
  const hits = []
  const evs = sim(b, ctx, 14, { to: [0, 0, 400], speed: 3.2, jog: true, onStep: () => {
    if (chaseAt == null && br.state === 'chase') chaseAt = b.time0
    topV = Math.max(topV, br.speed)
    for (const e of b._out) if (e.type === 'hurt') { hits.push({ t: b.time0, a: e.amount, why: e.why, d: d2(br.pos, ctx.player) }); health = hurtFn(health, e.amount); if (health <= 0 && deadAt == null) deadAt = b.time0 }
  }, stopAt: () => deadAt != null })
  const t0 = evs.length ? evs[0].t - DT : b.time0
  ok('it has noticed you (' + f1(d0) + ' m) and you jog away: it gives chase', d0 < B.chaseRange && chaseAt != null && chaseAt - t0 < 0.6, chaseAt != null ? 'after ' + f2(chaseAt - t0) + ' s' : 'no chase, ' + br.state)
  ok('...at ~11 m/s: you jog at 3.2, you can\'t outrun it', topV > B.chaseSpeed - 0.5, 'top speed ' + f1(topV) + ' m/s')
  ok('...with a bawl, and a jolt (hooks.scare)', named(evs, 'bear_bawl').length >= 1 && typed(evs, 'scare').some((e) => e.why === 'chase' && e.shake >= 0.5 && e.beat))
  ok('it catches you: hooks.hurt(0.3, "bear") — and the DON\'T RUN line', hits.length > 0 && Math.abs(hits[0].a - B.maulHurt) < 1e-9 && hits[0].why === 'bear' && hits[0].t - t0 < 5 && typed(evs, 'say').filter((e) => /DON'T RUN/.test(e.text)).length === 1, hits.length ? 'first blow after ' + f1(hits[0].t - t0) + ' s at ' + f2(hits[0].d) + ' m' : 'never caught')
  const gaps = hits.slice(1).map((h, i) => h.t - hits[i].t)
  ok('keep running: another blow every ~1.2 s', gaps.length >= 2 && gaps.every((g) => Math.abs(g - B.maulEvery) < 0.1) && hits.every((h) => h.d <= B.maulReach + 1e-6), gaps.map(f2).join(' / ') + ' s, within ' + f2(Math.max(...hits.map((h) => h.d))) + ' m')
  ok('...a player who keeps running dies (bridge.hurt: no one-blow kill above half health)', deadAt != null && hits.length === 4, deadAt != null ? 'dead ' + f1(deadAt - t0) + ' s after you ran, ' + hits.length + ' blows' : 'health ' + f2(health))
  ok('...all the while: sustained fear at full (brain.fearLevel)', b.fearLevel === 1, 'fearLevel ' + f2(b.fearLevel))
}
// ------------------------------------------------------------------ 25. it's on you: stand still and it stops; it stands over you, then goes
{
  for (const [how, to, speed] of [['stand still', null, 0], ['back off slowly', 'away', 0.8]]) {
    const { b, br, ctx } = noticed(4)
    sim(b, ctx, 10, { to: [0, 0, 400], speed: 3.2, jog: true, stopAt: () => typed(b._out, 'hurt').length > 0 })
    const tStop = b.time0
    let loomAt = null, leaveAt = null, maxD = 0
    const dest = to ? [ctx.player[0], 0, ctx.player[2] + 100] : null
    const evs = sim(b, ctx, 40, { to: dest, speed, onStep: () => { if (loomAt == null && br.state === 'loom') loomAt = b.time0; if (leaveAt == null && br.state === 'leave') leaveAt = b.time0; if (leaveAt != null) maxD = Math.max(maxD, d2(br.pos, ctx.player)) } })
    ok(`it's on you and you ${how}: no more blows`, !typed(evs, 'hurt').length, typed(evs, 'hurt').length + ' more')
    ok(`...after ~1.5 s it stops, and stands over you (loom), breathing`, loomAt != null && Math.abs(loomAt - tStop - B.maulCalm) < 0.2 && named(evs, 'bear_breath').length > 0, loomAt != null ? 'loom after ' + f2(loomAt - tStop) + ' s' : br.state)
    ok(`...then it leaves you`, leaveAt != null && leaveAt - loomAt < B.loom[1] + 0.2 && maxD > 20 && br.ignoreT > 0, leaveAt != null ? 'left after ' + f1(leaveAt - loomAt) + ' s, ' + f1(maxD) + ' m off' : br.state)
  }
  // it's looming over you and you bolt: it's straight back on you
  const { b, br, ctx } = noticed(4)
  sim(b, ctx, 10, { to: [0, 0, 400], speed: 3.2, jog: true, stopAt: () => typed(b._out, 'hurt').length > 0 })
  sim(b, ctx, 3, { stopAt: () => br.state === 'loom' })
  const evs = sim(b, ctx, 3, { to: [0, 0, 400], speed: 3.2, jog: true, stopAt: () => typed(b._out, 'hurt').length > 0 })
  ok('...unless you run again while it stands over you: it\'s on you again', typed(evs, 'hurt').length === 1, br.state)
}
// ------------------------------------------------------------------ 26. stop running before it reaches you: it ends as a bluff
{
  const { b, br, ctx } = noticed(9)
  sim(b, ctx, 3, { to: [0, 0, 400], speed: 3.2, jog: true, stopAt: () => br.state === 'chase' })
  sim(b, ctx, 0.3, { to: [0, 0, 400], speed: 3.2, jog: true })
  const dStop = d2(br.pos, ctx.player)
  let minD = Infinity, reared = false
  const evs = sim(b, ctx, 20, { onStep: () => { minD = Math.min(minD, d2(br.pos, ctx.player)); if (br.act === 'rear') reared = true } })
  ok('it\'s coming (' + f1(dStop) + ' m) and you stop and stand your ground: it pulls up short — no blow', !typed(evs, 'hurt').length && minD > B.bluffStop - 0.5 && reared && named(evs, 'bear_growl').length >= 1, 'closest ' + f2(minD) + ' m, reared ' + reared)
  ok('...and, as you keep still, it leaves', br.state === 'leave' || br.state === 'calm', br.state)
}
// ------------------------------------------------------------------ 27. jogging is only dangerous near a bear that has noticed you
{
  const b = bearBrain({ seed: 3 }), br = b.bear, ctx = makeCtx({ player: [-60, 0, 30] })
  const evs = sim(b, ctx, 50, { to: [-60, 0, 170], speed: 3.2, jog: true })
  ok('jogging past 60 m off: it doesn\'t care', !['chase', 'maul'].includes(br.state) && !typed(evs, 'hurt').length && !named(evs, 'bear_bawl').length, br.state)
  const n = noticed(8)
  sim(n.b, n.ctx, 60, { to: [0, 0, 220], speed: 1.2, stopAt: () => n.br.state === 'leave' })
  const evs2 = sim(n.b, n.ctx, 20, { to: [0, 0, 400], speed: 3.2, jog: true })
  ok('...nor once it has turned to leave (you backed off first)', !typed(evs2, 'hurt').length && n.br.state !== 'chase', n.br.state)
}

console.log('— the bear: night stalking —')
// a straight trail north from the tower (0, 0); the bear forages off to the side
const stalkBrain = (seed, o = {}) => bearBrain({ seed, tower: [0, 0], bearSpots: [[80, 160]], ...o })
/** Night, you walking the trail; the stalk made certain (it happens on ~80 % of nights). Returns once it's stalking. */
function stalked(seed, o = {}) {
  const b = stalkBrain(seed, o), br = b.bear, ctx = makeCtx({ player: [0, 0, 60], night: true, ...(o.ctx || {}) })
  b.update(DT, ctx); br.stalkRoll = true
  const evs = sim(b, ctx, 150, { to: [0, 0, 460], speed: 1.4, stopAt: () => br.state === 'stalk' })
  return { b, br, ctx, evs }
}
const offLook = (br, ctx) => Math.abs(((Math.atan2(br.pos[0] - ctx.player[0], br.pos[2] - ctx.player[2]) - Math.atan2(ctx.look[0], ctx.look[1]) + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
// ------------------------------------------------------------------ 28. it catches your scent and keeps pace with you, heard not seen
{
  const { b, br, ctx, evs: e0 } = stalked(7)
  const t0 = e0.length ? e0[0].t : 0
  ok('night, you on the trail well away from the tower: it catches your scent and stalks you', br.state === 'stalk' && br.sk === 'follow', br.state + ' after ' + f1(b.time0 - t0) + ' s, ' + f1(d2(br.pos, ctx.player)) + ' m off')
  const b0 = br.pos.slice(), ds = [], breaths = [], snaps = []
  let rushV = 0, holdD = Infinity, sawRush = false, sawHold = false, fearF = 0, fearH = 0, heardAt = null
  const evs = sim(b, ctx, 120, { to: [0, 0, 460], speed: 1.4, onStep: (t) => {
    if (br.heard && heardAt == null) heardAt = t
    if (t > 30 && br.sk === 'follow' && br.skT > 8) ds.push(d2(br.pos, ctx.player))
    if (br.sk === 'rush') { sawRush = true; rushV = Math.max(rushV, br.speed) }
    if (br.sk === 'hold') { sawHold = true; holdD = Math.min(holdD, d2(br.pos, ctx.player)); fearH = Math.max(fearH, b.fearLevel) }
    if (br.sk === 'follow' && br.heard) fearF = Math.max(fearF, b.fearLevel)
    for (const e of b._out) if (e.type === 'sfx') { if (e.name === 'bear_breath') breaths.push(d2(e.pos, ctx.player)); if (e.name === 'branch_snap') snaps.push(d2(e.pos, ctx.player)) }
  } })
  ds.sort((a, c) => a - c)
  const inBand = ds.filter((d) => d >= B.stalkDist[0] - 3 && d <= B.stalkDist[1] + 5).length / (ds.length || 1)
  ok('it keeps pace ~25-42 m off as you walk', br.state === 'stalk' && inBand > 0.85 && d2(br.pos, b0) > 100, 'median ' + f1(ds[ds.length >> 1]) + ' m, ' + Math.round(inBand * 100) + ' % in the band; it moved ' + f1(d2(br.pos, b0)) + ' m')
  ok('you hear it: branch snaps off the trail (hooks.sfx "branch_snap")', snaps.length >= 5 && snaps.every((d) => d > 5), snaps.length + ' snaps, ' + snaps.map(f1).slice(0, 6).join(' ') + ' m')
  ok('...the first one brings the line (once) and the don\'t-run tip', typed(evs, 'say').filter((e) => /keeping pace/.test(e.text)).length === 1 && typed(evs, 'toast').filter((e) => /Don't run/.test(e.text)).length === 1)
  ok('...and its heavy breathing, but only when it\'s within ~15 m', breaths.length > 0 && breaths.every((d) => d < B.breathRange + 1.5), breaths.length + ' breaths at ' + breaths.map(f1).join(' ') + ' m')
  ok('now and then it rushes in (hooks.scare) ...', sawRush && rushV > B.rushSpeed - 0.5 && typed(evs, 'scare').some((e) => e.why === 'rush' && e.beat), 'top speed ' + f1(rushV) + ' m/s')
  ok('...and stops, ~10 m off, blowing at you', sawHold && holdD > 5 && holdD < B.rushStop[1] + 0.5 && !typed(evs, 'hurt').length, 'closest ' + f1(holdD) + ' m')
  ok('sustained fear once you\'ve heard it: some while it follows, more when it rushes you', fearF > 0.1 && fearF < 0.6 && fearH > fearF, 'follow ' + f2(fearF) + ', hold ' + f2(fearH))
}
// ------------------------------------------------------------------ 29. out of the light
{
  const { b, br, ctx } = stalked(8)
  br.rushT = 1e9   // (no rushes here: they come at you on purpose)
  sim(b, ctx, 40, { to: [0, 0, 460], speed: 1.4 })
  ctx.torch = true; ctx.look = [0, 1]
  let inCone = 0, n = 0
  sim(b, ctx, 60, { to: [0, 0, 460], speed: 1.4, onStep: () => { if (br.sk !== 'follow') return; n++; if (offLook(br, ctx) < 0.35 && d2(br.pos, ctx.player) < 45) inCone++ } })
  ok('torch on, pointed down the trail: it keeps out of the beam', n > 1000 && inCone / n < 0.02, inCone + ' of ' + n + ' frames in the 20 deg cone')
  // you swing round and put the torch straight on it: it slips out of the cone
  const L = d2(br.pos, ctx.player); ctx.look = [(br.pos[0] - ctx.player[0]) / L, (br.pos[2] - ctx.player[2]) / L]
  let out = null
  sim(b, ctx, 8, { onStep: (t) => { if (out == null && offLook(br, ctx) > 0.35) out = t } })
  ok('...swing the torch onto it and it slips out of the beam in a couple of seconds', out != null && out < 3, out != null ? f2(out) + ' s, ' + f1(L) + ' m off' : 'still in the beam')
}
// ------------------------------------------------------------------ 30. a light held on it drives it back; it comes back later
{
  const { b, br, ctx } = stalked(9)
  br.rushT = 1e9
  sim(b, ctx, 30, { to: [0, 0, 460], speed: 1.4 })
  sim(b, ctx, 5)
  ctx.lit = true; sim(b, ctx, 2.0)
  const early = br.sk
  ctx.lit = false; sim(b, ctx, 4)
  ctx.lit = true
  let backAt = null
  const tl = b.time0
  sim(b, ctx, 4, { stopAt: () => { if (br.sk === 'back') backAt = b.time0 - tl; return backAt != null } })
  ctx.lit = false
  ok('a light on it for 2 s: nothing; held 2.5 s: it backs off', early !== 'back' && backAt != null && Math.abs(backAt - B.litBack) < 0.1, 'after ' + f2(backAt) + ' s')
  let far = 0, waited = false, back = null
  const tb = b.time0
  sim(b, ctx, 90, { onStep: () => { far = Math.max(far, d2(br.pos, ctx.player)); if (br.sk === 'wait') waited = true; if (waited && back == null && br.sk === 'follow') back = b.time0 - tb } })
  ok('...out past 40 m, where it waits in the dark', far >= 40 && waited, 'as far as ' + f1(far) + ' m')
  ok('...and later it comes back', back != null && br.state === 'stalk' && d2(br.pos, ctx.player) < B.stalkDist[1] + 5, back != null ? 'after ' + f1(back) + ' s, now ' + f1(d2(br.pos, ctx.player)) + ' m off' : br.state + ' ' + br.sk)
}
// ------------------------------------------------------------------ 31. it gives up: home, dawn, or after a while
{
  const s1 = stalked(10)
  s1.br.rushT = 1e9
  let ended = null, minCheb = Infinity
  sim(s1.b, s1.ctx, 200, { to: [0, 0, 0], speed: 1.4, onStep: () => { const p = s1.ctx.player; if (ended == null && s1.br.state !== 'stalk') ended = Math.hypot(p[0], p[2]); minCheb = Math.min(minCheb, Math.max(Math.abs(s1.br.pos[0]), Math.abs(s1.br.pos[2]))) }, stopAt: () => Math.hypot(s1.ctx.player[0], s1.ctx.player[2]) < 12 })
  ok('you reach the tower clearing: it gives up and goes', ended != null && ended <= B.stalkHome + 0.1 && ended > B.stalkHome - 3 && s1.br.state === 'leave' && minCheb >= WILD.fence - 0.05, 'at ' + f1(ended) + ' m from the tower, ' + s1.br.state)
  let again = false
  sim(s1.b, s1.ctx, 200, { to: [0, 0, 80], speed: 1.4, onStep: () => { if (s1.br.state === 'stalk') again = true } })
  ok('...and doesn\'t take it up again for a good while', !again && s1.br.stalkCool > 0, 'cooldown left ' + f1(s1.br.stalkCool) + ' s')
  const s2 = stalked(11)
  sim(s2.b, s2.ctx, 10, { to: [0, 0, 460], speed: 1.4 })
  s2.ctx.night = false
  sim(s2.b, s2.ctx, 1)
  ok('dawn: it gives up the stalk', s2.br.state === 'leave', s2.br.state)
  const s3 = stalked(12)
  s3.br.rushT = 1e9
  let len = null, leg = 0
  const ts = s3.b.time0
  while (len == null && s3.b.time0 - ts < 300) sim(s3.b, s3.ctx, 90, { to: [0, 0, leg++ % 2 ? 120 : 420], speed: 1.2, stopAt: () => { if (s3.br.state !== 'stalk') len = s3.b.time0 - ts; return len != null } })
  ok('...or after a few minutes of it', len != null && len >= B.stalkMax[0] - 1 && len <= B.stalkMax[1] + 1 && s3.br.state === 'leave', len != null ? f1(len) + ' s' : s3.br.state)
}
// ------------------------------------------------------------------ 32. when it doesn't
{
  const none = (name, o, walk = [0, 0, 460], from = [0, 0, 60]) => {
    const b = stalkBrain(13, o), br = b.bear, ctx = makeCtx({ player: from.slice(), night: true, ...(o.ctx || {}) })
    b.update(DT, ctx); if (!o.noForce) br.stalkRoll = true
    let st = false
    sim(b, ctx, 200, { to: walk, speed: 1.4, onStep: () => { if (br.state === 'stalk') st = true } })
    ok(name, !st, br.state)
  }
  none('no stalking by day', { ctx: { night: false } })
  none('...nor off the trail (it follows the trail you walk)', { ctx: { offTrail: 30 } })
  none('...nor round the tower clearing', { bearSpots: [[45, 45]] }, [30, 0, 5], [0, 0, 30])
  none('...nor from up the tower (safe)', { ctx: { playerSafe: true } })
  let n = 0
  for (let k = 0; k < 400; k++) { const q = stalkBrain(200 + k); q.update(DT, makeCtx({ player: [0, 0, 300], night: true })); if (q.bear.stalkRoll) n++ }
  ok('it hunts on about ' + Math.round(B.stalkChance * 100) + ' % of nights', Math.abs(n / 400 - B.stalkChance) < 0.06, f1(n / 4) + ' % of 400 nights')
}
// ------------------------------------------------------------------ 33. run from a stalker; the dog knows
{
  const { b, br, ctx } = stalked(14)
  br.rushT = 1e9; br.snapT = 10   // (no snap for a few seconds: you haven't heard it yet)
  const e1 = sim(b, ctx, 3, { to: [0, 0, 460], speed: 3.2, jog: true })
  ok('it stalks you and you haven\'t heard it yet: jogging on doesn\'t set it off', !br.heard && br.state === 'stalk' && !typed(e1, 'hurt').length, br.state + ', heard ' + br.heard)
  sim(b, ctx, 60, { to: [0, 0, 460], speed: 1.4, stopAt: () => br.heard })
  sim(b, ctx, 8, { to: [0, 0, 460], speed: 1.4 })
  const d0 = d2(br.pos, ctx.player)
  const away = [ctx.player[0] * 2 - br.pos[0], 0, ctx.player[2] * 2 - br.pos[2]]
  let chased = false
  const e2 = sim(b, ctx, 12, { to: away, speed: 3.2, jog: true, onStep: () => { if (br.state === 'chase') chased = true }, stopAt: () => typed(b._out, 'hurt').length > 0 })
  ok('...once you know it\'s there, run and it runs you down (' + f1(d0) + ' m back)', chased && typed(e2, 'hurt').length === 1, br.state)
  // the tamed dog at your heel whimpers while it stalks you
  const s = stalked(15, { ctx: { dog: { pos: [1, 0, 60], tamed: true } } })
  s.br.rushT = 1e9
  const w = []
  sim(s.b, s.ctx, 90, { to: [0, 0, 460], speed: 1.4, onStep: () => { for (const e of s.b._out) if (e.type === 'dogWhine') w.push(d2(e.pos, s.ctx.dog.pos)); const p = s.ctx.player; s.ctx.dog.pos[0] = p[0] + 1; s.ctx.dog.pos[2] = p[2] - 1 } })
  ok('the tamed dog at your heel whimpers while it stalks you (dogWhine at her)', w.length >= 4 && w.every((d) => d < 0.01), w.length + ' whimpers')
}
// ------------------------------------------------------------------ 34. eyeshine
{
  const E = [0, 1, 0], L = [0, 1.6, 12]
  ok('eyeshine(): only at night, only while lit', eyeshine(false, true, 0, E, L) === 0 && eyeshine(true, false, 0, E, L) === 0 && eyeshine(true, true, 0, E, L) > 0.99)
  ok('...and only while it faces the light', eyeshine(true, true, 0.5, E, L) > 0.9 && eyeshine(true, true, Math.PI / 2, E, L) === 0 && eyeshine(true, true, Math.PI, E, L) === 0 && eyeshine(true, true, 1.0, E, L) > 0 && eyeshine(true, true, 1.0, E, L) < 0.7,
    [0, 0.5, 1, Math.PI / 2].map((y) => f2(eyeshine(true, true, y, E, L))).join(' '))
  ok('...the searchlight from high on the tower lights them too, if less', eyeshine(true, true, 0, E, [0, 31, 20]) > 0.3, f2(eyeshine(true, true, 0, E, [0, 31, 20])))
  const b = bearBrain({ seed: 16 }), br = b.bear, ctx = makeCtx({ player: [0, 0, 70] })
  b.place(br, 0, 100, Math.PI); br.sub = 'nose'; br.subT = 60   // 30 m off, facing you
  const run = (secs, o) => { Object.assign(ctx, o); let m = 0; const evs = sim(b, ctx, secs, { onStep: () => { m = Math.max(m, br.eyes) } }); return { m, evs } }
  const day = run(1, { night: false, lit: true }), dark = run(1, { night: true, lit: false })
  br.stalkRoll = false   // (tonight it doesn't hunt: this is about its eyes)
  const seen = run(1, { lit: true })
  ok('the bear: no eyeshine by day, or unlit at night', day.m === 0 && dark.m === 0)
  ok('...lit at night, facing the light: two eyes shine back (bear.eyes)', seen.m > 0.9, 'eyes ' + f2(seen.m))
  ok('...the first time: a jolt (hooks.scare, heartbeat) and the line', typed(seen.evs, 'scare').filter((e) => e.why === 'eyes' && e.beat).length === 1 && typed(seen.evs, 'say').filter((e) => /Two eyes/.test(e.text)).length === 1)
  run(1, { lit: false })
  const again = run(1, { lit: true })
  ok('...a second look straight after: no jolt', !typed(again.evs, 'scare').length && again.m > 0.9)
  run(8, { lit: false })
  const later = run(1, { lit: true })
  ok('...later, a new sighting is a new jolt — but the line is said once', typed(later.evs, 'scare').length === 1 && !typed(later.evs, 'say').length)
  run(1, { lit: false }); br.yaw = 0
  const away = run(1, { lit: true })
  ok('...turned away from you: nothing', away.m === 0)
  br.yaw = Math.PI
  const held = run(3, { lit: true })
  ok('a light held on it (not stalking) 2.5 s at night: it huffs and takes itself off', br.state === 'calm' && br.ignoreT > 0 && named(held.evs, 'bear_huff').length > 0 && br.sub === 'go', br.state + ' ' + br.sub + ', ignoring you ' + f1(br.ignoreT) + ' s')
}
// ------------------------------------------------------------------ 35. bigger, and saves
{
  const b = bearBrain(), br = b.bear
  ok('a big boar: the bear is drawn (and heard) at ' + B.scale + 'x', br.scale === B.scale && B.scale >= 1.2)
  const { b: sb } = stalked(17)
  const j = JSON.parse(JSON.stringify(sb.toJSON()))
  const r = bearBrain({ seed: 17, tower: [0, 0], bearSpots: [[80, 160]], saved: j })
  ok('saved mid-stalk: restored calm, with a moment\'s grace (and its night roll)', j.bear.state === 'stalk' && r.bear.state === 'calm' && r.bear.ignoreT >= B.restoreGrace - 1e-9 && r.bear.stalkRoll === true, j.bear.state + ' -> ' + r.bear.state)
}

console.log('— the bear: review regressions —')
/** sim() at another frame rate (a slow machine, or one long frame) */
function simDt(b, ctx, secs, dt, { to = null, speed = 0, jog = false, onStep = null, stopAt = null } = {}) {
  const evs = []
  for (let t = 0; t < secs; t += dt) {
    const p = ctx.player
    if (to) { const dx = to[0] - p[0], dz = to[2] - p[2], L = Math.hypot(dx, dz); if (L > 1e-3) { const s = Math.min(L, speed * dt); p[0] += dx / L * s; p[2] += dz / L * s; ctx.vel[0] = dx / L * speed; ctx.vel[1] = dz / L * speed } else ctx.vel[0] = ctx.vel[1] = 0 } else ctx.vel[0] = ctx.vel[1] = 0
    ctx.jog = jog
    for (const e of b.update(dt, ctx)) evs.push(rec(e, t))
    if (onStep) onStep(t)
    if (stopAt && stopAt()) break
  }
  ctx.vel[0] = ctx.vel[1] = 0
  return evs
}
// ------------------------------------------------------------------ 36. a bluff on a still player never becomes a swat, at any frame rate
{
  let runs = 0, hurts = 0, minD = Infinity
  for (const fps of [60, 20, 15, 12, 10]) for (let seed = 1; seed <= 12; seed++) {
    const b = bearBrain({ seed }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
    simDt(b, ctx, 60, 1 / fps, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
    simDt(b, ctx, 20, 1 / fps, { to: [br.pos[0], 0, br.pos[2]], speed: 1.0, stopAt: () => br.state === 'bluff' })
    if (br.state !== 'bluff') continue
    runs++
    const evs = simDt(b, ctx, 20, 1 / fps, { onStep: () => { minD = Math.min(minD, d2(br.pos, ctx.player)) } })
    hurts += typed(evs, 'hurt').length
  }
  // and one long frame (a 0.1 s hitch) just as it arrives
  for (let seed = 1; seed <= 12; seed++) {
    const b = bearBrain({ seed }), br = b.bear, ctx = makeCtx({ player: [0, 0, 150] })
    sim(b, ctx, 60, { to: [0, 0, 100], speed: 1.4, stopAt: () => br.state === 'huff' })
    sim(b, ctx, 20, { to: [br.pos[0], 0, br.pos[2]], speed: 1.0, stopAt: () => br.state === 'bluff' })
    if (br.state !== 'bluff') continue
    runs++
    sim(b, ctx, 5, { stopAt: () => br.state !== 'bluff' || d2(br.pos, ctx.player) < B.bluffStop + 0.6 })
    const evs = simDt(b, ctx, 0.1, 0.1).concat(sim(b, ctx, 20, { onStep: () => { minD = Math.min(minD, d2(br.pos, ctx.player)) } }))
    hurts += typed(evs, 'hurt').length
  }
  ok('a bluff on a player standing still stops ~2 m short and never swats — at 10-60 fps, or through a long frame', runs >= 60 && hurts === 0 && minD > B.swatHard + 0.3, runs + ' bluffs, ' + hurts + ' hurts, closest ' + f2(minD) + ' m')
}
// ------------------------------------------------------------------ 37. it's on you, and you get somewhere it can't follow: it lets you go
{
  const b = bearBrain({ seed: 5, ground: bank, bearSpots: [[20, 100]] }), br = b.bear, ctx = makeCtx({ player: [58, 0, 100] })
  b.place(br, 55.5, 100, Math.PI / 2); b.bearEnter('chase')
  sim(b, ctx, 1, { to: [59, 0, 100], speed: 3.2, jog: true, stopAt: () => br.state === 'maul' })
  const was = br.state
  let farT = 0, gone = null
  const evs = sim(b, ctx, 30, { to: [140, 0, 100], speed: 3.2, jog: true, onStep: (t) => { if (br.state === 'maul' && d2(br.pos, ctx.player) > B.maulReach + B.maulLose) farT += DT; if (gone == null && br.state === 'leave') gone = t } })
  ok('mauled, you get up a bank it can\'t climb and keep going: it lets you go (no maul from any distance)', was === 'maul' && gone != null && farT < B.maulLost + 0.3 && br.pos[0] < 61 && typed(evs, 'hurt').length <= 1, was + ' -> ' + br.state + (gone != null ? ' after ' + f1(gone) + ' s' : '') + ', ' + f1(farT) + ' s out of reach in maul')
}
// ------------------------------------------------------------------ 38. already jogging when you first hear the stalker: a moment to stop
{
  let fair = 0, chased = 0, runs = 0
  for (let seed = 30; seed < 42; seed++) {
    const { b, br, ctx } = stalked(seed)
    if (br.state !== 'stalk') continue
    runs++
    let heardAt = null, chaseAt = null
    sim(b, ctx, 40, { to: [0, 0, 900], speed: 3.2, jog: true, onStep: (t) => { if (heardAt == null && br.heard) heardAt = t; if (chaseAt == null && br.state === 'chase') chaseAt = t }, stopAt: () => chaseAt != null })
    if (chaseAt != null) { chased++; if (chaseAt - heardAt >= B.heardGrace - 0.05) fair++ }
  }
  ok('jogging on the trail when the first stick breaks: ' + B.heardGrace + ' s to take it in and stop; jog on after that and it runs you down', runs >= 8 && chased === runs && fair === runs, fair + ' of ' + chased + ' charges came ' + B.heardGrace + '+ s after you first heard it (' + runs + ' stalks)')
}
// ------------------------------------------------------------------ 39. a slow jog (hungry, limping: ~1.9 m/s) is still running
{
  const { b, br, ctx } = noticed(4)
  let chased = false
  sim(b, ctx, 4, { to: [0, 0, 400], speed: 1.9, jog: true, onStep: () => { if (br.state === 'chase') chased = true }, stopAt: () => chased })
  const n = noticed(4)
  let chased2 = false
  sim(n.b, n.ctx, 6, { to: [0, 0, 400], speed: 1.4, onStep: () => { if (n.br.state === 'chase') chased2 = true } })
  ok('a limping jog away (1.9 m/s, the jog key down) still sets it after you; a walk away (1.4 m/s) does not', chased && !chased2, 'jog ' + chased + ', walk ' + chased2)
}
// ------------------------------------------------------------------ 40. its eyes in your torch as it charges you: no second jolt, no "then they're gone"
{
  const { b, br, ctx } = noticed(4)
  ctx.night = true
  sim(b, ctx, 3, { to: [0, 0, 400], speed: 3.2, jog: true, stopAt: () => br.state === 'chase' })
  ctx.lit = true
  let eyes = 0
  const evs = sim(b, ctx, 8, { to: [0, 0, 400], speed: 3.2, jog: true, onStep: () => { eyes = Math.max(eyes, br.eyes) }, stopAt: () => typed(b._out, 'hurt').length > 0 })
  ok('lit at night as it charges you: its eyes shine (bear.eyes) but the eyes jolt and line wait (the charge has its own)', eyes > 0.9 && typed(evs, 'hurt').length === 1 && !typed(evs, 'scare').some((e) => e.why === 'eyes') && !typed(evs, 'say').some((e) => /Two eyes/.test(e.text)), 'eyes ' + f2(eyes) + '; jolts: ' + typed(evs, 'scare').map((e) => e.why).join(' '))
}

// ------------------------------------------------------------------ 41. run for the tower or the shed: it never comes in after you
{
  let runs = 0, minCheb = Infinity, hurtsSafe = 0, climbed = 0, shedRuns = 0, shedHurt = 0, minShed = Infinity, chases = 0, shedChases = 0
  for (let seed = 1; seed <= 12; seed++) {
    // you're just out of the clearing, between it and the tower; it notices you, and you make a run for the stairs
    const b = bearBrain({ seed, tower: [0, 0], bearSpots: [[(seed % 3 - 1) * 8, 39]] }), br = b.bear, ctx = makeCtx({ player: [0, 0, 17] })
    sim(b, ctx, 60, { to: [0, 0, 26], speed: 1.2, stopAt: () => br.state === 'rear' })
    if (br.state !== 'huff' && br.state !== 'rear') continue
    runs++
    let chased = false
    sim(b, ctx, 30, { to: [0, 0, 5], speed: 3.2, jog: true, onStep: () => {
      const p = ctx.player; ctx.playerSafe = Math.abs(p[0]) < 7.5 && Math.abs(p[2]) < 7.5
      if (ctx.playerSafe) hurtsSafe += typed(b._out, 'hurt').length
      minCheb = Math.min(minCheb, Math.max(Math.abs(br.pos[0]), Math.abs(br.pos[2]))); if (br.pos[1] !== 0) climbed++
      if (br.state === 'chase' && !chased) { chased = true; chases++ }
    } })
    ctx.playerSafe = false
  }
  for (let seed = 1; seed <= 8; seed++) {
    const b = bearBrain({ seed, tower: [0, 0], shed: [9, 7], shedSpots: [[20, 4]], bearSpots: [[9, 40]] }), br = b.bear, ctx = makeCtx({ player: [9, 0, 25] })
    sim(b, ctx, 30, { stopAt: () => br.state !== 'calm' })
    sim(b, ctx, 20, { to: [9, 0, 30], speed: 1.2, stopAt: () => br.state === 'huff' || br.state === 'rear' })
    if (!['huff', 'rear', 'notice'].includes(br.state)) continue
    shedRuns++
    let chased = false
    sim(b, ctx, 20, { to: [9, 0, 7], speed: 3.2, jog: true, onStep: () => { if (br.state === 'chase' && !chased) { chased = true; shedChases++ } minShed = Math.min(minShed, Math.hypot(br.pos[0] - 9, br.pos[2] - 7)); if (Math.hypot(ctx.player[0] - 9, ctx.player[2] - 7) < WILD.shedShelter) shedHurt += typed(b._out, 'hurt').length } })
  }
  ok('run for the tower: it chases you to the fence and no further — never inside, never on the stairs, no blow once you\'re there', runs >= 8 && chases >= runs / 2 && minCheb >= WILD.fence - 1e-6 && !hurtsSafe && !climbed, chases + ' chases in ' + runs + ' runs, closest ' + f2(minCheb) + ' m from the tower\'s centre (fence ' + WILD.fence + ')')
  ok('...or for the generator shed: no blow through its walls', shedRuns >= 4 && shedChases >= shedRuns / 2 && !shedHurt && minShed >= WILD.shedRadius - 1e-6, shedChases + ' chases in ' + shedRuns + ' runs, closest ' + f2(minShed) + ' m from the shed\'s centre')
}

console.log('— ambient —')
const ambBrain = (seed) => makeBrain({ deer: [], bear: false, seed })
function ambRun(b, ctx, secs) { return sim(b, ctx, secs).filter((e) => e.type === 'sfx') }
// ------------------------------------------------------------------ 17. by day
{
  const b = ambBrain(31), ctx = makeCtx({ player: [0, 0, 0] })
  const evs = ambRun(b, ctx, 1200)
  const day = new Set(WILD.ambient.day.species.map((s) => s.name)), names = new Set(evs.map((e) => e.name))
  const dist = evs.map((e) => Math.hypot(e.pos[0], e.pos[2]))
  const bouts = []; for (const e of evs) if (!bouts.length || e.t - bouts[bouts.length - 1].end > 3.5) bouts.push({ start: e.t, end: e.t }); else bouts[bouts.length - 1].end = e.t
  const gaps = bouts.slice(1).map((q, i) => q.start - bouts[i].end)
  ok('by day: jay, raven, thrush, chickadee and woodpecker, nothing else', [...day].every((n) => names.has(n)) && [...names].every((n) => day.has(n)), [...names].join(' '))
  ok('a few calls every 10-30 s', evs.length / 20 > 2 && evs.length / 20 < 9, f1(evs.length / 20) + ' calls a minute, ' + bouts.length + ' bouts')
  ok('...with quiet gaps', Math.max(...gaps) > 30 && gaps.filter((g) => g > 9).length > bouts.length * 0.6, 'longest silence ' + f1(Math.max(...gaps)) + ' s')
  ok('positional, 20-90 m around you, up in the trees', dist.every((d) => d > 17 && d < 93) && evs.every((e) => e.pos[1] >= 1.5), f1(Math.min(...dist)) + '..' + f1(Math.max(...dist)) + ' m')
}
// ------------------------------------------------------------------ 18. by night
{
  const b = ambBrain(32), ctx = makeCtx({ player: [0, 0, 0], night: true })
  const evs = ambRun(b, ctx, 1800)
  const c = {}; for (const e of evs) c[e.name] = (c[e.name] || 0) + 1
  const coy = evs.filter((e) => e.name === 'coyote'), cg = coy.slice(1).map((e, i) => e.t - coy[i].t)
  ok('by night: owl, coyote, elk_bugle only', Object.keys(c).every((n) => ['owl', 'coyote', 'elk_bugle'].includes(n)), JSON.stringify(c))
  ok('the owl often, coyotes sometimes (and far off), the elk rarely', c.owl > (c.coyote || 0) * 2 && (c.coyote || 0) >= 2 && (c.elk_bugle || 0) <= 6 && coy.every((e) => Math.hypot(e.pos[0], e.pos[2]) > 70), JSON.stringify(c))
  ok('...coyotes no more than once every 90 s', cg.every((g) => g >= 90 - 1e-6), cg.length ? 'min gap ' + f1(Math.min(...cg)) + ' s' : '')
}
// ------------------------------------------------------------------ 19. silent near the Weeper
{
  const b = ambBrain(33), ctx = makeCtx({ player: [0, 0, 0], weeper: [100, 0, 0] })
  let evs = ambRun(b, ctx, 300)
  ok('the Weeper within 120 m: not one call in 5 minutes', evs.length === 0 && b.amb.silent)
  ctx.weeper = null; ctx.weeperTriggered = true
  evs = ambRun(b, ctx, 300)
  ok('...nor while he is coming for you (triggered), wherever he is', evs.length === 0)
  ctx.weeperTriggered = false; ctx.weeper = [150, 0, 0]
  let first = null
  const t0 = b.time0
  evs = ambRun(b, ctx, 400)
  first = evs.length ? evs[0].t - t0 : null
  ok('he goes (150 m): the birds come back, but only after a long hush', first != null && first >= WILD.ambient.resume[0] - 0.1 && evs.length > 5, 'first call after ' + f1(first) + ' s, ' + evs.length + ' calls')
  const night = ambBrain(34), nctx = makeCtx({ player: [0, 0, 0], night: true, weeper: [60, 0, 60] })
  ok('the owls and coyotes hush for him too', ambRun(night, nctx, 300).length === 0)
}
// ------------------------------------------------------------------ 20. rain
{
  const dry = ambRun(ambBrain(35), makeCtx({ player: [0, 0, 0] }), 1800).length
  const wet = ambRun(ambBrain(35), makeCtx({ player: [0, 0, 0], rain: 1 }), 1800).length
  const cab = ambRun(ambBrain(35), makeCtx({ player: [0, 0, 0], indoor: true }), 600)
  ok('rain quiets the birds', wet < dry * 0.4 && wet > 0, dry + ' calls dry, ' + wet + ' in heavy rain (30 min)')
  const vmax = Math.max(...WILD.ambient.day.species.map((x) => x.vol))
  ok('from inside the cab they are quieter', cab.every((e) => e.volume <= vmax * WILD.ambient.indoor + 1e-9))
}

console.log('— save / restore —')
// ------------------------------------------------------------------ 21. round trip
{
  const b = makeBrain({ seed: 40, bear: true, bearSpots: [[0, 260]] }), g = b.groups[0], br = b.bear
  const ctx = makeCtx({ player: [0, 0, 150] })
  sim(b, ctx, 60, { to: [0, 0, 106], speed: 1.4, stopAt: () => g.state === 'flee' })   // the deer bolt ...
  sim(b, ctx, 30)
  ctx.player[0] = br.pos[0]; ctx.player[2] = br.pos[2] - 35
  sim(b, ctx, 60, { to: [br.pos[0], 0, br.pos[2]], speed: 1.2, stopAt: () => br.state === 'standoff' })   // ... the bear bluffs
  const bluffed = br.bluffs
  sim(b, ctx, 90, { to: [ctx.player[0], 0, ctx.player[2] - 60], speed: 1.4, stopAt: () => br.state === 'calm' })   // you back off: it leaves
  ctx.night = true; sim(b, ctx, 5, {})
  br.dogCool = 7.5; b.amb.cool[b.ambNames.indexOf('coyote')] = 42
  ok('(setup: deer bolted, bear bluffed, then left)', g.anchor[1] < 90 && bluffed === 1 && br.state === 'calm', 'anchor ' + g.anchor.map(f1).join(',') + ', bluffs ' + bluffed + ', ' + br.state)
  const json = JSON.parse(JSON.stringify(b.toJSON()))
  const r = makeBrain({ seed: 99, bear: true, bearSpots: [[0, 260]], saved: json })
  const same = (a, c) => Math.abs(a - c) < 0.011
  ok('deer positions come back', r.deer.every((m, i) => same(m.pos[0], b.deer[i].pos[0]) && same(m.pos[2], b.deer[i].pos[2])), r.deer.map((m) => m.pos.map(f1).join(',')).join(' | '))
  ok('...and where they have settled (their anchor)', same(r.groups[0].anchor[0], g.anchor[0]) && same(r.groups[0].anchor[1], g.anchor[1]))
  ok('the bear\'s position and mood', same(r.bear.pos[0], br.pos[0]) && same(r.bear.pos[2], br.pos[2]) && same(r.bear.mood, br.mood) && br.mood > 0, 'mood ' + f2(r.bear.mood))
  ok('...its cooldowns (ignoring you, the dog)', same(r.bear.ignoreT, br.ignoreT) && same(r.bear.dogCool, br.dogCool) && r.bear.ignoreT > 0, 'ignore ' + f1(r.bear.ignoreT) + ' s')
  ok('...its night (visit roll, when)', r.bear.nightOn === br.nightOn && same(r.bear.visitAt, br.visitAt) && r.bear.visitRoll === br.visitRoll)
  ok('ambient cooldowns and the hush', same(r.amb.cool[r.ambNames.indexOf('coyote')], 42) && same(r.amb.t, b.amb.t))
  ok('lines already said stay said', r.flags.deerFirst && r.flags.bearFirst && r.flags.bearBluff)
  const evs = sim(r, makeCtx({ player: [0, 0, 150] }), 30, { to: [r.deer[0].pos[0], 0, r.deer[0].pos[2]], speed: 1.4 })
  ok('...so they are not said again', !typed(evs, 'say').some((e) => /Deer\./.test(e.text)) && !typed(evs, 'toast').length)
  // a save taken mid-charge: comes back calm, with a moment's grace
  const b2 = bearBrain({ seed: 41 }), c2 = makeCtx({ player: [0, 0, 150] })
  sim(b2, c2, 40, { to: [0, 0, 100], speed: 1.4, stopAt: () => b2.bear.state === 'huff' })
  sim(b2, c2, 20, { to: [b2.bear.pos[0], 0, b2.bear.pos[2]], speed: 1.0, stopAt: () => b2.bear.state === 'bluff' })
  const j2 = JSON.parse(JSON.stringify(b2.toJSON()))
  const r2 = bearBrain({ seed: 41, saved: j2 })
  ok('saved mid-bluff: restored calm, ignoring you for a few seconds', j2.bear.state === 'bluff' && r2.bear.state === 'calm' && r2.bear.ignoreT >= B.restoreGrace - 1e-9, j2.bear.state + ' -> ' + r2.bear.state + ', grace ' + f1(r2.bear.ignoreT) + ' s')
  // saved standing right on the shed's edge: the save's rounding must not throw it back home
  const be = bearBrain({ tower: [0, 0], shed: [9, 7], bearSpots: [[40, 40]] })
  be.place(be.bear, 9 + 3.2005, 7, 0)
  const je = JSON.parse(JSON.stringify(be.toJSON())); je.bear.pos[0] = 9 + 3.19   // (rounded to the wrong side)
  const re = bearBrain({ tower: [0, 0], shed: [9, 7], bearSpots: [[40, 40]], saved: je })
  ok('a save on the edge of a no-go spot comes back beside it, not at home', Math.hypot(re.bear.pos[0] - 12.2, re.bear.pos[2] - 7) < 0.05 && re.hardOk(re.bear.pos[0], re.bear.pos[2], B), re.bear.pos.map(f2).join(','))
  // junk
  let threw = null
  try { for (const junk of [null, {}, { groups: [{ id: 'g', anchor: [NaN, 1], members: [[NaN, 'x', 0], [1e9, 1e9, 0]] }], bear: { pos: [Infinity, 0], mood: 'x', task: 'fly' } }, { v: 99 }]) makeBrain({ bear: true, saved: junk }) } catch (e) { threw = e }
  const jb = makeBrain({ bear: true, saved: { groups: [{ id: 'g', anchor: [NaN, 1], members: [[NaN, 'x', 0], [1e9, 1e9, 0]] }], bear: { pos: [Infinity, 0], mood: 'x', task: 'fly' } } })
  ok('junk saves: no crash, everyone somewhere sensible', !threw && jb.animals.every((a) => Number.isFinite(a.pos[0]) && Math.abs(a.pos[0]) < 500 && Math.abs(a.pos[2]) < 500) && jb.bear.task === 'forage', threw ? String(threw) : '')
  const rs = makeBrain({ seed: 40, bear: true, bearSpots: [[0, 260]], saved: json }); rs.reset()
  ok('reset(): back home, calm, lines unsaid', rs.groups[0].state === 'calm' && Math.hypot(rs.groups[0].anchor[0], rs.groups[0].anchor[1] - 100) < 0.01 && !Object.keys(rs.flags).length && rs.bear.mood === 0)
}

console.log('— cost —')
// ------------------------------------------------------------------ 22. per-frame cost and garbage
{
  const b = makeBrain({ seed: 50, bear: true, deer: [
    { id: 'a', home: [0, 100], members: [{ role: 'doe' }, { role: 'fawn', scale: 0.6 }] },
    { id: 'b', home: [-120, 40], members: [{ role: 'doe' }, { role: 'doe' }] },
    { id: 'c', home: [120, -20], members: [{ role: 'doe' }, { role: 'fawn', scale: 0.6 }] }], bearSpots: [[0, 150], [40, 170]] })
  const ctx = makeCtx({ player: [0, 0, 60], dog: { pos: [1, 0, 60], tamed: true }, weeper: [0, 1, 400] })
  let k = 0
  const frame = () => { k++; ctx.player[2] = 60 + Math.sin(k / 400) * 50; ctx.vel[1] = Math.cos(k / 400) / 8; ctx.dog.pos[2] = ctx.player[2]; ctx.night = (k >> 12) & 1; b.update(DT, ctx) }
  for (let i = 0; i < 20000; i++) frame()
  const N = 60000
  const gc = globalThis.gc
  if (gc) gc()
  // time: the best of three 20k-frame batches (a busy machine stalls one batch, not all three); garbage: over all 60k
  const h0 = process.memoryUsage().heapUsed
  let ms = Infinity
  for (let r = 0; r < 3; r++) { const t0 = performance.now(); for (let i = 0; i < N / 3; i++) frame(); ms = Math.min(ms, (performance.now() - t0) * 3) }
  if (gc) gc()
  const per = (process.memoryUsage().heapUsed - h0) / N
  ok('update() is cheap', ms / N < 0.1, f2((ms / N) * 1000) + ' µs a frame (6 deer, the bear, the dog, the birds; ~30 µs typical, limit 100 µs for background-QoS runs)')
  ok('...and leaves no garbage behind', !gc || per < 8, gc ? f2(per) + ' bytes retained a frame' : 'run with --expose-gc to measure')
}

// ------------------------------------------------------------------ 23. the real world (terrain + layout), if it's here
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const A = (p) => path.join(ROOT, 'assets', p)
if (fs.existsSync(A('data/terrain_height.bin')) && fs.existsSync(A('data/layout.json'))) {
  console.log('— the real terrain + layout —')
  const meta = JSON.parse(fs.readFileSync(A('data/terrain_height.json')))
  const bin = fs.readFileSync(A('data/terrain_height.bin'))
  const Hf = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4)
  const [HW, HH] = meta.size, [hx0, hz0] = meta.origin, hc = meta.cell
  const cl = (x, a, c) => (x < a ? a : x > c ? c : x)
  const heightAt = (x, z) => {
    const fi = cl((x - hx0) / hc, 0, HW - 1.001), fj = cl((z - hz0) / hc, 0, HH - 1.001), i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j
    return Hf[j * HW + i] * (1 - tx) * (1 - tz) + Hf[j * HW + i + 1] * tx * (1 - tz) + Hf[(j + 1) * HW + i] * (1 - tx) * tz + Hf[(j + 1) * HW + i + 1] * tx * tz
  }
  const layout = JSON.parse(fs.readFileSync(A('data/layout.json')))
  const P = resolvePlaces(layout)
  const b = new WildlifeBrain({ ground: heightAt, rect: { min: [hx0, hz0], max: [hx0 + (HW - 1) * hc, hz0 + (HH - 1) * hc] }, ravine: P.ravine, rock: P.rock, tower: P.tower, shed: P.shed,
    deerGroups: P.deerGroups, bearSpots: P.bearSpots, shedSpots: P.shedSpots, route: P.route, rng: seeded(77) })
  ok('three deer groups (6 deer) and the bear, on open, gentle ground', b.groups.length === 3 && b.deer.length === 6 && b.groups.every((g) => b.slopeAt(g.home[0], g.home[1]) < 0.25),
    b.groups.map((g) => g.id + ' ' + g.home.map(f1).join(',') + ' slope ' + f2(b.slopeAt(g.home[0], g.home[1]))).join(' | '))
  const mg = b.groups.find((g) => g.id === 'meadow')
  ok('the meadow pair is in binocular view of the cab', Math.hypot(mg.home[0] - P.tower[0], mg.home[1] - P.tower[1]) < 90, f1(Math.hypot(mg.home[0], mg.home[1])) + ' m from the tower')
  ok('every group well clear of the Weeper\'s rock', b.groups.every((g) => Math.hypot(g.home[0] - P.rock[0], g.home[1] - P.rock[2]) > D.weeperRange + 20))
  ok('the night route runs burn -> spring -> J1 -> tower', P.route.length > 50 && Math.hypot(P.route[0][0] - layout.places.burn_scar.position[0], P.route[0][2] - layout.places.burn_scar.position[2]) < 2 && Math.hypot(P.route[P.route.length - 1][0], P.route[P.route.length - 1][2]) < 10, f1(new Path(P.route).length) + ' m')
  const ctx = makeCtx({ player: [0, 30, 0], playerSafe: true, indoor: true })
  let bad = 0, maxOff = 0, minCheb = Infinity
  const tasks = []
  const watch = () => {
    for (const a of b.animals) if (!b.placeOk(a.pos[0], a.pos[2], a.kind === 'bear' ? B : D) || b.slopeAt(a.pos[0], a.pos[2]) > (a.kind === 'bear' ? B : D).hardSlope + 1e-6) bad++
    for (const g of b.groups) for (const m of g.members) maxOff = Math.max(maxOff, Math.hypot(m.pos[0] - g.home[0], m.pos[2] - g.home[1]))
    minCheb = Math.min(minCheb, Math.max(Math.abs(b.bear.pos[0] - P.tower[0]), Math.abs(b.bear.pos[2] - P.tower[1])))
    if (tasks[tasks.length - 1] !== b.bear.task) tasks.push(b.bear.task)
  }
  sim(b, ctx, 600, { onStep: watch })
  ctx.night = true
  b.update(DT, ctx); b.bear.visitRoll = true
  const evs = sim(b, ctx, 720, { onStep: watch })
  ok('a day and a night: nobody on bad ground, in the ravine or off the map', bad === 0, bad + ' bad animal-frames')
  ok('left alone, the deer stay about their meadows', maxOff < D.range + D.keepDoe + 4, f1(maxOff) + ' m from home at most')
  ok('the bear\'s night: up the trail to the shed, and back', tasks.join('>').includes('visit>sniff>return'), tasks.join(' > '))
  ok('...never inside the tower fence', minCheb >= WILD.fence - 0.05, f2(minCheb) + ' m')
  ok('...and the watch in the cab hears about it', typed(evs, 'say').some((e) => /generator shed/.test(e.text)))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
