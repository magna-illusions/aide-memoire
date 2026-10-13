import { applyEntryEvent } from '../log/fold.ts'
import { wordingsForgottenBy, type ForgottenWording } from '../log/redact.ts'
import type { EntryEvent, EntryOperation, EntryState } from '../log/types.ts'
import { validate, type ValidationContext, type Verdict } from '../validation/validate.ts'
import { forgottenProblem, forgottenSince } from './forgotten.ts'

// The write path without the store. Every host does the same around the
// validator: check each operation against the state the ones before it left,
// append what is let through in order, a run's marker first, follow a forget
// through, and save the state it ends on. This is that, as data; the store does
// the I/O, in one transaction under the stream's lock, and makes a redelivered
// write a no-op with the dedupe key the caller holds.

/** A whole write: the validation context, the operations in order, and what the pass planned from. */
interface WriteRequest extends ValidationContext {
  /** What the writer submits, in order. */
  ops: EntryOperation[]
  /**
   * The state the operations were planned from, when it was loaded before a slow
   * step (a model call). An operation that would bring back words forgotten
   * since is refused.
   */
  base?: EntryState
  /** A host event appended first: a run's record of itself. The fold skips it. */
  marker?: { type: string; payload: Record<string, unknown> }
  /**
   * Your last word on each operation before it is checked, given the state the
   * ones before it left: fill in a default, say. What it returns is what is
   * guarded and validated. Your code: what it throws propagates.
   */
  prepare?: (op: EntryOperation, state: EntryState) => EntryOperation
}

/** One event to append. An entry event's payload is the event itself. */
interface WriteAppend {
  type: string
  payload: EntryEvent | Record<string, unknown>
}

/** An entry a forget in this write took, and the wordings it took, for clearing your own copies. */
interface WriteForget {
  id: string
  wordings: ForgottenWording[]
}

/** A write as data: the verdicts, what to append, what a forget took, and the state to save. */
interface WritePlan {
  verdicts: Verdict[]
  /** What to append, in order, as one batch: the store puts the caller's dedupe key on the first. */
  append: WriteAppend[]
  /**
   * The forgets this write appends. After appending, write `tombstoneRedacted`
   * of the whole log back over the stored events, so the words leave the history.
   */
  forgets: WriteForget[]
  /** The state after the write: what to save as the projection. */
  state: EntryState
}

function verdictFor(state: EntryState, op: EntryOperation, guarded: RegExp[], ctx: ValidationContext): Verdict {
  const forgotten = forgottenProblem(op, guarded, ctx.policy.maxTextLength)
  return forgotten ? { verdict: 'reject', reason: forgotten } : validate(state, op, ctx)
}

/**
 * The write as data: verdicts, what to append, what a forget took, and the state
 * it leaves. Pure given a pure `prepare`, and like validate it never throws on what an operation holds.
 */
function planWrite(state: EntryState, request: WriteRequest): WritePlan {
  const { ops, base, marker, prepare, ...ctx } = request
  const guarded = base ? forgottenSince(base, state, ctx.policy.stopwords) : []
  const verdicts: Verdict[] = []
  const appended: WriteAppend[] = marker ? [{ type: marker.type, payload: marker.payload }] : []
  const forgets: WriteForget[] = []
  let current = state
  for (const submitted of ops) {
    const op = prepare ? prepare(submitted, current) : submitted
    const verdict = verdictFor(current, op, guarded, ctx)
    verdicts.push(verdict)
    if (verdict.verdict === 'reject') continue
    const { event } = verdict
    if (event.type === 'EntryRedacted') forgets.push({ id: event.id, wordings: wordingsForgottenBy(current, event.id) })
    appended.push({ type: event.type, payload: event })
    current = applyEntryEvent(current, event)
  }
  return { verdicts, append: appended, forgets, state: current }
}

export { planWrite }
export type { WriteRequest, WritePlan, WriteAppend, WriteForget }
