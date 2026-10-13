import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, findEntry, foldEntries } from '../log/fold.ts'
import type { EntryOperation, EntryState, LogEvent } from '../log/types.ts'
import type { ValidationPolicy } from '../validation/validate.ts'
import { planWrite, type WriteRequest } from './plan.ts'

// planWrite is the write path without the store: each operation checked against
// the state the ones before it left, what to append in order, what a forget
// took, and the state to save. The store appends, rewrites and saves.

const policy: ValidationPolicy = {
  kinds: { fact: { mayBeHard: false }, limit: { mayBeHard: true } },
  maxTextLength: 200,
  stopwords: new Set(['the', 'and', 'for', 'with']),
  textRules: [],
  caps: { liveEntries: 20, addsPerMessage: 3, opsPerRun: 10 },
}
const AT = '2026-10-04T10:00:00Z'
const tap = { source: { kind: 'action', id: 'tap' } } as const

const add = (id: string, text: string, kind = 'fact'): Extract<EntryOperation, { type: 'EntryAdded' }> =>
  ({ type: 'EntryAdded', at: AT, entry: { id, kind, text, severity: kind === 'limit' ? 'hard' : 'soft', ...tap } })
const supersede = (old: string, id: string, text: string): EntryOperation =>
  ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry: { id, kind: 'fact', text, severity: 'soft', ...tap } })
const forget = (id: string): EntryOperation => ({ type: 'EntryRedacted', at: AT, id, ...tap })

function request(ops: EntryOperation[], extra: Partial<WriteRequest> = {}): WriteRequest {
  let n = 0
  return { policy, writer: 'subject-action', messages: [], now: AT, proposalId: () => `p${++n}`, ops, ...extra }
}

const kinds = (plan: { verdicts: { verdict: string }[] }) => plan.verdicts.map((v) => v.verdict)

describe('planWrite', () => {
  it('checks each operation against the state the ones before it left, and appends what it lets through, in order', () => {
    const plan = planWrite(emptyState, request([add('e1', 'Takes the train to work'), supersede('e1', 'e2', 'Cycles to work now')]))
    assert.deepEqual(kinds(plan), ['accept', 'accept'])
    assert.deepEqual(plan.append.map((a) => a.type), ['EntryAdded', 'EntrySuperseded'])
    assert.equal(findEntry(plan.state, 'e2')?.status, 'live')
    assert.deepEqual(foldEntries(plan.append.map((a) => a.payload as LogEvent)), plan.state)
  })

  it('appends nothing for a refused operation, and goes on with the rest', () => {
    const plan = planWrite(emptyState, request([add('e1', 'Takes the train'), add('e1', 'Takes the bus'), add('e2', 'Works from home on Fridays')]))
    assert.deepEqual(kinds(plan), ['accept', 'reject', 'accept'])
    assert.deepEqual(plan.append.map((a) => (a.payload as { entry: { id: string } }).entry.id), ['e1', 'e2'])
  })

  it('appends what it holds as a proposal', () => {
    const plan = planWrite(emptyState, request([add('e1', 'Never call after nine', 'limit')], { writer: 'operator' }))
    assert.deepEqual(kinds(plan), ['accept'])
    const held = planWrite(emptyState, request([add('e1', 'Never call after nine', 'limit')], { writer: 'operator', external: true }))
    assert.deepEqual([kinds(held), held.append.map((a) => a.type)], [['propose'], ['EntryProposed']])
  })

  it('puts the marker first, and every event carries only its type and payload: the dedupe key is the store\'s', () => {
    const marker = { type: 'DreamRun', payload: { runId: 'r1' } }
    // A dream write carries its dedupe key beside the ops; it stays with the caller.
    const dreamWrite = { ...request([add('e1', 'Takes the train'), add('e2', 'Works from home')], { marker }), dedupeKey: 'k1' }
    const marked = planWrite(emptyState, dreamWrite)
    assert.deepEqual(marked.append.map((a) => a.type), ['DreamRun', 'EntryAdded', 'EntryAdded'])
    assert.deepEqual(marked.append[0].payload, { runId: 'r1' })
    assert.ok(marked.append.every((a) => Object.keys(a).sort().join() === 'payload,type'))
  })

  it('appends the marker alone when nothing else goes through, and nothing at all without one', () => {
    const marker = { type: 'DreamRun', payload: {} }
    assert.deepEqual(planWrite(emptyState, request([], { marker })).append.map((a) => a.type), ['DreamRun'])
    assert.deepEqual(planWrite(emptyState, request([add('e1', 'Takes the train', 'unknown')])).append, [])
  })

  it('names what a forget took, from the state before it, and later operations see it forgotten', () => {
    const state = planWrite(emptyState, request([add('e1', 'Takes the train to work')])).state
    const plan = planWrite(state, request([forget('e1'), supersede('e1', 'e2', 'Cycles to work now')]))
    assert.deepEqual(kinds(plan), ['accept', 'reject'])
    assert.deepEqual(plan.forgets.map((f) => [f.id, f.wordings.map((w) => w.text)]), [['e1', ['Takes the train to work']]])
    assert.equal(findEntry(plan.state, 'e1')?.redacted, true)
    assert.deepEqual(plan.append.map((a) => a.type), ['EntryRedacted'])
  })

  it('submits what prepare makes of each operation, given the state the ones before it left', () => {
    const seen: number[] = []
    const prepare = (op: EntryOperation, state: EntryState): EntryOperation => {
      seen.push(state.entries.length)
      return op.type === 'EntryAdded' ? { ...op, entry: { ...op.entry, review: '2026-12-01' } } : op
    }
    const plan = planWrite(emptyState, request([add('e1', 'Takes the train'), add('e2', 'Works from home')], { prepare }))
    assert.deepEqual(seen, [0, 1])
    assert.deepEqual(plan.append.map((a) => (a.payload as { entry: { review?: string } }).entry.review), ['2026-12-01', '2026-12-01'])
  })

  it('leaves the state it was given as it was', () => {
    const state = planWrite(emptyState, request([add('e1', 'Takes the train to work')])).state
    const before = structuredClone(state)
    planWrite(state, request([forget('e1'), add('e2', 'Cycles')]))
    assert.deepEqual(state, before)
  })
})

