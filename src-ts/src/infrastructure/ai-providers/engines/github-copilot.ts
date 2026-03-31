/**
 * GitHub Copilot Provider Engine - V2 Kernel
 *
 * Implements KernelProviderEngine for GitHub Copilot using OAuth authentication.
 * Uses OpenAI-compatible API with GitHub Copilot-specific headers.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

import type { ModelInfo, ProviderConfig } from "@shared/types";
import type {
  KernelMessage,
  ProviderMessage,
  ProviderContentPart,
} from "@shared/types";
import { toProviderMessage } from "@shared/types";
import type { TaskId, TokenUsage } from "@shared/types";
import {
  BaseProviderEngine,
  type ChatRequest,
  type ChatResult,
  type StreamCallbacks,
  type ProviderStatus,
} from "../engine.ts";

/** GitHub Copilot models - static registry */
const COPILOT_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    providerId: "github-copilot",
    name: "GPT-4o (Copilot)",
    description: "Most capable model via GitHub Copilot",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "gpt-4o-mini",
    providerId: "github-copilot",
    name: "GPT-4o Mini (Copilot)",
    description: "Fast and affordable via GitHub Copilot",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "o3-mini",
    providerId: "github-copilot",
    name: "O3 Mini (Copilot)",
    description: "Reasoning model via GitHub Copilot",
    contextWindow: 128000,
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsReasoning: true,
    },
  },
];

/** Get app version for User-Agent header */
function getVersion(): string {
  return process.env.npm_package_version || "0.0.0";
}

/**
 * GitHub Copilot Provider Engine
 *
 * Uses OAuth token authentication with GitHub Copilot's OpenAI-compatible API.
 */
export class GitHubCopilotEngine extends BaseProviderEngine {
  readonly providerId = "github-copilot" as const;
  readonly name = "GitHub Copilot";
  readonly requiresApiKey = false; // OAuth-only
  readonly defaultBaseURL = "https://api.github.com/copilot";

  private client: OpenAI | null = null;
  private oauthToken: string | null = null;

  override async initialize(config: ProviderConfig): Promise<void> {
    if (!config.oauthToken) {
      throw new Error(
        "[GitHubCopilotEngine] OAuth token required - authenticate via GitHub device code flow first",
      );
    }

    this.oauthToken = config.oauthToken;

    await super.initialize(config);

    this.client = new OpenAI({
      apiKey: config.oauthToken, // Copilot uses OAuth token as API key
      baseURL: config.baseURL || this.defaultBaseURL,
      timeout: config.timeout || 60000,
      maxRetries: 2,
    });

    console.log(
      `[GitHubCopilotEngine] Initialized with baseURL: ${config.baseURL || this.defaultBaseURL}`,
    );
  }

