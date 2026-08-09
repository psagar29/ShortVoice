// ============================================================================
// ShortVoice -- live teaching  (Person B)  · Beat 2 of the demo
// ============================================================================
//   "When I say 'school mom', it means text Mom I'm leaving school
//    and heading home."
//        -> 🔊 "Got it. 'School mom' now means: text Mom that you're leaving
//              school and heading home."
//        -> "School mom."  -> it works, ten seconds later, cold.
//
// This runs live on stage. It must work on the first try, under three seconds,
// and it must degrade rather than throw: if the model is unreachable we parse
// the meaning with rules and still teach the phrase.
// ============================================================================

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import { arr, chatJSON, embedOne, enumOf, obj, str } from "./lib/openai";
import { normalizeTrigger } from "./lib/normalize";
import { extractSlots, tidy } from "./lib/render";
import { learnedPlayback } from "./lib/speech";
import { temporalPreamble } from "./lib/time";
import { isTimeToken, phraseDocText, sentenceCase, tokens } from "./lib/text";
import { attachContact, findContact, type ContactLite } from "./lib/slots";

const ACTION_TYPES = [
  "send_message",
  "send_slack",
  "create_event",
  "read_screen",
  "focus_mode",
  "open_app",
  "web_search",
  "speak",
  "custom",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

type Parsed = {
  intentTemplate: string;
  actionType: ActionType;
  slots: string[];
  contact: string;
  channel: string;
  body: string;
  query: string;
  app: string;
  minutes: string;
};

export const teachPhrase = action({
  args: { userId: v.id("users"), trigger: v.string(), meaning: v.string() },
  handler: async (
    ctx,
    { userId, trigger, meaning },
  ): Promise<{ ok: boolean; speech: string; phraseId?: Id<"phrases">; slots: string[] }> => {
    const t0 = Date.now();
    const cleanTrigger = trigger.trim().replace(/^["']|["']$/g, "");
    if (!cleanTrigger || !meaning.trim()) {
      return { ok: false, speech: "Tell me the word and what it should mean.", slots: [] };
    }

    const context = await ctx.runQuery(internal.resolver.resolveContext, { userId });
    const contacts: ContactLite[] = context.contacts;

    const parsed =
      (await parseWithModel(cleanTrigger, meaning, contacts, context.phrases.map((p) => p.trigger))) ??
      parseWithRules(meaning, contacts);

    const intentTemplate = tidy(parsed.intentTemplate) || sentenceCase(meaning.trim());
    // Trust the template over the model's slot list: a {curly} in the sentence
    // is a slot whether or not it remembered to name it.
    const slots = [...new Set([...parsed.slots, ...extractSlots(intentTemplate)])].filter((s) =>
      intentTemplate.includes(`{${s}}`),
    );
    const params = attachContact(parsed.actionType, paramsFor(parsed), contacts);

    // If embedding fails we still teach the phrase -- resolver.ts scores
    // unembedded phrases lexically so the very next utterance still lands.
    let embedding: number[] = [];
    try {
      embedding = await embedOne(phraseDocText(cleanTrigger, intentTemplate));
    } catch (err) {
      console.error("[shortvoice] teach: embedding failed, storing without vector:", err);
    }

    const phraseId: Id<"phrases"> = await ctx.runMutation(internal.phrases.insertPhrase, {
      userId,
      trigger: cleanTrigger,
      normalizedTrigger: normalizeTrigger(cleanTrigger),
      embedding,
      intentTemplate,
      actionType: parsed.actionType,
      params,
      slots,
      source: "taught" as const,
    });

    const speech = learnedPlayback("Got it.", cleanTrigger, intentTemplate);

    await Promise.all([
      ctx.runMutation(internal.events.log, {
        userId,
        kind: "taught" as const,
        text: speech,
        detail: {
          trigger: cleanTrigger,
          intentTemplate,
          actionType: parsed.actionType,
          slots,
          embedded: embedding.length > 0,
        },
        latencyMs: Date.now() - t0,
      }),
      ctx.runMutation(internal.resolver.recordUtterance, {
        userId,
        raw: `when I say "${cleanTrigger}" it means ${meaning.trim()}`,
        resolvedIntent: intentTemplate,
        matchedPhraseId: phraseId,
        outcome: "taught" as const,
      }),
    ]);

    return { ok: true, speech, phraseId, slots };
  },
});

// ---------------------------------------------------------------------------
// Parsing the meaning
// ---------------------------------------------------------------------------

async function parseWithModel(
  trigger: string,
  meaning: string,
  contacts: ContactLite[],
  existingTriggers: string[],
): Promise<Parsed | null> {
  const parsed = await chatJSON<Parsed>({
    system:
      "You turn a person's plain-English definition of their own shorthand into a " +
      "reusable intent TEMPLATE for a voice assistant.\n" +
      "Rules:\n" +
      "- `intentTemplate` is one first-person sentence naming the real recipient and " +
      "the actual payload. Under 18 words.\n" +
      "- If any part of the meaning could vary between uses -- a time, a place, a " +
      "person, a duration -- replace it with a {curly} placeholder and list the name " +
      "in `slots`. Prefer the names: when, who, where, what.\n" +
      "- Use a contact's alias exactly as given in the contact list.\n" +
      "- Pick the single most appropriate actionType.\n" +
      "- Leave unused fields as empty strings.",
    user: [
      temporalPreamble(),
      `Contacts: ${contacts.map((c) => `${c.alias} (${c.fullName})`).join(", ") || "(none)"}`,
      existingTriggers.length ? `Words they already have: ${existingTriggers.join(", ")}` : "",
      `New word: "${trigger}"`,
      `They said it means: "${meaning.trim()}"`,
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "taught_phrase",
    schema: obj({
      intentTemplate: str("first-person sentence, {curly} placeholders for variable parts"),
      actionType: enumOf(ACTION_TYPES),
      slots: arr(str(), "names of the {curly} placeholders used"),
      contact: str("contact alias, or empty"),
      channel: str("slack channel, or empty"),
      body: str("message text / event title, may contain {curly}, or empty"),
      query: str("web search query, or empty"),
      app: str("application name, or empty"),
      minutes: str("duration in minutes, or empty"),
    }),
    timeoutMs: 6_000,
    maxTokens: 350,
  });

  if (!parsed?.intentTemplate?.trim()) return null;
  return parsed;
}

/**
 * No model, no problem. Keyword routing plus a time-word -> {when} rewrite gets
 * Beat 2 on its feet without the network, which is the difference between a
 * degraded demo and no demo.
 */
function parseWithRules(meaning: string, contacts: ContactLite[]): Parsed {
  const m = meaning.trim();
  const lower = m.toLowerCase();

  const actionType: ActionType = /\bslack\b/.test(lower)
    ? "send_slack"
    : /\b(text|message|imessage|sms|tell|let .* know)\b/.test(lower)
      ? "send_message"
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
  };
}

function paramsFor(p: Parsed): Record<string, unknown> {
  switch (p.actionType) {
    case "send_message":
      return { contact: p.contact, body: p.body };
    case "send_slack":
      return { channel: p.channel || p.contact, text: p.body };
    case "web_search":
      return { query: p.query || p.body };
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

