import { emptyState, foldEntries } from '../log/fold.ts'
import { WRITERS } from '../log/shape.ts'
import { waitingQuestions } from '../log/questions.ts'
import type { EntryState, LogEvent, Message, Proposal, Writer } from '../log/types.ts'
import { checkRenderPolicy, renderEntries, type RenderPolicy, type Rendering } from '../render.ts'
import type { KindRule, ValidationContext, ValidationPolicy } from '../validation/validate.ts'
import { planWrite, type WritePlan, type WriteRequest } from '../write/plan.ts'

// The front door: one config, bound into the policies the building blocks take,
// with few and boring defaults. Every default is behaviour only a major release
// can change, so they are listed once, here, and in docs/api.md.

// Words too common to show that a message says what an entry claims. English, as
// the default labels are; replace the list for another language.
const STOPWORDS = [
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had', 'was', 'were', 'are', 'but', 'its',
  'you', 'your', 'they', 'them', 'their', 'our', 'his', 'her', 'she', 'him', 'will', 'would', 'could', 'should',
  'about', 'into', 'than', 'then', 'there', 'what', 'when', 'where', 'which', 'who', 'all', 'any', 'can', 'did',
  'does', 'been', 'after', 'before', 'again', 'still', 'just', 'very', 'too', 'also', 'one', 'some', 'how', 'out',
  'off', 'yes', 'not', 'now', 'over', 'more', 'much', 'went', 'got', 'get',
]

const DEFAULTS = {
  maxTextLength: 200,
  caps: { liveEntries: 50, addsPerMessage: 3, opsPerRun: 20 },
  otherHeader: 'other',
  hardLabel: 'hard',
  untilLabel: 'until',
  reviewDue: { header: 'review due', note: 'Still in force: ask before ending one.', checkInNote: 'Ask whether each still applies.' },
  softBudget: 2000,
} as const

const PROVENANCE: RenderPolicy['provenance'] = {
  confirmed: 'confirmed', said: 'said', relayed: 'relayed', carried: 'carried', recorded: 'recorded',
  ingested: 'ingested', inferred: 'inferred', observed: 'observed',
}

/** How the block reads: a tag and a preamble, and anything else of the render policy you want other than the default. */
type RenderConfig = Pick<RenderPolicy, 'tag' | 'preamble'>
  & Partial<Omit<RenderPolicy, 'tag' | 'preamble' | 'provenance' | 'reviewDue'>>
  & { provenance?: Partial<RenderPolicy['provenance']>; reviewDue?: Partial<RenderPolicy['reviewDue']> }

/** The limits one writer gets other than the memory's own, each merged over them. */
interface WriterLimits {
  maxTextLength?: number
  caps?: Partial<ValidationPolicy['caps']>
}

/** One memory's config: its kinds, in the order the block lists them, how the block reads, and any limit you want other than the default. */
interface MemoryConfig {
  kinds: Record<string, KindRule>
  render: RenderConfig
  maxTextLength?: number
  stopwords?: Iterable<string>
  textRules?: ValidationPolicy['textRules']
  caps?: Partial<ValidationPolicy['caps']>
  /** Limits per writer, where one needs other than the memory's: `{ migration: { maxTextLength: 1000 } }`. */
  writers?: Partial<Record<Writer, WriterLimits>>
}

/** A write: who writes, the operations, and your clock. `messages` defaults to none, `proposalId` to `p<n>` after the questions the state holds. */
interface MemoryWrite extends Omit<WriteRequest, 'policy' | 'messages' | 'proposalId'> {
  messages?: Message[]
  proposalId?: ValidationContext['proposalId']
}

/** One memory, bound: the policies it built, and the building blocks with them. */
interface Memory {
  policy: ValidationPolicy
  rendering: RenderPolicy
  /** The state of a memory with nothing in it. */
  empty: EntryState
  /** The state a log folds to, from `from` (default `empty`). */
  fold(events: LogEvent[], from?: EntryState): EntryState
  /** The policy a writer is held to: `policy`, with any limits `writers` sets for it. */
  policyFor(writer: Writer): ValidationPolicy
  /** A whole write as data, as `planWrite` with the writer's policy. Your store appends, rewrites and saves. */
  write(state: EntryState, request: MemoryWrite): WritePlan
  /** The prompt block on `now`. */
  render(state: EntryState, now: string): Rendering
  /** The questions waiting for the subject, hard first, then newest. */
  questions(state: EntryState): Proposal[]
}

