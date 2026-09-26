// FALSE LIGHT — the nightmare director. Pure-ish: no three.js, no DOM, no timers of its own. The game hands it the
// frame's context and ONE actions object; everything it does to the world goes through that (ACTIONS below), so a fake
// clock + fake actions run whole nights in a test (tests/director.test.mjs).
//
// Pacing over volume. Three kinds of thing happen:
//   DREAD   the mountain doing things. Night only. REAL: the pill doesn't touch them, the dog hears them. Long silences
//           between them (the countdown stalls while you're still scared and runs a little faster when you've been calm
//           a long while), a build-up before the payoff (the forest hushes, then the branch), escalating by night (they
//           come sooner and the big ones unlock: the face at the window, the lights), never the same one twice running,
//           each with a cap per night and a hush after it.
//   HALLU   your own head, from lack of sleep (fatigue.halluLevel, which the pill presses down). Mild ≥ 0.45: whispers,
//           something at the edge of your eye, knocks. Moderate ≥ 0.65: a figure in the cab, the Weeper at the tree line.
//           Severe ≥ 0.85, the DANGEROUS ones (never while the pill has hold): the Weeper in the cab → you panic and run;
//           you blink and you're standing at the catwalk rail; a too-steady SOS light that walks you off the trail. By
//           day too (you don't need the dark to see things when you haven't slept). The dog never reacts to these. When
//           you're wrecked the fakes use the REAL sounds (the Weeper's bare feet on the stairs, his knock at the door),
//           and the real Weeper still comes while you're seeing things: you can't tell.
//   SLEEPY  your body (fatigue.level: what you feel, which the pill makes worse): microsleeps (a blink that lasts minutes;
//           you may drop what you're holding, you may go down on the stairs) and, past wrecked, the collapse (outside at
//           night that's the cold). Plus the continuous symptoms: heavy slow blinks, yawns, the view drifting, the head
//           nodding and jerking back up (the hypnic jerk), and after two pills close together the grey-outs.
// Nothing new starts while ctx.busy (a modal, a line on the radio, a cutscene, the bed) or a scripted beat holds the
// score (ctx.quiet): every clock and any event in progress freezes until it's over (only clean-up steps still run).
//
//   const D = new Director({ rng })              // once; D.setWorld({...}) once the layout is known
//   D.update(dt, ctx, actions)                   // every frame while playing
//   D.clear(actions)                             // death / phase change / load: drop everything it has out
// ctx (every frame): { t (s, real), phase ('night1'…), hour, busy, quiet, zone, mode ('walk'|'searchlight'|'finder'),
//   sitting, eye [x,y,z], fwd [x,y,z] (unit), yaw, pitch, speed (m/s), flashlight, lamp, beamSpot ([x,y,z]|null),
//   fear (0..1), fatigue (the Fatigue: level, halluLevel, blocksDanger, woozy, sleep()), weeper (the REAL one's state),
//   bear (0..1), lost (the real tree-line watcher is out), signals (real SOS lights out now), dog ({ pos, tamed, name }|null),
//   holding (kind in the active hand|null), cold (0..1) }
//
// ACTIONS — every one optional (a missing one just means that part doesn't happen); any that throws is caught and warned
// about once. Positions are [x, y, z] arrays.
//   playAt(name, pos|null, vol)        a one-shot, positional (null = in your head) → a handle with stop() (or nothing)
//   duckAmbience(sec)                  the forest / crickets / insects go dead silent for sec, then creep back
//   quiet(sec)                         hold the score silent (the game's quiet())
//   say(lines)                         subtitles: [{ who, text, note|radio }] (content/story.js LINES)
//   spawnPhantom(kind, pos, facePos, pose) → { move(pos, facePos, pose), remove() } | null. kinds: 'figure' (a man),
//                                      'shadow' (a man, dark), 'weeper' (the Weeper's body), 'face' (pale, at a window,
//                                      with eye glints), 'lost_hiker', 'sos_light' (a lamp flashing sosLamp(t)),
//                                      'bootprints' (wet prints on the landing; may return null). pos = the feet.
//   flickerOut(sec)                    the cab lamp AND the flashlight die for sec, then come back as they were
//   sting(kind)                        'jump' (the music's 'seen' hit + sub_boom) | 'dread' (sub_boom, low)
//   fearSpike(k, why)                  game.fear.spike: 0.15 a whisper … 1 a jump scare
//   shake(k, sec, fov)                 the game's scare(): screen shake 0..1, FOV punch (negative degrees)
//   hurt(amount, why)                  the game's hurt()
//   lids(k)                            eyelids 0..1 (post blackout); called every frame while > 0, once more with 0
//   look(dYaw, dPitch)                 nudge the view (radians, this frame): drift, nods, the jerk
//   lookAt(pos, sec)                   turn the head to pos over sec
//   panic(sec)                         a forced sprint the way you're facing, for sec
//   passTime(min)                      the clock jumps min game minutes (never past a gate)
//   dropHeld()                         what's in the active hand falls at your feet → its kind | null
//   movePlayer(pos, lookPos)           put you there (only if it's somewhere you could stand) → bool
//   moveCabItem(kind, pos, rotY)       move one of the cab's things (it must be lying in the cab) → bool
//   dogReact(kind, pos)                'growl' | 'whimper', toward pos → bool (false: no tamed dog close)
import { clamp, lerp, smooth, dist, dist2d, lerp3 } from './util.js?v=b81b31af'
import { LINES } from './content/story.js?v=b81b31af'

export const DIR = {
  minGap: 20,                 // s: no two events start closer than this, whatever they are
  firstDread: 75,             // s into a night before the first dread event
  dreadGap: [[110, 190], [55, 110]],   // s between dread events on night 1 / night 2 (night 3+: x0.85 a night)
  hush2: 0.75,                // night 2+: the hush after a dread event is this much shorter
  calmAfter: 90, calmBoost: 1.35,       // calm (fear < 0.15) this long → the dread countdown runs this much faster
  scaredHold: 0.5,            // fear above this stalls the dread countdown (let it breathe)
  mild: 0.45, moderate: 0.65, severe: 0.85,   // halluLevel for each tier
  halluGap: [165, 35],        // s between hallucinations, at mild … at wrecked
  microAt: 0.68, microGap: [160, 45],         // microsleeps: level, s between them (at microAt … at 1)
  collapseAt: 0.97, collapseHold: 45,         // wrecked this long (s, real) and you go down
  blinkAt: 0.35, yawnAt: 0.45, driftAt: 0.55, nodAt: 0.75,
}
const CHASE = new Set(['coming', 'stairs', 'door', 'hunting'])
const R = (rng, a, b) => a + (b - a) * rng()
const pickR = (rng, a) => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const flat = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l] }
const turnY = (v, a) => [v[0] * Math.cos(a) - v[2] * Math.sin(a), v[1], v[0] * Math.sin(a) + v[2] * Math.cos(a)]   // about +y
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const BLINK = [[0.05, 1], [0.12, 1], [0.26, 0]]   // a fast flinch-blink (the thing is gone when your eyes open)

/** The lure light's SOS: every mark exactly the same length (rule 3: a light that's too steady). 1 = lit. t in s. */
export function sosLamp(t, unit = 0.26) {
  const seq = [1, 1, 1, 1, 1, 3, 3, 1, 3, 1, 3, 3, 1, 1, 1, 1, 1, 9]   // on, off, on, off … S O S, then a long gap
  let total = 0; for (const x of seq) total += x
  let u = ((t / unit) % total + total) % total
  for (let i = 0; i < seq.length; i++) { if (u < seq[i]) return i % 2 === 0 ? 1 : 0; u -= seq[i] }
  return 0
}

