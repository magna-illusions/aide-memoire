import type { EntryState, Message } from '../log/types.ts'
import type { KindRule } from '../validation/validate.ts'
import { addDays, calendarDay, periodOf } from './days.ts'
import { dismissedSince, type Dismissed } from './dismissed.ts'
import { contradictionPairs, pairedState, speakingOf, type Pair } from './pairs.ts'
import { questionRoom } from './plan.ts'
import { reviewOperations } from './review-operations.ts'
import { reviewPrompt, type ReviewInput, type ReviewPrompt, type ReviewWording } from './review-prompt.ts'
import { DREAM_MARKER } from './run.ts'
import type { DreamPolicy, DreamWrite, DreamWriteOutcome } from './types.ts'

// The periodic model review, weekly by default (`review.everyDays`):
// contradictions only — copies and things said again are the daily pass's,
// without a model. At most one call per subject a period,
// and none for one with no room for a question, no pair of entries that could
// contradict, or no message of theirs that speaks of one. Every operation it
// records is held as a question, so a weaker judgement costs a dismissed
// question, not memory.
//
// Paid for at most once a period: the run is named by its period's first day,
// and its marker is written before the call (claimWeek), whatever the answer
// turns out to be. A changed `everyDays` takes effect at once: today's period is
// renamed (7 to 30 on 2026-10-13 makes it 2026-10-08), the names already stored
// are left as they are, and the renamed period can cost one extra review.

/** What `dreamWeekly` is given: the host's reads, writer, ids, policy, model call, day and clock. */
interface ReviewDeps {
  loadEntries: (owner: string) => Promise<EntryState>
  /** The subject's own messages since an ISO time. */
  loadMessages: (owner: string, since: string) => Promise<Message[]>
  /**
   * Whether the stream already holds the run this dedupe key names. Optional: it
   * only skips the reads early, since claiming the period dedupes on the key anyway.
   */
  runRecorded?: (owner: string, dedupeKey: string) => Promise<boolean>
  /**
   * The host's model call: sends the prompt with its own client and model, and
   * answers with the input of the tool call the model made, or null when it made
   * none. Whatever it throws propagates, after the period is claimed, so a failed
   * call loses that period's review. Enforce your own timeout: one that never
   * settles holds `dreamWeekly` open with it.
   */
  ask: (prompt: ReviewPrompt, owner: string) => Promise<unknown>
  write: (owner: string, write: DreamWrite) => Promise<DreamWriteOutcome>
  newId: (prefix: 'entry' | 'proposal') => string
  policy: DreamPolicy
  /** The validator's kinds: the tool offers these, and an entry is hard only where its kind may be. */
  kinds: Record<string, KindRule>
  wording: ReviewWording
  /** The subject's calendar day, YYYY-MM-DD. */
  today: string
  now: () => string
}

/** What a review did: why it made no call, or what the validator held and refused and what was dropped. */
interface ReviewSummary {
  runId: string
  /** Why no call was made. `'done this week'` means done this period, whatever its length. */
  skipped?: 'done this week' | 'no room' | 'no pairs' | 'no messages'
  /** The model was called and recorded no operations. */
  noCall?: boolean
  proposed: number
  rejected: string[]
  dropped: string[]
}

// The messages forgotten entries were recorded from. The review never reads
// them, so it cannot learn again from the subject's words what they asked
// memory to forget.
function forgottenSources(state: EntryState): Set<string> {
  return new Set(state.entries.flatMap((e) => (e.redacted && e.source.kind === 'message' ? [e.source.id] : [])))
}

type Ready = { skipped: NonNullable<ReviewSummary['skipped']> } | { state: EntryState; said: Message[]; pairs: Pair[] }

