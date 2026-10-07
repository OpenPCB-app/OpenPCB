import { OpenAiCompatibleClient, type AiProviderClient } from "agentkit/core";
import type { SettingsDto } from "agentkit/contracts";
import type { CanonicalProviderDto } from "../../../../sdks/assistant/provider-preferences";
import { NotFoundError, ValidationError } from "../../../../core/contracts/errors";
import type { AssistantProviderConfig, ProviderTestResult } from "../../../../sdks/assistant";
import type { InternalProviderConfig, ProviderStore } from "../provider-store";
import type { SettingsStore } from "../settings-store";
import { redactCredentialClient } from "./redaction";
import { AgentKitHostError } from "agentkit/host";
import { providerSnapshotIdentity } from "../providers/provider-snapshot";

export const PROVIDER_PROBE_TIMEOUT_MS = 10_000;

function probeSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function assertCurrent(providers: ProviderStore, provider: InternalProviderConfig): void {
  const current = providers.getProviderInternal(provider.id);
  if (!current || providerSnapshotIdentity(current) !== providerSnapshotIdentity(provider)) {
    throw new AgentKitHostError("revision_conflict", "Provider changed during the probe. Retry with its current settings.");
  }
}

async function persistProbe<T>(
  providers: ProviderStore, provider: InternalProviderConfig, signal: AbortSignal, persist: () => T,
): Promise<T> {
  return providers.credentials.serialize(provider.id, async () => {
    signal.throwIfAborted();
    assertCurrent(providers, provider);
    return persist();
  });
}

export const PREFERENCE_PROVIDER_KINDS = [
  "openai", "openrouter", "openai-compatible", "lmstudio", "omlx",
] as const;

/** The desktop's opaque credential references never become REST DTO fields. */
export function providerPreferenceDto(provider: AssistantProviderConfig): CanonicalProviderDto {
  const { id, label, kind, baseUrl, defaultModel, enabled, hasApiKey, capabilities, isBuiltin } = provider;
  return { id, label, kind, baseUrl, defaultModel, enabled, hasApiKey, capabilities, isBuiltin };
}

export function settingsPreferenceDto(settings: SettingsStore, providers: ProviderStore): SettingsDto {
  const app = settings.getSettings();
  return {
    defaultProviderId: app.defaultProviderId,
    defaultModel: providers.getProvider(app.defaultProviderId)?.defaultModel,
    contextSizePreference: app.contextSizePreference,
    writePolicyMode: app.toolExecutionPolicy,
    allowRawToolData: app.allowRawToolData,
    toolCalling: providers.getToolCallingMode(app.defaultProviderId),
    metadata: {},
  };
}

export function requirePreferenceProvider(providers: ProviderStore, id: string): AssistantProviderConfig {
  const provider = providers.getProvider(id);
  if (!provider) throw new NotFoundError("Provider not found");
  return provider;
}

/** One-off probes resolve the same app-owned vault snapshot as real turns. */
async function preferenceClient(providers: ProviderStore, id: string): Promise<{
  client: AiProviderClient; provider: InternalProviderConfig;
}> {
  requirePreferenceProvider(providers, id);
  const provider = await providers.snapshotProvider(id);
  if (!PREFERENCE_PROVIDER_KINDS.some((kind) => kind === provider.kind)) {
    throw new ValidationError("Provider is not available for AgentKit");
  }
  if (!provider.enabled) throw new ValidationError(`Provider disabled: ${provider.label}`);
  if (!provider.baseUrl.trim()) throw new ValidationError(`Provider ${provider.label} has no base URL`);
  let url: URL;
  try { url = new URL(provider.baseUrl); }
  catch { throw new ValidationError("Provider endpoint is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ValidationError("Provider endpoint is invalid");
  }
  const snapshot = provider;
  const apiKey = await providers.resolveApiKey(snapshot);
  if ((snapshot.hasApiKey || ["openai", "openrouter"].includes(snapshot.kind)) && !apiKey) {
    throw new ValidationError(`API key required for provider: ${snapshot.label}`);
  }
  const client = new OpenAiCompatibleClient({
    id: snapshot.id, kind: snapshot.kind, baseUrl: snapshot.baseUrl, apiKey,
  });
  return { client: apiKey ? redactCredentialClient(client, apiKey) : client, provider: snapshot };
}

export async function refreshPreferenceModels(providers: ProviderStore, id: string, requestSignal?: AbortSignal) {
  const signal = probeSignal(requestSignal);
  signal.throwIfAborted();
  const { client, provider } = await preferenceClient(providers, id);
  const models = await client.listModels(signal);
  signal.throwIfAborted();
  const ids = models.map((model) => model.modelId);
  assertCurrent(providers, provider);
  if (ids.length && !ids.includes(provider.defaultModel)) {
    const stored = await providers.updateProvider(id, { defaultModel: ids[0] }, provider, signal);
    const updated = { ...provider, ...stored };
    return persistProbe(providers, updated, signal, () => providers.replaceModels(id, ids));
  }
  return persistProbe(providers, provider, signal, () => providers.replaceModels(id, ids));
}

export async function refreshPreferenceCapabilities(providers: ProviderStore, id: string, requestSignal?: AbortSignal) {
  const signal = probeSignal(requestSignal);
  signal.throwIfAborted();
  const { client, provider } = await preferenceClient(providers, id);
  const capabilities = await client.capabilities(signal, provider.defaultModel);
  await persistProbe(providers, provider, signal, () => providers.saveCapabilities(id, capabilities));
  return capabilities;
}

export async function testPreferenceProvider(
  providers: ProviderStore, id: string, includeCompletion: boolean, requestSignal?: AbortSignal,
): Promise<ProviderTestResult> {
  const signal = probeSignal(requestSignal);
  signal.throwIfAborted();
  const { client, provider } = await preferenceClient(providers, id);
  let modelsAvailable = 0;
  let toolCallSupported = false;
  let message: string;
  try {
    const models = await client.listModels(signal);
    modelsAvailable = models.length;
    await persistProbe(providers, provider, signal, () => providers.replaceModels(id, models.map((model) => model.modelId)));
    message = `Listed ${modelsAvailable} model(s).`;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AgentKitHostError) throw error;
    message = `List models failed: ${error instanceof Error ? error.message : "Provider request failed"}`;
  }
  if (includeCompletion) {
    const caps = await client.capabilities(signal, provider.defaultModel);
    await persistProbe(providers, provider, signal, () => providers.saveCapabilities(id, caps));
    toolCallSupported = caps.toolCalling;
    message += caps.toolCalling ? " Tool-call probe passed."
      : ` Tool-call probe failed${caps.warning ? `: ${caps.warning}` : "."}`;
  }
  return { ok: modelsAvailable > 0, checkedAt: new Date().toISOString(), modelsAvailable,
    completionTested: includeCompletion, toolCallSupported, message };
}

export function preferenceToolCalling(providers: ProviderStore, id: string) {
  const provider = requirePreferenceProvider(providers, id);
  return { mode: providers.getToolCallingMode(id), effective: provider.capabilities?.toolCalling !== false };
}
