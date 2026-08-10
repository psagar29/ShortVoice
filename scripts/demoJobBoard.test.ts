// Focused tests for the simulated job board that backs `job_apply`.
// Run: npx tsx --test scripts/demoJobBoard.test.ts
//
// Two things are worth proving here. First, that the matching over the demo
// fixtures is real: the utterance changes the results, and an unrelated role
// gets none. Second, that nothing in the repo talks to a live ATS any more --
// the last test fails if a network call or a credential read comes back.

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

test("no live ATS call or credential read survives anywhere in the backend", () => {
  // Assembled at runtime so this test does not match itself.
  const forbidden = [
    "greenhouse" + ".io",
    "GREENHOUSE" + "_BOARD_TOKEN",
    "GREENHOUSE" + "_JOB_BOARD_API_KEY",
    "GREENHOUSE" + "_COMPANY_NAME",
  ];

  const offenders: string[] = [];
  for (const file of sourceFiles(["convex", "mcp", "scripts"])) {
    const source = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (source.includes(needle)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${needle}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

function sourceFiles(directories: string[]) {
  return directories.flatMap((directory) =>
    readdirSync(path.join(REPO_ROOT, directory), { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
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
