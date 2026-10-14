// The vocabulary of the entry log. Everything a host stores about a subject is
// an entry: one sentence with a kind, a severity, a source and who asserted it.
// The log holds operations on entries, never the prose a reader sees — prose is
// rendered from the live set (render.ts) and can be rebuilt at any time.
//
// Plain data throughout, so the log can sit in any append-only store: an adapter
// maps a stored event to one of these and back. Nothing here knows about a
// database, a queue or a model.

/**
 * The user: the person in a conversation, or a responsible role in a ledger
 * (an on-call engineer for a service). The API and every stored event call
 * them `subject`. A message with role `subject` is the user's, and
 * `subject-action` is a write your UI makes when the user confirms or submits
 * a form. The package never checks who the user is; your code decides.
 */
type Principal = 'subject'

/**
 * Whose claim an operation records. Derived from the writer, never declared.
 * `host` is the host's own machine evidence, written by `ingest`.
 */
type Party = Principal | 'agent' | 'operator' | 'host'

/**
 * Who wrote an operation, as the host knows it — stamped by the host on every
 * call, never read from the event, because an event can say anything:
 * - `subject-action`: the subject acting directly in the host's UI, authenticated by it.
 * - `agent`: the model, in conversation.
 * - `consolidation`: a background pass over the log.
 * - `operator`: a person maintaining the system, through the host's own scripts.
 * - `migration`: a one-time import of what the host held before.
 * - `ingest`: the host's own deterministic code, writing machine evidence it
 *   holds (an alert, a log line) as entries that cite it as a record.
 */
type Writer = 'subject-action' | 'agent' | 'consolidation' | 'operator' | 'migration' | 'ingest'

/**
 * How the text arrived. `external` is fetched or imported text that nobody in
 * the conversation wrote — stamped by the host per input source — and can never
 * yield a hard entry. `ingest` is text the host's own code wrote from a record
 * it holds.
 */
type Origin = 'conversation' | 'action' | 'consolidation' | 'migration' | 'operator' | 'external' | 'ingest'

/** `hard` is an explicit restriction; everything else is `soft` and reads as context. */
type Severity = 'hard' | 'soft'

/** Where an entry stands: `live`, `proposed` (held, not yet settled) or `retired`. */
type Status = 'live' | 'proposed' | 'retired'

/**
 * A reference by id. A `message` is checked against the messages the host
 * passes in; `action` is something the subject did directly (a confirm button);
 * `session`, `migration` and `correction` are host references the validator
 * does not look up.
 */
interface Reference {
  kind: 'message' | 'action' | 'session' | 'migration' | 'correction'
  id: string
}

/**
 * A record the host holds about the subject (a measurement, a booking, a log
 * row), checked through the host's `records` lookup. `at` is the record's time
 * as the host gives it; the validator stores the host's, whatever was declared.
 */
interface RecordSource {
  kind: 'record'
  id: string
  at: string
}

/** The two live entries a consolidation proposal reconciles: a copy, or a contradiction. */
interface EntriesSource {
  kind: 'entries'
  ids: [string, string]
}

/** What an operation cites. */
type Source = Reference | RecordSource | EntriesSource

/** A record as the host's lookup answers for it: its id, its time, and whose it is. */
interface HostRecord {
  id: string
  /** ISO timestamp with `Z` or an offset: a time without one is refused, as it reads as local time. */
  at: string
  /** The host's id for the subject the record belongs to. */
  owner: string
}

/**
 * Who stands behind an operation. `assertedBy` and `origin` must agree with what
 * the validator derives from the host's writer, or the operation is refused;
 * `writer` and `runId` are stamped onto every operation it lets through.
 */
interface Assertion {
  source: Source
  assertedBy: Party
  origin: Origin
  writer?: Writer
  /** The host's id for one consolidation pass. */
  runId?: string
}

/** An entry as an add proposes it. Dates are ISO `YYYY-MM-DD`. */
interface EntryDraft extends Assertion {
  id: string
  /** A host-defined string; the host's policy lists the kinds it knows. */
  kind: string
  /** One sentence, not key→value. */
  text: string
  severity: Severity
  /** The last day the entry is expected to hold. */
  until?: string
  /** The day a hard entry should be asked about again. */
  review?: string
  /**
   * The agent recorded the subject's own words: the validator checked that the
   * cited message is the subject's and says this. Stamped by the validator,
   * never read from the event. Presentation only — it grants no power.
   */
  relayed?: boolean
}

/** A message as the validator reads it: plain data, passed in, never fetched. */
interface Message {
  id: string
  /** Who wrote it. The host's machine evidence is a record, never a message. */
  role: Principal | 'agent' | 'operator'
  text: string
  /** ISO timestamp. */
  at: string
}

// `at` on every event is an ISO timestamp: when the operation happened.
/** Adds an entry. */
interface EntryAdded { type: 'EntryAdded'; at: string; entry: EntryDraft }
/** Replaces a live entry with a new one, of the same kind. */
interface EntrySuperseded { type: 'EntrySuperseded'; at: string; supersedes: string; entry: EntryDraft }
/** Ends a live entry, with a reason. */
interface EntryRetired extends Assertion { type: 'EntryRetired'; at: string; id: string; reason: string }
/** Forgets an entry: its words leave every event and the state, its history stays. */
interface EntryRedacted extends Assertion { type: 'EntryRedacted'; at: string; id: string }

