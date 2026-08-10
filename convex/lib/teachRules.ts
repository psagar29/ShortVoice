// ============================================================================
// ShortVoice -- teaching without a model  (Person B)
// ============================================================================
// The fallback half of convex/teach.ts. If OpenAI is unreachable mid-demo, this
// is what still turns "apply to AI Engineer roles in San Francisco" into a
// job_apply phrase with a role and a location. It lives here, apart from the
// action, because it is pure: given a sentence and a contact list it returns
// the same parse every time, which is the only reason it can be tested at all.
// ============================================================================

import { isTimeToken, sentenceCase, tokens } from "./text";
import { findContact, type ContactLite } from "./slots";

/** Mirrors the `actionType` union in schema.ts. Keep in sync. */
export const ACTION_TYPES = [
  "send_message",
  "send_slack",
  "create_event",
  "read_screen",
  "focus_mode",
  "open_app",
  "web_search",
  "job_apply",
  "speak",
  "custom",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ParsedMeaning = {
  intentTemplate: string;
  actionType: ActionType;
  slots: string[];
  contact: string;
  channel: string;
  body: string;
  query: string;
  app: string;
  minutes: string;
  role: string;
  location: string;
};

/**
 * No model, no problem. Keyword routing plus a time-word -> {when} rewrite gets
 * Beat 2 on its feet without the network, which is the difference between a
 * degraded demo and no demo.
 */
export function parseMeaningWithRules(meaning: string, contacts: ContactLite[]): ParsedMeaning {
  const m = meaning.trim();
  const lower = m.toLowerCase();

  const actionType: ActionType = /\bslack\b/.test(lower)
    ? "send_slack"
    : /\b(text|message|imessage|sms|tell|let .* know)\b/.test(lower)
      ? "send_message"
      : /\b(apply|application|jobs?)\b/.test(lower)
        ? "job_apply"
        : /\b(search|look up|find|google|flights?)\b/.test(lower)
          ? "web_search"
          : /\b(calendar|event|schedule|meeting|book)\b/.test(lower)
            ? "create_event"
            : /\b(open|launch|start)\b/.test(lower)
              ? "open_app"
              : /\b(focus|do not disturb|dnd|quiet)\b/.test(lower)
                ? "focus_mode"
                : /\b(read|screen)\b/.test(lower)
                  ? "read_screen"
                  : "custom";

  const contact =
    contacts.find((c) => tokens(lower).some((t) => t === c.alias))?.alias ??
    findContact(contacts, lower)?.alias ??
    "";

  // "text mom that I'm leaving school" -> body "I'm leaving school"
  const bodyMatch = m.match(/\b(?:that|saying|to say|:)\s+(.+)$/i);
  const body = (bodyMatch?.[1] ?? m).trim();

  // "apply to AI engineer roles in SF" -> role "AI engineer roles", location "SF"
  const applyMatch =
    actionType === "job_apply"
      ? m.match(/\bapply\s+(?:to|for)?\s*(.+?)(?:\s+(?:in|near|around)\s+(.+))?$/i)
      : null;
  const role = actionType === "job_apply" ? (applyMatch?.[1] ?? body).trim() : "";
  const location = applyMatch?.[2]?.trim() ?? "";

  // The whole spoken time expression becomes the template's variable part --
  // the entire run, so "tomorrow morning" collapses to one {when} rather than
  // leaving "{when} morning" hanging in the sentence.
  let intentTemplate = sentenceCase(m);
  const slots: string[] = [];
  const words = m.split(/(\s+)/);
  const firstTime = words.findIndex((w) => isTimeToken(w.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (firstTime >= 0) {
    let lastTime = firstTime;
    for (let i = firstTime + 2; i < words.length; i += 2) {
      if (!isTimeToken(words[i].toLowerCase().replace(/[^a-z0-9]/g, ""))) break;
      lastTime = i;
    }
    intentTemplate = sentenceCase(
      [...words.slice(0, firstTime), "{when}", ...words.slice(lastTime + 1)].join(""),
    );
    slots.push("when");
  }

  return {
    intentTemplate,
    actionType,
    slots,
    contact,
    channel: actionType === "send_slack" ? (contact || "#general") : "",
    body,
    query: actionType === "web_search" ? body : "",
    app: "",
    minutes: "",
    role,
    location,
  };
}

/** The executor params a parsed meaning becomes. */
export function paramsForParsedMeaning(p: ParsedMeaning): Record<string, unknown> {
  switch (p.actionType) {
    case "send_message":
      return { contact: p.contact, body: p.body };
    case "send_slack":
      return { channel: p.channel || p.contact, text: p.body };
    case "web_search":
      return { query: p.query || p.body };
    case "job_apply":
      return { role: p.role || p.body, location: p.location };
    case "create_event":
      return { title: p.body };
    case "open_app":
      return { app: p.app || p.body };
    case "focus_mode":
      return { minutes: Number(p.minutes) || 30 };
    case "read_screen":
      return {};
    default:
      return { text: p.body };
  }
}
