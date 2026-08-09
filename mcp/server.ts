import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ShortVoiceBackend } from "./backend.js";
import { executeLocalAction } from "./localActions.js";
import { speak } from "./voice.js";

async function toolResult(
  work: () => Promise<string>,
  speaker: (text: string) => Promise<void>,
) {
  let speech: string;
  try {
    speech = await work();
  } catch (error) {
    console.error("ShortVoice tool failed", error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "ShortVoice couldn't do that. Check the MCP server diagnostics.",
        },
      ],
    };
  }

  void speaker(speech).catch((error) => {
    console.error("ShortVoice speech failed after tool success", error);
  });
  return { content: [{ type: "text" as const, text: speech }] };
}

export function createServer(
  backend: ShortVoiceBackend,
  speaker: (text: string) => Promise<void> = speak,
): McpServer {
  const server = new McpServer({ name: "shortvoice", version: "0.1.0" });
  const respond = (work: () => Promise<string>) => toolResult(work, speaker);

  server.registerTool(
    "shortvoice_say",
    {
      description:
        "ALWAYS call this first when the user says something short, compressed, fragmentary, or ambiguous -- 1 to 4 words, names without verbs, or anything that sounds like personal shorthand. ShortVoice holds this user's personal vocabulary and knows what these fragments mean. Do not interpret short fragments yourself. Pass the exact words verbatim.",
      inputSchema: {
        utterance: z
          .string()
          .min(1)
          .max(2_000)
          .describe("Exactly what the user said, verbatim"),
      },
    },
    ({ utterance }) => respond(async () => (await backend.say(utterance)).speech),
  );

  server.registerTool(
    "shortvoice_confirm",
    {
      description:
        'Call this only when ShortVoice has just asked the user to confirm an action, including a bare "yes", "yeah", "yep", "do it", "send it", or "go ahead". If ShortVoice offered a new vocabulary word, call shortvoice_accept_suggestion instead. Do not execute the intended action any other way.',
      inputSchema: {},
    },
    () =>
      respond(async () => {
        const result = await backend.confirm();
        if (!result.ok) {
          return result.speech;
        }
        return result.localAction
          ? executeLocalAction(result.localAction, backend)
          : result.speech;
      }),
  );

  server.registerTool(
    "shortvoice_cancel",
    {
      description:
        'Call this when the user rejects or cancels ShortVoice\'s pending action, including "no", "cancel", "never mind", or "stop".',
      inputSchema: {},
    },
    () => respond(() => backend.cancel()),
  );

  server.registerTool(
    "shortvoice_teach",
    {
      description:
        'Call this whenever the user defines personal shorthand, such as "when I say X, it means Y" or "teach ShortVoice X equals Y". Preserve both phrases verbatim.',
      inputSchema: {
        trigger: z.string().min(1).max(200).describe("The short phrase being taught"),
        meaning: z.string().min(1).max(2_000).describe("The full meaning or action"),
      },
    },
    ({ trigger, meaning }) => respond(() => backend.teach(trigger, meaning)),
  );

  server.registerTool(
    "shortvoice_list_phrases",
    {
      description:
        "Call this when the user asks what ShortVoice knows, what phrases they taught, or to list their personal vocabulary.",
      inputSchema: {},
    },
    () => respond(() => backend.listPhrases()),
  );

  server.registerTool(
    "shortvoice_check_suggestion",
    {
      description:
        "Call this when the user asks whether ShortVoice has noticed a repeated request or has a new shorthand suggestion.",
      inputSchema: {},
    },
    () => respond(() => backend.checkSuggestion()),
  );

  server.registerTool(
    "shortvoice_accept_suggestion",
    {
      description:
        'Call this only when ShortVoice has just offered a new vocabulary word and the user accepts it, including a bare "yes". Supply the proposed trigger from context. Do not call shortvoice_confirm for a vocabulary suggestion.',
      inputSchema: {
        trigger: z.string().min(1).max(200).describe("The shorthand trigger to save"),
      },
    },
    ({ trigger }) => respond(() => backend.acceptSuggestion(trigger)),
  );

  server.registerTool(
    "shortvoice_forget",
    {
      description:
        'Call this when the user asks ShortVoice to forget, remove, or deactivate a taught phrase, such as "forget school mom".',
      inputSchema: {
        trigger: z.string().min(1).max(200).describe("The taught trigger to forget"),
      },
    },
    ({ trigger }) => respond(() => backend.forget(trigger)),
  );

  return server;
}

async function main(): Promise<void> {
  const backend = ShortVoiceBackend.connect();
  const server = createServer(backend);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`ShortVoice received ${signal}; shutting down`);
    try {
      await server.close();
    } catch (error) {
      console.error("ShortVoice shutdown failed", error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("ShortVoice MCP server failed to start", error);
    process.exitCode = 1;
  });
}