/**
 * What a confirm or a dismiss answers, said in the event so no fold can read one
 * as the other. On an `entry` (a live one): confirm is "this is still true" and
 * dismiss is "this is wrong". On a `proposal`: confirm is "apply it" and dismiss
 * is "discard it" — the entry it names stays exactly as it was.
 */
type Settles = 'entry' | 'proposal'
/** Confirms a live entry ("still true") or applies a proposal. */
interface EntryConfirmed extends Assertion { type: 'EntryConfirmed'; at: string; target: Settles; id: string }
/** Dismisses a live entry ("this is wrong") or discards a proposal. */
interface EntryDismissed extends Assertion { type: 'EntryDismissed'; at: string; target: Settles; id: string }

/** An operation that can be held as a proposal: an add, a supersede or a retire. */
type ProposableOp = EntryAdded | EntrySuperseded | EntryRetired
/** An operation held back for the subject to settle, with why it was held. `id` is the proposal's own. */
interface EntryProposed { type: 'EntryProposed'; at: string; id: string; reason: string; op: ProposableOp }

/** An operation on the entry log, as validated and stored. */
type EntryEvent =
  | EntryAdded | EntrySuperseded | EntryRetired | EntryConfirmed
  | EntryDismissed | EntryProposed | EntryRedacted

/**
 * A host marker, not an operation: the host's one-time import of what it held
 * before is complete for this subject. The host appends it itself, after every
 * event the import wrote; the validator refuses it as an operation. The fold
 * records when, and no entry changes — a host reads it to know the log is the
 * subject's memory now, rather than guessing from where entries came from.
 */
interface MigrationApplied { type: 'MigrationApplied'; at: string }

// An operation may leave out what the validator stamps: whose claim it is and
// how its text arrived, from the writer, and when it happened, from `now`.
type Unstamped<T extends Assertion> = Omit<T, 'assertedBy' | 'origin'> & Partial<Pick<Assertion, 'assertedBy' | 'origin'>>
type Undated<T extends { at: string }> = Omit<T, 'at'> & { at?: string }
type DraftInput = Unstamped<EntryDraft>
type ProposableInput =
  | Undated<Omit<EntryAdded, 'entry'> & { entry: DraftInput }>
  | Undated<Omit<EntrySuperseded, 'entry'> & { entry: DraftInput }>
  | Undated<Unstamped<EntryRetired>>
/**
 * An operation as the host submits it. Whose claim it is and how its text
 * arrived follow from the writer the host names, so `assertedBy` and `origin`
 * may be left out and the validator stamps them; where they are given, they
 * must agree. `at` may be left out too: the validator stamps every event with
 * its `now`. What the validator lets through, and so what is stored, is an
 * `EntryEvent` and always carries all three.
 */
type EntryOperation =
  | ProposableInput | Undated<Unstamped<EntryConfirmed>> | Undated<Unstamped<EntryDismissed>> | Undated<Unstamped<EntryRedacted>>
  | Undated<Omit<EntryProposed, 'op'> & { op: ProposableInput }>

/** Everything the fold reads from a log: the operations, and the host's markers. */
type LogEvent = EntryEvent | MigrationApplied

/** An entry as the fold leaves it. */
interface Entry extends EntryDraft {
  status: Status
  /** When it was added or proposed. */
  at: string
  supersedes?: string
  supersededBy?: string
  confirmedAt?: string
  retiredReason?: string
  /** Forgotten on request: the text is gone, the id and the history stay. */
  redacted: boolean
  /** When it was forgotten: the redact's time. */
  redactedAt?: string
}

/** A proposal as the fold leaves it: open until the subject applies or discards it. */
interface Proposal {
  id: string
  at: string
  reason: string
  op: ProposableOp
  status: 'open' | 'applied' | 'discarded'
}

/** What a log folds to: every entry and proposal, per-run counts and when a migration landed. */
interface EntryState {
  /** Every entry ever seen, in the order it first appeared. A proposed add or supersede is one, with status `proposed`. */
  entries: Entry[]
  /** Every proposal ever made, in order. */
  proposals: Proposal[]
  /** Operations appended per writer and run (`writer:runId`), so a run's cap holds across calls. */
  runs: Record<string, number>
  /** When the host's one-time migration was applied (MigrationApplied); absent until it was. */
  migratedAt?: string
}

export type {
  Principal, Party, Writer, Origin, Severity, Status, Source, Reference, RecordSource, EntriesSource, HostRecord, Assertion, EntryDraft, Message,
  EntryAdded, EntrySuperseded, EntryRetired, EntryConfirmed, EntryDismissed,
  EntryRedacted, EntryProposed, ProposableOp, EntryEvent, Entry, EntryState, Proposal, Settles,
  MigrationApplied, LogEvent, EntryOperation,
}
