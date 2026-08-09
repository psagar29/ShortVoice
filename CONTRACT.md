# ShortVoice — Frozen Interface Contract

**Everyone codes against this document. It is frozen at kickoff.**
If you need a change, you ask Person E. E lands it on `main`, announces it, everyone rebases.
Do not "just add a field" on your branch — that is how four working halves become zero working wholes at 5pm.

---

## 1. What we are building

> **"VoiceOS understands language. ShortVoice helps it understand *your* language."**

A person says three words. ShortVoice expands them into the full intent they meant, speaks
back what it understood in its own voice, and executes on confirmation.

```
"Team. PR. Tonight."
   → 🔊 "Tell your project team you'll review the latest PR tonight?"
   → "Yes."
   → sent.
```

---

## 2. Architecture (this is the shape, do not redesign it)

```
                    ┌──────────────────────────┐
   user speaks ────►│  VoiceOS  (STT + agent)  │   demo Mac
                    └────────────┬─────────────┘
                                 │ MCP over stdio
                    ┌────────────▼─────────────┐
                    │  mcp/server.ts  (thin)   │   Person C
                    │  • 8 tools               │
                    │  • local OS actions only │
                    └────────────┬─────────────┘
                                 │ ConvexHttpClient (.convex.cloud)
   ┌─────────────────────────────▼──────────────────────────────┐
   │                        C O N V E X                          │
   │  reminiscent-anteater-318                                   │
   │                                                             │
   │   schema + CRUD ......................... Person A          │
   │   resolver: embed → vectorSearch → slot-fill ... Person B   │
   │   teach / auto-suggest / crons .......... Person B          │
   │   network executors (Slack, search) ..... Person B          │
   │   http.ts: /tts proxy, /listen-token .... Person D          │
   └─────────────────────────────┬──────────────────────────────┘
                                 │ reactive subscription
                    ┌────────────▼─────────────┐
                    │  web/  live dashboard    │   Person D
                    │  + Deepgram STT listener │
                    │  + Deepgram TTS voice    │
                    └──────────────────────────┘
```

**Why the MCP server is thin:** VoiceOS launches it over **stdio**, so it lives on one Mac.
Anything in there is invisible to the judges and untestable by the other three. Everything that
can live in Convex lives in Convex. The MCP server only does things that physically require the
Mac: AppleScript (iMessage, Calendar), screen reads, DND, app launching, audio playback.

---

## 3. Deployment — one shared Convex, no exceptions

```
Client SDK URL   CONVEX_URL       https://reminiscent-anteater-318.convex.cloud
HTTP actions     CONVEX_SITE_URL  https://reminiscent-anteater-318.convex.site
```

⚠️ **`.convex.cloud` and `.convex.site` are different hosts.** Function calls
(`ConvexHttpClient`, `ConvexReactClient`) use `.cloud`. Anything routed in `convex/http.ts`
is served from `.site`. Mixing these up costs 20 minutes every single time.

**Everybody runs `npx convex dev` against the SAME deployment.** Convex hot-pushes your local
`convex/` directory. That means: if two people run `convex dev` simultaneously with different
code, you overwrite each other.

**The rule:** only **Person A and Person B** run `npx convex dev`. C and D consume the deployed
functions and never run `convex dev`. If C or D needs a function changed, they ask A or B.

Secrets live in Convex env, not in the repo:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set DEEPGRAM_API_KEY ...
npx convex env set SLACK_BOT_TOKEN xoxb-...
```

---

## 4. FROZEN: the MCP tool surface

Person C implements exactly these eight tools. Names and argument shapes are frozen because the
demo script and the dashboard both depend on them.

| Tool | Args | Returns (string spoken by VoiceOS) |
|---|---|---|
| `shortvoice_say` | `utterance: string` | The confirmation question, e.g. *"Texting Mom that you're heading home. Say yes to send."* |
| `shortvoice_confirm` | — | *"Sent."* — executes the awaiting action |
| `shortvoice_cancel` | — | *"Cancelled."* |
| `shortvoice_teach` | `trigger: string, meaning: string` | *"Got it. 'school mom' now means…"* |
| `shortvoice_list_phrases` | — | Spoken summary of the user's vocabulary |
| `shortvoice_check_suggestion` | — | *"You've asked for that three times. Want a word for it?"* |
| `shortvoice_accept_suggestion` | `trigger: string` | *"Done. 'standup' now means…"* |
| `shortvoice_forget` | `trigger: string` | *"Forgot 'school mom'."* |

`shortvoice_say` is the front door. Its tool description must be aggressive enough that VoiceOS
routes short/compressed utterances to it instead of trying to handle them itself:

> *"ALWAYS call this first when the user says something short, compressed, fragmentary, or
> ambiguous — 1 to 4 words, names without verbs, or anything that sounds like shorthand.
> ShortVoice holds this user's personal vocabulary and knows what these fragments mean."*

**Fallback if VoiceOS won't route reliably:** prefix invocation, `"short: school mom"`.
Person C tests both in the first 30 minutes and reports which one we demo with.

---

## 5. FROZEN: the Convex function surface

### Person A owns these (CRUD + state)

```ts
// convex/users.ts
export const getOrCreateDemoUser = mutation({ args: {}, ... })      // -> Id<"users">
export const getUser         = query({ args: { handle: v.string() } })

