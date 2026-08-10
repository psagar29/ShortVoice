// ============================================================================
// ShortVoice -- outbound calling via a1mobile
// ============================================================================
// "Appointment. Dentist." is three words that become a real phone call.
//
// Two halves that run in different places and only meet through the `calls`
// table:
//
//   1. startCall        writes the row, then asks a1mobile to dial.
//   2. convex/http.ts   serves the /voice webhook a1mobile hits on answer.
//      That request arrives with no memory of why the call was placed, so it
//      loads the row to learn what it is supposed to say.
//
// The agent speaks from an explicit brief (name, callback, window, reason)
// rather than a free-form prompt, so it cannot invent commitments on the
// user's behalf. It also opens every call by saying it is an assistant
// calling for someone. People are entitled to know what they are talking to.
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { bool, chatJSON, hasOpenAI, obj, str } from "./lib/openai";

const A1_BASE = "https://hack.a1mobile.com";

/** Our own a1mobile number, used as the callback we read out on the call. */
function ourNumber(): string {
  return process.env.A1_PHONE_NUMBER ?? "";
}

// ---------------------------------------------------------------------------
// Placing the call
// ---------------------------------------------------------------------------

export const startCall = internalAction({
  args: {
    userId: v.id("users"),
    to: v.string(),
    business: v.string(),
    purpose: v.string(),
    callerName: v.string(),
    preferredWindow: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    const teamKey = process.env.A1_TEAM_KEY;
    if (!teamKey) {
      return {
        ok: false,
        detail: "Calling is not configured. Set A1_TEAM_KEY in the Convex environment.",
      };
    }
    if (!args.to) {
      return { ok: false, detail: `I don't have a number for ${args.business}.` };
    }

    const callId: Id<"calls"> = await ctx.runMutation(internal.telephony.createCall, {
      userId: args.userId,
      to: args.to,
      business: args.business,
      purpose: args.purpose,
      brief: {
        callerName: args.callerName,
        callbackNumber: ourNumber(),
        preferredWindow: args.preferredWindow,
        reason: args.reason,
      },
    });

    try {
      const res = await fetch(`${A1_BASE}/api/calls`, {
        method: "POST",
        headers: { "X-Team-Key": teamKey, "Content-Type": "application/json" },
        body: JSON.stringify({ to: args.to }),
      });
      const body = await res.text();

      if (!res.ok) {
        // A trial account may refuse unverified destinations. Say so plainly
        // rather than letting the demo hang on a call that never dials.
        await ctx.runMutation(internal.telephony.finishCall, {
          callId,
          status: "failed",
          outcome: `Provider refused the call: ${body.slice(0, 140)}`,
        });
        return {
          ok: false,
          detail: `I couldn't place the call to ${args.business}. The provider refused it.`,
        };
      }

      let providerCallId: string | undefined;
      try {
        providerCallId = (JSON.parse(body) as { call_id?: string; id?: string }).call_id ??
          (JSON.parse(body) as { id?: string }).id;
      } catch {
        /* provider returned a non-JSON ack; the call still dialed */
      }
      if (providerCallId) {
        await ctx.runMutation(internal.telephony.attachProviderId, { callId, providerCallId });
      }

      return {
        ok: true,
        detail: `Calling ${args.business} now to ${args.purpose}. You'll hear it on the dashboard.`,
      };
    } catch (err) {
      console.error("[shortvoice] a1mobile dial failed:", err);
      await ctx.runMutation(internal.telephony.finishCall, {
        callId,
        status: "failed",
        outcome: "Network error reaching the calling provider.",
      });
      return { ok: false, detail: `I couldn't reach the phone network to call ${args.business}.` };
    }
  },
});

// ---------------------------------------------------------------------------
// Row lifecycle
// ---------------------------------------------------------------------------

export const createCall = internalMutation({
  args: {
    userId: v.id("users"),
    to: v.string(),
    business: v.string(),
    purpose: v.string(),
    brief: v.object({
      callerName: v.string(),
      callbackNumber: v.string(),
      preferredWindow: v.string(),
      reason: v.string(),
    }),
  },
  handler: async (ctx, args): Promise<Id<"calls">> => {
    // Only one call can be live at a time. The webhook identifies its call by
    // "the one that is currently dialing", so a stale row would hijack it.
    for (const row of await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "dialing"))
      .collect()) {
      await ctx.db.patch(row._id, { status: "failed", outcome: "Superseded by a newer call." });
    }

    const callId = await ctx.db.insert("calls", {
      ...args,
      status: "dialing",
      transcript: [],
      createdAt: Date.now(),
    });

    await ctx.runMutation(internal.events.log, {
      userId: args.userId,
      kind: "executed",
      text: `Dialing ${args.business} to ${args.purpose}`,
    });

    return callId;
  },
});

export const attachProviderId = internalMutation({
  args: { callId: v.id("calls"), providerCallId: v.string() },
  handler: async (ctx, { callId, providerCallId }) => {
    await ctx.db.patch(callId, { providerCallId });
  },
});

