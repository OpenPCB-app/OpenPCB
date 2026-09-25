import { describe, expect, test } from "vitest";
import { connectLabel, describeClaudeCodeStatus } from "./McpSection";

const base: ClaudeCodeStatus = {
  cliPath: "/usr/local/bin/claude",
  cliVersion: "2.1.282",
  plugin: { installed: false, version: null, enabled: false },
  marketplace: { registered: false, path: null, ours: false },
  server: { registered: false, ownedByOpenPcb: false, outdated: false },
  registeredMode: null,
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
      describeClaudeCodeStatus({
        ...base,
        server: { registered: true, ownedByOpenPcb: true, outdated: false },
      }),
    ).toContain("MCP server only");
    expect(
      describeClaudeCodeStatus({
        ...base,
        server: { registered: true, ownedByOpenPcb: true, outdated: true },
        updateAvailable: true,
      }),
    ).toContain("old OpenPCB location");
  });

  test("the primary button updates whatever this installation registered", () => {
    expect(connectLabel(base)).toBe("Connect Claude Code");
    expect(connectLabel({ ...base, updateAvailable: true, registeredMode: "plugin" })).toBe("Update plugin");
    expect(connectLabel({ ...base, updateAvailable: true, registeredMode: "server" })).toBe("Update connection");
  });
});
