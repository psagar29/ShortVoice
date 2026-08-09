// ============================================================================
// TEMP STUB -- support code for the stubbed resolver. Person B replaces this
// wholesale with embed -> ctx.vectorSearch -> LLM slot-fill.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// No OPENAI_API_KEY is available on this branch, so we cannot embed. What we
// CAN preserve are the two properties CONTRACT.md section 6 calls
// non-negotiable:
//
//   * order-independent  -- "neel later" == "later neel"  (tokens are sorted)
//   * slot-filling       -- "neel tomorrow" hits the same phrase as
//                           "neel later" with {when} filled differently
//
// What is NOT preserved is semantic matching. "message my mother" will not
// find a phrase triggered by "mom". That is exactly the gap Person B fills.

import { tokenize } from "./normalize";

/**
 * Words that describe *when*, not *what*. They are the tokens most likely to
 * vary between two utterances of the same phrase, so they carry little weight
 * when scoring and are the prime candidates for filling a time-ish slot.
 */
const TIME_WORDS = new Set([
  "now", "today", "tonight", "tomorrow", "yesterday", "later", "soon", "asap",
  "morning", "afternoon", "evening", "night", "noon", "midnight",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thurs", "fri", "sat", "sun",
  "weekend", "week", "month", "next", "this", "am", "pm", "oclock",
]);

export function isTimeWord(token: string): boolean {
  return TIME_WORDS.has(token) || /^\d{1,2}(:\d{2})?(am|pm)?$/.test(token);
}

const TIME_SLOT_NAMES = new Set(["when", "time", "date", "day", "deadline"]);

export type Scored = {
  score: number;
  /** Utterance tokens the trigger did not account for. */
  leftover: string[];
};

/**
 * Score how well `utterance` matches `trigger`.
 *
 * Content words dominate; time words are near-free to differ. This is what
 * lets a phrase taught as "team pr tonight" still fire on "team pr tomorrow"
 * with a strong score and `tomorrow` handed to the {when} slot.
 */
export function scoreTrigger(trigger: string, utterance: string): Scored {
  const triggerTokens = tokenize(trigger);
  const utteranceTokens = tokenize(utterance);
  if (triggerTokens.length === 0 || utteranceTokens.length === 0) {
    return { score: 0, leftover: utteranceTokens };
  }

  const utteranceSet = new Set(utteranceTokens);
  const core = triggerTokens.filter((t) => !isTimeWord(t));

  const matchedAll = triggerTokens.filter((t) => utteranceSet.has(t)).length;
  const matchedCore = core.filter((t) => utteranceSet.has(t)).length;

  // Weight content words heavily; let time words nudge the score at the margin.
  const coreScore = core.length > 0 ? matchedCore / core.length : matchedAll / triggerTokens.length;
  const allScore = matchedAll / triggerTokens.length;
  let score = coreScore * 0.85 + allScore * 0.15;

  const triggerSet = new Set(triggerTokens);
  const leftover = utteranceTokens.filter((t) => !triggerSet.has(t));

  // Words the trigger cannot explain are evidence this is a different phrase --
  // unless they are time words, which slots exist to absorb.
  const unexplained = leftover.filter((t) => !isTimeWord(t)).length;
  score -= Math.min(0.3, unexplained * 0.12);

  return { score: Math.max(0, score), leftover };
}

/**
 * Assign leftover utterance tokens to a phrase's slots. Time-ish slot names
 * get the time-ish leftovers; anything else gets whatever remains.
 */
export function fillSlots(
  slots: string[],
  leftover: string[],
): Record<string, string> {
  const filled: Record<string, string> = {};
  if (slots.length === 0 || leftover.length === 0) return filled;

  const timeish = leftover.filter(isTimeWord);
  const rest = leftover.filter((t) => !isTimeWord(t));

  for (const slot of slots) {
    if (TIME_SLOT_NAMES.has(slot.toLowerCase()) && timeish.length > 0) {
      filled[slot] = timeish.splice(0, timeish.length).join(" ");
    } else if (rest.length > 0) {
      filled[slot] = rest.splice(0, rest.length).join(" ");
    } else if (timeish.length > 0) {
      filled[slot] = timeish.splice(0, timeish.length).join(" ");
    }
  }
  return filled;
}

/**
 * Render "{when}" placeholders. Slots left unfilled fall back to `defaults`,
 * then to the empty string -- never to a literal "{when}" on the projector.
 */
export function renderTemplate(
  template: string,
  filled: Record<string, string>,
  defaults: Record<string, string> = {},
): string {
  return template
    .replace(/\{(\w+)\}/g, (_m, name: string) => filled[name] ?? defaults[name] ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}
