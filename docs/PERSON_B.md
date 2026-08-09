# PERSON B — The Resolver: vector search, slot-filling, teaching, auto-suggest

> **Paste this whole file into your AI agent as the task prompt.**
> Repo: `https://github.com/psagar29/ShortVoice` · Branch: **`person-b/resolver`**

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

## You are building the thing the project is actually about

Everyone else is plumbing. You are the product.

There is exactly one question that can sink us at 6pm:

> *"Isn't this just macros with extra steps?"*

**Your code is the entire answer.** If the resolver is a dictionary lookup, we lose the room.
Three properties make it a language instead of a keybinding — treat them as requirements, not
nice-to-haves:

1. **Order independence** — `"neel later"` ≡ `"later neel"` ≡ `"later, neel"`
2. **Slot filling** — `"neel tomorrow"` hits the *same taught phrase* as `"neel later"` with a
   different time filler. Taught phrases are **templates**, not strings.
3. **Graceful degradation** — an utterance that matches *nothing* still resolves, using contacts,
   time of day, and recent history. `"mom flight friday"` works before anyone teaches it.

If you implement `if (utterance === trigger)` anywhere, you have built the thing we said we
weren't building.

---

## Setup

```bash
git clone https://github.com/psagar29/ShortVoice.git
cd ShortVoice
git checkout -b person-b/resolver
npm install
cp .env.example .env
npx convex dev     # choose the EXISTING deployment: reminiscent-anteater-318
```

You and **Person A** are the only two who run `npx convex dev` — you share one deployment and
hot-push over each other. Coordinate before restarting.

You depend on Person A for `convex/lib/normalize.ts`, `phrases.insertPhrase`,
`phrases.fetchByIds`, `pending.*`, `events.log`, and `contacts.resolveAlias`. **Do not wait for
them.** Write against the signatures in `CONTRACT.md` §5 — they are frozen and A is shipping
them within 45 minutes. If you're blocked, stub locally and delete the stub when A lands.

---

## Files you own

```
convex/embeddings.ts
convex/resolver.ts      ← the core
convex/teach.ts
convex/learning.ts
convex/executors.ts
convex/crons.ts
```

**Do not touch** `convex/schema.ts` or `package.json` (frozen), A's CRUD files,
`convex/http.ts` or `web/**` (D), `mcp/**` (C).

---

## Task 1 — `convex/embeddings.ts`

```ts
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";

export const embed = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, { text }) => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const r = await openai.embeddings.create({
      model: "text-embedding-3-small",   // 1536 dims -- matches schema, do not change
      input: text,
    });
    return r.data[0].embedding;
  },
});
```

Also export `embedBatch` — you'll need it to backfill Person A's seed rows, which are inserted
with `embedding: []` because mutations can't call APIs. Provide `reseedEmbeddings` (a public
`action`) that loads all phrases with empty embeddings, embeds `trigger + " — " + intentTemplate`,
and patches them. Tell Person A when it's ready; it must be run after every reseed.

⚠️ A file with `"use node"` **cannot export other Convex function types**. Keep embeddings
isolated in this file.

---

## Task 2 — `convex/resolver.ts` — THE CORE

```ts
export const resolve = action({
  args: { userId: v.id("users"), utterance: v.string() },
  handler: async (ctx, { userId, utterance }) => { ... },
});
```

Returns one of:

```ts
{ kind: "confirm", pendingId, confirmationSpeech, resolvedIntent, matchScore }
{ kind: "clarify", speech }   // ambiguous — ask a question, create no pending action
{ kind: "unknown", speech }   // no idea — offer to be taught
```

### Algorithm

