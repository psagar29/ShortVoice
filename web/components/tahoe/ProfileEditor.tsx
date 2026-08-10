"use client";

import { useRef, useState } from "react";

import type { ProfileDraft, ProfileVM } from "@/lib/viewModels";

/**
 * The applicant identity every application form is filled from.
 *
 * Compact on purpose: it is an inspector section, not a settings page. What it
 * holds is exactly what convex/lib/demoJobBoard.ts maps onto form fields —
 * name/email/phone/location plus the two answers every listing asks for — and
 * the résumé, which is the one thing a form cannot be completed without.
 */

const EMPTY_DRAFT: ProfileDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  countryShortName: "",
  linkedInUrl: "",
  portfolioUrl: "",
  workAuthorization: "",
  requiresSponsorship: "",
};

const FIELDS: Array<{
  key: keyof ProfileDraft;
  label: string;
  placeholder?: string;
  wide?: boolean;
  type?: "email" | "tel" | "url";
}> = [
  { key: "firstName", label: "First name", placeholder: "Ada" },
  { key: "lastName", label: "Last name", placeholder: "Lovelace" },
  { key: "email", label: "Email", placeholder: "ada@example.com", type: "email", wide: true },
  { key: "phone", label: "Phone", placeholder: "+1 415 555 0134", type: "tel" },
  { key: "location", label: "Location", placeholder: "San Francisco, CA" },
  { key: "countryShortName", label: "Country code", placeholder: "US" },
  { key: "workAuthorization", label: "Work authorized", placeholder: "Yes" },
  { key: "requiresSponsorship", label: "Needs sponsorship", placeholder: "No" },
  { key: "linkedInUrl", label: "LinkedIn", placeholder: "linkedin.com/in/…", type: "url", wide: true },
  { key: "portfolioUrl", label: "Portfolio", placeholder: "example.com", type: "url", wide: true },
];

const RESUME_ACCEPT = ".pdf,.doc,.docx,.txt,.rtf";

export function ProfileEditor({
  profile,
  onSave,
  onUploadResume,
  onClearResume,
}: {
  profile: ProfileVM | null;
  onSave: (draft: ProfileDraft) => Promise<void>;
  onUploadResume: (file: File) => Promise<void>;
  onClearResume: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile));
  const [seenVersion, setSeenVersion] = useState(profile?.version ?? 0);
  const [edited, setEdited] = useState(false);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  // A newer stored profile wins, so a résumé upload or a voice-side write shows
  // up here — but never on top of fields the user is still typing into.
  const version = profile?.version ?? 0;
  if (version !== seenVersion) {
    setSeenVersion(version);
    if (!edited) setDraft(toDraft(profile));
  }

  const complete = Boolean(
    draft.firstName.trim() && draft.lastName.trim() && draft.email.trim() && profile?.resumeFileName,
  );
  const open = expanded ?? !complete;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof ProfileDraft, value: string) => {
    setEdited(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="insp-section">
      <div className="insp-head">
        <span>Applicant</span>
        <button
          type="button"
          className="insp-toggle"
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
        >
          {open ? "Done" : "Edit"}
        </button>
      </div>

      <div className="insp-card">
        {open ? (
          <>
            <div className="insp-grid">
              {FIELDS.map((field) => (
                <label
                  key={field.key}
                  className={`insp-field${field.wide ? " wide" : ""}`}
                >
                  <span className="insp-label">{field.label}</span>
                  <input
                    className="insp-input"
                    type={field.type ?? "text"}
                    value={draft[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="insp-actions">
              <button
                type="button"
                className="btn primary small"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await onSave(draft);
                    setEdited(false);
                  })
                }
              >
                {busy ? "Saving…" : "Save profile"}
              </button>
            </div>
          </>
        ) : (
          <div className="insp-summary">
            <span className="who">
              {[draft.firstName, draft.lastName].filter(Boolean).join(" ") || "No name yet"}
            </span>
            <span className="quiet">{draft.email || "No email yet"}</span>
            {draft.location ? <span className="quiet">{draft.location}</span> : null}
          </div>
        )}

        <div className="insp-resume">
          <span className="glyph" aria-hidden>
            ◫
          </span>
          {profile?.resumeFileName ? (
            <span className="insp-file">
              {profile.resumeUrl ? (
                <a href={profile.resumeUrl} target="_blank" rel="noreferrer">
                  {profile.resumeFileName}
                </a>
              ) : (
                profile.resumeFileName
              )}
              {typeof profile.resumeSize === "number" ? (
                <span className="quiet tnum"> · {formatSize(profile.resumeSize)}</span>
              ) : null}
            </span>
          ) : (
            <span className="insp-file quiet">No résumé attached</span>
          )}

          <input
            ref={filePicker}
            className="insp-hidden-file"
            type="file"
            accept={RESUME_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void run(() => onUploadResume(file));
            }}
          />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => filePicker.current?.click()}
          >
            {profile?.resumeFileName ? "Replace" : "Upload"}
          </button>
          {profile?.resumeFileName ? (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => run(onClearResume)}
            >
              Remove
            </button>
          ) : null}
        </div>

        {error ? <p className="insp-error">{error}</p> : null}
      </div>
    </section>
  );
}

function toDraft(profile: ProfileVM | null): ProfileDraft {
  if (!profile) return EMPTY_DRAFT;
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    countryShortName: profile.countryShortName,
    linkedInUrl: profile.linkedInUrl,
    portfolioUrl: profile.portfolioUrl,
    workAuthorization: profile.workAuthorization,
    requiresSponsorship: profile.requiresSponsorship,
  };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
