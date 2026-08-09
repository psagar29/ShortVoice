"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";

import { GlassFilterDefs } from "@/components/ui/liquid-glass";
import { ActivityFeed } from "@/components/tahoe/ActivityFeed";
import { Sidebar } from "@/components/tahoe/Sidebar";
import { Stage } from "@/components/tahoe/Stage";
import { Titlebar } from "@/components/tahoe/Titlebar";
import type { CallVM, ContactVM, EventVM, HeroVM, PendingVM, PhraseVM, SuggestionVM } from "@/lib/viewModels";
import { useListener } from "@/lib/useListener";
import { useSpeaker } from "@/lib/useSpeaker";

const FEED_LIMIT = 50;

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|send it|confirm|go ahead)\b/i;
const NO = /^(no|nope|nah|cancel|stop|never mind|nevermind|forget it)\b/i;
/** "when I say school mom it means text mom I'm leaving school" */
const TEACH = /when i say (.+?)[,]? it means (.+)/i;

function toHero(events: Doc<"events">[]): HeroVM {
  // `events` arrives newest-first from api.events.feed.
  const heard = events.find((e) => e.kind === "heard");
  const meant = events.find((e) => e.kind === "resolved" || e.kind === "error");

  // Only show the expansion if it belongs to the utterance on screen. Never
  // pair a new fragment with the previous expansion.
  const meantIsCurrent =
    meant !== undefined && (heard === undefined || meant._creationTime >= heard._creationTime);

  const detail = meant?.kind === "resolved" ? (meant.detail as Record<string, unknown> | undefined) : undefined;
  const rawScore = detail?.score ?? detail?.matchScore;
  const score = typeof rawScore === "number" ? rawScore : undefined;
  const band = typeof detail?.band === "string" ? (detail.band as HeroVM["band"]) : undefined;

  return {
    heard: heard?.text ?? "",
    meant: meantIsCurrent && meant ? meant.text : "",
    band: meantIsCurrent ? band : undefined,
    score: meantIsCurrent ? score : undefined,
    latencyMs: meantIsCurrent ? meant?.latencyMs : undefined,
  };
}

/** A finished call lingers briefly so the outcome can be read, then gets out of the way. */
function toCall(call: Doc<"calls"> | null | undefined): CallVM | null {
  if (!call) return null;
  const live = call.status === "dialing" || call.status === "in_progress";
  if (!live && Date.now() - call.createdAt > 90_000) return null;
  return {
    id: call._id,
    business: call.business,
    status: call.status,
    turns: call.transcript.slice(-3).map((t) => ({ role: t.role, text: t.text })),
    outcome: call.outcome,
  };
}

