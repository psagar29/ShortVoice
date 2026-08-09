export type UserId = string;

export type LocalActionType =
  | "send_message"
  | "create_event"
  | "read_screen"
  | "focus_mode"
  | "open_app";

export interface LocalActionRequest {
  actionType: LocalActionType;
  params: Record<string, unknown>;
}

export type ResolveResult =
  | {
      kind: "confirm";
      pendingId: string;
      confirmationSpeech: string;
      resolvedIntent: string;
      matchScore?: number;
    }
  | { kind: "clarify" | "unknown"; speech: string };

export interface ConfirmResult {
  ok: boolean;
  speech: string;
  localAction?: LocalActionRequest;
}

export interface SpeechResult {
  speech: string;
}

export interface Phrase {
  trigger: string;
  normalizedTrigger: string;
  intentTemplate: string;
  actionType: string;
  active: boolean;
}

export interface Contact {
  alias: string;
  fullName: string;
  phone?: string;
}

export interface Suggestion {
  proposedTrigger: string;
  intentTemplate: string;
  evidenceCount: number;
}

export interface FeedEvent {
  kind: string;
  text: string;
  latencyMs?: number;
  createdAt: number;
}
