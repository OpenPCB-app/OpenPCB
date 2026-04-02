import { commands } from "@shared/generated/tauri-bindings";

type BridgeResult = { status: "ok"; result: any } | { status: "error"; error: { message: string } };

function unwrapBridgeResult(result: any): any {
  if (result.status !== "ok") {
    throw new Error(result.error?.message || "Bridge command failed");
  }
  return result.result;
}

async function invokeSecrets<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const response = await commands.bridgeInvoke({
    namespace: "secrets",
    command,
    payload,
  });

  if (response.status !== "ok") {
    throw new Error("Bridge invocation failed");
  }

  return unwrapBridgeResult(response.data as BridgeResult) as T;
}

export async function listProviderApiKeys(): Promise<string[]> {
  const result = await invokeSecrets<{ providers: string[] }>("listProviderApiKeys", {});
  return result.providers;
}

export async function hasProviderApiKey(providerId: string): Promise<boolean> {
  const result = await invokeSecrets<{ providerId: string; hasKey: boolean }>("hasProviderApiKey", {
    providerId,
  });
  return result.hasKey;
}

export async function setProviderApiKey(
  providerId: string,
  apiKey: string
): Promise<{ stored: boolean; synced: boolean; syncError?: string | null }> {
  const result = await invokeSecrets<{
    stored: boolean;
    synced: boolean;
    syncError?: string | null;
  }>("setProviderApiKey", { providerId, apiKey });
  return result;
}

export async function removeProviderApiKey(
  providerId: string
): Promise<{ stored: boolean; synced: boolean; syncError?: string | null }> {
  const result = await invokeSecrets<{
    stored: boolean;
    synced: boolean;
    syncError?: string | null;
  }>("removeProviderApiKey", { providerId });
  return result;
}

export async function syncProviderApiKey(
  providerId: string
): Promise<{ stored: boolean; synced: boolean; syncError?: string | null }> {
  const result = await invokeSecrets<{
    stored: boolean;
    synced: boolean;
    syncError?: string | null;
  }>("syncProviderApiKey", { providerId });
  return result;
}

export async function syncProviderApiKeyRemoval(
  providerId: string
): Promise<{ stored: boolean; synced: boolean; syncError?: string | null }> {
  const result = await invokeSecrets<{
    stored: boolean;
    synced: boolean;
    syncError?: string | null;
  }>("syncProviderApiKeyRemoval", { providerId });
  return result;
}
