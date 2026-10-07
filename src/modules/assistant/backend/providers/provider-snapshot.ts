import type { InternalProviderConfig } from "../provider-store";

/** Compare effective settings and the opaque credential generation, never the key. */
export function providerSnapshotIdentity(provider: InternalProviderConfig): string {
  return JSON.stringify([
    provider.id, provider.label, provider.kind, provider.baseUrl, provider.defaultModel,
    provider.enabled, provider.hasApiKey, provider.secretRef ?? null,
    provider.toolCallingOverride, provider.updatedAt,
  ]);
}
