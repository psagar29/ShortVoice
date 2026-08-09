/** @type {import('next').NextConfig} */
const nextConfig = {
  // convex/_generated lives above web/, so tracing has to start at the repo root.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  reactStrictMode: true,
};

export default nextConfig;
