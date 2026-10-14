import type {
  Assertion, EntryDraft, EntryEvent, EntryProposed, ProposableOp, Source,
} from './types.ts'

// An event is rebuilt from the fields its operation means, and nothing else
// survives. The payload is data someone else shaped, and the fold sets every
// field it owns — status, confirmedAt, supersedes, supersededBy, retiredReason,
// redacted — from its own events. A field copied through by spreading the
// payload is a field anyone can set: a declared `confirmedAt` ranked an entry as
// the subject's, a declared supersede link was followed by a redact. The fold
// and the validator both read events through `cleanEvent`.

// The shape every event must have before anything reads it. The validator
// refuses a malformed event with the reason this names; the fold skips one, so
// an event that got stored somehow — a hand repair, an older writer, a bug — can
// never make a stream unreadable. Each check names the first thing wrong.
type Shape = Record<string, unknown>

const REFERENCE_KINDS = ['message', 'action', 'session', 'migration', 'correction']
const PARTIES = ['subject', 'agent', 'operator', 'host']
const ORIGINS = ['conversation', 'action', 'consolidation', 'migration', 'operator', 'external', 'ingest']
const WRITERS = ['subject-action', 'agent', 'consolidation', 'operator', 'migration', 'ingest']
const PROPOSABLE = ['EntryAdded', 'EntrySuperseded', 'EntryRetired']

const isShape = (value: unknown): value is Shape => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isOneOf = (value: unknown, allowed: string[]): boolean => isText(value) && allowed.includes(value)
const isOptional = (value: unknown, check: (v: unknown) => boolean): boolean => value === undefined || check(value)

function isSource(source: unknown): boolean {
  if (!isShape(source)) return false
  if (source.kind === 'record') return isText(source.id) && isText(source.at)
  if (source.kind === 'entries') return Array.isArray(source.ids) && source.ids.length === 2 && source.ids.every(isText)
  return isOneOf(source.kind, REFERENCE_KINDS) && isText(source.id)
}

function assertionProblem(by: Shape): string | null {
  if (!isSource(by.source)) return 'malformed source'
  if (!isOneOf(by.assertedBy, PARTIES) || !isOneOf(by.origin, ORIGINS)) return 'malformed assertion'
  if (!isOptional(by.writer, (w) => isOneOf(w, WRITERS)) || !isOptional(by.runId, isText)) return 'malformed assertion'
  if (!isOptional(by.actor, isText)) return 'malformed assertion'
  return null
}

function draftProblem(draft: unknown): string | null {
  if (!isShape(draft)) return 'malformed entry'
  if (![draft.id, draft.kind, draft.text].every(isText)) return 'malformed entry'
  if (!isOneOf(draft.severity, ['hard', 'soft'])) return 'severity is neither hard nor soft'
  if (!isOptional(draft.until, isText) || !isOptional(draft.review, isText)) return 'malformed entry'
  if (!isOptional(draft.relayed, (r) => typeof r === 'boolean')) return 'malformed entry'
  return assertionProblem(draft)
}

/** What is malformed about this event, or null when every field an operation needs is there and typed. */
function shapeProblem(event: unknown): string | null {
  if (!isShape(event) || !isText(event.type) || !isText(event.at)) return 'malformed operation'
  switch (event.type) {
    case 'EntryAdded':
      return draftProblem(event.entry)
    case 'EntrySuperseded':
      return isText(event.supersedes) ? draftProblem(event.entry) : 'malformed operation'
    case 'EntryRetired':
      return isText(event.id) && isText(event.reason) ? assertionProblem(event) : 'malformed operation'
    case 'EntryConfirmed':
    case 'EntryDismissed':
      if (!isOneOf(event.target, ['entry', 'proposal'])) return 'a settle answers an entry or a proposal'
      return isText(event.id) ? assertionProblem(event) : 'malformed operation'
    case 'EntryRedacted':
      return isText(event.id) ? assertionProblem(event) : 'malformed operation'
    case 'MigrationApplied':
      return 'a host marker is not an operation'
    case 'EntryProposed':
      if (!isText(event.id) || !isText(event.reason) || !isShape(event.op)) return 'malformed operation'
      if (!isOneOf(event.op.type, PROPOSABLE)) return 'only an add, a supersede or a retire can be proposed'
      return shapeProblem(event.op)
    default:
      return 'unknown operation'
  }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function sourceOf(source: Source): Source {
  switch (source.kind) {
    case 'record': return { kind: source.kind, id: source.id, at: source.at }
    case 'entries': return { kind: source.kind, ids: [source.ids[0], source.ids[1]] }
    default: return { kind: source.kind, id: source.id }
  }
}

function assertionOf(by: Assertion): Assertion {
  return withoutUndefined({
    source: sourceOf(by.source), assertedBy: by.assertedBy, origin: by.origin, writer: by.writer, runId: by.runId, actor: by.actor,
  })
}

function draftOf(draft: EntryDraft): EntryDraft {
  return withoutUndefined({
    id: draft.id, kind: draft.kind, text: draft.text, severity: draft.severity,
    until: draft.until, review: draft.review, relayed: draft.relayed, ...assertionOf(draft),
  })
}

function opOf(op: ProposableOp): ProposableOp {
  if (op.type === 'EntryAdded') return { type: op.type, at: op.at, entry: draftOf(op.entry) }
  if (op.type === 'EntrySuperseded') return { type: op.type, at: op.at, supersedes: op.supersedes, entry: draftOf(op.entry) }
  return { type: op.type, at: op.at, id: op.id, reason: op.reason, ...assertionOf(op) }
}

/** The event with only the fields its operation means. */
function cleanEvent(event: EntryEvent): EntryEvent {
  switch (event.type) {
    case 'EntryAdded':
    case 'EntrySuperseded':
    case 'EntryRetired':
      return opOf(event)
    case 'EntryConfirmed':
    case 'EntryDismissed':
      return { type: event.type, at: event.at, target: event.target, id: event.id, ...assertionOf(event) }
    case 'EntryRedacted':
      return { type: event.type, at: event.at, id: event.id, ...assertionOf(event) }
    case 'EntryProposed': {
      const proposed: EntryProposed = { type: event.type, at: event.at, id: event.id, reason: event.reason, op: opOf(event.op) }
      return proposed
    }
    default:
      return event
  }
}

export { cleanEvent, draftOf, shapeProblem, WRITERS }
