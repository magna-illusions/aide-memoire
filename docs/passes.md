# `aide-memoire/passes`

Optional background passes over an entry log, which run when you call them. A pass reads the log
and what your system knows about the user, and proposes operations on the entries. It never
writes on its own. Every operation goes through your writer as the `consolidation` writer, and
the core validator decides what is applied, what is held as a question, and what is refused. The
writer, trust and validation rules are the same as in the core.

Like the core, the subpath is pure functions with no dependencies, no database and no model
client. It has no clock and no randomness either. You inject the reads, the writer, the id
generator, the clock and, for the periodic review, the model call.

```ts
import { dailyPass, weeklyReview } from 'aide-memoire/passes'
```

The 1.0 names (`aide-memoire/dream`, `defineDreaming`, `dreamDaily`, `dreamWeekly` and the rest)
still work and are deprecated until 2.0. The [changelog](../CHANGELOG.md) maps each to its new name.

## Two passes

### Daily, deterministic (`dailyPass`)

There is no model. Five jobs read the same input, and a planner decides how much of what they
find goes in:

| Job | What it finds | What it submits |
|---|---|---|
| `follow-up` | a dated entry (a kind in `followUp.kinds`, with `until`) whose day passed within the window, and that the user has not spoken of since | a soft follow-up entry, named `followUpId(event)`, that lapses after `horizonDays` |
| `check-in` | a hard entry the user has not mentioned for `quietWeeks`, while they were active in `activeWeeks` of them | a retire, which the validator holds as a question |
| `reality` | a soft entry of `reality.kind` naming one value in `reality.unit`, which the newest record contradicts beyond `tolerance` | a supersede to the record's value, built as a proposal |
| `duplicate` | two live entries of one kind and severity that say the same thing | a retire of the older, whose reason names the copy kept (`duplicateReason`) |
| `recurrence` | an entry the agent only observed, which the user has since said in `messages` messages across `sessions` sessions | a supersede in the same words, built as a proposal ("still true?") |

The duplicate job is off while `duplicate.negations` is empty. A copy is ended without asking, so
"never X" must not read as a copy of "X".

The planner:

- caps a run at `maxOpsPerRun`;
- puts follow-ups first, then soft copies, then questions;
- asks no new question while `maxOpenQuestions` are already open;
- submits at most one operation per entry;
- asks a question once, then not again within `cooldownDays`, and never again after the user
  said no to it.

### Periodic, with a model (`weeklyReview`)

The review looks only for contradictions. It pairs live entries of one kind that share a topic
and are not copies. It sends those entries to the model, with the user's messages that speak of
them. Every operation the model records is held as a proposal. A change to an entry outside the
compared pairs is dropped, and so is anything that repeats what the user dismissed. The run is
claimed before the call, so it is paid for at most once a period. It makes no call when no
question fits, when there are no pairs, or when there are no messages.

The period is `review.everyDays` days, 7 by default. It is named by its first day, counted from a
Monday (1970-01-05), so the run id is `dream-model-<first day>`. With 7 days, that day is the
Monday of the ISO week. Call `weeklyReview` as often as you like (daily, say); the period decides
when it runs.

A changed `everyDays` takes effect at once. Today's period gets a new name: going from 7 to 30
days on 2026-10-13, the week of 2026-10-12 becomes the period of 2026-10-08. Names already stored
stay as they are, and the renamed period can cost one extra review. A summary that says
`skipped: 'done this week'` means done this period, whatever its length.

## The API

```ts
dailyPass(owner: string, deps: DailyDeps): Promise<DailySummary>
weeklyReview(owner: string, deps: ReviewDeps): Promise<ReviewSummary>
dailyPlan(input: DailyInput): Candidate[]            // the daily pass without I/O
reviewPrompt(input: ReviewInput, wording: ReviewWording, kinds: string[]): ReviewPrompt
reviewOperations(toolInput: unknown, ctx: ReviewContext): { events: EntryEvent[]; dropped: string[] }
followUpId(eventId) · sameFactAs(id) · duplicateReason(keptId) · keptBy(reason)

// Pieces your other passes can share with these, so you need not keep copies:
waitingQuestions(state): Proposal[]                   // open, applicable, words kept; hard first, then newest
entriesSection(state, today, subject): string[]       // live entries and waiting questions, escaped, with ids
entryLine(entry) · proposalLine(proposal)
operationEvents(toolInput, ctx: OperationContext)     // add/supersede/retire/propose → events; no screening
PASS_MARKER = 'DreamRun' · REVIEW_TOOL_NAME = 'record_operations'
```

