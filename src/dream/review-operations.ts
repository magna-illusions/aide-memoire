import { isProposable } from '../log/events.ts'
import { assertionFor } from '../validation/writer.ts'
import type { KindRule } from '../validation/validate.ts'
import type { Assertion, EntryDraft, EntryEvent, ProposableOp } from '../log/types.ts'
import { repeatsDismissed, type Dismissed } from './dismissed.ts'
import type { PassPolicy } from './types.ts'

// What a model recorded through an operations tool, as operations for the
// validator (writer `consolidation`), which still decides what is appended,
// held or refused. Nothing here judges whether an operation is right.
//
// `operationEvents` only translates, for any consolidation pass that lets a
// model record add, supersede, retire or propose, and drops with a reason what
// it cannot translate. `reviewOperations` is the weekly review's reading of it:
// it also drops what the review may not ask and holds the rest as proposals,
// since this pass only asks. Its own tool never offers an add, so a review sees
// one only from a model that ignored the schema, and drops it.

/** What turning a model's operations into entry events needs: message ids, kinds, clock and ids. */
interface OperationContext {
  /** Message alias (m1, m2, …) to message id: only a message the model was shown can be cited. */
  idOf: Map<string, string>
  now: string
  /** A new entry's id. */
  newId: () => string
  /** An explicit proposal's id. */
  proposalId: () => string
  /** The validator's kinds: an entry is hard only where its kind may be. */
  kinds: Record<string, KindRule>
}

/** What reading the review's answer needs: the ids it was shown, what it compared and what was dismissed. */
interface ReviewContext {
  idOf: Map<string, string>
  now: string
  newId: (prefix: 'entry' | 'proposal') => string
  kinds: Record<string, KindRule>
  /** The entries the review compared: the only ones it may propose to change. */
  compared: Set<string>
  /** What the subject already said no to: never asked again. */
  dismissed: Dismissed[]
  policy: PassPolicy
}

type Fields = Record<string, unknown>
type Translated = { event: EntryEvent } | { dropped: string }

const REPEATS = 'repeats a proposal the subject dismissed'
const OUTSIDE = 'the review only proposes changes to the entries it compared'
const ASKED = 'the weekly review asks the subject'

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

// Hard only where the kind may be: a hard entry of another kind would be
// refused outright and lost, with no question asked.
function mayBeHard(kind: string, kinds: OperationContext['kinds']): boolean {
  return Object.hasOwn(kinds, kind) && kinds[kind].mayBeHard
}

function draft(op: Fields, by: Assertion, ctx: OperationContext): EntryDraft {
  const until = str(op.until)
  const review = str(op.review)
  const kind = String(op.kind ?? '')
  return {
    id: ctx.newId(), kind, text: String(op.text ?? ''), severity: op.severity === 'hard' && mayBeHard(kind, ctx.kinds) ? 'hard' : 'soft',
    ...(until ? { until } : {}), ...(review ? { review } : {}), ...by,
  }
}

function proposable(name: unknown, op: Fields, by: Assertion, ctx: OperationContext): ProposableOp {
  switch (name) {
    case 'add': return { type: 'EntryAdded', at: ctx.now, entry: draft(op, by, ctx) }
    case 'supersede': return { type: 'EntrySuperseded', at: ctx.now, supersedes: String(op.target ?? ''), entry: draft(op, by, ctx) }
    default: return { type: 'EntryRetired', at: ctx.now, id: String(op.target ?? ''), reason: String(op.reason ?? ''), ...by }
  }
}

function translate(raw: unknown, ctx: OperationContext): Translated {
  const op = (raw && typeof raw === 'object' ? raw : {}) as Fields
  const name = op.op === 'propose' ? op.proposes : op.op
  if (!['add', 'supersede', 'retire'].includes(String(name))) return { dropped: 'not an operation' }
  const cited = ctx.idOf.get(String(op.cites ?? ''))
  if (!cited) return { dropped: `${String(op.op)}: cites no message in the transcript` }
  const inner = proposable(name, op, assertionFor('consolidation', { kind: 'message', id: cited }), ctx)
  if (op.op !== 'propose') return { event: inner }
  return { event: { type: 'EntryProposed', at: ctx.now, id: ctx.proposalId(), reason: String(op.reason ?? ''), op: inner } }
}

const NOT_A_TOOL_INPUT = 'the answer is not a tool input with an operations list'

/**
 * A tool input's `operations`, as entry events in the model's order — a
 * propose held as a proposal, anything else as recorded — and why any were
 * dropped. Null or undefined, no call made, yields nothing; any other answer
 * without an `operations` list is dropped whole, so it never reads as a clean review.
 */
function operationEvents(input: unknown, ctx: OperationContext): { events: EntryEvent[]; dropped: string[] } {
  if (input === null || input === undefined) return { events: [], dropped: [] }
  const list = (input as { operations?: unknown }).operations
  if (!Array.isArray(list)) return { events: [], dropped: [NOT_A_TOOL_INPUT] }
  const events: EntryEvent[] = []
  const dropped: string[] = []
  for (const raw of list) {
    const out = translate(raw, ctx)
    if ('event' in out) events.push(out.event)
    else dropped.push(out.dropped)
  }
  return { events, dropped }
}

/** The entry an operation ends or changes; none for an add. */
function changedBy(event: EntryEvent): string | undefined {
  const op = event.type === 'EntryProposed' ? event.op : event
  return op.type === 'EntryRetired' ? op.id : op.type === 'EntrySuperseded' ? op.supersedes : undefined
}

// Whatever the prompt achieved, only a change to an entry it compared is a
// contradiction (an add is recurrence, the daily pass's), and what the subject
// already dismissed is not asked again.
function screen(event: EntryEvent, ctx: ReviewContext): string | null {
  if (!ctx.compared.has(changedBy(event) ?? '')) return OUTSIDE
  return repeatsDismissed(event, ctx.dismissed, ctx.policy.review.repeatShare, ctx.policy.stopwords) ? REPEATS : null
}

function asked(event: EntryEvent, ctx: ReviewContext): EntryEvent {
  if (!isProposable(event)) return event
  return { type: 'EntryProposed', at: ctx.now, id: ctx.newId('proposal'), reason: ASKED, op: event }
}

/**
 * The tool input the review's model recorded, as proposals in its order, and
 * why any were dropped: untranslatable, outside the compared pairs, or a repeat
 * of what the subject dismissed.
 */
function reviewOperations(input: unknown, ctx: ReviewContext): { events: EntryEvent[]; dropped: string[] } {
  const translated = operationEvents(input, { ...ctx, newId: () => ctx.newId('entry'), proposalId: () => ctx.newId('proposal') })
  const reasons = translated.events.map((e) => screen(e, ctx))
  return {
    events: translated.events.filter((_, i) => reasons[i] === null).map((e) => asked(e, ctx)),
    dropped: [...translated.dropped, ...reasons.filter((r): r is string => r !== null)],
  }
}

export { operationEvents, reviewOperations }
export type { OperationContext, ReviewContext }
