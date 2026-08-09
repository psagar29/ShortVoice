# ShortVoice

### You shouldn't have to speak like a computer for your computer to understand you.

> **VoiceOS understands language. ShortVoice helps it understand _your_ language.**

Voice assistants assume accessibility means everyone can speak fluent, complete sentences.
ShortVoice is the layer for people who can't — or who shouldn't have to, forty times a day.

```
                  "Team. PR. Tonight."
                           │
                           ▼
   🔊 "Tell your project team you'll review the latest PR tonight?"
                           │
                        "Yes."
                           ▼
                         sent.
```

Three words in. Twenty words of intent out.

---

## What it actually is

A **personal translation layer** between compressed, minimal, or atypical speech and full
computer intent. Each person builds their own vocabulary — by teaching it directly, or by
accepting words the system proposes after noticing them repeat themselves.

It is not a macro list. Triggers are matched by **vector search over a personal lexicon**, so
`"neel later"`, `"later neel"`, and `"later, Neel!"` are the same phrase — and `"neel tomorrow"`
hits that same phrase with a different **slot** filled. Utterances that match nothing still
resolve, from contacts, time of day, and recent history.

And it teaches back:

> 🔊 *"You've asked me that three times this hour. Want to just say 'standup'?"*

---

## Architecture

```
                    ┌──────────────────────────┐
   user speaks ────►│  VoiceOS  (STT + agent)  │
                    └────────────┬─────────────┘
                                 │ MCP over stdio
                    ┌────────────▼─────────────┐
                    │  mcp/server.ts  (thin)   │  8 tools, local OS actions only
                    └────────────┬─────────────┘
                                 │ ConvexHttpClient
   ┌─────────────────────────────▼──────────────────────────────┐
   │                        C O N V E X                          │
   │  personal lexicon · vector search · slot-filling            │
   │  confirmation state machine · auto-suggest · live feed      │
   └─────────────────────────────┬──────────────────────────────┘
                                 │ reactive subscription
                    ┌────────────▼─────────────┐
                    │  live dashboard          │  vocabulary grows on screen
                    │  + Deepgram STT / TTS    │  keyterm-primed listening
                    └──────────────────────────┘
```

**Convex is the whole backend.** The MCP server is deliberately thin — VoiceOS launches it over
stdio on one Mac, so it only does what physically requires the Mac (AppleScript, screen reads,
audio). Everything else — the lexicon, the resolver, the state machine, the learning loop, the
live feed — is Convex functions, Convex vector search, and Convex reactivity.

**Deepgram is the voice and the ears.** ShortVoice speaks its confirmations in its own aura-2
voice, distinct from VoiceOS. And it listens with **keyterm prompting** primed by the user's own
vocabulary — which is the point, because short, quiet, atypical utterances are exactly what
generic ASR fumbles. `"school mom"` transcribes as `"school mom"` and not `"cool mom"`.

**Firecrawl closes the loop on lookups.** `"mom flight friday"` doesn't just expand into
*"Find afternoon flights from SFO for Mom this Friday"* — it comes back with the actual flights,
searched and scraped, summarized down to one sentence short enough to speak aloud.

---

## Repo layout

```
convex/          all state + intelligence        Persons A (CRUD) and B (resolver)
  schema.ts      FROZEN contract
mcp/             MCP server + local Mac actions  Person C
web/             live dashboard + Deepgram       Person D
scripts/         text harness (no voice needed)  Person C
CONTRACT.md      frozen interfaces -- read first
docs/PERSON_*.md per-person task briefs
```

## Getting started

```bash
npm install
cp .env.example .env
npx convex dev                 # existing deployment: reminiscent-anteater-318
npx convex run seed:seedDemo
npm run harness                # drive the whole system by text, no VoiceOS required
```

Connect to VoiceOS via **Settings → Integrations → Custom Integrations**:

```
npx tsx /absolute/path/to/ShortVoice/mcp/server.ts
```

⚠️ Convex serves function calls from **`.convex.cloud`** and HTTP actions from **`.convex.site`**.
They are different hosts.

---

Built at the VoiceOS hackathon, Frontier Tower SF.
