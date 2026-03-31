/**
 * OpenRouter Provider Engine - V2 Kernel
 *
 * Implements KernelProviderEngine using OpenAI-compatible API via OpenAI SDK.
 * Supports OpenRouter model routing and streaming.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

import type { ModelInfo, ProviderConfig } from "@shared/types";
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
} from "../engine.ts";

/** OpenRouter models from static registry */
const OPENROUTER_MODELS = MODELS.filter((m) => m.providerId === "openrouter");

/** OpenRouter models response */
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    description?: string;
    context_length?: number;
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
    supported_features?: string[];
    supported_parameters?: string[];
    top_provider?: {
      context_length?: number;
    };
  }>;
}

/**
 * OpenRouter Provider Engine
 *
 * Uses OpenAI SDK with OpenRouter base URL and optional attribution headers.
 */
export class OpenRouterEngine extends BaseProviderEngine {
  readonly providerId = "openrouter" as const;
  readonly name = "OpenRouter";
  readonly requiresApiKey = true;
  readonly defaultBaseURL = "https://openrouter.ai/api/v1";

  private client: OpenAI | null = null;
  private apiKey: string | null = null;
  private appUrl?: string;
  private appTitle?: string;

  private cachedModels: ModelInfo[] | null = null;
  private modelsCacheTime = 0;
  private readonly MODEL_CACHE_TTL = 60000;

