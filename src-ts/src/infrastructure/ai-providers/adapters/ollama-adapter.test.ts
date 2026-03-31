import { describe, it, expect } from "bun:test";
import { OllamaAdapter } from "./ollama-adapter";
import type { ToolSpec } from "../../../../shared/types/tool-spec.types.ts";

const createTestSpec = (overrides?: Partial<ToolSpec>): ToolSpec => ({
  name: "test.tool",
  version: "1.0",
  scope: "module",
  description: "A test tool",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  guards: [],
  ...overrides,
});

describe("OllamaAdapter", () => {
  const adapter = new OllamaAdapter();

  describe("convertTool", () => {
    it("converts basic ToolSpec to Ollama format", () => {
      const spec = createTestSpec();

      const result = adapter.convertTool(spec);

      expect(result).toEqual({
        type: "function",
        function: {
          name: "test.tool",
          description: "A test tool",
          parameters: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
        },
      });
    });
  });

  describe("convertToolCall", () => {
    it("handles object arguments", () => {
      const call = {
        function: {
          name: "test",
          arguments: { key: "val" },
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result.name).toBe("test");
      expect(result.arguments).toEqual({ key: "val" });
      expect(result.id).toMatch(/^call_\d+_\d+$/);
    });

    it("parses string arguments", () => {
      const call = {
        function: {
          name: "test",
          arguments: '{"key":"val"}',
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result.name).toBe("test");
      expect(result.arguments).toEqual({ key: "val" });
    });

    it("returns empty arguments when string arguments are invalid JSON", () => {
      const call = {
        function: {
          name: "test",
          arguments: "not json",
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result.name).toBe("test");
      expect(result.arguments).toEqual({});
    });

    it("generates a synthetic call id", () => {
      const call = {
        function: {
          name: "test",
          arguments: {},
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result.id.startsWith("call_")).toBe(true);
      expect(result.id).toMatch(/^call_\d+_\d+$/);
    });

    it("throws on invalid formats", () => {
      expect(() => adapter.convertToolCall(null)).toThrow("Invalid Ollama tool call format");
      expect(() => adapter.convertToolCall({ wrong: "format" })).toThrow("Invalid Ollama tool call format");
    });
  });

  it("returns Ollama capabilities", () => {
    expect(adapter.getCapabilities()).toEqual({
      supportsToolChoice: false,
      supportsParallelTools: false,
    });
  });
});
