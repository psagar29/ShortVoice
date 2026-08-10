/**
 * View models for the dashboard.
 *
 * The redesigned components take these, not Convex `Doc`s. That keeps the UI
 * renderable from fixtures (so it can be designed and reviewed before it is
 * wired), and it makes wiring a pure mapping step later: subscribe with
 * useQuery, map Doc -> VM, pass down. No component learns about Convex.
 */

export type ActionType =
  | "send_message"
  | "send_slack"
  | "create_event"
  | "read_screen"
  | "focus_mode"
  | "open_app"
  | "web_search"
  | "job_apply"
  | "place_call"
  | "speak"
  | "custom";

export type EventKind =
  | "heard"
  | "resolved"
  | "awaiting"
  | "confirmed"
  | "cancelled"
  | "executed"
  | "taught"
  | "suggested"
  | "error";

export type PhraseVM = {
  id: string;
  trigger: string;
  actionType: ActionType;
  useCount: number;
  source: "seeded" | "taught" | "suggested";
  /** True when it was written after the page opened — drives the glow. */
  fresh?: boolean;
};

export type ContactVM = {
  id: string;
  alias: string;
  fullName: string;
};

export type EventVM = {
  id: string;
  kind: EventKind;
  text: string;
};

export type HeroVM = {
  /** What they actually said — three words. */
  heard: string;
  /** What they meant — twenty. Empty while still resolving. */
  meant: string;
  band?: "strong" | "weak" | "cold";
  score?: number;
  latencyMs?: number;
  trigger?: string;
};

export type PendingVM = {
  id: string;
  confirmationSpeech: string;
};

export type SuggestionVM = {
  id: string;
  proposedTrigger: string;
  evidenceCount: number;
};

/** The reusable identity the application forms are filled from. */
export type ProfileDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  countryShortName: string;
  linkedInUrl: string;
  portfolioUrl: string;
  workAuthorization: string;
  requiresSponsorship: string;
};

export type ProfileVM = ProfileDraft & {
  /** `updatedAt`. Changes when the server has newer values than the draft. */
  version: number;
  resumeFileName?: string;
  resumeUrl?: string;
  resumeSize?: number;
};

export type ApplicationStatus =
  | "ready"
  | "review_required"
  | "submitting"
  | "submitted"
  | "failed";

export type ApplicationFieldVM = {
  name: string;
  /** Form field type: input_text, textarea, multi_value_*_select, … */
  type: string;
  options?: Array<{ label: string; value: string }>;
};

/** A required question the form still wants an answer for. */
export type ApplicationQuestionVM = {
  label: string;
  fields: ApplicationFieldVM[];
};

export type ApplicationVM = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  status: ApplicationStatus;
  resumeAttached: boolean;
  missing: ApplicationQuestionVM[];
  error?: string;
};

export type AnswerDraft = { field: string; value: string | string[] };

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  ready: "Ready",
  review_required: "Needs review",
  submitting: "Submitting",
  submitted: "Submitted",
  failed: "Failed",
};

export const APPLICATION_STATUS_CLASS: Record<ApplicationStatus, string> = {
  ready: "st-ready",
  review_required: "st-review",
  submitting: "st-submitting",
  submitted: "st-submitted",
  failed: "st-failed",
};

/** Monochrome glyphs standing in for SF Symbols, which we cannot ship on web. */
export const ACTION_GLYPH: Record<ActionType, string> = {
  send_message: "✉",
  send_slack: "#",
  create_event: "◷",
  read_screen: "◻",
  focus_mode: "◐",
  open_app: "▤",
  web_search: "⌕",
  job_apply: "◈",
  place_call: "☏",
  speak: "♪",
  custom: "✳",
};

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export type CallVM = {
  id: string;
  /** "the dentist" */
  business: string;
  status: "dialing" | "in_progress" | "completed" | "failed";
  /** Last few turns only. The room needs the gist, not a court record. */
  turns: { role: "agent" | "them"; text: string }[];
  outcome?: string;
};
