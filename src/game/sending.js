// Three ways to send proof out, each with a catch. Pure.
//   mailbox  — any time, but slow (arrives in 2 days) and it's a long walk to the trailhead.
//   fax      — instant, daylight only (07:00–19:00), and the ranger station isn't really empty.
//   driver   — only while his truck is at the lot (Day 2, 08:00–16:00), and he looks at everything first.
export const CHANNELS = {
  mailbox: { label: 'the mailbox', arrives: 2 },
  fax: { label: 'the fax', from: 7, to: 19, arrives: 0 },
  driver: { label: 'the driver', arrives: 1 },
}

export function canSend(channel, { phase, hour, print }) {
  if (!print) return { ok: false, why: 'Nothing to send.' }
  if (print.sent) return { ok: false, why: 'That one is already gone.' }
  if (print.develop < 1 && channel !== 'mailbox' && !print.faceDown) return { ok: false, why: 'It hasn\'t finished developing.' }
  const h = ((hour % 24) + 24) % 24
  if (channel === 'fax') {
    if (/night/.test(phase) || h < CHANNELS.fax.from || h >= CHANNELS.fax.to) return { ok: false, why: 'No dial tone. The fax only works in daylight.' }
  }
  if (channel === 'driver') {
    if (phase !== 'day2' || h < 8 || h >= 16) return { ok: false, why: 'The truck isn\'t here.' }
  }
  return { ok: true }
}

/** Is this print evidence the district could not explain away? */
export function isProof(print) {
  return !!(print && print.subject && print.subject !== 'nothing')
}

/**
 * Sends a print. Returns { ok, proof, arrivesDay, driverLooked }.
 * The caller also tells the Weeper (weeper.sendAway(print.id)).
 */
export function send(print, channel, { phase, hour, day }) {
  const c = canSend(channel, { phase, hour, print })
  if (!c.ok) return { ok: false, why: c.why }
  print.sent = { channel, day, hour }
  return {
    ok: true,
    proof: isProof(print),
    arrivesDay: day + CHANNELS[channel].arrives,
    driverLooked: channel === 'driver',
    faceDown: !!print.faceDown,
  }
}
