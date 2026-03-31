import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { extractMessageParts } from "./messages";

describe("extractMessageParts", () => {
  it("extracts canonical hyphen tool parts", () => {
    const message: UIMessage = {
      id: "msg-1",
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "echo",
          args: { text: "hello" },
        } as unknown as UIMessage["parts"][number],
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "echo",
          result: { ok: true },
          isError: false,
        } as unknown as UIMessage["parts"][number],
      ],
    };

    const extracted = extractMessageParts(message);

    expect(extracted.toolCallParts).toHaveLength(1);
    expect(extracted.toolCallParts[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "echo",
    });

    expect(extracted.toolResultParts).toHaveLength(1);
    expect(extracted.toolResultParts[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "echo",
      isError: false,
    });
  });
});
