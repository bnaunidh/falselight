// FALSE LIGHT — all words the player reads or hears. Pure data (docs/STORY.md mirrors this file).
// Station: Tamarack Lookout (callsign "Tamarack"). District: Silver Fork Ranger District ("Silver Fork").
// Radio procedure (USFS, 1983): call the station you want first, then yourself: "Silver Fork, Tamarack."

export const NAMES = {
  tower: 'Tamarack', district: 'Silver Fork', dispatcher: 'Joanne', driver: 'Walt',
  prevLookout: 'Ray Tillman', lostBoy: 'Dale Everly', hikerN1: 'Lyle Pruitt',
}
export const WHO = { DISPATCH: 'SILVER FORK', YOU: 'TAMARACK (you)', DRIVER: 'WALT', NOTE: '' }
const D = (text) => ({ who: WHO.DISPATCH, text, radio: true })
const Y = (text) => ({ who: WHO.YOU, text, radio: true })
const W = (text) => ({ who: WHO.DRIVER, text })
const N = (text) => ({ who: '', text, note: true }) // a bracketed sound or sight

// ---------------------------------------------------------------- radio + dialogue
export const LINES = {
  arrive: [
    W('This is as far as the road goes. Trail starts past the sign. Tower\'s about half a mile, all of it uphill.'),
    W('Radio\'s in the cab. Call in when you get up there. Joanne\'ll want to hear your voice.'),
    W('I\'m back tomorrow with the mail and whatever you want from town. Write it down. I forget.'),
    W('Tillman left in kind of a hurry. Don\'t mind the mess.'),
    W('And stay on the trail. I mean it. That ravine doesn\'t give anybody back.'),
    W('That\'s the Everly kid on the board. Last August. Stay on the trail.'),   // the MISSING poster in the station (E on it)
  ],
  briefing: [
    Y('Silver Fork, Tamarack.'),
    D('Tamarack, Silver Fork. Go ahead.'),
    Y('Tamarack is on station. The new lookout.'),
    D('Copy, Tamarack. Welcome up. This is Joanne at the district. You\'ve got the whole east side, Hatchet Peak around to Sheep Ridge.'),
    D('Routine is the same as anywhere. Scan every fifteen minutes. Smoke by day, glow by night. Azimuth off the fire finder, your best guess at distance, and call it in.'),
    D('Generator for the searchlight is at the base, in the shed. Fuel\'s in there too. Keep a can up top. You don\'t want to be going down those stairs in the dark.'),
    D('Tillman left some rules taped to the fire finder. Read them. ...Humor him.'),
    D('Silver Fork clear.'),
  ],
  smokeCall: [
    D('Tamarack, Silver Fork.'),
    Y('Silver Fork, Tamarack. Go ahead.'),
    D('We\'ve got a pilot reporting smoke east of you, maybe the Cold Creek drainage. Can you give me an azimuth?'),
    Y('Copy. Stand by.'),
  ],
  smokeOk: (spoken, place) => [
    Y(`Silver Fork, Tamarack. Smoke at ${spoken}. Grey-brown, one column, leaning off to the east. Looks like ${place}.`),
    D(`${spoken[0].toUpperCase() + spoken.slice(1)}. Copy. That matches the pilot. Nice work, Tamarack. We\'ll get a crew on it.`),
    D('Silver Fork clear.'),
  ],
  smokeBad: (spoken) => [
    Y(`Silver Fork, Tamarack. I have it at ${spoken}.`),
    D('Tamarack, say again? That doesn\'t match what the pilot has. Check your sights and try me again.'),
  ],
  duskSob: [N('Somebody is crying. Far down the hill, by the creek.')],
  cameraFound: [N('A camera, on the shelf by the south window. A note under it in pencil: "10 shots. Make them count. — R.T."')],
  bootsCatwalk: [N('Boots on the catwalk. Slow. All the way around the cab, and then nothing.')],
  bootsTwo: [N('Boots on the catwalk. Two pairs. One of them stops outside the door.')],   // night 2: rule 11 pays off
  glimpse: [N('Far below, across the creek, someone is sitting on a rock with his face in his hands.')],   // day 1, from the catwalk
  night1Start: [
    D('Tamarack, Silver Fork. Evening check.'),
    Y('Silver Fork, Tamarack. Go ahead.'),
    D('Lightning went through the north end this afternoon. Keep an eye on Hatchet Peak tonight. Silver Fork clear.'),
  ],
  glowN1: [N('A glow, low on the horizon. Northwest. It wasn\'t there a minute ago.')],
  fireOk: (spoken, place) => [
    Y(`Silver Fork, Tamarack. Glow at ${spoken}. ${place}, near the top.`),
    D(`Copy, ${spoken}. That\'s our strike. Thanks, Tamarack. Silver Fork clear.`),
  ],
  fireBad: (spoken) => [Y(`Silver Fork, Tamarack. Glow at ${spoken}.`), D('Tamarack, we don\'t have anything on that line. Check it again.')],
  sosN1: [N('A small light, far out to the west, over the burn. It flashes. Three short. Three long. Three short.')],
  answeredN1: [N('The light answers. Long, long, long. Long, short, long.'), D('Tamarack, Silver Fork. You have a light out there?'), Y('Silver Fork, Tamarack. Somebody on the burn. I\'m walking them out with the searchlight.'), D('Copy. I\'ll have the deputy meet them at the lot. Keep them on the trail.')],
  hikerStopped: [N('The light has stopped moving.')],
  hikerStraying: [N('The light is leaving the trail. It follows the beam.')],
  savedN1: [
    D('Tamarack, Silver Fork.'),
    Y('Go ahead.'),
    D('They\'re at the lot. Kid named Lyle Pruitt, seventeen, turned his ankle up on the burn. Says to tell you thanks for the light.'),
    D('Silver Fork clear.'),
  ],
  fellN1: [
    N('The light drops. It doesn\'t go out. It lies there at the bottom, pointing at nothing.'),
    D('Tamarack, Silver Fork. You still have them?'),
    Y('...Silver Fork, Tamarack. I lost them. Off the trail, near the — I lost them.'),
    D('...Copy. We\'ll look at first light. Silver Fork clear.'),
  ],
  fuelLow: [N('The searchlight dims. The generator\'s note drops, far below.')],
  fuelEmpty: [N('The generator coughs and stops. The beam goes out.')],
  gateRattle: [N('Down at the foot of the stairs, the gate rattles. Once. Then again, harder.')],
  dawn: [N('Grey in the east. The night is over.')],
  day2Saved: [
    D('Tamarack, Silver Fork. Morning check.'),
    Y('Silver Fork, Tamarack. Go ahead.'),
    D('Pruitt\'s mother called the office. She wanted your name. I told her you\'d want to stay a voice on the radio.'),
    D('Walt\'s at the lot until sixteen hundred today if you have anything going out. Silver Fork clear.'),
  ],
  day2Lost: [
    D('Tamarack, Silver Fork. Morning check.'),
    Y('Silver Fork, Tamarack. Go ahead.'),
    D('About last night. The party never checked in at the lot. Deputy went through at first light. Nothing.'),
    D('Probably walked out another way. It happens. ...Walt\'s at the lot until sixteen hundred if you have anything going out. Silver Fork clear.'),
  ],
  day2Nudge: [N('The district thinks you\'re cracking up. You need something they can\'t explain away.')],
  weeperHush: [N('The crying stops.')],
  weeperResume: [N('The crying starts again.')],
  weeperSeen: [N('He is looking at you.')],
  weeperScream: [N('The crying becomes screaming. It doesn\'t stop for breath.')],
  weeperDay: [N('He stands up in the creek. He faces the tower. He is waiting for dark.')],
  weeperComing: [N('The screaming is moving. Up the hill. Toward the tower.')],
  weeperStairs: [N('Something is on the stairs. Fast. Bare feet on the treads.')],
  weeperGone: [N('The screaming stops all at once. Somewhere, somebody else is looking at the picture.')],
  faxSent: [N('The fax takes it. The paper comes back out warm.')],
  faxSilhouette: [N('Someone is standing at the station\'s back window. Their back is to you. The lamp inside is off.')],
  mailSent: [N('The flag goes up. It will be two days before anyone opens this.')],
  driverNormal: [W('What am I looking at? ...Okay. A rock. And a guy. I\'ll run it down to the district.')],
  driverFaceDown: [W('Why\'s it upside down?'), N('He doesn\'t turn it over.'), W('Okay.')],
  driverFace: [W('...'), N('He looks at it for a long time. Then he puts it face-down on the seat and starts the truck without saying anything else.')],
  driverHello: [W('Anything going out? Mail\'s in the box, I\'ll take whatever you\'ve got.')],
  night2Start: [
    D('Tamarack, Silver Fork. Evening check.'),
    Y('Silver Fork, Tamarack. Go ahead.'),
    D('Dry lightning forecast after twenty-two hundred, southwest. Sheep Ridge is where it usually starts. Silver Fork clear.'),
  ],
  treeLine: [N('Someone is standing at the edge of the trees below. Facing the tower.')],
  glowN2: [N('A glow to the southwest. Sheep Ridge.')],
  falseSOS: [N('A light on the rim of the ravine. Not on any trail. It flashes SOS — very evenly.')],
  falseAnswered: [N('It answers before you\'ve finished.')],
  falseOut: [N('The light goes out all at once. Like a switch.')],
  falseArrived: [N('The light reaches the gate at the bottom of the stairs, and goes out. Nobody comes up.')],
  bedSitter: [N('Someone is sitting on the edge of your bed, with his back to you.')],
  hallu: {
    figure: [N('Someone on the catwalk, outside the glass.')],
    knock: [N('Three knocks on the door.')],
    text: [N('The logbook is open. You don\'t remember opening it.')],
    voice: [D('Tamarack. ...Tamarack. Come down.')],
  },
  shiver: [N('Your hands are stiff with cold.')],
  passout: [N('You don\'t remember sitting down.')],
  wakeWindow: [N('The north window is open. You didn\'t open it.')],
  ownEntry: [N('The logbook is open to a page you don\'t remember writing.')],
  end: [N('Grey in the east. Somewhere below, the truck is coming up the road.')],
}

