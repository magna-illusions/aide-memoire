import { examPassed } from './time.ts'
import { ageingRestriction, ageingWithoutActivity, ageingJustMigrated } from './ageing.ts'
import { valueMoved, noRecords, correctionDeclined } from './reality.ts'
import { manyThings, questionsWaiting, copiesWhileWaiting } from './no-spam.ts'
import { softDuplicate, hardDuplicate, mixedSeverity, duplicateDeclined, copyAfterCheckIn, duplicateForgotten, agedCopies } from './duplicates.ts'
import { saidThreeTimes, saidTwice, oneSession, declinedBefore, newestIsFull, onRecord } from './recurrence.ts'
import type { DreamFixture } from './fixture.ts'

// One fixture per job, and the caps that keep a run from spamming.
const DREAM_FIXTURES: DreamFixture[] = [
  examPassed, ageingRestriction, ageingWithoutActivity, ageingJustMigrated, valueMoved, noRecords, correctionDeclined,
  manyThings, questionsWaiting, copiesWhileWaiting,
  softDuplicate, hardDuplicate, mixedSeverity, duplicateDeclined, copyAfterCheckIn, duplicateForgotten, agedCopies,
  saidThreeTimes, saidTwice, oneSession, declinedBefore, newestIsFull, onRecord,
]

export { DREAM_FIXTURES }
