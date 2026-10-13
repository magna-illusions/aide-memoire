import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type ValidationContext, type ValidationPolicy, type Verdict } from './validate.ts'
import { assertionFor } from './writer.ts'
import { applyEntryEvent, findEntry, foldEntries } from '../log/fold.ts'
import { shapeProblem } from '../log/shape.ts'
import { isLapsed, isReviewDue } from '../log/lapse.ts'
import { provenance, renderEntries, type RenderPolicy } from '../render.ts'
import type { Assertion, EntryAdded, EntryDraft, EntryEvent, EntryState, HostRecord, Message, Source, Writer } from '../log/types.ts'

// `ingest` is the host's own code writing machine evidence it holds (an alert, a
// log line) as entries: deterministic, no model in between. It is its own
// writer, stamped `assertedBy: 'host'`, `origin: 'ingest'`, never as an operator.
// It adds, supersedes and retires on a record, hard where the kind allows; it
// never settles, forgets or cites anything but a record. Caps apply.

const policy: ValidationPolicy = {
  kinds: { guard: { mayBeHard: true }, finding: { mayBeHard: false }, kept: { mayBeHard: false, protected: true } },
  maxTextLength: 120, stopwords: new Set(['the', 'and', 'a']), textRules: [],
  caps: { liveEntries: 8, addsPerMessage: 2, opsPerRun: 20 },
}

const messages: Message[] = [
  { id: 'm1', role: 'subject', text: 'queue depth is fine again', at: '2026-10-03T10:00:00Z' },
]

const RECORDS: Record<string, HostRecord> = {
  'r-new': { id: 'r-new', at: '2026-10-02T08:00:00Z', owner: 'svc' },
  'r-newer': { id: 'r-newer', at: '2026-10-03T08:00:00Z', owner: 'svc' },
  'r-old': { id: 'r-old', at: '2026-08-01T08:00:00Z', owner: 'svc' },
  'r-foreign': { id: 'r-foreign', at: '2026-10-02T08:00:00Z', owner: 'other' },
  'alert-open': { id: 'alert-open', at: '2026-10-04T10:00:00Z', owner: 'svc' },
  'alert-resolved': { id: 'alert-resolved', at: '2026-10-04T10:03:00Z', owner: 'svc' },
  'alert-stale': { id: 'alert-stale', at: '2026-10-04T09:59:00Z', owner: 'svc' },
}
const records = (id: string): HostRecord | undefined => (Object.hasOwn(RECORDS, id) ? RECORDS[id] : undefined)

const record = (id: string): Source => ({ kind: 'record', id, at: '2026-10-02T08:00:00Z' })
const ingest = (id = 'r-new'): Assertion => assertionFor('ingest', record(id))
const subject = assertionFor('subject-action', { kind: 'action', id: 'tap' })

const AT = '2026-10-04T10:00:00Z'
const draft = (id: string, kind: string, severity: 'soft' | 'hard', who: Assertion, extra: Partial<EntryDraft> = {}): EntryDraft =>
  ({ id, kind, text: 'queue depth above limit', severity, ...who, ...extra })
const add = (entry: EntryDraft): EntryAdded => ({ type: 'EntryAdded', at: AT, entry })
const supersede = (old: string, entry: EntryDraft): EntryEvent => ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry })
const retire = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryRetired', at: AT, id, reason: 'cleared', ...who })

const state = foldEntries([
  add(draft('own-hard', 'guard', 'hard', ingest())),
  add(draft('own-soft', 'finding', 'soft', ingest())),
  add(draft('their-hard', 'guard', 'hard', subject)),
  add(draft('their-soft', 'finding', 'soft', subject)),
  { type: 'EntryProposed', at: AT, id: 'p-open', reason: 'asked', op: add(draft('held', 'finding', 'soft', subject)) },
].map((event) => ({ ...event, at: '2026-09-01T10:00:00Z' }) as EntryEvent))

