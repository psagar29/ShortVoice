"use client";

import type { Doc } from "@convex/_generated/dataModel";

/**
 * Beat 3: the system teaches you. This card materialises on its own -- nobody
 * clicked anything, a Convex scheduled action decided you had repeated
 * yourself and wrote a suggestion row.
 */
export function SuggestionCard({
  suggestion,
  onAccept,
  busy,
}: {
  suggestion: Doc<"suggestions"> | null | undefined;
  onAccept: (trigger: string) => void;
  busy: boolean;
}) {
  if (!suggestion) return null;

  return (
    <div className="suggestion">
      <span className="why">
        💡 You&rsquo;ve asked for that {suggestion.evidenceCount} times this hour.
      </span>
      Want to just say <span className="word">&ldquo;{suggestion.proposedTrigger}&rdquo;</span>?
      <span className="actions">
        <button
          className="btn primary"
          onClick={() => onAccept(suggestion.proposedTrigger)}
          disabled={busy}
          type="button"
        >
          Yes
        </button>
      </span>
    </div>
  );
}
