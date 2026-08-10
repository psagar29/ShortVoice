import type { Infer } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { actionType } from "./schema";
import { normalizeTrigger } from "./lib/normalize";

type ActionType = Infer<typeof actionType>;

/**
 * Where every appointment call actually goes.
 *
 * A teammate's phone, on purpose. ShortVoice dials a real number and holds a
 * real conversation, so the destination has to be someone who agreed to pick
 * up. `SHORTVOICE_CALL_TARGET` in the Convex environment still overrides this
 * if it is set; point that at a real business only deliberately.
 */
const DEMO_CALL_NUMBER = "+19168969399";

const CONTACTS: Array<{ alias: string; fullName: string; slackId?: string }> = [
  { alias: "mom", fullName: "Rashmi" },
  { alias: "laksh", fullName: "Laksh Patel" },
  { alias: "neel", fullName: "Neel Shah" },
  { alias: "sarah", fullName: "Sarah Whitfield" },
  { alias: "team", fullName: "Project Team", slackId: "#project-team" },
];

const PHRASES: Array<{
  trigger: string;
  intentTemplate: string;
  actionType: ActionType;
  params: unknown;
  slots: string[];
}> = [
  // ---- LOOKUP FAMILY -------------------------------------------------------
  // The workhorses. Each is one short word plus whatever the user trails after
  // it, and the trailing words land in a slot. "find keyboard", "find a
  // standing desk", "find flights to tokyo" are all the same taught phrase
  // with a different filler, which is precisely what a macro cannot do.
  {
    trigger: "find",
    intentTemplate: "Search the web for {thing} and show me the best options",
    actionType: "web_search",
    params: { query: "{thing}" },
    slots: ["thing"],
  },
  {
    trigger: "search",
    intentTemplate: "Search the web for {thing}",
    actionType: "web_search",
    params: { query: "{thing}" },
    slots: ["thing"],
  },
  {
    trigger: "look up",
    intentTemplate: "Look up {thing} and summarise what you find",
    actionType: "web_search",
    params: { query: "{thing}" },
    slots: ["thing"],
  },
  {
    trigger: "price",
    intentTemplate: "Find the current price of {thing}",
    actionType: "web_search",
    params: { query: "current price of {thing}" },
    slots: ["thing"],
  },
  {
    trigger: "buy",
    intentTemplate: "Find where to buy {thing} and compare the options",
    actionType: "web_search",
    params: { query: "where to buy {thing}" },
    slots: ["thing"],
  },
  {
    trigger: "docs",
    intentTemplate: "Find the official documentation for {thing}",
    actionType: "web_search",
    params: { query: "{thing} official documentation" },
    slots: ["thing"],
  },
  // No bare "flight" trigger on purpose. "flights" appears inside ordinary
  // lookup phrasing ("find cheap flights"), so it collided with "find" and
  // pushed a perfectly clear utterance into the clarify path. "find flights
  // to tokyo" already resolves through "find".
  {
    trigger: "mom flight friday",
    intentTemplate: "Find afternoon flights from SFO for Mom this {day}",
    actionType: "web_search",
    params: { query: "afternoon flights from SFO this Friday", contact: "mom" },
    slots: ["day"],
  },
  {
    trigger: "near me",
    intentTemplate: "Find {thing} near me in San Francisco",
    actionType: "web_search",
    params: { query: "{thing} near San Francisco" },
    slots: ["thing"],
  },

  // ---- PHONE CALLS ---------------------------------------------------------
  // Three words become a real outbound call. ShortVoice dials, introduces
  // itself as an assistant calling on someone's behalf, negotiates a time
  // inside the stated availability, and reports back.
  //
  // All four dial DEMO_CALL_NUMBER, a teammate who agreed to pick up.
  // SHORTVOICE_CALL_TARGET still overrides it if set.
  {
    trigger: "appointment dentist",
    intentTemplate: "Call the dentist to book a check-up appointment {when}",
    actionType: "place_call",
    params: {
      business: "the dentist",
      to: DEMO_CALL_NUMBER,
      purpose: "book a dental check-up",
      reason: "a routine check-up and cleaning",
      preferredWindow: "weekday mornings this week",
      callerName: "Pranav",
    },
    slots: ["when"],
  },
  {
    trigger: "appointment doctor",
    intentTemplate: "Call the doctor's office to book an appointment {when}",
    actionType: "place_call",
    params: {
      business: "the doctor's office",
      to: DEMO_CALL_NUMBER,
      purpose: "book a GP appointment",
      reason: "a routine consultation",
      preferredWindow: "any weekday afternoon",
      callerName: "Pranav",
    },
    slots: ["when"],
  },
  {
    trigger: "book table",
    intentTemplate: "Call the restaurant to book a table {when}",
    actionType: "place_call",
    params: {
      business: "the restaurant",
      to: DEMO_CALL_NUMBER,
      purpose: "book a table for two",
      reason: "dinner for two",
      preferredWindow: "around seven in the evening",
      callerName: "Pranav",
    },
    slots: ["when"],
  },
  {
    trigger: "call back",
    intentTemplate: "Call them back about {topic}",
    actionType: "place_call",
    params: {
      business: "them",
      to: DEMO_CALL_NUMBER,
      purpose: "follow up",
      reason: "following up on an earlier conversation",
      preferredWindow: "any time today",
      callerName: "Pranav",
    },
    slots: ["topic"],
  },

  // ---- MESSAGING -----------------------------------------------------------
  {
    trigger: "team pr tonight",
    intentTemplate: "Tell the project team I'll review the latest PR tonight",
    actionType: "send_slack",
    params: { channel: "#project-team", text: "I'll review the latest PR tonight" },
    slots: [],
  },
  {
    trigger: "neel later",
    intentTemplate: "Tell Neel I'll handle this {when}",
    actionType: "send_slack",
    params: { contact: "neel", text: "I'll handle this {when}" },
    slots: ["when"],
  },
  {
    trigger: "sarah late",
    intentTemplate: "Text Sarah that I'm running {when} late",
    actionType: "send_message",
    params: { contact: "sarah", body: "Running {when} late, sorry" },
    slots: ["when"],
  },
  {
    trigger: "laksh agree",
    intentTemplate: "Tell Laksh I agree overall but want to discuss {topic} first",
    actionType: "send_slack",
    params: { contact: "laksh", text: "I agree overall, but let's discuss {topic} before we commit" },
    slots: ["topic"],
  },
  {
    trigger: "team ship",
    intentTemplate: "Tell the project team we're shipping {when}",
    actionType: "send_slack",
    params: { channel: "#project-team", text: "We're shipping {when}" },
    slots: ["when"],
  },

  // ---- SCREEN AND ACCESSIBILITY -------------------------------------------
  // "red" is deliberately not a literal word for its meaning. It is a short,
  // reliable sound that this user can produce, mapped to the thing they need
  // most. That mapping is the entire accessibility argument.
  {
    trigger: "red",
    intentTemplate: "Stop and read the current screen aloud",
    actionType: "read_screen",
    params: {},
    slots: [],
  },
  {
    trigger: "where",
    intentTemplate: "Describe what's currently on my screen",
    actionType: "read_screen",
    params: {},
    slots: [],
  },

  // ---- FOCUS AND SYSTEM ----------------------------------------------------
  // Two triggers, one intent. A person keeps the word that comes out easiest.
  // These carry no {minutes} slot. An unfilled slot renders as empty string,
  // so slotting the duration produced "start a  minute timer" whenever the
  // user just said "focus". The number lives in the template instead.
  {
    trigger: "focus",
    intentTemplate: "Do not disturb, close distractions, start a 25 minute timer",
    actionType: "focus_mode",
    params: { minutes: 25 },
    slots: [],
  },
  {
    trigger: "heads down",
    intentTemplate: "Turn on focus mode for 30 minutes",
    actionType: "focus_mode",
    params: { minutes: 30 },
    slots: [],
  },
  {
    trigger: "quiet",
    intentTemplate: "Turn on Do Not Disturb",
    actionType: "focus_mode",
    params: { minutes: 60, dndOnly: true },
    slots: [],
  },

  // ---- APPS ----------------------------------------------------------------
  {
    trigger: "code",
    intentTemplate: "Open my editor",
    actionType: "open_app",
    params: { app: "Visual Studio Code" },
    slots: [],
  },
  {
    trigger: "browser",
    intentTemplate: "Open the browser",
    actionType: "open_app",
    params: { app: "Google Chrome" },
    slots: [],
  },
  {
    trigger: "music",
    intentTemplate: "Open Spotify",
    actionType: "open_app",
    params: { app: "Spotify" },
    slots: [],
  },

  // ---- CALENDAR ------------------------------------------------------------
  {
    trigger: "sarah thirty",
    intentTemplate: "Schedule 30 minutes with Sarah {when}",
    actionType: "create_event",
    params: { contact: "sarah", minutes: 30, when: "{when}" },
    slots: ["when"],
  },
];

