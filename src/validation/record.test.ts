import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type ValidationContext, type ValidationPolicy, type Verdict } from './validate.ts'
import { assertionFor } from './writer.ts'
import { applyEntryEvent, foldEntries } from '../log/fold.ts'
import { shapeProblem } from '../log/shape.ts'
import type { Assertion, EntryAdded, EntryDraft, EntryEvent, HostRecord, Message, Source, Writer } from '../log/types.ts'

// A record is something the host holds about the subject — a measurement, a
// booking, a log row — cited in place of a message. It is host data: the
// validator checks only that the host vouches for it (it exists, it is the
// stream owner's, and it is newer than what it answers), never what it says.
// So it is never the subject's word: it settles nothing, is never relayed, and
// what the agent or a background pass builds on one is held for the subject.

const policy: ValidationPolicy = {
  kinds: { limit: { mayBeHard: true }, fact: { mayBeHard: false } },
  maxTextLength: 120,
  stopwords: new Set(['the', 'and', 'a']),
  textRules: [],
  caps: { liveEntries: 10, addsPerMessage: 2, opsPerRun: 5 },
}

const messages: Message[] = [
  { id: 'm1', role: 'subject', text: 'green tea every morning, and a peanut allergy', at: '2026-09-01T10:00:00Z' },
]

const RECORDS: Record<string, HostRecord> = {
  'r-new': { id: 'r-new', at: '2026-10-02T08:00:00Z', owner: 'u1' },
  'r-old': { id: 'r-old', at: '2026-08-01T08:00:00Z', owner: 'u1' },
  'r-foreign': { id: 'r-foreign', at: '2026-10-02T08:00:00Z', owner: 'u2' },
  'r-liar': { id: 'r-other', at: '2026-10-02T08:00:00Z', owner: 'u1' },
}
const records = (id: string): HostRecord | undefined => (Object.hasOwn(RECORDS, id) ? RECORDS[id] : undefined)

const record = (id: string, at = '2026-10-02T08:00:00Z'): Source => ({ kind: 'record', id, at })
const action: Source = { kind: 'action', id: 'tap' }
const by = (writer: Writer, source: Source): Assertion => ({ ...assertionFor(writer, source), ...(writer === 'consolidation' ? { runId: 'r1' } : {}) })

const AT = '2026-10-04T10:00:00Z'
const draft = (id: string, text: string, who: Assertion, extra: Partial<EntryDraft> = {}): EntryDraft =>
  ({ id, kind: 'fact', text, severity: 'soft', ...who, ...extra })
const hard = (id: string, text: string, who: Assertion): EntryDraft => draft(id, text, who, { kind: 'limit', severity: 'hard' })
const add = (entry: EntryDraft): EntryAdded => ({ type: 'EntryAdded', at: AT, entry })
const supersede = (old: string, entry: EntryDraft): EntryEvent => ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry })
const retire = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryRetired', at: AT, id, reason: 'over', ...who })
const settle = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryConfirmed', at: AT, target: 'proposal', id, ...who })

const subject = by('subject-action', action)
const state = foldEntries([
  { type: 'EntryAdded', at: '2026-09-01T10:05:00Z', entry: hard('hard', 'peanut allergy: no satay', subject) },
  { type: 'EntryAdded', at: '2026-09-02T10:00:00Z', entry: draft('soft', 'green tea every morning', subject) },
  { type: 'EntryProposed', at: '2026-09-03T10:00:00Z', id: 'p-open', reason: 'asked', op: add(draft('held', 'peanut-free snacks', subject)) },
])

function ctxFor(writer: Writer, extra: Partial<ValidationContext> = {}): ValidationContext {
  let n = 0
  return {
    policy, messages, writer, now: AT, proposalId: () => `p${++n}`, owner: 'u1', records,
    ...(writer === 'consolidation' ? { runId: 'r1' } : {}), ...extra,
  }
}

function assertVerdict(verdict: Verdict, expected: Verdict['verdict'], reason?: RegExp): void {
  assert.equal(verdict.verdict, expected, 'reason' in verdict ? verdict.reason : 'accepted')
  if (reason && verdict.verdict !== 'accept') assert.match(verdict.reason, reason)
}

type Case = [string, Writer, EntryEvent, Verdict['verdict'], RegExp?]

