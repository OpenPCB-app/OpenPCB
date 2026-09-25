/**
 * `openpcb-mcp` — stdio MCP bridge into the running OpenPCB app.
 *
 * Claude Code, Claude Desktop and other stdio clients spawn this process; it
 * serves MCP on stdin/stdout and forwards to the Streamable HTTP endpoint the
 * OpenPCB backend serves on an ephemeral loopback port (discovered through the
 * 0600 portfile Electron main writes). The logic lives in `bridge.ts` /
 * `upstream.ts` / `portfile.ts`, which have no Electron dependency; this file
 * only wires them to the process.
 *
 * Runs on the app's own Electron binary with ELECTRON_RUN_AS_NODE (see the
 * launcher Electron main writes into the user-data dir), so no system Node is
 * needed. There is no headless fallback on purpose: two writers on one SQLite
 * file is a worse failure mode than "start OpenPCB".
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpBridge } from "./bridge";
import { defaultDiscoveryEnv } from "./portfile";
import type { JsonRpcMessage } from "./upstream";

function log(message: string): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr or they
  // corrupt the protocol stream.
  process.stderr.write(`openpcb-mcp: ${message}\n`);
}

async function main(): Promise<void> {
  const stdio = new StdioServerTransport();
  const bridge = new McpBridge({
    discovery: defaultDiscoveryEnv(),
    instanceId: crypto.randomUUID(),
    clientKeyOverride: process.env.OPENPCB_MCP_CLIENT?.trim() || undefined,
    pollMs: Number(process.env.OPENPCB_MCP_POLL_MS) || undefined,
    log,
    send: (message) => {
      void stdio.send(message as never).catch((error: unknown) => {
        log(`stdout write failed: ${String(error)}`);
        shutdown(1);
      });
    },
  });

  let closing = false;
  const shutdown = (code: number) => {
    if (closing) return;
    closing = true;
    bridge.close();
    void stdio.close().finally(() => process.exit(code));
  };

  stdio.onmessage = (message) => {
    void bridge
      .handleClientMessage(message as unknown as JsonRpcMessage)
      .catch((error: unknown) => log(`message handling failed: ${String(error)}`));
  };
  stdio.onclose = () => shutdown(0);
  stdio.onerror = (error) => log(`stdio error: ${error.message}`);

  await stdio.start();
  // The client closing our stdin is how a stdio server is told to exit.
  process.stdin.on("end", () => shutdown(0));
  bridge.start();
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
