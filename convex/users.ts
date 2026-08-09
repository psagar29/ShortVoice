// ============================================================================
// TEMP STUB -- Person A owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
  handler: async (ctx, { handle }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .unique();
  },
});
