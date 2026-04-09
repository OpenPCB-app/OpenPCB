import { useEffect, useState, useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";
import { listProviders, getProviderResult } from "@/lib/api/provider-api";
import { getWorkspace, updateWorkspace } from "@/lib/api/workspace-api";
import type { ProviderInfo, ModelInfo } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import {
  ModelSelector as ModelSelectorDialog,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector";

export function ModelSelector() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const {
    activeChat,
    updateActiveChat,
    isStreaming,
    pendingModelSelection,
    setPendingModelSelection,
    projectDefaultModel,
  } = useChatStore();

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsMap, setModelsMap] = useState<Record<string, ModelInfo[]>>({});
  const [selectedProvider, setSelectedProvider] = useState<string>("openai");
  const [selectedModel, setSelectedModel] = useState<string>(
    "gpt-4o-mini-2024-07-18",
  );
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Disable selector during streaming
  const isDisabled = loading || isStreaming;

  // Initial load
  useEffect(() => {
    loadProviders();
  }, []);

  // Sync selected provider/model from active chat, pending selection, or project/workspace defaults
  useEffect(() => {
    if (activeChat) {
      // Prioritize active chat config
      if (activeChat.config.provider) {
        setSelectedProvider(activeChat.config.provider);
      }
      if (activeChat.config.model) {
        setSelectedModel(activeChat.config.model);
      }
    } else if (pendingModelSelection) {
      // Use pending selection if no active chat
      setSelectedProvider(pendingModelSelection.provider);
      setSelectedModel(pendingModelSelection.model);
    } else if (projectDefaultModel) {
      // Auto-select project default model when opening a project
      setSelectedProvider(projectDefaultModel.provider);
      setSelectedModel(projectDefaultModel.model);
      // Also set as pending so ProjectScreen input uses it
      setPendingModelSelection(projectDefaultModel);
    } else if (activeWorkspaceId) {
      // Fallback to workspace defaults
      loadSettings();
    }
  }, [activeChat, activeWorkspaceId, pendingModelSelection, projectDefaultModel]);

  const loadProviders = async () => {
    try {
      const list = await listProviders();
      setProviders(list);

      // Pre-load models for available providers
      for (const p of list) {
        // Always try to load models to trigger lazy initialization
        try {
          const detail = await getProviderResult(p.id);
          if (detail && detail.models.length > 0) {
            setModelsMap((prev) => ({ ...prev, [p.id]: detail.models }));
          }
        } catch (err) {
          console.warn(`Failed to load details for ${p.name}`, err);
        }
      }
    } catch (error) {
      console.error("Failed to load providers:", error);
    }
  };

  const loadSettings = async () => {
    if (!activeWorkspaceId) return;

    let defaultModel = "gpt-4o-mini-2024-07-18";
    let defaultProvider = "openai";

    try {
      const ws = await getWorkspace(activeWorkspaceId);
      if (ws?.settings?.defaultModel) defaultModel = ws.settings.defaultModel;
      if (ws?.settings?.defaultProvider)
        defaultProvider = ws.settings.defaultProvider;
    } catch (error) {
      console.error("Failed to load settings, using fallbacks:", error);
    }

    setSelectedModel(defaultModel);
    setSelectedProvider(defaultProvider);

    // If no active chat, sync these defaults to pending selection
    // so Home.tsx can display the correct model name in placeholder
    if (!activeChat) {
      setPendingModelSelection({
        model: defaultModel,
        provider: defaultProvider,
      });
    }
  };

  const handleSelect = async (providerId: string, modelId: string) => {
    setSelectedProvider(providerId);
    setSelectedModel(modelId);
    setLoading(true);
    setOpen(false);

    try {
      if (activeChat) {
        // 1. Update active chat config immediately (persisted to DB)
        await updateActiveChat({
          config: {
            ...activeChat.config,
            provider: providerId,
            model: modelId,
          },
        });
      } else {
        // No active chat - set pending selection
        setPendingModelSelection({
          provider: providerId,
          model: modelId,
        });
      }

      // 2. Always update workspace defaults for future chats
      if (activeWorkspaceId) {
        const currentWs = await getWorkspace(activeWorkspaceId);
        const newSettings = {
          ...currentWs.settings,
          defaultProvider: providerId,
          defaultModel: modelId,
        };
        await updateWorkspace(activeWorkspaceId, { settings: newSettings });
      }
    } catch (error) {
      console.error("Failed to update model selection:", error);
    } finally {
      setLoading(false);
    }
  };

  const currentModelName = useMemo(() => {
    const models = modelsMap[selectedProvider] || [];
    const model = models.find((m) => m.id === selectedModel);
    return model?.name || selectedModel.split("/").pop() || selectedModel;
  }, [modelsMap, selectedProvider, selectedModel]);

  const isInitialLoading =
    providers.length > 0 && Object.keys(modelsMap).length === 0;

  return (
    <ModelSelectorDialog open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative group"
          disabled={isDisabled}
          title={`Model: ${currentModelName}`}
        >
          <Sparkles className="h-4 w-4" />
          {selectedProvider && (
            <div className="absolute -bottom-0.5 -right-0.5 border border-surface rounded-full bg-surface p-0.5 shadow-sm overflow-hidden">
              <ModelSelectorLogo
                provider={selectedProvider}
                className="size-2.5"
              />
            </div>
          )}
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent className="w-[400px]">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList className="max-h-[400px]">
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>

          {isInitialLoading && (
            <ModelSelectorGroup heading="Loading">
              <ModelSelectorItem disabled>
                <ModelSelectorName>
                  Fetching available models...
                </ModelSelectorName>
              </ModelSelectorItem>
            </ModelSelectorGroup>
          )}

          {providers.map((provider) => {
            const models = modelsMap[provider.id] ?? [];
            const isUnavailable = provider.available === false;

            if (models.length === 0 && !isUnavailable) return null;

            return (
              <ModelSelectorGroup key={provider.id} heading={provider.name}>
                {isUnavailable ? (
                  <ModelSelectorItem disabled className="opacity-50">
                    <ModelSelectorName>Provider unavailable</ModelSelectorName>
                  </ModelSelectorItem>
                ) : (
                  models.map((model) => {
                    const isSelected =
                      selectedProvider === provider.id &&
                      selectedModel === model.id;
                    return (
                      <ModelSelectorItem
                        key={model.id}
                        onSelect={() => handleSelect(provider.id, model.id)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <ModelSelectorLogo provider={provider.id} />
                        <ModelSelectorName>{model.name}</ModelSelectorName>
                        {isSelected && <Check className="ml-auto h-4 w-4" />}
                      </ModelSelectorItem>
                    );
                  })
                )}
              </ModelSelectorGroup>
            );
          })}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelectorDialog>
  );
}
