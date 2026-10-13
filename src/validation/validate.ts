import { applyEntryEvent, findEntry, findProposal, isApplicable, liveEntries } from '../log/fold.ts'
import { overRawCap, sharesStems, textProblem } from '../text.ts'
import { sameFactAs } from '../log/names.ts'
import { carriesEntry, isProposable } from '../log/events.ts'
import { citationProblem, evidenceOf, type CitationRule } from './source.ts'
import { cleanEvent, shapeProblem } from '../log/shape.ts'
import { filledIn, holdReason, permission, runKey, stamped, writerMismatch, type WriterContext } from './writer.ts'
import { atNow, markRelayed, normalised, recordTimed, softened } from './stamp.ts'
import type {
  Assertion, EntriesSource, Entry, EntryConfirmed, EntryDismissed, EntryDraft, EntryEvent, EntryOperation, EntryProposed, EntryRedacted, EntryState,
  HostRecord, Message, ProposableOp, Proposal, Writer,
} from '../log/types.ts'

// Every operation is checked on its own before it is appended, against the set
// as it stands. One operation at a time is the point: a gate that diffs a whole
// rewrite has to guess what changed, and the guesses are where memory was lost.
//
// Three answers. `accept` appends the operation. `reject` appends nothing and
// says why, in a fixed short phrase that is safe to log — never the entry's
// text, which is the text there is reason to distrust. `propose` appends the
// operation held back as an EntryProposed, for the subject to settle.
//
// The host says who is writing (writer.ts) and passes the stream owner's
// messages; the validator reads, it never fetches. Every operation it lets
// through comes back stamped with its writer and its text normalised.

/** What an entry of one kind may be: hard or not, protected from a pass, and what may rest on a record. */
interface KindRule {
  /** Whether an entry of this kind may be an explicit restriction. */
  mayBeHard: boolean
  /**
   * A consolidation pass may only propose to retire or replace an entry of this
   * kind, soft or hard: the host's word for what a background pass must never end
   * on its own.
   */
  protected?: boolean
  /**
   * What the agent or a consolidation pass may do on a host record of this kind.
   * `'hold'` (the default): everything resting on a record is held. `'soft'`: a
   * soft operation on a record applies, if the record is newer than what it
   * ends. A hard one is held either way — the validator never reads what a
   * record says, so a hard write on one could pin any record to any conclusion.
   */
  fromRecord?: 'hold' | 'soft'
}

/** What the validator holds every operation to: the kinds, the text rules and the caps. */
interface ValidationPolicy {
  /** Every kind the host knows. An entry of any other kind is refused. */
  kinds: Record<string, KindRule>
  maxTextLength: number
  /** Words too common to show that a message says what an entry claims. */
  stopwords: Set<string>
  /** Host refusals on the (normalised) text — directive patterns, foreign documents. Each names a reason or returns null. */
  textRules: ((text: string) => string | null)[]
  caps: {
    /** Soft adds stop here; a hard entry is never refused for space. */
    liveEntries: number
    /** How many entries one source message, or one host record, may yield, whoever writes them. */
    addsPerMessage: number
    /** How many operations one consolidation run may append, across every call. */
    opsPerRun: number
    /**
     * How many live entries `ingest` may hold in one stream, hard ones included;
     * an add past it is refused until the host retires old ones. Default:
     * `liveEntries`.
     */
    ingestedEntries?: number
  }
}

