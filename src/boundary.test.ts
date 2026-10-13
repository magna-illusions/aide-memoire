import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// The package boundary: no runtime dependencies, and the core never imports the
// dream subpath, which builds on it. The build itself (`types: []`) refuses a
// node: import in what ships, so only these two need a test.

const src = new URL('.', import.meta.url)
const root = new URL('..', import.meta.url)

// Every relative import specifier in a module: static, side-effect, dynamic or re-export.
const RELATIVE = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])(\.{1,2}\/[^'"`]+)\1/g

describe('the package boundary', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
    assert.equal(pkg.dependencies, undefined)
    assert.equal(pkg.peerDependencies, undefined)
  })

  it('keeps the core from importing the dream subpath', () => {
    const dream = new URL('dream/', src).pathname
    const core = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.startsWith('dream/') && !name.endsWith('.test.ts'))
    const intoDream = core.flatMap((name) => [...readFileSync(new URL(name, src), 'utf8').matchAll(RELATIVE)]
      .filter((match) => new URL(match[2], new URL(name, src)).pathname.startsWith(dream))
      .map((match) => `${name} imports ${match[2]}`))
    assert.deepEqual(intoDream, [])
  })
})
