import { liveEntries } from '../log/fold.ts'
import { sharesContentWords } from '../text.ts'
import { assertionFor } from '../validation/writer.ts'
import type { Entry, EntryProposed, Source } from '../log/types.ts'
import { askedAbout } from './asked.ts'
import { addDays, dayOf } from './days.ts'
import { mentionsAfter } from './mentions.ts'
import type { Candidate, DailyInput, RecordValue } from './types.ts'

// "Reality": a value in memory checked against the host's records. Where the
// newest record of the same thing is further from the entry's value than the
// policy's tolerance, the pass proposes the record's value as a supersede, held
// as a question ("Has this changed?") for the subject or a responsible role.
//
// Read only where the entry names one value in the policy's unit ("about 80
// ms"); a range, another unit or two values in one line are left alone rather
// than guessed at.
//
// The validator lets a consolidation pass change a soft entry only on a message
// of the subject's, newer than the entry, that speaks of it. So the pass cites
// the subject's own report of the value — their message that names the record's
// label and its value — where there is one. Where there is none, the host opted
// in (`citeRecords`) and gave the record's id and time, it cites the record
// itself; the validator checks that through the host's `records` lookup. Either
// way the job submits the correction as a proposal, so it is a question whatever
// the kind's `fromRecord` would allow. Without either, nothing.
//
// A correction resting on a record is the subject's least: the planner puts it
// after every other question. A host whose writer cannot check the record sees
// it refused, which leaves no proposal and so no cooldown — it comes back daily,
// and must not take a slot from what the subject did say.

const NUMBER = /\d+(?:[.,]\d+)?/g

const parse = (n: string): number => Number(n.replace(',', '.'))

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The one value an entry names in `unit`, or null. A unit ending in a letter or
 * digit ends at a word boundary, so "ms" never reads "mss"; one ending in a sign
 * ("%") needs none.
 *
 * An empty unit is a broken policy, not bad data, so it throws: config
 * validation that fails the first run reading such an entry, where returning
 * null would hide it and reading every number would be worse.
 */
function valueOf(text: string, unit: string): number | null {
  if (unit.trim() === '') throw new TypeError('reality.unit must name a unit: without one every number is a value')
  const end = /\w$/.test(unit) ? '\\b' : ''
  const pattern = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${escapeRegExp(unit)}${end}`, 'gi')
  const found = [...text.matchAll(pattern)]
  return found.length === 1 ? parse(found[0][1]) : null
}

function newestRecord(entry: Entry, input: DailyInput): RecordValue | undefined {
  return (input.records ?? [])
    .filter((r) => r.day > dayOf(entry.at) && sharesContentWords(r.label, entry.text, input.policy.stopwords))
    .sort((a, b) => b.day.localeCompare(a.day) || b.value - a.value)[0]
}

function reportOf(record: RecordValue, entry: Entry, input: DailyInput): Source | undefined {
  const report = mentionsAfter(record.label, input.messages, entry.at, input.policy.stopwords)
    .find((m) => (m.text.match(NUMBER) ?? []).some((n) => parse(n) === record.value))
  return report ? { kind: 'message', id: report.id } : undefined
}

function citationFor(record: RecordValue, entry: Entry, input: DailyInput): Source | undefined {
  const report = reportOf(record, entry, input)
  if (report) return report
  return input.policy.reality.citeRecords && record.id && record.at ? { kind: 'record', id: record.id, at: record.at } : undefined
}

function correction(entry: Entry, record: RecordValue, cited: Source, input: DailyInput): EntryProposed {
  const by = { ...assertionFor('consolidation', cited), runId: input.runId }
  const text = input.policy.reality.text(record.label, record.value, record.day)
  return {
    type: 'EntryProposed', at: input.now, id: input.newId('proposal'), reason: 'the records show another value',
    op: {
      type: 'EntrySuperseded', at: input.now, supersedes: entry.id,
      entry: { id: input.newId('entry'), kind: entry.kind, severity: 'soft', text, ...by },
    },
  }
}

function disagreement(entry: Entry, input: DailyInput): Candidate[] {
  const { unit, tolerance } = input.policy.reality
  const value = valueOf(entry.text, unit)
  const record = value === null ? undefined : newestRecord(entry, input)
  if (value === null || !record || Math.abs(record.value - value) <= value * tolerance) return []
  const cited = citationFor(record, entry, input)
  return cited ? [{ job: 'reality', about: entry.id, event: correction(entry, record, cited, input) }] : []
}

function restsOnRecord(c: Candidate): boolean {
  return c.event.type === 'EntryProposed' && c.event.op.type === 'EntrySuperseded' && c.event.op.entry.source.kind === 'record'
}

/** Corrections the subject reported, and the ones resting on a record alone. */
function realitySync(input: DailyInput): { reported: Candidate[]; recorded: Candidate[] } {
  if (!input.records) return { reported: [], recorded: [] }
  const { state, policy } = input
  const cooledSince = addDays(input.today, -policy.cooldownDays)
  const found = liveEntries(state)
    .filter((e) => e.kind === policy.reality.kind && e.severity === 'soft' && !e.redacted && !askedAbout(state, e.id, cooledSince))
    .flatMap((e) => disagreement(e, input))
  return { reported: found.filter((c) => !restsOnRecord(c)), recorded: found.filter(restsOnRecord) }
}

export { realitySync, valueOf }