/** What every call passes: the policy, the writer, the clock and what citations are checked against. */
interface ValidationContext extends WriterContext {
  policy: ValidationPolicy
  /** The stream owner's messages, and only theirs. */
  messages: Message[]
  /** The stream owner, as the host names them. A cited record must be theirs; without it no record checks out. */
  owner?: string
  /**
   * Looks up a host record by id: the host's own data, as it vouches for it. The
   * validator reads, it never fetches; without a lookup no record checks out.
   */
  records?: (id: string) => HostRecord | undefined
  /** Names a proposal the validator holds: the host's id generator, so the validator stays pure. */
  proposalId: (op: ProposableOp) => string
  /**
   * The host's clock, as an ISO timestamp. Every operation the validator lets
   * through is stamped with it, and the event's own `at` is overwritten: time,
   * like the writer, is the host's to say. Overwriting rather than refusing a
   * skew means there is no tolerance to tune, and every "newer than" compares
   * times the host stamped.
   */
  now: string
}

/** The validator's answer: what to append, or why nothing is. */
type Verdict =
  | { verdict: 'accept'; event: EntryEvent }
  | { verdict: 'reject'; reason: string }
  | { verdict: 'propose'; reason: string; event: EntryProposed }

const DATE = /^\d{4}-\d{2}-\d{2}$/
// A generator that keeps answering with ids already in use is a host bug; asking
// forever would hide it, and dropping the proposal would lose the operation.
const PROPOSAL_ID_TRIES = 3

// An own property only: "constructor" or "__proto__" is not a kind the host listed.
function ruleOf(kind: string, ctx: ValidationContext): KindRule | undefined {
  return Object.hasOwn(ctx.policy.kinds, kind) ? ctx.policy.kinds[kind] : undefined
}

function draftProblem(state: EntryState, draft: EntryDraft, ctx: ValidationContext): string | null {
  const rule = ruleOf(draft.kind, ctx)
  if (!rule) return 'unknown kind'
  if (draft.severity === 'hard' && !rule.mayBeHard) return `a ${draft.kind} entry may not be hard`
  if (findEntry(state, draft.id) || findProposal(state, draft.id)) return 'id already in use'
  if ([draft.until, draft.review].some((date) => date !== undefined && !DATE.test(date))) return 'until or review is not a date'
  const textual = textProblem(draft.text, ctx.policy.maxTextLength)
  if (textual) return textual
  for (const textRule of ctx.policy.textRules) {
    const reason = textRule(draft.text)
    if (reason) return reason
  }
  return null
}

function capProblem(state: EntryState, draft: EntryDraft, adding: boolean, caps: ValidationPolicy['caps']): string | null {
  const { source } = draft
  if (source.kind === 'message' || source.kind === 'record') {
    const fromSameSource = state.entries.filter((e) => e.source.kind === source.kind && e.source.id === source.id)
    if (fromSameSource.length >= caps.addsPerMessage) return `over ${caps.addsPerMessage} entries per ${source.kind}`
  }
  if (adding && draft.severity === 'soft' && liveEntries(state).length >= caps.liveEntries) {
    return 'live-entry budget is full'
  }
  return null
}

// Hard entries always render, so what ingest keeps live is capped, hard ones
// included, or a burst of alerts would fill the prompt with no limit at all.
// The default is the host's own `liveEntries`: it already says how many entries
// one stream's prompt can carry, and machine evidence alone may not exceed it.
// A supersede replaces one live entry with another, so only an add counts.
function ingestCapProblem(state: EntryState, adding: boolean, ctx: ValidationContext): string | null {
  if (!adding || ctx.writer !== 'ingest') return null
  const cap = ctx.policy.caps.ingestedEntries ?? ctx.policy.caps.liveEntries
  const live = liveEntries(state).filter((entry) => entry.assertedBy === 'host').length
  return live >= cap ? `over ${cap} live ingested entries` : null
}

function liveTarget(state: EntryState, id: string): Entry | undefined {
  const entry = findEntry(state, id)
  return entry?.status === 'live' ? entry : undefined
}

// An agent or a consolidation pass speaks from what the subject said, so it
// cites the subject's message and that message says what it records. External
// text is held whatever it cites, so it needs no such proof.
function inferred(ctx: ValidationContext): boolean {
  return (ctx.writer === 'agent' || ctx.writer === 'consolidation') && !ctx.external
}

