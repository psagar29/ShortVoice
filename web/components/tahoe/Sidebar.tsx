"use client";

import { ACTION_GLYPH, type ContactVM, type PhraseVM } from "@/lib/viewModels";

/**
 * A Mac source list — and the vocabulary lives in it.
 *
 * Putting MY LANGUAGE in the sidebar rather than a right-hand panel is the
 * main structural change in this redesign. It is where a Mac app puts its
 * collection (Mail's mailboxes, Finder's places), and it means the user's
 * personal language is permanently on screen instead of competing for the
 * stage — so a phrase taught mid-demo still lands somewhere unmissable.
 */
export function Sidebar({
  phrases,
  contacts,
}: {
  phrases: PhraseVM[];
  contacts: ContactVM[];
}) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <span>My Language</span>
        <span className="count tnum">{phrases.length}</span>
      </div>

      {phrases.map((phrase) => (
        <div
          key={phrase.id}
          className={`side-row${phrase.fresh ? " fresh" : ""}`}
          title={phrase.trigger}
        >
          <span className="glyph">{ACTION_GLYPH[phrase.actionType]}</span>
          <span className="text">{phrase.trigger}</span>
          {phrase.fresh ? (
            <span className="badge">
              {phrase.source === "suggested" ? "learned" : "new"}
            </span>
          ) : phrase.useCount > 0 ? (
            <span className="uses tnum">{phrase.useCount}</span>
          ) : null}
        </div>
      ))}

      <div className="side-sep" />

      <div className="side-head">
        <span>People</span>
      </div>

      {contacts.map((contact) => (
        <div key={contact.id} className="side-row">
          <span className="glyph">◍</span>
          <span className="text">{contact.fullName}</span>
          <span className="uses">{contact.alias}</span>
        </div>
      ))}

      <div className="side-foot">
        <span className="avatar">D</span>
        <span>Demo</span>
      </div>
    </aside>
  );
}
