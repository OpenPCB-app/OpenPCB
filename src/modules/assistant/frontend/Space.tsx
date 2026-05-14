import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { ArrowUp, Bot, CheckCircle2, MessageSquarePlus, MoreHorizontal, Search, Settings, Sparkles, User } from "lucide-react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import type { AssistantChat, AssistantMessage, AssistantProviderConfig, AssistantProviderModel, AssistantSettings, SubmitAssistantMessageResult } from "../../../sdks/assistant";

function headers(): HeadersInit { return { "content-type": "application/json" }; }
function isUsableChatId(chatId: string | null | undefined): chatId is string { return typeof chatId === "string" && chatId.trim().length > 0 && chatId !== "undefined" && chatId !== "null"; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: string; error?: string; title?: string };
    throw new Error(body.detail ?? body.error ?? body.title ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function AssistantSpace({ backendURL, moduleId }: ModuleSpaceProps): ReactElement {
  const base = useMemo(() => backendURL ? `${backendURL}/api/modules/${moduleId}` : null, [backendURL, moduleId]);
  const [chats, setChats] = useState<AssistantChat[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [providers, setProviders] = useState<AssistantProviderConfig[]>([]);
  const [models, setModels] = useState<AssistantProviderModel[]>([]);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const activeChatIdRef = useRef<string | null>(null);

  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const filteredChats = chats.filter((chat) => `${chat.title} ${chat.model}`.toLowerCase().includes(query.toLowerCase()));
  const hasPendingAssistantMessage = messages.some((message) => message.role === "assistant" && message.content.trim().length === 0);

  const refreshChats = useCallback(async () => {
    if (!base) return;
    const data = await api<AssistantChat[]>(`${base}/chats`);
    setChats(data);
    setSelectedChatId((current) => {
      const next = isUsableChatId(current) ? current : data[0]?.id ?? null;
      activeChatIdRef.current = next;
      return next;
    });
  }, [base]);

  const refreshMessages = useCallback(async (chatId: string) => {
    if (!base) return;
    setMessages(await api<AssistantMessage[]>(`${base}/chats/${chatId}/messages`));
  }, [base]);

  const refreshConfig = useCallback(async () => {
    if (!base) return;
    const [nextSettings, nextProviders] = await Promise.all([api<AssistantSettings>(`${base}/settings`), api<AssistantProviderConfig[]>(`${base}/providers`)]);
    setSettings(nextSettings);
    setProviders(nextProviders);
    const defaultProvider = nextProviders.find((provider) => provider.id === nextSettings.defaultProviderId) ?? nextProviders[0];
    if (defaultProvider) {
      setProviderId(defaultProvider.id);
      setModel(defaultProvider.defaultModel);
    }
  }, [base]);

  useEffect(() => { void Promise.all([refreshConfig(), refreshChats()]).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))); }, [refreshChats, refreshConfig]);
  useEffect(() => {
    activeChatIdRef.current = selectedChatId;
    const chat = chats.find((entry) => entry.id === selectedChatId);
    if (chat) {
      setProviderId(chat.providerConfigId || chat.provider);
      setModel(chat.model);
      void refreshMessages(chat.id);
    }
  }, [chats, refreshMessages, selectedChatId]);
  useEffect(() => {
    if (!base || !providerId) return;
    void api<AssistantProviderModel[]>(`${base}/providers/${providerId}/models`).then(setModels).catch(() => setModels([]));
  }, [base, providerId]);
  useEffect(() => {
    if (models.length === 0) return;
    const firstModel = models[0];
    if (firstModel && !models.some((entry) => entry.modelId === model)) setModel(firstModel.modelId);
  }, [model, models]);
  useEffect(() => () => { streamRef.current?.close(); }, []);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  const createChat = useCallback(async (): Promise<AssistantChat | null> => {
    if (!base) return null;
    const chat = await api<AssistantChat>(`${base}/chats`, { method: "POST", headers: headers(), body: JSON.stringify({ providerConfigId: providerId || settings?.defaultProviderId, model }) });
    activeChatIdRef.current = chat.id;
    setChats((prev) => [chat, ...prev]);
    setSelectedChatId(chat.id);
    setMessages([]);
    return chat;
  }, [base, model, providerId, settings?.defaultProviderId]);

  const deleteChat = useCallback(async (chatId: string) => {
    if (!base) return;
    await api<{ ok: true }>(`${base}/chats/${chatId}`, { method: "DELETE" });
    setContextMenu(null);
    await refreshChats();
    if (selectedChatId === chatId) setMessages([]);
  }, [base, refreshChats, selectedChatId]);

  const openStream = useCallback((taskId: string, chatId: string) => {
    streamRef.current?.close();
    const stream = new EventSource(`${backendURL}/api/modules/tasks/tasks/${taskId}/stream`);
    streamRef.current = stream;
    const finish = () => {
      setLoading(false);
      stream.close();
      streamRef.current = null;
      void refreshMessages(chatId);
      void refreshChats();
    };
    stream.addEventListener("task.chunk", () => void refreshMessages(chatId));
    stream.addEventListener("task.completed", finish);
    stream.addEventListener("task.failed", finish);
    stream.addEventListener("task.cancelled", finish);
    stream.addEventListener("task.paused", finish);
    stream.onerror = finish;
  }, [backendURL, refreshChats, refreshMessages]);

  const ensureActiveChat = useCallback(async (): Promise<string> => {
    if (isUsableChatId(activeChatIdRef.current)) return activeChatIdRef.current;
    const chat = await createChat();
    if (!isUsableChatId(chat?.id)) throw new Error("Unable to create chat before sending message");
    return chat.id;
  }, [createChat]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!base || !input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const chatId = await ensureActiveChat();
      const result = await api<SubmitAssistantMessageResult>(`${base}/chats/${chatId}/messages`, { method: "POST", headers: headers(), body: JSON.stringify({ content: input, providerConfigId: providerId, model }) });
      setSelectedChatId(result.chat.id);
      activeChatIdRef.current = result.chat.id;
      setInput("");
      await refreshMessages(result.chat.id);
      openStream(result.taskId, result.chat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-950 text-slate-100">
      <aside className="flex w-80 min-w-0 flex-col border-r border-slate-800 bg-slate-900/80">
        <div className="border-b border-slate-800 p-5">
          <div className="flex items-center justify-between">
            <div><h1 className="text-lg font-semibold">Assistant</h1><p className="text-xs text-slate-400">PCB-aware workspace copilot</p></div>
            <button type="button" onClick={() => void createChat().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))} className="rounded-xl bg-violet-600 p-2 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500"><MessageSquarePlus className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-400"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent outline-none" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 space-y-1">
          {filteredChats.map((chat) => (
            <button key={chat.id} type="button" onClick={() => setSelectedChatId(chat.id)} onContextMenu={(event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); setContextMenu({ chatId: chat.id, x: event.clientX, y: event.clientY }); }} className={`group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${selectedChatId === chat.id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"}`}>
              <div className="flex w-full items-center justify-between gap-2">
                <div className="truncate text-sm font-medium">{chat.title}</div>
                <MoreHorizontal className="h-4 w-4 shrink-0 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="truncate text-xs opacity-60">{chat.model}</div>
            </button>
          ))}
          {filteredChats.length === 0 ? <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">No chats yet.</div> : null}
        </div>
        <div className="border-t border-slate-800 p-3"><div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400"><Settings className="h-4 w-4" />Configure providers in global Settings → Assistant.</div></div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-6">
          <div className="min-w-0"><div className="truncate text-sm font-medium">{chats.find((chat) => chat.id === selectedChatId)?.title ?? "New chat"}</div></div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 shadow-sm focus-within:border-slate-700 hover:border-slate-700 transition-colors">
              <select value={providerId} onChange={(event) => { const provider = providers.find((entry) => entry.id === event.target.value); setProviderId(event.target.value); if (provider) setModel(provider.defaultModel); }} className="max-w-[120px] truncate bg-transparent text-xs text-slate-300 outline-none hover:text-white cursor-pointer">{providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>
              <span className="text-slate-600">/</span>
              {models.length > 0 ? (
                <select value={models.some((entry) => entry.modelId === model) ? model : (models[0]?.modelId ?? "")} onChange={(event) => setModel(event.target.value)} className="max-w-[200px] truncate bg-transparent text-xs text-slate-300 outline-none hover:text-white cursor-pointer">
                  {models.map((entry) => <option key={entry.modelId} value={entry.modelId}>{entry.displayName ?? entry.modelId}</option>)}
                </select>
              ) : (
                <input value={model} onChange={(event) => setModel(event.target.value)} className="max-w-[200px] bg-transparent text-xs text-slate-300 outline-none" />
              )}
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 shadow-sm" title={selectedProvider?.hasApiKey || selectedProvider?.kind === "openai-compatible" ? "Provider ready" : "Missing API key"}>
              <div className={`h-2 w-2 rounded-full ${selectedProvider?.hasApiKey || selectedProvider?.kind === "openai-compatible" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-amber-500"}`} />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl pb-8 pt-4">
            {error ? <div className="mx-4 mb-4 rounded-xl border border-red-900/70 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}
            {messages.length === 0 ? <div className="px-4"><EmptyState /></div> : messages.map((message) => <MessageCard key={message.id} message={message} loading={loading && message.role === "assistant" && message.content.trim().length === 0} />)}
            {loading && !hasPendingAssistantMessage ? <MessageCard message={{ id: "loading", chatId: selectedChatId ?? "", role: "assistant", content: "", taskId: null, metadata: null, createdAt: "", updatedAt: "" }} loading /> : null}
          </div>
        </div>

        <div className="border-t border-slate-800/50 bg-slate-950 p-4">
          <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-4xl">
            <div className="relative flex items-end rounded-xl border border-slate-700 bg-slate-900 shadow-sm focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500/50 transition-all">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKey} placeholder="Ask about your PCB…" rows={1} className="max-h-64 min-h-[56px] w-full resize-none bg-transparent py-4 pl-4 pr-14 text-sm outline-none placeholder:text-slate-500 leading-relaxed" />
              <button type="submit" disabled={loading || !input.trim()} className="absolute bottom-2.5 right-3 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500">
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-center text-[10px] text-slate-500">Assistant can make mistakes. Verify critical design decisions.</div>
          </form>
        </div>
      </main>
      {contextMenu ? <div className="fixed z-50 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}><button type="button" onClick={() => void deleteChat(contextMenu.chatId).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))} className="rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-950/40">Delete chat</button></div> : null}
    </div>
  );
}

function EmptyState(): ReactElement {
  return <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center"><Sparkles className="mx-auto h-8 w-8 text-violet-300" /><h2 className="mt-4 text-lg font-semibold">Start a PCB-focused conversation</h2><p className="mt-2 text-sm text-slate-500">Ask for library components, design checks, or next routing steps.</p></div>;
}

function MessageCard({ message, loading = false }: { message: AssistantMessage; loading?: boolean }): ReactElement {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-4 border-b border-slate-800/50 px-4 py-6 ${isUser ? "" : "bg-slate-900/40"}`}>
      <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isUser ? "bg-slate-800 text-slate-300" : "bg-violet-600 text-white shadow-sm shadow-violet-900/50"}`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">{isUser ? "You" : "Assistant"}</span>
          {loading && (
            <span className="flex items-center gap-0.5 text-xs text-violet-400">
              <span className="animate-pulse">●</span><span className="animate-pulse delay-75" style={{ animationDelay: '150ms' }}>●</span><span className="animate-pulse delay-150" style={{ animationDelay: '300ms' }}>●</span>
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
          {message.content}
        </div>
      </div>
    </div>
  );
}
