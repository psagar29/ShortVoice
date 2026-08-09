"use client";

import { Sparkle } from "@phosphor-icons/react";
import type { Doc } from "@convex/_generated/dataModel";

/**
 * Beat 3: the system teaches you.
 *
 * This card materialises on its own. Nobody clicked anything. A Convex
 * scheduled action noticed the user had repeated themselves and wrote a
 * suggestion row, and the subscription put it on screen. That unprompted
 * arrival is the part a macro list can never do.
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
        <Sparkle size={14} weight="bold" />
        said {suggestion.evidenceCount} times
      </span>

      <span className="ask">
        Want to just say <span className="word">{suggestion.proposedTrigger}</span>?
      </span>

      <span className="acts">
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
