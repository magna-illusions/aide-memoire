import { sharesContentWords } from '../text.ts'
import type { Assertion, HostRecord, Message, RecordSource, Reference, Writer } from '../log/types.ts'

// What a cited message must show. Text that reaches memory is only as good as the
// claim about where it came from, and the claim is checked structurally:
// - A cited message must be one of the owner's (the host passes only theirs).
// - Unless an operator or a migration wrote it, a cited message must be the
//   subject's own — not the agent's message, however much of it reads in the
//   subject's voice. An agent can offer a reply for the subject to tap; until they
//   tap it, the words are the agent's.
// - Where it answers something — settles a proposal, closes a hard entry, forgets
//   an entry — it must be newer than what it answers. An old message cannot be
//   the subject's answer to a question asked after it.
// - Where it stands for the subject's words, it must share a content word with
//   what it is said to say.
//
// A cited record is the host's data, not the subject's words, so only what the
// host vouches for is checked: it exists, it is the stream owner's, and where it
// answers something it is newer. What it says is not read — the lookup gives no
// text — which is why what the agent or a pass builds on one is held (writer.ts).

interface CitationRule {
  /** The operation must cite a message. */
  required?: boolean
  /** The cited message must be newer than this ISO timestamp. */
  after?: string
  /** The cited message must share a content word with this text. */
  about?: string
}

/** What citations are checked against: all of it passed in by the host, nothing fetched. */
interface Evidence {
  messages: Message[]
  stopwords: Set<string>
  /** The stream owner, as the host names them: a cited record must be theirs. */
  owner?: string
  records?: (id: string) => HostRecord | undefined
}

const ANY_ROLE: Writer[] = ['operator', 'migration']

function isNewer(at: string, than: string | undefined): boolean {
  return !than || Date.parse(at) > Date.parse(than)
}

function messageProblem(source: Reference, writer: Writer, rule: CitationRule, evidence: Evidence): string | null {
  const message = evidence.messages.find((m) => m.id === source.id)
  if (!message) {
    return 'cited message is not in this stream'
  }
  if (!ANY_ROLE.includes(writer) && message.role !== 'subject') {
    return "cited message is not the subject's"
  }
  if (!isNewer(message.at, rule.after)) {
    return 'cited message is older than what it answers'
  }
  if (rule.about !== undefined && !sharesContentWords(rule.about, message.text, evidence.stopwords)) {
    return 'cited message does not say this'
  }
  return null
}

// An instant, not a wall-clock time: without an offset, a time reads as the
// server's local time, and the same record would be newer on one host and older
// on another.
const INSTANT = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i

function isHostRecord(answer: unknown): answer is HostRecord {
  if (typeof answer !== 'object' || answer === null) return false
  const { id, at, owner } = answer as Record<string, unknown>
  return typeof id === 'string' && typeof owner === 'string'
    && typeof at === 'string' && INSTANT.test(at) && !Number.isNaN(Date.parse(at))
}

// The lookup is the host's code: what it answers is checked like any input, and
// a lookup that throws is a refusal, so the validator still never throws.
const LOOKUP_FAILED = Symbol('lookup failed')

function ask(records: NonNullable<Evidence['records']>, id: string): unknown {
  try {
    return records(id)
  } catch {
    return LOOKUP_FAILED
  }
}

/** The record the host vouches for under this id, or why there is none. */
function lookUp(source: RecordSource, evidence: Evidence): HostRecord | string {
  if (!evidence.records || evidence.owner === undefined) return 'no host records to check the cited record against'
  const answer = ask(evidence.records, source.id)
  if (answer === LOOKUP_FAILED) return 'the host record lookup failed'
  if (answer === undefined || answer === null) return 'cited record does not exist'
  if (!isHostRecord(answer)) return 'the host answered with a malformed record'
  if (answer.id !== source.id) return 'cited record does not exist'
  return answer.owner === evidence.owner ? answer : "cited record is not the stream owner's"
}

function recordProblem(source: RecordSource, rule: CitationRule, evidence: Evidence): string | null {
  const record = lookUp(source, evidence)
  if (typeof record === 'string') return record
  return isNewer(record.at, rule.after) ? null : 'cited record is older than what it answers'
}

/**
 * Why an operation's citation does not check out under `rule`, or null. The
 * entries a consolidation proposal reconciles are checked against the state, by
 * the validator, not here.
 */
function citationProblem(by: Assertion, writer: Writer, rule: CitationRule, evidence: Evidence): string | null {
  switch (by.source.kind) {
    case 'message': return messageProblem(by.source, writer, rule, evidence)
    case 'record': return recordProblem(by.source, rule, evidence)
    case 'entries': return null
    default: return rule.required ? "the agent cites the subject's message" : null
  }
}

/** What a call's context gives a citation to be checked against. */
function evidenceOf(ctx: { messages: Message[]; policy: { stopwords: Set<string> }; owner?: string; records?: Evidence['records'] }): Evidence {
  return { messages: ctx.messages, stopwords: ctx.policy.stopwords, owner: ctx.owner, records: ctx.records }
}

/** The host's time for a cited record, which is what is stored. */
function recordTime(source: RecordSource, evidence: Evidence): RecordSource {
  const record = lookUp(source, evidence)
  return typeof record === 'string' ? source : { ...source, at: record.at }
}

export { citationProblem, evidenceOf, recordTime }
export type { CitationRule, Evidence }
