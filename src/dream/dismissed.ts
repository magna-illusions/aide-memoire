import { carriesEntry } from '../log/events.ts'
import { findEntry } from '../log/fold.ts'
import type { EntryEvent, EntryState, Proposal } from '../log/types.ts'
import { dayOf } from './days.ts'
import { overlap } from './similar.ts'

// What the subject has already said no to. The weekly review is shown the
// proposals they dismissed recently and told not to ask again; and since a
// prompt is a request, not a guarantee, a proposal that repeats one anyway —
// the same end of the same entry, or words that closely match — is dropped
// before it reaches the validator.

/** A proposal the subject dismissed, as the review is shown it. */
interface Dismissed {
  id: string
  change: 'add' | 'change' | 'end'
  kind: string
  /** The entry an end or a change was about. */
  target?: string
  text: string
  askedOn: string
}

const FORGOTTEN = new Set(['', '[redacted]'])

function asDismissed(state: EntryState, p: Proposal): Dismissed | null {
  const { op } = p
  const target = op.type === 'EntryRetired' ? op.id : op.type === 'EntrySuperseded' ? op.supersedes : undefined
  const entry = target ? findEntry(state, target) : undefined
  const text = op.type === 'EntryRetired' ? entry?.text ?? '' : op.entry.text
  if (FORGOTTEN.has(text) || entry?.redacted) return null
  const change = op.type === 'EntryRetired' ? 'end' : op.type === 'EntrySuperseded' ? 'change' : 'add'
  const kind = op.type === 'EntryRetired' ? entry?.kind ?? '' : op.entry.kind
  return { id: p.id, change, kind, ...(target ? { target } : {}), text, askedOn: dayOf(p.at) }
}

/** Proposals asked on or after `since` (YYYY-MM-DD) that the subject dismissed, whose words are still kept. */
function dismissedSince(state: EntryState, since: string): Dismissed[] {
  return state.proposals
    .filter((p) => p.status === 'discarded' && dayOf(p.at) >= since)
    .flatMap((p) => asDismissed(state, p) ?? [])
}

/** Whether an operation asks again what the subject dismissed: the same end, or words that share at least `share`. */
function repeatsDismissed(event: EntryEvent, dismissed: Dismissed[], share: number, stopwords: Set<string>): boolean {
  const op = event.type === 'EntryProposed' ? event.op : event
  if (op.type === 'EntryRetired') return dismissed.some((d) => d.change === 'end' && d.target === op.id)
  if (!carriesEntry(op)) return false
  return dismissed.some((d) => d.change !== 'end' && overlap(op.entry.text, d.text, stopwords) >= share)
}

export { dismissedSince, repeatsDismissed }
export type { Dismissed }
