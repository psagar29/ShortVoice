# ShortVoice: setting up on a new machine

Hand this to anyone joining the project. It takes about 15 minutes.

---

## 0. What you need

| | |
|---|---|
| **Node** | 20 or newer (24 is what we use) |
| **git** | any recent version |
| **VoiceOS** | free download, Mac **or** Windows |
| **OS** | macOS for the full demo. Windows works for most of it, see below. |

### Platform note, read this before you start

VoiceOS itself runs on **both Mac and Windows**. Our code splits in two halves, and only one
half is cross-platform:

| Part | Mac | Windows |
|---|---|---|
| VoiceOS | yes | yes |
| MCP server (`mcp/`) | yes | yes |
| Convex backend | yes | yes |
| Dashboard (`web/`) | yes | yes |
| Slack messages, web search | yes | yes (these run inside Convex, not on your machine) |
| iMessage, Calendar, screen reading, focus mode, opening apps | yes | **no** |

Those last five run through `osascript`, `screencapture`, and `afplay`, which are macOS-only.
On Windows everything resolves, speaks, confirms, and logs correctly, and Slack plus web search
genuinely execute. The five OS actions will fail at the final step.

**So: the demo machine must be a Mac.** Everyone else can develop and test on Windows.

---

## 1. Install VoiceOS

Download from **https://www.voiceos.com** and pick your platform. Launch it once and complete
its own onboarding (mic permission, account) before touching our repo. Confirm plain dictation
works first, because if VoiceOS can't hear you, nothing downstream will.

---

## 2. Clone and install

```bash
git clone https://github.com/psagar29/ShortVoice.git
cd ShortVoice
npm install
```

---

## 3. Environment files

Two files, two different purposes. Neither is committed.

**`.env` at the repo root** (used by the MCP server):

```bash
CONVEX_URL=https://reminiscent-anteater-318.convex.cloud
CONVEX_SITE_URL=https://reminiscent-anteater-318.convex.site
SHORTVOICE_DEMO_PHONE=+1...     # a TEAMMATE's number, never a real family member
OPENAI_API_KEY=sk-...           # only needed for read_screen ("red" / "where")
```

**`web/.env.local`** (used by the dashboard):

```bash
cd web && cp .env.local.example .env.local
```

> `.convex.cloud` and `.convex.site` are **different hosts**. Function calls go to `.cloud`;
> the `/tts` and `/keyterms` routes in `convex/http.ts` are served from `.site`. Mixing them up
> is the single most common way to lose twenty minutes on this project.

### Do NOT run `npx convex dev`

We all share one Convex deployment, and `convex dev` hot-pushes your local `convex/` folder to
it. If two people run it with different code, they overwrite each other. Only the one person
who owns backend deploys should run it. Everyone else consumes the deployed functions.

---

## 4. Verify it works, without VoiceOS

Do this before wiring anything up. It exercises the whole backend with no voice involved.

```bash
npm run harness
```

```
shortvoice> team pr
  -> Telling the project team you'll review the latest PR. Say yes to send.
shortvoice> yes
shortvoice> find keyboard
  -> Search the web for keyboard and show me the best options.
shortvoice> :phrases
shortvoice> :quit
```

| Command | Does |
|---|---|
| `:phrases` | Show the current vocabulary |
| `:feed` | Show the event feed |
| `:suggestion` | Show the pending auto-suggestion |
| `:accept <trigger>` | Accept it under a chosen name |
| `:forget <trigger>` | Deactivate a phrase |

If the harness works, the backend is fine and any later problem is in VoiceOS wiring.

---

## 5. Wire up VoiceOS

**Test routing first with the throwaway server**, not the real one:

**VoiceOS → Settings → Integrations → Custom Integrations → Add**, and give it an
**absolute** path:

```
npx tsx /full/path/to/ShortVoice/mcp/spike.ts
```

Say **"team pr"** and watch what happens. You are answering four questions:

1. Does VoiceOS call the tool at all on a bare two-word fragment?
2. Does a prefix help, `"short: team pr"`?
3. Does it speak our returned string verbatim, paraphrase it, or stay silent?
4. Does a bare **"yes"** trigger `shortvoice_confirm`?

Then swap the command to the real server:

```
npx tsx /full/path/to/ShortVoice/mcp/server.ts
```

