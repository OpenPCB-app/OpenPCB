import { ValidationError } from "../../../../core/contracts/errors";
import {
  OpenAiCompatibleClient,
  getPresetByKind,
  type AiProviderClient,
} from "agentkit/core";
import type { InternalProviderConfig } from "../provider-store";
import { redactCredentialClient } from "../agentkit/redaction";

/**
 * Build an AiProviderClient from a stored OpenPCB provider config.
 * All five API-key/local kinds share the OpenAI-compatible transport.
 */
export interface ProviderClientOptions {
  extraHeaders?: Record<string, string>;
  resolveApiKey?: (
    provider: InternalProviderConfig,
  ) => Promise<string | undefined>;
}

export async function buildAiProviderClient(
  provider: InternalProviderConfig,
  opts?: ProviderClientOptions,
): Promise<AiProviderClient> {
  if (!provider.baseUrl.trim()) {
    throw new ValidationError(
      `Provider ${provider.label} has no base URL configured.`,
    );
  }
  const apiKey = opts?.resolveApiKey
    ? await opts.resolveApiKey(provider)
    : undefined;
  if ((provider.hasApiKey || providerRequiresApiKey(provider)) && !apiKey) {
    throw new ValidationError(
      `API key required for provider: ${provider.label}`,
    );
  }
  const client = new OpenAiCompatibleClient({
    id: provider.id,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey,
    extraHeaders: opts?.extraHeaders,
  });
  return apiKey ? redactCredentialClient(client, apiKey) : client;
}

/**
 * Determine whether a provider needs an API key to run.
 * Cloud presets (OpenAI, OpenRouter) require one; LM Studio / oMLX / custom
 * OpenAI-compatible endpoints do not. Driven by the preset's `requiresApiKey`.
 */
export function providerRequiresApiKey(
  provider: InternalProviderConfig,
): boolean {
  return getPresetByKind(provider.kind)?.requiresApiKey ?? false;
}
