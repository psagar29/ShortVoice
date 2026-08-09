"use client";

import type { EventDoc } from "@/lib/format";

/**
 * The expansion. Three words above, twenty words of intent below.
 *
 * This is the entire product in one composition, so it owns the largest
 * column on the stage and it is the only element allowed to animate. The
 * reveal runs left to right because the sentence is literally growing out
 * of the fragment above it: a state transition, not decoration.
 *
 * The typography is load-bearing. The fragment is set in mono because it
 * reads as machine shorthand; the expansion is set in sans because it reads
 * as human language. That contrast is the argument, made without a label.
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

  // Only show the expansion if it belongs to the utterance on screen. Never
  // pair a new fragment with the previous expansion.
  const meantIsCurrent =
    meant !== undefined &&
    (heard === undefined || meant._creationTime >= heard._creationTime);

  // Person B logs { band, score, actionType, utterance } on a resolved event.
  // `matchScore` is accepted too so this survives either naming.
  const detail = meant?.kind === "resolved" ? meant.detail : undefined;
  const rawScore = detail?.score ?? detail?.matchScore;
  const score = typeof rawScore === "number" ? rawScore : null;
  const band = typeof detail?.band === "string" ? detail.band : null;

  return (
    <section className="panel expansion">
      <div className="said">
        <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 14 }}>
          <span>Said</span>
          {meant?.latencyMs ? <span className="count">{meant.latencyMs} ms</span> : null}
        </div>

        {interim ? (
          <div className="said-text pending">{interim}</div>
        ) : heard ? (
          <div key={heard._id} className="said-text reveal">
            {heard.text}
          </div>
        ) : (
          <div className="said-text idle">waiting for you to say something</div>
        )}
      </div>

      <div className="meant">
        <div className="panel-head" style={{ padding: 0, border: 0 }}>
          <span>Meant</span>
        </div>

        {meantIsCurrent && meant ? (
          <>
            <div
              key={meant._id}
              className={`meant-text reveal ${meant.kind === "error" ? "fault" : ""}`}
            >
              {meant.text}
            </div>

            {score !== null ? (
              <div className="meta">
                <span className="bar">
                  <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, score))})` }} />
                </span>
                <span>match {(score * 100).toFixed(0)}%</span>
                {band ? <span>{band}</span> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="meant-text idle">nothing to expand yet</div>
        )}
      </div>
    </section>
  );
}
