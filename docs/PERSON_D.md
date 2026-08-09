# PERSON D — Deepgram voice + the live Convex dashboard

> **Paste this whole file into your AI agent as the task prompt.**
> Repo: `https://github.com/psagar29/ShortVoice` · Branch: **`person-d/deepgram-dashboard`**

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

## You own everything the judges actually see

The room will not read our code. They will watch a screen for 90 seconds. **You are the screen.**

Two jobs beyond that, both of which have to be *real* rather than decorative, because judges ask:

- **Deepgram is our voice and our ears** — ShortVoice speaks in its own voice, and it listens
  with the user's own vocabulary loaded as keyterms.
- **Convex is visibly the backend, not a database we happened to use.** The vocabulary must grow
  on screen, live, with no refresh, the instant a phrase is taught. That single moment is the
  best Convex demo we can give and it is worth more than any styling.

---

## Setup

```bash
git clone https://github.com/psagar29/ShortVoice.git
cd ShortVoice
git checkout -b person-d/deepgram-dashboard
npm install
cp .env.example .env      # fill in DEEPGRAM_API_KEY
```

⚠️ **Do NOT run `npx convex dev`.** Only Persons A and B may. You read from the deployed
functions on the shared deployment.

⚠️ **Two different hosts, do not mix them up:**
- `NEXT_PUBLIC_CONVEX_URL=https://reminiscent-anteater-318.convex.cloud` → `ConvexReactClient`
- `CONVEX_SITE_URL=https://reminiscent-anteater-318.convex.site` → your `http.ts` routes

`web/` is your own workspace with its own `package.json` — add whatever frontend deps you want
there. Do not touch the root `package.json`.

---

## Files you own

```
convex/http.ts      ← the only Convex file you own
web/**              ← entirely yours
```

**Do not touch** anything else in `convex/` (A and B), `mcp/**` (C), or the root `package.json`.

---

## Task 1 — `convex/http.ts`