// convex/phrases.ts
export const listPhrases     = query({ args: { userId } })          // -> Doc<"phrases">[]
export const getByTrigger    = query({ args: { userId, normalizedTrigger } })
export const insertPhrase    = internalMutation({ args: { ...all phrase fields } })
export const bumpUsage       = internalMutation({ args: { phraseId } })
export const deactivate      = mutation({ args: { userId, normalizedTrigger } })
export const fetchByIds      = internalQuery({ args: { ids: v.array(v.id("phrases")) } })

// convex/contacts.ts
export const listContacts    = query({ args: { userId } })
export const resolveAlias    = query({ args: { userId, alias } })    // -> Doc<"contacts"> | null
export const upsertContact   = mutation({ args: { ... } })

// convex/pending.ts
export const getAwaiting     = query({ args: { userId } })           // -> Doc | null
export const createPending   = internalMutation({ args: { ... } })   // -> Id<"pendingActions">
export const setStatus       = internalMutation({ args: { id, status, result? } })

// convex/events.ts
export const feed            = query({ args: { userId, limit } })    // newest first
export const log             = internalMutation({ args: { userId, kind, text, detail?, latencyMs? } })

// convex/seed.ts
export const seedDemo        = mutation({ args: {} })  // wipes + seeds demo user, contacts, phrases

// convex/scrape.ts  -- Firecrawl. Turns resolved intents into REAL web results.
export const searchWeb = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  // -> { ok, summary: string, results: {title, url, snippet}[] }
})
export const scrapePage = internalAction({
  args: { url: v.string() },
  // -> { ok, markdown: string, title: string }
})
export const enrichContact = action({
  args: { userId: v.id("users"), alias: v.string() },
  // -> { ok, notes: string }   // optional; only if time allows
})
```

**`normalizeTrigger` lives in `convex/lib/normalize.ts` and Person A owns it.** Everyone imports
it; nobody reimplements it.

```ts
export function normalizeTrigger(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)
    .filter(Boolean).sort().join(" ");
}
```

### Person B owns these (the intelligence)

```ts
// convex/embeddings.ts
export const embed           = internalAction({ args: { text } })    // -> number[1536]

// convex/resolver.ts   ← THE CORE
export const resolve = action({
  args: { userId: v.id("users"), utterance: v.string() },
  // returns:
  //   { kind: "confirm",   pendingId, confirmationSpeech, resolvedIntent, matchScore }
  //   { kind: "clarify",   speech }        // ambiguous, ask a question
  //   { kind: "unknown",   speech }        // no idea, offer to be taught
})

export const executeConfirmed = action({
  args: { userId: v.id("users") },
  // returns: { ok: boolean, speech: string }
})

export const cancelPending = action({ args: { userId } })  // -> { speech }

// convex/teach.ts
export const teachPhrase = action({
  args: { userId, trigger: v.string(), meaning: v.string() },
  // parses `meaning` with an LLM into { intentTemplate, actionType, params, slots },
  // embeds, writes via phrases.insertPhrase
  // returns: { speech, phraseId }
})

// convex/learning.ts
export const maybeSuggest       = internalAction({ args: { userId } })
export const pendingSuggestion  = query({ args: { userId } })   // -> Doc<"suggestions"> | null
export const acceptSuggestion   = action({ args: { userId, trigger } })

// convex/executors.ts   (network-only actions)
export const runNetworkAction = internalAction({
  args: { actionType: v.string(), params: v.any() },
  // -> { ok, detail }
})
```

### Person D owns these

```ts
// convex/http.ts
POST https://reminiscent-anteater-318.convex.site/tts
     body: { text: string, voice?: string }  -> audio/mpeg bytes
     (keeps DEEPGRAM_API_KEY server-side in Convex env)

