// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ============================================================================

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { actionType } from "./schema";

export const getAwaiting = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("pendingActions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "awaiting"))
      .order("desc")
      .first(),
});

/**
 * At most one row per user may be "awaiting" (schema comment). Creating a new
 * pending action supersedes any older one, so a stale "yes" can never fire a
 * question from two utterances ago.
 */
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
    const stale = await ctx.db
      .query("pendingActions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "awaiting"),
      )
      .collect();
    for (const row of stale) {
      await ctx.db.patch(row._id, { status: "cancelled", resolvedAt: Date.now() });
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
    await ctx.db.patch(id, {
      status,
      ...(result !== undefined ? { result } : {}),
      resolvedAt: Date.now(),
    });
  },
});
