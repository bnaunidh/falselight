// Radio traffic: a queue of lines with speaker labels, each held long enough to read. Pure.
export const readTime = (text) => Math.max(2.4, Math.min(9, 1.1 + text.split(/\s+/).length * 0.36))

export class Radio {
  constructor() { this.queue = []; this.current = null; this.t = 0; this.onLine = null; this.onDone = null; this.log = [] }
  /** lines: [{ who, text, dur?, radio?: bool (squelch + static) }], tag: callback id */
  say(lines, { tag = null, onDone = null, interrupt = false } = {}) {
    const items = lines.map((l, i) => ({ ...l, dur: l.dur ?? readTime(l.text), tag, onDone: i === lines.length - 1 ? onDone : null }))
    if (interrupt) { this.queue = items; this.current = null }
    else this.queue.push(...items)
  }
  get busy() { return !!this.current || this.queue.length > 0 }
  isPlaying(tag) { return (this.current && this.current.tag === tag) || this.queue.some((l) => l.tag === tag) }
  skip() { if (this.current) this.t = this.current.dur }
  tick(dt) {
    const ev = []
    if (this.current) {
      this.t += dt
      if (this.t >= this.current.dur) {
        const done = this.current; this.current = null
        ev.push({ kind: 'end', line: done })
        if (done.onDone) done.onDone()
      }
    }
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift(); this.t = 0
      this.log.push(this.current)
      ev.push({ kind: 'start', line: this.current })
    }
    return ev
  }
}
