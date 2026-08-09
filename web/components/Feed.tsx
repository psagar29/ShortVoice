"use client";

import type { EventDoc } from "@/lib/format";

/**
 * The pipeline, running left to right in time: heard, resolved, awaiting,
 * confirmed, executed. Newest sits at the left because that is where the eye
 * returns between beats.
 *
 * Every stage writes to the same Convex table, so this rail is proof that the
 * whole chain ran, not a narration of it.
 */
export function Feed({ events }: { events: EventDoc[] }) {
  return (
    <section className="ticker">
      <span className="ticker-label">Pipeline</span>
      <div className="ticker-rail">
        {events.map((event) => (
          <div className="tick" key={event._id}>
            <span className={`kind k-${event.kind}`}>{event.kind}</span>
            <span className="body">{event.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
