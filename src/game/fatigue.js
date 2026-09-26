// FALSE LIGHT — sleep, and what going without it does to you. Pure. Rates are per GAME hour (like survival.js), so a night
// at the lookout costs what a night costs, and the bed (14x time) pays it back quickly in real seconds.
//   · ~18 game hours awake takes you from rested to wrecked. Jogging, the cold, an empty stomach, a hot stuffy cab and CO
//     in the blood wear you down faster; sitting still slower.
//   · Coffee lifts you for about two hours (it hides some of the debt, it doesn't pay it), then the crash: a slice of what it
//     hid lands at once. Each cup inside a few hours lifts less. Coffee in you makes the bed work worse.
//   · The bed: a game hour asleep pays off ~3.2 hours (a full night, ~6 h, resets you); the first quarter hour you're only
//     lying there. A nap helps a bit. Collapsing on the floor (the director) is poor sleep.
//   · The pill (Tillman's prescription: chlorpromazine 25 mg): after ~20-40 min it holds the HALLUCINATIONS down for a few
//     hours (the fatigue ones and the CO ones) — never the real things: the Weeper, the bear, what the mountain does. It
//     costs: you're drowsier (it adds to what you feel and to the debt), slower, dulled. Two close together: woozy.
//
//   level       0 rested … 1 wrecked: what you FEEL (debt − coffee + sedation + woozy). Symptoms, speed, the HUD.
//   halluLevel  what your head does with it: level, pressed down hard by the pill. The director's hallucinations run on it.
//   rest        1 − level: the HUD's sleep ring (1 = rested, like water / food).
import { clamp, smooth } from './util.js?v=a148af98'

export const FAT = {
  wreck: 18,          // game hours awake: rested (0) → wrecked (1)
  start: 4.5,         // up at six, a long drive: 10:40 on day 1 is already 4.5 h of it
  max: 21,            // the debt stops growing here (being wrecked just goes on; the collapse is the director's)
  jog: 0.7, cold: 0.6, hot: 0.3, empty: 0.35, co: 0.9,   // extra hours of debt per hour (cold / co scale 0..1)
  sit: 0.55,          // sitting still (a bench, the catwalk chair): the debt grows at this rate
  sleep: 3.2,         // hours of debt one game hour in bed pays off
  settle: 0.25,       // the first quarter hour in bed you're only lying there: a third of the rate
  poorSleep: 0.8,     // the floor / the ground (sleep(h))
  // coffee: masks the debt, then the crash
  cafIn: 4,           // per game hour: it kicks in over ~15 min
  cafFade: 0.45,      // per game hour: a cup lasts about two hours
  cafLift: 0.28,      // how much of `level` a fresh cup hides (less for each cup inside ~6 h)
  crash: 1.4,         // hours of debt that come due as it wears off (scaled by how much it lifted)
  crashRate: 2.2,     // …landing at this many hours per hour (~40 min)
  // the pill
  pills: 6,           // in the bottle
  onset: 2.4,         // per game hour: gut → blood (half in ~17 min)
  clear: 0.22,        // per game hour: half-life ~3 h
  suppressAt: 0.55,   // blood level for full suppression (so: full for ~3 h, fading over the next ~4)
  squash: 0.72,       // at full suppression halluLevel = level × (1 − squash)
  dangerOff: 0.25,    // suppression above this blocks the dangerous hallucinations outright
  sedate: 0.2,        // added to `level` at full blood level (drowsy)
  drag: 0.6,          // extra debt per hour at full blood level
  woozyAt: 0.6,       // taking one while blood + gut is above this → woozy
  woozyH: 1.5,        // game hours of it (per surplus)
  warn: [0.5, 0.72, 0.9],
}

