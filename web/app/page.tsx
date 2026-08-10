"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

import { GlassFilterDefs } from "@/components/ui/liquid-glass";
import { ActivityFeed } from "@/components/tahoe/ActivityFeed";
import { ApplicationQueue } from "@/components/tahoe/ApplicationQueue";
import { ProfileEditor } from "@/components/tahoe/ProfileEditor";
import { Sidebar } from "@/components/tahoe/Sidebar";
import { Stage } from "@/components/tahoe/Stage";
import { Titlebar } from "@/components/tahoe/Titlebar";
import type {
  AnswerDraft,
  ApplicationVM,
  CallVM,
  ContactVM,
  EventVM,
  HeroVM,
  PendingVM,
  PhraseVM,
  ProfileDraft,
  ProfileVM,
  SuggestionVM,
} from "@/lib/viewModels";
import { useListener } from "@/lib/useListener";
import { useSpeaker } from "@/lib/useSpeaker";

const FEED_LIMIT = 50;
const APPLICATION_LIMIT = 12;

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

type ProfileDoc = NonNullable<FunctionReturnType<typeof api.jobProfiles.getProfile>>;
type ApplicationDoc = FunctionReturnType<typeof api.jobApplicationData.listForUser>[number];

function toProfileVM(profile: ProfileDoc | null | undefined): ProfileVM | null {
  if (!profile) return null;
  return {
    version: profile.updatedAt,
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    countryShortName: profile.countryShortName ?? "",
    linkedInUrl: profile.linkedInUrl ?? "",
    portfolioUrl: profile.portfolioUrl ?? "",
    workAuthorization: profile.workAuthorization ?? "",
    requiresSponsorship: profile.requiresSponsorship ?? "",
    resumeFileName: profile.resumeFileName,
    resumeUrl: profile.resumeUrl ?? undefined,
    resumeSize: profile.resumeSize,
  };
}

/**
 * `missingQuestions` names the fields the form still wants; `formQuestions`
 * knows their types and options. Joining them here is what lets the review
 * form render a real select instead of a text box the server would reject.
 */
function toApplicationVM(application: ApplicationDoc): ApplicationVM {
  const missing = application.missingQuestions.map((question) => {
    const names = new Set(question.fieldNames);
    const source =
      application.formQuestions.find(
        (candidate) =>
          candidate.label === question.label &&
          candidate.fields.some((field) => names.has(field.name)),
      ) ??
      application.formQuestions.find((candidate) =>
        candidate.fields.some((field) => names.has(field.name)),
      );
    const fields = source?.fields ?? question.fieldNames.map((name) => ({
      name,
      type: "input_text",
      values: undefined,
    }));
    return {
      label: question.label,
      fields: fields.map((field) => ({
        name: field.name,
        type: field.type,
        options: field.values,
      })),
    };
  });

  return {
    id: application._id,
    title: application.jobTitle,
    company: application.companyName,
    location: application.jobLocation,
    url: application.jobUrl,
    status: application.status,
    resumeAttached: application.resumeAttached,
    missing,
    error: application.lastError,
  };
}

