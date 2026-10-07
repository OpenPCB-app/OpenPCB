import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssistantPromptPreset, AssistantProviderConfig, AssistantSettings } from "../../../sdks/assistant";
import type { CanonicalProviderDto } from "../../../sdks/assistant/provider-preferences";
import { useAgentKitAppCache } from "../../../shared/frontend/assistant/AgentKitAppProvider";
import { assistantRequest } from "./client";

interface AppPreferences { settings: AssistantSettings; presets: AssistantPromptPreset[] }
export function useAssistantCache() {
  const cache = useAgentKitAppCache();
  const [error, setError] = useState<string | null>(null);
  const loadApp = useCallback(() => Promise.all([
    assistantRequest<AssistantSettings>(cache.base, "/settings"),
    assistantRequest<AssistantPromptPreset[]>(cache.base, "/prompt-presets"),
  ]).then(([settings, presets]) => ({ settings, presets })), [cache.base]);
  useEffect(() => { void cache.loadResource("openpcb.preferences", loadApp).catch(cause => setError(String(cause))); }, [cache.loadResource, loadApp]);
  useEffect(() => cache.emitter.subscribe("preferences", () => {
    void cache.loadResource("openpcb.preferences", loadApp, true).catch(cause => setError(String(cause)));
  }), [cache.emitter, cache.loadResource, loadApp]);
  const app = cache.resources["openpcb.preferences"] as AppPreferences | undefined;
  const providerDetails = useMemo(() => cache.providerState.providers.map(provider => {
    const native = provider as CanonicalProviderDto;
    return {
      ...provider, capabilities: native.capabilities ?? null, hasApiKey: native.hasApiKey ?? false,
      isBuiltin: native.isBuiltin ?? false, apiKeyPreview: null, createdAt: "", updatedAt: ""
    } satisfies AssistantProviderConfig;
  }), [cache.providerState.providers]);
  const reloadConfig = useCallback(async () => {
    await Promise.all([cache.reloadConfig(), cache.loadResource("openpcb.preferences", loadApp, true)]);
  }, [cache.reloadConfig, cache.loadResource, loadApp]);
  return {
    ...cache, appSettings: app?.settings ?? null, presets: app?.presets ?? [], providerDetails,
    configLoading: cache.configLoading || !app, error: error ?? cache.error, reloadConfig
  };
}
