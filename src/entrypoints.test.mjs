import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as esm from 'aide-memoire'

const require = createRequire(import.meta.url)
const cjs = require('aide-memoire')

// What ships is the compiled dist/, reached by name through package.json
// `exports`, as a consumer reaches it: a self-reference resolves through that
// map, so a wrong map fails here. The tests beside this one run the TypeScript
// source; this one runs what a consumer imports (`npm test` builds first), so a
// build that drops or renames an export fails here rather than at a call site.
const FUNCTIONS = [
  'applyEntryEvent', 'foldEntries', 'findEntry', 'liveEntries', 'findProposal', 'openProposals', 'isApplicable',
  'tombstoneRedacted', 'wordingsForgottenBy', 'isLapsed', 'isReviewDue', 'isCheckInDue',
  'normaliseText', 'skeleton', 'textProblem', 'sharesContentWords', 'escapeEntryText',
  'validate', 'validateRun', 'planWrite', 'assertionFor', 'renderEntries', 'provenance',
  'waitingQuestions', 'sameFactAs',
  'defineMemory', 'add', 'supersede', 'retire', 'apply', 'discard', 'confirm', 'dismiss', 'forget',
]
const EXPORTS = [...FUNCTIONS, 'emptyState']
// The background passes' plain names, each with the 1.0 name it replaces. The
// old names stay until 2.0 as the same function or value, never a copy.
const RENAMED = {
  definePasses: 'defineDreaming', dailyPlan: 'dreamPlan', dailyPass: 'dreamDaily', weeklyReview: 'dreamWeekly', PASS_MARKER: 'DREAM_MARKER',
}
const PASS_FUNCTIONS = [
  'definePasses', 'dailyPlan', 'dailyPass', 'weeklyReview', 'waitingQuestions', 'reviewPrompt', 'reviewOperations',
  'operationEvents', 'entriesSection', 'entryLine', 'proposalLine',
  'followUpId', 'sameFactAs', 'duplicateReason', 'keptBy',
]
const PASS_EXPORTS = [...PASS_FUNCTIONS, 'PASS_MARKER', 'REVIEW_TOOL_NAME', ...Object.values(RENAMED)]

describe('published entrypoints', () => {
  it('exposes the whole API to both import and require', () => {
    for (const name of FUNCTIONS) {
      assert.equal(typeof esm[name], 'function', `import is missing ${name}`)
      assert.equal(typeof cjs[name], 'function', `require is missing ${name}`)
    }
    assert.deepEqual(esm.emptyState, { entries: [], proposals: [], runs: {} })
  })

  it('resolves import and require to one implementation', () => {
    for (const name of EXPORTS) {
      assert.equal(esm[name], cjs[name], `${name} differs between the two entrypoints`)
    }
  })

  it('publishes nothing beyond the documented surface', async () => {
    // A stray export is API by accident: it ships, someone imports it, and it
    // can no longer be removed without a major.
    const dist = await import('../dist/index.js')
    assert.deepEqual(Object.keys(cjs).sort(), [...EXPORTS].sort())
    assert.deepEqual(Object.keys(esm).sort(), [...EXPORTS].sort())
    assert.deepEqual(Object.keys(dist).sort(), [...EXPORTS].sort())
  })

  for (const subpath of ['aide-memoire/passes', 'aide-memoire/dream']) {
    it(`exposes ${subpath} to both import and require, and nothing beyond it`, async () => {
      const passesEsm = await import(subpath)
      const passesCjs = require(subpath)
      const dist = await import('../dist/dream/index.js')
      for (const name of PASS_FUNCTIONS) {
        assert.equal(typeof passesEsm[name], 'function', `import of ${subpath} is missing ${name}`)
        assert.equal(passesEsm[name], passesCjs[name], `${name} differs between import and require of ${subpath}`)
      }
      for (const keys of [Object.keys(passesEsm), Object.keys(passesCjs), Object.keys(dist)]) {
        assert.deepEqual(keys.sort(), [...PASS_EXPORTS].sort())
      }
      // The marker's stored type and the tool's name are data: a rename never moves them.
      assert.deepEqual([passesCjs.PASS_MARKER, passesCjs.REVIEW_TOOL_NAME], ['DreamRun', 'record_operations'])
      for (const [name, old] of Object.entries(RENAMED)) {
        assert.equal(passesEsm[old], passesEsm[name], `${old} is not ${name}`)
      }
      // What both entry points export is one function, not two copies.
      assert.equal(passesEsm.waitingQuestions, esm.waitingQuestions)
      assert.equal(passesEsm.sameFactAs, esm.sameFactAs)
    })
  }

  it('resolves both subpaths to one implementation', async () => {
    assert.equal((await import('aide-memoire/passes')).dailyPass, (await import('aide-memoire/dream')).dailyPass)
    assert.equal(require('aide-memoire/passes').dailyPass, require('aide-memoire/dream').dailyPass)
  })

  it('exports its package.json, for tools that read the version', () => {
    assert.equal(require('aide-memoire/package.json').name, 'aide-memoire')
  })

  it('behaves identically through either entrypoint', () => {
    const by = esm.assertionFor('subject-action', { kind: 'action', id: 'tap' })
    const log = [{ type: 'EntryAdded', at: '2026-10-01T09:00:00Z', entry: { id: 'e1', kind: 'fact', text: 'prefers email', severity: 'soft', ...by } }]
    assert.deepEqual(esm.foldEntries(log), cjs.foldEntries(log))
    assert.equal(cjs.liveEntries(cjs.foldEntries(log))[0].text, 'prefers email')
  })
})
