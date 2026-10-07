import { createAgentKitClient } from "agentkit/client";
import type { ChatDto, SettingsDto } from "agentkit/contracts";
import { AgentKitProvider, useAgentKitClient, useAgentKitEmitter, useProviders } from "agentkit/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { localApiFetch } from "../http/local-api";

type Client = ReturnType<typeof useAgentKitClient>;
type Emitter = ReturnType<typeof useAgentKitEmitter>;
type ProviderState = ReturnType<typeof useProviders>;
type ErrorSetter = (error: string | null) => void;

function latestRead<Args extends unknown[], Result>(read: (...args: Args) => Promise<Result>) {
  let latest: Promise<Result> | null = null;
  return async (...args: Args): Promise<Result> => {
    const own = read(...args);
    latest = own;
    let pending = own;
    for (;;) {
      try {
        const value = await pending;
        if (latest === pending) return value;
      } catch (cause) { if (latest === pending) throw cause; }
      pending = latest;
    }
  };
}

function useModelCache(providerState: ProviderState) {
  const modelCatalogues = useRef(providerState.models);
  modelCatalogues.current = providerState.models;
  const modelReads = useRef(new Map<string, Promise<unknown>>());
  const loadModels = useCallback(async (providerId: string) => {
    const previous = modelReads.current.get(providerId);
    if (previous) return previous as ReturnType<typeof providerState.loadModels>;
    const promise = providerState.loadModels(providerId).finally(() => modelReads.current.delete(providerId));
    modelReads.current.set(providerId, promise);
    return promise;
  }, [providerState.loadModels]);
  return { modelCatalogues, modelReads, loadModels };
}

function useResourceCache() {
  const [resources, setResources] = useState<Record<string, unknown>>({});
  const setResource = useCallback((key: string, value: unknown) => setResources(previous => ({ ...previous, [key]: value })), []);
  const updateResource = useCallback((key: string, update: (previous: unknown) => unknown) => setResources(previous => ({ ...previous, [key]: update(previous[key]) })), []);
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  const resourceGeneration = useRef(new Map<string, number>());
  const loadResource = useCallback(async <T,>(key: string, loader: () => Promise<T>, force = false): Promise<T> => {
    if (!force && resources[key] !== undefined) return resources[key] as T;
    const pending = inFlight.current.get(key);
    if (pending && !force) return pending as Promise<T>;
    const generation = (resourceGeneration.current.get(key) ?? 0) + 1;
    resourceGeneration.current.set(key, generation);
    const promise = loader().then(value => {
      if (resourceGeneration.current.get(key) === generation) setResources(previous => ({ ...previous, [key]: value }));
      return value;
    }).finally(() => { if (resourceGeneration.current.get(key) === generation) inFlight.current.delete(key); });
    inFlight.current.set(key, promise);
    return promise;
  }, [resources]);
  return { resources, setResource, updateResource, loadResource };
}

function useChatCache(client: Client, emitter: Emitter, setError: ErrorSetter) {
  const [chats, setChats] = useState<ChatDto[]>([]);
  const chatsGeneration = useRef(0);
  const reloadChats = useCallback(async () => {
    const generation = ++chatsGeneration.current;
    const result: ChatDto[] = [];
    let before: string | undefined;
    for (let page = 0; page < 100; page++) {
      const items = await client.listChats({ limit: 100, before });
      result.push(...items);
      if (items.length < 100) break;
      const next = items.at(-1)?.updatedAt;
      if (!next || next === before) break;
      before = next;
    }
    if (generation === chatsGeneration.current) setChats(result);
  }, [client]);
  useEffect(() => { void reloadChats().catch(cause => setError(String(cause))); }, [reloadChats, setError]);
  useEffect(() => emitter.subscribe("chats", () => { void reloadChats().catch(cause => setError(String(cause))); }), [emitter, reloadChats, setError]);
  const createChat = useCallback(async (metadata: Record<string, unknown> = {}) => {
    ++chatsGeneration.current;
    const chat = await client.createChat({ metadata });
    ++chatsGeneration.current;
    setChats(previous => [chat, ...previous.filter(item => item.id !== chat.id)]);
    return chat;
  }, [client]);
  const renameChat = useCallback(async (chatId: string, title: string) => {
    ++chatsGeneration.current;
    const chat = await client.updateChat({ chatId }, { title });
    ++chatsGeneration.current;
    setChats(previous => previous.map(item => item.id === chatId ? chat : item));
  }, [client]);
  const deleteChat = useCallback(async (chatId: string) => {
    ++chatsGeneration.current;
    await client.deleteChat({ chatId });
    ++chatsGeneration.current;
    setChats(previous => previous.filter(item => item.id !== chatId));
  }, [client]);
  return { chats, reloadChats, createChat, renameChat, deleteChat };
}

