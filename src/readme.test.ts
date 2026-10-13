import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The examples in examples/ are type-checked by `npm run typecheck` and run here
// (`npm test` builds first; an example imports the built package). The two the
// README shows are held to it exactly, below each file's own comment; the others
// print what their trailing `Prints:` comment says. The petit-journal recipe
// needs Postgres and petit-journal, so it is type-checked and held to the README,
// not run.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const readme = read('../README.md')
const shownIn = (heading: string) => readme.slice(readme.indexOf(heading)).match(/```js\n([\s\S]*?)```(?:\n\n```\n([\s\S]*?)```)?/) ?? []
const body = (file: string) => read(`../examples/${file}`).replace(/^(\/\/.*\n)+\n/, '')
const run = (file: string) => execFileSync(process.execPath, [fileURLToPath(new URL(`../examples/${file}`, import.meta.url))], { encoding: 'utf8' })

describe('the README\'s quick start', () => {
  const [, shown, output] = shownIn('## Quick start')

  it('is examples/quick-start.js, the file the typecheck checks', () => {
    assert.equal(body('quick-start.js'), shown)
  })

  it('prints the output the README shows', () => {
    assert.equal(run('quick-start.js'), output)
  })
})

describe('the README\'s petit-journal recipe', () => {
  it('is examples/petit-journal.js, the file the typecheck checks', () => {
    assert.equal(body('petit-journal.js'), shownIn('#### With petit-journal')[1])
  })
})

for (const file of ['assistant.js', 'ledger.js']) {
  describe(`examples/${file}`, () => {
    it('prints what its Prints: comment says', () => {
      const comment = read(`../examples/${file}`).split('// Prints:\n')[1]
      const expected = comment.split('\n').filter(Boolean).map((line) => line.replace(/^\/\/ ?/, '')).join('\n')
      assert.equal(run(file), `${expected}\n`)
    })
  })
}
