// FALSE LIGHT — the page side of the offline cache (the service worker, written into the public site only by
// tools/site_cache.py; the dev server never registers one, and then all of this does nothing).
//   * A new build (a push) installs in the background and is only taken at a safe moment — still loading, or on the
//     title screen — never mid-run: then the page reloads once into it.
//   * backfill(paths): store what loaded before the worker took the page on a first visit (normally straight from the
//     HTTP cache, no download), plus any files named (e.g. the audio, so a later visit works offline).
//   * firstVisit(ms): on a first visit, give the worker a moment to take the page, so the big downloads after it are kept.
export function watchUpdates({ isSafe, note = () => {} }) {
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
  const api = { poke() {}, backfill() {}, firstVisit: async () => {} };
  if (!sw) return api;
  let waiting = null, asked = false;
  sw.addEventListener('controllerchange', () => { if (asked) location.reload(); });   // only a swap WE asked for reloads (not the first-visit claim)
  sw.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'fl-sw-stale') note('The game was updated while this page loaded; it refreshes at the title.');
  });
  const take = () => { if (!waiting || asked || !isSafe()) return false; asked = true; note('Getting the newest version…'); waiting.postMessage({ type: 'SKIP_WAITING' }); return true; };
  const offer = (w) => { if (!sw.controller) return; waiting = w; if (!take()) note('A newer version is ready: it loads the next time you are at the title.'); };
  sw.getRegistration().then((reg) => {
    if (!reg) return;
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); }); });
    api.poke = () => { if (!take() && isSafe()) reg.update().catch(() => {}); };   // from the title: apply a waiting build, or look for one
  }).catch(() => {});
  api.backfill = (paths = []) => { if (sw.controller) sw.controller.postMessage({ type: 'fl-backfill', paths }); };
  api.firstVisit = async (ms = 1500) => {
    if (sw.controller) return;
    let reg = null; try { reg = await sw.getRegistration(); } catch (e) { return; }
    if (!reg) return;
    await new Promise((r) => { const t = setTimeout(r, ms); sw.addEventListener('controllerchange', () => { clearTimeout(t); r(); }, { once: true }); });
  };
  return api;
}
