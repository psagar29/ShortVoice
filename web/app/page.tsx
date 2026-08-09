"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

import { CallPanel } from "@/components/CallPanel";
import { Feed } from "@/components/Feed";
import { Header } from "@/components/Header";
import { HeardMeant } from "@/components/HeardMeant";
import { PendingCard } from "@/components/PendingCard";
import { SuggestionCard } from "@/components/SuggestionCard";
import { Vocabulary } from "@/components/Vocabulary";
import { useListener } from "@/lib/useListener";
import { useSpeaker } from "@/lib/useSpeaker";

const FEED_LIMIT = 50;

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|send it|confirm|go ahead)\b/i;
const NO = /^(no|nope|nah|cancel|stop|never mind|nevermind|forget it)\b/i;
/** "when I say school mom it means text mom I'm leaving school" */
const TEACH = /when i say (.+?)[,]? it means (.+)/i;

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
    <div className="stage">
      <Header
        events={events}
        listenState={listener.state}
        onToggleListen={listener.toggle}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />

      <div className="floor">
        <div className="stack">
          <HeardMeant events={events} interim={listener.interim} />
          <CallPanel call={call} />
          <PendingCard
            pending={pending}
            busy={busy}
            onConfirm={() => run(() => executeConfirmed({ userId: user._id }))}
            onCancel={() => run(() => cancelPending({ userId: user._id }))}
          />
        </div>

        <div className="aside">
          <Vocabulary phrases={phrases} />
          <SuggestionCard
            suggestion={suggestion}
            busy={busy}
            onAccept={(trigger) =>
              run(() => acceptSuggestion({ userId: user._id, trigger }))
            }
          />
        </div>
      </div>

      <Feed events={events} />
    </div>
  );
}
