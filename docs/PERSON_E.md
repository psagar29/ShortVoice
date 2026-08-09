# PERSON E — Integrator, demo owner, pitch

> **Paste this whole file into your AI agent as the task prompt.**
> Repo: `https://github.com/psagar29/ShortVoice` · Branch: **`person-e/integration`**

---

## Project context

We are building **ShortVoice** at the VoiceOS hackathon (demos 6pm today).

**The pitch:** *"VoiceOS understands language. ShortVoice helps it understand **your** language."*

A person with limited speech — or anyone who repeats the same workflows — says three words
instead of twenty. ShortVoice expands the fragment into full intent using a personal vocabulary
they taught it, speaks back what it understood, and executes on confirmation.

Stack: **VoiceOS** → **MCP server** (thin, local, Person C) → **Convex** (state + intelligence,
Persons A and B) → **Deepgram** (voice + keyterm listening, Person D).

**You have read `CONTRACT.md`. You are its owner.**

---

## Your job is not to write features

Four people with agents will produce four working halves. **Your job is to make them one whole,
and then to make 90 seconds of it land in a room full of judges.**

The most common way a team like ours loses is not running out of code. It's four green branches
and no rehearsed demo at 5:55pm. **You are the person who prevents that.** Resist every urge to
go build a feature.

---

## Timeline

| Time | What you're doing |
|---|---|
| **now – 12:30** | Contract is frozen and pushed. Confirm A/B/C/D are unblocked and have branched. Set Convex env vars with A. |
| **12:30 – 2:00** | Chase the two spikes: C's VoiceOS routing answer, A's schema deploy. Nothing else matters yet. Start drafting the pitch. |
| **2:00 – 3:00** | First integration pull. Merge whatever exists into `person-e/integration`, run the harness end to end, find the seams **now** while there's time to fix them. |
| **3:00 – 4:00** | Second integration. Start rehearsing beats on real hardware. Record the backup video the moment Beat 1 works — do not wait for perfect. |
| **4:00 – 4:30** | **Feature freeze.** Announce it loudly. Everyone pushes. |
| **4:30 – 5:30** | Final merge, seed, full run-through **five times in a row**. Fix only what breaks the demo. |
| **5:30 – 6:00** | Rehearse the spoken pitch. Charge everything. Set up at the demo station. |
| **6:00** | Demo. |

**Feature freeze at 4:30 is the single most important line in this document.** Enforce it even
if someone is "five minutes away." They are not.

---

## Integration procedure

```bash
git checkout -b person-e/integration main

# merge in dependency order -- A first, everything depends on it
git merge person-a/convex-core
git merge person-b/resolver
git merge person-c/mcp-voiceos
git merge person-d/deepgram-dashboard

npm install
npx convex dev          # you deploy the merged Convex code
npx convex run seed:seedDemo
npx convex run embeddings:reseedEmbeddings   # seeds are inserted with empty vectors
npm run harness         # full pass before touching VoiceOS
```

File ownership was assigned so that conflicts are nearly impossible. If you hit one, it's in
`schema.ts` or `package.json` — meaning **somebody edited a frozen file**. Take `main`'s version,
then go ask them what they needed and add it deliberately.

**Merge early and often.** A 2pm merge that finds a broken assumption is worth ten hours of
parallel work. A 5pm first merge is how teams lose.

### The seams most likely to break

Watch these specifically — they're the contract points that span two people:

1. **The `localAction` passthrough** (B → C). B's `executeConfirmed` returns local actions for C
   to run on the Mac. Verify they agreed on the shape and that both sides match.
2. **`userId` consistency.** Everyone must resolve the same demo user. If C's MCP server and D's
   dashboard end up on different users, the dashboard will look dead during the demo.
3. **Empty embeddings.** A's seeds have `embedding: []` and B backfills them. Forget this and
   vector search silently matches nothing. **This will happen at least once — check for it.**
4. **Two voices at once.** C's MCP server and D's dashboard can both speak. Pick exactly one
   speaker per demo path and mute the other.
5. **`.convex.cloud` vs `.convex.site`.** Function calls vs HTTP actions. Someone will mix them.

---

## The demo — 90 seconds, three beats

