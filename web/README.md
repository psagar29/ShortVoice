# web/ — the live dashboard (Person D)

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev            # http://localhost:3000
```

`web/` has its own `package.json`. The root one is frozen — nothing here touches it.

## For Person C — the URLs you asked for

Served from **`.convex.site`**, not `.convex.cloud`. They are different hosts.

```
POST https://reminiscent-anteater-318.convex.site/tts
     { "text": "Texting Mom that you're heading home.", "voice": "aura-2-thalia-en" }
     -> audio/mpeg bytes

GET  https://reminiscent-anteater-318.convex.site/keyterms?userId=<id>
     -> { "keyterms": ["school mom", "neel later", "mom", "Rashmi", ...] }
     userId is optional; it falls back to the demo user.

POST https://reminiscent-anteater-318.convex.site/listen-token
     -> { "token": "<short-lived Deepgram grant>", "expiresIn": 60 }
```

All three answer `OPTIONS` for CORS.

**`DEEPGRAM_API_KEY` must be set in Convex env**, not in a `.env` file:

```bash
npx convex env set DEEPGRAM_API_KEY <key>
```

Without it `/tts` and `/listen-token` return 500 with a message saying exactly that.

## Who speaks

The dashboard starts **muted** so it and the MCP server never say the same sentence at
once. The header toggle switches ShortVoice's own Deepgram voice on. Agreed split:

- VoiceOS demo → the MCP server speaks, dashboard stays muted
- listener demo → the dashboard speaks, MCP server stays quiet

## The listener

Browser mic → `wss://api.deepgram.com/v1/listen?model=nova-3` → `api.resolver.resolve`.
A second path into the system that does not involve VoiceOS at all, so it works as the
primary demo if the VoiceOS routing spike fails.

It is primed with **keyterms**: every active trigger and every contact alias and full
name, taken from the same live subscriptions the vocabulary panel uses. Short, quiet,
atypical utterances are exactly what generic ASR fumbles — priming with the user's own
vocabulary is why `"school mom"` transcribes as `"school mom"` and not `"cool mom"`.

Teach a phrase mid-demo and the socket reconnects with the new term included, so a word
taught at second 30 primes the recogniser at second 40. `nova-3` cannot take keyterms
mid-stream (only Flux can, via `Configure`), so this is a ~200 ms reconnect rather than a
live update — same observable result inside one demo.

The listener also drives the whole state machine from voice alone:

| You say | It calls |
|---|---|
| `"when I say school mom it means text Mom I'm leaving school"` | `api.teach.teachPhrase` |
| `"yes"` / `"send it"` / `"go ahead"` | `api.resolver.executeConfirmed` |
| `"no"` / `"cancel"` / `"never mind"` | `api.resolver.cancelPending` |
| anything else | `api.resolver.resolve` |

## Zero polling

Every panel is a `useQuery` subscription. There is no `setInterval`, no refetch, and no
refresh button anywhere in `web/`. Teach a phrase from the harness and watch MY LANGUAGE
grow on screen — that is the Convex proof and it is the reason this page exists.

The Yes / Cancel / Accept buttons are demo insurance for a failed mic, not a data path.
