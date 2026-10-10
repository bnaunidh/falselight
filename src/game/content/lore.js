// FALSE LIGHT — the papers: the places in the woods and what's written there (the lore bible's PLACES + DOCS, texts
// verbatim). Pure data, no three.js, node-testable (tests/lore.test.mjs). The rules that read it are in ../explore.js.
//
// A text is only the words on the paper. A marker at the start of a line switches the hand for that line and the ones
// after it, and is never printed: ⟨typed⟩ ⟨print⟩ ⟨ink⟩ ⟨pencil⟩ ⟨own⟩ (your handwriting) ⟨child⟩. `hand` is the hand
// before the first marker. get: 'take' (the paper leaves the world) | 'copy' (fixed text, copied in pencil, your hand).
// fromDay / needs gate a paper (day 1..7 = Tue Aug 9..Mon Aug 15); late = trailing lines that only exist from a day+hour.
// leads: places this paper points at, with the words that point there. rules: rule number → the note it puts in the margin.
// Coordinates are three.js metres (+x east, -z north); bearings compass degrees from the cab.

// ---------------------------------------------------------------- places
// head: your pencil name for it (the Found tab); pencil: { sym, label } on the map; r: discover radius (0 = never by
// walking: you find it by filing a paper there); ray: heard of only as a bearing from the cab (a dashed pencil ray);
// mention: what you'd call it before you've been there; leadObj: the optional tracker task, in the lookout's voice.
export const PLACES = [
  { id: 'pack', name: 'Paperwork', head: 'Paperwork', xz: null, r: 0, pencil: null },
  { id: 'dump', name: 'The dump below the west side', head: 'the dump', xz: [-36, 2], r: 10, pencil: { sym: 'barrel', label: 'dump' }, mention: 'the dump',
    leadObj: { id: 'x_dump', day: 3, text: 'Find the missing pages of Tillman\'s log (Aug 21–26)', hint: 'Station Guide: burn what burns in the barrel below the west side. Look down from the west catwalk.' } },
  { id: 'cairn', name: 'Ellen\'s cairn, on the rim', head: 'E.M.\'s cairn', xz: [82, -62], r: 12, pencil: { sym: 'cairn', label: 'E.M.' }, mention: 'the stones on the rim',
    leadObj: { id: 'x_cairn', day: 3, text: 'Follow the stacked stones north from the overlook rail', hint: 'Along the rim of the Cut. Keep the drop on your right.' } },
  { id: 'tarp', name: 'The blue tarp (Dale Everly\'s last camp)', head: 'Dale\'s tarp', xz: [-200, -58], r: 12, pencil: { sym: 'tent', label: 'D.E.' }, mention: 'where Dale really camped',
    leadObj: { id: 'x_tarp', day: 3, text: 'Find where Dale Everly really camped', hint: 'Tillman: NW corner of the burn, a blue tarp under a hemlock. Your “?” on the map.' } },
  { id: 'stake', name: 'The stake in the burn (where the 1980 fire started)', head: 'P.O.O. ’80', xz: [-205, 55], r: 10, pencil: { sym: 'poo', label: 'P.O.O. 8-12-80' }, mention: 'where the 1980 fire started',
    leadObj: { id: 'x_stake', day: 4, text: 'Find where the 1980 fire started', hint: 'J.H.: it sat on the west slope. Red flagging low on the burn\'s west side, off the Camp Loop.' } },
  { id: 'cedar', name: 'The lamp tree (the hollow cedar)', head: 'lamp tree', xz: [-50, 150], r: 10, pencil: { sym: 'tree', label: 'lamp tree' }, mention: 'the hollow cedar',
    leadObj: { id: 'x_cedar', day: 4, text: 'Find the hollow cedar', hint: 'Dale: below the spring, toward the creek.' } },
  { id: 'tanker', name: 'Tanker 14 (the wreck on the Hatchet line)', head: 'T-14', xz: [-190, -200], r: 30, pencil: { sym: 'plane', label: 'T-14' }, ray: { brg: 316, label: 'T-14? 316°' }, mention: 'Tanker 14',
    leadObj: { id: 'x_tanker', day: 5, text: 'Find what\'s on the Hatchet line', hint: '316° from the cab, a gap in the trees. From the fire cache the old road runs west.' } },
  { id: 'ccc', name: 'Camp F-43 (the CCC camp)', head: 'CCC F-43', xz: [-120, 380], r: 30, pencil: { sym: 'ccc', label: 'CCC F-43' }, mention: 'the CCC camp',
    leadObj: { id: 'x_ccc', day: 6, text: 'Find Camp F-43', hint: 'The stone gateposts at the west edge of the lot.' } },
  { id: 'point', name: 'Tamarack Point (the first lookout, 1919–1937)', head: 'old Pt. L.O.', xz: [226, -228], r: 30, pencil: { sym: 'lookout', label: 'old Pt. L.O.' }, ray: { brg: 45, label: 'the Point 045°' }, mention: 'the Point',
    leadObj: { id: 'x_point', day: 7, text: 'Cross to Tamarack Point', hint: '045° from the cab, the dead tree on the far ridge. Past the fire cache, round the head of the Cut.' } },
  { id: 'trapper', name: 'Halvorsen\'s cabin (up Cold Creek)', head: 'N.H.', xz: [-300, 185], r: 20, pencil: { sym: 'square', label: 'N.H.' }, mention: 'Halvorsen\'s cabin',
    leadObj: { id: 'x_trapper', day: 4, text: 'Find Halvorsen\'s cabin', hint: 'Ward Everly: old Halvorsen trapped up Cold Creek. From the ford, follow the creek upstream (west).' } },
  { id: 'gage', name: 'The gage below the Cut', head: 'gage', xz: [150, 288], r: 20, pencil: { sym: 'gage', label: 'gage' }, mention: 'the gage below the Cut',
    leadObj: { id: 'x_gage', day: 5, text: 'Find the gage below the Cut', hint: 'The USGS sign at J2: 150 yards east, down in the dry wash.' } },
  { id: 'cache', name: 'Tamarack fire cache (end of Road 2410-110)', head: 'cache', xz: [32, -190], r: 0, pencil: null, mention: 'the fire cache' },   // (northWoods.js finds it and pencils its box)
  { id: 'station', name: 'Silver Fork trailhead station', head: 'station', xz: [32, 382], r: 0, pencil: null, mention: 'the file cabinet at the station',
    leadObj: { id: 'x_file', day: 6, text: 'The file cabinet at the station', hint: 'Joanne: bottom drawer, key taped under the desk. Daylight.', done: { taken: 'station_file' } } },
  { id: 'stairs', name: 'Under the stairs', head: 'the stairs', xz: [0, 0], r: 0, pencil: null, mention: 'the post under the first landing',
    leadObj: { id: 'x_stairs', day: 7, text: 'Count the stairs', hint: 'Tillman: 144 going up. Going down I got — . The post under the first landing, before dark.', done: { copied: 'stairs_tally', v: 2 } } },
];
PLACES.find((p) => p.id === 'dump').leadObj.done = { taken: 'dump_pages' };
/** The one tracker task that isn't a place: Dale's roll of film, out to be developed. */
export const X_FILM = { id: 'x_film', day: 4, text: 'Send Dale\'s film out to be developed', hint: 'Mailbox at the trailhead, or give it to Walt on Saturday.', flag: 'daleFilm', done: { flag: 'filmSent' } };
export const TRACKS = [...PLACES.filter((p) => p.leadObj).map((p) => ({ ...p.leadObj, place: p.id })), X_FILM];