function cite(by: Assertion, rule: CitationRule, ctx: ValidationContext): string | null {
  return citationProblem(by, ctx.writer, rule, evidenceOf(ctx))
}

// The two entries a pass reconciles stand in for a message: both live in this
// stream, of one kind and about the same thing (a shared word, by stem, not by
// fragment), the operation ends or replaces one of them, and new words it writes
// draw on both. Read from the log itself, so nothing outside it is trusted.
function reconcileProblem(
  state: EntryState, source: EntriesSource, target: Entry | undefined, draft: EntryDraft | undefined, ctx: ValidationContext,
): string | null {
  const [a, b] = source.ids.map((id) => liveTarget(state, id))
  if (source.ids[0] === source.ids[1]) return 'reconciles two distinct entries'
  if (!a || !b) return 'a reconciled entry is not live in this stream'
  if (!target || !source.ids.includes(target.id)) return 'the operation targets neither reconciled entry'
  if (a.kind !== b.kind) return 'reconciled entries are not the same kind'
  const { stopwords } = ctx.policy
  if (!sharesStems(a.text, b.text, stopwords)) return 'reconciled entries are not about the same thing'
  const drawsOnBoth = !draft || [a, b].every((entry) => sharesStems(entry.text, draft.text, stopwords))
  return drawsOnBoth ? null : 'the new words do not reconcile these entries'
}

// What an operation rests on, checked: a reconciled pair against the log, any
// other citation under `rule`. The assertion is the new entry's, if it writes one.
function groundsProblem(
  state: EntryState, by: Assertion | EntryDraft, target: Entry | undefined, rule: CitationRule, ctx: ValidationContext,
): string | null {
  if (by.source.kind !== 'entries') return cite(by, rule, ctx)
  return reconcileProblem(state, by.source, target, 'text' in by ? by : undefined, ctx)
}

// An add (no target) or the new entry of a supersede (the entry it replaces).
function claimProblem(state: EntryState, draft: EntryDraft, target: Entry | undefined, ctx: ValidationContext): string | null {
  return draftProblem(state, draft, ctx)
    ?? groundsProblem(state, draft, target, inferred(ctx) ? { required: true, about: draft.text } : {}, ctx)
    ?? capProblem(state, draft, !target, ctx.policy.caps)
    ?? ingestCapProblem(state, !target, ctx)
}

// Replacing a hard entry ends it as surely as retiring it, so it is judged the
// same way: on a message newer than the entry that speaks of the entry. Checked
// against the new words instead, any message that echoes the replacement — "it
// went fine" — would end a restriction it never mentioned.
function supersedeProblem(state: EntryState, target: Entry, draft: EntryDraft, ctx: ValidationContext): string | null {
  if (target.severity !== 'hard') return claimProblem(state, draft, target, ctx) ?? cite(draft, retireRule(target, draft, ctx), ctx)
  return draftProblem(state, draft, ctx)
    ?? groundsProblem(state, draft, target, { ...retireRule(target, draft, ctx), required: inferred(ctx) }, ctx)
    ?? capProblem(state, draft, false, ctx.policy.caps)
}

// Where a record is allowed to change what is live without anyone settling it —
// ingest, or the agent or a pass on a kind that takes records softly — its time
// is all that grounds the change (what it says is never read), so it must be
// newer than what it answers. That is the entry, or, where ingest wrote the
// entry from a record, that record: an alert that fired at 10:00 and was
// ingested at 10:05 is answered by its resolution at 10:03. Anyone else's entry
// is answered from when they wrote it, whatever it cites, so an alert older
// than a person's word cannot end it.
function retireRule(target: Entry, by: Assertion, ctx: ValidationContext): CitationRule {
  const rule = closeRule(target, ctx)
  const unsettled = ctx.writer === 'ingest' || appliesOnRecord(target.kind, ctx)
  if (by.source.kind !== 'record' || !unsettled) return rule
  const { source } = target
  return { ...rule, after: target.assertedBy === 'host' && source.kind === 'record' ? source.at : target.at }
}