export default function Dashboard() {
  // ---- live subscriptions. Every one of these is a Convex useQuery.
  // Nothing on this page polls, refetches on an interval, or has a refresh
  // button. When Convex writes, the screen changes.
  const user = useQuery(api.users.getUser, { handle: "demo" });
  const userId = user?._id;
  const args = userId ? { userId } : "skip";

  const phrases = useQuery(api.phrases.listPhrases, args);
  const contacts = useQuery(api.contacts.listContacts, args);
  const suggestion = useQuery(api.learning.pendingSuggestion, args);
  const pending = useQuery(api.pending.getAwaiting, args);
  const call = useQuery(api.telephony.liveCall, args);
  const feed = useQuery(
    api.events.feed,
    userId ? { userId, limit: FEED_LIMIT } : "skip",
  );

  // ---- writes
  const resolve = useAction(api.resolver.resolve);
  const executeConfirmed = useAction(api.resolver.executeConfirmed);
  const cancelPending = useAction(api.resolver.cancelPending);
  const teachPhrase = useAction(api.teach.teachPhrase);
  const acceptSuggestion = useAction(api.learning.acceptSuggestion);

  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const { speakOnce } = useSpeaker(muted);

  const events = useMemo(() => feed ?? [], [feed]);

  /**
   * Keyterms for the recogniser: every active trigger plus every contact alias
   * and full name -- the same set GET /keyterms serves to Person C. We build it
   * from the live subscriptions rather than fetching the route, so a phrase
   * taught mid-demo re-primes the listener the moment it lands, with no poll.
   */
  const keyterms = useMemo(() => {
    const terms = new Set<string>();
    for (const phrase of phrases ?? []) terms.add(phrase.trigger);
    for (const contact of contacts ?? []) {
      terms.add(contact.alias);
      terms.add(contact.fullName);
    }
    return [...terms].map((t) => t.replace(/,/g, " ").trim()).filter(Boolean);
  }, [phrases, contacts]);

  const handleTranscript = useCallback(
    async (text: string) => {
      if (!userId) return;
      const utterance = text.trim();
      if (!utterance) return;

      setBusy(true);
      try {
        const taught = utterance.match(TEACH);
        if (taught) {
          await teachPhrase({ userId, trigger: taught[1], meaning: taught[2] });
        } else if (YES.test(utterance)) {
          await executeConfirmed({ userId });
        } else if (NO.test(utterance)) {
          await cancelPending({ userId });
        } else {
          await resolve({ userId, utterance });
        }
      } catch (err) {
        console.error("[transcript]", err);
      } finally {
        setBusy(false);
      }
    },
    [userId, resolve, executeConfirmed, cancelPending, teachPhrase],
  );

  const listener = useListener({ keyterms, onTranscript: handleTranscript });

  // Speak each confirmation exactly once, and only when unmuted.
  useEffect(() => {
    if (pending) speakOnce(pending._id, pending.confirmationSpeech);
  }, [pending, speakOnce]);

  useEffect(() => {
    if (suggestion) {
      speakOnce(
        suggestion._id,
        `You've asked me that ${suggestion.evidenceCount} times this hour. Want to just say "${suggestion.proposedTrigger}"?`,
      );
    }
  }, [suggestion, speakOnce]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, []);

  // Rows that existed at page load must never glow, or the whole sidebar
  // lights up on refresh and the effect stops meaning anything.
  const openedAt = useRef(Date.now());

  const phraseVMs: PhraseVM[] = useMemo(
    () =>
      (phrases ?? []).map((phrase) => ({
        id: phrase._id,
        trigger: phrase.trigger,
        actionType: phrase.actionType,
        useCount: phrase.useCount,
        source: phrase.source,
        fresh: phrase._creationTime > openedAt.current,
      })),
    [phrases],
  );

  const contactVMs: ContactVM[] = useMemo(
    () => (contacts ?? []).map((c) => ({ id: c._id, alias: c.alias, fullName: c.fullName })),
    [contacts],
  );

  const eventVMs: EventVM[] = useMemo(
    () => events.map((e) => ({ id: e._id, kind: e.kind, text: e.text })),
    [events],
  );

  const pendingVM: PendingVM | null = pending
    ? { id: pending._id, confirmationSpeech: pending.confirmationSpeech }
    : null;

  const suggestionVM: SuggestionVM | null = suggestion
    ? { id: suggestion._id, proposedTrigger: suggestion.proposedTrigger, evidenceCount: suggestion.evidenceCount }
    : null;

  const hero = useMemo(() => toHero(events), [events]);
  const listening = listener.state === "live";

  if (user === undefined) {
    return (
      <div className="setup">
        <h1>Connecting to Convex</h1>
        <span className="skeleton" style={{ width: 220 }} />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="setup">
        <h1>No demo user yet</h1>
        <p>Seed the deployment, then this page fills itself in.</p>
        <code>npx convex run seed:seedDemo</code>
      </div>
    );
  }

  return (
    <>
      {/* The displacement filter every GlassEffect references. Once, near root. */}
      <GlassFilterDefs />

      <div className="desktop">
        <div className="blob" />

        <div className="window">
          <Titlebar
            events={eventVMs}
            listening={listening}
            muted={muted}
            onToggleListen={listener.toggle}
            onToggleMute={() => setMuted((m) => !m)}
          />

          <Sidebar phrases={phraseVMs} contacts={contactVMs} />

          <div className="content">
            <Stage
              hero={hero}
              interim={listener.interim}
              pending={pendingVM}
              suggestion={suggestionVM}
              call={toCall(call)}
              listening={listening}
              onConfirm={() => run(() => executeConfirmed({ userId: user._id }))}
              onCancel={() => run(() => cancelPending({ userId: user._id }))}
              onAccept={() =>
                suggestion
                  ? run(() => acceptSuggestion({ userId: user._id, trigger: suggestion.proposedTrigger }))
                  : undefined
              }
            />
            <ActivityFeed events={eventVMs} />
          </div>
        </div>
      </div>
    </>
  );
}
