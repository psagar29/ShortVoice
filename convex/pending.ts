import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actionType } from "./schema";

export const getAwaiting = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("pendingActions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "awaiting"))
      .first();
  },
});

export const createPending = internalMutation({
  args: {
    userId: v.id("users"),
    utterance: v.string(),
    phraseId: v.optional(v.id("phrases")),
    resolvedIntent: v.string(),
    confirmationSpeech: v.string(),
    actionType,
    params: v.any(),
    matchScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingAwaiting = await ctx.db
      .query("pendingActions")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "awaiting"))
      .first();

    if (existingAwaiting) {
      await ctx.db.patch(existingAwaiting._id, { status: "cancelled", resolvedAt: Date.now() });
    }

    return await ctx.db.insert("pendingActions", {
      ...args,
      status: "awaiting",
      createdAt: Date.now(),
    });
  },
});

export const setStatus = internalMutation({
  args: {
    id: v.id("pendingActions"),
    status: v.union(
      v.literal("awaiting"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("executed"),
      v.literal("failed"),
    ),
    result: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, result }) => {
    await ctx.db.patch(id, { status, result, resolvedAt: Date.now() });
  },
});
