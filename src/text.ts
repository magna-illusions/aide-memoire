// The text rules every entry meets, and the escape every rendered entry gets.
//
// An entry is written from text nobody here controls — what a subject typed, what
// a model inferred, what a page said — and it is read back into a prompt. Two
// layers keep it inert, on purpose both: the write refuses anything shaped like
// structure (textProblem), and the render escapes whatever is already stored
// (escapeEntryText), because a log outlives its rules and an old entry, a
// migrated one or a hand-repaired one never passed today's.

// Every rule reads the text as a reader would see it, not as it was encoded. A
// disguise is undone first: compatibility forms fold to their plain letters (NFKC
// turns fullwidth `\uFF1C` and `ｉｇｎｏｒｅ` into `<` and `ignore`), invisible format
// characters go (zero-width spaces, soft hyphens, bidi overrides — anything in
// Unicode's Cf category), every Unicode line break becomes a newline, and the
// angle-quote lookalikes NFKC leaves alone become angle brackets. Guillemets
// stay: «» are ordinary quotation marks in several languages.
const LOOKALIKE = /[\u2039\u203A\u3008\u3009\u27E8\u27E9\u02C2\u02C3]/g
const OPENS = new Set(['\u2039', '\u3008', '\u27E8', '\u02C2'])

// The square-bracket lookalikes NFKC leaves alone (it already folds fullwidth
// and the vertical forms into these or into `[`/`]`): lenticular, tortoise-shell,
// white and tick brackets, quills, and the corner and ceiling pieces. They become
// `[` and `]`, so no rule and no reader takes one for anything else. Corner
// quotes 「」 stay: they are quotation marks, as guillemets are.
const SQUARE_OPENS = '\u3010\u3014\u3016\u3018\u301A\u27E6\u27EC\u2045\u298B\u298D\u298F\u2997\u2772\u23A1\u23A3\u2308\u230A'
const SQUARE_CLOSES = '\u3011\u3015\u3017\u3019\u301B\u27E7\u27ED\u2046\u298C\u298E\u2990\u2998\u2773\u23A4\u23A6\u2309\u230B'
const SQUARE_LOOKALIKE = new RegExp(`[${SQUARE_OPENS}${SQUARE_CLOSES}]`, 'g')

// Two invisible characters carry meaning inside an emoji and nowhere else: the
// zero-width joiner that builds a sequence from pictographs, and the variation
// selector that asks for emoji presentation. They stay where they do that job \u2014
// a joiner between pictographs (a selector may sit before it), a selector after
// one \u2014 and go everywhere else, where they only split a word to hide it.
const ZWJ = '\u200D'
const VS16 = '\uFE0F'
const PICTOGRAPH = /\p{Extended_Pictographic}/u

function isPictograph(char: string | undefined): boolean {
  return char !== undefined && PICTOGRAPH.test(char)
}

function joinsEmoji(chars: string[], i: number): boolean {
  if (chars[i] === VS16) return isPictograph(chars[i - 1])
  const before = chars[i - 1] === VS16 ? chars[i - 2] : chars[i - 1]
  return isPictograph(before) && isPictograph(chars[i + 1])
}

// Everything that renders as nothing: format characters (zero-width spaces, bidi
// controls), and Unicode's default-ignorable set \u2014 variation selectors, the
// combining grapheme joiner, Hangul fillers, Mongolian and Khmer invisibles, tag
// characters. The braille blank is not in that set but draws nothing either.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u

function stripInvisible(text: string): string {
  const chars = [...text]
  return chars.filter((char, i) => {
    if (char === ZWJ || char === VS16) return joinsEmoji(chars, i)
    return !INVISIBLE.test(char)
  }).join('')
}

/** The text as every rule reads it and as it is stored: NFKC, invisibles gone, line breaks as `\n`, angle lookalikes folded. */
function normaliseText(text: string): string {
  return stripInvisible(text.normalize('NFKC').replace(/[\u2028\u2029\u0085\v\f]/g, '\n'))
    .replace(LOOKALIKE, (c) => (OPENS.has(c) ? '<' : '>'))
    .replace(SQUARE_LOOKALIKE, (c) => (SQUARE_OPENS.includes(c) ? '[' : ']'))
}

