import { sharesContentWords } from '../text.ts'
import type { EntryState, Message } from '../log/types.ts'
import { dayOf } from './days.ts'

// Whether the subject has spoken of an entry: one of their messages shares a
// content word with it — the citation's own test, with the policy's stopwords,
// which add the host's filler. Loose on purpose: a false "mentioned" only means
// a pass waits, never that it acts.

/** The subject's messages after `after` (ISO, or a day: read as its end) that speak of `text`, newest first. */
function mentionsAfter(text: string, messages: Message[], after: string, stopwords: Set<string>): Message[] {
  const since = Date.parse(after.length === 10 ? `${after}T23:59:59.999Z` : after)
  return messages
    .filter((m) => m.role === 'subject' && Date.parse(m.at) > since && sharesContentWords(text, m.text, stopwords))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/**
 * The subject's messages written on `day` or later that speak of `text`. A
 * message's day is the one its time says, in the offset it was written with, so
 * a subject's calendar is read as theirs: give message times with their offset.
 */
function mentionsOnOrAfter(text: string, messages: Message[], day: string, stopwords: Set<string>): Message[] {
  return messages.filter((m) => m.role === 'subject' && dayOf(m.at) >= day && sharesContentWords(text, m.text, stopwords))
}

/** Whether a message (or a record) has room for one more entry under the validator's per-source cap. */
function hasRoom(state: EntryState, id: string, cap: number, kind: 'message' | 'record' = 'message'): boolean {
  return state.entries.filter((e) => e.source.kind === kind && e.source.id === id).length < cap
}

export { mentionsAfter, mentionsOnOrAfter, hasRoom }
