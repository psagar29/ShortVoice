// ============================================================================
// ShortVoice -- offline embedding fallback  (Person B)
// ============================================================================
// Hackathon venues lose wifi. Keys get rotated at 5:40pm. If OPENAI_API_KEY is
// absent, ShortVoice does not go dark: it embeds with hashed character n-grams
// instead, in the same 1536 dimensions the schema declares, and every other
// part of the pipeline -- vector search, clustering, the bands -- keeps working
// on a purely lexical signal.
//
// It is a strictly worse embedding. It has no idea that "pr" relates to "pull
// request". It IS order-invariant and near-duplicate sensitive, which is enough
// to keep Beats 1-3 on their feet.
//
// THE ONE RULE: the two vector spaces must never mix. The backend is chosen by
// `hasOpenAI()` alone, so a deployment is entirely in one space or the other,
// and switching between them means re-running embeddings:reseedEmbeddings.
// A live API failure does NOT silently fall back here -- resolver.ts degrades
// to lexical ranking instead, which is honest rather than subtly wrong.
// ============================================================================

import { tokens } from "./text";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a(s: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Character trigrams of a padded token: "mom" -> ^mo, mom, om$ */
function trigrams(token: string): string[] {
  const padded = `^${token}$`;
  const out: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  return out;
}

/**
 * Signed feature hashing into `dims` buckets, L2-normalized so the result
 * behaves like a cosine-space embedding.
 *
 * Whole words carry more weight than trigrams; trigrams are what make it
 * tolerant of the odd Deepgram mis-hear.
 */
export function hashEmbedding(text: string, dims = 1536): number[] {
  const vector = new Array<number>(dims).fill(0);
  const words = tokens(text);

  const bump = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    const index = h % dims;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vector[index] += sign * weight;
  };

  for (const word of words) {
    bump(`w:${word}`, 1);
    for (const g of trigrams(word)) bump(`g:${g}`, 0.45);
  }

  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    // Empty input still needs a legal 1536-vector for the index.
    vector[0] = 1;
    return vector;
  }
  for (let i = 0; i < dims; i++) vector[i] /= norm;
  return vector;
}
