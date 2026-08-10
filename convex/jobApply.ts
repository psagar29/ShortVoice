// ============================================================================
// ShortVoice -- job applications  (Person B)
// ============================================================================
// SIMULATED, on purpose. Discovery reads the hardcoded listings in
// lib/demoJobBoard.ts and submission marks our own rows submitted. No applicant
// tracking system is contacted, no credential is read, and the feature works
// with nothing configured -- which is also why the whole path costs one
// embedding-free round trip per staged row instead of three HTTP calls.
//
// What the demo still proves is the part that matters: matching is real,
// incomplete forms are routed to review instead of guessed at, and nothing is
// marked submitted until the person has said yes (see resolver.commitConfirm).
// ============================================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  DEMO_BOARD_NAME,
  findDemoJobListings,
  mapDemoApplicationForm,
  unansweredRequiredQuestions,
} from "./lib/demoJobBoard";
import { plural, prepareSpeech, submitSpeech } from "./lib/jobSpeech";

const PREPARE_LIMIT = 3;

type PrepareApplicationSummary = {
  applicationId: string;
  /** Id of the demo listing this row was staged from. */
  greenhouseJobId: number;
  jobTitle: string;
  jobLocation: string;
  status: "ready" | "review_required" | "failed";
  missingQuestions: Array<{ label: string; fieldNames: string[] }>;
};

type PrepareResult = {
  ok: boolean;
  batchId?: string;
  speech: string;
  readyCount: number;
  reviewRequiredCount: number;
  failedCount: number;
  skippedSubmittedCount: number;
  inProgressCount: number;
  applications: PrepareApplicationSummary[];
};

type SubmitResult = {
  ok: boolean;
  speech: string;
  submittedCount: number;
  failedCount: number;
  reviewRequiredCount: number;
  skippedCount: number;
};

export const prepare = action({
  args: {
    userId: v.id("users"),
    role: v.string(),
    location: v.string(),
  },
  handler: async (ctx, { userId, role, location }): Promise<PrepareResult> => {
    const requestedRole = role.trim();
    const requestedLocation = location.trim();
    if (!requestedRole) {
      return emptyPrepareResult("Tell me which role you want to apply for.");
    }

    const batchId = await ctx.runMutation(internal.jobApplicationData.createBatch, {
      userId,
      role: requestedRole,
      location: requestedLocation,
      companyName: DEMO_BOARD_NAME,
    });

    try {
      const listings = findDemoJobListings(requestedRole, requestedLocation, PREPARE_LIMIT);
      const profile = await ctx.runQuery(internal.jobApplicationData.getProfileInternal, {
        userId,
      });

      const applications: PrepareApplicationSummary[] = [];
      const applicationIds: Id<"jobApplications">[] = [];
      let readyCount = 0;
      let reviewRequiredCount = 0;
      let failedCount = 0;
      let skippedSubmittedCount = 0;
      let inProgressCount = 0;

      for (const listing of listings) {
        const mapped = mapDemoApplicationForm(listing, profile);
        const jobLocation = listing.location?.name?.trim() || "Location not listed";
        const staged = await ctx.runMutation(
          internal.jobApplicationData.upsertPreparedApplication,
          {
            userId,
            batchId,
            greenhouseJobId: listing.id,
            jobTitle: listing.title,
            companyName: listing.company_name?.trim() || DEMO_BOARD_NAME,
            jobLocation,
            jobUrl: listing.absolute_url,
            ...mapped,
          },
        );

        if (staged.state === "submitted") {
          skippedSubmittedCount++;
          continue;
        }
        if (staged.state === "submitting") {
          inProgressCount++;
          continue;
        }
        const status = staged.state === "failed" ? "failed" : mapped.status;
        if (status === "ready") readyCount++;
        else if (status === "review_required") reviewRequiredCount++;
        else failedCount++;
        applicationIds.push(staged.applicationId);
        applications.push({
          applicationId: String(staged.applicationId),
          greenhouseJobId: listing.id,
          jobTitle: listing.title,
          jobLocation,
          status,
          missingQuestions: mapped.missingQuestions,
        });
      }

      await ctx.runMutation(internal.jobApplicationData.finalizePreparedBatch, {
        userId,
        batchId,
        applicationIds,
        readyCount,
        reviewRequiredCount,
        failedCount,
        skippedSubmittedCount,
        inProgressCount,
      });

      return {
        ok: true,
        batchId: String(batchId),
        speech: prepareSpeech(
          listings.length,
          readyCount,
          reviewRequiredCount,
          failedCount,
          skippedSubmittedCount,
          inProgressCount,
        ),
        readyCount,
        reviewRequiredCount,
        failedCount,
        skippedSubmittedCount,
        inProgressCount,
        applications,
      };
    } catch (error) {
      const message = safeError(error, "I couldn't prepare those applications.");
      await ctx.runMutation(internal.jobApplicationData.failBatch, {
        userId,
        batchId,
        error: message,
      });
      return {
        ...emptyPrepareResult(message),
        batchId: String(batchId),
      };
    }
  },
});

