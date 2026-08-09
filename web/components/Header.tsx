"use client";

import { compressionStats, type EventDoc } from "@/lib/format";

export type ListenState = "off" | "connecting" | "live" | "error";

const STATUS_TEXT: Record<ListenState, string> = {
  off: "not listening",
  connecting: "connecting",
  live: "listening",
  error: "mic error",
};

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
    <header className="header">
      <div className="brand">
        Short<span>Voice</span>
      </div>

      <button
        className={`status btn ${listenState === "live" ? "on" : ""}`}
        onClick={onToggleListen}
        type="button"
      >
        <span
          className={`dot ${listenState === "live" ? "live" : ""} ${
            listenState === "error" ? "error" : ""
          }`}
        />
        {STATUS_TEXT[listenState]}
      </button>

      {/* Muted by default so the dashboard and Person C's MCP server never
          say the same sentence at once. E flips this during rehearsal. */}
      <button
        className={`btn ${muted ? "" : "on"}`}
        onClick={onToggleMute}
        type="button"
        title="ShortVoice's own Deepgram voice"
      >
        {muted ? "🔇 muted" : "🔊 speaking"}
      </button>

      <div className="ratio">
        <b>{spoken}</b> words
        <span className="arrow">→</span>
        <b>{meant}</b> meant
      </div>
    </header>
  );
}
