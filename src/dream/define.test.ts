import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defineMemory } from '../memory/define.ts'
import { definePasses } from './define.ts'
import { dailyPlan } from './plan.ts'
import { normaliseText, textProblem } from '../text.ts'
import { valueOf } from './reality.ts'
import { addDays } from './days.ts'
import { add } from '../memory/ops.ts'

// definePasses derives what a pass shares with the memory, and fills the rest
// with defaults that leave every job needing your words or kinds switched off.

const memory = defineMemory({
  kinds: { rule: { mayBeHard: true, protected: true }, plan: { mayBeHard: false }, note: { mayBeHard: false } },
  render: { tag: 'notes', preamble: 'P' }, stopwords: ['the'], caps: { addsPerMessage: 2, opsPerRun: 7 },
})

describe('definePasses — derived from the memory', () => {
  it('takes the stopwords, the per-message cap, the per-run cap and the protected kinds from it', () => {
    const passes = definePasses(memory)
    assert.equal(passes.stopwords, memory.policy.stopwords)
    assert.deepEqual([passes.addsPerMessage, passes.maxOpsPerRun, passes.protectedKinds], [2, 7, ['rule']])
  })

  it('takes them from the consolidation writer\'s limits, where the memory sets its own', () => {
    const limited = defineMemory({
      kinds: { note: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'P' }, maxTextLength: 200,
      writers: { consolidation: { maxTextLength: 120, caps: { opsPerRun: 4 } } },
    })
    const passes = definePasses(limited, { followUp: { kinds: ['note'], kind: 'note' } })
    assert.equal(passes.maxOpsPerRun, 4)
    assert.equal(passes.followUp.text('x'.repeat(200), '2026-10-10').length, 120)
  })
})

describe('definePasses — the defaults', () => {
  const { followUp, checkIn, duplicate, recurrence, review, reality, ...rest } = definePasses(memory)

  it('leaves follow-ups, corrections from records, recurrence and copies off, until you name their kinds or words', () => {
    assert.deepEqual({ ...followUp, text: undefined }, { kinds: [], windowDays: 7, horizonDays: 7, kind: '', text: undefined })
    assert.deepEqual({ ...reality, text: undefined }, { kind: '', unit: '', tolerance: 0.15, text: undefined })
    assert.deepEqual(recurrence, { kinds: [], windowDays: 28, share: 0.6, messages: 3, sessions: 2 })
    assert.deepEqual(duplicate, { share: 0.8, negations: new Set() })
  })

  it('checks in on quiet hard entries, and reviews weekly', () => {
    assert.deepEqual({ ...checkIn, reason: undefined }, { quietWeeks: 6, activeWeeks: 3, reason: undefined })
    assert.deepEqual(review, { lookbackDays: 28, dismissedDays: 90, repeatShare: 0.6 })
    assert.deepEqual({ ...rest, stopwords: undefined }, { stopwords: undefined, addsPerMessage: 2, maxOpsPerRun: 7, maxOpenQuestions: 5, cooldownDays: 30, protectedKinds: ['rule'] })
  })

  it('words its own texts plainly', () => {
    assert.equal(followUp.text('Dentist', '2026-10-10'), 'Dentist: the day (2026-10-10) has passed, and how it went is not known yet')
    assert.equal(checkIn.reason(6), 'not mentioned in 6 weeks')
  })

  it('writes a correction with its unit, so the reality job reads it back', () => {
    const { reality: withUnit } = definePasses(memory, { reality: { kind: 'plan', unit: 'minutes' } })
    const text = withUnit.text('Daily walk', 30, '2026-10-10')
    assert.equal(text, 'Daily walk: 30 minutes on the records (2026-10-10)')
    assert.equal(valueOf(text, 'minutes'), 30)
  })

  it('clips a long event so the whole follow-up passes the memory\'s text rules, on whole characters', () => {
    for (const long of [`Trip to ${'the mountains and back '.repeat(12)}`, `Trip to ${'🏔️ '.repeat(80)}the mountains`]) {
      const line = followUp.text(long, '2026-10-10')
      assert.equal(textProblem(line, memory.policy.maxTextLength), null, `${normaliseText(line).length} characters once normalised`)
      assert.ok(line.endsWith('...: the day (2026-10-10) has passed, and how it went is not known yet'))
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(line), 'no half a surrogate pair')
    }
  })
})