/**
 * The only place a row becomes `submitted`. Reaching here means the person
 * heard the preview and said yes -- preparation never touches this path.
 * The send itself is simulated, but the lifecycle around it is not: rows are
 * claimed one at a time, a row that is no longer complete fails on its own, and
 * a row that already went out is never sent twice.
 */
export const submit = action({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
    applicationId: v.optional(v.id("jobApplications")),
  },
  handler: async (ctx, { userId, batchId, applicationId }): Promise<SubmitResult> => {
    const data = await ctx.runQuery(internal.jobApplicationData.getBatchInternal, {
      userId,
      batchId,
    });
    if (!data) return emptySubmitResult("I couldn't find that application batch.");

    const selected = applicationId
      ? data.applications.filter((row) => row._id === applicationId)
      : data.applications;
    if (applicationId && selected.length === 0) {
      return emptySubmitResult("That application is not part of this batch.");
    }

    const ready = selected.filter((row) => row.status === "ready");
    const reviewRequiredCount = selected.filter(
      (row) => row.status === "review_required",
    ).length;
    const skippedCount = selected.length - ready.length - reviewRequiredCount;
    if (ready.length === 0) {
      return {
        ok: reviewRequiredCount === 0,
        speech:
          reviewRequiredCount > 0
            ? `${reviewRequiredCount} ${plural(reviewRequiredCount, "application needs", "applications need")} review before I can submit.`
            : "There are no ready applications left to submit.",
        submittedCount: 0,
        failedCount: 0,
        reviewRequiredCount,
        skippedCount,
      };
    }

    const began = await ctx.runMutation(internal.jobApplicationData.markBatchSubmitting, {
      userId,
      batchId,
    });
    if (!began) {
      return {
        ...emptySubmitResult("This application batch is already being processed."),
        reviewRequiredCount,
        skippedCount,
      };
    }

    let submittedCount = 0;
    let failedCount = 0;

    try {
      for (const row of ready) {
        const claimed = await ctx.runMutation(internal.jobApplicationData.claimForSubmission, {
          userId,
          batchId,
          applicationId: row._id,
        });
        if (!claimed) continue;

        try {
          const unanswered = unansweredRequiredQuestions(
            claimed.formQuestions,
            claimed.answers,
            claimed.resumeAttached,
          );
          if (unanswered.length > 0) {
            throw new Error(`This form still needs ${unanswered.join(", ")}.`);
          }

          await ctx.runMutation(internal.jobApplicationData.finishSubmission, {
            userId,
            applicationId: claimed._id,
            ok: true,
          });
          submittedCount++;
        } catch (error) {
          const message = safeError(error, "That application didn't go through.");
          await ctx.runMutation(internal.jobApplicationData.finishSubmission, {
            userId,
            applicationId: claimed._id,
            ok: false,
            error: message,
          });
          failedCount++;
        }
      }
    } finally {
      await ctx.runMutation(internal.jobApplicationData.finalizeBatchSubmission, {
        userId,
        batchId,
      });
    }

    return {
      ok: failedCount === 0,
      speech: submitSpeech(submittedCount, failedCount, reviewRequiredCount),
      submittedCount,
      failedCount,
      reviewRequiredCount,
      skippedCount,
    };
  },
});

function emptyPrepareResult(speech: string): PrepareResult {
  return {
    ok: false,
    speech,
    readyCount: 0,
    reviewRequiredCount: 0,
    failedCount: 0,
    skippedSubmittedCount: 0,
    inProgressCount: 0,
    applications: [],
  };
}

function emptySubmitResult(speech: string): SubmitResult {
  return {
    ok: false,
    speech,
    submittedCount: 0,
    failedCount: 0,
    reviewRequiredCount: 0,
    skippedCount: 0,
  };
}

function safeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/\s+/g, " ").trim();
  return message ? message.slice(0, 240) : fallback;
}
