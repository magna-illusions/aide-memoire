import type { EntryAdded, EntrySuperseded, EntryRetired } from './types.ts'

// Which operations do what, said once, for every union the code reads: stored
// events, submitted operations, proposed ones.

type Typed = { type: string }

/** An add or a supersede: an operation that writes an entry. */
function carriesEntry<T extends Typed>(event: T): event is Extract<T, { type: (EntryAdded | EntrySuperseded)['type'] }> {
  return event.type === 'EntryAdded' || event.type === 'EntrySuperseded'
}

/** An add, a supersede or a retire: an operation that can be held as a proposal. */
function isProposable<T extends Typed>(event: T): event is Extract<T, { type: (EntryAdded | EntrySuperseded | EntryRetired)['type'] }> {
  return carriesEntry(event) || event.type === 'EntryRetired'
}

export { carriesEntry, isProposable }
