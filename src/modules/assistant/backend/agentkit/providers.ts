import { awaitProviderSnapshot } from "./await-snapshot";
import { createHash } from "node:crypto";
import type { AiProviderConfig } from "agentkit/contracts";
import { OpenAiCompatibleClient, type AiProviderClient } from "agentkit/core";
import { PROVIDER_SECRET_REF_KEY, type AssistantStore } from "agentkit/host";
import { ValidationError } from "../../../../core/contracts/errors";
import { isSecretReference } from "../../../../core/contracts/credentials/secret-store";
import type { ProviderStore } from "../provider-store";
import { redactCredentialClient } from "./redaction";

const SUPPORTED_KINDS = new Set([
  "openai", "openrouter", "openai-compatible", "lmstudio", "omlx",
]);
const PREFIX = "openpcb-provider-generation-";
const RESERVED = new Set([
  "apikey", "apikeysecretref", "secretref", "secret_ref", "api_key",
  "authorization", "providergeneration", "__openpcbsubmissionfingerprint",
]);

/** Request metadata cannot claim trusted provider or credential ownership. */
export function assertSafeSubmissionMetadata(metadata: unknown): void {
  if (!metadata || typeof metadata !== "object") return;
  for (const [key, value] of Object.entries(metadata)) {
    if (RESERVED.has(key.toLowerCase()) || key.toLowerCase().startsWith("__openpcb")) {
      throw new ValidationError("Credential metadata is not accepted");
    }
    assertSafeSubmissionMetadata(value);
  }
}

export async function pinProviderGeneration(
  providers: ProviderStore,
  store: AssistantStore,
  providerId: string,
  model?: string,
  signal?: AbortSignal,
): Promise<AiProviderConfig> {
  signal?.throwIfAborted();
  const snapshot = await awaitProviderSnapshot(() => providers.snapshotProvider(providerId), signal);
  signal?.throwIfAborted();
  if (!SUPPORTED_KINDS.has(snapshot.kind) || !snapshot.enabled) {
    throw new ValidationError("Provider is not available for AgentKit");
  }
  const url = new URL(snapshot.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ValidationError("Provider endpoint is invalid");
  }
  const selectedModel = model ?? snapshot.defaultModel;
  if (!selectedModel.trim()) throw new ValidationError("Default model is required");
  const config: AiProviderConfig = {
    id: "",
    label: snapshot.label,
    kind: snapshot.kind,
    baseUrl: snapshot.baseUrl,
    defaultModel: selectedModel,
    enabled: true,
    metadata: {
      openpcbProviderId: snapshot.id,
      toolCallingOverride: snapshot.toolCallingOverride,
      effectiveCapabilities: snapshot.capabilities,
      ...(snapshot.secretRef ? { [PROVIDER_SECRET_REF_KEY]: snapshot.secretRef } : {}),
    },
  };
  config.id = PREFIX + createHash("sha256").update(JSON.stringify(config)).digest("hex");
  const existing = await store.providers.getProvider(config.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(config)) {
      throw new ValidationError("Provider generation integrity failed");
    }
    return existing;
  }
  signal?.throwIfAborted();
  await store.transaction(async (tx) => {
    signal?.throwIfAborted();
    await tx.providers.upsertProvider(config);
    const capabilities = snapshot.capabilities;
    if (capabilities) await tx.providers.saveCapabilities(config.id, capabilities);
  });
  return config;
}

export function buildAgentKitProviderClient(config: AiProviderConfig): AiProviderClient {
  if (!config.id.startsWith(PREFIX) || !SUPPORTED_KINDS.has(config.kind)) {
    throw new ValidationError("Untrusted provider generation");
  }
  const reference = config.metadata?.[PROVIDER_SECRET_REF_KEY];
  if (reference !== undefined && (!isSecretReference(reference) || !reference.startsWith("provider/"))) {
    throw new ValidationError("Provider credential reference is invalid");
  }
  if ((reference || config.kind === "openai" || config.kind === "openrouter") && !config.apiKey) {
    throw new ValidationError("Provider credential is unavailable");
  }
  const client = OpenAiCompatibleClient.fromConfig(config);
  return config.apiKey ? redactCredentialClient(client, config.apiKey) : client;
}
