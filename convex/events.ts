import { v, type Infer } from "convex/values";
import { internalMutation, query, type ActionCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const eventArgs = v.object({
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
});
type EventArgs = Infer<typeof eventArgs>;

export const log = internalMutation({
  args: eventArgs.fields,
  handler: async (ctx, args) => {
    await ctx.db.insert("events", { ...args, createdAt: Date.now() });
  },
});

export const feed = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 50);
  },
});

// Lets other modules log an event without spelling out internal.events.log.
export async function logEvent(ctx: ActionCtx | MutationCtx, args: EventArgs) {
  await ctx.runMutation(internal.events.log, args);
}
