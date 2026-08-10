// ============================================================================
// ShortVoice -- what job_apply says out loud  (Person B)
// ============================================================================
// Separate from convex/jobApply.ts so these sentences can be tested directly:
// they are the only place the person hears how many applications exist, and a
// count that drifts from the staged rows is the one failure the room would
// notice. Every number in here is passed in by the caller from rows it has
// actually written -- nothing is estimated, rounded, or assumed.
// ============================================================================

/**
 * The preview spoken before the "yes". It ends with a question ONLY when
 * something is actually ready, because the resolver refuses to open a
 * confirmation it could not honour (see resolver.declineToConfirm).
 */
export function prepareSpeech(
  found: number,
  ready: number,
  review: number,
  failed: number,
  skipped: number,
  inProgress: number,
): string {
  if (found === 0 && skipped === 0) return "I didn't find a matching role on this board.";
  const parts = [`I found ${found} ${plural(found, "role", "roles")}`];
  if (ready > 0) parts.push(`${ready} ready`);
  if (review > 0) parts.push(`${review} ${plural(review, "needs", "need")} review`);
  if (failed > 0) parts.push(`${failed} previous ${plural(failed, "failure", "failures")}`);
  if (skipped > 0) parts.push(`${skipped} already submitted`);
  if (inProgress > 0) parts.push(`${inProgress} already in progress`);
  const summary = parts.join("; ") + ".";
  return ready > 0 ? `${summary} Apply to the ready ${plural(ready, "one", "ones")}?` : summary;
}

/** The report spoken after submission. Says nothing went out when nothing did. */
export function submitSpeech(submitted: number, failed: number, review: number): string {
  const parts: string[] = [];
  if (submitted > 0) parts.push(`Submitted ${submitted}`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (review > 0) parts.push(`${review} still ${plural(review, "needs", "need")} review`);
  return parts.length > 0 ? `${parts.join("; ")}.` : "No applications were submitted.";
}

export function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}
