"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Firecrawl, type Document, type SearchResultWeb } from "firecrawl";

const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });

type SearchResultOut = { title: string; url: string; snippet: string };

function toResult(item: SearchResultWeb | Document): SearchResultOut {
  const web = item as SearchResultWeb;
  const doc = item as Document;
  return {
    title: web.title ?? doc.metadata?.title ?? "",
    url: web.url ?? doc.metadata?.url ?? doc.metadata?.sourceURL ?? "",
    snippet: web.description ?? doc.metadata?.description ?? (doc.markdown ?? "").slice(0, 200),
  };
}

function toSpokenSummary(query: string, results: SearchResultOut[]): string {
  const sentence =
    results.length === 0
      ? `I couldn't find anything for ${query}.`
      : `Found ${results.length} result${results.length === 1 ? "" : "s"} for ${query}, top one: ${results[0].title}.`;
  const words = sentence.split(/\s+/);
  return words.length <= 25 ? sentence : words.slice(0, 25).join(" ") + "...";
}

// Demo safety net for the one live-search moment in the script ("mom flight
// friday"). If wifi drops on stage, fall back to the first real result
// instead of hanging. Caches only flight queries -- not general purpose.
const FLIGHT_CACHE_MARKER = "flight_search_cache";

async function cacheFlightResult(
  ctx: ActionCtx,
  query: string,
  summary: string,
  results: SearchResultOut[],
) {
  const user = await ctx.runQuery(api.users.getUser, { handle: "demo" });
  if (!user) return;
  const recent = await ctx.runQuery(api.events.feed, { userId: user._id, limit: 200 });
  if (recent.some((e) => (e.detail as { marker?: string } | undefined)?.marker === FLIGHT_CACHE_MARKER)) {
    return;
  }
  await ctx.runMutation(internal.events.log, {
    userId: user._id,
    kind: "resolved",
    text: `Cached flight search result for demo fallback: ${query}`,
    detail: { marker: FLIGHT_CACHE_MARKER, query, summary, results },
  });
}

type CachedFlightResult = { summary: string; results: SearchResultOut[] };

async function getCachedFlightResult(ctx: ActionCtx): Promise<CachedFlightResult | null> {
  const user = await ctx.runQuery(api.users.getUser, { handle: "demo" });
  if (!user) return null;
  const recent = await ctx.runQuery(api.events.feed, { userId: user._id, limit: 200 });
  const cached = recent.find(
    (e) => (e.detail as { marker?: string } | undefined)?.marker === FLIGHT_CACHE_MARKER,
  );
  return (cached?.detail as CachedFlightResult | undefined) ?? null;
}

type SearchWebResult = { ok: boolean; summary: string; results: SearchResultOut[] };

export const searchWeb = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query, limit }): Promise<SearchWebResult> => {
    const isFlightQuery = /flight/i.test(query);
    try {
      const data = await fc.search(query, {
        limit: limit ?? 5,
        sources: ["web"],
        scrapeOptions: { formats: ["markdown"] },
      });
      const results = (data.web ?? []).map(toResult);
      const summary = toSpokenSummary(query, results);

      if (isFlightQuery) await cacheFlightResult(ctx, query, summary, results);

      return { ok: true, summary, results };
    } catch (err) {
      if (isFlightQuery) {
        const cached = await getCachedFlightResult(ctx);
        if (cached) return { ok: true, summary: cached.summary, results: cached.results };
      }
      return { ok: false, summary: `I couldn't search the web for ${query} right now.`, results: [] };
    }
  },
});

export const scrapePage = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    try {
      const doc = await fc.scrape(url, { formats: ["markdown"] });
      return { ok: true, markdown: doc.markdown ?? "", title: doc.metadata?.title ?? "" };
    } catch (err) {
      return { ok: false, markdown: "", title: "" };
    }
  },
});

export const enrichContact = action({
  args: { userId: v.id("users"), alias: v.string() },
  handler: async (ctx, { userId, alias }): Promise<{ ok: boolean; notes: string }> => {
    const contact = await ctx.runQuery(api.contacts.resolveAlias, { userId, alias });
    if (!contact) return { ok: false, notes: `No contact found for "${alias}".` };

    const search = await ctx.runAction(internal.scrape.searchWeb, {
      query: contact.fullName,
      limit: 3,
    });
    return { ok: search.ok, notes: search.summary };
  },
});
