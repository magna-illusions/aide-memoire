import type { EntryProposed, LogEvent } from '../../log/types.ts'
import { duplicateReason } from '../names.ts'
import { add, byPass, dismiss, entry, every, redact, retire, said, subject, tapped, type DreamFixture } from './fixture.ts'

// Duplicates, without a model: two live entries of one kind and one severity
// whose words overlap strongly say the same thing. The older is ended in favour
// of the newer — one operation per pair — and the validator decides as for
// every consolidation operation: a soft one is applied, a hard one is held as a
// question.

const meetings = [
  add('2026-08-01', entry('habit-old', 'habit', 'Prefers early meetings to late afternoons', said('aug')), '19:00'),
  add('2026-09-20', entry('habit-new', 'habit', 'Prefers the early meetings to late afternoons on weekdays', said('sep')), '19:00'),
]

const messages = [
  subject('aug', '2026-08-01', 'Early meetings suit me best, I prefer them to late afternoons', '18:00'),
  subject('sep', '2026-09-20', 'Still prefer early meetings to late afternoons, on weekdays at least', '18:00'),
  subject('nut', '2026-07-01', 'Peanuts make me ill, never satay sauce', '18:00'),
  subject('nut-again', '2026-09-20', 'Peanuts: still never satay sauce, and no peanut butter either', '18:00'),
]

const softDuplicate: DreamFixture = {
  name: 'a soft entry said again in other words is ended in favour of the newer, applied',
  history: meetings,
  messages,
  today: '2026-10-07',
  expect: [{ job: 'duplicate', about: 'habit-old', verdict: 'accept' }],
  reads: { includes: ['Prefers the early meetings to late afternoons on weekdays'], excludes: ['Prefers early meetings to late afternoons'] },
  quietNextDay: true,
}

const peanuts = [
  add('2026-07-01', entry('nut-old', 'limit', 'Peanuts: never satay sauce', said('nut'), { severity: 'hard' }), '19:00'),
  add('2026-09-20', entry('nut-new', 'limit', 'Peanuts: never satay sauce or peanut butter', said('nut-again'), { severity: 'hard' }), '19:00'),
]

const hardDuplicate: DreamFixture = {
  name: 'a hard entry said again is only asked about: both stay until the subject answers',
  history: peanuts,
  messages,
  today: '2026-10-07',
  expect: [{ job: 'duplicate', about: 'nut-old', verdict: 'propose' }],
  reads: { includes: ['Peanuts: never satay sauce or peanut butter', 'Peanuts: never satay sauce\n'] },
  asks: ['nut-old'],
  quietNextDay: true,
}

// The same words, one hard and one soft: the subject loosened or tightened it,
// which is a signal, not a copy. Nothing is touched.
const mixedSeverity: DreamFixture = {
  name: 'a hard and a soft entry in the same words are left alone',
  history: [peanuts[0], add('2026-09-20', entry('nut-soft', 'limit', 'Peanuts: never satay sauce for now', said('nut-again')), '19:00')],
  messages,
  today: '2026-10-07',
  expect: [],
}

// Two months ago the subject said no to dropping the old copy: never again,
// though the cooldown has long run out.
const declined: EntryProposed = {
  type: 'EntryProposed', at: '2026-08-01T03:00:00Z', id: 'p_old', reason: 'changing a hard entry is held for the subject',
  op: retire('2026-08-01', 'nut-old', duplicateReason('nut-new'), byPass('dream-2026-08-01')),
}

const duplicateDeclined: DreamFixture = {
  name: 'a duplicate the subject kept is not proposed again',
  history: [...peanuts, declined, dismiss('2026-08-02', 'proposal', 'p_old', tapped)],
  messages,
  today: '2026-10-07',
  expect: [],
}

// Two months ago the subject kept the old restriction at a check-in ("Is this
// over?" → no). That answered another question: the copy is still asked about.
const keptAtCheckIn: EntryProposed = {
  type: 'EntryProposed', at: '2026-08-01T03:00:00Z', id: 'p_old', reason: 'changing a hard entry is held for the subject',
  op: retire('2026-08-01', 'nut-old', 'not mentioned for 6 weeks while activity goes on', byPass('dream-2026-08-01')),
}

const copyAfterCheckIn: DreamFixture = {
  name: 'a restriction kept at a check-in can still be asked about as a copy',
  history: [...peanuts, keptAtCheckIn, dismiss('2026-08-02', 'proposal', 'p_old', tapped)],
  messages,
  today: '2026-10-07',
  expect: [{ job: 'duplicate', about: 'nut-old', verdict: 'propose' }],
}

// The newer copy was forgotten: the older is not ended in its favour.
const duplicateForgotten: DreamFixture = {
  name: 'a duplicate whose newer copy was forgotten is left alone',
  history: [...meetings, redact('2026-10-01', 'habit-new', tapped)] as LogEvent[],
  messages,
  today: '2026-10-07',
  expect: [],
}

// Both copies have aged unmentioned while activity goes on: each gets its
// check-in, and the older is not also asked about as a copy in the same run —
// one question per entry.
const agedCopies: DreamFixture = {
  name: 'an entry two jobs find is asked about once',
  history: [peanuts[0], add('2026-07-02', entry('nut-new', 'limit', 'Peanuts: never satay sauce or peanut butter', said('nut'), { severity: 'hard' }), '19:00')],
  messages: messages.slice(0, 3),
  activityDays: every(2, '2026-08-01', '2026-10-06'),
  today: '2026-10-07',
  expect: [{ job: 'check-in', about: 'nut-old', verdict: 'propose' }, { job: 'check-in', about: 'nut-new', verdict: 'propose' }],
}

export { softDuplicate, hardDuplicate, mixedSeverity, duplicateDeclined, copyAfterCheckIn, duplicateForgotten, agedCopies }
