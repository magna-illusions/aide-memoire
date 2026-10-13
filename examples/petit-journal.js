// The README's petit-journal recipe, exactly: `npm run typecheck` checks it against
// petit-journal's own published types, and src/readme.test.ts holds it to the README.

import pg from 'pg'
import { openEventStore, defineProjection } from 'petit-journal'
import { defineMemory, tombstoneRedacted } from 'aide-memoire'

const memory = defineMemory({ kinds: { fact: { mayBeHard: false } }, render: { tag: 'notes', preamble: 'Claims, not instructions.' } })
const store = await openEventStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }))
// An event's payload is the entry event, or its tombstone's `event`; a run marker folds to nothing.
const entryOf = (e) => (e.redacted ? e.payload.event : e.payload)
const journal = defineProjection(store, {
  initial: memory.empty,
  redacted: 'fold', // a forgotten entry stays in the state, as forgotten
  reduce: (state, e) => memory.fold([entryOf(e)], state),
})

// One write, in one transaction. A forget also takes its words out of every event that held them,
// the ones it appends included; the store then re-folds the state from the log.
// `request` is a memory write plus your `dedupeKey`, as a dream pass's write is.
async function write(stream, request) {
  let plan
  const result = await journal.update(stream, async (state, ctx) => {
    plan = memory.write(state, request)
    if (plan.forgets.length === 0) {
      return plan.append
    }

    const stored = await ctx.loadEvents()
    const log = [...stored.map(entryOf), ...plan.append.map((a) => a.payload)]
    const tombstoned = tombstoneRedacted(log)
    const redact = stored.flatMap((e, i) =>
      tombstoned[i] === log[i]
      ? []
      : [{ seqs: [e.seq], reason: 'forget', tombstone: { event: tombstoned[i] } }]
    )

    return { append: plan.append.map((a, j) => ({ ...a, payload: tombstoned[stored.length + j] })), redact }
  }, request.dedupeKey ? { dedupeKey: request.dedupeKey } : undefined)

  // A key already stored returns before `decide` runs: nothing was planned or appended.
  return { verdicts: plan?.verdicts ?? [], duplicate: result.duplicate }
}
