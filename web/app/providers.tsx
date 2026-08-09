"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { CONVEX_URL } from "@/lib/env";

export function Providers({ children }: { children: ReactNode }) {
  // One client for the life of the tab. Every panel below is a live
  // subscription on it. There is no polling anywhere in this app.
  const [client] = useState(() =>
    CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null,
  );

  // The server render of this layout does not always carry the inlined
  // NEXT_PUBLIC_ value, so a naive guard paints a red "not set" error for one
  // frame and then hydrates into the real dashboard. On a projector that flash
  // reads as a broken demo. Wait until we are mounted on the client before
  // claiming anything is misconfigured.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!client) {
    if (!mounted) {
      return (
        <div className="setup">
          <h1>Connecting to Convex</h1>
          <span className="skeleton" style={{ width: 220 }} />
        </div>
      );
    }
    return (
      <div className="setup">
        <h1>NEXT_PUBLIC_CONVEX_URL is not set</h1>
        <p>Point the dashboard at the deployment, then reload.</p>
        <code>cp web/.env.local.example web/.env.local</code>
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
