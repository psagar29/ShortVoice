"use client";

import { Phone, PhoneDisconnect } from "@phosphor-icons/react";
import type { Doc } from "@convex/_generated/dataModel";

/**
 * A live phone call, made visible.
 *
 * The room can only hear one side of a call, so without this the most
 * impressive thing ShortVoice does is invisible. Every webhook turn writes to
 * the `calls` row, and this is a subscription on it: the transcript grows on
 * the projector in step with the conversation happening on the line.
 */
export function CallPanel({ call }: { call: Doc<"calls"> | null | undefined }) {
  // Finished calls linger briefly so the outcome can be read, then get out of
  // the way of the next beat.
  if (!call) return null;
  const live = call.status === "dialing" || call.status === "in_progress";
  if (!live && Date.now() - call.createdAt > 90_000) return null;

  return (
    <div className={`call ${live ? "live" : ""}`}>
      <span className="call-head">
        <span className="icon">
          {live ? <Phone size={15} weight="bold" /> : <PhoneDisconnect size={15} weight="bold" />}
        </span>
        {call.status === "dialing"
          ? `dialing ${call.business}`
          : call.status === "in_progress"
            ? `on the line with ${call.business}`
            : call.status === "failed"
              ? "call failed"
              : "call ended"}
      </span>

      <div className="call-log">
        {call.transcript.length === 0 ? (
          <span className="call-idle">ringing</span>
        ) : (
          call.transcript.slice(-4).map((turn, i) => (
            <p key={`${turn.at}-${i}`} className={`turn ${turn.role}`}>
              <span className="who">{turn.role === "agent" ? "ShortVoice" : call.business}</span>
              {turn.text}
            </p>
          ))
        )}
      </div>

      {call.outcome ? <span className="call-outcome">{call.outcome}</span> : null}
    </div>
  );
}
