import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { jobApplicationStatus } from "./schema";

const answerValue = v.union(v.string(), v.array(v.string()));
const applicationAnswer = v.object({
  field: v.string(),
  value: answerValue,
});
const applicationFormField = v.object({
  name: v.string(),
  type: v.string(),
  values: v.optional(
    v.array(
      v.object({
        label: v.string(),
        value: v.string(),
      }),
    ),
  ),
});
const applicationFormQuestion = v.object({
  label: v.string(),
  required: v.boolean(),
  fields: v.array(applicationFormField),
});
const missingQuestion = v.object({
  label: v.string(),
  fieldNames: v.array(v.string()),
});

export const getBatch = query({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
  },
  handler: async (ctx, { userId, batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) return null;
    const applications = await Promise.all(batch.applicationIds.map((id) => ctx.db.get(id)));
    return {
      ...batch,
      applications: applications.filter(isPresent),
    };
  },
});

export const listForUser = query({
  args: {
    userId: v.id("users"),
    status: v.optional(jobApplicationStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, status, limit }) => {
    const take = Math.max(1, Math.min(100, Math.floor(limit ?? 50)));
    if (status) {
      return await ctx.db
        .query("jobApplications")
        .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
        .order("desc")
        .take(take);
    }
    return await ctx.db
      .query("jobApplications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(take);
  },
});

export const saveReviewAnswers = mutation({
  args: {
    userId: v.id("users"),
    applicationId: v.id("jobApplications"),
    answers: v.array(applicationAnswer),
  },
  handler: async (ctx, { userId, applicationId, answers }) => {
    const application = await ctx.db.get(applicationId);
    if (!application || application.userId !== userId) {
      throw new Error("Application not found.");
    }
    if (application.status === "submitting" || application.status === "submitted") {
      throw new Error("This application can no longer be edited.");
    }

    validateReviewAnswers(application.formQuestions, answers);
    const merged = mergeAnswers(application.answers, answers);
    const missingQuestions = application.formQuestions
      .filter(
        (question) =>
          question.required &&
          !questionIsAnswered(question, merged, application.resumeAttached),
      )
      .map((question) => ({
        label: question.label,
        fieldNames: question.fields.map((field) => field.name),
      }));
    const status = missingQuestions.length === 0 ? "ready" : "review_required";
    await ctx.db.patch(applicationId, {
      answers: merged,
      missingQuestions,
      status,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { status, missingQuestions };
  },
});

export const getProfileInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("applicantProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const createBatch = internalMutation({
  args: {
    userId: v.id("users"),
    role: v.string(),
    location: v.string(),
    companyName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("jobApplicationBatches", {
      ...args,
      status: "preparing",
      applicationIds: [],
      readyCount: 0,
      reviewRequiredCount: 0,
      submittedCount: 0,
      failedCount: 0,
      skippedSubmittedCount: 0,
      inProgressCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertPreparedApplication = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
    greenhouseJobId: v.number(),
    jobTitle: v.string(),
    companyName: v.string(),
    jobLocation: v.string(),
    jobUrl: v.string(),
    status: v.union(v.literal("ready"), v.literal("review_required")),
    resumeAttached: v.boolean(),
    answers: v.array(applicationAnswer),
    formQuestions: v.array(applicationFormQuestion),
    missingQuestions: v.array(missingQuestion),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jobApplications")
      .withIndex("by_user_job", (q) =>
        q.eq("userId", args.userId).eq("greenhouseJobId", args.greenhouseJobId),
      )
      .unique();

    if (existing?.status === "submitted") {
      return { applicationId: existing._id, state: "submitted" as const };
    }
    if (existing?.status === "submitting") {
      return { applicationId: existing._id, state: "submitting" as const };
    }

    const now = Date.now();
    if (existing) {
      const remainsFailed = existing.status === "failed";
      await ctx.db.patch(existing._id, {
        batchId: args.batchId,
        jobTitle: args.jobTitle,
        companyName: args.companyName,
        jobLocation: args.jobLocation,
        jobUrl: args.jobUrl,
        status: remainsFailed ? "failed" : args.status,
        resumeAttached: args.resumeAttached,
        answers: args.answers,
        formQuestions: args.formQuestions,
        missingQuestions: args.missingQuestions,
        submissionStartedAt: undefined,
        lastError: remainsFailed ? existing.lastError : undefined,
        updatedAt: now,
      });
      return {
        applicationId: existing._id,
        state: remainsFailed ? ("failed" as const) : ("staged" as const),
      };
    }

    const applicationId = await ctx.db.insert("jobApplications", {
      ...args,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { applicationId, state: "staged" as const };
  },
});

export const finalizePreparedBatch = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
    applicationIds: v.array(v.id("jobApplications")),
    readyCount: v.number(),
    reviewRequiredCount: v.number(),
    failedCount: v.number(),
    skippedSubmittedCount: v.number(),
    inProgressCount: v.number(),
  },
  handler: async (ctx, { userId, batchId, ...counts }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) {
      throw new Error("Application batch not found.");
    }
    await ctx.db.patch(batchId, {
      ...counts,
      status: "prepared",
      updatedAt: Date.now(),
    });
  },
});

export const failBatch = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
    error: v.string(),
  },
  handler: async (ctx, { userId, batchId, error }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) return;
    await ctx.db.patch(batchId, {
      status: "failed",
      error,
      updatedAt: Date.now(),
    });
  },
});

