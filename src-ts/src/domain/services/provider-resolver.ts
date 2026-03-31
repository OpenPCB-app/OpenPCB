/**
 * ProviderResolver - Domain Service
 *
 * Resolves providers and models, validates capabilities.
 * Used by task manager to find appropriate engine for requests.
 */

import type {
  ProviderId,
  ModelInfo,
  ModelCapabilities,
  ProviderInfo,
} from "@shared/types";
import {
  PROVIDERS,
  MODELS,
  DEFAULT_MODELS,
  getProvider,
  getModel,
  getModelsByProvider,
  validateModelCapabilities,
} from "@shared/types";
import type { KernelProviderEngine } from "../../infrastructure/ai-providers/engine";
import type { ProviderRegistry } from "../../infrastructure/ai-providers/registry";

/** Resolution request */
export interface ResolveRequest {
  /** Preferred provider (optional) */
  provider?: ProviderId;
  /** Preferred model (optional) */
  model?: string;
  /** Required capabilities */
  requirements?: Partial<ModelCapabilities>;
}

/** Resolution result */
export interface ResolveResult {
  /** Resolved provider ID */
  providerId: ProviderId;
  /** Resolved model ID */
  modelId: string;
  /** Provider info */
  provider: ProviderInfo;
  /** Model info */
  model: ModelInfo;
  /** Provider engine (if registry provided) */
  engine?: KernelProviderEngine;
}

/** Resolution error */
export class ResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PROVIDER_NOT_FOUND"
      | "MODEL_NOT_FOUND"
      | "CAPABILITY_MISMATCH"
      | "ENGINE_NOT_AVAILABLE",
  ) {
    super(message);
    this.name = "ResolutionError";
  }
}

/**
 * Provider Resolver
 *
 * Resolves provider/model combinations and validates capabilities.
 */
export class ProviderResolver {
  constructor(private readonly registry?: ProviderRegistry) { }

  /**
   * Resolve provider and model from request.
   *
   * Resolution order:
   * 1. Use specified provider/model if valid
   * 2. Infer provider from model ID
   * 3. Fall back to defaults
   */
  async resolve(request: ResolveRequest): Promise<ResolveResult> {
    const { provider: requestedProvider, model: requestedModel, requirements } = request;

    // Step 1: Determine provider
    let providerId: ProviderId;
    let modelId: string;

    if (requestedModel) {
      // Try to find model and infer provider
      const model = getModel(requestedModel);
      if (model) {
        providerId = requestedProvider || model.providerId;
        modelId = requestedModel;
      } else if (requestedProvider) {
        // Model not in static list, but provider specified
        // Could be dynamic model (e.g., Ollama)
        providerId = requestedProvider;
        modelId = requestedModel;
      } else {
        throw new ResolutionError(
          `Model not found: ${requestedModel}`,
          "MODEL_NOT_FOUND",
        );
      }
    } else if (requestedProvider) {
      // Provider specified, use default model
      providerId = requestedProvider;
      modelId = DEFAULT_MODELS[providerId] ?? providerId;
    } else {
      // Nothing specified, use global defaults
      providerId = "ollama";
      modelId = DEFAULT_MODELS.ollama ?? "llama3.2";
    }

    // Step 2: Get provider info
    const provider = getProvider(providerId);
    if (!provider) {
      throw new ResolutionError(
        `Provider not found: ${providerId}`,
        "PROVIDER_NOT_FOUND",
      );
    }

    // Step 3: Get or create model info
    let model = getModel(modelId);
    if (!model) {
      // Create placeholder for dynamic models
      model = {
        id: modelId,
        providerId,
        name: modelId,
        description: `Dynamic model: ${modelId}`,
        contextWindow: 128000,
        capabilities: {
          supportsVision: false,
          supportsStreaming: true,
          supportsReasoning: false,
        },
      };
    }

    // Step 4: Validate capabilities if requirements specified
    if (requirements) {
      const error = validateModelCapabilities(modelId, requirements);
      if (error) {
        throw new ResolutionError(error, "CAPABILITY_MISMATCH");
      }
    }

    // Step 5: Get engine if registry available
    let engine: KernelProviderEngine | undefined;
    if (this.registry) {
      engine = await this.registry.get(providerId) ?? undefined;
      if (!engine) {
        throw new ResolutionError(
          `Provider engine not available: ${providerId}`,
          "ENGINE_NOT_AVAILABLE",
        );
      }
    }

    return {
      providerId,
      modelId,
      provider: { ...provider, available: true },
      model,
      engine,
    };
  }

