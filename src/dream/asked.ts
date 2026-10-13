import type { EntryState, ProposableOp } from '../log/types.ts'

// Whether the subject has already been asked about an entry: a proposal to end
// or change it, open, or made since a day. A pass that asks again while one
// waits, or straight after an answer, is the spam the policy caps exist against.

function changes(op: ProposableOp, id: string): boolean {
  if (op.type === 'EntryRetired') return op.id === id
  return op.type === 'EntrySuperseded' && op.supersedes === id
}

/** Open, or made on or after `since` (YYYY-MM-DD) whatever its answer; open only when `since` is left out. */
function askedAbout(state: EntryState, id: string, since?: string): boolean {
  return state.proposals.some((p) => changes(p.op, id) && (p.status === 'open' || (since !== undefined && p.at.slice(0, 10) >= since)))
}

/**
 * Whether the subject ever said no to this question about the entry — the
 * proposals `isSame` recognises: then it is not asked again, cooldown or not.
 * Their no to another question (a check-in) answers that one only.
 */
function declinedFor(state: EntryState, id: string, isSame: (op: ProposableOp) => boolean): boolean {
  return state.proposals.some((p) => p.status === 'discarded' && changes(p.op, id) && isSame(p.op))
}

export { askedAbout, declinedFor }