// The agent or a pass, on a kind that takes records softly.
function appliesOnRecord(kind: string, ctx: ValidationContext): boolean {
  return inferred(ctx) && ruleOf(kind, ctx)?.fromRecord === 'soft'
}

// Closing an entry: the agent shows the subject said so. A hard entry is closed
// only on a message newer than it that speaks of it, whoever cites one. A
// consolidation pass ending or replacing a soft entry needs the same of the
// message it cites — newer, and about the entry it ends, not about anything else
// ("the session went fine" ends nothing). A protected entry it only proposes to
// change (protectedHold), so there the citation is not what decides.
function closeRule(target: Entry, ctx: ValidationContext): CitationRule {
  const required = ctx.writer === 'agent' && !ctx.external
  if (target.severity === 'hard') return { required, after: target.at, about: target.text }
  if (required) return { required, about: target.text }
  return consolidating(ctx) && !isProtected(target, ctx) ? { required: true, after: target.at, about: target.text } : {}
}

function consolidating(ctx: ValidationContext): boolean {
  return ctx.writer === 'consolidation' && !ctx.external
}

function isProtected(entry: Entry, ctx: ValidationContext): boolean {
  return ruleOf(entry.kind, ctx)?.protected === true
}

// A consolidation pass, or ingest, never ends or rewrites a protected entry: it is held.
function protectedHold(event: EntryEvent, target: Entry | undefined, ctx: ValidationContext): string | null {
  const changes = event.type === 'EntryRetired' || event.type === 'EntrySuperseded'
  if (!changes || !target || !isProtected(target, ctx)) return null
  if (ctx.writer === 'consolidation') return 'a consolidation pass only proposes changes to a protected entry'
  return ctx.writer === 'ingest' ? 'changing a protected entry from ingest is held for the subject' : null
}

// What a confirm or dismiss answers, when it was asked, and what it is about.
function settleTarget(state: EntryState, event: EntryConfirmed | EntryDismissed): { problem: string } | { at: string; about: string } {
  if (event.target === 'entry') {
    const entry = liveTarget(state, event.id)
    return entry ? { at: entry.at, about: entry.text } : { problem: 'no such live entry' }
  }
  const proposal = findProposal(state, event.id)
  if (proposal?.status !== 'open') return { problem: 'no such open proposal' }
  if (event.type === 'EntryConfirmed' && !isApplicable(state, proposal)) return { problem: 'the proposal no longer applies' }
  return { at: proposal.at, about: proposalText(state, proposal) }
}

function proposalText(state: EntryState, proposal: Proposal): string {
  return proposal.op.type === 'EntryRetired' ? findEntry(state, proposal.op.id)?.text ?? '' : proposal.op.entry.text
}

// A proposal is hard when applying it would create, change or close a hard entry.
function isHardProposal(state: EntryState, proposal: Proposal): boolean {
  const { op } = proposal
  if (op.type !== 'EntryRetired' && op.entry.severity === 'hard') return true
  const target = op.type === 'EntryAdded' ? undefined : findEntry(state, op.type === 'EntryRetired' ? op.id : op.supersedes)
  return target?.severity === 'hard'
}

// External text is held because nobody in the conversation wrote it; letting the
// agent settle it on a chat message would let the same page steer both halves.
function isExternalProposal(proposal: Proposal): boolean {
  const { op } = proposal
  return (op.type === 'EntryRetired' ? op.origin : op.entry.origin) === 'external'
}

// Hard, and external, are the subject's to decide, by an action the host ties to
// the proposal — the memory page, or an answer chip carrying its id. Free text
// never settles them: whatever a message says, the agent only relays it, and what
// it relays can be steered. (An operator's script may still, as for everything.)
const DECIDES_HARD: Writer[] = ['subject-action', 'operator']

