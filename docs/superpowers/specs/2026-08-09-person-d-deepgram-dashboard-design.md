# Person D — Deepgram voice + live Convex dashboard

Branch: `person-d/deepgram-dashboard`
Date: 2026-08-09

## Context discovered at start

`main` (here, `master`) held one commit: scaffold, `CONTRACT.md`, `docs/`, and `convex/schema.ts`.
No branch for Person A, B, or C existed. The shared deployment `reminiscent-anteater-318`
answered `/version` but held zero functions — `users:getUser` returned *"Could not find public
function"*.

Every query the dashboard is specified to make (`api.phrases.listPhrases`, `api.events.feed`,
`api.pending.getAwaiting`, `api.learning.pendingSuggestion`) and every write the demo depends on
(`api.resolver.resolve`, `api.teach.teachPhrase`) therefore had nothing behind it.

## What actually happened

The premise above was wrong, and finding that out cost real time. A and B had not
*pushed to GitHub* yet, but they were working, and both landed mid-session:
`person-a/convex-core` and `person-b/resolver` (a superset of A's). Meanwhile all four of
us were pointed at one Convex deployment, where `npx convex dev` replaces the deployment's
**entire** function set with whatever is in the pusher's local `convex/` directory.

The consequences played out exactly as `CONTRACT.md` §3 predicts:

1. Deploying D's stub tree deleted A's deployed functions.
2. A's next push deleted D's `http.ts` — all three routes 404'd with
   *"this deployment does not have HTTP actions enabled"* — and B's functions with it.
3. The only stable state is a tree containing everyone's files, which is Person E's job.

So the stub layer was **reverted** (commit `3864ca9`) once B's real code was on GitHub, and
branch D now contains only `convex/http.ts` and `web/**`. A local integration branch
(B's branch merged with D's — it merges clean, the two are disjoint) was deployed to
restore A + B + D together, since the deployment had been left with A only and B's
resolver missing.

**B's signatures matched `CONTRACT.md` exactly, so the dashboard needed no changes.** The
one adjustment was cosmetic: B logs `detail.score` and `detail.band` on a resolved event,
not `detail.matchScore`. That is the whole return on coding against a frozen contract.

## Original decisions (superseded where noted)

**1. A quarantined A/B stub surface, landed as a separate revertable commit.** *(Reverted —
see above. It did its job: it kept the dashboard runnable and verifiable for the hours
before A and B pushed.)*

Without a backend the dashboard can be written but not run, and none of PERSON_D.md's acceptance
criteria can be demonstrated. So we land the function surface exactly as frozen in `CONTRACT.md`
§5 — same module paths, same export names, same argument and return shapes — in one commit
labelled `TEMP: stub A/B surface`. Person E reverts that single commit at integration; because
`web/` only ever touches frozen signatures, no dashboard code changes when A and B's real
implementations arrive.

The stubs are honest about being stubs:

- No `OPENAI_API_KEY` is available, so `resolver.resolve` does **not** embed and vector-search.
  It scores candidates by normalized-token overlap (`normalizeTrigger` from `CONTRACT.md` §5,
  order-independent) and fills slots from leftover tokens with a small date/time lexicon.
  Order-independence and slot-filling — the two properties `CONTRACT.md` §6 calls
  non-negotiable — are preserved. Semantic matching is not, and the file says so.
- `embeddings.embed` returns a deterministic hash-derived 1536-vector so rows satisfy the frozen
  schema and the vector index stays populated. It is not semantic.

**2. Everything in D's ownership lane is built for real.**

### `convex/http.ts`

| Route | Purpose |
|---|---|
| `POST /tts` | `{ text, voice? }` → `audio/mpeg` from Deepgram aura-2. Keeps `DEEPGRAM_API_KEY` in Convex env, never in the browser. |
| `GET /keyterms?userId=` | `{ keyterms: string[] }` — every active trigger plus every contact alias, for `nova-3` keyterm priming. |
| `POST /listen-token` | Short-lived Deepgram key for the browser listener, so the raw key is never shipped. |
| `OPTIONS` on all three | CORS preflight, or the browser blocks every one of them. |

Served from `https://reminiscent-anteater-318.convex.site`, not `.convex.cloud`.

### `web/` — Next.js App Router, its own `package.json`

```
app/layout.tsx, app/page.tsx        projector dashboard
app/providers.tsx                   ConvexReactClient
components/Header.tsx               ● listening · "N words → M meant" · mute toggle
components/HeardMeant.tsx           three words left, full sentence right, animated
components/Vocabulary.tsx           phrase list, new rows glow and fade
components/PendingCard.tsx          ⏳ awaiting "yes"
components/SuggestionCard.tsx       appears on its own
components/Feed.tsx                 heard → resolved → awaiting → confirmed → executed
lib/useListener.ts                  mic → Deepgram nova-3 WS → api.resolver.resolve
lib/useSpeaker.ts                   /tts playback, mute-by-default
```

Every panel is a `useQuery` subscription. No polling, no refresh buttons, no `useEffect` refetch.
That is the Convex proof and it is the one thing that cannot be compromised.

The word-count ratio is computed client-side from the `events` feed (sum of `heard` text lengths
vs `resolved` text lengths), since `api.stats` was optional and A never shipped it.

## Non-goals

- Semantic resolution (Person B's work — the stub is a placeholder, not a substitute).
- Mid-stream keyterm updates via Flux. Listed last in the brief's own priority order; attempted
  only if everything above is solid.
- Any change to `convex/schema.ts`, `mcp/`, or the root `package.json`.

## Acceptance

Mirrors PERSON_D.md's checklist: `/tts` returns playable audio; `/keyterms` returns live triggers;
dashboard is 100% subscriptions; teaching a phrase makes it appear with no refresh; HEARD → MEANT
legible at 1280×720 zoomed 150%; listener transcribes `"school mom"` with keyterms on; suggestion
card appears unprompted.

## Risk

`DEEPGRAM_API_KEY` must be set in Convex env (`npx convex env set`). Until it is, `/tts` and
`/listen-token` return 500 and Tasks 3 and 4 cannot be verified — the dashboard and `/keyterms`
are unaffected.
