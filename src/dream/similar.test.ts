import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { holds, overlap, saysTheSame } from './similar.ts'
import { POLICY } from './fixtures/fixture.ts'

const share = (a: string, b: string) => overlap(a, b, POLICY.stopwords)

describe('overlap', () => {
  it('is 1 for the same words, whatever the case, order or punctuation', () => {
    assert.equal(share('Prefers early meetings to late afternoons', 'afternoons, late MEETINGS: early prefers!'), 1)
  })

  it('counts an inflected word as the same when the shorter is a stem', () => {
    assert.equal(share('Prefers morning meeting slots', 'Prefers mornings for meetings in slots'), 1)
  })

  it('is read on the shorter side, so a rewording that adds words still matches', () => {
    assert.ok(share('Prefers early meetings', 'The subject prefers early meetings, on weekdays especially') >= 0.6)
  })

  it('is low for a different thing in the same domain', () => {
    assert.ok(share('Prefers early meetings to late afternoons', 'Spanish practice about 20 minutes a day') < 0.6)
  })

  it('is 0 when either side has no content words', () => {
    assert.equal(share('', 'Prefers early meetings'), 0)
    assert.equal(share('and the that', 'Prefers early meetings'), 0)
  })
})

describe('holds', () => {
  const held = (entry: string, message: string) => holds(entry, message, POLICY.stopwords)

  it('is read on the entry: a long message that says it holds it', () => {
    assert.ok(held('Prefers early meetings to late afternoons', 'Had early meetings again, I prefer them to late afternoons by far') >= 0.6)
  })

  it('is not read on the shorter side: a one-word message does not hold a sentence', () => {
    assert.ok(held('Prefers early meetings to late afternoons', 'Meetings?') < 0.6)
  })

  it('is 0 when the entry has no content words', () => {
    assert.equal(held('and the that', 'Prefers early meetings'), 0)
  })
})

describe('saysTheSame', () => {
  const same = (a: string, b: string) => saysTheSame(a, b, POLICY)

  it('is a strong overlap on the shorter side', () => {
    assert.equal(same('Prefers early meetings to late afternoons', 'Prefers the early meetings to late afternoons on weekdays'), true)
  })

  it('is not when the numbers differ: a value that moved is a change, not a copy', () => {
    assert.equal(same('Spanish practice about 20 minutes', 'Spanish practice about 40 minutes'), false)
  })

  it('is not when one says no and the other does not', () => {
    assert.equal(same('Peanuts: no satay sauce', 'Peanuts: satay sauce is fine'), false)
  })
})
