// `aide-memoire/dream`: background passes over an entry log, opt-in
// by calling them. Pure like the core: the host injects its reads, its writer,
// its ids, its clock and, for the weekly review, its model call. Every
// operation a pass builds goes through the host's writer as `consolidation`.
export { defineDreaming } from './define.ts'
export type { DreamingOverrides } from './define.ts'
export { dreamPlan } from './plan.ts'
export { waitingQuestions } from '../log/questions.ts'
export { dreamDaily, DREAM_MARKER } from './run.ts'
export { dreamWeekly } from './review.ts'
export { reviewPrompt, entriesSection, entryLine, proposalLine, REVIEW_TOOL_NAME } from './review-prompt.ts'
export { reviewOperations, operationEvents } from './review-operations.ts'
export { followUpId, sameFactAs, duplicateReason, keptBy } from './names.ts'
export type { DreamDeps, DreamSummary } from './run.ts'
export type { ReviewDeps, ReviewSummary } from './review.ts'
export type { ReviewWording, ReviewInput, ReviewPrompt, ReviewTool } from './review-prompt.ts'
export type { ReviewContext, OperationContext } from './review-operations.ts'
export type { Dismissed } from './dismissed.ts'
export type * from './types.ts'
