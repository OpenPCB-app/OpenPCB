import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolDefinition } from "../engine";

/**
 * Standardized tool call format used within OpenPCB.
 */
export interface StandardToolCall {
  /** Unique identifier for the tool call */
  id: string;
  /** Name of the tool being called */
  name: string;
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
}

/**
 * Capabilities of a provider regarding tool use.
 */
export interface ProviderCapabilities {
  /** Whether the provider supports forcing a specific tool or disabling tools */
  supportsToolChoice: boolean;
  /** Whether the provider supports multiple tool calls in a single response */
  supportsParallelTools: boolean;
  /** Maximum number of tools that can be sent in a single request (optional) */
  maxToolsPerRequest?: number;
}

/**
 * Abstract base class for provider tool adapters.
 * 
 * Adapters are responsible for converting between OpenPCB's ToolSpec
 * and the provider-specific tool formats.
 * 
 * @template TToolFormat The provider-specific tool definition format
 */
export abstract class BaseToolAdapter<TToolFormat = unknown> {
  /**
   * Convert a ToolSpec to the provider-specific tool format.
   * 
   * @param spec The tool specification to convert
   * @returns The tool in provider-specific format
   */
  abstract convertTool(spec: ToolSpec): TToolFormat;

  /**
   * Convert a provider-specific tool call to the standard format.
   * 
   * @param providerCall The raw tool call from the provider
   * @returns Standardized tool call
   */
  abstract convertToolCall(providerCall: unknown): StandardToolCall;

  /**
   * Get the tool-related capabilities for this provider.
   * 
   * @returns Provider capabilities
   */
  abstract getCapabilities(): ProviderCapabilities;

  /**
   * Convert a ToolSpec to the legacy ToolDefinition format.
   * 
   * Used for backward compatibility with engines that haven't been
   * fully migrated to the adapter pattern.
   * 
   * @param spec The tool specification to convert
   * @returns Legacy ToolDefinition
   */
  specToDefinition(spec: ToolSpec): ToolDefinition {
    return {
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema,
      },
    };
  }
}