// ---------------------------------------------------------------- the rules card
export const RULES = [
  'Answer every light. Count before you answer.',
  'Keep one can of fuel above the gate.',
  'Never walk a light that is too steady.',
  'Do not look at the man at the creek. Not with the glasses. Not in a picture.',
  'The cab is yours. The stairs are not. Don\'t stop on the stairs after dark.',
  'If the gate rattles, it is the wind. Write down the time.',
  'Whoever stands at the tree line is not a hiker. Keep the light on him as long as you can.',
  'Crack a window when the heater is on. If you can\'t smell it, you have been smelling it too long.',
  'There are no entries in your handwriting that you did not write. If you find one, do what it says.',
  'The fax is for daylight. What answers after dark is not the district.',
  'Count the boots on the catwalk. There should be one pair.',
  'If he comes, send it away. Whoever looks next is the one he wants. Don\'t choose someone you know.',
]
// how many rules are on the card, by phase (6–8 are found at the camp; 9–12 appear in your hand)
export const RULES_BY_PHASE = { day1: 5, night1: 5, day2: 5, night2: 12, end: 12 }
export const RULES_FROM_CAMP = 8

// ---------------------------------------------------------------- Tillman's logbook (1982)
export const PREV_LOG = [
  { date: 'Jun 21 \'82', text: 'On station 1400. Tower in fair shape. South glass cracked, taped. Generator runs rough, needs a new plug.' },
  { date: 'Jul 3', text: 'Smoke at 212, Sheep Ridge. Called it in. Crew had it by dark.' },
  { date: 'Jul 17', text: 'Somebody down at the creek crying most of the night. Too far to go down. Called it in. Joanne says there is nobody camped at the creek.' },
  { date: 'Jul 18', text: 'Took the glasses to him at first light. He sits on the big rock across the water with his face in his hands. Didn\'t want to bother him.' },
  { date: 'Jul 24', text: 'He is there every day. He doesn\'t eat. He doesn\'t move, except when I look at him too long. Then he stops crying. I don\'t look that long anymore.' },
  { date: 'Aug 9', text: 'SOS over the burn, 2300. Answered it. Walked him down with the light. He went over the edge off the Cold Creek cut. I had the light right on him. I had it on the trail. I think I had it on the trail.' },
  { date: 'Aug 10', text: 'They didn\'t find the Everly boy. District wants a statement.' },
  { date: 'Aug 12', text: 'Somebody at the tree line. Facing the tower. Not the man from the creek. The boy. The yellow coat.' },
  { date: 'Aug 13', text: 'He is closer in the morning than he was at night. I keep the light on him. The generator can\'t do it all night.' },
  { date: 'Aug 15', text: 'Light on the ravine rim, flashing SOS. It answered before I finished sending. Did not walk it.' },
  { date: 'Aug 19', text: 'Took a picture of the man at the creek. Should not have used the flash.' },
  { date: 'Aug 19', text: 'Turned it over in time. I think in time.' },
  { date: 'Aug 20', text: 'It wasn\'t in time.' },
  { date: 'Aug 20', text: 'Faxed it to the district, 1600. The screaming stopped at 1601.' },
  { date: 'Aug 27', text: 'District doesn\'t answer. Nobody answers.' },
  { date: 'Aug 28', text: 'Left the rules on the fire finder for whoever is next. Count the boots on the catwalk. There should only be one pair.' },
  { date: '', text: 'Going down to count the stairs.', pressed: true },
]

