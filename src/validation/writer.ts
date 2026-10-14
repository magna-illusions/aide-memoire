import { carriesEntry, isProposable } from '../log/events.ts'
import type { Assertion, Entry, EntryEvent, EntryOperation, Origin, Party, Source, Writer } from '../log/types.ts'

// Who wrote an operation is the host's to say, never the event's. An event is
// text a model or a page may have shaped; the host knows which code path called
// it — a click in its UI, the model's tool call, a background pass, a script. So
// the host names the writer on every call, and the validator derives from it
// whose claim the operation is and how its text arrived. An event that declares
// otherwise is refused, so the disagreement is seen rather than smoothed over.
//
// What each writer may do is the writer table in docs/design.md ("The writer
// model"); the rules themselves are `permission` and `holdReason` below.

const STAMP: Record<Writer, { assertedBy: Party; origin: Origin }> = {
  'subject-action': { assertedBy: 'subject', origin: 'action' },
  agent: { assertedBy: 'agent', origin: 'conversation' },
  consolidation: { assertedBy: 'agent', origin: 'consolidation' },
  operator: { assertedBy: 'operator', origin: 'operator' },
  migration: { assertedBy: 'operator', origin: 'migration' },
  ingest: { assertedBy: 'host', origin: 'ingest' },
}

/** Who is writing, as the host knows it from its own code path. */
interface WriterContext {
  writer: Writer
  /** The text came from outside the conversation; stamped by the host per input source. */
  external?: boolean
  /** One consolidation pass, as the host names it. */
  runId?: string
  /** Which agent or job is writing, as the host names it: `forensics-agent`, `nightly-tidy`. Any writer may name one. */
  actor?: string
}

/** The assertion a writer's operation carries. Hosts build operations with it. */
function assertionFor(writer: Writer, source: Source, external = false): Assertion {
  const { assertedBy, origin } = STAMP[writer]
  return { source, assertedBy, origin: external ? 'external' : origin, writer }
}

/** The assertion an event carries: on its entry, on the operation it holds, or on itself. */
function assertionOf(event: EntryEvent): Assertion {
  if (event.type === 'EntryProposed') return assertionOf(event.op)
  return carriesEntry(event) ? event.entry : event
}

// What an operation left out of its assertion, filled in from the writer: the
// stamp it would get anyway. What it did state is kept, for writerMismatch to
// hold it to. Read before the shape is checked, so it touches only objects.
function filledIn(submitted: EntryOperation, ctx: WriterContext & { now: string }): EntryOperation {
  const op = submitted as unknown
  if (typeof op !== 'object' || op === null) return submitted
  const by = { ...op, at: (op as { at?: unknown }).at ?? ctx.now } as Record<string, unknown>
  if (by.type === 'EntryProposed') return { ...by, op: filledIn(by.op as EntryOperation, ctx) } as EntryOperation
  if (by.type === 'EntryAdded' || by.type === 'EntrySuperseded') return { ...by, entry: withStamp(by.entry, ctx) } as EntryOperation
  return withStamp(by, ctx) as EntryOperation
}

function withStamp(by: unknown, ctx: WriterContext): unknown {
  if (typeof by !== 'object' || by === null) return by
  const { assertedBy, origin } = STAMP[ctx.writer]
  const declared = by as Partial<Assertion>
  return { ...by, assertedBy: declared.assertedBy ?? assertedBy, origin: declared.origin ?? (ctx.external ? 'external' : origin) }
}

function runKey(writer: Writer, runId: string): string {
  return `${writer}:${runId}`
}

// Where the event and the host disagree, named by field. A field the event left
// out is not a disagreement: the stamp fills it.
function writerMismatch(event: EntryEvent, ctx: WriterContext): string | null {
  const declared = assertionOf(event)
  const expected = assertionFor(ctx.writer, declared.source, ctx.external)
  for (const field of ['assertedBy', 'origin', 'writer'] as const) {
    if (declared[field] !== undefined && declared[field] !== expected[field]) return `writer mismatch: ${field}`
  }
  for (const field of ['runId', 'actor'] as const) {
    if (declared[field] !== undefined && declared[field] !== ctx[field]) return `writer mismatch: ${field}`
  }
  return null
}

function stamp<T extends Assertion>(assertion: T, ctx: WriterContext): T {
  const { assertedBy, origin, writer } = assertionFor(ctx.writer, assertion.source, ctx.external)
  return { ...assertion, assertedBy, origin, writer, ...(ctx.runId ? { runId: ctx.runId } : {}), ...(ctx.actor ? { actor: ctx.actor } : {}) }
}