  /**
   * Build headers for GitHub Copilot API requests.
   * Includes required Copilot-specific headers.
   */
  private buildHeaders(isAgent: boolean = false, isVision: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.oauthToken}`,
      "User-Agent": `opencode/${getVersion()}`,
      "x-initiator": isAgent ? "agent" : "user",
      "Openai-Intent": "conversation-edits",
    };

    if (isVision) {
      headers["Copilot-Vision-Request"] = "true";
    }

    return headers;
  }

  async checkStatus(): Promise<ProviderStatus> {
    this.ensureInitialized();

    try {
      // Test token validity by making a lightweight API call
      // Copilot doesn't have a dedicated status endpoint, so we try to list models
      const response = await fetch(`${this.getBaseURL()}/models`, {
        method: "GET",
        headers: this.buildHeaders(),
      });

      if (response.ok) {
        return {
          available: true,
          message: "GitHub Copilot API is available",
          checkedAt: new Date().toISOString(),
        };
      } else if (response.status === 401) {
        return {
          available: false,
          message: "OAuth token invalid or expired",
          errorCode: "auth_failed",
          checkedAt: new Date().toISOString(),
        };
      } else {
        return {
          available: false,
          message: `HTTP ${response.status}: ${response.statusText}`,
          errorCode: "unknown",
          checkedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const errorCode = this.classifyError(error);

      return {
        available: false,
        message,
        errorCode,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /** Classify error into ProviderErrorCode */
  private classifyError(error: unknown): ProviderStatus["errorCode"] {
    if (!(error instanceof Error)) return "unknown";

    const message = error.message.toLowerCase();

    if (message.includes("econnrefused") || message.includes("connection refused")) {
      return "connection_refused";
    }
    if (message.includes("timeout") || message.includes("etimedout")) {
      return "timeout";
    }
    if (message.includes("unauthorized") || message.includes("401")) {
      return "auth_failed";
    }
    if (message.includes("rate limit") || message.includes("429")) {
      return "rate_limited";
    }

    return "unknown";
  }

  async listModels(): Promise<ModelInfo[]> {
    // Return static model list - Copilot doesn't expose dynamic model listing
    return COPILOT_MODELS;
  }

  getModel(modelId: string): ModelInfo | undefined {
    return COPILOT_MODELS.find((m) => m.id === modelId);
  }

  /** Validate model exists and supports required capabilities */
  private validateModel(modelId: string, messages: KernelMessage[]): void {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(
        `Unknown model: ${modelId}. Available: ${COPILOT_MODELS.map((m) => m.id).join(", ")}`,
      );
    }

    // Check for vision requirements
    const hasImages = messages.some((m) => {
      const converted = toProviderMessage(m);
      return Array.isArray(converted?.content) && converted.content.length > 0;
    });

    if (hasImages && !model.capabilities.supportsVision) {
      throw new Error(
        `Model ${model.name} doesn't support vision. Use gpt-4o or gpt-4o-mini for images.`,
      );
    }
  }

  /** Validate generation parameters (fail fast) */
  private validateGenerationParams(request: ChatRequest): void {
    if (
      request.temperature !== undefined &&
      (request.temperature < 0 || request.temperature > 2)
    ) {
      throw new Error(`temperature must be 0-2, got ${request.temperature}`);
    }
    if (request.topP !== undefined && (request.topP < 0 || request.topP > 1)) {
      throw new Error(`topP must be 0-1, got ${request.topP}`);
    }
    if (
      request.presencePenalty !== undefined &&
      (request.presencePenalty < -2 || request.presencePenalty > 2)
    ) {
      throw new Error(
        `presencePenalty must be -2 to 2, got ${request.presencePenalty}`,
      );
    }
    if (
      request.frequencyPenalty !== undefined &&
      (request.frequencyPenalty < -2 || request.frequencyPenalty > 2)
    ) {
      throw new Error(
        `frequencyPenalty must be -2 to 2, got ${request.frequencyPenalty}`,
      );
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.ensureInitialized();
    this.validateModel(request.model, request.messages);
    this.validateGenerationParams(request);

    console.log(
      `[GitHubCopilotEngine] Chat request - model: ${request.model}, messages: ${request.messages.length}`,
    );

    const controller = this.createAbortController(
      request.taskId,
      request.signal,
    );

    try {
      const messages = await this.convertMessages(
        request.messages,
        request.systemPrompt,
      );

      // Validate and map tools
      const validatedTools = request.tools?.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

      // Determine if this is a vision request
      const isVision = request.messages.some((m) => {
        const converted = toProviderMessage(m);
        return Array.isArray(converted?.content);
      });

      const response = await this.client!.chat.completions.create(
        {
          model: request.model,
          messages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          top_p: request.topP,
          presence_penalty: request.presencePenalty,
          frequency_penalty: request.frequencyPenalty,
          stop: request.stop,
          seed: request.seed,
          response_format: request.responseFormat,
          tools: validatedTools,
          tool_choice: request.toolChoice,
        },
        {
          signal: controller.signal,
          headers: this.buildHeaders(false, isVision),
        },
      );

      // Validate response has choices
      if (!response.choices || response.choices.length === 0) {
        throw new Error("[GitHubCopilotEngine] No choices in API response");
      }

      const choice = response.choices[0];
      const text = choice?.message?.content || "";

      // Extract reasoning for O3 models
      const reasoningText = this.extractReasoning(choice);

      // Extract tool calls
      const toolCalls = choice?.message?.tool_calls
        ?.filter(
          (tc): tc is ChatCompletionMessageFunctionToolCall =>
            tc.type === "function",
        )
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));

      const usage: TokenUsage | undefined =
        response.usage &&
        typeof response.usage.prompt_tokens === "number" &&
        typeof response.usage.completion_tokens === "number" &&
        typeof response.usage.total_tokens === "number"
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined;

      return {
        text,
        reasoningText,
        usage,
        finishReason: this.mapFinishReason(choice?.finish_reason),
        toolCalls,
        systemFingerprint: response.system_fingerprint,
      };
    } catch (error) {
      console.error(
        `[GitHubCopilotEngine] Chat failed - model: ${request.model}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

  async stream(
    request: ChatRequest,
    callbacks: StreamCallbacks,
  ): Promise<ChatResult> {
    this.ensureInitialized();
    this.validateModel(request.model, request.messages);
    this.validateGenerationParams(request);

    console.log(
      `[GitHubCopilotEngine] Stream request - model: ${request.model}, messages: ${request.messages.length}`,
    );

    const controller = this.createAbortController(
      request.taskId,
      request.signal,
    );

    try {
      const messages = await this.convertMessages(
        request.messages,
        request.systemPrompt,
      );

      // Validate and map tools
      const validatedTools = request.tools?.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

      // Determine if this is a vision request
      const isVision = request.messages.some((m) => {
        const converted = toProviderMessage(m);
        return Array.isArray(converted?.content);
      });

      const stream = await this.client!.chat.completions.create(
        {
          model: request.model,
          messages,
          stream: true,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          top_p: request.topP,
          presence_penalty: request.presencePenalty,
          frequency_penalty: request.frequencyPenalty,
          stop: request.stop,
          seed: request.seed,
          response_format: request.responseFormat,
          tools: validatedTools,
          tool_choice: request.toolChoice,
        },
        {
          signal: controller.signal,
          headers: this.buildHeaders(false, isVision),
        },
      );

      return await this.processStream(request.taskId, stream, callbacks);
    } catch (error) {
      console.error(
        `[GitHubCopilotEngine] Stream failed - model: ${request.model}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(err);
      throw err;
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

  /** Process streaming response */
  private async processStream(
    taskId: TaskId,
    stream: Stream<ChatCompletionChunk>,
    callbacks: StreamCallbacks,
  ): Promise<ChatResult> {
    let fullText = "";
    let reasoningText = "";
    let finishReason: ChatResult["finishReason"];
    let usage: TokenUsage | undefined;
    let systemFingerprint: string | undefined;
    const toolCallsMap = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Handle content delta
        if (delta.content) {
          fullText += delta.content;
          callbacks.onToken?.(delta.content);
        }

        // Handle tool call deltas
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const idx = toolCall.index;
            if (typeof idx !== "number") {
              console.warn(`[GitHubCopilotEngine] Invalid tool call index: ${idx}`);
              continue;
            }

            const existing = toolCallsMap.get(idx) || { args: "" };

            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name = toolCall.function.name;
            if (
              toolCall.function?.arguments &&
              typeof toolCall.function.arguments === "string"
            ) {
              existing.args += toolCall.function.arguments;
            }

            toolCallsMap.set(idx, existing);
          }
        }

        // Handle reasoning
        const reasoning = this.extractReasoningFromDelta(delta);
        if (reasoning) {
          reasoningText += reasoning;
          callbacks.onReasoning?.(reasoning);
        }

        // Capture finish reason
        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }

        // Capture usage from final chunk
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }

        // Capture system fingerprint
        if (chunk.system_fingerprint) {
          systemFingerprint = chunk.system_fingerprint;
        }
      }

      // Convert accumulated tool calls to final format
      const toolCalls = Array.from(toolCallsMap.values())
        .filter((tc) => {
          if (!tc.id || !tc.name) return false;
          try {
            if (tc.args) JSON.parse(tc.args);
            return true;
          } catch {
            console.warn(
              `[GitHubCopilotEngine] Invalid tool call JSON arguments for ${tc.name}`,
            );
            return false;
          }
        })
        .map((tc) => ({
          id: tc.id!,
          type: "function" as const,
          function: {
            name: tc.name!,
            arguments: tc.args,
          },
        }));

      const result: ChatResult = {
        text: fullText,
        reasoningText: reasoningText || undefined,
        usage,
        finishReason,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        systemFingerprint,
      };

      callbacks.onComplete?.(result);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`[GitHubCopilotEngine] Stream aborted for task: ${taskId}`);
        callbacks.onAbort?.({
          text: fullText,
          reasoningText: reasoningText || undefined,
        });
      }
      throw error;
    }
  }

  /** Convert kernel messages to OpenAI format */
  private async convertMessages(
    messages: KernelMessage[],
    systemPrompt?: string,
  ): Promise<ChatCompletionMessageParam[]> {
    const result: ChatCompletionMessageParam[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({
        role: "system",
        content: systemPrompt,
      });
    }

    // Convert each message
    for (const message of messages) {
      const converted = toProviderMessage(message);
      if (!converted) {
        console.warn(
          `[GitHubCopilotEngine] Message ${message.id} filtered: no text/image content`,
        );
        continue;
      }

      if (converted.role === "tool") {
        result.push({
          role: "tool",
          content: converted.content as string,
          tool_call_id: converted.tool_call_id!,
        });
      } else if (typeof converted.content === "string") {
        result.push({
          role: converted.role as "user" | "assistant" | "system",
          content: converted.content,
        });
      } else {
        // Multimodal message
        const contentParts = await Promise.all(
          converted.content.map(async (part, idx) => {
            try {
              return await this.convertContentPart(part);
            } catch (error) {
              throw new Error(
                `Content part ${idx} failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }),
        );
        result.push({
          role: "user",
          content: contentParts,
        });
      }
    }

    return result;
  }

  /** Convert content part to OpenAI format */
  private async convertContentPart(
    part: ProviderContentPart,
  ): Promise<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "auto" } }
  > {
    if (part.type === "text") {
      if (!part.text || typeof part.text !== "string") {
        throw new Error("Text content part missing text field");
      }
      return { type: "text", text: part.text };
    }

    // Image part
    if (!part.image || typeof part.image !== "string") {
      throw new Error("Image content part missing image field");
    }

    // Validate format
    this.validateImageFormat(part.image);

    let imageUrl: string;
    if (part.image.startsWith("data:")) {
      imageUrl = part.image;
    } else if (
      part.image.startsWith("http://") ||
      part.image.startsWith("https://")
    ) {
      imageUrl = part.image;
    } else {
      // Assume base64 without prefix
      imageUrl = `data:image/jpeg;base64,${part.image}`;
    }

    return {
      type: "image_url",
      image_url: {
        url: imageUrl,
        detail: "auto",
      },
    };
  }

  /** Validate image format */
  private validateImageFormat(image: string): void {
    if (image.startsWith("data:")) {
      if (!image.match(/^data:image\/(jpeg|png|gif|webp);base64,/)) {
        throw new Error(
          "Invalid data URI: must be data:image/<type>;base64,...",
        );
      }
    } else if (image.startsWith("http://") || image.startsWith("https://")) {
      try {
        new URL(image);
      } catch {
        throw new Error("Invalid image URL");
      }
    } else {
      // Assume base64 string
      if (!image.match(/^[A-Za-z0-9+/]*={0,2}$/)) {
        throw new Error("Invalid base64 string");
      }
    }
  }

  /** Extract reasoning from completion choice */
  private extractReasoning(choice: any | undefined): string | undefined {
    if (!choice?.message) return undefined;

    if (
      choice.message.reasoning &&
      typeof choice.message.reasoning === "string"
    ) {
      return choice.message.reasoning;
    }

    if (
      choice.message.reasoning_content &&
      typeof choice.message.reasoning_content === "string"
    ) {
      return choice.message.reasoning_content;
    }

    if (
      choice.message.thoughts &&
      typeof choice.message.thoughts === "string"
    ) {
      return choice.message.thoughts;
    }

    return undefined;
  }

  /** Extract reasoning from streaming delta */
  private extractReasoningFromDelta(delta: any): string | undefined {
    if (!delta) return undefined;

    if (delta.reasoning && typeof delta.reasoning === "string") {
      return delta.reasoning;
    }

    if (
      delta.reasoning_content &&
      typeof delta.reasoning_content === "string"
    ) {
      return delta.reasoning_content;
    }

    if (delta.thoughts && typeof delta.thoughts === "string") {
      return delta.thoughts;
    }

    return undefined;
  }

  /** Map OpenAI finish reason to our format */
  private mapFinishReason(
    reason: string | null | undefined,
  ): ChatResult["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
        return "tool_calls";
      default:
        return undefined;
    }
  }

  override dispose(): void {
    super.dispose();
    this.client = null;
    this.oauthToken = null;
  }
}

/** Factory function for GitHub Copilot engine */
export function createGitHubCopilotEngine(): GitHubCopilotEngine {
  return new GitHubCopilotEngine();
}
