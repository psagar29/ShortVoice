# Person B — resolver branch notes

Everything Person B owns is implemented on `person-b/resolver`: vector-search
resolution with slot filling, live teaching, auto-suggest, network executors,
crons. This file is the handoff — read §2 if you are Person C, §3 if you are
Person E, §5 if something is on fire.

---

## 1. What's here

| File | What it is |
|---|---|
| `convex/resolver.ts` | `resolve`, `executeConfirmed`, `cancelPending`, `reportLocalResult` + the internal reads/writes they need |
| `convex/embeddings.ts` | `embed`, `embedBatch`, `reseedEmbeddings` |
| `convex/teach.ts` | `teachPhrase` — Beat 2 |
| `convex/learning.ts` | `maybeSuggest`, `pendingSuggestion`, `acceptSuggestion`, `dismissSuggestion` — Beat 3 |
| `convex/executors.ts` | `runNetworkAction` (Slack, web search) |
| `convex/crons.ts` | expires abandoned confirmations every minute |
| `convex/lib/*` | pure, deterministic helpers: tokens, ranking, slots, templates, speech, time, model client |
| `scripts/resolverEval.ts` | the acceptance harness — run it before the demo |

Nothing in `convex/lib/` touches Convex or the network except `lib/openai.ts`,
so the interesting logic is unit-testable without a deployment.

### The pipeline

```
utterance
  └─ stripInvocation           "short: school mom" -> "school mom"
  └─ canonicalKey              sorted content tokens: THE order-independence guarantee
  └─ embed  ─┐
             ├─ (parallel) resolveContext: contacts + lexicon + last 5 utterances
             └─ (parallel) events.log "heard"
  └─ ctx.vectorSearch phrases.by_embedding, limit 8, filter userId
  └─ hybrid rerank             dense + lexical coverage + explanation + usage prior
  └─ band
       ├─ STRONG ≥ 0.82   deterministic slots -> render -> confirm      (no model)
       ├─ WEAK   ≥ 0.65   one model call: choose / ask                  (1 call)
       └─ COLD   < 0.65   one model call: expand from personal context  (1 call)
  └─ pendingActions row + utterances row (with vector) + events
  └─ scheduler: learning.maybeSuggest   (never blocks resolve)
```

---

## 2. Contract point with Person C (MCP)

Convex cannot run AppleScript. `executeConfirmed` therefore returns **either** a
finished network action **or** a `localAction` for the Mac to perform:

```ts
// api.resolver.executeConfirmed({ userId }) -> ExecuteResult
{
  ok: boolean,
  speech: string,              // say this
  localAction?: {              // present ONLY for OS-level actions
    pendingId: Id<"pendingActions">,
    type: "send_message" | "create_event" | "read_screen" | "focus_mode" | "open_app",
    params: Record<string, unknown>,   // e.g. { contact: "mom", contactName: "Rashmi",
                                       //        phone: "+1555...", body: "..." }
    resolvedIntent: string,
  }
}
```

After performing it, call back so the state machine closes honestly and Person
D's feed shows the real outcome:

```ts
await client.action(api.resolver.reportLocalResult, {
  userId, pendingId, ok: true, detail: "sent via Messages",
});
```

If C never calls back, the row self-closes after 10s with
`result: "assumed executed (no callback from the MCP server)"`. The demo
survives; the record stays truthful.

**Params C can rely on**: `send_message` → `contact`, `contactName`, `phone`,
`body`; `create_event` → `title`, `when`, `whenIso`; `open_app` → `app`;
`focus_mode` → `minutes`; `read_screen` → `{}`.

Other functions C calls, all actions unless noted:

| MCP tool | Convex function |
|---|---|
| `shortvoice_say` | `api.resolver.resolve` |
| `shortvoice_confirm` | `api.resolver.executeConfirmed` |
| `shortvoice_cancel` | `api.resolver.cancelPending` |
| `shortvoice_teach` | `api.teach.teachPhrase` |
| `shortvoice_list_phrases` | `api.phrases.listPhrases` *(query, Person A)* |
| `shortvoice_check_suggestion` | `api.learning.pendingSuggestion` *(query)* |
| `shortvoice_accept_suggestion` | `api.learning.acceptSuggestion` |
| `shortvoice_forget` | `api.phrases.deactivate` *(mutation, Person A)* |

`resolve` also returns `band`, `latencyMs`, `actionType` and `phraseId` beyond
the contract's fields — additive, ignore them if you don't want them.

---

## 3. Integration (Person E) — the stub files

This branch carries a **temporary copy of Person A's surface** so the resolver
could be seeded, run and evaluated standalone. Every one of these files opens
with a `⚠️ TEMPORARY STUB` banner:

```
convex/lib/normalize.ts   convex/users.ts    convex/phrases.ts
convex/contacts.ts        convex/pending.ts  convex/events.ts
convex/seed.ts            convex/scrape.ts
```

**On merge: take Person A's version of all eight, unconditionally.**

```bash
git checkout --theirs convex/{users,phrases,contacts,pending,events,seed,scrape}.ts convex/lib/normalize.ts
```

They implement exactly the signatures in `CONTRACT.md` §5 and nothing more —
no B-owned code calls a function that only exists in a stub. Two things to
confirm with A after the swap:

