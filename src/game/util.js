// FALSE LIGHT — small pure helpers shared by the rules files (no three.js, no DOM).
// Points are plain arrays [x, y, z] in three.js metres (+x east, -z north, +y up).

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t) }
export const DEG = Math.PI / 180

/** Accept [x,y,z] | [x,z] | {x,y,z} | {pos|position|center:[...]} → [x,y,z]. */
export function P(v, yDefault = 0) {
  if (!v) return [0, yDefault, 0]
  if (Array.isArray(v)) return v.length === 2 ? [v[0], yDefault, v[1]] : [v[0], v[1] ?? yDefault, v[2]]
  if (typeof v.x === 'number') return [v.x, v.y ?? yDefault, v.z ?? 0]
  return P(v.pos || v.position || v.center || v.xz || v.p, yDefault)
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const len = (a) => Math.hypot(a[0], a[1], a[2])
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Compass bearing (0 = north = -z, 90 = east = +x) from a to b, degrees 0..360. */
export function bearing(a, b) {
  const dx = b[0] - a[0], dz = b[2] - a[2]
  return norm360(Math.atan2(dx, -dz) / DEG)
}
export const norm360 = (d) => ((d % 360) + 360) % 360
/** Smallest signed difference a - b in degrees (-180..180]. */
export function angDiff(a, b) { let d = norm360(a - b); if (d > 180) d -= 360; return d }
/** Point at compass bearing and horizontal distance from origin o. */
export function fromBearing(o, deg, d, y = o[1]) {
  return [o[0] + Math.sin(deg * DEG) * d, y, o[2] - Math.cos(deg * DEG) * d]
}

export function fmtHour(h) {
  h = ((h % 24) + 24) % 24
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60)
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}
/** "Mountain" hours: 20.5 → 20:30, 26.0 → 02:00 (nights run past 24 so they compare monotonically). */
export const dayHour = (h) => ((h % 24) + 24) % 24

/** Polyline helper: cumulative lengths, sample at s, nearest point. */
export class Polyline {
  constructor(points) {
    this.points = points.map((p) => P(p))
    this.cum = [0]
    for (let i = 1; i < this.points.length; i++) this.cum.push(this.cum[i - 1] + dist2d(this.points[i - 1], this.points[i]))
    this.length = this.cum[this.cum.length - 1] || 0
  }
  at(s) {
    const pts = this.points
    if (pts.length === 1 || s <= 0) return pts[0].slice()
    if (s >= this.length) return pts[pts.length - 1].slice()
    let lo = 0, hi = this.cum.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m }
    const seg = this.cum[hi] - this.cum[lo] || 1
    return lerp3(pts[lo], pts[hi], (s - this.cum[lo]) / seg)
  }
  /** Direction (unit, xz) at s. */
  dir(s) {
    const a = this.at(Math.max(0, s - 0.5)), b = this.at(Math.min(this.length, s + 0.5))
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1
    return [(b[0] - a[0]) / d, 0, (b[2] - a[2]) / d]
  }
  /** Nearest point in the xz plane, optionally restricted to [sMin, sMax]. */
  nearest(p, sMin = 0, sMax = Infinity) {
    let best = { dist: Infinity, s: 0, point: this.points[0] }
    for (let i = 1; i < this.points.length; i++) {
      if (this.cum[i] < sMin || this.cum[i - 1] > sMax) continue
      const a = this.points[i - 1], b = this.points[i]
      const abx = b[0] - a[0], abz = b[2] - a[2]
      const L2 = abx * abx + abz * abz || 1e-9
      let t = ((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / L2
      t = clamp(t)
      let s = this.cum[i - 1] + t * Math.sqrt(L2)
      if (s < sMin || s > sMax) { s = clamp(s, sMin, Math.min(sMax, this.length)); const q = this.at(s); const d = dist2d(p, q); if (d < best.dist) best = { dist: d, s, point: q }; continue }
      const q = lerp3(a, b, t)
      const d = dist2d(p, q)
      if (d < best.dist) best = { dist: d, s, point: q }
    }
    return best
  }
  reversed() { return new Polyline(this.points.slice().reverse()) }
  /** Resample so no segment is longer than step metres. */
  densify(step = 1) {
    const out = []
    const n = Math.max(1, Math.ceil(this.length / step))
    for (let i = 0; i <= n; i++) out.push(this.at((i / n) * this.length))
    return new Polyline(out)
  }
}

export function pointInPolygon(p, poly) {
  // poly: [[x,z]...] or [[x,y,z]...]; test in xz
  let inside = false
  const x = p[0], z = p[2]
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const ax = a[0], az = a.length === 2 ? a[1] : a[2], bx = b[0], bz = b.length === 2 ? b[1] : b[2]
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az || 1e-9) + ax) inside = !inside
  }
  return inside
}
