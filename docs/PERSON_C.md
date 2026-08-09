# PERSON C — MCP server, VoiceOS integration, local Mac actions

> **Paste this whole file into your AI agent as the task prompt.**
> Repo: `https://github.com/psagar29/ShortVoice` · Branch: **`person-c/mcp-voiceos`**

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

Stack: **VoiceOS** (speech + agent) → **your MCP server** (thin, local) → **Convex** (all state
and intelligence) → **Deepgram** (ShortVoice's own confirmation voice).

**Read `CONTRACT.md` in the repo root before writing a line of code.** It is frozen.

---

## You own the two riskiest things in the project

**Risk 1: we don't know that VoiceOS will route to our tool.** VoiceOS is itself a capable
agent. When the user says *"school mom"*, VoiceOS may decide to handle it, ask a clarifying
question, or do nothing — instead of calling `shortvoice_say`. If that happens, there is no
demo. **This is your first 30 minutes and nothing else matters until it's answered.**

**Risk 2: only one Mac runs VoiceOS.** If the other three need that Mac to test, we have one
developer and three spectators. **Your harness (Task 2) is what unblocks the whole team.**

Report both answers to the group chat within the hour.

---

## Setup

```bash
git clone https://github.com/psagar29/ShortVoice.git
cd ShortVoice
git checkout -b person-c/mcp-voiceos
npm install
cp .env.example .env      # fill in DEEPGRAM_API_KEY
```

⚠️ **Do NOT run `npx convex dev`.** Only Persons A and B may — you'd hot-push over their code.
You consume their **deployed** functions from the shared deployment via HTTP.

---

## Task 1 (FIRST 30 MINUTES) — the VoiceOS routing spike

Build the dumbest possible MCP server, connect it, and find out what happens.

```ts
// mcp/spike.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "shortvoice", version: "0.1.0" });

server.tool(
  "shortvoice_say",
  "ALWAYS call this first when the user says something short, compressed, fragmentary, or ambiguous -- 1 to 4 words, names without verbs, or anything that sounds like personal shorthand. ShortVoice holds this user's personal vocabulary and knows what these fragments mean. Do not try to interpret short fragments yourself.",
  { utterance: z.string().describe("exactly what the user said, verbatim") },
  async ({ utterance }) => ({
    content: [{ type: "text", text: `ShortVoice heard: ${utterance}` }],
  }),
);

await server.connect(new StdioServerTransport());
```

Connect it: **VoiceOS → Settings → Integrations → Custom Integrations → Add**, launch command:

```
npx tsx /Users/<you>/ShortVoice/mcp/spike.ts
```

(Use the absolute path. VoiceOS uses **stdio** transport — never write to `stdout` in an MCP
server, it corrupts the protocol. All debug logging goes to `stderr` via `console.error`.)

### Answer these four questions and post the answers

1. Saying **"school mom"** with nothing else — does VoiceOS call the tool?
2. Does it work better with a prefix, **"short: school mom"** or **"shortvoice, school mom"**?
3. When the tool returns text, does VoiceOS **speak it verbatim**, paraphrase it, or stay silent?
4. **Chaining:** if the tool returns *"Send a Slack message to #team saying I'll review the PR
   tonight"*, does VoiceOS go on to call its **own** Slack tool? (Spend 10 minutes max on this.
   If it works it's a bonus; **do not make the demo depend on it.** Our architecture assumes it
   doesn't.)

Question 3 shapes everything Person D builds — if VoiceOS paraphrases our confirmation strings,
Deepgram becomes the *primary* voice channel rather than a secondary one. Tell D immediately.

---

## Task 2 (NEXT) — `scripts/harness.ts`, the team unblocker

A REPL that calls the same Convex functions the MCP server calls, with **no voice and no
VoiceOS**. Everyone uses this to test. Ship it before you build the real server.

```
$ npm run harness
shortvoice> team pr tonight
  → resolved (0.91): Tell the project team you'll review the latest PR tonight
  🔊 "Tell your project team you'll review the latest PR tonight? Say yes to send."
shortvoice> yes
  → executed: posted to #project-team
shortvoice> teach "school mom" = text Mom I'm leaving school and heading home
  → learned. 'school mom' → send_message(Mom)
shortvoice> school mom
  ...
shortvoice> :phrases      # dump vocabulary
shortvoice> :feed         # dump event feed
```

Push it the moment it works and tell the team.

---

## Task 3 — `mcp/server.ts`, the real thing

Implement **exactly** the eight tools in `CONTRACT.md` §4 — names and args are frozen, the
harness and dashboard depend on them.

Keep it thin. It is a **translation layer, not a brain**: resolve `userId` once at startup, call
Convex, speak the result, perform local OS actions. No business logic. Target under 250 lines.

```ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);
// NOTE: .convex.cloud for function calls. .convex.site is Person D's HTTP actions. Different hosts.

// at startup:
const userId = await convex.mutation(api.users.getOrCreateDemoUser, {});
```

Tool → Convex mapping:

| Tool | Calls |
|---|---|
| `shortvoice_say` | `api.resolver.resolve` |
| `shortvoice_confirm` | `api.resolver.executeConfirmed` |
| `shortvoice_cancel` | `api.resolver.cancelPending` |
| `shortvoice_teach` | `api.teach.teachPhrase` |
| `shortvoice_list_phrases` | `api.phrases.listPhrases` |
| `shortvoice_check_suggestion` | `api.learning.pendingSuggestion` |
| `shortvoice_accept_suggestion` | `api.learning.acceptSuggestion` |
| `shortvoice_forget` | `api.phrases.deactivate` |

**Tool descriptions are prompt engineering, not documentation.** VoiceOS decides whether to call
your tool based purely on the description string. Iterate on them with real speech until routing
is reliable — this is real work, not boilerplate. In particular `shortvoice_confirm` must fire on
a bare *"yes"*, *"yeah"*, *"do it"*, *"send it"*.

---

## Task 4 — `mcp/localActions.ts`, the things only the Mac can do

Person B's `executeConfirmed` returns network results directly, but hands **local** actions back
to you as a `localAction` payload for execution here. **Agree the exact shape with Person B in
the first hour and write it into `CONTRACT.md` via Person E.**

| actionType | Implementation |
|---|---|
| `send_message` | AppleScript → Messages. Resolve contact via `api.contacts.resolveAlias`. |
| `create_event` | AppleScript → Calendar |
| `read_screen` | `screencapture -x`, then describe it (OpenAI vision) and speak the result |
| `focus_mode` | DND on, hide/quit distracting apps, start a timer |
| `open_app` | `open -a "<App>"` |

**Ship `send_message` first — it is Beat 1 and Beat 2 of the demo.** The rest are bonus.

⚠️ **macOS permissions will bite you.** Automation, Accessibility, and Screen Recording all
require prompts, and they appear on the *terminal/VoiceOS* process, not your script. **Trigger
every one of these in the first hour**, not at 5:50pm in front of judges. Grant them in
System Settings → Privacy & Security.

⚠️ Demo safety: put the real recipient behind an env var. Seed contacts with a **teammate's**
number, not a real family member's. We will run this demo many times while testing.

---

## Task 5 — `mcp/voice.ts`, Deepgram playback

ShortVoice speaks in **its own voice**, distinct from VoiceOS's. Two voices in the room makes it
obvious to the audience which system is talking — it's a demo device, not a gimmick.

Call Person D's Convex HTTP action so the API key stays server-side:

```ts
const res = await fetch(`${process.env.CONVEX_SITE_URL}/tts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, voice: "aura-2-thalia-en" }),
});
// write bytes to a temp .mp3, then: afplay <file>
```

Fall back to macOS `say` if Deepgram or the network fails. **Never let TTS failure block an
action** — speak-and-execute must be independent code paths.

---

## Acceptance criteria

- [ ] Routing spike answered and posted to the team **within the first hour**
- [ ] `scripts/harness.ts` pushed early and working for A, B, and D
- [ ] All 8 tools implemented per `CONTRACT.md` §4, invoked successfully from VoiceOS by voice
- [ ] `send_message` actually sends an iMessage
- [ ] All macOS permissions granted and verified before 3pm
- [ ] Deepgram voice plays, with `say` fallback
- [ ] Nothing in the MCP server writes to `stdout`
- [ ] Pushed to `person-c/mcp-voiceos` by **4:30pm**

## If the routing spike fails

Do not panic and do not redesign. In order:
1. Sharpen the tool description (most failures are fixed here)
2. Adopt the `"short: ..."` prefix and make it part of the demo narrative — *"I address my
   translator by name"* reads as intentional design
3. Worst case, we demo through Person D's Deepgram listener path, which bypasses VoiceOS
   entirely. **Tell Person D immediately if we're heading there** — that becomes their priority.
