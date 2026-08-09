// ============================================================================
// ShortVoice -- THE RESOLVER  (Person B)  · CONTRACT.md §6
// ============================================================================
// Three words in, twenty words of intent out.
//
//   embed(canonical utterance)
//     -> ctx.vectorSearch over this person's lexicon
//       -> hybrid rerank (dense + lexical + usage prior)
//         -> STRONG  act now, no model in the loop
//            WEAK    one model call adjudicates the shortlist
//            COLD    one model call expands from personal context alone
//              -> pendingAction (nothing fires without a "yes")
//
// The answer to "isn't this just macros?" is structural, not rhetorical:
//   * order independence comes from canonical retrieval keys (lib/text.ts),
//     so "neel later" and "later neel" produce the identical vector;
//   * slot filling comes from set-difference leftovers (lib/slots.ts), so
//     "neel tomorrow" is the same phrase with a different filler;
//   * cold resolution uses contacts, clock and history, so "mom flight friday"
//     works before anybody teaches it.
//
// There is no `if (trigger === utterance)` in this file. There is not even a
// code path that could contain one.
// ============================================================================

import { action, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import {
  arr,
  bool,
  chatJSON,
  embedOne,
  enumOf,
  hasOpenAI,
  num,
  obj,
  str,
} from "./lib/openai";
import { band, rank, scoreCandidate, type Scored } from "./lib/rank";
import { fillParams, renderTemplate } from "./lib/render";
import { confirmationSpeech, executedSpeech } from "./lib/speech";
import { groundWhen, temporalPreamble } from "./lib/time";
import { retrievalKey, stripInvocation } from "./lib/text";
import {
  attachContact,
  deterministicSlots,
  slotNamesFor,
  type ContactLite,
} from "./lib/slots";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mirrors the `actionType` union in schema.ts. Keep in sync. */
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

/** Everything Convex can do itself. The rest is handed to Person C's Mac. */
const NETWORK_ACTIONS = new Set<ActionType>(["send_slack", "web_search"]);

type PhraseLite = {
  _id: Id<"phrases">;
  trigger: string;
  intentTemplate: string;
  actionType: ActionType;
  params: Record<string, unknown>;
  slots: string[];
  useCount: number;
  lastUsedAt: number | undefined;
  hasEmbedding: boolean;
};

export type ResolveResult =
  | {
      kind: "confirm";
      pendingId: Id<"pendingActions">;
      confirmationSpeech: string;
      resolvedIntent: string;
      matchScore: number;
      actionType: ActionType;
      phraseId?: Id<"phrases">;
      band: string;
      latencyMs: number;
    }
  | { kind: "clarify"; speech: string; band: string; latencyMs: number }
  | { kind: "unknown"; speech: string; band: string; latencyMs: number };

export type ExecuteResult = {
  ok: boolean;
  speech: string;
  /**
   * CONTRACT POINT WITH PERSON C (PERSON_B_NOTES.md).
   * Present only for OS-level actions Convex physically cannot perform.
   * The MCP server executes it on the Mac, then calls resolver:reportLocalResult.
   */
  localAction?: {
    pendingId: Id<"pendingActions">;
    actionType: ActionType;
    params: Record<string, unknown>;
    resolvedIntent: string;
  };
};

// ---------------------------------------------------------------------------
// Context / persistence helpers (internal)
// ---------------------------------------------------------------------------

/**
 * One round trip for everything the resolver needs to think with.
 * Embeddings are stripped -- shipping 50 x 1536 floats through an action
 * boundary costs more than the vector search itself.
 */
export const resolveContext = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const [contacts, phrases, recent] = await Promise.all([
      ctx.db
        .query("contacts")
        .withIndex("by_user_alias", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("phrases")
        .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
        .collect(),
      ctx.db
        .query("utterances")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(5),
    ]);

    return {
      contacts: contacts.map((c) => ({
        alias: c.alias,
        fullName: c.fullName,
        phone: c.phone,
        slackId: c.slackId,
        email: c.email,
      })),
      phrases: phrases.map((p) => ({
        _id: p._id,
        trigger: p.trigger,
        intentTemplate: p.intentTemplate,
        actionType: p.actionType,
        params: (p.params ?? {}) as Record<string, unknown>,
        slots: p.slots,
        useCount: p.useCount,
        lastUsedAt: p.lastUsedAt,
        hasEmbedding: p.embedding.length > 0,
      })),
      recent: recent.map((u) => u.raw),
    };
  },
});

