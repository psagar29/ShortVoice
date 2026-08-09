// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ----------------------------------------------------------------------------
// Seeds exactly what the three demo beats need, and deliberately does NOT seed:
//   * "school mom"  -- taught live on stage (Beat 2)
//   * anything about flights -- "mom flight friday" must resolve cold (§9)
//
// Phrases are inserted with `embedding: []` because a mutation cannot call an
// API. Run `npx convex run embeddings:reseedEmbeddings` after every seed.
// ============================================================================

import { mutation } from "./_generated/server";
import { normalizeTrigger } from "./lib/normalize";

const TABLES = [
  "events",
  "pendingActions",
  "suggestions",
  "utterances",
  "phrases",
  "contacts",
  "users",
] as const;

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    for (const table of TABLES) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
      }
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Demo",
      handle: "demo",
      voiceModel: "aura-2-thalia-en",
      createdAt: now,
    });

    const contacts = [
      { alias: "mom", fullName: "Rashmi", phone: "+15551230001" },
      { alias: "neel", fullName: "Neel Shah", phone: "+15551230002" },
      { alias: "laksh", fullName: "Laksh Patel", phone: "+15551230003", slackId: "U0LAKSH" },
      { alias: "team", fullName: "Project Team", slackId: "#project-team" },
    ];
    for (const c of contacts) await ctx.db.insert("contacts", { userId, ...c });

    const phrases = [
      {
        trigger: "neel later",
        intentTemplate: "Text Neel that I'll get back to him {when}",
        actionType: "send_message" as const,
        params: { contact: "neel", body: "Hey, I'll get back to you {when}." },
        slots: ["when"],
      },
      {
        trigger: "team pr",
        intentTemplate: "Tell the project team I'll review the latest PR {when}",
        actionType: "send_slack" as const,
        params: { channel: "#project-team", text: "I'll review the latest PR {when}." },
        slots: ["when"],
      },
      {
        trigger: "heads down",
        intentTemplate: "Turn on focus mode for 30 minutes",
        actionType: "focus_mode" as const,
        params: { minutes: 30 },
        slots: [],
      },
    ];
    for (const p of phrases) {
      await ctx.db.insert("phrases", {
        userId,
        trigger: p.trigger,
        normalizedTrigger: normalizeTrigger(p.trigger),
        embedding: [],
        intentTemplate: p.intentTemplate,
        actionType: p.actionType,
        params: p.params,
        slots: p.slots,
        source: "seeded",
        useCount: 0,
        active: true,
        createdAt: now,
      });
    }

    // Beat 3 fuel: three near-duplicate requests the person made this morning
    // that matched no taught phrase. learning.maybeSuggest clusters these and
    // offers a word for them, so we do not have to repeat ourselves on stage.
    const history = [
      "tell the team i'm running five minutes late to standup",
      "let the team know i'll be a few minutes late for standup",
      "message the team that i'm late to standup again",
    ];
    for (let i = 0; i < history.length; i++) {
      const raw = history[i];
      await ctx.db.insert("utterances", {
        userId,
        raw,
        resolvedIntent: "Tell the project team I'm running late to standup",
        outcome: "expanded",
        createdAt: now - (history.length - i) * 6 * 60 * 1000,
      });
    }

    return { userId, phrases: phrases.length, contacts: contacts.length };
  },
});