// Whether a call could ask anything: every check here is free.
async function readyForReview(owner: string, dedupeKey: string, deps: ReviewDeps): Promise<Ready> {
  if (await deps.runRecorded?.(owner, dedupeKey)) return { skipped: 'done this week' }
  const state = await deps.loadEntries(owner)
  if (questionRoom(state, deps.policy) === 0) return { skipped: 'no room' }
  const pairs = contradictionPairs(state, deps.today, deps.policy)
  if (pairs.length === 0) return { skipped: 'no pairs' }
  const loaded = await deps.loadMessages(owner, `${addDays(deps.today, -deps.policy.review.lookbackDays)}T00:00:00.000Z`)
  const forgotten = forgottenSources(state)
  const said = speakingOf(loaded.filter((m) => !forgotten.has(m.id)), pairs, deps.policy)
  return said.length === 0 ? { skipped: 'no messages' } : { state, said, pairs }
}

// The period is claimed before it is paid for: the marker goes in first, deduped
// on the period, so a second sweep, a restart, or a call that fails after it was
// billed never pays again this period.
async function claimWeek(owner: string, runId: string, dedupeKey: string, deps: ReviewDeps): Promise<boolean> {
  const marker = { type: DREAM_MARKER, payload: { runId, pass: 'model' } }
  const out = await deps.write(owner, { writer: 'consolidation', runId, now: deps.now(), messages: [], ops: [], dedupeKey, marker })
  return !out.duplicate
}

// What the call is shown: the pairs, their entries and the open questions about
// them, the messages that speak of them, and what the subject declined about them.
function reviewInput(
  ready: Extract<Ready, { pairs: Pair[] }>, messages: ReviewInput['messages'], dismissed: Dismissed[], deps: ReviewDeps,
): ReviewInput {
  const ids = new Set(ready.pairs.flat().map((e) => e.id))
  return {
    today: deps.today, messages, entries: pairedState(ready.state, ready.pairs), maxOps: deps.policy.maxOpsPerRun,
    everyDays: deps.policy.review.everyDays,
    pairs: ready.pairs.map(([a, b]) => [a.id, b.id]),
    dismissed: dismissed.filter((d) => d.target !== undefined && ids.has(d.target)),
  }
}

/** One subject's review for the period `deps.today` falls in: the ISO week, unless `review.everyDays` says otherwise. */
async function dreamWeekly(owner: string, deps: ReviewDeps): Promise<ReviewSummary> {
  const runId = `dream-model-${periodOf(calendarDay(deps.today), deps.policy.review.everyDays ?? 7)}`
  const dedupeKey = `dream:${runId}`
  const none = { runId, proposed: 0, rejected: [], dropped: [] }
  const ready = await readyForReview(owner, dedupeKey, deps)
  if ('skipped' in ready) return { ...none, skipped: ready.skipped }
  if (!(await claimWeek(owner, runId, dedupeKey, deps))) return { ...none, skipped: 'done this week' }

  const aliased = ready.said.map((m, i) => ({ alias: `m${i + 1}`, at: m.at, text: m.text, id: m.id }))
  const dismissed = dismissedSince(ready.state, addDays(deps.today, -deps.policy.review.dismissedDays))
  const answer = await deps.ask(reviewPrompt(reviewInput(ready, aliased, dismissed, deps), deps.wording, Object.keys(deps.kinds)), owner)
  const now = deps.now()
  const { events, dropped } = reviewOperations(answer ?? null, {
    idOf: new Map(aliased.map((m) => [m.alias, m.id])), now, newId: deps.newId, kinds: deps.kinds,
    compared: new Set(ready.pairs.flat().map((e) => e.id)), dismissed, policy: deps.policy,
  })
  const ops = events.slice(0, Math.min(deps.policy.maxOpsPerRun, questionRoom(ready.state, deps.policy)))
  const write: DreamWrite = { writer: 'consolidation', runId, now, messages: ready.said, ops, base: ready.state }
  const outcome = ops.length === 0 ? { verdicts: [] } : await deps.write(owner, write)
  return {
    runId, noCall: answer === null || answer === undefined, dropped,
    proposed: outcome.verdicts.filter((v) => v.verdict !== 'reject').length,
    rejected: outcome.verdicts.flatMap((v) => (v.verdict === 'reject' ? [v.reason] : [])),
  }
}

export { dreamWeekly }
export type { ReviewDeps, ReviewSummary }
