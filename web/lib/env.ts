/**
 * .convex.cloud and .convex.site are different hosts. Function calls go to
 * .cloud; convex/http.ts routes are served from .site. Deriving one from the
 * other means a single env var can't be half-configured -- the mistake
 * CONTRACT.md says costs twenty minutes every time.
 */
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
  CONVEX_URL.replace(".convex.cloud", ".convex.site");
