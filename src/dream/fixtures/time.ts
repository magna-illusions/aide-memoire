import { add, entry, migrated, said, subject, type DreamFixture } from './fixture.ts'

// "Time": a passed event becomes a follow-up, then history.
//
// The exam's day has passed and the subject has not said how it went, so the
// pass adds a soft follow-up — "the date has passed and how it went is not known
// yet" — citing the message the exam was planned in. The exam itself has
// already lapsed (core: a soft entry past its `until`), so nothing retires it.
// The trip is not followed up: the subject already told about it, and neither
// is the cup they told about on the evening of the day itself. The migrated
// holiday passed before the log took over, so it is history the old store
// already dealt with. A plan with no date has no day to pass.
const examPassed: DreamFixture = {
  name: 'a passed exam becomes a follow-up, once',
  history: [
    add('2026-09-15', entry('spain', 'context', 'Holiday in Spain', { assertedBy: 'operator', origin: 'migration', source: { kind: 'migration', id: 'line-12' } }, { until: '2026-09-20' })),
    migrated('2026-10-07'),
    add('2026-09-01', entry('exam', 'plan', 'Sitting the pilot licence exam', said('exam-plan'), { until: '2026-10-10' }), '19:00'),
    add('2026-09-20', entry('crete', 'context', 'Trip to Crete', said('crete-plan'), { until: '2026-10-08' }), '19:00'),
    add('2026-09-20', entry('ocean', 'plan', 'Wants to sail across an ocean some day', said('crete-plan'))),
    add('2026-09-25', entry('cup', 'plan', 'The club chess cup', said('cup-plan'), { until: '2026-10-10' }), '19:00'),
  ],
  messages: [
    subject('exam-plan', '2026-09-01', 'I sit the pilot licence exam on October 10', '18:00'),
    subject('crete-plan', '2026-09-20', 'Off on a trip to Crete, and I want to sail across an ocean some day', '18:00'),
    subject('crete-back', '2026-10-09', 'Home from Crete again, the trip was lovely'),
    subject('cup-plan', '2026-09-25', 'I play in the club chess cup on October 10', '18:00'),
    // Told the same evening: the day itself counts, though the pass runs after midnight.
    subject('cup-done', '2026-10-10', 'The club chess cup went well, a new rating high', '20:00'),
  ],
  today: '2026-10-11',
  expect: [{ job: 'follow-up', about: 'exam', verdict: 'accept' }],
  reads: {
    includes: ['how it went is not known yet: Sitting the pilot licence exam'],
    excludes: ['Trip to Crete', 'Holiday in Spain'],
  },
  quietNextDay: true,
}

export { examPassed }