// ---------------------------------------------------------------- the papers
export const DOCS = [
  // --- in your pack from the start
  { id: 'letter', place: 'pack', start: true, get: 'take', hand: 'typed', title: 'Your letter of appointment',
    text: '⟨typed⟩UNITED STATES DEPARTMENT OF AGRICULTURE · FOREST SERVICE · Silver Fork Ranger District · July 22, 1983\nThis confirms your temporary appointment as Forestry Aid (Lookout), GS-3, at Tamarack L.O., for the period August 9 through August 16, 1983.\nReport to the Silver Fork trailhead at 1000 on August 9. Mr. W. Hendry will drive you up the last of the road and will bring supplies and mail.\nIt is essential that Tamarack be staffed on August 9. If for any reason you cannot report on that date, telephone this office at once, day or night.\nThe previous lookout\'s belongings have not been removed. Please leave them as they are.\nDan Mercer, District Ranger · DM:jh' },

  // --- the dump below the west side
  { id: 'dump_pages', place: 'dump', get: 'take', hand: 'ink', burned: true, src: 'Tillman\'s burned pages', title: 'Burned logbook pages, from the barrel',
    text: "Aug 21. Called the district at 0800. Joanne says Don Pell pulled the fax off the machine yesterday and went home sick at 1630. Asked her to tell him not to look at it again. She says he isn't answering his phone. I chose him. I didn't know I was choosing somebody I'd met…\n\nAug 22. Tore the rules out of the back and wrote them over clean. Took one page down to the Camp Loop site. There's a pack there now. The deputy says there wasn't on the 10th and I believe him. It's soaked through. Put the page inside the lid in case whoever it belongs to comes back for…\n\nAug 23. Found where the boy really camped. NW corner of the burn, a blue tarp under a hemlock, a camera on legs pointed at the tower. Didn't touch it. Told the deputy. He said they'd been through there. They hadn't.\n\nAug 24. Boots on the catwalk 0230. Mine were by the bed. Bess won't come up after dark since the 20th, sleeps in the shed with her back to the wall. An entry in the log in my hand: 'Can's by the hatch.' I didn't write it. I did what it said…\n\nAug 25. USGS man at the gage below the Cut. Asked him does the creek ever run down there. He said only at night, in August, and laughed like I was supposed to.\n\nAug 26. Counted the stairs. 144 going up. Going down I got",
    leads: [{ place: 'tarp', name: 'Dale\'s real camp', quote: 'NW corner of the burn, a blue tarp under a hemlock' }, { place: 'gage', name: 'the gage below the Cut', quote: 'USGS man at the gage below the Cut.' },
      { place: 'stairs', name: 'the stairs', quote: 'Counted the stairs. 144 going up. Going down I got' }] },
  { id: 'dump_label', place: 'dump', get: 'copy', hand: 'typed', title: 'Pill bottle, among the cans',
    text: '⟨typed⟩CASCADE PHARMACY · SILVER FORK, ORE.\nRx 40117 · 7-2-74\nMAKI, ELLEN\nCHLORPROMAZINE 25 MG\nTAKE ONE AT BEDTIME AS NEEDED FOR SLEEP\nDR. H. MORROW · REFILLS: 3' },
  { id: 'dump_tag', place: 'dump', get: 'take', hand: 'print', tag: true, title: 'A dog tag on a rotted collar',
    text: 'BESS\nR. TILLMAN · STAR RT. BOX 40 · OAKRIDGE\nLANE CO. RABIES 1982 · No. 2281' },

  // --- Ellen's cairn (a memorial: nothing is taken)
  { id: 'cairn_board', place: 'cairn', get: 'copy', hand: 'print', title: 'The board on the cairn',
    text: 'ELLEN MAKI\nLOOKOUT, TAMARACK · 1972 · 1973 · 1974\nSHE WENT OUT TO A LIGHT\nAUGUST 15, 1974\nHER FLASHLIGHT WAS FOUND HERE\nSHE KEPT IT LIT FOR US\n— R.M.' },
  { id: 'cairn_jar', place: 'cairn', get: 'copy', hand: 'ink', src: 'the notes in E.M.\'s jar', title: 'Notes in the jar',
    text: "Ellie — Mom still sets your place. I brought your good boots up and put them under the stones. I know you went out in the old ones. — Ruth, Aug 15, 1975\n\nCame up to see Ellen's rock. The steady one was on the rim again last night. I didn't go to it. I'm not coming back next year. — J. Rusk, Tamarack L.O., 8-15-77\n\nEllen — I didn't answer it. Three nights it sat on the west slope. On the third it went into the timber and the timber caught. They'll say lightning. I'm sorry. — J.H., Aug 1980\n\nMiss Maki — The boy went over the Cut on the 9th. I had the light on him. Your rule says keep the light on the one at the tree line and I've been doing it. The generator can't do it all night. How did you stand it. — R. Tillman, 8-14-82",
    leads: [{ place: 'stake', name: 'where it sat on the west slope', quote: 'Three nights it sat on the west slope. On the third it went into the timber and the timber caught.' }], rules: { 7: '— E. Maki, ’73' } },
  { id: 'cairn_page', place: 'cairn', get: 'copy', hand: 'ink', title: 'A page from Ellen Maki\'s log, folded in the jar',
    text: "TAMARACK L.O. · DAILY LOG · E. MAKI\n\nAug 11 '74. Someone at the tree line, south, below the meadow. A boy in a wool jacket too big for him. Not a hiker. Kept the light on him till dawn. He was closer in the morning.\nAug 12. Same boy. Took the light off him one minute to refuel. When I got back up he was at the edge of the meadow.\nAug 13. An entry in my hand from last night that I didn't write: 'Stay in.' I stayed in.\nAug 14. Two lights on the rim of the Cut. Count before you answer. One of them is waving.\nAug 15.",
    rules: { 7: '— E. Maki, ’73', 9: '— E. Maki, ’74' } },

  // --- the blue tarp
  { id: 'tarp_notebook', place: 'tarp', get: 'take', hand: 'ink', src: 'Dale\'s notebook', title: 'Dale Everly\'s notebook, in a Ziploc bag',
    text: "D. EVERLY · GEOL 201 · FIELD NOTES\n\nAug 6, Eugene. Grandpa called again. He says don't go on the 9th, go any other week. He was up there in '36 with the CCC, Company 1492. His bunkmate Tommy Kerr went out to a lantern on the 9th and they never found him, and the old men at the camp said it was the date. He's 64 and he cried on the phone. I'm going on the 9th. Somebody should look.\n\nAug 9, 10:15. Silver Fork trailhead. The supply driver asked where I was headed. Said the loop. He told me to stay on the trail like he meant it.\nLeft the big pack at the Camp Loop site. Day pack and the Pentax up to the NW corner of the burn. Grandpa says from there you can see the tower and the Point both.\n\n3:30. Grandpa said leave a light at the hollow cedar below the spring, toward the creek, before dark. 'Anything that shines.' Left the bike light. There are dozens in there.\n\n4:40. Tarp up. Tower's right across the burn. Took a while to find the Point: a dead tree on the far ridge, taller than the rest, with something built in the top. Tripod on the tower.\n\n9:05. Searchlight came on and swept the burn twice. I waved. Frame 14.\n10:20. A light on the Point. Steady. Grandpa never said anything about a light on the Point. Frame 22.\n10:40. The Point's light went out.\n10:50. There are two lights again. One of them is the tower.\n10:58. The other one is on the burn now, below me. It isn't the tower's. Getting a picture of it, then back down to the loop.",
    leads: [{ place: 'cedar', name: 'the hollow cedar', quote: 'the hollow cedar below the spring, toward the creek' },
      { place: 'point', name: 'the Point', quote: 'a dead tree on the far ridge, taller than the rest, with something built in the top' },
      { place: 'ccc', name: 'Company 1492', quote: 'He was up there in \'36 with the CCC, Company 1492.' }] },
  { id: 'tarp_film', place: 'tarp', get: 'take', hand: 'print', title: 'Film can in the day pack',
    text: "KODAK TRI-X PAN · 400 · 36 EXP.\n⟨ink⟩ROLL 3 · TAMARACK · 8/9 · DON'T X-RAY" },
  { id: 'tarp_prints', place: 'tarp', get: 'take', hand: 'typed', needs: 'dalePrints', title: 'Photo-Mart envelope (Walt brought it up)',
    text: '⟨typed⟩PHOTO-MART · EUGENE, OREG. · MAIL ORDER\n1 ROLL B&W 36 · DEV + PRINT 3½ × 5\nFrames 32–36 not exposed.\nOur printer could not get a better print from frame 31. It is enclosed anyway. No charge.\n⟨pencil⟩HE WAS A GOOD KID. — W.' },

  // --- the stake in the burn
  { id: 'stake_tag', place: 'stake', get: 'copy', hand: 'print', title: 'Tag on the stake',
    text: 'U.S. FOREST SERVICE\nFIRE INVESTIGATION · POINT OF ORIGIN\nTAMARACK WEST · 8-12-80\nEVIDENCE COLLECTED: NONE\nG. SALCIDO' },
  { id: 'stake_notes', place: 'stake', get: 'take', hand: 'pencil', title: 'Investigator\'s notebook, in the ammo can',
    text: "8-13-80. Tamarack West. Walked it with crew boss Aldridge. V-pattern, char depth and the lean of the burn on the snags all bring it back here: W edge, lowest ground, this stump.\nOn the stump a kerosene lantern, Dietz No. 2, globe fused, fuel valve open, wick burned down to the collar. No owner. No camp, no pack, no tracks but ours.\nL.O. Haskins by radio: a steady light sat at this spot the nights of 8-10, 8-11 and 8-12, from about 2300. She did not answer it. Asked why not. 'It's on the card.' 8-12 at 0200 it moved into the timber. Smoke at 0214. She called it in at 0214.\nWeather Bureau: no lightning in the district 8-5 through 8-12.\n8-14. Supv. Corwin by phone: write it as a holdover strike. Leave the lantern. Nobody at the district wants to carry it down.\nNeither do I. It stays." },

  // --- the lamp tree (a memorial: copied, never taken)
  { id: 'cedar_plate', place: 'cedar', get: 'copy', hand: 'print', src: 'the plate on the lamp tree', title: 'Tin plate over the opening, letters punched with a nail',
    text: 'FOR THE LAMP\nTAKE THESE\nNOT US\nCO. 1492 C.C.C. · AUG 1936',
    leads: [{ place: 'ccc', name: 'Company 1492', quote: 'CO. 1492 C.C.C. · AUG 1936' }] },
  { id: 'cedar_notes', place: 'cedar', get: 'copy', hand: 'ink', src: 'the notes in the lamp tree', title: 'Notes in the bark',
    text: "Tommy Kerr's carbide lamp. They found it on the rim. You can have it. Give him back. — W. Everly, Barracks 3, Aug 16 1936\n\nGene's railroad lantern. He'd want it doing some good. — Mae Aldous, 1967\n\nSignal mirror, Tamarack L.O. It works in daylight too. — M.O., 1962\n\nTook the batteries out of Ellie's spare first. — R.M., 1975\n\nbike light. Grandpa says. — D.E. 8/9/82",
    leads: [{ place: 'tanker', name: 'Tanker 14', quote: 'Signal mirror, Tamarack L.O. It works in daylight too. — M.O., 1962' }, { place: 'ccc', name: 'Barracks 3', quote: 'W. Everly, Barracks 3, Aug 16 1936' }],
    rules: { 2: '— after Aldous, ’66', 5: '— after Aldous, ’66' } },
  { id: 'cedar_carving', place: 'cedar', get: 'copy', hand: 'print', title: 'Initials cut into the char', text: 'N. H. · 1913' },

  // --- Tanker 14
  { id: 'tanker_kneeboard', place: 'tanker', get: 'take', hand: 'pencil', title: 'Pilot\'s kneeboard card, in the cockpit',
    text: "8-9-61 · FIRE 23 HATCHET PK · T-14 · LOAD 2 · WIND W 10\nTAMARACK L.O. WILL MIRROR THE HEAD\n1851 up\n1858 Tamarack in sight\n1904 mirror 10 o'clock low — turning in" },
  { id: 'tanker_plate', place: 'tanker', get: 'copy', hand: 'print', title: 'Plate screwed to the tail',
    text: "HOWARD 'DUTCH' RAINEY\n1922 – 1961\nHE WENT WHERE HE WAS SHOWN\n— THE BOYS AT MEDFORD" },
  { id: 'tanker_note', place: 'tanker', get: 'take', hand: 'ink', title: 'Note behind the plate, in a bread bag',
    text: "Dutch — I had the mirror in the drawer. I never took it out. I told them and they wrote pilot error.\nThere was a steady light on the rim again last night and I walked it in, and I'm putting it on the card: never walk one that's too steady.\n— Peg Ostrander, Tamarack L.O., Aug 1962",
    rules: { 3: '— Ostrander, ’62' } },

  // --- Camp F-43
  { id: 'ccc_echo', place: 'ccc', get: 'take', hand: 'typed', src: 'the Silver Fork Echo', title: 'The Silver Fork Echo, in the oven',
    text: "⟨typed⟩THE SILVER FORK ECHO\nPublished by the enrollees of Co. 1492, Camp F-43 · Vol. II, No. 8 · Friday, August 14, 1936\n\nTOWER TOPPED OUT. The Tamarack crew set the last cab timber Thursday. Mr. Pike, the lookout at the old Point, came across the Cut to see it, climbed it twice, and said it was a fine tower, only it was looking the wrong way. We asked him which way was right. He did not say.\n\nSAD NEWS. Enrollee Thomas Kerr of Pittsburgh has been missing since Sunday night the 9th. Tommy went out after supper to see about a lantern on the rim of the Cut and did not come back. His lamp was found on the rim Tuesday. The search goes on.\n\nCAMP RULES (reprinted by order of the Superintendent). No enrollee will leave camp after dark. No enrollee will cross the Cold Creek bridge after dark. No enrollee will go to a light that is not a camp light.\n\nWHO'S THE CRYING MAN? Every company has a ghost story and ours sits on a rock. The bridge detail says if you look at him too long he stops, and you had better not stay to see what comes next. Our advice: look at the bridge.\n\nBALL GAME Sunday vs. Camp F-38. Bring your own mitt.",
    leads: [{ place: 'point', name: 'the old Point', quote: 'Mr. Pike, the lookout at the old Point, came across the Cut to see it' }] },
  { id: 'ccc_letter', place: 'ccc', get: 'take', hand: 'ink', src: 'Ward Everly\'s letter', title: 'Ward Everly to his mother, never mailed (in a tobacco tin under Barracks 3)',
    text: "Aug 16, 1936\n\nDear Mother,\nThey have stopped looking for Tommy. The Army captain says he went down the Cut and will turn up in the spring.\nMr. Pike the old lookout came over to camp and asked to talk to the ones who saw the lantern. He asked us how many. I said one. Albie said two. Mr. Pike said it's always two, and one of them is always ours.\nHe told us about the man at the creek. He said his name is Lindahl and he was the lookout at the Point before him, and he lost his boy on the 9th of August 1924, and he sits on that rock because it's where they laid the boy down. He said don't look at him because he's looking for his boy and he isn't particular.\nHe said old Halvorsen who trapped up Cold Creek before the war wrote it all down and nobody read it.\nI put Tommy's lamp in the big cedar with the others. Don't worry. I am all right. I don't go out after dark.\n\nYour son,\nWard",
    leads: [{ place: 'trapper', name: 'Halvorsen\'s cabin', quote: 'old Halvorsen who trapped up Cold Creek before the war wrote it all down' }, { place: 'cedar', name: 'the big cedar', quote: 'I put Tommy\'s lamp in the big cedar with the others.' }],
    rules: { 1: '— Pike, Tamarack Pt., 1925' } },

  // --- Tamarack Point
  { id: 'point_ledger', place: 'point', get: 'take', hand: 'pencil', title: 'Tamarack Point station diary, 1924 (in the stove)',
    text: "TAMARACK POINT L.O. · 1924 · A. LINDAHL\n\nJuly 26. Carl come up with the pack string. He is eleven and wants to be a lookout.\nJuly 30. Carl has the firefinder and the heliograph. He flashes the station at noon and Hendry flashes back.\nAug 8. Carl walked down to Silver Fork with Hendry for the mail. Back tomorrow night. I will show the lantern from the Point so he finds the footlog in the dark.\nAug 9. Lantern out at 9. Half past, there were two. Mine on the Point. One on the rim of the Cut below the footlog, low and steady. It answered mine before I was done. I waved mine. It waved. I stopped. It did not stop.\nCarl went to the steady one.\nAug 10. They brought him up out of the Cut at noon and laid him on the flat rock by the creek while Hendry went for the mule.\nAug 11. I am at the creek. Hendry brought my supper up.\nAug 12. At the creek.\n\n⟨ink⟩Lindahl would not come away from the rock. Hendry found him there Oct 20 in the first snow and they buried him at Silver Fork. He was back on the rock in June. I have not looked at him. — H. Pike, 1925" },
  { id: 'point_card', place: 'point', get: 'take', hand: 'own', title: 'Rules of the station, nailed inside the cupola',
    text: '⟨own⟩TAMARACK POINT · RULES OF THE STATION · 1925\n1. Answer every lamp. Count them first.\n2. Do not look at Lindahl at the creek.\n3. Keep the lamp lit until daylight. The boy has to have one that is ours.\n4. A lamp that answers before you finish is not a man.\n— H.P.',
    rules: { 1: '— Pike, Tamarack Pt., 1925', 4: '— Pike ’25: “Lindahl”' } },
  { id: 'point_drawing', place: 'point', get: 'take', hand: 'child', drawing: 'carl', title: 'A child\'s drawing, folded in the diary',
    text: '⟨child⟩TAMARACK POINT L.O.\nPAPA\nME\nFOOTLOG\nCREEK\nBY CARL LINDAHL AGE 11' },
  { id: 'point_grave', place: 'point', get: 'copy', hand: 'print', title: 'Tin plate on the small cairn', text: 'H. PIKE · LOOKOUT · TAMARACK POINT · 1925 – 1937' },

  // --- Halvorsen's cabin
  { id: 'trapper_pages', place: 'trapper', get: 'take', hand: 'pencil', title: 'Pages in a Prince Albert tin, in the stove',
    text: 'Nov 1912. Lamps on the Cut again. Never where a man could be. Along the rim slow and even like a lamp carried on a tray. Lachance says let them be.\nAug 1914. Something walks where I walk, a step behind, and stops when I stop. Turned with the lantern and it went off through the salal. Not a bear. Lachance says it is only the woods counting me.\nAug 9 1915. A lamp come up the creek to my door and stood there. I did not open. Morning, bare feet in the mud going back down toward the Cut.\nLachances rules for this country. Dont go to a lamp you didnt light. Dont light one for what isnt yours. Dont sit down in the dark.\nAug 1918. Lachance went to one.\n1919. The Forest Service is putting a man on the Point with a lamp. I told the ranger. He laughed.' },
  { id: 'trapper_tally', place: 'trapper', get: 'copy', hand: 'print', title: 'Knife cuts on the door frame', text: '1911\n1912 |\n1913 |\n1914 |\n1915 |\n1916 |\n1917\n1918 |\n1919 |' },

  // --- the gage below the Cut
  { id: 'gage_desc', place: 'gage', get: 'copy', hand: 'typed', title: 'Station description, tacked inside the gage house',
    text: '⟨typed⟩U.S. GEOLOGICAL SURVEY · WATER RESOURCES DIVISION\n14-1575.00 COLD CREEK BELOW THE CUT, NEAR SILVER FORK, OREG.\nEstablished June 1951.\nGage: water-stage recorder in stilling well; staff gage; cableway.\nRemarks: Cold Creek sinks into boulder fill in the Cut 0.2 mi upstream. Channel at gage is dry most of the year. Brief flows are recorded at night in late summer with no rainfall and no flow upstream. Cause not determined. Records poor.' },
  { id: 'gage_chart', place: 'gage', get: 'take', hand: 'pencil', title: 'Recorder chart, August 1982, with pencil notes',
    text: 'AUG 1 – 31, 1982 · stage, ft\n8-9 · 2258–2310 · peak 0.41 · no rain · no flow at Trail 1411 bridge 8-10 a.m. (checked)\n8-15 · 0122–0131 · 0.30\n8-28 · 0158–0203 · 0.12\nInspected 8-25-82, T. Wendt. Well lid wet at 0900. Prints on it, bare, pointing upstream. Tamarack L.O. came down to ask if the creek ever runs here. Told him.\nChart not changed after 8-31-82. Station discontinued (budget).' },

  // --- the fire cache
  { id: 'cache_phone', place: 'cache', get: 'copy', hand: 'pencil', title: 'Line test log, inside the phone box lid',
    text: 'TAMARACK F.C. · TELEPHONE LINE TEST\n6-10-58 · installed at cache end · OK\n6-1-59 OK · 6-3-60 OK · 5-31-61 OK · 6-1-64 OK\n8-11-66 · rang from this end 0210, nobody at cache · G.A.\n8-12-66 · same · G.A.\n6-2-67 · OK\n6-5-72 · OK · E.M.\n7-30-82 · LINE DOWN at 5th insulator, blowdown · R.T.\n8-16-82 · rang from this end 0300, twice. Line has been down since July. · R.T.' },
  { id: 'cache_memo', place: 'cache', get: 'copy', hand: 'typed', title: 'Memo taped inside the door',
    text: '⟨typed⟩U.S. FOREST SERVICE · SILVER FORK RANGER DISTRICT\nJune 2, 1966\nTo: Tamarack L.O.\nSubject: Fire cache\n1. Keep the cache locked. The key stays at the trailhead station.\n2. Do not keep lanterns, flashlights, flares or batteries in the cache.\n3. Report anything taken or moved to this office by telephone, not by radio.\nW. Corwin, District Ranger\nWC:mp' },

  // --- the trailhead station (the file: Day 6, after Joanne's call; flags.fileKey)
  { id: 'station_tow', place: 'station', get: 'copy', hand: 'typed', title: 'Notice by the door',
    text: "⟨typed⟩LANE COUNTY SHERIFF'S OFFICE\nNOTICE OF ABANDONED VEHICLE\n1971 Ford F-100 pickup, green · Oreg. HKT 118\nRegistered owner: TILLMAN, RAYMOND J., Star Rt. Box 40, Oakridge\nTagged Sept. 14, 1982, Silver Fork trailhead lot.\nRemoved Oct. 1, 1982 to Hagen's Towing, Oakridge. Storage charges accrue daily.\n⟨pencil⟩NOBODY'S COME FOR IT. — W." },
  // (the list's 1950 line is the one the bible lacks: the West lookout, 1934, that the fire came up the draw to)
  { id: 'station_file', place: 'station', get: 'take', hand: 'typed', fromDay: 6, needs: 'fileKey', src: 'the district\'s list', title: 'District file, bottom drawer: TAMARACK L.O.',
    text: '⟨typed⟩FOREST SUPERVISOR TO DISTRICT RANGER, SILVER FORK · Sept. 20, 1965\nSubject: Tamarack L.O.\nBeginning in 1966, Tamarack L.O. will be staffed every season, June 15 to September 15, regardless of detection needs or air patrol coverage, and in any case on August 9. Where no qualified lookout is available, hire one. Do not discuss the reasons for this order in correspondence.\nR. Haugen, Forest Supervisor\n\nTAMARACK — PERSONS LOST. Compiled W.C., Sept. 1965. Keep current.\n1924 · Carl Lindahl, 11 · the Cut · recovered Aug. 10\n1924 · A. Lindahl, L.O., Tamarack Pt. · at the creek · died Oct.\n1931 · sheepman, name unknown · the Cut · not recovered\n1936 · Thomas Kerr, 18, CCC Co. 1492 · the Cut · not recovered\n1938 · H. Pike, former L.O. · Tamarack Pt. · found May, lamp lit\n1947 · L. and Ada Varga, fishing · Cold Creek · not recovered\n1950 · O. Teague, L.O., Tamarack West · burned over Aug. 14 · came out by the old road, with his dog\n1961 · H. Rainey, pilot, Tanker 14 · NW of L.O. · recovered\n1965 · G. and Irene Albrecht; Dora Soto, 9 · Silver Fork Campground · not recovered · L.O. NOT STAFFED\n1966 · Gene Aldous, L.O. · tower stairs · recovered (heart)\n1974 · Ellen Maki, L.O. · rim of the Cut · not recovered\n1982 · Dale Everly, 19 · the Cut · not recovered\n⟨ink⟩1982 · R. Tillman, L.O. · — · not reported. jh',
    leads: [{ place: 'tanker', name: 'Tanker 14', quote: '1961 · H. Rainey, pilot, Tanker 14 · NW of L.O.' }, { place: 'point', name: 'Tamarack Pt.', quote: '1938 · H. Pike, former L.O. · Tamarack Pt. · found May, lamp lit' },
      { place: 'cairn', name: 'where Ellen Maki went', quote: '1974 · Ellen Maki, L.O. · rim of the Cut' }],
    rules: { 2: '— after Aldous, ’66', 5: '— after Aldous, ’66' } },
  { id: 'station_file2', place: 'station', get: 'take', hand: 'typed', fromDay: 6, needs: 'fileKey', title: 'District file, bottom drawer: correspondence',
    text: "⟨typed⟩H. MORROW, M.D. · SILVER FORK CLINIC · July 9, 1974\nMr. Corwin — As agreed I will see Tamarack personnel on request. I have prescribed chlorpromazine to Miss Maki for sleep. I must say again that I do not find her delusional, and I would not keep her up there.\n\nFIRE REPORT · TAMARACK WEST · discovered 8-12-80, 0214, by Tamarack L.O. · 340 acres · General cause: 1, Lightning · Specific: holdover strike · Investigator: (not signed)\n\n⟨ink⟩Typed up a card for R.T. from the old one. Left mine and Ellen's off. He can write those in himself. 6-81. — jh\n\n8-26-82. Supervisor: nobody is to answer Tamarack on the radio until further notice. — jh\n\n⟨typed⟩PERSONNEL ACTION · Pell, Donald R., Asst. District Ranger · Leave without pay effective 8-21-82.\n⟨pencil⟩Found 9-3 in his car at the Cold Creek pullout. Engine off, facing the trees. Family notified.\n\n⟨ink⟩Dan — the new one starts on the 9th. I told them nothing. Somebody should. — J.",
    rules: { 6: '— J.H., ’78', 8: '— R.T., ’81', 10: '— R.T., ’82' } },
  { id: 'station_fax', place: 'station', get: 'take', hand: 'print', fax: true, fromDay: 6, needs: 'fileKey', title: 'Envelope marked TAMARACK 8-20-82 — DO NOT OPEN',
    text: 'TAMARACK L.O.    08/20/82    16:00    P.01' },

  // --- the stairs (your line is on the post from dusk on Day 7)
  { id: 'stairs_tally', place: 'stairs', get: 'copy', hand: 'pencil', late: { day: 7, hour: 19, lines: 1 }, title: 'Pencil on the post under the first landing',
    text: 'H.P. 8-36 · 144 up · 144 down\nG.A. 8-66 · 144 · 145\nE.M. 8-74 · 144 · 145\nJ.H. 8-79 · 144 · 144\nR.T. 8-28-82 · 144 · 145 · 146\n⟨own⟩8-15-83 ·',
    rules: { 2: '— after Aldous, ’66', 5: '— after Aldous, ’66' } },
];

