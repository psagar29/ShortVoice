// ============================================================================
// TEMP STUB -- Person B owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// The real version parses `meaning` with an LLM and embeds the result. This
// one parses with regexes and embeds with a hash. The write path, the return
// shape, and the "taught" event the dashboard animates are all real -- which
// is what Beat 2 of the demo needs.

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fakeEmbedding } from "./embeddings";
import { inferActionType, parseMeaning } from "./lib/intent";
import { normalizeTrigger } from "./lib/normalize";

export const teachPhrase = action({
  args: {
    userId: v.id("users"),
    trigger: v.string(),
    meaning: v.string(),
  },
  handler: async (
    ctx,
    { userId, trigger, meaning },
  ): Promise<{ speech: string; phraseId: Id<"phrases"> }> => {
    const { intentTemplate, slots, slotDefaults } = parseMeaning(meaning);
    const actionType = inferActionType(meaning);

    const contacts: Doc<"contacts">[] = await ctx.runQuery(
      api.contacts.listContacts,
      { userId },
    );
    const haystack = meaning.toLowerCase();
    const contact = contacts.find(
      (c) =>
        haystack.includes(c.alias.toLowerCase()) ||
        haystack.includes(c.fullName.toLowerCase()),
    );

    const params: Record<string, unknown> = { slotDefaults };
    if (contact) {
      params.contact = contact.fullName;
      if (contact.phone) params.phone = contact.phone;
      if (contact.slackId) params.slackId = contact.slackId;
    }

    const phraseId: Id<"phrases"> = await ctx.runMutation(internal.phrases.insertPhrase, {
      userId,
      trigger: trigger.trim(),
      normalizedTrigger: normalizeTrigger(trigger),
      embedding: fakeEmbedding(`${trigger} ${intentTemplate}`),
      intentTemplate,
      actionType,
      params,
      slots,
      source: "taught",
    });

    const speech = `Got it. "${trigger.trim()}" now means: ${intentTemplate}`;

    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "taught",
      text: trigger.trim(),
      detail: { intentTemplate, actionType, slots },
    });
    await ctx.runMutation(internal.resolver.recordUtterance, {
      userId,
      raw: `when I say ${trigger} it means ${meaning}`,
      resolvedIntent: intentTemplate,
      matchedPhraseId: phraseId,
      outcome: "taught",
    });

    return { speech, phraseId };
  },
});
