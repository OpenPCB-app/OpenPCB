import type { ToolSpec } from "@shared/types/tool-spec.types";
import { 
  BaseToolAdapter, 
  type StandardToolCall, 
  type ProviderCapabilities 
} from "./base-adapter";

/**
 * Ollama tool definition format.
 */
interface OllamaToolFormat {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Ollama tool call in response.
 * Ollama tool calls do not have an 'id' field.
 */
interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

/**
 * Adapter for Ollama provider to convert between OpenPCB ToolSpec and Ollama tool format.
 */
export class OllamaAdapter extends BaseToolAdapter<OllamaToolFormat> {
  /**
   * Convert a ToolSpec to the Ollama-specific tool format.
   * 
   * @param spec The tool specification to convert
   * @returns The tool in Ollama-specific format
   */
  convertTool(spec: ToolSpec): OllamaToolFormat {
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
   * Convert an Ollama-specific tool call to the standard format.
   * 
   * Ollama tool calls lack a unique ID, so we generate a synthetic one.
   * Arguments can be either a pre-parsed object or a JSON string.
   * 
   * @param providerCall The raw tool call from Ollama
   * @returns Standardized tool call
   */
  convertToolCall(providerCall: unknown): StandardToolCall {
    if (!this.isOllamaToolCall(providerCall)) {
      throw new Error("Invalid Ollama tool call format");
    }

    const { name, arguments: args } = providerCall.function;
    
    // Generate a synthetic ID as Ollama doesn't provide one
    const id = `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    let parsedArgs: Record<string, unknown>;
    if (typeof args === "string") {
      try {
        parsedArgs = JSON.parse(args);
      } catch (e) {
        console.error(`Failed to parse Ollama tool arguments: ${args}`, e);
        parsedArgs = {};
      }
    } else {
      parsedArgs = args;
    }

    return {
      id,
      name,
      arguments: parsedArgs,
    };
  }

  /**
   * Get the tool-related capabilities for Ollama.
   * 
   * Ollama currently does not support tool_choice or parallel tool calls.
   * 
   * @returns Provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return {
      supportsToolChoice: false,
      supportsParallelTools: false,
    };
  }

  /**
   * Type guard to check if a provider call is a valid Ollama tool call.
   * 
   * @param call The call to check
   * @returns True if it's a valid Ollama tool call
   */
  private isOllamaToolCall(call: unknown): call is OllamaToolCall {
    if (!call || typeof call !== "object") return false;
    
    const c = call as Record<string, unknown>;
    if (!c.function || typeof c.function !== "object") return false;
    
    const f = c.function as Record<string, unknown>;
    return (
      typeof f.name === "string" &&
      (typeof f.arguments === "object" || typeof f.arguments === "string")
    );
  }
}

/**
 * Factory function to create an OllamaAdapter instance.
 * 
 * @returns A new OllamaAdapter
 */
export function createOllamaAdapter(): OllamaAdapter {
  return new OllamaAdapter();
}
