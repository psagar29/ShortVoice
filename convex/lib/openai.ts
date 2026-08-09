// ============================================================================
// ShortVoice -- model access  (Person B)
// ============================================================================
// Deliberately a thin `fetch` client instead of the `openai` SDK.
//
//   * The SDK forces `"use node"`, and a Node-runtime Convex file cannot export
//     anything but actions -- resolver.ts needs internal mutations beside its
//     actions, and the Node isolate adds cold-start latency we cannot spend
//     against a p50 budget of 1.5s.
//   * The default Convex runtime has `fetch`. That is the entire dependency.
//
// Everything here fails *soft*. A dead key, a 429, a slow model: the caller
// gets `null` (chat) or a thrown error it is expected to catch (embeddings),
// and the resolver degrades to its deterministic lexical path. Nothing on this
// stage is allowed to throw into VoiceOS.
// ============================================================================

import { hashEmbedding } from "./hashembed";

const OPENAI_BASE = "https://api.openai.com/v1";

/** 1536 dims -- locked to EMBEDDING_DIMENSIONS in schema.ts. Do not change. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Overridable per-deployment: `npx convex env set SHORTVOICE_LLM_MODEL ...` */
export function llmModel(): string {
  return process.env.SHORTVOICE_LLM_MODEL || "gpt-4o-mini";
}

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ---------------------------------------------------------------------------
// Embedding cache
// ---------------------------------------------------------------------------
// Isolates are reused between invocations, so a rehearsed demo phrase said
// twice costs one API round trip. Keyed by canonical text, so it is also the
// order-independence guarantee made cheap: "neel later" and "later neel" share
// a cache entry by construction.

const CACHE_LIMIT = 256;
const embedCache = new Map<string, number[]>();

function cacheGet(key: string): number[] | undefined {
  const hit = embedCache.get(key);
  if (hit) {
    embedCache.delete(key); // LRU touch
    embedCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: number[]): void {
  if (embedCache.size >= CACHE_LIMIT) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(key, value);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function post(
  path: string,
  body: unknown,
  { timeoutMs, attempts }: { timeoutMs: number; attempts: number },
): Promise<any> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set in the Convex environment");

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${OPENAI_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) return await res.json();

      const text = await res.text();
      // 4xx other than rate-limiting is a bug in our request; retrying wastes
      // the only budget we have.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
      }
      lastError = new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.startsWith("OpenAI 4")) throw err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 100));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** Embed one string. Throws if the model is unreachable -- callers degrade. */
export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedMany([text]);
  return v;
}

/** Which embedding space this deployment is currently in. */
export function embeddingBackend(): "openai" | "hashed-fallback" {
  return hasOpenAI() ? "openai" : "hashed-fallback";
}

/**
 * Batched embeddings, cache-aware. Only the cache misses hit the network, and
 * the results are returned in the caller's original order.
 *
 * With no API key configured this returns hashed n-gram vectors instead (see
 * lib/hashembed.ts) so the whole pipeline still runs offline. A key that is
 * present but failing does NOT fall back -- mixing two vector spaces in one
 * index is worse than degrading to lexical ranking, which resolver.ts does.
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!hasOpenAI()) return texts.map((t) => hashEmbedding(t));

  const out: (number[] | undefined)[] = texts.map((t) => cacheGet(t));
  const missing = texts.map((t, i) => ({ t, i })).filter(({ i }) => !out[i]);
  if (missing.length === 0) return out as number[][];

  // OpenAI caps batch size; 96 keeps a reseed of a large lexicon in 1-2 calls.
  for (let start = 0; start < missing.length; start += 96) {
    const chunk = missing.slice(start, start + 96);
    const json = await post(
      "/embeddings",
      { model: EMBEDDING_MODEL, input: chunk.map((c) => c.t) },
      { timeoutMs: 10_000, attempts: 3 },
    );
    const data = json.data as { index: number; embedding: number[] }[];
    for (const row of data) {
      const target = chunk[row.index];
      cacheSet(target.t, row.embedding);
      out[target.i] = row.embedding;
    }
  }
  return out as number[][];
}

// ---------------------------------------------------------------------------
// Structured chat
// ---------------------------------------------------------------------------

export type JsonSchema = Record<string, unknown>;

/**
 * One structured-output call. Returns `null` on any failure so the caller can
 * fall back deterministically instead of exploding mid-demo.
 *
 * `temperature: 0` plus a fixed `seed`: two identical utterances -- including
 * "neel later" and "later neel", which canonicalize to the same prompt -- must
 * produce the same words out of the speaker.
 */
export async function chatJSON<T>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: JsonSchema;
  timeoutMs?: number;
  attempts?: number;
  maxTokens?: number;
}): Promise<T | null> {
  if (!hasOpenAI()) return null;
  try {
    const json = await post(
      "/chat/completions",
      {
        model: llmModel(),
        temperature: 0,
        seed: 7,
        max_tokens: opts.maxTokens ?? 400,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: opts.schemaName,
            strict: true,
            schema: opts.schema,
          },
        },
      },
      { timeoutMs: opts.timeoutMs ?? 6_000, attempts: opts.attempts ?? 2 },
    );
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return JSON.parse(content) as T;
  } catch (err) {
    console.error(`[shortvoice] chatJSON(${opts.schemaName}) failed:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schema helpers -- OpenAI strict mode requires every key listed in `required`
// and additionalProperties:false on every object.
// ---------------------------------------------------------------------------

export function obj(
  properties: Record<string, JsonSchema>,
  required = Object.keys(properties),
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export const str = (description?: string): JsonSchema =>
  description ? { type: "string", description } : { type: "string" };

export const num = (description?: string): JsonSchema =>
  description ? { type: "number", description } : { type: "number" };

export const bool = (description?: string): JsonSchema =>
  description ? { type: "boolean", description } : { type: "boolean" };

export const arr = (items: JsonSchema, description?: string): JsonSchema =>
  description ? { type: "array", items, description } : { type: "array", items };

export const enumOf = (values: readonly string[], description?: string): JsonSchema =>
  description ? { type: "string", enum: [...values], description } : { type: "string", enum: [...values] };
