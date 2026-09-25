// FALSE LIGHT — diegetic DOM overlays: the logbook tracker (handwriting on paper), radio subtitles, notes, the
// trail map, the logbook (tasks · rules · Tillman · your log · photos), the print you're holding, the fire-finder
// readout, the searchlight dial, the camera frame, the watch, and title / pause / death / end screens.
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
  let subTimer = 0, toastTimer = 0;

  U.tracker = (v, { date, hour } = {}) => {
    if (!v) { tracker.style.opacity = 0; return; }
    tracker.style.opacity = 1;
    tracker.innerHTML = `<div class="d">${esc(date || '')}</div>` +
      (v.current ? `<div class="c${v.current.urgent ? ' u' : ''}">${esc(v.current.text)}</div><div class="h">${esc(v.current.hint || '')}</div>` : '<div class="c">—</div>') +
      (v.next ? `<div class="n">then: ${esc(v.next.text)}</div>` : '') +
      (v.done || []).slice(-2).map((d) => `<div class="x${d.failed ? ' f' : ''}">${esc(d.text)}</div>`).join('');
  };
  U.subtitle = (who, text, dur = 4, { radio = false, note = false } = {}) => {
    subs.innerHTML = note ? `<span class="note">${esc(text)}</span>` : `<span class="who${radio ? ' r' : ''}">${esc(who)}</span> ${esc(text)}`;
    subs.style.opacity = 1; subTimer = dur;
  };
  U.toast = (text, dur = 3.5) => { toast.textContent = text; toast.style.opacity = 1; toastTimer = dur; };
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
      <div class="morse">${esc(o.morse || '')}</div>
      <div class="hint">${o.power ? 'Mouse aims the lamp · hold SPACE to flash · F / Esc to step back' : 'No power. Start the generator in the shed.'}</div>`;
  };
  U.cameraFrame = (o) => {
    if (!o) { camf.style.display = 'none'; return; }
    camf.style.display = 'block';
    camf.innerHTML = `<div class="frame"></div><div class="info">${o.left} left · flash ${o.flash ? 'ON' : 'off'} (F) · click to take · C to lower</div>`;
  };
  U.binoculars = (on, brg) => {
    binoc.style.display = on ? 'block' : 'none'; if (!on) return;
    const b = Math.round(brg || 0) % 360, pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const txt = String(b).padStart(3, '0') + '° ' + pts[Math.round(b / 22.5) % 16];
    let el = binoc.querySelector('.brg'); if (!el) { el = document.createElement('div'); el.className = 'brg'; binoc.appendChild(el); }
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
  U.closeModal = () => { if (!U.modalOpen()) return; modal.style.display = 'none'; modal.innerHTML = ''; const c = modalClose; modalClose = null; c && c(); };
  function openModal(html, cls, onClose) { modal.className = 'fl-modal ' + (cls || ''); modal.innerHTML = html; modal.style.display = 'block'; modalClose = onClose || null; return modal; }
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
    };
    render(page);
  };
  U.map = (data, onClose) => {
    const m = openModal('<div class="paper mapsheet"><canvas width="900" height="900"></canvas><div class="legend">Trail map — Tamarack Lookout · pinned in the cab · M / Esc</div></div>', 'center', onClose);
    const c = m.querySelector('canvas'), g = c.getContext('2d');
    const { segments, places, player, rect } = data;
    const sx = (x) => ((x - rect.min[0]) / (rect.max[0] - rect.min[0])) * 820 + 40, sz = (z) => ((z - rect.min[1]) / (rect.max[1] - rect.min[1])) * 820 + 40;
    g.fillStyle = '#e8dfc8'; g.fillRect(0, 0, 900, 900);
    // contour-ish hatching from the height samples
    if (data.heightAt) {
      g.globalAlpha = 0.18; g.strokeStyle = '#6d6048'; g.lineWidth = 0.7;
      for (let z = rect.min[1]; z < rect.max[1]; z += 6) for (let x = rect.min[0]; x < rect.max[0]; x += 6) {
        const h = data.heightAt(x, z), h2 = data.heightAt(x + 6, z), h3 = data.heightAt(x, z + 6);
        const lv = Math.floor(h / 5), l2 = Math.floor(h2 / 5), l3 = Math.floor(h3 / 5);
        if (lv !== l2 || lv !== l3) { g.beginPath(); g.moveTo(sx(x), sz(z)); g.lineTo(sx(x) + 1.5, sz(z) + 1.5); g.stroke(); }
      }
      g.globalAlpha = 1;
    }
    if (data.creek) { g.strokeStyle = '#4d6a78'; g.lineWidth = 3; g.beginPath(); data.creek.forEach((p, i) => i ? g.lineTo(sx(p[0]), sz(p[2])) : g.moveTo(sx(p[0]), sz(p[2]))); g.stroke(); }
    if (data.ravine) { g.fillStyle = 'rgba(90,70,50,.25)'; g.beginPath(); data.ravine.forEach((p, i) => i ? g.lineTo(sx(p[0]), sz(p[1])) : g.moveTo(sx(p[0]), sz(p[1]))); g.closePath(); g.fill(); g.fillStyle = '#6b5438'; g.font = 'italic 15px Georgia'; g.fillText('ravine', sx(data.ravine[0][0]) + 10, sz(data.ravine[0][1]) + 40); }
    g.strokeStyle = '#8a2b1d'; g.lineWidth = 2.2; g.setLineDash([7, 5]);
    for (const s of segments) { g.beginPath(); s.points.forEach((p, i) => i ? g.lineTo(sx(p[0]), sz(p[2])) : g.moveTo(sx(p[0]), sz(p[2]))); g.stroke(); }
    g.setLineDash([]);
    g.font = '16px "Bradley Hand","Noteworthy","Segoe Print",cursive'; g.fillStyle = '#2b2419';
    for (const [n, p] of Object.entries(places)) { g.beginPath(); g.arc(sx(p[0]), sz(p[2]), 4, 0, 7); g.fill(); g.fillText(n, sx(p[0]) + 8, sz(p[2]) - 6); }
    if (player) { g.fillStyle = '#b3261e'; g.beginPath(); g.arc(sx(player[0]), sz(player[2]), 7, 0, 7); g.fill(); g.font = 'bold 14px Georgia'; g.fillText('you', sx(player[0]) + 10, sz(player[2]) + 4); }
    g.strokeStyle = '#2b2419'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(850, 110); g.lineTo(850, 60); g.stroke(); g.font = 'bold 18px Georgia'; g.fillText('N', 843, 52);
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
        <p class="note2">The searchlight is on the roof — use the control column in the cab. Hold SPACE while you're on it to flash Morse: <b>··· ——— ···</b></p>
        <div class="menu"><button data-a="back">Back</button></div></div>`, 'center');
      m.querySelector('[data-a=back]').onclick = () => o.onBack();
      return;
    }
    if (kind === 'settings') {
      const m = openModal(`<div class="paper settings"><h2>Settings</h2>
        <label>Quality <select data-k="quality">${['low', 'medium', 'high'].map((q) => `<option ${q === o.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        <label>Mouse sensitivity <input data-k="sens" type="range" min="0.4" max="2.5" step="0.1" value="${o.sens}"></label>
        <label>Sound <select data-k="sound"><option value="off" ${o.sound ? '' : 'selected'}>off</option><option value="on" ${o.sound ? 'selected' : ''}>on</option></select></label>
        <label>Volume <input data-k="volume" type="range" min="0" max="1" step="0.05" value="${o.volume}"></label>
        <label>Full screen <select data-k="fullscreen"><option value="on" ${o.fullscreen !== false ? 'selected' : ''}>on (Esc works in menus)</option><option value="off" ${o.fullscreen === false ? 'selected' : ''}>off</option></select></label>
        <button data-a="done">Done</button></div>`, 'center');
      m.querySelector('[data-a=done]').onclick = () => { const v = {}; m.querySelectorAll('[data-k]').forEach((i) => v[i.dataset.k] = i.value); o.onDone(v); };
      return;
    }
    if (kind === 'pause') {
      const m = openModal(`<div class="paper pause"><h2>Paused</h2><div class="menu"><button data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="retry">Restart this ${esc(o.what || 'night')}</button><button data-a="title">Title</button></div></div>`, 'center', o.onClose);
      m.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => o.onAction(b.dataset.a));
      return;
    }
    if (kind === 'death' || kind === 'end') {
      const m = openModal(`<div class="title ${kind}"><h1>${kind === 'death' ? '' : 'FALSE LIGHT'}</h1><div class="sub big">${esc(o.text)}</div>${o.detail ? `<div class="detail">${esc(o.detail)}</div>` : ''}
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
  U.hideHUD = (b) => { root.classList.toggle('nohud', !!b); };
  return U;
}
