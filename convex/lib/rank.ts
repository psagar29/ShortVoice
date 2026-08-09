// ============================================================================
// ShortVoice -- hybrid ranking  (Person B)
// ============================================================================
// Convex gives us a cosine score. Cosine alone is not enough to bet a live demo
// on: embeddings of 2-4 word fragments are noisy, and the failure mode -- a
// semantically-adjacent phrase texting the wrong person -- is the worst thing
// that can happen on stage.
//
// So retrieval is DENSE + LEXICAL + a usage prior, fused into one calibrated
// confidence, and the bands from CONTRACT.md §6 are applied to the fused score:
//
//   dense    the embedding cosine. Understands that "pr" ~ "pull request".
//   lexical  class-aware token coverage. Understands that a missing proper
//            noun is disqualifying no matter how nice the cosine looks.
//   prior    a small nudge toward phrases this person actually uses.
//
// Plus a margin rule: when the top two candidates are within EPS of each other
// we route to the clarify path even if the leader cleared the strong bar. Two
// plausible readings is exactly when a person wants to be asked.
// ============================================================================

import { contentTokens, coverage, isTimeToken, leftoverTokens, lexicalScore } from "./text";
import { inferSlotKind, slotNamesFor } from "./slots";

export const BANDS = {
  /** >= this on the fused score: act, no model in the loop. */
  STRONG: 0.82,
  /** >= this: one LLM call adjudicates the shortlist. */
  WEAK: 0.65,
  /** Below WEAK: no taught phrase matched; expand from personal context. */
} as const;

/** Top-2 gap below this is treated as genuine ambiguity. */
export const AMBIGUITY_EPS = 0.07;

/** Cosine range we actually observe with text-embedding-3-small on fragments. */
const COS_FLOOR = 0.3;
const COS_CEIL = 0.9;

const W_DENSE = 0.45;
const W_LEXICAL = 0.28;
const W_EXPLAINED = 0.22;
const W_PRIOR = 0.05;

/** Half-life for the recency component of the usage prior. */
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export type Scored<T> = {
  doc: T;
  /** Raw cosine from ctx.vectorSearch, untouched -- logged for calibration. */
  dense: number;
  /** Class-aware token coverage of the trigger by the utterance. */
  lexical: number;
  /** Fraction of the utterance this phrase accounts for, slots included. */
  explained: number;
  /** Usage/recency prior in [0,1]. */
  prior: number;
  /** The number the bands are applied to. */
  score: number;
};

export type RankableDoc = {
  trigger: string;
  intentTemplate: string;
  slots: string[];
  useCount: number;
  lastUsedAt?: number;
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Stretch the useful part of the cosine range across [0,1]. */
export function scaleDense(cosine: number): number {
  return clamp01((cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR));
}

/**
 * A phrase used often and recently is a better guess than one seeded and never
 * touched -- but only as a tiebreaker. W_PRIOR is 5% on purpose: a popular
 * phrase must never outrank a lexically exact one.
 */
export function usagePrior(
  useCount: number,
  lastUsedAt: number | undefined,
  now: number,
): number {
  const frequency = Math.min(1, Math.log1p(Math.max(0, useCount)) / Math.log1p(10));
  if (!lastUsedAt) return 0.5 * frequency;
  const age = Math.max(0, now - lastUsedAt);
  const recency = Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
  return clamp01(0.5 * frequency + 0.5 * recency);
}

/**
 * How much of what the person said this phrase actually accounts for.
 *
 * A phrase explains a token if the token is in its trigger, or if one of its
 * slots can absorb it -- a time word into a {when}, anything into a free-form
 * slot. "team pr tonight" is fully explained by the trigger "team pr" *because*
 * that phrase has a {when}; the same utterance against a slotless phrase is not.
 *
 * This is the signal that separates "the taught phrase IS this utterance" from
 * "the taught phrase is vaguely about the same topic", and cosine cannot see it.
 */
export function explanation(utterance: string, doc: RankableDoc): number {
  const spoken = contentTokens(utterance);
  if (spoken.length === 0) return 0;

  const leftover = leftoverTokens(utterance, doc.trigger);
  const fromTrigger = Math.max(0, spoken.length - leftover.length);

  const kinds = slotNamesFor(doc).map(inferSlotKind);
  const hasTimeSlot = kinds.includes("time");
  const hasFreeSlot = kinds.some((k) => k !== "time");

  let absorbed = 0;
  for (const token of leftover) {
    if (hasTimeSlot && isTimeToken(token)) absorbed++;
    else if (hasFreeSlot) absorbed++;
  }

  return clamp01((fromTrigger + absorbed) / spoken.length);
}

/**
 * Fuse the signals for one candidate.
 *
 * Linear fusion is the general case, but when a phrase both covers its trigger
 * completely AND explains every word spoken, no amount of cosine pessimism
 * should be able to talk us out of it -- that is a certainty the embedding
 * simply cannot express, so it enters as a floor rather than another addend.
 * The margin rule in band() is what keeps this honest: two phrases that both
 * fully explain the utterance still get asked about instead of guessed.
 */
export function scoreCandidate<T extends RankableDoc>(
  utterance: string,
  doc: T,
  dense: number,
  now = Date.now(),
): Scored<T> {
  const lexical = lexicalScore(utterance, doc.trigger);
  const explained = explanation(utterance, doc);
  const prior = usagePrior(doc.useCount, doc.lastUsedAt, now);

  const fused =
    W_DENSE * scaleDense(dense) +
    W_LEXICAL * lexical +
    W_EXPLAINED * explained +
    W_PRIOR * prior;

  // A longer trigger being fully covered is stronger evidence than a one-word
  // trigger being fully covered, so short triggers earn slightly less certainty.
  const specificity = Math.min(1, contentTokens(doc.trigger).length / 2);
  const certainty =
    coverage(utterance, doc.trigger) * explained * (0.8 + 0.12 * specificity);

  return { doc, dense, lexical, explained, prior, score: clamp01(Math.max(fused, certainty)) };
}

export type Band = "strong" | "weak" | "cold";

/**
 * Which path the resolver takes.
 *
 * The margin rule downgrades strong -> weak when the runner-up is breathing
 * down its neck, so "mom" with two Moms in the contact list asks instead of
 * guessing.
 */
export function band(ranked: Scored<unknown>[]): Band {
  const top = ranked[0];
  if (!top) return "cold";
  const runnerUp = ranked[1];
  const contested =
    runnerUp !== undefined &&
    top.score - runnerUp.score < AMBIGUITY_EPS &&
    runnerUp.score >= BANDS.WEAK;

  if (top.score >= BANDS.STRONG) return contested ? "weak" : "strong";
  if (top.score >= BANDS.WEAK) return "weak";
  return "cold";
}

/** Sort by fused score, descending, stable on ties by dense score. */
export function rank<T>(scored: Scored<T>[]): Scored<T>[] {
  return [...scored].sort((a, b) => b.score - a.score || b.dense - a.dense);
}