// ---------------------------------------------------------------- the events
// { id, fam: 'dread'|'hallu'|'sleepy', tier (hallu: 0 mild, 1 moderate, 2 severe = dangerous), max (per night / day, or
//   (n) => max), after: [lo, hi] s of hush once it's over, w(c, D) → weight (0 = can't now), go(c, D) → false if it
//   couldn't start here after all }
export const EVENTS = [
  // ---- DREAD
  { id: 'hush_snap', fam: 'dread', max: 2, after: [70, 110],
    w: (c) => (!c.inCab ? 1 : 0),
    go: (c, D) => {   // the forest goes dead quiet … then one branch, close behind you (or right under the tower)
      const sil = D.r(6, 9)
      D.act('duckAmbience', sil + 3); D.quiet(sil + 8)
      D.at(sil, (c2) => {
        let p
        if (c2.eye[1] > 20) { const g = D.W.stairFoot, a = D.r(0, 6.283); p = [g[0] + Math.cos(a) * 4, 0, g[2] + Math.sin(a) * 4]; p[1] = D.ground(p[0], p[2], g[1]) + 0.1 }
        else { p = D.behind(c2, D.r(4, 7), D.r(-1.5, 1.5)); p[1] = D.ground(p[0], p[2], c2.eye[1] - 1.65) + 0.1 }
        D.play('snap_close', p, 1.3); D.spike(0.55, 'snap')
        if (D.rng() < 0.3) { const q = add(p, mul(sub(p, c2.eye), 0.5)); q[1] = p[1]; D.at(1.3, () => D.play('branch_snap', q, 0.8)) }   // …and it steps away
      })
      D.at(sil + 4, () => D.done())
      return true
    } },
  { id: 'stair_steps', fam: 'dread', max: (n) => (n >= 2 ? 2 : 1), after: [80, 120],
    w: (c) => ((c.inCab || c.zone === 'catwalk') && !c.chase ? 1 : 0),
    go: (c, D) => {   // boots coming up the tower stairs, slow, heavy; they stop on the landing under the cab. Nobody there.
      const bare = c.level >= 0.8   // wrecked: bare feet, quick: exactly what the real Weeper's climb sounds like
      const n = bare ? D.ri(14, 18) : D.ri(11, 14), top = D.landing(), foot = D.W.stairFoot
      let tt = 1.5
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n, p = lerp3(foot, top, 0.08 + 0.92 * k), v = 0.55 + 0.9 * k
        D.at(tt, () => { D.play(bare ? 'footstep_wood' : 'stair_step', p, v); if (!bare && D.rng() < 0.22) D.play('stair_creak', p, 0.8) })
        tt += bare ? D.r(0.3, 0.4) : D.r(0.78, 1.0) * (1 + 0.25 * k)   // slower toward the top
      }
      D.quiet(tt + 10)
      if (c.dogNear) D.at(tt * 0.5, () => D.act('dogReact', 'whimper', top))
      D.at(tt + 2.2, () => { D.spike(0.5, 'stairs'); if (D.once('stairs')) D.say(LINES.stairsStop) })
      if (!bare && D.rng() < 0.6) {   // wet bootprints on the landing, drying (a game that can't draw them still gets the drip)
        D.at(tt + 0.4, () => {
          const h = D.ph('bootprints', top, D.W.cab, null)
          for (let j = 0; j < 3; j++) D.at(3 + j * D.r(2.5, 4.5), () => D.play('bootprint_drip', top, 0.8))
          D.at(40, () => { D.unph(h); D.done() }, true)
          D.at(8, () => D.background(40))   // the prints dry by themselves
        })
      } else D.at(tt + 6, () => D.done())
      return true
    } },
  { id: 'knocks', fam: 'dread', max: 2, after: [60, 100],
    w: (c) => (c.inCab && !c.chase ? 1 : 0),
    go: (c, D) => {   // three slow knocks on the cab door
      D.quiet(14)
      D.at(D.r(1, 2.5), (c2) => { D.play(c2.level >= 0.8 ? 'knock' : 'knock_slow', D.W.door, 1.3); D.spike(0.4, 'knock') })
      D.at(9, () => D.done())
      return true
    } },
  { id: 'breath', fam: 'dread', max: 2, after: [60, 100],
    w: (c) => (c.mode === 'walk' && c.inDark && c.stillFor >= 5 ? 1.4 : 0),
    go: (c, D) => {   // standing still in the dark: breathing, right behind your head. It stops the moment you turn.
      const yaw0 = c.yaw, ev = D.ev; let n = 0, h = null
      const breathe = () => {
        if (D.ev !== ev) return
        n++; h = D.play('breath_close', D.behind(D.c, 0.42, 0, 0.05), 0.9)
        if (n < 4) D.at(D.r(2.8, 3.4), breathe)
        else D.at(3, () => { D.frame(null); D.play('whisper', D.behind(D.c, 0.35, 0.15, 0.05), 0.5); D.spike(0.45, 'breath'); D.at(2.5, () => D.done()) })
      }
      D.at(0.3, breathe)
      D.frame((dt, c2) => {
        const turned = Math.abs(wrap(c2.yaw - yaw0)) > 1.0, moved = c2.speed > 0.7
        if (turned || moved) { if (h && h.stop) h.stop(); D.spike(turned ? 0.5 : 0.3, 'breath'); D.done() }
      })
      return true
    } },
  { id: 'radio', fam: 'dread', max: 2, after: [70, 120],
    w: (c) => (c.inCab ? (c.nightN >= 2 ? 1 : 0.7) : 0),
    go: (c, D) => {   // static swells on the set by itself, and Silver Fork says something it shouldn't know
      D.play('radio_wrong', D.W.radio, 1)
      D.at(2.3, () => { D.say(D.nextOf('radio', LINES.radioWrong)); D.spike(0.4, 'radio') })
      D.at(5, () => D.done())
      return true
    } },
  { id: 'crosser', fam: 'dread', max: 2, after: [60, 100],
    w: (c) => ((c.flashlight && c.mode === 'walk' && !c.inCab && c.pitch > -0.5) || (c.mode === 'searchlight' && c.beamSpot) ? 1 : 0),
    go: (c, D) => {   // something crosses the far end of the beam, fast: dark, there for 0.4 s
      const sl = c.mode === 'searchlight' && c.beamSpot
      const d0 = sl ? dist(c.eye, c.beamSpot) : D.r(25, 35), ctr = sl ? c.beamSpot.slice() : add(c.eye, mul(c.fh, d0))
      const half = Math.max(2.5, d0 * (sl ? 0.06 : 0.34) * 0.5), side = D.rng() < 0.5 ? -1 : 1, rt = [-c.fh[2], 0, c.fh[0]]
      const gy = (p) => [p[0], D.ground(p[0], p[2], c.eye[1] - 1.65), p[2]]
      const from = gy(add(ctr, mul(rt, -side * half))), to = gy(add(ctr, mul(rt, side * half)))
      const h = D.ph('figure', from, to, 'run_a'); if (!h) return false
      D.spike(0.45, 'crosser')
      let k = 0
      D.frame((dt) => {
        k = Math.min(1, k + dt / 0.42)
        if (h.move) h.move(gy(lerp3(from, to, k)), to, k < 0.5 ? 'run_a' : 'run_b')
        if (k >= 1) { D.unph(h); D.done() }
      })
      return true
    } },
  { id: 'face', fam: 'dread', max: 1, after: [120, 180],
    w: (c, D) => (c.inCab && c.hour >= 23 && D.tonight() >= (c.nightN >= 2 ? 2 : 3) ? 0.9 : 0),
    go: (c, D) => {   // the jump: a pale face at the glass, eyes catching the light, for a quarter of a second
      const wins = D.W.windows, keys = Object.keys(wins)
      let armed = 45, only = null
      if (D.rng() < 0.5) {   // a tap on the glass behind you first: that's what turns you round
        only = keys.reduce((b, k) => (D.dot(c, wins[k]) < D.dot(c, wins[b]) ? k : b), keys[0])
        D.at(D.r(1, 3), () => D.play('window_tap', wins[only], 1))
      }
      D.frame((dt, c2) => {
        if ((armed -= dt) <= 0) { D.frame(null); D.done(40); return }   // you never looked: it never happened
        for (const k of only ? [only] : keys) {
          const w = wins[k]; if (dist2d(c2.eye, w) < 1) continue
          if (!D.look(c2, [w[0], c2.eye[1], w[2]], 16)) continue
          const out = flat(sub(w, D.W.cab))
          const h = D.ph('face', [w[0] + out[0] * 0.45, D.W.cab[1], w[2] + out[2] * 0.45], c2.eye, 'stand')
          D.act('sting', 'jump'); D.spike(1, 'face'); D.act('shake', 0.7, 0.8, -7)
          D.at(0.25, () => { D.unph(h); D.lids(BLINK) }, true)
          D.at(0.5, () => D.play('tinnitus', null, 0.8), true)
          D.frame(null); D.at(3, () => D.done())
          return
        }
      })
      return true
    } },
  { id: 'lights', fam: 'dread', max: (n) => (n >= 2 ? 2 : 1), after: [90, 130],
    w: (c, D) => (((c.inCab && c.lamp) || c.flashlight) && D.tonight() >= 2 ? 1 : 0),
    go: (c, D) => {   // the lamp AND the flashlight die together, three seconds; something moves in it
      const sec = D.r(2.6, 3.6)
      D.quiet(sec + 8); D.act('flickerOut', sec); D.spike(0.55, 'dark')
      if (D.rng() < 0.6) D.at(D.r(0.9, 1.6), (c2) => (c2.inCab ? D.play('board_creak', D.around(c2, 1.2), 1.1) : D.play('breath_close', D.behind(c2, 0.5, 0, 0.05), 0.8)))
      D.at(sec + 2, () => D.done())
      return true
    } },
  { id: 'moved', fam: 'dread', max: 1, after: [30, 50],
    w: (c, D) => (D.awayFromCab(c) ? 1.3 : 0),
    go: (c, D) => {   // while you were down there: the alarm clock is on the floor in the middle of the cab, facing the door
      const W = D.W, spot = lerp3(W.cab, W.door, 0.4), rotY = Math.atan2(W.door[0] - spot[0], W.door[2] - spot[2])
      spot[1] = W.cab[1]
      const kind = ['clock', 'pot', 'lantern'].find((k) => D.act('moveCabItem', k, spot.slice(), rotY))
      if (!kind) return false
      D.watch(300, (c2) => {
        if (!(c2.inCab && dist(c2.eye, spot) < 3.2 && D.look(c2, spot, 24))) return false
        D.say(kind === 'clock' ? LINES.movedClock : LINES.movedThing(kind === 'pot' ? 'coffee pot' : 'lantern')); D.spike(0.45, 'moved')
        return true
      })
      D.at(0.5, () => D.done())
      return true
    } },
  { id: 'dog', fam: 'dread', max: 2, after: [80, 120],
    w: (c) => (c.dogNear && (c.inCab || c.zone === 'catwalk' || c.zone === 'base') ? 1 : 0),
    go: (c, D) => {   // she hears it first: stares at the door growling, or presses herself behind your legs. She's right.
      const growl = D.rng() < 0.6, at = c.inCab ? D.W.door : D.W.stairFoot
      if (!D.act('dogReact', growl ? 'growl' : 'whimper', at)) return false
      const nm = (c.dog && c.dog.name) || 'Juniper'
      D.say(growl ? (c.inCab ? LINES.dogGrowl(nm) : LINES.dogGrowlDark(nm)) : LINES.dogWhimper(nm)); D.spike(0.35, 'dog')
      if (D.rng() < 0.55) D.at(D.r(12, 20), (c2) => {
        if (c2.inCab) D.play(c2.level >= 0.8 ? 'knock' : 'knock_slow', D.W.door, 1.25)
        else { const g = D.W.stairFoot; D.play('snap_close', [g[0] + D.r(-4, 4), D.ground(g[0], g[2], g[1]) + 0.1, g[2] + D.r(2, 6)], 1.2) }
        D.spike(0.45, 'dog was right'); D.at(6, () => D.done())
      })
      else D.at(8, () => D.done())
      return true
    } },
  { id: 'treeline', fam: 'dread', max: 1, after: [90, 130],
    w: (c, D) => (!c.lost && D.W.treeLine.length && (c.inCab || c.zone === 'catwalk') ? (c.nightN >= 2 ? 0.8 : 0.5) : 0),
    go: (c, D) => {   // someone at the edge of the trees, facing the tower; a little closer every time you look away
      const tl = D.W.treeLine, away = tl.filter((p) => !D.look(c, p, 60)), p0 = pickR(D.rng, away.length ? away : tl)
      const path = [0, 0.18, 0.34, 0.48, 0.6].map((k) => { const q = lerp3(p0, D.W.gate, k); q[1] = D.ground(q[0], q[2], q[1]); return q })
      const h = D.ph('lost_hiker', path[0], D.W.tower, 'stand_tilt'); if (!h) return false
      D.at(15, () => D.background(30))   // he stands there by himself now: other things can happen while he does
      let i = 0, hidden = 0, seen = false, stepSeen = 0, life = 110, last = 0
      D.frame((dt, c2) => {
        life -= dt
        const pos = path[i], head = [pos[0], pos[1] + 1.4, pos[2]]
        const obs = D.look(c2, head, 26) && dist(c2.eye, head) < 180
        const lit = (c2.beamSpot && dist2d(c2.beamSpot, pos) < 6) || (c2.flashlight && obs && dist(c2.eye, pos) < 30)
        if (obs) {
          hidden = 0
          if (!seen) { seen = true; D.spike(0.4, 'treeline'); if (D.once('treeFigure')) D.say(LINES.treeFigure) }
          else if (stepSeen !== i) { stepSeen = i; D.spike(0.5, 'closer') }
          if (i === path.length - 1 && (last += dt) > 1.5) { D.frame(null); D.lids(BLINK); D.at(0.07, () => { D.unph(h); D.done() }); return }
        } else if (seen && !lit && (hidden += dt) >= 2.6 && i < path.length - 1) { i++; hidden = 0; if (h.move) h.move(path[i], D.W.tower, i % 2 ? 'stand' : 'stand_tilt'); D.quiet(20) }
        if (life <= 0) { D.unph(h); D.done() }
      })
      return true
    } },

  // ---- HALLU: mild
  { id: 'whisper', fam: 'hallu', tier: 0, max: 6, after: [25, 45],
    w: () => 1.2,
    go: (c, D) => {
      D.play('whisper', D.behind(c, 0.55, (D.rng() < 0.5 ? -1 : 1) * 0.45, 0.05), 0.75); D.spike(0.15, 'whisper')
      if (D.once('whisper')) D.at(2, () => D.say(LINES.halluWhisper))
      D.at(3.5, () => D.done())
      return true
    } },
  { id: 'shadow', fam: 'hallu', tier: 0, max: 5, after: [30, 50],
    w: (c) => ((c.night || (c.inCab && !c.lamp)) && c.mode === 'walk' ? 1 : 0),
    go: (c, D) => {   // someone standing at the edge of your eye; gone as you turn
      const a = D.r(70, 84) * Math.PI / 180 * (D.rng() < 0.5 ? -1 : 1), d = c.inCab ? D.r(1.4, 1.9) : D.r(5, 12)
      let p = add(c.eye, mul(turnY(c.fh, a), d))
      if (c.inCab) { p = [clamp(p[0], D.W.cab[0] - 1.6, D.W.cab[0] + 1.6), D.W.cab[1], clamp(p[2], D.W.cab[2] - 1.6, D.W.cab[2] + 1.6)] }
      else p[1] = D.ground(p[0], p[2], c.eye[1] - 1.65)
      const h = D.ph('shadow', p, c.eye, 'stand'); if (!h) return false
      let life = D.r(1.2, 1.8)
      D.frame((dt, c2) => {
        if (D.look(c2, [p[0], p[1] + 1.4, p[2]], 48)) { D.unph(h); D.spike(0.3, 'shadow'); D.done(); return }
        if ((life -= dt) <= 0) { D.unph(h); D.spike(0.12, 'shadow'); D.done() }
      })
      return true
    } },
  { id: 'hknock', fam: 'hallu', tier: 0, max: 4, after: [30, 50],
    w: (c) => (c.inCab || c.zone === 'catwalk' ? 0.8 : 0),
    go: (c, D) => {
      if (D.rng() < 0.7) D.play(c.level >= 0.8 ? 'knock' : 'knock_slow', D.W.door, 1.1)   // wrecked: the real knock
      else D.play('window_tap', D.W.windows[pickR(D.rng, Object.keys(D.W.windows))], 0.9)
      D.spike(0.3, 'knock'); D.at(4, () => D.done())
      return true
    } },
  // ---- HALLU: moderate
  { id: 'figure', fam: 'hallu', tier: 1, max: 3, after: [45, 70],
    w: (c) => (c.inCab && c.mode === 'walk' && (c.night || c.lh >= 0.8) ? 1 : 0),
    go: (c, D) => {   // a man standing in the corner behind you; he's there as you turn … and gone as you blink
      const p = D.cornerBehind(c), h = D.ph('figure', p, c.eye, 'stand'); if (!h) return false
      D.play('board_creak', p, 0.9)
      let life = 7, seenT = -1
      D.frame((dt, c2) => {
        life -= dt
        if (seenT < 0 && D.look(c2, [p[0], p[1] + 1.5, p[2]], 30)) { seenT = 0; D.spike(0.7, 'figure') }
        if (seenT >= 0 && (seenT += dt) > 0.22) { D.frame(null); D.lids(BLINK); D.at(0.06, () => { D.unph(h); D.done() }); return }
        if (life <= 0) { D.unph(h); D.spike(0.2, 'creak'); D.done() }
      })
      return true
    } },
  { id: 'fakeweeper', fam: 'hallu', tier: 1, max: 2, after: [50, 80],
    w: (c, D) => (c.night && !c.chase && D.W.treeLine.length && c.mode === 'walk' ? 0.9 : 0),
    go: (c, D) => {   // crying from the tree line, not the creek; him, standing, facing you. Watch and he's gone.
      const tl = D.W.treeLine.filter((p) => dist2d(c.eye, p) > 30 && dist2d(c.eye, p) < 120)
      const vis = tl.filter((p) => D.look(c, p, 75)), pool = vis.length ? vis : tl
      if (!pool.length) return false
      const p = pickR(D.rng, pool).slice(); p[1] = D.ground(p[0], p[2], p[1])
      const h = D.ph('weeper', p, c.eye, 'stand'); if (!h) return false
      const head = [p[0], p[1] + 1.2, p[2]]
      D.play('sob', head, 1.6)
      let life = 22, watch = 0, seen = false
      D.frame((dt, c2) => {
        life -= dt
        if (D.look(c2, head, 14)) {
          if (!seen) { seen = true; D.spike(0.6, 'weeper?') }
          if ((watch += dt) > 1.2) { D.frame(null); D.lids(BLINK); D.at(0.07, () => { D.unph(h); D.done() }); return }
        }
        if (life <= 0) { D.unph(h); D.done() }
      })
      return true
    } },
  // ---- HALLU: severe (dangerous)
  { id: 'weepercab', fam: 'hallu', tier: 2, max: 1, after: [120, 180],
    w: (c) => (c.inCab && c.mode === 'walk' ? 1 : 0),
    go: (c, D) => {   // crying in the corner behind you. Turn round and he's there: the scream, and you run.
      const p = D.cornerBehind(c), head = [p[0], p[1] + 1.2, p[2]], ev = D.ev
      D.act('flickerOut', 0.25); D.quiet(30)
      let sobs = 0
      const sob = () => { if (D.ev !== ev || fired) return; D.play('sob', head, 1.5); if (++sobs < 3) D.at(4.2, sob) }
      let life = 12, fired = false
      sob()
      D.frame((dt, c2) => {
        life -= dt
        if (!fired && D.look(c2, head, 28)) {
          fired = true; D.frame(null)
          const h = D.ph('weeper', p, c2.eye, 'stand')
          D.at(0.08, () => { D.play('scream', head, 1.8); D.act('sting', 'jump'); D.spike(1, 'weeper!'); D.act('shake', 0.85, 1.1, -8) }, true)
          D.at(0.4, (c3) => {
            D.unph(h); D.act('lookAt', [2 * c3.eye[0] - p[0], c3.eye[1], 2 * c3.eye[2] - p[2]], 0.22)
            D.at(0.25, () => D.act('panic', D.r(1.4, 1.9)), true)
          }, true)
          D.at(2.8, (c3) => {
            if ((c3.zone === 'stairs' || c3.zone === 'catwalk') && D.rng() < 0.6) { D.act('hurt', D.r(0.1, 0.2), 'fall'); D.say(LINES.panicFall) }
            D.play('tinnitus', null, 0.9)
          }, true)
          D.at(6, () => { if (D.rng() < 0.4) D.say(LINES.nobodyThere); D.done() })
          return
        }
        if (life <= 0) { D.frame(null); D.play('whisper', D.behind(c2, 0.4, 0, 0.05), 0.6); D.spike(0.35, 'whisper'); D.at(3, () => D.done()) }   // you didn't look
      })
      return true
    } },
  { id: 'sleepwalk', fam: 'hallu', tier: 2, max: 1, after: [90, 140],
    w: (c) => (c.night && c.mode === 'walk' && !c.sitting ? 1 : 0),
    go: (c, D) => {   // you blink … and you're somewhere else, minutes later: at the rail, at the foot of the stairs
      const W = D.W
      let dest, look, line
      if (c.inCab || c.zone === 'catwalk') {
        const rails = W.rail.slice().sort((a, b) => dist2d(b, c.eye) - dist2d(a, c.eye)).slice(0, 2)
        dest = pickR(D.rng, rails); const out = flat(sub(dest, W.cab)); look = add(dest, [out[0] * 12, -9, out[2] * 12]); line = LINES.sleepwalkRail
      } else if (c.zone === 'stairs' || c.zone === 'base') {
        dest = W.stairFoot.slice(); const tl = W.treeLine.length ? W.treeLine.reduce((b, p) => (dist2d(p, dest) < dist2d(b, dest) ? p : b)) : add(dest, [0, 1, 20])
        look = [tl[0], tl[1] + 1.5, tl[2]]; line = LINES.sleepwalkGate
      } else { dest = add(c.eye, mul(c.fh, 8)); dest[1] = D.ground(dest[0], dest[2], c.eye[1] - 1.65); look = add(dest, mul(c.fh, 20)); line = LINES.sleepwalkTrail }
      D.lids([[0.4, 1], [3.0, 1], [3.6, 0]])
      D.at(0.5, (c2) => {
        D.act('passTime', Math.round(D.r(10, 25)))
        if (c2.holding && D.rng() < 0.5) D.act('dropHeld')
        if (!D.act('movePlayer', dest, look)) { D.act('lookAt', look, 0.1); line = null }
      })
      D.at(3.7, () => { D.spike(0.8, 'sleepwalk'); if (line) D.say(line); D.at(2, () => D.done()) })
      return true
    } },
  { id: 'lure', fam: 'hallu', tier: 2, max: 1, after: [90, 140],
    w: (c) => (c.night && !c.signals && c.mode === 'walk' ? 0.9 : 0),
    go: (c, D) => {   // a light out over the dark, flashing SOS, too evenly. Go after it and it backs off the trail; blink,
      const tw = D.W.tower, dir = turnY(c.fh, D.r(-0.5, 0.5)), dd = D.r(150, 260)   // and you're standing off it with the light gone
      let cur = add(tw, mul(dir, dd)); cur[1] = D.ground(cur[0], cur[2], 0) + 1.2
      const h = D.ph('sos_light', cur, null, null); if (!h) return false
      D.spike(0.2, 'light'); D.at(12, () => D.background(25))
      let life = 110, walked = 0, last = null, stage = 0
      D.frame((dt, c2) => {
        life -= dt
        const out = !c2.inCab && c2.zone !== 'catwalk' && c2.zone !== 'stairs'
        if (out && last) walked += Math.max(0, dist2d(last, cur) - dist2d(c2.eye, cur))
        last = out ? c2.eye.slice() : null
        if (stage === 0 && walked > 15) { stage = 1; cur = add(cur, mul(turnY(dir, D.rng() < 0.5 ? 1.2 : -1.2), 20)); cur[1] = D.ground(cur[0], cur[2], cur[1]) + 1.2; if (h.move) h.move(cur, null) }
        if (stage === 1 && walked > 45) {
          stage = 2; D.frame(null); D.lids([[0.3, 1], [2.2, 1], [2.9, 0]])
          D.at(0.4, (c3) => {
            D.act('passTime', 15)
            const q = add(c3.eye, mul(flat(sub(cur, c3.eye)), 12)); q[1] = D.ground(q[0], q[2], c3.eye[1] - 1.65)
            D.act('movePlayer', q, cur); D.unph(h)
          }, true)
          D.at(3, () => { D.say(LINES.lureWake); D.spike(0.6, 'lure'); D.done() })
          return
        }
        if (life <= 0) { D.frame(null); D.unph(h); if (D.look(c2, cur, 40)) D.say(LINES.lureOut); D.done() }
      })
      return true
    } },

  // ---- SLEEPY
  { id: 'microsleep', fam: 'sleepy', max: 8, after: [40, 80],
    w: (c) => (c.mode === 'walk' ? 1 : 0),
    go: (c, D) => {   // the blink that lasts minutes
      const L = c.level, k = clamp((L - DIR.microAt) / (1 - DIR.microAt)), hold = 1 + 1.1 * k
      let dropped = false, stairs = false
      D.lids([[0.35, 1], [0.35 + hold, 1], [0.6 + hold, 0]])
      D.at(0.1, () => D.act('look', 0, -0.16))   // the head drops
      D.at(0.4, (c2) => {
        D.act('passTime', Math.round(2 + 6 * L))
        if (c2.holding && D.rng() < 0.25 + 0.5 * k) dropped = !!D.act('dropHeld')
        if (c2.zone === 'stairs' && D.rng() < 0.35) { stairs = true; D.act('hurt', 0.07, 'fall') }
      })
      D.at(0.4 + hold, () => { D.act('look', 0, 0.16); D.spike(0.3, 'jerk') })   // and snaps back up
      D.at(0.9 + hold, () => {
        const l = stairs ? LINES.microsleepStairs : dropped ? LINES.microsleepDrop : D.once('micro') ? LINES.microsleep : null
        if (l) D.say(l)
        D.done()
      })
      return true
    } },
  { id: 'collapse', fam: 'sleepy', max: 2, after: [60, 90],
    w: () => 1,
    go: (c, D) => {   // past wrecked: you go down where you stand. Outside at night, that's the cold.
      let cold = false
      D.play('body_fall', [c.eye[0], c.eye[1] - 1.5, c.eye[2]], 1)
      D.lids([[0.6, 1], [5.5, 1], [7.5, 0]])
      D.at(0.8, (c2) => {
        D.act('passTime', Math.round(D.r(60, 100)))
        if (c2.fatigue && c2.fatigue.sleep) c2.fatigue.sleep(1.2)
        if (c2.holding && D.rng() < 0.7) D.act('dropHeld')
        cold = c2.night && !c2.inCab
        if (cold) D.act('hurt', 0.1 + 0.15 * clamp(c2.cold || 0), 'cold')
      })
      D.at(7.6, () => { D.say(cold ? LINES.collapseCold : LINES.collapseIn); D.spike(0.4, 'woke'); D.done() })
      return true
    } },
]
const BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]))