export const getBatchInternal = internalQuery({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
  },
  handler: async (ctx, { userId, batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) return null;
    const applications = await Promise.all(batch.applicationIds.map((id) => ctx.db.get(id)));
    return {
      batch,
      applications: applications
        .filter(isPresent)
        .filter((application) => application.userId === userId),
    };
  },
});

export const markBatchSubmitting = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
  },
  handler: async (ctx, { userId, batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) {
      throw new Error("Application batch not found.");
    }
    if (batch.status !== "prepared" && batch.status !== "complete") {
      return false;
    }
    await ctx.db.patch(batchId, { status: "submitting", updatedAt: Date.now() });
    return true;
  },
});

export const claimForSubmission = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
    applicationId: v.id("jobApplications"),
  },
  handler: async (ctx, { userId, batchId, applicationId }) => {
    const application = await ctx.db.get(applicationId);
    if (
      !application ||
      application.userId !== userId ||
      application.batchId !== batchId ||
      application.status !== "ready"
    ) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(applicationId, {
      status: "submitting",
      attemptCount: application.attemptCount + 1,
      submissionStartedAt: now,
      lastError: undefined,
      updatedAt: now,
    });
    return { ...application, status: "submitting" as const };
  },
});

export const finishSubmission = internalMutation({
  args: {
    userId: v.id("users"),
    applicationId: v.id("jobApplications"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { userId, applicationId, ok, error }) => {
    const application = await ctx.db.get(applicationId);
    if (!application || application.userId !== userId || application.status !== "submitting") {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(applicationId, {
      status: ok ? "submitted" : "failed",
      submittedAt: ok ? now : undefined,
      submissionStartedAt: undefined,
      lastError: ok ? undefined : error ?? "Submission failed.",
      updatedAt: now,
    });
    return true;
  },
});

export const finalizeBatchSubmission = internalMutation({
  args: {
    userId: v.id("users"),
    batchId: v.id("jobApplicationBatches"),
  },
  handler: async (ctx, { userId, batchId }) => {
    const batch = await ctx.db.get(batchId);
    if (!batch || batch.userId !== userId) {
      throw new Error("Application batch not found.");
    }
    const applications = (
      await Promise.all(batch.applicationIds.map((id) => ctx.db.get(id)))
    )
      .filter(isPresent)
      .filter((application) => application.userId === userId);
    const readyCount = applications.filter((row) => row.status === "ready").length;
    const reviewRequiredCount = applications.filter(
      (row) => row.status === "review_required",
    ).length;
    const submittedCount = applications.filter((row) => row.status === "submitted").length;
    const failedCount = applications.filter((row) => row.status === "failed").length;

    await ctx.db.patch(batchId, {
      status: "complete",
      readyCount,
      reviewRequiredCount,
      submittedCount,
      failedCount,
      updatedAt: Date.now(),
    });
    return { readyCount, reviewRequiredCount, submittedCount, failedCount };
  },
});

function mergeAnswers(
  current: Array<{ field: string; value: string | string[] }>,
  updates: Array<{ field: string; value: string | string[] }>,
) {
  const merged = new Map(current.map((answer) => [answer.field, answer.value]));
  for (const answer of updates) {
    if (answerValueIsPresent(answer.value)) merged.set(answer.field, answer.value);
    else merged.delete(answer.field);
  }
  return [...merged].map(([field, value]) => ({ field, value }));
}

function validateReviewAnswers(
  questions: Array<{
    fields: Array<{
      name: string;
      type: string;
      values?: Array<{ label: string; value: string }>;
    }>;
  }>,
  answers: Array<{ field: string; value: string | string[] }>,
) {
  const fields = new Map(
    questions.flatMap((question) => question.fields.map((field) => [field.name, field] as const)),
  );
  for (const answer of answers) {
    const field = fields.get(answer.field);
    if (!field || field.type === "input_file") {
      throw new Error("Answer does not belong to this application form.");
    }
    const isMulti = field.type === "multi_value_multi_select";
    if (isMulti !== Array.isArray(answer.value)) {
      throw new Error("Answer has the wrong shape for this application field.");
    }
    if (field.values?.length) {
      const allowed = new Set(field.values.map((option) => option.value));
      const values = Array.isArray(answer.value) ? answer.value : [answer.value];
      if (values.some((value) => value.trim() && !allowed.has(value))) {
        throw new Error("Answer is not one of this application field's options.");
      }
    }
  }
}

function questionIsAnswered(
  question: {
    fields: Array<{ name: string; type: string }>;
  },
  answers: Array<{ field: string; value: string | string[] }>,
  resumeAttached: boolean,
) {
  const byField = new Map(answers.map((answer) => [answer.field, answer.value]));
  return question.fields.some(
    (field) =>
      (field.type === "input_file" && field.name === "resume" && resumeAttached) ||
      (field.type !== "input_file" && answerValueIsPresent(byField.get(field.name))),
  );
}

function answerValueIsPresent(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.some((item) => item.trim().length > 0)
    : typeof value === "string" && value.trim().length > 0;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
