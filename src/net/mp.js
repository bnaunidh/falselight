// FALSE LIGHT — co-op networking: up to four lookouts on one mountain. WebRTC data channels through PeerJS: its free
// public broker only introduces the browsers to each other (no game data goes through it), then they talk directly.
// Star topology: friends connect to the host; the host relays. The library loads only when someone opens the co-op menu.
const PEER_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'falselight-tamarack-';
export const MAX_PLAYERS = 4;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I / O: codes get read out loud

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return loading || (loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEER_SRC; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => (window.Peer ? res(window.Peer) : rej(new Error('The connection library did not load.')));
    s.onerror = () => { loading = null; rej(new Error('Could not reach the connection library. Check your internet.')); };
    document.head.appendChild(s);
  }));
}
const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const opened = (peer) => new Promise((res, rej) => { peer.on('open', () => res(peer)); peer.on('error', rej); });

export function createMP() {
  const M = { role: null, code: null, name: 'Lookout', peers: new Map(), handlers: {}, connected: false };
  M.on = (t, fn) => { M.handlers[t] = fn; };
  const emit = (msg, from) => { const f = M.handlers[msg.t]; if (f) try { f(msg, from); } catch (e) { console.warn('coop', msg.t, e); } };
  /** Host a game: a fresh five-letter room code (retried if it's taken). */
  M.host = async (name) => {
    const Peer = await loadPeer(); M.name = name;
    for (let tries = 0; tries < 5; tries++) {
      const code = newCode();
      let peer;
      try { peer = await opened(new Peer(PREFIX + code)); } catch (e) { if (e && e.type === 'unavailable-id') continue; throw e; }
      M.peer = peer; M.code = code; M.role = 'host'; M.connected = true;
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          if (M.peers.size >= MAX_PLAYERS - 1) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 600); return; }
          const pid = 'p' + Math.random().toString(36).slice(2, 8);
          M.peers.set(pid, { conn, name: 'Lookout' });
          conn.on('data', (msg) => { if (!msg || !msg.t) return; if (msg.t === 'hello') M.peers.get(pid).name = String(msg.name || 'Lookout').slice(0, 16); emit(msg, pid); });
          conn.on('close', () => { M.peers.delete(pid); emit({ t: 'left', id: pid }, pid); });
        });
        conn.on('error', () => {});
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* the broker; the direct links stay up */ } });
      return code;
    }
    throw new Error('Couldn\'t get a room code. Try again.');
  };
  /** Join a friend's game by its code. */
  M.join = async (code, name) => {
    const Peer = await loadPeer(); M.name = name; code = String(code || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) throw new Error('A room code is five letters.');
    const peer = await opened(new Peer());
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('No game with that code (or it\'s not answering).')), 15000);
      conn.on('open', () => { clearTimeout(to); res(); });
      peer.on('error', (e) => { clearTimeout(to); rej(e && e.type === 'peer-unavailable' ? new Error('No game with that code.') : e); });
    });
    M.peer = peer; M.conn = conn; M.role = 'client'; M.code = code; M.connected = true;
    conn.on('data', (msg) => { if (msg && msg.t) emit(msg, 'h'); });
    conn.on('close', () => { if (!M.connected) return; M.connected = false; emit({ t: 'hostLeft' }, 'h'); });
    conn.send({ t: 'hello', name });
    return code;
  };
  /** Host: to every friend (or just `to`, or everyone but `except`). Friend: to the host. */
  M.send = (msg, to = null, except = null) => {
    if (M.role === 'client') { if (M.conn && M.conn.open) M.conn.send(msg); return; }
    for (const [pid, p] of M.peers) if ((!to || pid === to) && pid !== except && p.conn.open) p.conn.send(msg);
  };
  M.leave = () => { M.connected = false; try { M.conn && M.conn.close(); } catch (e) { /* gone */ } try { M.peer && M.peer.destroy(); } catch (e) { /* gone */ } M.role = null; M.code = null; M.peers.clear(); };
  return M;
}
