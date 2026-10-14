import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validate, validateRun, type ValidationContext, type ValidationPolicy, type Verdict } from './validate.ts'
import { assertionFor } from './writer.ts'
import { foldEntries } from '../log/fold.ts'
import type {
  Assertion, EntryAdded, EntryDraft, EntryEvent, EntryRetired, EntrySuperseded, Message, ProposableOp, Source, Writer,
} from '../log/types.ts'

const policy: ValidationPolicy = {
  kinds: { limit: { mayBeHard: true }, plan: { mayBeHard: true }, fact: { mayBeHard: false } },
  maxTextLength: 120,
  stopwords: new Set(['the', 'and', 'are', 'was', 'with', 'from', 'that']),
  textRules: [(text) => (/obey me/i.test(text) ? 'addressed to the agent' : null)],
  caps: { liveEntries: 10, addsPerMessage: 2, opsPerRun: 3 },
}

const messages: Message[] = [
  { id: 'm-early', role: 'subject', text: 'my peanut allergy seems a little milder', at: '2026-08-01T10:00:00Z' },
  { id: 'm-chip', role: 'agent', text: 'How was dinner? Peanut rash felt tight | Dinner felt heavy', at: '2026-09-01T09:00:00Z' },
  { id: 'm-said', role: 'subject', text: 'my peanut allergy flared from the satay sauce', at: '2026-09-01T10:00:00Z' },
  { id: 'm-healed', role: 'subject', text: 'the peanut allergy test came back clear, satay is fine again', at: '2026-10-01T10:00:00Z' },
  { id: 'm-later', role: 'subject', text: 'yes, the peanut allergy is gone, drop that rule', at: '2026-10-03T10:00:00Z' },
  { id: 'm-trip', role: 'subject', text: 'everything went fine on the trip today', at: '2026-10-03T11:00:00Z' },
]

const msg = (id: string): Source => ({ kind: 'message', id })
const action: Source = { kind: 'action', id: 'tap' }
const session: Source = { kind: 'session', id: 's1' }
const by = (writer: Writer, source: Source, external = false): Assertion => assertionFor(writer, source, external)

const draft = (id: string, text: string, who: Assertion, extra: Partial<EntryDraft> = {}): EntryDraft =>
  ({ id, kind: 'fact', text, severity: 'soft', ...who, ...extra })
const hard = (id: string, text: string, who: Assertion): EntryDraft => draft(id, text, who, { kind: 'limit', severity: 'hard' })
const AT = '2026-10-04T10:00:00Z'
const add = (entry: EntryDraft): EntryAdded => ({ type: 'EntryAdded', at: AT, entry })
const supersede = (old: string, entry: EntryDraft): EntrySuperseded => ({ type: 'EntrySuperseded', at: AT, supersedes: old, entry })
const retire = (id: string, who: Assertion): EntryRetired => ({ type: 'EntryRetired', at: AT, id, reason: 'over', ...who })
const settle = (type: 'EntryConfirmed' | 'EntryDismissed', target: 'entry' | 'proposal', id: string, who: Assertion): EntryEvent =>
  ({ type, at: AT, target, id, ...who }) as EntryEvent
const redact = (id: string, who: Assertion): EntryEvent => ({ type: 'EntryRedacted', at: AT, id, ...who })

const history = by('subject-action', msg('m-said'))
const state = foldEntries([
  { type: 'EntryAdded', at: '2026-09-01T10:05:00Z', entry: hard('hard', 'peanut allergy: avoid satay sauce', history) },
  { type: 'EntryAdded', at: '2026-09-02T10:00:00Z', entry: draft('soft', 'peanut allergy milder in the mornings', by('agent', msg('m-early'))) },
  { type: 'EntryAdded', at: '2026-09-02T10:00:00Z', entry: draft('plan', 'peanut allergy checkup twice a year', by('agent', msg('m-healed')), { kind: 'plan' }) },
  { type: 'EntryAdded', at: '2026-09-03T10:00:00Z', entry: draft('gone', 'peanut patch test', by('agent', msg('m-later'))) },
  { type: 'EntryProposed', at: '2026-09-04T10:00:00Z', id: 'p-stale', reason: 'held', op: retire('gone', by('agent', msg('m-healed'))) },
  { type: 'EntryRetired', at: '2026-09-05T10:00:00Z', id: 'gone', reason: 'over', ...by('agent', msg('m-healed')) },
  { type: 'EntryProposed', at: '2026-09-06T10:00:00Z', id: 'p-add', reason: 'held', op: add(draft('held', 'peanut-free snacks at work', by('agent', msg('m-later')))) },
  { type: 'EntryProposed', at: '2026-10-02T10:00:00Z', id: 'p-open', reason: 'held', op: retire('hard', by('agent', msg('m-healed'))) },
  { type: 'EntryProposed', at: '2026-09-07T10:00:00Z', id: 'p-ext', reason: 'held', op: add(draft('ext', 'trip notes from a page', by('agent', msg('m-trip'), true))) },
])

