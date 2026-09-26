/* FALSE LIGHT — offline cache (service worker). Written by tools/build_site.py (tools/site_cache.py) into the public site
   only; the dev server never registers it. Files are stored by CONTENT HASH (from files.json), so a new build only
   downloads what changed, and a page is only ever answered with files of the build that served its index.html (no mixed
   code). A new build installs in the background and is taken at the title screen (src/engine/updates.js), never mid-run.
   Kill switch: open the game with ?nosw (unregisters this worker for that browser). */
const BUILD = '2949f1c7b0';
const PREFIX = 'falselight-';                  // the origin (bnaunidh.github.io) is shared with other sites: only touch ours
const STORE = PREFIX + 'files-v1';
const SCOPE = new URL(self.registration.scope);
const keyOf = (hash, path) => new URL('__c/' + hash + '/' + path, SCOPE).href;
const META = new URL('__build/' + BUILD + '/files.json', SCOPE).href;
const CORE = 0;                                // files.json tiers: 0 = code + small data (all-or-nothing, hash-checked), 1 = big assets

let storeP = null;
const store = () => (storeP = storeP || caches.open(STORE));
let filesP = null;
function files() {                             // this build's manifest: { build, files: { path: [hash, bytes, tier] } }
  if (!filesP) filesP = (async () => {
    const c = await store();
    const hit = await c.match(META);
    if (hit) return hit.json();
    const res = await fetch(new URL('files.json?v=' + BUILD, SCOPE), { cache: 'no-store' });
    if (!res.ok) throw new Error('files.json: HTTP ' + res.status);
    const j = await res.clone().json();
    if (j.build !== BUILD) throw new Error('files.json is build ' + j.build + ', this worker is ' + BUILD);   // mid-deploy
    await c.put(META, new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } }));
    return j;
  })().catch((e) => { filesP = null; throw e; });
  return filesP;
}
async function sha16(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = ''; for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}
function headersFor(res, bytes) {              // the body we hand on is already decoded: drop the wire headers
  const h = new Headers(res.headers);
  for (const k of ['content-encoding', 'content-length', 'etag', 'last-modified', 'vary', 'age', 'x-cache', 'x-cache-hits']) h.delete(k);
  if (bytes != null) h.set('content-length', String(bytes));
  return h;
}
// one file of THIS build, verified, into the store. modes: 'default' finds the page's own copy in the HTTP cache on a
// first visit; 'reload' asks the server itself when that copy (or a CDN edge) is stale
async function fetchVerified(c, path, hash, bytes, modes = ['default', 'reload']) {
  const url = new URL(path + '?v=' + hash, SCOPE);
  for (const mode of modes) {
    const res = await fetch(url, { cache: mode });
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    if (buf.byteLength === bytes && (await sha16(buf)) === hash) return c.put(keyOf(hash, path), new Response(buf, { status: 200, headers: headersFor(res, bytes) }));
  }
  throw new Error(path + ': the server does not have build ' + BUILD + ' yet');
}
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
}

// ---------------------------------------------------------------- install: an UPDATE must be complete before it can take over
self.addEventListener('install', (e) => e.waitUntil((async () => {
  const j = await files();                     // throws => install fails => the browser retries on a later visit
  if (!self.registration.active) return;       // first visit: nothing to be consistent with; the page's own loads fill the store
  const c = await store();
  const need = [];
  for (const [path, [hash, bytes, tier]] of Object.entries(j.files)) if (tier === CORE && !(await c.match(keyOf(hash, path)))) need.push([path, hash, bytes]);
  await pool(need, 6, ([p, h, b]) => fetchVerified(c, p, h, b));   // typically a handful of changed .js files; big assets come later, on use
})()));

