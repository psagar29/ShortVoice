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

### ⚠️ The browser is currently holding the raw Deepgram key

`/listen-token` is meant to mint a 60-second grant so the key never leaves the server. The
key on this project has neither token-grant permission nor `keys:write`, so both clean
paths return `403 Insufficient permissions`. The fallback is enabled:

```bash
npx convex env set DEEPGRAM_ALLOW_RAW_KEY true   # currently set
```

With it on, `/listen-token` hands the browser the real key. **Anyone with devtools open on
the dashboard can read it.** Acceptable in a demo room; rotate the key afterwards.

To close it properly — 30 seconds, and the code already supports it — create a key with
owner/admin scope in the Deepgram console for this project, then:

```bash
npx convex env set DEEPGRAM_API_KEY <new-key>
npx convex env remove DEEPGRAM_ALLOW_RAW_KEY
```

`/listen-token` will start returning `mode: "grant"` and the listener switches subprotocol
on its own. No code change.

## Who speaks

**Click the 🔇 toggle before the demo starts.** Chrome blocks `audio.play()` until the page
has had a user gesture, and the dashboard speaks on its own when a confirmation arrives.
Unmuting is that gesture, so the ordering works out — but if you never click, nothing is
ever spoken and the console shows an autoplay rejection rather than an error you'd notice.


The dashboard starts **muted** so it and the MCP server never say the same sentence at
once. The header toggle switches ShortVoice's own Deepgram voice on. Agreed split:

- VoiceOS demo → the MCP server speaks, dashboard stays muted
- listener demo → the dashboard speaks, MCP server stays quiet

## The listener

Browser mic → `wss://api.deepgram.com/v1/listen?model=nova-3` → `api.resolver.resolve`.
A second path into the system that does not involve VoiceOS at all, so it works as the
primary demo if the VoiceOS routing spike fails.

It is primed with **keyterms**: every active trigger and every contact alias and full
name, taken from the same live subscriptions the vocabulary panel uses.

### The keyterm comparison — measured, not assumed

Same audio through `nova-3` twice, once with the user's vocabulary loaded and once without:

| spoken | keyterms **on** | keyterms **off** |
|---|---|---|
| `neel later` | **Neel later.** | **Neil Lader.** / **Kneel Later.** |
| `school mom` | School mom | School mom. |
| `team pr tonight` | Team pr tonight | Team PR tonight. |

With priming it lands on `Neel` every run. Without it, it misses every run — but not the
same way twice, so quote the behaviour on stage, not a specific wrong string.

**Say `"neel later"` on stage, not `"school mom"`.** Without priming, a name the user says
forty times a day comes back as a different person and a word that isn't one. That is the
whole argument in a single line, and it is real — reproduce it yourself:

```bash
node web/scripts/keyterm-compare.mjs "neel later" on
node web/scripts/keyterm-compare.mjs "neel later" off
```

Honest caveat: this was measured on Deepgram's own TTS, which is far cleaner than real
speech. `school mom` survives without priming on clean audio. On the quiet, compressed,
atypical speech this product exists for, the gap gets wider, not narrower.

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
