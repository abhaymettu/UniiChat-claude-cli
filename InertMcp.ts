// InertMcp
// ========
// [Added in the UniiChat-claude-cli fork, 2026. Not part of upstream UniiChat. See README.]
// The MCP server the claude CLI sees Unii's tools through (ClaudeCli.ts):
// it lists them from the JSON file it is given and runs none, since
// Unii's own loop runs every tool call the model makes.

import * as fs from "node:fs";
import * as readline from "node:readline";

const tools = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

for await (const line of readline.createInterface({ input: process.stdin })) {
  if (line.trim() === "") {
    continue;
  }
  const row = JSON.parse(line);
  const result =
    row.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "unii-inert", version: "1" } }
    : row.method === "tools/list" ? { tools }
    : row.method === "tools/call" ? { isError: true, content: [{ type: "text", text: "Denied: Unii runs its own tools." }] }
    : {};
  if (row.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: row.id, result }) + "\n");
  }
}
