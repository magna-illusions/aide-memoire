import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries, findEntry, openProposals } from '../log/fold.ts'
import { validateRun, type ValidationContext, type ValidationPolicy } from '../validation/validate.ts'
import { assertionFor } from '../validation/writer.ts'
import type { EntryEvent, EntryState, HostRecord } from '../log/types.ts'
import { dreamPlan } from './plan.ts'
import type { DreamInput, DreamPolicy, RecordValue } from './types.ts'
import { counter } from './fixtures/host.ts'

// The same pass over a ledger rather than a conversation: the subject is a
// service, machine evidence comes in as records (alerts), the agent's
// conclusions are claims, and a responsible role — here an operator — settles.
// The service says nothing, so there is no message for a pass to cite.

const OWNER = 'checkout-service'
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'during', 'about', 'around'])

const VALIDATION: ValidationPolicy = {
  kinds: { constraint: { mayBeHard: true, protected: true }, baseline: { mayBeHard: false } },
  maxTextLength: 200, stopwords: STOPWORDS, textRules: [],
  caps: { liveEntries: 50, addsPerMessage: 3, opsPerRun: 20 },
}

const POLICY: DreamPolicy = {
  stopwords: STOPWORDS, addsPerMessage: 3, maxOpsPerRun: 5, maxOpenQuestions: 5, cooldownDays: 30,
  followUp: { kinds: [], windowDays: 7, horizonDays: 3, kind: 'baseline', text: (text, date) => `Passed ${date}: ${text}` },
  checkIn: { quietWeeks: 4, activeWeeks: 2, reason: (weeks) => `no word on it for ${weeks} weeks while deploys go on` },
  protectedKinds: ['constraint'],
  duplicate: { share: 0.8, negations: new Set(['no', 'not', 'never']) },
  recurrence: { kinds: ['baseline'], windowDays: 28, share: 0.6, messages: 3, sessions: 2 },
  review: { lookbackDays: 28, dismissedDays: 90, repeatShare: 0.6 },
  reality: { kind: 'baseline', unit: 'ms', tolerance: 0.2, citeRecords: true, text: (label, value, day) => `${label} at ${value} ms per the alert of ${day}` },
}

const operator = assertionFor('operator', { kind: 'action', id: 'runbook' })
const add = (id: string, kind: string, text: string, severity: 'hard' | 'soft', at: string): EntryEvent =>
  ({ type: 'EntryAdded', at, entry: { id, kind, text, severity, ...operator } })

const history = foldEntries([
  add('freeze', 'constraint', 'No schema migrations during the quarterly payments freeze', 'hard', '2026-08-01T09:00:00Z'),
  add('latency', 'baseline', 'Checkout latency p95 around 300 ms', 'soft', '2026-08-01T09:00:00Z'),
  add('pool-old', 'baseline', 'Connection pool sized at 40', 'soft', '2026-08-01T09:00:00Z'),
  add('pool-new', 'baseline', 'Connection pool sized at 40 connections', 'soft', '2026-09-01T09:00:00Z'),
])

const ALERT: RecordValue = { label: 'checkout latency', value: 900, day: '2026-10-06', id: 'alert-17', at: '2026-10-06T08:00:00Z' }
const deploys = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']

function plan(records: RecordValue[]): ReturnType<typeof dreamPlan> {
  const input: DreamInput = {
    state: history, messages: [], activityDays: deploys, records, today: '2026-10-07', now: '2026-10-07T03:00:00Z',
    runId: 'dream-2026-10-07', newId: counter(), policy: POLICY,
  }
  return dreamPlan(input)
}

function submit(events: EntryEvent[], context: Partial<ValidationContext> = {}) {
  return validateRun(history, events, {
    policy: VALIDATION, messages: [], writer: 'consolidation', runId: 'dream-2026-10-07', now: '2026-10-07T03:00:00Z',
    proposalId: () => 'p_held', ...context,
  })
}

const lookup = (id: string): HostRecord | undefined => (id === ALERT.id ? { id, at: ALERT.at!, owner: OWNER } : undefined)

