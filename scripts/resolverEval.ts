/**
 * ShortVoice -- resolver acceptance harness  (Person B)
 *
 *   npx tsx scripts/resolverEval.ts            # against CONVEX_URL (.env.local/.env)
 *   npx tsx scripts/resolverEval.ts --seed     # wipe + reseed + backfill first
 *
 * (No npm script: package.json is frozen by CONTRACT.md §7.)
 *
 * Every check here is one line from the acceptance criteria in docs/PERSON_B.md.
 * Run it before the demo. Run it after anybody touches the resolver. The point
 * is to find out at 3pm that "later neel" broke, not at 6:01pm on stage.
 *
 * Person C's scripts/harness.ts is a different tool and this does not replace it.
 */

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function convexUrl(): string {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  for (const file of [".env.local", ".env"]) {
    try {
      const match = readFileSync(file, "utf8").match(/^CONVEX_URL=(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      /* keep looking */
    }
  }
  throw new Error("No CONVEX_URL. Set it, or run `npx convex dev` to write .env.local.");
}

const client = new ConvexHttpClient(convexUrl());
const shouldSeed = process.argv.includes("--seed");

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): boolean {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}\n      ${detail}`);
  return ok;
}

/** Resolve, then clear the pending action so checks cannot bleed into each other. */
async function say(userId: Id<"users">, utterance: string) {
  const result = await client.action(api.resolver.resolve, { userId, utterance });
  await client.action(api.resolver.cancelPending, { userId });
  return result;
}

/** Resolve and leave the pending action standing, for checks about confirming. */
async function ask(userId: Id<"users">, utterance: string) {
  return await client.action(api.resolver.resolve, { userId, utterance });
}

const intentOf = (r: any) => (r.kind === "confirm" ? r.resolvedIntent : r.speech);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nShortVoice resolver eval -> ${convexUrl()}\n`);

  if (shouldSeed) {
    await client.mutation(api.seed.seedDemo, {});
    const reseed = await client.action(api.embeddings.reseedEmbeddings, {});
    console.log(
      `seeded; embedded ${reseed.phrases} phrases / ${reseed.utterances} utterances ` +
        `via ${reseed.backend}\n`,
    );
  }

  const userId = await client.mutation(api.users.getOrCreateDemoUser, {});

  // 1 -- order independence -------------------------------------------------
  const a = await say(userId, "neel later");
  const b = await say(userId, "later neel");
  record(
    'order independence: "neel later" == "later neel"',
    a.kind === "confirm" &&
      b.kind === "confirm" &&
      (a as any).phraseId === (b as any).phraseId &&
      (a as any).resolvedIntent === (b as any).resolvedIntent,
    `${a.kind}/${b.kind} :: "${intentOf(a)}" vs "${intentOf(b)}"`,
  );

  // 2 -- slot filling -------------------------------------------------------
  const c = await say(userId, "neel tomorrow");
  record(
    'slot filling: "neel tomorrow" is the same phrase, different filler',
    c.kind === "confirm" &&
      (c as any).phraseId === (a as any).phraseId &&
      /tomorrow/i.test((c as any).resolvedIntent) &&
      (c as any).resolvedIntent !== (a as any).resolvedIntent,
    `"${intentOf(c)}"`,
  );

  // 3 -- Beat 1 -------------------------------------------------------------
  const beat1 = await say(userId, "team pr tonight");
  record(
    'Beat 1: "team pr tonight" carries the payload',
    beat1.kind === "confirm" &&
      /PR/i.test((beat1 as any).confirmationSpeech) &&
      /tonight/i.test((beat1 as any).confirmationSpeech),
    `🔊 "${(beat1 as any).confirmationSpeech ?? intentOf(beat1)}"`,
  );

  // 4 -- confirmation speech shape -----------------------------------------
  const speech: string = (beat1 as any).confirmationSpeech ?? "";
  const words = speech.trim().split(/\s+/).length;
  record(
    "confirmation speech: ends with the ask, stays short",
    /say yes/i.test(speech) && words <= 22,
    `${words} words, ends "${speech.split(".").filter(Boolean).at(-1)?.trim()}"`,
  );

  // 5 -- cold path ----------------------------------------------------------
  // seed:seedDemo teaches "mom flight friday" (CONTRACT.md §6's example), so
  // the untaught-utterance property needs a fragment the seed doesn't cover.
  const cold = await say(userId, "dad dinner sunday");
  record(
    'cold path: "dad dinner sunday" reaches the cold band with no taught phrase',
    (cold as any).band === "cold",
    cold.kind === "confirm"
      ? `expanded -> "${(cold as any).confirmationSpeech}"`
      : `no model available, degraded honestly: "${(cold as any).speech}"`,
  );

  // 6 -- Beat 2: teach, then use it cold ------------------------------------
  const taught = await client.action(api.teach.teachPhrase, {
    userId,
    trigger: "school mom",
    meaning: "text Mom that I'm leaving school and heading home",
  });
  const used = await say(userId, "school mom");
  record(
    "Beat 2: teach a word, then use it immediately",
    taught.ok &&
      used.kind === "confirm" &&
      (used as any).phraseId === taught.phraseId &&
      /mom/i.test((used as any).confirmationSpeech),
    `🔊 "${taught.speech}" then 🔊 "${(used as any).confirmationSpeech ?? intentOf(used)}"`,
  );

  // 7 -- Beat 3: the system offers a word -----------------------------------
  let suggestion = await client.query(api.learning.pendingSuggestion, { userId });
  for (let i = 0; i < 10 && !suggestion; i++) {
    await new Promise((r) => setTimeout(r, 500)); // maybeSuggest runs scheduled
    suggestion = await client.query(api.learning.pendingSuggestion, { userId });
  }
  const triggerWords = suggestion?.proposedTrigger.trim().split(/\s+/).length ?? 0;
  record(
    "Beat 3: auto-suggest fires off the seeded history with a 1-2 word trigger",
    Boolean(suggestion) && triggerWords >= 1 && triggerWords <= 2,
    suggestion
      ? `"${suggestion.proposedTrigger}" from ${suggestion.evidenceCount} similar requests`
      : "no suggestion appeared (did you seed, and did reseedEmbeddings run?)",
  );

  // 8 -- latency ------------------------------------------------------------
  const utterances = [
    "neel later",
    "team pr tonight",
    "school mom",
    "neel tomorrow",
    "heads down",
    "later neel",
    "team pr tomorrow",
    "school mom",
    "neel friday",
    "heads down",
  ];
  const timings: number[] = [];
  for (const u of utterances) {
    const started = Date.now();
    await say(userId, u);
    timings.push(Date.now() - started);
  }
  timings.sort((x, y) => x - y);
  const p50 = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  record(
    "latency: p50 under 1.5s end to end",
    p50 < 1500,
    `p50 ${p50}ms · p95 ${p95}ms · worst ${timings.at(-1)}ms (includes network round trip)`,
  );

  // 9 -- the feed Person D's dashboard is built on --------------------------
  const feed = await client.query(api.events.feed, { userId, limit: 60 });
  const kinds = new Set(feed.map((e) => e.kind));
  record(
    "events: every stage writes to the feed",
    ["heard", "resolved", "awaiting", "taught", "cancelled"].every((k) => kinds.has(k as any)),
    `kinds seen: ${[...kinds].join(", ")}`,
  );

  // 10 -- the confirmation state machine ------------------------------------
  await client.action(api.resolver.resolve, { userId, utterance: "team pr tonight" });
  const executed = await client.action(api.resolver.executeConfirmed, { userId });
  const nothing = await client.action(api.resolver.executeConfirmed, { userId });
  record(
    "state machine: a confirmed action fires once and only once",
    executed.ok && !nothing.ok && /nothing/i.test(nothing.speech),
    `🔊 "${executed.speech}" then 🔊 "${nothing.speech}"`,
  );

  // 11..15 -- job_apply, end to end ----------------------------------------
  // These need a clean slate: an application already submitted is deliberately
  // never sent again, so a rerun without --seed has nothing left to confirm.
  await jobApplyChecks(userId);

  // ------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed${
      failed.length ? `: ${failed.map((f) => f.name).join("; ")}` : ""
    }\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// job_apply
