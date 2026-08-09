"use client";

import { useRef } from "react";
import type { Doc } from "@convex/_generated/dataModel";

/**
 * MY LANGUAGE. A phrase taught on stage appears here the instant it is
 * written, with no refresh and no polling -- this is a `useQuery` subscription
 * and nothing else. That single moment is the best Convex demo we can give.
 */
export function Vocabulary({ phrases }: { phrases: Doc<"phrases">[] | undefined }) {
  // Rows that existed when the page loaded must not glow -- otherwise the
  // whole list lights up on refresh and the effect means nothing.
  const openedAt = useRef(Date.now());

  return (
    <section className="panel">
      <div className="panel-label">
        <span>My language</span>
        <span>{phrases ? `${phrases.length} phrases` : "…"}</span>
      </div>

      <ul className="vocab">
        {phrases?.map((phrase) => {
          const fresh = phrase._creationTime > openedAt.current;
          return (
            <li key={phrase._id} className={fresh ? "fresh" : undefined}>
              <span>{phrase.trigger}</span>
              {fresh ? (
                <span className="badge">
                  ✨ {phrase.source === "suggested" ? "suggested" : "just taught"}
                </span>
              ) : null}
              {phrase.useCount > 0 ? (
                <span className="uses">used {phrase.useCount}×</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
