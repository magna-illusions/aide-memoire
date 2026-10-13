import { findEntry, isApplicable, openProposals } from './fold.ts'
import type { EntryState, Proposal } from './types.ts'

// A held write is a question for the subject. Which ones are still worth asking,
// and in what order: the host's own view of them, and a pass's measure of how
// many it may add.

// Whether applying the proposal would create, change or end a hard entry.
function isHard(state: EntryState, proposal: Proposal): boolean {
  const { op } = proposal
  if (op.type !== 'EntryRetired' && op.entry.severity === 'hard') return true
  const target = op.type === 'EntryAdded' ? undefined : findEntry(state, op.type === 'EntryRetired' ? op.id : op.supersedes)
  return target?.severity === 'hard'
}

/**
 * The questions waiting for the subject: open, still applicable, and not
 * forgotten — a proposal for an entry the subject asked to forget has lost its
 * words (fold.ts) and asks nothing. Hard first, then newest: the order a host
 * raises them in.
 */
function waitingQuestions(state: EntryState): Proposal[] {
  return openProposals(state)
    .filter((p) => isApplicable(state, p) && (p.op.type === 'EntryRetired' || p.op.entry.text !== ''))
    .sort((a, b) => Number(isHard(state, b)) - Number(isHard(state, a)) || b.at.localeCompare(a.at))
}

export { waitingQuestions }
