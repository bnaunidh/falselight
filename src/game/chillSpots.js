// FALSE LIGHT — chill spots, the pure half: where the benches are, which way they face, where you sit and stand,
// what you notice, and the sit / stand rules. No three.js here, so node can test it (tests/chill.test.mjs).
// Coordinates are three.js metres: +x east, -z north, +y up. Bearings are compass degrees (0 = north = -z, 90 = east).

/** Seat geometry per prop, in the prop's local frame (front = +z). Heights are above the prop's pivot (the ground). */
export const SEAT = {
  bench: { top: 0.46, eye: 1.18, eyeZ: 0.04, lateral: 0.55, standZ: 0.68, model: 'prop_log_bench', label: 'E — Sit and rest a while' },
  chair: { top: 0.43, eye: 1.13, eyeZ: -0.02, lateral: 0, standZ: 0.6, model: 'prop_camp_chair', label: 'E — Sit and rest a while' },
};

/**
 * The places. Every bench sits 2-3.2 m beside the walkable trail (the trailhead one is inside the lot), on ground
 * that is flat to within 0.1 m, with no tree, rock, log or placed prop within 2.2 m (checked against scatter.json,
 * layout.json and the height field). y = ground height at the time of writing; the game re-reads it from heightAt.
 * `line` is said once, the first time you sit there by day; `night` if that first time is after dark.
 */
export const CHILL_SPOTS = [
  { id: 'meadow', name: 'Bench below the lookout', kind: 'bench', pos: [3.75, -0.765, 18], bearing: 175,
    line: 'The ground falls away to the creek in one long green slope. A red-tailed hawk hangs over it on a single updraft and never once flaps.',
    night: 'Behind you and high up, the cab window is one small yellow square. Everything in front of you is stars.' },
  { id: 'spring', name: 'Bench at the spring', kind: 'bench', pos: [-58, -19.3, 71], bearing: 162.5,
    line: 'Water runs out of the pipe, fills the barrel and spills over its lip, the same sound it was making before anyone built a tower. The air smells of wet moss and cold stone.',
    night: 'In the dark the spring is louder. You can hear each drop leave the lip of the barrel.' },
  { id: 'creek', name: 'Bench at the creek ford', kind: 'bench', pos: [-83.5, -41.04, 199.5], bearing: 350,
    line: 'The creek talks to itself over the stones. A water ouzel bobs on a rock in the current, walks straight under the water, and comes up somewhere else.',
    night: 'You can\'t see the creek, only hear it, and now and then a pale flash where the water breaks over a rock.' },
  { id: 'overlook', name: 'Bench at the ravine overlook', kind: 'bench', pos: [77, -7.52, 31], bearing: 90,
    line: 'Past the ravine the ridges go blue, then paler blue, all the way out to the peaks with snow still in their creases. Nothing out there is burning.',
    night: 'Not one light anywhere across the ravine. Just ridgelines against a sky one shade less black than they are.' },
  { id: 'burn', name: 'Bench at the old burn', kind: 'bench', pos: [-149.5, -17.09, 24], bearing: 283,
    line: 'Fireweed has come up pink through the black. Three summers ago all of this was flame; now a woodpecker is knocking patiently on one of the snags.',
    night: 'The snags stand up against the stars like the masts of something that sank a long time ago, and stayed down.' },
  { id: 'trailhead', name: 'Bench at the trailhead', kind: 'bench', pos: [30, -32.64, 360], bearing: 50,
    line: 'A Steller\'s jay lands on the trail sign, raises its crest at you, and decides you aren\'t worth the noise. Below the lot the valley shimmers in the heat.',
    night: 'Crickets in the gravel. The flag on the mailbox catches a little starlight, and the road down is a pale ribbon going nowhere tonight.' },
  { id: 'catwalk', name: 'Camp chair on the catwalk', kind: 'chair', area: 'catwalk', pos: [2.56, 30, -2.56], bearing: 45, stand: [1.95, 30, -2.62],
    line: 'Thirty metres up, the wind has nothing to lean on but you. The whole forest moves under it like water, and the smell of pine comes all the way up.',
    night: 'The Milky Way runs straight over the tower. A satellite crawls across it without blinking, taking its time.' },
];

const DEG = Math.PI / 180;
/** Unit facing vector [fx, fz] for a compass bearing. */
export const facingFromBearing = (b) => [Math.sin(b * DEG), -Math.cos(b * DEG)];
/** Model rotation.y that turns the prop's front (+z) to the bearing. */
export const rotYFromBearing = (b) => Math.atan2(Math.sin(b * DEG), -Math.cos(b * DEG));
/** Player / camera yaw (three YXZ, forward = (-sin yaw, -cos yaw)) that looks along the bearing. */
export const yawFromBearing = (b) => { let y = -b * DEG; while (y <= -Math.PI) y += 2 * Math.PI; while (y > Math.PI) y -= 2 * Math.PI; return y; };

/** Prop-local [lx, ly, lz] -> world [x, y, z] for a spot whose pivot is at base = [x, y, z]. */
export function localToWorld(spot, l, base = spot.pos) {
  const r = rotYFromBearing(spot.bearing), c = Math.cos(r), s = Math.sin(r);
  return [base[0] + l[0] * c + l[2] * s, base[1] + l[1], base[2] - l[0] * s + l[2] * c];
}
/** World [x, z] -> prop-local [lx, lz]. */
export function worldToLocalXZ(spot, x, z, base = spot.pos) {
  const r = rotYFromBearing(spot.bearing), c = Math.cos(r), s = Math.sin(r), dx = x - base[0], dz = z - base[2];
  return [dx * c - dz * s, dx * s + dz * c];
}

