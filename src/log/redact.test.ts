import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tombstoneRedacted, wordingsForgottenBy } from './redact.ts'
import { foldEntries, findEntry } from './fold.ts'
import type { Assertion, EntryEvent } from './types.ts'

const said: Assertion = { source: { kind: 'message', id: 'm1' }, assertedBy: 'subject', origin: 'conversation' }
const draft = (id: string, text: string) => ({ id, kind: 'fact', text, severity: 'soft' as const, ...said })

const history: EntryEvent[] = [
  { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: draft('e1', 'moving house in May') },
  { type: 'EntrySuperseded', at: '2026-09-02T00:00:00Z', supersedes: 'e1', entry: draft('e2', 'moving house in June') },
  { type: 'EntryRetired', at: '2026-09-03T00:00:00Z', id: 'e2', reason: 'moved to June, done now', ...said },
  { type: 'EntryAdded', at: '2026-09-04T00:00:00Z', entry: draft('e3', 'likes mornings') },
  { type: 'EntryRedacted', at: '2026-09-05T00:00:00Z', id: 'e2', ...said },
]

describe('tombstoneRedacted — forgetting one entry, keeping the log', () => {
  it('no redact leaves the log exactly as it was', () => {
    assert.deepEqual(tombstoneRedacted(history.slice(0, 4)), history.slice(0, 4))
  })

  it('the redacted entry\'s words, and those of the entries it replaced, leave every event', () => {
    const out = JSON.stringify(tombstoneRedacted(history))
    assert.ok(!out.includes('moving house'))
    assert.ok(!out.includes('done now'))
  })

  it('keeps every event, its type, its time and its order', () => {
    const out = tombstoneRedacted(history)
    assert.deepEqual(out.map((e) => [e.type, e.at]), history.map((e) => [e.type, e.at]))
  })

  it('leaves other entries alone', () => {
    assert.ok(JSON.stringify(tombstoneRedacted(history)).includes('likes mornings'))
  })

  it('changes nothing it already tombstoned: a second pass returns every event as the same object', () => {
    const once = tombstoneRedacted(history)
    const twice = tombstoneRedacted(once)
    assert.deepEqual(twice.map((event, i) => event === once[i]), once.map(() => true))
  })

  it('returns an event it leaves untouched as the same object, so a host rewrites only what changed', () => {
    const out = tombstoneRedacted(history)
    assert.deepEqual(out.map((event, i) => event === history[i]), [false, false, false, true, true])
  })

  it('folds to the same set as the log before tombstoning', () => {
    assert.deepEqual(foldEntries(tombstoneRedacted(history)), foldEntries(history))
  })

  it('a proposal holding the words loses them, in the log and in the fold', () => {
    const proposed: EntryEvent[] = [
      { type: 'EntryProposed', at: '2026-09-01T00:00:00Z', id: 'p1', reason: 'held', op: { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: draft('e9', 'a secret plan') } },
      { type: 'EntryRedacted', at: '2026-09-02T00:00:00Z', id: 'e9', ...said },
    ]
    assert.ok(!JSON.stringify(tombstoneRedacted(proposed)).includes('secret'))
    assert.ok(!JSON.stringify(foldEntries(proposed)).includes('secret'))
  })

  describe('a redact never crosses a proposal into what it named', () => {
    const live = { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: draft('e1', 'allergic to peanuts') } as const
    const reword = (id: string): EntryEvent => ({
      type: 'EntryProposed', at: '2026-09-02T00:00:00Z', id: 'p1', reason: 'held',
      op: { type: 'EntrySuperseded', at: '2026-09-02T00:00:00Z', supersedes: 'e1', entry: draft(id, 'no longer allergic, eats satay') },
    })

    it('redacting the proposed rewording leaves the live entry exactly as it was', () => {
      const events: EntryEvent[] = [live, reword('k2'), { type: 'EntryRedacted', at: '2026-09-03T00:00:00Z', id: 'k2', ...said }]
      const state = foldEntries(events)
      assert.deepEqual(findEntry(state, 'e1'), findEntry(foldEntries([live]), 'e1'))
      assert.equal(findEntry(state, 'k2')?.redacted, true)
      const stored = JSON.stringify(tombstoneRedacted(events))
      assert.ok(stored.includes('"text":"allergic to peanuts"'))
      assert.ok(!stored.includes('satay'))
    })

    it('a redacted proposed entry closes its proposal, so it can never be applied', () => {
      const state = foldEntries([live, reword('k2'), { type: 'EntryRedacted', at: '2026-09-03T00:00:00Z', id: 'k2', ...said }])
      assert.equal(state.proposals[0].status, 'discarded')
    })

    it('redacting the live entry also wipes an open proposal that rewords it, in the fold and the log', () => {
      const events: EntryEvent[] = [live, reword('k2'), { type: 'EntryRedacted', at: '2026-09-03T00:00:00Z', id: 'e1', ...said }]
      const state = foldEntries(events)
      assert.ok(!JSON.stringify(state).includes('satay'))
      assert.ok(!JSON.stringify(state).includes('peanuts'))
      assert.equal(state.proposals[0].status, 'discarded')
      assert.ok(!JSON.stringify(tombstoneRedacted(events)).includes('satay'))
    })
  })

  it('every free-text reason tied to the forgotten words is replaced by a fixed token', () => {
    const events: EntryEvent[] = [
      { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: draft('e1', 'allergic to cashews') },
      { type: 'EntryProposed', at: '2026-09-02T00:00:00Z', id: 'p1', reason: 'she said cashews are fine now', op: { type: 'EntryRetired', at: '2026-09-02T00:00:00Z', id: 'e1', reason: 'cashews no longer a problem', ...said } },
      { type: 'EntryProposed', at: '2026-09-02T00:00:00Z', id: 'p2', reason: 'reworded the cashew note', op: { type: 'EntrySuperseded', at: '2026-09-02T00:00:00Z', supersedes: 'e1', entry: draft('e2', 'mild cashew reaction') } },
      { type: 'EntryRedacted', at: '2026-09-03T00:00:00Z', id: 'e1', ...said },
    ]
    const stored = JSON.stringify(tombstoneRedacted(events))
    assert.ok(!stored.includes('cashew'), stored)
    assert.ok(stored.includes('[redacted]'))
    assert.ok(!JSON.stringify(foldEntries(events)).includes('cashew'))
  })

  it('a settled proposal that reworded the forgotten entry loses its reason in the fold too, not only on write-back', () => {
    const events: EntryEvent[] = [
      { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: draft('e1', 'allergic to cashews') },
      { type: 'EntryProposed', at: '2026-09-02T00:00:00Z', id: 'p2', reason: 'reworded the cashew note', op: { type: 'EntrySuperseded', at: '2026-09-02T00:00:00Z', supersedes: 'e1', entry: draft('e2', 'still careful with nuts') } },
      { type: 'EntryDismissed', at: '2026-09-03T00:00:00Z', target: 'proposal', id: 'p2', ...said },
      { type: 'EntryRedacted', at: '2026-09-04T00:00:00Z', id: 'e1', ...said },
    ]
    assert.ok(!JSON.stringify(foldEntries(events)).includes('cashew'))
  })

  it('the fold forgets the replaced wording too', () => {
    const state = foldEntries(history)
    assert.equal(findEntry(state, 'e1')?.text, '')
    assert.equal(findEntry(state, 'e1')?.redacted, true)
  })

  it('the fold says when each forgotten wording was forgotten', () => {
    const state = foldEntries(history)
    assert.equal(findEntry(state, 'e1')?.redactedAt, '2026-09-05T00:00:00Z')
    assert.equal(findEntry(state, 'e2')?.redactedAt, '2026-09-05T00:00:00Z')
    assert.equal(findEntry(state, 'e3')?.redactedAt, undefined)
  })
})