Write it down, rehearse it verbatim, and **do not improvise on stage.**

### Open (10s)
> "Voice assistants assume accessibility means everyone can speak fluent, complete sentences.
> But what if you can't? What if speaking is exhausting, or you have ten reliable words?"

### Beat 1 — Compression (20s)
Say: **"Team. PR. Tonight."**
🔊 *"Tell your project team you'll review the latest PR tonight? Say yes to send."*
Say: **"Yes."** → sent. Dashboard shows HEARD → MEANT.

> "Three words. Twenty words of intent. VoiceOS executed it."

### Beat 2 — Live teaching (30s)
Say: **"When I say 'school mom', it means text Mom I'm leaving school and heading home."**
🔊 *"Got it."* — **the new phrase appears on the dashboard live, no refresh.**
Say: **"School mom."** → 🔊 confirmation → **"Yes."** → sent.

> "I just taught my computer a word. That's Convex — it's on screen before I finish speaking."

### Beat 3 — The system teaches you (20s)
🔊 *"You've asked me that three times this hour. Want to just say 'standup'?"*
Say: **"Yes."** → vocabulary grows itself on screen.

> "It's not a macro list. It's learning my language."

### Close (10s)
> **"You shouldn't have to speak like a computer for your computer to understand you."**

---

## Non-negotiable demo insurance

**Record a screen capture of every beat the moment it first works.** Not at 5:30 — the moment it
works. If the wifi at Frontier Tower dies at 6:01pm, the recording is the entire difference
between placing and not. This has decided more hackathons than any feature.

Also:
- [ ] Airplane mode off, notifications off, **Do Not Disturb ON** during the demo (except our own
      focus_mode action) — nothing kills a demo like a personal iMessage on the projector
- [ ] Screen resolution set for the projector, browser zoomed, terminal font enormous
- [ ] `seedDemo` + `reseedEmbeddings` re-run immediately before demoing, so state is clean
- [ ] `school mom` and `standup` **absent** from the vocabulary at demo start — verify on screen
- [ ] Demo contact is a teammate, not a real family member
- [ ] Laptop plugged in, everything charged

---

## The two extra prizes — both are yours, both are cheap

**Best Video Demo — $500 cash, judged on social engagement.** A 30-second vertical video of a
person controlling their computer in three words is genuinely shareable, and this is the most
underrated prize at the event. Shoot it during a lull, not at the end. Lead with Beat 2 — the
live teaching — because it's the most legible in silence. Add captions; most views are muted.

**Best VoiceOS Feedback — $100 cash, near-zero competition.** Keep `docs/FEEDBACK.md` open from
the start and write down every friction point as it happens — especially C's routing findings,
whether MCP tool descriptions reliably steer the agent, whether multi-step chaining works,
and what you wished the custom-integration setup did. **Written as you go, this is free money.**
Written at 5:50pm, it's worthless. Start it now.

---

## Judging criteria — usefulness, execution, creativity, demo quality

Note the event's hard rule: **the product must be voice-only, controlled primarily by voice.**
We're well positioned — teaching, invoking, and confirming are all voice. Say so explicitly.
Never touch the keyboard on stage; if you do, we've broken the rule in front of the judges.

Anticipate the two questions you *will* be asked:

**"Isn't this just macros?"**
> "Macros are exact-match strings. This is vector search over a personal vocabulary with
> slot-filling — 'Neel later' and 'later Neel' and 'Neel tomorrow' all resolve correctly, and
> the last one fills a different time slot. And it proposes new words on its own from patterns
> in what I've already said. You can't get Beat 3 out of a macro list."

**"Why not just use VoiceOS directly?"**
> "VoiceOS is excellent at understanding natural language. It assumes you can produce it.
> We're the layer for people who can't — or who shouldn't have to, forty times a day."

---

## Acceptance criteria

- [ ] First integration merge done by **2:00pm** — not later
- [ ] Feature freeze enforced at **4:30pm**
- [ ] Five consecutive clean run-throughs before 5:30pm
- [ ] Backup video recorded of all three beats
- [ ] Pitch rehearsed out loud, timed under 100 seconds
- [ ] `docs/FEEDBACK.md` written incrementally through the day
- [ ] Vertical demo video shot and posted
