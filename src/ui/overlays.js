// FALSE LIGHT — what your body does to the screen: frost creeping in from the edges when you're freezing, sweat beading and
// running when you're overheating, dark veins and a red rim that throb with your heart when you're badly hurt. Each is a
// canvas painted ONCE (lazily, the first time it's needed) and then only faded / pulsed with CSS opacity + transform, so
// it costs the compositor almost nothing. The colour side (desaturation, the blue / amber / red grade, the shimmer) is in
// post.js; these are the textures on top.
const W = 1280, H = 720;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
/** 0 at the centre → 1 at the frame edge (a rounded rectangle, so corners fill first). */
function edgeK(x, y) { const dx = Math.abs(x / W - 0.5) * 2, dy = Math.abs(y / H - 0.5) * 2; return Math.pow(Math.pow(dx, 4) + Math.pow(dy, 4), 0.25); }
function edgePoint(R) {
  const side = R() * 4 | 0, t = R();
  return side === 0 ? [t * W, 0] : side === 1 ? [W, t * H] : side === 2 ? [t * W, H] : [0, t * H];
}

/** Frost: a white rime at the rim, then feathery dendrites growing inward (branching random walks). */
function paintFrost() {
  const c = canvas(), g = c.getContext('2d'), R = rng(71);
  const rim = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.62);
  rim.addColorStop(0, 'rgba(210,230,245,0)'); rim.addColorStop(0.6, 'rgba(210,230,245,0.12)'); rim.addColorStop(1, 'rgba(225,238,248,0.72)');
  g.fillStyle = rim; g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  const grow = (x, y, a, len, w, depth) => {
    for (let i = 0; i < len; i++) {
      const nx = x + Math.cos(a) * 3.2, ny = y + Math.sin(a) * 3.2;
      g.strokeStyle = `rgba(236,246,255,${0.1 + 0.5 * w})`; g.lineWidth = 0.4 + w * 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny; a += (R() - 0.5) * 0.08;   // ice grows straight: needles, with side needles at 60 degrees (hexagonal)
      if (depth < 3 && R() < 0.22) grow(x, y, a + (R() < 0.5 ? 1 : -1) * 1.047, len * (0.2 + R() * 0.25) | 0, w * 0.65, depth + 1);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
    }
  };
  for (let i = 0; i < 170; i++) {
    const [x, y] = edgePoint(R), a = Math.atan2(H / 2 - y, W / 2 - x) + (R() - 0.5) * 1.3;
    grow(x, y, a, 12 + (R() * 40 | 0), 0.55 + R() * 0.45, 0);
  }
  // ice grain: specks, denser at the edges
  for (let i = 0; i < 5000; i++) { const x = R() * W, y = R() * H, k = edgeK(x, y); if (R() > k * k) continue; g.fillStyle = `rgba(245,250,255,${0.15 + R() * 0.5})`; g.fillRect(x, y, 1 + R() * 1.6, 1 + R() * 1.6); }
  return c;
}

/** Sweat: beads clinging to the upper edge and sides, a few running down, each lit like a lens (dark rim, hot highlight). */
function paintSweat() {
  const c = canvas(), g = c.getContext('2d'), R = rng(19);
  const glow = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.66);
  glow.addColorStop(0, 'rgba(255,120,40,0)'); glow.addColorStop(1, 'rgba(210,80,20,0.34)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const bead = (x, y, r) => {
    const b = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    b.addColorStop(0, 'rgba(255,248,235,0.85)'); b.addColorStop(0.25, 'rgba(255,230,200,0.18)'); b.addColorStop(0.8, 'rgba(60,30,10,0.12)'); b.addColorStop(1, 'rgba(30,15,5,0.45)');
    g.fillStyle = b; g.beginPath(); g.ellipse(x, y, r, r * (1.05 + R() * 0.2), 0, 0, 7); g.fill();
  };
  for (let i = 0; i < 150; i++) {
    let x, y; const s = R();
    if (s < 0.55) { x = R() * W; y = Math.pow(R(), 2.2) * H * 0.32; } else { x = (R() < 0.5 ? Math.pow(R(), 2) : 1 - Math.pow(R(), 2)) * W; y = R() * H * 0.8; }
    const r = 2 + Math.pow(R(), 2.5) * 11;
    if (r > 7 && R() < 0.6) {   // a runner: a wet trail below it
      const len = 40 + R() * 160; const tr = g.createLinearGradient(x, y, x, y + len);
      tr.addColorStop(0, 'rgba(255,235,210,0.22)'); tr.addColorStop(1, 'rgba(255,235,210,0)');
      g.strokeStyle = tr; g.lineWidth = r * 0.7; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (R() - 0.5) * 8, y + len * 0.4, x + (R() - 0.5) * 10, y + len * 0.7, x + (R() - 0.5) * 6, y + len); g.stroke();
      bead(x, y + len * (0.6 + R() * 0.4), r * 0.55);
    }
    bead(x, y, r);
  }
  return c;
}

