import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "shortvoice-spike", version: "0.1.0" });

server.registerTool(
  "shortvoice_say",
  {
    description:
      "ALWAYS call this first when the user says something short, compressed, fragmentary, or ambiguous -- 1 to 4 words, names without verbs, or anything that sounds like personal shorthand. ShortVoice holds this user's personal vocabulary and knows what these fragments mean. Do not try to interpret short fragments yourself.",
    inputSchema: {
      utterance: z
        .string()
        .min(1)
        .max(200)
        .describe("Exactly what the user said, verbatim"),
    },
  },
  async ({ utterance }) => {
    console.error(`[spike] shortvoice_say <- ${utterance}`);
    return {
      content: [{ type: "text", text: `ShortVoice heard: ${utterance}` }],
    };
  },
);

process.once("SIGINT", () => {
  void server.close().finally(() => process.exit(0));
});

try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error("ShortVoice routing spike failed", error);
  process.exitCode = 1;
}
