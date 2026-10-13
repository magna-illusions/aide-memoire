import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries } from '../log/fold.ts'
import type { LogEvent } from '../log/types.ts'
import { dreamPlan } from './plan.ts'
import { valueOf } from './reality.ts'
import type { DreamInput, DreamPolicy, RecordValue } from './types.ts'
import { add, entry, inSession, observed, POLICY, said, subject } from './fixtures/fixture.ts'
import { counter } from './fixtures/host.ts'

// A record the pass may cite stands in for a report the subject never wrote. It
// is the host's choice, and it must never crowd out what the subject did say.

const LOGGED: RecordValue = { label: 'spanish', value: 40, day: '2026-10-06', id: 'log-1', at: '2026-10-06T08:00:00Z' }

const history: LogEvent[] = [
  add('2026-08-01', entry('spanish', 'level', 'Spanish practice about 20 minutes a day', said('aug')), '19:00'),
  add('2026-09-15', entry('calls', 'note', 'Gets a headache after long video calls', observed('m0')), '19:00'),
]

// What the subject said three times over three sessions: a recurrence question.
const messages = [
  inSession('s1', subject('m1', '2026-09-20', 'Long video calls gave me a headache again')),
  inSession('s2', subject('m2', '2026-09-27', 'Headache after long video calls today')),
  inSession('s3', subject('m3', '2026-10-04', 'Long video calls again and a headache after')),
]

function plan(policy: DreamPolicy) {
  const input: DreamInput = {
    state: foldEntries(history), messages, activityDays: [], records: [LOGGED], today: '2026-10-07',
    now: '2026-10-07T03:00:00Z', runId: 'dream-2026-10-07', newId: counter(), policy,
  }
  return dreamPlan(input).map((c) => [c.job, c.about])
}

const citing = (on: boolean): DreamPolicy => ({ ...POLICY, reality: { ...POLICY.reality, citeRecords: on } })

describe('a correction resting on a record', () => {
  it('is not built unless the host opts in: without a report from the subject, nothing', () => {
    assert.deepEqual(plan(POLICY), [['recurrence', 'calls']])
    assert.deepEqual(plan(citing(false)), [['recurrence', 'calls']])
  })

  it('is built when the host opts in', () => {
    assert.deepEqual(plan(citing(true)), [['recurrence', 'calls'], ['reality', 'spanish']])
  })

  // A host whose writer cannot check the record sees it refused, which leaves no
  // proposal and no cooldown: it comes back every day. Last in line, it only
  // ever takes a slot nothing else wanted.
  it('takes a slot only after every question the subject gave grounds for', () => {
    assert.deepEqual(plan({ ...citing(true), maxOpsPerRun: 1 }), [['recurrence', 'calls']])
  })
})

describe('valueOf', () => {
  it('reads the one value written in the unit', () => {
    assert.equal(valueOf('about 20 minutes a day', 'minutes'), 20)
    assert.equal(valueOf('p95 around 300 ms', 'ms'), 300)
    assert.equal(valueOf('cpu at 72,5 % on a normal day', '%'), 72.5)
  })

  it('reads the unit as a whole word, as a word boundary does', () => {
    assert.equal(valueOf('about 20 minutesish', 'minutes'), null)
    assert.equal(valueOf('about 20 minutes_total', 'minutes'), null)
    assert.equal(valueOf('about 20 minutes.', 'minutes'), 20)
  })

  it('reads nothing from a range, two values or another unit', () => {
    assert.equal(valueOf('20 minutes or 30 minutes', 'minutes'), null)
    assert.equal(valueOf('about 20 hours', 'minutes'), null)
  })

  it('refuses an empty unit: every number would be a value', () => {
    assert.throws(() => valueOf('about 20 a day', ''), { name: 'TypeError', message: /reality\.unit/ })
  })
})
