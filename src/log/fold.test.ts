import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries, liveEntries, findEntry, openProposals } from './fold.ts'
import type { EntryDraft, EntryEvent, EntryAdded, EntryRetired, EntrySuperseded, Assertion } from './types.ts'

const said: Assertion = { source: { kind: 'message', id: 'm1' }, assertedBy: 'subject', origin: 'conversation' }
const draft = (id: string, text: string, extra: Partial<EntryDraft> = {}): EntryDraft =>
  ({ id, kind: 'fact', text, severity: 'soft', ...said, ...extra })
const added = (id: string, text: string, at = '2026-10-01T10:00:00Z'): EntryAdded =>
  ({ type: 'EntryAdded', at, entry: draft(id, text) })
const confirm = (target: 'entry' | 'proposal', id: string): EntryEvent => ({ type: 'EntryConfirmed', at: '2026-10-03T00:00:00Z', target, id, ...said })
const dismiss = (target: 'entry' | 'proposal', id: string): EntryEvent => ({ type: 'EntryDismissed', at: '2026-10-03T00:00:00Z', target, id, ...said })

describe('foldEntries — from events to the entry set', () => {
  it('an empty log folds to no entries', () => {
    assert.deepEqual(foldEntries([]).entries, [])
  })

  it('an add is live, unredacted, stamped with when it happened', () => {
    const [entry] = foldEntries([added('e1', 'likes mornings')]).entries
    assert.equal(entry.status, 'live')
    assert.equal(entry.text, 'likes mornings')
    assert.equal(entry.at, '2026-10-01T10:00:00Z')
    assert.equal(entry.redacted, false)
  })

  it('a supersede retires the old entry and links both ways', () => {
    const state = foldEntries([
      added('e1', 'runs 3x a week'),
      { type: 'EntrySuperseded', at: '2026-10-02T10:00:00Z', supersedes: 'e1', entry: draft('e2', 'runs 4x a week') },
    ])
    assert.equal(findEntry(state, 'e1')?.status, 'retired')
    assert.equal(findEntry(state, 'e1')?.supersededBy, 'e2')
    assert.equal(findEntry(state, 'e2')?.supersedes, 'e1')
    assert.deepEqual(liveEntries(state).map((e) => e.id), ['e2'])
  })

  it('a retire keeps the entry, with its reason', () => {
    const state = foldEntries([added('e1', 'stiff neck'), { type: 'EntryRetired', at: '2026-10-03T00:00:00Z', id: 'e1', reason: 'healed', ...said }])
    assert.equal(findEntry(state, 'e1')?.status, 'retired')
    assert.equal(findEntry(state, 'e1')?.retiredReason, 'healed')
  })

  it('a proposed add waits as proposed; confirming the proposal makes it live and confirmed', () => {
    const proposed: EntryEvent = { type: 'EntryProposed', at: '2026-10-01T10:00:00Z', id: 'p1', reason: 'inferred', op: added('e1', 'avoids late meals') }
    const waiting = foldEntries([proposed])
    assert.equal(findEntry(waiting, 'e1')?.status, 'proposed')
    assert.deepEqual(openProposals(waiting).map((p) => p.id), ['p1'])
    assert.deepEqual(liveEntries(waiting), [])
    const settled = foldEntries([proposed, confirm('proposal', 'p1')])
    assert.equal(findEntry(settled, 'e1')?.status, 'live')
    assert.equal(findEntry(settled, 'e1')?.confirmedAt, '2026-10-03T00:00:00Z')
    assert.deepEqual(openProposals(settled), [])
  })

  it('dismissing a proposed add discards it: the entry never goes live', () => {
    const state = foldEntries([{ type: 'EntryProposed', at: '2026-10-01T10:00:00Z', id: 'p1', reason: 'r', op: added('e1', 'x') }, dismiss('proposal', 'p1')])
    assert.equal(findEntry(state, 'e1')?.status, 'retired')
    assert.deepEqual(openProposals(state), [])
  })

  it('a proposed supersede retires what it replaces only once the proposal is confirmed', () => {
    const op: EntrySuperseded = { type: 'EntrySuperseded', at: '2026-10-02T00:00:00Z', supersedes: 'e1', entry: draft('e2', 'new') }
    const events: EntryEvent[] = [added('e1', 'old'), { type: 'EntryProposed', at: '2026-10-02T00:00:00Z', id: 'p1', reason: 'r', op }]
    assert.equal(findEntry(foldEntries(events), 'e1')?.status, 'live')
    const confirmed = foldEntries([...events, confirm('proposal', 'p1')])
    assert.equal(findEntry(confirmed, 'e1')?.status, 'retired')
    assert.equal(findEntry(confirmed, 'e2')?.status, 'live')
    const dismissed = foldEntries([...events, dismiss('proposal', 'p1')])
    assert.equal(findEntry(dismissed, 'e1')?.status, 'live')
    assert.equal(findEntry(dismissed, 'e2')?.status, 'retired')
  })

  describe('a proposed retire', () => {
    const retire: EntryRetired = { type: 'EntryRetired', at: '2026-10-02T00:00:00Z', id: 'e1', reason: 'seems over', ...said, assertedBy: 'agent' }
    const events: EntryEvent[] = [added('e1', 'limit'), { type: 'EntryProposed', at: '2026-10-02T00:00:00Z', id: 'p1', reason: 'inferred', op: retire }]

    it('leaves the entry live and the proposal open', () => {
      const state = foldEntries(events)
      assert.equal(findEntry(state, 'e1')?.status, 'live')
      assert.deepEqual(openProposals(state).map((p) => p.op.type), ['EntryRetired'])
    })

    it('confirming the proposal applies it: the entry retires with the proposed reason', () => {
      const entry = findEntry(foldEntries([...events, confirm('proposal', 'p1')]), 'e1')
      assert.equal(entry?.status, 'retired')
      assert.equal(entry?.retiredReason, 'seems over')
    })

    it('dismissing the proposal discards it and leaves the entry exactly as it was', () => {
      const state = foldEntries([...events, dismiss('proposal', 'p1')])
      assert.deepEqual(findEntry(state, 'e1'), findEntry(foldEntries(events), 'e1'))
      assert.deepEqual(openProposals(state), [])
    })

    it('confirming the entry says it is still true: confirmed, live, and the proposal still open', () => {
      const state = foldEntries([...events, confirm('entry', 'e1')])
      assert.equal(findEntry(state, 'e1')?.status, 'live')
      assert.equal(findEntry(state, 'e1')?.confirmedAt, '2026-10-03T00:00:00Z')
      assert.deepEqual(openProposals(state).map((p) => p.id), ['p1'])
    })

    it('a confirm never reads one target as the other', () => {
      assert.deepEqual(foldEntries([...events, confirm('entry', 'p1')]), foldEntries(events))
      assert.deepEqual(foldEntries([...events, confirm('proposal', 'e1')]), foldEntries(events))
    })
  })

  it('confirming a live entry with no proposal bumps it to confirmed; dismissing it retires it', () => {
    assert.equal(findEntry(foldEntries([added('e1', 'x'), confirm('entry', 'e1')]), 'e1')?.confirmedAt, '2026-10-03T00:00:00Z')
    assert.equal(findEntry(foldEntries([added('e1', 'x'), dismiss('entry', 'e1')]), 'e1')?.retiredReason, 'dismissed')
  })

  it('a proposal the agent applied goes live but is not the subject\'s confirmation', () => {
    const agent: Assertion = { ...said, assertedBy: 'agent' }
    const events: EntryEvent[] = [
      { type: 'EntryProposed', at: '2026-10-01T10:00:00Z', id: 'p1', reason: 'r', op: added('e1', 'x') },
      { type: 'EntryConfirmed', at: '2026-10-03T00:00:00Z', target: 'proposal', id: 'p1', ...agent },
    ]
    const entry = findEntry(foldEntries(events), 'e1')
    assert.equal(entry?.status, 'live')
    assert.equal(entry?.confirmedAt, undefined)
  })

  it('a live entry confirmed by anyone but the subject is not confirmed', () => {
    const agent: Assertion = { ...said, assertedBy: 'agent' }
    const entry = findEntry(foldEntries([added('e1', 'x'), { type: 'EntryConfirmed', at: '2026-10-03T00:00:00Z', target: 'entry', id: 'e1', ...agent }]), 'e1')
    assert.equal(entry?.confirmedAt, undefined)
  })

  it('a settled proposal cannot be settled again', () => {
    const events: EntryEvent[] = [{ type: 'EntryProposed', at: '2026-10-01T10:00:00Z', id: 'p1', reason: 'r', op: added('e1', 'x') }, dismiss('proposal', 'p1')]
    assert.deepEqual(foldEntries([...events, confirm('proposal', 'p1')]), foldEntries(events))
  })

  it('a redact empties the text and keeps the id', () => {
    const state = foldEntries([added('e1', 'a private matter'), { type: 'EntryRedacted', at: '2026-10-02T00:00:00Z', id: 'e1', ...said }])
    const entry = findEntry(state, 'e1')
    assert.equal(entry?.text, '')
    assert.equal(entry?.redacted, true)
    assert.equal(entry?.status, 'retired')
  })

  it('an operation on an unknown id, or an unknown type, changes nothing', () => {
    const base = [added('e1', 'x')]
    const noise = [
      { type: 'EntryRetired', at: 'x', id: 'nope', reason: 'r', ...said },
      { type: 'SomethingElse', at: 'x' },
    ] as unknown as EntryEvent[]
    assert.deepEqual(foldEntries([...base, ...noise]), foldEntries(base))
  })

  it('a second add under an existing id is ignored, so replay is deterministic', () => {
    const state = foldEntries([added('e1', 'first'), added('e1', 'second')])
    assert.equal(state.entries.length, 1)
    assert.equal(findEntry(state, 'e1')?.text, 'first')
  })
})


// The host's one-time import of what it held before (a migration) is complete
// when its marker is in the log. The fold records when; no entry changes.
describe('foldEntries — the migration marker', () => {
  it('records when the migration was applied, and touches no entry', () => {
    const state = foldEntries([added('e1', 'likes mornings'), { type: 'MigrationApplied', at: '2026-10-07T03:00:00Z' }])
    assert.equal(state.migratedAt, '2026-10-07T03:00:00Z')
    assert.equal(state.entries.length, 1)
    assert.equal(state.entries[0].status, 'live')
  })

  it('a log without one was never migrated, however its entries arrived', () => {
    const migrated: EntryAdded = { type: 'EntryAdded', at: '2026-10-01T00:00:00Z', entry: draft('m1', 'from the old store', { assertedBy: 'operator', origin: 'migration', source: { kind: 'migration', id: '3' } }) }
    assert.equal(foldEntries([migrated]).migratedAt, undefined)
  })

  it('a second marker keeps the first time', () => {
    const state = foldEntries([{ type: 'MigrationApplied', at: '2026-10-07T03:00:00Z' }, { type: 'MigrationApplied', at: '2026-10-08T03:00:00Z' }])
    assert.equal(state.migratedAt, '2026-10-07T03:00:00Z')
  })
})
