import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertionFor } from '../validation/writer.ts'
import type { EntryEvent, Message } from '../log/types.ts'
import { dreamWeekly, type ReviewDeps } from './review.ts'
import type { ReviewPrompt, ReviewWording } from './review-prompt.ts'
import { KINDS, POLICY } from './fixtures/fixture.ts'
import { counter, memoryHost } from './fixtures/host.ts'

// The weekly review over the real validator and an in-memory host; the model's
// answer and the reads are faked. What is proved: it only asks, only about
// contradictions, and it pays for at most one call a week — and none when no
// two entries of a kind share a topic.

const OWNER = 'subject-1'
const said = (id: string, at: string, text: string): Message => ({ id, role: 'subject', text, at })
const MESSAGES = [
  said('a1', '2026-09-20T09:00:00.000Z', 'Early meetings work best for me'),
  said('a2', '2026-09-27T09:00:00.000Z', 'Had early meetings again, much better than evenings'),
  said('a3', '2026-10-04T09:00:00.000Z', 'Early meetings are my thing'),
]
const WORDING: ReviewWording = { memory: "an assistant's memory of one person", subject: 'the person', rules: ['Write in the language the messages use.'] }

const habit = (id: string, text: string, source: string): EntryEvent => ({ type: 'EntryAdded', at: '', entry: { id, kind: 'habit', text, severity: 'soft', ...assertionFor('agent', { kind: 'message', id: source }) } })
const tool = (operations: unknown[]) => ({ operations })

// Two habits about mornings that cannot both hold: the pair the review compares.
async function setup(answer: unknown, messages = MESSAGES) {
  const host = memoryHost()
  await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[0]], now: '2026-09-20T10:00:00.000Z', ops: [habit('e1', 'Wants to manage early meetings', 'a1')] })
  await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[1]], now: '2026-09-27T10:00:00.000Z', ops: [habit('e3', 'Prefers evenings, early meetings do not work', 'a2')] })
  let calls = 0
  let seen: ReviewPrompt | undefined
  const deps: ReviewDeps = {
    loadEntries: host.load,
    loadMessages: async () => messages,
    runRecorded: host.runRecorded,
    ask: async (prompt) => { calls += 1; seen = prompt; return answer },
    write: host.write,
    newId: counter(),
    policy: POLICY,
    kinds: KINDS,
    wording: WORDING,
    today: '2026-10-07',
    now: () => '2026-10-07T03:00:00.000Z',
  }
  return { host, deps, calls: () => calls, seen: () => seen }
}

const openQuestions = async (host: ReturnType<typeof memoryHost>) => (await host.load()).proposals.filter((p) => p.status === 'open')

