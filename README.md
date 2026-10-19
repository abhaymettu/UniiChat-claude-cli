UniiChat on a Claude subscription (claude-cli fork)
===================================================

**This fork runs UniiChat on a Claude subscription (Pro or Max) through
the official `claude` CLI, instead of metered API keys.** It adds one
model vendor, `claude-cli`: every model call UniiChat makes runs
`claude -p` under the login your CLI already has, so you need no
`ANTHROPIC_API_KEY`. Nothing else in UniiChat changes.

It is a fork of [UniiChat](https://github.com/VictorTaelin/UniiChat) by
Victor Taelin (Higher Order Company), Apache-2.0. All credit for UniiChat
itself goes there; the original README follows below, unchanged. This
fork is not affiliated with Higher Order Company or with Anthropic.

A general version of the same driver,
for any Anthropic API client, is a separate project:
[claude-cli-subscription-adapter](https://github.com/abhaymettu/claude-cli-subscription-adapter).

Run it on your subscription
---------------------------

You need [Bun](https://bun.sh) and the `claude` CLI, logged in (run
`claude` once and sign in).

    UNII_VENDORS=claude-cli \
    UNII_PICK=claude-cli:sonnet-5.5:medium:slow \
    UNII_COMPACTOR=claude-cli:haiku-5.5:high:slow \
    bun Server.ts                    # http://127.0.0.1:8788

Set `UNII_CLAUDE=/path/to/claude` if the CLI is not on `PATH`. The same
keys work in `~/.unii/config.json` (`vendors`, `pick`, `compactor`,
`claude`). You can also offer it next to the API vendors, e.g.
`UNII_VENDORS=claude-cli,claude-api`, and pick per chat.

How it works
------------

`ClaudeCli.ts` is a Wire, like `Anthropic.ts` and `OpenAI.ts`. For each
request it:

1. writes the system prompt to a temporary file and lists UniiChat's tools
   through `InertMcp.ts`, an MCP server that lists them and runs none;
2. starts `claude -p` in stream-json mode with its built-in tools,
   settings and session saving off, and retries off;
3. replays the earlier turns with `shouldQuery: false` and checks that the
   CLI acknowledges each one, then sends the last user turn;
4. passes the CLI's stream events (the API's own SSE events) to
   UniiChat's normal stream reader, and kills the process group at the
   first `message_stop`, so a request is one generation.

Tool calls come back to UniiChat's own agent loop, which runs them as it
always does. The fork never reads, copies or forwards the CLI's login
token, and it removes the `ANTHROPIC_*` overrides from the CLI's
environment so the CLI can only use its own login.

Limits
------

- **Your plan's limits, not dollars.** Every call, including the
  compactor's background summaries, counts against your subscription's
  session and weekly limits. A long chat compacts often.
- **Extra tokens and time.** The CLI adds its own context in front of
  UniiChat's system prompt, and every call pays a CLI process start
  (about 1.5 to 2.5 s for a small Haiku call in testing).
- **Not offered on `claude-cli`:** web search, Opus fast speed, token
  counting ahead of a call, and UniiChat's own cache marks (the CLI places
  its own cache breakpoints).
- **A limit error is not retried.** It ends the call as an error; only
  "overloaded" is retried.
- **CLI-version sensitive.** The history replay and stream lines belong
  to the CLI, not a published API. They were checked on Claude Code
  2.1.303. If a later CLI changes them, calls fail with "history replay
  not supported" rather than sending a different prompt.
- **Tool schemas go through MCP.** Top-level `oneOf`/`anyOf` in a tool
  schema is not stripped yet.
- **The CLI puts your account email in the model's context.** The
  `claude` CLI (checked on 2.1.303) adds the logged-in account's email
  address to every request as a system note, and has no switch to turn
  that off. The model can see it and may repeat it, and UniiChat's
  summaries can store it: in testing, a compaction summary did. Treat
  chats, summaries and `~/.unii` as personal data and do not share them.
- **Tested:** offline tests (`ClaudeCli.test.ts`, with a fake CLI) and
  one real browser session on `claude-cli`: chat turns, a tool call and
  background compaction all worked.

**Terms.** Check Anthropic's current terms for your plan before using
this. The page the author read is
[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan),
whose October 7, 2026 update says the Agent SDK, `claude -p` and
third-party apps can still use subscription limits. That is not a
guarantee or legal advice. Keep the server for your own use: do not let
other people's chats run on your subscription.

Roadmap
-------

- Strip top-level `oneOf`/`anyOf` from tool schemas before they reach
  the CLI's MCP layer.

Changes from upstream
---------------------

Per section 4 of the Apache License 2.0, the files this fork changed or
added say so in their header:

- added: `ClaudeCli.ts`, `InertMcp.ts`, `ClaudeCli.test.ts`;
- changed: `Agent.ts` (an optional `Wire.post` transport and the
  `claude-cli` branch), `AskAI.ts` and `Pick.ts` (the `claude-cli`
  vendor and its models), and this README (this section);
- rebuilt: `web/app.js`, the prebuilt web client, regenerated from the
  unchanged `web/src` with `bun run web` so it knows the new models (a
  generated file, so it carries no header).

Upstream history is kept as is; the fork's changes are the commits after
it.

