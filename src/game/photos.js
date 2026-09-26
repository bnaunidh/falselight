// The instant camera and its prints. Pure (images are opaque handles supplied by the engine).
// A print develops over 60 s (grey-blue → the image blooms in). Shaking it (Q) speeds it up.
// A forbidden print — the Weeper looking up — gives you one second, once the face starts to
// resolve, to turn it face-down. Only a print you are looking at can be seen.
import { clamp } from './util.js?v=239df90c'

export const PHOTO = { develop: 60, shakeBoost: 3.2, shakeWindow: 1.2, resolveAt: 0.55, flipWindow: 1.0, pack: 10 }

export class Photos {
  constructor(s = {}) {
    this.hasCamera = s.hasCamera ?? false
    this.packLeft = s.packLeft ?? 0
    this.prints = (s.prints || []).map((p) => ({ ...p }))
    this.nextId = s.nextId ?? 1
    this.viewing = null
    this.shakeT = 0
  }
  giveCamera(packs = 1) { this.hasCamera = true; this.packLeft += PHOTO.pack * packs }
  canShoot() { return this.hasCamera && this.packLeft > 0 }
  /** meta: engine photo meta; info: { subject, forbidden, image, dataURL, flash, phase, hour } */
  take(info) {
    if (!this.canShoot()) return null
    this.packLeft--
    const p = {
      id: 'P' + this.nextId++, phase: info.phase, hour: info.hour, flash: !!info.flash,
      subject: info.subject || 'nothing', forbidden: !!info.forbidden, entities: info.entities || [],
      develop: 0, faceDown: false, seen: false, sent: null, window: null, dataURL: info.dataURL || null, note: info.note || null,
    }
    this.prints.push(p)
    return p
  }
  get(id) { return this.prints.find((p) => p.id === id) }
  open(id) {
    const p = this.get(id); if (!p) return null
    this.viewing = id
    if (p.forbidden && !p.faceDown && !p.seen && p.develop >= PHOTO.resolveAt) p.window = 0
    return p
  }
  close() { this.viewing = null }
  shake() { this.shakeT = PHOTO.shakeWindow }
  /** Q while viewing: inside the window it turns the print face-down; otherwise it shakes it. */
  flipOrShake() {
    const p = this.viewing && this.get(this.viewing)
    if (!p) return null
    if (p.window != null && !p.seen) { p.faceDown = true; p.window = null; return 'flipped' }
    if (p.develop < 1 && !p.faceDown) { this.shake(); return 'shake' }
    if (!p.forbidden) { p.faceDown = !p.faceDown; return p.faceDown ? 'flipped' : 'unflipped' }
    return null
  }
  /** Returns events: { kind: 'resolving'|'seen'|'developed', id } */
  tick(dt) {
    const ev = []
    this.shakeT = Math.max(0, this.shakeT - dt)
    for (const p of this.prints) {
      if (p.develop < 1) {
        const boost = p.id === this.viewing && this.shakeT > 0 ? PHOTO.shakeBoost : 1
        const before = p.develop
        p.develop = clamp(p.develop + (dt / PHOTO.develop) * boost)
        if (before < 1 && p.develop >= 1) ev.push({ kind: 'developed', id: p.id })
        if (p.id === this.viewing && p.forbidden && !p.faceDown && !p.seen && before < PHOTO.resolveAt && p.develop >= PHOTO.resolveAt) {
          p.window = 0; ev.push({ kind: 'resolving', id: p.id })
        }
      }
      if (p.window != null && !p.faceDown && !p.seen) {
        if (p.id !== this.viewing) { p.window = null; continue }
        p.window += dt
        if (p.window >= PHOTO.flipWindow) { p.seen = true; p.window = null; ev.push({ kind: 'seen', id: p.id }) }
      }
    }
    return ev
  }
  /** What the viewer should draw: 0..1 bloom of the image, whether the face is resolving. */
  look(id) {
    const p = this.get(id); if (!p) return null
    return { develop: p.develop, faceDown: p.faceDown, resolving: p.window != null, windowLeft: p.window != null ? PHOTO.flipWindow - p.window : null }
  }
  sendable() { return this.prints.filter((p) => !p.sent) }
  toJSON(withImages = true) {
    return { hasCamera: this.hasCamera, packLeft: this.packLeft, nextId: this.nextId, prints: this.prints.map((p) => ({ ...p, window: null, dataURL: withImages ? p.dataURL : null })) }
  }
}

/** Decide what a shot shows from engine meta. Returns { subject, weeper } */
export function classifyShot(meta, { flash = false, night = false } = {}) {
  const ents = (meta && meta.entities) || []
  let best = null
  for (const e of ents) {
    const seenEnough = (e.onScreen ?? 0) > 0.002 && e.inFrustum !== false && !e.occluded
    const lightOk = !night || e.lit || (flash && (e.distance ?? 99) < 14)
    if (seenEnough && lightOk && (!best || (e.onScreen ?? 0) > (best.onScreen ?? 0))) best = e
  }
  const weeper = ents.find((e) => e.kind === 'weeper' && (e.onScreen ?? 0) > 0.0005 && e.inFrustum !== false && !e.occluded)
  return { subject: best ? best.kind : 'nothing', weeper: weeper || null }
}
