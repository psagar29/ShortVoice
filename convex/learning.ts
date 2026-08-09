// ============================================================================
// ShortVoice -- the system teaches you  (Person B)  · Beat 3, the one that wins
// ============================================================================
//   🔊 "You've asked me that three times this hour. Want to just say 'standup'?"
//
// Everything else in this repo is a better macro system. This is the part where
// the computer notices a person repeating themselves and offers them a word for
// it -- the vocabulary growing on its own, on screen, unprompted.
//
// Mechanically: cluster the person's own utterance vectors, keep only the ones
// that matched no taught phrase, and if three or more of them say the same
// thing, propose a word. It runs scheduled, off the critical path -- `resolve`
// never waits for this and never fails because of it.
// ============================================================================

import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { actionType } from "./schema";

import { chatJSON, embedOne, embeddingBackend, enumOf, obj, str } from "./lib/openai";
import { normalizeTrigger } from "./lib/normalize";
import { learnedPlayback, offerSpeech } from "./lib/speech";
import { temporalPreamble } from "./lib/time";
import {
  canonicalKey,
  contentTokens,
  lexicalScore,
  phraseDocText,
  sentenceCase,
} from "./lib/text";
import { attachContact, type ContactLite } from "./lib/slots";

const ACTION_TYPES = [
  "send_message",
  "send_slack",
  "create_event",
  "read_screen",
  "focus_mode",
  "open_app",
  "web_search",
  "speak",
  "custom",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Pairwise similarity that counts as "the same request again".
 *
 * Cosine is not comparable across embedding spaces: 0.88 is the right bar for
 * text-embedding-3-small, and far above anything the offline hashed fallback
 * (lib/hashembed.ts) ever produces for a paraphrase, where 0.42 separates
 * "same request, different words" from "unrelated" by a wide margin.
 */
function clusterThreshold(): number {
  return embeddingBackend() === "openai" ? 0.88 : 0.42;
}
/** How many repeats before we are confident enough to interrupt someone. */
const MIN_EVIDENCE = 3;

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export const learningContext = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const [recent, suggestions, phrases, contacts] = await Promise.all([
      ctx.db
        .query("utterances")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(30),
      ctx.db
        .query("suggestions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("phrases")
        .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
        .collect(),
      ctx.db
        .query("contacts")
        .withIndex("by_user_alias", (q) => q.eq("userId", userId))
        .collect(),
    ]);

    // Utterances that matched nothing and carry a vector to search with, newest
    // first. The newest is the natural seed, but a one-off "mom flight friday"
    // must not shadow a three-deep pattern from ten minutes ago -- so we keep a
    // few and let maybeSuggest try each in turn.
    const seeds = recent
      .filter(
        (u) =>
          !u.matchedPhraseId &&
          (u.outcome === "expanded" || u.outcome === "unresolved") &&
          (u.embedding?.length ?? 0) > 0,
      )
      .slice(0, 4)
      .map((u) => ({
        id: u._id,
        raw: u.raw,
        embedding: u.embedding!,
        resolvedIntent: u.resolvedIntent,
      }));

    return {
      seeds,
      suggestions: suggestions.map((s) => ({
        proposedTrigger: s.proposedTrigger,
        intentTemplate: s.intentTemplate,
        status: s.status,
      })),
      triggers: phrases.map((p) => p.trigger),
      normalizedTriggers: phrases.map((p) => p.normalizedTrigger),
      contacts: contacts.map((c) => ({
        alias: c.alias,
        fullName: c.fullName,
        phone: c.phone,
        slackId: c.slackId,
        email: c.email,
      })),
    };
  },
});

export const utterancesByIds = internalQuery({
  args: { ids: v.array(v.id("utterances")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({
        raw: d.raw,
        outcome: d.outcome,
        resolvedIntent: d.resolvedIntent,
        matched: Boolean(d.matchedPhraseId),
        createdAt: d.createdAt,
      }));
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
  handler: async (ctx, args) =>
    await ctx.db.insert("suggestions", {
      ...args,
      status: "pending" as const,
      createdAt: Date.now(),
    }),
});

export const setSuggestionStatus = internalMutation({
  args: {
    id: v.id("suggestions"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("dismissed")),
  },
  handler: async (ctx, { id, status }) => await ctx.db.patch(id, { status }),
});

/** Person D's dashboard subscribes to this -- it must stay a query. */
export const pendingSuggestion = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("suggestions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .order("desc")
      .first(),
});

// ---------------------------------------------------------------------------
// maybeSuggest
// ---------------------------------------------------------------------------

