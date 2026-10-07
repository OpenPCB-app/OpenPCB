import { localApiFetch } from "../../../../../shared/frontend/http/local-api";
import type { RendererCredentials } from "../../../../contracts/credentials/renderer";
import type { AiProviderKind, AssistantProviderConfig } from "../../../../../sdks/assistant";

export interface ProviderDraft {
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

export function providerMetadata(draft: ProviderDraft): Omit<ProviderDraft, "apiKey"> {
  return {
    label: draft.label,
    kind: draft.kind,
    baseUrl: draft.baseUrl,
    defaultModel: draft.defaultModel,
    enabled: draft.enabled,
  };
}

export async function readAssistantJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await localApiFetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText })) as {
      detail?: string;
      error?: string;
      title?: string;
    };
    throw new Error(body.detail ?? body.error ?? body.title ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function requireCredentials(bridge?: RendererCredentials): RendererCredentials {
  const credentials = bridge ?? (
    typeof window === "undefined" ? undefined : window.electronAPI?.credentials
  );
  if (!credentials) {
    throw new Error("Open OpenPCB desktop to save or remove API keys. Browser mode cannot access the OS keychain.");
  }
  return credentials;
}

async function changeKey(
  credentials: RendererCredentials,
  providerId: string,
  apiKey: string | null,
): Promise<void> {
  const result = await (apiKey === null
    ? credentials.clear({ providerId })
    : credentials.set({ providerId, apiKey }));
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  const status = await credentials.status({ providerId });
  if (!status.ok) throw new Error(`${status.error.code}: ${status.error.message}`);
  const expected = apiKey !== null;
  if (result.value.configured !== expected || status.value.configured !== expected) {
    throw new Error("The OS keychain did not confirm the credential change. Unlock it and retry.");
  }
}

export async function saveProviderDraft(
  base: string,
  providerId: string,
  draft: ProviderDraft,
  bridge?: RendererCredentials,
): Promise<AssistantProviderConfig> {
  const apiKey = draft.apiKey.trim();
  const credentials = apiKey ? requireCredentials(bridge) : undefined;
  const url = `${base}/providers/${encodeURIComponent(providerId)}`;
  const updated = await readAssistantJson<AssistantProviderConfig>(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(providerMetadata(draft)),
  });
  if (!credentials) return updated;
  await changeKey(credentials, providerId, apiKey);
  const provider = await readAssistantJson<AssistantProviderConfig>(url);
  if (!provider.hasApiKey) throw new Error("The saved API key is not reflected in provider settings. Reload and retry.");
  return provider;
}

export async function removeProviderKey(
  base: string,
  providerId: string,
  bridge?: RendererCredentials,
): Promise<AssistantProviderConfig> {
  await changeKey(requireCredentials(bridge), providerId, null);
  const provider = await readAssistantJson<AssistantProviderConfig>(`${base}/providers/${encodeURIComponent(providerId)}`);
  if (provider.hasApiKey) throw new Error("The removed API key is still shown in provider settings. Reload and retry.");
  return provider;
}
