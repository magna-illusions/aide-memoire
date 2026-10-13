import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries } from '../log/fold.ts'
import type { Message } from '../log/types.ts'
import { followUps } from './time-sync.ts'
import { POLICY, add, entry, said } from './fixtures/fixture.ts'

// `until` and `today` are the subject's calendar days, so whether they spoke of
// an event "on or after its day" is read on their calendar too: from the day a
// message's time says, in the offset it was written with. A subject at UTC-8
// who writes the evening before is still before the day, though it is already
// the day in UTC; one at UTC+10 who writes that morning is on the day, though
// UTC still has the day before.

const exam = add('2026-09-01', entry('exam', 'plan', 'Sitting the pilot licence exam', said('plan'), { until: '2026-10-10' }))
const plan: Message = { id: 'plan', role: 'subject', text: 'I sit the pilot licence exam on October 10', at: '2026-09-01T18:00:00-08:00' }

function followedUp(...messages: Message[]): boolean {
  let n = 0
  const candidates = followUps({
    state: foldEntries([exam]), messages: [plan, ...messages], activityDays: [], records: null, today: '2026-10-12',
    now: '2026-10-12T03:00:00Z', runId: 'dream-2026-10-12', newId: () => `d${++n}`, policy: POLICY,
  })
  return candidates.length > 0
}

const at = (id: string, time: string, text = 'The pilot licence exam is on my mind'): Message => ({ id, role: 'subject', text, at: time })

describe('a follow-up, on the subject\'s calendar', () => {
  it('is still due after a message from the evening before, written at UTC-8', () => {
    assert.equal(followedUp(at('eve', '2026-10-09T20:00:00-08:00')), true)
  })

  it('is not due after a message on the day itself, written at UTC-8, late enough to be the next day in UTC', () => {
    assert.equal(followedUp(at('night', '2026-10-10T19:00:00-08:00', 'The pilot licence exam went well')), false)
  })

  it('is not due after a message that morning, written at UTC+10, while UTC still has the day before', () => {
    assert.equal(followedUp(at('morning', '2026-10-10T07:00:00+10:00', 'The pilot licence exam went well')), false)
  })

  it('is still due after the agent, not the subject, speaks of the event on its day', () => {
    assert.equal(followedUp({ ...at('agent-day', '2026-10-10T19:00:00-08:00', 'How did the pilot licence exam go?'), role: 'agent' }), true)
  })

  it('reads a time in UTC as a UTC day, as before', () => {
    assert.equal(followedUp(at('utc-eve', '2026-10-09T22:00:00Z')), true)
    assert.equal(followedUp(at('utc-day', '2026-10-10T01:00:00Z', 'The pilot licence exam went well')), false)
  })
})