export const recordUtterance = internalMutation({
  args: {
    userId: v.id("users"),
    raw: v.string(),
    resolvedIntent: v.optional(v.string()),
    matchedPhraseId: v.optional(v.id("phrases")),
    matchScore: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    outcome: v.union(
      v.literal("matched"),
      v.literal("expanded"),
      v.literal("unresolved"),
      v.literal("taught"),
    ),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("utterances", { ...args, createdAt: Date.now() }),
});

/** Used by convex/crons.ts: a stale "yes" must not fire yesterday's action. */
export const sweepStalePending = internalMutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, { olderThanMs }) => {
    const cutoff = Date.now() - olderThanMs;
    const rows = await ctx.db.query("pendingActions").collect();
    let cancelled = 0;
    for (const row of rows) {
      if (row.status === "awaiting" && row.createdAt < cutoff) {
        await ctx.db.patch(row._id, { status: "cancelled", resolvedAt: Date.now() });
        cancelled++;
      }
    }
    return { cancelled };
  },
});

/**
 * Safety net for the local-action handoff: if Person C's MCP server never
 * reports back, close the row rather than leaving the dashboard stuck on
 * "confirmed" forever. The result string says plainly that it was assumed.
 */
export const assumeLocalExecuted = internalMutation({
  args: { pendingId: v.id("pendingActions") },
  handler: async (ctx, { pendingId }) => {
    const row = await ctx.db.get(pendingId);
    if (!row || row.status !== "confirmed") return;
    await ctx.db.patch(pendingId, {
      status: "executed",
      result: "assumed executed (no callback from the MCP server)",
      resolvedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

export const resolve = action({
  args: { userId: v.id("users"), utterance: v.string() },
  handler: async (ctx, { userId, utterance }): Promise<ResolveResult> => {
    const t0 = Date.now();
    const spoken = stripInvocation(utterance);
    const elapsed = () => Date.now() - t0;

    if (spoken.replace(/\s/g, "").length === 0) {
      return { kind: "unknown", speech: "I didn't catch that.", band: "cold", latencyMs: elapsed() };
    }

    // Embedding, context and the "heard" event all start at once. The embedding
    // is the long pole; everything else hides behind it.
    const key = retrievalKey(spoken);
    const [vector, context] = await Promise.all([
      embedOne(key).catch((err) => {
        console.error("[shortvoice] embedding failed, falling back to lexical:", err);
        return null;
      }),
      ctx.runQuery(internal.resolver.resolveContext, { userId }),
      ctx.runMutation(internal.events.log, {
        userId,
        kind: "heard" as const,
        text: spoken,
      }),
    ]);

    const contacts: ContactLite[] = context.contacts.map((c) => ({
      alias: c.alias,
      fullName: c.fullName,
      phone: c.phone,
      slackId: c.slackId,
      email: c.email,
    }));

    // -- retrieval ---------------------------------------------------------
    let scored: Scored<PhraseLite>[] = [];
    if (vector) {
      const hits = await ctx.vectorSearch("phrases", "by_embedding", {
        vector,
        limit: 8,
        // Vector-search filters are equality-only and cannot be AND-ed
        // (CONTRACT.md §6), so `active` is filtered in JS below.
        filter: (q) => q.eq("userId", userId),
      });
      const byId = new Map<string, PhraseLite>(
        context.phrases.map((p) => [p._id as string, p]),
      );
      for (const hit of hits) {
        const doc = byId.get(hit._id as string);
        if (doc) scored.push(scoreCandidate<PhraseLite>(spoken, doc, hit._score));
      }

      // A phrase taught seconds ago whose embedding call failed is invisible to
      // vector search. Beat 2 dies quietly if we let that stand, so unembedded
      // phrases are scored lexically and thrown into the same ranking.
      const seen = new Set(scored.map((s) => s.doc._id as string));
      for (const p of context.phrases) {
        if (!p.hasEmbedding && !seen.has(p._id as string)) {
          scored.push(scoreCandidate<PhraseLite>(spoken, p, 0.5));
        }
      }
    } else {
      // No embedding (missing key, API down): the lexicon is small and the
      // lexical signal alone still resolves an exact or near-exact fragment.
      scored = context.phrases.map((p) => scoreCandidate<PhraseLite>(spoken, p, 0.55));
    }
    scored = rank(scored);
    const which = band(scored);
    const top = scored[0];

    // -- STRONG ------------------------------------------------------------
    if (which === "strong" && top) {
      const filled = await fillSlots(top.doc, spoken, contacts, context.recent);
      const outcome = buildFromPhrase(top.doc, filled, contacts);
      return await commitConfirm(ctx, {
        userId,
        spoken,
        vector,
        phraseId: top.doc._id,
        score: top.score,
        band: "strong",
        t0,
        ...outcome,
      });
    }

    // -- WEAK --------------------------------------------------------------
    if (which === "weak" && top) {
      const shortlist = scored.slice(0, 3);
      const verdict = await adjudicate(spoken, shortlist, contacts, context.recent);

      if (verdict?.decision === "match") {
        const chosen = shortlist[verdict.candidateIndex] ?? top;
        const filled = await fillSlots(
          chosen.doc,
          spoken,
          contacts,
          context.recent,
          verdict.slots,
        );
        const outcome = buildFromPhrase(chosen.doc, filled, contacts);
        return await commitConfirm(ctx, {
          userId,
          spoken,
          vector,
          phraseId: chosen.doc._id,
          score: chosen.score,
          band: "weak",
          t0,
          ...outcome,
        });
      }

      if (verdict?.decision === "ambiguous" || !hasOpenAI() || verdict === null) {
        const question =
          verdict?.question?.trim() ||
          deterministicClarify(shortlist);
        if (question) {
          await Promise.all([
            ctx.runMutation(internal.resolver.recordUtterance, {
              userId,
              raw: spoken,
              matchScore: top.score,
              embedding: vector ?? undefined,
              outcome: "unresolved" as const,
            }),
            ctx.runMutation(internal.events.log, {
              userId,
              kind: "resolved" as const,
              text: question,
              detail: { band: "weak", ambiguous: true, score: top.score },
              latencyMs: elapsed(),
            }),
          ]);
          await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId });
          return { kind: "clarify", speech: question, band: "weak", latencyMs: elapsed() };
        }
      }
      // decision "none" falls through to the cold path on purpose.
    }

    // -- COLD --------------------------------------------------------------
    const expansion = await coldExpand(spoken, contacts, context.recent, context.phrases);
    if (expansion) {
      return await commitConfirm(ctx, {
        userId,
        spoken,
        vector,
        phraseId: undefined,
        score: top?.score ?? 0,
        band: "cold",
        t0,
        ...expansion,
      });
    }

    const speech =
      "I don't have a word for that yet. Tell me what it should mean and I'll remember it.";
    await Promise.all([
      ctx.runMutation(internal.resolver.recordUtterance, {
        userId,
        raw: spoken,
        matchScore: top?.score,
        embedding: vector ?? undefined,
        outcome: "unresolved" as const,
      }),
      ctx.runMutation(internal.events.log, {
        userId,
        kind: "resolved" as const,
        text: speech,
        detail: { band: "cold", understood: false, score: top?.score ?? 0 },
        latencyMs: elapsed(),
      }),
    ]);
    await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId });
    return { kind: "unknown", speech, band: "cold", latencyMs: elapsed() };
  },
});

// ---------------------------------------------------------------------------
// Intent construction
// ---------------------------------------------------------------------------

type BuiltIntent = {
  resolvedIntent: string;
  speech: string;
  actionType: ActionType;
  params: Record<string, unknown>;
};

/** Render a taught template into a concrete intent + the line we speak. */
function buildFromPhrase(
  phrase: PhraseLite,
  slots: Record<string, string>,
  contacts: ContactLite[],
): BuiltIntent {
  const resolvedIntent = renderTemplate(phrase.intentTemplate, slots);
  let params = fillParams(phrase.params ?? {}, slots) as Record<string, unknown>;
  params = attachContact(phrase.actionType, params, contacts);

  // Ride-along machine-readable timestamp for whatever executes this.
  for (const [name, value] of Object.entries(slots)) {
    const grounded = groundWhen(value);
    if (grounded) {
      params[`${name}Iso`] = grounded.iso;
      break;
    }
  }

  return {
    resolvedIntent,
    speech: confirmationSpeech({ intent: resolvedIntent, actionType: phrase.actionType }),
    actionType: phrase.actionType,
    params,
  };
}

/**
 * Deterministic slot fill first; one model call only for what is left over and
 * genuinely underdetermined. On the demo's strong path this returns without
 * touching the network.
 */
async function fillSlots(
  phrase: PhraseLite,
  utterance: string,
  contacts: ContactLite[],
  recent: string[],
  llmSlots?: { name: string; value: string }[],
): Promise<Record<string, string>> {
  const det = deterministicSlots(phrase, utterance, contacts);
  const slots = { ...det.slots };

  for (const s of llmSlots ?? []) {
    if (s.value?.trim()) slots[s.name] = s.value.trim();
  }

  const missing = slotNamesFor(phrase).filter((n) => !slots[n]?.trim());
  if (missing.length === 0 || det.spare.length === 0 || !hasOpenAI()) return slots;

  const filled = await chatJSON<{ slots: { name: string; value: string }[] }>({
    system:
      "You fill template slots for a personal voice shorthand system. " +
      "Use ONLY the leftover words the person actually said. " +
      "If a slot cannot be filled from them, return an empty string for it. " +
      "Values are short spoken fragments, not sentences.",
    user: [
      temporalPreamble(),
      `Taught phrase: "${phrase.trigger}" -> "${phrase.intentTemplate}"`,
      `They said: "${utterance}"`,
      `Leftover words: ${det.spare.join(", ") || "(none)"}`,
      `Slots to fill: ${missing.join(", ")}`,
      recent.length ? `Recent requests: ${recent.slice(0, 3).join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "slot_fill",
    schema: obj({
      slots: arr(obj({ name: str(), value: str() })),
    }),
    timeoutMs: 4_000,
    maxTokens: 200,
  });

  for (const s of filled?.slots ?? []) {
    if (s.value?.trim() && missing.includes(s.name)) slots[s.name] = s.value.trim();
  }
  return slots;
}

// ---------------------------------------------------------------------------
// WEAK band: adjudication
// ---------------------------------------------------------------------------

type Verdict = {
  decision: "match" | "ambiguous" | "none";
  candidateIndex: number;
  slots: { name: string; value: string }[];
  question: string;
};

async function adjudicate(
  utterance: string,
  shortlist: Scored<PhraseLite>[],
  contacts: ContactLite[],
  recent: string[],
): Promise<Verdict | null> {
  if (shortlist.length === 0) return null;

  const candidates = shortlist
    .map(
      (c, i) =>
        `${i}. trigger "${c.doc.trigger}" -> "${c.doc.intentTemplate}" ` +
        `(action ${c.doc.actionType}, slots [${c.doc.slots.join(", ")}], confidence ${c.score.toFixed(2)})`,
    )
    .join("\n");

  return await chatJSON<Verdict>({
    system:
      "You are the resolver for ShortVoice, a personal shorthand for someone who " +
      "speaks in fragments. Given a fragment and the phrases this person has taught, " +
      "decide which taught phrase they meant. " +
      "Choose 'match' only if one candidate is clearly right; fill its slots from the " +
      "words they said that the trigger does not already account for. " +
      "Choose 'ambiguous' if two candidates are genuinely plausible, and write a " +
      "single short spoken question (under 12 words) that would settle it. " +
      "Choose 'none' if none of them fit. Never invent a recipient.",
    user: [
      temporalPreamble(),
      `Contacts: ${contacts.map((c) => `${c.alias} (${c.fullName})`).join(", ") || "(none)"}`,
      recent.length ? `Their last requests: ${recent.slice(0, 5).join(" | ")}` : "",
      `Taught phrases in play:\n${candidates}`,
      `They just said: "${utterance}"`,
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "adjudication",
    schema: obj({
      decision: enumOf(["match", "ambiguous", "none"]),
      candidateIndex: num("index of the chosen candidate, or -1"),
      slots: arr(obj({ name: str(), value: str() })),
      question: str("spoken clarifying question, or empty string"),
    }),
    timeoutMs: 5_000,
    maxTokens: 300,
  });
}

/** Clarify without a model: name the two things it could have been. */
function deterministicClarify(shortlist: Scored<PhraseLite>[]): string {
  if (shortlist.length >= 2) {
    return `Did you mean "${shortlist[0].doc.trigger}" or "${shortlist[1].doc.trigger}"?`;
  }
  if (shortlist.length === 1) {
    return `Did you mean "${shortlist[0].doc.trigger}"?`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// COLD band: expansion from personal context alone
// ---------------------------------------------------------------------------

type ColdExpansion = {
  understood: boolean;
  actionType: ActionType;
  intent: string;
  contact: string;
  channel: string;
  body: string;
  query: string;
  app: string;
  minutes: string;
  when: string;
};

async function coldExpand(
  utterance: string,
  contacts: ContactLite[],
  recent: string[],
  vocabulary: PhraseLite[],
): Promise<BuiltIntent | null> {
  const raw = await chatJSON<ColdExpansion>({
    system:
      "You are ShortVoice. Someone who speaks in fragments just said something that " +
      "matches nothing they have taught you. Expand it into ONE concrete intent using " +
      "their contacts, the current date and time, and what they have been asking for " +
      "lately. Prefer the most ordinary reading. Write `intent` in the first person, " +
      "as one sentence under 18 words, naming the actual recipient and payload. " +
      "Set understood=false only if the fragment is genuinely meaningless to you. " +
      "Leave unused fields as empty strings.",
    user: [
      temporalPreamble(),
      `Contacts: ${contacts.map((c) => `${c.alias} (${c.fullName})`).join(", ") || "(none)"}`,
      `Words they already taught: ${vocabulary.map((p) => p.trigger).join(", ") || "(none)"}`,
      recent.length ? `Their last requests: ${recent.slice(0, 5).join(" | ")}` : "",
      `They just said: "${utterance}"`,
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "cold_expansion",
    schema: obj({
      understood: bool(),
      actionType: enumOf(ACTION_TYPES),
      intent: str("first-person sentence, under 18 words"),
      contact: str("contact alias, or empty"),
      channel: str("slack channel, or empty"),
      body: str("message text / event title, or empty"),
      query: str("web search query, or empty"),
      app: str("application name, or empty"),
      minutes: str("duration in minutes, or empty"),
      when: str("spoken time fragment, or empty"),
    }),
    timeoutMs: 6_000,
    maxTokens: 300,
  });

  if (!raw || !raw.understood || !raw.intent?.trim()) return null;

  let params: Record<string, unknown>;
  switch (raw.actionType) {
    case "send_message":
      params = { contact: raw.contact, body: raw.body };
      break;
    case "send_slack":
      params = { channel: raw.channel || raw.contact, text: raw.body };
      break;
    case "web_search":
      params = { query: raw.query || raw.intent };
      break;
    case "create_event":
      params = { title: raw.body || raw.intent, when: raw.when };
      break;
    case "open_app":
      params = { app: raw.app };
      break;
    case "focus_mode":
      params = { minutes: Number(raw.minutes) || 30 };
      break;
    case "read_screen":
      params = {};
      break;
    default:
      params = { text: raw.intent };
  }

  if (raw.when) {
    const grounded = groundWhen(raw.when);
    if (grounded) params.whenIso = grounded.iso;
  }
  params = attachContact(raw.actionType, params, contacts);

  return {
    resolvedIntent: raw.intent.trim(),
    // Hedged, because nothing here was taught: honesty about confidence is the
    // difference between a system that knows what it knows and one that bluffs.
    speech: confirmationSpeech({
      intent: raw.intent.trim(),
      actionType: raw.actionType,
      hedged: true,
    }),
    actionType: raw.actionType,
    params,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

async function commitConfirm(
  ctx: ActionCtx,
  opts: {
    userId: Id<"users">;
    spoken: string;
    vector: number[] | null;
    phraseId?: Id<"phrases">;
    score: number;
    band: string;
    t0: number;
    resolvedIntent: string;
    speech: string;
    actionType: ActionType;
    params: Record<string, unknown>;
  },
): Promise<ResolveResult> {
  const pendingId: Id<"pendingActions"> = await ctx.runMutation(
    internal.pending.createPending,
    {
      userId: opts.userId,
      utterance: opts.spoken,
      phraseId: opts.phraseId,
      resolvedIntent: opts.resolvedIntent,
      confirmationSpeech: opts.speech,
      actionType: opts.actionType,
      params: opts.params,
      matchScore: opts.score,
    },
  );

  const latencyMs = Date.now() - opts.t0;

  await Promise.all([
    ctx.runMutation(internal.resolver.recordUtterance, {
      userId: opts.userId,
      raw: opts.spoken,
      resolvedIntent: opts.resolvedIntent,
      matchedPhraseId: opts.phraseId,
      matchScore: opts.score,
      embedding: opts.vector ?? undefined,
      outcome: opts.phraseId ? ("matched" as const) : ("expanded" as const),
    }),
    ctx.runMutation(internal.events.log, {
      userId: opts.userId,
      kind: "resolved" as const,
      text: opts.resolvedIntent,
      detail: {
        band: opts.band,
        score: Number(opts.score.toFixed(3)),
        actionType: opts.actionType,
        utterance: opts.spoken,
      },
      latencyMs,
    }),
    ctx.runMutation(internal.events.log, {
      userId: opts.userId,
      kind: "awaiting" as const,
      text: opts.speech,
      detail: { pendingId },
    }),
  ]);

  // Learning is never on the critical path.
  await ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId: opts.userId });

  return {
    kind: "confirm",
    pendingId,
    confirmationSpeech: opts.speech,
    resolvedIntent: opts.resolvedIntent,
    matchScore: opts.score,
    actionType: opts.actionType,
    phraseId: opts.phraseId,
    band: opts.band,
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Confirmation state machine
// ---------------------------------------------------------------------------

export const executeConfirmed = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<ExecuteResult> => {
    const pending = await ctx.runQuery(api.pending.getAwaiting, { userId });
    if (!pending) return { ok: false, speech: "Nothing to confirm." };

    const actionType = pending.actionType as ActionType;
    const params = (pending.params ?? {}) as Record<string, unknown>;

    await ctx.runMutation(internal.pending.setStatus, {
      id: pending._id,
      status: "confirmed" as const,
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "confirmed" as const,
      text: pending.resolvedIntent,
      detail: { pendingId: pending._id, actionType },
    });
    if (pending.phraseId) {
      await ctx.runMutation(internal.phrases.bumpUsage, { phraseId: pending.phraseId });
    }

    if (NETWORK_ACTIONS.has(actionType)) {
      const result = await ctx.runAction(internal.executors.runNetworkAction, {
        actionType,
        params,
      });
      await ctx.runMutation(internal.pending.setStatus, {
        id: pending._id,
        status: result.ok ? ("executed" as const) : ("failed" as const),
        result: result.detail,
      });
      await ctx.runMutation(internal.events.log, {
        userId,
        kind: result.ok ? ("executed" as const) : ("error" as const),
        text: result.detail,
        detail: { pendingId: pending._id, actionType },
      });
      return {
        ok: result.ok,
        speech: result.ok
          ? executedSpeech(actionType, result.detail)
          : `That didn't go through. ${result.detail}`,
      };
    }

    // Local action: Convex cannot run AppleScript. Hand it to Person C's MCP
    // server and let it report back; close the row ourselves if it never does.
    await ctx.scheduler.runAfter(10_000, internal.resolver.assumeLocalExecuted, {
      pendingId: pending._id,
    });
    return {
      ok: true,
      speech: executedSpeech(actionType),
      localAction: {
        pendingId: pending._id,
        actionType,
        params,
        resolvedIntent: pending.resolvedIntent,
      },
    };
  },
});

