// Prove the keyterm claim instead of asserting it.
//
// Makes the exact connection the browser listener makes -- same subprotocol
// auth, same nova-3 params, same live vocabulary from /keyterms -- and streams
// speech synthesised by our own /tts route so the transcript is meaningful.
//
//   node web/scripts/keyterm-compare.mjs "neel later" on
//   node web/scripts/keyterm-compare.mjs "neel later" off
//
// Requires nothing installed: Node 18+ has fetch, Node 22+ has WebSocket.

const SITE = process.env.CONVEX_SITE_URL ?? "https://reminiscent-anteater-318.convex.site";
const PHRASE = process.argv[2] ?? "school mom";
const useKeyterms = process.argv[3] !== "off";

const { keyterms } = await (await fetch(`${SITE}/keyterms`)).json();
const { token, mode } = await (await fetch(`${SITE}/listen-token`, { method: "POST" })).json();

// Real speech to feed the recogniser: Deepgram's own TTS, via D's /tts route.
const ttsRes = await fetch(`${SITE}/tts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: PHRASE }),
});
const audio = Buffer.from(await ttsRes.arrayBuffer());

const params = new URLSearchParams({
  model: "nova-3",
  smart_format: "true",
  interim_results: "true",
  punctuate: "true",
  endpointing: "400",
});
if (useKeyterms) for (const term of keyterms) params.append("keyterm", term);

console.log(`mode=${mode} keyterms=${useKeyterms ? keyterms.length : 0} audio=${audio.length}B`);

const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, [
  mode === "raw" ? "token" : "bearer",
  token,
]);

let final = "";
const done = new Promise((resolve) => {
  ws.onopen = () => {
    console.log("socket OPEN — auth and keyterms accepted");
    // Feed it in chunks, like MediaRecorder does.
    for (let i = 0; i < audio.length; i += 4000) {
      ws.send(audio.subarray(i, i + 4000));
    }
    setTimeout(() => ws.send(JSON.stringify({ type: "CloseStream" })), 300);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "Results") {
      const t = m.channel?.alternatives?.[0]?.transcript ?? "";
      if (t && m.is_final) final += ` ${t}`;
    }
    if (m.type === "Metadata") resolve();
  };
  ws.onerror = () => { console.log("socket ERROR"); resolve(); };
  ws.onclose = (e) => { if (e.code !== 1000) console.log(`closed ${e.code} ${e.reason}`); resolve(); };
});

await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
console.log(`spoken:      "${PHRASE}"`);
console.log(`transcribed: "${final.trim()}"`);
ws.close();
process.exit(0);
