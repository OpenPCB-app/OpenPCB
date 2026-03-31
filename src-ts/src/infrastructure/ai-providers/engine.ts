/**
 * KernelProviderEngine - V2 Kernel
 *
 * Abstract interface for AI provider engines.
 * Each provider (OpenAI, Ollama) implements this interface.
 */

import type { ProviderId, ModelInfo, ProviderConfig, ProviderStatus } from "@shared/types";
import type { KernelMessage } from "@shared/types";
import type { TaskId, TokenUsage } from "@shared/types";

/** Tool definition for function calling */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** Chat completion request */
export interface ChatRequest {
  /** Task ID for tracking */
  taskId: TaskId;
  /** Model to use */
  model: string;
  /** Conversation messages */
  messages: KernelMessage[];
  /** System prompt (optional) */
  systemPrompt?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  // Generation params
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2, default 1) */
  temperature?: number;
  /** Top-p sampling (0-1, default 1) */
  topP?: number;
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  /** Stop sequences */
  stop?: string | string[];
  /** Seed for reproducibility */
  seed?: number;
  /** Response format (JSON mode) */
  responseFormat?: { type: "text" | "json_object" };
  // Tool calling
  /** Available tools for function calling */
  tools?: ToolDefinition[];
  /** Tool choice strategy */
  toolChoice?: "auto" | "required" | "none";
  // Idempotency
  /** Request ID for idempotency (OpenAI uses this for retry deduplication) */
  requestId?: string;
}

/** Tool call result from function calling */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Chat completion result */
export interface ChatResult {
  /** Generated text response */
  text: string;
  /** Reasoning/thinking output (for reasoning models) */
  reasoningText?: string;
  /** Token usage statistics */
  usage?: TokenUsage;
  /** Finish reason */
  finishReason?: "stop" | "length" | "content_filter" | "tool_calls" | "error";
  /** Tool calls (function calling) */
  toolCalls?: ToolCall[];
  /** System fingerprint for debugging/versioning */
  systemFingerprint?: string;
}

/** Streaming callbacks */
export interface StreamCallbacks {
  /** Called for each text token */
  onToken?: (token: string) => void;
  /** Called for reasoning chunks (reasoning models) */
  onReasoning?: (text: string) => void;
  /** Called on completion */
  onComplete?: (result: ChatResult) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called on abort with partial result */
  onAbort?: (partial: { text: string; reasoningText?: string }) => void;
}

// Re-export ProviderStatus from shared types
export type { ProviderStatus } from "@shared/types";

/** Model currently loaded in memory (for local providers like Ollama) */
export interface LoadedModel {
  /** Model name/ID */
  name: string;
  /** Model size in bytes */
  size: number;
  /** VRAM usage in bytes (optional) */
  sizeVram?: number;
  /** Expiry time for model in memory (optional, ISO timestamp) */
  expiresAt?: string;
}

/**
 * Abstract provider engine interface.
 *
 * Each AI provider implements this interface to provide
 * chat completion and streaming capabilities.
 */
export interface KernelProviderEngine {
  /** Provider identifier */
  readonly providerId: ProviderId;

  /** Human-readable provider name */
  readonly name: string;

  /** Whether this provider requires an API key */
  readonly requiresApiKey: boolean;

  /** Default base URL for API requests */
  readonly defaultBaseURL?: string;

  /**
   * Initialize the engine with configuration.
   * Called once before first use.
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Check if the provider is available and configured.
   */
  checkStatus(): Promise<ProviderStatus>;

  /**
   * List available models from this provider.
   * May fetch dynamically or return static list.
   */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Get information about a specific model.
   */
  getModel(modelId: string): ModelInfo | undefined;

  /**
   * Perform a non-streaming chat completion.
   */
  chat(request: ChatRequest): Promise<ChatResult>;

  /**
   * Perform a streaming chat completion.
   * Returns a promise that resolves when streaming completes.
   */
  stream(request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult>;

  /**
   * Abort an in-progress request by task ID.
   */
  abort(taskId: TaskId): void;

  /**
   * Clean up resources.
   */
  dispose(): void;

  /**
   * Check if a model is currently loaded in memory.
   * For cloud providers, always returns true.
   * For local providers (Ollama), checks actual memory state.
   */
  isModelLoaded(modelId: string): Promise<boolean>;

  /**
   * Get list of models currently loaded in memory.
   * For cloud providers, returns empty array.
   * For local providers, returns actual loaded models with VRAM info.
   */
  getLoadedModels(): Promise<LoadedModel[]>;

  /**
   * Preload a model into memory (for local providers).
   * For cloud providers, no-op that returns true.
   * For local providers, triggers model loading and waits.
   * @param modelId Model to preload
   * @returns True if preload succeeded, false on failure
   */
  preloadModel(modelId: string): Promise<boolean>;
}

/**
 * Base implementation with common functionality.
 * Provider engines can extend this class.
 */
export abstract class BaseProviderEngine implements KernelProviderEngine {
  abstract readonly providerId: ProviderId;
  abstract readonly name: string;
  abstract readonly requiresApiKey: boolean;
  abstract readonly defaultBaseURL?: string;

  protected config: ProviderConfig = {};
  protected initialized = false;
  protected activeRequests = new Map<TaskId, AbortController>();

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    console.log(`[${this.name}] Initialized`);
  }

  abstract checkStatus(): Promise<ProviderStatus>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract getModel(modelId: string): ModelInfo | undefined;
  abstract chat(request: ChatRequest): Promise<ChatResult>;
  abstract stream(request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult>;

  abort(taskId: TaskId): void {
    const controller = this.activeRequests.get(taskId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(taskId);
      console.log(`[${this.name}] Aborted task: ${taskId}`);
    }
  }

  dispose(): void {
    // Abort all active requests
    for (const [taskId, controller] of this.activeRequests) {
      controller.abort();
      console.log(`[${this.name}] Disposing, aborted task: ${taskId}`);
    }
    this.activeRequests.clear();
    this.initialized = false;
    console.log(`[${this.name}] Disposed`);
  }

  /**
   * Default implementation: model always loaded (cloud providers).
   * Override in local providers that manage model loading.
   */
  async isModelLoaded(_modelId: string): Promise<boolean> {
    return true;
  }

  /**
   * Default implementation: no loaded models info (cloud providers).
   * Override in local providers that track loaded models.
   */
  async getLoadedModels(): Promise<LoadedModel[]> {
    return [];
  }

  /**
   * Default implementation: no-op preload (cloud providers).
   * Override in local providers that support preloading.
   */
  async preloadModel(_modelId: string): Promise<boolean> {
    return true;
  }

  /** Create an AbortController for a task, combining with external signal */
  protected createAbortController(taskId: TaskId, signal?: AbortSignal): AbortController {
    const controller = new AbortController();
    this.activeRequests.set(taskId, controller);

    // Link external signal if provided
    if (signal) {
      signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    return controller;
  }

  /** Clean up after request completes */
  protected cleanupRequest(taskId: TaskId): void {
    this.activeRequests.delete(taskId);
  }

  /** Get effective base URL */
  protected getBaseURL(): string {
    return this.config.baseURL || this.defaultBaseURL || "";
  }

  /** Get API key (throws if required but missing) */
  protected getApiKey(): string | undefined {
    if (this.requiresApiKey && !this.config.apiKey) {
      throw new Error(`API key required for ${this.name}`);
    }
    return this.config.apiKey;
  }

  /** Ensure engine is initialized */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.name} engine not initialized. Call initialize() first.`);
    }
  }
}

/** Factory function type for creating provider engines */
export type ProviderEngineFactory = () => KernelProviderEngine;
