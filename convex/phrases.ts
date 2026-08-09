// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ============================================================================

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { actionType } from "./schema";

export const listPhrases = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("phrases")
      .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
      .collect(),
});

export const getByTrigger = query({
  args: { userId: v.id("users"), normalizedTrigger: v.string() },
  handler: async (ctx, { userId, normalizedTrigger }) =>
    await ctx.db
      .query("phrases")
      .withIndex("by_user_trigger", (q) =>
        q.eq("userId", userId).eq("normalizedTrigger", normalizedTrigger),
      )
      .first(),
});

/** Upsert: re-teaching an existing trigger replaces its meaning in place. */
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
    source: v.union(v.literal("taught"), v.literal("suggested"), v.literal("seeded")),
  },
  handler: async (ctx, args) => {
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
    const doc = await ctx.db.get(phraseId);
    if (!doc) return;
    await ctx.db.patch(phraseId, {
      useCount: doc.useCount + 1,
      lastUsedAt: Date.now(),
    });
  },
});

export const deactivate = mutation({
  args: { userId: v.id("users"), normalizedTrigger: v.string() },
  handler: async (ctx, { userId, normalizedTrigger }) => {
    const doc = await ctx.db
      .query("phrases")
      .withIndex("by_user_trigger", (q) =>
        q.eq("userId", userId).eq("normalizedTrigger", normalizedTrigger),
      )
      .first();
    if (!doc) return { ok: false };
    await ctx.db.patch(doc._id, { active: false });
    return { ok: true, trigger: doc.trigger };
  },
});

export const fetchByIds = internalQuery({
  args: { ids: v.array(v.id("phrases")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