That exposes all eight tools: `shortvoice_say`, `confirm`, `cancel`, `teach`, `list_phrases`,
`check_suggestion`, `accept_suggestion`, `forget`.

> Never `console.log` in anything under `mcp/`. MCP talks over stdio, so writing to stdout
> corrupts the protocol. Use `console.error`.

---

## 6. macOS permissions (Mac only, do it early)

The five local actions need Automation, Accessibility, and Screen Recording. The prompts appear
on the **VoiceOS** process, not on your terminal, and they appear at the worst possible moment
if you leave them until the demo.

Trigger each one deliberately now: say a phrase that sends a message, one that reads the screen,
one that opens an app. Approve each prompt in **System Settings → Privacy & Security**.

---

## 7. Dashboard

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Everything on it is a live Convex subscription. There is no refresh button because there is
nothing to refresh: teach a phrase in the harness and watch the row appear on the dashboard
while you are still typing.

---

## 8. Outbound calling (a1mobile)

`"appointment dentist"` becomes a real phone call: ShortVoice dials, introduces itself as an
assistant calling on someone's behalf, negotiates a time inside the stated availability, and
reports the outcome back. The transcript streams onto the dashboard live, because a room can
only hear one side of a call.

**Convex environment:**

```bash
npx convex env set A1_TEAM_KEY team-...
npx convex env set A1_PHONE_NUMBER +1...            # our number, read out as the callback
# SHORTVOICE_CALL_TARGET is optional now: the appointment phrases already
# dial a teammate (+1 916 896 9399). Set it only to force a different number.
```

**Point the number at our webhook.** Do this *after* the code is deployed, or you point at a
URL with no `/voice` route:

```bash
curl -X POST https://hack.a1mobile.com/api/numbers/point \
  -H "X-Team-Key: $A1_TEAM_KEY" -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://reminiscent-anteater-318.convex.site/voice"}'

curl https://hack.a1mobile.com/api/numbers/me -H "X-Team-Key: $A1_TEAM_KEY"   # verify
curl -X POST https://hack.a1mobile.com/api/numbers/unpoint -H "X-Team-Key: $A1_TEAM_KEY"  # revert
```

> **Every appointment phrase dials `DEMO_CALL_NUMBER` in `convex/seed.ts`** (+1 916 896 9399,
> a teammate who agreed to pick up). `SHORTVOICE_CALL_TARGET` overrides it globally if set.
> Placing automated calls to real businesses that never agreed to them is a different thing
> from demoing, and it is trivially easy to do by accident while testing. Change the destination
> only when you have decided, deliberately, to call someone real.

The agent opens every call by identifying itself as an automated assistant, and it speaks from
an explicit brief (name, callback, availability, reason) rather than a free prompt, so it cannot
invent commitments on the user's behalf.

**Note on trial limits:** `GET /api/numbers/me` reports `verified_numbers: []`. Outbound calls
to arbitrary destinations may be refused by the provider until numbers are verified. If a call
fails, `startCall` marks the row failed and speaks a plain reason rather than hanging.

---

## 9. Known state and gotchas

**`OPENAI_API_KEY` is not yet set on the shared Convex deployment.** Until it is, embeddings
fall back to hashed vectors, so exact and reordered triggers match but genuine paraphrases
return `unknown`. To fix, whoever owns the deployment runs:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex run seed:seedDemo
npx convex run embeddings:reseedEmbeddings   # must print backend: "openai"
```

Check that last string. `"hashed-fallback"` means it did not take, and it reports success either
way. **Never run `reseedEmbeddings` before the key is set**: it silently writes hash vectors that
poison the vector index, and then nothing matches at all.

**The `userId` changes on every reseed.** `seedDemo` deletes and recreates the demo user, so any
running MCP server or dashboard is left subscribed to a user that no longer exists. Restart both
after seeding.

**`school mom` and `standup` are deliberately not seeded.** They are taught live during the demo.
If you see them in `:phrases`, someone left test state behind; reseed.

---

## Quick reference

```bash
npm run harness      # drive everything by text, no voice
npm run typecheck    # convex/ mcp/ scripts/
npm run mcp          # run the MCP server by hand
cd web && npm run dev

npx tsx scripts/resolverEval.ts     # regression eval over the demo beats
npx tsx scripts/mcp-smoke.test.ts   # the eight-tool contract
```

Read `CONTRACT.md` for the frozen interfaces and `docs/DEMO_RUNBOOK.md` for the demo script.
