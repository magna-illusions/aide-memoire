# `aide-memoire/dream`

Background passes over an entry log, which a host opts into by calling them. A pass
reads the log and what the host knows about the subject, and proposes operations on the
entries. It never writes on its own: every operation goes through the host's writer as the
`consolidation` writer, and the core validator decides what is applied, what is held as a
question, and what is refused. The writer, trust and validation rules are the core's,
unchanged.

The subpath keeps the package's promise. It is pure functions with no dependencies, no
database and no model client. It has no clock and no randomness either: the host injects
its reads, its writer, its id generator, its clock and, for the periodic review, its model
call.

```ts
import { dreamDaily, dreamWeekly } from 'aide-memoire/dream'
```

## Two passes

**Daily, deterministic** (`dreamDaily`). There is no model. Five jobs read the same input,
and a planner decides how much of what they find goes in:

| Job | What it finds | What it submits |
|---|---|---|
| `follow-up` | a dated entry (a kind in `followUp.kinds`, with `until`) whose day passed within the window, that the subject has not spoken of since | a soft follow-up entry, named `followUpId(event)`, that lapses after `horizonDays` |
| `check-in` | a hard entry the subject has not mentioned for `quietWeeks` while they were active in `activeWeeks` of them | a retire, which the validator holds as a question |
| `reality` | a soft entry of `reality.kind` naming one value in `reality.unit`, which the newest record contradicts beyond `tolerance` | a supersede to the record's value, built as a proposal |
| `duplicate` | two live entries of one kind and severity that say the same thing | a retire of the older, whose reason names the copy kept (`duplicateReason`) |
| `recurrence` | an entry the agent only observed, which the subject has since said in `messages` messages across `sessions` sessions | a supersede in the same words, built as a proposal ("still true?") |

The duplicate job is off while `duplicate.negations` is empty: a copy is ended without asking, so
"never X" must not read as a copy of "X". The planner caps a run at `maxOpsPerRun`. Follow-ups come first, then soft copies, then
questions. It asks no new question while `maxOpenQuestions` are already open. It submits at
most one operation per entry. A question is asked once, then not again within `cooldownDays`,
and never again after the subject said no to it.

**Periodic, with a model** (`dreamWeekly`, weekly by default). The review looks for
contradictions only. It
pairs live entries of one kind that share a topic and are not copies, and sends those
entries with the subject's messages that speak of them. Every operation the model records
is held as a proposal. A change to an entry outside the compared pairs is dropped, and so is
anything that repeats what the subject dismissed. The run is claimed before the call, so it
is paid for at most once a period. It makes no call when no question fits, when there are no
pairs, or when there are no messages.

**The period** is `review.everyDays` days, 7 by default. It is named by its first day,
counted from a Monday (1970-01-05), so the run id is `dream-model-<first day>`, and with 7 days
that day is the Monday of the ISO week: the names a weekly review stored stay what they were.
Call `dreamWeekly` as often as you like (daily, say); the period decides when it runs. A
changed `everyDays` takes effect at once: today's period gets a new name (from 7 to 30 days on
2026-10-13, the week of 2026-10-12 becomes the period of 2026-10-08), the names already stored
are left as they are, and the renamed period can cost one extra review. A summary that says
`skipped: 'done this week'` means done this period, whatever its length.

## The API

```ts
dreamDaily(owner: string, deps: DreamDeps): Promise<DreamSummary>
dreamWeekly(owner: string, deps: ReviewDeps): Promise<ReviewSummary>
dreamPlan(input: DreamInput): Candidate[]            // the daily pass without I/O
reviewPrompt(input: ReviewInput, wording: ReviewWording, kinds: string[]): ReviewPrompt
reviewOperations(toolInput: unknown, ctx: ReviewContext): { events: EntryEvent[]; dropped: string[] }
followUpId(eventId) · sameFactAs(id) · duplicateReason(keptId) · keptBy(reason)

// The pieces a host's other passes share with these, so it need not keep copies:
waitingQuestions(state): Proposal[]                   // open, applicable, words kept; hard first, then newest
entriesSection(state, today, subject): string[]       // live entries and waiting questions, escaped, with ids
entryLine(entry) · proposalLine(proposal)
operationEvents(toolInput, ctx: OperationContext)     // add/supersede/retire/propose → events; no screening
DREAM_MARKER = 'DreamRun' · REVIEW_TOOL_NAME = 'record_operations'
```