function needsSubjectAction(state: EntryState, proposal: Proposal): boolean {
  return isHardProposal(state, proposal) || isExternalProposal(proposal)
}

// The agent settles a soft proposal only on the subject's answer to it: a message
// newer than the proposal that speaks of the entry. Anyone citing a message
// cites one newer than what it settles.
function settleProblem(state: EntryState, event: EntryConfirmed | EntryDismissed, ctx: ValidationContext): string | null {
  const target = settleTarget(state, event)
  if ('problem' in target) return target.problem
  const proposal = event.target === 'proposal' ? findProposal(state, event.id) : undefined
  if (proposal && needsSubjectAction(state, proposal) && !DECIDES_HARD.includes(ctx.writer)) {
    return 'a hard or external proposal is settled only by a subject action'
  }
  const agent = ctx.writer === 'agent'
  return cite(event, { required: agent, after: target.at, about: agent ? target.about : undefined }, ctx)
}

function redactProblem(state: EntryState, event: EntryRedacted, ctx: ValidationContext): string | null {
  const entry = findEntry(state, event.id)
  if (!entry || entry.redacted) return 'no such entry to redact'
  if (ctx.writer !== 'agent') return cite(event, { after: entry.at }, ctx)
  if (entry.severity === 'hard') return 'a hard entry is forgotten only by a subject action or an operator'
  return cite(event, { required: true, after: entry.at, about: entry.text }, ctx)
}

// A follow-up is the fact it follows under another name (log/names.ts): once
// either is forgotten, neither comes back under the other's name, whatever its words.
function followsForgotten(state: EntryState, draft: EntryDraft): string | null {
  return sameFactAs(draft.id).some((id) => findEntry(state, id)?.redacted === true) ? 'the entry it follows was forgotten' : null
}

// A reason is free text, often a model's, stored and read back to a model: it
// meets an entry's text rules. A proposal may give none; a retire must.
function reasonProblem(reason: string, ctx: ValidationContext): string | null {
  const problem = textProblem(reason, ctx.policy.maxTextLength)
  return problem ? `reason refused: ${problem}` : null
}

// Why an operation must not be appended at all, or null.
function rejection(state: EntryState, event: EntryEvent, ctx: ValidationContext): string | null {
  switch (event.type) {
    case 'EntryAdded':
      return followsForgotten(state, event.entry) ?? claimProblem(state, event.entry, undefined, ctx)
    case 'EntrySuperseded': {
      const target = liveTarget(state, event.supersedes)
      if (!target) return 'supersedes no live entry'
      if (target.kind !== event.entry.kind) return 'a supersede keeps the same kind'
      return supersedeProblem(state, target, event.entry, ctx)
    }
    case 'EntryRetired': {
      const target = liveTarget(state, event.id)
      if (!target) return 'retires no live entry'
      if (!event.reason.trim()) return 'a retire needs a reason'
      return reasonProblem(event.reason, ctx) ?? groundsProblem(state, event, target, retireRule(target, event, ctx), ctx)
    }
    case 'EntryConfirmed':
    case 'EntryDismissed':
      return settleProblem(state, event, ctx)
    case 'EntryRedacted':
      return redactProblem(state, event, ctx)
    case 'EntryProposed':
      if (findProposal(state, event.id) || findEntry(state, event.id)) return 'proposal id already in use'
      return (event.reason === '' ? null : reasonProblem(event.reason, ctx)) ?? rejection(state, event.op, ctx)
    default:
      return 'unknown operation'
  }
}

// Far over the cap, an entry's text is refused before it is normalised (text.ts).
function oversizedText(event: EntryEvent, ctx: ValidationContext): string | null {
  const op = event.type === 'EntryProposed' ? event.op : event
  if (!carriesEntry(op)) return null
  return overRawCap(op.entry.text, ctx.policy.maxTextLength) ? `over the ${ctx.policy.maxTextLength}-character cap` : null
}

