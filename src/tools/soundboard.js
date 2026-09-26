// FALSE LIGHT — the sound board: every sound the game makes, one button each, numbered so you can say "S4 and F2 sound
// goofy". Nothing plays until you press something. Built on the real audio engine with a stub world.
import * as THREE from 'three';
import { createAudio } from '../engine/audio.js?v=37301ca4';
import { registerAnimalSounds, ANIMAL_SOUNDS } from '../engine/animalSounds.js?v=37301ca4';
import { registerScareSounds, SCARE_SOUNDS } from '../engine/scareSounds.js?v=37301ca4';
import { registerFearSounds } from '../game/fear.js?v=37301ca4';

const engine = { camera: new THREE.PerspectiveCamera(), sky: { dayFactor: 1 }, world: { anchors: new Map(), layout: {} }, player: { zone: 'cab' } };
const audio = createAudio(engine);
registerAnimalSounds(audio); registerScareSounds(audio); registerFearSounds(audio);
setInterval(() => audio.update && audio.update(0.05), 50);

const GROUPS = [
  ['S', 'Scares (the night director)', SCARE_SOUNDS],
  ['H', 'Your body (fear)', ['heart_lub', 'heart_dub', 'breath_in', 'breath_out', 'heart', 'breath']],
  ['F', 'Footsteps', ['step:wood', 'step:wood:jog', 'step:dirt', 'step:gravel', 'step:water', 'board_creak', 'stair_creak']],
  ['W', 'The Weeper and people', ['sob', 'scream', 'knock', 'footstep_wood']],
  ['T', 'The tower', ['door_open', 'door_close', 'window_open', 'window_close', 'lamp_chain', 'morse_click', 'radio_squelch', 'generator_start', 'generator_stop', 'stove_on', 'heater_on', 'gate_rattle', 'thunder']],
  ['A', 'Animals', ANIMAL_SOUNDS],
];
const root = document.getElementById('board');
let started = false;
function go(name) {
  if (!started) { started = true; audio.start(); audio.setVolume(0.8); audio.setMuted(false); }
  if (name.startsWith('step:')) { const [, s, j] = name.split(':'); audio.footstep(s, !!j, false); return; }
  if (!audio.has(name)) { flash(name + ' (not a sound)'); return; }
  audio.play(name, { volume: 1 });
}
function flash(t) { const n = document.getElementById('note'); n.textContent = t; }
for (const [p, title, names] of GROUPS) {
  const sec = document.createElement('section'); sec.innerHTML = `<h2>${title}</h2>`; const row = document.createElement('div'); row.className = 'row';
  names.forEach((n, i) => { const b = document.createElement('button'); b.innerHTML = `<b>${p}${i + 1}</b> ${n.replace(/_/g, ' ').replace('step:', 'step on ')}`; b.onclick = () => { go(n); flash(`${p}${i + 1} · ${n}`); }; row.appendChild(b); });
  sec.appendChild(row); root.appendChild(sec);
}
