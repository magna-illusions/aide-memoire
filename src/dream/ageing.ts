import { liveEntries } from '../log/fold.ts'
import { isReviewDue } from '../log/lapse.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Entry, EntryRetired, EntryState } from '../log/types.ts'
import { askedAbout } from './asked.ts'
import { addDays, dayOf } from './days.ts'
import { mentionsAfter } from './mentions.ts'
import type { Candidate, DailyInput } from './types.ts'

// "Ageing hard entries": a restriction the subject has not mentioned for N
// weeks while they go on being active → the agent checks in. Never
// auto-closed: the pass submits a retire as the consolidation writer, which the
// validator holds as a question ("Is this over?") that only the subject's
// action, or an operator, settles.
//
// Asked at most once at a time and then left alone for a cooldown, whatever the
// answer: an open question about the entry, or any check-in on it within the
// cooldown, and it is skipped. A restriction already past its review date is
// raised there (core's Review Due), and confirming it restarts its clock.

function weekHasActivity(days: string[], today: string, week: number): boolean {
  const last = addDays(today, -7 * week)
  const first = addDays(last, -6)
  return days.some((day) => day >= first && day <= last)
}

/** Active in at least `activeWeeks` of the last `quietWeeks` weeks. */
function activityGoesOn(input: DailyInput): boolean {
  const { quietWeeks, activeWeeks } = input.policy.checkIn
  const weeks = Array.from({ length: quietWeeks }, (_, week) => week)
  return weeks.filter((week) => weekHasActivity(input.activityDays, input.today, week)).length >= activeWeeks
}

// When the entry last had the subject's word: added, or confirmed — and never
// before the log took over from the host's older store. A migrated line keeps
// the day it was said, and counting from there would raise every migrated
// restriction on the first morning; the old store never asked, so the clock
// starts at the migration.
function lastSaid(entry: Entry, state: EntryState): string {
  const days = [entry.at, entry.confirmedAt, state.migratedAt].filter((d): d is string => Boolean(d)).map(dayOf)
  return days.sort().at(-1)!
}

function checkIn(entry: Entry, input: DailyInput): EntryRetired {
  const by = assertionFor('consolidation', { kind: 'session', id: input.runId })
  const reason = input.policy.checkIn.reason(input.policy.checkIn.quietWeeks)
  return { type: 'EntryRetired', at: input.now, id: entry.id, reason, ...by, runId: input.runId }
}

function checkIns(input: DailyInput): Candidate[] {
  if (!activityGoesOn(input)) return []
  const { state, today, messages, policy } = input
  const quietSince = addDays(today, -7 * policy.checkIn.quietWeeks)
  const cooledSince = addDays(today, -policy.cooldownDays)
  return liveEntries(state)
    .filter((e) => e.severity === 'hard' && !e.redacted && lastSaid(e, state) < quietSince && !isReviewDue(e, today))
    .filter((e) => !askedAbout(state, e.id, cooledSince))
    .filter((e) => mentionsAfter(e.text, messages, quietSince, policy.stopwords).length === 0)
    .map((e) => ({ job: 'check-in' as const, about: e.id, event: checkIn(e, input) }))
}

export { checkIns }
