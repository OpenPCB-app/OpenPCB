/**
 * Provider Engines Module - Infrastructure
 *
 * Re-exports all provider engine implementations.
 * Note: LocalEngine temporarily excluded (requires rust-client.ts migration)
 * Note: Anthropic and Groq engines removed (keep only OpenAI, OpenRouter, and Ollama)
 */

export { OpenAIEngine, createOpenAIEngine } from "./openai.ts";
export { OpenRouterEngine, createOpenRouterEngine } from "./openrouter.ts";
export { OllamaEngine, createOllamaEngine } from "./ollama.ts";
export {
  GitHubCopilotEngine,
  createGitHubCopilotEngine,
} from "./github-copilot.ts";
export type { LoadedModel } from "../engine.ts";

import type { ProviderId } from "@shared/types";
import type { ProviderEngineFactory } from "../engine.ts";
import type { ProviderRegistry } from "../registry.ts";
import { createOpenAIEngine } from "./openai.ts";
import { createOpenRouterEngine } from "./openrouter.ts";
import { createOllamaEngine } from "./ollama.ts";
import { createGitHubCopilotEngine } from "./github-copilot.ts";

/** Map of provider IDs to their engine factories */
export const ENGINE_FACTORIES: Partial<
  Record<ProviderId, ProviderEngineFactory>
> = {
  openai: createOpenAIEngine,
  openrouter: createOpenRouterEngine,
  ollama: createOllamaEngine,
  // Codex uses OpenAI engine (same API, different auth via OAuth token)
  codex: createOpenAIEngine,
  "github-copilot": createGitHubCopilotEngine,
};

/**
 * Register all built-in provider engines with a registry.
 */
export function registerAllEngines(registry: ProviderRegistry): void {
  for (const [providerId, factory] of Object.entries(ENGINE_FACTORIES)) {
    if (factory) {
      registry.register(providerId as ProviderId, factory);
    }
  }
  console.log(
    `[Engines] Registered ${Object.keys(ENGINE_FACTORIES).length} provider engines`,
  );
}

/**
 * Register a specific provider engine.
 */
export function registerEngine(
  registry: ProviderRegistry,
  providerId: ProviderId,
): void {
  const factory = ENGINE_FACTORIES[providerId];
  if (!factory) {
    throw new Error(`No engine factory for provider: ${providerId}`);
  }
  registry.register(providerId, factory);
}

/**
 * Get factory for a specific provider.
 */
export function getEngineFactory(
  providerId: ProviderId,
): ProviderEngineFactory | undefined {
  return ENGINE_FACTORIES[providerId];
}