describe('wordingsForgottenBy — what a forget would take, asked before it is written', () => {
  const before = foldEntries(history.slice(0, 4))

  it('the entry\'s wording and every wording it replaced, each with its kind and severity, nothing else', () => {
    assert.deepEqual(wordingsForgottenBy(before, 'e2'), [
      { text: 'moving house in May', kind: 'fact', severity: 'soft', heldBy: [] },
      { text: 'moving house in June', kind: 'fact', severity: 'soft', heldBy: [] },
    ])
    assert.deepEqual(wordingsForgottenBy(before, 'e3').map((w) => w.text), ['likes mornings'])
  })

  it('nothing for an id the log does not hold, or one already forgotten', () => {
    assert.deepEqual(wordingsForgottenBy(before, 'nope'), [])
    assert.deepEqual(wordingsForgottenBy(foldEntries(history), 'e2'), [])
  })

  // A soft entry and a standing one can hold the same words; the
  // other copy is the standing one's, and forgetting the soft one must not take it.
  it('says which entries that survive the forget still hold the same words, case and spacing aside', () => {
    const twins: EntryEvent[] = [
      { type: 'EntryAdded', at: '2026-09-01T00:00:00Z', entry: { ...draft('h1', 'Undvik nötter i maten'), kind: 'rule', severity: 'hard' } },
      { type: 'EntryAdded', at: '2026-09-02T00:00:00Z', entry: draft('n1', 'undvik  nötter i maten') },
    ]
    assert.deepEqual(wordingsForgottenBy(foldEntries(twins), 'n1'), [{ text: 'undvik  nötter i maten', kind: 'fact', severity: 'soft', heldBy: [{ kind: 'rule', severity: 'hard' }] }])
    assert.deepEqual(wordingsForgottenBy(foldEntries(twins), 'h1')[0].heldBy, [{ kind: 'fact', severity: 'soft' }])
  })
})
