import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries, findEntry } from './fold.ts'
import { validate, type ValidationPolicy } from '../validation/validate.ts'
import { assertionFor } from '../validation/writer.ts'
import type { EntryEvent } from './types.ts'

// The fold sets status, confirmedAt, supersedes, supersededBy, retiredReason,
// redacted and redactedAt from its own events, never from a payload. An event can carry any
// field it likes; only the fields an operation means survive into the state.

const DRAFT = ['id', 'kind', 'text', 'severity', 'until', 'review', 'source', 'assertedBy', 'origin', 'writer', 'runId', 'relayed']
const ENTRY = [...DRAFT, 'status', 'at', 'supersedes', 'supersededBy', 'confirmedAt', 'retiredReason', 'redacted', 'redactedAt']
const PROPOSAL = ['id', 'at', 'reason', 'op', 'status']
const OP = ['type', 'at', 'entry', 'supersedes', 'id', 'reason', 'source', 'assertedBy', 'origin', 'writer', 'runId']
const SOURCE = ['kind', 'id']

const JUNK = {
  junk: 'x', status: 'retired', confirmedAt: '2026-01-01T00:00:00Z', supersededBy: 'victim', supersedes: 'victim',
  redacted: true, redactedAt: '2026-01-01T00:00:00Z', retiredReason: 'x', retirementProposed: 'x',
}
const said = assertionFor('subject-action', { kind: 'action', id: 'tap' })
const junkSource = { kind: 'action' as const, id: 'tap', junk: 'x' }
const draft = (id: string) => ({ id, kind: 'fact', text: 'a fact', severity: 'soft' as const, ...said, source: junkSource, ...JUNK, supersedes: undefined })
const T = '2026-10-01T10:00:00Z'

function extra(keys: string[], allowed: string[]): string[] {
  return keys.filter((key) => !allowed.includes(key))
}

function assertClean(events: EntryEvent[]): void {
  const state = foldEntries(events)
  for (const entry of state.entries) {
    assert.deepEqual(extra(Object.keys(entry), ENTRY), [], `entry ${entry.id}`)
    assert.deepEqual(extra(Object.keys(entry.source), SOURCE), [], `source of ${entry.id}`)
  }
  for (const proposal of state.proposals) {
    assert.deepEqual(extra(Object.keys(proposal), PROPOSAL), [], `proposal ${proposal.id}`)
    assert.deepEqual(extra(Object.keys(proposal.op), OP), [], `op of ${proposal.id}`)
    if ('entry' in proposal.op) assert.deepEqual(extra(Object.keys(proposal.op.entry), DRAFT), [], `op entry of ${proposal.id}`)
  }
}

describe('no field reaches the state unless an operation means it', () => {
  const victim: EntryEvent = { type: 'EntryAdded', at: T, entry: { id: 'victim', kind: 'fact', text: 'the victim', severity: 'hard', ...said } }
  const cases: [string, EntryEvent][] = [
    ['an add', { type: 'EntryAdded', at: T, entry: draft('e1'), ...JUNK } as EntryEvent],
    ['a supersede', { ...JUNK, type: 'EntrySuperseded', at: T, supersedes: 'victim', entry: draft('e1') } as unknown as EntryEvent],
    ['a retire', { type: 'EntryRetired', at: T, id: 'victim', reason: 'r', ...said, ...JUNK } as unknown as EntryEvent],
    ['a confirm', { type: 'EntryConfirmed', at: T, target: 'entry', id: 'victim', ...said, ...JUNK } as unknown as EntryEvent],
    ['a dismiss', { type: 'EntryDismissed', at: T, target: 'entry', id: 'victim', ...said, ...JUNK } as unknown as EntryEvent],
    ['a redact', { type: 'EntryRedacted', at: T, id: 'victim', ...said, ...JUNK } as unknown as EntryEvent],
    ['a proposal', { type: 'EntryProposed', at: T, id: 'p1', reason: 'r', op: { type: 'EntryAdded', at: T, entry: draft('e1'), ...JUNK }, ...JUNK } as unknown as EntryEvent],
  ]
  for (const [name, event] of cases) {
    it(name, () => assertClean([victim, event]))
  }

  it('a declared confirmedAt does not make an entry confirmed (P3)', () => {
    const entry = findEntry(foldEntries([{ type: 'EntryAdded', at: T, entry: draft('e1') } as EntryEvent]), 'e1')
    assert.equal(entry?.confirmedAt, undefined)
    assert.equal(entry?.status, 'live')
  })

  it('a declared redactedAt does not mark an entry forgotten', () => {
    const entry = findEntry(foldEntries([{ type: 'EntryAdded', at: T, entry: draft('e1') } as EntryEvent]), 'e1')
    assert.equal(entry?.redactedAt, undefined)
    assert.equal(entry?.redacted, false)
  })

  it('a declared supersede link cannot drag another entry into a redact (P4)', () => {
    const injected = { type: 'EntryAdded', at: T, entry: { ...draft('evil'), supersedes: 'victim', supersededBy: 'victim' } } as unknown as EntryEvent
    const state = foldEntries([victim, injected, { type: 'EntryRedacted', at: T, id: 'evil', ...said }])
    assert.equal(findEntry(state, 'victim')?.text, 'the victim')
    assert.equal(findEntry(state, 'victim')?.status, 'live')
  })

  it('the validator hands back only the fields an operation means', () => {
    const policy: ValidationPolicy = { kinds: { fact: { mayBeHard: true } }, maxTextLength: 100, stopwords: new Set(), textRules: [], caps: { liveEntries: 10, addsPerMessage: 3, opsPerRun: 3 } }
    const verdict = validate(foldEntries([]), { type: 'EntryAdded', at: T, entry: draft('e1'), ...JUNK } as EntryEvent, { policy, messages: [], proposalId: () => 'p', writer: 'subject-action', now: T })
    assert.equal(verdict.verdict, 'accept')
    const event = (verdict as unknown as { event: Record<string, unknown> & { entry: Record<string, unknown> } }).event
    assert.deepEqual(extra(Object.keys(event), ['type', 'at', 'entry']), [])
    assert.deepEqual(extra(Object.keys(event.entry), DRAFT), [])
  })
})