export const maybeSuggest = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ suggested: boolean; reason?: string }> => {
    const context = await ctx.runQuery(internal.learning.learningContext, { userId });
    if (context.seeds.length === 0) {
      return { suggested: false, reason: "no unmatched utterance with a vector" };
    }

    // One open offer at a time. Two voices asking to teach you words at once is
    // not a demo, it is a hostage situation.
    if (context.suggestions.some((s) => s.status === "pending")) {
      return { suggested: false, reason: "a suggestion is already pending" };
    }

    const threshold = clusterThreshold();
    let seed: (typeof context.seeds)[number] | null = null;
    let cluster: { raw: string; resolvedIntent?: string; createdAt: number }[] = [];

    for (const candidate of context.seeds) {
      const hits = await ctx.vectorSearch("utterances", "by_embedding", {
        vector: candidate.embedding,
        limit: 12,
        filter: (q) => q.eq("userId", userId),
      });
      const near = hits.filter((h) => h._score >= threshold);
      if (near.length < MIN_EVIDENCE) continue;

      const docs = await ctx.runQuery(internal.learning.utterancesByIds, {
        ids: near.map((h) => h._id),
      });
      const unmatched = docs.filter((d) => !d.matched && d.outcome !== "taught");
      if (unmatched.length >= MIN_EVIDENCE) {
        seed = candidate;
        cluster = unmatched;
        break;
      }
    }

    if (!seed) return { suggested: false, reason: "no cluster of repeated requests yet" };

    const intentSoFar =
      cluster.find((c) => c.resolvedIntent)?.resolvedIntent ?? sentenceCase(seed.raw);

    // Already offered and accepted something for this? Don't nag.
    const covered = context.suggestions.some(
      (s) => s.status !== "dismissed" && lexicalScore(intentSoFar, s.intentTemplate) >= 0.6,
    );
    if (covered) return { suggested: false, reason: "already covered by a suggestion" };

    const proposal =
      (await proposeWithModel(cluster.map((c) => c.raw), intentSoFar, context)) ??
      proposeWithRules(cluster.map((c) => c.raw), intentSoFar, context);

    if (!proposal) return { suggested: false, reason: "no usable trigger" };

    // A proposed word that collides with one they already have teaches nothing.
    const normalized = normalizeTrigger(proposal.trigger);
    if (!normalized || context.normalizedTriggers.includes(normalized)) {
      return { suggested: false, reason: "proposed trigger collides with an existing phrase" };
    }

    const contacts: ContactLite[] = context.contacts;
    const params = attachContact(proposal.actionType, proposal.params, contacts);

    await ctx.runMutation(internal.learning.insertSuggestion, {
      userId,
      proposedTrigger: proposal.trigger,
      intentTemplate: proposal.intentTemplate,
      actionType: proposal.actionType,
      params,
      evidenceCount: cluster.length,
      evidenceUtterances: cluster.slice(0, 5).map((c) => c.raw),
    });

    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "suggested" as const,
      text: offerSpeech(proposal.trigger, cluster.length, cluster.map((c) => c.createdAt)),
      detail: {
        trigger: proposal.trigger,
        intentTemplate: proposal.intentTemplate,
        evidenceCount: cluster.length,
      },
    });

    return { suggested: true };
  },
});

type Proposal = {
  trigger: string;
  intentTemplate: string;
  actionType: ActionType;
  params: Record<string, unknown>;
};

async function proposeWithModel(
  evidence: string[],
  intentSoFar: string,
  context: { triggers: string[]; contacts: ContactLite[] },
): Promise<Proposal | null> {
  const raw = await chatJSON<{
    trigger: string;
    intentTemplate: string;
    actionType: ActionType;
    contact: string;
    channel: string;
    body: string;
    query: string;
    app: string;
  }>({
    system:
      "A person keeps asking a voice assistant for the same thing in different words. " +
      "Invent ONE short word or two-word phrase they could say instead. " +
      "Rules: 1-2 words, easy to say out loud, made of words that already appear in " +
      "what they said, and not colliding with words they already use. " +
      "`intentTemplate` is the first-person sentence it should expand into; use a " +
      "{curly} placeholder for anything that varied between the requests.",
    user: [
      temporalPreamble(),
      `Words they already use: ${context.triggers.join(", ") || "(none)"}`,
      `Contacts: ${context.contacts.map((c) => `${c.alias} (${c.fullName})`).join(", ") || "(none)"}`,
      `They said, on separate occasions:\n- ${evidence.join("\n- ")}`,
      `Best current reading of the intent: ${intentSoFar}`,
    ].join("\n"),
    schemaName: "suggested_phrase",
    schema: obj({
      trigger: str("1-2 words"),
      intentTemplate: str("first-person sentence, {curly} for the part that varies"),
      actionType: enumOf(ACTION_TYPES),
      contact: str("contact alias, or empty"),
      channel: str("slack channel, or empty"),
      body: str("message text, or empty"),
      query: str("search query, or empty"),
      app: str("app name, or empty"),
    }),
    timeoutMs: 8_000,
    maxTokens: 300,
  });

  if (!raw?.trigger?.trim() || !raw.intentTemplate?.trim()) return null;

  const trigger = raw.trigger.trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
  const params: Record<string, unknown> =
    raw.actionType === "send_message"
      ? { contact: raw.contact, body: raw.body }
      : raw.actionType === "send_slack"
        ? { channel: raw.channel || raw.contact, text: raw.body }
        : raw.actionType === "web_search"
          ? { query: raw.query || raw.body }
          : raw.actionType === "open_app"
            ? { app: raw.app }
            : { text: raw.body || raw.intentTemplate };

  return { trigger, intentTemplate: raw.intentTemplate.trim(), actionType: raw.actionType, params };
}

