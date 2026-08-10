// Focused tests for the simulated job board that backs `job_apply`.
// Run: npx tsx --test scripts/demoJobBoard.test.ts
//
// Four things are worth proving here. That the matching over the demo fixtures
// is real: the utterance changes the results, and an unrelated role gets none.
// That a taught "apply ..." phrase still becomes a job_apply intent with a role
// and a location when the model is unreachable. That every number the person
// hears comes from rows that actually exist. And that nothing in the repo talks
// to a live ATS any more -- the last two tests fail if a network call or a
// credential read comes back.
//
// Everything below is pure. The parts of `job_apply` that need a database --
// idempotency across batches, per-row failure, the review-answer round trip --
// are exercised by scripts/resolverEval.ts against a running deployment.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEMO_JOB_LISTINGS,
  findDemoJobListings,
  mapDemoApplicationForm,
  rankDemoJobListings,
  unansweredRequiredQuestions,
  type DemoJobListing,
} from "../convex/lib/demoJobBoard";
import { prepareSpeech, submitSpeech } from "../convex/lib/jobSpeech";
import { paramsForParsedMeaning, parseMeaningWithRules } from "../convex/lib/teachRules";
import { askFor, executedSpeech } from "../convex/lib/speech";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the demo utterance finds three believable roles", () => {
  const found = findDemoJobListings("AI Engineer", "SF");

  assert.deepEqual(
    found.map((job) => `${job.title} - ${job.company_name} - ${job.location?.name}`),
    [
      "AI Engineer - Lumen Labs - San Francisco, CA",
      "Senior AI Engineer, Applied - Halcyon AI - San Francisco, CA",
      "AI Engineer, Inference - Foundry Systems - Palo Alto, CA",
    ],
  );
});

test("a different role gets different demo jobs", () => {
  const found = findDemoJobListings("machine learning engineer", "San Francisco");

  assert.equal(found[0].id, 4184);
  assert.equal(found[0].title, "Machine Learning Engineer, Ranking");
  assert.notDeepEqual(
    found.map((job) => job.id),
    findDemoJobListings("AI Engineer", "SF").map((job) => job.id),
  );
});

test("a role nobody on the board hires for matches nothing", () => {
  assert.deepEqual(findDemoJobListings("dental hygienist", "SF"), []);
});

test("ranks role and location matches with common aliases", () => {
  const jobs = [
    {
      id: 1,
      title: "Product Manager",
      absolute_url: "https://example.test/1",
      location: { name: "San Francisco, CA" },
    },
    {
      id: 2,
      title: "Senior AI Engineer",
      absolute_url: "https://example.test/2",
      location: { name: "San Francisco, CA" },
    },
    {
      id: 3,
      title: "AI Engineer",
      absolute_url: "https://example.test/3",
      location: { name: "New York City" },
    },
  ];

  const ranked = rankDemoJobListings(jobs, "AI Engineer", "SF");
  assert.deepEqual(
    ranked.map((job) => job.id),
    [2, 3],
  );
});

test("routes an application to review when there is no profile", () => {
  const mapped = mapDemoApplicationForm(listing(4181), null);

  assert.equal(mapped.status, "review_required");
  assert.deepEqual(
    mapped.missingQuestions.map((question) => question.label),
    [
      "First Name",
      "Last Name",
      "Email",
      "Resume",
      "Are you authorized to work in the United States?",
    ],
  );
});

test("a saved profile stages a ready row with mapped answers", () => {
  const mapped = mapDemoApplicationForm(listing(4181), completeProfile());

  assert.equal(mapped.status, "ready");
  assert.equal(mapped.resumeAttached, true);
  assert.deepEqual(mapped.missingQuestions, []);
  assert.deepEqual(
    Object.fromEntries(mapped.answers.map((answer) => [answer.field, answer.value])),
    {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.test",
      phone: "+1 415 555 0142",
      "urls[LinkedIn]": "https://linkedin.test/in/ada",
      // "Yes" resolved to the option's stored value.
      question_work_authorization: "1",
    },
  );
});

test("one demo listing always needs review, and the review queue can finish it", () => {
  const mapped = mapDemoApplicationForm(listing(4182), completeProfile());

  assert.equal(mapped.status, "review_required");
  assert.deepEqual(
    mapped.missingQuestions.map((question) => question.label),
    ["Why do you want to work on applied AI at Halcyon?"],
  );
  // saveReviewAnswers refuses file fields, so the missing question has to be
  // one a person can actually type an answer to.
  const missingFields = mapped.formQuestions
    .filter((question) => question.label.startsWith("Why do you want"))
    .flatMap((question) => question.fields);
  assert.deepEqual(
    missingFields.map((field) => field.type),
    ["textarea"],
  );
});

