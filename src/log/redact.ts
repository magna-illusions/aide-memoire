import { findEntry, foldEntries, redact, REDACTED } from './fold.ts'
import { shapeProblem } from './shape.ts'
import type { EntryEvent, EntryState } from './types.ts'

// Forgetting one thing. Erasing a whole subject is the store's job (destroy the
// key, drop the stream); "forget that" about a single entry is a redact, and it
// is the one sanctioned exception to append-only: the log keeps every event, in
// order, with its type and time, and loses the words. The fold already treats a
// redacted entry as gone (fold.ts); this is what the host writes back over the
// stored events, so the words leave the history too and not only the rendering.
//
// Which entries a redact reaches — the wordings it replaced through an applied
// supersede, the open proposals that would reword it, and never the live entry a
// proposal merely named — is decided once, by the fold. The log is wiped of
// exactly the set the fold left redacted, so the two can never disagree. A redact
// carries no reason of its own (shape.ts drops any field it does not mean), so
// the event that forgets cannot restate what it forgot.

function redactedIds(events: EntryEvent[]): Set<string> {
  return new Set(foldEntries(events).entries.filter((entry) => entry.redacted).map((entry) => entry.id))
}

// Does this operation create, word or name one of the forgotten entries?
function touches(op: EntryEvent, ids: Set<string>): boolean {
  if (op.type === 'EntryAdded') return ids.has(op.entry.id)
  if (op.type === 'EntrySuperseded') return ids.has(op.entry.id) || ids.has(op.supersedes)
  return op.type === 'EntryRetired' && ids.has(op.id)
}

// Text goes empty; a free-text reason — a retire's, or the one an agent gave
// for a proposal — becomes a fixed token, since it may restate the entry. An
// event already so is returned as it is, so a second pass changes nothing.
function tombstone(event: EntryEvent, ids: Set<string>): EntryEvent {
  if (shapeProblem(event)) return event
  switch (event.type) {
    case 'EntryAdded':
    case 'EntrySuperseded':
      return ids.has(event.entry.id) && event.entry.text !== '' ? { ...event, entry: { ...event.entry, text: '' } } : event
    case 'EntryRetired':
      return ids.has(event.id) && event.reason !== REDACTED ? { ...event, reason: REDACTED } : event
    case 'EntryProposed': {
      if (!touches(event.op, ids)) return event
      const op = tombstone(event.op, ids) as typeof event.op
      return op === event.op && event.reason === REDACTED ? event : { ...event, reason: REDACTED, op }
    }
    default:
      return event
  }
}

/**
 * The log with every forgotten entry's words gone, every event kept in order. An
 * event it leaves unchanged, one already tombstoned included, comes back as the
 * same object, so a host rewrites exactly the events where `tombstoned[i] !== events[i]`.
 */
function tombstoneRedacted(events: EntryEvent[]): EntryEvent[] {
  const ids = redactedIds(events)
  return ids.size === 0 ? events : events.map((event) => tombstone(event, ids))
}

// The wordings a forget of `id` would take, asked of the state before it is
// written: the fold's own reach, so a host clearing another copy of them clears
// exactly what the log will lose. Each says its kind and severity, and which
// entries that survive the forget still hold the same words (case and spacing
// aside), so the host can tell whose copy it is clearing. Empty for an id the
// state does not hold, or one already forgotten.
/** The kind and severity of an entry that holds some words. */
interface Holder {
  kind: string
  severity: 'soft' | 'hard'
}

/** One wording a forget would take, and the surviving entries that hold the same words. */
interface ForgottenWording extends Holder {
  text: string
  /** Entries left after the forget that hold the same words. */
  heldBy: Holder[]
}

const folded = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** What a forget of `id` would take, asked of the state before it: each wording, and who still holds the same words. */
function wordingsForgottenBy(state: EntryState, id: string): ForgottenWording[] {
  const after = redact(state, id, '')
  const survivors = after.entries.filter((e) => !e.redacted && e.text)
  return state.entries
    .filter((e) => !e.redacted && e.text && findEntry(after, e.id)?.redacted)
    .map(({ text, kind, severity }) => ({
      text, kind, severity,
      heldBy: survivors.filter((s) => folded(s.text) === folded(text)).map((s) => ({ kind: s.kind, severity: s.severity })),
    }))
}

export { tombstoneRedacted, wordingsForgottenBy }
export type { ForgottenWording, Holder }
