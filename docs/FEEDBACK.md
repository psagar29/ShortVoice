# VoiceOS feedback from building ShortVoice

Written incrementally during the hackathon, timestamped as things happened.
ShortVoice is a custom MCP integration: eight tools over stdio, backed by Convex,
speaking through its own Deepgram voice. That shape exercised the custom-integration
surface hard, and this is what we hit.

## 1:30pm, integration pass

**stdio is a sharp edge for custom integrations.** VoiceOS launches the MCP server
over stdio, which means anything that writes to stdout corrupts the protocol. We had
to disable the Convex client's default logger (`new ConvexHttpClient(url, { logger:
false })`) because a single stray `console.log` from a dependency kills the session.
A note in the custom-integration docs, or having VoiceOS tolerate and surface non-JSON
lines on stdout instead of failing, would save every team an hour.

**One Mac, invisible integration.** Because the server rides stdio, it exists only on
the machine VoiceOS runs on. Three of five teammates could not run or test the
integration at all; we had to build a separate Convex-backed harness
(`scripts/harness.ts`) just to make the seam testable off the demo Mac. A remote or
socket transport option for MCP servers would change how teams parallelize.

**Tool-description steering is the whole routing story, and it is untestable in
isolation.** Our front-door tool description is deliberately aggressive ("ALWAYS call
this first when the user says something short, compressed, fragmentary..."), because
fragments like "team pr tonight" are precisely what an agent is tempted to interpret
itself. We built a minimal spike server (`mcp/spike.ts`) that logs whether the call
arrives. What we wished for: any way to see WHY VoiceOS did or did not route to a
tool, even a debug log of tool-choice reasoning. Right now the feedback loop is
"say it again and watch."

- Routing result with description steering: _fill in from spike run on demo Mac_
- Routing result with the `"short: ..."` prefix fallback: _fill in_
- Multi-step chaining (say -> confirm as two turns): _fill in_

**Who speaks the tool result?** Our tools return the confirmation sentence as their
text result and also speak it through our own TTS. It was not documented whether
VoiceOS reads tool results aloud itself; if it does, every custom voice integration
double-speaks by default. An explicit "this integration owns audio output" flag would
make personal-voice integrations first-class.

**No custom vocabulary hook into VoiceOS STT.** ShortVoice is a vocabulary product,
and the biggest recognition win we measured came from priming the recognizer with the
user's own terms (with Deepgram nova-3 keyterms: "neel later" transcribes as "Neel
later" with priming, "Neil Lader." without). We could only do that on our parallel
browser-listener path. If VoiceOS exposed a keyterm/vocabulary registration API to
integrations, taught words would be recognized by the same engine that routes them.
That is our single biggest ask.

## Setup friction, as it happened

- The eight-tool contract had to be frozen in a document before anyone could build,
  because there is no schema-level way to validate "the agent will use these tools
  the way we intend." A dry-run mode (feed a transcript, see the tool calls) would
  have replaced our whole spike.
- `.convex.cloud` vs `.convex.site` cost us the predicted twenty minutes anyway, in
  env files. Not a VoiceOS issue, but demo-day reality for any HTTP-backed tool.

_Append below as it happens. Entries beat recollections._
