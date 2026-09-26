// FALSE LIGHT — Thursday morning: the epilogue. Everything you did (or didn't) on the two nights decides what the truck finds,
// what the district believes, who else pays for it, and the last line. Plain data in, text out.

/** st: { proofs, goal, savedN1, lostN1, falseWalked, gateOpenedByIt, faceSent, faceKept, dogName (null if never tamed),
 *        prints, sent, treeSeen } → { text, paras: [..], last, detail, grade } */
export function epilogue(st) {
  const P = []
  // the district
  if (st.proofs >= st.goal) P.push('Silver Fork sends two rangers up with the truck. They read the logbook at the table for a long time without saying anything. By noon Tamarack is closed, the shutters nailed, the generator drained. Nobody tells you why, and nobody asks you to explain.')
  else if (st.proofs > 0) P.push(`Silver Fork has ${st.proofs === 1 ? 'your print' : 'your prints'} on a desk. Someone has circled something in pencil. Nobody calls. The relief lookout comes up with the truck anyway, a college kid from Yakima who has never heard of Tillman.`)
  else P.push('Silver Fork thinks you\'ve been alone up here too long. The relief lookout comes up with the truck, a college kid from Yakima. You give him the logbook. He laughs at the card taped to the fire finder, and then he stops laughing.')
  // Lyle Pruitt
  if (st.savedN1) P.push('Lyle Pruitt calls the district from a pay phone in Packwood to say thank you. Before he hangs up he asks who the other lookout was: the one on the ridge who kept flashing at him after you did.')
  else if (st.lostN1) P.push('A search party finds Lyle Pruitt\'s flashlight at the bottom of the ravine, still switched on. They don\'t find Lyle Pruitt.')
  // the false light
  if (st.falseWalked) P.push('At the gate there are bare footprints in the dust, coming up from the ravine. They go through the gate and up the stairs. None of them come back down.')
  else if (st.gateOpenedByIt) P.push('The gate at the foot of the stairs is standing open. You remember shutting it.')
  // his face
  if (st.faceSent) P.push('The man who looked at the picture of his face doesn\'t come in to work on Thursday. His wife tells the district he went out to the car in the night and just sat in it, facing the trees.')
  else if (st.faceKept) P.push('One print is still in your pack, face-down. You haven\'t turned it over. You keep thinking about turning it over.')
  // her
  if (st.dogName) P.push(`${st.dogName} won't get into the truck until you do. All the way down the switchbacks she watches the tree line and doesn't blink.`)
  // the last line: what's still out there
  const last = st.faceKept ? 'Somewhere down by the creek, very quietly, somebody starts to cry.'
    : st.falseWalked ? 'Tonight someone else will sit in the tower. Tonight the light will be on the ridge again, flashing very evenly.'
    : st.treeSeen ? 'In the side mirror, at the edge of the trees, someone is standing very still, facing the road.'
    : 'In the rear-view mirror the tower\'s windows are dark. Then one of them isn\'t.'
  const grade = st.proofs >= st.goal ? 'believed' : st.lostN1 || st.faceSent || st.falseWalked ? 'cost' : 'survived'
  return {
    text: 'Thursday, August 11, 1983. The truck comes up the road at ten past six.',
    paras: P, last, grade,
    detail: `Proof sent: ${st.proofs} of ${st.goal} · prints taken: ${st.prints} (${st.sent} sent) · ${st.savedN1 ? 'Lyle Pruitt lived' : st.lostN1 ? 'Lyle Pruitt was lost' : 'Lyle Pruitt: unknown'}${st.falseWalked ? ' · you walked the false light' : ''}${st.dogName ? ` · ${st.dogName} came home` : ''}`,
  }
}
