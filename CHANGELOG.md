# Changelog

## 1.1.0 (2026-10-14)

Everything here is additive, with two exceptions. Logs stored by 1.0 fold and render as before.

The first exception: an operation that declares an `actor` other than the one your code names is
now refused (`writer mismatch: actor`). 1.0 dropped the field. The second changes only the types:
`Memory` has a new required member, `policyFor`, so a `Memory` object you build by hand needs one.

- `actor` on a write: which agent or job made it, in your words (`forensics-agent`). Any writer
  may name one. The validator stamps it on every operation it lets through, as it stamps the
  writer and the run, and refuses an event that names another. It is kept on the entry and never
  rendered. It is not the run: the per-run cap still counts by `runId`. The background passes take
  one in their deps.
- `writers` in `defineMemory`: a writer's own limits, where they differ from the memory's, such as
  `{ migration: { maxTextLength: 1000 } }`. `memory.write` holds each writer to its own, and
  `memory.policyFor(writer)` returns it. `definePasses` takes its caps and text length from the
  `consolidation` writer's.
- Plain names for the background passes, at `aide-memoire/passes`. The 1.0 names, and
  `aide-memoire/dream`, still work and are deprecated until 2.0. Each is the same function, value
  or type as its new name:

  | 1.0 | 1.1 |
  |---|---|
  | `aide-memoire/dream` | `aide-memoire/passes` |
  | `defineDreaming`, `DreamingOverrides` | `definePasses`, `PassOverrides` |
  | `dreamDaily`, `DreamDeps`, `DreamSummary` | `dailyPass`, `DailyDeps`, `DailySummary` |
  | `dreamPlan`, `DreamInput` | `dailyPlan`, `DailyInput` |
  | `dreamWeekly` | `weeklyReview` |
  | `DreamPolicy`, `DreamWrite`, `DreamWriteOutcome` | `PassPolicy`, `PassWrite`, `PassWriteOutcome` |
  | `DREAM_MARKER` | `PASS_MARKER` |

  Stored strings keep their names: the marker type is still `DreamRun`, and run ids are still
  `dream-<day>` and `dream-model-<period>`. docs/dream.md is now docs/passes.md.

## 1.0.0 (2026-10-13)

First release. aide-mémoire was developed inside a private codebase, where it runs in production.
The earlier history is tied to that code, so this repository starts from a single commit.
Everything after it happens here in the open.

- `defineMemory(config)`: one memory from one config (its kinds, how its block reads, its limits),
  with few defaults, all listed in docs/api.md. `memory.write`, `fold`, `render` and `questions`
  are the building blocks with its policies bound.
- Operation builders: `add`, `supersede`, `retire`, `apply`, `discard`, `confirm`, `dismiss` and
  `forget`, emitting the event types below exactly, minus what the validator stamps (`at`, and
  whose claim it is). An operation may leave out `at`; the validator stamps it with `now`.
- An entry log of typed operations (add, supersede, retire, confirm, dismiss, propose, redact),
  folded by `foldEntries` into the live set, deterministically.
- `validate` and `validateRun` answer `accept`, `reject` or `propose` for every operation, from the
  writer your code names on the call, never from the event. They never throw. An operation may
  leave out `assertedBy` and `origin` (`EntryOperation`), and the validator stamps them.
- `planWrite`: a whole write as data. Each operation is checked against the state the ones before
  it left; the plan says what to append in order (a run's marker first), what a forget took, and
  the state to save. With `base`, an operation that would bring back words forgotten since is
  refused. A `prepare(op, state)` hook has the last word on each operation. The dedupe key stays
  with your store.
- Provenance on every entry: who claimed it, on what evidence, and whether the user confirmed
  it; `provenance(entry)` names it.
- Forgetting one entry: `EntryRedacted`, `tombstoneRedacted` and `wordingsForgottenBy`. The README
  shows the whole adapter onto petit-journal.
- `renderEntries`: an escaped, budgeted prompt block from the live entries, in which stored text
  cannot close the block, open a section or forge a provenance tag.
- `aide-memoire/dream`: background passes over the log. `dreamDaily` is deterministic;
  `dreamWeekly` reviews contradictions through a model call you inject, once a period
  (`review.everyDays`, weekly by default). `defineDreaming(memory, overrides?)` builds their
  policy from a memory. `waitingQuestions` and `sameFactAs` come from the core too.
- ES modules and declarations in `dist/`; `require()` works on Node 22.13 or later. No runtime
  dependencies.
