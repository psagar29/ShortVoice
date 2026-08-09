// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ============================================================================

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const feed = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) =>
    await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 50),
});

export const log = internalMutation({
  args: {
    userId: v.id("users"),
    kind: v.union(
      v.literal("heard"),
      v.literal("resolved"),
      v.literal("awaiting"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("executed"),
      v.literal("taught"),
      v.literal("suggested"),
      v.literal("error"),
    ),
    text: v.string(),
    detail: v.optional(v.any()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", { ...args, createdAt: Date.now() });
  },
});
