"use client";

/**
 * Unwired design preview. No Convex, no Deepgram — fixtures only.
 *
 * Its job is to let the redesign be reviewed before anything is wired: every
 * state the judges will see (idle, each of the three demo beats, executed) is
 * selectable, in both light and dark. Wiring later means replacing the fixture
 * imports with useQuery subscriptions mapped to the same view models.
 */

import { useEffect, useState } from "react";
import "../tahoe.css";

import { ActivityFeed } from "@/components/tahoe/ActivityFeed";
import { Sidebar } from "@/components/tahoe/Sidebar";
import { Stage } from "@/components/tahoe/Stage";
import { Titlebar } from "@/components/tahoe/Titlebar";
import * as fx from "@/lib/fixtures";
import type { EventVM, HeroVM, PendingVM, PhraseVM, SuggestionVM } from "@/lib/viewModels";

type SceneName = "idle" | "beat1" | "executed" | "beat2" | "beat3";

type Scene = {
  label: string;
  phrases: PhraseVM[];
  hero: HeroVM;
  interim: string;
  pending: PendingVM | null;
  suggestion: SuggestionVM | null;
  events: EventVM[];
  listening: boolean;
};

const SCENES: Record<SceneName, Scene> = {
  idle: {
    label: "Idle",
    phrases: fx.PHRASES,
    hero: fx.HERO_IDLE,
    interim: "",
    pending: null,
    suggestion: null,
    events: [],
    listening: false,
  },
  beat1: {
    label: "Beat 1 · compression",
    phrases: fx.PHRASES,
    hero: fx.HERO_BEAT1,
    interim: "",
    pending: fx.PENDING_BEAT1,
    suggestion: null,
    events: fx.FEED_BEAT1,
    listening: true,
  },
  executed: {
    label: "Beat 1 · sent",
    phrases: fx.PHRASES,
    hero: fx.HERO_BEAT1,
    interim: "",
    pending: null,
    suggestion: null,
    events: fx.FEED_EXECUTED,
    listening: true,
  },
  beat2: {
    label: "Beat 2 · taught live",
    phrases: [...fx.PHRASES, fx.TAUGHT_PHRASE],
    hero: fx.HERO_BEAT2,
    interim: "",
    pending: fx.PENDING_BEAT2,
    suggestion: null,
    events: fx.FEED_BEAT2,
    listening: true,
  },
  beat3: {
    label: "Beat 3 · it teaches you",
    phrases: [...fx.PHRASES, fx.TAUGHT_PHRASE],
    hero: fx.HERO_BEAT3,
    interim: "",
    pending: null,
    suggestion: fx.SUGGESTION,
    events: fx.FEED_BEAT3,
    listening: true,
  },
};

const ORDER: SceneName[] = ["idle", "beat1", "executed", "beat2", "beat3"];

/** ?scene=beat2&theme=light — so any single state is linkable and screenshottable. */
function readUrl(): { scene: SceneName; theme: "light" | "dark" } {
  if (typeof window === "undefined") return { scene: "beat1", theme: "dark" };
  const q = new URLSearchParams(window.location.search);
  const scene = q.get("scene") as SceneName | null;
  const theme = q.get("theme");
  return {
    scene: scene && scene in SCENES ? scene : "beat1",
    theme: theme === "light" ? "light" : "dark",
  };
}

export default function Preview() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [sceneName, setSceneName] = useState<SceneName>("beat1");
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const initial = readUrl();
    setSceneName(initial.scene);
    setTheme(initial.theme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const scene = SCENES[sceneName];

  return (
    <>
      <div className="desktop">
        <div className="blob" />

        <div className="window">
          <Titlebar
            events={scene.events}
            listening={scene.listening}
            muted={muted}
            onToggleListen={() => {}}
            onToggleMute={() => setMuted((m) => !m)}
          />

          <Sidebar phrases={scene.phrases} contacts={fx.CONTACTS} />

          <div className="content">
            <Stage
              hero={scene.hero}
              interim={scene.interim}
              pending={scene.pending}
              suggestion={scene.suggestion}
              onConfirm={() => setSceneName("executed")}
              onCancel={() => setSceneName("idle")}
              onAccept={() => setSceneName("beat3")}
            />
            <ActivityFeed events={scene.events} />
          </div>
        </div>
      </div>

      {/* Review-only chrome. Not part of the design; deleted when wiring. */}
      <div className="review-bar">
        {ORDER.map((name) => (
          <button
            key={name}
            type="button"
            className={`review-btn${name === sceneName ? " on" : ""}`}
            onClick={() => setSceneName(name)}
          >
            {SCENES[name].label}
          </button>
        ))}
        <span className="review-sep" />
        <button
          type="button"
          className="review-btn"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </>
  );
}
