// Saves at the start of each day/night. localStorage with try/catch everywhere (private windows,
// blocked storage, quota). The storage object is injectable so node tests can use a Map.
const KEY = 'falselight.v1.save'
const SETTINGS = 'falselight.v1.settings'

export function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m }
}

export function createSaves(storage = null) {
  let st = storage
  if (!st) { try { st = globalThis.localStorage || null } catch { st = null } }
  const mem = memoryStorage()
  const stale = new Set()   // keys whose newest value only made it into memory (storage full): read those from memory
  const get = (k) => { if (stale.has(k)) return mem.getItem(k); try { return st ? st.getItem(k) : mem.getItem(k) } catch { return mem.getItem(k) } }
  const set = (k, v) => {
    try { if (st) { st.setItem(k, v); stale.delete(k); return true } } catch { /* quota or blocked */ }
    mem.setItem(k, v); if (st) stale.add(k); return false
  }
  const noImages = (ph) => { if (ph && Array.isArray(ph.prints)) ph.prints = ph.prints.map((p) => ({ ...p, dataURL: null })) }
  // each print's picture is stored ONCE (the save and its checkpoint share the prints), keyed by print id
  const pool = (data) => {
    const images = {}
    for (const ph of [data.photos, data.checkpoint && data.checkpoint.photos]) if (ph && Array.isArray(ph.prints)) ph.prints = ph.prints.map((p) => { if (p.dataURL) images[p.id] = p.dataURL; return { ...p, dataURL: null, img: !!p.dataURL || !!p.img } })
    data.images = images; return data
  }
  const unpool = (data) => {
    const im = (data && data.images) || {}
    for (const ph of [data && data.photos, data && data.checkpoint && data.checkpoint.photos]) if (ph && Array.isArray(ph.prints)) for (const p of ph.prints) if (!p.dataURL && im[p.id]) p.dataURL = im[p.id]
    return data
  }
  return {
    save(data) {
      const json = JSON.stringify(pool({ ...data, photos: data.photos && { ...data.photos }, checkpoint: data.checkpoint && { ...data.checkpoint, photos: data.checkpoint.photos && { ...data.checkpoint.photos } }, savedAt: Date.now() }))
      if (set(KEY, json)) return true
      // too big (the prints are JPEGs): retry without the images, in the save AND its checkpoint
      try {   // still too big: drop the OLDEST pictures first, one at a time, never all of them at once
        const slim = JSON.parse(json), ids = Object.keys(slim.images || {}).sort((a, b) => (+a.slice(1)) - (+b.slice(1)))
        while (ids.length) { delete slim.images[ids.shift()]; if (set(KEY, JSON.stringify(slim))) return true }
        noImages(slim.photos); if (slim.checkpoint) noImages(slim.checkpoint.photos); return set(KEY, JSON.stringify(slim))
      } catch { return false }
    },
    load() { try { const s = get(KEY); return s ? unpool(JSON.parse(s)) : null } catch { return null } },
    has() { return !!this.load() },
    clear() { try { st ? st.removeItem(KEY) : mem.removeItem(KEY) } catch { mem.removeItem(KEY) } },
    settings(def = {}) { try { return { ...def, ...(JSON.parse(get(SETTINGS) || '{}')) } } catch { return { ...def } } },
    saveSettings(s) { return set(SETTINGS, JSON.stringify(s)) },
  }
}
