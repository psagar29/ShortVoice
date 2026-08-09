// ============================================================================
// TEMP STUB -- Person B owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// Beat 3 of the demo: the system offers you a word you never asked for.
// The real version clusters utterance embeddings. This one groups by
// normalized token set, which is enough to notice a literal repetition.

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { fakeEmbedding } from "./embeddings";
import { inferActionType, parseMeaning, proposeTrigger } from "./lib/intent";
import { normalizeTrigger } from "./lib/normalize";
import { actionType } from "./schema";

/** How many times you have to repeat yourself before we offer you a word. */
const EVIDENCE_THRESHOLD = 3;
const WINDOW_MS = 60 * 60 * 1000; // "three times this hour"

export const pendingSuggestion = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("suggestions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .order("desc")
      .first();
  },
});

export const recentUnphrased = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => {
    const rows = await ctx.db
      .query("utterances")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.filter(
      (r) =>
        r.createdAt >= since &&
        (r.outcome === "expanded" || r.outcome === "unresolved"),
    );
  },
});

export const insertSuggestion = internalMutation({
  args: {
    userId: v.id("users"),
    proposedTrigger: v.string(),
    intentTemplate: v.string(),
    actionType,
    params: v.any(),
    evidenceCount: v.number(),
    evidenceUtterances: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending"),
      )
      .first();
    if (existing) return existing._id; // never stack two offers

    return await ctx.db.insert("suggestions", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const markSuggestion = internalMutation({
  args: {
    id: v.id("suggestions"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("dismissed"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

export const maybeSuggest = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.runQuery(api.learning.pendingSuggestion, { userId });
    if (existing) return null;

    const recent = await ctx.runQuery(internal.learning.recentUnphrased, {
      userId,
      since: Date.now() - WINDOW_MS,
    });

    // Group utterances that mean the same thing regardless of word order.
    const groups = new Map<string, { raw: string; intent?: string }[]>();
    for (const row of recent) {
      const key = normalizeTrigger(row.raw);
      if (!key) continue;
      const bucket = groups.get(key) ?? [];
      bucket.push({ raw: row.raw, intent: row.resolvedIntent });
      groups.set(key, bucket);
    }

    const repeated = [...groups.values()]
      .filter((g) => g.length >= EVIDENCE_THRESHOLD)
      .sort((a, b) => b.length - a.length)[0];
    if (!repeated) return null;

    const raws = repeated.map((r) => r.raw);
    const proposed = proposeTrigger(raws);

    // Don't offer a word they already have.
    const clash = await ctx.runQuery(api.phrases.getByTrigger, {
      userId,
      normalizedTrigger: normalizeTrigger(proposed),
    });
    if (clash) return null;

    const sourceIntent = repeated.find((r) => r.intent)?.intent ?? raws[0];
    const { intentTemplate } = parseMeaning(sourceIntent);

    const suggestionId = await ctx.runMutation(internal.learning.insertSuggestion, {
      userId,
      proposedTrigger: proposed,
      intentTemplate,
      actionType: inferActionType(sourceIntent),
      params: {},
      evidenceCount: repeated.length,
      evidenceUtterances: raws.slice(0, 5),
    });

    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "suggested",
      text: `You've asked for that ${repeated.length} times. Want to just say "${proposed}"?`,
      detail: { proposedTrigger: proposed, intentTemplate },
    });

    return suggestionId;
  },
});

export const acceptSuggestion = action({
  args: { userId: v.id("users"), trigger: v.string() },
  handler: async (ctx, { userId, trigger }) => {
    const suggestion = await ctx.runQuery(api.learning.pendingSuggestion, { userId });
    if (!suggestion) {
      return { speech: "There's no suggestion waiting." };
    }

    // The user may counter-offer a different word than the one we proposed.
    const chosen = trigger.trim() || suggestion.proposedTrigger;

    const phraseId = await ctx.runMutation(internal.phrases.insertPhrase, {
      userId,
      trigger: chosen,
      normalizedTrigger: normalizeTrigger(chosen),
      embedding: fakeEmbedding(`${chosen} ${suggestion.intentTemplate}`),
      intentTemplate: suggestion.intentTemplate,
      actionType: suggestion.actionType,
      params: suggestion.params ?? {},
      slots: [],
      source: "suggested",
    });

    await ctx.runMutation(internal.learning.markSuggestion, {
      id: suggestion._id,
      status: "accepted",
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "taught",
      text: chosen,
      detail: { intentTemplate: suggestion.intentTemplate, source: "suggested" },
    });

    return {
      speech: `Done. "${chosen}" now means: ${suggestion.intentTemplate}`,
      phraseId,
    };
  },
});
