// Calendar days as ISO `YYYY-MM-DD` strings, which compare as strings.

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** `day` itself, when it is a real calendar day as `YYYY-MM-DD`; anything else is a broken input, and throws. */
function calendarDay(day: string): string {
  const time = typeof day === 'string' && DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN
  // A day that does not exist parses as the next one, or not at all.
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new TypeError(`today must be a calendar day as YYYY-MM-DD, got ${JSON.stringify(day)}`)
  }
  return day
}

const ANCHOR = '1970-01-05' // a Monday, so a seven-day period is the ISO week
const DAY_MS = 86_400_000

/**
 * The first day of the `everyDays`-day period `day` falls in, counted from a
 * Monday: a periodic run's name. Seven days name every day by the Monday of its
 * ISO week, so the names a weekly review stored stay what they were. A period
 * that is not a whole number of days, one or more, is a broken policy: it throws.
 */
function periodOf(day: string, everyDays: number): string {
  if (!Number.isInteger(everyDays) || everyDays < 1) throw new TypeError('review.everyDays must be a whole number of days, 1 or more')
  const since = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${ANCHOR}T00:00:00Z`)) / DAY_MS
  return addDays(ANCHOR, Math.floor(since / everyDays) * everyDays)
}

export { dayOf, addDays, calendarDay, periodOf }
