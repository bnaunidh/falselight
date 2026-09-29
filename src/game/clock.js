// Clock and phases. Nights run past 24 (02:00 = 26.0) so the hour is monotonic inside a phase.
// A day and a night each take about 12 real minutes. "Gates" hold the clock at a time until the
// phase's required work is done, so the player can never be pushed past something unfinished.
import { clamp } from './util.js?v=d92670d68201cefe'

export const PHASE_ORDER = ['day1', 'night1', 'day2', 'night2', 'day3', 'night3', 'day4', 'night4', 'day5', 'night5', 'day6', 'night6', 'day7', 'end']
const DAYS = [null, ['Tuesday', 9, 'Tues.'], ['Wednesday', 10, 'Wed.'], ['Thursday', 11, 'Thurs.'], ['Friday', 12, 'Fri.'], ['Saturday', 13, 'Sat.'], ['Sunday', 14, 'Sun.'], ['Monday', 15, 'Mon.']]
export const PHASES = {
  day1:   { kind: 'day',   day: 1, start: 10 + 40 / 60, end: 20.5, real: 720, date: 'Tuesday, August 9, 1983',    short: 'Tues. Aug 9' },
  night1: { kind: 'night', day: 1, start: 20.5,         end: 29.5, real: 720, date: 'Night of Tuesday, August 9',  short: 'Tues. night' },
  end:    { kind: 'day',   day: 8, start: 6.0,          end: 30,   real: 99999, date: 'Tuesday, August 16, 1983', short: 'Tues. Aug 16' },
}
for (let d = 2; d <= 6; d++) {   // the rest of the week: the same day and night, and every one of them worse
  const [name, date, short] = DAYS[d]
  PHASES['day' + d] = { kind: 'day', day: d, start: 7.5, end: 20.5, real: 720, date: `${name}, August ${date}, 1983`, short: `${short} Aug ${date}` }
  PHASES['night' + d] = { kind: 'night', day: d, start: 20.5, end: 29.5, real: 720, date: `Night of ${name}, August ${date}`, short: `${short} night` }
}
// the last day: the fire comes over the ridge in the morning. From 07:00 you have until about 11:00 (≈10 real minutes) to get down
PHASES.day7 = { kind: 'day', day: 7, start: 7.0, end: 11.0, real: 600, date: 'Monday, August 15, 1983', short: 'Mon. Aug 15', evac: true }
/** Which day or night of the week a phase is (day3 → 3, night5 → 5). */
export const phaseNum = (p) => (PHASES[p] ? PHASES[p].day : 0)
export const nextPhase = (p) => PHASE_ORDER[Math.min(PHASE_ORDER.length - 1, PHASE_ORDER.indexOf(p) + 1)]
export const isNight = (p) => PHASES[p] && PHASES[p].kind === 'night'

export class Clock {
  constructor(phase = 'day1', hour = null) { this.set(phase, hour) }
  set(phase, hour = null) {
    this.phase = phase
    const d = PHASES[phase]
    this.hour = hour ?? d.start
    this.rate = (d.end - d.start) / d.real // game hours per real second
    this.speed = 1                          // script may fast-forward (x8) through empty stretches
    this.gates = []                         // [{ at, open: () => bool, id }]
    this.held = null
  }
  get def() { return PHASES[this.phase] }
  get progress() { return clamp((this.hour - this.def.start) / (this.def.end - this.def.start)) }
  get ended() { return this.hour >= this.def.end - 1e-6 }
  addGate(id, at, open) { this.gates = this.gates.filter((g) => g.id !== id); this.gates.push({ id, at, open }) }
  /** Advance by dt real seconds; returns the hour range crossed [from, to]. */
  tick(dt) {
    const from = this.hour
    let to = from + this.rate * this.speed * dt
    this.held = null
    for (const g of this.gates) {
      if (from <= g.at && to > g.at && !g.open()) { to = g.at; this.held = g.id }
      else if (Math.abs(from - g.at) < 1e-9 && !g.open()) { to = from; this.held = g.id }
    }
    this.hour = Math.min(to, this.def.end)
    return [from, this.hour]
  }
  /** Jump straight to an hour (debug / skip). */
  setHour(h) { this.hour = clamp(h, this.def.start, this.def.end) }
}

/** Minutes of real time until the clock reaches hour h at the current rate. */
export const realSecondsUntil = (clock, h) => Math.max(0, (h - clock.hour) / (clock.rate * clock.speed))
