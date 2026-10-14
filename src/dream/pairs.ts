import { liveEntries } from '../log/fold.ts'
import { isLapsed } from '../log/lapse.ts'
import { sharesContentWords } from '../text.ts'
import type { Entry, EntryState, Message } from '../log/types.ts'
import { saysTheSame } from './similar.ts'
import type { PassPolicy } from './types.ts'

// What the weekly review is shown: only two live entries of one kind that share
// a topic word can contradict each other, so only those pairs are sent, with
// the subject's messages that speak of them. A pair the daily pass ends as a
// copy (one severity, the duplicate share) is not a contradiction and is left
// to it. No pair, no call.
//
// "Shares a topic" is core's citation test — one content word, inflections
// included — loose on purpose: a false pair costs a few tokens, a missed one a
// contradiction nobody asks about.

type Pair = [Entry, Entry]

function isCopy(a: Entry, b: Entry, policy: PassPolicy): boolean {
  return a.severity === b.severity && saysTheSame(a.text, b.text, policy)
}

function mayContradict(a: Entry, b: Entry, policy: PassPolicy): boolean {
  return a.kind === b.kind && sharesContentWords(a.text, b.text, policy.stopwords) && !isCopy(a, b, policy)
}

/** Every pair of live entries the review should compare, oldest first within a pair. */
function contradictionPairs(state: EntryState, today: string, policy: PassPolicy): Pair[] {
  const live = liveEntries(state).filter((e) => !e.redacted && !isLapsed(e, today))
  return live.flatMap((a, i) => live.slice(i + 1).filter((b) => mayContradict(a, b, policy)).map((b): Pair => [a, b]))
}

/** The state cut down to the paired entries and the open questions about them. */
function pairedState(state: EntryState, pairs: Pair[]): EntryState {
  const ids = new Set(pairs.flat().map((e) => e.id))
  const target = ({ op }: EntryState['proposals'][number]) =>
    op.type === 'EntryRetired' ? op.id : op.type === 'EntrySuperseded' ? op.supersedes : ''
  const about = (p: EntryState['proposals'][number]) => ids.has(target(p))
  return { ...state, entries: state.entries.filter((e) => ids.has(e.id)), proposals: state.proposals.filter(about) }
}

/** The messages that speak of a paired entry: the only ones a supersede or retire of it could cite. */
function speakingOf<T extends Message>(messages: T[], pairs: Pair[], policy: PassPolicy): T[] {
  const texts = pairs.flat().map((e) => e.text)
  return messages.filter((m) => texts.some((text) => sharesContentWords(text, m.text, policy.stopwords)))
}

export { contradictionPairs, pairedState, speakingOf }
export type { Pair }