  override async initialize(config: ProviderConfig): Promise<void> {
    const apiKey = config.apiKey !== undefined ? config.apiKey : process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[OpenRouterEngine] API key required - set OPENROUTER_API_KEY or configure provider API key",
      );
    }

    this.appUrl = config.appUrl || process.env.OPENROUTER_APP_URL;
    this.appTitle = config.appTitle || process.env.OPENROUTER_APP_TITLE;

    await super.initialize(config);

    const defaultHeaders: Record<string, string> = {};
    if (this.appUrl) {
      defaultHeaders["HTTP-Referer"] = this.appUrl;
    }
    if (this.appTitle) {
      defaultHeaders["X-Title"] = this.appTitle;
    }

    this.apiKey = apiKey;
    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseURL || this.defaultBaseURL,
      timeout: config.timeout || 60000,
      maxRetries: 2,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });

    console.log(
      `[OpenRouterEngine] Initialized with baseURL: ${config.baseURL || this.defaultBaseURL}`,
    );
  }

  async checkStatus(): Promise<ProviderStatus> {
    this.ensureInitialized();

    try {
      await this.listModels();
      return {
        available: true,
        message: "OpenRouter API is available",
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        available: false,
        message: error instanceof Error ? error.message : "Unknown error",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.cachedModels && Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    if (!this.apiKey) {
      this.cachedModels = OPENROUTER_MODELS;
      this.modelsCacheTime = Date.now();
      return OPENROUTER_MODELS;
    }

    try {
      const response = await fetch(`${this.getBaseURL()}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(this.appUrl ? { "HTTP-Referer": this.appUrl } : {}),
          ...(this.appTitle ? { "X-Title": this.appTitle } : {}),
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[OpenRouterEngine] Failed to fetch models: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as OpenRouterModelsResponse;
      const dynamicModels = (data.data || []).map((model) => {
        const inputModalities = model.architecture?.input_modalities ?? [];
        const supportsVision = inputModalities.includes("image");
        const supportsReasoning = model.supported_features?.includes("reasoning") ?? false;

        return {
          id: model.id,
          providerId: "openrouter",
          name: model.name || model.id,
          description: model.description || model.id,
          contextWindow:
            model.context_length ||
            model.top_provider?.context_length ||
            128000,
          capabilities: {
            supportsVision,
            supportsStreaming: true,
            supportsReasoning,
          },
        } satisfies ModelInfo;
      });

      const mergedModels = [...OPENROUTER_MODELS];
      for (const model of dynamicModels) {
        if (!mergedModels.find((m) => m.id === model.id)) {
          mergedModels.push(model);
        }
      }

      this.cachedModels = mergedModels;
      this.modelsCacheTime = Date.now();
      return mergedModels;
    } catch (error) {
      console.warn(
        `[OpenRouterEngine] Failed to fetch models, using static list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.cachedModels = OPENROUTER_MODELS;
      this.modelsCacheTime = Date.now();
      return OPENROUTER_MODELS;
    }
  }

  getModel(modelId: string): ModelInfo | undefined {
    return this.cachedModels?.find((m) => m.id === modelId) ||
      OPENROUTER_MODELS.find((m) => m.id === modelId);
  }

  private validateModel(modelId: string, messages: KernelMessage[]): void {
    const model = this.getModel(modelId);
    if (!model) {
      return;
    }

    const hasImages = messages.some((m) => {
      const converted = toProviderMessage(m);
      return Array.isArray(converted?.content) && converted.content.length > 0;
    });

    if (hasImages && !model.capabilities.supportsVision) {
      throw new Error(`Model ${model.name} doesn't support vision.`);
    }
  }

  private validateImageFormat(image: string): void {
    if (image.startsWith("data:")) {
      if (!image.match(/^data:image\/(jpeg|png|gif|webp);base64,/)) {
        throw new Error("Invalid data URI: must be data:image/<type>;base64,...");
      }
    } else if (image.startsWith("http://") || image.startsWith("https://")) {
      try {
        new URL(image);
      } catch {
        throw new Error("Invalid image URL");
      }
    } else if (!image.match(/^[A-Za-z0-9+/]*={0,2}$/)) {
      throw new Error("Invalid base64 string");
    }
  }

  private validateGenerationParams(request: ChatRequest): void {
    if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 2)) {
      throw new Error(`temperature must be 0-2, got ${request.temperature}`);
    }
    if (request.topP !== undefined && (request.topP < 0 || request.topP > 1)) {
      throw new Error(`topP must be 0-1, got ${request.topP}`);
    }
    if (request.presencePenalty !== undefined && (request.presencePenalty < -2 || request.presencePenalty > 2)) {
      throw new Error(`presencePenalty must be -2 to 2, got ${request.presencePenalty}`);
    }
    if (request.frequencyPenalty !== undefined && (request.frequencyPenalty < -2 || request.frequencyPenalty > 2)) {
      throw new Error(`frequencyPenalty must be -2 to 2, got ${request.frequencyPenalty}`);
    }
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.ensureInitialized();
    this.validateModel(request.model, request.messages);
    this.validateGenerationParams(request);

    const controller = this.createAbortController(request.taskId, request.signal);

    try {
      const messages = await this.convertMessages(request.messages, request.systemPrompt);
      const validatedTools = request.tools?.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

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
        { signal: controller.signal },
      );

      if (!response.choices || response.choices.length === 0) {
        throw new Error("[OpenRouterEngine] No choices in API response");
      }

      const choice = response.choices[0];
      const text = choice?.message?.content || "";

      const reasoningText = this.extractReasoning(choice);

      const toolCalls = choice?.message?.tool_calls
        ?.filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));

      const usage: TokenUsage | undefined = response.usage &&
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
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

  async stream(request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> {
    this.ensureInitialized();
    this.validateModel(request.model, request.messages);
    this.validateGenerationParams(request);

    const controller = this.createAbortController(request.taskId, request.signal);

    try {
      const messages = await this.convertMessages(request.messages, request.systemPrompt);
      const validatedTools = request.tools?.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

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
        { signal: controller.signal },
      );

      return await this.processStream(request.taskId, stream, callbacks);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(err);
      throw err;
    } finally {
      this.cleanupRequest(request.taskId);
    }
  }

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
    const toolCallsMap = new Map<number, { id?: string; name?: string; args: string }>();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          fullText += delta.content;
          callbacks.onToken?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const idx = toolCall.index;
            if (typeof idx !== "number") {
              continue;
            }

            const existing = toolCallsMap.get(idx) || { args: "" };

            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function?.name) existing.name = toolCall.function.name;
            if (toolCall.function?.arguments && typeof toolCall.function.arguments === "string") {
              existing.args += toolCall.function.arguments;
            }

            toolCallsMap.set(idx, existing);
          }
        }

        const reasoning = this.extractReasoningFromDelta(delta);
        if (reasoning) {
          reasoningText += reasoning;
          callbacks.onReasoning?.(reasoning);
        }

        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }

        if (chunk.system_fingerprint) {
          systemFingerprint = chunk.system_fingerprint;
        }
      }

      const toolCalls = Array.from(toolCallsMap.values())
        .filter((tc) => {
          if (!tc.id || !tc.name) return false;
          try {
            if (tc.args) JSON.parse(tc.args);
            return true;
          } catch {
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
        callbacks.onAbort?.({ text: fullText, reasoningText: reasoningText || undefined });
      }
      throw error;
    }
  }

  private async convertMessages(
    messages: KernelMessage[],
    systemPrompt?: string,
  ): Promise<ChatCompletionMessageParam[]> {
    const result: ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      result.push({
        role: "system",
        content: systemPrompt,
      });
    }

    for (const message of messages) {
      const converted = toProviderMessage(message);
      if (!converted) {
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

  private async convertContentPart(
    part: ProviderContentPart,
  ): Promise<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }> {
    if (part.type === "text") {
      if (!part.text || typeof part.text !== "string") {
        throw new Error("Text content part missing text field");
      }
      return { type: "text", text: part.text };
    }

    if (!part.image || typeof part.image !== "string") {
      throw new Error("Image content part missing image field");
    }

    this.validateImageFormat(part.image);

    let imageUrl: string;
    if (part.image.startsWith("data:")) {
      imageUrl = part.image;
    } else if (part.image.startsWith("http://") || part.image.startsWith("https://")) {
      imageUrl = part.image;
    } else {
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

  private extractReasoning(choice: any | undefined): string | undefined {
    if (!choice?.message) return undefined;

    if (choice.message.reasoning && typeof choice.message.reasoning === "string") {
      return choice.message.reasoning;
    }

    if (choice.message.reasoning_content && typeof choice.message.reasoning_content === "string") {
      return choice.message.reasoning_content;
    }

    if (choice.message.thoughts && typeof choice.message.thoughts === "string") {
      return choice.message.thoughts;
    }

    if (Array.isArray(choice.message.content)) {
      for (const block of choice.message.content) {
        if (block.type === "reasoning" && block.text) {
          return block.text;
        }
      }
    }

    return undefined;
  }

  private extractReasoningFromDelta(delta: any): string | undefined {
    if (!delta) return undefined;

    if (delta.reasoning && typeof delta.reasoning === "string") {
      return delta.reasoning;
    }

    if (delta.reasoning_content && typeof delta.reasoning_content === "string") {
      return delta.reasoning_content;
    }

    if (delta.thoughts && typeof delta.thoughts === "string") {
      return delta.thoughts;
    }

    if (Array.isArray(delta.content)) {
      for (const block of delta.content) {
        if (block.type === "reasoning" && block.text) {
          return block.text;
        }
      }
    }

    return undefined;
  }

  private mapFinishReason(reason: string | null | undefined): ChatResult["finishReason"] {
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
    this.apiKey = null;
  }
}

export function createOpenRouterEngine(): OpenRouterEngine {
  return new OpenRouterEngine();
}
