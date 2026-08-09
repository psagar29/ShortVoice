import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ShortVoiceBackend } from "../mcp/backend.js";
import { executeLocalAction } from "../mcp/localActions.js";
import { createServer } from "../mcp/server.js";

const expectedTools = [
  "shortvoice_say",
  "shortvoice_confirm",
  "shortvoice_cancel",
  "shortvoice_teach",
  "shortvoice_list_phrases",
  "shortvoice_check_suggestion",
  "shortvoice_accept_suggestion",
  "shortvoice_forget",
].sort();
const expectedArgs: Record<string, string[]> = {
  shortvoice_say: ["utterance"],
  shortvoice_confirm: [],
  shortvoice_cancel: [],
  shortvoice_teach: ["meaning", "trigger"],
  shortvoice_list_phrases: [],
  shortvoice_check_suggestion: [],
  shortvoice_accept_suggestion: ["trigger"],
  shortvoice_forget: ["trigger"],
};

test("exposes exactly the frozen eight-tool contract", async () => {
  const backend = {
    say: async (utterance: string) => {
      if (utterance === "explode") {
        throw new Error("private backend detail");
      }
      return {
        speech: `Resolved: ${utterance}`,
        result: {
          kind: "unknown" as const,
          speech: `Resolved: ${utterance}`,
        },
      };
    },
    confirm: async () => ({ ok: true, speech: "Sent." }),
    acceptPendingSuggestion: async () => undefined,
    cancel: async () => "Cancelled.",
    teach: async (trigger: string) => `Learned ${trigger}.`,
    listPhrases: async () => "Vocabulary.",
    checkSuggestion: async () => "Suggestion.",
    acceptSuggestion: async (trigger: string) => `Accepted ${trigger}.`,
    forget: async (trigger: string) => `Forgot ${trigger}.`,
  } as unknown as ShortVoiceBackend;
  await assert.rejects(
    () =>
      executeLocalAction(
        { actionType: "send_slack", params: {}, futureField: true },
        backend,
      ),
    /Invalid enum value/,
  );
  const spoken: string[] = [];
  const server = createServer(backend, async (text) => {
    spoken.push(text);
    if (text === "Cancelled.") {
      throw new Error("simulated TTS failure");
    }
  });
  const client = new Client({ name: "shortvoice-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      expectedTools,
    );
    for (const tool of listed.tools) {
      const schema = tool.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      assert.deepEqual(
        Object.keys(schema.properties ?? {}).sort(),
        expectedArgs[tool.name],
      );
      assert.deepEqual([...(schema.required ?? [])].sort(), expectedArgs[tool.name]);
    }

    const calls = [
      ["shortvoice_say", { utterance: "school mom" }, "Resolved: school mom"],
      ["shortvoice_confirm", {}, "Sent."],
      ["shortvoice_cancel", {}, "Cancelled."],
      [
        "shortvoice_teach",
        { trigger: "school mom", meaning: "text Mom" },
        "Learned school mom.",
      ],
      ["shortvoice_list_phrases", {}, "Vocabulary."],
      ["shortvoice_check_suggestion", {}, "Suggestion."],
      [
        "shortvoice_accept_suggestion",
        { trigger: "standup" },
        "Accepted standup.",
      ],
      ["shortvoice_forget", { trigger: "school mom" }, "Forgot school mom."],
    ] as const;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      for (const [name, args, expectedText] of calls) {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, `${name} returned an MCP error`);
        assert.ok("content" in result && Array.isArray(result.content));
        assert.equal(result.content[0]?.type, "text");
        assert.equal(result.content[0]?.text, expectedText);
      }

      const failed = await client.callTool({
        name: "shortvoice_say",
        arguments: { utterance: "explode" },
      });
      assert.equal(failed.isError, true);
      assert.ok("content" in failed && Array.isArray(failed.content));
      assert.doesNotMatch(failed.content[0]?.text ?? "", /private backend detail/);
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(spoken.length, expectedTools.length);

    const invalid = await client.callTool({
      name: "shortvoice_say",
      arguments: { utterance: "" },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