/**
 * Where you sit on this spot, given where you're standing: on a bench you take the third nearest you.
 * Returns { lx, seat, eye, stand, look, yaw } in world coords (look = a point 25 m out along the view, a touch low).
 */
export function seatFor(spot, from = null, base = spot.pos) {
  const S = SEAT[spot.kind] || SEAT.bench;
  let lx = 0;
  if (S.lateral && from) { const [px] = worldToLocalXZ(spot, from[0], from[2], base); lx = Math.max(-S.lateral, Math.min(S.lateral, px)); }
  const seat = localToWorld(spot, [lx, S.top, 0], base);
  const eye = localToWorld(spot, [lx, S.eye, S.eyeZ], base);
  const stand = spot.stand ? [spot.stand[0], base[1] + (spot.stand[1] - spot.pos[1]), spot.stand[2]] : localToWorld(spot, [lx, 0, S.standZ], base);
  const f = facingFromBearing(spot.bearing);
  const look = [eye[0] + f[0] * 25, eye[1] - 1.6, eye[2] + f[1] * 25];
  return { lx, seat, eye, stand, look, yaw: yawFromBearing(spot.bearing) };
}

/**
 * Can someone whose feet are at (x, y, z) use this seat? The prompt has no line-of-sight test, so without this the
 * catwalk chair could be used from inside the cab through the wall (and you'd be put outside, past the door).
 * Catwalk: on the deck and outside the cab (player.js calls |x|,|z| < 2.05 the cab). Benches: on the same ground.
 */
export function canReach(spot, x, y, z) {
  if (spot.area === 'catwalk') return y > spot.pos[1] - 0.5 && y < spot.pos[1] + 1.2 && Math.max(Math.abs(x), Math.abs(z)) >= 2.05;
  const dx = x - spot.pos[0], dz = z - spot.pos[2];
  return Math.abs(y - spot.pos[1]) < 2 && dx * dx + dz * dz < 25;
}

/** The spot list the map draws: { id, name, pos, facing: [fx, fz], bearing, kind }. */
export const mapSpots = (spots = CHILL_SPOTS) => spots.map((s) => ({ id: s.id, name: s.name, kind: s.kind, pos: s.pos.slice(), facing: facingFromBearing(s.bearing), bearing: s.bearing }));

export const SIT = {
  settle: 0.45,      // s after sitting before a movement key counts as "get up" (so the key you walked in on doesn't)
  lineAfter: 2.6,    // s seated before the spot's line appears
  timeScale: 8,      // the clock runs this much faster while you sit (if the game allows it)
  blendIn: 0.75, blendOut: 0.55,   // s for the camera to settle down / come back up
};

/**
 * The sit / stand rules, pure. The engine side feeds it input and the game's answers each frame and acts on the
 * events it returns: { type: 'sit' | 'stand' | 'timeScale' | 'line' | 'hint', ... }.
 */
export class ChillRules {
  constructor(spots = CHILL_SPOTS, seen = []) {
    this.spots = spots; this.byId = new Map(spots.map((s) => [s.id, s]));
    this.seen = new Set(seen); this.sitting = null; this.t = 0; this.scale = 1; this.hinted = false; this.lineDone = false;
  }
  canSit({ play = true, walk = true } = {}) { return !this.sitting && play && walk; }
  sit(id) {
    if (this.sitting || !this.byId.has(id)) return [];
    this.sitting = id; this.t = 0; this.lineDone = this.seen.has(id);
    const ev = [{ type: 'sit', id }];
    if (!this.hinted) { this.hinted = true; ev.push({ type: 'hint', text: 'You sit. Look around as long as you like — move, or E, to get up.' }); }
    return ev;
  }
  stand(reason = 'input') {
    if (!this.sitting) return [];
    const id = this.sitting; this.sitting = null;
    const ev = [{ type: 'stand', id, reason }];
    if (this.scale !== 1) { this.scale = 1; ev.push({ type: 'timeScale', k: 1 }); }
    return ev;
  }
  /** ctx: { play, walk, danger, moving, fastOK, night } — play false (death, phase change) or walk false (the game went
   *  into the searchlight / fire-finder) stand you up at once; danger (the Weeper) too; a movement key after `settle`. */
  tick(dt, ctx = {}) {
    if (!this.sitting) return [];
    if (ctx.play === false) return this.stand('state');
    if (ctx.walk === false) return this.stand('mode');
    if (ctx.danger) return this.stand('danger');
    this.t += dt;
    if (ctx.moving && this.t >= SIT.settle) return this.stand('move');
    // runs every frame while seated: one reused list + calm event instead of fresh ones (read it before the next tick)
    const ev = this._ev || (this._ev = []); ev.length = 0;
    const calm = this._calm || (this._calm = { type: 'calm', dt: 0 });
    const k = ctx.fastOK === false ? 1 : SIT.timeScale;
    if (k !== this.scale) { this.scale = k; ev.push({ type: 'timeScale', k }); }
    if (!this.lineDone && this.t >= SIT.lineAfter) {
      this.lineDone = true; this.seen.add(this.sitting);
      const s = this.byId.get(this.sitting);
      const text = ctx.night && s.night ? s.night : s.line;
      if (text) ev.push({ type: 'line', id: s.id, text });
    }
    calm.dt = dt; ev.push(calm);
    return ev;
  }
  toJSON() { return [...this.seen]; }
}
