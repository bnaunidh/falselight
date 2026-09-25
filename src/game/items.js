// Items and the inventory. Pure (no three.js): what you carry and where everything is.
// Three hand slots (keys 1-3). The backpack takes one of them while you carry it and holds five small things;
// set it down and its five slots stay with it. Anything can be set down anywhere (G) and picked back up (E).
import { clamp } from './util.js?v=760ffcd2'

export const HAND_SLOTS = 3
export const PACK_SLOTS = 5
export const KINDS = {
  backpack:   { name: 'Backpack', model: 'prop_backpack', pack: false, scale: 0.8 },
  fuel:       { name: 'Fuel can', model: 'prop_jerrycan', pack: false, heavy: true, scale: 0.55 },   // a 5 L can: the tank's worth
  flashlight: { name: 'Flashlight', model: 'prop_flashlight', pack: true },
  camera:     { name: 'Instant camera', model: 'prop_instant_camera', pack: true },
  binoculars: { name: 'Binoculars', model: 'prop_binoculars', pack: true },
  canteen:    { name: 'Canteen', model: 'prop_canteen', pack: true },
  food:       { name: 'Tin of beans', model: 'prop_food_tin', pack: true },
}
export const CANTEEN_SIPS = 4

export class Inventory {
  constructor(s = {}) {
    this.items = (s.items || []).map((i) => ({ ...i, pos: i.pos ? [...i.pos] : undefined }))
    this.active = s.active ?? 0
    this.nextId = s.nextId ?? 1
  }
  /** The kit you walk up with + what's already at the lookout. where: { fuel: [[x,y,z],...], cab: {...} } */
  static start(where = {}) {
    const inv = new Inventory()
    const bp = inv.create('backpack', { where: 'hand', slot: 0 })
    inv.create('flashlight', { where: 'pack', slot: 0 })
    inv.create('binoculars', { where: 'pack', slot: 1 })
    inv.create('canteen', { where: 'pack', slot: 2, fill: 1 })
    inv.create('food', { where: 'pack', slot: 3 })
    for (const p of where.fuel || []) inv.create('fuel', { where: 'world', pos: p, rotY: Math.random() * 6.28, fill: 1 })
    for (const p of where.food || []) inv.create('food', { where: 'world', pos: p, rotY: Math.random() * 6.28 })
    inv.active = bp.slot
    return inv
  }
  create(kind, o = {}) { const it = { id: 'i' + this.nextId++, kind, where: 'world', slot: null, pos: null, rotY: 0, fill: 1, ...o }; this.items.push(it); return it }
  get(id) { return this.items.find((i) => i.id === id) || null }
  hand(i) { return this.items.find((it) => it.where === 'hand' && it.slot === i) || null }
  get activeItem() { return this.hand(this.active) }
  get wearingPack() { return this.items.some((it) => it.where === 'hand' && it.kind === 'backpack') }
  packSlot(i) { return this.items.find((it) => it.where === 'pack' && it.slot === i) || null }
  get world() { return this.items.filter((it) => it.where === 'world') }
  freeHand() { if (!this.hand(this.active)) return this.active; for (let i = 0; i < HAND_SLOTS; i++) if (!this.hand(i)) return i; return -1 }
  freePack() { if (!this.wearingPack) return -1; for (let i = 0; i < PACK_SLOTS; i++) if (!this.packSlot(i)) return i; return -1 }
  /** Carried and usable: in a hand, or in the pack you're wearing. */
  find(kind, pred = () => true) {
    return this.items.find((it) => it.kind === kind && pred(it) && (it.where === 'hand' || (it.where === 'pack' && this.wearingPack))) || null
  }
  inHands(kind, pred = () => true) { return this.items.find((it) => it.kind === kind && it.where === 'hand' && pred(it)) || null }
  get carryingHeavy() { return this.items.some((it) => it.where === 'hand' && KINDS[it.kind] && KINDS[it.kind].heavy) }
  select(i) { if (i >= 0 && i < HAND_SLOTS) this.active = i; return this.activeItem }
  /** Pick a world item up: hands first (the active slot if it's empty), the pack for small things when your hands are full. */
  take(id) {
    const it = this.get(id); if (!it || it.where !== 'world') return { ok: false, why: 'gone' }
    const h = this.freeHand()
    if (h >= 0) { Object.assign(it, { where: 'hand', slot: h, pos: null, hook: null }); this.active = h; return { ok: true, to: 'hand' } }
    const p = KINDS[it.kind].pack ? this.freePack() : -1
    if (p >= 0) { Object.assign(it, { where: 'pack', slot: p, pos: null, hook: null }); return { ok: true, to: 'pack' } }
    return { ok: false, why: KINDS[it.kind].pack ? 'Your hands and pack are full. Set something down (G).' : 'Your hands are full. Set something down (G).' }
  }
  /** Put a carried item down in the world. */
  place(id, pos, rotY = 0, hook = null) {
    const it = this.get(id); if (!it || it.where === 'world') return false
    if (it.where === 'pack' && !this.wearingPack) return false
    Object.assign(it, { where: 'world', slot: null, pos: [...pos], rotY, hook })
    return true
  }
  /** Hand <-> pack. */
  stow(id) {
    const it = this.get(id); if (!it || it.where !== 'hand') return { ok: false }
    if (!KINDS[it.kind].pack) return { ok: false, why: `The ${KINDS[it.kind].name.toLowerCase()} doesn't fit in the pack.` }
    const p = this.freePack(); if (p < 0) return { ok: false, why: this.wearingPack ? 'The pack is full.' : 'You aren\'t carrying the pack.' }
    Object.assign(it, { where: 'pack', slot: p }); return { ok: true }
  }
  unstow(id) {
    const it = this.get(id); if (!it || it.where !== 'pack' || !this.wearingPack) return { ok: false }
    const h = this.freeHand(); if (h < 0) return { ok: false, why: 'Your hands are full.' }
    Object.assign(it, { where: 'hand', slot: h }); this.active = h; return { ok: true }
  }
  /** Get a carried tool into your hands (from the pack if it has to). */
  ready(kind) {
    const h = this.inHands(kind); if (h) { this.active = h.slot; return { ok: true, item: h } }
    const p = this.find(kind); if (!p) return { ok: false, why: 'none' }
    const r = this.unstow(p.id); return r.ok ? { ok: true, item: p, fromPack: true } : r
  }
  remove(id) { this.items = this.items.filter((i) => i.id !== id) }
  sip(it) { if (!it || it.kind !== 'canteen' || it.fill <= 0) return false; it.fill = clamp(it.fill - 1 / CANTEEN_SIPS); if (it.fill < 1e-3) it.fill = 0; return true }
  label(it) {
    if (!it) return ''
    const k = KINDS[it.kind]; if (!k) return it.kind
    if (it.kind === 'fuel') return k.name + (it.fill > 0.99 ? ' (full, 5 L)' : it.fill > 0.01 ? ` (${Math.round(it.fill * 50) / 10} L)` : ' (empty)')
    if (it.kind === 'canteen') return k.name + (it.fill > 0 ? ` (${Math.round(it.fill * CANTEEN_SIPS)}/${CANTEEN_SIPS})` : ' (empty)')
    return k.name
  }
  toJSON() { return { items: this.items.map((i) => ({ ...i })), active: this.active, nextId: this.nextId } }
}
