import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ShortVoiceBackend } from "../mcp/backend.js";
import { executeLocalAction } from "../mcp/localActions.js";

function print(line = ""): void {
  stdout.write(`${line}\n`);
}

function parseTeach(
  input: string,
): { trigger: string; meaning: string } | undefined {
  const match =
    input.match(/^teach\s+"([^"]+)"\s*=\s*(.+)$/i) ??
    input.match(/^teach\s+(.+?)\s*=\s*(.+)$/i);
  if (!match) {
    return undefined;
  }
  return { trigger: match[1].trim(), meaning: match[2].trim() };
}

function parseTriggerCommand(input: string, command: string): string | undefined {
  const match = input.match(new RegExp(`^${command}\\s+"?(.+?)"?$`, "i"));
  return match?.[1].trim();
}

const confirms = new Set(["yes", "yeah", "yep", "do it", "send it", "go ahead"]);
const cancels = new Set(["no", "cancel", "never mind", "stop"]);

async function main(): Promise<void> {
  const backend = await ShortVoiceBackend.connect();
  const repl = createInterface({ input: stdin, output: stdout });
  print(
    "ShortVoice harness. Commands: :phrases, :feed, :suggestion, :accept <trigger>, :forget <trigger>, :quit",
  );
  repl.setPrompt("shortvoice> ");
  let exiting = false;
  if (stdin.isTTY) {
    repl.prompt();
  }

  try {
    for await (const line of repl) {
      try {
        const input = line.trim();
        if (!input) {
          continue;
        }
        const normalized = input.toLowerCase();
        if (normalized === ":quit" || normalized === ":exit") {
          exiting = true;
          break;
        }

        if (normalized === ":phrases") {
          const phrases = await backend.phrases();
          if (phrases.length === 0) {
            print("  → vocabulary is empty");
          }
          for (const phrase of phrases) {
            print(
              `  → "${phrase.trigger}" = ${phrase.intentTemplate} [${phrase.actionType}]`,
            );
          }
          continue;
        }

        if (normalized === ":feed") {
          const events = await backend.feed();
          if (events.length === 0) {
            print("  → event feed is empty");
          }
          for (const event of events) {
            const latency =
              event.latencyMs === undefined ? "" : ` (${event.latencyMs}ms)`;
            print(`  → ${event.kind}${latency}: ${event.text}`);
          }
          continue;
        }

        if (normalized === ":suggestion") {
          print(`  → ${await backend.checkSuggestion()}`);
          continue;
        }

        const teaching = parseTeach(input);
        if (teaching) {
          print(`  → ${await backend.teach(teaching.trigger, teaching.meaning)}`);
          continue;
        }

        const acceptedTrigger = parseTriggerCommand(input, ":accept");
        if (acceptedTrigger) {
          print(`  → ${await backend.acceptSuggestion(acceptedTrigger)}`);
          continue;
        }

        const forgottenTrigger = parseTriggerCommand(input, ":forget");
        if (forgottenTrigger) {
          print(`  → ${await backend.forget(forgottenTrigger)}`);
          continue;
        }

        if (confirms.has(normalized)) {
          const result = await backend.confirm();
          if (!result.ok) {
            print(`  → ${result.speech}`);
            continue;
          }
          if (result.localAction) {
            if (process.platform === "darwin") {
              print(`  → ${await executeLocalAction(result.localAction, backend)}`);
            } else {
              print(
                `  → local action ready for demo Mac: ${result.localAction.actionType}`,
              );
            }
          } else {
            print(`  → ${result.speech}`);
          }
          continue;
        }

        if (cancels.has(normalized)) {
          print(`  → ${await backend.cancel()}`);
          continue;
        }

        const { result, speech } = await backend.say(input);
        if (result.kind === "confirm") {
          const confidence =
            result.matchScore === undefined
              ? ""
              : ` (${result.matchScore.toFixed(2)})`;
          print(`  → resolved${confidence}: ${result.resolvedIntent}`);
        } else {
          print(`  → ${result.kind}`);
        }
        print(`  🔊 "${speech}"`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        print(`  ✗ ${message}`);
      } finally {
        if (!exiting && stdin.isTTY) {
          repl.prompt();
        }
      }
    }
  } finally {
    repl.close();
  }
}

main().catch((error) => {
  console.error("ShortVoice harness failed to start", error);
  process.exitCode = 1;
});
