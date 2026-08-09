// ============================================================================
// ShortVoice -- lexical layer  (Person B)
// ============================================================================
// The three non-negotiable properties in CONTRACT.md §6 are *properties of this
// file*, not of the LLM:
//
//   Order independence  -> canonicalKey() sorts tokens, so "neel later" and
//                          "later neel" produce a byte-identical retrieval key
//                          and therefore a byte-identical embedding vector.
//   Slot filling        -> leftoverTokens() is an exact/fuzzy set difference,
//                          so "neel tomorrow" against trigger "neel later"
//                          yields ["tomorrow"] to fill the {when} slot.
//   Robustness          -> equivalence classes + edit-distance matching let a
//                          Deepgram mis-hear ("neal", "tmrw") still land.
//
// Nothing here calls a model. It is pure, deterministic, and unit-testable --
// which is exactly why the demo can survive a dead network on the strong path.
// ============================================================================

/** Disfluencies + politeness noise. Dropped everywhere, including embeddings. */
const FILLERS = new Set([
  "um", "uh", "erm", "er", "ah", "hmm", "mm", "like", "please", "okay", "ok",
  "hey", "yeah", "yep", "so", "well", "just", "kinda", "sorta", "actually",
  "short", // the "short: ..." prefix-invocation fallback from CONTRACT.md §4
]);

/** Function words. Dropped for *lexical scoring only* -- see contentTokens(). */
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "that", "this", "is", "am",
  "are", "be", "my", "me", "i", "im", "ive", "ill", "it", "at", "in", "on",
  "with", "about", "can", "you", "your", "please", "do", "does", "let", "lets",
]);

/**
 * Words that all mean "a point in time". Collapsed to a single class token for
 * *scoring* so that "neel tomorrow" scores as a full lexical cover of the
 * trigger "neel later" -- the taught phrase is a template, and a different
 * filler must not look like a different phrase.
 *
 * Deliberately NOT used by leftoverTokens(): there we need "tomorrow" to remain
 * distinguishable from "later" so it can be captured as the slot value.
 */
const TIME_WORDS = new Set([
  "now", "soon", "asap", "later", "today", "tonight", "tomorrow", "tmrw",
  "yesterday", "morning", "afternoon", "evening", "night", "noon", "midnight",
  "weekend", "week", "month", "year", "hour", "hours", "minute", "minutes",
  "min", "mins", "am", "pm", "oclock", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed",
  "thu", "thur", "thurs", "fri", "sat", "sun", "next", "tonite", "eod", "eow",
]);

const TIME_CLASS = "«time»";
const NUM_CLASS = "«num»";

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/** Split on non-alphanumerics, lowercase, strip disfluencies. Order preserved. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !FILLERS.has(t));
}

/** Tokens minus function words -- what actually carries meaning for scoring. */
export function contentTokens(s: string): string[] {
  const t = tokens(s).filter((x) => !STOPWORDS.has(x));
  // Never return empty: a trigger like "to the" is degenerate but must still
  // compare against something rather than silently scoring 1.0 against all.
  return t.length > 0 ? t : tokens(s);
}

/**
 * THE order-independence guarantee.
 *
 * Sorted, de-duplicated content tokens joined by spaces. Both the utterance
 * side and the phrase side of retrieval are keyed through this, so word order
 * is erased *before* the embedding model ever sees the text -- the two vectors
 * are identical, not merely close.
 *
 * Function words are dropped as well as disfluencies: "tell the team" and
 * "team" should retrieve the same thing, and an embedding of sorted tokens
 * gains nothing from "the".
 *
 * Related to Person A's normalizeTrigger() (CONTRACT.md §5) but deliberately
 * not the same function: A's stays authoritative for the `by_user_trigger`
 * DB index, this one is authoritative for retrieval.
 */
export function canonicalKey(s: string): string {
  return Array.from(new Set(contentTokens(s))).sort().join(" ");
}

// ---------------------------------------------------------------------------
// Fuzzy token equality (Deepgram insurance)
// ---------------------------------------------------------------------------

/** Bounded Levenshtein: returns early once the distance exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** "neel" ~ "neal", "standup" ~ "stand up" (post-tokenization), but not "mom" ~ "tom". */
export function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false; // short words: exact only
  const tolerance = Math.min(2, Math.floor(Math.max(a.length, b.length) / 4));
  return editDistance(a, b, tolerance) <= tolerance;
}

// ---------------------------------------------------------------------------
// Equivalence classes (scoring only)
// ---------------------------------------------------------------------------

export function classOf(token: string): string {
  if (TIME_WORDS.has(token)) return TIME_CLASS;
  if (/^\d+$/.test(token)) return NUM_CLASS;
  return token;
}

export function isTimeToken(token: string): boolean {
  return TIME_WORDS.has(token) || /^\d{1,2}(:\d{2})?$/.test(token);
}

