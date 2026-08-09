import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getOrCreateDemoUser = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", "demo"))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("users", {
      handle: "demo",
      name: "Pranav",
      voiceModel: "aura-2-thalia-en",
      createdAt: Date.now(),
    });
  },
});

export const getUser = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .first();
  },
});
