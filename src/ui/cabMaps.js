// FALSE LIGHT — the two maps in the cab, drawn in-game so they match the world: the trail map pinned on the west wall
// (the same USFS topo sheet M opens, "you are here" at the tower) and the Osborne fire finder's map disc (azimuth ring,
// range rings, the fire ridges and the volcanoes at their real bearings). Both replace blank / stale Blender textures.
import * as THREE from 'three';
import { drawMap } from './mapdraw.js?v=a148af98';
import { MOUNTAINS } from '../engine/mountainsShape.js?v=a148af98';

const SERIF = '"Century Schoolbook","New Century Schoolbook","Georgia","Times New Roman",serif';
const DEG = Math.PI / 180;

function texOf(canvas, aniso = 8) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;   // glTF UVs (the exporter flips V)
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/** The trail map on the west-wall board. The board faces east, so seen from the cab its UV u runs right-to-left: draw mirrored. */
function paintBoard(engine, extra) {
  const W = engine.world, board = W.objects.get('FL_map_board');
  if (!board || !board.isMesh) return false;
  const L = W.layout || {}, places = {};
  for (const k of ['tower', 'trailhead', 'hikers_camp', 'burn_scar', 'spring', 'ravine_overlook', 'creek_bridge']) if (L.places && L.places[k]) places[k.replace('_', ' ')] = L.places[k].position || L.places[k];
  const a = document.createElement('canvas'); a.width = 1250; a.height = 1000;
  drawMap(a, { segments: L.trail ? L.trail.segments : [], places, player: [0, 30, 0], rect: W.rect, heightAt: W.heightAt,
    creek: L.creek && L.creek.points, ravine: L.ravine && L.ravine.polygon, spots: extra.spots || [], heading: 0 });
  const b = document.createElement('canvas'); b.width = a.width; b.height = a.height;
  const g = b.getContext('2d'); g.translate(b.width, 0); g.scale(-1, 1); g.drawImage(a, 0, 0);
  // a pinned sheet: a little grime at the edges and the pin shadows
  g.setTransform(1, 0, 0, 1, 0, 0);
  const v = g.createRadialGradient(b.width / 2, b.height / 2, b.height * 0.45, b.width / 2, b.height / 2, b.width * 0.72);
  v.addColorStop(0, 'rgba(60,45,25,0)'); v.addColorStop(1, 'rgba(60,45,25,0.28)'); g.fillStyle = v; g.fillRect(0, 0, b.width, b.height);
  for (const [x, y] of [[28, 28], [b.width - 28, 28], [28, b.height - 28], [b.width - 28, b.height - 28]]) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(x + 3, y + 4, 9, 0, 7); g.fill();
    g.fillStyle = '#9b2a1c'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(x - 2.5, y - 2.5, 2.5, 0, 7); g.fill();
  }
  // the paper quad's normal faces the wall (Blender winding), so from inside the cab you see its back: draw both sides
  board.material = new THREE.MeshStandardMaterial({ map: texOf(b), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  return true;
}

/** The Osborne map disc: north up, a 12 km radius around the lookout. */
function paintFinder(engine) {
  const W = engine.world; let mat = null;
  if (W.cabRoot) W.cabRoot.traverse((o) => { if (!mat && o.isMesh) for (const m of [].concat(o.material)) if (m && /firefinder_map/i.test(m.name || '')) mat = m; });
  if (!mat) return false;
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2, cy = S / 2, R = 498, RMAP = 440, KM = 12;
  const P = (bearing, m) => { const r = (m / 1000) / KM * RMAP; return [cx + Math.sin(bearing * DEG) * r, cy - Math.cos(bearing * DEG) * r]; };
  // paper
  g.fillStyle = '#e9dfc3'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  for (let i = 0; i < 2600; i++) { const a = Math.random() * 7, r = Math.sqrt(Math.random()) * R; g.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},40,${Math.random() * 0.05})`; g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2); }
  // the ranges: hachured ridge crests from the mountain model's layers (wavy, so they read as country, not circles)
  g.lineCap = 'round';
  (MOUNTAINS.layers || []).forEach((ly, i) => {
    g.strokeStyle = `rgba(110,74,40,${0.5 + i * 0.08})`; g.lineWidth = 1.8 + i * 0.4;
    for (let seg = 0; seg < 36; seg++) {
      const b0 = seg * 10 + ((i * 37) % 10), b1 = b0 + 6 + ((seg * 7 + i) % 3);
      g.beginPath();
      for (let b = b0; b <= b1; b += 0.5) { const wob = Math.sin(b * 0.31 + i * 2.1) * ly.wander * 0.7 + Math.sin(b * 1.7 + i) * ly.wander * 0.25; const [x, y] = P(b, ly.r + wob); b === b0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
      for (let b = b0; b <= b1; b += 1.2) {   // hachures down the slope, toward the lookout
        const wob = Math.sin(b * 0.31 + i * 2.1) * ly.wander * 0.7 + Math.sin(b * 1.7 + i) * ly.wander * 0.25;
        const [x, y] = P(b, ly.r + wob), [x2, y2] = P(b, ly.r + wob - 260 - i * 30); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      }
    }
  });
  // range rings + distance labels
  g.setLineDash([8, 7]); g.strokeStyle = 'rgba(50,40,28,0.6)'; g.lineWidth = 1.6;
  g.font = `italic 15px ${SERIF}`; g.fillStyle = 'rgba(60,50,35,0.7)'; g.textAlign = 'center';
  for (let km = 2; km <= 10; km += 2) { const r = km / KM * RMAP; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); g.fillText(`${km} km`, cx, cy - r - 4); }
  g.setLineDash([]);
  // volcanoes: summit rings + names + elevations (feet, as on a 1983 map)
  for (const v of MOUNTAINS.volcanoes || []) {
    const [x, y] = P(v.bearing, Math.min(v.dist, KM * 1000 * 0.97)), ft = Math.round((1750 + v.h) * 3.2808 / 10) * 10;
    g.strokeStyle = 'rgba(110,70,40,0.75)';
    for (let k = 1; k <= 4; k++) { g.lineWidth = k === 1 ? 1.8 : 1; g.beginPath(); g.arc(x, y, 4 + k * 6, 0, 7); g.stroke(); }
    g.fillStyle = '#3a2c1c'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5.5, y + 4); g.lineTo(x - 5.5, y + 4); g.closePath(); g.fill();
    g.font = `bold 20px ${SERIF}`; g.fillText('MT. ' + v.name.toUpperCase(), x, y + 44); g.font = `italic 15px ${SERIF}`; g.fillText(`${ft.toLocaleString('en-US')} ft`, x, y + 62);
  }
  for (const b of MOUNTAINS.boosts || []) { const [x, y] = P(b.bearing, 8600); g.font = `italic 17px ${SERIF}`; g.fillStyle = '#4a3a26'; g.fillText(b.name, x, y); }
  // the fire ridges the district names (the finder's whole job)
  for (const f of (W.layout && W.layout.fireSites) || []) {
    const [x, y] = P(f.bearingDeg, f.distance); g.fillStyle = '#6b2418';
    g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.closePath(); g.fill();
    g.font = `bold 17px ${SERIF}`; g.fillStyle = '#3a2c1c'; g.fillText(f.name, x, y + 24);
  }
  // the lookout at the centre
  g.strokeStyle = '#1e1810'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 14, cy); g.lineTo(cx + 14, cy); g.moveTo(cx, cy - 14); g.lineTo(cx, cy + 14); g.stroke();
  g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.stroke(); g.font = `bold 16px ${SERIF}`; g.fillStyle = '#1e1810'; g.fillText('TAMARACK L.O.', cx, cy + 34);
  // azimuth ring: 1° ticks, 5° longer, 10° numbered (reading clockwise from true north)
  g.fillStyle = '#efe6cd'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.arc(cx, cy, RMAP + 14, 0, 7, true); g.fill();
  g.strokeStyle = '#2a2014'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R - 1, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, RMAP + 14, 0, 7); g.stroke();
  for (let d = 0; d < 360; d++) {
    const a = d * DEG, s = Math.sin(a), k = -Math.cos(a), len = d % 10 === 0 ? 18 : d % 5 === 0 ? 12 : 6;
    g.lineWidth = d % 10 === 0 ? 1.8 : 1; g.beginPath(); g.moveTo(cx + s * (R - 2), cy + k * (R - 2)); g.lineTo(cx + s * (R - 2 - len), cy + k * (R - 2 - len)); g.stroke();
    if (d % 10 === 0) {
      g.save(); g.translate(cx + s * (R - 32), cy + k * (R - 32)); g.rotate(a); g.font = `bold 15px ${SERIF}`; g.fillStyle = '#2a2014'; g.textAlign = 'center';
      g.fillText(String(d).padStart(3, '0'), 0, 5); g.restore();
    }
  }
  // north
  g.fillStyle = '#8b1c14'; g.beginPath(); g.moveTo(cx, cy - RMAP + 8); g.lineTo(cx + 9, cy - RMAP + 30); g.lineTo(cx - 9, cy - RMAP + 30); g.closePath(); g.fill();
  g.font = `bold 18px ${SERIF}`; g.fillStyle = '#8b1c14'; g.textAlign = 'center'; g.fillText('N', cx, cy - RMAP + 48);
  g.font = `italic 13px ${SERIF}`; g.fillStyle = 'rgba(60,50,35,0.8)'; g.fillText('USDA Forest Service · Silver Fork R.D. · azimuths from true north · 1983', cx, cy + RMAP - 20);
  const t = texOf(c, 16);
  mat.map = t; mat.color && mat.color.set(0xffffff); mat.needsUpdate = true;
  return true;
}

/** Paint both. Call once the world (cab_interior) is loaded; extra.spots = chill benches for the wall map. */
export function paintCabMaps(engine, extra = {}) {
  const out = {};
  try { out.board = paintBoard(engine, extra); } catch (err) { console.warn('cab map board', err); out.board = false; }
  try { out.finder = paintFinder(engine); } catch (err) { console.warn('finder map', err); out.finder = false; }
  return out;
}