```ts
interface DailyDeps {
  loadEntries: (owner) => Promise<EntryState>
  loadMessages: (owner, sinceIso) => Promise<SubjectMessage[]>   // the user's own, with `session` where known
  loadCited: (owner, ids) => Promise<Message[]>                  // the sources of live entries, however old
  loadActivityDays: (owner, sinceIso) => Promise<string[]>       // YYYY-MM-DD, "active" as you define it
  loadRecords: ((owner) => Promise<RecordValue[]>) | null        // null: no read path to records
  write: (owner, write: PassWrite) => Promise<PassWriteOutcome>
  newId: (prefix: 'entry' | 'proposal') => string
  policy: PassPolicy
  today: string                                                  // the user's calendar day
  now: () => string
  actor?: string                                                 // which job this is: every write carries it
}
```

`today` and an event's `until` are the user's calendar days. A message's day is read as its time
says, in the offset it was written with. So give message times with the user's UTC offset
(`2026-10-09T20:00:00-08:00`). Otherwise, for a user far from UTC, a message from the evening
before an event can read as an answer to it. A time in `Z` reads as a UTC day.

```ts
interface ReviewDeps {
  loadEntries, write, newId, policy, today, now, actor?          // as above
  loadMessages: (owner, sinceIso) => Promise<Message[]>
  runRecorded?: (owner, dedupeKey) => Promise<boolean>         // optional: skips the reads early
  ask: (prompt: ReviewPrompt, owner) => Promise<unknown>         // the tool call's input, or null
  kinds: Record<string, KindRule>                                // the validator's kinds
  wording: ReviewWording
}
```

### The writer

Your `write` validates `write.ops` as `write.writer` (always `consolidation`), with `write.runId`,
`write.actor`, `write.now` and `write.messages` in the `ValidationContext`, and appends what is let
through. `write.actor` is there only when you gave the pass an `actor`.

- A `dedupeKey` makes a second write of the same run a no-op that answers `duplicate: true`.
- A `marker` is an event appended first, carrying that key: the run's record of itself. The core
  fold skips it.
- `base` is the state the pass planned from.

The core's `planWrite` is this writer without the store. Give it the write as it comes, `base`
included. It refuses an operation that carries words forgotten since, then says what to append
in what order.

### Why the shared pieces live here

They are what a background pass needs: they read proposals as questions to raise, and render
entries for a model. The core stays the log, the validator and the reader's rendering. Your
other model passes (one that consolidates a conversation, say) can import them from this
subpath too.

### The model call

`ask` receives `{ system, user, tool: { name, description, inputSchema, strict } }`. You map that
onto your own client, model and token limit, record the spend, and return the input of the tool
call, or `null` when the model made none. `strict: true` asks your API to hold the input to the
schema, where the API supports it.

A failed or hung call loses that period's review. The period is claimed before the call, so it is
paid for at most once. If `ask` throws, the error propagates and the review is not tried again
until the next period. If `ask` never settles, `weeklyReview` never does either. The package sets
no timeout of its own, so `ask` must enforce one (an `AbortSignal.timeout` on the client call,
say) and throw when it passes.

### The policy