/** The event as it will be stored: its assertion stamped with the host's writer. */
function stamped<T extends EntryEvent>(event: T, ctx: WriterContext): T {
  if (event.type === 'EntryProposed') return { ...event, op: stamped(event.op, ctx) }
  if (carriesEntry(event)) return { ...event, entry: stamp(event.entry, ctx) }
  // Every other operation carries its assertion on itself.
  return stamp(event as T & Assertion, ctx)
}

const SETTLES = new Set(['EntryConfirmed', 'EntryDismissed'])

// An add from the old store, applied or held as a question. A proposal changes
// nothing rendered until the subject settles it, so asking is harmless; settling,
// retiring and forgetting stay out of a one-time import's reach.
function migratedAdd(event: EntryEvent): boolean {
  const add = event.type === 'EntryProposed' ? event.op : event
  return add.type === 'EntryAdded' && add.entry.source.kind === 'migration'
}

/** Why this writer may not submit this kind of operation at all, or null. */
function permission(event: EntryEvent, ctx: WriterContext): string | null {
  const settles = SETTLES.has(event.type)
  if (ctx.external && (settles || event.type === 'EntryRedacted')) return 'external text never settles or forgets'
  const cites = assertionOf(event).source.kind
  if ((settles || event.type === 'EntryRedacted') && cites === 'record') return 'a record never settles or forgets'
  if (cites === 'entries' && ctx.writer !== 'consolidation') return 'only a consolidation pass cites the entries it reconciles'
  switch (ctx.writer) {
    case 'migration':
      return migratedAdd(event) ? null : 'migration only adds, or proposes an add, citing a migration'
    case 'consolidation':
      if (!ctx.runId) return 'a consolidation run needs a runId'
      return settles || event.type === 'EntryRedacted' ? 'consolidation never settles or forgets' : null
    case 'agent':
      return settles && 'target' in event && event.target === 'entry' ? 'only a subject action settles a live entry' : null
    case 'ingest':
      if (settles || event.type === 'EntryRedacted') return 'ingest never settles or forgets'
      if (event.type === 'EntryProposed') return 'ingest never proposes: what it writes applies or is held'
      return cites === 'record' ? null : 'ingest cites only a host record'
    default:
      return null
  }
}

// What the subject said or confirmed is theirs, and so are their words the agent
// relayed (verified against their message, and read as theirs). A record is
// checked for its owner and time, never for what it says, so evidence that ends
// or rewrites their words unasked could be any record at all.
const THEIRS = 'changing what the subject said or confirmed is held for the subject'

function isTheirs(target: Entry | undefined): boolean {
  return target !== undefined && (target.assertedBy === 'subject' || target.confirmedAt !== undefined || target.relayed === true)
}

// Ingest manages its own entries (an alert opens one, its resolution closes it).
// What the subject said or confirmed is theirs, and a hard entry anyone else
// wrote is a decision: evidence ends neither unasked.
function ingestHold(target: Entry | undefined): string | null {
  if (isTheirs(target)) return THEIRS
  return target?.severity === 'hard' && target.assertedBy !== 'host' ? 'changing a hard entry is held for the subject' : null
}

/**
 * Why a well-formed operation is held for the subject instead of applied, or
 * null. `fromRecord` is the rule of the kind it writes or ends: only `'soft'`
 * lets the agent or a pass apply on a record, and then only what is soft.
 */
function holdReason(event: EntryEvent, target: Entry | undefined, ctx: WriterContext, fromRecord?: 'hold' | 'soft'): string | null {
  if (!isProposable(event)) return null
  if (ctx.external) return 'external text is held for the subject'
  if (ctx.writer === 'ingest') return ingestHold(target)
  if (ctx.writer !== 'agent' && ctx.writer !== 'consolidation') return null
  if (assertionOf(event).source.kind === 'record') {
    if (fromRecord !== 'soft') return 'what rests on a host record is held for the subject'
    if (isTheirs(target)) return THEIRS
  }
  if (event.type !== 'EntryRetired' && event.entry.severity === 'hard') return 'a hard entry the agent inferred is held for the subject'
  return target?.severity === 'hard' ? 'changing a hard entry is held for the subject' : null
}

export { assertionFor, assertionOf, filledIn, runKey, writerMismatch, stamped, permission, holdReason }
export type { WriterContext }
