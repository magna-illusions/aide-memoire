import { foldEntries } from '../../log/fold.ts'
import type { ValidationContext, ValidationPolicy } from '../../validation/validate.ts'
import { planWrite } from '../../write/plan.ts'
import type { EntryEvent, EntryState, LogEvent, Message, Writer } from '../../log/types.ts'
import type { DreamWriteOutcome } from '../types.ts'
import { VALIDATION } from './fixture.ts'

// The least a host does around a pass, in memory: plan the write (planWrite),
// append what it says, and make a second write of the same dedupe key a no-op.
// A real host does this under its store's lock.

interface HostWrite {
  writer: Writer
  runId?: string
  actor?: string
  now: string
  messages: Message[]
  ops: EntryEvent[]
  dedupeKey?: string
  marker?: { type: string; payload: Record<string, unknown> }
  base?: EntryState
}

function memoryHost(policy: ValidationPolicy = VALIDATION, context: Partial<ValidationContext> = {}) {
  const log: LogEvent[] = []
  const keys = new Set<string>()
  const markers: NonNullable<HostWrite['marker']>[] = []
  let held = 0

  async function write(_owner: string, w: HostWrite): Promise<DreamWriteOutcome> {
    if (w.dedupeKey && keys.has(w.dedupeKey)) return { verdicts: [], duplicate: true }
    const plan = planWrite(foldEntries(log), {
      policy, messages: w.messages, writer: w.writer, runId: w.runId, actor: w.actor, now: w.now, proposalId: () => `p_h${++held}`, ...context,
      ops: w.ops, base: w.base, marker: w.marker,
    })
    if (w.dedupeKey && plan.append.length > 0) keys.add(w.dedupeKey)
    if (w.marker) markers.push(w.marker)
    log.push(...plan.append.slice(w.marker ? 1 : 0).map((a) => a.payload as LogEvent))
    return { verdicts: plan.verdicts, duplicate: false }
  }

  return {
    log, markers, write,
    load: async (): Promise<EntryState> => foldEntries(log),
    runRecorded: async (_owner: string, key: string) => keys.has(key),
  }
}

/** The host's id generator: d1, d2, … for entries and p_d1, … for proposals. */
function counter(): (prefix: 'entry' | 'proposal') => string {
  let n = 0
  return (prefix) => `${prefix === 'proposal' ? 'p_d' : 'd'}${++n}`
}

export { memoryHost, counter }
export type { HostWrite }