function table(cases: Case[], extra: Partial<ValidationContext> = {}): void {
  for (const [name, writer, event, expected, reason] of cases) {
    it(`${expected}: ${name}`, () => assertVerdict(validate(state, event, ctxFor(writer, extra)), expected, reason))
  }
}

const pass = (id: string) => by('consolidation', record(id))
const agent = (id: string) => by('agent', record(id))

describe('a record source: the host vouches for it', () => {
  table([
    ['a pass replaces a soft entry on the owner\'s newer record, held', 'consolidation', supersede('soft', draft('n1', 'black tea every morning', pass('r-new'))), 'propose', /record/],
    ['a pass adds on the owner\'s record, held', 'consolidation', add(draft('n1', 'black tea every morning', pass('r-new'))), 'propose', /record/],
    ['a pass closes a hard entry on a newer record, held', 'consolidation', retire('hard', pass('r-new')), 'propose', /hard|record/],
    ['a record of another owner', 'consolidation', supersede('soft', draft('n1', 'black tea', pass('r-foreign'))), 'reject', /not the stream owner's/],
    ['a record the host does not hold', 'consolidation', supersede('soft', draft('n1', 'black tea', pass('r-missing'))), 'reject', /does not exist/],
    ['a lookup that answers with another record', 'consolidation', supersede('soft', draft('n1', 'black tea', pass('r-liar'))), 'reject', /does not exist/],
    ['a record older than the entry it replaces', 'consolidation', supersede('soft', draft('n1', 'black tea', pass('r-old'))), 'reject', /older than what it answers/],
    ['a record older than the hard entry it closes', 'consolidation', retire('hard', pass('r-old')), 'reject', /older than what it answers/],
  ])
})

describe('a record is never the subject\'s word', () => {
  table([
    ['the agent adds a soft entry on a record: held, not applied', 'agent', add(draft('n1', 'black tea every morning', agent('r-new'))), 'propose', /record/],
    ['the agent adds a hard entry on a record: held', 'agent', add(hard('n1', 'no satay at all', agent('r-new'))), 'propose'],
    ['the agent settles a soft proposal on a record', 'agent', settle('p-open', agent('r-new')), 'reject', /never settles or forgets/],
    ['the agent forgets a soft entry on a record', 'agent', { type: 'EntryRedacted', at: AT, id: 'soft', ...agent('r-new') }, 'reject', /never settles or forgets/],
    ['a subject action settles on a record', 'subject-action', settle('p-open', by('subject-action', record('r-new'))), 'reject', /never settles or forgets/],
    ['an operator settles on a record', 'operator', settle('p-open', by('operator', record('r-new'))), 'reject', /never settles or forgets/],
    ['a migration cites a record', 'migration', add(draft('n1', 'black tea', by('migration', record('r-new')))), 'reject', /migration only adds/],
  ])
})

describe('a record cited by a subject action or an operator', () => {
  table([
    ['a subject action adds on their record', 'subject-action', add(draft('n1', 'black tea every morning', by('subject-action', record('r-new')))), 'accept'],
    ['a subject action closes a hard entry on a newer record', 'subject-action', retire('hard', by('subject-action', record('r-new'))), 'accept'],
    ['a subject action on another owner\'s record', 'subject-action', add(draft('n1', 'black tea', by('subject-action', record('r-foreign')))), 'reject', /not the stream owner's/],
    ['an operator adds a hard entry on a record', 'operator', add(hard('n1', 'no satay at all', by('operator', record('r-new')))), 'accept'],
  ])
})

describe('a record needs the host to look it up', () => {
  table([
    ['no lookup in the context', 'operator', add(draft('n1', 'black tea', by('operator', record('r-new')))), 'reject', /no host records/],
  ], { records: undefined })
  table([
    ['no stream owner in the context', 'operator', add(draft('n1', 'black tea', by('operator', record('r-new')))), 'reject', /no host records/],
  ], { owner: undefined })
})

describe('what the stored event says of a record', () => {
  const eventOf = (verdict: Verdict) => (verdict as { event: EntryEvent }).event

  it('carries the host\'s time for the record, whatever the event declared', () => {
    const verdict = validate(state, add(draft('n1', 'black tea', by('operator', record('r-new', '1999-01-01T00:00:00Z')))), ctxFor('operator'))
    const event = eventOf(verdict)
    assert.deepEqual(event.type === 'EntryAdded' && event.entry.source, record('r-new', '2026-10-02T08:00:00Z'))
  })

  it('is never relayed, though the agent wrote it', () => {
    const event = eventOf(validate(state, add(draft('n1', 'green tea every morning', agent('r-new'))), ctxFor('agent')))
    assert.equal(event.type === 'EntryProposed' && event.op.type === 'EntryAdded' && event.op.entry.relayed, false)
  })

  it('folds: the source survives the rebuild', () => {
    const event = eventOf(validate(state, add(draft('n1', 'black tea', by('operator', record('r-new')))), ctxFor('operator')))
    const entry = applyEntryEvent(state, event).entries.find((e) => e.id === 'n1')
    assert.deepEqual(entry?.source, record('r-new'))
  })

  it('counts against the entries one source may yield, as a message does', () => {
    const two = foldEntries([add(draft('a', 'one', by('operator', record('r-new')))), add(draft('b', 'two', by('operator', record('r-new'))))])
    assertVerdict(validate(two, add(draft('c', 'three', by('operator', record('r-new')))), ctxFor('operator')), 'reject', /over 2 entries per record/)
  })
})

describe('the shape of a record source', () => {
  const shaped = (source: unknown) => shapeProblem(add(draft('n1', 'black tea', { ...by('operator', action), source: source as Source })))
  it('needs an id and a time', () => {
    assert.equal(shaped({ kind: 'record', id: 'r-new', at: AT }), null)
    assert.equal(shaped({ kind: 'record', id: 'r-new' }), 'malformed source')
    assert.equal(shaped({ kind: 'record', at: AT }), 'malformed source')
  })

  it('keeps nothing else', () => {
    const event = add(draft('n1', 'black tea', { ...by('operator', action), source: { ...record('r-new'), owner: 'u2' } as unknown as Source }))
    assert.deepEqual(foldEntries([event]).entries[0].source, record('r-new'))
  })
})

// Review 2026-10-07: the lookup is the host's code, and a record from it is
// checked like any input. A time without an offset reads as local time, so the
// same record would be newer on one server and older on another.
describe('what the host lookup answers is checked, and never throws', () => {
  const answering = (answer: () => unknown): Partial<ValidationContext> => ({ records: answer as ValidationContext['records'] })
  const op = add(draft('n1', 'black tea', by('operator', record('r-new'))))
  const cases: [string, () => unknown, RegExp][] = [
    ['a record with no time', () => ({ id: 'r-new', owner: 'u1' }), /malformed record/],
    ['a time that is a Date, not a string', () => ({ id: 'r-new', owner: 'u1', at: new Date('2026-10-02T08:00:00Z') }), /malformed record/],
    ['a time that is a number', () => ({ id: 'r-new', owner: 'u1', at: 1_790_000_000_000 }), /malformed record/],
    ['a time without an offset', () => ({ id: 'r-new', owner: 'u1', at: '2026-10-02T08:00:00' }), /malformed record/],
    ['a day without a time', () => ({ id: 'r-new', owner: 'u1', at: '2026-10-02' }), /malformed record/],
    ['a time that does not parse', () => ({ id: 'r-new', owner: 'u1', at: 'yesterdayZ' }), /malformed record/],
    ['an owner that is not a string', () => ({ id: 'r-new', owner: 1, at: '2026-10-02T08:00:00Z' }), /malformed record/],
    ['an answer that is not an object', () => 'r-new', /malformed record/],
    ['a lookup that throws', () => { throw new Error('db down') }, /record lookup failed/],
  ]
  for (const [name, answer, reason] of cases) {
    it(`reject: ${name}`, () => assertVerdict(validate(state, op, ctxFor('operator', answering(answer))), 'reject', reason))
  }

  it('accepts a time with an offset, and compares it as the instant it names', () => {
    const answer = () => ({ id: 'r-new', owner: 'u1', at: '2026-09-01T12:00:00+02:00' })
    assertVerdict(validate(state, add(draft('n1', 'black tea', by('operator', record('r-new')))), ctxFor('operator', answering(answer))), 'accept')
    // 10:00Z, before the hard entry (10:05Z), so it cannot close it.
    assertVerdict(validate(state, retire('hard', by('subject-action', record('r-new'))), ctxFor('subject-action', answering(answer))), 'reject', /older/)
  })
})
