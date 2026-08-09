// ============================================================================
// TEMP STUB -- Person B owns this file. See CONTRACT.md sections 5 and 6.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// The real resolver is: normalize -> embed -> ctx.vectorSearch -> LLM slot-fill.
// This one is: normalize -> weighted token overlap -> lexical slot-fill.
//
// It keeps the order-independence and slot-filling that CONTRACT.md section 6
// calls non-negotiable, and it keeps the exact return shapes the dashboard and
// the MCP server code against. It does not do semantic matching.

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { fillSlots, renderTemplate, scoreTrigger } from "./lib/matching";
import { tokenize } from "./lib/normalize";

const STRONG_MATCH = 0.82;
const WEAK_MATCH = 0.65;

/** The utterances table is the training data for auto-suggest. */
export const recordUtterance = internalMutation({
  args: {
    userId: v.id("users"),
    raw: v.string(),
    resolvedIntent: v.optional(v.string()),
    matchedPhraseId: v.optional(v.id("phrases")),
    matchScore: v.optional(v.number()),
    outcome: v.union(
      v.literal("matched"),
      v.literal("expanded"),
      v.literal("unresolved"),
      v.literal("taught"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("utterances", { ...args, createdAt: Date.now() });
  },
});

function asQuestion(intent: string): string {
  const trimmed = intent.trim().replace(/[.?!]+$/, "");
  return `${trimmed}?`;
}

export const resolve = action({
  args: { userId: v.id("users"), utterance: v.string() },
  handler: async (ctx, { userId, utterance }) => {
    const startedAt = Date.now();

    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "heard",
      text: utterance,
    });

    const [phrases, contacts] = await Promise.all([
      ctx.runQuery(api.phrases.listPhrases, { userId }),
      ctx.runQuery(api.contacts.listContacts, { userId }),
    ]);

    const ranked = phrases
      .map((phrase) => ({ phrase, ...scoreTrigger(phrase.trigger, utterance) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    // ---- strong or weak match on a taught phrase -------------------------
    if (best && best.score >= WEAK_MATCH) {
      const { phrase, score, leftover } = best;
      const filled = fillSlots(phrase.slots, leftover);
      const defaults = (phrase.params?.slotDefaults ?? {}) as Record<string, string>;
      const resolvedIntent = renderTemplate(phrase.intentTemplate, filled, defaults);

      // Below STRONG_MATCH the real resolver would ask an LLM to adjudicate.
      // Without one, we still confirm -- but we say out loud that we are guessing.
      const confident = score >= STRONG_MATCH;
      const confirmationSpeech = confident
        ? asQuestion(resolvedIntent)
        : `I think you mean: ${asQuestion(resolvedIntent)}`;

      await ctx.runMutation(internal.events.log, {
        userId,
        kind: "resolved",
        text: resolvedIntent,
        detail: { trigger: phrase.trigger, matchScore: score, slots: filled },
        latencyMs: Date.now() - startedAt,
      });

      const pendingId = await ctx.runMutation(internal.pending.createPending, {
        userId,
        utterance,
        phraseId: phrase._id,
        resolvedIntent,
        confirmationSpeech,
        actionType: phrase.actionType,
        params: { ...phrase.params, ...filled },
        matchScore: score,
      });

      await ctx.runMutation(internal.phrases.bumpUsage, { phraseId: phrase._id });
      await ctx.runMutation(internal.events.log, {
        userId,
        kind: "awaiting",
        text: confirmationSpeech,
      });
      await ctx.runMutation(internal.resolver.recordUtterance, {
        userId,
        raw: utterance,
        resolvedIntent,
        matchedPhraseId: phrase._id,
        matchScore: score,
        outcome: "matched",
      });
      await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId });

      return {
        kind: "confirm" as const,
        pendingId,
        confirmationSpeech,
        resolvedIntent,
        matchScore: score,
      };
    }

    // ---- no taught phrase, but we know who they mean ----------------------
    // "mom flight friday" with nothing taught still becomes something real.
    const tokens = tokenize(utterance);
    const contact = contacts.find((c) => tokens.includes(c.alias.toLowerCase()));

    if (contact) {
      const rest = tokens.filter((t) => t !== contact.alias.toLowerCase());
      const subject = rest.length > 0 ? rest.join(" ") : "you were thinking of them";
      const resolvedIntent = `Text ${contact.fullName} about ${subject}`;
      const confirmationSpeech = `I don't have a phrase for that yet. ${asQuestion(resolvedIntent)}`;

      await ctx.runMutation(internal.events.log, {
        userId,
        kind: "resolved",
        text: resolvedIntent,
        detail: { expandedFrom: "contact", alias: contact.alias },
        latencyMs: Date.now() - startedAt,
      });

      const pendingId = await ctx.runMutation(internal.pending.createPending, {
        userId,
        utterance,
        resolvedIntent,
        confirmationSpeech,
        actionType: "send_message",
        params: { contact: contact.fullName, phone: contact.phone, body: subject },
        matchScore: best?.score,
      });

      await ctx.runMutation(internal.events.log, {
        userId,
        kind: "awaiting",
        text: confirmationSpeech,
      });
      await ctx.runMutation(internal.resolver.recordUtterance, {
        userId,
        raw: utterance,
        resolvedIntent,
        matchScore: best?.score,
        outcome: "expanded",
      });
      await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId });

      return {
        kind: "confirm" as const,
        pendingId,
        confirmationSpeech,
        resolvedIntent,
        matchScore: best?.score,
      };
    }

    // ---- we genuinely do not know ----------------------------------------
    const speech = `I don't know "${utterance}" yet. Tell me what it should mean and I'll remember it.`;
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "error",
      text: speech,
      detail: { utterance, bestScore: best?.score ?? 0 },
      latencyMs: Date.now() - startedAt,
    });
    await ctx.runMutation(internal.resolver.recordUtterance, {
      userId,
      raw: utterance,
      matchScore: best?.score,
      outcome: "unresolved",
    });
    await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId });

    return { kind: "unknown" as const, speech };
  },
});

export const executeConfirmed = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const pending = await ctx.runQuery(api.pending.getAwaiting, { userId });
    if (!pending) {
      return { ok: false, speech: "There's nothing waiting for a yes." };
    }

    await ctx.runMutation(internal.pending.setStatus, {
      id: pending._id,
      status: "confirmed",
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "confirmed",
      text: pending.resolvedIntent,
    });

    // Real execution is Person C (local/AppleScript) and Person B
    // (executors.ts, network). The stub reports what it would have done.
    const detail = `[stub] would run ${pending.actionType}`;
    await ctx.runMutation(internal.pending.setStatus, {
      id: pending._id,
      status: "executed",
      result: detail,
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "executed",
      text: pending.resolvedIntent,
      detail: { actionType: pending.actionType, params: pending.params },
    });

    return { ok: true, speech: "Sent." };
  },
});

export const cancelPending = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const pending = await ctx.runQuery(api.pending.getAwaiting, { userId });
    if (!pending) return { speech: "Nothing to cancel." };

    await ctx.runMutation(internal.pending.setStatus, {
      id: pending._id,
      status: "cancelled",
      result: "cancelled by user",
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "cancelled",
      text: pending.resolvedIntent,
    });
    return { speech: "Cancelled." };
  },
});
