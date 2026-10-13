import { findEntry } from '../log/fold.ts'
import { contentWords, normaliseText, overRawCap } from '../text.ts'
import type { EntryOperation, EntryState } from '../log/types.ts'

// What an operation written before a forget may not bring back. A background
// pass plans from the state it loaded (`base`), then pays for a slow step; if
// the subject forgot an entry meanwhile, an operation written from the words
// before the forget would store them again.
//
// The forgotten wording, quoted whole, anywhere in the new text or in a free-text
// reason: a follow-up quotes its event inside a sentence of its own, and a
// reason stored beside an entry is stored all the same. Two limits, because a wrong
// refusal can keep a new restriction out of memory, a safety loss, where
// relearning a word is no privacy loss:
// - whole words only: a forgotten "sesame oil" never matches inside "sesame oils";
// - a wording with fewer than two content words guards nothing: a forgotten
//   "Tea" is not a fact anyone can recognise again.
//
// Words are not the only way back: an add named as the same fact as a forgotten
// entry is refused by its name, whatever its words, by the validator itself.

const FORGOTTEN_MEANWHILE = 'its words were forgotten while the pass ran'
const MIN_CONTENT_WORDS = 2

const folded = (text: string): string => normaliseText(text).toLowerCase().replace(/\s+/g, ' ').trim()
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The patterns that find each wording `base` held and `now` has forgotten, where it is specific enough to guard. */
function forgottenSince(base: EntryState, now: EntryState, stopwords: Set<string>): RegExp[] {
  return base.entries
    .filter((e) => !e.redacted && e.text && findEntry(now, e.id)?.redacted)
    .map((e) => e.text)
    .filter((text) => contentWords(text, stopwords).length >= MIN_CONTENT_WORDS)
    .map((text) => new RegExp(`(?<![\\p{L}\\p{N}])${escaped(folded(text))}(?![\\p{L}\\p{N}])`, 'u'))
}

// The words an operation writes, read loosely: the text of an add or supersede,
// and any free-text reason, its own or that of the proposal holding it. The
// validator has not checked the shape yet, and this must not throw on it.
function writtenWords(op: unknown): string[] {
  const outer = op as { type?: unknown; reason?: unknown; op?: unknown } | null
  const inner = (outer?.type === 'EntryProposed' ? outer.op : outer) as { reason?: unknown; entry?: { text?: unknown } } | null
  const entry = typeof inner?.entry === 'object' && inner.entry !== null ? inner.entry : undefined
  return [entry?.text, inner?.reason, outer?.type === 'EntryProposed' ? outer.reason : undefined]
    .filter((words): words is string => typeof words === 'string')
}

/**
 * Why this operation would bring back words forgotten since its base, in its
 * text or a reason, or null. Words far over the cap are left unread: the
 * validator refuses them on their length.
 */
function forgottenProblem(op: EntryOperation, guarded: RegExp[], maxLength: number): string | null {
  const readable = writtenWords(op).filter((words) => !overRawCap(words, maxLength))
  const quotes = readable.some((words) => guarded.some((pattern) => pattern.test(folded(words))))
  return quotes ? FORGOTTEN_MEANWHILE : null
}

export { forgottenSince, forgottenProblem }
