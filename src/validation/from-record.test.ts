import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type KindRule, type ValidationContext, type ValidationPolicy, type Verdict } from './validate.ts'
import { assertionFor } from './writer.ts'
import { applyEntryEvent, findEntry, foldEntries } from '../log/fold.ts'
import { provenance, renderEntries, type RenderPolicy } from '../render.ts'
import type { Assertion, EntryDraft, EntryEvent, HostRecord, Message, Source, Writer } from '../log/types.ts'

// What the agent or a consolidation pass builds on a host record is held by
// default (`fromRecord: 'hold'`). A kind may take records softly
// (`fromRecord: 'soft'`): a soft operation resting on a record then applies. A
// hard one is still held, always: the validator never reads what a record says,
// so an agent allowed to write hard on one could pin any real record to any
// conclusion.

const kinds: Record<string, KindRule> = {
  limit: { mayBeHard: true },
  fact: { mayBeHard: false },
  'soft-limit': { mayBeHard: true, fromRecord: 'soft' },
  'soft-fact': { mayBeHard: false, fromRecord: 'soft' },
  'kept-fact': { mayBeHard: false, fromRecord: 'soft', protected: true },
}

const policy: ValidationPolicy = {
  kinds, maxTextLength: 120, stopwords: new Set(['the', 'and', 'a']), textRules: [],
  caps: { liveEntries: 10, addsPerMessage: 3, opsPerRun: 20 },
}

const messages: Message[] = [
  { id: 'm1', role: 'subject', text: 'queue depth is fine again', at: '2026-10-03T10:00:00Z' },
]

const RECORDS: Record<string, HostRecord> = {
  'r-new': { id: 'r-new', at: '2026-10-02T08:00:00Z', owner: 'u1' },
  'r-old': { id: 'r-old', at: '2026-08-01T08:00:00Z', owner: 'u1' },
}
const records = (id: string): HostRecord | undefined => (Object.hasOwn(RECORDS, id) ? RECORDS[id] : undefined)

const record = (id: string): Source => ({ kind: 'record', id, at: '2026-10-02T08:00:00Z' })
const by = (writer: Writer, source: Source): Assertion => ({ ...assertionFor(writer, source), ...(writer === 'consolidation' ? { runId: 'r1' } : {}) })
const subject = by('subject-action', { kind: 'action', id: 'tap' })
const operator = by('operator', { kind: 'action', id: 'script' })

const AT = '2026-10-04T10:00:00Z'
const draft = (id: string, kind: string, severity: 'soft' | 'hard', who: Assertion): EntryDraft =>
  ({ id, kind, text: 'queue depth above limit', severity, ...who })
const add = (entry: EntryDraft): EntryEvent => ({ type: 'EntryAdded', at: AT, entry })
const supersede = (old: string, entry: EntryDraft): EntryEvent => ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry })
const retire = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryRetired', at: AT, id, reason: 'over', ...who })

