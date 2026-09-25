// Objectives and the logbook tracker. Pure. The tracker shows the current task plus its next step,
// always, so the player never wonders what to do. Urgent tasks (refuel, "he is coming") jump the queue.
export class Objectives {
  constructor(defs = {}) {
    this.defs = defs      // id -> { text, hint, phase, optional?, urgent? }
    this.list = []        // [{ id, done, failed, note, t, urgent, optional }]
    this.listeners = []
  }
  onChange(fn) { this.listeners.push(fn) }
  _emit(ev) { for (const f of this.listeners) f(ev, this) }
  has(id) { return this.list.some((o) => o.id === id) }
  get(id) { return this.list.find((o) => o.id === id) }
  isDone(id) { const o = this.get(id); return !!(o && o.done) }
  add(id, extra = {}) {
    if (this.has(id)) return this.get(id)
    const d = this.defs[id] || {}
    const o = { id, done: false, failed: false, note: null, t: extra.t ?? 0, urgent: !!(extra.urgent ?? d.urgent), optional: !!(extra.optional ?? d.optional), text: extra.text, hint: extra.hint }
    this.list.push(o)
    this._emit({ type: 'add', id })
    return o
  }
  complete(id, note = null, failed = false) {
    const o = this.get(id) || this.add(id)
    if (o.done) return false
    o.done = true; o.failed = failed; o.note = note
    this._emit({ type: failed ? 'fail' : 'done', id, note })
    return true
  }
  remove(id) { this.list = this.list.filter((o) => o.id !== id); this._emit({ type: 'remove', id }) }
  setText(id, text, hint) { const o = this.get(id); if (o) { if (text != null) o.text = text; if (hint != null) o.hint = hint; this._emit({ type: 'text', id }) } }
  text(o) { return o.text ?? (this.defs[o.id] && this.defs[o.id].text) ?? o.id }
  hint(o) { return o.hint ?? (this.defs[o.id] && this.defs[o.id].hint) ?? '' }
  open() { return this.list.filter((o) => !o.done) }
  /** The task shown in ink at the top of the tracker. */
  current() {
    const open = this.open()
    return open.find((o) => o.urgent) || open.find((o) => !o.optional) || open[0] || null
  }
  /** What comes after (shown smaller, in pencil). */
  next() {
    const cur = this.current(); if (!cur) return null
    const open = this.open().filter((o) => o !== cur)
    return open.find((o) => !o.optional) || open[0] || null
  }
  allRequiredDone(ids) { return ids.every((id) => this.isDone(id)) }
  view() {
    const cur = this.current(), nxt = this.next()
    return {
      current: cur && { id: cur.id, text: this.text(cur), hint: this.hint(cur), urgent: cur.urgent },
      next: nxt && { id: nxt.id, text: this.text(nxt) },
      done: this.list.filter((o) => o.done).slice(-3).map((o) => ({ id: o.id, text: this.text(o), failed: o.failed, note: o.note })),
    }
  }
  toJSON() { return this.list.map((o) => ({ ...o })) }
  load(arr) { this.list = (arr || []).map((o) => ({ ...o })); this._emit({ type: 'load' }) }
  reset() { this.list = []; this._emit({ type: 'load' }) }
}
