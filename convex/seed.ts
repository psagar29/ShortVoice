import type { Infer } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { actionType } from "./schema";
import { normalizeTrigger } from "./lib/normalize";

type ActionType = Infer<typeof actionType>;

const CONTACTS: Array<{ alias: string; fullName: string; slackId?: string }> = [
  { alias: "mom", fullName: "Rashmi" },
  { alias: "laksh", fullName: "Laksh" },
  { alias: "neel", fullName: "Neel" },
  { alias: "sarah", fullName: "Sarah" },
  { alias: "team", fullName: "Project Team", slackId: "#project-team" },
];

const PHRASES: Array<{
  trigger: string;
  intentTemplate: string;
  actionType: ActionType;
  params: unknown;
  slots: string[];
}> = [
  {
    trigger: "team pr tonight",
    intentTemplate: "Tell the project team I'll review the latest PR tonight",
    actionType: "send_slack",
    params: { channel: "#project-team", text: "I'll review the latest PR tonight" },
    slots: [],
  },
  {
    trigger: "neel later",
    intentTemplate: "Tell Neel I'll handle this {when}",
    actionType: "send_slack",
    params: { contact: "neel", text: "I'll handle this {when}" },
    slots: ["when"],
  },
  {
    trigger: "red",
    intentTemplate: "Stop and read the current screen aloud",
    actionType: "read_screen",
    params: {},
    slots: [],
  },
  {
    trigger: "focus",
    intentTemplate: "Do not disturb, close distractions, start a 25 minute timer",
    actionType: "focus_mode",
    params: { minutes: 25 },
    slots: [],
  },
  {
    trigger: "mom flight friday",
    intentTemplate: "Find afternoon flights from SFO for Mom this {day}",
    actionType: "web_search",
    params: { query: "afternoon flights from SFO this Friday", contact: "mom" },
    slots: ["day"],
  },
  {
    trigger: "where",
    intentTemplate: "Describe what's currently on my screen",
    actionType: "read_screen",
    params: {},
    slots: [],
  },
];

// Near-duplicate utterances for the same unstaught intent, so Person B's
// auto-suggest can fire on "standup" the first time it's taught live.
const STANDUP_UTTERANCES = [
  "give the team my standup update",
  "post my standup to the team",
  "send my daily standup notes to the team",
];

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", "demo"))
      .first();

    if (existingUser) {
      const userId = existingUser._id;

      for (const row of await ctx.db
        .query("phrases")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("pendingActions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("utterances")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("events")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("contacts")
        .withIndex("by_user_alias", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("suggestions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      await ctx.db.delete(userId);
    }

    const userId = await ctx.db.insert("users", {
      handle: "demo",
      name: "Pranav",
      voiceModel: "aura-2-thalia-en",
      createdAt: Date.now(),
    });

    for (const contact of CONTACTS) {
      await ctx.db.insert("contacts", { userId, ...contact });
    }

    for (const phrase of PHRASES) {
      // embedding: [] -- mutations can't call the OpenAI embeddings API.
      // Person B's reseedEmbeddings action backfills these after seeding.
      await ctx.runMutation(internal.phrases.insertPhrase, {
        userId,
        trigger: phrase.trigger,
        normalizedTrigger: normalizeTrigger(phrase.trigger),
        embedding: [],
        intentTemplate: phrase.intentTemplate,
        actionType: phrase.actionType,
        params: phrase.params,
        slots: phrase.slots,
        source: "seeded",
      });
    }

    const now = Date.now();
    for (let i = 0; i < STANDUP_UTTERANCES.length; i++) {
      await ctx.db.insert("utterances", {
        userId,
        raw: STANDUP_UTTERANCES[i],
        outcome: "unresolved",
        createdAt: now - (STANDUP_UTTERANCES.length - i) * 5 * 60 * 1000,
      });
    }

    return { userId };
  },
});
