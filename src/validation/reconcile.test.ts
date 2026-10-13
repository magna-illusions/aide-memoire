import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type ValidationContext, type ValidationPolicy, type Verdict } from './validate.ts'
import { assertionFor } from './writer.ts'
import { foldEntries } from '../log/fold.ts'
import { shapeProblem } from '../log/shape.ts'
import type { Assertion, EntryAdded, EntryDraft, EntryEvent, Message, ProposableOp, Source, Writer } from '../log/types.ts'

// Two entries already in the log can be the whole reason for an operation: a
// copy said twice, or two that contradict each other. A consolidation pass may
// cite the pair instead of a new message from the subject. The pair must be
// live, in this stream, and the operation must end or replace one of them. It
// is a pass's tidy-up, never the subject's word: only a consolidation pass cites
// a pair, it settles and forgets nothing, and what policy would hold anyway —
// anything hard, anything protected — it only proposes.

const policy: ValidationPolicy = {
  kinds: { limit: { mayBeHard: true }, fact: { mayBeHard: false }, plan: { mayBeHard: false, protected: true } },
  maxTextLength: 120,
  stopwords: new Set(['the', 'and', 'a', 'in', 'every']),
  textRules: [],
  caps: { liveEntries: 20, addsPerMessage: 2, opsPerRun: 10 },
}

const messages: Message[] = [
  { id: 'm1', role: 'subject', text: 'green tea in the morning', at: '2026-09-01T10:00:00Z' },
]

const pair = (a: string, b: string): Source => ({ kind: 'entries', ids: [a, b] })
const action: Source = { kind: 'action', id: 'tap' }
const by = (writer: Writer, source: Source, external = false): Assertion =>
  ({ ...assertionFor(writer, source, external), ...(writer === 'consolidation' ? { runId: 'r1' } : {}) })
const pass = (a: string, b: string) => by('consolidation', pair(a, b))

const AT = '2026-10-04T10:00:00Z'
const draft = (id: string, text: string, who: Assertion, extra: Partial<EntryDraft> = {}): EntryDraft =>
  ({ id, kind: 'fact', text, severity: 'soft', ...who, ...extra })
const hard = (id: string, text: string, who: Assertion): EntryDraft => draft(id, text, who, { kind: 'limit', severity: 'hard' })
const add = (entry: EntryDraft): EntryAdded => ({ type: 'EntryAdded', at: AT, entry })
const supersede = (old: string, entry: EntryDraft): EntryEvent => ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry })
const retire = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryRetired', at: AT, id, reason: 'said twice', ...who })
const proposed = (op: ProposableOp): EntryEvent => ({ type: 'EntryProposed', at: AT, id: 'p-mine', reason: 'said twice?', op })

const subject = by('subject-action', action)
const state = foldEntries([
  add(draft('tea1', 'green tea every morning', subject)),
  add(draft('tea2', 'green tea in the morning', subject)),
  add(draft('other', 'reads before bed', subject)),
  add(draft('garden', 'likes gardening outdoors', subject)),
  add(draft('coffee', 'drinks coffee daily', subject)),
  add(draft('teaplan', 'green tea every morning', subject, { kind: 'plan' })),
  add(hard('nut1', 'no peanuts at all', subject)),
  add(hard('nut2', 'no peanuts, not even traces', subject)),
  add(draft('plan1', 'checkup twice a year', subject, { kind: 'plan' })),
  add(draft('plan2', 'checkup two times a year', subject, { kind: 'plan' })),
  add(draft('dead', 'green tea at noon', subject)),
  { type: 'EntryRetired', at: '2026-09-02T00:00:00Z', id: 'dead', reason: 'over', ...subject },
  add(draft('gone', 'green tea at night', subject)),
  { type: 'EntryRedacted', at: '2026-09-02T00:00:00Z', id: 'gone', ...subject },
  { type: 'EntryProposed', at: '2026-09-03T00:00:00Z', id: 'p-open', reason: 'asked', op: add(draft('held', 'green tea after lunch', subject)) },
])