export const cancelPending = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ ok: boolean; speech: string }> => {
    const pending = await ctx.runQuery(api.pending.getAwaiting, { userId });
    if (!pending) return { ok: false, speech: "Nothing to cancel." };
    await ctx.runMutation(internal.pending.setStatus, {
      id: pending._id,
      status: "cancelled" as const,
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: "cancelled" as const,
      text: pending.resolvedIntent,
      detail: { pendingId: pending._id },
    });
    return { ok: true, speech: "Cancelled." };
  },
});

/**
 * CONTRACT POINT WITH PERSON C.
 * After the MCP server performs a `localAction` on the Mac it calls this, so
 * the confirmation state machine closes honestly and Person D's feed shows the
 * real outcome instead of an assumption.
 */
export const reportLocalResult = action({
  args: {
    userId: v.id("users"),
    pendingId: v.id("pendingActions"),
    ok: v.boolean(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { userId, pendingId, ok, detail }): Promise<{ ok: boolean }> => {
    await ctx.runMutation(internal.pending.setStatus, {
      id: pendingId,
      status: ok ? ("executed" as const) : ("failed" as const),
      result: detail ?? (ok ? "done" : "failed on the Mac"),
    });
    await ctx.runMutation(internal.events.log, {
      userId,
      kind: ok ? ("executed" as const) : ("error" as const),
      text: detail ?? (ok ? "Done." : "That failed on the Mac."),
      detail: { pendingId },
    });
    return { ok: true };
  },
});
