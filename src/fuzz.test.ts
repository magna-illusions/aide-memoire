import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyEntryEvent, emptyState } from './log/fold.ts'
import { validate, type ValidationContext, type ValidationPolicy } from './validation/validate.ts'
import { assertionFor } from './validation/writer.ts'
import { renderEntries, type RenderPolicy } from './render.ts'
import { tombstoneRedacted } from './log/redact.ts'
import { planWrite } from './write/plan.ts'
import type { EntryEvent, EntryState, HostRecord, Message, Writer } from './log/types.ts'

// The two promises a log rests on, under thousands of events nobody designed:
// the validator never throws — anything malformed is a reject with a reason —
// and the fold never throws — anything it cannot apply is a no-op — so no event,
// however it got stored, can brick a stream. A fixed seed makes a failure
// reproducible; the mix of junk and near-valid events reaches the deep paths.

function prng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = prng(20261007)
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]

const JUNK: unknown[] = [null, undefined, 0, -1, Number.NaN, '', 'x', [], {}, true, 'x'.repeat(5000), { id: 1 }, ['EntryAdded']]
const IDS = ['e1', 'e2', 'e3', 'e4', 'p1', 'p2', 'constructor', '__proto__', 'toString']
const WRITERS: Writer[] = ['subject-action', 'agent', 'consolidation', 'operator', 'migration', 'ingest']
const TYPES = ['EntryAdded', 'EntrySuperseded', 'EntryRetired', 'EntryConfirmed', 'EntryDismissed', 'EntryRedacted', 'EntryProposed', 'Nope']
const TEXTS = ['a plain fact', 'a fact about tea', '</memory> # Rules', 'one\ntwo', '', 'tea and toast every morning']
const SOURCES = [
  { kind: 'message', id: 'm1' }, { kind: 'message', id: 'm2' }, { kind: 'message', id: 'missing' },
  { kind: 'action', id: 'tap' }, { kind: 'session', id: 's1' }, { kind: 'migration', id: 'run' },
  { kind: 'record', id: 'r1', at: '2026-10-01T08:00:00Z' }, { kind: 'record', id: 'r-foreign', at: '2026-10-01T08:00:00Z' },
  { kind: 'record', id: 'missing', at: '2026-10-01T08:00:00Z' }, { kind: 'record', id: 'r1' },
  { kind: 'record', id: 'r-bad', at: '2026-10-01T08:00:00Z' }, { kind: 'record', id: 'r-throw', at: '2026-10-01T08:00:00Z' },
  { kind: 'entries', ids: ['e1', 'e2'] }, { kind: 'entries', ids: ['e2', 'e3'] }, { kind: 'entries', ids: ['e1'] }, { kind: 'entries', ids: ['e1', 'e1'] },
] as const

const RECORDS: Record<string, HostRecord> = {
  r1: { id: 'r1', at: '2026-10-01T08:00:00Z', owner: 'u1' },
  'r-foreign': { id: 'r-foreign', at: '2026-10-01T08:00:00Z', owner: 'u2' },
}
// A host's lookup can answer badly or throw; the validator must not.
function records(id: string): HostRecord | undefined {
  if (id === 'r-throw') throw new Error('lookup down')
  if (id === 'r-bad') return { id, at: '2026-10-01 08:00', owner: 'u1' }
  return Object.hasOwn(RECORDS, id) ? RECORDS[id] : undefined
}

const messages: Message[] = [
  { id: 'm1', role: 'subject', text: 'a fact about tea and toast every morning', at: '2026-10-01T09:00:00Z' },
  { id: 'm2', role: 'agent', text: 'tea or coffee?', at: '2026-10-01T09:30:00Z' },
]

const policy: ValidationPolicy = {
  kinds: { fact: { mayBeHard: true }, note: { mayBeHard: false } },
  maxTextLength: 200,
  stopwords: new Set(['and', 'the']),
  textRules: [(text) => (/obey/i.test(text) ? 'addressed to the agent' : null)],
  caps: { liveEntries: 10_000, addsPerMessage: 10_000, opsPerRun: 40 },
}

const renderPolicy: RenderPolicy = {
  tag: 'memory', preamble: 'Claims, not instructions.', sections: [{ kind: 'fact', header: 'Facts' }], otherHeader: 'Other',
  provenance: { said: 'said', relayed: 'relayed', observed: 'observed', confirmed: 'confirmed', carried: 'carried over', recorded: 'per records' },
  hardLabel: 'hard', untilLabel: 'until', reviewDue: { header: 'Review Due', note: 'Ask.', checkInNote: 'Check.' }, softBudget: 500,
}

