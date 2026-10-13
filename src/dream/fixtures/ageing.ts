import type { EntryProposed, LogEvent } from '../../log/types.ts'
import { add, byPass, dismiss, entry, every, migrated, retire, said, subject, tapped, type DreamFixture } from './fixture.ts'

// "Ageing hard entries": not mentioned for N weeks while the subject goes on
// being active → a check-in. Never auto-closed.
//
// Four restrictions from July, and the subject has been active every few days since.
// - Peanuts have not come up for six weeks: one check-in, held as a question
//   ("Is this over?"), and not asked again while it waits.
// - Shellfish came up a fortnight ago: it is still part of the conversation.
// - Lactose was asked about three weeks ago and the subject said it still
//   holds: the cooldown keeps it from being asked again so soon.
// - The seating rule passed its review date: Review Due already raises it, so a
//   check-in would ask the same thing twice.
const askedAboutLactose: EntryProposed = {
  type: 'EntryProposed', at: '2026-09-20T03:00:00Z', id: 'p_old', reason: 'changing a hard entry is held for the subject',
  op: retire('2026-09-20', 'lactose', 'not mentioned for 6 weeks while activity goes on', byPass('dream-2026-09-20')),
}

const history: LogEvent[] = [
  add('2026-07-01', entry('peanut', 'limit', 'Peanuts: never satay sauce', said('july'), { severity: 'hard' }), '19:00'),
  add('2026-07-01', entry('shellfish', 'limit', 'Shellfish: no prawns', said('july'), { severity: 'hard' }), '19:00'),
  add('2026-07-01', entry('lactose', 'limit', 'Lactose: no cream sauces', said('july'), { severity: 'hard' }), '19:00'),
  add('2026-07-02', entry('aisle', 'rule', 'Flights: aisle seats only', said('aisle'), { severity: 'hard', review: '2026-10-01' }), '19:00'),
  askedAboutLactose,
  dismiss('2026-09-21', 'proposal', 'p_old', tapped),
]

const messages = [
  subject('july', '2026-07-01', 'Peanuts mean never satay sauce, shellfish rules out prawns, and lactose means no cream sauces', '18:00'),
  subject('aisle', '2026-07-02', 'Aisle seats only on flights please', '18:00'),
  subject('shellfish-again', '2026-09-27', 'Shellfish acted up a little after the paella'),
]

const ageingRestriction: DreamFixture = {
  name: 'a restriction not mentioned for six weeks while activity goes on is asked about, once',
  history,
  messages,
  activityDays: every(3, '2026-08-20', '2026-10-10'),
  today: '2026-10-11',
  expect: [{ job: 'check-in', about: 'peanut', verdict: 'propose' }],
  asks: ['peanut'],
  quietNextDay: true,
}

// The same log, and the subject has barely been active: silence about peanuts
// says nothing about them, so nothing is asked.
const ageingWithoutActivity: DreamFixture = {
  name: 'a restriction is not asked about while the subject is not active',
  history,
  messages,
  activityDays: ['2026-09-02', '2026-10-09'],
  today: '2026-10-11',
  expect: [],
}

// The same log, carried over by a migration ten days ago: the old store never
// asked, so the six weeks are counted from the day the log took over — not from
// the line's own date, which would raise every migrated restriction on the
// first morning.
const ageingJustMigrated: DreamFixture = {
  name: 'a migrated restriction is not asked about until six weeks after the migration',
  history: [...history, migrated('2026-10-01')],
  messages,
  activityDays: every(3, '2026-08-20', '2026-10-10'),
  today: '2026-10-11',
  expect: [],
}

export { ageingRestriction, ageingWithoutActivity, ageingJustMigrated }