test("default answers fill multi-select questions with option values", () => {
  const mapped = mapDemoApplicationForm(listing(4183), {
    ...completeProfile(),
    defaultAnswers: [
      {
        key: "Which inference stacks have you shipped to production?",
        value: ["vLLM", "Triton"],
      },
    ],
  });

  assert.equal(mapped.status, "ready");
  assert.deepEqual(
    mapped.answers.find((answer) => answer.field === "question_inference_stacks")?.value,
    ["vllm", "triton"],
  );
});

test("a row that lost its resume fails at submit time instead of reporting success", () => {
  const mapped = mapDemoApplicationForm(listing(4181), completeProfile());

  assert.deepEqual(
    unansweredRequiredQuestions(mapped.formQuestions, mapped.answers, false),
    ["Resume"],
  );
  assert.deepEqual(
    unansweredRequiredQuestions(mapped.formQuestions, mapped.answers, true),
    [],
  );
});

// ---------------------------------------------------------------------------
// Teaching "apply ..." with no model in reach
// ---------------------------------------------------------------------------

test("the model-free teach fallback turns an apply sentence into job_apply params", () => {
  const parsed = parseMeaningWithRules("apply to AI Engineer roles in San Francisco", []);

  assert.equal(parsed.actionType, "job_apply");
  assert.deepEqual(paramsForParsedMeaning(parsed), {
    role: "AI Engineer roles",
    location: "San Francisco",
  });
});

test("reordered and nearby apply phrasings all reach the same three roles", () => {
  const expected = findDemoJobListings("AI Engineer", "SF").map((job) => job.id);
  assert.deepEqual(expected, [4181, 4182, 4183]);

  const phrasings = [
    "Apply AI Engineer SF",
    "apply for AI engineer jobs in SF",
    "apply to ai engineer roles near San Francisco",
    "apply to AI Engineer roles in San Francisco",
  ];

  for (const phrasing of phrasings) {
    const parsed = parseMeaningWithRules(phrasing, []);
    assert.equal(parsed.actionType, "job_apply", phrasing);

    const params = paramsForParsedMeaning(parsed) as { role: string; location: string };
    assert.ok(params.role.trim().length > 0, `${phrasing} produced no role`);
    assert.deepEqual(
      findDemoJobListings(params.role, params.location).map((job) => job.id),
      expected,
      phrasing,
    );
  }
});

test("the fallback does not steal meanings that are not job applications", () => {
  const message = parseMeaningWithRules("text Mom that I'm leaving school", []);
  assert.equal(message.actionType, "send_message");
  assert.equal(message.role, "");

  const search = parseMeaningWithRules("look up flights to Boston", []);
  assert.equal(search.actionType, "web_search");
});

// ---------------------------------------------------------------------------
// What the person actually hears
// ---------------------------------------------------------------------------

test("the preview speaks the counts the staged rows actually have", () => {
  const found = findDemoJobListings("AI Engineer", "SF");
  const staged = found.map((job) => mapDemoApplicationForm(job, completeProfile()));
  const ready = staged.filter((row) => row.status === "ready").length;
  const review = staged.filter((row) => row.status === "review_required").length;

  // Every staged row is accounted for by exactly one count.
  assert.equal(ready + review, found.length);
  assert.equal(
    prepareSpeech(found.length, ready, review, 0, 0, 0),
    "I found 3 roles; 2 ready; 1 needs review. Apply to the ready ones?",
  );
});

test("the preview never invents a count and never claims a submission", () => {
  const cases: Array<[found: number, ready: number, review: number]> = [
    [3, 2, 1],
    [3, 3, 0],
    [1, 1, 0],
    [2, 0, 2],
  ];

  for (const [found, ready, review] of cases) {
    const speech = prepareSpeech(found, ready, review, 0, 0, 0);
    const label = `${found}/${ready}/${review}`;

    assert.match(speech, new RegExp(`^I found ${found} role`), label);
    assert.equal(speech.includes(`${ready} ready`), ready > 0, label);
    assert.equal(speech.includes(`${review} need`), review > 0, label);
    // Only ask for a "yes" there is something to do with.
    assert.equal(speech.includes("Apply to the ready"), ready > 0, label);
    assert.doesNotMatch(speech, /submitted/i, label);
  }
});

