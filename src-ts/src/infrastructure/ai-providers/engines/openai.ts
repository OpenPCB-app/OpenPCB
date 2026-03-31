/**
 * OpenAI Provider Engine - V2 Kernel
 *
 * Implements KernelProviderEngine using official OpenAI SDK.
 * Supports GPT-4o, GPT-4o-mini, O3-mini (reasoning), etc.
 */

// 🔑 HARDCODED API KEY - Replace with your OpenAI API key for quick testing
// Example: const HARDCODED_OPENAI_API_KEY = "sk-proj-...";
// This overrides environment variable for development convenience
const HARDCODED_OPENAI_API_KEY = "PUT_YOUR_OPENAI_API_KEY_HERE";

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

import type { ModelInfo, ProviderConfig } from "@shared/types";
import { MODELS } from "@shared/types";
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

/** OpenAI models from static registry */
const OPENAI_MODELS = MODELS.filter((m) => m.providerId === "openai");

/**
 * OpenAI Provider Engine
 *
 * Uses official OpenAI SDK for chat completions.
 */
export class OpenAIEngine extends BaseProviderEngine {
  readonly providerId = "openai" as const;
  readonly name = "OpenAI";
  readonly requiresApiKey = true;
  readonly defaultBaseURL = "https://api.openai.com/v1";

  private client: OpenAI | null = null;

  // Model cache (TTL-based like Ollama)
  private cachedModels: ModelInfo[] | null = null;
  private modelsCacheTime = 0;
  private readonly MODEL_CACHE_TTL = 60000; // 1 minute

  override async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Check for OAuth token first (Codex authentication)
    if (config.oauthToken) {
      const headers: Record<string, string> = {};
      if (config.oauthAccountId) {
        headers["ChatGPT-Account-ID"] = config.oauthAccountId;
      }

      this.client = new OpenAI({
        apiKey: config.oauthToken,
        baseURL: config.baseURL || this.defaultBaseURL,
        timeout: config.timeout || 60000,
        maxRetries: 2,
        defaultHeaders: Object.keys(headers).length > 0 ? headers : undefined,
      });

      console.log(
        `[OpenAIEngine] Initialized with OAuth token, baseURL: ${config.baseURL || this.defaultBaseURL}`,
      );
      if (config.oauthAccountId) {
        console.log(
          `[OpenAIEngine] Using ChatGPT-Account-ID: ${config.oauthAccountId}`,
        );
      }
      return;
    }

    // Fall back to API key authentication
    const configApiKey =
      typeof config.apiKey === "string" ? config.apiKey.trim() : config.apiKey;
    const apiKey =
      (HARDCODED_OPENAI_API_KEY as string) !== "PUT_YOUR_OPENAI_API_KEY_HERE"
        ? HARDCODED_OPENAI_API_KEY
        : configApiKey || process.env.OPENAI_API_KEY;