// ---------------------------------------------------------------- activate: drop other builds' files, take the page
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const n of await caches.keys()) if (n.startsWith(PREFIX) && n !== STORE) await caches.delete(n);
  try {
    const j = await files(), c = await store();
    const keep = new Set([META]); for (const [p, [h]] of Object.entries(j.files)) keep.add(keyOf(h, p));
    for (const r of await c.keys()) if (!keep.has(r.url)) await c.delete(r);
  } catch (err) { /* keep everything; try again next activation */ }
  await self.clients.claim();                  // first visit: the rest of this page's downloads now go into the store
  for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'fl-sw-active', build: BUILD });
})()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();            // only ever sent by the page at the title screen
  if (d.type === 'fl-backfill') e.waitUntil(backfill(e.source, d.paths || [], !!d.all));
});
// store what isn't stored yet: the code (tier 0) that loaded before this worker took the page on a first visit, the assets
// the page names (it loaded them before the claim, so they are normally still in the HTTP cache), or with `all` every file
// (the 'keep it offline' prefetch)
async function backfill(client, paths, all) {
  const j = await files(), c = await store();
  const miss = [];
  for (const [path, [hash, bytes, tier]] of Object.entries(j.files)) {
    if (!(tier === CORE || all || paths.includes(path))) continue;
    if (!(await c.match(keyOf(hash, path)))) miss.push([path, hash, bytes]);
  }
  let failed = 0, done = 0;
  await pool(miss, all ? 3 : 4, async ([p, h, b]) => {
    try { await fetchVerified(c, p, h, b, tierOf(j, p) === CORE ? ['default', 'reload'] : ['force-cache', 'reload']); } catch (err) { failed++; }
    done++; if (all && client) client.postMessage({ type: 'fl-backfill-progress', done, of: miss.length });
  });
  if (client) client.postMessage({ type: 'fl-backfill', stored: miss.length - failed, failed, all });
}
const tierOf = (j, p) => (j.files[p] || [0, 0, 1])[2];

// ---------------------------------------------------------------- fetch
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  let path = decodeURIComponent(url.pathname.slice(SCOPE.pathname.length));
  if (req.mode === 'navigate') { if (path !== '' && path !== 'index.html') return; path = 'index.html'; }
  if (path === 'sw.js' || path === 'files.json' || path.startsWith('__')) return;
  e.respondWith(serve(e, req, url, path));
});

async function serve(e, req, url, path) {
  let j;
  try { j = await files(); } catch (err) { return fetch(req); }   // no manifest (evicted + offline, or mid-deploy): just be the network
  const f = j.files[path];
  if (!f) return fetch(req);
  const [hash, bytes, tier] = f;
  const v = url.searchParams.get('v');         // stamped URLs name their content (tools/site_cache.py, the asset queue)
  if (v && v !== hash) return fetch(req);      // a page of another build wants other bytes: never answer from this build
  const c = await store(), key = keyOf(hash, path);
  const hit = await c.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status !== 200 || !res.body) return res;
  if (tier === CORE) {                         // code / small data: only stored when it's byte-for-byte this build
    const buf = await res.arrayBuffer();
    const out = new Response(buf, { status: 200, headers: headersFor(res, buf.byteLength) });
    if (buf.byteLength === bytes && (await sha16(buf)) === hash) e.waitUntil(c.put(key, out.clone()).catch(() => {}));
    else { self.registration.update().catch(() => {}); tell(e.clientId, { type: 'fl-sw-stale', path }); }
    return out;
  }
  // big assets: stream to the page and into the store at the same time; stored only if every byte arrived
  const [toPage, toStore] = res.body.tee();
  let n = 0;
  const count = new TransformStream({
    transform(chunk, ctl) { n += chunk.byteLength; ctl.enqueue(chunk); },
    flush(ctl) { if (n !== bytes) ctl.error(new Error(path + ': ' + n + ' bytes, expected ' + bytes)); },
  });
  e.waitUntil(c.put(key, new Response(toStore.pipeThrough(count), { status: 200, headers: headersFor(res, bytes) })).catch(() => {}));   // quota / size mismatch: just not stored
  return new Response(toPage, { status: 200, headers: headersFor(res, null) });
}
function tell(id, msg) { if (id) self.clients.get(id).then((cl) => cl && cl.postMessage(msg)).catch(() => {}); }
