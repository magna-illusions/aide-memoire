import { normaliseText, relays } from '../text.ts'
import { carriesEntry } from '../log/events.ts'
import type { Assertion, EntryDraft, EntryEvent, ProposableOp } from '../log/types.ts'
import { evidenceOf, recordTime } from './source.ts'
import type { ValidationContext } from './validate.ts'

// What the validator writes onto an event it lets through, so the stored event
// says what the host knows rather than what was submitted: the text normalised,
// the host's clock, the host's time for a cited record, whether the agent relayed
// the subject's words, and no hard entry from external text. The writer's own
// stamp is writer.ts's.

// The text is normalised once, before any rule reads it, and stored that way: a
// rule and the reader then see the same characters.
function normalised<T extends EntryEvent>(event: T): T {
  if (event.type === 'EntryProposed') return { ...event, op: normalised(event.op) }
  if (!carriesEntry(event)) return event
  return { ...event, entry: { ...event.entry, text: normaliseText(event.entry.text) } }
}

// Whose words an entry holds, for the reader. The agent's entry passed
// `claimProblem`, so its cited message is the subject's and touches it; it is
// the subject's words, relayed, only when that message also holds most of it
// (`relays`) — "it felt okay" does not relay "surgery in 2019, wants to stop".
// Every other writer's mark is false, and whatever the event claimed is
// overwritten. It changes how the entry reads and ranks, never what anyone may
// do: assertedBy stays the writer's.
function isRelayed(draft: EntryDraft, ctx: ValidationContext): boolean {
  const { source } = draft
  if (ctx.writer !== 'agent' || ctx.external || source.kind !== 'message') return false
  const message = ctx.messages.find((m) => m.id === source.id)
  return message !== undefined && relays(draft.text, message.text, ctx.policy.stopwords)
}

function markRelayed<T extends EntryEvent>(event: T, ctx: ValidationContext): T {
  if (!carriesEntry(event)) return event
  return { ...event, entry: { ...event.entry, relayed: isRelayed(event.entry, ctx) } }
}

// The event happens now, on the host's clock — and so does an operation it holds.
function atNow<T extends EntryEvent>(event: T, now: string): T {
  if (event.type === 'EntryProposed') return { ...event, at: now, op: atNow(event.op, now) }
  return { ...event, at: now }
}

// A cited record is stored with the host's time for it, as the event's own time is.
function withRecordTime<T extends Assertion>(by: T, ctx: ValidationContext): T {
  return by.source.kind === 'record' ? { ...by, source: recordTime(by.source, evidenceOf(ctx)) } : by
}

function recordTimed<T extends EntryEvent>(event: T, ctx: ValidationContext): T {
  if (event.type === 'EntryProposed') return { ...event, op: recordTimed(event.op, ctx) }
  if (carriesEntry(event)) return { ...event, entry: withRecordTime(event.entry, ctx) }
  return withRecordTime(event as T & Assertion, ctx)
}

// External text can never yield a hard entry, held or not.
function softened(op: ProposableOp, ctx: ValidationContext): ProposableOp {
  if (op.type === 'EntryRetired' || !ctx.external) return op
  return { ...op, entry: { ...op.entry, severity: 'soft' } }
}

export { normalised, markRelayed, atNow, recordTimed, softened }
