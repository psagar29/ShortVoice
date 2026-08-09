// ============================================================================
// ShortVoice -- embeddings  (Person B)  · CONTRACT.md §5
// ============================================================================
// NOTE ON RUNTIME (deviation from the task brief, deliberate):
// the brief sketched this file with `"use node"` + the OpenAI SDK. It does not
// use either, because:
//
//   1. a `"use node"` file cannot export queries or mutations, and the reseed
//      path needs both beside its action;
//   2. the Node isolate costs cold-start milliseconds on a path that sits
//      inside a 1.5s p50 budget;
//   3. `fetch` in the default runtime is the same HTTP call with less weight.
//
// The exported surface is exactly what CONTRACT.md §5 promises:
//   embed(text) -> number[1536]
// plus embedBatch and reseedEmbeddings, which Person A must run after every
// `seed:seedDemo` (mutations cannot call APIs, so seeded rows land empty).
// ============================================================================

import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./schema";
import { embedMany, embedOne, embeddingBackend } from "./lib/openai";
import { phraseDocText, retrievalKey } from "./lib/text";

export const embed = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => await embedOne(text),
});

export const embedBatch = internalAction({
  args: { texts: v.array(v.string()) },
  handler: async (_ctx, { texts }) => await embedMany(texts),
});

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export const phrasesNeedingEmbedding = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("phrases").collect();
    return rows
      .filter((r) => r.embedding.length !== EMBEDDING_DIMENSIONS)
      .map((r) => ({ id: r._id, text: phraseDocText(r.trigger, r.intentTemplate) }));
  },
});

export const utterancesNeedingEmbedding = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("utterances").collect();
    return rows
      .filter((r) => !r.embedding || r.embedding.length !== EMBEDDING_DIMENSIONS)
      .map((r) => ({ id: r._id, text: retrievalKey(r.raw) }));
  },
});

export const patchPhraseEmbedding = internalMutation({
  args: { id: v.id("phrases"), embedding: v.array(v.float64()) },
  handler: async (ctx, { id, embedding }) => await ctx.db.patch(id, { embedding }),
});

export const patchUtteranceEmbedding = internalMutation({
  args: { id: v.id("utterances"), embedding: v.array(v.float64()) },
  handler: async (ctx, { id, embedding }) => await ctx.db.patch(id, { embedding }),
});

/**
 * Fill in every missing vector, for phrases AND utterances.
 *
 * Run after every reseed:  npx convex run embeddings:reseedEmbeddings
 *
 * Utterances matter as much as phrases here -- learning.maybeSuggest clusters
 * over `utterances.by_embedding`, so an unembedded seed history means Beat 3
 * silently never fires.
 */
export const reseedEmbeddings = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; phrases: number; utterances: number; backend: string }> => {
    const phraseRows = await ctx.runQuery(internal.embeddings.phrasesNeedingEmbedding, {});
    if (phraseRows.length > 0) {
      const vectors = await embedMany(phraseRows.map((r) => r.text));
      await Promise.all(
        phraseRows.map((r, i) =>
          ctx.runMutation(internal.embeddings.patchPhraseEmbedding, {
            id: r.id,
            embedding: vectors[i],
          }),
        ),
      );
    }

    const utteranceRows = await ctx.runQuery(internal.embeddings.utterancesNeedingEmbedding, {});
    if (utteranceRows.length > 0) {
      const vectors = await embedMany(utteranceRows.map((r) => r.text));
      await Promise.all(
        utteranceRows.map((r, i) =>
          ctx.runMutation(internal.embeddings.patchUtteranceEmbedding, {
            id: r.id,
            embedding: vectors[i],
          }),
        ),
      );
    }

    return {
      ok: true,
      phrases: phraseRows.length,
      utterances: utteranceRows.length,
      backend: embeddingBackend(),
    };
  },
});
