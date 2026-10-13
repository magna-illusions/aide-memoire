import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries } from '../log/fold.ts'
import type { EntryEvent, EntryOperation, Source } from '../log/types.ts'
import { validate, type ValidationContext } from '../validation/validate.ts'
import { assertionFor } from '../validation/writer.ts'
import { add, apply, confirm, discard, dismiss, forget, retire, supersede } from './ops.ts'

// Each builder emits exactly the operation you would write by hand, and the
// validator stores it as it would the hand-written event in full.

const tap: Source = { kind: 'action', id: 'tap' }
const AT = '2026-10-04T10:00:00Z'
const by = assertionFor('subject-action', tap)
const ctx: ValidationContext = {
  writer: 'subject-action', now: AT, messages: [], proposalId: () => 'p-new',
  policy: { kinds: { fact: { mayBeHard: true } }, maxTextLength: 200, stopwords: new Set(), textRules: [], caps: { liveEntries: 10, addsPerMessage: 3, opsPerRun: 5 } },
}
const state = foldEntries([
  { type: 'EntryAdded', at: AT, entry: { id: 'e1', kind: 'fact', text: 'likes tea', severity: 'soft', ...by } },
  { type: 'EntryAdded', at: AT, entry: { id: 'e2', kind: 'fact', text: 'likes coffee', severity: 'soft', ...by } },
  { type: 'EntryProposed', at: AT, id: 'p1', reason: 'asked', op: { type: 'EntryAdded', at: AT, entry: { id: 'e3', kind: 'fact', text: 'likes cocoa', severity: 'soft', ...by } } },
])

const cases: [string, EntryOperation, EntryOperation, EntryEvent][] = [
  ['add', add({ id: 'n1', kind: 'fact', text: 'likes mint', source: tap }),
    { type: 'EntryAdded', entry: { id: 'n1', kind: 'fact', text: 'likes mint', severity: 'soft', source: tap } },
    { type: 'EntryAdded', at: AT, entry: { id: 'n1', kind: 'fact', text: 'likes mint', severity: 'soft', ...by } }],
  ['add, hard and dated', add({ id: 'n1', kind: 'fact', text: 'no calls after nine', source: tap, severity: 'hard', until: '2026-12-01', review: '2026-11-01' }),
    { type: 'EntryAdded', entry: { id: 'n1', kind: 'fact', text: 'no calls after nine', severity: 'hard', source: tap, until: '2026-12-01', review: '2026-11-01' } },
    { type: 'EntryAdded', at: AT, entry: { id: 'n1', kind: 'fact', text: 'no calls after nine', severity: 'hard', until: '2026-12-01', review: '2026-11-01', ...by } }],
  ['supersede', supersede('e1', { id: 'n1', kind: 'fact', text: 'likes green tea', source: tap }),
    { type: 'EntrySuperseded', supersedes: 'e1', entry: { id: 'n1', kind: 'fact', text: 'likes green tea', severity: 'soft', source: tap } },
    { type: 'EntrySuperseded', at: AT, supersedes: 'e1', entry: { id: 'n1', kind: 'fact', text: 'likes green tea', severity: 'soft', ...by } }],
  ['retire', retire('e1', 'gave it up', tap),
    { type: 'EntryRetired', id: 'e1', reason: 'gave it up', source: tap },
    { type: 'EntryRetired', at: AT, id: 'e1', reason: 'gave it up', ...by }],
  ['apply', apply('p1', tap),
    { type: 'EntryConfirmed', target: 'proposal', id: 'p1', source: tap },
    { type: 'EntryConfirmed', at: AT, target: 'proposal', id: 'p1', ...by }],
  ['discard', discard('p1', tap),
    { type: 'EntryDismissed', target: 'proposal', id: 'p1', source: tap },
    { type: 'EntryDismissed', at: AT, target: 'proposal', id: 'p1', ...by }],
  ['confirm', confirm('e1', tap),
    { type: 'EntryConfirmed', target: 'entry', id: 'e1', source: tap },
    { type: 'EntryConfirmed', at: AT, target: 'entry', id: 'e1', ...by }],
  ['dismiss', dismiss('e1', tap),
    { type: 'EntryDismissed', target: 'entry', id: 'e1', source: tap },
    { type: 'EntryDismissed', at: AT, target: 'entry', id: 'e1', ...by }],
  ['forget', forget('e2', tap),
    { type: 'EntryRedacted', id: 'e2', source: tap },
    { type: 'EntryRedacted', at: AT, id: 'e2', ...by }],
]

describe('the operation builders', () => {
  for (const [name, built, expected, full] of cases) {
    it(`${name} emits the operation exactly`, () => assert.deepEqual(built, expected))

    it(`${name} is stored as the hand-written event in full would be`, () => {
      const fromBuilt = validate(state, built, ctx)
      const fromFull = validate(state, full, ctx)
      assert.equal(fromBuilt.verdict, 'accept', 'reason' in fromBuilt ? fromBuilt.reason : '')
      assert.deepEqual(fromBuilt, fromFull)
    })
  }
})
