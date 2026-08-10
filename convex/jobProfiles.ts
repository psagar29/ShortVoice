import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const answerValue = v.union(v.string(), v.array(v.string()));
const defaultAnswer = v.object({
  key: v.string(),
  value: answerValue,
});

const profileFields = {
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  location: v.optional(v.string()),
  latitude: v.optional(v.string()),
  longitude: v.optional(v.string()),
  countryShortName: v.optional(v.string()),
  linkedInUrl: v.optional(v.string()),
  portfolioUrl: v.optional(v.string()),
  workAuthorization: v.optional(v.string()),
  requiresSponsorship: v.optional(v.string()),
  defaultAnswers: v.optional(v.array(defaultAnswer)),
};

const SUPPORTED_RESUME_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "rtf"]);

export const getProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("applicantProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;

    const resumeUrl = profile.resumeStorageId
      ? await ctx.storage.getUrl(profile.resumeStorageId)
      : null;
    return { ...profile, resumeUrl };
  },
});

export const saveProfile = mutation({
  args: {
    userId: v.id("users"),
    ...profileFields,
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.userId))) {
      throw new Error("User not found.");
    }

    const existing = await ctx.db
      .query("applicantProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();
    const updates = { ...editableProfileFields(args), ...suppliedProfileFields(args) };

    if (existing) {
      await ctx.db.patch(existing._id, { ...updates, updatedAt: now });
      return existing._id;
    }

    return await ctx.db.insert("applicantProfiles", {
      userId: args.userId,
      ...updates,
      defaultAnswers: updates.defaultAnswers ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const generateResumeUploadUrl = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!(await ctx.db.get(userId))) {
      throw new Error("User not found.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const setResume = mutation({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, { userId, storageId, fileName, contentType, size }) => {
    if (!(await ctx.db.get(userId))) {
      throw new Error("User not found.");
    }
    const extension = fileName.trim().toLowerCase().split(".").pop() ?? "";
    if (!SUPPORTED_RESUME_EXTENSIONS.has(extension)) {
      throw new Error("Resume must be a PDF, DOC, DOCX, TXT, or RTF file.");
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error("Resume file is empty.");
    }

    const stored = await ctx.storage.getMetadata(storageId);
    if (!stored) {
      throw new Error("Uploaded resume was not found.");
    }

    const profile = await ctx.db
      .query("applicantProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const now = Date.now();
    const resume = {
      resumeStorageId: storageId,
      resumeFileName: fileName.trim(),
      resumeContentType: contentType.trim() || stored.contentType || "application/octet-stream",
      resumeSize: size,
      updatedAt: now,
    };

    if (profile) {
      const previousStorageId = profile.resumeStorageId;
      await ctx.db.patch(profile._id, resume);
      if (previousStorageId && previousStorageId !== storageId) {
        await ctx.storage.delete(previousStorageId);
      }
      return profile._id;
    }

    return await ctx.db.insert("applicantProfiles", {
      userId,
      defaultAnswers: [],
      ...resume,
      createdAt: now,
    });
  },
});

export const clearResume = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("applicantProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile?.resumeStorageId) return false;

    await ctx.storage.delete(profile.resumeStorageId);
    await ctx.db.patch(profile._id, {
      resumeStorageId: undefined,
      resumeFileName: undefined,
      resumeContentType: undefined,
      resumeSize: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

type SaveProfileArgs = {
  userId: unknown;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  latitude?: string;
  longitude?: string;
  countryShortName?: string;
  linkedInUrl?: string;
  portfolioUrl?: string;
  workAuthorization?: string;
  requiresSponsorship?: string;
  defaultAnswers?: Array<{ key: string; value: string | string[] }>;
};

/**
 * The fields the profile form always renders. A blank input arrives here as
 * `undefined` and a Convex patch removes it, which is what clearing a field
 * from the editor is supposed to do.
 */
function editableProfileFields(args: SaveProfileArgs) {
  const {
    firstName,
    lastName,
    email,
    phone,
    location,
    countryShortName,
    linkedInUrl,
    portfolioUrl,
    workAuthorization,
    requiresSponsorship,
  } = args;
  return {
    firstName,
    lastName,
    email,
    phone,
    location,
    countryShortName,
    linkedInUrl,
    portfolioUrl,
    workAuthorization,
    requiresSponsorship,
  };
}

/**
 * The fields no form control can express. Because a patch treats `undefined` as
 * a delete, including them unconditionally would let any caller that saves a
 * partial profile silently drop coordinates and every stored default answer --
 * and, since `defaultAnswers` is required by the schema, fail the write
 * outright. They are only written when the caller actually supplied them.
 */
function suppliedProfileFields(args: SaveProfileArgs) {
  const supplied: {
    latitude?: string;
    longitude?: string;
    defaultAnswers?: Array<{ key: string; value: string | string[] }>;
  } = {};
  if (args.latitude !== undefined) supplied.latitude = args.latitude;
  if (args.longitude !== undefined) supplied.longitude = args.longitude;
  if (args.defaultAnswers !== undefined) {
    supplied.defaultAnswers = args.defaultAnswers.map(({ key, value }) => ({
      key: key.trim(),
      value,
    }));
  }
  return supplied;
}
