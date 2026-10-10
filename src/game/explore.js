// FALSE LIGHT — exploring the woods for what the lookouts left (src/game/content/lore.js holds the places and papers).
// Pure rules, no three.js: what you find by walking, what you've heard of, which papers are there today, and the pencil
// marks on your map. All state lives in game flags as primitives or arrays copied on write (the snapshot copies flags shallow).
import { PLACES, DOCS, PLACE, DOC, FLAG_LEADS } from './content/lore.js?v=77480f56af567f9f';

/** Places you've just walked into (within their discover radius), not found before. */
export function discover(pos, flags) {
  const out = [];
  for (const p of PLACES) if (p.xz && p.r && !flags['place_' + p.id] && Math.hypot(pos[0] - p.xz[0], pos[2] - p.xz[1]) < p.r) out.push(p.id);
  return out;
}
/** Is this paper there for you right now? (gated by day, by what you've learned, and gone once taken) */
export function available(id, flags, day) {
  const d = DOC[id]; if (!d || flags['taken_' + id]) return false;
  if (d.fromDay && day < d.fromDay) return false;
  if (d.needs && !flags[d.needs]) return false;
  return true;
}
const filed = (flags) => flags.papers || [];
export const hasPaper = (flags, id) => filed(flags).some((x) => x.id === id);
/** Places you've heard of (a paper you filed points there, or something the game noticed) but haven't found: [{ place, name, from, quote }] */
export function heardOf(flags) {
  const out = [], seen = new Set();
  const add = (place, name, from, quote) => { if (!PLACE[place] || flags['place_' + place] || seen.has(place)) return; seen.add(place); out.push({ place, name, from, quote }); };
  for (const f of filed(flags)) { const d = DOC[f.id]; for (const l of (d && d.leads) || []) add(l.place, l.name, d.src || d.title, l.quote); }
  for (const l of FLAG_LEADS) if (flags[l.key]) add(l.place, l.name, l.from, l.quote);
  return out;
}
// a stable jitter per place (the '?' never sits right on the spot)
const jit = (id, k) => { let h = 7; for (const c of id + k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };
/** Pencil on your map: found places with their symbol + label; heard-of ones a dashed '?' near (not on) the spot, or a ray from the cab. */
export function pencilMarks(flags) {
  const out = [];
  for (const p of PLACES) if (p.xz && p.pencil && flags['place_' + p.id]) out.push({ kind: 'x', pos: p.xz, label: p.pencil.label });
  for (const h of heardOf(flags)) {
    const p = PLACE[h.place]; if (!p.xz || p.id === 'stairs' || p.id === 'station' || p.id === 'cache') continue;
    if (p.ray) { out.push({ kind: 'ray', brg: p.ray.brg, label: p.ray.label }); continue; }
    const a = jit(p.id, 'a') * Math.PI * 2, r = 8 + jit(p.id, 'r') * 7;
    out.push({ kind: 'q', pos: [p.xz[0] + Math.cos(a) * r, p.xz[1] + Math.sin(a) * r], r: 20 + jit(p.id, 's') * 10, label: p.mention || p.head });
  }
  return out;
}
/** The Found tab: places in the order found (the pack first), each with its filed papers. */
export function foundList(flags) {
  const by = new Map();
  for (const f of filed(flags)) { const d = DOC[f.id]; if (!d) continue; if (!by.has(d.place)) by.set(d.place, { place: d.place, head: (PLACE[d.place] || {}).head || d.place, at: f.at, docs: [] }); by.get(d.place).docs.push({ id: d.id, title: d.title, unread: !(flags.readPapers || []).includes(d.id) }); }
  return [...by.values()];
}
/** The words on the paper today (a few have lines that only appear later). */
export function paperText(id, day, hour) {
  const d = DOC[id]; if (!d) return '';
  let t = d.text;
  if (d.late && (day > d.late.day || (day === d.late.day && hour >= d.late.hour))) t += d.lateText || '';
  return t;
}
export { PLACES, DOCS, PLACE, DOC };
