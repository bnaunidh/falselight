// FALSE LIGHT — what downloads when. On slow Wi-Fi the whole game is ~45 MB, so it arrives in stages, most urgent first
// (one queue, src/engine/loadq.js), and the game waits only for what it needs next:
//   A   the title backdrop: terrain, the tower, the dusk sky, the big trees around the tower
//   B   before New game: the cab, the trailhead, the day sky, the day-1 ground cover, the Weeper and his rock, the item
//       templates, the log bench, and every model with interaction anchors (the game reads those once, at init)
//   C1  the creek (footbridge, its sign, logs)          C2  the way up to the tower (stumps, grass, signs, the dog, the chair)
//   D   the night: the night sky, the other lookout, the lost hiker, the hikers' camp, the bear and the deer
//   E   whenever: the hiker's body (day 2)
// Day 1 lasts twelve real minutes and C/D are ~15-20 MB, so they're normally in long before they're needed; main.js holds
// the day-1 clock at dusk (and Continue into a night) until D is in, so the night can never start without its sky and cast.
// A model this table doesn't name goes in B (before play): new content is never missing when the game first reaches for it.
import { loadq } from './loadq.js?v=3479c8521344c615';

export const STAGES = ['A', 'B', 'C1', 'C2', 'D', 'E'];
export const PRIO = { A: 0, B: 1, C1: 2, C2: 3, D: 4, E: 5 };
const MODEL_STAGE = {
  tower: 'A', veg_fir_a: 'A', veg_fir_b: 'A', veg_fir_c: 'A', veg_hemlock_a: 'A', veg_sapling: 'A',
  prop_footbridge: 'C1', prop_sign_creek: 'C1', veg_log_a: 'C1',
  veg_stump_a: 'C2', veg_stump_b: 'C2', veg_grass: 'C2', prop_sign_gate: 'C2', prop_sign_cliff: 'C2', prop_sign_spring: 'C2', prop_sign_j1: 'C2', prop_camp_chair: 'C2', char_dog: 'C2',
  char_other_lookout: 'D', char_lost_hiker: 'D', prop_tent_collapsed: 'D', prop_sleeping_bag: 'D', prop_camp_stove: 'D', prop_fire_pit: 'D',
  prop_rubber_boot_fallen: 'D', prop_sign_camp: 'D', veg_snag_a: 'D', char_bear: 'D', char_deer: 'D',
  char_lost_hiker_body: 'E',
};
// B's own order: what the first minute of day 1 looks at comes first
const B_FIRST = ['cab_interior', 'prop_ranger_station', 'prop_supply_truck', 'prop_mailbox', 'prop_sign_trailhead', 'prop_sign_firedanger', 'prop_picnic_table', 'prop_sign_j2'];
const SKY_STAGE = { qwantani_dusk_2_puresky: 'A', kloofendal_overcast_puresky: 'B', rogland_moonlit_night: 'D' };
export const SKY_SLOT = { day: 'kloofendal_overcast_puresky', dusk: 'qwantani_dusk_2_puresky', night: 'rogland_moonlit_night' };
const after = (a, b) => STAGES.indexOf(a) > STAGES.indexOf(b);
/** The stage a model downloads in. Anything carrying world anchors (IA_/SP_) is needed by game.init: B at the latest. */
export function stageOfModel(name, e) {
  let s = MODEL_STAGE[name] || 'B';
  if (e && e.anchors && e.anchors.length && after(s, 'B')) s = 'B';
  return s;
}
export const stageOfSky = (name) => SKY_STAGE[name] || 'B';
export const skyPath = (manifest, name) => { const p = (manifest.skies && manifest.skies[name]) || (manifest.hdri && manifest.hdri[name]); return p ? 'assets/' + p : null; };

export function createStream(manifest) {
  const st = {}; for (const s of STAGES) st[s] = { paths: [], work: [], done: false };
  let sealed = null; const seal = new Promise((r) => { sealed = r; });
  const site = !!manifest.files;   // the public site's manifest lists exactly the shipped models (+ sizes, textures)
  const S = {
    stages: st,
    /** queue every download now, in stage order (the queue starts the most urgent first) */
    plan(layout, terrainTex = 1024) {
      const planned = new Set();   // a texture file shared by several models belongs to the first (most urgent) stage that needs it
      const add = (s, path) => { if (planned.has(path)) return; planned.add(path); st[s].paths.push(path); loadq.prefetch(path, PRIO[s]); };
      const models = manifest.models || {};
      const glb = (s, name) => { const e = models[name]; if (!e) return; const p = 'assets/' + e.path; add(s, p); for (const t of e.tex || []) add(s, p.slice(0, p.lastIndexOf('/') + 1) + t); };
      // A: the data the world is built from, then the terrain layers, the tower, the dusk sky, the big trees
      for (const d of ['layout.json', 'terrain_height.json', 'terrain_splat.json', 'terrain_splat.png', 'scatter.json']) add('A', 'assets/data/' + d);
      add('A', manifest.files && manifest.files['data/terrain_height.u16p.bin'] ? 'assets/data/terrain_height.u16p.bin' : 'assets/data/terrain_height.bin');
      if (site) for (const t of Object.values(manifest.textures || {})) for (const k of ['diff', 'arm', 'nor_gl']) { const p = (terrainTex <= 512 && t[k + '_512']) || t[k]; if (p) add('A', 'assets/' + p); }   // (what world.js buildLayerArrays will take)
      const names = site ? Object.keys(models) : [...new Set(['tower', 'cab_interior', 'veg_rocks_boulder', ...((layout && layout.propPlacements) || []).map((p) => p.model), ...Object.keys(models).filter((m) => /^veg_/.test(m) && MODEL_STAGE[m])])].filter((m) => models[m]);
      const by = (s) => names.filter((m) => stageOfModel(m, models[m]) === s);
      for (const s of STAGES) {
        let list = by(s);
        if (s === 'B') list = [...B_FIRST.filter((m) => list.includes(m)), ...list.filter((m) => !B_FIRST.includes(m))];
        for (const [name, sn] of Object.entries(SKY_STAGE)) if (sn === s) { const p = skyPath(manifest, name); if (p) add(s, p); }
        for (const m of list) glb(s, m);
      }
      S.models = []; for (const s of STAGES) for (const m of by(s)) S.models.push([s, 'assets/' + models[m].path]);
      return S;
    },
    /** world / sky work belonging to a stage (registration after the download); stage readiness waits for it */
    track(s, p) { st[s].work.push(Promise.resolve(p).catch((e) => console.warn('stream', s, e))); return p; },
    seal() { sealed(); },
    /** resolves when every stage up to and including s is downloaded and in the world */
    ready(s) {
      const upto = STAGES.slice(0, STAGES.indexOf(s) + 1);
      return seal.then(() => Promise.all(upto.map((k) => Promise.all(st[k].work)))).then(() => { for (const k of upto) st[k].done = true; });
    },
    isDone(s) { return STAGES.slice(0, STAGES.indexOf(s) + 1).every((k) => st[k].done); },
    /** fraction of the bytes of every stage up to s that have arrived */
    progress(s) { return loadq.progress(STAGES.slice(0, STAGES.indexOf(s) + 1).flatMap((k) => st[k].paths)); },
    /** bytes still to come for stages up to s */
    bytesLeft(s) { const paths = STAGES.slice(0, STAGES.indexOf(s) + 1).flatMap((k) => st[k].paths); let w = 0; for (const p of paths) w += loadq.bytesOf(p); return w * (1 - S.progress(s)); },
  };
  return S;
}
