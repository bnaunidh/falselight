// FALSE LIGHT — diegetic DOM overlays: the logbook tracker (handwriting on paper), radio subtitles, notes, the
// trail map, the logbook (tasks · rules · Tillman · your log · photos), the print you're holding, the fire-finder
// readout, the searchlight dial, the camera frame, the watch, and title / pause / death / end screens.
import { drawMap } from './mapdraw.js?v=7c0235c6';
import { createOverlays } from './overlays.js?v=7c0235c6';
const $ = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createUI(root = document.getElementById('ui')) {
  const U = {};
  const tracker = $('div', 'fl-tracker', root);
  const subs = $('div', 'fl-subs', root);
  const toast = $('div', 'fl-toast', root);
  const finder = $('div', 'fl-finder', root);
  const sl = $('div', 'fl-sl', root);
  const camf = $('div', 'fl-camframe', root);
  const print = $('div', 'fl-print', root);
  const watch = $('div', 'fl-watch', root);
  const fade = $('div', 'fl-fade', root);
  const modal = $('div', 'fl-modal', root);
  const binoc = $('div', 'fl-binoc', root);
  const hot = $('div', 'fl-hot', root), surv = $('div', 'fl-surv', root);
  const body = createOverlays(root);
  let subTimer = 0, toastTimer = 0;

  let rk = (t) => t; U.setRekey = (f) => { rk = f || ((t) => t); };   // show the player's own (rebound) keys
  U.tracker = (v, { date, hour } = {}) => {
    if (!v) { tracker.style.opacity = 0; return; }
    tracker.style.opacity = 1;
    tracker.innerHTML = `<div class="d">${esc(date || '')}</div>` +
      (v.current ? `<div class="c${v.current.urgent ? ' u' : ''}">${esc(rk(v.current.text))}</div><div class="h">${esc(rk(v.current.hint || ''))}</div>` : '<div class="c">—</div>') +
      (v.next ? `<div class="n">then: ${esc(v.next.text)}</div>` : '') +
      (v.done || []).slice(-2).map((d) => `<div class="x${d.failed ? ' f' : ''}">${esc(d.text)}</div>`).join('');
  };
  U.subtitle = (who, text, dur = 4, { radio = false, note = false } = {}) => {
    subs.innerHTML = note ? `<span class="note">${esc(text)}</span>` : `<span class="who${radio ? ' r' : ''}">${esc(who)}</span> ${esc(text)}`;
    subs.style.opacity = 1; subTimer = dur;
  };
  U.toast = (text, dur = 3.5) => { toast.textContent = rk(text); toast.style.opacity = 1; toastTimer = dur; };
  U.finder = (o) => {
    if (!o) { finder.style.display = 'none'; return; }
    finder.style.display = 'block';
    finder.innerHTML = `<div class="ring">${esc(o.readout)}</div><div class="hint">A / D turn the ring · hold Shift for fine · E radio the azimuth · Esc step back</div>`;
  };
  U.searchlight = (o) => {
    if (!o) { sl.style.display = 'none'; return; }
    sl.style.display = 'block';
    const f = Math.max(0, Math.min(1, o.fuel));
    sl.innerHTML = `<div class="dial"><div class="needle" style="transform:rotate(${-60 + f * 120}deg)"></div><div class="lbl">FUEL</div></div>
      ${o.sos && o.sos.show ? (() => { const S = o.sos, want = '...---...'.split(''), m = S.marks.slice(-9);
        const slots = want.map((w, i) => { const got = m[i]; return `<i class="${got ? (got === w ? 'ok' : 'bad') : ''} ${w === '-' ? 'dash' : 'dot'}"></i>`; }).join('');
        const k = Math.min(1, S.hold / (S.thr * 2)), thrPos = 50;
        return `<div class="sos"><div class="tgt">Answer SOS &nbsp;<b>··· ——— ···</b></div><div class="slots">${slots}</div>
          <div class="hold${S.keying ? ' on' : ''}"><u style="width:${Math.round(k * 100)}%" class="${S.hold > S.thr ? 'dash' : ''}"></u><b style="left:${thrPos}%"></b><em>${S.keying ? (S.hold > S.thr ? 'long' : 'short') : 'tap = short · hold = long'}</em></div>
          <div class="aim ${S.onTarget ? 'on' : ''}">${S.onTarget ? '● on their light' : '○ aim at their light'}</div></div>`; })() : ''}
      <div class="morse">${esc(o.morse || '')}</div>
      <div class="hint">${o.power ? rk('Mouse aims the lamp · hold SPACE or click to flash · F / Esc to step back') : 'No power. Start the generator in the shed.'}</div>`;
  };
  U.cameraFrame = (o) => {
    if (!o) { camf.style.display = 'none'; return; }
    camf.style.display = 'block';
    camf.innerHTML = `<div class="frame"></div><div class="info">${o.left} left · flash ${o.flash ? 'ON' : 'off'} (F) · click to take · C to lower</div>`;
  };
  U.binoculars = (on, brg) => {
    if (root.classList.contains('binoc-up') !== !!on) root.classList.toggle('binoc-up', !!on);   // the HUD hides behind the eyecups
    binoc.style.display = on ? 'block' : 'none'; if (!on) return;
    const W = window.innerWidth, H = window.innerHeight;
    if (binoc._wh !== W + 'x' + H) {   // lens geometry in px, rebuilt when the window changes
      binoc._wh = W + 'x' + H;
      const r = Math.min(H * 0.46, W * 0.27), dx = r * 0.62, cy = H / 2;
      binoc.innerHTML = `<svg width="${W}" height="${H}" style="position:absolute;inset:0"><defs>
        <radialGradient id="flbl"><stop offset="0.86" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
        <mask id="flbm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>
          <circle cx="${W / 2 - dx}" cy="${cy}" r="${r}" fill="url(#flbl)"/><circle cx="${W / 2 + dx}" cy="${cy}" r="${r}" fill="url(#flbl)"/>
          <rect x="${W / 2 - dx}" y="${cy - r * 0.8}" width="${dx * 2}" height="${r * 1.6}" fill="#000"/></mask></defs>
        <rect width="${W}" height="${H}" fill="#050505" mask="url(#flbm)"/></svg><div class="brg"></div>`;
    }
    const b = Math.round(brg || 0) % 360, pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const txt = String(b).padStart(3, '0') + '° ' + pts[Math.round(b / 22.5) % 16];
    const el = binoc.querySelector('.brg');
    if (el.textContent !== txt) el.textContent = txt;
  };
  U.print = (o) => {
    if (!o) { print.style.display = 'none'; return; }
    print.style.display = 'block';
    const dev = Math.max(0, Math.min(1, o.develop));
    const k = Math.pow(dev, 1.6);
    print.innerHTML = `<div class="card${o.faceDown ? ' down' : ''}"><div class="img" style="background-image:url(${o.faceDown ? '' : o.dataURL || ''});filter:brightness(${0.45 + 0.55 * k}) contrast(${0.25 + 0.75 * k}) saturate(${k}) blur(${(1 - k) * 3}px);opacity:${0.08 + 0.92 * k}"></div>
      <div class="tint" style="opacity:${o.faceDown ? 0 : 0.85 * (1 - k)}"></div>${o.faceDown ? '<div class="back">Polaroid</div>' : ''}</div>
      <div class="hint">${o.resolving ? '<b>Q — TURN IT OVER</b>' : o.faceDown ? 'Face-down · Q to turn it over' : dev < 1 ? 'Developing… Q to shake it · C to put it away' : 'C to put it away · Tab: logbook › photos'}</div>`;
  };
  U.watch = (on, text) => { watch.style.opacity = on ? 1 : 0; if (on) watch.textContent = text; };
  U.fade = (v) => { fade.style.opacity = v; };

  // ---------------- modal pages (logbook, map, notes, lists, screens)
  let modalClose = null;
  U.modalOpen = () => modal.style.display === 'block';
  U.canClose = () => !!modalClose;   // a screen with a way back (Esc = back); title / death / end have none
  U.closeModal = () => { if (!U.modalOpen()) return; modal.style.display = 'none'; modal.innerHTML = ''; const c = modalClose; modalClose = null; c && c(); };
  function openModal(html, cls, onClose) { modal.className = 'fl-modal ' + (cls || ''); modal.innerHTML = html; modal.style.display = 'block'; modalClose = onClose || null; return modal; }
  /** A one-line answer (naming the dog). onDone(value) — Enter or the button; Esc keeps the default. */
  U.ask = (title, text, value, onDone) => {
    let done = false; const finish = (v) => { if (done) return; done = true; onDone(v); };
    const m = openModal(`<div class="paper note ask"><h2>${esc(title)}</h2><p>${esc(text)}</p><input type="text" maxlength="20" value="${esc(value)}" spellcheck="false"><div class="menu"><button data-a="ok">That's her name</button></div></div>`, 'center', () => finish(null));
    const inp = m.querySelector('input'); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(inp.value); U.closeModal(); } });
    m.querySelector('[data-a=ok]').onclick = () => { finish(inp.value); U.closeModal(); };
  };
  U.note = (title, text, onClose) => {
    const m = openModal(`<div class="paper note"><h2>${esc(title)}</h2><p>${esc(text).replace(/\n/g, '<br>')}</p><div class="close">E / Esc</div></div>`, 'center', onClose);
    return m;
  };
  U.logbook = (data, onClose, page = 'tasks') => {
    const tabs = [['tasks', 'Today'], ['rules', 'Rules'], ['tillman', 'Tillman'], ['mine', 'My log'], ['photos', 'Photos']];
    const render = (pg) => {
      let body = '';
      if (pg === 'tasks') body = `<h3>${esc(data.date)}</h3>` + data.tasks.map((t) => `<div class="task${t.done ? ' done' : ''}${t.urgent ? ' urgent' : ''}">${esc(t.text)}${t.hint && !t.done ? `<small>${esc(t.hint)}</small>` : ''}</div>`).join('') +
        `<div class="proof">Proof sent: ${data.proofs} / ${data.proofGoal}</div>`;
      if (pg === 'rules') body = `<div class="card">${data.rules.map((r, i) => `<div class="rule${i >= data.rulesTyped ? ' hand' : ''}"><b>${i + 1}.</b> ${esc(r)}</div>`).join('')}</div>`;
      if (pg === 'tillman') body = data.tillman.length ? data.tillman.map((e) => `<div class="entry${e.pressed ? ' pressed' : ''}"><span>${esc(e.date)}</span> ${esc(e.text)}</div>`).join('') : '<p>Tillman\'s logbook is in the cab, on the desk.</p>';
      if (pg === 'mine') body = data.mine.map((e) => `<div class="entry${e.own ? ' own' : ''}"><span>${esc(e.date)}</span> ${esc(e.text)}</div>`).join('') || '<p>Nothing yet.</p>';
      if (pg === 'photos') body = data.photos.length ? `<div class="grid">${data.photos.map((p) => `<div class="thumb${p.faceDown ? ' down' : ''}" data-id="${p.id}">${p.faceDown ? '<i>face-down</i>' : `<img src="${p.dataURL || ''}" style="filter:brightness(${0.5 + 0.5 * p.develop}) saturate(${p.develop})">`}<em>${esc(p.id)}${p.sent ? ' · sent' : ''}</em></div>`).join('')}</div>` : '<p>No photographs.</p>';
      const m = openModal(`<div class="paper logbook"><div class="tabs">${tabs.map(([k, l]) => `<button data-p="${k}" class="${k === pg ? 'on' : ''}">${l}</button>`).join('')}</div><div class="page">${body}</div><div class="close">Tab / Esc</div></div>`, 'center', onClose);
      m.querySelectorAll('button[data-p]').forEach((b) => b.onclick = () => render(b.dataset.p));
      m.querySelectorAll('.thumb').forEach((t) => t.onclick = () => { data.onPhoto && data.onPhoto(t.dataset.id); });
      if (data.onPage) data.onPage(pg);   // the game hears which page is open (reading the card again completes a task)
    };
    render(page);
  };
  U.map = (data, onClose) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const m = openModal(`<div class="paper mapsheet"><canvas width="${Math.round(1200 * dpr)}" height="${Math.round(900 * dpr)}"></canvas><div class="legend">Trail map — Tamarack Lookout · pinned in the cab · M / Esc</div></div>`, 'center', onClose);
    try { drawMap(m.querySelector('canvas'), { ...data, dpr }); } catch (err) { console.warn('map', err); }
  };
  U.choose = (title, items, onPick, onClose) => {
    const m = openModal(`<div class="paper chooser"><h2>${esc(title)}</h2>${items.length ? items.map((it, i) => `<button data-i="${i}">${it.img ? `<img src="${it.img}">` : ''}<span>${esc(it.label)}</span></button>`).join('') : '<p>Nothing.</p>'}<div class="close">Esc</div></div>`, 'center', onClose);
    m.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => { const it = items[+b.dataset.i]; U.closeModal(); onPick(it); });
  };
  U.screen = (kind, o = {}) => {
    if (kind === 'title') {
      const m = openModal(`<div class="t2">
        <div class="t2-left">
          <div class="t2-kicker">Tamarack Lookout · Silver Fork Ranger District</div>
          <h1 class="t2-title">FALSE<br>LIGHT</h1>
          <div class="t2-rule"></div>
          <div class="t2-tag">August 1983. Fire season. You are alone on a tower thirty metres above the timber.<br>Keep the light. Walk the lost out. Don't look at the man by the creek.</div>
          <nav class="t2-menu">
            ${o.canContinue ? `<button data-a="continue"><span>Continue</span><em>${esc(o.continueLabel || '')}</em></button>` : ''}
            <button data-a="new"><span>${o.canContinue ? 'Begin again' : 'Begin the season'}</span><em>Day 1 · the walk up</em></button>
            <button data-a="settings"><span>Settings</span><em>quality · mouse · sound</em></button>
            <button data-a="controls"><span>Controls</span><em>how to keep the light</em></button>
          </nav>
        </div>
        <div class="t2-foot">
          <button class="t2-sound" data-a="sound">${o.sound ? '◉ Sound on' : '○ Sound off'}</button>
          <span>Headphones. Lights off. Stay on the trail.</span>
          <span class="t2-credit">Built in Blender · textures & scans from Poly Haven and Blender Studio (CC0)</span>
        </div>
      </div>`, 'full clear');
      m.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => o.onAction(b.dataset.a));
      return;
    }
    if (kind === 'controls') {
      const m = openModal(`<div class="paper controls2"><h2>Controls</h2><div class="kgrid">${o.controls.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('')}</div>
        <p class="note2">The searchlight is on the cab roof: work it from the cab or the catwalk. Hold the Morse key while you're on it to flash: <b>··· ——— ···</b>. Every key can be changed in Settings → Keys.</p>
        <div class="menu"><button data-a="back">Back</button></div></div>`, 'center', () => { if (!left) { left = true; o.onBack(); } });
      let left = false;
      m.querySelector('[data-a=back]').onclick = () => { if (!left) { left = true; o.onBack(); } };
      return;
    }
    if (kind === 'settings') {
      const m = openModal(`<div class="paper settings"><h2>Settings</h2>
        <label>Quality <select data-k="quality">${['low', 'medium', 'high'].map((q) => `<option ${q === o.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label>Mouse sensitivity <input data-k="sens" type="range" min="0.4" max="2.5" step="0.1" value="${o.sens}"></label>
        <label>Sound <select data-k="sound"><option value="off" ${o.sound ? '' : 'selected'}>off</option><option value="on" ${o.sound ? 'selected' : ''}>on</option></select></label>
        <label>Volume <input data-k="volume" type="range" min="0" max="1" step="0.05" value="${o.volume}"></label>
        <label>Music <input data-k="music" type="range" min="0" max="1" step="0.05" value="${o.music ?? 0.35}"></label>
        <button class="keysbtn" data-a="keys">Keys… <em>rebind any control</em></button>
        <label>Frame rate <select data-k="fps">${[['30', '30 fps (cooler, longer battery)'], ['60', '60 fps'], ['0', 'uncapped']].map(([v, t]) => `<option value="${v}" ${String(o.fps ?? 60) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Battery saver <select data-k="saver">${[['auto', 'auto (on when unplugged)'], ['on', 'always on'], ['off', 'off']].map(([v, t]) => `<option value="${v}" ${(o.saver || 'auto') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Full screen <select data-k="fullscreen"><option value="on" ${o.fullscreen !== false ? 'selected' : ''}>on (Esc works in menus)</option><option value="off" ${o.fullscreen === false ? 'selected' : ''}>off</option></select></label>
        <button data-a="done">Done</button></div>`, 'center', () => { if (!left) { left = true; o.onDone(read()); } });
      let left = false;
      const read = () => { const v = {}; m.querySelectorAll('[data-k]').forEach((i) => v[i.dataset.k] = i.value); return v; };
      m.querySelector('[data-a=done]').onclick = () => { if (!left) { left = true; o.onDone(read()); } };
      m.querySelector('[data-a=keys]').onclick = () => { if (!left && o.onKeys) { left = true; o.onKeys(read()); } };
      return;
    }
    if (kind === 'keys') {   // o: { actions: [[id, label]], binds: {id: [codes]}, getBinds(), keyName, onSet(id, code), onReset(), onBack() }
      let waiting = null, list = null;
      const render = () => { list.innerHTML = o.actions.map(([id, label]) => `<button data-id="${id}" class="${waiting === id ? 'wait' : ''}"><span>${esc(label)}</span><kbd>${waiting === id ? 'press a key…' : esc((o.binds[id] || []).map(o.keyName).join(' / ') || '—')}</kbd></button>`).join('');
        list.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => { waiting = b.dataset.id; render(); }); };
      const onKey = (e) => {   // capture phase: the game never sees the key you're binding
        if (!waiting) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.code !== 'Escape') { o.onSet(waiting, e.code); o.binds = o.getBinds(); }
        waiting = null; render();
      };
      window.addEventListener('keydown', onKey, true);
      const m = openModal(`<div class="paper keys"><h2>Keys</h2><p class="kh">Click a control, then press the key you want. Esc cancels. Esc always pauses.</p><div class="klist"></div>
        <div class="menu"><button data-a="reset">Reset to defaults</button><button data-a="back">Done</button></div></div>`, 'center', () => { window.removeEventListener('keydown', onKey, true); if (!left) { left = true; o.onBack(); } });
      let left = false;
      list = m.querySelector('.klist');
      m.querySelector('[data-a=reset]').onclick = () => { o.onReset(); o.binds = o.getBinds(); waiting = null; render(); };
      m.querySelector('[data-a=back]').onclick = () => { if (!left) { left = true; o.onBack(); } };
      render();
      return;
    }
    if (kind === 'pause') {
      const m = openModal(`<div class="paper pause"><h2>Paused</h2><div class="menu"><button data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="retry">Restart this ${esc(o.what || 'night')}</button><button data-a="title">Title</button></div></div>`, 'center', o.onClose);
      m.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => o.onAction(b.dataset.a));
      return;
    }
    if (kind === 'death' || kind === 'end') {
      const epi = kind === 'end' && o.paras ? `<div class="epi">${o.paras.map((t, i) => `<p style="animation-delay:${2.2 + i * 3.2}s">${esc(t)}</p>`).join('')}<p class="last" style="animation-delay:${2.8 + o.paras.length * 3.2}s">${esc(o.last || '')}</p></div>` : '';
      const m = openModal(`<div class="title ${kind}"><h1>${kind === 'death' ? '' : 'FALSE LIGHT'}</h1><div class="sub big">${esc(o.text)}</div>${epi}${o.detail ? `<div class="detail"${epi ? ` style="animation:fl-epi 1.5s ${3.6 + (o.paras.length + 1) * 3.2}s both"` : ''}>${esc(o.detail)}</div>` : ''}
        <div class="menu">${kind === 'death' ? '<button data-a="retry">Try again</button>' : ''}<button data-a="title">Title</button></div></div>`, 'full');
      m.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => o.onAction(b.dataset.a));
    }
  };
  U.loading = (f, label) => {
    let l = document.getElementById('fl-loading');
    if (f == null) { if (l) l.remove(); return; }
    if (!l) { l = $('div', '', document.body); l.id = 'fl-loading'; l.innerHTML = '<div class="t">FALSE LIGHT</div><div class="bar"><i></i></div><div class="l"></div><div class="tip"></div>'; }
    const tips = ['Stay on the trail.', 'Count before you answer.', 'Keep one can of fuel above the gate.', 'A real hiker\'s light bobs when they walk.', 'The stairs are not yours after dark.'];
    l.querySelector('.tip').textContent = tips[Math.floor(Date.now() / 6000) % tips.length];
    l.querySelector('i').style.width = Math.round(f * 100) + '%'; l.querySelector('.l').textContent = label || '';
  };
  U.update = (dt) => {
    if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) subs.style.opacity = 0; }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toast.style.opacity = 0; }
  };
  // ---------------- hands, pack, body
  const ICON = {
    fire: '<svg viewBox="0 0 24 24"><path d="M12 2.5c.8 3.6-2.6 5-2.6 8.4 0 1.6 1.2 2.8 2.6 2.8s2.6-1.2 2.6-2.7c0-.9-.3-1.7-.8-2.5 2.8 1.6 4.7 4.3 4.7 7.2A6.5 6.5 0 0 1 12 22a6.5 6.5 0 0 1-6.5-6.3C5.5 9.8 12 8.5 12 2.5z"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2M4 10.3l3.3-.3-.9-3.2M20 13.7l-3.3.3.9 3.2M4 13.7l3.3.3-.9 3.2M20 10.3l-3.3-.3.9-3.2"/></svg>',
    therm: '<svg viewBox="0 0 24 24"><path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0zm1.2 3v7.2a2.9 2.9 0 1 0 1.6 0V7z"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 7.5 2.5c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 2.5C9 7 5.5 10.4 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.4 15 7 12 2.5z"/></svg>',
    food: '<svg viewBox="0 0 24 24"><path d="M6 6.5C6 5.1 8.7 4 12 4s6 1.1 6 2.5v11c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5zm1.6 2.6v6.6c1 .6 2.6 1 4.4 1s3.4-.4 4.4-1V9.1c-1.1.5-2.7.8-4.4.8s-3.3-.3-4.4-.8zM12 5.6c-2.4 0-4.2.5-4.2.9s1.8.9 4.2.9 4.2-.5 4.2-.9-1.8-.9-4.2-.9z"/></svg>',
  };
  U.hotbar = (o) => {
    if (!o) { hot.style.display = 'none'; return; }
    const key = JSON.stringify([o.slots.map((s) => s && [s.label, s.icon.length, s.fill != null ? Math.round(s.fill * 20) : -1]), o.active, o.label, o.pack]);
    hot.style.display = 'flex'; if (hot._k === key) return; hot._k = key;
    hot.innerHTML = `<div class="lbl">${esc(o.label || '')}</div><div class="row">` + o.slots.map((s, i) => `<div class="slot${i === o.active ? ' on' : ''}${s ? '' : ' empty'}"><b>${i + 1}</b>${s ? (s.icon ? `<img src="${s.icon}" alt="">` : `<span>${esc(s.short)}</span>`) : ''}${s && s.fill != null ? `<i><u style="width:${Math.round(s.fill * 100)}%"></u></i>` : ''}</div>`).join('') + `</div><div class="pk">${esc(o.pack || '')}</div>`;
  };
  // the body, minimal: the temperature you feel, then small rings (water, food, health, sleep) that only speak up when
  // they need to; the heart ring beats at your real heart rate. Built once; updates only touch attributes.
  const RING_C = 2 * Math.PI * 15.5;
  let sv = null;
  const buildSurv = () => {
    const ring = (cls, icon, label) => `<div class="ring ${cls}" title="${label}"><svg viewBox="0 0 36 36"><circle class="tr" cx="18" cy="18" r="15.5"/><circle class="ar" cx="18" cy="18" r="15.5" stroke-dasharray="${RING_C} ${RING_C}"/></svg><span class="ic">${icon}</span></div>`;
    surv.innerHTML = `<div class="t"><span class="ti"></span><b></b><small></small></div><div class="rings">${ring('w', ICON.drop, 'Water')}${ring('f', ICON.food, 'Food')}${ring('h', ICON.heart, 'Health')}${ring('s', ICON.moon, 'Sleep')}</div>`;
    const q = (c) => surv.querySelector(c);
    sv = { t: q('.t'), ti: q('.ti'), b: q('.t b'), sm: q('.t small'), rings: {}, last: {}, calmAt: 0 };
    for (const k of ['w', 'f', 'h', 's']) sv.rings[k] = { el: q('.ring.' + k), arc: q('.ring.' + k + ' .ar'), v: -1 };
  };
  U.survival = (o) => {
    if (!o) { surv.style.display = 'none'; return; }
    surv.style.display = 'block'; if (!sv) buildSurv();
    const f = Math.round(o.feels), a = Math.round(o.air);
    const sub = [Math.abs(a - f) >= 3 ? `air ${a}°` : '', o.mph >= 6 ? `${Math.round(o.mph)} mph` : '', o.wet > 0.15 ? 'wet' : ''].filter(Boolean).join(' · ');
    const tcls = o.feels < 36 ? 'freeze' : o.icon === 'snow' ? 'cold' : o.feels > 80 ? 'hot' : o.icon === 'fire' ? 'warm' : 'ok';
    if (sv.last.tcls !== tcls) { sv.t.className = 't ' + tcls; sv.ti.innerHTML = tcls === 'freeze' || tcls === 'cold' ? ICON.snow : tcls === 'hot' || tcls === 'warm' ? ICON.fire : ICON.therm; sv.last.tcls = tcls; }
    if (sv.last.f !== f) { sv.b.textContent = f + '°'; sv.last.f = f; }
    if (sv.last.sub !== sub) { sv.sm.textContent = sub; sv.last.sub = sub; }
    const hp = o.health == null ? 1 : o.health;
    const vals = { w: o.water, f: o.food, h: hp, s: o.sleep == null ? null : o.sleep };
    let loud = tcls !== 'ok';
    for (const k in vals) {
      const R = sv.rings[k], v = vals[k];
      if (v == null) { R.el.style.display = 'none'; continue; }
      R.el.style.display = '';
      const q = Math.round(v * 60) / 60;
      if (q !== R.v) { if (R.v >= 0 && Math.abs(q - R.v) > 0.02) loud = true; R.v = q; R.arc.setAttribute('stroke-dasharray', `${(q * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`); }
      const low = v < (k === 'h' ? 0.35 : 0.2); R.el.classList.toggle('low', low); if (low) loud = true;
      R.el.classList.toggle('full', v > 0.97);
    }
    // the heart ring beats with you (the CSS animation's period = one beat); only re-set when the rate moves
    const bpm = Math.round((o.bpm || 64) / 4) * 4;
    if (bpm !== sv.last.bpm) { sv.rings.h.el.style.setProperty('--beat', (60 / bpm).toFixed(3) + 's'); sv.last.bpm = bpm; }
    sv.rings.h.el.classList.toggle('racing', (o.bpm || 64) > 100); if ((o.bpm || 64) > 100) loud = true;
    // quiet when everything's fine: it fades back after a few seconds of nothing changing
    const now = performance.now(); if (loud) sv.calmAt = now + 5000;
    surv.classList.toggle('calm', now > sv.calmAt);
  };
  U.pack = (d, onPick, onClose) => {
    const cell = (s, w, i, on) => `<button class="cell${s ? '' : ' empty'}${on ? ' on' : ''}" data-w="${w}" data-i="${i}">${w === 'hand' ? `<b>${i + 1}</b>` : ''}${s ? (s.icon ? `<img src="${s.icon}" alt="">` : '') + `<span>${esc(s.label)}</span>` : '<span>empty</span>'}</button>`;
    const m = openModal(`<div class="paper packsheet"><h2>What you're carrying</h2>
      <h3>Hands</h3><div class="row">${d.hands.map((s, i) => cell(s, 'hand', i, i === d.active)).join('')}</div>
      <h3>Backpack</h3>${d.worn ? `<div class="row">${d.pack.map((s, i) => cell(s, 'pack', i)).join('')}</div>` : '<p class="off">You set the pack down somewhere. Its five slots are with it: go back for it (E).</p>'}
      <p class="tip">Click a thing to move it between your hands and the pack. In the world: <b>G</b> sets what's in your hand down anywhere, <b>E</b> picks things up, <b>click</b> uses it (drink, eat, light).</p>
      <div class="close">I / Esc</div></div>`, 'center', onClose);
    m.querySelectorAll('button.cell').forEach((b) => b.onclick = () => onPick(b.dataset.w, +b.dataset.i));
  };
  U.hideHUD = (b) => { root.classList.toggle('nohud', !!b); };
  U.body = (o) => body.update(o); U.bodyClear = () => body.clear(); U.bodyState = () => body.state;
  return U;
}
