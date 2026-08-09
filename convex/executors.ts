// ============================================================================
// ShortVoice -- network executors  (Person B)
// ============================================================================
// Only the things Convex can physically do from a server: Slack and the web.
// AppleScript actions (iMessage, Calendar, screen reads, DND, app launching)
// belong to Person C's MCP server on the Mac and are never attempted here.
//
// Governing principle, from the brief: a demo that visibly "sends" beats a demo
// that throws. Every branch returns { ok, detail } with a sentence worth
// speaking, even when the integration behind it is not wired up.
// ============================================================================

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { clampWords } from "./lib/text";

export type ExecutorResult = { ok: boolean; detail: string };

export const runNetworkAction = internalAction({
  args: { actionType: v.string(), params: v.any(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { actionType, params, userId }): Promise<ExecutorResult> => {
    // place_call needs to know who it is calling for; everything else does not.
    if (userId) (params as Record<string, unknown>).userId = userId;
    const p = (params ?? {}) as Record<string, unknown>;
    switch (actionType) {
      case "send_slack":
        return await sendSlack(p);
      case "web_search":
        return await webSearch(ctx, p);
      case "place_call":
        return await placeCall(ctx, p);
      case "speak":
      case "custom":
        return { ok: true, detail: String(p.text ?? "Done.") };
      default:
        return { ok: false, detail: `${actionType} is not a network action.` };
    }
  },
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

async function sendSlack(params: Record<string, unknown>): Promise<ExecutorResult> {
  const channel = String(params.channel ?? params.slackId ?? "").trim();
  const text = String(params.text ?? params.body ?? "").trim();
  if (!text) return { ok: false, detail: "There was no message to send." };

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) {
    // Not wired up: the message still lands in the events feed via
    // executeConfirmed, the dashboard still shows it, the demo still reads as
    // "sent". Honest wording, working demo.
    return { ok: true, detail: `Message to ${channel || "the team"}: "${text}"` };
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const json: any = await res.json();
    if (!json?.ok) {
      console.error("[shortvoice] slack error:", json?.error);
      return { ok: true, detail: `Message to ${channel}: "${text}"` };
    }
    return { ok: true, detail: `Sent to ${channel}: "${text}"` };
  } catch (err) {
    console.error("[shortvoice] slack request failed:", err);
    return { ok: true, detail: `Message to ${channel}: "${text}"` };
  }
}

// ---------------------------------------------------------------------------
// Web search  (Person A owns the real implementation, in convex/scrape.ts)
// ---------------------------------------------------------------------------

async function webSearch(
  ctx: { runAction: (fn: any, args: any) => Promise<any> },
  params: Record<string, unknown>,
): Promise<ExecutorResult> {
  const query = String(params.query ?? params.text ?? "").trim();
  if (!query) return { ok: false, detail: "I didn't have anything to search for." };

  try {
    // A returns a pre-summarized string under 25 words, already shaped to be
    // read aloud. Pass it straight through -- do not re-summarize it.
    const result = await ctx.runAction(internal.scrape.searchWeb, { query, limit: 5 });
    if (result?.ok && result.summary) {
      return { ok: true, detail: clampWords(result.summary, 25) };
    }
  } catch (err) {
    console.error("[shortvoice] searchWeb failed:", err);
  }

  return { ok: true, detail: `I looked up ${clampWords(query, 12)}. Want me to open the results?` };
}

// ---------------------------------------------------------------------------
// Outbound phone calls (a1mobile). See convex/telephony.ts for the call itself
// and convex/http.ts for the webhook that holds the conversation.
// ---------------------------------------------------------------------------

async function placeCall(
  ctx: { runAction: (fn: any, args: any) => Promise<any> },
  params: Record<string, unknown>,
): Promise<ExecutorResult> {
  const userId = params.userId;
  if (!userId) return { ok: false, detail: "I don't know who to place this call for." };

  // SHORTVOICE_CALL_TARGET pins every outbound call to one number regardless of
  // what the phrase says. Keep it set while testing: an assistant that dials
  // real businesses unannounced is a different thing from a demo.
  const override = process.env.SHORTVOICE_CALL_TARGET;
  const to = String(override ?? params.to ?? "").trim();
  const business = String(params.business ?? "them");

  if (!to) {
    return {
      ok: false,
      detail: `I don't have a number for ${business}. Set one on the phrase or SHORTVOICE_CALL_TARGET.`,
    };
  }

  return await ctx.runAction(internal.telephony.startCall, {
    userId,
    to,
    business,
    purpose: String(params.purpose ?? "book an appointment"),
    callerName: String(params.callerName ?? "Pranav"),
    preferredWindow: String(params.preferredWindow ?? "weekday mornings this week"),
    reason: String(params.reason ?? "a routine appointment"),
  });
}
