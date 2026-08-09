// ============================================================================
// TEMP STUB -- Person A owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================

import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const eventKind = v.union(
  v.literal("heard"),
  v.literal("resolved"),
  v.literal("awaiting"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("executed"),
  v.literal("taught"),
  v.literal("suggested"),
  v.literal("error"),
);

/** Newest first. The dashboard subscribes to this and animates it. */
export const feed = query({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

export const log = internalMutation({
  args: {
    userId: v.id("users"),
    kind: eventKind,
    text: v.string(),
    detail: v.optional(v.any()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("events", { ...args, createdAt: Date.now() });
  },
});
