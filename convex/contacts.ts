// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ============================================================================

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listContacts = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("contacts")
      .withIndex("by_user_alias", (q) => q.eq("userId", userId))
      .collect(),
});

export const resolveAlias = query({
  args: { userId: v.id("users"), alias: v.string() },
  handler: async (ctx, { userId, alias }) =>
    await ctx.db
      .query("contacts")
      .withIndex("by_user_alias", (q) =>
        q.eq("userId", userId).eq("alias", alias.toLowerCase().trim()),
      )
      .first(),
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
    const alias = args.alias.toLowerCase().trim();
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
