import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { config } from "dotenv";
import type {
  ConfirmResult,
  Contact,
  FeedEvent,
  Phrase,
  ResolveResult,
  SpeechResult,
  Suggestion,
  UserId,
} from "./types.js";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

interface TeachResult extends SpeechResult {
  phraseId: string;
}

interface AcceptSuggestionResult {
  speech?: string;
  intentTemplate?: string;
}

const functions = {
  getOrCreateDemoUser: makeFunctionReference<"mutation", Record<string, never>, UserId>(
    "users:getOrCreateDemoUser",
  ),
  resolve: makeFunctionReference<
    "action",
    { userId: UserId; utterance: string },
    ResolveResult
  >("resolver:resolve"),
  executeConfirmed: makeFunctionReference<
    "action",
    { userId: UserId },
    ConfirmResult
  >("resolver:executeConfirmed"),
  cancelPending: makeFunctionReference<"action", { userId: UserId }, SpeechResult>(
    "resolver:cancelPending",
  ),
  teachPhrase: makeFunctionReference<
    "action",
    { userId: UserId; trigger: string; meaning: string },
    TeachResult
  >("teach:teachPhrase"),
  listPhrases: makeFunctionReference<"query", { userId: UserId }, Phrase[]>(
    "phrases:listPhrases",
  ),
  pendingSuggestion: makeFunctionReference<
    "query",
    { userId: UserId },
    Suggestion | null
  >("learning:pendingSuggestion"),
  acceptSuggestion: makeFunctionReference<
    "action",
    { userId: UserId; trigger: string },
    AcceptSuggestionResult
  >("learning:acceptSuggestion"),
  deactivate: makeFunctionReference<
    "mutation",
    { userId: UserId; normalizedTrigger: string },
    null
  >("phrases:deactivate"),
  resolveAlias: makeFunctionReference<
    "query",
    { userId: UserId; alias: string },
    Contact | null
  >("contacts:resolveAlias"),
  feed: makeFunctionReference<
    "query",
    { userId: UserId; limit: number },
    FeedEvent[]
  >("events:feed"),
};

export class ShortVoiceBackend {
  private userIdPromise?: Promise<UserId>;

  private constructor(readonly convex: ConvexHttpClient) {}

  static connect(): ShortVoiceBackend {
    const configuredUrl = process.env.CONVEX_URL;
    if (!configuredUrl) {
      throw new Error("CONVEX_URL is required");
    }
    const url = new URL(configuredUrl);
    // Loopback is allowed so the integration harness can target a local
    // `npx convex dev` backend; anything remote must be our .convex.cloud.
    const loopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (
      (loopback
        ? url.protocol !== "http:" && url.protocol !== "https:"
        : url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud")) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "CONVEX_URL must be an HTTPS .convex.cloud origin (or a local convex dev URL)",
      );
    }

    // Convex's default logger uses console.log, which would corrupt MCP stdio.
    const convex = new ConvexHttpClient(url.origin, { logger: false });
    return new ShortVoiceBackend(convex);
  }

  private getUserId(): Promise<UserId> {
    this.userIdPromise ??= this.convex
      .mutation(functions.getOrCreateDemoUser, {})
      .catch((error) => {
        this.userIdPromise = undefined;
        throw error;
      });
    return this.userIdPromise;
  }

  async say(utterance: string): Promise<{ speech: string; result: ResolveResult }> {
    const userId = await this.getUserId();
    const result = await this.convex.action(functions.resolve, {
      userId,
      utterance,
    });
    const speech =
      result.kind === "confirm" ? result.confirmationSpeech : result.speech;
    return { speech, result };
  }

  async confirm(): Promise<ConfirmResult> {
    return this.convex.action(functions.executeConfirmed, {
      userId: await this.getUserId(),
    });
  }

  async cancel(): Promise<string> {
    const userId = await this.getUserId();
    const result = await this.convex.action(functions.cancelPending, {
      userId,
    });
    return result.speech;
  }

  async teach(trigger: string, meaning: string): Promise<string> {
    const userId = await this.getUserId();
    const result = await this.convex.action(functions.teachPhrase, {
      userId,
      trigger,
      meaning,
    });
    return result.speech;
  }

  async phrases(): Promise<Phrase[]> {
    return this.convex.query(functions.listPhrases, {
      userId: await this.getUserId(),
    });
  }

  async listPhrases(): Promise<string> {
    const phrases = await this.phrases();
    if (phrases.length === 0) {
      return "Your ShortVoice vocabulary is empty.";
    }
    return `You have ${phrases.length} phrases: ${phrases
      .map((phrase) => `${phrase.trigger} means ${phrase.intentTemplate}`)
      .join("; ")}.`;
  }

  async checkSuggestion(): Promise<string> {
    const userId = await this.getUserId();
    const suggestion = await this.convex.query(functions.pendingSuggestion, {
      userId,
    });
    if (!suggestion) {
      return "There isn't a new ShortVoice suggestion right now.";
    }
    return `You've asked for that ${suggestion.evidenceCount} times. Want to use "${suggestion.proposedTrigger}" for "${suggestion.intentTemplate}"?`;
  }

  async acceptSuggestion(trigger: string): Promise<string> {
    const userId = await this.getUserId();
    const result = await this.convex.action(functions.acceptSuggestion, {
      userId,
      trigger,
    });
    return (
      result.speech ??
      `Done. "${trigger}" now means ${result.intentTemplate ?? "that action"}.`
    );
  }

  async forget(trigger: string): Promise<string> {
    const phrases = await this.phrases();
    const requested = trigger.trim().toLowerCase();
    const phrase = phrases.find(
      (candidate) =>
        candidate.trigger.trim().toLowerCase() === requested ||
        candidate.normalizedTrigger === requested,
    );
    if (!phrase) {
      return `I couldn't find "${trigger}" in your ShortVoice vocabulary.`;
    }
    const userId = await this.getUserId();
    await this.convex.mutation(functions.deactivate, {
      userId,
      normalizedTrigger: phrase.normalizedTrigger,
    });
    return `Forgot "${phrase.trigger}".`;
  }

  async resolveContact(alias: string): Promise<Contact | null> {
    return this.convex.query(functions.resolveAlias, {
      userId: await this.getUserId(),
      alias: alias.trim().toLowerCase(),
    });
  }

  async feed(limit = 20): Promise<FeedEvent[]> {
    return this.convex.query(functions.feed, {
      userId: await this.getUserId(),
      limit,
    });
  }
}
