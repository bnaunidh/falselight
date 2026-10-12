// FALSE LIGHT — co-op networking: up to four lookouts on one mountain. Star topology: friends connect to the host; the
// host relays. Two ways in, tried in order:
//   1. DIRECT: a WebRTC data channel (PeerJS's free broker only introduces the browsers). Lowest lag, but school, guest and
//      public Wi-Fi usually won't let two devices talk to each other directly, even side by side, and the free TURN relays
//      that used to carry that case are gone (they don't resolve any more).
//   2. RELAY: messages through a public MQTT broker over a secure WebSocket (the same kind of connection as any website).
//      The host listens on several brokers at once, so a friend gets in through whichever one their network allows.
// Libraries load only when someone opens the co-op menu. A relayed message is game data only (poses, the clock, chat).
const PEER_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const MQTT_SRC = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
const PREFIX = 'falselight-tamarack-';
export const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I / O: codes get read out loud
export const PROTO = 4;   // bumped when the messages change: an old cached copy of the game can't join a new one
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const peerOpts = { config: ICE, debug: 1 };
// public brokers (checked live 2026-10-12): EMQX is quickest; shiftr.io runs on 443, which even strict firewalls pass
const BROKERS = [
  { url: 'wss://broker.emqx.io:8084/mqtt', o: {} },
  { url: 'wss://public.cloud.shiftr.io', o: { username: 'public', password: 'public' } },
  { url: 'wss://broker.hivemq.com:8884/mqtt', o: {} },
  { url: 'wss://test.mosquitto.org:8081', o: {} },
];
const T = (code) => ({ host: `falselight/v${PROTO}/${code}/h`, to: (cid) => `falselight/v${PROTO}/${code}/c/${cid}` });
const DIRECT_WAIT = 7000, SILENT = 15000;

const loaders = {};
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return loaders[src] || (loaders[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window[global] ? res(window[global]) : rej(new Error('The connection library did not load.')));
    s.onerror = () => { delete loaders[src]; rej(new Error('Could not reach the connection library. Check your internet.')); };
    document.head.appendChild(s);
  }));
}
const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const opened = (peer) => new Promise((res, rej) => { peer.on('open', () => res(peer)); peer.on('error', rej); });
const brokerConnect = (mqtt, b, wait = 7000) => new Promise((res, rej) => {
  const c = mqtt.connect(b.url, { ...b.o, connectTimeout: wait, reconnectPeriod: 2000, clean: true, clientId: 'fl_' + Math.random().toString(36).slice(2, 12) });
  const to = setTimeout(() => { try { c.end(true); } catch (e) { /* */ } rej(new Error('timeout')); }, wait + 500);
  c.once('connect', () => { clearTimeout(to); res(c); });
  c.once('error', (e) => { clearTimeout(to); try { c.end(true); } catch (x) { /* */ } rej(e); });
});
const parse = (buf) => { try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch (e) { return null; } };

