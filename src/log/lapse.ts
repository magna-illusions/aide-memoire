import type { Entry } from './types.ts'

// Time is read, never written. Whether an entry has lapsed depends on the day it
// is read, not the day it was stored, so it is derived from `now` on every read
// and no event records it — a lapse costs nothing to undo and cannot be missed by
// a sweep that did not run.
//
// `until` and `review` name the LAST day inside the window ("holds until the
// 4th" means through the 4th), so a date falls due the day after. Dates are ISO
// `YYYY-MM-DD` and compare as strings; `now` may be a date or a full timestamp,
// and only its date part is read (UTC, when it is a timestamp).

function dayOf(now: string): string {
  return now.slice(0, 10)
}

function passed(date: string | undefined, now: string): boolean {
  return Boolean(date) && (date as string) < dayOf(now)
}

// The question a passed date raises — is this still in force? — is answered by
// the subject confirming the entry after that date: their own "still true" in the
// app (fold.ts sets confirmedAt only for a subject's confirm). A later date raises
// it again. It never extends `until` for a soft entry: lapsing is the date's alone.
function due(date: string | undefined, entry: Entry, now: string): boolean {
  if (!passed(date, now)) return false
  return !entry.confirmedAt || dayOf(entry.confirmedAt) <= (date as string)
}

/** A live soft entry past its `until`: it leaves the rendering and stays in history. */
function isLapsed(entry: Entry, now: string): boolean {
  return entry.status === 'live' && entry.severity === 'soft' && passed(entry.until, now)
}

/**
 * A live hard entry past its `until` or `review`: it goes on standing and is
 * raised for the subject to settle. A hard entry never lapses — only the
 * subject's word closes it.
 */
function isReviewDue(entry: Entry, now: string): boolean {
  return entry.status === 'live' && entry.severity === 'hard' && (due(entry.until, entry, now) || due(entry.review, entry, now))
}

/**
 * A live soft entry past its `review`, and not lapsed: still rendered where it
 * stands, and raised as a check-in — does it still apply? Never dropped by it;
 * only `until` takes a soft entry out.
 */
function isCheckInDue(entry: Entry, now: string): boolean {
  return entry.status === 'live' && entry.severity === 'soft' && due(entry.review, entry, now) && !isLapsed(entry, now)
}

export { isLapsed, isReviewDue, isCheckInDue }