// entries that appear in YOUR handwriting
export const OWN_LOG = {
  own_entry_hatch: { date: 'Aug 9', text: 'Can\'s by the hatch. Don\'t go down again tonight.' },
  own_entry_gate: { date: 'Aug 10', text: '0200 — gate. Wind.' },
  own_entry_closer: { date: 'Aug 10', text: 'He comes closer when you look away. You knew that.' },
  rules_in_hand: { date: 'Aug 10', text: 'Added four to the card. Read it again.' },
}

// the player's own log lines, written automatically as things happen
export const AUTO_LOG = {
  arrived: (t) => `On station ${t}. Tillman's gear still here.`,
  smoke: (b, place) => `Smoke at ${b}, ${place}. Called it in.`,
  glow: (b, place) => `Glow at ${b}, ${place}. Called it in.`,
  saved: () => 'SOS over the burn. Walked him out with the light. Pruitt, 17. Made the lot.',
  lost: () => 'SOS over the burn. Walked him with the light. Lost him off the trail.',
  refuel: (t) => `Refueled the generator, ${t}.`,
  photo: (t, s) => `Photo ${t}. ${s}`,
  sent: (ch, t) => `Sent a print by ${ch}, ${t}.`,
  falseIgnored: () => 'Light on the ravine rim. Did not walk it.',
  falseWalked: () => 'Walked a light up from the ravine. It went out at the gate.',
}

