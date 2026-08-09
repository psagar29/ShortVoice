"use client";

import { useMemo } from "react";

const BARS = 64;

/**
 * Deterministic pseudo-random. Math.random() would differ between the server
 * render and the client render and trip hydration; this is stable for a given
 * index, so both sides agree.
 */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Listening indicator.
 *
 * Vertical bars rather than a Siri-style ribbon: bars stay legible when the
 * window is 30 feet away on a projector, and they read as "audio" instantly.
 *
 * A raised-cosine envelope tapers the ends so the shape is centred and organic
 * instead of a uniform hedge, and each bar carries its own period and phase so
 * the motion never falls into visible lockstep.
 *
 * `levels` is the wiring seam: pass real amplitudes (0..1) from the listener's
 * AnalyserNode and the bars follow the microphone instead of the animation.
 */
export function Waveform({
  active,
  levels,
}: {
  active: boolean;
  levels?: number[];
}) {
  const bars = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => {
        // 0 at the edges, 1 in the middle.
        const envelope = Math.sin((Math.PI * i) / (BARS - 1)) ** 0.85;
        const height = (0.18 + noise(i) * 0.82) * envelope;
        return {
          // Fixed precision, as a string. A raw float here hydrates mismatched:
          // React serialises the number server-side and the round-trip loses a
          // digit (0.48418195529574987 vs "0.4841819552957498").
          height: Math.max(0.06, height).toFixed(4),
          period: (0.62 + noise(i + 100) * 0.9).toFixed(2),
          delay: (noise(i + 200) * -1.6).toFixed(2),
          // Blue at the edges through to purple at the centre.
          mix: Math.round(envelope * 100),
        };
      }),
    [],
  );

  return (
    <div className={`wave${active ? " on" : ""}`} aria-hidden>
      {bars.map((bar, i) => (
        <i
          key={i}
          style={
            {
              "--h":
                levels?.[i] !== undefined
                  ? Math.max(0.06, levels[i]).toFixed(4)
                  : bar.height,
              "--d": `${bar.period}s`,
              "--delay": `${bar.delay}s`,
              "--mix": `${bar.mix}%`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
