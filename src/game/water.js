// Water is carried in real vessels. Amounts are fractions of one canteen; contamination follows every transfer.
import { clamp } from './util.js?v=d92670d68201cefe'

export function fillFromSource(vessel, source) {
  if (!vessel || vessel.kind !== 'canteen') return false
  const hadWater = vessel.fill > 0.001
  vessel.raw = source === 'river' || (hadWater && !!vessel.raw)
  vessel.fill = 1
  return true
}

export function pourWater(from, to) {
  if (!from || !to || from === to || !(from.fill > 0) || to.heating || from.heating || from.brew === 'coffee' || to.brew === 'coffee') return 0
  const amount = Math.min(clamp(from.fill), 1 - clamp(to.fill || 0))
  if (amount < 0.001) return 0
  to.raw = !!from.raw || (to.fill > 0.001 && !!to.raw)
  to.fill = clamp((to.fill || 0) + amount)
  from.fill = clamp(from.fill - amount)
  if (from.fill < 0.001) { from.fill = 0; from.raw = false; from.brew = null }
  return amount
}

export function heatPot(pot, kind, coffee = null) {
  if (!pot || pot.kind !== 'pot' || !(pot.fill > 0) || pot.heating) return false
  if (kind === 'coffee') {
    if (pot.raw || pot.brew === 'coffee' || !coffee || !(coffee.n > 0)) return false
    coffee.n--
  } else if (kind !== 'water' || pot.brew === 'coffee') return false
  pot.heating = kind; pot.heatLeft = kind === 'coffee' ? 25 : 20
  return true
}

export function tickPot(pot, seconds, onStove) {
  if (!pot || !pot.heating || !onStove || !(seconds > 0)) return null
  pot.heatLeft = Math.max(0, (pot.heatLeft || 0) - seconds)
  if (pot.heatLeft > 1e-6) return null
  const done = pot.heating
  pot.heating = null; pot.heatLeft = 0; pot.raw = false; pot.brew = done === 'coffee' ? 'coffee' : null
  return done
}
