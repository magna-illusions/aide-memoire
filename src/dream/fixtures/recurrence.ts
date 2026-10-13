import { add, byPass, dismiss, entry, inSession, observed, said, subject, supersede, tapped, type DreamFixture } from './fixture.ts'

// Promotion of what keeps being said, without a model: what the agent only
// observed, the subject has since said in three messages over more than one
// session. The pass asks "Still true?" — a supersede in the same words, held as
// a question — and the subject's confirm makes it theirs.
//
// The first message says something near it ("a bit of a headache after the
// call") but not the entry: a saying counts only when it holds most of the
// entry's words.

const history = [add('2026-09-15', entry('calls', 'note', 'Gets a headache after long video calls', observed('m0')), '19:00')]

const m0 = inSession('s0', subject('m0', '2026-09-15', 'Felt a bit of a headache after the call', '18:00'))
const m1 = inSession('s1', subject('m1', '2026-09-20', 'Long video calls gave me a headache again'))
const m2 = inSession('s2', subject('m2', '2026-09-27', 'Headache after long video calls today'))
const m3 = inSession('s3', subject('m3', '2026-10-04', 'Long video calls again and a headache after'))

const saidThreeTimes: DreamFixture = {
  name: 'what the agent observed and the subject said in three messages over several sessions is asked "Still true?", once',
  history,
  messages: [m0, m1, m2, m3],
  today: '2026-10-07',
  expect: [{ job: 'recurrence', about: 'calls', verdict: 'accept' }],
  asks: ['calls'],
  quietNextDay: true,
}

const saidTwice: DreamFixture = {
  ...saidThreeTimes,
  name: 'said twice is not yet a pattern',
  messages: [m0, m1, m2],
  expect: [],
  asks: undefined,
  quietNextDay: undefined,
}

// Three times in one conversation is one thing said at length, not a recurrence.
const oneSession: DreamFixture = {
  ...saidTwice,
  name: 'said three times in one session is not a recurrence',
  messages: [m0, ...[m1, m2, m3].map((m) => ({ ...m, session: 's1' }))],
}

// Two months ago the subject answered "Still true?" with no: never asked
// again, though the cooldown has run out and they keep saying it.
const declinedBefore: DreamFixture = {
  ...saidTwice,
  name: 'a promotion the subject declined is not asked again',
  history: [
    add('2026-07-01', entry('calls', 'note', 'Gets a headache after long video calls', observed('m0')), '19:00'),
    {
      type: 'EntryProposed', at: '2026-08-01T03:00:00Z', id: 'p_old', reason: 'the subject keeps saying it',
      op: supersede('2026-08-01', 'calls', entry('c2', 'note', 'Gets a headache after long video calls', byPass('dream-2026-08-01', 'm0'))),
    },
    dismiss('2026-08-02', 'proposal', 'p_old', tapped),
  ],
  messages: [m0, m1, m2, m3],
}

// The newest saying already holds three entries, the most one message may: the
// question cites the next newest instead of being refused every day.
const newestIsFull: DreamFixture = {
  ...saidThreeTimes,
  name: 'a promotion cites the newest saying with room under the per-message cap',
  history: [
    ...history,
    add('2026-10-04', entry('r1', 'level', 'Spends three hours on video calls daily', said('m3'))),
    add('2026-10-04', entry('r2', 'habit', 'Likes short video calls', said('m3'))),
    add('2026-10-04', entry('r3', 'plan', 'Wants fewer video calls by spring', said('m3'))),
  ],
  asks: undefined,
  quietNextDay: undefined,
}

// The agent's own conclusion from a host record, applied where the kind takes
// records softly: the subject saying the same words does not make the record's
// reading theirs, and a promotion would rank the guess as their word.
const onRecord: DreamFixture = {
  ...saidTwice,
  name: 'what the agent built on a record is never promoted, however often it is said',
  history: [add('2026-09-15', entry('calls', 'note', 'Gets a headache after long video calls',
    { assertedBy: 'agent', origin: 'conversation', source: { kind: 'record', id: 'log-1', at: '2026-09-15T17:00:00Z' } }), '19:00')],
  messages: [m0, m1, m2, m3],
}

export { saidThreeTimes, saidTwice, oneSession, declinedBefore, newestIsFull, onRecord }
