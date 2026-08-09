// ============================================================================
// TEMP STUB -- Person A owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// Six seeded phrases, matching the vocabulary panel in docs/PERSON_D.md.
// "school mom" is deliberately NOT here -- it is taught live during Beat 2.
// "standup" is deliberately NOT here -- the system offers it during Beat 3.

import { mutation } from "./_generated/server";
import { fakeEmbedding } from "./embeddings";
import { normalizeTrigger } from "./lib/normalize";
import type { Doc, Id } from "./_generated/dataModel";

type SeedPhrase = {
  trigger: string;
  intentTemplate: string;
  actionType: Doc<"phrases">["actionType"];
  params: Record<string, unknown>;
  slots: string[];
  useCount: number;
};

const CONTACTS = [
  { alias: "mom", fullName: "Rashmi", phone: "+15551234567" },
  { alias: "neel", fullName: "Neel", phone: "+15559876543" },
  { alias: "team", fullName: "Project Team", slackId: "#project-team" },
];

const PHRASES: SeedPhrase[] = [
  {
    trigger: "team pr tonight",
    intentTemplate: "Tell your project team you'll review the latest PR {when}",
    actionType: "send_slack",
    params: { slackId: "#project-team", slotDefaults: { when: "tonight" } },
    slots: ["when"],
    useCount: 3,
  },
  {
    trigger: "neel later",
    intentTemplate: "Text Neel that you'll get back to him {when}",
    actionType: "send_message",
    params: {
      contact: "Neel",
      phone: "+15559876543",
      slotDefaults: { when: "later today" },
    },
    slots: ["when"],
    useCount: 1,
  },
  {
    trigger: "red",
    intentTemplate: "Tell your team you're blocked and need help right now",
    actionType: "send_slack",
    params: { slackId: "#project-team", slotDefaults: {} },
    slots: [],
    useCount: 0,
  },
  {
    trigger: "focus",
    intentTemplate:
      "Turn on Do Not Disturb, close Slack and Mail, and start a 25 minute timer",
    actionType: "focus_mode",
    params: { minutes: 25, slotDefaults: {} },
    slots: [],
    useCount: 0,
  },
  {
    trigger: "mom flight friday",
    intentTemplate: "Find afternoon flights from SFO for Mom this {when}",
    actionType: "web_search",
    params: { contact: "Rashmi", slotDefaults: { when: "Friday" } },
    slots: ["when"],
    useCount: 0,
  },
  {
    trigger: "screen",
    intentTemplate: "Read out what's currently on your screen",
    actionType: "read_screen",
    params: { slotDefaults: {} },
    slots: [],
    useCount: 0,
  },
];

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    // Wipe. Small tables, demo deployment -- a full scan is fine.
    for (const table of [
      "events",
      "suggestions",
      "utterances",
      "pendingActions",
      "phrases",
      "contacts",
      "users",
    ] as const) {
      for (const doc of await ctx.db.query(table).collect()) {
        await ctx.db.delete(doc._id);
      }
    }

    const now = Date.now();
    const userId: Id<"users"> = await ctx.db.insert("users", {
      name: "Demo",
      handle: "demo",
      voiceModel: "aura-2-thalia-en",
      createdAt: now,
    });

    for (const contact of CONTACTS) {
      await ctx.db.insert("contacts", { userId, ...contact });
    }

    // Inserted oldest-first so listPhrases (descending) shows them in this order.
    for (const phrase of PHRASES) {
      await ctx.db.insert("phrases", {
        userId,
        trigger: phrase.trigger,
        normalizedTrigger: normalizeTrigger(phrase.trigger),
        embedding: fakeEmbedding(`${phrase.trigger} ${phrase.intentTemplate}`),
        intentTemplate: phrase.intentTemplate,
        actionType: phrase.actionType,
        params: phrase.params,
        slots: phrase.slots,
        source: "seeded",
        useCount: phrase.useCount,
        lastUsedAt: phrase.useCount > 0 ? now : undefined,
        active: true,
        createdAt: now,
      });
    }

    await ctx.db.insert("events", {
      userId,
      kind: "taught",
      text: `Seeded ${PHRASES.length} phrases`,
      createdAt: now,
    });

    return { userId, phrases: PHRASES.length, contacts: CONTACTS.length };
  },
});
