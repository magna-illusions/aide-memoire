import type { EntryProposed, LogEvent, Message } from '../../log/types.ts'
import { add, byPass, entry, every, retire, said, subject, type DreamFixture } from './fixture.ts'

// The policy's caps: one run submits at most three operations, follow-ups
// first, and no new question while five already wait.
//
// A subject with a long memory: four events whose days passed this week and six
// restrictions nobody has mentioned since July. One run follows up three events
// and asks nothing; the rest wait for the next day's run.

const EVENTS = ['Lisbon conference', 'Berlin trade fair', 'Oslo workshop', 'Paris summit']
const ALLERGENS = ['peanuts', 'shellfish', 'sesame', 'gluten', 'soy', 'mustard']

const eventEntries: LogEvent[] = EVENTS.map((name, i) => add('2026-09-01', entry(`event-${i}`, 'plan', `Attending the ${name}`, said(`plan-${i}`), { until: '2026-10-09' })))
const restrictions: LogEvent[] = ALLERGENS.map((allergen, i) => add('2026-07-01', entry(`allergen-${i}`, 'limit', `Allergic to ${allergen}: careful`, said(`allergy-${i}`), { severity: 'hard' })))

const messages: Message[] = [
  ...EVENTS.map((name, i) => subject(`plan-${i}`, '2026-09-01', `I am going to the ${name}`, '09:00')),
  ...ALLERGENS.map((allergen, i) => subject(`allergy-${i}`, '2026-07-01', `Allergic to ${allergen}`, '09:00')),
]

const manyThings: DreamFixture = {
  name: 'a long memory yields at most three operations a run, follow-ups first',
  history: [...eventEntries, ...restrictions],
  messages,
  activityDays: every(2, '2026-08-01', '2026-10-10'),
  today: '2026-10-11',
  expect: [0, 1, 2].map((i) => ({ job: 'follow-up' as const, about: `event-${i}`, verdict: 'accept' as const })),
}

// Five questions already wait: no sixth, though six restrictions have aged.
// (The open ones are on other entries, so each restriction is unasked.)
const waiting: EntryProposed[] = [0, 1, 2, 3, 4].map((i) => ({
  type: 'EntryProposed', at: '2026-10-01T03:00:00Z', id: `p_w${i}`, reason: 'held',
  op: retire('2026-10-01', `old-${i}`, 'not mentioned', byPass('dream-2026-10-01')),
}))
const old: LogEvent[] = [0, 1, 2, 3, 4].map((i) => add('2026-06-01', entry(`old-${i}`, 'limit', `Old reaction ${i}`, said('allergy-0'), { severity: 'hard' })))

const questionsWaiting: DreamFixture = {
  name: 'no new question while five already wait',
  history: [...restrictions, ...old, ...waiting],
  messages,
  activityDays: every(2, '2026-08-01', '2026-10-10'),
  today: '2026-10-11',
  expect: [],
}

// The same five questions waiting, and two copies: the hard one would be a
// sixth question and waits; the soft one is tidied away, since it asks nothing.
const copies: LogEvent[] = [
  add('2026-06-01', entry('copy-hard-old', 'limit', 'Allergic to nuts: no almonds', said('allergy-0'), { severity: 'hard' })),
  add('2026-07-01', entry('copy-hard-new', 'limit', 'Allergic to nuts: no almonds at all', said('allergy-0'), { severity: 'hard' })),
  add('2026-06-01', entry('copy-soft-old', 'habit', 'Likes the Berlin trade fair best', said('plan-1')), '08:00'),
  add('2026-09-01', entry('copy-soft-new', 'habit', 'Likes the Berlin trade fair best of all fairs', said('plan-1')), '10:00'),
]

const copiesWhileWaiting: DreamFixture = {
  name: 'no new question while five wait, but a soft copy is still tidied away',
  history: [...old, ...waiting, ...copies],
  messages,
  today: '2026-10-11',
  expect: [{ job: 'duplicate', about: 'copy-soft-old', verdict: 'accept' }],
}

export { manyThings, questionsWaiting, copiesWhileWaiting }