// ---------------------------------------------------------------- the missing poster (camp / station wall)
export const POSTER = {
  head: 'MISSING',
  name: 'DALE EVERLY',
  lines: ['Age 19 · 5\'10" · 150 lbs · brown hair', 'Last seen August 9, 1982, Silver Fork trailhead.', 'Wearing a yellow rain shell, jeans, rubber boots.'],
  foot: 'Anyone with information please contact the Silver Fork Ranger District, (503) 555-0147, or the Lane County Sheriff.',
}

// ---------------------------------------------------------------- what you find
export const FINDS = {
  camp_backpack: {
    title: 'The hikers\' camp',
    text: 'An external-frame pack, soaked through. A single rubber boot beside it. Inside the lid, a folded page torn from a logbook — Tillman\'s handwriting.',
    rulesTo: 8,
  },
  body: { title: 'The ravine', text: 'Thirty-five metres down, on the rocks at the bottom: a yellow rain shell. One boot. He is lying the wrong way round.' },
  noBody: { title: 'The ravine', text: 'Thirty-five metres down. On a ledge, half under moss: a yellow rain shell, sun-faded. It has been there a year.' },
  mailbox: { title: 'Mailbox', text: 'U.S. Mail. Outgoing goes in, flag up. Walt empties it.' },
}

