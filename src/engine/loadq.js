// FALSE LIGHT — one download queue for every asset. A few requests in flight at a time, most urgent first (0 = the title,
// 1 = before New game, 2+ = streamed during day 1), so the network never idles while the main thread parses and the first
// things needed arrive first. Progress is counted in real (decoded) bytes against the manifest's sizes, so the bar moves
// smoothly through a 6 MB tower instead of freezing on one label.
//   Q.prefetch(path, prio)  queue it now; the bytes wait for their consumer
//   Q.take(path, prio)      the bytes (ArrayBuffer), handed over once: the queue lets go of them then, so nothing big stays
//                           in memory twice. Asking with a more urgent prio moves a waiting file up the queue.
// Paths are the game's own ('assets/models/tower.glb'); with the site manifest's `files` map ({rel: [hash, bytes]}) every
// request goes out as <path>?v=<hash>, so a push can never be answered with a stale copy from the HTTP cache.
import { assetURL } from './util.js?v=f2e9808ddd94306b';

export function createLoadQueue({ concurrency = 4, fetchFn = (u, o) => fetch(u, o) } = {}) {
  const jobs = new Map(), queue = [], listeners = new Set(), handed = new Map();   // handed: path -> bytes, already given out
  let active = 0, seq = 0, files = null, t0 = 0, got0 = 0;
  const Q = { want: 0, got: 0, bps: 0 };
  const info = (path) => (files && path.startsWith('assets/') && files[path.slice(7)]) || null;
  const emit = () => {
    const now = performance.now();
    if (now - t0 > 1000) { const r = (Q.got - got0) * 1000 / Math.max(1, now - t0); Q.bps = Q.bps ? Q.bps * 0.6 + r * 0.4 : r; t0 = now; got0 = Q.got; }
    for (const f of listeners) f(Q);
  };
  function pump() {
    while (active < concurrency && queue.length) {
      let bi = 0; for (let i = 1; i < queue.length; i++) if (queue[i].prio < queue[bi].prio || (queue[i].prio === queue[bi].prio && queue[i].seq < queue[bi].seq)) bi = i;
      const j = queue.splice(bi, 1)[0]; j.started = true; active++;
      run(j).finally(() => { active--; pump(); });
    }
  }
  async function run(j) {
    try {
      const inf = info(j.path), url = assetURL(j.path) + (inf && !j.path.includes('?') ? '?v=' + inf[0] : '');
      const r = await fetchFn(url, { priority: j.prio <= 1 ? 'high' : 'low' });
      if (!r.ok) throw new Error(`${j.path}: HTTP ${r.status}`);
      const parts = []; let n = 0;
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; j.got = n; Q.got += value.length; emit(); }
      } else { const b = new Uint8Array(await r.arrayBuffer()); parts.push(b); n = b.length; j.got = n; Q.got += n; }
      if (j.bytes !== n) { Q.want += n - j.bytes; j.bytes = n; }   // keep the bar honest when a size was unknown or off
      let out;
      if (parts.length === 1 && parts[0].byteOffset === 0 && parts[0].byteLength === parts[0].buffer.byteLength) out = parts[0].buffer;
      else { const u8 = new Uint8Array(n); let o = 0; for (const p of parts) { u8.set(p, o); o += p.length; } out = u8.buffer; }
      j.done = true; j.resolve(out);
    } catch (e) { Q.got += Math.max(0, j.bytes - j.got); j.got = j.bytes; j.done = true; j.reject(e); }   // a failed file counts as done (the game has fallbacks)
    emit();
  }
  function job(path, prio) {
    let j = jobs.get(path);
    if (j) { if (!j.started && prio < j.prio) j.prio = prio; return j; }
    const inf = info(path);
    j = { path, prio, bytes: inf ? inf[1] : 0, got: 0, seq: seq++, started: false, done: false };
    j.promise = new Promise((res, rej) => { j.resolve = res; j.reject = rej; });
    j.promise.catch(() => {});
    jobs.set(path, j); queue.push(j); Q.want += j.bytes; pump();
    return j;
  }
  Q.setFiles = (f) => { files = f || null; };
  Q.bytesOf = (path) => { const inf = info(path); return inf ? inf[1] : 0; };
  Q.prefetch = (path, prio = 3) => { if (!handed.has(path)) job(path, prio); };
  Q.take = (path, prio = 1) => {
    const j = job(path, prio);
    const let_go = () => { if (jobs.get(path) === j) { jobs.delete(path); handed.set(path, j.bytes); } };
    j.promise.then(let_go, let_go);
    return j.promise;
  };
  /** fraction of the given paths' bytes received so far (a stage's bar); a path never queued counts as nothing to wait for */
  Q.progress = (paths) => {
    let g = 0, w = 0;
    for (const p of paths) {
      const j = jobs.get(p);
      if (j) { w += j.bytes || 1; g += j.done ? j.bytes || 1 : Math.min(j.got, j.bytes); }
      else if (handed.has(p)) { const b = handed.get(p) || 1; w += b; g += b; }
    }
    return w ? g / w : 1;
  };
  Q.onProgress = (f) => { listeners.add(f); return () => listeners.delete(f); };
  return Q;
}

// the game's one queue (engine.js points it at the manifest's files once that's in)
export const loadq = createLoadQueue();
export async function takeJSON(path, prio) { return JSON.parse(new TextDecoder().decode(await loadq.take(path, prio))); }
export async function tryTakeJSON(path, prio) { try { return await takeJSON(path, prio); } catch (e) { return null; } }
