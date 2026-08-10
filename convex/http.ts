// ============================================================================
// Person D owns this file. See CONTRACT.md section 5.
// ============================================================================
//
// Served from https://reminiscent-anteater-318.convex.SITE -- not .convex.cloud.
// Those are different hosts and mixing them up costs twenty minutes every time.
//
//   POST /tts           { text, voice? }        -> audio/mpeg
//   GET  /keyterms      ?userId=...             -> { keyterms: string[] }
//   POST /listen-token  {}                      -> { token, expiresIn }
//   POST /voice         (a1mobile webhook)      -> TeXML
//   POST /voice/turn    (a1mobile webhook)      -> TeXML
//
// DEEPGRAM_API_KEY lives in Convex env (`npx convex env set DEEPGRAM_API_KEY ...`)
// and never reaches the browser. The listener gets a short-lived grant instead.

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { openingLine } from "./telephony";

const DEEPGRAM = "https://api.deepgram.com";
const DEFAULT_VOICE = "aura-2-thalia-en";

/** Seconds a browser listen token stays valid. Long enough to connect, short
 *  enough that leaking one out of the devtools network tab does not matter. */
const LISTEN_TOKEN_TTL_SECONDS = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Every route needs one of these or the browser blocks the real request. */
const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS }));

function deepgramKey(): string | null {
  return process.env.DEEPGRAM_API_KEY ?? null;
}

const http = httpRouter();

