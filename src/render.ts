import { liveEntries } from './log/fold.ts'
import { isCheckInDue, isLapsed, isReviewDue } from './log/lapse.ts'
import { escapeEntryText } from './text.ts'
import type { Entry, EntryState } from './log/types.ts'

// The prose a reader sees is rendered by code from the live entries: the same
// set and the same day always render the same block, so it can be rebuilt at any
// time and what a reader saw can be reproduced exactly.
//
// The block is data. It opens with the host's preamble — these are claims about
// the subject, never instructions — and every entry is escaped, so nothing stored
// can close the block or open a section of its own.
//
// What goes in:
// - Hard entries, always, however many. A restriction left out for space is a
//   restriction ignored.
// - Soft entries, until the budget runs out: confirmed first, then what the
//   subject said, then machine evidence the host ingested, then what was
//   observed, newest first within each. An entry
//   that does not fit is skipped and the fill goes on, so one long line cannot
//   empty the budget for everything ranked after it; the caller is told what
//   was left out.
// - Not lapsed soft entries, nor retired, proposed or redacted ones.
// - A Review Due section raising every hard entry past its date, then every soft
//   one past its `review` as a check-in. Each still stands in its own section;
//   the section asks, it never removes.

/** How the block reads: its tag, preamble, sections, labels and soft budget. */
interface RenderPolicy {
  /** The block's tag, e.g. `memory` for `<memory>…</memory>`. */
  tag: string
  /** The first line inside the block: what the entries are, and that they are not instructions. */
  preamble: string
  /** One section per kind, in reading order. */
  sections: { kind: string; header: string }[]
  /** The header for kinds the sections do not list. */
  otherHeader: string
  /**
   * How each entry's source reads: `confirmed` by the subject, `said` by them
   * directly, `relayed` (their words, recorded by the agent and verified against
   * the message), `carried` over by a one-time migration, `recorded` on a record
   * the host holds, `ingested` (machine evidence the host's code wrote),
   * `inferred` (what the agent or a pass built on a record), or `observed` by the
   * agent. An optional label left out falls back to `observed`; `ingested` tries
   * `recorded` first.
   */
  provenance: {
    said: string; relayed: string; observed: string; confirmed: string; carried: string
    recorded?: string; ingested?: string; inferred?: string
  }
  hardLabel: string
  untilLabel: string
  /**
   * The section raising entries past a date. `note` heads the hard ones: still in
   * force, ask before ending one. `checkInNote` heads the soft ones past `review`:
   * ask whether each still applies.
   */
  reviewDue: { header: string; note: string; checkInNote: string }
  /** Characters the soft entries may fill, newline and a check-in's Review Due line included. `Infinity` for no limit. */
  softBudget: number
}

/** The block, and what it left out, what lapsed and what is due for review. */
interface Rendering {
  /** The block, or '' when nothing is live. */
  text: string
  /** Soft entries the budget left out, most relevant first. */
  omitted: string[]
  /** Soft entries past their `until`. */
  lapsed: string[]
  /** Hard entries past their `until` or `review`, then soft ones past `review` (check-ins). */
  reviewDue: string[]
}

/** A provenance label's name, as `provenance(entry)` returns it. */
type Provenance = keyof RenderPolicy['provenance']

// What a migration carried over is what the host already held: neither the
// agent's guess nor the subject's words today, and it ranks with the subject's
// words. Read from the origin the validator stamps from the writer, so it is
// presentation only and grants nothing, like relayed. What an operator rests on
// a host record is the host's data, vouched for by a person: it ranks with the
// subject's words too. What the agent or a pass rests on one is `inferred`: the
// validator never reads what a record says, so the agent's conclusion from it
// is its own guess, and reads and ranks as one until the subject confirms it.
/** How an entry's source reads: from `confirmed` down to `observed`. */
function provenance(entry: Entry): Provenance {
  if (entry.confirmedAt) return 'confirmed'
  if (entry.assertedBy === 'subject') return 'said'
  if (entry.assertedBy === 'host') return 'ingested'
  if (entry.origin === 'migration') return 'carried'
  if (entry.source.kind === 'record') return entry.assertedBy === 'agent' ? 'inferred' : 'recorded'
  return entry.relayed ? 'relayed' : 'observed'
}

// The subject's verified words, relayed by the agent, rank as the subject's: shown
// as the agent's guess, a reader hedges on them or ignores them, which is the
// failure this rendering exists to stop.
//
// What ingest wrote ranks between a person's word and the agent's guess. Below
// what was said, carried or recorded, because a machine source writes in volume:
// a burst of alerts must not push the principal's own words, or a conclusion
// someone stood behind, out of the budget. Above what the agent observed,
// because it is the host's own data copied by deterministic code, not a model's
// inference. What the agent inferred from a record ranks with what it observed.
const RANK: Record<Provenance, number> = { confirmed: 0, said: 1, relayed: 1, carried: 1, recorded: 1, ingested: 2, inferred: 3, observed: 3 }