// ---------------------------------------------------------------- the director
export class Director {
  constructor({ rng = Math.random } = {}) {
    this.rng = rng
    this.W = { cab: [0, 30, 0], door: [-1.5, 30, 0], hatch: null, stairFoot: [0, 0, 6], gate: [0, 0, 6], tower: [0, 0, 0], radio: [1.72, 31, -0.45],
      windows: { n: [0, 31.3, -2.05], e: [2.05, 31.3, 0], s: [0, 31.3, 2.05], w: [-2.05, 31.3, 0] },
      rail: [[0, 30.1, 2.95], [2.95, 30.1, 0], [0, 30.1, -2.95], [-2.95, 30.1, 0]], treeLine: [], heightAt: null }
    this.log = []                 // [{ t, id, fam, tier, phase, level, lh }]: every event that started
    this.q = []                   // pending steps { at, fn, keep, ev }
    this.ev = null                // the event in progress (one at a time in the foreground)
    this.bg = []                  // slow ones carrying on in the background (the lure's light, the tree line, drying prints)
    this.watchers = []            // background checks outliving their event (the moved clock)
    this.period = null; this.count = {}; this.nTonight = 0
    this.t = 0; this.endT = -1e9; this.hush = 0; this.dEndT = -1e9; this.dHush = 0; this.nextDread = 1e9; this.nextHallu = 0; this.nextSleepy = 0   // endT + hush: the silence after the last one
    this.lastId = null; this.lastFam = null; this.lastT = -1e9; this.ownQuiet = 0; this.forced = null
    this.said = new Set(); this.cyc = {}
    // the body
    this.lidEv = []; this.lidSym = []; this.lidOut = 0
    this.blinkAt = 0; this.yawnAt = 0; this.greyAt = 0; this.driftT = 0; this.dy = 0; this.dp = 0; this.ty = 0; this.tp = 0; this.nod = 0; this.nodAcc = 0
    this.stillFor = 0; this.calmFor = 0; this.collapseT = 0; this.cabLeftAt = null
  }
  /** Where things are: { heightAt(x, z), cab, door, hatch, stairFoot, gate, tower, radio, windows: {n,e,s,w}, rail: [...], treeLine: [...] } */
  setWorld(w = {}) { for (const [k, v] of Object.entries(w)) if (v != null) this.W[k] = v; return this }
  /** Playtesting: run this event next frame if it can start here (ignores the clocks and the caps). */
  force(id) { if (BY_ID[id]) this.forced = id; return !!BY_ID[id] }

