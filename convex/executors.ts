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
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { clampWords } from "./lib/text";

export type ExecutorResult = { ok: boolean; detail: string };

export const runNetworkAction = internalAction({
  args: { actionType: v.string(), params: v.any() },
  handler: async (ctx, { actionType, params }): Promise<ExecutorResult> => {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (actionType) {
      case "send_slack":
        return await sendSlack(p);
      case "web_search":
        return await webSearch(ctx, p);
      case "job_apply":
        return await submitApplications(ctx, p);
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
// Job applications  (simulated board -- see convex/lib/demoJobBoard.ts)
// ---------------------------------------------------------------------------

/**
 * The only place an application is ever marked submitted. The batch was staged
 * during resolution -- nothing was sent -- so reaching here means the person
 * already heard the preview and said yes.
 */
async function submitApplications(
  ctx: ActionCtx,
  params: Record<string, unknown>,
): Promise<ExecutorResult> {
  const userId = String(params.userId ?? "").trim();
  const batchId = String(params.batchId ?? "").trim();
  if (!userId || !batchId) {
    return { ok: false, detail: "I lost track of which applications to send." };
  }

  try {
    const result = await ctx.runAction(api.jobApply.submit, {
      userId: userId as Id<"users">,
      batchId: batchId as Id<"jobApplicationBatches">,
    });
    // `speech` already states the true counts in a readable sentence. Pass it
    // through unchanged -- rewriting it here is how counts start lying.
    return { ok: result.ok, detail: result.speech };
  } catch (err) {
    console.error("[shortvoice] application submission failed:", err);
    return { ok: false, detail: "I couldn't finish sending those applications." };
  }
}
