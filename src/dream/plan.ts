import { waitingQuestions } from '../log/questions.ts'
import type { EntryState } from '../log/types.ts'
import { checkIns } from './ageing.ts'
import { calendarDay } from './days.ts'
import { duplicates } from './duplicates.ts'
import { realitySync } from './reality.ts'
import { recurrences } from './recurrence.ts'
import { followUps } from './time-sync.ts'
import type { Candidate, DailyInput, PassPolicy } from './types.ts'

// One day's deterministic pass: every job reads the same input and says what it
// would submit; this decides how much of it goes in. No model, no I/O.
//
// No spam, by policy:
// - at most `maxOpsPerRun` operations a run, follow-ups first (they are
//   time-bound: a week late, "how did it go?" is no longer a question), then the
//   soft copies it tidies away, then questions;
// - no new question while `maxOpenQuestions` already wait for the subject — a
//   longer list is a queue nobody works through;
// - one operation per entry a run, the first job's: two questions about one
//   entry, or a question about one just ended, is the spam this exists against;
// - a correction resting on a record alone comes last (reality.ts).

/** How many more questions may be asked before the open ones reach the policy's ceiling. */
function questionRoom(state: EntryState, policy: PassPolicy): number {
  return Math.max(0, policy.maxOpenQuestions - waitingQuestions(state).length)
}

function onePerEntry(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c, i) => candidates.findIndex((other) => other.about === c.about) === i)
}

/** What one day's pass would submit, in order, within the policy's caps. */
function dailyPlan(input: DailyInput): Candidate[] {
  calendarDay(input.today)
  const copies = duplicates(input)
  const reality = realitySync(input)
  const actions = [...followUps(input), ...copies.tidy]
  const questions = [...checkIns(input), ...reality.reported, ...copies.questions, ...recurrences(input), ...reality.recorded]
  const found = onePerEntry([...actions, ...questions])
  const asked = found.filter((c) => questions.includes(c)).slice(0, questionRoom(input.state, input.policy))
  return [...found.filter((c) => actions.includes(c)), ...asked].slice(0, input.policy.maxOpsPerRun)
}

export { dailyPlan, questionRoom }
