// ============================================================================
// ShortVoice -- confirmation speech  (Person B)
// ============================================================================
// This string is what the room hears. It is the product.
//
// CONTRACT.md §"confirmationSpeech": second person, present progressive, always
// carries the payload, always ends with the ask, under ~15 words.
//
//   intentTemplate:  "Text Mom that I'm leaving school and heading home"
//   spoken:          "Texting Mom that you're leaving school and heading home.
//                     Say yes to send."
//
// Done deterministically rather than with a model, because the strong path must
// not pay for an LLM round trip -- and because a sentence transform cannot
// hallucinate a different recipient than the one we are about to text.
// ============================================================================

import { clampWords } from "./text";
import { tidy } from "./render";

/** Irregular/awkward gerunds worth spelling out. */
const GERUNDS: Record<string, string> = {
  text: "Texting", tell: "Telling", send: "Sending", message: "Messaging",
  email: "Emailing", call: "Calling", ping: "Pinging", ask: "Asking",
  reply: "Replying", remind: "Reminding", find: "Finding", search: "Searching",
  look: "Looking", check: "Checking", open: "Opening", launch: "Launching",
  create: "Creating", add: "Adding", schedule: "Scheduling", book: "Booking",
  set: "Setting", start: "Starting", turn: "Turning", play: "Playing",
  read: "Reading", show: "Showing", post: "Posting", share: "Sharing",
  let: "Letting", give: "Giving", get: "Getting", put: "Putting",
  make: "Making", move: "Moving", close: "Closing", mute: "Muting",
  silence: "Silencing", block: "Blocking", draft: "Drafting", write: "Writing",
};

/** First-person -> second-person. Order matters: contractions before bare "i". */
const PERSON_SWAPS: [RegExp, string][] = [
  [/\bi'?m\b/gi, "you're"],
  [/\bi am\b/gi, "you are"],
  [/\bi'?ll\b/gi, "you'll"],
  [/\bi will\b/gi, "you will"],
  [/\bi'?ve\b/gi, "you've"],
  [/\bi have\b/gi, "you have"],
  [/\bi'?d\b/gi, "you'd"],
  [/\bmyself\b/gi, "yourself"],
  [/\bmine\b/gi, "yours"],
  [/\bmy\b/gi, "your"],
  [/\bme\b/gi, "you"],
  [/\bwe're\b/gi, "you're"],
  [/\bi\b/gi, "you"],
];

/** "leave" -> "leaving", "put" -> "putting", "watch" -> "watching". */
export function gerundize(verb: string): string {
  const lower = verb.toLowerCase();
  if (GERUNDS[lower]) return GERUNDS[lower];
  if (lower.endsWith("ie")) return cap(lower.slice(0, -2) + "ying");
  if (lower.endsWith("e") && !lower.endsWith("ee")) return cap(lower.slice(0, -1) + "ing");
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(lower)) return cap(lower + lower.at(-1) + "ing");
  return cap(lower + "ing");
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function toSecondPerson(s: string): string {
  let out = s;
  for (const [re, to] of PERSON_SWAPS) out = out.replace(re, to);
  return out;
}

/**
 * "Text Mom that I'm heading home" -> "Texting Mom that you're heading home".
 * A sentence that does not start with a bare verb is left alone apart from the
 * pronoun swap -- better a slightly flat line than a mangled one.
 */
export function describeIntent(intent: string): string {
  const swapped = toSecondPerson(tidy(intent)).replace(/[.!?]+$/, "");
  const [first, ...rest] = swapped.split(/\s+/);
  if (!first) return swapped;
  const looksLikeVerb = /^[a-z]+$/i.test(first) && !/^(you|your|the|a|an)$/i.test(first);
  if (!looksLikeVerb) return cap(swapped);
  return tidy([gerundize(first), ...rest].join(" "));
}

/** The ask, tuned per action so "Say yes to send" is never said about a search. */
export function askFor(actionType: string): string {
  switch (actionType) {
    case "send_message":
    case "send_slack":
      return "Say yes to send.";
    case "create_event":
      return "Say yes to add it.";
    case "web_search":
      return "Say yes to look it up.";
    case "focus_mode":
    case "open_app":
    case "read_screen":
      return "Say yes to go ahead.";
    default:
      return "Say yes.";
  }
}

/**
 * Assemble the line VoiceOS speaks.
 *
 * `hedged` is used on the cold path, where we resolved from context rather than
 * from anything the person taught us. Being audibly unsure there is not
 * weakness -- it is the difference between a system that knows what it knows
 * and one that is bluffing.
 */
export function confirmationSpeech(opts: {
  intent: string;
  actionType: string;
  hedged?: boolean;
  maxWords?: number;
}): string {
  const described = describeIntent(opts.intent);
  const body = clampWords(described, opts.maxWords ?? 16);
  const lead = opts.hedged ? `I think you mean: ${lowerFirst(body)}` : body;
  return tidy(`${lead}. ${askFor(opts.actionType)}`);
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/**
 * The proof, spoken back after a phrase is learned (taught or accepted).
 * Playing the expansion aloud is what makes the room believe the phrase was
 * understood rather than merely stored.
 */
export function learnedPlayback(
  lead: string,
  trigger: string,
  intentTemplate: string,
): string {
  const readable = toSecondPerson(intentTemplate)
    .replace(/\{(\w+)\}/g, (_m, name: string) => `a ${humanSlot(name)}`)
    .replace(/\s+/g, " ")
    .trim();
  return tidy(`${lead} "${cap(trigger)}" now means: ${lowerFirst(readable)}.`);
}

function humanSlot(name: string): string {
  switch (name.toLowerCase()) {
    case "when":
    case "time":
      return "time you choose";
    case "who":
    case "contact":
      return "person you name";
    case "where":
    case "place":
      return "place you name";
    default:
      return `${name} you choose`;
  }
}

/** Spoken confirmation after an action actually fired. */
export function executedSpeech(actionType: string, detail?: string): string {
  const base = (() => {
    switch (actionType) {
      case "send_message":
      case "send_slack":
        return "Sent.";
      case "create_event":
        return "Added to your calendar.";
      case "focus_mode":
        return "Focus mode on.";
      case "open_app":
        return "Opening it now.";
      case "read_screen":
        return "Reading your screen.";
      case "web_search":
        return detail ? detail : "Here's what I found.";
      default:
        return "Done.";
    }
  })();
  if (actionType !== "web_search" && detail) return tidy(`${base} ${detail}`);
  return base;
}

/**
 * Beat 3's spoken offer. The clustering is the achievement; this sentence is
 * what the room actually judges it by.
 */
export function offerSpeech(trigger: string, count: number, timestamps: number[]): string {
  const words = ["once", "twice", "three times", "four times", "five times"];
  const howOften = words[Math.min(count, 5) - 1] ?? `${count} times`;
  const span = Math.max(...timestamps) - Math.min(...timestamps);
  const when =
    span <= 90 * 60 * 1000 ? " this hour" : span <= 24 * 60 * 60 * 1000 ? " today" : " lately";
  return `You've asked me that ${howOften}${when}. Want to just say "${trigger}"?`;
}
