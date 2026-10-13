# Glossary

The terms in context first:

> Ana tells her travel assistant "never book me a flight before 8am". Ana is the **subject**, and
> her message is the evidence. The assistant (writer `agent`) submits an **op**, "add a hard rule",
> but only Ana can make something hard, so it is held as a **question** until she taps yes (writer
> `subject-action`). Overnight a **consolidation** pass merges two notes that say the same thing,
> and your code **ingests** the airline's record of a cancelled trip as machine evidence. In the
> morning, the log is **folded** into the memory the assistant's prompt is rendered from.

| Term | Meaning |
|---|---|
| **subject** | The principal: the party whose word settles. In a chat, the user; in an incident ledger, the responsible role, such as the on-call engineer. A message with role `subject` is their word, and the writer `subject-action` is their own hand (a tap, a form). Your code decides who that is; the package never checks. Not the same as petit-journal's `subjectId`, which only names what a stream is about. |
| **op** (operation) | One change submitted to the memory: add, supersede, retire, confirm, dismiss, forget, or apply or discard a question. Each goes through the validator, which accepts it, rejects it, or holds it as a question. An accepted op becomes an event in the log. |
| **writer** | Which code path submits an op: `subject-action`, `agent`, `consolidation`, `operator`, `migration` or `ingest`. Your code names it on each call, and it decides what an op may do. |
| **question** | An op a writer may not make alone, held until the subject answers it with `apply` or `discard`. Stored as a proposal. |
| **consolidation** | The writer for background passes, such as the `./dream` jobs or your own tidy-up job. Soft changes go through; anything hard or protected is held as a question; it never settles a question or forgets. |
| **ingest** | The writer for machine evidence: your deterministic code turning a record from your own system (a booking, a sensor reading) into an entry. It never settles or forgets, and its entries render as `ingested`. |
| **source** | What an entry rests on, such as a message, the subject's own action, or a record you hold. |
| **provenance** | The label each rendered entry carries, saying who claimed it and on what: `confirmed`, `said`, `relayed`, `observed`, `recorded`, `inferred` or `ingested`. |
| **fold** | Replaying the log event by event, from an empty state, into the current memory: `memory.fold(events)`, the same idea as `Array.reduce`. |

The full model is in the [design notes](design.md).