// Letters from other scripts that read as a Latin letter, for pattern checks
// only: a subset of Unicode's confusables.txt (UTS #39) \u2014 the lowercase Cyrillic
// and Greek letters and the Latin small capitals that resolve to one Latin
// letter. Upper case needs no entry, since the skeleton lowercases first. Never
// applied to stored text, where a Cyrillic or Greek word must stay itself.
const CONFUSABLE: Record<string, string> = {
  // Cyrillic
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u0451': 'e', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h',
  '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i',
  '\u0457': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u04bb': 'h', '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  // Greek
  '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b5': 'e', '\u03b6': 'z', '\u03b7': 'n', '\u03b9': 'i',
  '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o', '\u03c1': 'p', '\u03c4': 't', '\u03c5': 'u', '\u03c7': 'x',
  '\u03f2': 'c', '\u03f3': 'j',
  // Latin small capitals
  '\u1d00': 'a', '\u0299': 'b', '\u1d04': 'c', '\u1d05': 'd', '\u1d07': 'e', '\ua730': 'f', '\u0262': 'g',
  '\u029c': 'h', '\u026a': 'i', '\u1d0a': 'j', '\u1d0b': 'k', '\u029f': 'l', '\u1d0d': 'm', '\u0274': 'n',
  '\u1d0f': 'o', '\u1d18': 'p', '\u0280': 'r', '\ua731': 's', '\u1d1b': 't', '\u1d1c': 'u', '\u1d20': 'v',
  '\u1d21': 'w', '\u028f': 'y', '\u1d22': 'z',
}

function toLatin(text: string): string {
  return [...text].map((char) => CONFUSABLE[char] ?? char).join('')
}

// "i g n o r e" is one word spelled out: a run of three or more single letters
// joins up. Two stay apart, so a language's one-letter words ("i g\u00e5r") survive.
const SPELLED_RUN = 3

function joinSpelledOut(words: string[]): string[] {
  const out: string[] = []
  let run: string[] = []
  const flush = () => {
    out.push(...(run.length >= SPELLED_RUN ? [run.join('')] : run))
    run = []
  }
  for (const word of words) {
    if (/^\p{L}$/u.test(word)) {
      run.push(word)
      continue
    }
    flush()
    out.push(word)
  }
  flush()
  return out
}

/**
 * The text reduced to its words, for pattern checks only \u2014 never stored. Lower
 * case, nothing but letters, digits and single spaces, so an emoji or a hyphen
 * placed inside a word ("sys\ud83d\ude00\u200d\ud83d\ude00tem", "ignore\ud83c\udfc3") cannot keep a phrase from
 * matching. Letters of every script survive.
 */
