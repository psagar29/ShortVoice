# PERSON A — Convex Core: schema, CRUD, state, seed data

> **Paste this whole file into your AI agent as the task prompt.**
> Repo: `https://github.com/psagar29/ShortVoice` · Branch: **`person-a/convex-core`**

---

## Project context

We are building **ShortVoice** at the VoiceOS hackathon (demos 6pm today).

**The pitch:** *"VoiceOS understands language. ShortVoice helps it understand **your** language."*

A person with limited speech — or anyone who repeats the same workflows — says three words
instead of twenty. ShortVoice expands the fragment into full intent using a personal vocabulary
they taught it, speaks back what it understood, and executes on confirmation.

```
"Team. PR. Tonight."
   → 🔊 "Tell your project team you'll review the latest PR tonight?"
   → "Yes."  → sent.
```

Stack: **VoiceOS** (speech + agent) → **MCP server** (thin, local) → **Convex** (all state and
intelligence) → **Deepgram** (ShortVoice's own confirmation voice + keyterm-primed listening).

**Read `CONTRACT.md` in the repo root before writing a line of code.** It is frozen.

---

## You are the foundation. Everyone is blocked on you.

Persons B, C, and D all call your functions. **Your first 45 minutes are the critical path for
the entire team.** Priority order is absolute:

1. Deploy the schema so B can start (**target: 20 minutes**)
2. Ship stub-quality CRUD so B/C/D can call *something* (**target: 45 minutes**)
3. Then make it good.

Announce in the group chat the moment the schema is deployed. Announce again when CRUD is live.

---

## Setup

```bash
git clone https://github.com/psagar29/ShortVoice.git
cd ShortVoice
git checkout -b person-a/convex-core
npm install
cp .env.example .env

# Link to OUR shared deployment (do not create a new one)
npx convex dev
# When prompted, choose the EXISTING deployment: reminiscent-anteater-318
```

You are **one of only two people** allowed to run `npx convex dev` (you and Person B).
C and D consume your deployed functions. Coordinate with B before restarting it.

Set the shared secrets once, early — B needs `OPENAI_API_KEY` immediately:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set DEEPGRAM_API_KEY ...
npx convex env list
```

---

## Files you own

```
convex/lib/normalize.ts     ← everyone imports this, ship it first
convex/users.ts
convex/phrases.ts
convex/contacts.ts
convex/pending.ts
convex/events.ts
convex/seed.ts
convex/scrape.ts            ← Firecrawl (Task 8)
```

**Do not touch** `convex/schema.ts` (frozen), `convex/resolver.ts`, `convex/teach.ts`,
`convex/learning.ts`, `convex/embeddings.ts`, `convex/executors.ts` (Person B),
`convex/http.ts` or `web/**` (Person D), `mcp/**` (Person C), or `package.json`.

---

## Task 1 — `convex/lib/normalize.ts` (ship in the first 10 minutes)

Order-independence is a core product property: `"neel later"` and `"later neel"` must be the
same phrase. This one function is how we get it.

```ts
/** Lowercase, strip punctuation, dedupe + sort tokens. "Later, Neel!" -> "later neel" */
export function normalizeTrigger(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Tokens in `utterance` not accounted for by `trigger` — the raw material for slot filling. */
export function leftoverTokens(utterance: string, trigger: string): string[] {
  const used = new Set(normalizeTrigger(trigger).split(" "));
  return utterance
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !used.has(t));
}
```

Commit and push this immediately, on its own. Person B needs it.

---

## Task 2 — `convex/users.ts`

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEMO_HANDLE = "demo";

export const getOrCreateDemoUser = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users").withIndex("by_handle", q => q.eq("handle", DEMO_HANDLE)).unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      name: "Pranav",
      handle: DEMO_HANDLE,
      voiceModel: "aura-2-thalia-en",
      createdAt: Date.now(),
    });
  },
});

export const getUser = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) =>
    ctx.db.query("users").withIndex("by_handle", q => q.eq("handle", handle)).unique(),
});
```

---

## Task 3 — `convex/phrases.ts`

Implement exactly the signatures in `CONTRACT.md` §5:

- `listPhrases(userId)` — query, active only, newest first. **The dashboard subscribes to this**,
  so it must be a `query` (reactive), never an action.
- `getByTrigger(userId, normalizedTrigger)` — query, uses `by_user_trigger` index
- `insertPhrase({...})` — `internalMutation`. **Upsert semantics**: if `normalizedTrigger`
  already exists for this user, update it in place instead of inserting a duplicate. Re-teaching
  the same phrase on stage must not create two rows.
- `bumpUsage(phraseId)` — `internalMutation`, `useCount++` and set `lastUsedAt`
- `deactivate(userId, normalizedTrigger)` — mutation, sets `active: false`
- `fetchByIds(ids)` — `internalQuery`, loads docs after B's vector search.
  **Preserve the input order** — vector search returns results ranked by score, and
  `Promise.all(ids.map(ctx.db.get))` preserves it. Do not re-sort.

---

## Task 4 — `convex/contacts.ts`

`listContacts(userId)`, `resolveAlias(userId, alias)` (lowercase the alias before lookup),
`upsertContact({...})`.

---

## Task 5 — `convex/pending.ts` — the confirmation state machine

This gates every consequential action. Get the invariant right:

- **At most one `awaiting` row per user.** `createPending` must first cancel any existing
  `awaiting` row for that user before inserting. If the user says two things in a row without
  confirming, the second wins. Without this, "yes" fires the wrong action on stage.
- `getAwaiting(userId)` — query on `by_user_status`, returns the row or `null`
- `setStatus(id, status, result?)` — `internalMutation`, stamps `resolvedAt`

---

## Task 6 — `convex/events.ts` — the live demo feed

Every stage of the pipeline writes here and the dashboard animates it. This is how Convex
reactivity becomes *visible on the projector* — it is a scored part of the demo, not logging.

- `log({ userId, kind, text, detail?, latencyMs? })` — `internalMutation`
- `feed({ userId, limit })` — query, **newest first**, default limit 50

Also export a **plain helper** (not a Convex function) that B and D can import from inside
actions, so nobody has to remember the `internal.events.log` path.

---

## Task 7 — `convex/seed.ts` — YOU OWN THE DEMO DATA

**This is your highest-value deliverable after the schema.** The demo is only as good as this
data. Do not treat it as filler.

`seedDemo` is a public `mutation` that wipes and reseeds: demo user, contacts, and the starting
vocabulary. Note it cannot compute embeddings (mutations can't call APIs) — insert phrases with
`embedding: []`, and Person B provides a `reseedEmbeddings` action that backfills them.
Coordinate that handoff with B directly.

**Contacts:** Mom (Rashmi), Laksh, Neel, Sarah, the project team (Slack channel).

**Seed vocabulary** — every one of these must map to something that visibly works:

| Trigger | Expands to | Action |
|---|---|---|
| `team pr tonight` | "Tell the project team I'll review the latest PR tonight" | `send_slack` |
| `neel later` | "Tell Neel I'll handle this later today" | `send_slack` |
| `red` | "Stop and read the current screen aloud" | `read_screen` |
| `focus` | "Do not disturb, close distractions, start a 25 minute timer" | `focus_mode` |
| `mom flight friday` | "Find afternoon flights from SFO for Mom this Friday" | `web_search` |
| `where` | "Describe what's currently on my screen" | `read_screen` |

Include `slots` where a template has a `{curly}` placeholder — e.g. `neel later` should have
`intentTemplate: "Tell Neel I'll handle this {when}"` with `slots: ["when"]`, so that
`"neel tomorrow"` hits the same phrase with a different filler. **That slot behaviour is what
proves this isn't a macro system.** Make sure at least two seeded phrases have slots.

⚠️ **Do NOT seed `school mom`.** That phrase gets taught live on stage in Beat 2. If it's already
in the database when we demo, the whole beat is a lie. Same for `standup` — that's Beat 3, where
the system proposes it on its own.

Also seed 3 near-duplicate utterances into the `utterances` table that would trigger the
`standup` auto-suggestion, so Person B's learning logic has something to fire on immediately
without us having to say the same thing three times on stage.

---

---

## Task 8 — `convex/scrape.ts` — Firecrawl (we have credits, use them)

**Do this only after Tasks 1–7 are pushed.** The team is blocked on your CRUD; this is the
upgrade, not the foundation.

Right now `"mom flight friday"` resolves to *"Find afternoon flights from SFO for Mom this
Friday"* — and then nothing real happens. Firecrawl closes that loop. **The demo goes from
"it understood me" to "it understood me and here are the actual flights."** That is the
difference between a language toy and a product, and it costs you about 30 minutes.

Set the key first — it lives in Convex env, never in the repo:

```bash
npx convex env set FIRECRAWL_API_KEY fc-...
```

```ts
"use node";
import { internalAction, action } from "./_generated/server";
import { v } from "convex/values";
import { Firecrawl } from "firecrawl";

export const searchWeb = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, { query, limit = 5 }) => {
    const fc = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
    const res = await fc.search(query, {
      limit,
      sources: ["web"],
      scrapeOptions: { formats: ["markdown"] },
    });
    // -> { ok: true, summary, results: [{ title, url, snippet }] }
  },
});
```

Also `scrapePage({ url })` → `{ ok, markdown, title }` using `fc.scrape(url, { formats: ["markdown"] })`.

**Person B's `web_search` executor calls your `searchWeb`.** Tell B the moment it's deployed —
they have a placeholder in `convex/executors.ts` that returns a fake summary, and they'll swap
it for your real one. That handoff is on you to initiate.

Notes that will save you time:
- Package is `firecrawl` (v2 SDK) with `new Firecrawl({ apiKey })` and `.search()` / `.scrape()`.
  Older tutorials show `@mendable/firecrawl-js` and `.scrapeUrl()` — **don't follow those**, the
  method names differ and you'll lose 15 minutes.
- `"use node"` files **cannot export other Convex function types** — keep `scrape.ts` isolated,
  exactly like Person B's `embeddings.ts`.
- Search costs ~2 credits per 10 results plus ~1 per page scraped. We have credits; don't crawl
  entire sites. `limit: 5` is plenty.
- `tbs` (time filtering) and `location` are useful for the flight demo — `location: "San Francisco"`
  makes results look far more convincing on stage.
- **Return a short spoken summary, not raw markdown.** The result gets read aloud by Deepgram.
  Three flight options in one sentence beats a wall of scraped text. Summarize with an LLM call
  or simple formatting — under 25 words.

**Demo safety:** cache the result of the flight query into the `events` table the first time it
runs. If Frontier Tower's wifi is bad at 6pm, we serve the cached result instead of a spinner.
Tell Person E you've done this so they know the demo is network-resilient.

### Optional, only if everything else is done
`enrichContact({ userId, alias })` — scrape a public profile to add context to a contact. Nice
in a pitch ("it knows who your team is"), but strictly lower priority than clean seed data.

---

## Acceptance criteria

- [ ] `normalizeTrigger` pushed within 15 minutes
- [ ] Schema deployed to `reminiscent-anteater-318`, announced to the team
- [ ] Every signature in `CONTRACT.md` §5 exists and is callable from the Convex dashboard
- [ ] `npx convex run seed:seedDemo` produces a coherent demo user with 6 phrases
- [ ] Two seeded phrases have non-empty `slots`
- [ ] `pendingActions` never has two `awaiting` rows for one user — test it deliberately
- [ ] `listPhrases` and `feed` are `query` (reactive), verified live-updating in the Convex dashboard
- [ ] `searchWeb` returns real results for *"afternoon flights SFO Friday"*, summarized to
      under 25 words, and Person B has been told it's live
- [ ] Pushed to `person-a/convex-core` by **4:30pm**

## If you finish early

Write `convex/stats.ts`: a `query` returning words-spoken vs words-expanded totals, so the
dashboard can display **"37 words spoken → 284 words meant"**. That number on the projector is
worth more than any additional feature.
