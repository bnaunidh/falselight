// FALSE LIGHT — tents, made here rather than in Blender: a 1970s two-man A-frame (cotton duck, a ridge pole on two
// uprights, guy lines to steel stakes, a groundsheet), the stuff sack you carry an emergency one in, and the abandoned ones
// at the hikers' camp (one sagging, one down and slashed). Canvas is painted once and shared. Origin: centre of the floor,
// the door facing +Z.
import * as THREE from 'three';

let _canvasTex = null, _torn = null;
function canvasTexture() {
  if (_canvasTex) return _canvasTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#6f7353'; g.fillRect(0, 0, S, S);
  let seed = 3; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < S; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + R() * 0.05})`; g.fillRect(0, y, S, 1); }   // the weave
  for (let x = 0; x < S; x += 2) { g.fillStyle = `rgba(255,255,255,${0.02 + R() * 0.03})`; g.fillRect(x, 0, 1, S); }
  for (let i = 0; i < 18; i++) { const r = 12 + R() * 40; const gr = g.createRadialGradient(R() * S, S * (0.55 + R() * 0.45), 0, R() * S, S * (0.55 + R() * 0.45), r); gr.addColorStop(0, 'rgba(50,40,25,0.28)'); gr.addColorStop(1, 'rgba(50,40,25,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }   // mud splash, water stains near the ground
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (_canvasTex = t);
}
function tornAlpha() {   // a long slash through the panel (for the one at the camp)
  if (_torn) return _torn;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.strokeStyle = '#000'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(S * 0.2, S * 0.25); g.lineTo(S * 0.45, S * 0.5); g.lineTo(S * 0.52, S * 0.47); g.lineTo(S * 0.8, S * 0.8); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return (_torn = t);
}

/** A sagging cloth panel between four corners (a, b along the ridge; c, d at the ground), n x n segments. */
function panel(a, b, c, d, sag, mat) {
  const n = 8, pos = [], uv = [], idx = [], A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n; A.lerpVectors(a, b, u); B.lerpVectors(c, d, u); P.lerpVectors(A, B, v);
    P.addScaledVector(nrm, -sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));   // the cloth hangs in between the frame
    pos.push(P.x, P.y, P.z); uv.push(u * 2, v * 1.5);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * (n + 1) + i; idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

/** A pitched A-frame tent. opts: { L (m), W, H, torn, collapsed, tint }. */
export function makeTent({ L = 2.1, W = 1.5, H = 1.1, torn = false, collapsed = false, tint = null } = {}) {
  const G = new THREE.Group(); G.name = 'FL_tent';
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(), color: tint || 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
  const matT = torn ? new THREE.MeshStandardMaterial({ map: canvasTexture(), color: tint || 0xffffff, roughness: 0.95, side: THREE.DoubleSide, alphaMap: tornAlpha(), alphaTest: 0.5 }) : mat;
  const h = collapsed ? H * 0.38 : H, lean = collapsed ? 0.35 : 0;   // down: the ridge fallen to one side
  const r0 = new THREE.Vector3(lean, h, -L / 2), r1 = new THREE.Vector3(lean * 0.6, h * (collapsed ? 0.55 : 1), L / 2);
  const gl = [new THREE.Vector3(-W / 2, 0, -L / 2), new THREE.Vector3(-W / 2, 0, L / 2)], gr = [new THREE.Vector3(W / 2, 0, -L / 2), new THREE.Vector3(W / 2, 0, L / 2)];
  G.add(panel(r0, r1, gl[0], gl[1], collapsed ? 0.18 : 0.05, mat));
  G.add(panel(r1, r0, gr[1], gr[0], collapsed ? 0.1 : 0.05, matT));
  // the back wall (closed) and the door (two flaps, one tied back)
  const tri = (a, b, c, m) => { const g = new THREE.BufferGeometry().setFromPoints([a, b, c]); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2)); g.computeVertexNormals(); const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
  G.add(tri(gl[0], gr[0], r0, mat));
  const dm = new THREE.Vector3(r1.x, 0, L / 2);
  G.add(tri(gl[1], dm.clone().add(new THREE.Vector3(-0.08, 0, 0.02)), r1, mat));                    // left flap, hanging
  G.add(tri(dm.clone().add(new THREE.Vector3(0.35, 0, 0.25)), gr[1], r1, mat));                        // right flap, pulled open
  // frame: ridge + two uprights (dark wood), guy lines, stakes, groundsheet
  const pole = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.8 });
  const stick = (a, b, r = 0.014) => { const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), pole); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; G.add(m); };
  stick(r0, r1); stick(new THREE.Vector3(r0.x, 0, r0.z), r0); if (!collapsed) stick(new THREE.Vector3(r1.x, 0, r1.z), r1); else stick(new THREE.Vector3(0.6, 0.02, L / 2 + 0.3), new THREE.Vector3(-0.3, 0.08, L / 2 + 0.9));   // (one upright lies in the dirt)
  const lineM = new THREE.LineBasicMaterial({ color: 0x8a8272 }), stakeM = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.5, metalness: 0.6 });
  for (const [r, z] of [[r0, -L / 2 - 0.7], [r1, L / 2 + 0.7]]) {
    const s = new THREE.Vector3(r.x, 0.02, z); G.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([r, s]), lineM));
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), stakeM); st.position.set(s.x, 0.05, s.z); st.rotation.z = 0.25; G.add(st);
  }
  for (const p of [...gl, ...gr]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.14, 0.018), stakeM); st.position.set(p.x * 1.04, 0.04, p.z * 1.02); G.add(st); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.96, L * 0.98), new THREE.MeshStandardMaterial({ color: 0x2d3024, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; G.add(floor);
  G.userData.size = { L, W, H };
  return G;
}

/** The stuff sack an emergency tent rides in: olive nylon, drawcord, two straps. */
export function makeTentBag() {
  const G = new THREE.Group(); G.name = 'FL_tent_bag';
  const m = new THREE.MeshStandardMaterial({ color: 0x5b6446, roughness: 0.75 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.36, 14), m); body.rotation.z = Math.PI / 2; body.position.y = 0.08; body.castShadow = true; G.add(body);
  const strap = new THREE.MeshStandardMaterial({ color: 0x2a2a24, roughness: 0.8 });
  for (const x of [-0.09, 0.09]) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.081, 0.006, 5, 18), strap); s.rotation.y = Math.PI / 2; s.position.set(x, 0.08, 0); G.add(s); }
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5), strap); cord.position.set(0.2, 0.08, 0); cord.rotation.z = Math.PI / 2; G.add(cord);
  return G;
}