// ---------------------------------------------------------------------------
// POST /tts -- ShortVoice's own voice, distinct from VoiceOS's.
// Person C calls this from the MCP server; the dashboard calls it too.
// ---------------------------------------------------------------------------
http.route({
  path: "/tts",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const key = deepgramKey();
    if (!key) {
      return json({ error: "DEEPGRAM_API_KEY is not set in Convex env" }, 500);
    }

    let text: string;
    let voice: string;
    try {
      const body = await request.json();
      text = String(body?.text ?? "").trim();
      voice = String(body?.voice ?? DEFAULT_VOICE);
    } catch {
      return json({ error: "body must be JSON: { text, voice? }" }, 400);
    }
    if (!text) return json({ error: "text is required" }, 400);

    const dg = await fetch(
      `${DEEPGRAM}/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );

    if (!dg.ok) {
      return json({ error: `deepgram ${dg.status}: ${await dg.text()}` }, 502);
    }

    return new Response(await dg.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    });
  }),
});
http.route({ path: "/tts", method: "OPTIONS", handler: preflight });

// ---------------------------------------------------------------------------
// GET /keyterms -- the user's own vocabulary, for nova-3 keyterm priming.
//
// This is the substantive part of the listener, not a checkbox: short, quiet,
// atypical utterances are exactly what generic ASR fumbles. Priming with these
// is why "school mom" comes back as "school mom" and not "cool mom".
// ---------------------------------------------------------------------------
http.route({
  path: "/keyterms",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const param = new URL(request.url).searchParams.get("userId");

    let userId: Id<"users">;
    if (param) {
      userId = param as Id<"users">;
    } else {
      // Convenience for the dashboard: fall back to the demo user.
      const demo = await ctx.runQuery(api.users.getUser, { handle: "demo" });
      if (!demo) return json({ error: "no demo user; run seed:seedDemo" }, 404);
      userId = demo._id;
    }

    try {
      const [phrases, contacts] = await Promise.all([
        ctx.runQuery(api.phrases.listPhrases, { userId }),
        ctx.runQuery(api.contacts.listContacts, { userId }),
      ]);

      // Triggers plus the names behind every alias -- "neel" and "Neel", "mom"
      // and "Rashmi" -- since either can show up in speech.
      const terms = new Set<string>();
      for (const phrase of phrases) terms.add(phrase.trigger);
      for (const contact of contacts) {
        terms.add(contact.alias);
        terms.add(contact.fullName);
      }

      // No commas, no weights, 500-token cap. We are far under it.
      const keyterms = [...terms]
        .map((t) => t.replace(/,/g, " ").trim())
        .filter(Boolean);

      return json({ keyterms });
    } catch (err) {
      return json({ error: `could not read vocabulary: ${String(err)}` }, 400);
    }
  }),
});
http.route({ path: "/keyterms", method: "OPTIONS", handler: preflight });

// ---------------------------------------------------------------------------
// POST /listen-token -- credentials for the browser listener.
//
// Preferred: a short-lived grant from Deepgram, so the raw key never reaches a
// page anyone can view-source. That needs a key with token-grant permission;
// a speech-only key gets 403 "Insufficient permissions" here.
//
// Fallback: if DEEPGRAM_ALLOW_RAW_KEY is set to "true" in Convex env, hand the
// browser the raw key instead. This DOES expose the key to anyone with
// devtools open. It exists so a demo is never blocked by key scope -- it is
// opt-in, off by default, and reported back in `mode` so the UI can say so.
//
//   npx convex env set DEEPGRAM_ALLOW_RAW_KEY true
//
// The two credentials need different WebSocket subprotocols: a grant connects
// as ["bearer", token], a raw key as ["token", key]. `mode` tells the client
// which to use.
// ---------------------------------------------------------------------------
http.route({
  path: "/listen-token",
  method: "POST",
  handler: httpAction(async () => {
    const key = deepgramKey();
    if (!key) {
      return json({ error: "DEEPGRAM_API_KEY is not set in Convex env" }, 400);
    }

    const allowRawKey = process.env.DEEPGRAM_ALLOW_RAW_KEY === "true";

    try {
      const grant = await fetch(`${DEEPGRAM}/v1/auth/grant`, {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: LISTEN_TOKEN_TTL_SECONDS }),
      });

      const raw = await grant.text();
      if (!grant.ok) {
        if (allowRawKey) {
          return json({ mode: "raw", token: key, expiresIn: 0 });
        }
        // 4xx, not 5xx: a 5xx from an httpAction is swallowed by the edge and
        // replaced with a bare "error code: 502", which hides the real cause.
        return json(
          {
            error: `deepgram ${grant.status}: ${raw}`,
            hint:
              grant.status === 403
                ? "this key cannot mint tokens; use a key with token-grant permission, or set DEEPGRAM_ALLOW_RAW_KEY=true in Convex env"
                : undefined,
          },
          400,
        );
      }

      const body = JSON.parse(raw);
      return json({
        mode: "grant",
        token: body.access_token,
        expiresIn: body.expires_in ?? LISTEN_TOKEN_TTL_SECONDS,
      });
    } catch (err) {
      if (allowRawKey) return json({ mode: "raw", token: key, expiresIn: 0 });
      return json({ error: `listen-token failed: ${String(err)}` }, 400);
    }
  }),
});
http.route({ path: "/listen-token", method: "OPTIONS", handler: preflight });

// ---------------------------------------------------------------------------
// a1mobile voice webhooks -- the phone call half of ShortVoice.
//
// a1mobile dials, and on answer POSTs here. The request carries no memory of
// why the call was placed, so we look up the live `calls` row to find the
// brief. We answer in TeXML (Telnyx's TwiML dialect): <Say> speaks, <Gather>
// listens and POSTs the transcript to the action URL for the next turn.
//
// These are provider callbacks, not browser calls, so no CORS and no preflight.
// ---------------------------------------------------------------------------

function texml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}

/** TeXML is XML: an unescaped & or < in spoken text breaks the whole document. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function speakAndListen(say: string, siteUrl: string): Response {
  return texml(
    `<Say voice="Polly.Joanna">${xmlEscape(say)}</Say>` +
      `<Gather input="speech" language="en-US" speechTimeout="auto" ` +
      `action="${siteUrl}/voice/turn" method="POST">` +
      `<Pause length="3"/>` +
      `</Gather>` +
      // Reached only if they never speak. Never leave a call hanging silently.
      `<Say voice="Polly.Joanna">Sorry, I didn't catch that. I'll try again later. Goodbye.</Say>` +
      `<Hangup/>`,
  );
}

function siteUrlFrom(request: Request): string {
  return process.env.CONVEX_SITE_URL ?? new URL(request.url).origin;
}

/** Providers post either form-encoded or JSON depending on the event. Accept both. */
async function readParams(request: Request): Promise<Record<string, string>> {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, val]) => [k, String(val)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

http.route({
  path: "/voice",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const call = await ctx.runQuery(internal.telephony.activeCall, {});
    if (!call) {
      // Someone dialled our number directly, or the row is gone. Be a polite
      // human-facing voicemail rather than dead air.
      return texml(
        `<Say voice="Polly.Joanna">You've reached ShortVoice, an assistant that places ` +
          `calls on behalf of its user. There's no call in progress right now. Goodbye.</Say><Hangup/>`,
      );
    }

    const line = openingLine(call);
    await ctx.runMutation(internal.telephony.appendTurn, {
      callId: call._id,
      role: "agent",
      text: line,
    });
    return speakAndListen(line, siteUrlFrom(request));
  }),
});

http.route({
  path: "/voice/turn",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const params = await readParams(request);
    const heard = (params.SpeechResult ?? params.speech_result ?? params.Digits ?? "").trim();

    const call = await ctx.runQuery(internal.telephony.activeCall, {});
    if (!call) return texml(`<Hangup/>`);

    if (heard) {
      await ctx.runMutation(internal.telephony.appendTurn, {
        callId: call._id,
        role: "them",
        text: heard,
      });
    }

    const { say, done } = await ctx.runAction(internal.telephony.nextLine, {
      callId: call._id,
      heard: heard || "(silence)",
    });

    await ctx.runMutation(internal.telephony.appendTurn, {
      callId: call._id,
      role: "agent",
      text: say,
    });

    if (!done) return speakAndListen(say, siteUrlFrom(request));

    const outcome = await ctx.runAction(internal.telephony.summarise, { callId: call._id });
    await ctx.runMutation(internal.telephony.finishCall, {
      callId: call._id,
      status: "completed",
      outcome,
    });
    return texml(`<Say voice="Polly.Joanna">${xmlEscape(say)}</Say><Hangup/>`);
  }),
});

export default http;