export function createMP() {
  const M = { role: null, code: null, name: 'Lookout', peers: new Map(), handlers: {}, connected: false, via: null };
  M.on = (t, fn) => { M.handlers[t] = fn; };
  const emit = (msg, from) => { const f = M.handlers[msg.t]; if (f) try { f(msg, from); } catch (e) { console.warn('coop', msg.t, e); } };
  let brokers = [], watch = null;
  const addPeer = (pid, conn, relay) => { if (M.peers.size >= MAX_PLAYERS - 1) { conn.send({ t: 'full' }); return null; } const p = { conn, name: 'Lookout', relay, seen: performance.now() }; M.peers.set(pid, p); return p; };
  const dropPeer = (pid) => { if (!M.peers.has(pid)) return; M.peers.delete(pid); emit({ t: 'left', id: pid }, pid); };
  const fromPeer = (pid, msg) => { const p = M.peers.get(pid); if (!p || !msg || !msg.t) return; p.seen = performance.now(); if (msg.t === 'bye') return dropPeer(pid); if (msg.t === 'hello') p.name = String(msg.name || 'Lookout').slice(0, 16); emit(msg, pid); };

  /** Host a game: a fresh five-letter room code; friends can come in directly or through any of the relays. */
  M.host = async (name) => {
    M.name = name;
    let Peer = null; try { Peer = await loadScript(PEER_SRC, 'Peer'); } catch (e) { /* the relays alone will do */ }
    let code = null;
    if (Peer) for (let tries = 0; tries < 5 && !code; tries++) {
      const c = newCode();
      try {
        const peer = await opened(new Peer(PREFIX + c, peerOpts)); M.peer = peer; code = c;
        peer.on('connection', (conn) => {
          conn.on('open', () => { const pid = 'p' + Math.random().toString(36).slice(2, 8); if (!addPeer(pid, conn, false)) { setTimeout(() => conn.close(), 600); return; }
            conn.on('data', (msg) => fromPeer(pid, msg)); conn.on('close', () => dropPeer(pid)); });
          conn.on('error', () => {});
        });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* the broker; the links stay up */ } });
      } catch (e) { if (!(e && e.type === 'unavailable-id')) break; }
    }
    if (!code) code = newCode();
    M.code = code; M.role = 'host'; M.connected = true;
    // the relays: listen on every broker that answers; reply on the one each friend came in on
    const mqtt = await loadScript(MQTT_SRC, 'mqtt').catch(() => null);
    if (mqtt) for (const b of BROKERS) brokerConnect(mqtt, b).then((c) => {
      if (!M.connected) { c.end(true); return; }
      brokers.push(c); const t = T(code); c.subscribe(t.host, { qos: 0 });
      c.on('message', (topic, buf) => {
        const env = parse(buf); if (!env || !env.f || !env.m) return; const pid = 'r' + String(env.f).slice(0, 12);
        if (!M.peers.has(pid)) { if (env.m.t !== 'hello') return; addPeer(pid, { open: true, send: (msg) => c.publish(t.to(env.f), JSON.stringify(msg), { qos: 0 }), close() { this.open = false; } }, true); }
        fromPeer(pid, env.m);
      });
    }).catch(() => { /* that broker's not reachable from here */ });
    if (!Peer && !mqtt) throw new Error('Couldn\'t reach the connection services. Check your internet.');
    watch = setInterval(() => { const now = performance.now(); for (const [pid, p] of M.peers) if (p.relay && now - p.seen > SILENT) dropPeer(pid); }, 3000);   // a relayed friend who's gone quiet has gone
    return code;
  };

  /** Join a friend's game by its code: directly if this network allows it, otherwise through a relay. */
  M.join = async (code, name, onStatus = () => {}) => {
    M.name = name; code = String(code || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) throw new Error('A room code is five letters.');
    onStatus('Trying a direct link…');
    if (!/[?&]relay=1/.test(location.search) && await joinDirect(code, name).catch(() => false)) { M.via = 'direct'; return code; }   // (?relay=1: straight to the relays, for testing)
    onStatus('No direct link on this network. Trying the relays…');
    const mqtt = await loadScript(MQTT_SRC, 'mqtt');
    const cid = Math.random().toString(36).slice(2, 12), t = T(code);
    for (const b of BROKERS) {
      let c; try { c = await brokerConnect(mqtt, b, 6000); } catch (e) { continue; }
      const ok = await new Promise((res) => {
        const to = setTimeout(() => res(false), 6000);
        c.subscribe(t.to(cid), { qos: 0 }, () => c.publish(t.host, JSON.stringify({ f: cid, m: { t: 'hello', name, proto: PROTO } }), { qos: 0 }));
        c.on('message', (topic, buf) => {
          const msg = parse(buf); if (!msg || !msg.t) return;
          if (!M.connected) { clearTimeout(to); res(true); }
          M.lastHost = performance.now(); emit(msg, 'h');
        });
      });
      if (!ok) { try { c.end(true); } catch (e) { /* */ } continue; }
      brokers = [c]; M.role = 'client'; M.code = code; M.connected = true; M.via = 'relay';
      M.conn = { open: true, send: (msg) => c.publish(t.host, JSON.stringify({ f: cid, m: msg }), { qos: 0 }), close() { this.open = false; } };
      watch = setInterval(() => { if (M.connected && performance.now() - (M.lastHost || 0) > SILENT) { M.connected = false; emit({ t: 'hostLeft' }, 'h'); } }, 3000);
      return code;
    }
    throw new Error('Couldn\'t find that room. Check the five letters with the host, and that their game is still open on the Play with friends screen or in the game.');
  };
  async function joinDirect(code, name) {
    const Peer = await loadScript(PEER_SRC, 'Peer');
    const peer = await Promise.race([opened(new Peer(undefined, peerOpts)), new Promise((_, rej) => setTimeout(() => rej(new Error('broker')), DIRECT_WAIT))]);
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    const ok = await new Promise((res) => { const to = setTimeout(() => res(false), DIRECT_WAIT); conn.on('open', () => { clearTimeout(to); res(true); }); peer.on('error', () => { clearTimeout(to); res(false); }); });
    if (!ok) { try { peer.destroy(); } catch (e) { /* */ } return false; }
    M.peer = peer; M.conn = conn; M.role = 'client'; M.code = code; M.connected = true;
    conn.on('data', (msg) => { if (msg && msg.t) emit(msg, 'h'); });
    conn.on('close', () => { if (!M.connected) return; M.connected = false; emit({ t: 'hostLeft' }, 'h'); });
    conn.send({ t: 'hello', name, proto: PROTO });
    return true;
  }

  /** Host: to every friend (or just `to`, or everyone but `except`). Friend: to the host. */
  M.send = (msg, to = null, except = null) => {
    if (M.role === 'client') { if (M.conn && M.conn.open) M.conn.send(msg); return; }
    for (const [pid, p] of M.peers) if ((!to || pid === to) && pid !== except && p.conn.open) p.conn.send(msg);
  };
  M.leave = () => {
    if (M.role === 'client' && M.conn && M.conn.open) try { M.conn.send({ t: 'bye' }); } catch (e) { /* */ }
    if (M.role === 'host') for (const p of M.peers.values()) if (p.relay) try { p.conn.send({ t: 'hostLeft' }); } catch (e) { /* */ }
    M.connected = false; clearInterval(watch);
    setTimeout(() => { for (const c of brokers) try { c.end(true); } catch (e) { /* */ } brokers = []; }, 300);
    try { M.conn && M.conn.close && M.conn.close(); } catch (e) { /* gone */ } try { M.peer && M.peer.destroy(); } catch (e) { /* gone */ }
    M.role = null; M.code = null; M.via = null; M.conn = null; M.peer = null; M.peers.clear();
  };
  return M;
}
