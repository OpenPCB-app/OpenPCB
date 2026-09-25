import { describe, expect, test } from "vitest";
import { describeClaudeCodeStatus } from "./McpSection";

const base: ClaudeCodeStatus = {
  cliPath: "/usr/local/bin/claude",
  cliVersion: "2.1.282",
  plugin: { installed: false, version: null, enabled: false },
  marketplace: { registered: false, path: null },
  server: { registered: false, ownedByOpenPcb: false },
  updateAvailable: false,
};

describe("Claude Code status line", () => {
  test("covers missing CLI, not connected, plugin, update, server-only", () => {
    expect(describeClaudeCodeStatus(null)).toContain("Checking");
    expect(describeClaudeCodeStatus({ ...base, cliPath: null })).toContain("not installed");
    expect(describeClaudeCodeStatus(base)).toContain("not connected");
    expect(
      describeClaudeCodeStatus({
        ...base,
        plugin: { installed: true, version: "0.1.1-beta", enabled: true },
      }),
    ).toContain("Connected with the OpenPCB plugin 0.1.1-beta");
    expect(
      describeClaudeCodeStatus({
        ...base,
        plugin: { installed: true, version: "0.1.0", enabled: true },
        updateAvailable: true,
      }),
    ).toContain("update is available");
    expect(
      describeClaudeCodeStatus({ ...base, server: { registered: true, ownedByOpenPcb: true } }),
    ).toContain("MCP server only");
  });
});
