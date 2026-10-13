import { add, byPass, dismiss, entry, said, subject, supersede, tapped, type DreamFixture } from './fixture.ts'

// "Reality": entries are checked against the host's records. Where they
// disagree, the records win, as a supersede held for the subject.
//
// Memory says Spanish practice runs about 20 minutes a day; the logged days say
// 40. The pass proposes the new value, citing the subject's own report of it —
// the validator needs a message of theirs newer than the entry that speaks of
// it — and holds it as a question ("Has this changed?") rather than applying
// it. French is within the tolerance, so it is left alone; the typing pace
// names no minutes.
const valueMoved: DreamFixture = {
  name: 'a value the records contradict is proposed as a change, once',
  history: [
    add('2026-08-01', entry('spanish', 'level', 'Spanish practice about 20 minutes a day', said('august')), '19:00'),
    add('2026-08-01', entry('french', 'level', 'French lessons 30 minutes a day', said('august')), '19:00'),
    add('2026-08-01', entry('typing', 'level', 'Types at about 60 words per minute', said('august')), '19:00'),
  ],
  messages: [
    subject('august', '2026-08-01', 'Doing Spanish practice about 20 minutes a day and French lessons 30 minutes a day, typing at 60 words per minute', '18:00'),
    subject('spanish-now', '2026-10-06', 'Spanish practice for 40 minutes today, felt solid'),
    subject('french-now', '2026-10-06', 'French lessons ran 32 minutes'),
  ],
  records: [
    { label: 'spanish', value: 35, day: '2026-09-29' },
    { label: 'spanish', value: 40, day: '2026-10-06' },
    { label: 'french', value: 32, day: '2026-10-06' },
  ],
  today: '2026-10-07',
  expect: [{ job: 'reality', about: 'spanish', verdict: 'accept' }],
  asks: ['spanish'],
  quietNextDay: true,
}

// The same log with no read path to the records: nothing.
const noRecords: DreamFixture = { ...valueMoved, name: 'without records the values are left alone', records: null, expect: [], asks: undefined, quietNextDay: undefined }

// The subject answered no to the same correction three days ago: it is not
// asked again while the cooldown runs, though the records still disagree.
const correctionDeclined: DreamFixture = {
  ...valueMoved,
  name: 'a declined correction is not asked again within the cooldown',
  history: [
    ...valueMoved.history,
    {
      type: 'EntryProposed', at: '2026-10-04T03:00:00Z', id: 'p_old', reason: 'the records show another value',
      op: supersede('2026-10-04', 'spanish', entry('r1', 'level', 'Daily spanish: 35 minutes per the logged days (2026-09-29).', byPass('dream-2026-10-04', 'spanish-now'))),
    },
    dismiss('2026-10-05', 'proposal', 'p_old', tapped),
  ],
  expect: [],
  asks: undefined,
  quietNextDay: undefined,
}

export { valueMoved, noRecords, correctionDeclined }
