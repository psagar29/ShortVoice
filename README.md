# ShortVoice

### You shouldn't have to speak like a computer for your computer to understand you.

> **VoiceOS understands language. ShortVoice helps it understand _your_ language.**

Voice assistants assume accessibility means everyone can speak fluent, complete sentences.
ShortVoice is the layer for people who can't — or who shouldn't have to, forty times a day.

```
                  "Team. PR. Tonight."
                           │
                           ▼
   🔊 "Telling the project team you'll review the latest PR tonight.
       Say yes to send."
                           │
                        "Yes."
                           ▼
                         sent.
```

Three words in. Twenty words of intent out.

---

## What it is

A **personal translation layer** between compressed, minimal, or atypical speech and full
computer intent. Each person builds their own vocabulary — by teaching it out loud, or by
accepting words the system proposes after noticing them repeat themselves.

It is not a macro list:

- **Order-independent.** `"neel later"`, `"later neel"`, and `"pr team tonight"` all resolve.
- **Slot-filling.** Taught phrases are templates. `"neel tomorrow"` hits the *same* phrase as
  `"neel later"` with a different `{when}` filled in.
- **Degrades gracefully.** Utterances matching nothing still resolve from contacts, time of day,
  and recent history.
- **It teaches back.** After you say the same thing three times:
  > 🔊 *"You've asked me that three times. Want to just say 'standup'?"*

---

## How a single utterance flows

```
   you speak
       │
       ▼
┌──────────────────┐
│     VoiceOS      │  STT + agent decides to call our MCP tool
└────────┬─────────┘
         │  MCP over stdio
         ▼
┌──────────────────┐
│  mcp/server.ts   │  8 tools, ~no logic. Forwards to Convex.
└────────┬─────────┘
         │  ConvexHttpClient  →  .convex.cloud
         ▼
┌─────────────────────────────────────────────────────────────┐
│                        C O N V E X                           │
│                                                              │
│  1. embed the utterance            embeddings.ts             │
│  2. ctx.vectorSearch over phrases  resolver.ts               │
│  3. rank, fill {slots} from the leftover words               │
│  4. render intentTemplate → resolvedIntent                   │
│  5. write pendingActions (awaiting) + utterances + events     │
│  6. schedule learning.maybeSuggest (off the critical path)   │
└────────┬────────────────────────────────────────┬───────────┘
         │  confirmationSpeech                     │  reactive
         ▼                                         ▼
   VoiceOS speaks it                     ┌──────────────────┐
   + Deepgram aura-2 via /tts            │  web/ dashboard  │
                                         │  HEARD → MEANT   │
         │  "Yes."                       │  vocabulary grows│
         ▼                               └──────────────────┘
   executeConfirmed
         ├── network action  → runs inside Convex (Slack, Firecrawl)
         └── local action    → returned as a localAction payload,
                               run on the Mac by mcp/localActions.ts
```

**Convex is the whole backend.** VoiceOS launches MCP servers over stdio, so `mcp/` lives on one
Mac and does only what physically requires that Mac — AppleScript, screen capture, audio
playback. The lexicon, resolver, vector search, confirmation state machine, learning loop, and
live feed are all Convex functions.

**Deepgram is the voice and the ears.** ShortVoice speaks confirmations in its own aura-2 voice,
distinct from VoiceOS so the room can hear which system is talking. It listens with **keyterm
prompting** primed by the user's own vocabulary — the point being that short, quiet, atypical
utterances are exactly what generic ASR fumbles. `"school mom"` transcribes as `"school mom"`,
not `"cool mom"`.

**Firecrawl closes the loop on lookups.** `"mom flight friday"` doesn't just expand into
*"Find afternoon flights from SFO for Mom this Friday"* — it comes back with actual flights,
summarized to one sentence short enough to speak aloud.

---

## Repo map

| Path | What's in it |
|---|---|
| `convex/schema.ts` | The data contract: `phrases` (+ vector index), `contacts`, `pendingActions`, `utterances`, `suggestions`, `events` |
| `convex/resolver.ts` | `resolve`, `executeConfirmed`, `cancelPending` — the core |
| `convex/embeddings.ts` | OpenAI embeddings + `reseedEmbeddings` backfill |
| `convex/teach.ts` | *"When I say X it means Y"* → a stored template |
| `convex/learning.ts` | Clusters repeated utterances, proposes new words |
| `convex/executors.ts` | Network actions (Slack, web search) |
| `convex/scrape.ts` | Firecrawl search + scrape |
| `convex/seed.ts` | Demo user, contacts, starting vocabulary |
| `convex/http.ts` | `/tts` and `/keyterms`, served from **`.convex.site`** |
| `mcp/server.ts` | The eight-tool MCP surface VoiceOS calls |
| `mcp/localActions.ts` | iMessage, Calendar, screen read, focus mode |
| `mcp/spike.ts` | Minimal server for testing VoiceOS routing |
| `web/` | Live dashboard + Deepgram listener (Next.js) |
| `scripts/harness.ts` | Drive the whole system by text, no VoiceOS needed |
| `scripts/resolverEval.ts` | Regression eval over the three demo beats |

---

## Setup

### 1. Convex (do this first — everything depends on it)

```bash
npm install
cp .env.example .env
npx convex dev            # choose the existing deployment
```

Secrets live in Convex env, never in the repo:

