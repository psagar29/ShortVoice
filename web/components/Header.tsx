"use client";

import { Microphone, MicrophoneSlash, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { compressionStats, type EventDoc } from "@/lib/format";

export type ListenState = "off" | "connecting" | "live" | "error";

const STATUS_TEXT: Record<ListenState, string> = {
  off: "not listening",
  connecting: "connecting",
  live: "listening",
  error: "mic error",
};

/** One icon family, one weight, everywhere on the page. */
const ICON = { size: 15, weight: "bold" } as const;

export function Header({
  events,
  listenState,
  onToggleListen,
  muted,
  onToggleMute,
}: {
  events: EventDoc[];
  listenState: ListenState;
  onToggleListen: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const { spoken, meant } = compressionStats(events);

  return (
    <header className="rail">
      <div className="mark">
        Short<i>Voice</i>
      </div>

      <button
        className={`btn ${listenState === "live" ? "on" : ""}`}
        onClick={onToggleListen}
        type="button"
      >
        <span
          className={`dot ${listenState === "live" ? "live" : ""} ${
            listenState === "error" ? "fault" : ""
          }`}
        />
        {listenState === "live" ? <Microphone {...ICON} /> : <MicrophoneSlash {...ICON} />}
        {STATUS_TEXT[listenState]}
      </button>

      {/* Muted by default so this page and Person C's MCP server never say the
          same sentence at once. Unmuting doubles as the audio autoplay gesture. */}
      <button
        className={`btn ${muted ? "" : "on"}`}
        onClick={onToggleMute}
        type="button"
        title="ShortVoice's own Deepgram voice"
      >
        {muted ? <SpeakerSlash {...ICON} /> : <SpeakerHigh {...ICON} />}
        {muted ? "muted" : "speaking"}
      </button>

      <div className="rail-spacer" />

      {/* The pitch as a number. Reads last, rests longest. */}
      <div className="ratio">
        <b>{spoken}</b> spoken
        <span className="to">/</span>
        <b>{meant}</b> meant
      </div>
    </header>
  );
}