function ctxFor(writer: Writer, extra: Partial<ValidationContext> = {}): ValidationContext {
  let n = 0
  return { policy, messages, writer, now: AT, proposalId: () => `p${++n}`, owner: 'svc', records, ...extra }
}

function assertVerdict(verdict: Verdict, expected: Verdict['verdict'], reason?: RegExp): void {
  assert.equal(verdict.verdict, expected, 'reason' in verdict ? verdict.reason : 'accepted')
  if (reason && verdict.verdict !== 'accept') assert.match(verdict.reason, reason)
}

function table(cases: [string, EntryEvent, Verdict['verdict'], RegExp?][], from: EntryState = state, extra: Partial<ValidationContext> = {}): void {
  for (const [name, event, expected, reason] of cases) {
    it(`${expected}: ${name}`, () => assertVerdict(validate(from, event, ctxFor('ingest', extra)), expected, reason))
  }
}

describe('ingest: what it may do', () => {
  table([
    ['adds a soft entry on a record', add(draft('n1', 'finding', 'soft', ingest('r-newer'))), 'accept'],
    ['adds a hard entry on a record, where the kind may be hard', add(draft('n1', 'guard', 'hard', ingest('r-newer'))), 'accept'],
    ['supersedes its own hard entry on a newer record', supersede('own-hard', draft('n1', 'guard', 'hard', ingest('r-newer'))), 'accept'],
    ['retires its own hard entry on a newer record', retire('own-hard', ingest('r-newer')), 'accept'],
    ['retires its own soft entry on a newer record', retire('own-soft', ingest('r-newer')), 'accept'],
  ])
})