```bash
npx convex env set OPENAI_API_KEY sk-...      # required: embeddings + LLM slot-filling
npx convex env set DEEPGRAM_API_KEY ...       # required: /tts and the listener
npx convex env set SHORTVOICE_TZ America/Los_Angeles
npx convex env set SLACK_BOT_TOKEN xoxb-...   # optional, no-ops gracefully
npx convex env set FIRECRAWL_API_KEY fc-...   # optional, powers web_search
```

> ⚠️ Without `OPENAI_API_KEY`, `embeddings.ts` silently falls back to hashed vectors.
> Nothing looks broken — every phrase still gets a 1536-dim vector — but matching becomes
> lexical rather than semantic, and paraphrases stop resolving. Check the return value of
> `reseedEmbeddings`: it reports `backend: "openai"` or `backend: "hashed-fallback"`.

Then seed:

```bash
npx convex run seed:seedDemo
npx convex run embeddings:reseedEmbeddings   # seeds insert with empty vectors — never skip this
```

### 2. The harness (no VoiceOS required)

```bash
npm run harness
```

```
shortvoice> team pr tonight
shortvoice> yes
shortvoice> teach "school mom" = text Mom I'm leaving school and heading home
shortvoice> school mom
```

| Command | Does |
|---|---|
| `:phrases` | Dump the current vocabulary |
| `:feed` | Dump the event feed |
| `:suggestion` | Show the pending auto-suggestion |
| `:accept <trigger>` | Accept it under a chosen name |
| `:forget <trigger>` | Deactivate a phrase |
| `:quit` / `:exit` | Leave |

### 3. VoiceOS

**Settings → Integrations → Custom Integrations → Add**, with an absolute path:

```
npx tsx /absolute/path/to/ShortVoice/mcp/server.ts
```

The demo Mac's `.env` (repo root — the MCP server reads `.env`, not `.env.local`):

```bash
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_SITE_URL=https://<deployment>.convex.site
SHORTVOICE_DEMO_PHONE=+1...    # a teammate. Without it, sends fail by design.
OPENAI_API_KEY=sk-...          # only for read_screen ("red" / "where")
```

Test routing in isolation with `mcp/spike.ts` before wiring the real server.

> ⚠️ MCP uses stdio. **Never write to `stdout`** in `mcp/` — it corrupts the protocol.
> All logging goes to `stderr`.

### 4. Dashboard

```bash
cd web
cp .env.local.example .env.local
npm install && npm run dev        # localhost:3000
```

---

## The eight MCP tools

| Tool | Args | Convex function |
|---|---|---|
| `shortvoice_say` | `utterance` | `resolver:resolve` |
| `shortvoice_confirm` | — | `resolver:executeConfirmed` |
| `shortvoice_cancel` | — | `resolver:cancelPending` |
| `shortvoice_teach` | `trigger, meaning` | `teach:teachPhrase` |
| `shortvoice_list_phrases` | — | `phrases:listPhrases` |
| `shortvoice_check_suggestion` | — | `learning:pendingSuggestion` |
| `shortvoice_accept_suggestion` | `trigger` | `learning:acceptSuggestion` |
| `shortvoice_forget` | `trigger` | `phrases:deactivate` |

`shortvoice_say` is the front door. Its tool *description* is prompt engineering — it's the only
thing steering VoiceOS to route short fragments to us instead of interpreting them itself.

---

## Gotchas that have already cost us time

- **`.convex.cloud` ≠ `.convex.site`.** Function calls go to `.cloud`; `convex/http.ts` routes
  are served from `.site`. Different hosts.
- **`ctx.vectorSearch` only works inside actions**, never queries or mutations.
- **Vector search `filter` is equality-only** on declared `filterFields`, and can't `AND` across
  two fields. Filter by `userId`, drop inactive rows in JS afterward.
- **`"use node"` files can't export other Convex function types** — that's why `embeddings.ts`
  and `scrape.ts` are isolated.
- **Seeds carry empty embeddings** (mutations can't call APIs). Forget `reseedEmbeddings` and
  vector search silently matches nothing.
- **Firecrawl v2** is the `firecrawl` package with `.search()` / `.scrape()`. Older tutorials
  show `@mendable/firecrawl-js` and `.scrapeUrl()` — different method names.

---

## Docs

| Doc | For |
|---|---|
| [`CONTRACT.md`](CONTRACT.md) | Frozen interfaces: schema, MCP tools, Convex signatures, resolver algorithm |
| [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) | Reset ritual, station checklist, the verbatim 90-second pitch, rehearsed judge answers |
| [`docs/FEEDBACK.md`](docs/FEEDBACK.md) | VoiceOS friction log |
| [`docs/PERSON_A.md`](docs/PERSON_A.md) – [`PERSON_E.md`](docs/PERSON_E.md) | The original per-person build briefs |
| [`PERSON_B_NOTES.md`](PERSON_B_NOTES.md) | Resolver design notes and band thresholds |

---

## Verifying it works

```bash
npm run typecheck              # convex/ mcp/ scripts/
cd web && npm run typecheck
npx tsx scripts/mcp-smoke.test.ts    # the eight-tool contract
npx tsx scripts/resolverEval.ts      # all three demo beats
```

The three properties worth checking by hand, because they're the ones that matter:

```
"later neel"        → same phrase as "neel later"           (order independence)
"neel tomorrow"     → same phrase, different {when} slot    (templating, not macros)
a full paraphrase   → still resolves                        (semantic, not lexical —
                                                             fails if OPENAI_API_KEY is unset)
```

---

Built at the VoiceOS hackathon, Frontier Tower SF.