/**
 * Without a model: the two words the person keeps repeating are, empirically,
 * the two words they will find easiest to say. Frequency across the cluster,
 * excluding anything already in their vocabulary.
 */
function proposeWithRules(
  evidence: string[],
  intentSoFar: string,
  context: { triggers: string[] },
): Proposal | null {
  const taken = new Set(context.triggers.flatMap((t) => contentTokens(t)));
  const counts = new Map<string, number>();
  for (const line of evidence) {
    for (const token of new Set(contentTokens(line))) {
      if (token.length < 4 || taken.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token);

  if (ranked.length === 0) return null;
  const trigger = ranked.slice(0, 2).join(" ");
  return {
    trigger,
    intentTemplate: intentSoFar,
    actionType: "custom",
    params: { text: intentSoFar },
  };
}

// ---------------------------------------------------------------------------
// acceptSuggestion / dismissSuggestion
// ---------------------------------------------------------------------------

export const acceptSuggestion = action({
  args: { userId: v.id("users"), trigger: v.optional(v.string()) },
  handler: async (
    ctx,
    { userId, trigger },
  ): Promise<{ ok: boolean; speech: string; phraseId?: Id<"phrases"> }> => {
    const suggestion = await ctx.runQuery(internal.learning.findSuggestion, {
      userId,
      trigger,
    });
    if (!suggestion) return { ok: false, speech: "I don't have a word to offer right now." };

    let embedding: number[] = [];
    try {
      embedding = await embedOne(
        phraseDocText(suggestion.proposedTrigger, suggestion.intentTemplate),
      );
    } catch (err) {
      console.error("[shortvoice] acceptSuggestion: embedding failed:", err);
    }

    const phraseId: Id<"phrases"> = await ctx.runMutation(internal.phrases.insertPhrase, {
      userId,
      trigger: suggestion.proposedTrigger,
      normalizedTrigger: normalizeTrigger(suggestion.proposedTrigger),
      embedding,
      intentTemplate: suggestion.intentTemplate,
      actionType: suggestion.actionType,
      params: suggestion.params ?? {},
      slots: [...suggestion.intentTemplate.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      source: "suggested" as const,
    });

    await ctx.runMutation(internal.learning.setSuggestionStatus, {
      id: suggestion._id,
      status: "accepted" as const,
    });

    const speech = learnedPlayback(
      "Done.",
      suggestion.proposedTrigger,
      suggestion.intentTemplate,
    );
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "taught" as const,
      text: speech,
      detail: { trigger: suggestion.proposedTrigger, source: "suggested" },
    });

    return { ok: true, speech, phraseId };
  },
});

export const findSuggestion = internalQuery({
  args: { userId: v.id("users"), trigger: v.optional(v.string()) },
  handler: async (ctx, { userId, trigger }) => {
    const pending = await ctx.db
      .query("suggestions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .order("desc")
      .collect();
    if (pending.length === 0) return null;
    if (!trigger?.trim()) return pending[0];
    const wanted = canonicalKey(trigger);
    return (
      pending.find((s) => canonicalKey(s.proposedTrigger) === wanted) ??
      pending.find((s) => lexicalScore(trigger, s.proposedTrigger) >= 0.5) ??
      pending[0]
    );
  },
});

export const dismissSuggestion = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ ok: boolean; speech: string }> => {
    const suggestion = await ctx.runQuery(internal.learning.findSuggestion, { userId });
    if (!suggestion) return { ok: false, speech: "Nothing to dismiss." };
    await ctx.runMutation(internal.learning.setSuggestionStatus, {
      id: suggestion._id,
      status: "dismissed" as const,
    });
    return { ok: true, speech: "No problem." };
  },
});
