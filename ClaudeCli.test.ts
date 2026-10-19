// ClaudeCli test
// ==============
// `bun test ClaudeCli.test.ts`. The claude-cli wire against a fake claude
// CLI that speaks stream-json: a turn's reply streams through the real
// Agent loop with no API key; a history replays its earlier user frames
// unqueried, each acknowledged, tool names prefixed out and back; the
// process group dies at the first message_stop, so a second generation
// never streams; a CLI error refuses the request without a retry; the
// API overrides never reach the CLI.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-cli-test-");
const FAKE = DIR + "/claude";
const LOG = DIR + "/log.jsonl";

process.env.UNII_DIR = DIR;
process.env.UNII_CLAUDE = FAKE;
process.env.FAKE_LOG = LOG;
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";

fs.writeFileSync(FAKE, `#!${process.execPath}
import * as fs from "node:fs";
import * as readline from "node:readline";
const log = (row) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(row) + "\\n");
const out = (row) => process.stdout.write(JSON.stringify(row) + "\\n");
log({ args: process.argv.slice(2), base: process.env.ANTHROPIC_BASE_URL ?? null, user: process.env.USER ?? null, retries: process.env.CLAUDE_CODE_MAX_RETRIES });
const mode = process.env.FAKE_MODE ?? "text";
const ev = (event) => out({ type: "stream_event", event });
const turn = (n) => {
  ev({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } });
  if (mode === "tool") {
    ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_" + n, name: "mcp__unii__zoom", input: {} } });
    ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"id":"7"}' } });
  } else {
    ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello " + n } });
  }
  ev({ type: "content_block_stop", index: 0 });
  ev({ type: "message_delta", delta: { stop_reason: mode === "tool" ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } });
  ev({ type: "message_stop" });
};
out({ type: "system", subtype: "init" });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  log({ frame });
  if (frame.shouldQuery === false) {
    out({ type: "result", subtype: "success", num_turns: mode === "noreplay" ? 1 : 0, is_error: false });
  }
}
if (mode === "error") {
  out({ type: "assistant", error: "rate_limit", message: { content: [{ type: "text", text: "You've hit your limit" }] } });
  out({ type: "result", is_error: true, result: "You've hit your limit" });
  process.exit(1);
}
turn(1);
await new Promise((ok) => setTimeout(ok, 1500));
log({ second: true });
turn(2);
`);
fs.chmodSync(FAKE, 0o755);

const { Agent } = await import("./Agent.ts");
const { ClaudeCli, PREFIX } = await import("./ClaudeCli.ts");

const ASK = { vendor: "claude-cli" as const, model: "claude-haiku-5-5", effort: "low", speed: "slow", system: "be brief", searches: 2, server: "" };

const rows = () => fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const read = async (res: Response) => {
  const out: any[] = [];
  for await (const ev of Agent.events(res.body!)) {
    out.push(ev);
  }
  return out;
};

test("a turn streams its reply through the Agent loop, no API key", async () => {
  fs.rmSync(LOG, { force: true });
  process.env.FAKE_MODE = "text";
  const deltas: string[] = [];
  const call = Agent.ask({ ...ASK, blocks: [{ text: "hi", mark: true }] }, (ev) => ev.$ === "Delta" && deltas.push(ev.text));
  const end = await call.done;
  expect(end.ok).toBe(true);
  expect(end.text).toBe("hello 1");
  expect(deltas.join("")).toBe("hello 1");
  const [start, ...frames] = rows();
  expect(start.base).toBe(null);
  expect(start.retries).toBe("0");
  expect(start.user).toBe(os.userInfo().username);
  const args: string[] = start.args;
  expect(args.slice(0, 3)).toEqual(["-p", "--model", "claude-haiku-5-5"]);
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
  expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
  expect(args[args.indexOf("--effort") + 1]).toBe("low");
  expect(args).toContain("--strict-mcp-config");
  expect(frames).toEqual([{ frame: { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } } }]);
});

test("a history replays unqueried, tool names prefixed out and stripped back, killed at message_stop", async () => {
  fs.rmSync(LOG, { force: true });
  process.env.FAKE_MODE = "tool";
  const body = {
    model         : "claude-haiku-5-5",
    system        : [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
    output_config : { effort: "low" },
    tools         : [{ name: "zoom", description: "read a node", input_schema: { type: "object" } }, { type: "web_search_20260318", name: "web_search" }],
    messages      : [
      { role: "user", content: [{ type: "text", text: "find 7", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu_0", name: "zoom", input: { id: "6" } }, { type: "server_tool_use", id: "s", name: "web_search", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_0", content: [{ type: "text", text: "six" }] }] },
    ],
  };
  const plan = ClaudeCli.plan(body);
  expect(plan.tools).toEqual([{ name: "zoom", description: "read a node", inputSchema: { type: "object" } }]);
  const res = await ClaudeCli.post(JSON.stringify(body), ASK as any, new AbortController().signal);
  expect(res.status).toBe(200);
  const events = await read(res);
  expect(events.map((e) => e.type)).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  expect(events[1].content_block.name).toBe("zoom");
  const frames = rows().filter((r) => r.frame).map((r) => r.frame);
  expect(frames).toEqual([
    { type: "user", message: { role: "user", content: [{ type: "text", text: "find 7" }] }, shouldQuery: false },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tu_0", name: PREFIX + "zoom", input: { id: "6" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_0", content: [{ type: "text", text: "six" }] }] } },
  ]);
  await new Promise((ok) => setTimeout(ok, 2500));
  expect(rows().some((r) => r.second)).toBe(false);
});

test("a CLI error refuses the request, not retried", async () => {
  fs.rmSync(LOG, { force: true });
  process.env.FAKE_MODE = "error";
  const end = await Agent.ask({ ...ASK, blocks: [{ text: "hi", mark: false }] }, () => {}).done;
  expect(end.ok).toBe(false);
  expect(end.stop).toBe("down");
  expect(rows().filter((r) => r.args).length).toBe(1);
});

test("a CLI that does not acknowledge a replay is refused", async () => {
  fs.rmSync(LOG, { force: true });
  process.env.FAKE_MODE = "noreplay";
  const body = { model: "m", system: [], messages: [{ role: "user", content: [{ type: "text", text: "a" }] }, { role: "assistant", content: [{ type: "text", text: "b" }] }, { role: "user", content: [{ type: "text", text: "c" }] }] };
  const res = await ClaudeCli.post(JSON.stringify(body), ASK as any, new AbortController().signal);
  expect(res.status).toBe(400);
  expect((await res.json()).error.message).toContain("history replay not supported");
});
