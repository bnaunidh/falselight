// FALSE LIGHT — keyboard/mouse input with pointer lock and named actions (contract §3).
const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'jog', ShiftRight: 'jog',
  KeyE: 'interact', KeyF: 'searchlight', KeyC: 'camera', Tab: 'logbook', KeyM: 'map', KeyQ: 'flip',
  Space: 'signal', KeyL: 'flashlight', KeyB: 'binoculars', Escape: 'pause', KeyP: 'pause', KeyT: 'watch', KeyR: 'reload',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', KeyG: 'place', KeyI: 'inventory',
};

export function createInput(canvas) {
  const down = new Set();
  const handlers = new Map();
  let mdx = 0, mdy = 0, wheel = 0;
  let enabled = true;
  const api = {
    sensitivity: 0.0022,
    get locked() { return document.pointerLockElement === canvas; },
    lock() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* the click-to-continue prompt covers it */ } },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    isDown(a) { return enabled && down.has(a); },
    onAction(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return () => { const l = handlers.get(name); l.splice(l.indexOf(fn), 1); }; },
    emit(name, isDown) { (handlers.get(name) || []).slice().forEach((f) => f(isDown)); },
    consumeMouse() { const r = [mdx, mdy]; mdx = mdy = 0; return r; },
    consumeWheel() { const w = wheel; wheel = 0; return w; },
    setEnabled(b) { enabled = b; if (!b) down.clear(); },
    get enabled() { return enabled; },
    // test hook: press / release an action as if a key did it
    press(a, ms = 0) { down.add(a); api.emit(a, true); if (ms) setTimeout(() => { down.delete(a); api.emit(a, false); }, ms); },
    release(a) { down.delete(a); api.emit(a, false); },
    injectMouse(dx, dy) { mdx += dx; mdy += dy; },
  };
  const onKey = (e, isDown) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (a === 'logbook' || a === 'signal') e.preventDefault();
    if (!enabled && a !== 'pause' && a !== 'logbook' && a !== 'map' && a !== 'inventory') return;
    if (isDown) { if (down.has(a)) return; down.add(a); } else { if (!down.has(a)) return; down.delete(a); }
    api.emit(a, isDown);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { for (const a of [...down]) { down.delete(a); api.emit(a, false); } });
  document.addEventListener('mousemove', (e) => { if (api.locked) { mdx += e.movementX; mdy += e.movementY; } });
  canvas.addEventListener('mousedown', (e) => {
    if (!api.locked) { api.emit('click', true); return; }
    if (e.button === 0) api.emit('primary', true);
    if (e.button === 2) api.emit('secondary', true);
  });
  canvas.addEventListener('mouseup', (e) => { if (e.button === 0) api.emit('primary', false); if (e.button === 2) api.emit('secondary', false); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => api.emit('lockchange', api.locked));
  return api;
}
