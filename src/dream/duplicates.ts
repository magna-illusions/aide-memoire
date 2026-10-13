import { liveEntries } from '../log/fold.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Entry, EntryRetired, Message, ProposableOp, Source } from '../log/types.ts'
import { askedAbout, declinedFor } from './asked.ts'
import { addDays } from './days.ts'
import { mentionsAfter } from './mentions.ts'
import { duplicateReason, keptBy } from './names.ts'
import { saysTheSame } from './similar.ts'
import type { Candidate, DreamInput } from './types.ts'

// Duplicates, without a model: two live entries of one kind and one severity
// whose content words overlap by the policy's share, with the same numbers and
// the same yes or no, say the same thing (similar.ts). The older is ended in
// favour of the newest copy, one operation per pair, as a retire whose reason
// names the copy kept. Core has no "merge", and a supersede would add a third
// copy of the words; ending the older is the same outcome as a supersede by the
// newer.
//
// The validator decides as for every consolidation operation: a soft entry is
// ended, a hard or protected one is held as a question. A hard and a soft entry
// in the same words are not a copy — the subject loosened or tightened it — so
// they are never paired. Not proposed again once the subject kept the older,
// nor while either copy has a question open, nor within the cooldown.
//
// A soft one needs the subject's message, newer than the older copy, that
// speaks of it: the newer copy's own source, else their latest that does. A held
// one may cite the pass itself, as a check-in does; without a message, a soft
// pair waits.

function sameThing(a: Entry, b: Entry, input: DreamInput): boolean {
  return a.kind === b.kind && a.severity === b.severity && saysTheSame(a.text, b.text, input.policy)
}

function isHeld(entry: Entry, input: DreamInput): boolean {
  return entry.severity === 'hard' || input.policy.protectedKinds.includes(entry.kind)
}

function citationFor(older: Entry, kept: Entry, input: DreamInput): Message | undefined {
  const speaking = mentionsAfter(older.text, input.messages, older.at, input.policy.stopwords)
  return speaking.find((m) => kept.source.kind === 'message' && m.id === kept.source.id) ?? speaking[0]
}

function sourceFor(older: Entry, kept: Entry, input: DreamInput): Source | undefined {
  const cited = citationFor(older, kept, input)
  if (cited) return { kind: 'message', id: cited.id }
  return isHeld(older, input) ? { kind: 'session', id: input.runId } : undefined
}

const isCopyQuestion = (op: ProposableOp) => op.type === 'EntryRetired' && keptBy(op.reason) !== null

function unasked(older: Entry, kept: Entry, input: DreamInput): boolean {
  const { state } = input
  const cooledSince = addDays(input.today, -input.policy.cooldownDays)
  return !declinedFor(state, older.id, isCopyQuestion) && !askedAbout(state, older.id, cooledSince) && !askedAbout(state, kept.id)
}

function retired(older: Entry, kept: Entry, source: Source, input: DreamInput): EntryRetired {
  const by = { ...assertionFor('consolidation', source), runId: input.runId }
  return { type: 'EntryRetired', at: input.now, id: older.id, reason: duplicateReason(kept.id), ...by }
}

function duplicateOf(older: Entry, later: Entry[], input: DreamInput): Candidate[] {
  const kept = later.filter((e) => sameThing(older, e, input)).at(-1)
  if (!kept || !unasked(older, kept, input)) return []
  const source = sourceFor(older, kept, input)
  return source ? [{ job: 'duplicate', about: older.id, event: retired(older, kept, source, input) }] : []
}

/**
 * Every older copy, ended in favour of the newest: `tidy` is applied by policy, `questions` held for the subject.
 * Off while `duplicate.negations` is empty: without its language's "not", "never X" would read as a copy of "X".
 */
function duplicates(input: DreamInput): { tidy: Candidate[]; questions: Candidate[] } {
  if (input.policy.duplicate.negations.size === 0) return { tidy: [], questions: [] }
  const live = liveEntries(input.state).filter((e) => !e.redacted)
  const found = live.flatMap((older, i) => duplicateOf(older, live.slice(i + 1), input))
  const held = (c: Candidate) => isHeld(live.find((e) => e.id === c.about)!, input)
  return { tidy: found.filter((c) => !held(c)), questions: found.filter(held) }
}

export { duplicates }
