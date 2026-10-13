import type { EntryOperation, Severity, Source } from '../log/types.ts'

// The operations, built from what each one means. They emit today's event types
// exactly, minus what the validator stamps anyway: when it happened (`now`),
// whose claim it is and how its text arrived (the writer). A held write is a
// question: `apply` and `discard` answer one; `confirm` and `dismiss` answer a
// live entry.

type Op<T extends EntryOperation['type']> = Extract<EntryOperation, { type: T }>

/** An entry as you write it: one sentence of a kind, resting on a source. Soft unless you say hard. */
interface EntrySpec {
  id: string
  kind: string
  text: string
  source: Source
  severity?: Severity
  /** The last day it is expected to hold, `YYYY-MM-DD`. */
  until?: string
  /** The day to ask about it again, `YYYY-MM-DD`. */
  review?: string
}

function entryOf({ id, kind, text, source, severity = 'soft', until, review }: EntrySpec) {
  return { id, kind, text, severity, source, ...(until === undefined ? {} : { until }), ...(review === undefined ? {} : { review }) }
}

/** Adds an entry. */
function add(entry: EntrySpec): Op<'EntryAdded'> {
  return { type: 'EntryAdded', entry: entryOf(entry) }
}

/** Replaces live entry `id` with a new one, of the same kind. */
function supersede(id: string, entry: EntrySpec): Op<'EntrySuperseded'> {
  return { type: 'EntrySuperseded', supersedes: id, entry: entryOf(entry) }
}

/** Ends live entry `id`, saying why. */
function retire(id: string, reason: string, source: Source): Op<'EntryRetired'> {
  return { type: 'EntryRetired', id, reason, source }
}

/** Answers a question yes: the write it held goes through. */
function apply(questionId: string, source: Source): Op<'EntryConfirmed'> {
  return { type: 'EntryConfirmed', target: 'proposal', id: questionId, source }
}

/** Answers a question no: the write it held is dropped, and what it named stays as it was. */
function discard(questionId: string, source: Source): Op<'EntryDismissed'> {
  return { type: 'EntryDismissed', target: 'proposal', id: questionId, source }
}

/** Says live entry `id` still holds. */
function confirm(id: string, source: Source): Op<'EntryConfirmed'> {
  return { type: 'EntryConfirmed', target: 'entry', id, source }
}

/** Says live entry `id` is wrong: it ends. */
function dismiss(id: string, source: Source): Op<'EntryDismissed'> {
  return { type: 'EntryDismissed', target: 'entry', id, source }
}

/** Forgets entry `id`: its words leave the state, and every event once you rewrite the log. */
function forget(id: string, source: Source): Op<'EntryRedacted'> {
  return { type: 'EntryRedacted', id, source }
}

export { add, supersede, retire, apply, discard, confirm, dismiss, forget }
export type { EntrySpec }