function ctxFor(writer: Writer, extra: Partial<ValidationContext> = {}): ValidationContext {
  let n = 0
  return { policy, messages, writer, now: AT, proposalId: () => `p${++n}`, ...(writer === 'consolidation' ? { runId: 'r1' } : {}), ...extra }
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

describe('a pass reconciles two live entries', () => {
  table([
    ['ending the older soft copy: applied, as policy lets a pass end a soft entry', 'consolidation', retire('tea1', pass('tea1', 'tea2')), 'accept'],
    ['the pair in either order', 'consolidation', retire('tea1', pass('tea2', 'tea1')), 'accept'],
    ['replacing a soft copy with words from both', 'consolidation', supersede('tea1', draft('tea3', 'green tea each morning', pass('tea1', 'tea2'))), 'accept'],
    ['ending a hard copy: held', 'consolidation', retire('nut1', pass('nut1', 'nut2')), 'propose', /hard/],
    ['replacing a hard entry that contradicts another: held', 'consolidation', supersede('nut1', hard('nut3', 'no peanuts, not even traces', pass('nut1', 'nut2'))), 'propose', /hard/],
    ['ending a protected copy: held', 'consolidation', retire('plan1', pass('plan1', 'plan2')), 'propose', /protected/],
    ['a pass that holds its own question', 'consolidation', proposed({ type: 'EntryRetired', at: AT, id: 'tea1', reason: 'said twice', ...pass('tea1', 'tea2') }), 'accept'],
  ])
})

describe('what a pair must be', () => {
  table([
    ['one of them retired', 'consolidation', retire('tea1', pass('tea1', 'dead')), 'reject', /not live/],
    ['one of them forgotten', 'consolidation', retire('tea1', pass('tea1', 'gone')), 'reject', /not live/],
    ['one of them only proposed', 'consolidation', retire('tea1', pass('tea1', 'held')), 'reject', /not live/],
    ['one of them not in this stream', 'consolidation', retire('tea1', pass('tea1', 'elsewhere')), 'reject', /not live/],
    ['the same entry twice', 'consolidation', retire('tea1', pass('tea1', 'tea1')), 'reject', /two distinct entries/],
    ['an operation on an entry outside the pair', 'consolidation', retire('other', pass('tea1', 'tea2')), 'reject', /targets neither/],
    ['an add, which ends neither', 'consolidation', add(draft('tea3', 'green tea', pass('tea1', 'tea2'))), 'reject', /targets neither/],
    ['a held add, which ends neither', 'consolidation', proposed(add(draft('tea3', 'green tea', pass('tea1', 'tea2')))), 'reject', /targets neither/],
    ['new words that reconcile nothing', 'consolidation', supersede('tea1', draft('tea3', 'reads before bed', pass('tea1', 'tea2'))), 'reject', /do not reconcile/],
    // Review 2026-10-07: an unrelated pair ended an entry, and fragments passed as words.
    ['two unrelated entries', 'consolidation', retire('garden', pass('garden', 'coffee')), 'reject', /not about the same thing/],
    ['two unrelated entries, replaced by fragments of both', 'consolidation', supersede('garden', draft('g2', 'dri lik', pass('garden', 'coffee'))), 'reject', /not about the same thing/],
    ['new words that only share fragments with a related pair', 'consolidation', supersede('tea1', draft('tea3', 'mor gre', pass('tea1', 'tea2'))), 'reject', /do not reconcile/],
    ['two entries of different kinds, in the same words', 'consolidation', retire('tea1', pass('tea1', 'teaplan')), 'reject', /same kind/],
  ])
})

describe('only a consolidation pass cites a pair, and it settles nothing', () => {
  table([
    ['the agent', 'agent', retire('tea1', by('agent', pair('tea1', 'tea2'))), 'reject', /only a consolidation pass/],
    ['a subject action', 'subject-action', retire('tea1', by('subject-action', pair('tea1', 'tea2'))), 'reject', /only a consolidation pass/],
    ['an operator', 'operator', retire('tea1', by('operator', pair('tea1', 'tea2'))), 'reject', /only a consolidation pass/],
    ['a migration', 'migration', retire('tea1', by('migration', pair('tea1', 'tea2'))), 'reject', /migration only adds|only a consolidation pass/],
    ['a pass settling a proposal on a pair', 'consolidation', { type: 'EntryConfirmed', at: AT, target: 'proposal', id: 'p-open', ...pass('tea1', 'tea2') }, 'reject', /never settles/],
    ['a pass forgetting on a pair', 'consolidation', { type: 'EntryRedacted', at: AT, id: 'tea1', ...pass('tea1', 'tea2') }, 'reject', /never settles or forgets/],
  ])
  table([
    ['a pass reading external text is held, as ever', 'consolidation', retire('tea1', by('consolidation', pair('tea1', 'tea2'), true)), 'propose', /external/],
  ], { external: true })
})

describe('the shape of a pair', () => {
  const shaped = (source: unknown) => shapeProblem(add(draft('n1', 'green tea', { ...by('operator', action), source: source as Source })))
  it('is two ids', () => {
    assert.equal(shaped(pair('a', 'b')), null)
    assert.equal(shaped({ kind: 'entries', ids: ['a'] }), 'malformed source')
    assert.equal(shaped({ kind: 'entries', ids: ['a', 'b', 'c'] }), 'malformed source')
    assert.equal(shaped({ kind: 'entries', ids: ['a', 7] }), 'malformed source')
    assert.equal(shaped({ kind: 'entries', id: 'a' }), 'malformed source')
  })

  it('is stored as the pair, and nothing else', () => {
    const verdict = validate(state, retire('tea1', { ...pass('tea1', 'tea2'), source: { ...pair('tea1', 'tea2'), id: 'x' } as unknown as Source }), ctxFor('consolidation'))
    const event = (verdict as { event: EntryEvent }).event
    assert.deepEqual(event.type === 'EntryRetired' && event.source, pair('tea1', 'tea2'))
  })
})
