import { findEntry, liveEntries } from '../log/fold.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Entry, EntryAdded, Source } from '../log/types.ts'
import { addDays, dayOf } from './days.ts'
import { hasRoom, mentionsAfter, mentionsOnOrAfter } from './mentions.ts'
import { followUpId } from './names.ts'
import type { Candidate, DreamInput } from './types.ts'

// "Time": a passed event becomes a follow-up, then history.
//
// A dated event is a soft entry of a follow-up kind with an `until`: the
// event's day, the end of a trip. Once that day has passed the entry lapses on
// its own (core lapse.ts), so the agent would simply stop knowing about it.
// This adds, once, a soft follow-up that says the date passed and the outcome
// is not known yet; it holds for a few days and lapses too.
//
// Not followed up:
// - an event the subject has already spoken of since its day;
// - one whose day passed more than the window ago, or before the log took over
//   from the host's older store (MigrationApplied): that is history the old
//   store already dealt with;
// - one already followed up: the follow-up's id is derived from the event's, so
//   a second pass finds it, and the validator refuses a reused id anyway.

function isRecentEvent(entry: Entry, input: DreamInput): boolean {
  const { kinds, windowDays } = input.policy.followUp
  const until = entry.until
  if (entry.severity !== 'soft' || entry.redacted || !until || !kinds.includes(entry.kind)) return false
  const before = input.state.migratedAt ? dayOf(input.state.migratedAt) : ''
  return until < input.today && until >= addDays(input.today, -windowDays) && until >= before
}

// What the follow-up rests on: the message the event was recorded from, else the
// subject's latest that speaks of it — one with room left under the per-message
// cap, so the validator does not refuse it for that. Where there is none and the
// host opted in (`citeRecords`), the record the event itself rests on: how a
// subject that never writes, such as a service, gets a follow-up at all.
function citationFor(event: Entry, input: DreamInput): Source | undefined {
  const { stopwords, addsPerMessage, followUp: policy } = input.policy
  const { source } = event
  const own = source.kind === 'message' ? input.messages.filter((m) => m.id === source.id) : []
  const speaking = mentionsAfter(event.text, input.messages, '1970-01-01', stopwords)
  const message = [...own, ...speaking].find((m) => m.role === 'subject' && hasRoom(input.state, m.id, addsPerMessage))
  if (message) return { kind: 'message', id: message.id }
  const onRecord = policy.citeRecords && source.kind === 'record' && hasRoom(input.state, source.id, addsPerMessage, 'record')
  return onRecord ? { ...source } : undefined
}

function followUp(event: Entry, cited: Source, input: DreamInput): EntryAdded {
  const { followUp: policy } = input.policy
  const by = assertionFor('consolidation', cited)
  return {
    type: 'EntryAdded', at: input.now, entry: {
      id: followUpId(event.id), kind: policy.kind, severity: 'soft', text: policy.text(event.text, event.until!),
      until: addDays(input.today, policy.horizonDays), ...by, runId: input.runId,
    },
  }
}

function followUps(input: DreamInput): Candidate[] {
  const { state, messages, policy } = input
  return liveEntries(state)
    .filter((e) => isRecentEvent(e, input) && !findEntry(state, followUpId(e.id)))
    // From the start of the event's day, on the subject's calendar: "it went well!"
    // that evening is an answer, "nervous about tomorrow" the evening before is not.
    .filter((e) => mentionsOnOrAfter(e.text, messages, e.until!, policy.stopwords).length === 0)
    .flatMap((e) => {
      const cited = citationFor(e, input)
      return cited ? [{ job: 'follow-up' as const, about: e.id, event: followUp(e, cited, input) }] : []
    })
}

export { followUps }
