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
  const get = (k) => { try { return st ? st.getItem(k) : mem.getItem(k) } catch { return mem.getItem(k) } }
  const set = (k, v) => {
    try { if (st) { st.setItem(k, v); return true } } catch { /* quota or blocked */ }
    mem.setItem(k, v); return false
  }
  return {
    save(data) {
      const json = JSON.stringify({ ...data, savedAt: Date.now() })
      if (set(KEY, json)) return true
      // too big (photos): retry without images
      try { const slim = JSON.parse(json); if (slim.photos) slim.photos.prints = slim.photos.prints.map((p) => ({ ...p, dataURL: null })); return set(KEY, JSON.stringify(slim)) } catch { return false }
    },
    load() { try { const s = get(KEY); return s ? JSON.parse(s) : null } catch { return null } },
    has() { return !!this.load() },
    clear() { try { st ? st.removeItem(KEY) : mem.removeItem(KEY) } catch { mem.removeItem(KEY) } },
    settings(def = {}) { try { return { ...def, ...(JSON.parse(get(SETTINGS) || '{}')) } } catch { return { ...def } } },
    saveSettings(s) { return set(SETTINGS, JSON.stringify(s)) },
  }
}
