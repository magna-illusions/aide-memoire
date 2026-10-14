# Glossary

The terms in context first:

> Ana tells her travel assistant "never book me a flight before 8am". Ana is the user, and her
> message is the evidence. The assistant (writer `agent`) submits an **op**, "add a hard rule".
> Only Ana can make something hard, so it is held as a **question** until she taps yes (writer
> `subject-action`). Overnight a **consolidation** pass merges two notes that say the same thing.
> Your code **ingests** the airline's record of a cancelled trip as machine evidence. In the
> morning, the log is **folded** into the memory that the assistant's prompt is rendered from.

| Term | Meaning |
|---|---|
| **subject** | The API's name for the user. In a chat, the person the agent works with. In an incident ledger, someone such as the on-call engineer. A message with role `subject` is the user's. Your code decides who the user is; the package never checks. Not the same as petit-journal's `subjectId`, which names what a stream is about. |
| **op** (operation) | One change submitted to the memory: add, supersede, retire, confirm, dismiss, forget, or apply or discard a question. The validator accepts it, rejects it, or holds it as a question. An accepted op becomes an event in the log. |
| **writer** | The code path that submits an op: `subject-action`, `agent`, `consolidation`, `operator`, `migration` or `ingest`. Your code names it on each call, and it decides what the op may do. `subject-action` is a write your UI makes when the user confirms or submits a form. |
| **question** | An op a writer may not make alone. It waits until the user answers it with `apply` or `discard`. Stored as a proposal. |
| **consolidation** | The writer for background passes, such as the `aide-memoire/dream` passes or your own clean-up job. Soft changes go through. Anything hard or protected is held as a question. It never answers a question or forgets. |
| **ingest** | The writer for machine evidence: your deterministic code turning a record from your own system (a booking, a sensor reading) into an entry. It never answers a question or forgets, and its entries render as `ingested`. |
| **source** | What an entry rests on, such as a message, an action by the user, or a record you hold. |
| **provenance** | The label each rendered entry carries, saying who claimed it and on what: `confirmed`, `said`, `relayed`, `carried`, `observed`, `recorded`, `inferred` or `ingested`. |
| **fold** | Replaying the log, event by event, from an empty state into the current memory: `memory.fold(events)`, the same idea as `Array.reduce`. |

The full model is in the [design notes](design.md).
