"use client";

import { useState } from "react";

import {
  APPLICATION_STATUS_CLASS,
  APPLICATION_STATUS_LABEL,
  type AnswerDraft,
  type ApplicationFieldVM,
  type ApplicationVM,
} from "@/lib/viewModels";

/**
 * The staged applications, live.
 *
 * A prepare call writes rows; this list is a Convex subscription over them, so
 * a batch prepared by voice appears here without anything being refreshed. Rows
 * whose form still wants an answer land as `review_required` with the exact
 * questions that are missing — answering them revalidates the form server-side,
 * and the row moves to `ready` on its own.
 */
export function ApplicationQueue({
  applications,
  onSaveAnswers,
  onSubmit,
}: {
  applications: ApplicationVM[];
  onSaveAnswers: (applicationId: string, answers: AnswerDraft[]) => Promise<void>;
  onSubmit: (applicationId: string) => Promise<void>;
}) {
  const needsReview = applications.filter((row) => row.status === "review_required").length;

  return (
    <section className="insp-section">
      <div className="insp-head">
        <span>Applications</span>
        <span className="count tnum">
          {needsReview > 0 ? `${needsReview} to review · ` : ""}
          {applications.length}
        </span>
      </div>

      {applications.length === 0 ? (
        <p className="insp-empty">
          Say “apply AI engineer in San Francisco” and the staged roles show up here.
        </p>
      ) : (
        applications.map((application) => (
          <ApplicationCard
            key={application.id}
            application={application}
            onSaveAnswers={onSaveAnswers}
            onSubmit={onSubmit}
          />
        ))
      )}
    </section>
  );
}

function ApplicationCard({
  application,
  onSaveAnswers,
  onSubmit,
}: {
  application: ApplicationVM;
  onSaveAnswers: (applicationId: string, answers: AnswerDraft[]) => Promise<void>;
  onSubmit: (applicationId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answers = toAnswers(draft);
  const locked = application.status === "submitting" || application.status === "submitted";
  const editable = application.missing.length > 0 && !locked;
  const resumeOnlyGaps = application.missing.filter((question) =>
    question.fields.every((field) => field.type === "input_file"),
  );

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

  return (
    <div className="app-card">
      <div className="app-top">
        <div className="app-what">
          <div className="job">
            {application.url ? (
              <a href={application.url} target="_blank" rel="noreferrer">
                {application.title}
              </a>
            ) : (
              application.title
            )}
          </div>
          <div className="where">
            {application.company}
            {application.location ? ` · ${application.location}` : ""}
          </div>
        </div>
        <span className={`chip ${APPLICATION_STATUS_CLASS[application.status]}`}>
          {APPLICATION_STATUS_LABEL[application.status]}
        </span>
      </div>

      {editable ? (
        <div className="app-review">
          <div className="insp-label">
            {application.missing.length} required{" "}
            {application.missing.length === 1 ? "question" : "questions"} left
          </div>

          {application.missing.map((question) => {
            const fields = question.fields.filter((field) => field.type !== "input_file");
            if (fields.length === 0) return null;
            return (
              <div key={question.label + fields[0].name} className="insp-field wide">
                <span className="insp-label">{question.label}</span>
                {fields.map((field) => (
                  <AnswerInput
                    key={field.name}
                    field={field}
                    value={draft[field.name]}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [field.name]: value }))
                    }
                  />
                ))}
              </div>
            );
          })}

          {resumeOnlyGaps.length > 0 ? (
            <p className="insp-note">
              This role requires a résumé — attach one above.
            </p>
          ) : null}
        </div>
      ) : null}

      {application.error ? <p className="insp-error">{application.error}</p> : null}
      {error ? <p className="insp-error">{error}</p> : null}

      <div className="insp-actions">
        {editable ? (
          <button
            type="button"
            className="btn small"
            disabled={busy || answers.length === 0}
            onClick={() => run(async () => {
              await onSaveAnswers(application.id, answers);
              setDraft({});
            })}
          >
            {busy ? "Saving…" : "Save answers"}
          </button>
        ) : null}

        {application.status === "failed" ? (
          <button
            type="button"
            className="btn primary small"
            // Revalidating the stored answers is what lifts a failed row back
            // to `ready`; submit claims no other state.
            disabled={busy || application.missing.length > 0}
            title="Revalidate this form and send it again"
            onClick={() =>
              run(async () => {
                await onSaveAnswers(application.id, []);
                await onSubmit(application.id);
              })
            }
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary small"
            disabled={busy || application.status !== "ready"}
            title={
              application.status === "ready"
                ? "Submit this application"
                : "Only ready applications can be submitted"
            }
            onClick={() => run(() => onSubmit(application.id))}
          >
            {application.status === "submitted"
              ? "Submitted"
              : application.status === "submitting"
                ? "Submitting…"
                : busy
                  ? "Sending…"
                  : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}

function AnswerInput({
  field,
  value,
  onChange,
}: {
  field: ApplicationFieldVM;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const options = field.options ?? [];

  if (field.type === "multi_value_multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <select
        multiple
        className="insp-input"
        value={selected}
        onChange={(event) =>
          onChange(Array.from(event.target.selectedOptions, (option) => option.value))
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const text = typeof value === "string" ? value : "";

  if (options.length > 0) {
    return (
      <select className="insp-input" value={text} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  // Data-compliance fields are consent flags, not free text.
  if (field.type === "input_hidden") {
    return (
      <label className="insp-check">
        <input
          type="checkbox"
          checked={text === "true"}
          onChange={(event) => onChange(event.target.checked ? "true" : "")}
        />
        I consent
      </label>
    );
  }

  if (field.type === "textarea" || field.type === "long_text") {
    return (
      <textarea
        className="insp-input"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className="insp-input"
      type="text"
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Only answers with something in them; blanks would just clear stored values. */
function toAnswers(draft: Record<string, string | string[]>): AnswerDraft[] {
  return Object.entries(draft)
    .filter(([, value]) =>
      Array.isArray(value)
        ? value.some((item) => item.trim().length > 0)
        : value.trim().length > 0,
    )
    .map(([field, value]) => ({ field, value }));
}
