# ShortVoice demo runbook (Person E)

Integration state as of the 1:30pm pass, plus everything the 6pm demo needs.
The pitch script is at the bottom. Rehearse it verbatim; do not improvise on stage.

---

## Integration status: MERGED AND GREEN

All four branches are integrated on `person-e/integration` with ownership rules
applied (A's versions of the eight shared files win over B's stubs, per
PERSON_B_NOTES.md section 3). Verified against a local Convex deployment:

- `npx convex dev` deploys the merged `convex/` cleanly, full schema, both vector indexes
- `tsc --noEmit` passes across `convex/`, `mcp/`, `scripts/`
- `web/` builds clean (`next build`)
- `scripts/mcp-smoke.test.ts` passes (frozen eight-tool contract intact)
- `scripts/resolverEval.ts`: **10/10** including all three beats
- C's `scripts/harness.ts` end to end: Beat 1 resolve -> confirm -> "Sent.",
  Beat 2 teach -> use -> localAction reaches the Mac executor,
  Beat 3 `:suggestion` -> `:accept standup` -> vocabulary grows

## Seam fixes applied during integration (owners, please review)

1. **`localAction` field name (B <-> C).** B emitted `localAction.type`; C's zod
   schema requires `actionType` and threw on every confirmed OS action. Renamed to
   `actionType` in `convex/resolver.ts` (matches CONTRACT.md's `runNetworkAction`
   naming and C's `mcp/types.ts`). PERSON_B_NOTES.md updated to match.
2. **`create_event` start time (B <-> C).** B sends human text in `when` and ISO in
   `whenIso`; C parsed `new Date(params.when)`, which is invalid for "tonight."
   `mcp/localActions.ts` now reads `whenIso` first.
3. **Slack phrases had no message text (A <-> B).** A's seed gave `send_slack`
   phrases only `{ channel }`; B's executor requires `text`/`body`, so Beat 1's
   confirm failed with "There was no message to send." Seed now carries slot-aware
   `text` (`"I'll handle this {when}"` renders through `fillParams`).
4. **Eval cold-path check (A <-> B).** A deliberately seeds "mom flight friday" as a
   taught phrase, so B's cold-band check now uses "dad dinner sunday."
5. **Local testing unblocked (C).** `mcp/backend.ts` now accepts loopback URLs so the
   harness can target `npx convex dev` locally. Remote URLs must still be our
   `.convex.cloud` origin.

Seams verified fine as built: userId (C's `getOrCreateDemoUser` and D's
`getUser("demo")` resolve the same user once seeded), two voices (dashboard boots
muted; agreed split is VoiceOS path = MCP speaks, listener path = dashboard speaks),
`.cloud`/`.site` (correct on every side), empty embeddings (reseed exists and works).

C never calls `resolver.reportLocalResult`; B's 10-second self-close covers it and
the feed shows "confirmed" instantly, so the demo is unaffected. Nice-to-have if C
has slack time.

## THE open question (answer before 3pm)

**Does VoiceOS route short fragments to `shortvoice_say`?** Nobody has recorded the
spike result. On the demo Mac: point VoiceOS at `mcp/spike.ts`, say "team pr
tonight", watch stderr. If routing is unreliable, we demo with the `"short: ..."`
prefix, and the pitch script below already works either way. Record the answer in
docs/FEEDBACK.md while it is fresh.

---

## Environment matrix

**Convex env** (shared deployment, set once by A or B):

```bash
npx convex env set OPENAI_API_KEY sk-...           # resolver LLM paths + read_screen
npx convex env set DEEPGRAM_API_KEY ...            # /tts and the listener
npx convex env set SHORTVOICE_TZ America/Los_Angeles
npx convex env set SLACK_BOT_TOKEN xoxb-...        # optional; executor no-ops gracefully without it
npx convex env set FIRECRAWL_API_KEY fc-...        # optional; web_search
```

**Demo Mac `.env`** (repo root; the MCP server reads `.env`, not `.env.local`):

```bash
CONVEX_URL=https://reminiscent-anteater-318.convex.cloud
CONVEX_SITE_URL=https://reminiscent-anteater-318.convex.site
SHORTVOICE_DEMO_PHONE=+1...    # a TEAMMATE'S number; every send_message goes here by design
OPENAI_API_KEY=sk-...          # only needed for read_screen ("red"/"where")
```

Without `SHORTVOICE_DEMO_PHONE`, every message send fails on purpose. That is C's
demo-safety guard; nothing ever texts a real seeded contact.

**Dashboard** `web/.env.local`: copy `web/.env.local.example` (points at the shared
deployment). Note D's raw-key fallback is currently on; rotate the Deepgram key after
the demo (commands in `web/README.md`).

## Reset ritual (run before every rehearsal and immediately before the demo)

```bash
npx convex run seed:seedDemo
npx convex run embeddings:reseedEmbeddings   # seeds are inserted with empty vectors; skip this and vector search matches nothing
npm run harness                              # then `:phrases` -- verify "school mom" and "standup" are ABSENT
```

## Demo-station checklist

- [ ] Do Not Disturb ON, notifications off, screen resolution set for projector
- [ ] Browser zoomed, terminal font enormous, laptop plugged in
- [ ] Dashboard open and MUTED for the VoiceOS path (unmuting is also the audio
      autoplay gesture; if demoing the listener path, click unmute BEFORE starting)
- [ ] `SHORTVOICE_DEMO_PHONE` is a teammate in the room with Messages open
- [ ] Backup video recorded of every beat THE MOMENT it first works, not at 5:30
- [ ] Vertical 30s video shot during a lull, Beat 2 first, captions on

## Remaining timeline

| Time | What |
|---|---|
| by 3:00 | Routing spike answered on the demo Mac; rehearse beats on real hardware |
| 3:00-4:00 | Record backup video; second integration pull if anyone pushed |
| 4:30 | **FEATURE FREEZE. Announce it loudly. No exceptions, not even "five minutes away."** |
| 4:30-5:30 | Final merge, reset ritual, five consecutive clean run-throughs |
| 5:30-6:00 | Rehearse the spoken pitch, charge everything, set up |

---

## The pitch, verbatim (90 seconds)

**Open (10s):**
"Voice assistants assume accessibility means everyone can speak fluent, complete
sentences. But what if you can't? What if speaking is exhausting, or you have ten
reliable words?"

**Beat 1, compression (20s):** Say "Team. PR. Tonight."
The voice answers: "Telling the project team you'll review the latest PR tonight.
Say yes to send." Say "Yes." Sent; dashboard shows HEARD -> MEANT.
"Three words. Twenty words of intent. VoiceOS executed it."

**Beat 2, live teaching (30s):** Say "When I say 'school mom', it means text Mom
I'm leaving school and heading home." The voice answers "Got it," and the phrase
appears on the dashboard live, no refresh. Say "School mom." Confirmation. "Yes." Sent.
"I just taught my computer a word. That's Convex; it's on screen before I finish
speaking."

**Beat 3, the system teaches you (20s):** The voice offers: "You've asked me that
three times. Want to just say 'standup'?" Say "Yes." The vocabulary grows itself
on screen.
"It's not a macro list. It's learning my language."

**Close (10s):**
"You shouldn't have to speak like a computer for your computer to understand you."

## Judge answers, rehearsed

**"Isn't this just macros?"**
"Macros are exact-match strings. This is vector search over a personal vocabulary
with slot-filling: 'Neel later' and 'later Neel' and 'Neel tomorrow' all resolve
correctly, and the last one fills a different time slot. And it proposes new words
on its own from patterns in what I've already said. You can't get Beat 3 out of a
macro list."

**"Why not just use VoiceOS directly?"**
"VoiceOS is excellent at understanding natural language. It assumes you can produce
it. We're the layer for people who can't, or who shouldn't have to, forty times a
day."

**The voice-only rule:** teaching, invoking, and confirming are all voice. Say so
explicitly. Never touch the keyboard on stage.
