/**
 * Ollama Provider Engine - V2 Kernel
 *
 * Implements KernelProviderEngine using direct Ollama HTTP API.
 * Supports local models with reasoning output (DeepSeek R1, etc.).
 */

import type { ModelInfo, ProviderConfig, ProviderErrorCode } from "@shared/types";
import { MODELS } from "@shared/types";
import type { KernelMessage, ProviderContentPart } from "@shared/types";
import { toProviderMessage } from "@shared/types";
import type { TaskId, TokenUsage } from "@shared/types";
import {
  BaseProviderEngine,
  type ChatRequest,
  type ChatResult,
  type StreamCallbacks,
  type ProviderStatus,
  type LoadedModel,
} from "../engine.ts";

/** Ollama models from static registry */
const OLLAMA_MODELS = MODELS.filter((m) => m.providerId === "ollama");

/** Ollama API message format */
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/** Ollama tool definition */
interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Ollama tool call in response */
interface OllamaToolCall {
  index?: number;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

/** Ollama chat request body */
interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
  tools?: OllamaTool[];
}

/** Ollama chat response (non-streaming) */
interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Ollama streaming chunk */
interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
    thinking?: string;
  };
  done: boolean;
  reasoning?: string;
  thinking?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Ollama models list response */
interface OllamaModelsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
      parent_model: string;
      format: string;
      family: string;
      families: string[];
      parameter_size: string;
      quantization_level: string;
    };
  }>;
}

/** Ollama /api/ps response - currently loaded models */
interface OllamaProcessResponse {
  models: Array<{
    name: string;
    model: string;
    size: number;
    digest: string;
    details: {
      parent_model: string;
      format: string;
      family: string;
      families: string[] | null;
      parameter_size: string;
      quantization_level: string;
    };
    expires_at: string;
    size_vram: number;
  }>;
}

/** Model loading timeout (2 minutes) */
const MODEL_LOADING_TIMEOUT_MS = 120_000;

/**
 * Ollama Provider Engine
 *
 * Uses direct HTTP API for maximum control over streaming
 * and access to reasoning output.
 */
export class OllamaEngine extends BaseProviderEngine {
  readonly providerId = "ollama" as const;
  readonly name = "Ollama";
  readonly requiresApiKey = false;
  readonly defaultBaseURL = "http://localhost:11434";

  private cachedModels: ModelInfo[] | null = null;
  private modelsCacheTime = 0;
  private readonly MODEL_CACHE_TTL = 60000; // 1 minute

