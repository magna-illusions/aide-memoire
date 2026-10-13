import { followUpId, sameFactAs } from '../log/names.ts'

// The names a pass gives what it writes, so a later pass, the host's reader and
// a forget can recognise them. A follow-up's name lives in the core
// (log/names.ts), since the write path reads it too.

// A duplicate is ended with a reason that names the copy it keeps, so the
// question the host asks can show both ("Said twice?") rather than "Is this
// over?" about a restriction that still holds in other words.
const SAID_AGAIN = 'said again as '

/** The retire reason that names the copy kept in its place. */
function duplicateReason(keptId: string): string {
  return `${SAID_AGAIN}${keptId}`
}

/** The entry a retire keeps in its place, when it ends a duplicate. */
function keptBy(reason: string): string | null {
  return reason.startsWith(SAID_AGAIN) ? reason.slice(SAID_AGAIN.length) : null
}

export { followUpId, sameFactAs, duplicateReason, keptBy }
