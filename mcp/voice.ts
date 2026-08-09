import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function playDeepgram(text: string): Promise<void> {
  const configuredUrl = process.env.CONVEX_SITE_URL;
  if (!configuredUrl) {
    throw new Error("CONVEX_SITE_URL is required for Deepgram playback");
  }
  const siteUrl = new URL(configuredUrl);
  if (
    siteUrl.protocol !== "https:" ||
    !siteUrl.hostname.endsWith(".convex.site") ||
    siteUrl.username ||
    siteUrl.password ||
    (siteUrl.pathname !== "/" && siteUrl.pathname !== "") ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new Error("CONVEX_SITE_URL must be an HTTPS .convex.site origin");
  }

  const response = await fetch(new URL("/tts", siteUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: "aura-2-thalia-en" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Deepgram proxy returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("audio/")) {
    throw new Error("Deepgram proxy returned a non-audio response");
  }
  const maximumAudioBytes = 5 * 1024 * 1024;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumAudioBytes) {
    throw new Error("Deepgram proxy returned oversized audio");
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("Deepgram proxy returned empty audio");
  }
  if (audio.length > maximumAudioBytes) {
    throw new Error("Deepgram proxy returned oversized audio");
  }

  const directory = await mkdtemp(join(tmpdir(), "shortvoice-tts-"));
  const file = join(directory, "speech.mp3");
  try {
    await writeFile(file, audio);
    await execFile("afplay", [file], { timeout: 12_000, windowsHide: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function playMacVoice(text: string): Promise<void> {
  await execFile("say", ["--", text], {
    timeout: 12_000,
    windowsHide: true,
  });
}

/**
 * Speech is deliberately best-effort. A TTS outage must never block or undo an
 * already-confirmed action.
 */
export async function speak(text: string): Promise<void> {
  if (!text.trim()) {
    return;
  }
  if (process.platform !== "darwin") {
    console.error("ShortVoice TTS skipped: playback requires the demo Mac");
    return;
  }

  try {
    await playDeepgram(text);
  } catch (deepgramError) {
    console.error("Deepgram TTS failed; falling back to macOS say", deepgramError);
    try {
      await playMacVoice(text);
    } catch (fallbackError) {
      console.error("macOS say fallback failed", fallbackError);
    }
  }
}
