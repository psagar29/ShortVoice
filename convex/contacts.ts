import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listContacts = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_user_alias", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const resolveAlias = query({
  args: { userId: v.id("users"), alias: v.string() },
  handler: async (ctx, { userId, alias }) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_user_alias", (q) =>
        q.eq("userId", userId).eq("alias", alias.toLowerCase()),
      )
      .first();
  },
});

export const upsertContact = mutation({
  args: {
    userId: v.id("users"),
    alias: v.string(),
    fullName: v.string(),
    phone: v.optional(v.string()),
    slackId: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const alias = args.alias.toLowerCase();
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_user_alias", (q) => q.eq("userId", args.userId).eq("alias", alias))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, alias });
      return existing._id;
    }

    return await ctx.db.insert("contacts", { ...args, alias });
  },
});
