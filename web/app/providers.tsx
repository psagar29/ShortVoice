"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";
import { CONVEX_URL } from "@/lib/env";

export function Providers({ children }: { children: ReactNode }) {
  // One client for the life of the tab. Every panel below is a live
  // subscription on it -- there is no polling anywhere in this app.
  const [client] = useState(() =>
    CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null,
  );

  if (!client) {
    return (
      <div className="setup">
        <h1>NEXT_PUBLIC_CONVEX_URL is not set</h1>
        <p>
          <code>cp web/.env.local.example web/.env.local</code>
        </p>
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
