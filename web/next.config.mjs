/** @type {import('next').NextConfig} */
const nextConfig = {
  // convex/_generated lives above web/, so tracing has to start at the repo root.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  reactStrictMode: true,

  // `next build` and `next dev` share .next by default, so building while the
  // dev server is up overwrites the chunks it is serving and the page loses
  // all its CSS. Build into a separate directory instead:
  //   NEXT_DIST_DIR=.next-build npx next build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