  override async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    console.log(`[OllamaEngine] Initialized with baseURL: ${this.getBaseURL()}`);
  }

  async checkStatus(): Promise<ProviderStatus> {
    try {
      const response = await fetch(`${this.getBaseURL()}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return {
          available: true,
          message: "Ollama is running",
          checkedAt: new Date().toISOString(),
        };
      }

      return {
        available: false,
        message: `Ollama returned status ${response.status}`,
        errorCode: response.status === 401 ? 'auth_failed' : 'unknown',
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorCode = this.detectErrorCode(error);
      return {
        available: false,
        message: error instanceof Error ? error.message : "Failed to connect to Ollama",
        errorCode,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Detect specific error code from connection errors.
   * Handles both standard Node/Bun errors and fetch errors.
   */
  private detectErrorCode(error: unknown): ProviderErrorCode {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('connection refused') || msg.includes('econnrefused')) {
        return 'connection_refused';
      }
      if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('aborterror')) {
        return 'timeout';
      }
      if (msg.includes('unauthorized') || msg.includes('401')) {
        return 'auth_failed';
      }
    }
    // Check for Bun-specific error format (seen in logs)
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ConnectionRefused' || code === 'ECONNREFUSED') {
        return 'connection_refused';
      }
      if (code === 'ETIMEDOUT' || code === 'TIMEOUT') {
        return 'timeout';
      }
    }
    return 'unknown';
  }

  async listModels(): Promise<ModelInfo[]> {
    // Check cache
    if (this.cachedModels && Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    try {
      const response = await fetch(`${this.getBaseURL()}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`[OllamaEngine] Failed to fetch models: ${response.status}`);
        return OLLAMA_MODELS;
      }

      const data = (await response.json()) as OllamaModelsResponse;

      // Convert Ollama models to our format
      const dynamicModels: ModelInfo[] = data.models.map((m) => ({
        id: m.name,
        providerId: "ollama" as const,
        name: m.name,
        description: `${m.details.parameter_size} - ${m.details.family}`,
        contextWindow: this.estimateContextWindow(m.details.parameter_size),
        capabilities: {
          supportsVision: false,
          supportsStreaming: true,
          supportsReasoning: this.isReasoningModel(m.name),
        },
      }));

      // Merge with static models (static takes precedence for known models)
      const mergedModels = [...OLLAMA_MODELS];
      for (const model of dynamicModels) {
        if (!mergedModels.find((m) => m.id === model.id)) {
          mergedModels.push(model);
        }
      }

      this.cachedModels = mergedModels;
      this.modelsCacheTime = Date.now();

      return mergedModels;
    } catch (error) {
      console.warn(`[OllamaEngine] Error fetching models:`, error);
      return OLLAMA_MODELS;
    }
  }

  getModel(modelId: string): ModelInfo | undefined {
    // Check static list first
    const staticModel = OLLAMA_MODELS.find((m) => m.id === modelId);
    if (staticModel) return staticModel;

    // Check cached dynamic models
    return this.cachedModels?.find((m) => m.id === modelId);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const controller = this.createAbortController(request.taskId, request.signal);

    try {
      const messages = this.convertMessages(request.messages, request.systemPrompt);

      const body: OllamaChatRequest = {
        model: request.model,
        messages,
        stream: false,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          },
        }));
      }

      const response = await fetch(`${this.getBaseURL()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OllamaChatResponse;

      const usage: TokenUsage | undefined =
        data.prompt_eval_count !== undefined
          ? {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          }
          : undefined;

      const toolCalls = data.message.tool_calls?.map((tc, index) => ({
        id: `call_${index}`,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
        },
      }));

      return {
        text: data.message.content,
        usage,
        finishReason: toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
        toolCalls,
      };
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

  async stream(request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> {
    const controller = this.createAbortController(request.taskId, request.signal);

    try {
      const messages = this.convertMessages(request.messages, request.systemPrompt);

      const body: OllamaChatRequest = {
        model: request.model,
        messages,
        stream: true,
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          },
        }));
      }

      const response = await fetch(`${this.getBaseURL()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      return await this.processStream(request.taskId, response, callbacks);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(err);
      throw err;
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

  /** Process NDJSON streaming response */
  private async processStream(
    taskId: TaskId,
    response: Response,
    callbacks: StreamCallbacks,
  ): Promise<ChatResult> {
    let fullText = "";
    let reasoningText = "";
    let usage: TokenUsage | undefined;
    const toolCallsMap = new Map<number, { name?: string; args: string }>();

    let insideThinkingBlock = false;
    let parsableBuffer = "";
    const START_TAG = "<think>";
    const END_TAG = "</think>";
    const MAX_TAG_LEN = Math.max(START_TAG.length, END_TAG.length);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let lineBuffer = ""; // For NDJSON lines

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Decode new chunk
        lineBuffer += decoder.decode(value, { stream: true });

        // Process complete lines (NDJSON format)
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || ""; // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line) as OllamaStreamChunk;

            // 1. Handle native reasoning/thinking field
            // DeepSeek R1 uses 'reasoning', Qwen 3 uses 'thinking' (sometimes nested in message)
            const reasoningContent = chunk.reasoning || chunk.thinking || chunk.message?.thinking;
            if (reasoningContent) {
              reasoningText += reasoningContent;
              callbacks.onReasoning?.(reasoningContent);

              // If we were buffering potential tags, they are likely just text now if native field is used
              if (parsableBuffer) {
                if (insideThinkingBlock) {
                  reasoningText += parsableBuffer;
                  callbacks.onReasoning?.(parsableBuffer);
                } else {
                  fullText += parsableBuffer;
                  callbacks.onToken?.(parsableBuffer);
                }
                parsableBuffer = "";
              }
              continue;
            }

            // 2. Handle content with tag parsing
            if (chunk.message?.content) {
              let content = chunk.message.content;
              parsableBuffer += content;

              // Process buffer loop to find tags
              while (parsableBuffer.length > 0) {
                if (!insideThinkingBlock) {
                  // Look for START_TAG
                  const tagIndex = parsableBuffer.indexOf(START_TAG);

                  if (tagIndex !== -1) {
                    // Found start tag!
                    const preTag = parsableBuffer.slice(0, tagIndex);
                    if (preTag) {
                      fullText += preTag;
                      callbacks.onToken?.(preTag);
                    }

                    // Switch state
                    insideThinkingBlock = true;
                    parsableBuffer = parsableBuffer.slice(tagIndex + START_TAG.length);
                  } else {
                    // No tag found yet. 
                    // Check if simple text or partial tag at end.
                    // We can safely flush everything EXCEPT the last few chars that might match prefix of START_TAG
                    const bufferLen = parsableBuffer.length;
                    // Optimistic: flush all except potential partial tag
                    // Find largest suffix that matches prefix of START_TAG
                    let safeToFlushLen = bufferLen;

                    for (let i = 1; i < Math.min(bufferLen + 1, MAX_TAG_LEN); i++) {
                      const suffix = parsableBuffer.slice(-i);
                      if (START_TAG.startsWith(suffix)) {
                        safeToFlushLen = bufferLen - i;
                        break; // Keep this suffix
                      }
                    }

                    if (safeToFlushLen > 0) {
                      const toFlush = parsableBuffer.slice(0, safeToFlushLen);
                      fullText += toFlush;
                      callbacks.onToken?.(toFlush);
                      parsableBuffer = parsableBuffer.slice(safeToFlushLen);
                    }
                    break; // Done with this chunk until more data
                  }
                } else {
                  // Inside thinking block. Look for END_TAG
                  const tagIndex = parsableBuffer.indexOf(END_TAG);

                  if (tagIndex !== -1) {
                    // Found end tag!
                    const thoughtContent = parsableBuffer.slice(0, tagIndex);
                    if (thoughtContent) {
                      reasoningText += thoughtContent;
                      callbacks.onReasoning?.(thoughtContent);
                    }

                    // Switch state
                    insideThinkingBlock = false;
                    parsableBuffer = parsableBuffer.slice(tagIndex + END_TAG.length);
                  } else {
                    // No end tag. Flush to reasoning, keeping potential partial tag.
                    const bufferLen = parsableBuffer.length;
                    let safeToFlushLen = bufferLen;

                    for (let i = 1; i < Math.min(bufferLen + 1, MAX_TAG_LEN); i++) {
                      const suffix = parsableBuffer.slice(-i);
                      if (END_TAG.startsWith(suffix)) {
                        safeToFlushLen = bufferLen - i;
                        break;
                      }
                    }

                    if (safeToFlushLen > 0) {
                      const toFlush = parsableBuffer.slice(0, safeToFlushLen);
                      reasoningText += toFlush;
                      callbacks.onReasoning?.(toFlush);
                      parsableBuffer = parsableBuffer.slice(safeToFlushLen);
                    }
                    break;
                  }
                }
              }
            }

            if (chunk.message?.tool_calls) {
              for (const [callPos, tc] of chunk.message.tool_calls.entries()) {
                const callIndex = typeof tc.index === "number" ? tc.index : callPos;
                const existing = toolCallsMap.get(callIndex) || { args: "" };
                if (tc.function.name) existing.name = tc.function.name;
                if (tc.function.arguments) {
                  if (typeof tc.function.arguments === "string") {
                    existing.args += tc.function.arguments;
                  } else {
                    // Object arguments arrive as a complete payload; replace any previously buffered fragments.
                    existing.args = JSON.stringify(tc.function.arguments);
                  }
                }
                toolCallsMap.set(callIndex, existing);
              }
            }

            if (chunk.done && chunk.prompt_eval_count !== undefined) {
              usage = {
                promptTokens: chunk.prompt_eval_count,
                completionTokens: chunk.eval_count || 0,
                totalTokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
              };
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (err instanceof SyntaxError) {
              console.warn(`[OllamaEngine] JSON parse error: ${err.message}`, { line: line.slice(0, 200) });
            } else {
              console.warn(`[OllamaEngine] Chunk processing error: ${err.message}`, {
                line: line.slice(0, 100),
                stack: err.stack?.split('\n').slice(0, 3).join('\n')
              });
            }
          }
        }
      }

      // Flush remaining buffer on done
      if (parsableBuffer) {
        if (insideThinkingBlock) {
          reasoningText += parsableBuffer;
          callbacks.onReasoning?.(parsableBuffer);
        } else {
          fullText += parsableBuffer;
          callbacks.onToken?.(parsableBuffer);
        }
      }

      // Also flush lineBuffer if any (rare JSON fragment)
      if (lineBuffer.trim()) {
        try {
          const chunk = JSON.parse(lineBuffer) as OllamaStreamChunk;
          if (chunk.message?.content) {
            if (insideThinkingBlock) {
              reasoningText += chunk.message.content;
              callbacks.onReasoning?.(chunk.message.content);
            } else {
              fullText += chunk.message.content;
              callbacks.onToken?.(chunk.message.content);
            }
          }
        } catch { }
      }

      const toolCalls = Array.from(toolCallsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([index, tc]) => ({
          id: `call_${index}`,
          type: "function" as const,
          function: {
            name: tc.name || "unknown",
            arguments: tc.args,
          },
        }));

      const result: ChatResult = {
        text: fullText,
        reasoningText: reasoningText || undefined,
        usage,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      callbacks.onComplete?.(result);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`[OllamaEngine] Stream aborted for task: ${taskId}`);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /** Convert kernel messages to Ollama format */
  private convertMessages(messages: KernelMessage[], systemPrompt?: string): OllamaMessage[] {
    const result: OllamaMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({
        role: "system",
        content: systemPrompt,
      });
    }

    // Convert each message (Ollama receives text only)
    for (const message of messages) {
      const converted = toProviderMessage(message);
      if (!converted) continue;

      if (converted.role === "tool") {
        const toolContent = converted.tool_call_id
          ? `[tool_call_id:${converted.tool_call_id}] ${converted.content as string}`
          : (converted.content as string);
        result.push({
          role: "tool",
          content: toolContent,
        });
        continue;
      }

      if (typeof converted.content === "string") {
        result.push({
          role: converted.role as "user" | "assistant" | "system",
          content: converted.content,
        });
        continue;
      }

      // Fallback for multimodal content: keep only text parts.
      const textOnly = converted.content
        .filter((part): part is Extract<ProviderContentPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (!textOnly) continue;

      result.push({
        role: "user",
        content: textOnly,
      });
    }

    return result;
  }

  /** Estimate context window based on model size */
  private estimateContextWindow(parameterSize: string): number {
    const size = parameterSize.toLowerCase();
    if (size.includes("70b") || size.includes("72b")) return 128000;
    if (size.includes("32b") || size.includes("34b")) return 64000;
    if (size.includes("7b") || size.includes("8b")) return 32000;
    if (size.includes("3b") || size.includes("4b")) return 16000;
    if (size.includes("1b") || size.includes("0.5b")) return 8000;
    return 32000; // Default
  }

  /** Check if model name suggests reasoning capability */
  private isReasoningModel(modelName: string): boolean {
    const name = modelName.toLowerCase();
    return (
      name.includes("deepseek-r1") ||
      name.includes("r1") ||
      name.includes("reasoning") ||
      name.includes("think") ||
      name.includes("cot") || // Chain of Thought
      name.includes("qwq") // Qwen-QwQ
    );
  }

  /**
   * Check if a model is currently loaded in Ollama memory.
   * Uses /api/ps endpoint to check running models.
   */
  override async isModelLoaded(modelId: string): Promise<boolean> {
    try {
      const loaded = await this.getLoadedModels();
      // Match by name (handle variants like "model:latest" vs "model")
      return loaded.some(m =>
        m.name === modelId ||
        m.name === `${modelId}:latest` ||
        m.name.startsWith(`${modelId}:`)
      );
    } catch (error) {
      console.warn(`[OllamaEngine] Failed to check model status:`, error);
      return false;
    }
  }

  /**
   * Get list of models currently loaded in Ollama memory.
   * Uses /api/ps endpoint.
   */
  override async getLoadedModels(): Promise<LoadedModel[]> {
    try {
      const response = await fetch(`${this.getBaseURL()}/api/ps`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.warn(`[OllamaEngine] /api/ps returned ${response.status}`);
        return [];
      }

      const data = (await response.json()) as OllamaProcessResponse;

      return data.models.map(m => ({
        name: m.name,
        size: m.size,
        sizeVram: m.size_vram,
        expiresAt: m.expires_at,
      }));
    } catch (error) {
      console.warn(`[OllamaEngine] Failed to get loaded models:`, error);
      return [];
    }
  }

  /**
   * Preload a model into Ollama memory.
   * Sends an empty chat request to trigger model loading.
   */
  override async preloadModel(modelId: string): Promise<boolean> {
    try {
      console.log(`[OllamaEngine] Preloading model: ${modelId}`);

      const response = await fetch(`${this.getBaseURL()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [],
        }),
        signal: AbortSignal.timeout(MODEL_LOADING_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OllamaEngine] Preload failed: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[OllamaEngine] Model preloaded: ${modelId}`);
      return true;
    } catch (error) {
      console.error(`[OllamaEngine] Preload error:`, error);
      return false;
    }
  }

  override dispose(): void {
    super.dispose();
    this.cachedModels = null;
  }
}

/** Factory function for Ollama engine */
export function createOllamaEngine(): OllamaEngine {
  return new OllamaEngine();
}
