import type { Memory } from '../memory/define.ts'
import { normaliseText } from '../text.ts'
import type { PassPolicy } from './types.ts'

// The pass policy for a memory: what a pass shares with it is derived (its
// stopwords, its caps, its protected kinds), and the rest is a default. Every
// job that needs your words or your kinds (follow-ups, corrections from
// records, recurrence, tidying copies) stays off until you name them; the one
// that needs neither (check-ins on quiet hard entries) runs as it is.

/** What you set of a pass policy: any part, each merged over the defaults. */
type PassOverrides = Partial<Omit<PassPolicy, 'followUp' | 'checkIn' | 'duplicate' | 'recurrence' | 'review' | 'reality'>> & {
  followUp?: Partial<PassPolicy['followUp']>
  checkIn?: Partial<PassPolicy['checkIn']>
  duplicate?: Partial<PassPolicy['duplicate']>
  recurrence?: Partial<PassPolicy['recurrence']>
  review?: Partial<PassPolicy['review']>
  reality?: Partial<PassPolicy['reality']>
}

const FOLLOW_UP_TAIL = (date: string) => `: the day (${date}) has passed, and how it went is not known yet`

// Cut to fit `max` characters as the validator counts them, after normalising,
// on whole characters, never half a pair. The mark is plain dots: an ellipsis
// character would normalise to three and push the line past the cap.
const MARK = '...'

function clipped(text: string, max: number): string {
  const plain = normaliseText(text)
  if (plain.length <= max) return plain
  let out = ''
  for (const char of plain) {
    if (out.length + char.length + MARK.length > max) break
    out += char
  }
  return `${out}${MARK}`
}

// The defaults, for a memory's text cap and the reality unit you set: a follow-up
// quotes its event clipped so the whole line fits the cap, and a correction says
// its value with the unit, so the reality job reads it back.
function defaults(maxTextLength: number, unit: string): Omit<PassPolicy, 'stopwords' | 'addsPerMessage' | 'maxOpsPerRun' | 'protectedKinds'> {
  return {
    maxOpenQuestions: 5,
    cooldownDays: 30,
    followUp: {
      kinds: [], windowDays: 7, horizonDays: 7, kind: '',
      text: (eventText, date) => `${clipped(eventText, maxTextLength - FOLLOW_UP_TAIL(date).length)}${FOLLOW_UP_TAIL(date)}`,
    },
    checkIn: { quietWeeks: 6, activeWeeks: 3, reason: (weeks) => `not mentioned in ${weeks} weeks` },
    // Off until you name the negations: a copy is ended without asking, so "never X"
    // must not read as a copy of "X", and only you know your language's "never".
    duplicate: { share: 0.8, negations: new Set() },
    recurrence: { kinds: [], windowDays: 28, share: 0.6, messages: 3, sessions: 2 },
    review: { lookbackDays: 28, dismissedDays: 90, repeatShare: 0.6 },
    reality: { kind: '', unit, tolerance: 0.15, text: (label, value, day) => `${label}: ${value} ${unit} on the records (${day})` },
  }
}

function checkPasses(policy: PassPolicy, kinds: string[]): void {
  if (policy.followUp.kinds.length > 0 && !kinds.includes(policy.followUp.kind)) {
    throw new TypeError(`followUp.kind must be one of the memory's kinds, got ${JSON.stringify(policy.followUp.kind)}`)
  }
  if (policy.reality.kind === '') return
  if (!kinds.includes(policy.reality.kind)) throw new TypeError(`reality.kind must be one of the memory's kinds, got ${JSON.stringify(policy.reality.kind)}`)
  if (policy.reality.unit.trim() === '') throw new TypeError('reality.unit must name a unit when reality.kind is set')
}

/**
 * The pass policy for a memory: its stopwords, caps and protected kinds derived
 * (from the `consolidation` writer's limits, where the memory sets them), the rest
 * defaults, each part merged with what you set.
 */
function definePasses(memory: Pick<Memory, 'policy'> & Partial<Pick<Memory, 'policyFor'>>, overrides: PassOverrides = {}): PassPolicy {
  // A pass writes as `consolidation`, so it plans within what that writer is held to.
  const held = memory.policyFor?.('consolidation') ?? memory.policy
  const { kinds, stopwords, caps } = held
  const { followUp, checkIn, duplicate, recurrence, review, reality, ...top } = overrides
  const base = defaults(held.maxTextLength, reality?.unit ?? '')
  const policy: PassPolicy = {
    ...base,
    stopwords,
    addsPerMessage: caps.addsPerMessage,
    maxOpsPerRun: caps.opsPerRun,
    protectedKinds: Object.keys(kinds).filter((kind) => kinds[kind].protected === true),
    ...top,
    followUp: { ...base.followUp, ...followUp },
    checkIn: { ...base.checkIn, ...checkIn },
    duplicate: { ...base.duplicate, ...duplicate },
    recurrence: { ...base.recurrence, ...recurrence },
    review: { ...base.review, ...review },
    reality: { ...base.reality, ...reality },
  }
  checkPasses(policy, Object.keys(kinds))
  return policy
}

export { definePasses }
export type { PassOverrides }
