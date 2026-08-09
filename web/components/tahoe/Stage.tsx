"use client";

import type { HeroVM, PendingVM, SuggestionVM } from "@/lib/viewModels";

const BAND_LABEL: Record<NonNullable<HeroVM["band"]>, string> = {
  strong: "strong match",
  weak: "weak match",
  cold: "no phrase yet",
};

/**
 * HEARD → MEANT. Three words in, twenty words of intent out.
 *
 * Still the loudest thing on screen, but sized like a product headline rather
 * than a scoreboard: the compression is legible from the shape of the two
 * lines, not from 92px type.
 */
function Hero({ hero, interim }: { hero: HeroVM; interim: string }) {
  const hasHeard = Boolean(interim || hero.heard);

  return (
    <div className="hero">
      <div className="eyebrow">Heard</div>

      {interim ? (
        <div className="heard">
          <span className="quiet">{interim}…</span>
        </div>
      ) : hero.heard ? (
        <div key={hero.heard} className="heard hero-in">
          “{hero.heard}”
        </div>
      ) : (
        <div className="heard">
          <span className="quiet">Say something short.</span>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 6 }}>
        Meant
      </div>

      {hero.meant ? (
        <>
          <div key={hero.meant} className="meant hero-in">
            {hero.meant}
          </div>
          <div className="chips">
            {hero.band ? (
              <span className={`chip ${hero.band}`}>{BAND_LABEL[hero.band]}</span>
            ) : null}
            {typeof hero.score === "number" ? (
              <span className="chip tnum">{Math.round(hero.score * 100)}%</span>
            ) : null}
            {hero.trigger ? <span className="chip">“{hero.trigger}”</span> : null}
            {typeof hero.latencyMs === "number" ? (
              <span className="chip tnum">{hero.latencyMs} ms</span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="meant">
          <span className="quiet" style={{ color: "var(--label-4)", fontWeight: 500 }}>
            {hasHeard ? "…" : "It'll say what you meant."}
          </span>
        </div>
      )}
    </div>
  );
}

/** Nothing consequential fires without passing through here. */
function Confirm({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingVM;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="card confirm">
      <div className="body">
        <div className="what">{pending.confirmationSpeech}</div>
        <div className="hint">Waiting for “yes”</div>
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          Yes, send
        </button>
      </div>
    </div>
  );
}

/** Beat 3: it offers you a word you never asked for. */
function Suggestion({
  suggestion,
  onAccept,
}: {
  suggestion: SuggestionVM;
  onAccept: () => void;
}) {
  return (
    <div className="card suggestion">
      <span className="spark" aria-hidden>
        ✦
      </span>
      <div className="body" style={{ flex: 1, minWidth: 0 }}>
        <div className="why">
          You&rsquo;ve asked for that {suggestion.evidenceCount} times this hour.
        </div>
        <div className="offer">
          Want to just say <span className="word">“{suggestion.proposedTrigger}”</span>?
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onAccept}>
          Teach it
        </button>
      </div>
    </div>
  );
}

export function Stage({
  hero,
  interim,
  pending,
  suggestion,
  onConfirm,
  onCancel,
  onAccept,
}: {
  hero: HeroVM;
  interim: string;
  pending: PendingVM | null;
  suggestion: SuggestionVM | null;
  onConfirm: () => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="stage">
      <Hero hero={hero} interim={interim} />
      {pending ? (
        <Confirm pending={pending} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
      {suggestion ? (
        <Suggestion suggestion={suggestion} onAccept={onAccept} />
      ) : null}
    </div>
  );
}