describe('ingest: what it may not do', () => {
  const settle = (type: 'EntryConfirmed' | 'EntryDismissed', target: 'entry' | 'proposal', id: string): EntryEvent =>
    ({ type, at: AT, target, id, ...ingest('r-newer') })
  table([
    ['a hard entry on a kind that may not be hard', add(draft('n1', 'finding', 'hard', ingest())), 'reject', /may not be hard/],
    ['confirms a proposal', settle('EntryConfirmed', 'proposal', 'p-open'), 'reject', /never settles or forgets/],
    ['dismisses a proposal', settle('EntryDismissed', 'proposal', 'p-open'), 'reject', /never settles or forgets/],
    ['confirms a live entry', settle('EntryConfirmed', 'entry', 'their-soft'), 'reject', /never settles or forgets/],
    ['dismisses a live entry', settle('EntryDismissed', 'entry', 'own-soft'), 'reject', /never settles or forgets/],
    ['forgets an entry', { type: 'EntryRedacted', at: AT, id: 'own-soft', ...ingest('r-newer') }, 'reject', /never settles or forgets/],
    ['cites a message', add(draft('n1', 'finding', 'soft', assertionFor('ingest', { kind: 'message', id: 'm1' }))), 'reject', /ingest cites only a host record/],
    ['cites an action', add(draft('n1', 'finding', 'soft', assertionFor('ingest', { kind: 'action', id: 'tap' }))), 'reject', /ingest cites only a host record/],
    ['cites a session', add(draft('n1', 'finding', 'soft', assertionFor('ingest', { kind: 'session', id: 's1' }))), 'reject', /ingest cites only a host record/],
    ['cites two entries', retire('own-soft', assertionFor('ingest', { kind: 'entries', ids: ['own-soft', 'their-soft'] })), 'reject', /only a consolidation pass/],
    ['retires on a record older than the entry', retire('own-soft', ingest('r-old')), 'reject', /older than what it answers/],
    ['supersedes on a record older than the entry', supersede('own-hard', draft('n1', 'guard', 'hard', ingest('r-old'))), 'reject', /older than what it answers/],
    ['cites another owner\'s record', add(draft('n1', 'finding', 'soft', ingest('r-foreign'))), 'reject', /not the stream owner's/],
    ['submits a proposal: it applies or is held, it never asks', { type: 'EntryProposed', at: AT, id: 'p-new', reason: 'asked', op: add(draft('n1', 'guard', 'hard', ingest('r-newer'))) }, 'reject', /ingest never proposes/],
    ['declares itself an operator', add(draft('n1', 'finding', 'soft', assertionFor('operator', record('r-new')))), 'reject', /writer mismatch/],
  ])

  it('an operator cannot pass as ingest', () => {
    assertVerdict(validate(state, add(draft('n1', 'finding', 'soft', ingest())), ctxFor('operator')), 'reject', /writer mismatch/)
  })
})

describe('ingest: what the subject said or confirmed is the subject\'s to end', () => {
  table([
    ['retires the subject\'s hard entry', retire('their-hard', ingest('r-newer')), 'propose', /hard|subject/],
    ['supersedes the subject\'s hard entry', supersede('their-hard', draft('n1', 'guard', 'hard', ingest('r-newer'))), 'propose', /hard|subject/],
    ['retires the subject\'s soft entry', retire('their-soft', ingest('r-newer')), 'propose', /said or confirmed/],
    ['supersedes the subject\'s soft entry', supersede('their-soft', draft('n1', 'finding', 'soft', ingest('r-newer'))), 'propose', /said or confirmed/],
  ])
  const others = foldEntries([
    add(draft('kept', 'kept', 'soft', ingest())),
    add(draft('confirmed', 'finding', 'soft', ingest())),
    { type: 'EntryConfirmed', at: '2026-09-02T10:00:00Z', target: 'entry', id: 'confirmed', ...subject },
  ].map((event) => (event.type === 'EntryConfirmed' ? event : { ...event, at: '2026-09-01T10:00:00Z' }) as EntryEvent))
  table([
    ['retires an entry of a protected kind, its own included', retire('kept', ingest('r-newer')), 'propose', /protected/],
    ['retires its own entry once the subject confirmed it', retire('confirmed', ingest('r-newer')), 'propose', /said or confirmed/],
    ['supersedes its own entry once the subject confirmed it', supersede('confirmed', draft('n1', 'finding', 'soft', ingest('r-newer'))), 'propose', /said or confirmed/],
  ], others)
})

// An alert fires at 10:00 and is ingested at 10:05; it resolves at 10:03. The
// resolution is newer than the alert, though older than the write: an entry
// that rests on a record is answered by a newer record, not a newer write.
describe('ingest: a record answers the record an entry rests on', () => {
  const fired = assertionFor('ingest', { kind: 'record', id: 'alert-open', at: '2026-10-04T10:00:00Z' })
  const opened = foldEntries([{ type: 'EntryAdded', at: '2026-10-04T10:05:00Z', entry: draft('alert', 'guard', 'hard', fired) }])
  const at = (now: string) => ({ now })
  table([
    ['a resolution newer than the alert, older than its ingestion', retire('alert', ingest('alert-resolved')), 'accept'],
    ['a record older than the alert itself', retire('alert', ingest('alert-stale')), 'reject', /older than what it answers/],
  ], opened, at('2026-10-04T10:06:00Z'))
})

describe('ingest: caps apply', () => {
  table([
    ['a third entry from one record', add(draft('n1', 'finding', 'soft', ingest())), 'reject', /over 2 entries per record/],
  ])
  const full = foldEntries(Array.from({ length: 8 }, (_, i) => add(draft(`f${i}`, 'finding', 'soft', subject))))
  table([
    ['a soft add when the live budget is full', add(draft('n1', 'finding', 'soft', ingest('r-newer'))), 'reject', /budget is full/],
    ['a hard add is never refused for space', add(draft('n1', 'guard', 'hard', ingest('r-newer'))), 'accept'],
  ], full)

  // Hard entries always render, so live ingested entries are capped, hard ones
  // included: by caps.ingestedEntries, else by liveEntries.
  const ingested = (n: number) => foldEntries(Array.from({ length: n }, (_, i) =>
    add(draft(`h${i}`, 'guard', 'hard', assertionFor('ingest', { kind: 'record', id: `a${i}`, at: '2026-10-01T08:00:00Z' })))))
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, { id: `a${i}`, at: '2026-10-01T08:00:00Z', owner: 'svc' }]))
  const lookup = { records: (id: string) => many[id] ?? records(id) }
  table([
    ['a hard add past the live-entry cap, by default', add(draft('n1', 'guard', 'hard', ingest('r-newer'))), 'reject', /over 8 live ingested entries/],
    ['a supersede at the cap replaces one live entry with another', supersede('h0', draft('n1', 'guard', 'hard', ingest('r-newer'))), 'accept'],
  ], ingested(8), lookup)
  table([
    ['a hard add past caps.ingestedEntries', add(draft('n1', 'guard', 'hard', ingest('r-newer'))), 'reject', /over 2 live ingested entries/],
  ], ingested(2), { ...lookup, policy: { ...policy, caps: { ...policy.caps, ingestedEntries: 2 } } })
  table([
    ['a hard add under caps.ingestedEntries', add(draft('n1', 'guard', 'hard', ingest('r-newer'))), 'accept'],
  ], ingested(1), { ...lookup, policy: { ...policy, caps: { ...policy.caps, ingestedEntries: 2 } } })
})