---

UniiChat
========

[▶ Watch the announcement video](https://x.com/VictorTaelin/status/2108200878553588091)

**This repo is vibe-coded.** AI agents wrote nearly all of it, and AI
agents reviewed it. Read it, run it and fork it as such: expect bugs.

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers. The hosted version is at https://uniichat.com. This is its
source, to run your own server on your own API keys.

How it works
------------

- **One chat, a memory tree.** Every message is summarized into one line,
  and neighboring lines are merged in pairs, again and again, into a
  binary tree. Each call sees a view of the whole chat, up to 128 KB:
  recent messages one line each, older ones covered by fewer, broader
  lines. Detail fades with age, but nothing is lost.
- **Zoom.** The agent can open any line into the two it was made from,
  down to the original message. So its context never rots, and it never
  needs a "compaction" that throws the past away.
- **Built in the background.** Summaries are written by a cheaper model
  (the compactor) as messages arrive. The view changes only at its end,
  so each call reads most of its input from the vendor's prompt cache.
- **Every window is a view.** The server owns the chat. A browser tab, or
  `unii` in a terminal, shows it live; any of them can send a message,
  stop the work, or change the model.
- **Agents and tools.** The agent runs a shell, reads and edits files,
  and can drive a Mac's screen, on any computer where `unii` is open
  (each is a device it can name). It can spawn subagents, which work in
  the background and report back as messages.
- **Import.** Bring your past Claude and ChatGPT chats (Claude Code and
  Codex folders, or the websites' exports); they join the tree.

The design is in the header comment of each file. Start with Memory.ts
(the tree and the view), Server.ts (the chat, turns, workers) and
AskAI.ts (model calls and the cache).

Run it
------

You need [Bun](https://bun.sh) and an Anthropic API key (or an OpenAI
one, below).

    export ANTHROPIC_API_KEY=sk-ant-...
    bun Server.ts                    # http://127.0.0.1:8788, data in ~/.unii

Then open http://127.0.0.1:8788 and type your email. With no mail key
set, the server prints the sign-in link in its output: open it. Or chat
from a terminal:

    bun Term.ts http://127.0.0.1:8788

It asks for your email, the server prints a link, and the page it opens
asks for the code the terminal shows. `bun Term.ts help` lists the rest.

Other commands:

    bun run test                     # the tests, each file on its own
    bun run web                      # rebuilds web/app.js from web/src
    bun build --compile Term.ts --outfile unii
                                     # one `unii` executable; `unii serve`
                                     # runs the server it carries

Your chats live in ~/.unii/users/<id>, one JSON line per message
(main/) and per summary (tree/). They are the memory: back them up.

Config
------

`~/.unii/config.json` (optional; the dir is `$UNII_DIR`). Each key may
also be set as the variable `UNII_<KEY>`:

- `site`: the server's origin, for sign-in links (default
  http://127.0.0.1:8788). Another port: `UNII_SITE=http://127.0.0.1:9000
  bun Server.ts 9000`.
- `vendors`: what the server offers, comma-separated: `claude-api`
  (default), `openai-api`.
- `models`: the models offered, by label (Pick.ts; default all).
- `pick`: what a chat runs on until it picks another,
  `vendor:model:effort:speed` (default `claude-api:sonnet-5.5:medium:slow`).
- `compactor`: what writes the summaries (default
  `claude-api:haiku-5.5:high:slow`).
- `agents`: what subagents run on (default: the chat's pick).
- `work`: the agents' working dirs on each device (default
  ~/.unii/work).
- `rules`: a file appended to every system prompt.
- `after`: a shell command run after each turn.
- `workers`: how many processes serve the users (default none: one
  process). With a number, `Server.ts` only routes, behind a proxy that
  honors its `x-unii-worker` header (Server.ts explains).
- `apple`, `apns`: the iOS app's App ID and push key id (ios/).

Keys are read from the environment: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `RESEND_API_KEY` (to email sign-in links; none: they
print), `APNS_KEY`.

With only an OpenAI key, set `vendors`, `pick` and `compactor` to
`openai-api` models, e.g. `UNII_VENDORS=openai-api
UNII_PICK=openai-api:gpt-6.1-sol:medium:slow
UNII_COMPACTOR=openai-api:gpt-6-luna:high:slow`.

A self-hosted server is free: it bills no one, shows no prices, and calls
only the model vendors. Billing.ts is the one place a hosted server
plugs in its billing (uniichat.com sells credits; this repo has none).

The `unii` terminal
-------------------

`web/install.sh` (served at /install.sh) runs the official installer,
which installs the released `unii` executable. `unii` alone opens
uniichat.com; `unii <url>` opens any server. Run with
`UNII_COMPUTER=1` on a Mac, the agent may use its screen (it compiles
Computer.swift with swiftc; macOS asks for Screen Recording and
Accessibility).

Telemetry: once a day the `unii` terminal asks bend-lang.com's /check
for the latest version (Term.ts update_check), sending its version, OS
and CPU type, no account and no id; it also says whether this computer
has ever self-hosted (set for good the first time it runs `unii serve`
or opens a server other than uniichat.com). It is the one call a
self-hosted UniiChat makes to us. `UNII_NO_TELEMETRY=1` turns it off.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company.
