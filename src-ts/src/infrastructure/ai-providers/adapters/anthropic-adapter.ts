import type { ToolSpec } from "@shared/types/tool-spec.types";
import { BaseToolAdapter, type StandardToolCall, type ProviderCapabilities } from "./base-adapter";

/**
 * Anthropic-specific tool definition format.
 * Anthropic uses a flat structure with 'input_schema' instead of 'parameters'.
 */
interface AnthropicToolFormat {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/**
 * Anthropic-specific tool call format.
 */
interface AnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * AnthropicAdapter provides tool conversion for Anthropic models.
 * 
 * NOTE: This is a P2 stub. Full implementation will be added when 
 * the Anthropic provider engine is implemented.
 */
export class AnthropicAdapter extends BaseToolAdapter<AnthropicToolFormat> {
  /**
   * Convert a ToolSpec to the Anthropic-specific tool format.
   * 
   * @param spec The tool specification to convert
   * @returns The tool in Anthropic format
   */
  convertTool(spec: ToolSpec): AnthropicToolFormat {
    // TODO P2: Add cache_control support when Anthropic provider is implemented
    return {
      name: spec.name,
      description: spec.description,
      input_schema: spec.inputSchema,
    };
  }

  /**
   * Convert an Anthropic-specific tool call to the standard format.
   * 
   * @param providerCall The raw tool call from Anthropic
   * @returns Standardized tool call
   */
  convertToolCall(providerCall: unknown): StandardToolCall {
    // TODO P2: Handle Anthropic-specific tool use blocks (content blocks with type "tool_use")
    
    const call = providerCall as AnthropicToolCall;
    
    return {
      id: call.id,
      name: call.name,
      arguments: call.input,
    };
  }

  /**
   * Get the tool-related capabilities for Anthropic.
   * 
   * @returns Provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    // TODO P2: Add maxToolsPerRequest limit when known
    return {
      supportsToolChoice: true,
      supportsParallelTools: true,
    };
  }
}

/**
 * Factory function to create an AnthropicAdapter.
 * 
 * @returns A new AnthropicAdapter instance
 */
export function createAnthropicAdapter(): AnthropicAdapter {
  return new AnthropicAdapter();
}
