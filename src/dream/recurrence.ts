import { liveEntries } from '../log/fold.ts'
import { provenance } from '../render.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Entry, EntryProposed, ProposableOp } from '../log/types.ts'
import { askedAbout, declinedFor } from './asked.ts'
import { addDays } from './days.ts'
import { hasRoom } from './mentions.ts'
import { holds } from './similar.ts'
import type { Candidate, DreamInput, SubjectMessage } from './types.ts'

// Promotion of what keeps being said, without a model. An entry the agent only
// observed, which the subject has since said in the policy's number of messages
// across more than one session within the window, is asked about: "Still
// true?". It is a supersede in the same words, held as a proposal, so the
// subject's confirm applies it as theirs (core stamps it confirmed) and a "no"
// leaves the entry as it was. A pass cannot confirm, and a kind change would
// need a judgement this pass does not make, so promotion is the question.
//
// A message says the entry when it holds most of its words (`holds`), read on
// the entry so a one-word question does not count. It cites the newest of them
// with room under the per-message cap, which must be newer than the entry: the
// validator's rules for changing one.
// Only observed entries with no date: what the subject said or confirmed is
// already theirs, and a dated one lapses on its own. Never one resting on a
// record: the subject saying the same words does not make the record's reading
// theirs. Asked once: not while a question about it is open, not within the
// cooldown, and never after a "no".

function isObserved(entry: Entry, input: DreamInput): boolean {
  return entry.severity === 'soft' && !entry.redacted && !entry.until && provenance(entry) === 'observed'
    && entry.source.kind !== 'record'
    && input.policy.recurrence.kinds.includes(entry.kind)
}

function unasked(entry: Entry, input: DreamInput): boolean {
  const isStillTrue = (op: ProposableOp) => op.type === 'EntrySuperseded' && op.entry.text === entry.text
  return !declinedFor(input.state, entry.id, isStillTrue) && !askedAbout(input.state, entry.id, addDays(input.today, -input.policy.cooldownDays))
}

/** The subject's messages in the window, with a session, that say the entry: newest first. */
function sayings(entry: Entry, input: DreamInput): SubjectMessage[] {
  const { recurrence, stopwords } = input.policy
  const since = addDays(input.today, -recurrence.windowDays)
  return input.messages
    .filter((m) => m.role === 'subject' && m.session && m.at.slice(0, 10) >= since && holds(entry.text, m.text, stopwords) >= recurrence.share)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

function recurs(said: SubjectMessage[], input: DreamInput): boolean {
  const { messages, sessions } = input.policy.recurrence
  return said.length >= messages && new Set(said.map((m) => m.session)).size >= sessions
}

function stillTrue(entry: Entry, cited: SubjectMessage, input: DreamInput): EntryProposed {
  const by = { ...assertionFor('consolidation', { kind: 'message', id: cited.id }), runId: input.runId }
  return {
    type: 'EntryProposed', at: input.now, id: input.newId('proposal'), reason: 'the subject keeps saying it',
    op: {
      type: 'EntrySuperseded', at: input.now, supersedes: entry.id,
      entry: { id: input.newId('entry'), kind: entry.kind, severity: 'soft', text: entry.text, ...by },
    },
  }
}

function recurrences(input: DreamInput): Candidate[] {
  return liveEntries(input.state)
    .filter((e) => isObserved(e, input) && unasked(e, input))
    .flatMap((e) => {
      const said = sayings(e, input)
      const cited = said.find((m) => Date.parse(m.at) > Date.parse(e.at) && hasRoom(input.state, m.id, input.policy.addsPerMessage))
      if (!recurs(said, input) || !cited) return []
      return [{ job: 'recurrence' as const, about: e.id, event: stillTrue(e, cited, input) }]
    })
}

export { recurrences }