export class Fatigue {
  constructor(s = {}) {
    this.awake = s.awake ?? FAT.start      // the debt, in hours
    this.caf = s.caf ?? 0; this.cafGut = s.cafGut ?? 0; this.cups = s.cups ?? 0; this.cafPeak = s.cafPeak ?? 0; this.crashDue = s.crashDue ?? 0
    this.gut = s.gut ?? 0; this.drug = s.drug ?? 0; this.woozy = s.woozy ?? 0
    this.asleep = 0                        // game hours in bed this time (settling in)
    this.warned = { ...(s.warned || {}) }
    this.pillOn = !!s.pillOn; this.sleptFrom = 0
  }
  /** dtH: game hours. ctx: { resting, sitting, jog, coldTarget (0..1), feelsF, water, food, co (blood 0..1) } → events */
  tick(dtH, ctx = {}) {
    const ev = []
    if (!(dtH > 0)) return ev
    // coffee: gut → blood, fading; the crash when it's mostly gone
    const cin = this.cafGut * Math.min(1, FAT.cafIn * dtH); this.cafGut -= cin; this.caf = clamp(this.caf + cin - FAT.cafFade * dtH * (this.caf > 0 ? 1 : 0))
    this.cups = Math.max(0, this.cups - dtH / 6)
    if (this.cafPeak > 0 && this.caf < 0.2 && this.cafGut < 0.05) { this.crashDue += FAT.crash * this.cafPeak / FAT.cafLift; this.cafPeak = 0; ev.push('crash') }
    // the pill: gut → blood, cleared slowly
    const pin = this.gut * (1 - Math.exp(-FAT.onset * dtH)); this.gut -= pin; this.drug += pin; this.drug = Math.max(0, this.drug * Math.exp(-FAT.clear * dtH))
    this.woozy = Math.max(0, this.woozy - dtH)
    if (ctx.resting) {   // the bed pays it off (worse with coffee in you, or a freezing / sweltering cab)
      this.asleep += dtH
      const bad = (ctx.feelsF != null && (ctx.feelsF < 45 || ctx.feelsF > 80)) ? 0.6 : 1
      const pay = FAT.sleep * (this.asleep < FAT.settle ? 0.33 : 1) * (1 - 0.5 * this.caf) * bad * dtH
      if (!this.sleptFrom) this.sleptFrom = this.level
      this.awake = Math.max(0, this.awake - pay)
      this.crashDue = Math.max(0, this.crashDue - pay)   // you sleep the crash off too
    } else {
      if (this.asleep > 0 && this.sleptFrom > 0.5 && this.level < 0.2) ev.push('rested')
      this.asleep = 0; this.sleptFrom = 0
      const k = (ctx.sitting ? FAT.sit : 1) + (ctx.jog ? FAT.jog : 0) + FAT.cold * clamp(ctx.coldTarget || 0)
        + (ctx.feelsF != null && ctx.feelsF > 74 ? FAT.hot : 0) + ((ctx.water ?? 1) < 0.18 || (ctx.food ?? 1) < 0.12 ? FAT.empty : 0)
        + FAT.co * clamp((ctx.co || 0) / 0.6) + FAT.drag * clamp(this.drug)
      this.awake = Math.min(FAT.max, this.awake + k * dtH)
    }
    if (this.crashDue > 0 && this.caf < 0.3) { const c = Math.min(this.crashDue, FAT.crashRate * dtH); this.crashDue -= c; this.awake = Math.min(FAT.max, this.awake + c) }
    // the pill coming on / wearing off
    const sup = this.suppress
    if (!this.pillOn && sup > 0.9) { this.pillOn = true; ev.push('pill_on') }
    else if (this.pillOn && sup < 0.3) { this.pillOn = false; ev.push('pill_off') }
    // warnings, once each (they come back after you've slept below them)
    const L = this.level
    FAT.warn.forEach((w, i) => { const k = 'tired' + (i + 1); if (L >= w && !this.warned[k]) { this.warned[k] = true; if (!FAT.warn.some((w2, j) => j > i && L >= w2)) ev.push(k) } else if (L < w - 0.15) this.warned[k] = false })
    return ev
  }
  /** The debt as a fraction (no coffee, no pill): 0..1. */
  get tired() { return clamp(this.awake / FAT.wreck) }
  /** What you feel: 0 rested … 1 wrecked. */
  get level() {
    const lift = FAT.cafLift * smooth(this.caf / 0.6) / (1 + 0.6 * Math.max(0, this.cups - 1))   // tolerance: cups inside ~6 h
    return clamp(this.tired - lift + FAT.sedate * clamp(this.drug) + (this.woozy > 0 ? 0.12 : 0))
  }
  /** 0..1: how hard the pill is holding the hallucinations down right now. */
  get suppress() { return clamp(this.drug / FAT.suppressAt) }
  /** What the hallucinations run on. */
  get halluLevel() { return clamp(this.level * (1 - FAT.squash * this.suppress)) }
  /** The dangerous ones (panic, sleepwalking, the lure) can't happen while the pill has hold. */
  get blocksDanger() { return this.suppress > FAT.dangerOff }
  /** A CO hallucination gets through the pill with this chance: game code rolls it (see letsThrough). */
  letsThrough(rng = Math.random) { return rng() >= this.suppress * 0.9 }
  /** Dulled: 0..1 (the pill, or woozy). */
  get dulled() { return clamp(Math.max(clamp(this.drug) * 0.7, this.woozy > 0 ? 1 : 0)) }
  /** Walking speed multiplier: 1 → ~0.8 wrecked; the pill slows you a little more; woozy more. */
  get speedMul() { return (1 - 0.2 * smooth((this.level - 0.55) / 0.45)) * (1 - 0.1 * clamp(this.drug)) * (this.woozy > 0 ? 0.88 : 1) }
  get rest() { return 1 - this.level }
  get label() { const L = this.level; return L < 0.25 ? 'Rested' : L < 0.5 ? 'Awake' : L < 0.72 ? 'Tired' : L < 0.9 ? 'Exhausted' : 'Wrecked' }
  /** A cup of the stove coffee. Returns how much it lifted (0..cafLift). */
  coffee() {
    this.cups += 1; this.cafGut = Math.min(1.2, this.cafGut + 1)
    const lift = FAT.cafLift / (1 + 0.6 * Math.max(0, this.cups - 1)); this.cafPeak = Math.max(this.cafPeak, lift)
    return lift
  }
  /** Take one of the pills (the bottle's count is the item's: items.js takePill). → { woozy: bool } */
  pill() {
    const surplus = this.drug + this.gut
    this.gut += 1
    let woozy = false
    if (surplus > FAT.woozyAt) { this.woozy = Math.max(this.woozy, FAT.woozyH * (0.6 + surplus)); woozy = true }
    return { woozy }
  }
  /** Sleep that isn't the bed (collapsing, the phase change's sleep): hours of it. */
  sleep(hours, quality = FAT.poorSleep) { this.awake = Math.max(0, this.awake - Math.max(0, hours) * FAT.sleep * quality); this.crashDue = 0 }
  toJSON() {
    return { awake: this.awake, caf: this.caf, cafGut: this.cafGut, cups: this.cups, cafPeak: this.cafPeak, crashDue: this.crashDue, gut: this.gut, drug: this.drug, woozy: this.woozy,
      pillOn: this.pillOn, warned: { ...this.warned } }
  }
}
