// ============================================================================
// ⚠️  TEMPORARY STUB -- PERSON A OWNS THIS FILE (CONTRACT.md §7)
// Delete on integration and take A's version. See PERSON_B_NOTES.md.
// ----------------------------------------------------------------------------
// Person B's executors call internal.scrape.searchWeb for the web_search action
// type. This stub speaks the same shape A promised -- { ok, summary, results }
// -- backed by Firecrawl when FIRECRAWL_API_KEY is set, and returning ok:false
// when it is not, so executors.ts exercises its fallback path either way.
// ============================================================================

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";

const FIRECRAWL = "https://api.firecrawl.dev/v1";

async function firecrawl(path: string, body: unknown): Promise<any | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${FIRECRAWL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const searchWeb = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, { query, limit }) => {
    const json = await firecrawl("/search", { query, limit: limit ?? 5 });
    const rows: any[] = json?.data ?? [];
    if (!json || rows.length === 0) {
      return { ok: false, summary: "", results: [] as { title: string; url: string; snippet: string }[] };
    }
    const results = rows.slice(0, limit ?? 5).map((r) => ({
      title: String(r.title ?? r.url ?? "result"),
      url: String(r.url ?? ""),
      snippet: String(r.description ?? r.snippet ?? "").slice(0, 240),
    }));
    // A promises a pre-summarized string under 25 words, shaped to be read
    // aloud. B passes it straight through -- do not re-summarize downstream.
    const summary = `Top result: ${results[0].title}.`;
    return { ok: true, summary, results };
  },
});

export const scrapePage = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    const json = await firecrawl("/scrape", { url, formats: ["markdown"] });
    if (!json?.data) return { ok: false, markdown: "", title: "" };
    return {
      ok: true,
      markdown: String(json.data.markdown ?? "").slice(0, 20_000),
      title: String(json.data.metadata?.title ?? url),
    };
  },
});

export const enrichContact = action({
  args: { userId: v.id("users"), alias: v.string() },
  handler: async (_ctx, { alias }) => ({ ok: false, notes: `No enrichment for ${alias}.` }),
});
