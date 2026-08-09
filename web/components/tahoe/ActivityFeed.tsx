"use client";

import type { EventVM } from "@/lib/viewModels";

/** heard → resolved → awaiting → confirmed → executed, newest on the left. */
export function ActivityFeed({ events }: { events: EventVM[] }) {
  return (
    <div className="feed">
      <div className="feed-head">
        <span className="eyebrow">Activity</span>
        <span className="eyebrow" style={{ letterSpacing: "0.06em" }}>
          heard → resolved → awaiting → confirmed → executed
        </span>
      </div>
      <div className="rail">
        {events.map((event) => (
          <span className="event" key={event.id} title={event.text}>
            <i className={`k k-${event.kind}`} />
            <span className="t">{event.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