describe('definePasses — what you set', () => {
  it('merges each part over the defaults, and a derived value you set wins', () => {
    const passes = definePasses(memory, {
      maxOpsPerRun: 3, followUp: { kinds: ['plan'], kind: 'note' }, review: { everyDays: 14 },
      reality: { kind: 'plan', unit: 'minutes' },
    })
    assert.equal(passes.maxOpsPerRun, 3)
    assert.deepEqual([passes.followUp.kinds, passes.followUp.kind, passes.followUp.windowDays], [['plan'], 'note', 7])
    assert.deepEqual(passes.review, { lookbackDays: 28, dismissedDays: 90, repeatShare: 0.6, everyDays: 14 })
    assert.deepEqual([passes.reality.kind, passes.reality.unit, passes.reality.tolerance], ['plan', 'minutes', 0.15])
  })

  it('refuses a follow-up kind or a reality kind the memory does not have, and a reality kind without a unit', () => {
    assert.throws(() => definePasses(memory, { followUp: { kinds: ['plan'], kind: 'reminder' } }), { name: 'TypeError', message: /followUp\.kind/ })
    assert.throws(() => definePasses(memory, { reality: { kind: 'level', unit: 'minutes' } }), { name: 'TypeError', message: /reality\.kind/ })
    assert.throws(() => definePasses(memory, { reality: { kind: 'plan' } }), { name: 'TypeError', message: /reality\.unit/ })
  })
})

describe('definePasses — a policy the passes run on', () => {
  it('plans nothing for an empty memory, records and all', () => {
    let n = 0
    const input = { state: memory.empty, messages: [], activityDays: [], records: [], today: '2026-10-13', now: '2026-10-13T03:00:00Z', runId: 'dream-2026-10-13', newId: () => `d${++n}` }
    assert.deepEqual(dailyPlan({ ...input, policy: definePasses(memory) }), [])
  })
})

describe('definePasses — the defaults at work', () => {
  // A memory on every default, stopwords included.
  const plain = defineMemory({ kinds: { rule: { mayBeHard: true, protected: true }, plan: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'P' } })
  const today = '2026-10-13'
  let n = 0
  const input = (state: typeof memory.empty, messages: { id: string; role: 'subject'; text: string; at: string }[]) => ({
    state, messages, records: null, today, now: `${today}T03:00:00Z`, runId: `dream-${today}`, newId: () => `d${++n}`,
    activityDays: Array.from({ length: 50 }, (_, i) => addDays(today, -i)),
  })

  it('checks in on a hard entry nobody mentions, filler words or not', () => {
    const said = { kind: 'action' as const, id: 'tap' }
    const state = plain.write(plain.empty, { writer: 'subject-action', now: '2026-08-01T10:00:00Z', ops: [add({ id: 'h1', kind: 'rule', severity: 'hard', text: 'Never call after nine in the evening', source: said })] }).state
    const chatter = [0, 7, 14, 21, 28].map((d, i) => ({ id: `m${i}`, role: 'subject' as const, text: 'Went to the shop and the park with the dog', at: `${addDays(today, -d)}T09:00:00Z` }))
    assert.deepEqual(dailyPlan({ ...input(state, chatter), policy: definePasses(plain) }).map((c) => [c.job, c.about]), [['check-in', 'h1']])
  })

  it('tidies no copies until you name the negations, and does once you do', () => {
    const said = { kind: 'action' as const, id: 'tap' }
    const state = plain.write(plain.empty, { writer: 'subject-action', now: '2026-10-01T10:00:00Z', ops: [
      add({ id: 'a', kind: 'plan', text: 'Likes running in the park', source: said }),
      add({ id: 'b', kind: 'plan', text: 'Likes running in the park on Sundays', source: said }),
    ] }).state
    const messages = [{ id: 'm1', role: 'subject' as const, text: 'Running in the park on Sundays is my favourite', at: '2026-10-02T09:00:00Z' }]
    assert.deepEqual(dailyPlan({ ...input(state, messages), policy: definePasses(plain) }), [])
    const named = definePasses(plain, { duplicate: { negations: new Set(['not', 'never']) } })
    assert.deepEqual(dailyPlan({ ...input(state, messages), policy: named }).map((c) => [c.job, c.about]), [['duplicate', 'a']])
  })
})
