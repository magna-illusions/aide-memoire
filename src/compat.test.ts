import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { foldEntries, renderEntries } from './index.ts'
import type { LogEvent } from './index.ts'

// A log is kept for years and the package moves under it, so a stored log must
// replay to the state it had when it was written. The fixture is a log an early
// validator wrote (every writer, proposals applied and discarded, a supersede, a
// forget written back with tombstoneRedacted, the migration marker, and two
// events a hand repair left that the fold skips), saved with the state and the
// rendering it folded to then. Neither file is ever regenerated: a change that
// moves either is a change to what every stored log means.

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
const log: LogEvent[] = read('./compat.log.json')
const { state, rendering, rendered } = read('./compat.state.json')

describe('a stored log', () => {
  it('folds to the state it was saved with', () => {
    assert.deepEqual(foldEntries(log), state)
  })

  it('renders the block it was saved with, under the render policy of its time', () => {
    assert.deepEqual(renderEntries(foldEntries(log), '2026-10-01T00:00:00Z', rendering), rendered)
  })
})