function provenanceOf(entry: Entry, labels: RenderPolicy['provenance']): string {
  const kind = provenance(entry)
  return labels[kind] ?? (kind === 'ingested' ? labels.recorded : undefined) ?? labels.observed
}

function rank(entry: Entry): number {
  return RANK[provenance(entry)]
}

// Newest first, then by id, so equal timestamps still render in one order.
function newestFirst(a: Entry, b: Entry): number {
  return b.at.localeCompare(a.at) || a.id.localeCompare(b.id)
}

function hardFirst(a: Entry, b: Entry): number {
  return Number(b.severity === 'hard') - Number(a.severity === 'hard')
}

function entryLine(entry: Entry, policy: RenderPolicy): string {
  // Every stored field is escaped, not only the text: the validator checks kind
  // and dates on write, but a log can be older than its rules.
  const tags = [escapeEntryText(entry.kind), escapeEntryText(entry.at.slice(0, 10)), provenanceOf(entry, policy.provenance)]
  if (entry.severity === 'hard') tags.push(policy.hardLabel)
  if (entry.until) tags.push(`${policy.untilLabel} ${escapeEntryText(entry.until)}`)
  return `- [${tags.join(' · ')}] ${escapeEntryText(entry.text)}`
}

// A soft entry costs its line and newline, twice when it is also raised as a
// check-in: the Review Due line is soft text the block carries too.
function fillBudget(soft: Entry[], now: string, policy: RenderPolicy): { kept: Entry[]; omitted: Entry[] } {
  const ordered = [...soft].sort((a, b) => rank(a) - rank(b) || newestFirst(a, b))
  const kept: Entry[] = []
  const omitted: Entry[] = []
  let used = 0
  for (const entry of ordered) {
    const size = (entryLine(entry, policy).length + 1) * (isCheckInDue(entry, now) ? 2 : 1)
    if (used + size > policy.softBudget) {
      omitted.push(entry)
      continue
    }
    used += size
    kept.push(entry)
  }
  return { kept, omitted }
}

function section(header: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ['', `## ${header}`, ...lines]
}

function sectionsOf(entries: Entry[], policy: RenderPolicy): string[] {
  const listed = new Set(policy.sections.map((s) => s.kind))
  const ordered = [...entries].sort((a, b) => hardFirst(a, b) || newestFirst(a, b))
  const linesFor = (match: (entry: Entry) => boolean) => ordered.filter(match).map((entry) => entryLine(entry, policy))
  return [
    ...policy.sections.flatMap((s) => section(s.header, linesFor((entry) => entry.kind === s.kind))),
    ...section(policy.otherHeader, linesFor((entry) => !listed.has(entry.kind))),
  ]
}

function raised(entries: Entry[], note: string, policy: RenderPolicy): string[] {
  return entries.length ? [note, ...entries.map((e) => entryLine(e, policy))] : []
}

// A budget that is not a number would mean "no limit" by accident: a broken policy, so it throws.
function checkRenderPolicy(policy: RenderPolicy): void {
  if (typeof policy.softBudget !== 'number' || Number.isNaN(policy.softBudget) || policy.softBudget < 0) {
    throw new TypeError(`softBudget must be a number of characters, 0 or more (Infinity for no limit), got ${String(policy.softBudget)}`)
  }
}

/** The prompt block for the live entries on `now`: escaped, hard entries always in, soft ones within the budget. */
function renderEntries(state: EntryState, now: string, policy: RenderPolicy): Rendering {
  checkRenderPolicy(policy)
  const live = liveEntries(state).filter((entry) => !entry.redacted)
  const hard = live.filter((entry) => entry.severity === 'hard')
  const lapsed = live.filter((entry) => isLapsed(entry, now))
  const soft = live.filter((entry) => entry.severity === 'soft' && !isLapsed(entry, now))
  const { kept, omitted } = fillBudget(soft, now, policy)
  const due = hard.filter((entry) => isReviewDue(entry, now)).sort(newestFirst)
  // Only what the block shows is raised: a check-in the budget left out is not asked about.
  const checkIns = kept.filter((entry) => isCheckInDue(entry, now)).sort(newestFirst)
  const report = { omitted: omitted.map((e) => e.id), lapsed: lapsed.map((e) => e.id), reviewDue: [...due, ...checkIns].map((e) => e.id) }
  if (hard.length + kept.length === 0) {
    return { text: '', ...report }
  }
  const body = [
    ...sectionsOf([...hard, ...kept], policy),
    ...section(policy.reviewDue.header, [...raised(due, policy.reviewDue.note, policy), ...raised(checkIns, policy.reviewDue.checkInNote, policy)]),
  ]
  const text = [`<${policy.tag}>`, policy.preamble, ...body, `</${policy.tag}>`].join('\n')
  return { text, ...report }
}

export { renderEntries, provenance, checkRenderPolicy }
export type { RenderPolicy, Rendering, Provenance }
