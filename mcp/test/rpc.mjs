// A minimal MCP client for the tests: spawn the server, speak JSON-RPC over stdio.
import { spawn } from "node:child_process";

export function startServer(env = {}) {
  const child = spawn("node", [new URL("../dist/lattice-mcp.mjs", import.meta.url).pathname], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  let buffer = "";
  const pending = new Map();
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  function send(method, params) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`timed out waiting for ${method}\n${stderr.join("")}`)), 10_000);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  async function initialize() {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  }

  async function callTool(name, args = {}) {
    const response = await send("tools/call", { name, arguments: args });
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result.content.map((part) => part.text).join("\n");
  }

  return {
    initialize,
    listTools: async () => (await send("tools/list", {})).result.tools,
    callTool,
    stop: () => child.kill(),
    stderr: () => stderr.join(""),
  };
}
