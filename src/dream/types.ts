import type { EntryEvent, EntryState, Message } from '../log/types.ts'
import type { Verdict } from '../validation/validate.ts'

// What a dreaming pass reads, and what it hands the validator. The
// deterministic jobs are pure functions of this: no model, no I/O, no clock,
// so a day's run can be replayed from the same input and a fixture is only data.

/**
 * A value the host's records hold, on a day: a measurement, a logged best, an
 * alert's reading. Which one is the host's to say; the reality job only compares
 * it with the value an entry names.
 */
interface RecordValue {
  /** What the value is of, in the host's words; matched against an entry's text by a shared content word. */
  label: string
  value: number
  /** YYYY-MM-DD */
  day: string
  /**
   * The host's id and time (ISO, with `Z` or an offset) for the record. With both,
   * and `reality.citeRecords` on, a pass that finds no message of the subject's
   * reporting the value cites the record itself, which the validator holds as a question.
   */
  id?: string
  at?: string
}

/** One of the subject's own messages, with the session it was written in where the host knows it: recurrence counts sessions. */
interface SubjectMessage extends Message {
  session?: string
}

/**
 * The host's numbers and words for a pass. Every pass writes as the
 * `consolidation` writer, so the validator still decides what is applied, held
 * or refused; this only says what to ask, how often, and how much.
 */
interface DreamPolicy {
  /** Words that say nothing about which entry a message is about: the validator's, plus the host's filler. */
  stopwords: Set<string>
  /** The validator's entries-per-message cap: a pass cites a message with room left under it. */
  addsPerMessage: number
  /** At most this many operations from one run, whatever the jobs find. */
  maxOpsPerRun: number
  /** No new question while this many already wait for the subject. */
  maxOpenQuestions: number
  /** A check-in or correction is asked once, then not again for this many days, whatever the answer. */
  cooldownDays: number
  followUp: {
    /** A dated event: an entry of one of these kinds with an `until`, its date. */
    kinds: string[]
    /** Only an event whose date passed within this many days; older is history. */
    windowDays: number
    /** The follow-up holds this many days, then lapses itself. */
    horizonDays: number
    /** The kind the follow-up is written as: not one of `kinds`, so a follow-up never follows itself up. */
    kind: string
    /**
     * Where no message of the subject's speaks of the event, rest the follow-up on
     * the record the event itself rests on (off by default). Only when `kind` takes
     * records softly in the validator (`KindRule.fromRecord: 'soft'`) and the
     * writer passes the stream `owner` and a `records` lookup: otherwise every such
     * follow-up is held as a question, or refused.
     */
    citeRecords?: boolean
    text: (eventText: string, date: string) => string
  }
  checkIn: {
    /** A hard entry the subject has not mentioned for this many weeks… */
    quietWeeks: number
    /** …while they were active in at least this many of those weeks. */
    activeWeeks: number
    reason: (weeks: number) => string
  }
  /** The kinds the validator protects: what a pass finds there is a question. */
  protectedKinds: string[]
  duplicate: {
    /** Two live entries of one kind and one severity say the same thing when the other holds this share of the shorter one's content words. */
    share: number
    /** Words that say no: a copy says no, or not, alike. */
    negations: Set<string>
  }
  recurrence: {
    /** The kinds whose observed entries may be promoted: never a protected one. */
    kinds: string[]
    /** Messages count only within this many days. */
    windowDays: number
    /** A message says the entry when it holds this share of the entry's content words. */
    share: number
    /** Said in at least this many messages… */
    messages: number
    /** …across at least this many sessions. */
    sessions: number
  }
  /** The periodic model review. */
  review: {
    /** How often it may run, in days: once per period, counted from a Monday. Default 7, the ISO week. */
    everyDays?: number
    /** The subject's own words it reads. */
    lookbackDays: number
    /** The dismissed proposals it is shown, and held against. */
    dismissedDays: number
    /** A proposal sharing at least this much of a dismissed one's words asks it again, and is dropped. */
    repeatShare: number
  }
  reality: {
    /** The kind that holds values the records can contradict. */
    kind: string
    /** The unit an entry's value is written in, right after the number ("80 ms"). */
    unit: string
    /** A record more than this share above or below what memory says disagrees with it. */
    tolerance: number
    /**
     * Cite the record itself where no message of the subject's reports the value
     * (off by default). Only for a host whose writer passes the validator the
     * stream `owner` and a `records` lookup that answers synchronously from data
     * it loaded beforehand: without them every such correction is refused, every day.
     */
    citeRecords?: boolean
    text: (label: string, value: number, day: string) => string
  }
}

/** What the daily pass reads, all of it loaded: state, messages, activity, records, day and policy. */
interface DreamInput {
  state: EntryState
  /** The subject's own messages over the window the jobs look back on: the only ones a pass may cite. */
  messages: SubjectMessage[]
  /** Days (YYYY-MM-DD) the subject was active, over at least the check-in window. */
  activityDays: string[]
  /** Values from the host's records, or null where the host has no read path to them. */
  records: RecordValue[] | null
  /** YYYY-MM-DD, the subject's calendar day. */
  today: string
  /** The host's clock, ISO. */
  now: string
  /** One pass, stamped on every operation it submits. */
  runId: string
  /** The host's id generator, for the entries and proposals a job builds. */
  newId: (prefix: 'entry' | 'proposal') => string
  policy: DreamPolicy
}

/** The daily jobs, by name. */
type Job = 'follow-up' | 'check-in' | 'reality' | 'duplicate' | 'recurrence'

/** One operation a job would submit, and which job found it. */
interface Candidate {
  job: Job
  /** The id of the entry it is about: safe to log, unlike its words. */
  about: string
  event: EntryEvent
}

/** What a pass hands the host's writer: one call, as the `consolidation` writer. */
interface DreamWrite {
  writer: 'consolidation'
  runId: string
  /** Which job this is, as you named it in the pass's deps: the validator stamps it on every operation. */
  actor?: string
  /** The host's clock, ISO. */
  now: string
  /** The messages the operations may cite. */
  messages: Message[]
  ops: EntryEvent[]
  /** The state the operations were planned from, so the host can refuse what a forget since then took. */
  base?: EntryState
  /** Makes a second write of the same run a no-op: the first event appended carries it. */
  dedupeKey?: string
  /** A host event appended first, the run's record of itself. The core fold skips it. */
  marker?: { type: string; payload: Record<string, unknown> }
}

/** What the host's writer answers: each operation's verdict, and whether the write was a duplicate. */
interface DreamWriteOutcome {
  verdicts: Verdict[]
  /** The dedupe key was seen before: nothing was validated or appended. */
  duplicate?: boolean
}

export type { RecordValue, SubjectMessage, DreamPolicy, DreamInput, Job, Candidate, DreamWrite, DreamWriteOutcome }
