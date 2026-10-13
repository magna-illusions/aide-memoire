# Changelog

## 1.0.0 (2026-10-13)

First release.

- `defineMemory(config)`: one memory from one config (its kinds, how its block reads, its limits),
  with few defaults, all listed in the README. `memory.write`, `fold`, `render` and `questions`
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
- Provenance on every entry: who claimed it, on what evidence, and whether the principal confirmed
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
