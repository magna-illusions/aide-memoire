import { assertionOf, runKey } from '../validation/writer.ts'
import { cleanEvent, draftOf, shapeProblem } from './shape.ts'
import type { Entry, EntryConfirmed, EntryDismissed, EntryDraft, EntryEvent, EntryProposed, EntryState, LogEvent, Proposal, Status } from './types.ts'

// The entry set is a pure fold of the log, so it can be rebuilt from the events
// at any time and two readers of the same log always see the same set.
//
// The fold is lenient where the validator is strict: an operation on an id it
// has never seen, an add under an id it already holds, or an event type it does
// not know changes nothing. The validator keeps those out of new writes; the
// fold must still replay an old log, or a hand-repaired one, without throwing.

/** The state of a log with nothing in it: the seed of every fold. */
const emptyState: EntryState = { entries: [], proposals: [], runs: {} }

/** The entry with this id, in any status, or undefined. */
function findEntry(state: EntryState, id: string): Entry | undefined {
  return state.entries.find((entry) => entry.id === id)
}

/** The entries in force: status `live`. */
function liveEntries(state: EntryState): Entry[] {
  return state.entries.filter((entry) => entry.status === 'live')
}

/** The proposal with this id, in any status, or undefined. */
function findProposal(state: EntryState, id: string): Proposal | undefined {
  return state.proposals.find((proposal) => proposal.id === id)
}

/** The proposals still waiting to be settled. */
function openProposals(state: EntryState): Proposal[] {
  return state.proposals.filter((proposal) => proposal.status === 'open')
}

function update(state: EntryState, id: string, change: (entry: Entry) => Entry): EntryState {
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? change(entry) : entry)) }
}

function insert(state: EntryState, draft: EntryDraft, at: string, status: Status, supersedes?: string): EntryState {
  if (findEntry(state, draft.id)) {
    return state
  }
  // Built from the draft's own fields; what the fold owns it sets here.
  const entry: Entry = { ...draftOf(draft), status, at, redacted: false, ...(supersedes ? { supersedes } : {}) }
  return { ...state, entries: [...state.entries, entry] }
}

function retire(state: EntryState, id: string, reason: string, supersededBy?: string): EntryState {
  return update(state, id, (entry) => ({ ...entry, status: 'retired', retiredReason: reason, ...(supersededBy ? { supersededBy } : {}) }))
}

function supersede(state: EntryState, oldId: string, draft: EntryDraft, at: string): EntryState {
  if (!findEntry(state, oldId)) {
    return state
  }
  return retire(insert(state, draft, at, 'live', oldId), oldId, 'superseded', draft.id)
}

// A proposal is recorded, never applied. A proposed add or supersede also shows
// as an entry with status `proposed` (what it would replace stays live); a
// proposed retire touches nothing until the subject applies it.
function propose(state: EntryState, event: EntryProposed): EntryState {
  const { op } = event
  const target = op.type === 'EntryAdded' ? null : op.type === 'EntrySuperseded' ? op.supersedes : op.id
  if (findProposal(state, event.id) || (target && !findEntry(state, target))) {
    return state
  }
  const recorded = { ...state, proposals: [...state.proposals, { id: event.id, at: event.at, reason: event.reason, op, status: 'open' as const }] }
  return op.type === 'EntryRetired' ? recorded : insert(recorded, op.entry, event.at, 'proposed', target ?? undefined)
}

function close(state: EntryState, id: string, status: Proposal['status']): EntryState {
  return { ...state, proposals: state.proposals.map((p) => (p.id === id ? { ...p, status } : p)) }
}

// "Confirmed" is the subject's own word on an entry, and nobody else's: an entry
// the agent applied goes live and reads by its real provenance — relayed or
// observed — never as confirmed.
function confirmedBy(event: EntryConfirmed): { confirmedAt?: string } {
  return event.assertedBy === 'subject' ? { confirmedAt: event.at } : {}
}

// "Do it": the held operation happens now.
function apply(state: EntryState, proposal: Proposal, event: EntryConfirmed): EntryState {
  const closed = close(state, proposal.id, 'applied')
  const { op } = proposal
  if (op.type === 'EntryRetired') {
    return retire(closed, op.id, op.reason)
  }
  const live = update(closed, op.entry.id, (entry) => ({ ...entry, status: 'live', ...confirmedBy(event) }))
  return op.type === 'EntrySuperseded' ? retire(live, op.supersedes, 'superseded', op.entry.id) : live
}

// The subject said "no": the proposal goes, and so does the entry it would have
// added. Anything it named as a target stays exactly as it was.
function discard(state: EntryState, proposal: Proposal): EntryState {
  const closed = close(state, proposal.id, 'discarded')
  return proposal.op.type === 'EntryRetired' ? closed : retire(closed, proposal.op.entry.id, 'dismissed')
}

function isProposedEntry(state: EntryState, id: string): boolean {
  const entry = findEntry(state, id)
  return entry?.status === 'proposed' && !entry.redacted
}

/**
 * Whether applying the proposal would still do what it proposed: the entry it
 * would add is still waiting, and whatever it would replace or close is still live.
 */
function isApplicable(state: EntryState, proposal: Proposal): boolean {
  const { op } = proposal
  if (op.type === 'EntryRetired') return findEntry(state, op.id)?.status === 'live'
  if (op.type === 'EntrySuperseded' && findEntry(state, op.supersedes)?.status !== 'live') return false
  return isProposedEntry(state, op.entry.id)
}

