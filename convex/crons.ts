// ============================================================================
// ShortVoice -- crons  (Person B)
// ============================================================================
// One job, one purpose: an abandoned confirmation must not be sitting there
// when someone says "yes" to a question from five minutes ago. On a stage, a
// stale "yes" firing the wrong message is the worst failure mode we have.
// ============================================================================

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const STALE_AFTER_MS = 5 * 60 * 1000;

const crons = cronJobs();

crons.interval(
  "expire stale confirmations",
  { minutes: 1 },
  internal.resolver.sweepStalePending,
  { olderThanMs: STALE_AFTER_MS },
);

export default crons;
