import type { EntryState, Message } from '../log/types.ts'
import type { Verdict } from '../validation/validate.ts'
import { addDays, calendarDay } from './days.ts'
import { dreamPlan } from './plan.ts'
import type { Candidate, DreamPolicy, DreamWrite, DreamWriteOutcome, Job, RecordValue, SubjectMessage } from './types.ts'

// One subject's daily deterministic pass, over injected I/O: load, plan, and
// hand what the jobs found to the host's writer as the `consolidation` writer
// under one run id. The run is named by its day, and its marker (DREAM_MARKER,
// which the fold skips) carries the dedupe key, so a second pass the same day —
// a restart, a second replica — appends nothing. A day that finds nothing
// writes nothing.

/** What `dreamDaily` is given: the host's reads, writer, ids, policy, day and clock. */
interface DreamDeps {
  loadEntries: (owner: string) => Promise<EntryState>
  /** The subject's own messages since an ISO time, each with its session where the host knows it. */
  loadMessages: (owner: string, since: string) => Promise<SubjectMessage[]>
  /** The subject's messages among these ids, whenever they were written. */
  loadCited: (owner: string, ids: string[]) => Promise<Message[]>
  /** Days (YYYY-MM-DD) since `since` on which the subject was active, in the host's sense. */
  loadActivityDays: (owner: string, since: string) => Promise<string[]>
  /** The host's records, where it has a read path to them; null where it has none. */
  loadRecords: ((owner: string) => Promise<RecordValue[]>) | null
  /** The host's writer: validates every operation as `write.writer` and appends what it lets through. */
  write: (owner: string, write: DreamWrite) => Promise<DreamWriteOutcome>
  /** The host's id generator, for the entries and proposals a job builds. */
  newId: (prefix: 'entry' | 'proposal') => string
  policy: DreamPolicy
  /** The subject's calendar day, YYYY-MM-DD. */
  today: string
  now: () => string
}

/** What a daily pass did: what each job found, and what the validator accepted, held or refused. */
interface DreamSummary {
  runId: string
  /** Operations submitted, by the job that found them. */
  found: Partial<Record<Job, number>>
  accepted: number
  proposed: number
  /** Why each refused operation was refused — fixed phrases, never an entry's words. */
  rejected: string[]
  duplicate?: boolean
}

/** The type of the marker event a pass appends first, as its record of itself. The fold skips it. */
const DREAM_MARKER = 'DreamRun'

// The messages a pass may cite: the window's, and the ones live entries were
// recorded from, however old — an event is planned months before its day, and
// a copy is ended on the message its newer wording came from.
async function citableMessages(owner: string, state: EntryState, since: string, deps: DreamDeps): Promise<SubjectMessage[]> {
  const sources = state.entries
    .filter((e) => e.status === 'live' && !e.redacted)
    .flatMap((e) => (e.source.kind === 'message' ? [e.source.id] : []))
  const [recent, cited] = await Promise.all([deps.loadMessages(owner, `${since}T00:00:00.000Z`), deps.loadCited(owner, sources)])
  const seen = new Set(recent.map((m) => m.id))
  return [...recent, ...cited.filter((m) => !seen.has(m.id))]
}

// A proposal a job built itself (reality, recurrence) is accepted as a
// proposal: it asks, like one the validator held, and is counted with those.
const asks = (v: Verdict) => v.verdict === 'accept' && v.event.type === 'EntryProposed'

function summarise(runId: string, candidates: Candidate[], verdicts: Verdict[]): DreamSummary {
  const found: DreamSummary['found'] = {}
  for (const c of candidates) found[c.job] = (found[c.job] ?? 0) + 1
  return {
    runId, found,
    accepted: verdicts.filter((v) => v.verdict === 'accept' && !asks(v)).length,
    proposed: verdicts.filter((v) => v.verdict === 'propose' || asks(v)).length,
    rejected: verdicts.flatMap((v) => (v.verdict === 'reject' ? [v.reason] : [])),
  }
}

/** One subject's pass for `deps.today`: at most one write, and none on a day that finds nothing. */
async function dreamDaily(owner: string, deps: DreamDeps): Promise<DreamSummary> {
  const runId = `dream-${calendarDay(deps.today)}`
  const since = addDays(deps.today, -7 * deps.policy.checkIn.quietWeeks)
  const state = await deps.loadEntries(owner)
  const [messages, activityDays, records] = await Promise.all([
    citableMessages(owner, state, since, deps),
    deps.loadActivityDays(owner, since),
    deps.loadRecords ? deps.loadRecords(owner) : Promise.resolve(null),
  ])
  const now = deps.now()
  const candidates = dreamPlan({ state, messages, activityDays, records, today: deps.today, now, runId, newId: deps.newId, policy: deps.policy })
  if (candidates.length === 0) return summarise(runId, [], [])
  const outcome = await deps.write(owner, {
    writer: 'consolidation', runId, now, messages, ops: candidates.map((c) => c.event), base: state,
    dedupeKey: `dream:${runId}`, marker: { type: DREAM_MARKER, payload: { runId, pass: 'daily', operations: candidates.length } },
  })
  return { ...summarise(runId, candidates, outcome.verdicts), duplicate: outcome.duplicate }
}

export { dreamDaily, DREAM_MARKER }
export type { DreamDeps, DreamSummary }