function useConfigCache(client: Client, emitter: Emitter, providerState: ProviderState, modelCache: ReturnType<typeof useModelCache>, setError: ErrorSetter) {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const configGeneration = useRef(0);
  const { modelCatalogues, modelReads, loadModels } = modelCache;
  const reloadConfig = useCallback(async () => {
    const generation = ++configGeneration.current;
    setConfigLoading(true);
    try {
      const [canonical, tools] = await Promise.all([client.getSettings(), client.listTools().catch(() => null)]);
      if (generation !== configGeneration.current) return;
      setSettings(canonical); setToolCount(tools?.length ?? null); setError(null);
      await providerState.reload();
      const providersWithModels = new Set([...Object.keys(modelCatalogues.current), ...modelReads.current.keys()]);
      await Promise.all([...modelReads.current.values()]);
      await Promise.all([...providersWithModels].map(loadModels));
      if (generation !== configGeneration.current) return;
      emitter.emit("preferences");
    } catch (cause) { if (generation === configGeneration.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (generation === configGeneration.current) setConfigLoading(false); }
  }, [client, emitter, providerState.reload, loadModels]);
  useEffect(() => { void reloadConfig(); }, [reloadConfig]);
  return { settings, toolCount, configLoading, reloadConfig, refreshPreferences: reloadConfig };
}

function useDraftCache() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const moveDraft = useCallback((from: string, to: string) => setDrafts(previous => ({ ...previous, [to]: previous[to] ?? previous[from] ?? "", [from]: "" })), []);
  const setDraft = useCallback((key: string, text: string) => setDrafts(previous => ({ ...previous, [key]: text })), []);
  const deleteDraft = useCallback((key: string) => setDrafts(previous => { const next = { ...previous }; delete next[key]; return next; }), []);
  return { drafts, moveDraft, setDraft, deleteDraft };
}

function useAgentKitAppCacheState(base: string) {
  const client = useAgentKitClient();
  const emitter = useAgentKitEmitter();
  const providerClient = useMemo(() => ({ ...client, listProviders: latestRead(client.listProviders) }), [client]);
  const providerState = useProviders({ client: providerClient });
  const [error, setError] = useState<string | null>(null);
  const modelCache = useModelCache(providerState);
  const resources = useResourceCache();
  const chats = useChatCache(client, emitter, setError);
  const config = useConfigCache(client, emitter, providerState, modelCache, setError);
  const drafts = useDraftCache();
  const deleteChat = useCallback(async (chatId: string) => { await chats.deleteChat(chatId); drafts.deleteDraft(chatId); }, [chats.deleteChat, drafts.deleteDraft]);
  return {
    base, client, emitter, ...resources, ...chats, ...config, drafts: drafts.drafts, setDraft: drafts.setDraft, moveDraft: drafts.moveDraft, deleteChat,
    error: error ?? providerState.error?.message ?? null, configLoading: config.configLoading || providerState.loading,
    providerState, loadModels: modelCache.loadModels
  };
}

type AgentKitAppCache = ReturnType<typeof useAgentKitAppCacheState>;
const CacheContext = createContext<AgentKitAppCache | null>(null);
function CacheProvider({ base, children }: { base: string; children: ReactNode }) {
  return <CacheContext.Provider value={useAgentKitAppCacheState(base)}>{children}</CacheContext.Provider>;
}
export function AgentKitAppProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const client = useMemo(() => createAgentKitClient({ baseUrl, fetch: localApiFetch }), [baseUrl]);
  return <AgentKitProvider client={client}><CacheProvider base={baseUrl}>{children}</CacheProvider></AgentKitProvider>;
}
export function useAgentKitAppCache() {
  const cache = useContext(CacheContext);
  if (!cache) throw new Error("AgentKitAppProvider is required");
  return cache;
}