```ts
interface DreamDeps {
  loadEntries: (owner) => Promise<EntryState>
  loadMessages: (owner, sinceIso) => Promise<SubjectMessage[]>   // the subject's own, with `session` where known
  loadCited: (owner, ids) => Promise<Message[]>                  // the sources of live entries, however old
  loadActivityDays: (owner, sinceIso) => Promise<string[]>       // YYYY-MM-DD, "active" in the host's sense
  loadRecords: ((owner) => Promise<RecordValue[]>) | null        // null: no read path to records
  write: (owner, write: DreamWrite) => Promise<DreamWriteOutcome>
  newId: (prefix: 'entry' | 'proposal') => string
  policy: DreamPolicy
  today: string                                                  // the subject's calendar day
  now: () => string
}
```

`today` and an event's `until` are the subject's calendar days, so a message's day is read
as its time says, in the offset it was written with: give message times with the subject's
UTC offset (`2026-10-09T20:00:00-08:00`), or a subject far from UTC can have the evening
before an event read as an answer to it. A time in `Z` reads as a UTC day.

```ts
interface ReviewDeps {
  loadEntries, write, newId, policy, today, now                  // as above
  loadMessages: (owner, sinceIso) => Promise<Message[]>
  runRecorded?: (owner, dedupeKey) => Promise<boolean>         // optional: skips the reads early
  ask: (prompt: ReviewPrompt, owner) => Promise<unknown>         // the tool call's input, or null
  kinds: Record<string, KindRule>                                // the validator's kinds
  wording: ReviewWording
}
```

**The host's writer** (`write`) validates `write.ops` as `write.writer` (always
`consolidation`), with `write.runId`, `write.now` and `write.messages` in the
`ValidationContext`. It appends what is let through. A `dedupeKey` makes a second write of
the same run a no-op that answers `duplicate: true`. A `marker` is a host event appended
first, carrying that key: the run's record of itself, which the core fold skips. `base` is
the state the pass planned from. The core's `planWrite` is this writer without the store: give
it the write as it comes, `base` included, and it refuses an operation that carries words
forgotten since, then says what to append in what order.

**Why the shared pieces live here, not in the core.** They are what a background pass
needs: they read proposals as questions to raise, and render entries for a model. The core
stays the log, the validator and the reader's rendering. A host's other model pass (one
that consolidates a conversation, say) imports them from this subpath too.

**The model call** (`ask`) receives `{ system, user, tool: { name, description, inputSchema, strict } }`.
The host maps that onto its own client, model and token ceiling, records the spend, and
returns the input of the tool call, or `null` when the model made none. `strict: true` asks
the host to have its API hold the input to the schema, where the API can.

**A failed or hung call loses that period's review.** The period is claimed before the call, so
it is paid for at most once: if `ask` throws, the error propagates and the review is not tried
again until the next period; if `ask` never settles, `dreamWeekly` never does either. The package
sets no timeout of its own, so `ask` must enforce one (an `AbortSignal.timeout` on the client
call, say) and throw when it passes.

**The policy** (`DreamPolicy`) is what `defineDreaming(memory, overrides?)` builds: the memory's
stopwords, caps and protected kinds, defaults for the rest (the README's table), each part merged
with what you set. It holds every number and every host word the jobs use: the
stopwords, the caps, the follow-up kinds and text, the check-in reason, the protected kinds,
what a copy is, recurrence thresholds, the review's windows and period (`everyDays`), and
the reality kind, unit, tolerance and text. `ReviewWording` names whose memory the review reads, what the subject
is called, the host's extra rules (which language to write in, and what never to end on
time alone), and an optional `clean` for host protocol in message text.

