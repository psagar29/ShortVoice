"use client";

import { useRef } from "react";
import type { Doc } from "@convex/_generated/dataModel";

/**
 * My language.
 *
 * A phrase taught on stage appears here the instant it is written, with no
 * refresh and no polling. This is a `useQuery` subscription and nothing else,
 * which makes it the best Convex demo we can give: the row lands while the
 * sentence teaching it is still being spoken.
 *
 * Slot counts are surfaced because a phrase with a slot is a template, not a
 * macro. That badge is the visible answer to the question every judge asks.
 */
export function Vocabulary({ phrases }: { phrases: Doc<"phrases">[] | undefined }) {
  // Rows that existed at page load must never glow, or the whole list lights
  // up on refresh and the effect stops meaning anything.
  const openedAt = useRef(Date.now());

  return (
    <section className="panel">
      <div className="panel-head">
        <span>My language</span>
        <span className="count">{phrases ? `${phrases.length}` : ""}</span>
      </div>

      {phrases === undefined ? (
        <ul className="vocab">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <span className="skeleton" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="vocab">
          {phrases.map((phrase) => {
            const fresh = phrase._creationTime > openedAt.current;
            return (
              <li key={phrase._id} className={fresh ? "fresh" : undefined}>
                <span className="trigger">{phrase.trigger}</span>
                {phrase.slots.length > 0 ? (
                  <span className="slot">
                    {phrase.slots.length === 1 ? "1 slot" : `${phrase.slots.length} slots`}
                  </span>
                ) : null}
                <span className="grow" />
                {fresh ? (
                  <span className="new-tag">
                    {phrase.source === "suggested" ? "learned" : "taught"}
                  </span>
                ) : phrase.useCount > 0 ? (
                  <span className="uses">{phrase.useCount}x</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
