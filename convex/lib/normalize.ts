// ============================================================================
// TEMP STUB -- Person A owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
// The implementation below is copied verbatim from CONTRACT.md and is the one
// piece of the stub surface that is NOT a placeholder -- it is the real thing.

/**
 * Lowercase, strip punctuation, split, sort tokens. Sorting is what makes
 * "neel later" and "later neel" the same phrase.
 */
export function normalizeTrigger(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Tokens of an utterance, lowercased and de-punctuated, in spoken order. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}