// ---------------------------------------------------------------- what you hear of by other means
// A place is 'heard of' once any source pointing at it is known: a doc read (its leads), or one of these keys, which is
// true when flags[key] is set by the game (readTillman, readGuide, fileKey…) or learnLead(key) put it in flags.heard.
export const FLAG_LEADS = [
  { key: 'readTillman', place: 'dump', name: 'Tillman\'s missing pages', from: 'Tillman\'s log', quote: 'Aug 20. … Aug 27.' },
  { key: 'readGuide', place: 'dump', name: 'the barrel below the west side', from: 'the Station Guide', quote: 'Burn what burns in the barrel below the west side.' },
  { key: 'ducks', place: 'cairn', name: 'the stacked stones', from: 'the overlook rail', quote: null },
  { key: 'flagging', place: 'stake', name: 'the red flagging', from: 'the Camp Loop', quote: null },
  { key: 'fileKey', place: 'station', name: 'the file cabinet at the station', from: 'Joanne', quote: 'The file cabinet under the fax, bottom drawer. The key\'s taped under the desk.' },
  { key: 'gageSign', place: 'gage', name: 'the gage', from: 'the sign at J2', quote: 'U.S.G.S. GAGING STATION 14-1575.00 · 150 YDS E' },
  { key: 'pikeLamp', place: 'point', name: 'the lamp on the east ridge', from: 'the catwalk', quote: null },
  { key: 'finderT14', place: 'tanker', name: 'T-14', from: 'the fire finder\'s map', quote: 'T-14 8-9-61' },
  { key: 'gateposts', place: 'ccc', name: 'the gateposts', from: 'the lot', quote: 'CO. 1492 · CCC' },
];

