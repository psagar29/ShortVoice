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
import { phraseDocText, sentenceCase } from "./lib/text";
import { attachContact, type ContactLite } from "./lib/slots";
import {
  ACTION_TYPES,
  paramsForParsedMeaning,
  parseMeaningWithRules,
  type ParsedMeaning,
} from "./lib/teachRules";

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
      parseMeaningWithRules(meaning, contacts);

    const intentTemplate = tidy(parsed.intentTemplate) || sentenceCase(meaning.trim());
    // Trust the template over the model's slot list: a {curly} in the sentence
    // is a slot whether or not it remembered to name it.
    const slots = [...new Set([...parsed.slots, ...extractSlots(intentTemplate)])].filter((s) =>
      intentTemplate.includes(`{${s}}`),
    );
    const params = attachContact(parsed.actionType, paramsForParsedMeaning(parsed), contacts);

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
): Promise<ParsedMeaning | null> {
  const parsed = await chatJSON<ParsedMeaning>({
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
      role: str("job title to apply for, may contain {curly}, or empty"),
      location: str("job location, may contain {curly}, or empty"),
    }),
    timeoutMs: 6_000,
    maxTokens: 350,
  });

  if (!parsed?.intentTemplate?.trim()) return null;
  return parsed;
}