GET  https://reminiscent-anteater-318.convex.site/keyterms?userId=...
     -> { keyterms: string[] }   // every active trigger, for Deepgram STT priming
```

---

## 6. The resolver algorithm (Person B — this is the technical heart)

This is the answer to the judge who asks *"isn't this just macros?"* It must be more than a
dictionary lookup.

```
resolve(utterance):
  1. normalize + embed the utterance
  2. ctx.vectorSearch("phrases", "by_embedding", {
       vector, limit: 5, filter: q => q.eq("userId", userId)
     })
  3. load the candidate docs (runQuery -> phrases.fetchByIds)

  4. if top score >= 0.82  -> STRONG MATCH
       leftover = utterance tokens NOT accounted for by the trigger
       if phrase.slots is non-empty and leftover is non-empty:
          LLM fills slots from leftover  ("neel tomorrow" -> {when: "tomorrow"})
       render intentTemplate with filled slots
       -> kind: "confirm"

  5. if 0.65 <= score < 0.82  -> WEAK MATCH
       LLM sees top 3 candidates + contacts + current date/time
       and decides: is one of these what they meant, or is it ambiguous?
       -> "confirm" or "clarify"

  6. if score < 0.65  -> NO MATCH, but still try
       LLM expands from personal context alone: contacts, recent utterances,
       time of day, day of week. "mom flight friday" with no taught phrase
       still becomes a flight search.
       -> "confirm" with lower confidence wording, or "unknown"

  7. write to `utterances` (with embedding) + `events`
  8. schedule learning.maybeSuggest
```

**Non-negotiable properties** (these are what make it a language):

- **Order-independent.** `"neel later"` and `"later neel"` resolve identically.
- **Slot-filling.** `"neel tomorrow"` hits the same phrase as `"neel later"` with a different
  time. The taught phrase is a *template*, not a string.
- **Never a plain string lookup.** If Person B implements `if (trigger === utterance)`, we lose.

---

## 7. File ownership — zero-conflict rule

| Path | Owner | Others may |
|---|---|---|
| `convex/schema.ts` | **FROZEN / E** | read only |
| `convex/lib/normalize.ts` | A | import |
| `convex/users.ts`, `phrases.ts`, `contacts.ts`, `pending.ts`, `events.ts`, `seed.ts`, `scrape.ts` | A | call |
| `convex/resolver.ts`, `embeddings.ts`, `teach.ts`, `learning.ts`, `executors.ts`, `crons.ts` | B | call |
| `mcp/*`, `scripts/harness.ts` | C | — |
| `convex/http.ts`, `web/**` | D | — |
| `package.json` | **FROZEN / E** | — |
| `CONTRACT.md`, `README.md`, `docs/**` | E | — |

`package.json` already contains every dependency all four of you need. **Do not add dependencies.**
If you truly need one, message E. (`web/package.json` is D's alone and D may edit it freely.)

---

## 8. Branches

```
main                        scaffold + contract (this)
person-a/convex-core
person-b/resolver
person-c/mcp-voiceos
person-d/deepgram-dashboard
person-e/integration        E merges A→B→C→D here, then fast-forwards main
```

Branch from `main`. Commit often. Push by **4:30pm** — E needs 90 minutes to integrate and rehearse.

---

## 9. Definition of done — the 90-second demo

Every branch exists to make these three beats work. If your work doesn't serve one of them, cut it.

**Beat 1 — Compression.** Speak twenty words' worth of intent in three words.
> *"Team. PR. Tonight."* → 🔊 *"Tell your project team you'll review the latest PR tonight?"* → *"Yes."* → sent.

**Beat 2 — Live teaching.** Teach a brand-new word on stage in ten seconds, then use it.
> *"When I say 'school mom', it means text Mom I'm leaving school and heading home."*
> → 🔊 *"Got it."* → *"School mom."* → 🔊 *"Texting Mom that you're heading home?"* → *"Yes."* → sent.
> The dashboard shows the new phrase appear in the vocabulary **live** (Convex reactivity, no refresh).

**Beat 3 — The system teaches you.** It offers a word you never asked for.
> 🔊 *"You've asked me that three times this hour. Want to just say 'standup'?"* → *"Yes."*
> → the vocabulary grows itself on screen.

Beat 3 is the one that wins. Protect it.