1. `phrases.insertPhrase` **upserts** on `normalizedTrigger` (re-teaching a word
   replaces its meaning rather than duplicating it).
2. `pending.createPending` **supersedes** any existing `awaiting` row, so a
   stale "yes" cannot fire a question from two utterances ago.

If A's versions differ, B's copies show the behaviour the resolver expects.

---

## 4. Running it

```bash
npx convex env set OPENAI_API_KEY sk-...            # required for the model paths
npx convex env set SHORTVOICE_TZ America/Los_Angeles
npx convex env set SLACK_BOT_TOKEN xoxb-...         # optional
npx convex env set FIRECRAWL_API_KEY fc-...         # optional (Person A's searchWeb)
npx convex env set SHORTVOICE_LLM_MODEL gpt-4o-mini # optional override

npx convex run seed:seedDemo
npx convex run embeddings:reseedEmbeddings          # ALWAYS after a reseed
npx tsx scripts/resolverEval.ts                     # 10 acceptance checks
```

`seedDemo` inserts phrases with `embedding: []` because mutations cannot call
APIs. Until `reseedEmbeddings` runs they are invisible to vector search (they
still resolve lexically, but don't rely on it).

Last full run, offline backend, local deployment — **10/10**:

```
PASS  order independence: "neel later" == "later neel"
PASS  slot filling: "neel tomorrow" is the same phrase, different filler
PASS  Beat 1: "team pr tonight" carries the payload
      🔊 "Telling the project team you'll review the latest PR tonight. Say yes to send."
PASS  confirmation speech: ends with the ask, stays short          (14 words)
PASS  cold path: "mom flight friday" reaches the cold band
PASS  Beat 2: teach a word, then use it immediately
PASS  Beat 3: auto-suggest fires -> "late standup" from 3 similar requests
PASS  latency: p50 21ms · p95 26ms
PASS  events: every stage writes to the feed
PASS  state machine: a confirmed action fires once and only once
```

---

## 5. Decisions that differ from the task brief

**`embeddings.ts` is not `"use node"`.** A Node-runtime file cannot export
queries or mutations, and the reseed path needs both; the Node isolate also
costs cold-start time inside a 1.5s budget. `lib/openai.ts` is a small `fetch`
client instead of the SDK. The exported surface is unchanged.

**Retrieval is hybrid, not pure cosine.** A 2-4 word fragment gives a noisy
embedding, and the failure mode — a semantically adjacent phrase texting the
wrong person — is the worst thing that can happen on stage. The fused score in
`lib/rank.ts` is dense + lexical coverage + *explanation* (how much of the
utterance the phrase accounts for, slots included) + a small usage prior, with a
**margin rule**: if the top two candidates are within 0.07 the resolver asks
instead of guessing. Bands stay at the contract's 0.82 / 0.65.

**Slots are filled deterministically first.** `lib/slots.ts` resolves time and
contact slots from leftover tokens without a model, and falls back to the
trigger's own time word so `"neel later"` renders a complete sentence. The model
is called only for what is genuinely underdetermined, which is why the strong
path answers in ~20ms with zero API calls.

**Order independence is structural.** Both sides of retrieval are keyed through
`canonicalKey()` (sorted, de-duplicated content tokens), so `"neel later"` and
`"later neel"` produce the *identical* vector, not merely similar ones.

**There is an offline embedding fallback.** With no `OPENAI_API_KEY`,
`lib/hashembed.ts` produces hashed n-gram vectors in the same 1536 dimensions
and the whole pipeline keeps working — that is how the run above passed with no
network. The two vector spaces must never mix: the backend is chosen by
`hasOpenAI()` alone, and switching requires re-running `reseedEmbeddings`. A key
that is present but *failing* deliberately does not fall back here; the resolver
degrades to lexical ranking instead, which is honest rather than subtly wrong.
`learning.ts` scales its clustering threshold per backend (0.88 vs 0.42) since
cosine is not comparable across spaces.

**Every model call fails soft.** `chatJSON` returns `null` on timeout, 429 or
malformed output, and each caller has a deterministic fallback: rule-based
parsing in `teach`, a "did you mean X or Y?" in the weak band, frequency-based
trigger invention in `learning`. Nothing throws into VoiceOS.

**Extra functions beyond the contract** (all additive):
`resolver.reportLocalResult`, `resolver.sweepStalePending`,
`learning.dismissSuggestion`, `embeddings.embedBatch`.

---

## 6. Knobs, if the demo needs tuning

| Knob | Where | Default |
|---|---|---|
| strong / weak bands | `lib/rank.ts` `BANDS` | 0.82 / 0.65 |
| ambiguity margin | `lib/rank.ts` `AMBIGUITY_EPS` | 0.07 |
| signal weights | `lib/rank.ts` `W_*` | 0.45 / 0.28 / 0.22 / 0.05 |
| repeats before a suggestion | `learning.ts` `MIN_EVIDENCE` | 3 |
| cluster similarity | `learning.ts` `clusterThreshold()` | 0.88 (openai) |
| pending expiry | `crons.ts` `STALE_AFTER_MS` | 5 min |
| model | `SHORTVOICE_LLM_MODEL` env | `gpt-4o-mini` |
| timezone | `SHORTVOICE_TZ` env | `America/Los_Angeles` |