/** Hurt: no lines, no "veins": a soft, blotchy dark-red closing in from the edges (low-res noise, so the browser's own
 *  upscale blurs it like the edge of your sight going), which the heart makes throb. */
function paintHurt() {
  const w = 320, h = 180, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const img = g.createImageData(w, h), R = rng(5);
  const N = 9, lat = Array.from({ length: (N + 1) * (N + 1) }, () => R());
  const vn = (x, y) => { const xi = Math.floor(x) % N, yi = Math.floor(y) % N, xf = x - Math.floor(x), yf = y - Math.floor(y), u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), L = (a, b) => lat[(b % N) * (N + 1) + (a % N)];
    return (L(xi, yi) * (1 - u) + L(xi + 1, yi) * u) * (1 - v) + (L(xi, yi + 1) * (1 - u) + L(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.abs(x / w - 0.5) * 2, dy = Math.abs(y / h - 0.5) * 2, e = Math.pow(Math.pow(dx, 3) + Math.pow(dy, 3), 1 / 3);
    const n = vn(x / w * 6, y / h * 6) * 0.65 + vn(x / w * 13 + 3, y / h * 13 + 7) * 0.35;
    const k = Math.max(0, Math.min(1, (e - 0.5 + (n - 0.5) * 0.35) / 0.5));
    const a = Math.pow(k, 1.6), q = (y * w + x) * 4;
    img.data[q] = 70 + 40 * (1 - k); img.data[q + 1] = 0; img.data[q + 2] = 2; img.data[q + 3] = Math.min(255, a * 245);
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createOverlays(root) {
  const host = document.createElement('div'); host.className = 'fl-body'; root.prepend(host);
  const L = {};
  const layer = (name, paint) => {
    if (L[name]) return L[name];
    const el = document.createElement('div'); el.className = 'fl-body-' + name; host.appendChild(el);
    const cv = paint(); el.style.backgroundImage = `url(${cv.toDataURL('image/png')})`;   // an <img>-like layer the compositor keeps
    return (L[name] = { el, o: -1, s: -1 });
  };
  const set = (l, o, s = 1) => {
    if (Math.abs(o - l.o) > 0.008 || (o === 0 && l.o !== 0)) { l.el.style.opacity = o.toFixed(3); l.o = o; }
    if (Math.abs(s - l.s) > 0.002) { l.el.style.transform = `scale(${s.toFixed(4)})`; l.s = s; }
  };
  const want = { cold: 0, heat: 0, hurt: 0 };
  return {
    /** k: 0..1 each. pulse: the heart's 0..1 envelope (from Fear). Painted lazily: nothing exists until you first need it. */
    update({ cold = 0, heat = 0, hurt = 0, pulse = 0 } = {}) {
      want.cold = cold; want.heat = heat; want.hurt = hurt;
      if (cold > 0.01 || L.cold) set(layer('cold', paintFrost), Math.pow(cold, 0.8), 1.12 - 0.12 * cold);   // it grows inward
      if (heat > 0.01 || L.heat) set(layer('heat', paintSweat), heat * (0.85 + 0.15 * Math.sin(performance.now() / 900)));
      if (hurt > 0.01 || L.hurt) set(layer('hurt', paintHurt), Math.min(1, hurt * (0.6 + 0.4 * pulse)), 1.1 - 0.1 * hurt);   // it closes in as you get worse
    },
    clear() { for (const l of Object.values(L)) set(l, 0); },
    get state() { return { ...want, painted: Object.keys(L) }; },
  };
}
