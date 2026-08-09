import type { Doc } from "@convex/_generated/dataModel";

export type EventDoc = Doc<"events">;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * "37 words spoken -> 284 words meant" -- the number people remember.
 *
 * api.stats was optional in the contract and Person A never shipped it, so we
 * compute it from the feed. That means it covers the events currently
 * subscribed to (the last `limit`), not all time.
 */
export function compressionStats(events: EventDoc[]): {
  spoken: number;
  meant: number;
} {
  let spoken = 0;
  let meant = 0;
  for (const event of events) {
    if (event.kind === "heard") spoken += wordCount(event.text);
    if (event.kind === "resolved") meant += wordCount(event.text);
  }
  return { spoken, meant };
}