describe('planWrite after a forget it did not see', () => {
  // The pass planned from `base`; the subject forgot e1, e8, e9, e10 and e11 while it ran.
  const base: EntryState = planWrite(emptyState, request([
    add('e1', 'Allergic to sesame oil'), add('e9', 'Tea'), add('e8', 'Night shifts'), add('e10', 'Ate pie'),
    add('e11', 'The oil'), add('e5', 'Prefers window seats'),
  ])).state
  const now = planWrite(base, request(['e1', 'e9', 'e8', 'e10', 'e11'].map(forget))).state
  const MEANWHILE = { verdict: 'reject', reason: 'its words were forgotten while the pass ran' }

  it('refuses an operation that brings a forgotten wording back, quoted anywhere in its words', () => {
    const plan = planWrite(now, request([add('e2', 'Follow up: allergic to sesame oil, still?')], { base }))
    assert.deepEqual(plan.verdicts, [{ verdict: 'reject', reason: 'its words were forgotten while the pass ran' }])
    assert.deepEqual(plan.append, [])
  })

  it('matches whole words only, and lets a wording too short to recognise guard nothing', () => {
    const plan = planWrite(now, request([add('e2', 'Allergic to sesame oils from the market'), add('e3', 'Tea is fine')], { base }))
    assert.deepEqual(kinds(plan), ['accept', 'accept'])
  })

  it('refuses a proposal whose add quotes the words, as the periodic review writes one', () => {
    const proposed: EntryOperation = { type: 'EntryProposed', at: AT, id: 'p-r', reason: 'asked', op: add('e2', 'Still allergic to sesame oil?') }
    assert.deepEqual(planWrite(now, request([proposed], { base })).verdicts, [MEANWHILE])
  })

  it('refuses a reason that quotes the words, on a retire or a proposal', () => {
    const retire: EntryOperation = { type: 'EntryRetired', at: AT, id: 'e5', reason: 'allergic to sesame oil, so aisle', ...tap }
    const proposed: EntryOperation = { type: 'EntryProposed', at: AT, id: 'p-r', reason: 'because of the sesame oil allergy? allergic to sesame oil', op: add('e2', 'Prefers aisle seats') }
    assert.deepEqual(planWrite(now, request([retire, proposed], { base })).verdicts, [MEANWHILE, MEANWHILE])
  })

  it('guards a wording of exactly two content words, and one of two only by the policy\'s stopwords does not', () => {
    const plan = planWrite(now, request([add('e2', 'Works night shifts again'), add('e3', 'The oil smell is gone')], { base }))
    assert.deepEqual(plan.verdicts[0], MEANWHILE)
    assert.equal(plan.verdicts[1].verdict, 'accept')
  })

  it('needs a word boundary on both sides: a forgotten "ate pie" is not inside "grate pie"', () => {
    const plan = planWrite(now, request([add('e2', 'Grate pie crust thinly'), add('e3', 'Ate pie at the fair')], { base }))
    assert.deepEqual([plan.verdicts[0].verdict, plan.verdicts[1]], ['accept', MEANWHILE])
  })

  it('runs before the validator: an operation it would refuse anyway is refused for the forgotten words', () => {
    const plan = planWrite(now, request([add('e2', 'Allergic to sesame oil', 'unknown-kind')], { base }))
    assert.deepEqual(plan.verdicts, [MEANWHILE])
  })

  it('leaves text far over the cap to the validator, unread: the cap refuses it, not the forgotten words', () => {
    const plan = planWrite(now, request([add('e2', `allergic to sesame oil ${'x'.repeat(1_000)}`)], { base }))
    assert.deepEqual(plan.verdicts, [{ verdict: 'reject', reason: 'over the 200-character cap' }])
  })

  it('treats a retire during the pass as no forget: the retired entry\'s words may come back', () => {
    const before = planWrite(emptyState, request([add('r1', 'Cycles along the river')])).state
    const after = planWrite(before, request([{ type: 'EntryRetired', at: AT, id: 'r1', reason: 'moved away', ...tap }])).state
    assert.deepEqual(kinds(planWrite(after, request([add('r2', 'Cycles along the river again')], { base: before }))), ['accept'])
  })

  it('guards nothing without a base', () => {
    assert.deepEqual(kinds(planWrite(now, request([add('e2', 'Allergic to sesame oil')]))), ['accept'])
  })

  it('refuses a follow-up of a forgotten entry by its name, whatever its words, and the entry a forgotten follow-up followed', () => {
    const plan = planWrite(now, request([add('fu-e1', 'How did it go?')]))
    assert.deepEqual(plan.verdicts, [{ verdict: 'reject', reason: 'the entry it follows was forgotten' }])
    const followed = planWrite(emptyState, request([add('fu-e5', 'How did it go?'), forget('fu-e5'), add('e5', 'Dentist on Monday')]))
    assert.deepEqual(kinds(followed), ['accept', 'accept', 'reject'])
  })
})
