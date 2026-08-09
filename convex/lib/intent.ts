// ============================================================================
// TEMP STUB -- support code for the stubbed teach/learning flow. Person B
// replaces this with an LLM that parses `meaning` into a structured intent.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================

import { isTimeWord } from "./matching";
import { tokenize } from "./normalize";

export type ActionType =
  | "send_message"
  | "send_slack"
  | "create_event"
  | "read_screen"
  | "focus_mode"
  | "open_app"
  | "web_search"
  | "speak"
  | "custom";

const ACTION_HINTS: Array<[ActionType, RegExp]> = [
  ["send_slack", /\bslack|channel|#\w+/i],
  ["create_event", /\bcalendar|schedule|meeting|invite|book (a|an|the)?\s*(slot|time|room)/i],
  ["read_screen", /\b(read|describe|what'?s on)\b.*\bscreen\b/i],
  ["focus_mode", /\bfocus|do not disturb|dnd|deep work|heads down\b/i],
  ["open_app", /\b(open|launch|start up|bring up)\b\s+\w/i],
  ["web_search", /\b(search|look ?up|find|google|flights?|prices?|weather)\b/i],
  ["send_message", /\b(text|message|imessage|sms|tell|let .* know|ping)\b/i],
];

export function inferActionType(meaning: string): ActionType {
  for (const [type, pattern] of ACTION_HINTS) {
    if (pattern.test(meaning)) return type;
  }
  return "custom";
}

/**
 * Rewrite a first-person instruction into the second person, so the spoken
 * confirmation reads back correctly:
 *   "text Mom I'm leaving school"  ->  "text Mom you're leaving school"
 */
export function toSecondPerson(meaning: string): string {
  return meaning
    .replace(/\bI'?m\b/gi, "you're")
    .replace(/\bI'?ll\b/gi, "you'll")
    .replace(/\bI'?ve\b/gi, "you've")
    .replace(/\bI'?d\b/gi, "you'd")
    .replace(/\bI am\b/gi, "you are")
    .replace(/\bI\b/g, "you")
    .replace(/\bmy\b/gi, "your")
    .replace(/\bmine\b/gi, "yours")
    .replace(/\bmyself\b/gi, "yourself")
    .replace(/\bme\b/gi, "you");
}

/** The projector shows this at 60px. It should not start with a lowercase letter. */
function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export type ParsedMeaning = {
  intentTemplate: string;
  slots: string[];
  slotDefaults: Record<string, string>;
};

/**
 * Turn a plain-English meaning into a *template*, not a string. Any explicit
 * {curly} placeholders are kept; otherwise the first time word becomes a
 * {when} slot so "neel later" and "neel tomorrow" can share one phrase.
 */
export function parseMeaning(meaning: string): ParsedMeaning {
  const rewritten = capitalize(toSecondPerson(meaning.trim()));

  const explicit = [...rewritten.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (explicit.length > 0) {
    return { intentTemplate: rewritten, slots: [...new Set(explicit)], slotDefaults: {} };
  }

  const words = rewritten.split(/(\s+)/);
  const timeIndex = words.findIndex(
    (w) => w.trim().length > 0 && isTimeWord(tokenize(w)[0] ?? ""),
  );
  if (timeIndex === -1) {
    return { intentTemplate: rewritten, slots: [], slotDefaults: {} };
  }

  const original = words[timeIndex];
  words[timeIndex] = original.replace(/[\w']+/, "{when}");
  return {
    intentTemplate: words.join(""),
    slots: ["when"],
    slotDefaults: { when: (tokenize(original)[0] ?? "").trim() },
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "for", "of", "in", "on", "at",
  "with", "that", "this", "it", "is", "are", "was", "be", "im", "ill", "ive",
  "you", "your", "my", "me", "i", "we", "they", "them", "he", "she", "his",
  "her", "tell", "text", "send", "message", "say", "let", "know", "about",
  "will", "would", "can", "just", "gonna", "going", "get", "got", "have",
]);

/**
 * Pick a word worth turning into a phrase: the most distinctive content word
 * shared by several utterances. "tell the team I'll be at standup" -> "standup".
 */
export function proposeTrigger(utterances: string[]): string {
  const counts = new Map<string, number>();
  for (const u of utterances) {
    for (const token of new Set(tokenize(u))) {
      if (STOPWORDS.has(token) || isTimeWord(token) || token.length < 4) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return tokenize(utterances[0] ?? "").slice(0, 2).join(" ") || "shortcut";
  }
  // Shared by the most utterances; ties broken toward the longer word.
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length,
  )[0][0];
}
