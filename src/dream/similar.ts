import { contentWords, normaliseText, sameStem } from '../text.ts'
import type { DreamPolicy } from './types.ts'

// How much two entry texts say the same thing: the share of the shorter one's
// content words the other holds. Read on the shorter side so a rewording that
// only adds words ("prefers mornings" → "prefers mornings, on weekdays at
// least") still counts as the same proposal. A word matches whole, or by
// prefix when the shorter of the two is long enough to be a stem rather than a
// fragment (core's `sameStem`).

function words(text: string, stopwords: Set<string>): string[] {
  return [...new Set(contentWords(text, stopwords))]
}

function share(of: string[], within: string[]): number {
  if (of.length === 0) return 0
  return of.filter((w) => within.some((other) => sameStem(w, other))).length / of.length
}

/** 0 to 1: the share of the shorter text's content words found in the other. */
function overlap(a: string, b: string, stopwords: Set<string>): number {
  const [short, long] = [words(a, stopwords), words(b, stopwords)].sort((x, y) => x.length - y.length)
  return share(short, long)
}

/**
 * 0 to 1: the share of the entry's content words the message holds. Read on the
 * entry, never the shorter side: a one-word question touches an entry but does not say it.
 */
function holds(entry: string, message: string, stopwords: Set<string>): number {
  return share(words(entry, stopwords), words(message, stopwords))
}

// Words count letters only, so by overlap alone "80 ms" and "100 ms", or "no
// late calls" and "late calls are fine", say the same thing. A copy must also
// name the same numbers and say no, or not, alike.
function numbers(text: string): string {
  return [...new Set(normaliseText(text).match(/\d+(?:[.,]\d+)?/g) ?? [])].map((n) => n.replace(',', '.')).sort().join(' ')
}

function negates(text: string, negations: Set<string>): boolean {
  return (normaliseText(text).toLowerCase().match(/\p{L}+/gu) ?? []).some((w) => negations.has(w))
}

/** Whether two entry texts are one fact in other words: the duplicate share, the same numbers, the same yes or no. */
function saysTheSame(a: string, b: string, policy: Pick<DreamPolicy, 'stopwords' | 'duplicate'>): boolean {
  const { share, negations } = policy.duplicate
  return overlap(a, b, policy.stopwords) >= share && numbers(a) === numbers(b) && negates(a, negations) === negates(b, negations)
}

export { overlap, holds, saysTheSame }