describe('a ledger subject: a service whose records are alerts', () => {
  it('finds the aged constraint and the value an alert contradicts; the soft copy waits for a message that never comes', () => {
    assert.deepEqual(plan([ALERT]).map((c) => [c.job, c.about]), [['check-in', 'freeze'], ['reality', 'latency']])
  })

  it('holds both as questions: the check-in because the constraint is hard, the correction because it rests on a record', () => {
    const { verdicts, state } = submit(plan([ALERT]).map((c) => c.event), { owner: OWNER, records: lookup })
    assert.deepEqual(verdicts.map((v) => v.verdict), ['propose', 'accept'])
    assert.deepEqual(openProposals(state).map((p) => p.op.type), ['EntryRetired', 'EntrySuperseded'])
    assert.equal(findEntry(state, 'latency')?.status, 'live')
  })

  it('refuses the correction when the host gives no record lookup to check the alert against', () => {
    const { verdicts } = submit(plan([ALERT]).map((c) => c.event))
    assert.deepEqual(verdicts[1], { verdict: 'reject', reason: 'no host records to check the cited record against' })
  })

  it('finds no correction from a record the host gave no id for', () => {
    const { id: _id, at: _at, ...anonymous } = ALERT
    assert.deepEqual(plan([anonymous]).map((c) => c.job), ['check-in'])
  })

  it('lets an operator settle the held correction', () => {
    const { state } = submit(plan([ALERT]).map((c) => c.event), { owner: OWNER, records: lookup })
    const correction = openProposals(state).find((p) => p.op.type === 'EntrySuperseded')!
    const settled: EntryState = validateRun(state, [
      { type: 'EntryConfirmed', at: '', target: 'proposal', id: correction.id, ...assertionFor('operator', { kind: 'action', id: 'on-call' }) },
    ], { policy: VALIDATION, messages: [], writer: 'operator', now: '2026-10-07T09:00:00Z', proposalId: () => 'p_x' }).state
    assert.equal(findEntry(settled, 'latency')?.status, 'retired')
    assert.match(findEntry(settled, findEntry(settled, 'latency')!.supersededBy!)?.text ?? '', /checkout latency at 900 ms/)
  })
})

// A service says nothing, so a follow-up has no message to rest on. A dated event
// the host ingested rests on a record (a change ticket), and where the follow-up
// kind takes records softly (fromRecord), the host can let the pass rest the
// follow-up on that record (followUp.citeRecords). Off by default.
describe('a ledger subject: a follow-up on the record a dated event rests on', () => {
  const TICKET: HostRecord = { id: 'change-88', at: '2026-10-01T08:00:00Z', owner: OWNER }
  const kinds = { ...VALIDATION.kinds, window: { mayBeHard: false }, 'follow-up': { mayBeHard: false, fromRecord: 'soft' as const } }
  const ingested = foldEntries([{
    type: 'EntryAdded', at: '2026-10-01T08:05:00Z',
    entry: { id: 'window', kind: 'window', text: 'Payments database maintenance window', severity: 'soft', until: '2026-10-05',
      ...assertionFor('ingest', { kind: 'record', id: TICKET.id, at: TICKET.at }) },
  }])
  const policy = (citeRecords?: boolean): DreamPolicy => ({ ...POLICY,
    followUp: { ...POLICY.followUp, kinds: ['window'], kind: 'follow-up', ...(citeRecords === undefined ? {} : { citeRecords }) } })
  const planned = (citeRecords?: boolean) => dreamPlan({
    state: ingested, messages: [], activityDays: deploys, records: [], today: '2026-10-07', now: '2026-10-07T03:00:00Z',
    runId: 'dream-2026-10-07', newId: counter(), policy: policy(citeRecords),
  })

  it('finds no follow-up by default, nor when the host leaves it off', () => {
    assert.deepEqual(planned().map((c) => c.job), [])
    assert.deepEqual(planned(false).map((c) => c.job), [])
  })

  it('rests the follow-up on the ticket when the host turns it on, and the validator applies it', () => {
    const events = planned(true).map((c) => c.event)
    assert.deepEqual(events.map((e) => e.type === 'EntryAdded' && e.entry.source), [{ kind: 'record', id: 'change-88', at: TICKET.at }])
    const { verdicts } = validateRun(ingested, events, {
      policy: { ...VALIDATION, kinds }, messages: [], writer: 'consolidation', runId: 'dream-2026-10-07', now: '2026-10-07T03:00:00Z',
      proposalId: () => 'p_held', owner: OWNER, records: (id) => (id === TICKET.id ? TICKET : undefined),
    })
    assert.deepEqual(verdicts.map((v) => v.verdict), ['accept'])
  })
})