// ---------------------------------------------------------------- objectives (the logbook tracker)
export const OBJECTIVES = {
  d1_walk:      { text: 'Walk up to the tower', hint: 'Follow the trail uphill from the lot. Map: M.' },
  d1_climb:     { text: 'Climb to the cab', hint: 'Up the stairs under the tower, out through the hatch onto the catwalk, then in by the cab door (E).' },
  d1_radio:     { text: 'Radio in to Silver Fork', hint: 'The radio is on the desk. E to call.' },
  d1_rules:     { text: 'Read Tillman\'s rules', hint: 'A card taped to the fire finder, middle of the cab.' },
  d1_fuel:      { text: 'Carry a can of fuel up to the cab', hint: 'The cans are by the shed door at the base. E picks one up; carry it up and set it down anywhere up top with G. (Rule 2)' },
  d1_smoke:     { text: 'Get an azimuth on the smoke to the east', hint: 'From the catwalk look east-northeast, around 070°: a grey-brown column over the far ridges (B raises the binoculars from your pack and shows the bearing; B again lowers them). Then the fire finder: A / D turns the ring, put the hair on the smoke, E to radio it.' },
  d1_camera:    { text: 'Check the shelf by the south window', hint: 'Something is there that wasn\'t this morning.' },
  d1_generator: { text: 'Start the generator before dark', hint: 'In the shed at the base. The searchlight runs off it.' },
  d1_dusk:      { text: 'Wait for dark in the cab', hint: 'The searchlight is on the roof. F takes it from anywhere in the cab or on the catwalk.' },
  n1_fire:      { text: 'A glow to the northwest. Get an azimuth.', hint: 'Fire finder, then E to radio the bearing.' },
  n1_answer:    { text: 'Someone is flashing SOS over the burn. Answer.', hint: 'F takes the searchlight (from the cab or the catwalk). Put the beam on their light, let them finish, then send SOS back with Space: tap-tap-tap, hold-hold-hold, tap-tap-tap.' },
  n1_guide:     { text: 'Walk them out to the trailhead', hint: 'Keep the beam on the trail just ahead of them. If they stop, find them again.' },
  n1_refuel:    { text: 'Fuel is low. Refuel the generator.', hint: 'Carry the can you left up top down to the shed. E at the generator pours it.', urgent: true },
  n1_gate:      { text: 'The gate rattled. Write down the time.', hint: 'Tillman would have. The logbook is on the desk in the cab: E writes the entry.', optional: true },
  n1_dawn:      { text: 'Keep the light until first light', hint: 'Stay in the cab. Watch the horizon.' },
  d2_camp:      { text: 'Find the hikers\' camp', hint: 'Take the Camp Loop west off Trail No. 1411, below the tower (M for the map).' },
  d2_overlook:  { text: 'Look over the ravine rail', hint: 'The short spur east of the tower.' },
  d2_photo:     { text: 'Photograph the man at the creek', hint: 'From the bridge. C for the camera. Don\'t look at his face. Not with the glasses.' },
  d2_send:      { text: 'Send the picture out', hint: 'Mailbox or fax at the trailhead. Or Walt — his truck is at the lot until 16:00.' },
  d2_fuel:      { text: 'Carry a can up for tonight', hint: 'Cans by the shed door. Set it down anywhere up top (G).' },
  d2_generator: { text: 'Start the generator before dark', hint: 'In the shed at the base.' },
  d2_dusk:      { text: 'Get back up to the cab before dark', hint: 'The stairs are not yours after dark.' },
  n2_fire:      { text: 'A glow to the southwest. Get an azimuth.', hint: 'Fire finder, then E to radio it.' },
  n2_light:     { text: 'A light on the ravine rim. Watch it before you answer.', hint: 'Rule 3. A hiker\'s light bobs. Does this one?' },
  n2_treeline:  { text: 'Someone at the tree line. Keep the light on him.', hint: 'He only moves when nothing is looking.', optional: true },
  n2_refuel:    { text: 'Fuel is low. Refuel the generator.', hint: 'Carry a can down to the shed. E at the generator pours it.', urgent: true },
  n2_dawn:      { text: 'Keep the light until first light', hint: 'Stay in the cab.' },
  rules_more:   { text: 'Read the card again', hint: 'Tab opens the logbook. Turn to Rules: some of it is in your handwriting.', optional: true },
  weeper_photo: { text: 'He is coming. Photograph him.', hint: 'A picture of him is the only thing he follows. Then send it away.', urgent: true },
  weeper_send:  { text: 'He is coming. Send the picture away.', hint: 'Mailbox at the trailhead — at night it is the only way. By day, the fax.', urgent: true },
  end:          { text: 'The truck comes Thursday.', hint: 'End of the first two nights.' },
}

