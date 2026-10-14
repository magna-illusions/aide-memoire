import { definePasses, type PassOverrides } from './define.ts'
import { dailyPlan } from './plan.ts'
import { dailyPass, PASS_MARKER, type DailyDeps, type DailySummary } from './run.ts'
import { weeklyReview } from './review.ts'
import type { DailyInput, PassPolicy, PassWrite, PassWriteOutcome } from './types.ts'

// The 1.0 names, kept until 2.0. Each is the same function, value or type as its
// plain name, never a wrapper that could drift from it. The stored strings were
// never renamed: a run is still `dream-…` and its marker `DreamRun`.

/** @deprecated Use {@link definePasses}. This name goes in 2.0. */
const defineDreaming = definePasses
/** @deprecated Use {@link dailyPlan}. This name goes in 2.0. */
const dreamPlan = dailyPlan
/** @deprecated Use {@link dailyPass}. This name goes in 2.0. */
const dreamDaily = dailyPass
/** @deprecated Use {@link weeklyReview}. This name goes in 2.0. */
const dreamWeekly = weeklyReview
/** @deprecated Use {@link PASS_MARKER}. This name goes in 2.0. */
const DREAM_MARKER = PASS_MARKER

/** @deprecated Use `PassOverrides`. This name goes in 2.0. */
type DreamingOverrides = PassOverrides
/** @deprecated Use `DailyDeps`. This name goes in 2.0. */
type DreamDeps = DailyDeps
/** @deprecated Use `DailySummary`. This name goes in 2.0. */
type DreamSummary = DailySummary
/** @deprecated Use `PassPolicy`. This name goes in 2.0. */
type DreamPolicy = PassPolicy
/** @deprecated Use `DailyInput`. This name goes in 2.0. */
type DreamInput = DailyInput
/** @deprecated Use `PassWrite`. This name goes in 2.0. */
type DreamWrite = PassWrite
/** @deprecated Use `PassWriteOutcome`. This name goes in 2.0. */
type DreamWriteOutcome = PassWriteOutcome

export { defineDreaming, dreamPlan, dreamDaily, dreamWeekly, DREAM_MARKER }
export type { DreamingOverrides, DreamDeps, DreamSummary, DreamPolicy, DreamInput, DreamWrite, DreamWriteOutcome }
