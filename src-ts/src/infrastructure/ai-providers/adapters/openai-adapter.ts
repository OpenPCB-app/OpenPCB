import type { ToolSpec } from "@shared/types/tool-spec.types";
import { BaseToolAdapter, type StandardToolCall, type ProviderCapabilities } from "./base-adapter";

/**
 * OpenAI-specific tool format.
 */
export interface OpenAIToolFormat {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Adapter for OpenAI tool calling.
 * 
 * Converts between OpenPCB's ToolSpec and OpenAI's ChatCompletionTool format.
 */
export class OpenAIAdapter extends BaseToolAdapter<OpenAIToolFormat> {
  /**
   * Convert a ToolSpec to OpenAI's function tool format.
   * 
   * @param spec The tool specification to convert
   * @returns The tool in OpenAI-specific format
   */
  convertTool(spec: ToolSpec): OpenAIToolFormat {
    return {
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema,
      },
    };
  }

  /**
   * Convert an OpenAI tool call to the standard format.
   * 
   * @param providerCall The raw tool call from OpenAI
   * @returns Standardized tool call
   */
  convertToolCall(providerCall: unknown): StandardToolCall {
    if (!this.isOpenAIToolCall(providerCall)) {
      console.error("[OpenAIAdapter] Invalid tool call format received:", providerCall);
      return {
        id: "unknown",
        name: "unknown",
        arguments: {},
      };
    }

    let parsedArgs: Record<string, unknown> = {};
    try {
      if (providerCall.function.arguments) {
        parsedArgs = JSON.parse(providerCall.function.arguments);
      }
    } catch (error) {
      console.error(`[OpenAIAdapter] Failed to parse tool arguments for ${providerCall.function.name}:`, error);
      parsedArgs = {};
    }

    return {
      id: providerCall.id,
      name: providerCall.function.name,
      arguments: parsedArgs,
    };
  }

  /**
   * Type guard for OpenAI tool calls.
   */
  private isOpenAIToolCall(call: unknown): call is {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  } {
    if (!call || typeof call !== "object") return false;
    const c = call as Record<string, unknown>;
    return (
      typeof c.id === "string" &&
      typeof c.type === "string" &&
      typeof c.function === "object" &&
      c.function !== null &&
      typeof (c.function as Record<string, unknown>).name === "string" &&
      typeof (c.function as Record<string, unknown>).arguments === "string"
    );
  }

  /**
   * Get the tool-related capabilities for OpenAI.
   * 
   * @returns Provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return {
      supportsToolChoice: true,
      supportsParallelTools: true,
    };
  }
}

/**
 * Factory function to create an OpenAI tool adapter.
 * 
 * @returns A new OpenAIAdapter instance
 */
export function createOpenAIAdapter(): OpenAIAdapter {
  return new OpenAIAdapter();
}