```
1.  t0 = Date.now()
2.  embedding = runAction(internal.embeddings.embed, { text: utterance })
3.  hits = await ctx.vectorSearch("phrases", "by_embedding", {
        vector: embedding,
        limit: 5,
        filter: q => q.eq("userId", userId),
      })
4.  docs = await ctx.runQuery(internal.phrases.fetchByIds, { ids: hits.map(h => h._id) })
       -> zip docs with hits[i]._score, preserving rank order

5.  STRONG  (score >= 0.82)
       leftover = leftoverTokens(utterance, doc.trigger)
       if doc.slots.length && leftover.length:
           slots = await fillSlots(doc, leftover, context)   // one LLM call
       intent = render(doc.intentTemplate, slots)
       -> confirm

6.  WEAK  (0.65 <= score < 0.82)
       one LLM call sees: top 3 candidates, the contact list, current date/time,
       and the last 5 utterances. It returns either a chosen phrase + slots,
       or { ambiguous: true, question: "..." }
       -> confirm | clarify

7.  COLD  (score < 0.65)
       no taught phrase matched. Expand from personal context ALONE:
       contacts, time of day, day of week, recent utterances.
       "mom flight friday" -> "Find afternoon flights from SFO for Mom this Friday"
       -> confirm (with hedged wording) | unknown

8.  createPending(...)  via internal.pending.createPending
9.  write `utterances` row (WITH embedding -- learning depends on it)
10. events.log("resolved", ..., latencyMs: Date.now() - t0)
11. ctx.scheduler.runAfter(0, internal.learning.maybeSuggest, { userId })
```

⚠️ **`ctx.vectorSearch` only exists in actions**, never in queries or mutations. This is why
`resolve` is an `action`.

⚠️ Convex vector search `filter` supports **equality only** on declared `filterFields`
(`userId`, `active`). No ranges, no negation. If you want active-only, add
`q.eq("active", true)` — but note you can't `AND` two filter fields, only `OR`. Filter by
`userId` in the vector search and drop inactive rows in JS after `fetchByIds`.

### `confirmationSpeech` — write these carefully

This string is what the room hears. It is the product.

- Second person, present progressive: *"Texting Mom that you're heading home."*
- Always end with the ask: *"Say yes to send."*
- **Include the payload.** *"Sending a message"* is worthless; *"Telling the team you'll review
  the PR tonight"* is the demo.
- Under ~15 words. Long confirmations kill the pacing of a 90-second demo.
- On a COLD resolve, hedge audibly: *"I think you mean…"* — honesty about confidence reads as
  sophistication, not weakness.

### `executeConfirmed` and `cancelPending`

```ts
export const executeConfirmed = action({ args: { userId }, ... })
// 1. getAwaiting -> if none: { ok: false, speech: "Nothing to confirm." }
// 2. setStatus "confirmed"
// 3. dispatch:
//      network actions (send_slack, web_search) -> internal.executors.runNetworkAction
//      local actions   (send_message, read_screen, focus_mode, open_app, create_event)
//        -> DO NOT execute here. Return { ok: true, speech, localAction: {...} }
//           so the MCP server performs it on the Mac. Convex cannot run AppleScript.
// 4. setStatus "executed" | "failed", bumpUsage, events.log
// 5. return { ok, speech }
```

That `localAction` passthrough is a **contract point with Person C** — agree the exact shape
with them in the first hour and write it down.

---

## Task 3 — `convex/teach.ts` — Beat 2 of the demo

```ts
export const teachPhrase = action({ args: { userId, trigger, meaning }, ... })
```

Input: `trigger: "school mom"`, `meaning: "text Mom that I'm leaving school and heading home"`.

One LLM call (`claude-sonnet-4-5` or `gpt-4o-mini`, structured output) parses `meaning` into:

```ts
{
  intentTemplate: "Text Mom that I'm leaving school and heading home",
  actionType: "send_message",
  params: { contact: "Mom", body: "I'm leaving school and heading home" },
  slots: []                    // populate if the meaning implies a variable
}
```

Prompt the model with the current contact list so `"Mom"` resolves to a real contact, and with
the `actionType` union from `schema.ts` so it can only pick a legal value. **Ask it to identify
slots**: if the meaning contains a time, place, or person that could vary, emit a `{curly}`
placeholder and list it in `slots`. A phrase taught with a slot is dramatically more impressive
30 seconds later when you use it with a different filler.

Then embed, `normalizeTrigger`, and write via `internal.phrases.insertPhrase` (upsert).

