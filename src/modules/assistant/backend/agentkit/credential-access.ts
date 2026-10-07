import type { ProviderCredentialAccess } from "../../../../core/contracts/credentials/renderer";
import type { ProviderStore } from "../provider-store";

/** Electron receives only write, clear and presence; secret resolution stays trusted. */
export function createProviderCredentialAccess(providers: ProviderStore): ProviderCredentialAccess {
  return {
    async set(providerId, apiKey) {
      await providers.updateProvider(providerId, { apiKey });
      return providers.credentialStatus(providerId);
    },
    async clear(providerId) {
      await providers.updateProvider(providerId, { clearApiKey: true });
      return providers.credentialStatus(providerId);
    },
    async status(providerId) {
      return providers.credentialStatus(providerId);
    },
  };
}
