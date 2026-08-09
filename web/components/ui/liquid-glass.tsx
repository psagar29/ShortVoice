"use client";

import React from "react";

/**
 * Liquid Glass.
 *
 * Real glass does not blur — it *lenses*. It bends what is behind it. A plain
 * `backdrop-filter: blur()` scatters light and reads as frosted plastic, which
 * is why most web "glassmorphism" looks flat.
 *
 * So this stacks four layers, bottom to top:
 *
 *   1. warp   — the backdrop, pushed through an SVG displacement map so edges
 *               refract and bend rather than smear
 *   2. tint   — a diagonal white wash giving the material its body
 *   3. shine  — inset speculars: a bright catch along the top-left lip and a
 *               softer bounce along the bottom-right, the way light behaves on
 *               a curved bevel
 *   4. content — the actual children, above all of it
 *
 * Layer 1 is what makes it glass instead of frost.
 */

export interface GlassEffectProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  href?: string;
  target?: string;
}

/**
 * The displacement filter. Must be in the DOM exactly once, anywhere; every
 * GlassEffect references it by id. Render it near the root.
 */
export function GlassFilterDefs() {
  return (
    <svg
      aria-hidden
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        <filter
          id="lg-distortion"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          {/* Low frequency: broad, lens-like bending rather than fine noise. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.006 0.006"
            numOctaves="2"
            seed="11"
            result="turbulence"
          />
          {/* Softening the map is what stops the warp reading as grain. */}
          <feGaussianBlur in="turbulence" stdDeviation="6" result="softMap" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale="28"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

export function GlassEffect({
  children,
  className = "",
  style,
  href,
  target,
}: GlassEffectProps) {
  const inner = (
    <>
      <span className="lg-warp" aria-hidden />
      <span className="lg-tint" aria-hidden />
      <span className="lg-shine" aria-hidden />
      <span className="lg-content">{children}</span>
    </>
  );

  const classes = ["lg", className].filter(Boolean).join(" ");

  if (href) {
    return (
      <a
        className={classes}
        style={style}
        href={href}
        target={target}
        rel={target === "_blank" ? "noreferrer" : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={classes} style={style}>
      {inner}
    </div>
  );
}
