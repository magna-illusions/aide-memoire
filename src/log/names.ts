// A follow-up is named after its event, so a pass finds it and a forget reaches
// it: it quotes the event's words, so the two are one fact, and forgetting
// either forgets both. The dream passes give the name; the core keeps it because
// the write path refuses a fact back under the other name (write/forgotten.ts).
const FOLLOW_UP = 'fu-'

/** The id of the follow-up for an event's entry. */
function followUpId(eventId: string): string {
  return `${FOLLOW_UP}${eventId}`
}

/** The other entries that hold the same fact as `id`, by name, whether or not they exist. */
function sameFactAs(id: string): string[] {
  return [id.startsWith(FOLLOW_UP) ? id.slice(FOLLOW_UP.length) : followUpId(id)]
}

export { followUpId, sameFactAs }
