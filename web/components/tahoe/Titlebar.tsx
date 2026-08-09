"use client";

import { countWords, type EventVM } from "@/lib/viewModels";

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
      <div className="traffic" aria-hidden>
        <i /><i /><i />
      </div>

      <span className="app-title">ShortVoice</span>

      <button
        type="button"
        className={`pill${listening ? " is-live" : ""}`}
        onClick={onToggleListen}
      >
        <span className={`dot${listening ? " live" : ""}`} />
        {listening ? "Listening" : "Not listening"}
      </button>

      <button
        type="button"
        className={`pill${muted ? "" : " is-on"}`}
        onClick={onToggleMute}
        title="ShortVoice's own Deepgram voice"
      >
        {muted ? "Muted" : "Speaking"}
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