// One live entry per kind and severity the matrix changes, written before the
// records by an operator; then one the subject said, and one they confirmed.
const state = foldEntries([
  ...[
    ['soft-fact', 'soft-fact', 'soft'], ['soft-limit-hard', 'soft-limit', 'hard'], ['soft-limit-soft', 'soft-limit', 'soft'],
    ['fact', 'fact', 'soft'], ['kept', 'kept-fact', 'soft'], ['confirmed', 'soft-fact', 'soft'],
  ].map(([id, kind, severity]): EntryEvent => ({ type: 'EntryAdded', at: '2026-09-01T10:00:00Z', entry: draft(id, kind, severity as 'soft' | 'hard', operator) })),
  { type: 'EntryAdded', at: '2026-09-01T10:00:00Z', entry: draft('said', 'soft-fact', 'soft', subject) },
  { type: 'EntryConfirmed', at: '2026-09-02T10:00:00Z', target: 'entry', id: 'confirmed', ...subject },
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

const on = (writer: Writer, id = 'r-new') => by(writer, record(id))

describe('fromRecord × writer × severity', () => {
  for (const writer of ['agent', 'consolidation'] as Writer[]) {
    table([
      [`hold, ${writer}, soft`, writer, add(draft('n1', 'fact', 'soft', on(writer))), 'propose', /rests on a host record/],
      [`hold, ${writer}, hard`, writer, add(draft('n1', 'limit', 'hard', on(writer))), 'propose', /rests on a host record/],
      [`soft, ${writer}, soft`, writer, add(draft('n1', 'soft-fact', 'soft', on(writer))), 'accept'],
      [`soft, ${writer}, hard`, writer, add(draft('n1', 'soft-limit', 'hard', on(writer))), 'propose', /hard/],
      [`soft, ${writer}, a soft supersede of a soft entry on a newer record`, writer, supersede('soft-fact', draft('n1', 'soft-fact', 'soft', on(writer))), 'accept'],
      [`soft, ${writer}, a soft retire of a soft entry on a newer record`, writer, retire('soft-fact', on(writer)), 'accept'],
      [`soft, ${writer}, a soft entry replacing a hard one`, writer, supersede('soft-limit-hard', draft('n1', 'soft-limit', 'soft', on(writer))), 'propose', /hard/],
      [`soft, ${writer}, a retire of a hard entry`, writer, retire('soft-limit-hard', on(writer)), 'propose', /hard/],
      [`soft, ${writer}, a soft entry replaced on a record older than it`, writer, supersede('soft-fact', draft('n1', 'soft-fact', 'soft', on(writer, 'r-old'))), 'reject', /older than what it answers/],
      [`soft, ${writer}, a soft entry retired on a record older than it`, writer, retire('soft-limit-soft', on(writer, 'r-old')), 'reject', /older than what it answers/],
    ])
  }

  table([
    ['soft, a pass changing a protected kind is still only a proposal', 'consolidation', retire('kept', on('consolidation')), 'propose', /protected/],
    ['soft, the agent settles nothing on a record', 'agent', { type: 'EntryConfirmed', at: AT, target: 'entry', id: 'soft-fact', ...on('agent') }, 'reject', /never settles or forgets/],
    ['soft, the agent forgets nothing on a record', 'agent', { type: 'EntryRedacted', at: AT, id: 'soft-fact', ...on('agent') }, 'reject', /never settles or forgets/],
    ['soft, a hard entry on a kind that may not be hard', 'agent', add(draft('n1', 'soft-fact', 'hard', on('agent'))), 'reject', /may not be hard/],
  ])
  table([
    ['soft, external text is held whatever the kind says', 'agent', add(draft('n1', 'soft-fact', 'soft', { ...assertionFor('agent', record('r-new'), true) })), 'propose', /external/],
  ], { external: true })
})

// A record is checked for its owner and time, never for what it says, so a soft
// rule would let the agent end the subject's own words on any newer record.
describe('fromRecord soft never ends what the subject said or confirmed', () => {
  for (const writer of ['agent', 'consolidation'] as Writer[]) {
    table([
      [`${writer} retires the subject's soft entry on an unrelated record`, writer, retire('said', on(writer)), 'propose', /said or confirmed/],
      [`${writer} supersedes the subject's soft entry`, writer, supersede('said', draft('n1', 'soft-fact', 'soft', on(writer))), 'propose', /said or confirmed/],
      [`${writer} retires an entry the subject confirmed`, writer, retire('confirmed', on(writer)), 'propose', /said or confirmed/],
    ])
  }
})

describe('fromRecord accepts only soft', () => {
  const loose = (rule: unknown): ValidationContext => ctxFor('agent', { policy: { ...policy, kinds: { ...kinds, fact: { mayBeHard: false, fromRecord: rule } as KindRule } } })
  for (const rule of ['any', 'SOFT', true, 1]) {
    it(`holds a soft entry on a record when fromRecord is ${JSON.stringify(rule)}`, () => {
      assertVerdict(validate(state, add(draft('n1', 'fact', 'soft', on('agent'))), loose(rule)), 'propose', /rests on a host record/)
    })
  }
})

// A policy that never names fromRecord must decide every
// operation exactly as one that says 'hold'.
describe('the default is hold', () => {
  const explicit = (writer: Writer): ValidationContext => ctxFor(writer, {
    policy: { ...policy, kinds: { ...kinds, fact: { mayBeHard: false, fromRecord: 'hold' }, limit: { mayBeHard: true, fromRecord: 'hold' } } },
  })
  const ops: [Writer, EntryEvent][] = (['agent', 'consolidation', 'operator', 'subject-action'] as Writer[]).flatMap((w) => [
    [w, add(draft('n1', 'fact', 'soft', on(w)))],
    [w, add(draft('n1', 'limit', 'hard', on(w)))],
    [w, supersede('fact', draft('n1', 'fact', 'soft', on(w)))],
    [w, supersede('fact', draft('n1', 'fact', 'soft', on(w, 'r-old')))],
    [w, retire('fact', on(w))],
    [w, retire('fact', on(w, 'r-old'))],
    [w, add(draft('n1', 'fact', 'soft', by(w, { kind: 'message', id: 'm1' })))],
  ] as [Writer, EntryEvent][])
  it('decides every operation as an explicit hold does', () => {
    for (const [writer, op] of ops) {
      assert.deepEqual(validate(state, op, ctxFor(writer)), validate(state, op, explicit(writer)), `${writer} ${op.type}`)
    }
  })
})

// What the agent built on a record and nobody confirmed is its inference, not
// evidence: it reads and ranks with what it observed, below the record itself.
describe('what the agent built on a record reads as inferred', () => {
  const applied = (writer: Writer) => {
    const verdict = validate(state, add(draft('n1', 'soft-fact', 'soft', on(writer))), ctxFor(writer))
    return applyEntryEvent(state, (verdict as { event: EntryEvent }).event)
  }
  const base: RenderPolicy = {
    tag: 'm', preamble: 'Claims.', sections: [], otherHeader: 'Entries',
    provenance: { confirmed: 'confirmed', said: 'said', relayed: 'relayed', observed: 'agent concluded', carried: 'carried', recorded: 'on record' },
    hardLabel: 'hard', untilLabel: 'until', reviewDue: { header: 'Review', note: 'Ask.', checkInNote: 'Check.' }, softBudget: 4000,
  }
  const lineOf = (from: typeof state, labels: Partial<RenderPolicy['provenance']> = {}) =>
    renderEntries(from, AT, { ...base, provenance: { ...base.provenance, ...labels } }).text.split('\n').find((l) => l.includes('2026-10-04'))

  it('is inferred, from the agent or a pass', () => {
    assert.equal(provenance(findEntry(applied('agent'), 'n1')!), 'inferred')
    assert.equal(provenance(findEntry(applied('consolidation'), 'n1')!), 'inferred')
  })

  it('reads with its own label, else the observed one, never the recorded one', () => {
    assert.match(lineOf(applied('agent'), { inferred: 'agent, on a record' }) ?? '', /· agent, on a record\]/)
    assert.match(lineOf(applied('agent')) ?? '', /· agent concluded\]/)
  })

  it('is recorded when an operator wrote it, and confirmed once the subject confirms it', () => {
    const byOperator = applyEntryEvent(state, { type: 'EntryAdded', at: AT, entry: draft('n2', 'soft-fact', 'soft', on('operator')) })
    assert.equal(provenance(findEntry(byOperator, 'n2')!), 'recorded')
    const confirmed = applyEntryEvent(applied('agent'), { type: 'EntryConfirmed', at: AT, target: 'entry', id: 'n1', ...subject })
    assert.equal(provenance(findEntry(confirmed, 'n1')!), 'confirmed')
  })

  it('ranks with what the agent observed: below the subject\'s words and machine evidence', () => {
    const line = (lineOf(applied('agent')) ?? '').length + 1
    const fill = (drafts: EntryDraft[]) => renderEntries(foldEntries(drafts.map(add)), AT, { ...base, softBudget: line }).omitted
    const inferredDraft = draft('i', 'soft-fact', 'soft', on('agent'))
    assert.deepEqual(fill([inferredDraft, draft('s', 'soft-fact', 'soft', subject)]), ['i'])
    assert.deepEqual(fill([inferredDraft, draft('h', 'soft-fact', 'soft', assertionFor('ingest', record('r-new')))]), ['i'])
  })
})
