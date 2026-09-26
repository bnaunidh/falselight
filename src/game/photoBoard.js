// FALSE LIGHT — the cork board in the cab: pin the print in your hand, take one down again. Pinned prints are the real
// photographs (still developing if they're fresh: they come up out of the murk on the board), white backs when face-down,
// each on a red pushpin at a slight angle. Twelve fit. Pure view: the game owns which prints are pinned (print.pin = slot).
import * as THREE from 'three';

const COLS = 4, ROWS = 3, PW = 0.088, PH = 0.107;   // an instant print, in metres

function corkTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = S; c.height = Math.round(S * 0.72); const g = c.getContext('2d');
  g.fillStyle = '#9a7248'; g.fillRect(0, 0, c.width, c.height);
  let seed = 11; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26000; i++) { const t = R(); g.fillStyle = t < 0.5 ? `rgba(70,45,22,${0.25 + R() * 0.35})` : t < 0.85 ? `rgba(190,150,100,${0.2 + R() * 0.3})` : `rgba(40,25,12,${0.4 + R() * 0.3})`; g.fillRect(R() * c.width, R() * c.height, 1 + R() * 2.2, 1 + R() * 2.2); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(30,20,10,0.5)'; g.beginPath(); g.arc(R() * c.width, R() * c.height, 1.2, 0, 7); g.fill(); }   // old pin holes
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** at: { center: Vector3 (board face centre), normal: Vector3 (into the room) }. */
export function createPhotoBoard(scene, at, { w = 0.72, h = 0.52 } = {}) {
  const group = new THREE.Group(); group.name = 'FL_photo_board';
  const n = at.normal.clone().normalize(), right = new THREE.Vector3(0, 1, 0).cross(n).normalize();   // board's own right, seen from the room
  group.position.copy(at.center); group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), n));
  const cork = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), new THREE.MeshStandardMaterial({ map: corkTexture(), roughness: 0.95 }));
  cork.position.z = -0.006; group.add(cork);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4027, roughness: 0.7 });
  for (const [bw, bh, x, y] of [[w + 0.05, 0.025, 0, h / 2 + 0.012], [w + 0.05, 0.025, 0, -h / 2 - 0.012], [0.025, h, -w / 2 - 0.012, 0], [0.025, h, w / 2 + 0.012, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.024), wood); b.position.set(x, y, 0); group.add(b);
  }
  scene.add(group);
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xa3261b, roughness: 0.35, metalness: 0.1 });
  const back = new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.8 });
  const slots = Array.from({ length: COLS * ROWS }, (_, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = (col - (COLS - 1) / 2) * (w / COLS) + Math.sin(i * 7.3) * 0.012, y = ((ROWS - 1) / 2 - row) * (h / ROWS) + Math.cos(i * 3.1) * 0.01;
    const card = new THREE.Group(); card.position.set(x, y, 0.004); card.rotation.z = Math.sin(i * 12.9) * 0.09; card.visible = false; group.add(card);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), back); frame.position.z = 0.0005; card.add(frame);                 // the white instant-print border
    const img = new THREE.Mesh(new THREE.PlaneGeometry(PW * 0.86, PW * 0.86), new THREE.MeshStandardMaterial({ color: 0x223028, roughness: 0.6 }));
    img.position.set(0, (PH - PW) / 2 - 0.004, 0.001); card.add(img);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), pinMat); pin.position.set(0, PH / 2 - 0.008, 0.006); card.add(pin);
    return { card, img, id: null, url: null };
  });
  const loader = new THREE.TextureLoader();
  const api = {
    group, slots: slots.length,
    /** Where you stand to use it (the IA point, a hand's reach out from the face). */
    anchor: at.center.clone().addScaledVector(n, 0.25),
    center: at.center.clone(),
    /** prints: the game's print objects with p.pin = slot index (or null). Cheap to call every second. */
    sync(prints) {
      const bySlot = new Map(); for (const p of prints) if (p.pin != null && !p.sent) bySlot.set(p.pin, p);
      slots.forEach((s, i) => {
        const p = bySlot.get(i); s.card.visible = !!p; if (!p) { s.id = null; return; }
        const m = s.img.material;
        if (p.faceDown) { if (m.map) { m.map = null; m.needsUpdate = true; } m.color.set(0xece8dc); s.id = p.id; s.url = null; return; }   // the back: blank white
        if (p.dataURL && s.url !== p.dataURL) { s.url = p.dataURL; loader.load(p.dataURL, (tx) => { tx.colorSpace = THREE.SRGBColorSpace; if (s.url === p.dataURL) { m.map = tx; m.needsUpdate = true; } }); }
        s.id = p.id;
        const k = Math.max(0, Math.min(1, p.develop ?? 1));   // murky green-grey → the picture
        m.color.setRGB(0.13 + 0.87 * k, 0.19 + 0.81 * k, 0.16 + 0.84 * k);
      });
    },
    /** World position of a slot's card (for 'the one you're looking at'). */
    slotPos(i) { const s = slots[i]; return s ? s.card.getWorldPosition(new THREE.Vector3()) : null; },
    freeSlot(prints) { const used = new Set(prints.filter((p) => p.pin != null && !p.sent).map((p) => p.pin)); for (let i = 0; i < slots.length; i++) if (!used.has(i)) return i; return -1; },
  };
  return api;
}
