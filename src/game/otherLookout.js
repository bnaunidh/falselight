// The Other Lookout. Someone else lives in the tower: boots on the catwalk, entries in your
// handwriting. You never see his face. Pure: a list of one-shot events with conditions.
export const OTHER_EVENTS = [
  // id, phase, when(ctx) → bool
  { id: 'boots_catwalk', phase: 'day1', when: (c) => c.hour >= 19.4 && c.zone === 'cab' },
  { id: 'own_entry_hatch', phase: 'night1', when: (c) => c.flags.refueledOnce && c.zone === 'cab' && c.flags.leftCabAfterRefuel },
  { id: 'own_entry_gate', phase: 'day2', when: (c) => c.hour >= 7.6 && c.flags.gateRattled },
  { id: 'fax_silhouette', phase: 'day2', when: (c) => c.flags.faxUsed },
  { id: 'bed_sitter', phase: 'night2', when: (c) => c.zone === 'cab' && (c.flags.leftCabNight2 || c.hour >= 25.5) && !c.flags.weeperComing },
  { id: 'own_entry_closer', phase: 'night2', when: (c) => c.flags.lostHikerStepped >= 2 },
  { id: 'boots_catwalk_2', phase: 'night2', when: (c) => c.hour >= 27.2 && c.zone === 'cab' },
]

export class OtherLookout {
  constructor(fired = []) { this.fired = new Set(fired) }
  /** ctx: { phase, hour, zone, flags } → list of event ids that fire now (each fires once per run). */
  check(ctx) {
    const out = []
    for (const e of OTHER_EVENTS) {
      if (e.phase !== ctx.phase || this.fired.has(e.id)) continue
      if (e.when(ctx)) { this.fired.add(e.id); out.push(e.id) }
    }
    return out
  }
  toJSON() { return [...this.fired] }
}