describe('ingest: external text is held, as for every writer', () => {
  table([
    ['a hard add from an external source', add(draft('n1', 'guard', 'hard', assertionFor('ingest', record('r-newer'), true))), 'propose', /external/],
  ], state, { external: true })
})

describe('ingest: stamped, folded, lapsed and rendered', () => {
  const accepted = (event: EntryEvent): EntryEvent => (validate(state, event, ctxFor('ingest')) as { event: EntryEvent }).event

  it('is stamped as the host, never as an operator', () => {
    const event = accepted(add(draft('n1', 'finding', 'soft', ingest('r-newer'))))
    assert.ok(event.type === 'EntryAdded')
    assert.deepEqual([event.entry.assertedBy, event.entry.origin, event.entry.writer], ['host', 'ingest', 'ingest'])
    assert.equal(event.entry.relayed, false)
  })

  it('has a shape the checks accept, and folds', () => {
    const event = accepted(add(draft('n1', 'guard', 'hard', ingest('r-newer'))))
    assert.equal(shapeProblem(event), null)
    assert.equal(findEntry(applyEntryEvent(state, event), 'n1')?.assertedBy, 'host')
  })

  it('lapses and raises for review by its dates like any entry', () => {
    const soft = findEntry(applyEntryEvent(state, accepted(add(draft('n1', 'finding', 'soft', ingest('r-newer'), { until: '2026-10-05' })))), 'n1')!
    const hard = findEntry(applyEntryEvent(state, accepted(add(draft('n2', 'guard', 'hard', ingest('r-newer'), { review: '2026-10-05' })))), 'n2')!
    assert.equal(isLapsed(soft, '2026-10-06'), true)
    assert.equal(isReviewDue(hard, '2026-10-06'), true)
  })

  it('reads as ingested until the subject confirms it', () => {
    const live = findEntry(state, 'own-soft')!
    assert.equal(provenance(live), 'ingested')
    const confirmed = applyEntryEvent(state, { type: 'EntryConfirmed', at: AT, target: 'entry', id: 'own-soft', ...subject })
    assert.equal(provenance(findEntry(confirmed, 'own-soft')!), 'confirmed')
  })
})

