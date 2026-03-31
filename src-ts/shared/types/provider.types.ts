/**
 * Provider Types - V2 Kernel
 *
 * Defines provider and model abstractions for the AI kernel.
 */

/** Supported AI providers */
export type ProviderId = string;

/** Provider status error codes */
export type ProviderErrorCode =
  | 'connection_refused'
  | 'timeout'
  | 'auth_failed'
  | 'rate_limited'
  | 'unknown';

/** Provider status (runtime health check result) */
export interface ProviderStatus {
  available: boolean;
  message?: string;
  errorCode?: ProviderErrorCode;
  checkedAt: string;
}

/**
 * Base provider info (static)
 */
export interface ProviderBase {
  id: ProviderId;
  name: string;
  requiresApiKey: boolean;
  supportsOAuth?: boolean;
  oauthProvider?: 'codex' | 'github-copilot';
  baseURL?: string;
}

/**
 * Provider info (runtime)
 */
export interface ProviderInfo extends ProviderBase {
  available: boolean;
  status?: ProviderStatus;
}


/**
 * Provider detail with models
 */
export interface ProviderDetail extends ProviderInfo {
  status: ProviderStatus;
  models: ModelInfo[];
}


/** Provider API key requirements */
export const PROVIDER_REQUIRES_API_KEY: Record<ProviderId, boolean> = {
  openai: true,
  openrouter: true,
  ollama: false,
  codex: true,
  'github-copilot': false,
};

/** Static provider registry */
export const PROVIDERS: readonly ProviderBase[] = [
  {
    id: "openai",
    name: "OpenAI",
    requiresApiKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    requiresApiKey: true,
    baseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "ollama",
    name: "Ollama",
    requiresApiKey: false,
    baseURL: "http://localhost:11434/v1",
  },
  {
    id: "codex",
    name: "Codex",
    requiresApiKey: true,
    supportsOAuth: true,
    oauthProvider: 'codex',
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    requiresApiKey: false,
    supportsOAuth: true,
    oauthProvider: 'github-copilot',
  },
] as const;

/** Model capabilities */
export interface ModelCapabilities {
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
}

/** Model metadata */
export interface ModelInfo {
  id: string;
  providerId: ProviderId;
  name: string;
  description: string;
  contextWindow: number;
  capabilities: ModelCapabilities;
}

/** Default models per provider */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: "gpt-4o-mini-2024-07-18",
  openrouter: "openrouter/auto",
  ollama: "llama3.2",
};

/** Static model registry */
export const MODELS: readonly ModelInfo[] = [
  // OpenAI models
  {
    id: "gpt-4o",
    providerId: "openai",
    name: "GPT-4o",
    description: "Most capable OpenAI model, multimodal",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "gpt-4o-mini",
    providerId: "openai",
    name: "GPT-4o Mini",
    description: "Fast and affordable GPT-4 variant",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "gpt-4o-mini-2024-07-18",
    providerId: "openai",
    name: "GPT-4o Mini (2024-07-18)",
    description: "Specific version of GPT-4o Mini",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "o3-mini",
    providerId: "openai",
    name: "O3 Mini",
    description: "Reasoning model with chain-of-thought",
    contextWindow: 128000,
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsReasoning: true,
    },
  },
  // OpenRouter models
  {
    id: "openrouter/auto",
    providerId: "openrouter",
    name: "OpenRouter Auto",
    description: "Automatically routes to the best model",
    contextWindow: 128000,
    capabilities: {
      supportsVision: true,
      supportsStreaming: true,
      supportsReasoning: true,
    },
  },
  // Ollama models
  {
    id: "llama3.2",
    providerId: "ollama",
    name: "Llama 3.2",
    description: "Meta's latest open model",
    contextWindow: 128000,
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "qwen3:0.6b",
    providerId: "ollama",
    name: "Qwen 3 0.6B",
    description: "Lightweight fast model",
    contextWindow: 32000,
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsReasoning: false,
    },
  },
  {
    id: "deepseek-r1:8b",
    providerId: "ollama",
    name: "DeepSeek R1 8B",
    description: "Reasoning model with thinking output",
    contextWindow: 64000,
    capabilities: {
      supportsVision: false,
      supportsStreaming: true,
      supportsReasoning: true,
    },
  },
] as const;

/** Provider configuration for API calls */
export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  /** OpenRouter attribution URL (HTTP-Referer header) */
  appUrl?: string;
  /** OpenRouter attribution title (X-Title header) */
  appTitle?: string;
  /** OAuth access token (for Codex/GitHub Copilot authentication) */
  oauthToken?: string;
  /** Codex account ID from JWT claims (required for Codex API calls with ChatGPT-Account-ID header) */
  oauthAccountId?: string;
}

/** Get provider info by ID */
export function getProvider(providerId: ProviderId): ProviderBase | undefined {
  return PROVIDERS.find((p) => p.id === providerId);
}

/** Get models for a provider */
export function getModelsByProvider(providerId: ProviderId): ModelInfo[] {
  return MODELS.filter((m) => m.providerId === providerId);
}

/** Get model info by ID */
export function getModel(modelId: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === modelId);
}

/** Validate model supports required capabilities */
export function validateModelCapabilities(
  modelId: string,
  requirements: Partial<ModelCapabilities>,
): string | undefined {
  const model = getModel(modelId);
  if (!model) {
    return `Unknown model: ${modelId}`;
  }

  if (requirements.supportsVision && !model.capabilities.supportsVision) {
    return `Model ${model.name} does not support vision`;
  }

  if (requirements.supportsStreaming && !model.capabilities.supportsStreaming) {
    return `Model ${model.name} does not support streaming`;
  }

  return undefined;
}