// ---------------------------------------------------------------- the rules card: notes that don't come from a paper
export const FLAG_RULES = [{ key: 'readTillman', rules: { 11: '— R.T., Aug ’82', 12: '— R.T., Aug ’82' } }];

// ---------------------------------------------------------------- the fire cache's sign-out sheet (a line dated tomorrow)
/** The clipboard by the cache door on a given day (1 = Tue Aug 9): Tillman's kerosene from Day 4, your gas from Day 6. */
export function cacheSheetText(day = 1) {
  return ['⟨print⟩SILVER FORK R.D. · TAMARACK FIRE CACHE · EQUIPMENT OUT', '', 'DATE · ITEM · QTY · SIGNED',
    '⟨ink⟩6-02-81 · shovel · 1 · J. Haskins', '7-19-81 · backpack pump · 1 · R. Tillman', '7-09-82 · gas · 2 cans · R. Tillman', '8-27-82 · gas · 2 cans · R. Tillman',
    '⟨pencil⟩8-10-83 · BOOTS, RUBBER · 1 PAIR · D.E.',
    ...(day >= 4 ? ['⟨ink⟩8-13-83 · kerosene · 1 gal · R. Tillman'] : []),
    ...(day >= 6 ? ['⟨own⟩8-15-83 · gas · 2 cans · TAMARACK'] : [])].join('\n');
}

export const PLACE = Object.fromEntries(PLACES.map((p) => [p.id, p]));
export const DOC = Object.fromEntries(DOCS.map((d) => [d.id, d]));
export const HANDS = ['typed', 'print', 'ink', 'pencil', 'own', 'child'];