test("nothing found is said plainly, and nothing ready is never a question", () => {
  assert.equal(
    prepareSpeech(0, 0, 0, 0, 0, 0),
    "I didn't find a matching role on this board.",
  );
  assert.equal(prepareSpeech(1, 0, 1, 0, 0, 0), "I found 1 role; 1 needs review.");
});

test("the submission report counts only what went out", () => {
  assert.equal(submitSpeech(2, 0, 1), "Submitted 2; 1 still needs review.");
  assert.equal(submitSpeech(1, 1, 0), "Submitted 1; 1 failed.");
  // A batch where every row failed must not sound like a success.
  assert.equal(submitSpeech(0, 2, 0), "2 failed.");
  assert.equal(submitSpeech(0, 0, 0), "No applications were submitted.");
});

test("job_apply speech is a plain string that is spoken once, not decorated", () => {
  const detail = submitSpeech(2, 0, 1);
  const spoken = executedSpeech("job_apply", detail);

  assert.equal(typeof spoken, "string");
  // The executor's sentence already carries the counts; prefixing a second
  // sentence would say the same thing twice.
  assert.equal(spoken, detail);
  assert.equal(spoken.indexOf(detail), spoken.lastIndexOf(detail));
  assert.equal(executedSpeech("job_apply"), "Your applications are in.");
  assert.equal(askFor("job_apply"), "Say yes to apply.");
});

test("a failed row's stored answers still satisfy the form, so Retry can revalidate it", () => {
  // The review row, completed the way the queue completes it.
  const mapped = mapDemoApplicationForm(listing(4182), completeProfile());
  const stored = [
    ...mapped.answers,
    { field: "question_why_halcyon", value: "Because the applied team ships." },
  ];

  // Retry saves no new answers; revalidation runs over the stored ones alone,
  // which is what lifts the row back to `ready` before it is submitted again.
  assert.deepEqual(unansweredRequiredQuestions(mapped.formQuestions, stored, true), []);
  // And the same check still fails that one row honestly if the résumé is gone.
  assert.deepEqual(unansweredRequiredQuestions(mapped.formQuestions, stored, false), ["Resume"]);
});

// ---------------------------------------------------------------------------
// No live integration
// ---------------------------------------------------------------------------

test("the job application path makes no network call at all", () => {
  for (const file of ["convex/jobApply.ts", "convex/lib/demoJobBoard.ts", "convex/lib/jobSpeech.ts"]) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    assert.equal(source.includes("fetch("), false, `${file} performs a request`);
    assert.equal(source.includes("process.env"), false, `${file} reads an environment variable`);
  }
});

test("no live ATS call or credential read survives anywhere in the backend", () => {
  // Assembled at runtime so this test does not match itself.
  const forbidden = [
    "greenhouse" + ".io",
    "GREENHOUSE" + "_BOARD_TOKEN",
    "GREENHOUSE" + "_JOB_BOARD_API_KEY",
    "GREENHOUSE" + "_COMPANY_NAME",
  ];

  const offenders: string[] = [];
  for (const file of sourceFiles(["convex", "mcp", "scripts", "web/app", "web/lib", "web/components"])) {
    const source = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (source.includes(needle)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${needle}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("the dashboard names no integration it does not have", () => {
  // The one surviving use of the word is the `greenhouseJobId` column, which is
  // a schema name the backend still carries. Nothing user-facing may say it.
  const offenders = sourceFiles(["web/app", "web/lib", "web/components"]).filter((file) =>
    /greenhouse/i.test(readFileSync(file, "utf8")),
  );

  assert.deepEqual(
    offenders.map((file) => path.relative(REPO_ROOT, file)),
    [],
  );
});

/** Hand-written sources only: build output and installed packages are not ours. */
function sourceFiles(directories: string[]) {
  return directories.flatMap((directory) =>
    readdirSync(path.join(REPO_ROOT, directory), { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
      .filter((entry) => !entry.split(path.sep).some((part) => part === "node_modules" || part === ".next"))
      .map((entry) => path.join(REPO_ROOT, directory, entry)),
  );
}

function listing(id: number): DemoJobListing {
  const found = DEMO_JOB_LISTINGS.find((job) => job.id === id);
  assert.ok(found, `demo listing ${id} is missing`);
  return found;
}

function completeProfile() {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+1 415 555 0142",
    linkedInUrl: "https://linkedin.test/in/ada",
    workAuthorization: "Yes",
    defaultAnswers: [],
    resumeStorageId: "storage-id",
  };
}
