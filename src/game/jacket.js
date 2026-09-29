// FALSE LIGHT — Tillman's wool mackinaw: red-and-black buffalo check, four patch pockets, a turned-up collar, hanging from its
// collar loop (it came off a peg in the shed). Built here, not in Blender: a few bent panels and tubes over one plaid canvas.
// Template origin: bottom-centre, the front facing +Z. Worn, it's not drawn (first person); set down, the game lays it flat.
import * as THREE from 'three';

let _plaid = null;
function plaidTexture() {
  if (_plaid) return _plaid;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#7d1814'; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(16,12,12,0.92)'; g.fillRect(0, 0, S / 2, S); g.fillStyle = 'rgba(16,12,12,0.55)'; g.fillRect(0, 0, S, S / 2);   // the checks: black over red, darker where they cross
  let seed = 7; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2600; i++) { g.fillStyle = R() < 0.5 ? `rgba(255,220,200,${R() * 0.07})` : `rgba(0,0,0,${R() * 0.12})`; g.fillRect(R() * S, R() * S, 1, 1 + R() * 2); }   // wool nap
  for (let y = 0; y < S; y += 2) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, y, S, 1); }   // the twill
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.anisotropy = 4;
  return (_plaid = t);
}

/** A panel bent over a gentle curve (the cloth is never flat): w x h, bulging `bulge` towards +z at its middle. */
function panel(w, h, bulge, mat, nx = 6, ny = 8) {
  const g = new THREE.PlaneGeometry(w, h, nx, ny), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2); p.setZ(i, bulge * (1 - x * x) * (0.6 + 0.4 * (1 - y * y)) + 0.006 * Math.sin(x * 9 + y * 5)); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

export function makeJacket() {
  const G = new THREE.Group(); G.name = 'FL_jacket';
  const wool = new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 0.97, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 });
  const H = 0.72, W = 0.5;
  // front and back, hanging: narrower at the shoulders, the hem a little flared
  const front = panel(W, H - 0.08, 0.05, wool); front.position.set(0, (H - 0.08) / 2, 0.055); G.add(front);
  const back = panel(W, H - 0.06, 0.04, wool); back.rotation.y = Math.PI; back.position.set(0, (H - 0.06) / 2 + 0.01, -0.045); G.add(back);
  for (const s of [-1, 1]) {   // the sides, closing the body
    const side = panel(0.1, H - 0.1, 0.01, wool, 2, 6); side.rotation.y = s * Math.PI / 2; side.position.set(s * W / 2, (H - 0.1) / 2, 0.005); G.add(side);
  }
  // shoulders: sloped, from the collar out
  for (const s of [-1, 1]) { const sh = panel(W / 2, 0.11, 0.01, wool, 3, 2); sh.rotation.x = -Math.PI / 2 + 0.35; sh.rotation.z = -s * 0.28; sh.position.set(s * W / 4, H - 0.04, 0.005); G.add(sh); }
  // sleeves: hanging straight down beside the body, a little forward, cuffs turned
  for (const s of [-1, 1]) {
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, H - 0.12, 10, 1, true), wool); sl.position.set(s * (W / 2 + 0.045), (H - 0.12) / 2 + 0.03, 0.015); sl.rotation.z = s * 0.06; sl.castShadow = true; G.add(sl);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 12), wool); cuff.rotation.x = Math.PI / 2; cuff.position.set(s * (W / 2 + 0.05), 0.035, 0.015); G.add(cuff);
  }
  // the collar, turned up, and the hanging loop
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 12, 1, true, -Math.PI * 0.85, Math.PI * 1.7), wool); col.position.set(0, H + 0.01, 0); col.rotation.y = Math.PI; G.add(col);
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), dark); loop.position.set(0, H + 0.045, -0.05); G.add(loop);
  // four patch pockets with flaps, the buttons (dark horn), a placket down the front
  for (const [x, y] of [[-0.12, 0.44], [0.12, 0.44], [-0.13, 0.17], [0.13, 0.17]]) {
    const pk = panel(0.13, 0.12, 0.008, wool, 2, 2); pk.position.set(x, y, 0.1); G.add(pk);
    const fl = panel(0.135, 0.035, 0.004, wool, 2, 1); fl.position.set(x, y + 0.07, 0.108); fl.rotation.x = 0.25; G.add(fl);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8), dark); b.rotation.x = Math.PI / 2; b.position.set(x, y + 0.058, 0.115); G.add(b);
  }
  for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.007, 10), dark); b.rotation.x = Math.PI / 2; b.position.set(0.012, 0.08 + k * 0.13, 0.108); G.add(b); }
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.035, H - 0.1, 0.006), wool); pl.position.set(0, (H - 0.1) / 2 + 0.02, 0.104); G.add(pl);
  return G;
}