/** The webhook has no call context, so it asks for the one that is live. */
export const activeCall = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"calls"> | null> => {
    const dialing = await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "dialing"))
      .order("desc")
      .first();
    if (dialing) return dialing;
    return await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .order("desc")
      .first();
  },
});

export const appendTurn = internalMutation({
  args: {
    callId: v.id("calls"),
    role: v.union(v.literal("agent"), v.literal("them")),
    text: v.string(),
  },
  handler: async (ctx, { callId, role, text }) => {
    const call = await ctx.db.get(callId);
    if (!call) return;
    await ctx.db.patch(callId, {
      status: call.status === "dialing" ? "in_progress" : call.status,
      transcript: [...call.transcript, { role, text, at: Date.now() }],
    });
    await ctx.runMutation(internal.events.log, {
      userId: call.userId,
      kind: "executed",
      text: `${role === "agent" ? "ShortVoice" : call.business}: ${text}`,
    });
  },
});

export const finishCall = internalMutation({
  args: {
    callId: v.id("calls"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    outcome: v.string(),
  },
  handler: async (ctx, { callId, status, outcome }) => {
    const call = await ctx.db.get(callId);
    if (!call) return;
    await ctx.db.patch(callId, { status, outcome });
    await ctx.runMutation(internal.events.log, {
      userId: call.userId,
      kind: status === "completed" ? "executed" : "error",
      text: outcome,
    });
  },
});

/** The dashboard subscribes to this so the room can watch a call it can't hear. */
export const liveCall = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"calls"> | null> => {
    return await ctx.db
      .query("calls")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

// ---------------------------------------------------------------------------
// What the agent says next
// ---------------------------------------------------------------------------

/** The opening line. Always identifies itself: people get to know what they're talking to. */
export function openingLine(call: Doc<"calls">): string {
  return (
    `Hi, this is an automated assistant calling on behalf of ${call.brief.callerName}. ` +
    `I'd like to ${call.purpose}. The reason is ${call.brief.reason}. ` +
    `${call.brief.callerName} is free ${call.brief.preferredWindow}. ` +
    `Do you have anything available then?`
  );
}

export const nextLine = internalAction({
  args: { callId: v.id("calls"), heard: v.string() },
  handler: async (ctx, { callId, heard }): Promise<{ say: string; done: boolean }> => {
    const call: Doc<"calls"> | null = await ctx.runQuery(internal.telephony.getCall, { callId });
    if (!call) return { say: "Sorry, something went wrong on my end. Goodbye.", done: true };

    if (!hasOpenAI()) {
      // Scripted fallback, same shape as the rest of the codebase: degrade to
      // something that still completes rather than throwing mid-call.
      return {
        say:
          `Thank you. Could you please hold that for ${call.brief.callerName} and ` +
          `confirm by text to ${call.brief.callbackNumber}? Thanks very much. Goodbye.`,
        done: true,
      };
    }

    const history = call.transcript
      .map((t) => `${t.role === "agent" ? "Assistant" : "Them"}: ${t.text}`)
      .join("\n");

    const reply = await chatJSON<{ say: string; done: boolean }>({
      system:
        "You are a polite assistant on a phone call booking an appointment for someone. " +
        "Keep every reply under 30 words, plain spoken English, no lists, no markdown. " +
        "You may only agree to times that fall inside the caller's stated availability. " +
        "Never invent personal, medical or payment details beyond the brief you are given. " +
        "When a time is agreed, confirm it back once and set done. " +
        "Set done only when the call should hang up: booked, refused, or no availability.",
      user:
        `Brief: caller ${call.brief.callerName}, reason ${call.brief.reason}, ` +
        `availability ${call.brief.preferredWindow}, callback ${call.brief.callbackNumber}. ` +
        `Calling ${call.business} to ${call.purpose}.\n\n` +
        `Conversation so far:\n${history}\n\nThem: ${heard}`,
      schemaName: "call_turn",
      schema: obj({
        say: str("what the assistant says next, under 30 words"),
        done: bool("true if the call should hang up now"),
      }),
      maxTokens: 200,
    });

    if (reply?.say) return { say: reply.say, done: Boolean(reply.done) };
    return {
      say: `Thank you. Could you confirm by text to ${call.brief.callbackNumber}? Goodbye.`,
      done: true,
    };
  },
});

export const getCall = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<Doc<"calls"> | null> => ctx.db.get(callId),
});

export const summarise = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<string> => {
    const call: Doc<"calls"> | null = await ctx.runQuery(internal.telephony.getCall, { callId });
    if (!call) return "Call ended.";
    const said = call.transcript.map((t) => `${t.role}: ${t.text}`).join("\n");

    const summary = await chatJSON<{ outcome: string }>({
      system:
        "Summarise the outcome of this phone call in one sentence under 20 words, " +
        "to be spoken aloud to the person the call was made for. " +
        "Lead with the booked time if there is one.",
      user: said,
      schemaName: "call_outcome",
      schema: obj({ outcome: str("one sentence, under 20 words") }),
      maxTokens: 120,
    });

    return (
      summary?.outcome ??
      `Call with ${call.business} finished after ${call.transcript.length} exchanges.`
    );
  },
});
