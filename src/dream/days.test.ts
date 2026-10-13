import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, calendarDay, periodOf } from './days.ts'

// How weekly runs were named before periods: the Monday of the ISO week. Kept
// here as the reference the default period must match, day for day.
function weekOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

// A periodic run is named by the first day of its period. Weekly names are
// stored in every log the review has written, so the default period must name
// every day exactly as the week did.

describe('addDays', () => {
  it('adds across a month and a year', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01')
    assert.equal(addDays('2027-01-01', -1), '2026-12-31')
    assert.equal(addDays('2026-10-07', 0), '2026-10-07')
  })
})

describe('periodOf', () => {
  it('names a week by its Monday', () => {
    assert.equal(periodOf('2026-10-05', 7), '2026-10-05') // Monday
    assert.equal(periodOf('2026-10-07', 7), '2026-10-05') // Wednesday
    assert.equal(periodOf('2026-10-11', 7), '2026-10-05') // Sunday
    assert.equal(periodOf('2026-10-12', 7), '2026-10-12')
  })

  it('names every day as weekOf does, at the default of seven days', () => {
    for (let day = '1960-01-01'; day < '2070-01-01'; day = addDays(day, 1)) {
      assert.equal(periodOf(day, 7), weekOf(day), day)
    }
  })

  it('counts other periods from the same Monday', () => {
    assert.deepEqual(['2026-10-07', '2026-10-11', '2026-10-12'].map((day) => periodOf(day, 14)), ['2026-09-28', '2026-09-28', '2026-10-12'])
    assert.equal(periodOf('2026-10-07', 1), '2026-10-07')
    assert.equal(periodOf('1970-01-04', 3), '1970-01-02')
  })

  it('refuses a period that is not a whole number of days, one or more', () => {
    for (const days of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => periodOf('2026-10-07', days), { name: 'TypeError', message: /review\.everyDays/ }, String(days))
    }
  })
})

describe('calendarDay', () => {
  it('takes a real day as YYYY-MM-DD', () => {
    for (const day of ['2026-10-13', '2028-02-29', '1970-01-01']) assert.equal(calendarDay(day), day)
  })

  it('refuses anything else, a day that does not exist included', () => {
    for (const day of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-10-13T00:00:00Z', '13/10/2026', '', '2026-1-3']) {
      assert.throws(() => calendarDay(day), { name: 'TypeError', message: /today must be a calendar day/ }, day)
    }
  })
})