  /**
   * Resolve synchronously (no engine lookup).
   */
  resolveSync(request: ResolveRequest): Omit<ResolveResult, "engine"> {
    const { provider: requestedProvider, model: requestedModel, requirements } = request;

    let providerId: ProviderId;
    let modelId: string;

    if (requestedModel) {
      const model = getModel(requestedModel);
      if (model) {
        providerId = requestedProvider || model.providerId;
        modelId = requestedModel;
      } else if (requestedProvider) {
        providerId = requestedProvider;
        modelId = requestedModel;
      } else {
        throw new ResolutionError(
          `Model not found: ${requestedModel}`,
          "MODEL_NOT_FOUND",
        );
      }
    } else if (requestedProvider) {
      providerId = requestedProvider;
      modelId = DEFAULT_MODELS[providerId] ?? providerId;
    } else {
      providerId = "ollama";
      modelId = DEFAULT_MODELS.ollama ?? "llama3.2";
    }

    const provider = getProvider(providerId);
    if (!provider) {
      throw new ResolutionError(
        `Provider not found: ${providerId}`,
        "PROVIDER_NOT_FOUND",
      );
    }

    let model = getModel(modelId);
    if (!model) {
      model = {
        id: modelId,
        providerId,
        name: modelId,
        description: `Dynamic model: ${modelId}`,
        contextWindow: 128000,
        capabilities: {
          supportsVision: false,
          supportsStreaming: true,
          supportsReasoning: false,
        },
      };
    }

    if (requirements) {
      const error = validateModelCapabilities(modelId, requirements);
      if (error) {
        throw new ResolutionError(error, "CAPABILITY_MISMATCH");
      }
    }

    return {
      providerId,
      modelId,
      provider: { ...provider, available: true },
      model,
    };
  }

  /**
   * List all available providers.
   */
  listProviders(): ProviderInfo[] {
    if (this.registry) {
      return this.registry.listProviders();
    }
    // Add available: true for static providers (assume available without runtime check)
    return PROVIDERS.map(p => ({ ...p, available: true }));
  }

  /**
   * List all available models.
   */
  listModels(providerId?: ProviderId): ModelInfo[] {
    if (providerId) {
      return getModelsByProvider(providerId);
    }
    return [...MODELS];
  }

  /**
   * List models from registered providers (may include dynamic models).
   */
  async listAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [...MODELS];

    if (this.registry) {
      for (const providerId of this.registry.list()) {
        try {
          const engine = await this.registry.get(providerId);
          if (engine) {
            const providerModels = await engine.listModels();
            // Add models not in static list
            for (const model of providerModels) {
              if (!models.find((m) => m.id === model.id)) {
                models.push(model);
              }
            }
          }
        } catch (error) {
          console.warn(`[ProviderResolver] Failed to list models from ${providerId}:`, error);
        }
      }
    }

    return models;
  }

  /**
   * Get model info by ID.
   */
  getModel(modelId: string): ModelInfo | undefined {
    return getModel(modelId);
  }

  /**
   * Validate model capabilities.
   */
  validateCapabilities(
    modelId: string,
    requirements: Partial<ModelCapabilities>,
  ): string | undefined {
    return validateModelCapabilities(modelId, requirements);
  }

  /**
   * Check if a model supports vision.
   */
  supportsVision(modelId: string): boolean {
    const model = getModel(modelId);
    return model?.capabilities.supportsVision ?? false;
  }

  /**
   * Check if a model supports streaming.
   */
  supportsStreaming(modelId: string): boolean {
    const model = getModel(modelId);
    return model?.capabilities.supportsStreaming ?? true;
  }

  /**
   * Check if a model supports reasoning output.
   */
  supportsReasoning(modelId: string): boolean {
    const model = getModel(modelId);
    return model?.capabilities.supportsReasoning ?? false;
  }

  /**
   * Get default model for a provider.
   */
  getDefaultModel(providerId: ProviderId): string {
    return DEFAULT_MODELS[providerId] ?? providerId;
  }

  /**
   * Find best model for requirements.
   */
  findBestModel(
    requirements: Partial<ModelCapabilities>,
    preferredProvider?: ProviderId,
  ): ModelInfo | undefined {
    const candidates = preferredProvider
      ? getModelsByProvider(preferredProvider)
      : [...MODELS];

    return candidates.find((model) => {
      if (requirements.supportsVision && !model.capabilities.supportsVision) {
        return false;
      }
      if (requirements.supportsStreaming && !model.capabilities.supportsStreaming) {
        return false;
      }
      if (requirements.supportsReasoning && !model.capabilities.supportsReasoning) {
        return false;
      }
      return true;
    });
  }
}

/**
 * Create a provider resolver.
 */
export function createProviderResolver(registry?: ProviderRegistry): ProviderResolver {
  return new ProviderResolver(registry);
}