  // ---- helpers the events use
  r(a, b) { return R(this.rng, a, b) }
  ri(a, b) { return a + Math.floor(this.rng() * (b - a + 1)) }
  act(name, ...args) {
    const f = this.A && this.A[name]; if (typeof f !== 'function') return undefined
    try { return f(...args) } catch (err) { if (!this._warned) this._warned = new Set(); if (!this._warned.has(name)) { this._warned.add(name); try { console.warn('director: action ' + name + ' threw', err) } catch (e) { /* no console */ } } return undefined }
  }
  play(name, pos, vol = 1) { return this.act('playAt', name, pos ? pos.slice() : null, vol) || null }
  say(lines) { if (lines && lines.length) this.act('say', lines) }
  spike(k, why) { this.act('fearSpike', k, why) }
  quiet(sec) { this.ownQuiet = Math.max(this.ownQuiet, this.t + sec + 0.5); this.act('quiet', sec) }
  once(key) { if (this.said.has(key)) return false; this.said.add(key); return true }
  nextOf(key, list) { if (this.cyc[key] == null) this.cyc[key] = Math.floor(this.rng() * list.length); const l = list[this.cyc[key] % list.length]; this.cyc[key]++; return l }
  at(sec, fn, keep = false) { this.q.push({ at: this.t + sec, fn, keep, ev: this.ev }) }
  frame(fn) { if (this.ev) this.ev.frame = fn }
  watch(sec, fn) { this.watchers.push({ until: this.t + sec, fn }) }
  /** This event carries on by itself now (its frame hook and steps still run) and lets others happen meanwhile. */
  background(hush = 20) { const ev = this.ev; if (!ev || ev.bg || ev.over) return; ev.bg = true; this.bg.push(ev); this.quietAfter(hush, BY_ID[ev.id].fam) }
  /** The silence after one: everything waits it out (your own head less, the more tired you are); the dread also keeps
   *  its own, so a run of hallucinations can't keep resetting the mountain's clock and starve it. */
  quietAfter(hush, fam) {
    if (this.t + hush > this.endT + this.hush) { this.endT = this.t; this.hush = hush }
    if (fam === 'dread' && this.t + hush > this.dEndT + this.dHush) { this.dEndT = this.t; this.dHush = hush }
  }
  ph(kind, pos, face, pose) { const h = this.act('spawnPhantom', kind, pos ? pos.slice() : null, face ? face.slice() : null, pose) || null; if (h && this.ev) this.ev.phantoms.push(h); return h }
  unph(h) { if (!h) return; try { h.remove() } catch (e) { /* already gone */ } if (this.ev) this.ev.phantoms = this.ev.phantoms.filter((x) => x !== h) }
  lids(keys) { const t = this.t, k0 = this.lidAt(this.lidEv, t); this.lidEv = [[t, k0], ...keys.map(([dt, k]) => [t + dt, k])] }
  ground(x, z, fb = 0) { const h = this.W.heightAt ? this.W.heightAt(x, z) : null; return Number.isFinite(h) ? h : fb }
  look(c, p, deg) { const v = sub(p, c.eye), l = Math.hypot(v[0], v[1], v[2]) || 1; return (v[0] * c.fwd[0] + v[1] * c.fwd[1] + v[2] * c.fwd[2]) / l > Math.cos(deg * Math.PI / 180) }
  dot(c, p) { const v = flat(sub(p, c.eye)); return v[0] * c.fh[0] + v[2] * c.fh[2] }
  behind(c, d, side = 0, up = 0) { return [c.eye[0] - c.fh[0] * d - c.fh[2] * side, c.eye[1] + up, c.eye[2] - c.fh[2] * d + c.fh[0] * side] }
  around(c, d) { const a = this.r(0, 6.283); return [c.eye[0] + Math.cos(a) * d, c.eye[1] - 1.5, c.eye[2] + Math.sin(a) * d] }
  cornerBehind(c) { const C = this.W.cab, cs = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [C[0] + a * 1.5, C[1], C[2] + b * 1.5]); return cs.reduce((b, p) => (this.dot(c, p) < this.dot(c, b) ? p : b)) }
  landing() { const h = this.W.hatch; return h ? [h[0], h[1] - 1.2, h[2]] : add(lerp3(this.W.stairFoot, this.W.door, 0.94), [0, -1.5, 0]) }
  tonight() { return this.nTonight }
  awayFromCab(c) { return !c.inCab && this.cabLeftAt != null && c.t - this.cabLeftAt >= 45 && (c.eye[1] < 25 || dist2d(c.eye, this.W.cab) > 8) }
  done(after = null) {
    const ev = this.ev; if (!ev || ev.over) return
    ev.over = true
    for (const h of ev.phantoms) { try { h.remove() } catch (e) { /* gone */ } }
    ev.phantoms = []
    this.q = this.q.filter((s) => s.ev !== ev || s.keep)   // its pending steps go with it (clean-ups stay)
    this.ev = null; if (ev.bg) this.bg = this.bg.filter((b) => b !== ev)
    const def = BY_ID[ev.id], t = this.t
    // the hush after it (shorter from night 2; the tired head cuts it short for its own things: see wait())
    this.quietAfter(after != null ? after : this.r(def.after[0], def.after[1]) * (def.fam === 'dread' && (this.nightN || 0) >= 2 ? DIR.hush2 : 1), def.fam)
    if (def.fam === 'dread') this.nextDread = Math.max(this.nextDread, t + this.dreadGap())
    if (def.fam === 'hallu') this.nextHallu = t + this.halluGap(this.c ? this.c.lh : 0)
    if (def.fam === 'sleepy') this.nextSleepy = t + this.sleepyGap(this.c ? this.c.level : 0)
  }
  dreadGap() { const n = Math.max(1, this.nightN || 1), g = DIR.dreadGap[Math.min(1, n - 1)], k = Math.pow(0.85, Math.max(0, n - 2)); return this.r(g[0], g[1]) * k }
  halluGap(lh) { const k = clamp((lh - DIR.mild) / (1 - DIR.mild)); return lerp(DIR.halluGap[0], DIR.halluGap[1], k) * this.r(0.7, 1.3) }
  sleepyGap(L) { const k = clamp((L - DIR.microAt) / (1 - DIR.microAt)); return lerp(DIR.microGap[0], DIR.microGap[1], k) * this.r(0.7, 1.3) }
  lidAt(keys, t) {
    if (!keys.length) return 0
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return a + (b - a) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1) }
    return keys[keys.length - 1][1]
  }

  // ---- the frame
  update(dt, ctx, actions = {}) {
    this.A = actions
    const c = this.derive(dt, ctx), t = c.t
    this.t = t
    this.book(c)
    const scripted = !!ctx.quiet && !(t < this.ownQuiet)
    const hold = !!ctx.busy || scripted
    if (hold) {   // freeze: every clock, every pending step (clean-ups still run), the eyelids
      this.endT += dt; this.dEndT += dt; this.lastT += dt; this.nextDread += dt; this.nextHallu += dt; this.nextSleepy += dt
      for (const s of this.q) if (!s.keep) s.at += dt
      for (const k of this.lidEv) k[0] += dt
      this.lidSym = []
    }
    // steps that are due (in time order; a step may schedule more)
    for (let guard = 0; guard < 64; guard++) {
      let bi = -1; for (let i = 0; i < this.q.length; i++) { const s = this.q[i]; if (s.at <= t && (!hold || s.keep) && (bi < 0 || s.at < this.q[bi].at)) bi = i }
      if (bi < 0) break
      const s = this.q.splice(bi, 1)[0]
      if (s.ev && s.ev.over && !s.keep) continue
      const prev = this.ev; this.ev = s.ev || prev   // the step runs as part of its own event (a clean-up of a finished one too)
      try { s.fn(c) } catch (err) { try { console.warn('director: step failed', err) } catch (e) { /* ok */ } }
      this.ev = prev && !prev.over && !prev.bg ? prev : null
    }
    if (!hold) {
      for (const ev of [this.ev, ...this.bg]) {
        if (!ev || ev.over) continue
        const prev = this.ev; this.ev = ev
        if (ev.frame) { try { ev.frame(dt, c) } catch (err) { try { console.warn('director: event failed', err) } catch (e) { /* ok */ } this.done() } }
        if (!ev.over && t - ev.t0 > 240) this.done()   // nothing lasts this long: a safety net
        this.ev = prev && !prev.over && !prev.bg ? prev : null
      }
      this.watchers = this.watchers.filter((w) => t < w.until && !w.fn(c))
    }
    this.body(dt, c, hold)
    // past wrecked the clock runs toward the collapse whatever else is going on (it doesn't wait for a hush)
    if (!hold) { if (c.fatigue && c.level >= DIR.collapseAt && !c.chase) this.collapseT += dt; else this.collapseT = Math.max(0, this.collapseT - dt * 2) }
    if (hold || this.ev) return
    // ---- what next
    if (c.night) {   // the dread countdown: stalls while you're scared, hurries when you've been calm a long while
      if (c.fear > DIR.scaredHold) this.nextDread += dt
      else if (this.calmFor > DIR.calmAfter) this.nextDread -= dt * (DIR.calmBoost - 1)
    }
    if (this.forced) { const id = this.forced; this.forced = null; if (this.start(BY_ID[id], c)) return }
    if (this.collapseT >= DIR.collapseHold && t >= this.lastT + DIR.minGap && (this.count.collapse || 0) < BY_ID.collapse.max && this.start(BY_ID.collapse, c)) { this.collapseT = 0; return }
    if (t < this.lastT + DIR.minGap || t < this.endT + 5) return
    const F = c.fatigue
    const sleepy = F && (c.level >= DIR.microAt || c.woozy)
    if (!sleepy) this.nextSleepy = Math.max(this.nextSleepy, t + this.sleepyGap(DIR.microAt) * 0.5)
    const lhOK = c.lh >= DIR.mild
    if (!lhOK) this.nextHallu = Math.max(this.nextHallu, t + this.halluGap(DIR.mild) * 0.5)   // it creeps up on you
    // the hush after the last one holds everything; the more tired you are the less of it your own head waits out
    const kH = clamp((c.lh - DIR.mild) / (1 - DIR.mild)), kS = clamp((c.level - DIR.microAt) / (1 - DIR.microAt))
    const hushed = (k) => t < this.endT + this.hush * (1 - 0.75 * k)
    const due = []
    if (sleepy && t >= this.nextSleepy && !hushed(kS)) due.push(['sleepy', t - this.nextSleepy])
    if (lhOK && t >= this.nextHallu && !hushed(kH)) due.push(['hallu', t - this.nextHallu])
    const dreadHushed = t < this.dEndT + this.dHush || (this.lastFam !== 'dread' && t < this.endT + 15) || (this.lastFam === 'dread' && hushed(0))
    if (c.night && t >= this.nextDread && !dreadHushed && !c.chase && c.bear < 0.3) due.push(['dread', t - this.nextDread])
    if (!due.length) return
    // fair: the one kept waiting longest goes first (the one that went last, last), so none starves the others
    due.sort((a, b) => (a[0] === this.lastFam) - (b[0] === this.lastFam) || b[1] - a[1])
    for (const [fam] of due) {
      if (this.pick(fam, c)) return
      if (fam === 'dread') this.nextDread = t + 6; else if (fam === 'hallu') this.nextHallu = t + 8; else this.nextSleepy = t + 8
    }
  }
  /** Choose one of a family that can happen here, now, and start it. */
  pick(fam, c) {
    const n = this.nightN || 0
    let pool = []
    for (const e of EVENTS) {
      if (e.fam !== fam || e.id === this.lastId || e.id === 'collapse' || this.bg.some((b) => b.id === e.id)) continue
      const max = typeof e.max === 'function' ? e.max(n) : e.max
      if ((this.count[e.id] || 0) >= max) continue
      if (fam === 'dread' && !c.night) continue
      let w = e.w(c, this)
      if (!(w > 0)) continue
      if (fam === 'hallu') {
        const need = [DIR.mild, DIR.moderate, DIR.severe][e.tier]
        if (c.lh < need) continue
        if (e.tier === 2 && (c.blocks || c.chase || c.bear >= 0.3)) continue   // the pill, a real chase, the bear: never the dangerous ones
        if (e.tier >= 1 && c.chase && e.id !== 'figure') continue
        w *= e.tier === 0 ? 1 : e.tier === 1 ? 0.6 + 1.6 * clamp((c.lh - DIR.moderate) / (1 - DIR.moderate)) : 0.5 + 2 * clamp((c.lh - DIR.severe) / (1 - DIR.severe))
      }
      pool.push([e, w])
    }
    while (pool.length) {
      let sum = 0; for (const [, w] of pool) sum += w
      let r = this.rng() * sum, i = 0
      for (; i < pool.length - 1; i++) { r -= pool[i][1]; if (r <= 0) break }
      const [e] = pool.splice(i, 1)[0]
      if (this.start(e, c)) return true
    }
    return false
  }
  start(e, c) {
    if (!e) return false
    const ev = { id: e.id, t0: this.t, frame: null, phantoms: [], over: false }
    const prev = this.ev; this.ev = ev
    let ok = false
    try { ok = e.go(c, this) !== false } catch (err) { try { console.warn('director: ' + e.id + ' failed to start', err) } catch (x) { /* ok */ } ok = false }
    if (!ok) {   // couldn't happen here after all: take back anything it put out
      for (const h of ev.phantoms) { try { h.remove() } catch (x) { /* gone */ } }
      this.q = this.q.filter((s) => s.ev !== ev); this.ev = prev; return false
    }
    if (this.ev === ev && (ev.over || ev.bg)) this.ev = null
    this.count[e.id] = (this.count[e.id] || 0) + 1; if (e.fam === 'dread') this.nTonight++
    if (e.fam === 'dread' && c.fatigue && c.fatigue.suppress > 0.9 && this.once('pillStill')) { const t0 = this.t; this.watch(90, (c2) => (c2.t >= t0 + 7 ? (this.say(LINES.pillStill), true) : false)) }   // the pill doesn't stop what's real
    this.lastId = e.id; this.lastFam = e.fam; this.lastT = this.t
    this.log.push({ t: this.t, id: e.id, fam: e.fam, tier: e.tier ?? null, phase: this.period, level: c.level, lh: c.lh })
    return true
  }
  /** The night / day we're in: caps and the first-event delay are per period. */
  book(c) {
    if (c.phase === this.period) return
    this.period = c.phase; this.nightN = c.nightN; this.count = {}; this.nTonight = 0
    this.nextDread = c.night ? c.t + DIR.firstDread + this.r(0, 30) : 1e9
  }
  derive(dt, ctx) {
    const phase = ctx.phase || 'day1', night = /^night/.test(phase), nightN = night ? (parseInt(phase.slice(5), 10) || 1) : 0
    const eye = ctx.eye || [0, 1.65, 0], fwd = ctx.fwd || [0, 0, -1], zone = ctx.zone || 'trail', inCab = zone === 'cab'
    const F = ctx.fatigue || null
    const speed = ctx.speed || 0
    this.stillFor = speed < 0.25 ? this.stillFor + dt : 0
    this.calmFor = (ctx.fear || 0) < 0.15 ? this.calmFor + dt : 0
    if (this._zone === 'cab' && !inCab) this.cabLeftAt = ctx.t; if (inCab) this.cabLeftAt = null; this._zone = zone
    const dog = ctx.dog || null
    return this.c = {
      ...ctx, phase, night, nightN, eye, fwd, fh: flat(fwd), zone, inCab, mode: ctx.mode || 'walk', speed, stillFor: this.stillFor,
      yaw: ctx.yaw || 0, pitch: ctx.pitch || 0, fear: ctx.fear || 0, bear: ctx.bear || 0, t: ctx.t || 0,
      level: F ? F.level : 0, lh: F ? F.halluLevel : 0, blocks: !!(F && F.blocksDanger), woozy: !!(F && F.woozy > 0), fatigue: F,
      chase: CHASE.has(ctx.weeper), inDark: night && !ctx.flashlight && !(inCab && ctx.lamp),
      dogNear: !!(dog && dog.tamed && dog.pos && dist(dog.pos, eye) < 10), dog,
    }
  }

  // ---- the body: blinks, yawns, drift, nods, grey-outs; and the eyelids out to the game
  body(dt, c, hold) {
    const t = c.t, L = c.level, walk = c.mode === 'walk'
    if (!hold && !c.resting) {
      // heavy blinks: more often, slower to open, the more tired you are
      if (L >= DIR.blinkAt) {
        const k = clamp((L - DIR.blinkAt) / (1 - DIR.blinkAt))
        if (t >= this.blinkAt) {
          if (this.blinkAt > 0) {
            const close = 0.08 + 0.05 * k, h = 0.05 + 0.4 * k * k, open = 0.12 + 0.25 * k
            this.lidSym = [[t, 0], [t + close, 1], [t + close + h, 1], [t + close + h + open, 0]]
            if (k > 0.7 && this.rng() < 0.3) this.lidSym.push([t + close + h + open + 0.1, 0], [t + close * 2 + h + open + 0.1, 0.9], [t + close * 2 + h + open * 2 + 0.2, 0])
            if (this.nodAcc < -0.1) { this.act('look', 0, -this.nodAcc); this.spike(0.08, 'jerk'); this.nodAcc = 0; this.stillFor = 0 }   // the hypnic jerk
          }
          this.blinkAt = t + lerp(12, 3, k) * this.r(0.6, 1.4)
        }
      } else this.blinkAt = t + 3
      // yawns
      if (L >= DIR.yawnAt) {
        if (t >= this.yawnAt) {
          if (this.yawnAt > 0) { this.play('yawn', null, 0.7); this.lidSym = [[t + 0.8, 0], [t + 1.3, 0.45], [t + 2.2, 0.45], [t + 2.8, 0]] }   // eyes squeezed, watering
          this.yawnAt = t + lerp(150, 50, clamp((L - DIR.yawnAt) / (1 - DIR.yawnAt))) * this.r(0.7, 1.3)
        }
      } else this.yawnAt = t + 20
      // two pills: grey-outs
      if (c.woozy) {
        if (t >= this.greyAt) { if (this.greyAt > 0) { const h = this.r(0.6, 1.2); this.lidSym = [[t, 0], [t + 0.5, this.r(0.75, 1)], [t + 0.5 + h, 0.8], [t + 1.2 + h, 0]] } this.greyAt = t + this.r(18, 40) }
      } else this.greyAt = t + 5
      // the view drifts (a slow wander you have to keep correcting), and standing still the head sinks
      let a = smooth((L - DIR.driftAt) / (1 - DIR.driftAt)); if (c.woozy) a = Math.max(a, 0.9)
      if (a > 0 && walk) {
        if ((this.driftT -= dt) <= 0) { this.driftT = this.r(1.5, 3); this.ty = this.r(-1, 1) * 0.05 * a; this.tp = this.r(-1, 1) * 0.03 * a }
        this.dy += (this.ty - this.dy) * Math.min(1, dt * 1.5); this.dp += (this.tp - this.dp) * Math.min(1, dt * 1.5)
        this.nod = L >= DIR.nodAt && this.stillFor > 5 && c.pitch > -0.9 ? -0.04 * a : 0
        this.nodAcc += this.nod * dt
        const y = this.dy * dt, p = (this.dp + this.nod) * dt
        if (Math.abs(y) + Math.abs(p) > 1e-7) this.act('look', y, p)
      } else { this.dy = this.dp = 0; if (!walk) this.nodAcc = 0 }
    }
    // the eyelids: max of the body's and the events'; out every frame while shut at all, once more when they open
    if (this.lidEv.length && t > this.lidEv[this.lidEv.length - 1][0] && !hold) this.lidEv = this.lidEv[this.lidEv.length - 1][1] > 0 ? [[t, this.lidEv[this.lidEv.length - 1][1]]] : []
    if (this.lidSym.length && t > this.lidSym[this.lidSym.length - 1][0]) this.lidSym = []
    const k = hold ? 0 : Math.max(this.lidAt(this.lidEv, t), this.lidAt(this.lidSym, t))
    if (k > 0.001) { this.act('lids', Math.min(1, k)); this.lidOut = k } else if (this.lidOut > 0) { this.act('lids', 0); this.lidOut = 0 }
  }
  /** Drop everything that's out (death, a new phase, a load): phantoms gone, eyelids open, nothing pending. */
  clear(actions = this.A) {
    this.A = actions || this.A
    for (const ev of [this.ev, ...this.bg]) if (ev) for (const h of ev.phantoms) { try { h.remove() } catch (e) { /* gone */ } }
    this.ev = null; this.bg = []
    this.q = []; this.watchers = []; this.lidEv = []; this.lidSym = []
    if (this.lidOut > 0) { this.act('lids', 0); this.lidOut = 0 }
    this.period = null; this.endT = -1e9; this.hush = 0; this.dEndT = -1e9; this.dHush = 0; this.collapseT = 0; this.forced = null
  }
  /** What's worth keeping in a save: the lines already said, where the radio's up to. */
  toJSON() { return { said: [...this.said], cyc: { ...this.cyc } } }
  restore(s = {}) { this.said = new Set(s.said || []); this.cyc = { ...(s.cyc || {}) }; return this }
}
