import { ValidationError } from "../../../../core/contracts/errors";
import {
  OpenAiCompatibleClient,
  getPresetByKind,
  type AiProviderClient,
} from "@openpcb/ai-core";
import type { InternalProviderConfig } from "../provider-store";
import { redactProviderCredential } from "./provider-credentials";

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
  // Only the legacy managed-cloud adapter supplies an ephemeral apiKey directly.
  const apiKey = provider.apiKey ?? (opts?.resolveApiKey
    ? await opts.resolveApiKey(provider)
    : undefined);
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
    // The OpenPCB Cloud metered proxy requires x-openpcb-workspace-id and
    // stitches usage via x-openpcb-run-id; run-service resolves + passes them.
    extraHeaders: opts?.extraHeaders,
  });
  return apiKey ? redactProviderCredential(client, apiKey) : client;
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