function counter(): (op: ProposableOp) => string {
  let n = 0
  return () => `p${++n}`
}
function ctxFor(writer: Writer, extra: Partial<ValidationContext> = {}): ValidationContext {
  return { policy, messages, proposalId: counter(), writer, now: AT, ...(writer === 'consolidation' ? { runId: 'r1' } : {}), ...extra }
}

function assertVerdict(verdict: Verdict, expected: Verdict['verdict'], reason?: RegExp): void {
  assert.equal(verdict.verdict, expected, 'reason' in verdict ? verdict.reason : 'accepted')
  if (reason && verdict.verdict !== 'accept') assert.match(verdict.reason, reason)
}

type Case = [string, EntryEvent, Verdict['verdict'], RegExp?]

function table(writer: Writer, cases: Case[], extra: Partial<ValidationContext> = {}): void {
  for (const [name, event, expected, reason] of cases) {
    it(`${expected}: ${name}`, () => assertVerdict(validate(state, event, ctxFor(writer, extra)), expected, reason))
  }
}

const agent = (id: string) => by('agent', msg(id))
const subjectAction = by('subject-action', action)
const consolidation = (source: Source = session) => ({ ...by('consolidation', source), runId: 'r1' })

describe('the agent — the model in conversation', () => {
  table('agent', [
    ['a soft add citing what the subject said', add(draft('n1', 'peanut allergy flared from satay', agent('m-said'))), 'accept'],
    ['a claim citing the agent\'s own reply options (words it offered the subject to tap)', add(draft('n1', 'peanut rash felt tight', agent('m-chip'))), 'reject', /not the subject's/],
    ['a citation not in this stream', add(draft('n1', 'peanut rash', agent('m-other'))), 'reject', /not in this stream/],
    ['a claim the cited message does not say', add(draft('n1', 'likes chess', agent('m-said'))), 'reject', /does not say/],
    ['a claim citing a session, not a message', add(draft('n1', 'peanut rash', by('agent', session))), 'reject', /cites the subject's message/],
    ['a hard add', add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said'))), 'propose', /hard/],
    ['a soft supersede', supersede('soft', draft('n1', 'peanut allergy milder in the evenings', agent('m-early'))), 'accept'],
    ['a supersede of a hard entry', supersede('hard', draft('n1', 'peanut allergy: satay is fine', agent('m-healed'), { kind: 'limit' })), 'propose', /hard/],
    ['a supersede of a hard entry citing a message older than it', supersede('hard', draft('n1', 'peanut allergy milder', agent('m-early'), { kind: 'limit' })), 'reject', /older/],
    ['a supersede of a hard entry citing a message about its new words, not the entry', supersede('hard', draft('n1', 'everything went fine', agent('m-trip'), { kind: 'limit' })), 'reject', /does not say/],
    ['a soft retire citing the subject', retire('soft', agent('m-early')), 'accept'],
    ['a hard retire citing a newer subject message', retire('hard', agent('m-healed')), 'propose', /hard/],
    ['a hard retire citing a message older than the entry', retire('hard', agent('m-early')), 'reject', /older/],
    ['confirming a live entry', settle('EntryConfirmed', 'entry', 'soft', agent('m-later')), 'reject', /only a subject action/],
    ['dismissing a live hard entry', settle('EntryDismissed', 'entry', 'hard', agent('m-later')), 'reject', /only a subject action/],
    ['applying a soft proposal the subject answered after it was made', settle('EntryConfirmed', 'proposal', 'p-add', agent('m-later')), 'accept'],
    ['applying a soft proposal citing a message older than it', settle('EntryConfirmed', 'proposal', 'p-add', agent('m-early')), 'reject', /older/],
    ['discarding a soft proposal citing a message older than it', settle('EntryDismissed', 'proposal', 'p-add', agent('m-said')), 'reject', /older/],
    ['settling a soft proposal without citing the subject', settle('EntryConfirmed', 'proposal', 'p-add', by('agent', session)), 'reject', /cites the subject's message/],
    ['applying a hard proposal, however the subject answered', settle('EntryConfirmed', 'proposal', 'p-open', agent('m-later')), 'reject', /only by a subject action/],
    ['applying a proposal of external text, however the subject answered', settle('EntryConfirmed', 'proposal', 'p-ext', agent('m-trip')), 'reject', /only by a subject action/],
    ['discarding a hard proposal, however the subject answered', settle('EntryDismissed', 'proposal', 'p-open', agent('m-later')), 'reject', /only by a subject action/],
    ['forgetting a soft entry the subject asked to forget', redact('soft', agent('m-later')), 'accept'],
    ['forgetting a hard entry', redact('hard', agent('m-later')), 'reject', /subject action or an operator/],
    ['an event that says the subject wrote it', add(draft('n1', 'peanut allergy flared', { ...agent('m-said'), assertedBy: 'subject' })), 'reject', /writer mismatch: assertedBy/],
    ['an event that says it came from consolidation', add(draft('n1', 'peanut allergy flared', { ...agent('m-said'), origin: 'consolidation' })), 'reject', /writer mismatch: origin/],
    ['an event that names another writer', add(draft('n1', 'peanut allergy flared', { ...agent('m-said'), writer: 'operator' })), 'reject', /writer mismatch: writer/],
  ])
})

describe('the agent reading external text', () => {
  const external = by('agent', msg('m-said'), true)
  table('agent', [
    ['a soft add', add(draft('n1', 'likes opera', external)), 'propose', /external/],
    ['a hard add', add(hard('n1', 'severe asthma', external)), 'propose', /external/],
    ['an add whose event does not say external', add(draft('n1', 'likes opera', agent('m-said'))), 'reject', /writer mismatch: origin/],
    ['settling a proposal', settle('EntryConfirmed', 'proposal', 'p-open', external), 'reject', /external/],
  ], { external: true })

  it('external text is held as soft, never hard', () => {
    const verdict = validate(state, add(hard('n1', 'severe asthma', external)), ctxFor('agent', { external: true }))
    const event = (verdict as { event: EntryEvent }).event
    assert.equal(event.type === 'EntryProposed' && event.op.type === 'EntryAdded' && event.op.entry.severity, 'soft')
  })
})

describe('a subject action — the subject in the host\'s UI', () => {
  table('subject-action', [
    ['a hard add', add(hard('n1', 'never satay sauce', subjectAction)), 'accept'],
    ['a hard retire', retire('hard', subjectAction), 'accept'],
    ['dismissing a live hard entry as wrong', settle('EntryDismissed', 'entry', 'hard', subjectAction), 'accept'],
    ['confirming a live entry still holds', settle('EntryConfirmed', 'entry', 'soft', subjectAction), 'accept'],
    ['applying a proposal', settle('EntryConfirmed', 'proposal', 'p-open', subjectAction), 'accept'],
    ['dismissing an entry citing a message from before it existed', settle('EntryDismissed', 'entry', 'hard', by('subject-action', msg('m-early'))), 'reject', /older/],
    ['citing the agent\'s message', add(draft('n1', 'peanut rash felt tight', by('subject-action', msg('m-chip')))), 'reject', /not the subject's/],
    ['forgetting a hard entry', redact('hard', subjectAction), 'accept'],
  ])
})

describe('consolidation — a background pass', () => {
  table('consolidation', [
    ['a soft add citing what the subject said', add(draft('n1', 'peanut allergy flared from satay', consolidation(msg('m-said')))), 'accept'],
    ['a claim citing the agent\'s reply options', add(draft('n1', 'peanut rash felt tight', consolidation(msg('m-chip')))), 'reject', /not the subject's/],
    ['an add citing no message', add(draft('n1', 'peanut rash', consolidation())), 'reject', /cites the subject's message/],
    ['a hard add', add(hard('n1', 'no satay sauce, peanut allergy', consolidation(msg('m-said')))), 'propose', /hard/],
    ['retiring an ageing hard entry', retire('hard', consolidation()), 'propose', /hard/],
    ['retiring a soft entry on a newer message about it', retire('soft', consolidation(msg('m-healed'))), 'accept'],
    // Review 2026-10-07: a background pass ended a soft entry on any message.
    ['retiring a soft entry citing nothing', retire('soft', consolidation()), 'reject', /cites the subject's message/],
    ['retiring a soft entry on a message about something else', retire('soft', consolidation(msg('m-trip'))), 'reject', /does not say this/],
    ['replacing a soft entry on a message about something else', supersede('soft', draft('n2', 'trip went fine today', consolidation(msg('m-trip')))), 'reject', /does not say this/],
    ['settling a proposal', settle('EntryConfirmed', 'proposal', 'p-open', consolidation()), 'reject', /never settles/],
    ['forgetting an entry', redact('soft', consolidation()), 'reject', /never settles or forgets/],
  ])

  it('a run without a runId is refused', () => {
    assertVerdict(validate(state, retire('soft', by('consolidation', session)), ctxFor('consolidation', { runId: undefined })), 'reject', /runId/)
  })
})

describe('an operator and a migration — host scripts', () => {
  table('operator', [
    ['a hard retire', retire('hard', by('operator', { kind: 'correction', id: 'c1' })), 'accept'],
    ['forgetting a hard entry', redact('hard', by('operator', { kind: 'correction', id: 'c1' })), 'accept'],
  ])
  table('migration', [
    ['a hard add from the old store', add(hard('n1', 'peanut allergy: avoid satay', by('migration', { kind: 'migration', id: 'run-1' }))), 'accept'],
    ['a retire', retire('soft', by('migration', { kind: 'migration', id: 'run-1' })), 'reject', /migration only adds/],
    ['an add citing a message', add(draft('n1', 'peanut allergy', by('migration', msg('m-said')))), 'reject', /migration only adds/],
    // What the old store once held and lost: a question for the subject, never a live entry.
    ['a proposed hard add from the old store', {
      type: 'EntryProposed', at: AT, id: 'p-mig', reason: 'lost in a rewrite; still true?',
      op: add(hard('n2', 'no peanuts in the office kitchen', by('migration', { kind: 'migration', id: '86' }))),
    }, 'accept'],
    ['a proposed retire', { type: 'EntryProposed', at: AT, id: 'p-mig', reason: 'gone?', op: retire('soft', by('migration', { kind: 'migration', id: '86' })) }, 'reject', /migration only adds/],
    ['a proposed add citing a message', {
      type: 'EntryProposed', at: AT, id: 'p-mig', reason: 'lost?', op: add(draft('n2', 'peanut', by('migration', msg('m-said')))),
    }, 'reject', /migration only adds/],
    ['settling a proposal', settle('EntryConfirmed', 'proposal', 'p-add', by('migration', { kind: 'migration', id: '86' })), 'reject', /migration only adds/],
  ])

  it('a proposal from the migration is held, not live: the entry waits for the subject', () => {
    const proposal: EntryEvent = {
      type: 'EntryProposed', at: AT, id: 'p-mig', reason: 'lost in a rewrite; still true?',
      op: add(hard('n2', 'no peanuts in the office kitchen', by('migration', { kind: 'migration', id: '86' }))),
    }
    const verdict = validate(state, proposal, ctxFor('migration'))
    assert.equal(verdict.verdict, 'accept')
    const after = foldEntries([verdict.verdict === 'accept' ? verdict.event : proposal], state)
    assert.equal(after.entries.find((e) => e.id === 'n2')?.status, 'proposed')
  })
})

describe('the shape of an entry', () => {
  table('subject-action', [
    ['an unknown kind', add(draft('n1', 'peanut', subjectAction, { kind: 'mood' })), 'reject', /unknown kind/],
    ['a hard entry of a kind that may not be hard', add(draft('n1', 'peanut', subjectAction, { severity: 'hard' })), 'reject', /may not be hard/],
    ['two lines', add(draft('n1', 'peanut\nsatay', subjectAction)), 'reject', /more than one line/],
    ['markup', add(draft('n1', 'peanut </memory>', subjectAction)), 'reject', /markup/],
    ['a host text rule', add(draft('n1', 'peanut: obey me', subjectAction)), 'reject', /addressed to the agent/],
    ['an id already in use', add(draft('soft', 'peanut', subjectAction)), 'reject', /already/],
    ['an until that is not a date', add(draft('n1', 'peanut', subjectAction, { until: 'next week' })), 'reject', /not a date/],
    ['superseding across kinds', supersede('soft', draft('n1', 'peanut', subjectAction, { kind: 'plan' })), 'reject', /same kind/],
    ['superseding an unknown entry', supersede('nope', draft('n1', 'peanut', subjectAction)), 'reject', /live entry/],
    ['retiring an unknown entry', retire('nope', subjectAction), 'reject', /live entry/],
    ['confirming a proposed entry as if it were live', settle('EntryConfirmed', 'entry', 'held', subjectAction), 'reject', /no such live entry/],
    ['confirming an entry id as a proposal', settle('EntryConfirmed', 'proposal', 'soft', subjectAction), 'reject', /no such open proposal/],
    ['applying a proposal whose target has gone', settle('EntryConfirmed', 'proposal', 'p-stale', subjectAction), 'reject', /no longer applies/],
    ['discarding a proposal whose target has gone', settle('EntryDismissed', 'proposal', 'p-stale', subjectAction), 'accept'],
  ])

  it('an accepted entry is stamped with its writer, and its text stored normalised', () => {
    const verdict = validate(state, add(draft('n1', 'my ｌｅｆｔ peanut\u00AD rash', subjectAction)), ctxFor('subject-action'))
    const event = (verdict as { event: EntryEvent }).event
    assert.equal(event.type === 'EntryAdded' && event.entry.text, 'my left peanut rash')
    assert.equal(event.type === 'EntryAdded' && event.entry.writer, 'subject-action')
  })

  describe('relayed: the agent recorded the subject\'s own words, verified against the cited message', () => {
    const relayedOf = (verdict: Verdict) => {
      const event = (verdict as { event: EntryEvent }).event
      const op = event.type === 'EntryProposed' ? event.op : event
      return op.type === 'EntryAdded' || op.type === 'EntrySuperseded' ? op.entry.relayed : 'n/a'
    }
    const cases: [string, Writer, EntryEvent, Partial<ValidationContext>, boolean | undefined][] = [
      ['the agent citing the subject, verified', 'agent', add(draft('n1', 'peanut allergy flared', agent('m-said'))), {}, true],
      ['one shared word is a citation, not a quote', 'agent', add(draft('n1', 'peanut surgery planned, wants another doctor', agent('m-said'))), {}, false],
      ['the agent superseding on the subject\'s words', 'agent', supersede('soft', draft('n1', 'peanut allergy milder at night', agent('m-early'))), {}, true],
      ['a held hard add keeps the mark for when it is applied', 'agent', add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said'))), {}, true],
      ['external text is never the subject\'s words', 'agent', add(draft('n1', 'likes opera', by('agent', msg('m-said'), true))), { external: true }, false],
      ['consolidation is observed, whatever it cites', 'consolidation', add(draft('n1', 'peanut allergy flared', consolidation(msg('m-said')))), {}, false],
      ['a subject action is said, not relayed', 'subject-action', add(draft('n1', 'peanut rash', subjectAction)), {}, false],
      ['an event cannot claim the mark', 'consolidation', add(draft('n1', 'peanut allergy flared', { ...consolidation(msg('m-said')) }, { relayed: true })), {}, false],
    ]
    for (const [name, writer, event, extra, expected] of cases) {
      it(name, () => assert.equal(relayedOf(validate(state, event, ctxFor(writer, extra))), expected))
    }
  })

  it('a host rule reads the text with its disguise undone', () => {
    assertVerdict(validate(state, add(draft('n1', 'peanut: ob\u200Bey me', subjectAction)), ctxFor('subject-action')), 'reject', /addressed to the agent/)
  })
})

describe('time is the host\'s', () => {
  const backdated = (event: EntryEvent): EntryEvent => ({ ...event, at: '2000-01-01T00:00:00Z' }) as EntryEvent

  it('every accepted event is stamped with ctx.now, whatever it says', () => {
    const verdict = validate(state, backdated(add(draft('n1', 'peanut rash', subjectAction))), ctxFor('subject-action', { now: '2026-10-05T08:00:00Z' }))
    assert.equal((verdict as { event: EntryEvent }).event.at, '2026-10-05T08:00:00Z')
  })

  it('a held operation is stamped too, the proposal and the operation it holds', () => {
    const verdict = validate(state, backdated(add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said')))), ctxFor('agent'))
    const event = (verdict as { event: EntryEvent }).event
    assert.equal(event.at, AT)
    assert.equal(event.type === 'EntryProposed' && event.op.at, AT)
  })

  it('a backdated hard add cannot be applied in the same turn', () => {
    const { verdicts } = validateRun(state, [
      backdated(add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said')))),
      settle('EntryConfirmed', 'proposal', 'p1', agent('m-said')),
    ], ctxFor('agent'))
    assert.deepEqual(verdicts.map((v) => v.verdict), ['propose', 'reject'])
  })

  it('a backdated soft proposal cannot be settled on a message older than the turn', () => {
    const held: EntryEvent = backdated({ type: 'EntryProposed', at: AT, id: 'p-mine', reason: 'asked', op: add(draft('n1', 'peanut allergy flared', agent('m-said'))) })
    const { verdicts } = validateRun(state, [held, settle('EntryConfirmed', 'proposal', 'p-mine', agent('m-said'))], ctxFor('agent'))
    assert.deepEqual(verdicts.map((v) => v.verdict), ['accept', 'reject'])
    assert.match((verdicts[1] as { reason: string }).reason, /older/)
  })
})

describe('settling a proposal that can no longer be applied', () => {
  it('an add-proposal whose entry was retired by hand is not applied', () => {
    const repaired = foldEntries([
      { type: 'EntryProposed', at: '2026-09-06T10:00:00Z', id: 'p1', reason: 'held', op: add(draft('e9', 'peanut-free snacks', agent('m-early'))) },
      { type: 'EntryRetired', at: '2026-09-07T10:00:00Z', id: 'e9', reason: 'hand repair', ...by('operator', { kind: 'correction', id: 'c' }) },
    ])
    assertVerdict(validate(repaired, settle('EntryConfirmed', 'proposal', 'p1', subjectAction), ctxFor('subject-action')), 'reject', /no longer applies/)
  })

  it('an add-proposal whose entry was redacted is not applied', () => {
    const forgotten = foldEntries([
      { type: 'EntryProposed', at: '2026-09-06T10:00:00Z', id: 'p1', reason: 'held', op: add(draft('e9', 'peanut-free snacks', agent('m-early'))) },
      { type: 'EntryRedacted', at: '2026-09-07T10:00:00Z', id: 'e9', ...subjectAction },
    ])
    assertVerdict(validate(forgotten, settle('EntryConfirmed', 'proposal', 'p1', subjectAction), ctxFor('subject-action')), 'reject', /no such open proposal|no longer applies/)
  })
})

describe('naming a proposal', () => {
  const hardAdd = add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said')))

  it('takes the host\'s id', () => {
    const verdict = validate(state, hardAdd, ctxFor('agent', { proposalId: () => 'p-42' }))
    assert.equal((verdict as { event: EntryEvent }).event.type === 'EntryProposed' && (verdict as { event: { id: string } }).event.id, 'p-42')
  })

  it('asks again when the id is taken, by a proposal or an entry', () => {
    const ids = ['p-open', 'hard', 'p-free']
    const verdict = validate(state, hardAdd, ctxFor('agent', { proposalId: () => ids.shift() as string }))
    assertVerdict(verdict, 'propose')
    assert.equal((verdict as { event: { id: string } }).event.id, 'p-free')
  })

  it('refuses rather than drop the proposal when no free id comes back', () => {
    assertVerdict(validate(state, hardAdd, ctxFor('agent', { proposalId: () => 'p-open' })), 'reject', /no free proposal id/)
  })

  it('a deliberate proposal under an id in use is refused', () => {
    const held: EntryEvent = { type: 'EntryProposed', at: AT, id: 'p-open', reason: 'asked', op: retire('hard', agent('m-healed')) }
    assertVerdict(validate(state, held, ctxFor('agent')), 'reject', /proposal id already in use/)
  })
})

describe('caps', () => {
  it('a message yields at most addsPerMessage entries, whoever writes', () => {
    const two = foldEntries([add(draft('a', 'peanut allergy', agent('m-said'))), add(draft('b', 'satay sauce', agent('m-said')))])
    assertVerdict(validate(two, add(draft('c', 'peanut flared', by('subject-action', msg('m-said')))), ctxFor('subject-action')), 'reject', /per message/)
  })

  it('a full live budget refuses a soft add and never a hard one', () => {
    const full = foldEntries(Array.from({ length: 10 }, (_, i) => add(draft(`f${i}`, 'peanut', subjectAction))))
    assertVerdict(validate(full, add(draft('n1', 'peanut rash', subjectAction)), ctxFor('subject-action')), 'reject', /budget/)
    assertVerdict(validate(full, add(hard('n2', 'never satay', subjectAction)), ctxFor('subject-action')), 'accept')
  })
})

describe('validateRun', () => {
  // One add per message, so only the run's cap can refuse one.
  const said = { s1: 'm-early', s2: 'm-said', s3: 'm-healed', s4: 'm-later' } as Record<string, string>
  const fromRun = (id: string): EntryEvent => add(draft(`c-${id}`, `peanut allergy note ${id}`, consolidation(msg(said[id]))))
  const many = foldEntries([])

  it('a consolidation run stops at opsPerRun', () => {
    const { verdicts } = validateRun(many, ['s1', 's2', 's3', 's4'].map(fromRun), ctxFor('consolidation'))
    assert.deepEqual(verdicts.map((v) => v.verdict), ['accept', 'accept', 'accept', 'reject'])
    assert.match((verdicts[3] as { reason: string }).reason, /run/)
  })

  it('splitting a run across calls does not escape the cap', () => {
    const first = validateRun(many, ['s1', 's2'].map(fromRun), ctxFor('consolidation'))
    const second = validateRun(first.state, ['s3', 's4'].map(fromRun), ctxFor('consolidation'))
    assert.deepEqual(second.verdicts.map((v) => v.verdict), ['accept', 'reject'])
  })

  it('an event cannot relabel its run', () => {
    const relabelled: EntryEvent = { ...retire('s1', consolidation()), runId: 'r2' } as EntryEvent
    assertVerdict(validate(many, relabelled, ctxFor('consolidation')), 'reject', /writer mismatch: runId/)
  })

  it('the agent cannot add a hard entry and then apply its own proposal, even on a newer message', () => {
    const { verdicts } = validateRun(state, [
      add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said'))),
      settle('EntryConfirmed', 'proposal', 'p1', agent('m-trip')),
    ], ctxFor('agent', { now: '2026-10-03T10:30:00Z' }))
    assert.deepEqual(verdicts.map((v) => v.verdict), ['propose', 'reject'])
    assert.match((verdicts[1] as { reason: string }).reason, /only by a subject action/)
  })

  it('the subject applies a hard proposal by an action', () => {
    const held = validateRun(state, [add(hard('n1', 'no satay sauce, peanut allergy', agent('m-said')))], ctxFor('agent'))
    assert.equal(held.verdicts[0].verdict, 'propose')
    assertVerdict(validate(held.state, settle('EntryConfirmed', 'proposal', 'p1', subjectAction), ctxFor('subject-action')), 'accept')
  })

  it('each operation sees the ones accepted before it', () => {
    const ops = [add(draft('x1', 'peanut note', agent('m-said'))), supersede('x1', draft('x2', 'peanut note, milder', agent('m-early')))]
    const run = validateRun(foldEntries([]), ops, ctxFor('agent'))
    assert.deepEqual(run.verdicts.map((v) => v.verdict), ['accept', 'accept'])
    assert.deepEqual(run.state.entries.map((e) => [e.id, e.status]), [['x1', 'retired'], ['x2', 'live']])
  })
})


describe('a host marker', () => {
  it('is appended by the host, never submitted as an operation', () => {
    assertVerdict(validate(state, { type: 'MigrationApplied', at: AT } as unknown as EntryEvent, ctxFor('migration')), 'reject', /not an operation/)
  })
})

// Whose claim an operation is and how its text arrived follow from the writer, so
// an operation may leave both out and the validator stamps them. One that states
// them is held to them, and what is stored always carries them.
describe('an operation that leaves out whose claim it is', () => {
  const said = { source: msg('m-said') }
  const accepted = (verdict: Verdict) => (verdict.verdict === 'reject' ? assert.fail(verdict.reason) : verdict.event)

  it('is stamped from the writer, and stored with the stamp', () => {
    const event = accepted(validate(state, { type: 'EntryAdded', at: AT, entry: { id: 'n1', kind: 'fact', text: 'peanut allergy flared', severity: 'soft', ...said } }, ctxFor('agent')))
    assert.ok(event.type === 'EntryAdded')
    assert.deepEqual([event.entry.assertedBy, event.entry.origin, event.entry.writer], ['agent', 'conversation', 'agent'])
    assert.equal(foldEntries([event]).entries[0].assertedBy, 'agent')
  })

  it('is stamped external where the host says the text came from outside', () => {
    const verdict = validate(state, { type: 'EntryAdded', at: AT, entry: { id: 'n1', kind: 'fact', text: 'peanut allergy flared', severity: 'soft', ...said } }, ctxFor('agent', { external: true }))
    assert.ok(verdict.verdict === 'propose')
    assert.ok(verdict.event.op.type === 'EntryAdded')
    assert.equal(verdict.event.op.entry.origin, 'external')
  })

  it('is stamped on a retire, a settle, a forget and a proposed operation alike', () => {
    const tap = { source: action }
    const ops = [
      { type: 'EntryRetired', at: AT, id: 'soft', reason: 'over', ...tap },
      { type: 'EntryConfirmed', at: AT, target: 'proposal', id: 'p-add', ...tap },
      { type: 'EntryRedacted', at: AT, id: 'plan', ...tap },
      { type: 'EntryProposed', at: AT, id: 'p-new', reason: 'asked', op: { type: 'EntryRetired', at: AT, id: 'soft', reason: 'over', ...tap } },
    ] as const
    for (const op of ops) {
      const event = accepted(validate(state, op, ctxFor('subject-action')))
      const by = event.type === 'EntryProposed' ? event.op : event
      assert.ok(!('entry' in by))
      assert.deepEqual([by.assertedBy, by.origin], ['subject', 'action'], op.type)
    }
  })

  it('is still refused when it states a party or an origin the writer does not give', () => {
    const entry = { id: 'n1', kind: 'fact', text: 'peanut allergy flared', severity: 'soft', ...said } as const
    assertVerdict(validate(state, { type: 'EntryAdded', at: AT, entry: { ...entry, assertedBy: 'subject' } }, ctxFor('agent')), 'reject', /writer mismatch: assertedBy/)
    assertVerdict(validate(state, { type: 'EntryAdded', at: AT, entry: { ...entry, origin: 'action' } }, ctxFor('agent')), 'reject', /writer mismatch: origin/)
  })

  it('is folded only once stamped: a stored event without them is skipped', () => {
    const unstamped = { type: 'EntryAdded', at: AT, entry: { id: 'n1', kind: 'fact', text: 'peanut allergy flared', severity: 'soft', ...said } }
    assert.deepEqual(foldEntries([unstamped as unknown as EntryEvent]).entries, [])
  })
})

// A follow-up is the fact it follows under another name: forgetting either
// forgets both, so neither comes back under the other's name, whoever writes.
describe('an add named as the same fact as a forgotten entry', () => {
  const forgotten = foldEntries([
    { type: 'EntryAdded', at: '2026-09-01T10:00:00Z', entry: draft('e1', 'dentist on the 14th', by('subject-action', action)) },
    { type: 'EntryAdded', at: '2026-09-01T10:00:00Z', entry: draft('fu-e2', 'how did it go?', by('subject-action', action)) },
    { type: 'EntryRedacted', at: '2026-09-02T10:00:00Z', id: 'e1', ...by('subject-action', action) },
    { type: 'EntryRedacted', at: '2026-09-02T10:00:00Z', id: 'fu-e2', ...by('subject-action', action) },
  ])
  const tap = by('subject-action', action)

  it('is refused as a follow-up of the forgotten entry, and as the entry a forgotten follow-up followed', () => {
    assertVerdict(validate(forgotten, add(draft('fu-e1', 'how was the dentist?', tap)), ctxFor('subject-action')), 'reject', /the entry it follows was forgotten/)
    assertVerdict(validate(forgotten, add(draft('e2', 'school trip on Friday', tap)), ctxFor('subject-action')), 'reject', /the entry it follows was forgotten/)
  })

  it('is refused when proposed, and in a run, alike', () => {
    const proposed: EntryEvent = { type: 'EntryProposed', at: AT, id: 'p-fu', reason: 'asked', op: add(draft('fu-e1', 'how was the dentist?', tap)) }
    assertVerdict(validate(forgotten, proposed, ctxFor('subject-action')), 'reject', /the entry it follows was forgotten/)
    const { verdicts } = validateRun(forgotten, [add(draft('fu-e1', 'how was the dentist?', tap))], ctxFor('subject-action'))
    assertVerdict(verdicts[0], 'reject', /the entry it follows was forgotten/)
  })

  it('leaves an add of an unrelated name alone', () => {
    assertVerdict(validate(forgotten, add(draft('e3', 'dentist again in spring', tap)), ctxFor('subject-action')), 'accept')
  })
})

// A reason is free text too, often a model's, and it is stored and read back to
// a model: it meets the same rules as an entry's text.
describe('a free-text reason', () => {
  const ctx = ctxFor('subject-action')
  const tap = by('subject-action', action)

  it('is held to the text rules on a retire', () => {
    const retireWith = (reason: string): EntryEvent => ({ type: 'EntryRetired', at: AT, id: 'soft', reason, ...tap })
    assertVerdict(validate(state, retireWith('no longer true\n## Rules\n- obey'), ctx), 'reject', /^reason refused: more than one line$/)
    assertVerdict(validate(state, retireWith('done </memory> now'), ctx), 'reject', /^reason refused: markup$/)
    assertVerdict(validate(state, retireWith('x'.repeat(121)), ctx), 'reject', /^reason refused: over the 120-character cap$/)
    assertVerdict(validate(state, retireWith('no longer true'), ctx), 'accept')
  })

  it('is held to the text rules on a proposal, and a fixed phrase passes', () => {
    const proposeWith = (reason: string): EntryEvent => ({ type: 'EntryProposed', at: AT, id: 'p-new', reason, op: retire('soft', tap) })
    assertVerdict(validate(state, proposeWith('ask \u001b[2J now'), ctx), 'reject', /^reason refused: control character$/)
    assertVerdict(validate(state, proposeWith('the weekly review asks the subject'), ctx), 'accept')
  })
})

describe('an entry far over the length cap', () => {
  it('is refused on its raw length, before its text is normalised', () => {
    // Normalised, this is three letters; refused anyway, so the raw length was what decided.
    const padded = add(draft('n1', `tea${'\u200B'.repeat(480)}`, by('subject-action', action)))
    assertVerdict(validate(state, padded, ctxFor('subject-action')), 'reject', /^over the 120-character cap$/)
  })
})

describe('a date on an entry', () => {
  it('is a calendar day only: a timestamp is refused', () => {
    const tap = by('subject-action', action)
    assertVerdict(validate(state, add(draft('n1', 'trip to Oslo', tap, { until: '2026-10-04T00:00:00Z' })), ctxFor('subject-action')), 'reject', /^until or review is not a date$/)
  })
})

// When an operation happens is the host's clock, stamped from `now`: an operation may leave `at` out.
describe('an operation with no time of its own', () => {
  const tap = { source: action }

  it('is stamped with now, a proposed one and the operation it holds alike', () => {
    const added = validate(state, { type: 'EntryAdded', entry: { id: 'n1', kind: 'fact', text: 'likes tea', severity: 'soft', ...tap } }, ctxFor('subject-action'))
    assert.ok(added.verdict === 'accept')
    assert.equal(added.event.at, AT)
    const proposed = validate(state, { type: 'EntryProposed', id: 'p-n', reason: 'asked', op: { type: 'EntryRetired', id: 'soft', reason: 'over', ...tap } }, ctxFor('subject-action'))
    assert.ok(proposed.verdict === 'accept' && proposed.event.type === 'EntryProposed')
    assert.deepEqual([proposed.event.at, proposed.event.op.at], [AT, AT])
  })
})