// ---------------------------------------------------------------------------

/**
 * The whole two-phase shape, against real rows: a reordered utterance reaches
 * job_apply, preparation stages without sending, the "yes" is the only thing
 * that submits, the same job is never submitted twice, and a review row can be
 * answered and then sent on its own.
 *
 * The board itself is simulated (convex/lib/demoJobBoard.ts), so nothing here
 * contacts an applicant tracking system. What is being checked is our own
 * lifecycle, which is the part that could lie.
 */
async function jobApplyChecks(userId: Id<"users">) {
  // A profile complete enough for a row to be `ready`. `resume_text` stands in
  // for an uploaded file -- the Resume question carries a textarea beside its
  // file field precisely so the form can be completed without one.
  await client.mutation(api.jobProfiles.saveProfile, {
    userId,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+1 415 555 0142",
    location: "San Francisco, CA",
    workAuthorization: "Yes",
    defaultAnswers: [{ key: "resume_text", value: "Ada Lovelace, AI engineer." }],
  });

  await client.action(api.teach.teachPhrase, {
    userId,
    trigger: "apply ai",
    meaning: "apply to AI Engineer roles in San Francisco",
  });

  // Reordered on purpose: retrieval keys are canonical, so "ai apply" and
  // "apply ai" are the same question.
  const asked = await ask(userId, "ai apply");
  const pending = await client.query(api.pending.getAwaiting, { userId });
  const paramKeys = Object.keys((pending?.params ?? {}) as Record<string, unknown>);
  const stagedBefore = await client.query(api.jobApplicationData.listForUser, { userId });
  const readyBefore = stagedBefore.filter((row) => row.status === "ready");

  const previewed = record(
    "job_apply: a reordered utterance stages a batch and asks before sending",
    asked.kind === "confirm" &&
      (asked as any).actionType === "job_apply" &&
      pending !== null &&
      paramKeys.join(",") === "batchId",
    asked.kind === "confirm"
      ? `🔊 "${(asked as any).confirmationSpeech}" · pending params: ${paramKeys.join(", ") || "(none)"}`
      : `resolved to ${asked.kind}: "${(asked as any).speech}"`,
  );

  record(
    "job_apply: preparation submits nothing and the preview counts the real rows",
    previewed &&
      stagedBefore.length > 0 &&
      stagedBefore.every((row) => row.status === "ready" || row.status === "review_required") &&
      typeof (asked as any).confirmationSpeech === "string" &&
      (asked as any).confirmationSpeech.includes(`${readyBefore.length} ready`),
    `${stagedBefore.length} staged · ${readyBefore.length} ready · ` +
      `${stagedBefore.filter((r) => r.status === "review_required").length} to review · ` +
      `${stagedBefore.filter((r) => r.status === "submitted").length} submitted before the yes`,
  );

  const executed = await client.action(api.resolver.executeConfirmed, { userId });
  const afterSubmit = await client.query(api.jobApplicationData.listForUser, { userId });
  const submitted = afterSubmit.filter((row) => row.status === "submitted");
  record(
    "job_apply: only the yes submits, and it says how many truthfully",
    executed.ok &&
      typeof executed.speech === "string" &&
      submitted.length === readyBefore.length &&
      executed.speech.startsWith(`Submitted ${submitted.length}`),
    `🔊 "${executed.speech}" · ${submitted.length} rows now submitted`,
  );

  // Asking again re-ranks the same three listings; the submitted ones are
  // skipped, which leaves nothing ready and therefore nothing to say yes to.
  const again = await ask(userId, "apply ai");
  const pendingAgain = await client.query(api.pending.getAwaiting, { userId });
  const afterRepeat = await client.query(api.jobApplicationData.listForUser, { userId });
  record(
    "job_apply: the same job is never submitted twice, and leaves no pending row",
    again.kind !== "confirm" &&
      pendingAgain === null &&
      afterRepeat.filter((row) => row.status === "submitted").length === submitted.length,
    `${again.kind}: "${(again as any).speech ?? (again as any).confirmationSpeech}"`,
  );

  // The review row: answer it, watch it become ready, then send that one alone.
  const review = afterRepeat.find((row) => row.status === "review_required");
  if (!review) {
    record(
      "job_apply: a review row can be answered, then submitted on its own",
      false,
      "no review_required row was staged (rerun with --seed for a clean slate)",
    );
    return;
  }

  const answers = review.missingQuestions.flatMap((question) =>
    question.fieldNames.map((field) => ({ field, value: "Because the applied team ships." })),
  );
  const saved = await client.mutation(api.jobApplicationData.saveReviewAnswers, {
    userId,
    applicationId: review._id,
    answers,
  });
  const sent = await client.action(api.jobApply.submit, {
    userId,
    batchId: review.batchId,
    applicationId: review._id,
  });
  const finalRows = await client.query(api.jobApplicationData.listForUser, { userId });
  const finalReview = finalRows.find((row) => row._id === review._id);
  record(
    "job_apply: a review row can be answered, then submitted on its own",
    saved.status === "ready" &&
      sent.ok &&
      sent.submittedCount === 1 &&
      finalReview?.status === "submitted",
    `answered "${review.missingQuestions.map((q) => q.label).join("; ")}" -> ${saved.status}; ` +
      `🔊 "${sent.speech}"`,
  );
}

main().catch((err) => {
  console.error("\neval crashed:", err);
  process.exit(1);
});
