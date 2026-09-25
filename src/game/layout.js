// Normalises either ENV's exports/data/layout.json or the docs/layout_plan.json fallback into one
// shape the rules use. Pure: pass heightAt(x, z) to fill y when the source is 2-D.
import { P, Polyline, fromBearing, dist2d, bearing } from './util.js'

const joinRoutes = (...lists) => {
  const out = []
  for (const l of lists) for (const p of l) { if (!out.length || dist2d(out[out.length - 1], p) > 0.05) out.push(p) }
  return out
}

export function normalizeLayout(raw = {}, heightAt = null) {
  const hy = (p) => {
    const q = P(p)
    const is2d = Array.isArray(p) ? p.length === 2 : (p && (p.xz || (typeof p.x === 'number' && p.y == null)))
    if ((is2d || q[1] === 0) && heightAt) { const h = heightAt(q[0], q[2]); if (Number.isFinite(h)) q[1] = h }
    return q
  }
  const out = { raw, places: {}, zones: [], routes: {}, hikerRoutes: {}, treeLine: [], fireSites: [], ravine: null, source: raw.trail && raw.trail.points ? 'layout' : 'plan' }

  // places
  const places = raw.places || {}
  for (const [k, v] of Object.entries(places)) out.places[k] = hy(v && (v.xz || v.pos || v.position || v.center || v))
  for (const [k, v] of Object.entries(raw.junctions || {})) out.places[k] = hy(v)
  if (!out.places.tower) out.places.tower = [0, heightAt ? heightAt(0, 0) : 0, 0]

  // zones
  if (Array.isArray(raw.zones)) out.zones = raw.zones.map((z) => ({ name: z.name, center: hy(z.center || z.pos || z.xz), radius: z.radius }))
  else for (const [k, v] of Object.entries(places)) if (v && v.zoneRadius) out.zones.push({ name: k, center: out.places[k], radius: v.zoneRadius })

  // named route segments (plan) — ENV may also provide them under trail.segments / routes
  const segs = raw.route || raw.routes || (raw.trail && raw.trail.segments) || []
  const segList = Array.isArray(segs) ? segs : Object.entries(segs).map(([name, via]) => ({ name, via }))
  for (const seg of segList) {
    const pts = (seg.via || seg.points || []).map(hy)
    if (pts.length >= 2) out.routes[seg.name] = pts
  }
  const R = (n) => out.routes[n] || []
  const rev = (n) => R(n).slice().reverse()

  // the full trail (ENV) or a join of all segments (plan)
  if (raw.trail && Array.isArray(raw.trail.points) && raw.trail.points.length > 1) out.trail = new Polyline(raw.trail.points.map(hy))
  else out.trail = new Polyline(joinRoutes(R('tower_to_J1'), R('J1_to_creek'), R('creek_to_J2'), R('J2_to_trailhead')).concat().length ? joinRoutes(R('tower_to_J1'), R('J1_to_creek'), R('creek_to_J2'), R('J2_to_trailhead')) : [[0, 0, 0], [0, 0, 1]])
  out.trailHalfWidth = (raw.trail && raw.trail.halfWidth) || 1.1

  // main line (tower gate -> trailhead) — used for walking, chase paths and the map
  out.mainLine = new Polyline(joinRoutes(R('tower_to_J1'), R('J1_to_creek'), R('creek_to_J2'), R('J2_to_trailhead')).length > 1
    ? joinRoutes(R('tower_to_J1'), R('J1_to_creek'), R('creek_to_J2'), R('J2_to_trailhead')) : out.trail.points)

  // hiker routes
  const hr = raw.hikerRoutes || {}
  const asLine = (v) => (Array.isArray(v) && v.length > 1 && (Array.isArray(v[0]) || typeof v[0] === 'object') ? v.map(hy) : null)
  let n1 = asLine(hr.night1) || asLine(hr.night1 && hr.night1.points)
  if (!n1) {
    const burn = out.places.burn_scar || hy([-158, 22])
    n1 = joinRoutes([burn], rev('loop_camp_to_burn'), rev('loop_J2_to_camp'), R('J2_to_trailhead'))
    if (n1.length < 3) n1 = [burn, out.places.hikers_camp || hy([-118, 150]), out.places.J2 || hy([30, 262]), out.places.trailhead || hy([22, 380])]
  }
  out.hikerRoutes.night1 = new Polyline(n1)
  let fl = asLine(hr.night2_false_light) || asLine(hr.night2_false_light && hr.night2_false_light.points)
  if (!fl) {
    const ov = out.places.ravine_overlook || hy([78, 28])
    const rim = hy([ov[0] + 18, ov[2] - 6])
    fl = joinRoutes([rim], rev('spur_overlook').length ? rev('spur_overlook') : [ov, hy([40, 20]), hy([6, 18])], [out.places.gate || hy([0, 6])])
  }
  out.hikerRoutes.night2_false_light = new Polyline(fl)

  // tree line: the Lost Hiker's stepping stones, ordered far -> near, ending short of the gate
  const tower = out.places.tower, gate = out.places.gate || hy([0, 6])
  let tl = Array.isArray(raw.treeLine) ? raw.treeLine.map((t) => hy(t && (t.pos || t.position || t))) : []
  if (tl.length < 3) {
    tl = [[200, 46], [191, 40], [182, 34], [174, 28], [168, 22], [176, 16]].map(([b, d]) => hy(fromBearing(tower, b, d).filter((_, i) => i !== 1)))
  }
  tl.sort((a, b) => dist2d(b, gate) - dist2d(a, gate))
  out.treeLine = tl
  out.gate = gate

  // fire sites
  const fs = raw.fireSites || []
  out.fireSites = fs.map((f) => ({ name: f.name, bearingDeg: f.bearingDeg ?? bearing(tower, P(f.pos)), distance: f.distance ?? 4000, y: f.y ?? 0 }))
  if (!out.fireSites.length) out.fireSites = [{ name: 'Cold Creek Basin', bearingDeg: 71, distance: 3900, y: 0 }]

  // weeper rock
  const wr = raw.weeperRock || (places.weeper_rock ? { pos: places.weeper_rock.xz } : null)
  if (wr) {
    const pos = hy(wr.pos || wr.position || wr.xz || wr)
    out.weeperRock = { pos: [pos[0], pos[1] + (wr.seatHeight ?? (wr.pos && wr.pos.length === 3 ? 0 : 1.1)), pos[2]], rotY: wr.rotY ?? null }
  } else out.weeperRock = { pos: hy([58, 196]), rotY: null }

  // ravine
  if (raw.ravine && raw.ravine.polygon) out.ravine = { polygon: raw.ravine.polygon }
  else if (raw.ravine && raw.ravine.centerline) {
    const c = raw.ravine.centerline, w = (raw.ravine.width || 28) / 2
    const left = [], right = []
    for (let i = 0; i < c.length; i++) {
      const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1
      left.push([c[i][0] - (dz / L) * w, c[i][1] + (dx / L) * w]); right.push([c[i][0] + (dz / L) * w, c[i][1] - (dx / L) * w])
    }
    out.ravine = { polygon: left.concat(right.reverse()), centerline: c }
  }
  out.creek = raw.creek && raw.creek.centerline ? raw.creek.centerline : null
  out.terrainRect = raw.terrainRect || { min: [-420, -420], max: [420, 520] }
  return out
}
