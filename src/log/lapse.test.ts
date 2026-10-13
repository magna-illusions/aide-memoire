import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isCheckInDue, isLapsed, isReviewDue } from './lapse.ts'
import type { Entry } from './types.ts'

const entry = (extra: Partial<Entry>): Entry => ({
  id: 'e1', kind: 'fact', text: 't', severity: 'soft', status: 'live', at: '2026-10-01T09:00:00Z', redacted: false,
  source: { kind: 'message', id: 'm1' }, assertedBy: 'subject', origin: 'conversation', ...extra,
})

describe('isLapsed — a soft entry past its until leaves the rendering, by date alone', () => {
  // `until` is the last day the entry holds, so it lapses the morning after.
  const cases: [string, Partial<Entry>, string, boolean][] = [
    ['soft, no until: never lapses', {}, '2030-01-01', false],
    ['soft, before until', { until: '2026-10-04' }, '2026-10-03', false],
    ['soft, on its until day', { until: '2026-10-04' }, '2026-10-04', false],
    ['soft, the day after until', { until: '2026-10-04' }, '2026-10-05', true],
    ['soft, a full timestamp as now', { until: '2026-10-04' }, '2026-10-05T00:00:01Z', true],
    ['hard, past until: never lapses', { severity: 'hard', until: '2026-10-04' }, '2026-12-01', false],
    ['retired: not live, so not lapsed', { status: 'retired', until: '2026-10-04' }, '2026-12-01', false],
  ]
  for (const [name, extra, now, expected] of cases) {
    it(name, () => assert.equal(isLapsed(entry(extra), now), expected))
  }
})

describe('isReviewDue — a hard entry past its until or review is raised, never dropped', () => {
  const cases: [string, Partial<Entry>, string, boolean][] = [
    ['hard, no dates', { severity: 'hard' }, '2030-01-01', false],
    ['hard, review on the day', { severity: 'hard', review: '2026-10-10' }, '2026-10-10', false],
    ['hard, review passed', { severity: 'hard', review: '2026-10-10' }, '2026-10-11', true],
    ['hard, until passed', { severity: 'hard', until: '2026-10-10' }, '2026-10-11', true],
    ['soft, review passed: soft lapses instead', { review: '2026-10-10', until: '2026-10-10' }, '2026-10-11', false],
    ['hard but retired', { severity: 'hard', status: 'retired', review: '2026-10-10' }, '2026-10-11', false],
    // The subject's own "still true" after the date answers the question it raised.
    ['hard, review passed, confirmed after it', { severity: 'hard', review: '2026-10-10', confirmedAt: '2026-10-11T08:00:00Z' }, '2026-10-12', false],
    ['hard, until passed, confirmed after it', { severity: 'hard', until: '2026-10-10', confirmedAt: '2026-10-11T08:00:00Z' }, '2026-10-12', false],
    ['hard, confirmed on the review day itself: not yet an answer', { severity: 'hard', review: '2026-10-10', confirmedAt: '2026-10-10T08:00:00Z' }, '2026-10-12', true],
    ['hard, confirmed before a later date passed', { severity: 'hard', review: '2026-10-20', confirmedAt: '2026-10-11T08:00:00Z' }, '2026-10-21', true],
  ]
  for (const [name, extra, now, expected] of cases) {
    it(name, () => assert.equal(isReviewDue(entry(extra), now), expected))
  }
})

describe('isCheckInDue — a soft entry past its review is asked about, still rendered, never dropped', () => {
  const cases: [string, Partial<Entry>, string, boolean][] = [
    ['soft, no review', {}, '2030-01-01', false],
    ['soft, review on the day', { review: '2026-10-10' }, '2026-10-10', false],
    ['soft, review passed', { review: '2026-10-10' }, '2026-10-11', true],
    ['soft, review passed but lapsed by until: gone, not asked', { review: '2026-10-10', until: '2026-10-10' }, '2026-10-11', false],
    ['soft, review passed, until still ahead', { review: '2026-10-10', until: '2026-12-01' }, '2026-10-11', true],
    ['hard: Review Due, not a check-in', { severity: 'hard', review: '2026-10-10' }, '2026-10-11', false],
    ['soft but retired', { status: 'retired', review: '2026-10-10' }, '2026-10-11', false],
    ['soft, review passed, confirmed after it', { review: '2026-10-10', confirmedAt: '2026-10-11T08:00:00Z' }, '2026-10-12', false],
  ]
  for (const [name, extra, now, expected] of cases) {
    it(name, () => assert.equal(isCheckInDue(entry(extra), now), expected))
  }
})