function skeleton(text: string): string {
  const words = toLatin(normaliseText(text).toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
  return joinSpelledOut(words).join(' ')
}

// Structure that has no place in a sentence about someone: a tag or comment, a
// heading, a list or quote marker at the start, a separator run, a code fence,
// and anything shaped like a rendered line's provenance tag, `[kind · date ·
// label]`: a `[` straight after a `]` (spaces and backslashes between do not
// count), or a bracket group holding the tag separator `·` or a dot that reads
// as one. Other brackets pass; the rendering escapes every one regardless.
// `<` before a digit or a space is a comparison ("a value < 150") and passes, and so
// do a leading minus or hash that belong to their word ("-5 units", "#1 aim").
const MARKUP = [
  /<[A-Za-z/!?]/,
  // A closing tag with space before its slash still reads as one to a model.
  /<\s+\//,
  /^\s*(?:#|[-*>]\s)/,
  /---|===/,
  /```/,
  /\][\s\\]*\[/,
  /\[[^\]]*[\u00B7\u2022\u2219\u22C5\u30FB\u2027\u16EB\u2E31\uA78F]/,
]

// Control characters other than tab: a terminal escape, a NUL, a bell. Nothing
// a person writes in a sentence, and a reader of the log may act on them.
const CONTROL = /[^\P{Cc}\t\r\n]/u
const CONTROLS = new RegExp(CONTROL, 'gu')

// Normalising reads every character, so text far past the cap is refused on its
// raw length first: a few times the cap leaves room for a disguise to be undone,
// never for megabytes.
const RAW_FACTOR = 4

/** Whether `raw` is too long to be worth normalising: refused as over the cap without reading it. */
function overRawCap(raw: string, maxLength: number): boolean {
  return raw.length > maxLength * RAW_FACTOR
}

/** Why `text` cannot be an entry, or null. One line, no markup, at most `maxLength`, read normalised. */
function textProblem(raw: string, maxLength: number): string | null {
  if (overRawCap(raw, maxLength)) {
    return `over the ${maxLength}-character cap`
  }
  const text = normaliseText(raw)
  if (!text.trim()) {
    return 'empty'
  }
  if (/[\r\n]/.test(text)) {
    return 'more than one line'
  }
  if (CONTROL.test(text)) {
    return 'control character'
  }
  // Half a surrogate pair is no character at all, and a Postgres jsonb column cannot store it.
  if (/\p{Cs}/u.test(text)) {
    return 'half a surrogate pair'
  }
  if (text.length > maxLength) {
    return `over the ${maxLength}-character cap`
  }
  return MARKUP.some((pattern) => pattern.test(text)) ? 'markup' : null
}

// The words that carry meaning: letter runs of three or more, lowercased, minus
// the host's stopwords (the host knows its languages; this does not).
function contentWords(text: string, stopwords: Set<string>): string[] {
  return (normaliseText(text).toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((word) => !stopwords.has(word))
}

// One word is the other or begins it, so an inflected form still counts — "onion"
// and "onions", "trip" and "trips" — without a stemmer per language. The
// shorter side has at least three letters, which contentWords already ensures.
function sameWord(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a)
}

/** Does `message` share a content word with `entry`: the least a citation must show. */
function sharesContentWords(entry: string, message: string, stopwords: Set<string>): boolean {
  const said = contentWords(message, stopwords)
  return contentWords(entry, stopwords).some((word) => said.some((other) => sameWord(word, other)))
}

// Whether a message holds the entry, not merely touches it: one shared word is
// enough to cite a message, but an entry only reads as the subject's own words
// when most of its words are theirs. Stricter matching than a citation's: a
// word matches whole, and by prefix only when the shorter side is long enough
// to be a stem rather than a fragment.
const QUOTED_SHARE = 0.6
const STEM_LENGTH = 5

function sameStem(a: string, b: string): boolean {
  if (a === b) return true
  return Math.min(a.length, b.length) >= STEM_LENGTH && sameWord(a, b)
}

/**
 * Do the two texts share a content word, matched whole or by a stem of five
 * letters or more? What two entries must share to be about the same thing: a
 * citation's three-letter prefix would let "dri" stand for "drinks".
 */
function sharesStems(a: string, b: string, stopwords: Set<string>): boolean {
  const other = contentWords(b, stopwords)
  return contentWords(a, stopwords).some((word) => other.some((that) => sameStem(word, that)))
}

/** Do at least 60% of the entry's content words appear in the message? */
function relays(entry: string, message: string, stopwords: Set<string>): boolean {
  const words = contentWords(entry, stopwords)
  if (words.length === 0) return false
  const said = contentWords(message, stopwords)
  const found = words.filter((word) => said.some((other) => sameStem(word, other)))
  return found.length / words.length >= QUOTED_SHARE
}

// Each line loses what would make it a heading or a separator once it stood at
// the start of a line, then the lines join into one. After that no closing tag
// and no comment opener survive, so the block ends only where the renderer ends it.
function escapeLine(line: string): string {
  return line.replace(/^#/, '\\#').replace(/^(-+|=+)$/, '\\$1')
}

/**
 * One line that cannot close its block, open a section, draw a separator or
 * close its provenance tag: backslashes and square brackets are escaped, the
 * backslashes first, so stored text can never forge a `[kind · date ·
 * confirmed]` of its own, nor unescape a bracket with a backslash of its own.
 */
function escapeEntryText(text: string): string {
  return normaliseText(text).replace(CONTROLS, '').replace(/\\/g, '\\\\').split(/\r?\n|\r/)
    .map((line) => escapeLine(line.trim()))
    .filter(Boolean)
    .join(' ')
    .replace(/<(\s*)\//g, '<$1\\/')
    .replace(/<!/g, '<\\!')
    .replace(/[[\]]/g, '\\$&')
}

export { normaliseText, skeleton, textProblem, overRawCap, contentWords, sameStem, sharesContentWords, sharesStems, relays, escapeEntryText }