Two routes. Adding a Convex HTTP action is also a nice thing to be able to point at when
someone asks how much of the system is Convex.

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// POST /tts  { text, voice? } -> audio/mpeg
// Keeps DEEPGRAM_API_KEY inside Convex env instead of shipping it to the browser.
http.route({
  path: "/tts",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const { text, voice = "aura-2-thalia-en" } = await request.json();
    const dg = await fetch(
      `https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );
    return new Response(await dg.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

export default http;
```

Also `GET /keyterms?userId=...` → `{ keyterms: string[] }`, returning every active trigger plus
every contact alias. And handle `OPTIONS` for CORS on both routes or the browser will block you.

Person C calls `/tts` from the MCP server. Give them the working URL early.

---

## Task 2 — the live dashboard (`web/`) — **your highest-value deliverable**

Next.js + `ConvexReactClient`. **Everything is a `useQuery` subscription — no polling, no
refresh buttons.** If anything on this page requires a manual refresh, the Convex story dies.

```tsx
const phrases = useQuery(api.phrases.listPhrases, { userId });
const feed    = useQuery(api.events.feed, { userId, limit: 50 });
const pending = useQuery(api.pending.getAwaiting, { userId });
const suggest = useQuery(api.learning.pendingSuggestion, { userId });
```

### Layout — designed for a projector at the back of a room

```
┌──────────────────────────────────────────────────────────────┐
│  ShortVoice          ● listening        37 words → 284 meant │
├───────────────────────────┬──────────────────────────────────┤
│  HEARD                    │   MY LANGUAGE          6 phrases │
│                           │                                  │
│    "team pr tonight"      │   team pr tonight    ▸ used 3×   │
│         ↓                 │   neel later         ▸ used 1×   │
│  MEANT                    │   red                            │
│                           │   focus                          │
│  "Tell the project team   │   mom flight friday              │
│   you'll review the       │   ✨ school mom      just taught │
│   latest PR tonight"      │                                  │
│                           ├──────────────────────────────────┤
│  ┌─────────────────────┐  │   💡 You've asked for that 3×.   │
│  │ ⏳ awaiting "yes"   │  │      Want to say "standup"?      │
│  └─────────────────────┘  │                                  │
├───────────────────────────┴──────────────────────────────────┤
│  FEED   heard → resolved → awaiting → confirmed → executed   │
└──────────────────────────────────────────────────────────────┘
```

**Non-negotiables, in priority order:**

1. **HEARD → MEANT, huge.** Three words on the left, the full sentence on the right. This is the
   entire product in one image. Make it the biggest thing on screen and animate the expansion.
2. **A newly taught phrase appears in MY LANGUAGE instantly**, with a highlight/glow that fades.
   Person A seeds 6 phrases; `school mom` appears live during Beat 2. **This moment is the demo.**
3. **The suggestion card** materialising on its own during Beat 3.
4. The word-count ratio in the header (Person A may ship `api.stats`; if not, compute it from
   the feed). *"37 words spoken → 284 words meant"* is the number people remember.
5. Dark theme, very large type, high contrast. Assume a washed-out projector and a viewer 30
   feet away. **Test it at 1280×720 zoomed to 150% before you call it done.**

---

## Task 3 — the Deepgram listener (`web/`) — also our demo insurance

A browser mic → Deepgram streaming STT → Convex. This is a **second, independent path into the
system that does not involve VoiceOS at all**, and if Person C's routing spike fails it becomes
our primary demo. Ask C how the spike went before you decide how much to invest here.

```
wss://api.deepgram.com/v1/listen
  ?model=nova-3
  &smart_format=true
  &interim_results=true
  &keyterm=school%20mom&keyterm=neel&keyterm=standup&...
```

**Keyterm prompting is the substantive part, not a checkbox.** Fetch `/keyterms` and pass every
one of the user's triggers and contact aliases. The whole premise is short, quiet, atypical
utterances — exactly what generic ASR fumbles. Priming with the user's own vocabulary is why
`"school mom"` transcribes correctly instead of as `"cool mom"`. **Say that sentence out loud
to the judges**; it's a real technical answer to a real problem.

Notes:
- Keyterms are `nova-3` (or Flux) only, repeated params, no weights, no commas. 500-token cap —
  we'll have well under 50 terms.
- With **Flux** you can update keyterms mid-stream via the `Configure` control message. If you
  get that working, it means the vocabulary taught at second 30 primes the recogniser at second
  40 — **within a single demo**. That is a genuinely great thing to say on stage. Try it, but
  only after the dashboard is solid.
- Auth from the browser: don't ship the raw key. Mint a short-lived Deepgram key via a Convex
  action, or proxy through `http.ts`. For a hackathon, a scoped temp key is fine.

On a final transcript, call `api.resolver.resolve` and let the dashboard react.

---

## Task 4 — Deepgram TTS in the browser

Play the confirmation through `/tts` so the dashboard can speak on its own. Use the
streaming WebSocket (`wss://api.deepgram.com/v1/speak`, `Speak`/`Flush`/`Clear`/`Close`
messages) if latency is visibly bad on the REST path; otherwise REST is fine and simpler.

Coordinate with Person C so we don't get **two voices saying the same sentence at once** during
the demo. Agree on exactly one speaker: probably the MCP server during the VoiceOS demo, the
dashboard during the listener demo. Add a mute toggle so E can switch during rehearsal.

---

## Acceptance criteria

- [ ] `/tts` returns playable audio, URL given to Person C early
- [ ] `/keyterms` returns live triggers from Convex
- [ ] Dashboard is 100% `useQuery` subscriptions, zero polling
- [ ] Teaching a phrase in the harness makes it appear on the dashboard **with no refresh** —
      demo this to the team, it's our Convex proof
- [ ] HEARD → MEANT is legible from 30 feet
- [ ] Listener transcribes `"school mom"` correctly with keyterms on (and note what it does
      with keyterms off — that comparison is a great line for the pitch)
- [ ] Suggestion card appears on its own
- [ ] Pushed to `person-d/deepgram-dashboard` by **4:30pm**

## Priority if you run short on time

1. Dashboard with live-updating vocabulary (**the Convex story — never cut this**)
2. HEARD → MEANT panel
3. `/tts` for Person C
4. Deepgram listener with keyterms
5. Streaming TTS, mid-stream keyterm updates, animations
