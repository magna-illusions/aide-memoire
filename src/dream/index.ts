// `aide-memoire/passes`, also reachable as `aide-memoire/dream`: background
// passes over an entry log, opt-in by calling them. Pure like the core: the host
// injects its reads, its writer, its ids, its clock and, for the weekly review,
// its model call. Every operation a pass builds goes through the host's writer
// as `consolidation`.
export { definePasses } from './define.ts'
export type { PassOverrides } from './define.ts'
export { dailyPlan } from './plan.ts'
export { waitingQuestions } from '../log/questions.ts'
export { dailyPass, PASS_MARKER } from './run.ts'
export { weeklyReview } from './review.ts'
export { reviewPrompt, entriesSection, entryLine, proposalLine, REVIEW_TOOL_NAME } from './review-prompt.ts'
export { reviewOperations, operationEvents } from './review-operations.ts'
export { followUpId, sameFactAs, duplicateReason, keptBy } from './names.ts'
export type { DailyDeps, DailySummary } from './run.ts'
export type { ReviewDeps, ReviewSummary } from './review.ts'
export type { ReviewWording, ReviewInput, ReviewPrompt, ReviewTool } from './review-prompt.ts'
export type { ReviewContext, OperationContext } from './review-operations.ts'
export type { Dismissed } from './dismissed.ts'
export type * from './types.ts'
export {
  defineDreaming, dreamPlan, dreamDaily, dreamWeekly, DREAM_MARKER,
} from './deprecated.ts'
export type {
  DreamingOverrides, DreamDeps, DreamSummary, DreamPolicy, DreamInput, DreamWrite, DreamWriteOutcome,
} from './deprecated.ts'
