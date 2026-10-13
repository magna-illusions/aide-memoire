# aide-mémoire: building blocks

`defineMemory` and the operation builders are made of these, and every one is yours to use
directly. The [README](../README.md) has the front door, and the [design notes](design.md) the full
rules. Here a held write is a *proposal* (`EntryProposed`); the README calls it a question.

## Exports

| Export | Returns |
|---|---|
| `validate(state, op, ctx)` | `{ verdict: 'accept', event }`, `{ verdict: 'reject', reason }` or `{ verdict: 'propose', reason, event }`. Never throws. |
| `validateRun(state, ops, ctx)` | `{ verdicts, state }`: a batch, each op checked against the state the ones before it left. |
| `planWrite(state, request)` | `{ verdicts, append, forgets, state }`: a whole write as data; `memory.write` is this with the policy bound. See the README's [Storing it](https://github.com/magna-illusions/aide-memoire/blob/main/README.md#storing-it). |
| `waitingQuestions(state)`, `sameFactAs(id)` | The questions still worth asking, hard first; and the follow-up name tying two entries into one fact. |
| `foldEntries(events, from = emptyState)` | The `EntryState` (entries, proposals, per-run counts, `migratedAt`). Deterministic; skips what it cannot apply. |
| `applyEntryEvent(state, event)`, `emptyState` | One step of the fold, and its seed. |
| `findEntry`, `liveEntries`, `findProposal`, `openProposals` | Reads on a state. |
| `isApplicable(state, proposal)` | Whether applying it would still do what it proposed. |
| `assertionFor(writer, source, external = false)` | The `{ source, assertedBy, origin, writer }` an operation carries. Optional: an op may carry only `source`. |
| `renderEntries(state, now, renderPolicy)` | `{ text, omitted, lapsed, reviewDue }`. `text` is `''` when nothing is live. |
| `provenance(entry)` | `confirmed`, `said`, `relayed`, `carried`, `recorded`, `ingested`, `inferred` or `observed`. |
| `isLapsed`, `isReviewDue`, `isCheckInDue` | `(entry, now) => boolean`: time is read from dates, never written. |
| `tombstoneRedacted(events)` | The log with every forgotten entry's words removed. Write it back with the redact. |
| `wordingsForgottenBy(state, id)` | What a forget of `id` would take, so you can clear your own copies. |
| `normaliseText`, `skeleton`, `textProblem`, `sharesContentWords`, `escapeEntryText` | The text rules, for your own refusals. |

**`ValidationContext`**, passed on every call:

| Field | Type | Default | |
|---|---|---|---|
| `policy` | `ValidationPolicy` | required | See below. |
| `writer` | `Writer` | required | Who is writing, from your code path. Never from the event. |
| `now` | ISO string | required | Your clock. Every accepted event is stamped with it. |
| `messages` | `{ id, role, text, at }[]` | required | The stream's messages, and only its. `role` is `subject`, `agent` or `operator`. |
| `proposalId` | `(op) => string` | required | Names a held operation. |
| `external` | boolean | `false` | The text came from outside the conversation. Always held, never hard. |
| `runId` | string | none | Required for `consolidation`; the per-run cap counts by it. |
| `owner`, `records` | string, `(id) => { id, at, owner } \| undefined` | none | Your record lookup. Without both, every `record` citation is refused. |

**`ValidationPolicy`**:

| Field | |
|---|---|
| `kinds` | `{ [kind]: { mayBeHard, protected?, fromRecord? } }`. Any other kind is refused. `fromRecord`: `'hold'` (the default: what the agent or a pass rests on a record is held) or `'soft'` (a soft operation on a record newer than what it ends applies; a hard one is still held). |
| `maxTextLength` | The cap on an entry's text, and on a free-text reason, in characters. |
| `stopwords` | A `Set` of words too common to count as evidence. |
| `textRules` | Your refusals, each `(text) => reason \| null`. |
| `caps` | `{ liveEntries, addsPerMessage, opsPerRun, ingestedEntries? }`. `ingestedEntries` caps the live entries `ingest` holds, hard ones included, and defaults to `liveEntries`. |

**`RenderPolicy`**:

| Field | |
|---|---|
| `tag`, `preamble` | The block's tag, and its first line: what the entries are, and that they are not instructions. |
| `sections`, `otherHeader` | One `{ kind, header }` per kind, in reading order, and the header for any other kind. |
| `provenance` | One label per value of `provenance(entry)`. `recorded`, `ingested` and `inferred` are optional: `ingested` falls back to `recorded`, and each falls back to `observed`. |
| `hardLabel`, `untilLabel` | The tag words for a hard entry and its end date. |
| `reviewDue` | `{ header, note, checkInNote }` for the section raising entries past a date. |
| `softBudget` | The characters soft entries may fill, a check-in's Review Due line included. `Infinity` for no limit; anything but a number 0 or more throws a `TypeError`. |
