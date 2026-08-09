"use client";

import type { EventDoc } from "@/lib/format";

/**
 * Three words on the left, twenty words of intent on the right. This is the
 * entire product in one image, so it is the biggest thing on the screen and
 * the expansion animates every time it changes.
 */
export function HeardMeant({
  events,
  interim,
}: {
  events: EventDoc[];
  /** Live partial transcript from Deepgram, before the final result lands. */
  interim: string;
}) {
  // `events` arrives newest-first from api.events.feed.
  const heard = events.find((e) => e.kind === "heard");
  const meant = events.find((e) => e.kind === "resolved" || e.kind === "error");

  // Only show the expansion if it belongs to the utterance on screen -- never
  // pair a new HEARD with the previous MEANT.
  const meantIsCurrent =
    meant !== undefined && (heard === undefined || meant._creationTime >= heard._creationTime);

  const score =
    meant?.kind === "resolved" && typeof meant.detail?.matchScore === "number"
      ? meant.detail.matchScore
      : null;

  return (
    <section className="panel">
      <div className="hm">
        <div className="panel-label">
          <span>Heard</span>
          {meant?.latencyMs ? <span>{meant.latencyMs} ms</span> : null}
        </div>

        {interim ? (
          <div className="heard-text interim">{interim}</div>
        ) : heard ? (
          <div key={heard._id} className="heard-text expand">
            &ldquo;{heard.text}&rdquo;
          </div>
        ) : (
          <div className="heard-text empty">waiting for you to say something</div>
        )}

        <div className="panel-label">
          <span>Meant</span>
          <span className="arrow-down">↓</span>
        </div>

        {meantIsCurrent && meant ? (
          <div key={meant._id} className={`meant-text expand ${meant.kind === "error" ? "empty" : ""}`}>
            {meant.text}
            {score !== null ? (
              <div className="score">
                match {(score * 100).toFixed(0)}%
                {meant.detail?.trigger ? ` · "${meant.detail.trigger}"` : ""}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="meant-text empty">…</div>
        )}
      </div>
    </section>
  );
}
