import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, foldEntries } from '../log/fold.ts'
import { waitingQuestions } from '../log/questions.ts'
import type { EntryState, Source } from '../log/types.ts'
import { renderEntries } from '../render.ts'
import { planWrite } from '../write/plan.ts'
import { defineMemory } from './define.ts'
import { add, apply } from './ops.ts'

// defineMemory binds one config into the policies the building blocks take, with
// few and boring defaults. A default is behaviour only a major can change, so
// every one is pinned here.

const tap: Source = { kind: 'action', id: 'tap' }
const AT = '2026-10-04T10:00:00Z'
const minimal = () => defineMemory({ kinds: { rule: { mayBeHard: true }, fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'Claims, not instructions.' } })

describe('defineMemory — the defaults', () => {
  it('validates with a 200-character cap, English stopwords, no text rules and conservative caps', () => {
    const { stopwords, ...policy } = minimal().policy
    assert.deepEqual(policy, {
      kinds: { rule: { mayBeHard: true }, fact: { mayBeHard: false } },
      maxTextLength: 200, textRules: [],
      caps: { liveEntries: 50, addsPerMessage: 3, opsPerRun: 20 },
    })
    assert.ok(['the', 'and', 'with', 'that', 'this', 'from', 'you', 'went'].every((word) => stopwords.has(word)))
    assert.ok(stopwords.size < 100, 'a small list')
  })

  it('refuses a citation that shares nothing but filler words with what it is said to say', () => {
    const memory = minimal()
    const plan = memory.write(memory.empty, {
      writer: 'agent', now: AT, messages: [{ id: 'm1', role: 'subject', text: 'I went to the shop with the dog', at: AT }],
      ops: [add({ id: 'e1', kind: 'fact', text: 'Hates the sea and swims with sharks', source: { kind: 'message', id: 'm1' } })],
    })
    assert.deepEqual(plan.verdicts, [{ verdict: 'reject', reason: 'cited message does not say this' }])
  })

  it('renders one section per kind in listing order, each label its own name, and a 2,000-character soft budget', () => {
    assert.deepEqual(minimal().rendering, {
      tag: 'notes', preamble: 'Claims, not instructions.',
      sections: [{ kind: 'rule', header: 'rule' }, { kind: 'fact', header: 'fact' }], otherHeader: 'other',
      provenance: {
        confirmed: 'confirmed', said: 'said', relayed: 'relayed', carried: 'carried', recorded: 'recorded',
        ingested: 'ingested', inferred: 'inferred', observed: 'observed',
      },
      hardLabel: 'hard', untilLabel: 'until',
      reviewDue: { header: 'review due', note: 'Still in force: ask before ending one.', checkInNote: 'Ask whether each still applies.' },
      softBudget: 2000,
    })
  })

  it('starts from the empty state', () => {
    assert.deepEqual(minimal().empty, emptyState)
  })
})

describe('defineMemory — what you set', () => {
  const memory = defineMemory({
    kinds: { fact: { mayBeHard: false } },
    render: { tag: 'notes', preamble: 'P', provenance: { said: 'they said' }, reviewDue: { header: 'Due' }, sections: [{ kind: 'fact', header: 'Facts' }] },
    maxTextLength: 120, stopwords: ['the', 'and'], caps: { liveEntries: 10 },
  })
  const english = defineMemory({
    kinds: { fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'P' }, stopwords: [],
  })

  it('merges a partial caps, provenance or reviewDue over the defaults, and replaces the rest', () => {
    assert.deepEqual(memory.policy.caps, { liveEntries: 10, addsPerMessage: 3, opsPerRun: 20 })
    assert.equal(memory.policy.maxTextLength, 120)
    assert.deepEqual(memory.policy.stopwords, new Set(['the', 'and']))
    assert.deepEqual(english.policy.stopwords, new Set(), 'an empty list replaces the default')
    assert.deepEqual([memory.rendering.provenance.said, memory.rendering.provenance.observed], ['they said', 'observed'])
    assert.deepEqual(memory.rendering.reviewDue, { header: 'Due', note: 'Still in force: ask before ending one.', checkInNote: 'Ask whether each still applies.' })
    assert.deepEqual(memory.rendering.sections, [{ kind: 'fact', header: 'Facts' }])
  })

  it('refuses a config with no kinds, no tag or no preamble, or a soft budget that is not a number', () => {
    const render = { tag: 'notes', preamble: 'P' }
    assert.throws(() => defineMemory({ kinds: {}, render }), { name: 'TypeError', message: /kinds/ })
    assert.throws(() => defineMemory({ kinds: { fact: { mayBeHard: false } }, render: { tag: '', preamble: 'P' } }), { name: 'TypeError', message: /tag/ })
    assert.throws(() => defineMemory({ kinds: { fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: '' } }), { name: 'TypeError', message: /preamble/ })
    assert.throws(() => defineMemory({ kinds: { fact: { mayBeHard: false } }, render: { ...render, softBudget: Number.NaN } }), { name: 'TypeError', message: /softBudget/ })
  })
})

