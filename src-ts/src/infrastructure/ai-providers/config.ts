/**
 * Provider Configuration Types - V2 Kernel
 *
 * Extended configuration options for provider engines.
 */

import type { ProviderId } from "@shared/types";

/** OpenAI-specific configuration */
export interface OpenAIConfig {
  /** API key */
  apiKey: string;
  /** Organization ID (optional) */
  organization?: string;
  /** Base URL override */
  baseURL?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Max retries on failure */
  maxRetries?: number;
}

/** Ollama-specific configuration */
export interface OllamaConfig {
  /** Base URL (default: http://localhost:11434) */
  baseURL?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Keep-alive duration */
  keepAlive?: string;
  /** Max retries */
  maxRetries?: number; // Added to match other configs
}

/** Anthropic-specific configuration */
export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/** Groq-specific configuration */
export interface GroqConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

/** Local (Rust) configuration */
export interface LocalConfig {
  timeout?: number;
}

/** Provider configuration map */
export interface ProviderConfigs {
  openai?: OpenAIConfig;
  openrouter?: OpenAIConfig;
  ollama?: OllamaConfig;
  anthropic?: AnthropicConfig;
  groq?: GroqConfig;
  local?: LocalConfig;
}

/** Full kernel provider configuration */
export interface KernelProviderConfig {
  /** Provider-specific configurations */
  providers?: ProviderConfigs;
  /** Default timeout for all providers (ms) */
  defaultTimeout?: number;
  /** Default provider to use */
  defaultProvider?: ProviderId;
  /** Default model per provider */
  defaultModels?: Partial<Record<ProviderId, string>>;
}

/** Default configuration values */
export const DEFAULT_PROVIDER_CONFIG: Required<KernelProviderConfig> = {
  providers: {},
  defaultTimeout: 60000,
  defaultProvider: "openai",
  defaultModels: {
    openai: "gpt-4o-mini-2024-07-18",
    openrouter: "openrouter/auto",
    ollama: "qwen3:0.6b",
    anthropic: "claude-3-5-sonnet-20240620",
    groq: "llama3-70b-8192",
    local: "default",
  },
};

/** API key storage interface */
export interface ApiKeyStorage {
  /** Get API key for provider */
  get(providerId: ProviderId): Promise<string | null>;
  /** Set API key for provider */
  set(providerId: ProviderId, apiKey: string): Promise<void>;
  /** Delete API key for provider */
  delete(providerId: ProviderId): Promise<void>;
  /** Check if API key exists */
  has(providerId: ProviderId): Promise<boolean>;
}

/** In-memory API key storage (for development/testing) */
export class MemoryApiKeyStorage implements ApiKeyStorage {
  private keys = new Map<ProviderId, string>();

  async get(providerId: ProviderId): Promise<string | null> {
    return this.keys.get(providerId) ?? null;
  }

  async set(providerId: ProviderId, apiKey: string): Promise<void> {
    this.keys.set(providerId, apiKey);
  }

  async delete(providerId: ProviderId): Promise<void> {
    this.keys.delete(providerId);
  }

  async has(providerId: ProviderId): Promise<boolean> {
    return this.keys.has(providerId);
  }
}

/** Request options for chat completions */
export interface ChatRequestOptions {
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p sampling */
  topP?: number;
  /** Max tokens in response */
  maxTokens?: number;
  /** Stop sequences */
  stop?: string[];
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Response format */
  responseFormat?: "text" | "json";
  /** Seed for deterministic output */
  seed?: number;
}

/** Default request options */
export const DEFAULT_REQUEST_OPTIONS: ChatRequestOptions = {
  temperature: 0.7,
  maxTokens: 4096,
};

/** Merge configs with defaults */
export function mergeConfig<T extends object>(
  defaults: T,
  overrides?: Partial<T>,
): T {
  if (!overrides) {
    return { ...defaults };
  }
  return { ...defaults, ...overrides };
}

/** Validate OpenAI config */
export function validateOpenAIConfig(config: Partial<OpenAIConfig>): string | undefined {
  if (!config.apiKey) {
    return "OpenAI API key is required";
  }
  if (config.apiKey && !config.apiKey.startsWith("sk-")) {
    return "Invalid OpenAI API key format";
  }
  return undefined;
}

/** Validate Ollama config */
export function validateOllamaConfig(config: Partial<OllamaConfig>): string | undefined {
  if (config.baseURL) {
    try {
      new URL(config.baseURL);
    } catch {
      return "Invalid Ollama base URL";
    }
  }
  return undefined;
}
