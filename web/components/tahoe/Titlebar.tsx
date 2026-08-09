"use client";

import { countWords, type EventVM } from "@/lib/viewModels";
import { GlassEffect } from "@/components/ui/liquid-glass";

/**
 * Unified translucent titlebar. Controls sitting on glass are tinted fills,
 * never more glass — glass cannot sample glass.
 */
export function Titlebar({
  events,
  listening,
  muted,
  onToggleListen,
  onToggleMute,
}: {
  events: EventVM[];
  listening: boolean;
  muted: boolean;
  onToggleListen: () => void;
  onToggleMute: () => void;
}) {
  let spoken = 0;
  let meant = 0;
  for (const event of events) {
    if (event.kind === "heard") spoken += countWords(event.text);
    if (event.kind === "resolved") meant += countWords(event.text);
  }

  return (
    <div className="titlebar">
      {/* No traffic lights: on macOS the OS draws its own, and painting fake
          ones underneath them looks like a mockup of an app rather than an app. */}
      <span className="app-title">ShortVoice</span>

      <button type="button" className="pill-btn" onClick={onToggleListen}>
        <GlassEffect className={`lg-pill${listening ? " is-live" : ""}`}>
          <span className={`dot${listening ? " live" : ""}`} />
          {listening ? "Listening" : "Not listening"}
        </GlassEffect>
      </button>

      <button
        type="button"
        className="pill-btn"
        onClick={onToggleMute}
        title="ShortVoice's own Deepgram voice"
      >
        <GlassEffect className={`lg-pill${muted ? "" : " is-on"}`}>
          {muted ? "Muted" : "Speaking"}
        </GlassEffect>
      </button>

      <span className="titlebar-spacer" />

      <div className="metric">
        <b className="tnum">{spoken}</b>
        <span>spoken</span>
        <span className="to">→</span>
        <b className="tnum">{meant}</b>
        <span>meant</span>
      </div>
    </div>
  );
}