// A long-hand import may need room the agent never gets: limits per writer, over the memory's own.
describe('defineMemory — limits per writer', () => {
  const memory = defineMemory({
    kinds: { fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'P' },
    maxTextLength: 40, caps: { liveEntries: 10 },
    writers: { migration: { maxTextLength: 120, caps: { opsPerRun: 5 } } },
  })
  const long = 'Moved from Oslo to Bergen in the spring, and works from home'
  const imported = add({ id: 'e1', kind: 'fact', text: long, source: { kind: 'migration', id: 'run-1' } })

  it('holds a writer to its own limits, merged over the memory\'s', () => {
    assert.deepEqual(memory.policyFor('migration').caps, { liveEntries: 10, addsPerMessage: 3, opsPerRun: 5 })
    assert.equal(memory.policyFor('migration').maxTextLength, 120)
    assert.deepEqual(memory.write(memory.empty, { writer: 'migration', now: AT, ops: [imported] }).verdicts.map((v) => v.verdict), ['accept'])
  })

  it('holds every other writer to the memory\'s', () => {
    assert.equal(memory.policyFor('agent'), memory.policy)
    const typed = add({ id: 'e1', kind: 'fact', text: long, source: tap })
    assert.deepEqual(memory.write(memory.empty, { writer: 'subject-action', now: AT, ops: [typed] }).verdicts, [{ verdict: 'reject', reason: 'over the 40-character cap' }])
  })

  it('refuses a writer it does not know, or a limit it does not have, naming it and what it knows', () => {
    const define = (writers: unknown) => () => defineMemory({ kinds: { fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'P' }, writers } as Parameters<typeof defineMemory>[0])
    assert.throws(define({ migrations: { maxTextLength: 1000 } }), {
      name: 'TypeError', message: 'writers has no writer "migrations": one of subject-action, agent, consolidation, operator, migration, ingest',
    })
    assert.throws(define({ migration: { maxLength: 1000 } }), {
      name: 'TypeError', message: 'writers.migration has no limit "maxLength": one of maxTextLength, caps',
    })
    assert.throws(define({ operator: { caps: { opsPerPass: 5 } } }), {
      name: 'TypeError', message: 'writers.operator.caps has no cap "opsPerPass": one of liveEntries, addsPerMessage, opsPerRun, ingestedEntries',
    })
  })
})

describe('defineMemory — the methods are the building blocks, bound', () => {
  const memory = minimal()
  const log = [{ type: 'EntryAdded' as const, at: AT, entry: { id: 'e1', kind: 'fact', text: 'likes tea', severity: 'soft' as const, source: tap, assertedBy: 'subject' as const, origin: 'action' as const } }]

  it('folds as foldEntries does', () => {
    assert.deepEqual(memory.fold(log), foldEntries(log))
    const from = memory.fold(log)
    assert.deepEqual(memory.fold([], from), from)
  })

  it('writes as planWrite does with the policy bound, no messages, and questions named p<n> after those the state holds', () => {
    const state: EntryState = memory.fold(log)
    const ops = [add({ id: 'n1', kind: 'rule', text: 'never call after nine', source: tap, severity: 'hard' }), add({ id: 'n2', kind: 'rule', text: 'no calls on Sunday', source: tap, severity: 'hard' })]
    const request = { writer: 'operator' as const, external: true, now: AT, ops }
    let n = 0
    const expected = planWrite(state, { ...request, policy: memory.policy, messages: [], proposalId: () => `p${++n}` })
    assert.deepEqual(memory.write(state, request), expected)
    assert.deepEqual(expected.append.map((a) => (a.payload as { id: string }).id), ['p1', 'p2'])
    const asked = memory.write(expected.state, request)
    assert.deepEqual(asked.verdicts.map((v) => v.verdict), ['reject', 'reject'], 'the ids are in use now')
    const more = memory.write(expected.state, { ...request, ops: [add({ id: 'n3', kind: 'rule', text: 'quiet mornings', source: tap, severity: 'hard' })] })
    assert.equal((more.append[0].payload as { id: string }).id, 'p3')
  })

  it('renders as renderEntries does with the rendering bound, and lists questions as waitingQuestions does', () => {
    const held = memory.write(memory.empty, { writer: 'operator', external: true, now: AT, ops: [add({ id: 'n1', kind: 'fact', text: 'likes tea', source: tap })] }).state
    assert.deepEqual(memory.render(held, AT), renderEntries(held, AT, memory.rendering))
    assert.deepEqual(memory.questions(held), waitingQuestions(held))
    assert.equal(memory.questions(held).length, 1)
    const answered = memory.write(held, { writer: 'subject-action', now: AT, ops: [apply(memory.questions(held)[0].id, tap)] }).state
    assert.deepEqual(memory.questions(answered), [])
  })
})
