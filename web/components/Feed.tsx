"use client";

import type { EventDoc } from "@/lib/format";

/** heard → resolved → awaiting → confirmed → executed, newest on the left. */
export function Feed({ events }: { events: EventDoc[] }) {
  return (
    <section className="panel feed">
      <div className="panel-label">
        <span>Feed</span>
        <span>heard → resolved → awaiting → confirmed → executed</span>
      </div>
      <div className="feed-rail">
        {events.map((event) => (
          <div className="feed-item" key={event._id}>
            <span className={`k k-${event.kind}`}>{event.kind}</span>
            <span className="t">{event.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
