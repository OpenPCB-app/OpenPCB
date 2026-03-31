/**
 * Local Provider Engine - V2 Kernel
 *
 * Implements KernelProviderEngine using Rust Local Runtime.
 * Communicates via Unix Domain Socket.
 */

import type { ModelInfo, ProviderConfig } from "@shared/types";
import type { KernelMessage } from "@shared/types";
import { extractTextContent } from "@shared/types";
import type { TaskId, TokenUsage } from "@shared/types";
import {
  BaseProviderEngine,
  type ChatRequest,
  type ChatResult,
  type StreamCallbacks,
  type ProviderStatus,
} from "../engine.ts";
import { getRustClient, type RustClient } from "../../rust-client.ts";

/** Local provider ID */
const PROVIDER_ID = "local" as const;

/**
 * Local Provider Engine
 *
 * Bridges to Rust sidecar for local LLM inference.
 */
export class LocalEngine extends BaseProviderEngine {
  readonly providerId = "local" as const;
  readonly name = "Local (Rust)";
  readonly requiresApiKey = false;
  readonly defaultBaseURL = undefined;

  private client: RustClient;
  private streamState = new Map<TaskId, { callbacks: StreamCallbacks; text: string; reasoning: string }>();

  constructor() {
    super();
    this.client = getRustClient();

    // Subscribe to bridge events
    this.client.on("local_chat.delta", (p) => this.handleDelta(p as any));
    this.client.on("local_chat.completed", (p) => this.handleCompleted(p as any));
    this.client.on("local_chat.failed", (p) => this.handleFailed(p as any));
  }

  override async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    // Connection managed globally
  }

  async checkStatus(): Promise<ProviderStatus> {
    if (!this.client.isConnected) {
      return {
        available: false,
        message: "Rust bridge not connected",
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      await this.client.request("model.list");
      return {
        available: true,
        message: "Local runtime ready",
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        available: false,
        message: e instanceof Error ? e.message : "Bridge error",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client.isConnected) return [];

    try {
      const models = await this.client.request("model.list") as any[];
      return models.map((m: any) => ({
        id: m.id,
        providerId: "local",
        name: m.name || m.id,
        description: "Local model",
        contextWindow: m.contextWindow || 4096,
        capabilities: {
          supportsVision: false,
          supportsStreaming: true,
          supportsReasoning: false
        }
      }));
    } catch (e) {
      console.error("[LocalEngine] Failed to list models:", e);
      return [];
    }
  }

  getModel(modelId: string): ModelInfo | undefined {
    // Dynamic models are not in static registry
    return undefined;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    throw new Error("Non-streaming chat not implemented for LocalEngine (use stream)");
  }

  async stream(request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> {
    this.ensureInitialized();
    const taskId = request.taskId;

    this.streamState.set(taskId, { callbacks, text: "", reasoning: "" });

    try {
      // Start generation
      await this.client.request("local_chat.start", {
        taskId,
        modelId: request.model,
        messages: this.convertMessages(request.messages),
        params: {
          temperature: 0.7,
          maxTokens: 4096
        }
      });

      // Wait for completion
      return new Promise((resolve, reject) => {
        const state = this.streamState.get(taskId);
        if (state) {
          const originalComplete = callbacks.onComplete;
          state.callbacks.onComplete = (result) => {
            originalComplete?.(result);
            resolve(result);
          };

          const originalError = callbacks.onError;
          state.callbacks.onError = (err) => {
            originalError?.(err);
            reject(err);
          };
        }
      });
    } catch (e) {
      this.streamState.delete(taskId);
      throw e;
    }
  }

  override abort(taskId: TaskId): void {
    this.client.request("local_chat.cancel", { taskId }).catch(console.error);
    this.streamState.delete(taskId);
    super.abort(taskId);
  }

  private handleDelta(params: { taskId: string; text: string }) {
    const state = this.streamState.get(params.taskId);
    if (state) {
      state.text += params.text;
      state.callbacks.onToken?.(params.text);
    }
  }

  private handleCompleted(params: { taskId: string; usage?: any; finishReason?: string }) {
    const state = this.streamState.get(params.taskId);
    if (state) {
      const result: ChatResult = {
        text: state.text,
        reasoningText: state.reasoning || undefined,
        usage: params.usage,
        finishReason: params.finishReason as any
      };
      state.callbacks.onComplete?.(result);
      this.streamState.delete(params.taskId);
    }
  }

  private handleFailed(params: { taskId: string; error: string }) {
    const state = this.streamState.get(params.taskId);
    if (state) {
      state.callbacks.onError?.(new Error(params.error));
      this.streamState.delete(params.taskId);
    }
  }

  private convertMessages(messages: KernelMessage[]) {
    return messages.map(m => ({
      role: m.role,
      content: extractTextContent(m.parts)
    }));
  }
}

/** Factory */
export function createLocalEngine(): LocalEngine {
  return new LocalEngine();
}