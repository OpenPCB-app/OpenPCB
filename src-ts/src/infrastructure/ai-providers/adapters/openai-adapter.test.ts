import { describe, it, expect } from "bun:test";
import { OpenAIAdapter } from "./openai-adapter";
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

describe("OpenAIAdapter", () => {
  const adapter = new OpenAIAdapter();

  describe("convertTool", () => {
    it("converts basic ToolSpec to OpenAI format", () => {
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

    it("keeps empty inputSchema as empty parameters", () => {
      const spec = createTestSpec({ inputSchema: {} });

      const result = adapter.convertTool(spec);

      expect(result.function.parameters).toEqual({});
    });

    it("passes through complex nested schema", () => {
      const complexSchema = {
        type: "object",
        properties: {
          filter: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" } },
              range: {
                type: "object",
                properties: {
                  from: { type: "string", format: "date-time" },
                  to: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      };
      const spec = createTestSpec({ inputSchema: complexSchema });

      const result = adapter.convertTool(spec);

      expect(result.function.parameters).toEqual(complexSchema);
    });
  });

  describe("convertToolCall", () => {
    it("converts valid OpenAI tool call to standard format", () => {
      const call = {
        id: "call_123",
        type: "function",
        function: {
          name: "test",
          arguments: '{"key":"val"}',
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result).toEqual({
        id: "call_123",
        name: "test",
        arguments: { key: "val" },
      });
    });

    it("returns empty arguments on malformed JSON", () => {
      const call = {
        id: "call_123",
        type: "function",
        function: {
          name: "test",
          arguments: "{not-json}",
        },
      };

      const result = adapter.convertToolCall(call);

      expect(result).toEqual({
        id: "call_123",
        name: "test",
        arguments: {},
      });
    });

    it("returns fallback value when tool call format is invalid", () => {
      const invalidCall = {
        type: "function",
        function: {
          name: "test",
          arguments: "{}",
        },
      };

      const result = adapter.convertToolCall(invalidCall);

      expect(result).toEqual({
        id: "unknown",
        name: "unknown",
        arguments: {},
      });
    });
  });

  it("returns OpenAI capabilities", () => {
    expect(adapter.getCapabilities()).toEqual({
      supportsToolChoice: true,
      supportsParallelTools: true,
    });
  });

  it("specToDefinition converts ToolSpec to legacy ToolDefinition", () => {
    const spec = createTestSpec();

    const result = adapter.specToDefinition(spec);

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
