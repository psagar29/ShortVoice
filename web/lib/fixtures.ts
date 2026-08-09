/**
 * Fixture data for the unwired design preview.
 *
 * Values are copied from the real seed (`convex/seed.ts`) and from real
 * resolver output captured against the deployment, so the layout is being
 * judged against text of the length it will actually have to hold.
 */

import type {
  ContactVM,
  EventVM,
  HeroVM,
  PendingVM,
  PhraseVM,
  SuggestionVM,
} from "./viewModels";

export const PHRASES: PhraseVM[] = [
  { id: "p1", trigger: "team pr tonight", actionType: "send_slack", useCount: 3, source: "seeded" },
  { id: "p2", trigger: "neel later", actionType: "send_message", useCount: 1, source: "seeded" },
  { id: "p3", trigger: "red", actionType: "read_screen", useCount: 0, source: "seeded" },
  { id: "p4", trigger: "focus", actionType: "focus_mode", useCount: 0, source: "seeded" },
  { id: "p5", trigger: "mom flight friday", actionType: "web_search", useCount: 0, source: "seeded" },
  { id: "p6", trigger: "where", actionType: "read_screen", useCount: 0, source: "seeded" },
];

export const TAUGHT_PHRASE: PhraseVM = {
  id: "p7",
  trigger: "school mom",
  actionType: "send_message",
  useCount: 0,
  source: "taught",
  fresh: true,
};

export const SUGGESTED_PHRASE: PhraseVM = {
  id: "p8",
  trigger: "standup",
  actionType: "send_slack",
  useCount: 0,
  source: "suggested",
  fresh: true,
};

export const CONTACTS: ContactVM[] = [
  { id: "c1", alias: "mom", fullName: "Rashmi" },
  { id: "c2", alias: "neel", fullName: "Neel" },
  { id: "c3", alias: "team", fullName: "Project Team" },
];

// ---------------------------------------------------------------- scenes ---
// One per demo beat, so every state the judges will see can be reviewed.

export const HERO_IDLE: HeroVM = { heard: "", meant: "" };

export const HERO_BEAT1: HeroVM = {
  heard: "team pr tonight",
  meant: "Tell the project team I'll review the latest PR tonight",
  band: "strong",
  score: 0.92,
  latencyMs: 38,
  trigger: "team pr tonight",
};

export const HERO_BEAT2: HeroVM = {
  heard: "school mom",
  meant: "Text Mom you're leaving school and heading home",
  band: "strong",
  score: 1,
  latencyMs: 31,
  trigger: "school mom",
};

export const HERO_BEAT3: HeroVM = {
  heard: "tell sarah I am running late to standup",
  meant: "Tell Sarah you're running late to standup",
  band: "cold",
  score: 0.19,
  latencyMs: 402,
};

export const PENDING_BEAT1: PendingVM = {
  id: "pa1",
  confirmationSpeech: "Telling the project team you'll review the latest PR tonight. Say yes to send.",
};

export const PENDING_BEAT2: PendingVM = {
  id: "pa2",
  confirmationSpeech: "Texting Mom that you're leaving school and heading home. Say yes to send.",
};

export const SUGGESTION: SuggestionVM = {
  id: "s1",
  proposedTrigger: "standup",
  evidenceCount: 3,
};

export const FEED_BEAT1: EventVM[] = [
  { id: "e3", kind: "awaiting", text: "Telling the project team you'll review the latest PR tonight." },
  { id: "e2", kind: "resolved", text: "Tell the project team I'll review the latest PR tonight" },
  { id: "e1", kind: "heard", text: "team pr tonight" },
];

export const FEED_BEAT2: EventVM[] = [
  { id: "e7", kind: "awaiting", text: "Texting Mom that you're leaving school and heading home." },
  { id: "e6", kind: "resolved", text: "Text Mom you're leaving school and heading home" },
  { id: "e5", kind: "heard", text: "school mom" },
  { id: "e4", kind: "taught", text: "school mom" },
  ...FEED_BEAT1,
];

export const FEED_BEAT3: EventVM[] = [
  { id: "e10", kind: "suggested", text: "You've asked for that 3 times. Want to just say \"standup\"?" },
  { id: "e9", kind: "resolved", text: "Tell Sarah you're running late to standup" },
  { id: "e8", kind: "heard", text: "tell sarah I am running late to standup" },
  ...FEED_BEAT2,
];

export const FEED_EXECUTED: EventVM[] = [
  { id: "e12", kind: "executed", text: "Tell the project team I'll review the latest PR tonight" },
  { id: "e11", kind: "confirmed", text: "Tell the project team I'll review the latest PR tonight" },
  ...FEED_BEAT1,
];