describe('dreamWeekly', () => {
  it('holds a contradiction the model records as a question', async () => {
    const { host, deps } = await setup(tool([{ op: 'retire', target: 'e3', reason: 'early meetings work now', cites: 'm3' }]))
    const out = await dreamWeekly(OWNER, deps)
    assert.equal(out.proposed, 1)
    const open = await openQuestions(host)
    assert.deepEqual(open.map((p) => [p.op.type, p.reason]), [['EntryRetired', 'the weekly review asks the subject']])
  })

  it('writes as the actor it is given, and its questions carry it', async () => {
    const { host, deps } = await setup(tool([{ op: 'retire', target: 'e3', reason: 'early meetings work now', cites: 'm3' }]))
    await dreamWeekly(OWNER, { ...deps, actor: 'weekly-review' })
    const open = await openQuestions(host)
    assert.deepEqual(open.map((p) => p.op.type === 'EntryRetired' && p.op.actor), ['weekly-review'])
  })

  it('drops an add: the review only asks about the entries it compared', async () => {
    const { deps } = await setup(tool([{ op: 'propose', proposes: 'add', kind: 'habit', severity: 'soft', text: 'Prefers early meetings to evenings', cites: 'm2' }]))
    const out = await dreamWeekly(OWNER, deps)
    assert.deepEqual([out.proposed, out.dropped], [0, ['the review only proposes changes to the entries it compared']])
  })

  it('drops a change to an entry it was not shown', async () => {
    const { host, deps } = await setup(tool([{ op: 'retire', target: 'e4', reason: 'stopped', cites: 'm3' }]))
    const cello = said('a4', '2026-10-04T07:00:00.000Z', 'Started learning the cello')
    await host.write(OWNER, { writer: 'agent', messages: [cello], now: '2026-10-04T08:00:00.000Z', ops: [habit('e4', 'Learning the cello', 'a4')] })
    const out = await dreamWeekly(OWNER, deps)
    assert.deepEqual([out.proposed, out.dropped], [0, ['the review only proposes changes to the entries it compared']])
  })

  it('is sent only the pairs of one kind that share a topic, and the messages that speak of them', async () => {
    const cello = said('a4', '2026-10-05T09:00:00.000Z', 'Played the cello for an hour')
    const { host, deps, seen } = await setup(tool([]), [...MESSAGES, cello])
    await host.write(OWNER, { writer: 'agent', messages: [cello], now: '2026-10-05T10:00:00.000Z', ops: [habit('e4', 'Learning the cello', 'a4')] })
    await dreamWeekly(OWNER, deps)
    const user = seen()?.user ?? ''
    assert.match(user, /## Pairs to compare[^\n]*\n- e1 ↔ e3\n\n/)
    assert.doesNotMatch(user, /cello/)
    for (const [i, m] of MESSAGES.entries()) assert.match(user, new RegExp(`<msg id="m${i + 1}" date="${m.at.slice(0, 10)}">${m.text}</msg>`))
  })

  it('makes no call at all when no two entries of a kind share a topic, or only copies do', async () => {
    const { host, deps, calls } = await setup(tool([]))
    await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[2]], now: '2026-10-04T10:00:00.000Z', ops: [
      { type: 'EntryRetired', at: '', id: 'e3', reason: 'said so', ...assertionFor('agent', { kind: 'message', id: 'a3' }) },
      habit('e2', 'Wants to manage early meetings every week', 'a3'),
    ] })
    assert.equal((await dreamWeekly(OWNER, deps)).skipped, 'no pairs')
    assert.equal(calls(), 0)
  })

  it('calls the model once a week, whatever it answered', async () => {
    const { deps, calls } = await setup(null)
    const first = await dreamWeekly(OWNER, deps)
    const again = await dreamWeekly(OWNER, { ...deps, today: '2026-10-11' })
    const nextWeek = await dreamWeekly(OWNER, { ...deps, today: '2026-10-12' })
    assert.deepEqual([first.noCall, again.skipped, nextWeek.skipped], [true, 'done this week', undefined])
    assert.equal(calls(), 2)
  })

  it('names the run by its period, weekly by default, and every `everyDays` days when the policy says', async () => {
    const { host, deps } = await setup(null)
    assert.equal((await dreamWeekly(OWNER, deps)).runId, 'dream-model-2026-10-05')
    assert.equal(await host.runRecorded(OWNER, 'dream:dream-model-2026-10-05'), true)
    const fortnightly = { ...deps, policy: { ...POLICY, review: { ...POLICY.review, everyDays: 14 } } }
    assert.equal((await dreamWeekly(OWNER, { ...fortnightly, today: '2026-10-08' })).runId, 'dream-model-2026-09-28')
    assert.equal((await dreamWeekly(OWNER, { ...fortnightly, today: '2026-10-11' })).skipped, 'done this week')
  })

  it('takes a changed period at once: the renamed period runs that day, once, then holds for its length', async () => {
    const { deps, calls } = await setup(null)
    const monthly = { ...deps, policy: { ...POLICY, review: { ...POLICY.review, everyDays: 30 } } }
    const weekly = await dreamWeekly(OWNER, { ...deps, today: '2026-10-13' })
    const renamed = await dreamWeekly(OWNER, { ...monthly, today: '2026-10-13' })
    const later = await dreamWeekly(OWNER, { ...monthly, today: '2026-10-20' })
    assert.deepEqual([weekly.runId, renamed.runId, renamed.skipped, later.skipped], ['dream-model-2026-10-12', 'dream-model-2026-10-08', undefined, 'done this week'])
    assert.equal(calls(), 2)
  })

  it('refuses a today that is not a calendar day, before reading anything', async () => {
    const { deps, calls } = await setup(null)
    await assert.rejects(dreamWeekly(OWNER, { ...deps, today: '2026-02-29' }), { name: 'TypeError', message: /today must be a calendar day/ })
    assert.equal(calls(), 0)
  })

  it('refuses a period that is not a whole number of days, before reading anything', async () => {
    const { deps, calls } = await setup(null)
    const broken = { ...deps, policy: { ...POLICY, review: { ...POLICY.review, everyDays: 0 } } }
    await assert.rejects(dreamWeekly(OWNER, broken), { name: 'TypeError', message: /review\.everyDays/ })
    assert.equal(calls(), 0)
  })

  it('still pays at most once a period without runRecorded, which only skips early', async () => {
    const { deps, calls } = await setup(null)
    const { runRecorded: _, ...withoutLookup } = deps
    const first = await dreamWeekly(OWNER, withoutLookup)
    const again = await dreamWeekly(OWNER, { ...withoutLookup, today: '2026-10-11' })
    assert.deepEqual([first.noCall, again.skipped], [true, 'done this week'])
    assert.equal(calls(), 1)
  })

  it('a call that fails after it was billed is not paid for again that week', async () => {
    const { deps, calls } = await setup(tool([]))
    const failing: ReviewDeps = { ...deps, ask: async (prompt, owner) => { await deps.ask(prompt, owner); throw new Error('cut off at the token ceiling') } }
    await assert.rejects(dreamWeekly(OWNER, failing), /ceiling/)
    assert.equal((await dreamWeekly(OWNER, { ...deps, today: '2026-10-08' })).skipped, 'done this week')
    assert.equal(calls(), 1)
  })

  it('makes no call while five questions already wait', async () => {
    const { host, deps, calls } = await setup(tool([]))
    const ask = (i: number, source: string): EntryEvent => ({ type: 'EntryProposed', at: '', id: `p_q${i}`, reason: 'held', op: { type: 'EntryAdded', at: '', entry: { id: `q${i}`, kind: 'habit', text: `Likes early meetings ${i}`, severity: 'soft', ...assertionFor('agent', { kind: 'message', id: source }) } } })
    await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[0]], now: '2026-09-21T10:00:00.000Z', ops: [ask(1, 'a1'), ask(2, 'a1')] })
    await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[1]], now: '2026-09-28T10:00:00.000Z', ops: [ask(3, 'a2'), ask(4, 'a2')] })
    await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[2]], now: '2026-10-05T10:00:00.000Z', ops: [ask(5, 'a3')] })
    assert.equal((await openQuestions(host)).length, 5)
    assert.equal((await dreamWeekly(OWNER, deps)).skipped, 'no room')
    assert.equal(calls(), 0)
  })

  // The subject said no to rewording e1 as "prefers early meetings" a week ago.
  async function dismissedMornings(host: ReturnType<typeof memoryHost>) {
    await host.write(OWNER, {
      writer: 'agent', messages: [MESSAGES[1]], now: '2026-09-27T11:00:00.000Z',
      ops: [{ type: 'EntryProposed', at: '', id: 'p_old', reason: 'held', op: { type: 'EntrySuperseded', at: '', supersedes: 'e1', entry: { id: 'old', kind: 'habit', text: 'Prefers early meetings to evenings', severity: 'soft', ...assertionFor('agent', { kind: 'message', id: 'a2' }) } } }],
    })
    await host.write(OWNER, { writer: 'subject-action', messages: [], now: '2026-09-28T10:00:00.000Z', ops: [{ type: 'EntryDismissed', at: '', target: 'proposal', id: 'p_old', ...assertionFor('subject-action', { kind: 'action', id: 'tap-1' }) }] })
  }

  it('is shown what the subject dismissed, as data, and told not to ask again', async () => {
    const { host, deps, seen } = await setup(tool([]))
    await dismissedMornings(host)
    await dreamWeekly(OWNER, deps)
    assert.match(seen()?.user ?? '', /## Dismissed by the person[^\n]*\n- \[p_old · change · habit · asked 2026-09-27\] Prefers early meetings to evenings/)
  })

  it('drops a proposal that rewords one the subject dismissed, before the validator, by its reason', async () => {
    const { host, deps } = await setup(tool([{ op: 'propose', proposes: 'supersede', target: 'e1', kind: 'habit', severity: 'soft', text: 'Prefers the early meetings to evenings', cites: 'm3' }]))
    await dismissedMornings(host)
    const out = await dreamWeekly(OWNER, deps)
    assert.deepEqual([out.proposed, out.dropped], [0, ['repeats a proposal the subject dismissed']])
    assert.equal((await openQuestions(host)).length, 0)
  })

  it('never reads the message a forgotten entry was recorded from', async () => {
    const { host, deps, seen } = await setup(tool([]))
    await host.write(OWNER, { writer: 'subject-action', messages: [], now: '2026-10-05T10:00:00.000Z', ops: [{ type: 'EntryRedacted', at: '', id: 'e1', ...assertionFor('subject-action', { kind: 'action', id: 'forget' }) }] })
    await host.write(OWNER, { writer: 'agent', messages: [MESSAGES[2]], now: '2026-10-05T11:00:00.000Z', ops: [habit('e2', 'Early meetings are my thing', 'a3')] })
    await dreamWeekly(OWNER, deps)
    const user = seen()?.user ?? ''
    assert.doesNotMatch(user, new RegExp(MESSAGES[0].text))
    assert.match(user, new RegExp(MESSAGES[1].text))
    assert.match(user, new RegExp(MESSAGES[2].text))
  })

  it('makes no call for a subject who said nothing in the window', async () => {
    const { deps, calls } = await setup(tool([]), [])
    assert.equal((await dreamWeekly(OWNER, deps)).skipped, 'no messages')
    assert.equal(calls(), 0)
  })
})
