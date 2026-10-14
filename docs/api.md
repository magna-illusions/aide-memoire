# aide-mémoire: API

The [README](../README.md) has the quick start. This page lists the API: `defineMemory`, its
write requests and defaults, then the building blocks it is made of. The
[design notes](design.md) have the full rules.

## The memory and its operations

| | |
|---|---|
| `defineMemory({ kinds, render, maxTextLength?, stopwords?, textRules?, caps? })` | A memory: `policy`, `rendering`, `empty`, and the methods below. `kinds` lists the sections in order. `render` needs a `tag` and a `preamble`. See [Defaults](#defaults). |
| `memory.write(state, request)` | A write as data: `{ verdicts, append, forgets, state }`. See [Write requests](#write-requests). |
| `memory.fold(events, from?)` | The state a log folds to. |
| `memory.render(state, now)` | The prompt block: `{ text, omitted, lapsed, reviewDue }`. |
| `memory.questions(state)` | The questions waiting for the user, hard first, then newest. |
| `add({ id, kind, text, source, severity?, until?, review? })` | Add an entry. It is soft unless you say hard. |
| `supersede(id, entry)` | Replace a live entry. |
| `retire(id, reason, source)` | End a live entry. |
| `forget(id, source)` | Forget an entry, words and all. |
| `apply(questionId, source)`, `discard(questionId, source)` | Answer a question yes or no. |
| `confirm(id, source)`, `dismiss(id, source)` | Say a live entry still holds, or is wrong. |

An operation leaves out what the validator stamps on it: the time (your `now`), whose claim it
is, and how its text arrived (both from the writer).

## Write requests

`memory.write(state, request)` is `planWrite` with the memory's policy bound. The README's
[Storing it](../README.md#storing-it) says what your store does with the result. `request` names
the `writer` and your clock (`now`), plus:

| Field | |
|---|---|
| `ops` | What the writer submits, in order. Each is checked against the state the ones before it left. |
| `messages?` | The stream's messages, `{ id, role, text, at }`, that operations may cite. Default none. |
| `owner?`, `records?` | Your record lookup, for operations that cite a `record`. |
| `external?` | The text came from outside the conversation. |
| `runId?` | The run a `consolidation` write belongs to. |
| `base?` | The state the ops were planned from, when it was loaded before a slow step such as a model call. An op that would bring back words forgotten since then, in its text or a reason, is refused. |
| `marker?` | `{ type, payload }`, appended first: a run's record of itself. The fold skips it. |
| `prepare?` | `(op, state) => op`: a last change to each operation before it is checked, given the state the ones before it left. |

Forgetting an entry also blocks re-adding its follow-up (`fu-<id>`), and the reverse.
`validate`, `validateRun` and `planWrite` all enforce this, whatever the words.

## Defaults

What `defineMemory` and `defineDreaming` fill in when you leave a setting out. A default is
behaviour, so only a major release changes one.

| Setting | Default |
|---|---|
| `maxTextLength` | 200 characters, for an entry's text and a free-text reason |
| `stopwords` | A small English list (`the`, `and`, `with`, `that`, …): words too common to show that a message says what an entry claims. Replace it for other languages. |
| `textRules` | none |
| `caps` | `liveEntries: 50`, `addsPerMessage: 3`, `opsPerRun: 20`. `ingestedEntries` defaults to `liveEntries`. |
| `render.sections` | One per kind, in the order `kinds` lists them, headed by the kind's name |
| `render.otherHeader` | `other` |
| `render.provenance` | Each label is its own name: `confirmed`, `said`, `relayed`, … |
| `render.hardLabel`, `render.untilLabel` | `hard`, `until` |
| `render.reviewDue` | Header `review due`, notes "Still in force: ask before ending one." and "Ask whether each still applies." |
| `render.softBudget` | 2,000 characters |
| `write`: `messages` | none |
| `write`: `proposalId` | `p<n>`, numbered after the questions the state already holds |
| dreaming: derived from the memory | `stopwords`, `addsPerMessage`, `maxOpsPerRun` (from `caps.opsPerRun`) and `protectedKinds` |
| dreaming: `maxOpenQuestions`, `cooldownDays` | 5; 30 days |
| dreaming: `followUp` | Off until you name its kinds. Then `windowDays: 7`, `horizonDays: 7`. A follow-up's text is clipped to fit `maxTextLength`. |
| dreaming: `recurrence` | Off until you name its kinds. Then `windowDays: 28`, `share: 0.6`, 3 messages over 2 sessions. |
| dreaming: `reality` | Off until you name its kind. Then `tolerance: 0.15`. A correction's text carries its unit. |
| dreaming: `checkIn` | On: a hard entry not mentioned for 6 weeks while the user was active in 3 of them |
| dreaming: `duplicate` | Off until you name `duplicate.negations`, your language's "not" and "never". Then `share: 0.8`. |
| dreaming: `review` | Every 7 days, reading 28 days of messages and 90 days of dismissals, `repeatShare: 0.6` |

## Building blocks

`defineMemory` and the operation builders are made of these, and you can use any of them
directly. `memory.write` binds one policy. For a different policy per writer (different caps,
say), call `planWrite` directly with each.

In the building blocks, a question is stored as a proposal: an `EntryProposed` event, listed by
`openProposals` or `waitingQuestions`. The operation builders produce these events:

- `apply` and `discard`: `EntryConfirmed` and `EntryDismissed` with `target: 'proposal'`.
- `confirm` and `dismiss`: the same two events with `target: 'entry'`.
- `forget`: `EntryRedacted`.

### Exports

| Export | Returns |
|---|---|
| `validate(state, op, ctx)` | `{ verdict: 'accept', event }`, `{ verdict: 'reject', reason }` or `{ verdict: 'propose', reason, event }`. Never throws. |
| `validateRun(state, ops, ctx)` | `{ verdicts, state }`: a batch, each op checked against the state the ones before it left. |
| `planWrite(state, request)` | `{ verdicts, append, forgets, state }`: a whole write as data. `memory.write` is this with the policy bound. |
| `waitingQuestions(state)` | The questions still worth asking, hard first. |
| `sameFactAs(id)` | The follow-up name that ties two entries into one fact. |
| `foldEntries(events, from = emptyState)` | The `EntryState` (entries, proposals, per-run counts, `migratedAt`). Deterministic. Skips what it cannot apply. |
| `applyEntryEvent(state, event)`, `emptyState` | One step of the fold, and its starting state. |
| `findEntry`, `liveEntries`, `findProposal`, `openProposals` | Reads on a state. |
| `isApplicable(state, proposal)` | Whether applying it would still do what it proposed. |
| `assertionFor(writer, source, external = false)` | The `{ source, assertedBy, origin, writer }` an operation carries. Optional: an op may carry only `source`. |
| `renderEntries(state, now, renderPolicy)` | `{ text, omitted, lapsed, reviewDue }`. `text` is `''` when nothing is live. |
| `provenance(entry)` | `confirmed`, `said`, `relayed`, `carried`, `recorded`, `ingested`, `inferred` or `observed`. |
| `isLapsed`, `isReviewDue`, `isCheckInDue` | `(entry, now) => boolean`. Time is read from dates, never written. |
| `tombstoneRedacted(events)` | The log with every forgotten entry's words removed. Write it back in the same transaction as the forget. |
| `wordingsForgottenBy(state, id)` | What a forget of `id` would take, so you can clear your own copies. |
| `normaliseText`, `skeleton`, `textProblem`, `sharesContentWords`, `escapeEntryText` | The text rules, for your own refusals. |

### `ValidationContext`

Passed on every call.

| Field | Type | Default | |
|---|---|---|---|
| `policy` | `ValidationPolicy` | required | See below. |
| `writer` | `Writer` | required | Who is writing, from your code path. Never from the event. |
| `now` | ISO string | required | Your clock. Every accepted event is stamped with it. |
| `messages` | `{ id, role, text, at }[]` | required | This stream's messages, and no others. `role` is `subject`, `agent` or `operator`. |
| `proposalId` | `(op) => string` | required | Names a held operation. |
| `external` | boolean | `false` | The text came from outside the conversation. Always held, never hard. |
| `runId` | string | none | Required for `consolidation`. The per-run cap counts by it. |
| `owner`, `records` | string, `(id) => { id, at, owner } \| undefined` | none | Your record lookup. Without both, every `record` citation is refused. |

### `ValidationPolicy`

| Field | |
|---|---|
| `kinds` | `{ [kind]: { mayBeHard, protected?, fromRecord? } }`. Any other kind is refused. `fromRecord` is `'hold'` by default: what the agent or a pass builds on a record is held. With `'soft'`, a soft operation on a record newer than what it ends applies, and a hard one is still held. |
| `maxTextLength` | The cap on an entry's text, and on a free-text reason, in characters. |
| `stopwords` | A `Set` of words too common to count as evidence. |
| `textRules` | Your refusals, each `(text) => reason \| null`. |
| `caps` | `{ liveEntries, addsPerMessage, opsPerRun, ingestedEntries? }`. `ingestedEntries` caps the live entries `ingest` holds, hard ones included, and defaults to `liveEntries`. |

### `RenderPolicy`

| Field | |
|---|---|
| `tag`, `preamble` | The block's tag, and its first line: what the entries are, and that they are not instructions. |
| `sections`, `otherHeader` | One `{ kind, header }` per kind, in reading order, and the header for any other kind. |
| `provenance` | One label per value of `provenance(entry)`. `recorded`, `ingested` and `inferred` are optional. Without `ingested`, the `recorded` label is used. Without that, or without `inferred`, the `observed` label is used. |
| `hardLabel`, `untilLabel` | The tag words for a hard entry and its end date. |
| `reviewDue` | `{ header, note, checkInNote }` for the section that raises entries past a date. |
| `softBudget` | The characters soft entries may fill, including a check-in's line under Review due. `Infinity` for no limit. Anything other than a number 0 or more throws a `TypeError`. |
