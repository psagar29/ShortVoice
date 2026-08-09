"use client";

import { Waveform } from "@phosphor-icons/react";
import type { Doc } from "@convex/_generated/dataModel";

/**
 * The confirmation state machine, made visible. Nothing consequential fires
 * without passing through this bar.
 *
 * The buttons are demo insurance: on stage the user says "yes", but if the
 * mic path fails mid-pitch, E can still drive the beat with a click.
 */
export function PendingCard({
  pending,
  onConfirm,
  onCancel,
  busy,
}: {
  pending: Doc<"pendingActions"> | null | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  if (!pending) return null;

  return (
    <div className="awaiting">
      <span className="icon">
        <Waveform size={22} weight="bold" />
      </span>
      <span className="speech">{pending.confirmationSpeech}</span>
      <span className="acts">
        <button className="btn primary" onClick={onConfirm} disabled={busy} type="button">
          Yes
        </button>
        <button className="btn" onClick={onCancel} disabled={busy} type="button">
          Cancel
        </button>
      </span>
    </div>
  );
}