## Two trust models

**Conversational.** The subject is a person, and their word settles. The jobs cite the
subject's own messages. Soft copies and follow-ups are applied. Anything hard or protected
is held as a question that only the person's action settles, or an operator's.

**Ledger.** Machine evidence comes in as records, and the host's own code writes it as
entries through the core's `ingest` writer. The pass's conclusions are claims, and a
responsible role settles. The pass reads ingested entries like any other: they render as
`ingested`, never `observed`, so recurrence never promotes one; nor does it promote an
entry the agent rested on a record (`inferred`). Give a `RecordValue` its `id` and `at`, and give the writer's
`ValidationContext` the stream `owner` and a `records` lookup. Then a correction with no
message reporting the value cites the record itself. The validator checks the record and
holds the correction as a proposal, which an `operator` confirms. `ledger.test.ts` runs
this for a service whose records are alerts.

Citing records is **off by default**: turn it on with `reality.citeRecords: true`, and only
when the writer's `ValidationContext` carries the stream `owner` and a `records` lookup. The
lookup is synchronous, because the validator never fetches, so the host loads the records
before it writes. Without both, every such correction is refused. A refusal leaves no
proposal, so no cooldown starts, and the correction comes back the next day. For that reason
the planner ranks a correction that rests on a record alone after every other question, so
it only ever takes a slot that nothing else wanted.

A correction is always submitted as a proposal ("Has this changed?"), so a kind's
`fromRecord: 'soft'` does not apply it: the job asks whatever the validator would allow.

**Follow-ups on a record.** A dated event the host ingested rests on a record (a change
ticket, a maintenance window). With `followUp.citeRecords: true`, an event no message of the
subject's speaks of is followed up on that record. The validator applies the follow-up only
where `followUp.kind` takes records softly (`fromRecord: 'soft'`); otherwise it holds it as a
question. Off by default, and needs the same `owner` and `records` lookup as above.

## Limits

These are what the current trust rules give a subject who never writes messages, such as a
service. They are asserted as they stand in `ledger.test.ts`.

- **A record applies only a follow-up.** A correction resting on a record is always a
  question for a responsible role. A follow-up on a record applies only with
  `followUp.citeRecords` and a follow-up kind that takes records softly.
- **No message, no soft duplicate.** A soft duplicate needs a message of the subject's that
  speaks of it, so it waits. The reconciling pair (`{ kind: 'entries', ids }`) could ground
  it, but the jobs do not cite one yet. Recurrence counts messages, so it never fires for
  such a subject.
- **Hold reasons speak of "the subject".** The validator's fixed phrases say "held for the
  subject" even where an operator settles. Settling works through `operator` or
  `subject-action`; `ingest` never settles, and there is no separate responsible-role writer.
- **Without the record lookup, a record citation is refused** ("no host records to check
  the cited record against"), every day. It is ranked last, so it costs nothing else a slot,
  but it is never asked.
- **One value per entry, in one unit.** The reality job reads only an entry that names
  exactly one number followed by `reality.unit`, ending at a word boundary when the unit ends
  in a letter or digit. A range, another unit or two values are left alone.
- **Broken inputs throw a `TypeError`.** An empty `reality.unit`, since without a unit every
  number would read as a value: `dreamPlan` throws, and `dreamDaily` rejects, the first time the
  reality job reads an entry against records. A `review.everyDays` that is not a whole number of
  days, 1 or more: `dreamWeekly` rejects before it reads anything. And a `today` that is not a
  real calendar day as `YYYY-MM-DD` (`2026-02-29` is not): every pass refuses it before it reads
  anything. `defineDreaming` refuses a `followUp.kind` (when `followUp.kinds` is set) or a
  `reality.kind` the memory does not have, and a `reality.kind` without a `reality.unit`. These
  are config validation, not verdicts on data; everything else answers rather than throws.