function nameProposal(state: EntryState, op: ProposableOp, ctx: ValidationContext): string | null {
  for (let tries = 0; tries < PROPOSAL_ID_TRIES; tries += 1) {
    const id = ctx.proposalId(op)
    if (!findProposal(state, id) && !findEntry(state, id)) return id
  }
  return null
}

function hold(state: EntryState, op: ProposableOp, reason: string, ctx: ValidationContext): Verdict {
  const id = nameProposal(state, op, ctx)
  if (!id) return { verdict: 'reject', reason: 'no free proposal id' }
  return { verdict: 'propose', reason, event: { type: 'EntryProposed', at: op.at, id, reason, op: softened(op, ctx) } }
}

function runProblem(state: EntryState, ctx: ValidationContext): string | null {
  if (ctx.writer !== 'consolidation' || !ctx.runId) return null
  const done = state.runs[runKey(ctx.writer, ctx.runId)] ?? 0
  return done >= ctx.policy.caps.opsPerRun ? `over ${ctx.policy.caps.opsPerRun} operations in one consolidation run` : null
}

function targetOf(state: EntryState, event: EntryEvent): Entry | undefined {
  if (event.type === 'EntryRetired') return findEntry(state, event.id)
  return event.type === 'EntrySuperseded' ? findEntry(state, event.supersedes) : undefined
}

// The record rule of the kind an operation writes, or of the entry it retires.
function fromRecordOf(event: EntryEvent, target: Entry | undefined, ctx: ValidationContext): KindRule['fromRecord'] {
  const kind = event.type === 'EntryRetired' ? target?.kind : 'entry' in event ? event.entry.kind : undefined
  return kind === undefined ? undefined : ruleOf(kind, ctx)?.fromRecord
}

/** One operation checked against the state: `accept`, `reject` with a reason safe to log, or `propose`. Pure; never throws. */
function validate(state: EntryState, operation: EntryOperation, ctx: ValidationContext): Verdict {
  // Shape first: nothing below reads an event that is not one, so validate never throws.
  const submitted = filledIn(operation, ctx) as EntryEvent
  const refused = shapeProblem(submitted) ?? oversizedText(submitted, ctx) ?? writerMismatch(submitted, ctx)
    ?? permission(submitted, ctx) ?? runProblem(state, ctx)
  if (refused) return { verdict: 'reject', reason: refused }
  const checked = atNow(stamped(normalised(cleanEvent(submitted)), ctx), ctx.now)
  const problem = rejection(state, checked, ctx)
  if (problem) return { verdict: 'reject', reason: problem }
  const timed = recordTimed(checked, ctx)
  if (timed.type === 'EntryProposed') {
    return { verdict: 'accept', event: { ...timed, op: softened(markRelayed(timed.op, ctx), ctx) } }
  }
  const event = markRelayed(timed, ctx)
  const target = targetOf(state, event)
  const reason = holdReason(event, target, ctx, fromRecordOf(event, target, ctx)) ?? protectedHold(event, target, ctx)
  if (!reason || !isProposable(event)) {
    return { verdict: 'accept', event }
  }
  return hold(state, event, reason, ctx)
}

/**
 * The operations one writer submits together — a turn, a consolidation pass —
 * each checked against the set as the ones before it left it.
 */
function validateRun(state: EntryState, events: EntryOperation[], ctx: ValidationContext): { verdicts: Verdict[]; state: EntryState } {
  const verdicts: Verdict[] = []
  let current = state
  for (const event of events) {
    const verdict = validate(current, event, ctx)
    if (verdict.verdict !== 'reject') current = applyEntryEvent(current, verdict.event)
    verdicts.push(verdict)
  }
  return { verdicts, state: current }
}

export { validate, validateRun }
export type { ValidationPolicy, ValidationContext, Verdict, KindRule }
