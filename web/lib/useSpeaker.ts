"use client";

import { useCallback, useEffect, useRef } from "react";
import { CONVEX_SITE_URL } from "@/lib/env";

/**
 * ShortVoice's own voice, in its own aura-2 model, distinct from VoiceOS's.
 *
 * Audio comes from POST /tts on convex/http.ts rather than straight from
 * Deepgram, so DEEPGRAM_API_KEY stays in Convex env and never reaches this
 * bundle. REST is used rather than the streaming WS: at one short sentence per
 * confirmation the latency is not visible, and one fewer socket is one fewer
 * thing to fail on stage.
 */
export function useSpeaker(muted: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  /** Keys already spoken, so a re-render never repeats a sentence. */
  const spokenRef = useRef(new Set<string>());

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim() || !CONVEX_SITE_URL) return;
      try {
        const res = await fetch(`${CONVEX_SITE_URL}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          console.warn("[tts]", res.status, await res.text());
          return;
        }

        stop();
        const url = URL.createObjectURL(await res.blob());
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        await audio.play();
      } catch (err) {
        console.warn("[tts]", err);
      }
    },
    [stop],
  );

  /** Speak `text` at most once for a given `key` (e.g. a pendingAction id). */
  const speakOnce = useCallback(
    (key: string, text: string) => {
      if (spokenRef.current.has(key)) return;
      spokenRef.current.add(key);
      if (!muted) void speak(text);
    },
    [muted, speak],
  );

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (muted) stop();
  }, [muted, stop]);

  return { speak, speakOnce, stop };
}
