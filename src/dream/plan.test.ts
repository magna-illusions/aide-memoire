import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { foldEntries, openProposals } from '../log/fold.ts'
import { renderEntries } from '../render.ts'
import { validateRun } from '../validation/validate.ts'
import type { EntryState } from '../log/types.ts'
import { addDays } from './days.ts'
import { dailyPlan } from './plan.ts'
import type { Candidate, DailyInput } from './types.ts'
import { DREAM_FIXTURES } from './fixtures/index.ts'
import { POLICY, RENDER, VALIDATION, type DreamFixture } from './fixtures/fixture.ts'

// Every dreaming fixture is played the same way: fold the history, plan one
// day's pass, submit what it found through the validator as the consolidation
// writer, then read what a reader would see.

function inputFor(fixture: DreamFixture, state: EntryState, today: string): DailyInput {
  let n = 0
  return {
    state, today, now: `${today}T03:00:00Z`, runId: `dream-${today}`, policy: POLICY,
    messages: fixture.messages, activityDays: fixture.activityDays ?? [], records: fixture.records ?? null,
    newId: (prefix) => `${prefix === 'proposal' ? 'p_d' : 'd'}${++n}`,
  }
}

function submit(input: DailyInput, candidates: Candidate[]) {
  let held = 0
  return validateRun(input.state, candidates.map((c) => c.event), {
    policy: VALIDATION, messages: input.messages, writer: 'consolidation', runId: input.runId,
    now: input.now, proposalId: () => `p_h${++held}`,
  })
}

function askedAbout(state: EntryState): string[] {
  return openProposals(state).map(({ op }) => (op.type === 'EntryRetired' ? op.id : op.type === 'EntrySuperseded' ? op.supersedes : op.entry.id))
}

for (const fixture of DREAM_FIXTURES) {
  describe(fixture.name, () => {
    const input = inputFor(fixture, foldEntries(fixture.history), fixture.today)
    const candidates = dailyPlan(input)
    const { verdicts, state } = submit(input, candidates)

    it('submits what the jobs should find, and the validator lets it through as expected', () => {
      const found = candidates.map((c, i) => ({ job: c.job, about: c.about, verdict: verdicts[i].verdict }))
      const reasons = verdicts.flatMap((v) => (v.verdict === 'reject' ? [v.reason] : []))
      assert.deepEqual(found, fixture.expect, reasons.join('; '))
    })

    if (fixture.reads) {
      it('a reader sees it', () => {
        const { text } = renderEntries(state, input.now, RENDER)
        for (const words of fixture.reads?.includes ?? []) assert.ok(text.includes(words), `reads "${words}"`)
        for (const words of fixture.reads?.excludes ?? []) assert.ok(!text.includes(words), `does not read "${words}"`)
      })
    }

    if (fixture.asks) {
      it('asks about exactly these entries', () => {
        assert.deepEqual(askedAbout(state), fixture.asks)
      })
    }

    if (fixture.quietNextDay) {
      it('the next day the pass submits nothing', () => {
        assert.deepEqual(dailyPlan(inputFor(fixture, state, addDays(fixture.today, 1))), [])
      })
    }
  })
}

describe('dailyPlan on a day that is not one', () => {
  it('throws, as a broken input', () => {
    const [fixture] = DREAM_FIXTURES
    assert.throws(() => dailyPlan(inputFor(fixture, foldEntries(fixture.history), '2026-02-29')), { name: 'TypeError', message: /today must be a calendar day/ })
  })
})