describe('a malformed event is refused by the validator and ignored by the fold, never thrown', () => {
  const policy: ValidationPolicy = { kinds: { fact: { mayBeHard: true } }, maxTextLength: 100, stopwords: new Set(), textRules: [], caps: { liveEntries: 10, addsPerMessage: 3, opsPerRun: 3 } }
  const ctx = { policy, messages: [], proposalId: () => 'p-new', writer: 'subject-action' as const, now: T }
  const good = { id: 'e2', kind: 'fact', text: 'a fact', severity: 'soft', ...said }
  const base: EntryEvent[] = [{ type: 'EntryAdded', at: T, entry: { id: 'e1', kind: 'fact', text: 'one', severity: 'soft', ...said } }]

  // A kind is the host's to know: the fold stores whatever kind a well-formed event
  // names, and only the validator refuses one the policy does not own.
  const VALIDATOR_ONLY = new Set(['an add of kind constructor', 'an add of kind __proto__'])
  const cases: [string, unknown][] = [
    ['null', null],
    ['a number', 42],
    ['a string', 'EntryAdded'],
    ['an array', []],
    ['an empty object', {}],
    ['an unknown type', { type: 'EntryExploded', at: T }],
    ['an add with no entry', { type: 'EntryAdded', at: T }],
    ['an add with a null entry', { type: 'EntryAdded', at: T, entry: null }],
    ['an add with a numeric text', { type: 'EntryAdded', at: T, entry: { ...good, text: 42 } }],
    ['an add with a null source', { type: 'EntryAdded', at: T, entry: { ...good, source: null } }],
    ['an add with severity HARD', { type: 'EntryAdded', at: T, entry: { ...good, severity: 'HARD' } }],
    ['an add of kind constructor', { type: 'EntryAdded', at: T, entry: { ...good, kind: 'constructor' } }],
    ['an add of kind __proto__', { type: 'EntryAdded', at: T, entry: { ...good, kind: '__proto__' } }],
    ['an add with a numeric time', { type: 'EntryAdded', at: 42, entry: good }],
    ['a confirm of a target that is neither', { type: 'EntryConfirmed', at: T, target: 'both', id: 'e1', ...said }],
    ['a dismiss with no target', { type: 'EntryDismissed', at: T, id: 'e1', ...said }],
    ['a retire with a numeric reason', { type: 'EntryRetired', at: T, id: 'e1', reason: 7, ...said }],
    ['a proposal of a redact', { type: 'EntryProposed', at: T, id: 'p1', reason: 'r', op: { type: 'EntryRedacted', at: T, id: 'e1', ...said } }],
    ['a proposal of a confirm', { type: 'EntryProposed', at: T, id: 'p1', reason: 'r', op: { type: 'EntryConfirmed', at: T, target: 'entry', id: 'e1', ...said } }],
    ['a proposal with no op', { type: 'EntryProposed', at: T, id: 'p1', reason: 'r' }],
    ['a proposal holding a malformed add', { type: 'EntryProposed', at: T, id: 'p1', reason: 'r', op: { type: 'EntryAdded', at: T, entry: { ...good, severity: 1 } } }],
  ]

  // An operation may leave its time out, as the validator stamps `now`; a stored event may not.
  it('the fold ignores a stored add with no time', () => {
    assert.deepEqual(foldEntries([...base, { type: 'EntryAdded', entry: good } as unknown as EntryEvent]), foldEntries(base))
  })

  for (const [name, event] of cases) {
    it(`validate refuses ${name}`, () => {
      const verdict = validate(foldEntries(base), event as EntryEvent, ctx)
      assert.equal(verdict.verdict, 'reject')
      assert.ok((verdict as { reason: string }).reason.length > 0)
    })

    if (VALIDATOR_ONLY.has(name)) continue
    it(`the fold ignores ${name}`, () => {
      assert.deepEqual(foldEntries([...base, event as EntryEvent]), foldEntries(base))
    })
  }
})
