// FALSE LIGHT — keyboard/mouse input with pointer lock and named actions (contract §3).
// Every action you can bind, in the order the Keys screen lists them. Escape always pauses (so you can never lock yourself out).
export const ACTIONS = [
  ['forward', 'Walk forward'], ['back', 'Walk back'], ['left', 'Step left'], ['right', 'Step right'], ['jog', 'Jog'],
  ['interact', 'Interact · pick up'], ['use', 'Use what\'s in your hand'], ['place', 'Set it down'], ['inventory', 'Backpack'],
  ['slot1', 'Hand 1'], ['slot2', 'Hand 2'], ['slot3', 'Hand 3'],
  ['flashlight', 'Flashlight'], ['binoculars', 'Binoculars'], ['camera', 'Camera'], ['flip', 'Shake / turn a photo'],
  ['searchlight', 'Searchlight'], ['signal', 'Flash Morse (on the searchlight)'], ['logbook', 'Logbook'], ['map', 'Trail map'], ['watch', 'Watch (hold)'], ['pause', 'Pause'],
];
export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jog: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'], use: ['KeyU'], place: ['KeyG'], inventory: ['KeyI'], slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'],
  flashlight: ['KeyL'], binoculars: ['KeyB'], camera: ['KeyC'], flip: ['KeyQ'], searchlight: ['KeyF'], signal: ['Space'],
  logbook: ['Tab'], map: ['KeyM'], watch: ['KeyT'], pause: ['KeyP'],
};
/** A key code as a person would name it. */
export function keyName(code) {
  if (!code) return '—';
  const m = { Space: 'Space', Escape: 'Esc', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt',
    MetaLeft: 'Cmd', MetaRight: 'R-Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
  if (m[code]) return m[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
/** User binds (action -> [codes]) laid over the defaults; a code belongs to one action only (the user's choice wins). */
export function mergeBinds(user = {}) {
  const out = {}; for (const [a] of ACTIONS) out[a] = [...(DEFAULT_BINDS[a] || [])];
  for (const [a, codes] of Object.entries(user || {})) if (out[a] && Array.isArray(codes)) {
    for (const c of codes) for (const b of Object.keys(out)) if (b !== a) out[b] = out[b].filter((x) => x !== c);
    out[a] = codes.filter((c) => typeof c === 'string' && c !== 'Escape');
  }
  return out;
}
export function createInput(canvas) {
  const down = new Set();
  const handlers = new Map();
  let mdx = 0, mdy = 0, wheel = 0;
  let enabled = true;
  let KEYMAP = {};
  const api = {
    binds: null,
    /** action -> [key codes]; Escape is always pause. */
    setBindings(user) { api.binds = mergeBinds(user); KEYMAP = {}; for (const [a, codes] of Object.entries(api.binds)) for (const c of codes) KEYMAP[c] = a; KEYMAP.Escape = 'pause'; },
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
  api.setBindings({});
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
