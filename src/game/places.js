// FALSE LIGHT — the places in the woods where the lookouts' papers are (src/game/content/lore.js says what and where).
// Built here from plain shapes and a few painted canvases, small and cheap: each place is one group, hidden past ~220 m.
// Every paper gets an anchor (where its E-prompt sits); a paper you can take is a thing you can see (a page, a notebook,
// a can), hidden once taken. Big pieces get a wall collider so you can't walk through a barrel or a fuselage.
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const lettered = (lines, { bg = '#d8d2bf', ink = '#2a2622', font = 'bold 26px Georgia, serif', w = 256, h = 128 } = {}) => tex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = ink; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 30));
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }   // weather
});

export function createPlaces(engine, { PLACES, extra = {} } = {}) {
  const { scene } = engine, W = engine.world, H = (x, z) => W.heightAt(x, z);
  const M = {
    rust: new THREE.MeshStandardMaterial({ color: 0x6b3d22, roughness: 0.9, metalness: 0.3 }),
    tin: new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.6, metalness: 0.5 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a4834, roughness: 0.9 }),
    char: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.9, side: THREE.DoubleSide }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2a5d9a, roughness: 0.8, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a2a22, roughness: 0.7, side: THREE.DoubleSide }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4d5236, roughness: 0.7, metalness: 0.3 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x5d625d, roughness: 0.8, metalness: 0.45 }),   // twenty years in the timber: grey, lichened, dull
    conc: new THREE.MeshStandardMaterial({ color: 0x8b877e, roughness: 0.95 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }),
    glassA: new THREE.MeshStandardMaterial({ color: 0x7a4a14, roughness: 0.2, transparent: true, opacity: 0.75 }),
    glassB: new THREE.MeshStandardMaterial({ color: 0x1d3c7a, roughness: 0.2, transparent: true, opacity: 0.75 }),
  };
  const groups = [], anchors = {}, docProps = {}, colliders = [], cedarBark = [];
  // the forest's own bark (a real tree's trunk material), re-tiled for a 20 m snag; plain brown if none is loaded yet
  let bark = null; const findBark = () => scene.traverse((o) => { if (bark || !o.isMesh || !o.material || Array.isArray(o.material)) return; if (/bark|trunk/i.test(o.material.name || '') && o.material.map) bark = o.material; }); findBark();
  const barkMat = (rx, ry, tint) => { if (!bark) return new THREE.MeshStandardMaterial({ color: tint, roughness: 1, side: THREE.DoubleSide }); const m = bark.clone(); m.side = THREE.DoubleSide; m.color = new THREE.Color(tint);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m[k]) { m[k] = m[k].clone(); m[k].wrapS = m[k].wrapT = THREE.RepeatWrapping; m[k].repeat.set(rx, ry); m[k].needsUpdate = true; } return m; };
  const mesh = (g, geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const wall = (g, sx, sy, sz, x, y, z, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ visible: false })); o.position.set(x, y, z); o.rotation.y = ry; o.visible = false; g.add(o); o.updateMatrixWorld(true); const c = { name: 'COL_wall_place_' + groups.length + '_' + colliders.length, type: 'wall', mesh: o, enabled: true }; colliders.push(c); (W.colliders || (W.colliders = [])).push(c); return c; };
  const place = (id) => { const p = PLACES.find((q) => q.id === id); const g = new THREE.Group(); g.name = 'FL_place_' + id; scene.add(g); groups.push({ g, x: p.xz[0], z: p.xz[1] }); return { g, x: p.xz[0], z: p.xz[1], y: H(p.xz[0], p.xz[1]) }; };
  const at = (id, x, y, z) => { anchors[id] = V3(x, y, z); };
  const paperOn = (g, id, x, y, z, ry = 0, notebook = false) => { const m = notebook ? mesh(g, new THREE.BoxGeometry(0.16, 0.02, 0.22), M.paper, x, y + 0.01, z, ry) : mesh(g, new THREE.PlaneGeometry(0.21, 0.28), M.paper, x, y + 0.01, z, ry, -Math.PI / 2); docProps[id] = m; at(id, x, y + 0.15, z); return m; };
  const R = (() => { let s = 1983; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

  // ---- the dump below the west side: a burn barrel on a ring of stones, fifty years of cans down the slope
  { const { g, x, z, y } = place('dump');
    mesh(g, new THREE.CylinderGeometry(0.3, 0.29, 0.88, 14, 1, true), M.rust, x, y + 0.44, z); mesh(g, new THREE.CircleGeometry(0.29, 14), M.char, x, y + 0.6, z, 0, -Math.PI / 2); wall(g, 0.7, 1, 0.7, x, y + 0.5, z);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; mesh(g, new THREE.DodecahedronGeometry(0.12), M.stone, x + Math.cos(a) * 0.45, y + 0.05, z + Math.sin(a) * 0.45); }
    const can = new THREE.CylinderGeometry(0.04, 0.04, 0.11, 8);
    for (let i = 0; i < 40; i++) { const cx = x - 1 - R() * 6, cz = z - 3 + R() * 6; mesh(g, can, R() < 0.5 ? M.rust : M.tin, cx, H(cx, cz) + 0.04, cz, R() * 6, Math.PI / 2, R()); }
    for (let i = 0; i < 6; i++) { const cx = x - 1.5 - R() * 4, cz = z - 2 + R() * 4; mesh(g, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), R() < 0.5 ? M.glassA : M.glassB, cx, H(cx, cz) + 0.04, cz, R() * 6, Math.PI / 2); }
    paperOn(g, 'dump_pages', x, y + 0.6, z, 0.4);   // in the ash, in the barrel
    const bx = x - 1.6, bz = z + 0.7; mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8), M.glassA, bx, H(bx, bz) + 0.035, bz); at('dump_label', bx, H(bx, bz) + 0.15, bz);
    const cx = x - 2.4, cz = z - 0.8; docProps.dump_tag = mesh(g, new THREE.TorusGeometry(0.07, 0.012, 5, 14), M.wood, cx, H(cx, cz) + 0.02, cz, 0, Math.PI / 2); at('dump_tag', cx, H(cx, cz) + 0.15, cz);
  }
  // ---- Ellen's cairn on the rim, and the little stacked stones that lead to it from the overlook rail
  { const { g, x, z, y } = place('cairn');
    for (let i = 0; i < 46; i++) { const k = i / 46, r = 0.75 * (1 - k) + 0.1, a = R() * Math.PI * 2; mesh(g, new THREE.DodecahedronGeometry(0.11 + R() * 0.09), M.stone, x + Math.cos(a) * r * R(), y + k * 1.0, z + Math.sin(a) * r * R(), R() * 6); }
    wall(g, 1.3, 1.1, 1.3, x, y + 0.5, z);
    mesh(g, new THREE.BoxGeometry(0.04, 1.3, 0.04), M.tin, x + 0.9, y + 0.65, z);
    mesh(g, new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({ map: lettered(['ELLEN MAKI', 'SHE KEPT IT LIT'], { bg: '#cfc9b8', font: 'bold 24px Georgia, serif' }), roughness: 0.9, side: THREE.DoubleSide }), x + 0.9, y + 1.05, z + 0.03);
    at('cairn_board', x + 0.9, y + 1.05, z + 0.2);
    mesh(g, new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xbfd2cc, transparent: true, opacity: 0.45, roughness: 0.1 }), x - 0.35, y + 0.75, z + 0.35); mesh(g, new THREE.CylinderGeometry(0.065, 0.065, 0.03, 12), M.tin, x - 0.35, y + 0.85, z + 0.35);
    at('cairn_jar', x - 0.35, y + 0.9, z + 0.45); at('cairn_page', x - 0.42, y + 0.9, z + 0.32);
    for (let k = 0; k < 6; k++) { const dx = 80 + Math.sin(k) * 1, dz = 22 - k * 14; for (let s = 0; s < 3; s++) mesh(g, new THREE.DodecahedronGeometry(0.09 - s * 0.02), M.stone, dx, H(dx, dz) + 0.06 + s * 0.11, dz, R() * 6); }
  }
  // ---- Dale's last camp: a sun-rotted blue tarp, a pad, a red day pack, the camera still on its tripod aimed at the tower
  { const { g, x, z, y } = place('tarp');
    const tg = new THREE.PlaneGeometry(2.6, 2.2, 8, 8), p = tg.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 1.3, v = p.getY(i) / 1.1; p.setZ(i, -0.35 * (1 - u * u) * (1 - v * v) - (u > 0.6 && v < -0.4 ? 0.6 : 0)); } tg.computeVertexNormals();
    mesh(g, tg, M.blue, x, y + 1.5, z, 0.3, -Math.PI / 2 + 0.25);
    mesh(g, new THREE.BoxGeometry(0.55, 0.02, 1.8), new THREE.MeshStandardMaterial({ color: 0x77786f, roughness: 0.95 }), x, y + 0.01, z + 0.1, 0.3);
    mesh(g, new THREE.BoxGeometry(0.3, 0.4, 0.18), M.red, x + 0.7, y + 0.2, z - 0.4, 0.8); at('tarp_film', x + 0.7, y + 0.5, z - 0.4); docProps.tarp_film = null;
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; mesh(g, new THREE.CylinderGeometry(0.012, 0.012, 1.35, 5), M.black, x + 1.6 + Math.cos(a) * 0.2, y + 0.65, z + 0.9 + Math.sin(a) * 0.2, 0, Math.sin(a) * 0.15, Math.cos(a) * 0.15); }
    mesh(g, new THREE.BoxGeometry(0.15, 0.1, 0.08), M.black, x + 1.6, y + 1.38, z + 0.9, 106 * Math.PI / 180); mesh(g, new THREE.BoxGeometry(0.13, 0.015, 0.07), M.alu, x + 1.6, y + 1.44, z + 0.9, 106 * Math.PI / 180);
    mesh(g, new THREE.DodecahedronGeometry(0.22), M.stone, x - 0.9, y + 0.08, z + 0.9); paperOn(g, 'tarp_notebook', x - 0.6, y + 0.02, z + 0.9, 0.2, true);
    at('tarp_prints', x + 0.2, y + 0.4, z + 0.2);
  }
  // ---- the stake where the 1980 fire started: flagging, a ring of stones, a lantern fused to a charred stump, an ammo can
  { const { g, x, z, y } = place('stake');
    mesh(g, new THREE.BoxGeometry(0.035, 1.1, 0.02), M.wood, x, y + 0.55, z);
    for (let k = 0; k < 4; k++) mesh(g, new THREE.PlaneGeometry(0.035, 0.45), k % 2 ? M.paper : M.red, x + 0.03 + k * 0.012, y + 0.9 - k * 0.02, z, 0.4 + k * 0.3, 0, 0.3);
    at('stake_tag', x, y + 1.0, z + 0.15);
    mesh(g, new THREE.CylinderGeometry(0.35, 0.42, 0.55, 10), M.char, x + 1.4, y + 0.27, z + 0.3); wall(g, 0.9, 0.6, 0.9, x + 1.4, y + 0.3, z + 0.3);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; mesh(g, new THREE.DodecahedronGeometry(0.1), M.stone, x + 1.4 + Math.cos(a) * 0.7, y + 0.05, z + 0.3 + Math.sin(a) * 0.7); }
    mesh(g, new THREE.CylinderGeometry(0.08, 0.1, 0.22, 10), M.char, x + 1.4, y + 0.66, z + 0.3); mesh(g, new THREE.TorusGeometry(0.1, 0.006, 4, 12, Math.PI), M.char, x + 1.4, y + 0.82, z + 0.3);
    docProps.stake_notes = mesh(g, new THREE.BoxGeometry(0.28, 0.18, 0.14), M.olive, x + 0.25, y + 0.09, z + 0.15, 0.3); at('stake_notes', x + 0.25, y + 0.3, z + 0.15);
  }
  // ---- the lamp tree: a hollowed old cedar snag, black inside, lights on every ledge, a tin plate over the opening
  { const { g, x, z, y } = place('cedar');
    const gap = 1.2;   // the opening: a fire-hollowed doorway on the side facing the trail (+z), tall enough to step into
    cedarBark.push([mesh(g, new THREE.CylinderGeometry(1.3, 1.95, 17.6, 14, 1, true), barkMat(4, 8, 0x8a7a6a), x, y + 2.4 + 8.8, z), 4, 8, 0x8a7a6a]);
    cedarBark.push([mesh(g, new THREE.CylinderGeometry(1.95, 2.25, 2.4, 14, 1, true, gap / 2, Math.PI * 2 - gap), barkMat(4, 1, 0x2a2420), x, y + 1.2, z), 4, 1, 0x2a2420]);   // fire-blackened at its foot
    mesh(g, new THREE.CylinderGeometry(1.75, 1.95, 2.4, 12, 1, true, gap / 2, Math.PI * 2 - gap), new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 1, side: THREE.BackSide }), x, y + 1.2, z);
    mesh(g, new THREE.CircleGeometry(1.9, 14), new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 1 }), x, y + 2.4, z, 0, Math.PI / 2);   // the dark up inside it
    const lite = new THREE.CylinderGeometry(0.025, 0.03, 0.17, 8);
    for (let i = 0; i < 18; i++) { const a = Math.PI * 2 * R(), r = 1.0 + R() * 0.6; mesh(g, lite, R() < 0.3 ? M.red : R() < 0.5 ? M.alu : M.tin, x + Math.cos(a) * r, y + 0.3 + R() * 2.2, z + Math.sin(a) * r, R() * 6, R(), R()); }
    mesh(g, new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({ map: lettered(['FOR THE LAMP', 'TAKE THESE · NOT US'], { bg: '#8a8478', ink: '#1e1c18', font: 'bold 22px monospace' }), roughness: 0.6, metalness: 0.5 }), x, y + 2.7, z + 2.02, 0);
    at('cedar_plate', x, y + 2.7, z + 2.3); at('cedar_notes', x + 0.7, y + 1.4, z + 1.9); at('cedar_carving', x - 0.8, y + 1.0, z + 1.9);
  }
  // ---- Tanker 14: the borate bomber in the timber on the Hatchet line, broken behind the cockpit, the tail still up
  { const { g, x, z, y } = place('tanker');
    const fus = mesh(g, new THREE.CylinderGeometry(0.75, 0.55, 8.5, 14), M.alu, x, y + 0.6, z, 0.4, 0, Math.PI / 2 - 0.12); fus.rotation.order = 'YZX'; wall(g, 8.5, 1.5, 1.6, x, y + 0.6, z, 0.4);
    mesh(g, new THREE.BoxGeometry(6.5, 0.14, 1.9), M.alu, x - 6, y + 0.5, z + 5, 1.1, 0.3, 0.2); wall(g, 6.5, 0.8, 1.9, x - 6, y + 0.5, z + 5, 1.1);
    const tail = mesh(g, new THREE.BoxGeometry(0.1, 1.9, 1.5), new THREE.MeshStandardMaterial({ map: lettered(['14'], { bg: '#8d9290', ink: '#7a2a1a', font: 'bold 70px Arial, sans-serif', w: 128, h: 128 }), roughness: 0.5, metalness: 0.6 }), x + 4.2, y + 1.6, z - 1.7, 0.4);
    mesh(g, new THREE.CylinderGeometry(0.75, 0.75, 0.7, 14), M.black, x - 4.6, y + 0.4, z + 1.9, 0.4, 0, Math.PI / 2);
    for (let k = 0; k < 3; k++) mesh(g, new THREE.BoxGeometry(0.12, 1.4, 0.05), M.black, x - 5.0, y + 0.5, z + 2.1, 0.4, k * 2.1, 0.3);
    at('tanker_plate', x + 4.2, y + 1.2, z - 1.4); paperOn(g, 'tanker_kneeboard', x - 1.2, y + 0.05, z + 1.4, 0.7, true); paperOn(g, 'tanker_note', x + 1.0, y + 0.05, z + 1.3, -0.4);
  }
  // ---- Camp F-43: stone gateposts, the concrete pads of the barracks, a standing chimney
  { const { g, x, z, y } = place('ccc');
    for (const s of [-1, 1]) { mesh(g, new THREE.BoxGeometry(0.7, 1.7, 0.7), M.stone, x + s * 2.4, y + 0.85, z + 6); wall(g, 0.8, 1.8, 0.8, x + s * 2.4, y + 0.9, z + 6); }
    mesh(g, new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: lettered(['CO. 1492', 'C.C.C.'], { bg: '#6d6a60', ink: '#d8d2bf', font: 'bold 26px Georgia, serif' }), roughness: 0.9 }), x - 2.4, y + 1.3, z + 6.36);
    for (const [dx, dz] of [[-6, -4], [3, -6], [-1, -14]]) { mesh(g, new THREE.BoxGeometry(6, 0.3, 4), M.conc, x + dx, H(x + dx, z + dz) + 0.1, z + dz); }
    mesh(g, new THREE.BoxGeometry(0.8, 3.2, 0.8), M.stone, x + 3, y + 1.6, z - 6); wall(g, 0.9, 3.2, 0.9, x + 3, y + 1.6, z - 6);
    paperOn(g, 'ccc_echo', x - 5.6, H(x - 6, z - 4) + 0.26, z - 4.2, 0.5); paperOn(g, 'ccc_letter', x + 3.4, y + 0.05, z - 5.3, -0.3);
  }
  // ---- Tamarack Point: the first lookout's cabin fallen in, the dead lookout tree with its crow's nest, Pike's grave plate
  { const { g, x, z, y } = place('point');
    for (const [sx, sz, dx, dz, h] of [[3.6, 0.2, 0, -1.8, 0.9], [3.6, 0.2, 0, 1.8, 0.6], [0.2, 3.6, -1.8, 0, 1.1], [0.2, 2.2, 1.8, -0.7, 0.5]]) { mesh(g, new THREE.BoxGeometry(sx, h, sz), M.wood, x + dx, y + h / 2, z + dz); wall(g, sx, h, sz, x + dx, y + h / 2, z + dz); }
    mesh(g, new THREE.PlaneGeometry(3.4, 2.6), M.tin, x + 0.3, y + 0.5, z + 0.2, 0.2, -Math.PI / 2 + 0.35, 0.15);
    mesh(g, new THREE.CylinderGeometry(0.18, 0.4, 24, 8), new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }), x + 6, H(x + 6, z + 3) + 12, z + 3); mesh(g, new THREE.BoxGeometry(1.2, 0.8, 1.2), M.wood, x + 6, H(x + 6, z + 3) + 22.5, z + 3);
    paperOn(g, 'point_ledger', x - 0.8, y + 0.05, z - 0.7, 0.3, true); paperOn(g, 'point_card', x - 1.6, y + 0.8, z + 0.3, 0); paperOn(g, 'point_drawing', x + 0.9, y + 0.05, z + 0.9, -0.6);
    mesh(g, new THREE.BoxGeometry(0.5, 0.06, 0.3), M.conc, x - 3, H(x - 3, z + 4) + 0.03, z + 4); at('point_grave', x - 3, H(x - 3, z + 4) + 0.2, z + 4);
  }
  // ---- the gage below the Cut: a little concrete gage house, its stilling-well pipe down into a dry wash
  { const { g, x, z, y } = place('gage');
    mesh(g, new THREE.BoxGeometry(1.3, 1.9, 1.3), M.conc, x, y + 0.95, z); wall(g, 1.4, 2, 1.4, x, y + 1, z);
    mesh(g, new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshStandardMaterial({ map: lettered(['U.S.G.S.', '14-1575.00'], { bg: '#5e6a5c', ink: '#e8e2cf', font: 'bold 24px Arial, sans-serif' }), roughness: 0.6 }), x, y + 1.4, z + 0.66);
    mesh(g, new THREE.CylinderGeometry(0.15, 0.15, 2.4, 10), M.rust, x + 0.9, y + 0.4, z + 0.2); at('gage_desc', x, y + 1.4, z + 0.85); paperOn(g, 'gage_chart', x + 0.3, y + 0.02, z + 0.95, 0.2);
  }
  // ---- places built elsewhere: their papers sit where the game says (the cache, the station, the stairs, the trapper's cabin)
  for (const [id, v] of Object.entries(extra)) if (v) at(id, v.x, v.y, v.z);

  for (const c of colliders) c.mesh.updateMatrixWorld(true);
  if (engine.player && engine.player.rebuildColliders) engine.player.rebuildColliders();
  let acc = 0;
  return {
    anchors, docProps,
    /** A taken paper leaves the world. */
    take(id) { const m = docProps[id]; if (m) m.visible = false; },
    reset(flags) { for (const [id, m] of Object.entries(docProps)) if (m) m.visible = !flags['taken_' + id]; },
    update(dt, cam) { if ((acc -= dt) > 0) return; acc = 0.5; for (const p of groups) p.g.visible = Math.hypot(cam.x - p.x, cam.z - p.z) < 230;
      if (!bark && cedarBark.length && (this._barkT = (this._barkT || 0) + 1) % 10 === 0) { findBark(); if (bark) for (const [m, rx, ry, tint] of cedarBark) m.material = barkMat(rx, ry, tint); } },   // the forest streamed in: the lamp tree gets real bark
  };
}