    // Validate API key (fail fast)
    if (!apiKey) {
      throw new Error(
        "[OpenAIEngine] API key required - set HARDCODED_OPENAI_API_KEY in openai.ts or OPENAI_API_KEY environment variable",
      );
    }

    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: config.baseURL || this.defaultBaseURL,
      timeout: config.timeout || 60000,
      maxRetries: 2,
    });

    console.log(
      `[OpenAIEngine] Initialized with baseURL: ${config.baseURL || this.defaultBaseURL}, timeout: ${config.timeout || 60000}ms`,
    );
    console.log(
      `[OpenAIEngine] API key source: ${(HARDCODED_OPENAI_API_KEY as string) !== "PUT_YOUR_OPENAI_API_KEY_HERE" ? "hardcoded" : configApiKey ? "config" : "env"}`,
    );
  }

  async checkStatus(): Promise<ProviderStatus> {
    this.ensureInitialized();

    try {
      // Simple models list call to verify connectivity
      await this.client!.models.list();

      const authMethod = this.config.oauthToken ? "OAuth" : "API key";

      return {
        available: true,
        message: `OpenAI API is available (authenticated via ${authMethod})`,
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
    // Return cached if fresh
    if (
      this.cachedModels &&
      Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL
    ) {
      return this.cachedModels;
    }

    // Fetch dynamic models from OpenAI API
    try {
      this.ensureInitialized();
      const apiModels = await this.client!.models.list();

      // Filter for chat models only, merge with static capabilities
      const dynamicModels: ModelInfo[] = [];
      for await (const model of apiModels) {
        // Only include chat models (exclude whisper, tts, dall-e, etc.)
        if (
          !model.id.includes("whisper") &&
          !model.id.includes("tts") &&
          !model.id.includes("dall-e")
        ) {
          // Find matching static model for capabilities
          const staticModel = OPENAI_MODELS.find((m) => m.id === model.id);

          if (staticModel) {
            // Use static model with capabilities
            dynamicModels.push(staticModel);
          } else {
            // New model not in static list - create basic entry
            dynamicModels.push({
              id: model.id,
              name: model.id,
              providerId: "openai",
              description: model.id,
              contextWindow: 128000, // Default assumption for newer models
              capabilities: {
                supportsVision: false,
                supportsStreaming: true,
                supportsReasoning: this.supportsReasoning(model.id),
              },
            });
          }
        }
      }

      // Cache and return
      this.cachedModels = dynamicModels;
      this.modelsCacheTime = Date.now();
      return dynamicModels;
    } catch (error) {
      console.warn(
        `[OpenAIEngine] Failed to fetch models from API, using static list: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fallback to static list
      this.cachedModels = OPENAI_MODELS;
      this.modelsCacheTime = Date.now();
      return OPENAI_MODELS;
    }
  }

  /** Check if model supports reasoning based on ID */
  private supportsReasoning(modelId: string): boolean {
    return (
      modelId.includes("o1") ||
      modelId.includes("o3") ||
      modelId.includes("gpt-5") ||
      parseInt(modelId.match(/gpt-(\d+)/)?.[1] || "0") >= 5
    );
  }

  getModel(modelId: string): ModelInfo | undefined {
    if (this.cachedModels) {
      const dynamicModel = this.cachedModels.find((m) => m.id === modelId);
      if (dynamicModel) return dynamicModel;
    }
    return OPENAI_MODELS.find((m) => m.id === modelId);
  }

  /** Validate model exists and supports required capabilities */
  private validateModel(modelId: string, messages: KernelMessage[]): void {
    const model = this.getModel(modelId);
    if (!model) {
      const availableModels = this.cachedModels ?? OPENAI_MODELS;
      throw new Error(
        `Unknown model: ${modelId}. Available: ${availableModels.map((m) => m.id).join(", ")}`,
      );
    }

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

  /** Validate image format with proper validation */
  private validateImageFormat(image: string): void {
    if (image.startsWith("data:")) {
      // Validate data URI format
      if (!image.match(/^data:image\/(jpeg|png|gif|webp);base64,/)) {
        throw new Error(
          "Invalid data URI: must be data:image/<type>;base64,...",
        );
      }
    } else if (image.startsWith("http://") || image.startsWith("https://")) {
      // Validate URL format
      try {
        new URL(image);
      } catch {
        throw new Error("Invalid image URL");
      }
    } else {
      // Assume base64 string - validate format
      if (!image.match(/^[A-Za-z0-9+/]*={0,2}$/)) {
        throw new Error("Invalid base64 string");
      }
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

  /** Compress image if > maxBytes (20MB) */
  private async compressImage(
    imageData: string,
    maxBytes: number = 20 * 1024 * 1024,
  ): Promise<string> {
    // If data URI, extract base64
    const base64 = imageData.startsWith("data:")
      ? imageData.split(",")[1] || ""
      : imageData;

    // Check current size (calculate from base64 string length accounting for padding)
    // Base64 encoding: 4 chars = 3 bytes, so actual size = (length * 3) / 4 - padding
    const padding = (base64.match(/=/g) || []).length;
    const currentBytes = Math.floor((base64.length * 3) / 4) - padding;

    if (currentBytes <= maxBytes) {
      return imageData; // Already under limit
    }

    console.warn(
      `[OpenAIEngine] Image size ${(currentBytes / 1024 / 1024).toFixed(1)}MB exceeds ${(maxBytes / 1024 / 1024).toFixed(1)}MB, compressing...`,
    );

    // TODO: Implement Automatic Image Compression
    //
    // Current behavior: Throws error when image exceeds 20MB
    // Future behavior: Auto-compress using sharp library
    //
    // Implementation plan:
    // 1. Install sharp: `bun add sharp` (native image processing library)
    // 2. Import: `import sharp from 'sharp'`
    // 3. Decode base64 to buffer
    // 4. Compress with smart resizing + quality adjustment
    // 5. Re-encode to base64 and return
    //
    // Example implementation:
    /*
    import sharp from 'sharp';

    const buffer = Buffer.from(base64, 'base64');

    // Determine target size based on how much we need to reduce
    const targetBytes = Math.floor(maxBytes * 0.9); // 90% of limit for safety margin
    const compressionRatio = targetBytes / currentBytes;

    // Start with aggressive settings if image is way over limit
    let quality = compressionRatio < 0.5 ? 60 : 80;
    let maxWidth = compressionRatio < 0.3 ? 1000 : 2000;

    const compressed = await sharp(buffer)
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: 'inside'
      })
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true // Use mozjpeg for better compression
      })
      .toBuffer();

    const compressedSize = compressed.length;

    // If still too large, try more aggressive compression
    if (compressedSize > maxBytes) {
      const secondPass = await sharp(compressed)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg({ quality: 50, mozjpeg: true })
        .toBuffer();

      if (secondPass.length > maxBytes) {
        throw new Error(
          `Image compression failed: even after aggressive compression, ` +
          `size is ${(secondPass.length / 1024 / 1024).toFixed(1)}MB (limit: ${(maxBytes / 1024 / 1024).toFixed(1)}MB). ` +
          `Please use a smaller image.`
        );
      }

      return `data:image/jpeg;base64,${secondPass.toString('base64')}`;
    }

    console.log(
      `[OpenAIEngine] Compressed image from ${(currentBytes / 1024 / 1024).toFixed(1)}MB ` +
      `to ${(compressedSize / 1024 / 1024).toFixed(1)}MB`
    );

    return `data:image/jpeg;base64,${compressed.toString('base64')}`;
    */

    // For now, throw error suggesting manual compression
    throw new Error(
      `Image size ${(currentBytes / 1024 / 1024).toFixed(1)}MB exceeds ${(maxBytes / 1024 / 1024).toFixed(1)}MB limit. ` +
        `Please resize/compress the image before sending. Auto-compression coming in future version.`,
    );
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.ensureInitialized();
    this.validateModel(request.model, request.messages);
    this.validateGenerationParams(request);

    console.log(
      `[OpenAIEngine] Chat request - model: ${request.model}, messages: ${request.messages.length}, maxTokens: ${request.maxTokens || "default"}, temp: ${request.temperature || 1}`,
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

      // Validate and map tools properly (no type cast)
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

      // Validate response has choices
      if (!response.choices || response.choices.length === 0) {
        throw new Error("[OpenAIEngine] No choices in API response");
      }

      const choice = response.choices[0];
      const text = choice?.message?.content || "";

      // Extract reasoning for O1/O3 models (if available in response)
      const reasoningText = this.extractReasoning(choice);

      // Extract tool calls from response (filter for function type only with type guard)
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
        `[OpenAIEngine] Chat failed - model: ${request.model}, error: ${error instanceof Error ? error.message : String(error)}`,
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
      `[OpenAIEngine] Stream request - model: ${request.model}, messages: ${request.messages.length}, maxTokens: ${request.maxTokens || "default"}, temp: ${request.temperature || 1}`,
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

      // Validate and map tools properly (no type cast)
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
      console.error(
        `[OpenAIEngine] Stream failed - model: ${request.model}, error: ${error instanceof Error ? error.message : String(error)}`,
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
              console.warn(`[OpenAIEngine] Invalid tool call index: ${idx}`);
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

        // Handle reasoning (for O1/O3 models - check for reasoning in delta)
        // Note: OpenAI's reasoning output format may vary
        const reasoning = this.extractReasoningFromDelta(delta);
        if (reasoning) {
          reasoningText += reasoning;
          callbacks.onReasoning?.(reasoning);
        }

        // Capture finish reason
        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }

        // Capture usage from final chunk (if present)
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }

        // Capture system fingerprint if present
        if (chunk.system_fingerprint) {
          systemFingerprint = chunk.system_fingerprint;
        }
      }

      // Convert accumulated tool calls to final format (with JSON validation)
      const toolCalls = Array.from(toolCallsMap.values())
        .filter((tc) => {
          if (!tc.id || !tc.name) return false;
          try {
            if (tc.args) JSON.parse(tc.args);
            return true;
          } catch {
            console.warn(
              `[OpenAIEngine] Invalid tool call JSON arguments for ${tc.name}`,
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
        console.log(`[OpenAIEngine] Stream aborted for task: ${taskId}`);
        // Call onAbort with partial data
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
          `[OpenAIEngine] Message ${message.id} filtered: no text/image content ` +
            `(reasoning-only or empty message)`,
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
          role: converted.role,
          content: converted.content,
        } as any);
      } else {
        // Multimodal message - await conversion (with error context)
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

    // Image part - validate required field
    if (!part.image || typeof part.image !== "string") {
      throw new Error("Image content part missing image field");
    }

    // Validate format (with error context)
    try {
      this.validateImageFormat(part.image);
    } catch (error) {
      throw new Error(
        `Image validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Compress if needed (only for base64/data URIs)
    let processedImage = part.image;
    if (
      !part.image.startsWith("http://") &&
      !part.image.startsWith("https://")
    ) {
      processedImage = await this.compressImage(part.image);
    }

    let imageUrl: string;
    if (processedImage.startsWith("data:")) {
      // Already data URI
      imageUrl = processedImage;
    } else if (
      processedImage.startsWith("http://") ||
      processedImage.startsWith("https://")
    ) {
      // HTTP URL
      imageUrl = processedImage;
    } else {
      // Assume base64 without prefix
      imageUrl = `data:image/jpeg;base64,${processedImage}`;
    }

    return {
      type: "image_url",
      image_url: {
        url: imageUrl,
        detail: "auto", // Hardcoded as per user decision
      },
    };
  }

  /** Extract reasoning from completion choice (GPT-5+ support) */
  private extractReasoning(choice: any | undefined): string | undefined {
    if (!choice?.message) return undefined;

    // Check for reasoning fields in priority order

    // 1. Standard reasoning field (if OpenAI adds it)
    if (
      choice.message.reasoning &&
      typeof choice.message.reasoning === "string"
    ) {
      return choice.message.reasoning;
    }

    // 2. DeepSeek/Qwen "reasoning_content"
    if (
      choice.message.reasoning_content &&
      typeof choice.message.reasoning_content === "string"
    ) {
      return choice.message.reasoning_content;
    }

    // 3. Thoughts field (alternative name)
    if (
      choice.message.thoughts &&
      typeof choice.message.thoughts === "string"
    ) {
      return choice.message.thoughts;
    }

    // 4. Check for special content blocks (structured reasoning)
    if (Array.isArray(choice.message.content)) {
      for (const block of choice.message.content) {
        if (block.type === "reasoning" && block.text) {
          return block.text;
        }
      }
    }

    return undefined;
  }

  /** Extract reasoning from streaming delta (GPT-5+ support) */
  private extractReasoningFromDelta(delta: any): string | undefined {
    if (!delta) return undefined;

    // 1. Standard reasoning field
    if (delta.reasoning && typeof delta.reasoning === "string") {
      return delta.reasoning;
    }

    // 2. DeepSeek/Qwen "reasoning_content"
    if (
      delta.reasoning_content &&
      typeof delta.reasoning_content === "string"
    ) {
      return delta.reasoning_content;
    }

    // 3. Thoughts field
    if (delta.thoughts && typeof delta.thoughts === "string") {
      return delta.thoughts;
    }

    // 4. Check for reasoning content blocks
    if (Array.isArray(delta.content)) {
      for (const block of delta.content) {
        if (block.type === "reasoning" && block.text) {
          return block.text;
        }
      }
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
  }
}

/** Factory function for OpenAI engine */
export function createOpenAIEngine(): OpenAIEngine {
  return new OpenAIEngine();
}
