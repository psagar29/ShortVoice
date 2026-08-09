"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONVEX_SITE_URL } from "@/lib/env";

export type ListenState = "off" | "connecting" | "live" | "error";

/**
 * Browser mic -> Deepgram nova-3 -> Convex. A second, independent path into
 * the system that does not involve VoiceOS at all.
 *
 * Keyterm prompting is the substantive part. Short, quiet, atypical utterances
 * are exactly what generic ASR fumbles, so we prime the recogniser with the
 * user's own vocabulary: every active trigger and every contact alias, fetched
 * live from GET /keyterms. That is why "school mom" comes back as "school mom"
 * and not "cool mom".
 *
 * Keyterms are nova-3 only, repeated params, no weights, no commas, 500-token
 * cap. We are well under 50 terms.
 */

const DEEPGRAM_WS = "wss://api.deepgram.com/v1/listen";
const KEEPALIVE_MS = 8000;
const CHUNK_MS = 250;

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4", // Safari
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

export function useListener({
  keyterms,
  onTranscript,
}: {
  keyterms: string[];
  /** Called once per finished utterance. */
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<ListenState>("off");
  const [interim, setInterim] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalRef = useRef<string>("");

  // Held in a ref so restarting for new keyterms doesn't need a stale-closure
  // dance with the callback identity.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const teardown = useCallback(() => {
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.close();
    }
    socketRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    finalRef.current = "";
    setInterim("");
  }, []);

  const stop = useCallback(() => {
    teardown();
    setState("off");
  }, [teardown]);

  const start = useCallback(
    async (terms: string[]) => {
      teardown();
      setState("connecting");

      try {
        // Short-lived grant from convex/http.ts -- the raw Deepgram key never
        // reaches this page.
        const tokenRes = await fetch(`${CONVEX_SITE_URL}/listen-token`, {
          method: "POST",
        });
        if (!tokenRes.ok) {
          console.error("[listen-token]", tokenRes.status, await tokenRes.text());
          setState("error");
          return;
        }
        const { token, mode } = (await tokenRes.json()) as {
          token: string;
          mode?: "grant" | "raw";
        };
        // A short-lived grant authenticates as ["bearer", ...]; a raw API key
        // authenticates as ["token", ...]. /listen-token says which it sent.
        const subprotocol = mode === "raw" ? "token" : "bearer";

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;

        const params = new URLSearchParams({
          model: "nova-3",
          smart_format: "true",
          interim_results: "true",
          punctuate: "true",
          endpointing: "400",
        });
        // Repeated params, one per term. This is the whole point of the hook.
        for (const term of terms) params.append("keyterm", term);

        const socket = new WebSocket(`${DEEPGRAM_WS}?${params.toString()}`, [
          subprotocol,
          token,
        ]);
        socketRef.current = socket;

        socket.onopen = () => {
          const mimeType = pickMimeType();
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(event.data);
            }
          };
          recorder.start(CHUNK_MS);

          keepaliveRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "KeepAlive" }));
            }
          }, KEEPALIVE_MS);

          setState("live");
          console.info(`[listener] primed with ${terms.length} keyterms`, terms);
        };

        socket.onmessage = (event) => {
          let message: any;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.type !== "Results") return;

          const transcript: string =
            message.channel?.alternatives?.[0]?.transcript ?? "";

          if (!message.is_final) {
            if (transcript) setInterim(transcript);
            return;
          }

          if (transcript) {
            finalRef.current = `${finalRef.current} ${transcript}`.trim();
          }
          setInterim("");

          // speech_final means Deepgram believes the sentence ended.
          if (message.speech_final && finalRef.current) {
            const utterance = finalRef.current;
            finalRef.current = "";
            onTranscriptRef.current(utterance);
          }
        };

        socket.onerror = () => setState("error");
        socket.onclose = () => {
          // Only surface a close we did not ask for.
          if (socketRef.current === socket) {
            socketRef.current = null;
            setState("off");
          }
        };
      } catch (err) {
        console.error("[listener]", err);
        setState("error");
      }
    },
    [teardown],
  );

  const toggle = useCallback(() => {
    if (state === "off" || state === "error") void start(keyterms);
    else stop();
  }, [state, start, stop, keyterms]);

  // Vocabulary taught at second 30 primes the recogniser at second 40.
  // nova-3 cannot take new keyterms mid-stream, so we reconnect -- a ~200ms
  // gap, and the new word is live inside the same demo.
  const signature = keyterms.join("|");
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    if (state === "live") void start(keyterms);
    // `keyterms` is covered by `signature`; depending on the array identity
    // would restart the socket on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, state, start]);

  useEffect(() => teardown, [teardown]);

  return { state, interim, start, stop, toggle };
}