function checkConfig(config: MemoryConfig): void {
  if (Object.keys(config.kinds ?? {}).length === 0) throw new TypeError('defineMemory needs kinds: at least one')
  if (!config.render?.tag) throw new TypeError('defineMemory needs render.tag, the block\'s tag')
  if (!config.render.preamble) throw new TypeError('defineMemory needs render.preamble, what the block holds and that it is not instructions')
  checkWriters(config.writers ?? {})
}

// A misspelt writer or limit would otherwise do nothing at all, silently: the
// writer keeps the memory's limits and nobody finds out until a write is refused.
const LIMITS = ['maxTextLength', 'caps']
const CAPS = ['liveEntries', 'addsPerMessage', 'opsPerRun', 'ingestedEntries']

function checkNames(names: string[], known: string[], where: string, what: string): void {
  const unknown = names.find((name) => !known.includes(name))
  if (unknown !== undefined) throw new TypeError(`${where} has no ${what} ${JSON.stringify(unknown)}: one of ${known.join(', ')}`)
}

// Left out is fine; anything else that is not an object (`{ migration: 1000 }`) is a mistake.
function checkObject(value: unknown, where: string): void {
  if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new TypeError(`${where} must be an object`)
  }
}

function checkWriters(writers: NonNullable<MemoryConfig['writers']>): void {
  checkObject(writers, 'writers')
  checkNames(Object.keys(writers), WRITERS, 'writers', 'writer')
  for (const [writer, limits] of Object.entries(writers)) {
    checkObject(limits, `writers.${writer}`)
    checkNames(Object.keys(limits ?? {}), LIMITS, `writers.${writer}`, 'limit')
    checkObject(limits?.caps, `writers.${writer}.caps`)
    checkNames(Object.keys(limits?.caps ?? {}), CAPS, `writers.${writer}.caps`, 'cap')
  }
}

function policyOf(config: MemoryConfig): ValidationPolicy {
  return {
    kinds: config.kinds,
    maxTextLength: config.maxTextLength ?? DEFAULTS.maxTextLength,
    stopwords: new Set(config.stopwords ?? STOPWORDS),
    textRules: config.textRules ?? [],
    caps: { ...DEFAULTS.caps, ...config.caps },
  }
}

function writerPolicies(policy: ValidationPolicy, writers: MemoryConfig['writers'] = {}): (writer: Writer) => ValidationPolicy {
  const own = new Map(Object.entries(writers).map(([writer, limits]) => [writer, {
    ...policy,
    maxTextLength: limits?.maxTextLength ?? policy.maxTextLength,
    caps: { ...policy.caps, ...limits?.caps },
  }]))
  return (writer) => own.get(writer) ?? policy
}

function renderingOf(config: MemoryConfig): RenderPolicy {
  const { render } = config
  return {
    tag: render.tag,
    preamble: render.preamble,
    sections: render.sections ?? Object.keys(config.kinds).map((kind) => ({ kind, header: kind })),
    otherHeader: render.otherHeader ?? DEFAULTS.otherHeader,
    provenance: { ...PROVENANCE, ...render.provenance },
    hardLabel: render.hardLabel ?? DEFAULTS.hardLabel,
    untilLabel: render.untilLabel ?? DEFAULTS.untilLabel,
    reviewDue: { ...DEFAULTS.reviewDue, ...render.reviewDue },
    softBudget: render.softBudget ?? DEFAULTS.softBudget,
  }
}

// Questions are named after those the state already holds: p1, p2, and so on.
function questionIds(state: EntryState): ValidationContext['proposalId'] {
  let n = state.proposals.length
  return () => `p${++n}`
}

/** One memory from one config: its kinds, how its block reads, and its limits, with the defaults filled in. */
function defineMemory(config: MemoryConfig): Memory {
  checkConfig(config)
  const policy = policyOf(config)
  const policyFor = writerPolicies(policy, config.writers)
  const rendering = renderingOf(config)
  checkRenderPolicy(rendering)
  return {
    policy,
    rendering,
    empty: emptyState,
    fold: (events, from = emptyState) => foldEntries(events, from),
    policyFor,
    write: (state, { messages = [], proposalId = questionIds(state), ...request }) =>
      planWrite(state, { ...request, policy: policyFor(request.writer), messages, proposalId }),
    render: (state, now) => renderEntries(state, now, rendering),
    questions: waitingQuestions,
  }
}

export { defineMemory }
export type { Memory, MemoryConfig, MemoryWrite, RenderConfig, WriterLimits }
