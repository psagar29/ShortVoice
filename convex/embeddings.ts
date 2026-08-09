// ============================================================================
// TEMP STUB -- Person B owns this file. See CONTRACT.md section 5.
// Landed on person-d/deepgram-dashboard only so branch D is runnable.
// Person E: revert the "TEMP: stub A/B surface" commit at integration.
// ============================================================================
//
// There is no OPENAI_API_KEY on this branch. `schema.ts` requires every phrase
// to carry a 1536-float vector, so we synthesise a deterministic one from the
// text's characters. It keeps the frozen schema and the vector index valid.
//
// It is NOT semantic. Do not vector-search against it and expect meaning.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { EMBEDDING_DIMENSIONS } from "./schema";

/** Deterministic, unit-length, and meaningless. A placeholder shaped like a vector. */
export function fakeEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    const slot = Math.abs(h) % EMBEDDING_DIMENSIONS;
    vec[slot] += 1;
  }
  let sumSquares = 0;
  for (const x of vec) sumSquares += x * x;
  const norm = Math.sqrt(sumSquares) || 1;
  return vec.map((x) => x / norm);
}

export const embed = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => fakeEmbedding(text),
});