/** A blank input means "no value", which Convex stores as an absent field. */
function toProfileArgs(draft: ProfileDraft) {
  const value = (raw: string) => raw.trim() || undefined;
  return {
    firstName: value(draft.firstName),
    lastName: value(draft.lastName),
    email: value(draft.email),
    phone: value(draft.phone),
    location: value(draft.location),
    countryShortName: value(draft.countryShortName),
    linkedInUrl: value(draft.linkedInUrl),
    portfolioUrl: value(draft.portfolioUrl),
    workAuthorization: value(draft.workAuthorization),
    requiresSponsorship: value(draft.requiresSponsorship),
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
  const profile = useQuery(api.jobProfiles.getProfile, args);
  const applications = useQuery(
    api.jobApplicationData.listForUser,
    userId ? { userId, limit: APPLICATION_LIMIT } : "skip",
  );

  // ---- writes
  const resolve = useAction(api.resolver.resolve);
  const executeConfirmed = useAction(api.resolver.executeConfirmed);
  const cancelPending = useAction(api.resolver.cancelPending);
  const teachPhrase = useAction(api.teach.teachPhrase);
  const acceptSuggestion = useAction(api.learning.acceptSuggestion);
  const saveProfile = useMutation(api.jobProfiles.saveProfile);
  const generateResumeUploadUrl = useMutation(api.jobProfiles.generateResumeUploadUrl);
  const setResume = useMutation(api.jobProfiles.setResume);
  const clearResume = useMutation(api.jobProfiles.clearResume);
  const saveReviewAnswers = useMutation(api.jobApplicationData.saveReviewAnswers);
  const submitApplication = useAction(api.jobApply.submit);

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

  // ---- applicant profile + the staged applications
  const profileVM = useMemo(() => toProfileVM(profile), [profile]);
  const applicationVMs: ApplicationVM[] = useMemo(
    () => (applications ?? []).map(toApplicationVM),
    [applications],
  );
  const reviewCount = applicationVMs.filter((row) => row.status === "review_required").length;

  // The inspector opens itself the first time a batch is staged, so a prepare
  // done by voice is visible without anyone reaching for the toggle.
  const [inspectorOverride, setInspectorOverride] = useState<boolean | null>(null);
  const inspectorOpen = inspectorOverride ?? applicationVMs.length > 0;

  const handleSaveProfile = useCallback(
    async (draft: ProfileDraft) => {
      if (!userId) return;
      // Only the fields this editor renders. Coordinates and stored default
      // answers have no control here, and saveProfile leaves anything it was
      // not given alone, so a partial form cannot erase them.
      await saveProfile({ userId, ...toProfileArgs(draft) });
    },
    [userId, saveProfile],
  );

  const handleUploadResume = useCallback(
    async (file: File) => {
      if (!userId) return;
      const uploadUrl = await generateResumeUploadUrl({ userId });
      const contentType = file.type || "application/octet-stream";
      const posted = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!posted.ok) throw new Error("The résumé upload failed. Try again.");
      const { storageId } = (await posted.json()) as { storageId: Id<"_storage"> };
      await setResume({ userId, storageId, fileName: file.name, contentType, size: file.size });
    },
    [userId, generateResumeUploadUrl, setResume],
  );

  const handleClearResume = useCallback(async () => {
    if (!userId) return;
    await clearResume({ userId });
  }, [userId, clearResume]);

  const handleSaveAnswers = useCallback(
    async (applicationId: string, answers: AnswerDraft[]) => {
      if (!userId) return;
      await saveReviewAnswers({
        userId,
        applicationId: applicationId as Id<"jobApplications">,
        answers,
      });
    },
    [userId, saveReviewAnswers],
  );

  const handleSubmitApplication = useCallback(
    async (applicationId: string) => {
      const row = (applications ?? []).find((candidate) => candidate._id === applicationId);
      if (!userId || !row) return;
      const result = await submitApplication({
        userId,
        batchId: row.batchId,
        applicationId: row._id,
      });
      // The row's own status is reactive; this only surfaces why nothing moved.
      if (!result.ok) throw new Error(result.speech);
    },
    [userId, applications, submitApplication],
  );

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

        <div className={`window${inspectorOpen ? " with-inspector" : ""}`}>
          <Titlebar
            events={eventVMs}
            listening={listening}
            muted={muted}
            applicationCount={applicationVMs.length}
            reviewCount={reviewCount}
            inspectorOpen={inspectorOpen}
            onToggleListen={listener.toggle}
            onToggleMute={() => setMuted((m) => !m)}
            onToggleInspector={() => setInspectorOverride(!inspectorOpen)}
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

          {inspectorOpen ? (
            <aside className="inspector">
              <ProfileEditor
                profile={profileVM}
                onSave={handleSaveProfile}
                onUploadResume={handleUploadResume}
                onClearResume={handleClearResume}
              />
              <ApplicationQueue
                applications={applicationVMs}
                onSaveAnswers={handleSaveAnswers}
                onSubmit={handleSubmitApplication}
              />
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