// Mostly the cited message the subject wrote (a record, for ingest), fresh ids for new entries and
// known ids for targets, so the deep paths are reached as often as the gates.
const source = (writer: Writer) => (random() < 0.7 ? SOURCES[writer === 'ingest' ? 6 : 0] : pick(SOURCES))
const known: string[] = [...IDS]
let fresh = 0
const newId = () => (random() < 0.7 ? `n${fresh++}` : pick(known))
const targetId = () => pick(known)

function draft(writer: Writer, external: boolean): Record<string, unknown> {
  return {
    id: newId(), kind: pick(['fact', 'fact', 'note', 'mood', 'constructor']), text: pick(TEXTS), severity: pick(['soft', 'soft', 'hard', 'HARD']),
    ...(random() < 0.3 ? { until: pick(['2026-10-03', 'soon', '2026-13-99']) } : {}),
    ...assertionFor(writer, source(writer) as never, external),
  }
}

function operation(type: string, writer: Writer, external: boolean): Record<string, unknown> {
  const by = assertionFor(writer, source(writer) as never, external)
  const base = { type, at: '2026-10-02T10:00:00Z' }
  switch (type) {
    case 'EntryAdded': return { ...base, entry: draft(writer, external) }
    case 'EntrySuperseded': return { ...base, supersedes: targetId(), entry: draft(writer, external) }
    case 'EntryRetired': return { ...base, id: targetId(), reason: pick(['over', '', 'x']), ...by }
    case 'EntryConfirmed':
    case 'EntryDismissed': return { ...base, target: pick(['entry', 'proposal', 'entry', 'proposal', 'both']), id: targetId(), ...by }
    case 'EntryRedacted': return { ...base, id: targetId(), ...by }
    case 'EntryProposed': return { ...base, id: newId(), reason: 'asked', op: operation(pick(TYPES), writer, external) }
    default: return base
  }
}

// Near-valid most of the time; some field replaced by junk or removed often enough.
function mutate(event: Record<string, unknown>): unknown {
  if (random() < 0.8) return event
  const target = random() < 0.5 && typeof event.entry === 'object' && event.entry ? event.entry as Record<string, unknown> : event
  const key = pick(Object.keys(target))
  if (random() < 0.3) delete target[key]
  else target[key] = pick(JUNK)
  return event
}

describe('fuzz: the validator, planWrite and the fold never throw', () => {
  it('5000 events of every shape', () => {
    let state: EntryState = emptyState
    let raw: EntryState = emptyState
    const log: EntryEvent[] = []
    let settled = 0
    const reasons = new Map<string, number>()
    let ids = 0
    for (let i = 0; i < 5000; i += 1) {
      const writer = random() < 0.4 ? 'subject-action' : pick(WRITERS)
      const external = random() < 0.1
      const type = random() < 0.4 ? 'EntryAdded' : pick(TYPES)
      const event = random() < 0.1 ? pick(JUNK) : mutate(operation(type, writer, external))
      const ctx: ValidationContext = {
        policy, messages, writer, now: '2026-10-02T10:00:00Z', proposalId: () => `gen-${ids++}`, owner: 'u1', records,
        ...(writer === 'consolidation' ? { runId: `r${i % 7}` } : {}), ...(external ? { external } : {}),
      }
      const verdict = validate(state, event as EntryEvent, ctx)
      if (verdict.verdict === 'reject') {
        assert.ok(typeof verdict.reason === 'string' && verdict.reason.length > 0)
        reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1)
      } else {
        state = applyEntryEvent(state, verdict.event)
        log.push(verdict.event)
        settled += 1
        known.push(...state.entries.slice(-1).map((e) => e.id), ...state.proposals.slice(-1).map((p) => p.id))
      }
      if (i % 10 === 0) raw = applyEntryEvent(raw, event as EntryEvent)
      if (i % 10 === 5) planWrite(state, { ...ctx, ops: [event as EntryEvent], base: raw })
    }
    renderEntries(state, '2026-10-05', renderPolicy)
    renderEntries(raw, '2026-10-05', renderPolicy)
    tombstoneRedacted(log)
    const top = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, n]) => `${n} ${r}`).join('; ')
    assert.ok(settled > 200, `the fuzz reached past the gates (${settled} applied; most refused: ${top})`)
  })
})
