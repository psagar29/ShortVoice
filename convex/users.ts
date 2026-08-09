// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ============================================================================

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEMO_HANDLE = "demo";
const DEFAULT_VOICE = "aura-2-thalia-en";

export const getOrCreateDemoUser = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", DEMO_HANDLE))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      name: "Demo",
      handle: DEMO_HANDLE,
      voiceModel: DEFAULT_VOICE,
      createdAt: Date.now(),
    });
  },
});

export const getUser = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) =>
    await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .unique(),
});