// Near-duplicate utterances for the same unstaught intent, so Person B's
// auto-suggest can fire on "standup" the first time it's taught live.
const STANDUP_UTTERANCES = [
  "give the team my standup update",
  "post my standup to the team",
  "send my daily standup notes to the team",
];

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", "demo"))
      .first();

    if (existingUser) {
      const userId = existingUser._id;

      for (const row of await ctx.db
        .query("phrases")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("pendingActions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("utterances")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("events")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("contacts")
        .withIndex("by_user_alias", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      for (const row of await ctx.db
        .query("suggestions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .collect())
        await ctx.db.delete(row._id);

      await ctx.db.delete(userId);
    }

    const userId = await ctx.db.insert("users", {
      handle: "demo",
      name: "Pranav",
      voiceModel: "aura-2-thalia-en",
      createdAt: Date.now(),
    });

    for (const contact of CONTACTS) {
      await ctx.db.insert("contacts", { userId, ...contact });
    }

    for (const phrase of PHRASES) {
      // embedding: [] -- mutations can't call the OpenAI embeddings API.
      // Person B's reseedEmbeddings action backfills these after seeding.
      await ctx.runMutation(internal.phrases.insertPhrase, {
        userId,
        trigger: phrase.trigger,
        normalizedTrigger: normalizeTrigger(phrase.trigger),
        embedding: [],
        intentTemplate: phrase.intentTemplate,
        actionType: phrase.actionType,
        params: phrase.params,
        slots: phrase.slots,
        source: "seeded",
      });
    }

    const now = Date.now();
    for (let i = 0; i < STANDUP_UTTERANCES.length; i++) {
      await ctx.db.insert("utterances", {
        userId,
        raw: STANDUP_UTTERANCES[i],
        outcome: "unresolved",
        createdAt: now - (STANDUP_UTTERANCES.length - i) * 5 * 60 * 1000,
      });
    }

    return { userId };
  },
});
