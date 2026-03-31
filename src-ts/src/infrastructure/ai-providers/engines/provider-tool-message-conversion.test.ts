import { describe, expect, it } from "bun:test";
import type { KernelMessage } from "@shared/types";
import { OpenRouterEngine } from "./openrouter";
import { GitHubCopilotEngine } from "./github-copilot";

const TOOL_RESULT_MESSAGE: KernelMessage = {
  id: "msg-tool-1",
  role: "tool",
  parts: [
    {
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "echo",
      result: { status: "ok" },
    },
  ],
  createdAt: new Date().toISOString(),
};

describe("Provider tool-result message conversion", () => {
  it("OpenRouter preserves tool role and tool_call_id", async () => {
    const engine = new OpenRouterEngine();
    const converted = await (engine as any).convertMessages([TOOL_RESULT_MESSAGE]);

    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
    });
    expect(typeof converted[0].content).toBe("string");
    expect(converted[0].content).toContain("\"status\":\"ok\"");
  });

  it("GitHub Copilot preserves tool role and tool_call_id", async () => {
    const engine = new GitHubCopilotEngine();
    const converted = await (engine as any).convertMessages([TOOL_RESULT_MESSAGE]);

    expect(converted).toHaveLength(1);
    expect(converted[0]).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
    });
    expect(typeof converted[0].content).toBe("string");
    expect(converted[0].content).toContain("\"status\":\"ok\"");
  });
});