// ---------------------------------------------------------------------------
// Lexical similarity
// ---------------------------------------------------------------------------

/**
 * How much of the trigger the utterance actually accounts for, in [0,1].
 *
 * Class-mapped, so a slot-variant utterance ("neel tomorrow") fully covers its
 * template trigger ("neel later"). This is the signal that stops a semantically
 * fuzzy embedding from promoting the wrong phrase: a vector can drift, but a
 * missing proper noun cannot be hand-waved.
 */
export function coverage(utterance: string, trigger: string): number {
  const trig = contentTokens(trigger).map(classOf);
  const utt = contentTokens(utterance).map(classOf);
  if (trig.length === 0) return 0;
  const pool = [...utt];
  let hit = 0;
  for (const t of trig) {
    const idx = pool.findIndex((u) => tokenMatches(u, t));
    if (idx >= 0) {
      hit++;
      pool.splice(idx, 1);
    }
  }
  return hit / trig.length;
}

/** Symmetric overlap -- penalizes a 1-word trigger swallowing a 6-word utterance. */
export function jaccard(utterance: string, trigger: string): number {
  const a = new Set(contentTokens(utterance).map(classOf));
  const b = new Set(contentTokens(trigger).map(classOf));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of b) if (a.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Blended lexical score used by the hybrid ranker. */
export function lexicalScore(utterance: string, trigger: string): number {
  return 0.75 * coverage(utterance, trigger) + 0.25 * jaccard(utterance, trigger);
}

// ---------------------------------------------------------------------------
// Leftovers -> slot values
// ---------------------------------------------------------------------------

/**
 * Utterance tokens the trigger does not account for -- the raw material for
 * slot filling. Exact/fuzzy matching only (NO class collapsing), so the whole
 * point survives: "neel tomorrow" against "neel later" leaves ["tomorrow"].
 *
 * Order is preserved from the utterance, so a multi-word filler renders as
 * "next friday" rather than the alphabetized "friday next". This does not
 * weaken order independence: which phrase we match is decided by canonical keys
 * and set-based coverage, and the leftover *set* for "neel tomorrow" and
 * "tomorrow neel" is identical either way.
 */
export function leftoverTokens(utterance: string, trigger: string): string[] {
  const trig = [...tokens(trigger)];
  const left: string[] = [];
  for (const u of tokens(utterance)) {
    const idx = trig.findIndex((t) => tokenMatches(t, u));
    if (idx >= 0) trig.splice(idx, 1);
    else left.push(u);
  }
  return left.filter((t) => !STOPWORDS.has(t));
}

/**
 * The prefix-invocation fallback from CONTRACT.md §4: if VoiceOS will not route
 * short utterances to `shortvoice_say` reliably, Person C demos with
 * "short: school mom". Strip it before anything else looks at the words.
 */
export function stripInvocation(utterance: string): string {
  return utterance
    .replace(/^\s*(hey\s+)?(short\s*voice|shortvoice|short)\s*[:,-]\s*/i, "")
    .trim();
}

/** The time-ish words inside a trigger itself -- the template's own default filler. */
export function timeTokensOf(s: string): string[] {
  return tokens(s).filter(isTimeToken);
}

// ---------------------------------------------------------------------------
// Retrieval keys -- the ONE place that decides what text gets embedded
// ---------------------------------------------------------------------------

/**
 * What we embed for a *query* (an utterance).
 *
 * Canonical, so word order is erased before the model sees it. This is the
 * mechanism behind "neel later" ≡ "later neel": not similar vectors, the
 * identical vector.
 */
export function retrievalKey(utterance: string): string {
  return canonicalKey(utterance);
}

/**
 * What we embed for a *document* (a taught phrase).
 *
 * The canonical trigger anchors the exact-fragment case; the natural trigger
 * and the intent template give the vector enough semantics to catch phrasings
 * nobody taught ("tell the team about the pull request" -> the "team pr"
 * phrase). Braces are stripped so "{when}" does not pollute the embedding.
 *
 * Every writer of `phrases.embedding` -- teach, accept-suggestion, reseed --
 * MUST go through this function or retrieval silently degrades.
 */
export function phraseDocText(trigger: string, intentTemplate: string): string {
  return `${canonicalKey(trigger)} | ${trigger} — ${intentTemplate.replace(/[{}]/g, "")}`;
}

/** "later neel" -> "Later neel". Cheap sentence casing for speech/logging. */
export function sentenceCase(s: string): string {
  const t = s.trim();
  return t.length === 0 ? t : t[0].toUpperCase() + t.slice(1);
}

/** Word-count truncation that never cuts mid-clause awkwardly. */
export function clampWords(s: string, max: number): string {
  const w = s.trim().split(/\s+/);
  if (w.length <= max) return s.trim();
  return w.slice(0, max).join(" ").replace(/[,;:]$/, "");
}
