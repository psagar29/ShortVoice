// ============================================================================
// TEMP STUB -- Person A owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { actionType } from "./schema";

/** The vocabulary. The dashboard subscribes to this; it is the Convex proof. */
export const listPhrases = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("phrases")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
      .order("desc")
      .collect();
  },
});

export const getByTrigger = query({
  args: { userId: v.id("users"), normalizedTrigger: v.string() },
  handler: async (ctx, { userId, normalizedTrigger }) => {
    return await ctx.db
      .query("phrases")
      .withIndex("by_user_trigger", (q) =>
        q.eq("userId", userId).eq("normalizedTrigger", normalizedTrigger),
      )
      .first();
  },
});

export const insertPhrase = internalMutation({
  args: {
    userId: v.id("users"),
    trigger: v.string(),
    normalizedTrigger: v.string(),
    embedding: v.array(v.float64()),
    intentTemplate: v.string(),
    actionType,
    params: v.any(),
    slots: v.array(v.string()),
    source: v.union(
      v.literal("taught"),
      v.literal("suggested"),
      v.literal("seeded"),
    ),
  },
  handler: async (ctx, args) => {
    // Re-teaching an existing trigger updates it rather than duplicating.
    const existing = await ctx.db
      .query("phrases")
      .withIndex("by_user_trigger", (q) =>
        q.eq("userId", args.userId).eq("normalizedTrigger", args.normalizedTrigger),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, active: true });
      return existing._id;
    }

    return await ctx.db.insert("phrases", {
      ...args,
      useCount: 0,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const bumpUsage = internalMutation({
  args: { phraseId: v.id("phrases") },
  handler: async (ctx, { phraseId }) => {
    const phrase = await ctx.db.get(phraseId);
    if (!phrase) return;
    await ctx.db.patch(phraseId, {
      useCount: phrase.useCount + 1,
      lastUsedAt: Date.now(),
    });
  },
});

export const deactivate = mutation({
  args: { userId: v.id("users"), normalizedTrigger: v.string() },
  handler: async (ctx, { userId, normalizedTrigger }) => {
    const phrase = await ctx.db
      .query("phrases")
      .withIndex("by_user_trigger", (q) =>
        q.eq("userId", userId).eq("normalizedTrigger", normalizedTrigger),
      )
      .first();
    if (!phrase) return false;
    await ctx.db.patch(phrase._id, { active: false });
    return true;
  },
});

export const fetchByIds = internalQuery({
  args: { ids: v.array(v.id("phrases")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d) => d !== null);
  },
});