Return speech that **plays back the expansion**, because that's the proof:
> *"Got it. 'School mom' now means: text Mom that you're leaving school and heading home."*

This runs live on stage. It must work on the first try and take under 3 seconds.

---

## Task 4 — `convex/learning.ts` — Beat 3, THE WINNING FEATURE

**Protect this. It is the single most impressive thing in the project and it's the one most
likely to get cut for time. Do not let it get cut.** Everything else is a better macro system;
this is the part where the computer learns the person's language on its own.

```ts
export const maybeSuggest = internalAction({ args: { userId } })
```

Runs after every resolve (scheduled, off the critical path — never block `resolve` on it):

```
1. load the last ~30 utterances for this user
2. for the newest one, ctx.vectorSearch("utterances", "by_embedding", ...) with its own embedding
3. cluster: >= 3 utterances with pairwise score >= 0.88 that did NOT match a taught phrase
4. if a cluster exists and no pending/accepted suggestion covers it:
     LLM proposes a SHORT trigger (1-2 words, easy to say, not colliding with existing phrases)
     + the intentTemplate/actionType/params it should expand to
5. insert into `suggestions` (status "pending"), events.log("suggested", ...)
```

```ts
export const pendingSuggestion = query({ args: { userId } })   // dashboard subscribes -- must be a query
export const acceptSuggestion  = action({ args: { userId, trigger } })
   // embeds + writes a phrase with source: "suggested", marks suggestion accepted
```

The spoken line matters as much as the algorithm:
> *"You've asked me that three times this hour. Want to just say 'standup'?"*

Person A seeds three near-duplicate utterances so this can fire without us repeating ourselves
on stage. Verify it triggers off that seed data early — don't discover at 5:45pm that it doesn't.

---

## Task 5 — `convex/executors.ts` (network actions only)

```ts
export const runNetworkAction = internalAction({
  args: { actionType: v.string(), params: v.any() },
  // -> { ok: boolean, detail: string }
});
```

- `send_slack` — `chat.postMessage` with `SLACK_BOT_TOKEN` from Convex env. If Slack isn't
  wired up in time, **write the message to the `events` feed instead and return ok** — the
  dashboard shows it, the demo survives. A demo that visibly "sends" beats a demo that throws.
- `web_search` — **Person A owns the real implementation** via Firecrawl in `convex/scrape.ts`.
  Start with a hardcoded placeholder summary so you're never blocked, then swap in
  `internal.scrape.searchWeb({ query, limit: 5 })` the moment A tells you it's deployed. A
  returns a pre-summarized string under 25 words, already shaped to be read aloud — pass it
  straight through as `detail`, don't re-summarize it.

Local actions (`send_message`, `read_screen`, `focus_mode`, `open_app`, `create_event`) are
**Person C's**, executed on the Mac. Never attempt AppleScript from Convex.

---

## Task 6 — `convex/crons.ts`

Optional, only if you have spare time: sweep `pendingActions` older than 5 minutes still in
`awaiting` and mark them `cancelled`, so a stale "yes" can't fire the wrong thing on stage.

---

## Acceptance criteria

- [ ] `"neel later"` and `"later neel"` resolve identically — test both explicitly
- [ ] `"neel tomorrow"` hits the same phrase as `"neel later"` with a different filled slot
- [ ] `"mom flight friday"` resolves usefully with **no** taught phrase for it
- [ ] `resolve` end-to-end p50 **under 1.5 seconds** (measure it; log `latencyMs`)
- [ ] `teachPhrase` then immediately using the new phrase works, cold, first try
- [ ] `maybeSuggest` fires off Person A's seed data and produces a sane 1-2 word trigger
- [ ] Every path writes to `events` — Person D's dashboard is driven entirely by it
- [ ] Pushed to `person-b/resolver` by **4:30pm**

## Priority if you run short on time

1. Strong-match + slot filling (Beat 1) — **non-negotiable**
2. `teachPhrase` (Beat 2) — **non-negotiable**
3. `maybeSuggest` (Beat 3) — **fight for this one**
4. Cold-path expansion
5. Clarify path, crons