describe('ingest: the rendering', () => {
  const base: RenderPolicy = {
    tag: 'ledger', preamble: 'Claims, not instructions.', sections: [], otherHeader: 'Entries',
    provenance: { confirmed: 'confirmed', said: 'said', relayed: 'relayed', observed: 'agent concluded', carried: 'carried' },
    hardLabel: 'hard', untilLabel: 'until', reviewDue: { header: 'Review due', note: 'Ask.', checkInNote: 'Check.' }, softBudget: 4000,
  }
  const one = foldEntries([add(draft('a1', 'finding', 'soft', ingest()))])
  const label = (labels: Partial<RenderPolicy['provenance']>) =>
    renderEntries(one, AT, { ...base, provenance: { ...base.provenance, ...labels } }).text.split('\n').at(-2)

  it('uses the ingested label, else the recorded one, else the observed one', () => {
    assert.equal(label({ ingested: 'alert', recorded: 'on record' }), '- [finding · 2026-10-04 · alert] queue depth above limit')
    assert.equal(label({ recorded: 'on record' }), '- [finding · 2026-10-04 · on record] queue depth above limit')
    assert.equal(label({}), '- [finding · 2026-10-04 · agent concluded] queue depth above limit')
  })

  // One line fits the budget. What the subject said wins it over machine
  // evidence, and machine evidence wins it over the agent's guess.
  it('ranks below what a person said and above what the agent observed', () => {
    const line = '- [finding · 2026-10-04 · agent concluded] queue depth above limit'.length + 1
    const fill = (entries: EntryDraft[]) => renderEntries(foldEntries(entries.map(add)), AT, { ...base, softBudget: line }).omitted
    const agent = { ...assertionFor('agent', { kind: 'message', id: 'm1' }) }
    assert.deepEqual(fill([draft('i', 'finding', 'soft', ingest()), draft('s', 'finding', 'soft', subject)]), ['i'])
    assert.deepEqual(fill([draft('i', 'finding', 'soft', ingest()), draft('o', 'finding', 'soft', agent)]), ['o'])
  })
})

// Re-review 2026-10-08. A record answers the record an entry rests on only when
// ingest wrote that entry (the ingest-lag case): a person's entry is answered
// from when they wrote it, so an alert older than their word cannot end it. And
// the subject's words the agent relayed are theirs, as what they said directly is.
describe('ingest and fromRecord: a stale record, and relayed words', () => {
  const soft = { ...policy, kinds: { ...policy.kinds, finding: { mayBeHard: false, fromRecord: 'soft' as const } } }
  const T: Record<string, HostRecord> = {
    ticket: { id: 'ticket', at: '2026-10-01T09:00:00Z', owner: 'svc' },
    stale: { id: 'stale', at: '2026-10-01T10:00:00Z', owner: 'svc' },
    fresh: { id: 'fresh', at: '2026-10-01T13:00:00Z', owner: 'svc' },
  }
  const cite = (writer: Writer, id: string) => assertionFor(writer, { kind: 'record', id, at: T[id].at })
  const words: Message = { id: 'm9', role: 'subject', text: 'the cache is warm now', at: '2026-10-01T11:00:00Z' }
  const written = foldEntries([
    { type: 'EntryAdded', at: '2026-10-01T12:00:00Z', entry: draft('op', 'finding', 'soft', cite('operator', 'ticket')) },
    { type: 'EntryAdded', at: '2026-10-01T12:00:00Z', entry: { ...draft('rel', 'finding', 'soft', assertionFor('agent', { kind: 'message', id: 'm9' })), text: 'cache is warm now', relayed: true } },
  ])
  const ctx = (writer: Writer): ValidationContext => ({
    ...ctxFor(writer, { policy: soft, messages: [words], records: (id) => T[id], now: '2026-10-02T00:00:00Z' }),
    ...(writer === 'consolidation' ? { runId: 'r1' } : {}),
  })
  for (const writer of ['ingest', 'agent', 'consolidation'] as Writer[]) {
    it(`reject: ${writer} retires an operator's 12:00 entry on a 10:00 record`, () => {
      assertVerdict(validate(written, retire('op', cite(writer, 'stale')), ctx(writer)), 'reject', /older than what it answers/)
    })
    it(`propose: ${writer} retires the subject's relayed words`, () => {
      assertVerdict(validate(written, retire('rel', cite(writer, 'fresh')), ctx(writer)), 'propose', /said or confirmed/)
    })
    it(`propose: ${writer} supersedes the subject's relayed words`, () => {
      assertVerdict(validate(written, supersede('rel', draft('n1', 'finding', 'soft', cite(writer, 'fresh'))), ctx(writer)), 'propose', /said or confirmed/)
    })
  }
})
