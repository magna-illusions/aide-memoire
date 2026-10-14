import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderEntries } from '../render.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Message } from '../log/types.ts'
import { dreamDaily, DREAM_MARKER, type DreamDeps } from './run.ts'
import { POLICY, RENDER } from './fixtures/fixture.ts'
import { counter, memoryHost } from './fixtures/host.ts'

// A day's pass end to end over the real validator and an in-memory host: only
// the host's reads are faked.

const OWNER = 'subject-1'
const PLAN: Message = { id: 'plan', role: 'subject', text: 'I sit the pilot licence exam on October 10', at: '2026-08-01T09:00:00.000Z' }

async function setup() {
  const host = memoryHost()
  await host.write(OWNER, {
    writer: 'agent', messages: [PLAN], now: '2026-08-01T10:00:00.000Z',
    ops: [{ type: 'EntryAdded', at: '', entry: { id: 'exam', kind: 'plan', text: 'Sitting the pilot licence exam', severity: 'soft', until: '2026-10-10', ...assertionFor('agent', { kind: 'message', id: 'plan' }) } }],
  })
  const deps = (today: string): DreamDeps => ({
    loadEntries: host.load,
    loadMessages: async () => [],
    // The plan is older than the window: it is found only as the exam's own source.
    loadCited: async (_owner, ids) => (ids.includes('plan') ? [PLAN] : []),
    loadActivityDays: async () => [],
    loadRecords: null,
    write: host.write,
    newId: counter(),
    policy: POLICY,
    today,
    now: () => `${today}T03:00:00.000Z`,
  })
  return { host, deps }
}

describe('dreamDaily', () => {
  it('follows up a passed event, citing the message it was planned in, and a reader sees it', async () => {
    const { host, deps } = await setup()
    const out = await dreamDaily(OWNER, deps('2026-10-11'))
    assert.deepEqual({ found: out.found, accepted: out.accepted, rejected: out.rejected }, { found: { 'follow-up': 1 }, accepted: 1, rejected: [] })
    assert.match(renderEntries(await host.load(), '2026-10-11T04:00:00Z', RENDER).text, /how it went is not known yet: Sitting the pilot licence exam/)
  })

  it('ends an older copy citing the message the newer copy was recorded from, however old', async () => {
    const { host, deps } = await setup()
    const again: Message = { id: 'again', role: 'subject', text: 'I sit the pilot licence exam in October, still', at: '2026-08-02T09:00:00.000Z' }
    await host.write(OWNER, {
      writer: 'agent', messages: [again], now: '2026-08-02T10:00:00.000Z',
      ops: [{ type: 'EntryAdded', at: '', entry: { id: 'exam-again', kind: 'plan', text: 'Sitting the pilot licence exam in October', severity: 'soft', ...assertionFor('agent', { kind: 'message', id: 'again' }) } }],
    })
    const day = deps('2026-09-20')
    const out = await dreamDaily(OWNER, { ...day, loadCited: async (_owner, ids) => [PLAN, again].filter((m) => ids.includes(m.id)) })
    assert.deepEqual({ found: out.found, accepted: out.accepted, rejected: out.rejected }, { found: { duplicate: 1 }, accepted: 1, rejected: [] })
  })

  it('a second pass the same day appends nothing, and a day with nothing to do writes nothing', async () => {
    const { host, deps } = await setup()
    const unread = await host.load()
    await dreamDaily(OWNER, deps('2026-10-11'))
    const before = host.log.length
    // A second replica that read the log before the first one wrote: it finds the same, and the run's key stops it.
    const replica = await dreamDaily(OWNER, { ...deps('2026-10-11'), loadEntries: async () => unread })
    await dreamDaily(OWNER, deps('2026-10-11'))
    await dreamDaily(OWNER, deps('2026-10-12'))
    assert.deepEqual([replica.found, replica.duplicate], [{ 'follow-up': 1 }, true])
    assert.equal(host.log.length, before)
    assert.deepEqual(host.markers, [{ type: DREAM_MARKER, payload: { runId: 'dream-2026-10-11', pass: 'daily', operations: 1 } }])
  })
})

describe('dreamDaily with an actor', () => {
  it('writes as that actor, and the entries it adds carry it', async () => {
    const { host, deps } = await setup()
    await dreamDaily(OWNER, { ...deps('2026-10-11'), actor: 'nightly-tidy' })
    const added = (await host.load()).entries.filter((e) => e.writer === 'consolidation')
    assert.deepEqual(added.map((e) => e.actor), ['nightly-tidy'])
  })
})

describe('dreamDaily on a day that is not one', () => {
  it('rejects before it reads anything', async () => {
    const { deps } = await setup()
    let reads = 0
    const counted = { ...deps('2026-02-29'), loadEntries: async () => { reads += 1; return { entries: [], proposals: [], runs: {} } } }
    await assert.rejects(dreamDaily(OWNER, counted), { name: 'TypeError', message: /today must be a calendar day/ })
    assert.equal(reads, 0)
  })
})
