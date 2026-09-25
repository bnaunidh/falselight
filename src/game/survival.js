// Body and weather: air temperature (°F, the lookout is a 1983 Forest Service post), wind chill, the cab's own air,
// thirst and hunger. Pure. Rates are per GAME hour, so resting on the bed costs water and food like real hours do.
import { clamp } from './util.js?v=cec6e676'

export const SURV = {
  thirst: 1 / 16,       // a full water meter lasts 16 game hours
  hunger: 1 / 26,
  sip: 0.28,            // one pull on the canteen
  meal: 0.45,           // a tin of beans
  lowWater: 0.18, lowFood: 0.12,
}

/** Outside air at the lookout: August, ~6,000 ft in the Cascades. High ~65°F mid-afternoon, low ~42°F before dawn. */
export function outsideF({ hour = 12, y = 0, rain = 0, fog = 0 }) {
  const h = ((hour % 24) + 24) % 24
  const amp = 11.5 * (1 - 0.45 * rain - 0.2 * fog)                       // clouds flatten the day
  const base = 53.5 + amp * Math.cos(((h - 15.5) / 24) * Math.PI * 2)
  return base - 7 * rain - 2 * fog * (h > 7 && h < 19 ? 1 : 0) - y * 0.0118   // 3.6°F per 1,000 ft
}
/** NWS wind chill (valid for T <= 50°F and wind >= 3 mph). */
export function windChill(T, mph) {
  if (T > 50 || mph < 3) return T
  const v = Math.pow(mph, 0.16)
  return 35.74 + 0.6215 * T - 35.75 * v + 0.4275 * T * v
}

export class Survival {
  constructor(s = {}) {
    this.water = s.water ?? 0.9
    this.food = s.food ?? 0.8
    this.cabF = s.cabF ?? null
    this.wet = s.wet ?? 0
    this.warmth = s.warmth ?? 0   // a hot drink: fades over about an hour and a half
    this.airF = 55; this.feelsF = 55; this.warming = false; this.mph = 0
    this.warned = { ...(s.warned || {}) }
  }
  /** dtH: game hours. ctx: { hour, y, zone, rain, fog, wind (0..1), heater, open (windows), inWater, jog, nearHeater, night } */
  tick(dtH, ctx) {
    const ev = []
    const out = outsideF(ctx)
    // the cab: a glass box — sun warms it by day, the heater fights the windows
    if (this.cabF == null) this.cabF = out + 4
    const gain = ctx.night ? 0 : 6, loss = 0.9 * (1 + 1.5 * (ctx.open || 0))
    this.cabF += ((out + gain - this.cabF) * loss + (ctx.heater ? 20 : 0)) * Math.min(dtH, 0.5)
    const inCab = ctx.zone === 'cab'
    // wind: exposed up the tower, sheltered in the timber, none inside
    const high = ctx.zone === 'catwalk' || (ctx.zone === 'stairs' && ctx.y > 12)
    this.mph = inCab ? 0 : (ctx.wind || 0) * 22 * (high ? 1.25 + ctx.y / 90 : ctx.zone === 'trail' ? 0.45 : 0.7)
    // getting wet (wading the creek, rain) and drying (fast by the heater)
    if (ctx.inWater) this.wet = Math.min(1, this.wet + dtH * 6)
    else if (!inCab && ctx.rain > 0.05) this.wet = Math.min(0.6, this.wet + ctx.rain * dtH * 0.8)
    else this.wet = Math.max(0, this.wet - dtH * (inCab ? (ctx.heater ? 1.2 : 0.4) : 0.2))
    this.airF = inCab ? this.cabF : out
    this.warmth = Math.max(0, this.warmth - dtH * 0.7)
    this.feelsF = (inCab ? this.cabF + (ctx.nearHeater && ctx.heater ? 5 : 0) : windChill(out, this.mph)) - 9 * this.wet + 7 * this.warmth
    this.warming = inCab && ctx.heater && this.cabF > out + 3
    // thirst + hunger (worse jogging, or sweating in a hot cab)
    const hot = this.feelsF > 74 ? 1.4 : 1
    this.water = clamp(this.water - SURV.thirst * dtH * (ctx.jog ? 1.6 : 1) * hot)
    this.food = clamp(this.food - SURV.hunger * dtH * (ctx.jog ? 1.3 : 1))
    const once = (k, cond, reset) => { if (cond && !this.warned[k]) { this.warned[k] = true; ev.push(k) } else if (reset) this.warned[k] = false }
    once('thirsty', this.water < SURV.lowWater, this.water > SURV.lowWater + 0.1)
    once('hungry', this.food < SURV.lowFood, this.food > SURV.lowFood + 0.1)
    once('freezing', this.feelsF < 36, this.feelsF > 42)
    return ev
  }
  /** How cold your body gets (feeds the shiver / stiff hands model). */
  get coldTarget() { return clamp((52 - this.feelsF) / 22) }
  /** 1 = fine, lower = you're running on empty (slower, no jogging at 0). */
  get vigor() { return clamp(Math.min(this.water / SURV.lowWater, this.food / SURV.lowFood, 1) * 0.3 + 0.7) }
  drink(amount) { this.water = clamp(this.water + amount) }
  eat(amount) { this.food = clamp(this.food + amount) }
  get icon() { return this.warming || this.warmth > 0.3 || this.feelsF >= 66 ? 'fire' : this.feelsF < 40 ? 'snow' : 'therm' }
  toJSON() { return { water: this.water, food: this.food, cabF: this.cabF, wet: this.wet, warmth: this.warmth, warned: this.warned } }
}
