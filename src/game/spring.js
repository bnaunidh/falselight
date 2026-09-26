// FALSE LIGHT — the spring, running: a thin stream out of the galvanized pipe into the half-barrel, rings spreading where it
// lands, and the overflow: a dark, wet run down the slope across the trail. (The pipe, the barrel and the mossy rock are the
// prop_spring model; this is only the water.) Cheap: one tube, a few rings, one ground strip; one texture scroll per frame.
import * as THREE from 'three';

function streakTexture() {   // flowing water: soft streaks, scrolled along the stream
  const W = 32, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#9aa'; g.fillRect(0, 0, W, H);
  let seed = 5; const R = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 70; i++) { const x = R() * W, y = R() * H, l = 6 + R() * 24; g.strokeStyle = `rgba(255,255,255,${0.2 + R() * 0.5})`; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 2, y + l); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}

/** outlet: the pipe's mouth; surface: the barrel's water centre (its y = the waterline); radius: the barrel's. */
export function makeSpringFlow(scene, { outlet, surface, radius = 0.45, heightAt }) {
  const G = new THREE.Group(); G.name = 'FL_spring_flow'; scene.add(G);
  // the stream: out of the pipe a hand's width, then falling into the barrel
  const land = surface.clone().lerp(new THREE.Vector3(outlet.x, surface.y, outlet.z), 0.55); land.y = surface.y + 0.002;
  const curve = new THREE.CatmullRomCurve3([outlet.clone(), outlet.clone().add(new THREE.Vector3(0, -0.01, 0)).lerp(land, 0.15).setY(outlet.y - 0.012), outlet.clone().lerp(land, 0.55).setY((outlet.y + land.y) / 2 - 0.02), land]);
  const tex = streakTexture(); tex.repeat.set(1, 2.5);
  const sm = new THREE.MeshStandardMaterial({ color: 0xcfdbe0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.62, alphaMap: tex, depthWrite: false, envMapIntensity: 1.2 });
  const stream = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.009, 7, false), sm); stream.renderOrder = 3; G.add(stream);
  // rings on the barrel's water where it lands
  const ringM = new THREE.MeshBasicMaterial({ color: 0xe8f0f2, transparent: true, opacity: 0, depthWrite: false });
  const rings = [0, 1, 2].map((i) => { const r = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.037, 24), ringM.clone()); r.rotation.x = -Math.PI / 2; r.position.copy(land).add(new THREE.Vector3(0, 0.003, 0)); r.renderOrder = 3; G.add(r); return { m: r, t: i / 3 }; });
  // the overflow: down the slope from the barrel, across the trail: dark and wet, glinting, fading out
  let dx = 0, dz = 0; if (heightAt) { dx = heightAt(surface.x - 1, surface.z) - heightAt(surface.x + 1, surface.z); dz = heightAt(surface.x, surface.z - 1) - heightAt(surface.x, surface.z + 1); }
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;   // downhill
  const pts = [], n = 14, len = 3.4, side = new THREE.Vector3(-dz, 0, dx);
  for (let i = 0; i <= n; i++) { const k = i / n, x = surface.x + dx * (radius + k * len) + side.x * Math.sin(k * 5) * 0.12, z = surface.z + dz * (radius + k * len) + side.z * Math.sin(k * 5) * 0.12; pts.push(new THREE.Vector3(x, (heightAt ? heightAt(x, z) : surface.y - 0.5) + 0.015, z)); }
  const pos = [], uv = [], idx = [];
  pts.forEach((p, i) => { const w = 0.22 * (1 - i / n * 0.5); pos.push(p.x - side.x * w, p.y, p.z - side.z * w, p.x + side.x * w, p.y, p.z + side.z * w); uv.push(0, i / n, 1, i / n); if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } });
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wg.setIndex(idx); wg.computeVertexNormals();
  const fc = document.createElement('canvas'); fc.width = 16; fc.height = 64; const fg = fc.getContext('2d'), gr = fg.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.75, '#777'); gr.addColorStop(1, '#000'); fg.fillStyle = gr; fg.fillRect(0, 0, 16, 64);
  const hx = fg.createLinearGradient(0, 0, 16, 0); hx.addColorStop(0, 'rgba(0,0,0,0.9)'); hx.addColorStop(0.3, 'rgba(0,0,0,0)'); hx.addColorStop(0.7, 'rgba(0,0,0,0)'); hx.addColorStop(1, 'rgba(0,0,0,0.9)'); fg.fillStyle = hx; fg.fillRect(0, 0, 16, 64);
  const fade = new THREE.CanvasTexture(fc); fade.colorSpace = THREE.NoColorSpace;
  const wet = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x1d1b16, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.8, alphaMap: fade, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  wet.renderOrder = 1; wet.receiveShadow = true; G.add(wet);
  return {
    group: G, land,
    update(dt) {
      tex.offset.y -= dt * 1.6;   // the water runs
      for (const r of rings) { r.t = (r.t + dt * 1.1) % 1; const s = 1 + r.t * 5; r.m.scale.set(s, s, s); r.m.material.opacity = 0.2 * (1 - r.t) * (1 - r.t); }
    },
  };
}