function settle(state: EntryState, event: EntryConfirmed | EntryDismissed): EntryState {
  const confirm = event.type === 'EntryConfirmed'
  if (event.target === 'proposal') {
    const proposal = findProposal(state, event.id)
    if (proposal?.status !== 'open') return state
    if (!confirm) return discard(state, proposal)
    return isApplicable(state, proposal) ? apply(state, proposal, event) : state
  }
  if (findEntry(state, event.id)?.status !== 'live') {
    return state
  }
  return confirm ? update(state, event.id, (e) => ({ ...e, ...confirmedBy(event) })) : retire(state, event.id, 'dismissed')
}

// The copy of an entry's words a proposal holds goes with the entry, and a
// proposal for an entry that is forgotten can never be applied.
// What replaces a free-text reason that may restate forgotten words: the agent
// writes reasons, and a reason is as able to say the thing as the entry was.
const REDACTED = '[redacted]'

function forgetInProposals(state: EntryState, id: string): EntryState {
  const proposals = state.proposals.map((p): Proposal => {
    if (p.op.type === 'EntryRetired') {
      return p.op.id === id ? { ...p, reason: REDACTED, op: { ...p.op, reason: REDACTED } } : p
    }
    // A settled rewording of the forgotten entry keeps its own words (only open
    // rewordings are wiped, by `rewordings`), but its reason talked about this one.
    if (p.op.type === 'EntrySuperseded' && p.op.supersedes === id && p.op.entry.id !== id) {
      return { ...p, reason: REDACTED }
    }
    if (p.op.entry.id !== id) return p
    const status = p.status === 'open' ? 'discarded' : p.status
    return { ...p, status, reason: REDACTED, op: { ...p.op, entry: { ...p.op.entry, text: '' } } }
  })
  return { ...state, proposals }
}

// The open proposals that would reword this entry: their text restates it.
function rewordings(state: EntryState, id: string): string[] {
  return openProposals(state).flatMap((p) => (p.op.type === 'EntrySuperseded' && p.op.supersedes === id ? [p.op.entry.id] : []))
}

// Forgetting an entry forgets every wording of the same fact, and nothing else:
// - the wording it replaced, but only through an APPLIED supersede (the
//   predecessor names it as `supersededBy`). A proposal's target is someone
//   else's entry, so redacting a proposed rewording never reaches the live entry.
// - the open proposals that would reword it.
// redact.ts takes the set this leaves redacted and wipes it from the stored log.
// Each wording it reaches records when (`at`, the redact's), for whoever must say
// "forgotten on" without the words.
function redact(state: EntryState, id: string, at: string): EntryState {
  const entry = findEntry(state, id)
  if (!entry || entry.redacted) {
    return state
  }
  const forgotten = forgetInProposals(update(retire(state, id, 'redacted'), id, (e) => ({ ...e, text: '', redacted: true, redactedAt: at })), id)
  const withRewordings = rewordings(forgotten, id).reduce((s, rewording) => redact(s, rewording, at), forgotten)
  const predecessor = entry.supersedes ? findEntry(withRewordings, entry.supersedes) : undefined
  return predecessor?.supersededBy === id ? redact(withRewordings, predecessor.id, at) : withRewordings
}

// A consolidation run's cap holds across calls because the count lives in the
// state, keyed by the writer and run the validator stamped, not by the call.
function countRun(state: EntryState, event: EntryEvent): EntryState {
  const { writer, runId } = assertionOf(event)
  if (!writer || !runId) return state
  const key = runKey(writer, runId)
  return { ...state, runs: { ...state.runs, [key]: (state.runs[key] ?? 0) + 1 } }
}

// Total: an event the fold cannot read is skipped, never thrown on (shape.ts).
// The host's migration marker changes no entry; the first one says when.
/** One step of the fold: the state after `event`. Skips, unchanged, what it cannot apply. */
function applyEntryEvent(state: EntryState, event: LogEvent): EntryState {
  if (event?.type === 'MigrationApplied') {
    return state.migratedAt || typeof event.at !== 'string' ? state : { ...state, migratedAt: event.at }
  }
  if (shapeProblem(event)) return state
  const clean = cleanEvent(event)
  return countRun(applyOperation(state, clean), clean)
}

function applyOperation(state: EntryState, event: EntryEvent): EntryState {
  switch (event.type) {
    case 'EntryAdded': return insert(state, event.entry, event.at, 'live')
    case 'EntrySuperseded': return supersede(state, event.supersedes, event.entry, event.at)
    case 'EntryRetired': return retire(state, event.id, event.reason)
    case 'EntryConfirmed':
    case 'EntryDismissed': return settle(state, event)
    case 'EntryProposed': return propose(state, event)
    case 'EntryRedacted': return redact(state, event.id, event.at)
    default: return state
  }
}

/** The state a log folds to, from `from` (default `emptyState`). Deterministic; never throws. */
function foldEntries(events: LogEvent[], from: EntryState = emptyState): EntryState {
  return events.reduce(applyEntryEvent, from)
}

export { applyEntryEvent, foldEntries, findEntry, liveEntries, findProposal, openProposals, isApplicable, emptyState, redact, REDACTED }