export const PROOF_GOAL = 6

// ---------------------------------------------------------------- UI words
export const UI = {
  title: 'FALSE LIGHT',
  subtitle: 'Tamarack Lookout · Silver Fork Ranger District · August 1983',
  // (the Controls card is written from the live key bindings: main.js controlsList)
  death: { bear: 'You ran. It covered the ground between you before you\'d taken ten steps.', weeper: 'He found who he was looking for.', fall: 'You fell too far. Nobody came up the trail until morning.', generic: 'You didn\'t make it to first light.' },
}

/** CO makes the logbook subtly wrong. Deterministic per word so it doesn't flicker. */
export function coDistort(text, level, seed = 7) {
  if (level < 0.35) return text
  const swaps = { the: 'he', light: 'night', tower: 'stairs', trail: 'trial', down: 'down', him: 'you', I: 'we', my: 'your', count: 'count', rules: 'rules', gate: 'grate' }
  const p = Math.min(0.5, (level - 0.35) * 1.2)
  let i = 0
  return text.replace(/\b[\w']+\b/g, (w) => {
    i++
    const h = Math.abs(Math.sin((i + seed) * 12.9898) * 43758.5453) % 1
    const k = swaps[w] ?? swaps[w.toLowerCase()]
    return k && h < p ? (w[0] === w[0].toUpperCase() ? k[0].toUpperCase() + k.slice(1) : k) : w
  })
}

// the books on the cab shelf (E on the shelf flips through them in turn)
export const BOOKS = [
  { title: 'Lookout Handbook · USFS Region 6, rev. 1962', text: 'REPORTING A SMOKE. Take the azimuth with the fire finder to the nearest degree. Give the landmark nearest the smoke, the colour of the smoke, and whether it is drifting.\n\nWhite smoke is usually light fuel. Black or brown is heavier: timber, slash, a structure.\n\nReport every smoke. A false alarm costs a phone call. A missed one costs a mountain.\n\n(In pencil, in the margin: "and you can see further at dusk than you think.")' },
  { title: 'Birds of the Northwest · a field guide, water-stained', text: 'STELLER\'S JAY. Crested, dark blue and black. Bold at camps. Loud harsh "shook-shook-shook"; mimics hawks.\n\nUnderlined twice, in Tillman\'s hand: Jays go quiet before weather.\n\nUnder that, newer ink: And before other things.' },
  { title: 'Cold Deck · a paperback western, spine broken', text: 'The rider came down off the ridge at a walk, like a man who had all the time left in the world and meant to spend it slowly. Nobody in the town had seen him ride in. Nobody would see him ride out, either.\n\nSomeone has dog-eared this page. Nothing on it is marked.' },
  { title: 'Crossword Omnibus No. 4 · half done', text: 'Seven across, "Keeps watch" (7): SENTINEL is crossed out; LOOKOUT written in.\n\nTwelve down, "Won\'t be seen" (6): left blank. The square has been gone over with the pencil so many times the paper has worn through.' },
  { title: 'Osborne Fire Finder · operating card', text: '1. Level the table. The map is oriented to TRUE north.\n2. Turn the sighting ring until the smoke is behind the hair of the front sight.\n3. Read the azimuth under the rear sight. Report it with the vertical angle if you can.\n4. Two lookouts crossing their azimuths fix the fire. One lookout gives a line.\n\n(Taped over the bottom: "Do not report the rock. The rock is not a fire. —R.T.")' },
];