`definePasses(memory, overrides?)` builds the `PassPolicy`. It takes the memory's stopwords,
caps and protected kinds, uses the [defaults](api.md#defaults) for the rest, and merges each part
with what you set. Where the memory sets limits for the `consolidation` writer, the caps and text
length are that writer's.

The policy holds every number and every piece of wording the jobs use: the stopwords, the caps,
the follow-up kinds and text, the check-in reason, the protected kinds, what counts as a copy,
the recurrence thresholds, the review's windows and period (`everyDays`), and the reality kind,
unit, tolerance and text.

`ReviewWording` holds the words the review prompt uses: whose memory it reads, what the user is
called, your extra rules (which language to write in, and what never to end on time alone), and
an optional `clean` for your own protocol markup in message text.

## Two trust models

In a conversation, the user is a person, and their word settles. The jobs cite the user's own
messages. Soft copies and follow-ups are applied. Anything hard or protected is held as a
question that only the user's action, or an operator's, settles.

In a ledger, machine evidence comes in as records, and your own code writes it as entries through
the core's `ingest` writer. The pass's conclusions are claims, and a responsible role such as the
on-call engineer settles them. The pass reads ingested entries like any other. They render as
`ingested`, never `observed`, so recurrence never promotes one. Nor does it promote an entry the
agent rested on a record (`inferred`).

To correct entries from records, give a `RecordValue` its `id` and `at`, and give the writer's
`ValidationContext` the stream `owner` and a `records` lookup. Then a correction with no message
reporting the value cites the record itself. The validator checks the record and holds the
correction as a proposal, which an `operator` confirms. `ledger.test.ts` runs this for a service
whose records are alerts.

Citing records is off by default. Turn it on with `reality.citeRecords: true`, and only when the
writer's `ValidationContext` carries the stream `owner` and a `records` lookup. The lookup is
synchronous, because the validator never fetches, so load the records before you write. Without
both, every such correction is refused. A refusal leaves no proposal, so no cooldown starts, and
the correction comes back the next day. That is why the planner ranks a correction that rests on
a record alone after every other question: it only takes a slot nothing else wanted.

A correction is always submitted as a proposal ("Has this changed?"), so a kind's
`fromRecord: 'soft'` does not apply it. The job asks, whatever the validator would allow.

Follow-ups can rest on a record too. A dated event you ingested rests on a record (a change
ticket, a maintenance window). With `followUp.citeRecords: true`, an event that no message from
the user speaks of is followed up on that record. The validator applies the follow-up only where
`followUp.kind` takes records softly (`fromRecord: 'soft'`). Otherwise it holds it as a question.
Off by default, and it needs the same `owner` and `records` lookup as above.

## Limits

These follow from the current trust rules when the user never writes messages, as with a
service. `ledger.test.ts` asserts them as they stand.

- A record applies only a follow-up. A correction resting on a record is always a question. A
  follow-up on a record applies only with `followUp.citeRecords` and a follow-up kind that takes
  records softly.
- Without messages, there are no soft duplicates. A soft duplicate needs a message from the user
  that speaks of it, so it waits. The reconciling pair (`{ kind: 'entries', ids }`) could ground
  it, but the jobs do not cite one yet. Recurrence counts messages, so it never fires.
- Hold reasons are fixed phrases that say "held for the subject", even where an operator settles.
  Settling works through `operator` or `subject-action`. `ingest` never settles, and there is no
  separate writer for a responsible role.
- Without the record lookup, a record citation is refused ("no host records to check the cited
  record against"), every day. It is ranked last, so it never takes a slot from anything else,
  but it is never asked.
- One value per entry, in one unit. The reality job reads only an entry that names exactly one
  number followed by `reality.unit`, ending at a word boundary when the unit ends in a letter or
  digit. A range, another unit or two values are left alone.
- Broken config throws a `TypeError`. These are config checks, not verdicts on data; everything
  else returns a result rather than throwing.
  - An empty `reality.unit`, since without a unit every number would read as a value. `dailyPlan`
    throws, and `dailyPass` rejects, the first time the reality job reads an entry against
    records.
  - A `review.everyDays` that is not a whole number of days, 1 or more. `weeklyReview` rejects
    before it reads anything.
  - A `today` that is not a real calendar day as `YYYY-MM-DD` (`2026-02-29` is not). Every pass
    refuses it before it reads anything.
  - `definePasses` refuses a `followUp.kind` (when `followUp.kinds` is set) or a `reality.kind`
    the memory does not have, and a `reality.kind` without a `reality.unit`.
